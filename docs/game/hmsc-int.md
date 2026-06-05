# hmsc-int cart inventory

Source cart: `cart/hmsc-int/` (~9,200 lines: ~45 modules + `tabs/` + `assist3d/` + own `AGENTS.md` + `cart.json`)

Reviewed: 2026-06-04 (other sessions were actively editing this cart during review; this reflects the working tree)

## High-level purpose

`hmsc-int` is the **world editor for Hitman Shitcity** — the authoring counterpart of the game cart `cart/hmsc`. Its architecture rests on three locked decisions (all in its `AGENTS.md`):

1. **It stages a real `GameState`** — the exact record the game boots from — and "Compile" persists it to the shared `'hmsc'/'game-state'` localstore key (`saveGameState`). Localstore is ONE store across carts (`fs.init("reactjit")`), so the editor IS the editor→game channel. The old "emit `wv_*` command text" model is explicitly dead.
2. **Every mutation goes through the game's own mutators** (`editorWorld.ts` calls `resolveBuildingPlacement`/`addBuildingToWorld`, `placeProp`, `addZone`, `addSurfaceRegion`, `placeCell`, `setBuildingFaceSkin`, `nextUniqueId`) so an authored thing is byte-identical to one the game made. No parallel schema.
3. **The preview is the game's own renderer** (`WorldStatics` from `cart/hmsc/render3d/GameWorld3D` + the matching capture components) — no renderer fork, so the preview can't drift from the game.

Workflow: paint top-down in 2D (tiles / heights / zones / placements over a sparse chunk grid) → live iso/free-fly 3D preview → **Compile** writes the boot key → the game boots that exact world.

It is a **multi-map workspace** (VSCode model): each map is its own session file; maps are *thin references* into shared global registries (tile kinds, object kinds, kind textures) — change a global, every map follows.

## File map (by subsystem)

**Spine / shell**
- `index.tsx` (833) — composition only: workspace persistence (`useWorkspace`, payload v2), multi-map CRUD orchestration, placement state + undo snapshots, tile-selection + override state, `previewWorld` assembly, compile, router. The 2×2 `QuadSplit` layout: PropertiesPanel | RightPanel / PaintCanvas | IsoPreview, under the persistent `ProjectBar`.
- `AGENTS.md` — the cart's own agent contract (mutator rule, compile-=-persist, shape map). *Drift note: it documents `MapCanvas.tsx`, which has since become `PaintCanvas.tsx`.*
- `ProjectBar.tsx` (235) — persistent top strip: map switcher (`MapsMenu`), new/rename/delete, undo/redo, route nav buttons (editor/test/labs/characters/vehicles/voxels/assist/cutout/textures/perf), Compile button, save pill, event-log popover. Menus export separately and render as the **root's last children** (the overlays-last hit-test rule, recorded in its header).
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
- `worldFile.ts` (178) + `assets.ts` (91) + `assetPrompt.ts` — the **other** (future) authoring lane: the world as a hand-editable `.tsx` file importing asset components, placements serialized as JSX tags at spreadsheet addresses; `ASSET_AUTHORING_PROMPT` is the codified contract for AI-generated assets (1 tile = 1m, 2-unit player anchor, Scene3D.Mesh emission). *Not wired to the main editor flow yet — a parallel model awaiting the bake pipeline.*

**game/chance.ts — the ONE odds engine (V9 capture, 2026-06-04)**
- `game/chance.ts` — the ruled hybrid REWRITTEN fresh: scape's multiplicative `ChanceBreakdown` surface (WHY is it 33% — base × range × los × cover × stance × awareness × health × time × skill, clamped, true-0 preserved) + hmsc/combat_lab's CONTINUOUS `coverFraction` input (`1 − f·0.8`; scape's binary partial→0.65 recovered exactly via `partialLosCoverFraction = 0.4375`; bone-sample contract carried as `COVER_SAMPLE_SPEC` + the pure `coverFractionFromSamples` fold). Every curve in `CHANCE_TUNING` (P2 — the V9 tuning lab's knob surface). Dice (`rollHit`/`rollZone`) rng-injected + `seededRng` (same seed, same fight). Ground-truth law intact: perception is never imported. Scape-path numerically identical over 1,728 defined cases; the one deliberate change fills scape's bare-ranged hole with the hmsc falloff curve. 18 P4 tests green; conflicts (skill law, crouch×cover compounding, awareness wiring) surfaced in `chance.CAPTURE.md`, not picked silently.

