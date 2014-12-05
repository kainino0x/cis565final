function loadKernel(id) {
    var kernelElement = document.getElementById(id);
    var kernelSource = kernelElement.text;
    if (kernelElement.src != "") {
        var mHttpReq = new XMLHttpRequest();
        mHttpReq.open("GET", kernelElement.src, false);
        mHttpReq.send(null);
        kernelSource = mHttpReq.responseText;
    }
    return kernelSource;
}

function index3(array, index) {
    return [array[4 * index + 0],
            array[4 * index + 1],
            array[4 * index + 2]];
}

function clInit() {
    var ctx = webcl.createContext();
    var kernelSrc = loadKernel("fracturecl");
    var program = ctx.createProgram(kernelSrc);
    var device = ctx.getInfo(WebCL.CONTEXT_DEVICES)[0];

    try {
        program.build([device], "");
    } catch (e) {
        alert("Failed to build WebCL program. Error "
                + program.getBuildInfo(device, WebCL.PROGRAM_BUILD_STATUS)
                + ":  "
                + program.getBuildInfo(device, WebCL.PROGRAM_BUILD_LOG));
        throw e;
    }

    var cl = {};
    cl.ctx = ctx;
    cl.kernel = program.createKernel("fracture");
    cl.queue = ctx.createCommandQueue(device);
    return cl;
}

function clSetCells(cl, cells) {
    var planesPerCell = [];

    for (var i = 0; i < cells.length; i++) {
        var cell = cells[i].mesh;
        var center = cells[i].position;

        var cellPlanes = cellToPlanes(cell, center);
        planesPerCell.push(cellPlanes);
    }

    var cellsPerIndex = [];
    for (var i = 0; true; i++) {
        var planescurr = [];
        for (var j = 0; j < planesPerCell.length; j++) {
            var ap = planesPerCell[j];
            if (i < ap.length) {
                planescurr.push(ap[i]);
            } else {
                planescurr.push({normal: [0, 0, 0], d: 0});
            }
        }
        if (planescurr.length > 0) {
            cellsPerIndex.push(planescurr);
            break;
        }
    }

    var cpiBuffers = [];
    for (var i = 0; i < cellsPerIndex.length; i++) {
        var cpi = cellsPerIndex[i];
        var arr = new Float32Array(cpi.length * 4);
        for (var j = 0; j < cpi.length; j++) {
            var cj = cpi[j];
            arr[3 * j + 0] = cj.normal[0];
            arr[3 * j + 1] = cj.normal[1];
            arr[3 * j + 2] = cj.normal[2];
            arr[3 * j + 3] = cj.d;
        }

        var buf = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY, arr.length * 4);
        cl.queue.enqueueWriteBuffer(buf, false, 0, arr.length * 4, arr);
        cpiBuffers.push({count: cpi.length, buf: buf});
    }

    cl.cellBuffers = cpiBuffers;
}

function floatNcompact(N, index, val) {
    var indices = [];
    var values = [];
    for (var i = 0; i < index.length; i++) {
        if (index[i] != -1) {
            indices.push(index[i]);
            for (var n = 0; n < N; n++) {
                values.push(val[i * N + n]);
            }
        }
    }
    return {indices: indices, values: values};
}

function pushfloat4(arr, val) {
    arr.push(val[0]);
    arr.push(val[1]);
    arr.push(val[2]);
    arr.push(0);
}

function makeFace(indices, allpoints) {
    var lastidx = -1;
    var faces = [];
    for (var i = 0; i < indices.length; i++) {
        var idx = indices[i];
        var f = faces[idx];
        if (!f) {
            f = faces[idx] = [];
        }

        // save the current two points into the correct face
        var p1 = [points[i * 4 + 0],
                  points[i * 4 + 1],
                  points[i * 4 + 2]];
        var p2 = [points[i * 4 + 4],
                  points[i * 4 + 5],
                  points[i * 4 + 6]];
        f.push(p1, p2);

        lastidx = i;
    }

    var idxout = [];
    var values = [];
    for (var iface = 0; iface < faces.length; iface++) {
        var f = faces[iface];

        // sort the face
        var orig = f[0];
        var first = normalize3(sub3(f[1], orig));
        var sorted = [ {cosx: 0, p: f[1]} ];
        for (var i = 2; i < f.length; i++) {
            var p = f[i];
            var rel = sub3(p, orig);
            if (length3(rel) > 0.001) {
                rel = normalize3(rel);
                var cosx = Math.acos(dot3(rel, first));
                sorted.push({cosx: cosx, p: p});
            }
        }
        sorted.sort(function(a, b) { return a.cosx - b.cosx; });

        // triangulate the face and save it
        var oldp = orig;
        for (var i = 0; i < sorted.length; i++) {
            var p = sorted[i].p;
            // remove duplicates
            if (length3(sub3(p, oldp)) > 0.001) {
                // save the cell index
                idxout.push(iface);
                // and the three points
                pushfloat4(values, orig);
                pushfloat4(values, oldp);
                pushfloat4(values, p);
                oldp = p;
            }
        }
    }

    return {indices: idxout, values: values};
}

