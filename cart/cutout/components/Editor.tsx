// Editor — the center work area. Canvas-based viewport showing the source
// image at native resolution; pan/zoom via the Canvas primitive; brush
// input rides a Pressable child inside the same Canvas.Node.
//
// Each layer in the stack mounts its own full-resolution mask texture
// (<Paintable>) plus, when visible, one texture-mode <MaskQuad> drawing
// that layer's surface. Tools never touch a global buffer — brush, lasso,
// refine and smart-select all write through state into the ACTIVE layer's
// texture, so switching tools never disturbs the stack.
//
// Coordinate spaces:
//   - SCREEN: raw mouse event coords from the OS
//   - WORLD:  Canvas internal coord system, centered at (0,0)
//   - SOURCE: image pixel coords (0..srcW, 0..srcH)
// The Canvas.Node sits at gx=0,gy=0 with gw=srcW, gh=srcH, so image-pixel
// (px,py) maps to world (px - srcW/2, py - srcH/2).

import { Box, Canvas, Col, Image, Paintable, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { callHost } from '@reactjit/runtime/ffi';
import { useRef, useState } from 'react';
import { COLORS } from '../theme';
import type { CutoutState } from '../state';
import { OVERLAY_RES } from '../state';
import { MaskQuad } from './MaskQuad';

type Rect = { x: number; y: number; width: number; height: number };
type ToolCursor = { x: number; y: number; radius: number; kind: 'brush' | 'smart' | 'lasso' | 'refine' };

function screenToWorld(
  sx: number, sy: number, rect: Rect,
): { gx: number; gy: number } | null {
  const vpcx = rect.x + rect.width / 2;
  const vpcy = rect.y + rect.height / 2;
  return callHost<{ gx: number; gy: number } | null>(
    '__canvas_screen_to_graph', null, sx, sy, vpcx, vpcy,
  );
}

export function Editor({ s }: { s: CutoutState }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [cursor, setCursor] = useState<ToolCursor | null>(null);
  const drawing = useRef(false);
  const lastCursorBump = useRef(0);
  const lastLassoClick = useRef<{ sx: number; sy: number; at: number } | null>(null);
  const shaderFor = (id: string) => s.customSurfaces.find((fx) => fx.id === id)?.shader;

  const toSource = (px: number, py: number) => {
    if (!rect || !s.srcDims) return null;
    const w = screenToWorld(px, py, rect);
    if (!w) return null;
    const sx = w.gx + s.srcDims.w / 2;
    const sy = w.gy + s.srcDims.h / 2;
    if (sx < 0 || sy < 0 || sx >= s.srcDims.w || sy >= s.srcDims.h) return null;
    return { sx, sy };
  };

  const updateHoverCursor = (p: any, force = false) => {
    if (typeof p?.x !== 'number' || typeof p?.y !== 'number') return null;
    const hit = toSource(p.x, p.y);
    updateCursor(p.x, p.y, hit, force);
    return hit;
  };

  const updateCursor = (px: number, py: number, hit: { sx: number; sy: number } | null, force = false) => {
    if (!rect || !s.srcDims || !hit) { setCursor(null); return; }
    const now = Date.now();
    if (!force && now - lastCursorBump.current < 60) return;
    lastCursorBump.current = now;
    const localX = px - rect.x;
    const localY = py - rect.y;
    if (s.tool === 'smart') {
      setCursor({ x: localX, y: localY, radius: 12, kind: 'smart' });
      return;
    }
    if (s.tool === 'lasso' || s.tool === 'refine') {
      setCursor({ x: localX, y: localY, radius: s.tool === 'lasso' ? 8 : Math.max(4, Math.min(180, s.brushPx)), kind: s.tool });
      return;
    }
    const radius = Math.max(4, Math.min(180, s.brushPx));
    setCursor({ x: localX, y: localY, radius, kind: 'brush' });
  };

  return (
    <Box
      style={{
        flexGrow: 1, flexBasis: 0, minWidth: 0,
        backgroundColor: COLORS.bg,
        position: 'relative',
        overflow: 'hidden',
      }}
      onLayout={(r: any) => setRect(r)}
    >
      {s.srcDims ? (
        <Canvas style={{ width: '100%', height: '100%' }}>
          <Canvas.Node gx={0} gy={0} gw={s.srcDims.w} gh={s.srcDims.h}>
            {s.srcPath ? (
              <Image source={s.srcPath} style={{ width: s.srcDims.w, height: s.srcDims.h }} />
            ) : (
              <BlankSurface w={s.srcDims.w} h={s.srcDims.h} />
            )}
            {/* One full-res mask texture per layer. Mounted for EVERY layer
               (even muted ones) so the texture survives mute/reorder and is
               always readable at export. The MaskQuad that draws it is
               skipped when the layer is muted. */}
            {s.layers.map((layer) => (
              <Paintable key={`base:${layer.id}`} id={layer.baseId} w={s.srcDims!.w} h={s.srcDims!.h} />
            ))}
            {s.layers.map((layer) => (
              <Paintable key={`brush:${layer.id}`} id={layer.brushId} w={s.srcDims!.w} h={s.srcDims!.h} />
            ))}
            {s.layers.map((layer) => (
              layer.config.muted ? null : (
                <MaskQuad
                  key={`q:${layer.id}`}
                  paintableId={layer.baseId}
                  overrideId={layer.brushId}
                  gridSize={OVERLAY_RES}
                  worldW={s.srcDims!.w}
                  worldH={s.srcDims!.h}
                  mode={layer.config.mode}
                  customShader={shaderFor(layer.config.mode)}
                  hueOffset={layer.config.hueOffset}
                  phaseOffset={layer.config.phaseOffset}
                  dim={layer.config.dim}
                  colors={layer.config.colors}
                  blend={layer.config.blend ?? 'normal'}
                />
              )
            ))}
            <ClickMarkers s={s} />
            <LassoPreview s={s} />
          </Canvas.Node>
        </Canvas>
      ) : (
        <EmptyState />
      )}
      {s.srcDims ? <EditorHud s={s} /> : null}
      {/* Click handler overlays the editor in screen-space (NOT inside
          Canvas.Node) so its hit-region is exactly the viewport. The HAND
          tool skips the overlay so the Canvas gets raw pan/zoom input. */}
      {s.srcDims && s.tool !== 'hand' ? (
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
              if (s.isBlank) return;
              const label = s.mode === 'restore' ? 'reject' : 'keep';
              void s.addClick(hit.sx, hit.sy, label);
              return;
            }
            if (s.tool === 'lasso') {
              const now = Date.now();
              const prev = lastLassoClick.current;
              const doubleClick = !!prev
                && now - prev.at <= 320
                && (hit.sx - prev.sx) * (hit.sx - prev.sx) + (hit.sy - prev.sy) * (hit.sy - prev.sy) <= 64;
              lastLassoClick.current = { sx: hit.sx, sy: hit.sy, at: now };
              if (doubleClick) s.commitLasso();
              else s.addLassoPoint(hit.sx, hit.sy);
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
          onMouseLeave={() => { setCursor(null); if (drawing.current) { drawing.current = false; s.endStroke(); } }}
        />
      ) : null}
      {cursor && s.tool !== 'hand' ? <BrushCursor cursor={cursor} mode={s.mode} /> : null}
    </Box>
  );
}

function BrushCursor({ cursor, mode }: { cursor: ToolCursor; mode: string }) {
  const color = cursor.kind === 'smart'
    ? COLORS.accent
    : cursor.kind === 'lasso'
      ? COLORS.good
      : cursor.kind === 'refine'
        ? COLORS.accent
    : mode === 'erase'
      ? COLORS.warn
      : COLORS.good;
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
      backgroundColor: mode === 'erase' ? '#ff9f431f' : '#34d3991f',
      zIndex: 8,
    }} />
  );
}

