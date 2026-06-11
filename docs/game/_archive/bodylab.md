# cart/bodylab/

> Directory-based cart with manifest. Built with `./tools/rjit ship bodylab`.

## What it is

A character body-type explorer that displays six stylized humanoid figures side-by-side in a 3D scene. Each figure is built from the same parametric skeleton but with different proportions, color palettes, head styles, and model-specific accessories (hats, bags, glasses, aprons, etc.). All six share one gait system and walk in place. The camera can be orbited by dragging, zoomed with scroll, and auto-rotated. Clicking a figure card in the bottom bar selects that figure and smoothly drifts the camera to center on them.

This cart demonstrates the **primitive-cluster** character approach: instead of a single baked mesh (like `Geometry.Humanoid`), a character is composed of many individual `Scene3D.Mesh` nodes (spheres, cylinders, boxes, cones, tori) that are positioned and rotated each frame by a parametric solver.

---

## File inventory

| File | Role |
|------|------|
| `cart/bodylab/cart.json` | Manifest: `{ name: "Body Lab", description: "...", width: 1280, height: 800 }`. |
| `cart/bodylab/index.tsx` | Main component. Defines six `FigureDef`s, animation loops, camera controls, UI panels, and renders the `Scene3D` scene with `HumanoidFigure`s. |
| `cart/bodylab/humanoid.tsx` | The parametric humanoid system: `drivePose()` (gait generator), `solveHumanoid()` (rig solver), and `HumanoidFigure()` (React renderer that emits `Scene3D.Mesh` clusters). |
| `runtime/primitives.tsx` | Exports `Box`, `Row`, `Col`, `Text`, `Pressable`, `Scene3D`. |
| `runtime/cameras/index.tsx` | Camera rig registry. `OrbitCamera` is used here. |
| `runtime/cameras/rigs/orbit.ts` | The `Orbit` rig: solves eye position from `target + yaw + pitch + dist`. |
| `runtime/geometries/index.ts` | Geometry registry. The cart uses `Box`, `Sphere`, `Cylinder`, `Cone`, `Torus`. |
| `runtime/geometries/intern.ts` | JS-side geometry interning. Each body part's `(geometry, params)` is cached so identical parts share vertex buffers across the bridge. |

---

## Dependencies and imports

