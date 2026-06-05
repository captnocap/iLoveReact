# Capture note — editors/build/ (the /build Creative Build route, V24, 2026-06-05)

Creative Build mode: build the map WHILE PLAYING — Fortnite-Creative semantics
on /test's embodied drop-in pattern (BUILDMODE-0605). V24 + addenda are the
law; `game/build/` is the registry (read, honored, extended only by the
placed-piece family that landed at `badcf178c`).

## The pieces

- `BuildRoute.tsx` — one surface, two vocabularies: the /test player (V23
  native camera, GAME_PHYSICS host step, GAME_WORLD colliders/heightfields)
  plus the builder (crosshair → snap → ghost → click places → E edits →
  P-mark → prefab → stamp). Consumes ONLY doors: GAME_BUILD, GAME_WORLD,
  GAME_PHYSICS, GAME_INPUT, GAME_CAMERA/GAME_NATIVE_CAMERA, GAME_FIGURE,
  GAME_KINDS, GAME_LOOP, GAME_CHROME, editors/sessions.
- `snap.ts` — crosshair→snap-target resolution, pure (P4: `snap.test.ts`,
  11 cases). The catalog entry's OWN snap mode decides (grid/edge/surface/
  free — registry data); nearest of piece-face vs ground wins; top faces
  stack storeys; side faces place beside at the hit piece's base.
- `commits.test.ts` — the session contract on a real scratch store (P4, 3
  cases): one placement = ONE labeled commit on the WORLD channel; a prefab
  stamp is ONE commit landing N semantic pieces; an undo point steps
  placements back.

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

1. **Click vs camera-drag share the left button** — a mouse-up within
   `clickSlopPixels` (4) of its mouse-down places; more is a camera drag.
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
