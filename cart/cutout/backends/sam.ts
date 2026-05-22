// SamBackend — MobileSAM (via embedded onnxruntime) backend. Produces a
// single combined mask per refine pass, which is photo-quality on object
// boundaries where flood-fill is blocky.
//
// Architecture note: this backend lives outside any component tree, so it
// can't use the React `useSegment` hook directly. Instead it calls the
// plain `openImage` / `refineSegment` / `closeImage` helpers exported
// alongside the hook — same contract, no React lifecycle. The React hook
// is retained for component-driven use cases (Inspector, ad-hoc widgets).
//
// SAM produces ONE combined mask per refine, not per-keep layers like the
// flood backend. So we return `layers: []` and let the cart's SAM-mode
// renderer draw the single combined mask as one MaskQuad. The per-layer
// animation path is flood-specific and not meaningful for SAM (which fuses
// all positive clicks in the decoder before emitting the mask).

import {
  openImage,
  refineSegment,
  closeImage,
  isSegmentAvailable,
  type SegmentClick,
} from '@reactjit/runtime/hooks/useSegment';
import { mkdir } from '@reactjit/runtime/hooks/fs';
import { SCRATCH_DIR } from '../magick';
import type { SelectionBackend, ClickPoint, RefineResult, BackendOpts } from './types';

// Must match cart/cutout/state.ts:OVERLAY_RES so the renderer can size cells
// even though SAM doesn't populate per-layer grids itself.
const OVERLAY_RES = 128;

export function createSamBackend(imagePath?: string): SelectionBackend {
  let handle = -1;
  let dims: { w: number; h: number } | null = null;
  let pathBound: string | null = imagePath ?? null;

  return {
    name: 'sam',
    async open(path: string, srcDims: { w: number; h: number }): Promise<boolean> {
      mkdir(SCRATCH_DIR);
      if (!isSegmentAvailable()) {
        console.warn('[sam] onnx host binding not registered; cart was built without -Dhas-onnx=true');
        return false;
      }
      // Release any prior binding before opening a new one.
      if (handle >= 0) {
        closeImage(handle);
        handle = -1;
      }
      pathBound = path;
      dims = srcDims;
      const h = openImage(path);
      if (h < 0) {
        console.warn('[sam] segment_open failed for', path);
        return false;
      }
      handle = h;
      return true;
    },
    async refine(points: ClickPoint[], opts?: BackendOpts): Promise<RefineResult | null> {
      if (handle < 0 || !dims) return null;
      if (points.length === 0) {
        return { mask: new Uint8Array(dims.w * dims.h), layers: [], overlayRes: OVERLAY_RES };
      }
      // Clamp coords to in-bounds (paralleling flood.ts — out-of-bounds
      // points in SAM would still pass through the decoder, but mapping
      // them to valid pixels keeps the prompt geometry sane).
      const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.floor(v)));
      const clicks: SegmentClick[] = points.map((p) => ({
        x: clamp(p.x, dims!.w),
        y: clamp(p.y, dims!.h),
        label: p.label,
      }));
      const samThreshold = typeof opts?.samThreshold === 'number' ? opts.samThreshold : 0;
      const samMaskIdx = typeof opts?.samMaskIdx === 'number'
        ? (Math.max(0, Math.min(2, Math.round(opts.samMaskIdx))) as 0 | 1 | 2)
        : 0;
      const result = await refineSegment(handle, clicks, {
        threshold: samThreshold,
        maskIdx: samMaskIdx,
      });
      if (!result) return null;
      // SAM produces a single fused mask. The per-keep `layers` array is a
      // flood-only concept; SAM-mode rendering draws the combined mask as
      // one MaskQuad. Documented in this file's header.
      return { mask: result.mask, layers: [], overlayRes: OVERLAY_RES };
    },
    close(): void {
      if (handle >= 0) {
        closeImage(handle);
        handle = -1;
      }
      dims = null;
      pathBound = null;
    },
  };
}
