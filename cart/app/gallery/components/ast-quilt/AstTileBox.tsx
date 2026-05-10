// AstTileBox — Box-tree rebuild of AstTile, designed to match the
// original visual behavior:
//
//   - Recursive nested Boxes for the AST grid (alternating row/col by
//     depth, child sizes proportional to span)
//   - Each pane's border lights up when the scanPos is within the
//     node's [start, end] range — same logic as the original's
//     `inScan = scanPos >= nodeStart && scanPos < nodeEnd`
//   - scanPos pingpongs from 0 to file.maxEnd over time (matches
//     original's triangle-wave timing)
//
// Tradeoffs vs the original Effect onRender approach:
//   - 0 per-pixel JS work (panes are layout primitives, painted as
//     quads)
//   - 0 per-pixel rasterization per frame (the painter just re-blits
//     the colored quads with their current border color)
//   - PER-PANE React reconciliation when scanPos changes (each pane
//     reads scanPos from context, recomputes its `isActive` flag, may
//     re-render with a new border style)
//
// Why this is acceptable: only the panes whose `isActive` flips
// per-frame produce work. As scanPos moves through a single node, no
// border state changes, no reconciles fire. Only at the boundary
// (scanPos crossing into a new node) do a few panes re-render. So
// per-frame cost is ~1-5 reconciles, not 100-200.
//
// Compare to the original AstTile: same recursive grid, same scan-
// driven highlighting, but the rendering is "structure" (Boxes) +
// "state" (one scanPos number) instead of a per-pixel JS canvas.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { AST_SAMPLE_FILES } from './sampleContract';
import {
  prepareAstFingerprintFile,
  type AstFingerprintFile,
  type AstTileProps,
  type AstFingerprintInputFile,
} from './AstQuilt';

const TILE_FRAME_SIZE = 360;
const TILE_EFFECT_SIZE = 332;
const SCAN_PERIOD_SEC = 5.5;

// Single value pushed down the tree — a number representing where the
// scan head currently is on the file's [0, maxEnd] timeline.
const ScanContext = createContext<number>(0);

// HSV → RGB hex. Mirrors the original's hsv()*255 conversion.
function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 1) + 1) % 1;
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  const toHex = (n: number) => {
    const v = Math.max(0, Math.min(255, Math.round(n * 255)));
    return v.toString(16).padStart(2, '0');
  };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Match the original colorFor() — kindId-driven hue with depth offset.
// We split into a "static" (not-in-scan) and "active" (in-scan)
// variant so each pane can toggle without recomputing colors. Bright
// version pushes hue + saturation + value harder so the active state
// reads as an actual glow rather than a subtle tint shift.
function colorPair(kindId: number, depth: number): { dim: string; bright: string } {
  const hue = (((kindId * 137) % 360) + depth * 7) / 360;
  return {
    dim: hsvToHex(hue, 0.55, 0.62),
    bright: hsvToHex(hue + 55 / 360, 0.95, 1.0),
  };
}

