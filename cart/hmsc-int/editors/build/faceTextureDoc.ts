// editors/build/faceTextureDoc.ts — the PURE shape an image upload becomes
// (req_0749). Split from uploadFaceTexture.ts (which pulls the native picker +
// the material store) so the doc construction is testable with zero host doors:
// it imports only the pure decal model.

import { emptyDecalDoc, type DecalDoc } from '@game/textures/decal';

/** the longest side a stored upload is scaled down to — a face capture is a few
 *  hundred px, so 1024 keeps detail without storing a multi-MB decal doc */
export const MAX_UPLOAD_SIDE = 1024;

/** A full-bleed image decal sized to the image's aspect (clamped to
 *  MAX_UPLOAD_SIDE), transparent bg so PNG alpha shows through. */
export function imageDecalDoc(src: string, dims: { w: number; h: number }): DecalDoc {
  const longest = Math.max(dims.w, dims.h, 1);
  const scale = Math.min(1, MAX_UPLOAD_SIDE / longest);
  const w = Math.max(1, Math.round(dims.w * scale));
  const h = Math.max(1, Math.round(dims.h * scale));
  return {
    ...emptyDecalDoc(w, h),
    bg: '', // transparent — the image covers the canvas; PNG alpha shows through
    nodes: [{ id: 'img', kind: 'image', x: 0, y: 0, w, h, src }],
  };
}

/** Filename (no extension) → a friendly material label. */
export function labelFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[^.]+$/, '') || 'image';
}
