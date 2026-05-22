/**
 * useSegment — React hook for ONNX-backed image segmentation (MobileSAM).
 *
 * Phase 2 surface:
 *   useSegment(imagePath) → {
 *     isReady: boolean;
 *     error: string | null;
 *     refine(clicks: ClickPoint[]): Promise<SegmentResult | null>;
 *     close(): void;
 *   }
 *
 * Importing this file is what gates the `has-onnx` build flag (see
 * sdk/dependency-registry.json `onnx.triggers.metafileInput`). Carts that
 * don't import it pay zero — onnxruntime.so isn't linked, the v8 bindings
 * stub out, the binary stays small.
 *
 * Backend authors who can't use a React hook (e.g. cart/cutout/backends/sam.ts
 * lives outside the component tree) should call the plain `openImage` /
 * `refineSegment` / `closeImage` helpers directly — same contract, no React
 * lifecycle.
 */

import { useEffect, useRef, useState } from 'react';
import { callHost, callHostJson, hasHost } from '../ffi';
import { readFile } from './fs';

// ── Smoke test (Phase 1, kept for Inspector) ───────────────────────────

export interface OnnxTestResult {
  ok: boolean;
  version?: string;
  error?: string;
}

/** Phase 1 smoke test — confirms onnxruntime is linked and callable. */
export function onnxTest(): OnnxTestResult {
  return callHostJson<OnnxTestResult>(
    '__onnx_test',
    { ok: false, error: 'onnx binding not registered (build with -Dhas-onnx=true)' },
  );
}

// ── Plain (non-React) helpers ──────────────────────────────────────────

export type SegmentClickLabel = 'keep' | 'reject';

export interface SegmentClick {
  x: number;
  y: number;
  label: SegmentClickLabel;
}

export interface SegmentResult {
  mask: Uint8Array;
  w: number;
  h: number;
}

/** Tunables the cart exposes to the user.
 *  - `threshold`: sigmoid-logit cutoff in the postprocess step (default 0 =
 *    SAM's natural cutoff). Positive shrinks the mask, negative grows it.
 *  - `maskIdx`: which of the 3 SAM candidate masks to return.
 *    0 = whole object (default), 1 = part, 2 = subpart. */
export interface SegmentOpts {
  threshold?: number;
  maskIdx?: 0 | 1 | 2;
}

/** True iff the onnx host bindings are linked into this binary. */
export function isSegmentAvailable(): boolean {
  return hasHost('__segment_open');
}

/** Open an image and return its native handle, or -1 on failure.
 *  SYNCHRONOUS but slow (~500-1000ms for the encoder pass). Callers that
 *  care about jank should defer via setTimeout(0) before invoking. */
export function openImage(path: string): number {
  if (!isSegmentAvailable()) return -1;
  return callHost<number>('__segment_open', -1, path);
}

/** Run a refine pass for a handle. Returns the parsed mask + dims, or null
 *  on any failure (bad handle, host err, missing file). Async-shaped so the
 *  call site can `await` even though the host fn is synchronous — leaves
 *  room to push the work to a worker thread later without touching callers. */
export async function refineSegment(
  handle: number,
  clicks: SegmentClick[],
  opts?: SegmentOpts,
): Promise<SegmentResult | null> {
  if (handle < 0 || !isSegmentAvailable()) return null;
  const clicksJson = JSON.stringify(
    clicks.map((c) => ({ x: c.x, y: c.y, l: c.label === 'keep' ? 1 : 0 })),
  );
  const optsJson = opts ? JSON.stringify({
    threshold: typeof opts.threshold === 'number' ? opts.threshold : 0,
    maskIdx: typeof opts.maskIdx === 'number' ? opts.maskIdx : 0,
  }) : '';
  // Yield once so refine() doesn't block the calling microtask frame.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const reply = callHost<string>('__segment_refine', 'err:not registered', handle, clicksJson, optsJson);
  if (!reply || !reply.startsWith('mask:')) {
    if (reply) console.warn('[useSegment] refine:', reply);
    return null;
  }
  const path = reply.slice(5);
  return readMaskPGM(path);
}

