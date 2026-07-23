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
import {
  GENERATED_SITE_GENERATOR,
  GENERATED_SITE_FLOOR_PIECE_ID,
  GENERATED_SITE_LIMITS,
  GENERATED_SITE_VERSION,
  PIECE_MODULE_METERS,
  type GeneratedSiteProvenance,
  type PlacedPiece,
} from '../world/pieces';
import { validFacade, type Facade } from '../world/facades';
import type { MapZoneDef } from '../stage/mapPaint';
import type { WorldObject } from './types';
import { validWorldPrefab, type WorldPrefab } from '../world/prefabs';
import { SURFACE_FLORA_TUNING, type SurfaceFloraPatch, type WorldFloraPatch } from '../world/surfaceFlora';
import {
  LEGACY_WORLD_FILE,
  finishLegacyMapImport,
  hasLegacyMapImport,
  mapDocumentPaths,
  sanitizeMapDocumentName,
} from './mapDocuments';

export type WorldSave = {
  version: 4;
  /** Must equal the containing directory stem. */
  document: string;
  /** EditorState.seq at save time — restored so minted ids never collide. */
  seq: number;
  pieces: PlacedPiece[];
  /** Package-backed custom flora painted on terrain. */
  worldFlora: WorldFloraPatch[];
  /** Named compositions; stamping decomposes them back into `pieces`. */
  prefabs: WorldPrefab[];
  /** Semantic map objects/markers (triggers, mission points, etc.). */
  objects: WorldObject[];
  /** Zone definitions; painted zone cells live in painting.rmap. */
  zones: MapZoneDef[];
  /** Graffiti facades (req_3057) — plane-anchored paint programs, never pixels. */
  facades: Facade[];
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

const GENERATED_SITE_KEYS = [
  'generator',
  'version',
  'seed',
  'siteId',
  'intendedUse',
  'widthM',
  'depthM',
  'suggestedMaxFloors',
  'frontagePathId',
] as const;
const GENERATED_SITE_KEY_SET = new Set<string>(GENERATED_SITE_KEYS);
const GENERATED_SITE_YAWS = new Set([0, 90, 180, 270]);

function boundedNonemptyText(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= GENERATED_SITE_LIMITS.maxTextChars
    && value.trim() === value;
}

function validGeneratedSite(value: unknown): value is GeneratedSiteProvenance {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== GENERATED_SITE_KEYS.length || keys.some((key) => !GENERATED_SITE_KEY_SET.has(key))) return false;
  if (value.generator !== GENERATED_SITE_GENERATOR || value.version !== GENERATED_SITE_VERSION) return false;
  if (!finite(value.seed) || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > GENERATED_SITE_LIMITS.maxSeed) return false;
  if (!boundedNonemptyText(value.siteId) || !boundedNonemptyText(value.intendedUse) || !boundedNonemptyText(value.frontagePathId)) return false;
  if (!finite(value.widthM)
    || value.widthM <= 0
    || value.widthM > GENERATED_SITE_LIMITS.maxFootprintMeters
    || !Number.isInteger(value.widthM / PIECE_MODULE_METERS)) return false;
  if (!finite(value.depthM)
    || value.depthM <= 0
    || value.depthM > GENERATED_SITE_LIMITS.maxFootprintMeters
    || !Number.isInteger(value.depthM / PIECE_MODULE_METERS)) return false;
  return finite(value.suggestedMaxFloors)
    && Number.isInteger(value.suggestedMaxFloors)
    && value.suggestedMaxFloors > 0
    && value.suggestedMaxFloors <= GENERATED_SITE_LIMITS.maxSuggestedFloors;
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
  if (piece.spinDegPerSec !== undefined && !finite(piece.spinDegPerSec)) return false;
  if (piece.scale !== undefined && (!finite(piece.scale) || piece.scale <= 0)) return false;
  if (piece.surfaceFlora !== undefined) {
    if (!Array.isArray(piece.surfaceFlora) || piece.surfaceFlora.length > SURFACE_FLORA_TUNING.maxPatchesPerPiece) return false;
    if (!piece.surfaceFlora.every(validSurfaceFloraPatch)) return false;
  }
  if (piece.stickers !== undefined) {
    if (!Array.isArray(piece.stickers)) return false;
    for (const s of piece.stickers) {
      if (!isRecord(s)) return false;
      if (typeof s.id !== 'string' || typeof s.stickerId !== 'string' || typeof s.role !== 'string') return false;
      if (!finite(s.lx) || !finite(s.ly) || !finite(s.lz)) return false;
      if (!finite(s.nx) || !finite(s.ny) || !finite(s.nz)) return false;
      if (!finite(s.scale) || (s.scale as number) <= 0) return false;
      if (!finite(s.rot) || !Number.isInteger(s.rot)) return false;
    }
  }
  if (piece.generatedSite !== undefined) {
    if (!validGeneratedSite(piece.generatedSite)) return false;
    if (piece.pieceId !== GENERATED_SITE_FLOOR_PIECE_ID || piece.floor !== 0) return false;
    if (!GENERATED_SITE_YAWS.has(piece.yawDegrees)) return false;
    if (!Number.isInteger((piece.x - PIECE_MODULE_METERS / 2) / PIECE_MODULE_METERS)) return false;
    if (!Number.isInteger((piece.z - PIECE_MODULE_METERS / 2) / PIECE_MODULE_METERS)) return false;
  }
  return true;
}

