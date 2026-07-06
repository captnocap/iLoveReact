// render.ts - ASCII adapter for the compiled hmsc game data.
//
// This is the terminal twin of ../threeLoader/load.ts: decode stays owned by
// ../tsLoader/decode, while this file lowers the same flat scene data into a
// plain text viewport. No DOM, no Three, no host state.

import {
  loadSceneFromGameFile,
  loadSceneFromMapContainer,
  type LoadedScene,
} from '../tsLoader/decode';

const DEFAULT_COLS = 96;
const DEFAULT_ROWS = 36;
const MIN_COLS = 16;
const MIN_ROWS = 8;

const SHAPE = {
  BOX: 0,
  RAMP: 1,
  CYLINDER8: 2,
  CYLINDER16: 3,
  SPHERE: 4,
  GABLE: 5,
  GRASS: 6,
  BUSH: 7,
  FROND: 8,
  PALMTRUNK: 9,
  FLOWER: 10,
  SCENERY_BOX: 11,
  CORNER_MITER: 12,
  CORNER_MITER_MIRROR: 13,
  BOX_OPEN_RUN_MIN: 14,
  BOX_OPEN_RUN_MAX: 15,
  BOX_OPEN_RUN_BOTH: 16,
} as const;

export type AsciiScope = 'pieces' | 'instances';

export interface AsciiMapOptions {
  cols?: number;
  rows?: number;
  /** "pieces" frames the authored city rows; "instances" includes paint/foliage rows too. */
  scope?: AsciiScope;
  paddingMeters?: number;
  /** Prevent one enormous ground slab from spending the whole frame filling low-priority cells. */
  maxFootprintCells?: number;
}

export interface AsciiBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface AsciiMapStats {
  sceneInstances: number;
  pieceCount: number;
  projectedInstances: number;
  projectedFloraCells: number;
  skippedInstances: number;
  skippedOversizeSurfaces: number;
  heightfields: number;
  cols: number;
  rows: number;
  scope: AsciiScope;
}

export interface AsciiMapResult {
  lines: string[];
  bounds: AsciiBounds;
  stats: AsciiMapStats;
  legend: string[];
}

type CellMark = {
  ch: string;
  priority: number;
};

export const ASCII_MAP_LEGEND = [
  '. ground / road',
  '+ low prop',
  '# structure',
  'H tall building',
  '@ tower',
  '/ ramp',
  'o round primitive',
  '* foliage recipe or blade',
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function finite(n: number): boolean {
  return Number.isFinite(n);
}

function shapeAt(scene: LoadedScene, base: number): number {
  if (scene.instanceStride <= 12) return SHAPE.BOX;
  const raw = scene.instances[base + 12] ?? 0;
  return finite(raw) ? Math.round(raw) : SHAPE.BOX;
}

function rowLimit(scene: LoadedScene, scope: AsciiScope): number {
  if (scope === 'pieces' && scene.pieceCount > 0) {
    return Math.min(scene.pieceCount, scene.instanceCount);
  }
  return scene.instanceCount;
}

function boundsFor(scene: LoadedScene, scope: AsciiScope, paddingMeters: number): AsciiBounds {
  const stride = Math.max(1, scene.instanceStride);
  const limit = rowLimit(scene, scope);
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < limit; index += 1) {
    const base = index * stride;
    const x = scene.instances[base + 0] ?? 0;
    const z = scene.instances[base + 2] ?? 0;
    const sx = Math.abs(scene.instances[base + 6] ?? 1);
    const sz = Math.abs(scene.instances[base + 8] ?? 1);
    if (!finite(x) || !finite(z)) continue;
    const halfX = Math.max(0.25, sx * 0.5);
    const halfZ = Math.max(0.25, sz * 0.5);
    minX = Math.min(minX, x - halfX);
    minZ = Math.min(minZ, z - halfZ);
    maxX = Math.max(maxX, x + halfX);
    maxZ = Math.max(maxZ, z + halfZ);
  }

  if (!finite(minX) || !finite(minZ) || !finite(maxX) || !finite(maxZ)) {
    return { minX: -1, minZ: -1, maxX: 1, maxZ: 1 };
  }

  minX -= paddingMeters;
  minZ -= paddingMeters;
  maxX += paddingMeters;
  maxZ += paddingMeters;
  if (maxX - minX < 1) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (maxZ - minZ < 1) {
    minZ -= 0.5;
    maxZ += 0.5;
  }
  return { minX, minZ, maxX, maxZ };
}

function classify(scene: LoadedScene, base: number, shapeId: number): CellMark {
  const sx = Math.abs(scene.instances[base + 6] ?? 1);
  const sy = Math.abs(scene.instances[base + 7] ?? 1);
  const sz = Math.abs(scene.instances[base + 8] ?? 1);
  const footprint = Math.max(sx, sz);

  switch (shapeId) {
    case SHAPE.RAMP:
      return { ch: '/', priority: 5 };
    case SHAPE.CYLINDER8:
    case SHAPE.CYLINDER16:
    case SHAPE.SPHERE:
      return { ch: 'o', priority: sy > 3 ? 6 : 4 };
    case SHAPE.GRASS:
    case SHAPE.BUSH:
    case SHAPE.FROND:
    case SHAPE.PALMTRUNK:
    case SHAPE.FLOWER:
      return { ch: '*', priority: 2 };
    case SHAPE.GABLE:
    case SHAPE.CORNER_MITER:
    case SHAPE.CORNER_MITER_MIRROR:
    case SHAPE.BOX_OPEN_RUN_MIN:
    case SHAPE.BOX_OPEN_RUN_MAX:
    case SHAPE.BOX_OPEN_RUN_BOTH:
      return { ch: '#', priority: 7 };
    default:
      break;
  }

  if (sy <= 0.35 && footprint >= 2) return { ch: '.', priority: 1 };
  if (sy <= 1.25) return { ch: '+', priority: 3 };
  if (sy >= 24) return { ch: '@', priority: 9 };
  if (sy >= 10) return { ch: 'H', priority: 8 };
  if (sy >= 3) return { ch: '#', priority: 7 };
  return { ch: '+', priority: 4 };
}

