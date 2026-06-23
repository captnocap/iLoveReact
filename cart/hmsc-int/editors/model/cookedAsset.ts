// editors/model/cookedAsset.ts — THE ASSET COMPILER's cook core (Part 7 of
// MESH_EDITOR_PLAYBOOK.md, req_1122/req_1123/req_1129). Turns a Studio model into
// a typed, content-addressed, installable game asset — "BSP files, but for assets."
//
// GUIDING LIGHT (req_1129, the law this module holds): a game is DATA, not code.
//   • The cook is the COMPILER; the loader is the dumb fixed host. Niceness lives
//     in the producer (the Studio's EditMesh), flatness in the artifact (the soup
//     + a texture ref), dumbness in the engine.
//   • SEPARABLE, CONTENT-ADDRESSED FACTORS — never a baked product. The heavy
//     factors (the mesh blob, the texture blob) are interned ONCE by their own
//     sha256 and REFERENCED; the descriptor is the only per-kind factor. One model
//     cooked as a prop AND an item shares the same meshRef + texRef and differs
//     only in `descriptor` — kind × mesh × texture stays a SUM, not a product.
//   • THE HASH IS THE CACHE KEY: re-cooking an unchanged model yields the same
//     blob hashes → a cache hit, no rework. This keeps the cook inside the user's
//     instant Compile → /compiled loop.
//   • DECLARATIVE, NEVER CODE: the descriptor is flat data parameterizing fixed
//     engine capabilities (solid, container, seat…). No per-asset scripts ever.
//   • DERIVE, DON'T STORE TWICE: collision/footprint/height are MEASURED from the
//     mesh, never hand-typed into the descriptor.
//
// Pure + headless (the editMesh/modelStream/textureize test idiom): no React, no
// host doors. The texture FACTOR is supplied as a content hash (`texRef`) — the
// Studio side computes the compressed WebP via @reactjit/image and passes its
// hash in, so this core never touches the (host-only) image codec. Tested by
// cookedAsset.test.ts under tools/v8cli.

import { editMeshToGeometry, type EditMesh, type MountPoint, type V3 } from './editMesh';
import { sha256Hex } from '@reactjit/workspace/sha256';
import type { PropCollisionBox, PropContainer, PropKindDefinition, PropMount, PropSeat, PropTrafficControl, PropCoverClass } from '../../game/kinds/props';
import type { TileKind } from '../../game/kinds/tiles';

/** The descriptor schema version — bumped when a descriptor's required-field set
 *  changes; the loader hard-validates it (no silent old-shape acceptance). */
export const COOK_SCHEMA = 2;

export type CookKind = 'prop' | 'item' | 'vehiclePart' | 'vehicle' | 'clothing';

/** The minimal slice of a Studio part the cook reads — `StudioPart`/`StoredPart`
 *  both satisfy it (rule of two: one shape, both callers). */
export type CookPart = {
  /** stable Studio part id, used only to disambiguate same-named texture slots
   *  across parts once a whole model flattens into one cooked prop. */
  id?: string;
  /** human part name, used in cooked slot labels when duplicate slot ids collide. */
  name?: string;
  mesh: EditMesh;
  /** ground lift applied in the viewport (parts sit ON the grid). Baked into the
   *  flattened soup so the cooked mesh sits where the user sees it. */
  lift: number;
  visible: boolean;
};

export type CookBounds = { min: V3; max: V3; size: V3; radius: number };

/** The flattened geometry FACTOR — one triangle soup for the whole model, keyed
 *  by its own content hash (interned once, referenced by every asset that uses
 *  it). 8 floats/vertex (pos3 nrm3 uv2) — the loader's MESH_PROPS format. */
