# @reactjit/cameras

The shared registry of **drop-in camera rigs** — the third leg of the declarative
3D stack, beside [`@reactjit/effects`](../effects) (WGSL shaders) and
[`@reactjit/geometries`](../geometries) (shape generators). A camera "approach"
(orbit, chase, overhead, isometric, first-person, free-fly, cinematic) lives here
**once**, and a cart swaps its entire camera in one line.

```tsx
import { OrbitCamera, TopDownCamera } from '@reactjit/cameras';

<Scene3D style={{ width: '100%', height: '100%' }}>
  <OrbitCamera   target={[px, 0, pz]} yaw={45} pitch={35} zoom={1.1} />
  {/* swap to a tactical overhead with one line — nothing else changes: */}
  <TopDownCamera target={[px, 0, pz]} height={22} />
  ...lights + meshes...
</Scene3D>
```

## The shape (same as geometries/effects)

A rig is a **pure solver** `(params) → Solved`:

```ts
type Solved = { pos: Vec3; target: Vec3; fov: number };
```

`Solved` is the universal currency: exactly what `<Scene3D.Camera>` consumes **and**
what `unprojectGround` inverts. That's the load-bearing design choice —

> **Picking depends only on `Solved`, never on the rig type.**

— so one generic `unprojectGround` serves every rig, and swapping `<OrbitCamera>`
for `<FirstPersonCamera>` doesn't break click-to-world. No per-rig picking code,
ever.

Each rig is a `CameraDef = { id, solve, defaults }` (mirrors `GeometryDef`). The
named drop-in components (`OrbitCamera`, …) are thin wrappers around one
`<CameraRig rig={...} {...params} />` helper.

## Units

All angle params are **degrees** — the new declarative convention (same as a mesh
`rotation` prop, which the host already reads as degrees). Conversion to radians
happens once, inside `_util.ts`. Don't pass `Math.PI/4`; pass `45`.

## The rigs

| Rig            | What it does | Key params |
| -------------- | ------------ | ---------- |
| `Orbit`        | Circles a target by yaw/pitch/zoom (GTA / RuneScape third-person). | `target, yaw, pitch, dist, zoom, fov` |
| `Follow`       | Trails a subject along its `heading`; author drives heading, not yaw. | `target, heading, distance, height, lookHeight, fov` |
| `TopDown`      | Tactical overhead, slightly tilted off vertical (Hitman / Schedule-1). | `target, height, tilt, heading, fov` |
| `Isometric`    | Fixed-angle ARPG view; long dist + narrow fov flattens to near-ortho. | `target, yaw, dist, fov` |
| `FirstPerson`  | Eye at the subject + `eyeHeight`, looks along `facing`+`pitch`. | `position, eyeHeight, facing, pitch, fov` |
| `FreeFly`      | Unconstrained debug/spectator; `position` is the eye. | `position, yaw, pitch, fov` |
| `Cinematic`    | Lerps between keyframed `Solved` waypoints by `t∈[0,1]` (smoothstep). | `waypoints, t, loop` |
| `Aim`          | Over-the-shoulder ADS (combat_lab graduation): shoulder-shifted, crouch-aware pivot with a *genuinely pitched* axis — full sky authority, no aim ceiling. | `target, yaw, pitch, crouch, shoulderShift, distance, fov` |

`Aim` also exports `aimPivot(params)` — the shoulder pivot the game-side
camera-collision clamp pulls the eye toward when cover intrudes (the clamp
itself needs physics, so it stays with the game). The **crosshair law**: fire
rays must read the solved camera's screen-center axis (`normalize(target - pos)`
— exactly `screenRay` at the rect center), never raw yaw/pitch trig.

## Modifiers — composable, pure

A `Modifier = (Solved) → Solved` perturbs a solved camera; they stack in order:

```tsx
import { OrbitCamera, sway, shake } from '@reactjit/cameras';

<OrbitCamera target={t} modifiers={[sway(highIntensity, clock), shake(0.05, clock)]} />
```

Modifiers are **pure** — time is passed in, never read from a global — so the cart
owns the clock and the same `t` always yields the same frame. `sway` is lifted from
scape3d's high-cam wobble; `shake` is impact jitter.

Smoothing is **not** a modifier (it needs the previous frame's value = state). Use
the `useSmoothed(solved, alpha)` hook to ease a Follow cam or a rig swap.

## Picking — the inverse path

```tsx
import { CAMERAS, solveCamera, unprojectGround } from '@reactjit/cameras';

// the SAME Solved the <*Camera> rendered:
const solved = solveCamera(CAMERAS[mode], params, modifiers);
const { x, y } = unprojectGround(sx, sy, sceneRect, solved, heightAt);
// x,y are world ground coords (3D z maps to y); drop a marker at [x, 0, y].
```

`sx,sy` are the click's pixel coords relative to the scene rect (capture the rect
via `onLayout`, subtract its origin from the event's `.x/.y` — see
`cart/camera_lab.tsx`). `heightAt` is optional (defaults to flat ground at y=0).

For non-ground hits (mesh AABBs, voxel faces, hitboxes), take the raw ray and
intersect it yourself — `unprojectGround` is just one consumer:

```ts
import { screenRay } from '@reactjit/cameras';

const { origin, dir } = screenRay(sx, sy, sceneRect, solved);
// intersect origin + t·dir against whatever is pickable
```

This is THE canonical pixel→ray (R7) — don't re-roll the view-basis math.

## Adding a rig

1. `runtime/cameras/rigs/MyRig.ts` — export `solve(params)`, `MY_RIG_DEFAULTS`, a
   `MyRigParams` type, and `export const MyRig: CameraDef<MyRigParams>`.
2. Re-export it + add to `CAMERAS` and a `MyRigCamera` drop-in in `index.tsx`.
3. Keep angle params in degrees; emit a clean `Solved`. Picking comes for free.
