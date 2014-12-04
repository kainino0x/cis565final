struct Tri {
    float4 a, b, c; // x y z _
};

kernel void fracture(
        // Input mesh triangles
        /*0*/              uint  tricount,
        /*1*/ global struct Tri *tris,

        // Fracture pattern planes
        /*2*/              uint  planecount,
        /*3*/ global     float4 *planes,     // Nx Ny Nz d
        //    ^ TODO: can this be constant instead of global?

        // Output mesh triangles
        /*4*/ global       uint *triexist,   // len is tricount*2
        /*5*/ global struct Tri *triout,     // len is tricount*2

        // Output new vertices for new face
        /*6*/ global       uint *newexist,   // len is tricount
        /*7*/ global     float4 *newout      // len is tricount*2
        ) {
    uint i_tri = get_global_id(0);
    uint i_pla = get_global_id(1);
    if (i_tri >= tricount || i_pla >= planecount) {
        return;
    }

    struct Tri tri = tris[i_tri];
    float4 pla = planes[i_pla];
    float3 pN = pla.xyz;
    float pd = pla.w;

    // TODO: perform plane-triangle clip

    // TODO: output one or two triangles depending on the result
}
