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
