# Capture note — game/build/ (V24, 2026-06-04)

The building piece grammar's data layer, written fresh against the V24 ruling
(docs/game/BUILDING-GRAMMAR.md is the evidence; DECISIONS.md V24 + addenda are
the law). This is a CAPTURE-PLUS-DESIGN task: where the user's conversation
specifies, it is followed exactly; where it is silent, the minimal proposal is
made and SURFACED below.

## What this is (and is not)

- `pieces.ts` — the BuildPieceKind taxonomy + per-kind `BuildKindContract`
  with a `BakePromise`: what a placed piece of this kind PROMISES the bake
  (render geometry / collision boxes / cover faces / sound occlusion / room
  volumes / nav portals/blockers / vertical links / destructible sections).
  **DECLARATION ONLY** — bake emission lands with the compile/world
  integration, not here.
- `edits.ts` — the WallEdit vocabulary (solid/door/window/doubleWindow/
  brokenWindow/garageDoor/arch/halfHeight, verbatim) with per-edit MEANING:
  tag overrides + portal kind + sightline + traversal. `applyWallEdit` is the
  one composition point.
- `catalog.ts` — the BuildPieceDef tables (P2): theme, material, size, snap,
  gameplay tags (verbatim V24 list: collision, blocksSight, blocksSound,
  cover, durability, climbable, vaultable, portal). `validateCatalog` enforces
  the kind contracts at the boundary.
- `prefabs.ts` — the addendum's first-class compositions: named piece sets
  that DECOMPOSE to semantic pieces with effective tags (no opaque blobs);
  static seeds prove the shape, world-saved prefabs join via the V20 streams.
- `markers.ts` — addendum 3's WorldMarker union (path_node / trigger / room /
  portal / interest_point / camera_marker): the semantic-overlay data family.
  Validation only; the Plan-mode overlay EDITOR is later work.
- `index.ts` — the door; `GAME_BUILD` exported through `game/index.ts`
  (the 21st door — STRUCTURE.md's door list updated in the SAME commit, the
  GAME_WORLD-precedent gap not repeated).

## Sources seeded from (read, never moved/copied)

| seed | what it contributed |
|---|---|
| `cart/hmsc/world/buildingKinds.ts` | kind-vs-appearance split precedent; storey module (3m, `HMSC_SCALE.storyHeightMeters`); facade themes → wall rows |
| `cart/hmsc/render3d/materials.ts` | glass durability values carried exactly (Glass 30 / AutoGlass 20 / **Storefront 60** → `wall.storefront.downtown`) |
| `game/kinds/props.ts` | prop rows reference `propKind` (dumpster/fireHydrant/bush) — the same "borrow the bundle" pattern props use on tiles; sizes derived from footprint radius/height |
| `game/kinds/tiles.ts` | `TileCoverHeight` imported — cover values CARRY into the chance engine's vocabulary, never a parallel scale |
| wv_building expectations (`game/commands/vocabulary.ts` [not yet]) | the console verbs the build system must eventually serve (list/place/remove/skin) |
| `game/world/spawn.ts` | trigger markers reconcile: `trigger.event` IS a command line baking into cell `triggerCommand` |
| `game/camera.ts` / `game/cutscene/` | `camera_marker.shot` names a rig in the existing camera vocabulary — never a new camera model |

## Verification

`build.test.ts` — 18 P4 meaning-tests, all green under
`tools/v8cli` (`tools/esbuild … --alias:@reactjit=runtime`): doorway-is-a-portal,
window-sightline-not-traversal, broken-window vault, garage-door vehicle
portal, halfHeight low cover, cover-values-carry, catalog-vs-contract
validation (positive AND negative), prop pipeline references, vertical-link
exactness, prefab decomposition + see-through (portal/window semantics survive
cloning), prefab validation, portal-references-two-rooms, interest-point role
vocabulary, trigger-event-is-a-command-line, unique marker ids.

The contract validator caught its first real bug DURING this capture: the
ramp/stairs seed rows inherited `blocksSound: true` from the shared plate tags
while their kind promises no sound occlusion — fixed in the table, which is
the system working as designed.

## Design choices SURFACED (where the conversation was silent)

1. **`ramp`/`stairs` and `pillar`/`corner` are SEPARATE kinds.** The user
   wrote them slashed ("ramp/stairs", "pillar/corner"). Their gameplay
   contracts differ (ramp carries vehicles, stairs are body-only; a corner
   bounds rooms with lean-around, a pillar is a freestanding column), so the
   kind split follows the meaning. If one-kind-with-variants was intended,
   it is one merge.
2. **`'common'` added to the theme vocabulary** beside the user's five
   (downtown/motel/trap_lot/suburb/industrial) for the theme-neutral
   structural rows; `catalogEntriesByTheme` folds common rows into every
   theme's palette.
3. **`durability: number | null`** — null = indestructible. Mirrors
   materials.ts `breakable`/`health` without a second boolean; the glass
   family carries the materials.ts health numbers exactly.
4. **`brokenWindow.portalKind = 'none'`** with `traversable: true` +
   `vaultable`: a vault entry, not a standing nav corridor. If nav should
   route mantling agents through broken windows, that is a pathing-profile
   decision later, not a vocabulary change.
