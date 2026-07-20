import {
  PIECE_MODULE_METERS,
  pieceKindOf,
  resolvePlacement,
  WORLD_PIECE_AUTHORING_TUNING,
  type PlacedPiece,
} from './pieces';
import { METERS_PER_LEVEL } from './isoStage';

export const WORLD_PREFAB_TUNING = Object.freeze({
  maxPieces: WORLD_PIECE_AUTHORING_TUNING.maxCompositionPieces,
  maxNameCharacters: 80,
});

export type WorldPrefabPiece = Omit<PlacedPiece, 'id' | 'x' | 'y' | 'z' | 'floor' | 'generatedSite'> & {
  x: number;
  y: number;
  z: number;
  floorOffset: number;
};

/** A palette composition only. Stamping immediately decomposes this into
 * ordinary PlacedPiece rows; no prefab instance/blob survives in the world. */
export type WorldPrefab = {
  id: string;
  label: string;
  pieces: WorldPrefabPiece[];
};

/** Runtime-safe lookup for viewport hydration. Older persisted/hot component
 *  shapes can briefly omit the prefab list; absence means "no prefab match",
 *  never an exception while resolving an ordinary armed piece. */
export function worldPrefabById(
  prefabs: readonly WorldPrefab[] | null | undefined,
  id: string,
): WorldPrefab | null {
  return prefabs?.find((prefab) => prefab.id === id) ?? null;
}

function cloneRecord<T extends Record<string, unknown> | undefined>(value: T): T {
  return (value ? { ...value } : value) as T;
}

function clonePrefabPiece(piece: WorldPrefabPiece): WorldPrefabPiece {
  return {
    ...piece,
    slots: piece.slots ? Object.fromEntries(Object.entries(piece.slots).map(([key, value]) => [key, { ...value }])) : undefined,
    overrides: cloneRecord(piece.overrides),
    stickers: piece.stickers?.map((sticker) => ({ ...sticker })),
    surfaceFlora: piece.surfaceFlora?.map((patch) => ({ ...patch })),
  };
}

