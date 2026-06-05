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
        'THE ONLY DOOR (V17): all 19 standard GAME_* exports. Live at milestone-0: GAME_PHYSICS (typed wire over the honest __game_physics_* bindings, v8_bindings_game_physics.zig; no fallback to the legacy __hmsc_* aliases), GAME_PATHING (over runtime/pathing+motion — still the __path_* names; no honest alias yet), GAME_INPUT (transport only, V7), GAME_CAMERA (pure side of @reactjit/cameras), GAME_LOOP (clocks only, NO loop API — R3), GAME_COMMANDS (the V19 scripting surface), GAME_KINDS (the five kind tables), GAME_VEHICLE (V10 VehicleDoc + buildVehicle + semantic part vocabulary). The rest export { status: "capture-pending" }. @game bundler alias (cli/cart/bundle.ts) = the V18 metafile-gate signal. P4 *.test.ts beside every family, run under tools/v8cli.',
      status: 'live',
    },
    {
      name: 'compile/main.ts + rjit game compile/verify',
      purpose: ['scripting', 'maintenance', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/compile/main.ts',
      description:
        'The V19 skeleton: `rjit game compile` bundles the headless boot → zig-out/game/hmsc-headless.js; `rjit game verify` compiles fresh, runs every game/**/*.test.ts suite, boots the output under v8cli, replays every compile/verify/*.cmds command sequence (game/commands is the language), and exits with one VERDICT GREEN/RED line. The headless state is the captured GameCommandState + boot/tick locals; the full 48-name console vocabulary is mounted (defineGameCommands), so verify scripts speak real commands (commands.cmds: 25 captured commands). Grows as captures land.',
      status: 'live',
    },
    {
      name: 'labs/ + shell/LabsRoute.tsx + rjit lab new',
      purpose: ['scripting', 'ui', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/labs/index.ts',
      description:
        'The experiment slots (V13/V17/P5): labs/_scaffold.tsx(+.notes.md) is the template `rjit lab new <name>` copies (a lab = @game imports + an exported scene, nothing else; the paired <name>.notes.md is its P6 contract). labs/index.ts is the registry the CLI maintains at its rjit: markers. shell/LabsRoute.tsx (the first shell/ piece) renders the /labs route — list, loaded scene, notes always beside it — and stays game-agnostic: the lab list crosses in as plain data at the router (ProjectBar FlaskConical button).',
      status: 'live',
    },
    {
      name: 'data/index.ts (the V20 store)',
      purpose: ['persistence', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/data/index.ts',
      description:
        'The V20 persistence layer — openStore(rootDir) is the only door. Per-concern append-only streams (data/streams/<name>.jsonl), ONE total cross-session undo chain (global seq across all streams; an undo point is a log position — stateAt(seq) reads as-of, history never rewrites), materialized snapshots stamped with their chain position (the game/compile loads snapshots, never history). The incompleteness guard is the API: defineStream demands name AND initial+apply in one registration. Content gitignored; backup = exportBackup() (streams + manifest). Host gap: no __fs_append binding yet → read+concat+write (reader tolerates a torn trailing line). P4 suite data/data.test.ts rides rjit game verify.',
      status: 'live',
    },
    {
      name: 'index.tsx',
      purpose: ['world_gen', 'ui', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/index.tsx',
      description:
        'Composition spine (833 lines): workspace persistence (useWorkspace, payload v2), multi-map CRUD, placement state + undo snapshots, tile-selection + override state, previewWorld assembly, compile, router; the 2×2 QuadSplit layout under the persistent ProjectBar.',
      dependsOn: ['useWorkspace', 'QuadSplit', 'ProjectBar', 'PaintCanvas', 'IsoPreview', 'PropertiesPanel', 'RightPanel', 'editorWorld.ts'],
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
        'V2/V2-AMENDED/V1 capture (2026-06-05): the head_lab kit REWRITTEN fresh (cart/head_lab untouched; editor UI fenced to editors/characters/). shapes.ts = P2 data (presets/8 body shapes/garments/LODs); skeleton.ts = 25-bone action-modulated FK + place/offset/blend; assembly/clothing bones-driven (sockets, finger fans, pose-tracking garments); rig.ts = BodyRigFrame + RULED damage zones (lArm/rArm/lLeg/rLeg over oriented boxes, 25 bones mapped) + anchors + buildRigFrameFromBones (the V1 seam); hed.ts/.body codecs (one-shape color+relief law, deterministic animations, seeded generateFace); ragdoll.ts = the V1 CONTRACT (seam + RAGDOLL_TUNING, deliberately NO solver — host feature is the physics lane, acceptance vs the archived JS reference); bake.ts = THE BAKE ENTRY (seeds/documents → deterministic host-shaped BakedFigures; partGlobeParams shared with render). render.tsx = preview path only (React-free door keeps headless verify clean). 24 P4 tests in 4 suites; CAPTURE.md records drops + ambiguities.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts'],
      status: 'live',
    },
    {
      name: 'game/vehicle (GAME_VEHICLE — the V10 vehicle module)',
      purpose: ['vehicle', 'damage', 'rendering', 'world_gen', 'maintenance'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/vehicle/index.ts',
      description:
        'V10 capture (2026-06-05): vehicle_lab\'s reusable system REWRITTEN fresh behind the game door (reference untouched; authoring UI deliberately out of scope for editors/vehicles/). Captures VehicleDoc, makeVehicle(seed), buildVehicle(doc, actions), 18 semantic VehiclePartId entries, 8 styles, 4 roles, 5 pose DSL presets, sparse damage map, material metadata, explicit hitboxes, critical parts, named anchors, service liveries, and action-driven wheel/steer/bounce/brake transforms. Renderer dependencies dropped at the boundary: meshes carry kind+params, not Geometry imports. P4 suite sweeps 64 style/role/gas cases and asserts the tables\' meaning; CAPTURE.md records dropped UI and scale/material/animation ambiguities.',
      dependsOn: ['game/_testkit.ts', 'game/index.ts'],
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
        'Capture wave (2026-06-05): hmsc’s 48-command console vocabulary (cmd_/lab_/gv_/pv_/ev_/wv_) REWRITTEN fresh onto the skeleton’s mutable-ctx conventions (cart/hmsc/commands/registry.ts untouched behavior reference). All 48 names register so the V19 script language is complete: 23 run for REAL against GameCommandState + the P2 tables (COMMAND_TUNING, SKY_NAMED_HOURS, SKY_WEATHER_PRESETS) + GAME_KINDS (wv_tile); wv_prop partial (kinds listing real); 24 explicit NOT-YET stubs FAIL LOUDLY ("system not captured yet: <owner>") — NOT_YET_CAPTURED exports the per-owner hand-off lists (world grid, roads, traffic, buildings/interiors, zones, validation, landform instances, lab scenes, input contract, telemetry, noise, V20 save/load). Dot-path state shape preserved so saved scripts keep meaning. Exposed via GAME_COMMANDS.{createGameState,defineGameCommands,tuning,names,notYetCaptured}. 14 P4 tests (vocabulary.test.ts) + compile/verify/commands.cmds; rjit game verify GREEN. CAPTURE.md records the boundary + ambiguities.',
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
      name: 'ProjectBar',
      purpose: ['ui', 'persistence'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/ProjectBar.tsx',
      description:
        'Persistent top strip (235): map switcher (MapsMenu), new/rename/delete, undo/redo, route nav buttons, Compile button, save pill, event-log popover. Menus export separately and render as the root’s last children (overlays-last hit-test rule).',
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
        'The bottom-left authoring quad (1265, largest file). Four layers (paint/height/place/zone) over focused chunks; each chunk is one <ChunkSurface>; "+" ghosts grow the map. Brush input = screen-space Pressable over the Canvas (same-node down/move for capture); alt-drag/WASD pan.',
      consumes: ['__canvas_screen_to_graph', '__tel_input', '__keydown', '__keyup', 'system:blur'],
      dependsOn: ['ChunkSurface', 'usePaintedField'],
      status: 'live',
    },
    {
      name: 'ChunkSurface',
      purpose: ['rendering', 'world_gen'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/ChunkSurface.tsx',
      description:
        'One chunk = one Effect quad (72); owns its coalesced GPU buffer (usePaintedField), picks the layer’s shader, registers a flush so a stroke re-uploads only its chunk.',
      dependsOn: ['usePaintedField'],
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
      name: 'VoxelHybridRoute',
      purpose: ['voxel', 'world_gen', 'asset_pipeline'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/VoxelHybridRoute.tsx',
      description:
        'Route /voxels (544): a voxel build/mine surface (voxel_stack_demo’s pattern grown an export — writes meshes to disk).',
      consumes: ['__fs_write'],
      status: 'live',
    },
    {
      name: 'TestRoute',
      purpose: ['world_gen', 'character', 'game_loop'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/TestRoute.tsx',
      description:
        'Route /test (197): walk the staged world with a PlayerFigure (landform/surface height sampling) — the editor’s "play test" seam.',
      dependsOn: ['PlayerFigure'],
      status: 'live',
    },
    {
      name: 'LogView',
      purpose: ['telemetry', 'debug', 'ui'],
      kind: 'component',
      sourceFile: 'cart/hmsc-int/LogView.tsx',
      description: 'Route /log: in-app tail of the perf churn log.',
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
        'screenRay (same unexported-camera-math duplicate family) + AABB slab pick, not sphere (sphere fails for flat slabs — the camera ends up inside the bounding sphere).',
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
        'File-backed churn recorder (153; /tmp/hmsc-int-churn.log, debounced batch writes so logging never sits on the paint path). useChurn probes which state drove a whole-cart re-render. Self-declared temporary: "rip out once the choke is settled."',
      consumes: ['__fs_write'],
      status: 'dormant',
    },
    {
      name: 'editLog.ts',
      purpose: ['telemetry', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/editLog.ts',
      description:
        'The semantic event trace (90; categorized EditNotes: tile/height/zone/chunk/object/camera/map), capped ring persisted to sessions/_eventlog.json (survives hot reload; not in the import graph so writes can’t loop), shown in the ProjectBar popover with ~600ms coalescing.',
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
      sourceFile: 'cart/hmsc/',
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
      sourceFile: 'cart/hmsc/render3d/GameWorld3D',
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
        'perfLog/LogView/useChurn + editLog — disposable, file-backed, never on the hot path (debounced batch writes; not in the import graph so writes can’t loop).',
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
        'Each picker re-rolls a ray from the solved render camera (assist3d picking.ts, ObjectInspect3D, ModelViewer) — the recurring unexported camera-math duplicate that wants one canonical unprojectGround.',
      examples: ['hmsc-int'],
      promoteTo: 'unprojectGround',
      status: 'promote',
    },
  ],
  hazards: [
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
        'perfLog.ts self-declares "rip out once the choke is settled"; the idle paint-spike hunt it served is still OPEN per memory.',
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
