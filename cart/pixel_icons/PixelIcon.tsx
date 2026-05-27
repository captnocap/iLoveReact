// PixelIcon — render a pixel-matrix icon as a grid of <Box>.
//
// Data shape (produced by scripts/img-to-pixels.py):
//   { size: N,
//     palette: ["#RRGGBB", …],          // unique colors
//     pixels: Array<number | null>      // index into palette, or null (transparent)
//   }                                   // length N*N, row-major
//
// Each cell is a single <Box> sized to `pixelSize` px. Total cells = size*size,
// so 64×64 = 4096 boxes (snappy), 128×128 = 16384 boxes (works but heavy),
// 512×512 = 262144 boxes (don't render this as Boxes — it's source data).
//
// React.memo so a stable `data` reference + same pixelSize/gap skips the
// 4096-element subtree reconciliation entirely. The mask-erase UI relies on
// this: it keeps `data` pinned to the unmodified matrix and overlays
// transparency via <MaskOverlay> on top.

import { memo } from 'react';
import { Box } from '@reactjit/runtime/primitives';

// Two-part palette format: unique colors live in `palette` (string[]) and
// `pixels` stores indexes into it (with `null` for fully-transparent cells).
// Saves a lot of bytes on disk vs. inlining a hex string per cell — a 512²
// matrix with ~1000 unique colors goes from ~2.4MB to a few hundred KB.
export type PixelMatrix = {
  size: number;
  palette: string[];
  pixels: Array<number | null>;
};

export function colorAt(m: PixelMatrix, i: number): string | null {
  const p = m.pixels[i];
  if (p == null) return null;
  return m.palette[p] ?? null;
}

type Props = {
  data: PixelMatrix;
  pixelSize?: number;
  gap?: number;
};

function PixelIconImpl({ data, pixelSize = 4, gap = 0 }: Props) {
  const { size, pixels, palette } = data;
  const total = size * pixelSize + (size - 1) * gap;

  const rows = [];
  for (let y = 0; y < size; y++) {
    const cells = [];
    for (let x = 0; x < size; x++) {
      const p = pixels[y * size + x];
      const c = p == null ? null : palette[p];
      cells.push(
        <Box
          key={x}
          style={{
            width: pixelSize,
            height: pixelSize,
            backgroundColor: c ?? 'transparent',
            marginRight: gap && x < size - 1 ? gap : 0,
          }}
        />
      );
    }
    rows.push(
      <Box
        key={y}
        style={{
          flexDirection: 'row',
          height: pixelSize,
          marginBottom: gap && y < size - 1 ? gap : 0,
        }}
      >
        {cells}
      </Box>
    );
  }

  return (
    <Box style={{ width: total, height: total, flexDirection: 'column' }}>
      {rows}
    </Box>
  );
}

export const PixelIcon = memo(PixelIconImpl);

// MaskOverlay — sparse layer of absolutely-positioned "punch-out" boxes,
// one per masked 64-grid cell. Sized to sit on top of a PixelIcon and cover
// each erased cell with the host background color (so the eye reads it as
// "this pixel is gone"). The Save path is what actually nulls those entries
// in the matrix; this is preview-only.
//
// Cost is O(mask.size), NOT O(data.size²). With brush=1 and a few clicks
// the overlay has ≤ a few hundred nodes; even brush=9 swipes stay bounded
// by the user's actual erase region. Combined with React.memo on PixelIcon,
// mouse-move re-renders no longer touch the 4096-cell base subtree.

const MASK_RES_DEFAULT = 64;

type MaskOverlayProps = {
  mask: Set<number>;
  dataSize: number;
  pixelSize: number;
  bg: string;
  maskRes?: number;
};

export function MaskOverlay({ mask, dataSize, pixelSize, bg, maskRes = MASK_RES_DEFAULT }: MaskOverlayProps) {
  if (mask.size === 0) return null;
  const cellPx = (dataSize / maskRes) * pixelSize;
  const total = dataSize * pixelSize;

  // Coalesce consecutive erased cells in each row into a single Box.
  // framework/layout.zig caps a flex container's children at MAX_CHILDREN
  // (2048); one Box per erased cell blows that cap on any non-trivial erase.
  // Row-runs cut the worst case to maskRes per row instead of maskRes², and
  // for realistic crop-shaped masks (large connected regions) it's typically
  // 1–2 runs per row.
  const blocks: any[] = [];
  for (let y = 0; y < maskRes; y++) {
    let x = 0;
    while (x < maskRes) {
      if (!mask.has(y * maskRes + x)) { x++; continue; }
      const start = x;
      while (x < maskRes && mask.has(y * maskRes + x)) x++;
      const w = (x - start) * cellPx;
      blocks.push(
        <Box
          key={y * maskRes + start}
          style={{
            position: 'absolute',
            left: start * cellPx,
            top: y * cellPx,
            width: w,
            height: cellPx,
            backgroundColor: bg,
          }}
        />
      );
    }
  }

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: total, height: total }}>
      {blocks}
    </Box>
  );
}

// PaintOverlay — sparse layer of absolutely-positioned colored cells. Same
// shape as MaskOverlay but each run carries its own hex color from the
// `paint` map. Used for the live preview of paint-mode strokes so we don't
// have to rebuild the underlying matrix on every mouse move.

type PaintOverlayProps = {
  paint: Map<number, string>;
  dataSize: number;
  pixelSize: number;
  maskRes?: number;
};

export function PaintOverlay({ paint, dataSize, pixelSize, maskRes = MASK_RES_DEFAULT }: PaintOverlayProps) {
  if (paint.size === 0) return null;
  const cellPx = (dataSize / maskRes) * pixelSize;
  const total = dataSize * pixelSize;

  // Coalesce row-runs of identical color into single boxes — same MAX_CHILDREN
  // budget concerns as MaskOverlay.
  const blocks: any[] = [];
  for (let y = 0; y < maskRes; y++) {
    let x = 0;
    while (x < maskRes) {
      const color = paint.get(y * maskRes + x);
      if (color === undefined) { x++; continue; }
      const start = x;
      let runColor = color;
      while (x < maskRes && paint.get(y * maskRes + x) === runColor) x++;
      blocks.push(
        <Box
          key={y * maskRes + start}
          style={{
            position: 'absolute',
            left: start * cellPx,
            top: y * cellPx,
            width: (x - start) * cellPx,
            height: cellPx,
            backgroundColor: runColor,
          }}
        />
      );
    }
  }

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: total, height: total }}>
      {blocks}
    </Box>
  );
}