export type MeshBlob = {
  hash: string;
  verts: Float32Array;
  count: number;
  bounds: CookBounds;
  /** Re-skinnable sub-ranges in `verts`, in vertex units (not floats). Absent
   *  when no authored faces belong to texture slots, preserving the old artifact. */
  slots?: CookedTextureSlot[];
  /** Trailing sub-range of glass-tagged faces (req_1673). Glass faces split out
   *  of the opaque soup so the editor + compiled loader render them translucent
   *  (the transparent pass) instead of the solid prop tint. Absent = no glass. */
  glass?: MeshGlassRange;
};

/** A vertex sub-range (vertex units) carrying the model's see-through faces. */
export type MeshGlassRange = { start: number; count: number };

export const COOKED_SLOT_DEFAULT_MATERIAL = '#c2c6cf';

export type CookedTextureSlot = {
  id: string;
  label: string;
  defaultMaterial: string;
  /** first vertex in the flattened soup for this slot. */
  start: number;
  /** vertex count in this slot's sub-mesh. */
  count: number;
};

/** Collision/bounds DERIVED from the mesh — never hand-authored (Guiding Light:
 *  derive, don't store twice). Mirrors the imported-prop derivation so a cooked
 *  prop and an imported one measure footprints identically. */
export type CookCollision = {
  footprintWidthMeters: number;
  footprintDepthMeters: number;
  footprintRadiusMeters: number;
  heightMeters: number;
  boundsRadius: number;
  /** SHAPE-AWARE collider: one box per connected component of the model (req_1587),
   *  in prop-local meters (anchor at origin, Y up from ground — same space as the
   *  flattened mesh). An archway cooks 3 boxes (two posts + a high beam) so the
   *  player walks UNDER the beam instead of into one ground-to-top wall. A single
   *  solid component cooks one box (≈ the footprint), so nothing regresses. */
  boxes: PropCollisionBox[];
};

/** The PROP gameplay descriptor — a `PropKindDefinition` minus the MEASURED
 *  fields (footprint/height + the dynamic body radius), which the cook fills from
 *  the mesh. This is the EXISTING prop table's own type, not a fork (rule of two). */
export type PropDescriptorInput = {
  label?: string;
  solid: boolean;
  tileKind: TileKind;
  trafficControl?: PropTrafficControl;
  /** KICKABLE PHYSICS BODY (a barrel/can/ball — the KICKPROP system): present =
   *  this prop is a dynamic body the player kicks around, NOT static scenery. Only
   *  the bounce (`restitution`, 0..1) is authored; the body radius is MEASURED from
   *  the footprint at cook time (derive, don't store twice). Absent = static. */
  physics?: { restitution: number };
  mount?: PropMount;
  seat?: PropSeat;
  container?: PropContainer;
  coverClass?: PropCoverClass;
};

/** The cooked asset: a thin record of REFERENCES (the heavy factors live in the
 *  blob store, keyed by hash) plus the one per-kind factor (the descriptor). */
export type CookedAsset = {
  id: string;
  /** content hash of (id, meshRef, texRef, descriptor, mounts) — the asset identity. */
  hash: string;
  kind: CookKind;
  name: string;
  schema: number;
  /** → MeshBlob.hash (geometry factor, shared by every asset cooked from this mesh). */
  meshRef: string;
  /** → TextureBlob.hash (texture factor, shared). Absent = untextured. */
  texRef?: string;
  collision: CookCollision;
  mounts: MountPoint[];
  /** Named re-skinnable face groups, keyed by WorldProp.partTextures[slot.id]. */
  slots?: CookedTextureSlot[];
  /** Trailing glass sub-range (req_1673) — copied from the blob so render paths
   *  read it without re-deriving. Absent = the model has no glass-tagged faces. */
  glass?: MeshGlassRange;
  descriptor: PropKindDefinition;
};

export type CookResult = {
  asset: CookedAsset;
  /** the geometry factor to intern into the blob store (the bake ships it as MESH_PROPS). */
  blob: MeshBlob;
  /** required-field violations — non-empty means the cook is INVALID (fail loud). */
  errors: string[];
};

// ── content-address primitive (Guiding Light law 4) ──────────────────────────

