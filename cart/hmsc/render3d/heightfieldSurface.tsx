import { memo, useMemo } from 'react';
import { Effect, StaticSurface } from '@reactjit/primitives';
import type { Landform } from '../design';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { hexToRgb01 } from '../world/placeables';

// The painted-terrain surface: the per-cell tile grid a 'heightfield' landform
// carries (field.tiles), captured offscreen by ONE Effect quad and draped over the
// displaced mesh as its texture — the editor's "tiles on the mesh" in the game's
// own renderer. ONE shader for both the editor's 2D canvas and the game's 3D
// terrain (hmsc-int re-exports HEIGHTFIELD_TILE_SHADER), so the paint you see in
// the painter is the paint the world boots with.
//
// D[] layout (matches encodeTileMap / heightfieldTileData): [0]cols [1]rows
// [2]paletteCount, then paletteCount*3 palette rgb floats, then rows*cols cell
// indices (-1 = empty). (WGSL: no unary +, no backticks in comments.)

export const HEIGHTFIELD_TILE_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cols = i32(D[0]);
  let rows = i32(D[1]);
  let pal = i32(D[2]);
  let cellBase = 3 + pal * 3;

  let cx = clamp(i32(floor(in.uv.x * f32(cols))), 0, cols - 1);
  let cy = clamp(i32(floor(in.uv.y * f32(rows))), 0, rows - 1);
  let kind = i32(D[cellBase + cy * cols + cx]);

  let gf = abs(fract(in.uv * vec2f(f32(cols), f32(rows))) - vec2f(0.5));
  let edge = max(gf.x, gf.y);

  if (kind < 0) {
    let g = smoothstep(0.46, 0.5, edge) * 0.07;
    return vec4f(0.05 + g, 0.07 + g, 0.10 + g, 1.0);
  }
  let pbase = 3 + kind * 3;
  let col = vec3f(D[pbase], D[pbase + 1], D[pbase + 2]);
  let shade = mix(1.0, 0.78, smoothstep(0.44, 0.5, edge));
  return vec4f(col * shade, 1.0);
}
`;

// Linear RGB per tile kind, indexed by TILE_KINDS order — the same palette the
// editor ships, recomputed here so the shader maps a cell index → colour with no
// per-cell JS. Shared by the game render and (re-exported) the editor.
export const HEIGHTFIELD_TILE_PALETTE: [number, number, number][] =
  TILE_KINDS.map((k) => hexToRgb01(tileKindDefinition(k).render.color));

// Encode a landform's per-cell tile grid for the shader buffer.
export function heightfieldTileData(tiles: { cols: number; rows: number; idx: number[] }): number[] {
  const out: number[] = [tiles.cols, tiles.rows, HEIGHTFIELD_TILE_PALETTE.length];
  for (const c of HEIGHTFIELD_TILE_PALETTE) out.push(c[0], c[1], c[2]);
  for (let i = 0; i < tiles.idx.length; i += 1) out.push(tiles.idx[i]);
  return out;
}

export function heightfieldTextureKey(landformId: string): string {
  return `hf_surface_${landformId}`;
}

// ~4 px per 1m cell over the footprint, capped well under the window framebuffer
// (a StaticSurface capture cannot exceed it — same rule as the chunk floors).
const MAX_CAPTURE_PX = 512;
function captureDimension(tiles: { cols: number; rows: number }): number {
  const span = Math.max(tiles.cols, tiles.rows);
  return Math.max(128, Math.min(MAX_CAPTURE_PX, Math.round(span * 4)));
}

// One landform's painted-tile texture: its per-cell grid captured offscreen, keyed
// by landform id so the texture (and its bind group) persists across frames; only
// the contents re-bake when the paint changes. Identities are stabilized so an
// unrelated re-render does not commit an Effect UPDATE that re-bakes every frame
// (the static_surface_inline_props_rebake trap).
const HeightfieldSurfaceCapture = memo(function HeightfieldSurfaceCapture(props: { landform: Landform }) {
  const tiles = props.landform.field?.tiles;
  const px = captureDimension(tiles ?? { cols: 1, rows: 1 });
  const data = useMemo(() => (tiles ? heightfieldTileData(tiles) : [1, 1, 0, -1]), [tiles]);
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: px, height: px }),
    [px],
  );
  const effectStyle = useMemo(() => ({ width: px, height: px }), [px]);
  return (
    <StaticSurface staticKey={heightfieldTextureKey(props.landform.id)} style={surfaceStyle}>
      <Effect shader={HEIGHTFIELD_TILE_SHADER} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// The painted-tile captures for every heightfield landform (those carrying a tile
// grid). Mirrors LandformSurfaceCaptures; rendered alongside it.
export const HeightfieldSurfaceCaptures = memo(function HeightfieldSurfaceCaptures(props: { landforms: Landform[] }) {
  return (
    <>
      {props.landforms
        .filter((lf) => lf.field?.tiles)
        .map((lf) => (
          <HeightfieldSurfaceCapture key={heightfieldTextureKey(lf.id)} landform={lf} />
        ))}
    </>
  );
});
