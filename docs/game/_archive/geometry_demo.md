# cart/geometry_demo.tsx

> Single-file cart. No `cart.json` manifest. Built with `./tools/rjit ship geometry_demo`.

## What it is

A demonstration / test-bed for the `@reactjit/geometries` subsystem. It renders four 3D shapes inside a `<Scene3D>` viewport: three hand-authored procedural shapes (a pyramid, an octahedron, and a triangular prism) and one runtime-generated "random blob" that changes shape when a button is pressed. The cart exercises the full pipeline from pure-JS geometry generators → vertex buffers → host GPU mesh rendering.

---

## File inventory

| File | Role |
|------|------|
| `cart/geometry_demo.tsx` | The entire cart — component, geometry definitions, and vector helpers. |
| `runtime/primitives.tsx` | Defines `Scene3D`, `Scene3D.Camera`, `Scene3D.Mesh`, `Scene3D.AmbientLight`, `Scene3D.DirectionalLight`, plus layout primitives `Box`, `Col`, `Row`, `Text`, `Pressable`. |
| `runtime/geometries/index.ts` | The geometry registry. Re-exports `mesh`, `normalize`, `GeometryData`, `Vec3` from `_util.ts`. Not directly imported by the cart, but the cart’s shape objects conform to the `GeometryDef` type it exports. |
| `runtime/geometries/_util.ts` | The vertex-assembly toolkit: `mesh()` constructor, `normalize()`, `Mesh.tri()`, `Mesh.triFlat()`, `Mesh.face()`, `Mesh.build()`. Also defines `Vec2`, `Vec3`, `GeometryData`. |
| `runtime/geometries/intern.ts` | JS-side geometry interning. `internGeometry()` computes a stable key from `(id, params)`, caches the generated vertex array, and deduplicates bridge shipment so identical meshes only ship vertices once. |

---

## Dependencies and imports

```tsx
import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, Scene3D } from '@reactjit/primitives';
import { mesh, normalize, type GeometryData, type Vec3 } from '@reactjit/geometries';
```

- **React** — only `useState`. No effects, no refs, no context.
- **Primitives** — only layout primitives (`Box`, `Col`, `Row`, `Text`, `Pressable`) and the 3D scene graph (`Scene3D` and its sub-components).
- **Geometries** — only the builder API (`mesh`, `normalize`) and types (`GeometryData`, `Vec3`). It does **not** import any built-in shapes from the registry (e.g. `Box`, `Sphere`).

No host functions (`__fs_*`, `__http_*`, `__exec`, etc.) are called. No `__registerDispatch`. Everything is self-contained JavaScript / React.

---

## Geometry generation (pure JS, no host bridge)

### Helper functions (lines 17–25)

- `faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3` — Computes the outward face normal of a triangle using the cross product of its edge vectors, then normalizes the result. Pure math, no framework dependency.
- `flat(g, a, b, c)` — Convenience wrapper: calls `g.triFlat(a, b, c, faceNormal(a, b, c))`. Used by all three hand-authored shapes to emit a flat-shaded triangle with correct outward normals.

### Hand-authored shapes (lines 33–93)

Each shape is a self-contained `GeometryDef`-like object with `id`, `defaults`, and `generate(params)`:

| Shape | ID | Default params | What it builds |
|-------|----|----------------|----------------|
| `Pyramid` | `demo:pyramid` | `{ size: 1.4, height: 1.8 }` | A square pyramid: four triangular side faces plus four base wedges (two triangles each), wound CCW around +Y so normals face outward. |
| `Octahedron` | `demo:octahedron` | `{ radius: 1.0 }` | A diamond made of two 4-sided cones sharing an equator. 8 total faces. |
| `Prism` | `demo:prism` | `{ radius: 0.9, length: 1.8 }` | A triangular prism: two end-cap triangles and three rectangular side faces. The side faces use `g.face()` (BL, BR, TR, TL winding with flipped V so textures stay upright). |

All three use the `mesh()` builder from `_util.ts`, push triangles via `triFlat` or `face`, and return `g.build()` which produces a `GeometryData` object:

```ts
{
  positions: Float32Array; // interleaved [px,py,pz, nx,ny,nz, u, v] × count
  count: number;            // vertex count (triangles = count / 3)
  bounds: { radius: number };
}
```

### RandomBlob (lines 108–149)

A UV-sphere whose radius is displaced by a seeded sum-of-waves function, making every seed produce a different lumpy creature.

