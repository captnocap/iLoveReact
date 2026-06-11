# cart/carve_lab.tsx

> Single-file cart. No `cart.json` manifest. Built with `./scripts/ship carve_lab` or `./tools/rjit ship carve_lab`.

## What it is

An interactive 3D lab for the `Geometry.Carve` generator. It takes a dropped image (ideally a transparent PNG), converts it into an occupancy mask grid via ImageMagick, and inflates that silhouette into a rounded 3D piece using the "Teddy" cutout-inflate technique. The source image is also mapped as a texture onto the front and back faces of the carved piece. Users can orbit the camera by dragging, and tweak grid resolution, depth, and inflate knobs. A procedural heart mask serves as the default shape before any image is dropped.

---

## File inventory

| File | Role |
|------|------|
| `cart/carve_lab.tsx` | The entire cart — state, ingestion pipeline, UI controls, 3D scene, and drag-to-orbit handlers. |
| `cart/pixel_icons/matrix.ts` | Shared parser: converts ImageMagick `txt:` enumeration output into a `PixelMatrix` (palette-indexed grid with transparency). |
| `cart/pixel_icons/PixelIcon.tsx` | Defines the `PixelMatrix` type and `colorAt()` helper. |
| `runtime/primitives.tsx` | Exports `Box`, `Col`, `Row`, `Image`, `Pressable`, `Text`, `Scene3D`, `StaticSurface`. |
| `runtime/hooks/useFileDrop.ts` | Hook that bridges `framework/filedrop.zig` to React. Reads `__filedropSeq` and `__filedropLastPath` host fns. |
| `runtime/hooks/process.ts` | Subprocess bindings. `run()` spawns a process, collects stdout/stderr, and returns on exit. |
| `runtime/hooks/fs.ts` | Synchronous file system wrappers: `readFile()`, `mkdir()`, backed by `__fs_read`, `__fs_mkdir` host fns. |
| `runtime/geometries/Carve.ts` | The `Geometry.Carve` generator: chamfer distance transform → rounded thickness → front/back/side face emission. |
| `runtime/geometries/index.ts` | Registry. Re-exports `Geometry.Carve` as a `GeometryDef` with `id: 'Carve'`. |
| `runtime/geometries/intern.ts` | JS-side geometry interning. Caches the carved mesh by stable `(id, params)` key. |
| `runtime/cameras/index.tsx` | Camera rig registry. `OrbitCamera` is a thin wrapper around `CameraRig` + `Orbit` solver. |
| `runtime/cameras/rigs/orbit.ts` | The `Orbit` rig definition: `solve(params)` → `{ pos, target, fov }` using `orbitalEye()`. |
| `runtime/ffi.ts` | Underlying FFI bridge. `callHost()` and `subscribe()` are used by hooks to talk to Zig-registered host functions. |
| `framework/gpu/3d.zig` | Host 3D renderer. Handles `Scene3D.Mesh` with `textureKey` by looking up the `StaticSurface` bind group. |
| `framework/gpu/images.zig` | Forwards `staticSurfaceBindGroup3D()` to the GPU core. |
| `framework/gpu/gpu.zig` | GPU core. Manages `StaticSurfaceEntry` cache (render-to-texture offscreen surfaces) with `bind_group_3d` for 3D sampling. |
| `framework/engine.zig` | Paint engine. `renderStaticSurfaceCaptures()` renders `StaticSurface` children into offscreen textures before the main frame. |
| `framework/filedrop.zig` | Host file-drop handler. Sets `lastPath` + increments seq, then calls `markDirty()` to wake React. |

---

## Dependencies and imports

```tsx
import { useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Image, Pressable, Text, Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { run } from '@reactjit/runtime/hooks/process';
import { readFile, mkdir } from '@reactjit/runtime/hooks/fs';
import * as Geometry from '@reactjit/geometries';
import { OrbitCamera } from '@reactjit/cameras';
import { parseTxt } from './pixel_icons/matrix';
import type { PixelMatrix } from './pixel_icons/PixelIcon';
```

