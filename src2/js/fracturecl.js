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
        var nonempty = false;
        for (var j = 0; j < planesPerCell.length; j++) {
            var ap = planesPerCell[j];
            if (i < ap.length) {
                planescurr.push(ap[i]);
                nonempty = true;
            } else {
                planescurr.push({normal: [0, 0, 0], d: 0});
            }
        }
        if (nonempty) {
            cellsPerIndex.push(planescurr);
        } else {
            break;
        }
    }

    var cpiBuffers = [];
    for (var i = 0; i < cellsPerIndex.length; i++) {
        var cpi = cellsPerIndex[i];
        var arr = new Float32Array(cpi.length * 4);
        for (var j = 0; j < cpi.length; j++) {
            var cj = cpi[j];
            arr[4 * j + 0] = cj.normal[0];
            arr[4 * j + 1] = cj.normal[1];
            arr[4 * j + 2] = cj.normal[2];
            arr[4 * j + 3] = cj.d;
        }

        var buf = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY, arr.byteLength);
        cl.queue.enqueueWriteBuffer(buf, false, 0, arr.byteLength, arr);
        cpiBuffers.push(buf);
    }

    cl.cellCount = cells.length;
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

function makeFace(indices, points) {
    var lastidx = -1;
    var faces = [];
    for (var i = 0; i < indices.length; i++) {
        var idx = indices[i];
        var F = faces[idx];
        if (!F) {
            faces[idx] = {cell: idx};
            var f = faces[idx].f = [];
        }

        // save the current two points into the correct face
        var p1 = [points[i * 4 + 0],
                  points[i * 4 + 1],
                  points[i * 4 + 2]];
        var p2 = [points[i * 4 + 4],
                  points[i * 4 + 5],
                  points[i * 4 + 6]];
        f.push([p1, p2]);
    }

    for (var i = 0; i < faces.length; i++) {
        var F = faces[i];
        var centr = [0, 0, 0];
        for (var j = 0; j < F.f.length; j++) {
            centr = add3(centr, add3(F.f[j][0], F.f[j][1]));
        }
        centr = mult3c(centr, 1.0 / F.f.length);
        F.c = centr;
    }

    var idxout = [];
    var values = [];
    for (var iface = 0; iface < faces.length; iface++) {
        var F = faces[iface];
        if (!F) {
            continue;
        }

        // Create a tri from the centroid and the two points on each edge
        for (var i = 0; i < F.f.length; i++) {
            idxout.push(F.cell);
            pushfloat4(values, F.c);
            pushfloat4(values, F.f[i][0]);
            pushfloat4(values, F.f[i][1]);
        }
    }

    return {indices: idxout, values: values};
}

function clSetupArgs(cl, iteration) {
    var tricount = cl.arrtricells.length;

    cl.buftricells = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY, cl.arrtricells.byteLength);
    cl.buftris     = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY, cl.arrtris.byteLength);
    cl.queue.enqueueWriteBuffer(cl.buftris    , false, 0, cl.arrtris    .byteLength, cl.arrtris);
    cl.queue.enqueueWriteBuffer(cl.buftricells, false, 0, cl.arrtricells.byteLength, cl.arrtricells);

    cl.buftrioutcells = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount * 2      * 4);
    cl.buftriout      = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount * 2 * 12 * 4);
    cl.bufnewoutcells = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount          * 4);
    cl.bufnewout      = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount * 2 *  4 * 4);

    cl.kernel.setArg(0, new Uint32Array([cl.cellCount]));
    cl.kernel.setArg(1, cl.cellBuffers[iteration]);

    cl.kernel.setArg(2, new Uint32Array([tricount]));
    cl.kernel.setArg(3, cl.buftricells);
    cl.kernel.setArg(4, cl.buftris);

    cl.kernel.setArg(5, cl.buftrioutcells);
    cl.kernel.setArg(6, cl.buftriout);

    cl.kernel.setArg(7, cl.bufnewoutcells);
    cl.kernel.setArg(8, cl.bufnewout);
}

function clOutputToInput(cl, oldtricount) {
    cl.buftris.release();

    var arrtrioutcells = new   Int32Array(oldtricount * 2);
    var arrtriout      = new Float32Array(oldtricount * 2 * 12);
    var arrnewoutcells = new   Int32Array(oldtricount);
    var arrnewout      = new Float32Array(oldtricount * 2 * 4)
    cl.queue.enqueueReadBuffer(cl.buftrioutcells, false, 0, arrtrioutcells.byteLength, arrtrioutcells);
    cl.queue.enqueueReadBuffer(cl.buftriout     , false, 0, arrtriout     .byteLength, arrtriout     );
    cl.queue.enqueueReadBuffer(cl.bufnewoutcells, false, 0, arrnewoutcells.byteLength, arrnewoutcells);
    cl.queue.enqueueReadBuffer(cl.bufnewout     , false, 0, arrnewout     .byteLength, arrnewout     );
    cl.buftrioutcells.release();
    cl.buftriout     .release();
    cl.bufnewoutcells.release();
    cl.bufnewout     .release();

    var tmp;
    tmp = floatNcompact(12, arrtrioutcells, arrtriout);
    var tricells = tmp.indices;
    var tris = tmp.values;
    tmp = floatNcompact( 8, arrnewoutcells, arrnewout);
    var newcells = tmp.indices;
    var news = tmp.values;

    tmp = makeFace(newcells, news);
    tricells = tricells.concat(tmp.indices);
    tris     = tris    .concat(tmp.values);

    cl.arrtricells = new Int32Array(tricells);
    cl.arrtris = new Float32Array(tris);
}

function clFracture(cl, vertices, faces) {
    var vertcount = vertices.length;
    var tricount = faces.length;

    // make a buffer which has one copy of the mesh for each cell
    cl.arrtricells = new Int32Array(cl.cellCount * tricount);
    cl.arrtris = new Float32Array(cl.cellCount * tricount * 3 * 4);
    for (var c = 0; c < cl.cellCount; c++) {
        for (var t = 0; t < tricount; t++) {
            var ct = c * tricount + t;
            cl.arrtricells[ct] = c;
            for (var v = 0; v < 3; v++) {
                var ctv = ((c * tricount + t) * 3 + v) * 4;
                for (var a = 0; a < 3; a++) {
                    cl.arrtris[ctv + a] = vertices[faces[t].points[v]][a];
                }
                cl.arrtris[ctv + 3] = 0;
            }
        }
    }
    // update tricount to reflect new buffer size
    tricount = tricount * cl.cellCount;

    for (var i = 0; i < 1/*cl.cellBuffers.length*/; i++) {
        clSetupArgs(cl, i);

        var localWS = [8];
        var globalWS = [Math.ceil(tricount / 8) * 8];
        cl.queue.enqueueNDRangeKernel(cl.kernel, globalWS.length, null, globalWS, localWS);

        clOutputToInput(cl, tricount);
        tricount = cl.arrtricells.length;
    }

    var cellfaces = [];
    for (var i = 0; i < cl.arrtricells.length; i++) {
        var idx = cl.arrtricells[i];
        var c = cellfaces[idx];
        if (!c) {
            c = cellfaces[idx] = {points: [], faces: []};
        }

        for (var v = 0; v < 3; v++) {
            var off = i * 12 + v * 4;
            c.points.push([cl.arrtris[off + 0],
                           cl.arrtris[off + 1],
                           cl.arrtris[off + 2]]);
        }
        var ci = c.faces.length * 3;
        c.faces.push([ci, ci + 1, ci + 2]);
    }

    return cellfaces;
}
