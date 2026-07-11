# Editor transport paths

Active surface: `cart/editor/` and its `/play` route. Last verified: 2026-07-10.

## User contract — req_2924, req_2933, req_2934, req_2938, req_2942

Road and rail authoring is one live path pen, not the old blind sequence of
clicking two or more points before seeing a result. The authored object is a
semantic path recipe; the 1 m cell grid is only the road compiler/pathing
substrate.

1. Pick Road, Light Rail, or Railway in Map Paint → Paths.
2. Click once to place an anchor.
3. Moving the pointer immediately shows the complete next piece in the 3D
   world. Road ghosts are curb-to-curb; rail ghosts show their bed and rails.
4. Click to accept points. Curve changes the quadratic corner reach live; Undo
   Point removes the last accepted point.
5. Finish persists the recipe. Rail bends below their type's minimum radius,
   or grades above its limit, render red and keep Finish gated.

This is RollerCoaster-Tycoon-like piece drawing: the unfinished physical piece
follows the pointer before acceptance.

Rail anchors also carry a signed 3 m storey offset using the building-level
vocabulary: Basement N, Ground, Floor N. Change LEVEL before accepting the next
point; the horizontal distance to it is the run over which the track gains or
loses that storey height. Terrain is not raised or lowered. This authors
elevated light rail, subway descents, and underground alignments as one 3D path.

TC Stop is the path-attached control tool. Hovering a committed light-rail or
railway path projects to its curved centerline and previews a transverse stop
piece. A click stores `Control { id, path_id, distance_m, kind=stop }`. The
marker renderer and later train motion resolve the exact point/tangent through
`samplePath`; neither infers a network from sleepers or meshes.

## One authoring model, separate consumers

`framework/game/map/transport.zig` owns `Path { id, points, profile,
curve_radius_m }` and path-attached `Control` rows. Each point has snapped X/Z
and a signed elevation offset. Profiles are tagged road, light rail, or railway.

- Road profile: lanes with/against draw direction, sidewalks, speed limit.
- Rail profile: one or two parallel tracks; light rail and railway remain
  distinct semantic kinds.

The draft has accepted points plus one transient hover point. `curvePoints` is
the shared 3D quadratic-fillet sampler used by preview and consumers, so the
ghost cannot advertise a different curve or grade from the committed object.
Light rail accepts up to a 9% grade; railway accepts 4%. These values and the
3 m storey height live in `TUNING`, not UI magic numbers.

Consumers remain separate:

- `roads.zig` filters only road paths and compiles the ruled
  lane/median/sidewalk/junction/crosswalk grammar. Rail never enters the tile
  compiler.
- `world_loader.zig` renders rail and TC Stops from the semantic recipe:
  embedded slab + steel for light rail; ballast + sleepers + steel for railway.
- The future train controller consumes the same sampled 3D path and controls.

This is the V24 reconciliation law: one authoring representation bakes into
each system, never separate mesh and path truths.

## Host boundary and frame discipline

`runtime/game/map.ts` exposes the UI-rate surface:

- `mapPathSetProfile`, `mapPathSetTool`, `mapPathSetLevel`
- `mapPathCommit` / `mapPathCancel` / `mapPathUndoPoint` / `mapPathDelete`
- `mapPathControlDelete`
- `mapPathStats`

The world loader already owns pointer-to-terrain ray hits. While Paths is armed
it feeds the snapped hover to transport natively. React mirrors controls and
polls the compact stats record at 10 Hz for point count, grade, stop targeting,
and validity.

Preview rows rebuild only when snapped hover/draft or terrain revisions change.
Committed rail/stop rows rebuild only on committed transport or terrain
revisions. Moving railway ghosts omit sleepers; committed paths generate them.
There is no per-frame JS curve or geometry generation.

## Persistence

RMAP v4 extends v3 path recipes with point elevation and a trailing semantic
control table. Path identities survive reload because controls reference them.
The base grid still saves beneath road undercoat and roads recompile after load.
v1/v2 files load as roads with their historical 5 m fillet; v3 rail paths
migrate at Ground with no fabricated controls. The named map document remains
the single `painting.rmap` owner for terrain, cells, roads, rail, and TC Stops.

## Road lane surfaces — req_2936, req_2938

The road compiler was correct, but the active ground formula omitted
`laneNorth/laneSouth/laneEast/laneWest` from its material table. Lane cells fell
through to concrete while only the median used a road fill.

The repaired surface is now driven by the same cross-section recipe as traffic:

- One lane is exactly 3 one-metre cells. A centred 2.75 m vehicle leaves 0.125 m
  on either side for paint clearance.
- A minimal one-lane-each-way carriageway is 7 m: 3 m lane + 1 m yellow divider
  + 3 m lane. Sidewalks remain outside that width; Map Paint shows this live as
  the road WIDTH fact while lane counts change.
- Each internal 3 m lane boundary derives a dashed white line. The two outside
  carriageway shoulders derive solid white lines. The opposing-flow median
  derives the yellow center marking; junctions remain unmarked asphalt and the
  derived approach band becomes a zebra crossing.

