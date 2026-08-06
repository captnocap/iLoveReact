import type { ModelPart } from '../data/types';
import {
  assignPartsToGroup,
  moveOutlinerItem,
  nextModelGroupName,
  partGroupPath,
  partsInGroup,
  ungroupParts,
  withPartGroupPath,
  type ModelOutlinerDragItem,
  type ModelOutlinerDropTarget,
} from '../data/modelOutliner';

export const MODEL_PART_NAME_MAX_CHARS = 80;

export const MODEL_PART_RENAME_COMMAND_ID = 'model.part.rename';
export const MODEL_PARTS_GROUP_COMMAND_ID = 'model.parts.group';
export const MODEL_PARTS_UNGROUP_COMMAND_ID = 'model.parts.ungroup';
export const MODEL_GROUP_RENAME_COMMAND_ID = 'model.group.rename';
export const MODEL_GROUP_DISSOLVE_COMMAND_ID = 'model.group.dissolve';
export const MODEL_OUTLINER_MOVE_COMMAND_ID = 'model.outliner.move';
export const MODEL_OUTLINER_ACTION_COMMAND_IDS = [
  MODEL_PART_RENAME_COMMAND_ID,
  MODEL_PARTS_GROUP_COMMAND_ID,
  MODEL_PARTS_UNGROUP_COMMAND_ID,
  MODEL_GROUP_RENAME_COMMAND_ID,
  MODEL_GROUP_DISSOLVE_COMMAND_ID,
  MODEL_OUTLINER_MOVE_COMMAND_ID,
] as const;
export type ModelOutlinerCommandId = typeof MODEL_OUTLINER_ACTION_COMMAND_IDS[number];

/** Mesh data remains host-resident. The outliner transaction contains every
 * durable metadata field needed for exact replay without copying geometry into
 * the event stream. */
export type ModelPartRecord = Omit<ModelPart, 'mesh'>;

export type ModelOutlinerSnapshot = {
  modelId: string;
  parts: readonly ModelPartRecord[];
  nextSequence: number;
};

export type ModelOutlinerAction =
  | 'part.rename'
  | 'parts.group'
  | 'parts.ungroup'
  | 'group.rename'
  | 'group.dissolve'
  | 'outliner.move';

export type ModelOutlinerTransaction = {
  action: ModelOutlinerAction;
  commandId: ModelOutlinerCommandId;
  modelId: string;
  partIds: readonly string[];
  groupId?: string;
  before: readonly ModelPartRecord[];
  after: readonly ModelPartRecord[];
};

export type ModelOutlinerPlan = {
  label: string;
  status: string;
  next: ModelOutlinerSnapshot;
  transaction: ModelOutlinerTransaction;
};

export class ModelOutlinerRejected extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ModelOutlinerRejected';
  }
}

function cleanRecords(parts: readonly ModelPart[]): ModelPartRecord[] {
  return parts.map(({ mesh: _mesh, ...record }) => ({ ...record }));
}

export function modelPartRecords(parts: readonly ModelPart[]): ModelPartRecord[] {
  return cleanRecords(parts);
}

export function modelOutlinerNote(modelId: string, parts: readonly ModelPartRecord[]): string {
  return JSON.stringify({ modelId, parts });
}

const APPENDED_PART_HISTORY_LABELS = new Set(['duplicate part', 'mirror part']);

/** Last-resort inverse for append-only part history when an older/native caller
 * restored geometry without a usable metadata note. Duplicate and Mirror Part
 * append one highest-ranked native range; undo removes exactly that row. Keep
 * every surviving row's authored identity and only re-stamp its host range. */
