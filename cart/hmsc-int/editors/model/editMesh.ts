// editors/model/editMesh.ts — the Studio's editable topological mesh (req_0942
// → req_0950). THE KEYSTONE of the whole modeling consolidation: one mesh type
// with shared verts + n-gon (quad-friendly) faces + derived edge adjacency, that
// LOWERS to the same `GeometryData` triangle soup everything in the framework
// already renders (runtime/geometries/_util.ts). See ../MESH_EDITOR_PLAYBOOK.md.
//
// Pure + headless (the pieceShapes/worldParity idiom): no React, no Scene3D, no
// host doors — so editMesh.test.ts can prove the topology, the lowering, and the
// concave-quad Auto-Fix guard end to end. The optional layers the seven silos
// will need (per-face uv/material, per-vert rig weights, sculpt displacement) are
// DESIGNED IN as optional fields but NOT exercised in the first slice — later
// migrations extend this type, never fork it.

import { mesh, type GeometryData, type Vec3 } from '@reactjit/geometries';

export type V3 = [number, number, number];
export type V2 = [number, number];

/** One face — a vertex-index loop (CCW), 3+ corners, quad-friendly. The optional
 *  fields are the convergence layers (Part 1.5 of the playbook). */
export type EditMeshFace = {
  loop: number[];
  /** per-corner UV into the atlas, NORMALIZED [0,1] in a fixed square texture
   *  space, in the SAME order as `loop`. STORED DATA assigned once by `unwrap()`
   *  (Part 5 of the playbook) — geometry edits (gizmo move/resize, any vert move)
   *  NEVER touch it, so the UV is stable like Blockbench; topology edits (a cut)
   *  interpolate new-corner UVs. Absent until a part is unwrapped. */
  uv?: V2[];
  /** material/atlas slot. */
  material?: number;
  /** GLASS (req_1181): this face is a translucent pane (windshield / window), NOT a
   *  textured surface — it renders see-through and is skipped by the texture atlas.
   *  Authored per-face in the Studio; the cook carries it as the Glass material. */
  glass?: boolean;
  /** transient provenance tag — survives a cut so a tool can follow a face's
   *  pieces (the loop-cut selection-persist of req_0989). Not persisted geometry. */
  tag?: number;
};

/** The connector class — a STRICT, curated vocabulary if ever used (NOT a free
 *  string, USER req_1055), kept as a DORMANT field for a possible future Lego
 *  compatibility layer. The Studio does NOT author it (USER req_1057: "no type —
 *  generic covers all the bases"): joints connect by their explicit NAME binding
 *  (`model.joint.<name>`), so type-matching is unnecessary. `generic` = the
 *  unset/everything value; extend the table HERE if a typed layer is ever added. */
export const JOINT_TYPES = ['generic', 'axle', 'shoulder', 'hip', 'neck', 'spoiler', 'roof', 'hinge'] as const;
export type JointType = typeof JOINT_TYPES[number];

/** ANCHOR roles (req_1244) — what a FIXED (non-rotating) mount is FOR. A seat is
 *  not a joint: it doesn't swing about an axis, it's a placement where a runtime
 *  occupant/cargo attaches, facing a direction. The role drives runtime behaviour
 *  (a `driver` anchor is the mount that grants vehicle control). The anchor helper
 *  layer lives in `./anchors.ts`; the data shape (a `kind:'anchor'` MountPoint) is
 *  DESIGNED IN here so it round-trips through the same store as joints. */
export const ANCHOR_ROLES = ['driver', 'passenger', 'cargo', 'mount'] as const;
export type AnchorRole = typeof ANCHOR_ROLES[number];

/** A connection point — the Lego stud/anti-stud that mends parts together (USER
 *  req_0952). Connection points are PART OF THE DATA, authored in the Studio, NOT
 *  metadata bolted on later. A `socket` receives; a `plug` seats into it. Joints
 *  are addressed + bound by their unique NAME (req_1052/req_1057); `type` is an
 *  optional, dormant compatibility class (absent = `generic` = matches anything).
 *  This is the bones system made explicit: "head goes at the neck" = a 'neck'
 *  socket on the torso + the head's pivot bound to it. Same shape as the road
 *  grammar — parts are roads, mounts are plot points. */
export type MountPoint = {
  /** author-facing name, unique within the part — the BINDING KEY (req_1052):
   *  'back_left', 'front_right', 'hub'. */
  name: string;
  /** OPTIONAL dormant compatibility class (req_1057 — not authored in the UI;
   *  absent = `generic`). Strict if ever set (`JOINT_TYPES`, req_1055). */
  type?: JointType;
  /** 'socket'/'plug' = a JOINT (the part-to-part connector, rotation owned by
   *  `limit`). 'anchor' (req_1244) = a FIXED placement (a seat / cargo slot) — it
   *  never rotates; `axis` is its FACING, `role` says what it's for, and `limit`
   *  is unused. See `./anchors.ts` for the anchor helper layer. */
  kind: 'socket' | 'plug' | 'anchor';
  /** where on the part, in part-local space. */
  position: V3;
  /** orientation / spin axis (tire spin, head up). For an ANCHOR this is the
   *  FACING direction the occupant looks, not a spin axis. Default +Y when omitted. */
  axis?: V3;
  /** ANCHOR role (req_1244) — driver/passenger/cargo/mount. Only meaningful when
   *  `kind === 'anchor'`; absent on joints. */
  role?: AnchorRole;
  /** size constraint (axle hole / hub diameter) for the match check. */
  size?: number;
  /** ROTATION LIMIT a JOINT (socket) imposes on the child that connects here
   *  (USER req_1025): the joint is the AUTHORITY on how far its child may swing
   *  about `axis`. `full` = unconstrained (a tire spins freely); otherwise
   *  `min`/`max` are degrees from rest (e.g. a shoulder = -90..+90 → 180° of
   *  travel). Absent = unconstrained (back-compat). The child's PIVOT follows
   *  this; the pivot itself carries no limit (the joint owns the constraint). */
  limit?: { full?: boolean; min?: number; max?: number };
};

/** The travel a joint allows, in degrees: `full` → 360, else `max-min`. A joint
 *  with no limit is treated as full (the pre-req_1025 default). The arm-swing math
 *  the user described: a shoulder of -90..+90 yields 180° for the pivot to follow. */
export function jointTravelDegrees(j: MountPoint): number {
  const l = j.limit;
  if (!l || l.full) return 360;
  return Math.max(0, (l.max ?? 0) - (l.min ?? 0));
}

export type EditMesh = {
  verts: V3[];
  faces: EditMeshFace[];
  /** typed connection points — what makes a part composable (req_0952). */
  mounts?: MountPoint[];
  /** the part's ROTATION ORIGIN in part-local space (req_1025) — Blockbench's
   *  per-element "Pivot Point" (a wheel's center, a shoulder, a hip). Animation
   *  rotates the part AROUND this; composition aligns it to a parent socket.
   *  ABSENT = the live bounds center (`pivotOf`); once SET it is STICKY —
   *  geometry edits (translate/scale/the gizmo) never move it, like `uv`. */
  pivot?: V3;
};

/** Does a `plug` seat into a `socket`? Type must match; if both declare a size,
 *  the sizes must agree within tolerance. The rule that stops a tire mounting
 *  where a spoiler goes. The composition layer (assembling parts into a whole
 *  vehicle/character) rides this predicate — that layer is a DELIBERATE design
 *  step still to be specced (the playbook design gate), not built ad-hoc here. */
export function mountsCompatible(plug: MountPoint, socket: MountPoint, sizeTolerance = 1e-3): boolean {
  if (plug.kind !== 'plug' || socket.kind !== 'socket') return false;
  if ((plug.type ?? 'generic') !== (socket.type ?? 'generic')) return false; // absent = generic = matches
  if (plug.size != null && socket.size != null) return Math.abs(plug.size - socket.size) <= sizeTolerance;
  return true;
}

// ── Pivot + joints: the rotation origin + typed attach points (req_1025) ───────
// A part carries a PIVOT (its rotation origin, like Blockbench's per-element pivot
// point) and JOINTS (its `mounts` — the typed Lego connectors of Part 0). Both are
// part data on the EditMesh, so they persist (StoredPart.mesh) and undo
// (partMeshUpdated) for free; the Studio's `rig` mode authors them through the same
// transform gizmo. Pure + headless so editMesh.test.ts proves them. Animation
// rotates about the pivot around a joint's `axis`; composition seats a plug in a
// socket (mountsCompatible). Design + interaction: ../MESH_EDITOR_PLAYBOOK.md Part 6.

/** Axis-aligned bounds center of the mesh — the DEFAULT pivot when none is set
 *  (a centered cuboid → the origin). */
export function meshBoundsCenter(m: EditMesh): V3 {
  let lox = Infinity, loy = Infinity, loz = Infinity, hix = -Infinity, hiy = -Infinity, hiz = -Infinity;
  for (const v of m.verts) {
    if (v[0] < lox) lox = v[0]; if (v[0] > hix) hix = v[0];
    if (v[1] < loy) loy = v[1]; if (v[1] > hiy) hiy = v[1];
    if (v[2] < loz) loz = v[2]; if (v[2] > hiz) hiz = v[2];
  }
  if (!Number.isFinite(lox)) return [0, 0, 0];
  return [(lox + hix) / 2, (loy + hiy) / 2, (loz + hiz) / 2];
}

/** Does this part HAVE a pivot? A pivot is OPT-IN (USER req_1054): only parts that
 *  rotate (a wheel, an arm) get one; a ROOT part (a car body) has joints and NO
 *  pivot — nothing on it spins. A fresh `cuboid()`/`cylinder()` has none. */
export function hasPivot(m: EditMesh): boolean {
  return m.pivot != null;
}

/** A point to USE as the pivot: the explicitly-set one, else the bounds center —
 *  i.e. where a NEW pivot would land. NOTE this always returns a point; to ask
 *  whether the part actually HAS a pivot, use `hasPivot` (the rig UI shows the
 *  handle only when it does, so a body isn't given a phantom pivot). */
export function pivotOf(m: EditMesh): V3 {
  return m.pivot ? [m.pivot[0], m.pivot[1], m.pivot[2]] : meshBoundsCenter(m);
}

/** Set (or move) the part's rotation origin — sticky from here on. Pure. */
export function setPivot(m: EditMesh, p: V3): EditMesh {
  return { ...m, pivot: [p[0], p[1], p[2]] };
}

/** Drop the part's pivot (it becomes a root/non-rotating part again). Pure. */
export function clearPivot(m: EditMesh): EditMesh {
  if (m.pivot == null) return m;
  const { pivot, ...rest } = m;
  void pivot;
  return rest;
}

/** Add a typed joint (a MountPoint). Pure — appends to `mounts`. */
export function addMount(m: EditMesh, mount: MountPoint): EditMesh {
  return { ...m, mounts: [...(m.mounts ?? []), mount] };
}

/** Patch the named joint in place (position / axis / type / kind / size). A
 *  no-match returns the mesh unchanged. Pure. */
export function updateMount(m: EditMesh, name: string, patch: Partial<Omit<MountPoint, 'name'>>): EditMesh {
  if (!m.mounts) return m;
  let touched = false;
  const mounts = m.mounts.map((mt) => (mt.name === name ? (touched = true, { ...mt, ...patch }) : mt));
  return touched ? { ...m, mounts } : m;
}

/** Remove the named joint. Pure. */
export function removeMount(m: EditMesh, name: string): EditMesh {
  if (!m.mounts) return m;
  const mounts = m.mounts.filter((mt) => mt.name !== name);
  return mounts.length === m.mounts.length ? m : { ...m, mounts };
}

/** Rename a joint — the name is the BINDING KEY (`model.joint.<name>`, req_1052),
 *  so it must stay unique within the part: a clash auto-suffixes (`back_left_2`)
 *  rather than colliding or refusing (loud, never silent). Empty / unchanged /
 *  unknown old name → unchanged. Pure. */
export function renameMount(m: EditMesh, oldName: string, newName: string): EditMesh {
  const base = newName.trim();
  if (!m.mounts || !base || base === oldName) return m;
  const others = new Set(m.mounts.filter((mt) => mt.name !== oldName).map((mt) => mt.name));
  let final = base;
  for (let k = 2; others.has(final); k += 1) final = `${base}_${k}`;
  let touched = false;
  const mounts = m.mounts.map((mt) => (mt.name === oldName ? (touched = true, { ...mt, name: final }) : mt));
  return touched ? { ...m, mounts } : m;
}

// ── Mirror joints (req_1189): place one wheel-mount, get its symmetric partners ──
// The joint twin of the mesh mirror: reflect a MountPoint across the same X/Y/Z
// planes (multi-axis → diagonals, so X+Z off one front-left tire mount yields the
// front-right, rear-left, AND rear-right in one shot). Position AND spin axis are
// mirrored; names are suffixed + kept unique.

const MOUNT_AXIS_LETTER = ['x', 'y', 'z'] as const;

/** Reflect a mount across the planes in `axes` (each `= c`): position + spin axis
 *  flipped, the name suffixed with the plane letters. Pure. */
export function mirrorMount(mount: MountPoint, axes: (0 | 1 | 2)[], c = 0): MountPoint {
  const position: V3 = [mount.position[0], mount.position[1], mount.position[2]];
  const axis: V3 | undefined = mount.axis ? [mount.axis[0], mount.axis[1], mount.axis[2]] : undefined;
  let suffix = '';
  for (const a of axes) { position[a] = 2 * c - position[a]; if (axis) axis[a] = -axis[a]; suffix += MOUNT_AXIS_LETTER[a]; }
  return axis ? { ...mount, name: `${mount.name}_${suffix}`, position, axis } : { ...mount, name: `${mount.name}_${suffix}`, position };
}

/** Add the reflections of the named joint across every non-empty subset of `axes`
 *  (single planes + diagonals) — place one, get its mirror partners. Names stay
 *  unique. No match / no axes → unchanged. Pure. */
