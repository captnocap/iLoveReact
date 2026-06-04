# scape cart inventory

Source cart: `cart/scape/` (37 files, ~3,750 lines of TS/TSX + 3 design docs)

Reviewed: 2026-06-04

## High-level purpose

`scape` is the 2D game proper — the GTA × Hitman × RuneScape × Schedule-1 sandbox in its top-down form (its real-3D fork is `cart/scape3d`, untouched by this cart). It is also the repo's **canonical "world as one shader quad" cart**: the entire rotating city — tiles, extruded buildings with rooftops, water, neon, every prop/NPC/item/door sprite, the drug-high post-process — is painted by a single `<Effect>` fragment shader reading one flat `f32` array. The React tree holds only the player sprite and screen-space chrome (HUD, action menu, chat, debug panel).

Playable today: click-to-move (A* pathing) through a hand-authored neon-dusk city; A/D orbit the camera, W/S tilt it; right-click anything for a RuneScape-style action menu with X-COM hit percentages; pick up / equip / drop items (pistol, knife, lockpick, hoodie, bomb); shoot an NPC (ground-truth dice; misses are witnessed and spike heat); open/close doors that gate pathfinding and line-of-sight; get high (`H`) and watch the screen warp while the action menu *lies about your odds*; talk to Roach the fixer — a **live LLM NPC** running a claude subprocess. A GTA HUD (LED clock/cash, hearts, wanted stars, weapon box, circular radar shader) frames it all.

Equally important is what the cart *declares*: `design.ts` (521 lines, zero runtime) is the full data contract for the eventual game — suspicion axes, visual signatures, witnesses, the Case, zones, assets, the dead internet, murder types, quests, setbacks. Most of it is not implemented yet; the implemented slice (player body, high state, items, interactions, chance, doors) follows it exactly. `TONE.md` (neon dusk over grime; funny-desperate, never noir) and `ROADMAP.md` complete the design spine.

## Files touched by this behavior

Composition root:

- `index.tsx` (55 lines): wires `useQuestChat` → `useScapeWorld` → `createScapeFrame` → five surfaces (ground Effect, Player, Hud, PlayerDebug, ActionMenu, QuestChatPanel). Nothing else lives here.
- `cart.json`: window 1100×720, the cart's one-line thesis ("rotating ground is a single GPU shader quad; only sprites live in the React tree").

The contract:

- `design.ts`: types only. The two spine shapes everything references: `Suspicion` (5 evidence axes: visual/fund/pattern/digital/location, each 0..100) and `VisualSignature` (silhouette + garment color + accessory — the unit of recognition). Conventions: `XType` = authored registry data, `X` = live instance. Notable contracts: `Player.notoriety` is guaranteed a *pure function* of `Suspicion`; `HighState` separates ground-truth `intensity` from the derived pressures it pushes on other systems; `ChanceBreakdown` makes every hit-% legible (each factor a multiplier, `final` the clamped product); `PerceptionOverlay` lets the UI lie without the sim lying.

World (math + authored city):

