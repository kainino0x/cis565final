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
    var ctx = webcl.createContext(/*WebCL.DEVICE_TYPE_GPU*/);
    var kernelSrc = loadKernel("fracturecl");
    var program = ctx.createProgram(kernelSrc);
    var device = ctx.getInfo(WebCL.CONTEXT_DEVICES)[0];
    console.log(device.getInfo(WebCL.DEVICE_NAME));

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
    cl.copykernel = program.createKernel("transformCopyPerPlane");
    cl.proxkernel = program.createKernel("applyProximity");
    cl.queue = ctx.createCommandQueue(device);
    return cl;
}

function clSetCells(cl, cells, influence) {
    var cellProximate = [];
    var planesPerCell = [];
    for (var i = 0; i < cells.length; i++) {
        var cell = cells[i].mesh;
        var center = cells[i].position; //NOTE: This assumes that the position of each cell is inside of it!
        
        var prox = false;
        for (var j = 0; j < cell.points.length; j++) {
            if (length3(sub3(cell.points[j], center)) < influence) {
                prox = true;
                break;
            }
        }
        cellProximate[i] = prox;
        
        var cellPlanes = cellToPlanes(cell, center, center);
        planesPerCell[i] = cellPlanes;
    }
    cl.proximate = cellProximate; // for debug view
    cellProximate = new Uint32Array(cellProximate);

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

    var buf = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY, cellProximate.byteLength);
    cl.queue.enqueueWriteBuffer(buf, false, 0, cellProximate.byteLength, cellProximate);
    cl.cellProxBuf = buf;
    cl.proxkernel.setArg(0, cl.cellProxBuf);
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

function pdistance(e1, e2) {
    return length3(sub3([e1.x, e1.y, e1.z], [e2.x, e2.y, e2.z]));
}

function asxyz(v) {
    return {x: v[0], y: v[1], z: v[2]};
}

function makeFace(indices, points) {
    var lastidx = -1;
    var faces = [];
    for (var i = 0; i < indices.length; i++) {
        var idx = indices[i];
        var f = faces[idx];
        if (!f) {
            f = faces[idx] = [];
        }

        // save the current two points into the correct face
        var p1 = [points[i * 8 + 0],
                  points[i * 8 + 1],
                  points[i * 8 + 2]];
        var p2 = [points[i * 8 + 4],
                  points[i * 8 + 5],
                  points[i * 8 + 6]];
        f.push([p1, p2]);
    }

    var idxout = [];
    var values = [];
    for (var iface = 0; iface < faces.length; iface++) {
        var f = faces[iface];
        if (!f) {
            continue;
        }

        // Create an adjacency-list sort of thing from the edges we get in
        var points = [];
        for (var j = 0; j < f.length; j++) {
            var fj = f[j];
            var e0 = asxyz(fj[0]); e0.other = 1; e0.j = j;
            var e1 = asxyz(fj[1]); e1.other = 0; e1.j = j;
            points.push(e0, e1);
        }

        // Put all the points into a tree
        var tree = new kdTree(points, pdistance, ['x', 'y', 'z']);

        // This should create a loop that goes in the direction of the first edge
        var vertloop = [f[0][0]];
        var laste = asxyz(f[0][0]); laste.other = 1; laste.j = 0;
        for (var j = 1; j <= f.length; j++) {
            var near = tree.nearest(asxyz(f[laste.j][laste.other]), 2);
            var e = near[0][0];
            if (e.j == laste.j) {
                e = near[1][0];
            }
            vertloop.push([e.x, e.y, e.z]);
            laste = e;
        }

        //console.log(vertloop);

        // Create a triangle fan between the first vert and the rest of the verts

        var v0 = vertloop[0];
        for (var i = 1; i < vertloop.length - 1; i++) {
            idxout.push(iface);
            pushfloat4(values, v0);
            pushfloat4(values, vertloop[i]);
            pushfloat4(values, vertloop[i + 1]);
        }

        // TODO: Why do some of the triangles come out wound the wrong way?
    }

    return {indices: idxout, values: values};
}

var time_setup_input;
var time_setup_rest;

