// editor/data/content.ts - content tree, navigation enums, and folder helpers.
import { MODEL_PACKAGES, MODEL_PACKAGE_COUNT } from './catalog';
import { EDITOR_ASSET_CATALOG, fileModelPackage, modelCategoryNodes } from './assetCatalog';
import { isMaterialized } from './modelPackageStore';
import { modelFolderIdFor } from './modelPackage';
import { allocateBuildStarterModelId, allocatePrimitiveModelId, BUILD_STARTER_MODEL_ID_PREFIX } from './modelIdentity';
import { PRIMITIVE_MESHES } from './commands';
import { buildPieceStarter, type BuildPieceStarterId } from './buildStarters';
import { mintedModelIds } from '../model/docSession';
import { INITIAL_OBJECTS } from './initialState';
import type { Asset, ContentFolderId, ContentNode, LibraryTab, EditorState, ModelOverride, ModelPackage, PrimitiveKind, WorkspaceDocument, WorldObject } from './types';
import type { BuildKind } from '../world/buildCatalog';
import { catalogRowFor, rowHex } from '../world/buildCatalog';
import { modelMatchesLibrarySearch } from './librarySearch';

export const CONTENT_TREE: ContentNode[] = EDITOR_ASSET_CATALOG.contentTree;
export const SNAP_MODES = ['surface + edge', 'grid', 'free', 'vertex'];
export const FLOORS = ['Floor 2', 'Floor 1', 'Basement'];
export const PRESETS = ['default', 'slow', 'fast', 'custom'];

export function tabForContentFolder(folder: ContentFolderId): LibraryTab | null {
  if (isModelFolder(folder)) return null;
  if (folder === 'materials' || folder === 'materials-core' || folder === 'materials-generated' || folder === 'materials-favorites' || folder === 'materials-recent') return 'Skins';
  if (folder === 'props') return 'Props';
  if (folder === 'architecture' || folder === 'build-pieces' || folder === 'prefabs' || folder === 'mission-assets') return 'Build';
  return null;
}

export function folderForAsset(asset: Asset): ContentFolderId {
  if (asset.tab === 'Skins') {
    return asset.sourceKind === 'shader-preset' ? 'materials-generated' : 'materials-core';
  }
  if (asset.tab === 'Build') return 'build-pieces';
  return 'props';
}

export function contentFolderLabel(folder: ContentFolderId): string {
  const findNode = (nodes: ContentNode[]): ContentNode | null => {
    for (const node of nodes) {
      if (node.id === folder) return node;
      const found = node.children ? findNode(node.children) : null;
      if (found) return found;
    }
    return null;
  };
  const node = findNode(CONTENT_TREE);
  if (node) return node.label;
  const model = exactModelForFolder(folder);
  return model?.name ?? folder;
}

// The ancestor chain root → … → folder inside a (live) content tree — the
// expanded dock's breadcrumb. Every segment is a real tree node, so each crumb
// press is a normal folder selection. Null when the id isn't in the tree
// (defensive: a stale model id after delete).
export function contentFolderTrail(folder: ContentFolderId, tree: ContentNode[]): ContentNode[] | null {
  for (const node of tree) {
    if (node.id === folder) return [node];
    const below = node.children ? contentFolderTrail(folder, node.children) : null;
    if (below) return [node, ...below];
  }
  return null;
}

export function isMaterialFolder(folder: ContentFolderId): boolean {
  return tabForContentFolder(folder) === 'Skins';
}

export function isModelFolder(folder: ContentFolderId): boolean {
  return folder === 'models' ||
    folder === 'models-build' ||
    folder === 'models-props' ||
    folder === 'models-characters' ||
    folder === 'models-vehicles' ||
    folder === 'models-props-wip' ||
    String(folder).startsWith('model-');
}

// Fallback gallery page size for the expanded dock's first render, before its
// grid area's measure lands (req_3137) — after that, pages size themselves to
// fill the measured space.
export const MODEL_GALLERY_PAGE_SIZE = 20;

