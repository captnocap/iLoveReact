# Phase 2 — Thesis

Current shape: one 410-entry procedural catalog is presented as the default texture library even for model skinning, while reusable imported image packages and the model's editable UV image workspace exist but are disconnected.

Target shape: imported image packages are first-class reusable texture patches in the UV editor; choosing one while a semantic part/faces are selected opens a focused UV-over-image placement session, and compiling still produces one model atlas. Procedural WGSL remains only for actual runtime-procedural consumers.

Thesis: **separate reusable image art from live procedural rendering, connect the existing image package directly to the existing UV workspace, and delete every procedural material without a verified runtime dependency.**

Done means:

1. An image imported once appears in the model UV patch shelf.
2. Selecting a part/faces and choosing that patch adds its exact image as an editable source, focuses only the chosen UV selection over that image, and retains move/rotate/scale/stack tools.
3. Returning to the whole model and compiling emits the same single runtime atlas/material path.
4. The generated shader catalog contains the 18 verified procedural dependencies, not 410 entries.
5. Ground, live-region, shader composition, UV workspace, and TypeScript checks pass.

What does not change: semantic face naming, mesh topology, saved UV corner identity, paint variants, the one-atlas runtime contract, stable shader ids, ground binding encoding, live animated region behavior, or interactive image import.
