import { useEffect, useRef, useState } from 'react';
import { Box, Effect, Graph, Paintable, Pressable, Row, Text, TextInput } from '../../../runtime/primitives';
import { usePaintable } from '../../../runtime/hooks/usePaintable';
import { Icon } from '../../../runtime/icons/Icon';
import { parseClampedNumericDraft, replacementDraftAfterEdit } from '../../../runtime/paint/numericInput';
import { accentFor } from '../workspace.cls';
import type { ModelFocusBridge, ModelFocusUv } from '../stage/ModelView';
import {
  flattenUvIslandRects,
  hitUvIsland,
  moveUvIsland,
  resizeUvIslandFromCorner,
  shouldPanUvCanvas,
  uniformUvPack,
  uvRectPath,
  UV_LAYOUT_TUNING,
  type UvCanvasTool,
  type UvIslandRect,
  type UvResizeCorner,
} from '../model/uvLayout';

const ATLAS_SHADER = `
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  return textureSampleLevel(tex, smp, in.uv, 0.0);
}`;

type View = { x: number; y: number; scale: number };
type ScreenPoint = { x: number; y: number };
type Gesture =
  | { kind: 'pan'; start: ScreenPoint; seed: View }
  | { kind: 'move'; index: number; start: ScreenPoint; seed: UvIslandRect }
  | { kind: 'resize'; index: number; corner: UvResizeCorner; start: ScreenPoint; seed: UvIslandRect };

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

