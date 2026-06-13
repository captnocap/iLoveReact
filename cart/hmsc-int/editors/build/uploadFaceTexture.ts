// editors/build/uploadFaceTexture.ts — "upload an image, put it on the piece"
// (req_0749). The iso PAINT panel's image door: pick a file with the native
// picker, read its pixel size, wrap it as a full-bleed DecalDoc, and store it
// as a CustomTexture (decal) through the SAME save path /compose uses. The
// returned material id is a regular skin material — the panel applies it to the
// selection like any swatch (allTextures() picks it up; useCustomTextures()
// makes it appear in the browser live).
//
// No new pipeline: pickImageFile/identifyImage are the cutout route's loaders
// and saveDecalTexture is the decal library's door — this just composes them.

import { pickImageFile, identifyImage } from '../cutout/sources';
import { cleanImagePath } from '../workbench/paint/store';
import { saveDecalTexture } from '@game/textures/materials';
import { imageDecalDoc, labelFromPath } from './faceTextureDoc';

export type UploadResult = { id: string; label: string };

/** Pick → read dims → store as a decal material. Resolves null on cancel or an
 *  unreadable image (the caller shows nothing — the picker already failed loud
 *  enough for the user, who chose the file). */
export async function uploadFaceTexture(): Promise<UploadResult | null> {
  const picked = await pickImageFile('Pick an image for this face');
  if (!picked) return null;
  const path = cleanImagePath(picked);
  if (!path) return null;
  const dims = await identifyImage(path);
  if (!dims) return null;
  const record = saveDecalTexture(labelFromPath(path), imageDecalDoc(path, dims));
  if (!record) return null;
  return { id: record.id, label: record.label };
}
