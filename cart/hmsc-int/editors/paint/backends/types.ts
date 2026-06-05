// editors/paint/backends/types.ts — the smart-selection seam. The painter
// never knows which algorithm produces a mask: it calls
// backend.refine(clicks) with the COMPLETE click history and uploads the
// result to the active layer's base texture. Implementations:
//   flood.ts → ImageMagick floodfill (always available — wand-tool tier)
//   sam.ts   → MobileSAM via embedded onnxruntime (photo-quality, gated on
//              the onnx host binding)
// A hosting editor passes a backend only when it has a source image; the
// painter's smart tool surfaces only then.
//
// Behavior reference: cart/cutout/backends/types.ts (read, never imported).

export type ClickLabel = 'keep' | 'reject';

export interface ClickPoint {
  x: number;       // source-pixel x
  y: number;       // source-pixel y
  label: ClickLabel;
}

/** Tunables the painter drives per-refine. Backends cherry-pick the keys
 *  that apply (flood: fuzz/reject; SAM: threshold/mask idx) — one bag keeps
 *  the backend swap cheap. */
export interface BackendOpts {
  // Flood-only
  fuzzPercent?: number;
  rejectDiskFrac?: number;
  // SAM-only
  samThreshold?: number;
  samMaskIdx?: 0 | 1 | 2;
}

export interface RefineResult {
  /** Combined source-resolution mask. 1 = in selection, 0 = keep. */
  mask: Uint8Array;
  /** Per-keep-click downsampled cell sets at overlayRes (flood emits these;
   *  SAM fuses everything and returns []). */
  layers: Set<number>[];
  /** Grid resolution the layers were sampled to (square). */
  overlayRes: number;
}

export interface SelectionBackend {
  /** Diagnostic name — surfaced in status text. */
  readonly name: string;

  /** Bind to an image. Encoder-style backends (SAM) precompute here. */
  open(imagePath: string, srcDims: { w: number; h: number }): Promise<boolean>;

  /** Recompute the mask from the COMPLETE click history. Each call is
   *  authoritative — backends never accumulate state across calls, so
   *  removing a bad click is just a replay without it. */
  refine(points: ClickPoint[], opts?: BackendOpts): Promise<RefineResult | null>;

  /** Release per-image resources (encoder tensors, scratch files). */
  close(): void;
}

/** Subprocess scratch space shared by the painter's backends. */
export const PAINT_SCRATCH_DIR = '/tmp/_reactjit_paint';
