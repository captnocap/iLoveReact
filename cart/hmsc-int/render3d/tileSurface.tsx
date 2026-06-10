import { memo, useMemo } from 'react';
import { Effect, StaticSurface } from '@reactjit/primitives';
import type { WorldSurfaceRegion } from '../design';
import { TILE_FILL_WGSL, tileFillMaterialId, tileFillVariant } from './tileFill';

// A whole tile field drawn by ONE Effect: every cell rendered with its
// procedural effect_fills material (concrete/road/sand), per-cell seed for
// variation, plus a slab joint at tile edges (the "world as shader quad"
// pattern). uv 0..1 maps across the region; cost is one node regardless of tile
// count. The game captures this to a texture for the floor mesh.
//
// D[0],D[1] = tiles across/down. D[2] = materialId. D[3] = variant.
export const TILE_GRID_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
${TILE_FILL_WGSL}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let tiles = vec2f(D[0], D[1]);
  let matId = D[2];
  let variant = D[3];
  let cell = in.uv * tiles;
  let id = floor(cell);
  let f = fract(cell);
  let seed = tf_rand(id + vec2f(3.1, 7.7)) * 50.0;
  var col = tileMaterial(matId, f, f * 64.0, variant, seed);
  // slab joint at tile edges
  let edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  let aa = max(fwidth(edge), 0.0008);
  col = mix(col, col * 0.5, (1.0 - smoothstep(0.012, 0.012 + aa, edge)) * 0.8);
  return vec4f(col, 1.0);
}
`;

export function tileGridData(region: WorldSurfaceRegion): number[] {
  return [region.width, region.depth, tileFillMaterialId(region.kind), tileFillVariant(region.kind)];
}

export function floorTextureKey(regionId: string): string {
  return `hmsc.floor.${regionId}`;
}

// Texture size proportional to the region so per-tile fill detail reads;
// ~16px/tile, clamped so a huge field doesn't allocate an absurd surface.
// IMPORTANT: a StaticSurface/Effect capture cannot render larger than the
// window framebuffer — request 1920 in a 1042-tall window and only the
// window-sized chunk draws, leaving the rest of the floor untextured (it reads
// as void). So cap the capture to a size that fits inside any reasonable window
// (~900) — the whole texture renders, the whole floor is covered. Trade-off:
// fewer px/tile. Sharp tiles at huge floor sizes need UV-tiling a small texture
// instead of capturing the whole field (separate change).
const MAX_CAPTURE_PX = 900;
function captureDimension(tiles: number): number {
  return Math.max(256, Math.min(MAX_CAPTURE_PX, Math.round(tiles * 8)));
}

// One region's offscreen capture. Memoized + every prop identity (data array,
// both style objects) stabilized with useMemo so a re-render of the parent does
// NOT commit an Effect UPDATE. That UPDATE stamps the StaticSurface subtree
// dirty (subtree_last_mutated_frame), which makes the gpu.zig cache miss and
// re-bake the heavy tile shader EVERY frame — the 40ms paint spike. The capture
// must depend ONLY on the region's shape/kind, so it bakes once and the cache
// holds across all player/camera churn. See gpu.zig staticSurfaceReady.
const RegionCapture = memo(function RegionCapture(props: { region: WorldSurfaceRegion }) {
  const region = props.region;
  const w = captureDimension(region.width);
  const h = captureDimension(region.depth);
  const data = useMemo(() => tileGridData(region), [region.width, region.depth, region.kind]);
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: w, height: h }),
    [w, h],
  );
  const effectStyle = useMemo(() => ({ width: w, height: h }), [w, h]);
  return (
    <StaticSurface staticKey={floorTextureKey(region.id)} style={surfaceStyle}>
      <Effect shader={TILE_GRID_SHADER} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// Offscreen captures (one per region) → texture keys the floor meshes sample.
// Mount in the 2D tree as a sibling of <Scene3D> (the billboard_demo pattern).
// Memoized so it only re-renders when the regions list itself changes — not on
// every player/camera frame — keeping the per-region StaticSurface caches warm.
export const TileSurfaceCaptures = memo(function TileSurfaceCaptures(props: { regions: WorldSurfaceRegion[] }) {
  return (
    <>
      {props.regions.map((region) => (
        <RegionCapture key={floorTextureKey(region.id)} region={region} />
      ))}
    </>
  );
});
