import { mesh, type GeometryData, type Vec2, type Vec3 } from './_util';

export type VoxelMeshBlock = {
  x: number;
  y: number;
  z: number;
  kind?: string;
};

export type VoxelMeshParams = {
  blocks: VoxelMeshBlock[];
  cellSizeMeters?: number;
  displace?: number[];
  dCols?: number;
  dRows?: number;
  amount?: number;
};

type FaceDef = {
  key: string;
  n: Vec3;
  axis: 0 | 1 | 2;
  sign: 1 | -1;
  uAxis: 0 | 1 | 2;
  vAxis: 0 | 1 | 2;
};

type FaceCell = {
  block: VoxelMeshBlock;
  face: FaceDef;
  plane: number;
  u: number;
  v: number;
};

export type VoxelMeshStats = {
  quads: number;
  vertices: number;
  bounds: { min: Vec3; max: Vec3; size: Vec3 };
};

const FACES: FaceDef[] = [
  { key: 'xp', n: [1, 0, 0], axis: 0, sign: 1, uAxis: 2, vAxis: 1 },
  { key: 'xn', n: [-1, 0, 0], axis: 0, sign: -1, uAxis: 2, vAxis: 1 },
  { key: 'yp', n: [0, 1, 0], axis: 1, sign: 1, uAxis: 0, vAxis: 2 },
  { key: 'yn', n: [0, -1, 0], axis: 1, sign: -1, uAxis: 0, vAxis: 2 },
  { key: 'zp', n: [0, 0, 1], axis: 2, sign: 1, uAxis: 0, vAxis: 1 },
  { key: 'zn', n: [0, 0, -1], axis: 2, sign: -1, uAxis: 0, vAxis: 1 },
];

function key(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function blockCoord(block: VoxelMeshBlock, axis: 0 | 1 | 2): number {
  return axis === 0 ? block.x : axis === 1 ? block.y : block.z;
}

function facePlane(block: VoxelMeshBlock, face: FaceDef): number {
  return blockCoord(block, face.axis) + (face.sign > 0 ? 1 : 0);
}

function faceCell(block: VoxelMeshBlock, face: FaceDef): FaceCell {
  return {
    block,
    face,
    plane: facePlane(block, face),
    u: blockCoord(block, face.uAxis),
    v: blockCoord(block, face.vAxis),
  };
}

function bounds(blocks: VoxelMeshBlock[], cell: number): { min: Vec3; max: Vec3; center: Vec3; size: Vec3 } {
  if (blocks.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: [0, 0, 0] };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const block of blocks) {
    minX = Math.min(minX, block.x - 0.5);
    minY = Math.min(minY, block.y - 0.5);
    minZ = Math.min(minZ, block.z - 0.5);
    maxX = Math.max(maxX, block.x + 0.5);
    maxY = Math.max(maxY, block.y + 0.5);
    maxZ = Math.max(maxZ, block.z + 0.5);
  }
  const min: Vec3 = [minX * cell, minY * cell, minZ * cell];
  const max: Vec3 = [maxX * cell, maxY * cell, maxZ * cell];
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return { min, max, center, size };
}

function sampleDisplace(params: VoxelMeshParams, pos: Vec3, b: ReturnType<typeof bounds>): number {
  const grid = params.displace;
  const cols = Math.max(1, Math.round(params.dCols ?? 0));
  const rows = Math.max(1, Math.round(params.dRows ?? 0));
  if (!grid || grid.length < cols * rows || !(params.amount && params.amount !== 0)) return 0;
  const sx = b.size[0] > 1e-6 ? (pos[0] - b.min[0]) / b.size[0] : 0.5;
  const sy = b.size[1] > 1e-6 ? 1 - ((pos[1] - b.min[1]) / b.size[1]) : 0.5;
  const gx = Math.max(0, Math.min(cols - 1, Math.round(sx * (cols - 1))));
  const gy = Math.max(0, Math.min(rows - 1, Math.round(sy * (rows - 1))));
  return Math.max(-1, Math.min(1, Number(grid[gy * cols + gx] ?? 0))) * params.amount;
}