// The live model list: the catalog packages plus any duplicates, with per-model
// renames/favorites applied and deleted (hidden) models removed. Everything that
// lists models — the gallery, the tree, the counts — reads through this so a
// right-click rename/delete/duplicate stays consistent everywhere.
export function visibleModelPackages(
  overrides: Record<string, ModelOverride>,
  dupes: ModelPackage[],
): ModelPackage[] {
  // Dedupe by id, DISK-BACKED (catalog) first: a session-added package (first
  // save / dupe) also loads from its manifest after a hot reload rebuilt the
  // catalog, and the disk copy is the truth of the pair (req_2620 S).
  const seen = new Set<string>();
  return [...MODEL_PACKAGES, ...dupes]
    .filter((model) => (seen.has(model.id) ? false : (seen.add(model.id), true)))
    .map((model) => {
      const override = overrides[model.id];
      if (!override) return model;
      return { ...model, name: override.name ?? model.name, favorite: override.favorite ?? model.favorite };
    })
    // hidden: the session override OR the manifest's durable flag (req_2620 U).
    .filter((model) => !(overrides[model.id]?.hidden ?? model.hidden));
}

export function modelPackagesForFolder(
  folder: ContentFolderId,
  search: string,
  models: ModelPackage[] = MODEL_PACKAGES,
): ModelPackage[] {
  const needle = search.trim().toLowerCase();
  return models
    .filter((model) => {
      const exportedCharacter = model.placeable?.as === 'character';
      if (folder === 'models') return true;
      if (folder === 'models-build') return model.kind === 'build' && !exportedCharacter;
      if (folder === 'models-props') return model.kind === 'prop' && !exportedCharacter;
      if (folder === 'models-characters') return exportedCharacter;
      if (folder === 'models-vehicles') return model.kind === 'vehicle' && !exportedCharacter;
      if (folder === 'models-props-wip') return model.sourceKind === 'studio-model' || model.stage === 'wip';
      return model.folderId === folder;
    })
    .filter((model) => !needle || modelMatchesLibrarySearch(model, needle));
}

// A freshly-authored primitive is fully described by its id (`primitive:<kind>:<n>`), so
// modelPackageById can synthesize it with no side store — the geometry is built lazily by
// the viewer (see ModelDocumentSurface / primitiveMeshData). Each <n> is a distinct pristine
// document so "New Mesh → X" always opens a clean primitive.
//
// The CONTAINER is named generically ("Model 3"), NOT after its seed primitive. A model is a
// bag of parts (the Outliner is that list) — the moment you add a cube to a cone-seeded model,
// a name like "Cone 3" would be a lie. So the seed kind lives on ONLY as filter/search data
// (semanticKind/primitive/path); the seed's own name shows up exactly once, as the first
// Outliner part. See docs on the identity-conflation fix (req_2406).
export function primitiveModelPackage(id: string): ModelPackage {
  const [, kind, seq] = id.split(':'); // 'primitive:cylinder:3' → ['primitive','cylinder','3']
  const meta = PRIMITIVE_MESHES.find((p) => p.kind === kind) ?? PRIMITIVE_MESHES[0]!;
  return {
    id,
    folderId: modelFolderIdFor(id),
    name: seq ? `Model ${seq}` : 'Model',
    path: `primitive/${meta.kind}`,
    kind: 'prop',
    stage: 'wip',
    color: '#5a86c0',
    source: 'primitive',
    rig: '-',
    data: '-',
    triangles: 0,
    lods: 1,
    decompositions: [],
    atlases: [],
    paints: [],
    sourceKind: 'primitive',
    semanticKind: meta.kind,
    primitive: meta.kind,
  };
}

/** A fresh semantic build starter. Its mesh lives in AppFrame's modelParts until
 *  first save, then the ordinary package meshdoc becomes disk truth. */
