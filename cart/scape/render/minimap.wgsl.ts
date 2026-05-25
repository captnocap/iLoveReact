import { HEADER, WIN } from '../world/window';
import { NEON, TILE, wgsl } from './palette';

export const MINIMAP_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
const WIN: i32 = ${WIN};
const HDR: i32 = ${HEADER};
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let lx = i32(in.uv.x * f32(WIN));
  let ly = i32(in.uv.y * f32(WIN));
  let kind = i32(D[HDR + ly * WIN + lx] + 0.5) & 7;
  var col = ${wgsl(TILE.road)};
  if (kind == 1) { col = ${wgsl(TILE.sidewalk)}; }
  if (kind == 2) { col = ${wgsl(NEON.pink)}; }
  if (kind == 3) { col = ${wgsl(TILE.water)} + ${wgsl(NEON.cyan)} * 0.18; }
  if (kind == 4) { col = ${wgsl(TILE.sand)}; }
  if (kind == 5) { col = ${wgsl(TILE.grime)}; }
  if (kind == 6) { col = ${wgsl(TILE.wallTop)}; }
  if (kind == 7) { col = ${wgsl(NEON.orange)}; }
  let plx = (D[0] - D[6]) / f32(WIN);
  let ply = (D[1] - D[7]) / f32(WIN);
  let yaw = D[2];
  let camx = plx + sin(yaw) * (2.4 / f32(WIN));
  let camy = ply - cos(yaw) * (2.4 / f32(WIN));
  if (distance(in.uv, vec2f(camx, camy)) * f32(WIN) < 0.7) { col = ${wgsl(NEON.cyan)}; }
  if (distance(in.uv, vec2f(plx, ply)) * f32(WIN) < 1.0) { col = vec3f(1.0, 1.0, 1.0); }
  return vec4f(col, 1.0);
}
`;
