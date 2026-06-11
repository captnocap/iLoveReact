// ChunkSurface — one chunk's painted surface as a single Effect quad in the Canvas.
//
// Owns the coalesced GPU buffer for ITS chunk (usePaintedField) and renders the
// ONE combined painter view (PAINTER-0610): tile ground + road ribbon + height
// tint + zone tint composed in a single shader, weighted by per-channel emphasis
// (the active target reads full-strength, the rest stay visible as dim landmarks).
// Registers its flush with the parent so the brush can re-upload just this chunk
// after mutating its buffer in place — a stroke on one chunk never re-encodes or
// re-uploads the others.
//
// Centre-lattice: chunk (cx,cz) is centred at graph (cx*PATCH, cz*PATCH), so chunk
// (0,0) sits on the origin (unchanged from the single-patch seed) and neighbours
// tile flush with no gap.

import { memo, useEffect } from 'react';
import { Canvas, Effect } from '@reactjit/primitives';
import { TILE_UNITS } from './heightData';
import { encodePainterSurface, type PainterEmphasis } from './painterSurface';
import { PAINTER_VIEW_WGSL } from './painterView.wgsl';
import { type ZoneDef } from './zoneData';
import { usePaintedField } from './usePaintedField';
import { chunkKey, CHUNK_TILES, type Chunk } from './chunks';
import { plog, bumpCounter } from './perfLog';

const PATCH = CHUNK_TILES * TILE_UNITS;
const QUAD_STYLE = { width: '100%' as const, height: '100%' as const };

// memo: the parent re-renders on hover/structure changes, but a chunk's props
// (chunk ref, emphasis, zones, the stable register fns) are unchanged then, so it
// skips. Only the chunk actually painted re-renders — via its OWN internal
// usePaintedField state, which memo never blocks. This is what stops the
// paint-one-tile → re-render-all-N-chunks fan-out. The emphasis object MUST be
// identity-stable from the parent (useMemo) or every render re-encodes ~87k floats.
function ChunkSurfaceImpl(props: {
  chunk: Chunk;
  emphasis: PainterEmphasis;
  zones: ZoneDef[];
  // Analytic road-ribbon segments over this chunk (ROADCURVE-0610) — identity-
  // stable from the parent's per-chunk cache, so memo skips unchanged chunks.
  roads?: number[];
  register: (key: string, touch: () => void) => void;
  unregister: (key: string) => void;
}) {
  const { chunk, emphasis, zones, roads, register, unregister } = props;
  const key = chunkKey(chunk.cx, chunk.cz);
  // One chunk re-rendering per painted stroke is EXPECTED (the one you drew on, via
  // usePaintedField). Many lines, or a chunk you didn't touch, is the fan-out bug.
  // Counted (bumpCounter) so the per-stroke UPDATES tally can see these.
  bumpCounter('render:chunkSurface');
  plog('chunkSurface', `render ${key} road=${emphasis.road} height=${emphasis.height} zone=${emphasis.zone}`);

  // Encode reads the live chunk buffers; recomputes only on a flushed stroke or an
  // emphasis/zone-def/road change (usePaintedField caps it at one encode+upload per
  // frame). All four sections ride one buffer now — see painterSurface.ts.
  const surface = usePaintedField(() => {
    const enc = encodePainterSurface(chunk, zones, roads, emphasis);
    // [mapgone-probe MAPGONE2-0605] encode-layer count — stays until the user
    // confirms. Offsets account for the 4-float emphasis header.
    {
      const tBase = 4;
      const palN = enc[tBase + 2] ?? 0;
      const header = tBase + 3 + palN * 3;
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
      console.warn(`[mapgone] ChunkSurface ${key} encLen=${enc.length} painted=${painted} cellHist=[${top}] palette[0..3]=${enc.slice(tBase + 3, tBase + 12).map((v) => v.toFixed(2)).join(',')}`);
    }
    return enc;
  }, [emphasis, zones, roads]);

  // Expose this chunk's flush to the parent brush; drop it when unfocused/unmounted.
  useEffect(() => {
    register(key, surface.touch);
    return () => unregister(key);
  }, [key, surface.touch, register, unregister]);

  return (
    <Canvas.Node gx={chunk.cx * PATCH} gy={chunk.cz * PATCH} gw={PATCH} gh={PATCH}>
      <Effect shader={PAINTER_VIEW_WGSL} data={surface.data} style={QUAD_STYLE} />
    </Canvas.Node>
  );
}

export const ChunkSurface = memo(ChunkSurfaceImpl);