export function addMountReflections(m: EditMesh, name: string, axes: (0 | 1 | 2)[], c = 0): EditMesh {
  const src = m.mounts?.find((mt) => mt.name === name);
  if (!src || axes.length === 0) return m;
  const taken = new Set((m.mounts ?? []).map((mt) => mt.name));
  const uniq = (base: string): string => { let f = base; for (let k = 2; taken.has(f); k += 1) f = `${base}_${k}`; taken.add(f); return f; };
  const add: MountPoint[] = [];
  for (let mask = 1; mask < (1 << axes.length); mask += 1) {
    const s: (0 | 1 | 2)[] = [];
    for (let k = 0; k < axes.length; k += 1) if (mask & (1 << k)) s.push(axes[k]);
    const mir = mirrorMount(src, s, c);
    add.push({ ...mir, name: uniq(mir.name) });
  }
  return { ...m, mounts: [...(m.mounts ?? []), ...add] };
}

/** Move the named joint to `newPos` AND its position-matched mirror partners (across
 *  every non-empty subset of `axes`) to the reflected position — so adjusting one
 *  wheel mount keeps the set symmetric. Partners matched by the joint's CURRENT
 *  stored position. Pure. */
export function updateMountMirrored(m: EditMesh, name: string, newPos: V3, axes: (0 | 1 | 2)[], c = 0, dp = 4): EditMesh {
  let out = updateMount(m, name, { position: newPos });
  const src = m.mounts?.find((mt) => mt.name === name);
  if (!src || axes.length === 0) return out;
  const key = (p: V3) => `${p[0].toFixed(dp)},${p[1].toFixed(dp)},${p[2].toFixed(dp)}`;
  const byPos = new Map<string, string>();
  for (const mt of m.mounts!) if (mt.name !== name) byPos.set(key(mt.position), mt.name);
  for (let mask = 1; mask < (1 << axes.length); mask += 1) {
    const s: (0 | 1 | 2)[] = [];
    for (let k = 0; k < axes.length; k += 1) if (mask & (1 << k)) s.push(axes[k]);
    const rp: V3 = [src.position[0], src.position[1], src.position[2]]; for (const a of s) rp[a] = 2 * c - rp[a];
    const pName = byPos.get(key(rp));
    if (pName == null) continue;
    const np: V3 = [newPos[0], newPos[1], newPos[2]]; for (const a of s) np[a] = 2 * c - np[a];
    out = updateMount(out, pName, { position: np });
  }
  return out;
}

/** SYMMETRIZE (req_1190): force the part perfectly symmetric across plane `axis = c`
 *  by KEEPING one half and rebuilding the other as its exact mirror — kills the drift
 *  a one-sided edit leaves (a lone vertex/triangle out of place that the live mirror
 *  couldn't catch because it happened mirror-off). Cuts at the plane so no face
 *  straddles, discards the far half, then emits each kept face PLUS its reflected
 *  reverse-wound twin; seam verts merge by position so the halves stitch watertight.
 *  Kept-side joints are mirrored too. `keepPositive` keeps the +axis half. Pure. */
export function symmetrize(m: EditMesh, axis: 0 | 1 | 2, keepPositive: boolean, c = 0, eps = 1e-5): EditMesh {
  const cut = cutMeshByPlane(m, axis, c);
  const keepSign = keepPositive ? 1 : -1;
  const verts: V3[] = [];
  const byPos = new Map<string, number>();
  const key = (p: V3) => `${p[0].toFixed(5)},${p[1].toFixed(5)},${p[2].toFixed(5)}`;
  const intern = (p: V3): number => { const k = key(p); let i = byPos.get(k); if (i == null) { i = verts.length; verts.push([p[0], p[1], p[2]]); byPos.set(k, i); } return i; };
  const reflect = (p: V3): V3 => { const r: V3 = [p[0], p[1], p[2]]; r[axis] = 2 * c - r[axis]; return r; };
  const faces: EditMeshFace[] = [];
  for (const f of cut.faces) {
    if (f.loop.length < 3) continue;
    let cs = 0; for (const vi of f.loop) cs += cut.verts[vi][axis]; cs = cs / f.loop.length - c;
    if (cs * keepSign < -eps) continue; // drop the far half
    faces.push({ ...f, loop: f.loop.map((vi) => intern(cut.verts[vi])), uv: f.uv ? f.uv.map((u) => [u[0], u[1]] as V2) : undefined });
    if (Math.abs(cs) > eps) { // not a seam-coplanar face → also emit the reflected twin (winding reversed so it faces out)
      faces.push({ ...f, loop: f.loop.map((vi) => intern(reflect(cut.verts[vi]))).reverse(), uv: f.uv ? f.uv.map((u) => [u[0], u[1]] as V2).reverse() : undefined });
    }
  }
  // joints: keep the kept-side (+ seam) ones, mirror the off-seam ones (unique names).
  const keptMounts = (m.mounts ?? []).filter((mt) => (mt.position[axis] - c) * keepSign >= -eps);
  const taken = new Set(keptMounts.map((mt) => mt.name));
  const uniq = (base: string): string => { let f = base; for (let k = 2; taken.has(f); k += 1) f = `${base}_${k}`; taken.add(f); return f; };
  const mirroredMounts = keptMounts.filter((mt) => Math.abs(mt.position[axis] - c) > eps).map((mt) => { const r = mirrorMount(mt, [axis], c); return { ...r, name: uniq(r.name) }; });
  const mounts = [...keptMounts, ...mirroredMounts];
  return { ...m, verts, faces, mounts: mounts.length ? mounts : m.mounts };
}

/** SYMMETRY CHECK (req_1191/1192): is the part symmetric across plane `axis = c`?
 *  The plane is the ORIGIN (c=0) by default — the SAME plane mirror/symmetrize use,
 *  not the bbox centre (which drifts off the true plane the moment anything is
 *  asymmetric and then mis-flags EVERY pair). A vert matches if a vert exists within
 *  `eps` of its reflection (a tolerance grid, so float noise from edits doesn't
 *  false-flag). Returns the plane, how many verts have NO mirror twin (0 = symmetric;
 *  a single drifted vert reads as 2 — itself + its orphaned twin), and the total.
 *  NOTE: a car is symmetric LEFT↔RIGHT but not front↔back — check the right axis
 *  (the caller auto-picks the most-symmetric one). Pure. */
export function symmetryReport(m: EditMesh, axis: 0 | 1 | 2, c = 0, eps = 1e-3): { center: number; unmatched: number; total: number } {
  if (m.verts.length === 0) return { center: c, unmatched: 0, total: 0 };
  // tolerance grid: bucket verts by eps-cell; a reflection matches if ANY vert sits in
  // its cell or the 26 neighbours within eps (handles cell-straddling float noise).
  const g = (x: number) => Math.round(x / eps);
  const cells = new Map<string, V3[]>();
  for (const v of m.verts) { const k = `${g(v[0])},${g(v[1])},${g(v[2])}`; (cells.get(k) ?? (cells.set(k, []), cells.get(k)!)).push(v); }
  const near = (p: V3): boolean => {
    const gx = g(p[0]), gy = g(p[1]), gz = g(p[2]);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = cells.get(`${gx + dx},${gy + dy},${gz + dz}`);
      if (bucket) for (const v of bucket) if (Math.abs(v[0] - p[0]) <= eps && Math.abs(v[1] - p[1]) <= eps && Math.abs(v[2] - p[2]) <= eps) return true;
    }
    return false;
  };
  let unmatched = 0;
  for (const v of m.verts) {
    const r: V3 = [v[0], v[1], v[2]]; r[axis] = 2 * c - r[axis];
    if (!near(r)) unmatched += 1;
  }
  return { center: c, unmatched, total: m.verts.length };
}

/** An undirected edge as a sorted index pair (the dedupe key form). */
export type Edge = readonly [number, number];

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Every undirected edge of the mesh, once — the adjacency the edit ops + the
 *  edge-selection overlay ride. */
export function meshEdges(m: EditMesh): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];
  for (const face of m.faces) {
    const n = face.loop.length;
    for (let i = 0; i < n; i += 1) {
      const a = face.loop[i];
      const b = face.loop[(i + 1) % n];
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a < b ? [a, b] : [b, a]);
    }
  }
  return out;
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Newell's method — a robust face normal for any planar-ish n-gon (handles
 *  non-triangular loops where a single cross product would be fragile). */
export function faceNormal(m: EditMesh, face: EditMeshFace): V3 {
  let nx = 0, ny = 0, nz = 0;
  const loop = face.loop;
  for (let i = 0; i < loop.length; i += 1) {
    const cur = m.verts[loop[i]];
    const nxt = m.verts[loop[(i + 1) % loop.length]];
    nx += (cur[1] - nxt[1]) * (cur[2] + nxt[2]);
    ny += (cur[2] - nxt[2]) * (cur[0] + nxt[0]);
    nz += (cur[0] - nxt[0]) * (cur[1] + nxt[1]);
  }
  const len = Math.hypot(nx, ny, nz);
  return len < 1e-9 ? [0, 1, 0] : [nx / len, ny / len, nz / len];
}

/** Centroid of a face loop — where the face-mode selection dot + gizmo anchor. */
export function faceCentroid(m: EditMesh, face: EditMeshFace): V3 {
  let x = 0, y = 0, z = 0;
  for (const idx of face.loop) {
    const v = m.verts[idx];
    x += v[0]; y += v[1]; z += v[2];
  }
  const n = Math.max(1, face.loop.length);
  return [x / n, y / n, z / n];
}

// ── Lowering: EditMesh → GeometryData (the render bridge) ─────────────────────

/** Lower to the framework's non-indexed triangle soup: fan-triangulate each
 *  face, flat-shade by the Newell normal. Per-corner UVs ride through when the
 *  face carries stored `uv` (Part 5), so a textured display mode samples the
 *  real atlas; faces without UVs pin flat (0.5,0.5). */
export function editMeshToGeometry(m: EditMesh, includeFace?: (f: EditMeshFace) => boolean): GeometryData {
  const g = mesh();
  const flat: V2 = [0.5, 0.5];
  for (const face of m.faces) {
    if (includeFace && !includeFace(face)) continue;
    if (face.loop.length < 3) continue;
    const n = faceNormal(m, face) as Vec3;
    const uv = face.uv;
    const a = m.verts[face.loop[0]] as Vec3;
    const ua = (uv?.[0] ?? flat) as [number, number];
    for (let i = 1; i + 1 < face.loop.length; i += 1) {
      const b = m.verts[face.loop[i]] as Vec3;
      const c = m.verts[face.loop[i + 1]] as Vec3;
      g.tri(a, n, ua, b, n, (uv?.[i] ?? flat) as [number, number], c, n, (uv?.[i + 1] ?? flat) as [number, number]);
    }
  }
  return g.build();
}

// ── Shape constructors (the "Add Mesh" dialog's shapes) ───────────────────────
// Each mints an EditMesh CENTERED at the origin, sized to its dims — the user's
// "place it exact at 0,0 for its size". They are constructors, NOT a separate
// technique: voxel/heightfield/carve/import become more of these over time.

/** A cuboid: 8 verts, 6 quad faces, centered at origin. */
export function cuboid(width: number, height: number, depth: number): EditMesh {
  const x = width / 2, y = height / 2, z = depth / 2;
  const verts: V3[] = [
    [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], // 0..3 bottom
    [-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z],     // 4..7 top
  ];
  // CCW loops as seen from OUTSIDE (so the Newell normal points outward).
  const faces: EditMeshFace[] = [
    { loop: [4, 7, 6, 5] }, // +Y top
    { loop: [0, 1, 2, 3] }, // -Y bottom
    { loop: [0, 4, 5, 1] }, // -Z front
    { loop: [3, 2, 6, 7] }, // +Z back
    { loop: [0, 3, 7, 4] }, // -X left
    { loop: [1, 5, 6, 2] }, // +X right
  ];
  // DEFAULT UV mesh (req_1004): every face maps to the full square (Blockbench's
  // base cube). The box-net is the downstream "create texture" step, not this.
  return fullFaceUV({ verts, faces });
}

/** Blockbench's "sides" count for a round shape: a STRICT 3..48 (USER req_1056 —
 *  min 3, max 48), the single knob that turns a triangular prism into a smooth
 *  cylinder. One clamp so every round builder agrees (no magic numbers). */
export const SHAPE_SIDES_MIN = 3;
export const SHAPE_SIDES_MAX = 48;
export function clampSides(n: number): number {
  return Math.max(SHAPE_SIDES_MIN, Math.min(SHAPE_SIDES_MAX, Math.round(n)));
}

/** A cylinder: top + bottom rings, side quads, n-gon caps, centered at origin.
 *  `segments` = Blockbench's "sides" (clamped 3..48, req_1056). */
export function cylinder(radius: number, height: number, segments = 16): EditMesh {
  const seg = clampSides(segments);
  const y = height / 2;
  const verts: V3[] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    const cx = Math.cos(a) * radius, cz = Math.sin(a) * radius;
    verts.push([cx, -y, cz]); // bottom ring: even? no — interleave by index below
    verts.push([cx, y, cz]);
  }
  const bottom = (i: number) => (i % seg) * 2;
  const top = (i: number) => (i % seg) * 2 + 1;
  const faces: EditMeshFace[] = [];
  for (let i = 0; i < seg; i += 1) {
    // side quad wound for an OUTWARD radial normal (the ring runs CW seen from
    // +Y, so bottom→top→top+1→bottom+1 gives radial-out).
    faces.push({ loop: [bottom(i), top(i), top(i + 1), bottom(i + 1)] });
  }
  // caps: top loop reversed → +Y normal; bottom loop straight → -Y normal.
  const topLoop: number[] = [];
  const bottomLoop: number[] = [];
  for (let i = 0; i < seg; i += 1) {
    topLoop.push(top(seg - 1 - i));
    bottomLoop.push(bottom(i));
  }
  faces.push({ loop: topLoop });
  faces.push({ loop: bottomLoop });
  return fullFaceUV({ verts, faces });
}

