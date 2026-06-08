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
import { Box, Effect, StaticSurface } from '@reactjit/primitives';
import { packPaintedLayerData, packPaintedLookData, validatePaintedOverlay, vehiclePaintTextureKey, PAINTED_LAYER_WGSL, type PaintedOverlay } from './painted';
import type { VehicleDoc } from './vehicle';

export function PaintedOverlayPaint(props: { overlay: PaintedOverlay; w: number; h: number }) {
  const { overlay, w, h } = props;
  // The packs are memoized on the overlay's identity — overlays are immutable
  // document data, and a re-save mints a NEW object (and stamp), so this is
  // exactly content-addressed (the StaticSurface inline-prop rebake hazard).
  // PAINTLIVE-0606 (ruled): a layer carrying a baked `look` mounts ITS OWN
  // effect shader — the model wears the same live effect texture the painter
  // showed. The flat fill is the legacy reader for pre-look overlays only.
  const packs = useMemo(
    () => overlay.layers.map((_, i) => packPaintedLookData(overlay, i) ?? packPaintedLayerData(overlay, i)),
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
          <Effect key={`pl${i}`} shader={overlay.layers[i].look?.shader ?? PAINTED_LAYER_WGSL} data={data} style={style} />
        )
      ))}
    </>
  );
}

const OFFSCREEN_LEFT = -99999; // the capture-parking convention (figure/render)

/** Every painted part of a vehicle doc as offscreen captures (256² — the
 *  vehicle CAPTURE's square box-mapped convention), keyed exactly as
 *  buildVehicle threads them. `exceptPart` lets a live editor substitute its
 *  own capture for the part being painted. */
export function VehiclePaintCaptures(props: { doc: VehicleDoc; exceptPart?: string }) {
  const paint = props.doc.paint ?? {};
  return (
    <>
      {Object.keys(paint).filter((part) => part !== props.exceptPart).map((part) => {
        const overlay = validatePaintedOverlay((paint as Record<string, unknown>)[part]);
        if (!overlay) return null;
        return (
          <PaintedOverlaySurface
            key={`vpaint-${part}`}
            staticKey={vehiclePaintTextureKey(part, overlay.stamp)}
            bg={props.doc.color}
            w={256}
            h={256}
            overlay={overlay}
          />
        );
      })}
    </>
  );
}

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