/** Release the native handle. No-op if handle < 0. */
export function closeImage(handle: number): void {
  if (handle < 0 || !isSegmentAvailable()) return;
  callHost<void>('__segment_close', undefined as any, handle);
}

/** Read a P5 binary PGM (maxval=1, bytes 0/1) and return it as a mask + dims.
 *  Mirrors flood.ts:parseP2PGM but for the binary variant: header is
 *  "P5\n<W> <H>\n<maxval>\n" followed by raw bytes. We split on the third
 *  newline rather than parsing ASCII tokens because the body bytes (0 and 1)
 *  collide with whitespace-tokenizer assumptions. */
export function readMaskPGM(path: string): SegmentResult | null {
  const text = readFile(path);
  if (!text) return null;
  if (text.charCodeAt(0) !== 0x50 /* P */ || text.charCodeAt(1) !== 0x35 /* 5 */) {
    return null;
  }
  // Find the three header newlines.
  const nl1 = text.indexOf('\n');
  if (nl1 < 0) return null;
  const nl2 = text.indexOf('\n', nl1 + 1);
  if (nl2 < 0) return null;
  const nl3 = text.indexOf('\n', nl2 + 1);
  if (nl3 < 0) return null;
  const dimsLine = text.slice(nl1 + 1, nl2).trim();
  const parts = dimsLine.split(/\s+/);
  const w = parseInt(parts[0], 10);
  const h = parseInt(parts[1], 10);
  if (!w || !h) return null;
  const body = text.slice(nl3 + 1);
  const n = w * h;
  const mask = new Uint8Array(n);
  const lim = Math.min(n, body.length);
  for (let i = 0; i < lim; i++) {
    // P5 maxval=1 → bytes are 0 or 1 directly; treat anything truthy as set.
    mask[i] = body.charCodeAt(i) ? 1 : 0;
  }
  return { mask, w, h };
}

// ── React hook ─────────────────────────────────────────────────────────

export interface SegmentHandle {
  isReady: boolean;
  error: string | null;
  refine(clicks: SegmentClick[], opts?: SegmentOpts): Promise<SegmentResult | null>;
  close(): void;
}

/** React hook: bind to an image for the lifetime of the component. Opens
 *  the native handle on mount (and whenever imagePath changes), closes on
 *  unmount. Use the plain `openImage` / `refineSegment` / `closeImage`
 *  exports if you need to drive segmentation from a non-React backend. */
export function useSegment(imagePath: string | null): SegmentHandle {
  const handleRef = useRef<number>(-1);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset state for this binding cycle.
    setIsReady(false);
    setError(null);
    if (!imagePath) return;
    if (!isSegmentAvailable()) {
      setError('onnx binding not registered (build with -Dhas-onnx=true)');
      return;
    }
    let cancelled = false;
    // Defer the open so the calling render finishes before the ~500ms encoder
    // pass burns the main thread. The handle still lands on handleRef so the
    // unmount cleanup can release it even mid-flight.
    const t = setTimeout(() => {
      const h = openImage(imagePath);
      if (cancelled) {
        if (h >= 0) closeImage(h);
        return;
      }
      if (h < 0) {
        setError(`segment_open failed for ${imagePath}`);
        return;
      }
      handleRef.current = h;
      setIsReady(true);
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(t);
      if (handleRef.current >= 0) {
        closeImage(handleRef.current);
        handleRef.current = -1;
      }
    };
  }, [imagePath]);

  return {
    isReady,
    error,
    refine: (clicks, opts) => refineSegment(handleRef.current, clicks, opts),
    close: () => {
      if (handleRef.current >= 0) {
        closeImage(handleRef.current);
        handleRef.current = -1;
        setIsReady(false);
      }
    },
  };
}
