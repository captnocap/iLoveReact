// decisions.ts — the constitution as DATA (docs/game/DECISIONS.md, structured).
//
// These are THE USER'S RULINGS. In any search result they outrank every record,
// pattern, doc, and piece of code. When competing ideas exist in the codebase,
// the ruling here is the answer; the competitors are history.
//
// Faithful to DECISIONS.md VERDICTS/PRINCIPLES/RESOLUTIONS as of 2026-06-04
// (commits 8644150cc..d0143ebd2). Editing DECISIONS.md = update this file in
// the same commit (the index maintenance contract, CLAUDE.md).

export type DecisionStatus = 'ruled' | 'revised' | 'open' | 'show-me';

export type Decision = {
  id: string;            // 'V1', 'P3', 'R4'...
  name: string;
  status: DecisionStatus;
  ruling: string;        // the decision, compressed but exact
  detail?: string;       // implications / the user's own words
  keywords: string[];    // fuzzy-search surface
  retires?: string[];    // implementations this ruling kills/demotes
  cites?: string[];      // file paths involved
};

export const DECISIONS: Decision[] = [
  {
    id: 'V1', name: '3D physics: ONE coherent host-side system', status: 'revised',
    ruling: 'Physics is ONE coherent system (revised from "two layers"): the hmsc host sim (__hmsc_* lineage) owns locomotion, gravity, collision, AND absorbs ragdoll as a Zig feature. The JS Verlet solver is behavior-reference ONLY — port its behavior, not its implementation.',
    detail: 'User: the ragdoll\'s real contributions were the player model (= V2 data) and hitboxes; "i couldnt move in the ragdoll"; cart-side JS is "likely problematic the moment it takes a real load". Bones-in/bones-out survives as the interface. Projectile physics is separately UNDETERMINED (see R2).',
    keywords: ['physics', 'host sim', 'verlet', 'ragdoll', 'gravity', 'jump', 'collision', 'locomotion', 'hmsc physics', 'physics3d', 'bullet', 'zig physics'],
    retires: ['head_lab/ragdoll.ts as a runtime (stays as behavior reference + editor preview)'],
    cites: ['framework/v8_bindings_physics_lab.zig', 'cart/head_lab/ragdoll.ts'],
  },
  {
    id: 'V2', name: 'Player model: head_lab kit, authored in JS, BAKED into the host', status: 'ruled',
    ruling: 'The head_lab kit is THE figure stack, outright (ragdoll.ts per V1: behavior reference only — its implementation is not kept). Damage zones spell lArm/rArm/lLeg/rLeg (head_lab). Hit volumes are head_lab\'s oriented boxes. AMENDED: head_lab is the AUTHORING system — models are COMPILED (baked) into the host; the per-frame JS evaluation path (buildRigFrame, dyn-geometry, on-the-fly face bakes) is editor/lab preview ONLY, never the game path.',
    detail: 'The seeded generators stay — "the variety of life is the right shape"; the bake preserves variety (documents/seeds in, compiled population out). hmsc\'s render3d/humanoid retires; bodylab\'s third solver and the inline parts-arrays (animation_lab/camera_lab/input_bench) are deleted.',
    keywords: ['player model', 'humanoid', 'figure', 'character', 'head_lab', 'hmsc humanoid', 'damage zones', 'hitbox', 'armL', 'lArm', 'capsules', 'boxes', 'bake', 'baked', 'hed', 'body document', 'face', 'clothing', 'variety'],
    retires: ['cart/hmsc/render3d/humanoid/', 'cart/bodylab solveHumanoid', 'inline HUMANOID parts arrays in animation_lab/camera_lab/input_bench'],
    cites: ['cart/head_lab/parts.ts', 'cart/head_lab/figureRender.tsx', 'cart/head_lab/hed.ts'],
  },
  {
    id: 'V3', name: 'Camera: the registry, absorbing the ADS aim rig', status: 'ruled',
    ruling: '@reactjit/cameras (pure solve(params) rigs) is the ONE camera system. combat_lab\'s ADS aim rig is absorbed into it as a first-class rig — the shipped Follow rig is inadequate for combat ("could barely hit head height before hitting a ceiling"). screenRay gets exported from the registry. Hand-rolled trig holdouts are deleted.',
    keywords: ['camera', 'orbit', 'follow', 'aim', 'ads', 'aim ceiling', 'rig', 'solve', 'unprojectGround', 'screenRay', 'picking', 'first person', 'cinematic'],
    retires: ['hmsc_scale_lab cameraFromOrbit', 'hmsc_massive_map_lab dual-rig trig', 'animation_lab camera trig', 'hand-rolled screenRay copies'],
    cites: ['runtime/cameras/', 'cart/combat_lab (aim rig)'],
  },
  {
    id: 'V4', name: 'World: the tile system IS the system — juiced to Vice City scale', status: 'ruled',
    ruling: 'hmsc\'s tile-kind model is the gameplay substrate — "the tile system IS the system". Rendering must reach instanced-batch performance harmonized with the bake direction: target is a game map the size of GTA Vice City. Authoring stays tiles; rendering gets juiced until that map runs.',
    keywords: ['world', 'tiles', 'tile system', 'map', 'vice city', 'scale', 'instancing', 'instances', 'bake', 'rendering', 'world gen', 'chunks', 'city'],
    cites: ['cart/hmsc/world/tileKinds.ts', 'cart/hmsc_massive_map_lab.tsx (instancing proof)'],
  },
  {
    id: 'V5', name: 'Pathing/NPC: deterministic-until-game-state-change', status: 'ruled',
    ruling: 'pathing_lab\'s host A* + deterministic motion plans are the START of the real traffic and civilian systems. Doctrine: ALL NPC pathing is deterministic until a game-state change — paths precomputed; the player\'s effect on the world is what invalidates them. Full dynamic NPC state is the goal (combat_lab + pathing_lab are its seeds).',
    keywords: ['pathing', 'traffic', 'npc', 'civilians', 'a*', 'astar', 'motion plans', 'deterministic', 'precomputed', 'road grammar', 'lanes', 'crosswalk', 'pedestrians'],
    cites: ['framework/game/pathing.zig', 'framework/v8_bindings_game_pathing.zig', 'runtime/pathing.ts', 'runtime/motion.ts', 'cart/pathing_lab'],
  },
  {
    id: 'V6', name: 'Animation: DSL semantics win; format becomes RLE/relational', status: 'ruled',
    ruling: 'The action vocabulary/alias semantics of cart/animationDsl.ts are the one animation path; per-cart pose tables retire; gait stays a pose generator under the action layer. BUT the bracket-string format was a quick pass-off — the real format is RLE\'d, relational animation data ("quick, no hiccups").',
    keywords: ['animation', 'dsl', 'rle', 'timeline', 'gait', 'pose', 'walk cycle', 'actions', 'punch', 'wave', 'talk'],
    retires: ['animation_lab poseFor table', 'bodylab drivePose'],
    cites: ['cart/animationDsl.ts'],
  },
  {
    id: 'V7', name: 'Movement: host-side; input_bench integrator and physics-step movement unify', status: 'ruled',
    ruling: 'WASD-becomes-velocity lives in the host. The __input_bench_* integrator and the __hmsc_physics_step movement are "the same thing" — they unify into ONE host-side movement integrator inside the physics step. JS keysRef is input transport only, never the integrator.',
    keywords: ['movement', 'wasd', 'input', 'velocity', 'integrator', 'input_bench', 'keys', 'drive mode', 'walk', 'run'],
    cites: ['framework/v8_bindings_input_bench.zig', 'framework/v8_bindings_physics_lab.zig'],
  },
  {
    id: 'V8', name: 'Two clocks: frame loop + ~45/min game-state tick on an event channel', status: 'ruled',
    ruling: 'The game state runs on a fixed cadence (~45 state-ticks per MINUTE); every NPC state update publishes to an event channel (useIFTTT-like); player actions force immediate state ticks (the expected mutation points); otherwise the game state follows a deterministic path. Frame loop (render/sim) and game-state tick are DISTINCT clocks. The frame-loop hook\'s exact shape: see R3 (show-me).',
    keywords: ['game loop', 'tick', 'state tick', 'clock', 'event channel', 'ifttt', 'bus', '45 ticks', 'forced tick', 'deterministic state', 'useGameLoop'],
  },
  {
    id: 'V9', name: 'Chance engine: the hybrid — scape surface + hmsc cover input', status: 'ruled',
    ruling: 'One chance engine: scape\'s ChanceBreakdown legibility (WHY is it 33%) + hmsc/combat_lab\'s coverFraction input. Ground-truth-vs-display-warp law intact. Needs a dedicated lab for extensive tuning before it\'s trusted.',
    keywords: ['chance', 'hit chance', 'odds', 'percent', 'cover', 'coverFraction', 'breakdown', 'range profile', 'line of sight', 'los'],
    cites: ['cart/scape/systems/chance.ts', 'cart/hmsc/npc/systems/chance.ts', 'cart/combat_lab (coverFractionOf)'],
  },
  {
    id: 'V10', name: 'Vehicle: vehicle_lab is the source', status: 'ruled',
    ruling: 'vehicle_lab\'s VehicleDoc + buildVehicle + semantic VehiclePartId rig is the vehicle module — "this is where our models are coming from like head_lab". Scale not yet verified; many cars need work (ongoing, against the fixed 1-tile=1m contract). CarMeshes and the hmsc structure cars retire into it.',
    keywords: ['vehicle', 'car', 'cars', 'sedan', 'buildVehicle', 'VehicleDoc', 'wheels', 'driving'],
    retires: ['cart/ragdoll_lab/car.tsx CarMeshes', 'cart/hmsc/render3d/structures/Car.tsx'],
    cites: ['cart/vehicle_lab/'],
  },
  {
    id: 'V11', name: 'Items: game_item_gallery ideas, with a mandatory scale audit', status: 'ruled',
    ruling: 'game_item_gallery\'s ITEMS registry is the source — the item IDEAS are on point — but the scale is trash (the boat is smaller than the player model\'s hand). Every item gets real scale work against the 1-tile=1m contract. physics_lab\'s catalog folds in after review.',
    keywords: ['items', 'props', 'item models', 'ITEMS registry', 'held item', 'scale audit'],
    cites: ['cart/game_item_gallery'],
  },
  {
    id: 'V12', name: 'Perception: combat_lab produces, scape consequences consume', status: 'ruled',
    ruling: 'One detective loop: combat_lab\'s perception ladder (FoV cones, tile-noise hearing, stimulus/lastKnown, escalation) produces; scape\'s consequence layer (WitnessMemory, the Case) consumes. More internal tooling still needed for story/mission/dialog.',
    keywords: ['perception', 'awareness', 'witness', 'noise', 'hearing', 'fov', 'stealth', 'hitman', 'detective', 'consequences', 'case', 'story', 'mission', 'dialog'],
    cites: ['cart/combat_lab', 'cart/scape'],
  },
  {
    id: 'V13', name: 'The harness: fresh rewrite anchored on hmsc-int (labs route, per-lab notes)', status: 'ruled',
    ruling: 'Fresh rewrite anchored on the internal tool (hmsc-int): a labs route — a collection of every lab, instantly loadable; labs are SHORT React files because the entire game system is built into the internal tool; per-lab NOTES persist and are always surfaced to any AI referencing the lab; nothing gets recreated.',
    keywords: ['labs', 'harness', 'internal tool', 'hmsc-int', 'lab route', 'notes', 'lab loading', 'experiment', 'short react file'],
    cites: ['cart/hmsc-int/'],
  },
  {
    id: 'V14', name: 'The ground floor: ALL eleven items in', status: 'ruled',
    ruling: 'Every lab gets for free: loop (minimal API, pending R3), camera registry (incl. aim rig + screenRay), the figure stack with auto-mounted captures, vehicle module, host physics + heightfields, host pathing + motion plans, the animation system, kinds registries as importable data, lab chrome kit + environment, telemetry + copy-diagnostics, and the Effect/StaticSurface texture system with bake-once discipline.',
    keywords: ['ground floor', 'free', 'lab contract', 'baked in', 'foundation'],
  },
  {
    id: 'V15', name: 'hmsc is a COMPILED OUTPUT of hmsc-int', status: 'ruled',
    ruling: 'The endgame inversion: hmsc the game is a compiled output FROM hmsc-int — the game is not written as a separate cart; the tool emits it. TRANSITION: cart/hmsc is an EXTRACTION SURFACE — a capture source like the labs; feature development on it STOPS; new game work happens inside hmsc-int\'s structure.',
    keywords: ['compile', 'game compile', 'hmsc-int', 'hmsc output', 'emit', 'build the game', 'inversion', 'extraction surface', 'feature freeze', 'where do features go'],
  },
  {
    id: 'V16', name: 'Cutscenes: live, declarative TS files — never baked', status: 'ruled',
    ruling: 'A whole cutscene is a simple TypeScript file: what tile-space the camera occupies at what time, the dialog (head_lab talking faces), the movement of models (pathing + animation DSL) — one clock drives all of it. Never baked in: cutscenes are live, in-game, and show the player\'s current state (clothes, model changes). camera_lab\'s breadth of rigs is RETAINED for cinematic PoVs.',
    detail: '"Never baked" applies to the SCENE, not the actors — V2-baked figures are driven live. Natively deterministic: motion plans, DSL timelines, and camera solves are all pure functions of t, so scrubbing/pause/skip fall out free.',
    keywords: ['cutscene', 'cinematic', 'dialog', 'talking faces', 'scene', 'camera track', 'scripted', 'story scene'],
  },
  {
    id: 'V17', name: 'The lab shape: GAME_* standard imports + scaffold script; old labs capture → rewrite → ARCHIVE', status: 'ruled',
    ruling: 'A new lab is a scaffold from a script — every lab carries the same shape: import { GAME_PHYSICS, GAME_PATHING, GAME_INPUT, GAME_CAMERA, ... } from the ground floor. The GAME_* names are STANDARD (canonical list: STRUCTURE.md\'s game/index.ts door — the V14 ground floor plus the later-added systems). Everything arrives ready to use; the lab just exports itself and is loadable via the labs route. Installing this shape is the FIRST build task of the rebuild. LIFECYCLE: ALL existing labs get rewritten as the new approach — old lab carts are SOURCES to capture from, never migrate-in-place targets; after the entire declared corpus is captured, labs are rewritten as new drop-ins and the old carts are ARCHIVED (locked, read-only, the archive//tsz/ treatment). "Make a lab" is ONE coherent idea — never an old approach and a new one. Extending an old lab cart instead of capturing it = gone wrong. (Deliberate carve-out: Milestone 0\'s build-order step 6 rebuilds the FIRST lab early as the contract proof — the explicit exception to the after-the-entire-corpus rule.)',
    detail: 'TRIAGE: some "labs" are dev tooling — head_lab is both an idea AND where characters get built: kit → game/figure, authoring UI → an editors/ route INSIDE the tool (never ad-hoc external tooling), test scene → a lab. Every old cart triages into SYSTEM (game/), EDITOR (editors/), LAB (labs/), or archive-only. Capture means REWRITING the files — existing files are sparse spread-out logic, behavior references only; written fresh to P2/P3/P4. A git mv into the new structure is the capture done wrong. Host changes to test = rebuild the host; accepted.',
    keywords: ['lab shape', 'scaffold', 'GAME_', 'standard imports', 'new lab', 'lab template', 'ground floor imports', 'create lab', 'archive', 'old labs', 'capture', 'rewrite', 'migrate', 'lock', 'triage', 'editors', 'dev tooling', 'move files', 'git mv'],
  },
  {
    id: 'V18', name: 'Game Zig is organized, properly named, and CONDITIONAL all the way through', status: 'ruled',
    ruling: 'Game Zig follows the framework convention: implementation in a proper module home (framework/game/), bindings as thin registrars with honest capability names (v8_bindings_game_physics.zig — not physics_lab; movement out of input_bench). AND the game is a gated INGREDIENT like every other capability: declared in sdk/dependency-registry.json, flipped by the metafile-gate walker when a cart imports the GAME_* ground floor (importing cart/hmsc-int/game/ — the @game alias — is the gate signal), compiled behind has-game* gates in build.zig — never an unconditional addImport. A 2D interface cart pays zero bytes and zero host fns for the game\'s existence. No "cheap dep" carve-outs.',
    keywords: ['zig organization', 'framework structure', 'bindings naming', 'game zig', 'adhoc', 'module home', 'rename', 'v8_bindings', 'conditional', 'ingredient', 'metafile gate', 'dependency registry', 'has-game', 'bundling'],
    cites: ['framework/v8_bindings_physics_lab.zig', 'framework/v8_bindings_input_bench.zig', 'framework/v8_bindings_game_pathing.zig', 'sdk/dependency-registry.json'],
  },
  {
    id: 'V19', name: 'The compile is always green and LLM-callable', status: 'ruled',
    ruling: 'The game compile is a CLI any LLM can run at any time — compile constantly; "make sure it compiles" is a standing duty, not a milestone gate. LLMs can load runtime tests into the output: compile → boot headless → run behavior tests (P4) → exit with a verdict. A feature is done when the COMPILED GAME carries it and the verify run proves it. GREEN HAS AN EXPLICIT MEANING: the entire testing surface is replayable all the time and DEEP — anything testable is scriptable. hmsc\'s console commands move into the tooling (game/commands/) and double as the test scripting language: a verify script is a saved command sequence replayed headless.',
    keywords: ['compile', 'game compile', 'llm callable', 'always green', 'verify', 'headless', 'runtime tests', 'ci', 'dev flow', 'make sure it compiles', 'console commands', 'scriptable', 'replayable', 'test script', 'green'],
  },
  {
    id: 'V20', name: 'Persistence: stateless, micro-saved, UNBREAKABLE total cross-session history', status: 'ruled',
    ruling: 'Workspace behavior (stateless design, saved at every micro change, historical undo) extended: history persists across ALL sessions as one total undo chain that CANNOT break when something new is introduced — ten days of bad changes steps right back to where it went bad. Storage is a LOG THAT SPLITS ITS CONCERNS: per-concern append-only streams (world, characters, tuning, story, missions, activities, ...), never one monolithic blob. New feature = new stream; old streams stay valid forever (schema evolution by addition, not migration). The game LOADS materialized snapshots, not the history. Streams are NOT git-tracked (gitignored; explicit backup story). THE SNAPSHOT SYSTEM GROWS WITH ANY ADDED TRACKING — a new stream without snapshot support is an incomplete change. Disk cost accepted for development.',
    detail: 'The storage twin of V8\'s event-channel state tick and R6\'s RLE/determinism — the system is event-shaped; storage stops pretending otherwise. An undo point is a log position. "One total undo chain" = a global sequence number across all streams (equivalently a tuple of per-stream positions), not one merged file.',
    keywords: ['persistence', 'history', 'undo', 'workspace', 'stateless', 'micro save', 'append only', 'log', 'streams', 'snapshot', 'sessions', 'time machine', 'storage'],
  },
  {
    id: 'V21', name: 'Population homeostasis (NPC "GC") + ambient pathing as a token dictionary', status: 'ruled',
    ruling: 'The ambient world maintains DISTRIBUTIONS, not individuals: NPCs are seeded samples spawned/collected at the perception boundary, fixed pools, zero allocation (death = slot return + generation bump; all future references are (slot,generation) handles — stale events drop). Identity only by PROMOTION (witness/mission/story/cascade) and decays back when references expire. Ambient NPCs NEVER pathfind: next-token selection over a baked dictionary of micro-paths + junction transition tables (distilled at bake time); perturbation = mask blocked tokens + renormalize; temperature per archetype/district/hour is a P2 knob; heat/wanted = one conditioning column (cops up, civilians to zero, convergence bias, promotion budget). Game state = seed + perturbation log + tenured set; everything ambient is derivable, never saved. Massacre refill curves are tunable, never instant. Promotion-worthiness threshold = SHOW-ME lab.',
    detail: 'V8 clarified alongside: ~45/MIN is a RECONCILIATION cadence, not a simulation rate — closed-form plans sampled at render; ticks drain scheduled invalidations; blast radius computed at perturbation-insertion time; visible/audible direct contact forces, everything else drains.',
    keywords: ['npc', 'gc', 'garbage collector', 'population', 'homeostasis', 'spawn', 'despawn', 'ambient', 'crowd', 'pedestrians', 'traffic', 'token', 'micro paths', 'dictionary', 'temperature', 'wanted', 'cops', 'heat', 'promotion', 'identity', 'generation handle', 'stateless', 'tick', 'reconciliation'],
  },
  {
    id: 'P1', name: 'Zig owns the brute work; JS authors data, never runs it', status: 'ruled',
    ruling: 'No matter how anything folds, the heavy runtime of data is controlled from Zig. JavaScript is a really nice AUTHORING layer for data and a bad RUNTIME for it. If a system moves data every frame, its hot loop is Zig; JS declares, authors, tunes.',
    keywords: ['zig', 'javascript', 'performance', 'runtime', 'authoring', 'hot loop', 'architecture', 'brute work'],
  },
  {
    id: 'P2', name: 'Every value is exposed for the game compile — no private constants', status: 'ruled',
    ruling: 'Every number, value, name arrives at an interface (the internal tool) where it can be changed at any time → compile and go. A behavior-affecting constant buried in code is a BUG. Kills: "have the AI go change a private value and slowly iterate."',
    keywords: ['constants', 'tuning', 'tunables', 'exposed', 'knobs', 'values', 'compile and go', 'private value', 'registry', 'tables'],
  },
  {
    id: 'P3', name: 'Deep interfaces, readable code, good structure', status: 'ruled',
    ruling: 'Small, strict surfaces hiding substantial implementation; names that carry meaning; validation at the boundary. The ground-floor modules are written to this bar.',
    keywords: ['interfaces', 'readable', 'structure', 'naming', 'api design', 'code quality'],
  },
  {
    id: 'P4', name: 'Behavior-level tests, dual-sided (TS + Zig)', status: 'ruled',
    ruling: 'Runtime testing AND local TypeScript + Zig test suites that validate BEHAVIOR — written to survive interface changes. Tests assert what the system does (jump arc, hit chance at range X under cover Y), not what its functions are called. Every ground-floor module ships both sides.',
    keywords: ['tests', 'testing', 'behavior tests', 'validation', 'regression', 'zig test', 'typescript test'],
  },
  {
    id: 'P5', name: 'The core shape is protected; new ideas slot in', status: 'ruled',
    ruling: 'A new idea is a short file in a lab slot consuming the ground floor through deep interfaces — it never forks or mutates the core. Winners graduate INTO the ground floor by a new verdict. The ground floor only ever grows by verdict. Experiments are production-quality (disposability is in the IDEA, not the implementation).',
    keywords: ['experiments', 'core shape', 'graduation', 'protect', 'slot in', 'new mechanics', 'fork'],
  },
  {
    id: 'P6', name: 'The lab corpus IS the regression suite; breaks force real choices', status: 'ruled',
    ruling: 'Graduation protocol: promote → re-run ALL previous labs → every behavior change is a choice that really matters, surfaced for ruling (never silently patched) → THEN done. Compounds both ways: every existing lab benefits from future ground-floor improvements. Per-lab notes are what make "broken" detectable.',
    keywords: ['regression', 'lab corpus', 'graduation protocol', 'behavior break', 're-run', 'compound'],
  },
  {
    id: 'R1', name: 'Bullet (the library): KEEP, for clients — the game uses hmsc phys', status: 'ruled',
    ruling: 'Keep both physics backends; let the client decide ("client" = the consuming system, decided per use-case — not a network client). The GAME uses the hmsc phys, not Bullet. And "physics_lab.zig is a horrible name" — the honesty split/rename is confirmed urgent.',
    keywords: ['bullet', 'physics3d', 'dormant', 'delete', 'keep', 'rename', 'physics_lab.zig'],
    cites: ['framework/phys/physics3d.zig', 'framework/v8_bindings_physics_lab.zig'],
  },
  {
    id: 'R2', name: 'Projectile model: UNDECIDED — show-me lab owed', status: 'show-me',
    ruling: 'Geometric vs probabilistic shot paths: "someone needs to show me both", side by side. "This could be bullet tbh" — the projectile sim is a possible revival use-case for the Bullet library; include it as a third contender if it earns it. DO NOT canonize any projectile model yet.',
    keywords: ['projectile', 'bullets', 'shooting', 'shot path', 'geometric', 'probabilistic', 'gunfire', 'ballistics'],
  },
  {
    id: 'R3', name: 'Frame-loop hook shape: to be ruled BY A LAB', status: 'show-me',
    ruling: 'The user: "this is what labs are for and why we are doing what we are doing" — the difference between loop shapes and how other mechanics play into them is not knowable on paper. A loop-shapes lab joins the SHOW-ME queue; until it rules, the ground floor\'s loop API stays deliberately MINIMAL. Do not canonize a hook shape.',
    keywords: ['useGameLoop', 'frame loop', 'hook', 'raf', 'setTimeout', 'loop shape', 'loop lab'],
  },
  {
    id: 'R4', name: 'SCALE CONTRACT: 1 tile = 1 meter; player collider 1.65m, visual head-top ~2.04m', status: 'ruled',
    ruling: 'The world scale is SET: 1 tile = 1 meter. Player collider height = 1.65m (HMSC_SCALE.playerCapsuleHeightMeters, cart/hmsc/world/scale.ts:8). The ~2.04m in the scale labs is the VISUAL head-top (stylized-tall) — collider and visual are different layers, BOTH canonical; do not conflate them.',
    keywords: ['scale', 'meter', 'tile size', 'player height', '1.65', '2.04', 'collider', 'capsule', 'world scale', 'units'],
    cites: ['cart/hmsc/world/scale.ts'],
  },
  {
    id: 'R6', name: 'RLE/determinism is a gameplay-WIDE design value', status: 'ruled',
    ruling: '"Anything we can do to bring RLE design into the gameplay shape is key — determinism is fast, and a lot of things are heavily reused, not unknown." Extension of P1: represent repeated/known sequences as runs, not per-frame computation — animation, NPC schedules, traffic, ambient behavior.',
    keywords: ['rle', 'determinism', 'runs', 'reuse', 'schedules', 'compression', 'repeated'],
  },
  {
    id: 'R7', name: 'screenRay: proceed (internal dedup, no gameplay implication)', status: 'ruled',
    ruling: 'Export the generic screenRay from the cameras registry; three carts hand-rolled the same click-into-3D math. Pure code dedup.',
    keywords: ['screenRay', 'picking', 'click', 'ray', 'unproject'],
  },
  {
    id: 'V22', name: 'Design-session doctrine: mode presets, the opening, CaaS dailies, positions/occupants, replayability, behavioral cloning', status: 'ruled',
    ruling: 'Game modes are DISTRIBUTION PRESETS (the SAMP/VCMP verb space: role/rob/chase/evade/race/jump/accumulate — conditioning presets of V21, not new systems). The opening: sky-ramp dream → wake broke/high → fired → job hunt → delivery gig tutorial (unfair rating must cost visible money) → tweaker scare → Crime-as-a-Service. Protagonist is EVENT-SOURCED: no backstory, the apartment props the biography, PROTECT THE ZERO (no chosen-one reveal — the platform harvests, never recruits). CaaS dailies = LLM-generated mission ROWS over a closed schema: validator proves affordances against the queryable future, the V19 bot plays every daily headless first, the LLM never touches numbers (P2), narrative hooks are (text, world_delta) pairs, contracts bind PERSON (grievance) or POSITION (racket — re-arms vs replacements). World = roster of POSITIONS, people = seeded OCCUPANTS (Hitman model); vacancy is a world state with P2 refill curves. Replayability: maps are machines that produce runs; mission replay is diegetic; replays are V20 snapshot branches; failure degrades, never ends. Multiplayer latent via f(seed,t,log) lockstep. Behavioral cloning: dev/player movement traces extend the path-token vocabulary (validated headless by the NPC body; provenance tagged forever).',
    keywords: ['missions', 'daily', 'caas', 'crime as a service', 'llm missions', 'mission generator', 'schema', 'opening', 'intro', 'story start', 'backstory', 'protagonist', 'positions', 'occupants', 'hitman', 'vacancy', 'replay', 'replayability', 'game modes', 'verbs', 'ramps', 'stunt', 'multiplayer', 'behavioral cloning', 'player traces', 'desire paths', 'wanted', 'contracts', 'grievance', 'racket'],
  },
  {
    id: 'V23', name: 'Camera runtime: native host-side controller, V7 applied to camera', status: 'ruled',
    ruling: 'The camera registry ruling (V3/Q3) still stands: the rig vocabulary and reference math are the one camera system. Runtime ownership changes: JavaScript is transport and parameters; the host owns per-frame camera integration. Movement got this in V7; camera gets it here. JS sends rig parameters, mode changes, and input deltas only when they change. Zig holds active camera state, solves Orbit/Aim, smooths and interpolates every frame, and writes the existing Scene3D.Camera layout fields that gpu/3d.zig already consumes. The old declarative JS-props camera path remains valid for carts that do not explicitly engage the host controller.',
    keywords: ['camera', 'host camera', 'native camera', 'zig camera', 'V7 camera', 'scene3d camera', 'orbit', 'aim', 'ads', 'smoothing', 'interpolation', 'parameters', 'transport', 'per-frame integration', 'host-side controller'],
    cites: ['framework/game/camera.zig', 'runtime/cameras/', 'framework/gpu/3d.zig', 'framework/layout.zig'],
  },
  {
    id: 'V24', name: 'Map authoring: the BUILDING PIECE GRAMMAR — "minecraft but without the voxel"', status: 'ruled',
    ruling: 'Author by semantic piece. Bake by gameplay contract. Skin by catalog. Structural primitives (wall, floor, ramp/stairs, roof, pillar/corner, arch, fence, railing, trim, sign, prop) with MEANINGFUL edits (a WallEdit is solid/door/window/doubleWindow/brokenWindow/garageDoor/arch/halfHeight). Game meaning lives on the KIND ("a wall is always a wall"); variety lives in the CATALOG (style, material, theme downtown/motel/trap_lot/suburb/industrial, size, snap mode grid/edge/surface/free, gameplay tags: collision, blocksSight, blocksSound, cover, durability, climbable, vaultable, portal). The 1m grid is the SNAP SUBSTRATE for collision/pathing/cover — never the authored object model. Pieces bake into render geometry, collision boxes, cover faces, sound occlusion, room volumes, nav portals/blockers, destructible sections ("the authored object already knows what it means — a doorway knows it connects rooms"). PREFABS are first-class: a Prefab is a NAMED composition of placed pieces (with their edits) saved from the world into the palette as a placeable unit; prefabs DECOMPOSE to their semantic pieces — the bake sees through them (no opaque blobs); placing one is ONE authoring action, instance edits stay piece-granular; prefab defs are P2 data, same registry family as pieces. Three authoring modes COEXIST: Map Paint (exists), Build Mode (this ruling — expected primary), Voxel (VoxelHybridRoute stays as alternative); plus Prop Mode, Drop In (/test), Bake/Compile.',
    detail: 'User: "with the amount of fortnite i played and how simple it is for how expansive of the set you can create from it is minecraft but without the voxel"; "i have a feeling this [pieces] will be the most used shape because it fits too well"; prefabs: "i can just place basic walls, cut them out, make a building, then clone it into a tool, and go place it around. new building is just the same authoring as the last building, i physically make it in the game. then that just leaves props to prompting" (props remain prompt-generated assets — catalog prop entries fill from the items/model pipelines, not the builder). Tool-shape convergence: Fortnite Creative as the authoring UX, HMSC semantic bake as the runtime output. Build Mode UX: third-person camera (V23 native), crosshair targets a snap surface, category select, ghost preview snapped to grid/edge/surface, click places, edit key cycles variants/cutouts, props drop, bake emits runtime data. Partially answers the open W-2 world-rendering direction (TestRoute GAP lane): the bake direction, V4/V15/V19 harmonized. Evidence doc: docs/game/BUILDING-GRAMMAR.md.',
    keywords: ['building', 'build mode', 'piece grammar', 'building grammar', 'pieces', 'wall', 'floor', 'ramp', 'roof', 'pillar', 'arch', 'fence', 'railing', 'fortnite', 'minecraft', 'voxel', 'wall edit', 'WallEdit', 'door', 'window', 'snap', 'grid', 'catalog', 'theme', 'map authoring', 'build piece', 'BuildPieceKind', 'portal', 'cover', 'blocksSight', 'bake contract', 'authoring modes', 'ghost preview', 'prefab', 'prefabs', 'composition', 'clone', 'palette', 'decompose'],
    cites: ['docs/game/BUILDING-GRAMMAR.md', 'cart/hmsc-int/game/build/'],
  },
];