/** A cone: an n-side base ring tapering to a single apex, centered at origin —
 *  the cylinder with its top ring collapsed to a point (`sides` 3..48, req_1056).
 *  A 4-side cone is a diamond-base pyramid; `pyramid()` is the axis-aligned one. */
export function cone(radius: number, height: number, segments = 16): EditMesh {
  const seg = clampSides(segments);
  const y = height / 2;
  const verts: V3[] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    verts.push([Math.cos(a) * radius, -y, Math.sin(a) * radius]); // base ring 0..seg-1
  }
  const apex = verts.length;
  verts.push([0, y, 0]);
  const faces: EditMeshFace[] = [];
  // side tris — the cylinder side quad with its top edge collapsed to the apex,
  // so the outward winding carries over.
  for (let i = 0; i < seg; i += 1) faces.push({ loop: [i, apex, (i + 1) % seg] });
  // base cap: the straight ring → -Y, exactly like the cylinder's bottom loop.
  const baseLoop: number[] = [];
  for (let i = 0; i < seg; i += 1) baseLoop.push(i);
  faces.push({ loop: baseLoop });
  return fullFaceUV({ verts, faces });
}

/** A pyramid: an axis-aligned square base tapering to an apex, centered at origin
 *  — the cuboid with its 4 top verts collapsed to one point (so every face's
 *  outward winding is inherited from `cuboid`). Blockbench's Pyramid. */
export function pyramid(width: number, height: number, depth: number): EditMesh {
  const x = width / 2, y = height / 2, z = depth / 2;
  const verts: V3[] = [
    [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], // 0..3 base
    [0, y, 0],                                          // 4 apex
  ];
  const faces: EditMeshFace[] = [
    { loop: [0, 1, 2, 3] }, // -Y base
    { loop: [0, 4, 1] },    // -Z front  (cuboid [0,4,5,1], 4&5 → apex)
    { loop: [3, 2, 4] },    // +Z back   (cuboid [3,2,6,7])
    { loop: [0, 3, 4] },    // -X left   (cuboid [0,3,7,4])
    { loop: [1, 4, 2] },    // +X right  (cuboid [1,5,6,2])
  ];
  return fullFaceUV({ verts, faces });
}

/** A plane: one flat quad on the ground (XZ), facing +Y, centered at origin —
 *  Blockbench's Plane. Single-sided (see [[scene3d_plane_culling]]). */
export function plane(width: number, depth: number): EditMesh {
  const x = width / 2, z = depth / 2;
  const verts: V3[] = [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]];
  return fullFaceUV({ verts, faces: [{ loop: [0, 3, 2, 1] }] }); // +Y (cuboid top winding)
}

/** Order a face loop so its Newell normal points AWAY from `center` (default the
 *  origin) — the outward orientation for a convex body about that point. Lets the
 *  round primitives + bevel emit faces without hand-winding each case. */
function orientOutward(verts: V3[], loop: number[], center: V3 = [0, 0, 0]): number[] {
  const n = faceNormal({ verts, faces: [] }, { loop });
  let cx = 0, cy = 0, cz = 0;
  for (const i of loop) { cx += verts[i][0]; cy += verts[i][1]; cz += verts[i][2]; }
  const k = loop.length || 1;
  const out: V3 = [cx / k - center[0], cy / k - center[1], cz / k - center[2]];
  return dot(n, out) >= 0 ? loop : loop.slice().reverse();
}

/** A UV sphere: `segments` longitude columns × derived latitude rings, capped by a
 *  single vert at each pole — Blockbench's Sphere. `segments` is the one "sides"
 *  knob (clamped 3..48, req_1056); latitude rings = half that (min 2) so the
 *  silhouette reads round without a second control. Centered at origin; every face
 *  wound outward. UV-sphere poles pinch (an icosphere distributes evenly). */
export function sphere(radius: number, segments = 16): EditMesh {
  const seg = clampSides(segments);
  const rings = Math.max(2, Math.round(seg / 2)); // latitude bands (pole→pole)
  const verts: V3[] = [];
  const top = verts.length; verts.push([0, radius, 0]);
  const bottom = verts.length; verts.push([0, -radius, 0]);
  const ring: number[][] = [];           // interior latitude rings, top→bottom
  for (let i = 1; i < rings; i += 1) {
    const phi = (Math.PI * i) / rings;    // 0 at the top pole … π at the bottom
    const y = Math.cos(phi) * radius;
    const rr = Math.sin(phi) * radius;
    const row: number[] = [];
    for (let j = 0; j < seg; j += 1) {
      const th = (j / seg) * Math.PI * 2;
      row.push(verts.length);
      verts.push([Math.cos(th) * rr, y, Math.sin(th) * rr]);
    }
    ring.push(row);
  }
  const faces: EditMeshFace[] = [];
  const out = (loop: number[]) => faces.push({ loop: orientOutward(verts, loop) });
  for (let j = 0; j < seg; j += 1) out([top, ring[0][j], ring[0][(j + 1) % seg]]); // top cap tris
  for (let i = 0; i + 1 < ring.length; i += 1) {                                    // middle quad bands
    const a = ring[i], b = ring[i + 1];
    for (let j = 0; j < seg; j += 1) out([a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]]);
  }
  const last = ring[ring.length - 1];
  for (let j = 0; j < seg; j += 1) out([bottom, last[(j + 1) % seg], last[j]]);      // bottom cap tris
  return fullFaceUV({ verts, faces });
}

/** Max icosphere subdivisions the Add dialog offers — 3 = 1280 tris, ample for the
 *  low-poly era; the clamp stops a fat input melting the editor. */
export const ICOSPHERE_SUBDIV_MAX = 3;

/** An icosphere: a 12-vert icosahedron with each triangle subdivided `subdiv` times
 *  and every vert pushed onto the sphere of `radius` — Blender/Blockbench's
 *  Icosphere. Triangles distribute evenly (no UV-sphere pole pinch). Centered at
 *  origin, faces wound outward. `subdiv` clamped 0..ICOSPHERE_SUBDIV_MAX. */
export function icosphere(radius: number, subdiv = 1): EditMesh {
  const n = Math.max(0, Math.min(ICOSPHERE_SUBDIV_MAX, Math.round(subdiv)));
  const t = (1 + Math.sqrt(5)) / 2;
  let pts: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  let tris: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < n; s += 1) {        // split each tri into 4, sharing edge midpoints
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const hit = mid.get(key); if (hit != null) return hit;
      const va = pts[a], vb = pts[b], i = pts.length;
      pts.push([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]);
      mid.set(key, i); return i;
    };
    const next: number[][] = [];
    for (const [a, b, c] of tris) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = next;
  }
  const verts: V3[] = pts.map((p) => {
    const len = Math.hypot(p[0], p[1], p[2]) || 1;
    return [(p[0] / len) * radius, (p[1] / len) * radius, (p[2] / len) * radius];
  });
  const faces: EditMeshFace[] = tris.map((loop) => ({ loop: orientOutward(verts, loop) }));
  return fullFaceUV({ verts, faces });
}

// ── The concave-quad Auto-Fix guard (USER req_0949 — a first-class idea) ───────
// After a gizmo move, before committing, the Studio checks whether any face went
// concave (a reflex corner — convex ⇒ every consecutive-edge cross product points
// the same way as the face normal). Offenders surface the Auto-Fix dialog:
// Split Quads (recommended) / Revert / Ignore. Both halves are pure + tested.

/** Is this face non-convex (has a reflex corner)? Tris are always convex. */
export function isFaceConcave(m: EditMesh, face: EditMeshFace): boolean {
  const loop = face.loop;
  if (loop.length < 4) return false;
  const normal = faceNormal(m, face);
  let sign = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const prev = m.verts[loop[(i + loop.length - 1) % loop.length]];
    const cur = m.verts[loop[i]];
    const next = m.verts[loop[(i + 1) % loop.length]];
    const turn = dot(cross(sub(cur, prev), sub(next, cur)), normal);
    if (Math.abs(turn) < 1e-9) continue; // collinear corner — ignore
    const s = turn > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return true; // a turn reversed → reflex corner → concave
  }
  return false;
}

/** The faces that went concave — the Auto-Fix guard's detection step. */
export function findConcaveFaces(m: EditMesh): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.faces.length; i += 1) {
    if (isFaceConcave(m, m.faces[i])) out.push(i);
  }
  return out;
}

/** Split one quad into two triangles along the diagonal that yields two convex
 *  tris (the "Split Quads" fix). Non-quads are returned untouched. Pure: returns
 *  a new mesh, leaves the input alone. */
export function splitQuad(m: EditMesh, faceIdx: number): EditMesh {
  const face = m.faces[faceIdx];
  if (!face || face.loop.length !== 4) return m;
  const [a, b, c, d] = face.loop;
  // Prefer the diagonal whose two tris are both wound consistently with the
  // quad's normal; default to a-c. Choosing the diagonal across the reflex
  // corner is what removes the concavity.
  const normal = faceNormal(m, face);
  const triOk = (i: number, j: number, k: number): boolean => {
    const t = cross(sub(m.verts[j], m.verts[i]), sub(m.verts[k], m.verts[i]));
    return dot(t, normal) > 0;
  };
  const acGood = triOk(a, b, c) && triOk(a, c, d);
  const [t1, t2]: [number[], number[]] = acGood
    ? [[a, b, c], [a, c, d]]
    : [[b, c, d], [b, d, a]];
  // carry per-corner UVs onto each tri (the split uses original corners, so each
  // output corner's UV is its parent corner's UV — no interpolation needed).
  const uvAt = face.uv ? (vi: number) => face.uv![face.loop.indexOf(vi)] : null;
  const uvFor = (tri: number[]): V2[] | undefined => (uvAt ? tri.map(uvAt) : undefined);
  const faces = m.faces.slice();
  faces.splice(faceIdx, 1, { ...face, loop: t1, uv: uvFor(t1) }, { ...face, loop: t2, uv: uvFor(t2) });
  return { verts: m.verts, faces };
}

/** Apply "Split Quads" to every offender at once (the recommended Auto-Fix). */
export function splitConcaveFaces(m: EditMesh): EditMesh {
  let out = m;
  // Walk high→low so earlier splices don't shift the indices we still owe.
  for (const idx of findConcaveFaces(m).sort((p, q) => q - p)) {
    out = splitQuad(out, idx);
  }
  return out;
}

// ── UV unwrap: the atlas FORMED FROM the live mesh (req_0981) ──────────────────
// The read-only foundation of texturing each part: a box-projection unwrap that
// is RECOMPUTED from the EditMesh as it's edited, so the UV view tracks the
// geometry. Each face is projected onto the plane perpendicular to its DOMINANT
// normal axis (the simplest, predictable unwrap — a cube becomes 6 clean rects);
// the 2D footprint is measured in MODELING UNITS on the 16-units-per-tile basis
// (req_0973: a face N units wide → N texels), then packed into one atlas by a
// deterministic shelf packer. Pure + headless (the editMesh.ts idiom) so it is
// proven in editMesh.test.ts and the UV-edit ops can build on the same shape.

/** One face's place in the atlas — its projection axis, its packed bounding rect
 *  (in units), and the projected polygon (in atlas units, rect-offset applied)
 *  so the view draws the ACTUAL face shape, not just its box. */
export type UVFace = {
  faceIndex: number;
  /** the dominant normal axis the face projects along. */
  axis: 'x' | 'y' | 'z';
  /** sign of the dominant normal component (which side the face looks). */
  sign: 1 | -1;
  /** packed bounding rect in atlas units. */
  rect: { x: number; y: number; w: number; h: number };
  /** projected corner loop in atlas units (same order as face.loop). */
  poly: V2[];
};

export type UVLayout = {
  /** atlas extent in units (texels on the 16-units basis). */
  width: number;
  height: number;
  faces: UVFace[];
};

/** Project a vert to 2D for a given dominant axis — drop the dominant coord, keep
 *  the other two in a fixed (u,v) order so faces of the same axis align. */
function projectVert(v: V3, axis: 'x' | 'y' | 'z'): V2 {
  if (axis === 'x') return [v[2], v[1]]; // looking down ±X → (z, y)
  if (axis === 'y') return [v[0], v[2]]; // looking down ±Y → (x, z)
  return [v[0], v[1]];                   // looking down ±Z → (x, y)
}

/** Box-projection unwrap of the live mesh into one atlas. `unitsPerMeter` is the
 *  texel basis (STUDIO.unitsPerTile / STUDIO.tileMeters = 16/1); `pad` is the
 *  gutter between packed faces, in units. Deterministic (shelf packing on a
 *  near-square row width) so the layout is stable across re-renders + testable. */
export function unwrapMesh(m: EditMesh, unitsPerMeter: number, pad = 1): UVLayout {
  // 1. project + measure each face in units, normalized to its own origin.
  type Raw = { faceIndex: number; axis: 'x' | 'y' | 'z'; sign: 1 | -1; w: number; h: number; local: V2[] };
  const raws: Raw[] = [];
  for (let fi = 0; fi < m.faces.length; fi += 1) {
    const face = m.faces[fi];
    if (face.loop.length < 3) continue;
    const n = faceNormal(m, face);
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const axis: 'x' | 'y' | 'z' = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
    const sign: 1 | -1 = (axis === 'x' ? n[0] : axis === 'y' ? n[1] : n[2]) < 0 ? -1 : 1;
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    const pts2: V2[] = face.loop.map((idx) => {
      const [u, v] = projectVert(m.verts[idx], axis);
      const pu = u * unitsPerMeter, pv = v * unitsPerMeter;
      if (pu < minU) minU = pu; if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
      return [pu, pv] as V2;
    });
    const local = pts2.map(([u, v]) => [u - minU, v - minV] as V2);
    raws.push({ faceIndex: fi, axis, sign, w: maxU - minU, h: maxV - minV, local });
  }

  // 2. shelf-pack: tallest first into rows whose width targets a near-square
  //    atlas. Deterministic — same mesh → same layout every recompute.
  const totalArea = raws.reduce((s, r) => s + (r.w + pad) * (r.h + pad), 0);
  const widest = raws.reduce((s, r) => Math.max(s, r.w + pad), 0);
  const rowWidth = Math.max(widest, Math.ceil(Math.sqrt(totalArea)));
  const order = raws.slice().sort((a, b) => b.h - a.h || b.w - a.w || a.faceIndex - b.faceIndex);

  let cx = 0, cy = 0, rowH = 0, atlasW = 0;
  const faces: UVFace[] = [];
  for (const r of order) {
    if (cx > 0 && cx + r.w + pad > rowWidth) { cx = 0; cy += rowH + pad; rowH = 0; } // wrap
    const x = cx, y = cy;
    faces.push({
      faceIndex: r.faceIndex,
      axis: r.axis,
      sign: r.sign,
      rect: { x, y, w: r.w, h: r.h },
      poly: r.local.map(([u, v]) => [u + x, v + y] as V2),
    });
    cx += r.w + pad;
    if (r.h > rowH) rowH = r.h;
    if (cx > atlasW) atlasW = cx;
  }
  // keep the source face order in the returned list (stable for the view's keys).
  faces.sort((a, b) => a.faceIndex - b.faceIndex);
  return { width: Math.max(0, atlasW - pad), height: cy + rowH, faces };
}

