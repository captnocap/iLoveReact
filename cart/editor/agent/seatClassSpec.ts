// editor/agent/seatClassSpec.ts — "PS2-era depth" as a distribution instead of a vibe.
//
// A finished model in this repo is already a specification; nobody had read it as one.
// Every load-bearing decision in an approved car is MEASURABLE from its package: the
// triangle budget, how much of it is quads, its metre dimensions, and — most usefully —
// which parts stayed separate. That last one is the articulation spec. Doors, lids, and
// bumpers are their own Outliner parts because they open or break, which is exactly the
// existing rule for when mating faces legitimately survive junction resolution. So
// "keep mating faces on parts that articulate" stops being a judgement call and becomes
// a lookup: for class `car`, these junctions stay separate and everything else welds.
//
// The corpus is HUMAN-GATED on purpose. An unguarded corpus converges on average agent
// output, which is the 43%-unreachable disease this whole gate machine exists to cure —
// so only models a person marked approved derive a spec, and the reply always says how
// many exemplars it was derived from.
//
// Pure: exemplar facts in, spec out. The shell reads the packages.

import type { SeatBox } from './seatGeometry';

export type ExemplarFacts = {
  model: string;
  triangles: number;
  /** Distinct authored face groups. Null when the package could not report them. */
  authoredFaces: number | null;
  bbox: SeatBox | null;
  regionNames: string[];
  partNames: string[];
};

export type ClassExemplarRow = { model: string; approvedBy: string; at: string; note?: string };
export type ClassCorpus = {
  version: 1;
  classes: Record<string, { signals: string[]; exemplars: ClassExemplarRow[] }>;
};

export function emptyClassCorpus(): ClassCorpus {
  return { version: 1, classes: {} };
}

export function isClassCorpus(value: unknown): value is ClassCorpus {
  const corpus = value as ClassCorpus | null;
  return !!corpus && corpus.version === 1 && !!corpus.classes && typeof corpus.classes === 'object';
}

/** A single exemplar cannot describe a range, so every derived bound is widened by this
 *  before it is allowed to refuse anything. It is generous on purpose: the spec exists
 *  to catch the 4×-oversized trap and the ten-times-over-budget mesh, not to police
 *  centimetres. */
export const CLASS_TOLERANCE = 0.25;
/** A part name must appear in at least this share of exemplars to count as the class's
 *  articulation, so one exemplar's stray part does not become law for the class. */
export const ARTICULATION_QUORUM = 0.5;

export function classifyByCorpus(task: string, corpus: ClassCorpus): { classId: string; signal: string } | null {
  const text = String(task ?? '').toLowerCase();
  let best: { classId: string; signal: string } | null = null;
  for (const [classId, entry] of Object.entries(corpus.classes)) {
    for (const signal of entry.signals ?? []) {
      if (!text.includes(signal.toLowerCase())) continue;
      if (!best || signal.length > best.signal.length) best = { classId, signal };
    }
  }
  return best;
}

export function percentile(values: readonly number[], fraction: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[at]!;
}

/** Length/width/height in metres, orientation-independent: the two horizontal extents
 *  sort into width ≤ length, so a model authored facing x reads the same as one facing z. */
export function boxProfile(box: SeatBox): { length: number; width: number; height: number } {
  const horizontal = [box[3] - box[0], box[5] - box[2]].sort((a, b) => a - b);
  return { width: horizontal[0]!, length: horizontal[1]!, height: box[4] - box[1] };
}

/** How close the mesh is to being all quads. Two triangles per authored face is a pure
 *  quad mesh (1.0); one per face is loose triangle soup (0). Derived from counts because
 *  that is what a saved package can report without re-walking its topology. */
export function quadRatioOf(triangles: number, authoredFaces: number | null): number | null {
  if (!authoredFaces || authoredFaces <= 0 || triangles <= 0) return null;
  const perFace = triangles / authoredFaces;
  return Math.max(0, Math.min(1, perFace - 1));
}

