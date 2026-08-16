import { authoredPieceFrom, isAuthoredPiece, type AuthoredBuildPiece } from './authoredRegistry';
import type { AuthoredFloraSpecies } from './floraSpecies';
import type { PlacedPiece } from './pieces';
import type { WorldFloraPatch } from './surfaceFlora';

export type WorldResidentDemand = {
  authoredPieces: readonly AuthoredBuildPiece[];
  floraSpecies: readonly AuthoredFloraSpecies[];
  builtinFloraSpeciesIds: readonly string[];
};

/**
 * Residency follows references in the active world. The old mount path cooked
 * every model in the palette even when the world referenced none of them,
 * turning catalogue size into a fixed multi-second navigation tax.
 */
export function worldResidentDemand(
  pieces: readonly PlacedPiece[],
  authoredPieces: readonly AuthoredBuildPiece[],
  worldFlora: readonly WorldFloraPatch[],
  floraSpecies: readonly AuthoredFloraSpecies[],
  armedPieceId: string | null,
  /** Opening-kit adapters (req_4526): the armed kit + every kit a placed
   * opening references, pre-filtered by the owner — mounted doors and the
   * armed mesh ghost resolve through these residents. */
  openingKitPieces: readonly AuthoredBuildPiece[] = [],
): WorldResidentDemand {
  const authoredIds = new Set<string>();
  const floraIds = new Set<string>();

  const requireAuthored = (pieceId: string | null | undefined): void => {
    if (!pieceId || !isAuthoredPiece(pieceId)) return;
    const authored = authoredPieceFrom(authoredPieces, pieceId);
    if (authored) authoredIds.add(authored.id);
  };

  requireAuthored(armedPieceId);
  for (const piece of pieces) {
    requireAuthored(piece.pieceId);
    for (const patch of piece.surfaceFlora ?? []) floraIds.add(patch.speciesId);
  }
  for (const patch of worldFlora) floraIds.add(patch.speciesId);

  return {
    authoredPieces: [...authoredPieces.filter((piece) => authoredIds.has(piece.id)), ...openingKitPieces],
    floraSpecies: floraSpecies.filter((species) => floraIds.has(species.id)),
    builtinFloraSpeciesIds: [...floraIds].filter((id) => id.startsWith('builtin-flora:')).sort(),
  };
}