/** The DEFAULT UV mesh (USER req_1004): every face maps to the FULL unit square —
 *  exactly Blockbench's base cube, where clicking ANY face shows the whole 16×16
 *  outline because every face samples the entire texture. This is the UV MESH (the
 *  mapping), NOT the texture: laying the faces into separate atlas regions (the box
 *  net) is the downstream "create texture" step (`unwrap`, Phase 5c), which also
 *  remaps these UVs. Each face's own 2D projection is normalized to fill [0,1]², so
 *  a quad fills the square exactly and an n-gon (a cylinder cap) inscribes it. */
/** One face's default full-square UV: project its loop onto the dominant normal
 *  axis and normalize that projection to fill [0,1]². The per-face core of
 *  `fullFaceUV`, reused whenever a brand-new face is minted (e.g. an extrude's
 *  side walls) so the default mapping is computed in ONE place (rule of two). */
export function faceSquareUV(verts: V3[], loop: number[]): V2[] {
  const n = faceNormal({ verts, faces: [] }, { loop });
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const axis: 'x' | 'y' | 'z' = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
  const pts = loop.map((i) => projectVert(verts[i], axis));
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const [u, v] of pts) { if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  const du = maxU - minU || 1, dv = maxV - minV || 1;
  return pts.map(([u, v]) => [(u - minU) / du, (v - minV) / dv] as V2);
}

export function fullFaceUV(m: EditMesh): EditMesh {
  return {
    ...m,
    faces: m.faces.map((face) => (face.loop.length < 3 ? face : { ...face, uv: faceSquareUV(m.verts, face.loop) })),
  };
}

// The Blockbench BOX-NET layout: when the 6 faces form a complete box (one per
// axis-sign), unfold them into the contiguous Minecraft cross instead of shelf-
// packing 6 separate squares. Net is 2·(d+w) wide × (d+h) tall (w=X, h=Y, d=Z):
//
//      .  up   down .          (top strip, height d)
//      right front left back   (side strip, height h)
//
// Returns per-face net offsets + the net extent, or null when it isn't a box (an
// edited mesh falls back to shelf packing). Reuses unwrapMesh's per-face rects:
// each face's rect.w/.h already equals its projected size, so an offset is all we
// add. `local[i] = poly[i] − rect.{x,y}` recovers the un-packed face quad.
function boxNetOffsets(faces: UVFace[]): { offsets: Map<number, V2>; width: number; height: number } | null {
  if (faces.length !== 6) return null;
  const byKey = new Map<string, UVFace>();
  for (const f of faces) byKey.set(`${f.axis}${f.sign > 0 ? '+' : '-'}`, f);
  if (byKey.size !== 6) return null; // not one face per axis-sign → not a clean box
  const yf = byKey.get('y+')!; // up: projected (x,z) → w=dx, h=dz
  const xf = byKey.get('x+')!; // right: projected (z,y) → w=dz, h=dy
  const dx = yf.rect.w, dz = yf.rect.h, dy = xf.rect.h;
  const place: Record<string, V2> = {
    'y+': [dz, 0],            // up
    'y-': [dz + dx, 0],       // down
    'x+': [0, dz],            // right
    'z-': [dz, dz],           // front
    'x-': [dz + dx, dz],      // left
    'z+': [dz + dx + dz, dz], // back
  };
  const offsets = new Map<number, V2>();
  for (const [key, f] of byKey) offsets.set(f.faceIndex, place[key]);
  return { offsets, width: 2 * (dz + dx), height: dz + dy };
}

/** The "Unwrap" ACTION (Part 5): box-project + pack the live mesh ONCE and WRITE
 *  the result into each face's `uv` as normalized [0,1] coords in a square atlas.
 *  A clean box unfolds into the Blockbench contiguous box net; anything else
 *  shelf-packs. After this the UV is stored data — `unwrapMesh` (live projection)
 *  is only re-run on an explicit unwrap, never per render. `cuboid()`/`cylinder()`
 *  call this at mint. `unitsPerMeter` cancels out in the normalization. */
export function unwrap(m: EditMesh, unitsPerMeter = 1): EditMesh {
  const layout = unwrapMesh(m, unitsPerMeter);
  const net = boxNetOffsets(layout.faces);
  // Place each face: box-net offset when it's a box, else the shelf rect.
  const placed = layout.faces.map((f) => {
    if (!net) return { faceIndex: f.faceIndex, poly: f.poly };
    const off = net.offsets.get(f.faceIndex)!;
    const local = f.poly.map(([u, v]) => [u - f.rect.x, v - f.rect.y] as V2);
    return { faceIndex: f.faceIndex, poly: local.map(([u, v]) => [u + off[0], v + off[1]] as V2) };
  });
  const norm = Math.max(net ? net.width : layout.width, net ? net.height : layout.height, 1e-9);
  const uvByFace = new Map<number, V2[]>();
  for (const f of placed) uvByFace.set(f.faceIndex, f.poly.map(([u, v]) => [u / norm, v / norm] as V2));
  return { ...m, faces: m.faces.map((face, i) => { const uv = uvByFace.get(i); return uv ? { ...face, uv } : face; }) };
}

/** Build the panel layout FROM the stored per-corner UVs (NOT from geometry) —
 *  so the atlas is stable under vertex/edge moves and only restructures when a
 *  topology edit rewrote `uv`. Scales the normalized UVs to `texSize` texels (the
 *  fixed square texture). The tint axis is read from the live normal — cosmetic
 *  only, it does not move the island. Faces without stored UVs are skipped. */
export function storedUVLayout(m: EditMesh, texSize = 16): UVLayout {
  const faces: UVFace[] = [];
  for (let fi = 0; fi < m.faces.length; fi += 1) {
    const face = m.faces[fi];
    if (!face.uv || face.uv.length < 3 || face.loop.length < 3) continue;
    const poly = face.uv.map(([u, v]) => [u * texSize, v * texSize] as V2);
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const [u, v] of poly) { if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v; }
    const n = faceNormal(m, face);
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const axis: 'x' | 'y' | 'z' = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
    const sign: 1 | -1 = (axis === 'x' ? n[0] : axis === 'y' ? n[1] : n[2]) < 0 ? -1 : 1;
    faces.push({ faceIndex: fi, axis, sign, rect: { x: minU, y: minV, w: maxU - minU, h: maxV - minV }, poly });
  }
  return { width: texSize, height: texSize, faces };
}

// ── Vertex transforms (the move / resize gizmo ops — req_0983) ─────────────────
// The pure mutations the transform gizmo drives: translate a vert subset along an
// axis (MOVE), or scale it about an anchor per-axis (RESIZE). Pure (new mesh, the
// input untouched) + headless so editMesh.test.ts proves them; the gizmo overlay
// just calls these on drag and re-lowers. Faces/mounts ride along unchanged — the
// topology is the same, only positions move.

function asSet(indices: Iterable<number>): Set<number> {
  return indices instanceof Set ? (indices as Set<number>) : new Set(indices);
}

/** Centroid of a vert subset — the gizmo anchor ("best center" of a multi-select,
 *  the vertex itself / the edge midpoint / the face center for a single pick). */
export function vertsCentroid(m: EditMesh, indices: Iterable<number>): V3 {
  let x = 0, y = 0, z = 0, n = 0;
  for (const i of indices) { const v = m.verts[i]; if (!v) continue; x += v[0]; y += v[1]; z += v[2]; n += 1; }
  return n === 0 ? [0, 0, 0] : [x / n, y / n, z / n];
}

/** Axis-aligned bounds of a vert subset: min/max corner + per-axis SIZE — the
 *  selection's measured dimensions (the size readout, req_1185). Empty → zero box. */
export function vertsBounds(m: EditMesh, indices: Iterable<number>): { min: V3; max: V3; size: V3 } {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity, n = 0;
  for (const i of indices) {
    const v = m.verts[i]; if (!v) continue; n += 1;
    if (v[0] < mnx) mnx = v[0]; if (v[1] < mny) mny = v[1]; if (v[2] < mnz) mnz = v[2];
    if (v[0] > mxx) mxx = v[0]; if (v[1] > mxy) mxy = v[1]; if (v[2] > mxz) mxz = v[2];
  }
  if (n === 0) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return { min: [mnx, mny, mnz], max: [mxx, mxy, mxz], size: [mxx - mnx, mxy - mny, mxz - mnz] };
}

/** Fit a CIRCLE to a ring of points (a wheel-well arch) → the centre + radius: the
 *  exact axle position for a tire to sit in the well, and how big to make it
 *  (req_1202). The selected verts lie ~in a plane (a car's side panel); the flat
 *  axis (least spread) is the well's normal, the other two are the fit plane.
 *  Algebraic (Kåsa) least-squares fit, mean-centred for conditioning. ≥3 distinct
 *  points required; returns null if they're collinear/degenerate. Pure. */
export function fitWheelCenter(pts: V3[]): { center: V3; radius: number; axis: 0 | 1 | 2 } | null {
  const n = pts.length;
  if (n < 3) return null;
  const mean: V3 = [0, 0, 0];
  for (const p of pts) { mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2]; }
  mean[0] /= n; mean[1] /= n; mean[2] /= n;
  const varr = [0, 0, 0];
  for (const p of pts) for (let a = 0; a < 3; a += 1) varr[a] += (p[a] - mean[a]) ** 2;
  const flat: 0 | 1 | 2 = (varr[0] <= varr[1] && varr[0] <= varr[2]) ? 0 : (varr[1] <= varr[2] ? 1 : 2);
  const u = ((flat + 1) % 3) as 0 | 1 | 2, v = ((flat + 2) % 3) as 0 | 1 | 2; // the two in-plane axes
  // Kåsa: minimize Σ(x²+y²+Dx+Ey+F)² for the centred (x,y); normal equations on (uc,vc).
  let Suu = 0, Svv = 0, Suv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const p of pts) {
    const x = p[u] - mean[u], y = p[v] - mean[v];
    Suu += x * x; Svv += y * y; Suv += x * y;
    Suuu += x * x * x; Svvv += y * y * y; Suvv += x * y * y; Svuu += y * x * x;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-12) return null; // collinear → no circle
  const bx = 0.5 * (Suuu + Suvv), by = 0.5 * (Svvv + Svuu);
  const uc = (bx * Svv - by * Suv) / det;
  const vc = (Suu * by - Suv * bx) / det;
  const radius = Math.sqrt(Math.max(0, uc * uc + vc * vc + (Suu + Svv) / n));
  const center: V3 = [0, 0, 0];
  center[u] = mean[u] + uc; center[v] = mean[v] + vc; center[flat] = mean[flat];
  return { center, radius, axis: flat };
}

/** A WHEEL/tire: a cylinder whose AXLE runs along `axle` (so its round disc faces
 *  the side), `radius` × `width`, centred at origin (req_1206). Built by reorienting
 *  `cylinder()` (axle = Y); a coordinate swap flips winding, so the loops are
 *  reversed to keep normals outward. Pair with `fitWheelCenter` to size it to a well. */
export function wheelMesh(radius: number, width: number, sides: number, axle: 0 | 1 | 2): EditMesh {
  const cyl = cylinder(radius, width, sides); // axle along Y
  if (axle === 1) return cyl;
  const map: (v: V3) => V3 = axle === 2 ? (v) => [v[0], v[2], v[1]] : (v) => [v[1], v[0], v[2]]; // Y→Z or Y→X
  return {
    ...cyl,
    verts: cyl.verts.map(map),
    faces: cyl.faces.map((f) => ({ ...f, loop: f.loop.slice().reverse(), uv: f.uv ? f.uv.slice().reverse() : undefined })),
  };
}

/** Merge mesh `b` (offset by `delta`) into `a` — appends verts (reindexed) + faces,
 *  so a generated wheel lands at the well centre inside the body mesh (req_1206). The
 *  body then re-seats on its lowest point (the tire bottoms) for free. Pure. */
export function mergeMesh(a: EditMesh, b: EditMesh, delta: V3): EditMesh {
  const base = a.verts.length;
  const verts = [...a.verts.map((v) => [v[0], v[1], v[2]] as V3), ...b.verts.map((v) => [v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]] as V3)];
  const faces = [...a.faces, ...b.faces.map((f) => ({ ...f, loop: f.loop.map((i) => i + base) }))];
  return { ...a, verts, faces };
}

/** Half-extent of a vert subset from `anchor` along world axis 0|1|2 — the resize
 *  reference (how far the farthest selected vert sits from the center on that axis). */
export function vertsHalfExtent(m: EditMesh, indices: Iterable<number>, anchor: V3, axis: 0 | 1 | 2): number {
  let h = 0;
  for (const i of indices) { const v = m.verts[i]; if (!v) continue; const d = Math.abs(v[axis] - anchor[axis]); if (d > h) h = d; }
  return h;
}

