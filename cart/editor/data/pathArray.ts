import { duplicateNameStem, nextDuplicateGroupName, nextDuplicatePartName } from './modelOutliner';
import type { ModelPart } from './types';

export type PathArrayAxis = 0 | 1 | 2 | 3;
export type PathArrayProfile = 'linear' | 'eased';
export type PathArrayPoint = { xU: number; yU: number; zU: number };
export type LinearArrayAxis = PathArrayAxis;

export type PathArrayParams = {
  /** +X, -X, +Z, -Z. Y remains world-up. */
  axis: PathArrayAxis;
  /** Total bays including the untouched source bay. */
  bays: number;
  turnDegrees: number;
  /** Authoring-space rise in u (16 u = one model tile/metre before final scaling). */
  riseU: number;
  profile: PathArrayProfile;
  /** Explicit XYZ offsets from the source forward end. Adjacent points = bays. */
  points?: PathArrayPoint[];
};

// UI and host limits are deliberately named here; the host independently validates
// the safety-critical bay count at its boundary.
export const PATH_ARRAY_TUNING = {
  minBays: 2,
  maxBays: 64,
  defaultBays: 8,
  defaultTurnDegrees: 45,
  defaultRiseU: 1,
  maxAbsTurnDegrees: 360,
  maxAbsRiseU: 4096,
  turnStepDegrees: 5,
  riseStepU: 1,
  maxAbsPointU: 16384,
} as const;

export function defaultPathArrayParams(): PathArrayParams {
  return {
    axis: 0,
    bays: PATH_ARRAY_TUNING.defaultBays,
    turnDegrees: PATH_ARRAY_TUNING.defaultTurnDegrees,
    riseU: PATH_ARRAY_TUNING.defaultRiseU,
    profile: 'eased',
  };
}

/** The straight modifier is one deliberate preset of the path-array engine:
 * no turn, no rise, rigid source-length steps. Keeping this conversion here
 * prevents the visible Linear Array and the native transaction from drifting. */
export function linearArrayParams(axis: LinearArrayAxis, bays: number): PathArrayParams {
  return sanitizePathArrayParams({
    axis,
    bays,
    turnDegrees: 0,
    riseU: 0,
    profile: 'linear',
  });
}

export function sanitizePathArrayParams(raw: PathArrayParams): PathArrayParams {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  const points = raw.points && raw.points.length >= PATH_ARRAY_TUNING.minBays
    ? raw.points.slice(0, PATH_ARRAY_TUNING.maxBays).map((point, index) => ({
        xU: index === 0 ? 0 : Math.max(-PATH_ARRAY_TUNING.maxAbsPointU, Math.min(PATH_ARRAY_TUNING.maxAbsPointU, finite(point.xU, 0))),
        yU: index === 0 ? 0 : Math.max(-PATH_ARRAY_TUNING.maxAbsPointU, Math.min(PATH_ARRAY_TUNING.maxAbsPointU, finite(point.yU, 0))),
        zU: index === 0 ? 0 : Math.max(-PATH_ARRAY_TUNING.maxAbsPointU, Math.min(PATH_ARRAY_TUNING.maxAbsPointU, finite(point.zU, 0))),
      }))
    : undefined;
  return {
    axis: ([0, 1, 2, 3] as const).includes(raw.axis) ? raw.axis : 0,
    bays: points?.length ?? Math.max(PATH_ARRAY_TUNING.minBays, Math.min(PATH_ARRAY_TUNING.maxBays, Math.round(finite(raw.bays, PATH_ARRAY_TUNING.defaultBays)))),
    turnDegrees: Math.max(-PATH_ARRAY_TUNING.maxAbsTurnDegrees, Math.min(PATH_ARRAY_TUNING.maxAbsTurnDegrees, finite(raw.turnDegrees, 0))),
    riseU: Math.max(-PATH_ARRAY_TUNING.maxAbsRiseU, Math.min(PATH_ARRAY_TUNING.maxAbsRiseU, finite(raw.riseU, 0))),
    profile: raw.profile === 'linear' ? 'linear' : 'eased',
    ...(points ? { points } : {}),
  };
}

const AXIS_BASIS: Record<PathArrayAxis, { fx: number; fz: number; rx: number; rz: number }> = {
  0: { fx: 1, fz: 0, rx: 0, rz: -1 },
  1: { fx: -1, fz: 0, rx: 0, rz: 1 },
  2: { fx: 0, fz: 1, rx: 1, rz: 0 },
  3: { fx: 0, fz: -1, rx: -1, rz: 0 },
};

