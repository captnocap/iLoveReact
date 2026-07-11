// world/meshProps.ts — the editor's bridge to the host's live MESH-PROP path
// (req_2577/2579). An authored build piece is a real mesh; to draw it in the
// world loader we (1) register its vertex geometry as a RESIDENT mesh (a
// MESH_PROPS lump), then (2) push a live mesh REF per placement that points at
// that resident mesh by a hash of its key. Both host doors already exist
// (__compiled_world_set_resident_meshes / _set_live_mesh_props / _mesh_ghost),
// so this is a pure JS bridge — no framework rebuild.
//
// The lump byte format is the host decoder's contract verbatim
// (framework/world/constructor.zig decodeMeshProps, MESH_PROPS_VERSION 8). We
// write the mesh-only form (instanceCount 0) at version 7. A mesh with a painted
// atlas embeds its PNG in the v4+ pngLen block — the loader decodes it with stbi
// and the placement renders painted, exactly like a baked cooked prop (req_2832:
// an exported model lost its paintings at placement). Door exports additionally
// carry one named leaf slot + the v6 door block and portal-preserving authored
// frame boxes in the v7 collision block. Ordinary editor models use that same
// v7 block for Outliner-part collision bands, so a rising bridge is not reduced
// to one floor-to-peak AABB.
// The ref hash is FNV-1a over the mesh key, the SAME hash the loader
// keys residency on (world_loader.zig liveMeshHash).

/** FNV-1a 32-bit — MUST match world_loader.zig liveMeshHash so a key resolves to
 *  the same resident mesh on both sides. */
