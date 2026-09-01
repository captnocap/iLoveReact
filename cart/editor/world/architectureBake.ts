// Live semantic-wall bake: engine compile bundle → resident draw meshes plus
// collide-only instance rows, registered exactly like the facade pattern.
//
// This module DECODES the engine's canonical RJAB wall section — it never
// derives topology or geometry. Draw geometry is the engine's world-space
// render-band quads verbatim; collision is the same quads extruded by the
// edge's AUTHORED thickness into oriented collide-only rows (r < 0), so
// doorway voids stay open at any wall angle. The resident meshes are marked
// draw-only (solid:false) so mesh-island welding never seals an opening.
import { ARCHITECTURE_UNITS_PER_METER, type ArchitectureSource } from './architecture';
import { architectureHost } from './architectureHost';
import { openingWorldPose } from './openingTools';
import { architectureHostLive } from '../../../runtime/game/build';
import type { MeshRef, ResidentMesh } from './meshProps';
import { liveMaterialForId, type LiveMaterial } from './pieceSkins';
import { skinnedPieceId } from './authoredRegistry';
import { EMPTY_WORLD_FINISHES, type WorldFinishes } from './worldFinishes';
import { pickFloorTriangleHit } from './floorPick';
import { bandSurfaceId, pushWallSurfaceFinishes, surfaceFinishForId } from './surfaceFinishes';

/** Wall-clock ms. NOT performance.now(): the runtime shims it to the host's
 * __jsTick timestamp, which is FROZEN for the whole tick — every intra-tick
 * phase would read 0.0. V8's real Date.now() resolves the sub-tick phases this
 * once-per-placement attribution needs. */
export function nowMs(): number {
  return Date.now();
}

const BUNDLE_MAGIC = 0x42414a52; // "RJAB" little-endian
const BUNDLE_VERSION = 1;
const WALL_SECTION_VERSION = 1;
const WALL_FAMILY_TAG = 0; // types.ArchitectureFamily.wall
const FLOOR_SECTION_VERSION = 1;
const FLOOR_FAMILY_TAG = 1; // types.ArchitectureFamily.floor

export type WallRenderBand = {
  floor: number;
  edgeId: string;
  openingId?: string;
  role: 'face' | 'reveal' | 'jamb' | 'sill' | 'header' | 'cap' | 'end' | 'pane';
  side?: 'a' | 'b';
  materialId: string;
  columnStartU: number;
  columnEndU: number;
  rowBottomU: number;
  rowTopU: number;
  /** World-space meters, engine-emitted. */
  quad: readonly [number, number, number][];
  normal: [number, number, number];
  uv: readonly [number, number][];
};

const ROLE_NAMES = ['face', 'reveal', 'jamb', 'sill', 'header', 'cap', 'end', 'pane'] as const;

/** One engine-derived floor plate triangle (req_4482): floors are DERIVED from
 * enclosed rooms and react to every wall edit — nothing here is authored. */
export type FloorTriangle = {
  faceSignature: string;
  floor: number;
  role: 'top' | 'bottom' | 'rim';
  materialId: string;
  /** World-space meters, engine-emitted, winding already matches the normal. */
  corners: readonly [number, number, number][];
  normal: [number, number, number];
  uv: readonly [number, number][];
};

const FLOOR_ROLE_NAMES = ['top', 'bottom', 'rim'] as const;

class BundleReader {
  private view: DataView;
  private cursor = 0;
  constructor(private bytes: Uint8Array, offset = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.cursor = offset;
  }
  at(): number { return this.cursor; }
  seek(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.bytes.length) throw new Error(`bundle seek ${offset} is outside ${this.bytes.length} bytes`);
    this.cursor = offset;
  }
  private need(bytes: number): number {
    const at = this.cursor;
    if (at + bytes > this.bytes.length) throw new Error(`bundle truncated at ${at}+${bytes}/${this.bytes.length}`);
    this.cursor += bytes;
    return at;
  }
  u8(): number { return this.view.getUint8(this.need(1)); }
  u16(): number { return this.view.getUint16(this.need(2), true); }
  u32(): number { return this.view.getUint32(this.need(4), true); }
  i32(): number { return this.view.getInt32(this.need(4), true); }
  f32(): number { return this.view.getFloat32(this.need(4), true); }
  length(): number {
    const value = this.view.getBigUint64(this.need(8), true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('bundle length exceeds the safe integer range');
    return Number(value);
  }
  skip(bytes: number): void { this.need(bytes); }
  text(): string {
    const length = this.length();
    const at = this.need(length);
    let out = '';
    for (let index = 0; index < length; index += 1) out += String.fromCharCode(this.bytes[at + index]!);
    return out;
  }
  optionalText(): string | undefined {
    const has = this.u8();
    if (has === 0) return undefined;
    if (has !== 1) throw new Error(`bundle optional-string flag ${has} is invalid`);
    return this.text();
  }
}

