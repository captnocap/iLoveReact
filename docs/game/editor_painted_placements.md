# Painted placements: which mesh a placed model renders

Active surface: `cart/editor/world/livePush.ts` (the one resident-mesh seam).
Last verified: 2026-07-29. USER ASK req_2832 / req_2833 / req_2930 /
req_3133 / req_3328 / req_3329 / req_3362 / req_3439 / req_3443 / req_3450 /
req_3515 / req_3520 / req_3524 / req_3525 / req_3526 / req_3527 / req_3528 /
req_3529.

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

`atlases/base.paint.json` v4 is the editable finite-atlas UV document paired with the raster
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

## Identity stitch + transparent UV guide (req_3515)

`__model_atlas_read` also publishes `cornerVertices`: the welded 3D/model
vertex identity behind each UV face corner. The UV panel already uses those
ids for its colored corner markers; `model/uvLayout.ts stitchUvIslands` now
uses the same truth for a one-click seam operation. Shift-select two or more
UV islands and make the intended anchor the white active island, then use the
direct RMB row `Stitch Matching Seams`. It shows the island count the editor
currently sees and enables at two or more, so selection-state problems cannot
hide the action. Stitch deliberately does not occupy the persistent UV
toolbar: that scarce surface is reserved for the editor's highest-frequency
actions. The active island never moves. The operation cancels internal
triangle/connected-face
edges to recover each UV boundary, matches welded topology edges first and an
unambiguous shared boundary vertex second, then walks the whole selected
connected component. Each moving island gets a handed similarity fit and its
matching seam endpoints land exactly on the anchor copies, so
`__model_uv_geometry_apply` can reconstruct the joined island. Unrelated
selected pieces stay put; the signed workspace may place the result beyond the
current image instead of refusing an otherwise valid seam. The
whole sweep is one `stitch UV seams` journal entry.

The sweep is indexed, not pairwise (req_3519). Boundary topology is built once
per selected island, model-edge and model-vertex owner tables admit only the
two-owner relationships that are unambiguous, and a priority heap evaluates
each reachable island pair once. This replaces the old repeated
remaining-islands × fixed-islands rescans that could grow cubically after
`Uniform Pack All Islands` → `Collect Same Orientation` and freeze the editor
on a dense torso. A 6,831-island connected-chain regression pins the linear
candidate bound; a many-island pole is refused instead of becoming a dense
automatic stitch graph.

`WIRE PNG` (also RMB → Texture Atlas → Export Transparent Wireframe) writes
`atlases/uv-wireframe.png` at the live atlas dimensions and copies its absolute
path. It is a derived image-generation guide: alpha remains zero everywhere
except neutral black antialiased lines, island boundaries are heavier, and the
edge source is the authored UV view, so a resident triangle diagonal hidden by
an authored quad stays absent from the export. Encoding uses the existing
image codec and an atomic binary write. The guide is not loaded as texture
state and can always be regenerated from `cornerUv`.

## Infinite UV + image workspace (req_3524/req_3525)

The atlas rectangle is no longer a movement wall. Whole islands, linked
multi-island selections, isolated faces, individual vertices, rotation, scale,
paste-transform, stitch, and signed X/Y entry all retain coordinates before
zero or beyond the current texture dimensions. The Zig boundary accepts the
same finite signed corner table and `paint_islands.buildFromNormalizedUv`
retains exact out-of-range corners while clamping only its u32 paint-clipping
metadata. This closes the old false preview where a drag could appear outside
and then be rejected on commit.

The UV surface draws a checkerboard and visible-grid slice across the entire
pannable workspace, including negative coordinates. In the 3D scene, a third
diffuse bind-group flag distinguishes a finite model atlas from an ordinary
material texture: finite-atlas UVs outside `[0,1]` contribute zero alpha and
discard, while StaticSurface/paintable material textures retain their existing
sampling semantics. Ordinary texture import still forces incoming alpha opaque per
req_3450; transparent empty space belongs only to this explicit workspace
compile path.

