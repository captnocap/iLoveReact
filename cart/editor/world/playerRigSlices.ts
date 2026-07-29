// world/playerRigSlices.ts — recover the player skin's semantic part slices.
//
// Healthy RJMD documents carry one range per outliner part. Historical
// documents can retain every face-group id and every named skeleton bone while
// losing only that range table. In that case, exact connectivity runs are
// regrouped in export order using bone centers and shell compactness. This handles multi-shell
// semantic parts (five fingers = five shells, one `fingers_left` bone) without
// treating the whole character as one bone.
import {
  meshDocConnectivityRuns,
  meshDocRangeCenters,
  type MeshDocPartMeta,
  type PackageMeshDoc,
} from '../data/meshDoc';
import { normalizeBoneName, type Skeleton, type Vec3 } from '../../../runtime/skeleton';

export type PlayerRigSlices = {
  buckets: number[][];
  centers: ([number, number, number] | null)[];
  names: string[];
  recovered: boolean;
};

export const PLAYER_RIG_RECOVERY_TUNING = Object.freeze({
  /** Keeps one semantic part's recovered shells spatially coherent. This is
   *  what joins five nearby finger shells without swallowing the next foot. */
  shellCompactnessWeight: 2,
  /** Prefer extra connectivity shells on explicitly multi-shell semantic bones
   *  (fingers/toes/hair/teeth). Distance can still outvote this soft penalty. */
  unexpectedExtraShellPenaltyScale: 0.25,
});

function bucketRows(doc: PackageMeshDoc, ranges: readonly { lo: number; hi: number }[]): number[][] {
  const buckets = ranges.map(() => [] as number[]);
  const triCount = Math.floor(doc.vertices.length / 24);
  for (let tri = 0; tri < triCount; tri += 1) {
    const group = doc.faceGroups ? doc.faceGroups[tri]! : tri;
    const rank = ranges.findIndex((range) => group >= range.lo && group < range.hi);
    if (rank < 0) continue;
    buckets[rank]!.push(tri * 3, tri * 3 + 1, tri * 3 + 2);
  }
  return buckets;
}

function absoluteBoneCenters(skeleton: Skeleton): Map<string, Vec3> {
  const bones = new Map(skeleton.bones.map((bone) => [bone.id, bone]));
  const cache = new Map<string, Vec3>();
  const visiting = new Set<string>();
  const solve = (id: string): Vec3 | null => {
    const saved = cache.get(id);
    if (saved) return saved;
    const bone = bones.get(id);
    if (!bone || visiting.has(id)) return null;
    visiting.add(id);
    const local = bone.transform?.pos ?? [0, 0, 0];
    const parent = bone.parent ? solve(bone.parent) : [0, 0, 0] as Vec3;
    visiting.delete(id);
    if (!parent) return null;
    const world: Vec3 = [parent[0] + local[0], parent[1] + local[1], parent[2] + local[2]];
    cache.set(id, world);
    return world;
  };
  for (const id of bones.keys()) solve(id);
  return cache;
}

function distanceSq(a: readonly number[], b: readonly number[]): number {
  const dx = a[0]! - b[0]!, dy = a[1]! - b[1]!, dz = a[2]! - b[2]!;
  return dx * dx + dy * dy + dz * dz;
}

function expectsMultipleShells(name: string): boolean {
  const bone = normalizeBoneName(name);
  return bone.startsWith('fingers_') || bone.startsWith('toes_') || bone === 'hair' || bone === 'teeth';
}

