// painterSurface.ts — the combined painter-surface buffer (PAINTER-0610, req_0593).
//
// One encode for the one editor view (painterView.wgsl.ts): tile ground, road
// ribbon, height field, and zone membership ride the SAME buffer, weighted by a
// per-channel emphasis header. Pure data — testable without a mounted canvas.
//
// EVERY section is always emitted with its explicit header (GHOSTROAD-0610:
// Effect buffers only grow, so encoding "empty" by omission leaves the previous
// tenant alive in the buffer tail — counts must overwrite).

import type { Chunk } from './chunks';
import { encodeField } from './heightData';
import { encodeTileMap } from './tileData';
import { encodeZoneSection, type ZoneDef } from './zoneData';
import { roadRibbonSection } from './render3d/heightfieldSurface';

/** Per-channel emphasis weights (0 = hidden, ~0.25–0.3 = dim landmark, 1 = the
 *  active target). Tiles are the base channel and are always fully on. */
export interface PainterEmphasis {
  road: number;
  height: number;
  zone: number;
}

export const PAINTER_EMPHASIS_FLOATS = 4; // opRoad, opHeight, opZone, reserved

/** The combined buffer the painter view samples. Layout (see painterView.wgsl.ts):
 *  emphasis header, tile section, road-ribbon section, height section, zone section. */
export function encodePainterSurface(
  chunk: Chunk,
  zones: ZoneDef[],
  roads: number[] | undefined,
  emphasis: PainterEmphasis,
): number[] {
  const out: number[] = [emphasis.road, emphasis.height, emphasis.zone, 0];
  pushAll(out, encodeTileMap(chunk.tiles));
  pushAll(out, roadRibbonSection(roads));
  pushAll(out, encodeField(chunk.height));
  pushAll(out, encodeZoneSection(chunk.zones, zones));
  // Painted water surface level (the terrain water brush) — same encodeField
  // layout as height; the view tints blue where a sample is wet (> 0).
  pushAll(out, encodeField(chunk.water));
  return out;
}

// Chunk-scale sections run ~58k floats (the height field); a spread/push(...)
// of that many arguments risks the V8 argument-count ceiling, so append by loop.
function pushAll(out: number[], src: ArrayLike<number>): void {
  for (let i = 0; i < src.length; i += 1) out.push(src[i]!);
}
