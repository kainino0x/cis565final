CIS565: Final Project -- GPU-Accelerated Dynamic Real-Time Fracture in the Browser
===========
Fall 2014
-----------
Jiatong He, Kai Ninomiya
-----------

[IMAGE_1]()

[Live demo](https://kainino0x.github.io/cis565final/src/):
requires the [Nokia WebCL plugin](http://webcl.nokiaresearch.com/) for Firefox.

Based on
[Real Time Dynamic Fracture with Volumetric Approximate Convex Decompositions](https://www.graphics.rwth-aachen.de/media/teaching_files/mueller_siggraph12.pdf)
by Müller, Chentanez, and Kim.

Algorithm Overview
-----------------
###Fracturing
At a high level, fracturing is implemented by performing boolean intersection
between segments of a fracture pattern and the segments of the object to be
fractured. More information on the method is found in Mueller's paper (above).

A pre-generated test fracture pattern (series of solid meshes):

![](img/fracturepattern.png)
^REPLACE WITH NEW IMAGE
####Alignment
#####Paralelization


####Intersection
#####Paralelization

####Welding

####Island Detection

####Stream Compaction

###Partial Fracture

###Integration into an Existing Renderer/Rigid Body Simulator (CubicVR)
####Advantages

####Problems with CubicVR & Ammo.js

---------------------------------------------------

##Paralelization of the Intersection Algorithm
The goal of this algorithm was to find a method to clip meshes that had the least amount of dependence between units.  With this in mind, we came up with the following:

Our code now parallelizes on a per-clipping-face-per-mesh-triangle level.  We run one clipping plane per cell on each triangle in the mesh per loop iteration, iterating through the list of clipping planes per cell.

One key feature is that we no longer handle the mesh as a whole (we still keep track), but as a set of unrelated triangles.  We take this triangle "soup" and run it through the algorithm, getting new triangles with each iteration.  These triangles can be connected by merging identical points at the end of the algorithm if a closed mesh is desired, but disconnected triangles works for our purposes.

The loop runs for max(#cellfaces) iterations.  The kernel processes a triangle-clipping plane pair with a cell number attached to it, and returns a list of triangles and a list of new points.  We take this list and generate a set of new triangles to add to the list, and reiterate.

###Concave Plane Intersections
How to handle?  Centroid connection does not work!

##Stream Compaction
In order to reduce gpu-cpu memory transfer.

##Island Detection
Low priority, necessary both before and after partial fracture.  If implemented, then partial fracture needs to be in its own kernel or loop.

##Partial Fracture
###Algorithm:
* label each cell as "affected" or "not affected"
* after the intersection algorithm runs, combine all "not affected" fracture pieces into a single mesh (for our purposes, put them all into a single cell)
* (optional) perform island detection on that mesh
