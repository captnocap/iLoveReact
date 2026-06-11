import type { DocIndex } from '../types';

export const hmsc_int: DocIndex = {
  name: 'hmsc-int',
  file: 'hmsc-int.md',
  cart: 'cart/hmsc-int/',
  purpose: ['world_gen', 'building', 'rendering', 'persistence', 'ai_edit', 'texture_bake'],
  loc: 9200,
  summary:
    'The world editor for Hitman Shitcity: paint top-down in 2D, preview in the game’s own iso/free-fly 3D renderer, and Compile to persist a real GameState to the shared boot localstore key the game boots from.',
  interfaces: [
    {
      name: 'game/index.ts (the GAME_* door)',
      purpose: ['host_bridge', 'game_loop', 'scripting', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/index.ts',
      description:
        'THE ONLY DOOR (V17): all 19 standard GAME_* exports. Live at milestone-0: GAME_PHYSICS (typed wire over the honest __game_physics_* bindings, v8_bindings_game_physics.zig; no fallback to the legacy __hmsc_* aliases), GAME_PATHING (over runtime/pathing+motion — still the __path_* names; no honest alias yet), GAME_INPUT (transport only, V7), GAME_CAMERA (pure side of @reactjit/cameras, incl. the V3-graduated Aim rig + R7 screenRay; V23 adds the opt-in native host controller in game/nativeCamera.ts), GAME_LOOP (clocks only, NO loop API — R3), GAME_COMMANDS (the V19 scripting surface), GAME_KINDS (the five kind tables), GAME_VEHICLE (V10 VehicleDoc + buildVehicle + semantic part vocabulary). The rest export { status: "capture-pending" }. @game bundler alias (cli/cart/bundle.ts) = the V18 metafile-gate signal. P4 *.test.ts beside every family, run under tools/v8cli.',
      status: 'live',
    },
    {
      name: 'roadData.ts (the road-stroke planner) + the ROAD paint layer',
      purpose: ['world_gen', 'ui'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/roadData.ts',
      description:
        'ROADSTROKE-0610: roads are authored as STROKES (centerline points + per-side profile), never tile-by-tile. planRoads() is the PURE compiler: user-ruled 3-tile lanes flowing with/against the draw direction (right-hand traffic), the NEW flow-neutral `median` kind between opposing groups (vehicleCost 6 closes the wrong-way-loophole; appended LAST in both kind registries), 2-tile sidewalk rings, junction boxes at carriageway overlaps, 2-deep crosswalk bands outside each leg. PaintCanvas ROAD layer + RoadRail.tsx author it (brush lays points, Enter stamps, pointer selects, one-way strokes show flow chevrons); stamping is DESTRUCTIVE into the chunk tile grids with an UNDERCOAT (cell→prior index) so edits/deletes restore the paint beneath (global restamp per change). Persistence: MapSnapshot.roads + roadUnder (legend-remapped by name). SPEED LIMITS (ROADSPEED-0610, req_0554): RoadProfile.speedLimitKph — the stroke is the carrier; ROAD_SPEED_PRESETS city 50/rural 90 chips + 5-km/h stepper in RoadRail; clampProfile defaults absent→city, clamps 10..130; strokeAtPoint/speedLimitAtPoint (filleted-centerline distance within ribbon extents) + routeSpeedLimitMps (strictest along the route); roadMotionProfile clamps a driving profile maxSpeed DOWN to the posted limit — the motion-plan consumer. GRADE MODE (ROADGRADE-0610, first elevation slice): roadGrade.ts — restamp smooths the painted heightfield under each stroke bed (centerline samples terrain at 1-tile steps, ~12-tile moving average irons potholes but climbs hills, zero crossfall curb-to-curb, 3-tile smoothstep feather to shoulders); pure strokeGradeProfile+gradeHeightField, wired in restampRoads with heightDirty so the 3D mirror + colliders follow; idempotent; deletes leave earthworks (Ctrl+Z restores). P4: roadData.test.ts (24) + roadStore.test.ts (3) + roadGrade.test.ts (4). Next slices: per-tile material stamping, deck/approach-strips/tunnel elevation modes.',
      status: 'live',
    },
    {
      name: 'game/build/microGrid.ts + game/world/navGrid.ts (the floor 3×3 micro-grid + THE NAV BAKE)',
      purpose: ['ai_edit', 'world_gen', 'game_loop'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/world/navGrid.ts',
      description:
        'MICROGRID-0610 (user-ruled req_0518): a floor IS 3×3 tiles; PlacedBuildPiece.cells carries 9 authored tile kinds (null = FLOOR_DEFAULT_CELL_KIND by material; resolveFloorCells/floorCellRects quarter-turn aware). bakeNavGrid is the FIRST producer for GAME_PATHING.publishGrid: one pure fold of painted 1m tiles (upsampled) + ground-level floor micro-cells + placedPieceColliders blocking, at 0.5m nav cells so a boundary wall blocks only the quarter-strips its slab covers (a per-cell grid cannot express a blocked edge). Door openings stay open with NO special case (collider bands already split); ramps/stairs stamp walkable links and are excluded from blocking (their bands ARE the slope); props block by DERIVATION (the dresser rule — move it, cells free); elevated pieces gate out until surface-nav. On GAME_WORLD. P4 navGrid.test.ts (8). THE CELL PAINTER (editor half): the buildings workbench col-3 panel grows a FLOOR CELLS 3×3 group on floor pieces — nine compass picks over PAINTABLE_TILE_KINDS, clear chip = default(<material kind>); store.setPieceFloorCell → setFloorCell → ONE prefabDefined commit; PrefabPiece.cells (validated floors-only/9/known-kinds) carries through stampPrefabPieces so the nav bake paths the paint; col-4 stage tints authored cells on the plate. NOT wired yet: road decks, multi-level.',
      status: 'live',
    },
    {
      name: 'game/world/navPublish.ts (THE LIVE NAV PUBLISH)',
      purpose: ['ai_edit', 'game_loop', 'host_bridge'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/world/navPublish.ts',
      description:
        'NAVLIVE-0610 (+TRAFFICGATE-0610 right-of-way, req_0554: game/world/trafficControl.ts — findJunctionBoxes flood-fills junction cells into boxes; associateTrafficControls attaches stopSign/trafficLight props to the nearest box ≤12m governing the approach they face against (yaw 0 faces -Z, the hmsc/world/traffic.ts convention); planMotionWithStops splits the deterministic schedule at controlled stop lines (box + 2-deep crosswalk band) — stop sign ends its leg AT REST and holds 1.5s, signal holds until its axis next green on the SAME TRAFFIC_SIGNAL_CYCLE the lamp glows with, green never splits; sampleMotionWithStops stays pure-in-t (V5). On GAME_WORLD.traffic. P4 trafficControl.test.ts (8). The grammar law: runtime gates the box, never the path graph.) — the live half of the nav bake — the active map (painted heightfield landform field.tiles + placed pieces) folds through bakeNavGrid and publishes to the host A* with the kind-table derivations riding along: navFlowTable (PATH_FLOW codes from each kind flow), navClassTable (junction/crosswalk = the lane-discipline opt-in), navProfileCosts (walker npc.walkCost / vehicle npc.vehicleCost, non-traversable -1). NAV_PROFILES {walker:0, vehicle:1}; vehicle sets laneOffset 1, againstFlow 8, crossFlow 2. THE HOST CAP: pathing.zig MAX_CELLS=16384 (mirrored PATHING_GRID_LIMITS) holds ~64×64m at the ruled 0.5m cells, so over-cap maps publish a square WINDOW centred on the player — reported in NavPublishResult.windowed, never silent; PlayRoute re-anchors when the player leaves the central half (1s poll) and re-publishes on worldGrid/pieces identity change. Raising MAX_CELLS host-side restores whole-map publish with no JS change. On GAME_WORLD (publishNavGrid/navProfiles). P4 navPublish.test.ts (7). NOT wired yet: a find() route consumer (NPC walkers / traffic).',
      status: 'live',
    },
    {
      name: 'compile/main.ts + rjit game compile/verify',
      purpose: ['scripting', 'maintenance', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/compile/main.ts',
      description:
        'The V19 skeleton: `rjit game compile` bundles the headless boot → zig-out/game/hmsc-headless.js; `rjit game verify` compiles fresh, runs the oracle self-check over docs/game/_index (every record file parses and has the fields tools/oracle dereferences, decisions.ts ids match V*/P*/R*, and 14 system smoke queries return matching rulings), runs every game/**/*.test.ts suite, boots the output under v8cli, replays every compile/verify/*.cmds command sequence (game/commands is the language), and exits with one VERDICT GREEN/RED line. The headless state is the captured GameCommandState + boot/tick locals, with a mounted V20 `commands` stream/snapshot adapter under zig-out/game/headless-data for gv_save/gv_load. The full 48-name console vocabulary is mounted (defineGameCommands), so verify scripts speak real commands (commands.cmds: 30 command lines). Grows as captures land.',
      status: 'live',
    },
    {
      name: 'labs/ + shell/LabsRoute.tsx + rjit lab new',
      purpose: ['scripting', 'ui', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/labs/index.ts',
      description:
        'The experiment slots (V13/V17/P5): labs/_scaffold.tsx(+.notes.md) is the template `rjit lab new <name>` copies (a lab = @game imports + an exported scene, nothing else; the paired <name>.notes.md is its P6 contract). labs/index.ts is the registry the CLI maintains at its rjit: markers. shell/LabsRoute.tsx (the first shell/ piece) renders the /labs route — list, loaded scene, notes always beside it — and stays game-agnostic: the lab list crosses in as plain data at the router (chrome FlaskConical button).',
      status: 'live',
    },
    {
      name: 'data/index.ts (the V20 store)',
      purpose: ['persistence', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/data/index.ts',
      description:
        'The V20 persistence layer — openStore(rootDir) is the only door. Per-concern append-only streams, ONE total cross-session undo chain (global seq across all streams; an undo point is a log position — stateAt(seq) reads as-of, history never rewrites), materialized snapshots stamped with their chain position (the game/compile loads snapshots, never history). The incompleteness guard is the API: defineStream demands name AND initial+apply in one registration. apply(state, event, seq?) — the store passes each event\'s log position; two-arg materializers stay valid. BACKING (STOREDB-0606 step 1, the user\'s ruling after the sessions.jsonl:884 outage): streams live in ONE sqlite DB, data/store.db (WAL + BEGIN IMMEDIATE via @reactjit/hooks/sqlite → the __sql_* ingredient); the events table is INSERT-only, concerns are the indexed stream column, and the global seq is allocated MAX(seq)+1 INSIDE the write transaction — N concurrent app instances serialize instead of tearing records or double-minting seqs (two-writer-PROCESS P4 hammer proof). data/streams/*.jsonl is the read-only INGESTED ARCHIVE: byte-faithful, tail-incremental import at openStore; originals never written, the user retires them. V20\'s law text needed no edit (it never named jsonl). TOLERANCE (step 0): reads NEVER throw — corrupt/partial records anywhere are skipped + logged loudly + quarantined in memory (store.quarantine(), byte-faithful {path,line,raw,trailing}); the fold continues with every valid record; nothing on disk is ever rewritten. Failed WRITES do throw (routes surface store errors). Backup = exportBackup() (per-stream .jsonl dump from the DB + manifest); restore = drop store.db + re-ingest the dump. Content gitignored (store.db caught by *.db patterns). P4 suite data/data.test.ts rides rjit game verify; scratch wipes must remove store.db{,-wal,-shm}. SNAPBOOT-0610 (review §9.1): the TOOL boots snapshot+tail too — defineStream reads the snapshot, replays only seq > snapshot.globalSeq, guarded by the snapshot\'s folded-event count vs the DB (mismatch/old-shape/damaged → full-replay fallback, never a throw); the full log is no longer heap-resident and stateAt(seq) pages history from the DB (cold path). Covering index events(stream, seq, id).',
      status: 'live',
    },
    {
      name: 'editors/controls.ts (the editor control contract)',
      purpose: ['ui', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/controls.ts',
      description:
        'EDITORCTL-0610 (review §3): the editor keyboard is ONE table — EditorBinding rows (action <concern>.<verb>, scope canvas|iso-build|bench, chords, label, legend, whileTyping/held flags), data only, headless-testable. validateEditorBindings at module init makes intra-scope key conflicts a BOOT-TIME error. editors/useEditorControls.ts is the one React dispatcher (chord normalization + THE typing gate, owned once; held bindings get both phases, release is base-key matched + gate-exempt so a pan never strands) + useHeldModifiers (the shared modifier tracker, was hand-copied per surface). editors/KeyLegend.tsx renders a scope legend FROM the table. Adopted: PaintCanvas, IsoAuthor, Workbench shell chords. Fold remaining transports (usePaintEditor tool keys, Embodied, sculptCamera, usePlayerDrive) by ADDING rows, never new busOn listeners. Gameplay keys stay on input/controlContract.ts (a different, ruled contract). P4: editors/controls.test.ts (6).',
      status: 'live',
    },
    {
      name: 'editors/sessions.ts (route-scoped session history)',
      purpose: ['persistence', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/sessions.ts',
      description:
        'The user\'s ruling ("route specific session commit histories... sprinkle in the edit commits after each interaction") on the V20 store: a route opens a session on its concern channel, every interaction appends one LABELED edit-commit. The sessions stream records lifecycle only (opened/committed/closed markers folded with their log positions); content events stay in their concern streams — the one global sequence orders the history cross-channel and an interaction\'s undo point is its commit\'s position. sessionsOnRoute(state, route) answers "what did I do this session, on this route". Two grades: commit(event,label) (content+marker+snapshots — /vehicles, labels like "car-1: style → van") and note(label) (marker-only — the / map editor\'s logEvent funnel; the workspace save path is UNTOUCHED and world content events join the same channel later by addition). editors/store.ts grew editorChannel(def) (cached defineStream on the ONE store — remounts can\'t double-register, private openStore forks the chain). createSessionLog(store) testable door / editorSessions() live singleton (the roster.ts split). P4: editors/sessions.test.ts (7) + editors/vehicles/roundtrip.test.ts (session-path round trip: buildVehicle byte-identical across reload). Characters-lane adoption hand-off: editors/SESSIONS.md. AUTOSAVE-0605 sweep (2026-06-05, USER RULING "every one of these routes needs to have its own auto-save system"): every authoring route now AUTOSAVES to its channel — / (reference), /vehicles + /cutout (per-edit commits, already green), /characters (debounced draft auto-commit + mount restore of the last roster entry), /voxels (NEW editors/voxels stream — the working blockout, restore + debounced auto-commit; was React-state-only), /textures (NEW editors/materials stream — Materialize/delete commits; was legacy-localstore-only), /assist3d (NEW assist3d stream — scene auto-commit through the one watcher funnel covering all backends; was side-files-only). /labs + /log N/A (author nothing); /test + /build wiring owned by the substrate lane.',
      status: 'live',
    },
    {
      name: 'index.tsx',
      purpose: ['world_gen', 'ui', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/index.tsx',
      description:
        'Composition spine (833 lines): workspace persistence (useWorkspace, payload v2), multi-map CRUD, placement state + undo snapshots, tile-selection + override state, previewWorld assembly, compile, router; the 2×2 QuadSplit layout under the persistent chrome strip (shell/chrome.tsx, ex-ProjectBar). MAPGONE2-0605 fix (2026-06-05): the payload gained optional view2d (the 2D canvas camera — saved via PaintCanvasApi.getView through the affine __canvas_screen_to_graph inverse, restored as Canvas viewX/viewY/viewZoom seed props); when absent, applyPayload centres the boot view on mapStore.paintedCenter (never the bare lattice origin on a non-empty map — the unrestored view snapping to origin over a featureless chunk is what read as "the map vanished" while every byte was intact; the whole load chain was probe-verified green hop by hop). Regression: editors/world/mapload.test.ts (3 P4 cases — renderer-consumed N cells never zero, the boot-view law, the view2d envelope round-trip).',
      dependsOn: ['useWorkspace', 'QuadSplit', 'shell/chrome (Chrome)', 'PaintCanvas', 'IsoPreview', 'PropertiesPanel', 'RightPanel', 'editorWorld.ts'],
      status: 'live',
    },
    {
      name: 'AGENTS.md',
      purpose: ['maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/AGENTS.md',
      description:
        'The cart’s own agent contract: mutator rule, compile-=-persist, shape map. Documents MapCanvas.tsx which has since become PaintCanvas.tsx (drift).',
      status: 'live',
    },
    {
      name: 'game/perception.ts (GAME_PERCEPTION — the detective loop)',
      purpose: ['perception', 'npc', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/perception.ts',
      description:
        'V12 capture (2026-06-04): combat_lab PRODUCES, scape consequences CONSUME — the awareness ladder as a pure step (FoV-cone vision, exposure×proximity/reactionSeconds fill, tile-noise hearing run16/walk8/crouch3.5m × tile noise, gunshot 40m fixed, thresholds 0.33/0.66/1.0 + dwells + 0.12/s decay, stimulus vs confirmed-only lastKnown, terminal by kind, single-step cascade) emitting inert consequence-hook events (spooked/alerted/hostile/panicked/sightingConfirmed/lostTrail/calmed) for story/missions; scape vocabulary (WitnessMemory, the Case, 5-axis Suspicion, computeNotoriety) + the perceivedChance display warp (the lie, never the dice). awarenessForChance closes the chance awareness seam (P2 table). All knobs in PERCEPTION_TUNING. Fidelity: 14,412 cases identical (warp+bias+notoriety); ladder constants line-verified (inline-React reference not importable). 22 P4 tests. FIRST-CUT curves (witnessCertainty, signature weights, visualHeatPerReport) surfaced in perception.CAPTURE.md. References untouched.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts', 'game/kinds (GAME_KINDS registries)'],
      status: 'live',
    },
    {
      name: 'game/telemetry.ts (GAME_TELEMETRY — measurement + copy-diagnostics)',
      purpose: ['telemetry', 'debug', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/telemetry.ts',
      description:
        'V14 capture (2026-06-04): the ground-floor measurement + copy-diagnostics surface REWRITTEN fresh — MEASURES ONLY, renders nothing (the panel is chrome’s; it polls this door at TELEMETRY_TUNING.panel cadences, scalars @250ms / JSON @500ms, and maps fpsTone good≥55/warn≥30/bad to its palette). Reads: the GAME wire subset as table data (SCALAR_HOST_FN getFps/getLayoutUs/getPaintUs/getTickUs/__tel_node_count; SNAPSHOT_HOST_FN __tel_frame/gpu/nodes/input/hostFlush; the __tel_history ring), snake_case→FrameRecord normalization, COUNTER_SPEC diffable set (zero_size excluded — cumulative garbage). HONESTY RULE: every read tolerates a missing host fn AND availability() names exactly which are absent (the ruled-in fix for the “diagnostics silently degrade” hazard — plus the door file is now a metafile-gate trigger on the telemetry registry entry so importing @game compiles __tel_* in). V27 PERFLOG-0605 adds the one runtime diagnostics system: DIAGNOSTIC_CHANNELS (frame/tick/physics/camera/figure/worldStream/bridge/hostFlush/draw/capture/hmr/pools/churn/spikes) are off by default, disabled-channel cost is a branch, enabled hot-path records aggregate over TELEMETRY_TUNING.diagnostics.aggregateWindowMs, and structured JSONL goes to /tmp/hmsc-int-diagnostics.jsonl. GCHITCH-0605 moved native camera cadence probes out of stderr: __game_camera_probe is sampled only by the camera channel, __tel_host_flush exposes reconciler queue/drain batches, bytes, and microseconds for the hostFlush channel, and the startup [probe-tick] path was removed from v8_app.zig. The old perfWatch spike recorder and perfLog churn path fold into channels controlled by GAME_COMMANDS log status/log all on|off|toggle/log <channel> on|off|toggle/log dump/log overhead plus gv_perflog as a spikes alias; diagnosticToggles exposes settings-ready values. Copy-diagnostics: buildDiagnostics(label, extra) — ISO timestamp, scalars, raw blobs, tape, lab extras top-level — pretty-JSON to __clipboard_set (called direct; the runtime clipboard module’s IFTTT side-effect import is wrong baggage). Every knob in TELEMETRY_TUNING (P2). 28 P4 tests green; sqlite3-rides-the-gate + the snapshot-subset choice + aggregate-only hot-path logging surfaced in telemetry.CAPTURE.md. References (perfWatch, massive-map button, panel idiom) untouched.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts'],
      status: 'live',
    },
    {
      name: 'game/story/ (GAME_STORY — narrative arcs, dialog, flags)',
      purpose: ['scripting', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/story/index.ts',
      description:
        'V12/V16/V20/V22 capture (2026-06-04): the "more internal tooling for story/mission/dialog" V12 orders, REWRITTEN fresh as pure steps with inert returns (the perception precedent — nothing dispatches; channelsFor names the bus channels as data, the shell owns busEmit and time). Flags: hmsc StoryState {flags, counters} verbatim (same-ref no-op writes, defensive reviveStory — NO ruling competes, the reference is the authority). The event log: hmsc gameEvents machinery (hmsc_evt_%06d ids, 240-ring, safePayload deep-copy, parentId provenance, importance families) with occurredAt as an INPUT (purity divergence, V20 determinism); murder.committed closes perception.CAPTURE.md’s deferred item — the event id IS what WitnessMemory/Case reference (chain proven in tests against GAME_PERCEPTION). Rules: the two hmsc story rules (lab.entered → lab.<id>.visited, labeled world.trigger.entered → trigger.<id>.seen) as data, applyRules pure with story.flag.set provenance effects. Arcs: linear staged progressions, conditions as data (flag/counter/event, P2); cascade semantics = state-gates cascade in one call, a live event moves AT MOST one beat; OPENING_ARC ships V22’s seven ruled beats (gate names first-cut; stage 5’s gate encodes the ruled constraint: opening.unfair-rating.cost-paid). Dialog (NO reference exists anywhere — built exactly what V16/V22 describe): selectDialog over state-only gates (createDialogSet REJECTS event gates — gate on the flag a rule sets; PROTECT THE ZERO made mechanical), priority + authored-order determinism, once-latch as a plain said.<id> flag, asCutsceneCue drops a selected line onto the V16 clock (seam proven against GAME_CUTSCENE.create/sample). All knobs in STORY_TUNING (P2). 28 P4 tests green; rjit game verify GREEN. narrative_hooks (text, world_delta) and relationship accumulation left to missions/V21 (surfaced in story/CAPTURE.md). References untouched.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts', 'game/perception.ts', 'game/cutscene/'],
      status: 'live',
    },
    {
      name: 'game/input.ts (GAME_INPUT — key/pointer transport)',
      purpose: ['input', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/input.ts',
      description:
        'V7 capture completed (2026-06-04): key/pointer TRANSPORT only — the integrator is the host’s (framework/game/movement.zig integrateHorizontal inside the physics step); the TRANSPORT-ONLY test pins the fence (stateless, |intent| ≤ 1, no step/integrate/velocity/position on the door). Keys: __keydown/__keyup bus → createKeyState held snapshot (case-insensitive; modifiers read from the FLAGS — Shift arrives with a useless raw name (sdl:1073742049 since key_pack.zig) but a true shiftKey, the camera_lab lesson; system:blur clears held keys since SDL never delivers the keyup after focus loss — the PaintCanvas idiom). Control contract as data (P2): INPUT_BINDINGS carries hmsc input/controlContract.ts’s 14 actions (implemented/reserved) with wire-true names (jump = ‘space’, run = the shift modifier; WASD only per the contract — the arrow-truncation hazard is CLOSED by framework/key_pack.zig, arrows arrive but the table doesn’t alias them); actionDown/moveAxes walk the table. moveIntent(axes, yawRadians) ships the camera-relative DIRECTION the committed physics wire takes (stepPhysics intentX/intentZ) — the deliberate, fidelity-pinned JS twin of movement.zig wasdDirection (no V8 binding exists; retires if one ships). Pointer: readPointer (getMouseX/Y/getMouseDown/getMouseRightDown), readPointerDelta (__mouse_delta — the mouse-look feed), setPointerCapture (__mouse_capture, honest transport report), onCursorMove (system:cursor:move). Typing gate: isTextEditing() via __tel_input.focused_id (input.ts is a metafile trigger on the telemetry registry entry so the binding compiles in). availability() names every missing pointer/typing-gate fn (the telemetry.ts honesty idiom). 15 P4 tests green; ambiguities (the wasdDirection twin, the arrow truncation — CLOSED 2026-06-04 by framework/key_pack.zig, the cross-door __tel_input wire, aimed-vs-light primary disambiguation) in input.CAPTURE.md.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts'],
      status: 'live',
    },
    {
      name: 'game/chance.ts (GAME_CHANCE — the ONE odds engine)',
      purpose: ['chance', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/chance.ts',
      description:
        'V9 capture (2026-06-04): the ruled hybrid REWRITTEN fresh — scape ChanceBreakdown surface (base×range×los×cover×stance×awareness×health×time×skill, clamped, true-0 preserved) + hmsc continuous coverFraction law (1−f·0.8; scape partial→0.65 recovered via partialLosCoverFraction 0.4375; combat_lab bone-sample contract as COVER_SAMPLE_SPEC + coverFractionFromSamples). All curves in CHANCE_TUNING (P2). rollHit/rollZone rng-injected + seededRng. Ground-truth law: perception never imported. Scape path numerically identical (1,728 cases); bare-ranged hole filled with the hmsc falloff. 18 P4 tests; conflicts (skill law, crouch×cover, awareness wiring) surfaced in chance.CAPTURE.md. References untouched.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts'],
      status: 'live',
    },
    {
      name: 'game/figure (GAME_FIGURE — the character kit)',
      purpose: ['character', 'ragdoll', 'damage', 'asset_pipeline', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/figure/index.ts',
      description:
        'V2/V2-AMENDED/V1 capture (2026-06-05): the head_lab kit REWRITTEN fresh (cart/head_lab untouched; editor UI fenced to editors/characters/). shapes.ts = P2 data (presets/8 body shapes/garments/LODs); skeleton.ts = 25-bone action-modulated FK + place/offset/blend; assembly/clothing bones-driven (sockets, finger fans, pose-tracking garments); rig.ts = BodyRigFrame + RULED damage zones (lArm/rArm/lLeg/rLeg over oriented boxes, 25 bones mapped) + anchors + buildRigFrameFromBones (the V1 seam); hed.ts/.body codecs (one-shape color+relief law, deterministic animations, seeded generateFace); ragdoll.ts = the V1 CONTRACT (seam + RAGDOLL_TUNING, deliberately NO solver — host feature is the physics lane, acceptance vs the archived JS reference); bake.ts = THE BAKE ENTRY (seeds/documents → deterministic host-shaped BakedFigures; partGlobeParams shared with render). render.tsx = preview path only (React-free door keeps headless verify clean). 24 P4 tests in 4 suites; CAPTURE.md records drops + ambiguities. Editors-wave addition (2026-06-04): stream.ts = the V20 \'characters\' concern (the ROSTER — authored BodyDocument per id + rail order; \'authored\' upserts the RESULTING doc so sculpt/outline/wardrobe edit logic stays editor-side and the round-trip is exact by construction, \'removed\' forgets; unknown kinds tolerated) + bake.ts grows bakeBodyDocument (BodyDocument → BakedFigure, the one doc→face mapping; what compile/verify/the editor bake trigger call — .body.heldItem rides the doc but not BakedFigure, the V11 lane resolves it). GAME_FIGURE.stream + GAME_FIGURE.bakeBody carry both; game/index.ts re-exports charactersStream/bakeBodyDocument + doc types as named exports (NOT a 20th door). stream.test.ts (6 P4 cases) pins the deletion-contract round-trip: author → stream → snapshot → bakeBodyDocument identical. PELVISMESH-0606 (USER ASK req_0022): the pelvis is a REAL PART — own PartId/preset/LOD, an ASSEMBLY instance on the pelvis bone wearing the dead pelvisSocket\'s exact sizing (×1.18), sculpt/grab/paint-editable and listed in every part roster; LIMBPAINT\'s pelvis paint SEGMENT folded into the part (the string \'pelvis\' keeps meaning — same 512×256 unwrap, now the pelvis mesh\'s own; PAINT_TARGET_NO_PART_FALLBACK emptied, the two-sets-of-tits cascade dead structurally). V20: body.ts partsWithPelvisFallback maps pre-split docs deterministically (pelvis = torso sculpt+profile copy — what the socket displayed) at parseBody/draftFromDocument/bakeBodyDocument/ModelPreview; generated citizens copy the torso profile/grid with ZERO extra rand draws (pre-split seeds keep their look). Damage zones unchanged (pelvis bone stays torso — splitting the ZONE is constitution-grade, surfaced not done); bottoms were already pelvis-bone-driven; hitboxes per-bone unchanged. 27 assembly instances (was 26), 8 anatomy sockets (was 9). CLOTHSPLIT-0606 phase 1 (USER RULING req_0040 — "clothing should effectively be a prop that is seperate but tightly related"): clothing is the wardrobe ATTACHMENT family. outfit.ts (new) = OutfitDocument {top, bottoms, print, accessories}, its own document riding the body as ONE optional channel (the paint precedent), never interleaved with the mesh truth; attachOutfit(bones, outfit, ...) dresses an EXISTING bones record (the V1 seam; clothing.ts placement byte-identical). rig.ts splits MeshRigFrame/buildMeshFrame (the clothing-free body — what mesh editing looks at; phase 2 mounts it); the dressed doors keep their signatures and compose mesh + attachOutfit (equality pinned in rig.test). V20: buildBody writes outfit only; legacy loose fields readable forever through outfitOf (deterministic, incl. DEFAULT_BOTTOMS coupling) at draftFromDocument + bakeBodyDocument; bodyWithOutfit = pure attach/detach (attach clears legacy — one wardrobe truth; detach round-trips byte-identically); BakeWardrobe retired for BakeOutfit. Phase 2 LANDED (2026-06-06, same ruling): the editor separation — THREE workbench contexts over ONE characterWorkbenchStore(): character (mesh ONLY — identity/part/shape/face-mesh/sculpt/regions; stage = buildMeshFrame UNDRESSED, no garments/held prop, no animation clock ever ticks there), clothing (Shirt icon — OUTFIT clothes/bottoms/print + EXTRAS + held PROP; stage = dressed figure, static pose), animation (Clapperboard — POSE/FACE-anim/SCRIPT+presets; stage = dressed ANIMATING figure, the pre-split face/rig/script clocks moved there wholesale). Rosters mirror; panel writes ride the same editDraft/autosave/V20 doors; the wearLens flip is structurally fulfilled and removed from relocated setters (kept on body-shape, mesh-side). ONE render derivation (editors/workbench/characters/figureFrame.tsx useFigureRender + FigureCaptures) feeds all three stages — capture keys lockstep with mesh texKeys. Parity ledger editors/workbench/WBCLOTH.CAPTURE.md; mechanical parity pin in source.test.ts (22/22). /characters route untouched (dies at its own flip).',
      dependsOn: ['game/_testkit.ts', 'game/index.ts'],
      status: 'live',
    },
    {
      name: 'game/vehicle (GAME_VEHICLE — the V10 vehicle module)',
      purpose: ['vehicle', 'damage', 'rendering', 'world_gen', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/vehicle/index.ts',
      description:
        'V10 capture (2026-06-05): vehicle_lab\'s reusable system REWRITTEN fresh behind the game door (reference untouched; authoring UI deliberately out of scope for editors/vehicles/). Captures VehicleDoc, makeVehicle(seed), buildVehicle(doc, actions), 18 semantic VehiclePartId entries, 8 styles, 4 roles, 5 pose DSL presets, sparse damage map, material metadata, explicit hitboxes, critical parts, named anchors, service liveries, and action-driven wheel/steer/bounce/brake transforms. Renderer dependencies dropped at the boundary: meshes carry kind+params, not Geometry imports. P4 suite sweeps 64 style/role/gas cases and asserts the tables\' meaning; CAPTURE.md records dropped UI and scale/material/animation ambiguities. Editors-wave addition (2026-06-04): stream.ts = the V20 \'vehicles\' concern (the GARAGE — authored VehicleDoc per id + rail order; \'authored\' upserts the RESULTING doc so edit logic stays editor-side and the round-trip is exact by construction, \'removed\' forgets; unknown kinds tolerated). GAME_VEHICLE.stream carries it like world/missions; game/index.ts re-exports vehiclesStream + the doc types as named exports (NOT a 20th door). stream.test.ts pins the deletion-contract round-trip: author → stream → snapshot → buildVehicle identical.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts'],
      status: 'live',
    },
    {
      name: 'editors/vehicles (the vehicle editor route)',
      purpose: ['vehicle', 'ui', 'persistence', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/vehicles/VehiclesRoute.tsx',
      description:
        'Editors wave (2026-06-04): cart/vehicle_lab\'s authoring UI REMADE ENTIRELY as the /vehicles route in the one shell (V10/V17-TRIAGE; the reference stays untouched until the user deletes it — CAPTURE.md is the deletion contract, all 13 inventory capabilities DONE). edits.ts = every control as a pure tested doc-step (editStyle with gas-port REFIT clamp, editRole pool coercion + service livery, setGasZ/gasZKnobSpec clamp law, seeded repaint/wreck on the captured tables, sparse damage set/nudge/repair; VEHICLE_EDITOR_TUNING carries both reference gasZ clamp ranges verbatim, P2). VehiclesRoute.tsx = the garage rail over the V20 vehicles stream on the tool\'s ONE store (editorChannel + a RouteSession per visit — every edit = one LABELED session commit, authored event + marker + fresh snapshot; view state transient by design; the original per-mount private openStore was removed as a forked undo chain), style/role/pose chips, run playback through GAME_ANIMATION.parse/sample, hitbox-group selection, damage chips, memo\'d mesh/hitbox/anchor overlays, orbit viewport on the V23 native per-node controller (Scene3D.Camera nativeCamera + GAME_NATIVE_CAMERA.forNode: setOrbit on knob change, setInputDeltas per drag move, disable on unmount; GAME_CAMERA.rigs.Orbit solves the static boot frame only — a drag never re-renders the cart; VIEW_TUNING stays the rig params + GAME_CHROME.LabEnvironment arena + orbit.zoom knob preset), contract readout. Strictly through the @game door — vehicles has NO internal-reach exception. Mesh kind→Geometry mapping at the route boundary per the V10 capture rule. 8 P4 cases (vehicles.test.ts, the editors suite root in rjit game verify) + the stream\'s 5 round-trip cases. Surfaced, not guessed: the two gasZ clamp ranges, compile-side garage consumption (placement belongs to the world stream, not the doc), the open V10 scale audit. The orbit yaw sign question is RESOLVED (V25 DRAGSIGN-0605, 2026-06-05): the lab\'s legacy +dx FLIPPED to the /test-pinned -dx convention — one drag convention everywhere; pinned conventions beat legacy behavior (CAPTURE.md ambiguity 5, resolved).',
      dependsOn: ['game/index.ts', 'data/index.ts (the V20 store)', 'game/vehicle (GAME_VEHICLE — the V10 vehicle module)'],
      status: 'live',
    },
    {
      name: 'editors/characters (the character editor route)',
      purpose: ['character', 'ui', 'persistence', 'asset_pipeline', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/characters/CharactersRoute.tsx',
      description:
        'Editors wave (2026-06-04): cart/head_lab\'s authoring UI REMADE ENTIRELY as the /characters route in the one shell (V2/V17-TRIAGE; the reference stays untouched until the user deletes it — CAPTURE.md is the deletion contract, all 27 inventory capabilities DONE). The headless core is pure + tested: draft.ts (CharacterDraft ↔ BodyDocument/HedDocument lossless; the .hed coherence law — face residue moves into the head grid, the kept face zeroes its sculpt; region sliders bake INTO the sculpt at export), regions.ts (SHAPE_REGIONS + elliptical stamp math, REGION_TUNING P2), generate.ts (one seed → one complete deterministic draft on the kit\'s mulberry32; GENERATE_TUNING P2), roster.ts (save = \'authored\' event + snapshot materialized in the same breath; createRoster(store) testable, editorRoster() live), editors/store.ts (lane-neutral ONE Store per process = one globalSeq authority — the vehicles route should adopt it). CharactersRoute.tsx = sculpt painting (per-part GPU paintables, raise/carve/flatten, mirror, DEPTH_OVERLAY_WGSL heat+contours+guides, fill/soften/clear, stroke→48×24→dyn mesh), outline lathe + region sliders (latch previews, commit on release), face tools (paint→.hed layers + undo-last, seeded generate, talk/chew/cry/yell, photo drop), wardrobe (8 shapes, tops/bottoms/prints/extras, held item via game/items part tables — HeldItemMeshes), poses + GAME_ANIMATION DSL script + 32-preset shelf (animPresets.ts P2), hitboxes/anchors overlay, memo\'d PartMeshes (orbit drag re-renders only the camera node), the richer capture stack (photo head / underwear torso stamps / clothing prints — the RULED editors-reach-into-game/figure exception). 6 P4 cases (characters.test.ts, editors suite root) + the stream\'s 6. Surfaced: non-head sculpt detail previews live but the bake composites head-only; heldItem authored+stored but not baked (V11); item rotations verbatim until the scale audit. GRABSHAPE-0605 (2026-06-05, USER ASK): DIRECT MESH GRABBING beside the grid depth-paint — hover the 3D preview shows a handle dot + influence shell snapped to the grid cell under the cursor (only where a grab really works); mousedown on the mesh grabs (elsewhere orbits, same Pressable), drag deforms live (throttled GRAB_TUNING.liveSyncMs), release = final stamp + labeled V20 note. ONE TRUTH: a grab stamps regions.ts stampGrid into draft.grids[part] — the identical 48×24 grid the depth-paint edits — and release uploads bytesFromGrid to the paint texture so the next stroke\'s readback composes (no second deformation store). Honest parameterization: the Globe is radial-only, a grabbed point moves along its outward axis (no tangential parameter — silhouettes stay the outline lathe\'s); stamp radius rides the brush knob, mirror stamps the meridian twin, depth-amount scales the axis 1:1. grabKit.ts = the pure core: clouds sample cells through @reactjit/geometries globeSurface (the exact analytic surface generate() builds from, exported this lane), pick = min-t front-facing cell, adaptive radius from BOTH row+column spacing (column-only missed the slim pipe). Picking solves the orbit rig from the JS shadow through GAME_CAMERA.screenRay + the NEW worldToScreen (screenRay\'s exact inverse, runtime/cameras/unproject.ts) — registry pure math, V26-sanctioned. Figure view grabs the ASSEMBLY only (anatomy sockets reuse other parts\' grids; clothing is garments — grabs reach through sleeves) and grabbing a part selects it (the unwrap canvas follows — two views, one truth, visible). instanceScaleVec = the one render/pick scale law. +3 P4 cases (pick-resolves-to-the-right-part on a real rig+camera; drag-then-paint compose both orders; axis outward/amount/screen mapping). GRABGRID-0605 (2026-06-05, USER ASK after hands-on): (1) the GRID TOGGLE — an inflated twin of every visible instance of the selected part (same geometry/dynamicKey, zero extra generation) wears ONE static grid texture (GRAB_GRID_TEXTURE_KEY = StaticSurface-baked GRAB_GRID_WGSL Effect); Globe UVs ARE unwrap space so the hairlines run THROUGH the 48×24 cell centers — every intersection dot IS a pullable point and the lattice stretches with the surface as a drag deforms ("see how much a drag stretches the graph"); texture alpha rides the capture (clears a=0) through the mesh shader\'s tex_sample.a; opacity 0.92 → transparent pass, depth-tested (far side culls); figure view grids ALL assembly instances of the selected part (one sculpt, many placements, visible); module-const Effect props (the StaticSurface inline-identity re-bake hazard). (2) grid + mirror chips overlay the 3D pane, visible in every tab — mirror binds the SAME state the paint brush reads (it used to hide behind the paint-tab conditional). (3) DRAG-FEEL FIX for the user\'s real "head easier than torso" report: screenAxisFor reworked — direction from the projected axis, sensitivity floored at minPxPerUnit (56px/unit, every part same hand-feel), and under degenerateAxisPx the camera-facing case (the torso\'s flat scaleZ-0.62 front) falls back to drag-up-pulls-out at fallbackPxPerUnit (90px). Axis P4 case grew floor + fallback assertions; 11/11 green. GRABQOL-0605 (2026-06-05, round two): (1) UNDO/REDO — ctrl+z / ctrl+y / ctrl+shift+z (useIFTTT keys; host suppresses keys while a TextInput focuses) + viewport chips; the stack is the shared painter\'s createPaintHistory over deep-copied CharacterDraft snapshots (50-deep, 250ms coalesce) committed BEFORE every commit-grade interaction (stroke/grab release with the pre-drag grid swapped in, fill/soften/clear, outline drag+reset, region sliders, wardrobe/skin/prop/pose picks, generate/load/import); restore = installDraft + autosave (the restored state IS the working draft on the V20 chain). (2) the LIT NODE — the grid texture takes data=[hoverU,hoverV,mirrorOn] and lights the hovered pull point hot in the lattice (plus the meridian twin when mirror is on — both stamp sites visible); the capture re-bakes only on cell change (data memo\'d — the inline-identity hazard inverted on purpose). (3) the ANGLE FIX: pickGrab = front-facing candidates within radius → min-t first surface → NEAREST-THE-RAY cell inside that depth window (pure min-t favored silhouette cells at oblique views — "hit box gets funky on angles"); a visible cell\'s own pixel picks exactly that cell, P4-pinned over camera-facing probes (a back cell\'s pixel still picks the front surface — occlusion correct). (4) FULL ORBIT — pitch clamp 4..85 → ±88 (host orbit doesn\'t clamp; the JS clamp is the one authority; ±90 degenerates the look-at up) + the studio floor dropped (LabEnvironment ground={false}): under-horizon views put the camera inside the floor box — the "workspace went black" live report. (5) ZOOM — the knob shows distance reflected across its spec range so + always moves CLOSER, and the wheel dollies through the raw onScroll fallback (events.zig hitTestScroll, built for transparent-overlay-over-Scene3D camera dolly): wheel up = in, one knob step per notch. 11/11 GREEN. GRABNAV-0605 (2026-06-05): ZOOM-TO-CURSOR — wheel IN converges the orbit pivot on what the cursor points at (the mesh cell when pickAt hits, else the ray\'s closest approach to the pivot) so aiming at the face brings the FACE in ("the zoom lands right in the crotch"); wheel OUT drifts the pivot home — fully zoomed out is always the whole body recentered, no lost-camera state. Pivot = orbitTargetPan twig offset from the view center, clamped to TUNE.orbit.panY/panXZ; the param effect re-sends the rig on pan (V23: params on change). Middle-drag pan rejected honestly: move payloads carry no buttons and js_on_middle_click is dead plumbing (host rebuild) — zoom-to-cursor is pure TSX. Plus RESET PART ("reset only works on the head" was real — \'clear\' hides behind the detail tab, \'reset outline\' is silhouette-only): one chip in both tab rows resets sculpt grid + outline + regions AND clears the paint texture, undoable. NORMALPULL-0605 (2026-06-05, USER REPORT "directional split — a chest pull always comes out at an angle toward its side, mirror or not"): the Globe displaced along the CORE-AXIS RAY, which tilts sideways off the front meridian and the torso\'s scaleZ 0.62 flatten amplified it (~12°/cell). Fixed in globeSurface (runtime/geometries/Globe.ts): displacement now grows along the BASE SKIN\'S NORMAL (finite-differenced, poles collapse to ±Y) — a chest pull comes out the chest; bake parity by construction (same generator), the grab drag axis became the normal for free (the extraDisplace probe). P4-pinned compatibility: zero displacement = base exactly (static bakes stay byte-valid); on a sphere normal IS radial (heads unchanged; world-units preserved). The radial-only PROFILE law untouched. 12/12 + smoke + full verify 51/51 GREEN. GRIDSHELL-0605 (2026-06-05, USER REPORT "hit some bend and the grid mesh is being swallowed"): the lattice overlay was the part mesh inflated 1.2% by CENTER-SCALING — a radial lift that stops clearing the skin inside concave bends (a carve bowl curves inward; the scaled twin dips under and the transparent pass\'s depth test hides the grid; NORMALPULL made real bends common and exposed it). Fix: a true NORMAL-OFFSET SHELL — gridOverlayParams (grabKit) = the part\'s own params with a CONSTANT added to every displacement cell (a constant survives the bilinear sample and pole averages), so the surface is exactly the skin pushed GRAB_TUNING.grid.lift (0.018 local units, amount⁻¹ into grid space) along its local normal EVERYWHERE; rides its own dyn slot (.grid on the slot id — different verts than the skin now); the center-scale inflate is gone. P4: constant-lift gap pinned at carve bowl/bump/flank/pole rows (±2%). 13/13 + full verify 51/51 GREEN. GRABFLY-0605 (2026-06-05, USER ASK "wasd the camera... kinda like a noclip"): a FLY camera mode on /characters — the IsoPreview noclip pattern on the route\'s V23 node. \'fly\' chip (twig, DEFAULT ON) flips the host controller to freefly: WASD + q/e (shift/space) move at TUNE.fly.speed with the HOST integrating position per frame (setMoveAxes on key edges via the __keydown/__keyup bus — a focused TextInput consumes keys before the bus, typing never flies); drag-on-empty looks (FPS sign, ±89 matching the host clamp); drag-on-mesh still grabs; wheel dollies along the CURSOR RAY. Pose persists via the flyPose twig, saved at rest points from getFreeFly() readback. Picking solves the FreeFly rig from that readback — registry lookForward is formula-identical to the host\'s, so the pick camera IS the rendered camera mid-flight. Orbit keeps everything (zoom-to-cursor, reflected knob — knob hides in fly, a key-hint line replaces it); orbit param effects gate on mode so the rigs never fight. 13/13 + full verify 51/51 GREEN. CAMFOCUS-0606 (2026-06-06, USER VERDICT "the camera is offset on load every time... dont remove anything but the focus of the camera needs fixed"): measured cause — fly boots by default and flyPose/orbitTargetPan twigs restored verbatim (a noclip pose is relative to nothing; the on-disk twig aimed off-subject, orbit pan pinned at clamp, yaw -365°). Cure (neither camera removed, persistence intact): deterministic SUBJECT FRAMING — editors/sculptFraming.ts (pure registry math, P4 7/7): bounds from grab-cloud world points, distance fits the sphere in the fov × TUNE.frame.margin (P2) clamped to the zoom range, fly pose = the framed orbit eye through fpsLookAt (lookForward\'s exact inverse). Runs at boot (outranks the stale restore), on focusKey change (routes bump an epoch on load/generate/import/new; part switches reframe in part view only — never on figure grab-select; undo holds still), and on the F verb. Discoverable: explicit orbit/fly chip pair + a focus·F chip on /characters and /items; C flips rigs on the key bus; both hint lines teach F/C. V23/V26 unchanged. CAMBIND-0606 (2026-06-06, USER DIAGNOSIS "it doesnt automatically update its state with the tab... a hot update finally updates the tab"): the once-on-mount engage went stale when the camera node remounted under the hook (workbench lens/tab switches reparent the viewport per lens — bare, boxed, or unmounted), leaving the controller writing a DEAD node until an HMR remount accidentally re-engaged; the view froze on every view except the mount-time one. Engagement now FOLLOWS THE NODE ID: checked every render, re-bound through one pure full-state sequence (sculptFraming.applySculptEngagement — fly: freefly+smoothing 0+pose+axes cleared; orbit: axes cleared+rig+mode; the mode-flip effect rides the same sequence). Boot framing on first engage only; a rebind keeps the user\'s pose and logs "camera re-bound → node N". No reliance on remounts — survives lens restructures by construction. P4 sculptFraming.test.ts 8/8. CAMSENS-0606 (2026-06-06, USER: "the freeroam ... has the dpi of like a million so a small movement goes like 720 degree spin"): measured at the one seam (sculptCamera.orbitMove) — fly was NOT raw deltas, but its 0.3°/px sat at orbit\'s rate and an fps look rotates the VIEW DIRECTION (subject leaves a 45° fov after ~75px of drag) where orbit swings the eye around a centered subject. Fly lookPerPx dropped to 0.08 (~4× under orbit\'s 0.4); the camera FEEL numbers became /settings P2 tunables (paintKit registers the sculpt-camera cluster — orbit yaw/pitch °/px, fly look °/px, fly speed/wheel, frame margin — write-through, the user dials their own DPI); the first look-drag per rig per bundle eval warns its measured px-in → °-out ratio to the dev terminal. V26 untouched (rig parameter scaling, host drive unchanged). MESHSMOOTH-0606 (2026-06-06, USER ASK req_0024): the SMOOTH verb + the MATRIX DATA DOOR — they shape, the machine rounds. Measured on the user\'s own shaped torso: faceting is ROUGHNESS-bound (|cell−neighborhood mean| 0.154 vs ~0.007 on smooth-reading parts, same 48×24 grid), not resolution-bound; resolution surfaced as the secondary ceiling (bilinear cell creases, ±1-saturated plateaus — CAPTURE.md). smoothKit.ts (pure, seam-aware: x wraps, y clamps): relaxGrid = the smooth-part action (strength × the twig-shared smooth-passes knob, SMOOTH_TUNING P2; status reports roughness before→after), relaxStamp = the smooth brush beside raise/carve/flatten — paintable on the unwrap AND grab-draggable on the mesh (drag distance = dose at the grabbed cell, recomputed from base, never compounding; green marker). Convex relaxation conserves silhouette bounds (P4). One truth: setPartGrid + texture upload, undoable, noted; /characters and the workbench stage wire the identical kit. gridData.ts: save-sample writes hand-editable one-row-per-line JSON to sessions/sculpt-grids/ (V20 additive, collision-suffixed), sample chips reapply EXACTLY (cell-=== pinned); format documented for AI-lane hand-rounding. smooth.test.ts 9/9.',
      dependsOn: ['game/index.ts', 'data/index.ts (the V20 store)', 'game/figure (GAME_FIGURE — the character kit)', 'game/items (GAME_ITEMS)', 'game/chrome (GAME_CHROME)'],
      status: 'live',
    },
    {
      name: 'editors/items (item sculpt modules; route retired into workbench)',
      purpose: ['item', 'voxel', 'geometry', 'ui', 'persistence', 'asset_pipeline'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/items/bake.ts',
      description:
        'WBITEMS-FLIP-0606: /items route and Gem chrome icon deleted after Workbench item-source parity; itemsSource() now owns ITEM/SCULPT/VOXEL authoring while bake.ts and stream.ts remain the shared data doors. ' +
        'ITEMSCULPT-0606 (2026-06-06, USER ASK "take a model i can make in the voxel editor, and then bring this into an item editor that behaves just like the character editor for the mesh of it, so i can smooth out the blocky shape for game items"): the /items route (Gem nav icon) — the /characters sculpt hands pointed at ONE Globe item. PARAMETERIZATION (bake.ts, headless): import = GLOBE-WRAP — bakeBlockoutToGlobe ray-marches the /voxels occupancy from its centroid along every 48×24 unwrap-cell direction (the exact (u,v)→direction map globeSurface uses; a block at integer coords is the unit cube ±0.5, /voxels\' own convention), takes the LAST occupied sample per ray, encodes extents as base radius (mean) + amount (max deviation × headroom, floored so near-spheres still sculpt) + the signed grid; voxel units are METERS so items arrive real-scale. THE LIMIT SURFACED (status line + header + P4-pinned as real): star-shaped from the centroid — concave overhangs/holes flatten to their hull; right for bottles/bats/tools, any-topology would need marching-cubes + a new pick parameterization (rejected this pass). REUSE NOT RE-ROLL: grabKit went GENERIC over the mesh key (GrabInstance<P>/GrabCloud<P>/GrabHit<P>, default PartId — characters call sites unchanged; /items grabs key \'item\'); editors/sculptCamera.ts is NEW-shared — the orbit+noclip-fly+zoom-to-cursor camera EXTRACTED VERBATIM from CharactersRoute (same twig keys so saved poses survived; V23/V26 law unchanged; CharactersRoute shrank ~230 lines to a hook call, /items is the second call site); paintKit byte↔grid + DEPTH_OVERLAY_WGSL, the shared painter\'s stroke engine + history, GrabMarker/GrabGridCapture all imported (the cutout-models cross-editor-import precedent). ONE TRUTH: one 48×24 signed grid is the only deformation store — grabs stamp it, depth-paint reads back into it, mesh + lattice shell generate from it through globeSurface, release uploads keep the compose law. V20 day one: stream.ts (the \'items\' concern — SculptedItemDoc {radius, amount, grid, color, source provenance}, authored/removed upsert/delete, unknown kinds pass; ONE store with /voxels so import reads the channel /voxels autosaves), debounced autosave, labeled session notes, mount restore, ctrl+z/y history. REGISTRY DOOR (V11): ITEM_GEOMETRIES grew \'globe\'; ItemDefinition grew optional heldScale; sculptedItemDefinition(id, doc) shapes a saved item as ONE globe-part definition (heldScale 1 = real meters; scaleStatus stays \'unaudited\' — the audit is the user\'s verdict); /characters lists the sculpted roster as ◆ prop chips and HeldItemMeshes resolves them via the new extraItems prop — a sculpted item is HOLDABLE the moment it saves (roster read once per route mount). NOT yet wired: world-drop/bake consumption (the V11 items lane proper). P4 items.test.ts 7 cases (bake determinism + bounded cube field + symmetry; off-center mass shift AND the wrap limit asserted real; amount floors; grab-stamp compose on the baked surface; R8 round trip; registry door; stream fold + on-disk snapshot). Full verify 52/52 GREEN.',
      dependsOn: ['editors/sessions.ts (route-scoped session history)', 'data/index.ts (the V20 store)', 'game/items (GAME_ITEMS)', 'editors/characters (the character editor route)', 'game/chrome (GAME_CHROME)'],
      status: 'live',
    },
    {
      name: 'editors/paint (THE shared painter)',
      purpose: ['ui', 'texture_bake', 'asset_pipeline', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/paint/index.ts',
      description:
        'Editors wave (2026-06-04): cart/cutout\'s painting tool ("actually good for painting" — the user\'s ruling) CAPTURED as the one paint surface every editor that paints embeds — characters first (replacing paintKit\'s hand-rolled input plumbing; adoption hand-off in CAPTURE.md, the swap belongs to the characters lane), materials/textures later. One painter, no per-route forks; cutout stays the untouched behavior reference until the user deletes it. ONE door (index.ts): the headless PAINT core — tuning.ts (P2: bands, pressure curve, dab spacing, edge-snap, lasso rules, history cap/coalesce, φ hue stagger, palette, backend tunables), strokes.ts (createStrokeEngine: pointer samples → gap-free dab lists with pressure lerp + mirror symmetry + sobel edge snap; CPU raster ops; createVectorStroke min-step capture; dims-generic soften3x3), layers.ts (the dual-source model: smart base + brush override per layer, the 192/64/128 band compose, merge/invert/union, RLE PaintDocument v1 on @reactjit/workspace/rle), history.ts (generic before-action undo: 50-deep, 250ms coalesce, LAZY builders), surfaces.ts (6 built-in animated WGSL surfaces texture+cells mode, marching ants, 2 color slots, custom registry + adopt/inflate; in-shader compose mirrors effectiveMask), backends/ (SelectionBackend seam + flood/SAM + makeDefaultBackend) — plus the live half: usePaintEditor (cutout perf invariants: dabs straight to the GPU override texture, never per-dab setState; readback at discrete commits; prefix-namespaced paintable ids so embeds coexist; V20 session prop = ONE labeled edit-commit per interaction, RouteSession satisfies it), PaintSurface (full-viewport-safe rect-driven viewport, screen→world→source discipline), PaintToolRail/PaintLayerStrip/PaintLookPanel (chrome-kit), PaintEditor (the one-liner). Persistence is the HOST\'s call (documentVersion + lazy buildDocument/applyDocument/composeExportMask; no fs writes). paint.test.ts 29 P4 cases (editors suite root) GREEN; JSX bundle-verified through the cart pipeline. Surfaced: refine snaps dab centers (the active cutout path) with paintCircleEdgeAware on the door; hotkeys default ON (pass hotkeys:false when the host owns keys); paint-doc v1 deliberately does not parse cutout-session v2.',
      dependsOn: ['data/index.ts (the V20 store)', 'editors/sessions.ts (route-scoped session history)', 'game/chrome (GAME_CHROME)', 'runtime/workspace/rle'],
      status: 'live',
    },
    {
      name: 'editors/cutout (the cutout painter route)',
      purpose: ['ui', 'texture_bake', 'asset_pipeline', 'persistence', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/cutout/CAPTURE.md',
      description:
        'CUTOUTFLIP-0606 (2026-06-06, USER RULING verbatim "cutout needs work but its at least got everything from the route in there so its g2g nuke that shit"): the /cutout ROUTE IS DEAD — CutoutRoute.tsx deleted, the route + Scissors nav icon deregistered, EffectModal extracted to editors/workbench/paint/EffectModal.tsx, vehicle paint-texture deep-links retarget /workbench (the bench store consumes the pending-model-target mailbox). The directory\'s shared internals (ToolRail · Inspector · StatusBar · ModelPreview · models/extraction/sources/draft/stream + tests) LIVE ON as the workbench PAINT bench\'s modules (WORKBENCH.md step 8 done; parity table editors/workbench/AGNOSTICPAINT.CAPTURE.md). The remainder of this record describes the route AS BUILT, kept as the capability inventory the bench inherited. CUTOUTAPP-0605 (2026-06-05): cart/cutout\'s APP EXPERIENCE remade as the /cutout route in the one shell — the full-canvas, layer-stack, smart-select image/texture editor for painting SKINS/TEXTURES (the user\'s explicit ask; the earlier head-part-painting landing in /characters was ruled NOT it). Consumes editors/paint (usePaintEditor + PaintSurface — engine never forked); CAPTURE.md is the APP-surface deletion contract: a 48-row line-item audit against cutout.md + a component-by-component read of the reference\'s workflow affordances + an INTEGRATION section against the tool\'s material system, with an "audit failure" section recording exactly how the first audit passed the user\'s three misses (CUTOUTQOL2-0605; the engine\'s 34 are paint\'s own). ToolRail.tsx (CUTOUTQOL2) = the reference\'s left palette ported faithfully: ICON tiles with tooltips for every tool/mode/action + the DRAGGABLE brush-size slider (track + detents per PAINT.tuning.brushSizes + nudge + px readout) + color slots/palette. THE MATERIAL/SHADER LAB CONNECTION (CUTOUTQOL2): IN — paint ON a registry texture (library rail MATERIALS w/ live swatches + RECIPES sections → the PaintSurface underlay slot, the engine\'s recorded post-capture addition; 1-tile square canvas; smart select off — needs an image FILE); OUT — Materialize: →mat on a cutout row saves it as a stored material through the system\'s own door (saveCustomTexture + the cutout-stencil recipe added to the canonical catalog, cart/hmsc-int/render3d/textureShaders.ts) — joins allTextures immediately, assignable in /textures/faces/tiles/parts; the material-canvas identity (textureId) rides extractions, saves, and drafts (V20 additions). stream.ts = the V20 \'cutout\' concern: the LIBRARY of saved PaintDocuments (upsert by id, re-openable) + extracted CutoutAssets (source-res binary RLE mask + overlayRes preview cells + pixels + srcPath + source docId); saved/extracted/removed events, unknown kinds pass through; lives route-side until the compile consumes painted assets (graduates behind a game/ door then — the log file never moves). extraction.ts = pure bookkeeping: extractCutout refuses empty selections, mask→asset→mask pinned exact, cutoutToDocument reopens a stored cutout as a one-layer document whose smart base IS the mask (the composability law). sources.ts = magick identify + grayscale load (the engine takes dims/srcPath/gray as data). draft.ts = the working-draft autosave lifeline: 600ms-debounced full document to sessions/_cutout_draft.json, restored on mount (strict kind/version/shape gate; missing source image → layers kept, image dropped) — hot reloads and crashes lose nothing between deliberate stream Saves. CutoutRoute.tsx + Inspector.tsx + StatusBar.tsx = the app: header (name · GATED save/extract · status), library rail (PaintQuad cells swatches), the reference\'s right stack remade — TOOL tab (mask-state/refining pills, backend/clicks/layers metrics, Flood/SAM picker with onnx gating + tooltips, tunable knobs, SAM whole/part/subpart candidates, undo/redo), FX tab (LIVE animated surface-gallery cards, custom-WGSL EffectModal with apply-preview/stale signal, defaults-vs-layer targeting, hue/phase/opacity/blend/visibility), SOURCE tab (path/dims, Enter-to-apply canvas size + presets, image load), drag-resizable properties/layers split, full LAYERS panel (real-silhouette texture-mode previews, inline rename, Eye visibility, group/click tags, add/dup/move/merge/cut/delete bar) — plus the bottom status bar (pill + 1Hz FPS/ZOOM/CANVAS/SIZE/MASK/LAYERS/CLICKS/SAVED cells, the reference\'s re-render lesson kept). File-drop loads images anywhere; smart select arms only with an image source; painter hotkeys ON (the host suppresses key triggers while a TextInput is focused). Session history: /cutout on the cutout channel — strokes/layer-ops are the painter\'s labeled notes; saves/extractions/removals are COMMIT-grade (content event + marker + snapshot). cutout.test.ts 10 P4 cases GREEN (editors suite root; incl. the MATERIALIZE contract pinned against the LIVE catalog recipe + the material-canvas identity round-trip). Surfaced, not guessed: file exports (PNG/pixel-icon/.sqi) deliberately absent pending the user\'s export ruling — the stream asset carries everything a file exporter needs; extraction chose commit-grade (the asset must persist); the draft debounce loses at most 600ms at unmount (flushing would read back unmounted textures).',
      dependsOn: ['editors/paint (THE shared painter)', 'data/index.ts (the V20 store)', 'editors/sessions.ts (route-scoped session history)', 'game/chrome (GAME_CHROME)'],
      status: 'live',
    },
    {
      name: 'editors/compose (the decal editor route, DECALEDIT-0606)',
      purpose: ['ui', 'texture_bake', 'asset_pipeline', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/compose/ComposeRoute.tsx',
      description:
        'DECALEDIT-0606 (2026-06-06, USER ASK "whatever approach will let me make billboards and shit like that easily" + font-ready "so i can make like grafitti textures"): the locked vocabulary\'s DECAL source (a look authored in React — Box/Text/Image — baked to a texture; what facades/street signs always were, hand-coded) gets its authoring surface as /compose + the PenTool nav. Toolbar (name · billboard-led canvas presets · add rect/text/image · MATERIALIZE) + saved-decals rail (live DecalSurface swatches; click reopens LOSSLESS — the doc rides the stored material, the re-edit law) + the stage (doc at fit scale, drag rides the host cursor channel — the QuadSplit wire, no capture gaps; click selects, click-away deselects) + layers panel (paint-order reorder/duplicate/delete) + per-kind properties (rect fill/radius/border; text content/color/size/tracking/weight + FAMILY chips — the font surface, host-mapped fontFamilyIdFor names, a graffiti face later = a host family addition, zero schema change; image src; common x/y/w/h + opacity knob via GAME_CHROME) + a LIVE 3D billboard preview (mesh samples the compose:live StaticSurface; edits re-bake via subtree-mutation invalidation). Materialize = saveDecalTexture (upsert by editing id) + ONE labeled commit on the materials channel via the /compose session (the /textures AUTOSAVE-0605 pattern); the decal joins allTextures immediately — assignable everywhere a texture is (pickers/captures unchanged: registry hydrates decals as react-source TextureDefs). Working doc autosaves to the /compose twig debounced (a drag updates state per cursor event, never storms the twig file). P4: compose.test.ts 6 cases (validator round-trip under JSON-semantics canonical compare, font-surface survival, garbage→null never half-docs, boundary clamps, presets valid, materials stream decal records: additive beside shaders, upsert by id, unknown kinds pass).',
      dependsOn: ['game/textures (the texture pipeline door)', 'editors/materials/stream.ts (the V20 materials concern)', 'editors/sessions.ts (route-scoped session history)', 'editors/twigs.ts (route working-state)', 'game/chrome (GAME_CHROME)'],
      status: 'live',
    },
    {
      name: 'game/textures (the texture pipeline door, TEXPORT-0606)',
      purpose: ['texture_bake', 'shader', 'persistence', 'rendering'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/textures/index.ts',
      description:
        'TEXPORT-0606 (2026-06-06, USER ASK "properly port that into the correct space"): the texture pipeline MOVED from cart/hmsc-int/render3d behind the captured ground floor\'s own door — a faithful move, not a rewrite (export names, custom: ids, the custom-textures store key, and behavior unchanged; old saves resolve). shaders.ts (was textureShaders.ts) = the canonical tunable-WGSL recipe catalog; materials.ts (was customTextures.ts) = the stored materials Materialize freezes into the shared hmsc store; registry.tsx (was textures.tsx) = THE one texture registry (TextureDef/TEXTURE_REGISTRY/allTextures/textureById/TextureCapture) every face/tile/part samples by id. Follows the game/world pattern (own module, not a 20th ruled game/index.ts door); consumers use @game/textures subpaths (TextureStudio, ShaderLab, TexturePreview, ObjectsTab, editors/cutout) and the legacy renderer cart/hmsc-int/render3d/parts.tsx imports the registry FROM hmsc-int (the V15 compile direction). GAP edges marked at the import sites: roadTileFill/fillShader WGSL stays with the W-2 render fills; buildingSkins (REACT_TEXTURES) retires WITH the hand-coded buildings; design.PerceptionState + state/gameState store wires are V15. DECALEDIT-0606 added the DECAL source behind the same door: decal.ts (the DecalDoc model — boundary validator that degrades corrupt records to null, billboard-led size presets, text nodes carrying fontFamily/fontWeight/letterSpacing so future graffiti faces are a host family addition with zero schema work) + decalRender.tsx (DecalSurface — the doc scaled to any capture size; x/y stretch independently, glyphs scale by the min axis); materials.ts stores decal records beside shader records (same custom: ids + store key; saveDecalTexture upserts by id for the re-edit law) and registry.tsx hydrates them as react-source TextureDefs, so TextureCapture/pickers need no decal knowledge. The V24 piece-face and voxel-item texture slots land on this registry. See game/textures/CAPTURE.md. DECALRECIPE-0610 (2026-06-10, USER ASK req_0566 "inside of the compiled game output i am not getting these to show up" → req_0574/req_0577 "lets follow the guiding light"): decals reach the COMPILED game as their RECIPE — the DecalDoc itself, packed flat by compile/decalPack.ts (CSS hex → RGBA bytes at pack time, hidden nodes dropped, shader-fill rects substitute flat color with a warn; the WGSL fill is the marked bake-lever tail — image payloads ship via the content-addressed asset store, DECALIMG-0610) and shipped in the MATERIALS lump\'s optional DOCS tail (encodeMaterials; older payloads parse unchanged). The no-V8 loader (constructor.zig decodeMaterialDocTail → framework/gpu/decal_raster.zig) CPU-rasterizes the doc once at load — rounded-rect SDF fills/borders + FreeType text (lazy TextEngine.initHeadless, weight≥600 bold, align/letterSpacing, uniform scale ≤1024px) — and material_tex.materializePixels installs it under the same wmat-<i> key shader materials use (textured batch + whitened rows + streaming shared). Pure data→data: no editor dependency, headless-green always; the exact materialize-at-load shape shaders use. HISTORY (same day, superseded): editor-baked pixels (PIXS tail + DecalPixelBaker) hit the localstore 8KB value cap (storage/localstore.zig MAX_VALUE; hostLocalstoreSet swallows failures — never store blobs in store values) and were ruled product-not-recipe against GUIDING_LIGHT; that layer is deleted (__capture_surface_pixels remains as a general door). GOTCHA: world_loader\'s log is std.debug (stderr) but framework diag/log .info is BUS-ONLY — invisible in the standalone loader; decal_raster diagnostics use log.warn. P4: decalPack.test.ts 5 layout-pinning cases + worldGeometry.test.ts DOCS-tail framing + no-docs byte-compat; proof: rjit game shot GREEN, 2 decal recipes baked, both real docs parsed end-to-end (per-decal image-skip warns). DECALIMG-0610 (2026-06-10, USER ASK req_0592 "ok and so images? whats the point of me being able to add an image if i cant ship it in the game"): decal IMAGE nodes render in the compiled game — bytes ride the gamefile\'s content-addressed asset vocabulary (V29), the doc stays the recipe. Bake: compile/decalAssets.ts createDecalAssetSink — packDecalDoc interns each visible image node\'s FILE (readFileBase64 cwd-relative, the SAME path the editor\'s Image primitive loads; sha256 = address, identical content dedupes to ONE asset; keys from 3001, manifest kind 11, 8MB cap) and the image record packs the KEY: u32 assetKey | f32 borderRadius | u16 srcByteLen | src (src diagnostics-only; key 0 = nothing shipped — empty src/unreadable/oversized, warned per decal+node, never a failed bake). Sink threads buildWorldInstances → createHmscMapfile → bakeGameFile.ts: manifest entry + tape-envelope payload (embed:false, the player-model precedent; installGameFileEnvelope installs to the content store) + keys declared in map.refs (installAndValidate resolves all before construct). Loader: constructor.zig reads every kind-11 manifest asset into Scene.decal_assets (read failure skips, never fails construct); world_loader maps to decal_raster.ImageAsset; rasterize(alloc, doc, images) NODE_IMAGE stbi-decodes (4096px decoded-side cap) and bilinear-blits into the node rect with the SAME rounded-rect SDF coverage rect fills use (borderRadius + opacity honored) — top-down like every node (UVFLIP-0610). Total degradation: key 0/missing/undecodable/oversized → one warn + skipped node, the rest of the doc still rasterizes. P4: decalAssets.test.ts 2 (intern/dedupe/src-cache + missing/empty/invalid/oversized→0), decalPack.test.ts now 6 (image layout pinned, sink-less key 0, sink intern/context/empty-src bypass), worldGeometry.test.ts now 7 (image-node doc ships one asset + packed doc references its key; adds resetCustomTextureCache test seam). Proof: a synthetic gamefile (real PNG as embedded kind-11 blob, production writers) rendered the image ON the box face in the headless loader (rounded corners visible, zero skip warns); rjit game shot stays GREEN on the real world (the user\'s two saved decals carry EMPTY-src image nodes → the new actionable warn: re-pick in /compose). UVFLIP-0610 (2026-06-10, USER ASK req_0600 "all the actual shader based materials are all upside down lol. wondered why the door looked weird"): the compiled loader\'s hand-rolled cube (world_loader.zig buildCube) carried v=0 at world BOTTOM while the editor\'s geometry registry box flips V so a top-down texture stays upright (runtime/geometries/_util.ts face(); buildCube\'s corner orders were ALREADY identical to Box.ts — only the uv row differed). Consequence: every materialized shader recipe sampled upside-down in the compiled game (the door facade), and the decal pipeline had calibrated against the wrong cube — DECALFLIP-0610\'s 180° pixel-order reversal fixed decal v but silently MIRRORED u (the DECALIMG image proof showed the source\'s right-side road on the left; noise-like calibration materials + a near-symmetric test image hid both errors). Root fix: buildCube wears the registry\'s exact uv row ((0,1),(1,1),(1,0),(0,0) for BL,BR,TR,TL) and the rasterizer\'s 180° compensation is DELETED — one convention, fixed at the sampling geometry, never per producer. Proof: 3-box calibration gamefile — brick-entrance facade upright (door at the BOTTOM), decal text "ABC" left-to-right with its red marker TOP-LEFT, decal image upright AND unmirrored (road on the right); both ±Z faces readable from their own outside; rjit game shot GREEN on the real world.',
      dependsOn: ['cart/hmsc-int/render3d (GAP: WGSL fills + buildingSkins + store wires)', 'data/index.ts (the V20 store)'],
      status: 'live',
    },
    {
      name: 'game/painted + model texture painting (MODELPAINT-0605)',
      purpose: ['texture_bake', 'character', 'vehicle', 'ui', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/painted.ts',
      description:
        'MODELPAINT-0605 (2026-06-05), the user\'s rulings verbatim: model textures "migrate entirely to the cutout painter" + save + live 3D preview; and "i dont want to paint depth, i want to paint their face though, or body parts" — PIXELS ONLY (the coupled color+depth face stroke died; sculpt stays /characters\'). game/painted.ts = the PaintedOverlay model documents carry: per-layer cell-grid color bake (renderable anywhere) + the painter\'s re-editable PaintDocument held OPAQUE (STRUCTURE arrows: game/ stores, editors/cutout interprets); validation never throws; texture keys content-addressed by the save stamp. paintedRender.tsx (direct-import React half, the figure/render idiom) = the premultiplied cell-fill Effect + PaintedOverlaySurface + the ONE shared VehiclePaintCaptures. BodyDocument.paint / VehicleDoc.paint = additive per-part slots with pure applyBodyPaint/applyVehiclePaint (paint→unpaint byte-parity; torn overlays degrade; pre-paint docs byte-unaffected — all pinned); buildVehicle threads textureKey onto a painted part\'s SURFACE meshes, decals (scars/cracks/livery stripes — the asDecal guard) never take the paint. /cutout: the MODELS rail (rosters + part pickers, ● = painted), the model canvas over the model\'s own underlay (512×256 figure unwrap so face strokes land where the head texture samples / square box-mapped vehicle canvas), save = bake + door-apply + ONE commit-grade upsert on the owning channel via the route\'s own \'/cutout\' sessions, reopen lossless (the re-edit law), the LIVE 3D preview (ModelPreview.tsx: the figure part / whole vehicle with the painting applied as you stroke — one StaticSurface sampling the painter\'s live GPU masks on a throttled bake clock, P2 knobs \'cutout-modelpaint\'/\'cutout-modelpreview\', V23 native orbit), and the deep-link mailbox /characters + /vehicles preload targets through. /characters: face-paint tool DELETED; CharacterDraft.paint rides opaque (a real wipe hazard — draftToDocument rebuilt the doc and would have destroyed paintings on every save — found and pinned closed); captures composite overlays at the photo slot (over skin, UNDER shape layers, the ruled z-order). /vehicles: viewport renders painted panels; texture row deep-links. P4: painted.test 7 + documents.test paint case + vehicle.test paint case + cutout models.test 4 + characters.test wipe case; verify GREEN. Surfaced (cutout CAPTURE): model targets skip the draft autosave (binding-less draft format), cell-grid bake fidelity is the pick, the COMPILED game\'s overlay composite is the bake lane\'s follow-up.',
      dependsOn: ['editors/cutout (the cutout painter route)', 'editors/paint (THE shared painter)', 'game/index.ts', 'data/index.ts (the V20 store)'],
      status: 'live',
    },
    {
      name: 'editors/build (Creative Build mode, /build)',
      purpose: ['world_gen', 'ui', 'physics', 'persistence', 'interaction'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/play/PlayRoute.tsx',
      description:
        'BUILDMODE-0605 (2026-06-05): build the map WHILE PLAYING — V24 Fortnite-Creative semantics on the embodied drop-in. SUBSTRATE-0605: the player (V23 node-bound native camera, GAME_PHYSICS host step, GAME_WORLD colliders + heightfields, GAME_INPUT key transport, V2 figure) is NOT route code — BuildRoute consumes the ONE shared substrate (cart/hmsc-int/Embodied.tsx, useEmbodiedPlayer + EmbodiedScene/Captures/MouseSurface) and feeds it EmbodiedWorldExtras (placed-piece solids + ramp/stairs heightfield slopes after the terrain bake), onFrame (snap re-resolve) and onTap (place). This also FIXED the launch camera (CAMGONE-0605: the original copy bound via module-level bindFirst with no nativeCamera node — never engaged). MOUSE CAPTURE (addendum 4): the substrate consumes the mouse — raw-motion look, captured click = ALWAYS place, Esc frees the mouse for the palette UI; the drag/click pixel-slop heuristic is dead. The builder layer: crosshair (the solved camera\'s screen-center axis via the substrate-exported PLAYER_CAMERA — the crosshair law) → snap target → registry-driven palette (GAME_BUILD kinds/catalog/prefabs; RULED hotkey order leads the display: 1 floor · 2 wall · 3 ramp · 4 roof (USER VERDICT, addendum 2), then registry order, 0 prefabs, [ ] variant) → ghost preview (piece or whole prefab decomposition at P2 ghost opacity) → click places → R rotates → E cycles the WallEdit vocabulary on the targeted piece → X removes → P marks → named prefab (prefabFromPieces) → palette stamps (decompose per the see-through law). EVERY interaction = ONE labeled session commit on the WORLD channel (editors/sessions); the world stream\'s materialized state is the ONE placed-piece truth (re-read after each commit, no second copy); live P2 knobs (reach/ghost/march) in the in-route tuning panel. snap.ts = pure crosshair→snap resolution (nearest of piece-face vs ground in reach; grid cell-centers, edge pins to the nearer grid line and runs along it, surface mounts proud of the face, free raw; top faces stack storeys, side faces place beside). ONE MODEL, TWO VIEWS: placements are plain worldStream events — \'/build\' exists only as the session\'s route label. P4: snap.test.ts 11 + commits.test.ts 3 (one-commit-per-placement, stamp-is-one-commit, undo-point steps back) + viewport.test.ts 5 (the consumption-layer camera/capture/hotkey proof: both routes pinned to the substrate, the CAMGONE bindFirst shape banned, capture-mode look pinned, ruled hotkeys pinned), editors suite root, verify GREEN. Surfaced (CAPTURE.md): global-not-per-map pieces (V20 scoping question), window/brokenWindow keep collision until a mantle system, no-lintel portals, stepped-box ramp visuals over true slope collision, overlap allowed, edge snap owns its orientation. PLAYFOLD-0605 (2026-06-05, USER ASK "its the same game … fold it so that i can just toggle between them with the F keys like f1 f2"; same day the /build URL retired as a dupe of the folded surface): BuildRoute.tsx + TestRoute.tsx folded into editors/play/PlayRoute.tsx — ONE route (/test, the chrome Play button), mode is PlayRoute\'s own state, F1/F2 flip it in place with NO remount: pose, camera, mouse capture, the backtick console, and the placed pieces carry across the toggle. \'/build\' survives only as the session channel label + twig storage keys (names, not URLs). The build layer above is UNCHANGED inside the fold, rendered/gated by mode; build hotkeys additionally gate while the console is open (the console now opens in both modes); placed pieces render AND collide in BOTH modes (testing what you built is the toggle\'s point). snap.ts + the P4 suites stay in editors/build/.',
      dependsOn: ['Embodied.tsx (the shared embodied substrate)', 'game/index.ts', 'data/index.ts (the V20 store)', 'editors/sessions.ts (route-scoped session history)', 'game/camera.ts (GAME_CAMERA — the camera door)'],
      status: 'live',
    },
    {
      name: 'game/world/buildings.ts (buildings own their history)',
      purpose: ['world_gen', 'building', 'persistence', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/world/buildings.ts',
      description:
        'req_0512→req_0513 slice 1 (2026-06-10), the USER\'S PROPOSAL made law: "give buildings their own branch of history rather than storing as a global state. and then the building itself can just say \'i am here at this position\'". A NEW V20 stream `buildings` (new feature = new stream; its own domain DB beside `world`): `defs` = BuildingDefs (the same BuildPrefabDef family) GLOBAL/shared across maps per the multi-map ruling; `instancesByMap` = per-map {id, defId, x, y, z, yawDegrees} references — V29\'s defs+placement-references shape applied at AUTHORING time, V28\'s buildings[]. Events: buildingDefined / buildingPlaced (materializer mints bld_<n> per map, replay-deterministic) / buildingMoved {id,x,z,yawDegrees?} — a whole-building move is ONE event, never the 358-event remove+place storm — / buildingRemoved (the def survives; a building\'s branch is its event subsequence over the one total log). COMPATIBILITY CONTRACT: world pieces are DERIVED — withBuildingPieces = loose pieces ⊕ stampPrefabPieces per instance with DETERMINISTIC ids (bld:<instId>:<localIdx>; stampId bld:<instId> = one flat-pad lift group), so EVERY consumer (IsoAuthor, F2/PlayRoute, footprints, colliders, compile bakeGameFile) keeps reading the ONE pieces view — the bake sees through instances (V24), no second render path. Per-instance derivation caches keep piece object identity across unrelated folds (renderer caches survive); a buildings-free map returns the base array identity (zero hot-path tax). Doors: buildingDefFromPieces (capture validates BEFORE commit — never half-commits), partitionBuildingSelection (whole/partial/loose; partial-building ops refused loudly until slice 2), reconcileBuildingInstances (Ctrl+Z appends REVERSE events on the branch — V20: shared history is never rewound; pose reconstructed exactly, rotation included), buildingMutationMapName (the pieceMutationMapName twin). IsoAuthor: ⌂+ promotes a selection (buildingDefined+buildingPlaced+remove originals, ONE batch, visually seamless), the tower tool births a building, whole-instance move/clone/delete emit single building events; the shell routes BuildEditEvent by kind to the right channel (isBuildingsEvent). Deferred: slice 2 piece-scoped building edits (FacePainter paint on a promoted building currently no-ops), slice 3 per-building timeline UI, slice 4 compile consuming instances natively (V29 references). 15 P4 meaning-tests green (buildings.test.ts).',
      dependsOn: ['game/world/stream.ts (the world stream)', 'game/build (the V24 grammar)', 'data/index.ts (the V20 store)', 'editors/sessions.ts (route-scoped session history)'],
      status: 'live',
    },
    {
      name: 'editors/tunables.ts (THE P2 tunables registry)',
      purpose: ['maintenance', 'persistence', 'ui'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/tunables.ts',
      description:
        'SETTINGS-0605 (2026-06-05): THE P2 interface the constitution promises ("a constant buried in code that affects game behavior is a bug"). A pure in-memory registry: a tuning module registers its numeric leaves WHERE THE NUMBERS LIVE (dotted path + KnobSpec-shaped min/max/step/precision into its own live table, at module scope); the registry clamps at the boundary (P3) and writes THROUGH the table — an edit lands in the exact value the route\'s code reads next frame, no second copy. Persistence = the V20 \'tuning\' stream (set/reset events → override map materialized); index.tsx folds the snapshot back over code defaults at shell mount (applyOverrides, pending until late registrations so stream order never races module order). createTunables() testable door / editorTunables() live singleton (the sessions.ts split; no host bindings — module-scope registration is test-safe). P4: editors/tunables.test.ts (7 cases: write-through round trip, boundary clamps, spec/table drift dies loud at import, any-order override fold, revision poll signal, stream materialization, on-disk restart fold).',
      dependsOn: ['data/index.ts (the V20 store)'],
      status: 'live',
    },
    {
      name: 'editors/settings (the grand settings route)',
      purpose: ['ui', 'maintenance', 'persistence', 'telemetry'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editors/settings/SettingsRoute.tsx',
      description:
        'SETTINGS-0605 (2026-06-05), the user\'s ruling verbatim: "a grand settings page that shows an event bus for all of these [the routes\' session/autosave systems], and we need to get all those magic numbers into some route for interfacing with." The /settings route (Settings nav icon), two surfaces, both READ layers over existing machinery. SESSION EVENT BUS: bus.ts is a pure fold over the \'sessions\' stream\'s materialized state — every route\'s commits/notes with route/channel/label on the one global seq (newest first), per-channel filter chips with commit counts + open-session dots — polled through the existing doors (editorSessions().state()/undoPoint(), re-render only on movement); read-only, no second event system, no new persistence. TUNABLES: the registry grouped by system, GAME_CHROME knobs editing live, per-knob reset-to-default; every edit is one LABELED commit on this route\'s own /settings session over the \'tuning\' channel — knob turns show up in the bus beside everyone else\'s interactions and persist across boots. The page registers its own chrome numbers (settings-view) — dog food. P4: bus.test.ts (5 cases against REAL session machinery on a scratch store: cross-channel seq ordering, row grades, filtering, per-channel rollups, replay identity). Surfaced: wall-clock timestamps need sessions.ts to fold the stored at stamp (the bus shows seq order — what V20 defines); a knob edit does not re-render OTHER mounted routes (they read the live value on their next render). CAPTURE.md = the P2 BUG BURNDOWN of un-migrated magic-number clusters + pane hand-off rows.',
      dependsOn: ['editors/tunables.ts (THE P2 tunables registry)', 'editors/sessions.ts (route-scoped session history)', 'data/index.ts (the V20 store)', 'game/chrome (GAME_CHROME)'],
      status: 'live',
    },
    {
      name: 'game/camera.ts (GAME_CAMERA — the camera door)',
      purpose: ['camera', 'interaction', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/camera.ts',
      description:
        'V3 capture (2026-06-05): the game-facing door over @reactjit/cameras — the ruled split keeps the registry in runtime/ and GRADUATES the two combat pieces INTO it. runtime/cameras/rigs/aim.ts = combat_lab\'s ADS over-the-shoulder rig REWRITTEN fresh as a first-class CameraDef (shoulder-shifted crouch-aware pivot, genuinely pitched axis — the aim-ceiling fix; degrees, + = up per registry convention; reference radian clamps carried bit-exact through DEG; aimPivot exported for the game-side camera-collision clamp, which needs physics and stays out). runtime/cameras/unproject.ts now owns the canonical screenRay (R7) with unprojectGround as a consumer; the two active-cart hand-rolls (assist3d/picking.ts, retired voxel route) re-pointed before WBITEMS-FLIP-0606. Door = solve/screenRay/unprojectGround/aimPivot/rigs(8)/modifiers, all pure (headless verify solves cameras with no React). V23 keeps this pure door as the reference vocabulary while moving per-frame integration into the opt-in native controller. The crosshair law carried as contract: fire ray = the solved camera\'s screen-center axis, never raw yaw/pitch trig. Fidelity: 1,728-case Aim sweep + 150-case screenRay sweep identical to verbatim reference transcriptions; 13 P4 tests. Ambiguities (yaw-convention fork vs lookForward, pivot-Y generalization, clamp-in-solve) in camera.CAPTURE.md. References untouched.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts', 'runtime/cameras/'],
      status: 'live',
    },
    {
      name: 'game/nativeCamera.ts (V23 native host camera opt-in)',
      purpose: ['camera', 'runtime', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/nativeCamera.ts',
      description:
        'V23 host-controller surface (2026-06-05): importing this file is the V18 metafile gate for -Dhas-game-camera. JS sends mode, rig params, and input deltas on change only through GAME_NATIVE_CAMERA; framework/game/camera.zig owns per-frame Orbit/Aim solve, smoothing, and interpolation, then v8_app writes the same Scene3D.Camera layout fields consumed by gpu/3d.zig. Extension (2026-06-05): Scene3D.Camera accepts scene3dCameraNative/nativeCamera; v8_app binds/unbinds controllers declaratively on prop set/unset and node destroy. Controller state is per node id (multi-camera safe), and GAME_NATIVE_CAMERA.forNode(nodeId) exposes node-scoped setMode/setOrbit/setAim/setInputDeltas/setSmoothing/disable while the old active-node functions remain for /test compatibility. Native fidelity is pinned in zig build test-game-camera: exact TS vectors plus a tools/v8cli-generated aggregate sweep (336 Orbit + 378 Aim cases), smoothing continuity, walk<->aim transition, independent two-node rigs, unbind cleanup, and rebind safety. V26 CAMNUKE-0605 closes the app-wide viewport rule: every live hmsc-int 3D viewport must use this native per-node drive; JavaScript may keep registry solves for semantic boot/picking/cutscene math, but may not drive per-frame Scene3D.Camera props.',
      dependsOn: ['framework/game/camera.zig', 'framework/v8_bindings_game_camera.zig', 'v8_app.zig', 'runtime/cameras/'],
      status: 'live',
    },
    {
      name: 'game/kinds (GAME_KINDS registries)',
      purpose: ['world_gen', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/kinds/index.ts',
      description:
        'WO-2 capture (2026-06-04): the kind registries REWRITTEN fresh (V17-TRIAGE) — tiles (18 kinds, LOCKED road grammar with lane flow as table data), props (16), NPCs (4 + faction regard matrix), roles (open axis), landforms (4, fixed-shape constants lifted into LANDFORM_TUNING per P2). One door (index.ts → GAME_KINDS via game/index.ts); P4 behavior tests per family under tools/v8cli (shared game/_testkit.ts); CAPTURE.md records dropped dead fields (door sub-fields, two duplicates) and surfaced ambiguities. Old cart/hmsc registries untouched (V15-TRANSITION behavior references).',
      dependsOn: ['game/_testkit.ts', 'game/index.ts'],
      status: 'live',
    },
    {
      name: 'game/commands/vocabulary.ts (the captured console vocabulary)',
      purpose: ['scripting', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/commands/vocabulary.ts',
      description:
        'Capture wave (2026-06-05): hmsc’s 49-command console vocabulary (cmd_/lab_/gv_/pv_/ev_/wv_ plus V27 log) REWRITTEN fresh onto the skeleton’s mutable-ctx conventions (cart/hmsc-int/commands/registry.ts untouched behavior reference). All 49 names register so the V19 script language is complete: captured commands run for REAL against GameCommandState + the P2 tables (COMMAND_TUNING, SKY_NAMED_HOURS, SKY_WEATHER_PRESETS) + GAME_KINDS, GAME_PERCEPTION, mounted V20 data persistence, and V27 GAME_TELEMETRY diagnostics control (log status, log all on|off|toggle, log <channel> on|off|toggle, log dump, log overhead, gv_perflog as the spikes alias). wv_prop partial (kinds listing real); 14 explicit NOT-YET stubs FAIL LOUDLY ("system not captured yet: <owner>") — NOT_YET_CAPTURED exports the per-owner hand-off lists (roads, traffic, buildings/interiors, zones, validation, lab scenes, input contract). Dot-path state shape preserved so saved scripts keep meaning. Exposed via GAME_COMMANDS.{createGameState,defineGameCommands,tuning,names,notYetCaptured}. SELFSHOT-0606 (2026-06-06, USER RULING "dont look at the system"): the `shot [path]` verb joins the registry beside the captured names — captures the app\'s OWN rendered frame to a PNG through @reactjit/capture → __capture_frame → framework/gpu/capture.zig swapchain readback (desktop/X11 capture of the user\'s system is BANNED; CLI sibling `rjit shot <cart> [--route /r]`); headless boots report "unavailable", never fake success. 21 P4 tests (vocabulary.test.ts) + compile/verify/commands.cmds; rjit game verify GREEN. CAPTURE.md records the boundary + ambiguities.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts', 'game/kinds (GAME_KINDS registries)'],
      status: 'live',
    },
    {
      name: 'game/items (GAME_ITEMS — the items registry + models)',
      purpose: ['asset_pipeline', 'ai_edit', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/items/index.ts',
      description:
        'V11 capture (2026-06-05): game_item_gallery’s ITEMS REWRITTEN fresh as DATA (cart/game_item_gallery untouched behavior reference; gallery UI + the V11 scale-audit workbench fenced to editors/items/). The 19 model fns reduced to part TABLES at identity ctx — items.ts carries 73 ItemPart rows (geometry-by-name via ITEM_GEOMETRIES, params, #rrggbb material, ITEM_TEXTURE_KEYS slot, position/rotation/scale verbatim; zero React in the door); geometries.ts holds the 4 custom generators (blade/sail/boatHull/surfboard) as pure generate(params) fns + ITEM_GEOMETRY_DEFAULTS (P2). ALL 19 items scaleStatus "unaudited" — authored numbers verbatim, including the ruling’s evidence (sailboat 1.35m ≈ knife 1.31m, pinned by test, NOT fixed); approxItemBoundsMeters = the audit’s numeric starting data. Texture keys renamed game-items/<id>[/<face>]; texture CONTENT stays gallery-side pending the materials capture. 8 P4 tests (items.test.ts); door test updated GAME_ITEMS pending→live; rjit game verify GREEN. No commands-stub flips (no item-targeting command exists in the 48). CAPTURE.md: 4 ambiguities (physics_lab catalog un-reviewed, vehicle item vs V10, scape item-type layer, surfboard-as-leaf).',
      dependsOn: ['game/_testkit.ts', 'game/index.ts'],
      status: 'live',
    },
    {
      name: 'game/chrome (GAME_CHROME — lab chrome kit + environment)',
      purpose: ['ui', 'rendering', 'color', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/chrome/index.ts',
      description:
        'CHROME capture (2026-06-05): the lab chrome kit and lab environment REWRITTEN fresh from the addendum pointers (carve_lab + physics_lab for Chip/Knob/Meter/panel; skybox_demo + hmsc/render3d/sky.ts + planet_run for skybox/light rigs). Data first: CHROME_TOKENS, CHROME_LAYOUT, CHROME_KNOB_PRESETS, LAB_SKY_TUNING, LAB_ENVIRONMENT_PRESETS. Components: Chip, Knob, Meter, MeterRow, Panel, LabEnvironment. Pure P4 surfaces: resolveKnobValue/formatKnobValue, resolveMeter, resolvePanelLayout, buildLabSky, resolveLabEnvironment. Presets: studio, arena, day-cycle, hmsc-clear/hazy/cloudy/storm, night. CAPTURE.md records the dropped per-cart gameplay/ingest loops and the HMSC host-skybox-vs-flat-background ambiguity. 6 P4 tests; GAME_CHROME pending→live.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts'],
      status: 'live',
    },
    {
      name: 'shell/chrome (Chrome)',
      purpose: ['ui', 'persistence'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/shell/chrome.tsx',
      description:
        'The persistent titlebar strip (WBCHROME-0606, WORKBENCH.md step 2 — replaced ProjectBar.tsx at full parity, line-referenced table in commit 34400c6e7): map switcher (MapsMenu), new/rename/delete, undo/redo, THE RULED SIX route icons (STEP10-COLLAPSE-0607, WORKBENCH.md §3: editor LayoutGrid · play Play · labs FlaskConical · assets Shapes · settings Settings · assist3d Sparkles — assets and settings are two doors into /workbench through shell/workbenchDoor.ts: one-shot requestWorkbenchSource ask + live source-family report lighting the right door), Compile button, save pill, event-log popover; plus the W1 additions — the borderless host’s window controls (__window_minimize/maximize/close) and the dead-middle windowDrag titlebar grab. Renders through the Chrome*/Win* classes (shell/workbench.cls.ts), zero raw colours. Menus export separately and render as the root’s last children (overlays-last hit-test rule).',
      status: 'live',
    },
    {
      name: 'QuadSplit',
      purpose: ['ui', 'input'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/QuadSplit.tsx',
      description:
        'Controlled 2×2 splitter (133); divider drag driven by the host global cursor channel (system:cursor:move from SDL_GetGlobalMouseState) so tracking never loses capture; mouse down/up only bracket the gesture.',
      consumes: ['system:cursor:move'],
      status: 'live',
    },
    {
      name: 'theme.ts / studio.cls.ts',
      purpose: ['ui', 'color'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/studio.cls.ts',
      description:
        'Classifier-driven styling (206): every colour is a theme: token; importing studio.cls seeds the studio theme (setTokens); per-instance states are sibling classes (…On/…Active). The two inspector surfaces render exclusively through these classes.',
      status: 'live',
    },
    {
      name: 'chunks.ts',
      purpose: ['world_gen'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/chunks.ts',
      description:
        'Sparse grid of 120×120-tile chunks (CHUNK_TILES matches the game). World extent derives from the address window (152×8 chunks). Chunks grow into in-bounds unoccupied neighbours; each owns tile/height/zone buffers; zone defs are world-wide.',
      status: 'live',
    },
    {
      name: 'address.ts',
      purpose: ['world_gen', 'format'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/address.ts',
      description:
        'Spreadsheet addressing (A0…DP119), bijective base-26 columns over integer cell coords; display/parse skin only.',
      status: 'live',
    },
    {
      name: 'tileData.ts',
      purpose: ['world_gen', 'rendering'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/tileData.ts',
      description:
        'Int16Array tile-kind index per 1m cell (−1 = empty); TILE_PALETTE derived from the game’s tileKinds registry; rendered as one Effect storage buffer.',
      dependsOn: ['tileKinds'],
      status: 'live',
    },
    {
      name: 'heightData.ts',
      purpose: ['world_gen', 'rendering'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/heightData.ts',
      description:
        'Float32Array heightfield (170), 2 samples/tile, HEIGHT_LIMIT = 64m as the single height-range knob (brush stepper, stamp clamp, colormap span all derive). Brush mutates in place O(brush); render is one buffer upload.',
      status: 'live',
    },
    {
      name: 'zoneData.ts',
      purpose: ['world_gen', 'perception'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/zoneData.ts',
      description:
        'Int16Array per-cell zone membership + world-wide ZoneDef {name,color,flags} using the game’s ZONE_FLAGS taxonomy (the same flags the player-drive loop fires onEnter/onExit from).',
      dependsOn: ['ZONE_FLAGS'],
      status: 'live',
    },
    {
      name: 'brush.ts',
      purpose: ['world_gen', 'math'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/brush.ts',
      description: 'Shared footprint math (circle/square/diamond) for all painted layers.',
      status: 'live',
    },
    {
      name: 'tileOverrides.ts',
      purpose: ['world_gen', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/tileOverrides.ts',
      description:
        'Per-cell property overrides (88) layered on a cell’s kind without changing the kind: cellKey → {dotted-path → value}; effective = override ?? kindDefault. The bulk-edit target of the tile selection. Serializes with the map but game-side runtime consumption is not wired.',
      status: 'dormant',
    },
    {
      name: 'placements.ts',
      purpose: ['world_gen', 'building'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/placements.ts',
      description:
        'The place layer model (87): {id, cat:building|prop|marker, kind, gx, gy, rotation, locked} with footprint/colour/label re-resolved from the kind registries (never stored).',
      status: 'live',
    },
    {
      name: 'mapStore.ts',
      purpose: ['persistence', 'world_gen', 'format'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/mapStore.ts',
      description:
        'Map codec (189): live world ↔ JSON MapSnapshot. THE RULE: globals are shared, maps are thin references — tiles persist via a tileLegend of kind names remapped on load; placements as {id,cat,kind,pose}; buffers RLE-encoded via the shared @reactjit/workspace grid codec.',
      dependsOn: ['@reactjit/workspace'],
      status: 'live',
    },
    {
      name: 'projects.ts',
      purpose: ['persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/projects.ts',
      description:
        'Directory-level CRUD over sessions/*.session.json (list/exists/delete/name hygiene), 56 lines.',
      consumes: ['__fs_read', '__fs_write'],
      status: 'live',
    },
    {
      name: 'editorWorld.ts',
      purpose: ['world_gen', 'building', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editorWorld.ts',
      description:
        'The authoring spine (272): every mutation goes through the game’s own mutators (resolveBuildingPlacement/addBuildingToWorld, placeProp, addZone, addSurfaceRegion, placeCell, setBuildingFaceSkin, nextUniqueId). Also emptyEditorWorld(), ghost-validity (buildingFootprintBlocked), terrain-aware Y (landformGroundTopAt), marker spawnKey links.',
      status: 'live',
    },
    {
      name: 'kindTextures.ts',
      purpose: ['texture_bake', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/kindTextures.ts',
      description:
        'GLOBAL per-kind part textures in the shared hmsc store (key cat:kind → partId→textureId), broadcast via an IFTTT bus event; folded into instances at preview+compile with instance overrides winning. 64 lines.',
      emits: ['kind-texture bus event'],
      status: 'live',
    },
    {
      name: 'worldFile.ts / assets.ts / assetPrompt.ts',
      purpose: ['ai_edit', 'asset_pipeline', 'world_gen'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/worldFile.ts',
      description:
        'The other (future) authoring lane: the world as a hand-editable .tsx file importing asset components, placements serialized as JSX tags at spreadsheet addresses; ASSET_AUTHORING_PROMPT codifies the AI-generated-asset contract. Not wired to the main editor flow yet — a parallel model awaiting the bake pipeline.',
      status: 'dormant',
    },
    {
      name: 'PaintCanvas.tsx',
      purpose: ['world_gen', 'rendering', 'input'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/PaintCanvas.tsx',
      description:
        'The bottom-left authoring quad — ONE Painter since PAINTER-0610 (req_0593): one active tool (Select/Paint/Erase), one active target (the Layer union: paint/height/place/zone/road, relabeled TILE/TERRAIN/OBJECT/ZONE/ROAD in the TargetDock), many visible channels. ONE input overlay (cutout Pressable) driven by painterBehavior.ts resolvePainterBehavior (stroke|click|select|none — none on Object+Select keeps native Canvas.Node drag); per-target stamping dispatches through a capability table (no per-layer if-chains); Erase works on every target (terrain lowers, objects under the brush delete, the road stroke under a click deletes); Select is universal and most-specific (placement → build piece → road → cell). Each focused chunk is one <ChunkSurface> on the COMBINED painter shader; channel eyes (TargetDock, persisted MapPayload.channels) dim/hide inactive channels. "+" ghosts grow the map; alt-drag/WASD pan.',
      consumes: ['__canvas_screen_to_graph', '__tel_input', '__keydown', '__keyup', 'system:blur'],
      dependsOn: ['ChunkSurface', 'usePaintedField', 'painterBehavior.ts', 'painterSurface.ts', 'PainterRail', 'TargetDock'],
      status: 'live',
    },
    {
      name: 'ChunkSurface',
      purpose: ['rendering', 'world_gen'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/ChunkSurface.tsx',
      description:
        'One chunk = one Effect quad; owns its coalesced GPU buffer (usePaintedField), renders the COMBINED painter view (painterView.wgsl.ts: tile ground + road ribbon + height tint + zone tint in one pass, weighted by the per-channel emphasis header — PAINTER-0610; the old per-layer shader switch is gone), registers a flush so a stroke re-uploads only its chunk. encodePainterSurface (painterSurface.ts) ALWAYS emits every section with explicit headers (GHOSTROAD-0610). The emphasis prop must stay identity-stable (memo).',
      dependsOn: ['usePaintedField', 'painterSurface.ts', 'painterView.wgsl.ts'],
      status: 'live',
    },
    {
      name: 'usePaintedField',
      purpose: ['rendering', 'world_gen'],
      kind: 'hook',
      sourceFile: 'cart/hmsc-int/usePaintedField.ts',
      description:
        'The de-thrash core (54): brush touch()es at input rate (~100/s); encode+upload coalesce to once per frame (rAF/setTimeout-16). Decouples input rate from GPU upload rate.',
      status: 'live',
    },
    {
      name: 'tileField.wgsl.ts (HEIGHTFIELD_TILE_SHADER re-export)',
      purpose: ['shader', 'rendering', 'world_gen'],
      kind: 'shader',
      sourceFile: 'cart/hmsc-int/tileField.wgsl.ts',
      description:
        'A re-export of the game’s HEIGHTFIELD_TILE_SHADER (render3d/heightfieldSurface): the editor paints with the very shader the game drapes terrain with. One source; what you paint is what boots.',
      status: 'live',
    },
    {
      name: 'heightField.wgsl.ts / heightTileView.wgsl.ts / zoneView.wgsl.ts',
      purpose: ['shader', 'rendering', 'world_gen'],
      kind: 'shader',
      sourceFile: 'cart/hmsc-int/heightField.wgsl.ts',
      description:
        'WGSL paint views: heightField (bilinear height → elevation ramp + grid lines), heightTileView (height tint over tile ground), zoneView (tile ground + translucent zone tint in ONE quad — no Effect-over-Effect alpha).',
      status: 'live',
    },
    {
      name: 'BrushRail / railAtoms',
      purpose: ['ui', 'world_gen'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/BrushRail.tsx',
      description:
        'Per-layer left rail (215 + 173): tools, tile palette, brush size/shape/profile, height mode brush|ramp with ramp params, zone list — from shared rail atoms (ToolBtn/Swatch/sliders/steppers).',
      status: 'live',
    },
    {
      name: 'chunkFloor.ts',
      purpose: ['rendering', 'world_gen'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/chunkFloor.ts',
      description:
        'The painter→preview bridge (95): each focused chunk becomes a ChunkFloor {tileData,heights,hver} with stable per-chunk identity (the fix for the preview re-bake choke — rebuilt=1 reused=N−1); floorsToLandforms lowers floors to real heightfield Landforms.',
      status: 'live',
    },
    {
      name: 'IsoPreview',
      purpose: ['rendering', 'camera', 'world_gen'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/IsoPreview.tsx',
      description:
        'Free-fly no-clip camera (200; drag look, WASD fly, Q/E up/down only while this quad owns WASD focus, fog off, far clip pushed out); world drawn by WorldStatics + the full capture family. Camera pose persists per map, autosaves on settle.',
      dependsOn: ['WorldStatics'],
      status: 'live',
    },
    {
      name: 'PropertiesPanel',
      purpose: ['ui', 'building', 'texture_bake'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/PropertiesPanel.tsx',
      description:
        'The top-left per-instance inspector (716): header banner (swatch + gauges + profile radar via Graph primitives) over a dense grouped data strip. Focus precedence: tile selection (bulk overrides) > selected placement > active paint tile. Face-skin picker shows live mini-renders (StaticSurface).',
      dependsOn: ['objectPreview.ts'],
      status: 'live',
    },
    {
      name: 'RightPanel + tabs/',
      purpose: ['ui', 'building', 'agent_llm'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/RightPanel.tsx',
      description:
        'Right quad: Objects (breadcrumb browser + ModelViewer/ObjectInspect3D + shared PropertiesPanel; green + places), Notes (TextArea in map payload), Chat (useAssistant claude_code chat, lazily armed), Settings (grid toggle, layout reset, autosave).',
      dependsOn: ['ModelViewer', 'ObjectInspect3D', 'PropertiesPanel', 'useAssistant'],
      status: 'live',
    },
    {
      name: 'ModelViewer',
      purpose: ['rendering', 'camera', 'building'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/ModelViewer.tsx',
      description:
        'Single-object studio viewer (116): no skybox/fog, OrbitCamera solved cart-side, drag via the global cursor channel, wheel zoom. Notes <Scene3D.OrbitControls> is a host-side stub.',
      consumes: ['system:cursor:move'],
      status: 'live',
    },
    {
      name: 'ObjectInspect3D',
      purpose: ['rendering', 'building', 'texture_bake', 'interaction'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/ObjectInspect3D.tsx',
      description:
        'Pickable viewer (139): click a part (deck/pillar/panel) to texture it; parts from the game’s buildingParts/propParts; ray from the same solved camera that renders so picks are exact.',
      dependsOn: ['buildingParts', 'propParts'],
      status: 'live',
    },
    {
      name: 'objectPreview.ts',
      purpose: ['building', 'rendering', 'world_gen'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/objectPreview.ts',
      description:
        'Builds a one-object mini-world via the real mutators so inspection resolves identically to the map.',
      status: 'live',
    },
    {
      name: 'TexturePreview',
      purpose: ['texture_bake', 'ui', 'shader'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/TexturePreview.tsx',
      description:
        'One swatch component for both texture kinds (react-authored facade markup vs shader Effect with frozen data) — "texture is one concept."',
      status: 'live',
    },
    {
      name: 'TextureStudio / ShaderLab',
      purpose: ['shader', 'texture_bake', 'ui'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/TextureStudio.tsx',
      description:
        'Route /textures (155): catalog rail → ShaderLab (189: tune named params on a shared base + overlay, Materialize freezes data[] into a stored material in the shared hmsc store → joins allTextures).',
      status: 'live',
    },
    {
      name: 'VoxelHybridRoute (retired into workbench item VOXEL lens)',
      purpose: ['voxel', 'world_gen', 'asset_pipeline'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/editors/voxels/stream.ts',
      description:
        'WBITEMS-FLIP-0606: /voxels route and Boxes chrome icon deleted after Workbench item-source parity; voxel blockout authoring lives in the Workbench item source VOXEL lens while editors/voxels/stream.ts remains the shared blockout stream.',
      consumes: ['__fs_write'],
      status: 'deprecated',
    },
    {
      name: 'Embodied.tsx (the shared embodied substrate)',
      purpose: ['character', 'game_loop', 'physics', 'camera', 'interaction'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/Embodied.tsx',
      description:
        'SUBSTRATE-0605 (2026-06-05): the drop-in player scene exists exactly ONCE — extracted FROM TestRoute (the USER-VERDICT-hardened lineage: V23 node-bound native camera via GAME_NATIVE_CAMERA.forNode on a <Scene3D.Camera nativeCamera ref> node, the smooth continuous gait, host physics integration) after /build shipped a wholesale copy that diverged on day one (stale quantized gait + a camera that never engaged: module-level bindFirst with no bound node — CAMGONE-0605). Surface: useEmbodiedPlayer(options) — world grid + colliders + heightfields through GAME_WORLD (mode layers extend via EmbodiedWorldExtras: extra solids merged under the host caps, extra heightfields after the terrain bake), GAME_INPUT key transport, the frame loop (GAME_PHYSICS host step, camera-relative WASD per V7, footing→surface feel, idle-rest epsilon discipline, honest kinematic fallback when host physics is absent), the native camera bind (params-on-change only; optional RMB ADS Aim layer via options.aim), CAPTURED-MOUSE look (addendum 4 USER VERDICT "consume my mouse until esc": route entry/viewport click captures via GAME_INPUT.setPointerCapture, look rides readPointerDelta in the loop, a captured left-click edge = options.onTap — always intent, never a camera gesture; Esc releases; NO drag heuristics), the V2 figure + continuous-gait rig, options.isTyping/speeds/onFrame as the mode-layer seams. Components: <EmbodiedCaptures> (the GAP(W-2) world render-capture set + figure captures), <EmbodiedScene> (Scene3D + bound camera + WorldStatics + PlayerMeshes; route 3D content as children), <EmbodiedMouseSurface> (full-area click-to-capture). Exports PLAYER_CAMERA (the one camera tuning truth — build\'s crosshair pick solves with it) + groundColumnTop + normalizeYawDegrees + PlayerPose. Consumer: editors/play/PlayRoute (the PLAYFOLD-0605 fold of /test + /build — F1/F2 flip the mode with no remount); pinned by editors/build/viewport.test.ts (no route-local embodied copy can reappear). GAP(W-2)/(W-3) markers ride here now.',
      dependsOn: ['GAME_INPUT', 'GAME_NATIVE_CAMERA', 'GAME_CAMERA', 'GAME_LOOP', 'GAME_FIGURE', 'GAME_PHYSICS', 'GAME_WORLD', 'GAME_KINDS', 'WorldStatics'],
      status: 'live',
    },
    {
      name: 'EmbodiedHud.tsx (the Fortnite-verbatim game HUD)',
      purpose: ['ui', 'game_loop', 'telemetry'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/EmbodiedHud.tsx',
      description:
        'HUD-0605 (2026-06-05), USER ruling: "just make a normal game hud … literally just take the same idea as fortnite. verbatim". Composable beside the embodied substrate — any embodied route mounts <EmbodiedHud embodied={...}>; /build is the proving surface. Layout per the user\'s annotated reference screenshot: TOP-CENTER compass strip (headings N/NE/… + degree ticks; objective/target markers bearing-relative to the player — the V23 look SHADOW is sampled on a coarse P2 clock with whole-degree re-renders, so the host-driven camera stays zero-render); TOP-RIGHT minimap (north-up, player-centered: surface regions colored by GAME_KINDS render colors, buildings, route-fed blips like placed pieces, marker blips, player dot + facing dot; legibility cap in HUD_TUNING) + key info rows; LEFT-MIDDLE game status updates feed; BOTTOM-LEFT health bar (state.player.health through the player door) — NO stamina (USER-excluded) and shields render a HAND-OFF row while no damage system door exists (never a fake number); BOTTOM-RIGHT equipment hotbar (player.inventory through GAME_ITEMS; empty inventory = honest hand-off line) with the route\'s blueprint selection slot ABOVE it (on /build: the ruled 1 floor · 2 wall · 3 ramp · 4 roof categories + variant chips — keys and HUD agree) — NO material amounts (USER-excluded). Chrome is the Hud* class family (studio.cls.ts) over hud* tokens (theme.ts) — zero raw colours in the components; every feel number in the exported P2 HUD_TUNING table. Exports: EmbodiedHud, HudSlots, HUD_TUNING + the Hud* prop types.',
      dependsOn: ['Embodied.tsx (the shared embodied substrate)', 'GAME_KINDS', 'GAME_ITEMS', 'studio.cls.ts', 'theme.ts'],
      status: 'live',
    },
    {
      name: 'editors/play/PlayRoute (/test + /build folded)',
      purpose: ['world_gen', 'character', 'game_loop'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/editors/play/PlayRoute.tsx',
      description:
        'Route /test (test mode of the PLAYFOLD-0605 fold): walk the staged world — the FIRST real consumer of the @game ground floor (rewired 2026-06-04, contract: cart/hmsc-int/TestRoute.REWIRE.md; SUBSTRATE-0605 2026-06-05: the embodied drop-in extracted to Embodied.tsx, this lineage was the authority). The test mode layer over useEmbodiedPlayer: the backtick GAME_COMMANDS console session (live speed owner — gv_speed drives the real walk/run; pv_teleport adopts back through adoptPose; open console gates key reads via options.isTyping), the RMB ADS aim opt-in (options.aim — test mode only; the substrate folds the camera back to walk if the mode flips mid-ADS), and the [probe-player-model] gait/rig continuity diagnostic (test mode only; sample refs clear in build mode so re-entry never reads a phantom delta). PLAYFOLD-0605 (2026-06-05, USER ASK; the /build URL retired same day as a dupe): TestRoute.tsx + editors/build/BuildRoute.tsx folded into editors/play/PlayRoute.tsx — ONE route (/test), mode is route state, F1 = test / F2 = build flip it in place with NO remount (pose/camera/console/pieces persist); the console opens in BOTH modes and its ctx speeds drive the walk/run everywhere on the surface; placed pieces are solid + visible in both modes. Remaining cart/hmsc reads marked GAP(W-1 world grid / W-2 world render / W-3 game sky) live in the substrate now.',
      dependsOn: ['Embodied.tsx (the shared embodied substrate)', 'GAME_COMMANDS', 'GAME_INPUT', 'GAME_LOOP', 'GAME_FIGURE'],
      status: 'live',
    },
    {
      name: 'LogView',
      purpose: ['telemetry', 'debug', 'ui'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/LogView.tsx',
      description: 'Route /log: in-app tail of the V27 diagnostics/churn channel.',
      consumes: ['perfLog.ts'],
      status: 'live',
    },
    {
      name: 'assist3d (scene.json + backends)',
      purpose: ['ai_edit', 'agent_llm', 'rendering'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/assist3d/',
      description:
        'AI scene authoring: scene.json is single source of truth; MeshSpec = raw geometry primitive (6 shapes), deliberately NOT a game kind. backends.ts: claude_code (subprocess writes scene.json itself), openai_compat and local_ai (llama.cpp GGUF) call set_scene and the cart writes the file. useSceneAssistant hides the difference; useAssistScene watches the file.',
      dependsOn: ['useSceneAssistant', 'useAssistScene'],
      status: 'lab',
    },
    {
      name: 'picking.ts (assist3d)',
      purpose: ['interaction', 'camera', 'math'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/assist3d/picking.ts',
      description:
        'AABB slab pick, not sphere (sphere fails for flat slabs — the camera ends up inside the bounding sphere). Its hand-rolled screenRay was retired by the V3/R7 graduation: the ray now imports from @reactjit/cameras.',
      status: 'lab',
    },
    {
      name: 'useAssistant',
      purpose: ['agent_llm', 'ai_edit'],
      kind: 'hook',
      sourceFile: 'cart/hmsc-int/',
      description:
        'claude_code subprocess / OpenAI-compatible HTTP / embedded llama.cpp client for ChatTab + assist3d.',
      status: 'lab',
    },
    {
      name: 'perfLog.ts / useChurn',
      purpose: ['telemetry', 'debug'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/perfLog.ts',
      description:
        'V27-folded churn recorder: useChurn still names which state drove a whole-cart re-render, but writes through GAME_TELEMETRY diagnostics channel churn into /tmp/hmsc-int-diagnostics.jsonl instead of a separate file. Off by default; log churn on/off controls it live.',
      consumes: ['__fs_write'],
      status: 'dormant',
    },
    {
      name: 'editLog.ts',
      purpose: ['telemetry', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editLog.ts',
      description:
        'The semantic event trace (90; categorized EditNotes: tile/height/zone/chunk/object/camera/map), capped ring persisted to sessions/_eventlog.json (survives hot reload; not in the import graph so writes can’t loop), shown in the chrome popover (shell/chrome.tsx EventLog) with ~600ms coalescing.',
      status: 'live',
    },
    {
      name: 'useWorkspace',
      purpose: ['persistence'],
      kind: 'hook',
      sourceFile: '@reactjit/workspace',
      description:
        'Shared workspace pattern (third consumer after cutout, composer): v2 payload carrying the whole world, per-map cameras, synchronous flushCurrent before map switches, undo snapshots at action start (onEditBegin).',
      consumers: ['cart/cutout', 'cart/composer', 'cart/hmsc-int'],
      status: 'live',
    },
    {
      name: 'hmscStoreGet/Set',
      purpose: ['persistence', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/',
      description:
        'Game-side wrappers over __store_* for the boot key, kind textures, materialized textures. The compile channel; localstore is ONE store (fs.init("reactjit")).',
      consumes: ['__store_get', '__store_set'],
      status: 'live',
    },
    {
      name: 'saveGameState (Compile)',
      purpose: ['persistence', 'world_gen'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/',
      description:
        'Persists the staged GameState to the shared hmsc/game-state localstore boot key — a deliberate button, not an autosave. The editor→game channel.',
      emits: ['hmsc/game-state'],
      status: 'live',
    },
    {
      name: '__canvas_screen_to_graph',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_telemetry.zig',
      description:
        'Pan/zoom-aware pointer→graph coordinate conversion; here it is live (unlike pixel_icon_demo’s dead wrapper).',
      status: 'live',
    },
    {
      name: '__tel_input',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_telemetry.zig',
      description: 'Focused-node id check; gates WASD/brush against typing so typing in an input never paints.',
      status: 'live',
    },
    {
      name: 'system:cursor:move (global cursor channel)',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/',
      description:
        'Host-pumped global mouse deltas (SDL_GetGlobalMouseState) used for divider and orbit drags instead of per-node mouse-move.',
      status: 'live',
    },
    {
      name: 'WorldStatics',
      purpose: ['rendering', 'world_gen', 'building'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/render3d/GameWorld3D',
      description:
        'The game’s own static-world renderer + matching capture components (Landform/Building/Prop/Part surface captures); the preview uses it so it can’t drift from the game.',
      consumers: ['cart/hmsc-int/IsoPreview.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'author-with-the-game’s-own-code',
      purpose: ['world_gen', 'building', 'rendering'],
      description:
        'Mutators, renderer, terrain shader, and parts lists all imported from the game so an authored thing is byte-identical to one the game made — the anti-drift strategy and the strongest statement of it in the repo. No parallel schema, no renderer fork.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
    {
      name: 'coalesced GPU paint',
      purpose: ['rendering', 'world_gen'],
      description:
        'usePaintedField + per-chunk buffers + stable chunk keys: brush touches at input rate, encode+upload coalesce once per frame. The stable-identity rule exists because per-rectangle churn crashed wgpu mid-draw.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
    {
      name: 'thin-reference persistence',
      purpose: ['persistence', 'world_gen'],
      description:
        'mapStore’s globals rule + name-keyed tile legend: globals are shared, maps are thin references remapped on load. The multi-map workspace’s data philosophy.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
    {
      name: 'workspace pattern (third consumer)',
      purpose: ['persistence', 'ui'],
      description:
        'useWorkspace after cutout and composer: v2 payload carrying the whole world, per-map cameras, synchronous flushCurrent before map switches, undo snapshots at action start rather than on change.',
      examples: ['cutout', 'composer', 'hmsc-int'],
      promoteTo: 'useWorkspace',
      status: 'resolved',
    },
    {
      name: 'settle-snap',
      purpose: ['input', 'world_gen'],
      description:
        'Native drag streams raw positions, a 140ms quiet timer quantizes to placementCellRect — the ONE shared snap across canvas node, preview, and compile. No fight with the host-owned drag.',
      examples: ['hmsc-int'],
      promoteTo: 'placementCellRect',
      status: 'recurring',
    },
    {
      name: 'two texture scopes (instance vs kind)',
      purpose: ['texture_bake', 'building'],
      description:
        'Top-left panel = per-INSTANCE; right-rail Objects = per-KIND global (shared store + bus broadcast); merged at preview/compile with instance winning.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
    {
      name: 'diagnostics as disposable file-backed modules',
      purpose: ['telemetry', 'debug'],
      description:
        'GAME_TELEMETRY diagnostics channels + perfLog/LogView/useChurn + editLog — switchable, file-backed, aggregate-only on hot paths; churn now folds into /tmp/hmsc-int-diagnostics.jsonl while editLog remains the semantic session trace.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
    {
      name: 'cutout brush-input idiom (Pressable over Canvas)',
      purpose: ['input', 'world_gen'],
      description:
        'A screen-space <Pressable> sibling over the <Canvas> with same-node down/move for pointer capture; rails rendered after it to stay clickable.',
      examples: ['hmsc-int', 'cutout'],
      status: 'recurring',
    },
    {
      name: 'screenRay / unexported camera math duplicate family',
      purpose: ['camera', 'interaction', 'math'],
      description:
        'Each picker re-rolled a ray from the solved render camera (assist3d picking.ts, retired VoxelHybridRoute) — RESOLVED by the R7 graduation: screenRay is exported from @reactjit/cameras (unprojectGround is a consumer) and both hand-rolls in this cart imported it before the voxel route retired.',
      examples: ['hmsc-int'],
      promoteTo: 'screenRay exported from @reactjit/cameras',
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'arrow/function/nav keys dead on the __keydown wire (printable collisions)',
      purpose: ['input', 'host_bridge'],
      description:
        'CLOSED (2026-06-04). engine.zig packed key events as (mod<<16 | sym & 0xFFFF), truncating 0x4000xxxx SDLK codes into printable ASCII (LEFT arrived as ‘p’, UP ‘r’, RIGHT ‘o’, DOWN ‘q’, F1 ‘:’) and useIFTTT.ts’s SDL_KEY_NAMES 0x4000xxxx entries could never match. Fixed at the encoding: the packing is mod<<32 | sym (< 2^48, exact in the f64 crossing the V8 bridge), owned by framework/key_pack.zig and shared by engine.zig (producer) + ifttt/ifttt.zig + useIFTTT.ts decodeKey (decoders; JS decodes via arithmetic div/mod, never 32-bit bitwise). Arrows now arrive as ‘left’/‘right’/‘up’/‘down’; standalone modifiers keep useless names but full-width (Shift = sdl:1073742049, was sdl:225) with TRUE flags; no consumer matched the truncated spellings (combat_lab’s full-width SHIFT_KEYS match came alive). Pinned by zig build test-key-pack (P4, 5 tests). GAME_INPUT’s bindings table stays WASD-only because the CONTRACT is WASD, no longer because the wire eats arrows.',
      evidence: ['framework/key_pack.zig (the one packing)', 'framework/engine.zig SDL_EVENT_KEY_DOWN/KEY_UP → key_pack.pack', 'runtime/hooks/useIFTTT.ts decodeKey (arithmetic div/mod)', 'framework/testing/unit/key_pack.zig (zig build test-key-pack)', 'cart/hmsc-int/game/input.CAPTURE.md ambiguity 2 (CLOSED)'],
      fix: 'Shipped: mod<<32 | sym in framework/key_pack.zig; both decoders updated; behavior test wired into build.zig.',
      severity: 'low',
    },
    {
      name: 'AGENTS.md MapCanvas drift',
      purpose: ['maintenance'],
      description:
        'The cart’s own agent contract (AGENTS.md) names MapCanvas.tsx, which has since become PaintCanvas.tsx — doc drift inside the cart’s own contract.',
      evidence: ['cart/hmsc-int/AGENTS.md documents MapCanvas.tsx; file is now PaintCanvas.tsx'],
      fix: 'Update AGENTS.md to reference PaintCanvas.tsx.',
      severity: 'high',
    },
    {
      name: 'tile overrides not consumed game-side',
      purpose: ['world_gen', 'persistence'],
      description:
        'Tile overrides serialize with the map but runtime consumption game-side is not wired — authored overrides currently do nothing in the game.',
      evidence: ['cart/hmsc-int/tileOverrides.ts (88); what-is-not-here section line 94'],
      fix: 'Wire override consumption into the game runtime per the tile-overrides memory.',
      severity: 'high',
    },
    {
      name: 'two coexisting authoring models',
      purpose: ['world_gen', 'ai_edit', 'maintenance'],
      description:
        'worldFile.ts/assets.ts/assetPrompt.ts (world-as-.tsx + AI asset generation + bake-to-Zig) is built but not wired into the main GameState flow; the two authoring lanes coexist unreconciled.',
      evidence: ['cart/hmsc-int/worldFile.ts (178), assets.ts (91), assetPrompt.ts; what-is-not-here section line 92'],
      fix: 'The coherence pass must reconcile the two authoring models.',
      severity: 'medium',
    },
    {
      name: 'assist3d meshes don’t bridge into placements',
      purpose: ['ai_edit', 'world_gen'],
      description:
        'assist3d MeshSpec is deliberately a raw geometry primitive, NOT a game kind; bridging assist3d meshes into real placements is a separate step that does not exist yet.',
      evidence: ['cart/hmsc-int/assist3d/scene.json; what-is-not-here section line 95'],
      severity: 'medium',
    },
    {
      name: 'perfLog is explicitly temporary',
      purpose: ['telemetry', 'maintenance'],
      description:
        'The old standalone churn file is retired by V27. The remaining perfLog/useChurn call sites are diagnostics-channel feeds and should be deleted only when their call sites stop being useful.',
      evidence: ['cart/hmsc-int/perfLog.ts (153)'],
      fix: 'Remove once the idle paint-spike choke is resolved.',
      severity: 'low',
    },
    {
      name: 'no collaborative/locking story',
      purpose: ['persistence', 'maintenance'],
      description:
        'No locking despite parallel sessions editing the same sessions dir; menu refresh-on-open is the only concession, so concurrent edits can clobber each other.',
      evidence: ['what-is-not-here section line 97'],
      severity: 'medium',
    },
    {
      name: 'Scene3D.OrbitControls is a host-side stub',
      purpose: ['camera', 'maintenance'],
      description:
        'ModelViewer notes <Scene3D.OrbitControls> is a host-side stub; orbit must be solved cart-side and driven by the global cursor channel instead.',
      evidence: ['cart/hmsc-int/ModelViewer.tsx (116)'],
      severity: 'medium',
    },
    {
      name: 'AABB slab pick required (sphere fails on flat slabs)',
      purpose: ['interaction', 'math'],
      description:
        'assist3d picking must use an AABB slab test, not a bounding sphere — sphere picks fail for flat slabs because the camera ends up inside the bounding sphere.',
      evidence: ['cart/hmsc-int/assist3d/picking.ts'],
      fix: 'Always use the AABB slab pick for slab geometry.',
      severity: 'medium',
    },
    {
      name: 'console.log never reaches the terminal',
      purpose: ['debug', 'telemetry'],
      description:
        'In this cart console.log only hits the severity ring, not the terminal; perfLog is file-backed specifically to work around this.',
      evidence: ['cart/hmsc-int/perfLog.ts (153)'],
      fix: 'Use warn/error or the file-backed logs for diagnostics.',
      severity: 'low',
    },
  ],
};
