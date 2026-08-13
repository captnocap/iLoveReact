// Stable humanoid anatomy assignment over the resident semantic table.
//
// A semantic row already stores two independent facts: `name` is the editable
// display label and `role` is the machine-owned anatomy key. Character binding
// consumes only the latter. This planner never guesses a role from a name.

import type { SemanticTable } from '../agent/seatApi';
import { declareRegion } from '../agent/seatApi';
import { parseModelSelectionSnapshot, type ModelSelectionSnapshot } from '../model/modelSelectionFocus';
import type { HumanoidSemanticRole, HumanoidSide } from '../../../runtime/skeleton';
import type { HumanoidSemanticMembership } from '../../../runtime/skeleton/readiness';

export type HumanoidSemanticRoleChoice = HumanoidSemanticMembership & {
  label: string;
  required: boolean;
};

const CENTER_ROLES = ['pelvis', 'abdomen', 'chest', 'head', 'neck'] as const;
const PAIRED_ROLES = [
  'clavicle', 'upper_arm', 'lower_arm', 'hand', 'fingers',
  'upper_leg', 'lower_leg', 'foot', 'toes',
] as const;

const REQUIRED_ROLE_KEYS = new Set([
  'pelvis', 'abdomen', 'chest', 'head',
  'upper_arm:left', 'upper_arm:right',
  'lower_arm:left', 'lower_arm:right',
  'hand:left', 'hand:right',
  'upper_leg:left', 'upper_leg:right',
  'lower_leg:left', 'lower_leg:right',
  'foot:left', 'foot:right',
]);

function titleWords(value: string): string {
  return value.split('_').map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join(' ');
}

export function humanoidSemanticRoleKey(value: HumanoidSemanticMembership): string {
  return `${value.role}${value.side ? `:${value.side}` : ''}`;
}

export function humanoidSemanticDisplayName(value: HumanoidSemanticMembership): string {
  return value.side
    ? `${value.side === 'left' ? 'Left' : 'Right'} ${titleWords(value.role)}`
    : titleWords(value.role);
}

export const HUMANOID_SEMANTIC_ROLE_CHOICES: readonly HumanoidSemanticRoleChoice[] = [
  ...CENTER_ROLES.map((role) => ({
    role,
    label: titleWords(role),
    required: REQUIRED_ROLE_KEYS.has(role),
  })),
  ...PAIRED_ROLES.flatMap((role) => (['left', 'right'] as const).map((side) => ({
    role,
    side,
    label: humanoidSemanticDisplayName({ role, side }),
    required: REQUIRED_ROLE_KEYS.has(`${role}:${side}`),
  }))),
] as readonly HumanoidSemanticRoleChoice[];

const LEGAL_KEYS = new Set(HUMANOID_SEMANTIC_ROLE_CHOICES.map(humanoidSemanticRoleKey));

