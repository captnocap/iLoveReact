# explosives — lab notes

> P6: these notes are the lab's contract — read by humans, AI, and the oracle.
> They are what make "broken" detectable: after a graduation re-run, a behavior
> change against these notes is a real choice surfaced for ruling, never a
> silent patch. Keep them current; an AI referencing this lab reads this first.

## What this lab demonstrates

The **explosives integration lab** — proof that the two pure foundation doors
shipped in req_1132/1133 drive real on-foot gameplay:

- **`GAME_EXPLOSION`** (`game/explosion.ts`) — the instant radial blast: falloff
  impulse + falloff damage + ignition over a target list.
- **`GAME_FIRE`** (`game/fire.ts`) — lingering, spreading combustion: a
  `Combustible` that burns then **cooks off** (→ a blast) or extinguishes, and a
  sparse `FireField` that crawls fire cell-to-cell across poured fuel.

**It rides the GAME'S OWN player substrate**, exactly like `combat-arena`: it
mounts `useEmbodiedPlayer`, so movement, the V23 host camera, the frame loop, and
the player figure are the REAL ones. Explosives are layered on in the substrate's
`onFrame`. The barrels are **dynamic host bodies** carried on `worldExtras.bodies`
— the host steps them with the player every frame, so walking into a barrel kicks
it and a blast launches it through the same channel. (STRUCTURE caveat: same as
combat-arena — `Embodied.tsx` isn't a `game/` door yet; the user ruled labs reuse
it, so it's imported directly until it graduates.)

It proves two things, and the chain between them:

- **Propane tank = a big boom, not a fire.** The tank is a `Combustible` with a
  ~0.06 s fuse (`fuelSeconds`) and `end: 'cookoff'`. Shoot it (RMB aim + LMB, a
  host-camera ray vs the tank box) or hit **detonate tank**: it lights, the fuse
  steps to `cookoff` on the next frame, and `detonateAt` fires one
  `GAME_EXPLOSION.blastAt` at the tank. Every barrel within `radiusMeters` (8)
  takes a falloff impulse added straight to its physics velocity (near barrels
  fly, the far one barely rocks — `BARREL_MASS` resists throw, not damage); the
  player, included as the last blast target, takes falloff **damage** (stand on
  top of it and you die — the "or the player dies" case). VFX is host-free: a
  bright sphere expands and fades + a full-screen flash.
- **Gasoline trail = a crawling fire.** A hand-poured L-shaped fuel path
  (`GAS_TRAIL`, a `FuelPredicate`) runs from a west light-point east along z=4,
  then south down x=2 into the tank's cell. **Light gasoline** ignites the west
  end; each frame `stepFireField` advances the front one ring along the fuel; a
  flame cone marks every burning cell. The fire **turns the corner** and stops
  where the fuel stops.
- **The chain, both directions.** When the gasoline front reaches the tank's cell
  the tank ignites → cooks off → blast. And the blast, in turn, lights any
  gasoline cell within its radius. Light the gas far from the tank and watch it
  crawl all the way in and set off the boom.

## What "broken" looks like

- **Barrels don't move on a blast** → the `worldExtras.bodies` `commit` isn't
  writing back, or `GAME_PHYSICS.hostReady()` is false (no host physics gate) —
  the substrate only steps bodies when the host binding is built. Walking into a
  barrel also won't kick it; that's the same root cause, not a blast bug.
- **Barrels fly but the player takes no damage / never dies** → the player target
  (the last entry in the `blastAt` targets) isn't being read back by `index ===
  barrels.length`. The player is NOT knocked back by design (the host owns player
  velocity; impulse-into-the-player is a follow-up) — only damaged.
- **Fire ignites but never spreads / spreads instantly across the whole trail** →
  `stepFireField` tuning: `spreadDelaySeconds` is the visible crawl speed; a
  single `stepFireField` lights only the ring adjacent to cells that were burning
  at the START of the step (one ring per step, no same-step cascade). Instant
  fill means the snapshot guard regressed.
- **Fire reaches the tank but it doesn't cook off** → the chain check reads
  `isCellBurning` at the tank cell (and the cell one north); if the trail no
  longer ends adjacent to `TANK_CELL` the chain can't fire.
- **Shooting the tank misses every time** → `GAME_NATIVE_CAMERA.activeRay()` is
  absent (host binding not built) and the JS yaw/pitch fallback diverges from the
  real camera (the diagonal-bullets class of bug). The bench buttons are the
  pointer-free path and must always work.

## Tunables this lab carries (and where they graduate)

- `PROPANE_BLAST` (radius/peakImpulse/peakDamage), `PROPANE_FUSE_SECONDS` → onto
  the `propaneTank` prop kind once props are tagged combustible.
- `BARREL_MASS`, `FIRE_DOT_PER_SECOND` → a player-condition / prop-physics layer.
- `GAS_TRAIL`, `GAS_TUNING` → authored fuel placement (a jerry-can pour tool) and
  the `FIRE_TUNING` table, respectively.

## Next layers (not in this lab)

Tag the real `propaneTank` / `jerryCan` / `oilTank` props combustible so the
world's own props detonate; the RPG projectile; the real fireball `<Effect>`
shader + camera shake (the only piece needing a host rebuild).
