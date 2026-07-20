// editor/data/modelPackage.ts — the on-disk Model Package format (SSOT).
//
// req_2168: "every model has its own directory. inside of that directory for the
// model is its data, and then there is a texture atlas for the model, and a
// texture atlas for every model decomp we store ... all those paintings live
// inside of that one models folder ... i could copy the entire folder for the
// one model and have all my basis covered end to end."
//
// This module owns the DIRECTORY LAYOUT and the manifest <-> ModelPackage
// mapping. It is PURE (no filesystem) — modelPackageStore.ts does the IO. Keep
// every path in one place so "a model is a self-contained directory you can
// copy" stays literally true and there are no scattered magic paths.
//
//   cart/editor/data/models/
//     <category>/                 props | build | characters | vehicles (from kind)
//       <model>/                  filesystem-safe slug of the model id
//         manifest.json           the model's durable record (this file's schema)
//         mesh/                    source and editable mesh documents
//         atlases/                one texture atlas per decomposition
//         paints/                 stored paint variations
//         shaders/                copies of referenced shader code
//
// The manifest and its sibling artifacts are the durable, portable model.
// path and source derive from that package home on load.
import type { ContentFolderId, ModelAtlas, ModelPackage, ModelPaintVariant, ModelPlaceable, ModelTextureSlot } from './types';
import type { LightRig } from '../model/editMesh';
import { normalizeModelLights } from '../model/modelLights';
import { normalizeModelTextureSlots } from '../model/modelTextureSlotAuthoring';
import type { Skeleton } from '../../../runtime/skeleton';

export const MODELS_HOME = 'cart/editor/data/models';
export const MODEL_MANIFEST_VERSION = 1;

// The four blob subdirectories that live beside each model's manifest. Named
// once here so the writer, the reader, and any future cleanup all agree.
export const MODEL_PACKAGE_SUBDIRS = ['mesh', 'atlases', 'paints', 'shaders'] as const;

export type ModelPackageKind = ModelPackage['kind'];

// The on-disk record. A superset-faithful projection of ModelPackage minus the
// two fields that are re-derived from the package's own location (path, source).
export type ModelManifest = {
  version: number;
  id: string;
  name: string;
  kind: ModelPackageKind;
  stage: ModelPackage['stage'];
  // Durable identity flags (req_2620 gaps S/T/U): favorite/hidden used to live only
  // in the session's modelOverrides, so a rename/favorite/delete evaporated on a
  // cold restart. The manifest is disk truth now; overrides are the live mirror.
  favorite?: boolean;
  hidden?: boolean;
  folderId: ContentFolderId;
  semanticKind?: string;
  sourceKind?: ModelPackage['sourceKind'];
  color: string;
  rig: string;
  data: string;
  triangles: number;
  lods: number;
  mesh: { viewerPath?: string; viewerMeshRef?: string };
  decompositions: string[];
  atlases: ModelAtlas[];
  paints: ModelPaintVariant[];
  // Exported-as declaration + the exported RIG (req_2712/2718). The manifest is
  // the ENTIRE source of truth for "this model is a placeable prop/build piece";
  // the palette derives from these on boot — localstore only caches.
  placeable?: ModelPlaceable;
  skeleton?: Skeleton;
  textureSlots?: ModelTextureSlot[];
  lights?: LightRig[];
};

// kind -> category directory. One category folder groups its models, matching
// the req_2168 sketch (models/props/{vase,cd_player,...}).
export function categoryDir(kind: ModelPackageKind): string {
  switch (kind) {
    case 'build': return 'build';
    case 'character': return 'characters';
    case 'vehicle': return 'vehicles';
    case 'prop':
    default: return 'props';
  }
}

