// editors/workbench/materials/chooser.ts -- the shared material chooser data
// contract. Consumers pass registry material rows in; this module owns the
// grouping/label semantics so buildings, garments, and future vehicle material
// variants do not each invent their own material picker shape.

import type { PickOption } from '../../../shell/fields';

export type MaterialSource = 'recipe' | 'preset' | 'react' | 'stored' | 'stored-decal';
export type MaterialChoice = { id: string; label: string; group?: string; source?: MaterialSource };

/** Last-resort visible grouping when a caller forgot to pass catalog metadata.
 *  Board-letter prefixes (`a-`, `b-`, ... `o-`) are shader implementation
 *  detail and must never leak into picker categories. */
export function materialFamily(id: string): string {
  if (id.startsWith('custom:')) return 'Stored Materials';
  return 'Unsorted Materials';
}

export function materialPickOptions(materials: Iterable<MaterialChoice>): PickOption[] {
  return [...materials].map((m) => ({ id: m.id, label: m.label, group: m.group ?? materialFamily(m.id) }));
}

export function materialLabel(materials: Iterable<MaterialChoice>, id: string): string {
  return [...materials].find((m) => m.id === id)?.label ?? id;
}
