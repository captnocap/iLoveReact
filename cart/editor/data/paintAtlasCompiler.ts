// editor/data/paintAtlasCompiler.ts — explicit, rebuildable model-skin atlas compile.
//
// The files a user edits remain independent sources:
//   atlases/base.png + mesh/painted.blob
//   paints/paint_<id>.png + paints/paint_<id>.blob
//
// Compile packs their UV-addressable rectangles into ONE lossless PNG and rewrites
// copies of their mesh UVs to point at the assigned atlas locations. Source files are
// never changed or removed. The derived files are content-addressed; a small mutable
// manifest is the commit point and may become stale as more variants are added.
import {
  exists,
  listDir,
  readFile,
  readFileBase64,
  remove,
  stat,
  writeFileBytesAtomic,
} from '../../../runtime/hooks/fs';
import { encode as encodeImage, image } from '../../../runtime/image';
import { base64ToBytes, textBytes } from '../../../runtime/workspace/lumps';
import { sha256Hex } from '../../../runtime/workspace/sha256';
import {
  listPaintVariants,
  paintSkinFitsCurrentMesh,
  PAINT_MESH_VERTEX_BYTES,
  PAINT_MESH_VERTEX_FLOATS,
  type PaintTarget,
  type PaintVariant,
} from './paintVariants';
import { resolvePackageDir } from './modelPackageStore';

const host = globalThis as any;

/** Every behavior-affecting atlas choice lives here rather than inside the packer. */
export const PAINT_ATLAS_COMPILE_TUNING = {
  // Matches framework/gpu/paint_islands.zig and the save-time coverage raster.
  coverageGutterTexels: 2,
  // Conservative bounds around pixel-center triangle coverage.
  boundsSafetyTexels: 1,
  // Edge extrusion keeps a tile's former clamp-to-edge behavior beside a neighbour.
  tileExtrusionTexels: 2,
  maxDimension: 8192,
  maxRgbaBytes: 256 * 1024 * 1024,
  widthSearchSamples: 96,
  unusedTexel: [200, 200, 205, 255] as const,
} as const;

export const PAINT_ATLAS_MANIFEST_FILE = 'paints/compiled-atlas.json';
const COMPILED_ATLAS_PREFIX = 'compiled-atlas-';
const COMPILED_MESH_PREFIX = 'compiled-mesh-';
const CONTENT_HASH_PATTERN = '[0-9a-f]{64}';
const COMPILED_ASSET_RE = new RegExp(
  `^(?:${COMPILED_ATLAS_PREFIX}${CONTENT_HASH_PATTERN}\\.png|${COMPILED_MESH_PREFIX}${CONTENT_HASH_PATTERN}\\.blob)$`,
);

type Rect = { x: number; y: number; w: number; h: number };

export type PaintAtlasPlanInput = {
  key: string;
  width: number;
  height: number;
  /** SHA-256 of the encoded source PNG. Equal pixels/files can share one tile. */
  pngHash: string;
  /** Interleaved position3 + normal3 + normalized uv2. */
  vertices: Float32Array;
};

export type PlannedPaintAtlasSource = {
  key: string;
  width: number;
  height: number;
  sourceRect: Rect;
  tileKey: string;
  atlasRect: Rect;
  packedRect: Rect;
};

export type PlannedPaintAtlasTile = {
  key: string;
  sourceKey: string;
  sourceRect: Rect;
  atlasRect: Rect;
  packedRect: Rect;
};

export type PaintAtlasPlan = {
  width: number;
  height: number;
  sources: PlannedPaintAtlasSource[];
  tiles: PlannedPaintAtlasTile[];
};