`atlases/uv-workspace.json` is the editable document. Its ordered layers store
signed integer X/Y, immutable native dimensions, visibility, and a strict
package-relative content address under
`atlases/uv-sources/<sha256>.png`. `Add Image` snapshots the current
paint raster baseline once as the bottom source, losslessly normalizes each later import
to its own content-addressed PNG, and never deletes originals when a row is
removed. `IMAGES` mode draws those sources directly and supports canvas drag,
signed numeric placement, visibility, ordering, and removal. No layer scale is
offered in this slice: every compile therefore retains one source pixel as one
atlas pixel.

UV and image placement are two gesture owners over the same visible source
stack (req_3526–3528). `UV` mode keeps every visible workspace image drawn
under the UV graph while reserving all primary drags for UV selection and
transforms. `IMAGES` mode lets only the top unlocked image under the pointer
own an image drag; empty space and a locked image fall through to the same UV
hit-test path instead of becoming an invisible canvas-wide shield. Each layer
has a persisted lock button. A lock blocks canvas and numeric image movement
but does not hide the source, remove it from Compile, increment the texture
revision, or mark a current compile stale.

Ctrl+primary-drag claims an area-selection gesture before either UV transforms
or image movement (req_3529), so it works in both surface modes and may begin
directly over a UV or unlocked image. After the shared four-pixel drag latch,
the editor draws a cyan marquee and, on release, selects every island whose
actual authored triangle silhouette intersects the signed-workspace box.
Triangle-backed islands never select through empty bounding-box space; only
legacy rows without triangles use their rectangle as a fallback. Ctrl replaces
the island set, while Ctrl+Shift extends it and preserves the active island when
that island remains inside the result. Selection is not a UV history edit. The
complete result crosses the bridge as one typed island array, producing one
native face mask and one 3D highlight pass even for a dense torso.

`Compile` is explicit and shows progress while reading sources and composing.
It takes the smallest integer union of visible images, leaves uncovered and
source-transparent pixels alpha-zero, and composites bottom-to-top without
resampling. The manifest records the compiled finite atlas's signed origin.
Native apply translates local UVs by `oldOrigin - newOrigin`, so cropping or
later expanding the image union never moves a UV in workspace coordinates.
Every compile reconstructs that image baseline and preserves/replays the
editable paint program over it, so strokes made before or after adding a layer
are not double-applied or dropped.
`base.png`, painted mesh artifacts, and the workspace origin commit after a
successful live apply; layer edits only mark the compile stale, so more images
can always be added before another explicit compile.

## Paint variants are full LOOKS (req_3439)

A compatible self-contained GLB now arrives with its original base-colour look
already live (req_3530). `mesh_import.zig` accepts that shortcut only when every
rendered triangle has `TEXCOORD_0`, every primitive resolves to the same embedded
base-colour image and common colour factor, the UVs stay inside the finite image,
and no vertex-colour, alternate coordinate set, or texture-transform contract
would be lost. Mixed-material, untextured, externally referenced, transformed,
or repeating-UV files still import their geometry normally and make no texture
claim. The host rejects encoded images above the painter's 8192-pixel/256 MiB
limits before decode, adopts image alpha as opaque under the existing import
rule, restores the GLB's exact source UV corners, and stashes that final active
mesh rather than the pre-layout parser copy. Those source corners are
snapshotted after winding repair but before `setPaintTarget` mutates the parser
buffer's UV lanes (req_3537); only after face grouping and paint-layout setup
does the host apply the owned image/corner pair. Generated paint-atlas UVs can
therefore never be mistaken for the embedded image's `TEXCOORD_0` mapping.