const PART_ROLE_ALIASES: ReadonlyArray<readonly [string, HumanoidSemanticMembership]> = [
  ['pelvis', { role: 'pelvis' }], ['hips', { role: 'pelvis' }],
  ['abdomen', { role: 'abdomen' }], ['stomach', { role: 'abdomen' }],
  ['chest', { role: 'chest' }], ['torso', { role: 'chest' }],
  ['head', { role: 'head' }], ['neck', { role: 'neck' }],
  ['clavicle_left', { role: 'clavicle', side: 'left' }], ['left_clavicle', { role: 'clavicle', side: 'left' }],
  ['clavicle_right', { role: 'clavicle', side: 'right' }], ['right_clavicle', { role: 'clavicle', side: 'right' }],
  ['upper_arm_left', { role: 'upper_arm', side: 'left' }], ['left_upper_arm', { role: 'upper_arm', side: 'left' }],
  ['upper_arm_right', { role: 'upper_arm', side: 'right' }], ['right_upper_arm', { role: 'upper_arm', side: 'right' }],
  ['lower_arm_left', { role: 'lower_arm', side: 'left' }], ['left_lower_arm', { role: 'lower_arm', side: 'left' }],
  ['forearm_left', { role: 'lower_arm', side: 'left' }],
  ['lower_arm_right', { role: 'lower_arm', side: 'right' }], ['right_lower_arm', { role: 'lower_arm', side: 'right' }],
  ['forearm_right', { role: 'lower_arm', side: 'right' }],
  ['hand_left', { role: 'hand', side: 'left' }], ['left_hand', { role: 'hand', side: 'left' }],
  ['hand_right', { role: 'hand', side: 'right' }], ['right_hand', { role: 'hand', side: 'right' }],
  ['upper_leg_left', { role: 'upper_leg', side: 'left' }], ['left_upper_leg', { role: 'upper_leg', side: 'left' }],
  ['thigh_left', { role: 'upper_leg', side: 'left' }],
  ['upper_leg_right', { role: 'upper_leg', side: 'right' }], ['right_upper_leg', { role: 'upper_leg', side: 'right' }],
  ['thigh_right', { role: 'upper_leg', side: 'right' }],
  ['lower_leg_left', { role: 'lower_leg', side: 'left' }], ['left_lower_leg', { role: 'lower_leg', side: 'left' }],
  ['shin_left', { role: 'lower_leg', side: 'left' }],
  ['lower_leg_right', { role: 'lower_leg', side: 'right' }], ['right_lower_leg', { role: 'lower_leg', side: 'right' }],
  ['shin_right', { role: 'lower_leg', side: 'right' }],
  ['foot_left', { role: 'foot', side: 'left' }], ['left_foot', { role: 'foot', side: 'left' }],
  ['foot_right', { role: 'foot', side: 'right' }], ['right_foot', { role: 'foot', side: 'right' }],
  ['fingers_left', { role: 'fingers', side: 'left' }], ['fingers_right', { role: 'fingers', side: 'right' }],
  ['toes_left', { role: 'toes', side: 'left' }], ['toes_right', { role: 'toes', side: 'right' }],
];

function normalizedPartName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Conservative machine identity: only declared aliases match. Display labels
 * never become anatomy through substring guessing. */
export function humanoidSemanticMembershipFromPartName(name: string): HumanoidSemanticMembership | null {
  const normalized = normalizedPartName(name);
  return PART_ROLE_ALIASES.find(([alias]) => normalizedPartName(alias) === normalized)?.[1] ?? null;
}

export function humanoidSemanticMembershipFromKey(key: string): HumanoidSemanticMembership | null {
  if (!LEGAL_KEYS.has(key)) return null;
  const [roleText, sideText] = key.split(':');
  if (!isHumanoidSemanticRole(roleText!)) return null;
  return sideText === 'left' || sideText === 'right'
    ? { role: roleText, side: sideText }
    : { role: roleText };
}

export type ResidentSemanticRegionCount = { id: number; faces: number };

export type HumanoidSemanticAssignmentPlan =
  | {
      kind: 'assign-selection' | 'update-region';
      roleKey: string;
      regionId: number;
      displayName: string;
      table: SemanticTable;
    }
  | { kind: 'already-assigned'; roleKey: string; regionId: number; displayName: string }
  | { kind: 'rejected'; roleKey: string; reason: string };

function uniqueDisplayName(table: SemanticTable, wanted: string): string {
  const occupied = new Set(table.regions.map((row) => row.name));
  if (!occupied.has(wanted)) return wanted;
  const anatomy = `${wanted} Anatomy`;
  if (!occupied.has(anatomy)) return anatomy;
  let suffix = 2;
  while (occupied.has(`${anatomy} ${suffix}`)) suffix += 1;
  return `${anatomy} ${suffix}`;
}

function wholeSelectedRegion(
  table: SemanticTable,
  selection: ModelSelectionSnapshot,
  residentRegions: readonly ResidentSemanticRegionCount[],
): number | null {
  if (selection.mode !== 3 || selection.selectedTriangles === 0 || selection.truncated ||
      selection.triangles.length !== selection.selectedTriangles) return null;
  const ids = new Set(selection.triangles.map((triangle) => triangle.region));
  if (ids.size !== 1) return null;
  const only = [...ids][0];
  if (only === null || !table.regions.some((row) => row.id === only)) return null;
  const resident = residentRegions.find((row) => row.id === only);
  return resident?.faces === selection.selectedTriangles ? only : null;
}