- **React** — `useState` (params, status, camera angles), `useRef` (drag state, busy flag), `useMemo` (stable mask + geometry params).
- **Primitives** — layout (`Box`, `Col`, `Row`, `Text`, `Pressable`), 3D (`Scene3D`), image (`Image`), and offscreen surface (`StaticSurface`).
- **Hooks** — `useFileDrop` (drag handler), `run` (ImageMagick subprocess), `readFile` / `mkdir` (scratch dir management).
- **Geometries** — `Geometry.Carve` (the carved piece) and `Geometry.Box` (the ground plane).
- **Cameras** — `OrbitCamera` (yaw/pitch/dist solver).
- **Shared cart code** — `parseTxt` and `PixelMatrix` type from `cart/pixel_icons/`.

---

## State model

```tsx
const [srcPath, setSrcPath] = useState<string | null>(null);       // original dropped image path
const [matrix, setMatrix] = useState<PixelMatrix | null>(null);    // parsed mask grid
const [tex, setTex] = useState<{ path: string; key: string } | null>(null);  // texture PNG path + static key
const [res, setRes] = useState<number>(48);                        // grid resolution (32, 48, or 64)
const [depth, setDepth] = useState(0.55);                          // max thickness
const [inflate, setInflate] = useState(0.7);                       // 0 = flat slab, 1 = fully rounded
const [status, setStatus] = useState('drop an image...');
const [yaw, setYaw] = useState(24);                                // camera orbit yaw (degrees)
const [pitch, setPitch] = useState(18);                            // camera orbit pitch (degrees)
const [dist, setDist] = useState(3.4);                             // camera zoom distance
const dragRef = useRef<{ x: number; y: number } | null>(null);
const busyRef = useRef(false);
```

---

## Ingestion pipeline (`ingest`, lines 110–134)

Triggered by file drop or resolution change.

1. **Generate stamp-unique texture path** (`texPath = /tmp/_reactjit_carve/tex_${Date.now()}.png`):
   - Calls `imageToTexture(path, texPath)` which runs ImageMagick:
     ```
     magick <src> -resize 512x512 -background none -gravity center -extent 512x512 PNG32:<out>
     ```
   - Pads the image to a square, preserving aspect ratio, with transparent fill.
   - Uses `run()` from `runtime/hooks/process.ts` which spawns the subprocess via `__proc_spawn`, collects stdout/stderr via `__ffiEmit` subscriptions, and waits for `proc:exit`.

2. **Generate mask grid** (`imageToGrid(path, gridSize)`):
   - Runs ImageMagick:
     ```
     magick <src> -resize <size>x<size> -background none -gravity center -extent <size>x<size> +dither -colors 32 -depth 8 txt:<out>
     ```
   - Reads the resulting `txt:` file via `readFile()` (sync host fn `__fs_read`).
   - Parses it with `parseTxt()` into a `PixelMatrix`.
   - `parseTxt` scans each line with regex `/^(\d+),(\d+):\s*\((\d+),(\d+),(\d+)(?:,(\d+))?\)\s+#([0-9A-Fa-f]{6,8})/gm`.
   - Pixels with alpha < 16 become `null` (carved away). Others are palette-indexed.

3. **Update state**:
   - `srcPath`, `matrix`, `tex` (with a fresh `staticKey` like `carve.lab.tex.${stamp}`).
   - `status` shows filename, grid size, and solid cell count.

**Busy flag** (`busyRef`): prevents concurrent ingests from rapid drops or knob spam.

**Stamp-unique keys**: The texture key uses `Date.now()` so it can never collide with a stale bake from a previous hot reload. The host's `StaticSurface` cache outlives reloads; without a fresh key, the mesh would sample a stale or wrong image.

---

## Geometry params (lines 145–152)

```tsx
const mask = useMemo<number[]>(
  () => (matrix ? matrix.pixels.map((px) => (px == null ? 0 : 1)) : heartMask(res)),
  [matrix, res],
);
const params = useMemo(
  () => ({ mask, cols: matrix?.size ?? res, rows: matrix?.size ?? res, width: 2, height: 2, depth, inflate }),
  [mask, matrix, res, depth, inflate],
);
```