export function recoverAppendedPartUndoRows<T extends { lo?: number; hi?: number }>(
  rows: readonly T[],
  ranges: readonly { lo: number; hi: number }[],
  historyLabel: string,
): T[] | null {
  if (!APPENDED_PART_HISTORY_LABELS.has(historyLabel) || rows.length !== ranges.length + 1) return null;
  if (ranges.some((range) => !Number.isInteger(range.lo) || !Number.isInteger(range.hi) || range.hi <= range.lo)) return null;
  const ranked = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => ((a.row.lo ?? Number.MAX_SAFE_INTEGER) - (b.row.lo ?? Number.MAX_SAFE_INTEGER)) || (a.index - b.index));
  const appended = ranked[ranked.length - 1];
  if (!appended || !Number.isInteger(appended.row.lo) || !Number.isInteger(appended.row.hi)) return null;
  const kept = rows.filter((_row, index) => index !== appended.index);
  const keptByRange = kept
    .map((row, index) => ({ row, index }))
    .sort((a, b) => ((a.row.lo ?? Number.MAX_SAFE_INTEGER) - (b.row.lo ?? Number.MAX_SAFE_INTEGER)) || (a.index - b.index));
  const restoredRanges = ranges.slice().sort((a, b) => a.lo - b.lo);
  const restored = kept.slice();
  keptByRange.forEach((entry, rank) => {
    const range = restoredRanges[rank]!;
    restored[entry.index] = { ...entry.row, lo: range.lo, hi: range.hi };
  });
  return restored;
}

function assertSnapshot(snapshot: ModelOutlinerSnapshot, modelId: string): ModelPartRecord[] {
  if (!modelId || snapshot.modelId !== modelId) {
    throw new ModelOutlinerRejected('WRONG_MODEL', 'the requested model is not the active model document');
  }
  if (!Number.isInteger(snapshot.nextSequence) || snapshot.nextSequence < 0) {
    throw new ModelOutlinerRejected('INVALID_SEQUENCE', 'the model identity sequence is invalid');
  }
  const parts = cleanRecords(snapshot.parts as readonly ModelPart[]);
  const ids = new Set<string>();
  for (const part of parts) {
    if (!part.id || ids.has(part.id)) throw new ModelOutlinerRejected('INVALID_PARTS', 'model part ids must be unique');
    ids.add(part.id);
  }
  return parts;
}

function trimmedName(raw: unknown, kind: 'part' | 'group'): string {
  if (typeof raw !== 'string') throw new ModelOutlinerRejected('INVALID_NAME', `${kind} name must be text`);
  const name = raw.trim().slice(0, MODEL_PART_NAME_MAX_CHARS);
  if (!name) throw new ModelOutlinerRejected('INVALID_NAME', `${kind} names cannot be blank`);
  return name;
}

function exactPartIds(parts: readonly ModelPartRecord[], rawIds: unknown): string[] {
  if (!Array.isArray(rawIds)) throw new ModelOutlinerRejected('INVALID_SELECTION', 'part ids must be an array');
  const ids = [...new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length !== rawIds.length || ids.some((id) => !parts.some((part) => part.id === id))) {
    throw new ModelOutlinerRejected('INVALID_SELECTION', 'the part selection contains a missing or duplicate row');
  }
  return ids;
}

function plan(
  snapshot: ModelOutlinerSnapshot,
  commandId: ModelOutlinerCommandId,
  action: ModelOutlinerAction,
  label: string,
  status: string,
  partIds: readonly string[],
  after: readonly ModelPartRecord[],
  nextSequence = snapshot.nextSequence,
  groupId?: string,
): ModelOutlinerPlan {
  const before = cleanRecords(snapshot.parts as readonly ModelPart[]);
  return {
    label,
    status,
    next: { modelId: snapshot.modelId, parts: cleanRecords(after as readonly ModelPart[]), nextSequence },
    transaction: {
      action,
      commandId,
      modelId: snapshot.modelId,
      partIds: [...partIds],
      ...(groupId ? { groupId } : {}),
      before,
      after: cleanRecords(after as readonly ModelPart[]),
    },
  };
}