**game/perception.ts — the detective loop (V12 capture, 2026-06-04)**
- `game/perception.ts` — REWRITTEN fresh per V12 ("combat_lab produces, scape consequences consume"): the awareness ladder as a PURE step (`perceptionStep(state, input, ctx) → {state, events}` — FoV-cone vision, exposure×proximity/reactionSeconds suspicion fill, tile-noise hearing with run/walk/crouch carry, the 0.33/0.66/1.0 thresholds with dwell timers and decay, stimulus vs confirmed-only `lastKnown`, terminal by kind, single-step cascade preserved) + scape's consequence vocabulary (WitnessMemory / the Case / 5-axis Suspicion / `computeNotoriety` weighted blend) + the display warp (`perceivedChance` — the manic UI lie; truth never touched). Consequence hooks are inert-by-explicit-design returned events awaiting story/missions. `awarenessForChance` closes the chance capture's awareness seam as a P2 table. Fidelity: 14,412 cases identical to the importable references (warp + bias + notoriety); the ladder's inline-React reference is line-verified constants + 22 meaning-tests. FIRST-CUT curves (witnessCertainty, signature weights, visual heat) flagged in `perception.CAPTURE.md`.

**game/kinds/ — the kind registries (WO-2 capture, 2026-06-04)**
- `game/kinds/` — the V4 ground-floor data layer, REWRITTEN fresh from the hmsc registries (V17-TRIAGE: capture = rewrite; the old files under `cart/hmsc/` stay untouched behavior references). Five families behind one door (`game/kinds/index.ts`, exported as `GAME_KINDS` through `game/index.ts`): `tiles.ts` (18 kinds; the LOCKED road grammar — lane trios, flow-neutral `junction`, walk-preferred `crosswalk` — with lane flow as table DATA `flow`/`TILE_FLOW_VECTORS`, not a naming convention), `props.ts` (16 kinds borrowing tile bundles), `npcs.ts` (4 kinds + the faction regard matrix), `roles.ts` (the open role axis), `landforms.ts` (4 kinds; every fixed-shape constant lifted into `LANDFORM_TUNING` per P2). Each family ships P4 behavior tests (`*.test.ts`, shared `game/_testkit.ts`, run under `tools/v8cli`); `CAPTURE.md` records what was deliberately not carried (dead door sub-fields, two duplicated fields) and every ambiguity surfaced.

**game/commands/ — the console vocabulary (capture wave, 2026-06-05)**
- `game/commands/vocabulary.ts` — hmsc's 49-command console vocabulary (`cmd_/lab_/gv_/pv_/ev_/wv_` plus V27 `log`) REWRITTEN fresh onto the skeleton's mutable-ctx conventions (`cart/hmsc/commands/registry.ts` stays an untouched behavior reference). All 49 names register so the V19 script language is complete: captured commands run against command state + `COMMAND_TUNING`/`SKY_NAMED_HOURS`/`SKY_WEATHER_PRESETS` P2 tables + `GAME_KINDS`, `GAME_PERCEPTION`, V20 persistence, and V27 `GAME_TELEMETRY` diagnostics control (`log status`, `log all on|off|toggle`, `log <channel> on|off|toggle`, `log dump`, `log overhead`, `gv_perflog` as `spikes` alias). `wv_prop` is partial (kinds listing real, placement world-owned), and 14 explicit NOT-YET stubs FAIL LOUDLY (`system not captured yet: <owner>`; `NOT_YET_CAPTURED` exports the per-owner hand-off lists — roads/traffic/buildings/interiors/zones/validation, lab scenes, input contract). Dot-path state shape (`player.physics.velocity`, `config.sky.hour`) preserved so saved scripts keep meaning. `vocabulary.test.ts` (20 P4 cases) + `compile/verify/commands.cmds`; `rjit game verify` GREEN. `CAPTURE.md` records the boundary, dropped pieces, and surfaced ambiguities.