function point(raw: [number, number, number], normal: Vec3, params: VoxelMeshParams, b: ReturnType<typeof bounds>): Vec3 {
  const c: Vec3 = [raw[0] - b.center[0], raw[1] - b.center[1], raw[2] - b.center[2]];
  const d = sampleDisplace(params, raw, b);
  return [c[0] + normal[0] * d, c[1] + normal[1] * d, c[2] + normal[2] * d];
}

function makeQuad(
  face: FaceDef,
  plane: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  cell: number,
  params: VoxelMeshParams,
  b: ReturnType<typeof bounds>,
): [Vec3, Vec3, Vec3, Vec3] {
  const p = (u: number, v: number): Vec3 => {
    const raw = [0, 0, 0] as [number, number, number];
    raw[face.axis] = (plane - 0.5) * cell;
    raw[face.uAxis] = (u - 0.5) * cell;
    raw[face.vAxis] = (v - 0.5) * cell;
    return point(raw, face.n, params, b);
  };
  const a = p(u0, v0);
  const b1 = p(u1, v0);
  const c = p(u1, v1);
  const d = p(u0, v1);
  return face.sign > 0 ? [a, b1, c, d] : [b1, a, d, c];
}

export function voxelMeshStats(params: VoxelMeshParams): VoxelMeshStats {
  const blocks = params.blocks ?? [];
  const cell = Math.max(0.001, Number(params.cellSizeMeters ?? 1));
  const b = bounds(blocks, cell);
  return {
    quads: greedyFaces(blocks).length,
    vertices: greedyFaces(blocks).length * 6,
    bounds: { min: b.min, max: b.max, size: b.size },
  };
}

function greedyFaces(blocks: VoxelMeshBlock[]): Array<{ face: FaceDef; plane: number; u0: number; v0: number; u1: number; v1: number }> {
  const occupied = new Set(blocks.map((b) => key(b.x, b.y, b.z)));
  const buckets = new Map<string, FaceCell[]>();
  for (const block of blocks) {
    for (const face of FACES) {
      const nx = block.x + face.n[0];
      const ny = block.y + face.n[1];
      const nz = block.z + face.n[2];
      if (occupied.has(key(nx, ny, nz))) continue;
      const cell = faceCell(block, face);
      const bucketKey = `${face.key}:${block.kind ?? 'voxel'}:${cell.plane}`;
      const arr = buckets.get(bucketKey) ?? [];
      arr.push(cell);
      buckets.set(bucketKey, arr);
    }
  }

  const out: Array<{ face: FaceDef; plane: number; u0: number; v0: number; u1: number; v1: number }> = [];
  for (const cells of buckets.values()) {
    const pending = new Set(cells.map((c) => `${c.u}:${c.v}`));
    const byKey = new Map(cells.map((c) => [`${c.u}:${c.v}`, c]));
    const sorted = cells.slice().sort((a, b) => a.v - b.v || a.u - b.u);
    for (const start of sorted) {
      const startKey = `${start.u}:${start.v}`;
      if (!pending.has(startKey)) continue;
      let width = 1;
      while (pending.has(`${start.u + width}:${start.v}`)) width++;
      let height = 1;
      outer: while (true) {
        for (let du = 0; du < width; du++) {
          if (!pending.has(`${start.u + du}:${start.v + height}`)) break outer;
        }
        height++;
      }
      for (let dv = 0; dv < height; dv++) {
        for (let du = 0; du < width; du++) pending.delete(`${start.u + du}:${start.v + dv}`);
      }
      const first = byKey.get(startKey)!;
      out.push({ face: first.face, plane: first.plane, u0: start.u, v0: start.v, u1: start.u + width, v1: start.v + height });
    }
  }
  return out;
}

export const VOXEL_MESH_DEFAULTS: VoxelMeshParams = Object.freeze({
  blocks: [],
  cellSizeMeters: 1,
  amount: 0,
});

export function generate(params: VoxelMeshParams): GeometryData {
  const blocks = params.blocks ?? [];
  const cell = Math.max(0.001, Number(params.cellSizeMeters ?? 1));
  const b = bounds(blocks, cell);
  const m = mesh();
  for (const q of greedyFaces(blocks)) {
    const [a, c, d, e] = makeQuad(q.face, q.plane, q.u0, q.v0, q.u1, q.v1, cell, params, b);
    m.face(a, c, d, e, q.face.n, [0.5, 0.5] as Vec2);
  }
  return m.build();
}
