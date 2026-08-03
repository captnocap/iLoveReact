// Package-backed IO for the editable UV image workspace. The manifest is the
// mutable document; every imported source is immutable and content-addressed.

import {
  exists,
  mkdir,
  readFile,
  readFileBase64,
  writeFileBytesAtomic,
} from '../../../runtime/hooks/fs';
import { encode as encodeImage, image } from '../../../runtime/image';
import { base64ToBytes, textBytes } from '../../../runtime/workspace/lumps';
import { sha256Hex } from '../../../runtime/workspace/sha256';
import {
  appendUvTextureLayer,
  compileUvTextureWorkspace,
  createUvTextureWorkspace,
  parseUvTextureWorkspace,
  UV_TEXTURE_WORKSPACE_TUNING,
  uvTextureWorkspaceSourceHash,
  type DecodedUvTextureLayer,
  type UvTextureLayer,
  type UvTextureWorkspaceDoc,
  type UvTextureWorkspaceRaster,
} from './uvTextureWorkspace';

const pathFor = (dir: string, relative: string): string => `${dir}/${relative}`;

export function uvTextureWorkspaceLayerPath(dir: string, layer: UvTextureLayer): string {
  return pathFor(dir, layer.source);
}

export function readUvTextureWorkspace(dir: string): UvTextureWorkspaceDoc | null {
  return parseUvTextureWorkspace(readFile(pathFor(dir, UV_TEXTURE_WORKSPACE_TUNING.manifestFile)));
}

export function writeUvTextureWorkspace(dir: string, doc: UvTextureWorkspaceDoc): boolean {
  const validated = parseUvTextureWorkspace(JSON.stringify(doc));
  if (!validated) return false;
  return writeFileBytesAtomic(
    pathFor(dir, UV_TEXTURE_WORKSPACE_TUNING.manifestFile),
    textBytes(JSON.stringify(validated, null, 2)),
  );
}

function installPngSource(dir: string, png: Uint8Array): { source: string; sha256: string } | null {
  const sha256 = sha256Hex(png);
  const source = `${UV_TEXTURE_WORKSPACE_TUNING.sourcePrefix}${sha256}.png`;
  const sourceDir = pathFor(dir, UV_TEXTURE_WORKSPACE_TUNING.sourcePrefix.slice(0, -1));
  if (!mkdir(sourceDir)) return null;
  const destination = pathFor(dir, source);
  if (!exists(destination) && !writeFileBytesAtomic(destination, png)) return null;
  return { source, sha256 };
}

export function ensureUvTextureWorkspace(
  dir: string,
  atlasWidth: number,
  atlasHeight: number,
): UvTextureWorkspaceDoc | null {
  const current = readUvTextureWorkspace(dir);
  if (current) return current;
  const baselinePath = exists(pathFor(dir, 'atlases/raster-base.png'))
    ? 'atlases/raster-base.png'
    : 'atlases/base.png';
  const encoded = readFileBase64(pathFor(dir, baselinePath));
  if (!encoded) return null;
  let png: Uint8Array;
  try { png = base64ToBytes(encoded); }
  catch { return null; }
  const decoded = image(png).raw();
  if (!decoded || decoded.width !== atlasWidth || decoded.height !== atlasHeight) return null;
  const installed = installPngSource(dir, png);
  if (!installed) return null;
  const doc = createUvTextureWorkspace(installed.source, atlasWidth, atlasHeight);
  return writeUvTextureWorkspace(dir, doc) ? doc : null;
}

export function importUvTextureWorkspaceLayer(
  dir: string,
  doc: UvTextureWorkspaceDoc,
  filePath: string,
  x: number,
  y: number,
): { doc: UvTextureWorkspaceDoc; layer: UvTextureLayer } {
  const encoded = readFileBase64(filePath);
  if (!encoded) throw new Error('The selected image could not be read.');
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(encoded); }
  catch { throw new Error('The selected image bytes were invalid.'); }
  const name = filePath.replace(/\\/g, '/').split('/').pop() || `image-${doc.nextLayer}.png`;
  return importUvTextureWorkspaceLayerBytes(dir, doc, bytes, name, x, y);
}

