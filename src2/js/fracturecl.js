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
    // TODO: create all of the appropriate `planes` buffers
}

function clFracture(cl, vertices, faces) {
    var vertcount = vertices.length;
    var facecount = faces.length;

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