function centerForRows(doc: PackageMeshDoc, rows: readonly number[]): [number, number, number] | null {
  if (rows.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const row of rows) {
    const at = row * 8;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = doc.vertices[at + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  return [
    (min[0]! + max[0]!) / 2,
    (min[1]! + max[1]!) / 2,
    (min[2]! + max[2]!) / 2,
  ];
}

/** Return semantic skin buckets. Recovery is accepted only when every named
 *  part maps to an exported bone and receives at least one exact shell run. */
export function playerRigSlices(
  doc: PackageMeshDoc,
  meta: MeshDocPartMeta[],
  skeleton?: Skeleton,
): PlayerRigSlices {
  const defaultNames = doc.ranges.map((_, rank) => meta[rank]?.name ?? `part ${rank + 1}`);
  const healthy = (doc.storedRangeCount ?? doc.ranges.length) > 0 && doc.ranges.length === meta.length;
  if (healthy || !skeleton || meta.length < 2) {
    return {
      buckets: bucketRows(doc, doc.ranges),
      centers: meshDocRangeCenters(doc),
      names: defaultNames,
      recovered: false,
    };
  }

  const runs = meshDocConnectivityRuns(doc);
  if (runs.length < meta.length) {
    return {
      buckets: bucketRows(doc, doc.ranges),
      centers: meshDocRangeCenters(doc),
      names: defaultNames,
      recovered: false,
    };
  }
  const boneCenters = absoluteBoneCenters(skeleton);
  const candidates = meta.map((row, rank) => {
    const center = boneCenters.get(normalizeBoneName(row.name));
    return center ? { rank, center } : null;
  });
  if (candidates.some((candidate) => candidate === null)) {
    return {
      buckets: bucketRows(doc, doc.ranges),
      centers: meshDocRangeCenters(doc),
      names: defaultNames,
      recovered: false,
    };
  }

  const runDoc: PackageMeshDoc = { ...doc, ranges: runs };
  const runCenters = meshDocRangeCenters(runDoc);
  const runBuckets = bucketRows(doc, runs);
  // Both streams are rank-ordered: exact authored-group runs and parts.json.
  // Partition the run stream into one-or-more consecutive shells per semantic
  // part, minimizing distance to the exported centers. The order constraint is
  // load-bearing: it lets a five-shell finger part stay one bone and prevents
  // one stale center from stealing the following foot/hand shell.
  const partCount = candidates.length;
  const runCount = runs.length;
  const allRunCenters = runCenters.filter((center): center is [number, number, number] => center !== null);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const center of allRunCenters) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (center[axis] < min[axis]!) min[axis] = center[axis];
      if (center[axis] > max[axis]!) max[axis] = center[axis];
    }
  }
  const modelSpanSq = distanceSq(min, max);
  const prefixes = candidates.map((candidate) => {
    const prefix = new Float64Array(runCount + 1);
    for (let run = 0; run < runCount; run += 1) {
      const center = runCenters[run]!;
      prefix[run + 1] = prefix[run]! + distanceSq(center, candidate!.center);
    }
    return prefix;
  });
  const compactness = Array.from({ length: runCount + 1 }, () => new Float64Array(runCount + 1));
  for (let start = 0; start < runCount; start += 1) {
    for (let end = start + 1; end <= runCount; end += 1) {
      let spread = 0;
      for (let left = start; left < end; left += 1) {
        for (let right = left + 1; right < end; right += 1) {
          spread += distanceSq(runCenters[left]!, runCenters[right]!);
        }
      }
      compactness[start]![end] = spread * PLAYER_RIG_RECOVERY_TUNING.shellCompactnessWeight;
    }
  }
  const dp = Array.from({ length: partCount + 1 }, () => {
    const row = new Float64Array(runCount + 1);
    row.fill(Infinity);
    return row;
  });
  const previous = Array.from({ length: partCount + 1 }, () => {
    const row = new Int32Array(runCount + 1);
    row.fill(-1);
    return row;
  });
  dp[0]![0] = 0;
  for (let part = 1; part <= partCount; part += 1) {
    const minUsed = part;
    const maxUsed = runCount - (partCount - part);
    for (let used = minUsed; used <= maxUsed; used += 1) {
      for (let start = part - 1; start < used; start += 1) {
        const before = dp[part - 1]![start]!;
        if (!Number.isFinite(before)) continue;
        const prefix = prefixes[part - 1]!;
        const extraShells = used - start - 1;
        const semanticPenalty = extraShells > 0 && !expectsMultipleShells(meta[part - 1]!.name)
          ? extraShells * modelSpanSq * PLAYER_RIG_RECOVERY_TUNING.unexpectedExtraShellPenaltyScale
          : 0;
        const cost = before + prefix[used]! - prefix[start]! + compactness[start]![used]! + semanticPenalty;
        if (cost < dp[part]![used]!) {
          dp[part]![used] = cost;
          previous[part]![used] = start;
        }
      }
    }
  }
  if (!Number.isFinite(dp[partCount]![runCount]!)) {
    return {
      buckets: bucketRows(doc, doc.ranges),
      centers: meshDocRangeCenters(doc),
      names: defaultNames,
      recovered: false,
    };
  }
  const spans = Array.from({ length: partCount }, () => ({ start: 0, end: 0 }));
  let used = runCount;
  for (let part = partCount; part > 0; part -= 1) {
    const start = previous[part]![used]!;
    spans[part - 1] = { start, end: used };
    used = start;
  }
  const buckets = spans.map(({ start, end }) => {
    const bucket: number[] = [];
    for (let run = start; run < end; run += 1) bucket.push(...runBuckets[run]!);
    return bucket;
  });
  if (buckets.some((bucket) => bucket.length === 0)) {
    return {
      buckets: bucketRows(doc, doc.ranges),
      centers: meshDocRangeCenters(doc),
      names: defaultNames,
      recovered: false,
    };
  }
  return {
    buckets,
    // The skeleton guided the partition; the live mesh remains measurement
    // truth for bind centers, correcting any stale exported center in place.
    centers: buckets.map((bucket) => centerForRows(doc, bucket)),
    names: meta.map((row) => row.name),
    recovered: true,
  };
}
