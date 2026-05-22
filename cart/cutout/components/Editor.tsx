// Editor — the center work area. Canvas-based viewport showing the source
// image at native resolution; pan/zoom via the Canvas primitive; brush
// input rides a Pressable child inside the same Canvas.Node.
//
// Coordinate spaces (subtle, document carefully):
//   - SCREEN: raw mouse event coords from the OS, in browser pixels
//   - WORLD:  Canvas internal coord system, centered at (0,0), units = ?
//   - SOURCE: image pixel coords (0..srcW, 0..srcH)
//
// The Canvas.Node sits at gx=0,gy=0 (its center on world origin) with
// gw=srcW, gh=srcH. So an image-pixel at (px, py) corresponds to world
// (px - srcW/2, py - srcH/2). screenToWorld() does the round-trip:
//   screen → screenToGraph host fn → world (gx, gy)
//   world  → source: (gx + srcW/2, gy + srcH/2)

import { Box, Canvas, Col, Image, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { callHost } from '@reactjit/runtime/ffi';
import { useRef, useState } from 'react';
import { COLORS } from '../theme';
import type { CutoutState } from '../state';
import { OVERLAY_RES } from '../state';
import { rowRuns } from '../mask';
import { MaskQuad } from './MaskQuad';

type Rect = { x: number; y: number; width: number; height: number };
type ToolCursor = { x: number; y: number; radius: number; kind: 'brush' | 'smart' };

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
  const shaderFor = (id: string) => s.customSurfaces.find((fx) => fx.id === id)?.shader;

  const toSource = (px: number, py: number) => {
    if (!rect || !s.srcDims) return null;
    const w = screenToWorld(px, py, rect);
    if (!w) return null;
    const sx = w.gx + s.srcDims.w / 2;
    const sy = w.gy + s.srcDims.h / 2;
    // Reject clicks outside the image bounds — otherwise the user paints
    // "ghost" pixels into clamped edge regions.
    if (sx < 0 || sy < 0 || sx >= s.srcDims.w || sy >= s.srcDims.h) return null;
    return { sx, sy };
  };

  const updateCursor = (px: number, py: number, hit: { sx: number; sy: number } | null, force = false) => {
    if (!rect || !s.srcDims) {
      setCursor(null);
      return;
    }
    if (!hit) {
      setCursor(null);
      return;
    }
    const now = Date.now();
    if (!force && now - lastCursorBump.current < 60) return;
    lastCursorBump.current = now;
    const localX = px - rect.x;
    const localY = py - rect.y;
    if (s.tool === 'smart') {
      setCursor({ x: localX, y: localY, radius: 12, kind: 'smart' });
      return;
    }
    // Keep cursor rendering cheap. The actual brush hit math above already
    // converts through canvas space; the outline is visual feedback and is
    // throttled like mask resampling to avoid a render per mouse packet.
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
            {/* Global overlay paints ONLY the brush-owned cells. Smart-
               layer regions render through their own per-layer MaskQuads
               below — if we painted the combined mask here too, the
               global FX would double-paint over per-layer FX and mute
               would have no visible effect. */}
            {s.brushOnlyOverlayCells.size > 0 ? (
              <MaskQuad
                cells={s.brushOnlyOverlayCells}
                gridSize={OVERLAY_RES}
                worldW={s.srcDims.w}
                worldH={s.srcDims.h}
                mode={s.effectMode}
                customShader={shaderFor(s.effectMode)}
                hueOffset={s.effectHueOffset}
                phaseOffset={s.effectPhaseOffset}
                dim={s.effectDim}
                colors={s.effectColors}
              />
            ) : null}
            {s.layers.map((cells, i) => {
              const cfg = s.layerConfigs[i];
              if (!cfg || cfg.muted || cells.size === 0) return null;
              return (
                <MaskQuad
                  key={i}
                  cells={cells}
                  gridSize={s.overlayRes}
                  worldW={s.srcDims!.w}
                  worldH={s.srcDims!.h}
                  mode={cfg.mode}
                  customShader={shaderFor(cfg.mode)}
                  hueOffset={cfg.hueOffset}
                  phaseOffset={cfg.phaseOffset}
                  dim={cfg.dim}
                  colors={cfg.colors}
                />
              );
            })}
            <ClickMarkers s={s} />
          </Canvas.Node>
        </Canvas>
      ) : (
        <EmptyState />
      )}
      {s.srcDims ? <EditorHud s={s} /> : null}
      {/* Click handler OVERLAYS the editor in screen-space (NOT inside
          Canvas.Node). When inside the canvas, a Pressable sized to the
          full image dimensions has a hit-region that spills past the
          canvas viewport — clicks on the Tools palette would land on the
          invisible Pressable instead. Putting it here keeps the hit-test
          exactly the editor viewport.
          When the HAND tool is active we DON'T render this overlay at all,
          letting the underlying Canvas receive raw mouse input for its
          built-in pan/zoom. */}
      {s.srcDims && s.tool !== 'hand' ? (
        <Pressable
          style={{
            position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
            backgroundColor: '#00000001',
          }}
          onMouseDown={(p: any) => {
            const hit = toSource(p.x, p.y);
            updateCursor(p.x, p.y, hit, true);
            if (!hit) return;
            if (s.tool === 'smart') {
              if (s.isBlank) return;
              // The framework's Pressable doesn't propagate keyboard
              // modifiers (no p.shiftKey), so reject can't be a shift-
              // click gesture. Instead use the existing left-palette
              // mode toggle: ERASE → keep (add region), RESTORE → reject
              // (subtract region). Same toggle the brush tool uses, just
              // remapped semantically.
              const label = s.mode === 'restore' ? 'reject' : 'keep';
              void s.addClick(hit.sx, hit.sy, label);
              return;
            }
            s.beginStroke();
            drawing.current = true;
            s.paintAtSource(hit.sx, hit.sy);
          }}
          onMouseMove={(p: any) => {
            const hit = toSource(p.x, p.y);
            updateCursor(p.x, p.y, hit);
            if (!drawing.current) return;
            if (!hit) return;
            s.paintAtSource(hit.sx, hit.sy);
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
    : mode === 'erase'
      ? COLORS.warn
      : COLORS.good;
  if (cursor.kind === 'smart') {
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
        <Box style={{ position: 'absolute', left: cursor.radius - 1, top: -6, width: 2, height: 8, backgroundColor: color }} />
        <Box style={{ position: 'absolute', left: cursor.radius - 1, bottom: -6, width: 2, height: 8, backgroundColor: color }} />
        <Box style={{ position: 'absolute', left: -6, top: cursor.radius - 1, width: 8, height: 2, backgroundColor: color }} />
        <Box style={{ position: 'absolute', right: -6, top: cursor.radius - 1, width: 8, height: 2, backgroundColor: color }} />
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
      : (s.mode === 'erase'
          ? 'Drag over background to remove.'
          : 'Drag removed areas to restore.');
  // Subtle one-line bar at bottom-left. The old "BRUSH / ERASE" colored
  // chip + verbose help text packed into a panel was atrocious; this is
  // an unobtrusive single-line strip with a tool dot + mode tag.
  const dotColor = s.tool === 'hand' ? COLORS.inkMuted
    : s.tool === 'smart' ? COLORS.accent
    : COLORS.ink;
  const modeColor = s.mode === 'erase' ? COLORS.warn : COLORS.good;
  return (
    <Row style={{
      position: 'absolute',
      left: 14,
      bottom: 14,
      maxWidth: 460,
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
      <Text style={{ color: COLORS.inkDim, fontSize: 10 }} numberOfLines={1}>
        {action}
      </Text>
    </Row>
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

// ClickMarkers — small colored dots showing where smart-select clicks went.
// Visually persistent so the user knows where they've already poked.
function ClickMarkers({ s }: { s: CutoutState }) {
  if (!s.srcDims || s.clicks.length === 0) return null;
  // Dot radius scales with source — visible at any zoom level.
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

function MaskOverlay({ s }: { s: CutoutState }) {
  if (!s.srcDims || s.overlayCells.size === 0) return null;
  const cellW = s.srcDims.w / OVERLAY_RES;
  const cellH = s.srcDims.h / OVERLAY_RES;
  const runs = rowRuns(s.overlayCells, OVERLAY_RES);
  return (
    <Box style={{
      position: 'absolute', left: 0, top: 0,
      width: s.srcDims.w, height: s.srcDims.h,
    }}>
      {runs.map((r, i) => (
        <Box
          key={i}
          style={{
            position: 'absolute',
            left: r.x * cellW,
            top: r.y * cellH,
            width: r.len * cellW,
            height: cellH,
            backgroundColor: COLORS.bg,
            opacity: 0.85,
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