- `mask` is a binary array (`0` = carved away, `1` = solid) derived from the `PixelMatrix` pixels, or from the procedural heart mask if no image has been dropped.
- `params` is the full `CarveParams` object passed to `Geometry.Carve.generate()`.
- `useMemo` ensures stable identity: the mesh is only re-generated when the mask or a knob actually changes.

### Procedural heart mask (`heartMask`, lines 68–79)

A math-generated occupancy grid using the implicit heart curve equation:

```
x = ((gx + 0.5) / size - 0.5) * 2.9
y = (0.5 - (gy + 0.5) / size) * 2.9 - 0.15
a = x² + y² - 1
solid if a³ - x²y³ ≤ 0
```

This provides a default shape so the lab shows something before any file is dropped.

---

## The `Geometry.Carve` generator (`runtime/geometries/Carve.ts`)

Input: `CarveParams = { mask, cols, rows, width, height, depth, inflate }`

Algorithm:

1. **Chamfer distance transform** (lines 54–76):
   - Initialize a `Float64Array` with `INF` for solid cells, `0` for empty cells.
   - Two-pass 8-neighbor chamfer (forward + backward) computes each solid cell's distance to the nearest empty cell.
   - Track `dmax` (maximum distance).

2. **Per-corner half-thickness** (lines 82–89):
   - Corner grid is `(cols+1) × (rows+1)`.
   - Each corner's inward distance = min of its ≤4 touching cells.
   - `rounded = sqrt(min(d, dmax) / dmax)` — normalized and square-rooted for a smooth profile.
   - `half = 0.5 * depth * ((1 - inflate) + inflate * rounded)`.
   - At `inflate = 0`: flat slab of thickness `depth` everywhere.
   - At `inflate = 1`: thickness tapers to 0 at the silhouette edge, max at center.

3. **Smooth normals** (lines 95–110):
   - Central differences on the half-thickness heightfield.
   - `frontN` = `normalize(-dhdx, -dhdy, -1)`.
   - `backN` = `normalize(-dhdx, -dhdy, +1)`.

4. **Emit geometry** (lines 122–168):
   - For each solid cell:
     - **Front face** (-Z): two triangles, CCW from outside, per-corner normals + UVs. `U` is flipped (`1 - cx/cols`) so the image reads unmirrored from the front.
     - **Back face** (+Z): two triangles, same UVs (coin-style mapping).
     - **Side walls**: for each neighbor that is empty or out-of-bounds, emit a quad with axis-aligned normal. UV is pinned to the cell center so the wall extrudes the silhouette pixel's color.

Mesh cost: ~2 quads per solid cell + boundary walls. A 48×48 mask is ~10–25k vertices.

---

## Render tree

```tsx
<Box style={{ width: '100%', height: '100%', backgroundColor: BG }}>
  <Pressable
    onMouseDown={onDown}
    onMouseMove={onMove}
    onMouseUp={onUp}
    style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
  >
    <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={BG} showGrid={false} showAxes={false}>
      <OrbitCamera target={[0, 1.1, 0]} yaw={yaw} pitch={pitch} dist={dist} fov={45} />
      <Scene3D.AmbientLight color="#aab8d6" intensity={0.6} />
      <Scene3D.DirectionalLight direction={[0.4, 0.9, 0.35]} color="#fff0d6" intensity={0.85} />

      {/* Ground plane */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 7, height: 0.03, depth: 7 }}
        material="#0e1726" position={[0, -0.015, 0]} />

      {/* The carved piece */}
      <Scene3D.Mesh
        geometry={Geometry.Carve}
        params={params}
        material={texKey ? '#ffffff' : '#c2455a'}
        textureKey={texKey}
        position={[0, 1.1, 0]}
      />
    </Scene3D>

    {/* Offscreen texture source */}
    {texPath && texKey ? (
      <StaticSurface staticKey={texKey} style={surfaceStyle}>
        <Image src={texPath} style={texStyle} />
      </StaticSurface>
    ) : null}

    {/* UI panel (absolute, top-left) */}
    <Box style={{ position: 'absolute', top: 14, left: 14, ... }}>
      <Col style={{ gap: 10 }}>
        <Text>CARVE LAB</Text>
        <Text>{status}</Text>
        {/* resolution picker */}
        {/* depth / inflate / zoom knobs */}
      </Col>
    </Box>
  </Pressable>
</Box>
```