For a newly materialized model, `ModelView` skips the fallback Outliner-colour
flood, persists the live source look as the package base, and automatically adds
an `Imported Texture` full-look variant. The variant records a model-content
hash plus glTF image index, so reopening the same file never duplicates it. An
existing authored base remains the displayed/current look while the pristine
source texture is added only as a variant. Save-back strips the import provenance
because that row is no longer the untouched original; a later reopen can capture
the source again instead of falsely treating the edited row as its backup.
Imported-texture provenance also carries the UV-adoption version. The first
post-req_3530 records had no version and therefore identify the known-bad v1
ordering; the next source load refreshes that untouched generated variant in
place with v2 source UVs. Since any user Save-back already removed provenance,
this repair cannot overwrite an authored variant or the package's established
base look.

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
paths. Skins still require `paint_N.png` + `paint_N.blob` on disk (atlas-only
looks now produce both, so they place too). Variants rename in place
(req_3448, `renamePaintVariant` + the panel's pencil verb): the label in the
json head changes, nothing else — files keep their ids, placed instances keep
their `#p<id>` references, and the quick-menu chips pick up the new name.

## UV-coverage raster finalization (req_3520)

Saving or updating a paint variant now removes imported image content that no
UV can sample. This is a coverage crop, not a rectangular canvas crop:
`paint_N.png` keeps the atlas dimensions and exact `cornerUv` coordinate system,
but every texel outside the union of the current UV triangles becomes one
constant neutral pixel. Arbitrary holes and triangular corners therefore
compress instead of retaining unrelated source artwork. The same derived write
lands `paint_N.base.png` when strokes need a baseline; `writeModelArtifacts`
uses it for `atlases/base.png` and `raster-base.png` too, so the package does
not retain a second untrimmed copy after a finalized save.

`model_paint.buildVariantUvCoverage` rasterizes the exact live face-corner UVs
with a two-texel signed-distance gutter (the packing/filtering pad) around every
triangle. Covered texels survive byte-for-byte, including authored glass alpha.
Discarded texels become opaque neutral clay, never transparent: atlas alpha is
material opacity in the world while the editor preview hides it (req_3450), so
transparent cleanup would reintroduce invisible placed faces at any filtering
or UV-drift edge. The resident imported atlas is not mutated; the cleanup is a
save derivative, so the user can continue remapping against the full source
during the current session.

`__model_uv_coverage_write` builds that mask once per write and PNG-encodes the
resident composite/baseline natively. `__model_atlas_read(0)` supplies only UV
metadata, avoiding a 4/3-size base64 raster in the JS heap (a 2000×3000 RGBA
atlas would otherwise cross as roughly 32 MiB of text). The strict
`data/uvCoverageRaster.ts` boundary accepts the result only when dimensions,
pixel totals, and landed file stats agree; failure falls back to the historical
base64 writer without claiming cleanup. Variant json records `uvCoverage`
(kept/cleared/total texels, gutter, and output byte sizes), and the Paint
Variants panel reports the discarded percentage and written size after Save or
Update.

## Explicit shared-atlas compile (req_3522/req_3523)

Coverage-cleaned `atlases/base.*` and every `paints/paint_N.*` pair remain the
editable source of truth. Saving, updating, renaming, or adding a variant never
implicitly decides that the set is complete and never repacks another variant.
The Paint Variants panel instead exposes `Compile Shared Atlas` /
`Recompile Shared Atlas` as an explicit build step. Its progress label advances
through source scan, best-fit planning, per-tile raster copy, and UV-mesh
writes, yielding between expensive sources so a multi-megapixel compile has
visible activity.

`data/paintAtlasCompiler.ts` finds the UV-addressable bounding rectangle of the
base look and each variant from its saved paint-space mesh. It retains the
coverage/filter gutter, adds an extruded tile edge so moving a source away from
the texture boundary preserves clamp/filter behavior, and searches multiple
deterministic skyline orders and candidate widths for the smallest valid
placement it finds. There is no resize, resample, or lossy transcode: source
RGBA inside each assigned rectangle is copied byte-for-byte, including authored
alpha, and only a translation changes each mesh's UVs. Byte-identical PNGs with
the same crop share one tile (normally the current base look and the variant it
was saved from).

Compile writes content-addressed derived payloads plus one small commit manifest:

- `paints/compiled-atlas-<sha256>.png` — the one shared lossless texture.
- `paints/compiled-mesh-<sha256>.blob` — UV-remapped mesh copies; identical
  outputs deduplicate by address.
- `paints/compiled-atlas.json` — the small commit manifest mapping base/variant
  ids from source rectangles to assigned atlas rectangles, with source
  fingerprints and pixel/byte totals.

The manifest lands last. A later source edit leaves the previous compiled
artifact recoverable but marks the panel `out of date`; pressing Recompile
creates a new immutable asset set and retires obsolete derived files. Individual
PNG, JSON, baseline, and mesh files are never removed by Compile. `livePush.ts`
reads the shared PNG once per model and uses a compiled mesh for every independently
fingerprint-current entry. If one variant changed or a new one was added before
Recompile, that entry alone falls back to its individual PNG/blob while the
unchanged compiled entries remain usable.

## Skins are instance wardrobe, never palette rows (req_3443)

USER RULING (verbatim concern: "the build menu will explode"): an exported
model is exactly ONE build-palette tile — its current Studio look
(`authoredRegistry.ts authoredPaletteEntries`). Stored paintings dress the
PLACED INSTANCE instead: right-clicking a placed authored piece opens the world
quick menu, whose PAINTINGS section lists Current + every placeable skin; a
chip click runs `world.piece.skin` (`pieceEditCommand.ts planPieceSkin`), a
real undoable piece-edit transaction that swaps the instance's placeable id
between `prop:X` and `prop:X#p<skin>` in place — transform, slots, overrides,
stickers, and list order all stay. The catalog side resolves through
`EditorPieceEditAdapter.skinPolicy` (AppFrame: `authoredPieceFor` +
`listPaintSkins`), so unknown paintings and catalog pieces reject before
commit. Rendering needs no new plumbing: `livePush.ts` already registers one
resident mesh per skin under the `<placeableId>#p<skinId>` key, which is
exactly what the swapped id resolves to.

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

## Import boundary invariants (req_3450 — the invisible-bookshelf investigation)

Two silent-source traps closed at the mesh/texture import doors. Background:
placed bookshelf_001 panels rendered see-through in the world while the editor
looked fine. Every durable channel measured CLEAN (winding consistent per
component, painted.blob row-aligned with base.blob, UV footprints on opaque
atlas content, empty glass run) — the artifact came from live-session pairing,
not disk — but the investigation surfaced two real traps:

- **Imported images adopt OPAQUE.** The world's textured resident route renders
  ATLAS ALPHA through the transparent pass (`LIVE_TEXTURED_ALPHA_ROUTE_ALPHA`),
  while the editor's opaque preview ignores it — so a source PNG's transparent
  padding (38% of the bookshelf's imported texture) becomes invisible faces in
  the world the moment any UV drifts onto it, and only in the world. Glass is
  AUTHORED (req_2928) and re-applies from the doc's trailing run on load
  (req_3402), so `scene3d.replacePaintAtlas`/`importPaintAtlas` now force
  alpha 255 on arrival (`opaqueImportCopy`). Legacy packages heal on their next
  open + save (cold hydration re-imports base.png through the same door).
- **Imported meshes adopt CONSISTENT WINDING.** Nothing normalized triangle
  orientation, so a mixed-winding GLB/OBJ survived verbatim into every blob and
  back-face culling ate the flipped faces everywhere.
  `mesh_edit.inconsistentWindingMask` propagates orientation across clean
  2-incidence edges, volume-orients boundary-free components about their own
  centroid (catches an inside-out panel box glued at T-junctions; flat
  coincident stacks measure zero and never flip), minority-flips open sheets,
  and skips wire rows + non-manifold junctions. All four import doors
  (`__model_mesh_load`, preview, cooked/interleaved, `__mesh_append_file`) run
  `scene3d.normalizeSoupWinding` before retention/adoption and warn loudly when
  they repair.

## Not yet covered

- Paint SKINS (`paints/paint_N.blob`) painted at decimated quality still
  cardinality-gate against the doc and leave the palette / skip placement
  (the existing loud warn). They would need per-skin stamps.
- Door exports never take the decimated path (`compileDoorMesh` needs doc
  topology) — save doors at full quality.
- A placed instance renders the SESSION's export-time cached geometry
  (`authoredMeshData`) bound to the painted form of the moment: editing
  topology or remapping UVs after export can mis-pair until the next
  export/save refreshes the resident push. The 18:27 bookshelf re-save is
  why the defect stopped reproducing from disk.
