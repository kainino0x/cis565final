<script id="clProgramIntersect" type="text/x-opencl">
// Takes in a converted mesh (ideally these converted values are calculated in parallel)

//beginning with a naive implementation for TRIANGULATED MESHES.
// Triangular meshes give us constant-
// NOTE: This algorithm was made to be able to handle other types of meshes, so it should
//  be optimizable for triangles.

/* Input:
   1. Plane Equation (d, xyz)
   2. Plane Normal (xyz) or Voronoi Point (xyz)
   3. Point: culled (int),
             x, y, z (float3).
   4. Edge: culled/state (int),
            int indexA, indexB.
   5. Face: culled, int edgeIndexA, edgeIndexB, edgeIndexC.
   
   Required Data
   1. 
*/

  kernel void clIntersect(global const uchar4* src,
                           global uchar4* dst,
                           uint width, 
                           uint height)
  {
    int x = get_global_id(0);
    int y = get_global_id(1);
    if (x >= width || y >= height) return;

    int i = y * width + x;

    uchar4 color = src[i];
    uchar lum = (uchar)(0.30f * color.x + 0.59f * color.y + 0.11f * color.z);
    dst[i] = (uchar4)(lum, lum, lum, 255);
  }
</script>