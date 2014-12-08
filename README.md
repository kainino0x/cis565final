CIS565: Final Project -- GPU-Accelerated Dynamic Real-Time Fracture in the Browser
===========
Fall 2014
-----------
Jiatong He, Kai Ninomiya
-----------

![](https://github.com/kainino0x/cis565final/blob/master/img/manyshatter.png)

Our goal was to create a gpu-accelerated interactive real-time mesh fracture application that runs in the browser.  We used WebCL to parallelize the algorithm and CubicVR to render and simulate the rigid bodies.

[Live demo](https://kainino0x.github.io/cis565final/src/):
requires the [Nokia WebCL plugin](http://webcl.nokiaresearch.com/) for Firefox.

>**Controls**
>
>`click + drag` : Rotate camera view
>
>`alt + click + drag` : Pan camera view
>
>`mouse scroll` : Zoom camera
>
>`click on object + drag` : Move selected object around
>
>`click + drag` : Rotate camera view
>
>`F + click on object` : Fracture object
>
>`W + click` : Toggle wireframe
>
>`D + click` : Toggle fracture pattern

_Based on
[Real Time Dynamic Fracture with Volumetric Approximate Convex Decompositions](https://www.graphics.rwth-aachen.de/media/teaching_files/mueller_siggraph12.pdf)
by Müller, Chentanez, and Kim._

##Table of Contents
* [Algorithm Overview](#algorithm-overview)
  * [Fracturing](#fracturing)
    * [Alignment](#alignment)
    * [Intersection](#intersection)
    * [Welding](#welding)
    * [Island Detection](#island-detection)
  * [Partial Fracture](#partial-fracture)
* [Implementation Details](#implementation-details)
  * [Fracturing](#fracturing-1)
    * [Intersection](#intersection-1)
    * [Stream Compaction](#stream-compaction)
    * [Partial Fracture](#partial-fracture-1)
  * [Working with WebCL](#working-with-webcl)
    * [WebCL Performance Issues](#webcl-performance-issues)
  * [Integration into an Existing Renderer/Rigid Body Simulator](#integration-into-an-existing-rendererrigid-body-simulator-cubicvr)
* [Performance Analysis](#performance-analysis)
  * [Fracture Performance](#fracture-performance)
    * [Intersection: GPU vs. CPU, Parallel vs. Sequential](#intersection-gpu-vs-cpu-parallel-vs-sequential)
  * [Stream Compaction](#stream-compaction-1)
    * [Parallel vs. Sequential](#parallel-vs-sequential)
  * [WebCL Performance](#webcl-performance)
    * [Kernel Execution](#kernel-execution)
    * [Setting Arguments](#setting-arguments)
    * [Reading/Writing Data from/to Processing Unit](#readingwriting-data-fromto-processing-unit)
  * [CubicVR's Limits in Real-Time Simulation](#cubicvrs-limits-in-real-time-simulation)

##Algorithm Overview
###Fracturing
At a high level, fracturing is implemented by performing boolean intersection
between segments of a fracture pattern and the segments of the object to be
fractured.  The fracture pattern can be pre-generated, as is the case for our implementation.

![](https://github.com/kainino0x/cis565final/blob/master/img/cubepattern.png)

_A pre-generated test fracture pattern (series of solid meshes):_

####Alignment
The first step is to align the fracture pattern with the point of impact.

![](https://github.com/kainino0x/cis565final/blob/master/img/cutout.png)

_The wireframe is the impacted mesh, the solid is the fracture pattern_

We use the point the user clicks on the object as the point of impact, and transform the fracture mesh appropriately (all meshes are centered at 0,0,0).

####Intersection
The mesh must then be intersected with the fracture mesh, resulting in one shard per cell of the fracture pattern.  A simple way to do this is to clip the mesh against each face of the cell, for each cell in the fracture pattern.

![](https://github.com/kainino0x/cis565final/blob/master/img/cubepatternsolid.png)

_A solid render of the 3D fracture pattern we are using_

####Welding*
If a shard completely fills a cell, then it can be replaced with the cell's geometry.  This reduces the number of triangles produced by the intersection.

####Island Detection*
If a clipping cell results in disconnected pieces within a cell, island detection should be used to split those pieces into multiple shards, instead of just one.  That way you won't have disconnected pieces moving together as though they were one mesh.

###Partial Fracture
Partial fracture occurs if we limit the area of effect of the fracture to some distance around the point of impact.

![](https://github.com/kainino0x/cis565final/blob/master/img/wallshatter.png)

_Notice how the bottom and right sides of the wall stay intact while the upper-left is fractured_

Rather than allowing the entire mesh to be fractured, we only fully shard the cells within the area of effect.  Shards in cells outside of the area of effect can be merged together back into a single mesh.

_\* : not implemented._

##Implementation Details
![](https://github.com/kainino0x/cis565final/blob/master/img/donutshatter.png)

_A fractured torus_

###Fracturing
The fracturing algorithm was our greatest challenge.  It's an algorithm that is naturally sequential--clipping polygons usually requires some knowledge of neighbors and other information.  However, we devised a method that succesfully targets independent pieces of the algorithm at the cost of some accuracy.
####Intersection
Our intersection algorithm is simple clipping planes.  For each cell, the mesh is clipped by each cell face to give us the shard.  What's interesting is how we parallelized it.
#####Parallelization
Our strategy for the parallelization of the intersection was to treat the mesh as a set of disconnected triangles.  By doing so, we could parallelize by-cell-by-triangle.

![](https://github.com/kainino0x/cis565final/blob/master/img/parallelalg.png)

_Diagram of the parallel algorithm we used to clip meshes_

For each face of the cell, we clip each triangle in the mesh by that face independently, then create the new faces for them.  We can process all cells at once, and iterate a total number of times equal to the maximum number of faces in a single cell.

####Stream Compaction
Our implementation uses stream compaction to remove culled triangles each iteration in order to keep the number of triangles under control (otherwise it could grow at a rate of 2^n).  We tried both a sequential and a parallel version of this algorithm to see which one was better.  The sequential implementation simply iterates through the list and pushes non-culled objects into a new array.
#####Parallelization
The reason we wanted to do stream compaction on the GPU was to reduce the amount of memory transfer between CPU and GPU.  Each time our plane clipping kernel returned, we would need to copy the entire output back onto the CPU, remove bad values, add new faces, and put everything back into the GPU.  If stream compaction were parallelized, we would not have that problem.

We implemented stream compaction in WebCL, but ran into some performance issues that made it much slower than the copy+process on CPU method.  As a result, we abandoned the stream compaction and are now removing bad values sequentially.  The performance analysis section furhter below contains more details about this issue.

####Partial Fracture
This feature is noteworthy because we technically cheated this one.  Instead of properly combining faces, or doing some processing, we just group all the fragments that are not in the area of effect into a single mesh.  This means that said mesh will have: 1, several times more geometry than other fragments, 2, faces inside of the mesh, and 3, slightly overlapping/disconnected edges on the surface.

![](https://github.com/kainino0x/cis565final/blob/master/img/wallwireframe.png)

_The body on the upper-left is the merged mesh.  See how its individual components are clearly visible in the wireframe?_

###Working with WebCL
Because our target was an in-browser experience, we were limited to two choices for GPU-acceleration:  WebGL and WebCL.  While WebGL runs natively in most browsers, it does not yet support compute shaders as of this time, so we would have had to hack a solution using textures and feedbacks.  WebCL, on the other hand, is supported by **no** browsers, but Nokia has a plugin that can run it.  We chose to use WebCL for its flexibility compared to WebGL.
####WebCL Performance Issues
We did, however, run into some performance issues with WebCL that were severe enough that a GPU stream compaction was slower than a sequential javascript method.  You can see a comparison between the two in the Performance Analysis section.  In addition, we logged the runtimes of individual set args, read/write, and kernel calls to show how slow it actually is.

###Integration into an Existing Renderer/Rigid Body Simulator (CubicVR)
Because our main focus was creating the fractured geometry, we looked for an existing renderer and rigid body simulator.  CubicVR (physics built on ammo.js, which is compiled from bullet) provides a very simple-to-use library for both, though we ran into some issues here as well.  The performance issues we had with usingCubicVR are detailed in the Performance Analysis section of the readme.


##Performance Analysis
###Fracture Performance
####Intersection: GPU vs. CPU, Parallel vs. Sequential

###Stream Compaction
####Parallel vs. Sequential

###WebCL Performance
####Kernel Execution
####Setting Arguments
####Reading/Writing Data from/to Processing Unit

###CubicVR's Limits in Real-Time Simulation
