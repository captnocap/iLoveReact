# cart/skybox_demo.tsx

> Single-file cart. No `cart.json` manifest. Built with `./scripts/ship skybox_demo` (or `./tools/rjit ship skybox_demo`).

## What it is

A live demonstration of the analytic procedural skybox system (`<Scene3D.Skybox>`). It shows a 3D scene with a day/night cycle, weather transitions, and per-zone mood blending — all driven by uniforms that lerp every frame. The sky is not an image or cubemap; it is a single fullscreen shader pass that reconstructs view rays per pixel and paints a gradient, sun, haze, drifting 2-D clouds, and night stars. The cart also demonstrates automatic distance fog that melts geometry into the horizon color.

---

## File inventory

| File | Role |
|------|------|
| `cart/skybox_demo.tsx` | The entire cart — sky state machine, day-cycle animation loop, UI controls, and 3D scene composition. |
| `runtime/primitives.tsx` | Exports `Box`, `Row`, `Col`, `Text`, `Pressable`, `Scene3D`, plus `Scene3D.Camera`, `Scene3D.Skybox`, `Scene3D.AmbientLight`, `Scene3D.DirectionalLight`, `Scene3D.Mesh`, `Scene3D.Fog`. |
| `runtime/geometries/index.ts` | Geometry registry. The cart imports `* as Geometry` to access `Geometry.Box`, `Geometry.Sphere`, `Geometry.Cylinder`. |
| `runtime/geometries/intern.ts` | JS-side geometry interning (caches vertex arrays by stable key, deduplicates bridge shipment). Used implicitly by `Scene3D.Mesh`. |
| `framework/gpu/3d.zig` | Host-side 3D renderer. Contains `drawSky()` (fullscreen triangle sky pass), `drawScene()` (camera/fog/light extraction, mesh culling, draw call batching), and the `SkyUniforms` std140 layout. |
| `framework/gpu/shaders.zig` | Contains `skybox_wgsl` — the analytic sky shader (gradient + sun disk + glow + haze + fbm clouds + hashed stars). Also contains the mesh fragment shader that samples the sky gradient for aerial-perspective fog. |

---

## Dependencies and imports

```tsx
import { useEffect, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
```

- **React** — `useState` (sky params, UI state), `useEffect` (animation loop), `useRef` (play-state mirror for the loop).
- **Primitives** — layout primitives (`Box`, `Col`, `Row`, `Text`, `Pressable`) and the full `Scene3D` family (`Camera`, `Skybox`, `AmbientLight`, `DirectionalLight`, `Mesh`).
- **Geometries** — imports the registry as a namespace (`Geometry.Box`, `Geometry.Sphere`, `Geometry.Cylinder`). These are baked/registered geometry defs with `id`, `defaults`, and `generate()`.

No host functions (`__fs_*`, `__http_*`, `__exec`, etc.) are called. No `__registerDispatch`. The animation loop uses `requestAnimationFrame` or `setTimeout` from the global JS environment.

---

## State model

```tsx
const [hour, setHour] = useState(12);       // 0..24, fractional (e.g. 12.5 = 12:30)
const [weather, setWeather] = useState(0);  // 0 = clear, 1 = storm
const [gloom, setGloom] = useState(0);      // 0 = normal, 1 = gloom zone
const [playing, setPlaying] = useState(true);
const playRef = useRef(playing);
playRef.current = playing;
```

`hour` is the single source of truth for the day cycle. `weather` and `gloom` are overlay blends. All other sky values (colors, sun direction, light intensity, cloud coverage, haze, etc.) are derived from these three numbers by pure functions.

---

## Animation loop (lines 175–187)

```tsx
useEffect(() => {
  const g: any = globalThis;
  const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
  const cancel = g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : clearTimeout;
  let handle: any = 0;
  const loop = () => {
    if (playRef.current) setHour((h) => (h + 0.03) % 24);
    handle = sched(loop);
  };
  handle = sched(loop);
  return () => cancel(handle);
}, []);
```

- Uses `globalThis.requestAnimationFrame` if available (V8 path), otherwise falls back to `setTimeout(fn, 16)`.
- The loop increments `hour` by `0.03` per frame, wrapping at 24. At 60fps this is ~1.8 game-hours per second (~13 seconds for a full day).
- `playRef` is a ref mirror of `playing` so the loop can read the latest value without closing over stale state.
- No `__jsTick` involvement; this is a self-scheduling JS animation loop.

---

## Sky state computation (pure functions, lines 46–140)