**game/pathing — host A* + lane discipline + motion plans (V5 capture, 2026-06-05)**
- `game/pathing.ts` (`GAME_PATHING`) — the door on the honest `__game_pathing_*` wire: grid/profile/flow publication, pre-calculated-until-disrupted routes (door-side change-rect ring), NEW `setKindClasses` (the lane-discipline opt-in) and host-COMPILED motion plans (`__game_pathing_plan` packed f64 → the exact `MotionPlan` shape; sampling stays JS closed-form per V16, zero bridge per frame; headless the `runtime/motion.ts` mirror builds the identical schedule). Implementation: `framework/game/pathing.zig` (A* rewritten from the deleted `v8_bindings_pathing.zig`; pathing_lab's `snapToLaneCenters`/`straightenJunctions` promoted host-side as RAW-cell-path passes — trio centers derived from contiguous same-flow runs, junction apexes at lane-line intersections, opt-in so un-opted callers are bit-identical) behind `v8_bindings_game_pathing.zig` (`-Dhas-game-pathing`; legacy `__path_*` names preserved). `zig build test-game-pathing` 14 P4 cases + `pathing.test.ts` 8 TS cases; `rjit game verify` GREEN. `pathing.CAPTURE.md` records sources, the deliberate improvement (discipline before merge), what wasn't carried, and the surfaced kinds/physics/V21 hand-offs.

**game/items/ — the items registry + models (V11 capture, 2026-06-05)**
- `game/items/` — game_item_gallery's ITEMS REWRITTEN fresh as DATA (`cart/game_item_gallery/index.tsx` stays the untouched behavior reference; the gallery UI + the V11 scale-audit workbench are fenced to `editors/items/`). The 19 model fns reduced to part TABLES at identity ctx (`items.ts`: 73 `ItemPart` rows — geometry-by-name, params, `#rrggbb` material, textureKey slot, p/r/s verbatim; zero React in the door); the 4 custom meshes are @reactjit/geometries-style pure generators (`geometries.ts`: blade/sail/boatHull/surfboard + `ITEM_GEOMETRY_DEFAULTS`). All 19 items `scaleStatus: 'unaudited'` — the authored numbers carried VERBATIM including the ruling's evidence (sailboat 1.35m vs knife ~1.31m, pinned by test, deliberately not fixed); `approxItemBoundsMeters` is the audit's numeric starting data. Texture keys renamed to `game-items/<id>[/<face>]`; texture CONTENT (StaticSurface labels/WGSL) stays gallery-side pending the materials capture. One door (`game/items/index.ts` → `GAME_ITEMS`). 8 P4 tests; `rjit game verify` GREEN. NO commands-stub flips (the 48-name vocabulary has no item-targeting command — an items-inspection command would be new vocabulary, surfaced not invented). `CAPTURE.md` records drops + 4 ambiguities (physics_lab catalog un-reviewed, `vehicle` item vs V10, scape's item-type layer, surfboard-as-leaf).