/** Plan one exact role assignment. A complete existing display region keeps its
 * name and receives only a new stable role. An unnamed/partial/mixed selection
 * joins a role row selected by its exact role key, never by its display name. */
export function planHumanoidSemanticAssignment(
  table: SemanticTable,
  selection: ModelSelectionSnapshot | null,
  residentRegions: readonly ResidentSemanticRegionCount[],
  membership: HumanoidSemanticMembership,
): HumanoidSemanticAssignmentPlan {
  const roleKey = humanoidSemanticRoleKey(membership);
  if (!LEGAL_KEYS.has(roleKey)) return { kind: 'rejected', roleKey, reason: `invalid humanoid role ${roleKey}` };
  if (!selection || selection.mode !== 3 || selection.selectedTriangles === 0) {
    return { kind: 'rejected', roleKey, reason: 'select one or more faces first' };
  }
  const roleRows = table.regions.filter((row) => row.role === roleKey);
  if (roleRows.length > 1) {
    return { kind: 'rejected', roleKey, reason: `${roleKey} is already claimed by multiple semantic regions` };
  }
  const completeRegionId = wholeSelectedRegion(table, selection, residentRegions);
  if (completeRegionId !== null) {
    const current = table.regions.find((row) => row.id === completeRegionId)!;
    if (current.role === roleKey) {
      return { kind: 'already-assigned', roleKey, regionId: current.id, displayName: current.name };
    }
    if (roleRows.length === 0) {
      return {
        kind: 'update-region',
        roleKey,
        regionId: current.id,
        displayName: current.name,
        table: {
          ...table,
          regions: table.regions.map((row) => row.id === current.id ? { ...row, role: roleKey } : row),
        },
      };
    }
  }
  if (roleRows.length === 1) {
    const target = roleRows[0]!;
    return {
      kind: 'assign-selection',
      roleKey,
      regionId: target.id,
      displayName: target.name,
      table,
    };
  }
  const displayName = uniqueDisplayName(table, humanoidSemanticDisplayName(membership));
  const declared = declareRegion(table, displayName, roleKey, 'humanoid-role');
  return {
    kind: 'assign-selection',
    roleKey,
    regionId: declared.region.id,
    displayName: declared.region.name,
    table: declared.table,
  };
}

export type HumanoidSemanticAssignmentReceipt = {
  applied: boolean;
  changed: number;
  roleKey: string;
  displayName: string;
  reason?: string;
};

export type HumanoidSemanticAssignmentHost = {
  __mesh_semantic_state?: () => unknown;
  __mesh_edit_selection?: () => unknown;
  __mesh_semantic_assign?: (region: number, instance: number, tableJson: string) => unknown;
  __mesh_semantic_region_edit?: (region: number, remove: number, tableJson: string) => unknown;
  __mesh_semantic_stamp_part_ranges?: (stamps: Uint32Array, tableJson: string) => unknown;
};

function decodedJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Execute one planned role assignment through the same native semantic doors
 * used by Names and Agent Seat. Geometry and membership arrays stay resident. */
