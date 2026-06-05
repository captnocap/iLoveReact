// editors/paint/backends/sam.ts — MobileSAM (embedded onnxruntime) backend.
// One combined photo-quality mask per refine pass — per-keep layers are a
// flood-only concept (SAM fuses all positive clicks in the decoder), so
// `layers` comes back empty and the single mask renders as one quad.
//
// Lives outside any component tree, so it uses the plain openImage /
// refineSegment / closeImage helpers exported alongside the useSegment hook
// — same contract, no React lifecycle.
//
// Behavior reference: cart/cutout/backends/sam.ts (read, never imported).

import {
  openImage,
  refineSegment,
  closeImage,
  isSegmentAvailable,
  type SegmentClick,
} from '@reactjit/runtime/hooks/useSegment';
import { mkdir } from '@reactjit/runtime/hooks/fs';
import { PAINT_TUNING } from '../tuning';
import { PAINT_SCRATCH_DIR, type SelectionBackend, type ClickPoint, type RefineResult, type BackendOpts } from './types';

export { isSegmentAvailable };

export function createSamBackend(): SelectionBackend {
  let handle = -1;
  let dims: { w: number; h: number } | null = null;
  const OVERLAY_RES = PAINT_TUNING.overlayRes;

  return {
    name: 'sam',
    async open(path: string, srcDims: { w: number; h: number }): Promise<boolean> {
      mkdir(PAINT_SCRATCH_DIR);
      if (!isSegmentAvailable()) {
        console.warn('[paint:sam] onnx host binding not registered; built without -Dhas-onnx=true');
        return false;
      }
      // Release any prior binding before opening a new one.
      if (handle >= 0) {
        closeImage(handle);
        handle = -1;
      }
      dims = srcDims;
      const h = openImage(path);
      if (h < 0) {
        console.warn('[paint:sam] segment_open failed for', path);
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
      // Clamp coords in-bounds (paralleling flood — keeps the prompt
      // geometry sane).
      const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.floor(v)));
      const clicks: SegmentClick[] = points.map((p) => ({
        x: clamp(p.x, dims!.w),
        y: clamp(p.y, dims!.h),
        label: p.label,
      }));
      const B = PAINT_TUNING.backends;
      const samThreshold = typeof opts?.samThreshold === 'number' ? opts.samThreshold : B.samThreshold;
      const samMaskIdx = typeof opts?.samMaskIdx === 'number'
        ? (Math.max(0, Math.min(2, Math.round(opts.samMaskIdx))) as 0 | 1 | 2)
        : B.samMaskIdx;
      const result = await refineSegment(handle, clicks, {
        threshold: samThreshold,
        maskIdx: samMaskIdx,
      });
      if (!result) return null;
      return { mask: result.mask, layers: [], overlayRes: OVERLAY_RES };
    },
    close(): void {
      if (handle >= 0) {
        closeImage(handle);
        handle = -1;
      }
      dims = null;
    },
  };
}