5. **`sign` promises no cover faces** (a billboard-as-cover would be a kind
   contract change, surfaced rather than assumed); face-mounted signs have no
   collision, pole signs do.
6. **Material vocabulary proposed** (concrete/brick/stucco/wood/metal/glass/
   chainlink) — seeded from what the corpus renders today; extend by row.
7. **Bush concealment folded into `blocksSight: true`** — the V24 tag list
   has no separate concealment axis; the tall hide-in bush blocks the
   sightline while having no collision. If perception later wants the
   tile-style concealment scalar, it reads the referenced propKind's tile
   bundle (which carries it) — not a new tag.
8. **Marker positions are world meters** (`{x,y,z}`, R4) and mode-agnostic —
   the one-model-two-views invariant holds: nothing in any table assumes a
   camera or interaction mode; placement provenance, if ever recorded, is
   metadata, not schema.
9. **Prefab seed** (`prefab.motelRoom`) is deliberately minimal — one room,
   six pieces, a door and a window — the decomposition proof, not content.
   Real prefabs are world-saved (V20 streams) per the addendum.

## Maintenance contract

Extending the grammar = table rows (pieces/edits/catalog/prefabs/markers),
never new logic branches. Editing this module = update
`docs/game/_index/records/game_build.ts` and the hmsc-int doc line in the
same commit. The bake emission task (render/collision/nav/rooms) lands with
compile/ and must consume `BakePromise`/`effectiveTags`/`decomposePrefab` —
if it needs a shape this module doesn't declare, the declaration changes
FIRST, here.

## RAMPFOOT-0605 (2026-06-05): the ramp owns footing in its footprint

USER VERDICT: "if u place a ramp and then a wall, you get nudged off at the
top because ur standing on the wall not the ramp anymore." Cause: wall-family
bands sit ON grid lines, overhanging half their depth into the adjacent cell;
over a ramp cell that strip is a solid with a flat top above the slope (the
host treats every rect top as standable) — a side-block mid-slope, a
step-onto ledge at the crest. Fix in placed.ts: tall thin blockers
(wall/fence/railing/pillar/corner/arch) get their quarter-turn bands TRIMMED
out of overlapping ramp/stairs plan footprints when the band's base is below
the ramp top; upper-storey walls (base == crest) and floors/roofs/props are
untouched (a landing plate is the delivery surface). Free-yaw bands are not
trimmed (oriented subtraction needs host support). SURFACED EDGE CASE: a wall
sandwiched between two ramps trims away entirely (collision-free) — pinned by
test, not silently special-cased; a vertical band split needs the physics
wire to grow before it can be honest. P4 coverage lives in `placed.test.ts`.

## RAMPSIDE-0606 (2026-06-06): ramp boundaries are solid

USER VERDICT: ramp slopes worked, but the visually present side/back wall was
walk-through. Cause: `placedPieceRamps` registered only the 2x2 slope
heightfield (`[0,0,H,H]`), while `placedPieceColliders` skipped ramp/stairs
entirely. Fix in `placed.ts`: ramp/stairs still register the heightfield for
the walkable slope, and also emit three wall-class collision bands: left side,
right side, and low/back face. The side bands sit outside the slope footprint
with their inner faces flush to the ramp edge, so center-slope walking is
unchanged; the high/front edge stays open to the next floor. P2 thickness is
`PLACED_TUNING.rampBoundaryWallThicknessMeters`. `physics.test.ts` consumes the
real build colliders through `GAME_PHYSICS.step`: slope grounding still works,
and walking into a ramp side is blocked.

## REQ-0107 (2026-06-06): flushness is lattice origin, not piece resizing

USER VERDICT: a previous wall-junction attempt resized live geometry and made
floors appear tiny / wall placement reject. The grammar rule is explicit:
catalog sizes are untouched; floor/wall junctions are made flush by exact
lattice origins. Regression coverage logs floor bounds, wall bounds, wall
collision spans, and the live wall-on-floor snap target; floor pieces remain
3m x 3m, walls keep their 3m run, and validation accepts a wall placed on a
floor top edge.

## REQ-0109 (2026-06-06): wall-wall joins close endpoint-to-side notches

USER VERDICT: floor-top flush passed, but L wall corners still showed a notch
where one wall's endpoint stopped at the other wall's centerline. Bounds remain
catalog-sized; `placedPieceBands(piece, pieces)` is the context-aware consumer
shape for rendering and collision. When a quarter-turn edge wall endpoint lands
on a perpendicular wall side, that endpoint extends by the neighbor wall's
half-depth to the outer face. L-corners and T-junctions are covered in
`placed.test.ts`: raw placed bounds log the 0.125m sliver, joined bands close
the outer faces exactly, and standalone floor/wall placement stays unchanged.

## REQ-0641 (2026-06-11): stairs, doors, and residential windows

