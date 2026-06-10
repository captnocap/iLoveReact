# vehicle-handling — lab notes

> P6: these notes are the lab's contract — read by humans, AI, and the oracle.
> They are what make "broken" detectable: after a graduation re-run, a behavior
> change against these notes is a real choice surfaced for ruling, never a
> silent patch. Keep them current; an AI referencing this lab reads this first.

## What this lab demonstrates

The **first driving model in the engine** (req_0522 → req_0558). It drives
`GAME_DRIVING` — a grip-limited bicycle model with a rigid-body roll/pitch layer,
born in `game/driving/` — with a `GAME_VEHICLE` body, `GAME_INPUT` keys, the
`GAME_LOOP` frame clock, and the V23 native chase camera (`GAME_NATIVE_CAMERA`).
The target feel is **GTA 4**: heavy, low grip, slow steering, turn-wide, and
genuinely tippable. You drive a real vehicle body around a cone-slalom pad and
dial its handling live:

- **engine / top speed / brake** — longitudinal feel. top speed is a hard cap
  (the engine over-powers it; the clamp is the limiter).
- **grip** — how fast a sideways slide is scrubbed. low + handbrake = the tail
  steps out and the slip readout climbs.
- **lat g** — max cornering acceleration the tires hold. Ask for a sharper turn
  than this and the car UNDERSTEERS wide (the GTA-4 push). Also the rollover
  ceiling.
- **cg height** — the tip lever: higher CG rolls over at lower cornering g (a
  top-heavy van flips before a low car). When cornering load beats gravity's
  moment about the outer wheels (`g · halfTrack / cgHeight`), the car FLIPS onto
  its side/roof — traction gone until righted (**R**). A flip escalates the
  body's damage states (cabin/glass/panels) — what those states were built for.
- **cornering** — tire scrub: hard turning bleeds forward speed (0 = donuts).
- **steer / steer spd** — lock angle + how fast the wheels reach it (low = the
  floaty GTA-4 response). **drag** — high-speed falloff.
- **body** picks the `GAME_VEHICLE` style; wheelbase + track width feed the turn
  radius and tip threshold, so the fire truck turns wide and tips late.

Body **lean** (roll) and **dive/squat** (pitch) are rendered as weight transfer.
NOT YET: collision-driven flips (hitting a wall/curb) — the cones are decorative
for now; that's the next slice.

Controls: **W/↑** throttle · **S/↓** brake then reverse · **A/D** (or ←/→)
steer · **Shift** foot brake (firm stop, no reverse) · **Space** handbrake
(drift, cuts grip) · **R** right an upset car. HUD: km/h, gear (D/R/N), slip,
roll angle, and a FLIPPED banner.

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
- **Cornering at speed flips the car instantly, or you can't turn wide** — the
  grip-limit (maxLatG) cap on `aLat`/`angularVel` is gone, so the bicycle model
  produces unbounded lateral g.
- **The car never tips no matter how hard you corner**, or tips at a crawl — the
  tip threshold (`g · halfTrack / cgHeight` vs `aLat`) is mis-tuned; check that
  maxLatG can exceed it (else it always slides first).
- **A flipped car keeps driving / never settles** — the `flipped` branch isn't
  cutting traction or the bistable `-sin(2·roll)` settle is wrong.
- **The body sinks through the deck while rolled** — the `|sin(roll)|·halfWidth`
  ride-height lift in the lab's mesh transform is missing.

## Log

- 2026-06-10: scaffolded by `rjit lab new vehicle-handling`.
- 2026-06-10: first driving lab — GAME_DRIVING model, native chase cam, tunable
  feel bench, cone slalom (req_0522).
- 2026-06-10: GTA-4 handling pass (req_0558) — grip-limited understeer, body
  roll/pitch, rollover (tips & flips onto its roof, traction lost, R to right),
  flip→damage escalation, weighty low-grip default tune.