export type ClassSpec = {
  class: string;
  derivedFrom: number;
  exemplars: string[];
  /** Present when a single exemplar could not support a real distribution. */
  caveat: string | null;
  triangles: { min: number; median: number; p90: number; max: number };
  quadRatio: { min: number; median: number } | null;
  dimensions: {
    length: [number, number];
    width: [number, number];
    height: [number, number];
  } | null;
  parts: {
    median: number;
    /** Parts that stayed separate across the class — the articulation spec. These are
     *  the junctions a finish gate must NOT demand welded. */
    articulation: string[];
    quorum: number;
  };
  naming: { regions: [number, number]; sidePrefixes: string[] };
};

export function deriveClassSpec(classId: string, exemplars: readonly ExemplarFacts[]): ClassSpec | { reason: string } {
  const usable = exemplars.filter((row) => row.triangles > 0);
  if (usable.length === 0) {
    return { reason: `class "${classId}" has no readable approved exemplars — approve at least one saved model with \`oracle exemplar approve\`` };
  }
  const triangles = usable.map((row) => row.triangles);
  const quads = usable.map((row) => quadRatioOf(row.triangles, row.authoredFaces)).filter((value): value is number => value !== null);
  const profiles = usable.map((row) => (row.bbox ? boxProfile(row.bbox) : null)).filter((value): value is { length: number; width: number; height: number } => !!value);
  const regionCounts = usable.map((row) => row.regionNames.length);
  const partCounts = usable.map((row) => row.partNames.length);

  const quorum = Math.max(1, Math.ceil(usable.length * ARTICULATION_QUORUM));
  const partTally = new Map<string, number>();
  for (const row of usable) {
    for (const name of new Set(row.partNames)) partTally.set(name, (partTally.get(name) ?? 0) + 1);
  }
  const articulation = [...partTally.entries()]
    .filter(([, count]) => count >= quorum)
    .map(([name]) => name)
    .sort();

  const prefixTally = new Map<string, number>();
  for (const row of usable) {
    for (const prefix of sidePrefixesOf(row.regionNames)) prefixTally.set(prefix, (prefixTally.get(prefix) ?? 0) + 1);
  }
  const sidePrefixes = [...prefixTally.entries()].filter(([, count]) => count >= quorum).map(([prefix]) => prefix).sort();

  return {
    class: classId,
    derivedFrom: usable.length,
    exemplars: usable.map((row) => row.model),
    caveat: usable.length === 1
      ? 'derived from ONE exemplar — every bound is that model widened by the class tolerance, not a distribution. Approve more before trusting the ranges.'
      : null,
    triangles: {
      min: Math.min(...triangles),
      median: percentile(triangles, 0.5)!,
      p90: percentile(triangles, 0.9)!,
      max: Math.max(...triangles),
    },
    quadRatio: quads.length > 0 ? { min: Math.min(...quads), median: percentile(quads, 0.5)! } : null,
    dimensions: profiles.length > 0 ? {
      length: [Math.min(...profiles.map((p) => p.length)), Math.max(...profiles.map((p) => p.length))],
      width: [Math.min(...profiles.map((p) => p.width)), Math.max(...profiles.map((p) => p.width))],
      height: [Math.min(...profiles.map((p) => p.height)), Math.max(...profiles.map((p) => p.height))],
    } : null,
    parts: { median: percentile(partCounts, 0.5) ?? 0, articulation, quorum },
    naming: {
      regions: [Math.min(...regionCounts), Math.max(...regionCounts)],
      sidePrefixes,
    },
  };
}

/** Repeated `<prefix>_` stems across a model's region names — the ds_/ps_ side convention
 *  and anything like it. A prefix used once is a name, not a convention. */
export function sidePrefixesOf(regionNames: readonly string[]): string[] {
  const tally = new Map<string, number>();
  for (const name of regionNames) {
    const at = name.indexOf('_');
    if (at <= 0) continue;
    const prefix = `${name.slice(0, at)}_`;
    tally.set(prefix, (tally.get(prefix) ?? 0) + 1);
  }
  return [...tally.entries()].filter(([, count]) => count >= 2).map(([prefix]) => prefix).sort();
}

