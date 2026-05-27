# @reactjit/geometries

The shared registry of reusable **3D geometry generators**. A generator is the
3D analog of an `<Effect>`: the **one** way a shape gets into a `<Scene3D>`. Anything
worth reusing (box, sphere, icosphere, terrain, your erosion heightfield) lives
here **once**, and carts import it by name instead of the framework owning a
blessed list of shapes.

```tsx
import { Box, BOX_DEFAULTS, Sphere, SPHERE_DEFAULTS } from '@reactjit/geometries';

<Scene3D.Mesh geometry={Box}    params={BOX_DEFAULTS} material="#2b3326" position={[0,-0.1,-4]} />
<Scene3D.Mesh geometry={Sphere} params={{ ...SPHERE_DEFAULTS, radius: 0.12 }} material="#a47" />
```

## THE ONE RULE — no shape is special

The framework (`framework/gpu/3d.zig`) must know **zero shape names.** It uploads
vertex bytes to a slot and draws the slot. It does not know what a "sphere" is.

This is load-bearing and falsifiable. There is exactly one tempting way to break
it: keeping the framework's old built-in shapes (`box`/`sphere`/`cylinder`/…) as a
privileged native fast-path while only *new* shapes go through the registry. **That
is the corner we are not cutting.** `Box` is `runtime/geometries/Box.ts` — a registry
entry identical in shape to a stranger's icosphere — baked, interned, and instanced
like everything else. The Zig `generateBox`/`generateSphere`/… functions and the
`generateGeometry` if-chain get **deleted**, not preserved.

The acceptance test (task #11) is a grep: `generate(Box|Sphere|Cylinder|Cone|Torus|
Plane|Heightfield)` and `std.mem.eql(... "sphere"/"box"/…)` must return **zero**
matches in any live (non-frozen) Zig. If one survives, the intention was not met.

## Why this is not slower than hand-written Zig verts

For a **static** mesh there is no TypeScript at runtime. The generator runs at
*build time* (the bake step), emits a `Float32Array` of the exact same vertex bytes
Zig would have produced, and embeds them in the bundle. Runtime uploads those bytes
once — byte-for-byte identical to the old hand-written path, in the same buffer,
drawn the same way. The authoring layer (TS) and the runtime layer (bytes) are
separated *in time* by the bake; they never coexist. So "TS sphere" vs "Zig sphere"
is a false distinction once baked.

A generator only *executes at runtime* when params are dynamic (`useState`-driven)
**and** actually change — then it runs once per change, never per frame.

## The authoring contract

An entry is a pure function `generate(params) → GeometryData`. No React, no host
calls, no globals — just a loop that pushes vertices. That's the most accessible
primitive imaginable: someone porting a sphere algorithm from a tutorial does it in
20 minutes.

```ts
// runtime/geometries/Sphere.ts
import { mesh, type GeometryData } from './_util';

export type SphereParams = { radius: number; segments: number; rings: number };
export const SPHERE_DEFAULTS: SphereParams = { radius: 0.5, segments: 24, rings: 16 };

export function generate(p: SphereParams): GeometryData {
  const g = mesh();                 // vertex accumulator
  // ... loop: g.tri(a, b, c) with positions/normals/uvs ...
  return g.build();                 // → { positions: Float32Array, count, bounds }
}
```

### GeometryData — the exact buffer the framework expects

The framework's vertex is **8 floats, interleaved, non-indexed triangle list**
(`framework/gpu/3d.zig` `Vertex`):

```
[ px, py, pz,  nx, ny, nz,  u, v ]   // position3 · normal3 · uv2
```

`generate()` returns:

```ts
type GeometryData = {
  positions: Float32Array;  // length === count * 8, in the layout above
  count: number;            // vertex count (triangles = count / 3)
  bounds: { radius: number }; // tight bounding radius, for frustum culling
};
```

The `bounds.radius` ships *with* the geometry so the framework never needs a
per-shape `estimateMeshRadius` switch — it culls off the number the generator
already computed.

(Non-indexed in v1 to stay byte-equivalent with today's path. An optional index
buffer is a later, additive change — it does not alter this contract's shape.)

## How a mesh becomes a draw — intern + instance

Three ideas stack into one spine. Each enables the next:

1. **Intern geometry.** `hash(generator-id, params)` → a small integer **handle**
   (slot). Miss → run the generator once, park the verts in a retained GPU buffer
   region, remember the byte range. Hit → skip all work, draw the range. A coconut
   regenerates *only* when its params rehash — for a coconut in a tree, never. This
   mirrors the texture cache already in `3d.zig` (`getOrCreateTexBindGroup`); geometry
   simply earns the same retention textures already have. Eviction is FIFO, same as
   the tex cache.

2. **Intern texture** (already done). Now a world object is just a tiny record:

   ```ts
   { shape: <geometry-handle>, texture: <texture-handle>, transform: Mat4 }
   ```

   The expensive bytes are shared; only the transform differs between two coconuts.

3. **Instance by shape.** Group instances on their shape handle and issue **one
   instanced draw** per shape with N transforms. 500 coconuts sharing `shape: 0`
   cost **1 generation + 1 draw call**, ever — until one moves. This is exactly the
   "retained/instanced buffers (generate once, redraw)" the old code's own comment
   said was the real fix.

The reactism we're killing: React can re-render the scene a thousand times; every
coconut still resolves to the same handle and the framework does zero geometry work.
Vertex work is severed from the frame clock — it's driven by param-rehash, nothing else.

## The bake step (build time) and the V8 fallback (runtime)

These are not two systems — they are two ways the **same** intern cache gets filled.

- **Bake (static params).** When the bundler sees `<Scene3D.Mesh geometry={Sphere}
  params={{ radius: 0.12, segments: 24, rings: 16 }} />` with literal/const-resolvable
  params, it runs `generate()` at build time, serializes the `Float32Array`, and
  embeds a baked-geometry blob that **pre-populates the cache on first use.** Frame 1
  has zero misses and runs zero generator code. Mirrors the SDF-icon atlas bake.

- **V8 fallback (dynamic params).** When params can't be statically resolved
  (`params={{ radius: sliderValue }}`), the generator runs in V8 **on param-change
  only**, feeding the same cache. It is the natural "cache missed, no baked entry,
  generate now" branch — not a parallel path. Dynamic geometry stays legal (terrain
  editors, input-driven coastlines); unbakeable is **not** a build error. Forbidding
  it would just rebuild a god complex of a different kind.

## Adding an entry

1. `runtime/geometries/MyShape.ts` — export `generate(params)`, `MY_SHAPE_DEFAULTS`,
   and a `MyShapeParams` type. `generate` is pure: params in, `GeometryData` out.
2. Re-export all three from `index.ts`.
3. Keep params semantic (`radius`, `subdivisions`, `twist`), not raw buffer offsets.
4. Compute a tight `bounds.radius` — it's what the framework culls against.

No framework rebuild is needed to add a shape. The generator is TS compiled by
esbuild; the framework never changes because it never knew what shapes exist.
