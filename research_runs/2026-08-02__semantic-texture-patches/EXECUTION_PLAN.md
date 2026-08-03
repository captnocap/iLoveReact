# Phase 6 — Execution Plan

1. Add failing tests for resolving exact-image package files and excluding pixel-only packages from the UV patch shelf.
2. Add the small `texturePackage` query/resolver API and make those tests pass.
3. Add a UV patch shelf to `UvEditor` using the canonical package API; each card shows the exact image and dimensions.
4. Route a patch card through the existing `addUvTextureLayer` bridge at the selected UV bounds; refuse clearly when no selected islands exist.
5. Add preview-only patch focus: show the chosen image plus selected UV islands, fit them in view, and expose a one-click return to the whole atlas.
6. Put imported image specs before procedural groups in shared paint browsers and rename user-facing “shader” search/copy where it describes the general material library.
7. Delete the 392 non-required `.wgsl` files, retaining the verified 18-function closure; regenerate registry and dispatch while preserving `ids.json`.
8. Add a catalog-severance test asserting exactly the retained functions and validating ground/live-region required names.
9. Run focused texture-package, UV workspace, shader composition/ground, seat/UV layout, and TypeScript checks.
10. Cold-reload the open Moped_50, select a semantic part, apply the existing exact-image package, place its UVs, compile, and ask the user to verify the 3D result and the focused/whole-atlas transition.

Integrity checks: every step changes one concern; each has an observable result; no step says “wire up” without naming both boundaries; deletion occurs only after the replacement interaction exists; rollback is per step; generated artifacts are regenerated, never edited; model data is never committed.
