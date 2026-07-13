// Durable React-owned concern inside one named map document: placed build
// pieces/props, semantic objects, zone definitions, and the monotonic id sequence. Terrain,
// flora, roads, water, and painted zone cells stay in the sibling RMAP owned by
// the native map engine (stage/mapPaint.ts).
//
// The document stem is carried INSIDE world.json as well as in its directory.
// That cheap invariant makes a copied/misrouted save fail loudly instead of
// pairing one map's pieces with another map's ground.
import { mkdir, readFile, writeFile, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { textBytes } from '../../../runtime/workspace/lumps';
import type { PlacedPiece } from '../world/pieces';
import type { MapZoneDef } from '../stage/mapPaint';
import type { WorldObject } from './types';
import {
  LEGACY_WORLD_FILE,
  finishLegacyMapImport,
  hasLegacyMapImport,
  mapDocumentPaths,
  sanitizeMapDocumentName,
} from './mapDocuments';

export type WorldSave = {
  version: 2;
  /** Must equal the containing directory stem. */
  document: string;
  /** EditorState.seq at save time — restored so minted ids never collide. */
  seq: number;
  pieces: PlacedPiece[];
  /** Semantic map objects/markers (triggers, mission points, etc.). */
  objects: WorldObject[];
  /** Zone definitions; painted zone cells live in painting.rmap. */
  zones: MapZoneDef[];
};

export type WorldLoadResult =
  | { status: 'ok'; save: WorldSave; migratedLegacy: boolean }
  | { status: 'missing'; save: null; migratedLegacy: false }
  | { status: 'invalid'; save: null; migratedLegacy: false; error: string };

type ParseOptions = { allowLegacyV1?: boolean };

// A malformed document is read-only for the life of this JS context. Boot may
// redirect to a clean recovery map, but even if that pointer write fails the
// first debounce cannot destroy the only forensic/recoverable copy.
const writeProtectedDocuments = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPiece(value: unknown): value is PlacedPiece {
  const piece = value as Partial<PlacedPiece> | null;
  if (!piece || typeof piece.id !== 'string' || typeof piece.pieceId !== 'string') return false;
  if (!finite(piece.x) || !finite(piece.y) || !finite(piece.z) || !finite(piece.yawDegrees)) return false;
  if (piece.floor !== undefined && (!finite(piece.floor) || !Number.isInteger(piece.floor))) return false;
  if (piece.slots !== undefined) {
    if (!isRecord(piece.slots)) return false;
    for (const ref of Object.values(piece.slots)) {
      if (!isRecord(ref)) return false;
      const byAsset = typeof ref.assetId === 'string';
      const byRecipe = typeof ref.fn === 'string' && finite(ref.variant);
      if (!byAsset && !byRecipe) return false;
    }
  }
  if (piece.overrides !== undefined) {
    if (!isRecord(piece.overrides)) return false;
    for (const override of Object.values(piece.overrides)) {
      if (typeof override !== 'boolean' && !finite(override)) return false;
    }
  }
  return true;
}

function validZone(value: unknown): value is MapZoneDef {
  const zone = value as Partial<MapZoneDef> | null;
  return !!zone && typeof zone.id === 'string' && typeof zone.name === 'string' && typeof zone.color === 'string';
}

function validObject(value: unknown): value is WorldObject {
  const object = value as Partial<WorldObject> | null;
  return !!object
    && typeof object.id === 'string'
    && typeof object.kind === 'string'
    && typeof object.name === 'string'
    && typeof object.assetId === 'string'
    && finite(object.left)
    && finite(object.top)
    && finite(object.width)
    && finite(object.height)
    && Array.isArray(object.metrics)
    && object.metrics.every((metric) => Array.isArray(metric) && metric.length === 2 && metric.every((part) => typeof part === 'string'))
    && (object.hidden === undefined || typeof object.hidden === 'boolean');
}

function validatedArray<T>(value: unknown, label: string, validate: (item: unknown) => item is T, optional = false): T[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (let i = 0; i < value.length; i += 1) {
    if (!validate(value[i])) throw new Error(`${label}[${i}] is malformed`);
  }
  return value as T[];
}

/** Strict parser used by boot and Open. v1 had no document id and is accepted
 * only through the one-time fixed-file migration path. */
export function parseWorldSaveText(text: string, expectedStem: string, options: ParseOptions = {}): WorldSave {
  const expected = sanitizeMapDocumentName(expectedStem);
  const raw = JSON.parse(text) as {
    version?: unknown;
    document?: unknown;
    seq?: unknown;
    pieces?: unknown;
    objects?: unknown;
    zones?: unknown;
  };
  const legacy = raw.version === 1 && options.allowLegacyV1 === true;
  if (raw.version !== 2 && !legacy) throw new Error(`unrecognized world save version ${raw.version}`);
  if (!legacy && raw.document !== expected) {
    throw new Error(`document id '${String(raw.document)}' does not match directory '${expected}'`);
  }
  return {
    version: 2,
    document: expected,
    seq: typeof raw.seq === 'number' && Number.isFinite(raw.seq) && raw.seq > 0 ? Math.trunc(raw.seq) : 1,
    pieces: validatedArray(raw.pieces, 'pieces', validPiece),
    objects: validatedArray(raw.objects, 'objects', validObject, true),
    zones: validatedArray(raw.zones, 'zones', validZone, true),
  };
}

export function emptyWorldSave(stem: string, seq = 1): WorldSave {
  return { version: 2, document: sanitizeMapDocumentName(stem), seq: Math.max(1, Math.trunc(seq)), pieces: [], objects: [], zones: [] };
}

/** Read one named document without changing any active state. Open uses the
 * result to validate the target BEFORE flushing/switching the current map. */
export function readWorldSave(stem: string): WorldLoadResult {
  const paths = mapDocumentPaths(stem);
  let text = readFile(paths.world);
  let migratedLegacy = false;
  if (text === null && hasLegacyMapImport(paths.stem)) {
    text = readFile(LEGACY_WORLD_FILE);
    migratedLegacy = text !== null;
  }
  if (text === null) {
    writeProtectedDocuments.delete(paths.stem);
    return { status: 'missing', save: null, migratedLegacy: false };
  }
  try {
    const result: WorldLoadResult = {
      status: 'ok',
      save: parseWorldSaveText(text, paths.stem, { allowLegacyV1: migratedLegacy }),
      migratedLegacy,
    };
    writeProtectedDocuments.delete(paths.stem);
    return result;
  } catch (error) {
    writeProtectedDocuments.add(paths.stem);
    return { status: 'invalid', save: null, migratedLegacy: false, error: (error as Error).message };
  }
}

function writeWorldSave(save: WorldSave): boolean {
  const paths = mapDocumentPaths(save.document);
  if (paths.stem !== save.document) return false;
  if (writeProtectedDocuments.has(paths.stem)) {
    console.error(`[world-store] REFUSED to overwrite malformed ${paths.world}; open/create another map or repair the file explicitly`);
    return false;
  }
  mkdir(paths.dir);
  const text = JSON.stringify(save);
  const ok = writeFileBytesAtomic(paths.world, textBytes(text)) || writeFile(paths.world, text);
  if (!ok) console.error(`[world-store] SAVE FAILED: ${paths.world}`);
  if (ok) finishLegacyMapImport(paths.stem);
  return ok;
}

export function saveWorldNow(save: WorldSave): boolean {
  return writeWorldSave(save);
}

function snapshot(
  stem: string,
  pieces: readonly PlacedPiece[],
  objects: readonly WorldObject[],
  zones: readonly MapZoneDef[],
  seq: number,
): WorldSave {
  return {
    version: 2,
    document: sanitizeMapDocumentName(stem),
    seq: Math.max(1, Math.trunc(seq)),
    pieces: pieces as PlacedPiece[],
    objects: objects as WorldObject[],
    zones: zones as MapZoneDef[],
  };
}

// One pending snapshot is enough because exactly one map is active. Crucially,
// the queued write retains ITS stem; a later switch can never retarget an old
// pieces array into the incoming map's file.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queued: WorldSave | null = null;

function writeQueued(): void {
  saveTimer = null;
  const save = queued;
  queued = null;
  if (save) writeWorldSave(save);
}

export function scheduleWorldSave(
  stem: string,
  pieces: readonly PlacedPiece[],
  objects: readonly WorldObject[],
  zones: readonly MapZoneDef[],
  seq: number,
  options: { enabled?: boolean; delayMs?: number } = {},
): void {
  if (options.enabled === false) {
    cancelWorldSave();
    return;
  }
  queued = snapshot(stem, pieces, objects, zones, seq);
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeQueued, Math.max(0, options.delayMs ?? 400));
}

/** Drop only a not-yet-written background snapshot. Explicit Save/flush owns
 * its own fresh snapshot and never calls this as a substitute for writing. */
export function cancelWorldSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  queued = null;
}

/** Synchronous switch boundary: cancel the debounce and durably write the
 * outgoing document before any target state is applied. */
export function flushWorldSave(
  stem: string,
  pieces: readonly PlacedPiece[],
  objects: readonly WorldObject[],
  zones: readonly MapZoneDef[],
  seq: number,
): boolean {
  cancelWorldSave();
  return writeWorldSave(snapshot(stem, pieces, objects, zones, seq));
}
