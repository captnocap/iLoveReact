# Capture note — game/camera.ts (V3, capture wave 2026-06-05)

The camera system per the ruled split: **the registry stays in `runtime/`;
the combat_lab ADS aim rig and the generic screenRay GRADUATE INTO
`runtime/cameras/`** (the one capture whose implementation home is runtime/ —
V3 + STRUCTURE rule it so); `game/camera.ts` is the game-facing door behind
the existing `GAME_CAMERA` export. References untouched.

## Sources (read, never moved/copied/imported-from-cart)

| piece | old file | what it contained |
|---|---|---|
| the ADS aim rig | `cart/combat_lab/index.tsx:458-507` (`AIM_CAMERA` + `shoulderCamera`) | orbit a shoulder-shifted (0.62m), crouch-aware (1.62m − crouch·0.42m) pivot with a genuinely pitched forward axis; 2.4m back (ADS framing vs the 5.9m follow cam), look target 12m ahead, fov 47, pitch clamps widened to −1.0/+1.15 rad ("aiming needs the sky") |
| rig constants | `cart/hmsc/gameplay/camera.ts` (`HMSC_GAMEPLAY_CAMERA`) | `aimShoulderShiftMeters 0.62`, `aimFovDegrees 47` (only the aim-side values; the follow cam is already the registry's business) |
| screenRay | `cart/hmsc-int/assist3d/picking.ts` (+ the same math in `cart/voxel_stack_demo/index.tsx:137`, `cart/hmsc-int/VoxelHybridRoute.tsx`, and inline in `runtime/cameras/unproject.ts`) | pixel → world ray: rebuild the m4lookAt view basis, NDC → view ray, world ray |

## What landed where

- `runtime/cameras/rigs/aim.ts` — the `Aim` CameraDef, REWRITTEN fresh.
  Every reference value is an overridable param default (P2). `aimPivot`
  exported for the camera-collision clamp (see "not carried").
- `runtime/cameras/unproject.ts` — `screenRay` is now the canonical exported
  pixel→ray; `unprojectGround` rewritten as its consumer (the R7 fix verbatim).
- `runtime/cameras/index.tsx` — `Aim`/`AIM_DEFAULTS`/`aimPivot`/`AimCamera`
  drop-in + `CAMERAS.Aim`; `screenRay` exported.
- `cart/hmsc-int/game/camera.ts` — the door grows `screenRay`, `aimPivot`,
  and `rigs.Aim` (8 rigs). Still pure — headless verify solves cameras with
  no React.
- Hand-roll retirements **in the active cart only**: `assist3d/picking.ts`
  and `VoxelHybridRoute.tsx` now import the registry's screenRay. The copies
  in `cart/voxel_stack_demo` and `cart/combat_lab` stay — old carts are
  read-only capture sources; V3's "holdouts are deleted" completes when the
  labs are rebuilt/archived (V17-LIFECYCLE).

## Verification

- `game/camera.test.ts`: **13/13** P4 tests green under v8cli.
- **Fidelity sweeps (the accepted bar):**
  - Aim: **1,728 cases identical** (24 yaws × 8 pitches across the clamp
    range × 3 crouch levels × 3 positions; pos/target to 1e-9, fov exact)
    against a verbatim transcription of `shoulderCamera`'s aiming branch.
  - screenRay: **150 cases identical** (6 solved cameras across 5 rigs ×
    5×5 pixel grid; origin/dir to 1e-12) against a verbatim transcription of
    the assist3d hand-roll.
- Meaning tests pin the WHY: the aim ceiling is gone (screen-axis elevation
  == the pitch param; Follow contrasted), the crosshair law (center ray IS
  `normalize(target−pos)`, every rig), clamps hold, shoulder offset is
  perpendicular to the aim, crouch drops eye+target by exactly `crouchDrop`,
  ADS distance invariant under pitch, unprojectGround hits lie on the pixel
  ray.
- `rjit game verify`: camera suite green inside the run. The run's single RED
  at capture time was `game/index` expecting GAME_CUTSCENE to be
  capture-pending — another worker's in-flight cutscene capture, not camera.

## Shape decisions

- **Conventions normalized to the registry** (angles in DEGREES; pitch + = up,
  like Orbit's elevation). The reference spoke mixed units (yaw degrees,
  pitch RADIANS with + = down); the sweep maps `pitch = −pitchRadians/DEG`
  and proves bit-level equivalence. The radian clamps carry exactly as
  `−1.15/DEG` / `1.0/DEG` — written as expressions so the limits stay
  bit-identical to the reference.
- **Pivot height generalized**: the reference pinned the pivot Y to an
  absolute `1.62 − crouch·0.42` (player always at ground 0); the rig adds it
  to `target[1]`, identical when the subject stands at y=0 (the swept case)
  and correct on raised ground.
- **Clamping lives in solve**: the reference clamped pitch in its input
  integration, keeping `shoulderCamera` clamp-free. The rig clamps inside
  solve so no consumer can aim past the ruled limits; in-range inputs are
  untouched (fidelity unaffected).
- **The crosshair law is a carried contract, not code**: fire rays must read
  the solved camera's screen-center axis (`normalize(target−pos)` ==
  `screenRay` at the rect center — asserted by test). Deriving a fire ray
  from yaw/pitch trig diverges from the crosshair by meters at combat range
  (combat_lab hazard).

## Deliberately NOT carried

- **The camera-collision clamp** (`nearestCoverT` pulling the eye toward the
  pivot when cover blocks the pivot→eye segment, combat_lab:1117-1126) —
  needs physics/cover queries, cross-system; `aimPivot` is exported as its
  seam. Surfaced, not implemented.
- **The follow-cam branch of `shoulderCamera`** — the aim ceiling IS that
  camera's defect; the registry already has Follow. The aim↔follow blend on
  RMB (state + smoothing) is game-loop behavior, not a pure rig.
- **Mouse transport** (`readHostMouseDelta`, `__mouse_capture`, RMB polling)
  — GAME_INPUT territory (V7: transport only).
- **The crosshair UI** (`AimCrosshair` JSX) — chrome, not camera math.
- **assist3d's AABB slab pick (`pickMesh`)** — an editor picking consumer,
  not registry business; R7 exports only the ray. It stays in assist3d,
  now consuming the graduated screenRay.

## Conflicts / ambiguities surfaced (NOT silently picked)

1. **Yaw-convention fork inside the registry**: Aim (and Follow, and the
   reference) use forward `[sin yaw, 0, cos yaw]` (positive yaw → +X);
   `_util.lookForward` (FirstPerson/FreeFly) deliberately uses the FPS
   convention `[−sin yaw, …]`. Both now coexist; Aim sides with
   Follow + the reference so the fidelity sweep maps 1:1. Flagged — if the
   registry ever unifies yaw, Aim's sweep documents the current sense.
2. **`minPitch`/`maxPitch` as data**: the defaults are radian-derived
   expressions (`−1.15/DEG`), not round numbers. P2-loadable and overridable,
   but a tuning UI will show 65.89…°; rounding them would shift the clamp off
   the reference. Left exact.
3. **One-token-rule compliance**: `game/index.ts` untouched (GAME_CAMERA and
   its type line already existed). The new `AimParams`/`ScreenRay` types are
   exported from `game/camera.ts` but NOT re-exported through `game/index.ts`
   — adding them there was ruled out by the don't-touch-the-door instruction.
   Labs reach them via `@reactjit/cameras`; flagged for the supervisor.
