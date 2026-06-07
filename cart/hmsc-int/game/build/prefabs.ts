// game/build/prefabs — PREFABS/COMPOSITIONS, first-class (V24 addendum).
// "i can just place basic walls, cut them out, make a building, then clone it
// into a tool, and go place it around. new building is just the same
// authoring as the last building, i physically make it in the game."
//
// A Prefab is a NAMED composition of placed pieces (with their edits), saved
// from the world into the palette as one placeable unit. The LAW: prefabs
// DECOMPOSE to their semantic pieces — the bake contract sees through them
// (a cloned motel is still walls/doors/rooms to collision/nav/rooms emission;
// NO OPAQUE BLOBS). Placing a prefab is ONE authoring action (one
// session-history commit); edits to a placed instance work at PIECE
// granularity. Prefab definitions are P2 DATA — the static seeds below plus
// world-saved entries on the V20 streams; same registry family as pieces.
//
// ONE MODEL, TWO VIEWS: a PrefabPiece is the same semantic placement every
// authoring mode edits (pieceId + local grid pos + rotation + edit) — nothing
// here assumes a camera or interaction mode.

import { catalogEntry, effectiveTags, isCatalogId, type BuildPieceDef, type BuildTheme } from './catalog';
import { BUILD_KIND_CONTRACTS, type BuildGameplayTags } from './pieces';
import { isWallEdit, type WallEdit } from './edits';
import { skinSetProblems, type BuildSkinSet, type BuildTypeSkins } from './skins';

// One placed piece inside a prefab: a catalog reference + a LOCAL placement
// relative to the prefab origin, on the 1m substrate (R4).
export type PrefabPiece = {
  pieceId: string; // BUILD_CATALOG id
  x: number;
  y: number;
  z: number;
  // Rotation about +Y in degrees (grid/edge pieces author in 90° steps; the
  // data stays general for free-snap pieces).
  yawDegrees: number;
  // The meaningful cutout on THIS placement (wall-family pieces only).
  edit?: WallEdit;
  // BUILDSKIN-0606 (addition; older defs stay valid): the per-piece face-skin
  // OVERRIDE — beats the def-level type global. Rides the piece itself so
  // structure edits (swap/remove/add) never detach a skin from its piece.
  skin?: BuildSkinSet;
};

export type BuildPrefabDef = {
  id: string;
  label: string;
  theme: BuildTheme;
  pieces: PrefabPiece[];
  // BUILDSKIN-0606 (addition): the GLOBAL face skins per piece TYPE —
  // "all walls → green" lives here; per-piece overrides above beat it.
  skins?: BuildTypeSkins;
};

// What decomposition hands the bake (and any view): the placed piece with its
// catalog row and EFFECTIVE tags resolved — the semantic pieces underneath,
// never a blob.
export type DecomposedPiece = {
  pieceId: string;
  def: BuildPieceDef;
  // World placement = prefab origin + local placement.
  x: number;
  y: number;
  z: number;
  yawDegrees: number;
  edit?: WallEdit;
  tags: BuildGameplayTags;
};

// Static seeds. World-saved prefabs join this table through the V20 streams;
// the seed proves the shape (and gives the meaning-tests a real composition):
// one 3×3 motel room — four walls (a door, a window), floor, roof.
export const BUILD_PREFAB_DEFINITIONS: Record<string, BuildPrefabDef> = {
  'prefab.motelRoom': {
    id: 'prefab.motelRoom',
    label: 'Motel Room',
    theme: 'motel',
    pieces: [
      { pieceId: 'floor.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 },
      { pieceId: 'wall.stucco.motel', x: 0, y: 0, z: 0, yawDegrees: 0, edit: 'door' },
      { pieceId: 'wall.stucco.motel', x: 0, y: 0, z: 3, yawDegrees: 0, edit: 'window' },
      { pieceId: 'wall.stucco.motel', x: 0, y: 0, z: 0, yawDegrees: 90 },
      { pieceId: 'wall.stucco.motel', x: 3, y: 0, z: 0, yawDegrees: 90 },
      { pieceId: 'roof.flat.common', x: 0, y: 3, z: 0, yawDegrees: 0 },
    ],
  },
};

export const BUILD_PREFAB_IDS = Object.keys(BUILD_PREFAB_DEFINITIONS);

export function isPrefabId(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILD_PREFAB_DEFINITIONS, value);
}

export function prefabDefinition(id: string): BuildPrefabDef {
  const def = BUILD_PREFAB_DEFINITIONS[id];
  if (!def) throw new Error(`build prefabs: unknown prefab id '${id}'`);
  return def;
}

/** The see-through: a prefab placed at a world origin IS its semantic pieces
 *  with effective tags — what collision/nav/rooms emission consumes. */
export function decomposePrefab(
  prefab: BuildPrefabDef,
  origin: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): DecomposedPiece[] {
  return prefab.pieces.map((piece) => {
    const def = catalogEntry(piece.pieceId);
    return {
      pieceId: piece.pieceId,
      def,
      x: origin.x + piece.x,
      y: origin.y + piece.y,
      z: origin.z + piece.z,
      yawDegrees: piece.yawDegrees,
      edit: piece.edit,
      tags: effectiveTags(def, piece.edit),
    };
  });
}

/** Every way a prefab can be malformed: empty composition, dangling catalog
 *  references, edits on kinds that take none. Empty = valid. */
export function validatePrefab(prefab: BuildPrefabDef): string[] {
  const problems: string[] = [];
  if (prefab.pieces.length === 0) problems.push(`${prefab.id}: a prefab composes at least one piece`);
  for (const [index, piece] of prefab.pieces.entries()) {
    if (!isCatalogId(piece.pieceId)) {
      problems.push(`${prefab.id}[${index}]: unknown catalog piece '${piece.pieceId}'`);
      continue;
    }
    if (piece.edit !== undefined) {
      if (!isWallEdit(piece.edit)) {
        problems.push(`${prefab.id}[${index}]: unknown edit '${piece.edit}'`);
        continue;
      }
      const kind = catalogEntry(piece.pieceId).kind;
      if (BUILD_KIND_CONTRACTS[kind].edits !== 'wall')
        problems.push(`${prefab.id}[${index}]: kind '${kind}' accepts no edits`);
    }
    // BUILDSKIN-0606: override shape (material EXISTENCE is the editor
    // boundary's check — the registry lives React-side)
    problems.push(...skinSetProblems(piece.skin, `${prefab.id}[${index}].skin`));
  }
  if (prefab.skins !== undefined) {
    for (const kind of Object.keys(prefab.skins)) {
      if (!Object.prototype.hasOwnProperty.call(BUILD_KIND_CONTRACTS, kind)) {
        problems.push(`${prefab.id}.skins: unknown piece kind '${kind}'`);
        continue;
      }
      problems.push(...skinSetProblems(prefab.skins[kind as keyof typeof prefab.skins], `${prefab.id}.skins.${kind}`));
    }
  }
  return problems;
}

export function validatePrefabs(
  prefabs: Record<string, BuildPrefabDef> = BUILD_PREFAB_DEFINITIONS,
): string[] {
  const problems: string[] = [];
  for (const id of Object.keys(prefabs)) {
    const def = prefabs[id];
    if (def.id !== id) problems.push(`${id}: prefab.id '${def.id}' does not match its table key`);
    problems.push(...validatePrefab(def));
  }
  return problems;
}

export function prefabIdsForConsole(): string {
  return BUILD_PREFAB_IDS.join(', ');
}
