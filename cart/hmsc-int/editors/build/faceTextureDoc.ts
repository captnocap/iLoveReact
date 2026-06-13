// editors/build/faceTextureDoc.ts — the PURE shape an image upload becomes
// (req_0749). Split from uploadFaceTexture.ts (which pulls the native picker +
// the material store) so the doc construction is testable with zero host doors:
// it imports only the pure decal model.

import { emptyDecalDoc, type DecalDoc } from '@game/textures/decal';

/** the longest side a stored upload is scaled down to — a face capture is a few
 *  hundred px, so 1024 keeps detail without storing a multi-MB decal doc */
export const MAX_UPLOAD_SIDE = 1024;

/** An image decal that COVERS a SQUARE canvas (fills, center-cropped), so it
 *  fully clothes a building face with no transparent margin.
 *
 *  Why square + cover, not a full-bleed aspect-matched canvas: a placed face's
 *  texture capture is SQUARE (cols=floors=1), and a decal <Image> preserves its
 *  aspect — so a landscape image in a square face underfills vertically and the
 *  transparent decal bg shows the wall THROUGH the gap (req_0753, the "small
 *  floating image" bug). Covering a square means the image node carries the
 *  image's own aspect (no shrink) and the canvas overflow:hidden crops the
 *  overhang — the wall reads fully clothed, like a wallpaper. */
export function imageDecalDoc(src: string, dims: { w: number; h: number }): DecalDoc {
  const iw0 = Math.max(1, dims.w);
  const ih0 = Math.max(1, dims.h);
  // The square texture side: the image's longer edge, clamped to the cap.
  const side = Math.max(1, Math.min(MAX_UPLOAD_SIDE, Math.max(iw0, ih0)));
  // Cover: scale so the SHORTER edge reaches the side; the longer edge overhangs.
  const scale = side / Math.min(iw0, ih0);
  const w = Math.max(1, Math.round(iw0 * scale));
  const h = Math.max(1, Math.round(ih0 * scale));
  const x = Math.round((side - w) / 2); // center the overhang (crops both edges)
  const y = Math.round((side - h) / 2);
  return {
    ...emptyDecalDoc(side, side),
    bg: '', // the image covers the square; bg only shows if a clamp left a sliver
    nodes: [{ id: 'img', kind: 'image', x, y, w, h, src }],
  };
}

/** Filename (no extension) → a friendly material label. */
export function labelFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[^.]+$/, '') || 'image';
}
