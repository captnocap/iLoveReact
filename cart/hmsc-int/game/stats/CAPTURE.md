# game/stats — GAME_STATS (player stats: core + gained)

The canonical player-stats model. Core stats (health, armor, energy, money,
wanted, inventory capacity, outfit) and gained stats (one uniform skill type:
stamina, vehicle, aim, stealth). The dev/test HUD (`render/StatsHud.tsx`) and the
`labs/player-stats` lab read this door; nothing imports its internals.

## The shape (GUIDING_LIGHT)

A game is **data**. `config.ts` (`STATS_TUNING`) is the one flat, declarative
table every formula reads — defaults, maxes, drain/regen rates, the xp curve, the
per-skill effect coefficients, and the **factor tables** (pocket-by-pants,
pack-by-backpack, star thresholds). `stats.ts` is the fixed arithmetic over it.
`bridges.ts` is the only seam to the systems that already exist.

Two disciplines hold throughout:

- **Derived values are never stored.** `moneyTotal = cash + crypto + Σ asset`,
  `inventoryCapacity = hands + pocket(pants) + pack(backpack)`, and the wanted
  star count are computed from factors on demand — *factor the product into a
  sum*, never bake the product.
- **Progression is one uniform skill** (rule-of-two): only `xp` is stored; level
  is `min(maxLevel, floor((xp/xpBase)^xpCurve))`; each effect lerps one
  coefficient by `level/maxLevel`. A new skill = a new id + its coefficients in
  `STATS_TUNING`, never a new code path.

## State home

The additive live state (`armor`, `energy`, `wallet`, `outfit`, `skills`,
`steps`) lives on `PlayerState` (`design.ts`). `health`, `heat` (the wanted
source), `money` and `inventory` already existed there and are bridged, not
duplicated.

## Bridges (separable, one source of truth)

- **wanted ← notoriety**: `wantedFromNotoriety(notoriety)` quantizes the live
  `player.heat` / `GAME_PERCEPTION` blend into 6 stars. Persistent: notoriety
  only bleeds while evading (`decayNotoriety`, sped by the stealth skill).
- **outfit ↔ figure**: `loadoutFromDocument` / `documentFromLoadout` translate
  between the gameplay loadout and the figure's `OutfitDocument` (shirt↔top,
  pants↔bottoms; backpack read from accessories until the figure grows the slot).

## Carries end to end

`STATS_TUNING` bakes into the `STATS_CONFIG` lump (`MAP_LUMP` 22) via
`compile/playerStats.ts`, mirroring `PHYSICS_CONFIG`; the no-V8 loader
(`framework/world/constructor.zig`) decodes it and seeds the compiled player's
stats. The compiled game stays React-free — the native HUD + Zig stat sim are a
deliberate later effort, not a JS-in-the-loop shortcut.

## P2

The scalar knobs register with `editorTunables` (`system: 'player-stats'`) so
`/settings` edits them live. The factor tables are data, not slider leaves.
