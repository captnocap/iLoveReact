# Editor transport paths

Active surface: `cart/editor/` and its `/play` route. Last verified: 2026-07-10.

## User contract — req_2924, req_2933, req_2934

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

## Road surface correction — req_2936

The road compiler was correct, but the active ground formula omitted
`laneNorth/laneSouth/laneEast/laneWest` from its material table. Lane cells fell
through to concrete while only the median used a road fill. Lane and junction
kinds now bind explicitly to asphalt; the median uses its marking variant.
East/west lane UVs rotate, and the neutral median infers its axis from adjacent
directional lanes, so markings follow the road instead of crossing it.

## Deliberate next seams

- Selecting and dragging a committed anchor or TC Stop is a later editing verb;
  the current surface authors, undoes, deletes, and recreates them.
- Bridge piers/decks, tunnel portals/linings, banking, stations, switches, and
  signals remain later physical/gameplay consumers.
- Train motion is not attached yet. It must consume these path/control records
  and must not derive another network from rendered geometry.

## Verification

- `zig build test-game-map -Doptimize=ReleaseFast`: RMAP v4 round trips and v3
  migration, 3D grade validation, stop projection/path sampling, live preview,
  rail exclusion from road stamping, Map Paint history, and road grammar.
- `cart/editor/stage/transportPathUi.test.ts`: defaults, clamps, signed storey
  labels, and actionable curve/grade errors.
- `cart/editor/render3d/groundFormula.test.ts`: directional lanes bind asphalt
  and east/west grammar rotates catalog UVs.
- `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor`: ReleaseFast bridge, loader, and
  active-cart integration.

## CHANGESET — req_2924, req_2933, req_2934, req_2936

What: a shared live road/light-rail/railway pen, adjustable 3D curves, signed
storey grades, path-attached TC Stops, native ghosts, corrected road materials,
rail validation/rendering, and RMAP v4 persistence. Why: the previous port hid
results until multiple clicks and could not confidently author curves, grades,
or stop controls. Affects: native map engine, road planner, RMAP store, world
loader, V8/runtime map doors, ground formula, and Map Paint chrome. Breaking
changes: none; v1/v2/v3 RMAP files remain supported.
