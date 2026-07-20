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
  type Brush, type BrushTool, TOOL_HOTKEY,
} from '../paint/model';
import {
  createStrokeEngine, dabsAlongSegment, dabsForStrokePath, constrainLine, constrainSquare,
  stepSizeLadder, type Dab, type StrokeEngine,
} from '../paint/stroke';
import { rgb01ToHex } from '../paint/colors';
import { type ClipRect, brushDabRgb, stampBrushDab } from '../paint/stamp';

export type ShapePreview =
  | { tool: 'line'; ax: number; ay: number; bx: number; by: number }
  | { tool: 'rect' | 'ellipse'; ax: number; ay: number; bx: number; by: number };

export type { ClipRect };

export type CommittedBrushStroke = {
  tool: 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse';
  /** Interleaved texture-pixel pointer path. */
  points: number[];
};

/** A pointer mapped onto the paint texture. For 3D surfaces, `mapPoint`
 *  raycasts the mesh and returns the hit's texture-pixel coords PLUS the hit
 *  face's UV-island `clip` — so the same controller paints a flat canvas or a
 *  building face / a shirt / any mesh, and a dab never bleeds across islands. */
export interface MappedPoint { x: number; y: number; clip?: ClipRect }

export interface BrushStrokeOpts {
  /** the target paintable's imperative ops (from usePaintable). */
  paint: PaintableOps;
  /** texture dimensions, for clamping + eyedropper readback. */
  texW: number;
  texH: number;
  /** live brush + tool — read every render, applied via refs. */
  brush: Brush;
  tool: BrushTool;
  /** screen-space pointer → texture-pixel coords (+ optional per-hit clip for
   *  3D). Return null to reject (off-surface / missed the mesh). */
  mapPoint: (screenX: number, screenY: number) => MappedPoint | null;
  /** eyedropper result. */
  onPickColor?: (hex: string) => void;
  /** color the eraser writes until host alpha-erase lands (Phase B). */
  eraseColor?: string;
  /** static fallback clip when mapPoint doesn't carry a per-hit one. */
  clip?: ClipRect;
  /** Optional symmetry hook (req_1538): given a stamped dab (atlas px + radius),
   *  return its mirror image(s) — each its own atlas point + clip island — to stamp
   *  alongside it. Applies to EVERY dab (freehand-interpolated and shape tools), so
   *  symmetric 3D painting is gap-free on both sides. Same colour/brush as the dab. */
  mirror?: (dab: Dab) => Array<{ x: number; y: number; clip: ClipRect | null }>;
  /** Fired once when a stroke commits. The optional record is the durable
   *  pointer path; existing checkpoint-only consumers may ignore it. */
  onStrokeEnd?: (stroke?: CommittedBrushStroke) => void;
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

export function useBrushStroke(opts: BrushStrokeOpts): BrushStrokeController {
  // Live opts behind a ref so the (stable) pointer handlers always see the
  // current brush/tool without re-binding listeners.
  const ref = useRef(opts);
  ref.current = opts;

  const engineRef = useRef<StrokeEngine | null>(null);
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  const lastEndRef = useRef<{ x: number; y: number } | null>(null);
  const pathRef = useRef<number[] | null>(null);
  // The clip of the most-recently-hit point — dabs (incl. interpolated ones)
  // scissor to it, so a 3D stroke that lands on a face stays on that face's
  // UV island. Updated by `map()` on every successful mapPoint.
  const clipRef = useRef<ClipRect | null>(null);
  const [preview, setPreview] = useState<ShapePreview | null>(null);

  const { mods } = useModifiers();

  // Map a pointer event onto the texture AND latch its per-hit clip.
  const map = (e: any): MappedPoint | null => {
    const p = ref.current.mapPoint(e.x, e.y);
    if (p) clipRef.current = p.clip ?? ref.current.clip ?? null;
    return p;
  };

  // [ / ] size stepping + tool hotkeys are wired by the host via the kit; the
  // controller exposes the size stepper so chrome and keys share one path.
  useEffect(() => {
    // nothing to clean — handlers are pure refs.
  }, []);

  const stampDab = (dab: Dab) => {
    const o = ref.current;
    const erase = o.tool === 'eraser' || o.brush.blend === 'erase';
    const rgb = brushDabRgb(o.brush, o.tool, o.eraseColor); // texture/shader inks → white until Phase B
    // one disc, scissored to a clip island — primary + each mirror image share this.
    stampBrushDab(o.paint, o.brush, rgb, dab.x, dab.y, dab.radius, clipRef.current ?? o.clip ?? null, erase);
    if (o.mirror) for (const md of o.mirror(dab)) stampBrushDab(o.paint, o.brush, rgb, md.x, md.y, dab.radius, md.clip, erase);
  };

  const stampMany = (dabs: Dab[]) => { for (const d of dabs) stampDab(d); };

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
      const p = map(e);
      if (!p) return;
      const tool = o.tool;

      if (tool === 'eyedropper') { pickColorAt(p.x, p.y); return; }
      if (tool === 'fill' || tool === 'smudge' || tool === 'blur' || tool === 'text' || tool === 'marquee' || tool === 'lasso') return; // separate host/selection paths

      if (tool === 'brush' || tool === 'eraser') {
        const eng = createStrokeEngine({ sizePx: o.brush.size, spacingFrac: o.brush.spacing });
        engineRef.current = eng;
        eng.begin();
        // Shift on press → straight line from the previous stroke's end (the
        // classic "shift to connect" brush chord), then continue freehand.
        const last = lastEndRef.current;
        pathRef.current = mods.shift && last ? [last.x, last.y, p.x, p.y] : [p.x, p.y];
        if (mods.shift && last) {
          stampMany(dabsAlongSegment(last.x, last.y, p.x, p.y, o.brush.size, o.brush.spacing));
        }
        stampMany(eng.move(p.x, p.y, e.pressure));
        return;
      }

      // shape tools: record the anchor, preview rubber-bands on move.
      anchorRef.current = { x: p.x, y: p.y };
      pathRef.current = [p.x, p.y];
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
        const p = map(e);
        if (p) {
          stampMany(eng.move(p.x, p.y, e.pressure));
          const path = pathRef.current;
          if (path && (path[path.length - 2] !== p.x || path[path.length - 1] !== p.y)) path.push(p.x, p.y);
        }
        return;
      }
      const anchor = anchorRef.current;
      if (!anchor) return;
      const p = map(e);
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
        const p = map(e);
        if (p) {
          stampMany(eng.move(p.x, p.y, e.pressure)); lastEndRef.current = { x: p.x, y: p.y };
          const path = pathRef.current;
          if (path && (path[path.length - 2] !== p.x || path[path.length - 1] !== p.y)) path.push(p.x, p.y);
        }
        eng.end();
        engineRef.current = null;
        const points = pathRef.current;
        pathRef.current = null;
        o.onStrokeEnd?.(points ? { tool: o.tool as 'brush' | 'eraser', points } : undefined);
        return;
      }
      const anchor = anchorRef.current;
      if (!anchor) return;
      const p = map(e) ?? anchor;
      let bx = p.x, by = p.y;
      if (o.tool === 'line') {
        const c = constrainLine(anchor.x, anchor.y, p.x, p.y, mods.shift);
        bx = c.x; by = c.y;
        stampMany(dabsForStrokePath('line', [anchor.x, anchor.y, bx, by], o.brush.size, o.brush.spacing));
        lastEndRef.current = { x: bx, y: by };
      } else if (o.tool === 'rect') {
        if (mods.shift) { const c = constrainSquare(anchor.x, anchor.y, p.x, p.y); bx = c.x; by = c.y; }
        stampMany(dabsForStrokePath('rect', [anchor.x, anchor.y, bx, by], o.brush.size, o.brush.spacing));
      } else if (o.tool === 'ellipse') {
        if (mods.shift) { const c = constrainSquare(anchor.x, anchor.y, p.x, p.y); bx = c.x; by = c.y; }
        stampMany(dabsForStrokePath('ellipse', [anchor.x, anchor.y, bx, by], o.brush.size, o.brush.spacing));
      }
      anchorRef.current = null;
      setPreview(null);
      const points = [anchor.x, anchor.y, bx, by];
      pathRef.current = null;
      o.onStrokeEnd?.({ tool: o.tool as 'line' | 'rect' | 'ellipse', points });
    },

    onMouseLeave: () => {
      const eng = engineRef.current;
      if (eng && eng.drawing()) {
        eng.end(); engineRef.current = null;
        const points = pathRef.current;
        pathRef.current = null;
        ref.current.onStrokeEnd?.(points ? { tool: ref.current.tool as 'brush' | 'eraser', points } : undefined);
      }
      anchorRef.current = null;
      pathRef.current = null;
      setPreview(null);
    },
  };

  return { handlers, preview };
}

/** Standalone size stepper so chrome buttons and the [/] keys share one path. */
export { stepSizeLadder };
export { TOOL_HOTKEY };
