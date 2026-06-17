// editors/model/anchors.ts — the ANCHOR helper layer (req_1244). An anchor is a
// FIXED rig marker, distinct from a joint: a seat / cargo slot / generic mount
// where a runtime occupant attaches. It does NOT rotate — where a joint owns a
// spin `axis` + a rotation `limit`, an anchor owns a FACING (the direction the
// occupant looks) + a `role` (driver/passenger/cargo/mount).
//
// An anchor IS a MountPoint (`kind:'anchor'`), so it rides the exact same store,
// drag/pick, rename, and mirror machinery as joints — this module only adds the
// anchor-specific construction + queries so that logic never gets re-rolled into
// the panel or the overlay. Pure + headless (the editMesh idiom), unit-testable.

import { addMount, ANCHOR_ROLES, type AnchorRole, type EditMesh, type MountPoint, type V3 } from './editMesh';

/** Facing when an anchor declares none — +Z (forward), the occupant looks ahead. */
export const DEFAULT_ANCHOR_FACING: V3 = [0, 0, 1];
export const DEFAULT_ANCHOR_ROLE: AnchorRole = 'driver';

/** Is this mount a fixed anchor (vs a rotating joint)? */
export function isAnchor(mt: MountPoint): boolean {
  return mt.kind === 'anchor';
}

/** The occupant's facing direction (the anchor reuses `axis` as facing). */
export function anchorFacing(mt: MountPoint): V3 {
  return mt.axis ?? DEFAULT_ANCHOR_FACING;
}

/** The anchor's role, defaulted (an anchor authored before a role was set reads
 *  as the default rather than blank). */
export function anchorRole(mt: MountPoint): AnchorRole {
  return mt.role ?? DEFAULT_ANCHOR_ROLE;
}

/** Partition a part's mounts into rotating JOINTS and fixed ANCHORS — the two rig
 *  groups the panel + overlay present separately. Preserves authoring order. */
export function splitMounts(m: EditMesh): { joints: MountPoint[]; anchors: MountPoint[] } {
  const joints: MountPoint[] = [];
  const anchors: MountPoint[] = [];
  for (const mt of m.mounts ?? []) (isAnchor(mt) ? anchors : joints).push(mt);
  return { joints, anchors };
}

/** First free `seat_N` (anchors share the mount namespace with joints, so the
 *  uniqueness check spans ALL mounts — a name is the binding key). */
export function nextAnchorName(m: EditMesh): string {
  const used = new Set((m.mounts ?? []).map((mt) => mt.name));
  for (let i = 1; ; i += 1) { const n = `seat_${i}`; if (!used.has(n)) return n; }
}

/** Add a fixed anchor at `position` (part-local), facing +Z by default, role
 *  driver by default. A `kind:'anchor'` MountPoint with no `limit` — pure. */
export function addAnchor(m: EditMesh, opts: { name: string; position: V3; facing?: V3; role?: AnchorRole }): EditMesh {
  return addMount(m, {
    name: opts.name,
    kind: 'anchor',
    position: [opts.position[0], opts.position[1], opts.position[2]],
    axis: opts.facing ?? DEFAULT_ANCHOR_FACING,
    role: opts.role ?? DEFAULT_ANCHOR_ROLE,
  });
}

/** The six cardinal facings, for a facing picker that wants named directions. */
export const ANCHOR_FACINGS: { label: string; dir: V3 }[] = [
  { label: '+X', dir: [1, 0, 0] }, { label: '−X', dir: [-1, 0, 0] },
  { label: '+Z', dir: [0, 0, 1] }, { label: '−Z', dir: [0, 0, -1] },
  { label: '+Y', dir: [0, 1, 0] }, { label: '−Y', dir: [0, -1, 0] },
];

export { ANCHOR_ROLES };
export type { AnchorRole };