export function assignHumanoidSemanticSelection(
  host: HumanoidSemanticAssignmentHost,
  membership: HumanoidSemanticMembership,
): HumanoidSemanticAssignmentReceipt | null {
  if (typeof host.__mesh_semantic_state !== 'function' || typeof host.__mesh_edit_selection !== 'function') return null;
  const state = decodedJson(host.__mesh_semantic_state()) as {
    table?: SemanticTable;
    regions?: ResidentSemanticRegionCount[];
  } | null;
  const table = state?.table;
  if (!table || table.version !== 1 || !Array.isArray(table.regions)) return null;
  const selection = parseModelSelectionSnapshot(host.__mesh_edit_selection());
  const plan = planHumanoidSemanticAssignment(table, selection, Array.isArray(state?.regions) ? state.regions : [], membership);
  if (plan.kind === 'rejected') {
    return { applied: false, changed: 0, roleKey: plan.roleKey, displayName: '', reason: plan.reason };
  }
  if (plan.kind === 'already-assigned') {
    return {
      applied: false,
      changed: 0,
      roleKey: plan.roleKey,
      displayName: plan.displayName,
      reason: `${plan.displayName} already carries ${plan.roleKey}`,
    };
  }
  if (plan.kind === 'update-region') {
    if (typeof host.__mesh_semantic_region_edit !== 'function') return null;
    const result = Number(host.__mesh_semantic_region_edit(plan.regionId, 0, JSON.stringify(plan.table)) ?? -1);
    if (!Number.isFinite(result) || result < 0) {
      return { applied: false, changed: 0, roleKey: plan.roleKey, displayName: plan.displayName, reason: 'native semantic region edit was refused' };
    }
    return { applied: true, changed: Math.max(0, result), roleKey: plan.roleKey, displayName: plan.displayName };
  }
  if (typeof host.__mesh_semantic_assign !== 'function') return null;
  const changed = Math.max(0, Number(host.__mesh_semantic_assign(plan.regionId, 0, JSON.stringify(plan.table)) ?? 0) | 0);
  return changed > 0
    ? { applied: true, changed, roleKey: plan.roleKey, displayName: plan.displayName }
    : {
        applied: false,
        changed: 0,
        roleKey: plan.roleKey,
        displayName: plan.displayName,
        reason: `selected faces already carry ${plan.roleKey}`,
      };
}

export type HumanoidPartSemanticStampReceipt = {
  recognizedParts: number;
  changedTriangles: number;
  roleKeys: string[];
};

/** Stamp all recognized outliner parts through one native range transaction.
 * Unknown names stay untouched; ambiguous role rows fail closed. */
export function stampHumanoidSemanticsFromParts(
  host: HumanoidSemanticAssignmentHost,
  parts: readonly { name: string; lo: number; hi: number }[],
): HumanoidPartSemanticStampReceipt | null {
  if (typeof host.__mesh_semantic_state !== 'function' ||
      typeof host.__mesh_semantic_stamp_part_ranges !== 'function') return null;
  const state = decodedJson(host.__mesh_semantic_state()) as { table?: SemanticTable } | null;
  let table = state?.table;
  if (!table || table.version !== 1 || !Array.isArray(table.regions)) return null;
  const stamps: number[] = [];
  const roleKeys: string[] = [];
  for (const part of [...parts].sort((left, right) => left.lo - right.lo)) {
    if (!Number.isInteger(part.lo) || !Number.isInteger(part.hi) || part.lo < 0 || part.hi <= part.lo) {
      throw new Error(`invalid model part range for ${part.name}`);
    }
    const membership = humanoidSemanticMembershipFromPartName(part.name);
    if (!membership) continue;
    const roleKey = humanoidSemanticRoleKey(membership);
    const matches = table.regions.filter((region) => region.role === roleKey);
    if (matches.length > 1) throw new Error(`${roleKey} is already claimed by multiple semantic regions`);
    let region = matches[0];
    if (!region) {
      const displayName = uniqueDisplayName(table, part.name.trim() || humanoidSemanticDisplayName(membership));
      const declared = declareRegion(table, displayName, roleKey, 'auto-rig-part-stamp');
      table = declared.table;
      region = declared.region;
    }
    stamps.push(part.lo, part.hi, region.id);
    roleKeys.push(roleKey);
  }
  if (stamps.length === 0) return { recognizedParts: 0, changedTriangles: 0, roleKeys: [] };
  const changed = Number(host.__mesh_semantic_stamp_part_ranges(new Uint32Array(stamps), JSON.stringify(table)) ?? -1);
  if (!Number.isFinite(changed) || changed < 0) {
    throw new Error('native humanoid part stamp was refused; make every character part visible and retry');
  }
  return { recognizedParts: stamps.length / 3, changedTriangles: Math.trunc(changed), roleKeys };
}

export function isHumanoidSemanticRole(value: string): value is HumanoidSemanticRole {
  return [...CENTER_ROLES, ...PAIRED_ROLES].includes(value as never);
}

export function humanoidSemanticMembership(role: HumanoidSemanticRole, side?: HumanoidSide): HumanoidSemanticMembership {
  return side ? { role, side } : { role };
}
