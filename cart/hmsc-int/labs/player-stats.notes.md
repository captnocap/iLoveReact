# player-stats lab — notes (the contract)

## What it demonstrates

The whole player-stats set, live, driven by `GAME_STATS`:

- **Core stats** — health (max 100), armor (soaks before health), energy
  (drains running/jumping, regens at rest), money (total = cash + crypto + Σ
  assets), the 6-star wanted level, carry capacity (hands + pockets + pack), and
  the five outfit slots.
- **Gained stats** — the four skills (stamina, vehicle, aim, stealth): one xp→
  level curve, each with an effect that lerps by level.

The right pane renders **the shipped HUD** (`render/StatsHud`) — the same
component the in-world HUD uses — over a clothed figure whose silhouette tracks
the shirt/pants picks. Tuning a value on the left moves the real readout on the
right; nothing here is a mock.

## The simulation row (the systems, running)

- **rest / walk / run** — the energy formula ticks each frame: running drains
  fast, resting regenerates, and a higher stamina level visibly slows the drain.
- **walk/run** also advances the step odometer, which earns stamina xp — leave it
  running and stamina levels up on its own.
- **jump** charges the one-shot energy cost (cheaper at high stamina).
- **commit crime** adds notoriety (stars light at the thresholds); **evade**
  bleeds it back down (faster with stealth) — proving wanted is persistent until
  properly evaded.
- **+xp** on a skill jumps it to the next level so its effect is easy to read.

## What broken looks like

- Money total ≠ cash + crypto + assets → the factored sum is wrong (a stored
  total crept in).
- Carry capacity doesn't change when you swap pants/pack → the per-slot factor
  table isn't being summed.
- Energy drains the same at stamina L0 and L10 → the skill effect isn't applied.
- Stars don't match the thresholds, or the wanted level snaps to 0 without
  evading → the quantizer/decay is wrong.

## Bridges

Wanted reads `player.heat` (the live notoriety scalar; `GAME_PERCEPTION` once the
Case is wired). Outfit shirt/pants bridge to the figure's `OutfitDocument`. See
`game/stats/CAPTURE.md`.