type PackRect = { key: string; w: number; h: number };
type PackedRect = PackRect & { x: number; y: number };
type SkylineNode = { x: number; y: number; width: number };

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function sourceUvBounds(input: PaintAtlasPlanInput): Rect {
  if (!positiveInteger(input.width) || !positiveInteger(input.height)) {
    throw new Error(`${input.key} has invalid source dimensions`);
  }
  if (input.vertices.length < PAINT_MESH_VERTEX_FLOATS * 3
    || input.vertices.length % PAINT_MESH_VERTEX_FLOATS !== 0) {
    throw new Error(`${input.key} has an invalid paint mesh`);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let vertex = 0; vertex < input.vertices.length; vertex += PAINT_MESH_VERTEX_FLOATS) {
    const u = input.vertices[vertex + 6]!;
    const v = input.vertices[vertex + 7]!;
    if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
      throw new Error(`${input.key} has a UV outside its source texture`);
    }
    const x = u * input.width;
    const y = v * input.height;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const expand = PAINT_ATLAS_COMPILE_TUNING.coverageGutterTexels
    + PAINT_ATLAS_COMPILE_TUNING.boundsSafetyTexels;
  const x0 = Math.max(0, Math.floor(minX - expand));
  const y0 = Math.max(0, Math.floor(minY - expand));
  const x1 = Math.min(input.width - 1, Math.ceil(maxX + expand));
  const y1 = Math.min(input.height - 1, Math.ceil(maxY + expand));
  if (x1 < x0 || y1 < y0) throw new Error(`${input.key} has no UV-addressable pixels`);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function orderedRects(rects: readonly PackRect[], mode: number): PackRect[] {
  return [...rects].sort((a, b) => {
    if (mode === 0) {
      if (a.h !== b.h) return b.h - a.h;
      if (a.w !== b.w) return b.w - a.w;
    } else if (mode === 1) {
      const area = b.w * b.h - a.w * a.h;
      if (area !== 0) return area;
      const edge = Math.max(b.w, b.h) - Math.max(a.w, a.h);
      if (edge !== 0) return edge;
    } else {
      if (a.w !== b.w) return b.w - a.w;
      if (a.h !== b.h) return b.h - a.h;
    }
    return a.key.localeCompare(b.key);
  });
}

function skylineFit(nodes: readonly SkylineNode[], index: number, width: number, binWidth: number): number | null {
  const x = nodes[index]!.x;
  if (x + width > binWidth) return null;
  let remaining = width;
  let y = nodes[index]!.y;
  let cursor = index;
  while (remaining > 0) {
    const node = nodes[cursor];
    if (!node) return null;
    y = Math.max(y, node.y);
    remaining -= node.width;
    cursor += 1;
  }
  return y;
}

function addSkylineLevel(nodes: SkylineNode[], index: number, rect: PackedRect): void {
  nodes.splice(index, 0, { x: rect.x, y: rect.y + rect.h, width: rect.w });
  for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
    const previous = nodes[cursor - 1]!;
    const node = nodes[cursor]!;
    const overlap = previous.x + previous.width - node.x;
    if (overlap <= 0) break;
    node.x += overlap;
    node.width -= overlap;
    if (node.width > 0) break;
    nodes.splice(cursor, 1);
    cursor -= 1;
  }
  for (let cursor = 0; cursor + 1 < nodes.length; cursor += 1) {
    if (nodes[cursor]!.y !== nodes[cursor + 1]!.y) continue;
    nodes[cursor]!.width += nodes[cursor + 1]!.width;
    nodes.splice(cursor + 1, 1);
    cursor -= 1;
  }
}

/** Bottom-left skyline placement at one candidate width. */
function packAtWidth(rects: readonly PackRect[], binWidth: number): PackedRect[] | null {
  const nodes: SkylineNode[] = [{ x: 0, y: 0, width: binWidth }];
  const packed: PackedRect[] = [];
  for (const rect of rects) {
    let bestIndex = -1;
    let bestX = 0;
    let bestY = Infinity;
    let bestBottom = Infinity;
    for (let index = 0; index < nodes.length; index += 1) {
      const y = skylineFit(nodes, index, rect.w, binWidth);
      if (y === null) continue;
      const bottom = y + rect.h;
      const x = nodes[index]!.x;
      if (bottom < bestBottom || (bottom === bestBottom && (y < bestY || (y === bestY && x < bestX)))) {
        bestIndex = index;
        bestX = x;
        bestY = y;
        bestBottom = bottom;
      }
    }
    if (bestIndex < 0) return null;
    const placed = { ...rect, x: bestX, y: bestY };
    packed.push(placed);
    addSkylineLevel(nodes, bestIndex, placed);
  }
  return packed;
}

function candidateWidths(rects: readonly PackRect[]): number[] {
  const maxWidth = Math.max(...rects.map((rect) => rect.w));
  const maxAllowed = Math.min(
    PAINT_ATLAS_COMPILE_TUNING.maxDimension,
    rects.reduce((sum, rect) => sum + rect.w, 0),
  );
  const candidates = new Set<number>([maxWidth, maxAllowed]);
  const area = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
  candidates.add(Math.max(maxWidth, Math.min(maxAllowed, Math.ceil(Math.sqrt(area)))));
  const span = maxAllowed - maxWidth;
  const step = Math.max(1, Math.ceil(span / PAINT_ATLAS_COMPILE_TUNING.widthSearchSamples));
  for (let width = maxWidth; width <= maxAllowed; width += step) candidates.add(width);
  for (let mode = 0; mode < 3; mode += 1) {
    let cumulative = 0;
    for (const rect of orderedRects(rects, mode)) {
      cumulative += rect.w;
      if (cumulative >= maxWidth && cumulative <= maxAllowed) candidates.add(cumulative);
    }
  }
  return [...candidates].sort((a, b) => a - b);
}

function packedExtent(rects: readonly PackedRect[]): { width: number; height: number } {
  return {
    width: Math.max(...rects.map((rect) => rect.x + rect.w)),
    height: Math.max(...rects.map((rect) => rect.y + rect.h)),
  };
}

