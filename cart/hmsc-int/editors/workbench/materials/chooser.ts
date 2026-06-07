// editors/workbench/materials/chooser.ts -- the shared material chooser data
// contract. Consumers pass registry material rows in; this module owns the
// grouping/label semantics so buildings, garments, and future vehicle material
// variants do not each invent their own material picker shape.

import type { PickOption } from '../../../shell/fields';

export type MaterialChoice = { id: string; label: string };

/** Material ids group by their family prefix (`a-`, `b-`, ...). Unprefixed ids
 *  such as facades, road, and stored decals pool under `misc`. */
export function materialFamily(id: string): string {
  const dash = id.indexOf('-');
  if (dash > 0 && dash <= 2) return `${id.slice(0, dash)}-family`;
  return 'misc';
}

export function materialPickOptions(materials: Iterable<MaterialChoice>): PickOption[] {
  return [...materials].map((m) => ({ id: m.id, label: m.label, group: materialFamily(m.id) }));
}

export function materialLabel(materials: Iterable<MaterialChoice>, id: string): string {
  return [...materials].find((m) => m.id === id)?.label ?? id;
}
