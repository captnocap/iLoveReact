// editors/paint/PaintSurface.tsx — the embeddable paint viewport. Hosts a
// pan-zoom Canvas showing the paint target (source image or checkerboard
// blank), one pair of GPU mask textures per layer, one PaintQuad per visible
// layer, the screen-space input overlay, the tool cursor, the lasso preview,
// the smart-click markers, and the bottom HUD.
//
// Full-viewport-safe by construction (the coverage lesson): the surface
// sizes to ITS OWN box (flexGrow + onLayout rect) — the input overlay's
// hit-region is exactly the hosted viewport, never the window. Coordinate
// discipline: SCREEN (OS events) → WORLD (__canvas_screen_to_graph) →
// SOURCE pixels, out-of-bounds rejected.
//
// Behavior reference: cart/cutout/components/Editor.tsx (read, never
// imported).

import { useMemo, useRef, useState } from 'react';
import { Box, Canvas, Effect, Graph, Image, Paintable, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { callHost } from '@reactjit/runtime/ffi';
import { GAME_CHROME } from '../../game/chrome';
import { PAINT_TUNING } from './tuning';
import { pressureRadius } from './strokes';
import {
  packTextureModeData, packCellModeData, resolveShader,
  type CustomSurface, type PaintBlendMode, type SurfaceId,
} from './surfaces';
import type { PaintEditorState } from './usePaintEditor';

const T = GAME_CHROME.tokens.color;

type Rect = { x: number; y: number; width: number; height: number };
type ToolCursor = {
  x: number; y: number; radius: number;
  kind: 'brush' | 'smart' | 'lasso' | 'refine';
  brushKind?: string;
  angleDeg?: number;
  aspect?: number;
  /** the active paint color (slot 0) — fills the ring in paint mode */
  color?: string | null;
  /** screen-x of the mirror twin ring when mirror painting is on */
  mirrorX?: number | null;
};

function screenToWorld(sx: number, sy: number, rect: Rect): { gx: number; gy: number } | null {
  const vpcx = rect.x + rect.width / 2;
  const vpcy = rect.y + rect.height / 2;
  return callHost<{ gx: number; gy: number } | null>(
    '__canvas_screen_to_graph', null, sx, sy, vpcx, vpcy,
  );
}

// ── PaintQuad — one layer's surface as a single Effect draw ──────────────────

export function PaintQuad(props: {
  /** texture mode: the layer's base mask paintable (full-res R8) */
  paintableId?: string;
  /** texture mode: the brush-override paintable composed in-shader */
  overrideId?: string;
  /** cells mode: coarse cell set (used when no paintableId) */
  cells?: Set<number>;
  gridSize?: number;
  worldW: number;
  worldH: number;
  mode?: SurfaceId;
  customSurfaces?: CustomSurface[];
  hueOffset?: number;
  phaseOffset?: number;
  dim?: number;
  colors?: string[];
  blend?: PaintBlendMode;
}) {
  const {
    paintableId, overrideId, cells,
    gridSize = PAINT_TUNING.overlayRes,
    worldW, worldH,
    mode = PAINT_TUNING.layerLook.defaultSurface,
    customSurfaces = [],
    hueOffset = 0, phaseOffset = 0,
    dim = PAINT_TUNING.layerLook.defaultDim,
    colors, blend = 'normal',
  } = props;
  const textureMode = !!paintableId;
  const packed = useMemo(
    () => textureMode
      ? packTextureModeData({ gridSize, dim, hueOffset, phaseOffset, blend, colors })
      : packCellModeData({ gridSize, dim, hueOffset, phaseOffset, blend, colors }, cells),
    [textureMode, cells, gridSize, dim, hueOffset, phaseOffset, colors, blend],
  );
  const shader = resolveShader(mode, textureMode, customSurfaces);
  // Texture-mode slot order [mask, override]; a missing override falls
  // through to the framework dummy 1x1 (samples 0 → always "untouched").
  const textures = textureMode ? [paintableId!, overrideId ?? ''] : undefined;
  return (
    <Effect
      shader={shader}
      data={packed}
      textures={textures}
      style={{ position: 'absolute', left: 0, top: 0, width: worldW, height: worldH }}
    />
  );
}

// ── The viewport ─────────────────────────────────────────────────────────────

// `underlay` (post-capture addition, CUTOUTQOL2-0605): the paint target when
// the host paints on something that is not an image FILE — e.g. /cutout
// painting on a registry material (an <Effect> sized to dims). Rendered in
// the source slot when no srcPath exists; absent → the blank checkerboard,
// exactly the pre-addition behavior.
export function PaintSurface({ s, style, underlay }: { s: PaintEditorState; style?: Record<string, unknown>; underlay?: any }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [cursor, setCursor] = useState<ToolCursor | null>(null);
  const drawing = useRef(false);
  const lastCursorBump = useRef(0);
  const hasVisibleImageLayer = s.layers.some((layer) => !layer.config.muted && !!layer.image);

  const toSource = (px: number, py: number) => {
    if (!rect) return null;
    const w = screenToWorld(px, py, rect);
    if (!w) return null;
    const sx = w.gx + s.dims.w / 2;
    const sy = w.gy + s.dims.h / 2;
    if (sx < 0 || sy < 0 || sx >= s.dims.w || sy >= s.dims.h) return null;
    return { sx, sy };
  };

  // The canvas pan-ZOOMS: a dab is SOURCE pixels, the cursor ring is SCREEN
  // pixels. Derive the live zoom from two screen probes through the same
  // host transform the dab coordinates use — no new bindings.
  const measureZoom = (px: number, py: number): number | null => {
    if (!rect) return null;
    const a = screenToWorld(px, py, rect);
    const b = screenToWorld(px + 16, py, rect);
    if (!a || !b) return null;
    const d = Math.abs(b.gx - a.gx);
    return d > 1e-6 ? 16 / d : null;
  };

  const updateCursor = (px: number, py: number, hit: { sx: number; sy: number } | null, force = false) => {
    if (!rect || !hit) { setCursor(null); return; }
    const now = Date.now();
    if (!force && now - lastCursorBump.current < PAINT_TUNING.cursor.throttleMs) return;
    lastCursorBump.current = now;
    const localX = px - rect.x;
    const localY = py - rect.y;
    const C = PAINT_TUNING.cursor;
    if (s.tool === 'smart') { setCursor({ x: localX, y: localY, radius: C.smartRadius, kind: 'smart' }); return; }
    if (s.tool === 'lasso') { setCursor({ x: localX, y: localY, radius: C.lassoRadius, kind: 'lasso' }); return; }
    // THE HONEST RING ("an actual live brush preview so i can see where im
    // painting"): the dab the engine will paint is pressureRadius(brushPx)
    // SOURCE pixels — the no-pressure fallback radius, which the stock curve
    // makes exactly brushPx (base 0.35 + fallback 0.5 × gain 1.3 = 1.0); if
    // the P2 pressure curve is retuned the ring follows the DAB, not the
    // label. Source → screen via the live zoom. No display clamp — the old
    // clamp papered over the zoom lie.
    const zoom = measureZoom(px, py) ?? 1;
    const radius = Math.max(1, pressureRadius(s.brushPx, undefined) * zoom);
    const layer = s.activeLayer >= 0 && s.activeLayer < s.layers.length ? s.layers[s.activeLayer] : null;
    const slot0 = (layer?.config.colors ?? s.defaults.colors)[0] ?? '#ffffff';
    // mirror on → the engine paints a twin at x' = w − sx; preview it too
    let mirrorX: number | null = null;
    if (s.mirror) {
      const mx = s.dims.w - hit.sx;
      if (Math.abs(mx - hit.sx) > PAINT_TUNING.mirrorMinSeparationPx) {
        mirrorX = localX + (mx - hit.sx) * zoom;
      }
    }
    setCursor({
      x: localX, y: localY, radius,
      kind: s.tool === 'refine' ? 'refine' : 'brush',
      brushKind: s.brush.kind,
      angleDeg: s.brush.angleDeg,
      aspect: s.brush.aspect,
      color: s.mode === 'erase' ? slot0 : null,
      mirrorX,
    });
  };

  const updateHoverCursor = (p: any, force = false) => {
    if (typeof p?.x !== 'number' || typeof p?.y !== 'number') return null;
    const hit = toSource(p.x, p.y);
    updateCursor(p.x, p.y, hit, force);
    return hit;
  };

  return (
    <Box
      style={{
        flexGrow: 1, flexBasis: 0, minWidth: 0,
        backgroundColor: T.page,
        position: 'relative',
        overflow: 'hidden',
        ...(style ?? {}),
      }}
      onLayout={(r: any) => setRect(r)}
    >
      <Canvas style={{ width: '100%', height: '100%' }}>
        <Canvas.Node gx={0} gy={0} gw={s.dims.w} gh={s.dims.h}>
          {s.srcPath ? (
            <Image source={s.srcPath} style={{ width: s.dims.w, height: s.dims.h }} />
          ) : underlay ? (
            underlay
          ) : hasVisibleImageLayer ? null : (
            <BlankSurface w={s.dims.w} h={s.dims.h} />
          )}
          {/* One full-res texture pair per layer, mounted for EVERY layer
              (muted ones included) so masks survive mute/reorder and stay
              readable at export. The quad that DRAWS a layer skips when
              muted. */}
          {s.layers.map((layer) => (
            <Paintable key={`base:${layer.id}`} id={s.baseIdOf(layer)} w={s.dims.w} h={s.dims.h} />
          ))}
          {s.layers.map((layer) => (
            <Paintable key={`brush:${layer.id}`} id={s.brushIdOf(layer)} w={s.dims.w} h={s.dims.h} />
          ))}
          {s.layers.map((layer) => (
            layer.config.muted ? null : [
              layer.image ? (
                <Image key={`img:${layer.id}`} source={layer.image.path} style={{ width: s.dims.w, height: s.dims.h }} />
              ) : null,
              <PaintQuad
                key={`q:${layer.id}`}
                paintableId={s.baseIdOf(layer)}
                overrideId={s.brushIdOf(layer)}
                worldW={s.dims.w}
                worldH={s.dims.h}
                mode={layer.config.mode}
                customSurfaces={s.customSurfaces}
                hueOffset={layer.config.hueOffset}
                phaseOffset={layer.config.phaseOffset}
                dim={layer.config.dim}
                colors={layer.config.colors}
                blend={layer.config.blend ?? 'normal'}
              />,
            ]
          ))}
          <ClickMarkers s={s} />
          <LassoPreview s={s} />
        </Canvas.Node>
      </Canvas>
      <PaintHud s={s} />
      {/* Input overlay in SCREEN space (not inside Canvas.Node) so the
          hit-region is exactly the hosted viewport. The hand tool skips it
          and the Canvas gets raw pan/zoom input. */}
      {s.tool !== 'hand' ? (
        <Pressable
          style={{
            position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
            backgroundColor: '#00000001',
          }}
          onMouseEnter={(p: any) => { updateHoverCursor(p, true); }}
          onPointerMove={(p: any) => {
            const hit = updateHoverCursor(p);
            if (!drawing.current || !hit) return;
            s.paintAtSource(hit.sx, hit.sy, p.pressure);
          }}
          onMouseDown={(p: any) => {
            const hit = updateHoverCursor(p, true);
            if (!hit) return;
            if (s.tool === 'smart') {
              if (!s.smartAvailable) return;
              const label = s.mode === 'restore' ? 'reject' : 'keep';
              void s.addClick(hit.sx, hit.sy, label);
              return;
            }
            if (s.tool === 'lasso') {
              s.addLassoPoint(hit.sx, hit.sy);
              return;
            }
            s.beginStroke();
            drawing.current = true;
            s.paintAtSource(hit.sx, hit.sy, p.pressure);
          }}
          onMouseMove={(p: any) => {
            const hit = updateHoverCursor(p);
            if (!drawing.current || !hit) return;
            s.paintAtSource(hit.sx, hit.sy, p.pressure);
          }}
          onMouseUp={() => { drawing.current = false; s.endStroke(); }}
          onMouseLeave={() => {
            setCursor(null);
            if (drawing.current) { drawing.current = false; s.endStroke(); }
          }}
        />
      ) : null}
      {cursor && s.tool !== 'hand' ? <BrushCursor cursor={cursor} mode={s.mode} /> : null}
    </Box>
  );
}

// ── Cursor / HUD / previews ──────────────────────────────────────────────────

/** hex6 + alpha byte → hex8; non-hex6 inputs (named colors, hex8) pass null
 *  so the caller falls back to the mode tint */
function withAlpha(hex: string | null | undefined, alpha: string): string | null {
  return hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex + alpha : null;
}

function BrushCursor({ cursor, mode }: { cursor: ToolCursor; mode: string }) {
  const color = cursor.kind === 'smart' || cursor.kind === 'refine'
    ? T.accent
    : cursor.kind === 'lasso'
      ? T.good
      : mode === 'erase' ? T.warn : T.good;
  if (cursor.kind === 'smart' || cursor.kind === 'lasso') {
    return (
      <Box style={{
        position: 'absolute',
        left: cursor.x - cursor.radius,
        top: cursor.y - cursor.radius,
        width: cursor.radius * 2,
        height: cursor.radius * 2,
        borderRadius: cursor.radius,
        borderWidth: 1,
        borderColor: color,
        backgroundColor: '#00000001',
        zIndex: 8,
      }}>
        {cursor.kind === 'smart' ? (
          <>
            <Box style={{ position: 'absolute', left: cursor.radius - 1, top: -6, width: 2, height: 8, backgroundColor: color }} />
            <Box style={{ position: 'absolute', left: cursor.radius - 1, bottom: -6, width: 2, height: 8, backgroundColor: color }} />
            <Box style={{ position: 'absolute', left: -6, top: cursor.radius - 1, width: 8, height: 2, backgroundColor: color }} />
            <Box style={{ position: 'absolute', right: -6, top: cursor.radius - 1, width: 8, height: 2, backgroundColor: color }} />
          </>
        ) : null}
      </Box>
    );
  }
  // Brush / refine: the ring IS the dab footprint (size from updateCursor's
  // zoom math). Mode hue on the border; in paint mode the fill shows WHAT
  // will paint — the active slot-0 color at low alpha.
  const fill = (mode === 'erase' ? withAlpha(cursor.color, '2e') : null)
    ?? (mode === 'erase' ? '#ff9f431f' : '#34d3991f');
  const ring = (cx: number, twin: boolean) => {
    const aspect = Math.max(0.2, cursor.aspect ?? 1);
    const extent = cursor.radius * Math.max(1, aspect) + 3;
    const box = extent * 2;
    const d = brushCursorPath(box / 2, box / 2, cursor.radius, cursor.brushKind ?? 'round', aspect, cursor.angleDeg ?? 0);
    return (
      <Box key={twin ? 'twin' : 'ring'} style={{
        position: 'absolute',
        left: cx - extent,
        top: cursor.y - extent,
        width: box,
        height: box,
        zIndex: 8,
        opacity: twin ? 0.55 : 1,
      }}>
        <Graph style={{ width: box, height: box }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
          <Graph.Path d={d} fill={fill} stroke={color} strokeWidth={1} />
        </Graph>
      </Box>
    );
  };
  return (
    <>
      {ring(cursor.x, false)}
      {typeof cursor.mirrorX === 'number' ? ring(cursor.mirrorX, true) : null}
    </>
  );
}

function rot(x: number, y: number, cx: number, cy: number, deg: number): [number, number] {
  const a = deg * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * ca - dy * sa, cy + dx * sa + dy * ca];
}

function polyPath(points: Array<[number, number]>): string {
  const [first, ...rest] = points;
  return `M ${first[0]} ${first[1]}${rest.map((p) => ` L ${p[0]} ${p[1]}`).join('')} Z`;
}

function cursorEllipse(cx: number, cy: number, rx: number, ry: number, deg: number, n = 28): string {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * Math.PI * 2;
    pts.push(rot(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, cx, cy, deg));
  }
  return polyPath(pts);
}