### Color helpers (lines 27–44)

All pure JS, no framework dependency:

- `hexToRgb(h)` — converts `#rrggbb` or `#rgb` to `[r, g, b]` (0–255).
- `rgbToHex([r,g,b])` — clamps, rounds, and pads back to `#rrggbb`.
- `lerp(a, b, t)` — linear interpolation.
- `mixHex(a, b, t)` — converts both hexes to RGB, lerps channel-wise, converts back.
- `clamp01(v)` — saturates to `[0, 1]`.
- `smooth(a, b, x)` — smoothstep (Hermite interpolation), used for night ramp.

### Day keyframes (`KEYS`, lines 55–64)

Eight keyframes spanning hours 0–24 with `zenith`, `horizon`, and `sun` hex colors.

### `dayKey(hour)` (lines 66–77)

Finds the two surrounding keyframes, computes normalized `t`, and returns lerped `zenith`, `horizon`, and `sun` colors.

### `sunDirFor(hour)` (lines 79–83)

Maps hour to a sun arc: rises at ~06:00 in the east (+x), peaks at noon (+y), sets at ~18:00 in the west (-x). Returns `[cos(a), sin(a), 0.22]` where `a = ((hour - 6) / 12) * π`.

### `buildSky(hour, weather, gloom)` (lines 86–140)

The main sky builder. Returns a `Sky` object:

```ts
type Sky = {
  zenith: string; horizon: string; ground: string;
  sunDir: [number, number, number];
  sunColor: string;
  sunSize: number; sunGlow: number; haze: number; cloud: number; night: number;
  ambient: number; lightColor: string; lightI: number;
};
```

Steps:
1. **Base day state** from `dayKey(hour)` + `sunDirFor(hour)`.
   - `night` ramps in via `smooth(0.04, -0.18, sunElevation)`.
   - `day` = `clamp01(elev * 1.4)`.
   - Default `sunSize = 0.018`, `sunGlow` and `haze` lerp with day, `cloud = 0.14`.
   - `ambient`, `lightColor`, `lightI` derived from sun elevation.
2. **Weather blend** (if `weather > 0.001`):
   - Colors shift toward grey `#5a626e`.
   - `cloud` → up to 0.9, `haze` → up to 0.72, `sunGlow` → up to 0.85.
   - `lightI` and `ambient` dim.
3. **Gloom blend** (if `gloom > 0.001`):
   - Sickly grey-green pall (`#3b4a3f`).
   - `zenith` → `#1a221c`, `horizon` → pall, `ground` → `#10130f`.
   - `cloud` → 0.8, `haze` → 0.6, `lightI` and `ambient` drop.
   - `lightColor` shifts toward `#9fb29a`.

This function is called every render (line 189) with the current `hour`, `weather`, `gloom` values.

---

## Render tree

```tsx
<Box style={{ width: '100%', height: '100%', backgroundColor: '#04060c' }}>
  <Scene3D style={{ width: '100%', height: '100%' }}>
    <Scene3D.Camera position={[0, 3.2, 13]} target={[0, 1.4, 0]} fov={56} />

    <Scene3D.Skybox
      zenith={sky.zenith} horizon={sky.horizon} ground={sky.ground}
      sunDir={sky.sunDir} sunColor={sky.sunColor}
      sunSize={sky.sunSize} sunGlow={sky.sunGlow}
      haze={sky.haze} cloud={sky.cloud} night={sky.night}
    />

    <Scene3D.AmbientLight color={sky.horizon} intensity={sky.ambient} />
    <Scene3D.DirectionalLight direction={sky.sunDir} color={sky.lightColor} intensity={sky.lightI} />

    {/* Ground plane */}
    <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 60, height: 0.2, depth: 60 }}
      material="#2b3326" position={[0, -0.1, -4]} />

    {/* 7 props: boxes, spheres, cylinders */}
    {PROPS.map((p, i) => …)}
  </Scene3D>

  {/* UI overlay: top-left controls, bottom-right CAN/CAN'T panels */}
</Box>
```

### Camera

- Position `[0, 3.2, 13]`, looking at `[0, 1.4, 0]`, FOV 56°.
- No explicit `far` or `near` — host auto-derives draw radius from scene extent.

### Skybox

The `<Scene3D.Skybox>` component (defined in `runtime/primitives.tsx`, lines 478–492) converts the string/numeric props into host node props:

