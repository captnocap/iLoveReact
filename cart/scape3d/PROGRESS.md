# scape3d — the real-3D fork

`cart/scape3d` is a fork of `cart/scape` that swaps the 2D shader-quad world +
sprites for a real 3D world rendered by ONE `<Scene3D>` of meshes — while keeping
every game system and the movement/camera *behaviour* identical. The 2D-era
history below (Phase 0.5 onward) is inherited reference; this top section is the
canonical record of the 3D approach. Ship: `./scripts/ship scape3d`.

## The non-negotiables (engine facts learned the hard way)

- **ONE `<Scene3D>` root.** Every mesh is a child of the single scene; components
  return `Scene3D.Mesh` **fragments**, never their own `<Scene3D>` (N scenes = N
  render targets = broken). Mirrors `cart/app/world`. There is no `Scene3D.Group`.
- **Meshes take ABSOLUTE world positions.** No parent-transform/group nesting in the
  3D pipeline. So all "relative" authoring is flattened to absolute at bake time.
- **`geometry="plane"` is single-sided facing −Y** → a top-down camera back-face-culls
  it. Build floors from thin **boxes**. (framework `cull_mode=.back`.)
- **No per-mesh WGSL.** A 3D mesh samples a per-mesh **diffuse texture** (`{width,
  height,hex}` pixel buffer, cached by content hash). Custom WGSL is the `Effect`/
  `Filter` full-quad path only (that's what the high distortion uses).
- **Budget:** 65 536 verts / 512 draws per frame. Sphere/torus = 2304 verts each, box
  = 36. So: boxy everything, spheres rare.
- **Picking:** screen→world is a ray-march of the height field that EXACTLY inverts
  the framework's `m4lookAt`/`m4perspective` (`world/projection.ts`).

## The world model: uniform recursive entities

The world is ONE infinite **signed** tile grid (origin `[0,0]`, +x east, +y south,
negatives everywhere). Authoring is a recursive tree of **entities**, each
relative-to-itself; the parent injects position. `Map → Zone → Building → Object →
…`, the same shape all the way down.

- **`world/entity.tsx`** — the `Entity` type `{ id?, kind?, cache?, size, ground?,
  pack?, prop?, height?, render?, contents? }` + **`bake(root)`**: a single two-pass
  recursive walk that flattens the relative tree into the flat ABSOLUTE outputs the
  engine/systems want — `packedAt`/`kindAt`/`propAt` (tiles, for pathfinding/picking/
  minimap), a continuous `heightAt` (camera/feet/raycast), `features`/`featureAt`/
  `byPath` (interactables), and `frags` (mesh fragments for the one scene). Pass 1
  stamps tiles/props/features + collects relief; pass 2 emits frags once `heightAt`
  exists (so a building sits on the terrain it stands on).
- **`world/atlas.tsx`** — the root entity tree, baked once into `WORLD`. Composes
  `downtown` (the original city, rebuilt from its `citymap` RECTS/BLDGS/PROPS),
  `overlook` (a raised neon park to the NORTH at negative-y, linked across downtown's
  open top row), and `trap-lot` (a grime zone east, holding the crackhouse). Re-exports
  the query API. **Adding a zone = author an entity + register it; nothing else changes.**
- **`world/entities.tsx`** — composed entities: the `crackhouse_47` building (floor +
  wall segments + furniture + an addressable `bedroom`), and interior objects.
- Systems read the baked world through `world/{tiles,terrain,window}.ts` (thin
  re-exports of `atlas`). `chunks.ts` was an interim registry, now deleted.

Reusability is plain **function composition + `.map()`** (absolute coords baked from
an origin), not a coordinate-translation layer. Connectors `{side,at,span,surface}`
declare edge ports for seam continuity; `bake` validates and **warns** when a road/
sidewalk port dead-ends at a seam.

## Addressable, stateful, lootable contents (the floorboard slice)

Every entity can carry a mutable **`cache`** `{ needs?, money?, items?, opened? }`.
`bake` collects cache-bearing entities into `features` with their absolute coords AND
a dotted **address path** — so the *same node* has two addresses: a **coordinate**
(`1130,431` — where, for debugging) and a **semantic path**
(`crackhouse_47.bedroom.floorboard12` — what, for design/state).

First interactable: the crackhouse `bedroom` is a 4×4 room that auto-generates one
**floorboard** per tile (`floorboard[i]` ↔ local tile `i`, row-major; `[12]` = the
last row). `floorboard[12]` hides **$1,000,000** behind a **crowbar gate**. Flow,
on the EXISTING interaction systems:

- right-click a tile → `pickTarget` resolves `featureAt(tile)` → an `ActionTarget`
  of `kind:'feature'`.
- `availableActions` offers **"Pry up floorboard"**, blocked unless the held item is
  the required tool (`AttackContext.heldKey === cache.needs`) → reason `"need a crowbar"`.
- `runAction('pry')` flips `cache.opened`, loots `cache.money` (→ `adjustMoney`),
  and spikes `suspicion.visual` (tearing up a room is loud and leaves a mess).
- `City3D.Floorboards` reads `cache.opened` live → the board pops up beside a dark gap.

A `crowbar` item (`registries/items/crowbar.tsx`, `enables:['pry']`) spawns near the
player; the gate is the same pattern as the existing `lockpick`.

## The high system in 3D

The 2D ground shader's psychosis warp is reproduced as: a **chromatic `Filter`**
post-process over the whole view (intensity ← `high.intensity`) + a **woozy camera
sway**. Filters composite in a final pass over their rect, so the HUD/overlays must
live INSIDE the filter (else the composite paints over them); at intensity 0 the
chromatic is identity, so sober = crisp. Click handlers stay on the outer Pressable
so world picking uses raw coords.

## Next directions (designed, not yet built)

- **Items as fine-grid entities.** Migrate `registries/items/*` off 2D SDF `wgsl`
  quads onto the entity model: an item is the smallest entity (≤ 1 tile footprint)
  authored in a fine local unit grid (`0..UNITS`, e.g. 1000+) and scaled down
  (`scale = TILE/UNITS`). One authoring model for everything; dropped/held items
  become real 3D objects; the HUD icon becomes a baked snapshot of the same mesh.
  Item `type`/gating data (`enables`, category, charges) is unchanged.
- **Psychosis whispers.** A perception-layer read over `features` with hidden `cache`:
  when high, emit self-talk thought-bubbles ("…money in the walls?") whose TRUTH
  drops as intensity spikes (moderate high = good stash-finder; overamped = paranoid
  false positives). Phase-flavoured text. Chasing them ransacks rooms → bumps heat.
  Depends on the addressable-contents foundation above (now in place).
- **Enterable interiors / depth** and **per-zone NPCs** (NPCs are still global in
  `state/world.ts makeEntities`).

## Thingymajiggers — the one world-object category (2026-05-26)

Every placed object — toilet, building, palm, dumpster, door — is ONE thing: a
**thingymajigger**, a self-contained module that owns its material + mesh + footprint.
No more "which file/system writes this model and its scale?" split (`BuildingDef`/
`Item` in `design.ts` were premature category splits; the runtime model is `Entity`).

- `thingymajiggers/kit.tsx` — the contract: `Thingymajigger { kind, size, blocks?, Mesh }`,
  `ThingProps { x, z, baseY }`, `defineThingymajigger()`.
- `thingymajiggers/index.ts` — the `THINGYMAJIGGERS` registry. **Both `bake()` (static)
  and the live renderers (dynamic) resolve meshes through this one table.**
- Name rationale: "thing" is ungreppable; `thingymajigger` returns exactly our objects.
  It's the game-industry "doodad" concept (WoW's placed-decoration category).