/** Seed the editable XYZ point list from the exact same constant-radius arc law as Zig. */
export function arcPathArrayPoints(params: PathArrayParams, sourceLengthU: number): PathArrayPoint[] {
  const clean = sanitizePathArrayParams({ ...params, points: undefined });
  const basis = AXIS_BASIS[clean.axis];
  const generated = clean.bays - 1;
  const totalDistance = Math.max(0.0001, Math.abs(sourceLengthU)) * generated;
  const turn = clean.turnDegrees * Math.PI / 180;
  return Array.from({ length: clean.bays }, (_, index) => {
    const t = index / generated;
    const angle = turn * t;
    const distance = totalDistance * t;
    const forwardDistance = Math.abs(turn) < 0.00001 ? distance : Math.sin(angle) * (totalDistance / turn);
    const rightDistance = Math.abs(turn) < 0.00001 ? 0 : (1 - Math.cos(angle)) * (totalDistance / turn);
    const grade = clean.profile === 'linear' ? t : t * t * (3 - 2 * t);
    return {
      xU: basis.fx * forwardDistance + basis.rx * rightDistance,
      yU: clean.riseU * grade,
      zU: basis.fz * forwardDistance + basis.rz * rightDistance,
    };
  });
}

/** Extend a coordinate path by its last run (or one measured source span). */
export function appendPathArrayPoint(points: readonly PathArrayPoint[], axis: PathArrayAxis, sourceLengthU: number): PathArrayPoint[] {
  if (points.length >= PATH_ARRAY_TUNING.maxBays) return points.slice();
  const last = points[points.length - 1] ?? { xU: 0, yU: 0, zU: 0 };
  const previous = points[points.length - 2];
  const basis = AXIS_BASIS[axis];
  const step = Math.max(0.0001, Math.abs(sourceLengthU));
  const delta = previous
    ? { xU: last.xU - previous.xU, yU: last.yU - previous.yU, zU: last.zU - previous.zU }
    : { xU: basis.fx * step, yU: 0, zU: basis.fz * step };
  return [...points, { xU: last.xU + delta.xU, yU: last.yU + delta.yU, zU: last.zU + delta.zU }];
}

export type PathArrayRowsResult = {
  parts: ModelPart[];
  created: ModelPart[];
  nextSeq: number;
  groupId: string;
  groupName: string;
};

/**
 * Pair host-created ranges with ordinary outliner rows. The host returns ranges in
 * generated-bay-major/source-part-minor order, so every copied source member stays an
 * independent editable part. All rows share one collapsible organizational group.
 */
export function materializePathArrayRows(
  parts: readonly ModelPart[],
  sourceIds: readonly string[],
  freshRanges: readonly { lo: number; hi: number }[],
  seq: number,
  kind: 'path' | 'linear' = 'path',
): PathArrayRowsResult | null {
  const sourceSet = new Set(sourceIds);
  const sources = sourceIds
    .map((id) => parts.find((part) => part.id === id))
    .filter((part): part is ModelPart => Boolean(part));
  if (sources.length === 0 || sources.length !== sourceSet.size || freshRanges.length === 0 || freshRanges.length % sources.length !== 0) return null;
  if (freshRanges.some((range) => range.hi <= range.lo)) return null;

  const commonGroupId = sources[0]!.groupId && sources.every((part) => part.groupId === sources[0]!.groupId)
    ? sources[0]!.groupId
    : null;
  let cursor = seq;
  const groupId = commonGroupId ?? `part-group:${kind === 'linear' ? 'array' : 'path'}:${cursor++}`;
  const groupName = commonGroupId
    ? (sources[0]!.groupName?.trim() || 'Path Array')
    : nextDuplicateGroupName(
        sources.length === 1
          ? `${duplicateNameStem(sources[0]!.name)} ${kind === 'linear' ? 'Array' : 'Path'}`
          : kind === 'linear' ? 'Linear Array' : 'Path Array',
        parts,
      );
  const groupedSources = commonGroupId
    ? parts.slice()
    : parts.map((part) => sourceSet.has(part.id) ? { ...part, groupId, groupName } : part);

  const usedNames = parts.map((part) => part.name);
  const created: ModelPart[] = freshRanges.map((range, index) => {
    const source = sources[index % sources.length]!;
    const name = nextDuplicatePartName(source.name, usedNames);
    usedNames.push(name);
    const { id: _id, name: _name, mesh: _mesh, sourcePath: _sourcePath, lo: _lo, hi: _hi, groupId: _groupId, groupName: _groupName, ...copyable } = source;
    return {
      ...copyable,
      id: `part:${kind === 'linear' ? 'array' : 'path'}:${cursor++}`,
      name,
      visible: true,
      groupId,
      groupName,
      lo: range.lo,
      hi: range.hi,
    };
  });
  return { parts: [...groupedSources, ...created], created, nextSeq: cursor, groupId, groupName };
}