### `index.tsx`

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Scene3D } from '@reactjit/primitives';
import { OrbitCamera } from '@reactjit/cameras';
import * as Geometry from '@reactjit/geometries';
import {
  drivePose, solveHumanoid, HumanoidFigure,
  DEFAULT_PROPORTIONS,
  type BodyProportions, type HumanoidPalette, type Vec3Tuple,
} from './humanoid';
```

### `humanoid.tsx`

```tsx
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
```

No host functions. No hooks from `@reactjit/runtime/hooks`. No file I/O, no network, no subprocess. Pure JS/React with primitives and geometries.

---

## Data model: FigureDef

```ts
type FigureDef = {
  id: string;
  label: string;
  desc: string;
  proportions: BodyProportions;
  palette: HumanoidPalette;
};
```

Six figures are defined inline in `index.tsx` (lines 43–329):

| ID | Label | Style notes |
|----|-------|-------------|
| `samir` | M: Samir | Warehouse dad: cap, beard, work vest, coffee cup. |
| `daniel` | M: Daniel | Office commuter: narrow shoulders, blazer, backpack, soft glasses. |
| `theo` | M: Theo | Bike courier: lean, hoodie, sling bag, scuffed sneakers. |
| `maya` | F: Maya | Studio teacher: tall, relaxed cardigan, necklace, tote bag. |
| `rosa` | F: Rosa | Market vendor: sturdy frame, braid, apron, hip pouch. |
| `nia` | F: Nia | Grad student: compact, big backpack, side buns, notebook. |

Each figure spreads `DEFAULT_PROPORTIONS` and overrides specific fields. Key proportion fields:

- `shoulderHalfWidth`, `hipHalfWidth`, `legHalfWidth` — silhouette width.
- `hipHeight`, `shoulderHeight`, `neckHeight`, `headCenterHeight`, `hatHeight` — vertical joint positions.
- `torsoWidth`, `torsoHeight`, `torsoDepth` — torso box dimensions.
- `thighLength`, `shinLength`, `upperArmLength`, `foreArmLength` — limb segment lengths.
- `headRadius`, `limbRadiusMul`, `jointRadiusMul`, `footRadius` — head and limb thickness.
- `chestRadius`, `buttRadius` — female-form volume spheres (only on female figures).
- `waistWidth`, `waistDepth` — belt/taper region.
- `headStyle` — `'cone' | 'hair' | 'mohawk' | 'braid' | 'goggles' | 'beard' | 'visor' | 'helmet'`.
- `modelStyle` — `'workdayDad' | 'officeCommuter' | 'bikeCourier' | 'studioTeacher' | 'marketVendor' | 'gradStudent'`.

The `palette` is a color map with slots: `skin`, `shirt`, `pants`, `shoe`, `hat`, `hair`, `eye`, `belt`, `nose`, `marker`, `accent`, `metal`, `trim`.

---

## Animation system

### `drivePose(t, moving, running)` (`humanoid.tsx`, lines 218–259)

A pure function that converts animation time into a `HumanoidPose`:

```ts
type HumanoidPose = {
  rootPitch: number; bodyY: number; torsoLean: number; headNod: number;
  leftLeg: number; rightLeg: number;
  leftKnee: number; rightKnee: number;
  leftArm: number; rightArm: number;
  armLift: number;
};
```

When `moving = false`, returns a static idle pose (slight knee bend, arms slightly out).

When `moving = true`, computes a sinusoidal gait:
- `phase = t * 5.0` (walk) or `t * 8.6` (run).
- Legs swing oppositely: `leftLeg = sin(phase) * amp`, `rightLeg = -sin(phase) * amp`.
- Knees bend on the back-swing: `knee = base + max(0, -sin(phase)) * bend`.
- Arms swing opposite to legs: `leftArm = -sin(phase) * armAmp`.
- Body bobs vertically: `bodyY = abs(cos(phase)) * bounce`.
- Torso leans forward (more when running).
- Head nods counter to the bounce.

### Animation clock (`index.tsx`, lines 357–375)

```tsx
useEffect(() => {
  const g: any = globalThis;
  const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
  let alive = true;
  let last = g.performance?.now?.() ?? Date.now();
  const loop = () => {
    if (!alive) return;
    const now = g.performance?.now?.() ?? Date.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    setClock((c) => c + dt);
    if (autoRotate) {
      setOrbitYaw((y) => y + dt * 12);
    }
    sched(loop);
  };
  sched(loop);
  return () => { alive = false; };
}, [autoRotate]);
```

- Uses `requestAnimationFrame` or `setTimeout(16)` fallback.
- Computes `dt` from `performance.now()` (or `Date.now()`), clamped to 50ms to avoid spiral on lag.
- Increments `clock` state every frame.
- If `autoRotate` is true, also increments `orbitYaw` at 12°/second.
- Only re-binds the effect when `autoRotate` changes (the `alive` flag handles cleanup).

### Camera target smoothing (`index.tsx`, lines 378–391)

A second `useEffect` loop runs independently:

```tsx
smoothTargetX.current += (targetX - smoothTargetX.current) * 0.08;
```

This is an exponential ease toward the selected figure's X position. The `smoothTargetX` ref is read directly in render (not via state) so the camera drifts smoothly without triggering React re-renders on every frame. The actual re-render is driven by the `clock` state from the first loop.

---

## Parametric solver (`solveHumanoid`, `humanoid.tsx`, lines 263–792)

Input: `base` (world position), `yawDegrees` (facing angle), `pose` (from `drivePose`), `prop` (`BodyProportions`).

Output: `{ parts: RigPart[], eye: Vec3Tuple }`

### Math helpers (lines 141–204)

- `radians()`, `degrees()` — conversions.
- `add(a, b)` — vector addition.
- `rotateY(v, yr)`, `rotateX(v, xr)` — rotate a vector around Y or X axis.
- `orient(v, yr, rootPitch)` — `rotateY(rotateX(v, rootPitch), yr)`.
- `point(base, local, yr, rootPitch)` — `base + orient(local, yr, rootPitch)`.
- `downDirection(swingDeg, sideDeg, yr, rootPitch)` — computes a limb direction vector from swing/side angles.
- `segmentPose(joint, length, swingDeg, sideDeg, yr, rootPitch)` — returns `{ center, end, rotation }` for a limb segment.
- `limbPart(seg, length, radius, slot)` — builds a `RigPart` using `Geometry.Cylinder`.

### Skeleton solve (lines 274–343)

1. Compute joint positions in world space:
   - `hipL`, `hipR` — left/right hip joints.
   - `shoulderL`, `shoulderR` — left/right shoulder joints.
2. Solve limb segments:
   - `thighL/R` — from hip to knee.
   - `shinL/R` — from knee to ankle.
   - `upperArmL/R` — from shoulder to elbow.
   - `foreArmL/R` — from elbow to wrist.
3. Compute `footL/R`, `neck`, `head` positions.

All positions are transformed by `yawRadians` and `rootPitch` so the figure faces the correct direction and leans.

### Part emission (lines 361–789)

The solver pushes `RigPart` objects into a flat array. Each part is:

```ts
type RigPart = {
  geometry: GeometryDef;
  params: Record<string, number>;
  position: Vec3Tuple;
  rotation?: Vec3Tuple;
  slot: MaterialSlot;
};
```

**Body parts emitted:**
- Legs: 2 thighs (`Cylinder`, `pants`), 2 shins (`Cylinder`, `pants`), 2 feet (`Sphere`, `shoe`).
- Butt volume: optional `Box` for female figures with `buttRadius > 0`.
- Torso: `Box` (`shirt`), optional waist `Box` (`belt`).
- Chest: optional `Sphere` pair for female figures with `chestRadius > 0`.
- Arms: 2 shoulder joints (`Sphere`, `shirt`), 2 upper arms (`Cylinder`, `shirt`), 2 forearms (`Cylinder`, `shirt`), 2 hands (`Sphere`, `skin`).
- Head: neck (`Cylinder`, `skin`), head (`Sphere`, `skin`), 2 eyes (`Box`, `eye`), nose (`Cone`, `nose`).
- Head style: cone cap, hair sphere, mohawk spikes, braid spheres, goggles torus, beard spheres, visor box, or helmet sphere.
- Model style: accessory boxes/cylinders/spheres/tori attached per archetype (coffee cup, backpack, apron, necklace, etc.).

All geometries come from `@reactjit/geometries`: `Box`, `Sphere`, `Cylinder`, `Cone`, `Torus`.

---

## Renderer (`HumanoidFigure`, `humanoid.tsx`, lines 796–832)

A React component that takes `rig` (from `solveHumanoid`) and `palette`:

```tsx
export function HumanoidFigure({ rig, palette, marker }) {
  return (
    <>
      {marker && (
        <>
          <Scene3D.Mesh geometry={Geometry.Cylinder} ... material={palette.marker} />
          <Scene3D.Mesh geometry={Geometry.Torus} ... material={palette.marker} />
        </>
      )}
      {rig.parts.map((part, i) => (
        <Scene3D.Mesh
          key={i}
          geometry={part.geometry}
          params={part.params}
          material={palette[part.slot] ?? palette.shirt}
          position={part.position}
          rotation={part.rotation}
        />
      ))}
    </>
  );
}
```

- Emits one `Scene3D.Mesh` per `RigPart`.
- Material color is resolved from `palette[slot]` with fallback to `palette.shirt`.
- `marker` is an optional ground marker (cylinder + torus ring) used for selection indication.
- No `key` on individual parts other than array index — since the parts array is rebuilt every frame, index is stable enough for reconciler diffing.

**Important**: This is NOT `Geometry.Humanoid` (the single baked mesh from `@reactjit/geometries`). This is the **primitive-cluster** approach: dozens of small meshes per character, positioned and rotated by the solver. The advantage is dynamic posing; the cost is many more bridge nodes and draw calls.

---

## Main component (`BodyLab`, `index.tsx`, lines 339–605)

### State

```tsx
const [selectedId, setSelectedId] = useState<string | null>(null);
const [moving, setMoving] = useState(true);
const [autoRotate, setAutoRotate] = useState(false);
const [orbitYaw, setOrbitYaw] = useState(20);
const [orbitPitch, setOrbitPitch] = useState(18);
const [dist, setDist] = useState(13);
const [clock, setClock] = useState(0);
```

### Camera controls

- **Orbit drag**: `onMouseDown`/`Move`/`Up` on the outer `Pressable`. Yaw accumulates with horizontal drag; pitch clamps to `[4, 80]`.
- **Zoom**: `onWheel` adjusts `dist` in `[4, 22]`.
- **Auto-rotate**: toggle button spins yaw at 12°/sec.
- **Reset cam**: button resets yaw/pitch/dist and deselects.
- **Selection drift**: when a figure is selected, `smoothTargetX` eases toward the figure's X position, and the `OrbitCamera` targets `[smoothTargetX.current, 1.15, 0]`.

### Static scene (`useMemo`, lines 418–445)

```tsx
const staticScene = useMemo(() => (
  <>
    <Scene3D.AmbientLight color="#4a5a78" intensity={0.6} />
    <Scene3D.DirectionalLight direction={[0.45, 0.85, 0.35]} color="#ffdfc0" intensity={0.9} />
    <Scene3D.PointLight position={[8, 7, 6]} color="#ff8c42" intensity={0.35} />
    <Scene3D.PointLight position={[-8, 5, -4]} color="#4ecdc4" intensity={0.3} />
    <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 30, height: 0.15, depth: 10 }} material="#0f172a" position={[0, -0.075, 0]} />
    {FIGURE_DEFS.map((_, i) => (
      <Scene3D.Mesh key={i} geometry={Geometry.Cylinder} params={{ radius: 0.85, height: 0.06, segments: 24 }} material="#1e293b" position={[figureX(i), 0.03, 0]} />
    ))}
  </>
), []);
```

Memoized with empty deps so it never re-renders. Contains:
- Ambient + directional + two point lights.
- Ground slab (`Box`, 30×0.15×10).
- One small platform cylinder under each figure.

### Figure placement

```tsx
const SPACING = 2.4;
function figureX(i) { return (i - (FIGURE_DEFS.length - 1) / 2) * SPACING; }
```

Six figures spaced 2.4 units apart, centered on the origin.

### Per-frame render (lines 543–549)

```tsx
{FIGURE_DEFS.map((def, i) => {
  const t = clock + i * 0.85;  // phase offset so they don't march in lockstep
  const pose = drivePose(t, moving, false);
  const base: Vec3Tuple = [figureX(i), 0, 0];
  const rig = solveHumanoid(base, 180, pose, def.proportions);
  return <HumanoidFigure key={def.id} rig={rig} palette={def.palette} />;
})}
```

Each figure gets:
- A unique time offset (`i * 0.85`) so their gaits are desynchronized.
- `yawDegrees = 180` (facing toward the camera).
- Its own `proportions` and `palette`.

### UI panels

**Title bar** (top):
- "BODY LAB" heading + subtitle.
- Toggle buttons: `walking`/`idle`, `rotate on`/`off`, `reset cam`.

**Figure cards** (bottom, scrollable row):
- One card per `FigureDef`.
- Clicking selects/deselects. Selected card gets accent border and bold text.
- Shows a color swatch (`palette.shirt`), label, and description.

---

## Bridge / host data flow

This cart generates a **large number** of `Scene3D.Mesh` nodes per frame:

- 6 figures × ~30–50 parts each = ~180–300 mesh nodes.
- Plus ground, platforms, lights, camera = ~300+ nodes total.

Each `Scene3D.Mesh` goes through the standard geometry interning path (`runtime/geometries/intern.ts`):
1. `isGeometryDef()` returns `true`.
2. `internGeometry(geometry, params)` computes a stable key.
3. Most body parts reuse the same geometry+params (e.g. all eyes use `Box` with the same size, all thighs use `Cylinder` with similar radius), so the JS cache and host GPU cache deduplicate heavily.
4. However, **transform props** (`position`, `rotation`) change every frame for every moving part, so those cross the bridge every tick.

The `staticScene` is memoized and only emits transform props once.

---

## Glossary of concepts present in this cart

| Term | Meaning in this cart |
|------|----------------------|
| **Primitive-cluster character** | A character built from many small primitive meshes (spheres, cylinders, boxes) positioned by a solver, rather than a single baked mesh. Enables dynamic posing but costs more draw calls. |
| **RigPart** | A single body part descriptor: `{ geometry, params, position, rotation, slot }`. |
| **MaterialSlot** | A semantic color slot (`skin`, `shirt`, `pants`, `shoe`, `hat`, `hair`, `eye`, `belt`, `nose`, `marker`, `accent`, `metal`, `trim`). The palette maps slots to hex colors. |
| **BodyProportions** | A flat struct of ~20 numbers defining a character's skeletal proportions: limb lengths, joint heights, torso dimensions, radius multipliers. |
| **HeadStyle** | One of `cone`, `hair`, `mohawk`, `braid`, `goggles`, `beard`, `visor`, `helmet`. Determines which primitive cluster is added on top of the head sphere. |
| **ModelStyle** | One of `workdayDad`, `officeCommuter`, `bikeCourier`, `studioTeacher`, `marketVendor`, `gradStudent`. Determines accessory primitives (bags, glasses, aprons, etc.). |
| **drivePose()** | The gait generator. Converts animation time into joint angles for a walk/run/idle cycle using sinusoidal phases. |
| **solveHumanoid()** | The rig solver. Converts `BodyProportions + HumanoidPose + yaw` into a flat array of `RigPart`s with world-space positions and rotations. |
| **HumanoidFigure** | The React renderer. Maps `RigPart[]` to `Scene3D.Mesh` nodes. |
| **Phase offset** | Each figure adds `i * 0.85` to the animation clock so their gaits are desynchronized. |
| **smoothTargetX** | A `useRef` used for exponential camera drift toward a selected figure. Read directly in render (not state) to avoid per-frame re-renders. |
| **OrbitCamera** | Camera rig solving eye position from `target + yaw + pitch + dist`. |
| **Animation loop** | `requestAnimationFrame`-based loop computing `dt` from `performance.now()`. Drives `clock` state and optional auto-rotate. |
| **useMemo static scene** | Lights and ground are wrapped in `useMemo([], …)` so they don't rebuild their React subtree every frame. |

---

## What this cart does NOT do

- **No `Geometry.Humanoid`** — it uses the primitive-cluster approach instead of the single baked humanoid mesh from `@reactjit/geometries`.
- **No textures** — all materials are solid hex colors from the palette.
- **No host functions** — no file I/O, network, clipboard, store, or subprocess.
- **No picking / raycasting** — selection is done via UI cards, not by clicking on 3D figures.
- **No inverse kinematics** — limb angles are driven by sinusoidal gait, not by foot placement targets.
- **No shadow casting** — the ground is a dark slab; no shadow maps.
- **No fog / skybox** — flat background color (`#0a1020`).