function clSetupArgs(cl, iteration, tricount) {
    if (iteration > 0) {
        var t0 = performance.now();
        cl.buftricells = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY, cl.arrtricells.byteLength);
        cl.buftris     = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY, cl.arrtris.byteLength);
        cl.queue.enqueueWriteBuffer(cl.buftris    , false, 0, cl.arrtris    .byteLength, cl.arrtris);
        cl.queue.enqueueWriteBuffer(cl.buftricells, false, 0, cl.arrtricells.byteLength, cl.arrtricells);
        cl.queue.finish();
        time_setup_input += performance.now() - t0;
    }

    var t0 = performance.now();

    cl.buftrioutcells = cl.ctx.createBuffer(WebCL.MEM_READ_WRITE, tricount * 2      * 4);
    cl.buftriout      = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount * 2 * 12 * 4);
    cl.bufnewoutcells = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount          * 4);
    cl.bufnewout      = cl.ctx.createBuffer(WebCL.MEM_WRITE_ONLY, tricount * 2 *  4 * 4);
    cl.queue.finish();

    cl.kernel.setArg(0, new Uint32Array([cl.cellCount]));
    cl.kernel.setArg(1, cl.cellBuffers[iteration]);

    cl.kernel.setArg(2, new Uint32Array([tricount]));
    cl.kernel.setArg(3, cl.buftricells);
    cl.kernel.setArg(4, cl.buftris);

    cl.kernel.setArg(5, cl.buftrioutcells);
    cl.kernel.setArg(6, cl.buftriout);

    cl.kernel.setArg(7, cl.bufnewoutcells);
    cl.kernel.setArg(8, cl.bufnewout);
    
    cl.kernel.setArg(9, cl.fractureCenter);

    cl.queue.finish();
    time_setup_rest += performance.now() - t0;
}

var time_readbuffers;
var time_compact_tris;
var time_compact_news;
var time_makeface;

function clOutputToInput(cl, oldtricount) {
    var t0 = performance.now();

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
    cl.queue.finish();

    var t1 = performance.now();

    var tmp;
    tmp = floatNcompact(12, arrtrioutcells, arrtriout);
    var tricells = tmp.indices;
    var tris = tmp.values;

    var t2 = performance.now();

    tmp = floatNcompact( 8, arrnewoutcells, arrnewout);
    var newcells = tmp.indices;
    var news = tmp.values;

    var t3 = performance.now();

    tmp = makeFace(newcells, news);
    tricells = tricells.concat(tmp.indices);
    tris     = tris    .concat(tmp.values);

    cl.arrtricells = new Int32Array(tricells);
    cl.arrtris = new Float32Array(tris);

    var t4 = performance.now();

    time_readbuffers += t1 - t0;
    time_compact_tris += t2 - t1;
    time_compact_news += t3 - t2;
    time_makeface += t4 - t3;
}

function clVertfaceToTris(cl, vertices, faces) {
    // create initial array of mesh data
    var tricount = faces.length;
    cl.arrtris = new Float32Array(tricount * 3 * 4);
    for (var t = 0; t < tricount; t++) {
        for (var v = 0; v < 3; v++) {
            var tv = (t * 3 + v) * 4;
            for (var a = 0; a < 3; a++) {
                cl.arrtris[tv + a] = vertices[faces[t].points[v]][a];
            }
            cl.arrtris[tv + 3] = 0;
        }
    }
}

function clTransformCopyPerPlane(cl, vertices, faces, transform) {
    var tricount = faces.length;

    // Create the array of triangle data for one copy of the mesh
    clVertfaceToTris(cl, vertices, faces);

    // Allocate memory for one copy per cell of the mesh
    cl.buftricells = cl.ctx.createBuffer(WebCL.MEM_READ_WRITE, cl.cellCount * tricount      * 4);
    cl.buftris     = cl.ctx.createBuffer(WebCL.MEM_READ_WRITE, cl.cellCount * tricount * 12 * 4);
    cl.queue.enqueueWriteBuffer(cl.buftris, false, 0, cl.arrtris.byteLength, cl.arrtris);
    cl.copykernel.setArg(0, new Uint32Array([cl.cellCount]));
    cl.copykernel.setArg(1, new Float32Array(transform));
    cl.copykernel.setArg(2, new Uint32Array([tricount]));
    cl.copykernel.setArg(3, cl.buftricells);
    cl.copykernel.setArg(4, cl.buftris);

    var localsize = 1;
    var localWS = [localsize];
    var globalWS = [Math.ceil(tricount / localsize) * localsize];
    cl.queue.enqueueNDRangeKernel(cl.copykernel, globalWS.length, null, globalWS, localWS);

    cl.queue.finish();

    return tricount * cl.cellCount;
}