// Names and ids carry characters that aren't safe directory leaves (colons,
// spaces). Slugify for the folder name; the raw id is always preserved inside
// the manifest, so the slug is display-only and never the key.
export function modelSlug(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// A package's PREFERRED home: named after the MODEL'S NAME (props/weiner/), not
// its internal store id (props/studio_mdl-mqy4h5yb-enm/) — req_2735: the folder
// a person browses should read as the model they named. Collisions and renames
// are the store's problem (suffixing / rename-follow); this is just the path.
export function packageDirForName(kind: ModelPackageKind, name: string): string {
  return `${MODELS_HOME}/${categoryDir(kind)}/${modelSlug(name)}`;
}

// The canonical content-tree folder id for a model. Derived from the model's
// unique id (like path/source), so every model gets its OWN home node. Seeding
// folderId per source/kind instead (the old bug) made imported props share one
// id, so clicking one model opened another's menu (req_2523). One id, one model.
export function modelFolderIdFor(id: string): `model-${string}` {
  return `model-${modelSlug(id)}`;
}

// LEGACY id-slug home (pre-req_2735 packages were written here). Kept ONLY as
// the store's resolution fallback for a package that predates name-first dirs;
// never the target of a new write — claim through the store instead.
export function packageDir(kind: ModelPackageKind, id: string): string {
  return `${MODELS_HOME}/${categoryDir(kind)}/${modelSlug(id)}`;
}

export function manifestPath(kind: ModelPackageKind, id: string): string {
  return `${packageDir(kind, id)}/manifest.json`;
}

export function packageToManifest(pkg: ModelPackage): ModelManifest {
  return {
    version: MODEL_MANIFEST_VERSION,
    id: pkg.id,
    name: pkg.name,
    kind: pkg.kind,
    stage: pkg.stage,
    favorite: pkg.favorite,
    hidden: pkg.hidden,
    folderId: pkg.folderId,
    semanticKind: pkg.semanticKind,
    sourceKind: pkg.sourceKind,
    color: pkg.color,
    rig: pkg.rig,
    data: pkg.data,
    triangles: pkg.triangles,
    lods: pkg.lods,
    mesh: { viewerPath: pkg.viewerPath, viewerMeshRef: pkg.viewerMeshRef },
    decompositions: pkg.decompositions,
    atlases: pkg.atlases,
    paints: pkg.paints,
    placeable: pkg.placeable,
    skeleton: pkg.skeleton,
    textureSlots: normalizeModelTextureSlots(pkg.textureSlots),
    lights: pkg.lights ? normalizeModelLights(pkg.lights) : undefined,
  };
}

// `dir` is the package's REAL on-disk home (the store resolved or claimed it) —
// path/source derive from it, since a name-slug dir can't be re-derived from the
// manifest alone once suffixing or an off-category home is in play (req_2735).
export function manifestToPackage(manifest: ModelManifest, dir: string): ModelPackage {
  return {
    id: manifest.id,
    // Derived from the id (not the stored folderId) so every model has its own
    // home node even if an older manifest wrote a shared per-kind folderId.
    folderId: modelFolderIdFor(manifest.id),
    name: manifest.name,
    path: `/${dir}`,
    kind: manifest.kind,
    stage: manifest.stage,
    favorite: manifest.favorite,
    hidden: manifest.hidden,
    color: manifest.color,
    source: `${dir}/manifest.json`,
    viewerPath: manifest.mesh.viewerPath,
    viewerMeshRef: manifest.mesh.viewerMeshRef,
    rig: manifest.rig,
    data: manifest.data,
    triangles: manifest.triangles,
    lods: manifest.lods,
    decompositions: manifest.decompositions,
    atlases: manifest.atlases,
    paints: manifest.paints,
    sourceKind: manifest.sourceKind,
    semanticKind: manifest.semanticKind,
    placeable: manifest.placeable,
    skeleton: manifest.skeleton,
    textureSlots: normalizeModelTextureSlots(manifest.textureSlots),
    lights: manifest.lights ? normalizeModelLights(manifest.lights) : undefined,
    // A saved primitive package re-arms its generator on load (semanticKind IS the
    // seed kind), so reopening it from disk still builds viewable geometry — the
    // manifest carries identity; mesh-blob readback is a later slice.
    primitive: manifest.sourceKind === 'primitive' ? (manifest.semanticKind as ModelPackage['primitive']) : undefined,
  };
}

export function serializeManifest(manifest: ModelManifest): string {
  return JSON.stringify(manifest, null, 2);
}

// Tolerant of a bare ModelManifest or one wrapped/extended in the future; throws
// only when the payload can't be a manifest at all, so the reader can skip it.
export function parseManifest(text: string): ModelManifest {
  const raw = JSON.parse(text) as Partial<ModelManifest>;
  if (!raw || typeof raw.id !== 'string' || typeof raw.kind !== 'string') {
    throw new Error('not a model manifest');
  }
  return raw as ModelManifest;
}
