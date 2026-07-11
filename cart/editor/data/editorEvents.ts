// cart/editor/data/editorEvents.ts — the editor boarding the real eventbus.
//
// Every recorded authoring edit is dispatched as ONE `editor.edit` event through the
// runtime/editorbus door. That door is host-backed by framework/events/editor_bus.zig
// (durable SQLite log, authoritative monotonic seq, multiplayer-shaped origin) once the
// v8 bindings are built into the binary, and degrades to an in-process log otherwise.
//
// state.history stays the editor's LOCAL undo model (fast, capped, session-only). The
// bus is the separate durable source of truth. This is the first step of the migration
// AppFrame has been promising itself — the editor getting on the bus that was already
// built and parked at the station (req_2424).
import { defineEventType, dispatch } from '../../../runtime/editorbus';
import type { HistoryEvent } from './types';
import { assetById } from './catalog';
import { catalogRowFor } from '../world/buildCatalog';
import { pieceKindOf, placementSlotKey, type MaterialRef, type PlacedPiece, type PlacementGesture } from '../world/pieces';

type EditPayload = { verb: string; target: string; meta: string; editMs: number };
export type MapAuthoringAction = 'stroke' | 'road.commit' | 'road.delete' | 'chunk.grow' | 'zone.drop' | 'tile.bindings' | 'path.control.add' | 'path.control.delete';
export type MapPaintPayload = {
  action: MapAuthoringAction;
  label: string;
  channel: string;
  mode: string;
  terrainTool?: string;
  shape?: string;
  profile?: string;
  radiusM?: number;
  heightM?: number;
  tileKind?: string;
  tileLabel?: string;
  material?: string;
  floraKind?: string;
  floraLabel?: string;
  floraLane?: number;
  zoneIdx?: number;
  zoneLabel?: string;
  start?: { x: number; z: number };
  end?: { x: number; z: number };
  samples?: number;
  stamps?: number;
  touchedChunks?: number;
  waterDry?: boolean;
  roadId?: number;
  chunk?: { cx: number; cz: number };
  bindingCount?: number;
  droppedBefore?: number;
  durationMs: number;
  materializedAtMs: number;
  inputToMaterializedMs: number;
  applyMs: number;
  renderDeltaMs: number;
};
export type PiecePlacementPosition = {
  id: string;
  slotKey: string;
  x: number;
  y: number;
  z: number;
  floor: number;
  yawDegrees: number;
};
export type PiecePlacementSlot = { role: string; material: string; ref: MaterialRef };
export type PiecePlacementDraftPayload = {
  action: 'place' | 'replace';
  mode: PlacementGesture['mode'];
  pieceId: string;
  label: string;
  kind: string;
  material: string;
  theme: string;
  count: number;
  replaced: number;
  pointerX: number;
  pointerY: number;
  inputAtMs: number;
  committedAtMs: number;
  applyMs: number;
  inputToCommitMs: number;
  positions: PiecePlacementPosition[];
  slots: PiecePlacementSlot[];
  overrides: Record<string, number | boolean>;
};
export type PiecePlacementPayload = PiecePlacementDraftPayload & {
  materializedAtMs: number;
  inputToMaterializedMs: number;
  commitToMaterializedMs: number;
  renderDeltaMs: number;
};

// One event type for now — a plain authoring edit. Richer per-system types (piece.place,
// material.slot.fill, …) register themselves through this same seam as they get wired.
export const editorEdit = defineEventType<EditPayload>({
  type: 'editor.edit',
  undoable: true,
  describe: (p) => `${p.verb} ${p.target}`.trim() || 'edit',
});

export const piecePlace = defineEventType<PiecePlacementPayload>({
  type: 'piece.place',
  undoable: true,
  describe: (p) => {
    const prefix = p.action === 'replace' ? 'replace' : 'place';
    return p.count === 1 ? `${prefix} ${p.label}` : `${prefix} ${p.count}x ${p.label}`;
  },
  validate: (p) => {
    if (!p.pieceId || !p.positions.length || p.positions.length !== p.count) {
      throw new Error('piece.place: payload count/positions mismatch');
    }
  },
});

export const mapPaint = defineEventType<MapPaintPayload>({
  type: 'map.paint',
  undoable: true,
  describe: (p) => p.label || `${p.action} ${p.channel}`.trim(),
  validate: (p) => {
    if (!p.action || !p.channel || !Number.isFinite(p.durationMs)) {
      throw new Error('map.paint: malformed payload');
    }
  },
});