function cursorRect(cx: number, cy: number, w: number, h: number, deg: number, skew = 0): string {
  const pts: Array<[number, number]> = [
    [cx - w / 2 + skew, cy - h / 2],
    [cx + w / 2 + skew, cy - h / 2],
    [cx + w / 2 - skew, cy + h / 2],
    [cx - w / 2 - skew, cy + h / 2],
  ].map((p) => rot(p[0], p[1], cx, cy, deg));
  return polyPath(pts);
}

function brushCursorPath(cx: number, cy: number, r: number, kind: string, aspect: number, angleDeg: number): string {
  switch (kind) {
    case 'square':
      return cursorRect(cx, cy, r * 2 * aspect, r * 2, angleDeg);
    case 'flat':
      return cursorRect(cx, cy, r * 2 * Math.max(aspect, 1.6), r * 0.84, angleDeg);
    case 'angle':
      return cursorRect(cx, cy, r * 2 * Math.max(aspect, 1.5), r * 0.92, angleDeg, r * 0.38);
    case 'knife':
      return cursorRect(cx, cy, r * 2 * Math.max(aspect, 2.8), r * 0.44, angleDeg, r * 0.18);
    case 'filbert':
      return cursorEllipse(cx, cy, r * Math.max(aspect, 1.15), r * 0.62, angleDeg);
    case 'rake':
    case 'fan':
    case 'dry':
      return cursorEllipse(cx, cy, r * Math.max(aspect, 1.3), r, angleDeg);
    case 'soft':
    case 'spray':
    case 'round':
    default:
      return cursorEllipse(cx, cy, r, r, angleDeg);
  }
}

