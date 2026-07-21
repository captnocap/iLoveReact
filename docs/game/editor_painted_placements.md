# Painted placements: which mesh a placed model renders

Active surface: `cart/editor/world/livePush.ts` (the one resident-mesh seam).
Last verified: 2026-07-21. USER ASK req_2832 / req_2833 / req_2930 /
req_3133 / req_3328 / req_3329.

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

## Collision follows the exact saved Outliner surfaces (req_2930 / req_3328 / req_3329)

`residentMeshFor` gives the full-resolution collision vertex form plus the
saved RJMD range table and `parts.json` rows to
`model/meshCollision.ts compileOutlinerCollision`. It bakes two views of the
same visible saved geometry:

- At most 24 local boxes remain the cheap whole-prop broadphase and camera
  bands. Visible Outliner ranges are hard roots; a bounded top-down spatial
  split spends spare rows where tighter child hulls help.
- Every finite triangle belonging to a visible saved Outliner range is packed
  as local-frame xyz into the resident MESH_PROPS v10 exact-collision tail.
  Multiple Outliner members share one payload, but hidden members contribute
  neither triangles nor boxes.

This closes the single-row failure behind req_3328: the old compiler opted out
when `doc.ranges.length < 2`, so most props shipped zero authored boxes and the
host correctly fell back to one connected-island AABB — the prop's widest and
tallest points became one invisible block. A one-row Outliner now receives the
same geometry-derived decomposition as a multi-row model. Flat faces receive a
4 cm downward skin so their visible top remains the walkable height.

Req_3329 proved boxes cannot be the final contact shape: even a box around one
sloped triangle fills its empty corner. On the pictured `tunnel_test` face that
put the box at z≈2.72 for the whole 6.34 m rise while the surface beside the
1.65 m player was near z≈3.62, creating roughly 0.9 m of invisible wall. The
host now tags the coarse boxes to bypass them only during player contact for a
v10 exact mesh; the spring-arm camera and dynamic bodies still consume those
bounded rows, and the same boxes gate the whole-prop broadphase. After ordinary
world physics, it transforms the player cylinder into the prop's local frame,
clips nearby static triangles to the player's vertical span,
and resolves side, walkable-top, and ceiling contact against those actual
clipped planes. Cheap triangle bounds reject distant faces before normal/contact
math. The triangles are decoded once with the resident asset and remain
immutable; the frame loop does not generate collision geometry.

The 24-box ceiling still bounds broadphase/camera data. Older MESH_PROPS versions
and semantic door exports have no exact payload and retain their established box
path. Doors intentionally keep authored jamb/header/leaf collision rather than
treating their movable leaf as a static triangle soup.

## Not yet covered

- Paint SKINS (`paints/paint_N.blob`) painted at decimated quality still
  cardinality-gate against the doc and leave the palette / skip placement
  (the existing loud warn). They would need per-skin stamps.
- Door exports never take the decimated path (`compileDoorMesh` needs doc
  topology) — save doors at full quality.