// A world-global tune (GLOBALS req_2770): one field of data/globals.ts changed —
// steppers emit one event per click, reset emits one with the default as `value`.
// Not undoable: the ↺ reset chip on every field IS the undo, and a tuning run
// filling the world undo stack would bury real authoring edits.
export type GlobalsSetPayload = { field: string; value: number; previous: number };
export const globalsSet = defineEventType<GlobalsSetPayload>({
  type: 'globals.set',
  undoable: false,
  describe: (p) => `globals ${p.field} ${p.previous} → ${p.value}`,
  validate: (p) => {
    if (!p.field || !Number.isFinite(p.value)) throw new Error('globals.set: field/value malformed');
  },
});

export function dispatchGlobalsSet(payload: GlobalsSetPayload): number {
  return dispatch(globalsSet(payload, [{ kind: 'globals', id: payload.field }]));
}

/** Dispatch a recorded history entry onto the editor bus. Returns the assigned seq
 *  (SEQ_PENDING if the host rejected it). Safe to call whether or not the host bus
 *  is wired — the door handles the fallback. */
export function dispatchEdit(h: HistoryEvent): number {
  return dispatch(editorEdit(
    { verb: h.verb, target: h.target, meta: h.meta, editMs: h.editMs ?? 0 },
    [{ kind: 'edit', id: h.id }],
  ));
}

function materialName(ref: MaterialRef): string {
  if ('assetId' in ref) return assetById(ref.assetId).name;
  return `${ref.fn} v${ref.variant}`;
}

export function draftPiecePlacementEvent(args: {
  placed: PlacedPiece[];
  replaced: number;
  gesture: PlacementGesture;
  applyMs: number;
  committedAtMs: number;
}): PiecePlacementDraftPayload {
  const first = args.placed[0]!;
  const row = catalogRowFor(first.pieceId);
  const slots = Object.entries(first.slots ?? {}).map(([role, ref]) => ({ role, material: materialName(ref), ref }));
  const action: PiecePlacementDraftPayload['action'] = args.replaced && args.placed.length === 1 ? 'replace' : 'place';
  return {
    action,
    mode: args.gesture.mode,
    pieceId: first.pieceId,
    label: row?.label ?? first.pieceId,
    kind: pieceKindOf(first.pieceId) ?? row?.kind ?? 'unknown',
    material: row?.material ?? 'custom',
    theme: row?.theme ?? 'custom',
    count: args.placed.length,
    replaced: args.replaced,
    pointerX: args.gesture.pointerX,
    pointerY: args.gesture.pointerY,
    inputAtMs: args.gesture.inputAtMs,
    committedAtMs: args.committedAtMs,
    applyMs: args.applyMs,
    inputToCommitMs: Math.max(0, args.committedAtMs - args.gesture.inputAtMs),
    positions: args.placed.map((piece) => ({
      id: piece.id,
      slotKey: placementSlotKey(piece),
      x: piece.x,
      y: piece.y,
      z: piece.z,
      floor: piece.floor ?? 0,
      yawDegrees: piece.yawDegrees,
    })),
    slots,
    overrides: { ...(first.overrides ?? {}) },
  };
}

export function finalizePiecePlacementEvent(draft: PiecePlacementDraftPayload, materializedAtMs: number): PiecePlacementPayload {
  const inputToMaterializedMs = Math.max(0, materializedAtMs - draft.inputAtMs);
  const commitToMaterializedMs = Math.max(0, materializedAtMs - draft.committedAtMs);
  return {
    ...draft,
    materializedAtMs,
    inputToMaterializedMs,
    commitToMaterializedMs,
    renderDeltaMs: Math.max(0, inputToMaterializedMs - draft.applyMs),
  };
}

export function dispatchPiecePlacement(payload: PiecePlacementPayload): number {
  return dispatch(piecePlace(
    payload,
    [
      { kind: 'piece-kind', id: payload.pieceId },
      ...payload.positions.map((p) => ({ kind: 'piece', id: p.id })),
    ],
  ));
}

export function dispatchMapPaint(payload: MapPaintPayload): number {
  const targets = [
    { kind: 'map', id: 'painted-map' },
    { kind: 'map-channel', id: payload.channel },
  ];
  if (payload.chunk) targets.push({ kind: 'chunk', id: `${payload.chunk.cx},${payload.chunk.cz}` });
  if (typeof payload.roadId === 'number' && payload.roadId > 0) targets.push({ kind: 'road', id: String(payload.roadId) });
  return dispatch(mapPaint(payload, targets));
}
