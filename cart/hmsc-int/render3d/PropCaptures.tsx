import { memo, useEffect } from 'react';
import { StaticSurface } from '@reactjit/primitives';
import { Paintable } from '@reactjit/runtime/primitives';
import { paintableOps } from '@reactjit/runtime/hooks/usePaintable';
import { image } from '@reactjit/image';
import { base64ToBytes } from '@reactjit/workspace';
import type { WorldProp } from '../design';
import {
  STREET_SIGN_TEXTURE_HEIGHT,
  STREET_SIGN_TEXTURE_KEY,
  STREET_SIGN_TEXTURE_WIDTH,
  StreetSignFace,
} from './props/signFace';
import { cookedAssetById, cookedTextureBlob } from '../editors/model/cookedAssets';
import { isCookedPropKind } from '../game/kinds/props';

// Offscreen capture sources for the billboard props → the texture keys their
// panels sample. Mounted in the 2D tree as a sibling of <Scene3D>, parked
// off-screen, exactly like TileSurfaceCaptures/RoadSurfaceCaptures.
//
// Only the street sign needs a 2D-rendered plate. A Studio-cooked prop instead
// carries a PAINTED ATLAS (the model's paint PNG, content-addressed by texRef) —
// not 2D React content, so it's an uploaded GPU texture (a <Paintable> filled from
// the decoded PNG) rather than a StaticSurface capture. CookedProp.tsx samples it
// by `textureKey={asset.texRef}`, with the mesh's per-face UVs already mapping into
// the atlas (req_1496).

const StreetSignCapture = memo(function StreetSignCapture() {
  return (
    <StaticSurface staticKey={STREET_SIGN_TEXTURE_KEY} style={{ position: 'absolute', left: -99999, top: 0, width: STREET_SIGN_TEXTURE_WIDTH, height: STREET_SIGN_TEXTURE_HEIGHT }}>
      <StreetSignFace />
    </StaticSurface>
  );
});

// The cooked paint atlas is the fixed Studio paint resolution (PAINT_TEX). Kept a
// local constant so PropCaptures doesn't pull the whole meshPaintTexture module.
const COOKED_TEX = 1024;

/** One cooked prop's painted atlas, uploaded into a GPU texture the prop samples by
 *  textureKey. The <Paintable> creates the texture; the effect decodes the stored PNG
 *  and uploads its RGBA once (upload parks until CREATE drains, so order is safe). */
const CookedTexture = memo(function CookedTexture(props: { texRef: string }) {
  useEffect(() => {
    const blob = cookedTextureBlob(props.texRef);
    if (!blob) return;
    const raw = image(base64ToBytes(blob)).raw();
    if (raw && raw.rgba && raw.rgba.length === raw.width * raw.height * 4) {
      paintableOps(props.texRef).upload(raw.rgba);
    }
  }, [props.texRef]);
  return <Paintable id={props.texRef} w={COOKED_TEX} h={COOKED_TEX} rgba style={{ position: 'absolute', left: -99999, top: 0, width: 1, height: 1 }} />;
});

/** Distinct cooked-prop texture refs present in the scene (deduped) — so a kind
 *  placed 50 times uploads its atlas ONCE. */
function cookedTexRefs(props: WorldProp[]): string[] {
  const seen = new Set<string>();
  for (const prop of props) {
    if (!isCookedPropKind(prop.kind)) continue;
    const asset = cookedAssetById(prop.kind);
    if (asset?.texRef && cookedTextureBlob(asset.texRef)) seen.add(asset.texRef);
  }
  return [...seen];
}

export const PropSurfaceCaptures = memo(function PropSurfaceCaptures(props: { props: WorldProp[] }) {
  const hasStreetSign = props.props.some((prop) => prop.kind === 'streetSign');
  const cookedTextures = cookedTexRefs(props.props);
  return (
    <>
      {hasStreetSign ? <StreetSignCapture /> : null}
      {cookedTextures.map((ref) => <CookedTexture key={ref} texRef={ref} />)}
    </>
  );
});
