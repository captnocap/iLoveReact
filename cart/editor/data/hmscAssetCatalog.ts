import { listDir, readFile, stat } from '../../../runtime/hooks/fs';
import {
  HMSC_BROWSE_SHADER_PRESETS,
  HMSC_SHADERS,
  defaultShaderData,
  shaderSpec,
} from '../textures/shaders';
import { validateDecalDoc } from '../textures/decal';
import { editMeshToGeometry, type EditMesh } from '../model/editMesh';
import type { Asset, ContentFolderId, ContentNode, ModelAtlas, ModelPackage } from './types';
import { MODEL_PACKAGE_SUBDIRS } from './modelPackage';

const MODEL_SNAPSHOT = 'cart/hmsc-int/data/domains/model/snapshots/model.snapshot.json';
const COOKED_SNAPSHOT = 'cart/hmsc-int/data/domains/cooked-asset/snapshots/cooked-asset.snapshot.json';
const MATERIALS_SNAPSHOT = 'cart/hmsc-int/data/domains/materials/snapshots/materials.snapshot.json';
const IMPORTED_PROPS_DATA = 'cart/hmsc-int/game/kinds/importedProps.data.json';
const MODEL_SOURCE_DIR = 'cart/hmsc-int';
const TEXTURE_DIR = 'cart/hmsc-int/assets/tex';
const SHADER_SOURCE = 'cart/hmsc-int/game/textures/shaders.ts';

type StoredMaterial = {
  id: string;
  label: string;
  shaderId?: string;
  data?: number[];
  decal?: unknown;
};

type MaterialsSnapshot = {
  state?: {
    materials?: Record<string, StoredMaterial>;
    order?: string[];
  };
};

type CookedAsset = {
  id: string;
  hash?: string;
  kind?: string;
  name?: string;
  schema?: number;
  meshRef?: string;
  texRef?: string | null;
  collision?: {
    footprintWidthMeters?: number;
    footprintDepthMeters?: number;
    footprintRadiusMeters?: number;
    heightMeters?: number;
    boundsRadius?: number;
  };
  mounts?: unknown[];
  slots?: Array<{
    id?: string;
    label?: string;
    defaultMaterial?: string;
    start?: number;
    count?: number;
  }>;
  descriptor?: {
    kind?: string;
    label?: string;
    solid?: boolean;
    tileKind?: string;
    trafficControl?: string;
  };
};

type CookedSnapshot = {
  state?: {
    assets?: Record<string, CookedAsset>;
    meshBlobs?: Record<string, number[]>;
    textureBlobs?: Record<string, string>;
    order?: string[];
  };
};

type StoredPart = {
  id?: string;
  name?: string;
  color?: string;
  visible?: boolean;
  lift?: number;
  version?: number;
  paint?: Record<string, number>;
  mesh?: {
    verts?: unknown[];
    faces?: Array<{ loop?: unknown[] }>;
  };
};

type StoredModel = {
  id: string;
  name?: string;
  parts?: Record<string, StoredPart>;
  order?: string[];
  palette?: {
    variant?: number;
    slots?: Array<{
      id?: number;
      name?: string;
      pseudo?: string;
      kind?: string;
      colors?: string[];
      material?: { slug?: string; variant?: number };
      worldPerTile?: number;
    }>;
  };
  paintRef?: string;
  decals?: unknown[];
  seatRig?: unknown[];
};

type ModelSnapshot = {
  state?: {
    models?: Record<string, StoredModel>;
    order?: string[];
    paintBlobs?: Record<string, string>;
  };
};

type ImportedPropSource = {
  kind?: string;
  label?: string;
  source?: string;
  heightMeters?: number;
  footprintWidthMeters?: number;
  footprintDepthMeters?: number;
  footprintRadiusMeters?: number;
  color?: number[];
  solid?: boolean;
  coverClass?: string;
};

type ImportedPropsData = {
  props?: ImportedPropSource[];
};

export type CatalogDiagnostics = {
  source: string;
  loadedMs: number;
  shaderRecipes: number;
  shaderPresets: number;
  storedMaterials: number;
  textureFiles: number;
  cookedAssets: number;
  savedModels: number;
  meshBlobs: number;
  textureBlobs: number;
  errors: string[];
};

export type HmscEditorCatalog = {
  assets: Asset[];
  modelPackages: ModelPackage[];
  contentTree: ContentNode[];
  defaultAssetId: string;
  defaultContentFolder: `model-${string}` | 'models-build' | 'models-props' | 'materials-core';
  diagnostics: CatalogDiagnostics;
};

