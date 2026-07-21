import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Graph, Paintable, Pressable, Row, Text, TextInput } from '../../../runtime/primitives';
import { usePaintable } from '../../../runtime/hooks/usePaintable';
import { Icon } from '../../../runtime/icons/Icon';
import { parseClampedNumericDraft, replacementDraftAfterEdit } from '../../../runtime/paint/numericInput';
import { accentFor } from '../workspace.cls';
import type { ModelFocusBridge, ModelFocusUv } from '../stage/ModelView';
import {
  flattenUvFaceCorners,
  hitUvFace,
  hitUvIsland,
  isUvDoubleClick,
  moveUvFace,
  moveUvIsland,
  moveUvSelectionVertex,
  NO_UV_GROUP,
  rotateUvSelection,
  scaleUvSelection,
  shouldActivateUvDrag,
  shouldPanUvCanvas,
  uniformUvPack,
  uvFaceEdgeSegments,
  uvIslandBoundarySegments,
  uvSelectionBounds,
  uvSelectionVertices,
  uvTranslationSnapStep,
  UV_LAYOUT_TUNING,
  type UvAxisGuide,
  type UvCanvasTool,
  type UvFaceTarget,
  type UvIslandRect,
  type UvSelectionBounds,
} from '../model/uvLayout';

const ATLAS_SHADER = `
@group(0) @binding(1) var<storage, read> P: array<f32>;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let sheet = textureSampleLevel(tex, smp, in.uv, 0.0);
  let cell = max(P[2], 1.0);
  let checkerCell = floor(in.uv * vec2f(P[0], P[1]) / cell);
  let checkerParity = fract((checkerCell.x + checkerCell.y) * 0.5) * 2.0;
  let checker = mix(vec3f(0.05098, 0.06667, 0.09412), vec3f(0.09020, 0.11373, 0.15294), checkerParity);
  return vec4f(mix(checker, sheet.rgb, sheet.a), 1.0);
}`;

type View = { x: number; y: number; scale: number };
type ScreenPoint = { x: number; y: number };
type SelectionMode = 'island' | 'face';
type UvLineGeometry = { faces: number[]; boundary: number[] };
type UvLineGeometryCache = { rects: readonly UvIslandRect[]; view: View; geometry: UvLineGeometry };
type PendingUvPreview = { generation: number; rects: UvIslandRect[]; guide: UvAxisGuide | null };
type Gesture =
  | { kind: 'pan'; start: ScreenPoint; seed: View }
  | { kind: 'move'; index: number; target?: UvFaceTarget; start: ScreenPoint; screenStart: ScreenPoint; activated: boolean; doubleClick: boolean; seed: UvIslandRect }
  | { kind: 'vertex'; index: number; target?: UvFaceTarget; vertex: number; start: ScreenPoint; screenStart: ScreenPoint; activated: boolean; seed: UvIslandRect }
  | { kind: 'rotate'; index: number; target?: UvFaceTarget; center: ScreenPoint; startAngle: number; seed: UvIslandRect }
  | { kind: 'scale'; index: number; target?: UvFaceTarget; bounds: UvSelectionBounds; seed: UvIslandRect };

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

function atlasGridSegments(atlasWidth: number, atlasHeight: number, view: View, surfaceWidth: number, surfaceHeight: number): number[] {
  let step = UV_LAYOUT_TUNING.vertexSnapTexels;
  while (step * view.scale < UV_LAYOUT_TUNING.minimumGridSpacingPx) step *= 2;
  const firstX = Math.max(step, Math.ceil(Math.max(0, -view.x / view.scale) / step) * step);
  const lastX = Math.min(atlasWidth, (surfaceWidth - view.x) / view.scale);
  const firstY = Math.max(step, Math.ceil(Math.max(0, -view.y / view.scale) / step) * step);
  const lastY = Math.min(atlasHeight, (surfaceHeight - view.y) / view.scale);
  const screenTop = Math.max(0, view.y);
  const screenBottom = Math.min(surfaceHeight, view.y + atlasHeight * view.scale);
  const screenLeft = Math.max(0, view.x);
  const screenRight = Math.min(surfaceWidth, view.x + atlasWidth * view.scale);
  if (screenRight <= screenLeft || screenBottom <= screenTop) return [];
  const segments: number[] = [];
  for (let x = firstX; x < lastX; x += step) {
    const sx = view.x + x * view.scale;
    segments.push(sx, screenTop, sx, screenBottom);
  }
  for (let y = firstY; y < lastY; y += step) {
    const sy = view.y + y * view.scale;
    segments.push(screenLeft, sy, screenRight, sy);
  }
  return segments;
}

function sameRectReferences(a: readonly UvIslandRect[], b: readonly UvIslandRect[]): boolean {
  return a.length === b.length && a.every((rect, index) => rect === b[index]);
}

