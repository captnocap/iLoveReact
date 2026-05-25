# Scape Progress

## Phase 0.5 - Decompose the prototype

Status: complete.

- Moved deterministic noise, tile selection, projection math, pathfinding, and windowed tile/decor streaming into `world/`.
- Moved the ground and minimap shaders into `render/*.wgsl.ts`.
- Moved sprite constants and sprite data-buffer packing into `render/sprites.ts`.
- Moved the React player sprite into `render/Player.tsx`.
- Moved the HUD, examine toast, and minimap shell into `render/Hud.tsx`.
- Moved player movement/high-state mutators into `state/player.ts`.
- Moved entities, input controls, click handling, NPC wandering, and the RAF game loop into `state/world.ts`.
- Moved the Eldrin assistant chat controller and panel into `ui/Chat.tsx`.
- Reduced `index.tsx` to a thin composition root that wires the world state, render frame, HUD, player, shader, and chat panel together.

Verification:

- `./scripts/ship scape` completed successfully and produced `zig-out/bin/scape`.

## Phase 1A - Player State

Status: complete.

- Promoted the design `Player` contract into `state/player.ts` as the canonical player body.
- Moved health, money, suspicion/notoriety, costume, lifeState, tile, facing, and high into that player body.
- Kept continuous `px`/`py`, path, and camera values as runtime movement/render state around the player body.
- Added player mutators for health, money, suspicion axes, life state, costume, and high.
- Wired movement ticks to keep `Player.tile`, `Player.facing`, and high decay in sync.
- Updated shader sprite packing and the HUD to read high/facing/HUD values from the canonical player body.
- Added a compact `PlayerDebug` panel with health, money, and high edits visible by default, plus expanded suspicion/life/costume controls behind `more`.

Verification:

- `./scripts/ship scape` completed successfully and produced `zig-out/bin/scape`.

## Phase 1B - Items + Inventory

Status: complete functional slice.

- Added per-item modules under `registries/items/` so each item owns its authored type data, world SDF WGSL branch, render sprite kind, and inventory metadata.
- Added `registries/items.ts` as an aggregator/lookup only; item definitions are not dumped into one catalog file.
- Added starter item modules: `bomb`, `knife`, `lockpick`, and `blue_hoodie`.
- Added `systems/inventory.ts` for live item instances, world item placement, pickup, equip, in-hand lookup, and drop.
- Wired world click pickup for nearby ground items and path-to-item feedback when too far away.
- Wired `Q` and the inventory UI to drop the current in-hand item back into the world.
- Added `ui/Wheel.tsx` as a compact quick-select wheel surface for pockets, in-hand swap, and drop.
- Updated `render/sprites.ts` so dropped world items ride the same shader sprite buffer as decor/NPCs.
- Updated `render/ground.wgsl.ts` to inject item-owned SDF sprite branches from the item registry.
- Updated `render/Hud.tsx` to show the current in-hand item.

Verification:

- `./scripts/ship scape` completed successfully and produced `zig-out/bin/scape`.
- `timeout 5s ./zig-out/bin/scape` launched the cart without shader creation errors before timeout exit.

## Face pass — de-randomize the map + TONE.md repalette

Status: complete.

Two foundational changes before any new system lands.

**De-randomized the world.** Deleted the noise-streamed infinite wilderness
(`wildTile` + fbm decor scatter) and `world/noise.ts` entirely. The world is now a
bounded, hand-authored city in the new `world/citymap.ts`: a stamp list (roads,
plaza, canal, grime flats) + a building list (walls/interior/door) compiled once
into a fixed grid, plus an explicit hand-placed prop list. `tiles.ts` is now a thin
API over that grid; outside the city returns a VOID tile that the shader hazes and
pathfinding blocks. No randomness remains anywhere in world generation.

**Repainted the entire face to TONE.md** (neon dusk over grime; Hotline-Miami × Spun).
- New `render/palette.ts` is the single source of the palette — tile/accent rgb
  tuples shared by BOTH shaders (they can't drift) and hex chrome for the HUD/chat.
- `render/ground.wgsl.ts` rebuilt: wet-asphalt roads with neon reflections, a glowing
  pink/cyan plaza checker, dusk canal with neon glints, grime dirt, pastel-stucco
  walls with lit neon windows + a magenta roofline. Props redrawn as palm / dumpster /
  neon storefront / haloed neon sign / grimy figure. Wall-raycast + buffer layout
  untouched.
- `minimap.wgsl.ts`, `Hud.tsx`, `Chat.tsx`, `Wheel.tsx`, `PlayerDebug.tsx`, and the
  root bg all reskinned to the neon palette.
- The cast is now Miami lowlifes (taco window, pawn shop, promoter, corner kid,
  tweaker). The quest-giver is **Roach**, a twitchy strung-out fixer — the chat
  persona prompt is rewritten funny-desperate, never noir-cool.

Verification:

- `./scripts/ship scape` succeeded → `zig-out/bin/scape`.
- `timeout 6s ./zig-out/bin/scape` launched clean — no shader-creation errors.
