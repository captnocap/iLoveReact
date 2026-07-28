# Painted placements: which mesh a placed model renders

Active surface: `cart/editor/world/livePush.ts` (the one resident-mesh seam).
Last verified: 2026-07-27. USER ASK req_2832 / req_2833 / req_2930 /
req_3133 / req_3328 / req_3329 / req_3362 / req_3439.

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

## Cold-restart UV state (req_3362)

`atlases/base.paint.json` v4 is the editable UV document paired with the raster
baseline. `__model_atlas_read` publishes every render face as
`[island, authoredGroup, x0, y0, x1, y1, x2, y2]`; Save strips the envelope and
writes the six exact absolute-atlas corner coordinates per face as `cornerUv`.
Cold ModelView hydration imports `raster-base.png`, applies that complete table
through unjournaled `__model_uv_geometry_apply`, then replays any paint program.

The preceding v2/v3 format stored only `[x,y,w,h]` per island. Those rectangles
remain readable for old packages, but they are transform bounds rather than UV
geometry: they cannot reproduce a rotated island, a detached cylinder wedge, or
one moved vertex. New saves therefore emit v4 whenever the host's complete
triangle table is present.

## Paint variants are full LOOKS (req_3439)

A saved paint variant (`paints/paint_N.json`) carries the same v4 triple as the
base painting, so one mesh stores many looks without duplicating the model: the
exact `cornerUv` table, `rasterBase: true`, and the stroke program (which may be
EMPTY — an imported texture atlas mapped over the mesh is a saveable look with
zero brush strokes; the old panel refused to save exactly that case). With
strokes, the baseline beneath them persists as `paints/paint_N.base.png`; with
none, the composite `paint_N.png` doubles as the raster base (no second
multi-MB raster). Loading goes through the viewer bridge
(`ModelFocusBridge.loadPaintVariant`) into the SAME hydration engine as cold
load (`model/paintHydration.ts`): set detail, import the variant's own raster
base, apply its cornerUv, replay strokes over that base — so importing a new
atlas or remapping UVs only changes the LIVE look; every saved variant reloads
its own texture + UV layout intact. `listPaintVariants` strips a look claim
whose raster file is missing on disk, and hydration fails loudly rather than
half-restoring. Legacy program/atlas variants keep their historical replay
paths. Placement is unchanged: skins still require `paint_N.png` +
`paint_N.blob` (atlas-only looks now produce both, so they place too).

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

## The package carries its own bake: mesh/collision.blob (req_3431)

FLOCKBOOK_DESIGN §10's quick win: every exported model persists its collision
bake INSIDE its package. `modelPackageStore.ts writePackageCollision` runs the
same `compileOutlinerCollision` over the ground-rebased doc vertices and writes
`mesh/collision.blob` (RJCB v1, codec in `model/meshCollision.ts`): the
placeable-frame box tree + exact player triangles, header-stamped with the doc
revision (`"<size>:<mtimeMs>"` of doc.blob, `legacy:`-prefixed off base.blob for
pre-meshdoc packages). Every save path lands it (`writeModelArtifacts`, both
branches, including paint-only saves which self-heal a missing/stale blob), and
the GLB/OBJ import flow bakes at arrival (`materializePackageArtifacts`). The
write is stamp-gated idempotent; a package with no durable JS-readable geometry
(file-backed .glb/.obj viewerPath models) sheds any stale blob instead.

`residentMeshFor` deliberately KEEPS baking live from its rendered vertex form:
the surface that stops the player must be the surface being drawn, and the live
push can render an in-session export capture that predates/postdates disk. The
persisted record is the package's durable declaration for consumers reading the
folder without the editor running (asset cook, other machines, future host
loaders) — when disk is current it is bit-identical to the live bake by
construction (same inputs, same compile).

## Not yet covered

- Paint SKINS (`paints/paint_N.blob`) painted at decimated quality still
  cardinality-gate against the doc and leave the palette / skip placement
  (the existing loud warn). They would need per-skin stamps.
- Door exports never take the decimated path (`compileDoorMesh` needs doc
  topology) — save doors at full quality.