function UvNumberField(props: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.value == null ? '' : String(props.value));
  const replaceBaselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editing) setDraft(props.value == null ? '' : String(props.value));
  }, [props.value, editing]);
  const commit = (submitted?: unknown) => {
    if (props.value == null) return;
    const raw = typeof submitted === 'string' ? submitted : draft;
    const parsed = parseClampedNumericDraft(raw, props.min, props.max);
    replaceBaselineRef.current = null;
    setEditing(false);
    if (parsed == null) {
      setDraft(String(props.value));
      return;
    }
    const value = Math.round(parsed);
    setDraft(String(value));
    props.onCommit(value);
  };
  return (
    <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 29, flexDirection: 'row', alignItems: 'center', backgroundColor: accentFor('controlBg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4, overflow: 'hidden' }}>
      <Text style={{ width: 19, textAlign: 'center', color: accentFor('textFaint'), fontSize: 9, fontWeight: '900' }}>{props.label}</Text>
      {props.value == null ? (
        <Text style={{ flexGrow: 1, color: accentFor('textFaint'), fontSize: 10, fontFamily: 'ui-monospace', textAlign: 'center' }}>—</Text>
      ) : (
        <TextInput
          value={editing ? draft : String(props.value)}
          onMouseDown={() => {
            replaceBaselineRef.current = editing ? draft : String(props.value);
            setEditing(true);
            setDraft(String(props.value));
          }}
          onChangeText={(value: string) => {
            const baseline = replaceBaselineRef.current;
            replaceBaselineRef.current = null;
            setEditing(true);
            setDraft(baseline === null ? value : replacementDraftAfterEdit(baseline, value));
          }}
          onSubmit={commit}
          onSubmitEditing={commit}
          onBlur={commit}
          style={{ flexGrow: 1, height: 27, minWidth: 0, color: accentFor('text'), backgroundColor: accentFor('controlBg'), fontSize: 10, fontFamily: 'ui-monospace', textAlign: 'center', paddingLeft: 3, paddingRight: 3 }}
        />
      )}
    </Box>
  );
}

function toolButton(icon: string, active: boolean, tooltip: string, onPress: () => void) {
  return (
    <Pressable
      tooltip={tooltip}
      onPress={onPress}
      style={{ width: 27, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: active ? accentFor('segActiveBg') : accentFor('surfaceRaised'), borderWidth: 1, borderColor: active ? accentFor('primary') : accentFor('border') }}
    >
      <Icon name={icon} size={12} color={active ? accentFor('primary') : accentFor('textDim')} />
    </Pressable>
  );
}

