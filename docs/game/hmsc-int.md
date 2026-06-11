# hmsc-int cart inventory

Source cart: `cart/hmsc-int/` (~9,200 lines: ~45 modules + `tabs/` + `assist3d/` + own `AGENTS.md` + `cart.json`)

Reviewed: 2026-06-04 (other sessions were actively editing this cart during review; this reflects the working tree)

## High-level purpose

`hmsc-int` is the **world editor for Hitman Shitcity** — the authoring counterpart of the game cart `cart/hmsc`. Its architecture rests on three locked decisions (all in its `AGENTS.md`):

1. **It stages a real `GameState`** — the exact record the game boots from — and "Compile" persists it to the shared `'hmsc'/'game-state'` localstore key (`saveGameState`). Localstore is ONE store across carts (`fs.init("reactjit")`), so the editor IS the editor→game channel. The old "emit `wv_*` command text" model is explicitly dead.
2. **Every mutation goes through the game's own mutators** (`editorWorld.ts` calls `resolveBuildingPlacement`/`addBuildingToWorld`, `placeProp`, `addZone`, `addSurfaceRegion`, `placeCell`, `setBuildingFaceSkin`, `nextUniqueId`) so an authored thing is byte-identical to one the game made. No parallel schema.
3. **The preview is the game's own renderer** (`WorldStatics` from `cart/hmsc-int/render3d/GameWorld3D` + the matching capture components) — no renderer fork, so the preview can't drift from the game.

Workflow: paint top-down in 2D (tiles / heights / zones / placements over a sparse chunk grid) → live iso/free-fly 3D preview → **Compile** writes the boot key → the game boots that exact world.

It is a **multi-map workspace** (VSCode model): each map is its own session file; maps are *thin references* into shared global registries (tile kinds, object kinds, kind textures) — change a global, every map follows.

## File map (by subsystem)

**Spine / shell**
- `index.tsx` (~480) — WIRING ONLY since SHELLFOLD-0611 (review §2: the ~1,000-line
  EditorShell cut along its four seams, each concern now a module):
  - `editors/world/useMapSession.ts` — the map persistence engine: `MapPayload`
    (v2 schema), buildPayload/applyPayload, the `useWorkspace` autosave wiring,
    undo snapshot hooks, open/new/rename/delete, the view-sanity laws
    (VIEWRUNAWAY/MAPGONE), every per-map twig (tool/tile/layer/channels/tab/
    notes/grid/brush/wasd), placement STATE, tile selection + overrides, camera
    seeds. Boot reads ONE envelope (the view seed and the legacy-piece probe
    used to each parse the session file — review §1's triple-parse, ⅓ fixed).
  - `editors/world/useBuildUndo.ts` — build-stream commits (event scoped to its
    owning map, one undo step per interaction, `commitMany` batches) + the
    Ctrl+Z piece reconciler (`pieceValueKey`/`reconcileBuildPieces` — undo
    APPENDS compensating events, V20). The four `commitMany` structural casts
    are gone: it IS the RouteSession contract.
  - `editors/world/usePlacements.ts` — the 'place' layer's CRUD verbs (arm/
    drop/paint/move/rotate/clone/remove, footprint batch-delete, face re-skin)
    + the `place` API the canvas consumes.
  - `editors/world/previewWorld.ts` — `assemblePreviewWorld`: a PURE compiler
    from (base world, painted floors, placements, kind textures) → the
    GameState the iso pane, /test, and Compile consume.
  The shell keeps: route composition, the chrome + popovers, the event-log
  trace, the world/buildings session opens, the tunables boot fold, compile.
  The 2×2 `QuadSplit` layout: PropertiesPanel | RightPanel / PaintCanvas |
  IsoAuthor, under the persistent chrome strip (`shell/chrome.tsx`).
- `AGENTS.md` — the cart's own agent contract (mutator rule, compile-=-persist, shape map). *Drift note: it documents `MapCanvas.tsx`, which has since become `PaintCanvas.tsx`.*
- `shell/chrome.tsx` (302) — the persistent titlebar strip (WBCHROME-0606, WORKBENCH.md step 2; replaced `ProjectBar.tsx`, full parity — line-referenced table in commit `34400c6e7`): map switcher (`MapsMenu`), new/rename/delete, undo/redo, THE RULED SIX route icons (STEP10-COLLAPSE-0607, WORKBENCH.md §3: editor `LayoutGrid` · play `Play` · labs `FlaskConical` · assets `Shapes` · settings `Settings` · assist3d `Sparkles` — assets and settings are two doors into /workbench via `shell/workbenchDoor.ts`, a one-shot `requestWorkbenchSource` ask + a live source-family report that lights the right door; the per-flip shrink history: cutout's Scissors died at CUTOUTFLIP-0606, items/voxels at WBITEMS-FLIP-0606, vehicles at WBSTEP6-FLIP-0606, textures/compose at WBMATERIALS-FLIP-0607, log/settings at WBSTEP9-FLIP-0607), Compile button, save pill, event-log popover — plus the W1 additions: the borderless host's WINDOW CONTROLS (`__window_minimize/maximize/close`) and the dead-middle `windowDrag` titlebar grab. Renders through the `Chrome*`/`Win*` classes (`shell/workbench.cls.ts`), zero raw colours. Menus export separately and render as the **root's last children** (the overlays-last hit-test rule, recorded in its header).
- `QuadSplit.tsx` (133) — controlled 2×2 splitter; drag is driven by the host's **global cursor channel** (`system:cursor:move`, pumped by Zig from `SDL_GetGlobalMouseState`) rather than per-node mouse-move, so tracking never loses capture; mouse down/up only bracket the gesture.
- `theme.ts` / `studio.cls.ts` (206) — classifier-driven styling: every colour is a `theme:` token; importing `studio.cls` seeds the studio theme (`setTokens`); per-instance states are sibling classes (`…On`/`…Active`). The two inspector surfaces render exclusively through these classes.

**World data layer**
- `chunks.ts` — sparse grid of 120×120-tile chunks (`CHUNK_TILES` matches the game). World extent derives from the address window (a–zzz columns / 0–999 rows → 152×8 chunks). Chunks grow into any in-bounds unoccupied neighbour. Each chunk owns its tile/height/zone buffers; zone *defs* are world-wide.
- `address.ts` — spreadsheet addressing (`A0…DP119`), bijective base-26 columns over integer cell coords; display/parse skin only.
- `tileData.ts` — `Int16Array` tile-kind index per 1m cell (−1 = empty); `TILE_PALETTE` derived from the game's `tileKinds` registry; rendered as one Effect storage buffer.
- `heightData.ts` (170) — `Float32Array` heightfield, 2 samples/tile, `HEIGHT_LIMIT = 64m` as the single height-range knob (brush stepper, stamp clamp, colormap span all derive). Brush mutates in place O(brush); render is one buffer upload.
- `zoneData.ts` — `Int16Array` per-cell zone membership + world-wide `ZoneDef {name,color,flags}` using the game's `ZONE_FLAGS` taxonomy (the same flags the player-drive loop fires onEnter/onExit from).
- `brush.ts` — shared footprint math (circle/square/diamond) for all painted layers.
- `tileOverrides.ts` (88) — per-cell property **overrides** layered on a cell's kind without changing the kind: `cellKey → {dotted-path → value}`; effective = override ?? kindDefault. The bulk-edit target of the tile selection.
- `placements.ts` (87) — the 'place' layer model: `{id, cat: building|prop|marker, kind, gx, gy, rotation, locked}` with footprint/colour/label **re-resolved from the kind registries** (never stored).
- `mapStore.ts` (189) — map codec: live world ↔ JSON `MapSnapshot`. THE RULE: globals are shared, maps are thin references — tiles persist via a `tileLegend` of kind *names* remapped on load; placements persist as `{id,cat,kind,pose}` only. Buffers RLE-encoded via the shared `@reactjit/workspace` grid codec.
- `projects.ts` (56) — directory-level CRUD over `sessions/*.session.json` (list/exists/delete/name hygiene).
- `editorWorld.ts` (272) — the authoring spine described above; also `emptyEditorWorld()` (game-shaped state with no content), ghost-validity check (`buildingFootprintBlocked`), terrain-aware Y (`landformGroundTopAt` under every placement), marker placement as `placedCells` with save→spawn `spawnKey` links.
- `kindTextures.ts` (64) — GLOBAL per-kind part textures in the shared 'hmsc' store (key `cat:kind` → partId→textureId), broadcast via an IFTTT bus event; folded into instances at preview+compile with instance overrides winning.

**game/chance.ts — the ONE odds engine (V9 capture, 2026-06-04)**
- `game/chance.ts` — the ruled hybrid REWRITTEN fresh: scape's multiplicative `ChanceBreakdown` surface (WHY is it 33% — base × range × los × cover × stance × awareness × health × time × skill, clamped, true-0 preserved) + hmsc/combat_lab's CONTINUOUS `coverFraction` input (`1 − f·0.8`; scape's binary partial→0.65 recovered exactly via `partialLosCoverFraction = 0.4375`; bone-sample contract carried as `COVER_SAMPLE_SPEC` + the pure `coverFractionFromSamples` fold). Every curve in `CHANCE_TUNING` (P2 — the V9 tuning lab's knob surface). Dice (`rollHit`/`rollZone`) rng-injected + `seededRng` (same seed, same fight). Ground-truth law intact: perception is never imported. Scape-path numerically identical over 1,728 defined cases; the one deliberate change fills scape's bare-ranged hole with the hmsc falloff curve. 18 P4 tests green; conflicts (skill law, crouch×cover compounding, awareness wiring) surfaced in `chance.CAPTURE.md`, not picked silently.

**game/perception.ts — the detective loop (V12 capture, 2026-06-04)**
- `game/perception.ts` — REWRITTEN fresh per V12 ("combat_lab produces, scape consequences consume"): the awareness ladder as a PURE step (`perceptionStep(state, input, ctx) → {state, events}` — FoV-cone vision, exposure×proximity/reactionSeconds suspicion fill, tile-noise hearing with run/walk/crouch carry, the 0.33/0.66/1.0 thresholds with dwell timers and decay, stimulus vs confirmed-only `lastKnown`, terminal by kind, single-step cascade preserved) + scape's consequence vocabulary (WitnessMemory / the Case / 5-axis Suspicion / `computeNotoriety` weighted blend) + the display warp (`perceivedChance` — the manic UI lie; truth never touched). Consequence hooks are inert-by-explicit-design returned events awaiting story/missions. `awarenessForChance` closes the chance capture's awareness seam as a P2 table. Fidelity: 14,412 cases identical to the importable references (warp + bias + notoriety); the ladder's inline-React reference is line-verified constants + 22 meaning-tests. FIRST-CUT curves (witnessCertainty, signature weights, visual heat) flagged in `perception.CAPTURE.md`.

**game/kinds/ — the kind registries (WO-2 capture, 2026-06-04)**
- `game/kinds/` — the V4 ground-floor data layer, REWRITTEN fresh from the hmsc registries (V17-TRIAGE: capture = rewrite; the old files under `cart/hmsc-int/` stay untouched behavior references). Five families behind one door (`game/kinds/index.ts`, exported as `GAME_KINDS` through `game/index.ts`): `tiles.ts` (18 kinds; the LOCKED road grammar — lane trios, flow-neutral `junction`, walk-preferred `crosswalk` — with lane flow as table DATA `flow`/`TILE_FLOW_VECTORS`, not a naming convention), `props.ts` (16 kinds borrowing tile bundles), `npcs.ts` (4 kinds + the faction regard matrix), `roles.ts` (the open role axis), `landforms.ts` (4 kinds; every fixed-shape constant lifted into `LANDFORM_TUNING` per P2). Each family ships P4 behavior tests (`*.test.ts`, shared `game/_testkit.ts`, run under `tools/v8cli`); `CAPTURE.md` records what was deliberately not carried (dead door sub-fields, two duplicated fields) and every ambiguity surfaced.

**game/commands/ — the console vocabulary (capture wave, 2026-06-05)**
- `game/commands/vocabulary.ts` — hmsc's 49-command console vocabulary (`cmd_/lab_/gv_/pv_/ev_/wv_` plus V27 `log`) REWRITTEN fresh onto the skeleton's mutable-ctx conventions (`cart/hmsc-int/commands/registry.ts` stays an untouched behavior reference). All 49 names register so the V19 script language is complete: captured commands run against command state + `COMMAND_TUNING`/`SKY_NAMED_HOURS`/`SKY_WEATHER_PRESETS` P2 tables + `GAME_KINDS`, `GAME_PERCEPTION`, V20 persistence, and V27 `GAME_TELEMETRY` diagnostics control (`log status`, `log all on|off|toggle`, `log <channel> on|off|toggle`, `log dump`, `log overhead`, `gv_perflog` as `spikes` alias). `wv_prop` is partial (kinds listing real, placement world-owned), and 14 explicit NOT-YET stubs FAIL LOUDLY (`system not captured yet: <owner>`; `NOT_YET_CAPTURED` exports the per-owner hand-off lists — roads/traffic/buildings/interiors/zones/validation, lab scenes, input contract). Dot-path state shape (`player.physics.velocity`, `config.sky.hour`) preserved so saved scripts keep meaning. `vocabulary.test.ts` (21 P4 cases) + `compile/verify/commands.cmds`; `rjit game verify` GREEN. `CAPTURE.md` records the boundary, dropped pieces, and surfaced ambiguities. SELFSHOT-0606 (2026-06-06, USER RULING "dont look at the system") adds `shot [path]` beside the captured names: the console captures the app's OWN rendered frame to a PNG through the `captureFrame` door (`@reactjit/capture` → `__capture_frame` → `framework/gpu/capture.zig` swapchain readback — desktop/X11 capture of the user's system is BANNED, CLAUDE.md "Screenshots"); headless boots degrade gracefully ("unavailable", never fake success); the CLI sibling is `rjit shot <cart> [--route /r]`.

**game/pathing — host A* + lane discipline + motion plans (V5 capture, 2026-06-05)**
- `game/pathing.ts` (`GAME_PATHING`) — the door on the honest `__game_pathing_*` wire: grid/profile/flow publication, pre-calculated-until-disrupted routes (door-side change-rect ring), NEW `setKindClasses` (the lane-discipline opt-in) and host-COMPILED motion plans (`__game_pathing_plan` packed f64 → the exact `MotionPlan` shape; sampling stays JS closed-form per V16, zero bridge per frame; headless the `runtime/motion.ts` mirror builds the identical schedule). Implementation: `framework/game/pathing.zig` (A* rewritten from the deleted `v8_bindings_pathing.zig`; pathing_lab's `snapToLaneCenters`/`straightenJunctions` promoted host-side as RAW-cell-path passes — trio centers derived from contiguous same-flow runs, junction apexes at lane-line intersections, opt-in so un-opted callers are bit-identical) behind `v8_bindings_game_pathing.zig` (`-Dhas-game-pathing`; legacy `__path_*` names preserved). `zig build test-game-pathing` 14 P4 cases + `pathing.test.ts` 8 TS cases; `rjit game verify` GREEN. `pathing.CAPTURE.md` records sources, the deliberate improvement (discipline before merge), what wasn't carried, and the surfaced kinds/physics/V21 hand-offs.

**game/items/ — the items registry + models (V11 capture, 2026-06-05)**
- `game/items/` — game_item_gallery's ITEMS REWRITTEN fresh as DATA (`cart/game_item_gallery/index.tsx` stays the untouched behavior reference; the gallery UI + the V11 scale-audit workbench are fenced to `editors/items/`). The 19 model fns reduced to part TABLES at identity ctx (`items.ts`: 73 `ItemPart` rows — geometry-by-name, params, `#rrggbb` material, textureKey slot, p/r/s verbatim; zero React in the door); the 4 custom meshes are @reactjit/geometries-style pure generators (`geometries.ts`: blade/sail/boatHull/surfboard + `ITEM_GEOMETRY_DEFAULTS`). All 19 items `scaleStatus: 'unaudited'` — the authored numbers carried VERBATIM including the ruling's evidence (sailboat 1.35m vs knife ~1.31m, pinned by test, deliberately not fixed); `approxItemBoundsMeters` is the audit's numeric starting data. Texture keys renamed to `game-items/<id>[/<face>]`; texture CONTENT (StaticSurface labels/WGSL) stays gallery-side pending the materials capture. One door (`game/items/index.ts` → `GAME_ITEMS`). 8 P4 tests; `rjit game verify` GREEN. NO commands-stub flips (the 48-name vocabulary has no item-targeting command — an items-inspection command would be new vocabulary, surfaced not invented). `CAPTURE.md` records drops + 4 ambiguities (physics_lab catalog un-reviewed, `vehicle` item vs V10, scape's item-type layer, surfboard-as-leaf).

