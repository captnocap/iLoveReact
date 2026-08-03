# Phase 7 — Severance Build

## Replacement landed

- `texturePackage.ts` now exposes exact-image packages as reusable UV patches without creating a second catalog.
- `UvEditor` presents those patches, requires a selected part/UV set, installs the chosen source through the existing content-hashed layer path, and enters a preview-only patch focus.
- Patch focus renders only the chosen image and selected UV islands; `SHOW ALL` returns to the complete atlas without changing UV or layer data.
- Imported image materials are ordered before procedural recipes in shared paint browsers.

## Legacy removed

- 392 of 410 procedural material source files were deleted.
- 18 remain because code, a stable ShaderSpec default, saved model data, or a runtime material path depends on them.
- Generated registry size fell from 1,290 to 114 lines; dispatch fell from 15,853 to 962 lines.
- Append-only `_generated/ids.json` was not pruned or renumbered.
- Pruning exposed and fixed a stable-id hole bug: `fillSpec` had treated the compact board-array index as `materialId`. It now resolves the registry row by `(board, slug)` before building GPU data.

## Automated evidence

- Procedural catalog: 18 retained, stable sentinel ids.
- Ground/shader composition: 10 passed.
- Texture package patches: 3 passed.
- UV image workspace: 7 passed.
- Editor bundle/type-resolution check: passed.
- `git diff --check`: passed for the owned scope.

No model package or paint data is part of this change. Visual interaction remains for the user to verify in the live editor, per repository policy.
