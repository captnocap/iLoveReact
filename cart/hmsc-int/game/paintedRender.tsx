// game/paintedRender.tsx — rendering PaintedOverlays (MODELPAINT-0605).
//
// The React half of game/painted.ts, split out exactly like figure/render.tsx:
// the door (game/index.ts) stays React-free for headless consumers; editors
// import this file directly.
//
//   <PaintedOverlayPaint overlay w h />
//       the baked color layers as one Effect quad per layer (the cell-fill
//       shader in painted.ts), composited bottom-up. Drop it anywhere in an
//       unwrap composition — captures, canvases, swatches.
//   <PaintedOverlaySurface staticKey bg w h overlay>
//       a whole part texture as an offscreen StaticSurface bake: base color →
//       overlay (→ optional children on top). Mesh textureKey samples the
//       staticKey. The CharacterCaptures idiom, model-agnostic — vehicles and
//       figures mount the same component.

import { useMemo } from 'react';
import { Box, Effect, StaticSurface } from '@reactjit/runtime/primitives';
import { packPaintedLayerData, PAINTED_LAYER_WGSL, type PaintedOverlay } from './painted';

export function PaintedOverlayPaint(props: { overlay: PaintedOverlay; w: number; h: number }) {
  const { overlay, w, h } = props;
  // The packs are memoized on the overlay's identity — overlays are immutable
  // document data, and a re-save mints a NEW object (and stamp), so this is
  // exactly content-addressed (the StaticSurface inline-prop rebake hazard).
  const packs = useMemo(
    () => overlay.layers.map((_, i) => packPaintedLayerData(overlay, i)),
    [overlay],
  );
  const style = useMemo(
    () => ({ position: 'absolute' as const, left: 0, top: 0, width: w, height: h }),
    [w, h],
  );
  return (
    <>
      {packs.map((data, i) => (
        overlay.layers[i].cells.length === 0 ? null : (
          <Effect key={`pl${i}`} shader={PAINTED_LAYER_WGSL} data={data} style={style} />
        )
      ))}
    </>
  );
}

const OFFSCREEN_LEFT = -99999; // the capture-parking convention (figure/render)

export function PaintedOverlaySurface(props: {
  staticKey: string;
  /** the base color under the paint (the part's material/skin) */
  bg: string;
  w: number;
  h: number;
  overlay: PaintedOverlay | null;
  /** extra content composited OVER the overlay (stamps, shape layers) */
  children?: any;
}) {
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: OFFSCREEN_LEFT, top: 0, width: props.w, height: props.h }),
    [props.w, props.h],
  );
  return (
    <StaticSurface staticKey={props.staticKey} style={surfaceStyle}>
      <Box style={{ width: props.w, height: props.h, backgroundColor: props.bg, position: 'relative', overflow: 'hidden' }}>
        {props.overlay ? <PaintedOverlayPaint overlay={props.overlay} w={props.w} h={props.h} /> : null}
        {props.children}
      </Box>
    </StaticSurface>
  );
}