`roads.zig` emits a render-only marking byte beside the gameplay tile kind.
Direction/vehicle cost stay on `laneNorth|South|East|West`; paint is not a
second authored grid. `engine.zig` packs the byte into the upper portion of the
existing per-cell material reference as `(binding+1) + marking*512`, keeping the
same two ground planes. The ground formula rotates both UV and metre coordinates
from the native axis flag, then composites the Road material's markings.

The catalog Road takes are now meaningful: Yellow Divider, White Lane + Edge,
and Plain Asphalt. The white preview shows a dashed lane split on one edge and a
solid road edge on the other; committed roads receive the exact edge selection
from their lane profile rather than repeating that preview on every tile.

## Smooth committed road ribbon — req_2942

The one-metre road stamp is no longer the committed road's visible outline. A
slight bend used to expose every rounded cell as a stair step, break sidewalks
into rectangular ledges, and restart lane paint at tile boundaries. That made a
valid semantic road look broken even though its light-rail sibling followed the
authored curve.

Committed roads now use the shared `curvePoints` fillet as an analytic render
ribbon:

- `roads.zig` emits chunk-local curve segments with asymmetric left/right
  carriageway and sidewalk extents, two-way state, lane-divider phase, and
  cumulative path distance.
- The raster lane/median/junction/crosswalk cells remain authoritative for
  vehicle flow, costs, intersection policy, undo, and persistence.
- `engine.zig` preserves each road cell's exact prior tile/material as a compact
  visual-undercoat token. The ground shader first restores that undercoat, then
  evaluates distance to the filleted centerline at fragment resolution.
- Asphalt wins over sidewalk wherever ribbons overlap. Sidewalk occupies only
  the smooth band between the full and carriageway extents. Yellow, dashed
  white, solid white, and zebra paint use continuous path distance, so cadence
  does not restart at a bend or chunk boundary.

The ground stream's material-reference integer remains exactly representable in
an `f32`: low nine bits carry binding+1, the next byte carries the derived raster
marking fallback, and the upper seven bits carry the undercoat token. The stream
then appends a bounded 11-float row per curve segment. If a pathological chunk
exceeds that bound, the truncation indicator becomes loud and that chunk keeps
the complete raster road instead of displaying a partial ribbon.

This is the same authoring law as rail: the smooth path recipe is the visible
object; tiles are a downstream spatial index. It does not add a second road
object or infer a curve back from stamped cells.

## Studio traffic/transit prop exports — req_2938

File → Export → Prop now declares one of these manifest roles: scenery, stop
sign, traffic light, street sign, bus stop, or train stop. The model remains a
normal free-placeable prop with its mesh, paint skins, and rig; `role` is the
small semantic contract a derived junction or path control can query.

This is deliberately a catalog declaration, not filename inference and not an
extra placed-object type. Existing `{as:'prop'}` manifests migrate as scenery.
Intersection prop generation and runtime right-of-way are the next consumers;
TC Stops already provide the rail attachment point that a train-stop export can
skin. No stop sign, signal, or shelter is fabricated until the corresponding
role has an exported model.

## Deliberate next seams

- Selecting and dragging a committed anchor or TC Stop is a later editing verb;
  the current surface authors, undoes, deletes, and recreates them.
- Bridge piers/decks, tunnel portals/linings, banking, stations, switches, and
  signals remain later physical/gameplay consumers.
- Train motion is not attached yet. It must consume these path/control records
  and must not derive another network from rendered geometry.
- Center-turn and exit-lane stencils are later road-profile edits. The raster
  marking byte reserves a new stencil bit; the analytic ribbon must consume the
  corresponding semantic profile rather than proliferating tile kinds.
- Export roles are live manifest data; automatic junction prop placement and
  runtime signal/stop gating have not yet been moved onto the active surface.

## Verification

- `zig build test-game-map -Doptimize=ReleaseFast`: RMAP v4 round trips and v3
  migration, 3D grade validation, stop projection/path sampling, live preview,
  rail exclusion from road stamping, Map Paint history, and road grammar.
- `cart/editor/stage/transportPathUi.test.ts`: defaults, clamps, signed storey
  labels, and actionable curve/grade errors.
- `cart/editor/render3d/groundFormula.test.ts`: directional lanes bind the Road
  catalog, packed marking/undercoat data decodes, the analytic ribbon takes
  priority over its raster, and take labels retain their meanings.
- `cart/editor/data/commands.test.ts`: every traffic/transit prop role is
  reachable under the nested Export → Prop menu.
- `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor`: ReleaseFast bridge, loader, and
  active-cart integration.

## CHANGESET — req_2924, req_2933, req_2934, req_2936, req_2938, req_2942

What: a shared live road/light-rail/railway pen, adjustable 3D curves, signed
storey grades, path-attached TC Stops, native ghosts, 3 m lane-aware road paint,
smooth analytic committed-road ribbons, semantic traffic/transit prop exports,
rail validation/rendering, and RMAP v4 persistence. Why: the previous port hid
results until multiple clicks, its one-metre material UV could not express the
three-metre lane grammar, and its raster outline visibly destroyed gentle
bends. Affects: native map engine, road planner, RMAP store, world loader,
V8/runtime map doors, Road material/ground formula, Studio export manifests,
and Map Paint chrome. Breaking changes: none; v1/v2/v3 RMAP files and role-less
prop manifests remain supported.