/** The bake keys carry this many hex chars of the bundle's source content hash
 * (64 bits). The intern cache holds at most 2048 entries per loader mount, so a
 * 64-bit prefix cannot realistically collide; the full 256-bit digest would
 * only make every key and log line longer. */
const BAKE_KEY_HASH_HEX_CHARS = 16;

/** The engine's canonical source content hash, from the bundle header (magic +
 * version + revision precede it). This is the bake-key identity (req_4492):
 * revision numbers REPEAT after undo — the engine mints `revision + 1` from
 * whatever source it is handed, and undo hands it an old one — so keying interned
 * geometry by revision aliased distinct content and resurrected undone walls.
 * Content-hash keys make aliasing impossible and dedup identical states. */
export function bundleSourceHashHex(bundle: Uint8Array): string {
  const reader = new BundleReader(bundle);
  if (reader.u32() !== BUNDLE_MAGIC) throw new Error('bundle magic is not RJAB');
  if (reader.u16() !== BUNDLE_VERSION) throw new Error('bundle version is unsupported');
  reader.u32(); // sourceRevision
  const start = reader.at();
  reader.skip(32); // the source hash — the compiler/tuning/catalog hashes follow
  let hex = '';
  for (let index = 0; index < BAKE_KEY_HASH_HEX_CHARS / 2; index += 1) {
    hex += bundle[start + index]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Strict fail-closed decode of the wall section's render bands. Everything
 * after the render bands belongs to other consumers and is left unread. */
export function decodeWallRenderBands(bundle: Uint8Array): WallRenderBand[] {
  const reader = new BundleReader(bundle);
  if (reader.u32() !== BUNDLE_MAGIC) throw new Error('bundle magic is not RJAB');
  if (reader.u16() !== BUNDLE_VERSION) throw new Error('bundle version is unsupported');
  reader.u32(); // sourceRevision
  reader.skip(32 * 4); // source/compiler/tuning/catalog hashes
  const sectionCount = reader.length();
  let wallOffset: number | null = null;
  for (let index = 0; index < sectionCount; index += 1) {
    const family = reader.u8();
    const version = reader.u16();
    const offset = reader.length();
    reader.length(); // byteLength
    reader.length(); // itemCount
    reader.skip(32); // section hash
    if (family === WALL_FAMILY_TAG) {
      if (version !== WALL_SECTION_VERSION) throw new Error('wall section version is unsupported');
      wallOffset = offset;
    }
  }
  if (wallOffset === null) return [];
  reader.seek(wallOffset);
  if (reader.u16() !== WALL_SECTION_VERSION) throw new Error('wall section header version mismatch');
  const bandCount = reader.length();
  const bands: WallRenderBand[] = [];
  for (let index = 0; index < bandCount; index += 1) {
    const floor = reader.i32();
    const edgeId = reader.text();
    const openingId = reader.optionalText();
    const roleTag = reader.u8();
    const role = ROLE_NAMES[roleTag];
    if (!role) throw new Error(`render band role tag ${roleTag} is invalid`);
    const sideTag = reader.u8();
    if (sideTag > 2) throw new Error(`render band side tag ${sideTag} is invalid`);
    const materialId = reader.text();
    const columnStartU = reader.i32();
    const columnEndU = reader.i32();
    const rowBottomU = reader.i32();
    const rowTopU = reader.i32();
    const quad: [number, number, number][] = [];
    for (let corner = 0; corner < 4; corner += 1) quad.push([reader.f32(), reader.f32(), reader.f32()]);
    const normal: [number, number, number] = [reader.f32(), reader.f32(), reader.f32()];
    const uv: [number, number][] = [];
    for (let corner = 0; corner < 4; corner += 1) uv.push([reader.f32(), reader.f32()]);
    bands.push({
      floor,
      edgeId,
      ...(openingId !== undefined ? { openingId } : {}),
      role,
      ...(sideTag !== 0 ? { side: (['a', 'b'] as const)[sideTag - 1] } : {}),
      materialId,
      columnStartU,
      columnEndU,
      rowBottomU,
      rowTopU,
      quad,
      normal,
      uv,
    });
  }
  return bands;
}

/** Strict fail-closed decode of the floor section's plate triangles. The floor
 * family owns its own bundle-directory entry, so this seeks directly. */
export function decodeFloorTriangles(bundle: Uint8Array): FloorTriangle[] {
  const reader = new BundleReader(bundle);
  if (reader.u32() !== BUNDLE_MAGIC) throw new Error('bundle magic is not RJAB');
  if (reader.u16() !== BUNDLE_VERSION) throw new Error('bundle version is unsupported');
  reader.u32(); // sourceRevision
  reader.skip(32 * 4); // source/compiler/tuning/catalog hashes
  const sectionCount = reader.length();
  let floorOffset: number | null = null;
  for (let index = 0; index < sectionCount; index += 1) {
    const family = reader.u8();
    const version = reader.u16();
    const offset = reader.length();
    reader.length(); // byteLength
    reader.length(); // itemCount
    reader.skip(32); // section hash
    if (family === FLOOR_FAMILY_TAG) {
      if (version !== FLOOR_SECTION_VERSION) throw new Error('floor section version is unsupported');
      floorOffset = offset;
    }
  }
  // Pre-floor bundles simply have no plates; absence is not an error.
  if (floorOffset === null) return [];
  reader.seek(floorOffset);
  if (reader.u16() !== FLOOR_SECTION_VERSION) throw new Error('floor section header version mismatch');
  const triangleCount = reader.length();
  const triangles: FloorTriangle[] = [];
  for (let index = 0; index < triangleCount; index += 1) {
    const faceSignature = reader.text();
    const floor = reader.i32();
    const roleTag = reader.u8();
    const role = FLOOR_ROLE_NAMES[roleTag];
    if (!role) throw new Error(`floor triangle role tag ${roleTag} is invalid`);
    const materialId = reader.text();
    const corners: [number, number, number][] = [];
    for (let corner = 0; corner < 3; corner += 1) corners.push([reader.f32(), reader.f32(), reader.f32()]);
    const normal: [number, number, number] = [reader.f32(), reader.f32(), reader.f32()];
    const uv: [number, number][] = [];
    for (let corner = 0; corner < 3; corner += 1) uv.push([reader.f32(), reader.f32()]);
    triangles.push({ faceSignature, floor, role, materialId, corners, normal, uv });
  }
  return triangles;
}

// Flat draw colors per surface role — placeholder look until wall materials
// resolve through the material system.
const ROLE_COLORS: Record<WallRenderBand['role'], [number, number, number]> = {
  face: [0.74, 0.73, 0.7],
  reveal: [0.62, 0.61, 0.58],
  jamb: [0.6, 0.59, 0.56],
  sill: [0.58, 0.57, 0.54],
  header: [0.58, 0.57, 0.54],
  cap: [0.66, 0.65, 0.62],
  end: [0.64, 0.63, 0.6],
  pane: [0.6, 0.7, 0.78],
};

function bandVertices(bands: readonly WallRenderBand[]): Float32Array {
  // ONE winding per quad, oriented to the engine's band normal (req_4478).
  // The facade double-winding trick is wrong here: a wall's two sides are
  // already distinct bands, so the mirrored copies only rendered the shell's
  // interior — faces that are unreachable in a sealed wall — and doubled the
  // triangle count for nothing.
  const FRONT = [[0, 1, 2], [0, 2, 3]] as const;
  const BACK = [[0, 2, 1], [0, 3, 2]] as const;
  const out = new Float32Array(bands.length * 2 * 3 * 8);
  let cursor = 0;
  for (const band of bands) {
    const [q0, q1, , q3] = [band.quad[0]!, band.quad[1]!, band.quad[2]!, band.quad[3]!];
    const ex = q1[0] - q0[0], ey = q1[1] - q0[1], ez = q1[2] - q0[2];
    const fx = q3[0] - q0[0], fy = q3[1] - q0[1], fz = q3[2] - q0[2];
    const wound = ((ey * fz - ez * fy) * band.normal[0])
      + ((ez * fx - ex * fz) * band.normal[1])
      + ((ex * fy - ey * fx) * band.normal[2]);
    const triangles = wound >= 0 ? FRONT : BACK;
    for (const triangle of triangles) {
      for (const corner of triangle) {
        const [x, y, z] = band.quad[corner]!;
        const [u, v] = band.uv[corner]!;
        out[cursor] = x; out[cursor + 1] = y; out[cursor + 2] = z;
        out[cursor + 3] = band.normal[0]; out[cursor + 4] = band.normal[1]; out[cursor + 5] = band.normal[2];
        out[cursor + 6] = u; out[cursor + 7] = v;
        cursor += 8;
      }
    }
  }
  return out;
}

// Floors read as cooler, darker plates against the warm wall grays.
const FLOOR_ROLE_COLORS: Record<FloorTriangle['role'], [number, number, number]> = {
  top: [0.56, 0.58, 0.6],
  bottom: [0.42, 0.43, 0.45],
  rim: [0.48, 0.5, 0.52],
};

/** Interleave floor triangles verbatim: the engine's winding already matches
 * each stored normal (proven native-side), so no reorientation happens here. */
function floorVertices(triangles: readonly FloorTriangle[]): Float32Array {
  const out = new Float32Array(triangles.length * 3 * 8);
  let cursor = 0;
  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      const [x, y, z] = triangle.corners[corner]!;
      const [u, v] = triangle.uv[corner]!;
      out[cursor] = x; out[cursor + 1] = y; out[cursor + 2] = z;
      out[cursor + 3] = triangle.normal[0]; out[cursor + 4] = triangle.normal[1]; out[cursor + 5] = triangle.normal[2];
      out[cursor + 6] = u; out[cursor + 7] = v;
      cursor += 8;
    }
  }
  return out;
}