let cookedTextureBlobs: Record<string, string> = {};
let cookedMeshBlobs: Record<string, number[]> = {};
let cookedAssetMeshRefs: Record<string, string> = {};
let storedModelMeshes: Record<string, Float32Array> = {};
// Per studio model: one face-group id per rendered triangle (same order as the
// vertex buffer), so the host mesh editor can regroup the fan-triangulated soup
// back into the original authored faces. See storedModelVertices / editMeshToGeometry.
let storedModelFaceGroups: Record<string, Uint32Array> = {};

export const HMSC_EDITOR_CATALOG: HmscEditorCatalog = loadHmscEditorCatalog();

export function textureBlobDataUrl(ref: string): string | null {
  const blob = cookedTextureBlobs[ref];
  if (!blob) return null;
  return blob.startsWith('data:image/') ? blob : `data:image/png;base64,${blob}`;
}

export function cookedMeshBlobData(ref: string): Float32Array | null {
  const blob = cookedMeshBlobs[ref];
  return blob ? new Float32Array(blob) : null;
}

export function cookedMeshRefForAsset(assetId: string): string | null {
  return cookedAssetMeshRefs[assetId] ?? null;
}

export function storedModelMeshData(modelId: string): Float32Array | null {
  return storedModelMeshes[modelId] ?? null;
}

export function storedModelFaceGroupData(modelId: string): Uint32Array | null {
  return storedModelFaceGroups[modelId] ?? null;
}

function loadHmscEditorCatalog(): HmscEditorCatalog {
  const started = Date.now();
  const errors: string[] = [];
  const materials = readJson<MaterialsSnapshot>(MATERIALS_SNAPSHOT, errors);
  const cooked = readJson<CookedSnapshot>(COOKED_SNAPSHOT, errors);
  const models = readJson<ModelSnapshot>(MODEL_SNAPSHOT, errors);
  const importedProps = readJson<ImportedPropsData>(IMPORTED_PROPS_DATA, errors);
  cookedTextureBlobs = cooked?.state?.textureBlobs ?? {};
  cookedMeshBlobs = cooked?.state?.meshBlobs ?? {};
  cookedAssetMeshRefs = Object.fromEntries(
    Object.values(cooked?.state?.assets ?? {})
      .filter((asset) => Boolean(asset.id && asset.meshRef))
      .map((asset) => [asset.id, asset.meshRef]),
  );
  const storedViewer = storedModelViewerMeshes(models);
  storedModelMeshes = storedViewer.meshes;
  storedModelFaceGroups = storedViewer.faceGroups;

  const materialAssets = [
    ...shaderRecipeAssets(),
    ...storedMaterialAssets(materials),
    ...textureFileAssets(),
    ...shaderPresetAssets(),
  ];
  const cookedAssets = cookedAssetRows(cooked);
  const importedViewerSources = importedPropViewerSources(importedProps);
  const looseViewerSources = looseModelSources(importedViewerSources);
  const viewerModelCount = importedViewerSources.size + looseViewerSources.length;
  const modelPackages = dedupeModelsByName([
    ...importedPropModelPackages(importedProps),
    ...looseModelFilePackages(looseViewerSources),
    ...cookedModelPackages(cooked),
    ...storedModelPackages(models),
  ]).sort((a, b) => modelRank(a) - modelRank(b) || a.name.localeCompare(b.name));
  const assets = [...materialAssets, ...cookedAssets].sort((a, b) => sourceRank(a) - sourceRank(b) || a.name.localeCompare(b.name));
  const defaultAsset = assets.find((asset) => asset.tab === 'Skins') ?? assets[0];
  const defaultContentFolder = materialAssets.length > 0
    ? 'materials-core'
    : modelPackages.some((model) => model.kind === 'build')
      ? 'models-build'
      : modelPackages.some((model) => model.kind === 'prop')
        ? 'models-props'
        : 'materials-core';

  return {
    assets,
    modelPackages,
    contentTree: contentTree(modelPackages),
    defaultAssetId: defaultAsset?.id ?? '',
    defaultContentFolder,
    diagnostics: {
      source: 'hmsc-int snapshots + shader registry + source model files',
      loadedMs: Date.now() - started,
      shaderRecipes: HMSC_SHADERS.length,
      shaderPresets: HMSC_BROWSE_SHADER_PRESETS.length,
      storedMaterials: Object.keys(materials?.state?.materials ?? {}).length,
      textureFiles: textureFilenames().length,
      cookedAssets: Object.keys(cooked?.state?.assets ?? {}).length,
      savedModels: Object.keys(models?.state?.models ?? {}).length + viewerModelCount,
      meshBlobs: Object.keys(cooked?.state?.meshBlobs ?? {}).length,
      textureBlobs: Object.keys(cooked?.state?.textureBlobs ?? {}).length,
      errors,
    },
  };
}