/** Translate a vert subset by a world delta (the MOVE tool). */
export function translateVerts(m: EditMesh, indices: Iterable<number>, delta: V3): EditMesh {
  const set = asSet(indices);
  const verts = m.verts.map((v, i) => (set.has(i) ? [v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]] as V3 : v));
  return { ...m, verts };
}

/** Rotate a vert subset about `anchor` around world axis 0|1|2 by `angle` radians
 *  (the ROTATE tool, req_1057) — used to spin a part to the correct orientation
 *  (select-all then rotate = whole-object reorient). Right-handed about the +axis.
 *  Faces/mounts/UV ride along (topology + mapping unchanged; only positions move). */
export function rotateVerts(m: EditMesh, indices: Iterable<number>, anchor: V3, axis: 0 | 1 | 2, angle: number): EditMesh {
  const set = asSet(indices);
  const c = Math.cos(angle), s = Math.sin(angle);
  const verts = m.verts.map((v, i) => {
    if (!set.has(i)) return v;
    const dx = v[0] - anchor[0], dy = v[1] - anchor[1], dz = v[2] - anchor[2];
    if (axis === 0) return [v[0], anchor[1] + dy * c - dz * s, anchor[2] + dy * s + dz * c] as V3; // about X: (y,z)
    if (axis === 1) return [anchor[0] + dx * c - dz * s, v[1], anchor[2] + dx * s + dz * c] as V3; // about Y: (x,z)
    return [anchor[0] + dx * c - dy * s, anchor[1] + dx * s + dy * c, v[2]] as V3;                 // about Z: (x,y)
  });
  return { ...m, verts };
}

/** Scale a vert subset about `anchor` by per-axis factors (the RESIZE tool). */
export function scaleVerts(m: EditMesh, indices: Iterable<number>, anchor: V3, factor: V3): EditMesh {
  const set = asSet(indices);
  const verts = m.verts.map((v, i) => (set.has(i)
    ? [
        anchor[0] + (v[0] - anchor[0]) * factor[0],
        anchor[1] + (v[1] - anchor[1]) * factor[1],
        anchor[2] + (v[2] - anchor[2]) * factor[2],
      ] as V3
    : v));
  return { ...m, verts };
}

// ── Loop cut: slice the mesh with axis-aligned planes (req_0984/0985) ──────────
// The Blockbench loop-cut tool: a face click + a direction (one of the face's two
// in-plane axes) + a cut count + an offset → N parallel planes perpendicular to
// that axis, looping around the whole box. Built on a general planar split so it
// keeps working after earlier cuts (the mesh is no longer a bare cuboid). Pure +
// headless so editMesh.test.ts proves the topology + the spacing math.

const POS_KEY_DP = 5; // vertex-merge precision (decimal places) for the cut verts.

/** Split every face the plane (constant `axis` coordinate `c`) crosses into its
 *  −side and +side pieces, inserting shared intersection verts on crossed edges.
 *  Faces that don't straddle the plane pass through untouched. Pure. */
export function cutMeshByPlane(m: EditMesh, axis: 0 | 1 | 2, c: number, eps = 1e-6): EditMesh {
  const verts: V3[] = m.verts.map((v) => [v[0], v[1], v[2]]);
  const keyOf = (p: V3) => `${p[0].toFixed(POS_KEY_DP)},${p[1].toFixed(POS_KEY_DP)},${p[2].toFixed(POS_KEY_DP)}`;
  const vmap = new Map<string, number>();
  verts.forEach((v, i) => vmap.set(keyOf(v), i));
  const internVert = (p: V3): number => {
    const k = keyOf(p);
    let i = vmap.get(k);
    if (i == null) { i = verts.length; verts.push(p); vmap.set(k, i); }
    return i;
  };

  const faces: EditMeshFace[] = [];
  for (const face of m.faces) {
    const loop = face.loop;
    const side = loop.map((vi) => { const d = verts[vi][axis] - c; return d < -eps ? -1 : d > eps ? 1 : 0; });
    if (!(side.some((s) => s < 0) && side.some((s) => s > 0))) { faces.push(face); continue; } // not straddling
    const negLoop: number[] = [];
    const posLoop: number[] = [];
    // Per-corner UVs ride the split: an original corner keeps its UV; a new
    // intersection vert gets the UV interpolated along the edge it cut, by the
    // same parameter `t` as its position. This is what makes a cut subdivide
    // WITHIN the parent island (and, because cut verts are shared, drops the
    // boundary notch onto neighbor faces for free — Part 5).
    const uv = face.uv;
    const negUV: V2[] | null = uv ? [] : null;
    const posUV: V2[] | null = uv ? [] : null;
    const lerpUV = (i: number, j: number, t: number): V2 => [uv![i][0] + (uv![j][0] - uv![i][0]) * t, uv![i][1] + (uv![j][1] - uv![i][1]) * t];
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const sa = side[i], sb = side[(i + 1) % loop.length];
      if (sa <= 0) { negLoop.push(a); negUV?.push(uv![i]); }
      if (sa >= 0) { posLoop.push(a); posUV?.push(uv![i]); }
      if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
        const va = verts[a], vb = verts[b];
        const t = (c - va[axis]) / (vb[axis] - va[axis]);
        const p: V3 = [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t];
        p[axis] = c; // pin exactly on the plane
        const xi = internVert(p);
        negLoop.push(xi); posLoop.push(xi);
        if (uv) { const cuv = lerpUV(i, (i + 1) % loop.length, t); negUV!.push(cuv); posUV!.push(cuv); }
      }
    }
    if (negLoop.length >= 3) faces.push({ loop: negLoop, uv: negUV ?? undefined, material: face.material, tag: face.tag });
    if (posLoop.length >= 3) faces.push({ loop: posLoop, uv: posUV ?? undefined, material: face.material, tag: face.tag });
  }
  return { ...m, verts, faces };
}

/** The cut-plane coordinates (on `axis`, in the span [lo,hi]) for a loop cut of
 *  `cuts` planes at `offset`. Both `offset` and the returned coords are in the
 *  SAME units as lo/hi. At the default offset (size/2) the planes divide the span
 *  into `cuts`+1 EQUAL slabs; raising the offset translates the whole comb toward
 *  +axis, which shrinks the −side (selected-face) end slab while every interior
 *  slab stays equal (the Blockbench "short end of the stick"). */
export function loopCutPositions(lo: number, hi: number, cuts: number, offset: number): number[] {
  const n = Math.max(1, Math.round(cuts));
  const size = hi - lo;
  const even = size / (n + 1);
  const shift = -(offset - size / 2); // higher offset → −side slab shrinks
  const out: number[] = [];
  for (let k = 1; k <= n; k += 1) {
    const p = lo + k * even + shift;
    if (p > lo + 1e-5 && p < hi - 1e-5) out.push(p);
  }
  return out;
}

/** Apply a loop cut WITHIN an explicit [lo,hi] span on `axis` — the span is the
 *  SELECTED FACE's extent, so a second cut on an already-cut half subdivides THAT
 *  half (offset is local to it), instead of re-cutting the whole mesh at a plane
 *  that may coincide with an earlier cut (req_1006: "I don't see the new cut").
 *  Planes outside the span are skipped by loopCutPositions. */
export function loopCutRange(m: EditMesh, axis: 0 | 1 | 2, lo: number, hi: number, cuts: number, offset: number): EditMesh {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-6) return m;
  let out = m;
  for (const c of loopCutPositions(lo, hi, cuts, offset)) out = cutMeshByPlane(out, axis, c);
  return out;
}

/** Apply a full loop cut across the WHOLE mesh extent (the bare-cuboid case). */
export function loopCut(m: EditMesh, axis: 0 | 1 | 2, cuts: number, offset: number): EditMesh {
  let lo = Infinity, hi = -Infinity;
  for (const v of m.verts) { if (v[axis] < lo) lo = v[axis]; if (v[axis] > hi) hi = v[axis]; }
  return loopCutRange(m, axis, lo, hi, cuts, offset);
}

// ── Extrude: lift a face out (or in) and wall the gap (req_1015) ────────────────
// The Blockbench face-extrude: copy the selected face's boundary, push the copy
// out along the face normal by `distance`, CAP it with the moved face, and BRIDGE
// the original boundary to the cap with side-wall quads. Two truths the user
// drilled with side-by-sides: (1) the EXTRUDE OP changes the UV — the cap inherits
// the face's UV (so the end keeps its texture) and the new side walls get the
// default full-square UV; (2) once extruded, the cap is just a face — dragging it
// with the move gizmo (translateVerts) pulls it in/out and NEVER touches a UV. So
// extrude is a pure topology op; the shaping is the existing gizmo move. The cap
// REPLACES the original face at the SAME index, so a selection on it follows the
// extrusion (the face stays selected). A negative distance extrudes inward (inset).

export function extrudeFace(m: EditMesh, faceIndex: number, distance: number): EditMesh {
  const face = m.faces[faceIndex];
  if (!face || face.loop.length < 3) return m;
  const L = face.loop.length;
  const nrm = faceNormal(m, face);
  const off: V3 = [nrm[0] * distance, nrm[1] * distance, nrm[2] * distance];
  const verts: V3[] = m.verts.map((v) => [v[0], v[1], v[2]]);
  // a fresh boundary copy, offset along the normal — the cap's verts.
  const cap = face.loop.map((vi) => { const v = verts[vi]; const i = verts.length; verts.push([v[0] + off[0], v[1] + off[1], v[2] + off[2]]); return i; });
  const fc = faceCentroid(m, face);
  const faces: EditMeshFace[] = m.faces.slice();
  // CAP replaces the original at faceIndex → a selection on it follows; UV inherited.
  faces[faceIndex] = { loop: cap.slice(), uv: face.uv ? face.uv.map((p) => [p[0], p[1]] as V2) : undefined, material: face.material, tag: face.tag };
  // SIDE WALLS: one quad per boundary edge, wound so its Newell normal points OUT
  // (away from the face centroid), each with the default full-square UV.
  for (let i = 0; i < L; i += 1) {
    const a = face.loop[i], b = face.loop[(i + 1) % L], a2 = cap[i], b2 = cap[(i + 1) % L];
    let loop = [a, b, b2, a2];
    const wn = faceNormal({ verts, faces: [] }, { loop });
    const qc: V3 = [
      (verts[a][0] + verts[b][0] + verts[a2][0] + verts[b2][0]) / 4,
      (verts[a][1] + verts[b][1] + verts[a2][1] + verts[b2][1]) / 4,
      (verts[a][2] + verts[b][2] + verts[a2][2] + verts[b2][2]) / 4,
    ];
    if (dot(wn, sub(qc, fc)) < 0) loop = [a2, b2, b, a]; // flip to face outward
    faces.push({ loop, uv: faceSquareUV(verts, loop), material: face.material });
  }
  return { ...m, verts, faces };
}

// ── Solidify / detach a face selection into a THIN PANEL (req_1218) ─────────────
// The user's hood/door/trunk recipe, verbatim: "take the edges, extrude them
// inward and then a face between them all, so that it's a thin model — no need
// to go more than that." A selected face-group on the body shell becomes its own
// solid panel: the selection stays as the OUTER skin, its silhouette edges drop
// inward by `thickness` to form the rim walls, and a reversed copy caps the
// INSIDE. The result is a watertight thin slab that can pop off / hinge open as
// its own part. No fixed car-part list — any face-group you peel is a part.

/** Strip a loop of repeated corners — consecutive duplicates AND the wrap-around
 *  (last === first) — keeping the per-corner uv in lockstep. Malformed source faces
 *  carry these (a loop-cut / create-face can leave a `…,v,v` zero-length edge); left
 *  in, they fan-triangulate to junk zero-area tris and, worse, count as silhouette
 *  edges that spawn degenerate rim walls in `solidifyFaces`. Pure. */
function cleanLoop(loop: number[], uv?: V2[]): { loop: number[]; uv?: V2[] } {
  const L: number[] = [];
  const U: V2[] = [];
  for (let i = 0; i < loop.length; i += 1) {
    if (L.length && L[L.length - 1] === loop[i]) continue; // consecutive dup
    L.push(loop[i]);
    if (uv && uv[i]) U.push([uv[i][0], uv[i][1]]);
  }
  while (L.length > 1 && L[L.length - 1] === L[0]) { L.pop(); if (uv) U.pop(); } // wrap dup
  return { loop: L, uv: uv ? U : undefined };
}

/** Extract the given faces into a standalone EditMesh: their verts, compacted +
 *  reindexed, with per-face uv / material / glass carried over (loops sanitized of
 *  repeated corners, fully-degenerate faces dropped). Mounts and pivot are dropped
 *  — a detached panel starts its own rig. Pure + headless. */
export function subMeshFromFaces(m: EditMesh, faceIndices: Iterable<number>): EditMesh {
  const sel = [...new Set(faceIndices)].filter((i) => m.faces[i] && m.faces[i].loop.length >= 3);
  const remap = new Map<number, number>();
  const verts: V3[] = [];
  for (const fi of sel) for (const vi of m.faces[fi].loop) {
    if (!remap.has(vi)) { remap.set(vi, verts.length); const v = m.verts[vi]; verts.push([v[0], v[1], v[2]]); }
  }
  const faces: EditMeshFace[] = [];
  for (const fi of sel) {
    const f = m.faces[fi];
    const c = cleanLoop(f.loop.map((vi) => remap.get(vi)!), f.uv ? f.uv.map((p) => [p[0], p[1]] as V2) : undefined);
    if (c.loop.length < 3) continue; // a doubled-corner sliver → nothing real to keep
    faces.push({ loop: c.loop, uv: c.uv, material: f.material, glass: f.glass });
  }
  return { verts, faces };
}