### Camera

`<OrbitCamera>` from `@reactjit/cameras`:
- `target={[0, 1.1, 0]}` — looks at the carved piece's center.
- `yaw`, `pitch`, `dist` — driven by drag handlers and zoom knob.
- `fov={45}`.
- Internally, `CameraRig` calls `Orbit.solve({ ...ORBIT_DEFAULTS, ...params })` which returns `{ pos: orbitalEye(target, yaw, pitch, dist/zoom), target, fov }`. This is then passed to `<Scene3D.Camera position={…} target={…} fov={…} />`.

### Drag-to-orbit (lines 162–172)

```tsx
const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
const onMove = (e: any) => {
  const d = dragRef.current;
  if (!d) return;
  const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
  const dx = nx - d.x, dy = ny - d.y;
  d.x = nx; d.y = ny;
  setYaw((v) => v + dx * 0.4);
  setPitch((v) => Math.max(4, Math.min(85, v - dy * 0.3)));
};
const onUp = () => { dragRef.current = null; };
```

- `onMouseDown`, `onMouseMove`, `onMouseUp` on the outer `Pressable`.
- Yaw accumulates with horizontal drag. Pitch clamps to `[4, 85]` degrees.
- No `useEffect` or `requestAnimationFrame`; camera updates via React state → re-render → new `Scene3D.Camera` props.

### Offscreen texture (`StaticSurface`)

The carved piece needs the source image as a texture. The cart uses `<StaticSurface>` as a render-to-texture source:

```tsx
<StaticSurface staticKey={texKey} style={{ position: 'absolute', left: -99999, top: 0, width: 256, height: 256 }}>
  <Image src={texPath} style={{ width: 256, height: 256 }} />
</StaticSurface>
```

- Positioned offscreen (`left: -99999`) so it is not visible in the 2D UI.
- `staticKey` matches the `textureKey` passed to `Scene3D.Mesh`.
- `<Image>` loads the `texPath` PNG (the square-padded source image).

**Host pipeline**:
1. `StaticSurface` is a `View` node with `staticSurface: true` and `staticSurfaceKey: texKey`.
2. During the paint walk (`framework/engine.zig`), `renderStaticSurfaceCaptures()` renders the `StaticSurface` subtree into an offscreen GPU texture keyed by `staticKey`.
3. In `framework/gpu/gpu.zig`, each `StaticSurfaceEntry` gets a `bind_group_3d` created for 3D sampling.
4. When `drawScene()` renders the mesh (`framework/gpu/3d.zig`, line 1382–1383):
   ```zig
   if (child.scene3d_tex_key) |tk| {
       if (images.staticSurfaceBindGroup3D(tk)) |bg| tex_bg = bg;
   }
   ```
   The mesh's fragment shader samples this bind group.
5. **Frame ordering guarantee**: `flushPending()` (which actually draws 3D scenes) is called **after** `renderStaticSurfaceCaptures()` but **before** the main 2D pass. This means a mesh sampling a `StaticSurface` via `textureKey` reads **this frame's** captured content, not last frame's. This fixes one-frame-stale issues.

### Lighting

- `AmbientLight` — `#aab8d6` at intensity `0.6`.
- `DirectionalLight` — warm sun `#fff0d6` from `[0.4, 0.9, 0.35]` at intensity `0.85`.
- No skybox, no fog. The background is a flat color (`#0b1018`).

### Ground plane

A very wide, very thin `Geometry.Box` (`width: 7, height: 0.03, depth: 7`) positioned at `y = -0.015`. Same thin-slab trick as `skybox_demo` to avoid back-face culling issues with a true plane.

