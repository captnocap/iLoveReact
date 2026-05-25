# Scape — Build Roadmap

Fundamentals first, **built modularly from the start.** Each system stands alone,
is tested in isolation, then wired in. **No story, missions, or quests until the
systems below stand on their own** — the authored spine hangs off working mechanics.

Contract: `design.ts`. Tone: `TONE.md`.

---

## ARCHITECTURE — read this before writing any code

**The #1 rule: `index.tsx` is a thin composition root, NOT the game.** It mounts
the root component and wires modules together. No system, registry, shader string,
or UI panel is implemented inline in `index.tsx`. If you find yourself adding game
logic there, stop — it belongs in a module below.

The cart is a **directory of focused modules** (same modular ethos as the repo's
other multi-file carts, e.g. `cart/cutout`). Target layout — create these homes up
front so systems land in the right place instead of accreting into one file:

```
cart/scape/
  index.tsx              thin entry — mount + compose. ~50 lines, no game logic.
  design.ts  TONE.md  ROADMAP.md

  world/                 pure world math (no React, no state)
    noise.ts             hash2 / vnoise / fbm
    tiles.ts             Kind, tileAt / townTile / wildTile / decorAt
    projection.ts        Cam, Rect, project / unproject, centerX/Y
    pathfinding.ts       blockedAt / walkable / nearestWalkable / findPath
    window.ts            windowed tile + decor streaming builders
    authoring.ts         BuildingDef/MapDef → tile+height compiler (Phase 8)

  render/                turns state → pixels (shaders + the few React sprites)
    ground.wgsl.ts       GROUND_WGSL (ground + walls + SDF sprites + high)
    minimap.wgsl.ts      MINIMAP_WGSL
    sprites.ts           sprite kind codes + the data-buffer packer
    Player.tsx           the one React player sprite
    Hud.tsx              health / money / notoriety / in-hand / minimap

  state/                 runtime state + the loop (no rendering)
    player.ts            Player state + mutators
    world.ts             World root + per-frame tick
    sim.ts               framework/sim bridge (wallets, market) (Phase 6)

  systems/               game logic, each independently testable
    inventory.ts  interactions.ts  actions.ts  perception.ts
    evidence.ts   agents.ts  lifecycle.ts  high.ts  dealing.ts

  registries/            authored catalogs (pure data)
    items.ts  murders.ts  zones.ts  buildings.ts  websites.ts

  ui/                    screen-space React (NOT world objects)
    ContextMenu.tsx  Wheel.tsx  CastBar.tsx  Qte.tsx  Chat.tsx  Phone.tsx
    apps/  News.tsx  Dex.tsx  Market.tsx

  content/               (Phase 8+) map.ts — declarative placements. Story is DEFERRED.
```

Conventions: `world/*` is pure (testable with no host). Shaders live in `render/*.wgsl.ts`
as named strings, never inline in components. Registries are data, not logic.
"Isolation" = a small test cart (`cart/isolated_tests/`) or a debug toggle — built at
production quality (a positive result stays).

---

## Phase 0 — Baseline (DONE)
Running in `cart/scape/index.tsx` today (currently a single file — Phase 0.5 fixes that):
infinite shader world, orbit camera, click-to-move + A*, SDF sprites, heightfield
buildings, minimap, AI quest-giver, the `high` filter. The world/render layer is
settled — do not move world objects back into React nodes.

## Phase 0.5 — Decompose the prototype (DO THIS FIRST)
Before adding ANY new system, split today's `index.tsx` into the layout above. No
behaviour change — pure extraction:
- noise/tiles/projection/pathfinding/window → `world/*`
- the two shader strings → `render/ground.wgsl.ts`, `render/minimap.wgsl.ts`
- sprite packing → `render/sprites.ts`; `Player` → `render/Player.tsx`; HUD → `render/Hud.tsx`
- the quest-giver chat → `ui/Chat.tsx`; the game loop → `state/world.ts`; player state → `state/player.ts`
- `index.tsx` shrinks to mount + wire.
*Done when:* `scape` looks and plays identically, and `index.tsx` is a thin shell.

## Phase 1 — Player & Items
- **1A · Player state** → `state/player.ts`. `Player` (design.ts) as the single
  source of truth: health, money, suspicion/notoriety, costume, lifeState, high.
  *Done when:* a debug panel shows/edits live state and the HUD reflects it.