| Prop | Host prop | Default |
|------|-----------|---------|
| `zenith` | `scene3dSkyZenith` | `[0.16, 0.33, 0.62]` |
| `horizon` | `scene3dSkyHorizon` | `[0.62, 0.72, 0.86]` |
| `ground` | `scene3dSkyGround` | `[0.10, 0.11, 0.13]` |
| `sunDir` | `scene3dSkySunDir` | `[0.4, 0.6, 0.3]` |
| `sunColor` | `scene3dSkySunColor` | `[1.0, 0.93, 0.78]` |
| `sunSize` | `scene3dSkySunSize` | `0.012` |
| `sunGlow` | `scene3dSkySunGlow` | `0.25` |
| `haze` | `scene3dSkyHaze` | `0.3` |
| `cloud` | `scene3dSkyCloud` | `0.0` |
| `night` | `scene3dSkyNight` | `0.0` |

On the host side (`framework/gpu/3d.zig`, lines 1082–1112), `drawSky()`:
1. Computes `inv(vp)` from the camera's view-projection matrix.
2. Wraps the system clock to a 0–1,000,000 ms window for cloud-drift time.
3. Writes all uniforms into a `SkyUniforms` struct (std140 layout, 160 bytes).
4. Draws **one fullscreen triangle** (3 vertices, no vertex buffer) with depth-test = always and depth-write = off.

The shader (`framework/gpu/shaders.zig`, `skybox_wgsl`):
- Reconstructs the world-space view ray from `inv_vp` and pixel position.
- Paints a vertical gradient: `ground` (ray.y < 0) → `horizon` → `zenith`.
- Adds a crisp sun disk (`sunSize`) plus a wide power-law glow (`sunGlow`) along `sunDir`.
- Adds haze (milky lift near the horizon band).
- Adds 2-D fbm value-noise projected onto the sky dome, drifting by `time`.
- Adds hashed star points that fade in as `night` rises.

### Lighting sync

The same `sky.sunDir`, `sky.lightColor`, and `sky.lightI` values that drive the sky shader are passed to:
- `<Scene3D.AmbientLight color={sky.horizon} intensity={sky.ambient} />`
- `<Scene3D.DirectionalLight direction={sky.sunDir} color={sky.lightColor} intensity={sky.lightI} />`

This ensures world lighting always agrees with the sky. The `AmbientLight` uses the sky's `horizon` color so bounce/fill light matches the atmosphere.

### Distance fog

The cart does **not** declare an explicit `<Scene3D.Fog>`. Because a `<Scene3D.Skybox>` is present, the host (`framework/gpu/3d.zig`, lines 1238–1254) automatically:
1. Sets `fog_color` to the skybox's `horizon` color (instead of the flat `backgroundColor`).
2. Enables **aerial perspective**: each mesh fragment fades toward the sky gradient in its own screen direction (`sky_horizon` at bottom, `sky_zenith` at top), not a flat color. This prevents tall peaks from leaving a flat horizon-colored silhouette when culled.

The fog planes are auto-derived from scene extent because no explicit `far` is set on the camera:
- `fog_near = max(6.0, scene_extent * 0.8)`
- `fog_far = max(fog_near + 12.0, scene_extent * 1.1)`

### Ground and props

- **Ground**: a `Geometry.Box` with `params={ width: 60, height: 0.2, depth: 60 }`, material `#2b3326`, positioned at `y = -0.1`. It is a thin slab rather than a plane because a true plane back-face-culls when viewed from above.
- **Props**: 7 scattered shapes (boxes, spheres, cylinders) at varying distances. The farthest ones (`x: 10, z: -8` and `x: -11, z: -10`) are intended to fade into the fog.

All props use built-in geometry defs from `@reactjit/geometries`:
- `Geometry.Box` → id `"Box"`, generates a cube/prism with per-face normals and UVs.
- `Geometry.Sphere` → id `"Sphere"`, generates a UV-sphere.
- `Geometry.Cylinder` → id `"Cylinder"`, generates a capped cylinder.

The `Scene3D.Mesh` primitive handles interning and bridge shipment the same way as in `geometry_demo` (see that doc for the full pipeline).

---

## UI overlay

### Controls (top-left, absolute)

A `Col` containing a `Box` panel with:

- **Clock display**: live `hh:mm` derived from `hour`.
- **Time of Day** row:
  - `Pause` / `Play` — toggles `playing` state.
  - `Dawn`, `Noon`, `Dusk`, `Night` — snap `hour` to preset values and pause.
- **Weather** row:
  - `Clear` → `weather = 0`
  - `Cloudy` → `weather = 0.55`
  - `Storm` → `weather = 1`
