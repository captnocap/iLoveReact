// editors/model/decalLayer.ts — the bridge that makes a DECAL a paint LAYER in the
// studio painter (the composer fold, req_1730/req_1831).
//
// A decal is a DecalDoc (real-font text / rect with shader+image fills / image /
// neon) anchored to a face's UV. The painter samples ONE composite paint texture
// (a stack of <Paintable> layers, req_1729); a decal layer's pixels don't come from
// brush dabs — they come from the doc, rendered by <DecalSurface> into a hidden
// full-atlas <StaticSurface>, read back, and uploaded into the layer's paintable.
// From there the existing layer machinery (composite / visible / opacity / reorder /
// delete / bake-to-paintRef) carries it for free, at ZERO runtime cost (the decal
// is already flattened into the texture the mesh samples). The readback door
// (readSurfacePixels) blocks on the GPU, so we bake on edit/place, not per frame.

import { readSurfacePixels } from '@reactjit/capture';
import { paintableOps } from '@reactjit/runtime/hooks/usePaintable';
import { PAINT_TEX, layerKey, recompositeDisplay } from './meshPaintTexture';
import { emptyDecalDoc, type DecalDoc } from '../../game/textures/decal';
import type { ModelDecal } from './modelStream';

/** The hidden StaticSurface key a decal's DecalSurface renders into (read back
 *  into the decal's paint layer). One per decal id. */
export function decalSurfaceKey(id: string): string { return `studio:decal:${id}`; }

/** A starter decal doc for a surface placement — TRANSPARENT canvas (only the
 *  authored nodes show on the mesh), billboard-ish aspect. */
export function newSurfaceDecalDoc(): DecalDoc {
  return { ...emptyDecalDoc(512, 256), bg: '' };
}

/** The atlas-pixel rect a decal's doc occupies, centred on its UV anchor. The
 *  hidden StaticSurface is the full atlas; the doc sits at this rect inside it, so
 *  the baked layer lands exactly where the user aimed on the surface. */
export function decalPlacement(decal: ModelDecal): { left: number; top: number; width: number; height: number } {
  const width = Math.max(1, decal.doc.width * decal.scale);
  const height = Math.max(1, decal.doc.height * decal.scale);
  return { left: decal.u * PAINT_TEX - width / 2, top: decal.v * PAINT_TEX - height / 2, width, height };
}

/** Try to bake one decal's StaticSurface into its paint layer + recomposite the
 *  display. Returns false until the surface has actually rendered (poll then) —
 *  blocks on the GPU copy, so call on edit/place/drag-end, never per frame. */
export function bakeDecalLayer(decal: ModelDecal): boolean {
  const px = readSurfacePixels(decalSurfaceKey(decal.id));
  if (!px || px.width !== PAINT_TEX || px.height !== PAINT_TEX) return false;
  paintableOps(layerKey(decal.id)).upload(px.rgba);
  recompositeDisplay();
  return true;
}
