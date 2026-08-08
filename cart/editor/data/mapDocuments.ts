// Named editor map documents. A document is a DIRECTORY boundary: every
// authored concern for one map lives below the same stem, so opening a map can
// never accidentally pair another map's pieces with this map's terrain.
//
//   userdata/editor/maps/<stem>/painting.rmap  host-owned terrain/flora/roads
//   userdata/editor/maps/<stem>/world.json     pieces + objects + zone legend + id seq
//   userdata/editor/maps/<stem>/meta.json      friendly title + render diagnostics
//   userdata/editor/maps/_last.txt             last-open document pointer
//
// The previous editor used two unrelated fixed files. On the first boot after
// this change we register those files as ONE `legacy` document; each concern is
// imported into the directory by its owning persistence layer. That migration
// runs once and never becomes a fallback for later documents.
import { exists, listDir, mkdir, readFile, remove, stat, writeFile, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { EDITOR_DATA_ROOT, LEGACY_EDITOR_DATA_ROOT, migrateLegacyEditorData } from './editorDataRoot';
import { mapInspectFile } from '../../../runtime/game/map';
import { textBytes } from '../../../runtime/workspace/lumps';

export const MAP_DOCUMENT_ROOT = `${EDITOR_DATA_ROOT}/maps`;
export const MAP_DOCUMENT_POINTER = `${MAP_DOCUMENT_ROOT}/_last.txt`;
export const LEGACY_MAP_FILE = `${LEGACY_EDITOR_DATA_ROOT}/painted-map.rmap`;
export const LEGACY_WORLD_FILE = `${LEGACY_EDITOR_DATA_ROOT}/world-pieces.json`;
export const MAP_DOCUMENT_STEM_MAX_CHARS = 64;
export const MAP_DOCUMENT_NAME_MAX_CHARS = 80;
const LEGACY_IMPORT_MARKER = '.legacy-import';
const MAP_DOCUMENT_META_VERSION = 1;

export type MapDocumentPaths = {
  stem: string;
  dir: string;
  painting: string;
  world: string;
  metadata: string;
  legacyMarker: string;
};

export type MapDocumentSummary = {
  stem: string;
  name: string;
  hasPainting: boolean;
  hasWorld: boolean;
  modifiedMs: number;
  chunkCount: number | null;
  renderTriangles: number | null;
  renderCapturedMs: number;
};

type MapDocumentMetadata = {
  version: 1;
  name: string;
  createdMs: number;
  renamedMs: number;
  renderTriangles: number | null;
  renderCapturedMs: number;
};

export type MapDocumentMutationResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

let activeStemCache: string | null = null;

/** User-facing map name -> safe, stable directory stem. */
export function sanitizeMapDocumentName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\- ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    // Leading _/. names are reserved for document-root metadata and hidden
    // from the picker. Never create an authored map the catalog cannot reopen.
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '');
  const bounded = normalized
    .slice(0, MAP_DOCUMENT_STEM_MAX_CHARS)
    .replace(/[-_]+$/, '');
  return bounded || 'untitled';
}

/** Friendly title shown in chrome/cards. The directory stem stays a stable
 * document id, so a rename cannot split world.json from painting.rmap. */
export function normalizeMapDocumentTitle(raw: string): string | null {
  const clean = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAP_DOCUMENT_NAME_MAX_CHARS)
    .trim();
  return clean || null;
}

export function mapDocumentPaths(rawStem: string): MapDocumentPaths {
  const stem = sanitizeMapDocumentName(rawStem);
  const dir = `${MAP_DOCUMENT_ROOT}/${stem}`;
  return {
    stem,
    dir,
    painting: `${dir}/painting.rmap`,
    world: `${dir}/world.json`,
    metadata: `${dir}/meta.json`,
    legacyMarker: `${dir}/${LEGACY_IMPORT_MARKER}`,
  };
}

function writeTextAtomic(path: string, text: string): boolean {
  // Current hosts carry the atomic byte door. The text fallback keeps the
  // editor honest on an older dev binary instead of silently losing the write.
  return writeFileBytesAtomic(path, textBytes(text)) || writeFile(path, text);
}

function validStoredStem(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || sanitizeMapDocumentName(trimmed) !== trimmed) return null;
  return trimmed;
}

function finiteTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function finiteTriangles(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function defaultMetadata(stem: string, name = stem): MapDocumentMetadata {
  return {
    version: MAP_DOCUMENT_META_VERSION,
    name: normalizeMapDocumentTitle(name) ?? stem,
    createdMs: 0,
    renamedMs: 0,
    renderTriangles: null,
    renderCapturedMs: 0,
  };
}

function readMetadata(stem: string): MapDocumentMetadata {
  const fallback = defaultMetadata(stem);
  const text = readFile(mapDocumentPaths(stem).metadata);
  if (!text) return fallback;
  try {
    const raw = JSON.parse(text) as Partial<MapDocumentMetadata>;
    if (raw.version !== MAP_DOCUMENT_META_VERSION) return fallback;
    return {
      version: MAP_DOCUMENT_META_VERSION,
      name: normalizeMapDocumentTitle(typeof raw.name === 'string' ? raw.name : '') ?? stem,
      createdMs: finiteTime(raw.createdMs),
      renamedMs: finiteTime(raw.renamedMs),
      renderTriangles: finiteTriangles(raw.renderTriangles),
      renderCapturedMs: finiteTime(raw.renderCapturedMs),
    };
  } catch {
    return fallback;
  }
}

function writeMetadata(stem: string, metadata: MapDocumentMetadata): boolean {
  const paths = mapDocumentPaths(stem);
  if (!mapDocumentExists(paths.stem)) return false;
  return writeTextAtomic(paths.metadata, JSON.stringify(metadata));
}

export function mapDocumentName(stem: string): string {
  const valid = validStoredStem(stem);
  return valid ? readMetadata(valid).name : sanitizeMapDocumentName(stem);
}

export function mapDocumentExists(stem: string): boolean {
  return stat(mapDocumentPaths(stem).dir)?.isDir === true;
}

export function listMapDocuments(): MapDocumentSummary[] {
  // First read of the authored-data root rescues anything still under the old
  // build-output path (req_4083). Copy-then-verify; it never deletes.
  migrateLegacyEditorData();
  let entries: string[] = [];
  try { entries = listDir(MAP_DOCUMENT_ROOT); } catch { entries = []; }
  return entries
    .filter((entry) => !entry.startsWith('_') && !entry.startsWith('.'))
    .map(validStoredStem)
    .filter((stem): stem is string => !!stem && mapDocumentExists(stem))
    .map((stem) => {
      const paths = mapDocumentPaths(stem);
      const painting = stat(paths.painting);
      const world = stat(paths.world);
      const metadata = readMetadata(stem);
      const paintingSummary = painting ? mapInspectFile(paths.painting) : null;
      return {
        stem,
        name: metadata.name,
        hasPainting: !!painting,
        hasWorld: !!world,
        modifiedMs: Math.max(painting?.mtimeMs ?? 0, world?.mtimeMs ?? 0, metadata.createdMs, metadata.renamedMs),
        chunkCount: paintingSummary?.chunkCount ?? null,
        renderTriangles: metadata.renderTriangles,
        renderCapturedMs: metadata.renderCapturedMs,
      };
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs || a.stem.localeCompare(b.stem));
}

export function uniqueMapDocumentName(rawBase = 'untitled'): string {
  const base = sanitizeMapDocumentName(rawBase);
  if (!mapDocumentExists(base)) return base;
  let suffix = 2;
  while (true) {
    const tag = `-${suffix}`;
    const prefix = base
      .slice(0, MAP_DOCUMENT_STEM_MAX_CHARS - tag.length)
      .replace(/[-_]+$/, '') || 'map';
    const candidate = `${prefix}${tag}`;
    if (!mapDocumentExists(candidate)) return candidate;
    suffix += 1;
  }
}

/** Allocate a new document directory without making it active yet. */
export function createMapDocument(rawName = 'untitled'): string {
  mkdir(MAP_DOCUMENT_ROOT);
  const stem = uniqueMapDocumentName(rawName);
  const dir = mapDocumentPaths(stem).dir;
  if (!mkdir(dir) && !mapDocumentExists(stem)) {
    throw new Error(`could not create map document directory ${dir}`);
  }
  const now = Date.now();
  const metadata = { ...defaultMetadata(stem, rawName), createdMs: now };
  if (!writeMetadata(stem, metadata)) {
    remove(dir);
    throw new Error(`could not initialize map document metadata ${dir}`);
  }
  return stem;
}

/** Rename the user-facing title while retaining the stable on-disk document
 * id. That makes active and inactive rename the same safe operation. */
export function renameMapDocument(stem: string, rawName: string): MapDocumentMutationResult {
  const valid = validStoredStem(stem);
  if (!valid || !mapDocumentExists(valid)) return { ok: false, error: 'map document no longer exists' };
  const name = normalizeMapDocumentTitle(rawName);
  if (!name) return { ok: false, error: 'map name cannot be empty' };
  const prior = readMetadata(valid);
  if (!writeMetadata(valid, { ...prior, name, renamedMs: Date.now() })) {
    return { ok: false, error: `could not write ${mapDocumentPaths(valid).metadata}` };
  }
  return { ok: true, name };
}

/** Store a last-render measurement separately from authored files. Capturing
 * diagnostics never changes the map's last-edit timestamp. */
export function recordMapDocumentRenderStats(stem: string, triangles: number | null): boolean {
  const valid = validStoredStem(stem);
  const count = finiteTriangles(triangles);
  if (!valid || count === null || !mapDocumentExists(valid)) return false;
  const prior = readMetadata(valid);
  return writeMetadata(valid, { ...prior, renderTriangles: count, renderCapturedMs: Date.now() });
}

/** Permanently remove one INACTIVE document directory. The explicit active
 * argument and persisted pointer are both checked so stale UI cannot erase the
 * live map. */
export function deleteMapDocument(stem: string, activeStem: string): MapDocumentMutationResult {
  const valid = validStoredStem(stem);
  if (!valid || !mapDocumentExists(valid)) return { ok: false, error: 'map document no longer exists' };
  const persistedActive = validStoredStem(readFile(MAP_DOCUMENT_POINTER) ?? '');
  if (valid === activeStem || valid === activeStemCache || valid === persistedActive) {
    return { ok: false, error: 'open another map before deleting the active one' };
  }
  const name = readMetadata(valid).name;
  if (!remove(mapDocumentPaths(valid).dir)) return { ok: false, error: `could not remove map document ${valid}` };
  return { ok: true, name };
}

function writeActivePointer(stem: string): boolean {
  mkdir(MAP_DOCUMENT_ROOT);
  return writeTextAtomic(MAP_DOCUMENT_POINTER, `${stem}\n`);
}

/** Boot-time document selection + one-time registration of the two legacy
 * fixed files as a single map. No authored bytes are copied through JS here;
 * each owner imports its own old file directly and writes the named target. */
export function activeMapDocumentStem(): string {
  if (activeStemCache) return activeStemCache;
  mkdir(MAP_DOCUMENT_ROOT);

  const pointer = validStoredStem(readFile(MAP_DOCUMENT_POINTER) ?? '');
  if (pointer && mapDocumentExists(pointer)) {
    activeStemCache = pointer;
    return pointer;
  }

  const hasLegacy = exists(LEGACY_MAP_FILE) || exists(LEGACY_WORLD_FILE);
  const stem = createMapDocument(hasLegacy ? 'legacy' : 'untitled');
  if (hasLegacy) writeTextAtomic(mapDocumentPaths(stem).legacyMarker, 'legacy fixed-file import\n');
  writeActivePointer(stem);
  activeStemCache = stem;
  return stem;
}

/** Commit the pointer only after both target concerns loaded successfully. */
export function setActiveMapDocumentStem(rawStem: string): boolean {
  const stem = sanitizeMapDocumentName(rawStem);
  if (!mapDocumentExists(stem)) return false;
  if (!writeActivePointer(stem)) return false;
  activeStemCache = stem;
  return true;
}

export function hasLegacyMapImport(stem: string): boolean {
  return exists(mapDocumentPaths(stem).legacyMarker);
}

/** Retire the fixed-file fallback once BOTH named concerns exist. Leaving the
 * marker around would let a later deleted world.json resurrect old pieces. */
export function finishLegacyMapImport(stem: string): void {
  const paths = mapDocumentPaths(stem);
  if (exists(paths.painting) && exists(paths.world) && exists(paths.legacyMarker)) remove(paths.legacyMarker);
}
