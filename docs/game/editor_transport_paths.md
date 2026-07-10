# Editor transport paths

Active surface: `cart/editor/` and its `/play` route. Last verified: 2026-07-10.

## User contract — req_2924

Road and rail authoring is one live path pen, not the old blind sequence of
clicking two or more points and waiting for a destructive stamp before seeing
the result. The authored object is a semantic path recipe; the 1 m cell grid is
only the road compiler/pathing substrate.

The interaction is:

1. Pick Road, Light Rail, or Railway in Map Paint → Paths.
2. Click once to place an anchor.
3. Moving the pointer immediately shows the complete next piece in the 3D
   world. Road ghosts are curb-to-curb; rail ghosts show their bed and rails.
4. Click to accept a point, then continue moving/clicking to shape the route.
   The Curve control changes the quadratic corner reach live over the whole
   editable wire. Undo Point removes the last accepted point.
5. Finish persists the semantic recipe. Cancel drops only the draft. Rail bends
   below the selected type's minimum reach render red and Finish stays gated.

This is deliberately RollerCoaster-Tycoon-like piece drawing: the unfinished
piece follows the pointer and is visible before acceptance. A click records an
anchor; it does not make the user wait to discover what the segment became.

## One authoring model, separate consumers

`framework/game/map/transport.zig` owns `Path { id, points, profile,
curve_radius_m }`. `profile` is tagged as road, light rail, or railway:

- Road profile: lanes with/against draw direction, sidewalks, speed limit.
- Rail profile: one or two parallel tracks; light rail and railway remain
  distinct semantic kinds.

The draft has accepted points plus one transient hover point. `curvePoints` is
the shared quadratic-fillet sampler used by both preview and compilation, so
the ghost cannot advertise a different curve from the committed object.

Consumers stay separate:

- `roads.zig` filters only road paths and compiles them through the ruled
  lane/median/sidewalk/junction/crosswalk grammar. Rail never enters the tile
  compiler.
- `world_loader.zig` renders committed rail directly from its semantic recipe:
  embedded slab + steel for light rail; ballast + sleepers + steel for railway.
  The live road ghost is a full-width ribbon, while committed roads remain the
  native painted grid.

This is the V24 reconciliation law applied to transport infrastructure: one
authoring representation bakes into each system, never a separate mesh truth
and path truth.

## Host boundary and frame discipline

`runtime/game/map.ts` exposes the small UI-rate surface:

- `mapPathSetProfile`
- `mapPathCommit` / `mapPathCancel` / `mapPathUndoPoint` / `mapPathDelete`
- `mapPathStats`

The world loader already owns pointer-to-painted-terrain ray hits. While Paths
is armed it feeds the snapped 25 cm hover point to the transport draft on the
native frame path. React only mirrors controls and polls the eleven-float stats
record at 10 Hz so point counts and Finish validity follow native clicks.

Preview rows rebuild only when the snapped hover/draft revision changes or when
terrain height changes. Committed rail rows rebuild only on a committed-path
revision or terrain change. Railway sleepers are omitted from the moving ghost
and generated for the committed path, preventing tie spacing from becoming
pointer-frame work. There is no per-frame JS curve or geometry generation.

## Persistence

RMAP v3 extends the trailing recipe section from road-only strokes to tagged
transport paths and stores curve reach. The base grid is still saved beneath
road undercoat, then roads recompile after load. v1/v2 files remain readable as
roads with their historical 5 m fillet; material bindings and chunk payloads do
not change.

Light rail/railway recipes are visible again after a save/reopen without
creating tile kinds or a sibling JSON store. The named map document remains the
single `painting.rmap` owner for terrain, painted cells, roads, and rail.

## Deliberate next seams

- The first slice edits a draft through point placement, Undo Point, curve
  reach, type, width/track controls, Finish, Cancel, and Delete Last. Selecting
  and dragging an already committed control point is a later editing verb.
- Track grade currently drapes to the rendered terrain surface. Elevated deck,
  bridge, tunnel, banking, and explicit grade handles need semantic elevation
  data rather than visual-only offsets.
- This establishes the authored rail network and visual grammar. Train motion,
  switches/stations, signals, and the compiled gameplay route consumer attach
  to the same path records; none should infer a second network from geometry.

## Verification

- `zig build test-game-map -Doptimize=ReleaseFast`: transport curve/table,
  RMAP v3 road+rail round trip, immediate hover preview, rail exclusion from
  road tile stamping, and existing road grammar tests.
- `cart/editor/stage/transportPathUi.test.ts`: kind defaults, boundary clamps,
  and actionable rail-validation language.
- `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor`: ReleaseFast bridge + loader +
  active-cart bundle integration.

## CHANGESET — req_2924

What: replace blind road point drafting with a shared live road/light-rail/
railway path pen, adjustable curves, native full-shape ghosts, rail validation,
rail rendering, and RMAP v3 persistence. Why: the previous 2D-to-3D port hid
the result until multiple clicks plus Commit and made curves impossible to
author confidently. Affects: native map engine, road planner, RMAP store, world
loader, V8 map bindings, runtime map door, and Map Paint Paths chrome. Breaking
changes: none for existing maps; v1/v2 RMAP loads remain supported.
