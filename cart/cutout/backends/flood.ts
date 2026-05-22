// FloodBackend — magick-driven floodfill backend. This is the "always-works"
// fallback before/instead of SAM. Quality is wand-tool tier: great on solid
// backgrounds, blocky on subtle gradients. Useful as a proof of concept for
// the SelectionBackend interface, and as a graceful fallback when ONNX isn't
// available.
//
// Algorithm: for each KEEP point, magick floods the source at that pixel
// with a color tolerance, producing a binary region. For each REJECT point,
// it does the same, then we subtract from the keep regions. Result is the
// final mask — recomputed each call from the full click history.

import { run } from '@reactjit/runtime/hooks/process';
import { readFile, writeFile, mkdir } from '@reactjit/runtime/hooks/fs';
import { SCRATCH_DIR } from '../magick';
import type { SelectionBackend, ClickPoint, RefineResult, BackendOpts } from './types';

// Default fuzz % — tuned for one-shot fills on noisy JPEG backgrounds.
// The bleed-into-eyes failure mode is no longer caused by tolerance (that
// was a post-processing bug in the magick chain, since fixed via the
// magenta-sentinel isolation). Now fuzz only governs how aggressively the
// flood walks through near-color neighbors. 15% covers JPEG noise on a
// solid-ish background without bridging through cleanly-bordered shapes.
const DEFAULT_FUZZ_PERCENT = 15;
// Layer-overlay grid resolution. Must match cart/cutout/state.ts:OVERLAY_RES.
// Each per-keep layer mask is sampled to this grid for cheap GPU rendering.
const OVERLAY_RES = 128;
// Reject-disk radius as a fraction of the smaller source dimension. A
// reject click subtracts a small circle from the keep mask (not a flood)
// so "spot cleaning" works without nuking the whole color region the
// click happens to land in.
const REJECT_DISK_FRAC = 0.04; // 4% of min(w,h) → ~40px on a 1000px image

