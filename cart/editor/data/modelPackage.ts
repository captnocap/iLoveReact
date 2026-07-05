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
//         mesh/                    mesh data (mesh.blob / editmesh.json)   [blobs: later slice]
//         atlases/                one texture atlas per decomposition       [blobs: later slice]
//         paints/                 stored paint variations                   [blobs: later slice]
//         shaders/                copies of referenced shader code          [blobs: later slice]
//
// The manifest carries the durable, portable metadata; blob materialization
// (mesh/atlas/paint/shader bytes into the subdirs) is the next slice. path and
// source are DERIVED from the package location on load — they intentionally
// point at the package home, not the old hmsc-int snapshot.
import type { ContentFolderId, ModelAtlas, ModelPackage, ModelPaintVariant } from './types';

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

// Model ids carry a source prefix with a colon (e.g. "studio:truck"), which is
// not a safe directory leaf. Slugify for the folder name; the raw id is always
// preserved inside the manifest, so this is display-only and never the key.
export function modelSlug(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// The canonical content-tree folder id for a model. Derived from the model's
// unique id (like path/source), so every model gets its OWN home node. Seeding
// folderId per source/kind instead (the old bug) made imported props share one
// id, so clicking one model opened another's menu (req_2523). One id, one model.
export function modelFolderIdFor(id: string): `model-${string}` {
  return `model-${modelSlug(id)}`;
}

export function packageDir(kind: ModelPackageKind, id: string): string {
  return `${MODELS_HOME}/${categoryDir(kind)}/${modelSlug(id)}`;
}

export function manifestPath(kind: ModelPackageKind, id: string): string {
  return `${packageDir(kind, id)}/manifest.json`;
}

export function subDir(kind: ModelPackageKind, id: string, sub: (typeof MODEL_PACKAGE_SUBDIRS)[number]): string {
  return `${packageDir(kind, id)}/${sub}`;
}

// The display path shown in the content browser, now rooted at the package home
// instead of the old "/Game/Models/Saved Studio/..." snapshot path.
export function displayPath(kind: ModelPackageKind, id: string): string {
  return `/${packageDir(kind, id)}`;
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
  };
}

export function manifestToPackage(manifest: ModelManifest): ModelPackage {
  return {
    id: manifest.id,
    // Derived from the id (not the stored folderId) so every model has its own
    // home node even if an older manifest wrote a shared per-kind folderId.
    folderId: modelFolderIdFor(manifest.id),
    name: manifest.name,
    path: displayPath(manifest.kind, manifest.id),
    kind: manifest.kind,
    stage: manifest.stage,
    favorite: manifest.favorite,
    hidden: manifest.hidden,
    color: manifest.color,
    source: manifestPath(manifest.kind, manifest.id),
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
