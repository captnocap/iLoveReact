// dashboardMetrics.ts — playful, cheap progress metrics for the / dashboard.
//
// These are deliberately derived from existing authoring records: footprint
// centers, build-piece peaks, and the semantic edit log. No render/cook walk.

import { CHUNK_TILES } from './chunks';
import { TILE_UNITS } from './heightData';
import type { EditCategory, EditEvent } from './editLog';

export type DashboardFootprint = {
  footW: number;
  footD: number;
  gx?: number;
  gy?: number;
  label?: string;
};

export type DashboardBuildPeak = {
  label: string;
  x: number;
  z: number;
  heightMeters: number;
  topY: number;
  pieces: number;
};

export type DenseRegion = {
  cx: number;
  cz: number;
  count: number;
  uniqueKinds: number;
  topLabel: string;
};

export type LargestFootprint = {
  label: string;
  areaM2: number;
};

export type EditTempo = {
  editsPerMinute: number;
  minutes: number;
  eventCount: number;
  category: EditCategory;
};

export type DashboardFunMetrics = {
  densest: DenseRegion | null;
  largest: LargestFootprint | null;
  tallest: DashboardBuildPeak | null;
  tempo: EditTempo | null;
};

type RegionBucket = { cx: number; cz: number; labels: Map<string, number>; count: number };

function footprintWorldCenter(f: DashboardFootprint): { x: number; z: number } | null {
  if (typeof f.gx !== 'number' || typeof f.gy !== 'number') return null;
  return {
    x: f.gx / TILE_UNITS + CHUNK_TILES / 2,
    z: f.gy / TILE_UNITS + CHUNK_TILES / 2,
  };
}

function densestRegion(footprints: ReadonlyArray<DashboardFootprint>): DenseRegion | null {
  const buckets = new Map<string, RegionBucket>();
  for (const f of footprints) {
    const center = footprintWorldCenter(f);
    if (!center) continue;
    const cx = Math.floor(center.x / CHUNK_TILES);
    const cz = Math.floor(center.z / CHUNK_TILES);
    const key = `${cx},${cz}`;
    const bucket = buckets.get(key) ?? { cx, cz, labels: new Map<string, number>(), count: 0 };
    const label = f.label?.trim() || 'unnamed';
    bucket.count += 1;
    bucket.labels.set(label, (bucket.labels.get(label) ?? 0) + 1);
    buckets.set(key, bucket);
  }
  let best: RegionBucket | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count || (bucket.count === best.count && `${bucket.cx},${bucket.cz}` < `${best.cx},${best.cz}`)) best = bucket;
  }
  if (!best) return null;
  const top = [...best.labels.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0];
  return { cx: best.cx, cz: best.cz, count: best.count, uniqueKinds: best.labels.size, topLabel: top?.[0] ?? 'unnamed' };
}

function largestFootprint(footprints: ReadonlyArray<DashboardFootprint>): LargestFootprint | null {
  let best: LargestFootprint | null = null;
  for (const f of footprints) {
    const areaM2 = Math.max(0, f.footW) * Math.max(0, f.footD);
    const label = f.label?.trim() || 'unnamed';
    if (!best || areaM2 > best.areaM2 || (areaM2 === best.areaM2 && label.localeCompare(best.label) < 0)) best = { label, areaM2 };
  }
  return best;
}

function editTempo(events: ReadonlyArray<EditEvent>, now: number): EditTempo | null {
  const WINDOW_MS = 30 * 60 * 1000;
  const recent = events.filter((e) => now - e.t >= 0 && now - e.t <= WINDOW_MS && e.cat !== 'camera' && e.cat !== 'map');
  if (recent.length < 2) return null;
  let first = recent[0].t;
  let last = recent[0].t;
  const byCat = new Map<EditCategory, number>();
  for (const e of recent) {
    first = Math.min(first, e.t);
    last = Math.max(last, e.t);
    byCat.set(e.cat, (byCat.get(e.cat) ?? 0) + 1);
  }
  const minutes = Math.max(1, (last - first) / 60000);
  const [category] = [...byCat.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0];
  return { editsPerMinute: recent.length / minutes, minutes, eventCount: recent.length, category };
}

export function reportDashboardFunMetrics(input: {
  footprints: ReadonlyArray<DashboardFootprint>;
  buildPeaks?: ReadonlyArray<DashboardBuildPeak>;
  events?: ReadonlyArray<EditEvent>;
  now?: number;
}): DashboardFunMetrics {
  const peaks = input.buildPeaks ?? [];
  const tallest = peaks.length
    ? [...peaks].sort((a, b) => (b.heightMeters - a.heightMeters) || (b.topY - a.topY) || a.label.localeCompare(b.label))[0]
    : null;
  return {
    densest: densestRegion(input.footprints),
    largest: largestFootprint(input.footprints),
    tallest,
    tempo: editTempo(input.events ?? [], input.now ?? Date.now()),
  };
}
