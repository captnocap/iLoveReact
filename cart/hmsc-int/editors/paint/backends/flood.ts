// editors/paint/backends/flood.ts — ImageMagick floodfill backend, the
// always-works smart select. Quality is wand-tool tier: great on solid
// backgrounds, blocky on subtle gradients; the graceful fallback when the
// onnx host binding is absent.
//
// Algorithm: each KEEP click floods the source at that pixel with a color
// tolerance into a binary region (magenta-sentinel isolation so tolerance
// never bleeds through post-processing); each REJECT click draws a small
// disk (NOT a flood — flood would subtract a whole color region, the
// opposite of spot cleaning). Final mask = union of keeps minus union of
// rejects, recomputed each call from the full click history.
//
// Behavior reference: cart/cutout/backends/flood.ts (read, never imported).

import { run } from '@reactjit/runtime/hooks/process';
import { readFile, mkdir } from '@reactjit/runtime/hooks/fs';
import { PAINT_TUNING } from '../tuning';
import { PAINT_SCRATCH_DIR, type SelectionBackend, type ClickPoint, type RefineResult, type BackendOpts } from './types';

export function createFloodBackend(): SelectionBackend {
  let srcPath: string | null = null;
  let dims: { w: number; h: number } | null = null;
  const OVERLAY_RES = PAINT_TUNING.overlayRes;

  return {
    name: 'flood',
    async open(path, srcDims) {
      srcPath = path;
      dims = srcDims;
      mkdir(PAINT_SCRATCH_DIR);
      return true;
    },
    async refine(points: ClickPoint[], opts?: BackendOpts): Promise<RefineResult | null> {
      if (!srcPath || !dims) return null;
      if (points.length === 0) {
        return { mask: new Uint8Array(dims.w * dims.h), layers: [], overlayRes: OVERLAY_RES };
      }

      // Tunables resolve per-call — backends are stateless w.r.t. user prefs.
      const B = PAINT_TUNING.backends;
      const fuzz = Math.max(0, Math.min(B.floodFuzzMax,
        typeof opts?.fuzzPercent === 'number' ? opts.fuzzPercent : B.floodFuzz));
      const rejectFrac = Math.max(B.rejectFracMin, Math.min(B.rejectFracMax,
        typeof opts?.rejectDiskFrac === 'number' ? opts.rejectDiskFrac : B.floodRejectFrac));

      // Clamp coords in-bounds — one click at x=dims.w makes magick reject
      // the WHOLE chain.
      const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.floor(v)));
      const inBounds = (p: ClickPoint) => {
        const x = clamp(p.x, dims!.w);
        const y = clamp(p.y, dims!.h);
        return { x, y, label: p.label };
      };
      const keeps   = points.filter((p) => p.label === 'keep').map(inBounds);
      const rejects = points.filter((p) => p.label === 'reject').map(inBounds);

      // Sentinel: hex magenta — extremely rare in sources. Must be #RRGGBB
      // (srgb(R,G,B) has literal parens magick reads as CLI brackets).
      const SENTINEL = '#FF00FF';
      const outPath = `${PAINT_SCRATCH_DIR}/flood_mask.pgm`;

      // Per-keep: flood the click's connected color region into a binary
      // mask file + a downsampled grid PGM for cheap GPU layer rendering.
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
          console.warn('[paint:flood] keep failed at', p, r.stderr.slice(0, 200));
          return false;
        }
        return true;
      };

      // Per-reject: a small filled disk — eraser semantics, not region
      // subtraction.
      const diskRadius = Math.max(B.rejectDiskMinPx, Math.round(Math.min(dims!.w, dims!.h) * rejectFrac));
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
          console.warn('[paint:flood] reject failed at', p, r.stderr.slice(0, 200));
          return false;
        }
        return true;
      };

      const keepFiles: string[] = [];
      const layerGrids: string[] = [];
      for (let i = 0; i < keeps.length; i++) {
        const png = `${PAINT_SCRATCH_DIR}/flood_keep_${i}.png`;
        const grid = `${PAINT_SCRATCH_DIR}/flood_keep_${i}.grid.pgm`;
        if (await floodKeep(keeps[i], png, grid)) {
          keepFiles.push(png);
          layerGrids.push(grid);
        }
      }
      const rejectFiles: string[] = [];
      for (let i = 0; i < rejects.length; i++) {
        const f = `${PAINT_SCRATCH_DIR}/flood_reject_${i}.png`;
        if (await rejectDisk(rejects[i], f)) rejectFiles.push(f);
      }

      // Compose: union of keeps minus union of rejects. -evaluate-sequence
      // keeps the command O(1) shape regardless of click count (per-file
      // -compose chains broke around ~9 files):
      //   ( keep1 keep2 ... -evaluate-sequence max )           → keeps union
      //   ( ( reject1 ... -evaluate-sequence max ) -negate )   → inverted rejects
      //   -compose darken -composite                           → keeps AND-NOT rejects
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
        console.warn('[paint:flood] compose failed:', r.stderr.slice(0, 200));
        return null;
      }
      const mask = parseP2PGM(readFile(outPath) ?? '', dims.w, dims.h);

      // Per-keep downsampled grids → sparse cell sets (128² = 16k max each).
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

/** Parse a P2 ASCII PGM into 1 = selected / 0 = keep bytes. White in the
 *  pgm IS the selected region, so no inversion. Threshold at 128 — PGMs may
 *  carry antialiased intermediates. */
export function parseP2PGM(text: string, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (!text) return out;
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens[0] !== 'P2') return out;
  const data = tokens.slice(3); // skip P2, "W H", maxval
  const n = Math.min(out.length, data.length);
  for (let i = 0; i < n; i++) {
    out[i] = (+data[i] >= 128) ? 1 : 0;
  }
  return out;
}

/** Parse a P2 ASCII PGM into a sparse Set of set cell indices (≥128). */
export function parseP2PGMToCellSet(text: string, w: number, h: number): Set<number> {
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
