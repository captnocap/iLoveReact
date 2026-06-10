# vehicle-handling — lab notes

> P6: these notes are the lab's contract — read by humans, AI, and the oracle.
> They are what make "broken" detectable: after a graduation re-run, a behavior
> change against these notes is a real choice surfaced for ruling, never a
> silent patch. Keep them current; an AI referencing this lab reads this first.

## What this lab demonstrates

The **first driving model in the engine** (req_0522). It drives `GAME_DRIVING`
— a kinematic bicycle model born in `game/driving/` — with a `GAME_VEHICLE`
body, `GAME_INPUT` keys, the `GAME_LOOP` frame clock, and the V23 native chase
camera (`GAME_NATIVE_CAMERA`, orbit mode behind the nose). You drive a real
vehicle body around a cone-slalom test pad and dial its handling live:

- **engine / top speed / brake** — longitudinal feel. top speed is a hard cap
  (the engine over-powers it; the clamp is the limiter).
- **grip** — lateral traction. High = railed; low + handbrake = the tail steps
  out and the slip readout climbs.
- **cornering** — tire scrub: how much hard turning bleeds forward speed.
  0 = full-speed donuts; higher = the car washes off speed mid-turn.
- **steer** — max front-wheel angle. **drag** — high-speed falloff.
- **body** picks the `GAME_VEHICLE` style; the wheelbase (≈58% of length) feeds
  the turn radius, so the fire truck turns wide and the sports car turns tight.

Controls: **W/↑** throttle · **S/↓** brake then reverse · **A/D** (or ←/→)
steer · **Shift** foot brake (firm stop, no reverse) · **Space** handbrake
(drift, cuts grip). HUD: km/h, gear (D/R/N), slip angle.

The camera is an **auto-centering chase cam**: it trails behind the car's
heading, drag adds a peek offset that eases back to center (so you stay
oriented), scroll dollies the distance.

`GAME_DRIVING` is cart-side on purpose — per DECISIONS V1 physics is ONE
host-side system, and this lab is where the SHAPE of driving feel is found
before it graduates into the host sim (the path physics_lab/ragdoll_lab took).
The model is pure + React-free so the graduation is a behavior port, not a
rewrite. Next consumers: the `/test` play route, then the host port.

## What broken looks like

- **You cannot turn while moving**, or the car pivots in place when parked —
  the bicycle model ties yaw rate to forward speed; turning at v≈0 or refusing
  to turn at speed means the heading integration is wrong.
- **The car slides like ice with grip maxed**, or never drifts with grip low +
  handbrake — the lateral grip term (`vl *= exp(-grip·dt)`) is mis-wired.
- **Reverse steers the same way as forward** — angular velocity must flip sign
  with negative forward speed (it falls out of `vf/wheelBase · tan(steer)`).
- **The body shears, the wheels detach, or the nose points the wrong way** —
  the per-mesh world transform (assembly yaw = heading + 180°, since the build's
  nose is at local −Z) is off.
- **The camera lags, judders, or orbits the wrong side** — the native chase cam
  isn't binding (`cameraRef.current.id`), or the orbit yaw offset is wrong.
- **Front wheels do not steer / wheels do not roll** — the front-wheel id match
  or the odometer→roll mapping broke.

## Log

- 2026-06-10: scaffolded by `rjit lab new vehicle-handling`.
- 2026-06-10: first driving lab — GAME_DRIVING model, native chase cam, tunable
  feel bench, cone slalom (req_0522).
