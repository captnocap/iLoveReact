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
type UvLineGeometryCache = { rects: readonly UvIslandRect[]; geometry: UvLineGeometry };
type PendingUvPreview = { generation: number; rects: UvIslandRect[]; guide: UvAxisGuide | null };
type Gesture =
  | { kind: 'pan'; start: ScreenPoint; seed: View }
  | { kind: 'move'; index: number; target?: UvFaceTarget; start: ScreenPoint; screenStart: ScreenPoint; activated: boolean; doubleClick: boolean; seed: UvIslandRect }
  | { kind: 'vertex'; index: number; target?: UvFaceTarget; vertex: number; start: ScreenPoint; screenStart: ScreenPoint; activated: boolean; seed: UvIslandRect }
  | { kind: 'rotate'; index: number; target?: UvFaceTarget; center: ScreenPoint; startAngle: number; seed: UvIslandRect }
  | { kind: 'scale'; index: number; target?: UvFaceTarget; bounds: UvSelectionBounds; seed: UvIslandRect };

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

function atlasGridSegments(atlasWidth: number, atlasHeight: number, viewScale: number): number[] {
  let step = UV_LAYOUT_TUNING.vertexSnapTexels;
  while (step * viewScale < UV_LAYOUT_TUNING.minimumGridSpacingPx) step *= 2;
  const segments: number[] = [];
  for (let x = step; x < atlasWidth; x += step) {
    segments.push(x, 0, x, atlasHeight);
  }
  for (let y = step; y < atlasHeight; y += step) {
    segments.push(0, y, atlasWidth, y);
  }
  return segments;
}

function sameRectReferences(a: readonly UvIslandRect[], b: readonly UvIslandRect[]): boolean {
  return a.length === b.length && a.every((rect, index) => rect === b[index]);
}

/** Build native atlas-space geometry once. Pan, zoom, and whole-island motion
 * are Graph transforms, so a drag never re-hashes hundreds of triangle edges. */
function uvLineGeometry(items: readonly UvIslandRect[]): UvLineGeometry {
  return {
    faces: uvFaceEdgeSegments(items, 1, 1),
    boundary: uvIslandBoundarySegments(items, 1, 1),
  };
}

function repeatedPointSegments(points: readonly { x: number; y: number }[]): number[] {
  const segments = new Array<number>(points.length * 4);
  let at = 0;
  for (const point of points) {
    segments[at++] = point.x;
    segments[at++] = point.y;
    segments[at++] = point.x;
    segments[at++] = point.y;
  }
  return segments;
}

