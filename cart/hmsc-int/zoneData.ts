// zoneData.ts — the zoning layer's data. Paint per-cell zone membership (like the
// tile map), where each ZONE is a named, coloured area carrying flags from the
// established taxonomy (ZONE_FLAGS in hmsc/world/zones) — the same flags the game's
// player-drive loop reads to fire onEnter/onExit triggers. So a painted zone is the
// editor twin of the game's Zone: name + flags (+ a colour, for authoring).

import { hexToRgb01 } from '../hmsc/world/placeables';
import type { ZoneFlag } from '../hmsc/design';

// Authoring swatch palette for new zones (distinct from tile colours).
export const ZONE_COLORS = ['#a78bfa', '#f472b6', '#fb923c', '#34d399', '#60a5fa', '#facc15', '#f87171', '#22d3ee'];

export interface ZoneDef {
  id: string;
  name: string;
  color: string;
  flags: ZoneFlag[];
}

export interface ZoneMap {
  cols: number;
  rows: number;
  idx: Int16Array; // cols*rows: index into the zones list, -1 = unzoned
}

export function makeZoneMap(tilesX: number, tilesY: number): ZoneMap {
  const idx = new Int16Array(tilesX * tilesY);
  idx.fill(-1);
  return { cols: tilesX, rows: tilesY, idx };
}

export function clearZoneMap(m: ZoneMap): void {
  m.idx.fill(-1);
}

export function paintZoneCell(m: ZoneMap, cx: number, cy: number, zoneIndex: number): void {
  if (cx < 0 || cy < 0 || cx >= m.cols || cy >= m.rows) return;
  m.idx[cy * m.cols + cx] = zoneIndex;
}

// Removing a zone at list index r: unzone its cells and shift higher indices down
// so the map stays aligned with the (now shorter) zones list.
export function dropZoneIndex(m: ZoneMap, r: number): void {
  for (let i = 0; i < m.idx.length; i++) {
    const v = m.idx[i];
    if (v === r) m.idx[i] = -1;
    else if (v > r) m.idx[i] = v - 1;
  }
}

// Encode the zone half of the combined zone-view buffer: [cols, rows, zoneCount,
// zone rgb..., cells...]. (The tile half is prepended by the caller.)
export function encodeZoneSection(m: ZoneMap, zones: ZoneDef[]): number[] {
  const out: number[] = [m.cols, m.rows, zones.length];
  for (const z of zones) {
    const c = hexToRgb01(z.color);
    out.push(c[0], c[1], c[2]);
  }
  for (let i = 0; i < m.idx.length; i++) out.push(m.idx[i]);
  return out;
}