function storedModelViewerMeshes(snapshot: ModelSnapshot | null): {
  meshes: Record<string, Float32Array>;
  faceGroups: Record<string, Uint32Array>;
} {
  const meshes: Record<string, Float32Array> = {};
  const faceGroups: Record<string, Uint32Array> = {};
  Object.values(snapshot?.state?.models ?? {}).forEach((model) => {
    const built = storedModelVertices(model);
    if (built.positions.length > 0) {
      meshes[model.id] = built.positions;
      faceGroups[model.id] = built.faceGroups;
    }
  });
  return { meshes, faceGroups };
}

// Merge every visible part's triangulated geometry into one interleaved vertex
// buffer, and build a parallel per-triangle face-group array (one id per triangle,
// same order). Each part's face ids are offset so faces from different parts never
// collide — a group id uniquely names one authored face across the whole model.
function storedModelVertices(model: StoredModel): { positions: Float32Array; faceGroups: Uint32Array } {
  const chunks: Float32Array[] = [];
  const groupChunks: number[][] = [];
  let total = 0;
  let groupTotal = 0;
  let groupBase = 0;
  orderedParts(model).forEach((part) => {
    if (part.visible === false || !isEditMesh(part.mesh)) return;
    const localGroups: number[] = [];
    const lifted = applyPartLift(editMeshToGeometry(part.mesh, undefined, localGroups).positions, part.lift ?? 0);
    if (lifted.length === 0) return;
    chunks.push(lifted);
    total += lifted.length;
    groupChunks.push(localGroups.map((fi) => groupBase + fi));
    groupTotal += localGroups.length;
    groupBase += part.mesh.faces.length;
  });
  const positions = new Float32Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { positions.set(chunk, offset); offset += chunk.length; });
  const faceGroups = new Uint32Array(groupTotal);
  let groupOffset = 0;
  groupChunks.forEach((chunk) => { faceGroups.set(chunk, groupOffset); groupOffset += chunk.length; });
  return { positions, faceGroups };
}

function isEditMesh(mesh: StoredPart['mesh']): mesh is EditMesh {
  return Boolean(mesh && Array.isArray(mesh.verts) && Array.isArray(mesh.faces));
}

function applyPartLift(vertices: Float32Array, lift: number): Float32Array {
  if (lift === 0) return vertices;
  const out = new Float32Array(vertices);
  for (let index = 1; index < out.length; index += 8) out[index] += lift;
  return out;
}

function importedPropViewerSources(data: ImportedPropsData | null): Set<string> {
  const sources = new Set<string>();
  (data?.props ?? []).forEach((prop) => {
    const source = prop.source ?? '';
    const info = source ? stat(source) : null;
    if (info && !info.isDir && isViewerFile(source)) sources.add(source);
  });
  return sources;
}

function importedPropModelPackages(data: ImportedPropsData | null): ModelPackage[] {
  return (data?.props ?? []).flatMap((prop) => {
    const source = prop.source ?? '';
    const info = source ? stat(source) : null;
    if (!info || info.isDir || !isViewerFile(source)) return [];
    const label = prop.label || prop.kind || source.split('/').pop() || 'Imported Model';
    const kind = prop.kind || slug(label);
    const sourceFile = source.split('/').pop() || source;
    return [{
      id: `imported:${kind}`,
      folderId: modelFolderId(`imported-${kind}`),
      name: label,
      path: `/Game/Models/Imported/${label}`,
      kind: 'prop',
      stage: 'ready',
      color: colorFromFloatRgb(prop.color) ?? colorFor(kind),
      source,
      viewerPath: source,
      rig: prop.solid ? 'solid imported prop' : 'visual imported prop',
      data: `file ${sourceFile}`,
      triangles: 0,
      lods: 0,
      decompositions: [
        `kind:${kind}`,
        `source:${sourceFile}`,
        prop.coverClass ? `cover:${prop.coverClass}` : 'cover:-',
        prop.heightMeters ? `height:${prop.heightMeters}m` : 'height:-',
      ],
      atlases: [],
      paints: [],
      sourceKind: 'imported-prop',
      semanticKind: 'imported prop',
    }];
  });
}