function betterPacking(
  candidate: readonly PackedRect[],
  current: readonly PackedRect[] | null,
): boolean {
  if (!current) return true;
  const a = packedExtent(candidate);
  const b = packedExtent(current);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (areaA !== areaB) return areaA < areaB;
  const edgeA = Math.max(a.width, a.height);
  const edgeB = Math.max(b.width, b.height);
  if (edgeA !== edgeB) return edgeA < edgeB;
  if (a.height !== b.height) return a.height < b.height;
  return a.width < b.width;
}

function packBestFit(rects: readonly PackRect[]): PackedRect[] {
  let best: PackedRect[] | null = null;
  for (let mode = 0; mode < 3; mode += 1) {
    const ordered = orderedRects(rects, mode);
    for (const width of candidateWidths(rects)) {
      const packed = packAtWidth(ordered, width);
      if (!packed) continue;
      const extent = packedExtent(packed);
      if (extent.width > PAINT_ATLAS_COMPILE_TUNING.maxDimension
        || extent.height > PAINT_ATLAS_COMPILE_TUNING.maxDimension
        || extent.width * extent.height * 4 > PAINT_ATLAS_COMPILE_TUNING.maxRgbaBytes) continue;
      if (betterPacking(packed, best)) best = packed;
    }
  }
  if (!best) {
    throw new Error(
      `The lossless atlas exceeds ${PAINT_ATLAS_COMPILE_TUNING.maxDimension}×${PAINT_ATLAS_COMPILE_TUNING.maxDimension}; keep the sources or split this model into atlas sets.`,
    );
  }
  return best;
}

/**
 * Dry, pure planning boundary. Equal source PNG + crop rectangles alias one tile,
 * which removes the common duplicate where the current base look is also a variant.
 */
export function planPaintAtlas(inputs: readonly PaintAtlasPlanInput[]): PaintAtlasPlan {
  if (inputs.length === 0) throw new Error('There are no painted looks to compile.');
  const seenKeys = new Set<string>();
  const sourceRows = inputs.map((input) => {
    if (!input.key || seenKeys.has(input.key)) throw new Error(`Duplicate paint source '${input.key}'.`);
    seenKeys.add(input.key);
    const sourceRect = sourceUvBounds(input);
    const tileKey = `${input.pngHash}:${sourceRect.x},${sourceRect.y},${sourceRect.w},${sourceRect.h}`;
    return { input, sourceRect, tileKey };
  });
  const pad = PAINT_ATLAS_COMPILE_TUNING.tileExtrusionTexels;
  const unique = new Map<string, { sourceKey: string; sourceRect: Rect }>();
  for (const row of sourceRows) {
    if (!unique.has(row.tileKey)) unique.set(row.tileKey, { sourceKey: row.input.key, sourceRect: row.sourceRect });
  }
  const rects: PackRect[] = [...unique].map(([key, tile]) => ({
    key,
    w: tile.sourceRect.w + pad * 2,
    h: tile.sourceRect.h + pad * 2,
  }));
  const packed = packBestFit(rects);
  const byTile = new Map(packed.map((rect) => [rect.key, rect]));
  const tiles: PlannedPaintAtlasTile[] = [...unique].map(([key, tile]) => {
    const placed = byTile.get(key)!;
    return {
      key,
      sourceKey: tile.sourceKey,
      sourceRect: tile.sourceRect,
      packedRect: { x: placed.x, y: placed.y, w: placed.w, h: placed.h },
      atlasRect: {
        x: placed.x + pad,
        y: placed.y + pad,
        w: tile.sourceRect.w,
        h: tile.sourceRect.h,
      },
    };
  });
  const tileByKey = new Map(tiles.map((tile) => [tile.key, tile]));
  const sources: PlannedPaintAtlasSource[] = sourceRows.map((row) => {
    const tile = tileByKey.get(row.tileKey)!;
    return {
      key: row.input.key,
      width: row.input.width,
      height: row.input.height,
      sourceRect: row.sourceRect,
      tileKey: row.tileKey,
      atlasRect: tile.atlasRect,
      packedRect: tile.packedRect,
    };
  });
  const extent = packedExtent(packed);
  return { width: extent.width, height: extent.height, sources, tiles };
}

function fillUnusedTexels(rgba: Uint8Array): void {
  const color = PAINT_ATLAS_COMPILE_TUNING.unusedTexel;
  for (let pixel = 0; pixel < rgba.length; pixel += 4) {
    rgba[pixel + 0] = color[0];
    rgba[pixel + 1] = color[1];
    rgba[pixel + 2] = color[2];
    rgba[pixel + 3] = color[3];
  }
}