/** Thicken a face selection into a closed solid: keep the selected faces as the
 *  OUTER skin, push each of their verts inward (−averaged incident-face normal) by
 *  `thickness` to make the INNER skin (a reversed copy of every selected face), and
 *  bridge each SILHOUETTE edge (a boundary edge used by exactly one selected face)
 *  outer→inner with a rim-wall quad. Interior shared edges get no wall (they're
 *  internal to the slab). Glass carries onto the inner cap so a window stays a
 *  window from both sides; walls are opaque. Pure + headless. */
export function solidifyFaces(m: EditMesh, faceIndices: Iterable<number>, thickness: number): EditMesh {
  const sel = [...new Set(faceIndices)].filter((i) => m.faces[i] && m.faces[i].loop.length >= 3);
  if (sel.length === 0 || thickness <= 0) return m;

  // per-vert inward direction = −normalize(Σ incident selected-face normals), so a
  // curved panel's inner skin stays roughly parallel (constant thickness).
  const acc = new Map<number, V3>();
  for (const fi of sel) {
    const n = faceNormal(m, m.faces[fi]);
    for (const vi of m.faces[fi].loop) {
      const a = acc.get(vi) ?? [0, 0, 0] as V3;
      a[0] += n[0]; a[1] += n[1]; a[2] += n[2];
      acc.set(vi, a);
    }
  }
  const verts: V3[] = m.verts.map((v) => [v[0], v[1], v[2]]);
  const inner = new Map<number, number>(); // body vert → its inner-skin dup index
  for (const [vi, a] of acc) {
    const len = Math.hypot(a[0], a[1], a[2]) || 1;
    const v = verts[vi];
    inner.set(vi, verts.length);
    verts.push([v[0] - (a[0] / len) * thickness, v[1] - (a[1] / len) * thickness, v[2] - (a[2] / len) * thickness]);
  }

  const faces: EditMeshFace[] = m.faces.slice();
  // INNER skin: a reversed copy of each selected face (winds the other way → faces in).
  // cleanLoop guards a malformed source face (doubled corner) used standalone.
  for (const fi of sel) {
    const f = m.faces[fi];
    const loop = cleanLoop(f.loop.map((vi) => inner.get(vi)!)).loop.reverse();
    if (loop.length < 3) continue;
    faces.push({ loop, uv: faceSquareUV(verts, loop), material: f.material, glass: f.glass });
  }
  // SILHOUETTE walls: count each undirected edge across the selection; the ones used
  // ONCE are the boundary. Keep the owning face's DIRECTED traverse (a→b) so the wall
  // runs b→a on the outer ring — the same winding two outward faces share, so the
  // wall faces outward (the extrudeEdge rule), no centroid heuristic needed.
  const count = new Map<string, number>();
  const dir = new Map<string, { a: number; b: number }>();
  for (const fi of sel) {
    const L = m.faces[fi].loop;
    for (let k = 0; k < L.length; k += 1) {
      const a = L[k], b = L[(k + 1) % L.length];
      if (a === b) continue; // a zero-length edge (malformed loop) is no silhouette
      const uk = edgeKey(a, b);
      count.set(uk, (count.get(uk) ?? 0) + 1);
      if (!dir.has(uk)) dir.set(uk, { a, b });
    }
  }
  for (const [uk, c] of count) {
    if (c !== 1) continue;
    const { a, b } = dir.get(uk)!;
    const loop = [b, a, inner.get(a)!, inner.get(b)!];
    faces.push({ loop, uv: faceSquareUV(verts, loop) });
  }
  return { ...m, verts, faces };
}

/** Detach a face selection off `m` as a standalone thin panel (req_1218): the
 *  selection leaves the body (so there's no coincident, z-fighting double skin)
 *  and returns as its own solidified part with a pivot seated at its center, ready
 *  to hinge/pop in rig mode. `{ panel, body }` — commit `body` to the source part
 *  and add `panel` as a new part. Pure + headless. */
export function detachPanel(m: EditMesh, faceIndices: Iterable<number>, thickness: number): { panel: EditMesh; body: EditMesh } {
  const sub = subMeshFromFaces(m, faceIndices);
  const solid = solidifyFaces(sub, sub.faces.map((_, i) => i), thickness);
  const panel = setPivot(solid, meshBoundsCenter(solid));
  return { panel, body: deleteFaces(m, faceIndices) };
}

// ── Extrude an EDGE: pull a new edge off it, bridge the gap (req_1163) ──────────
// The edge analog of extrudeFace (the user: "we gave extrude to faces but didn't
// give it to edges"). Copy the selected edge's two verts, push the copy out, and
// BRIDGE the original edge to the copy with ONE quad. Direction defaults to the
// AVERAGE NORMAL of the faces sharing the edge — so a boundary edge lifts straight
// out of its face, and a box edge lifts along the two-face bisector — then the
// move gizmo shapes it, exactly like the face cap. The bridge quad gets the default
// full-square UV (the side-wall pattern) and is wound to share the edge OPPOSITE to
// how its adjacent face traverses it (two faces sharing an edge run it in opposite
// directions when both face outward) — so the new flap is consistently outward-
// facing, continuous with that neighbor. A normal-based "away from center" flip is
// degenerate here: the quad normal is always perpendicular to the bisector extrude
// direction, so the dot is 0 and decides nothing. A negative distance pulls the
// copy the other way. The NEW edge is the two trailing verts (the caller re-finds
// it via meshEdges to keep the selection on it). Pure + headless.
export function extrudeEdge(m: EditMesh, edge: Edge, distance: number): EditMesh {
  const [a, b] = edge;
  if (a === b || !m.verts[a] || !m.verts[b]) return m;
  const adj = facesUsingEdges(m, [edge]).map((fi) => m.faces[fi]);
  // direction = average adjacent-face normal (loose edge → +Y).
  let nx = 0, ny = 0, nz = 0;
  for (const f of adj) { const n = faceNormal(m, f); nx += n[0]; ny += n[1]; nz += n[2]; }
  const nl = Math.hypot(nx, ny, nz);
  const dir: V3 = nl < 1e-9 ? [0, 1, 0] : [nx / nl, ny / nl, nz / nl];
  const off: V3 = [dir[0] * distance, dir[1] * distance, dir[2] * distance];
  const verts: V3[] = m.verts.map((v) => [v[0], v[1], v[2]]);
  const a2 = verts.length; verts.push([verts[a][0] + off[0], verts[a][1] + off[1], verts[a][2] + off[2]]);
  const b2 = verts.length; verts.push([verts[b][0] + off[0], verts[b][1] + off[1], verts[b][2] + off[2]]);
  // Does the first adjacent face traverse the edge a→b? Then the bridge runs b→a.
  const aToB = adjFaceRunsEdgeForward(adj[0], a, b);
  const loop = aToB ? [b, a, a2, b2] : [a, b, b2, a2];
  const faces: EditMeshFace[] = [...m.faces, { loop, uv: faceSquareUV(verts, loop) }];
  return { ...m, verts, faces };
}

/** Whether a face's loop contains the directed edge a→b (true) or b→a / neither
 *  (false) — the orientation a bridged neighbor must oppose to face the same way. */
function adjFaceRunsEdgeForward(face: EditMeshFace | undefined, a: number, b: number): boolean {
  if (!face) return false;
  const L = face.loop;
  for (let i = 0; i < L.length; i += 1) {
    if (L[i] === a && L[(i + 1) % L.length] === b) return true;
  }
  return false;
}

// ── Create face: bridge two edges, or fill 3–4 verts (req_1059) ────────────────
// Blockbench's Create Face: pick two edges → a quad bridges them; or pick 3–4 verts
// → a tri/quad fills them. The new face gets a default per-face square UV
// (`faceSquareUV`, the extrude side-wall pattern). Pure; edges are vertex-index
// pairs (Edge). No standalone-edge primitive exists (edges are face-derived here),
// so "create edge" is the same op with a face as the result.

function vdist(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Bridge two edges with a quad, ordering the loop so it can't self-cross (the
 *  bowtie): of the two ways to join the edges, take the one whose new edges are
 *  shorter. The two edges' four verts must be distinct. Pure. */
export function bridgeEdges(m: EditMesh, e0: Edge, e1: Edge): EditMesh {
  const [a, b] = e0, [c, d] = e1;
  if (new Set([a, b, c, d]).size < 4) return m; // shared vert → not a clean bridge
  const V = m.verts;
  // [a,b,c,d] joins b→c and d→a; [a,b,d,c] joins b→d and c→a — shorter joins = no cross.
  const loop = vdist(V[b], V[c]) + vdist(V[d], V[a]) <= vdist(V[b], V[d]) + vdist(V[c], V[a])
    ? [a, b, c, d] : [a, b, d, c];
  return { ...m, faces: [...m.faces, { loop, uv: faceSquareUV(V, loop) }] };
}

/** Order 3–4 vert indices into a non-crossing ring (by angle in their best-fit
 *  plane) so a created face is a clean convex-ish polygon. */
function ringOrder(m: EditMesh, idx: number[]): number[] {
  if (idx.length <= 3) return idx.slice();
  const V = m.verts;
  let cx = 0, cy = 0, cz = 0;
  for (const i of idx) { cx += V[i][0]; cy += V[i][1]; cz += V[i][2]; }
  const c: V3 = [cx / idx.length, cy / idx.length, cz / idx.length];
  const n = faceNormal(m, { loop: idx });
  const ref: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = cross(n, ref);          // in-plane basis (u and v share magnitude, so
  const v = cross(n, u);            // atan2 ordering is undistorted)
  const ang = (i: number): number => { const d = sub(V[i], c); return Math.atan2(dot(d, v), dot(d, u)); };
  return idx.slice().sort((p, q) => ang(p) - ang(q));
}

/** Create a tri (3 verts) or quad (4 verts) face from a vertex set, ring-ordered.
 *  Returns null if not 3–4 distinct in-range verts. Pure. */
export function createFaceFromVerts(m: EditMesh, vertIndices: Iterable<number>): EditMesh | null {
  const uniq = [...new Set(vertIndices)].filter((i) => i >= 0 && i < m.verts.length);
  if (uniq.length < 3 || uniq.length > 4) return null;
  const loop = ringOrder(m, uniq);
  return { ...m, faces: [...m.faces, { loop, uv: faceSquareUV(m.verts, loop) }] };
}

// ── Create face across MANY edges: fill a loop, or loft two chains (req_1164) ───
// The user's case: a side of 4 edges and a side of 2 edges, with no way to make a
// face between them — bridgeEdges only joined ONE edge to ONE edge, createFaceFromVerts
// capped at 4 verts. This assembles the SELECTED edges into chains (linking them by
// shared verts) and builds the in-between surface:
//   • ONE closed loop  → fill it (a single n-gon face, like a cylinder cap).
//   • TWO open chains  → LOFT a strip between them: quads when the two sides have
//     EQUAL vert counts, else a two-pointer triangle strip (so a 4-edge side bridges
//     cleanly to a 2-edge side). Returns null when the selection isn't one of those
//     clean shapes (branchy / dangling / >2 components). Pure + headless.

type EdgeChain = { verts: number[]; closed: boolean };

/** Walk a degree-≤2 component from `start` into an ordered vertex sequence. */
function walkEdgeChain(adj: Map<number, number[]>, start: number): number[] {
  const order = [start];
  const seen = new Set<number>([start]);
  let cur = start;
  for (;;) {
    let next = -1;
    for (const n of adj.get(cur)!) { if (!seen.has(n)) { next = n; break; } }
    if (next < 0) break;
    order.push(next); seen.add(next); cur = next;
  }
  return order;
}

/** Assemble undirected edges into ordered chains (paths) / loops by shared verts.
 *  Returns [] if any vert has >2 incident selected edges (branchy — ambiguous) or
 *  a component is neither a simple path nor a simple loop. */
function edgesToChains(edges: Iterable<Edge>): EdgeChain[] {
  const adj = new Map<number, number[]>();
  const seenEdge = new Set<string>();
  for (const [a, b] of edges) {
    if (a === b) continue;
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenEdge.has(k)) continue;
    seenEdge.add(k);
    (adj.get(a) ?? (adj.set(a, []), adj.get(a)!)).push(b);
    (adj.get(b) ?? (adj.set(b, []), adj.get(b)!)).push(a);
  }
  const verts = [...adj.keys()];
  if (verts.some((v) => adj.get(v)!.length > 2)) return []; // a junction → not clean chains
  const comp = new Map<number, number>();
  let nc = 0;
  for (const v of verts) {
    if (comp.has(v)) continue;
    const stack = [v]; comp.set(v, nc);
    while (stack.length) { const x = stack.pop()!; for (const y of adj.get(x)!) if (!comp.has(y)) { comp.set(y, nc); stack.push(y); } }
    nc += 1;
  }
  const chains: EdgeChain[] = [];
  for (let c = 0; c < nc; c += 1) {
    const cv = verts.filter((v) => comp.get(v) === c);
    const ends = cv.filter((v) => adj.get(v)!.length === 1);
    if (ends.length === 0) { // closed loop
      const order = walkEdgeChain(adj, cv[0]);
      if (order.length !== cv.length) return [];
      chains.push({ verts: order, closed: true });
    } else if (ends.length === 2) { // open path
      const order = walkEdgeChain(adj, ends[0]);
      if (order.length !== cv.length) return [];
      chains.push({ verts: order, closed: false });
    } else return []; // a dangling stub → not a clean path
  }
  return chains;
}

/** Push a triangle, flipping its winding so its normal aligns with `refN`. */
function pushOrientedTri(m: EditMesh, faces: EditMeshFace[], refN: V3, x: number, y: number, z: number): void {
  let loop = [x, y, z];
  if (dot(faceNormal(m, { loop }), refN) < 0) loop = [x, z, y];
  faces.push({ loop, uv: faceSquareUV(m.verts, loop) });
}

/** Push a quad (its corners already in ring order), flipping to align with `refN`. */
function pushOrientedQuad(m: EditMesh, faces: EditMeshFace[], refN: V3, loop: number[]): void {
  let l = loop;
  if (dot(faceNormal(m, { loop: l }), refN) < 0) l = [l[0], l[3], l[2], l[1]];
  faces.push({ loop: l, uv: faceSquareUV(m.verts, l) });
}