function floorCollisionTriangles(triangles: readonly FloorTriangle[]): Float32Array {
  const tops = triangles.filter(triangle => triangle.role === 'top');
  const out = new Float32Array(tops.length * 9);
  let cursor = 0;
  for (const triangle of tops) {
    for (const corner of triangle.corners) {
      out[cursor] = corner[0]; out[cursor + 1] = corner[1]; out[cursor + 2] = corner[2];
      cursor += 3;
    }
  }
  return out;
}

function edgeThicknessMeters(source: ArchitectureSource, edgeId: string): number {
  const edge = source.walls.edges.find(candidate => candidate.id === edgeId);
  return (edge?.thicknessU ?? 4) / ARCHITECTURE_UNITS_PER_METER;
}

/** One oriented collide-only instance row per side-A face band: the engine's
 * world quad extruded inward by the edge's authored thickness. Voids have no
 * face band, so openings stay traversable. */
function collideRows(source: ArchitectureSource, bands: readonly WallRenderBand[]): number[] {
  const rows: number[] = [];
  for (const band of bands) {
    if (band.role !== 'face' || band.side !== 'a') continue;
    const [q0, q1, , q3] = [band.quad[0]!, band.quad[1]!, band.quad[2]!, band.quad[3]!];
    const ux = q1[0] - q0[0];
    const uz = q1[2] - q0[2];
    const width = Math.hypot(ux, uz);
    const height = Math.abs(q3[1] - q0[1]);
    if (width <= 0 || height <= 0) continue;
    const thickness = edgeThicknessMeters(source, band.edgeId);
    const centerX = (band.quad[0]![0] + band.quad[2]![0]) / 2 - band.normal[0] * (thickness / 2);
    const centerY = (band.quad[0]![1] + band.quad[2]![1]) / 2;
    const centerZ = (band.quad[0]![2] + band.quad[2]![2]) / 2 - band.normal[2] * (thickness / 2);
    const yawDegrees = (Math.atan2(-uz, ux) * 180) / Math.PI;
    rows.push(centerX, centerY, centerZ, 0, yawDegrees, 0, width, height, thickness, -1, -1, -1);
  }
  return rows;
}

