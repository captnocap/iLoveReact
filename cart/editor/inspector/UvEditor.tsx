import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Graph, Image, Paintable, Pressable, Row, ScrollView, Text, TextInput } from '../../../runtime/primitives';
import { usePaintable } from '../../../runtime/hooks/usePaintable';
import { useContextMenu } from '../../../runtime/hooks/useContextMenu';
import { Icon } from '../../../runtime/icons/Icon';
import { parseClampedNumericDraft, replacementDraftAfterEdit } from '../../../runtime/paint/numericInput';
import { C, accentFor } from '../workspace.cls';
import type { ModelFocusBridge, ModelFocusUv } from '../stage/ModelView';
import {
  resolveUvWorkspacePointer,
  UV_TEXTURE_WORKSPACE_TUNING,
  uvTextureWorkspaceIsStale,
  type UvTextureWorkspaceDoc,
} from '../data/uvTextureWorkspace';
import { loadTexturePackages, texturePatchPackages, type TexturePatchPackage } from '../data/texturePackage';
import { importedSpecs } from '../textures/shaders';
import { isUvDocumentHistoryLabel, UV_HISTORY_TUNING, uvHistoryAvailability, type ModelHistoryDepths, type UvHistoryAction } from '../model/uvHistory';
import { planUvAtlasResize, uvAtlasResizePreview, UV_ATLAS_SIZE_TUNING } from '../model/uvAtlasSize';
import {
  chainUvIslands,
  countUvTextureFootprints,
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
  planRepeatedUvStacks,
  rotateUvSelection,
  scaleUvSelection,
  shouldActivateUvDrag,
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
  uvIslandsIntersectingMarquee,
  uvIslandSetBounds,
  uvScaleDragPoint,
  uvSelectionBounds,
  uvSelectionVertices,
  uvTranslationSnapStep,
  uvWorkspaceGridSegments,
  UV_LAYOUT_TUNING,
  UV_SNAP_STEPS,
  type UvAxisGuide,
  type UvCanvasRect,
  type UvCanvasView,
  type UvFaceTarget,
  type UvFlipAxis,
  type UvIslandRect,
  type UvRepeatStackMode,
  type UvRepeatStackPlan,
  type UvSelectionBounds,
  type UvSelectionMode,
  type UvSizeMatch,
  type UvTransformFrame,
  zoomUvCanvasViewAt,
} from '../model/uvLayout';
import {
  UV_CONTEXT_MENU_TUNING,
  uvContextMenuHeight,
  type UvContextMenuMeasure,
  type UvMenuGroup,
} from './uvContextMenuLayout';

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

const WORKSPACE_CHECKER_SHADER = `
@group(0) @binding(1) var<storage, read> P: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let px = in.uv * vec2f(P[0], P[1]);
  let cell = max(P[2], 1.0);
  let tile = floor(px / cell);
  let parity = fract((tile.x + tile.y) * 0.5) * 2.0;
  let rgb = mix(vec3f(0.0353, 0.0431, 0.0588), vec3f(0.0667, 0.0784, 0.1020), parity);
  return vec4f(rgb, 1.0);
}`;