export function createFloodBackend(): SelectionBackend {
  let srcPath: string | null = null;
  let dims: { w: number; h: number } | null = null;

  return {
    name: 'flood',
    async open(path, srcDims) {
      srcPath = path;
      dims = srcDims;
      mkdir(SCRATCH_DIR);
      return true;
    },
    async refine(points: ClickPoint[], opts?: BackendOpts): Promise<RefineResult | null> {
      if (!srcPath || !dims) return null;
      if (points.length === 0) {
        return { mask: new Uint8Array(dims.w * dims.h), layers: [], overlayRes: OVERLAY_RES };
      }

      // Resolve tunables per-call. The cart owns these in React state and
      // hands them in here — backends are stateless w.r.t. user prefs.
      const fuzz = Math.max(0, Math.min(100,
        typeof opts?.fuzzPercent === 'number' ? opts.fuzzPercent : DEFAULT_FUZZ_PERCENT));
      const rejectFrac = Math.max(0.001, Math.min(0.5,
        typeof opts?.rejectDiskFrac === 'number' ? opts.rejectDiskFrac : REJECT_DISK_FRAC));

      // Clamp coords to in-bounds. A single click landing at x=dims.w (one
      // past the edge) makes magick reject the WHOLE chain.
      const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.floor(v)));
      const inBounds = (p: ClickPoint) => {
        const x = clamp(p.x, dims!.w);
        const y = clamp(p.y, dims!.h);
        return { x, y, label: p.label };
      };
      const keeps   = points.filter((p) => p.label === 'keep').map(inBounds);
      const rejects = points.filter((p) => p.label === 'reject').map(inBounds);

      // Sentinel: hex magenta — extremely rare in source images. Must be
      // #RRGGBB form (srgb(R,G,B) has literal parens magick interprets as
      // CLI brackets).
      const SENTINEL = '#FF00FF';
      const outPath = `${SCRATCH_DIR}/flood_mask.pgm`;

      // Per-keep: flood-fill the click's connected color region into a
      // binary mask file. Also emit a downsampled-grid PGM for the GPU
      // layer renderer to consume cheaply.
      const floodKeep = async (p: { x: number; y: number }, pngOut: string, gridOut: string): Promise<boolean> => {
        const r = await run('magick', [
          srcPath!,
          '-alpha', 'off',
          '-fuzz', `${fuzz}%`,
          '-fill', SENTINEL,
          '-draw', `color ${p.x},${p.y} floodfill`,
          '-fuzz', '0%',
          '-fill', 'black', '+opaque', SENTINEL,
          '-fill', 'white', '-opaque', SENTINEL,
          '-write', pngOut,
          '-resize', `${OVERLAY_RES}x${OVERLAY_RES}!`,
          '-compress', 'none',
          `pgm:${gridOut}`,
        ]);
        if (r.code !== 0) {
          console.warn('[flood] keep failed at', p, r.stderr.slice(0, 200));
          return false;
        }
        return true;
      };

      // Per-reject: draw a small filled disk at the click point. NOT a
      // flood — flood would subtract the whole connected region of a
      // single color (e.g. all of "white background"), which is the
      // opposite of "spot cleaning." Disk semantics make reject feel like
      // erasing with a fixed-size eraser.
      const diskRadius = Math.max(8, Math.round(Math.min(dims!.w, dims!.h) * rejectFrac));
      const rejectDisk = async (p: { x: number; y: number }, pngOut: string): Promise<boolean> => {
        const x2 = p.x + diskRadius;
        const r = await run('magick', [
          '-size', `${dims!.w}x${dims!.h}`,
          'canvas:black',
          '-fill', 'white',
          '-draw', `circle ${p.x},${p.y} ${x2},${p.y}`,
          pngOut,
        ]);
        if (r.code !== 0) {
          console.warn('[flood] reject failed at', p, r.stderr.slice(0, 200));
          return false;
        }
        return true;
      };

      // Generate per-keep flood files (paired PNG + downsampled grid PGM)
      // and per-reject disk files.
      const keepFiles: string[] = [];
      const layerGrids: string[] = [];
      for (let i = 0; i < keeps.length; i++) {
        const png = `${SCRATCH_DIR}/flood_keep_${i}.png`;
        const grid = `${SCRATCH_DIR}/flood_keep_${i}.grid.pgm`;
        if (await floodKeep(keeps[i], png, grid)) {
          keepFiles.push(png);
          layerGrids.push(grid);
        }
      }
      const rejectFiles: string[] = [];
      for (let i = 0; i < rejects.length; i++) {
        const f = `${SCRATCH_DIR}/flood_reject_${i}.png`;
        if (await rejectDisk(rejects[i], f)) rejectFiles.push(f);
      }

      // Compose the final mask: union of keeps minus union of rejects.
      // -evaluate-sequence keeps the command O(1) shape regardless of click
      // count; per-file -compose chains broke around ~9 files.
      //
      // Structure:
      //   ( keep1 keep2 ... -evaluate-sequence max )      → union of keeps
      //   ( ( reject1 ... -evaluate-sequence max ) -negate )  → inverted rejects
      //   -compose darken -composite                       → keeps AND-NOT rejects
      const composeArgs: string[] = [];
      if (keepFiles.length === 0) {
        composeArgs.push('-size', `${dims.w}x${dims.h}`, 'canvas:black');
      } else if (keepFiles.length === 1) {
        composeArgs.push(keepFiles[0]);
      } else {
        composeArgs.push('(');
        for (const kf of keepFiles) composeArgs.push(kf);
        composeArgs.push('-evaluate-sequence', 'max', ')');
      }
      if (rejectFiles.length > 0) {
        composeArgs.push('(');
        if (rejectFiles.length === 1) {
          composeArgs.push(rejectFiles[0]);
        } else {
          composeArgs.push('(');
          for (const rf of rejectFiles) composeArgs.push(rf);
          composeArgs.push('-evaluate-sequence', 'max', ')');
        }
        composeArgs.push('-negate', ')', '-compose', 'darken', '-composite');
      }
      composeArgs.push('-compress', 'none', `pgm:${outPath}`);

      const r = await run('magick', composeArgs);
      if (r.code !== 0) {
        console.warn('[flood] compose failed:', r.stderr.slice(0, 200));
        return null;
      }
      const mask = parseP2PGM(readFile(outPath) ?? '', dims.w, dims.h);

      // Parse each per-keep downsampled grid into a Set of in-selection
      // cell indices. Cheap — 128² = 16k entries per layer.
      const layers: Set<number>[] = [];
      for (const gridPath of layerGrids) {
        const text = readFile(gridPath);
        if (!text) { layers.push(new Set()); continue; }
        layers.push(parseP2PGMToCellSet(text, OVERLAY_RES, OVERLAY_RES));
      }

      return { mask, layers, overlayRes: OVERLAY_RES };
    },
    close() {
      srcPath = null;
      dims = null;
    },
  };
}

/** Parse a P2 ASCII PGM (header + whitespace-separated values) into a
 *  Uint8Array of 1=erased (white in pgm) / 0=keep convention.
 *  Note: the PGM convention is OPPOSITE of our mask (white=keep visually,
 *  but here white means "this pixel is part of the selected region, i.e.
 *  what we want to ERASE from the kept image"). So no inversion needed. */
function parseP2PGM(text: string, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (!text) return out;
  // Skip header lines (P2, dims, maxval) — first 3 non-empty tokens.
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens[0] !== 'P2') return out;
  const data = tokens.slice(3); // skip P2, "W H", maxval
  const n = Math.min(out.length, data.length);
  for (let i = 0; i < n; i++) {
    // Threshold at 128 — PGM may have antialiased intermediate values.
    out[i] = (+data[i] >= 128) ? 1 : 0;
  }
  return out;
}

/** Parse a P2 ASCII PGM into a Set<number> of cell indices that are set
 *  (value >= 128). Cheaper than full Uint8Array allocation when we only
 *  need the sparse "which cells are on" info — MaskQuad takes a Set. */
function parseP2PGMToCellSet(text: string, w: number, h: number): Set<number> {
  const out = new Set<number>();
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens[0] !== 'P2') return out;
  const data = tokens.slice(3);
  const n = Math.min(w * h, data.length);
  for (let i = 0; i < n; i++) {
    if (+data[i] >= 128) out.add(i);
  }
  return out;
}
