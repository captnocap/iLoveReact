import type { ModelPart, ModelPartGroupRef } from './types';

export type ModelPartGroup = {
  id: string;
  name: string;
  parts: ModelPart[];
  path: ModelPartGroupRef[];
  children: ModelOutlinerRoot[];
};

export type ModelOutlinerRoot =
  | { kind: 'part'; part: ModelPart }
  | { kind: 'group'; group: ModelPartGroup };

const DEFAULT_GROUP_STEM = 'Group';
const NUMBERED_SUFFIX = /\s+\((\d+)\)$/;
const LEGACY_COPY_SUFFIX = /\s+copy$/i;

/** Read canonical ancestry while remaining lossless for old one-folder packages. */
export function partGroupPath(part: ModelPart): ModelPartGroupRef[] {
  const path = part.groupPath?.filter((entry) => Boolean(
    entry && typeof entry.id === 'string' && entry.id && typeof entry.name === 'string' && entry.name.trim(),
  ))
    .map((entry) => ({ id: entry.id, name: entry.name.trim() }));
  if (path?.length) return path;
  return part.groupId
    ? [{ id: part.groupId, name: part.groupName?.trim() || DEFAULT_GROUP_STEM }]
    : [];
}

/** Write ancestry and its legacy leaf mirror as one indivisible metadata update. */
export function withPartGroupPath(part: ModelPart, path: readonly ModelPartGroupRef[]): ModelPart {
  const clean = path.filter((entry) => Boolean(entry.id && entry.name.trim()))
    .map((entry) => ({ id: entry.id, name: entry.name.trim() }));
  if (clean.length === 0) return withoutPartGroup(part);
  const leaf = clean[clean.length - 1]!;
  return { ...part, groupPath: clean, groupId: leaf.id, groupName: leaf.name };
}

export function partInGroup(part: ModelPart, groupId: string): boolean {
  return partGroupPath(part).some((entry) => entry.id === groupId);
}

export function partsInGroup(parts: readonly ModelPart[], groupId: string): ModelPart[] {
  return parts.filter((part) => partInGroup(part, groupId));
}

export function groupPathById(parts: readonly ModelPart[], groupId: string): ModelPartGroupRef[] | null {
  for (const part of parts) {
    const path = partGroupPath(part);
    const index = path.findIndex((entry) => entry.id === groupId);
    if (index >= 0) return path.slice(0, index + 1);
  }
  return null;
}

/** Derive the recursive folder tree without changing source part order or mesh data. */
export function modelOutlinerRoots(parts: readonly ModelPart[]): ModelOutlinerRoot[] {
  const roots: ModelOutlinerRoot[] = [];
  const groups = new Map<string, ModelPartGroup>();
  for (const part of parts) {
    const path = partGroupPath(part);
    if (path.length === 0) {
      roots.push({ kind: 'part', part });
      continue;
    }
    let siblings = roots;
    for (let depth = 0; depth < path.length; depth += 1) {
      const ref = path[depth]!;
      let group = groups.get(ref.id);
      if (!group) {
        group = { id: ref.id, name: ref.name, path: path.slice(0, depth + 1), parts: [], children: [] };
        groups.set(ref.id, group);
        siblings.push({ kind: 'group', group });
      }
      if (!group.parts.some((member) => member.id === part.id)) group.parts.push(part);
      siblings = group.children;
    }
    siblings.push({ kind: 'part', part });
  }
  return roots;
}

/** Next collision-free default folder label for this model. */
export function nextModelGroupName(parts: readonly ModelPart[]): string {
  const used = new Set(parts.flatMap(partGroupPath).map((group) => group.name));
  let index = 1;
  while (used.has(`${DEFAULT_GROUP_STEM} ${index}`)) index += 1;
  return `${DEFAULT_GROUP_STEM} ${index}`;
}

/** Assign exactly the named rows to one organizational folder; all other rows are stable. */
export function assignPartsToGroup(parts: readonly ModelPart[], partIds: readonly string[], groupId: string, groupName: string): ModelPart[] {
  const ids = new Set(partIds);
  const name = groupName.trim();
  if (!groupId || !name || ids.size === 0) return parts.slice();
  return parts.map((part) => (ids.has(part.id) ? withPartGroupPath(part, [{ id: groupId, name }]) : part));
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
  const groupNames = [...new Set(parts.flatMap(partGroupPath).map((group) => group.name))];
  return nextDuplicatePartName(sourceName, groupNames);
}

/** Dissolve organizational membership while preserving the complete part row. */
export function withoutPartGroup(part: ModelPart): ModelPart {
  const { groupId: _groupId, groupName: _groupName, groupPath: _groupPath, ...rest } = part;
  return rest;
}

export type ModelOutlinerDragItem = { kind: 'part' | 'group'; id: string };
export type ModelOutlinerDropTarget =
  | { kind: 'root' }
  | { kind: 'part' | 'group'; id: string; position: 'before' | 'after' | 'inside' };

function rewriteGroupPrefix(part: ModelPart, groupId: string, destinationParent: readonly ModelPartGroupRef[]): ModelPart {
  const path = partGroupPath(part);
  const at = path.findIndex((entry) => entry.id === groupId);
  if (at < 0) return part;
  return withPartGroupPath(part, [...destinationParent, ...path.slice(at)]);
}

/** Pure drag/drop transform: reorder rows and/or reparent one part/folder. */
export function moveOutlinerItem(
  parts: readonly ModelPart[],
  item: ModelOutlinerDragItem,
  target: ModelOutlinerDropTarget,
): ModelPart[] {
  const source = item.kind === 'part'
    ? parts.filter((part) => part.id === item.id)
    : partsInGroup(parts, item.id);
  if (source.length === 0) return parts.slice();
  const sourceIds = new Set(source.map((part) => part.id));

  const targetPath = target.kind === 'root'
    ? []
    : target.kind === 'part'
      ? partGroupPath(parts.find((part) => part.id === target.id) ?? source[0]!)
      : (groupPathById(parts, target.id) ?? []);
  if (item.kind === 'group' && targetPath.some((entry) => entry.id === item.id)) return parts.slice();

  const rewritten = source.map((part) => {
    if (item.kind === 'part') {
      const destination = target.kind === 'group' && target.position === 'inside'
        ? targetPath
        : target.kind === 'root' ? [] : targetPath.slice(0, target.kind === 'group' ? -1 : undefined);
      return withPartGroupPath(part, destination);
    }
    const destinationParent = target.kind === 'group' && target.position === 'inside'
      ? targetPath
      : target.kind === 'root' ? [] : targetPath.slice(0, target.kind === 'group' ? -1 : undefined);
    return rewriteGroupPrefix(part, item.id, destinationParent);
  });

  const remaining = parts.filter((part) => !sourceIds.has(part.id));
  let insertion = remaining.length;
  if (target.kind !== 'root') {
    const targetMembers = target.kind === 'part'
      ? remaining.filter((part) => part.id === target.id)
      : partsInGroup(remaining, target.id);
    if (targetMembers.length) {
      const indexes = targetMembers.map((member) => remaining.findIndex((part) => part.id === member.id));
      insertion = target.position === 'before' ? Math.min(...indexes) : Math.max(...indexes) + 1;
    }
  }
  const next = [...remaining.slice(0, insertion), ...rewritten, ...remaining.slice(insertion)];
  return next.map((part, outlinerOrder) => ({ ...part, outlinerOrder }));
}