export default function UvEditor(props: { uv: ModelFocusUv; bridge: ModelFocusBridge }) {
  const { uv, bridge } = props;
  const texture = usePaintable({ id: `editor-live-uv-${uv.key}`, w: uv.w, h: uv.h });
  const initialRects = () => uv.islands.map((rect) => ({ ...rect }));
  const [rects, setRects] = useState<UvIslandRect[]>(initialRects);
  const rectsRef = useRef(rects);
  const [selected, setSelected] = useState(-1);
  const [selectedFace, setSelectedFace] = useState<UvFaceTarget | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tool, setTool] = useState<UvCanvasTool>('select');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('island');
  const [aspectLocked, setAspectLocked] = useState(false);
  const [axisGuide, setAxisGuide] = useState<UvAxisGuide | null>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 1, height: 1 });
  const surfaceRef = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const gestureRef = useRef<Gesture | null>(null);
  const pendingPreviewRef = useRef<PendingUvPreview | null>(null);
  const previewFramePendingRef = useRef(false);
  const previewGenerationRef = useRef(0);
  const lastClickRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const [view, setViewState] = useState<View>({ x: UV_LAYOUT_TUNING.canvasPaddingPx, y: UV_LAYOUT_TUNING.canvasPaddingPx, scale: 1 });
  const viewRef = useRef(view);
  const viewKeyRef = useRef('');
  const fixedLineCacheRef = useRef<UvLineGeometryCache | null>(null);
  const activeLineCacheRef = useRef<UvLineGeometryCache | null>(null);

  const setView = (next: View) => {
    viewRef.current = next;
    setViewState(next);
  };
  const fittedView = (nativeScale = false): View => {
    const padding = UV_LAYOUT_TUNING.canvasPaddingPx;
    const fit = Math.min(
      Math.max(1, surfaceSize.width - padding * 2) / Math.max(1, uv.w),
      Math.max(1, surfaceSize.height - padding * 2) / Math.max(1, uv.h),
    );
    const scale = clamp(nativeScale ? Math.min(UV_LAYOUT_TUNING.defaultNativeScale, fit) : fit, UV_LAYOUT_TUNING.minimumZoom, UV_LAYOUT_TUNING.maximumZoom);
    return {
      x: nativeScale ? padding : Math.round((surfaceSize.width - uv.w * scale) * 0.5),
      y: nativeScale ? padding : Math.round((surfaceSize.height - uv.h * scale) * 0.5),
      scale,
    };
  };

  // Mouse hardware can report much faster than the display can present. Keep the
  // exact newest UV synchronously for commit, but reconcile at most one preview per
  // host frame so raw pointer frequency cannot dictate React/render work.
  const queueUvPreview = (index: number, changed: UvIslandRect, guide: UvAxisGuide | null) => {
    const next = rectsRef.current.map((rect, rectIndex) => rectIndex === index ? changed : rect);
    rectsRef.current = next;
    const generation = previewGenerationRef.current;
    pendingPreviewRef.current = { generation, rects: next, guide };
    if (previewFramePendingRef.current) return;
    previewFramePendingRef.current = true;
    const hostGlobal = globalThis as any;
    const schedule: (callback: () => void) => unknown = typeof hostGlobal.requestAnimationFrame === 'function'
      ? hostGlobal.requestAnimationFrame.bind(hostGlobal)
      : (callback) => setTimeout(callback, UV_LAYOUT_TUNING.dragPreviewIntervalMs);
    schedule(() => {
      if (generation !== previewGenerationRef.current) return;
      previewFramePendingRef.current = false;
      const pending = pendingPreviewRef.current;
      pendingPreviewRef.current = null;
      if (!pending || pending.generation !== generation) return;
      setRects(pending.rects);
      setAxisGuide(pending.guide);
    });
  };

  const settleUvPreview = () => {
    previewGenerationRef.current += 1;
    pendingPreviewRef.current = null;
    previewFramePendingRef.current = false;
    setRects(rectsRef.current);
    setAxisGuide(null);
  };

  useEffect(() => () => {
    previewGenerationRef.current += 1;
    pendingPreviewRef.current = null;
    previewFramePendingRef.current = false;
  }, []);

  useEffect(() => {
    previewGenerationRef.current += 1;
    pendingPreviewRef.current = null;
    previewFramePendingRef.current = false;
    const next = initialRects();
    setRects(next);
    rectsRef.current = next;
    setAxisGuide(null);
    setSelected((index) => Math.min(index, uv.islands.length - 1));
    setSelectedFace((target) => target && next.some((rect) => rect.triangles?.some((triangle) => triangle.face === target.face)) ? target : null);
    if (uv.rgba) texture.paint.upload(uv.rgba);
  }, [uv.key, uv.revision]);

  const synchronizedSelectionKey = uv.selectedIslands.join(',');
  useEffect(() => {
    setSelected(uv.selectedIslands[0] ?? -1);
  }, [synchronizedSelectionKey]);

  useEffect(() => {
    if (surfaceSize.width <= 1 || surfaceSize.height <= 1) return;
    const key = `${uv.key}:${uv.w}x${uv.h}`;
    if (viewKeyRef.current === key) return;
    viewKeyRef.current = key;
    setView(fittedView(true));
  }, [uv.key, uv.w, uv.h, surfaceSize.width, surfaceSize.height]);

  const localScreenPoint = (event: any): ScreenPoint => {
    const eventX = Number(event?.x);
    const eventY = Number(event?.y);
    return {
      x: Number.isFinite(eventX) ? eventX - surfaceRef.current.x : surfaceSize.width * 0.5,
      y: Number.isFinite(eventY) ? eventY - surfaceRef.current.y : surfaceSize.height * 0.5,
    };
  };
  const atlasPoint = (screen: ScreenPoint): ScreenPoint => ({
    x: (screen.x - viewRef.current.x) / Math.max(UV_LAYOUT_TUNING.minimumZoom, viewRef.current.scale),
    y: (screen.y - viewRef.current.y) / Math.max(UV_LAYOUT_TUNING.minimumZoom, viewRef.current.scale),
  });
  const commit = (next: UvIslandRect[], label: string) => {
    const corners = flattenUvFaceCorners(next);
    if (!corners || !bridge.applyUvGeometry(corners)) {
      const restored = initialRects();
      rectsRef.current = restored;
      setRects(restored);
      setNote(`${label} refused — live model changed; atlas was refreshed`);
      bridge.refreshUv();
      return;
    }
    setNote(label);
  };
  const replaceSelected = (changed: UvIslandRect, label: string) => {
    if (selected < 0) return;
    const next = rectsRef.current.map((rect, index) => index === selected ? changed : rect);
    rectsRef.current = next;
    setRects(next);
    commit(next, label);
  };

  const activeRange = (globalThis as any).__modelActivePartRange as { lo: number; hi: number } | null | undefined;
  const selectedRect = selected >= 0 ? rects[selected] ?? null : null;
  const selectedTarget = selectionMode === 'face' ? selectedFace ?? undefined : undefined;
  const selectionBounds = selectedRect ? uvSelectionBounds(selectedRect, selectedTarget) : null;
  const selectedOutlineRect = selectedRect && selectedTarget
    ? { ...selectedRect, triangles: selectedRect.triangles?.filter((triangle) => selectedTarget.group !== NO_UV_GROUP ? triangle.group === selectedTarget.group : triangle.face === selectedTarget.face) }
    : selectedRect;
  const lineGeometry = (items: readonly UvIslandRect[]): UvLineGeometry => ({
    faces: uvFaceEdgeSegments(items, view.scale, view.scale, view.x, view.y),
    boundary: uvIslandBoundarySegments(items, view.scale, view.scale, view.x, view.y),
  });
  const cachedLineGeometry = (cacheRef: { current: UvLineGeometryCache | null }, items: readonly UvIslandRect[]): UvLineGeometry => {
    const cached = cacheRef.current;
    if (cached
      && cached.view.x === view.x
      && cached.view.y === view.y
      && cached.view.scale === view.scale
      && sameRectReferences(cached.rects, items)) return cached.geometry;
    const geometry = lineGeometry(items);
    cacheRef.current = { rects: [...items], view: { ...view }, geometry };
    return geometry;
  };
  const fixedRects = rects.filter((_rect, index) => index !== selected);
  const fixedLines = cachedLineGeometry(fixedLineCacheRef, fixedRects);
  const selectedIslandLines = selectedRect ? lineGeometry([selectedRect]) : { faces: [], boundary: [] };
  const selectedOutlineLines = selectedOutlineRect === selectedRect
    ? selectedIslandLines
    : selectedOutlineRect ? lineGeometry([selectedOutlineRect]) : { faces: [], boundary: [] };
  const activeFixedRects = activeRange ? fixedRects.filter((rect) => rect.group >= activeRange.lo && rect.group < activeRange.hi) : [];
  const activeFixedLines = activeFixedRects.length ? cachedLineGeometry(activeLineCacheRef, activeFixedRects) : { faces: [], boundary: [] };
  const selectedActiveBoundary = selectedRect && activeRange && selectedRect.group >= activeRange.lo && selectedRect.group < activeRange.hi
    ? selectedIslandLines.boundary
    : [];
  const handlePoints = selectedRect ? uvSelectionVertices(selectedRect, selectedTarget).map((vertex, index) => ({
    index,
    x: view.x + vertex.x * view.scale,
    y: view.y + vertex.y * view.scale,
  })) : [];
  const rotationHandle = selectionBounds ? {
    x: view.x + selectionBounds.cx * view.scale,
    y: view.y + selectionBounds.y * view.scale - UV_LAYOUT_TUNING.rotationHandleOffsetPx,
  } : null;
  const scaleHandle = selectionBounds ? {
    x: view.x + (selectionBounds.x + selectionBounds.w) * view.scale + UV_LAYOUT_TUNING.scaleHandleOffsetPx,
    y: view.y + (selectionBounds.y + selectionBounds.h) * view.scale + UV_LAYOUT_TUNING.scaleHandleOffsetPx,
  } : null;
  const hitHandle = (point: ScreenPoint): number => {
    const radius = UV_LAYOUT_TUNING.vertexHandleHitPx;
    for (const handle of handlePoints) {
      if (Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius) return handle.index;
    }
    return -1;
  };
  const hitsControl = (point: ScreenPoint, control: ScreenPoint | null, radius: number): boolean => Boolean(
    control && Math.hypot(point.x - control.x, point.y - control.y) <= radius,
  );
  const zoomAt = (point: ScreenPoint, factor: number) => {
    const current = viewRef.current;
    const nextScale = clamp(current.scale * factor, UV_LAYOUT_TUNING.minimumZoom, UV_LAYOUT_TUNING.maximumZoom);
    const ax = (point.x - current.x) / current.scale;
    const ay = (point.y - current.y) / current.scale;
    setView({ x: point.x - ax * nextScale, y: point.y - ay * nextScale, scale: nextScale });
  };

  const changeCoordinate = (field: 'x' | 'y' | 'w' | 'h', value: number) => {
    const rect = selectedRect;
    const bounds = selectionBounds;
    if (!rect || !bounds) return;
    let changed = rect;
    if (field === 'x' || field === 'y') {
      const dx = field === 'x' ? value - bounds.x : 0;
      const dy = field === 'y' ? value - bounds.y : 0;
      changed = selectedTarget
        ? moveUvFace(rect, selectedTarget, dx, dy, uv.w, uv.h)
        : moveUvIsland(rect, dx, dy, uv.w, uv.h);
    } else {
      let scaleX = field === 'w' ? value / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, bounds.w) : 1;
      let scaleY = field === 'h' ? value / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, bounds.h) : 1;
      if (aspectLocked) {
        const uniform = field === 'w' ? scaleX : scaleY;
        scaleX = uniform;
        scaleY = uniform;
      }
      changed = scaleUvSelection(rect, selectedTarget, scaleX, scaleY, uv.w, uv.h);
    }
    replaceSelected(changed, `set UV ${field.toUpperCase()} to ${value}`);
  };

  const atlasW = uv.w * view.scale;
  const atlasH = uv.h * view.scale;
  const translationSnapStep = uvTranslationSnapStep(view.scale);
  const atlasEffectData = useMemo(() => [atlasW, atlasH, UV_LAYOUT_TUNING.checkerPx, 0], [atlasW, atlasH]);
  const thumbnailEffectData = useMemo(() => [32, 32, UV_LAYOUT_TUNING.checkerPx, 0], []);
  const gridSegments = useMemo(
    () => atlasGridSegments(uv.w, uv.h, view, surfaceSize.width, surfaceSize.height),
    [uv.w, uv.h, view.x, view.y, view.scale, surfaceSize.width, surfaceSize.height],
  );
  const selectionFrameSegments = selectionBounds
    ? (() => {
      const x0 = view.x + selectionBounds.x * view.scale;
      const y0 = view.y + selectionBounds.y * view.scale;
      const x1 = view.x + (selectionBounds.x + selectionBounds.w) * view.scale;
      const y1 = view.y + (selectionBounds.y + selectionBounds.h) * view.scale;
      return [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
    })()
    : [];
  const rotationStemSegments = selectionBounds && rotationHandle
    ? [rotationHandle.x, rotationHandle.y, rotationHandle.x, view.y + selectionBounds.y * view.scale]
    : [];
  const guideSegments = axisGuide
    ? axisGuide.axis === 'horizontal'
      ? [view.x, view.y + axisGuide.coordinate * view.scale, view.x + atlasW, view.y + axisGuide.coordinate * view.scale]
      : [view.x + axisGuide.coordinate * view.scale, view.y, view.x + axisGuide.coordinate * view.scale, view.y + atlasH]
    : [];
  const host = globalThis as any;
  const finishGesture = (event?: any) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture && gesture.kind !== 'pan') settleUvPreview();
    else setAxisGuide(null);
    if (gesture?.kind === 'move') {
      const end = event ? localScreenPoint(event) : null;
      const click = Boolean(end && Math.hypot(end.x - gesture.screenStart.x, end.y - gesture.screenStart.y) <= UV_LAYOUT_TUNING.dragActivationPx);
      if (click && !gesture.doubleClick) lastClickRef.current = { at: Date.now(), x: gesture.screenStart.x, y: gesture.screenStart.y };
      else lastClickRef.current = null;
      if (rectsRef.current[gesture.index] !== gesture.seed) {
        commit(rectsRef.current, gesture.target ? 'detached and moved UV face' : 'moved UV island over the fixed texture');
      }
    }
    if (gesture?.kind === 'vertex' && rectsRef.current[gesture.index] !== gesture.seed) commit(rectsRef.current, 'moved UV vertex over the fixed texture');
    if (gesture?.kind === 'rotate') commit(rectsRef.current, gesture.target ? 'rotated detached UV face' : 'rotated UV island');
    if (gesture?.kind === 'scale') commit(rectsRef.current, gesture.target ? 'scaled detached UV face' : 'scaled UV island');
  };

  return (
    <Box style={{ flexGrow: 1, minHeight: 0, gap: 6 }}>
      <Row style={{ height: 27, alignItems: 'center', gap: 5 }}>
        {toolButton('MousePointer2', tool === 'select' && selectionMode === 'island', 'Island mode — transform one connected UV piece; double-click a face to isolate it', () => { setTool('select'); setSelectionMode('island'); setSelectedFace(null); })}
        {toolButton('Triangle', tool === 'select' && selectionMode === 'face', 'Face mode — drag one authored face to break it out of its island', () => { setTool('select'); setSelectionMode('face'); })}
        {toolButton('Hand', tool === 'pan', 'Pan the UV canvas', () => setTool('pan'))}
        {toolButton('Maximize2', false, 'Fit the complete atlas in the canvas', () => setView(fittedView(false)))}
        <Pressable tooltip="Zoom out" onPress={() => zoomAt({ x: surfaceSize.width * 0.5, y: surfaceSize.height * 0.5 }, 0.8)} style={{ width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}>
          <Text style={{ color: accentFor('textDim'), fontSize: 14, fontWeight: '900' }}>−</Text>
        </Pressable>
        <Text style={{ minWidth: 44, textAlign: 'center', color: accentFor('textDim'), fontSize: 9, fontFamily: 'ui-monospace', fontWeight: '800' }}>{`${Math.round(view.scale * 100)}%`}</Text>
        <Pressable tooltip="Zoom in" onPress={() => zoomAt({ x: surfaceSize.width * 0.5, y: surfaceSize.height * 0.5 }, 1.25)} style={{ width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}>
          <Text style={{ color: accentFor('textDim'), fontSize: 14, fontWeight: '900' }}>+</Text>
        </Pressable>
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: accentFor('textFaint'), fontSize: 9 }}>{`${rects.length} islands`}</Text>
      </Row>

      <Paintable id={texture.id} w={uv.w} h={uv.h} rgba />
      <Pressable
        focusable
        onLayout={(layout: any) => {
          const next = { x: Number(layout.x), y: Number(layout.y), width: Math.max(1, Number(layout.width)), height: Math.max(1, Number(layout.height)) };
          surfaceRef.current = next;
          if (next.width !== surfaceSize.width || next.height !== surfaceSize.height) setSurfaceSize({ width: next.width, height: next.height });
        }}
        onWheel={(event: any) => {
          const delta = Number(event?.deltaY ?? event?.delta ?? 0);
          if (!Number.isFinite(delta) || delta === 0) return;
          zoomAt(localScreenPoint(event), delta > 0 ? 0.85 : 1.15);
        }}
        onMouseDown={(event: any) => {
          const screen = localScreenPoint(event);
          const mouseButtonsMask = Number(host.getMouseButtons?.() ?? event?.buttons ?? 0);
          if (shouldPanUvCanvas(tool, mouseButtonsMask)) {
            gestureRef.current = { kind: 'pan', start: screen, seed: viewRef.current };
            return;
          }
          if (selectedRect && selectionBounds && hitsControl(screen, rotationHandle, UV_LAYOUT_TUNING.rotationHandleHitPx)) {
            const point = atlasPoint(screen);
            gestureRef.current = {
              kind: 'rotate',
              index: selected,
              target: selectedTarget,
              center: { x: selectionBounds.cx, y: selectionBounds.cy },
              startAngle: Math.atan2(point.y - selectionBounds.cy, point.x - selectionBounds.cx),
              seed: selectedRect,
            };
            return;
          }
          if (selectedRect && selectionBounds && hitsControl(screen, scaleHandle, UV_LAYOUT_TUNING.scaleHandleHitPx)) {
            gestureRef.current = { kind: 'scale', index: selected, target: selectedTarget, bounds: selectionBounds, seed: selectedRect };
            return;
          }
          const vertex = hitHandle(screen);
          if (vertex >= 0 && selectedRect) {
            lastClickRef.current = null;
            gestureRef.current = { kind: 'vertex', index: selected, target: selectedTarget, vertex, start: atlasPoint(screen), screenStart: screen, activated: false, seed: selectedRect };
            return;
          }
          const point = atlasPoint(screen);
          const clickStamp = { at: Date.now(), x: screen.x, y: screen.y };
          const doubleClick = isUvDoubleClick(lastClickRef.current, clickStamp);
          if (doubleClick) {
            lastClickRef.current = null;
            const faceHit = hitUvFace(rectsRef.current, point.x, point.y);
            if (faceHit) {
              setTool('select');
              setSelectionMode('face');
              setSelected(faceHit.island);
              setSelectedFace(faceHit.target);
              bridge.selectUvFace(faceHit.target.face, Boolean(event?.shiftKey));
              gestureRef.current = { kind: 'move', index: faceHit.island, target: faceHit.target, start: point, screenStart: screen, activated: false, doubleClick: true, seed: rectsRef.current[faceHit.island]! };
              setNote('isolated one authored UV face');
              return;
            }
          }
          if (selectionMode === 'face') {
            const faceHit = hitUvFace(rectsRef.current, point.x, point.y);
            setSelected(faceHit?.island ?? -1);
            setSelectedFace(faceHit?.target ?? null);
            if (faceHit) {
              bridge.selectUvFace(faceHit.target.face, Boolean(event?.shiftKey));
              gestureRef.current = { kind: 'move', index: faceHit.island, target: faceHit.target, start: point, screenStart: screen, activated: false, doubleClick: false, seed: rectsRef.current[faceHit.island]! };
            }
            return;
          }
          const index = hitUvIsland(rectsRef.current, point.x, point.y);
          setSelected(index);
          setSelectedFace(null);
          if (index >= 0) {
            bridge.selectUvIsland(index, Boolean(event?.shiftKey));
            gestureRef.current = { kind: 'move', index, start: point, screenStart: screen, activated: false, doubleClick: false, seed: rectsRef.current[index]! };
          }
        }}
        onMouseMove={(event: any) => {
          const gesture = gestureRef.current;
          if (!gesture) return;
          const screen = localScreenPoint(event);
          if (gesture.kind === 'pan') {
            setView({ x: gesture.seed.x + screen.x - gesture.start.x, y: gesture.seed.y + screen.y - gesture.start.y, scale: gesture.seed.scale });
            return;
          }
          const point = atlasPoint(screen);
          let changed = gesture.seed;
          let guide: UvAxisGuide | null = null;
          if (gesture.kind === 'move' || gesture.kind === 'vertex') {
            if (!gesture.activated) {
              if (!shouldActivateUvDrag(screen.x - gesture.screenStart.x, screen.y - gesture.screenStart.y)) return;
              gesture.activated = true;
            }
            const dx = point.x - gesture.start.x;
            const dy = point.y - gesture.start.y;
            const freeMove = Boolean(event?.altKey);
            changed = gesture.kind === 'vertex'
              ? moveUvSelectionVertex(gesture.seed, gesture.target, gesture.vertex, dx, dy, uv.w, uv.h, freeMove, translationSnapStep)
              : gesture.target
                ? moveUvFace(gesture.seed, gesture.target, dx, dy, uv.w, uv.h, translationSnapStep, freeMove)
                : moveUvIsland(gesture.seed, dx, dy, uv.w, uv.h, translationSnapStep, freeMove);
          } else if (gesture.kind === 'rotate') {
            const angle = Math.atan2(point.y - gesture.center.y, point.x - gesture.center.x) - gesture.startAngle;
            const rotated = rotateUvSelection(gesture.seed, gesture.target, angle * 180 / Math.PI, uv.w, uv.h);
            changed = rotated.rect;
            guide = rotated.guide;
          } else if (gesture.kind === 'scale') {
            let scaleX = (point.x - gesture.bounds.x) / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, gesture.bounds.w);
            let scaleY = (point.y - gesture.bounds.y) / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, gesture.bounds.h);
            if (aspectLocked) {
              const uniform = Math.max(UV_LAYOUT_TUNING.minimumSelectionScale, Math.min(scaleX, scaleY));
              scaleX = uniform;
              scaleY = uniform;
            }
            changed = scaleUvSelection(gesture.seed, gesture.target, scaleX, scaleY, uv.w, uv.h);
          }
          queueUvPreview(gesture.index, changed, guide);
        }}
        onMouseUp={finishGesture}
        onMouseLeave={finishGesture}
        style={{ flexGrow: 1, minHeight: 300, position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: accentFor('border'), backgroundColor: '#07090d' }}
      >
        <Box style={{ position: 'absolute', left: view.x, top: view.y, width: atlasW, height: atlasH, backgroundColor: '#0d1118', pointerEvents: 'none' }} />
        <Effect shader={ATLAS_SHADER} data={atlasEffectData} textures={[texture.id]} style={{ position: 'absolute', left: view.x, top: view.y, width: atlasW, height: atlasH }} />
        <Box style={{ position: 'absolute', left: view.x, top: view.y, width: atlasW, height: atlasH, borderWidth: 2, borderColor: '#71839a', pointerEvents: 'none' }} />
        <Graph style={{ position: 'absolute', left: 0, top: 0, width: surfaceSize.width, height: surfaceSize.height, pointerEvents: 'none' }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
          {gridSegments.length ? <Graph.Polyline segments points={gridSegments} stroke="#4d596b" strokeWidth={0.8} /> : null}
          {fixedLines.faces.length ? <Graph.Polyline segments points={fixedLines.faces} stroke="#080b10" strokeWidth={2.4} /> : null}
          {selectedIslandLines.faces.length ? <Graph.Polyline segments points={selectedIslandLines.faces} stroke="#080b10" strokeWidth={2.4} /> : null}
          {fixedLines.faces.length ? <Graph.Polyline segments points={fixedLines.faces} stroke="#8591a3" strokeWidth={0.9} /> : null}
          {selectedIslandLines.faces.length ? <Graph.Polyline segments points={selectedIslandLines.faces} stroke="#8591a3" strokeWidth={0.9} /> : null}
          {fixedLines.boundary.length ? <Graph.Polyline segments points={fixedLines.boundary} stroke="#080b10" strokeWidth={3.2} /> : null}
          {selectedIslandLines.boundary.length ? <Graph.Polyline segments points={selectedIslandLines.boundary} stroke="#080b10" strokeWidth={3.2} /> : null}
          {fixedLines.boundary.length ? <Graph.Polyline segments points={fixedLines.boundary} stroke="#c7d0df" strokeWidth={1.15} /> : null}
          {selectedIslandLines.boundary.length ? <Graph.Polyline segments points={selectedIslandLines.boundary} stroke="#c7d0df" strokeWidth={1.15} /> : null}
          {activeFixedLines.boundary.length ? <Graph.Polyline segments points={activeFixedLines.boundary} stroke="#42d9e8" strokeWidth={1.65} /> : null}
          {selectedActiveBoundary.length ? <Graph.Polyline segments points={selectedActiveBoundary} stroke="#42d9e8" strokeWidth={1.65} /> : null}
          {selectedOutlineLines.faces.length ? <Graph.Polyline segments points={selectedOutlineLines.faces} stroke="#ffffff" strokeWidth={1.35} /> : null}
          {selectedOutlineLines.boundary.length ? <Graph.Polyline segments points={selectedOutlineLines.boundary} stroke="#ffffff" strokeWidth={2.2} /> : null}
          {selectionFrameSegments.length ? <Graph.Polyline segments points={selectionFrameSegments} stroke="#9ba8bc" strokeWidth={1} /> : null}
          {rotationStemSegments.length ? <Graph.Polyline segments points={rotationStemSegments} stroke="#dce5f2" strokeWidth={1} /> : null}
          {guideSegments.length ? <Graph.Polyline segments points={guideSegments} stroke="#4c9dff" strokeWidth={1.5} /> : null}
        </Graph>
        {handlePoints.map((handle) => (
          <Box key={handle.index} style={{ position: 'absolute', left: handle.x - 4, top: handle.y - 4, width: 9, height: 9, borderRadius: 5, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#11151d', pointerEvents: 'none' }} />
        ))}
        {rotationHandle ? (
          <Box style={{ position: 'absolute', left: rotationHandle.x - 8, top: rotationHandle.y - 8, width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#18202c', borderWidth: 1, borderColor: '#f8fafc', pointerEvents: 'none' }}>
            <Icon name="RotateCw" size={10} color="#f8fafc" />
          </Box>
        ) : null}
        {scaleHandle ? <Box style={{ position: 'absolute', left: scaleHandle.x - 5, top: scaleHandle.y - 5, width: 10, height: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#11151d', pointerEvents: 'none' }} /> : null}
      </Pressable>

      <Row style={{ height: 14, alignItems: 'center' }}>
        <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace', letterSpacing: 0.4 }}>{`SNAP ${translationSnapStep}px · hold ALT for free move`}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace' }}>{`ATLAS ${uv.w}×${uv.h}`}</Text>
      </Row>

      <Row style={{ alignItems: 'center', gap: 4 }}>
        <UvNumberField label="X" value={selectionBounds ? Math.round(selectionBounds.x) : null} min={0} max={selectionBounds ? Math.floor(uv.w - selectionBounds.w) : uv.w} onCommit={(value) => changeCoordinate('x', value)} />
        <UvNumberField label="Y" value={selectionBounds ? Math.round(selectionBounds.y) : null} min={0} max={selectionBounds ? Math.floor(uv.h - selectionBounds.h) : uv.h} onCommit={(value) => changeCoordinate('y', value)} />
        <UvNumberField label="W" value={selectionBounds ? Math.max(1, Math.round(selectionBounds.w)) : null} min={1} max={selectionBounds ? Math.floor(uv.w - selectionBounds.x) : uv.w} onCommit={(value) => changeCoordinate('w', value)} />
        <UvNumberField label="H" value={selectionBounds ? Math.max(1, Math.round(selectionBounds.h)) : null} min={1} max={selectionBounds ? Math.floor(uv.h - selectionBounds.y) : uv.h} onCommit={(value) => changeCoordinate('h', value)} />
        <Pressable tooltip={aspectLocked ? 'Unlock width and height' : 'Lock width/height aspect'} onPress={() => setAspectLocked((value) => !value)} style={{ width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: aspectLocked ? accentFor('segActiveBg') : accentFor('surfaceRaised'), borderWidth: 1, borderColor: aspectLocked ? accentFor('primary') : accentFor('border') }}>
          <Icon name={aspectLocked ? 'Link2' : 'Link2Off'} size={13} color={aspectLocked ? accentFor('primary') : accentFor('textDim')} />
        </Pressable>
      </Row>

      {note ? <Text numberOfLines={1} style={{ color: accentFor('textDim'), fontSize: 9 }}>{note}</Text> : null}

      <Box style={{ borderTopWidth: 1, borderTopColor: accentFor('borderSoft'), paddingTop: 7, gap: 5 }}>
        <Row style={{ height: 23, alignItems: 'center', gap: 5 }}>
          <Text style={{ color: accentFor('textDim'), fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>TEXTURES</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable tooltip="Repack all islands into equal editable cells" onPress={() => {
            const next = uniformUvPack(rectsRef.current, uv.w, uv.h);
            rectsRef.current = next;
            setRects(next);
            commit(next, `packed ${next.length} islands into uniform cells`);
          }} style={{ width: 25, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}>
            <Icon name="Grid3x3" size={11} color={accentFor('textDim')} />
          </Pressable>
          <Pressable tooltip="Import an image at its native size, then remap the UVs over it" onPress={() => {
            setNote('choosing a texture…');
            void bridge.importUvAtlas().then(setNote);
          }} style={{ width: 25, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}>
            <Icon name="ImagePlus" size={11} color={accentFor('textDim')} />
          </Pressable>
          <Pressable tooltip="Reload atlases/base.png after editing it externally" onPress={() => setNote(bridge.reloadUvAtlas())} style={{ width: 25, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}>
            <Icon name="RefreshCw" size={11} color={accentFor('textDim')} />
          </Pressable>
          {uv.diskPath ? (
            <Pressable tooltip="Write the current base.png, verify it exists, then copy its path" onPress={() => {
              const saved = bridge.saveUvAtlas();
              if (saved.path) {
                host.__clipboard_set?.(saved.path);
                setNote(`${saved.note} · path copied`);
              } else {
                setNote(saved.note);
              }
            }} style={{ width: 25, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}>
              <Icon name="Copy" size={11} color={accentFor('textDim')} />
            </Pressable>
          ) : null}
        </Row>
        <Box style={{ height: 47, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 7, backgroundColor: accentFor('segActiveBg'), borderWidth: 1, borderColor: accentFor('primary') }}>
          <Box style={{ width: 32, height: 32, position: 'relative', overflow: 'hidden', backgroundColor: '#11151d', borderWidth: 1, borderColor: accentFor('border') }}>
            <Effect shader={ATLAS_SHADER} data={thumbnailEffectData} textures={[texture.id]} style={{ position: 'absolute', left: 0, top: 0, width: 32, height: 32 }} />
          </Box>
          <Box style={{ flexGrow: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ color: accentFor('text'), fontSize: 10, fontWeight: '800' }}>base.png</Text>
            <Text style={{ color: accentFor('textFaint'), fontSize: 9, fontFamily: 'ui-monospace' }}>{`${uv.w}×${uv.h}px · ${uv.detail} texels/m`}</Text>
          </Box>
          <Icon name="Save" size={13} color={accentFor('primary')} />
        </Box>
      </Box>
    </Box>
  );
}
