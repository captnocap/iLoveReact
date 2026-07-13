// cart/editor/data/editorEvents.ts — immutable command outcomes + legacy receipts.
//
// Migrated commands arrive here only through CommandAuthority's outcome sink;
// their durable envelopes carry command/action/source/phase correlation. Older
// editor paths still dispatch observational receipts until their slice migrates.
import { defineEventType, dispatch } from '../../../runtime/editorbus';
import type { EventCommandMetadata, TargetRef } from '../../../runtime/editorbus';
import type { CommandAppliedOutcome, CommandOutcome } from '../../../runtime/commands';
import type { HistoryEvent } from './types';
import type { WorldPiecesPlaceResult } from './applicationCommands';
import { assetById } from './catalog';
import { catalogRowFor } from '../world/buildCatalog';
import { pieceKindOf, placementSlotKey, type MaterialRef } from '../world/pieces';

type EditPayload = { verb: string; target: string; meta: string; editMs: number };
export type CommandOutcomePayload = {
  status: CommandOutcome['status'];
  label: string;
  result?: unknown;
  code?: string;
  reason?: string;
};
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
export type PiecePlacementPayload = {
  action: 'place' | 'replace';
  documentId: string;
  mode: 'click' | 'drag-run';
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
  applyStartedAtMs: number;
  appliedAtMs: number;
  applyMs: number;
  inputToAppliedMs: number;
  positions: PiecePlacementPosition[];
  slots: PiecePlacementSlot[];
  overrides: Record<string, number | boolean>;
  /** Exact forward/inverse transaction: replacement victims retain full data
   * and original indices, so replay and undo do not guess from counts. */
  transaction: WorldPiecesPlaceResult['plan']['transaction'];
};

// One event type for now — a plain authoring edit. Richer per-system types (piece.place,
// material.slot.fill, …) register themselves through this same seam as they get wired.
export const editorEdit = defineEventType<EditPayload>({
  type: 'editor.edit',
  undoable: true,
  describe: (p) => `${p.verb} ${p.target}`.trim() || 'edit',
});

/** The durable report for commands whose domain does not already own a richer
 * event type. The authority fields live on the common envelope; this payload is
 * presentation/result data only. */
export const commandOutcome = defineEventType<CommandOutcomePayload>({
  type: 'command.outcome',
  undoable: false,
  describe: (payload) => payload.label,
  validate: (payload) => {
    if (!payload.label || (payload.status !== 'applied' && payload.status !== 'rejected')) {
      throw new Error('command.outcome: malformed status/label');
    }
  },
});

export const piecePlace = defineEventType<PiecePlacementPayload>({
  type: 'piece.place',
  undoable: true,
  describe: (p) => {
    const prefix = p.action === 'replace' ? 'replace' : 'place';
    return p.count === 1 ? `${prefix} ${p.label}` : `${prefix} ${p.count}x ${p.label}`;
  },
  validate: (p) => {
    if (!p.documentId || !p.pieceId || !p.positions.length || p.positions.length !== p.count ||
        p.transaction.placed.length !== p.count) {
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

export function dispatchCommandOutcome(
  outcome: CommandOutcome,
  options: { label?: string; targets?: TargetRef[] } = {},
): number {
  const payload: CommandOutcomePayload = outcome.status === 'applied'
    ? { status: outcome.status, label: options.label ?? `${outcome.commandId} applied`, result: outcome.result }
    : {
        status: outcome.status,
        label: options.label ?? `${outcome.commandId} rejected`,
        code: outcome.code,
        reason: outcome.reason,
      };
  return dispatch(commandOutcome(payload, options.targets ?? [], commandMetadata(outcome)));
}

function commandMetadata(outcome: CommandOutcome): EventCommandMetadata {
  return {
    invocationId: outcome.invocationId,
    commandId: outcome.commandId,
    ...(outcome.status === 'applied' && outcome.actionId ? { actionId: outcome.actionId } : {}),
    source: outcome.source,
    phase: outcome.phase,
    ...(outcome.causedBy ? { causedBy: outcome.causedBy } : {}),
    ...(outcome.status === 'applied' ? {
      effect: outcome.effect,
      undoScope: outcome.undoScope === 'none' ? { kind: 'none' } : outcome.undoScope,
    } : {}),
  };
}

function materialName(ref: MaterialRef): string {
  if ('assetId' in ref) return assetById(ref.assetId).name;
  return `${ref.fn} v${ref.variant}`;
}

export function piecePlacementPayload(result: WorldPiecesPlaceResult): PiecePlacementPayload {
  const transaction = result.plan.transaction;
  const first = transaction.placed[0]!;
  const row = catalogRowFor(first.pieceId);
  const slots = Object.entries(first.slots ?? {}).map(([role, ref]) => ({ role, material: materialName(ref), ref }));
  return {
    action: transaction.action,
    documentId: transaction.documentId,
    mode: transaction.gestureMode,
    pieceId: first.pieceId,
    label: row?.label ?? first.pieceId,
    kind: pieceKindOf(first.pieceId) ?? row?.kind ?? 'unknown',
    material: row?.material ?? 'custom',
    theme: row?.theme ?? 'custom',
    count: transaction.placed.length,
    replaced: transaction.removed.length,
    pointerX: result.pointerX,
    pointerY: result.pointerY,
    inputAtMs: result.inputAtMs,
    applyStartedAtMs: result.applyStartedAtMs,
    appliedAtMs: result.appliedAtMs,
    applyMs: result.applyMs,
    inputToAppliedMs: result.inputToAppliedMs,
    positions: transaction.placed.map((piece) => ({
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
    transaction,
  };
}

export function dispatchPiecePlacementOutcome(outcome: CommandAppliedOutcome<WorldPiecesPlaceResult>): number {
  const payload = piecePlacementPayload(outcome.result);
  return dispatch(piecePlace(
    payload,
    [
      { kind: 'map', id: payload.documentId },
      { kind: 'piece-kind', id: payload.pieceId },
      ...payload.positions.map((p) => ({ kind: 'piece', id: p.id })),
      ...payload.transaction.removed.map((row) => ({ kind: 'piece', id: row.piece.id })),
    ],
    commandMetadata(outcome),
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