/** Copy one planned tile byte-for-byte, extruding its crop edge into the pad. */
export function blitPaintAtlasTile(
  destination: Uint8Array,
  atlasWidth: number,
  atlasHeight: number,
  tile: PlannedPaintAtlasTile,
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
): void {
  if (destination.length !== atlasWidth * atlasHeight * 4
    || source.length !== sourceWidth * sourceHeight * 4) {
    throw new Error(`Raster byte count changed while compiling ${tile.sourceKey}.`);
  }
  const pad = PAINT_ATLAS_COMPILE_TUNING.tileExtrusionTexels;
  for (let localY = -pad; localY < tile.sourceRect.h + pad; localY += 1) {
    const sourceY = Math.max(
      tile.sourceRect.y,
      Math.min(tile.sourceRect.y + tile.sourceRect.h - 1, tile.sourceRect.y + localY),
    );
    const destinationY = tile.atlasRect.y + localY;
    for (let localX = -pad; localX < tile.sourceRect.w + pad; localX += 1) {
      const sourceX = Math.max(
        tile.sourceRect.x,
        Math.min(tile.sourceRect.x + tile.sourceRect.w - 1, tile.sourceRect.x + localX),
      );
      const destinationX = tile.atlasRect.x + localX;
      const read = (sourceY * sourceWidth + sourceX) * 4;
      const write = (destinationY * atlasWidth + destinationX) * 4;
      destination[write + 0] = source[read + 0]!;
      destination[write + 1] = source[read + 1]!;
      destination[write + 2] = source[read + 2]!;
      destination[write + 3] = source[read + 3]!;
    }
  }
}

/** UV-only rewrite. Positions and normals remain byte-for-byte source geometry. */
export function remapPaintAtlasMesh(
  vertices: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  sourceRect: Rect,
  atlasRect: Rect,
  atlasWidth: number,
  atlasHeight: number,
): Float32Array {
  if (vertices.length < PAINT_MESH_VERTEX_FLOATS * 3
    || vertices.length % PAINT_MESH_VERTEX_FLOATS !== 0
    || !positiveInteger(atlasWidth) || !positiveInteger(atlasHeight)) {
    throw new Error('Cannot remap an incomplete paint mesh.');
  }
  const out = new Float32Array(vertices);
  for (let vertex = 0; vertex < out.length; vertex += PAINT_MESH_VERTEX_FLOATS) {
    const sourceX = out[vertex + 6]! * sourceWidth;
    const sourceY = out[vertex + 7]! * sourceHeight;
    const u = (atlasRect.x + sourceX - sourceRect.x) / atlasWidth;
    const v = (atlasRect.y + sourceY - sourceRect.y) / atlasHeight;
    if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
      throw new Error('A remapped paint UV escaped the compiled atlas.');
    }
    out[vertex + 6] = u;
    out[vertex + 7] = v;
  }
  return out;
}

type SourceKind = 'base' | 'variant';

type CompileSource = PaintAtlasPlanInput & {
  kind: SourceKind;
  id: string;
  name: string;
  pngPath: string;
  meshPath: string;
  pngRel: string;
  meshRel: string;
  pngStamp: string;
  meshStamp: string;
  meshHash: string;
  coveragePixels?: number;
};

export type CompiledPaintAtlasEntry = {
  kind: SourceKind;
  id: string;
  name: string;
  sourcePng: string;
  sourceMesh: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceRect: Rect;
  atlasRect: Rect;
  packedRect: Rect;
  compiledMesh: string;
  pngStamp: string;
  meshStamp: string;
  pngHash: string;
  meshHash: string;
  coveragePixels?: number;
};

export type CompiledPaintAtlasManifest = {
  version: 1;
  atlas: {
    file: string;
    width: number;
    height: number;
    sha256: string;
    pngBytes: number;
  };
  entries: CompiledPaintAtlasEntry[];
  stats: {
    lookCount: number;
    uniqueTileCount: number;
    sourcePixels: number;
    packedSourcePixels: number;
    atlasPixels: number;
    savedPixels: number;
  };
};

export type PaintAtlasCompileProgress = {
  phase: 'scanning' | 'packing' | 'rasterizing' | 'writing';
  completed: number;
  total: number;
  label: string;
};

export type PaintAtlasCompileResult =
  | { ok: true; manifest: CompiledPaintAtlasManifest; manifestPath: string }
  | { ok: false; error: string };

export type PaintAtlasCompileStatus = {
  state: 'none' | 'fresh' | 'stale';
  lookCount: number;
  width?: number;
  height?: number;
  pngBytes?: number;
  sourcePixels?: number;
  atlasPixels?: number;
};

export type RuntimeCompiledPaintAtlas = {
  atlasPath: string;
  manifest: CompiledPaintAtlasManifest;
  base: CompiledPaintAtlasEntry | null;
  variants: Map<string, CompiledPaintAtlasEntry>;
};

function packagePath(dir: string, relative: string): string {
  return `${dir}/${relative}`;
}

function fileStamp(path: string): string | null {
  const info = stat(path);
  return info && !info.isDir ? `${info.size}:${info.mtimeMs}` : null;
}