function clFracture(cl, vertices, faces, rotation, pImpact) {
    var tInit = performance.now();
    var t0;
    time_readbuffers = 0;
    time_compact_tris = 0;
    time_compact_news = 0;
    time_makeface = 0;
    time_setup_input = 0;
    time_setup_rest = 0;

    var vertcount = vertices.length;
    var tricount = faces.length;
    
    pImpact.push(0);
    cl.fractureCenter = new Float32Array(mult3c(pImpact, -1));
    
    //console.log(typeof pImpact[0]);
    //console.log(typeof rotation[0]);

    var transform = [rotation[0], rotation[1], rotation[2], 0,
                     rotation[3], rotation[4], rotation[5], 0,
                     rotation[6], rotation[7], rotation[8], 0,
                               0,           0,           0, 1];
                               
    t0 = performance.now();
    tricount = clTransformCopyPerPlane(cl, vertices, faces, transform);
    var time_transformcopy = performance.now() - t0;

    var time_setupargs = 0;
    var time_kernel = 0;
    var time_outputtoinput = 0;

    t0 = performance.now();
    var localsize = 1;
    for (var i = 0; i < cl.cellBuffers.length; i++) {
        var t1 = performance.now();

        clSetupArgs(cl, i, tricount);

        var t2 = performance.now();

        var localWS = [localsize];
        var globalWS = [Math.ceil(tricount / localsize) * localsize];
        cl.queue.enqueueNDRangeKernel(cl.kernel, globalWS.length, null, globalWS, localWS);
        cl.queue.finish();

        var t3 = performance.now();

        if (i == cl.cellBuffers.length - 1) {
            // on the last iteration, before copying to cpu, merge faraway cells
            var localWS = [localsize];
            var globalWS = [Math.ceil(tricount * 2 / localsize) * localsize];
            cl.proxkernel.setArg(1, new Uint32Array([tricount * 2]));
            cl.proxkernel.setArg(2, cl.buftrioutcells);
            cl.queue.enqueueNDRangeKernel(cl.proxkernel, globalWS.length, null, globalWS, localWS);
            cl.queue.finish();
            var time_proximity = performance.now() - t3;
        }

        var t4 = performance.now();
        clOutputToInput(cl, tricount);
        tricount = cl.arrtricells.length;

        var t5 = performance.now();
        time_setupargs += t2 - t1;
        time_kernel += t3 - t2;
        time_outputtoinput += t5 - t4;
    }
    var time_total_iterations = performance.now() - t0;

    t0 = performance.now();
    var cellfaces = [];
    for (var i = 0; i < cl.arrtricells.length; i++) {
        var idx = cl.arrtricells[i] + 2; // so that -2 becomes a valid cell
        var c = cellfaces[idx];
        if (!c) {
            c = cellfaces[idx] = {points: [], faces: [],
                min: [10000, 10000, 10000], max: [-10000, -10000, -10000]};
        }

        for (var v = 0; v < 3; v++) {
            var off = i * 12 + v * 4;
            var p = [cl.arrtris[off + 0],
                     cl.arrtris[off + 1],
                     cl.arrtris[off + 2]]
            c.points.push(p);
            c.min = compwise(Math.min, c.min, p);
            c.max = compwise(Math.max, c.max, p);
        }
        var ci = c.faces.length * 3;
        c.faces.push([ci, ci + 1, ci + 2]);
    }
    var time_collect = performance.now() - t0;

    t0 = performance.now();
    for (var i = 0; i < cellfaces.length; i++) {
        var c = cellfaces[i];
        if (!c) {
            continue;
        }

        c.position = mult3c(add3(c.min, c.max), 0.5);
        c.size = sub3(c.max, c.min);
        for (var j = 0; j < c.points.length; j++) {
            c.points[j] = sub3(c.points[j], c.position);
        }
    }
    var time_recenter = performance.now() - t0;

    var time_clFracture = performance.now() - tInit;

    console.log("v  time_transformcopy:       " + time_transformcopy);
    console.log("      v time_setup_input:    " + time_setup_input);
    console.log("      v time_setup_rest:     " + time_setup_rest);
    console.log("   v  time_setupargs:        " + time_setupargs);
    console.log("   v  time_kernel:           " + time_kernel);
    console.log("      v  time_readbuffers:   " + time_readbuffers);
    console.log("      v  time_compact_tris:  " + time_compact_tris);
    console.log("      v  time_compact_news:  " + time_compact_news);
    console.log("      v  time_makeface:      " + time_makeface);
    console.log("   v  time_outputtoinput:    " + time_outputtoinput);
    console.log("   v  time_proximity:        " + time_proximity);
    console.log("v  time_total_iterations:    " + time_total_iterations);
    console.log("v  time_collect:             " + time_collect);
    console.log("v  time_recenter:            " + time_recenter);
    console.log("time_clFracture:             " + time_clFracture);

    return cellfaces;
}