function normalizeYaw(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

function rotateOffset(x: number, z: number, yawDegrees: number): [number, number] {
  const yaw = normalizeYaw(yawDegrees) * Math.PI / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [x * cos + z * sin, -x * sin + z * cos];
}

/** Old hmsc-int naming law: readable lower-camel prefab ids, collision-safe. */
export function mintWorldPrefabId(label: string, existing: readonly WorldPrefab[] = []): string {
  const words = label.trim().replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const slug = words.map((word, index) => {
    const lower = word.toLowerCase();
    return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('') || 'unnamed';
  const base = `prefab.${slug}`;
  const ids = new Set(existing.map((prefab) => prefab.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

/** Capture the selected ordinary pieces relative to their minimum placement
 * center, matching the proven hmsc-int prefab contract. Runtime-only generated
 * site provenance is intentionally not cloned into a reusable composition. */
export function prefabFromPieces(
  id: string,
  label: string,
  pieces: readonly PlacedPiece[],
): WorldPrefab {
  if (pieces.length === 0) throw new Error('a prefab needs at least one selected piece');
  if (pieces.length > WORLD_PREFAB_TUNING.maxPieces) throw new Error(`a prefab can contain at most ${WORLD_PREFAB_TUNING.maxPieces} pieces`);
  const cleanLabel = label.trim();
  if (!cleanLabel || cleanLabel.length > WORLD_PREFAB_TUNING.maxNameCharacters) {
    throw new Error(`prefab name must be 1-${WORLD_PREFAB_TUNING.maxNameCharacters} characters`);
  }
  const originX = Math.min(...pieces.map((piece) => piece.x));
  const originY = Math.min(...pieces.map((piece) => piece.y));
  const originZ = Math.min(...pieces.map((piece) => piece.z));
  const baseFloor = Math.min(...pieces.map((piece) => piece.floor ?? 0));
  return {
    id,
    label: cleanLabel,
    pieces: pieces.map((piece) => ({
      pieceId: piece.pieceId,
      x: piece.x - originX,
      y: piece.y - originY,
      z: piece.z - originZ,
      yawDegrees: normalizeYaw(piece.yawDegrees),
      floorOffset: (piece.floor ?? 0) - baseFloor,
      slots: piece.slots ? Object.fromEntries(Object.entries(piece.slots).map(([key, value]) => [key, { ...value }])) : undefined,
      overrides: cloneRecord(piece.overrides),
      stickers: piece.stickers?.map((sticker) => ({ ...sticker })),
      surfaceFlora: piece.surfaceFlora?.map((patch) => ({ ...patch })),
      spinDegPerSec: piece.spinDegPerSec,
    })),
  };
}

/** The floor/roof whose center must land on the normal piece lattice. This is
 * the req_0668 fix from hmsc-int: snapping a capture's arbitrary min origin is
 * what put prefab floors on a different axis from native floors. */
export function prefabGridAnchor(prefab: WorldPrefab): WorldPrefabPiece | null {
  let roof: WorldPrefabPiece | null = null;
  for (const piece of prefab.pieces) {
    const kind = pieceKindOf(piece.pieceId);
    if (kind === 'floor') return piece;
    if (kind === 'roof' && roof === null) roof = piece;
  }
  return roof;
}

export function stampWorldPrefab(
  prefab: WorldPrefab,
  origin: { x: number; y: number; z: number; floor: number },
  yawDegrees: number,
): PlacedPiece[] {
  return prefab.pieces.map((source) => {
    const piece = clonePrefabPiece(source);
    const [dx, dz] = rotateOffset(piece.x, piece.z, yawDegrees);
    return {
      id: '',
      pieceId: piece.pieceId,
      x: origin.x + dx,
      y: origin.y + piece.y,
      z: origin.z + dz,
      yawDegrees: normalizeYaw(piece.yawDegrees + yawDegrees),
      floor: origin.floor + piece.floorOffset,
      slots: piece.slots,
      overrides: piece.overrides,
      stickers: piece.stickers,
      surfaceFlora: piece.surfaceFlora,
      spinDegPerSec: piece.spinDegPerSec,
    };
  });
}

/** Resolve one cursor point into the decomposed preview/stamp. The composition's
 * plate anchor uses the exact normal placement solver, then local offsets rotate
 * around the prefab origin. */
export function resolvePrefabPlacement(
  prefab: WorldPrefab,
  cursor: { x: number; z: number; terrainY: number },
  floor: number,
  yawDegrees: number,
): PlacedPiece[] {
  const anchor = prefabGridAnchor(prefab) ?? prefab.pieces[0];
  if (!anchor) return [];
  const anchorFloor = floor + anchor.floorOffset;
  const resolvedAnchor = resolvePlacement(
    anchor.pieceId,
    cursor.x,
    cursor.z,
    anchorFloor,
    cursor.terrainY,
    0,
    normalizeYaw(anchor.yawDegrees + yawDegrees),
  );
  // Headless/editor-startup projection may run before the catalog validator
  // host door is present. The semantic command validates every decomposed row
  // again at commit; this fallback only keeps the preview on the piece lattice.
  const kind = pieceKindOf(anchor.pieceId);
  const moduleCenter = (value: number) => Math.floor(value / PIECE_MODULE_METERS) * PIECE_MODULE_METERS + PIECE_MODULE_METERS / 2;
  const placedAnchor = resolvedAnchor ?? {
    x: kind === 'prop' ? cursor.x : moduleCenter(cursor.x),
    y: cursor.terrainY + Math.max(0, anchorFloor) * METERS_PER_LEVEL,
    z: kind === 'prop' ? cursor.z : moduleCenter(cursor.z),
  };
  const [anchorX, anchorZ] = rotateOffset(anchor.x, anchor.z, yawDegrees);
  return stampWorldPrefab(prefab, {
    x: placedAnchor.x - anchorX,
    y: placedAnchor.y - anchor.y,
    z: placedAnchor.z - anchorZ,
    floor,
  }, yawDegrees);
}

export function validWorldPrefab(value: unknown): value is WorldPrefab {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prefab = value as Partial<WorldPrefab>;
  if (typeof prefab.id !== 'string' || !prefab.id.startsWith('prefab.') || typeof prefab.label !== 'string') return false;
  if (!prefab.label.trim() || prefab.label.length > WORLD_PREFAB_TUNING.maxNameCharacters) return false;
  if (!Array.isArray(prefab.pieces) || prefab.pieces.length < 1 || prefab.pieces.length > WORLD_PREFAB_TUNING.maxPieces) return false;
  return prefab.pieces.every((piece) => {
    if (!piece || typeof piece !== 'object') return false;
    const row = piece as Partial<WorldPrefabPiece>;
    const structurallyKnown = typeof row.pieceId === 'string'
      && (!!pieceKindOf(row.pieceId) || row.pieceId.startsWith('model:') || row.pieceId.startsWith('prop:'));
    return structurallyKnown
      && [row.x, row.y, row.z, row.yawDegrees].every((entry) => typeof entry === 'number' && Number.isFinite(entry))
      && typeof row.floorOffset === 'number' && Number.isInteger(row.floorOffset) && row.floorOffset >= 0;
  });
}
