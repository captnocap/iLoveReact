import type { DocIndex } from '../types';

export const scape: DocIndex = {
  name: 'scape',
  file: 'scape.md',
  cart: 'cart/scape/',
  purpose: ['world_gen', 'rendering', 'shader', 'interaction', 'chance', 'perception', 'agent_llm', 'item'],
  loc: 3750,
  summary:
    'The 2D GTA x Hitman x RuneScape x Schedule-1 sandbox game proper, and the repo canonical world-as-one-shader-quad cart: the entire rotating city is painted by a single Effect fragment shader reading one flat f32 array while React holds only the player sprite and screen-space chrome.',
  interfaces: [
    {
      name: 'index.tsx (composition root)',
      purpose: ['ui', 'rendering'],
      kind: 'module',
      sourceFile: 'cart/scape/index.tsx',
      description:
        'Wires useQuestChat -> useScapeWorld -> createScapeFrame -> five surfaces (ground Effect, Player, Hud, PlayerDebug, ActionMenu, QuestChatPanel). 55 lines, nothing else lives here.',
      dependsOn: ['useScapeWorld', 'createScapeFrame', 'useQuestChat'],
      status: 'live',
    },
    {
      name: 'design.ts',
      purpose: ['format', 'persistence'],
      kind: 'data_model',
      sourceFile: 'cart/scape/design.ts',
      loc: 521,
      description:
        'Types only, zero runtime  the full data contract for the eventual game. Spine shapes: Suspicion (5 evidence axes 0..100), VisualSignature (silhouette + garment color + accessory). Conventions: XType = authored registry data, X = live instance. Player.notoriety guaranteed a pure function of Suspicion; HighState separates ground-truth intensity from derived pressures; ChanceBreakdown makes every hit-% legible; PerceptionOverlay lets the UI lie without the sim lying. Most of it has no consumers yet (contract-first).',
      status: 'candidate',
    },
    {
      name: 'Suspicion',
      purpose: ['perception', 'format'],
      kind: 'data_model',
      sourceFile: 'cart/scape/design.ts',
      description:
        'The five-way trace vector: visual/fund/pattern/digital/location, each 0..100  the player TRUE generated evidence. The world lagging belief lives separately on the (not yet implemented) Case.',
      status: 'live',
    },
    {
      name: 'VisualSignature',
      purpose: ['perception', 'format', 'character'],
      kind: 'data_model',
      sourceFile: 'cart/scape/design.ts',
      description:
        'silhouette + garment color + accessory  what witnesses remember, what costumes present, what burned disguises match against. The unit of recognition for the whole detective loop. Declared; witnessing not implemented.',
      status: 'candidate',
    },
    {
      name: 'citymap.ts',
      purpose: ['world_gen'],
      kind: 'module',
      sourceFile: 'cart/scape/world/citymap.ts',
      description:
        'The hand-authored city, explicitly no procgen. 52x44 Int16Array; rectangle stamps then building stamps. Packed tile encoding: bits 0-2 kind, 3-5 height tier (8 HEIGHTS 1.6-4.4), 6-8 facade style. Buildings are solid Wall volumes with one carved Door tile each; CITY_DOORS seeds runtime door objects. Hand-placed props in a Map keyed by tile.',
      emits: ['CITY_DOORS'],
      status: 'live',
    },
    {
      name: 'tiles.ts',
      purpose: ['world_gen'],
      kind: 'module',
      sourceFile: 'cart/scape/world/tiles.ts',
      description:
        'Thin facade re-exposing citymap through the legacy Kind/decor names. The Kind enum duplicates citymap T enum verbatim; a compat facade to fold when convenient.',
      dependsOn: ['citymap.ts'],
      status: 'deprecated',
    },
    {
      name: 'projection.ts',
      purpose: ['camera', 'math'],
      kind: 'module',
      sourceFile: 'cart/scape/world/projection.ts',
      description:
        'The camera math: yaw rotation + pitch as a y-squash (TILE_PX=30). project/unproject are exact inverses, plus hazeOpacity (fade 15->24 tiles). Must stay in lockstep with the WGSL twin in ground.wgsl.ts.',
      status: 'live',
    },
    {
      name: 'window.ts',
      purpose: ['rendering', 'world_gen'],
      kind: 'module',
      sourceFile: 'cart/scape/world/window.ts',
      description: 'The streaming window: WIN=56 packed tiles around the player, HEADER=16 floats, MAX_SPRITES=180.',
      status: 'live',
    },
    {
      name: 'pathfinding.ts',
      purpose: ['pathing', 'ai_navigation'],
      kind: 'module',
      sourceFile: 'cart/scape/world/pathfinding.ts',
      description:
        'Plain A* over tiles: 8-directional with corner-cut prevention, goal clamped to 48 tiles, nearestWalkable spiral fallback, 6000-node expansion cap. Blockers = water/walls/void + props + a caller-supplied key set (closed doors).',
      status: 'live',
    },
    {
      name: 'player.ts',
      purpose: ['character', 'physics'],
      kind: 'module',
      sourceFile: 'cart/scape/state/player.ts',
      description:
        'ScapePlayerState = Cam & { body: Player; path }. computeNotoriety = weighted blend (visual x1.5, fund x0.8) normalized 0..100  blend not max, so spread heat is cheaper than one spiked axis (a deliberate strategy choice). advancePlayer follows the path at 4.2 tiles/s and decays high at 0.12/s. The high machinery: derivePhase, recomputeHigh.',
      status: 'live',
    },
    {
      name: 'useScapeWorld',
      purpose: ['game_loop', 'input', 'interaction'],
      kind: 'hook',
      sourceFile: 'cart/scape/state/world.ts',
      loc: 559,
      description:
        'The hub. Owns every ref (sim, entities, inventory, doors, clock, keys, examine toast, menu), the rAF-guarded loop (useWorldLoop: clock, A/D yaw + W/S pitch, path-following, NPC wander, render trigger), keyboard (useSceneControls on __keydown/__keyup; H = bump high, Q = drop in-hand; input gated off while chat open via chatOpenRef), left-click resolution, right-click -> menu, and runAction (the verb switch including shoot/slash).',
      consumes: ['__keydown', '__keyup'],
      dependsOn: ['pathfinding.ts', 'actions.ts', 'chance.ts'],
      status: 'live',
    },
    {
      name: 'clock.ts',
      purpose: ['game_loop'],
      kind: 'module',
      sourceFile: 'cart/scape/state/clock.ts',
      description:
        'GTA cadence: 1 game-minute per real-second (24-minute day), starts at 20:00 dusk. clockHM feeds the night penalty in chance.ts.',
      status: 'live',
    },
    {
      name: 'interactions.ts',
      purpose: ['interaction'],
      kind: 'module',
      sourceFile: 'cart/scape/systems/interactions.ts',
      description:
        'The verb catalog (walk/examine/talk/pickup/drop/open/close/loot/shoot/slash) + PROXIMITY_RANGE bands (adjacent 1.7 / near 2.4 / any). Pure data; effects live in world.ts, applicability in actions.ts.',
      status: 'live',
    },
    {
      name: 'availableActions',
      purpose: ['interaction', 'chance'],
      kind: 'utility',
      sourceFile: 'cart/scape/systems/actions.ts',
      description:
        'The pure function behind the action menu. availableActions(target, ctx) over target kinds npc/storefront/sign/door/item/prop/tile. Blocked rows carry reasons; every menu ends with Walk here. attackOption builds the weapon row from the held item RangeProfile.',
      dependsOn: ['attackChance', 'interactions.ts'],
      status: 'live',
    },
    {
      name: 'attackChance',
      purpose: ['chance', 'damage'],
      kind: 'utility',
      sourceFile: 'cart/scape/systems/chance.ts',
      description:
        'The X-COM percent-to-hit engine (scape own, distinct from hmsc). Multiplies base x range-falloff x LoS x cover(0.65) x awareness x health(0.7+0.3h) x night(0.82 ranged) x skill(0.6+0.8c), clamped [0.02, 0.98]. Emits a ChanceBreakdown explaining every multiplier.',
      dependsOn: ['lineOfSight'],
      emits: ['ChanceBreakdown'],
      status: 'live',
    },
    {
      name: 'lineOfSight',
      purpose: ['chance', 'perception'],
      kind: 'utility',
      sourceFile: 'cart/scape/systems/chance.ts',
      description:
        'Supersamples the segment over the tile grid: 0 walls -> clear (or partial if a prop intervenes), exactly 1 facade wall -> glass (a window shot; isFacadeWall requires an open-space neighbor), else none; closed doors count as walls.',
      status: 'live',
    },
    {
      name: 'perceivedChance',
      purpose: ['perception', 'chance'],
      kind: 'utility',
      sourceFile: 'cart/scape/systems/perception.ts',
      description:
        'The delusional distortion model: P_perceived = clamp(P_true*(1-h/150) + delta(h) + sin(16t)*(h/100)) where delta = manic optimism (quadratic past h=60). Sober returns truth unchanged. At h>=90 a 15% shot reads as a flickering ~65%. Never touches ground truth.',
      status: 'live',
    },
    {
      name: 'inventory.ts',
      purpose: ['item'],
      kind: 'module',
      sourceFile: 'cart/scape/systems/inventory.ts',
      description:
        'ItemInstance[] + WorldItem[] (floor items reference instances); pockets are a flat id list, inHand one id; pickup auto-equips an empty hand; drop spawns a floor item ahead of the player; pistol charges decrement per shot.',
      status: 'live',
    },
    {
      name: 'doors.ts',
      purpose: ['interaction', 'pathing'],
      kind: 'module',
      sourceFile: 'cart/scape/systems/doors.ts',
      description:
        'Stateful doors seeded from CITY_DOORS; closedDoorBlockers folds into both pathfinding and LoS  open a door and its tile is immediately walkable.',
      consumes: ['CITY_DOORS'],
      status: 'live',
    },
    {
      name: 'registries/items.ts (item-module registry)',
      purpose: ['item', 'shader', 'format'],
      kind: 'registry',
      sourceFile: 'cart/scape/registries/items.ts',
      description:
        'Each item is one self-contained module (pistol/knife/lockpick/blue_hoodie/bomb): type (design.ts ItemType: category, cost, RangeProfile, enables keys), world (an SDF spriteKind + its own WGSL branch as a string), inventory (labels/hooks). ITEM_SPRITE_WGSL concatenates every module WGSL and interpolates into BOTH the ground shader and the HUD icon shader.',
      emits: ['ITEM_SPRITE_WGSL'],
      status: 'live',
    },
    {
      name: 'ground.wgsl.ts',
      purpose: ['shader', 'rendering'],
      kind: 'shader',
      sourceFile: 'cart/scape/render/ground.wgsl.ts',
      loc: 333,
      description:
        'The world shader. Warps screen-space first when high, inverse-projects each fragment, paints ground per tile kind, marches the building heightfield (56 steps; same-tile descent = rooftop, neighbor step-in = facade), composites sprite SDF branches, then distance haze, vignette, and the high grade. Reads @group(0) @binding(1) var<storage,read> D: array<f32>.',
      consumes: ['ITEM_SPRITE_WGSL'],
      dependsOn: ['palette.ts', 'sdf.wgsl.ts'],
      status: 'live',
    },
    {
      name: 'createScapeFrame',
      purpose: ['rendering'],
      kind: 'utility',
      sourceFile: 'cart/scape/render/sprites.ts',
      description:
        'The JS half of the frame: cull/sort sprites (depth-haze filter -> nearest-180 -> y-sort painter order), pack [header(16) | tile window(56^2) | sprite records(5 floats each)], plus path-dot sprites and the player screen anchor/facing.',
      emits: ['frame.data'],
      status: 'live',
    },
    {
      name: 'palette.ts',
      purpose: ['color', 'shader'],
      kind: 'module',
      sourceFile: 'cart/scape/render/palette.ts',
      description:
        'The single palette source: tile colors as 0..1 RGB tuples consumed by ground + minimap shaders via a wgsl() literal formatter, chrome as hex for React. Never paste a raw color into a cart module.',
      status: 'live',
    },
    {
      name: 'sdf.wgsl.ts',
      purpose: ['shader', 'rendering'],
      kind: 'shader',
      sourceFile: 'cart/scape/render/sdf.wgsl.ts',
      description:
        'Shared SDF helpers (sdBox/sdCirc/antialiased shade/premultiplied over)  one source so ground and icon shaders can not drift.',
      status: 'live',
    },
    {
      name: 'minimap.wgsl.ts',
      purpose: ['shader', 'rendering', 'ui'],
      kind: 'shader',
      sourceFile: 'cart/scape/render/minimap.wgsl.ts',
      description:
        'The radar: same data buffer, reads the tile window per-uv, player/camera dots, round-clip via transparent corners (premultiplied zero alpha so the compositor drops the square).',
      consumes: ['frame.data'],
      status: 'live',
    },
    {
      name: 'itemIcon.wgsl.ts',
      purpose: ['shader', 'ui', 'item'],
      kind: 'shader',
      sourceFile: 'cart/scape/render/itemIcon.wgsl.ts',
      description:
        'Renders ONE item SDF into the HUD weapon box, reusing the exact world branches; documents the y-flip convention (world sprites grow upward in negative ly).',
      consumes: ['ITEM_SPRITE_WGSL'],
      status: 'live',
    },
    {
      name: 'Player.tsx',
      purpose: ['character', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/scape/render/Player.tsx',
      description:
        'The player as ~8 absolute Boxes (pixel-sprite style), eye offset by facing - yaw so the face tracks heading relative to the camera, bob while pathing.',
      status: 'live',
    },
    {
      name: 'Hud.tsx',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/scape/render/Hud.tsx',
      description:
        'The GTA chrome: LED glyphs (layered Text for drop shadow; no textShadow in the runtime), zero-padded cash, hearts, 6 wanted stars from notoriety, weapon box (live SDF icon + charge count), high pill, examine toast, the radar.',
      status: 'live',
    },
    {
      name: 'ContextMenu.tsx (action menu)',
      purpose: ['ui', 'interaction', 'perception'],
      kind: 'component',
      sourceFile: 'cart/scape/ui/ContextMenu.tsx',
      description:
        'The action menu: full-viewport backdrop Pressable (100000x100000, zIndex 998) for click-away, rows with the perceived % recomputed every render against system time (the flicker is real, not animated state). The load-bearing interaction primitive; doors were its first real consumer.',
      consumes: ['onRightClick'],
      dependsOn: ['availableActions', 'perceivedChance'],
      status: 'live',
    },
    {
      name: 'Chat.tsx / QuestChatPanel (live LLM NPC)',
      purpose: ['agent_llm', 'ui', 'networking'],
      kind: 'component',
      sourceFile: 'cart/scape/ui/Chat.tsx',
      description:
        'The live LLM NPC (Roach the fixer). Arms useAssistant with the claude_code backend (a real claude CLI subprocess), sends a 10-line PRIME roleplay prompt once on readiness, folds streaming events into chat bubbles (foldAssistantEvents). While chat open, chatOpenRef gates ALL world input.',
      dependsOn: ['useAssistant'],
      consumes: ['__cwd', '__env', '__worker_start', '__worker_close'],
      status: 'live',
    },
    {
      name: 'useAssistant',
      purpose: ['agent_llm', 'host_bridge', 'networking'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/useAssistant.ts',
      description:
        'Spawns and drives a claude CLI subprocess via the __worker_* host family (__worker_start(backend, opts_json), __worker_close). backend claude_code, model claude-opus-4-7. Respawns on opts-signature change, persists across unmount.',
      consumes: ['__worker_start', '__worker_close'],
      status: 'live',
    },
    {
      name: '__cwd / __env',
      purpose: ['host_bridge'],
      kind: 'host_fn',
      sourceFile: 'cart/scape/ui/Chat.tsx',
      codeRef: 'cart/scape/ui/Chat.tsx:8-26',
      description:
        'Resolve a working directory for the assistant subprocess (cwd -> $HOME -> /tmp), via callHost/hasHost from runtime/ffi.',
      consumers: ['cart/scape/ui/Chat.tsx'],
      status: 'live',
    },
    {
      name: 'onRightClick',
      purpose: ['input', 'host_bridge', 'interaction'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_app.zig',
      codeRef: 'framework/v8_app.zig:2447',
      description:
        'The first cart in the series using onRightClick/onContextMenu; v8_app.zig installs it from the handler names and the payload arrives via the prepared-right-click path (runtime/index.tsx:358 __getPreparedRightClick). Drives the action menu.',
      consumers: ['cart/scape/state/world.ts'],
      status: 'live',
    },
    {
      name: 'PlayerDebug.tsx',
      purpose: ['debug', 'ui'],
      kind: 'component',
      sourceFile: 'cart/scape/ui/PlayerDebug.tsx',
      description:
        'Dev panel mutating the player body through PlayerDebugActions (health/armor/money/per-axis suspicion/life state/costume presets/high).',
      status: 'live',
    },
    {
      name: 'Wheel.tsx',
      purpose: ['ui', 'item'],
      kind: 'component',
      sourceFile: 'cart/scape/ui/Wheel.tsx',
      description:
        'Pockets quick-select, intentionally unused  left on disk for when weapon-cycling lands (PROGRESS.md line 228); the HUD weapon box is the current display.',
      status: 'dormant',
    },
  ],
  patterns: [
    {
      name: 'world-as-one-shader-quad',
      purpose: ['rendering', 'shader', 'world_gen'],
      description:
        'One Effect quad inverse-projects every fragment into world space and paints tiles, buildings, and all sprites from one storage buffer; React holds only screen-space chrome. The heightfield march extends it to extruded worlds (2.5D skyline, zero geometry). Proven and canonical here; any future tile-world cart should start from this shape.',
      examples: ['scape', 'scape3d'],
      status: 'recurring',
    },
    {
      name: 'ground truth vs display split (physically separate modules)',
      purpose: ['chance', 'perception'],
      description:
        'chance.ts computes real odds and physically can not see perception.ts (display-only warp); the dice always roll the truth. Never collapse; never compute odds anywhere else. The strongest version of the project-wide law; recurs in hmsc/combat_lab.',
      examples: ['scape', 'combat_lab'],
      status: 'recurring',
    },
    {
      name: 'item-module registry (content modules contribute shader code)',
      purpose: ['item', 'shader', 'format'],
      description:
        'One self-contained module owns type + world look (as a WGSL string) + UI hooks, and the registry concatenates the looks into the shaders. Add an item touches exactly one new file plus the registry list. The scape twin of scape3d thingymajigger doctrine.',
      examples: ['scape', 'scape3d'],
      status: 'recurring',
    },
    {
      name: 'packed-bits tile encoding',
      purpose: ['world_gen', 'rendering'],
      description:
        'kind|tier|style in one Int16 (bits 0-2 / 3-5 / 6-8); the shader masks/shifts, game logic reads kind only (cityTileAt vs cityPackedAt). The struct-stores-kind / registry-gives-meaning pattern compressed into a number; the shader needs no second buffer.',
      examples: ['scape', 'hmsc'],
      status: 'recurring',
    },
    {
      name: 'palette-token module feeding both WGSL and React',
      purpose: ['color', 'shader', 'ui'],
      description:
        'A single palette source feeding WGSL (via wgsl() literals) and React (hex)  the anti-drift pattern for any cart with shader + chrome surfaces.',
      examples: ['scape'],
      status: 'recurring',
    },
    {
      name: 'live LLM NPC (claude subprocess + roleplay prime + streamed bubbles + input gating)',
      purpose: ['agent_llm', 'ui'],
      description:
        'A claude_code subprocess, a roleplay prime sent once, streamed bubbles, and chatOpenRef gating world input. A working prototype of the bridge-thread-sessions / agent-NPC ambition.',
      examples: ['scape'],
      status: 'recurring',
    },
    {
      name: 'authored-city (stamps + explicit props over procgen)',
      purpose: ['world_gen'],
      description:
        'Readable, deterministic, editable city built from rectangle stamps + hand-placed props rather than procgen; matches hmsc-int painted-terrain direction (worlds authored, then compiled to data).',
      examples: ['scape', 'hmsc-int'],
      status: 'recurring',
    },
    {
      name: 'JS projection / WGSL projection twins kept in lockstep by discipline',
      purpose: ['math', 'shader', 'rendering'],
      description:
        'world/projection.ts and the inverse-projection in ground.wgsl.ts are hand-mirrored implementations of the same yaw-rotate + pitch-squash math; palette tokens guarantee colors can not drift but the math twins are kept aligned only by discipline.',
      examples: ['scape'],
      status: 'avoid',
    },
  ],
  hazards: [
    {
      name: 'two chance engines in the repo',
      purpose: ['chance', 'damage'],
      description:
        'scape/systems/chance.ts (multiplier ChanceBreakdown, weapon RangeProfile, tile-grid LoS with glass windows) and hmsc/npc/systems/chance.ts (hitChance with coverFraction) are the same concept, different shapes/inputs, both games. When the worlds converge the chance engine is the first thing to reconcile.',
      evidence: ['scape.md:113'],
      fix: 'Reconcile on convergence: scape breakdown legibility is the richer surface, hmsc cover-fraction producer the richer input.',
      severity: 'high',
    },
    {
      name: 'JS and WGSL projection math must stay in lockstep',
      purpose: ['rendering', 'shader', 'math'],
      description:
        'The fragment shader inverse-projects each fragment using the same yaw-rotate + pitch-squash math as world/projection.ts, hand-mirrored in WGSL. The two implementations must stay in lockstep; palette tokens stop colors drifting but the math twins are by discipline only.',
      evidence: ['scape.md:93'],
      severity: 'high',
    },
    {
      name: 'tiles.ts Kind enum duplicates citymap T enum verbatim',
      purpose: ['world_gen', 'maintenance'],
      description:
        'world/tiles.ts Kind enum duplicates citymap.ts T enum value-for-value; both files acknowledge tiles.ts is a compat facade.',
      evidence: ['scape.md:114'],
      fix: 'Fold tiles.ts into citymap when convenient.',
      severity: 'medium',
    },
    {
      name: 'clamp re-rolled in 4+ files within one cart',
      purpose: ['math', 'maintenance'],
      description:
        'clamp is re-rolled in player.ts, chance.ts, perception.ts, and world.ts inline  the repo-wide V3/clamp utility sprawl again.',
      evidence: ['scape.md:115'],
      fix: 'Use a shared clamp utility.',
      severity: 'low',
    },
    {
      name: 'design.ts is far ahead of implementation (types with no consumers)',
      purpose: ['format', 'persistence'],
      description:
        'zones, assets, websites/internet artifacts, murder types, hazards, the Case, quests, NPCs-as-agents, orders/dealing, setbacks/rap sheet are all types with no consumers yet (contract-first by design). Any glossary built from scape must distinguish implemented (player body, high, items, interactions, chance, doors, clock) from declared.',
      evidence: ['scape.md:117'],
      severity: 'medium',
    },
    {
      name: 'three time bases coexist',
      purpose: ['game_loop'],
      description:
        'The examine toast stores until in performance.now() ms while the sim clock is in game minutes and the loop runs on dt  real ms, game minutes, and loop dt coexist. Fine now, worth one named convention later.',
      evidence: ['scape.md:118'],
      severity: 'low',
    },
    {
      name: 'no NPC perception/witnessing yet',
      purpose: ['perception', 'npc'],
      description:
        'NPCs wander randomly and do not see you; WitnessMemory, the Case, and zone detection pressure are design-only. hmsc combat_lab has the perception ladder; scape has the consequence vocabulary  the two halves have not met.',
      evidence: ['scape.md:123'],
      severity: 'medium',
    },
    {
      name: 'no persistence of any kind',
      purpose: ['persistence'],
      description: 'No localstore, no fs; every launch is day 0, 20:00.',
      evidence: ['scape.md:122'],
      severity: 'low',
    },
    {
      name: 'bomb/lockpick/hoodie verbs unwired',
      purpose: ['item', 'interaction'],
      description:
        'The bomb/lockpick/hoodie items exist as world SDFs + pickups, but their verbs (arm, costume-swap-on-equip) are not wired  only the pistol/knife attack path and the hoodie pickup work today.',
      evidence: ['scape.md:126'],
      severity: 'low',
    },
    {
      name: 'a miss is not nothing',
      purpose: ['interaction', 'perception'],
      description:
        'A manic player baited by a fake perceived 65% eats the real 15% (runAction rolls the true value). A hit downs the NPC (+12 visual heat); a miss sends the target bolting and spikes visual heat by 20  the whole block saw you.',
      evidence: ['scape.md:103'],
      severity: 'low',
    },
  ],
};
