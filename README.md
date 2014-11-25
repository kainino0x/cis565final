CIS565: Final Project -- Dynamic Real-Time Fracture in the Browser
===========
Fall 2014
-----------
Jiatong He, Kai Ninomiya
-----------
https://www.graphics.rwth-aachen.de/media/teaching_files/mueller_siggraph12.pdf

Algorithm Overview
-----------------
###Fracturing
At a high level, fracturing is implemented by performing boolean intersection
between segments of a fracture pattern and the segments of the object to be
fractured. More information on the method is found in Mueller's paper (above).

A pre-generated test fracture pattern (series of solid meshes):

![](img/fracturepattern.png)

##Checklist
####Part 1
* Set up codebase (Turbulenz?)
* Get a working rigid body simulator
* Integrate simple webCL (eg. shift mesh's colors)
* Generate some 3D Voronoi decomposition
* Find and highlight intersections with simple mesh (eg glass panel)

##Progress
###Part 1
####Setting up the codebase
We initially began with Turbulenz, since it seemed like the most powerful engine available and combined the rigid body physics we needed with a renderer.  However, it was difficult to work with the convex hulls we wanted, so we switched to CubicVR.js, an open-source 3d engine that uses ammo.js for physics.

Depending our future experience with CubicVR/Ammo, it's possible we'll switch
back (or to yet another engine).

####Working Rigid Body Simulator
This was very easy to set up with CubicVR/Ammo (using one of the CubicVR
provided examples), and was completed quickly.

####WebCL
Currently not implemented due to our focus on getting a working engine and demo

####3D Voronoi Decomposition as fracture pattern
This one turned out to be a little tricky because we didn't find a javascript implementation of 3d voronoi decomposition.  We plan on making a library for it later, but for testing, we are using a voronoi decomposition made from Blender.  Blender has the ability to generate a voronoi decomposition from a set of points, which is good enough for us to use as a constant, pregenerated fracture pattern.  This is saved to a .dae file and read in as a set of meshes (cells).

####Intersection Testing
Intersection testing was difficult to solve because we were somewhat limited by the structures available to us through the CubicVR engine.  We spent some time figuring out the method to handle the cell-mesh intersections, which was more difficult than expected due to some limits in the libraries we used.

The most significant one is that Bullet's btConvexHullComputer, which computes a convex hull mesh based on a set of points, seems to be unavailable in ammo.js.  This means that we need to calculate our own convex hull mesh, or work entirely in convex hulls, which will result in some necessary approximations on the geometry.

In order to move forward, we plan to use Bullet's btConvexHullShape to create a convex hull based on our set of points, and use the provided data/methods for computing the fractures (as the hull faces are unavailable).  The edges allow us to estimate wireframes of the meshes, but not compute the faces directly.

##Debug images

The set of points on the convex hull of the original object:

![](img/hullpoints.png)

The set of edges returned by the Bullet btConvexHullShape object (not useful!):

![](img/hulledges.png)