MIGRATION COMPLETE (13 thingymajiggers): **static** (baked via `meshOf()` from the entity
tree) `PalmTree`, `Dumpster`, `Sign`, `CityBuilding` (owns `HEIGHT_SCALE`+`FACADE_TEX`),
`Wall`, `Toilet`, `Bed`, `Lamp`; **dynamic** (re-rendered live from game state by
`render3d/World.tsx`) `Door`, `Floorboard`, `Storefront`. One `meshOf(kind, params)` bridge
wires the registry into the bake tree, so atlas + entities never re-implement it. Convention:
`x,z` = footprint origin CORNER, `baseY` sampled at centre. `render3d/City3D.tsx` renamed →
`World.tsx`. `entity.tsx` = pure bake-engine + ground/relief surface fills; `entities.tsx` =
pure composition (no mesh code). Ships + launches clean.

Deliberately NOT migrated: `Characters3D.tsx` (player/NPC people — already self-contained,
not placed via the entity tree) and the terrain surface fills in `entity.tsx` (variable-size
ground/road/relief woven into bake's paint-order stacking — a different beast than a discrete
object). Both can fold in later if useful; neither was the "scattered model" problem.

Scale pass (same session): 1 tile = 1 m, the ~2 m player is the fixed human anchor, scale the
world UP not the player down. Buildings `HEIGHT_SCALE` 3.2→4.6, palm 2.4→4.2 m (stylised, not
realistic-10 m), dumpster 0.9→1.3 m, sign 1.8→3 m, door 1.7→2.1 m (player now clears it).