function utf8(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

/** sha256 of a string — the repo's content-address hash (bakeGameFile's vocab key). */
export function hashString(s: string): string {
  return sha256Hex(utf8(s));
}

function hashBytes(verts: Float32Array): string {
  return sha256Hex(new Uint8Array(verts.buffer, verts.byteOffset, verts.byteLength));
}

// ── geometry factor: flatten the model to ONE soup ───────────────────────────

/** Translate a part's verts up by its ground lift — so the flattened model sits
 *  where the viewport shows it (parts rest ON the grid). Pure; UVs/faces ride. */
function liftedMesh(part: CookPart): EditMesh {
  if (!part.lift) return part.mesh;
  return { ...part.mesh, verts: part.mesh.verts.map((v): V3 => [v[0], v[1] + part.lift, v[2]]) };
}

function slugKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'part';
}

function faceSlotIndex(mesh: EditMesh, face: { material?: number }): number {
  const idx = face.material;
  return idx != null && idx >= 0 && idx < (mesh.slots?.length ?? 0) ? idx : -1;
}

function boundsOfSoup(verts: Float32Array): CookBounds {
  let lox = Infinity, loy = Infinity, loz = Infinity, hix = -Infinity, hiy = -Infinity, hiz = -Infinity;
  for (let i = 0; i + 7 < verts.length; i += 8) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    if (x < lox) lox = x; if (x > hix) hix = x;
    if (y < loy) loy = y; if (y > hiy) hiy = y;
    if (z < loz) loz = z; if (z > hiz) hiz = z;
  }
  if (!Number.isFinite(lox)) {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], radius: 0 };
  }
  const min: V3 = [lox, loy, loz];
  const max: V3 = [hix, hiy, hiz];
  const size: V3 = [hix - lox, hiy - loy, hiz - loz];
  const radius = Math.hypot(size[0], size[1], size[2]) / 2;
  return { min, max, size, radius };
}

/** Flatten every VISIBLE part into one content-addressed mesh blob. The geometry
 *  factor — interned once, referenced by id.
 *
 *  GLASS (req_1673): faces tagged glass in the Studio are excluded from the opaque
 *  section here and appended as ONE trailing sub-range (`glass`), so the editor and
 *  compiled loader render them through the transparent pass instead of baking them
 *  into the solid prop tint. Glass skips texturing (it never belongs to a slot), so
 *  the opaque/slot layout is unchanged for glass-free models — the meshRef of an
 *  existing model only moves when it actually carries glass. */