function readBinary(path: string): Uint8Array | null {
  const encoded = readFileBase64(path);
  if (!encoded) return null;
  try { return base64ToBytes(encoded); }
  catch { return null; }
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24
    || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71
    || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return positiveInteger(width) && positiveInteger(height) ? { width, height } : null;
}

function paintMesh(bytes: Uint8Array): Float32Array | null {
  if (bytes.byteLength < PAINT_MESH_VERTEX_BYTES * 3
    || bytes.byteLength % PAINT_MESH_VERTEX_BYTES !== 0) return null;
  const copy = bytes.slice();
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

function sourceSpec(
  dir: string,
  kind: SourceKind,
  id: string,
  name: string,
  pngRel: string,
  meshRel: string,
  expectedDimensions?: { width: number; height: number },
  coveragePixels?: number,
): CompileSource {
  const pngPath = packagePath(dir, pngRel);
  const meshPath = packagePath(dir, meshRel);
  const pngBytes = readBinary(pngPath);
  if (!pngBytes) throw new Error(`${name} is missing ${pngRel}.`);
  const dimensions = pngDimensions(pngBytes);
  if (!dimensions) throw new Error(`${name} has an unreadable source PNG.`);
  if (expectedDimensions
    && (dimensions.width !== expectedDimensions.width || dimensions.height !== expectedDimensions.height)) {
    throw new Error(`${name}'s PNG dimensions no longer match its saved record.`);
  }
  const meshBytes = readBinary(meshPath);
  const vertices = meshBytes ? paintMesh(meshBytes) : null;
  if (!meshBytes || !vertices) throw new Error(`${name} is missing a valid paint-space mesh; Load it and Save once, then compile.`);
  const pngStamp = fileStamp(pngPath);
  const meshStamp = fileStamp(meshPath);
  if (!pngStamp || !meshStamp) throw new Error(`${name}'s source files changed during the compile scan.`);
  return {
    key: kind === 'base' ? 'base' : `variant:${id}`,
    kind,
    id,
    name,
    width: dimensions.width,
    height: dimensions.height,
    pngHash: sha256Hex(pngBytes),
    meshHash: sha256Hex(meshBytes),
    vertices,
    pngPath,
    meshPath,
    pngRel,
    meshRel,
    pngStamp,
    meshStamp,
    ...(coveragePixels && coveragePixels > 0 ? { coveragePixels } : {}),
  };
}

function sourceVariants(dir: string, variants: readonly PaintVariant[]): CompileSource[] {
  const currentMeshBytes = stat(`${dir}/mesh/base.blob`)?.size ?? null;
  const sources: CompileSource[] = [];
  if (exists(`${dir}/atlases/base.png`) && exists(`${dir}/mesh/painted.blob`)) {
    sources.push(sourceSpec(
      dir,
      'base',
      'base',
      'Model Base',
      'atlases/base.png',
      'mesh/painted.blob',
    ));
  }
  for (const variant of variants) {
    const pngRel = `paints/paint_${variant.id}.png`;
    const meshRel = `paints/paint_${variant.id}.blob`;
    const meshInfo = stat(`${dir}/${meshRel}`);
    if (!meshInfo || !paintSkinFitsCurrentMesh(currentMeshBytes, meshInfo.size)) {
      throw new Error(`${variant.name} does not fit the current topology; Load it and Save once, then compile.`);
    }
    sources.push(sourceSpec(
      dir,
      'variant',
      variant.id,
      variant.name,
      pngRel,
      meshRel,
      { width: variant.w, height: variant.h },
      variant.uvCoverage?.keptPixels,
    ));
  }
  return sources;
}

function isRect(value: unknown): value is Rect {
  const rect = value as Partial<Rect> | null;
  return !!rect
    && Number.isSafeInteger(rect.x) && rect.x! >= 0
    && Number.isSafeInteger(rect.y) && rect.y! >= 0
    && positiveInteger(rect.w!)
    && positiveInteger(rect.h!);
}

function safeRelativeCompiledPath(path: unknown, kind: 'atlas' | 'mesh'): path is string {
  if (typeof path !== 'string' || path.includes('..') || path.startsWith('/')) return false;
  const pattern = kind === 'atlas'
    ? new RegExp(`^paints/${COMPILED_ATLAS_PREFIX}${CONTENT_HASH_PATTERN}\\.png$`)
    : new RegExp(`^paints/${COMPILED_MESH_PREFIX}${CONTENT_HASH_PATTERN}\\.blob$`);
  return pattern.test(path);
}

function safeRelativeSourcePath(path: unknown, kind: 'png' | 'mesh'): path is string {
  if (typeof path !== 'string' || path.includes('..') || path.startsWith('/')) return false;
  return kind === 'png'
    ? path === 'atlases/base.png' || /^paints\/paint_\w+\.png$/.test(path)
    : path === 'mesh/painted.blob' || /^paints\/paint_\w+\.blob$/.test(path);
}

function parseManifest(text: string | null): CompiledPaintAtlasManifest | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<CompiledPaintAtlasManifest>;
    if (value.version !== 1 || !value.atlas || !Array.isArray(value.entries) || !value.stats) return null;
    if (!safeRelativeCompiledPath(value.atlas.file, 'atlas')
      || !positiveInteger(value.atlas.width) || !positiveInteger(value.atlas.height)
      || typeof value.atlas.sha256 !== 'string' || !new RegExp(`^${CONTENT_HASH_PATTERN}$`).test(value.atlas.sha256)
      || !Number.isSafeInteger(value.atlas.pngBytes) || value.atlas.pngBytes < 1) return null;
    const stats = value.stats;
    if (!Number.isSafeInteger(stats.lookCount) || stats.lookCount < 1
      || !Number.isSafeInteger(stats.uniqueTileCount) || stats.uniqueTileCount < 1
      || stats.uniqueTileCount > stats.lookCount
      || !Number.isSafeInteger(stats.sourcePixels) || stats.sourcePixels < 1
      || !Number.isSafeInteger(stats.packedSourcePixels) || stats.packedSourcePixels < 1
      || !Number.isSafeInteger(stats.atlasPixels)
      || stats.atlasPixels !== value.atlas.width * value.atlas.height
      || !Number.isSafeInteger(stats.savedPixels) || stats.savedPixels < 0
      || stats.lookCount !== value.entries.length) return null;
    const entryKeys = new Set<string>();
    for (const entry of value.entries) {
      if ((entry.kind !== 'base' && entry.kind !== 'variant')
        || typeof entry.id !== 'string' || typeof entry.name !== 'string'
        || !safeRelativeSourcePath(entry.sourcePng, 'png')
        || !safeRelativeSourcePath(entry.sourceMesh, 'mesh')
        || !positiveInteger(entry.sourceWidth) || !positiveInteger(entry.sourceHeight)
        || !isRect(entry.sourceRect) || !isRect(entry.atlasRect) || !isRect(entry.packedRect)
        || !safeRelativeCompiledPath(entry.compiledMesh, 'mesh')
        || typeof entry.pngStamp !== 'string' || typeof entry.meshStamp !== 'string'
        || typeof entry.pngHash !== 'string' || !new RegExp(`^${CONTENT_HASH_PATTERN}$`).test(entry.pngHash)
        || typeof entry.meshHash !== 'string' || !new RegExp(`^${CONTENT_HASH_PATTERN}$`).test(entry.meshHash)) return null;
      const key = entry.kind === 'base' ? 'base' : `variant:${entry.id}`;
      if (entryKeys.has(key)) return null;
      entryKeys.add(key);
      if ((entry.kind === 'base' && (entry.id !== 'base'
        || entry.sourcePng !== 'atlases/base.png' || entry.sourceMesh !== 'mesh/painted.blob'))
        || (entry.kind === 'variant' && (entry.sourcePng !== `paints/paint_${entry.id}.png`
          || entry.sourceMesh !== `paints/paint_${entry.id}.blob`))) return null;
      if (entry.sourceRect.x + entry.sourceRect.w > entry.sourceWidth
        || entry.sourceRect.y + entry.sourceRect.h > entry.sourceHeight
        || entry.atlasRect.w !== entry.sourceRect.w
        || entry.atlasRect.h !== entry.sourceRect.h) return null;
      if (entry.atlasRect.x + entry.atlasRect.w > value.atlas.width
        || entry.atlasRect.y + entry.atlasRect.h > value.atlas.height) return null;
    }
    return value as CompiledPaintAtlasManifest;
  } catch { return null; }
}

