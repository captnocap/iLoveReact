import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Graph, Paintable, Pressable, Row, Text, TextInput } from '../../../runtime/primitives';
import { usePaintable } from '../../../runtime/hooks/usePaintable';
import { useContextMenu } from '../../../runtime/hooks/useContextMenu';
import { Icon } from '../../../runtime/icons/Icon';
import { parseClampedNumericDraft, replacementDraftAfterEdit } from '../../../runtime/paint/numericInput';
import { C, accentFor } from '../workspace.cls';
import type { ModelFocusBridge, ModelFocusUv } from '../stage/ModelView';
import { isUvDocumentHistoryLabel, UV_HISTORY_TUNING, uvHistoryAvailability, type ModelHistoryDepths, type UvHistoryAction } from '../model/uvHistory';
import {
  chainUvIslands,
  flattenUvFaceCorners,
  flipUvSelection,
  hitUvGridGuide,
  hitUvGuide,
  hitUvFace,
  hitUvIsland,
  isUvDoubleClick,
  matchUvIslandSize,
  moveUvFace,
  moveUvIsland,
  moveUvIslands,
  moveUvSelectionVertex,
  NO_UV_GROUP,
  panUvCanvasView,
  pasteUvTransform,
  rotateUvSelection,
  scaleUvSelection,
  shouldActivateUvDrag,
  snapUvBoundsToGuides,
  snapUvTranslationToGridAndGuides,
  stackUvIslands,
  stitchUvIslands,
  toggleUvGridGuide,
  uniformUvPack,
  uvContextMenuPosition,
  uvCornerIdentityColor,
  uvFaceCornerIdentityMarkers,
  uvSelectionModeAfterDoubleClick,
  uvFaceEdgeSegments,
  uvIslandBoundarySegments,
  uvIslandSetBounds,
  uvSelectionBounds,
  uvSelectionVertices,
  uvTranslationSnapStep,
  UV_LAYOUT_TUNING,
  UV_SNAP_STEPS,
  type UvAxisGuide,
  type UvCanvasRect,
  type UvCanvasView,
  type UvFaceTarget,
  type UvFlipAxis,
  type UvIslandRect,
  type UvSelectionBounds,
  type UvSelectionMode,
  type UvSizeMatch,
  type UvTransformFrame,
  zoomUvCanvasViewAt,
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

type ScreenPoint = { x: number; y: number };
type UvLineGeometry = { faces: number[]; boundary: number[] };
type UvLineGeometryCache = { rects: readonly UvIslandRect[]; geometry: UvLineGeometry };
type PendingUvPreview = { generation: number; rects: UvIslandRect[]; guide: UvAxisGuide | null };
type UvPanelHistory = Readonly<{ uv: ModelHistoryDepths; paint: ModelHistoryDepths }>;
type UvMenuGroup = 'transform' | 'arrange' | 'snap' | 'edit' | 'texture';
const UV_CONTEXT_MENU_TUNING = {
  widthPx: 220,
  edgePx: 4,
  baseHeightPx: 330,
  rowHeightPx: 26,
  expandedRows: { transform: 8, arrange: 6, snap: 6, edit: 2, texture: 5 } as Record<UvMenuGroup, number>,
} as const;
type Gesture =
  | { kind: 'pan'; start: ScreenPoint; seed: UvCanvasView }
  | { kind: 'move'; index: number; indices: number[]; target?: UvFaceTarget; bounds: UvSelectionBounds; start: ScreenPoint; screenStart: ScreenPoint; activated: boolean; doubleClick: boolean; seed: UvIslandRect; seedRects: UvIslandRect[] }
  | { kind: 'vertex'; index: number; target?: UvFaceTarget; vertex: number; origin: ScreenPoint; start: ScreenPoint; screenStart: ScreenPoint; activated: boolean; seed: UvIslandRect }
  | { kind: 'rotate'; index: number; target?: UvFaceTarget; center: ScreenPoint; startAngle: number; seed: UvIslandRect }
  | { kind: 'scale'; index: number; target?: UvFaceTarget; bounds: UvSelectionBounds; seed: UvIslandRect };

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

function sameHistory(a: ModelHistoryDepths, b: ModelHistoryDepths): boolean {
  return a.undo === b.undo
    && a.redo === b.redo
    && a.undoLabel === b.undoLabel
    && a.redoLabel === b.redoLabel;
}

function samePanelHistory(a: UvPanelHistory, b: UvPanelHistory): boolean {
  return sameHistory(a.uv, b.uv) && sameHistory(a.paint, b.paint);
}

function atlasGridSegments(atlasWidth: number, atlasHeight: number, step: number): { minor: number[]; major: number[] } {
  const minor: number[] = [];
  const major: number[] = [];
  for (let x = step; x < atlasWidth; x += step) {
    const segments = Math.round(x / step) % UV_LAYOUT_TUNING.majorGridEvery === 0 ? major : minor;
    segments.push(x, 0, x, atlasHeight);
  }
  for (let y = step; y < atlasHeight; y += step) {
    const segments = Math.round(y / step) % UV_LAYOUT_TUNING.majorGridEvery === 0 ? major : minor;
    segments.push(0, y, atlasWidth, y);
  }
  return { minor, major };
}

function sameRectReferences(a: readonly UvIslandRect[], b: readonly UvIslandRect[]): boolean {
  return a.length === b.length && a.every((rect, index) => rect === b[index]);
}

function sameRectValues(a: readonly UvIslandRect[], b: readonly UvIslandRect[]): boolean {
  return a.length === b.length && a.every((rect, index) => {
    const other = b[index];
    return Boolean(other
      && rect.x === other.x
      && rect.y === other.y
      && rect.w === other.w
      && rect.h === other.h
      && rect.group === other.group
      && rect.triangles === other.triangles);
  });
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

function uvRectFrame(rect: UvIslandRect): UvSelectionBounds {
  return {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    cx: rect.x + rect.w * 0.5,
    cy: rect.y + rect.h * 0.5,
  };
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

function UvContextRow(props: {
  icon: string;
  label: string;
  detail?: string;
  active?: boolean;
  enabled?: boolean;
  expanded?: boolean;
  indented?: boolean;
  tooltip?: string;
  onPress: () => void;
}) {
  const enabled = props.enabled !== false;
  const rowStyle = {
    ...(enabled ? {} : { opacity: 0.36 }),
    ...(props.indented ? { paddingLeft: 26 } : {}),
  };
  const rowProps = {
    ...(enabled ? { onPress: props.onPress } : {}),
    ...(Object.keys(rowStyle).length ? { style: rowStyle } : {}),
    ...(props.tooltip ? { tooltip: props.tooltip } : {}),
  };
  const textProps = props.active ? { style: { color: accentFor('primary'), fontWeight: '800' } } : {};
  return (
    <C.HW_ContextRow {...rowProps}>
      <Icon name={props.icon} size={12} color={accentFor(props.active ? 'primary' : 'textDim')} />
      <C.HW_ContextText {...textProps}>{props.label}</C.HW_ContextText>
      <C.HW_Spacer />
      {props.detail ? <C.HW_KeyText>{props.detail}</C.HW_KeyText> : null}
      {props.expanded !== undefined ? <Icon name={props.expanded ? 'ChevronDown' : 'ChevronRight'} size={11} color={accentFor('textFaint')} /> : null}
    </C.HW_ContextRow>
  );
}

function UvContextDivider() {
  return <Box style={{ height: 1, marginTop: 3, marginBottom: 3, backgroundColor: accentFor('borderSoft') }} />;
}

export default function UvEditor(props: { uv: ModelFocusUv; bridge: ModelFocusBridge; focused?: boolean }) {
  const { uv, bridge } = props;
  const [documentHistory, setDocumentHistory] = useState<UvPanelHistory>(() => bridge.readUvHistory());
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (!live) return;
      const next = bridge.readUvHistory();
      setDocumentHistory((current) => samePanelHistory(current, next) ? current : next);
    };
    refresh();
    const timer = setInterval(refresh, UV_HISTORY_TUNING.refreshMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [bridge]);
  const texture = usePaintable({ id: `editor-live-uv-${uv.key}`, w: uv.w, h: uv.h });
  const initialRects = () => uv.islands.map((rect) => ({ ...rect }));
  const [rects, setRects] = useState<UvIslandRect[]>(initialRects);
  const rectsRef = useRef(rects);
  const initialSelectedIslands = () => uv.selectedIslands.filter((index) => index >= 0 && index < uv.islands.length);
  const [selectedIndices, setSelectedIndices] = useState<number[]>(initialSelectedIslands);
  const selectedIndicesRef = useRef(selectedIndices);
  const [selected, setSelected] = useState(initialSelectedIslands()[0] ?? -1);
  const [selectedFace, setSelectedFace] = useState<UvFaceTarget | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<UvSelectionMode>('island');
  const [snapBaseStep, setSnapBaseStep] = useState<number>(UV_SNAP_STEPS[0]);
  const [aspectLocked, setAspectLocked] = useState(false);
  const [menuGroup, setMenuGroup] = useState<UvMenuGroup | null>(null);
  // Copy/Paste Transform clipboard (req_3427) — one frame survives selection changes;
  // where the context menu opened, in atlas texels, so Move Here lands on the cursor.
  const [transformClipboard, setTransformClipboard] = useState<UvTransformFrame | null>(null);
  const menuAtlasPointRef = useRef<ScreenPoint>({ x: 0, y: 0 });
  const uvMenu = useContextMenu();
  const [axisGuide, setAxisGuide] = useState<UvAxisGuide | null>(null);
  const [selectedGuides, setSelectedGuides] = useState<UvAxisGuide[]>([]);
  const selectedGuidesRef = useRef<UvAxisGuide[]>([]);
  const [surfaceSize, setSurfaceSize] = useState({ width: 1, height: 1 });
  const panelRef = useRef<UvCanvasRect>({ x: 0, y: 0, width: 1, height: 1 });
  const surfaceRef = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const gestureRef = useRef<Gesture | null>(null);
  const middlePanTimerRef = useRef<any>(null);
  const middlePanActiveRef = useRef(false);
  const pendingPreviewRef = useRef<PendingUvPreview | null>(null);
  const previewFramePendingRef = useRef(false);
  const previewGenerationRef = useRef(0);
  const pendingViewRef = useRef<UvCanvasView | null>(null);
  const viewFramePendingRef = useRef(false);
  const viewGenerationRef = useRef(0);
  const lastClickRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const [view, setViewState] = useState<UvCanvasView>({ x: UV_LAYOUT_TUNING.canvasPaddingPx, y: UV_LAYOUT_TUNING.canvasPaddingPx, scale: 1 });
  const viewRef = useRef(view);
  const viewKeyRef = useRef('');
  const fixedLineCacheRef = useRef<UvLineGeometryCache | null>(null);
  const activeLineCacheRef = useRef<UvLineGeometryCache | null>(null);

  const publishGuides = (next: UvAxisGuide[]) => {
    selectedGuidesRef.current = next;
    setSelectedGuides(next);
  };

  useEffect(() => {
    selectedGuidesRef.current = [];
    setSelectedGuides([]);
  }, [uv.key, uv.w, uv.h]);

  const setView = (next: UvCanvasView) => {
    viewGenerationRef.current += 1;
    pendingViewRef.current = null;
    viewFramePendingRef.current = false;
    viewRef.current = next;
    setViewState(next);
  };
  // SDL can deliver far more motion packets than the display can present. The
  // native Graph transforms consume only the newest camera coordinates, so pan
  // previews reconcile once per host frame instead of once per mouse packet.
  const queueViewPreview = (next: UvCanvasView) => {
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
  const fittedView = (nativeScale = false): UvCanvasView => {
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
  const queueUvRectsPreview = (next: UvIslandRect[], guide: UvAxisGuide | null) => {
    const currentGuide = pendingPreviewRef.current?.guide ?? axisGuide;
    if (sameRectValues(rectsRef.current, next) && sameAxisGuide(currentGuide, guide)) return;
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
  const queueUvPreview = (index: number, changed: UvIslandRect, guide: UvAxisGuide | null) => {
    const next = rectsRef.current.map((rect, rectIndex) => rectIndex === index ? changed : rect);
    queueUvRectsPreview(next, guide);
  };

  const settleUvPreview = () => {
    previewGenerationRef.current += 1;
    pendingPreviewRef.current = null;
    previewFramePendingRef.current = false;
    setRects(rectsRef.current);
    setAxisGuide(null);
  };

  useEffect(() => () => {
    if (middlePanTimerRef.current) clearTimeout(middlePanTimerRef.current);
    middlePanTimerRef.current = null;
    middlePanActiveRef.current = false;
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
    const validSelection = selectedIndicesRef.current.filter((index) => index >= 0 && index < next.length);
    selectedIndicesRef.current = validSelection;
    setSelectedIndices(validSelection);
    setAxisGuide(null);
    setSelected((index) => validSelection.includes(index) ? index : validSelection[0] ?? Math.min(index, uv.islands.length - 1));
    setSelectedFace((target) => target && next.some((rect) => rect.triangles?.some((triangle) => triangle.face === target.face)) ? target : null);
    if (uv.rgba) texture.paint.upload(uv.rgba);
  }, [uv.key, uv.revision]);

  const synchronizedSelectionKey = uv.selectedIslands.join(',');
  useEffect(() => {
    const next = uv.selectedIslands.filter((index) => index >= 0 && index < rectsRef.current.length);
    selectedIndicesRef.current = next;
    setSelectedIndices(next);
    setSelected(next[0] ?? -1);
  }, [synchronizedSelectionKey]);

  const publishIslandSelection = (indices: number[], primary: number) => {
    selectedIndicesRef.current = indices;
    setSelectedIndices(indices);
    setSelected(primary);
    setSelectedFace(null);
  };
  const selectIslandAt = (index: number, additive: boolean): number[] => {
    const current = selectedIndicesRef.current;
    let next: number[];
    if (index < 0) next = additive ? current : [];
    else if (additive) next = current.includes(index)
      ? current.filter((selectedIndex) => selectedIndex !== index)
      : [...current, index];
    else next = current.includes(index) && current.length > 1 ? current : [index];
    const primary = index >= 0 && next.includes(index) ? index : next[next.length - 1] ?? -1;
    publishIslandSelection(next, primary);
    return next;
  };

  useEffect(() => {
    if (surfaceSize.width <= 1 || surfaceSize.height <= 1) return;
    const key = `${uv.key}:${uv.w}x${uv.h}:${props.focused ? 'focus' : 'panel'}:${surfaceSize.width}x${surfaceSize.height}`;
    if (viewKeyRef.current === key) return;
    viewKeyRef.current = key;
    setView(fittedView(true));
  }, [uv.key, uv.w, uv.h, props.focused, surfaceSize.width, surfaceSize.height]);

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
  const commit = (next: UvIslandRect[], label: string, action: UvHistoryAction) => {
    const corners = flattenUvFaceCorners(next);
    if (!corners || !bridge.applyUvGeometry(corners, action)) {
      const restored = initialRects();
      rectsRef.current = restored;
      setRects(restored);
      setNote(`${label} refused — live model changed; atlas was refreshed`);
      bridge.refreshUv();
      return;
    }
    setNote(label);
  };
  const replaceSelected = (changed: UvIslandRect, label: string, action: UvHistoryAction) => {
    if (selected < 0) return;
    const next = rectsRef.current.map((rect, index) => index === selected ? changed : rect);
    rectsRef.current = next;
    setRects(next);
    commit(next, label, action);
  };
  const flipSelected = (axis: UvFlipAxis) => {
    const rect = rectsRef.current[selected];
    if (!rect) {
      setNote('Select a UV island or face before flipping it.');
      return;
    }
    const changed = flipUvSelection(rect, selectedTarget, axis, uv.w, uv.h);
    const subject = selectedTarget ? 'UV face' : 'UV island';
    replaceSelected(changed, `flipped ${subject} ${axis === 'u' ? 'horizontally (U)' : 'vertically (V)'}`, axis === 'u' ? 'flip-u' : 'flip-v');
  };

  const activeRange = (globalThis as any).__modelActivePartRange as { lo: number; hi: number } | null | undefined;
  const selectedIndicesKey = selectedIndices.join(',');
  const selectedIndexSet = useMemo(() => new Set(selectedIndices), [selectedIndicesKey]);
  const multiIslandSelection = selectionMode === 'island' && selectedIndices.length > 1;
  const selectedRect = selected >= 0 ? rects[selected] ?? null : null;
  const selectedTarget = selectionMode === 'face' ? selectedFace ?? undefined : undefined;
  const translationSnapStep = uvTranslationSnapStep(view.scale, snapBaseStep);
  const toggleGridGuideAt = (point: ScreenPoint): boolean => {
    const hitDistance = UV_LAYOUT_TUNING.guideHitPx / Math.max(UV_LAYOUT_TUNING.minimumZoom, viewRef.current.scale);
    const guide = hitUvGuide(
      point,
      uv.w,
      uv.h,
      selectedGuidesRef.current,
      hitDistance,
    ) ?? hitUvGridGuide(
      point,
      uv.w,
      uv.h,
      translationSnapStep,
      hitDistance,
    );
    if (!guide) return false;
    const removing = selectedGuidesRef.current.some((item) => (
      item.axis === guide.axis && item.coordinate === guide.coordinate
    ));
    const next = toggleUvGridGuide(selectedGuidesRef.current, guide);
    publishGuides(next);
    lastClickRef.current = null;
    const coordinate = guide.axis === 'vertical' ? `U ${guide.coordinate}` : `V ${guide.coordinate}`;
    setNote(`${removing ? 'removed' : 'selected'} ${guide.axis} guide at ${coordinate} · Alt bypasses guide snapping`);
    return true;
  };
  const snapToSelectedGuides = (bounds: UvSelectionBounds) => snapUvBoundsToGuides(
    bounds,
    selectedGuidesRef.current,
    UV_LAYOUT_TUNING.guideSnapPx / Math.max(UV_LAYOUT_TUNING.minimumZoom, viewRef.current.scale),
  );
  const applyIslandSetEdit = (next: UvIslandRect[], label: string, action: UvHistoryAction) => {
    if (sameRectReferences(rectsRef.current, next)) {
      setNote(`${label} — selection was already there`);
      return;
    }
    rectsRef.current = next;
    setRects(next);
    commit(next, label, action);
  };
  const matchSelectedSize = (mode: UvSizeMatch) => {
    if (!multiIslandSelection) {
      setNote('Shift-click two or more UV islands first.');
      return;
    }
    const next = matchUvIslandSize(rectsRef.current, selectedIndicesRef.current, selected, mode, uv.w, uv.h);
    const dimension = mode === 'both' ? 'size' : mode;
    const action: UvHistoryAction = mode === 'both' ? 'match-size' : mode === 'width' ? 'match-width' : 'match-height';
    applyIslandSetEdit(next, `matched ${selectedIndices.length} islands to the active island's ${dimension}`, action);
  };
  const chainSelected = (axis: 'horizontal' | 'vertical') => {
    if (!multiIslandSelection) {
      setNote('Shift-click two or more UV islands first.');
      return;
    }
    const result = chainUvIslands(rectsRef.current, selectedIndicesRef.current, axis, uv.w, uv.h, translationSnapStep);
    if (!result.fits) {
      setNote(`selected islands need more atlas space for a ${axis} chain`);
      return;
    }
    applyIslandSetEdit(result.rects, `chained ${selectedIndices.length} islands ${axis === 'horizontal' ? 'left to right' : 'top to bottom'}`, axis === 'horizontal' ? 'chain-horizontal' : 'chain-vertical');
  };
  const stackSelected = () => {
    if (!multiIslandSelection) {
      setNote('Shift-click two or more UV islands first.');
      return;
    }
    const result = stackUvIslands(rectsRef.current, selectedIndicesRef.current, selected);
    if (result.compatible === 0) {
      setNote('Exact stack needs islands with the same triangle count as the active island.');
      return;
    }
    const skipped = result.skipped > 0 ? ` · skipped ${result.skipped} incompatible` : '';
    applyIslandSetEdit(result.rects, `exact-stacked ${result.compatible + 1} islands onto the active UV${skipped}`, 'stack');
  };
  const stitchSelected = () => {
    if (!multiIslandSelection) {
      setNote('Shift-click two or more UV islands first.');
      return;
    }
    const result = stitchUvIslands(rectsRef.current, selectedIndicesRef.current, selected, uv.w, uv.h);
    if (result.stitched === 0) {
      setNote(result.blocked > 0
        ? 'Matching seams were found, but their exact fit would leave the atlas.'
        : 'Selected islands do not share a welded model edge or unambiguous boundary vertex.');
      return;
    }
    const seams = result.seamEdges > 0
      ? `${result.seamEdges} matching ${result.seamEdges === 1 ? 'edge' : 'edges'}`
      : `${result.seamVertices} matching ${result.seamVertices === 1 ? 'vertex' : 'vertices'}`;
    const unmatched = result.unmatched > 0 ? ` · ${result.unmatched} unrelated left in place` : '';
    const blocked = result.blocked > 0 ? ` · ${result.blocked} atlas-blocked` : '';
    applyIslandSetEdit(
      result.rects,
      `stitched ${result.stitched} ${result.stitched === 1 ? 'island' : 'islands'} to the active UV across ${seams}${unmatched}${blocked}`,
      'stitch',
    );
  };
  const restoreSelectedShapes = () => {
    const indices = selectedIndicesRef.current;
    if (selectionMode !== 'island' || indices.length === 0) {
      setNote('Select one or more complete UV islands first.');
      return;
    }
    if (!bridge.restoreUvShapes(new Uint32Array(indices))) {
      setNote('Restore Shape refused — the live mesh or UV selection changed.');
      bridge.refreshUv();
      return;
    }
    setNote(`restored ${indices.length} UV ${indices.length === 1 ? 'island' : 'islands'} from the 3D mesh`);
  };
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
  const primarySelectionBounds = selectedRect && selectedLocalBounds ? {
    ...selectedLocalBounds,
    x: selectedRect.x + selectedLocalBounds.x,
    y: selectedRect.y + selectedLocalBounds.y,
    cx: selectedRect.x + selectedLocalBounds.cx,
    cy: selectedRect.y + selectedLocalBounds.cy,
  } : null;
  const selectedGroupBounds = multiIslandSelection ? uvIslandSetBounds(rects, selectedIndices) : null;
  const selectionBounds = selectedGroupBounds ?? primarySelectionBounds;
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
  const fixedRects = rects.filter((_rect, index) => !selectedIndexSet.has(index));
  const fixedLines = cachedLineGeometry(fixedLineCacheRef, fixedRects);
  const secondarySelectedRects = rects.filter((_rect, index) => selectedIndexSet.has(index) && index !== selected);
  const secondarySelectedLines = useMemo(
    () => secondarySelectedRects.length ? uvLineGeometry(secondarySelectedRects) : { faces: [], boundary: [] },
    [rects, selected, selectedIndicesKey],
  );
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
    () => selectedLocalRect && !multiIslandSelection ? uvSelectionVertices(selectedLocalRect, selectedTarget) : [],
    [selectedLocalRect, selectedTarget?.face, selectedTarget?.group, multiIslandSelection],
  );
  const handleSegments = useMemo(() => repeatedPointSegments(localHandlePoints), [localHandlePoints]);
  const selectedFacesKey = uv.selectedFaces.join(',');
  const cornerIdentityMarkers = useMemo(
    () => uvFaceCornerIdentityMarkers(rects, uv.selectedFaces),
    [rects, selectedFacesKey],
  );
  const rotationHandle = primarySelectionBounds && !multiIslandSelection ? {
    x: view.x + primarySelectionBounds.cx * view.scale,
    y: view.y + primarySelectionBounds.y * view.scale - UV_LAYOUT_TUNING.rotationHandleOffsetPx,
  } : null;
  const scaleHandle = primarySelectionBounds && !multiIslandSelection ? {
    x: view.x + (primarySelectionBounds.x + primarySelectionBounds.w) * view.scale + UV_LAYOUT_TUNING.scaleHandleOffsetPx,
    y: view.y + (primarySelectionBounds.y + primarySelectionBounds.h) * view.scale + UV_LAYOUT_TUNING.scaleHandleOffsetPx,
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
    setView(zoomUvCanvasViewAt(viewRef.current, point, factor));
  };

  const changeCoordinate = (field: 'x' | 'y' | 'w' | 'h', value: number) => {
    const rect = selectedRect;
    const bounds = selectionBounds;
    if (!rect || !bounds) return;
    if (multiIslandSelection) {
      if (field === 'w' || field === 'h') {
        setNote('Use W =, H =, or W×H to normalize a multi-island set.');
        return;
      }
      const dx = field === 'x' ? value - bounds.x : 0;
      const dy = field === 'y' ? value - bounds.y : 0;
      const next = moveUvIslands(rectsRef.current, selectedIndicesRef.current, dx, dy, uv.w, uv.h, UV_LAYOUT_TUNING.vertexSnapTexels, true);
      applyIslandSetEdit(next, `set UV group ${field.toUpperCase()} to ${value}`, 'numeric');
      return;
    }
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
    replaceSelected(changed, `set UV ${field.toUpperCase()} to ${value}`, 'numeric');
  };

  const atlasW = uv.w * view.scale;
  const atlasH = uv.h * view.scale;
  const atlasEffectData = useMemo(() => [atlasW, atlasH, UV_LAYOUT_TUNING.checkerPx, 0], [atlasW, atlasH]);
  const thumbnailEffectData = useMemo(() => [32, 32, UV_LAYOUT_TUNING.checkerPx, 0], []);
  const gridSegments = useMemo(
    () => atlasGridSegments(uv.w, uv.h, translationSnapStep),
    [uv.w, uv.h, translationSnapStep],
  );
  const inverseViewScale = 1 / Math.max(UV_LAYOUT_TUNING.minimumZoom, view.scale);
  const selectionFrameSegments = selectedLocalBounds && !multiIslandSelection
    ? (() => {
      const x0 = selectedLocalBounds.x;
      const y0 = selectedLocalBounds.y;
      const x1 = selectedLocalBounds.x + selectedLocalBounds.w;
      const y1 = selectedLocalBounds.y + selectedLocalBounds.h;
      return [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
    })()
    : [];
  const rotationStemSegments = selectedLocalBounds && !multiIslandSelection
    ? [selectedLocalBounds.cx, selectedLocalBounds.y - UV_LAYOUT_TUNING.rotationHandleOffsetPx * inverseViewScale, selectedLocalBounds.cx, selectedLocalBounds.y]
    : [];
  const groupFrameSegments = selectedGroupBounds
    ? [
      selectedGroupBounds.x, selectedGroupBounds.y, selectedGroupBounds.x + selectedGroupBounds.w, selectedGroupBounds.y,
      selectedGroupBounds.x + selectedGroupBounds.w, selectedGroupBounds.y, selectedGroupBounds.x + selectedGroupBounds.w, selectedGroupBounds.y + selectedGroupBounds.h,
      selectedGroupBounds.x + selectedGroupBounds.w, selectedGroupBounds.y + selectedGroupBounds.h, selectedGroupBounds.x, selectedGroupBounds.y + selectedGroupBounds.h,
      selectedGroupBounds.x, selectedGroupBounds.y + selectedGroupBounds.h, selectedGroupBounds.x, selectedGroupBounds.y,
    ]
    : [];
  const guideSegments = axisGuide
    ? axisGuide.axis === 'horizontal'
      ? [0, axisGuide.coordinate, uv.w, axisGuide.coordinate]
      : [axisGuide.coordinate, 0, axisGuide.coordinate, uv.h]
    : [];
  const selectedGuideSegments = useMemo(() => selectedGuides.flatMap((guide) => (
    guide.axis === 'horizontal'
      ? [0, guide.coordinate, uv.w, guide.coordinate]
      : [guide.coordinate, 0, guide.coordinate, uv.h]
  )), [selectedGuides, uv.w, uv.h]);
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
      const moved = gesture.indices.some((index) => rectsRef.current[index] !== gesture.seedRects[index]);
      if (moved) {
        const label = gesture.target
          ? 'detached and moved UV face'
          : gesture.indices.length > 1
            ? `moved ${gesture.indices.length} UV islands as one group`
            : 'moved UV island over the fixed texture';
        commit(rectsRef.current, label, 'move');
      }
    }
    if (gesture?.kind === 'vertex' && rectsRef.current[gesture.index] !== gesture.seed) commit(rectsRef.current, 'moved UV vertex over the fixed texture', 'vertex');
    if (gesture?.kind === 'rotate') commit(rectsRef.current, gesture.target ? 'rotated detached UV face' : 'rotated UV island', 'rotate');
    if (gesture?.kind === 'scale') commit(rectsRef.current, gesture.target ? 'scaled detached UV face' : 'scaled UV island', 'scale');
  };
  const history = documentHistory.uv;
  const paintHistory = documentHistory.paint;
  const historyAvailable = uvHistoryAvailability(history, paintHistory);
  const canUndoUv = historyAvailable.undo;
  const canRedoUv = historyAvailable.redo;
  const stepHistory = (redo: boolean) => {
    setNote(redo ? bridge.redoUvHistory() : bridge.undoUvHistory());
    setDocumentHistory(bridge.readUvHistory());
  };
  const historyTooltip = (redo: boolean): string => {
    const depth = redo ? history.redo : history.undo;
    const label = redo ? history.redoLabel : history.undoLabel;
    const verb = redo ? 'Redo' : 'Undo';
    if (depth <= 0) return `${verb} — UV history is empty`;
    if (!isUvDocumentHistoryLabel(label)) return `${verb} “${label || 'model edit'}” from the app-wide history control`;
    const paintBarrier = redo ? paintHistory.redo : paintHistory.undo;
    if (paintBarrier > 0) {
      return redo
        ? `Redo ${paintBarrier} paint ${paintBarrier === 1 ? 'step' : 'steps'} first — they were undone after this UV step`
        : `Undo ${paintBarrier} newer paint ${paintBarrier === 1 ? 'step' : 'steps'} first`;
    }
    return `${verb} ${label}`;
  };

  const setSelectionScope = (mode: UvSelectionMode) => {
    setSelectionMode(mode);
    if (mode === 'island') {
      setSelectedFace(null);
      if (selectionMode === 'face' && selected >= 0) {
        publishIslandSelection([selected], selected);
        bridge.selectUvIsland(selected, false);
      }
      setNote('island selection · double-click a face to isolate it');
      return;
    }
    if (selected >= 0) {
      selectedIndicesRef.current = [selected];
      setSelectedIndices([selected]);
    }
    setNote('face selection · double-click a face again to return to its island');
  };
  const packAtlas = () => {
    const next = uniformUvPack(rectsRef.current, uv.w, uv.h);
    rectsRef.current = next;
    setRects(next);
    commit(next, `packed ${next.length} islands into uniform cells`, 'pack');
  };
  const importAtlas = () => {
    setNote('choosing a texture…');
    void bridge.importUvAtlas().then(setNote);
  };
  const saveAndCopyAtlasPath = () => {
    const saved = bridge.saveUvAtlas();
    if (!saved.path) {
      setNote(saved.note);
      return;
    }
    host.__clipboard_set?.(saved.path);
    setNote(`${saved.note} · path copied`);
  };
  const exportWireframeAndCopyPath = () => {
    const saved = bridge.exportUvWireframe();
    if (!saved.path) {
      setNote(saved.note);
      return;
    }
    host.__clipboard_set?.(saved.path);
    setNote(`${saved.note} · path copied`);
  };
  const collectUvOrientation = () => {
    const count = bridge.selectUvOrientation();
    if (count === 0) {
      setNote('select one face on the 3D mesh first, then collect its UV orientation');
      return;
    }
    setSelectionMode('island');
    setSelectedFace(null);
    setNote(`collected ${count} same-orientation faces · their UV islands now move as one set`);
  };
  const copySelectedTransform = () => {
    if (!selectionBounds) {
      setNote('Select a UV island or face to copy its transform.');
      return;
    }
    const frame = { x: selectionBounds.x, y: selectionBounds.y, w: selectionBounds.w, h: selectionBounds.h };
    setTransformClipboard(frame);
    setNote(`copied transform ${Math.round(frame.w)}×${Math.round(frame.h)} at ${Math.round(frame.x)},${Math.round(frame.y)}`);
  };
  const pasteSelectedTransform = () => {
    const frame = transformClipboard;
    if (!frame) {
      setNote('Copy a transform first — it survives selection changes.');
      return;
    }
    if (selectionMode === 'face') {
      const rect = rectsRef.current[selected];
      if (!rect || !selectedTarget) {
        setNote('Double-click a UV face first.');
        return;
      }
      replaceSelected(pasteUvTransform(rect, selectedTarget, frame, uv.w, uv.h), 'pasted transform onto the UV face', 'paste-transform');
      return;
    }
    const indices = selectedIndicesRef.current;
    if (indices.length === 0) {
      setNote('Select one or more UV islands first.');
      return;
    }
    const selectedSet = new Set(indices);
    const next = rectsRef.current.map((rect, index) => selectedSet.has(index) ? pasteUvTransform(rect, undefined, frame, uv.w, uv.h) : rect);
    applyIslandSetEdit(next, `pasted transform onto ${indices.length} ${indices.length === 1 ? 'island' : 'islands'}`, 'paste-transform');
  };
  const moveSelectionToMenuPoint = () => {
    const point = menuAtlasPointRef.current;
    if (selectionMode === 'face') {
      const rect = rectsRef.current[selected];
      if (!rect || !selectedTarget) {
        setNote('Double-click a UV face first.');
        return;
      }
      const bounds = uvSelectionBounds(rect, selectedTarget);
      if (!bounds) return;
      replaceSelected(moveUvFace(rect, selectedTarget, point.x - bounds.cx, point.y - bounds.cy, uv.w, uv.h, translationSnapStep, true), 'moved UV face to the cursor', 'move-here');
      return;
    }
    const bounds = uvIslandSetBounds(rectsRef.current, selectedIndicesRef.current);
    if (!bounds) {
      setNote('Select one or more UV islands first.');
      return;
    }
    const next = moveUvIslands(rectsRef.current, selectedIndicesRef.current, point.x - bounds.cx, point.y - bounds.cy, uv.w, uv.h, translationSnapStep, true);
    applyIslandSetEdit(next, 'moved UV selection to the cursor', 'move-here');
  };
  const autoSizeSelected = () => {
    const indices = selectedIndicesRef.current;
    if (selectionMode !== 'island' || indices.length === 0) {
      setNote('Select one or more complete UV islands first.');
      return;
    }
    if (!bridge.autoUvSize(new Uint32Array(indices))) {
      setNote('Auto UV refused — the live mesh or UV selection changed.');
      bridge.refreshUv();
      return;
    }
    setNote(`sized ${indices.length} UV ${indices.length === 1 ? 'island' : 'islands'} to the real face size at ${uv.detail} texels/m`);
  };
  const projectSelectedFromView = () => {
    const indices = selectedIndicesRef.current;
    if (selectionMode !== 'island' || indices.length === 0) {
      setNote('Select one or more complete UV islands first.');
      return;
    }
    if (!bridge.projectUvFromView(new Uint32Array(indices))) {
      setNote('Project From View refused — every selected face must be in front of the 3D camera.');
      bridge.refreshUv();
      return;
    }
    setNote(`projected ${indices.length} UV ${indices.length === 1 ? 'island' : 'islands'} from the current 3D view`);
  };
  const runMenuAction = (action: () => void) => {
    action();
    setMenuGroup(null);
    uvMenu.close();
  };
  const toggleMenuGroup = (group: UvMenuGroup) => setMenuGroup((current) => current === group ? null : group);
  const openUvMenu = (event: any, selectAtPointer: boolean) => {
    const screen = localScreenPoint(event);
    menuAtlasPointRef.current = atlasPoint(screen);
    if (selectAtPointer) {
      const point = menuAtlasPointRef.current;
      if (selectionMode === 'face') {
        const faceHit = hitUvFace(rectsRef.current, point.x, point.y);
        if (faceHit) {
          selectedIndicesRef.current = [faceHit.island];
          setSelectedIndices([faceHit.island]);
          setSelected(faceHit.island);
          setSelectedFace(faceHit.target);
          bridge.selectUvFace(faceHit.target.face, false);
        }
      } else {
        const index = hitUvIsland(rectsRef.current, point.x, point.y);
        if (index >= 0 && !selectedIndicesRef.current.includes(index)) {
          publishIslandSelection([index], index);
          bridge.selectUvIsland(index, false);
        }
      }
    }
    setMenuGroup(null);
    const x = Number(event?.x);
    const y = Number(event?.y);
    uvMenu.triggerProps.onRightClick({
      x: Number.isFinite(x) ? x : surfaceRef.current.x + screen.x,
      y: Number.isFinite(y) ? y : surfaceRef.current.y + screen.y,
    });
  };
  const hostCursorPoint = (): ScreenPoint => ({
    x: Number(host.getMouseX?.() ?? surfaceRef.current.x) - surfaceRef.current.x,
    y: Number(host.getMouseY?.() ?? surfaceRef.current.y) - surfaceRef.current.y,
  });
  const middlePanStep = () => {
    if (!middlePanActiveRef.current) return;
    const held = (Number(host.getMouseButtons?.() ?? 0) & UV_LAYOUT_TUNING.middleMouseButtonsMask) !== 0;
    if (!held) {
      middlePanTimerRef.current = null;
      middlePanActiveRef.current = false;
      finishGesture();
      return;
    }
    const gesture = gestureRef.current;
    if (gesture?.kind === 'pan') queueViewPreview(panUvCanvasView(gesture.seed, gesture.start, hostCursorPoint()));
    middlePanTimerRef.current = setTimeout(middlePanStep, UV_LAYOUT_TUNING.dragPreviewIntervalMs);
  };
  const beginMiddlePan = () => {
    if (middlePanActiveRef.current) return;
    if (gestureRef.current) finishGesture();
    const start = hostCursorPoint();
    gestureRef.current = { kind: 'pan', start, seed: viewRef.current };
    middlePanActiveRef.current = true;
    middlePanTimerRef.current = setTimeout(middlePanStep, UV_LAYOUT_TUNING.dragPreviewIntervalMs);
  };
  const contextMenuHeight = UV_CONTEXT_MENU_TUNING.baseHeightPx
    + (menuGroup ? UV_CONTEXT_MENU_TUNING.expandedRows[menuGroup] * UV_CONTEXT_MENU_TUNING.rowHeightPx : 0);
  const contextMenuPosition = uvContextMenuPosition(
    { x: uvMenu.x, y: uvMenu.y },
    panelRef.current,
    { width: UV_CONTEXT_MENU_TUNING.widthPx, height: contextMenuHeight },
    UV_CONTEXT_MENU_TUNING.edgePx,
  );

  return (
    <Box
      onLayout={(layout: any) => {
        panelRef.current = {
          x: Number(layout.x),
          y: Number(layout.y),
          width: Math.max(1, Number(layout.width)),
          height: Math.max(1, Number(layout.height)),
        };
      }}
      style={{ flexGrow: 1, minHeight: 0, gap: 6, position: 'relative' }}
    >
      <Row style={{ height: 27, alignItems: 'center', gap: 7 }}>
        <Icon name={selectionMode === 'face' ? 'Triangle' : 'MousePointer2'} size={12} color={accentFor('primary')} />
        <Text numberOfLines={1} style={{ color: accentFor('primary'), fontSize: 9, fontFamily: 'ui-monospace', fontWeight: '900', letterSpacing: 0.7 }}>{selectionMode === 'face' ? selectedFace ? 'FACE ISOLATED' : 'FACE SELECT' : 'ISLAND SELECT'}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text numberOfLines={1} style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '800' }}>WHEEL ZOOM · MMB PAN · RMB ACTIONS</Text>
        <Text style={{ minWidth: 42, textAlign: 'right', color: accentFor('textDim'), fontSize: 9, fontFamily: 'ui-monospace', fontWeight: '800' }}>{`${Math.round(view.scale * 100)}%`}</Text>
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
        onScroll={(event: any) => {
          const delta = Number(event?.deltaY ?? event?.delta ?? 0);
          if (!Number.isFinite(delta) || delta === 0) return;
          zoomAt(localScreenPoint(event), delta > 0 ? 1.15 : 1 / 1.15);
        }}
        onMiddleClick={beginMiddlePan}
        onRightClick={(event: any) => openUvMenu(event, true)}
        onMouseDown={(event: any) => {
          const screen = localScreenPoint(event);
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
            const localVertex = localHandlePoints[vertex]!;
            lastClickRef.current = null;
            gestureRef.current = {
              kind: 'vertex',
              index: selected,
              target: selectedTarget,
              vertex,
              origin: { x: selectedRect.x + localVertex.x, y: selectedRect.y + localVertex.y },
              start: atlasPoint(screen),
              screenStart: screen,
              activated: false,
              seed: selectedRect,
            };
            return;
          }
          const point = atlasPoint(screen);
          const clickStamp = { at: Date.now(), x: screen.x, y: screen.y };
          const doubleClick = isUvDoubleClick(lastClickRef.current, clickStamp);
          if (doubleClick) {
            lastClickRef.current = null;
            const faceHit = hitUvFace(rectsRef.current, point.x, point.y);
            if (faceHit) {
              const nextMode = uvSelectionModeAfterDoubleClick(selectionMode, true);
              selectedIndicesRef.current = [faceHit.island];
              setSelectedIndices([faceHit.island]);
              setSelected(faceHit.island);
              setSelectionMode(nextMode);
              if (nextMode === 'island') {
                setSelectedFace(null);
                bridge.selectUvIsland(faceHit.island, false);
                setNote('returned to the complete UV island');
              } else {
                setSelectedFace(faceHit.target);
                bridge.selectUvFace(faceHit.target.face, Boolean(event?.shiftKey));
                const seed = rectsRef.current[faceHit.island]!;
                const bounds = uvSelectionBounds(seed, faceHit.target);
                if (bounds) gestureRef.current = { kind: 'move', index: faceHit.island, indices: [faceHit.island], target: faceHit.target, bounds, start: point, screenStart: screen, activated: false, doubleClick: true, seed, seedRects: rectsRef.current };
                setNote('isolated one authored UV face · double-click again to return');
              }
              return;
            }
          }
          if (selectionMode === 'face') {
            const faceHit = hitUvFace(rectsRef.current, point.x, point.y);
            if (!faceHit && toggleGridGuideAt(point)) return;
            const faceSelection = faceHit ? [faceHit.island] : [];
            selectedIndicesRef.current = faceSelection;
            setSelectedIndices(faceSelection);
            setSelected(faceHit?.island ?? -1);
            setSelectedFace(faceHit?.target ?? null);
            if (faceHit) {
              bridge.selectUvFace(faceHit.target.face, Boolean(event?.shiftKey));
              const seed = rectsRef.current[faceHit.island]!;
              const bounds = uvSelectionBounds(seed, faceHit.target);
              if (bounds) gestureRef.current = { kind: 'move', index: faceHit.island, indices: [faceHit.island], target: faceHit.target, bounds, start: point, screenStart: screen, activated: false, doubleClick: false, seed, seedRects: rectsRef.current };
            }
            return;
          }
          const index = hitUvIsland(rectsRef.current, point.x, point.y);
          if (index < 0 && toggleGridGuideAt(point)) return;
          const additive = Boolean(event?.shiftKey);
          const nextSelection = selectIslandAt(index, additive);
          if (index >= 0) {
            bridge.selectUvIsland(index, additive);
            if (nextSelection.includes(index)) {
              const seed = rectsRef.current[index]!;
              const bounds = nextSelection.length > 1
                ? uvIslandSetBounds(rectsRef.current, nextSelection)
                : uvRectFrame(seed);
              if (bounds) gestureRef.current = { kind: 'move', index, indices: [...nextSelection], bounds, start: point, screenStart: screen, activated: false, doubleClick: false, seed, seedRects: rectsRef.current };
              if (nextSelection.length > 1) setNote(`${nextSelection.length} UV islands selected · drag any member to move the set`);
            }
          }
        }}
        onMouseMove={(event: any) => {
          const gesture = gestureRef.current;
          if (!gesture) return;
          const screen = localScreenPoint(event);
          if (gesture.kind === 'pan') {
            queueViewPreview(panUvCanvasView(gesture.seed, gesture.start, screen));
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
            const dragBounds = gesture.kind === 'vertex'
              ? { x: gesture.origin.x, y: gesture.origin.y, w: 0, h: 0, cx: gesture.origin.x, cy: gesture.origin.y }
              : gesture.bounds;
            const snapped = snapUvTranslationToGridAndGuides(
              dragBounds,
              dx,
              dy,
              translationSnapStep,
              selectedGuidesRef.current,
              UV_LAYOUT_TUNING.guideSnapPx / Math.max(UV_LAYOUT_TUNING.minimumZoom, viewRef.current.scale),
              freeMove,
            );
            guide = snapped.guides[0] ?? null;
            if (gesture.kind === 'move' && !gesture.target && gesture.indices.length > 1) {
              const next = moveUvIslands(gesture.seedRects, gesture.indices, snapped.dx, snapped.dy, uv.w, uv.h, translationSnapStep, true);
              queueUvRectsPreview(next, guide);
              return;
            }
            changed = gesture.kind === 'vertex'
              ? moveUvSelectionVertex(gesture.seed, gesture.target, gesture.vertex, snapped.dx, snapped.dy, uv.w, uv.h, true, translationSnapStep)
              : gesture.target
                ? moveUvFace(gesture.seed, gesture.target, snapped.dx, snapped.dy, uv.w, uv.h, translationSnapStep, true)
                : moveUvIsland(gesture.seed, snapped.dx, snapped.dy, uv.w, uv.h, translationSnapStep, true);
          } else if (gesture.kind === 'rotate') {
            const angle = Math.atan2(point.y - gesture.center.y, point.x - gesture.center.x) - gesture.startAngle;
            const rotated = rotateUvSelection(gesture.seed, gesture.target, angle * 180 / Math.PI, uv.w, uv.h);
            changed = rotated.rect;
            guide = rotated.guide;
          } else if (gesture.kind === 'scale') {
            let scalePoint = point;
            if (!event?.altKey && selectedGuidesRef.current.length > 0) {
              const snapped = snapToSelectedGuides({ x: point.x, y: point.y, w: 0, h: 0, cx: point.x, cy: point.y });
              scalePoint = { x: point.x + snapped.dx, y: point.y + snapped.dy };
              guide = snapped.guides[0] ?? null;
            }
            let scaleX = (scalePoint.x - gesture.bounds.x) / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, gesture.bounds.w);
            let scaleY = (scalePoint.y - gesture.bounds.y) / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, gesture.bounds.h);
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
        onMouseLeave={() => { if (!middlePanActiveRef.current) finishGesture(); }}
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
          {gridSegments.minor.length ? <Graph.Polyline segments points={gridSegments.minor} stroke="#536176" strokeWidth={0.8 * inverseViewScale} /> : null}
          {gridSegments.major.length ? <Graph.Polyline segments points={gridSegments.major} stroke="#8291a8" strokeWidth={1.2 * inverseViewScale} /> : null}
          {fixedLines.faces.length ? <Graph.Polyline segments points={fixedLines.faces} stroke="#080b10" strokeWidth={2.4 * inverseViewScale} /> : null}
          {fixedLines.faces.length ? <Graph.Polyline segments points={fixedLines.faces} stroke="#8591a3" strokeWidth={0.9 * inverseViewScale} /> : null}
          {fixedLines.boundary.length ? <Graph.Polyline segments points={fixedLines.boundary} stroke="#080b10" strokeWidth={3.2 * inverseViewScale} /> : null}
          {fixedLines.boundary.length ? <Graph.Polyline segments points={fixedLines.boundary} stroke="#c7d0df" strokeWidth={1.15 * inverseViewScale} /> : null}
          {activeFixedLines.boundary.length ? <Graph.Polyline segments points={activeFixedLines.boundary} stroke="#42d9e8" strokeWidth={1.65 * inverseViewScale} /> : null}
          {secondarySelectedLines.faces.length ? <Graph.Polyline segments points={secondarySelectedLines.faces} stroke="#b5c3d8" strokeWidth={1.05 * inverseViewScale} /> : null}
          {secondarySelectedLines.boundary.length ? <Graph.Polyline segments points={secondarySelectedLines.boundary} stroke="#42d9e8" strokeWidth={2.1 * inverseViewScale} /> : null}
          {groupFrameSegments.length ? <Graph.Polyline segments points={groupFrameSegments} stroke="#42d9e8" strokeWidth={1.35 * inverseViewScale} /> : null}
          {selectedGuideSegments.length ? <Graph.Polyline segments points={selectedGuideSegments} stroke="#080b10" strokeWidth={4 * inverseViewScale} /> : null}
          {selectedGuideSegments.length ? <Graph.Polyline segments points={selectedGuideSegments} stroke="#f4c95d" strokeWidth={1.8 * inverseViewScale} /> : null}
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
        {cornerIdentityMarkers.map((marker, index) => {
          const size = UV_LAYOUT_TUNING.cornerIdentityHandlePx;
          return (
            <Box
              key={`uv-corner-id-${marker.vertex}-${index}`}
              style={{
                position: 'absolute',
                left: view.x + marker.x * view.scale - size * 0.5,
                top: view.y + marker.y * view.scale - size * 0.5,
                width: size,
                height: size,
                borderRadius: size * 0.5,
                backgroundColor: uvCornerIdentityColor(marker.vertex),
                borderWidth: 2,
                borderColor: '#080b10',
                pointerEvents: 'none',
              }}
            />
          );
        })}
        {rotationHandle ? (
          <Box style={{ position: 'absolute', left: rotationHandle.x - 8, top: rotationHandle.y - 8, width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#18202c', borderWidth: 1, borderColor: '#f8fafc', pointerEvents: 'none' }}>
            <Icon name="RotateCw" size={10} color="#f8fafc" />
          </Box>
        ) : null}
        {scaleHandle ? <Box style={{ position: 'absolute', left: scaleHandle.x - 5, top: scaleHandle.y - 5, width: 10, height: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#11151d', pointerEvents: 'none' }} /> : null}
      </Pressable>

      <Row style={{ height: 14, alignItems: 'center' }}>
        <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace', letterSpacing: 0.4 }}>{`${multiIslandSelection ? `${selectedIndices.length} ISLANDS · RIGID SNAP ${translationSnapStep}px` : `GRID SNAP ${translationSnapStep}px`} · ${selectedGuides.length > 0 ? `${selectedGuides.length} GUIDE${selectedGuides.length === 1 ? '' : 'S'}` : 'CLICK GRID = GUIDE'}`}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace' }}>{`ATLAS ${uv.w}×${uv.h}`}</Text>
      </Row>

      <Row style={{ alignItems: 'center', gap: 4 }}>
        <UvNumberField label="X" value={selectionBounds ? Math.round(selectionBounds.x) : null} min={0} max={selectionBounds ? Math.floor(uv.w - selectionBounds.w) : uv.w} onCommit={(value) => changeCoordinate('x', value)} />
        <UvNumberField label="Y" value={selectionBounds ? Math.round(selectionBounds.y) : null} min={0} max={selectionBounds ? Math.floor(uv.h - selectionBounds.h) : uv.h} onCommit={(value) => changeCoordinate('y', value)} />
        <UvNumberField label="W" value={selectionBounds && !multiIslandSelection ? Math.max(1, Math.round(selectionBounds.w)) : null} min={1} max={selectionBounds ? Math.floor(uv.w - selectionBounds.x) : uv.w} onCommit={(value) => changeCoordinate('w', value)} />
        <UvNumberField label="H" value={selectionBounds && !multiIslandSelection ? Math.max(1, Math.round(selectionBounds.h)) : null} min={1} max={selectionBounds ? Math.floor(uv.h - selectionBounds.y) : uv.h} onCommit={(value) => changeCoordinate('h', value)} />
        <Pressable tooltip={aspectLocked ? 'Unlock width and height' : 'Lock width/height aspect'} onPress={() => setAspectLocked((value) => !value)} style={{ width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: aspectLocked ? accentFor('segActiveBg') : accentFor('surfaceRaised'), borderWidth: 1, borderColor: aspectLocked ? accentFor('primary') : accentFor('border') }}>
          <Icon name={aspectLocked ? 'Link2' : 'Link2Off'} size={13} color={aspectLocked ? accentFor('primary') : accentFor('textDim')} />
        </Pressable>
      </Row>

      {note ? <Text numberOfLines={1} style={{ color: accentFor('textDim'), fontSize: 9 }}>{note}</Text> : null}

      <Box style={{ borderTopWidth: 1, borderTopColor: accentFor('borderSoft'), paddingTop: 7, gap: 5 }}>
        <Row style={{ height: 23, alignItems: 'center', gap: 5 }}>
          <Text style={{ color: accentFor('textDim'), fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>TEXTURES</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '800' }}>RMB CANVAS · TEXTURE ACTIONS</Text>
          <Pressable
            tooltip="Export an atlas-sized UV wireframe PNG with a transparent background and copy its path"
            onPress={exportWireframeAndCopyPath}
            style={{ height: 21, paddingLeft: 6, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}
          >
            <Icon name="ImageDown" size={10} color={accentFor('primary')} />
            <Text style={{ color: accentFor('textDim'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>WIRE PNG</Text>
          </Pressable>
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

      <uvMenu.ContextMenu
        onDismiss={() => setMenuGroup(null)}
        style={{ left: contextMenuPosition.x, top: contextMenuPosition.y, width: UV_CONTEXT_MENU_TUNING.widthPx }}
      >
        <C.HW_StageContextMenu style={{ width: UV_CONTEXT_MENU_TUNING.widthPx }}>
          <C.HW_ContextHead>
            <Icon name="Grid3x3" size={13} color={accentFor('primary')} />
            <Box style={{ gap: 1 }}>
              <Text style={{ color: accentFor('text'), fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }}>UV ACTIONS</Text>
              <C.HW_KeyText>WHEEL ZOOM · MMB PAN</C.HW_KeyText>
            </Box>
            <C.HW_Spacer />
            <C.HW_KeyText>{`${Math.round(view.scale * 100)}%`}</C.HW_KeyText>
          </C.HW_ContextHead>

          <UvContextRow icon="MousePointer2" label="Island Selection" detail={selectionMode === 'island' ? 'ACTIVE' : 'DOUBLE'} active={selectionMode === 'island'} onPress={() => runMenuAction(() => setSelectionScope('island'))} />
          <UvContextRow icon="Triangle" label="Face Isolation" detail={selectionMode === 'face' ? 'ACTIVE' : 'DOUBLE'} active={selectionMode === 'face'} onPress={() => runMenuAction(() => setSelectionScope('face'))} />
          <UvContextRow icon="Layers3" label="Collect Same Orientation" detail="FROM 3D FACE" enabled={!bridge.paintLive && selectedIndices.length > 0} tooltip="Select a face on the mesh, then collect every UV island projected from the same direction" onPress={() => runMenuAction(collectUvOrientation)} />
          <UvContextRow icon="Maximize2" label="Fit Complete Atlas" detail="VIEW" onPress={() => runMenuAction(() => setView(fittedView(false)))} />
          <UvContextRow
            icon="Link2"
            label="Stitch Matching Seams"
            detail={`${selectedIndices.length} ISL`}
            active={multiIslandSelection}
            enabled={multiIslandSelection}
            tooltip={multiIslandSelection
              ? 'Use welded model-vertex identity to join selected UV pieces while the white active island stays fixed'
              : 'Select two or more complete UV islands first'}
            onPress={() => runMenuAction(stitchSelected)}
          />

          <UvContextDivider />
          <UvContextRow icon="RotateCw" label="Transform Selection" detail={selectionMode === 'face' ? 'FACE' : `${selectedIndices.length} ISL`} expanded={menuGroup === 'transform'} onPress={() => toggleMenuGroup('transform')} />
          {menuGroup === 'transform' ? (
            <>
              <UvContextRow indented icon="FlipHorizontal2" label="Flip Horizontally" detail="U" enabled={Boolean(selectedRect)} onPress={() => runMenuAction(() => flipSelected('u'))} />
              <UvContextRow indented icon="FlipVertical2" label="Flip Vertically" detail="V" enabled={Boolean(selectedRect)} onPress={() => runMenuAction(() => flipSelected('v'))} />
              <UvContextRow indented icon="RefreshCcw" label="Restore From 3D Shape" detail="KEEP CENTRE" enabled={selectionMode === 'island' && selectedIndices.length > 0} onPress={() => runMenuAction(restoreSelectedShapes)} />
              <UvContextRow indented icon="Copy" label="Copy Transform" detail="X·Y·W·H" enabled={Boolean(selectionBounds)} tooltip="Copy the selection's position and size — paste it onto any later selection" onPress={() => runMenuAction(copySelectedTransform)} />
              <UvContextRow indented icon="ClipboardPaste" label="Paste Transform" detail={transformClipboard ? `${Math.round(transformClipboard.w)}×${Math.round(transformClipboard.h)}` : 'EMPTY'} enabled={Boolean(transformClipboard) && Boolean(selectionBounds)} tooltip="Scale and move the selection to the copied frame" onPress={() => runMenuAction(pasteSelectedTransform)} />
              <UvContextRow indented icon="LocateFixed" label="Move Here" detail="CURSOR" enabled={Boolean(selectionBounds)} tooltip="Centre the selection where this menu was opened" onPress={() => runMenuAction(moveSelectionToMenuPoint)} />
              <UvContextRow indented icon="Ruler" label="Auto UV Real Size" detail={`${uv.detail}/m`} enabled={selectionMode === 'island' && selectedIndices.length > 0} tooltip="Resize the selected islands to their faces' real physical size at the atlas density" onPress={() => runMenuAction(autoSizeSelected)} />
              <UvContextRow indented icon="Eye" label="Project From View" detail="3D CAM" enabled={selectionMode === 'island' && selectedIndices.length > 0} tooltip="Rewrite the selected islands as the current 3D viewport's projection of their faces" onPress={() => runMenuAction(projectSelectedFromView)} />
            </>
          ) : null}

          <UvContextRow icon="Rows3" label="Arrange Selected Islands" detail={`${selectedIndices.length} SELECTED`} expanded={menuGroup === 'arrange'} onPress={() => toggleMenuGroup('arrange')} />
          {menuGroup === 'arrange' ? (
            <>
              <UvContextRow indented icon="Layers3" label="Stack Exactly on Active" detail={`${selectedIndices.length} → 1`} enabled={multiIslandSelection} tooltip="Copy the white active island's exact triangle corners onto every compatible selected island" onPress={() => runMenuAction(stackSelected)} />
              <UvContextRow indented icon="MoveHorizontal" label="Match Active Width" detail="W =" enabled={multiIslandSelection} onPress={() => runMenuAction(() => matchSelectedSize('width'))} />
              <UvContextRow indented icon="MoveVertical" label="Match Active Height" detail="H =" enabled={multiIslandSelection} onPress={() => runMenuAction(() => matchSelectedSize('height'))} />
              <UvContextRow indented icon="Maximize" label="Match Active Size" detail="W×H" enabled={multiIslandSelection} onPress={() => runMenuAction(() => matchSelectedSize('both'))} />
              <UvContextRow indented icon="ArrowRight" label="Chain Left to Right" detail="X" enabled={multiIslandSelection} onPress={() => runMenuAction(() => chainSelected('horizontal'))} />
              <UvContextRow indented icon="ArrowDown" label="Chain Top to Bottom" detail="Y" enabled={multiIslandSelection} onPress={() => runMenuAction(() => chainSelected('vertical'))} />
            </>
          ) : null}

          <UvContextRow icon="Grid2x2" label="Snap Grid" detail={`${translationSnapStep}px ACTIVE`} expanded={menuGroup === 'snap'} onPress={() => toggleMenuGroup('snap')} />
          {menuGroup === 'snap' ? (
            <>
              {UV_SNAP_STEPS.map((step) => (
                <UvContextRow
                  key={`uv-context-snap-${step}`}
                  indented
                  icon="Grid2x2"
                  label={`${step} texel${step === 1 ? '' : 's'}`}
                  detail={snapBaseStep === step ? 'ACTIVE' : ''}
                  active={snapBaseStep === step}
                  onPress={() => runMenuAction(() => {
                    setSnapBaseStep(step);
                    setNote(`grid set to ${uvTranslationSnapStep(view.scale, step)} texels at this zoom · Alt moves freely`);
                  })}
                />
              ))}
              <UvContextRow
                indented
                icon="Eraser"
                label="Clear Guides"
                detail={`${selectedGuides.length}`}
                enabled={selectedGuides.length > 0}
                onPress={() => runMenuAction(() => {
                  publishGuides([]);
                  setNote('cleared UV grid guides');
                })}
              />
            </>
          ) : null}

          <UvContextRow icon="History" label="Edit History" detail={`${history.undo} / ${history.redo}`} expanded={menuGroup === 'edit'} onPress={() => toggleMenuGroup('edit')} />
          {menuGroup === 'edit' ? (
            <>
              <UvContextRow indented icon="Undo2" label="Undo UV Edit" detail={`${history.undo}`} enabled={canUndoUv} tooltip={historyTooltip(false)} onPress={() => runMenuAction(() => stepHistory(false))} />
              <UvContextRow indented icon="Redo2" label="Redo UV Edit" detail={`${history.redo}`} enabled={canRedoUv} tooltip={historyTooltip(true)} onPress={() => runMenuAction(() => stepHistory(true))} />
            </>
          ) : null}

          <UvContextDivider />
          <UvContextRow icon="Image" label="Texture Atlas" detail={`${uv.w}×${uv.h}`} expanded={menuGroup === 'texture'} onPress={() => toggleMenuGroup('texture')} />
          {menuGroup === 'texture' ? (
            <>
              <UvContextRow indented icon="Grid3x3" label="Uniform Pack All Islands" enabled={rects.length > 0} onPress={() => runMenuAction(packAtlas)} />
              <UvContextRow indented icon="ImagePlus" label="Import Texture…" onPress={() => runMenuAction(importAtlas)} />
              <UvContextRow indented icon="RefreshCw" label="Reload base.png" onPress={() => runMenuAction(() => setNote(bridge.reloadUvAtlas()))} />
              <UvContextRow indented icon="Copy" label="Save & Copy Atlas Path" enabled={Boolean(uv.diskPath)} onPress={() => runMenuAction(saveAndCopyAtlasPath)} />
              <UvContextRow indented icon="ImageDown" label="Export Transparent Wireframe" detail="PNG + COPY PATH" enabled={rects.length > 0} tooltip="Write authored UV edges only; transparent background, with quad diagonals omitted" onPress={() => runMenuAction(exportWireframeAndCopyPath)} />
            </>
          ) : null}
        </C.HW_StageContextMenu>
      </uvMenu.ContextMenu>
    </Box>
  );
}