/** A consistent face normal for a loft between paths P and Q: perpendicular to P's
 *  run and the P→Q gap. Falls back to +Y when the two are degenerate/collinear. */
function loftRefNormal(m: EditMesh, P: number[], Q: number[]): V3 {
  const run = sub(m.verts[P[P.length - 1]], m.verts[P[0]]);
  const gap = sub(m.verts[Q[0]], m.verts[P[0]]);
  const n = cross(run, gap);
  const len = Math.hypot(n[0], n[1], n[2]);
  return len < 1e-9 ? [0, 1, 0] : [n[0] / len, n[1] / len, n[2] / len];
}

/** Loft a strip of faces between two ordered vertex paths. Aligns their directions
 *  by endpoint distance (no twist), then emits quads (equal counts) or a two-pointer
 *  triangle strip (unequal). */
function loftChains(m: EditMesh, P: number[], Qin: number[]): EditMesh {
  const V = m.verts;
  // align: reverse Q if the crossed pairing is shorter (avoids a twisted bridge).
  const Qrev = Qin.slice().reverse();
  const straight = vdist(V[P[0]], V[Qin[0]]) + vdist(V[P[P.length - 1]], V[Qin[Qin.length - 1]]);
  const crossed = vdist(V[P[0]], V[Qrev[0]]) + vdist(V[P[P.length - 1]], V[Qrev[Qrev.length - 1]]);
  const Q = crossed < straight ? Qrev : Qin;
  const refN = loftRefNormal(m, P, Q);
  const faces: EditMeshFace[] = m.faces.slice();
  if (P.length === Q.length) {
    for (let i = 0; i + 1 < P.length; i += 1) pushOrientedQuad(m, faces, refN, [P[i], P[i + 1], Q[i + 1], Q[i]]);
  } else {
    let i = 0, j = 0;
    while (i + 1 < P.length || j + 1 < Q.length) {
      if (i + 1 >= P.length) { pushOrientedTri(m, faces, refN, P[i], Q[j], Q[j + 1]); j += 1; }
      else if (j + 1 >= Q.length) { pushOrientedTri(m, faces, refN, P[i], P[i + 1], Q[j]); i += 1; }
      else if (vdist(V[P[i + 1]], V[Q[j]]) <= vdist(V[P[i]], V[Q[j + 1]])) { pushOrientedTri(m, faces, refN, P[i], P[i + 1], Q[j]); i += 1; }
      else { pushOrientedTri(m, faces, refN, P[i], Q[j], Q[j + 1]); j += 1; }
    }
  }
  return { ...m, faces };
}

/** Create the face(s) a multi-edge selection implies (req_1164): a single closed
 *  edge loop fills as one n-gon; two open chains loft into a bridging strip. Returns
 *  null when the selection isn't one clean loop or a clean pair of chains. Pure. */
export function createFaceFromEdges(m: EditMesh, edges: Iterable<Edge>): EditMesh | null {
  const list = [...edges].filter(([a, b]) => a !== b && m.verts[a] && m.verts[b]);
  if (list.length < 1) return null;
  const chains = edgesToChains(list);
  if (chains.length === 1 && chains[0].closed && chains[0].verts.length >= 3) {
    const loop = chains[0].verts;
    return { ...m, faces: [...m.faces, { loop, uv: faceSquareUV(m.verts, loop) }] };
  }
  if (chains.length === 2 && !chains[0].closed && !chains[1].closed) {
    return loftChains(m, chains[0].verts, chains[1].verts);
  }
  return null;
}

/** Reverse a face's winding (and its per-corner UV to match) so its NORMAL flips —
 *  the "flip" fix when Create Face guessed the wrong side and the face came out
 *  inside-out / upside-down (req_1182). Pure; topology + UV mapping unchanged, only
 *  the orientation. */
export function flipFace(m: EditMesh, faceIndex: number): EditMesh {
  const face = m.faces[faceIndex];
  if (!face || face.loop.length < 3) return m;
  const faces = m.faces.slice();
  faces[faceIndex] = { ...face, loop: face.loop.slice().reverse(), uv: face.uv ? face.uv.slice().reverse() : undefined };
  return { ...m, faces };
}

// ── Connect verts: "create edge from vertexes" (req_1265) ──────────────────────
// Edges here are face-derived (no loose-edge primitive), so the way to MAKE an edge
// is to introduce it as the shared boundary of two faces — Blender's Connect Vertex
// (J): pick two NON-adjacent corners of one face and cut a new edge across it,
// splitting the face in two. The new edge is then a real, selectable, extrudable
// edge. Pure + headless.

/** Split the face the two verts share along the new edge vA–vB. Both must lie on ONE
 *  common face and be NON-adjacent there (adjacent ⇒ the edge already exists). Returns
 *  null when no such face exists. Per-corner uv / material / glass carry to both
 *  halves; the two sub-loops inherit the parent winding so normals stay consistent. */
export function connectVerts(m: EditMesh, vA: number, vB: number): EditMesh | null {
  if (vA === vB || !m.verts[vA] || !m.verts[vB]) return null;
  for (let fi = 0; fi < m.faces.length; fi += 1) {
    const f = m.faces[fi];
    const ia = f.loop.indexOf(vA), ib = f.loop.indexOf(vB);
    if (ia < 0 || ib < 0) continue;
    const L = f.loop.length;
    // adjacent corners → that edge already exists, nothing to cut.
    if ((ia + 1) % L === ib || (ib + 1) % L === ia) continue;
    // walk the loop from `from` to `to` (inclusive, wrapping), keeping uv in lockstep.
    const slice = (from: number, to: number): { loop: number[]; uv?: V2[] } => {
      const loop: number[] = []; const uv: V2[] = [];
      for (let k = from; ; k = (k + 1) % L) {
        loop.push(f.loop[k]); if (f.uv) uv.push([f.uv[k][0], f.uv[k][1]]);
        if (k === to) break;
      }
      return { loop, uv: f.uv ? uv : undefined };
    };
    const half1 = slice(ia, ib);   // vA … vB
    const half2 = slice(ib, ia);   // vB … vA (wraps)
    if (half1.loop.length < 3 || half2.loop.length < 3) continue;
    const carry = (h: { loop: number[]; uv?: V2[] }): EditMeshFace => ({ loop: h.loop, uv: h.uv, material: f.material, glass: f.glass, tag: f.tag });
    const faces = m.faces.slice();
    faces.splice(fi, 1, carry(half1), carry(half2));
    return { ...m, faces };
  }
  return null;
}

// ── Bevel: chamfer a single edge (req_1265) ────────────────────────────────────
// Replace a sharp manifold edge with a flat chamfer (Blockbench/Blender's Bevel).
// The two faces meeting at the edge each slide their two shared corners inward along
// their OWN in-face edges by `width` (so the new verts stay on the surface), a
// chamfer quad bridges the two new edges, and a small triangle caps each end corner
// (the corner vert is KEPT for any third face still using it). Manifold edges only
// (exactly 2 incident faces); returns m unchanged otherwise. Pure + headless.

export function bevelEdge(m: EditMesh, edge: Edge, width: number): EditMesh {
  const [a, b] = edge;
  if (a === b || !m.verts[a] || !m.verts[b] || width <= 0) return m;
  const incident = facesUsingEdges(m, [edge]);
  if (incident.length !== 2) return m; // boundary / non-manifold → not a clean bevel

  const verts: V3[] = m.verts.map((v) => [v[0], v[1], v[2]]);
  // the in-face neighbour of corner `c` that ISN'T `other` — the edge we slide along.
  const slideTarget = (f: EditMeshFace, c: number, other: number): number => {
    const L = f.loop, i = L.indexOf(c);
    const prev = L[(i + L.length - 1) % L.length], next = L[(i + 1) % L.length];
    return next === other ? prev : next;
  };
  const slid = (c: number, target: number): V3 => {
    const p = verts[c], q = verts[target];
    const d: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const tt = Math.min(width, len * 0.45) / len; // clamp so the slide can't pass the far vert
    return [p[0] + d[0] * tt, p[1] + d[1] * tt, p[2] + d[2] * tt];
  };

  // each incident face gets slid copies of a and b; rewrite the face to use them.
  const faces: EditMeshFace[] = m.faces.map((f) => ({ ...f, loop: f.loop.slice(), uv: f.uv ? f.uv.map((p) => [p[0], p[1]] as V2) : undefined }));
  const sides: { aNew: number; bNew: number }[] = [];
  for (const fi of incident) {
    const f = m.faces[fi];
    const aNew = verts.length; verts.push(slid(a, slideTarget(f, a, b)));
    const bNew = verts.length; verts.push(slid(b, slideTarget(f, b, a)));
    const loop = faces[fi].loop;
    loop[loop.indexOf(a)] = aNew;
    loop[loop.indexOf(b)] = bNew;
    sides.push({ aNew, bNew });
  }

  // mesh centroid → outward orientation for the three new faces.
  let cx = 0, cy = 0, cz = 0;
  for (const v of m.verts) { cx += v[0]; cy += v[1]; cz += v[2]; }
  const C: V3 = [cx / m.verts.length, cy / m.verts.length, cz / m.verts.length];

  const [s0, s1] = sides;
  const add = (raw: number[]) => { const loop = orientOutward(verts, raw, C); faces.push({ loop, uv: faceSquareUV(verts, loop) }); };
  add([s0.aNew, s0.bNew, s1.bNew, s1.aNew]); // the chamfer quad
  add([a, s0.aNew, s1.aNew]);                // corner cap at a
  add([b, s0.bNew, s1.bNew]);                // corner cap at b
  return { ...m, verts, faces };
}

/** Bevel (chamfer) a single vertex (req_1266): cut the corner off. Each incident
 *  EDGE gets a new vert pulled back from `vi` along that edge by `width`; every face
 *  using `vi` clips its corner to the two new verts on its two incident edges; and a
 *  cap face fills the ring of those new verts. Needs ≥3 incident edges (a real
 *  corner); returns m unchanged otherwise. The slide is clamped per-edge so it can't
 *  pass the far vert. Pure + headless. */
export function bevelVertex(m: EditMesh, vi: number, width: number): EditMesh {
  if (!m.verts[vi] || width <= 0) return m;
  const incident: number[] = [];                 // face indices using vi
  m.faces.forEach((f, fi) => { if (f.loop.includes(vi)) incident.push(fi); });
  const inc = new Set(incident);
  // neighbours of vi across all incident faces = its incident edges.
  const neighbours = new Set<number>();
  for (const fi of incident) {
    const L = m.faces[fi].loop, i = L.indexOf(vi);
    neighbours.add(L[(i + 1) % L.length]);
    neighbours.add(L[(i + L.length - 1) % L.length]);
  }
  if (neighbours.size < 3) return m;             // a flat/edge tip — nothing real to chamfer

  const verts: V3[] = m.verts.map((v) => [v[0], v[1], v[2]]);
  const p = verts[vi];
  const onEdge = new Map<number, number>();      // neighbour vert → its new (slid) vert index
  for (const nb of neighbours) {
    const q = verts[nb];
    const d: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const tt = Math.min(width, len * 0.45) / len;
    onEdge.set(nb, verts.length);
    verts.push([p[0] + d[0] * tt, p[1] + d[1] * tt, p[2] + d[2] * tt]);
  }

  // rewrite each incident face: replace vi with [vert-on-prev-edge, vert-on-next-edge]
  // so the corner is clipped to the chamfer (one corner → two).
  const faces: EditMeshFace[] = m.faces.map((f, fi) => {
    if (!inc.has(fi)) return f;
    const L = f.loop, i = L.indexOf(vi);
    const prev = L[(i + L.length - 1) % L.length], next = L[(i + 1) % L.length];
    const loop = L.slice();
    const uv = f.uv ? f.uv.map((u) => [u[0], u[1]] as V2) : undefined;
    loop.splice(i, 1, onEdge.get(prev)!, onEdge.get(next)!);
    if (uv) uv.splice(i, 1, [uv[i][0], uv[i][1]], [uv[i][0], uv[i][1]]);
    return { ...f, loop, uv };
  });

  // CAP: the ring of new verts, ordered around vi in the averaged incident-face
  // normal's plane, wound outward (away from the mesh centroid).
  let nx = 0, ny = 0, nz = 0;
  for (const fi of incident) { const n = faceNormal(m, m.faces[fi]); nx += n[0]; ny += n[1]; nz += n[2]; }
  const nl = Math.hypot(nx, ny, nz) || 1;
  const N: V3 = [nx / nl, ny / nl, nz / nl];
  const refAxis: V3 = Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const uAxis = cross(N, refAxis), vAxis = cross(N, uAxis);
  const ang = (idx: number): number => { const d = sub(verts[idx], p); return Math.atan2(dot(d, vAxis), dot(d, uAxis)); };
  const ring = [...onEdge.values()].sort((a, b) => ang(a) - ang(b));
  let cx = 0, cy = 0, cz = 0;
  for (const v of m.verts) { cx += v[0]; cy += v[1]; cz += v[2]; }
  const C: V3 = [cx / m.verts.length, cy / m.verts.length, cz / m.verts.length];
  const capLoop = orientOutward(verts, ring, C);
  faces.push({ loop: capLoop, uv: faceSquareUV(verts, capLoop) });
  return { ...m, verts, faces };
}

/** Set (or clear) the GLASS flag on a set of faces (req_1181) — marks them as
 *  translucent panes that render see-through and skip the texture atlas. Pure. */
export function setFaceGlass(m: EditMesh, faceIndices: Iterable<number>, glass: boolean): EditMesh {
  const set = faceIndices instanceof Set ? faceIndices : new Set(faceIndices);
  return { ...m, faces: m.faces.map((f, i) => (set.has(i) ? { ...f, glass: glass || undefined } : f)) };
}