function checkerPath(width: number, height: number): string {
  const cell = UV_LAYOUT_TUNING.checkerPx;
  let path = '';
  for (let y = 0, row = 0; y < height; y += cell, row += 1) {
    for (let x = (row % 2) * cell; x < width; x += cell * 2) {
      path += `M ${x},${y} L ${Math.min(width, x + cell)},${y} L ${Math.min(width, x + cell)},${Math.min(height, y + cell)} L ${x},${Math.min(height, y + cell)} Z `;
    }
  }
  return path;
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
  rectsRef.current = rects;
  const [selected, setSelected] = useState(-1);
  const [note, setNote] = useState<string | null>(null);
  const [tool, setTool] = useState<UvCanvasTool>('select');
  const [aspectLocked, setAspectLocked] = useState(false);
  const [surfaceSize, setSurfaceSize] = useState({ width: 1, height: 1 });
  const surfaceRef = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const gestureRef = useRef<Gesture | null>(null);
  const [view, setViewState] = useState<View>({ x: UV_LAYOUT_TUNING.canvasPaddingPx, y: UV_LAYOUT_TUNING.canvasPaddingPx, scale: 1 });
  const viewRef = useRef(view);
  const viewKeyRef = useRef('');

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

  useEffect(() => {
    const next = initialRects();
    setRects(next);
    rectsRef.current = next;
    setSelected((index) => Math.min(index, uv.islands.length - 1));
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
    if (!bridge.applyUvLayout(flattenUvIslandRects(next))) {
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
  const active = activeRange ? rects.filter((rect) => rect.group >= activeRange.lo && rect.group < activeRange.hi) : [];
  const selectedRect = selected >= 0 ? rects[selected] ?? null : null;
  const rectScreenPath = (items: readonly UvIslandRect[]) => uvRectPath(items, view.scale, view.scale, view.x, view.y);
  const handlePoints: { corner: UvResizeCorner; x: number; y: number }[] = selectedRect ? [
    { corner: 'nw', x: view.x + selectedRect.x * view.scale, y: view.y + selectedRect.y * view.scale },
    { corner: 'ne', x: view.x + (selectedRect.x + selectedRect.w) * view.scale, y: view.y + selectedRect.y * view.scale },
    { corner: 'se', x: view.x + (selectedRect.x + selectedRect.w) * view.scale, y: view.y + (selectedRect.y + selectedRect.h) * view.scale },
    { corner: 'sw', x: view.x + selectedRect.x * view.scale, y: view.y + (selectedRect.y + selectedRect.h) * view.scale },
  ] : [];
  const hitHandle = (point: ScreenPoint): UvResizeCorner | null => {
    const radius = UV_LAYOUT_TUNING.resizeHandlePx;
    for (const handle of handlePoints) {
      if (Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius) return handle.corner;
    }
    return null;
  };
  const zoomAt = (point: ScreenPoint, factor: number) => {
    const current = viewRef.current;
    const nextScale = clamp(current.scale * factor, UV_LAYOUT_TUNING.minimumZoom, UV_LAYOUT_TUNING.maximumZoom);
    const ax = (point.x - current.x) / current.scale;
    const ay = (point.y - current.y) / current.scale;
    setView({ x: point.x - ax * nextScale, y: point.y - ay * nextScale, scale: nextScale });
  };

  const changeCoordinate = (field: 'x' | 'y' | 'w' | 'h', value: number) => {
    const rect = selectedRect;
    if (!rect) return;
    let changed = { ...rect, [field]: value };
    if (field === 'x') changed.x = clamp(value, 0, uv.w - rect.w);
    if (field === 'y') changed.y = clamp(value, 0, uv.h - rect.h);
    if (field === 'w') {
      changed.w = clamp(value, 1, uv.w - rect.x);
      if (aspectLocked) changed.h = clamp(Math.round(changed.w * rect.h / Math.max(1, rect.w)), 1, uv.h - rect.y);
    }
    if (field === 'h') {
      changed.h = clamp(value, 1, uv.h - rect.y);
      if (aspectLocked) changed.w = clamp(Math.round(changed.h * rect.w / Math.max(1, rect.h)), 1, uv.w - rect.x);
    }
    replaceSelected(changed, `set UV ${field.toUpperCase()} to ${value}`);
  };

  const atlasW = uv.w * view.scale;
  const atlasH = uv.h * view.scale;
  const host = globalThis as any;

  return (
    <Box style={{ flexGrow: 1, minHeight: 0, gap: 6 }}>
      <Row style={{ height: 27, alignItems: 'center', gap: 5 }}>
        {toolButton('MousePointer2', tool === 'select', 'Select and transform UV islands', () => setTool('select'))}
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
          const corner = hitHandle(screen);
          if (corner && selectedRect) {
            gestureRef.current = { kind: 'resize', index: selected, corner, start: atlasPoint(screen), seed: selectedRect };
            return;
          }
          const point = atlasPoint(screen);
          const index = hitUvIsland(rectsRef.current, point.x, point.y);
          setSelected(index);
          if (index >= 0) {
            bridge.selectUvIsland(index, Boolean(event?.shiftKey));
            gestureRef.current = { kind: 'move', index, start: point, seed: rectsRef.current[index]! };
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
          const dx = point.x - gesture.start.x;
          const dy = point.y - gesture.start.y;
          const changed = gesture.kind === 'resize'
            ? resizeUvIslandFromCorner(gesture.seed, gesture.corner, dx, dy, uv.w, uv.h)
            : moveUvIsland(gesture.seed, dx, dy, uv.w, uv.h);
          setRects((current) => {
            const next = current.map((rect, index) => index === gesture.index ? changed : rect);
            rectsRef.current = next;
            return next;
          });
        }}
        onMouseUp={() => {
          const gesture = gestureRef.current;
          gestureRef.current = null;
          if (gesture?.kind === 'move') commit(rectsRef.current, 'moved UV face over the fixed texture');
          if (gesture?.kind === 'resize') commit(rectsRef.current, 'resized UV face over the fixed texture');
        }}
        onMouseLeave={() => {
          const gesture = gestureRef.current;
          gestureRef.current = null;
          if (gesture?.kind === 'move') commit(rectsRef.current, 'moved UV face over the fixed texture');
          if (gesture?.kind === 'resize') commit(rectsRef.current, 'resized UV face over the fixed texture');
        }}
        style={{ flexGrow: 1, minHeight: 300, position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: accentFor('border'), backgroundColor: '#0d1016' }}
      >
        <Graph style={{ position: 'absolute', left: 0, top: 0, width: surfaceSize.width, height: surfaceSize.height, pointerEvents: 'none' }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
          <Graph.Path d={checkerPath(surfaceSize.width, surfaceSize.height)} fill="#121720" stroke="none" />
        </Graph>
        <Effect shader={ATLAS_SHADER} textures={[texture.id]} style={{ position: 'absolute', left: view.x, top: view.y, width: atlasW, height: atlasH }} />
        <Box style={{ position: 'absolute', left: view.x, top: view.y, width: atlasW, height: atlasH, borderWidth: 1, borderColor: '#354052', pointerEvents: 'none' }} />
        <Graph style={{ position: 'absolute', left: 0, top: 0, width: surfaceSize.width, height: surfaceSize.height, pointerEvents: 'none' }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
          <Graph.Path d={rectScreenPath(rects)} fill="none" stroke="#080b10" strokeWidth={3.2} />
          <Graph.Path d={rectScreenPath(rects)} fill="none" stroke="#c7d0df" strokeWidth={1.15} />
          {active.length ? <Graph.Path d={rectScreenPath(active)} fill="none" stroke="#42d9e8" strokeWidth={1.65} /> : null}
          {selectedRect ? <Graph.Path d={rectScreenPath([selectedRect])} fill="#f4d35e2b" stroke="#ffffff" strokeWidth={2.2} /> : null}
        </Graph>
        {handlePoints.map((handle) => (
          <Box key={handle.corner} style={{ position: 'absolute', left: handle.x - 4, top: handle.y - 4, width: 9, height: 9, borderRadius: 5, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#11151d', pointerEvents: 'none' }} />
        ))}
      </Pressable>

      <Row style={{ alignItems: 'center', gap: 4 }}>
        <UvNumberField label="X" value={selectedRect?.x ?? null} min={0} max={selectedRect ? uv.w - selectedRect.w : uv.w} onCommit={(value) => changeCoordinate('x', value)} />
        <UvNumberField label="Y" value={selectedRect?.y ?? null} min={0} max={selectedRect ? uv.h - selectedRect.h : uv.h} onCommit={(value) => changeCoordinate('y', value)} />
        <UvNumberField label="W" value={selectedRect?.w ?? null} min={1} max={selectedRect ? uv.w - selectedRect.x : uv.w} onCommit={(value) => changeCoordinate('w', value)} />
        <UvNumberField label="H" value={selectedRect?.h ?? null} min={1} max={selectedRect ? uv.h - selectedRect.y : uv.h} onCommit={(value) => changeCoordinate('h', value)} />
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
          <Pressable tooltip="Reload atlases/base.png after editing it externally" onPress={() => setNote(bridge.reloadUvAtlas())} style={{ width: 25, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}>
            <Icon name="RefreshCw" size={11} color={accentFor('textDim')} />
          </Pressable>
          {uv.diskPath ? (
            <Pressable tooltip="Copy the editable PNG path" onPress={() => { host.__clipboard_set?.(uv.diskPath); setNote('copied base.png path'); }} style={{ width: 25, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('border') }}>
              <Icon name="Copy" size={11} color={accentFor('textDim')} />
            </Pressable>
          ) : null}
        </Row>
        <Box style={{ height: 47, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 7, backgroundColor: accentFor('segActiveBg'), borderWidth: 1, borderColor: accentFor('primary') }}>
          <Box style={{ width: 32, height: 32, position: 'relative', overflow: 'hidden', backgroundColor: '#11151d', borderWidth: 1, borderColor: accentFor('border') }}>
            <Effect shader={ATLAS_SHADER} textures={[texture.id]} style={{ position: 'absolute', left: 0, top: 0, width: 32, height: 32 }} />
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