---

## UI controls

### Resolution picker (lines 207–218)

Three buttons for grid sizes: `32`, `48`, `64`. Changing resolution re-runs `ingest()` with the new size (if an image has been dropped).

### Knobs (`Knob` component, lines 83–93)

A reusable row with label, minus button, value display, plus button. Used for:
- **depth**: `0.05` step, clamped `[0.05, 2.0]`.
- **inflate**: `0.1` step, clamped `[0, 1]`.
- **zoom** (camera dist): `0.4` step, clamped `[1.2, 12]`.

### Status text

Shows either:
- Default message: `"drop an image to carve it (transparent PNGs read best)"`
- Post-ingest: `"<filename> — <size>×<size> grid, <cells> solid cells"`
- Error: the exception message.

---

## Host functions used

| Host fn | Wrapper | Purpose |
|---------|---------|---------|
| `__filedropSeq` | `callHost('__filedropSeq', 0)` | Read monotonic sequence counter for file drops. |
| `__filedropLastPath` | `callHost('__filedropLastPath', '')` | Get the path of the most recent dropped file. |
| `__proc_spawn` | `spawn({ cmd, args })` | Spawn ImageMagick `magick` subprocess for grid and texture generation. |
| `__proc_wait` | `wait(pid)` | Block until magick exits (used inside `run()`). |
| `__fs_read` | `readFile(path)` | Read the ImageMagick `txt:` output back into JS. |
| `__fs_mkdir` | `mkdir(path)` | Create `/tmp/_reactjit_carve` scratch directory. |

All host access goes through `runtime/ffi.ts` (`callHost`, `callHostJson`, `subscribe`).

---

## Glossary of concepts present in this cart

| Term | Meaning in this cart |
|------|----------------------|
| **Carve (Teddy technique)** | A geometry generator that inflates a 2D silhouette mask into a rounded 3D piece using chamfer distance transform + sqrt profile. |
| **PixelMatrix** | A palette-indexed grid from `cart/pixel_icons/`: `{ size, palette: string[], pixels: Array<number \| null> }`. Null = transparent. |
| **ImageMagick `txt:` format** | Enumerates every pixel as `X,Y: (R,G,B,A) #RRGGBBAA`. Parsed by `parseTxt()` to build the mask. |
| **Chamfer distance transform** | Two-pass 8-neighbor algorithm that computes each solid cell's distance to the nearest empty cell. |
| **Inflate** | 0–1 parameter controlling edge rounding. 0 = flat extruded slab, 1 = knife-edge at silhouette, puffy in center. |
| **Stamp-unique key** | A `staticKey` incorporating `Date.now()` to guarantee no cache collision across hot reloads. |
| **StaticSurface** | A render-to-texture primitive. Its children are painted into an offscreen GPU texture keyed by `staticKey`. |
| **textureKey** | On `Scene3D.Mesh`, tells the 3D renderer to sample the `StaticSurface` texture with the matching key. |
| **OrbitCamera** | A camera rig that solves eye position from `target + yaw + pitch + dist`. Drag handlers mutate yaw/pitch. |
| **Geometry interning** | `useMemo` keeps `params` stable; `intern.ts` caches the generated mesh so it is only rebuilt when params identity changes. |
| **Host subprocess** | `run('magick', [...])` spawns ImageMagick via `__proc_spawn`, collects output via FFI events, and awaits exit. |
| **File drop bridge** | `useFileDrop()` reads `__filedropSeq` / `__filedropLastPath` to detect drag-and-drop events from the OS window manager. |

---

## What this cart does NOT do

- **No animation loop** — camera only updates on drag or knob press; no `requestAnimationFrame`.
- **No skybox / fog** — flat background color only.
- **No instancing** — one carved mesh + one ground plane.
- **No real text inside the 3D scene** — the carved piece's texture comes from an image, not text rendering.
- **No network / HTTP** — everything is local file I/O and subprocess.
- **No persistent storage** — scratch files live in `/tmp`; no `__store_get/set`.