function looseModelSources(skip: Set<string>): string[] {
  return listDir(MODEL_SOURCE_DIR)
    .map((name) => `${MODEL_SOURCE_DIR}/${name}`)
    .filter((path) => !skip.has(path) && isViewerFile(path))
    .filter((path) => {
      const info = stat(path);
      return Boolean(info && !info.isDir);
    });
}

function looseModelFilePackages(sources: string[]): ModelPackage[] {
  return sources.map((source) => {
    const sourceFile = source.split('/').pop() || source;
    const name = titleFromFilename(sourceFile);
    const semantic = semanticKindFromText(name);
    return {
      id: `source:${slug(source)}`,
      folderId: modelFolderId(`source-${source}`),
      name,
      path: `/Game/Models/Source/${sourceFile}`,
      kind: cookedUiCategory(semantic),
      stage: 'ready',
      color: colorFor(source),
      source,
      viewerPath: source,
      rig: 'source model file',
      data: `file ${sourceFile}`,
      triangles: 0,
      lods: 0,
      decompositions: [
        `semantic:${semantic}`,
        `format:${sourceFile.split('.').pop()?.toLowerCase() ?? '-'}`,
        'source:hmsc-int',
      ],
      atlases: [],
      paints: [],
      sourceKind: 'source-file',
      semanticKind: semantic,
    };
  });
}

function isViewerFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.glb') || lower.endsWith('.obj');
}

