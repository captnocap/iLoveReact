// ChunkSurface — one chunk's painted surface as a single Effect quad in the Canvas.
//
// Owns the coalesced GPU buffer for ITS chunk (usePaintedField) and renders the
// shader for the active layer: the tile ground for paint/place, tile+height for
// height, the combined tile+zone view for zone. Registers its flush with the parent
// so the brush can re-upload just this chunk after mutating its buffer in place — a
// stroke on one chunk never re-encodes or re-uploads the others.
//
// Centre-lattice: chunk (cx,cz) is centred at graph (cx*PATCH, cz*PATCH), so chunk
// (0,0) sits on the origin (unchanged from the single-patch seed) and neighbours
// tile flush with no gap.

import { memo, useEffect } from 'react';
import { Canvas, Effect } from '@reactjit/primitives';
import { TILE_UNITS, encodeField } from './heightData';
import { HEIGHT_TILE_VIEW_WGSL } from './heightTileView.wgsl';
import { encodeTileMap } from './tileData';
import { TILE_FIELD_WGSL, roadRibbonSection } from './tileField.wgsl';
import { encodeZoneSection, type ZoneDef } from './zoneData';
import { ZONE_VIEW_WGSL } from './zoneView.wgsl';
import { usePaintedField } from './usePaintedField';
import { chunkKey, CHUNK_TILES, type Chunk } from './chunks';
import type { Layer } from './PaintCanvas';
import { plog, bumpCounter } from './perfLog';

const PATCH = CHUNK_TILES * TILE_UNITS;
const QUAD_STYLE = { width: '100%' as const, height: '100%' as const };

// memo: the parent re-renders on hover/structure changes, but a chunk's props
// (chunk ref, layer, zones, the stable register fns) are unchanged then, so it
// skips. Only the chunk actually painted re-renders — via its OWN internal
// usePaintedField state, which memo never blocks. This is what stops the
// paint-one-tile → re-render-all-N-chunks fan-out.
function ChunkSurfaceImpl(props: {
  chunk: Chunk;
  layer: Layer;
  zones: ZoneDef[];
  // Analytic road-ribbon segments over this chunk (ROADCURVE-0610) — identity-
  // stable from the parent's per-chunk cache, so memo skips unchanged chunks.
  // Only the tile-ground shader reads it; height/zone own the after-cells slot.
  roads?: number[];
  register: (key: string, touch: () => void) => void;
  unregister: (key: string) => void;
}) {
  const { chunk, layer, zones, roads, register, unregister } = props;
  const key = chunkKey(chunk.cx, chunk.cz);
  // One chunk re-rendering per painted stroke is EXPECTED (the one you drew on, via
  // usePaintedField). Many lines, or a chunk you didn't touch, is the fan-out bug.
  // Counted (bumpCounter) so the per-stroke UPDATES tally can see these.
  bumpCounter('render:chunkSurface');
  plog('chunkSurface', `render ${key} layer=${layer}`);

  // Encode reads the live chunk buffers; recomputes only on a flushed stroke or a
  // layer/zone-def change (usePaintedField caps it at one encode+upload per frame).
  const surface = usePaintedField(() => {
    const enc = layer === 'height'
      ? [...encodeTileMap(chunk.tiles), ...Array.from(encodeField(chunk.height))]
      : layer === 'zone'
        ? [...encodeTileMap(chunk.tiles), ...encodeZoneSection(chunk.zones, zones)]
        : [...encodeTileMap(chunk.tiles), ...roadRibbonSection(roads)]; // paint/place/road: tile ground + analytic roads
    // [mapgone-probe MAPGONE2-0605] encode-layer count — stays until the user confirms
    {
      const header = 3 + (enc[2] ?? 0) * 3;
      let painted = 0;
      const hist = new Map<number, number>();
      const cellEnd = header + chunk.tiles.idx.length;
      for (let i = header; i < cellEnd && i < enc.length; i++) {
        if (enc[i] >= 0) {
          painted++;
          hist.set(enc[i], (hist.get(enc[i]) ?? 0) + 1);
        }
      }
      const top = Array.from(hist.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k}:${n}`).join(' ');
      console.warn(`[mapgone] ChunkSurface ${key} layer=${layer} encLen=${enc.length} painted=${painted} cellHist=[${top}] palette[0..3]=${enc.slice(3, 12).map((v) => v.toFixed(2)).join(',')}`);
    }
    return enc;
  }, [layer, zones, roads]);

  // Expose this chunk's flush to the parent brush; drop it when unfocused/unmounted.
  useEffect(() => {
    register(key, surface.touch);
    return () => unregister(key);
  }, [key, surface.touch, register, unregister]);

  // [mapgone-probe MAPGONE2-0605] GPU-truth shader — paints raw D[] regions so
  // the screen itself reports what the storage buffer holds. Quadrants:
  //   TL = palette[0] (water — must be BLUE if the palette reached the GPU)
  //   TR = palette[5] (sand — tan)
  //   BL = cell[0] kind/17 grayscale (water=0 → black)
  //   BR = the normal per-fragment lookup
  // Flip MAPGONE_PROBE_SHADER on to re-run the GPU-truth diagnostic.
  const MAPGONE_PROBE_SHADER = false;
  const MAPGONE_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  // red border marks each quad's true bounds; interior = the REAL lookup
  if (in.uv.x < 0.01 || in.uv.x > 0.99 || in.uv.y < 0.01 || in.uv.y > 0.99) {
    return vec4f(1.0, 0.1, 0.1, 1.0);
  }
  let cols = i32(D[0]);
  let rows = i32(D[1]);
  let pal = i32(D[2]);
  let cellBase = 3 + pal * 3;
  let cx = clamp(i32(floor(in.uv.x * f32(cols))), 0, cols - 1);
  let cy = clamp(i32(floor(in.uv.y * f32(rows))), 0, rows - 1);
  let kind = i32(D[cellBase + cy * cols + cx]);
  if (kind < 0) { return vec4f(0.05, 0.07, 0.10, 1.0); }
  let pbase = 3 + kind * 3;
  return vec4f(D[pbase], D[pbase + 1], D[pbase + 2], 1.0);
}
`;
  const baseShader = layer === 'height' ? HEIGHT_TILE_VIEW_WGSL : layer === 'zone' ? ZONE_VIEW_WGSL : TILE_FIELD_WGSL;
  const shader = MAPGONE_PROBE_SHADER && layer !== 'height' && layer !== 'zone' ? MAPGONE_WGSL : baseShader;

  return (
    <Canvas.Node gx={chunk.cx * PATCH} gy={chunk.cz * PATCH} gw={PATCH} gh={PATCH}>
      <Effect shader={shader} data={surface.data} style={QUAD_STYLE} />
    </Canvas.Node>
  );
}

export const ChunkSurface = memo(ChunkSurfaceImpl);