function clSetupArgs(cl, iteration, arrtris) {
    var tricount = arrtris.length / 12;

    cl.buftris = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY, arrtris.length * 4 * 4);
    cl.queue.enqueueWriteBuffer(buftris, false, 0, arrtris.length * 4 * 4, arrtris);

    cl.buftriexist = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount * 2      * 4);
    cl.buftriout   = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount * 2 * 12 * 4);
    cl.bufnewexist = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount          * 4);
    cl.bufnewout   = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount * 2 *  4 * 4);

    cl.kernel.setArg(0, new Uint32Array([tricount]));
    cl.kernel.setArg(1, cl.buftris);
    cl.kernel.setArg(2, new Uint32Array([cl.cellBuffers[iteration].count]));
    cl.kernel.setArg(3, cl.cellBuffers[iteration].buf);
    cl.kernel.setArg(4, cl.buftriexist);
    cl.kernel.setArg(5, cl.buftriout);
    cl.kernel.setArg(6, cl.bufnewexist);
    cl.kernel.setArg(7, cl.bufnewout);
}

function clOutputToInput(cl, oldtricount) {
    buftris.release();

    var arrtriexist = new  Uint32Array(oldtricount * 2);
    var arrtriout   = new Float32Array(oldtricount * 2 * 3 * 4);
    var arrnewexist = new  Uint32Array(oldtricount);
    var arrnewout   = new Float32Array(oldtricount * 2 * 4)
    cl.queue.enqueueReadBuffer(cl.buftriexist, false, 0, oldtricount * 2      * 4, arrtriexist);
    cl.queue.enqueueReadBuffer(cl.buftriout  , false, 0, oldtricount * 2 * 12 * 4, arrtriout  );
    cl.queue.enqueueReadBuffer(cl.bufnewexist, false, 0, oldtricount          * 4, arrnewexist);
    cl.queue.enqueueReadBuffer(cl.bufnewout  , false, 0, oldtricount * 2 *  4 * 4, arrnewout  );
    cl.buftriexist.release();
    cl.buftriout  .release();
    cl.bufnewexist.release();
    cl.bufnewout  .release();

    var tmp;
    tmp = floatNcompact(12, triexistarr, trioutarr);
    var tricells = tmp.indices;
    var tris = tmp.values;
    tmp = floatNcompact( 8, newexistarr, newoutarr);
    var newcells = tmp.indices;
    var news = tmp.values;

    tmp = makeFace(newcells, news);
    var newtricells = tmp.indices;
    var newtris = tmp.values;
    tricells.push.apply(newtricells);  // extend tricells
    tris.push.apply(newtris);  // extend tris

    var arrtris = new Float32Array(tris);
    return arrtris;
}

function clFracture(cl, vertices, faces) {
    var vertcount = vertices.length;
    var tricount = faces.length;

    var triarr = new Float32Array(tricount * 3 * 4);
    for (var t = 0; t < tricount; t++) {
        for (var v = 0; v < 3; v++) {
            for (var a = 0; a < 3; a++) {
                triarr[t * 12 + v * 4 + a] = vertices[faces[t].points[v]][a];
            }
            triarr[t * 12 + v * 4 + 3] = 0;
        }
    }

    for (var i = 0; i < cl.cellBuffers.length; i++) {
        clSetupArgs(cl, i, triarr);

        var localWS = [1];
        var globalWS = [tricount * _];
        cl.queue.enqueueNDRangeKernel(cl.kernel, globalWS.length, null, globalWS, localWS);

        triarr = clOutputToInput(cl, tricount);
        tricount = triarr.length / 12;
    }

    /*
    var vertarr = new Float32Array(vertices.length * 3);
    for (var i = 0; i < vertcount; i++) {
        vertarr[3 * i + 0] = vertices[i][0];
        vertarr[3 * i + 1] = vertices[i][1];
        vertarr[3 * i + 2] = vertices[i][2];
    }

    var facearr = new Uint32Array(faces.length * 3);
    for (var i = 0; i < facecount; i++) {
        facearr[3 * i + 0] = faces[i].points[0];
        facearr[3 * i + 1] = faces[i].points[1];
        facearr[3 * i + 2] = faces[i].points[2];
    }

    var bufInV  = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY , vertcount * 3 * 4);
    var bufInF  = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY , facecount * 3 * 4);
    var bufOutV = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, vertcount * 3 * 4);

    cl.kernel.setArg(0, new Uint32Array([vertcount]));
    cl.kernel.setArg(1, bufInV);
    cl.kernel.setArg(2, new Uint32Array([facecount]));
    cl.kernel.setArg(3, bufInF);
    cl.kernel.setArg(4, bufOutV);

    cl.queue.enqueueWriteBuffer(bufInV, false, 0, vertcount * 3 * 4, vertarr);
    cl.queue.enqueueWriteBuffer(bufInF, false, 0, facecount * 3 * 4, facearr);

    var localWS = [1];
    var globalWS = [vertcount];

    cl.queue.enqueueNDRangeKernel(cl.kernel, globalWS.length, null, globalWS, localWS);

    var newvertarr = new Float32Array(vertcount * 3);
    cl.queue.enqueueReadBuffer(bufOutV, false, 0, vertcount * 3 * 4, newvertarr);
    cl.queue.finish();

    var newfacearr = facearr;

    var newverts = [];
    for (var i = 0; i < newvertarr.length / 3; i++) {
        newverts.push([
                newvertarr[3 * i + 0],
                newvertarr[3 * i + 1],
                newvertarr[3 * i + 2]]);
    }

    var newfaces = [];
    for (var i = 0; i < newfacearr.length / 3; i++) {
        newfaces.push([
                newfacearr[3 * i + 0],
                newfacearr[3 * i + 1],
                newfacearr[3 * i + 2]]);
    }

    return [newverts, newfaces];
    */
}
