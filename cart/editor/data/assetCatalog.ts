import { readFileBase64 } from '../../../runtime/hooks/fs';
import {
  EDITOR_BROWSE_SHADER_PRESETS,
  EDITOR_SHADERS,
  defaultShaderData,
  shaderSpec,
} from '../textures/shaders';
import { cuboid, cylinder, cone, pyramid, plane, sphere, icosphere, editMeshToGeometry, type EditMesh } from '../model/editMesh';
import type { Asset, ContentFolderId, ContentNode, ModelPackage, ModelPart, PrimitiveKind } from './types';
import { MODEL_PACKAGE_SUBDIRS, modelFolderIdFor, modelSlug } from './modelPackage';
import { loadMaterializedPackages, materializePackageArtifacts, resolvePackageDir } from './modelPackageStore';
import { readMeshDoc, readMeshDocParts, type MeshDocPartMeta, type PackageMeshDoc } from './meshDoc';

export type CatalogDiagnostics = {
  source: string;
  loadedMs: number;
  shaderRecipes: number;
  shaderPresets: number;
  modelPackages: number;
  errors: string[];
};

export type EditorAssetCatalog = {
  assets: Asset[];
  modelPackages: ModelPackage[];
  contentTree: ContentNode[];
  defaultAssetId: string;
  defaultContentFolder: `model-${string}` | 'models-build' | 'models-props' | 'materials-core';
  diagnostics: CatalogDiagnostics;
};

export const EDITOR_ASSET_CATALOG: EditorAssetCatalog = loadEditorAssetCatalog();

// The package is the only durable model boundary. A fresh unsaved primitive may
// still synthesize its seed geometry; imported files remain host-parsed by path.
export function modelPackageMeshData(pkg: ModelPackage): Float32Array | null {
  const ok = (v: Float32Array | null | undefined): v is Float32Array => !!v && v.length >= 8;
  const doc = packageMeshDoc(pkg);
  if (doc && ok(doc.vertices)) return doc.vertices;
  if (pkg.primitive) { const v = primitiveMeshData(pkg.primitive).positions; if (ok(v)) return v; }
  return null;
}

export function packageMeshDoc(pkg: Pick<ModelPackage, 'kind' | 'id'>): PackageMeshDoc | null {
  const dir = resolvePackageDir(pkg.kind, pkg.id);
  return dir ? readMeshDoc(dir) : null;
}

export function packageMeshDocParts(pkg: Pick<ModelPackage, 'kind' | 'id'>): MeshDocPartMeta[] | null {
  const dir = resolvePackageDir(pkg.kind, pkg.id);
  return dir ? readMeshDocParts(dir) : null;
}

// A fresh primitive's geometry (File → New Mesh → …). Built through the SAME editMesh
// generator + editMeshToGeometry path every editable part takes — one authored-face id per
// triangle — so it opens in the host editor as clean grouped faces (real quad/n-gon edges,
// no triangulation diagonals). Unit-ish defaults; the user edits from there.
// ── Primitive parameters (the "add a mesh at a chosen size" dialog) ──────────────────
// Adding a primitive prompts UPFRONT for its dimensions + resolution, so the
// initial package geometry is intentionally sized instead of a fixed unit cube.
// One flat param bag drives every kind; PRIMITIVE_FIELDS says which knobs each kind exposes
// (self-describing label/range), and primitiveEditMesh maps them onto the generators.
//
// UNITS (req_2624): the dialog speaks u — 16 u = 1 game tile = 1 m — the SAME basis the
// viewport's stage grid draws (framework/gpu/3d.zig: STAGE_TILE_M 1 m panels, 16-division
// fine grid) and per-face UV uses. The generators (editMesh.ts cuboid/cylinder/…) speak
// world METERS: a size-1.0 cuboid spans exactly one stage tile panel. PrimitiveParams
// therefore exists in two spaces — dialog u (PRIMITIVE_FIELDS ranges, integer-stepped)
// and generator meters (what primitiveEditMesh/primitivePartMesh consume) — and
// primitiveParamsFromU is the ONE conversion at the dialog boundary.
export const U_PER_TILE = 16; // 16 u = 1 tile = 1 m
export type PrimitiveParams = { size: number; height: number; resolution: number };
export type PrimitiveField = {
  key: keyof PrimitiveParams;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** 'u' = a dimension in u (converted /16 to generator meters); 'count' = a unitless resolution knob. */
  unit: 'u' | 'count';
  /** true when the u dimension reads as a diameter (⌀ in the tile readout). */
  diameter?: boolean;
};