function validDensity(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}

function validSurfaceFloraPatch(value: unknown): value is SurfaceFloraPatch {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.speciesId === 'string'
    && typeof value.role === 'string'
    && finite(value.triangle) && Number.isInteger(value.triangle) && value.triangle >= 0
    && finite(value.lx) && finite(value.ly) && finite(value.lz)
    && validDensity(value.density)
    && finite(value.radiusM) && value.radiusM > 0
    && finite(value.seed) && Number.isInteger(value.seed) && value.seed >= 0;
}

function validWorldFloraPatch(value: unknown): value is WorldFloraPatch {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.speciesId === 'string'
    && finite(value.x) && finite(value.y) && finite(value.z)
    && validDensity(value.density)
    && finite(value.radiusM) && value.radiusM > 0
    && finite(value.seed) && Number.isInteger(value.seed) && value.seed >= 0;
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

function validateUniqueGeneratedSiteIds(pieces: readonly PlacedPiece[]): void {
  const siteIds = new Set<string>();
  for (const piece of pieces) {
    const siteId = piece.generatedSite?.siteId;
    if (siteId === undefined) continue;
    if (siteIds.has(siteId)) throw new Error(`generated site '${siteId}' is duplicated`);
    siteIds.add(siteId);
  }
}

function validatePrefabPayloads(prefabs: readonly WorldPrefab[]): void {
  const ids = new Set<string>();
  for (const prefab of prefabs) {
    if (ids.has(prefab.id)) throw new Error(`prefab '${prefab.id}' is duplicated`);
    ids.add(prefab.id);
    for (let index = 0; index < prefab.pieces.length; index += 1) {
      const source = prefab.pieces[index]! as WorldPrefab['pieces'][number] & { generatedSite?: unknown };
      if (source.generatedSite !== undefined) throw new Error(`prefabs[${prefab.id}].pieces[${index}] carries generated-site provenance`);
      const { floorOffset, ...candidate } = source;
      if (!validPiece({ ...candidate, id: `prefab-check-${index}`, floor: floorOffset })) {
        throw new Error(`prefabs[${prefab.id}].pieces[${index}] is malformed`);
      }
    }
  }
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
    facades?: unknown;
    prefabs?: unknown;
    worldFlora?: unknown;
  };
  const legacy = raw.version === 1 && options.allowLegacyV1 === true;
  const priorV2 = raw.version === 2;
  const priorV3 = raw.version === 3;
  if (raw.version !== 4 && !priorV3 && !priorV2 && !legacy) throw new Error(`unrecognized world save version ${raw.version}`);
  if (!legacy && raw.document !== expected) {
    throw new Error(`document id '${String(raw.document)}' does not match directory '${expected}'`);
  }
  const pieces = validatedArray(raw.pieces, 'pieces', validPiece);
  validateUniqueGeneratedSiteIds(pieces);
  const prefabs = validatedArray(raw.prefabs, 'prefabs', validWorldPrefab, true);
  validatePrefabPayloads(prefabs);
  const worldFlora = validatedArray(raw.worldFlora, 'worldFlora', validWorldFloraPatch, true);
  if (worldFlora.length > SURFACE_FLORA_TUNING.maxWorldPatches) throw new Error('worldFlora exceeds its bounded recipe budget');
  return {
    version: 4,
    document: expected,
    seq: typeof raw.seq === 'number' && Number.isFinite(raw.seq) && raw.seq > 0 ? Math.trunc(raw.seq) : 1,
    pieces,
    worldFlora,
    prefabs,
    objects: validatedArray(raw.objects, 'objects', validObject, true),
    zones: validatedArray(raw.zones, 'zones', validZone, true),
    facades: validatedArray(raw.facades ?? [], 'facades', validFacade, true),
  };
}

export function emptyWorldSave(stem: string, seq = 1): WorldSave {
  return { version: 4, document: sanitizeMapDocumentName(stem), seq: Math.max(1, Math.trunc(seq)), pieces: [], worldFlora: [], prefabs: [], objects: [], zones: [], facades: [] };
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
  facades: readonly Facade[],
  prefabs: readonly WorldPrefab[],
  worldFlora: readonly WorldFloraPatch[],
): WorldSave {
  return {
    version: 4,
    document: sanitizeMapDocumentName(stem),
    seq: Math.max(1, Math.trunc(seq)),
    pieces: pieces as PlacedPiece[],
    worldFlora: worldFlora as WorldFloraPatch[],
    prefabs: prefabs as WorldPrefab[],
    objects: objects as WorldObject[],
    zones: zones as MapZoneDef[],
    facades: facades as Facade[],
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
  facades: readonly Facade[] = [],
  prefabs: readonly WorldPrefab[] = [],
  worldFlora: readonly WorldFloraPatch[] = [],
): void {
  if (options.enabled === false) {
    cancelWorldSave();
    return;
  }
  queued = snapshot(stem, pieces, objects, zones, seq, facades, prefabs, worldFlora);
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
  facades: readonly Facade[] = [],
  prefabs: readonly WorldPrefab[] = [],
  worldFlora: readonly WorldFloraPatch[] = [],
): boolean {
  cancelWorldSave();
  return writeWorldSave(snapshot(stem, pieces, objects, zones, seq, facades, prefabs, worldFlora));
}
