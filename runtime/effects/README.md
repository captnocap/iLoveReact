# @reactjit/effects

The shared registry of reusable `<Effect>`s. `<Effect>` is the **one** user-WGSL
surface in ReactJIT — so anything worth reusing (plasma, gradients, rings, …)
lives here **once**, and carts import it by name instead of re-rolling private
WGSL. This is how we avoid "N iterations of plasma."

```tsx
import { Plasma, Gradient, Rings } from '@reactjit/effects';

<Plasma style={{ flexGrow: 1 }} speed={1.4} />
<Gradient from="#1b2a4a" to="#0a0d14" angle={135} style={{ flexGrow: 1 }} />
<Rings color="#48d1ff" count={8} style={{ flexGrow: 1 }} />
```

## The authoring contract

An entry is a tiny component that renders `<Effect shader={WGSL} data={[...]}>`.
Your WGSL declares **only** `fs_main` — the host (`v8_app.zig:assembleEffectShader`)
prepends a fixed prelude, so the following are always in scope:

**Uniforms** — `@group(0) @binding(0) var<uniform> U: Uniforms;`
- `U.size_w`, `U.size_h` — quad pixel size
- `U.time`, `U.dt`, `U.frame` — animation clock
- `U.mouse_x`, `U.mouse_y`, `U.mouse_inside` — cursor

**Vertex output** — `fn fs_main(in: VsOut) -> @location(0) vec4f`, where
`in.uv` is `vec2f` 0..1 across the quad (`in.uv.y = 0` is the bottom).

**Math library** (`framework/gpu/effect_math.wgsl`, auto-included) — call these,
don't redefine them:
- `snoise(px, py) -> f32`, `snoise3(px, py, pz) -> f32`
- `fbm(px, py, octaves) -> f32`
- `voronoi(px, py) -> vec2f`
- `hsv2rgb(h, s, v) -> vec3f`, `hsl2rgb(h, s, l) -> vec3f` (h,s,v are **scalars**)

**Parameters** — pass `data={[...numbers]}` and read them in WGSL via a storage
binding you declare yourself:
```wgsl
@group(0) @binding(1) var<storage, read> P: array<f32>;
// ... P[0], P[1], ...
```
Resolve colors to floats on the JS side with `rgb()` from `./_util` and flatten
into `data` (see `Gradient.tsx`).

**WGSL gotchas:** no unary `+` (`+0.85` crashes module creation — write `0.85`);
no backticks inside WGSL comments (they end the JS template literal).

## Adding an entry

1. `runtime/effects/MyEffect.tsx` — export a component + a `MyEffectProps`.
2. Re-export it from `index.ts`.
3. Keep params semantic (speed/scale/color), not raw shader constants.

No framework rebuild is needed to add or restyle an entry — it's all cart-side
TSX/WGSL compiled by esbuild.
