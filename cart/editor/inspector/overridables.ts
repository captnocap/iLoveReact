// inspector/overridables.ts — the per-instance properties a placed build piece
// can override (req_2563 Phase 3). The paths mirror the host's BuildGameplayTags
// vocabulary (framework/game/
// build.zig) rather than tile-surface terms.
//
// An override is authoring intent stored on the piece (piece.overrides[path]).
// `base` is the editing baseline the field starts from; RESET removes the key
// entirely (back to the piece kind's host default). Host consumption of these
// per-instance overrides is a later world_loader slice — for now they persist as
// authored data on the piece, exactly as the plan scopes it.

export type OverridableCtl = 'num' | 'bool';

export type OverridableProp = {
  /** the key written into piece.overrides */
  path: string;
  label: string;
  ctl: OverridableCtl;
  /** section header the field sits under */
  group: string;
  /** editing baseline (the value the first edit departs from) */
  base: number | boolean;
  min?: number;
  max?: number;
  step?: number;
};

export const PIECE_OVERRIDABLE: OverridableProp[] = [
  { path: 'collision', label: 'collision', ctl: 'bool', group: 'COLLISION', base: true },
  { path: 'climbable', label: 'climbable', ctl: 'bool', group: 'COLLISION', base: false },
  { path: 'vaultable', label: 'vaultable', ctl: 'bool', group: 'COLLISION', base: false },
  { path: 'blocksSight', label: 'blocksSight', ctl: 'bool', group: 'OCCLUSION', base: true },
  { path: 'blocksSound', label: 'blocksSound', ctl: 'bool', group: 'OCCLUSION', base: true },
  { path: 'durability', label: 'durability', ctl: 'num', group: 'DURABILITY', base: 100, min: 0, max: 500, step: 10 },
  { path: 'opacity', label: 'opacity', ctl: 'num', group: 'VISUAL', base: 1, min: 0, max: 1, step: 0.05 },
];

/** The override props grouped by their `group`, in first-seen order. */
export function overridableGroups(): { group: string; props: OverridableProp[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, OverridableProp[]>();
  for (const p of PIECE_OVERRIDABLE) {
    if (!byGroup.has(p.group)) { byGroup.set(p.group, []); order.push(p.group); }
    byGroup.get(p.group)!.push(p);
  }
  return order.map((group) => ({ group, props: byGroup.get(group)! }));
}