export function flattenModel(parts: readonly CookPart[]): MeshBlob {
  const hasSlottedFaces = parts.some((p) => p.visible && (p.mesh.slots?.length ?? 0) > 0
    && p.mesh.faces.some((f) => faceSlotIndex(p.mesh, f) >= 0));

  const chunks: Float32Array[] = [];
  let total = 0; // float length of the OPAQUE section (everything but glass)
  let slots: CookedTextureSlot[] | undefined;

  if (!hasSlottedFaces) {
    for (const p of parts) {
      if (!p.visible) continue;
      const g = editMeshToGeometry(liftedMesh(p), (f) => !f.glass);
      if (g.positions.length === 0) continue;
      chunks.push(g.positions);
      total += g.positions.length;
    }
  } else {
    type SlotSource = { id: string; label: string; mesh: EditMesh; slotIndex: number };
    const slotSources: SlotSource[] = [];
    const used = new Set<string>();

    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const p = parts[partIndex];
      if (!p.visible) continue;
      const mesh = liftedMesh(p);
      // Unslotted opaque = no texture slot AND not glass (glass skips texturing).
      const unslotted = editMeshToGeometry(mesh, (f) => faceSlotIndex(mesh, f) < 0 && !f.glass);
      if (unslotted.positions.length > 0) {
        chunks.push(unslotted.positions);
        total += unslotted.positions.length;
      }
      for (let slotIndex = 0; slotIndex < (mesh.slots?.length ?? 0); slotIndex += 1) {
        if (!mesh.faces.some((f) => f.material === slotIndex && !f.glass)) continue;
        const slot = mesh.slots![slotIndex];
        let id = slot.id;
        let label = slot.label;
        if (used.has(id)) {
          const prefix = slugKey(p.id ?? p.name ?? `part-${partIndex + 1}`);
          id = `${prefix}.${slot.id}`;
          label = `${p.name ?? p.id ?? `Part ${partIndex + 1}`} ${slot.label}`;
          let suffix = 2;
          while (used.has(id)) {
            id = `${prefix}.${slot.id}.${suffix}`;
            suffix += 1;
          }
        }
        used.add(id);
        slotSources.push({ id, label, mesh, slotIndex });
      }
    }

    const built: CookedTextureSlot[] = [];
    let vertexStart = total / 8;
    for (const source of slotSources) {
      const g = editMeshToGeometry(source.mesh, (f) => f.material === source.slotIndex && !f.glass);
      if (g.positions.length === 0) continue;
      chunks.push(g.positions);
      total += g.positions.length;
      const count = g.positions.length / 8;
      built.push({
        id: source.id,
        label: source.label,
        defaultMaterial: COOKED_SLOT_DEFAULT_MATERIAL,
        start: vertexStart,
        count,
      });
      vertexStart += count;
    }
    if (built.length) slots = built;
  }

  // Glass pass — every glass-tagged face from every part, appended after the
  // opaque section as one trailing sub-range. Built only when glass exists so a
  // glass-free model pays nothing and keeps its old meshRef.
  const glassChunks: Float32Array[] = [];
  let glassFloats = 0;
  for (const p of parts) {
    if (!p.visible) continue;
    const g = editMeshToGeometry(liftedMesh(p), (f) => !!f.glass);
    if (g.positions.length === 0) continue;
    glassChunks.push(g.positions);
    glassFloats += g.positions.length;
  }
  const glassStart = total / 8;

  const verts = new Float32Array(total + glassFloats);
  let off = 0;
  for (const c of chunks) { verts.set(c, off); off += c.length; }
  for (const c of glassChunks) { verts.set(c, off); off += c.length; }

  return {
    hash: hashBytes(verts),
    verts,
    count: verts.length / 8,
    bounds: boundsOfSoup(verts),
    ...(slots ? { slots } : {}),
    ...(glassFloats ? { glass: { start: glassStart, count: glassFloats / 8 } } : {}),
  };
}

/** Split a part's faces into vertex-CONNECTED components (union-find over the verts
 *  each face touches), and box each — so an archway authored as one part but three
 *  disjoint islands (two posts + a beam) still yields three colliders, and a single
 *  welded shape yields one. Only verts USED by a face count (stray verts ignored). */