**game/camera.ts — the camera door (V3 capture, 2026-06-05)**
- `game/camera.ts` (`GAME_CAMERA`) — the door over the ruled split: the registry STAYS in `runtime/cameras/` and the two combat pieces GRADUATE INTO it (the one capture whose implementation home is runtime/). `runtime/cameras/rigs/aim.ts` = combat_lab's ADS over-the-shoulder rig REWRITTEN fresh as a first-class `CameraDef` — shoulder-shifted (0.62m), crouch-aware (1.62m − crouch·0.42m) pivot with a GENUINELY pitched axis (the aim-ceiling fix: screen-axis elevation == the pitch param), 2.4m ADS framing, fov 47, reference radian clamps carried bit-exact (`−1.15/DEG`/`1.0/DEG`); registry conventions adopted (degrees, pitch + = up). `aimPivot` exported as the seam for the game-side camera-collision clamp (needs physics — surfaced, not implemented). `screenRay` (R7) is now THE canonical pixel→ray in `runtime/cameras/unproject.ts` with `unprojectGround` a consumer; the two active-cart hand-rolls (`assist3d/picking.ts`, `VoxelHybridRoute.tsx`) re-pointed (old-cart copies await the lab rebuild per V17-LIFECYCLE). Door = `solve`/`screenRay`/`unprojectGround`/`aimPivot`/`rigs`(8)/`modifiers`, all pure. The crosshair law carried as contract + test: a fire ray is the solved camera's screen-center axis. Fidelity: 1,728-case Aim sweep + 150-case screenRay sweep identical to verbatim reference transcriptions; 13 P4 tests green. Ambiguities (the registry's yaw-convention fork, pivot-Y generalization, clamp-in-solve) in `camera.CAPTURE.md`.
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
- `PaintCanvas.tsx` (1265, the largest file) — the bottom-left authoring quad. Four layers (paint/height/place/zone) over focused chunks only; each focused chunk is one `<ChunkSurface>`; "+" ghosts on open sides grow the map. Brush input is the cutout pattern: a screen-space `<Pressable>` sibling over the `<Canvas>` (same-node down/move for pointer capture), rails rendered after it to stay clickable. Alt-drag pans; WASD pans via the Canvas `drift*` props when this quad owns WASD focus. Host calls: `__canvas_screen_to_graph` (pointer→graph coords, the same telemetry binding pixel_icon_demo wraps) and `__tel_input` (focused-node check so typing in an input never paints); key state via `__keydown`/`__keyup`/`system:blur` bus.
- `ChunkSurface.tsx` (72) — one chunk = one Effect quad; owns its coalesced GPU buffer (`usePaintedField`) and picks the layer's shader; registers a flush so a stroke re-uploads only its chunk.
- `usePaintedField.ts` (54) — the de-thrash core: brush `touch()`es at input rate (~100/s), encode+upload coalesce to once per frame (rAF/setTimeout-16). Decouples input rate from GPU upload rate.
- WGSL views: `heightField.wgsl.ts` (bilinear height → multi-stop elevation ramp + grid lines), `heightTileView.wgsl.ts` (height tint over tile ground — sculpting keeps tile context), `zoneView.wgsl.ts` (tile ground + translucent zone tint in ONE quad — no Effect-over-Effect alpha), `tileField.wgsl.ts` — **a re-export of the game's `HEIGHTFIELD_TILE_SHADER`** (`render3d/heightfieldSurface`): the editor paints with the very shader the game drapes terrain with. One source; what you paint is what boots.
- `BrushRail.tsx` (215) + `railAtoms.tsx` (173) — the per-layer left rail (tools, tile palette, brush size/shape/profile, height mode brush|ramp with ramp params, zone list) from shared rail atoms (ToolBtn/Swatch/sliders/steppers).
- `chunkFloor.ts` (95) — the painter→preview bridge: each focused chunk becomes a `ChunkFloor` {tileData, heights, hver} with **stable per-chunk identity** (the fix for the preview re-bake choke — rebuilt=1 reused=N−1); `floorsToLandforms` lowers floors to real `'heightfield'` Landforms so the preview and compile use the game's own terrain type.

**3D preview + inspection**
- `IsoPreview.tsx` (200) — free-fly no-clip camera (drag look, WASD fly, Q/E up/down; only while this quad owns WASD focus), fog off, far clip pushed out; world drawn by `WorldStatics` + the full capture family (Landform/Building/Prop/Part surface captures) so floors and facades texture exactly as in-game. Camera pose persists per map and autosaves on settle.
- `PropertiesPanel.tsx` (716) — the top-left **per-instance** inspector: header banner (swatch + bespoke gauges + profile radar drawn with `Graph` primitives) over a dense grouped data strip. Focus precedence: tile *selection* (bulk overrides) > selected placement (one-object world via `objectPreview.ts`) > active paint tile. Face-skin picker shows live mini-renders of real facades (`StaticSurface`).
- `RightPanel.tsx` + `tabs/` — right quad: Objects (breadcrumb browser over building/prop/tile/embedded/marker/assistant categories + `ModelViewer`/`ObjectInspect3D` + shared PropertiesPanel; green + places), Notes (TextArea persisted in the map payload), Chat (`useAssistant` claude_code chat, lazily armed), Settings (grid toggle, layout reset, autosave status).
- `ModelViewer.tsx` (116) — single-object studio viewer: no skybox/fog, OrbitCamera solved cart-side, drag via the global cursor channel, wheel zoom (notes `<Scene3D.OrbitControls>` is a host-side stub).
- `ObjectInspect3D.tsx` (139) — *pickable* viewer: click a part (deck, pillar, panel) to texture it; parts from the game's `buildingParts`/`propParts`; ray from the same solved camera that renders, so picks are exact.
- `objectPreview.ts` — builds a one-object mini-world via the real mutators so inspection resolves identically to the map.
- `TexturePreview.tsx` — one swatch component for both texture kinds (react-authored facade markup vs shader `Effect` with frozen data) — "texture is one concept."

**Routes (under `@reactjit/router`, hot-persistent via `hotKey`)**
- `/` editor · `/log` `LogView` (in-app tail of the V27 diagnostics/churn channel) · `/textures` `TextureStudio` (155: catalog rail → `ShaderLab` (189: tune named params on a shared base + overlay, **Materialize** freezes data[] into a stored material in the shared 'hmsc' store → joins `allTextures`) · `/assist3d` (below) · `/voxels` `VoxelHybridRoute` (544: a voxel build/mine surface — voxel_stack_demo's pattern grown an export: writes meshes to disk) · `/test` `TestRoute` (~266: walk the staged world — the FIRST real consumer of the `@game` ground floor, rewired 2026-06-04 per `TestRoute.REWIRE.md`; SUBSTRATE-0605 2026-06-05: the embodied drop-in moved to the shared `Embodied.tsx` substrate — this route keeps only its mode layer: the backtick console (live speed owner, teleport adopt-back), the RMB ADS aim opt-in, the `[probe-player-model]` diagnostic).
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
- `/build` `editors/build/BuildRoute` — CREATIVE BUILD MODE (V24): build the
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
- `editLog.ts` (90) — the *semantic* event trace (categorized EditNotes: tile/height/zone/chunk/object/camera/map), capped ring persisted to `sessions/_eventlog.json` (survives hot reload; not in the import graph so writes can't loop), shown in the ProjectBar popover with per-category colours and ~600ms coalescing for continuous edits.

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

- `worldFile.ts`/`assets.ts`/`assetPrompt.ts` lane (world-as-.tsx + AI asset generation + bake-to-Zig) is built but not wired into the main flow — it coexists with the GameState lane; the coherence pass must reconcile the two authoring models.
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
route (ProjectBar FlaskConical button): lab list on the left, the loaded scene
center, the notes always beside it. Shell stays game-agnostic: the lab list
crosses in as plain data at the router. The remaining index.tsx→shell/
inversion is the editors-capture lane.

## The data/ persistence layer (added 2026-06-05, Milestone-0 step 4)

`cart/hmsc-int/data/index.ts` is the V20 layer — `openStore(rootDir)` is the
only door. Per-concern append-only streams (`data/streams/<name>.jsonl`), one
TOTAL cross-session undo chain (a global sequence number across all streams;
an undo point is a log position — `stateAt(seq)` reads as-of, history is never
rewritten), and materialized snapshots (`data/snapshots/<name>.snapshot.json`,
stamped with their chain position) — the game/compile loads snapshots, never
history. The incompleteness guard is in the API: `defineStream` demands the
log name AND the materializer (initial+apply) in ONE registration — a stream
without snapshot support cannot be expressed. Stream/snapshot CONTENT is
gitignored (the content time machine); backup story = `store.exportBackup()`
(streams + manifest) or tar of `data/streams/`. Host gap flagged: no
`__fs_append` binding yet, so appends are read+concat+write (semantically
append-only; the reader tolerates a torn trailing line). P4 suite
`data/data.test.ts` rides `rjit game verify` (suite roots: game/ + data/).
`apply` receives each event's log position as an optional third arg
(`apply(state, event, seq?)` — the store always passes it; two-arg
materializers and the tests' direct-apply idiom stay valid).

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
- `/vehicles`, `/cutout` — already green (per-edit commits / draft autosave).
- `/characters` — the draft auto-commits debounced to the characters channel
  (`autosave · <name>` undo positions); mount restores the last roster entry.
- `/voxels` — NEW `editors/voxels/stream.ts` (the working blockout); restore
  on mount + debounced auto-commit; the JSON export is an export again, not
  the save. P4: `editors/voxels/voxels.test.ts`.
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

## editors/build/ — Creative Build mode, /build (V24, 2026-06-05)

The user builds the map WHILE PLAYING (BUILDMODE-0605): Fortnite-Creative
semantics on the embodied drop-in — since SUBSTRATE-0605 the player (V23
node-bound native camera, GAME_PHYSICS host step, GAME_WORLD colliders +
heightfields, captured-mouse look) is the SHARED `cart/hmsc-int/Embodied.tsx`
substrate, not route code (the original route carried a wholesale TestRoute
copy whose camera never engaged — CAMGONE-0605). Four pieces:

- `BuildRoute.tsx` — the builder layer over `useEmbodiedPlayer` (feeds
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

Wired as `/characters` + the User nav icon in ProjectBar (commit 1 of the
lane, before the vehicles route per the editors-wave coordination rule).
`rjit game verify`: 6 editor-core cases + 6 stream cases, VERDICT GREEN.
Surfaced, not guessed (CAPTURE.md): non-head sculpt detail previews live but
the bake composites head-only; `heldItem` is authored + stored but not baked
(V11 resolves items); item rotations ride verbatim until the scale audit;
editor session state is deliberately not streamed (documents are the
artifact).

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
the canonical catalog, `cart/hmsc/render3d/textureShaders.ts`): the shape's
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
