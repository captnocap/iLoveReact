// Editor-owned one-tile road material shader.
import { TILE_FILL_WGSL } from './tileFill';

// roadTileFill — the road, decomposed to a ONE-TILE shader.
//
// The big <Road> cross-section (roadFill.ts) paints a whole 5-6-tile width in one
// pass, which makes it too wide to be a *material* (a material's canvas is one
// tile). This is the per-tile form: a single 1x1 tile of road, with a shared
// asphalt BASE and one OVERLAY layer painted on top. A road is then an
// arrangement of these tile-materials across its width:
//
//   [ asphalt ][ white-divider ][ asphalt ][ yellow-center ][ asphalt ][ bike ] ...
//
// The base (asphalt) is the SAME for every variant — author it once, and the
// yellow/white/bike tiles all inherit it. The overlay is the line/tint that tile
// adds. This matches the inline layer order the old cross-section already used:
// fill_road first, then mix the markings over it.
//
// data D[]:
//   D[0] variant     0 asphalt | 1 yellow-center | 2 white-divider | 3 bike-lane
//   D[1] brightness  (base, shared)   asphalt value multiplier
//   D[2] speckle     (base, shared)   grain strength
//   D[3] lineHalf    line half-width in tile-meters (yellow/white)
//   D[4] doubleGap   half-separation of the double-yellow pair (yellow)
//   D[5] dashPeriod  dashed-line period in tile-meters (white)
//   D[6] dashFrac    painted fraction of each dash period (white)
//   D[7] bikeEdge    bike-lane edge-line half-width (bike)
//
// WGSL gotchas honored: no unary +, no backticks in comments.
export const ROAD_TILE_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
${TILE_FILL_WGSL}
const RT_YELLOW = vec3f(0.93, 0.74, 0.18);
const RT_WHITE = vec3f(0.86, 0.87, 0.83);
const RT_BIKE = vec3f(0.10, 0.34, 0.18);
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let variant = D[0];
  let px = in.uv * 64.0;
  let seed = tf_rand(floor(in.uv * 32.0)) * 50.0;
  var col = fill_road(in.uv, px, 0.0, seed);
  col = col * D[1];
  let grain = tf_rand(in.uv * 137.0) - 0.5;
  col = col + vec3f(grain * D[2]);
  let cx = in.uv.x - 0.5;
  if (variant > 0.5 && variant < 1.5) {
    let l = max(line_near(cx - D[4], D[3]), line_near(cx + D[4], D[3]));
    col = mix(col, RT_YELLOW, l * 0.95);
  }
  if (variant > 1.5 && variant < 2.5) {
    let dash = 1.0 - step(D[6], fract(in.uv.y / D[5]));
    col = mix(col, RT_WHITE, line_near(cx, D[3]) * dash * 0.9);
  }
  if (variant > 2.5) {
    col = mix(col, RT_BIKE, 0.30);
    col = mix(col, RT_WHITE, line_near(in.uv.x - 0.10, D[7]) * 0.9);
  }
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
