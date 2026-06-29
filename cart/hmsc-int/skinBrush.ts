// skinBrush — copy a placed piece's LOOK and stamp it onto others (req_2077:
// "copy the skin properties so i can point at a wall, copy it, then paint it onto
// others, not do the single copy-paste"). ONE shared vocabulary so the FacePainter
// (the COPY / eyedropper side) and the loader pane (the STAMP-on-click side) agree
// on what a piece's "look" is and how to dress another piece in it. Sibling of the
// brush kit in spirit, but for whole-piece looks rather than a single material.

import { GAME_BUILD } from './game';
import type { PlacedBuildPiece, WorldEvent } from './game';
import type { WorldProp } from './design';
import { propParts } from './render3d/propParts';
import { isTextureable, type Part } from './render3d/parts';
import type { PieceLook } from './buildArmed';

export type { PieceLook };

// PROPSKIN-0766: a placed PROP piece (pieceId 'prop.<kind>') skins by NAMED PART.
// Its texturable parts come from the SAME propParts the renderer + bake use, so a
// copied prop look only paints parts the target actually has. (Moved here from
// FacePainter so the copy and stamp sides share one source — rule of two.)
export function propPieceParts(piece: PlacedBuildPiece): Part[] | null {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  if (def.kind !== 'prop' || !def.propKind) return null;
  const prop: WorldProp = {
    id: piece.id,
    kind: def.propKind as WorldProp['kind'],
    x: piece.x, y: piece.y, z: piece.z,
    yawDegrees: piece.yawDegrees,
    partTextures: piece.partTextures,
    createdByCommand: 'hmsc-int:paint-parts',
  };
  return propParts(prop).filter(isTextureable);
}

/** Pull the visual LOOK off a placed piece — its face skins and/or part textures,
 *  copied (not aliased) so the brush is a snapshot the source can keep changing. */
export function pieceLook(piece: PlacedBuildPiece): PieceLook {
  const skin = piece.skin && Object.keys(piece.skin).length ? { ...piece.skin } : undefined;
  const partTextures = piece.partTextures && Object.keys(piece.partTextures).length ? { ...piece.partTextures } : undefined;
  return { skin, partTextures };
}

/** True when the look carries anything paintable (a bare piece copies to nothing). */
export function lookHasContent(look: PieceLook | null | undefined): look is PieceLook {
  if (!look) return false;
  return (!!look.skin && Object.keys(look.skin).length > 0)
    || (!!look.partTextures && Object.keys(look.partTextures).length > 0);
}

/** A short human label for the brush chip — the dominant face's color/material, or
 *  a generic tag for a multi-part prop look. */
export function lookLabel(look: PieceLook): string {
  if (look.skin) {
    const face = look.skin.front ?? look.skin.sides ?? look.skin.back ?? Object.values(look.skin)[0];
    if (face) return face.kind === 'color' ? face.value : face.id;
  }
  if (look.partTextures) {
    const n = Object.keys(look.partTextures).length;
    return n === 1 ? Object.values(look.partTextures)[0] : `prop look · ${n} parts`;
  }
  return 'look';
}

/** Events that dress `target` in `look`. A PROP target takes the part textures
 *  (filtered to its OWN texturable parts, so a mismatched copy quietly skips parts
 *  the target lacks); any other piece takes the face skin set whole. Empty array
 *  when nothing in the look applies to this target. */
export function skinStampEvents(target: PlacedBuildPiece, look: PieceLook): { event: WorldEvent; label: string }[] {
  const def = GAME_BUILD.catalog.get(target.pieceId);
  if (def.kind === 'prop') {
    if (!look.partTextures) return [];
    const ownParts = new Set((propPieceParts(target) ?? []).map((p) => p.id));
    const items: { event: WorldEvent; label: string }[] = [];
    for (const [partId, textureId] of Object.entries(look.partTextures)) {
      if (!ownParts.has(partId)) continue;
      items.push({ event: { kind: 'piecePartTextureSet', id: target.id, partId, textureId } as WorldEvent, label: 'painted prop look' });
    }
    return items;
  }
  if (!look.skin || Object.keys(look.skin).length === 0) return [];
  return [{ event: { kind: 'pieceSkinSet', id: target.id, skin: look.skin } as WorldEvent, label: 'painted skin' }];
}