export function meshKeyHash(key: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export type ResidentMesh = {
  key: string;
  /** interleaved package vertices, stride 8: pos3 + normal3 + uv2. */
  vertices: Float32Array;
  /** flat draw colour 0..1 (untextured meshes render with this). */
  color?: [number, number, number];
  /** the model's painted atlas as ENCODED PNG bytes — absent = untextured (flat colour). */
  png?: Uint8Array;
  /** Contiguous vertex sub-ranges. Door exports use one trailing leaf slot. */
  slots?: { start: number; count: number }[];
  /** MESH_PROPS v6 two-state panel declaration; leafSlot indexes `slots`. */
  door?: { leafSlot: number; reachMeters: number; vehicle: boolean; startOpen: boolean };
  /** Local-frame authored colliders: Outliner bands, or door jamb/header bands. */
  collisionBoxes?: ResidentCollisionBox[];
};

export type ResidentCollisionBox = {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
};

function boundsOf(v: Float32Array): { radius: number; w: number; d: number; h: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < v.length; i += 8) {
    const x = v[i]!, y = v[i + 1]!, z = v[i + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return { radius: 1, w: 1, d: 1, h: 1 };
  const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
  return { radius: Math.max(w, h, d) * 0.5 || 1, w: w || 1, d: d || 1, h: h || 1 };
}

const MESH_PROPS_VERSION = 7; // mesh-only form the host decoder accepts (<= 8)

/** Encode resident meshes into a MESH_PROPS lump for __compiled_world_set_resident_meshes.
 *  instanceCount 0 (a catalog, not a baked scene); a mesh with a painted atlas embeds
 *  its PNG, optional door slot/meta, and optional authored collision boxes.
 *  Empty list → a 12-byte header that clears residency. */
export function encodeResidentMeshes(meshes: readonly ResidentMesh[]): Uint8Array {
  // Size pass.
  let total = 12; // header
  for (const m of meshes) {
    const slots = m.slots ?? [];
    const boxes = m.collisionBoxes ?? [];
    const vertexCount = m.vertices.length / 8;
    if (!Number.isInteger(vertexCount)) throw new Error(`resident mesh '${m.key}' is not stride-8 geometry`);
    for (const slot of slots) {
      if (!Number.isInteger(slot.start) || !Number.isInteger(slot.count) || slot.start < 0 || slot.count <= 0 || slot.start + slot.count > vertexCount) {
        throw new Error(`resident mesh '${m.key}' has a slot outside its ${vertexCount} vertices`);
      }
    }
    if (m.door && (m.door.leafSlot < 0 || m.door.leafSlot >= slots.length)) {
      throw new Error(`resident door '${m.key}' leaf slot ${m.door.leafSlot} is outside ${slots.length} slot(s)`);
    }
    for (const box of boxes) {
      const values = [box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ];
      if (!values.every(Number.isFinite) || box.maxX <= box.minX || box.maxY <= box.minY || box.maxZ <= box.minZ) {
        throw new Error(`resident mesh '${m.key}' has an invalid authored collision box`);
      }
    }
    const keyBytes = m.key.length; // keys are ASCII ids
    total += 4 + keyBytes;         // keyLen + key
    total += 36;                   // meta
    total += m.vertices.length * 4; // vertices
    total += 4 + (m.png?.length ?? 0); // pngLen + encoded PNG bytes
    total += 4 + slots.length * 8; // slotCount + start/count rows
    total += 4 + (m.door ? 16 : 0); // doorFlag + optional door block
    total += 4 + boxes.length * 24; // boxCount + 6×f32 rows
  }
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  dv.setUint32(0, MESH_PROPS_VERSION, true);
  dv.setUint32(4, meshes.length, true);
  dv.setUint32(8, 0, true); // instanceCount
  let o = 12;
  for (const m of meshes) {
    dv.setUint32(o, m.key.length, true); o += 4;
    for (let i = 0; i < m.key.length; i += 1) bytes[o + i] = m.key.charCodeAt(i) & 0xff;
    o += m.key.length;
    const b = boundsOf(m.vertices);
    const col = m.color ?? [0.72, 0.74, 0.78];
    const vertexCount = Math.floor(m.vertices.length / 8);
    dv.setFloat32(o, col[0], true); dv.setFloat32(o + 4, col[1], true); dv.setFloat32(o + 8, col[2], true);
    dv.setFloat32(o + 12, b.radius, true);
    dv.setFloat32(o + 16, b.w, true);
    dv.setFloat32(o + 20, b.d, true);
    dv.setFloat32(o + 24, b.h, true);
    dv.setUint32(o + 28, 1, true);            // solid
    dv.setUint32(o + 32, vertexCount, true);  // vertexCount
    o += 36;
    for (let i = 0; i < m.vertices.length; i += 1) { dv.setFloat32(o, m.vertices[i]!, true); o += 4; }
    dv.setUint32(o, m.png?.length ?? 0, true); o += 4; // pngLen
    if (m.png && m.png.length > 0) { bytes.set(m.png, o); o += m.png.length; }
    const slots = m.slots ?? [];
    dv.setUint32(o, slots.length, true); o += 4;
    for (const slot of slots) {
      dv.setUint32(o, slot.start, true);
      dv.setUint32(o + 4, slot.count, true);
      o += 8;
    }
    dv.setUint32(o, m.door ? 1 : 0, true); o += 4;
    if (m.door) {
      dv.setUint32(o, m.door.leafSlot, true);
      dv.setFloat32(o + 4, m.door.reachMeters, true);
      dv.setUint32(o + 8, m.door.vehicle ? 1 : 0, true);
      dv.setUint32(o + 12, m.door.startOpen ? 1 : 0, true);
      o += 16;
    }
    const boxes = m.collisionBoxes ?? [];
    dv.setUint32(o, boxes.length, true); o += 4;
    for (const box of boxes) {
      dv.setFloat32(o, box.minX, true);
      dv.setFloat32(o + 4, box.minY, true);
      dv.setFloat32(o + 8, box.minZ, true);
      dv.setFloat32(o + 12, box.maxX, true);
      dv.setFloat32(o + 16, box.maxY, true);
      dv.setFloat32(o + 20, box.maxZ, true);
      o += 24;
    }
  }
  return bytes;
}

export type MeshRef = { key: string; x: number; y: number; z: number; yaw: number };
const MESH_REF_HEADER_BYTES = 24; // u32 hash, f32 x,y,z,yaw, u32 matCount

/** Pack one live mesh ref (no per-slot materials → the mesh's own look). */
export function encodeMeshGhost(ref: MeshRef): Uint8Array {
  const buf = new ArrayBuffer(MESH_REF_HEADER_BYTES);
  const dv = new DataView(buf);
  dv.setUint32(0, meshKeyHash(ref.key), true);
  dv.setFloat32(4, ref.x, true);
  dv.setFloat32(8, ref.y, true);
  dv.setFloat32(12, ref.z, true);
  dv.setFloat32(16, ref.yaw, true);
  dv.setUint32(20, 0, true); // matCount
  return new Uint8Array(buf);
}

/** Pack all placed mesh refs into one contiguous buffer (24 bytes each, no mats). */
export function encodeMeshRefs(refs: readonly MeshRef[]): Uint8Array {
  const buf = new ArrayBuffer(refs.length * MESH_REF_HEADER_BYTES);
  const dv = new DataView(buf);
  let o = 0;
  for (const r of refs) {
    dv.setUint32(o, meshKeyHash(r.key), true);
    dv.setFloat32(o + 4, r.x, true);
    dv.setFloat32(o + 8, r.y, true);
    dv.setFloat32(o + 12, r.z, true);
    dv.setFloat32(o + 16, r.yaw, true);
    dv.setUint32(o + 20, 0, true);
    o += MESH_REF_HEADER_BYTES;
  }
  return new Uint8Array(buf);
}