function colorFromFloatRgb(rgb: number[] | undefined): string | null {
  if (!rgb || rgb.length < 3) return null;
  const toByte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  const hex = (value: number) => toByte(value).toString(16).padStart(2, '0');
  return `#${hex(rgb[0] ?? 0)}${hex(rgb[1] ?? 0)}${hex(rgb[2] ?? 0)}`;
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  return base
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readJson<T>(path: string, errors: string[]): T | null {
  const raw = readFile(path);
  if (!raw) {
    errors.push(`missing ${path}`);
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    errors.push(`invalid json ${path}`);
    return null;
  }
}

function shaderRecipeAssets(): Asset[] {
  return HMSC_SHADERS.map((spec) => {
    const data = defaultShaderData(spec);
    return {
      id: `shader:${spec.id}`,
      tab: 'Skins',
      name: spec.label,
      color: colorFor(`${spec.id}:${data.join(',')}`),
      used: 0,
      recipe: spec.id,
      seed: numberAt(data, 2),
      variants: spec.variants.map((variant) => variant.label),
      sourceKind: 'shader-recipe',
      sourceId: spec.id,
      sourcePath: SHADER_SOURCE,
      semanticKind: spec.group,
      stats: [`${spec.base.length} params`, `${spec.variants.length} variants`],
      preview: { kind: 'shader', shader: spec.shader, data },
    };
  });
}

function shaderPresetAssets(): Asset[] {
  return HMSC_BROWSE_SHADER_PRESETS.map((preset) => {
    const spec = shaderSpec(preset.shaderId);
    return {
      id: `shader-preset:${preset.id}`,
      tab: 'Skins',
      name: preset.label,
      color: colorFor(`${preset.id}:${preset.data.join(',')}`),
      used: 0,
      recipe: preset.shaderId,
      seed: numberAt(preset.data, 2),
      variants: spec?.variants.map((variant) => variant.label) ?? ['preset'],
      sourceKind: 'shader-preset',
      sourceId: preset.id,
      sourcePath: SHADER_SOURCE,
      semanticKind: preset.group,
      stats: [`D[${preset.data.length}]`, preset.group],
      preview: { kind: 'shader', shader: preset.shader, data: preset.data },
    };
  });
}

function storedMaterialAssets(snapshot: MaterialsSnapshot | null): Asset[] {
  const state = snapshot?.state;
  const materials = state?.materials ?? {};
  const order = state?.order?.length ? state.order : Object.keys(materials);
  return order.flatMap((id) => {
    const material = materials[id];
    if (!material) return [];
    const isDecal = Boolean(material.decal);
    const data = material.data ?? [];
    const spec = material.shaderId ? shaderSpec(material.shaderId) : undefined;
    const decal = material.decal ? validateDecalDoc(material.decal) : null;
    const color = isDecal ? decalColor(material) : colorFor(`${material.id}:${data.join(',')}`);
    return [{
      id: `stored-material:${material.id}`,
      tab: 'Skins',
      name: material.label || material.id,
      color,
      used: 0,
      recipe: isDecal ? 'stored decal' : material.shaderId ?? 'stored material',
      seed: numberAt(data, 2),
      variants: isDecal ? decalVariants(material) : spec?.variants.map((variant) => variant.label) ?? [`D[${data.length}]`],
      sourceKind: 'stored-material',
      sourceId: material.id,
      sourcePath: MATERIALS_SNAPSHOT,
      semanticKind: isDecal ? 'Stored Decals' : spec?.group ?? 'Stored Materials',
      stats: isDecal
        ? [`${decal?.nodes.length ?? 0} nodes`, `${decal?.width ?? 0}x${decal?.height ?? 0}`]
        : [`shader ${material.shaderId ?? '-'}`, `D[${data.length}]`],
      preview: decal
        ? { kind: 'decal', doc: decal }
        : spec
          ? { kind: 'shader', shader: spec.shader, data }
          : { kind: 'color', color },
    }];
  });
}

function textureFileAssets(): Asset[] {
  return textureFilenames().map((filename) => {
    const path = `${TEXTURE_DIR}/${filename}`;
    const info = stat(path);
    const ext = filename.split('.').pop()?.toUpperCase() ?? 'IMG';
    return {
      id: `texture-file:${filename}`,
      tab: 'Skins',
      name: filename.replace(/\.[^.]+$/, ''),
      color: colorFor(filename),
      used: 0,
      recipe: 'stored texture file',
      variants: [ext, 'file'],
      sourceKind: 'texture-file',
      sourceId: filename,
      sourcePath: path,
      semanticKind: 'Stored Texture Files',
      stats: [info ? `${Math.round(info.size / 1024)} KB` : 'size -', path],
      preview: { kind: 'image', source: path },
    };
  });
}

function textureFilenames(): string[] {
  return listDir(TEXTURE_DIR)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function cookedAssetRows(snapshot: CookedSnapshot | null): Asset[] {
  const state = snapshot?.state;
  const assets = state?.assets ?? {};
  const order = state?.order?.length ? state.order : Object.keys(assets);
  return order.flatMap((id) => {
    const asset = assets[id];
    if (!asset) return [];
    const semantic = semanticKind(asset);
    const category = cookedUiCategory(semantic);
    return [{
      id: `cooked:${asset.id}`,
      tab: category === 'build' ? 'Build' : 'Props',
      name: displayName(asset),
      color: cookedColor(asset),
      used: 0,
      recipe: semantic,
      variants: cookedVariants(asset),
      sourceKind: 'cooked-asset',
      sourceId: asset.id,
      sourcePath: COOKED_SNAPSHOT,
      semanticKind: semantic,
      stats: cookedStats(asset, state?.meshBlobs?.[asset.meshRef ?? '']?.length ?? 0),
      preview: asset.texRef ? { kind: 'texture-blob', ref: asset.texRef } : { kind: 'color', color: cookedColor(asset) },
    }];
  });
}

function cookedModelPackages(snapshot: CookedSnapshot | null): ModelPackage[] {
  const state = snapshot?.state;
  const assets = state?.assets ?? {};
  const order = state?.order?.length ? state.order : Object.keys(assets);
  return order.flatMap((id) => {
    const asset = assets[id];
    if (!asset) return [];
    const semantic = semanticKind(asset);
    const category = cookedUiCategory(semantic);
    const meshFloats = state?.meshBlobs?.[asset.meshRef ?? '']?.length ?? 0;
    const triangles = Math.floor(meshFloats / 8 / 3);
    const textureBytes = asset.texRef ? state?.textureBlobs?.[asset.texRef]?.length ?? 0 : 0;
    return [{
      id: `cooked:${asset.id}`,
      folderId: modelFolderId(`cooked-${asset.id}`),
      name: displayName(asset),
      path: `/Game/Models/${category === 'build' ? 'Build Pieces' : 'Props'}/${displayName(asset)}`,
      kind: category === 'build' ? 'build' : 'prop',
      stage: 'ready',
      color: cookedColor(asset),
      source: `${COOKED_SNAPSHOT}:${asset.id}`,
      viewerMeshRef: asset.meshRef,
      rig: `${asset.mounts?.length ?? 0} mounts`,
      data: asset.hash ? `hash ${short(asset.hash)}` : `schema ${asset.schema ?? '-'}`,
      triangles,
      lods: 0,
      decompositions: [
        `semantic:${semantic}`,
        asset.meshRef ? `mesh:${short(asset.meshRef)}` : 'mesh:-',
        asset.texRef ? `texture:${short(asset.texRef)}` : 'texture:-',
      ],
      atlases: cookedAtlases(asset, triangles, textureBytes),
      // Paint variants are saved paintings, held live in the editor store (paintVariants.ts),
      // not derived from the snapshot — the package carries none.
      paints: [],
      sourceKind: 'cooked-asset',
      semanticKind: semantic,
    }];
  });
}

function storedModelPackages(snapshot: ModelSnapshot | null): ModelPackage[] {
  const state = snapshot?.state;
  const models = state?.models ?? {};
  const order = state?.order?.length ? state.order : Object.keys(models);
  return order.flatMap((id) => {
    const model = models[id];
    if (!model) return [];
    const name = model.name || model.id;
    const parts = orderedParts(model);
    const triangles = parts.reduce((sum, part) => sum + partTriangles(part), 0);
    // Skip meshless studio models — the empty "new_mesh_*" rows the editor
    // saved with no geometry. They have no mesh, no thumbnail, and only clutter
    // the browser; the real (named) models all carry triangles.
    if (triangles === 0) return [];
    const paletteSlots = model.palette?.slots ?? [];
    const color = paletteSlots[0]?.pseudo ?? parts.find((part) => part.color)?.color ?? colorFor(model.id);
    const semantic = semanticKindFromText(name);
    return [{
      id: `studio:${model.id}`,
      folderId: modelFolderId(`studio-${model.id}`),
      name,
      path: `/Game/Models/Saved Studio/${name}`,
      kind: cookedUiCategory(semantic) === 'build' ? 'build' : 'prop',
      stage: 'wip',
      color,
      source: `${MODEL_SNAPSHOT}:${model.id}`,
      rig: `${model.seatRig?.length ?? 0} seat faces`,
      data: `${parts.length} parts`,
      triangles,
      lods: 0,
      decompositions: [
        `parts:${parts.length}`,
        model.paintRef ? `paint:${short(model.paintRef)}` : 'paint:-',
        `palette:${paletteSlots.length}`,
      ],
      atlases: storedModelAtlases(model, color),
      // Paint variants live in the editor store (paintVariants.ts), read live per model — the
      // snapshot package carries none (the old palette-slot fabrication is gone).
      paints: [],
      sourceKind: 'studio-model',
      semanticKind: semantic,
    }];
  });
}

// The Models subtree IS the on-disk Model Package layout, dug into like a file
// explorer (models/<category>/<model>/<subdir>/, see modelPackage.ts): category
// dirs -> per-model homes -> the mesh/atlases/paints/shaders subdirs. Every
// level is a real, expandable tree node so the browser mirrors the packages
// end to end instead of stopping at source-kind buckets.

// A model's package subdirectories as leaf nodes. Ids extend the model's folder
// id (model-<id>/<sub>), which still satisfies the `model-${string}` union.
function modelSubdirNodes(model: ModelPackage): ContentNode[] {
  return MODEL_PACKAGE_SUBDIRS.map((sub) => ({
    id: `${model.folderId}/${sub}` as ContentFolderId,
    label: sub,
    icon: 'Folder',
  }));
}

// One home per model under its category, each expandable into its subdirs.
function modelHomeNodes(models: ModelPackage[]): ContentNode[] {
  return [...models]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((model) => ({
      id: model.folderId,
      label: model.name,
      icon: 'Box',
      children: modelSubdirNodes(model),
    }));
}

export function modelCategoryNodes(models: ModelPackage[]): ContentNode[] {
  const categories: Array<[ModelPackage['kind'], ContentFolderId, string]> = [
    ['prop', 'models-props', 'Props'],
    ['build', 'models-build', 'Build'],
    ['character', 'models-characters', 'Characters'],
    ['vehicle', 'models-vehicles', 'Vehicles'],
  ];
  return categories
    .filter(([kind]) => models.some((model) => model.kind === kind))
    .map(([kind, id, label]) => ({
      id,
      label,
      children: modelHomeNodes(models.filter((model) => model.kind === kind)),
    }));
}

function contentTree(models: ModelPackage[]): ContentNode[] {
  return [
    {
      id: 'game',
      label: '/Game',
      children: [
        { id: 'audio', label: 'Audio' },
        { id: 'characters', label: 'Characters' },
        { id: 'locations', label: 'Locations' },
        {
          id: 'models',
          label: 'Models',
          icon: 'Box',
          children: modelCategoryNodes(models),
        },
        {
          id: 'missions',
          label: 'Missions',
          children: [
            {
              id: 'bankheist',
              label: 'BankHeist',
              children: [
                { id: 'mission-assets', label: 'Assets' },
                { id: 'scripts', label: 'Scripts' },
                { id: 'ui', label: 'UI' },
              ],
            },
          ],
        },
        {
          id: 'materials',
          label: 'Global Materials',
          children: [
            { id: 'materials-core', label: 'Recipes + Stored' },
            { id: 'materials-generated', label: 'Shader Presets' },
            { id: 'materials-favorites', label: 'Favorites' },
            { id: 'materials-recent', label: 'Recent' },
          ],
        },
        {
          id: 'architecture',
          label: 'Architecture',
          children: [
            { id: 'build-pieces', label: 'Build Pieces' },
            { id: 'prefabs', label: 'Prefabs' },
          ],
        },
        { id: 'vehicles', label: 'Vehicles' },
        { id: 'weapons', label: 'Weapons' },
        { id: 'props', label: 'Props' },
        { id: 'fx', label: 'FX' },
      ],
    },
  ];
}

function cookedAtlases(asset: CookedAsset, triangles: number, textureBytes: number): ModelAtlas[] {
  const rows: ModelAtlas[] = [{
    id: `${asset.id}:mesh`,
    label: 'mesh blob',
    scope: triangles > 0 ? `${formatCount(triangles)} tris` : 'geometry stored',
    resolution: 'content-addressed',
    paints: asset.slots?.length ?? 0,
    color: cookedColor(asset),
  }];
  if (asset.texRef) {
    rows.push({
      id: `${asset.id}:texture`,
      label: `texture/${short(asset.texRef)}`,
      scope: 'stored texture blob',
      resolution: textureBytes > 0 ? `${Math.round(textureBytes / 1024)} KB b64` : 'stored',
      paints: asset.slots?.length ?? 0,
      color: cookedColor(asset),
    });
  }
  return rows;
}

function storedModelAtlases(model: StoredModel, color: string): ModelAtlas[] {
  const parts = orderedParts(model);
  const rows: ModelAtlas[] = [{
    id: `${model.id}:parts`,
    label: 'parts',
    scope: 'saved Studio geometry',
    resolution: `${parts.length} parts`,
    paints: 0,
    color,
  }];
  if (model.paintRef) {
    rows.push({
      id: `${model.id}:paint`,
      label: `paint/${short(model.paintRef)}`,
      scope: 'content-addressed paint texture',
      resolution: 'stored blob ref',
      paints: 0,
      color,
    });
  }
  return rows;
}

function orderedParts(model: StoredModel): StoredPart[] {
  const parts = model.parts ?? {};
  const ids = model.order?.length ? model.order : Object.keys(parts);
  return ids.flatMap((id) => {
    const part = parts[id];
    return part ? [part] : [];
  });
}

function partTriangles(part: StoredPart): number {
  return (part.mesh?.faces ?? []).reduce((sum, face) => sum + Math.max(0, (face.loop?.length ?? 0) - 2), 0);
}

function semanticKind(asset: CookedAsset): string {
  return semanticKindFromText(`${asset.id} ${asset.name ?? ''} ${asset.descriptor?.label ?? ''}`);
}

function semanticKindFromText(value: string): string {
  const text = value.toLowerCase().replace(/[_-]+/g, ' ');
  if (/\bfloor\b/.test(text) || /\bstage\b/.test(text)) return 'floor';
  if (/\bdoor\b|\bgarage\b|\bentrance\b/.test(text)) return 'door';
  if (/\bwindow\b|\bglass\b/.test(text)) return 'window';
  if (/\bfence\b|\brailing\b/.test(text)) return 'fence';
  if (/\bstep\b|\bstair\b|\bramp\b/.test(text)) return 'stairs';
  if (/\bpillar\b|\bcolumn\b/.test(text)) return 'pillar';
  if (/\bwall\b|\bcover\b|\bpanel\b|\bblock\b|\bbalcony\b/.test(text)) return 'wall';
  if (/\bsign\b|\bbillboard\b|\bflyer\b|\bair conditioner\b|\bac\b/.test(text)) return 'sign';
  return 'prop';
}

function cookedUiCategory(semantic: string): 'build' | 'prop' {
  return ['wall', 'floor', 'door', 'window', 'fence', 'stairs', 'pillar', 'sign'].includes(semantic) ? 'build' : 'prop';
}

function cookedColor(asset: CookedAsset): string {
  const slotColor = asset.slots?.find((slot) => /^#[0-9a-f]{6}$/i.test(slot.defaultMaterial ?? ''))?.defaultMaterial;
  return slotColor ?? colorFor(`${asset.id}:${asset.hash ?? ''}`);
}

function cookedVariants(asset: CookedAsset): string[] {
  const slots = (asset.slots ?? []).map((slot) => slot.label ?? slot.id).filter(Boolean) as string[];
  if (slots.length > 0) return slots.slice(0, 3);
  const semantic = semanticKind(asset);
  return [semantic, asset.texRef ? 'textured' : 'mesh', asset.descriptor?.tileKind ?? 'cooked'];
}

function cookedStats(asset: CookedAsset, meshFloats: number): string[] {
  const triangles = Math.floor(meshFloats / 8 / 3);
  return [
    triangles > 0 ? `${formatCount(triangles)} tris` : 'tris -',
    `${asset.slots?.length ?? 0} slots`,
    asset.texRef ? `tex ${short(asset.texRef)}` : 'tex -',
  ];
}

function displayName(asset: CookedAsset): string {
  return asset.descriptor?.label || asset.name || asset.id.replace(/^studio\./, '');
}

function modelFolderId(seed: string): `model-${string}` {
  return `model-${slug(seed)}`;
}

// A single model can exist in more than one source: you author it in the studio
// mesh editor (studio-model), then export it as a prop to get it into the game
// (imported-prop / cooked-asset / source-file). Those are the SAME model, so the
// browser must show one row, not two. Collapse by name, keeping the most-editable
// source (the studio original) over its exported/baked copies.
function modelSourcePriority(model: ModelPackage): number {
  switch (model.sourceKind) {
    case 'studio-model': return 0;  // the editable original you authored
    case 'source-file': return 1;   // a raw imported mesh file
    case 'imported-prop': return 2; // an exported/imported prop
    case 'cooked-asset': return 3;  // the baked game output
    default: return 4;
  }
}

function dedupeModelsByName(models: ModelPackage[]): ModelPackage[] {
  const byName = new Map<string, ModelPackage>();
  for (const model of models) {
    const key = model.name.trim().toLowerCase();
    const existing = byName.get(key);
    if (!existing || modelSourcePriority(model) < modelSourcePriority(existing)) {
      byName.set(key, model);
    }
  }
  return [...byName.values()];
}

function modelRank(model: ModelPackage): number {
  if (model.kind === 'build' && model.stage === 'ready') return 0;
  if (model.kind === 'prop' && model.stage === 'ready') return 1;
  if (model.kind === 'build') return 2;
  return 3;
}

function sourceRank(asset: Asset): number {
  if (asset.tab === 'Skins' && asset.sourceKind === 'shader-recipe') return 0;
  if (asset.tab === 'Skins' && asset.sourceKind === 'stored-material') return 1;
  if (asset.tab === 'Skins' && asset.sourceKind === 'texture-file') return 2;
  if (asset.tab === 'Skins') return 3;
  if (asset.tab === 'Build') return 4;
  return 5;
}

function decalColor(material: StoredMaterial): string {
  const decal = validateDecalDoc(material.decal);
  const nodeColor = decal?.nodes.find((node) => {
    const color = node.kind === 'rect' ? node.bg : node.kind === 'text' ? node.color : node.kind === 'path' ? node.stroke : '';
    return /^#[0-9a-f]{6}$/i.test(color);
  });
  if (nodeColor?.kind === 'rect') return nodeColor.bg;
  if (nodeColor?.kind === 'text') return nodeColor.color;
  if (nodeColor?.kind === 'path') return nodeColor.stroke;
  return decal?.bg || colorFor(material.id);
}

function decalVariants(material: StoredMaterial): string[] {
  const decal = validateDecalDoc(material.decal);
  const nodes = decal?.nodes ?? [];
  const kinds = Array.from(new Set(nodes.map((node) => node.kind).filter(Boolean))) as string[];
  return (kinds.length ? kinds : ['decal']).slice(0, 3);
}

function numberAt(values: number[], index: number): number | undefined {
  const value = values[index];
  return Number.isFinite(value) ? value : undefined;
}

function colorFor(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 42, 45);
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = light - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] :
    [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

function short(value: string): string {
  return value.slice(0, 8);
}

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