- **1B · Items + inventory** → `registries/items.ts`, `systems/inventory.ts`,
  `ui/Wheel.tsx`, in-hand bit in `render/Hud.tsx`. `inHand`/`pockets`, radial wheel,
  world items as SDF (drop/pickup).
  *Done when:* pick up → wheel → swap to hand → drop, all visible. *Isolation:* items cart.

## Phase 2 — Interactions & the Action Menu
- **2A · Interactions + input** → `systems/interactions.ts`, `ui/CastBar.tsx`,
  `ui/Qte.tsx`. `InteractionType`/`InteractionEffect`; instant / cast / QTE; interruptible.
  *Done when:* a cast bar runs + interrupts; a QTE resolves pass/fail. *Isolation:* interaction cart.
- **2B · Action menu** → `systems/actions.ts` (`availableActions`), `ui/ContextMenu.tsx`.
  Right-click → contextual `ActionOption[]` with `ChanceBreakdown`; blocked rows greyed.
  *Done when:* right-click a dummy NPC through a window → contextual rows with live %.
- **2C · Resolution** → `systems/actions.ts` (`resolveAction`), `registries/murders.ts`.
  `AttemptOutcome` hit/miss, `MurderType` profiles, `RangeProfile` factors.
  *Done when:* a shot rolls its %, hit kills + miss alerts; the breakdown matches.

## Phase 3 — Perception & Detection
- **3A · Line of sight** → `systems/perception.ts`. Grid raycast + sight cone; walls block, windows don't.
  *Done when:* a debug overlay shows who can see the player. *Isolation:* perception_lab cart.
- **3B · Evidence ledger** → `systems/evidence.ts`. `MurderEvent`/`WitnessMemory`/`Case`/`Suspicion`.
  *Done when:* a kill in sight raises suspicion; unseen does not.
- **3C · Costume ↔ recognition** → `systems/evidence.ts` + `state/player.ts`.
  *Done when:* changing costume after a sighting drops visual heat; reusing a burned one spikes it.

## Phase 4 — Agents & world life
- **4A · Agent model** → `systems/agents.ts`. Tiers, states, schedules; react to events (gunshot → flee/look/witness).
  *Done when:* a loud shot makes nearby NPCs flee/look, distant ones don't.
- **4B · Zones** → `registries/zones.ts` (+ consumed by `systems/perception.ts`).
  *Done when:* the same kill in a plaza vs wilderness yields different heat.

## Phase 5 — Lifecycle
- **5A · Hospital / jail** → `systems/lifecycle.ts`. `SetbackRule`, `RapSheet`, law response.
  *Done when:* dying → hospital with losses; high notoriety → busted → jail → release with a record.

## Phase 6 — Economy & the dead internet
- **6A · Sim hookup** → `state/sim.ts` + `ui/apps/Dex.tsx`. Wallets + a DEX over `framework/sim`.
  *Done when:* trade a shitcoin, see PnL. *Isolation:* DEX cart over the sim.
- **6B · Phone shell** → `ui/Phone.tsx`, `registries/websites.ts`, `ui/apps/News.tsx`.
  *Done when:* open the phone, read an investigation report built from real events.
- **6C · `high` coupling** → `systems/high.ts`. `high` subscribers: market read, phone pressure, agents.
  *Done when:* getting high makes charts jitter, the phone spam, NPCs erratic.

## Phase 7 — First composed loop: dealing
- → `systems/dealing.ts`, `ui/apps/Market.tsx`. `Order` → cook (QTE at a lab) → deliver → cash;
  feeds the evidence vector; `sting?` orders are bait.
  *Done when:* accept → cook → deliver → paid, and a sloppy hand-off raises heat.

## Phase 8 — Authoring layer
- → `world/authoring.ts`, `registries/buildings.ts`, `content/map.ts`. `MapDef` compiler.
  Pull earlier if hand-authoring the map hurts.
  *Done when:* a building placed via a `MapDef` appears with no edits to the world shader.

---

## First integration checkpoint
After Phases 1–3 + 6B: build the **perception → witness → news** vertical end to
end (kill in sight → witness records costume → suspicion rises → news names "a
[costume] figure near [zone]" → swap costume → heat drops). Green light that the
foundation is real.

## Deferred until the above stands
Story spine, main/side missions (`Quest`/`Objective`), the contract board, the full
synthwave repalette, the `high` bad-trip, vehicles. Content/polish over working
systems — not foundations.
