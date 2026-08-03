# Phase 4 — High-fragility decomposition

## `texturePackage.ts`

- Parsing/loading remains unchanged.
- Add one pure resolver that returns the exact-image file path for a manifest.
- Add one filtered loader for exact-image packages usable as UV patches.
- Unit-test malformed/missing source handling separately from UI.

## `UvEditor`

- `patch catalog`: read the canonical texture packages and render image cards.
- `apply patch`: require selected islands, call the existing bridge with the package source path at the selection origin.
- `focus session`: track focused patch layer id, hide unrelated layers and UV islands only in the preview, and fit the view to the patch/selection union.
- `exit focus`: clear the preview filter without mutating layers or UVs.
- Existing image layer editing and compile functions remain the mutation boundary.

## Shader severance

- Build a verified keep set from exact direct references plus transitive calls.
- Delete every other independent `.wgsl` source.
- Run the existing generator; do not hand-edit registry/dispatch/ids.
- Assert material count and names in a focused test so catalog regrowth is explicit.
- Preserve `ids.json` tombstones so old numeric ids never shift.

No new global texture catalog, compositor, image decoder, UV transform engine, or runtime material slot is introduced.
