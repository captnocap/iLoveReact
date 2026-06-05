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
import { TILE_FIELD_WGSL } from './tileField.wgsl';
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
  register: (key: string, touch: () => void) => void;
  unregister: (key: string) => void;
}) {
  const { chunk, layer, zones, register, unregister } = props;
  const key = chunkKey(chunk.cx, chunk.cz);
  // One chunk re-rendering per painted stroke is EXPECTED (the one you drew on, via
  // usePaintedField). Many lines, or a chunk you didn't touch, is the fan-out bug.
  // Counted (bumpCounter) so the per-stroke UPDATES tally can see these.
  bumpCounter('render:chunkSurface');
  plog('chunkSurface', `render ${key} layer=${layer}`);

  // Encode reads the live chunk buffers; recomputes only on a flushed stroke or a
  // layer/zone-def change (usePaintedField caps it at one encode+upload per frame).
  const surface = usePaintedField(() => {
    if (layer === 'height') return [...encodeTileMap(chunk.tiles), ...Array.from(encodeField(chunk.height))];
    if (layer === 'zone') return [...encodeTileMap(chunk.tiles), ...encodeZoneSection(chunk.zones, zones)];
    return encodeTileMap(chunk.tiles); // paint + place: the tile ground
  }, [layer, zones]);

  // Expose this chunk's flush to the parent brush; drop it when unfocused/unmounted.
  useEffect(() => {
    register(key, surface.touch);
    return () => unregister(key);
  }, [key, surface.touch, register, unregister]);

  const shader = layer === 'height' ? HEIGHT_TILE_VIEW_WGSL : layer === 'zone' ? ZONE_VIEW_WGSL : TILE_FIELD_WGSL;

  return (
    <Canvas.Node gx={chunk.cx * PATCH} gy={chunk.cz * PATCH} gw={PATCH} gh={PATCH}>
      <Effect shader={shader} data={surface.data} style={QUAD_STYLE} />
    </Canvas.Node>
  );
}

export const ChunkSurface = memo(ChunkSurfaceImpl);
