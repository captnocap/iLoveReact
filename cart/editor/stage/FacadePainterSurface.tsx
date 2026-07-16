// Facade Painter (req_3062): the Studio paint system aimed at one meter-true
// multi-piece wall canvas. The action bar owns the shared PaintToolbar; this
// surface owns only the target, its durable layer program, and selection masks.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Effect, Graph, Paintable, StaticSurface } from '../../../runtime/primitives';
import { useBrushStroke, type CommittedBrushStroke } from '../../../runtime/hooks/useBrushStroke';
import { paintableOps, usePaintable } from '../../../runtime/hooks/usePaintable';
import { readSurfacePixels, type SurfacePixels } from '../../../runtime/capture';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import type { Brush, BrushTool, PaintInk } from '../../../runtime/paint/model';
import { dabsForStrokePath } from '../../../runtime/paint/stroke';
import { stampBrushDab } from '../../../runtime/paint/stamp';
import {
  facadeLayers,
  type Facade,
  type FacadeLayer,
  type FacadePaintTool,
  type FacadeStamp,
  type FacadeStroke,
  type FacadeStrokeSelection,
} from '../world/facades';
import { compositeFacadeStrokeMask } from '../world/facadeBake';
import { rotatePackedTexture } from '../textures/pixelTexture';
import { stickerById } from '../data/stickerStore';
import { defaultShaderData, shaderSpec } from '../textures/shaders';
import type { EditorState } from '../data/types';
import PaintLayersPanel from '../inspector/PaintLayersPanel';

