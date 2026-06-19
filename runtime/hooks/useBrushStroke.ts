// runtime/hooks/useBrushStroke.ts — THE universal stroke controller. Bind it
// once to a <Paintable> and you get the whole brush experience: the full tool
// family (brush · eraser · line · rect · ellipse · eyedropper, with fill /
// smudge / blur reserved for the host dest-sampling pass), gap-free optimistic
// dabbing straight to the host, hold-shift straight lines, [/] size stepping,
// and tool hotkeys — all identical everywhere so no cart re-invents it.
//
// Performance contract (the reason this is host-owned): a freehand stroke
// NEVER touches React state. Dabs go straight to V8 via the paintable ops; the
// host drains them once per frame. Only the shape tools (line/rect/ellipse),
// which inherently need a rubber-band preview, push a throttled preview value.

import { useEffect, useRef, useState } from 'react';
import type { PaintableOps } from './usePaintable';
import { useModifiers } from './useModifiers';
import {
  type Brush, type BrushTool, BRUSH_SHAPE_ID, TOOL_HOTKEY,
} from '../paint/model';
import {
  createStrokeEngine, dabsAlongSegment, constrainLine, constrainSquare,
  stepSizeLadder, type Dab, type StrokeEngine,
} from '../paint/stroke';
import { hexToRgb01, rgb01ToHex } from '../paint/colors';

export type ShapePreview =
  | { tool: 'line'; ax: number; ay: number; bx: number; by: number }
  | { tool: 'rect' | 'ellipse'; ax: number; ay: number; bx: number; by: number };

export interface BrushStrokeOpts {
  /** the target paintable's imperative ops (from usePaintable). */
  paint: PaintableOps;
  /** texture dimensions, for clamping + eyedropper readback. */
  texW: number;
  texH: number;
  /** live brush + tool — read every render, applied via refs. */
  brush: Brush;
  tool: BrushTool;
  /** screen-space pointer → texture-pixel coords; return null to reject. */
  mapPoint: (screenX: number, screenY: number) => { x: number; y: number } | null;
  /** eyedropper result. */
  onPickColor?: (hex: string) => void;
  /** color the eraser writes until host alpha-erase lands (Phase B). */
  eraseColor?: string;
  /** optional UV-island clip rect (texture px) so a dab can't bleed. */
  clip?: { x: number; y: number; w: number; h: number };
  /** fired once when any stroke commits (undo checkpoints, dirty flags). */
  onStrokeEnd?: () => void;
}

export interface BrushStrokeHandlers {
  onMouseDown: (e: any) => void;
  onMouseMove: (e: any) => void;
  onMouseUp: (e: any) => void;
  onMouseLeave: (e: any) => void;
}

export interface BrushStrokeController {
  handlers: BrushStrokeHandlers;
  /** live rubber-band preview for shape tools (null when idle/freehand). */
  preview: ShapePreview | null;
}

function jitterSeed(x: number, y: number): number {
  const h = (Math.floor(x) * 73856093) ^ (Math.floor(y) * 19349663);
  return ((h >>> 0) % 1000) / 1000;
}

