import { selectedObject } from './content';
import type { EditorState, WorldObject } from './types';

// No standing ERR/WARN tally exists here on purpose: the only real validator is the
// mesh-edit guard, a contextual "live with it or revert now" alert you resolve at the
// moment it fires — not something that accumulates into a counter. A permanently-0 badge
// was theater, so it (and validationReadout) were removed (req_2417/req_2418).

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

/** The dock POS/ANG readout — the SELECTED world piece, or null when nothing is
 *  selected (the dock renders dashes; phantom zeros read as data). */
export function selectedPieceReadout(state: EditorState) {
  const piece = state.worldPieces.find((p) => p.id === state.selectedPieceId);
  if (!piece) return null;
  return {
    x: Math.round(piece.x),
    y: Math.round(piece.y),
    z: Math.round(piece.z),
    yawDegrees: Math.round(piece.yawDegrees),
  };
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
