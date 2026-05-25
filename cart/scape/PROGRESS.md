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

### Solid buildings + rooftops

Buildings were hollow open-top wall rings: the back wall's raised top projected
forward over the courtyard and front wall, and the player billboard overlapped it
— which read as "standing on the wall." Made building footprints SOLID Wall, so
the existing wall raycast caps each block with one clean rooftop face and draws
side faces only on the outer perimeter; the player now clearly stands in front of
the base. The wall-top is now a real rooftop (`rooftop()` in `ground.wgsl.ts`):
tar surface, a neon parapet drawn only on the building's outer edges, and hashed
AC-unit blocks. Interior `floor`/`door` defs are retained for the future
enter-building system (carve interiors + fade the roof on entry).

Known follow-up: the player is a screen-centered React overlay, so it still draws
over buildings that are *behind* it (no depth occlusion yet); and all blocks share
one height (`WALL_H`) — per-building height variation needs a height field in the
tile data.

## Phase 2B — Action menu (the load-bearing interaction primitive) + doors

Status: first slice complete.

Built the action menu BEFORE the door/enter-building system, because every
interaction (talk, examine, loot, door open/close, and later every attack) is one
entry in it — the menu is the primitive, doors are its first consumer.

- `systems/interactions.ts` — the interaction catalog (walk/examine/talk/pickup/
  drop/open/close/loot) with proximity bands. Pure data.
- `systems/actions.ts` — `availableActions(target, px, py)`: pure function →
  contextual `ActionOption[]` (design.ts), each proximity-gated; blocked rows carry
  a reason ("too far — get closer"). `ActionTarget` = door | npc | storefront |
  sign | item | prop | tile.
- `ui/ContextMenu.tsx` — `<ActionMenu>` renders the options at the click point,
  greys blocked rows, runs the picked key. Backdrop dismiss + high zIndex.
- `state/world.ts` — right-click (`onSceneRightClick`) opens the menu for whatever
  is under the cursor; `runAction` executes the effect (walk / examine / talk→chat /
  pickup / open-close door / search). Left-click stays the default action.

Doors (first menu consumer): `systems/doors.ts` holds open/closed state; each
building's door tile is carved to a `Door` gap (`world/citymap.ts`), the leaf is a
sprite (open vs closed by tint, `render/ground.wgsl.ts` kind 5). Closed doors fold
into the pathfinding blocker set, so the building stays a sealed shell until opened.
Left-click a door (when adjacent) toggles it; right-click → Open/Close/Examine.
Doors show as orange pips on the minimap.

Verified: `./scripts/ship scape` succeeds; 6s launch is shader- and exception-clean.

Next on doors: open-door LoS + walkable interiors (needs the perception system) —
the "see through when open / sealed shell when closed" behaviour the design calls for.

## Building variety — per-building height + facade style

Status: complete.

Every building shared one `WALL_H` and one palette. Now each carries an authored
**height tier** (HEIGHTS in `citymap.ts`: trap houses squat at 1.6, residential
mid, commercial towers up to 4.0 — a real skyline) and a **facade style** (0 pink
stucco, 1 teal, 2 lilac, 3 grime), driving facade colour, window neon hue, and
roof tone.

- Tile values are now PACKED — bits 0..2 kind, 3..5 height tier, 6..8 style — so
  no buffer-layout change. `cityTileAt` masks to the kind for game logic;
  `cityPackedAt` feeds the renderer; both shaders mask `& 7` for the kind. Grid is
  Int16 to hold the packed values.
- The wall renderer was rewritten from a single-global-height projection trick into
  a true variable-height heightfield march (`ground.wgsl.ts`): step from high above
  down toward the fragment; first building column the ray dips into is the surface
  — same column from above = rooftop, lateral step-in = side face. Window rows now
  scale with building height (taller = more floors).

Verified: `./scripts/ship scape` succeeds; 6s launch is shader- and exception-clean.
NOT yet eyeballed in motion — the march is reasoned-correct but wants a visual pass
(watch for stair-stepping on tall roofs or seams at building edges).