- **Zone Mood** row:
  - `Normal` → `gloom = 0`
  - `Gloom zone` → `gloom = 1`

`Btn` component (lines 153–165): a small `Pressable` wrapping a `Box` with conditional `backgroundColor` / `borderColor` based on `active` prop. Uses `paddingTop/Bottom/Left/Right` and `borderRadius` for styling.

### CAN / CAN'T panels (bottom-right, absolute)

Two info boxes explaining what the skybox system can and cannot do. Purely informational — no interactivity.

---

## Bridge / host data flow

Every frame (because `hour` changes), the cart re-renders and produces new prop values for `Scene3D.Skybox`, `Scene3D.AmbientLight`, and `Scene3D.DirectionalLight`.

1. **Skybox**: `Scene3DBase.Skybox` in `primitives.tsx` converts hex strings to RGB arrays and emits a `View` node with `scene3dSkybox: true` + `scene3dSkyZenith`, `scene3dSkyHorizon`, etc.
2. **Reconciler** (`renderer/hostConfig.ts`) diffs the new props against the old ones. Because the values are new arrays/numbers each frame, they cross the V8/Zig bridge every tick.
3. **Host** (`framework/gpu/3d.zig`, `drawScene`):
   - Walks `Scene3D` children to find the skybox node, camera node, light nodes, and fog node.
   - Builds view + projection matrices from camera props.
   - Calls `drawSky()` which writes the latest sky uniforms and draws the fullscreen triangle.
   - Uploads scene uniforms (including fog planes, camera position, sky colors for aerial perspective).
   - Draws all meshes with the same lighting and fog.

The geometry meshes (ground + props) do **not** re-ship vertices every frame because their `geometry` + `params` are static; they hit the JS intern cache and only emit `scene3dGeomKey` + transform props per frame.

---

## Glossary of concepts present in this cart

| Term | Meaning in this cart |
|------|----------------------|
| **Analytic skybox** | A procedural sky drawn as one fullscreen triangle with a shader that paints gradient + sun + haze + clouds + stars from uniforms. No texture assets. |
| **SkyUniforms** | The std140-layout struct (160 bytes) passed to the sky shader each frame: `inv_vp`, `cam_pos`, `time`, `sun_dir`, `sun_size`, `zenith`, `haze`, `horizon`, `cloud`, `ground`, `sun_glow`, `sun_color`, `night`. |
| **Day cycle** | Lerping sky colors and sun direction through 24-hour keyframes. Implemented in pure JS; the host just receives the current values. |
| **Weather** | A 0–1 blend that greyifies colors, thickens clouds and haze, and dims sun/light intensity. |
| **Gloom zone** | A second 0–1 blend that applies a sickly grey-green pall, demonstrating per-zone mood without swapping sky objects. |
| **Aerial perspective** | Fog that fades geometry toward the sky gradient (horizon at bottom, zenith at top) rather than a flat color. Enabled automatically when a skybox is present. |
| **Auto fog** | When no `<Scene3D.Fog>` is present and no explicit camera `far` is set, the host derives fog planes from scene extent (`scene_extent * 0.8` to `scene_extent * 1.1`). |
| **Animation loop** | Self-scheduling JS loop via `requestAnimationFrame` or `setTimeout`. Increments `hour` state, causing React to re-render and ship new sky uniforms. |
| **Light sync** | Using the same computed `sunDir`, `lightColor`, and `lightI` for both the skybox shader and the `DirectionalLight` primitive so shadows and shading agree with the sky. |
| **Geometry registry** | Built-in shapes (`Box`, `Sphere`, `Cylinder`) imported from `@reactjit/geometries` as namespace `Geometry`. |
| **Ground plane trick** | Using a very wide, very thin `Box` instead of a `Plane` because a plane geometry back-face-culls when viewed from above. |

---

## What this cart does NOT do

- **No explicit `<Scene3D.Fog>`** — it relies entirely on the automatic skybox-driven fog.
- **No `<Scene3D.OrbitControls>`** — camera is static.
- **No textures** — all meshes use solid color materials; the sky is purely shader-driven.
- **No instancing** — each prop is an individual `Scene3D.Mesh`.
- **No host functions** — no file I/O, network, clipboard, store, or shell execution.
- **No volumetric clouds or god-rays** — clouds are 2-D fbm noise on a dome.
- **No HDRI / cubemap** — the skybox is explicitly procedural, not image-based.
- **No reflections / IBL** — objects do not reflect the sky.