const CHECKER = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cell = (floor(in.uv.x * 64.0) + floor(in.uv.y * 32.0)) % 2.0;
  return vec4f(mix(vec3f(0.16, 0.16, 0.18), vec3f(0.20, 0.20, 0.23), cell), 1.0);
}`;

const LAYER_DISPLAY = `
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  return textureSampleLevel(tex, smp, in.uv, 0.0);
}`;

const FACADE_PAINTER_TUNING = {
  shaderCapturePx: 256,
  shaderPollMs: 80,
  replayPollMs: 50,
  lassoSampleDistancePx: 3,
  paneMaxWidthPx: 760,
  paneMaxHeightPx: 560,
  viewMinPx: 64,
  layerPanelWidthPx: 264,
  selectionStrokeWidthPx: 1.4,
} as const;

type SelectionPx = { kind: 'marquee' | 'lasso'; points: number[] };
type ShaderCapture = { key: string; ink: Extract<PaintInk, { kind: 'shader' }>; shader: string; data: number[] };

function hashText(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function shaderCapture(ink: Extract<PaintInk, { kind: 'shader' }>): ShaderCapture | null {
  const spec = shaderSpec(ink.surface);
  if (!spec) return null;
  const data = ink.data?.length ? ink.data : defaultShaderData(spec);
  return { key: `facade-ink-${hashText(`${ink.surface}:${JSON.stringify(data)}`)}`, ink, shader: spec.shader, data };
}

function brushForStroke(stroke: FacadeStroke, detail: number): Brush {
  return {
    stamp: stroke.brush.stamp,
    ink: { kind: 'color', hex: '#ffffff' },
    size: Math.max(1, stroke.brush.sizeMeters * detail),
    hardness: stroke.brush.hardness,
    flow: stroke.brush.flow,
    scatter: stroke.brush.scatter,
    angleDeg: stroke.brush.angleDeg,
    aspect: stroke.brush.aspect,
    spacing: stroke.brush.spacing,
    blend: stroke.brush.blend,
  };
}

function pointsToPixels(points: readonly number[], facade: Facade, detail: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push(points[i]! * detail, (facade.heightMeters - points[i + 1]!) * detail);
  return out;
}

function pointsToMeters(points: readonly number[], facade: Facade, detail: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push(points[i]! / detail, facade.heightMeters - points[i + 1]! / detail);
  return out;
}

function strokeSelection(selection: SelectionPx | null, facade: Facade, detail: number): FacadeStrokeSelection | undefined {
  return selection ? { kind: selection.kind, points: pointsToMeters(selection.points, facade, detail) } : undefined;
}

function cloneInk(ink: PaintInk): PaintInk {
  if (ink.kind !== 'shader') return { ...ink };
  return { ...ink, data: ink.data?.slice() };
}

export default function FacadePainterSurface(props: {
  facade: Facade;
  stickerArm: EditorState['stickerArm'];
  paintState: EditorState['facadePaint'];
  onPaintState: (patch: Partial<EditorState['facadePaint']>) => void;
  onStroke: (facadeId: string, stroke: FacadeStroke) => void;
  onLayers: (facadeId: string, layers: FacadeLayer[], activeLayerId: string) => void;
  onStamp: (facadeId: string, stamp: FacadeStamp) => void;
  onClear: (facadeId: string) => void;
  onSave: (facadeId: string, strokesRgba: Uint8Array, width: number, height: number) => void;
}) {
  const facade = props.facade;
  const detail = props.paintState.detail;
  const brush = props.paintState.brush;
  const tool = props.paintState.tool;
  const layers = facadeLayers(facade);
  const activeLayerId = layers.some((layer) => layer.id === facade.activeLayerId) ? facade.activeLayerId : layers[0]!.id;
  const size = useMemo(() => ({
    w: Math.max(2, Math.round(facade.widthMeters * detail)),
    h: Math.max(2, Math.round(facade.heightMeters * detail)),
  }), [facade.id, facade.widthMeters, facade.heightMeters, detail]);
  const layerId = (id: string) => `facade-${facade.id}-${detail}-layer-${id}`;
  const activePaint = paintableOps(layerId(activeLayerId));
  const scratch = usePaintable({ id: `facade-${facade.id}-${detail}-stroke-mask`, w: size.w, h: size.h });
  const display = usePaintable({ id: `facade-${facade.id}-${detail}-display`, w: size.w, h: size.h });
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const baselineRef = useRef<Uint8Array | null>(null);
  const selectionDrawRef = useRef<SelectionPx | null>(null);
  const [selection, setSelection] = useState<SelectionPx | null>(null);

  const programKey = JSON.stringify(layers.map((layer) => [layer.id, layer.strokes]));
  const captures = useMemo(() => {
    const byKey = new Map<string, ShaderCapture>();
    const add = (ink: PaintInk) => {
      if (ink.kind !== 'shader') return;
      const capture = shaderCapture(ink);
      if (capture) byKey.set(capture.key, capture);
    };
    for (const layer of layers) for (const stroke of layer.strokes) add(stroke.ink);
    add(brush.ink);
    return [...byKey.values()];
  }, [programKey, brush.ink]);
  const [shaderPixels, setShaderPixels] = useState<Record<string, SurfacePixels>>({});

  useEffect(() => {
    if (!captures.length) return;
    const read = (): boolean => {
      const found: Record<string, SurfacePixels> = {};
      for (const capture of captures) {
        const pixels = readSurfacePixels(capture.key);
        if (pixels) found[capture.key] = pixels;
      }
      if (Object.keys(found).length) setShaderPixels((previous) => ({ ...previous, ...found }));
      return Object.keys(found).length === captures.length;
    };
    if (read()) return;
    const timer = setInterval(() => {
      if (read()) clearInterval(timer);
    }, FACADE_PAINTER_TUNING.shaderPollMs);
    return () => clearInterval(timer);
  }, [captures.map((capture) => capture.key).join('|')]);

  const shaderFor = (ink: PaintInk): SurfacePixels | null => {
    if (ink.kind !== 'shader') return null;
    const capture = shaderCapture(ink);
    return capture ? shaderPixels[capture.key] ?? null : null;
  };

  const selectionPixelsFor = (stored?: FacadeStrokeSelection): FacadeStrokeSelection | undefined => stored
    ? { kind: stored.kind, points: pointsToPixels(stored.points, facade, detail) }
    : undefined;

  const queueStrokeMask = (stroke: FacadeStroke): Uint8Array | null => {
    scratch.paint.clearColor(0, 0, 0, 0);
    const recipe = brushForStroke(stroke, detail);
    const points = pointsToPixels(stroke.points, facade, detail);
    for (const dab of dabsForStrokePath(stroke.tool, points, recipe.size, recipe.spacing)) {
      stampBrushDab(scratch.paint, recipe, [1, 1, 1], dab.x, dab.y, dab.radius, null, false);
    }
    return scratch.paint.readback();
  };

  // Rebuild every layer from its durable program. readback() drains queued host
  // ops, so each stroke can use the exact host footprint as a CPU shader/lasso mask.
  useEffect(() => {
    const missingShader = captures.some((capture) => !shaderPixels[capture.key]);
    if (missingShader) return;
    let stopped = false;
    const replay = (): boolean => {
      if (stopped) return true;
      for (const layer of layers) {
        const paint = paintableOps(layerId(layer.id));
        paint.clearColor(0, 0, 0, 0);
        let base = paint.readback();
        if (!base) return false;
        for (const stroke of layer.strokes) {
          const mask = queueStrokeMask(stroke);
          if (!mask) return false;
          compositeFacadeStrokeMask(base, mask, size.w, size.h, stroke.ink, stroke.tool === 'eraser', selectionPixelsFor(stroke.selection), shaderFor(stroke.ink));
          paint.upload(base);
          base = paint.readback() ?? base;
        }
      }
      return true;
    };
    if (replay()) return () => { stopped = true; };
    const timer = setInterval(() => { if (replay()) clearInterval(timer); }, FACADE_PAINTER_TUNING.replayPollMs);
    return () => { stopped = true; clearInterval(timer); };
  }, [facade.id, detail, programKey, captures.map((capture) => `${capture.key}:${shaderPixels[capture.key] ? 1 : 0}`).join('|')]);

  const mapPoint = (sx: number, sy: number) => {
    const rect = rectRef.current;
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    const x = ((sx - rect.x) / rect.width) * size.w;
    const y = ((sy - rect.y) / rect.height) * size.h;
    return x < 0 || y < 0 || x > size.w || y > size.h ? null : { x, y };
  };
  const marqueeClip = selection?.kind === 'marquee' && selection.points.length >= 4 ? (() => {
    const ax = selection.points[0]!, ay = selection.points[1]!;
    const bx = selection.points[selection.points.length - 2]!, by = selection.points[selection.points.length - 1]!;
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  })() : undefined;
  const needsScratch = brush.ink.kind === 'shader' || selection?.kind === 'lasso';
  const controllerTool: BrushTool = needsScratch && tool === 'eraser' ? 'brush' : tool;
  const controllerBrush: Brush = needsScratch && tool === 'eraser' ? { ...brush, ink: { kind: 'color', hex: '#ffffff' } } : brush;

  const commitStroke = (record?: CommittedBrushStroke) => {
    if (!record || !['brush', 'eraser', 'line', 'rect', 'ellipse'].includes(tool)) return;
    if (needsScratch) {
      const mask = scratch.paint.readback();
      const base = baselineRef.current;
      if (mask && base) {
        compositeFacadeStrokeMask(base, mask, size.w, size.h, brush.ink, tool === 'eraser', selection ?? undefined, shaderFor(brush.ink));
        activePaint.upload(base);
      }
      baselineRef.current = null;
    }
    props.onStroke(facade.id, {
      ink: cloneInk(brush.ink),
      brush: {
        stamp: { ...brush.stamp },
        sizeMeters: brush.size / detail,
        hardness: brush.hardness,
        flow: brush.flow,
        scatter: brush.scatter,
        angleDeg: brush.angleDeg,
        aspect: brush.aspect,
        spacing: brush.spacing,
        blend: brush.blend,
      },
      tool: tool as FacadePaintTool,
      points: pointsToMeters(record.points, facade, detail),
      selection: strokeSelection(selection, facade, detail),
    });
  };

  const stroke = useBrushStroke({
    paint: needsScratch ? scratch.paint : activePaint,
    texW: size.w,
    texH: size.h,
    brush: controllerBrush,
    tool: controllerTool,
    mapPoint,
    clip: marqueeClip,
    // The pick goes through the spine (the same announce global the model painter's
    // eyedropper uses, req_3097) so RECENT records it and the toolbar swatch follows;
    // AppFrame's spine→facade-brush sync then deposits it into this brush's ink.
    onPickColor: (hex) => {
      const announce = (globalThis as any).__modelColorSampled as ((hex: string) => void) | undefined;
      if (announce) announce(hex);
      else props.onPaintState({ brush: { ...brush, ink: { kind: 'color', hex } } });
    },
    onStrokeEnd: commitStroke,
  });

  const onDown = (event: any) => {
    const point = mapPoint(event.x, event.y);
    if (!point) return;
    if (tool === 'marquee' || tool === 'lasso') {
      const next: SelectionPx = { kind: tool, points: [point.x, point.y] };
      selectionDrawRef.current = next;
      setSelection(next);
      return;
    }
    if (needsScratch) {
      baselineRef.current = activePaint.readback();
      scratch.paint.clearColor(0, 0, 0, 0);
      scratch.paint.readback();
    }
    stroke.handlers.onMouseDown(event);
  };
  const onMove = (event: any) => {
    const drawing = selectionDrawRef.current;
    if (drawing) {
      const point = mapPoint(event.x, event.y);
      if (!point) return;
      if (drawing.kind === 'marquee') drawing.points = [drawing.points[0]!, drawing.points[1]!, point.x, point.y];
      else {
        const lx = drawing.points[drawing.points.length - 2]!, ly = drawing.points[drawing.points.length - 1]!;
        if (Math.hypot(point.x - lx, point.y - ly) >= FACADE_PAINTER_TUNING.lassoSampleDistancePx) drawing.points.push(point.x, point.y);
      }
      setSelection({ kind: drawing.kind, points: drawing.points.slice() });
      return;
    }
    stroke.handlers.onMouseMove(event);
  };
  const onUp = (event: any) => {
    if (selectionDrawRef.current) {
      selectionDrawRef.current = null;
      return;
    }
    stroke.handlers.onMouseUp(event);
  };

  const updateLayers = (next: FacadeLayer[], active = activeLayerId): boolean => {
    if (!next.length || !next.some((layer) => layer.id === active)) return false;
    props.onLayers(facade.id, next, active);
    return true;
  };
  const addLayer = () => {
    let n = 1;
    while (layers.some((layer) => layer.id === `layer-${n}`)) n += 1;
    const id = `layer-${n}`;
    return updateLayers([...layers, { id, name: `Layer ${n}`, visible: true, opacity: 1, strokes: [] }], id);
  };
  const moveLayer = (id: string, direction: 'up' | 'down') => {
    const at = layers.findIndex((layer) => layer.id === id);
    const to = direction === 'up' ? at + 1 : at - 1;
    if (at < 0 || to < 0 || to >= layers.length) return false;
    const next = layers.slice();
    [next[at], next[to]] = [next[to]!, next[at]!];
    return updateLayers(next);
  };
  const mergeLayer = (id: string) => {
    const at = layers.findIndex((layer) => layer.id === id);
    if (at <= 0) return false;
    const next = layers.slice();
    next[at - 1] = { ...next[at - 1]!, strokes: [...next[at - 1]!.strokes, ...next[at]!.strokes] };
    next.splice(at, 1);
    return updateLayers(next, next[at - 1]!.id);
  };

  const scale = Math.min(FACADE_PAINTER_TUNING.paneMaxWidthPx / size.w, FACADE_PAINTER_TUNING.paneMaxHeightPx / size.h);
  const viewW = Math.max(FACADE_PAINTER_TUNING.viewMinPx, Math.floor(size.w * scale));
  const viewH = Math.max(FACADE_PAINTER_TUNING.viewMinPx, Math.floor(size.h * scale));
  const pxPerMeter = viewW / facade.widthMeters;
  const selectionViewPoints = selection ? selection.points.map((value, index) => value * (index % 2 === 0 ? viewW / size.w : viewH / size.h)) : [];
  const selectionOutline = selection?.kind === 'marquee' && selectionViewPoints.length >= 4
    ? [selectionViewPoints[0]!, selectionViewPoints[1]!, selectionViewPoints[2]!, selectionViewPoints[1]!, selectionViewPoints[2]!, selectionViewPoints[3]!, selectionViewPoints[0]!, selectionViewPoints[3]!, selectionViewPoints[0]!, selectionViewPoints[1]!]
    : selectionViewPoints.length >= 6 ? [...selectionViewPoints, selectionViewPoints[0]!, selectionViewPoints[1]!] : selectionViewPoints;

  const stampPreviews = facade.stamps.map((stamp, index) => {
    const sticker = stickerById(stamp.stickerId);
    const spec = sticker ? shaderSpec(sticker.textureId) : undefined;
    if (!sticker || !spec) return null;
    const w = sticker.widthMeters * stamp.scale * pxPerMeter;
    const h = sticker.heightMeters * stamp.scale * pxPerMeter;
    const swapped = Math.round(stamp.rotDegrees / 90) % 2 === 1;
    return <Effect key={`stamp-${index}`} shader={spec.shader} data={rotatePackedTexture(spec.buildData(), Math.round(stamp.rotDegrees / 90))} style={{ position: 'absolute', left: stamp.u * pxPerMeter - (swapped ? h : w) / 2, top: (facade.heightMeters - stamp.v) * pxPerMeter - (swapped ? w : h) / 2, width: swapped ? h : w, height: swapped ? w : h }} />;
  });

  const save = () => {
    const visible = layers.filter((layer) => layer.visible && layer.opacity > 0);
    if (!visible.length) display.paint.clearColor(0, 0, 0, 0);
    else visible.forEach((layer, index) => display.paint.composite(layerId(layer.id), layer.opacity, index === 0));
    const rgba = display.paint.readback();
    if (rgba) props.onSave(facade.id, rgba, size.w, size.h);
  };

  return (
    <Col style={{ width: '100%', height: '100%', padding: 12, gap: 10 }}>
      {captures.map((capture) => (
        <StaticSurface key={capture.key} staticKey={capture.key} warmupFrames={1} style={{ position: 'absolute', left: -99999, top: 0, width: FACADE_PAINTER_TUNING.shaderCapturePx, height: FACADE_PAINTER_TUNING.shaderCapturePx }}>
          <Effect shader={capture.shader} data={capture.data} style={{ width: FACADE_PAINTER_TUNING.shaderCapturePx, height: FACADE_PAINTER_TUNING.shaderCapturePx }} />
        </StaticSurface>
      ))}
      {layers.map((layer) => <Paintable key={layer.id} id={layerId(layer.id)} w={size.w} h={size.h} rgba />)}
      <Paintable id={scratch.id} w={size.w} h={size.h} rgba />
      <Paintable id={display.id} w={size.w} h={size.h} rgba />
      <Row style={{ alignItems: 'center', gap: 10 }}>
        <Icon name="Palette" size={14} color={accentFor('primary')} />
        <Text style={{ color: accentFor('text'), fontSize: 12, fontWeight: '700' }}>{`${facade.widthMeters.toFixed(1)}×${facade.heightMeters.toFixed(1)}m · ${size.w}×${size.h} preview · ${facade.pieceIds.length} pieces`}</Text>
        <Box style={{ flexGrow: 1 }} />
        {selection ? <C.HW_IconButton tooltip="Clear paint selection" onPress={() => setSelection(null)}><Icon name="X" size={13} color={accentFor('textDim')} /></C.HW_IconButton> : null}
        <C.HW_IconButton tooltip="Clear every paint layer and stamp on this facade" onPress={() => { for (const layer of layers) paintableOps(layerId(layer.id)).clearColor(0, 0, 0, 0); props.onClear(facade.id); }}><Icon name="Trash2" size={13} color={accentFor('textDim')} /></C.HW_IconButton>
        <C.HW_PillOn tooltip="Bake this facade onto its wall" onPress={save}><C.HW_PillTextOn>SAVE</C.HW_PillTextOn></C.HW_PillOn>
      </Row>
      <Row style={{ flexGrow: 1, gap: 12, minHeight: 0 }}>
        <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Pressable
            style={{ width: viewW, height: viewH, position: 'relative', overflow: 'hidden' }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
            onMouseLeave={(event: any) => { if (selectionDrawRef.current) selectionDrawRef.current = null; else stroke.handlers.onMouseLeave(event); }}
            onLayout={(rect: any) => { rectRef.current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }}
          >
            <Effect shader={CHECKER} style={{ position: 'absolute', left: 0, top: 0, width: viewW, height: viewH }} />
            {layers.filter((layer) => layer.visible).map((layer) => <Effect key={layer.id} shader={LAYER_DISPLAY} textures={[layerId(layer.id)]} style={{ position: 'absolute', left: 0, top: 0, width: viewW, height: viewH, opacity: layer.opacity }} />)}
            {stampPreviews}
            {selectionOutline.length >= 4 ? <Graph style={{ position: 'absolute', left: 0, top: 0, width: viewW, height: viewH }} viewX={0} viewY={0} viewZoom={1} originTopLeft><Graph.Polyline points={selectionOutline} stroke="#f4d35e" strokeWidth={FACADE_PAINTER_TUNING.selectionStrokeWidthPx} /></Graph> : null}
          </Pressable>
        </Box>
        <Col style={{ width: FACADE_PAINTER_TUNING.layerPanelWidthPx }}>
          <PaintLayersPanel
            rows={layers.map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible, strokes: layer.strokes.length }))}
            activeId={activeLayerId}
            onAdd={addLayer}
            onActive={(id) => updateLayers(layers, id)}
            onVisible={(id, visible) => updateLayers(layers.map((layer) => layer.id === id ? { ...layer, visible } : layer))}
            onRename={(id, name) => updateLayers(layers.map((layer) => layer.id === id ? { ...layer, name } : layer))}
            onMove={moveLayer}
            onMergeDown={mergeLayer}
            onDelete={(id) => layers.length > 1 ? updateLayers(layers.filter((layer) => layer.id !== id), id === activeLayerId ? layers.find((layer) => layer.id !== id)!.id : activeLayerId) : false}
          />
          <Text style={{ color: accentFor('textDim'), fontSize: 9, marginTop: 8 }}>{tool === 'lasso' ? 'Lasso clips the next strokes to its exact polygon.' : tool === 'marquee' ? 'Marquee clips the next strokes to its rectangle.' : brush.ink.kind === 'shader' && !shaderFor(brush.ink) ? 'Shader ink is warming up…' : ''}</Text>
        </Col>
      </Row>
    </Col>
  );
}