function fileHash(path: string): string | null {
  const value = host.__file_sha256?.(path);
  return typeof value === 'string' && new RegExp(`^${CONTENT_HASH_PATTERN}$`).test(value) ? value : null;
}

function contentAddressFromPath(path: string, prefix: string, suffix: string): string | null {
  const match = new RegExp(`^paints/${prefix}(${CONTENT_HASH_PATTERN})\\.${suffix}$`).exec(path);
  return match?.[1] ?? null;
}

function entrySourcesCurrent(dir: string, entry: CompiledPaintAtlasEntry, verifyHashes = false): boolean {
  const sourcePng = packagePath(dir, entry.sourcePng);
  const sourceMesh = packagePath(dir, entry.sourceMesh);
  const compiledMesh = packagePath(dir, entry.compiledMesh);
  if (fileStamp(sourcePng) !== entry.pngStamp
    || fileStamp(sourceMesh) !== entry.meshStamp
    || !exists(compiledMesh)) return false;
  if (!verifyHashes || typeof host.__file_sha256 !== 'function') return true;
  const compiledHash = contentAddressFromPath(entry.compiledMesh, COMPILED_MESH_PREFIX, 'blob');
  return fileHash(sourcePng) === entry.pngHash
    && fileHash(sourceMesh) === entry.meshHash
    && !!compiledHash
    && fileHash(compiledMesh) === compiledHash;
}