/** The uv pairs of stride-8 interleaved vertices, as the standalone material-UV
 * array a live-material slot samples (the loader substitutes these when a slot
 * wears a "live-mat:<hash>" tile). Same pairs — the bands' meter-true UVs are
 * exactly the tiling a physical material wants. */
function materialUvsOf(vertices: Float32Array): Float32Array {
  const count = vertices.length / 8;
  const out = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    out[index * 2] = vertices[index * 8 + 6]!;
    out[index * 2 + 1] = vertices[index * 8 + 7]!;
  }
  return out;
}

type LiveArchitecture = {
  source: ArchitectureSource | null;
  /** kitId → measured housing depth (u) — the req_4491 deep-set seat data. */
  openingDepthsU: Readonly<Record<string, number>>;
  finishes: WorldFinishes;
  meshes: ResidentMesh[];
  refs: MeshRef[];
  collideRows: number[];
  /** the decoded floor plates — the right-click floor pick reads these. */
  floors: FloorTriangle[];
  /** every resolved wall/floor finish material, for the live-material push. */
  materials: LiveMaterial[];
};

let LIVE: LiveArchitecture = { source: null, openingDepthsU: {}, finishes: EMPTY_WORLD_FINISHES, meshes: [], refs: [], collideRows: [], floors: [], materials: [] };

