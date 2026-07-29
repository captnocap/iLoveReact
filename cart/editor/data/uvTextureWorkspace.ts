// Editable image-layer document behind the model UV workspace.
//
// Layers keep signed, absolute texel positions and their original native
// resolution. Compile is explicit: it crops the infinite document to the
// smallest visible union, composites transparent gaps, and reports the origin
// shift needed to keep every authored UV stationary in workspace coordinates.

export const UV_TEXTURE_WORKSPACE_VERSION = 1;

export const UV_TEXTURE_WORKSPACE_TUNING = {
  maxLayers: 256,
  maxCoordinate: 16_777_216,
  maxDimension: 8192,
  maxRgbaBytes: 256 * 1024 * 1024,
  sourcePrefix: 'atlases/uv-sources/',
  manifestFile: 'atlases/uv-workspace.json',
} as const;

const SOURCE_RE = /^atlases\/uv-sources\/([0-9a-f]{64})\.png$/;

export type UvTextureLayer = {
  id: string;
  name: string;
  source: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
};

export type UvTextureWorkspaceCompile = {
  revision: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  atlasSha256: string;
};

export type UvTextureWorkspaceDoc = {
  version: typeof UV_TEXTURE_WORKSPACE_VERSION;
  revision: number;
  nextLayer: number;
  layers: UvTextureLayer[];
  compiled?: UvTextureWorkspaceCompile;
};

export type DecodedUvTextureLayer = {
  layer: UvTextureLayer;
  rgba: Uint8Array;
  width: number;
  height: number;
};

export type UvTextureWorkspaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type UvTextureWorkspaceRaster = UvTextureWorkspaceBounds & {
  rgba: Uint8Array;
  shiftX: number;
  shiftY: number;
};

const integer = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};

const positiveInteger = (value: unknown): number | null => {
  const number = integer(value);
  return number !== null && number > 0 ? number : null;
};

const coordinate = (value: unknown): number | null => {
  const number = integer(value);
  return number !== null && Math.abs(number) <= UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate ? number : null;
};

export function isUvTextureWorkspaceSource(path: unknown): path is string {
  return typeof path === 'string' && SOURCE_RE.test(path);
}

export function uvTextureWorkspaceSourceHash(path: string): string | null {
  return SOURCE_RE.exec(path)?.[1] ?? null;
}

export function parseUvTextureWorkspace(text: string | null): UvTextureWorkspaceDoc | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as any;
    if (!raw || raw.version !== UV_TEXTURE_WORKSPACE_VERSION) return null;
    const revision = positiveInteger(raw.revision);
    const nextLayer = positiveInteger(raw.nextLayer);
    if (revision === null || nextLayer === null
      || !Array.isArray(raw.layers)
      || raw.layers.length < 1
      || raw.layers.length > UV_TEXTURE_WORKSPACE_TUNING.maxLayers) return null;
    const ids = new Set<string>();
    const layers: UvTextureLayer[] = [];
    for (const layer of raw.layers) {
      const id = typeof layer?.id === 'string' && /^[a-z0-9_-]{1,64}$/i.test(layer.id) ? layer.id : null;
      const name = typeof layer?.name === 'string' && layer.name.length > 0 && layer.name.length <= 256 ? layer.name : null;
      const x = coordinate(layer?.x);
      const y = coordinate(layer?.y);
      const width = positiveInteger(layer?.width);
      const height = positiveInteger(layer?.height);
      if (!id || ids.has(id) || !name || x === null || y === null
        || width === null || height === null
        || width > UV_TEXTURE_WORKSPACE_TUNING.maxDimension
        || height > UV_TEXTURE_WORKSPACE_TUNING.maxDimension
        || !isUvTextureWorkspaceSource(layer?.source)
        || typeof layer?.visible !== 'boolean') return null;
      ids.add(id);
      layers.push({ id, name, source: layer.source, x, y, width, height, visible: layer.visible });
    }
    let compiled: UvTextureWorkspaceCompile | undefined;
    if (raw.compiled !== undefined) {
      const compiledRevision = positiveInteger(raw.compiled?.revision);
      const originX = coordinate(raw.compiled?.originX);
      const originY = coordinate(raw.compiled?.originY);
      const width = positiveInteger(raw.compiled?.width);
      const height = positiveInteger(raw.compiled?.height);
      const atlasSha256 = typeof raw.compiled?.atlasSha256 === 'string'
        && /^[0-9a-f]{64}$/.test(raw.compiled.atlasSha256)
        ? raw.compiled.atlasSha256
        : null;
      if (compiledRevision === null || compiledRevision > revision
        || originX === null || originY === null
        || width === null || height === null
        || width > UV_TEXTURE_WORKSPACE_TUNING.maxDimension
        || height > UV_TEXTURE_WORKSPACE_TUNING.maxDimension
        || !atlasSha256) return null;
      compiled = { revision: compiledRevision, originX, originY, width, height, atlasSha256 };
    }
    return { version: UV_TEXTURE_WORKSPACE_VERSION, revision, nextLayer, layers, ...(compiled ? { compiled } : {}) };
  } catch {
    return null;
  }
}

