# TestRoute REWIRE — the contract for /test's rewrite onto the @game ground floor

Phase-1 inventory (2026-06-04, accepted by supervisor in full) + the phase-2
facts found while executing. /test (TestRoute.tsx) is the first real consumer
of the captured GAME_* systems; this table is the contract for the rewrite and
the hand-off list for the world lanes (W-1/W-2/W-3).

## Mount + data source

- Mount: `index.tsx` `<Route path="/test">` → `<TestRoute state={previewWorld} mapName={ws.stem} />`.
- `previewWorld` = `emptyEditorWorld()` (base = `createInitialGameState()`)
  + painted chunk floors lowered to real heightfield landforms (`floorsToLandforms`)
  + every placement applied via `editorWorld.ts` mutators (`placeBuilding`/`placeMarker`/`placeWorldProp`),
  first spawn marker = player start/respawn. Persisted per map by `useWorkspace`
  (mapStore.ts, `ws.stem`). Same GameState the iso preview shows and Compile
  persists to the game boot key — the world *data* path is already canonical;
  the ad-hoc part was what the route did with it.

## THE TABLE

| # | TestRoute item | Verdict | Disposition |
|---|---|---|---|
| 1 | react hooks | ROUTE-LOCAL | stays |
| 2 | Box/Pressable/Scene3D/Text | ROUTE-LOCAL | stays (platform primitives) |
| 3 | raw `busOn('__keydown'/'__keyup')` + hand `keysRef` + `__shift` peeking | MAPS → `GAME_INPUT.createKeyState()` | REWIRED — door version also blur-clears (`system:blur`), fixing the stuck-keys-on-focus-loss hazard |
| 4 | `GameState`/`Vec3` types from `../hmsc/design` | GAP(W-1) world grid state | stays ad-hoc, marked |
| 5 | `WorldStatics` (`../hmsc/render3d/GameWorld3D`) | GAP(W-2) world render | stays ad-hoc, marked |
| 6 | `PlayerFigure` (`../hmsc/render3d/PlayerFigure`, V2-RETIRED stack) | MAPS → `GAME_FIGURE` rig + `@game/figure/render` (`FigureMeshes` + `CharacterCaptures`) | REWIRED — editor-route preview path per V2-AMENDED (per-frame JS rig is editor/lab-only; the compiled game uses the bake). Player model deliberately changes to the ruled kit (V2: hmsc humanoid retires) |
| 7-14 | 8 world capture mounts (`Tile/Road/RoadJunction/Landform/Building/Prop/WorldPart/DriveInScreen` SurfaceCaptures) | GAP(W-2) world render | stay ad-hoc, marked |
| 15 | `HumanoidFaceCaptures` | MAPS → `@game/figure/render` `CharacterCaptures` | REWIRED (rides the figure swap, #6) |
| 16 | `hmscSkyBackgroundColor(config.sky)` | GAP(W-3) game sky (GAME_CHROME's LabSky is the *lab* environment shape, not hmsc `config.sky`) | stays ad-hoc, marked |
| 17 | `landformGroundTopAt` + `surfaceRegionTopMeters` + local `groundTop()` | host-side home is `GAME_PHYSICS.step`/`registerHeightfield`, blocked by GAP(W-1): no captured GameState-world → `CollisionRect[]`/`Heightfield[]` adapter (the world half of old hostPhysics.ts; physics.ts owns zero world knowledge per P2) | stays ad-hoc, marked GAP(W-1) |
| 18 | rAF-probe/setTimeout frame loop + `performance.now` | MAPS → `GAME_LOOP.scheduleFrame/cancelFrame/now` | REWIRED (loop *shape* deliberately unruled — R3; transport assembled by the route) |
| 19 | JS movement integration (WASD+arrows → dir, `pos += dir*speed*dt`) | direction transport MAPS → `GAME_INPUT.moveAxes` + `moveIntent`; integration's host home (`GAME_PHYSICS.step`) is blocked by the same W-1 adapter gap as #17 | direction REWIRED through the door; the kinematic advance + ground pin stays ad-hoc marked GAP(W-1) — shipping the host step without world colliders would half-capture W-1 |
| 20 | speed select + `\|\| 7 : 4` inline fallbacks | MAPS (data) | REWIRED — reads `state.player.walkSpeedMetersPerSecond`/`runSpeedMetersPerSecond` only; dead fallbacks deleted (see "tuning" below) |
| 21 | hand-rolled `cameraFor()` orbit trig | MAPS → `GAME_CAMERA.solve` + `rigs.Orbit` | REWIRED — boot frame matched (dist 7.65, pitch 17.8 ≡ old default view); pitch clamp mapped to orbit elevation terms |
| 22 | full-screen Pressable drag → look yaw/pitch | drag gesture ROUTE-LOCAL; typing gate MAPS → `GAME_INPUT.isTextEditing` | Pressable drag stays (visible-cursor drag feel preserved; `readPointerDelta` capture-mode mouse-look deliberately not adopted). WASD now gated on `isTextEditing()` |
| 23 | `initialPlayer`/`resetPlayer` Drop-in | ROUTE-LOCAL now; spawn/respawn semantics land with W-1 (`pv_respawn` stub) | stays, marked |
| 24 | `sceneState` merge | ROUTE-LOCAL | stays |
| 25 | Back/Drop-in buttons + hint | ROUTE-LOCAL chrome | stays |
| 26 | `clamp`/`normalizeYawDegrees` | ROUTE-LOCAL | stays |

## Tuning: the walk/run speed "conflict" dissolved (P2 law applied)

Phase 1 flagged 4/7-vs-2.4 as a conflict. Phase 2 fact: the route's
`|| (running ? 7 : 4)` fallbacks were DEAD CODE — `previewWorld.player` always
carries speeds from `cart/hmsc/state/defaults.ts` = **2.4 walk / 5.8 run**, so
that is the authored AND observed play feel, and it already equals
`GAME_COMMANDS.tuning.player.default{Walk,Run}SpeedMetersPerSecond`. One source
of truth already holds. Disposition: route reads the authored `state.player`
values (P2 data path), dead literals deleted, tuning table untouched. Tweakable
via the P2 tuning surface like every behavior number — never a blocking question.

## Deliberate behavior deltas (everything else preserves play feel)

1. **Arrow keys no longer move the player.** The ruled control contract
   (`INPUT_BINDINGS`, V7 capture) is WASD-only; readers walk the table, never
   hardcode keys. Aliasing arrows in is a contract change — take it to the
   contract, not to a route.
2. **A/D strafe un-mirrors.** Old route strafed `D → +(cos yaw, -sin yaw)`;
   the engine renders world +X as screen-LEFT, so that walked D screen-left.
   `GAME_INPUT.moveIntent` is the fidelity-pinned twin of movement.zig
   `wasdDirection` (sign pinned by tests: D walks screen-right).
3. **Player model is the V2 kit** (GAME_FIGURE seeded figure), not the retired
   hmsc humanoid. Movement/camera feel unchanged; the body is the ruled one.

## Gap summary (the world lanes' hand-off)

- **W-1 · World grid state** — captured home for: GameState/world types,
  surface-region + placed-cell ground heights, triggers, spawn/respawn, and the
  world→collider adapter feeding `GAME_PHYSICS.step`/`registerHeightfield`
  (the world half of old `hmsc/state/hostPhysics.ts`; the wire half already
  landed in game/physics.ts). Agrees with `NOT_YET_CAPTURED` rows: world grid,
  grid pathing, roads/junctions, buildings+interiors, landforms, zones,
  placement validation, `pv_respawn`. When W-1 lands: TestRoute's `groundTop`,
  GameState import, JS kinematic advance, and spawn glue all move behind it
  (movement integration goes host-side per V7).
- **W-2 · World rendering** — `WorldStatics` + the capture mounts + game sky;
  no GAME_* door renders the world and the extraction map has NO row for it
  (omission now surfaced to the user). Must answer V4's direction (instanced/
  baked, Vice City scale) — the render-juicing lane, not a straight rewrite.
- **W-3 · Game sky config** (subset of W-2) — hmsc `config.sky` →
  background/skybox has no captured home; GAME_CHROME's LabSky is the lab
  environment, a different shape.

Cross-check with `game/commands/vocabulary.ts` `NOT_YET_CAPTURED`: full
agreement on everything world-grid-shaped; W-2 is the one gap that list
structurally cannot name (it is command-vocabulary-scoped). Stub rows traffic
signals / lab scenes / `gv_controls` / `gv_perflog` don't surface in TestRoute.

## Hazards collected for free by the rewrite

blur-stuck held keys (createKeyState clears) · arrow-key contract drift ·
mirrored strafe · JS hand-rolled camera trig · dead speed literals (P2) ·
typing-gate absence (WASD while a TextInput is focused).
