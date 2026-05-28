# @reactjit/effects

The shared registry of reusable `<Effect>`s. `<Effect>` is the **one** user-WGSL
surface in ReactJIT — so anything worth reusing (plasma, gradients, rings, …)
lives here **once**, and carts import it by name instead of re-rolling private
WGSL. This is how we avoid "N iterations of plasma."

```tsx
import { Plasma, PLASMA_DEFAULTS, Gradient, GRADIENT_DEFAULTS } from '@reactjit/effects';

<Plasma params={PLASMA_DEFAULTS} style={{ flexGrow: 1 }} />
<Plasma params={{ ...PLASMA_DEFAULTS, velocity: 2 }} style={{ flexGrow: 1 }} />
<Gradient params={{ ...GRADIENT_DEFAULTS, angle: 135 }} style={{ flexGrow: 1 }} />
```

## Entry API convention

Every entry follows the same shape so they're predictable and preset-friendly:

- Takes a **single `params` object** (not scattered props) — config is one value
  you can store, serialize, or build presets from.
- Exports **`<NAME>_DEFAULTS`** and a **`<Name>Params`** type — callers spread-
  override (`{ ...PLASMA_DEFAULTS, velocity: 2 }`).
- **Packer/unpacker symmetry**: the component flattens `params → data[]` in a
  fixed order; the WGSL unpacks `P[i]` in that *same* order, with a
  `// order must match` comment on both sides. Colors pack via `rgb()` (3 floats).
- Entries that filter their **children** sample them with `subtree(uv)` (see
  `Crt.tsx`) — the "Effect used as a parent" case.

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

**Parameters** — the component packs `params` into `data={[...numbers]}`; the
WGSL reads them from a storage binding it declares:
```wgsl
@group(0) @binding(1) var<storage, read> P: array<f32>;
// Param unpacking — order must match the TS packer.
let speed = P[0];
```
Resolve colors with `rgb()` from `./_util` (3 floats each) and flatten into
`data` in the same order the WGSL unpacks. See `Plasma.tsx`.

**Children (filter case)** — when an entry wraps a subtree, sample it with
`subtree(uv) -> vec4f` (the captured children). That's all `<Filter>` ever was.

**WGSL gotchas:** no unary `+` (`+0.85` crashes module creation — write `0.85`);
no backticks inside WGSL comments (they end the JS template literal).

## Adding an entry

1. `runtime/effects/MyEffect.tsx` — export `MyEffect`, `MY_EFFECT_DEFAULTS`, and
   a `MyEffectParams` type. Component signature: `{ params: MyEffectParams }`.
2. Re-export all three from `index.ts`.
3. Keep params semantic (color/speed/intensity), not raw shader constants, and
   keep the packer/unpacker order comment in sync on both sides.

No framework rebuild is needed to add or restyle an entry — it's all cart-side
TSX/WGSL compiled by esbuild.
