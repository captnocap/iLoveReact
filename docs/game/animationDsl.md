# cart/animationDsl.ts

> Pure TypeScript module. No React component, no `cart.json`. Imported as a shared library by multiple carts.

## What it is

A string-based animation timeline DSL parser and sampler. It takes human-readable animation descriptions like `"2, arm, raise; 1, head, nod | 3, wheels, spin_loop"` and turns them into a structured timeline that can be sampled at arbitrary time points to produce weighted action commands. This is the animation instruction layer for the primitive-cluster character and vehicle systems — it does not drive geometry directly, but produces `SampledAction` descriptors that consumers (e.g. `buildVehicle`, `HumanoidFigure`-like renderers) translate into mesh transforms.

---

## File inventory

| File | Role |
|------|------|
| `cart/animationDsl.ts` | The entire module — types, parser, sampler, and target alias table. |
| `cart/vehicle_lab/index.tsx` | Consumer. Parses vehicle pose DSLs and feeds `SampledAction[]` into `buildVehicle()`. |
| `cart/pathing_lab/index.tsx` | Consumer. Imports `SampledAction` type; constructs actions programmatically for moving vehicles. |
| `cart/head_lab/animDsl.ts` | Re-export shim: `export * from '../animationDsl';` |

---

## Dependencies and imports

```ts
// None. This file has zero imports.
```

It is a self-contained pure-JS/TS module with no dependency on React, primitives, geometries, or host functions.

---

## Types

### `TimelineAction`

```ts
type TimelineAction = {
  duration: number;   // seconds
  target: string;     // canonical target name (e.g. 'left_arm', 'wheels')
  action: string;     // canonical action name (e.g. 'raise', 'spin_loop')
  args: string[];     // extra normalized string arguments
};
```

A single action within a timeline step.

### `TimelineStep`

```ts
type TimelineStep = {
  duration: number;         // max duration of actions in this step
  actions: TimelineAction[];
};
```

A parallel group of actions. All actions in a step start together; the step's duration is the longest action duration in the group.

### `AnimationTimeline`

```ts
type AnimationTimeline = {
  steps: TimelineStep[];
  total: number;            // sum of all step durations
  error?: string;           // set if parsing yields no valid steps
};
```

The parsed product. `total` is the non-looping playback length.

### `SampledAction`

```ts
type SampledAction = {
  target: string;
  action: string;
  phase: number;    // 0..1 progress through the action's duration
  weight: number;   // sin(phase * π) — ease-in-out curve
  args: string[];
};
```

The runtime sample product. Consumers read `phase` and `weight` to interpolate transforms.

---

## DSL syntax

### Action string format

```
<duration>, <target>, <action>[, <arg1>, <arg2>, ...]
```

- `duration`: number in seconds. Must be finite and > 0.
- `target`: body part / vehicle part name. Aliases are expanded (see below).
- `action`: verb describing the motion. Normalized to lowercase with underscores.
- `args`: optional trailing arguments, also normalized.

### Step grouping

Two equivalent syntaxes:

1. **Bracket syntax**: `[2, arm, raise; 1, head, nod]` — actions inside brackets run in parallel.
2. **Pipe syntax**: `2, arm, raise | 1, head, nod` — pipe-separated chunks run sequentially.

Within a bracket/pipe chunk, actions are separated by `;`.

### Examples

```
[2, arm, raise; 1, head, nod] | 3, wheels, spin_loop
```

- Step 1 (2 seconds): `arm raise` and `head nod` run together. Step duration = max(2, 1) = 2.
- Step 2 (3 seconds): `wheels spin_loop`.
- Total = 5 seconds.

---

## Target aliases (lines 29–79)

`canonicalTarget()` normalizes input (`trim().toLowerCase().replace(/[\s-]+/g, '_')`) then looks up in `TARGET_ALIASES`:

| Alias | Canonical |
|-------|-----------|
| `arm`, `arms`, `both_arm` | `both_arms` |
| `l_arm` | `left_arm` |
| `r_arm` | `right_arm` |
| `hand`, `hands`, `both_hand` | `both_hands` |
| `l_hand` / `r_hand` | `left_hand` / `right_hand` |
| `wrist`, `wrists`, `both_wrist` | `both_wrists` |
| `l_wrist` / `r_wrist` | `left_wrist` / `right_wrist` |
| `fist`, `fists`, `both_fist` | `both_fists` |
| `l_fist` / `r_fist` | `left_fist` / `right_fist` |
| `finger`, `fingers`, `both_finger` | `both_fingers` |
| `l_finger` / `r_finger` | `left_finger` / `right_finger` |
| `leg`, `legs`, `both_leg` | `both_legs` |
| `l_leg` / `r_leg` | `left_leg` / `right_leg` |
| `foot`, `feet`, `both_foot` | `both_feet` |
| `l_foot` / `r_foot` | `left_foot` / `right_foot` |
| `head_face`, `face_target` | `face` |
| `grab_face` | `face_grab` |
| `car`, `auto`, `body_shell` | `vehicle` |
| `front_wheel` | `front_wheels` |
| `rear_wheel` | `rear_wheels` |
| `tire`, `tires`, `wheel` | `wheels` |
| `steering` | `front_wheels` |
| `shocks`, `shock` | `suspension` |

