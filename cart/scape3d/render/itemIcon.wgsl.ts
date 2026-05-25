import { ITEM_SPRITE_WGSL } from '../registries/items';
import { SDF_HELPERS_WGSL } from './sdf.wgsl';

// Renders ONE held item, centered, into the HUD weapon box. D[0] = spriteKind,
// D[1] = tint. It reuses the EXACT item SDF branches authored for the world
// (registries/items/*), so the thing in your hand is the thing in the corner —
// one source of truth for every item's look. Unknown / empty kinds fall through
// to the dark box ground (no branch matches), which reads as "fists / nothing".
//
// Coordinate space matches the world sprite convention: items are authored around
// lx∈[-18,18], with content sitting at ly≈[-2,-34] (up is more-negative). The box
// ground is opaque so we never depend on Effect alpha blending behind the quad.

export const ITEM_ICON_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
${SDF_HELPERS_WGSL}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let kind = i32(D[0] + 0.5);
  let tint = i32(D[1] + 0.5);
  let lx = (in.uv.x - 0.5) * 36.0;
  // World sprites use more-negative ly = higher up, so the box top (uv.y=0) maps to
  // the most-negative ly. (Mapping it the other way renders the item upside down.)
  let ly = in.uv.y * 32.0 - 34.0;
  var c = vec4f(0.043, 0.024, 0.094, 1.0);
  if (kind == -999) {}
${ITEM_SPRITE_WGSL}
  return vec4f(c.rgb, 1.0);
}
`;