export function buildStarterModelPackage(id: string): ModelPackage {
  if (!id.startsWith(BUILD_STARTER_MODEL_ID_PREFIX)) throw new Error(`not a build starter id: ${id}`);
  const suffix = id.slice(BUILD_STARTER_MODEL_ID_PREFIX.length);
  const split = suffix.lastIndexOf(':');
  const starterId = (split >= 0 ? suffix.slice(0, split) : suffix) as BuildPieceStarterId;
  const seq = split >= 0 ? suffix.slice(split + 1) : '';
  const starter = buildPieceStarter(starterId);
  if (!starter) throw new Error(`unknown build starter: ${starterId}`);
  const row = catalogRowFor(starter.catalogPieceId);
  return {
    id,
    folderId: modelFolderIdFor(id),
    name: seq ? `${starter.name} ${seq}` : starter.name,
    path: `starter/build/${starterId}`,
    kind: 'build',
    stage: 'wip',
    color: row ? rowHex(row) : '#8f99a5',
    source: 'starter',
    rig: '-',
    data: '-',
    triangles: 0,
    lods: 1,
    decompositions: [],
    atlases: [],
    paints: [],
    sourceKind: 'build-starter',
    semanticKind: starter.edit ?? starter.kind,
  };
}

export function nextBuildStarterDocId(starterId: BuildPieceStarterId, docs: WorkspaceDocument[]): string {
  return allocateBuildStarterModelId(starterId, docs, MODEL_PACKAGES, (id) => isMaterialized('build', id), mintedModelIds());
}

/** Headless-harness lookup (req_3406): RJIT_MODELDOC=open:<name> boots a SAVED
 * package by its manifest name (case-insensitive). Roster only — synthesizers
 * need an id shape, and the harness names real on-disk packages. */
export function modelPackageByName(name: string): ModelPackage | null {
  const wanted = name.trim().toLowerCase();
  return MODEL_PACKAGES.find((model) => model.name.toLowerCase() === wanted) ?? null;
}

export function modelPackageById(id: string): ModelPackage | null {
  // DISK-BACKED WINS (req_2620 S): a saved primitive doc has a real package in the
  // catalog (loadMaterializedPackages / a session save) — its manifest name is the
  // truth, so the roster lookup runs BEFORE the synthesizers, never after.
  const registered = MODEL_PACKAGES.find((model) => model.id === id);
  if (registered) return registered;
  if (id.startsWith('primitive:')) return primitiveModelPackage(id);
  if (id.startsWith(BUILD_STARTER_MODEL_ID_PREFIX)) return buildStarterModelPackage(id);
  // A file-explorer / disk-picker open (`file:<path>`) re-synthesizes from the path in
  // the id — the file may live outside every indexed catalog dir.
  if (id.startsWith('file:')) return fileModelPackage(id.slice('file:'.length));
  return null;
}

// The model as the USER knows it right now: the catalog/dupe record with the
// session's rename/favorite override applied. THE resolver for every path that
// writes identity to disk — Ctrl+S used to call modelPackageById bare, so a
// rename never reached the manifest it wrote ("Model 3" forever, req_2620 S).
export function effectiveModelPackage(
  id: string | undefined,
  overrides: Record<string, ModelOverride>,
  dupes: ModelPackage[],
): ModelPackage | null {
  if (!id) return null;
  const base = dupes.find((model) => model.id === id) ?? modelPackageById(id);
  if (!base) return null;
  const override = overrides[id];
  if (!override) return base;
  return { ...base, name: override.name ?? base.name, favorite: override.favorite ?? base.favorite };
}

// The next pristine `primitive:<kind>:<n>` document id. The package store is
// queried independently from the browser catalog: a presentation filter may
// never make a durable identity reusable (req_2873), and the session ledger
// covers the one case none of the others can see — a document closed before it
// ever reached disk (req_3773).
export function nextPrimitiveDocId(kind: PrimitiveKind, docs: WorkspaceDocument[]): string {
  return allocatePrimitiveModelId(kind, docs, MODEL_PACKAGES, (id) => isMaterialized('prop', id), mintedModelIds());
}

// Register a first-saved package into the live catalog roster so THIS session's
// gallery/tree/search see it immediately (next boot reads it from disk). Same
// in-session registration move importModelFilePackage makes. Idempotent.
export function registerSavedPackage(pkg: ModelPackage): void {
  if (!MODEL_PACKAGES.some((model) => model.id === pkg.id)) MODEL_PACKAGES.push(pkg);
}

