# Painted placements: which mesh a placed model renders

Active surface: `cart/editor/world/livePush.ts` (the one resident-mesh seam).
Last verified: 2026-07-21. USER ASK req_2832 / req_2833 / req_2930 /
req_3133 / req_3328.

## In one sentence

A placed authored model renders the meshdoc's full-res geometry with the
painting's UVs rebound onto it — except when the painting was made on a
quality-DECIMATED display, in which case the painted decimated mesh IS the
exported look and renders as-is (collision still comes from the full-res doc).

## The three vertex sets (who owns what)

- `mesh/doc.blob` (RJMD) — the FULL-RES editable SOURCE. The quality slider
  never touches it (`framework/gpu/model_source.zig`: decimation is a
  displayed projection over a retained full-res source; scrubbing quality back
  up must resurrect detail). This is the document of record.
- `mesh/painted.blob` — the DISPLAYED mesh at last save (island-space UVs the
  atlas maps onto; `__model_painted_mesh_write`). At full quality its
  cardinality equals the doc's; at decimated quality it is smaller.
- `atlases/base.png` — the atlas. Pairing it with source UVs scrambles the
  painting (req_2833), hence painted.blob exists at all.

## The ambiguity and the stamp (req_3133)

When painted.blob's vertex count ≠ the doc's, it is EITHER stale paint (the
user edited geometry after painting — must drop, req_2832) OR the current
quality-decimated look (the user decimated to author the game asset — must
keep; dropping it placed a 25k-face unpainted nug). The two were
indistinguishable, so `writeModelArtifacts` (`data/modelPackageStore.ts`) now
stamps `mesh/painted.json` = `{docStamp: "<size>:<mtimeMs>" of doc.blob}` in
the same save that writes both blobs. `livePush.ts paintedFormIsCurrent`
compares the stamp against the doc on disk:

- **binds** (counts equal) → doc geometry + painting's UVs (unchanged path).
- **mismatch + stamp current** → the painted DECIMATED mesh is the render
  geometry (ground-rebased like every placeable); the full-res doc still owns
  Outliner collision bands (`residentMeshFor` collisionVertices).
- **mismatch + stamp absent/stale** → req_2832 rule: painting drops, doc
  renders flat. Packages saved before the stamp existed take this path until
  their next save.

## Collision follows the saved Outliner shape (req_2930 / req_3328)

`residentMeshFor` gives the full-resolution collision vertex form plus the
saved RJMD range table and `parts.json` rows to
`model/meshCollision.ts compileOutlinerCollisionBoxes`. Visible Outliner ranges
are hard boundaries. Inside each range, a bounded top-down spatial split spends
spare collider rows only where two child hulls materially fit the triangles
better (curves, arches, figures, rising surfaces). The result is baked into the
resident MESH_PROPS collision-box block; the host consumes those static boxes
verbatim. No geometry is generated in the frame loop.

This closes the single-row failure behind req_3328: the old compiler opted out
when `doc.ranges.length < 2`, so most props shipped zero authored boxes and the
host correctly fell back to one connected-island AABB — the prop's widest and
tallest points became one invisible block. A one-row Outliner now receives the
same geometry-derived decomposition as a multi-row model. Flat faces receive a
4 cm downward skin so their visible top remains the walkable height.

The per-mesh ceiling remains 24 boxes. Models with more than 24 Outliner ranges
coarsen nearby members of the same duplicate/group family locally; models below
the ceiling spend the remaining rows refining complex ranges. This is a bounded
box decomposition, not per-triangle mesh collision, but it removes the whole-
model rectangle while retaining the established fixed-cost physics contract.

## Not yet covered

- Paint SKINS (`paints/paint_N.blob`) painted at decimated quality still
  cardinality-gate against the doc and leave the palette / skip placement
  (the existing loud warn). They would need per-skin stamps.
- Door exports never take the decimated path (`compileDoorMesh` needs doc
  topology) — save doors at full quality.
