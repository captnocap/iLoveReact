// editor/data/modelPackageStore.ts — filesystem IO for Model Packages.
//
// Materializes a ModelPackage into its own on-disk directory and reads packages
// back (req_2168: a model is a self-contained, copyable directory). This is the
// IO half; modelPackage.ts owns the format/paths and stays pure. Runs in the
// editor host, which exposes the fs hooks (runtime/hooks/fs) — there is no path
// confinement, so every path here comes from modelPackage.ts, never ad hoc.
//
// FOLDER NAME = MODEL NAME (req_2735): a package's directory is named after the
// model's NAME (props/weiner/), not its internal store id
// (props/studio_mdl-mqy4h5yb-enm/). The id stays the KEY — it lives inside
// manifest.json — so the store resolves id → dir by scanning manifests (the
// same walk loadMaterializedPackages already does), cached in a module map.
// Renaming a model MOVES its folder to match; a name collision suffixes _2/_3.
import { exists, listDir, mkdir, readFile, readFileBase64, remove, stat, writeFile, writeFileBase64Atomic, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import {
  MODELS_HOME,
  MODEL_PACKAGE_SUBDIRS,
  categoryDir,
  modelFolderIdFor,
  modelSlug,
  packageDir,
  packageDirForName,
  packageToManifest,
  parseManifest,
  manifestToPackage,
  serializeManifest,
  type ModelManifest,
  type ModelPackageKind,
} from './modelPackage';
import type { ModelPackage } from './types';
import { invalidateMeshDoc, writeMeshDoc, type MeshDocPartMeta } from './meshDoc';
import { textBytes } from '../../../runtime/workspace/lumps';

const host = globalThis as any;

export type MaterializeResult = { ok: boolean; id: string; dir: string; error?: string };

// ── Package directory resolution (id → real on-disk home) ───────────────────

const dirById = new Map<string, string>();
let dirIndexBuilt = false;

const dirKey = (kind: ModelPackageKind, id: string) => `${kind}:${id}`;

function indexPackageDir(kind: ModelPackageKind, id: string, dir: string): void {
  dirById.set(dirKey(kind, id), dir);
}

// Walk every category dir once and index manifest ids. The kind in the key
// comes from the MANIFEST (disk truth), not the category folder — a package
// parked in an off-category home (models/roundtrip/…) still resolves.
function ensureDirIndex(): void {
  if (dirIndexBuilt) return;
  dirIndexBuilt = true;
  if (!exists(MODELS_HOME)) return;
  for (const category of listDir(MODELS_HOME)) {
    const categoryPath = `${MODELS_HOME}/${category}`;
    for (const leaf of listDir(categoryPath)) {
      const dir = `${categoryPath}/${leaf}`;
      const text = readFile(`${dir}/manifest.json`);
      if (!text) continue;
      try {
        const manifest = parseManifest(text);
        indexPackageDir(manifest.kind, manifest.id, dir);
      } catch { /* not a manifest — ignore the directory */ }
    }
  }
}

// The pre-req_2735 id-slug home, accepted only when its manifest really is this
// model's (a name-slug dir of another model could shadow an id-slug path).
function legacyPackageDir(kind: ModelPackageKind, id: string): string | null {
  const dir = packageDir(kind, id);
  const text = readFile(`${dir}/manifest.json`);
  if (!text) return null;
  try {
    if (parseManifest(text).id === id) return dir;
  } catch { /* unreadable — not a resolvable home */ }
  return null;
}

// The on-disk home of an EXISTING package, or null when it isn't materialized.
export function resolvePackageDir(kind: ModelPackageKind, id: string): string | null {
  const hit = dirById.get(dirKey(kind, id));
  if (hit && exists(`${hit}/manifest.json`)) return hit;
  const legacy = legacyPackageDir(kind, id);
  if (legacy) {
    indexPackageDir(kind, id, legacy);
    return legacy;
  }
  ensureDirIndex();
  return dirById.get(dirKey(kind, id)) ?? null;
}

// The name-slug home this model may WRITE into: its own dir when it already
// owns one under that name, otherwise the first free _2/_3-suffixed slot —
// a different model squatting the name never gets clobbered.
function nameDirFor(kind: ModelPackageKind, id: string, name: string): string {
  // An empty/symbol-only name slugs to '' — packageDirForName would then claim the
  // CATEGORY ROOT itself (the stray props/manifest.json bug). Fall back to the
  // id-slug home so a nameless save still gets its own directory.
  const base = modelSlug(name) ? packageDirForName(kind, name) : packageDir(kind, id);
  let dir = base;
  for (let n = 2; exists(`${dir}/manifest.json`); n += 1) {
    try {
      if (parseManifest(readFile(`${dir}/manifest.json`) ?? '').id === id) return dir;
    } catch { /* unreadable squatter — step past it */ }
    dir = `${base}_${n}`;
  }
  return dir;
}

// Where a materialization writes: the existing home if the package has one,
// else a claimed name-slug dir (registered in the index immediately so every
// write in the same pass agrees on the home). Exported for the package-file
// writers that live outside this store (paintVariants) — never for readers.
export function claimPackageDir(pkg: Pick<ModelPackage, 'kind' | 'id' | 'name'>): string {
  const existing = resolvePackageDir(pkg.kind, pkg.id);
  if (existing) return existing;
  const dir = nameDirFor(pkg.kind, pkg.id, pkg.name);
  indexPackageDir(pkg.kind, pkg.id, dir);
  return dir;
}

// The model's home dir plus the four blob subdirs — or null when a mkdir fails.
function ensurePackageDirs(dir: string): boolean {
  if (!mkdir(dir)) return false;
  for (const sub of MODEL_PACKAGE_SUBDIRS) {
    if (!mkdir(`${dir}/${sub}`)) return false;
  }
  return true;
}

// ── Writers ──────────────────────────────────────────────────────────────────

// Write one model's package directory: the home dir, the four blob subdirs, and
// manifest.json. Idempotent — mkdir/writeFile overwrite in place. The EXPORT
// declaration (placeable/skeleton, req_2718 disk truth) is preserved from the
// existing manifest when the incoming package doesn't carry it — a plain
// re-save from a session that never saw the export must not undo it.
export function materializeModelPackage(pkg: ModelPackage): MaterializeResult {
  const dir = claimPackageDir(pkg);
  if (!ensurePackageDirs(dir)) return { ok: false, id: pkg.id, dir, error: 'mkdir package dirs failed' };
  const manifest = packageToManifest(pkg);
  if (manifest.placeable === undefined || manifest.skeleton === undefined || manifest.textureSlots === undefined || manifest.lights === undefined) {
    const prior = readManifest(pkg.kind, pkg.id);
    if (prior) {
      manifest.placeable = manifest.placeable ?? prior.placeable;
      manifest.skeleton = manifest.skeleton ?? prior.skeleton;
      manifest.textureSlots = manifest.textureSlots ?? prior.textureSlots;
      manifest.lights = manifest.lights ?? prior.lights;
    }
  }
  const wrote = writeFile(`${dir}/manifest.json`, serializeManifest(manifest));
  if (!wrote) return { ok: false, id: pkg.id, dir, error: 'write manifest failed' };
  return { ok: true, id: pkg.id, dir };
}

// Binary/source artifacts copied beside a manifest to make a package complete.
// The caller supplies bytes; this store owns their strict on-disk layout.
export type PackageArtifacts = {
  /** mesh/base.blob — interleaved verts (8 f32/vert, raw little-endian), the same format __model_mesh_write emits. */
  meshBlob?: Float32Array;
  /** mesh/<name> — a copied .glb/.obj source file (base64 bytes). */
  meshFile?: { name: string; base64: string };
  /** mesh/editmesh.json — the authored parts, so a studio model stays editable from its package alone. */
  editMeshJson?: string;
  /** atlases/base.png — the model's texture atlas (base64 PNG bytes). */
  atlasPngBase64?: string;
};

// Materialize a FULL package: dirs, artifact bytes, manifest LAST. The manifest
// is the commit point, so an interrupted write never advertises a partial model.
// MUTATES pkg when a mesh file is copied in: viewerPath is repointed at the
// package's own copy, so the manifest AND the live roster entry agree.
export function materializePackageArtifacts(pkg: ModelPackage, blobs: PackageArtifacts): MaterializeResult {
  const dir = claimPackageDir(pkg);
  if (!ensurePackageDirs(dir)) return { ok: false, id: pkg.id, dir, error: 'mkdir package dirs failed' };
  if (blobs.meshBlob && blobs.meshBlob.length > 0) {
    const bytes = new Uint8Array(blobs.meshBlob.buffer, blobs.meshBlob.byteOffset, blobs.meshBlob.byteLength);
    if (!writeFileBytesAtomic(`${dir}/mesh/base.blob`, bytes)) {
      return { ok: false, id: pkg.id, dir, error: 'write mesh/base.blob failed' };
    }
    invalidateMeshDoc(dir); // base.blob is the meshdoc reader's legacy fallback
  }
  if (blobs.meshFile) {
    if (!writeFileBase64Atomic(`${dir}/mesh/${blobs.meshFile.name}`, blobs.meshFile.base64)) {
      return { ok: false, id: pkg.id, dir, error: `copy mesh/${blobs.meshFile.name} failed` };
    }
    pkg.viewerPath = `${dir}/mesh/${blobs.meshFile.name}`;
  }
  if (blobs.editMeshJson && !writeFile(`${dir}/mesh/editmesh.json`, blobs.editMeshJson)) {
    return { ok: false, id: pkg.id, dir, error: 'write mesh/editmesh.json failed' };
  }
  if (blobs.atlasPngBase64 && !writeFileBase64Atomic(`${dir}/atlases/base.png`, blobs.atlasPngBase64)) {
    return { ok: false, id: pkg.id, dir, error: 'write atlases/base.png failed' };
  }
  return materializeModelPackage(pkg);
}

// The current on-disk manifest, or null (absent/unreadable — callers treat both
// as "no durable record yet").
export function readManifest(kind: ModelPackageKind, id: string): ModelManifest | null {
  const dir = resolvePackageDir(kind, id);
  if (!dir) return null;
  const text = readFile(`${dir}/manifest.json`);
  if (!text) return null;
  try {
    return parseManifest(text);
  } catch {
    return null;
  }
}

// True when THIS model already has a package directory (manifest on disk). The
// durable-identity gate (req_2620 S/T/U): rename/favorite/delete write through
// to the manifest only when it exists; autosave only covers materialized models.
export function isMaterialized(kind: ModelPackageKind, id: string): boolean {
  const manifest = readManifest(kind, id);
  return manifest !== null && manifest.id === id && manifest.kind === kind;
}

export type ModelBasePaint = { version: 1 | 2 | 3; detail: number; program: string; layout?: number[]; rasterBase?: true };

const PAINT_LAYOUT_STALE_FILE = 'atlases/layout.stale.json';
const PAINT_RASTER_BASE_FILE = 'atlases/raster-base.png';

/** A structural mesh save leaves the previous paint assets recoverable on disk,
 *  but this marker prevents them from being silently rebound to the new topology. */
export function modelPaintLayoutIsStale(pkg: Pick<ModelPackage, 'kind' | 'id'>): boolean {
  const dir = resolvePackageDir(pkg.kind, pkg.id);
  return !!dir && exists(`${dir}/${PAINT_LAYOUT_STALE_FILE}`);
}

export function parseModelBasePaintText(text: string): ModelBasePaint | null {
  try {
    const value = JSON.parse(text) as Partial<ModelBasePaint>;
    if (value.version !== 1 && value.version !== 2 && value.version !== 3) return null;
    if (typeof value.program !== 'string' || (value.version !== 3 && !value.program)) return null;
    if (value.version === 3 && value.rasterBase !== true) return null;
    const layout = value.version === 2 || value.version === 3
      ? Array.isArray(value.layout) && value.layout.length > 0 && value.layout.length % 4 === 0
        && value.layout.every((entry, index) => Number.isInteger(entry) && entry >= 0 && (index % 4 < 2 || entry > 0))
        ? value.layout.slice()
        : null
      : undefined;
    if ((value.version === 2 || value.version === 3) && !layout) return null;
    return {
      version: value.version,
      detail: typeof value.detail === 'number' && Number.isFinite(value.detail) ? value.detail : 1,
      program: value.program,
      ...(layout ? { layout } : {}),
      ...(value.version === 3 ? { rasterBase: true as const } : {}),
    };
  } catch { return null; }
}

export function readModelBasePaint(pkg: Pick<ModelPackage, 'kind' | 'id'>): ModelBasePaint | null {
  const dir = resolvePackageDir(pkg.kind, pkg.id);
  if (!dir) return null;
  if (exists(`${dir}/${PAINT_LAYOUT_STALE_FILE}`)) return null;
  const text = readFile(`${dir}/atlases/base.paint.json`);
  if (!text) return null;
  return parseModelBasePaintText(text);
}

/** Encoded PNG for a v3 paint record's exact raster baseline. */
export function readModelRasterBase(pkg: Pick<ModelPackage, 'kind' | 'id'>): string | null {
  const dir = resolvePackageDir(pkg.kind, pkg.id);
  return dir ? readFileBase64(`${dir}/${PAINT_RASTER_BASE_FILE}`) : null;
}

// Patch the durable-identity fields of an EXISTING on-disk manifest in place
// (rename / favorite / hidden write-through — req_2620 S/U). MANIFEST IS DISK
// TRUTH: the session's modelOverrides mirror these live; this is what makes
// them survive a cold restart. A rename also MOVES the package folder so the
// directory keeps reading as the model's name (req_2735).
export function updateManifestIdentity(
  kind: ModelPackageKind,
  id: string,
  patch: Partial<Pick<ModelManifest, 'name' | 'favorite' | 'hidden'>>,
  options: { deferRenameFollow?: boolean } = {},
): boolean {
  return patchManifest(kind, id, patch, options);
}

// Rename-follow, settled ONCE when a rename ends (req_3246). Live typing writes
// the manifest name through per keystroke but must not move the package home
// each time — a move copies every blob in the package. This reads the settled
// manifest name and moves the directory to its slug home if it drifted.
export function settleRenamedPackageDir(kind: ModelPackageKind, id: string): boolean {
  const dir = resolvePackageDir(kind, id);
  const text = dir ? readFile(`${dir}/manifest.json`) : null;
  if (!dir || !text) return false;
  try {
    const manifest = parseManifest(text);
    const want = nameDirFor(kind, id, manifest.name);
    if (want === dir) return true;
    if (!movePackageDir(manifest, dir, want)) {
      console.error(`[model-packages] rename settled but moving ${dir} -> ${want} failed; package intact under the old folder name`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Write the EXPORT declaration into an existing on-disk manifest: what the model
// places as + the rig it exports with (req_2712/2718 — the package itself says
// "I am a prop / a wall piece"; the palette derives from disk, localstore only
// caches). Same read-merge-write discipline as the identity patch.
export function updateManifestPlaceable(
  kind: ModelPackageKind,
  id: string,
  patch: Partial<Pick<ModelManifest, 'placeable' | 'skeleton' | 'textureSlots' | 'lights'>>,
): boolean {
  return patchManifest(kind, id, patch);
}

// The ONE manifest read-merge-write: preserves fields a newer writer added,
// refuses to clobber an unreadable manifest, false when not materialized yet.
// A name patch finishes with a folder move (rename-follow); a failed move is
// LOUD but non-fatal — the package stays valid under its stale-named dir.
function patchManifest(kind: ModelPackageKind, id: string, patch: Partial<ModelManifest>, options: { deferRenameFollow?: boolean } = {}): boolean {
  const dir = resolvePackageDir(kind, id);
  if (!dir) return false;
  const text = readFile(`${dir}/manifest.json`);
  if (!text) return false;
  try {
    const manifest = { ...parseManifest(text), ...patch };
    if (!writeFile(`${dir}/manifest.json`, serializeManifest(manifest))) return false;
    if (typeof patch.name === 'string' && !options.deferRenameFollow) {
      const want = nameDirFor(kind, id, manifest.name);
      if (want !== dir && !movePackageDir(manifest, dir, want)) {
        console.error(`[model-packages] rename wrote through but moving ${dir} -> ${want} failed; package intact under the old folder name`);
      }
    }
    return true;
  } catch {
    return false; // unreadable manifest — never clobber it with a guess
  }
}

// Move a package directory to a new home (rename-follow). There is no host
// rename door, so this is copy-then-delete: the four subdirs' leaves, the root
// leaves (manifest.json, preview.png, …), a viewerPath rewrite when the mesh
// source lives inside the package, and only then removal of the old home.
function movePackageDir(manifest: ModelManifest, fromDir: string, toDir: string): boolean {
  if (!ensurePackageDirs(toDir)) return false;
  const copyLeaves = (from: string, to: string): boolean => {
    if (!exists(from)) return true;
    for (const name of listDir(from)) {
      if (!name || name.startsWith('.')) continue;
      const bytes = readFileBase64(`${from}/${name}`);
      if (bytes === null) continue; // nested dir or unreadable leaf — skip
      if (!writeFileBase64Atomic(`${to}/${name}`, bytes)) return false;
    }
    return true;
  };
  for (const sub of MODEL_PACKAGE_SUBDIRS) {
    if (!copyLeaves(`${fromDir}/${sub}`, `${toDir}/${sub}`)) return false;
  }
  if (!copyLeaves(fromDir, toDir)) return false;
  if (manifest.mesh.viewerPath?.startsWith(`${fromDir}/`)) {
    const moved = { ...manifest, mesh: { ...manifest.mesh, viewerPath: `${toDir}${manifest.mesh.viewerPath.slice(fromDir.length)}` } };
    if (!writeFile(`${toDir}/manifest.json`, serializeManifest(moved))) return false;
  }
  // Every byte landed — now retire the old home.
  for (const sub of MODEL_PACKAGE_SUBDIRS) {
    if (!exists(`${fromDir}/${sub}`)) continue;
    for (const name of listDir(`${fromDir}/${sub}`)) remove(`${fromDir}/${sub}/${name}`);
    remove(`${fromDir}/${sub}`);
  }
  for (const name of listDir(fromDir)) remove(`${fromDir}/${name}`);
  remove(fromDir);
  indexPackageDir(manifest.kind, manifest.id, toDir);
  return true;
}

// Copy a materialized package directory wholesale into a NEW package (the
// req_2168 promise made literal: "i could copy the entire folder for the one
// model and have all my basis covered"). Duplicates the manifest under the new
// id/name and every blob in the four subdirs, so a dupe is real on disk with
// its own manifest — not a session phantom. Returns the new ModelPackage, or
// null when the source isn't on disk / any write fails.
export function copyModelPackage(src: ModelPackage, newId: string, newName: string): ModelPackage | null {
  const srcDir = resolvePackageDir(src.kind, src.id);
  if (!srcDir) return null;
  const destDir = nameDirFor(src.kind, newId, newName);
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
  if (!writeFile(`${destDir}/manifest.json`, serializeManifest(manifest))) return null;
  indexPackageDir(src.kind, newId, destDir);
  return manifestToPackage(manifest, destDir);
}

// Read every materialized package back into ModelPackage[]. Skips any directory
// without a readable manifest instead of throwing, so one bad package can't
// blank the roster (a lesson already paid for in paint-blob storage). This walk
// IS the dir index build — every manifest it parses registers its real home.
export function loadMaterializedPackages(): ModelPackage[] {
  dirIndexBuilt = true;
  if (!exists(MODELS_HOME)) return [];
  const out: ModelPackage[] = [];
  for (const category of listDir(MODELS_HOME)) {
    const categoryPath = `${MODELS_HOME}/${category}`;
    if (!exists(categoryPath)) continue;
    for (const leaf of listDir(categoryPath)) {
      const dir = `${categoryPath}/${leaf}`;
      const text = readFile(`${dir}/manifest.json`);
      if (!text) continue;
      try {
        const manifest = parseManifest(text);
        indexPackageDir(manifest.kind, manifest.id, dir);
        out.push(manifestToPackage(manifest, dir));
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
  const home = resolvePackageDir(pkg.kind, pkg.id);
  if (!home) return [];
  const dir = `${home}/${sub}`;
  if (!exists(dir)) return [];
  return listDir(dir)
    .filter((name) => name && !name.startsWith('.'))
    .map((name) => ({ name, path: `${dir}/${name}`, sub }));
}

export type LiveAtlasWriteResult =
  | { ok: true; path: string; width: number; height: number }
  | { ok: false; error: string };

function absoluteDiskPath(path: string): string {
  if (path.startsWith('/')) return path;
  const cwd = host.__cwd?.();
  return typeof cwd === 'string' && cwd.length > 0 ? `${cwd.replace(/\/$/, '')}/${path}` : path;
}

/** Write the resident atlas now and return only a path proven to exist. The UV
 *  panel uses this for its copy-path verb, so it can never advertise the package
 *  destination before base.png has actually landed there. */
export function writeLiveModelAtlas(pkg: Pick<ModelPackage, 'kind' | 'id'>): LiveAtlasWriteResult {
  const dir = resolvePackageDir(pkg.kind, pkg.id);
  if (!dir) return { ok: false, error: 'Save the model package before exporting its texture.' };
  const atlasDir = `${dir}/atlases`;
  if (!mkdir(atlasDir)) return { ok: false, error: 'Could not create the model atlas folder.' };
  let atlas: { data?: unknown; w?: unknown; h?: unknown };
  try {
    atlas = JSON.parse(host.__model_atlas_read?.() || '{}');
  } catch {
    return { ok: false, error: 'The live paint atlas could not be read.' };
  }
  if (typeof atlas.data !== 'string' || !Number.isInteger(atlas.w) || !Number.isInteger(atlas.h)
    || (atlas.w as number) <= 0 || (atlas.h as number) <= 0) {
    return { ok: false, error: 'There is no live texture atlas to export.' };
  }
  const path = `${atlasDir}/base.png`;
  if (host.__image_write_png?.(path, atlas.data, atlas.w, atlas.h) !== 1 || !exists(path)) {
    return { ok: false, error: 'base.png could not be written to the model package.' };
  }
  return { ok: true, path: absoluteDiskPath(path), width: atlas.w as number, height: atlas.h as number };
}

// Write the ACTIVE model's own geometry + atlas into its package, so the folders that back
// its paintings aren't empty: a painting implies a mesh + an atlas, so mesh/ and atlases/
// must populate too (req_2533). mesh/base.blob = durable interleaved verts (the current
// quality projection when the user chose one, req_3315); mesh/doc.blob + mesh/parts.json = the editable model DOCUMENT (verts + face
// groups + part ranges + row metadata, req_2753 — what makes a reopened package the same
// multi-part document instead of its primitive seed); atlases/base.png = the current
// atlas readback. Best-effort — each piece is skipped when its host door or data is
// absent. Call on any save of the active model. Returns true when the meshdoc landed
// (callers strip their seed geometry only then — disk truth must exist first).
export function writeModelArtifacts(
  pkg: Pick<ModelPackage, 'kind' | 'id' | 'name'>,
  parts?: MeshDocPartMeta[],
  recoveryRanges?: { lo: number; hi: number }[],
  options: { allowPartShrink?: boolean } = {},
): boolean {
  const dir = claimPackageDir(pkg);
  const meshDir = `${dir}/mesh`;
  const atlasDir = `${dir}/atlases`;
  mkdir(meshDir);
  mkdir(atlasDir);
  // Paint/atlas callers do not own Outliner structure. They must never rewrite the
  // editable source document from whatever transient range mirror happens to be
  // resident (that was the req_3231 collapse). Only a full model save supplies parts.
  const docWritten = parts
    ? writeMeshDoc(dir, parts, recoveryRanges, options)
    : exists(`${meshDir}/doc.blob`);
  if (parts && docWritten) host.__model_mesh_write?.(`${meshDir}/base.blob`);
  const stalePath = `${dir}/${PAINT_LAYOUT_STALE_FILE}`;
  const paintLayoutStale = host.__model_paint_layout_stale?.() === 1;
  if (paintLayoutStale) {
    // Save the geometry, but never endorse the automatically derived preview UVs
    // as authored paint. Keep old paint files recoverable and mark the mismatch;
    // removing only the approval stamp also prevents runtime placement from using
    // the old painted mesh against the just-written document.
    const doc = stat(`${meshDir}/doc.blob`);
    const markerWritten = !!doc && writeFileBytesAtomic(stalePath, textBytes(JSON.stringify({
      version: 1,
      docStamp: `${doc.size}:${doc.mtimeMs}`,
      reason: 'topology-changed',
    })));
    const paintedMetaPath = `${meshDir}/painted.json`;
    if (exists(paintedMetaPath)) remove(paintedMetaPath);
    return docWritten && markerWritten;
  }
  // An explicit Create/Remake Paint Atlas cleared the host gate. This save now
  // establishes the current atlas as belonging to the current mesh document.
  if (exists(stalePath)) remove(stalePath);
  let paintProgramWritten = true;
  try {
    const atlas = JSON.parse(host.__model_atlas_read?.() || '{}');
    if (atlas.data && atlas.w > 0 && atlas.h > 0) {
      host.__image_write_png?.(`${atlasDir}/base.png`, atlas.data, atlas.w, atlas.h);
      // The atlas maps onto the DISPLAYED mesh's island-space UVs, not the source
      // UVs base.blob/doc.blob carry (req_2833: pairing them scrambles the painting)
      // — persist the paint-space verts beside the atlas so placement consumers
      // render the painted model exactly as the editor shows it.
      const paintedWritten = host.__model_painted_mesh_write?.(`${meshDir}/painted.blob`) === 1;
      // req_3133: stamp WHICH meshdoc revision this painted form belongs to. A
      // painted.blob whose vertex count mismatches the doc is stale paint from before
      // a geometry edit (req_2832). Quality saves now persist the same chosen resident
      // topology into the doc, so reduced paint and editable geometry agree by count.
      const paintedMetaPath = `${meshDir}/painted.json`;
      if (paintedWritten) {
        const doc = stat(`${meshDir}/doc.blob`);
        if (doc) writeFileBytesAtomic(paintedMetaPath, textBytes(JSON.stringify({ version: 1, docStamp: `${doc.size}:${doc.mtimeMs}` })));
      } else if (exists(paintedMetaPath)) {
        remove(paintedMetaPath); // a failed painted write must not leave a stamp endorsing the old blob
      }
    }
    const programValue = host.__model_paint_program_read?.();
    const program = typeof programValue === 'string' ? programValue : '';
    const baselineValue = host.__model_paint_baseline_read?.();
    const baseline = typeof baselineValue === 'string' ? baselineValue : '';
    const layout = Array.isArray(atlas.islands) && atlas.islands.length > 0 ? atlas.islands : null;
    const basePaintPath = `${atlasDir}/base.paint.json`;
    const rasterBasePath = `${dir}/${PAINT_RASTER_BASE_FILE}`;
    if (baseline && layout) {
      const rasterWritten = host.__image_write_png?.(rasterBasePath, baseline, atlas.w, atlas.h) === 1;
      const basePaint: ModelBasePaint = {
        version: 3,
        detail: typeof atlas.detail === 'number' && Number.isFinite(atlas.detail) ? atlas.detail : 1,
        program,
        layout,
        rasterBase: true,
      };
      paintProgramWritten = rasterWritten && writeFileBytesAtomic(basePaintPath, textBytes(JSON.stringify(basePaint)));
    } else if (program.length > 0) {
      if (exists(rasterBasePath)) remove(rasterBasePath);
      const basePaint: ModelBasePaint = {
        version: layout ? 2 : 1,
        detail: typeof atlas.detail === 'number' && Number.isFinite(atlas.detail) ? atlas.detail : 1,
        program,
        ...(layout ? { layout } : {}),
      };
      paintProgramWritten = writeFileBytesAtomic(basePaintPath, textBytes(JSON.stringify(basePaint)));
    } else {
      if (exists(rasterBasePath)) remove(rasterBasePath);
      if (exists(basePaintPath)) remove(basePaintPath);
    }
  } catch { /* no atlas resident yet — leave atlases/ empty, which is honest */ }
  return docWritten && paintProgramWritten;
}

// Re-exported so callers get the category mapping without reaching past the store.
export { categoryDir };
