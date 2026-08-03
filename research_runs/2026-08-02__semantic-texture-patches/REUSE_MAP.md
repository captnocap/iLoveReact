# Phase 5 — Reuse Map

| Need | Canonical existing shape | Decision |
|---|---|---|
| Shared imported image library | `data/texturePackage.ts` | Reuse; do not create a parallel patch registry |
| Image import and visual form choice | `ImportImageDialog` + AppFrame import flow | Reuse unchanged |
| Immutable model source addressing | `uvTextureWorkspaceStore.installPngSource` | Reuse at the model compile boundary |
| Editable source layers | `UvTextureWorkspaceDoc` | Reuse unchanged |
| UV selection from 3D | `ModelFocusUv.selectedIslands/selectedFaces` | Reuse as patch-session scope |
| UV move/rotate/scale/stack | `UvEditor` + `uvLayout.ts` | Reuse unchanged |
| Runtime texture | compiled `atlases/base.png` | Reuse; no texture-slot split |
| Truly animated/object-projected material | `regionFormula` + model texture slots | Preserve as the procedural lane |
| Procedural source culling | one-file-per-material generator contract | Delete source files and regenerate; no registry hand edits |

Dependency-smuggling check: the new UV patch shelf imports `texturePackage` and calls the existing ModelFocus bridge. It does not import generated shader registry data, and the retained procedural lane does not become a dependency of patch placement.
