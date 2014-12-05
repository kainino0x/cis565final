struct Tri {
    float4 a, b, c; // x y z _
};

kernel void fracture(
        // Fracture pattern planes: index these by tricells
        /*0*/              uint  planecount,
        /*1*/ global     float4 *planes,     // Nx Ny Nz d

        // Input mesh triangles (initially, one copy per cell)
        /*2*/              uint  tricount,
        /*3*/ global        int *tricells,
        /*4*/ global struct Tri *tris,

        // Output mesh triangles
        /*5*/ global        int *trioutcells, // len is tricount*2, -1 for nonexistent
        /*6*/ global struct Tri *triout,      // len is tricount*2

        // Output new vertices for new face
        /*7*/ global        int *newoutcells, // len is tricount, -1 for nonexistent
        /*8*/ global     float4 *newout       // len is tricount*2
        ) {
    uint index = get_global_id(0);
    if (index >= tricount) {
        return;
    }
    
    float4 _pla = planes[tricells[index]];
    if (_pla.x == 0 && _pla.y == 0 && _pla.z == 0) {
        // this cell doesn't have a plane on this iteration
        return;
    }
    float3 pN = _pla.xyz;
    float  pd = _pla.w;

    struct Tri tri = tris[index];

    // TODO: perform plane-triangle clip

    // TODO: output one or two triangles depending on the result
    //     * also output zero or two new points
}
