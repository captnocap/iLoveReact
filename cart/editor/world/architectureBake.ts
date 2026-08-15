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
import { architectureHostLive } from '../../../runtime/game/build';
import type { MeshRef, ResidentMesh } from './meshProps';

const BUNDLE_MAGIC = 0x42414a52; // "RJAB" little-endian
const BUNDLE_VERSION = 1;
const WALL_SECTION_VERSION = 1;
const WALL_FAMILY_TAG = 0; // types.ArchitectureFamily.wall

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

type LiveArchitecture = {
  source: ArchitectureSource | null;
  meshes: ResidentMesh[];
  refs: MeshRef[];
  collideRows: number[];
};

let LIVE: LiveArchitecture = { source: null, meshes: [], refs: [], collideRows: [] };

/** Compile the source through the engine and stage its live bake. Identity-cached
 * on the retained source object, so the viewport refreshes it cheaply right
 * before every push. Never throws: a compile/decode failure clears the stage and
 * reports loudly — a silent stale wall is worse than a missing one. */
export function setLiveArchitecture(source: ArchitectureSource): void {
  if (LIVE.source === source) return;
  if (!architectureHostLive() || source.walls.edges.length === 0) {
    // req_4476 diagnostic: a capability-absent host silently rendering zero
    // walls is indistinguishable from every other blank — say it.
    if (source.walls.edges.length > 0) {
      console.warn(`[architecture] live bake SKIPPED — host capability absent; ${source.walls.edges.length} edge(s) will not render live`);
    }
    LIVE = { source, meshes: [], refs: [], collideRows: [] };
    return;
  }
  try {
    const bundle = architectureHost.compile(source);
    const bands = decodeWallRenderBands(bundle);
    const byRole = new Map<WallRenderBand['role'], WallRenderBand[]>();
    for (const band of bands) {
      const group = byRole.get(band.role);
      if (group) group.push(band);
      else byRole.set(band.role, [band]);
    }
    const meshes: ResidentMesh[] = [];
    const refs: MeshRef[] = [];
    for (const [role, group] of byRole) {
      // The revision is part of the key (req_4477): scene3d interns geometry
      // IMMUTABLY per geom key (generation bumps exist only for the studio's
      // single edit mesh), so pushing grown wall bands under a stable key drew
      // the FIRST bake forever — walls only appeared after a loader remount
      // reset the intern cache. Each committed revision is new immutable
      // content and takes a fresh key, exactly the contract facades satisfy
      // with one key per facade. Cost: a stale intern entry per superseded
      // revision until the next loader remount (2048-entry cache; dev reloads
      // remount constantly). The engine-side cure — mutable resident-mesh
      // generations keyed per hash — is a named follow-up capability.
      const key = `arch:wall:${role}:r${source.revision}`;
      meshes.push({
        key,
        vertices: bandVertices(group),
        color: ROLE_COLORS[role],
        solid: false,
      });
      refs.push({ key, x: 0, y: 0, z: 0, yaw: 0 });
    }
    LIVE = { source, meshes, refs, collideRows: collideRows(source, bands) };
    console.warn(`[architecture] live bake: ${source.walls.edges.length} edge(s) → ${bands.length} band(s) → ${meshes.length} mesh(es), ${LIVE.collideRows.length / 12} collide row(s)`);
  } catch (error) {
    console.error(`[architecture] live wall bake FAILED — walls not rendered: ${error instanceof Error ? error.message : String(error)}`);
    LIVE = { source, meshes: [], refs: [], collideRows: [] };
  }
}

export function clearLiveArchitecture(): void {
  LIVE = { source: null, meshes: [], refs: [], collideRows: [] };
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