// Replace-or-push: the export path re-registers the package WITH its export
// declaration (placeable/skeleton) so the live roster matches the manifest it
// just wrote — a later save from this session can't regress it (req_2718).
export function upsertSavedPackage(pkg: ModelPackage): void {
  const at = MODEL_PACKAGES.findIndex((model) => model.id === pkg.id);
  if (at >= 0) MODEL_PACKAGES[at] = pkg;
  else MODEL_PACKAGES.push(pkg);
}

export function exactModelForFolder(folder: ContentFolderId): ModelPackage | null {
  return MODEL_PACKAGES.find((model) => model.folderId === folder) ?? null;
}

export function assetMatchesContentFolder(asset: Asset, folder: ContentFolderId): boolean {
  if (isModelFolder(folder)) return false;
  if (folder === 'game') return true;
  if (folder === 'materials') return asset.tab === 'Skins';
  if (folder === 'materials-core') return asset.tab === 'Skins' && asset.sourceKind !== 'shader-preset';
  if (folder === 'materials-generated') return asset.tab === 'Skins' && asset.sourceKind === 'shader-preset';
  if (folder === 'materials-favorites') return asset.tab === 'Skins' && Boolean(asset.favorite);
  if (folder === 'materials-recent') return asset.tab === 'Skins' && Boolean(asset.recent);
  if (folder === 'props') return asset.tab === 'Props';
  if (folder === 'architecture' || folder === 'build-pieces' || folder === 'prefabs' || folder === 'mission-assets') return asset.tab === 'Build';
  return false;
}

export function countAssetsForFolder(
  assets: Asset[],
  folder: ContentFolderId,
  models: ModelPackage[] = MODEL_PACKAGES,
): number {
  if (folder === 'game') return assets.length + models.length;
  if (isModelFolder(folder)) return modelPackagesForFolder(folder, '', models).length;
  return assets.filter((asset) => assetMatchesContentFolder(asset, folder)).length;
}

// The content tree with its Models subtree rebuilt from a live model list, so
// renames / duplicates / deletes show up in the tree exactly as they do in the
// gallery. Only the Models node's children are swapped; the rest is untouched.
export function liveContentTree(models: ModelPackage[]): ContentNode[] {
  const swap = (node: ContentNode): ContentNode => {
    if (node.id === 'models') return { ...node, children: modelCategoryNodes(models) };
    if (node.children) return { ...node, children: node.children.map(swap) };
    return node;
  };
  return CONTENT_TREE.map(swap);
}

export function rankAssets(a: Asset, b: Asset): number {
  const score = (asset: Asset): number =>
    (asset.favorite ? 3000 : 0) + (asset.recent ? 2000 : 0) + asset.used;
  const byScore = score(b) - score(a);
  if (byScore !== 0) return byScore;
  const byMaterialSource = materialSourceRank(a) - materialSourceRank(b);
  if (byMaterialSource !== 0) return byMaterialSource;
  return a.name.localeCompare(b.name);
}

function materialSourceRank(asset: Asset): number {
  if (asset.tab !== 'Skins') return 0;
  if (asset.sourceKind === 'shader-recipe') return 0;
  if (asset.sourceKind === 'stored-material') return 1;
  if (asset.sourceKind === 'texture-file') return 2;
  if (asset.sourceKind === 'shader-preset') return 3;
  return 4;
}

export function selectedObject(state: EditorState): WorldObject {
  return state.objects.find((object) => object.id === state.selectedObjectId && !object.hidden)
    ?? state.objects.find((object) => !object.hidden)
    ?? INITIAL_OBJECTS[0]!;
}

export function panelModeFor(state: EditorState, object: WorldObject): LibraryTab {
  if (object.kind === 'TILE' || object.kind === 'CUTOUT') return 'Skins';
  if (object.kind === 'PROP') return 'Props';
  if (state.activeCommandId === 'place-piece' || object.kind === 'PIECE' || object.kind === 'PREFAB') return 'Build';
  return state.activeTab;
}