- `world/citymap.ts`: the **hand-authored city** — explicitly no procgen (the old infinite fbm wilderness is gone). 52×44 `Int16Array`; rectangle stamps (roads/plaza/water/sand/grime) then building stamps. **Packed tile encoding**: bits 0–2 kind, 3–5 height tier (8 `HEIGHTS` 1.6–4.4), 6–8 facade style. Buildings are solid `Wall` volumes with one carved `Door` tile each; `CITY_DOORS` seeds the runtime door objects. Hand-placed props (palms/signs/dumpsters) in a `Map` keyed by tile.
- `world/tiles.ts`: thin façade re-exposing citymap through the legacy `Kind`/decor names (note: the `Kind` enum duplicates citymap's `T` enum verbatim).
- `world/projection.ts`: the camera math — yaw rotation + pitch as a y-squash (`TILE_PX`=30): `project`/`unproject` are exact inverses, plus `hazeOpacity` (fade 15→24 tiles).
- `world/window.ts`: the streaming window — `WIN`=56 packed tiles around the player, `HEADER`=16 floats, `MAX_SPRITES`=180.
- `world/pathfinding.ts`: plain A* over tiles — 8-directional with corner-cut prevention, goal clamped to 48 tiles, `nearestWalkable` spiral fallback, 6000-node expansion cap. Blockers = water/walls/void + props + a caller-supplied key set.

State (mutable sim behind refs):

- `state/player.ts`: `ScapePlayerState = Cam & { body: Player; path }`. The canonical player body per design.ts; `computeNotoriety` = weighted blend (visual ×1.5, fund ×0.8) normalized 0..100 — blend not max, so spread heat is cheaper than one spiked axis (a deliberate strategy choice, documented). `advancePlayer` follows the path at 4.2 tiles/s and decays high at 0.12/s. The high machinery: `derivePhase` (sober/comeup/peak/overamped/crashing), `recomputeHigh` (phonePressure/marketReadNoise/agentAgitation pressures).
- `state/world.ts` (559 lines): the hub. `useScapeWorld` owns every ref (sim, entities, inventory, doors, clock, keys, examine toast, menu), the rAF-guarded loop (`useWorldLoop`: clock, A/D yaw + W/S pitch, path-following, NPC wander via `nearestWalkable`, `force((n)=>(n+1)&0xffff)` render trigger), keyboard (`useSceneControls` on `__keydown`/`__keyup`; H = bump high, Q = drop in-hand; all input gated off while chat is open via `chatOpenRef`), left-click resolution (HUD dead-zones → item pickup → door toggle → entity examine/chat → decor flavor → pathfind), right-click → menu, and `runAction` (the verb switch — including the shoot/slash resolution).
- `state/clock.ts`: GTA cadence — 1 game-minute per real-second (24-minute day), starts at 20:00 dusk. `clockHM` feeds the night penalty in chance.ts.

Systems (pure logic, no React):

- `systems/interactions.ts`: the verb catalog (`walk/examine/talk/pickup/drop/open/close/loot/shoot/slash`) + `PROXIMITY_RANGE` bands (adjacent 1.7 / near 2.4 / any). Pure data; effects live in world.ts, applicability in actions.ts.
- `systems/actions.ts`: `availableActions(target, ctx)` — the **pure function behind the action menu**. Target kinds: npc/storefront/sign/door/item/prop/tile. Blocked rows carry reasons; every menu ends with "Walk here". `attackOption` builds the weapon row from the held item's `RangeProfile`.
- `systems/chance.ts`: the **X-COM percent-to-hit engine** (this cart's own, distinct from hmsc's — see findings). `lineOfSight` supersamples the segment over the tile grid: 0 walls → clear (or `partial` if a prop intervenes), exactly 1 *facade* wall → `glass` (a window shot — `isFacadeWall` requires an open-space neighbor), else `none`; closed doors count as walls. `attackChance` multiplies base × range-falloff × LoS × cover(0.65) × awareness × health(0.7+0.3h) × night(0.82 ranged) × skill(0.6+0.8c), clamped [0.02, 0.98].
- `systems/perception.ts`: **the delusional distortion model** — `P_perceived = clamp(P_true·(1−h/150) + δ(h) + sin(16t)·(h/100))` where δ = manic optimism (quadratic past h=60). Sober returns truth unchanged. At h≥90 a 15% shot reads as a flickering ~65%. Never touches ground truth.
- `systems/inventory.ts`: `ItemInstance[]` + `WorldItem[]` (floor items reference instances); pockets are a flat id list, `inHand` one id; pickup auto-equips an empty hand; drop spawns a floor item ahead of the player; pistol charges decrement per shot.
- `systems/doors.ts`: stateful doors seeded from `CITY_DOORS`; `closedDoorBlockers` folds into both pathfinding and LoS — open a door and its tile is immediately walkable.

Registries (the item-module pattern):

- `registries/items.ts` + `items/types.ts` + `items/{pistol,knife,lockpick,blue_hoodie,bomb}.tsx` + `items/spriteKinds.ts`: each item is one self-contained module — `type` (the design.ts `ItemType`: category, cost, `RangeProfile` for weapons, `enables` keys), `world` (an SDF `spriteKind` + **its own WGSL branch as a string**), `inventory` (labels/hooks). `ITEM_SPRITE_WGSL` concatenates every module's WGSL and is interpolated into BOTH the ground shader and the HUD icon shader — the thing on the floor, in the world, and in the weapon box is one authored SDF.

Render:

- `render/ground.wgsl.ts` (333 lines): the world shader. Detailed below.
- `render/sprites.ts`: `createScapeFrame` — the JS half of the frame: cull/sort sprites (depth-haze filter → nearest-180 → y-sort for painter's order), pack `[header(16) | tile window(56²) | sprite records(5 floats each)]`, plus path-dot sprites and the player's screen anchor/facing.
- `render/palette.ts`: the **single palette source** — tile colors as 0..1 RGB tuples consumed by ground + minimap shaders via a `wgsl()` literal formatter, chrome as hex for React. "Never paste a raw color into a cart module."
- `render/sdf.wgsl.ts`: shared SDF helpers (`sdBox`/`sdCirc`/antialiased `shade`/premultiplied `over`) — one source so ground and icon shaders can't drift.
- `render/minimap.wgsl.ts`: the radar — same data buffer, reads the tile window per-uv, player/camera dots, round-clip via transparent corners (premultiplied zero alpha so the compositor drops the square).
- `render/itemIcon.wgsl.ts`: renders ONE item SDF into the HUD weapon box, reusing the exact world branches; documents the y-flip convention (world sprites grow upward in negative ly).
- `render/Player.tsx`: the player as ~8 absolute Boxes (pixel-sprite style), eye offset by `facing − yaw` so the face tracks heading relative to the camera, bob while pathing.
- `render/Hud.tsx`: the GTA chrome — LED glyphs (layered Text for drop shadow; no textShadow in the runtime), zero-padded cash, hearts, 6 wanted stars from notoriety, weapon box (live SDF icon + charge count), high pill, examine toast, the radar.

UI:

- `ui/ContextMenu.tsx`: the action menu — full-viewport backdrop Pressable (100000×100000, zIndex 998) for click-away, rows with the **perceived** % recomputed every render against system time (the flicker is real, not animated state).
- `ui/Chat.tsx`: the live LLM NPC. Detailed below.
- `ui/PlayerDebug.tsx`: dev panel mutating the player body through `PlayerDebugActions` (health/armor/money/per-axis suspicion/life state/costume presets/high).
- `ui/Wheel.tsx`: **intentionally unused** — pockets quick-select, left on disk for when weapon-cycling lands (PROGRESS.md line 228 documents this; the HUD weapon box is the current display).

## Host functions vs JavaScript functions

Host calls by name (all defensively wrapped):

- `__cwd` / `__env` (`ui/Chat.tsx:8-26` via `callHost`/`hasHost` from `runtime/ffi`): resolve a working directory for the assistant subprocess (cwd → $HOME → `/tmp`).
- The `__worker_*` family via `runtime/hooks/useAssistant.ts` (`__worker_start(backend, opts_json)`, `__worker_close`, …): spawns and drives a **claude CLI subprocess** (`backend: 'claude_code'`, `model: 'claude-opus-4-7'`) for Roach's chat. The hook respawns on opts-signature change and persists across unmount.
- `Effect data` → WGSL storage buffer: three shaders (ground, minimap, itemIcon) all read `@group(0) @binding(1) var<storage, read> D: array<f32>` — the standard effectData path (`v8_app.zig` applyProps). Ground and minimap share the *same* `frame.data` array.

Event/bus plumbing (no names called):

- `busOn('__keydown')`/`busOn('__keyup')` for WASD-as-camera + H/Q hotkeys.
- `Pressable onMouseDown` (left click) and **`onRightClick`** — the first cart in this series using it; `v8_app.zig:2447` installs it from the `onRightClick`/`onContextMenu` handler names, and the payload arrives via the prepared-right-click path (`runtime/index.tsx:358 __getPreparedRightClick`).
- `onLayout` on the scene Pressable captures the rect (screen↔world conversions need it).
- The loop: standard rAF-guard → `setTimeout(16)`, `performance.now` dt clamped [0.001, 0.05].

Everything else is plain JS: projection/unprojection, A*, LoS supersampling, chance multiplication, perception warp, sprite packing/sorting, clock, inventory mutation. There is no fs, no localstore, no SQLite, no networking — nothing persists across launches.

## The render thesis (one quad, one buffer)

JS packs one flat array per frame (`createScapeFrame`): a 16-float header (player px/py, yaw, pitch, zoom, tile-px, window origin, WIN, spriteCount, **high intensity at D[10]**), the 56×56 *packed* tile window, then ≤180 sprite records of `[screenX, screenY, kind, tint, opacity]` (already projected, culled by haze and screen bounds, y-sorted). The fragment shader then:

1. **Warps screen-space first** when high (`sx/sy` perturbed by sinusoids scaled by D[10]) — the drunk lens before anything is sampled.
2. **Inverse-projects** each fragment to world space — the same yaw-rotate + pitch-squash math as `world/projection.ts`, hand-mirrored in WGSL (the JS and WGSL implementations must stay in lockstep; the palette tokens guarantee colors can't drift but the *math* twins are by discipline).
3. Paints the ground per tile kind (animated water glints, pulsing plaza checker, wet-asphalt neon sheen, grain everywhere) with tile-edge darkening.
4. **Marches the building heightfield**: from `H_MAX` down along the view direction (56 steps), the first column the ray dips into wins — same-tile descent = rooftop (tar-gravel, neon parapet on *outer* edges only, hashed AC units), neighbor step-in = facade (style-colored stucco, checkered lit windows whose row count scales with height, neon roofline, grimy footing). This is how every building gets its own height/style from the packed tile bits with no geometry at all.
5. Composites the sprite records — each a `sprite(kind, lx, ly, tint)` SDF branch (palms, dumpsters, storefronts, neon signs with halos, NPC figures, door leaves open/closed, path dots/target, downed bodies, **plus every item module's interpolated branch**).
6. Distance haze, vignette, then the **high grade**: saturation boost, RGB channel drift, brightness pulse — all scaled by D[10].

The minimap reuses the exact same buffer (window + header) for a 56×56 pixel-per-tile radar; round-clipped by returning transparent outside the circle.

## The action menu (the load-bearing interaction primitive)

Right-click → `unproject` → `pickTarget` (priority: door > entity > item > prop > tile) → `availableActions(target, AttackContext)` → `ActionMenuState` rendered at the click point. The attack row's `chance` is **ground truth** from `attackChance` (with `breakdown` explaining every multiplier); the menu *displays* `perceivedChance(chance, high, now)` — recomputed each render so it flickers at 16 rad/s under high. `runAction` then rolls `Math.random() < picked.chance` — **the true value** — so a manic player baited by a fake 65% eats the real 15%. A hit downs the NPC (renders as the `SK_BODY` sprite, +12 visual heat, career kill); a miss sends the target bolting and spikes visual heat by 20 ("the whole block saw you") — the documented "a miss is not nothing" rule from design.ts.

This is the scape perception-split law in full operation: `chance.ts` = ground truth, `perception.ts` = display-only warp, never collapsed, odds never computed elsewhere.

## The live LLM NPC (Roach)

Clicking the quest-flagged NPC opens `QuestChatPanel` and arms `useAssistant` with the `claude_code` backend — a real claude CLI subprocess via the host's `__worker_*` bindings. A 10-line `PRIME` roleplay prompt (in-character street fixer, "funny-desperate — NEVER cool, NEVER noir", 1–3 jittery sentences) is sent once on readiness; streaming events fold into chat bubbles (`foldAssistantEvents` accumulates `assistant_message` deltas until `completion`). While chat is open, `chatOpenRef` gates ALL world input (keyboard and clicks) — the chat owns the keyboard. This is the in-game materialization of the agent-NPC ambition in design.ts (`ActivationTier: 'focal' = live LLM`).

## Duplication & drift findings

- **Two chance engines now exist in the repo.** `scape/systems/chance.ts` (multiplier `ChanceBreakdown`, weapon `RangeProfile`, tile-grid LoS with glass windows) and `hmsc/npc/systems/chance.ts` (`hitChance` with coverFraction — see `docs/game/combat_lab.md`). Same concept — ground-truth odds with a separate display layer — different shapes, different inputs, both *games* (scape 2D, hmsc 3D). When these worlds converge, the chance engine is the first thing to reconcile; scape's breakdown legibility (WHY is it 33%) is the richer surface, hmsc's cover-fraction producer is the richer input.
- `world/tiles.ts` `Kind` enum duplicates `citymap.ts` `T` enum value-for-value (both files acknowledge tiles.ts is a compat façade — fold it when convenient).
- `clamp` is re-rolled in 4+ files within this one cart (player.ts, chance.ts, perception.ts, world.ts inline) — the repo-wide V3/clamp utility sprawl again.
- `ui/Wheel.tsx` is a *documented* orphan (kept for weapon-cycling) — unlike hmsc's ScaleLabScene orphan, this one is intentional and recorded in PROGRESS.md.
- `design.ts` is far ahead of the implementation: zones, assets, websites/internet artifacts, murder types, hazards, the Case, quests, NPCs-as-agents, orders/dealing, setbacks/rap sheet are all **types with no consumers yet**. That's by design (contract-first), but any glossary built from scape must distinguish "implemented" (player body, high, items, interactions, chance, doors, clock) from "declared" (everything else).
- The examine toast stores `until` in `performance.now()` ms while the sim clock is elsewhere — three time bases coexist (real ms, game minutes, loop dt); fine now, worth one named convention later.

## What is not here

- No persistence of any kind — no localstore, no fs; every launch is day 0, 20:00.
- No NPC perception/witnessing — NPCs wander randomly and don't see you; `WitnessMemory`, the Case, and zone detection pressure are design-only. (hmsc's combat_lab has the perception ladder; scape has the *consequence* vocabulary — the two halves haven't met.)
- No 3D — `Scene3D` unused; the fork `cart/scape3d` owns that. No `framework/sim` binding yet (NPC `simWalletId` is declared, unconsumed).
- No sound, no Tailwind, no StaticSurface, no Canvas/Graph.
- The bomb/lockpick/hoodie items exist as world SDFs + pickups, but their verbs (`arm`, costume-swap-on-equip) aren't wired — only the pistol/knife attack path and the hoodie's pickup work today.

## Integration-relevant observations

- **World-as-one-shader-quad is proven and canonical here** (per the project memory): per-fragment inverse projection + packed tile window + sprite records beats per-tile React nodes. The heightfield march extends it to *extruded* worlds — a 2.5D skyline with zero geometry. Any future tile-world cart should start from this shape.
- **The item-module registry is the scape twin of scape3d's thingymajigger doctrine**: one self-contained module owns type + world look (as a WGSL string!) + UI hooks, and the registry concatenates the looks into the shaders. "Add an item" touches exactly one new file plus the registry list. The WGSL-branch-as-data trick is the notable move — content modules contribute shader code.
- **Ground truth vs display is implemented as physically separate modules** (chance.ts can't see perception.ts), the strongest version of the project-wide law. The same split recurs in hmsc (chance vs the HUD) — glossary-level concept.
- **Packed-bits tile encoding** (kind|tier|style in one Int16) is the "struct stores kind, registry gives meaning" pattern compressed into a number — the shader needs no second buffer. Same instinct as hmsc's tileKinds, different encoding.
- **The palette-token module feeding both WGSL (via `wgsl()` literals) and React (hex)** is the anti-drift pattern for any cart with shader + chrome surfaces.
- **A live LLM NPC in a shipped cart works** — claude_code subprocess, roleplay prime, streamed bubbles, input gating. The bridge-thread-sessions / agent-NPC plans have a working prototype here.
- The authored-city move (stamps + explicit props, "readable, deterministic, editable") over procgen matches hmsc-int's painted-terrain direction: worlds are authored, then compiled to data.

## Glossary

Action menu: The right-click contextual verb list — `availableActions` (pure) → `ActionOption[]` with ground-truth `chance`+`breakdown` → rendered with the perceived (possibly lying) %. The load-bearing interaction primitive; doors were its first real consumer.

ChanceBreakdown: The legible hit-% — base × range × los × cover × awareness × health × time × skill, each kept as a field so the menu can show WHY a shot is 33%.

Dream↔squalor axis: TONE.md's register made spatial — neon plaza (dream pole) to grime/trap blocks (squalor pole); the palette, city layout, and flavor text all read off it.

Facade wall / glass shot: A wall tile with at least one open-space neighbor is a window candidate; exactly one such wall along a fire line = `glass` LoS (penalized by the weapon's `glassPenalty`), more or deeper = `none`.

Frame buffer (`frame.data`): The one flat array per frame — 16-float header (camera + spriteCount + high) + 56² packed tiles + ≤180 sprite records — consumed by both the ground and minimap shaders.

Ground truth vs perceived: The project law in module form — `systems/chance.ts` computes real odds, `systems/perception.ts` warps only what is *shown* (`P_perceived` with optimism bias + flicker), and the dice always roll the truth.

Heightfield march: The ground shader's 56-step descent along the view direction that turns packed height tiers into extruded buildings — same-tile descent paints rooftop, neighbor step-in paints facade.

High (HighState): The drug-psychosis signal — ground-truth `intensity` + phase (comeup/peak/overamped/crashing) + derived pressures (phone, market noise, agent agitation). Subscribers: the shader warp/grade (D[10]), the menu's perceived %, later the phone/market/agents. Decays 0.12/s; `H` bumps +0.45.

Item module: One file owning an item's `ItemType`, its world SDF (a WGSL branch string), and inventory hooks; the registry concatenates all branches into the ground + icon shaders. One source of truth for an item's look everywhere.

Notoriety: The derived 0..100 fail meter — a *weighted blend* of the five suspicion axes (visual ×1.5), chosen over max-axis so players hedge spread vs spike. Renders as wanted stars.

Packed tile: One Int16 = kind (bits 0–2) | height tier (3–5) | facade style (6–8); the shader masks/shifts, game logic reads kind only (`cityTileAt` vs `cityPackedAt`).

Perception split: Never collapse `chance.ts` (truth) into `perception.ts` (display warp); never compute odds anywhere else. (Memory: project_scape_perception_split.)

Suspicion / evidence axes: The five-way trace vector (visual/fund/pattern/digital/location, 0..100 each) — the player's TRUE generated evidence; the world's lagging belief lives separately on the (not yet implemented) Case.

Tile window: The 56×56 packed-tile slice around the player streamed into the frame buffer each frame — the world is unbounded-camera but the shader only ever sees the window.

VisualSignature: silhouette + garment color + accessory — what witnesses remember, what costumes present, what burned disguises match against. The unit of recognition for the whole detective loop.

World-as-shader-quad: The cart's render thesis — one `<Effect>` quad inverse-projects every fragment into world space and paints tiles, buildings, and all sprites from one storage buffer; React holds only screen-space chrome.
