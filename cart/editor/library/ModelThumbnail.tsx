// editor/library/ModelThumbnail.tsx — a model's STAGED product shot: the PNG the
// author framed in the studio and captured into the package (req_4044). Drop it
// INSIDE the existing thumb box; a model with no staged shot renders nothing and
// the parent's colour swatch shows through unchanged.
//
// This used to be a live <Scene3D> that re-rasterized the model's whole mesh every
// frame — one scene per card, one per browser row. On a 3,786-triangle car that
// doubled the frame's triangle count (the editor drew the model once for the
// viewport and once for a 40px picture), and the auto-framed camera guessed the
// model's front, so it routinely shot the thing backwards. An authored screenshot
// costs nothing per frame and is always the angle the author chose.
import { Image } from '../../../runtime/primitives';
import type { ModelPackage } from '../data/types';

export default function ModelThumbnail({ model }: { model: ModelPackage }) {
  if (!model.thumbnail) return null;
  return <Image source={model.thumbnail} style={{ width: '100%', height: '100%', borderRadius: 4 }} />;
}