function toCol(x: number, bounds: AsciiBounds, cols: number): number {
  const t = (x - bounds.minX) / (bounds.maxX - bounds.minX);
  return clamp(Math.floor(t * cols), 0, cols - 1);
}

function toRow(z: number, bounds: AsciiBounds, rows: number): number {
  const t = (z - bounds.minZ) / (bounds.maxZ - bounds.minZ);
  return rows - 1 - clamp(Math.floor(t * rows), 0, rows - 1);
}

function put(chars: string[], priorities: Int16Array, cols: number, row: number, col: number, mark: CellMark): boolean {
  const at = row * cols + col;
  if (mark.priority < priorities[at]) return false;
  priorities[at] = mark.priority;
  chars[at] = mark.ch;
  return true;
}

function putRect(
  chars: string[],
  priorities: Int16Array,
  cols: number,
  rows: number,
  bounds: AsciiBounds,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  mark: CellMark,
  maxFootprintCells: number,
): { painted: boolean; oversize: boolean } {
  let c0 = toCol(minX, bounds, cols);
  let c1 = toCol(maxX, bounds, cols);
  let r0 = toRow(maxZ, bounds, rows);
  let r1 = toRow(minZ, bounds, rows);
  if (c0 > c1) [c0, c1] = [c1, c0];
  if (r0 > r1) [r0, r1] = [r1, r0];
  const area = (c1 - c0 + 1) * (r1 - r0 + 1);
  if (area > maxFootprintCells && mark.priority <= 1) return { painted: false, oversize: true };

  let painted = false;
  if (area > maxFootprintCells) {
    const cx = Math.floor((c0 + c1) * 0.5);
    const cy = Math.floor((r0 + r1) * 0.5);
    painted = put(chars, priorities, cols, cy, cx, mark);
    return { painted, oversize: true };
  }

  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      painted = put(chars, priorities, cols, row, col, mark) || painted;
    }
  }
  return { painted, oversize: false };
}

function linesFrom(chars: string[], cols: number, rows: number): string[] {
  const lines: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const start = row * cols;
    lines.push(chars.slice(start, start + cols).join('').trimEnd());
  }
  return lines;
}

export function buildAsciiMap(scene: LoadedScene, opts: AsciiMapOptions = {}): AsciiMapResult {
  const cols = clamp(Math.floor(opts.cols ?? DEFAULT_COLS), MIN_COLS, 240);
  const rows = clamp(Math.floor(opts.rows ?? DEFAULT_ROWS), MIN_ROWS, 120);
  const scope = opts.scope ?? 'pieces';
  const bounds = boundsFor(scene, scope, opts.paddingMeters ?? 6);
  const stride = Math.max(1, scene.instanceStride);
  const limit = rowLimit(scene, scope);
  const chars = new Array<string>(cols * rows).fill(' ');
  const priorities = new Int16Array(cols * rows);
  priorities.fill(-1);
  const maxFootprintCells = opts.maxFootprintCells ?? Math.max(24, Math.floor(cols * rows * 0.18));

  let projectedInstances = 0;
  let projectedFloraCells = 0;
  let skippedInstances = 0;
  let skippedOversizeSurfaces = 0;

  for (let index = 0; index < limit; index += 1) {
    const base = index * stride;
    const x = scene.instances[base + 0] ?? 0;
    const z = scene.instances[base + 2] ?? 0;
    const sx = Math.abs(scene.instances[base + 6] ?? 1);
    const sz = Math.abs(scene.instances[base + 8] ?? 1);
    if (!finite(x) || !finite(z)) {
      skippedInstances += 1;
      continue;
    }

    const mark = classify(scene, base, shapeAt(scene, base));
    const halfX = Math.max(0.25, sx * 0.5);
    const halfZ = Math.max(0.25, sz * 0.5);
    const drawn = putRect(
      chars,
      priorities,
      cols,
      rows,
      bounds,
      x - halfX,
      z - halfZ,
      x + halfX,
      z + halfZ,
      mark,
      maxFootprintCells,
    );
    if (drawn.oversize) skippedOversizeSurfaces += 1;
    if (drawn.painted) projectedInstances += 1;
  }

  if (scene.flora) {
    const mark = { ch: '*', priority: 2 };
    for (const cell of scene.flora.cells) {
      if (!finite(cell.wx) || !finite(cell.wz)) continue;
      const col = toCol(cell.wx, bounds, cols);
      const row = toRow(cell.wz, bounds, rows);
      if (put(chars, priorities, cols, row, col, mark)) projectedFloraCells += 1;
    }
  }

  return {
    lines: linesFrom(chars, cols, rows),
    bounds,
    stats: {
      sceneInstances: scene.instanceCount,
      pieceCount: scene.pieceCount,
      projectedInstances,
      projectedFloraCells,
      skippedInstances,
      skippedOversizeSurfaces,
      heightfields: scene.heightfields.length,
      cols,
      rows,
      scope,
    },
    legend: ASCII_MAP_LEGEND.slice(),
  };
}

export function asciiFromMapContainer(bytes: Uint8Array, opts?: AsciiMapOptions): AsciiMapResult {
  return buildAsciiMap(loadSceneFromMapContainer(bytes), opts);
}

export function asciiFromGameFile(bytes: Uint8Array, opts?: AsciiMapOptions): AsciiMapResult {
  return buildAsciiMap(loadSceneFromGameFile(bytes), opts);
}
