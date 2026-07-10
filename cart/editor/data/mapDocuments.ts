// Named editor map documents. A document is a DIRECTORY boundary: every
// authored concern for one map lives below the same stem, so opening a map can
// never accidentally pair another map's pieces with this map's terrain.
//
//   zig-out/game/editor/maps/<stem>/painting.rmap  host-owned terrain/flora/roads
//   zig-out/game/editor/maps/<stem>/world.json     pieces + objects + zone legend + id seq
//   zig-out/game/editor/maps/_last.txt             last-open document pointer
//
// The previous editor used two unrelated fixed files. On the first boot after
// this change we register those files as ONE `legacy` document; each concern is
// imported into the directory by its owning persistence layer. That migration
// runs once and never becomes a fallback for later documents.
import { exists, listDir, mkdir, readFile, remove, stat, writeFile, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { textBytes } from '../../../runtime/workspace/lumps';

export const MAP_DOCUMENT_ROOT = 'zig-out/game/editor/maps';
export const MAP_DOCUMENT_POINTER = `${MAP_DOCUMENT_ROOT}/_last.txt`;
export const LEGACY_MAP_FILE = 'zig-out/game/editor/painted-map.rmap';
export const LEGACY_WORLD_FILE = 'zig-out/game/editor/world-pieces.json';
export const MAP_DOCUMENT_STEM_MAX_CHARS = 64;
const LEGACY_IMPORT_MARKER = '.legacy-import';

export type MapDocumentPaths = {
  stem: string;
  dir: string;
  painting: string;
  world: string;
  legacyMarker: string;
};

export type MapDocumentSummary = {
  stem: string;
  hasPainting: boolean;
  hasWorld: boolean;
  modifiedMs: number;
};

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

export function mapDocumentPaths(rawStem: string): MapDocumentPaths {
  const stem = sanitizeMapDocumentName(rawStem);
  const dir = `${MAP_DOCUMENT_ROOT}/${stem}`;
  return {
    stem,
    dir,
    painting: `${dir}/painting.rmap`,
    world: `${dir}/world.json`,
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

export function mapDocumentExists(stem: string): boolean {
  return stat(mapDocumentPaths(stem).dir)?.isDir === true;
}

export function listMapDocuments(): MapDocumentSummary[] {
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
      return {
        stem,
        hasPainting: !!painting,
        hasWorld: !!world,
        modifiedMs: Math.max(painting?.mtimeMs ?? 0, world?.mtimeMs ?? 0),
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
  return stem;
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