export function planPartRename(
  snapshot: ModelOutlinerSnapshot,
  args: { modelId: string; partId: string; name: string },
): ModelOutlinerPlan {
  const parts = assertSnapshot(snapshot, args.modelId);
  const part = parts.find((candidate) => candidate.id === args.partId);
  if (!part) throw new ModelOutlinerRejected('PART_NOT_FOUND', 'part not found');
  const name = trimmedName(args.name, 'part');
  if (part.name === name) throw new ModelOutlinerRejected('NO_CHANGE', 'part already has that name');
  const after = parts.map((candidate) => candidate.id === part.id ? { ...candidate, name } : candidate);
  return plan(
    snapshot,
    MODEL_PART_RENAME_COMMAND_ID,
    'part.rename',
    `rename part ${part.name} → ${name}`,
    `renamed Outliner part "${part.name}" → "${name}"`,
    [part.id],
    after,
  );
}

export function planPartsGroup(
  snapshot: ModelOutlinerSnapshot,
  args: { modelId: string; partIds: readonly string[] },
): ModelOutlinerPlan {
  const parts = assertSnapshot(snapshot, args.modelId);
  const ids = exactPartIds(parts, args.partIds);
  if (ids.length < 2) throw new ModelOutlinerRejected('TOO_FEW_PARTS', 'group parts: select at least two outliner rows');
  const selected = ids.map((id) => parts.find((part) => part.id === id)!);
  const existingGroupIds = [...new Set(selected.map((part) => part.groupId).filter((id): id is string => Boolean(id)))];
  const addToExisting = existingGroupIds.length === 1 && selected.some((part) => part.groupId !== existingGroupIds[0]);
  if (existingGroupIds.length === 1 && !addToExisting && selected.every((part) => part.groupId === existingGroupIds[0])) {
    throw new ModelOutlinerRejected('NO_CHANGE', `${selected.length} selected parts are already in ${selected[0]!.groupName ?? 'group'}`);
  }
  const groupId = addToExisting ? existingGroupIds[0]! : `part-group:${snapshot.nextSequence}`;
  const groupName = addToExisting
    ? (parts.find((part) => part.groupId === groupId)?.groupName ?? nextModelGroupName(parts as ModelPart[]))
    : nextModelGroupName(parts as ModelPart[]);
  const after = assignPartsToGroup(parts as ModelPart[], ids, groupId, groupName);
  return plan(
    snapshot,
    MODEL_PARTS_GROUP_COMMAND_ID,
    'parts.group',
    addToExisting ? `add ${ids.length} parts to ${groupName}` : `group ${ids.length} parts as ${groupName}`,
    addToExisting ? `added selected parts to ${groupName}` : `grouped ${ids.length} parts as ${groupName}`,
    ids,
    after,
    addToExisting ? snapshot.nextSequence : snapshot.nextSequence + 1,
    groupId,
  );
}

export function planPartsUngroup(
  snapshot: ModelOutlinerSnapshot,
  args: { modelId: string; partIds: readonly string[] },
): ModelOutlinerPlan {
  const parts = assertSnapshot(snapshot, args.modelId);
  const ids = exactPartIds(parts, args.partIds);
  const count = parts.filter((part) => ids.includes(part.id) && part.groupId).length;
  if (count === 0) throw new ModelOutlinerRejected('NO_CHANGE', 'ungroup parts: the selected parts are already at the root');
  const after = ungroupParts(parts as ModelPart[], ids);
  return plan(
    snapshot,
    MODEL_PARTS_UNGROUP_COMMAND_ID,
    'parts.ungroup',
    `ungroup ${count} part${count === 1 ? '' : 's'}`,
    `moved ${count} selected part${count === 1 ? '' : 's'} to the outliner root — geometry kept`,
    ids,
    after,
  );
}