Unknown targets pass through unchanged after normalization.

---

## API

### `parseAnimationDsl(source: string): AnimationTimeline`

Parses a DSL string into a timeline.

Algorithm (lines 99–121):
1. Trim input. Empty → `{ steps: [], total: 0 }`.
2. Extract bracket groups `[...]` via regex `/\[([^\]]+)\]/g`.
3. If no brackets, fall back to splitting on `\s*\|\s*`.
4. For each chunk:
   - Split on `;`.
   - Parse each segment with `parseAction()`.
   - `parseAction` splits on `,`, trims, requires ≥3 parts, validates `duration` is finite and > 0.
   - Build `TimelineStep` with `duration = max(action durations)`.
5. Sum step durations into `total`.
6. If no steps parsed, set `error: 'no timeline actions parsed'`.

### `sampleAnimationTimeline(timeline, seconds): SampledAction[]`

Samples the timeline at a given time.

Algorithm (lines 123–148):
1. If `total <= 0` or no steps, return `[]`.
2. Determine looping: calls `isAnimationTimelineLooping()`.
3. If looping: `t = seconds % total`.
4. If not looping: clamp `t` to `[0, total)`.
5. Walk steps sequentially, subtracting step durations from `t`.
6. When the current step is found, map each of its actions:
   - `phase = clamp01(t / action.duration)` — 0 at start, 1 at end.
   - `weight = Math.sin(phase * Math.PI)` — sinusoidal ease-in-out (0→1→0).
   - Return `SampledAction` with target, action, phase, weight, args.

### `isAnimationTimelineLooping(timeline): boolean`

Returns `true` if any action in any step has an action name ending in `_loop` or exactly `shake_in_air`. This flag changes the sampling behavior from clamp to modulo.

---

## Consumer usage patterns

### `vehicle_lab/index.tsx`

```tsx
const animation = VEHICLE_POSES[pose];
const timeline = useMemo(() => parseAnimationDsl(animation.dsl), [animation.dsl]);
const sampledActions = useMemo(() => sampleAnimationTimeline(timeline, seconds), [timeline, seconds]);
const build = useMemo(() => buildVehicle(doc, sampledActions), [doc, sampledActions]);
```

- Pose DSLs are stored in a `VEHICLE_POSES` registry.
- `buildVehicle()` takes `SampledAction[]` and translates actions like `spin_loop` into wheel rotation angles, `steer_loop` into front wheel yaw, `bounce_loop` into suspension displacement, etc.

### `pathing_lab/index.tsx`

```tsx
const actions: SampledAction[] = [
  { target: 'wheels', action: 'spin_loop', phase: ((car.odometer / car.wheelCirc) * 0.5) % 1, weight: 1, args: [] },
  { target: 'front_wheels', action: 'steer_loop', phase: Math.asin(clamp(steerDeg / 24)) / (Math.PI * 2), weight: 1, args: [] },
];
```

- Constructs `SampledAction` objects directly (bypassing the DSL parser) for procedural animation driven by simulation state (odometer, steering angle).

---

## Glossary of concepts present in this module

| Term | Meaning |
|------|---------|
| **Animation DSL** | A compact string syntax for describing parallel/sequential animation actions on named targets. |
| **TimelineAction** | A single parsed instruction: `{ duration, target, action, args }`. |
| **TimelineStep** | A parallel group of actions. All start together; step duration = longest action. |
| **Bracket syntax** | `[action1; action2]` groups actions into one step. |
| **Pipe syntax** | `action1 | action2` separates sequential steps. |
| **Canonical target** | Normalized + alias-resolved target name. E.g. `arm` → `both_arms`. |
| **SampledAction** | A runtime-evaluated action with `phase` (0..1 progress) and `weight` (sinusoidal ease curve). |
| **Looping detection** | Any action ending in `_loop` (or `shake_in_air`) makes the entire timeline loop via modulo time. |
| **Sinusoidal weight** | `Math.sin(phase * π)` — rises to 1 at midpoint, falls to 0 at end. Used for ease-in-out interpolation. |

---

## What this module does NOT do

- **No React** — pure functions, no JSX, no hooks, no component.
- **No geometry** — it does not emit meshes, positions, or rotations. It only produces action descriptors.
- **No host functions** — no file I/O, network, subprocess, or bridge calls.
- **No easing curves besides sinusoidal** — `weight` is always `sin(phase * π)`. Consumers may apply additional curves.
- **No interpolation between steps** — sampling returns the current step's actions only; there is no cross-fade from the previous step.