// ── grading a live model against its class ────────────────────────────────────

export type ClassVerdict = { pass: boolean; detail: string };

export function widen(range: [number, number], tolerance = CLASS_TOLERANCE): [number, number] {
  return [range[0] * (1 - tolerance), range[1] * (1 + tolerance)];
}

export function gradeDimensions(spec: ClassSpec, bbox: SeatBox | null): ClassVerdict | null {
  if (!spec.dimensions || !bbox) return null;
  const actual = boxProfile(bbox);
  const failures: string[] = [];
  for (const axis of ['length', 'width', 'height'] as const) {
    const [low, high] = widen(spec.dimensions[axis]);
    const value = actual[axis];
    if (value < low || value > high) {
      failures.push(`${axis} ${value.toFixed(2)}m outside ${low.toFixed(2)}–${high.toFixed(2)}m`);
    }
  }
  return failures.length === 0
    ? { pass: true, detail: `${actual.length.toFixed(2)} × ${actual.width.toFixed(2)} × ${actual.height.toFixed(2)} m sits inside the ${spec.class} class range` }
    : { pass: false, detail: `${failures.join('; ')} — for class ${spec.class} (${spec.derivedFrom} exemplar(s)). Fix the SCALE before adding detail.` };
}

export function gradeTriangleBudget(spec: ClassSpec, triangles: number): ClassVerdict {
  const ceiling = spec.triangles.p90 * (1 + CLASS_TOLERANCE);
  return triangles <= ceiling
    ? { pass: true, detail: `${triangles} triangles against a class p90 of ${spec.triangles.p90}` }
    : { pass: false, detail: `${triangles} triangles is over the ${spec.class} budget (p90 ${spec.triangles.p90}, ceiling ${Math.round(ceiling)}) — spend the budget where the class does, not uniformly` };
}

export function gradeArticulation(spec: ClassSpec, partNames: readonly string[]): ClassVerdict | null {
  if (spec.parts.articulation.length === 0) return null;
  const present = new Set(partNames);
  const missing = spec.parts.articulation.filter((name) => !present.has(name));
  return missing.length === 0
    ? { pass: true, detail: `all ${spec.parts.articulation.length} class articulation parts are present and separate` }
    : { pass: false, detail: `missing articulation parts for class ${spec.class}: ${missing.join(', ')} — these stay SEPARATE because they open or break, and their mating faces legitimately survive junction resolution` };
}

export function gradeNaming(spec: ClassSpec, regionNames: readonly string[]): ClassVerdict {
  const [low, high] = widen(spec.naming.regions);
  const count = regionNames.length;
  const inRange = count >= Math.floor(low) && count <= Math.ceil(high);
  const wantedPrefixes = spec.naming.sidePrefixes;
  const usedPrefixes = sidePrefixesOf(regionNames);
  const missingConvention = wantedPrefixes.filter((prefix) => !usedPrefixes.includes(prefix));
  if (inRange && missingConvention.length === 0) {
    return { pass: true, detail: `${count} regions${wantedPrefixes.length ? ` using the class ${wantedPrefixes.join('/')} convention` : ''}` };
  }
  const parts: string[] = [];
  if (!inRange) parts.push(`${count} regions outside the class range ${Math.floor(low)}–${Math.ceil(high)}`);
  if (missingConvention.length > 0) parts.push(`class side convention ${missingConvention.join('/')} unused`);
  return { pass: false, detail: `${parts.join('; ')} — for class ${spec.class}` };
}

/** The one thing a spec changes about the finish gate: articulating parts are EXEMPT
 *  from junction resolution, because their mating faces are the jamb the door needs. */
export function articulationExemption(spec: ClassSpec | null): string {
  if (!spec || spec.parts.articulation.length === 0) return 'no class articulation spec — resolve every junction';
  return `class ${spec.class}: ${spec.parts.articulation.join(', ')} stay separate (they open or break); every OTHER junction welds`;
}
