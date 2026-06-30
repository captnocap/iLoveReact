// editor/data/catalog.ts — asset + material + model-package catalog and helpers.
//
// Cloned from the hmsc-workspace-mock god-file. Pure data + pure helpers.
import type { Asset, AssetOverride, LibraryTab, MaterialSource, ModelPackage } from './types';

export const CORE_MATERIALS: Asset[] = [
  { id: 'grass', tab: 'Skins', name: 'Grass', color: '#426739', favorite: true, recent: true, used: 94, recipe: 'bot-siding', seed: 156, variants: ['v0', 'v1', 'v2'] },
  { id: 'road', tab: 'Skins', name: 'Road', color: '#303136', favorite: true, used: 82, recipe: 'asphalt-crack', seed: 42, variants: ['clean', 'worn', 'wet'] },
  { id: 'concrete', tab: 'Skins', name: 'Concrete', color: '#6f7176', recent: true, used: 75, recipe: 'poured-slab', seed: 88, variants: ['flat', 'stained', 'chipped'] },
  { id: 'brick', tab: 'Skins', name: 'Brick', color: '#9f5547', used: 61, recipe: 'brick-stack', seed: 103, variants: ['red', 'aged', 'painted'] },
  { id: 'sand', tab: 'Skins', name: 'Sand', color: '#c8b176', used: 48, recipe: 'grain-field', seed: 12, variants: ['dry', 'packed', 'dirty'] },
  { id: 'water', tab: 'Skins', name: 'Water', color: '#2e8993', used: 28, recipe: 'shallow-ripple', seed: 76, variants: ['still', 'ripple', 'drain'] },
  { id: 'moss', tab: 'Skins', name: 'Moss', color: '#52643f', used: 22, recipe: 'soft-growth', seed: 33, variants: ['thin', 'heavy', 'edge'] },
  { id: 'tile', tab: 'Skins', name: 'Tile', color: '#878f97', used: 20, recipe: 'ceramic-grid', seed: 57, variants: ['white', 'mint', 'broken'] },
];

export const BUILD_ASSETS: Asset[] = [
  { id: 'wall-kit', tab: 'Build', name: 'Wall Kit', color: '#85909c', favorite: true, used: 91 },
  { id: 'door-cut', tab: 'Build', name: 'Door Cut', color: '#a77e52', recent: true, used: 67 },
  { id: 'shop-front', tab: 'Build', name: 'Shop Front', color: '#52643f', used: 44 },
  { id: 'window-bay', tab: 'Build', name: 'Window Bay', color: '#6d7f91', used: 39 },
];

export const PROP_ASSETS: Asset[] = [
  { id: 'street-light', tab: 'Props', name: 'Street Light', color: '#b6bfc8', favorite: true, used: 58 },
  { id: 'cashier-desk', tab: 'Props', name: 'Cashier Desk', color: '#8b735e', recent: true, used: 46 },
  { id: 'trash-bin', tab: 'Props', name: 'Trash Bin', color: '#485463', used: 35 },
  { id: 'neon-sign', tab: 'Props', name: 'Neon Sign', color: '#55b7c8', used: 31 },
];

export const MATERIAL_SOURCES: MaterialSource[] = [
  { name: 'Asphalt', color: '#303136', recipe: 'asphalt-crack', variants: ['clean', 'worn', 'wet'] },
  { name: 'Concrete', color: '#6f7176', recipe: 'poured-slab', variants: ['flat', 'stained', 'chipped'] },
  { name: 'Brick', color: '#9f5547', recipe: 'brick-stack', variants: ['red', 'aged', 'painted'] },
  { name: 'Sand', color: '#c8b176', recipe: 'grain-field', variants: ['dry', 'packed', 'dirty'] },
  { name: 'Water', color: '#2e8993', recipe: 'shallow-ripple', variants: ['still', 'ripple', 'drain'] },
  { name: 'Moss', color: '#52643f', recipe: 'soft-growth', variants: ['thin', 'heavy', 'edge'] },
  { name: 'Tile', color: '#878f97', recipe: 'ceramic-grid', variants: ['white', 'mint', 'broken'] },
  { name: 'Carpet', color: '#734a62', recipe: 'fabric-loop', variants: ['clean', 'worn', 'burnt'] },
  { name: 'Vinyl', color: '#5f766d', recipe: 'vinyl-sheet', variants: ['matte', 'gloss', 'torn'] },
  { name: 'Metal', color: '#75818f', recipe: 'sheet-metal', variants: ['brushed', 'rust', 'painted'] },
  { name: 'Glass', color: '#4f8790', recipe: 'glass-pane', variants: ['clear', 'frost', 'cracked'] },
  { name: 'Plaster', color: '#b6afa3', recipe: 'wall-plaster', variants: ['smooth', 'dirty', 'split'] },
  { name: 'Drywall', color: '#a99888', recipe: 'drywall-paper', variants: ['plain', 'patched', 'peeled'] },
  { name: 'Roof', color: '#57616a', recipe: 'roof-shingle', variants: ['new', 'weather', 'missing'] },
  { name: 'Mud', color: '#6c5c48', recipe: 'mud-track', variants: ['damp', 'rutted', 'dry'] },
  { name: 'Oil', color: '#262b2e', recipe: 'oil-spill', variants: ['slick', 'thin', 'rainbow'] },
  { name: 'Paint', color: '#7d8ea3', recipe: 'paint-layer', variants: ['fresh', 'scuffed', 'flaking'] },
  { name: 'Rubber', color: '#2f3439', recipe: 'rubber-mat', variants: ['clean', 'grit', 'torn'] },
  { name: 'Gravel', color: '#73716b', recipe: 'gravel-bed', variants: ['fine', 'mixed', 'loose'] },
  { name: 'Paper', color: '#b9b0a0', recipe: 'paper-trash', variants: ['flat', 'wet', 'torn'] },
];