/** Compile the source through the engine and stage its live bake. Identity-cached
 * on the retained source object (and the kit-depth map — a live kit install may
 * re-seat mounted doors), so the viewport refreshes it cheaply right before
 * every push. Never throws: a compile/decode failure clears the stage and
 * reports loudly — a silent stale wall is worse than a missing one. */
export function setLiveArchitecture(
  source: ArchitectureSource,
  openingDepthsU: Readonly<Record<string, number>>,
  finishes: WorldFinishes = EMPTY_WORLD_FINISHES,
): void {
  if (LIVE.source === source && LIVE.openingDepthsU === openingDepthsU && LIVE.finishes === finishes) return;
  if (!architectureHostLive() || source.walls.edges.length === 0) {
    // req_4476 diagnostic: a capability-absent host silently rendering zero
    // walls is indistinguishable from every other blank — say it.
    if (source.walls.edges.length > 0) {
      console.warn(`[architecture] live bake SKIPPED — host capability absent; ${source.walls.edges.length} edge(s) will not render live`);
    }
    LIVE = { source, openingDepthsU, finishes, meshes: [], refs: [], collideRows: [], floors: [], materials: [] };
    pushWallSurfaceFinishes([]);
    return;
  }
  try {
    const t0 = nowMs();
    const bundle = architectureHost.compile(source);
    const tCompile = nowMs();
    const sourceHash = bundleSourceHashHex(bundle);
    const bands = decodeWallRenderBands(bundle);
    const floors = decodeFloorTriangles(bundle);
    const tDecode = nowMs();
    // Material resolution (req_4739): a band's materialId that names a REAL
    // Skins-tab material (setSideFinish wrote an asset id) splits into its own
    // live-material mesh; everything else keeps the flat role placeholder.
    // Resolution is per distinct id, memoized across the bake.
    const materialCache = new Map<string, LiveMaterial | null>();
    const resolveFinish = (materialId: string): LiveMaterial | null => {
      if (!materialCache.has(materialId)) materialCache.set(materialId, liveMaterialForId(materialId));
      return materialCache.get(materialId) ?? null;
    };
    const materials = new Map<number, LiveMaterial>();
    const byRole = new Map<WallRenderBand['role'], WallRenderBand[]>();
    const byRoleMaterial = new Map<string, { role: WallRenderBand['role']; material: LiveMaterial; bands: WallRenderBand[] }>();
    // Surface Packages (req_4783/4785): install/refresh the projected
    // surfaces FIRST — the returned claim set tells the mesh grouping which
    // face bands the projected pipeline actually replaced. An unclaimed band
    // (host refused, pool full, degenerate quad) KEEPS its flat mesh, so a
    // failure degrades to the ordinary wall instead of a hole in the shell
    // (req_4786 — the silent dark face). Engine collide rows below stay
    // authoritative for gameplay either way (V24).
    const claimedSurfaceBands = pushWallSurfaceFinishes(bands);
    for (const band of bands) {
      // A CLAIMED face band's base draw is replaced by projected geometry —
      // never overlaid. Non-face roles (reveal/jamb/cap/end) keep their
      // ordinary meshes so the wall body stays sealed behind the displaced
      // face; an unclaimed surface-finish band falls through to the role
      // placeholder (a `surface:` id resolves to no live material).
      if (band.role === 'face' && surfaceFinishForId(band.materialId) && claimedSurfaceBands.has(bandSurfaceId(band))) continue;
      const material = resolveFinish(band.materialId);
      if (material) {
        materials.set(material.hash, material);
        const groupKey = `${band.role}:${material.hash}`;
        const group = byRoleMaterial.get(groupKey);
        if (group) group.bands.push(band);
        else byRoleMaterial.set(groupKey, { role: band.role, material, bands: [band] });
        continue;
      }
      const group = byRole.get(band.role);
      if (group) group.push(band);
      else byRole.set(band.role, [band]);
    }
    const meshes: ResidentMesh[] = [];
    const refs: MeshRef[] = [];
    for (const [role, group] of byRole) {
      // The source CONTENT HASH is part of the key: scene3d interns geometry
      // IMMUTABLY per geom key (generation bumps exist only for the studio's
      // single edit mesh), so a stable key drew the FIRST bake forever
      // (req_4477), and a REUSABLE counter aliased distinct content — undo
      // rewinds `source.revision`, the next edit re-mints an already-used
      // number, and the intern cache served the pre-undo walls back (req_4492:
      // the undone wall resurrected on the next draw). The engine's canonical
      // source hash IS the content identity, so undo/redo land on the exact
      // geometry they name and identical states dedup instead of re-interning.
      // Cost: a stale intern entry per superseded state until the next loader
      // remount (2048-entry cache; dev reloads remount constantly). The
      // engine-side cure — mutable resident-mesh generations keyed per hash —
      // is a named follow-up capability.
      const key = `arch:wall:${role}:s${sourceHash}`;
      meshes.push({
        key,
        vertices: bandVertices(group),
        color: ROLE_COLORS[role],
        solid: false,
      });
      refs.push({ key, x: 0, y: 0, z: 0, yaw: 0 });
    }
    for (const { role, material, bands: group } of byRoleMaterial.values()) {
      // A finished surface is ONE slot spanning the whole mesh whose ref wears
      // the material hash — the exact per-slot override lane placed props use
      // (runtime_live_scene): the slot samples the "live-mat:<hash>" tile
      // through materialUvs, here the bands' meter-true UVs.
      const vertices = bandVertices(group);
      const key = `arch:wall:${role}:m${material.hash.toString(16)}:s${sourceHash}`;
      meshes.push({
        key,
        vertices,
        materialUvs: materialUvsOf(vertices),
        color: ROLE_COLORS[role],
        slots: [{ start: 0, count: vertices.length / 8 }],
        solid: false,
      });
      refs.push({ key, x: 0, y: 0, z: 0, yaw: 0, materials: [material.hash] });
    }
    // Derived floors (req_4482) wear their EDITOR-owned finish (req_4739): the
    // per-room signature → asset map replaces the engine's placeholder id.
    const floorsByRole = new Map<string, { role: FloorTriangle['role']; material: LiveMaterial | null; triangles: FloorTriangle[] }>();
    for (const triangle of floors) {
      const finishId = finishes.floors[triangle.faceSignature];
      const material = finishId ? resolveFinish(finishId) : null;
      if (material) materials.set(material.hash, material);
      const groupKey = material ? `${triangle.role}:${material.hash}` : triangle.role;
      const group = floorsByRole.get(groupKey);
      if (group) group.triangles.push(triangle);
      else floorsByRole.set(groupKey, { role: triangle.role, material, triangles: [triangle] });
    }
    const floorFaces = new Set(floors.map(triangle => triangle.faceSignature));
    for (const { role, material, triangles: group } of floorsByRole.values()) {
      // Same content-hash-keyed immutable-intern law as the wall meshes above.
      const vertices = floorVertices(group);
      const key = material
        ? `arch:floor:${role}:m${material.hash.toString(16)}:s${sourceHash}`
        : `arch:floor:${role}:s${sourceHash}`;
      meshes.push({
        key,
        vertices,
        color: FLOOR_ROLE_COLORS[role],
        ...(material ? { materialUvs: materialUvsOf(vertices), slots: [{ start: 0, count: vertices.length / 8 }] } : {}),
        // The walkable top carries exact triangle narrowphase; that path
        // requires solid (physics.zig gates on it) and demotes the mesh's
        // welded islands to camera-only rows. Bottom/rim stay draw-only.
        ...(role === 'top'
          ? { solid: true, collisionTriangles: floorCollisionTriangles(group) }
          : { solid: false }),
      });
      refs.push({ key, x: 0, y: 0, z: 0, yaw: 0, ...(material ? { materials: [material.hash] } : {}) });
    }
    // Every placed opening MOUNTS its kit's model in the cut (req_4526 — "why
    // did we just cut out a piece of the wall but there is no door"): one ref
    // per opening against the `opening:<kitId>` resident the demand lane keeps
    // hot. A door-edit resident swings its leaf on approach; the engine's
    // collide rows already leave the void open around it.
    let mounted = 0;
    for (const edge of source.walls.edges) {
      if (edge.openings.length === 0 || edge.support.kind !== 'absolute') continue;
      const startVertex = source.walls.vertices.find(vertex => vertex.id === edge.startVertexId);
      const endVertex = source.walls.vertices.find(vertex => vertex.id === edge.endVertexId);
      if (!startVertex || !endVertex) continue;
      for (const opening of edge.openings) {
        // Seat law (req_4491): flush with the facing side at the kit's measured
        // housing depth. An unknown kit (catalog gap) seats at the wall's own
        // thickness → offset 0 → the old centered mount, never a wrong shove.
        const kitDepthU = openingDepthsU[opening.kitId] ?? edge.thicknessU;
        const pose = openingWorldPose(
          { xM: startVertex.xU / ARCHITECTURE_UNITS_PER_METER, zM: startVertex.zU / ARCHITECTURE_UNITS_PER_METER },
          { xM: endVertex.xU / ARCHITECTURE_UNITS_PER_METER, zM: endVertex.zU / ARCHITECTURE_UNITS_PER_METER },
          edge.support.baseYU / ARCHITECTURE_UNITS_PER_METER,
          { columnU: opening.columnU, rowU: opening.rowU },
          opening.facingSide,
          { wallThicknessU: edge.thicknessU, kitDepthU },
        );
        if (!pose) continue;
        // Wardrobe (req_4739): a chosen stored painting swaps the mount to the
        // kit's `opening:<kitId>#p<skinId>` resident — the same skin residents
        // the demand lane already cooks for the kit's package. An id whose
        // resident never cooked draws nothing; the cook path already says why.
        const skinId = finishes.openings[opening.id];
        const key = skinId ? skinnedPieceId(`opening:${opening.kitId}`, skinId) : `opening:${opening.kitId}`;
        refs.push({ key, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yawDegrees });
        mounted += 1;
      }
    }
    if (mounted) console.warn(`[architecture] ${mounted} opening kit model(s) mounted in their cuts`);
    const tMesh = nowMs();
    LIVE = { source, openingDepthsU, finishes, meshes, refs, collideRows: collideRows(source, bands), floors, materials: [...materials.values()] };
    const tDone = nowMs();
    // One aggregate line per bake (V27: per-placement, never per-frame) so a
    // slow placement attributes to a phase instead of an opaque jsTick.
    console.warn(`[architecture] live bake: ${source.walls.edges.length} edge(s) → ${bands.length} band(s) + ${floors.length} floor tri(s) in ${floorFaces.size} room(s) → ${meshes.length} mesh(es), ${LIVE.collideRows.length / 12} collide row(s) | compile=${(tCompile - t0).toFixed(1)}ms decode=${(tDecode - tCompile).toFixed(1)}ms mesh=${(tMesh - tDecode).toFixed(1)}ms collide=${(tDone - tMesh).toFixed(1)}ms`);
  } catch (error) {
    console.error(`[architecture] live wall bake FAILED — walls not rendered: ${error instanceof Error ? error.message : String(error)}`);
    LIVE = { source, openingDepthsU, finishes, meshes: [], refs: [], collideRows: [], floors: [], materials: [] };
    pushWallSurfaceFinishes([]);
  }
}

export function clearLiveArchitecture(): void {
  LIVE = { source: null, openingDepthsU: {}, finishes: EMPTY_WORLD_FINISHES, meshes: [], refs: [], collideRows: [], floors: [], materials: [] };
  pushWallSurfaceFinishes([]);
}

export function liveArchitectureResidentMeshes(): ResidentMesh[] {
  return LIVE.meshes;
}

export function liveArchitectureRefs(): MeshRef[] {
  return LIVE.refs;
}

export function liveArchitectureCollideRows(): number[] {
  return LIVE.collideRows;
}

/** Every resolved wall/floor finish material — pushed once per world push via
 * __compiled_world_set_live_material alongside the placed pieces' skins. */
export function liveArchitectureMaterials(): LiveMaterial[] {
  return LIVE.materials;
}

/** The right-click floor pick (req_4739): nearest derived floor plate under the
 * ray, from the SAME engine-emitted triangles the world renders. */
export function pickLiveFloorAt(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
): { faceSignature: string; t: number } | null {
  return pickFloorTriangleHit(origin, dir, LIVE.floors);
}
