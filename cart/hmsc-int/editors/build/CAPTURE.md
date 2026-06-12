# Capture note — editors/build/ (the /build Creative Build route, V24, 2026-06-05)

Creative Build mode: build the map WHILE PLAYING — Fortnite-Creative semantics
on /test's embodied drop-in pattern (BUILDMODE-0605). V24 + addenda are the
law; `game/build/` is the registry (read, honored, extended only by the
placed-piece family that landed at `badcf178c`).

## SUBSTRATE-0605 amendment (2026-06-05)

The route's first cut COPIED TestRoute's embodied stack wholesale; the copy
diverged immediately (stale quantized gait; a camera that NEVER ENGAGED —
module-level `bindFirst` with no `nativeCamera` node, the CAMGONE-0605
shape). USER VERDICT: "made a whole new route that is just the same as /test
route". The embodied substrate now lives ONCE in `cart/hmsc-int/Embodied.tsx`
(extracted FROM TestRoute, the verdict-hardened lineage) and this route
consumes it — `useEmbodiedPlayer` with `EmbodiedWorldExtras` (placed solids +
ramp slopes), `onFrame` (snap), `onTap` (place). Two more USER rulings rode
the same landing: hotkeys 1 floor · 2 wall · 3 ramp · 4 roof lead the palette
(addendum 2), and the mouse is CAPTURED game-style — look follows raw motion,
a click always places, Esc frees the mouse (addendum 4; supersedes surfaced
choice #1 below — the click-slop heuristic is dead). `viewport.test.ts` pins
all of it.

## HUD-0605 amendment (2026-06-05)

The route wears the Fortnite-verbatim `EmbodiedHud` (USER ruling, reference
screenshot supplied): compass top-center (the snap target rides it as the
marker), minimap + key info top-right, the session's labeled commits as the
left-middle status feed, health bottom-left (shields = hand-off, NO stamina),
and the blueprint selection (the ruled 1/2/3/4 categories + variant chips)
above the equipment hotbar bottom-right (NO material amounts). The old
full-width bottom palette and top-right session strip are gone; the help line
shows only while the mouse is RELEASED (Esc = UI mode). HUD chrome is
studio.cls `Hud*` tokens; feel numbers in `EmbodiedHud.tsx` `HUD_TUNING` (P2).

## The pieces

- `BuildRoute.tsx` — the builder layer over the shared embodied substrate
  (`../../Embodied`): crosshair → snap → ghost → captured click places →
  E edits → P-mark → prefab → stamp. Consumes ONLY doors + the substrate:
  GAME_BUILD, GAME_WORLD, GAME_PHYSICS, GAME_CAMERA (crosshair pick only,
  solved with the substrate's `PLAYER_CAMERA`), GAME_INPUT (builder keys),
  GAME_CHROME, editors/sessions.
- `snap.ts` — crosshair→snap-target resolution, pure (P4: `snap.test.ts`,
  18 cases). The catalog entry's OWN snap mode decides (grid/edge/surface/
  free — registry data); nearest of piece-face vs ground wins; top faces stack
  on that piece's top, and edge walls stand on a floor/roof only from the
  actual top face, not from the side face or adjacent ground.
- `commits.test.ts` — the session contract on a real scratch store (P4, 3
  cases): one placement = ONE labeled commit on the WORLD channel; a prefab
  stamp is ONE commit landing N semantic pieces; an undo point steps
  placements back.
- `viewport.test.ts` — the SUBSTRATE-0605 consumption-layer proof (P4, 5
  cases): substrate carries the node-bound camera, both routes consume it,
  capture-mode look pinned, ruled hotkeys pinned, CAMGONE shape banned.

## The seven steps (the dispatch's loop), where each lives

1. skeleton/drop-in — BuildRoute player + native camera + GAME_WORLD collision
2. crosshair → snap — `snap.ts` + the in-scene indicator cube
3. category select — registry-driven palette (kind chips = GAME_BUILD.kinds,
   entry chips = catalog.byKind; keys 1-9/0 and [ ]). Never a hardcoded list.
4. ghost preview — armed piece (or whole prefab decomposition) rendered at
   the snap target at ghost opacity
5. click places — `piecePlaced` world-stream event via session.commit (one
   labeled commit; the stream's materialized state is the ONE piece truth —
   the route re-reads it after every commit, no second copy)
6. E cycles WallEdit — `pieceEditSet` on the targeted piece (kind contract
   gates which pieces accept edits)
7. prefab — P marks pieces → named via `prefabFromPieces` → `prefabDefined`
   → palette ("Prefabs" category) → click stamps (`prefabStamped`, ONE
   commit, decomposes per the see-through law)

## ONE MODEL, TWO VIEWS honored

Nothing build-mode-shaped is in the data: placements are plain world-stream
events; the only trace of HOW they were authored is the session's route
label ('/build'), which is session metadata, not piece schema.

## Tuning (P2)

Route feel numbers are named tables (`CAMERA`, `BUILD_UI`, snap defaults in
`SNAP_TUNING_DEFAULTS`); reach / ghost opacity / ground-march are LIVE knobs
in the in-route tuning panel. Game-meaning numbers (opening widths, low-cover
top, ramp slope gate) live in `game/build/placed.ts` `PLACED_TUNING`.

## Design choices SURFACED (where the spec was silent)

1. ~~**Click vs camera-drag share the left button** — pixel-slop heuristic~~
   SUPERSEDED by addendum 4 (USER VERDICT: "consume my mouse until esc"):
   the substrate captures the mouse; a click is always place; Esc releases.
2. **Edge snap derives its own orientation** (the nearer grid line owns the
   wall; the run goes along it). R-rotation applies to grid/free/surface
   modes; rotating an edge-snapped wall means aiming at the other line.
3. **window/doubleWindow/brokenWindow keep full collision** — sightline is
   honest (translucent pane), but vault traversal waits on a mantle system;
   the collider does not pretend. Surfaced, not faked.
4. **Portal cutouts span full wall height** (no lintel): door/garage/arch
   render and collide as two jambs around the opening width. A real door
   header is a bake-lane refinement.
5. **Placed pieces are GLOBAL, not per-map.** The world stream is the one
   V20 'world' channel; the editor's multi-map workspace predates the
   streams. Pieces placed on /build show regardless of which map is open.
   Per-map stream scoping is a V20 schema-evolution question for the
   supervisor — not invented here.
6. **Ramps/stairs render as stepped boxes** (visual approximation); the
   collision truth is the real slope heightfield (`placedPieceRamps`), so
   what you walk is the slope even though you see steps.
7. **No overlap rejection** — Fortnite-style: pieces may interpenetrate;
   the ghost shows where, the user decides. A placement is refused only
   when it fails the catalog boundary (`validatePlacement`).
8. **Prefab clones default to theme 'common'** — no theme picker on the
   capture panel yet; the definition is P2 data and can be re-themed when
   a prefab editor exists (Prefab Edit mode is V24's later F4 lane).
9. **The crosshair ray is the JS camera shadow** (lookRef + player pose
   through GAME_CAMERA.solve — the crosshair law's screen-center axis).
   The host controller's smoothing can lag it by a frame mid-drag; the
   grid-quantized snap makes that invisible.
10. **Prefab stamps drop on grid snap** with R-rotated yaw in 90° steps;
    composition rotation and piece spin share one frame (R(+yaw) — pinned
    by the corner-proof test after a real bug).
11. **Host-cap truncation is loud** — rects/oriented/heightfield slots
    truncate with a console.warn naming the drop count, never silently.

## Maintenance contract

This route's doc lines live in `docs/game/hmsc-int.md` (+ the
`docs/game/_index/records/hmsc_int.ts` route interface). Extending the build
vocabulary = rows in `game/build/` tables (kinds/edits/catalog), never route
logic. The bake emission stays compile/'s lane (BakePromise untouched here).

## GRIDSNAP-0605 (2026-06-05): modules tile at their own pitch

USER VERDICT: "the grid needs a better snap. on the 1m ideally, im finding to
many nudges it can fit into that make something slightly off set from
everything else." Cause: 3m modules snapped at the 1m substrate pitch (three
near-miss lateral positions per module width), and 'free' pieces placed at
the RAW hit (no snap at all). Fix in snap.ts: `modulePitch()` — a piece whose
size is a clean grid multiple snaps at its OWN module pitch (3m plates have
ONE lattice; walls' edge lines land on plate edges, never mid-plate);
sub-module pieces (props, poles) and 'free' mode ride the 1m substrate.
FLOORGAP-0606 follow-up: a floor snapped from another floor's edge stays on
the same base plane when the snapped footprint is adjacent, while true footprint
overlap still stacks. Tests pin exact shared-edge coordinates, not epsilon
closeness.

## REQ-0452 (2026-06-10): wall-on-floor requires the floor top face

USER VERDICT: "i need it to only be on top of the floor" because the old
side-face and beside-floor ground anchors made wall placement mismatch. Edge
walls still use the catalog edge lattice, but a floor/roof top anchor now only
comes from targeting that plate's top face. Hitting the plate side or the
ground next to its perimeter yields no floor-top wall placement.

## REQ-0466 (2026-06-10): wall thickness follows floor support

USER DRAWING: the wall line was right, but the wall body was centered on that
line, leaving a half-depth overhang off a one-sided floor edge. The fix keeps
the authored edge line unchanged and normalizes the physical band from support:
one floor/roof side puts the full wall thickness on that plate; floor/roof on
both sides splits the thickness across the shared seam; no plate support keeps
the old centered freestanding wall. Render boxes, live colliders, camera
occluders, and raycast targeting all read the same `placed.depthSpan` result.

## REQ-0470 (2026-06-10): wall-to-wall edge snap survives top-face-only floors

Regression from REQ-0452/0466: edge snap from an existing wall face could resolve
as a next-storey placement because all piece faces fed the edge resolver the
piece top. The law is narrower: floor/roof side faces are not wall-on-floor
anchors, but wall side/end faces are still valid wall-to-wall snap targets and
keep the target wall's base Y. Only actual top faces stack.

## REQ-0471 (2026-06-10): wall-face snap uses authored wall geometry

Follow-up regression: wall-face edge snap still derived orientation from the raw
physical hit point. After REQ-0466 the wall body can sit on one side of its
authored line, so raw face hits no longer reliably identify wall endpoints or
which side the user is aiming from. Edge snap now has a wall-specific face path:
end-cap hits extend the wall collinearly, side-face hits near an endpoint turn
the corner on the aimed side, and side-face hits away from endpoints stay on the
same authored wall line. Floor/roof side faces remain blocked for wall-on-floor.

## REQ-0596 (2026-06-11): prop freeform override in iso authoring

Default prop placement still rides the 1m substrate from GRIDSNAP-0605. In the
iso authoring pane, holding Alt while placing a prop passes an explicit
`freeform` flag to `resolveSnapTarget`, landing on the cursor hit quantized only
to the freeform tuning row. Holding Alt while dragging a selection made only of
prop pieces moves by the raw world delta instead of whole grid cells, so props
can sit flush against walls. Structural selections remain grid/module locked.

## REQ-0598 (2026-06-11): R rotates selected placed items too

The iso pane's R key is now mode-sensitive: while a catalog entry is armed it
keeps rotating the placement ghost; with nothing armed and a selection present it
rotates the selected placed item(s). Whole-building selections commit one
`buildingMoved` yaw update, while loose pieces use the existing remove+place
world-stream path with the same placement metadata and `yawDegrees + 90`.

## REQ-0650 (2026-06-11): Alt = fine 1-tile module stepping

USER: a 3m plate could only stand 0/3/6 tiles from a painted road line (the
GRIDSNAP-0605 module lattice is world-anchored), so equal building setbacks on
both sides of a street were unreachable — "i can never actually get there,
unless i pre plan every single road to be at minimum the same distance apart".
Fix: the iso pane now passes `freeform` for EVERYTHING armed while Alt is held
(extending REQ-0596's prop override). In snap.ts, fine mode steps grid modules
ONE substrate cell at a time via `fineModuleCenter` (odd-cell spans center on a
cell, even-cell spans on a line — edges always on tile lines, so the
GRIDSNAP-0605 sub-tile offsets cannot return), and frees the edge-snap GROUND
line lattice to any 1m tile edge. 'free' props keep the raw-hit behavior; the
wall-face continuation path stays module-relative. Default (no Alt) placement
is unchanged.
