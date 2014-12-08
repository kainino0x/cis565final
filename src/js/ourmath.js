function cross3(a, b) {
    return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
}

function dot3(a, b) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}

function add3(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mult3c(a, c) {
    return [a[0]*c, a[1]*c, a[2]*c];
}

function length3(a) {
    return Math.sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]);
}

function compwise(f, a, b) {
    return [f(a[0], b[0]), f(a[1], b[1]), f(a[2], b[2])];
}

function normalize3(a) {
    var length = length3(a);
    return [a[0]/length, a[1]/length, a[2]/length];
}

function nearlyEqual3(a, b) {
    var EPSILON = 0.0001;
    return Math.abs(dot3(a, b) - 1) < EPSILON;
}

function containsNormal(a, norm) {
    var i = a.length;
    while(--i >= 0) {
        if (nearlyEqual3(a[i].normal, norm)) {
            return true;
        }
    }
    return false;
}

function toRotationMatrix(a) {
    var m = mat3Id();
    var m1 = mat3Id();
    var DEG_TO_RAD = 3.14159265359/180.0;
    var sAng, cAng;
    
    if (a[2]) {
        m1 = mat3Id();
        sAng = Math.sin(-a[2] * DEG_TO_RAD);
        cAng = Math.cos(-a[2] * DEG_TO_RAD);
        m1[0] = cAng;   m1[1] = sAng;
        m1[3] = -sAng;  m1[4] = cAng;
        
        m = mat3mult(m, m1);
    }
    if (a[1]) {
        m1 = mat3Id();
        sAng = Math.sin(-a[1] * DEG_TO_RAD);
        cAng = Math.cos(-a[1] * DEG_TO_RAD);
        m1[0] = cAng;   m1[2] = -sAng;
        m1[6] = sAng;  m1[8] = cAng;
        
        m = mat3mult(m, m1);
    }
    if (a[0]) {
        m1 = mat3Id();
        sAng = Math.sin(-a[0] * DEG_TO_RAD);
        cAng = Math.cos(-a[0] * DEG_TO_RAD);
        m1[4] = cAng;   m1[5] = sAng;
        m1[7] = -sAng;  m1[8] = cAng;
        
        m = mat3mult(m, m1);
    }
    return m;
}

function mat3Id() {
    var mat = [1, 0, 0,
               0, 1, 0,
               0, 0, 1];
    return mat;
}

function mat3mult(a, b) {
    var mat = [];
    mat.push(a[0] * b[0] + a[1] * b[3] + a[2] * b[6]);
    mat.push(a[0] * b[1] + a[1] * b[4] + a[2] * b[7]);
    mat.push(a[0] * b[2] + a[1] * b[5] + a[2] * b[8]);
    mat.push(a[3] * b[0] + a[4] * b[3] + a[5] * b[6]);
    mat.push(a[3] * b[1] + a[4] * b[4] + a[5] * b[7]);
    mat.push(a[3] * b[2] + a[4] * b[5] + a[5] * b[8]);
    mat.push(a[6] * b[0] + a[7] * b[3] + a[8] * b[6]);
    mat.push(a[6] * b[1] + a[7] * b[4] + a[8] * b[7]);
    mat.push(a[6] * b[2] + a[7] * b[5] + a[8] * b[8]);
    
    return mat;
}

function mat3vec3mult(m, v) {
    var outVec = [];
    outVec.push(m[0] * v[0] + m[1] * v[1] + m[2] * v[2]);
    outVec.push(m[3] * v[0] + m[4] * v[1] + m[5] * v[2]);
    outVec.push(m[6] * v[0] + m[7] * v[1] + m[8] * v[2]);
    
    return outVec;
}

function contains3c(a, c) {
    return a[0] == c || a[1] == c || a[2] == c;
}

function equals2i(a, b) {
    return (a[0] == b[0] && a[1] == b[1]) || (a[1] == b[0] && a[0] == b[1]);
}
