import { selectedObject } from './content';
import type { EditorState, WorldObject } from './types';

export type ValidationReadout = {
  errors: number;
  warnings: number;
};

export type MissionCounts = {
  triggers: number;
  points: number;
};

export function validationReadout(_state: EditorState): ValidationReadout {
  // No compile/validation run is wired into this cart yet. Report the honest
  // empty result instead of carrying old mock warnings forward.
  return { errors: 0, warnings: 0 };
}

export function buildStatusLabel(state: EditorState): string {
  return state.history.some((event) => event.undoable) ? 'dirty' : 'unbuilt';
}

export function selectionPosition(state: EditorState, object: WorldObject = selectedObject(state)) {
  return {
    x: Math.round(object.left),
    y: state.floorIndex,
    z: Math.round(object.top),
  };
}

export function snapReadout(state: EditorState) {
  return {
    gridMeters: state.snapGridMeters,
    angleDegrees: state.snapAngleDegrees,
  };
}

export function missionCounts(state: EditorState): MissionCounts {
  let triggers = 0;
  let points = 0;
  for (const object of state.objects) {
    if (object.hidden) continue;
    if (object.kind === 'TRIGGER') triggers += 1;
    if (object.kind === 'MISSION_POINT') points += 1;
  }
  return { triggers, points };
}

export function objectMetricRows(state: EditorState, object: WorldObject): Array<[string, string]> {
  const pos = selectionPosition(state, object);
  return [
    ['x', String(pos.x)],
    ['floor', String(pos.y)],
    ['z', String(pos.z)],
    ['size', `${Math.round(object.width)}x${Math.round(object.height)}`],
  ];
}

export function formatCount(value: number | undefined): string {
  const n = Math.max(0, Math.round(value ?? 0));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatBytes(bytes: number | undefined): string {
  const n = Math.max(0, bytes ?? 0);
  if (n === 0) return '0G';
  const gib = n / (1024 ** 3);
  return `${gib >= 10 ? gib.toFixed(1) : gib.toFixed(2)}G`;
}

export function formatMeters(value: number): string {
  return `${Math.max(0, value).toFixed(value > 0 && value < 1 ? 2 : 0)}m`;
}