export const GENERATED_MATERIAL_COUNT = 240;
export const ASSET_PAGE_SIZE = 12;
export const MATERIAL_PAGE_SIZE = 6;

export function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value));
}

export function shadeHex(hex: string, offset: number): string {
  const clean = hex.replace('#', '');
  const parts = [0, 2, 4].map((start) => {
    const channel = parseInt(clean.slice(start, start + 2), 16);
    return clampChannel(channel + offset).toString(16).padStart(2, '0');
  });
  return `#${parts.join('')}`;
}

export function variantColor(asset: Asset, index: number): string {
  return shadeHex(asset.color, (index - 1) * 13);
}

export function makeGeneratedMaterials(count: number): Asset[] {
  return Array.from({ length: count }, (_, index) => {
    const source = MATERIAL_SOURCES[index % MATERIAL_SOURCES.length]!;
    const batch = Math.floor(index / MATERIAL_SOURCES.length);
    const serial = String(index + 1).padStart(3, '0');
    const shadeOffset = ((batch % 7) - 3) * 7;
    return {
      id: `mock-mat-${serial}`,
      tab: 'Skins',
      name: `${source.name} ${serial}`,
      color: shadeHex(source.color, shadeOffset),
      favorite: index % 53 === 0,
      recent: index % 37 === 0,
      used: 97 - (index % 91),
      recipe: `${source.recipe}-${batch + 1}`,
      seed: 20 + ((index * 17) % 181),
      variants: source.variants,
    };
  });
}

export const ASSETS: Asset[] = [
  ...CORE_MATERIALS,
  ...makeGeneratedMaterials(GENERATED_MATERIAL_COUNT),
  ...BUILD_ASSETS,
  ...PROP_ASSETS,
];

export const MATERIAL_ASSET_COUNT = ASSETS.filter((asset) => asset.tab === 'Skins').length;