export function createUvTextureWorkspace(
  source: string,
  width: number,
  height: number,
): UvTextureWorkspaceDoc {
  if (!isUvTextureWorkspaceSource(source)
    || positiveInteger(width) === null
    || positiveInteger(height) === null
    || width > UV_TEXTURE_WORKSPACE_TUNING.maxDimension
    || height > UV_TEXTURE_WORKSPACE_TUNING.maxDimension
    || width * height * 4 > UV_TEXTURE_WORKSPACE_TUNING.maxRgbaBytes) {
    throw new Error('Cannot create a workspace from an invalid base image.');
  }
  return {
    version: UV_TEXTURE_WORKSPACE_VERSION,
    revision: 1,
    nextLayer: 2,
    layers: [{ id: 'layer-1', name: 'paint baseline', source, x: 0, y: 0, width, height, visible: true }],
  };
}

export function updateUvTextureWorkspace(
  doc: UvTextureWorkspaceDoc,
  layers: readonly UvTextureLayer[],
  nextLayer = doc.nextLayer,
): UvTextureWorkspaceDoc {
  const parsed = parseUvTextureWorkspace(JSON.stringify({
    ...doc,
    revision: doc.revision + 1,
    nextLayer,
    layers,
  }));
  if (!parsed) throw new Error('The image-layer edit would create an invalid UV workspace.');
  return parsed;
}

export function appendUvTextureLayer(
  doc: UvTextureWorkspaceDoc,
  input: Omit<UvTextureLayer, 'id'>,
): UvTextureWorkspaceDoc {
  if (doc.layers.length >= UV_TEXTURE_WORKSPACE_TUNING.maxLayers) {
    throw new Error(`The UV workspace already has ${UV_TEXTURE_WORKSPACE_TUNING.maxLayers} image layers.`);
  }
  return updateUvTextureWorkspace(
    doc,
    [...doc.layers, { ...input, id: `layer-${doc.nextLayer}` }],
    doc.nextLayer + 1,
  );
}

export function uvTextureWorkspaceBounds(layers: readonly UvTextureLayer[]): UvTextureWorkspaceBounds {
  const visible = layers.filter((layer) => layer.visible);
  if (visible.length === 0) throw new Error('Show at least one image layer before compiling.');
  const x = Math.min(...visible.map((layer) => layer.x));
  const y = Math.min(...visible.map((layer) => layer.y));
  const right = Math.max(...visible.map((layer) => layer.x + layer.width));
  const bottom = Math.max(...visible.map((layer) => layer.y + layer.height));
  const width = right - x;
  const height = bottom - y;
  if (width < 1 || height < 1
    || width > UV_TEXTURE_WORKSPACE_TUNING.maxDimension
    || height > UV_TEXTURE_WORKSPACE_TUNING.maxDimension
    || width * height * 4 > UV_TEXTURE_WORKSPACE_TUNING.maxRgbaBytes) {
    throw new Error(
      `Visible layers span ${width}×${height}; the compiled texture limit is ${UV_TEXTURE_WORKSPACE_TUNING.maxDimension}×${UV_TEXTURE_WORKSPACE_TUNING.maxDimension}.`,
    );
  }
  return { x, y, width, height };
}

function sourceOver(destination: Uint8Array, write: number, source: Uint8Array, read: number): void {
  const sourceAlphaByte = source[read + 3]!;
  if (sourceAlphaByte === 0) return;
  if (sourceAlphaByte === 255 || destination[write + 3] === 0) {
    destination[write + 0] = source[read + 0]!;
    destination[write + 1] = source[read + 1]!;
    destination[write + 2] = source[read + 2]!;
    destination[write + 3] = sourceAlphaByte;
    return;
  }
  const sourceAlpha = sourceAlphaByte / 255;
  const destinationAlpha = destination[write + 3]! / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel += 1) {
    const value = (
      source[read + channel]! * sourceAlpha
      + destination[write + channel]! * destinationAlpha * (1 - sourceAlpha)
    ) / outputAlpha;
    destination[write + channel] = Math.round(value);
  }
  destination[write + 3] = Math.round(outputAlpha * 255);
}

/** Pure, deterministic compile. Input rows may be in any order; document order wins. */
export function compileUvTextureWorkspace(
  doc: UvTextureWorkspaceDoc,
  decoded: readonly DecodedUvTextureLayer[],
): UvTextureWorkspaceRaster {
  const byId = new Map(decoded.map((row) => [row.layer.id, row]));
  if (byId.size !== decoded.length) throw new Error('A decoded image layer was supplied twice.');
  const bounds = uvTextureWorkspaceBounds(doc.layers);
  const rgba = new Uint8Array(bounds.width * bounds.height * 4);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const row = byId.get(layer.id);
    if (!row || row.layer.source !== layer.source
      || row.width !== layer.width || row.height !== layer.height
      || row.rgba.length !== layer.width * layer.height * 4) {
      throw new Error(`${layer.name} no longer matches its stored native-pixel source.`);
    }
    for (let sourceY = 0; sourceY < layer.height; sourceY += 1) {
      const destinationY = layer.y - bounds.y + sourceY;
      for (let sourceX = 0; sourceX < layer.width; sourceX += 1) {
        const destinationX = layer.x - bounds.x + sourceX;
        const read = (sourceY * layer.width + sourceX) * 4;
        const write = (destinationY * bounds.width + destinationX) * 4;
        sourceOver(rgba, write, row.rgba, read);
      }
    }
  }
  const oldOriginX = doc.compiled?.originX ?? 0;
  const oldOriginY = doc.compiled?.originY ?? 0;
  return {
    ...bounds,
    rgba,
    shiftX: oldOriginX - bounds.x,
    shiftY: oldOriginY - bounds.y,
  };
}

export function uvTextureWorkspaceIsStale(doc: UvTextureWorkspaceDoc): boolean {
  return !doc.compiled || doc.compiled.revision !== doc.revision;
}
