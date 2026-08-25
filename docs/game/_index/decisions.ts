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
  amends?: string[];     // earlier verdicts this ruling overrules (part or whole)
  amendedBy?: string[];  // later verdicts that overruled part of this one — the
                         // oracle surfaces these LOUDLY beside the old ruling
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
    retires: ['cart/hmsc-int/render3d/humanoid/', 'cart/bodylab solveHumanoid', 'inline HUMANOID parts arrays in animation_lab/camera_lab/input_bench'],
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
    cites: ['cart/hmsc-int/world/tileKinds.ts', 'cart/hmsc_massive_map_lab.tsx (instancing proof)'],
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
    cites: ['cart/scape/systems/chance.ts', 'cart/hmsc-int/npc/systems/chance.ts', 'cart/combat_lab (coverFractionOf)'],
  },
  {
    id: 'V10', name: 'Vehicle: vehicle_lab is the source', status: 'ruled',
    ruling: 'vehicle_lab\'s VehicleDoc + buildVehicle + semantic VehiclePartId rig is the vehicle module — "this is where our models are coming from like head_lab". Scale not yet verified; many cars need work (ongoing, against the fixed 1-tile=1m contract). CarMeshes and the hmsc structure cars retire into it.',
    keywords: ['vehicle', 'car', 'cars', 'sedan', 'buildVehicle', 'VehicleDoc', 'wheels', 'driving'],
    retires: ['cart/ragdoll_lab/car.tsx CarMeshes', 'cart/hmsc-int/render3d/structures/Car.tsx'],
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
    id: 'V19', name: 'The compiled game is always green and LLM-callable', status: 'ruled',
    ruling: 'The authored/played compile is the data bake: `rjit game bake` and the hmsc-int Compile button write the platform game-file the no-V8 compiled route loads. This is the path the user actually plays; /test is not the bar. The old public `rjit game compile` name is retired. V19\'s command replay remains as a VERIFY HARNESS only: bundle harness → boot headless → replay command scripts → verdict. LLMs can run the bake/verify surface at any time — "make sure it compiles" is a standing duty, not a milestone gate. A feature is done when the COMPILED GAME carries it and the verify run proves it. GREEN HAS AN EXPLICIT MEANING: the entire testing surface is replayable all the time and DEEP — anything testable is scriptable. hmsc\'s console commands move into the tooling (game/commands/) and double as the test scripting language: a verify script is a saved command sequence replayed headless.',
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
    ruling: 'The world scale is SET: 1 tile = 1 meter. Player collider height = 1.65m (HMSC_SCALE.playerCapsuleHeightMeters, cart/hmsc-int/world/scale.ts:8). The ~2.04m in the scale labs is the VISUAL head-top (stylized-tall) — collider and visual are different layers, BOTH canonical; do not conflate them.',
    keywords: ['scale', 'meter', 'tile size', 'player height', '1.65', '2.04', 'collider', 'capsule', 'world scale', 'units'],
    cites: ['cart/hmsc-int/world/scale.ts'],
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
    ruling: 'Author by semantic piece. Bake by gameplay contract. Skin by catalog. Structural primitives (wall, floor, ramp/stairs, roof, pillar/corner, arch, fence, railing, trim, sign, prop) with MEANINGFUL edits (a WallEdit is solid/door/window/doubleWindow/brokenWindow/garageDoor/arch/halfHeight). Game meaning lives on the KIND ("a wall is always a wall"); variety lives in the CATALOG (style, material, theme downtown/motel/trap_lot/suburb/industrial, size, snap mode grid/edge/surface/free, gameplay tags: collision, blocksSight, blocksSound, cover, durability, climbable, vaultable, portal). The 1m grid is the SNAP SUBSTRATE for collision/pathing/cover — never the authored object model. Pieces bake into render geometry, collision boxes, cover faces, sound occlusion, room volumes, nav portals/blockers, destructible sections ("the authored object already knows what it means — a doorway knows it connects rooms"). PREFABS are first-class: a Prefab is a NAMED composition of placed pieces (with their edits) saved from the world into the palette as a placeable unit; prefabs DECOMPOSE to their semantic pieces — the bake sees through them (no opaque blobs); placing one is ONE authoring action, instance edits stay piece-granular; prefab defs are P2 data, same registry family as pieces. ONE MODEL, TWO VIEWS: the Sims-style Plan Build mode (architectural, above the world: floorplans/rooms/duplicate/mirror, "lay out ten buildings fast") joins Creative Build (embodied, player scale) — THE INVARIANT: "they must edit the same semantic data, not separate representations"; both are views over the same piece model (kind + gridPos + rotation + style + gameplayTags); piece tables may never assume a single camera/interaction mode. Mode taxonomy: Map Paint · Creative Build · Plan Build · Prefab Edit · Drop In · Compile; mode-switch = alt-tab instant action-bar strip (F1..F6) — "authoring itself becomes multiple playable camera modes over the same world. Not a separate editor app." SEMANTIC OVERLAYS: "pathing and triggers are not geometry. They are semantic overlays. Sims mode is basically the semantic overlay editor" — the WorldMarker union (path_node {pos,tags} · trigger {bounds,event} · room {polygon,role} · portal {fromRoom,toRoom,doorId?} · interest_point {pos,role: sit/work/shop/guard/smoke} · camera_marker {pos,target,shot}) is the THIRD data family beside pieces and prefabs; markers ANNOTATE the physical world by id; V21 NPC schedules/micro-path tokens consume authored semantic points (cashier counter, smoking spot, bus stop, staff door, apartment bed); RECONCILIATION LAW: where a marker overlaps a captured system (world trigger cells, mission markers, kinds cover/flow, cutscene shots) the marker is the AUTHORING representation baking into that system — never a second source of truth. Three world-authoring approaches COEXIST: Map Paint (exists), Build Mode (this ruling — expected primary), Voxel (VoxelHybridRoute stays as alternative).',
    detail: 'User: "with the amount of fortnite i played and how simple it is for how expansive of the set you can create from it is minecraft but without the voxel"; "i have a feeling this [pieces] will be the most used shape because it fits too well"; prefabs: "i can just place basic walls, cut them out, make a building, then clone it into a tool, and go place it around. new building is just the same authoring as the last building, i physically make it in the game. then that just leaves props to prompting" (props remain prompt-generated assets — catalog prop entries fill from the items/model pipelines, not the builder). Tool-shape convergence: Fortnite Creative as the authoring UX, HMSC semantic bake as the runtime output. Build Mode UX: third-person camera (V23 native), crosshair targets a snap surface, category select, ghost preview snapped to grid/edge/surface, click places, edit key cycles variants/cutouts, props drop, bake emits runtime data. Partially answers the open W-2 world-rendering direction (TestRoute GAP lane): the bake direction, V4/V15/V19 harmonized. Evidence doc: docs/game/BUILDING-GRAMMAR.md.',
    keywords: ['building', 'build mode', 'piece grammar', 'building grammar', 'pieces', 'wall', 'floor', 'ramp', 'roof', 'pillar', 'arch', 'fence', 'railing', 'fortnite', 'minecraft', 'voxel', 'wall edit', 'WallEdit', 'door', 'window', 'snap', 'grid', 'catalog', 'theme', 'map authoring', 'build piece', 'BuildPieceKind', 'portal', 'cover', 'blocksSight', 'bake contract', 'authoring modes', 'ghost preview', 'prefab', 'prefabs', 'composition', 'clone', 'palette', 'decompose', 'plan build', 'sims', 'overlay', 'semantic overlay', 'marker', 'WorldMarker', 'room', 'trigger', 'interest point', 'patrol', 'service point', 'camera marker', 'authoring modes strip'],
    cites: ['docs/game/BUILDING-GRAMMAR.md', 'cart/hmsc-int/game/build/'],
  },
  {
    id: 'V25', name: 'Pinned conventions beat legacy behavior, always (DRAGSIGN-0605)', status: 'ruled',
    ruling: '"It always existed" is NEVER a defense for keeping a divergent behavior. When a captured surface conflicts with a USER-VERDICT-pinned behavior, the pin wins — capture fidelity applies to capabilities, not to contradictions of rulings; surfacing the conflict is right, the resolution is always the pinned convention. Applied here: ONE camera drag convention everywhere — the /test-pinned -dx family (yaw DECREASES with a rightward drag: TestRoute, CharactersRoute, and now VehiclesRoute; the lab\'s legacy +dx was divergence, not design). Tuning values (per-pixel rates, clamps) stay per-surface P2 data; the SIGN is a pinned convention, not tuning.',
    detail: 'User, verbatim: "the one note the one worker said about \'this always existed, it just surfaced\' yeah that doesnt mean it was right, that is exactly why we are doing this, there was once before no cohesive place of everything, so there was 30 different camera approaches effectively." The ground-floor rebuild exists precisely because there were ~30 camera approaches; faithfully capturing a divergence re-creates the disease the rebuild cures.',
    keywords: ['drag sign', 'dragsign', 'drag direction', 'orbit drag', 'yaw sign', 'camera convention', 'pinned convention', 'legacy behavior', 'divergent behavior', 'capture fidelity', 'it always existed', 'one convention', 'vehicles drag', 'drag flip', 'convention beats legacy'],
    cites: ['cart/hmsc-int/editors/vehicles/VehiclesRoute.tsx', 'cart/hmsc-int/editors/characters/CharactersRoute.tsx'],
  },
  {
    id: 'V26', name: 'JS viewport cameras are dead app-wide; V23 native is the only viewport drive (CAMNUKE-0605)', status: 'ruled',
    ruling: 'Every live 3D viewport in hmsc-int is V23 native-driven: per-node Scene3D.Camera nativeCamera binding plus GAME_NATIVE_CAMERA.forNode(nodeId). JavaScript sends rig parameters, mode changes, and input deltas on change; Zig owns per-frame solve, smoothing, interpolation, and renderer-consumed camera fields. JS viewport driving is retired: no route, preview, lab surface, object inspector, assistant viewport, or voxel editor may compute the per-frame view in JavaScript and push Scene3D.Camera position/target/fov updates. Replaced JS camera code is deleted, with no fallback or commented compatibility. V3/V16/V23 registry semantics remain law: camera types, cinematic/cutscene shot vocabulary, pure rig solves, screen rays, and boot-frame reference solves stay in the registry; the target is JS viewport DRIVING, not semantic camera math.',
    detail: 'User, verbatim: "voxel editor route has the wrong camera approach, which means the worker needs to identify the correct one (its on the test route right now) and from there find all other cameras that are not this approach and nuke them im tired of running into not the game camera every other turn" and "dont mistake this for the cinematic camera and the camera types i just mean this dogshit javascript camera is ass. it just lags."',
    keywords: ['CAMNUKE', 'camera nuke', 'JS camera', 'javascript camera', 'viewport camera', 'native viewport', 'V23 native', 'nativeCamera', 'Scene3D camera', 'voxel camera', 'orbit camera', 'camera lag', 'per-frame camera', 'host camera', 'no JS viewport driving'],
    cites: ['cart/hmsc-int/game/nativeCamera.ts', 'framework/game/camera.zig', 'cart/hmsc-int/TestRoute.tsx', 'cart/hmsc-int/VoxelHybridRoute.tsx'],
  },
  {
    id: 'V27', name: 'Performance diagnostics are switchable runtime channels, aggregate-only on hot paths (PERFLOG-0605)', status: 'ruled',
    ruling: 'Performance logging is one GAME_TELEMETRY diagnostics system: channels are off by default, disabled-channel cost is only the boolean branch, and enabled hot-path logging aggregates over a throttle window before structured JSONL output. Per-call synchronous prints are banned because CAMSTUTTER proved they can create user-visible stutter. Runtime control goes through the V19 command vocabulary: log status, log all on|off|toggle, log <channel> on|off|toggle, log dump, log overhead, and compatibility aliases such as gv_perflog. Toggle metadata is exposed as settings-ready values. Coverage channels include frame, tick, physics, camera, figure, worldStream, bridge, draw, capture, hmr, pools, churn, and spikes; source-owned subsystems record through the telemetry door, with future hooks tracked as hand-offs instead of local print probes.',
    detail: 'User, verbatim: "i want someone to hook up some logging methods on anything and everything that we can switch on the moment performance starts eating shit and get logs, dont have to wait around with our dicks in our hands to figure it out. so we want effectively all the data we can capture in the event its needed."',
    keywords: ['PERFLOG', 'performance logging', 'diagnostics', 'diagnostic channels', 'runtime logging', 'log command', 'log status', 'log dump', 'log overhead', 'gv_perflog', 'telemetry', 'JSONL', 'aggregate logging', 'throttled probes', 'frame timing', 'physics step', 'camera solve', 'bridge traffic', 'world stream', 'churn', 'spikes'],
    cites: ['cart/hmsc-int/game/telemetry.ts', 'cart/hmsc-int/game/commands/vocabulary.ts', 'cart/hmsc-int/perfLog.ts'],
  },
  {
    id: 'V28', name: 'Platform/mod split: a STATELESS ZIG ENGINE, a game is DATA — Compile bakes 3 RLE streams, a Zig loader constructs the game (PLATMOD-0607, loader corrected 2026-06-08)', status: 'ruled',
    ruling: 'Three lifetimes, three layers: framework/+runtime/ = the platform tier — a STATELESS ZIG ENGINE whose core capabilities (camera, movement, physics, rendering of pieces/textures/models/map, behaviors incl. NPC AI + the 45-tick system) ALREADY EXIST in Zig and are stateless BY DESIGN, taking DATA and running it (user: "all of the capability already exists in zig, it just is \'stateless\' by design"); it owns the versioned GAME-AGNOSTIC RLE data format (V29) and never knows what a map is FOR. The world systems (pathing, perception, physics, figures, vehicles, materials) are the base-game/SDK tier and hmsc-int is the platform\'s editor (its Hammer/Studio). hmsc is the FIRST MOD — entity semantics, the GameState schema, and the changelevel contract, all expressed AS DATA. A GAME IS DATA: shape = { buildings[], textures[], map[], models[], data:[[[…]]] } — an asset vocabulary plus an RLE tape composing them BY REFERENCE (piece→shape→position→face-materials), and that tape IS the state fed to the stateless capabilities. The Compile button does THREE bakes each → RLE: (1) game logic, (2) game map, (3) custom items/skins; the loader "takes in all the data, constructs the game from it". TWO PATHS: /test route = the DYNAMIC dev env; SHIP path = baked RLE + Zig loader, NO JS. CLARIFICATION req_4745: the forbidden seam is HOT-LOADED CODE RIDING IN GAME DATA — no map, prop, model, or game-data bundle may bring a script/interpreter into someone else\'s game space. Trusted pre-compiled per-game simulation and adapter code is allowed as part of a reviewed binary; for editor-exported games it is Zig under framework/games/custom/, with no hand-authored per-game React output app. A missing data-driven capability extends the engine; code never rides the loaded asset. Second-mod test: a different game = DIFFERENT DATA on the shared framework, while a different compiled game may lawfully select different trusted compiled simulation capabilities.',
    detail: 'User, verbatim: "it would be silly to only retain it in a means for a one off game … but its just a \'mod\' on the underlying game engine we are making"; tier: "roblox/gmod esque". CORRECTION 2026-06-08 (req_0287): V8-host-as-client was a worker interpretation contradicting "dropping off the javascript". CLARIFICATION 2026-08-25 (req_4745, composed with req_4762): "no per-game code" targets executable code hidden in hot-loaded data, not reviewed pre-compiled per-game code. Fart Racer\'s allowed compiled Zig sim is emitted/linked by the editor export path; a separately authored React cart is not.',
    keywords: ['platform', 'mod', 'roblox', 'gmod', 'engine', 'stateless engine', 'stateless zig', 'game is data', 'rle data', 'rle tape', 'zig loader', 'loader', 'three streams', 'three bakes', 'compile button', 'logic to rle', 'map to rle', 'items skins to rle', 'asset vocabulary', 'by reference', 'first mod', 'second mod test', 'data format ownership', 'opaque data', 'hammer', 'studio', 'sdk tier', 'base game', 'ship', 'dropping off javascript', 'no js', 'no hot-loaded script', 'pre-compiled per-game code', 'compiled zig', 'framework games custom', 'extend the engine', 'test route dynamic', 'ts tsx to rle to zig to play', 'counter-strike', 'half-life', 'req_4745', 'req_4762'],
    cites: ['cart/hmsc-int/', 'tools/rjit', 'runtime/workspace/rle.ts', 'docs/game/PLATMOD_PLAN.md'],
  },
  {
    id: 'V29', name: 'Map format: bake-by-execution → content-addressed installable assets; mapfile = bundle of binary-RLE reference lumps; Apriori pattern mining from v1; NO runtime dynamic shapes (MAPFORMAT-0607)', status: 'ruled',
    ruling: 'Current TS authoring catalogs are baked by EXECUTION, never static analysis: while the legacy TSX def()/pieces/prefab catalogs still exist, the compile executes them in V8 and snapshots output as installable assets (retires the bake-geometry-auto literal-scanner direction). Clarification 2026-06-30: TypeScript prop/item/vehicle files are transitional authoring catalogs; their baked DATA remains relevant, but those TS-file asset sources phase out in favor of Studio mesh-editor models, world terrain/heightfields, authored buildings/pieces, and UV-unwrapped player/figure models. Assets are CONTENT-ADDRESSED (hash ids): idempotent installs, cross-map dedup, no version drift. A mapfile is a BUNDLE: [assets to install] + [reference-grid lumps of small-int indices into a string-table] + [entity keyvalues]; install/validate first, then the body is pure references (the reference list doubles as the dependency manifest); map-local authored content rides an embedded PAK lump — referencing is the default, embedding the exception. Container: BSP-style versioned lump directory (magic, lump table with per-lump encoding raw|rle8|rle16|text, 8/16B alignment, unknown lumps SKIPPED). Codec: binary row-RLE — the SAME scheme as runtime/workspace/rle.ts; the editor\'s JSON row-RLE stays the SOURCE format (.vmf), Compile transcodes to binary (count,value) pairs (.bsp) — JSON.parse was the bottleneck, never the RLE ("rle is fast as shit, something like 26gb/s"). Heightfields quantize u16+scale/offset then RLE; MESHES are raw aligned f32 (floats don\'t run — layout IS the speed); ENTITIES are text keyvalues opaque to the platform. APRIORI MINING IS IN FROM V1: compile mines frequent k×k grid windows into a pattern dictionary (ITSELF an installable shared asset, amortized across maps), grid becomes pattern stamps + RLE residual — expected to rediscover the road grammar from paint. Win hierarchy: reference-not-embed → sparse default chunks → pattern dictionary → palette indexing → RLE; general compression INSIDE the format rejected — compress for TRANSPORT (whole-blob lz4/zstd), lay out for RUNTIME. NO RUNTIME DYNAMIC SHAPES: dynamism = transforms/instance params, shader data[] uniforms, or runtime-authored content INSTALLING as a new asset (GMod-dupe model); per-frame geometry is a framework effect system, never a map concern.',
    detail: 'User, verbatim core: "you author some code to make a shape in the same approach we are doing now, that bakes into a referencable shape, a mapfile is a bundled set, that installs its assets to the game first, so that the map that comes with it can just be rle reference … letting us get a huge map and then using Apriori mining to reduce from it being our compile setup for the rle"; scale thesis: "what looks like a huge map is just a really small set of re-referenced shape" — literally the Vice City architecture (IDE definitions + IPL placement lists + shared TXDs, a city in 32MB PS2 RAM); our roster=IDE, compiled reference grid=IPL. This is R6 + P1 applied to the world; the mapfile is V20\'s compile-consumed snapshot in platform format. Prior evidence for the no-dynamic-shapes rule: the geometry-intern OOM → "unit params + scale transform".',
    keywords: ['map format', 'mapfile', 'lump', 'lumps', 'bsp', 'rle', 'binary rle', 'row-rle', 'rle8', 'rle16', 'string table', 'reference grid', 'installable assets', 'content addressed', 'hash id', 'install', 'asset store', 'pak', 'pakfile', 'manifest', 'dependency manifest', 'apriori', 'pattern mining', 'pattern dictionary', 'frequent patterns', 'palette index', 'sparse chunks', 'default value', 'quantize', 'heightfield lump', 'transcode', 'vmf', 'compile button', 'bake by execution', 'no dynamic shapes', 'transport compression', 'lz4', 'zstd', 'vice city', 'ide ipl', 'txd', 'reuse', 're-referenced shapes'],
    cites: ['runtime/workspace/rle.ts', 'cli/commands/bake-geometry-auto.ts', 'cli/commands/bake-geometry.ts', 'cart/hmsc-int/chunkFloor.ts'],
  },
  {
    id: 'V30', name: 'Maps, changelevel, and the frozen world: one citywide map + interior maps; persistence by DERIVATION; activation = engaged ∪ zone ∪ tile-distance ∪ VIS (FREEZE-0607)', status: 'revised',
    amendedBy: ['V34'],
    ruling: '⚠ AMENDED by V34 (ONEMAP-0815): the map-split half below is OVERRULED — one map, interiors in it, no changelevel; the frozen world / activation predicate / derivation halves stand. ORIGINAL RULING: The outdoor city is ONE citywide map, never subdivided; interiors are SEPARATE MAPS entered Vice City-style (marker → loading → new building; the mall is a map in itself; only trivial storefront-class walk-ins may live inside the city map). Doors/markers = changelevel: the world swaps wholesale under a persistent game state; interiors not entered are NOT LOADED. Persistence across changelevel is DERIVATION, not serialization: global state (clock, weather, heat, perturbation log, player, tenured NPCs) is map-independent and always live; the place you left RE-DERIVES on re-entry from f(seed, t, log) (V21\'s stateless-ambient law doing the persistence work) — everything persists semantically, almost nothing serializes at the boundary. THE FROZEN WORLD: the unseen world is FROZEN, not slowly simulated — an offline NPC is a STATE ROW (no behavior/perception/pathing); behaviors like npc-vs-npc fights are LATENT DISPOSITIONS (editor-authored entity data) that MATERIALIZE on activation, hydrating MID-ACTION (come online already fighting); the V8 tick + event channel are the only movers of frozen state. ACTIVATION PREDICATE (pure LoS rejected by the user): active = engaged ∪ zone ∪ tile-distance ∪ VIS — distance bubble keeps around-the-corner traffic moving; zone containment keeps a whole building active while you\'re inside regardless of walls; the VIS lump is Compile-precomputed chunk-to-chunk potential visibility and ONE oracle serves renderer culling, NPC FoV/witness perception, and audio occlusion; ENGAGED pins alerted/hunting/witness NPCs online until perception decays. Promotion instant, demotion hysteretic. Residency ladder: interior not entered = UNLOADED → all-default chunk = NONEXISTENT → outside predicate = FROZEN ROWS → inside predicate = FULL BEHAVIOR. Compute O(active bubble), constant in city size — this is how V4\'s Vice City scale is paid for.',
    detail: 'User, verbatim: "the whole point of the tile system and the line of sight is that we dont have to make anything we cant literally see active"; "npc activity only has to progress a state in the immediate LoS so effectively the world around the player stays still … none of that needs to occur until the player is directly in LoS of that other NPC"; the refinement: "LoS + tile distance + zone, we dont want an npc to go inactive just because we are hiding behind a wall in their house. or we dont want the most immediate roads traffic to be at a stall just because we have not made the turn around the building yet"; persistence: "everything really. but you dont need to reserialize the entire world state. you just need whats relevant of the world in the current place. like ok say its raining outside, you enter building, the rain is no longer happening inside, but if you go right back outside its still there, but if u wait inside long enough time passes and the rain can go away". Precedents: STALKER A-Life online/offline + switch_distance; GTA traffic bubble; qbsp/vis.',
    keywords: ['changelevel', 'interior', 'interiors', 'loading screen', 'marker', 'door', 'mall', 'one map', 'citywide', 'vis', 'vis lump', 'pvs', 'potential visibility', 'visibility oracle', 'frozen world', 'offline npc', 'state row', 'latent disposition', 'hydrate', 'mid-action', 'activation predicate', 'engaged', 'zone', 'tile distance', 'switch distance', 'residency', 'residency ladder', 'active bubble', 'promotion', 'demotion', 'hysteresis', 'persistence', 'derivation', 'rain', 'weather', 'stalker', 'a-life', 'traffic bubble', 'witness pinned', 'audio occlusion'],
    cites: ['docs/game/DECISIONS.md (V8, V21)', 'cart/combat_lab (perception ladder)'],
  },
  {
    id: 'V31', name: 'Compile cache: manifests over content-addressed compiled chunk artifacts (CACHE-0630)', status: 'ruled',
    ruling: 'Every Compile emits an immutable manifest that reconstructs the compiled world from content-addressed compiled chunk artifacts and global summary lumps. Each chunk overview carries coord, content-hash validation string, dependency/source hashes, edge signatures, byte length, summary hash, and local version pointer. Exact hash match means reuse the cached artifact and assemble without deep chunk revalidation; mismatch means stale/corrupt/different inputs, so rebuild or retain the prior valid artifact. Accepted rebuilds emit a new validation hash and bump only that chunk\'s local version. The hash is authority; the version is human/history ordering. Compiled chunk history is first-class: restoring an area creates a new manifest that points that chunk overview at an older valid chunk hash/version, then dirties only affected neighbors/global summaries. V20 streams remain source/audit history, but compiled chunk history is the practical restore surface for map-direction changes. Chunks are cache/streaming/compile units inside V30\'s one citywide map, not changelevel maps; "glue together" means manifest assembly through the game-file lump/index system, never blind byte concatenation.',
    keywords: ['compile cache', 'manifest', 'compile manifest', 'chunk overview', 'chunk hash', 'content addressed chunk', 'validation string', 'local version', 'chunk version', 'version history', 'local version history', 'compiled chunk history', 'restore chunk', 'dirty chunk', 'cache state', 'incremental compile', 'manifest swap', 'merkle', 'chunk artifact', 'global summaries', 'edge signature', 'cache hit', 'rebuild chunk', 'compile button'],
    cites: ['docs/game/COMPILE_CACHE_ARCHITECTURE.md', 'runtime/workspace/rle.ts', 'cart/hmsc-int/chunkFloor.ts'],
  },
  {
    id: 'V32', name: 'The ACTIVE SURFACE is cart/editor; hmsc-int is previous-era reference (SURFACE-0705)', status: 'ruled',
    ruling: 'Everything going forward is specific to cart/editor/ (the editor + its /play route — the "Shitty Games" foundation). cart/hmsc-int/ and the labs are the PREVIOUS ERA: reference and history, not the build site — a pointer into cart/hmsc-int/ answers "how did the last era do it", never "where does this feature go". Game-DESIGN rulings in this constitution (tile world, frozen world, map format, platform/mod split, …) still stand regardless of era — they are about the GAME, not which cart hosts it. The oracle is enforced for BOTH CLIs and is era-aware: every result opens with the ACTIVE SURFACE banner, and index records whose pointers land in the previous era carry an explicit hmsc-era flag.',
    detail: 'User, verbatim: "codex still always uses the oracle but claude doesnt. and to be honest the oracle diverts codex a lot because it still at large points at hmsc-int when everything that we are going forward with is now specific to @cart/editor/ … either silence the oracle codex searches or enforce it for both but tidy it up, which the 2nd option i think is better, since claude gets by quite well without it".',
    keywords: ['active surface', 'cart/editor', 'editor cart', 'shitty games', 'hmsc-int era', 'previous era', 'going forward', 'build site', 'where does this go', 'which cart', 'oracle enforced', 'era flag', 'surface'],
    cites: ['cart/editor/', 'cart/hmsc-int/ (previous era, reference only)', 'docs/game/_index/oracle.ts (the banner + era flag)'],
  },
  {
    id: 'V33', name: 'Model semantics are RIGGING DATA: named regions ride the saved blob, because skinning reads them (SEMBLOB-0801)', status: 'ruled',
    ruling: 'Semantic region names on a model are not agent scratch memory — they are authoring input to the RIG. Naming every surface is what makes auto-skinning from a UV tractable: a mesh that arrives with named surfaces is far cheaper to skin than one that arrives as anonymous faces, because the names already carry the part meaning a rig would otherwise have to infer. Therefore the semantic table must PERSIST INTO THE MODEL BLOB, not live only as host state that a cold restart drops. Two standing consequences: (1) any model-persistence work (meshdoc / blob save + load) carries the semantic table through as in-scope, never optional; (2) any authoring surface that creates geometry — the Agent Seat, the outliner, importers, primitive adds — names what it creates at the moment it creates it, because a name reconstructed later from normals is a guess. An op that resets or drops the semantic table is a BUG, not a cost of doing business (see the Agent Seat add-verb table wipe, req_3588, and its part-range twin req_3465).',
    detail: 'User, verbatim (req_3588, 2026-08-01): "the more important reason to actually annotate the semantics into the actual blob long term is for skinning them, if you end up naming everything, then skinning from a uv is much less up in arms." Ruled into the constitution on req_3590 after the assistant first filed it as informal "direction" in a memory + skill doc — the user\'s correction, verbatim: "bro what the oracle is for the shit i dont need to reexplain over and over again, by not doing it now, your going to make it end up there by the next time you call it." State at ruling time: names are LIVE-ONLY host state (__mesh_semantic_state / __mesh_semantic_assign) and do NOT ride the saved blob — the persistence half is owed, not built.',
    keywords: ['semantics', 'semantic table', 'named regions', 'naming', 'skinning', 'auto-skin', 'rig', 'rigging', 'uv', 'blob', 'meshdoc', 'persist', 'save model', 'agent seat', 'outliner', 'part names', 'region names'],
    cites: ['cart/editor/agent/seatApi.ts (the semantic table)', 'cart/editor/data/meshDoc.ts (the blob that must carry it)', 'req_3588 · req_3590 · req_3465'],
  },
  {
    id: 'V34', name: 'ONE MAP: interiors live inside the citywide map — no changelevel, no teleport (ONEMAP-0815)', status: 'ruled',
    amends: ['V30'],
    ruling: 'AMENDS V30: the map-separation half is overruled. ONE world map — building interiors (every storey, the mall included, not just the storefront class) are real authored geometry inside the citywide map; walking through a door is walking through a door — no marker, no loading screen, no map swap. GONE: the Vice City changelevel model, separate interior mapfiles, the "interior not entered = UNLOADED (changelevel)" residency tier, the lobby-as-changelevel split for mixed-use buildings. STANDS (now doing MORE work): the frozen world, the activation predicate (engaged ∪ zone ∪ tile-distance ∪ VIS), hysteretic demotion, derivation-not-serialization, and the remaining residency ladder (sparse NONEXISTENT → FROZEN ROWS → FULL BEHAVIOR) — interior cost is paid by RESIDENCY, not map boundaries: VIS keeps indoor chunks dark from the street, zone containment keeps a building live while you are inside, an unentered tower floor is frozen/sparse chunks of the one map. CONSEQUENCES: floor plans are paramount — interiors are world geometry authored up front (the lot-plan lane); inside/outside reads (rain under a roof) derive from geometry/zones, never map identity; V29 mapfile machinery stands but describes ONE bundle. The amendment mechanism is the point: the constitution takes foundational rulings early and AMENDMENTS as the game matures — an amended ruling stays in the record with an explicit AMENDED-by marker and the oracle surfaces the amendment beside the old ruling.',
    detail: 'User, verbatim (req_4525): "we do not seperate the maps anymore. everything is and will be in the same one big map, no teleporting when going inside, so thats why i say its a lot more paramount to have proper floor plans than it may seem". Same message ruled that the oracle needed first-class amendment support ("the intention of it was to be for me to set up some foundational ruling in the early stages and as time goes on ammendments to be made").',
    keywords: ['one map', 'single map', 'interior', 'interiors', 'changelevel', 'teleport', 'loading screen', 'no loading', 'building interior', 'walk inside', 'door', 'lobby', 'mall', 'floor plan', 'floor plans', 'lot plan', 'apartment', 'mixed use', 'residency', 'vis', 'zone', 'frozen world', 'amendment', 'amend', 'overruled', 'citywide'],
    cites: ['docs/game/DECISIONS.md (V30, V34)', 'docs/game/LOT_PLAN_GUIDE.md', 'cart/editor/world/lotPlan.ts', 'req_4525'],
  },
  {
    id: 'V35', name: 'Model documents carry declarative advisory blueprints; the model owns author intent and the game owns simulation (BLUP-0825)', status: 'ruled',
    ruling: 'RJMD model documents may carry versioned, namespaced, declarative blueprints: base values, physical properties, profile/stat attachments, templates, requirements, affordances, progression rules, audio event associations, and opaque vendor extensions. They are ADVISORY author intent. A receiving game may consume, remap, scale, report, or ignore them; runtime state never enters the shared model. Nothing in an asset executes: no expression grammar, callbacks, bytecode, embedded script, or interpreter. Typed values are structurally validated; unknown namespaces are preserved verbatim as opaque JSON and never dispatched. Standard namespaces are rj.core.*, rj.physics.*, and rj.profile.*; vendor data uses reverse-DNS names. Profiles evolve append-only within a major version; reinterpretation or redistributed authority requires a major bump. Every consumer emits an application report (adopted / normalized / ignored-by-policy / unknown-preserved / defaulted). Tuning a stat is a document edit and data repackage, never a Zig rebuild unless an engine capability changed. v1 scopes are document and durable object id; deeper semantic/material/contact-rig scopes land with real consumers.',
    detail: 'The model owns the blueprint; the game owns the simulation. User-ratified threat model req_4746 is the Workshop-RAT failure: code hidden inside complex asset blueprints is forbidden by construction. req_4745 clarifies trusted pre-compiled game code is separate from hot-loaded asset code; req_4762 requires the editor\'s in-app Compile → Package → Export path and forbids a hand-authored React output cart. Wording was ratified by the user\'s request to execute docs/game/MODEL_BLUEPRINTS.md.',
    keywords: ['blueprint', 'model blueprint', 'portable stats', 'model stats', 'RJMD', 'advisory data', 'author intent', 'simulation state', 'no interpreter', 'no expression grammar', 'no executable assets', 'workshop RAT', 'namespaced stats', 'vendor extension', 'opaque preserved', 'rj.core', 'rj.physics', 'rj.profile', 'profile versioning', 'application report', 'adopted', 'normalized', 'ignored by policy', 'defaulted', 'document scope', 'object scope', 'tuning without rebuild', 'BLUP-0825'],
    cites: ['docs/game/MODEL_BLUEPRINTS.md', 'cart/editor/model/blueprintTable.ts', 'framework/gpu/contact_rig.zig', 'req_4744 · req_4745 · req_4746 · req_4760 · req_4762'],
  },
];