const F = {
  size: { key: 'size', label: 'Size', min: 1, max: 800, step: 1, default: 16, unit: 'u' } as PrimitiveField,
  diameter: { key: 'size', label: 'Diameter', min: 1, max: 800, step: 1, default: 16, unit: 'u', diameter: true } as PrimitiveField,
  height: { key: 'height', label: 'Height', min: 1, max: 800, step: 1, default: 16, unit: 'u' } as PrimitiveField,
  segments: { key: 'resolution', label: 'Segments', min: 3, max: 96, step: 1, default: 24, unit: 'count' } as PrimitiveField,
  subdiv: { key: 'resolution', label: 'Subdivisions', min: 0, max: 5, step: 1, default: 2, unit: 'count' } as PrimitiveField,
};

export const PRIMITIVE_FIELDS: Record<PrimitiveKind, PrimitiveField[]> = {
  cube: [F.size, F.height],
  cylinder: [F.diameter, F.height, F.segments],
  cone: [F.diameter, F.height, F.segments],
  pyramid: [F.size, F.height],
  plane: [F.size],
  sphere: [F.diameter, F.segments],
  icosphere: [F.diameter, F.subdiv],
};

/** The starting DIALOG params for a kind (u space) — each exposed field seeded from its
 *  default. 16 u = one tile, so the default primitive spans exactly one stage tile panel. */
export function defaultPrimitiveParamsU(kind: PrimitiveKind): PrimitiveParams {
  const p: PrimitiveParams = { size: U_PER_TILE, height: U_PER_TILE, resolution: 24 };
  for (const f of PRIMITIVE_FIELDS[kind]) p[f.key] = f.default;
  return p;
}

/** Dialog u → generator meters: dimensions divide by 16; resolution is a count, untouched. */
export function primitiveParamsFromU(p: PrimitiveParams): PrimitiveParams {
  return { size: p.size / U_PER_TILE, height: p.height / U_PER_TILE, resolution: p.resolution };
}

// SPAWN RESTING ON THE FLOOR (req_2643): the generators mint meshes CENTERED at the origin
// (editMesh.ts's contract), which dropped every fresh primitive half-sunk through the stage
// ground plane. Lift the authored mesh so its
// lowest vertex sits at y = 0 (base flush with the tile panels). Runs on the freshly-built
// mesh only, so it composes with any authored size: a 32-u-tall cube rests base 0, top 2 m.
function restOnGround(mesh: EditMesh): EditMesh {
  let minY = Infinity;
  for (const v of mesh.verts) minY = Math.min(minY, v[1]);
  if (!Number.isFinite(minY) || minY === 0) return mesh; // empty, or already grounded (plane)
  for (const v of mesh.verts) v[1] -= minY;
  return mesh;
}

function primitiveEditMesh(kind: PrimitiveKind, p: PrimitiveParams = primitiveParamsFromU(defaultPrimitiveParamsU(kind))): EditMesh {
  const s = p.size, h = p.height, r = p.size / 2;
  const seg = Math.max(3, Math.round(p.resolution)); // round kinds want ≥3 segments
  const centered = (() => {
    switch (kind) {
      case 'cube': return cuboid(s, h, s);
      case 'cylinder': return cylinder(r, h, seg);
      case 'cone': return cone(r, h, seg);
      case 'pyramid': return pyramid(s, h, s);
      case 'plane': return plane(s, s);
      case 'sphere': return sphere(r, seg);
      case 'icosphere': return icosphere(r, Math.max(0, Math.round(p.resolution))); // resolution = subdivisions here
    }
  })();
  return restOnGround(centered);
}
export function primitiveMeshData(kind: PrimitiveKind): { positions: Float32Array; faceGroups: Uint32Array } {
  const groups: number[] = [];
  const geo = editMeshToGeometry(primitiveEditMesh(kind), undefined, groups);
  return { positions: new Float32Array(geo.positions), faceGroups: new Uint32Array(groups) };
}

// Build one primitive's authored EditMesh (the outliner's per-part geometry) at the given
// params (GENERATOR METERS — the dialog converts its u fields via primitiveParamsFromU
// before calling in). Public so the AppFrame add-part handler can seed a part without
// importing the generators directly. Omitting params yields the kind's defaults (a
// one-tile primitive), resting on the ground plane like every fresh primitive (req_2643).
export function primitivePartMesh(kind: PrimitiveKind, params?: PrimitiveParams): EditMesh {
  return primitiveEditMesh(kind, params);
}

