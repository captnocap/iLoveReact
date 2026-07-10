import type { ModelPart } from './types';

export type ModelPartGroup = {
  id: string;
  name: string;
  parts: ModelPart[];
};

export type ModelOutlinerRoot =
  | { kind: 'part'; part: ModelPart }
  | { kind: 'group'; group: ModelPartGroup };

const DEFAULT_GROUP_STEM = 'Group';
const NUMBERED_SUFFIX = /\s+\((\d+)\)$/;
const LEGACY_COPY_SUFFIX = /\s+copy$/i;

/** Derive the flat folder view without changing the source part order or mesh model. */
export function modelOutlinerRoots(parts: readonly ModelPart[]): ModelOutlinerRoot[] {
  const roots: ModelOutlinerRoot[] = [];
  const groups = new Map<string, ModelPartGroup>();
  for (const part of parts) {
    if (!part.groupId) {
      roots.push({ kind: 'part', part });
      continue;
    }
    let group = groups.get(part.groupId);
    if (!group) {
      group = { id: part.groupId, name: part.groupName?.trim() || DEFAULT_GROUP_STEM, parts: [] };
      groups.set(part.groupId, group);
      roots.push({ kind: 'group', group });
    }
    group.parts.push(part);
  }
  return roots;
}

/** Next collision-free default folder label for this model. */
export function nextModelGroupName(parts: readonly ModelPart[]): string {
  const used = new Set(parts.map((part) => part.groupName?.trim()).filter((name): name is string => Boolean(name)));
  let index = 1;
  while (used.has(`${DEFAULT_GROUP_STEM} ${index}`)) index += 1;
  return `${DEFAULT_GROUP_STEM} ${index}`;
}

/** Assign exactly the named rows to one organizational folder; all other rows are stable. */
export function assignPartsToGroup(parts: readonly ModelPart[], partIds: readonly string[], groupId: string, groupName: string): ModelPart[] {
  const ids = new Set(partIds);
  const name = groupName.trim();
  if (!groupId || !name || ids.size === 0) return parts.slice();
  return parts.map((part) => (ids.has(part.id) ? { ...part, groupId, groupName: name } : part));
}

/** Move exactly the named rows back to the outliner root; geometry fields are retained. */
export function ungroupParts(parts: readonly ModelPart[], partIds: readonly string[]): ModelPart[] {
  const ids = new Set(partIds);
  return parts.map((part) => (ids.has(part.id) ? withoutPartGroup(part) : part));
}

/** Remove every legacy/numbered duplicate suffix, including a mixed old chain. */
export function duplicateNameStem(rawName: string): string {
  let name = rawName.trim() || 'Part';
  while (true) {
    const withoutCopy = name.replace(LEGACY_COPY_SUFFIX, '').trim();
    if (withoutCopy !== name) {
      name = withoutCopy;
      continue;
    }
    const withoutNumber = name.replace(NUMBERED_SUFFIX, '').trim();
    if (withoutNumber !== name) {
      name = withoutNumber;
      continue;
    }
    return name || 'Part';
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Name a duplicate from the source family instead of appending an unbounded copy chain.
 * `Cube (20)` therefore produces `Cube (21)`. A qualifier keeps mirror families distinct.
 */
export function nextDuplicatePartName(sourceName: string, existingNames: readonly string[], qualifier?: string): string {
  const stem = duplicateNameStem(sourceName);
  const family = qualifier ? `${stem} ${qualifier}` : stem;
  const numbered = new RegExp(`^${escapeRegex(family)} \\((\\d+)\\)$`, 'i');
  let max = 0;
  for (const raw of existingNames) {
    const name = raw.trim();
    if (name.toLowerCase() === family.toLowerCase()) {
      max = Math.max(max, 1);
      continue;
    }
    const match = name.match(numbered);
    if (match) {
      max = Math.max(max, Number(match[1]));
      continue;
    }
    if (!qualifier && duplicateNameStem(name).toLowerCase() === stem.toLowerCase() && LEGACY_COPY_SUFFIX.test(name)) {
      max = Math.max(max, 1);
    }
  }
  return max === 0 ? family : `${family} (${max + 1})`;
}

/** Name a copied folder from the existing folder family, independent of part names. */
export function nextDuplicateGroupName(sourceName: string, parts: readonly ModelPart[]): string {
  const groupNames = [...new Set(parts.map((part) => part.groupName?.trim()).filter((name): name is string => Boolean(name)))];
  return nextDuplicatePartName(sourceName, groupNames);
}

/** Dissolve organizational membership while preserving the complete part row. */
export function withoutPartGroup(part: ModelPart): ModelPart {
  const { groupId: _groupId, groupName: _groupName, ...rest } = part;
  return rest;
}