design.ts also gained the NEW quest/mission/save datashapes (not yet built): `Quest.requires`
+ `QuestRequirement` (unlock-by-criteria, no story state machine), `MissionTemplate` +
`MissionConstraint` + `MissionInstance` (reusable daily side-gigs), `MissionGenContext`
(optional LLM framing, static fallback), `SaveSnapshot` (autosave; bake() re-derives geometry).

### Lane/road normalization + dash clipping

Roads were 3 tiles thick → ~1.5 m lanes (a lane as wide as the player). Normalized the
UNIT: `LANE_W=2`, `MEDIAN_W=1`, `ROAD_W=5` (2+1+2) + `hRoad`/`vRoad` helpers in
`world/citymap.ts`, so lane width is one source of truth and the real map (this layout is
placeholder — it'll be rebuilt on the standard) authors roads from it, never magic numbers.
Sidewalks untouched (`SIDEWALK_W=2` reserved). Also fixed FLOATING lane lines: the centerline
and asphalt were separate meshes at different heights, so a dash outlived its road wherever a
later stamp (canal) or a building overdrew it. `groundFrag` now clips each dash to tiles that
are STILL road in the final baked grid — markings can't float, on any map.

### Texture fidelity

All procedural textures were tiny buffers stretched once across a big face, then bilinear-
smeared (the plaza checker was 4 px/tile → soft diamonds). Densified the buffers: plaza checker
cell 4→32, facade window cell 9→24, asphalt 16→64. Plaza/facade are now crisp; roads are long
faces so asphalt is still stretch-limited — UV tiling (repeat + per-mesh uv-scale) is the
resolution-independent fix when wanted.

### Interaction profile on thingymajiggers (stash + examine)

A thingymajigger now declares `stash?: number` (potential container slots) + `examine?: string`.
A declared stash auto-registers the placed thing as a searchable `feature` (an empty `cache` of
that capacity) — so a toilet (`stash:1`) is searchable even when empty. This collapsed the old
hardcoded special-cases (dumpster-Search/floorboard-Pry switched on kind): `availableActions`
offers Search for any ungated stash, Pry for a tool-gated one (crowbar floorboard = a gated
stash); examine flavor is read from the registry. **Deposit/withdraw**: a stash is a REUSABLE
container — "Stash the <item>" deposits the held item, Search pulls everything back out, it stays
usable. Instances ride `cache.stashed` (id-list) and never leave inventory state so charges/
quality survive. `design.ts InteractionEffect` gained `{kind:'stash'}` (deposit) beside `loot`.

### 3D item models — dropped + in-hand

Items had only 2D SDF sprites (shader-quad era), so in 3D they were invisible and hands were
empty. Each item now carries a hand-authored 3D `model` in a fine cm grid (`registries/items/
itemMesh.tsx`: 1 unit = 1 cm, capped ≤1 tile), beside its SDF (still drives the HUD box).
Authored: crowbar, knife, pistol, lockpick, bomb, blue_hoodie. Dropped items resolve through
`World.tsx` and lie on the terrain; the in-hand item renders gripped in the player's right hand
(`Characters3D` `Figure`), yaw-oriented along facing (`itemMesh` gained `yaw`). Icon ≠ model:
pixel_icon/cutout are the future ICON layer, not a model source.

**Still open (next):** doors/ENTRY-TO-BUILDING — doors open/close + block pathfinding, but only
the crackhouse has an interior; the citymap `BLDGS` are solid `CityBuilding` blocks. Real entry
(interiors for buildings + roof fade/cull so the top-down camera sees in) is unbuilt.

---

# Scape Progress (inherited 2D-era history below)

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

---

# Session — 2026-05-25 (face + interaction foundations)

This session took scape from a fantasy-RuneScape test prototype to a neon-grime
city with a real interaction primitive. Four chunks, in order:

1. **Face pass** — de-randomized the map (deleted the noise wilderness; the world
   is now a bounded hand-authored city in `world/citymap.ts`) and repainted the
   entire look to TONE.md (neon dusk over grime). New `render/palette.ts` is the
   single source of colour.
2. **Solid buildings + rooftops** — buildings became solid extruded blocks with
   real rooftops, fixing the "standing on the wall" look.
3. **Action menu + doors** — built the load-bearing interaction primitive
   (right-click → contextual `ActionOption[]`), with doors as its first consumer
   (open/close, sealed-shell-until-opened).
4. **Building variety** — per-building height tiers (a real skyline) + facade
   styles, via packed tile values and a rewritten variable-height heightfield march.

Each chunk is detailed in its own section below and was shipped + committed
(`./scripts/ship scape` clean each time). The cart now: neon city, hand-authored
map, repainted chrome + cast (quest-giver **Roach** the fixer), right-click action
menu, openable doors, varied building heights/styles.

**Open follow-ups carried out of this session:**
- The variable-height building march is reasoned-correct but **not yet eyeballed in
  motion** — wants a visual pass (stair-stepping on tall roofs? edge seams?).
- Player is a screen-centred React overlay → no depth occlusion, so it still draws
  over buildings *behind* it.
- Doors: open-door line-of-sight + walkable interiors (the "see through when open /
  sealed shell when closed" behaviour) — needs the perception system next.

---

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

---

# Session — 2026-05-25 (player interface — the GTA HUD pass)

Status: complete, eyeballed by the user.

Repainted the debug-style HUD into a real GTA III / Vice City **player interface**
(neon-dusk repalette of the classic stacked readout), driven by reference art.

- **`state/clock.ts`** (new) — the in-game clock. ~1 game-minute per real-second
  (a day ≈ 24 real min), starts at dusk (20:00). Ticked in the world loop; the HUD
  reads it as `HH:MM`. First consumer of the daily-time system the design calls for.
- **Armor** added to the `Player` contract (`armor`/`maxArmor`) + `setArmor`/`adjustArmor`
  mutators + a PlayerDebug row. Shown in the HUD only when > 0.
- **`render/sdf.wgsl.ts`** (new) — the shared SDF helpers (`sdBox`/`sdCirc`/`shade`/
  `over`) extracted from `ground.wgsl.ts` so the ground and the new icon shader can't
  drift.
- **`render/itemIcon.wgsl.ts`** (new) — renders the held item, centered, into the HUD
  weapon box by REUSING the exact item SDF branches (`ITEM_SPRITE_WGSL`). The thing in
  your hand is the thing in the corner — one source of truth. (ly maps box-top→most-
  negative so the sprite is upright.)
- **`render/Hud.tsx`** rewritten: LED clock (cyan, mono, hard drop-shadow — the
  runtime has no textShadow, so glyphs are layered), zero-padded green money, inline
  ♥ armor + ♥ health, a 6-star wanted row (notoriety→stars), the two-tone neon weapon
  box (charges as a small LED count), a "◈ HIGH" pill, and a faint controls hint. The
  old debug telemetry box is gone (dev info lives in PlayerDebug).
- **Circular radar** — `minimap.wgsl.ts` masks the square buffer into a dial: outside
  the circle returns a fully-transparent **premultiplied** pixel, so the effect-node
  compositor (rects pipeline, `premultiplied_alpha_blending`) drops the square corners
  and the city shows through. Container border frames the pink ring. Moved bottom-right.
- **Removed the bottom POCKETS wheel** — the top-corner weapon box is the inventory
  display now. `ui/Wheel.tsx` is left on disk (unused) for when weapon-cycling lands;
  its click-exclusion zone was removed so that bottom-center is walkable again.
- `state/world.ts` threads the clock, exposes `clock`, adds the `adjustArmor` action,
  and adds click-exclusion zones for the new top-right cluster + bottom-right radar.

Verified: `./scripts/ship scape` clean; 6s launch shader/exception-clean; user
confirmed the look in-motion (clock/money/heart/weapon/radar all reading correctly).

Open follow-ups:
- No way to swap the in-hand item via UI anymore (POCKETS removed). Pickup auto-equips
  the first item and `Q` drops; weapon-cycling (scroll / number keys) wants wiring into
  the weapon box next.
- Armor/health/money/clock are display-only — nothing damages armor or spends time yet.

---

# Session — 2026-05-25 (action probability + the delusional perception layer)

Status: complete; first attack consumers live (pistol/knife).

Closed the design-review gaps in `design.ts` and built the system behind the
action-menu %: a real X-COM hit-chance from world state, **plus** the drug-psychosis
layer that warps what you're SHOWN without touching the truth.

**Contract (`design.ts`).** Six review gaps closed: `high: number` → **`HighState`**
(intensity/phase/rising/sinceMs + derived phonePressure/marketReadNoise/agentAgitation
— peak ≠ comedown); **`PerceptionOverlay`** + `PerceivedNpcOverride` on `World` (the UI
can lie — a civilian reads as a cop — while the sim stays honest); **`InternetArtifact`**
+ `World.internet` (the dead internet leaves a durable footprint); `World.items/assets/
orders` (the live collections the player ids resolve into); `Objective` gets an explicit
**`ObjectiveTarget`** union (npc-by-Id vs zone/site-by-Key can't be confused); a contract
comment on `notoriety`. Plus `ChanceBreakdown` gained **`health`** + **`time`** terms and
`ActionOption` gained **`perceivedTarget`**.

**Chance engine (`systems/chance.ts`, new).** `lineOfSight()` raycasts the city grid
(clear / partial-cover / glass-through-a-facade-window / none-blocked over walls + closed
doors + props). `attackChance(profile, ranged, dist, los, ctx)` → a full `ChanceBreakdown`:
weapon base × range falloff × LoS (glass penalty) × cover × awareness × **health (shaky
aim when low)** × **time-of-day (night hurts ranged sight)** × combat skill. This is the
ONLY place a hit-% is computed — ground truth.

**Perception distortion (`systems/perception.ts`, new).** `perceivedChance(pTrue, h, tMs)`
implements the agreed model exactly: `clamp(pTrue·(1−h/150) + δ(h) + sin(ω·t)·(h/100), 0,1)`
with `δ(h)=0.5·((h−60)/40)²` past the tweaking line (h≥60). Wired into `ContextMenu` and
recomputed every frame, so under high the menu % **flickers frantically and reads manically
high** (a 15%-true shot shows a jittering ~65% at h≥90). The dice roll in `runAction` uses
the TRUE chance — so the manic player is baited into a catastrophic blunder.

**First consumers.** A ranged **pistol** item (RangeProfile + SDF, spawned in the plaza)
and the melee knife now generate `shoot`/`slash` rows on NPCs when held. Right-click an NPC
while armed → "Shoot — Cheap pistol — NN%" gated by distance/LoS; firing rolls the true
odds, spends a round, and on a miss the NPC bolts and visual heat spikes (a witnessed botch).
`notoriety` is now a weighted blend (visual×1.5, fund×0.8) matching the new contract comment.

Verified: `./scripts/ship scape` clean; 6s launch shader/exception-clean (pistol SDF +
icon shader both compile).

Open follow-ups:
- LoS `glass` is wired but can't trigger yet — no walkable interiors / NPCs inside
  buildings. It activates the moment interiors land (the sniper-through-a-window case).
- NPC `awareness` is hardcoded `unaware` (Ent has no perception state yet); alert/fleeing
  multipliers are in the engine waiting for it.
- `PerceptionOverlay` (fake cop / phantom tiles / price noise) is contract-only — the menu
  warps the % but the npcOverrides aren't populated/rendered yet.