/** Cheap render-time status: source mtimes/counts only, never decodes a PNG. */
export function paintAtlasCompileStatus(pkg: PaintTarget): PaintAtlasCompileStatus {
  const dir = resolvePackageDir(pkg.kind, pkg.id);
  if (!dir) return { state: 'none', lookCount: 0 };
  const manifest = parseManifest(readFile(`${dir}/${PAINT_ATLAS_MANIFEST_FILE}`));
  const atlasInfo = manifest ? stat(packagePath(dir, manifest.atlas.file)) : null;
  if (!manifest || !atlasInfo || atlasInfo.isDir) {
    return { state: 'none', lookCount: 0 };
  }
  const expected = new Set<string>();
  if (exists(`${dir}/atlases/base.png`) && exists(`${dir}/mesh/painted.blob`)) expected.add('base');
  for (const variant of listPaintVariants(pkg)) expected.add(`variant:${variant.id}`);
  const actual = new Set(manifest.entries.map((entry) => entry.kind === 'base' ? 'base' : `variant:${entry.id}`));
  const current = expected.size === actual.size
    && [...expected].every((key) => actual.has(key))
    && atlasInfo.size === manifest.atlas.pngBytes
    && manifest.entries.every((entry) => entrySourcesCurrent(dir, entry));
  return {
    state: current ? 'fresh' : 'stale',
    lookCount: manifest.stats.lookCount,
    width: manifest.atlas.width,
    height: manifest.atlas.height,
    pngBytes: manifest.atlas.pngBytes,
    sourcePixels: manifest.stats.sourcePixels,
    atlasPixels: manifest.stats.atlasPixels,
  };
}

/**
 * Placement-facing compiled view. A globally stale manifest is still useful:
 * each unchanged entry validates independently, while new/updated variants fall
 * back to their individual source image until the next explicit compile.
 */
export function runtimeCompiledPaintAtlas(pkg: PaintTarget): RuntimeCompiledPaintAtlas | null {
  const dir = resolvePackageDir(pkg.kind, pkg.id);
  if (!dir) return null;
  const manifest = parseManifest(readFile(`${dir}/${PAINT_ATLAS_MANIFEST_FILE}`));
  if (!manifest) return null;
  const atlasPath = packagePath(dir, manifest.atlas.file);
  const atlasInfo = stat(atlasPath);
  if (!atlasInfo || atlasInfo.isDir || atlasInfo.size !== manifest.atlas.pngBytes) return null;
  if (typeof host.__file_sha256 === 'function' && fileHash(atlasPath) !== manifest.atlas.sha256) return null;
  let base: CompiledPaintAtlasEntry | null = null;
  const variants = new Map<string, CompiledPaintAtlasEntry>();
  for (const entry of manifest.entries) {
    if (!entrySourcesCurrent(dir, entry, true)) continue;
    if (entry.kind === 'base') base = entry;
    else variants.set(entry.id, entry);
  }
  if (!base && variants.size === 0) return null;
  return { atlasPath, manifest, base, variants };
}

