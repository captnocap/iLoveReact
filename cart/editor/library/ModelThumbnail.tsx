// editor/library/ModelThumbnail.tsx — a live preview image of a model: a static
// <Scene3D> product shot framed on the model's own bounds (modelThumb.ts). Drop
// it INSIDE the existing thumb box; when the model has no resident geometry it
// renders nothing and the parent's colour swatch shows through unchanged.
//
// Static camera on purpose — a grid of native-orbit cameras would all fight for
// the one host orbit controller. These are product shots, not viewers.
import { useMemo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import type { ModelPackage } from '../data/types';
import { buildThumbView, resolveModelMesh } from './modelThumb';

const THUMB_BG = '#0e1622';

export default function ModelThumbnail({ model }: { model: ModelPackage }) {
  const view = useMemo(() => {
    const mesh = resolveModelMesh(model);
    return mesh ? buildThumbView(mesh) : null;
  }, [model.id, model.viewerMeshRef, model.sourceKind]);

  if (!view) return null;
  return (
    <Scene3D style={{ width: '100%', height: '100%', borderRadius: 4 }} backgroundColor={THUMB_BG} showGrid={false} showAxes={false}>
      <Scene3D.Camera position={view.cam.pos} target={view.cam.target} fov={view.cam.fov} />
      <Scene3D.AmbientLight color="#ffffff" intensity={0.5} />
      <Scene3D.DirectionalLight direction={[0.4, 1, -0.35]} color="#ffffff" intensity={0.85} />
      <Scene3D.Mesh geometry={view.geometry} params={{}} material={model.color} position={[0, 0, 0]} />
    </Scene3D>
  );
}