function PaintHud({ s }: { s: PaintEditorState }) {
  const action = s.tool === 'hand'
    ? 'Drag canvas to pan. Wheel to zoom.'
    : s.tool === 'smart'
      ? (s.mode === 'erase' ? 'Click to add the region.' : 'Click a false-positive to subtract it.')
      : s.tool === 'lasso'
        ? 'Click vertices. Return to the first point or double-click to close.'
        : s.tool === 'refine'
          ? (s.mode === 'erase' ? 'Drag to expand through low-gradient areas.' : 'Drag to shrink through low-gradient areas.')
          : (s.mode === 'erase' ? 'Drag to paint.' : 'Drag painted areas to restore.');
  const activeName = s.activeLayer >= 0 && s.activeLayer < s.layers.length
    ? s.layers[s.activeLayer].name
    : 'no layer';
  const dotColor = s.tool === 'hand' ? T.dim
    : s.tool === 'smart' || s.tool === 'refine' ? T.accent
    : s.tool === 'lasso' ? T.good
    : T.ink;
  const modeColor = s.mode === 'erase' ? T.warn : T.good;
  return (
    <Row style={{
      position: 'absolute',
      left: 14,
      bottom: 14,
      maxWidth: 520,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: '#0e131bd0',
      borderWidth: 1,
      borderColor: T.frame,
      alignItems: 'center',
      gap: 8,
    }}>
      <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor }} />
      <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
        {s.tool.toUpperCase()}
      </Text>
      <Box style={{ width: 1, height: 10, backgroundColor: T.frame }} />
      <Text style={{ color: modeColor, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
        {s.mode.toUpperCase()}
      </Text>
      <Box style={{ width: 1, height: 10, backgroundColor: T.frame }} />
      <Text style={{ color: T.accent, fontSize: 10, fontWeight: '800' }} numberOfLines={1}>
        {activeName}
      </Text>
      <Box style={{ width: 1, height: 10, backgroundColor: T.frame }} />
      <Text style={{ color: T.dim, fontSize: 10 }} numberOfLines={1}>
        {s.smartBusy ? 'smart-selecting…' : action}
      </Text>
    </Row>
  );
}

