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
    cl.scaninitkernel = program.createKernel("getScanInput");
    cl.scaniterkernel = program.createKernel("scanIter");
    cl.scatterkernel = [];  // not sure if this is necessary, or what to put here if it is.
    cl.scatterkernel['tris'] = program.createKernel("scatterTris");
    cl.scatterkernel['points'] = program.createKernel("scatterPoints");
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

        var centr = [0, 0, 0];
        for (var j = 0; j < f.length; j++) {
            centr = add3(centr, add3(f[j][0], f[j][1]));
        }
        centr = mult3c(centr, 0.5 / f.length);

        // Create a tri from the centroid and the two points on each edge
        for (var i = 0; i < f.length; i++) {
            idxout.push(iface);
            pushfloat4(values, centr);
            pushfloat4(values, f[i][0]);
            pushfloat4(values, f[i][1]);
        }
    }

    return {indices: idxout, values: values};
}

function clSetupArgs(cl, iteration, tricount) {
    if (iteration > 0) {
        cl.buftricells = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY, cl.arrtricells.byteLength);
        cl.buftris     = cl.ctx.createBuffer(WebCL.MEM_READ_ONLY, cl.arrtris.byteLength);
        cl.queue.enqueueWriteBuffer(cl.buftris    , false, 0, cl.arrtris    .byteLength, cl.arrtris);
        cl.queue.enqueueWriteBuffer(cl.buftricells, false, 0, cl.arrtricells.byteLength, cl.arrtricells);
    }

    cl.buftrioutcells = cl.ctx.createBuffer(WebCL.MEM_READ_WRITE, tricount * 2      * 4);
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
    
    cl.kernel.setArg(9, cl.fractureCenter);

    cl.queue.finish();
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

    
    // --------------------------------------------------------
    // stream compaction for the triangles
    var scanSize = Math.pow(2.0, Math.ceil(Math.log2(oldtricount * 2)));
    
    var localsize = 1;
    var localWS = [localsize];
    var globalWS = [Math.ceil(scanSize / localsize) * localsize];
    
    // we will be performing a naive double-buffered scan
    cl.scantrioutA = cl.ctx.createBuffer(WebCL.MEM_READ_WRITE, scanSize * 4);
    cl.scantrioutB = cl.ctx.createBuffer(WebCL.MEM_READ_WRITE, scanSize * 4);
    
    cl.scaninitkernel.setArg(0, new Uint32Array([oldtricount * 2]));
    cl.scaninitkernel.setArg(1, cl.buftrioutcells);
    cl.scaninitkernel.setArg(2, new Uint32Array([scanSize]));
    cl.scaninitkernel.setArg(3, cl.scantrioutA);
    
    // this kernel fills cl.scantrioutA with 0's and 1's depending on the cellID in cl.buftrioutcells
    cl.queue.enqueueNDRangeKernel(cl.scaninitkernel, globalWS.length, null, globalWS, localWS);
    cl.queue.finish();
    
    // debug
    /*
    var scatterinitout = new Int32Array(scanSize);
    cl.queue.enqueueReadBuffer(cl.scantrioutA, false, 0, scatterinitout.byteLength, scatterinitout);
    cl.queue.finish();
    var compCount = 0;
    for (var i = 0; i < scanSize; i++) {
        if (scatterinitout[i] == 1) {
            compCount++;
        }
    }
    
    var oldcount = 0;
    for (var i = 0; i < oldtricount * 2; i++) {
        if (arrtrioutcells[i] != -1) {
            oldcount++;
        }
    }*/
    // end debug
    
    var i = 0;  // keeps track of where the final result is.
    cl.scaniterkernel.setArg(1, new Uint32Array([scanSize]));
    // NOTE: used to have these alternate 2, 3 in the loop based on i % 2, but it seems like handling it in the kernel is faster for some reason.  needs further testing.
    cl.scaniterkernel.setArg(2, cl.scantrioutA);
    cl.scaniterkernel.setArg(3, cl.scantrioutB);
    // Perform scan iteration log2(scanSize) times.
    for (i = 0; Math.pow(2, i) < scanSize; i++) {
        cl.scaniterkernel.setArg(0, new Uint32Array([i]));
        cl.queue.enqueueNDRangeKernel(cl.scaniterkernel, globalWS.length, null, globalWS, localWS);
        cl.queue.finish();
    }
        
    // NOTE: we need to copy cl.scantrioutA/B in order to get the correct triangle count.  Is there a better way?
    var scanout = new Int32Array(scanSize);
    if (i % 2 == 0) {
        // A has the final output
        cl.queue.enqueueReadBuffer(cl.scantrioutA, false, 0, scanout.byteLength, scanout);  
        cl.scatterkernel['tris'].setArg(3, cl.scantrioutA);
    } else {
        // it's in B
        cl.queue.enqueueReadBuffer(cl.scantrioutB, false, 0, scanout.byteLength, scanout);
        cl.scatterkernel['tris'].setArg(3, cl.scantrioutB);
    }
    
    cl.queue.finish();
    
    // the size of the array after compaction
    var newtricount = scanout[scanSize - 1];
    
    // TODO: once point compaction is working, and faces are generated, initialize the size of this array to the combined size.
    cl.bufscattriout      = cl.ctx.createBuffer(WebCL.MEM_READ_WRITE, newtricount * 12 * 4);
    cl.bufscattrioutcells = cl.ctx.createBuffer(WebCL.MEM_READ_WRITE, newtricount      * 4);
    
    cl.scatterkernel['tris'].setArg(0, new Uint32Array([oldtricount * 2]));
    cl.scatterkernel['tris'].setArg(1, cl.buftriout);
    cl.scatterkernel['tris'].setArg(2, cl.buftrioutcells);
    // NOTE: arg3 is set in the if-else statement above.
    cl.scatterkernel['tris'].setArg(4, new Uint32Array([oldtricount * 2]));
    cl.scatterkernel['tris'].setArg(5, cl.bufscattriout);
    cl.scatterkernel['tris'].setArg(6, cl.bufscattrioutcells);
    cl.queue.enqueueNDRangeKernel(cl.scatterkernel['tris'], globalWS.length, null, globalWS, localWS);
    cl.queue.finish();
    
    var scatteroutcells = new Int32Array(newtricount);
    cl.queue.enqueueReadBuffer(cl.bufscattrioutcells, false, 0, scatteroutcells.byteLength, scatteroutcells);  
    var scatterouttris = new Float32Array(newtricount * 12);
    cl.queue.enqueueReadBuffer(cl.bufscattriout, false, 0, scatterouttris.byteLength, scatterouttris);
    cl.queue.finish();
    
    //TODO: release all the things used in stream compaction.
    // END STREAM COMPACTION CODE
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

    //debug - check correctness of stream compaction
    /*
    for (var i = 0; i < tris.length; i++) {
        if (Math.abs(tris[i] - scatterouttris[i]) > 0.000001) {
            console.log("ERROR TRI");
        }
    }
    for (var i = 0; i < tricells.length; i++) {
        if (Math.abs(tricells[i] - scatteroutcells[i]) > 0.000001) {
            console.log("ERROR CELL");
        }
    }
    */
    //end debug
    
    tmp = makeFace(newcells, news);
    tricells = tricells.concat(tmp.indices);
    tris     = tris    .concat(tmp.values);

    cl.arrtricells = new Int32Array(tricells);
    cl.arrtris = new Float32Array(tris);

    cl.queue.finish();
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
    var vertcount = vertices.length;
    var tricount = faces.length;
    
    pImpact.push(0);
    cl.fractureCenter = new Float32Array(mult3c(pImpact, -1));
    
    console.log(typeof pImpact[0]);
    console.log(typeof rotation[0]);

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

    var time_total = performance.now() - tInit;

    console.log("time_total: "                 + time_total);
    console.log("    time_transformcopy: "     + time_transformcopy);
    console.log("    time_total_iterations: "  + time_total_iterations);
    console.log("        time_setupargs: "     + time_setupargs);
    console.log("        time_kernel: "        + time_kernel);
    console.log("        time_outputtoinput: " + time_outputtoinput);
    console.log("        time_proximity: "     + time_proximity);
    console.log("    time_collect: "           + time_collect);
    console.log("    time_recenter: "          + time_recenter);

    return cellfaces;
}
