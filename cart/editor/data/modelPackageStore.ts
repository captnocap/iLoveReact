// editor/data/modelPackageStore.ts — filesystem IO for Model Packages.
//
// Materializes a ModelPackage into its own on-disk directory and reads packages
// back (req_2168: a model is a self-contained, copyable directory). This is the
// IO half; modelPackage.ts owns the format/paths and stays pure. Runs in the
// editor host, which exposes the fs hooks (runtime/hooks/fs) — there is no path
// confinement, so every path here comes from modelPackage.ts, never ad hoc.
//
// This slice materializes the MANIFEST + directory skeleton. Copying the mesh /
// atlas / paint / shader BYTES into the subdirs (so a copied folder is truly
// self-contained) is the next slice; the subdirs are created now so the shape
// is visible and the writers have a home.
import { exists, listDir, mkdir, readFile, readFileBase64, writeFile, writeFileBase64Atomic } from '../../../runtime/hooks/fs';
import {
  MODELS_HOME,
  MODEL_PACKAGE_SUBDIRS,
  categoryDir,
  manifestPath,
  modelFolderIdFor,
  packageDir,
  subDir,
  packageToManifest,
  parseManifest,
  manifestToPackage,
  serializeManifest,
  type ModelManifest,
  type ModelPackageKind,
} from './modelPackage';
import type { ModelPackage } from './types';

const host = globalThis as any;

export type MaterializeResult = { ok: boolean; id: string; dir: string; error?: string };
export type MaterializeSummary = { total: number; wrote: number; failed: MaterializeResult[] };

// Write one model's package directory: the category + model dirs, the four blob
// subdirs, and manifest.json. Idempotent — mkdir/writeFile overwrite in place.
export function materializeModelPackage(pkg: ModelPackage): MaterializeResult {
  const dir = packageDir(pkg.kind, pkg.id);
  if (!mkdir(dir)) return { ok: false, id: pkg.id, dir, error: 'mkdir package dir failed' };
  for (const sub of MODEL_PACKAGE_SUBDIRS) {
    if (!mkdir(`${dir}/${sub}`)) return { ok: false, id: pkg.id, dir, error: `mkdir ${sub} failed` };
  }
  const wrote = writeFile(manifestPath(pkg.kind, pkg.id), serializeManifest(packageToManifest(pkg)));
  if (!wrote) return { ok: false, id: pkg.id, dir, error: 'write manifest failed' };
  return { ok: true, id: pkg.id, dir };
}

// Materialize a whole catalog. Used to seed the package home from the current
// (still snapshot-derived) model list so the on-disk directories become real.
export function materializeCatalog(pkgs: ModelPackage[]): MaterializeSummary {
  const failed: MaterializeResult[] = [];
  let wrote = 0;
  for (const pkg of pkgs) {
    const result = materializeModelPackage(pkg);
    if (result.ok) wrote += 1;
    else failed.push(result);
  }
  return { total: pkgs.length, wrote, failed };
}

// True when THIS model already has a package directory (manifest on disk). The
// durable-identity gate (req_2620 S/T/U): rename/favorite/delete write through
// to the manifest only when it exists; autosave only covers materialized models.
export function isMaterialized(kind: ModelPackageKind, id: string): boolean {
  return exists(manifestPath(kind, id));
}

// Patch the durable-identity fields of an EXISTING on-disk manifest in place
// (rename / favorite / hidden write-through — req_2620 S/U). MANIFEST IS DISK
// TRUTH: the session's modelOverrides mirror these live; this is what makes
// them survive a cold restart. Reads-merges-writes the real file so fields a
// newer writer added are preserved. False when the package isn't on disk yet
// (callers keep the pending override and let the FIRST save write it).
export function updateManifestIdentity(
  kind: ModelPackageKind,
  id: string,
  patch: Partial<Pick<ModelManifest, 'name' | 'favorite' | 'hidden'>>,
): boolean {
  const file = manifestPath(kind, id);
  const text = readFile(file);
  if (!text) return false;
  try {
    const manifest = parseManifest(text);
    return writeFile(file, serializeManifest({ ...manifest, ...patch }));
  } catch {
    return false; // unreadable manifest — never clobber it with a guess
  }
}