function partCollisionBoxes(mesh: EditMesh): PropCollisionBox[] {
  const n = mesh.verts.length;
  if (n === 0 || mesh.faces.length === 0) return [];
  const parent = new Array<number>(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (const f of mesh.faces) for (let i = 1; i < f.loop.length; i += 1) union(f.loop[0], f.loop[i]);
  const groups = new Map<number, number[]>();
  for (const f of mesh.faces) for (const vi of f.loop) {
    const r = find(vi);
    let g = groups.get(r);
    if (!g) { g = []; groups.set(r, g); }
    g.push(vi);
  }
  const boxes: PropCollisionBox[] = [];
  for (const g of groups.values()) {
    let lox = Infinity, loy = Infinity, loz = Infinity, hix = -Infinity, hiy = -Infinity, hiz = -Infinity;
    for (const vi of g) {
      const v = mesh.verts[vi];
      if (v[0] < lox) lox = v[0]; if (v[0] > hix) hix = v[0];
      if (v[1] < loy) loy = v[1]; if (v[1] > hiy) hiy = v[1];
      if (v[2] < loz) loz = v[2]; if (v[2] > hiz) hiz = v[2];
    }
    if (!Number.isFinite(lox)) continue;
    boxes.push({ minX: lox, minY: loy, minZ: loz, maxX: hix, maxY: hiy, maxZ: hiz });
  }
  return boxes;
}

/** Every visible part's connected components, boxed in the flattened-mesh space
 *  (the SAME ground-lifted local coords the cooked mesh renders in). */
function collisionBoxesFromParts(parts: readonly CookPart[]): PropCollisionBox[] {
  const out: PropCollisionBox[] = [];
  for (const p of parts) {
    if (!p.visible) continue;
    for (const b of partCollisionBoxes(liftedMesh(p))) out.push(b);
  }
  return out;
}

function collisionFromBounds(b: CookBounds, parts: readonly CookPart[]): CookCollision {
  const width = b.size[0];
  const depth = b.size[2];
  return {
    footprintWidthMeters: width,
    footprintDepthMeters: depth,
    footprintRadiusMeters: Math.max(width, depth) / 2,
    heightMeters: b.size[1],
    boundsRadius: b.radius,
    boxes: collisionBoxesFromParts(parts),
  };
}

/** Gather every part's mounts into the model frame (lift baked into positions) —
 *  the rig factor (pivot + named joints/sockets, Part 0/6). */
function gatherMounts(parts: readonly CookPart[]): MountPoint[] {
  const out: MountPoint[] = [];
  for (const p of parts) {
    if (!p.visible) continue;
    for (const m of p.mesh.mounts ?? []) {
      out.push(p.lift ? { ...m, position: [m.position[0], m.position[1] + p.lift, m.position[2]] } : m);
    }
  }
  return out;
}

// ── per-kind validation (fail loud, never silently drop) ─────────────────────

/** Required-field violations for a prop descriptor — empty = valid. The cook
 *  ABORTS (errors non-empty) rather than ship an under-specified asset. */
export function validateProp(d: PropKindDefinition): string[] {
  const errors: string[] = [];
  if (!d.label) errors.push('prop needs a label');
  if (typeof d.solid !== 'boolean') errors.push('prop needs solid set');
  if (!(d.footprintRadiusMeters > 0)) errors.push('prop needs a footprint (measured 0 — the mesh is empty)');
  if (!(d.heightMeters > 0)) errors.push('prop needs a height (measured 0 — the mesh is empty)');
  if (!d.tileKind) errors.push('prop needs a tileKind (its gameplay-property donor)');
  if (d.container) {
    if (!(d.container.capacity > 0)) errors.push('a container prop needs capacity > 0');
    if (!d.container.access) errors.push('a container prop needs an access mode (open/locked/keyed)');
    if (!d.container.lootCategory) errors.push('a container prop needs a lootCategory');
    if (!(d.container.searchSeconds >= 0)) errors.push('a container prop needs searchSeconds');
  }
  if (d.seat) {
    if (!d.seat.pose) errors.push('a seat prop needs a pose (sit/lay)');
    if (!(d.seat.capacity > 0)) errors.push('a seat prop needs capacity > 0');
    if (typeof d.seat.seatHeightMeters !== 'number') errors.push('a seat prop needs seatHeightMeters');
  }
  if (d.dynamics) {
    if (!(d.dynamics.bodyRadiusMeters > 0)) errors.push('a physics prop needs a body radius (measured 0 — the mesh is empty)');
    if (!(d.dynamics.restitution >= 0 && d.dynamics.restitution <= 1)) errors.push('a physics prop needs restitution in 0..1');
  }
  return errors;
}

/** The per-kind validator table (rule of two — one place, every kind). */
export const cookValidators: Record<CookKind, (d: any) => string[]> = {
  prop: validateProp,
  // item / vehiclePart / vehicle / clothing land with their descriptors (Phase 7b–7d).
  item: () => ['item cook not implemented yet'],
  vehiclePart: () => ['vehicle-part cook not implemented yet'],
  vehicle: () => ['vehicle cook not implemented yet'],
  clothing: () => ['clothing cook not implemented yet'],
};

// ── the cook (prop, Phase 7a) ────────────────────────────────────────────────

function fillPropDescriptor(input: PropDescriptorInput, c: CookCollision, id: string, name: string): PropKindDefinition {
  return {
    // `kind` IS the asset id (the catalog/placement key) — a placed WorldProp's
    // `kind` is this id, and the registry overlay keys the descriptor under it, so
    // they MUST match. The display name is `label`, separate.
    kind: id as PropKindDefinition['kind'],
    label: input.label ?? name,
    solid: input.solid,
    // MEASURED from the mesh — never hand-typed (Guiding Light: derive, don't store twice).
    footprintRadiusMeters: c.footprintRadiusMeters,
    footprintWidthMeters: c.footprintWidthMeters,
    footprintDepthMeters: c.footprintDepthMeters,
    heightMeters: c.heightMeters,
    // SHAPE-AWARE collider (req_1587) — one box per component, so an archway's gap
    // stays walkable. Omitted when the cook produced none (degenerate/empty mesh).
    ...(c.boxes.length ? { collisionBoxes: c.boxes } : {}),
    tileKind: input.tileKind,
    trafficControl: input.trafficControl ?? 'none',
    // KICKABLE physics body: the bounce is authored, the body radius is MEASURED
    // from the footprint (derive, don't store twice) — matching the prop stack's
    // dynamics shape (a can/cone ≈ footprint radius; a drum a touch larger).
    ...(input.physics ? { dynamics: { bodyRadiusMeters: c.footprintRadiusMeters, restitution: input.physics.restitution } } : {}),
    ...(input.mount ? { mount: input.mount } : {}),
    ...(input.seat ? { seat: input.seat } : {}),
    ...(input.container ? { container: input.container } : {}),
    ...(input.coverClass ? { coverClass: input.coverClass } : {}),
  };
}

export type CookPropInput = {
  /** stable asset id — the catalog key (e.g. 'studio.barrel_red'). */
  id: string;
  name: string;
  parts: readonly CookPart[];
  /** → the compressed texture blob's hash (the Studio side cooks it via
   *  @reactjit/image and passes the hash). Absent = untextured. */
  texRef?: string;
  descriptor: PropDescriptorInput;
};

/** Cook a Studio model into a PROP asset. Pure: returns the asset record + the
 *  geometry factor to intern + any validation errors. The caller installs the
 *  blob + the asset only when `errors` is empty. */
export function cookProp(input: CookPropInput): CookResult {
  const blob = flattenModel(input.parts);
  const collision = collisionFromBounds(blob.bounds, input.parts);
  const descriptor = fillPropDescriptor(input.descriptor, collision, input.id, input.name);
  const mounts = gatherMounts(input.parts);
  const errors = validateProp(descriptor);
  // The asset IDENTITY hashes its factors by reference (mesh + texture by their
  // own content hash) + the descriptor — so identical input → identical hash
  // (idempotent re-cook), and a descriptor-only change keeps the shared blobs.
  const identity = JSON.stringify({
    id: input.id,
    meshRef: blob.hash,
    texRef: input.texRef ?? null,
    descriptor,
    mounts,
    slots: blob.slots ?? [],
    glass: blob.glass ?? null,
  });
  const asset: CookedAsset = {
    id: input.id,
    hash: hashString(identity),
    kind: 'prop',
    name: input.name,
    schema: COOK_SCHEMA,
    meshRef: blob.hash,
    ...(input.texRef ? { texRef: input.texRef } : {}),
    collision,
    mounts,
    ...(blob.slots ? { slots: blob.slots } : {}),
    ...(blob.glass ? { glass: blob.glass } : {}),
    descriptor,
  };
  return { asset, blob, errors };
}