export type PartGroupRange = { id: string; lo: number; hi: number };

// Compose a multi-part model into ONE host mesh (positions + per-triangle face groups).
// Each visible part contributes its triangles and owns a contiguous group range
// [lo, hi), so the outliner can select the whole part by range.
export function composeModelParts(parts: ModelPart[]): { positions: Float32Array; faceGroups: Uint32Array; ranges: PartGroupRange[] } {
  const chunks: Float32Array[] = [];
  const groupChunks: number[][] = [];
  const ranges: PartGroupRange[] = [];
  let groupBase = 0;
  for (const part of parts) {
    if (!part.visible || !part.mesh) continue;
    const localGroups: number[] = [];
    const positions = applyPartLift(new Float32Array(editMeshToGeometry(part.mesh, undefined, localGroups).positions), part.lift ?? 0);
    if (positions.length === 0) continue;
    const faceCount = part.mesh.faces.length;
    chunks.push(positions);
    groupChunks.push(localGroups.map((fi) => groupBase + fi));
    ranges.push({ id: part.id, lo: groupBase, hi: groupBase + faceCount });
    groupBase += faceCount;
  }
  const positions = new Float32Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let offset = 0;
  chunks.forEach((c) => { positions.set(c, offset); offset += c.length; });
  const faceGroups = new Uint32Array(groupChunks.reduce((sum, c) => sum + c.length, 0));
  let groupOffset = 0;
  groupChunks.forEach((c) => { faceGroups.set(c, groupOffset); groupOffset += c.length; });
  return { positions, faceGroups, ranges };
}

function loadEditorAssetCatalog(): EditorAssetCatalog {
  const started = Date.now();
  const assets = [...shaderRecipeAssets(), ...shaderPresetAssets()]
    .sort((a, b) => sourceRank(a) - sourceRank(b) || a.name.localeCompare(b.name));
  const modelPackages = loadMaterializedPackages()
    .map((model) => ({ ...model, folderId: modelFolderIdFor(model.id) }))
    .sort((a, b) => modelRank(a) - modelRank(b) || a.name.localeCompare(b.name));
  const defaultAsset = assets[0];

  return {
    assets,
    modelPackages,
    contentTree: contentTree(modelPackages),
    defaultAssetId: defaultAsset?.id ?? '',
    defaultContentFolder: 'materials-core',
    diagnostics: {
      source: 'cart/editor model packages + local shader registry',
      loadedMs: Date.now() - started,
      shaderRecipes: EDITOR_SHADERS.length,
      shaderPresets: EDITOR_BROWSE_SHADER_PRESETS.length,
      modelPackages: modelPackages.length,
      errors: [],
    },
  };
}

function applyPartLift(vertices: Float32Array, lift: number): Float32Array {
  if (lift === 0) return vertices;
  const out = new Float32Array(vertices);
  for (let index = 1; index < out.length; index += 8) out[index] += lift;
  return out;
}

export function isViewerFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.glb') || lower.endsWith('.obj');
}

/// A ModelPackage for an arbitrary on-disk .glb/.obj — the Project File Explorer's
/// import path (and the "import from disk" OS picker). The id embeds the path
/// (`file:<path>`) so modelPackageById can re-synthesize the package with no side
/// store, exactly like `primitive:<kind>:<n>` — a doc-tab switch away and back still
/// resolves even for files outside the indexed catalog.
export function fileModelPackage(source: string): ModelPackage {
  const sourceFile = source.split('/').pop() || source;
  const name = titleFromFilename(sourceFile);
  const semantic = semanticKindFromText(name);
  return {
    id: `file:${source}`,
    folderId: 'props',
    name,
    path: source,
    kind: modelCategoryForSemantic(semantic),
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
      'source:file-explorer',
    ],
    atlases: [],
    paints: [],
    sourceKind: 'source-file',
    semanticKind: semantic,
  };
}

