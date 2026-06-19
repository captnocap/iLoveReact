/**
 * brush_studio — the reference cart for the universal paint kit
 * (runtime/paint/*). It exists so we stop reinventing brushes: drop a
 * <Paintable>, bind useBrushStroke, render <BrushKit>, done. Everything you
 * see here — brush variety, the color wheel + palette, hold-shift straight
 * lines, [/] size stepping, tool hotkeys, optimistic host-owned dabbing — is
 * kit code, not cart code.
 *
 * Phase A (this build, no host rebuild): analytic bristle shapes + solid
 * color, the full JS tool family (brush/eraser/line/rect/ellipse/pick),
 * shift-line, the canonical control vocabulary. Phase B adds the host stamp
 * pass (SVG-path / texture / shader brushes) and real blend modes + erase.
 *
 * Verify headless:  ./tools/rjit shot brush_studio --out /tmp/brush_studio.png
 */

import { Box, Col, Row, Text, Pressable, Effect, Paintable } from '@reactjit/runtime/primitives';
import { usePaintable } from '@reactjit/runtime/hooks/usePaintable';
import {
  BrushKit, useBrushStroke, useModifiers,
  DEFAULT_BRUSH, defaultPalette, stepSizeLadder, TOOL_HOTKEY, BRUSH_TOOLS,
  DARK_THEME, BRUSH_SHAPE_ID, hexToRgb01,
  type Brush, type BrushTool, type BrushShape, type Palette, type ShapePreview,
} from '@reactjit/runtime/paint';
import { useEffect, useMemo, useRef, useState } from 'react';

const TEX = 1024;            // paintable resolution
const PAPER = '#eef1f6';     // canvas base coat + what the eraser deposits
const PAPER_RGB: [number, number, number] = [0.933, 0.945, 0.965];
const T = DARK_THEME;

// A few strokes painted on mount so the canvas opens with something — and so a
// headless shot proves the whole host dab pipeline (every shape + color), not
// just the chrome. Pure host calls; no pointer needed.
function paintSampler(paint: any) {
  const shapes: BrushShape[] = ['round', 'soft', 'flat', 'filbert', 'rake', 'fan', 'spray', 'knife'];
  const colors = ['#ff4d4d', '#ff9f43', '#ffd93d', '#34d399', '#3da9ff', '#7c5cff', '#ff70cc', '#111827'];
  shapes.forEach((sh, i) => {
    const kind = BRUSH_SHAPE_ID[sh];
    const [r, g, b] = hexToRgb01(colors[i]);
    const y = 110 + i * 108;
    const aspect = sh === 'flat' || sh === 'knife' ? 3.2 : 1;
    const scatter = sh === 'spray' ? 1.2 : sh === 'fan' ? 0.2 : 0;
    for (let x = 110; x <= 915; x += 7) {
      const yy = y + Math.sin(x * 0.018) * 26;
      paint.brushColor(x, yy, 24, r, g, b, kind, 0, aspect, 0.85, 0.92, scatter, ((x * 131) % 1000) / 1000, 0, 0, 0, 0);
    }
  });
}

// Passthrough display: sample the RGBA paintable straight to the screen.
const DISPLAY = `
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = textureSampleLevel(tex, smp, in.uv, 0.0);
  return vec4f(c.rgb, 1.0);
}
`;

