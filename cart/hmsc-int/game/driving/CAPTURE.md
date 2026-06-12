# game/driving — GAME_DRIVING capture

**Born here, not captured** (2026-06-10, req_0522). This is the FIRST driving
model in the engine — the first time a vehicle MOVES. Unlike GAME_VEHICLE
(captured from cart/vehicle_lab) or GAME_FIGURE, there was no prior cart to
lift from; the model is authored fresh against the contract below.

## What it is

A pure, React-free kinematic **bicycle model**:

- `makeCarState(x, z, heading)` → `CarState` (position, heading, velocity,
  steer angle, odometer).
- `defaultTuning(wheelBase)` → `CarTuning` (engine/brake/reverse power, top
  speeds, drag, rolling resistance, max steer, steer speed, grip, handbrake
  grip, wheelbase) — every feel parameter is exposed; the handling lab dials
  them.
- `stepCar(state, input, tuning, dt)` → mutates `state`, returns `CarTelemetry`
  (signed speed, lateral speed, slip angle, gear). Forward speed is driven by
  engine/brake/drag; lateral velocity bleeds by `exp(-grip·dt)` (low grip =
  drift); heading turns at `vf/wheelBase · tan(steer)` so turning scales with
  speed and reverses with reverse.
- `GAME_DRIVING = { makeState, defaultTuning, step, right }` is the door object.

## Per-style handling (handling.ts, req_0694)

One model, nine bodies, nine FEELS. `VEHICLE_HANDLING` is the authored
per-style override table (keyed by `VehicleStyleId`) and
`tuningForStyle(style)` is the door: baseline `defaultTuning` + the style's
overrides, wheelbase (`length · WHEELBASE_FRACTION`) and track width lifted
from `VEHICLE_STYLES` so the feel always matches the body on screen. The
sedan IS the baseline; the sports car is fast/low/darty and grips below the
tip line (spins, never trips itself); the van/ambulance/fire truck are slow,
understeery, top-heavy and WILL roll (tippable iff
`maxLatG > halfTrack/cgHeight` — asserted in `handling.test.ts`). The
handling lab loads a style's stock tuning on body pick and dials on top.

## Why cart-side

DECISIONS **V1**: physics is ONE coherent host-side system. This module lives
cart-side ON PURPOSE — it is the SHAPE-FINDING lab stage (the path
physics_lab/ragdoll_lab's Verlet took). It is pure + React-free so graduation
into the host sim is a behavior port, not a rewrite.

## Consumers

- `labs/vehicle-handling.tsx` — the first driving lab (now).
- `editors/play` `/test` route — next.
- host port — eventual (per V1).