**game/camera.ts — the camera door (V3 capture, 2026-06-05)**
- `game/camera.ts` (`GAME_CAMERA`) — the door over the ruled split: the registry STAYS in `runtime/cameras/` and the two combat pieces GRADUATE INTO it (the one capture whose implementation home is runtime/). `runtime/cameras/rigs/aim.ts` = combat_lab's ADS over-the-shoulder rig REWRITTEN fresh as a first-class `CameraDef` — shoulder-shifted (0.62m), crouch-aware (1.62m − crouch·0.42m) pivot with a GENUINELY pitched axis (the aim-ceiling fix: screen-axis elevation == the pitch param), 2.4m ADS framing, fov 47, reference radian clamps carried bit-exact (`−1.15/DEG`/`1.0/DEG`); registry conventions adopted (degrees, pitch + = up). `aimPivot` exported as the seam for the game-side camera-collision clamp (needs physics — surfaced, not implemented). `screenRay` (R7) is now THE canonical pixel→ray in `runtime/cameras/unproject.ts` with `unprojectGround` a consumer; the two active-cart hand-rolls (`assist3d/picking.ts`, retired voxel route) re-pointed before WBITEMS-FLIP-0606 (old-cart copies await the lab rebuild per V17-LIFECYCLE). Door = `solve`/`screenRay`/`unprojectGround`/`aimPivot`/`rigs`(8)/`modifiers`, all pure. The crosshair law carried as contract + test: a fire ray is the solved camera's screen-center axis. Fidelity: 1,728-case Aim sweep + 150-case screenRay sweep identical to verbatim reference transcriptions; 13 P4 tests green. Ambiguities (the registry's yaw-convention fork, pivot-Y generalization, clamp-in-solve) in `camera.CAPTURE.md`.
- V23 native runtime (2026-06-05): `game/nativeCamera.ts` (`GAME_NATIVE_CAMERA`) is the opt-in host-controller surface. Importing it gates `-Dhas-game-camera`; `Scene3D.Camera scene3dCameraNative` (alias `nativeCamera`) binds declaratively in `v8_app.zig` on prop set, unbinds on prop unset/node destroy, and gives each camera node its own controller state. `framework/v8_bindings_game_camera.zig` keeps the old active-node host fns for `/test` compatibility and adds node-scoped calls surfaced as `GAME_NATIVE_CAMERA.forNode(nodeId)`. JS sends mode/rig params/input deltas on change only; `framework/game/camera.zig` owns per-frame Orbit/Aim solve plus smoothing/interpolation for every bound node, and `v8_app.zig` writes the existing `Scene3D.Camera` layout fields before `gpu/3d.zig` builds matrices. Native fidelity is pinned by `zig build test-game-camera`: exact TS vectors plus a `tools/v8cli` aggregate sweep (336 Orbit + 378 Aim cases), smoothing continuity, walk<->aim transition, independent two-node rigs, unbind cleanup, and rebind safety. Carts that never opt in stay on the old JS-props path unchanged.

**game/cutscene/ — the live scene format (V16 capture, 2026-06-05)**
- `game/cutscene/` (`GAME_CUTSCENE`) — V16 REWRITTEN from the ruling itself: **a format ruling with NO prior reference implementation** (oracle names zero cutscene carts; flagged in `CAPTURE.md`, built exactly what the ruling describes, no more). A cutscene is a simple TypeScript file — camera cues (CAMERA_RIGS names + params static or a PURE function of cue-local seconds for moving shots), dialog lines `{at, duration, speaker, text}` (head_lab faces render consumer-side), actor tracks (`MotionPlan[]` anchored at their own `t0` + V6 animation-DSL cues parsed once at build) — and ONE CLOCK drives all of it: `sampleCutscene(scene, t)` is the only evaluation entry, pure in (scene, t), every track answered by the delegated system at exactly the same t (`GAME_CAMERA.solve` / `GAME_PATHING.sampleMotion` / `GAME_ANIMATION.sample`). The clock is a pure value `{duration, t, rate, playing}` — advance/scrub/pause/rate/skip are data-in/data-out, so scrubbing/pause/skip fall out free exactly as ruled. `createCutscene` fails loud at build (unknown rig, cue outside the clock, bad DSL, duplicate actor). Never-baked honored structurally: the scene references live instance ids only, owns no geometry — the player's current state shows. Fidelity: **804-case sweep** asserting byte-identity with each system's own pure answer over the whole clock + backward/forward/jump-around scrub identity; 22 P4 tests green. story/missions hooks = the clock ops + `frame.done` (surfaced, not built); perception NOT wired (V16/V12 rule no seam). Ambiguities (dialog overlap policy, pre-first-cue camera hold, cuts-not-blends between cues) in `cutscene/CAPTURE.md`.

**game/story/ — narrative arcs, dialog, flags (V12/V16/V20/V22 capture, 2026-06-04)**
- `game/story/` (`GAME_STORY`) — the "more internal tooling for story/mission/dialog" V12 orders, REWRITTEN fresh as pure steps with inert returns (the perception precedent: nothing dispatches or reads a clock; `channelsFor(event)` names the bus channels as data, the shell owns busEmit and time). **Flags** = hmsc `StoryState {flags, counters}` verbatim (same-ref no-op writes, defensive `reviveStory` merge — the one sub-area with NO ruling; the reference is the authority). **The event log** = hmsc `gameEvents` machinery (`hmsc_evt_%06d` ids, 240-event ring with never-resetting serials, `safePayload` deep-copy, `parentId` provenance, importance families) with `occurredAt` as an INPUT — the deliberate purity divergence (V20 determinism; derived events inherit the trigger's stamp). `murder.committed` closes perception.CAPTURE.md's deferred item: the recorder's event id IS what `WitnessMemory.eventId`/`Case.events` reference — the chain is proven in tests against `GAME_PERCEPTION.reportToCase`, scape's mutable `discovered` recast as a later provenance event (append-only, V20). **Rules** = the two hmsc story rules as data (`lab.entered` → `lab.<id>.visited`, labeled `world.trigger.entered` → `trigger.<id>.seen`); `applyRules` is pure, returns `story.flag.set` provenance effects, and a re-fired event sets nothing twice (same reference, zero effects). **Arcs** = linear staged progressions with conditions as data (flag/counter/event — P2); cascade semantics: one call walks every consecutive state-gated stage that holds, a live event moves AT MOST one beat; `OPENING_ARC` ships V22's seven ruled beats (sky-ramp-dream → … → crime-as-a-service; gate names first-cut, stage 5's gate encodes the ruled constraint `opening.unfair-rating.cost-paid`). **Dialog** (NO reference implementation exists anywhere in the corpus): story owns WHICH lines may be said, cutscene owns WHEN — `selectDialog` over state-only gates (`createDialogSet` REJECTS event gates: gate on the flag a rule sets — V22's PROTECT THE ZERO made mechanical), priority + authored-order determinism, once-latch as a plain `said.<id>` flag, `asCutsceneCue` drops a selected line onto the V16 clock (seam proven live against `GAME_CUTSCENE.create/sample`). All knobs in `STORY_TUNING` (P2). 28 P4 tests green; `rjit game verify` GREEN. `narrative_hooks` (text, world_delta) and relationship accumulation deliberately left to missions/V21 (surfaced as shared needs). Ambiguities (flags reference-ruled, occurredAt input, first-cut opening gates, `hmsc` channel prefix) in `story/CAPTURE.md`.

**game/telemetry.ts — measurement + copy-diagnostics (V14 capture, 2026-06-04)**
- `game/telemetry.ts` (`GAME_TELEMETRY`) — the ground-floor measurement + copy-diagnostics surface REWRITTEN fresh per V14; it MEASURES only, renders nothing (the panel is chrome's — it polls this door at `TELEMETRY_TUNING.panel` cadences, scalars @250ms / JSON @500ms, and maps `fpsTone` good≥55/warn≥30/bad onto its own palette). Reads carry the GAME wire subset as table data (`SCALAR_HOST_FN`: `getFps`/`getLayoutUs`/`getPaintUs`/`getTickUs`/`__tel_node_count`; `SNAPSHOT_HOST_FN`: `__tel_frame`/`gpu`/`nodes`/`input`/`hostFlush`; the `__tel_history` ring) with snake_case→`FrameRecord` normalization and the `COUNTER_SPEC` diffable set (`zero_size` excluded — cumulative garbage, a perfWatch finding). The HONESTY RULE fixes the "diagnostics silently degrade" hazard twice over: every read tolerates a missing host fn while `availability()` names exactly which are absent, and the door file is now a metafile-gate trigger on the `telemetry` registry entry so importing `@game` compiles the `__tel_*` bindings in. V27 PERFLOG-0605 makes this the one runtime performance logging system: `DIAGNOSTIC_CHANNELS` (`frame`, `tick`, `physics`, `camera`, `figure`, `worldStream`, `bridge`, `hostFlush`, `draw`, `capture`, `hmr`, `pools`, `churn`, `spikes`) are off by default, disabled-channel cost is the boolean branch, enabled hot-path records aggregate over `TELEMETRY_TUNING.diagnostics.aggregateWindowMs`, and structured JSONL writes to `/tmp/hmsc-int-diagnostics.jsonl`. GCHITCH-0605 moved the native camera cadence probes out of stderr: `__game_camera_probe` is sampled only by the `camera` channel, `__tel_host_flush` exposes reconciler queue/drain batches, bytes, and microseconds for the `hostFlush` channel, and the startup `[probe-tick]` path was removed from `v8_app.zig`. Runtime control is `GAME_COMMANDS`: `log status`, `log all on|off|toggle`, `log <channel> on|off|toggle`, `log dump`, `log overhead`, plus `gv_perflog` as the `spikes` compatibility alias; `diagnosticToggles()` exposes settings-ready values. Copy-diagnostics = `buildDiagnostics(label, extra)` (ISO timestamp, scalars, raw blobs, frame tape, lab extras — the GAME_PHYSICS `hostMicroseconds` feed rides `extra`/`createSampleRing`) pretty-printed to `__clipboard_set` (called direct — the runtime clipboard module's IFTTT side-effect import is wrong baggage for every game cart). Every threshold/cadence/gate in `TELEMETRY_TUNING` (P2). 28 P4 tests green; `rjit game verify` GREEN. Ambiguities (sqlite3 rides the telemetry gate into every `@game` cart, the snapshot-subset choice, aggregate-only hot-path logging) in `telemetry.CAPTURE.md`.

**game/input.ts — key/pointer transport (V7 capture completed, 2026-06-04)**
- `game/input.ts` (`GAME_INPUT`) — key/pointer TRANSPORT only, completed to the ruled surface; the integrator is the host's (`framework/game/movement.zig` inside the physics step) and the TRANSPORT-ONLY test pins the fence (stateless, |intent| ≤ 1, no integrator vocabulary on the door). Keys: `__keydown`/`__keyup` bus → `createKeyState` held snapshot (case-insensitive, modifiers from the FLAGS — Shift arrives with a useless raw name (`sdl:1073742049` since `framework/key_pack.zig`) but a true `shiftKey`; the camera_lab lesson), `system:blur` clears held keys (SDL never delivers the keyup after focus loss — the PaintCanvas idiom). The control contract carried as data (P2): `INPUT_BINDINGS` = hmsc `input/controlContract.ts`'s 14 actions (implemented/reserved) with wire-true key names (`space` not `' '`; WASD only per the contract — the arrow hazard is CLOSED); `actionDown`/`moveAxes` walk the table. `moveIntent(axes, yawRadians)` ships the camera-relative DIRECTION the physics wire takes (`stepPhysics` intentX/intentZ) — the deliberate JS twin of `movement.zig wasdDirection` (no V8 binding exists; fidelity-pinned; retires if one ships). Pointer: `readPointer` (`getMouseX/Y`, `getMouseDown`, `getMouseRightDown`), `readPointerDelta` (`__mouse_delta`, the mouse-look feed), `setPointerCapture` (`__mouse_capture`, honest transport report), `onCursorMove` (`system:cursor:move`). Typing gate: `isTextEditing()` via `__tel_input.focused_id` so WASD never walks the player mid-typing (input.ts added as a metafile trigger on the `telemetry` registry entry). Honesty rule carried from telemetry.ts: `availability()` names every missing pointer/typing-gate fn. 15 P4 tests green. **HAZARD CLOSED (2026-06-04): arrow/function/nav keys were dead on the `__keydown` wire** — `engine.zig` packed `sym & 0xFFFF`, truncating 0x4000xxxx SDLK codes into printable collisions (LEFT=`'p'`, UP=`'r'`, RIGHT=`'o'`, DOWN=`'q'`). Fixed at the encoding: `framework/key_pack.zig` owns the one `(mod<<32 | sym)` packing (< 2^48, exact in the bridge f64); engine.zig produces it, `ifttt/ifttt.zig` + `useIFTTT.ts decodeKey` decode it (JS via arithmetic div/mod), and the arrow/fn/nav names are live. Pinned by `zig build test-key-pack` (P4, 5 tests). Ambiguities in `input.CAPTURE.md`.

**2D paint surface**
- `PaintCanvas.tsx` (the largest file) — the bottom-left authoring quad, ONE Painter since PAINTER-0610 (req_0593): one active tool (Select/Paint/Erase), one active target (the `Layer` union paint/height/place/zone/road, shown as TILE/TERRAIN/OBJECT/ZONE/ROAD in the bottom `TargetDock`), many VISIBLE channels. Every focused chunk is one `<ChunkSurface>` running the COMBINED `painterView.wgsl.ts` shader (tile ground + analytic road ribbon + height tint/contours + zone tint in one pass, weighted by a per-channel emphasis header; `encodePainterSurface` in `painterSurface.ts` always emits every section with explicit headers — GHOSTROAD-0610). Input is ONE cutout `<Pressable>` overlay (same-node down/move for pointer capture, rails rendered after it to stay clickable) driven by `painterBehavior.ts` `resolvePainterBehavior` → `stroke | click | select | none` ('none' on Object+Select keeps native `Canvas.Node` drag alive); per-target stamping dispatches through a capability table. Erase works on EVERY target (tiles/zones clear, terrain lowers, unlocked objects under the brush delete, the road stroke under a click deletes); Select is universal + most-specific (placement → build piece → road → cell). The left rail is one `PainterRail` of composable cards (universal ToolCard, shared BrushCard, per-target cards, selection-driven ObjectInspectorCard); channel eyes persist per map (`MapPayload.channels`) and dim/hide inactive channels (road wires stay as dim polyline landmarks; per-node glyphs stay road-active-only under the 512-children cap). "+" ghosts on open sides grow the map. Alt-drag pans; WASD pans via the Canvas `drift*` props when this quad owns WASD focus. Host calls: `__canvas_screen_to_graph` (pointer→graph coords, the same telemetry binding pixel_icon_demo wraps) and `__tel_input` (focused-node check so typing in an input never paints); key state via `__keydown`/`__keyup`/`system:blur` bus. P4: `editors/world/painter.test.ts` (resolver truth table, tool usability, combined-buffer section offsets).
- `ChunkSurface.tsx` (72) — one chunk = one Effect quad; owns its coalesced GPU buffer (`usePaintedField`) and picks the layer's shader; registers a flush so a stroke re-uploads only its chunk.
- `usePaintedField.ts` (54) — the de-thrash core: brush `touch()`es at input rate (~100/s), encode+upload coalesce to once per frame (rAF/setTimeout-16). Decouples input rate from GPU upload rate.
- WGSL views: `heightTileView.wgsl.ts` (height tint over tile ground — sculpting keeps tile context), `zoneView.wgsl.ts` (tile ground + translucent zone tint in ONE quad — no Effect-over-Effect alpha). The painted ground itself uses the game's `HEIGHTFIELD_TILE_SHADER` (`render3d/heightfieldSurface`) directly: the editor paints with the very shader the game drapes terrain with — one source; what you paint is what boots. (The `tileField.wgsl.ts` re-export shim and the superseded `heightField.wgsl.ts` elevation-ramp view were removed in the 2026-06-11 fallow sweep.)
- `BrushRail.tsx` (215) + `railAtoms.tsx` (173) — the per-layer left rail (tools, tile palette, brush size/shape/profile, height mode brush|ramp with ramp params, zone list) from shared rail atoms (ToolBtn/Swatch/sliders/steppers).
- `chunkFloor.ts` (95) — the painter→preview bridge: each focused chunk becomes a `ChunkFloor` {tileData, heights, hver} with **stable per-chunk identity** (the fix for the preview re-bake choke — rebuilt=1 reused=N−1); `floorsToLandforms` lowers floors to real `'heightfield'` Landforms so the preview and compile use the game's own terrain type.

**3D preview + inspection**
- `IsoPreview.tsx` (200) — free-fly no-clip camera (drag look, WASD fly, Q/E up/down; only while this quad owns WASD focus), fog off, far clip pushed out; world drawn by `WorldStatics` + the full capture family (Landform/Building/Prop/Part surface captures) so floors and facades texture exactly as in-game. Camera pose persists per map and autosaves on settle.
- `PropertiesPanel.tsx` — the top-left **per-instance** inspector: bespoke header banner (swatch + gauges + profile radar drawn with `Graph` primitives) over a data strip that EMITS a `PanelSpec` rendered by `shell/fields.tsx` PanelGroups (PROPSFOLD-0610, review §5.2 — the second property-panel renderer is dead; overridable tile rows are real num fields, entry+slider, with the reset rider as clear-to-default; `t:'bool'` grew the same reset rider in the one renderer). Focus precedence: tile *selection* (bulk overrides) > selected placement (one-object world via `objectPreview.ts`) > active paint tile. Face-skin picker shows live mini-renders of real facades (`StaticSurface`).
- `RightPanel.tsx` + `tabs/` — right quad: Objects (breadcrumb browser over building/prop/tile/embedded/marker/assistant categories + `ModelViewer`/`ObjectInspect3D` + shared PropertiesPanel; green + places), Notes (TextArea persisted in the map payload), Chat (`useAssistant` claude_code chat, lazily armed). The Settings tab retired (SETFOLD-0610, L4: one settings door — the chrome SET door → the bench settings source); its controls live with their subjects: grid toggle on the painter rail, pane reset = double-press the QuadSplit knob, notes clear in NotesTab. ObjectsTab's palette state is twigged (TWIGSWEEP-0610) and PrefabInfo renders a bill of materials (BOM-0610) instead of the per-piece dump.
- `ModelViewer.tsx` (116) — single-object studio viewer: no skybox/fog, OrbitCamera solved cart-side, drag via the global cursor channel, wheel zoom (notes `<Scene3D.OrbitControls>` is a host-side stub).
- `ObjectInspect3D.tsx` (139) — *pickable* viewer: click a part (deck, pillar, panel) to texture it; parts from the game's `buildingParts`/`propParts`; ray from the same solved camera that renders, so picks are exact.
- `objectPreview.ts` — builds a one-object mini-world via the real mutators so inspection resolves identically to the map.
- `TexturePreview.tsx` — one swatch component for both texture kinds (react-authored facade markup vs shader `Effect` with frozen data) — "texture is one concept."

**Routes (under `@reactjit/router`, hot-persistent via `hotKey`)**
- `/` editor · ~~`/log` `LogView`~~ (DEAD at WBSTEP9-FLIP-0607 — the workbench LOGS source streams the V27 diagnostics/churn channel now) · ~~`/textures` `TextureStudio`~~ (DEAD at WBMATERIALS-FLIP-0607 — the workbench MATERIAL source owns catalog/ShaderLab/Materialize; stale here until the step-10 audit) · `/assist3d` (below) · `/test` `editors/play/PlayRoute` (PLAYFOLD-0605, 2026-06-05 USER ASK "its the same game … fold it so that i can just toggle between them with the F keys like f1 f2"; same day the /build URL retired as a dupe of the folded surface: ONE route, ONE embodied game surface — mode is PlayRoute's own state, **F1 test / F2 build** flip it in place with NO remount; pose, camera, mouse capture, the backtick console, and the placed pieces carry across the toggle. The chrome strip keeps one Play button; '/build' survives only as the session channel label + twig storage keys. TEST mode = the TestRoute lineage in full (rewired 2026-06-04 per `TestRoute.REWIRE.md`; SUBSTRATE-0605: the drop-in lives in `Embodied.tsx`): the backtick console (live speed owner, teleport adopt-back — now opens in BOTH modes; build hotkeys gate while it's open), the RMB ADS aim opt-in (test mode only; the substrate folds the camera back to walk on a mid-ADS mode flip), the `[probe-player-model]` diagnostic (test mode only). BUILD mode = the BuildRoute lineage in full, below. Placed pieces render AND collide in both modes). `/items` and `/voxels` retired at WBITEMS-FLIP-0606; the Workbench item source owns ITEM/SCULPT/VOXEL now.
- **`Embodied.tsx` — the SHARED EMBODIED SUBSTRATE (SUBSTRATE-0605,
  2026-06-05).** The drop-in player scene exists exactly once, extracted FROM
  TestRoute (the USER-VERDICT-hardened lineage) after /build shipped a
  wholesale copy whose camera never engaged (CAMGONE-0605: module-level
  `bindFirst` with no `nativeCamera` node) and whose gait was the stale
  quantized path. `useEmbodiedPlayer(options)` = world grid/colliders/
  heightfields through GAME_WORLD (mode layers extend via
  `EmbodiedWorldExtras`), GAME_INPUT key transport, the frame loop
  (GAME_PHYSICS host step, V7 camera-relative WASD, footing feel, idle-rest
  epsilon, honest kinematic fallback), the V23 node-bound native camera
  (`GAME_NATIVE_CAMERA.forNode` on a `<Scene3D.Camera nativeCamera ref>`
  node; optional ADS aim layer), CAPTURED-MOUSE look (addendum 4: entry/
  viewport click consumes the mouse via `setPointerCapture`, look rides
  `readPointerDelta`, a captured click IS the mode layer's `onTap`, Esc
  releases — no drag heuristics anywhere), the V2 figure + continuous gait.
  Components: `<EmbodiedCaptures>` / `<EmbodiedScene>` (route 3D as
  children) / `<EmbodiedMouseSurface>`. Exports `PLAYER_CAMERA` (the one
  camera tuning truth), `groundColumnTop`, `normalizeYawDegrees`,
  `PlayerPose`. Pinned by `editors/build/viewport.test.ts` so a per-route
  embodied copy cannot reappear. The GAP(W-2)/(W-3) markers ride here now.
- **`EmbodiedHud.tsx` — the Fortnite-verbatim game HUD (HUD-0605,
  2026-06-05).** USER ruling ("just make a normal game hud … take the same
  idea as fortnite. verbatim"), composable beside the substrate so every
  embodied route can mount it; /build is the proving surface. Layout per the
  user's annotated reference: TOP-CENTER compass strip (headings + degree
  ticks; objective/target markers ride it bearing-relative — the look shadow
  sampled on a coarse clock, whole-degree re-renders only); TOP-RIGHT
  minimap (north-up, player-centered; regions colored by the GAME_KINDS
  render color, buildings + placed-piece blips, marker blips) + the key
  info block; LEFT-MIDDLE game status updates (the session's labeled
  commits); BOTTOM-LEFT health bar (the player door) — NO stamina
  (excluded) and shields render as a HAND-OFF row (no damage system door —
  never a fake number); BOTTOM-RIGHT equipment hotbar (player.inventory
  through GAME_ITEMS; empty = honest hand-off) with the blueprint selection
  ABOVE it (the ruled 1/2/3/4 categories — keys and HUD agree) — NO
  material amounts (excluded). Chrome = the `Hud*` class family in
  `studio.cls.ts` over new `hud*` tokens in `theme.ts` (no raw colours);
  every feel number in the P2 `HUD_TUNING` table.
- BUILD MODE (F2 on `/test`) — CREATIVE BUILD MODE (V24; since PLAYFOLD-0605
  the build mode of `editors/play/PlayRoute` — the /build URL retired as a
  dupe): build the
  map WHILE PLAYING. The shared embodied substrate (which FIXED the launch
  camera — see CAMGONE above) + the V24 builder vocabulary on one surface,
  wearing `EmbodiedHud` (the blueprint chips live in the HUD's bottom-right
  slot; the snap target is the compass/minimap marker; commits are the
  status feed): crosshair → snap target (`editors/build/snap.ts`, the
  catalog entry's OWN snap mode) → registry-driven palette (RULED hotkeys
  lead the display: 1 floor · 2 wall · 3 ramp · 4 roof — USER VERDICT,
  addendum 2) → ghost preview → captured-mouse click places (ONE labeled
  session commit per interaction on the WORLD channel; Esc frees the mouse
  for the palette) → R rotates → E cycles WallEdit on the targeted piece →
  P-marked pieces clone into a named prefab → stamps decompose to semantic
  pieces. The world stream's materialized state is the one placed-piece
  truth. See `editors/build/CAPTURE.md`.

**assist3d/ (AI scene authoring)**
- `scene.json` is the single source of truth; `MeshSpec` = raw geometry primitive (6 shapes), deliberately NOT a game kind — bridging into placements is a separate step. Three backends in `backends.ts`: `claude_code` (subprocess **writes scene.json itself** via its Write tool), `openai_compat` and `local_ai` (llama.cpp GGUF) call a `set_scene` tool and the **cart** writes the file (plus a fenced-JSON fallback). `useSceneAssistant` hides the difference; `useAssistScene` watches the file; the Objects tab's ASSISTANT category browses the same file. `picking.ts` — screenRay (same unexported-camera-math duplicate family) + **AABB slab pick, not sphere** (sphere fails for flat slabs: camera ends up inside the bounding sphere). `modelHistory.ts` remembers local GGUF paths.

**Diagnostics**
- `perfLog.ts` (153) — V27-folded churn recorder. `useChurn` still names which state drove a whole-cart re-render, but writes through the `GAME_TELEMETRY` `churn` channel into `/tmp/hmsc-int-diagnostics.jsonl`; `log churn on|off` controls it live.
- `editLog.ts` (90) — the *semantic* event trace (categorized EditNotes: tile/height/zone/chunk/object/camera/map), capped ring persisted to `sessions/_eventlog.json` (survives hot reload; not in the import graph so writes can't loop), shown in the chrome strip's popover (`shell/chrome.tsx` `EventLog`) with per-category colours and ~600ms coalescing for continuous edits.

## Host functions vs JavaScript functions

- **Localstore**: `hmscStoreGet/Set` (game-side wrappers over `__store_*`) for the boot key, kind textures, materialized textures. The compile channel.
- **fs**: session files, `_eventlog.json`, diagnostics JSONL/churn channel, voxel exports, scene.json (cart-write backends), via `__fs_*`.
- **Canvas math**: `__canvas_screen_to_graph` (pan/zoom-aware pointer→graph; `framework/v8_bindings_telemetry.zig`) — here it's *live*, unlike pixel_icon_demo's dead wrapper. `__tel_input` (focused-node id) gates WASD/brush against typing.
- **Canvas camera**: `viewX/viewY/viewZoom` + `driftX/driftY/driftActive` props (host-applied pan, the canvas_view_control_props seam) for alt-drag and WASD pan.
- **Input buses**: `__keydown`/`__keyup`/`system:blur` (key state for WASD + modifiers), `system:cursor:move` (global cursor channel from `SDL_GetGlobalMouseState` — divider drag, orbit drag).
- **AI**: `useAssistant` (claude_code subprocess / OpenAI-compatible HTTP / embedded llama.cpp) for ChatTab + assist3d.
- Everything else is JS/GPU: typed-array buffers, RLE codec, Effect storage buffers, the game's own world mutators.

## Cross-cutting patterns this cart canonizes

- **Author-with-the-game's-own-code** (mutators, renderer, terrain shader, parts lists) as the anti-drift strategy — the strongest statement of it in the repo.
- **Coalesced GPU paint** (`usePaintedField` + per-chunk buffers + stable chunk keys) — the scale answer for brushed surfaces; the stable-identity rule exists because per-rectangle churn *crashed wgpu mid-draw*.
- **Thin-reference persistence** (mapStore's globals rule + name-keyed tile legend) — the multi-map workspace's data philosophy.
- **Workspace pattern, third consumer** (after cutout, composer) — here with v2 payload carrying the whole world, per-map cameras, synchronous `flushCurrent` before map switches, and undo snapshots taken at *action start* (`onEditBegin`) rather than on change.
- **Settle-snap**: native drag streams raw positions, a 140ms quiet timer quantizes to the compile's cell rect — `placementCellRect` is the ONE shared snap across canvas node, preview, and compile.
- **Two texture scopes**: top-left panel = per-INSTANCE; right-rail Objects = per-KIND global (shared store + bus broadcast); merged at preview/compile with instance winning.
- **Diagnostics as modules** (`GAME_TELEMETRY` diagnostics channels + perfLog/LogView/useChurn + editLog) — switchable, file-backed, aggregate-only on hot paths; churn is folded into `/tmp/hmsc-int-diagnostics.jsonl`, editLog remains the semantic session trace.

## What is not here / open seams

- The `worldFile.ts`/`assets.ts`/`assetPrompt.ts` world-as-.tsx authoring lane was REMOVED in the 2026-06-11 fallow sweep (never wired into the main flow; git history is the archive). The GameState lane is the only authoring model.
- `AGENTS.md` names `MapCanvas.tsx` (now `PaintCanvas.tsx`) — doc drift inside the cart's own contract.
- Tile **overrides** serialize with the map but runtime consumption game-side is not wired (per the tile-overrides memory).
- assist3d meshes don't bridge into placements yet (deliberate, but the step doesn't exist).
- perfLog's standalone churn file is retired by V27; remaining churn probes are a diagnostics channel and should be deleted only when their call sites stop being useful.
- No collaborative/locking story despite parallel sessions editing the same sessions dir (menu refresh-on-open is the only concession).

## Glossary

Chunk: One 120×120-tile unit of the sparse world grid; owns its tile/height/zone typed-array buffers; renders as one Effect quad.

Compile: Persist the staged `GameState` to the shared `'hmsc'/'game-state'` localstore boot key (`saveGameState`) — a deliberate button, not an autosave.

ChunkFloor: The painter→preview snapshot per focused chunk `{tileData, heights, hver}` with stable identity; lowered to real heightfield Landforms by `floorsToLandforms`.

Focused chunks: The subset of chunks currently rendered/edited (focus filter); only these mirror to the preview.

Global cursor channel: `system:cursor:move` — host-pumped global mouse deltas (SDL_GetGlobalMouseState) used for divider and orbit drags instead of per-node mouse-move.

Kind texture: A GLOBAL partId→textureId map stored per `cat:kind` in the shared 'hmsc' store; every instance of the kind wears it unless an instance override wins.

Layer: The active paint mode of the 2D canvas — paint (tiles) / height / place (objects) / zone — deciding rail contents and which WGSL view draws.

Map: One named world project = one session file; thin references into shared registries, RLE-encoded buffers, view + camera + brush + overrides in the payload.

Materialize: Freeze a tuned shader recipe's current params into a named stored material (shared 'hmsc' store) that joins the one texture registry.

Override (tile): A per-cell `{dotted-path → value}` patch on top of the cell's tile kind; bulk-edited across the current tile selection; kind never changes.

Placement: A 2D-authored instance `{cat, kind, pose, locked}`; lowered through the game's own mutators into the preview/compiled world; footprint/label always re-resolved from kind registries.

Settle-snap: Store raw coords while a native drag streams, then quantize to `placementCellRect` after 140ms of quiet — no fight with the host-owned drag.

Tile selection: Pointer-tool click (+ctrl-click) group of cells — the bulk-override focus shown in the top-left panel.

WASD focus: Exactly one bottom quad (canvas pan vs preview fly) owns the WASD keys, claimed by click, persisted per map.

worldRev / viewRev / worldEpoch: Autosave trip counters (stroke edits / camera settles) and the remount key for PaintCanvas on map open.

## The game/ ground floor + compile/verify (added 2026-06-05, Milestone-0 steps 1–2)

`cart/hmsc-int/game/` is the V17 ground floor — `game/index.ts` is the ONLY
door, exporting the 19 standard `GAME_*` names. Live at milestone-0:
GAME_PHYSICS (typed wire wrapper over the honest `__game_physics_*` bindings —
`v8_bindings_game_physics.zig`, re-pointed 2026-06-05 when WO-1 landed; it does
NOT fall back to the legacy `__hmsc_*` aliases, so a missing honest name
surfaces a broken `has-game-physics` gate instead of masking it),
GAME_PATHING (door over runtime/pathing.ts + runtime/motion.ts — still the
`__path_*` names; no honest alias registered yet), GAME_INPUT
(transport only, V7), GAME_CAMERA (the pure side of @reactjit/cameras;
solveCamera extracted to runtime/cameras/solve.ts; V23 adds opt-in
GAME_NATIVE_CAMERA so the host owns per-frame camera integration), GAME_LOOP (clocks only —
NO loop API per R3; the V8 45/min cadence + frame transport), GAME_COMMANDS
(registry + hmsc-dialect parser — the V19 scripting surface), and GAME_KINDS
(the five kind tables, captured by its own lane). The rest export an honest
`{ status: 'capture-pending' }` so the standard import line already resolves.
`@game` is a bundler alias for this directory (cli/cart/bundle.ts) and the
V18 metafile-gate signal. Every family carries a P4 `*.test.ts` beside it
(bundle with tools/esbuild, run under tools/v8cli).

`cart/hmsc-int/compile/` is the V19 skeleton: `rjit game compile` bundles
`compile/main.ts` → `zig-out/game/hmsc-headless.js`; `rjit game verify`
compiles fresh, runs the oracle self-check over `docs/game/_index` (every
record file parsed and validated against the fields `tools/oracle` actually
dereferences, `decisions.ts` ids checked, plus 14 system smoke queries), runs
every `game/**/*.test.ts` suite, then boots the output headless under v8cli and
replays every `compile/verify/*.cmds` command sequence, exiting with one
`VERDICT GREEN/RED` line. The milestone-0 world is a state skeleton (boot /
tick / status / help); it grows as captures land — the green light exists from
day one and never goes dark.

## The labs route + scaffold (added 2026-06-05, Milestone-0 step 3)

`cart/hmsc-int/labs/` holds the experiment slots (V13/V17/P5): `_scaffold.tsx`
(+`_scaffold.notes.md`) is the template `rjit lab new <name>` copies — a lab is
`@game` imports + an exported scene, nothing else, with the paired
`<name>.notes.md` as its P6 contract (read by humans, AI, and the oracle).
`labs/index.ts` is the registry the CLI maintains at its `rjit:` markers.
`cart/hmsc-int/shell/LabsRoute.tsx` is the first shell/ piece — the `/labs`
route (chrome FlaskConical button): lab list on the left, the loaded scene
center, the notes always beside it. Shell stays game-agnostic: the lab list
crosses in as plain data at the router. The remaining index.tsx→shell/
inversion is the editors-capture lane.

## The data/ persistence layer (added 2026-06-05, Milestone-0 step 4)

`cart/hmsc-int/data/index.ts` is the V20 layer — `openStore(rootDir)` is the
only door. Per-concern append-only streams, one TOTAL cross-session undo
chain (a global sequence number across all streams; an undo point is a log
position — `stateAt(seq)` reads as-of, history is never rewritten), and
materialized snapshots (`data/snapshots/<name>.snapshot.json`, stamped with
their chain position) — the game/compile loads snapshots, never history. The
incompleteness guard is in the API: `defineStream` demands the log name AND
the materializer (initial+apply) in ONE registration — a stream without
snapshot support cannot be expressed.

SNAPBOOT-0610 (structure review §1/§9.1): the TOOL boots the same way the
game loads — `defineStream` reads the stream's snapshot and replays only the
tail (`seq > snapshot.globalSeq`), so boot cost is O(tail) instead of
O(every event ever logged). The seam is guarded: snapshots carry the
folded-event count (`events`) and boot verifies the DB agrees
(`COUNT WHERE seq <= globalSeq`); a mismatch (e.g. a legacy archive ingested
after the snapshot), a pre-SNAPBOOT snapshot shape, or damaged snapshot
bytes all fall back to the full replay — tolerance law, never a throw. The
full log is no longer resident in JS heap; `stateAt(seq)` is an honest cold
path that pages history back in from the DB (history stays the immutable
truth even when the live state booted from a snapshot). Covering index
`events(stream, seq, id)` keeps the seam count + tail query index-range
reads.

BACKING (STOREDB-0606 step 1, 2026-06-06 — the user's ruling after the
sessions.jsonl:884 outage: "we need to move to pg or sqlite which are in the
framework already"): streams live in ONE sqlite database, `data/store.db`
(WAL + `BEGIN IMMEDIATE` write transactions via `@reactjit/hooks/sqlite` →
the `__sql_*` ingredient). The `events` table is append-only (INSERT-only
module), per-concern streams are the indexed `stream` column, and the global
seq is allocated as MAX(seq)+1 INSIDE the write transaction — N concurrent
app instances (user session + census walks + headless boots) serialize
instead of tearing records or double-minting seqs (the :884 mechanism and
the duplicate-seq-4077 race, both proven dead by the two-writer-PROCESS P4
hammer test). `data/streams/*.jsonl` is now the read-only INGESTED ARCHIVE:
openStore imports any not-yet-imported records byte-faithfully (raw line
preserved; tail-incremental, so old-code instances appending during cutover
lose nothing), quarantines corrupt records, and NEVER writes the files —
the user retires them. Only the backing changed; V20's law text needed no
edit (it never named jsonl).

TOLERANCE (STOREDB-0606 step 0): the reader NEVER throws — a corrupt/partial
record anywhere (archive ingest or a damaged DB row) is skipped, logged
loudly (console.warn + worldStream telemetry), and quarantined in memory
(`store.quarantine()`, byte-faithful `{path, line, raw, trailing}`); the
fold continues with every valid record and nothing on disk is ever rewritten
(no repair writes). A failed WRITE (transaction error) does throw — routes
surface store errors. Backup story = `store.exportBackup()` (per-stream
.jsonl dump straight from the DB — byte-identical for ingested history — +
manifest); restore = drop store.db, place the dump in `data/streams/`,
re-ingest. Content (store.db + streams/ + snapshots/) stays gitignored. P4
suite `data/data.test.ts` rides `rjit game verify` (suite roots: game/ +
data/); scratch stores are DBs now, so every suite's wipe also removes
`store.db{,-wal,-shm}`. `apply` receives each event's log position as an
optional third arg (`apply(state, event, seq?)` — the store always passes
it; two-arg materializers and the tests' direct-apply idiom stay valid).

## The route-scoped session history (added 2026-06-04, the user's ruling)

`editors/sessions.ts` — "route specific session commit histories... sprinkle
in the edit commits after each interaction" (the user's words) made live on
the V20 store. A route opens a SESSION on its concern channel; every
interaction appends one LABELED edit-commit. The `sessions` stream records
lifecycle only (opened/committed/closed markers, folded with each marker's
log position); content events stay in their concern streams, so the one
global sequence orders the whole history cross-channel and an interaction's
undo point is its commit's position. `sessionsOnRoute(state, route)` answers
"what did I do this session, on this route". Two commit grades:
`commit(event, label)` (content + marker + snapshots — `/vehicles`, every
control press labeled like `car-1: style → van`) and `note(label)`
(marker-only — the `/` map editor's logEvent funnel; its world content still
saves through the workspace session files UNTOUCHED, and content events join
the same `world` channel later by addition). `editors/store.ts` grew
`editorChannel(def)` (route-safe cached defineStream on the one live store —
remounts can't double-register; a private openStore in a route would fork
the undo chain, which is exactly what the /vehicles rewire removed).
`createSessionLog(store)` is the testable door, `editorSessions()` the live
singleton (the roster.ts split). P4: `editors/sessions.test.ts` (7 cases:
commit append, boundaries, scoping, cross-channel ordering, undo-point
resolution, replay identity, snapshot growth) +
`editors/vehicles/roundtrip.test.ts` (pure edits → session commits →
snapshot → fresh-store reload → buildVehicle byte-identical; labels +
boundaries survive; pre-wreck undo point resolves undamaged). Adoption
hand-off for the characters lane: `editors/SESSIONS.md`.

### AUTOSAVE-0605 — autosave parity across every route (2026-06-05)

USER RULING: "every one of these routes needs to have its own auto-save
system that stores to its own commit on the session like the home page
does." V20's floor ("stateless design, saved at every micro change") applied
shell-wide; a route without autosave-to-its-channel is a V20 violation, not
a missing feature. The sweep:

- `/` map editor — the reference (workspace micro-save + world-channel notes).
- `/vehicles`, `/cutout` — already green (per-edit commits / draft autosave;
  /cutout's lifeline now lives in the workbench PAINT bench, CUTOUTFLIP-0606).
- `/characters` — the draft auto-commits debounced to the characters channel
  (`autosave · <name>` undo positions); mount restores the last roster entry.
- `editors/voxels/stream.ts` — the working blockout stream; after WBITEMS-FLIP-0606
  the standalone `/voxels` route is retired and the Workbench item source VOXEL lens
  owns restore/autosave/export behavior. P4: `editors/voxels/voxels.test.ts`.
- `/textures` — NEW `editors/materials/stream.ts`; Materialize/delete are
  labeled commits (the commit IS the autosave); the legacy localstore keeps
  serving renderers unchanged.
- `/assist3d` — NEW `assist3d/stream.ts`; the scene auto-commits through the
  ONE watcher funnel (covers tool-call writes, streamed extracts,
  claude_code's own file writes, hand edits); `scene.json` stays the live
  rendezvous; prompts ride as notes.
- `/labs`, `/log` — N/A (author nothing; labs are git-tracked code, the log
  is a viewer). `/test`, `/build` — wiring owned by the substrate lane
  (requirements handed to the supervisor).

## game/figure/ — the character kit (V2/V2-AMENDED/V1 capture, 2026-06-05)

The head_lab kit REWRITTEN fresh (cart/head_lab untouched — behavior
reference; its editor UI is fenced to a later editors/characters/ wave).
Shape: `shapes.ts` (the P2 data layer — part presets, 8 body shapes, garment
palettes, LODs), `skeleton.ts` (25-bone FK, action-modulated; bone-record
place/offset/blend helpers), `assembly.ts`/`clothing.ts` (bones-driven parts,
sockets, finger fans, garments), `rig.ts` (the dressed BodyRigFrame; RULED
damage zones lArm/rArm/lLeg/rLeg over oriented-box hit volumes, all 25 bones
mapped; semantic anchors; `buildRigFrameFromBones` = the V1 seam), `hed.ts`
(.hed codec, one-shape color+relief law, deterministic face animations,
seeded generateFace), `body.ts` (.body codec, legacy-part validity),
`ragdoll.ts` (the V1 CONTRACT: seam + RAGDOLL_TUNING data — deliberately NO
solver; the host feature is the physics lane's, validated against the
archived JS reference), `bake.ts` (THE BAKE ENTRY: documents/seeds in →
deterministic host-shaped BakedFigures out; `partGlobeParams` is the one
param recipe render and bake share), `render.tsx` (EDITOR/LAB PREVIEW path
only per V2-AMENDED; React-free door keeps headless verify clean). 24 P4
tests across four suites ride `rjit game verify`; CAPTURE.md records drops +
ambiguities (P2 grain in the FK, visual-height canon, texture-key prefix,
ragdollHostReady=false until the binding exists).

PELVISMESH-0606 (USER ASK req_0022): the pelvis is a REAL PART — its own
PartId/preset/LOD/regions, an ASSEMBLY instance on the pelvis bone with the
dead pelvisSocket's exact sizing (×1.18), sculpt/grab/paint-editable like any
part and listed in every part roster (/characters, the workbench character
stage, the /cutout MODELS rail). LIMBPAINT's pelvis paint SEGMENT folded into
the part: the string `'pelvis'` keeps meaning (same 512×256 unwrap, now the
pelvis mesh's own), `PAINT_TARGET_NO_PART_FALLBACK` emptied (the
two-sets-of-tits cascade is dead structurally; the editors' bare-torso
captures died). V20: `body.ts partsWithPelvisFallback` maps pre-split docs
deterministically — pelvis = torso sculpt+profile copy (what the socket
displayed) — at parseBody/draftFromDocument/bakeBodyDocument/ModelPreview;
generated citizens copy the torso's profile/grid with zero extra rand draws
so pre-split seeds keep their look. Damage zones unchanged (pelvis bone stays
`torso` — splitting the ZONE is constitution-grade, surfaced not done);
bottoms were already pelvis-bone-driven; hitboxes per-bone unchanged.
Counts: 27 assembly instances (was 26), 8 anatomy sockets (was 9).

CLOTHSPLIT-0606 phase 1 (USER RULING req_0040 — "clothing should effectively
be a prop that is seperate but tightly related, not entirely coupled"):
clothing is a wardrobe ATTACHMENT family. `outfit.ts` (new) defines
`OutfitDocument` {top, bottoms, print, accessories} — its own document riding
the body as ONE optional channel (the paint precedent), never interleaved
with the mesh truth; `attachOutfit(bones, outfit, ...)` dresses an EXISTING
bones record (the V1 seam — a ragdoll keeps its clothes; placement code in
clothing.ts byte-identical). `rig.ts` splits `MeshRigFrame`/`buildMeshFrame`
(the clothing-free body — what mesh editing looks at; the phase-2 editor
mounts it) from the dressed `BodyRigFrame`; the dressed doors keep their
signatures and compose mesh + attachOutfit (equality pinned). V20:
`buildBody` writes `outfit` only; the legacy loose fields stay readable
forever through `outfitOf` (deterministic mapping incl. the DEFAULT_BOTTOMS
coupling), consumed at draftFromDocument + bakeBodyDocument; `bodyWithOutfit`
is the pure attach/detach door (attach clears legacy — one wardrobe truth;
detach round-trips byte-identically). BakeWardrobe retired for `BakeOutfit`.
Phase 2 (editor separation, 2026-06-06, same ruling) LANDED: three workbench
contexts over ONE `characterWorkbenchStore()` — **character** (`User`) shows
MESH ONLY (identity/part/body-shape/face-mesh/sculpt/regions; its stage
renders `buildMeshFrame` UNDRESSED, no garments, no held prop, no animation
clock ever ticks there — the face pins 'still'); **clothing** (`Shirt`) is
the wardrobe attachment context (OUTFIT clothes/bottoms/print + EXTRAS +
held PROP; stage = the dressed figure via buildRigFrame, static pose);
**animation** (`Clapperboard`) is the rig/posing context (POSE rig/anim +
FACE anim + SCRIPT/presets; stage = the dressed ANIMATING figure — the
pre-split face/rig/script clocks moved there wholesale, scriptMouth fold
identical). The rosters mirror (the outfit is per-character); panel writes
flow through the same editDraft/autosave/V20 doors; the pre-split
wearLens "show me what I changed" flip is structurally fulfilled (those
stages always show the dressed figure) and removed from the relocated
setters — kept only on body-shape (mesh-side). One render derivation
(`editors/workbench/characters/figureFrame.tsx` useFigureRender +
FigureCaptures) feeds all three stages; capture keys stay in lockstep with
mesh texKeys per stage. Line-referenced parity ledger:
`editors/workbench/WBCLOTH.CAPTURE.md` (nothing dropped; parity pinned
mechanically in source.test.ts — the three panels collectively expose every
pre-split control, and the mesh panel exposes zero wardrobe/animation
fields). The /characters route is untouched (dies at its own flip).

## game/activities/ — repeatable side loops (V22/V8/V20 capture, 2026-06-04)

The non-mission gameplay verbs, REWRITTEN fresh. V22-MODES is the binding
ruling: the SAMP/VCMP-tested verb space (role, rob, chase, evade, race, jump,
accumulate), each a DISTRIBUTION PRESET of the V21 machine, never a new
system — `verbs.ts` ships the presets as frozen data in V21's own ruling
vocabulary (cop/civilian/traffic weights, temperature/convergence bias,
promotion budget); the V21 lane owns interpretation. `defs.ts` is the P2
table layer: `ActivityDefinition` = stages (ticks / signal / signalWithin
advance rules, durations in STATE TICKS — the V8 ~45/min cadence consumed
through GAME_LOOP), the scape `Quest.reward` row verbatim, repeat
auto/manual, optional quality policy; `defineActivity` validates loud at
table-build time and is exported for labs. Shipped tables: `dealing`
(scape's designed earn loop — cook 3 ticks, deliver within 12, quality
scales payout from a 0.4 floor, sloppy below 0.35 raises heat 12 and still
pays) and `street-race` (ruling-derived, proves table-generality). `run.ts`
is the pure engine (one stepRun call = one state tick; signals first, then
the tick counts; deterministic per R6; events are inert returns — heatRaised
is the V12 hook surfaced, not built; failed runs always revive — V22's
failure-degrades-never-ends). `stream.ts` registers the V20 `activities`
concern in one StreamDef (engine events in, life totals + heat
materialized). 25 P4 tests ride `rjit game verify`; CAPTURE.md records the
judgment calls (invented preset values, the single quality channel, the
caller-cadenced engine pending R3).

## game/missions/ — scripted objectives (V22/V8/V16/V20 capture, 2026-06-04)

The SCRIPTED counterpart of activities, REWRITTEN fresh — built on the
cutscene clock, pathing, and the state tick's forced events. V22-CaaS is the
binding ruling: dailies are LLM-generated mission ROWS over a CLOSED schema.
`objectives.ts` carries scape design.ts's Objective vocabulary (the corpus's
one objective reference — contract-first, never consumed) as completion
predicates evaluated against the QUERYABLE WORLD AS DATA (`MissionFacts`, a
plain JSON snapshot per tick; an absent fact is never true; target kind
`position` added per V22's Hitman model, occupant-resolved). `defs.ts` is
the P2 table layer — staged objectives, the activities-shared reward row,
expiry ticks, collateral policy, narrative hooks ((text, world_delta) pairs;
`defineMission` rejects an empty delta: "a hook without a delta is the world
calling the app a liar") — and ships `delivery-gig`, the RULED opening
tutorial whose complete-hook delta makes the unfair rating cost VISIBLE
MONEY and names the OPENING_ARC stage-5 gate. `rows.ts` is the CaaS
pipeline: `validateRow` proves every slot against the queryable future
(methods_hinted are AFFORDANCES GUARANTEED) and enforces the numbers law
(the LLM never touches numbers — any numeric slot fails; `missionFromRow`
prices reward/expiry/collateral from `MISSION_TUNING`), plus the
seed/fingerprint dedup window (no-doubles for narrative). `run.ts` is the
pure engine (one `stepMission` = one state tick, forced tick = same call
now; collateral docks the rating → objectives latch, stages cascade,
completion pays EXACTLY the table → person-bound unrelated death VOIDS (the
one impossible-predicate fail screen) → expiry fails; failed restarts,
position-bound re-arms against the replacement — failure degrades, never
ends). `stream.ts` registers the V20 `missions` concern (per-verb
completion/rating tallies — tomorrow's generation weights' input). Seams
proven in tests: hooks record through GAME_STORY's log (the story capture's
deferred narrative_hooks item CLOSED), `briefingCutscene` samples on the
V16 clock scrub-identical, `objectiveMarker` feeds GAME_PATHING.planMotion,
and playing the delivery gig advances OPENING_ARC past stage 5. 30 P4 tests
ride `rjit game verify`; CAPTURE.md records the judgment calls (first-cut
facts vocabulary, the strict numbers law, mechanical "unrelated death",
caller-driven re-arm, rating-never-scales-pay, invented P2 values).

## game/world/ — the world grid state (V4 capture, gap W-1, 2026-06-04)

THE SUBSTRATE, REWRITTEN fresh — V4's "the tile system IS the system" gets
its captured home, closing the last structural gap from the TestRoute
inventory (TestRoute.REWIRE.md W-1). `grid.ts` owns the world-grid state the
authored map lowers to (surface regions, placed cells, landform INSTANCES —
kind MEANING stays in game/kinds), the R4 cell math (1 tile = 1 m), and pure
state-in/state-out mutators; reference dot paths preserved so saved scripts
keep meaning. `heights.ts` keeps the two height questions distinct: walkable
ground (`groundTopAtWorldPosition` — tile walkability + landform slope gate
+ step reach; what the player stands on) vs the raw landform top
(`landformGroundTopAt` — what a placed object rests on), plus footing
resolution (water > placed cell > [junction] > [road] > landform footing >
region — uncaptured lanes' seams documented in order). `colliders.ts` is the
world→physics adapter: regions/cells → `CollisionRect[]`, landforms → baked
`Heightfield[]` (the kind rise sampled across the footprint; a painted field
bakes 1:1 — see-it == walk-it), feeding game/physics.ts's exact wire types
(V1: ONE host system; the door derives data, never simulates); every cap
truncation is RETURNED, never silent. `spawn.ts` captures the
marker/trigger/respawn semantics as pure steps with inert returns
(save↔spawn pairing never-self, once-per-entry debounces as data,
ground-snapped respawn, first-spawn-wins default). `authored.ts` loads the
USER'S AUTHORED MAP as data from the editor compile channel
(localstore 'hmsc'/'game-state' — the channel traced, not invented; `raw`
hands the parsed record to the other world lanes). `stream.ts` registers
the V20 `world` concern (grid edits as events → the grid snapshot).
Command stubs flipped: wv_place/wv_fill/wv_remove/wv_trigger/pv_respawn/
wv_mountain run for real. Fidelity: a 251,550-comparison sweep against the
reference math (heights/footing across all four landform kinds), 0
mismatches; 21 P4 tests + 2 vocabulary tests ride `rjit game verify`.
DELIBERATELY NOT a 20th `game/index.ts` export — the door list is RULED
(V17); the question is surfaced to the supervisor, and in-game/ consumers
import `../world` meanwhile.

## editors/compose/ — the decal editor, /compose (DECALEDIT-0606, 2026-06-06)

The locked vocabulary's DECAL source (a look authored in React — Box/Text/
Image — baked to a texture; what facades and street signs always were, hand-
coded) gets its authoring surface. USER ASK: "whatever approach will let me
make billboards and shit like that easily", font-ready for graffiti later.
`ComposeRoute.tsx` = toolbar (name · canvas presets, billboard-led · add
rect/text/image · MATERIALIZE) + saved-decals rail (live swatches, click
reopens LOSSLESS — the doc rides the stored material, the re-edit law; del
removes) + the stage (doc at fit scale; drag rides the host cursor channel —
the QuadSplit wire; click selects; click-away deselects) + layers panel
(paint-order up/down, duplicate, delete) + per-kind properties (rect: fill/
radius/border; text: content/color/size/tracking/weight chips/FAMILY chips —
the font surface, host-mapped names, a graffiti face later is a host family
addition with ZERO schema work/align; image: src path; all: x/y/w/h, opacity
knob) + a live 3D billboard preview (a mesh sampling the live `compose:live`
StaticSurface — edits re-bake via subtree-mutation invalidation). Materialize
= `saveDecalTexture` (upsert by the editing id) + ONE labeled commit on the
materials channel via the route's `/compose` session (the /textures
AUTOSAVE-0605 pattern). The decal joins `allTextures` immediately —
assignable everywhere a texture is; the V24 piece-face and voxel-item slots
land on the same registry. Working doc autosaves to the `/compose` twig
(debounced — drags never storm the twig file). P4: `compose.test.ts` 6 cases
(validator round-trip with JSON-semantics canonical compare, font surface
survival, garbage→null, boundary clamps, presets valid, the materials
stream's additive decal records + upsert + unknown-kind tolerance).

## game/textures/ — the texture pipeline door (TEXPORT-0606, 2026-06-06)

The texture pipeline MOVED here from `cart/hmsc-int/render3d/` (USER ASK "properly
port that into the correct space") — a faithful move, not a rewrite: export
names, `custom:` ids, the `custom-textures` store key, and behavior unchanged,
so pre-move saves resolve. `shaders.ts` (was `textureShaders.ts`) = the
canonical tunable-WGSL recipe catalog; `materials.ts` (was `customTextures.ts`)
= the stored materials Materialize freezes into the shared 'hmsc' store;
`registry.tsx` (was `textures.tsx`) = THE one texture registry
(`TextureDef`/`allTextures`/`textureById`/`TextureCapture`) every face/tile/
part samples by id. DECALEDIT-0606 added the DECAL source: `decal.ts` (the
DecalDoc model — boundary validator, size presets, the font-carrying text
nodes) + `decalRender.tsx` (`DecalSurface`, the doc scaled to any capture
size); `materials.ts` stores decal records beside shader records (same ids,
same store key, `saveDecalTexture` upserts) and `registry.tsx` hydrates them
as react-source TextureDefs — pickers and captures need no decal knowledge. Follows the `game/world` pattern (own module, not a ruled
`game/index.ts` door); hmsc-int consumers use `@game/textures` subpaths and the
legacy renderer `cart/hmsc-int/render3d/parts.tsx` imports the registry FROM
hmsc-int (the V15 compile direction). GAP edges marked at the import sites
(W-2 WGSL fills, doomed buildingSkins, V15 design/store wires). The decal
editor and the V24 piece/voxel-item texture slots land on this door. Full
lineage table: `game/textures/CAPTURE.md`.

DECALRECIPE-0610 (2026-06-10, USER ASK req_0566 "inside of the compiled
game output i am not getting these to show up" → req_0574/req_0577 "lets
follow the guiding light"): decals reach the COMPILED game as their RECIPE.
A decal's recipe is its DecalDoc — a declarative ~1KB document — so the
bake ships THE DOC and the loader rasterizes it once at load, exactly the
shape shader materials already use (materialize-at-load). The lowering:
`compile/decalPack.ts` packs the validated doc to flat binary (header
w/h/bg + per-node records; CSS hex resolved to RGBA bytes at PACK time,
hidden nodes dropped, shader-fill rects substitute their flat color with a
warn — the WGSL fill is the marked bake-lever tail; image nodes ship via
the content-addressed asset store, DECALIMG-0610 below);
`internMaterial` interns one doc per decal id and `encodeMaterials` ships
an optional 'DOCS' tail (older payloads parse unchanged). The no-V8 loader
(constructor.zig `decodeMaterialDocTail` → `framework/gpu/decal_raster.zig`)
parses + CPU-rasterizes at load — rounded-rect SDF fills/borders, FreeType
text (lazy TextEngine.initHeadless, weight≥600 → bold face, align/
letterSpacing honored, uniform scale capped at 1024px) — and uploads via
`material_tex.materializePixels` under the same `wmat-<i>` key shader
materials use: textured batch, whitened rows, streaming protos, all shared.
Pure data → data: no editor dependency, no pixel cache, headless-green
always. HISTORY (same day, superseded): the first cut baked pixels in the
editor (`__capture_surface_pixels` readback — the door remains as a general
capability) and shipped them in a 'PIXS' tail; it hit the localstore's 8KB
value cap (storage/localstore.zig MAX_VALUE; hostLocalstoreSet swallows
failures — never store blobs in store values) and was then ruled product-
not-recipe against GUIDING_LIGHT and replaced wholesale — the
DecalPixelBaker/pixel-file layer is deleted. GOTCHA found during proof:
world_loader's `log` is `std.debug` (stderr) but framework modules'
diag/log `.info` is BUS-ONLY — invisible in the standalone loader; the
rasterizer's diagnostics use `log.warn` (warns always reach stderr). P4:
`decalPack.test.ts` (5 cases pinning the byte layout, color resolution,
hidden-drop, shader-fill substitute) + `worldGeometry.test.ts` (DOCS tail
framing + no-docs no-tail byte-compat); proof: `rjit game shot` GREEN with
"2 decal recipe(s)" baked and both real docs parsed end-to-end by the
loader (the image-skip warns fire per decal).

DECALIMG-0610 (2026-06-10, USER ASK req_0592 "ok and so images? whats the
point of me being able to add an image if i cant ship it in the game"):
decal IMAGE nodes render in the compiled game — the BYTES ride the
gamefile's content-addressed asset vocabulary (V29); the doc stays the
recipe, the image is the honest captured-content tail, stored once by hash
and referenced. Bake: `compile/decalAssets.ts` is the image sink
(`createDecalAssetSink`) — `packDecalDoc` interns each visible image node's
FILE (read cwd-relative via `readFileBase64`, the SAME path the editor's
Image primitive loads, so what previewed is what ships; sha256 is the
address, identical content dedupes to ONE asset; keys count up from 3001,
manifest kind 11, 8MB file cap) and the image record now packs the manifest
KEY: `u32 assetKey | f32 borderRadius | u16 srcByteLen | src` (src is
diagnostics only; key 0 = nothing shipped — empty src / unreadable /
oversized, warned per decal+node, NEVER a failed bake). The sink threads
`buildWorldInstances` → `createHmscMapfile` → `bakeGameFile.ts`, which
ships each asset as a manifest entry + tape-envelope payload (embed:false —
the player-model precedent; `installGameFileEnvelope` writes them into the
content store) and declares the keys in map.refs so `installAndValidate`
resolves every one before construct. Loader: `constructor.zig` reads every
kind-11 manifest asset from the content store into `Scene.decal_assets`
(`DecalAsset{key, bytes}`; a read failure skips, never fails construct);
world_loader maps them to `decal_raster.ImageAsset` and
`rasterize(alloc, doc, images)` NODE_IMAGE stbi-decodes the payload
(4096px decoded-side cap) and bilinear-blits into the node rect with the
SAME rounded-rect SDF coverage rect fills use (borderRadius + opacity
honored) — top-down, like every other node (orientation: UVFLIP-0610
below). Degradation is total at every layer: key 0 / missing payload /
undecodable / oversized → one warn + a skipped node; the rest of the doc
still rasterizes. P4: `decalAssets.test.ts` (2 cases: intern/sequential
keys/content-dedupe/src-cache + missing/empty/invalid/oversized→0),
`decalPack.test.ts` (now 6: image record layout pinned, sink-less key 0,
sink intern + context + empty-src bypass), `worldGeometry.test.ts` (now 7:
a doc with an image node ships one asset + the packed doc references its
key; adds the `resetCustomTextureCache` test seam for the module-level
custom-texture cache). Proof: a synthetic gamefile (real PNG embedded as a
kind-11 blob, built with the production writers) rendered the image ON the
box face in the headless loader — rounded corners visible, zero skip
warns; `rjit game shot` stays GREEN on the real world (the user's two
saved decals carry EMPTY-src image nodes, which now warn actionably:
re-pick the image in /compose).

UVFLIP-0610 (2026-06-10, USER ASK req_0600 "all the actual shader based
materials are all upside down lol. wondered why the door looked weird"):
the compiled loader's hand-rolled cube (`world_loader.zig buildCube()`)
carried v=0 at world BOTTOM, while the editor's geometry registry box
(`runtime/geometries/_util.ts face()`) flips V so a top-down texture stays
upright — its corner orders were already identical to the registry's
`Box.ts`, ONLY the uv row differed. Consequence: every materialized SHADER
recipe sampled upside-down in the compiled game (the user's door facade),
and the decal pipeline had "calibrated" against the wrong cube — the
DECALFLIP-0610 180° pixel-order reversal in `decal_raster.rasterize()`
fixed decal v but silently MIRRORED u (caught in hindsight: the DECALIMG
image proof showed the source's right-side road on the left; the noise-like
calibration materials and a near-symmetric test image hid both errors).
Fix at the root: `buildCube()` now wears the registry's exact uv row
(`(0,1),(1,1),(1,0),(0,0)` for BL,BR,TR,TL — one convention, fixed at the
sampling geometry) and the rasterizer's 180° compensation is DELETED
(raster output is plain top-down; per-producer compensations are the
anti-pattern). Proof: a 3-box calibration gamefile through the production
writers — brick-entrance door facade upright (door at the BOTTOM), decal
text "ABC" reading left-to-right with its red marker TOP-LEFT, decal image
upright AND unmirrored (road on the right, matching the source) — plus
`rjit game shot` GREEN on the real world. Both ±Z box faces verified
readable from their own outside.

## game/build/ — the building piece grammar (V24 capture, 2026-06-04)

The V24 ruling's data layer ("Author by semantic piece. Bake by gameplay
contract. Skin by catalog" — evidence docs/game/BUILDING-GRAMMAR.md), written
fresh. Five families behind one door (`game/build/index.ts`, exported as
`GAME_BUILD` through `game/index.ts` — the 21st door, STRUCTURE list updated
same commit): `pieces.ts` (the 13-kind taxonomy wall/floor/ramp/stairs/roof/
pillar/corner/arch/fence/railing/trim/sign/prop, each with a `BakePromise`
contract DECLARING what a placed piece promises the bake — emission lands
with compile/), `edits.ts` (the WallEdit vocabulary with per-edit MEANING:
a doorway is a walk portal, a window is sightline-not-traversal, halfHeight
is vaultable low cover; `applyWallEdit` is the one composition point),
`catalog.ts` (the P2 variety tables — theme/material/size/snap/gameplay
tags; cover speaks `TileCoverHeight` so cover values carry; glass durability
carries materials.ts health exactly; prop rows reference `propKind` — props
stay prompt-generated via the items/model pipelines; `validateCatalog`
enforces the kind contracts and caught its first real table bug during the
capture), `prefabs.ts` (first-class compositions that DECOMPOSE to semantic
pieces with effective tags — no opaque blobs; one authoring action to place,
piece-granular to edit; world-saved prefabs ride the V20 streams),
`markers.ts` (the addendum-3 WorldMarker semantic-overlay union — path_node/
trigger/room/portal/interest_point/camera_marker; reconciliation law in the
types: trigger.event is a V19 command line, camera_marker.shot names an
existing camera rig, mission markers stay missions' own). ONE MODEL, TWO
VIEWS honored: nothing in the tables assumes a camera/interaction mode.
18 P4 meaning-tests green (`build.test.ts`); ambiguities surfaced in
`game/build/CAPTURE.md`. The Build/Plan mode EDITORS and the bake emission
are later consumers of this same door.

**The PLACED family (`placed.ts`, added with the `/build` route 2026-06-04):**
`PlacedBuildPiece` is the grammar standing IN the world — stored on the V20
world stream (`piecePlaced`/`pieceRemoved`/`pieceEditSet`/`prefabDefined`/
`prefabStamped` joined `worldStream` by ADDITION; ids minted by the
materializer as `bp_<seq>` so replay reproduces them; a prefab stamp is ONE
event landing as its semantic pieces — the see-through law). Pure semantics
over that data behind `GAME_BUILD.placed`: effective tags (the one
catalog+edit composition), bounds, oriented-box raycast (crosshair
targeting), the LIVE-PLAY collider adapter (doorways split into jambs around
a walk/vehicle opening, halfHeight tops at low cover, ramps/stairs bake
walkable host heightfields — explicitly NOT the compile bake, which consumes
the full BakePromise later), rotation-aware prefab stamping
(`stampPrefabPieces`, decomposePrefab's stamping twin), clone-from-world
capture (`prefabFromPieces`/`mintPrefabId`), and the strict authoring
boundary (`validatePlacement` — the stream materializer stays tolerant).
Numbers in `PLACED_TUNING` (P2). 21 P4 meaning-tests green (`placed.test.ts`).

**Buildings own their history (`game/world/buildings.ts`, req_0512→req_0513,
2026-06-10):** the USER'S PROPOSAL made law — "give buildings their own
branch of history rather than storing as a global state. and then the
building itself can just say 'i am here at this position'". A NEW V20 stream
`buildings` (V20: new feature = new stream; its own domain DB) holds
`defs` (BuildingDefs = the same `BuildPrefabDef` family, GLOBAL/shared
across maps per the multi-map ruling) + `instancesByMap` (per-map
`{id, defId, x, y, z, yawDegrees}` references — V29's defs+references shape
at AUTHORING time; V28's `buildings[]`). Events: `buildingDefined` /
`buildingPlaced` (materializer mints `bld_<n>` per map, replay-deterministic)
/ `buildingMoved {id,x,z,yawDegrees?}` — a whole-building move is ONE event,
never a remove+place storm — / `buildingRemoved` (the def survives; a
building's branch is its event subsequence over the one total log). THE
COMPATIBILITY CONTRACT: world pieces are DERIVED — `withBuildingPieces` =
loose pieces ⊕ `stampPrefabPieces` per instance with DETERMINISTIC ids
(`bld:<instId>:<localIdx>`, stampId `bld:<instId>` = one flat-pad lift
group), so every consumer (iso pane, F2/PlayRoute, footprints, colliders,
compile `bakeGameFile`) keeps reading the ONE pieces view; the bake sees
through instances (V24). Per-instance derivation caches preserve piece
object identity across unrelated folds (renderer caches survive). Authoring
doors: `buildingDefFromPieces` (capture validates BEFORE commit),
`partitionBuildingSelection` (whole/partial/loose — partial building ops are
refused loudly, slice 2), `reconcileBuildingInstances` (Ctrl+Z appends
REVERSE events on the branch — V20: history is never rewound). IsoAuthor:
the ⌂+ button promotes a selection (define+place+remove originals, ONE
batch), the tower tool births a building, whole-instance move/clone/delete
emit single building events. Slices 2–4 (piece-scoped building edits,
per-building timeline UI, compile consuming instances natively) deferred.
15 P4 meaning-tests green (`buildings.test.ts`).

## editors/build/ — Creative Build mode, /build (V24, 2026-06-05)

The user builds the map WHILE PLAYING (BUILDMODE-0605): Fortnite-Creative
semantics on the embodied drop-in — since SUBSTRATE-0605 the player (V23
node-bound native camera, GAME_PHYSICS host step, GAME_WORLD colliders +
heightfields, captured-mouse look) is the SHARED `cart/hmsc-int/Embodied.tsx`
substrate, not route code (the original route carried a wholesale TestRoute
copy whose camera never engaged — CAMGONE-0605). PLAYFOLD-0605 (2026-06-05):
`BuildRoute.tsx` folded with `TestRoute.tsx` into `editors/play/PlayRoute.tsx`
(this dir keeps `snap.ts` + the P4 suites). Four pieces:

- the build layer of `editors/play/PlayRoute.tsx` — over `useEmbodiedPlayer` (feeds
  `EmbodiedWorldExtras`: placed-piece solids + ramp/stairs heightfield
  slopes; `onFrame`: snap re-resolve; `onTap`: place). Crosshair = the
  solved camera's screen-center axis (the crosshair law, solved with the
  substrate-exported `PLAYER_CAMERA` so pick and render agree); palette =
  GAME_BUILD's kinds/catalog/prefabs (registry-driven; the RULED hotkey
  order leads the display: 1 floor · 2 wall · 3 ramp · 4 roof — USER
  VERDICT addendum 2 — then registry order, 0 prefabs, [ ] + chips); ghost
  previews the armed piece (or a whole prefab decomposition) at the snap
  target; a CAPTURED-MOUSE click places (addendum 4: the substrate consumes
  the mouse, a click is always intent, Esc frees it for the palette — the
  old drag/click slop heuristic is dead); R rotates; E cycles the WallEdit
  vocabulary on the targeted piece; X removes; P marks → named prefab
  (`prefabFromPieces`) → the palette's Prefabs category → stamps. Placed
  pieces RENDER from and COLLIDE through the world stream's materialized
  state (re-read after every commit — no second copy). Live P2 knobs
  (reach, ghost opacity, ground march) in the in-route tuning panel.
- `snap.ts` (P4: `snap.test.ts`, 11) — pure crosshair→snap resolution:
  nearest of piece-face vs ground wins within reach; grid centers on the
  cell, edge pins to the nearer grid line and runs along it, surface mounts
  proud of the face facing outward, free is raw; top faces stack storeys.
- `commits.test.ts` (P4, 3) — the session contract on a real scratch
  store: one placement = ONE labeled commit on the WORLD channel; a stamp
  is ONE commit landing N semantic pieces; an undo point steps back.
- `viewport.test.ts` (P4, 5) — the SUBSTRATE-0605 consumption-layer proof:
  the substrate carries the V23 node-bound camera (`nativeCamera ref` +
  `forNode` + `setInputDeltas`; the CAMGONE `bindFirst` shape banned), BOTH
  routes consume it with zero route-local embodied code, capture-mode look
  is pinned (no drag heuristics), and the ruled 1/2/3/4 hotkeys lead.

ONE MODEL, TWO VIEWS: nothing build-mode-shaped is in the data — placements
are plain `worldStream` events; '/build' appears only as the session's
route label. Surfaced design choices (global-not-per-map pieces, window
collision honesty, no-lintel portals, stepped-box ramp visuals over true
slope collision, overlap allowed) are recorded in
`editors/build/CAPTURE.md`.

## editors/vehicles/ — the vehicle editor route (editors wave, 2026-06-04)

`cart/vehicle_lab`'s authoring UI REMADE ENTIRELY as the `/vehicles` route in
the one shell (V10/V17-TRIAGE; the lab stays an untouched behavior reference —
`editors/vehicles/CAPTURE.md` is the deletion contract, all 13 inventory
capabilities DONE; the user deletes the old cart). Three pieces:

- `game/vehicle/stream.ts` — the V20 `vehicles` concern (the GARAGE: authored
  `VehicleDoc` per id + rail order). Events carry the RESULTING doc
  (`authored` upsert / `removed`) so edit logic stays editor-side and the
  round-trip author → stream → snapshot → `buildVehicle` is exact by
  construction (pinned through a real on-disk store). `GAME_VEHICLE.stream`
  carries it; `game/index.ts` re-exports `vehiclesStream` + doc types as
  NAMED exports (not a 20th door).
- `editors/vehicles/edits.ts` — every control as a pure tested step:
  `editStyle` (gas-port REFIT clamp), `editRole` (pool coercion; services
  take livery, civilians keep paint), `setGasZ`/`gasZKnobSpec` (the clamp
  law; the chrome Knob owns step/round), seeded `repaint`/`wreck` over the
  captured tables, sparse damage set/nudge/repair. Both reference gasZ clamp
  ranges preserved verbatim in `VEHICLE_EDITOR_TUNING` (P2; the asymmetry is
  surfaced, not resolved).
- `editors/vehicles/VehiclesRoute.tsx` — the route: garage rail on the tool's
  ONE store (`editorChannel(vehiclesStream)` + a `RouteSession` per visit —
  every edit = one LABELED session commit: authored event + marker + fresh
  snapshot; view state transient by design; the original per-mount private
  `openStore` was removed as a forked undo chain),
  style/role/pose chips + run playback (`GAME_ANIMATION.parse/sample`),
  hitbox-group selection, damage chips, memo'd mesh/hitbox/anchor overlays,
  orbit viewport on the V23 native per-node controller (`Scene3D.Camera
  nativeCamera` + `GAME_NATIVE_CAMERA.forNode`: setOrbit on knob change,
  setInputDeltas per drag move, disable on unmount; `GAME_CAMERA.rigs.Orbit`
  solves the static boot frame only and a drag never re-renders the cart;
  `VIEW_TUNING` stays the rig params + `GAME_CHROME.LabEnvironment` arena +
  the `orbit.zoom` knob preset), contract readout
  with id + saved-seq. Strictly through the `@game` door (vehicles has NO
  internal-reach exception); mesh kind→Geometry mapping at the route boundary
  per the V10 capture rule; store failures surface in-panel.

Wired as `/vehicles` + the Car nav icon in ProjectBar (after the characters
route per the editors-wave coordination rule). `rjit game verify` owns
`cart/hmsc-int/editors` as a suite root: 8 edit-step cases + 5 stream cases +
the session-path round trip (`roundtrip.test.ts`), VERDICT GREEN. Open seams (CAPTURE.md): compile/ does not yet consume the
garage snapshot (placement belongs to the world stream, not the vehicle doc),
and the V10 scale audit remains open. The orbit yaw sign question is
RESOLVED (V25 DRAGSIGN-0605, 2026-06-05): the lab's legacy `+dx` FLIPPED to
the /test-pinned `-dx` convention — one drag convention everywhere; pinned
conventions beat legacy behavior, always (CAPTURE.md ambiguity 5, resolved).

## editors/characters/ — the character editor route (editors wave, 2026-06-04)

`cart/head_lab`'s authoring UI (1734-line `index.tsx`) REMADE ENTIRELY as the
`/characters` route in the one shell (V2/V17-TRIAGE; the lab stays an
untouched behavior reference — `editors/characters/CAPTURE.md` is the
deletion contract, all 27 inventory capabilities DONE; the user deletes the
old cart). The kit it edits is `game/figure/`; this route is the RULED
editors-reach-into-figure-internals exception. Pieces:

- `game/figure/stream.ts` — the V20 `characters` concern (the ROSTER:
  authored `BodyDocument` per id + rail order; `authored` upsert /
  `removed`). `bake.ts` grew `bakeBodyDocument` (the ONE doc→figure adapter;
  compile/verify/the editor all call it). `GAME_FIGURE.stream` +
  `GAME_FIGURE.bakeBody` carry both; named re-exports through `game/index.ts`
  (not a 20th door). The round-trip author → stream → snapshot →
  `bakeBodyDocument` is pinned byte-exact through a real on-disk store.
- `editors/store.ts` — lane-neutral: the tool's ONE Store per process (one
  globalSeq authority; two `openStore()` instances would fork the undo
  chain). Every editor concern should register here.
- the headless core, pure + P4-tested: `draft.ts` (CharacterDraft ↔
  documents, lossless; the .hed coherence law — face residue lives in ONE
  place; region sliders bake INTO the sculpt at export), `regions.ts`
  (SHAPE_REGIONS + stamp math, REGION_TUNING), `generate.ts` (one seed → one
  complete deterministic character on the kit's mulberry32, GENERATE_TUNING),
  `roster.ts` (save = append + snapshot in the same breath — the compile's
  view is never stale), `animPresets.ts` (the 32-script shelf, P2 data).
- `CharactersRoute.tsx` + `preview.tsx` + `controls.tsx` + `paintKit.ts` —
  the surface: per-part GPU sculpt painting (raise/carve/flatten, mirror
  symmetry, the depth-overlay WGSL: stroke heat + contour rings + unwrap
  guides; stroke release → readback → 48×24 grid → dyn mesh), outline lathe +
  region sliders (latch drag previews, React commits on release), face tools
  (color paint → `.hed` layers + undo-last, seeded generate, talk/chew/cry/
  yell preview, photo drop + knobs), wardrobe (8 shapes, tops/bottoms/prints/
  extras, held item rendered from `game/items` part tables), poses +
  `GAME_ANIMATION` DSL script (drives rig AND mouth), hitboxes/anchors
  overlay, memo'd `PartMeshes` (orbit drag re-renders only the camera node),
  and the richer capture stack (photo head, underwear torso stamps, clothing
  prints). `.hed`/`.body` file export + drop-in import kept beside the roster.

GRABSHAPE-0605 (2026-06-05, USER ASK "i want to see where i can grab on the
mesh and drag its shape and shape it that way also"): DIRECT MESH GRABBING
beside the grid depth-paint — hover the 3D preview and a handle dot + a
translucent influence shell snap to the grid cell under the cursor (only
where a grab really works — no fake handles); mousedown ON the mesh grabs
(anywhere else still orbits, same Pressable), dragging pulls the surface out
/ pushes it in live (throttled re-sculpt, `GRAB_TUNING.liveSyncMs`), release
lands the final stamp + a labeled V20 note (`grab drag · <part> · cell x,y ·
raise/carve n.nn`). ONE TRUTH (V24's invariant applied to sculpting): a grab
stamps regions.ts's `stampGrid` ellipse into `draft.grids[part]` — the
identical 48×24 grid the unwrap depth-paint edits — and release uploads
`bytesFromGrid` to the paint texture so the next stroke's readback COMPOSES
instead of clobbering; drags, strokes, fills, and region sliders all land in
one grid, no second deformation store. HONEST PARAMETERIZATION: the Globe is
radial-displacement-only, so a grabbed point moves along its outward axis
(mouse motion projects onto it; there is no tangential parameter —
silhouettes stay the outline lathe's job); the stamp radius follows the
brush knob, the mirror toggle stamps the meridian twin, the depth-amount
knob scales the drag axis 1:1. `grabKit.ts` is the pure headless core: grab
clouds sample every cell through `@reactjit/geometries` `globeSurface` (the
EXACT analytic surface `generate()` builds vertices from — exported in this
lane so pick and render cannot drift), pick = min-t front-facing cell within
an adaptive radius from BOTH row and column spacing (column-only let rays
fall between rows on the slim limb pipe — caught by the P4 test). Picking
solves the orbit rig from the JS shadow (lookRef/dist) through
`GAME_CAMERA.screenRay` + the NEW `worldToScreen` (screenRay's exact
inverse, landed in `runtime/cameras/unproject.ts`) — registry pure math,
sanctioned under V26; the host still owns per-frame viewport driving.
Figure view grabs the ASSEMBLY only (anatomy sockets reuse other parts'
grids — a shoulder ball is a 'hand'; clothing is garments, a grab reaches
through a sleeve onto the body part), and grabbing a part there SELECTS it
so the unwrap canvas follows — two views over one truth, made visible.
`instanceScaleVec` is the one scale law render and pick share (preview.tsx
adopted it). The marker derives its position from the CURRENT mesh params
at render time, so it rides the surface up as the drag pulls. 3 new P4
cases: pick-resolves-to-the-right-part (real rig + real solved camera, head/
pipe/foot + empty-space-null), drag-then-paint compose on one truth (stamp →
texture round trip → byte-space dab → both edits present, both orders), and
the drag axis (outward, |axis| = depth amount, knob scales it, screen
mapping 1:1 along / 0 across).

GRABGRID-0605 (2026-06-05, USER ASK after first hands-on: wireframe so space
is conceivable + "each point on that grid is a dot i can pull" + no way to
turn off mirror + "head easier to drag than torso"): three additions on the
grab. (1) THE GRID TOGGLE — an inflated twin of every visible instance of
the selected part (same geometry, same dynamicKey: zero extra generation)
wears ONE static grid texture (`GRAB_GRID_TEXTURE_KEY`, a StaticSurface-
baked Effect running `GRAB_GRID_WGSL`); because the Globe's UVs ARE unwrap
space, the hairlines run exactly THROUGH the 48×24 cell centers — every
intersection dot IS a pullable point, and the lattice stretches with the
surface as a drag deforms it (vertices move, UVs don't) — "see how much a
drag stretches the graph". Transparent texture alpha rides the capture
(clears to a=0) through the mesh shader's `tex_sample.a` multiply; opacity
0.92 routes it through the transparent pass (depth-tested → the far side
culls behind the skin). In figure view ALL assembly instances of the
selected part grid up (one sculpt, many placements — watching every limb
pipe move at once is the shared-part truth made visible). Module-const
Effect props (the StaticSurface inline-identity re-bake hazard). (2) GRAB
CONTROLS ON THE VIEWPORT — `grid` + `mirror` chips overlay the 3D pane,
visible in every tab; mirror binds the SAME state the paint brush reads
(one mirror, two tools — it used to hide behind the paint-tab conditional).
(3) THE DRAG-FEEL FIX — the user's "head easier than torso" report was
real: screenAxisFor used the raw projected axis with a len² floor, so a
camera-facing pull axis (the torso's FLAT front, scaleZ 0.62) had a noisy
direction and mushy travel, while the round head always offered a clean
lateral projection. Rework: direction comes from the projection, sensitivity
is floored at `minPxPerUnit` (56px per grid unit — every part now drags
with the same hand-feel), and under `degenerateAxisPx` (6px) the mapping
falls back to every sculpt tool's convention — drag UP pulls out, DOWN
carves in, at `fallbackPxPerUnit` (90px). P4: the axis case grew floor +
fallback assertions (up=+1/down=−1 at the fallback feel); 11/11 green.

GRABQOL-0605 (2026-06-05, second hands-on round): (1) UNDO/REDO — ctrl+z /
ctrl+y / ctrl+shift+z (useIFTTT key triggers; the host already suppresses
keys while a TextInput is focused) plus undo/redo chips on the viewport. The
stack is the shared painter's `createPaintHistory` over deep-copied
CharacterDraft snapshots (50-deep, 250ms coalesce — knobs/sliders coalesce
to "before the drag") committed BEFORE every commit-grade interaction:
stroke release, grab release (the pre-drag grid swapped into the snapshot —
live ticks already moved the draft), fill/soften/clear, outline drag +
reset, region sliders, wardrobe/body/skin/prop/pose picks, face generate /
character generate / roster load / file import. Restore runs through
`installDraft` (textures + mesh slots resync) and autosaves — the restored
state becomes the working draft on the V20 chain; the session log stays the
cross-visit history. (2) THE LIT NODE — the grid texture takes
`data=[hoverU, hoverV, mirrorOn]` and lights the hovered pull point hot in
the lattice itself (core + halo, and the meridian twin when mirror is on:
BOTH stamp sites visible before pulling); the capture re-bakes only when
the cell changes (data memo'd on it — the inline-identity hazard inverted
on purpose). (3) THE ANGLE FIX behind the "hit box gets funky" feel:
pickGrab now collects front-facing candidates within the radius, finds the
FIRST surface (min t), then picks the cell NEAREST THE RAY inside that
depth window — pure min-t favored silhouette cells nearer the camera at
oblique views; a visible cell's own pixel now picks exactly that cell
(P4-pinned over a probe set filtered to camera-facing cells; a back cell's
pixel still picks the front surface — occlusion is correct). (4) FULL
ORBIT — pitch clamp widened from 4..85 to ±88 (the host orbit controller
doesn't clamp; the JS clamp is the one authority, ±90 degenerates the
look-at up vector), and the studio floor is dropped (`LabEnvironment
ground={false}`): with under-horizon views allowed, the floor box turned
every bottom view into its black interior — the user's "workspace went
black" report, hit live on the hot-reload watcher mid-lane. (5) ZOOM — the
knob now shows distance REFLECTED across its spec range so + always moves
CLOSER ("+ zooms out and - zooms in" was the raw-distance readout), and
the wheel dollies via the raw `onScroll` fallback (events.zig
hitTestScroll — a non-scrolling node's onScroll receives the wheel delta;
built for exactly this transparent-overlay-over-Scene3D case): wheel up =
in, one knob step per notch. Suite 11/11 GREEN.

GRABNAV-0605 (2026-06-05, third hands-on round): (1) ZOOM-TO-CURSOR — the
wheel now PANS as it dollies. Wheel IN converges the orbit pivot on what
the cursor points at (the mesh cell when pickAt hits, else the ray's
closest approach to the pivot), so aiming at the face and rolling brings
the face in — the fix for "if i have the full body in view, the zoom lands
right in the crotch". Wheel OUT drifts the pivot back toward the view
center: fully zoomed out is always the whole body, recentered — there is
no lost-camera state. The pivot rides `orbitTargetPan` (a twig-persisted
offset from the view center, clamped to `TUNE.orbit.panY/panXZ`); the
param-change effect re-sends the rig on pan like it does on zoom (V23: JS
sends params on change, the host drives frames). Middle-drag pan was
considered and rejected: mouse-move payloads carry no button state and
`js_on_middle_click` is dead plumbing no prop writes — wiring it is a host
rebuild, while zoom-to-cursor is pure TSX and hot-reloads into the running
session. (2) RESET PART — the user's "reset only works on the head" was
real: on non-head parts 'clear' hides behind the detail-paint tab and
'reset outline' touches only the silhouette, so nothing visibly undid a
grab-sculpted torso. A `reset part` chip (both tab rows, every part) resets
the sculpt grid + outline + region sliders AND clears the paint texture
(the one-truth law), undoable via the GRABQOL history like every other
edit. Suite 11/11 GREEN.

NORMALPULL-0605 (2026-06-05, USER REPORT "directional split: a chest pull
always comes out at an angle, veering toward the side the node represents,
mirror or not"): root-caused to the Globe's displacement DIRECTION. Every
displaced point moved along its RAY FROM THE PART'S CORE AXIS — correct on
a sphere (ray = normal) but on a profiled/flattened part the ray tilts
sideways the moment you leave the front meridian, and the torso's scaleZ
0.62 squash AMPLIFIES it (the flatten multiplies the ray's forward
component by 0.62 while the sideways component keeps scaleX 1 — one cell
off-center already veered ~12°, two cells ~24°). FIX, in the ONE surface
fn (`runtime/geometries/Globe.ts` globeSurface): displacement now grows
along the BASE SKIN'S NORMAL (finite-differenced, pole rows collapse to
±Y like the cap law) — what every sculpt tool does; a chest pull comes
out the chest. Parity by construction: the bake runs the same generator,
so editor preview and compiled figures change together; the grab tool's
±probe through `extraDisplace` makes the drag axis the normal
automatically (the drag mapping aligned for free). Compatibility, pinned
by P4: zero displacement returns the base EXACTLY (build-time baked
static Globes stay byte-valid), and on a sphere the normal IS the radial
(heads sculpt as before; displacement stays world-units). The veer
shrinks by the flatten factor and the profile correction — not to zero
(a curved skin's normals fan; that's every sculptor) — and the radial-only
PROFILE law is untouched (silhouettes still never couple length;
NORMALPULL changes detail-displacement direction only). 12/12 GREEN +
geometry smoke + full verify 51/51.

GRIDSHELL-0605 (2026-06-05, USER REPORT "you hit some bend and the grid
mesh is being swallowed"): the lattice overlay was the part mesh inflated
1.2% BY CENTER-SCALING — a radial lift, which stops clearing the skin
inside concave bends (a carve bowl curves inward; the scaled twin dips
under it and the transparent pass's depth test hides the grid).
NORMALPULL made real bends common, exposing it. Fix: the overlay is now a
true NORMAL-OFFSET SHELL — `gridOverlayParams` (grabKit) returns the
part's own params with a CONSTANT added to every displacement cell; a
constant survives the bilinear sample and the pole averages unchanged, so
the generated surface is exactly the skin pushed `GRAB_TUNING.grid.lift`
(0.018 local units, scaled by amount⁻¹ into grid space) along its local
normal EVERYWHERE — no bend can swallow it. The shell rides its own dyn
slot (`.grid` appended to the slot id — different verts than the skin
now) and the center-scale inflate is gone. P4: constant-lift gap pinned
at carve bowl / bump / flank / pole rows (±2%). 13/13 GREEN + full
verify 51/51.

GRABFLY-0605 (2026-06-05, USER ASK "easier approach to wasd the camera...
kinda like a noclip"): /characters grows a FLY camera mode — the
IsoPreview noclip pattern on the route's own V23 node. A `fly` chip
(viewport row, twig-persisted, DEFAULT ON) flips the host controller to
`freefly`: WASD + q/e (or shift/space) move at `TUNE.fly.speed` with the
HOST integrating position per frame (`setMoveAxes` — JS only sends axis
changes on key edges through the `__keydown`/`__keyup` bus; a focused
TextInput consumes keys BEFORE the bus fires, so typing a name never
flies); drag-on-empty looks (FPS sign, ±89 pitch matching the host's own
freefly clamp); drag-on-the-mesh still grabs (unchanged); the wheel
dollies straight along the CURSOR RAY (noclip zoom: aim and roll). Pose
persists via the `flyPose` twig, saved at rest points (drag/key release,
wheel) from `getFreeFly()` readback — never per frame. Picking in fly
mode solves the FreeFly rig from that same readback (registry
`lookForward` is formula-identical to the host's — pick camera IS the
rendered camera mid-flight); orbit mode keeps everything it had
(zoom-to-cursor pivot, reflected knob — the knob hides in fly, replaced
by a key-hint line). Orbit param effects gate on mode so the two rigs
never fight over the controller. 13/13 + full verify 51/51 GREEN.

CAMFOCUS-0606 (2026-06-06, USER VERDICT "the camera is offset on load
every time... dont remove anything but the focus of the camera needs
fixed"): the measured cause — fly is the boot default and the `flyPose`/
`orbitTargetPan` twigs restored VERBATIM (the on-disk twig held a pose
aimed off-subject; orbit's pan sat pinned at its clamp, yaw at -365°); a
noclip pose is relative to nothing, so every load was arbitrary. The cure
(NEITHER camera removed; persistence machinery untouched): deterministic
SUBJECT FRAMING — `editors/sculptFraming.ts` (pure registry math, P4
suite `sculptFraming.test.ts` 7/7): bounds from the grab clouds' world
points, distance fits the bounding sphere in the fov ×
`TUNE.frame.margin` (P2) clamped to the zoom-knob range, fly pose = the
same framed orbit eye converted through `fpsLookAt` (lookForward's exact
inverse — host renders looking dead at the subject). Framing runs at
BOOT (outranks the stale twig restore), on `focusKey` change (the routes
bump a focus epoch on load/generate/import/new — part switches reframe
in part view only, never on a figure-view grab-select; undo restores
hold still), and on the F verb. Toggle made DISCOVERABLE: explicit
`orbit`/`fly` chip pair (active lit) + a `focus · F` chip on the
/characters and /items viewports; C flips rigs from the key bus; both
hint lines teach F/C (orbit mode gained a hint line beside the zoom
knob). V23/V26 unchanged — framing is param-rate sends of pure-math
poses; the host still owns every frame.

MESHSMOOTH-0606 (2026-06-06, USER ASK req_0024 "make a tool to smooth out
my own changes… i shaped it but its very low poly effect… if we get the
matrix data we can use it to edit by hand and get a few samples"): the
SMOOTH verb + the MATRIX DATA DOOR. Measured first (the user's own shaped
torso): the faceting is ROUGHNESS-bound, not resolution-bound —
|cell − neighborhood mean| averaged 0.154 on the shaped torso vs ~0.007 on
parts that read smooth, same 48×24 grid (resolution stays a surfaced
secondary ceiling: bilinear cell creases + ±1-saturated plateaus;
CAPTURE.md). `smoothKit.ts` (pure, seam-aware: x wraps, y clamps):
`relaxGrid` behind the **smooth part** chip (strength knob × the
twig-shared **smooth passes** knob; status shows roughness before→after)
and `relaxStamp` behind the **smooth** brush mode beside raise/carve/
flatten — paintable on the unwrap canvas AND grab-draggable on the mesh
(drag distance = dose at the grabbed cell, recomputed from the drag base;
green marker). Convex relaxation = silhouette bounds conserved (P4). One
truth held: every smooth lands via setPartGrid + paint-texture upload,
undoable, session-noted; both /characters and the workbench character
stage wire the same kit. `gridData.ts`: **save sample** writes the part's
grid as hand-editable JSON (one row per line) to
`sessions/sculpt-grids/<slug>.grid.json` (V20 by-addition — collisions
suffix, never overwrite); sample chips reapply (round-trip EXACT,
cell-=== pinned); format documented in CAPTURE.md so any lane can be
handed a grid file and asked to round it numerically. P4
`smooth.test.ts` 9/9 (bounds, roughness drop, seam wrap, stamp locality,
mirror twin, exact round-trip, boundary rejects, additive samples).

Wired as `/characters` + the User nav icon in ProjectBar (commit 1 of the
lane, before the vehicles route per the editors-wave coordination rule).
`rjit game verify`: 6 editor-core cases + 6 stream cases, VERDICT GREEN.
Surfaced, not guessed (CAPTURE.md): non-head sculpt detail previews live but
the bake composites head-only; `heldItem` is authored + stored but not baked
(V11 resolves items); item rotations ride verbatim until the scale audit;
editor session state is deliberately not streamed (documents are the
artifact).

## editors/items/ — item sculpt modules + retired route (ITEMSCULPT-0606, WBITEMS-FLIP-0606)

USER ASK: "take a model i can make in the voxel editor, and then bring this
into an item editor that behaves just like the character editor for the mesh
of it, so i can smooth out the blocky shape for game items." `/items` (Gem
nav icon, after characters) was the first editor; WBITEMS-FLIP-0606 retired
the route after `/workbench` item source parity, and the /characters sculpt
hands now point at ONE Globe item from the Workbench ITEM/SCULPT/VOXEL source.

The parameterization (`editors/items/bake.ts`, headless): a /voxels blockout
imports by GLOBE-WRAP — `bakeBlockoutToGlobe` ray-marches the voxel
occupancy from its centroid along every 48×24 unwrap-cell direction (the
exact (u,v)→direction map `globeSurface` uses, so the field reads on the
mesh where the march looked; a block at integer (x,y,z) is the unit cube
±0.5 — /voxels' own convention), takes the LAST occupied sample per ray
(interior gaps don't truncate), and encodes the extents as base `radius`
(mean) + `amount` (max deviation × headroom, floored so a near-sphere still
sculpts) + the signed grid. Voxel units are METERS, so items arrive
real-scale. THE LIMIT, SURFACED (status line + bake header + P4-pinned):
star-shaped from the centroid — concave overhangs/holes flatten to their
hull. Right for bottles/bats/tools; any-topology items would need a
marching-cubes skin + a new pick parameterization (rejected this pass).

REUSE, not re-roll (the no-duplication law):
- `grabKit` went GENERIC over the mesh key (`GrabInstance<P>`/`GrabCloud<P>`/
  `GrabHit<P>`, default `PartId` — /characters call sites unchanged); /items
  grabs with key `'item'`. Pick/drag/stamp/lattice math byte-identical.
- `editors/sculptCamera.ts` — NEW shared hook: the orbit + noclip-fly +
  zoom-to-cursor camera EXTRACTED VERBATIM from CharactersRoute
  (GRABQOL/GRABNAV/GRABFLY machinery; same twig keys so /characters' saved
  poses survived the refactor; V23/V26 law unchanged — host drives, JS sends
  params/deltas, `solvedCam()` is the pick shadow). CharactersRoute shrank
  ~230 lines to a hook call; /items is the second call site. CAMFOCUS-0606
  added subject framing (`subjectBounds`/`focusKey` opts, `focus()` verb,
  F/C keys — math in `editors/sculptFraming.ts`); every consumer (including
  the workbench character Stage) gets boot framing + the keys for free.
  CAMBIND-0606 (USER DIAGNOSIS "it doesnt automatically update its state
  with the tab... a hot update finally updates the tab"): the once-on-mount
  engage went STALE when the camera node remounted under the hook (workbench
  lens/tab switches reparent the viewport — bare, boxed, or unmounted per
  lens), leaving the controller writing a dead node until an HMR remount
  accidentally re-engaged; the view froze on every view except the
  mount-time one. Engagement now FOLLOWS THE NODE ID — checked every
  render, re-bound through ONE pure full-state sequence
  (`sculptFraming.applySculptEngagement`: fly = freefly + smoothing 0 +
  pose + axes cleared; orbit = axes cleared + rig + mode; the mode-flip
  effect rides the same sequence). Boot framing fires on first engage only;
  a rebind keeps the user's pose and logs `camera re-bound → node N`.
  Survives any future lens restructure by construction — no reliance on
  remounts. P4-pinned in `sculptFraming.test.ts` (8/8).
  CAMSENS-0606 (USER: "the freeroam ... has the dpi of like a million so a
  small movement goes like 720 degree spin"): the fly look rate was NOT raw
  deltas — both rigs scale per-pixel at the one seam (`orbitMove`) — but fly's
  0.3°/px sat at orbit's rate, and an fps look rotates the VIEW DIRECTION
  (subject leaves a 45° fov after ~75px of drag) where orbit swings the eye
  around a centered subject; same °/px feels calm there and wild here. Fly
  `lookPerPx` dropped to 0.08 (~4× under orbit's 0.4), and the camera FEEL
  numbers became /settings tunables — paintKit registers the `sculpt-camera`
  cluster (orbit yaw/pitch °/px, fly look °/px, fly speed, fly wheel, frame
  margin) into the P2 registry, write-through so a knob edit lands in the
  value the next mouse move reads (the user dials their own DPI). Data line:
  the FIRST look-drag per rig per bundle eval warns its measured
  `px in → ° out` ratio to the dev terminal — the sensitivity stays a
  number, never a vibe. V26 untouched (host drive unchanged; this is rig
  parameter scaling).
- paintKit (DEPTH_OVERLAY_WGSL, byte↔grid, sculpt modes), the shared
  painter's stroke engine + history, `GrabMarker`/`GrabGridCapture`
  (characters/preview) — imported, not copied (the cutout-models
  cross-editor-import precedent).

ONE TRUTH: a single 48×24 signed grid is the only deformation store — grab
drags stamp it, depth-paint strokes read back into it, mesh + lattice shell
generate from it through `globeSurface`, release uploads keep the compose
law. V20 from day one: `editors/items/stream.ts` (the `items` concern —
`SculptedItemDoc` {radius, amount, grid, color, source provenance},
authored/removed, unknown kinds pass; ONE store with /voxels so import reads
the channel /voxels autosaves), debounced autosave, labeled session notes,
mount restore, ctrl+z/y via the painter history.

Registry door (V11): `ITEM_GEOMETRIES` grew `globe`; `ItemDefinition` grew
optional `heldScale`; `sculptedItemDefinition(id, doc)` (bake.ts) shapes a
saved item as ONE 'globe'-part definition (heldScale 1 — real meters;
scaleStatus stays 'unaudited', the audit is the user's verdict). /characters
lists the sculpted roster as ◆-prefixed prop chips and `HeldItemMeshes`
resolves them via the new `extraItems` prop — a sculpted item is HOLDABLE
the moment it's saved. Read once per route mount (save in /items, revisit
/characters to refresh). Not yet wired: world-drop/bake consumption (the
V11 items lane proper).

P4 (`editors/items/items.test.ts`, 7 cases): bake determinism + bounded
flat-ish cube field + meridian symmetry; off-center mass shifts the field
AND the star-shape limit asserted as real; amount-floor; grab-stamp compose
on the baked surface (one truth); R8 paint round-trip; registry door;
stream fold + on-disk snapshot round trip. Full verify 52/52 GREEN.

## editors/paint/ — THE shared painter (editors wave, 2026-06-04)

`cart/cutout`'s painting tool ("actually good for painting" — the user's
ruling) CAPTURED as the one paint surface every editor that paints embeds —
characters first (replacing paintKit's hand-rolled input plumbing),
materials/textures later. COMPOSABILITY IS THE POINT: one painter, no
per-route forks. The cutout cart stays an untouched behavior reference
(`docs/game/cutout.md` is its audit; the user deletes it);
`editors/paint/CAPTURE.md` is the deletion contract — all 34 inventory
capabilities DONE (the cutout 30 + paintKit's mirror/value-painting/soften/
vector-capture so adoption loses nothing + the V20 session integration
cutout never had). Two halves behind ONE door (`index.ts`, P3):

- the HEADLESS CORE (`PAINT`): `tuning.ts` (every behavior-affecting number,
  P2 — bands, pressure curve, spacing, edge-snap, lasso rules, history
  cap/coalesce, φ hue stagger, palette, backend tunables), `strokes.ts`
  (the stroke engine: pointer samples → gap-free dab lists with pressure
  lerp, mirror symmetry, sobel edge snap; CPU raster ops; lasso geometry;
  min-step vector capture; dims-generic 3×3 soften), `layers.ts` (the
  dual-source model: base smart mask + brush override per layer, the
  192/64/128 band compose, merge/invert/union math, the RLE `PaintDocument`
  v1 round-trip on `@reactjit/workspace/rle`), `history.ts` (generic
  before-action undo/redo: 50-deep, 250ms coalesce, LAZY snapshot builders —
  a 60Hz drag never does 60 readbacks), `surfaces.ts` (the 6 built-in
  animated WGSL surfaces in texture AND cells mode, marching-ants edges,
  2 color slots, custom-surface registry + adopt/inflate, storage-buffer
  packing — the in-shader compose mirrors `effectiveMask` exactly),
  `backends/` (the `SelectionBackend` seam + the ImageMagick flood and
  MobileSAM implementations, `makeDefaultBackend()` auto-picks).
- the LIVE half: `usePaintEditor` (core → GPU paintables wiring with the
  cutout perf invariants: dabs write straight to the override texture, never
  a per-dab setState; readback only at discrete commits; prefix-namespaced
  paintable ids so embeds coexist), `PaintSurface` (the viewport: pan-zoom
  Canvas, screen→world→source coordinate discipline, input overlay sized to
  ITS box — full-viewport-safe by construction, cursor/HUD/lasso preview/
  click markers/checkerboard), `PaintToolRail`/`PaintLayerStrip`/
  `PaintLookPanel` (chrome-kit controls), `PaintEditor` (the one-liner).

Session contract (V20): `usePaintEditor({ session })` lands ONE labeled
edit-commit per interaction (`brush stroke · erase · 32px · Layer 1`) on
whatever channel the hosting route passes — a `RouteSession` satisfies it
note-grade; `{ note: (label) => ses.commit(event, label) }` upgrades to
commit-grade without the painter knowing the event type. Persistence is the
HOST's call: the painter bumps `documentVersion` and hands out lazy
`buildDocument()`/`applyDocument()`/`composeExportMask()`; it ships no `fs`
writes.

NOT a route: editors/paint is a module other routes embed. NOT wired into
the characters route here — the OWNERSHIP FENCE leaves the swap to the
characters lane; `CAPTURE.md` carries the precise adoption hand-off (dab→
stroke engine with the exact-fidelity note that fallback-pressure radius =
the route's current brush value, appendFacePoint→createVectorStroke,
softenBytes→soften3x3, stroke-end session labels, the optional full-painter
upgrade seam).

`rjit game verify` (editors suite root): `paint.test.ts` 29 P4 cases GREEN —
stroke/compositing/palette/history/document/WGSL-shape laws. JSX surfaces
bundle-verified through the real cart pipeline aliases.

## editors/cutout/ — the cutout painter route (CUTOUTAPP-0605, 2026-06-05)

> **THE ROUTE IS DEAD — CUTOUTFLIP-0606 (2026-06-06).** USER RULING,
> verbatim: "cutout needs work but its at least got everything from the
> route in there so its g2g nuke that shit." `CutoutRoute.tsx` is deleted,
> the `/cutout` route + Scissors nav icon are deregistered, EffectModal
> extracted to `editors/workbench/paint/EffectModal.tsx`, and vehicle
> paint-texture deep-links land on `/workbench` (the bench store consumes
> the pending-model-target mailbox). The directory's shared internals
> (ToolRail · Inspector · StatusBar · ModelPreview ·
> models/extraction/sources/draft/stream + tests) live on as the workbench
> PAINT bench's modules (WORKBENCH.md step 8 done; parity table
> `editors/workbench/AGNOSTICPAINT.CAPTURE.md`). The section below
> describes the route AS BUILT — the capability inventory the bench
> inherited.

`cart/cutout`'s APP EXPERIENCE remade as the `/cutout` route in the one shell
— the full-canvas, layer-stack, smart-select image/texture editor, for
painting SKINS/TEXTURES (the user's explicit ask; an earlier wave's
head-part-painting landing in /characters was ruled NOT it). The ENGINE is
`editors/paint/` (consumed whole via `PaintEditor`, never forked); this route
is the app around it. The cutout cart stays an untouched behavior reference;
`editors/cutout/CAPTURE.md` is the APP-surface deletion contract — a 48-row
line-item audit against cutout.md, a component-by-component read of the
reference's workflow affordances, AND an integration section against the
tool's material system (the QoL corrections: the fine details ARE the
product, and CAPTURE.md's "audit failure" section records exactly how the
first audit passed the user's three misses; the engine's 34 are paint's own
CAPTURE.md). Pieces:

- `editors/cutout/stream.ts` — the V20 `cutout` concern (the LIBRARY): saved
  working `PaintDocument`s (re-openable, upsert by id) + extracted
  `CutoutAsset`s (name, source-res binary RLE mask, overlayRes preview cells,
  pixel count, srcPath, source docId). Events carry the RESULTING artifact
  (`saved`/`extracted`/`removed`); unknown kinds pass through (V20). Lives
  route-side until the game compile consumes painted assets (CAPTURE.md
  ambiguity 1 — graduates behind a game/ door then; the log file never moves).
- `editors/cutout/extraction.ts` — pure bookkeeping: `extractCutout` (refuses
  empty selections; mask→asset→mask pinned exact), `cutoutToDocument` (a
  stored cutout reopens as a one-layer document whose smart base IS the mask
  — refinable, extendable: the composability law), id mints, collision-free
  naming.
- `editors/cutout/sources.ts` — source ingestion, the hosting editor's half
  of the engine hand-off (`dims`/`srcPath`/`gray` as data): magick `identify`
  + grayscale load for edge snapping.
- `editors/cutout/CutoutRoute.tsx` + `ToolRail.tsx` + `Inspector.tsx` +
  `StatusBar.tsx` + `draft.ts` — the page: header (name · gated save/extract
  · status), library rail (documents + cutout swatches via `PaintQuad` cells
  mode; open/remove), and the full app remade around `usePaintEditor` +
  `PaintSurface`, remounted per working target. `ToolRail.tsx`
  (CUTOUTQOL2-0605) is the reference's left palette ported faithfully: ICON
  tiles with tooltips for every tool/mode/action (Hand/Brush/ScanLine/Spline/
  WandSparkles · Eraser/RotateCcw · X clear / RefreshCcw invert /
  FlipHorizontal mirror / Check lasso-close) and the DRAGGABLE brush-size
  slider (track + detents per `PAINT.tuning.brushSizes` + nudge + live px
  readout), plus the color slots + palette. The route's own inspector is
  the reference's right stack: TOOL tab (mask-state/refining pills, selection
  metrics, the Flood/SAM backend picker with onnx gating, tunable knobs +
  SAM whole/part/subpart candidates, undo/redo), FX tab (LIVE animated
  surface-gallery cards + the custom-WGSL `EffectModal` with
  apply-preview/stale signal, defaults-vs-layer targeting,
  hue/phase/opacity/blend/visibility), SOURCE tab (path/dims, Enter-to-apply
  canvas size + presets, image load), a drag-resizable properties/layers
  split, and the full LAYERS panel (real-silhouette texture-mode previews,
  inline rename, Eye visibility, group/click tags, add/dup/move/merge/cut/
  delete bar). Bottom status bar = the reference's pill + 1Hz
  FPS/ZOOM/CANVAS/SIZE/MASK/LAYERS/CLICKS/SAVED cells. The working draft
  autosaves debounced (600ms) to `sessions/_cutout_draft.json` and restores
  on mount — hot reloads and crashes lose nothing between deliberate stream
  Saves. File drop loads an image anywhere; painter hotkeys stay ON (the
  host suppresses key triggers while a TextInput is focused).

The MATERIAL/SHADER LAB CONNECTION (CUTOUTQOL2-0605): /cutout participates
in the locked art→material pipeline both ways. IN — paint ON a registry
texture: the library rail's MATERIALS (stored materials, live swatches,
re-rendering on save/remove via the studio's own bus) and RECIPES (the
catalog at defaults) sections make any of them the canvas under the paint
(`PaintSurface underlay`, the engine's recorded post-capture addition; 1-tile
square canvas; smart select stays off — it needs an image FILE). OUT —
Materialize: `→mat` on a cutout row saves it as a stored material through the
system's own door (`saveCustomTexture` + the `cutout-stencil` recipe added to
the canonical catalog, `cart/hmsc-int/render3d/textureShaders.ts`): the shape's
preview grid + the look's extraction-time colors, floating on transparency —
it joins `allTextures` immediately (assignable in /textures, on faces, tiles,
parts; deletable in the studio). The material-canvas identity (`textureId`)
rides extractions, saves, and drafts (V20 additions; old events read null).

Session history (V20, the user's ruling): the route opens `/cutout` on the
`cutout` channel — strokes/lasso/smart/layer-ops land as the painter's
labeled notes; saves, extractions and removals are COMMIT-grade (content
event + marker + materialized snapshot). Wired as `/cutout` + the Scissors
nav icon in ProjectBar (beside the texture studio). `rjit game verify`
(editors suite root): `cutout.test.ts` 10 P4 cases GREEN — extraction
round-trip/refusal laws, reopen-as-document, library upsert/remove/
unknown-kind tolerance, the one-commit-per-save session contract, replay
identity, minting laws, working-draft round-trip + strict version/shape
gate, the MATERIALIZE contract pinned against the LIVE catalog recipe, and
the material-canvas identity round-trip. Surfaced, not guessed (CAPTURE.md):
file exports (PNG/pixel-icon/.sqi) deliberately absent pending the user's
export ruling — the stream asset is the in-app landing and carries
everything a file exporter would need; recipes as LAYER overlays (vs the
canvas) deliberately not built — per-recipe WGSL surgery, awaits a ruling.

## editors/settings/ + editors/tunables.ts — the grand settings route (SETTINGS-0605, 2026-06-05)

THE USER'S RULING, verbatim: "it would be nice to have a grand settings page
that shows an event bus for all of these [the routes' session/autosave
systems], and we need to get all those magic numbers into some route for
interfacing with." Two pieces:

- `editors/tunables.ts` — **THE P2 interface the constitution promises** ("a
  constant buried in code that affects game behavior is a bug"). A pure
  in-memory registry: a tuning module registers its numeric leaves WHERE THE
  NUMBERS LIVE (dotted path + KnobSpec-shaped min/max/step/precision into its
  own live table, at module scope); the registry clamps at the boundary (P3)
  and writes THROUGH the table, so an edit lands in the exact value the
  route's code reads next frame — no second copy. Persistence is the V20
  `tuning` stream (STRUCTURE.md's streams list already named it): one
  set/reset event per knob edit, override map materialized; index.tsx folds
  the snapshot back over code defaults at shell mount (`applyOverrides`,
  pending until late registrations — stream order never races module order).
  `createTunables()` testable door / `editorTunables()` live singleton (the
  sessions.ts split; no host bindings, so module-scope registration is safe
  under any test). P4: `editors/tunables.test.ts` (7 cases — write-through
  round trip, boundary clamps, spec/table drift dies loud, any-order override
  fold, revision signal, stream materialization, on-disk restart fold).
- `editors/settings/` — the `/settings` route (Settings nav icon), two
  surfaces, both READ layers over existing machinery. **SESSION EVENT BUS**:
  the unified live view of every route's session channel — `bus.ts` is a pure
  fold over the `sessions` stream's materialized state (every commit/note
  with route/channel/label, ordered by the one global seq, newest first;
  per-channel filter chips with commit counts + open-session dots), polled
  through the existing doors (`editorSessions().state()`/`undoPoint()`,
  re-render only on movement) — read-only, no second event system, no new
  persistence. **TUNABLES**: the registry grouped by system, GAME_CHROME
  knobs editing live, per-knob reset-to-default; every edit is one LABELED
  commit on this route's own `/settings` session over the `tuning` channel —
  so turning a knob shows up in the bus beside everyone else's interactions
  and persists across boots. The page registers its own chrome numbers
  (`settings-view`) — it eats its own dog food. P4: `bus.test.ts` (5 cases —
  cross-channel seq ordering against REAL session machinery on a scratch
  store, row grades, filtering, per-channel rollups, replay identity).
  Surfaced: wall-clock timestamps would need sessions.ts to fold the stored
  `at` stamp (the bus shows seq order — what V20 defines); a knob edit does
  not re-render OTHER mounted routes (they read the live value on their next
  render). `editors/settings/CAPTURE.md` is the P2 BUG BURNDOWN: every
  un-migrated magic-number cluster, plus the pane hand-off rows.

## Model texture painting — /cutout owns it (MODELPAINT-0605, 2026-06-05)

THE USER'S RULING: model textures (character + vehicle) "migrate entirely to
the cutout painter"; save the painting; live 3D preview beside it. And the
scope ruling: "i dont want to paint depth, i want to paint their face
though, or body parts" — pixels only; the coupled color+depth face stroke
died; sculpt stays in /characters.

- `game/painted.ts` (+`paintedRender.tsx`, direct-import React half) — the
  PaintedOverlay: per-layer cell-grid color bake + the painter's re-editable
  document held OPAQUE (STRUCTURE arrows: game/ stores, editors/cutout
  interprets). Boundary validation never throws; texture keys are
  content-addressed by the save stamp. `VehiclePaintCaptures` is the one
  shared capture component. 7 P4 cases.
- `BodyDocument.paint` / `VehicleDoc.paint` — additive per-part slots;
  `applyBodyPaint`/`applyVehiclePaint` pure save steps; paint→unpaint is
  byte-parity; torn overlays degrade, never reject; pre-paint documents
  byte-unaffected (all pinned). buildVehicle threads textureKey onto a
  painted part's SURFACE meshes — scars/cracks/livery stripes are decals
  and never take the paint (the suite caught the hood-grille escape).
- `/cutout` MODELS rail: pick a face/body part/vehicle part → the full
  painter over the model's own underlay (512×256 figure unwrap / square
  vehicle canvas) → save = bake + door-apply + ONE commit-grade upsert on
  the owning channel → reopen lossless. Live 3D preview (`ModelPreview.tsx`)
  shows the part/vehicle with the painting applied as you stroke (throttled
  StaticSurface sampling the live GPU masks; V23 native orbit; P2 knobs).
  Deep-link mailbox: /characters + /vehicles preload a target.
- `/characters`: face-paint tool DELETED; draft carries `paint` opaque —
  pinned that a sculpt/wardrobe save never wipes a painting (a real wipe
  hazard found + closed); captures composite overlays at the photo slot.
- `/vehicles`: viewport renders painted panels; `texture` row deep-links.
- Surfaced seams in editors/cutout/CAPTURE.md (model-target draft gap,
  cell-grid bake fidelity, compile-side bake follow-up).

## The road layer — the stroke painter (ROADSTROKE-0610, 2026-06-10)

Roads are authored as STROKES, never tile-by-tile (V24's law applied to roads:
the 1m grid is the snap substrate, not the authored object model). The user's
2026-06-10 rulings: **a lane is 3 tiles**; lane count is per side; a side at 0
lanes = a one-way road and MUST show direction markers.

- `roadData.ts` — the model + the PURE planner. `RoadStroke` = centerline
  points (global cell coords, the SelCell convention) + `RoadProfile`
  (`lanesF`/`lanesB` per side, `sidewalks`). `planRoads(strokes)` →
  `Map<cellKey, TileKind>`: 3-tile lane groups flowing with/against the draw
  direction (right-hand traffic — forward lanes sit RIGHT of the centerline),
  a 1-tile `median` between opposing groups (two-way only), the locked 2-tile
  sidewalk ring, `junction` boxes where two strokes' carriageways overlap, and
  2-deep `crosswalk` bands across each leg just outside the box. Pure CPU —
  `roadData.test.ts` (9 cases) pins the whole grammar.
- `median` tile kind — NEW, appended LAST in both registries
  (`cart/hmsc-int/world/tileKinds.ts` + `game/kinds/tiles.ts`; index order stays
  locked). Walkable (jaywalking) but `vehicleCost 6.0` prices out driving
  ALONG the centerline — the per-cell tax that closes the flow-less-drivable
  wrong-way loophole a neutral center tile would open. Flow-neutral.
- `PaintCanvas.tsx` ROAD layer — brush tool lays centerline points (click;
  Enter stamps, Esc cancels), pointer selects a stroke (point-to-segment
  distance ≤ half width + 1), `RoadRail.tsx` is the left rail (per-side lane
  steppers, sidewalk toggle, stamp/cancel/undo-point, stroke list + delete).
  Overlay affordances are Canvas.Node DOTS (no rotation, any angle renders) +
  ASCII flow chevrons on one-way strokes. Stamping is DESTRUCTIVE into the
  chunk tile grids — the grid stays the single runtime truth ("the tile system
  IS the system"); host pathing, the preview drape, and the compile see plain
  painted tiles with zero new plumbing.
- The UNDERCOAT — `roadUnder: Map<cellKey, priorIndex>` records what every
  stamped cell held before. Any stroke change does a GLOBAL restamp (restore
  all → replan all → stamp all; junctions depend on every stroke). Editing or
  deleting a road restores the paint beneath it.
- Persistence (`mapStore.ts`) — `MapSnapshot.roads` (strokes verbatim) +
  `MapSnapshot.roadUnder` (`[gx, gz, legendIdx]`, remapped by NAME through the
  saved legend like the tile grids). Chunk tiles save COMPOSITED (what you
  see); pre-road snapshots load clean. `roadStore.test.ts` (3 cases) pins the
  round-trip + legend degradation.
- SPEED LIMITS (ROADSPEED-0610, req_0554) — `RoadProfile.speedLimitKph`; the
  STROKE is the carrier (stamped tiles are shared kinds and cannot hold it).
  `ROAD_SPEED_PRESETS` city 50 / rural 90 as rail chips + a 5-km/h stepper
  in RoadRail; `clampProfile` normalizes absent → city and clamps 10..130;
  the label reads `1+1 ·11w +walk ·50`. Pre-speed saves load clean (the
  field defaults). Lookups: `strokeAtPoint`/`speedLimitAtPoint` (distance to
  the FILLETED centerline within the carriageway's ribbon extents) and
  `routeSpeedLimitMps` (strictest along a sampled route). THE MOTION
  CONSUMER: `roadMotionProfile(base, strokes, points)` clamps a driving
  profile's `maxSpeed` DOWN to the route's strictest limit (never up) —
  feed it to planMotion/planMotionWithStops and the schedule obeys the
  posted speed. roadData.test.ts covers point/route/jalopy cases.
- GRADE MODE (ROADGRADE-0610) — the first elevation slice. `roadGrade.ts`:
  every restamp smooths the painted heightfield under each stroke's bed —
  the centerline samples CURRENT terrain at 1-tile steps, a ~12-tile moving
  average irons potholes while keeping real climbs, the band takes the
  profile height curb-to-curb (zero crossfall), and a 3-tile smoothstep
  feather blends the shoulders back to terrain. Pure
  (`strokeGradeProfile` + `gradeHeightField` over the editor HeightField
  samples); PaintCanvas.restampRoads runs it after stamping and marks
  heightDirty so the 3D mirror + colliders follow. Idempotent once graded;
  deleting a road leaves its earthworks (Ctrl+Z restores heights through
  the map snapshot). P4: roadGrade.test.ts (4).
- Known seams: cells over not-yet-added chunks skip the stamp and catch up on
  the next restamp; manual paint UNDER a road footprint is reclaimed by the
  next restamp; grade recomputes globally per stamp (bbox-clipped per chunk —
  watch restamp cost on very large networks); the road LOOK is still the kind
  colors — the per-tile material stamping (yellow/white overlays from
  game/textures' road decomposition) and the remaining elevation modes
  (deck / approach strips / tunnel hole-mask) are the next slices (see
  project_road_grammar memory: the agreed full design).

## The floor micro-grid + the nav bake (MICROGRID-0610, 2026-06-10)

USER-RULED (req_0518): a floor piece IS exactly 3×3 tiles, and every floor
carries a 3×3 grid of paintable tile kinds — the nav substrate stays uniform
1m cells whether ground or lifted.

- `game/build/microGrid.ts` — the cell model. `PlacedBuildPiece.cells` = 9
  row-major authored kinds (null = the material default,
  `FLOOR_DEFAULT_CELL_KIND` by catalog material). `resolveFloorCells` /
  `floorCellRects` (quarter-turn aware) / `setFloorCell` (pure write). Cells
  use the ONE tile-kind registry — no second vocabulary. Prop occupancy is
  NOT stored: it derives from the prop's collider, so moving the dresser
  frees the cells.
- `game/world/navGrid.ts` — THE NAV BAKE: the first producer for
  GAME_PATHING.publishGrid (which had a typed wire and zero callers). One
  pure fold: painted 1m tiles (upsampled; unpainted = caller's emptyKind) +
  ground-level floor micro-cells + `placedPieceColliders` blocking. Nav cells
  are 0.5m (NAV_TUNING) — a per-cell grid can't express a blocked EDGE, so at
  0.5m a boundary wall blocks only the two quarter-strips its slab covers
  instead of eating a meter off both rooms. Door/arch/garage openings need NO
  special case (collider bands are already split around them). Ramps/stairs
  stamp walkable link footprints and are EXCLUDED from the blocking pass
  (their collider bands ARE the slope). Elevated pieces (y > 0.5m) are gated
  out until the multi-level surface-nav lane. Exposed on GAME_WORLD
  (`bakeNavGrid`/`navKindAt`). P4: navGrid.test.ts (8 cases incl. the
  dresser-derivation rule and the door-stays-open law).
- `game/world/navPublish.ts` — THE LIVE PUBLISH (NAVLIVE-0610): the active
  map (painted heightfield landform `field.tiles` + placed pieces) →
  `bakeNavGrid` → `GAME_PATHING.publishGrid`, with the kind-table
  derivations riding every publish: `navFlowTable` (per-kind PATH_FLOW codes
  from each kind's `flow`), `navClassTable` (junction/crosswalk — the
  lane-discipline opt-in), `navProfileCosts` (walker = npc.walkCost,
  vehicle = npc.vehicleCost; non-traversable ships -1). NAV_PROFILES
  {walker:0, vehicle:1}; the vehicle profile sets laneOffset 1 /
  againstFlow 8 / crossFlow 2. THE HOST CAP: pathing.zig MAX_CELLS = 16384
  (mirrored as PATHING_GRID_LIMITS) holds ~64×64m at the ruled 0.5m cells —
  ONE painted chunk needs 57,600 — so over-cap maps publish a square WINDOW
  centred on the player (reported in NavPublishResult.windowed, never
  silent); PlayRoute re-anchors the window when the player leaves its
  central half (1s poll) and re-publishes on worldGrid/pieces identity
  change. Raising MAX_CELLS host-side restores whole-map publish with no
  JS change. On GAME_WORLD (`publishNavGrid`/`navProfiles`). P4:
  navPublish.test.ts (7).
- THE CELL PAINTER (MICROGRID-0610, editor half): the buildings workbench's
  col-3 panel grows a `FLOOR CELLS · 3×3` group when the selected piece is a
  floor — nine compass rows (nw…se, row-major, iz south), each a pick over
  PAINTABLE_TILE_KINDS whose clear chip reads `default (<material kind>)`.
  Writes go through `store.setPieceFloorCell` → `setFloorCell` (all-default
  collapses the field) → ONE `prefabDefined` commit on the world channel —
  the same stream the game boots. `PrefabPiece.cells` (validated: floors
  only, exactly 9, known kinds) carries through `stampPrefabPieces` into
  every placed instance, so the nav bake paths what the painter painted.
  Col 4 demonstrates: authored cells tint their ninth of the plate, proud of
  the top slab, quarter-turn-matched to floorCellRects.
- `game/world/trafficControl.ts` — RIGHT-OF-WAY (TRAFFICGATE-0610,
  req_0554): the locked grammar says signals gate the box at RUNTIME, never
  in the path graph, so nothing here touches kinds/costs/A*. `findJunctionBoxes`
  flood-fills the painted grid's 'junction' cells into boxes;
  `associateTrafficControls` attaches each placed stopSign/trafficLight to
  its nearest box (≤12m), governing the approach it faces against (yaw 0
  faces -Z — the hmsc/world/traffic.ts convention, kept exactly);
  `planMotionWithStops` splits the deterministic schedule at controlled
  stop lines (box + the 2-deep crosswalk band): a stop sign ends its leg AT
  REST on the line (plans end at rest — the full stop falls out) and holds
  1.5s; a signal holds until its axis' next green on the SAME
  TRAFFIC_SIGNAL_CYCLE the lamp render glows with — green at arrival never
  splits. `sampleMotionWithStops` stays a pure function of t (V5). On
  GAME_WORLD.traffic. P4: trafficControl.test.ts (8).
- NOT yet wired: a find()/route consumer (NPC walkers/traffic — the gate is
  ready for the first driver), road decks (lane kinds on lifted floors —
  elevation modes), multi-level surface nav, the host MAX_CELLS raise
  (heap-allocated grids) for whole-map 0.5m publish.

## editors/controls.ts — the EDITOR control contract (EDITORCTL-0610, 2026-06-10)

Structure review §3's fix, landed: the editor's keyboard is ONE table
(`editors/controls.ts`, data only — the gameplay side keeps its own ruled
contract in `input/controlContract.ts`). Each `EditorBinding` row carries
action id (`<concern>.<verb>`), scope (`'canvas' | 'iso-build' | 'bench'`),
key chords, label, legend text, and flags (`whileTyping`, `held`).
`validateEditorBindings` runs at module init — malformed rows and intra-scope
key conflicts are BOOT-TIME errors ("E means one thing per focus scope" is
machine-checked, not hoped). `editors/useEditorControls.ts` is the one React
dispatcher: a surface declares its scope + active flag + handlers by action
id; the dispatcher owns chord normalization and THE typing gate (previously
re-implemented or missing per surface — IsoAuthor's R fired into text
fields). Held bindings get both key phases, base-key matched on release and
gate-exempt on release so a pan can never strand. `editors/KeyLegend.tsx`
renders a scope's legend FROM the table (the strip cannot lie); the canvas
pane shows it bottom-left. `useHeldModifiers` is the shared
modifier-off-the-key-bus tracker (was hand-copied in PaintCanvas +
IsoAuthor). Adopted: PaintCanvas (pan/lock/brush-rotate/road draft),
IsoAuthor (rotate/orbit/recenter/delete/cancel/pan), Workbench shell chords
(undo/redo/save — off useIFTTT). Remaining transports to fold by ADDING
rows: the paint editor tool keys (usePaintEditor.ts), Embodied/sculptCamera/
usePlayerDrive, plus a whole-keymap view in the settings bench. P4:
`editors/controls.test.ts` (6).

## shell/panelGrammar.ts — the panel grammar (PANELGRAMMAR-0610, 2026-06-11)

Review §11.4's diagnosis made law: a source's panel was whatever shape its
backing data happened to have (three piece classes → three duplicate groups;
35 DSL verbs → 35 buttons). The grammar is pure spec analysis
(`panelGrammarViolations`, data only, P4 `shell/panelGrammar.test.ts`)
consulted by PanelGroups, which warns LOUDLY once per offending panel shape —
render continues. The laws: G1 repeated group shapes are illegal (factor into
one group + a selector — GUIDING_LIGHT's factor law in UI, mechanically
detected via `groupSignature`); G2 one color system per panel (caps on color
fields per panel + quick-picks per field without wheel/range); G3 verb caps
(chip walls demand `t:'pick'`, req_0184); G4 undo/redo/save render once (the
shell owns them). Thresholds are named constants (`PANEL_GRAMMAR_CAPS`).
`PanelGroup` grew `tier?: 'debug'` — debug groups render COLLAPSED (rule 6).
First fix under the law: the buildings source's per-kind `<KIND>S · GLOBAL`
groups (the user: "why do I have 3 color swatches and no wheel") folded into
ONE `SKINS · GLOBAL` group with a class enum, and its color field opted into
`wheel` + `range` — quick-picks on top, any tone reachable.

## The host-driven Slider (SLIDER-0611, 2026-06-11) — L1 closed

L1's outstanding half is done: the framework grew a first-class `<Slider>`
primitive (`runtime/primitives.tsx`; engine type `"Slider"`) and
`WorkbenchSlider` now renders THROUGH it — every num field, the shader lab,
and the cutout tool rail upgraded in the one place. The engine owns the
thumb while the button is down (the V23/movePlacement law applied to
scrubbing): `framework/engine.zig` slider drag (hitTestSlider →
slider_drag_slot; motion writes the pool node's `slider_value` and repaints
with ZERO JS in the loop), `paintSlider` draws track/fill/knob host-side
(track tint = style background, fill tint = `color`), and JS hears the value
two ways — `__dispatchSliderChange` (throttled ~60Hz, change-deduped,
mirrors the label) and `__dispatchSliderCommit` (ONCE on release, the
authoritative settle; WBCHAR-0606's commit-on-release law kept). Mid-drag
`sliderValue` prop echoes are ignored host-side (`slider_dragging` gate in
`v8_app.zig` applyProps) so a controlled value never fights the engine
thumb. Props: `value/min/max/step` (`sliderStep` snaps host-side),
`onChange(v)`, `onCommit(v)`. Nonlinear `toTrack`/`fromTrack` consumers keep
working — the host runs the 0..1 track domain, the mapping stays JS-side.

## The compiled-world POP-OUT window (WORLDWIN-0611, 2026-06-11)

Review §6/§10.2's pop-out, built as REAL framework work (user ruling: "Do the
real framework work to achieve it") after the in-process `<Window>` path
proved 2D-only by design (gpu.zig is a one-surface singleton; secondary
in-process windows use the SDL3 2D renderer). The capability: a SECOND OS
window running the full wgpu pipeline.

What made it cheap: scene3d already renders every scene to its own
render-to-texture (never the swapchain) and drawScene is encoder-self-
contained — so multi-window needed only (1) extra surfaces on the same
device (`gpu.createWindowSurface`/`configureExtraSurface`), (2) caller-owned
render targets outside the per-frame pool (`scene3d.DetachedTarget` +
`renderDetached`; `world_loader.renderDetachedView` steps a mounted runtime
into one), and (3) a one-triangle blit pass into the window's swapchain —
all in `framework/gpu/world_window.zig`, driven from the engine loop
(routeEvent in the SDL poll, frame() after the main gpu.frame()).

The door rides the SAME compiled-world ingredient (`__compiled_world_window`
/ `_close` / `_status`; trigger = importing CompiledWorld.tsx, unchanged).
Cart surface: `popOutCompiledWorld()` (POP OUT button on the /compiled
header), and the Compile button calls `reloadCompiledWindowIfOpen()` — the
user's daily loop becomes paint on `/` → Compile → the second window takes
the fresh gamefile live, zero route flips. In the window: click captures the
mouse, WASD walks (world_loader reads process-wide key state — zero new
plumbing), Esc releases, RMB aims; its events are consumed so editor hotkeys
never fire while walking. One window for now; the runtime mounts under
reserved node id 0xFFFFFF01.
