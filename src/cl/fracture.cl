struct Tri {
    float4 a, b, c; // x y z _
};

kernel void copyPerPlane(
        /*0*/                uint  planecount,
        /*1*/                uint  tricount,
        /*2*/ constant        int *tricells,
        /*3*/ constant struct Tri *tris,
        /*4*/ global          int *trioutcells,
        /*5*/ global   struct Tri *triout
        ) {
}

kernel void fracture(
        // Fracture pattern planes: index these by tricells
        /*0*/                uint  planecount,
        /*1*/ constant     float4 *planes,     // Nx Ny Nz d

        // Input mesh triangles (initially, one copy per cell)
        /*2*/                uint  tricount,
        /*3*/ constant        int *tricells,
        /*4*/ constant struct Tri *tris,

        // Output mesh triangles
        /*5*/ global          int *trioutcells, // len is tricount*2, -1 for nonexistent
        /*6*/ global   struct Tri *triout,      // len is tricount*2

        // Output new vertices for new face
        /*7*/ global          int *newoutcells, // len is tricount, -1 for nonexistent
        /*8*/ global       float4 *newout       // len is tricount*2
        ) {
    uint index = get_global_id(0);
    if (index >= tricount) {
        return;
    }
    
    int cell = tricells[index];
    float4 _pla = planes[cell];
    if (_pla.x == 0 && _pla.y == 0 && _pla.z == 0) {
        // this cell doesn't have a plane on this iteration; do nothing
        trioutcells[2 * index] = cell;
        triout[2 * index] = tris[index];
        trioutcells[2 * index + 1] = -1;
        newoutcells[index] = -1;
        return;
    }
    float4 pN = {_pla.xyz, 0};
    float  pd = _pla.w;
    float4 pP = {0, 0, -pd / pN.z, 0};  // Arbitrarily calculate a point on the plane (z-axis intersection)

    struct Tri tri = tris[index];

    // TODO: perform plane-triangle clip
    bool cull1, cull2, cull3, tempb;
    bool winding = true;    // keeps track of whether or not the winding is still consistent.
    cull1 = dot(pN, tri.a - pP) < 0;
    cull2 = dot(pN, tri.b - pP) < 0;
    cull3 = dot(pN, tri.c - pP) < 0;
    
    float4 p1 = tri.a;
    float4 p2 = tri.b;
    float4 p3 = tri.c;
    // sort the points from culled to not culled.
    if (!cull1) {   // if cull1 is false, swap 1 and 3 (order 321)
        // is this faster than putting if-else?  if (cull3){...} else if (cull2){...}
        cull1 = cull3;
        cull3 = false;
        p1 = tri.c;
        p2 = tri.b;
        p3 = tri.a;
        
        winding = false;
        
        if (!cull1) {   // if it's still false, swap 1 and 2 (final order 231)
            cull1 = cull2;
            cull2 = false;
            p1 = tri.b;
            p2 = tri.c;
            
            winding = true;
        }
    } else if (!cull2) {
        cull2 = cull3;
        cull3 = false;
        
        p1 = tri.a;
        p2 = tri.c;
        p3 = tri.b;
        
        winding = false;
    }
    
    // note that it's configured to output only the original triangle by default.
    struct Tri newTri1, newTri2;
    newTri1 = tri;                  // current triangle.
    int cell1 = cell;               // cell of the current face.
    int cell2 = -1;                 // cell of the new face.
    int cellP = -1;                 // cell of the new points (for newoutcells).
    float4 newP1, newP2;            // new points.
    
    if (cull3) {  // if all 3 points are culled, do nothing.  Output is -1
        // set cell1 to -1.
        cell1 = -1;
    } else if (!cull1) { // if all 3 points are not culled, add to output normally.
        // do nothing.
    } else if (!cull2) { // XOR: if only one point is culled (p1), needs new face, add both to output
        // calculate new edge p1-p2
        float4 v = normalize(p1 - p2);
        newP1 = p2 + v * -(dot(p2, pN) + pd) / dot(v, pN);
        
        // calculate new edge p1-p3
        v = normalize(p1 - p3);
        newP2 = p3 + v * -(dot(p3, pN) + pd) / dot(v, pN);
        
        newTri1.a = newTri2.a = p2;
        if (winding) {
            newTri1.b = newP2;
            newTri1.c = newP1;
            newTri2.b = p3;
            newTri2.c = newP2;
        } else {
            newTri1.b = newP1;
            newTri1.c = newP2;
            newTri2.b = newP2;
            newTri2.c = p3;
        }
        
        // Both new faces and new points
        cell2 = cellP = cell;
    } else {             // two points culled (p1, p2), modify current face and add to output
        // calculate new edge p2 - p3
        float4 v = normalize(p2 - p3);
        newP1 = p3 + v * -(dot(p3, pN) + pd) / dot(v, pN);
        
        // calculate new edge p1-p3
        v = normalize(p1 - p3);
        newP2 = p3 + v * -(dot(p3, pN) + pd) / dot(v, pN);
        
        // set new points
        newTri1.a = newP1;
        if (winding) {
            newTri1.b = p3;
            newTri1.c = newP2;
        } else {
            newTri1.b = newP2;
            newTri1.c = p3;
        }
        
        // just new points.
        cellP = cell;
    }

    // output triangles.
    trioutcells[2 * index] = cell1;
    triout[2 * index] = newTri1;
    trioutcells[2 * index + 1] = cell2;
    triout[2 * index + 1] = newTri2;
    
    // output new points (for later triangulation).
    newoutcells[index] = cellP;
    if (winding) {
        newout[2 * index] = newP1;
        newout[2 * index + 1] = newP2;
    } else {
        newout[2 * index] = newP2;
        newout[2 * index + 1] = newP1;
    }
    
    /*
    // the following should do nothing.
    trioutcells[2 * index] = cell;
    triout[2 * index] = tris[index];
    trioutcells[2 * index + 1] = -1;
    newoutcells[index] = -1;
    */
}
