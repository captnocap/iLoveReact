import { listDir, readFile, stat } from '../../../runtime/hooks/fs';
import {
  HMSC_BROWSE_SHADER_PRESETS,
  HMSC_SHADERS,
  defaultShaderData,
  shaderSpec,
} from '../../hmsc-int/game/textures/shaders';
import type { Asset, ContentNode, ModelAtlas, ModelPackage, ModelPaintVariant } from './types';

const MODEL_SNAPSHOT = 'cart/hmsc-int/data/domains/model/snapshots/model.snapshot.json';
const COOKED_SNAPSHOT = 'cart/hmsc-int/data/domains/cooked-asset/snapshots/cooked-asset.snapshot.json';
const MATERIALS_SNAPSHOT = 'cart/hmsc-int/data/domains/materials/snapshots/materials.snapshot.json';
const TEXTURE_DIR = 'cart/hmsc-int/assets/tex';
const SHADER_SOURCE = 'cart/hmsc-int/game/textures/shaders.ts';

type StoredMaterial = {
  id: string;
  label: string;
  shaderId?: string;
  data?: number[];
  decal?: {
    width?: number;
    height?: number;
    bg?: string;
    nodes?: Array<{ kind?: string; bg?: string; color?: string }>;
  };
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

export const HMSC_EDITOR_CATALOG: HmscEditorCatalog = loadHmscEditorCatalog();

function loadHmscEditorCatalog(): HmscEditorCatalog {
  const started = Date.now();
  const errors: string[] = [];
  const materials = readJson<MaterialsSnapshot>(MATERIALS_SNAPSHOT, errors);
  const cooked = readJson<CookedSnapshot>(COOKED_SNAPSHOT, errors);
  const models = readJson<ModelSnapshot>(MODEL_SNAPSHOT, errors);

  const materialAssets = [
    ...shaderRecipeAssets(),
    ...storedMaterialAssets(materials),
    ...textureFileAssets(),
    ...shaderPresetAssets(),
  ];
  const cookedAssets = cookedAssetRows(cooked);
  const modelPackages = [
    ...cookedModelPackages(cooked),
    ...storedModelPackages(models),
  ].sort((a, b) => modelRank(a) - modelRank(b) || a.name.localeCompare(b.name));
  const assets = [...materialAssets, ...cookedAssets].sort((a, b) => sourceRank(a) - sourceRank(b) || a.name.localeCompare(b.name));
  const defaultAsset = assets.find((asset) => asset.tab === 'Skins') ?? assets[0];
  const defaultContentFolder = modelPackages.some((model) => model.kind === 'build')
    ? 'models-build'
    : modelPackages.some((model) => model.kind === 'prop')
      ? 'models-props'
      : 'materials-core';

  return {
    assets,
    modelPackages,
    contentTree: contentTree(),
    defaultAssetId: defaultAsset?.id ?? '',
    defaultContentFolder,
    diagnostics: {
      source: 'hmsc-int snapshots + shader registry',
      loadedMs: Date.now() - started,
      shaderRecipes: HMSC_SHADERS.length,
      shaderPresets: HMSC_BROWSE_SHADER_PRESETS.length,
      storedMaterials: Object.keys(materials?.state?.materials ?? {}).length,
      textureFiles: textureFilenames().length,
      cookedAssets: Object.keys(cooked?.state?.assets ?? {}).length,
      savedModels: Object.keys(models?.state?.models ?? {}).length,
      meshBlobs: Object.keys(cooked?.state?.meshBlobs ?? {}).length,
      textureBlobs: Object.keys(cooked?.state?.textureBlobs ?? {}).length,
      errors,
    },
  };
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
        ? [`${material.decal?.nodes?.length ?? 0} nodes`, `${material.decal?.width ?? 0}x${material.decal?.height ?? 0}`]
        : [`shader ${material.shaderId ?? '-'}`, `D[${data.length}]`],
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
      paints: cookedPaints(asset),
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
      paints: storedModelPaints(model),
      sourceKind: 'studio-model',
      semanticKind: semantic,
    }];
  });
}

function contentTree(): ContentNode[] {
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
          children: [
            { id: 'models-build', label: 'Build Pieces' },
            { id: 'models-props', label: 'Props' },
            { id: 'models-props-wip', label: 'Saved Studio' },
          ],
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

function cookedPaints(asset: CookedAsset): ModelPaintVariant[] {
  return (asset.slots ?? []).map((slot, index) => ({
    id: `${asset.id}:slot:${slot.id ?? index}`,
    name: slot.label ?? slot.id ?? `slot ${index + 1}`,
    atlas: 'cooked slots',
    used: 0,
    shaderRefs: slot.defaultMaterial ? [slot.defaultMaterial] : [],
    imageRefs: asset.texRef ? [short(asset.texRef)] : [],
    color: slot.defaultMaterial && /^#[0-9a-f]{6}$/i.test(slot.defaultMaterial) ? slot.defaultMaterial : cookedColor(asset),
  }));
}

function storedModelAtlases(model: StoredModel, color: string): ModelAtlas[] {
  const parts = orderedParts(model);
  const rows: ModelAtlas[] = [{
    id: `${model.id}:parts`,
    label: 'parts',
    scope: 'saved Studio geometry',
    resolution: `${parts.length} parts`,
    paints: model.palette?.slots?.length ?? 0,
    color,
  }];
  if (model.paintRef) {
    rows.push({
      id: `${model.id}:paint`,
      label: `paint/${short(model.paintRef)}`,
      scope: 'content-addressed paint texture',
      resolution: 'stored blob ref',
      paints: model.palette?.slots?.length ?? 0,
      color,
    });
  }
  return rows;
}

function storedModelPaints(model: StoredModel): ModelPaintVariant[] {
  const paintRef = model.paintRef ? [short(model.paintRef)] : [];
  return (model.palette?.slots ?? []).map((slot, index) => ({
    id: `${model.id}:palette:${slot.id ?? index}`,
    name: slot.name ?? `slot ${slot.id ?? index + 1}`,
    atlas: `palette v${model.palette?.variant ?? 0}`,
    used: 0,
    shaderRefs: slot.material?.slug ? [slot.material.slug] : [],
    imageRefs: paintRef,
    color: slot.pseudo ?? slot.colors?.[0] ?? colorFor(`${model.id}:${index}`),
  }));
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
  const decal = material.decal;
  const nodeColor = decal?.nodes?.find((node) => /^#[0-9a-f]{6}$/i.test(node.bg ?? node.color ?? ''));
  return nodeColor?.bg ?? nodeColor?.color ?? decal?.bg ?? colorFor(material.id);
}

function decalVariants(material: StoredMaterial): string[] {
  const decal = material.decal;
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
