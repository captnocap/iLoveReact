// Selection backend interface — the seam between the cart's UI and whatever
// algorithm produces the actual mask. Implementations:
//   flood.ts  → magick floodfill (works today, demo-quality)
//   sam.ts    → MobileSAM via onnxruntime (coming, photo-quality)
//
// The cart never knows which backend is active — it just calls
// backend.refine(points) and gets back a mask. Swap-able without UI churn.

export type ClickLabel = 'keep' | 'reject';

export interface ClickPoint {
  x: number;       // source-pixel x
  y: number;       // source-pixel y
  label: ClickLabel;
}

/** Tunables the cart drives per-refine. Backends ignore keys that don't
 *  apply (the cart passes everything every call; flood reads fuzz/reject,
 *  SAM reads samThreshold/samMaskIdx). Surfacing them ALL on a single
 *  interface keeps the backend swap cheap — state.ts has one bag and the
 *  active backend cherry-picks. */
export interface BackendOpts {
  // Flood-only
  fuzzPercent?: number;
  rejectDiskFrac?: number;
  // SAM-only
  samThreshold?: number;
  samMaskIdx?: 0 | 1 | 2;
}

export interface RefineResult {
  /** Combined source-resolution mask for save/export. 1 = in selection,
   *  0 = keep. Same shape (srcW * srcH bytes) as the original source. */
  mask: Uint8Array;
  /** Per-keep-click downsampled layer masks at overlay resolution. Each
   *  Set holds cell indices (cy * overlayRes + cx) where the layer is
   *  set. Used by the GPU MaskQuad renderer to draw each click as its own
   *  animated quad. Length = number of KEEP clicks in `points`; reject
   *  clicks don't produce a layer (they only subtract from keeps). */
  layers: Set<number>[];
  /** Grid resolution the layers were sampled to (square). Lets the cart
   *  render each layer in its own MaskQuad with the right cell math. */
  overlayRes: number;
}

export interface SelectionBackend {
  /** Diagnostic name — surfaced in status bar. */
  readonly name: string;

  /** Bind to an image. Returns true if backend can operate on it.
   *  Encoder-style backends (SAM) do their per-image precompute here. */
  open(imagePath: string, srcDims: { w: number; h: number }): Promise<boolean>;

  /** Recompute the mask from the COMPLETE click history. Each call is
   *  authoritative — the backend never accumulates state from previous
   *  calls. This makes "remove this overshoot" trivially work: the next
   *  call replays history without the bad keep-stroke. */
  refine(points: ClickPoint[], opts?: BackendOpts): Promise<RefineResult | null>;

  /** Release any per-image resources (encoder tensors, scratch files). */
  close(): void;
}