USER ASK: default stairs were "ugly as hell" and "like 1/3rd width"; add more
models, an elevator method with a stop at every floor in one wall/floor module,
interactable doors/doorways that open/close, and non-storefront windows. Fix:
`stairs.wood.common` is now the full 3m module; the old 1.2m size survives only
as explicit `stairs.wood.narrow`, with concrete and industrial stair catalog
rows added. The wall edit table now marks door and garageDoor as toggle
interactions; `PlacedBuildPiece.doorOpen` plus `pieceDoorSet` carries live
open/closed state, and closed panels add collision only across the portal
opening. The door/window/elevator METHODS first landed as prefabs here and
were rejected (USER: "i kept saying dont put it in prefabs") — REQ-0647 below
is the shape that shipped. P4 coverage: `build.test.ts` and `placed.test.ts`.

## REQ-0643 (2026-06-11): editor stairs and compiled-game stairs match

USER SCREENSHOTS: the editor showed the improved full-width multi-step stairs,
but the game rendered chunky old block stairs. Cause: editor preview used
`BUILD_UI.stairVisualSteps` while `compile/worldGeometry.ts` baked stairs with
its own stale `STAIR_VISUAL_STEPS = 4`. Fix: stair visual decomposition count
now lives in `PLACED_TUNING.stairVisualSteps`, and both `pieceMeshes.tsx` and
the compiled geometry bake read that same placed-build tuning. P4 coverage:
`compile/worldGeometry.test.ts` asserts the compiled stair step count, width,
tread depth, and top height from the shared tuning and catalog.

## REQ-0647 (2026-06-12): door/window walls are CATALOG ROWS; the elevator is a PIECE KIND

USER VERDICT (after the REQ-0641/0646 prefab attempts): "i kept saying dont
put it in prefabs but it keeps being put into prefabs"; the door wall "doesnt
even align with the walls"; the placed elevator was "just a solid 1x* box that
isnt an elevator at all." The prefab delivery (the one-piece method prefabs,
`elevatorPrefabDefinition`, `prefabPlacementBasis`) is DELETED. What shipped:

- **defaultEdit on BuildPieceDef** (catalog.ts): a wall row that IS a cutout —
  `wall.concrete.doorway` / `openDoorway` / `wall.metal.garageDoor` /
  `wall.stucco.window` / `doubleWindow` / `wall.plywood.brokenWindow` — names
  its WallEdit on the row. `placementFor` (placed.ts) stamps it onto every
  placement, so F2 place, iso click, and iso drag-paint all cut the same
  opening. The rows are NORMAL walls: kind `wall`, snap `edge`, same join and
  depth-span math — alignment comes free because they ARE walls.
- **kind `elevator`** (pieces.ts) joins ramp/stairs in the vertical-link
  family: `elevator.metal.common` is ONE 3m storey module; STACKING pieces
  grows the shaft and every storey IS a stop (`elevators.ts` derives shafts +
  stop arithmetic). Static colliders are an OPEN-FRONT frame (back + side
  walls only, placed.ts); the visual is posts + thin walls + a front header
  (pieceMeshes.tsx + worldGeometry.ts — never a solid box). The CAR is a live
  CollisionRect the play route mutates in place per frame — the host step
  re-reads rects every frame, so a rising car carries the standing player
  (pinned in physics.test.ts). E rides up stop-by-stop (wrapping down from the
  top) or calls the car to a landing; car height is route-local transient
  state, never a stream commit. The compile bake ships the car parked at the
  bottom stop (worldColliders.ts + worldGeometry.ts); nav stamps the shaft
  interior as a link and holds interactable doors OPEN for pathing
  (navGrid.ts — a doorway is a nav portal even when its panel is shut).

P4 coverage: `build.test.ts` (wall-type rows, placementFor, kind contract),
`elevators.test.ts` (shaft stacking/splitting, open-front colliders, car rect
ride, stop loop, rest cars), `physics.test.ts` REQ-0647 (the ride carries the
player), `navGrid.test.ts` (doorway stays pathable). The PLAYFOLD viewport
guard also went green again: the interact E now reads through
`embodied.actionDown` instead of a route-local key state.

## REQ-0472 (2026-06-10): supported wall joins stop at the real intersection

USER DRAWING: after wall thickness started sitting fully on a one-sided floor,
the old join extender still assumed the perpendicular wall was centered on its
authored line. That pushed the joined run 0.125m past the second intersection
face. Fix: wall join limits now read the perpendicular wall's actual
`placedPieceDepthSpan` in world space. Unsupported centered walls still extend
to close REQ-0109 notches; floor-supported one-sided walls stop at the real
supported face. Covered by `REQ-0472` in `placed.test.ts`.

## SMARTSEL-0605 (2026-06-05): one click grabs the connected shape

USER ASK: select many pieces, save the whole shape as one prefab, plus a
smart select that "collects all the pieces that touch in one click".
placed.ts grows connectedPieceIds(seed, pieces) — BFS over envelope contact
(pieceBounds, touchToleranceMeters in PLACED_TUNING; flush module-snapped
faces count). GAME_BUILD.placed.connected carries it. The route binds G:
grab the whole connected shape into the marked set (G again on a fully
marked shape unmarks it); P stays the single-piece toggle; the existing
marked-panel (name → Save prefab) stores the shape. 3 P4 cases (29/29).