export const MODEL_PACKAGES: ModelPackage[] = [
  {
    id: 'vase',
    folderId: 'model-vase',
    name: 'vase',
    path: '/models/props/vase',
    kind: 'prop',
    stage: 'ready',
    color: '#8f7a68',
    source: 'source/vase_high.glb',
    rig: 'rig/prop_static.anchor.json',
    data: 'data/model.package.json',
    triangles: 8420,
    lods: 4,
    decompositions: ['decomp/intact', 'decomp/shards_12', 'decomp/chunks_04'],
    atlases: [
      { id: 'vase-atlas-main', label: 'atlas/main', scope: 'intact model', resolution: '2048', paints: 7, color: '#8f7a68' },
      { id: 'vase-atlas-shards', label: 'atlas/shards_12', scope: 'explosion shards', resolution: '1024', paints: 4, color: '#6f5f55' },
      { id: 'vase-atlas-lod', label: 'atlas/lod_proxy', scope: 'low detail proxy', resolution: '512', paints: 2, color: '#514844' },
    ],
    paints: [
      { id: 'vase-paint-porcelain', name: 'blue porcelain', atlas: 'atlas/main', used: 18, shaderRefs: ['ceramic_clearcoat'], imageRefs: ['stamp-floral-02'], color: '#6f8fa5' },
      { id: 'vase-paint-cracked', name: 'cracked motel', atlas: 'atlas/main', used: 9, shaderRefs: ['edge_dirt'], imageRefs: ['scratch-mask-01'], color: '#b1a18e' },
      { id: 'vase-paint-shards', name: 'broken inside', atlas: 'atlas/shards_12', used: 4, shaderRefs: ['fresh_ceramic_cut'], imageRefs: ['dust-noise-03'], color: '#7d7068' },
    ],
  },
  {
    id: 'cd-player',
    folderId: 'model-cd-player',
    name: 'cd_player',
    path: '/models/props/cd_player',
    kind: 'prop',
    stage: 'ready',
    color: '#56616d',
    source: 'source/cd_player_scan.glb',
    rig: 'rig/hinge_lid.socket.json',
    data: 'data/model.package.json',
    triangles: 12840,
    lods: 3,
    decompositions: ['decomp/body_lid_buttons', 'decomp/explosion_09'],
    atlases: [
      { id: 'cd-atlas-body', label: 'atlas/body', scope: 'body + lid', resolution: '2048', paints: 5, color: '#56616d' },
      { id: 'cd-atlas-buttons', label: 'atlas/buttons', scope: 'button decomp', resolution: '512', paints: 3, color: '#2c343d' },
      { id: 'cd-atlas-scrap', label: 'atlas/scrap_09', scope: 'explosion pieces', resolution: '1024', paints: 2, color: '#3f4a55' },
    ],
    paints: [
      { id: 'cd-paint-black', name: 'black plastic', atlas: 'atlas/body', used: 12, shaderRefs: ['dusty_plastic'], imageRefs: ['label-compact-disc'], color: '#252b31' },
      { id: 'cd-paint-store', name: 'thrift sticker', atlas: 'atlas/body', used: 6, shaderRefs: ['sticker_edge_lift'], imageRefs: ['price-tag-99c'], color: '#6a737d' },
      { id: 'cd-paint-broken', name: 'opened broken', atlas: 'atlas/scrap_09', used: 3, shaderRefs: ['sharp_plastic_edge'], imageRefs: ['scratch-mask-02'], color: '#404852' },
    ],
  },
  {
    id: 'ball',
    folderId: 'model-ball',
    name: 'ball',
    path: '/models/props/wip/ball',
    kind: 'prop',
    stage: 'wip',
    color: '#b06a58',
    source: 'source/ball_blockout.glb',
    rig: 'rig/physics_sphere.anchor.json',
    data: 'data/model.package.json',
    triangles: 2160,
    lods: 2,
    decompositions: ['decomp/intact', 'decomp/deflated_shell'],
    atlases: [
      { id: 'ball-atlas-main', label: 'atlas/main', scope: 'sphere body', resolution: '1024', paints: 11, color: '#b06a58' },
      { id: 'ball-atlas-deflated', label: 'atlas/deflated_shell', scope: 'damage state', resolution: '512', paints: 3, color: '#7f5148' },
      { id: 'ball-atlas-lod', label: 'atlas/lod_billboard', scope: 'distance card', resolution: '256', paints: 2, color: '#553d3a' },
    ],
    paints: [
      { id: 'ball-paint-red', name: 'red rubber', atlas: 'atlas/main', used: 20, shaderRefs: ['rubber_scuff'], imageRefs: ['court-grime-01'], color: '#b94d3f' },
      { id: 'ball-paint-soccer', name: 'panel soccer', atlas: 'atlas/main', used: 14, shaderRefs: ['stitched_panel'], imageRefs: ['hex-panel-mask'], color: '#d4d2c8' },
      { id: 'ball-paint-deflated', name: 'deflated dirty', atlas: 'atlas/deflated_shell', used: 5, shaderRefs: ['rubber_fold_shadow'], imageRefs: ['mud-splatter-02'], color: '#7b5a4f' },
    ],
  },
];

export const MODEL_PACKAGE_COUNT = MODEL_PACKAGES.length;

export function applyAssetOverride(asset: Asset, override?: AssetOverride): Asset {
  return {
    ...asset,
    name: override?.name ?? asset.name,
    favorite: override?.favorite ?? asset.favorite,
  };
}

export function applyAssetOverrides(assets: Asset[], overrides: Record<string, AssetOverride>): Asset[] {
  return assets.map((asset) => applyAssetOverride(asset, overrides[asset.id]));
}

export function assetById(id: string, overrides: Record<string, AssetOverride> = {}): Asset {
  const asset = ASSETS.find((item) => item.id === id) ?? ASSETS[0]!;
  return applyAssetOverride(asset, overrides[asset.id]);
}

export function assetPageSizeFor(tab: LibraryTab): number {
  return tab === 'Skins' ? MATERIAL_PAGE_SIZE : ASSET_PAGE_SIZE;
}