function AstNodeBox({
  file,
  node,
  depth,
}: {
  file: AstFingerprintFile;
  node: number;
  depth: number;
}) {
  const scanPos = useContext(ScanContext);
  if (node === 0) return null;
  const index = node - 1;
  const nodeStart = file.start[index] || 0;
  const nodeEnd = file.end[index] || 0;
  const inScan = scanPos >= nodeStart && scanPos < nodeEnd;

  const firstChild = file.firstChild[index] || 0;
  const kindId = file.kind[index] || 0;
  const colors = colorPair(kindId, depth);
  const bgColor = inScan ? colors.bright : colors.dim;
  // Bright outline when in scan — matches the original's
  // `outline = inScan ? 240 : 18`. Bumped width and brightened the
  // color to compensate for not having the per-pixel glow halo the
  // original gets implicitly from canvas rendering.
  const borderColor = inScan ? '#ffffff' : '#10141c';
  const borderWidth = inScan ? 3 : 1;

  // Leaf node: just a colored cell with a (possibly bright) border.
  if (firstChild === 0) {
    return (
      <Box style={{
        flexGrow: 1,
        flexBasis: 0,
        backgroundColor: bgColor,
        borderWidth,
        borderColor,
      }} />
    );
  }

  // Collect children + spans for proportional sizing.
  const children: number[] = [];
  const spans: number[] = [];
  let total = 0;
  let child = firstChild;
  while (child !== 0) {
    const childIndex = child - 1;
    const span = Math.max(1, (file.end[childIndex] || 0) - (file.start[childIndex] || 0));
    children.push(child);
    spans.push(span);
    total += span;
    child = file.nextSibling[childIndex] || 0;
  }

  const horizontal = depth % 2 === 0;

  return (
    <Box style={{
      flexGrow: 1,
      flexBasis: 0,
      backgroundColor: bgColor,
      borderWidth,
      borderColor,
      flexDirection: horizontal ? 'row' : 'column',
    }}>
      {children.map((c, i) => (
        <Box
          key={c}
          style={{
            flexGrow: spans[i] / total,
            flexBasis: 0,
            display: 'flex',
            flexDirection: horizontal ? 'row' : 'column',
          }}
        >
          <AstNodeBox file={file} node={c} depth={depth + 1} />
        </Box>
      ))}
    </Box>
  );
}

export type AstTileBoxProps = AstTileProps;

export function AstTileBox({ file, files, tileIndex = 17 }: AstTileBoxProps) {
  const sourceFiles: readonly AstFingerprintInputFile[] = files || AST_SAMPLE_FILES;
  const safeIndex = sourceFiles.length > 0
    ? ((tileIndex % sourceFiles.length) + sourceFiles.length) % sourceFiles.length
    : 0;
  const inputFile = file || sourceFiles[safeIndex] || null;
  const preparedFile: AstFingerprintFile | null = inputFile
    ? prepareAstFingerprintFile(inputFile)
    : null;

  // scanPos animates 0 → maxEnd → 0 in a triangle wave matching the
  // original's `triangle = Math.abs(((time * 0.35) % 2 + 2) % 2 - 1);
  // scanPos = (1 - triangle) * file.maxEnd`.
  const [scanPos, setScanPos] = useState(0);
  const rafRef = useRef<any>(null);
  useEffect(() => {
    if (!preparedFile) return;
    const maxEnd = preparedFile.maxEnd;
    if (maxEnd <= 0) return;
    const g: any = globalThis;
    const raf = g.requestAnimationFrame ? (fn: any) => g.requestAnimationFrame(fn) : (fn: any) => setTimeout(fn, 16);
    const caf = g.cancelAnimationFrame || clearTimeout;
    const tick = () => {
      const time = Date.now() / 1000;
      // Slowed from 0.35 → 0.12 to match perceived original speed.
      // Period = 2 / 0.12 ≈ 16.7s for a full top→bottom→top cycle.
      const triangle = Math.abs(((time * 0.12) % 2 + 2) % 2 - 1);
      setScanPos((1 - triangle) * maxEnd);
      rafRef.current = raf(tick);
    };
    rafRef.current = raf(tick);
    return () => { if (rafRef.current != null) { try { caf(rafRef.current); } catch {} } };
  }, [preparedFile?.maxEnd]);

  if (!preparedFile) return null;

  return (
    <Box style={{
      width: TILE_FRAME_SIZE,
      height: TILE_FRAME_SIZE,
      padding: (TILE_FRAME_SIZE - TILE_EFFECT_SIZE) / 2,
      backgroundColor: '#02050a',
    }}>
      <ScanContext.Provider value={scanPos}>
        <Box style={{
          width: TILE_EFFECT_SIZE,
          height: TILE_EFFECT_SIZE,
          backgroundColor: '#02050a',
          flexDirection: 'row',
        }}>
          <AstNodeBox file={preparedFile} node={preparedFile.root} depth={0} />
        </Box>
      </ScanContext.Provider>
    </Box>
  );
}