/// IMPORT a .glb/.obj for keeps: copy the file into its own on-disk Model Package
/// (cart/editor/data/models/<category>/<slug>/mesh/<file>) and write the manifest, so
/// the model is in the content browser on every future launch — and travels with the
/// repo — instead of needing a re-import each session (req_2504). Idempotent: importing
/// the same filename again returns the already-registered package. Returns null on an
/// IO failure (caller falls back to a session-only file: open and says so).
export function importModelFilePackage(sourcePath: string): ModelPackage | null {
  if (!isViewerFile(sourcePath)) return null;
  const filename = sourcePath.split('/').pop() || sourcePath;
  const id = `import:${modelSlug(filename.replace(/\.[^.]+$/, '')).toLowerCase()}`;
  const registered = EDITOR_ASSET_CATALOG.modelPackages.find((m) => m.id === id);
  if (registered) return registered;
  const probe = fileModelPackage(sourcePath);
  const base64 = readFileBase64(sourcePath);
  if (!base64) return null;
  const pkg: ModelPackage = {
    ...probe,
    id,
    source: sourcePath,
    decompositions: [...probe.decompositions.filter((d) => d !== 'source:file-explorer'), `imported-from:${sourcePath}`],
  };
  // The store claims the name-slug home, copies the bytes into mesh/, repoints
  // pkg.viewerPath at the package's own copy, and writes the manifest last.
  const res = materializePackageArtifacts(pkg, { meshFile: { name: filename, base64 } });
  if (!res.ok) return null;
  pkg.path = `/${res.dir}`;
  // Register for THIS session too — the catalog array is the live roster the content
  // browser reads; next boot loadMaterializedPackages() picks the package up from disk.
  EDITOR_ASSET_CATALOG.modelPackages.push(pkg);
  return pkg;
}

/**
 * Store an STL-origin model as its converted GLB, while the manifest records
 * the original STL path. The native viewer therefore only ever sees its two
 * supported formats, and the package remains portable after the temp GLB dies.
 */
export function importStlModelFilePackage(sourcePath: string, convertedGlbPath: string): ModelPackage | null {
  if (!sourcePath.toLowerCase().endsWith('.stl') || !convertedGlbPath.toLowerCase().endsWith('.glb')) return null;
  const sourceFilename = sourcePath.split('/').pop() || sourcePath;
  const convertedFilename = `${sourceFilename.replace(/\.stl$/i, '') || 'model'}.glb`;
  const id = `import:${modelSlug(sourceFilename.replace(/\.[^.]+$/, '')).toLowerCase()}`;
  const registered = EDITOR_ASSET_CATALOG.modelPackages.find((model) => model.id === id);
  if (registered) return registered;
  const probe = fileModelPackage(convertedGlbPath);
  const base64 = readFileBase64(convertedGlbPath);
  if (!base64) return null;
  const pkg: ModelPackage = {
    ...probe,
    id,
    name: titleFromFilename(sourceFilename),
    source: sourcePath,
    viewerPath: convertedGlbPath,
    decompositions: [
      ...probe.decompositions.filter((entry) => entry !== 'source:file-explorer'),
      'source-format:stl',
      'converted-to:glb',
      `imported-from:${sourcePath}`,
    ],
  };
  const result = materializePackageArtifacts(pkg, { meshFile: { name: convertedFilename, base64 } });
  if (!result.ok) return null;
  pkg.path = `/${result.dir}`;
  EDITOR_ASSET_CATALOG.modelPackages.push(pkg);
  return pkg;
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  return base
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shaderRecipeAssets(): Asset[] {
  return EDITOR_SHADERS.map((spec) => {
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
      sourcePath: 'cart/editor/textures/shaders.ts',
      semanticKind: spec.group,
      stats: [`${spec.base.length} params`, `${spec.variants.length} variants`],
      preview: { kind: 'shader', shader: spec.shader, data },
    };
  });
}

function shaderPresetAssets(): Asset[] {
  return EDITOR_BROWSE_SHADER_PRESETS.map((preset) => {
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
      sourcePath: 'cart/editor/textures/shaders.ts',
      semanticKind: preset.group,
      stats: [`D[${preset.data.length}]`, preset.group],
      preview: { kind: 'shader', shader: preset.shader, data: preset.data },
    };
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
            { id: 'materials-core', label: 'Recipes' },
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

function modelCategoryForSemantic(semantic: string): 'build' | 'prop' {
  return ['wall', 'floor', 'door', 'window', 'fence', 'stairs', 'pillar', 'sign'].includes(semantic) ? 'build' : 'prop';
}

function modelRank(model: ModelPackage): number {
  if (model.kind === 'build' && model.stage === 'ready') return 0;
  if (model.kind === 'prop' && model.stage === 'ready') return 1;
  if (model.kind === 'build') return 2;
  return 3;
}

function sourceRank(asset: Asset): number {
  return asset.sourceKind === 'shader-recipe' ? 0 : 1;
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