/** Install an already-encoded image without routing through a picker or a
 * temporary path. Patch-local baking uses this deep boundary so one button
 * press either commits a model-local content address or returns an exact error. */
export function importUvTextureWorkspaceLayerBytes(
  dir: string,
  doc: UvTextureWorkspaceDoc,
  bytes: Uint8Array,
  name: string,
  x: number,
  y: number,
): { doc: UvTextureWorkspaceDoc; layer: UvTextureLayer } {
  const decoded = image(bytes).raw();
  if (!decoded) throw new Error('The selected file is not a decodable image.');
  if (decoded.width > UV_TEXTURE_WORKSPACE_TUNING.maxDimension
    || decoded.height > UV_TEXTURE_WORKSPACE_TUNING.maxDimension
    || decoded.width * decoded.height * 4 > UV_TEXTURE_WORKSPACE_TUNING.maxRgbaBytes) {
    throw new Error(`The image exceeds the ${UV_TEXTURE_WORKSPACE_TUNING.maxDimension}px texture limit.`);
  }
  const png = encodeImage(decoded.rgba, decoded.width, decoded.height, { format: 'png' });
  if (!png) throw new Error('The image could not be normalized to a lossless PNG source.');
  const installed = installPngSource(dir, png);
  if (!installed) throw new Error('The image source could not be stored in the model package.');
  const next = appendUvTextureLayer(doc, {
    name: name.trim().slice(0, 256) || `image-${doc.nextLayer}.png`,
    source: installed.source,
    x: Math.round(x),
    y: Math.round(y),
    width: decoded.width,
    height: decoded.height,
    visible: true,
    locked: false,
  });
  if (!writeUvTextureWorkspace(dir, next)) throw new Error('The UV workspace manifest could not be saved.');
  return { doc: next, layer: next.layers[next.layers.length - 1]! };
}

export async function rasterizeUvTextureWorkspace(
  dir: string,
  doc: UvTextureWorkspaceDoc,
  onProgress?: (completed: number, total: number, label: string) => void,
): Promise<UvTextureWorkspaceRaster> {
  const decoded: DecodedUvTextureLayer[] = [];
  const visibleLayers = doc.layers.filter((layer) => layer.visible);
  for (let index = 0; index < visibleLayers.length; index += 1) {
    const layer = visibleLayers[index]!;
    onProgress?.(index, visibleLayers.length + 1, `Reading ${layer.name}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const encoded = readFileBase64(uvTextureWorkspaceLayerPath(dir, layer));
    let png: Uint8Array | null = null;
    try { png = encoded ? base64ToBytes(encoded) : null; }
    catch { png = null; }
    const expectedHash = uvTextureWorkspaceSourceHash(layer.source);
    if (!png || !expectedHash || sha256Hex(png) !== expectedHash) {
      throw new Error(`${layer.name} no longer matches its content-addressed source.`);
    }
    const raw = image(png).raw();
    if (!raw) throw new Error(`${layer.name} is missing or unreadable.`);
    decoded.push({ layer, rgba: raw.rgba, width: raw.width, height: raw.height });
  }
  onProgress?.(visibleLayers.length, visibleLayers.length + 1, 'Compositing image layers');
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return compileUvTextureWorkspace(doc, decoded);
}

export function commitUvTextureWorkspaceCompile(
  dir: string,
  doc: UvTextureWorkspaceDoc,
  raster: UvTextureWorkspaceRaster,
  atlasSha256: string,
): UvTextureWorkspaceDoc | null {
  const compiled: UvTextureWorkspaceDoc = {
    ...doc,
    compiled: {
      revision: doc.revision,
      originX: raster.x,
      originY: raster.y,
      width: raster.width,
      height: raster.height,
      atlasSha256,
    },
  };
  return writeUvTextureWorkspace(dir, compiled) ? compiled : null;
}