type ScreenPoint = { x: number; y: number };
type UvLineGeometry = { faces: number[]; boundary: number[] };
type UvLineGeometryCache = { rects: readonly UvIslandRect[]; geometry: UvLineGeometry };
type PendingUvPreview = { generation: number; rects: UvIslandRect[]; guide: UvAxisGuide | null };
type UvMarqueeFrame = Readonly<{ left: number; top: number; width: number; height: number }>;
type UvPanelHistory = Readonly<{ uv: ModelHistoryDepths; paint: ModelHistoryDepths }>;
type UvRepeatStackReview = Readonly<{
  source: readonly UvIslandRect[];
  mode: UvRepeatStackMode;
  exact: UvRepeatStackPlan;
  normalize: UvRepeatStackPlan;
}>;
type UvRepeatStackExport = 'none' | 'wireframe' | 'generation' | 'generation-numbered';
type Gesture =
  | { kind: 'pan'; start: ScreenPoint; seed: UvCanvasView }
  | { kind: 'marquee'; start: ScreenPoint; current: ScreenPoint; screenStart: ScreenPoint; activated: boolean; additive: boolean; seedIndices: number[]; seedPrimary: number }
  | { kind: 'image'; id: string; start: ScreenPoint; screenStart: ScreenPoint; activated: boolean; origin: ScreenPoint; seed: UvTextureWorkspaceDoc }
  | { kind: 'move'; index: number; indices: number[]; target?: UvFaceTarget; bounds: UvSelectionBounds; start: ScreenPoint; screenStart: ScreenPoint; activated: boolean; doubleClick: boolean; seed: UvIslandRect; seedRects: UvIslandRect[] }
  | { kind: 'vertex'; index: number; target?: UvFaceTarget; vertex: number; origin: ScreenPoint; start: ScreenPoint; screenStart: ScreenPoint; activated: boolean; seed: UvIslandRect }
  | { kind: 'rotate'; index: number; target?: UvFaceTarget; center: ScreenPoint; startAngle: number; seed: UvIslandRect }
  | { kind: 'scale'; index: number; target?: UvFaceTarget; bounds: UvSelectionBounds; start: ScreenPoint; seed: UvIslandRect };

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
  return uvSelectionBounds(rect) ?? {
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
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.value == null ? '' : String(props.value));
  const replaceBaselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editing) setDraft(props.value == null ? '' : String(props.value));
  }, [props.value, editing]);
  useEffect(() => {
    if (!props.disabled) return;
    replaceBaselineRef.current = null;
    setEditing(false);
    setDraft(props.value == null ? '' : String(props.value));
  }, [props.disabled]);
  const commit = (submitted?: unknown) => {
    if (props.value == null || props.disabled) return;
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
    <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 29, flexDirection: 'row', alignItems: 'center', backgroundColor: accentFor('controlBg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4, overflow: 'hidden', opacity: props.disabled ? 0.5 : 1 }}>
      <Text style={{ width: 19, textAlign: 'center', color: accentFor('textFaint'), fontSize: 9, fontWeight: '900' }}>{props.label}</Text>
      {props.value == null ? (
        <Text style={{ flexGrow: 1, color: accentFor('textFaint'), fontSize: 10, fontFamily: 'ui-monospace', textAlign: 'center' }}>—</Text>
      ) : props.disabled ? (
        <Text style={{ flexGrow: 1, color: accentFor('textDim'), fontSize: 10, fontFamily: 'ui-monospace', textAlign: 'center' }}>{props.value}</Text>
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
      {props.detail ? <C.HW_KeyText noWrap numberOfLines={1} style={{ flexShrink: 0 }}>{props.detail}</C.HW_KeyText> : null}
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
  const [contextMenuMeasure, setContextMenuMeasure] = useState<UvContextMenuMeasure>({ group: null, height: 0 });
  const [surfaceMode, setSurfaceMode] = useState<'uv' | 'images'>('uv');
  const [workspaceDoc, setWorkspaceDoc] = useState<UvTextureWorkspaceDoc | null>(uv.workspace);
  const workspaceDocRef = useRef<UvTextureWorkspaceDoc | null>(uv.workspace);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(
    uv.workspace?.layers[uv.workspace.layers.length - 1]?.id ?? null,
  );
  const [focusedPatchLayerId, setFocusedPatchLayerId] = useState<string | null>(null);
  const pendingPatchFocusRef = useRef(false);
  const importedTextureCount = importedSpecs().length;
  const texturePatches = useMemo(
    () => texturePatchPackages(loadTexturePackages()),
    [uv.key, uv.revision, importedTextureCount],
  );
  const [compileLabel, setCompileLabel] = useState<string | null>(null);
  const [atlasWidthDraft, setAtlasWidthDraft] = useState(uv.w);
  const [atlasHeightDraft, setAtlasHeightDraft] = useState(uv.h);
  const [atlasResizePending, setAtlasResizePending] = useState(false);
  const [repeatStackScanning, setRepeatStackScanning] = useState(false);
  const [repeatStackReview, setRepeatStackReview] = useState<UvRepeatStackReview | null>(null);
  const [repeatNormalizeMaxAreaTexels, setRepeatNormalizeMaxAreaTexels] = useState(
    UV_LAYOUT_TUNING.repeatNormalizeDefaultMaxAreaTexels,
  );
  const repeatStackScanGenerationRef = useRef(0);
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
  const [marqueeFrame, setMarqueeFrame] = useState<UvMarqueeFrame | null>(null);
  const pendingMarqueeRef = useRef<UvMarqueeFrame | null>(null);
  const marqueeFramePendingRef = useRef(false);
  const marqueeGenerationRef = useRef(0);
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

  useEffect(() => {
    setAtlasWidthDraft(uv.w);
    setAtlasHeightDraft(uv.h);
    setAtlasResizePending(false);
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
  const queueMarqueePreview = (start: ScreenPoint, current: ScreenPoint) => {
    pendingMarqueeRef.current = {
      left: Math.min(start.x, current.x),
      top: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };
    if (marqueeFramePendingRef.current) return;
    marqueeFramePendingRef.current = true;
    const generation = marqueeGenerationRef.current;
    const hostGlobal = globalThis as any;
    const schedule: (callback: () => void) => unknown = typeof hostGlobal.requestAnimationFrame === 'function'
      ? hostGlobal.requestAnimationFrame.bind(hostGlobal)
      : (callback) => setTimeout(callback, UV_LAYOUT_TUNING.dragPreviewIntervalMs);
    schedule(() => {
      if (generation !== marqueeGenerationRef.current) return;
      marqueeFramePendingRef.current = false;
      const pending = pendingMarqueeRef.current;
      pendingMarqueeRef.current = null;
      if (pending) setMarqueeFrame(pending);
    });
  };
  const clearMarqueePreview = () => {
    marqueeGenerationRef.current += 1;
    pendingMarqueeRef.current = null;
    marqueeFramePendingRef.current = false;
    setMarqueeFrame(null);
  };
  const fittedView = (nativeScale = false): UvCanvasView => {
    const padding = UV_LAYOUT_TUNING.canvasPaddingPx;
    const fit = Math.min(
      Math.max(1, surfaceSize.width - padding * 2) / Math.max(1, uv.w),
      Math.max(1, surfaceSize.height - padding * 2) / Math.max(1, uv.h),
    );
    const scale = clamp(nativeScale ? Math.min(UV_LAYOUT_TUNING.defaultNativeScale, fit) : fit, UV_LAYOUT_TUNING.minimumZoom, UV_LAYOUT_TUNING.maximumZoom);
    const atlasLeft = nativeScale ? padding : Math.round((surfaceSize.width - uv.w * scale) * 0.5);
    const atlasTop = nativeScale ? padding : Math.round((surfaceSize.height - uv.h * scale) * 0.5);
    return {
      x: atlasLeft - uv.atlasOriginX * scale,
      y: atlasTop - uv.atlasOriginY * scale,
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
    marqueeGenerationRef.current += 1;
    pendingMarqueeRef.current = null;
    marqueeFramePendingRef.current = false;
    repeatStackScanGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    previewGenerationRef.current += 1;
    pendingPreviewRef.current = null;
    previewFramePendingRef.current = false;
    repeatStackScanGenerationRef.current += 1;
    setRepeatStackScanning(false);
    setRepeatStackReview(null);
    const next = initialRects();
    setRects(next);
    rectsRef.current = next;
    const validSelection = selectedIndicesRef.current.filter((index) => index >= 0 && index < next.length);
    selectedIndicesRef.current = validSelection;
    setSelectedIndices(validSelection);
    setAxisGuide(null);
    setSelected((index) => validSelection.includes(index) ? index : validSelection[0] ?? Math.min(index, uv.islands.length - 1));
    setSelectedFace((target) => target && next.some((rect) => rect.triangles?.some((triangle) => triangle.face === target.face)) ? target : null);
    workspaceDocRef.current = uv.workspace;
    setWorkspaceDoc(uv.workspace);
    setSelectedLayerId((current) => uv.workspace?.layers.some((layer) => layer.id === current)
      ? current
      : uv.workspace?.layers[uv.workspace.layers.length - 1]?.id ?? null);
    if (uv.rgba) texture.paint.upload(uv.rgba);
  }, [uv.key, uv.revision]);

  const synchronizedSelectionKey = uv.selectedIslands.join(',');
  useEffect(() => {
    const next = uv.selectedIslands.filter((index) => index >= 0 && index < rectsRef.current.length);
    selectedIndicesRef.current = next;
    setSelectedIndices(next);
    setSelected((current) => next.includes(current) ? current : next[0] ?? -1);
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
  const commit = (next: UvIslandRect[], label: string, action: UvHistoryAction): boolean => {
    const corners = flattenUvFaceCorners(next);
    if (!corners || !bridge.applyUvGeometry(corners, action)) {
      const restored = initialRects();
      rectsRef.current = restored;
      setRects(restored);
      setNote(`${label} refused — live model changed; atlas was refreshed`);
      bridge.refreshUv();
      return false;
    }
    setNote(label);
    return true;
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
  const applyIslandSetEdit = (next: UvIslandRect[], label: string, action: UvHistoryAction): boolean => {
    if (sameRectReferences(rectsRef.current, next)) {
      setNote(`${label} — selection was already there`);
      return false;
    }
    rectsRef.current = next;
    setRects(next);
    return commit(next, label, action);
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
        ? 'Matching seams were found, but no stable exact fit could be produced.'
        : 'Selected islands do not share a welded model edge or unambiguous boundary vertex.');
      return;
    }
    const seams = result.seamEdges > 0
      ? `${result.seamEdges} matching ${result.seamEdges === 1 ? 'edge' : 'edges'}`
      : `${result.seamVertices} matching ${result.seamVertices === 1 ? 'vertex' : 'vertices'}`;
    const unmatched = result.unmatched > 0 ? ` · ${result.unmatched} unrelated left in place` : '';
    const blocked = result.blocked > 0 ? ` · ${result.blocked} fit-blocked` : '';
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
  useEffect(() => {
    if (!pendingPatchFocusRef.current || !uv.workspace) return;
    const layer = uv.workspace.layers[uv.workspace.layers.length - 1];
    if (!layer) return;
    pendingPatchFocusRef.current = false;
    setFocusedPatchLayerId(layer.id);
    setSelectedLayerId(layer.id);
    setSurfaceMode('uv');
    const uvBounds = uvIslandSetBounds(rectsRef.current, selectedIndicesRef.current);
    const left = Math.min(layer.x, uvBounds?.x ?? layer.x);
    const top = Math.min(layer.y, uvBounds?.y ?? layer.y);
    const right = Math.max(layer.x + layer.width, uvBounds ? uvBounds.x + uvBounds.w : layer.x + layer.width);
    const bottom = Math.max(layer.y + layer.height, uvBounds ? uvBounds.y + uvBounds.h : layer.y + layer.height);
    const padding = UV_LAYOUT_TUNING.canvasPaddingPx;
    const scale = clamp(Math.min(
      Math.max(1, surfaceSize.width - padding * 2) / Math.max(1, right - left),
      Math.max(1, surfaceSize.height - padding * 2) / Math.max(1, bottom - top),
    ), UV_LAYOUT_TUNING.minimumZoom, UV_LAYOUT_TUNING.maximumZoom);
    setView({ x: padding - left * scale, y: padding - top * scale, scale });
  }, [uv.revision, uv.workspace]);
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
  const fixedRects = focusedPatchLayerId
    ? []
    : rects.filter((_rect, index) => !selectedIndexSet.has(index));
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
  const atlasLeft = view.x + uv.atlasOriginX * view.scale;
  const atlasTop = view.y + uv.atlasOriginY * view.scale;
  const atlasEffectData = useMemo(() => [atlasW, atlasH, UV_LAYOUT_TUNING.checkerPx, 0], [atlasW, atlasH]);
  const thumbnailEffectData = useMemo(() => [32, 32, UV_LAYOUT_TUNING.checkerPx, 0], []);
  const workspaceCheckerData = useMemo(
    () => [surfaceSize.width, surfaceSize.height, UV_LAYOUT_TUNING.checkerPx, 0],
    [surfaceSize.width, surfaceSize.height],
  );
  const gridSegments = useMemo(
    () => uvWorkspaceGridSegments(view, surfaceSize.width, surfaceSize.height, translationSnapStep),
    [view.x, view.y, view.scale, surfaceSize.width, surfaceSize.height, translationSnapStep],
  );
  const inverseViewScale = 1 / Math.max(UV_LAYOUT_TUNING.minimumZoom, view.scale);
  const visibleWorkspace = {
    left: -view.x * inverseViewScale,
    top: -view.y * inverseViewScale,
    right: (surfaceSize.width - view.x) * inverseViewScale,
    bottom: (surfaceSize.height - view.y) * inverseViewScale,
  };
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
      ? [visibleWorkspace.left, axisGuide.coordinate, visibleWorkspace.right, axisGuide.coordinate]
      : [axisGuide.coordinate, visibleWorkspace.top, axisGuide.coordinate, visibleWorkspace.bottom]
    : [];
  const selectedGuideSegments = useMemo(() => selectedGuides.flatMap((guide) => (
    guide.axis === 'horizontal'
      ? [visibleWorkspace.left, guide.coordinate, visibleWorkspace.right, guide.coordinate]
      : [guide.coordinate, visibleWorkspace.top, guide.coordinate, visibleWorkspace.bottom]
  )), [selectedGuides, visibleWorkspace.left, visibleWorkspace.top, visibleWorkspace.right, visibleWorkspace.bottom]);
  const host = globalThis as any;
  const finishGesture = (event?: any) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture?.kind === 'pan') {
      settleViewPreview();
      setAxisGuide(null);
    } else if (gesture?.kind === 'marquee') {
      clearMarqueePreview();
      setAxisGuide(null);
    } else if (gesture?.kind === 'image') {
      const moved = workspaceDocRef.current?.layers.find((layer) => layer.id === gesture.id);
      const original = gesture.seed.layers.find((layer) => layer.id === gesture.id);
      if (moved && original && (moved.x !== original.x || moved.y !== original.y)) {
        setNote(bridge.editUvTextureLayer(gesture.id, { kind: 'position', x: moved.x, y: moved.y }));
      }
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
    if (gesture?.kind === 'marquee') {
      const endScreen = event ? localScreenPoint(event) : null;
      if (endScreen) {
        gesture.current = atlasPoint(endScreen);
        gesture.activated = gesture.activated || shouldActivateUvDrag(
          endScreen.x - gesture.screenStart.x,
          endScreen.y - gesture.screenStart.y,
        );
      }
      if (gesture.activated) {
        const hits = uvIslandsIntersectingMarquee(rectsRef.current, gesture.start, gesture.current);
        const seeded = new Set(gesture.seedIndices);
        const next = gesture.additive
          ? [...gesture.seedIndices, ...hits.filter((index) => !seeded.has(index))]
          : hits;
        const primary = next.includes(gesture.seedPrimary)
          ? gesture.seedPrimary
          : hits[0] ?? next[0] ?? -1;
        if (!bridge.selectUvIslands(new Uint32Array(next))) {
          setNote('area selection could not synchronize with the model');
        } else {
          setSelectionMode('island');
          publishIslandSelection(next, primary);
          setNote(next.length > 0
            ? `${next.length} UV island${next.length === 1 ? '' : 's'} selected by area`
            : 'area selection cleared · no UV silhouettes crossed');
        }
      }
    }
    if (gesture?.kind === 'vertex' && rectsRef.current[gesture.index] !== gesture.seed) commit(rectsRef.current, 'moved UV vertex over the fixed texture', 'vertex');
    if (gesture?.kind === 'rotate') commit(rectsRef.current, gesture.target ? 'rotated detached UV face' : 'rotated UV island', 'rotate');
    if (gesture?.kind === 'scale' && rectsRef.current[gesture.index] !== gesture.seed) {
      commit(rectsRef.current, gesture.target ? 'scaled detached UV face' : 'scaled UV island', 'scale');
    }
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
  const atlasResizeResult = planUvAtlasResize(uv.w, uv.h, atlasWidthDraft, atlasHeightDraft);
  const atlasResizePlan = atlasResizeResult.ok ? atlasResizeResult.plan : null;
  const applyAtlasResize = () => {
    if (atlasResizePending) return;
    if (!atlasResizeResult.ok) {
      setNote(`resize refused · ${atlasResizeResult.error}`);
      return;
    }
    if (!atlasResizeResult.plan.changed) {
      setNote(`UV total is already ${uv.w}×${uv.h}`);
      return;
    }
    setAtlasResizePending(true);
    setNote(`resizing UV total to ${atlasResizeResult.plan.targetWidth}×${atlasResizeResult.plan.targetHeight}…`);
    void bridge.resizeUvAtlas(
      atlasResizeResult.plan.targetWidth,
      atlasResizeResult.plan.targetHeight,
    ).then(setNote).catch((error) => {
      setNote(`resize failed · ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      setAtlasResizePending(false);
    });
  };
  const packAtlas = () => {
    const footprints = countUvTextureFootprints(rectsRef.current);
    const next = uniformUvPack(rectsRef.current, uv.w, uv.h, uv.atlasOriginX, uv.atlasOriginY);
    rectsRef.current = next;
    setRects(next);
    commit(next, `packed ${next.length} islands as ${footprints} uniform footprints · exact stacks preserved`, 'pack');
  };
  const updateRepeatNormalizeMaxArea = (maxAreaTexels: number) => {
    setRepeatNormalizeMaxAreaTexels(maxAreaTexels);
    setRepeatStackReview((current) => current ? {
      ...current,
      normalize: planRepeatedUvStacks(current.source, 'normalize', uv.w, uv.h, {
        normalizeMaxAreaTexels: maxAreaTexels,
      }),
    } : current);
  };
  const beginRepeatStackReview = () => {
    if (repeatStackScanning) return;
    const source = rectsRef.current;
    const generation = repeatStackScanGenerationRef.current + 1;
    repeatStackScanGenerationRef.current = generation;
    setRepeatStackReview(null);
    setRepeatStackScanning(true);
    setNote(`scanning ${source.length} UV islands through eight rotation/reflection coverage tests…`);
    setTimeout(() => {
      if (repeatStackScanGenerationRef.current !== generation) return;
      const exact = planRepeatedUvStacks(source, 'exact', uv.w, uv.h);
      const normalize = planRepeatedUvStacks(source, 'normalize', uv.w, uv.h, {
        normalizeMaxAreaTexels: repeatNormalizeMaxAreaTexels,
      });
      if (repeatStackScanGenerationRef.current !== generation) return;
      setRepeatStackScanning(false);
      setRepeatStackReview({ source, mode: 'exact', exact, normalize });
      const moving = Math.max(exact.changedIslands, normalize.changedIslands);
      const sharing = Math.max(exact.stackedIslands, normalize.stackedIslands);
      setNote(moving > 0
        ? `repeat dry run found ${moving} UV islands that can move onto shared footprints`
        : sharing > 0
          ? `${sharing} repeated UV islands already share their proposed footprints`
          : 'repeat dry run found no congruent UV coverage families');
    }, UV_LAYOUT_TUNING.repeatScanYieldMs);
  };
  const importAtlas = () => {
    setNote('choosing a texture…');
    void bridge.importUvAtlas().then(setNote);
  };
  const addImageLayer = () => {
    const center = atlasPoint({ x: surfaceSize.width * 0.5, y: surfaceSize.height * 0.5 });
    setNote('choosing an image layer…');
    void bridge.addUvTextureLayer(Math.round(center.x), Math.round(center.y)).then((message) => {
      setSurfaceMode('images');
      setNote(message);
    });
  };
  const applyTexturePatch = (patch: TexturePatchPackage) => {
    if (!selectionBounds || selectedIndicesRef.current.length === 0) {
      setNote('Select the part or UV islands that should use this texture patch first.');
      return;
    }
    pendingPatchFocusRef.current = true;
    setNote(`adding reusable patch ${patch.name}…`);
    void bridge.addUvTextureLayer(
      Math.round(selectionBounds.x),
      Math.round(selectionBounds.y),
      patch.imagePath,
    ).then((message) => {
      if (!message.startsWith('Added ')) pendingPatchFocusRef.current = false;
      setNote(message.startsWith('Added ')
        ? `${message} · focused ${selectedIndicesRef.current.length} selected UV island${selectedIndicesRef.current.length === 1 ? '' : 's'}`
        : message);
    });
  };
  const compileImageLayers = () => {
    setCompileLabel('Preparing image layers');
    setNote('compiling the visible image workspace…');
    void bridge.compileUvTextureLayers((completed, total, label) => {
      setCompileLabel(`${label} · ${Math.min(total, completed + 1)}/${total}`);
    }).then((message) => {
      setCompileLabel(null);
      setNote(message);
    });
  };
  const editImageLayer = (id: string, edit: Parameters<ModelFocusBridge['editUvTextureLayer']>[1]) => {
    setNote(bridge.editUvTextureLayer(id, edit));
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
  const copyGuideExport = (saved: { path: string | null; note: string }) => {
    if (!saved.path) {
      setNote(saved.note);
      return;
    }
    host.__clipboard_set?.(saved.path);
    setNote(`${saved.note} · path copied`);
  };
  const exportWireframeFor = (islands: readonly UvIslandRect[]) => {
    copyGuideExport(bridge.exportUvWireframe(islands));
  };
  const exportGenerationGuideFor = (islands: readonly UvIslandRect[], numbered = false) => {
    copyGuideExport(bridge.exportUvGenerationGuide(islands, numbered));
  };
  const exportWireframeAndCopyPath = () => exportWireframeFor(rectsRef.current);
  const exportGenerationGuideAndCopyPath = (numbered = false) => exportGenerationGuideFor(rectsRef.current, numbered);
  const applyRepeatStackReview = (exportKind: UvRepeatStackExport) => {
    const review = repeatStackReview;
    if (!review) return;
    if (rectsRef.current !== review.source) {
      setRepeatStackReview(null);
      setNote('Prestack preview expired because the live UV layout changed. Run the scan again.');
      return;
    }
    const plan = review[review.mode];
    if (plan.changedIslands === 0) {
      setNote(plan.stackedIslands > 0
        ? `No UVs need moving — this layout already has the proposed ${plan.uniqueFootprints} footprints.`
        : 'No congruent repeated islands were available in this evaluation.');
      return;
    }
    const normalized = plan.normalizedIslands > 0
      ? ` · normalized ${plan.normalizedIslands} to the largest eligible family footprint`
      : '';
    const label = `prestacked ${plan.changedIslands} UV islands · ${plan.sourceFootprints}→${plan.uniqueFootprints} footprints${normalized}`;
    const applied = applyIslandSetEdit(plan.rects, label, 'stack');
    setRepeatStackReview(null);
    if (applied && exportKind === 'wireframe') exportWireframeFor(plan.rects);
    if (applied && exportKind === 'generation') exportGenerationGuideFor(plan.rects);
    if (applied && exportKind === 'generation-numbered') exportGenerationGuideFor(plan.rects, true);
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
  const contextMenuHeight = uvContextMenuHeight(menuGroup, contextMenuMeasure);
  const contextMenuPosition = uvContextMenuPosition(
    { x: uvMenu.x, y: uvMenu.y },
    panelRef.current,
    { width: UV_CONTEXT_MENU_TUNING.widthPx, height: contextMenuHeight },
    UV_CONTEXT_MENU_TUNING.edgePx,
  );
  const repeatStackPlan = repeatStackReview
    ? repeatStackReview[repeatStackReview.mode]
    : null;

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
        <Pressable
          tooltip={workspaceDoc ? 'Edit UVs over the visible source images; image placement is fixed in this mode' : 'Edit UV islands over the current atlas'}
          onPress={() => setSurfaceMode('uv')}
          style={{ height: 22, paddingLeft: 7, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4, backgroundColor: surfaceMode === 'uv' ? accentFor('segActiveBg') : accentFor('surfaceRaised'), borderWidth: 1, borderColor: surfaceMode === 'uv' ? accentFor('primary') : accentFor('border') }}
        >
          <Icon name={selectionMode === 'face' ? 'Triangle' : 'MousePointer2'} size={10} color={surfaceMode === 'uv' ? accentFor('primary') : accentFor('textDim')} />
          <Text style={{ color: surfaceMode === 'uv' ? accentFor('primary') : accentFor('textDim'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>UV</Text>
        </Pressable>
        <Pressable
          tooltip={workspaceDoc ? 'Move unlocked images; locked-image and empty-space drags pass through to UVs' : 'Add an image layer to create the editable workspace'}
          onPress={() => workspaceDoc && setSurfaceMode('images')}
          style={{ height: 22, paddingLeft: 7, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4, backgroundColor: surfaceMode === 'images' ? accentFor('segActiveBg') : accentFor('surfaceRaised'), borderWidth: 1, borderColor: surfaceMode === 'images' ? accentFor('primary') : accentFor('border'), opacity: workspaceDoc ? 1 : 0.55 }}
        >
          <Icon name="Images" size={10} color={surfaceMode === 'images' ? accentFor('primary') : accentFor('textDim')} />
          <Text style={{ color: surfaceMode === 'images' ? accentFor('primary') : accentFor('textDim'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>IMAGES</Text>
        </Pressable>
        <Text numberOfLines={1} style={{ color: accentFor('primary'), fontSize: 9, fontFamily: 'ui-monospace', fontWeight: '900', letterSpacing: 0.7 }}>{focusedPatchLayerId ? 'PATCH FOCUS' : surfaceMode === 'images' ? `${workspaceDoc?.layers.length ?? 0} LAYERS` : selectionMode === 'face' ? selectedFace ? 'FACE ISOLATED' : 'FACE SELECT' : 'ISLAND SELECT'}</Text>
        {focusedPatchLayerId ? (
          <Pressable
            tooltip="Return to the complete atlas; the patch layer and UV placement stay intact"
            onPress={() => { setFocusedPatchLayerId(null); setView(fittedView()); setNote('returned to the complete atlas'); }}
            style={{ height: 22, paddingLeft: 7, paddingRight: 7, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: accentFor('segActiveBg'), borderWidth: 1, borderColor: accentFor('primary') }}
          >
            <Text style={{ color: accentFor('primary'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>SHOW ALL</Text>
          </Pressable>
        ) : null}
        <Box style={{ flexGrow: 1 }} />
        <Text numberOfLines={1} style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '800' }}>WHEEL ZOOM · MMB PAN · RMB ACTIONS</Text>
        <Text style={{ minWidth: 42, textAlign: 'right', color: accentFor('textDim'), fontSize: 9, fontFamily: 'ui-monospace', fontWeight: '800' }}>{`${Math.round(view.scale * 100)}%`}</Text>
        <Text
          tooltip="Paint footprints count exact UV regions that need independent texture work; logical islands remain separately selectable mesh charts"
          style={{ color: accentFor('textFaint'), fontSize: 9 }}
        >{`${uv.footprints} footprints · ${rects.length} logical`}</Text>
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
          if (event?.ctrlKey || event?.metaKey) {
            const seedIndices = [...selectedIndicesRef.current];
            lastClickRef.current = null;
            gestureRef.current = {
              kind: 'marquee',
              start: atlasPoint(screen),
              current: atlasPoint(screen),
              screenStart: screen,
              activated: false,
              additive: Boolean(event?.shiftKey),
              seedIndices,
              seedPrimary: seedIndices.includes(selected) ? selected : seedIndices[0] ?? -1,
            };
            return;
          }
          if (surfaceMode === 'images' && workspaceDocRef.current) {
            const point = atlasPoint(screen);
            const route = resolveUvWorkspacePointer(workspaceDocRef.current.layers, point.x, point.y);
            const layer = route.layer;
            setSelectedLayerId(layer?.id ?? null);
            if (route.owner === 'image' && layer) {
              gestureRef.current = {
                kind: 'image',
                id: layer.id,
                start: point,
                screenStart: screen,
                activated: false,
                origin: { x: layer.x, y: layer.y },
                seed: workspaceDocRef.current,
              };
              return;
            }
            // Empty workspace and locked-image hits deliberately continue into
            // the UV path below. This lets image placement and UV alignment
            // coexist without an invisible full-canvas interaction shield.
            if (layer?.locked) setNote(`${layer.name} is locked · editing UVs through it`);
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
            gestureRef.current = {
              kind: 'scale',
              index: selected,
              target: selectedTarget,
              bounds: selectionBounds,
              start: atlasPoint(screen),
              seed: selectedRect,
            };
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
          if (gesture.kind === 'marquee') {
            if (!gesture.activated) {
              if (!shouldActivateUvDrag(screen.x - gesture.screenStart.x, screen.y - gesture.screenStart.y)) return;
              gesture.activated = true;
              setSelectionMode('island');
              setSelectedFace(null);
              setNote(gesture.additive ? 'adding UV islands crossed by area…' : 'selecting UV islands crossed by area…');
            }
            gesture.current = point;
            queueMarqueePreview(gesture.screenStart, screen);
            return;
          }
          if (gesture.kind === 'image') {
            if (!gesture.activated) {
              if (!shouldActivateUvDrag(screen.x - gesture.screenStart.x, screen.y - gesture.screenStart.y)) return;
              gesture.activated = true;
            }
            const step = event?.altKey ? 1 : translationSnapStep;
            const nextX = Math.round((gesture.origin.x + point.x - gesture.start.x) / step) * step;
            const nextY = Math.round((gesture.origin.y + point.y - gesture.start.y) / step) * step;
            const next = {
              ...gesture.seed,
              layers: gesture.seed.layers.map((layer) => layer.id === gesture.id
                ? { ...layer, x: nextX, y: nextY }
                : layer),
            };
            workspaceDocRef.current = next;
            setWorkspaceDoc(next);
            return;
          }
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
            const cornerX = gesture.bounds.x + gesture.bounds.w;
            const cornerY = gesture.bounds.y + gesture.bounds.h;
            const dragPoint = uvScaleDragPoint(gesture.bounds, gesture.start, point);
            const snapped = snapUvTranslationToGridAndGuides(
              { x: cornerX, y: cornerY, w: 0, h: 0, cx: cornerX, cy: cornerY },
              dragPoint.x - cornerX,
              dragPoint.y - cornerY,
              translationSnapStep,
              selectedGuidesRef.current,
              UV_LAYOUT_TUNING.guideSnapPx / Math.max(UV_LAYOUT_TUNING.minimumZoom, viewRef.current.scale),
              Boolean(event?.altKey),
            );
            const scalePoint = { x: cornerX + snapped.dx, y: cornerY + snapped.dy };
            guide = snapped.guides[0] ?? null;
            let scaleX = (scalePoint.x - gesture.bounds.x) / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, gesture.bounds.w);
            let scaleY = (scalePoint.y - gesture.bounds.y) / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, gesture.bounds.h);
            if (aspectLocked) {
              const uniform = Math.max(
                UV_LAYOUT_TUNING.minimumSelectionScale,
                Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY,
              );
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
        <Effect shader={WORKSPACE_CHECKER_SHADER} data={workspaceCheckerData} style={{ position: 'absolute', left: 0, top: 0, width: surfaceSize.width, height: surfaceSize.height }} />
        {workspaceDoc && uv.packageDir ? (
          <>
            {workspaceDoc.layers.filter((layer) => layer.visible && (!focusedPatchLayerId || layer.id === focusedPatchLayerId)).map((layer) => (
              <Image
                key={`uv-workspace-image-${layer.id}-${layer.source}`}
                source={`${uv.packageDir}/${layer.source}`}
                style={{
                  position: 'absolute',
                  left: view.x + layer.x * view.scale,
                  top: view.y + layer.y * view.scale,
                  width: layer.width * view.scale,
                  height: layer.height * view.scale,
                  pointerEvents: 'none',
                }}
              />
            ))}
            {(() => {
              const layer = workspaceDoc.layers.find((candidate) => candidate.id === selectedLayerId);
              return surfaceMode === 'images' && layer?.visible ? (
                <>
                  <Box style={{
                    position: 'absolute',
                    left: view.x + layer.x * view.scale,
                    top: view.y + layer.y * view.scale,
                    width: layer.width * view.scale,
                    height: layer.height * view.scale,
                    borderWidth: 2,
                    borderColor: layer.locked ? '#d5aa69' : accentFor('primary'),
                    pointerEvents: 'none',
                  }} />
                  {layer.locked ? (
                    <Box style={{
                      position: 'absolute',
                      left: view.x + layer.x * view.scale + 4,
                      top: view.y + layer.y * view.scale + 4,
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#17130ddd',
                      borderWidth: 1,
                      borderColor: '#d5aa69',
                      pointerEvents: 'none',
                    }}>
                      <Icon name="Lock" size={11} color="#d5aa69" />
                    </Box>
                  ) : null}
                </>
              ) : null;
            })()}
          </>
        ) : (
          <>
            <Effect shader={ATLAS_SHADER} data={atlasEffectData} textures={[texture.id]} style={{ position: 'absolute', left: atlasLeft, top: atlasTop, width: atlasW, height: atlasH }} />
            <Box style={{ position: 'absolute', left: atlasLeft, top: atlasTop, width: atlasW, height: atlasH, borderWidth: 2, borderColor: '#71839a', pointerEvents: 'none' }} />
          </>
        )}
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
        {marqueeFrame ? (
          <Box style={{
            position: 'absolute',
            left: marqueeFrame.left,
            top: marqueeFrame.top,
            width: marqueeFrame.width,
            height: marqueeFrame.height,
            backgroundColor: '#42d9e824',
            borderWidth: 1,
            borderColor: '#72edf7',
            pointerEvents: 'none',
          }} />
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
        <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace', letterSpacing: 0.4 }}>{`${multiIslandSelection ? `${selectedIndices.length} ISLANDS · RIGID SNAP ${translationSnapStep}px` : `GRID SNAP ${translationSnapStep}px`} · CTRL DRAG = AREA SELECT · ${selectedGuides.length > 0 ? `${selectedGuides.length} GUIDE${selectedGuides.length === 1 ? '' : 'S'}` : 'CLICK GRID = GUIDE'}`}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace' }}>{`INFINITE WORKSPACE · ATLAS ${uv.w}×${uv.h} @ ${uv.atlasOriginX},${uv.atlasOriginY}`}</Text>
      </Row>

      <Row style={{ height: 29, alignItems: 'center', gap: 4 }}>
        <Text style={{ width: 48, color: accentFor('textDim'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900', letterSpacing: 0.4 }}>UV TOTAL</Text>
        <UvNumberField
          label="W"
          value={atlasWidthDraft}
          min={UV_ATLAS_SIZE_TUNING.minDimension}
          max={UV_ATLAS_SIZE_TUNING.maxDimension}
          disabled={atlasResizePending}
          onCommit={setAtlasWidthDraft}
        />
        <UvNumberField
          label="H"
          value={atlasHeightDraft}
          min={UV_ATLAS_SIZE_TUNING.minDimension}
          max={UV_ATLAS_SIZE_TUNING.maxDimension}
          disabled={atlasResizePending}
          onCommit={setAtlasHeightDraft}
        />
        <Text
          numberOfLines={1}
          style={{ minWidth: 92, color: atlasResizeResult.ok ? accentFor('textFaint') : '#ef8f8f', fontSize: 7, fontFamily: 'ui-monospace', textAlign: 'center' }}
        >
          {atlasResizePlan ? uvAtlasResizePreview(atlasResizePlan) : 'INVALID SIZE'}
        </Text>
        <Pressable
          tooltip={atlasResizeResult.ok
            ? `Resize the atlas coordinate frame ${uv.w}×${uv.h} → ${atlasWidthDraft}×${atlasHeightDraft}; normalized UV placement stays fixed`
            : atlasResizeResult.error}
          onPress={() => atlasResizePlan?.changed && !atlasResizePending && !compileLabel && applyAtlasResize()}
          style={{
            width: 58,
            height: 29,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            backgroundColor: atlasResizePlan?.changed ? accentFor('segActiveBg') : accentFor('surfaceRaised'),
            borderWidth: 1,
            borderColor: atlasResizePlan?.changed ? accentFor('primary') : accentFor('border'),
            opacity: atlasResizePlan?.changed && !atlasResizePending && !compileLabel ? 1 : 0.5,
          }}
        >
          <Text style={{ color: atlasResizePlan?.changed ? accentFor('primary') : accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>
            {atlasResizePending ? 'WORKING' : 'RESIZE'}
          </Text>
        </Pressable>
      </Row>

      <Row style={{ alignItems: 'center', gap: 4 }}>
        {surfaceMode === 'images' ? (() => {
          const layer = workspaceDoc?.layers.find((candidate) => candidate.id === selectedLayerId) ?? null;
          return (
            <>
              <UvNumberField label="X" value={layer?.x ?? null} min={-UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate} max={UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate} disabled={layer?.locked} onCommit={(value) => layer && editImageLayer(layer.id, { kind: 'position', x: value, y: layer.y })} />
              <UvNumberField label="Y" value={layer?.y ?? null} min={-UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate} max={UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate} disabled={layer?.locked} onCommit={(value) => layer && editImageLayer(layer.id, { kind: 'position', x: layer.x, y: value })} />
              <Pressable
                tooltip={layer ? `Use ${layer.width}×${layer.height} as the UV total above` : 'Select an image first'}
                onPress={() => {
                  if (!layer) return;
                  setAtlasWidthDraft(layer.width);
                  setAtlasHeightDraft(layer.height);
                  setNote(`UV total draft matched ${layer.name} · press Resize to apply`);
                }}
                style={{ flexGrow: 2, height: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: accentFor('controlBg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4 }}
              >
                <Text style={{ color: layer?.locked ? '#d5aa69' : accentFor('textDim'), fontSize: 9, fontFamily: 'ui-monospace' }}>{layer ? `${layer.width}×${layer.height} NATIVE PX${layer.locked ? ' · LOCKED' : ''}` : 'SELECT AN IMAGE'}</Text>
              </Pressable>
            </>
          );
        })() : (
          <>
            <UvNumberField label="X" value={selectionBounds ? Math.round(selectionBounds.x) : null} min={-UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate} max={UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate} onCommit={(value) => changeCoordinate('x', value)} />
            <UvNumberField label="Y" value={selectionBounds ? Math.round(selectionBounds.y) : null} min={-UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate} max={UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate} onCommit={(value) => changeCoordinate('y', value)} />
            <UvNumberField label="W" value={selectionBounds && !multiIslandSelection ? Math.max(1, Math.round(selectionBounds.w)) : null} min={1} max={UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate} onCommit={(value) => changeCoordinate('w', value)} />
            <UvNumberField label="H" value={selectionBounds && !multiIslandSelection ? Math.max(1, Math.round(selectionBounds.h)) : null} min={1} max={UV_TEXTURE_WORKSPACE_TUNING.maxCoordinate} onCommit={(value) => changeCoordinate('h', value)} />
            <Pressable tooltip={aspectLocked ? 'Unlock width and height' : 'Lock width/height aspect'} onPress={() => setAspectLocked((value) => !value)} style={{ width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: aspectLocked ? accentFor('segActiveBg') : accentFor('surfaceRaised'), borderWidth: 1, borderColor: aspectLocked ? accentFor('primary') : accentFor('border') }}>
              <Icon name={aspectLocked ? 'Link2' : 'Link2Off'} size={13} color={aspectLocked ? accentFor('primary') : accentFor('textDim')} />
            </Pressable>
          </>
        )}
      </Row>

      {note ? <Text numberOfLines={1} style={{ color: accentFor('textDim'), fontSize: 9 }}>{note}</Text> : null}

      <Box style={{ borderTopWidth: 1, borderTopColor: accentFor('borderSoft'), paddingTop: 7, gap: 5 }}>
        <Row style={{ height: 23, alignItems: 'center', gap: 5 }}>
          <Text style={{ color: accentFor('textDim'), fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>REUSABLE PATCHES</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace' }}>{texturePatches.length > 0 ? `${texturePatches.length} EXACT IMAGE${texturePatches.length === 1 ? '' : 'S'}` : 'IMPORT AN EXACT IMAGE'}</Text>
        </Row>
        {texturePatches.length > 0 ? (
          <ScrollView style={{ maxHeight: 82 }} showScrollbar>
            <Row style={{ flexWrap: 'wrap', gap: 5 }}>
              {texturePatches.map((patch) => (
                <Pressable
                  key={`uv-patch-${patch.id}`}
                  tooltip={`Use ${patch.name} on the selected part or UV islands`}
                  onPress={() => applyTexturePatch(patch)}
                  style={{ width: 116, height: 70, padding: 4, gap: 3, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('borderSoft'), borderRadius: 4 }}
                >
                  <Image source={patch.imagePath} style={{ width: 106, height: 44 }} />
                  <Text numberOfLines={1} style={{ color: accentFor('textDim'), fontSize: 8, fontWeight: '800' }}>{patch.name}</Text>
                </Pressable>
              ))}
            </Row>
          </ScrollView>
        ) : (
          <Text style={{ color: accentFor('textFaint'), fontSize: 9 }}>Import an image as Exact Image once; it will appear here for every model.</Text>
        )}
        <Row style={{ height: 23, alignItems: 'center', gap: 5 }}>
          <Text style={{ color: accentFor('textDim'), fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>TEXTURES</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable
            tooltip="Store another original image in this model and place it at native pixel resolution"
            onPress={addImageLayer}
            style={{ height: 21, paddingLeft: 6, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}
          >
            <Icon name="ImagePlus" size={10} color={accentFor('primary')} />
            <Text style={{ color: accentFor('textDim'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>ADD</Text>
          </Pressable>
          <Pressable
            tooltip="Composite visible sources into the smallest transparent texture without resampling; originals remain editable"
            onPress={() => workspaceDoc && !compileLabel && compileImageLayers()}
            style={{ height: 21, paddingLeft: 6, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4, backgroundColor: workspaceDoc && uvTextureWorkspaceIsStale(workspaceDoc) ? accentFor('segActiveBg') : accentFor('surfaceRaised'), borderWidth: 1, borderColor: workspaceDoc && uvTextureWorkspaceIsStale(workspaceDoc) ? accentFor('primary') : accentFor('border'), opacity: workspaceDoc ? 1 : 0.55 }}
          >
            <Icon name="PackageCheck" size={10} color={workspaceDoc && uvTextureWorkspaceIsStale(workspaceDoc) ? accentFor('primary') : accentFor('textDim')} />
            <Text style={{ color: accentFor('textDim'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>{compileLabel ? 'WORKING' : 'COMPILE'}</Text>
          </Pressable>
          <Pressable
            tooltip="Dry-run every UV coverage boundary through four quarter-turns, then a horizontal flip and four more turns"
            onPress={beginRepeatStackReview}
            style={{ height: 21, paddingLeft: 6, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4, backgroundColor: repeatStackScanning ? accentFor('segActiveBg') : accentFor('surfaceRaised'), borderWidth: 1, borderColor: repeatStackScanning ? accentFor('primary') : accentFor('border') }}
          >
            <Icon name="Layers3" size={10} color={accentFor('primary')} />
            <Text style={{ color: accentFor('textDim'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>{repeatStackScanning ? 'SCAN' : 'PRESTACK'}</Text>
          </Pressable>
          <Pressable
            tooltip="Export an atlas-sized UV wireframe PNG with a transparent background and copy its path"
            onPress={exportWireframeAndCopyPath}
            style={{ height: 21, paddingLeft: 6, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}
          >
            <Icon name="ImageDown" size={10} color={accentFor('primary')} />
            <Text style={{ color: accentFor('textDim'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>WIRE PNG</Text>
          </Pressable>
          <Pressable
            tooltip="Export the UV edges on a 6%-alpha pink canvas that image generation can perceive; numbering is optional in the context menu"
            onPress={() => exportGenerationGuideAndCopyPath(false)}
            style={{ height: 21, paddingLeft: 6, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}
          >
            <Icon name="ImageDown" size={10} color="#d7acb9" />
            <Text style={{ color: accentFor('textDim'), fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>AI GUIDE</Text>
          </Pressable>
        </Row>
        {compileLabel ? <Text numberOfLines={1} style={{ color: accentFor('primary'), fontSize: 8, fontFamily: 'ui-monospace' }}>{compileLabel}</Text> : null}
        {workspaceDoc && uv.packageDir ? (
          <ScrollView style={{ maxHeight: 132 }} showScrollbar>
            {[...workspaceDoc.layers].reverse().map((layer) => {
              const index = workspaceDoc.layers.findIndex((candidate) => candidate.id === layer.id);
              const active = layer.id === selectedLayerId;
              return (
                <Pressable
                  key={`uv-layer-row-${layer.id}`}
                  onPress={() => setSelectedLayerId(layer.id)}
                  style={{ height: 39, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 5, paddingRight: 5, backgroundColor: active ? accentFor('segActiveBg') : accentFor('surfaceRaised'), borderWidth: 1, borderColor: active ? accentFor('primary') : accentFor('borderSoft') }}
                >
                  <Pressable tooltip={layer.visible ? 'Hide this source from preview and compile' : 'Show this source'} onPress={() => editImageLayer(layer.id, { kind: 'visible', visible: !layer.visible })} style={{ width: 22, height: 27, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={layer.visible ? 'Eye' : 'EyeOff'} size={11} color={layer.visible ? accentFor('primary') : accentFor('textFaint')} />
                  </Pressable>
                  <Pressable tooltip={layer.locked ? 'Unlock this image for canvas and numeric movement' : 'Lock this image in place while editing UVs'} onPress={() => editImageLayer(layer.id, { kind: 'locked', locked: !layer.locked })} style={{ width: 20, height: 27, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={layer.locked ? 'Lock' : 'LockOpen'} size={11} color={layer.locked ? '#d5aa69' : accentFor('textFaint')} />
                  </Pressable>
                  <Box style={{ width: 29, height: 29, overflow: 'hidden', backgroundColor: '#11151d', borderWidth: 1, borderColor: accentFor('border') }}>
                    {layer.visible ? <Image source={`${uv.packageDir}/${layer.source}`} style={{ width: 29, height: 29 }} /> : null}
                  </Box>
                  <Box style={{ flexGrow: 1, minWidth: 0, gap: 1 }}>
                    <Text numberOfLines={1} style={{ color: active ? accentFor('text') : accentFor('textDim'), fontSize: 9, fontWeight: '800' }}>{layer.name}</Text>
                    <Text numberOfLines={1} style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace' }}>{`${layer.width}×${layer.height} · ${layer.x},${layer.y}`}</Text>
                  </Box>
                  <Pressable tooltip="Move layer up" onPress={() => editImageLayer(layer.id, { kind: 'raise' })} style={{ width: 18, height: 25, alignItems: 'center', justifyContent: 'center', opacity: index < workspaceDoc.layers.length - 1 ? 1 : 0.35 }}>
                    <Icon name="ChevronUp" size={10} color={accentFor('textDim')} />
                  </Pressable>
                  <Pressable tooltip="Move layer down" onPress={() => editImageLayer(layer.id, { kind: 'lower' })} style={{ width: 18, height: 25, alignItems: 'center', justifyContent: 'center', opacity: index > 0 ? 1 : 0.35 }}>
                    <Icon name="ChevronDown" size={10} color={accentFor('textDim')} />
                  </Pressable>
                  <Pressable tooltip="Remove layer from the document; its stored source remains recoverable in the package" onPress={() => editImageLayer(layer.id, { kind: 'remove' })} style={{ width: 18, height: 25, alignItems: 'center', justifyContent: 'center', opacity: workspaceDoc.layers.length > 1 ? 1 : 0.35 }}>
                    <Icon name="Trash2" size={10} color="#ef6a6a" />
                  </Pressable>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : (
          <Box style={{ height: 47, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 7, backgroundColor: accentFor('segActiveBg'), borderWidth: 1, borderColor: accentFor('primary') }}>
            <Box style={{ width: 32, height: 32, position: 'relative', overflow: 'hidden', backgroundColor: '#11151d', borderWidth: 1, borderColor: accentFor('border') }}>
              <Effect shader={ATLAS_SHADER} data={thumbnailEffectData} textures={[texture.id]} style={{ position: 'absolute', left: 0, top: 0, width: 32, height: 32 }} />
            </Box>
            <Box style={{ flexGrow: 1, minWidth: 0, gap: 2 }}>
              <Text style={{ color: accentFor('text'), fontSize: 10, fontWeight: '800' }}>base.png</Text>
              <Text style={{ color: accentFor('textFaint'), fontSize: 9, fontFamily: 'ui-monospace' }}>{`${uv.w}×${uv.h}px · ${uv.detail} texels/m target`}</Text>
            </Box>
            <Icon name="Save" size={13} color={accentFor('primary')} />
          </Box>
        )}
      </Box>

      <uvMenu.ContextMenu
        onDismiss={() => setMenuGroup(null)}
        style={{ left: contextMenuPosition.x, top: contextMenuPosition.y, width: UV_CONTEXT_MENU_TUNING.widthPx }}
      >
        <C.HW_StageContextMenu
          onLayout={(layout: any) => {
            const height = Math.ceil(Number(layout.height));
            if (!Number.isFinite(height) || height <= 0) return;
            setContextMenuMeasure((current) => (
              current.group === menuGroup && current.height === height
                ? current
                : { group: menuGroup, height }
            ));
          }}
          style={{ width: UV_CONTEXT_MENU_TUNING.widthPx }}
        >
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
              <UvContextRow
                indented
                icon="RotateCcw"
                label="Reset UV Layout"
                detail="ATLAS START"
                enabled={rects.length > 0}
                tooltip="Restore every UV corner to the immutable layout saved when this atlas was created; one undo step"
                onPress={() => runMenuAction(() => setNote(bridge.resetUvLayout()))}
              />
              <UvContextRow
                indented
                icon="Layers3"
                label="Prestack Repeated Islands…"
                detail="DRY RUN"
                enabled={rects.length > 1 && !repeatStackScanning}
                tooltip="Compare every UV coverage boundary through four quarter-turns, then a horizontal flip and four more turns; preview and confirm one undoable stack"
                onPress={() => runMenuAction(beginRepeatStackReview)}
              />
              <UvContextRow indented icon="Grid3x3" label="Uniform Pack All Islands" enabled={rects.length > 0} onPress={() => runMenuAction(packAtlas)} />
              <UvContextRow indented icon="ImagePlus" label="Add Image Layer…" detail="NATIVE PX" onPress={() => runMenuAction(addImageLayer)} />
              <UvContextRow indented icon="PackageCheck" label="Compile Image Layers" detail={workspaceDoc && uvTextureWorkspaceIsStale(workspaceDoc) ? 'STALE' : workspaceDoc ? 'CURRENT' : 'EMPTY'} enabled={Boolean(workspaceDoc) && !compileLabel} tooltip="Crop the signed image workspace to its visible union and composite transparent gaps; originals stay separate" onPress={() => runMenuAction(compileImageLayers)} />
              <UvContextRow indented icon="ImagePlus" label="Import Texture…" onPress={() => runMenuAction(importAtlas)} />
              <UvContextRow indented icon="RefreshCw" label="Reload base.png" onPress={() => runMenuAction(() => setNote(bridge.reloadUvAtlas()))} />
              <UvContextRow indented icon="Copy" label="Save & Copy Atlas Path" enabled={Boolean(uv.diskPath)} onPress={() => runMenuAction(saveAndCopyAtlasPath)} />
              <UvContextRow indented icon="ImageDown" label="Export Transparent Wireframe" detail="PNG + COPY PATH" enabled={rects.length > 0} tooltip="Write authored UV edges only; transparent background, with quad diagonals omitted" onPress={() => runMenuAction(exportWireframeAndCopyPath)} />
              <UvContextRow indented icon="ImageDown" label="Export AI Guide" detail="6% PINK + COPY PATH" enabled={rects.length > 0} tooltip="Write a faint pink alpha signal that image generation can perceive, with no footprint labels" onPress={() => runMenuAction(() => exportGenerationGuideAndCopyPath(false))} />
              <UvContextRow indented icon="Hash" label="Export Numbered AI Guide" detail="FITTED LABELS + COPY" enabled={rects.length > 0} tooltip="Add a fitted number only where its entire plate can remain inside an authored UV triangle; tiny slivers stay unlabelled" onPress={() => runMenuAction(() => exportGenerationGuideAndCopyPath(true))} />
            </>
          ) : null}
        </C.HW_StageContextMenu>
      </uvMenu.ContextMenu>

      {repeatStackScanning ? (
        <Box
          blocksPointerEvents
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(4,7,11,0.72)' }}
        >
          <Box style={{ width: 282, padding: 16, gap: 8, alignItems: 'center', backgroundColor: '#111821', borderWidth: 1, borderColor: accentFor('primary'), borderRadius: 9 }}>
            <Icon name="ScanSearch" size={18} color={accentFor('primary')} />
            <Text style={{ color: accentFor('text'), fontSize: 11, fontWeight: '900', letterSpacing: 0.8 }}>SCANNING UV COVERAGE</Text>
            <Text style={{ color: accentFor('textDim'), fontSize: 9, fontFamily: 'ui-monospace', textAlign: 'center' }}>{`${rects.length} islands · 4 turns + horizontal flip × 4 turns`}</Text>
          </Box>
        </Box>
      ) : null}

      {repeatStackReview && repeatStackPlan ? (
        <Box
          blocksPointerEvents
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(4,7,11,0.74)' }}
        >
          <Box style={{ width: 368, padding: 14, gap: 10, backgroundColor: '#111821', borderWidth: 1, borderColor: accentFor('primary'), borderRadius: 9 }}>
            <Row style={{ alignItems: 'center', gap: 8 }}>
              <Icon name="Layers3" size={15} color={accentFor('primary')} />
              <Box style={{ flexGrow: 1, minWidth: 0, gap: 1 }}>
                <Text style={{ color: accentFor('text'), fontSize: 12, fontWeight: '900' }}>Prestack Repeated UVs</Text>
                <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace' }}>DRY RUN · NO UVS CHANGED YET</Text>
              </Box>
              <Pressable onPress={() => setRepeatStackReview(null)} style={{ width: 25, height: 25, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="X" size={13} color={accentFor('textDim')} />
              </Pressable>
            </Row>

            <Row style={{ height: 31, gap: 5 }}>
              {([
                ['exact', 'EXACT SCALE'],
                ['normalize', 'NORMALIZE'],
              ] as const).map(([mode, label]) => {
                const active = repeatStackReview.mode === mode;
                return (
                  <Pressable
                    key={`repeat-stack-mode-${mode}`}
                    onPress={() => setRepeatStackReview((current) => current ? { ...current, mode } : current)}
                    style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: active ? accentFor('primary') : accentFor('border'), backgroundColor: active ? accentFor('segActiveBg') : accentFor('surfaceRaised') }}
                  >
                    <Text style={{ color: active ? accentFor('primary') : accentFor('textDim'), fontSize: 9, fontFamily: 'ui-monospace', fontWeight: '900' }}>{label}</Text>
                  </Pressable>
                );
              })}
            </Row>

            {repeatStackReview.mode === 'normalize' ? (
              <Row style={{ minHeight: 37, alignItems: 'center', gap: 7, paddingLeft: 8, paddingRight: 8, backgroundColor: '#0b1118', borderWidth: 1, borderColor: '#7c633f', borderRadius: 6 }}>
                <Box style={{ flexGrow: 1, minWidth: 0, gap: 1 }}>
                  <Text style={{ color: '#d7ac6d', fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>MAX NORMALIZE AREA</Text>
                  <Text numberOfLines={1} style={{ color: accentFor('textFaint'), fontSize: 7 }}>Larger current UV surfaces stay independent</Text>
                </Box>
                <Box style={{ width: 104 }}>
                  <UvNumberField
                    label="A"
                    value={repeatNormalizeMaxAreaTexels}
                    min={1}
                    max={UV_ATLAS_SIZE_TUNING.maxDimension * UV_ATLAS_SIZE_TUNING.maxDimension}
                    onCommit={updateRepeatNormalizeMaxArea}
                  />
                </Box>
                <Text style={{ color: '#d7ac6d', fontSize: 8, fontFamily: 'ui-monospace', fontWeight: '900' }}>PX²</Text>
              </Row>
            ) : null}

            <Box style={{ padding: 10, gap: 5, backgroundColor: '#0b1118', borderWidth: 1, borderColor: accentFor('borderSoft'), borderRadius: 6 }}>
              <Row style={{ alignItems: 'center' }}>
                <Text style={{ color: accentFor('textDim'), fontSize: 9 }}>Current footprints → proposed</Text>
                <Box style={{ flexGrow: 1 }} />
                <Text style={{ color: accentFor('primary'), fontSize: 11, fontFamily: 'ui-monospace', fontWeight: '900' }}>{`${repeatStackPlan.sourceFootprints} → ${repeatStackPlan.uniqueFootprints}`}</Text>
              </Row>
              <Row style={{ alignItems: 'center' }}>
                <Text style={{ color: accentFor('textDim'), fontSize: 9 }}>Logical islands</Text>
                <Box style={{ flexGrow: 1 }} />
                <Text style={{ color: accentFor('text'), fontSize: 10, fontFamily: 'ui-monospace', fontWeight: '800' }}>{`${repeatStackPlan.sourceIslands}`}</Text>
              </Row>
              <Row style={{ alignItems: 'center' }}>
                <Text style={{ color: accentFor('textDim'), fontSize: 9 }}>Congruent families</Text>
                <Box style={{ flexGrow: 1 }} />
                <Text style={{ color: accentFor('text'), fontSize: 10, fontFamily: 'ui-monospace', fontWeight: '800' }}>{`${repeatStackPlan.groups.length}`}</Text>
              </Row>
              <Row style={{ alignItems: 'center' }}>
                <Text style={{ color: repeatStackPlan.changedIslands > 0 ? accentFor('primary') : accentFor('textDim'), fontSize: 9 }}>UV islands moving</Text>
                <Box style={{ flexGrow: 1 }} />
                <Text style={{ color: repeatStackPlan.changedIslands > 0 ? accentFor('primary') : accentFor('text'), fontSize: 10, fontFamily: 'ui-monospace', fontWeight: '900' }}>{`${repeatStackPlan.changedIslands}`}</Text>
              </Row>
              <Row style={{ alignItems: 'center' }}>
                <Text style={{ color: accentFor('textDim'), fontSize: 9 }}>Repeated members sharing</Text>
                <Box style={{ flexGrow: 1 }} />
                <Text style={{ color: accentFor('text'), fontSize: 10, fontFamily: 'ui-monospace', fontWeight: '800' }}>{`${repeatStackPlan.stackedIslands}`}</Text>
              </Row>
              {repeatStackReview.mode === 'normalize' ? (
                <>
                  <Row style={{ alignItems: 'center' }}>
                    <Text style={{ color: '#d7ac6d', fontSize: 9 }}>Texel scales changed</Text>
                    <Box style={{ flexGrow: 1 }} />
                    <Text style={{ color: '#d7ac6d', fontSize: 10, fontFamily: 'ui-monospace', fontWeight: '800' }}>{`${repeatStackPlan.normalizedIslands}`}</Text>
                  </Row>
                  <Row style={{ alignItems: 'center' }}>
                    <Text style={{ color: '#d7ac6d', fontSize: 9 }}>Larger matches protected</Text>
                    <Box style={{ flexGrow: 1 }} />
                    <Text style={{ color: '#d7ac6d', fontSize: 10, fontFamily: 'ui-monospace', fontWeight: '800' }}>{`${repeatStackPlan.normalizationProtectedIslands}`}</Text>
                  </Row>
                </>
              ) : null}
              {repeatStackPlan.unclassifiedIslands > 0 ? (
                <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace' }}>{`${repeatStackPlan.unclassifiedIslands} legacy rectangle-only rows left untouched`}</Text>
              ) : null}
              {repeatStackPlan.changedIslands === 0 && repeatStackPlan.stackedIslands > 0 ? (
                <Text style={{ color: '#86d7a2', fontSize: 8, fontFamily: 'ui-monospace' }}>ALREADY STACKED · APPLY HAS NO PENDING UV MUTATION</Text>
              ) : null}
            </Box>

            <Text style={{ color: repeatStackReview.mode === 'normalize' ? '#d7ac6d' : accentFor('textDim'), fontSize: 9, lineHeight: 14 }}>
              {repeatStackReview.mode === 'normalize'
                ? `Only congruent surfaces at or below ${repeatNormalizeMaxAreaTexels}px² ignore uniform scale and adopt the largest eligible footprint. Larger surfaces cannot be pulled into a sliver family.`
                : 'Only equal UV coverage already at the same texel scale overlaps. Four quarter-turns and the same four turns after a horizontal flip are tested; equal bounds with different silhouettes stay separate.'}
            </Text>
            <Text style={{ color: accentFor('textFaint'), fontSize: 8, lineHeight: 12 }}>
              Uniform Pack All Islands now keeps confirmed stacks together if you want to normalize and compact them afterward.
            </Text>

            <Row style={{ justifyContent: 'flex-end', gap: 6 }}>
              <Pressable
                onPress={() => setRepeatStackReview(null)}
                style={{ height: 29, paddingLeft: 11, paddingRight: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: accentFor('border') }}
              >
                <Text style={{ color: accentFor('textDim'), fontSize: 9, fontWeight: '800' }}>CANCEL</Text>
              </Pressable>
              <Pressable
                onPress={() => repeatStackPlan.changedIslands > 0 && applyRepeatStackReview('none')}
                style={{ height: 29, paddingLeft: 11, paddingRight: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: repeatStackPlan.changedIslands > 0 ? accentFor('primary') : accentFor('border'), opacity: repeatStackPlan.changedIslands > 0 ? 1 : 0.4 }}
              >
                <Text style={{ color: repeatStackPlan.changedIslands > 0 ? accentFor('primary') : accentFor('textFaint'), fontSize: 9, fontWeight: '900' }}>APPLY</Text>
              </Pressable>
              <Pressable
                tooltip="Apply the reviewed prestack and export the truly transparent guide"
                onPress={() => repeatStackPlan.changedIslands > 0 && applyRepeatStackReview('wireframe')}
                style={{ height: 29, paddingLeft: 9, paddingRight: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: repeatStackPlan.changedIslands > 0 ? accentFor('primary') : accentFor('border'), opacity: repeatStackPlan.changedIslands > 0 ? 1 : 0.4 }}
              >
                <Text style={{ color: repeatStackPlan.changedIslands > 0 ? accentFor('primary') : accentFor('textFaint'), fontSize: 8, fontWeight: '900' }}>+ WIRE</Text>
              </Pressable>
              <Pressable
                tooltip="Apply the reviewed prestack and export the unnumbered 6%-pink image-generation guide"
                onPress={() => repeatStackPlan.changedIslands > 0 && applyRepeatStackReview('generation')}
                style={{ height: 29, paddingLeft: 8, paddingRight: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: repeatStackPlan.changedIslands > 0 ? accentFor('primary') : accentFor('border'), opacity: repeatStackPlan.changedIslands > 0 ? 1 : 0.4 }}
              >
                <Text style={{ color: repeatStackPlan.changedIslands > 0 ? accentFor('primary') : accentFor('textFaint'), fontSize: 8, fontWeight: '900' }}>+ AI</Text>
              </Pressable>
              <Pressable
                tooltip="Apply the reviewed prestack and export the optional fitted-number guide"
                onPress={() => repeatStackPlan.changedIslands > 0 && applyRepeatStackReview('generation-numbered')}
                style={{ height: 29, paddingLeft: 8, paddingRight: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: repeatStackPlan.changedIslands > 0 ? accentFor('primary') : accentFor('surfaceRaised'), opacity: repeatStackPlan.changedIslands > 0 ? 1 : 0.4 }}
              >
                <Text style={{ color: repeatStackPlan.changedIslands > 0 ? '#071015' : accentFor('textFaint'), fontSize: 8, fontWeight: '900' }}>+ AI #</Text>
              </Pressable>
            </Row>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