- `rng(seed)` (lines 100–106) — A linear congruential generator (LCG) using `Math.imul`. Returns a function that yields numbers in `[0, 1)`. This is pure JS; it does not use `__crypto_random_bytes`.
- On each `generate()` call, it:
  1. Seeds the LCG from the `seed` param.
  2. Generates `lumps` (default 5) random wave descriptors with random spatial frequencies (`fx`, `fy`, `fz` in 1..5), random phases, and random amplitudes.
  3. Defines `displace(nx, ny, nz)` which sums `sin(fx·nx + fy·ny + fz·nz + phase)` for each wave and scales by `amplitude / lumps`.
  4. Iterates over `rings` × `segments` latitude/longitude grid, computes displaced radius for each corner, and emits two triangles per quad using `g.tri()` (per-corner normals + UVs, not flat shading).

The winding is explicitly `(a, c, d)` then `(a, b, c)` — the comment notes this differs from the naive `(a, d, c) + (a, c, b)` because that ordering is back-facing when `a` is the top corner.

---

## React component structure

### State

```tsx
const [seed, setSeed] = useState(1);
```

Only one state variable: `seed`, an integer starting at `1`. It drives the `RandomBlob` geometry parameters.

### Render tree

```tsx
<Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0e16' }}>
  <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0b0e16">
    <Scene3D.Camera position={[0, 2.6, 10]} target={[0.4, 0.4, 0]} fov={52} />
    <Scene3D.AmbientLight color="#5a6680" intensity={0.55} />
    <Scene3D.DirectionalLight direction={[0.5, 0.9, 0.6]} color="#fff3e0" intensity={0.95} />
    <Scene3D.DirectionalLight direction={[-0.6, 0.2, -0.4]} color="#3a4a8a" intensity={0.5} />

    {/* Three hand-authored meshes */}
    <Scene3D.Mesh geometry={Pyramid}  params={…} material="#ffce54" position={[-4.2, 0.4, 0]} rotation={[0, 35, 0]} />
    <Scene3D.Mesh geometry={Octahedron} params={…} material="#5d9cec" position={[-1.4, 0.4, 0]} rotation={[0, 35, 0]} />
    <Scene3D.Mesh geometry={Prism}    params={…} material="#a0d468" position={[1.4, 0.4, 0]} rotation={[0, 35, 0]} />

    {/* One dynamic blob mesh */}
    <Scene3D.Mesh geometry={RandomBlob} params={{ seed, segments: 40, rings: 24, lumps: 5, amplitude: 0.45 }}
      material="#ff6b9d" position={[4.4, 0.4, 0]} />
  </Scene3D>

  {/* Overlay UI */}
  <Col style={{ position: 'absolute', left: 18, top: 16, gap: 4 }}>…title…</Col>
  <Row style={{ position: 'absolute', left: 0, bottom: 76, width: '100%', justifyContent: 'center', gap: 26 }}>…labels…</Row>
  <Row style={{ position: 'absolute', left: 0, bottom: 22, width: '100%', justifyContent: 'center' }}>
    <Pressable onPress={() => setSeed(Math.floor(Math.random() * 1_000_000) + 1)}>…</Pressable>
  </Row>
</Box>
```

#### Scene3D setup

- **Camera**: position `[0, 2.6, 10]`, looking at `[0.4, 0.4, 0]`, FOV 52°. This is a perspective camera.
- **AmbientLight**: warm gray `#5a6680` at intensity `0.55`.
- **DirectionalLight (key)**: sun-like `#fff3e0` from `[0.5, 0.9, 0.6]` at intensity `0.95`.
- **DirectionalLight (fill)`: cool blue `#3a4a8a` from `[-0.6, 0.2, -0.4]` at intensity `0.5`.

No `Scene3D.Fog`, no `Scene3D.Skybox`, no `Scene3D.OrbitControls`.

#### Meshes

All four meshes use the `geometry={def} params={…}` API (not legacy string names). The hand shapes are passed as static objects; the blob is passed as a static object but its `params.seed` changes, causing `Scene3D.Mesh` to re-intern the geometry.

**Rotation**: each hand mesh has `rotation={[0, 35, 0]}` — a static 35-degree Y-axis rotation. The comment says "spinning slowly on Y" but the code does not animate rotation; it is a fixed pose.

#### Overlay UI