function lassoPath(points: { x: number; y: number }[], close: boolean): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y}${rest.map((p) => ` L ${p.x} ${p.y}`).join('')}${close ? ' Z' : ''}`;
}

function LassoPreview({ s }: { s: PaintEditorState }) {
  if (s.lassoPoints.length === 0) return null;
  const r = Math.max(5, Math.min(s.dims.w, s.dims.h) * 0.005);
  const d = lassoPath(s.lassoPoints, false);
  const closed = s.lassoPoints.length >= 3 ? lassoPath(s.lassoPoints, true) : '';
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: s.dims.w, height: s.dims.h }}>
      {closed ? <Canvas.Path d={closed} fill={T.good} fillOpacity={0.12} stroke="none" /> : null}
      <Canvas.Path d={d} fill="none" stroke={T.good} strokeWidth={2} />
      {s.lassoPoints.map((p, i) => (
        <Box
          key={i}
          style={{
            position: 'absolute',
            left: p.x - r,
            top: p.y - r,
            width: r * 2,
            height: r * 2,
            borderRadius: r,
            backgroundColor: i === 0 ? T.warn : T.good,
            borderWidth: Math.max(1, r * 0.25),
            borderColor: '#ffffff',
          }}
        />
      ))}
    </Box>
  );
}

function ClickMarkers({ s }: { s: PaintEditorState }) {
  if (s.clicks.length === 0) return null;
  const r = Math.max(8, Math.min(s.dims.w, s.dims.h) * 0.008);
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: s.dims.w, height: s.dims.h }}>
      {s.clicks.map((c, i) => (
        <Box
          key={i}
          style={{
            position: 'absolute',
            left: c.x - r,
            top: c.y - r,
            width: r * 2,
            height: r * 2,
            borderRadius: r,
            backgroundColor: c.label === 'keep' ? T.good : T.bad,
            borderWidth: Math.max(2, r * 0.25),
            borderColor: '#ffffff',
          }}
        />
      ))}
    </Box>
  );
}

function BlankSurface({ w, h }: { w: number; h: number }) {
  const cell = PAINT_TUNING.canvas.checkerCell;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const tiles = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      tiles.push(
        <Box
          key={`${x}:${y}`}
          style={{
            position: 'absolute',
            left: x * cell,
            top: y * cell,
            width: cell,
            height: cell,
            backgroundColor: (x + y) % 2 === 0 ? '#161c28' : '#101620',
          }}
        />
      );
    }
  }
  return (
    <Box style={{
      position: 'absolute',
      left: 0,
      top: 0,
      width: w,
      height: h,
      backgroundColor: T.page,
      borderWidth: 1,
      borderColor: T.frame,
      overflow: 'hidden',
    }}>
      {tiles}
    </Box>
  );
}
