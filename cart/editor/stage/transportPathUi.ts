import type { MapPathInvalidReason, MapPathKind, MapPathProfile } from '../../../runtime/game/map';

export type TransportPathChrome = {
  pathKind: MapPathKind;
  pathCurveRadiusM: number;
  railTracks: number;
  roadLanesF: number;
  roadLanesB: number;
  roadSidewalks: boolean;
};

export const PATH_KIND_ORDER: readonly MapPathKind[] = ['road', 'lightRail', 'railway'];

export const PATH_KIND_META: Record<MapPathKind, {
  label: string;
  icon: string;
  tooltip: string;
  defaultCurveRadiusM: number;
}> = {
  road: {
    label: 'Road', icon: 'Route',
    tooltip: 'Road — lanes, median, sidewalks and junctions compile from the curve',
    defaultCurveRadiusM: 8,
  },
  lightRail: {
    label: 'Light Rail', icon: 'TramFront',
    tooltip: 'Light rail — embedded slab track for trams and street-running trains',
    defaultCurveRadiusM: 18,
  },
  railway: {
    label: 'Railway', icon: 'TrainTrack',
    tooltip: 'Railway — ballast, sleepers and steel rails with broader validated turns',
    defaultCurveRadiusM: 28,
  },
};

export const PATH_CURVE_TUNING = {
  minM: 0,
  maxM: 96,
  stepM: 1,
  railTracksMin: 1,
  railTracksMax: 2,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function pathKindPatch(kind: MapPathKind): Pick<TransportPathChrome, 'pathKind' | 'pathCurveRadiusM'> {
  return { pathKind: kind, pathCurveRadiusM: PATH_KIND_META[kind].defaultCurveRadiusM };
}

export function pathProfileOf(state: TransportPathChrome): MapPathProfile {
  return {
    kind: PATH_KIND_ORDER.includes(state.pathKind) ? state.pathKind : 'road',
    curveRadiusM: clamp(state.pathCurveRadiusM, PATH_CURVE_TUNING.minM, PATH_CURVE_TUNING.maxM),
    tracks: Math.round(clamp(state.railTracks, PATH_CURVE_TUNING.railTracksMin, PATH_CURVE_TUNING.railTracksMax)),
    lanesF: Math.round(clamp(state.roadLanesF, 0, 3)),
    lanesB: Math.round(clamp(state.roadLanesB, 0, 3)),
    sidewalks: !!state.roadSidewalks,
  };
}

export function pathInvalidLabel(reason: MapPathInvalidReason, minCurveM: number | null): string {
  if (reason === 'tooFewPoints') return 'place one more anchor';
  if (reason === 'segmentTooShort') return 'segment is shorter than 0.5 m';
  if (reason === 'curveTooTight') {
    return minCurveM === null ? 'curve is too tight for this rail type' : `curve reaches only ${minCurveM.toFixed(1)} m`;
  }
  return '';
}
