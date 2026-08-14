# Atom authoring contract (field / warp / colormod)

This document is the complete contract for minting a valid Material Lab atom.
It is written so it can be pasted verbatim into an LLM prompt, followed by
"write me a <kind> atom that <look>", and the output drops into
`cart/editor/render3d/shaders/atoms/` and passes the generator unmodified.

## The file

One atom per `.wgsl` file in `cart/editor/render3d/shaders/atoms/`. The
filename must equal the fn name plus `.wgsl`. After editing atoms run:

    tools/v8cli cart/editor/render3d/shaders/build-shaders.ts

## Header (all five fields required, in comment lines before the fn)

    // @atom <fn name>
    // @name <Human Name>
    // @kind field | warp | colormod
    // @tags <comma, separated, tags>
    // @author <who>

## The three kinds — exact signatures, enforced byte-for-byte

The fn declaration line must match the kind's signature EXACTLY (one line,
including the trailing ` {`), and the fn name must carry the kind's prefix:

| kind | prefix | signature |
|---|---|---|
| field | `field_` | `fn <name>(uv: vec2f, px: vec2f, seed: f32) -> f32 {` |
| warp | `warp_` | `fn <name>(uv: vec2f, seed: f32, amount: f32) -> vec2f {` |
| colormod | `colormod_` | `fn <name>(col: vec3f, uv: vec2f, px: vec2f, seed: f32, amount: f32) -> vec3f {` |

Semantics:

- **field** — a scalar mask over uv. Return 0..1 (clamp with `sat`). `px` is
  the pixel-space coordinate for grain-style effects; unused params are fine.
- **warp** — a uv → uv domain distortion. MUST satisfy `amount = 0 ⇒ returns
  uv unchanged` (a zeroed slider is exactly the unwarped material).
- **colormod** — a color filter. MUST satisfy `amount = 0 ⇒ returns col
  unchanged`. Output through `sat3`.

## @param — tunable scalar knobs (optional, any count)

    // @param <key>: f32 = <default> range(<min>, <max>) "<Label>"

- Declared after the other header lines. `<key>` is a plain identifier, not
  one of `uv px variant seed col amount`.
- Write the bare `<key>` in the body where the value belongs; generation
  rewrites it to a `mat_param` read. The identifier MUST appear in the body
  and MUST NOT be shadowed by a `let`/`var` of the same name.
- Defaults must render pixel-identical to the intended look with no data.

## Allowed calls

- `helpers.wgsl` (always in scope): `sat sat3 rand line_near speckle
  vertical_drips blotch crack_field neon_grime segment_mark dot_mark rect_mask
  brick_wall paint_window leaf_cover leaf_color wallpaper_base quality_pass
  surface_factor blend_over blend_add blend_multiply blend_screen
  surface_blend`.
- `framework/gpu/effect_math.wgsl` (auto-prepended by the host): `snoise
  snoise3 fbm voronoi hsv2rgb hsl2rgb`. NEVER redefine any of these — a
  duplicate symbol fails every Effect compile.
- Other atoms (same-kind or cross-kind) — composition resolves transitively.
- Wrap existing helpers rather than forking their bodies; new general-purpose
  math belongs in `helpers.wgsl`, not copied per atom.

## WGSL gotchas (these break real builds)

- No unary plus: `+0.85` is a syntax error — write `0.85`.
- No backticks and no `${` anywhere, comments included — sources are embedded
  in a JS template literal.
- Float literals for f32 math: `6.0`, not `6`.
- Color-looking `vec3f` literals in a body are palette-extracted for
  MATERIALS but NOT for atoms — an atom's colors stay frozen constants, so
  parameterize anything a user should tune via `@param` or `amount`.

## Reference atom (field, one knob)

    // @atom field_fbm
    // @name FBM Noise
    // @kind field
    // @tags noise, organic, mask
    // @author lab
    // @param scale: f32 = 6.0 range(1.0, 24.0) "Noise scale"
    fn field_fbm(uv: vec2f, px: vec2f, seed: f32) -> f32 {
      return sat(fbm(uv.x * scale + seed, uv.y * scale - seed, 4.0) * 0.5 + 0.5);
    }