export default function BrushStudio() {
  const canvas = usePaintable({ id: 'brush-studio', w: TEX, h: TEX });
  const [brush, setBrush] = useState<Brush>({ ...DEFAULT_BRUSH, ink: { kind: 'color', hex: '#ff4d4d' } });
  const [tool, setTool] = useState<BrushTool>('brush');
  const [palette, setPalette] = useState<Palette>(() => defaultPalette());
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Base-coat the canvas once the <Paintable> exists, then lay down samples.
  useEffect(() => {
    canvas.paint.clearColor(PAPER_RGB[0], PAPER_RGB[1], PAPER_RGB[2], 1);
    paintSampler(canvas.paint);
  }, []);

  // Keep brush/tool in refs the hotkey closures can read without re-binding.
  const brushRef = useRef(brush); brushRef.current = brush;
  const toolRef = useRef(tool); toolRef.current = tool;

  // Tool hotkeys + [/] size stepping — wired here to show the kit's keys; any
  // cart gets them for free this way.
  const hotkeys = useMemo(() => {
    const map: Record<string, () => void> = {
      '[': () => setBrush((b) => ({ ...b, size: stepSizeLadder(b.size, -1) })),
      ']': () => setBrush((b) => ({ ...b, size: stepSizeLadder(b.size, +1) })),
    };
    for (const t of BRUSH_TOOLS) map[TOOL_HOTKEY[t]] = () => setTool(t);
    return map;
  }, []);
  useModifiers(useMemo(() => {
    const wrapped: Record<string, (m: any) => void> = {};
    for (const k of Object.keys(hotkeys)) wrapped[k] = () => hotkeys[k]();
    return wrapped;
  }, [hotkeys]));

  const mapPoint = (screenX: number, screenY: number) => {
    const r = rectRef.current;
    if (!r) return null;
    return {
      x: ((screenX - r.x) / Math.max(1, r.width)) * TEX,
      y: ((screenY - r.y) / Math.max(1, r.height)) * TEX,
    };
  };

  const { handlers, preview } = useBrushStroke({
    paint: canvas.paint,
    texW: TEX, texH: TEX,
    brush, tool, mapPoint,
    eraseColor: PAPER,
    onPickColor: (hex) => setBrush((b) => ({ ...b, ink: { kind: 'color', hex } })),
  });

  const reset = () => canvas.paint.clearColor(PAPER_RGB[0], PAPER_RGB[1], PAPER_RGB[2], 1);

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: T.page }}>
      <Col style={{ padding: 14, gap: 12 }}>
        <Text style={{ color: T.ink, fontSize: 14, fontWeight: '900' }}>Brush Studio</Text>
        <Text style={{ color: T.dim, fontSize: 10 }}>runtime/paint · drag to paint · hold SHIFT for straight lines · [ ] resize · b/e/l/r/o/i tools</Text>
        <BrushKit
          brush={brush}
          onBrushChange={setBrush}
          tool={tool}
          onToolChange={setTool}
          palette={palette}
          onPaletteChange={setPalette}
          theme={T}
        />
        <Pressable onMouseDown={reset} style={{ height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: T.control, borderWidth: 1, borderColor: T.frame }}>
          <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800' }}>Clear canvas</Text>
        </Pressable>
      </Col>

      <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: 'center', justifyContent: 'center', padding: 18 }}>
        <Pressable
          onLayout={(r: any) => { rectRef.current = r; }}
          onMouseDown={handlers.onMouseDown}
          onMouseMove={handlers.onMouseMove}
          onMouseUp={handlers.onMouseUp}
          onMouseLeave={handlers.onMouseLeave}
          style={{ width: 640, height: 640, position: 'relative', backgroundColor: PAPER, borderRadius: 10, borderWidth: 1, borderColor: T.frame, overflow: 'hidden' }}
        >
          <Paintable id={canvas.id} w={TEX} h={TEX} rgba />
          <Effect shader={DISPLAY} textures={[canvas.id]} style={{ position: 'absolute', left: 0, top: 0, width: 640, height: 640 }} />
          <ShapeOverlay preview={preview} surface={640} />
        </Pressable>
      </Box>
    </Row>
  );
}

// Rubber-band preview for the shape tools, in screen space (texture px → the
// 640px surface). Freehand brush/eraser never reach here — they paint straight
// to the host with zero React state.
function ShapeOverlay({ preview, surface }: { preview: ShapePreview | null; surface: number }) {
  if (!preview) return null;
  const s = surface / TEX;
  const ax = preview.ax * s, ay = preview.ay * s, bx = preview.bx * s, by = preview.by * s;

  if (preview.tool === 'line') {
    const dots = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      dots.push(
        <Box key={i} style={{ position: 'absolute', left: ax + (bx - ax) * f - 1, top: ay + (by - ay) * f - 1, width: 2, height: 2, borderRadius: 1, backgroundColor: T.accent }} />,
      );
    }
    return <>{dots}</>;
  }

  const left = Math.min(ax, bx), top = Math.min(ay, by);
  const w = Math.abs(bx - ax), h = Math.abs(by - ay);
  return (
    <Box style={{ position: 'absolute', left, top, width: w, height: h, borderWidth: 1, borderColor: T.accent, borderRadius: preview.tool === 'ellipse' ? Math.max(w, h) : 2, backgroundColor: '#3da9ff18' }} />
  );
}