// ── Mirror / symmetry editing (req_1183) ───────────────────────────────────────
// Symmetric modeling: edit one side, the other follows mirrored ("pull left here →
// right pulls there"). Done OP-AGNOSTICALLY — after ANY vertex transform, each moved
// vert's mirror partner is set to the REFLECTED final position. So move, resize, and
// rotate all mirror with one code path: we never re-derive the op, just reflect where
// the verts ended up. Partners are matched by ORIGINAL position so the pairing holds
// through a drag; a vert with no twin or one on the mirror plane is its own partner
// and left alone.

/** Map each vert index to its mirror partner across plane `axis = c` (default x=0):
 *  the vert whose position is the reflection. Self when on the plane or no twin. */
export function mirrorPartners(m: EditMesh, axis: 0 | 1 | 2, c = 0, dp = 4): number[] {
  const key = (p: V3) => `${p[0].toFixed(dp)},${p[1].toFixed(dp)},${p[2].toFixed(dp)}`;
  const byPos = new Map<string, number>();
  m.verts.forEach((v, i) => byPos.set(key(v), i));
  return m.verts.map((v, i) => {
    const r: V3 = [v[0], v[1], v[2]]; r[axis] = 2 * c - v[axis];
    const p = byPos.get(key(r));
    return p == null ? i : p;
  });
}

/** Reflect each `moved` vert's new position onto its mirror partner across EVERY
 *  enabled plane in `axes` (each `= c`) — symmetric editing on one OR more planes
 *  (req_1183/1186: "the other direction also"). For >1 axis it also reflects across
 *  their COMBINATIONS (X+Z → the diagonal twin), so two planes give clean 4-way
 *  symmetry, not two half-mirrors. `base` (pre-drag) fixes the pairing; `next` holds
 *  the transformed positions. A vert's own reflection (seam) and partners that are
 *  themselves in `moved` are skipped so nothing double-applies. Pure. */
export function mirrorEditAxes(base: EditMesh, next: EditMesh, moved: Iterable<number>, axes: (0 | 1 | 2)[], c = 0, dp = 4): EditMesh {
  if (axes.length === 0) return next;
  const movedSet = moved instanceof Set ? moved : new Set(moved);
  const key = (p: V3) => `${p[0].toFixed(dp)},${p[1].toFixed(dp)},${p[2].toFixed(dp)}`;
  const byPos = new Map<string, number>();
  base.verts.forEach((v, i) => byPos.set(key(v), i));
  // every non-empty subset of the enabled axes = one reflection (single planes + diagonals)
  const subsets: (0 | 1 | 2)[][] = [];
  for (let mask = 1; mask < (1 << axes.length); mask += 1) {
    const s: (0 | 1 | 2)[] = [];
    for (let k = 0; k < axes.length; k += 1) if (mask & (1 << k)) s.push(axes[k]);
    subsets.push(s);
  }
  const verts = next.verts.map((v) => [v[0], v[1], v[2]] as V3);
  let touched = false;
  for (const i of movedSet) {
    const bi = base.verts[i];
    for (const s of subsets) {
      const rp: V3 = [bi[0], bi[1], bi[2]]; for (const a of s) rp[a] = 2 * c - rp[a]; // the twin's ORIGINAL pos
      const p = byPos.get(key(rp));
      if (p == null || p === i || movedSet.has(p)) continue;
      const si = next.verts[i];
      const np: V3 = [si[0], si[1], si[2]]; for (const a of s) np[a] = 2 * c - np[a]; // its reflected NEW pos
      verts[p] = np;
      touched = true;
    }
  }
  return touched ? { ...next, verts } : next;
}

/** Single-plane symmetry — `mirrorEditAxes` for one axis (back-compat). Pure. */
export function mirrorEdit(base: EditMesh, next: EditMesh, moved: Iterable<number>, axis: 0 | 1 | 2, c = 0): EditMesh {
  return mirrorEditAxes(base, next, moved, [axis], c);
}

/** A GeometryData of ONLY the given faces, each pushed out along its own normal
 *  by `push` meters so a shaded overlay sits just above the surface without
 *  z-fighting — the selected-face highlight (req_0986). Fan-triangulated like
 *  `editMeshToGeometry`; empty selection → an empty (zero-count) geometry. */
export function facesGeometry(m: EditMesh, faceIndices: Iterable<number>, push = 0): GeometryData {
  const g = mesh();
  for (const fi of faceIndices) {
    const face = m.faces[fi];
    if (!face || face.loop.length < 3) continue;
    const n = faceNormal(m, face) as Vec3;
    const off = (idx: number): Vec3 => { const p = m.verts[idx]; return [p[0] + n[0] * push, p[1] + n[1] * push, p[2] + n[2] * push]; };
    const a = off(face.loop[0]);
    for (let i = 1; i + 1 < face.loop.length; i += 1) {
      g.tri(a, n, [0.5, 0.5], off(face.loop[i]), n, [0.5, 0.5], off(face.loop[i + 1]), n, [0.5, 0.5]);
    }
  }
  return g.build();
}

// ── Face tags: follow a face's pieces through a cut (req_0989) ─────────────────
// A tool tags ONE face, runs the cut (cutMeshByPlane carries the tag onto every
// split child), then reads back the tagged pieces — so the loop-cut selection
// persists onto the right face(s) instead of vanishing.

/** Tag exactly one face with `tag`, clearing every other face's tag. */
export function tagOneFace(m: EditMesh, faceIndex: number, tag: number): EditMesh {
  return { ...m, faces: m.faces.map((f, i) => ({ ...f, tag: i === faceIndex ? tag : undefined })) };
}

/** Indices of the faces currently carrying `tag`. */
export function facesWithTag(m: EditMesh, tag: number): number[] {
  const out: number[] = [];
  m.faces.forEach((f, i) => { if (f.tag === tag) out.push(i); });
  return out;
}

/** Drop all transient tags (the committed mesh stays clean). Indices preserved. */
export function clearFaceTags(m: EditMesh): EditMesh {
  if (!m.faces.some((f) => f.tag !== undefined)) return m;
  return { ...m, faces: m.faces.map((f) => (f.tag === undefined ? f : { ...f, tag: undefined })) };
}

// ── Delete: drop faces (or faces touching an edge/vertex selection) (req_1020) ──
// Deleting in vertex/edge mode means "remove the faces this element belongs to"
// (Blockbench): a vert/edge selection resolves to the faces that USE it. The pure
// `deleteFaces` removes those faces, then prunes any now-orphaned vertex and
// reindexes the survivors so the mesh stays compact (no floating verts, no stale
// indices). Pure + headless.

/** Faces that use ANY of the given vertices (vertex-mode delete resolution). */
export function facesUsingVerts(m: EditMesh, verts: Iterable<number>): number[] {
  const set = verts instanceof Set ? verts : new Set(verts);
  const out: number[] = [];
  m.faces.forEach((f, i) => { if (f.loop.some((vi) => set.has(vi))) out.push(i); });
  return out;
}

/** Faces that carry ANY of the given edges on their boundary (edge-mode delete). */
export function facesUsingEdges(m: EditMesh, edges: Iterable<Edge>): number[] {
  const keys = new Set<string>();
  for (const e of edges) keys.add(edgeKey(e[0], e[1]));
  const out: number[] = [];
  m.faces.forEach((f, i) => {
    const n = f.loop.length;
    for (let k = 0; k < n; k += 1) {
      if (keys.has(edgeKey(f.loop[k], f.loop[(k + 1) % n]))) { out.push(i); break; }
    }
  });
  return out;
}

/** Remove the given faces, prune any vertex left unused by the survivors, and
 *  reindex — returns a compact mesh. Mounts ride along (they key on space, not
 *  vertex index). Empty selection → the mesh unchanged. */
export function deleteFaces(m: EditMesh, faceIndices: Iterable<number>): EditMesh {
  const drop = faceIndices instanceof Set ? faceIndices : new Set(faceIndices);
  if (drop.size === 0) return m;
  const kept = m.faces.filter((_, i) => !drop.has(i));
  const used = new Set<number>();
  for (const f of kept) for (const vi of f.loop) used.add(vi);
  const remap = new Map<number, number>();
  const verts: V3[] = [];
  m.verts.forEach((v, i) => { if (used.has(i)) { remap.set(i, verts.length); verts.push([v[0], v[1], v[2]]); } });
  const faces = kept.map((f) => ({ ...f, loop: f.loop.map((vi) => remap.get(vi)!) }));
  return { ...m, verts, faces };
}

// ── Mesh lint: "hey, your shit is scuffed" (req_1224) ───────────────────────────
// It's all numbers, so the mistakes are countable. validateMesh reads a mesh and
// reports every defect it can prove from the topology — the same class of thing
// that produced the doubled-corner door (req_1222), found BEFORE it bites a cut /
// unwrap / cook. Each issue carries the faces + verts it implicates so the editor
// can select-and-show them. Pure + headless; severity lets the UI rank a hard
// error (a broken face) above a cosmetic warn (a weldable duplicate vertex).

export type MeshIssueKind =
  | 'repeated-corner'    // a face loop names the same vertex twice (zero-length edge / pinch)
  | 'degenerate-face'    // fewer than 3 distinct corners, or ~zero area (collinear)
  | 'non-manifold-edge'  // an edge shared by >2 faces (geometry folds on itself)
  | 'open-edge'          // an edge used by exactly ONE face (a hole — fine for a flat panel)
  | 'duplicate-vertex'   // two+ verts at the same position (weldable seam)
  | 'orphan-vertex'      // a vertex no face uses (dead weight)
  | 'concave-face';      // a reflex (non-convex) n-gon (the Auto-Fix offender)

export type MeshSeverity = 'error' | 'warn' | 'info';
export type MeshIssue = { kind: MeshIssueKind; severity: MeshSeverity; faces: number[]; verts: number[]; detail: string };

/** Lint a mesh: every provable topological defect, each tagged with the faces +
 *  verts it implicates and a severity. Empty array = clean. Pure + headless. */
export function validateMesh(m: EditMesh, dp = 4): MeshIssue[] {
  const out: MeshIssue[] = [];

  // per-face defects: repeated corners + degenerate (sub-triangle / zero-area).
  m.faces.forEach((f, fi) => {
    const distinct = new Set(f.loop);
    if (distinct.size < f.loop.length) {
      const dupes = f.loop.filter((v, i) => f.loop.indexOf(v) !== i);
      out.push({ kind: 'repeated-corner', severity: 'error', faces: [fi], verts: [...new Set(dupes)], detail: `face ${fi} names vertex ${[...new Set(dupes)].join(', ')} twice (zero-length edge)` });
    }
    if (distinct.size < 3) {
      out.push({ kind: 'degenerate-face', severity: 'error', faces: [fi], verts: [...distinct], detail: `face ${fi} has only ${distinct.size} distinct corners` });
      return; // area is meaningless for a sub-triangle
    }
    // raw Newell magnitude = 2× area; ~0 means collinear / zero-area.
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < f.loop.length; i += 1) {
      const c = m.verts[f.loop[i]], n = m.verts[f.loop[(i + 1) % f.loop.length]];
      nx += (c[1] - n[1]) * (c[2] + n[2]); ny += (c[2] - n[2]) * (c[0] + n[0]); nz += (c[0] - n[0]) * (c[1] + n[1]);
    }
    if (Math.hypot(nx, ny, nz) < 1e-7) out.push({ kind: 'degenerate-face', severity: 'error', faces: [fi], verts: [...distinct], detail: `face ${fi} has ~zero area (collinear corners)` });
  });

  // edge manifoldness: how many faces share each undirected edge.
  const edgeFaces = new Map<string, number[]>();
  m.faces.forEach((f, fi) => {
    const n = f.loop.length;
    for (let i = 0; i < n; i += 1) {
      const a = f.loop[i], b = f.loop[(i + 1) % n];
      if (a === b) continue; // already flagged as a repeated corner
      const k = edgeKey(a, b);
      (edgeFaces.get(k) ?? (edgeFaces.set(k, []), edgeFaces.get(k)!)).push(fi);
    }
  });
  for (const [k, fs] of edgeFaces) {
    const [a, b] = k.split(':').map(Number);
    if (fs.length > 2) out.push({ kind: 'non-manifold-edge', severity: 'error', faces: [...new Set(fs)], verts: [a, b], detail: `edge ${a}-${b} is shared by ${fs.length} faces` });
    else if (fs.length === 1) out.push({ kind: 'open-edge', severity: 'info', faces: fs, verts: [a, b], detail: `edge ${a}-${b} is a boundary (open) edge` });
  }

  // duplicate verts (same position) — a weldable seam.
  const byPos = new Map<string, number[]>();
  m.verts.forEach((v, i) => {
    const key = `${v[0].toFixed(dp)},${v[1].toFixed(dp)},${v[2].toFixed(dp)}`;
    (byPos.get(key) ?? (byPos.set(key, []), byPos.get(key)!)).push(i);
  });
  for (const ids of byPos.values()) if (ids.length > 1) out.push({ kind: 'duplicate-vertex', severity: 'warn', faces: [], verts: ids, detail: `${ids.length} verts share a position (${ids.join(', ')})` });

  // orphan verts (used by no face).
  const used = new Set<number>();
  for (const f of m.faces) for (const vi of f.loop) used.add(vi);
  const orphans = m.verts.map((_, i) => i).filter((i) => !used.has(i));
  if (orphans.length) out.push({ kind: 'orphan-vertex', severity: 'warn', faces: [], verts: orphans, detail: `${orphans.length} verts are used by no face` });

  // concave n-gons (the existing Auto-Fix class).
  const concave = findConcaveFaces(m);
  if (concave.length) out.push({ kind: 'concave-face', severity: 'warn', faces: concave, verts: [], detail: `${concave.length} face(s) are concave (reflex corner)` });

  return out;
}

/** A one-line health summary of a mesh: counts by severity, worst first. "" when
 *  clean. The Studio's check badge speaks this. */
export function meshHealth(m: EditMesh): { clean: boolean; errors: number; warns: number; issues: MeshIssue[] } {
  const issues = validateMesh(m);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warn').length;
  return { clean: errors === 0 && warns === 0, errors, warns, issues };
}