// Copy a materialized package directory wholesale into a NEW package (the
// req_2168 promise made literal: "i could copy the entire folder for the one
// model and have all my basis covered"). Duplicates the manifest under the new
// id/name and every blob in the four subdirs, so a dupe is real on disk with
// its own manifest — not a session phantom. Returns the new ModelPackage, or
// null when the source isn't on disk / any write fails.
export function copyModelPackage(src: ModelPackage, newId: string, newName: string): ModelPackage | null {
  if (!isMaterialized(src.kind, src.id)) return null;
  const srcDir = packageDir(src.kind, src.id);
  const destDir = packageDir(src.kind, newId);
  const manifest = packageToManifest({
    ...src,
    id: newId,
    name: newName,
    favorite: false,
    hidden: false,
    folderId: modelFolderIdFor(newId),
  });
  // A viewer source living INSIDE the source package (imported .glb/.obj bytes)
  // travels with the copy; anything outside the package keeps its shared path.
  if (manifest.mesh.viewerPath?.startsWith(`${srcDir}/`)) {
    manifest.mesh.viewerPath = `${destDir}${manifest.mesh.viewerPath.slice(srcDir.length)}`;
  }
  if (!mkdir(destDir)) return null;
  for (const sub of MODEL_PACKAGE_SUBDIRS) {
    if (!mkdir(`${destDir}/${sub}`)) return null;
    const from = `${srcDir}/${sub}`;
    if (!exists(from)) continue;
    for (const name of listDir(from)) {
      if (!name || name.startsWith('.')) continue;
      const bytes = readFileBase64(`${from}/${name}`);
      if (bytes === null) continue; // nested dir or unreadable leaf — skip, keep copying
      if (!writeFileBase64Atomic(`${destDir}/${sub}/${name}`, bytes)) return null;
    }
  }
  if (!writeFile(manifestPath(src.kind, newId), serializeManifest(manifest))) return null;
  return manifestToPackage(manifest);
}

// True once at least one materialized package exists on disk. Lets callers
// prefer real packages and fall back to the snapshot catalog while empty.
export function hasMaterializedPackages(): boolean {
  if (!exists(MODELS_HOME)) return false;
  return listDir(MODELS_HOME).some((category) => {
    const categoryPath = `${MODELS_HOME}/${category}`;
    return exists(categoryPath) && listDir(categoryPath).length > 0;
  });
}

// Read every materialized package back into ModelPackage[]. Skips any directory
// without a readable manifest instead of throwing, so one bad package can't
// blank the roster (a lesson already paid for in paint-blob storage).
export function loadMaterializedPackages(): ModelPackage[] {
  if (!exists(MODELS_HOME)) return [];
  const out: ModelPackage[] = [];
  for (const category of listDir(MODELS_HOME)) {
    const categoryPath = `${MODELS_HOME}/${category}`;
    if (!exists(categoryPath)) continue;
    for (const slug of listDir(categoryPath)) {
      const file = `${categoryPath}/${slug}/manifest.json`;
      const text = readFile(file);
      if (!text) continue;
      try {
        out.push(manifestToPackage(parseManifest(text)));
      } catch {
        // Not a valid manifest — skip this directory, keep the roster intact.
      }
    }
  }
  return out;
}

// One file inside a package subdir, as the browser shows it. `path` is the full
// on-disk path (openable), `name` the leaf, `sub` which subdir it came from.
export type PackageFile = { name: string; path: string; sub: (typeof MODEL_PACKAGE_SUBDIRS)[number] };

// List the real files in one of a package's subdirs (mesh/atlases/paints/shaders).
// Empty until the Save writer populates them — the browser shows an honest empty
// state, not a phantom "no models". Skips nested dirs; leaves only.
export function listPackageFiles(pkg: ModelPackage, sub: (typeof MODEL_PACKAGE_SUBDIRS)[number]): PackageFile[] {
  const dir = `${packageDir(pkg.kind, pkg.id)}/${sub}`;
  if (!exists(dir)) return [];
  return listDir(dir)
    .filter((name) => name && !name.startsWith('.'))
    .map((name) => ({ name, path: `${dir}/${name}`, sub }));
}

// Write the ACTIVE model's own geometry + atlas into its package, so the folders that back
// its paintings aren't empty: a painting implies a mesh + an atlas, so mesh/ and atlases/
// must populate too (req_2533). mesh/base.blob = full-res interleaved verts (via the host
// door); atlases/base.png = the current atlas readback. Best-effort — each piece is skipped
// when its host door or data is absent (an unpainted model has no atlas yet). Call on any
// save of the active model.
export function writeModelArtifacts(pkg: Pick<ModelPackage, 'kind' | 'id'>): void {
  const meshDir = subDir(pkg.kind, pkg.id, 'mesh');
  const atlasDir = subDir(pkg.kind, pkg.id, 'atlases');
  mkdir(meshDir);
  mkdir(atlasDir);
  host.__model_mesh_write?.(`${meshDir}/base.blob`);
  try {
    const atlas = JSON.parse(host.__model_atlas_read?.() || '{}');
    if (atlas.data && atlas.w > 0 && atlas.h > 0) {
      host.__image_write_png?.(`${atlasDir}/base.png`, atlas.data, atlas.w, atlas.h);
    }
  } catch { /* no atlas resident yet — leave atlases/ empty, which is honest */ }
}

// Re-exported so callers get the category mapping without reaching past the store.
export { categoryDir };