export function useBrushStroke(opts: BrushStrokeOpts): BrushStrokeController {
  // Live opts behind a ref so the (stable) pointer handlers always see the
  // current brush/tool without re-binding listeners.
  const ref = useRef(opts);
  ref.current = opts;

  const engineRef = useRef<StrokeEngine | null>(null);
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  const lastEndRef = useRef<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<ShapePreview | null>(null);

  const { mods } = useModifiers();

  // [ / ] size stepping + tool hotkeys are wired by the host via the kit; the
  // controller exposes the size stepper so chrome and keys share one path.
  useEffect(() => {
    // nothing to clean — handlers are pure refs.
  }, []);

  const stampDab = (dab: Dab) => {
    const o = ref.current;
    const b = o.brush;
    const shape = b.stamp.kind === 'analytic' ? b.stamp.shape : 'round';
    const kindId = BRUSH_SHAPE_ID[shape] ?? 0;
    let rgb: [number, number, number];
    if (o.tool === 'eraser') rgb = hexToRgb01(o.eraseColor ?? '#0c0e14');
    else if (b.ink.kind === 'color') rgb = hexToRgb01(b.ink.hex);
    else rgb = [1, 1, 1]; // texture/shader inks resolve to color until Phase B
    const c = o.clip;
    o.paint.brushColor(
      dab.x, dab.y, dab.radius, rgb[0], rgb[1], rgb[2],
      kindId, (b.angleDeg * Math.PI) / 180, b.aspect, b.hardness, b.flow, b.scatter,
      jitterSeed(dab.x, dab.y),
      c?.x ?? 0, c?.y ?? 0, c?.w ?? 0, c?.h ?? 0,
    );
  };

  const stampMany = (dabs: Dab[]) => { for (const d of dabs) stampDab(d); };

  const ellipseOutlineDabs = (ax: number, ay: number, bx: number, by: number): Dab[] => {
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;
    const rx = Math.abs(bx - ax) / 2;
    const ry = Math.abs(by - ay) / 2;
    const o = ref.current;
    const out: Dab[] = [];
    const steps = Math.max(16, Math.round((rx + ry) * 0.5));
    let px = cx + rx;
    let py = cy;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const nx = cx + Math.cos(t) * rx;
      const ny = cy + Math.sin(t) * ry;
      out.push(...dabsAlongSegment(px, py, nx, ny, o.brush.size, o.brush.spacing));
      px = nx; py = ny;
    }
    return out;
  };

  const rectOutlineDabs = (ax: number, ay: number, bx: number, by: number): Dab[] => {
    const o = ref.current;
    const sz = o.brush.size;
    const sp = o.brush.spacing;
    return [
      ...dabsAlongSegment(ax, ay, bx, ay, sz, sp),
      ...dabsAlongSegment(bx, ay, bx, by, sz, sp),
      ...dabsAlongSegment(bx, by, ax, by, sz, sp),
      ...dabsAlongSegment(ax, by, ax, ay, sz, sp),
    ];
  };

  const pickColorAt = (x: number, y: number) => {
    const o = ref.current;
    if (!o.onPickColor) return;
    const bytes = o.paint.readback();
    if (!bytes) return;
    const ch = Math.max(1, Math.round(bytes.length / (o.texW * o.texH)));
    const px = Math.max(0, Math.min(o.texW - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(o.texH - 1, Math.floor(y)));
    const i = (py * o.texW + px) * ch;
    if (ch >= 3) o.onPickColor(rgb01ToHex(bytes[i] / 255, bytes[i + 1] / 255, bytes[i + 2] / 255));
    else o.onPickColor(rgb01ToHex(bytes[i] / 255, bytes[i] / 255, bytes[i] / 255));
  };

  const handlers: BrushStrokeHandlers = {
    onMouseDown: (e: any) => {
      const o = ref.current;
      const p = o.mapPoint(e.x, e.y);
      if (!p) return;
      const tool = o.tool;

      if (tool === 'eyedropper') { pickColorAt(p.x, p.y); return; }
      if (tool === 'fill' || tool === 'smudge' || tool === 'blur') return; // Phase B/C host

      if (tool === 'brush' || tool === 'eraser') {
        const eng = createStrokeEngine({ sizePx: o.brush.size, spacingFrac: o.brush.spacing });
        engineRef.current = eng;
        eng.begin();
        // Shift on press → straight line from the previous stroke's end (the
        // classic "shift to connect" brush chord), then continue freehand.
        const last = lastEndRef.current;
        if (mods.shift && last) {
          stampMany(dabsAlongSegment(last.x, last.y, p.x, p.y, o.brush.size, o.brush.spacing));
        }
        stampMany(eng.move(p.x, p.y, e.pressure));
        return;
      }

      // shape tools: record the anchor, preview rubber-bands on move.
      anchorRef.current = { x: p.x, y: p.y };
      setPreview(
        tool === 'line'
          ? { tool: 'line', ax: p.x, ay: p.y, bx: p.x, by: p.y }
          : { tool, ax: p.x, ay: p.y, bx: p.x, by: p.y },
      );
    },

    onMouseMove: (e: any) => {
      const o = ref.current;
      const eng = engineRef.current;
      if (eng && eng.drawing()) {
        const p = o.mapPoint(e.x, e.y);
        if (p) stampMany(eng.move(p.x, p.y, e.pressure));
        return;
      }
      const anchor = anchorRef.current;
      if (!anchor) return;
      const p = o.mapPoint(e.x, e.y);
      if (!p) return;
      let bx = p.x, by = p.y;
      if (o.tool === 'line') {
        const c = constrainLine(anchor.x, anchor.y, p.x, p.y, mods.shift);
        bx = c.x; by = c.y;
        setPreview({ tool: 'line', ax: anchor.x, ay: anchor.y, bx, by });
      } else {
        if (mods.shift) { const c = constrainSquare(anchor.x, anchor.y, p.x, p.y); bx = c.x; by = c.y; }
        setPreview({ tool: o.tool as 'rect' | 'ellipse', ax: anchor.x, ay: anchor.y, bx, by });
      }
    },

    onMouseUp: (e: any) => {
      const o = ref.current;
      const eng = engineRef.current;
      if (eng && eng.drawing()) {
        const p = o.mapPoint(e.x, e.y);
        if (p) { stampMany(eng.move(p.x, p.y, e.pressure)); lastEndRef.current = { x: p.x, y: p.y }; }
        eng.end();
        engineRef.current = null;
        o.onStrokeEnd?.();
        return;
      }
      const anchor = anchorRef.current;
      if (!anchor) return;
      const p = o.mapPoint(e.x, e.y) ?? anchor;
      let bx = p.x, by = p.y;
      if (o.tool === 'line') {
        const c = constrainLine(anchor.x, anchor.y, p.x, p.y, mods.shift);
        bx = c.x; by = c.y;
        stampMany(dabsAlongSegment(anchor.x, anchor.y, bx, by, o.brush.size, o.brush.spacing));
        lastEndRef.current = { x: bx, y: by };
      } else if (o.tool === 'rect') {
        if (mods.shift) { const c = constrainSquare(anchor.x, anchor.y, p.x, p.y); bx = c.x; by = c.y; }
        stampMany(rectOutlineDabs(anchor.x, anchor.y, bx, by));
      } else if (o.tool === 'ellipse') {
        if (mods.shift) { const c = constrainSquare(anchor.x, anchor.y, p.x, p.y); bx = c.x; by = c.y; }
        stampMany(ellipseOutlineDabs(anchor.x, anchor.y, bx, by));
      }
      anchorRef.current = null;
      setPreview(null);
      o.onStrokeEnd?.();
    },

    onMouseLeave: () => {
      const eng = engineRef.current;
      if (eng && eng.drawing()) { eng.end(); engineRef.current = null; ref.current.onStrokeEnd?.(); }
      anchorRef.current = null;
      setPreview(null);
    },
  };

  return { handlers, preview };
}

/** Standalone size stepper so chrome buttons and the [/] keys share one path. */
export { stepSizeLadder };
export { TOOL_HOTKEY };