export function planGroupRename(
  snapshot: ModelOutlinerSnapshot,
  args: { modelId: string; groupId: string; name: string },
): ModelOutlinerPlan {
  const parts = assertSnapshot(snapshot, args.modelId);
  const members = partsInGroup(parts as ModelPart[], args.groupId);
  if (!args.groupId || members.length === 0) throw new ModelOutlinerRejected('GROUP_NOT_FOUND', 'part group not found');
  const name = trimmedName(args.name, 'group');
  const previousName = partGroupPath(members[0]!).find((group) => group.id === args.groupId)?.name ?? 'Group';
  if (previousName === name) throw new ModelOutlinerRejected('NO_CHANGE', 'group already has that name');
  if (parts.some((part) => partGroupPath(part as ModelPart).some((group) => group.id !== args.groupId && group.name.toLowerCase() === name.toLowerCase()))) {
    throw new ModelOutlinerRejected('DUPLICATE_NAME', `group name already in use: ${name}`);
  }
  const after = parts.map((part) => withPartGroupPath(part as ModelPart, partGroupPath(part as ModelPart).map((group) => (
    group.id === args.groupId ? { ...group, name } : group
  ))));
  return plan(
    snapshot,
    MODEL_GROUP_RENAME_COMMAND_ID,
    'group.rename',
    `rename group ${previousName} → ${name}`,
    `renamed group "${previousName}" → "${name}"`,
    members.map((part) => part.id),
    after,
    snapshot.nextSequence,
    args.groupId,
  );
}

export function planGroupDissolve(
  snapshot: ModelOutlinerSnapshot,
  args: { modelId: string; groupId: string },
): ModelOutlinerPlan {
  const parts = assertSnapshot(snapshot, args.modelId);
  const members = partsInGroup(parts as ModelPart[], args.groupId);
  if (!args.groupId || members.length === 0) throw new ModelOutlinerRejected('GROUP_NOT_FOUND', 'part group not found');
  const name = partGroupPath(members[0]!).find((group) => group.id === args.groupId)?.name ?? 'Group';
  const ids = members.map((part) => part.id);
  const after = parts.map((part) => withPartGroupPath(part as ModelPart, partGroupPath(part as ModelPart).filter((group) => group.id !== args.groupId)));
  return plan(
    snapshot,
    MODEL_GROUP_DISSOLVE_COMMAND_ID,
    'group.dissolve',
    `dissolve ${name}`,
    `dissolved ${name} — kept ${members.length} independent part${members.length === 1 ? '' : 's'}`,
    ids,
    after,
    snapshot.nextSequence,
    args.groupId,
  );
}

export function planOutlinerMove(
  snapshot: ModelOutlinerSnapshot,
  args: { modelId: string; item: ModelOutlinerDragItem; target: ModelOutlinerDropTarget },
): ModelOutlinerPlan {
  const parts = assertSnapshot(snapshot, args.modelId);
  if (!args.item || (args.item.kind !== 'part' && args.item.kind !== 'group') || typeof args.item.id !== 'string') {
    throw new ModelOutlinerRejected('INVALID_DRAG', 'outliner drag source is invalid');
  }
  if (!args.target || !['root', 'part', 'group'].includes(args.target.kind)) {
    throw new ModelOutlinerRejected('INVALID_DROP', 'outliner drop target is invalid');
  }
  const drop = args.target;
  if (drop.kind !== 'root' && (
    typeof drop.id !== 'string' ||
    !['before', 'after', 'inside'].includes(drop.position) ||
    (drop.kind === 'part' && drop.position === 'inside') ||
    !parts.some((part) => drop.kind === 'part'
      ? part.id === drop.id
      : partGroupPath(part as ModelPart).some((group) => group.id === drop.id))
  )) {
    throw new ModelOutlinerRejected('INVALID_DROP', 'outliner drop destination does not exist');
  }
  const after = moveOutlinerItem(parts as ModelPart[], args.item, args.target);
  if (after.map((part) => `${part.id}:${JSON.stringify(partGroupPath(part))}`).join('|') ===
      parts.map((part) => `${part.id}:${JSON.stringify(partGroupPath(part as ModelPart))}`).join('|')) {
    throw new ModelOutlinerRejected('NO_CHANGE', 'outliner item is already there');
  }
  const moved = args.item.kind === 'part'
    ? after.filter((part) => part.id === args.item.id)
    : partsInGroup(after, args.item.id);
  return plan(
    snapshot,
    MODEL_OUTLINER_MOVE_COMMAND_ID,
    'outliner.move',
    `move ${args.item.kind} ${args.item.id}`,
    `moved ${args.item.kind} in Outliner`,
    moved.map((part) => part.id),
    after,
  );
}