function EditorHud({ s }: { s: CutoutState }) {
  const action = s.tool === 'hand'
    ? 'Drag canvas to pan. Wheel or trackpad to zoom.'
    : s.tool === 'smart'
      ? (s.mode === 'erase'
          ? 'Click to add the region to the cutout.'
          : 'Click a false-positive to subtract it.')
      : s.tool === 'lasso'
        ? 'Click vertices. Return to the first point or double-click to close.'
        : s.tool === 'refine'
          ? (s.mode === 'erase'
              ? 'Drag to expand the mask through low-gradient areas.'
              : 'Drag to shrink the mask through low-gradient areas.')
      : (s.mode === 'erase'
          ? 'Drag over background to remove.'
          : 'Drag removed areas to restore.');
  const activeName = s.activeLayer >= 0 && s.activeLayer < s.layers.length
    ? s.layers[s.activeLayer].name
    : 'no layer';
  const dotColor = s.tool === 'hand' ? COLORS.inkMuted
    : s.tool === 'smart' ? COLORS.accent
    : s.tool === 'lasso' ? COLORS.good
    : s.tool === 'refine' ? COLORS.accent
    : COLORS.ink;
  const modeColor = s.mode === 'erase' ? COLORS.warn : COLORS.good;
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
      borderColor: COLORS.border,
      alignItems: 'center',
      gap: 8,
    }}>
      <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor }} />
      <Text style={{ color: COLORS.inkDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
        {s.tool.toUpperCase()}
      </Text>
      <Box style={{ width: 1, height: 10, backgroundColor: COLORS.border }} />
      <Text style={{ color: modeColor, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
        {s.mode.toUpperCase()}
      </Text>
      <Box style={{ width: 1, height: 10, backgroundColor: COLORS.border }} />
      <Text style={{ color: COLORS.accent, fontSize: 10, fontWeight: '800' }} numberOfLines={1}>
        {activeName}
      </Text>
      <Box style={{ width: 1, height: 10, backgroundColor: COLORS.border }} />
      <Text style={{ color: COLORS.inkDim, fontSize: 10 }} numberOfLines={1}>
        {action}
      </Text>
    </Row>
  );
}

function lassoPath(points: { x: number; y: number }[], close: boolean): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y}${rest.map((p) => ` L ${p.x} ${p.y}`).join('')}${close ? ' Z' : ''}`;
}

function LassoPreview({ s }: { s: CutoutState }) {
  if (!s.srcDims || s.lassoPoints.length === 0) return null;
  const r = Math.max(5, Math.min(s.srcDims.w, s.srcDims.h) * 0.005);
  const d = lassoPath(s.lassoPoints, false);
  const closed = s.lassoPoints.length >= 3 ? lassoPath(s.lassoPoints, true) : '';
  return (
    <Box style={{
      position: 'absolute', left: 0, top: 0,
      width: s.srcDims.w, height: s.srcDims.h,
    }}>
      {closed ? <Canvas.Path d={closed} fill={COLORS.good} fillOpacity={0.12} stroke="none" /> : null}
      <Canvas.Path d={d} fill="none" stroke={COLORS.good} strokeWidth={2} />
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
            backgroundColor: i === 0 ? COLORS.warn : COLORS.good,
            borderWidth: Math.max(1, r * 0.25),
            borderColor: '#ffffff',
          }}
        />
      ))}
    </Box>
  );
}

function BlankSurface({ w, h }: { w: number; h: number }) {
  const cell = 32;
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
      backgroundColor: COLORS.bg,
      borderWidth: 1,
      borderColor: COLORS.borderStrong,
      overflow: 'hidden',
    }}>
      {tiles}
    </Box>
  );
}

// ClickMarkers — small colored dots showing where the active layer's
// smart-select clicks went. Visually persistent so the user knows where
// they've already poked.
function ClickMarkers({ s }: { s: CutoutState }) {
  if (!s.srcDims || s.clicks.length === 0) return null;
  const r = Math.max(8, Math.min(s.srcDims.w, s.srcDims.h) * 0.008);
  return (
    <Box style={{
      position: 'absolute', left: 0, top: 0,
      width: s.srcDims.w, height: s.srcDims.h,
    }}>
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
            backgroundColor: c.label === 'keep' ? COLORS.good : COLORS.bad,
            borderWidth: Math.max(2, r * 0.25),
            borderColor: '#ffffff',
          }}
        />
      ))}
    </Box>
  );
}

function EmptyState() {
  return (
    <Box style={{
      position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Col style={{
        width: 460,
        paddingHorizontal: 30,
        paddingTop: 28,
        paddingBottom: 34,
        borderRadius: 8,
        backgroundColor: COLORS.panel,
        borderWidth: 1,
        borderColor: COLORS.borderStrong,
        gap: 18,
      }}>
        <Col style={{ gap: 6, alignItems: 'center' }}>
          <Text style={{ color: COLORS.ink, fontSize: 18, lineHeight: 22, fontWeight: '800' }}>
            Start with an image
          </Text>
          <Text style={{ color: COLORS.inkDim, fontSize: 12, lineHeight: 16 }}>
            Use Pick image or drop a file here.
          </Text>
        </Col>
        <Col style={{ gap: 12 }}>
          <Step n="1" title="Import" body="Choose a PNG, JPG, WebP, GIF, BMP, or TIFF." />
          <Step n="2" title="Cut" body="Use Smart for broad regions, then Brush to clean edges." />
          <Step n="3" title="Export" body="Save a full PNG cutout or 64 / 128 / 512 pixel-icon JSON." />
        </Col>
      </Col>
    </Box>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <Row style={{ gap: 12, alignItems: 'center', minHeight: 36 }}>
      <Box style={{ width: 22, flexShrink: 0 }} />
      <Box style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: COLORS.panelHi,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: COLORS.borderStrong,
      }}>
        <Text style={{ color: COLORS.accent, fontSize: 11, fontWeight: '800' }}>{n}</Text>
      </Box>
      <Col style={{ gap: 3, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <Text style={{ color: COLORS.ink, fontSize: 12, lineHeight: 15, fontWeight: '800' }}>
          {title}
        </Text>
        <Text style={{ color: COLORS.inkDim, fontSize: 11, lineHeight: 15 }} numberOfLines={1}>
          {body}
        </Text>
      </Col>
    </Row>
  );
}