function progress(
  callback: ((progress: PaintAtlasCompileProgress) => void) | undefined,
  phase: PaintAtlasCompileProgress['phase'],
  completed: number,
  total: number,
  label: string,
): void {
  callback?.({ phase, completed, total, label });
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function cleanupObsoleteCompiledAssets(dir: string, keep: ReadonlySet<string>): void {
  const paints = `${dir}/paints`;
  for (const name of listDir(paints)) {
    if (!COMPILED_ASSET_RE.test(name)) continue;
    const relative = `paints/${name}`;
    if (!keep.has(relative)) remove(`${paints}/${name}`);
  }
}

/** Explicit compile. All source reads finish before derived output is committed. */
export async function compilePaintAtlas(
  pkg: PaintTarget,
  onProgress?: (value: PaintAtlasCompileProgress) => void,
): Promise<PaintAtlasCompileResult> {
  const dir = resolvePackageDir(pkg.kind, pkg.id);
  if (!dir) return { ok: false, error: 'Save the model package before compiling its paint atlas.' };
  const variants = listPaintVariants(pkg);
  try {
    progress(onProgress, 'scanning', 0, variants.length + 1, 'Scanning editable paint sources…');
    await yieldFrame();
    const sources = sourceVariants(dir, variants);
    if (sources.length === 0) {
      return { ok: false, error: 'There is no saved base look or paint variant to compile.' };
    }
    progress(onProgress, 'packing', 0, sources.length, `Finding the tightest placement for ${sources.length} look${sources.length === 1 ? '' : 's'}…`);
    await yieldFrame();
    const plan = planPaintAtlas(sources);
    const atlasRgba = new Uint8Array(plan.width * plan.height * 4);
    fillUnusedTexels(atlasRgba);
    const sourceByKey = new Map(sources.map((source) => [source.key, source]));
    let tileIndex = 0;
    for (const tile of plan.tiles) {
      const source = sourceByKey.get(tile.sourceKey)!;
      progress(onProgress, 'rasterizing', tileIndex, plan.tiles.length, `Packing ${source.name}…`);
      await yieldFrame();
      const png = readBinary(source.pngPath);
      const decoded = png ? image(png).raw() : null;
      if (!decoded || decoded.width !== source.width || decoded.height !== source.height) {
        throw new Error(`${source.name}'s PNG changed or could not be decoded.`);
      }
      blitPaintAtlasTile(
        atlasRgba,
        plan.width,
        plan.height,
        tile,
        decoded.rgba,
        decoded.width,
        decoded.height,
      );
      tileIndex += 1;
    }

    progress(onProgress, 'writing', 0, sources.length + 1, 'Encoding the shared lossless atlas…');
    await yieldFrame();
    const atlasPng = encodeImage(atlasRgba, plan.width, plan.height, { format: 'png' });
    if (!atlasPng) throw new Error('The shared atlas could not be encoded as PNG.');
    const atlasHash = sha256Hex(atlasPng);
    const atlasRel = `paints/${COMPILED_ATLAS_PREFIX}${atlasHash}.png`;
    const atlasPath = packagePath(dir, atlasRel);
    const created: string[] = [];
    if (!exists(atlasPath)) {
      if (!writeFileBytesAtomic(atlasPath, atlasPng)) throw new Error('The shared atlas could not be written atomically.');
      created.push(atlasPath);
    }

    const plannedByKey = new Map(plan.sources.map((source) => [source.key, source]));
    const entries: CompiledPaintAtlasEntry[] = [];
    const keep = new Set<string>([atlasRel]);
    let sourceIndex = 0;
    try {
      for (const source of sources) {
        const planned = plannedByKey.get(source.key)!;
        progress(onProgress, 'writing', sourceIndex + 1, sources.length + 1, `Writing ${source.name}'s atlas UVs…`);
        await yieldFrame();
        const remapped = remapPaintAtlasMesh(
          source.vertices,
          source.width,
          source.height,
          planned.sourceRect,
          planned.atlasRect,
          plan.width,
          plan.height,
        );
        const meshBytes = new Uint8Array(remapped.buffer, remapped.byteOffset, remapped.byteLength);
        const compiledMeshHash = sha256Hex(meshBytes);
        const compiledMesh = `paints/${COMPILED_MESH_PREFIX}${compiledMeshHash}.blob`;
        const compiledMeshPath = packagePath(dir, compiledMesh);
        if (!exists(compiledMeshPath)) {
          if (!writeFileBytesAtomic(compiledMeshPath, meshBytes)) {
            throw new Error(`${source.name}'s compiled UV mesh could not be written atomically.`);
          }
          created.push(compiledMeshPath);
        }
        keep.add(compiledMesh);
        entries.push({
          kind: source.kind,
          id: source.id,
          name: source.name,
          sourcePng: source.pngRel,
          sourceMesh: source.meshRel,
          sourceWidth: source.width,
          sourceHeight: source.height,
          sourceRect: planned.sourceRect,
          atlasRect: planned.atlasRect,
          packedRect: planned.packedRect,
          compiledMesh,
          pngStamp: source.pngStamp,
          meshStamp: source.meshStamp,
          pngHash: source.pngHash,
          meshHash: source.meshHash,
          ...(source.coveragePixels ? { coveragePixels: source.coveragePixels } : {}),
        });
        sourceIndex += 1;
      }

      const sourcePixels = sources.reduce((sum, source) => sum + source.width * source.height, 0);
      const packedSourcePixels = plan.tiles.reduce(
        (sum, tile) => sum + tile.sourceRect.w * tile.sourceRect.h,
        0,
      );
      const atlasPixels = plan.width * plan.height;
      const manifest: CompiledPaintAtlasManifest = {
        version: 1,
        atlas: {
          file: atlasRel,
          width: plan.width,
          height: plan.height,
          sha256: atlasHash,
          pngBytes: atlasPng.byteLength,
        },
        entries,
        stats: {
          lookCount: sources.length,
          uniqueTileCount: plan.tiles.length,
          sourcePixels,
          packedSourcePixels,
          atlasPixels,
          savedPixels: Math.max(0, sourcePixels - atlasPixels),
        },
      };
      const manifestPath = `${dir}/${PAINT_ATLAS_MANIFEST_FILE}`;
      if (!writeFileBytesAtomic(manifestPath, textBytes(JSON.stringify(manifest, null, 2)))) {
        throw new Error('The compiled atlas manifest could not be committed.');
      }
      cleanupObsoleteCompiledAssets(dir, keep);
      return { ok: true, manifest, manifestPath };
    } catch (error) {
      for (const path of created) remove(path);
      throw error;
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