- A title block (top-left, absolute).
- A label row (bottom-center) showing the name of each shape in its material color.
- A single `Pressable` button (bottom-center) that regenerates the blob:
  ```tsx
  onPress={() => setSeed(Math.floor(Math.random() * 1_000_000) + 1)}
  ```
  This uses the standard browser `Math.random()` (or V8's builtin), not `__crypto_random_bytes`.

---

## How data reaches the host (the bridge path)

When `<Scene3D.Mesh>` renders inside `runtime/primitives.tsx` (lines 535–708), the following happens for each of the four meshes in this cart:

1. `Scene3DBase.Mesh` receives `geometry={Pyramid|Octahedron|Prism|RandomBlob}` and `params={...}`.
2. It imports `runtime/geometries/intern.ts` via `require('./geometries/intern')`.
3. `geomIntern.isGeometryDef(geometry)` returns `true` (the objects have `.id`, `.generate`, `.defaults`).
4. `geomIntern.internGeometry(geometry, params)` is called:
   - Computes a stable string key: `id + '|' + stableStringify(mergedParams)`.
   - Checks the `cache` Map. If miss, runs `geometry.generate(params)` to produce `GeometryData`, converts `positions` Float32Array to a plain `number[]`, and stores `{ key, vertices, count, bounds }`.
5. Back in `Scene3DBase.Mesh`:
   - If this is the **first** time this key has been shipped to the host (`!geomIntern.hasShipped(g3.key)`), the reconciler emits a `View` node with:
     - `scene3dGeomKey: g3.key`
     - `scene3dVertices: g3.vertices` (the full interleaved float array)
     - `scene3dVertCount: g3.count`
     - `scene3dBoundsRadius: g3.bounds`
   - On subsequent renders (or if another mesh uses the same geometry+params), it emits only:
     - `scene3dGeomKey: g3.key`
     - `scene3dBoundsRadius: g3.bounds`
     (The host already has the vertex buffer cached by key.)
6. The mesh node also carries transform and material props:
   - `scene3dPosX/Y/Z`, `scene3dRotX/Y/Z`, `scene3dScaleX/Y/Z`
   - `scene3dColorR/G/B/A` (derived from the `material` string via `_hexToRgb`)
7. The reconciler (`renderer/hostConfig.ts`) serializes these props and flushes them across the V8/Zig bridge. The Zig runtime (`framework/gpu/3d.zig`) reads the vertex array, uploads it to GPU, and draws it every frame.

**For the RandomBlob**: because `seed` changes on button press, `params` changes, `internKey()` produces a new key, `internGeometry()` runs `generate()` again, and a brand-new vertex buffer is shipped. The old key is not garbage-collected from the JS cache immediately, but it is harmless.

No `dynamicKey` prop is used, so the mesh goes through the standard interned path rather than the `~dyn~` host-slot overwrite path.

---

## Glossary of concepts present in this cart

| Term | Meaning in this cart |
|------|----------------------|
| **GeometryDef** | An object with `{ id, defaults, generate }` that knows how to build a `GeometryData` from params. The cart defines four of them inline. |
| **GeometryData** | The product of `mesh().build()`: a `Float32Array` of interleaved position/normal/UV floats, a vertex count, and a bounding radius. |
| **mesh() / Mesh** | The builder API from `@reactjit/geometries`. Provides `tri()`, `triFlat()`, `face()`, and `build()`. |
| **Interning** | The runtime caches geometry by stable `(id, params)` key so the same shape is generated only once, and ships vertices to the host only once per key. |
| **Scene3D.Mesh** | The primitive that bridges a `GeometryDef` into the Zig GPU renderer. Handles keying, vertex shipment, transform, and material color. |
| **Flat shading** | Using `triFlat()` so the entire triangle shares one normal, giving a faceted look (used by Pyramid, Octahedron, Prism). |
| **Smooth shading** | Using `tri()` with per-corner normals and UVs (used by RandomBlob's UV-sphere). |
| **LCG** | Linear congruential generator — the cart's custom `rng(seed)` function used for deterministic pseudo-randomness in blob generation. |
| **UV-sphere** | A sphere parameterized by latitude/longitude rings and segments, with (u,v) texture coordinates. |
| **Material** | In this cart, always a simple hex color string (e.g. `"#ffce54"`). The primitive converts it to RGB and sends it as `scene3dColorR/G/B`. |
| **Absolute overlay** | UI layered on top of the 3D viewport using `position: 'absolute'` inside the same parent `Box`, because there is no DOM z-index. |

---

## What this cart does NOT do

- No animation / game loop / `useEffect` / `useFrame`. The scene is static except for the blob re-generation.
- No user input besides the single button press. No keyboard handling, no mouse look, no drag.
- No textures — all meshes use solid color materials.
- No instancing — each mesh is a separate `Scene3D.Mesh` node.
- No fog, skybox, or orbit controls.
- No host functions — no file I/O, no network, no clipboard, no store.
- No built-in geometry imports — it hand-rolls everything rather than using `Box`, `Sphere`, etc. from the registry.