function sameAxisGuide(a: UvAxisGuide | null, b: UvAxisGuide | null): boolean {
  return a === b || Boolean(a && b && a.axis === b.axis && a.coordinate === b.coordinate);
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

export default function UvEditor(props: { uv: ModelFocusUv; bridge: ModelFocusBridge; expanded?: boolean }) {
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
  const pendingViewRef = useRef<View | null>(null);
  const viewFramePendingRef = useRef(false);
  const viewGenerationRef = useRef(0);
  const lastClickRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const [view, setViewState] = useState<View>({ x: UV_LAYOUT_TUNING.canvasPaddingPx, y: UV_LAYOUT_TUNING.canvasPaddingPx, scale: 1 });
  const viewRef = useRef(view);
  const viewKeyRef = useRef('');
  const fixedLineCacheRef = useRef<UvLineGeometryCache | null>(null);
  const activeLineCacheRef = useRef<UvLineGeometryCache | null>(null);

  const setView = (next: View) => {
    viewGenerationRef.current += 1;
    pendingViewRef.current = null;
    viewFramePendingRef.current = false;
    viewRef.current = next;
    setViewState(next);
  };
  // SDL can deliver far more motion packets than the display can present. The
  // native Graph transforms consume only the newest camera coordinates, so pan
  // previews reconcile once per host frame instead of once per mouse packet.
  const queueViewPreview = (next: View) => {
    viewRef.current = next;
    pendingViewRef.current = next;
    if (viewFramePendingRef.current) return;
    viewFramePendingRef.current = true;
    const generation = viewGenerationRef.current;
    const hostGlobal = globalThis as any;
    const schedule: (callback: () => void) => unknown = typeof hostGlobal.requestAnimationFrame === 'function'
      ? hostGlobal.requestAnimationFrame.bind(hostGlobal)
      : (callback) => setTimeout(callback, UV_LAYOUT_TUNING.dragPreviewIntervalMs);
    schedule(() => {
      if (generation !== viewGenerationRef.current) return;
      viewFramePendingRef.current = false;
      const pending = pendingViewRef.current;
      pendingViewRef.current = null;
      if (pending) setViewState(pending);
    });
  };
  const settleViewPreview = () => {
    viewGenerationRef.current += 1;
    pendingViewRef.current = null;
    viewFramePendingRef.current = false;
    setViewState(viewRef.current);
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
    const current = rectsRef.current[index];
    const currentGuide = pendingPreviewRef.current?.guide ?? axisGuide;
    if (current
      && current.x === changed.x
      && current.y === changed.y
      && current.w === changed.w
      && current.h === changed.h
      && current.group === changed.group
      && current.triangles === changed.triangles
      && sameAxisGuide(currentGuide, guide)) return;
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
    viewGenerationRef.current += 1;
    pendingViewRef.current = null;
    viewFramePendingRef.current = false;
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
    const key = `${uv.key}:${uv.w}x${uv.h}:${props.expanded ? 'expanded' : 'compact'}:${surfaceSize.width}x${surfaceSize.height}`;
    if (viewKeyRef.current === key) return;
    viewKeyRef.current = key;
    setView(fittedView(true));
  }, [uv.key, uv.w, uv.h, props.expanded, surfaceSize.width, surfaceSize.height]);

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
  // A translated island keeps identical local geometry. Cache that geometry in
  // island-local atlas units and move it by changing only the Graph view origin.
  // Dense head UVs therefore do not resend thousands of points per mouse sample.
  const selectedLocalRect = useMemo<UvIslandRect | null>(() => selectedRect ? {
    ...selectedRect,
    x: 0,
    y: 0,
  } : null, [selectedRect?.triangles, selectedRect?.w, selectedRect?.h, selectedRect?.group]);
  const selectedLocalBounds = useMemo(
    () => selectedLocalRect ? uvSelectionBounds(selectedLocalRect, selectedTarget) : null,
    [selectedLocalRect, selectedTarget?.face, selectedTarget?.group],
  );
  const selectionBounds = selectedRect && selectedLocalBounds ? {
    ...selectedLocalBounds,
    x: selectedRect.x + selectedLocalBounds.x,
    y: selectedRect.y + selectedLocalBounds.y,
    cx: selectedRect.x + selectedLocalBounds.cx,
    cy: selectedRect.y + selectedLocalBounds.cy,
  } : null;
  const selectedOutlineLocalRect = useMemo(() => selectedLocalRect && selectedTarget
    ? { ...selectedLocalRect, triangles: selectedLocalRect.triangles?.filter((triangle) => selectedTarget.group !== NO_UV_GROUP ? triangle.group === selectedTarget.group : triangle.face === selectedTarget.face) }
    : selectedLocalRect, [selectedLocalRect, selectedTarget?.face, selectedTarget?.group]);
  const cachedLineGeometry = (cacheRef: { current: UvLineGeometryCache | null }, items: readonly UvIslandRect[]): UvLineGeometry => {
    const cached = cacheRef.current;
    if (cached
      && sameRectReferences(cached.rects, items)) return cached.geometry;
    const geometry = uvLineGeometry(items);
    cacheRef.current = { rects: [...items], geometry };
    return geometry;
  };
  const fixedRects = rects.filter((_rect, index) => index !== selected);
  const fixedLines = cachedLineGeometry(fixedLineCacheRef, fixedRects);
  const selectedIslandLines = useMemo(
    () => selectedLocalRect ? uvLineGeometry([selectedLocalRect]) : { faces: [], boundary: [] },
    [selectedLocalRect],
  );
  const selectedOutlineLines = useMemo(() => selectedOutlineLocalRect === selectedLocalRect
    ? selectedIslandLines
    : selectedOutlineLocalRect ? uvLineGeometry([selectedOutlineLocalRect]) : { faces: [], boundary: [] },
  [selectedOutlineLocalRect, selectedLocalRect, selectedIslandLines]);
  const activeFixedRects = activeRange ? fixedRects.filter((rect) => rect.group >= activeRange.lo && rect.group < activeRange.hi) : [];
  const activeFixedLines = activeFixedRects.length ? cachedLineGeometry(activeLineCacheRef, activeFixedRects) : { faces: [], boundary: [] };
  const selectedActiveBoundary = selectedRect && activeRange && selectedRect.group >= activeRange.lo && selectedRect.group < activeRange.hi
    ? selectedIslandLines.boundary
    : [];
  const localHandlePoints = useMemo(
    () => selectedLocalRect ? uvSelectionVertices(selectedLocalRect, selectedTarget) : [],
    [selectedLocalRect, selectedTarget?.face, selectedTarget?.group],
  );
  const handleSegments = useMemo(() => repeatedPointSegments(localHandlePoints), [localHandlePoints]);
  const rotationHandle = selectionBounds ? {
    x: view.x + selectionBounds.cx * view.scale,
    y: view.y + selectionBounds.y * view.scale - UV_LAYOUT_TUNING.rotationHandleOffsetPx,
  } : null;
  const scaleHandle = selectionBounds ? {
    x: view.x + (selectionBounds.x + selectionBounds.w) * view.scale + UV_LAYOUT_TUNING.scaleHandleOffsetPx,
    y: view.y + (selectionBounds.y + selectionBounds.h) * view.scale + UV_LAYOUT_TUNING.scaleHandleOffsetPx,
  } : null;
  const hitHandle = (point: ScreenPoint): number => {
    if (!selectedRect) return -1;
    const atlas = atlasPoint(point);
    const localX = atlas.x - selectedRect.x;
    const localY = atlas.y - selectedRect.y;
    const radius = UV_LAYOUT_TUNING.vertexHandleHitPx / Math.max(UV_LAYOUT_TUNING.minimumZoom, viewRef.current.scale);
    for (let index = 0; index < localHandlePoints.length; index += 1) {
      const handle = localHandlePoints[index]!;
      if (Math.abs(localX - handle.x) <= radius && Math.abs(localY - handle.y) <= radius) return index;
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
    () => atlasGridSegments(uv.w, uv.h, view.scale),
    [uv.w, uv.h, view.scale],
  );
  const inverseViewScale = 1 / Math.max(UV_LAYOUT_TUNING.minimumZoom, view.scale);
  const selectionFrameSegments = selectedLocalBounds
    ? (() => {
      const x0 = selectedLocalBounds.x;
      const y0 = selectedLocalBounds.y;
      const x1 = selectedLocalBounds.x + selectedLocalBounds.w;
      const y1 = selectedLocalBounds.y + selectedLocalBounds.h;
      return [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
    })()
    : [];
  const rotationStemSegments = selectedLocalBounds
    ? [selectedLocalBounds.cx, selectedLocalBounds.y - UV_LAYOUT_TUNING.rotationHandleOffsetPx * inverseViewScale, selectedLocalBounds.cx, selectedLocalBounds.y]
    : [];
  const guideSegments = axisGuide
    ? axisGuide.axis === 'horizontal'
      ? [0, axisGuide.coordinate, uv.w, axisGuide.coordinate]
      : [axisGuide.coordinate, 0, axisGuide.coordinate, uv.h]
    : [];
  const host = globalThis as any;
  const finishGesture = (event?: any) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture?.kind === 'pan') {
      settleViewPreview();
      setAxisGuide(null);
    } else if (gesture) settleUvPreview();
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
            queueViewPreview({ x: gesture.seed.x + screen.x - gesture.start.x, y: gesture.seed.y + screen.y - gesture.start.y, scale: gesture.seed.scale });
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
        {/* Grid and mesh lines stay in native atlas-space and pan/zoom through
            Graph's native transform, so their point buffers remain immutable
            while the view or a complete island moves. */}
        <Graph
          style={{ position: 'absolute', left: 0, top: 0, width: surfaceSize.width, height: surfaceSize.height, pointerEvents: 'none' }}
          viewX={-view.x * inverseViewScale}
          viewY={-view.y * inverseViewScale}
          viewZoom={view.scale}
          originTopLeft
        >
          {gridSegments.length ? <Graph.Polyline segments points={gridSegments} stroke="#4d596b" strokeWidth={0.8 * inverseViewScale} /> : null}
          {fixedLines.faces.length ? <Graph.Polyline segments points={fixedLines.faces} stroke="#080b10" strokeWidth={2.4 * inverseViewScale} /> : null}
          {fixedLines.faces.length ? <Graph.Polyline segments points={fixedLines.faces} stroke="#8591a3" strokeWidth={0.9 * inverseViewScale} /> : null}
          {fixedLines.boundary.length ? <Graph.Polyline segments points={fixedLines.boundary} stroke="#080b10" strokeWidth={3.2 * inverseViewScale} /> : null}
          {fixedLines.boundary.length ? <Graph.Polyline segments points={fixedLines.boundary} stroke="#c7d0df" strokeWidth={1.15 * inverseViewScale} /> : null}
          {activeFixedLines.boundary.length ? <Graph.Polyline segments points={activeFixedLines.boundary} stroke="#42d9e8" strokeWidth={1.65 * inverseViewScale} /> : null}
        </Graph>
        {selectedRect ? (
          <Graph
            style={{ position: 'absolute', left: 0, top: 0, width: surfaceSize.width, height: surfaceSize.height, pointerEvents: 'none' }}
            viewX={-view.x * inverseViewScale - selectedRect.x}
            viewY={-view.y * inverseViewScale - selectedRect.y}
            viewZoom={view.scale}
            originTopLeft
          >
            {selectedIslandLines.faces.length ? <Graph.Polyline segments points={selectedIslandLines.faces} stroke="#080b10" strokeWidth={2.4 * inverseViewScale} /> : null}
            {selectedIslandLines.faces.length ? <Graph.Polyline segments points={selectedIslandLines.faces} stroke="#8591a3" strokeWidth={0.9 * inverseViewScale} /> : null}
            {selectedIslandLines.boundary.length ? <Graph.Polyline segments points={selectedIslandLines.boundary} stroke="#080b10" strokeWidth={3.2 * inverseViewScale} /> : null}
            {selectedIslandLines.boundary.length ? <Graph.Polyline segments points={selectedIslandLines.boundary} stroke="#c7d0df" strokeWidth={1.15 * inverseViewScale} /> : null}
            {selectedActiveBoundary.length ? <Graph.Polyline segments points={selectedActiveBoundary} stroke="#42d9e8" strokeWidth={1.65 * inverseViewScale} /> : null}
            {selectedOutlineLines.faces.length ? <Graph.Polyline segments points={selectedOutlineLines.faces} stroke="#ffffff" strokeWidth={1.35 * inverseViewScale} /> : null}
            {selectedOutlineLines.boundary.length ? <Graph.Polyline segments points={selectedOutlineLines.boundary} stroke="#ffffff" strokeWidth={2.2 * inverseViewScale} /> : null}
            {selectionFrameSegments.length ? <Graph.Polyline segments points={selectionFrameSegments} stroke="#9ba8bc" strokeWidth={1 * inverseViewScale} /> : null}
            {rotationStemSegments.length ? <Graph.Polyline segments points={rotationStemSegments} stroke="#dce5f2" strokeWidth={1 * inverseViewScale} /> : null}
            {handleSegments.length ? <Graph.Polyline segments points={handleSegments} stroke="#11151d" strokeWidth={9 * inverseViewScale} /> : null}
            {handleSegments.length ? <Graph.Polyline segments points={handleSegments} stroke="#f8fafc" strokeWidth={7 * inverseViewScale} /> : null}
          </Graph>
        ) : null}
        {guideSegments.length ? (
          <Graph
            style={{ position: 'absolute', left: 0, top: 0, width: surfaceSize.width, height: surfaceSize.height, pointerEvents: 'none' }}
            viewX={-view.x * inverseViewScale}
            viewY={-view.y * inverseViewScale}
            viewZoom={view.scale}
            originTopLeft
          >
            <Graph.Polyline segments points={guideSegments} stroke="#4c9dff" strokeWidth={1.5 * inverseViewScale} />
          </Graph>
        ) : null}
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
