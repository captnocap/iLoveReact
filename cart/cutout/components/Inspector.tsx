// Inspector — right-side stack. Properties stay tabbed at the top for future
// nested property groups; Layers are pinned to the bottom.

import { useEffect, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Text, TextArea, TextInput } from '@reactjit/runtime/primitives';
import { Icon } from '@reactjit/runtime/icons/Icon';
import { onnxTest, type OnnxTestResult } from '@reactjit/runtime/hooks/useSegment';
import { COLORS, SIZES } from '../theme';
import type { CutoutState } from '../state';
import { MaskQuad, MASK_SURFACES, isBuiltinSurface, maskSurfaceLabel, NUM_COLOR_SLOTS, SLOT_DEFAULTS, SLOT_LABELS, type SurfaceId } from './MaskQuad';

// Quick-pick palette mirrored from cart/cutout/components/Tools.tsx so the
// Parameters block's swatches stay in sync with the left rail. Kept here as
// a local const because pulling it out into a shared module would touch
// every other cart that has its own swatch row.
const PARAM_PALETTE = [
  '#ffffff', '#111827',
  '#ff4040', '#ff9f43',
  '#ffdd55', '#34d399',
  '#3da9ff', '#7c5cff',
  '#ff70cc', '#8b5a2b',
];

type PropTab = 'tool' | 'surface' | 'source';
type Rect = { x: number; y: number; width: number; height: number };

const TABS: { id: PropTab; label: string }[] = [
  { id: 'tool', label: 'Tool' },
  { id: 'surface', label: 'FX' },
  { id: 'source', label: 'Source' },
];

const PREVIEW_GRID = 18;
const PREVIEW_CELLS = (() => {
  const cells = new Set<number>();
  for (let y = 0; y < PREVIEW_GRID; y++) {
    for (let x = 0; x < PREVIEW_GRID; x++) {
      cells.add(y * PREVIEW_GRID + x);
    }
  }
  return cells;
})();

const CUSTOM_EFFECT_TEMPLATE = `@group(0) @binding(1) var<storage, read> data: array<f32>;

fn maskAt(uv: vec2f) -> f32 {
  let gw = data[0];
  let gh = data[1];
  let igw = u32(gw);
  let igh = u32(gh);
  let xi = u32(floor(uv.x * gw));
  let yi = u32(floor(uv.y * gh));
  let cx = min(xi, igw - 1u);
  let cy = min(yi, igh - 1u);
  return data[8u + cy * igw + cx];
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let m = maskAt(in.uv);
  if (m < 0.5) { return vec4f(0.0); }

  let p = in.uv * 2.0 - vec2f(1.0);
  let r = length(p);
  let bands = 0.5 + 0.5 * sin(r * 24.0 - U.time * 3.0);
  let hue = fract(0.58 + bands * 0.18 + U.time * 0.04);
  let color = hsv2rgb(hue, 0.85, 1.0);
  return vec4f(color, data[2]);
}`;

export type EffectDraft = { selectedLayer: number | null; apply: (id: SurfaceId) => void };

export function Inspector({
  s,
  onOpenEffectModal,
}: {
  s: CutoutState;
  onOpenEffectModal: (draft: EffectDraft) => void;
}) {
  const [tab, setTab] = useState<PropTab>('tool');
  const [onnxStatus, setOnnxStatus] = useState<OnnxTestResult | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [layersHeight, setLayersHeight] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedLayer, setSelectedLayerLocal] = useState<number | null>(null);
  const resizingRef = useRef(false);
  const activeLayerIndex = selectedLayer !== null && selectedLayer >= 0 && selectedLayer < s.layers.length
    ? selectedLayer
    : null;
  const layerTarget = selectedLayer === -1 && s.hasBrushLayer ? -1 : activeLayerIndex;
  // Push selection into CutoutState so the brush's paint target tracks
  // the Inspector pick. null = no layer focused (paint goes to global
  // brush layer, -1); -1 = explicitly the paint layer; >=0 = paint INTO
  // smart layer i.
  const setSelectedLayer = (next: number | null) => {
    setSelectedLayerLocal(next);
    s.setActiveLayer(next == null ? -1 : next);
  };
  const runOnnxTest = () => setOnnxStatus(onnxTest());
  const resizeLayers = (screenY: number) => {
    if (!rect) return;
    const raw = rect.y + rect.height - screenY;
    const max = Math.max(180, rect.height - 150);
    const next = Math.max(170, Math.min(max, raw));
    setLayersHeight(Math.round(next));
  };

  return (
    <Col style={{
      width: SIZES.inspector,
      backgroundColor: COLORS.panel,
      borderLeftWidth: 1,
      borderColor: COLORS.border,
      minHeight: 0,
      position: 'relative',
    }} onLayout={(r: any) => setRect(r)}>
      <Col style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden' }}>
        <PanelHeader title="Properties" />
        <Row style={{
          paddingHorizontal: 10,
          paddingBottom: 8,
          gap: 4,
          borderBottomWidth: 1,
          borderColor: COLORS.border,
          minWidth: 0,
        }}>
          {TABS.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}
            >
              <Box style={{
                width: '100%',
                height: 28,
                borderRadius: 2,
                backgroundColor: tab === t.id ? COLORS.accent : COLORS.bgSoft,
                borderWidth: 1,
                borderColor: tab === t.id ? COLORS.accent : COLORS.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Text style={{
                  color: tab === t.id ? '#0b1018' : COLORS.inkDim,
                  fontSize: 10,
                  fontWeight: '800',
                }} numberOfLines={1}>
                  {t.label}
                </Text>
              </Box>
            </Pressable>
          ))}
        </Row>

        <Col style={{ padding: 10, gap: 10, minHeight: 0 }}>
          {tab === 'tool' ? <ToolProperties s={s} /> : null}
          {tab === 'surface' ? (
            <SurfaceProperties
              s={s}
              selectedLayer={layerTarget}
              setSelectedLayer={setSelectedLayer}
              onOpenEffectModal={onOpenEffectModal}
            />
          ) : null}
          {tab === 'source' ? <SourceProperties s={s} /> : null}
        </Col>
      </Col>

      <ResizeHandle
        onBegin={(y) => { resizingRef.current = true; setIsResizing(true); resizeLayers(y); }}
        onMove={(y) => { if (resizingRef.current) resizeLayers(y); }}
        onEnd={() => { resizingRef.current = false; setIsResizing(false); }}
      />
      <LayersPanel
        s={s}
        height={layersHeight}
        selectedLayer={layerTarget}
        setSelectedLayer={setSelectedLayer}
      />
      {isResizing ? (
        <Pressable
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 50,
            backgroundColor: '#00000001',
          }}
          onMouseMove={(p: any) => resizeLayers(p.y)}
          onMouseUp={() => { resizingRef.current = false; setIsResizing(false); }}
          tooltip="Release to set panel split"
        />
      ) : null}
    </Col>
  );
}

function ToolProperties({ s }: { s: CutoutState }) {
  return (
    <>
      {/* Title reflects WHAT YOU'RE WORKING ON, not "is there a srcPath".
         A blank canvas has no srcPath but a real working surface; a smart
         layer in focus has its own state to report; only a totally empty
         cart with no canvas at all gets "No Source". */}
      <PropertyBlock title={!s.srcDims ? 'No Source' : 'Mask State'}>
        <Text style={{ color: COLORS.inkDim, fontSize: 11 }}>{currentHelp(s)}</Text>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Pill label={s.hasMaskEdits ? 'edited' : 'empty'} active={s.hasMaskEdits} color={s.hasMaskEdits ? COLORS.good : COLORS.panelHi} />
          {s.smartBusy ? <Pill label="refining" active color={COLORS.warn} /> : null}
        </Row>
      </PropertyBlock>

      <PropertyBlock title="Selection">
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Metric label="backend" value={s.backendName} />
          <Metric label="clicks" value={String(s.clicks.length)} />
          <Metric label="layers" value={String(s.layers.length + (s.hasBrushLayer ? 1 : 0))} />
          <Box style={{ flexGrow: 1 }} />
          {s.clicks.length > 0 ? <TinyButton label="Clear" onPress={s.clearClicks} /> : null}
        </Row>
        <BackendPicker s={s} />
        <BackendTunables s={s} />
      </PropertyBlock>
    </>
  );
}

// Backend toggle — two pills, flood vs sam. SAM is greyed out when the
// cart was built without -Dhas-onnx=true (samAvailable === false); clicking
// it in that state does nothing.
function BackendPicker({ s }: { s: CutoutState }) {
  const tiles: { id: 'flood' | 'sam'; label: string; help: string }[] = [
    { id: 'flood', label: 'Flood', help: 'magick floodfill · wand tool · always works' },
    { id: 'sam', label: 'SAM', help: 'MobileSAM via ONNX · photo-quality edges' },
  ];
  return (
    <Col style={{ gap: 5 }}>
      <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>BACKEND</Text>
      <Row style={{ gap: 6 }}>
        {tiles.map((t) => {
          const disabled = t.id === 'sam' && !s.samAvailable;
          const active = s.backend === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => { if (!disabled) s.setBackend(t.id); }}
              tooltip={disabled ? `${t.help} (build with -Dhas-onnx=true)` : t.help}
              style={{ flexGrow: 1, flexBasis: 0 }}
            >
              <Box style={{
                height: 26,
                borderRadius: 5,
                backgroundColor: active ? COLORS.accent : COLORS.bgSoft,
                borderWidth: 1,
                borderColor: active ? COLORS.accent : COLORS.border,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: disabled ? 0.4 : 1,
              }}>
                <Text style={{
                  color: active ? '#0b1018' : COLORS.inkDim,
                  fontSize: 10,
                  fontWeight: '800',
                }}>
                  {t.label}
                </Text>
              </Box>
            </Pressable>
          );
        })}
      </Row>
    </Col>
  );
}

// Tunables for the currently active backend. Sliders re-run the refine
// (debounced 250 ms in state.ts) whenever they change — so dragging a
// slider live-updates the mask.
function BackendTunables({ s }: { s: CutoutState }) {
  if (s.backend === 'flood') {
    return (
      <Col style={{ gap: 6 }}>
        <ParamSlider
          label="Fuzz %"
          value={s.floodFuzz}
          min={0}
          max={60}
          display={`${Math.round(s.floodFuzz)}%`}
          onChange={(v) => s.setFloodFuzz(Math.round(v))}
        />
        <ParamSlider
          label="Reject radius"
          value={s.floodRejectFrac}
          min={0.005}
          max={0.20}
          display={`${(s.floodRejectFrac * 100).toFixed(1)}%`}
          onChange={(v) => s.setFloodRejectFrac(v)}
        />
      </Col>
    );
  }
  // SAM
  return (
    <Col style={{ gap: 6 }}>
      <ParamSlider
        label="Threshold"
        value={s.samThreshold}
        min={-4}
        max={4}
        display={s.samThreshold.toFixed(2)}
        onChange={(v) => s.setSamThreshold(v)}
      />
      <Col style={{ gap: 4 }}>
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>
            MASK CANDIDATE
          </Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: COLORS.ink, fontSize: 10, fontWeight: '800' }}>
            {(['whole', 'part', 'subpart'] as const)[s.samMaskIdx] ?? 'whole'}
          </Text>
        </Row>
        <Row style={{ gap: 4 }}>
          {([0, 1, 2] as const).map((i) => {
            const label = (['Whole', 'Part', 'Subpart'] as const)[i];
            const active = s.samMaskIdx === i;
            return (
              <Pressable
                key={i}
                onPress={() => s.setSamMaskIdx(i)}
                tooltip={`SAM mask candidate ${i} · ${label.toLowerCase()}`}
                style={{ flexGrow: 1, flexBasis: 0 }}
              >
                <Box style={{
                  height: 22,
                  borderRadius: 4,
                  backgroundColor: active ? COLORS.accent : COLORS.bgSoft,
                  borderWidth: 1,
                  borderColor: active ? COLORS.accent : COLORS.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Text style={{
                    color: active ? '#0b1018' : COLORS.inkDim,
                    fontSize: 9,
                    fontWeight: '800',
                  }}>
                    {label}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </Row>
      </Col>
    </Col>
  );
}

function SurfaceProperties({
  s,
  selectedLayer,
  setSelectedLayer,
  onOpenEffectModal,
}: {
  s: CutoutState;
  selectedLayer: number | null;
  setSelectedLayer: (index: number | null) => void;
  onOpenEffectModal: (draft: EffectDraft) => void;
}) {
  const layerCfg = selectedLayer !== null ? s.layerConfigs[selectedLayer] : null;
  const activeMode = layerCfg ? layerCfg.mode : s.effectMode;
  const targetLabel = selectedLayer === -1 ? 'Paint layer' : layerCfg ? `Layer ${selectedLayer! + 1}` : 'Global preview';
  const selectSurface = (id: SurfaceId) => {
    if (selectedLayer === null || selectedLayer === -1) s.setEffectMode(id);
    else s.setLayerMode(selectedLayer, id);
  };
  return (
    <>
      <PropertyBlock title="WGSL Overlay Surface">
        <Text style={{ color: COLORS.inkDim, fontSize: 11 }}>
          Visual mask preview only. Saved PNG and icon JSON use the mask, not this shader surface.
        </Text>
        <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Metric label="target" value={targetLabel} />
          <Box style={{ flexGrow: 1 }} />
          <TinyButton label="Global" active={selectedLayer === null} onPress={() => setSelectedLayer(null)} />
          {s.hasBrushLayer ? (
            <TinyButton label="Paint" active={selectedLayer === -1} onPress={() => setSelectedLayer(-1)} />
          ) : null}
          {s.layers.map((_, i) => (
            <TinyButton
              key={i}
              label={`${i + 1}`}
              active={selectedLayer === i}
              onPress={() => setSelectedLayer(i)}
            />
          ))}
        </Row>
      </PropertyBlock>
      <Row style={{ gap: 7, flexWrap: 'wrap' }}>
        {MASK_SURFACES.map((m) => (
          <SurfaceCard
            key={m}
            mode={m}
            label={surfaceLabel(s, m)}
            active={activeMode === m}
            onPress={() => selectSurface(m)}
          />
        ))}
        {s.customSurfaces.map((fx) => (
          <SurfaceCard
            key={fx.id}
            mode={fx.id}
            label={fx.label}
            shader={fx.shader}
            active={activeMode === fx.id}
            onPress={() => selectSurface(fx.id)}
          />
        ))}
        <AddSurfaceCard
          onPress={() => onOpenEffectModal({
            selectedLayer,
            apply: selectSurface,
          })}
        />
      </Row>
      <ParametersBlock s={s} selectedLayer={selectedLayer} />
    </>
  );
}

// ParametersBlock — exposes every adjustable surface property for the
// currently-targeted layer (or the global default when no layer is picked).
// Color slots scale with NUM_COLOR_SLOTS so future schema growth surfaces
// automatically. Slider rows reuse the same `setLayerXxx(-1, …)` →
// `setEffectXxx` routing, so editing "Global preview" updates the same
// state Tools' palette writes to.
function ParametersBlock({
  s,
  selectedLayer,
}: {
  s: CutoutState;
  selectedLayer: number | null;
}) {
  // Resolve the active source for parameter values + setters.
  // `selectedLayer === null` → global preview (effect* state on s).
  // `selectedLayer === -1`   → brush/paint layer; also routes to effect*.
  // `selectedLayer >= 0`     → smart-layer i; pulls from s.layerConfigs[i].
  const isGlobal = selectedLayer === null || selectedLayer === -1;
  const layerCfg = !isGlobal ? s.layerConfigs[selectedLayer!] : null;
  const target: number = isGlobal ? -1 : selectedLayer!;
  const colors = (isGlobal ? s.effectColors : layerCfg?.colors) ?? SLOT_DEFAULTS;
  const hueOffset = isGlobal ? s.effectHueOffset : (layerCfg?.hueOffset ?? 0);
  const phaseOffset = isGlobal ? s.effectPhaseOffset : (layerCfg?.phaseOffset ?? 0);
  const dim = isGlobal ? s.effectDim : (layerCfg?.dim ?? 0.85);
  const muted = layerCfg?.muted ?? false;
  const [activeSlot, setActiveSlot] = useState(0);
  const safeSlot = Math.min(Math.max(activeSlot, 0), NUM_COLOR_SLOTS - 1);

  return (
    <PropertyBlock title="Parameters">
      <Text style={{ color: COLORS.inkDim, fontSize: 10 }}>
        Every adjustable property for {isGlobal ? 'the global preview' : `layer ${selectedLayer! + 1}`}.
      </Text>
      <Col style={{ gap: 8 }}>
        <Col style={{ gap: 5 }}>
          <Row style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '800' }}>COLOR SLOTS</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text style={{ color: COLORS.inkDim, fontSize: 9 }}>{NUM_COLOR_SLOTS} slot{NUM_COLOR_SLOTS === 1 ? '' : 's'}</Text>
          </Row>
          <Row style={{ gap: 5, flexWrap: 'wrap' }}>
            {Array.from({ length: NUM_COLOR_SLOTS }, (_, i) => i).map((i) => (
              <SlotChip
                key={i}
                label={SLOT_LABELS[i] ?? `Slot ${i + 1}`}
                color={colors[i] ?? '#ffffff'}
                active={safeSlot === i}
                onPress={() => setActiveSlot(i)}
              />
            ))}
          </Row>
          <Row style={{ gap: 4, flexWrap: 'wrap' }}>
            {PARAM_PALETTE.map((color) => (
              <ParamSwatch
                key={color}
                color={color}
                active={colors[safeSlot] === color}
                onPress={() => s.setLayerColor(target, safeSlot, color)}
              />
            ))}
          </Row>
        </Col>

        <ParamSlider
          label="Hue offset"
          value={hueOffset}
          min={0}
          max={1}
          display={`${Math.round(hueOffset * 360)}°`}
          onChange={(v) => s.setLayerHueOffset(target, v)}
        />
        <ParamSlider
          label="Phase"
          value={phaseOffset}
          min={0}
          max={6.28318}
          display={phaseOffset.toFixed(2)}
          onChange={(v) => s.setLayerPhaseOffset(target, v)}
        />
        <ParamSlider
          label="Dim"
          value={dim}
          min={0}
          max={1}
          display={`${Math.round(dim * 100)}%`}
          onChange={(v) => s.setLayerDim(target, v)}
        />

        {!isGlobal ? (
          <Row style={{ gap: 6, alignItems: 'center' }}>
            <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '800' }}>VISIBILITY</Text>
            <Box style={{ flexGrow: 1 }} />
            <TinyButton
              label={muted ? 'Show' : 'Hide'}
              active={muted}
              onPress={() => s.toggleLayerMute(selectedLayer!)}
            />
          </Row>
        ) : null}
      </Col>
    </PropertyBlock>
  );
}

function SlotChip({
  label,
  color,
  active,
  onPress,
}: {
  label: string;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} tooltip={`${label} (${color})`}>
      <Row style={{
        paddingHorizontal: 7,
        paddingVertical: 5,
        borderRadius: 5,
        backgroundColor: active ? COLORS.panelHi : COLORS.bgSoft,
        borderWidth: 1,
        borderColor: active ? COLORS.accent : COLORS.border,
        alignItems: 'center',
        gap: 6,
      }}>
        <Box style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          backgroundColor: color,
          borderWidth: 1,
          borderColor: color === '#ffffff' ? COLORS.borderStrong : color,
        }} />
        <Text style={{
          color: active ? COLORS.ink : COLORS.inkDim,
          fontSize: 10,
          fontWeight: '800',
        }}>
          {label}
        </Text>
      </Row>
    </Pressable>
  );
}

function ParamSwatch({ color, active, onPress }: { color: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} tooltip={color}>
      <Box style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        backgroundColor: color,
        borderWidth: active ? 2 : 1,
        borderColor: active ? COLORS.accent : (color === '#ffffff' ? COLORS.borderStrong : COLORS.border),
      }} />
    </Pressable>
  );
}

function ParamSlider({
  label,
  value,
  min,
  max,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  display: string;
  onChange: (v: number) => void;
}) {
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const range = max - min;
  const pct = range <= 0 ? 0 : Math.max(0, Math.min(1, (value - min) / range));
  const updateFromX = (sx: number) => {
    if (!rect || rect.width <= 0) return;
    const raw = (sx - rect.x) / rect.width;
    const clamped = Math.max(0, Math.min(1, raw));
    onChange(min + clamped * range);
  };
  return (
    <Col style={{ gap: 4 }}>
      <Row style={{ alignItems: 'center', gap: 6 }}>
        <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>
          {label.toUpperCase()}
        </Text>
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: COLORS.ink, fontSize: 10, fontWeight: '800' }}>{display}</Text>
      </Row>
      <Pressable
        tooltip={`${label}: ${display}`}
        onMouseDown={(p: any) => { setDragging(true); updateFromX(p.x); }}
        onMouseMove={(p: any) => { if (dragging) updateFromX(p.x); }}
        onMouseUp={() => setDragging(false)}
      >
        <Box
          onLayout={(r: any) => setRect(r)}
          style={{
            height: 22,
            borderRadius: 5,
            backgroundColor: COLORS.bgSoft,
            borderWidth: 1,
            borderColor: COLORS.border,
            position: 'relative',
            justifyContent: 'center',
          }}
        >
          <Box style={{
            position: 'absolute',
            left: 6,
            right: 6,
            top: 10,
            height: 2,
            borderRadius: 1,
            backgroundColor: COLORS.borderStrong,
          }} />
          <Box style={{
            position: 'absolute',
            left: 6,
            top: 10,
            width: Math.max(2, Math.round((rect ? rect.width - 12 : 100) * pct)),
            height: 2,
            borderRadius: 1,
            backgroundColor: COLORS.accent,
          }} />
          <Box style={{
            position: 'absolute',
            left: 2 + Math.round((rect ? rect.width - 16 : 100) * pct),
            top: 4,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: COLORS.accent,
            borderWidth: 2,
            borderColor: COLORS.ink,
          }} />
        </Box>
      </Pressable>
    </Col>
  );
}

function SourceProperties({ s }: { s: CutoutState }) {
  return (
    <>
      <PropertyBlock title="Source">
        {s.srcPath ? (
          <Col style={{ gap: 5 }}>
            {/* PATH instead of stem — stem is shown in the tab label up
               top, no point repeating it. The disk path is what's
               actually useful to know here ("which file am I editing"). */}
            <Text style={{ color: COLORS.inkDim, fontSize: 10 }} numberOfLines={3}>
              {s.srcPath}
            </Text>
            <Text style={{ color: COLORS.ink, fontSize: 11, fontWeight: '700' }}>
              {s.srcDims ? `${s.srcDims.w} × ${s.srcDims.h}` : 'loading…'}
            </Text>
          </Col>
        ) : s.isBlank ? (
          <Text style={{ color: COLORS.inkDim, fontSize: 11 }}>Blank canvas. No source image.</Text>
        ) : (
          <Text style={{ color: COLORS.inkDim, fontSize: 11 }}>No image loaded.</Text>
        )}
      </PropertyBlock>

      {s.srcDims ? (
        <PropertyBlock title="Canvas Size">
          <CanvasSizeEditor s={s} />
        </PropertyBlock>
      ) : null}

      {s.savedPath ? (
        <PropertyBlock title="Last Saved">
          <Col style={{ gap: 3 }}>
            {s.savedPath.split('\n').map((p, i) => (
              <Text key={i} style={{ color: COLORS.good, fontSize: 10 }} numberOfLines={1}>
                {p}
              </Text>
            ))}
          </Col>
        </PropertyBlock>
      ) : null}
    </>
  );
}

// Canvas-size editor. Single home for editing srcDims — read-only mirror
// lives in the bottom StatusBar so each control has one place. Submits
// on Enter so the apply step is explicit (no risk of mid-edit resizes
// while the user is partway through typing a number).
function CanvasSizeEditor({ s }: { s: CutoutState }) {
  const [w, setW] = useState(String(s.srcDims?.w || 512));
  const [h, setH] = useState(String(s.srcDims?.h || 512));
  useEffect(() => {
    if (!s.srcDims) return;
    setW(String(s.srcDims.w));
    setH(String(s.srcDims.h));
  }, [s.srcDims?.w, s.srcDims?.h]);

  const apply = () => {
    const nw = Number(w);
    const nh = Number(h);
    if (!Number.isFinite(nw) || !Number.isFinite(nh)) return;
    s.setCanvasSize(nw, nh);
  };

  return (
    <Row style={{ gap: 6, alignItems: 'center' }}>
      <CanvasSizeInput value={w} onChange={setW} onSubmit={apply} />
      <Text style={{ color: COLORS.inkMuted, fontSize: 11 }}>×</Text>
      <CanvasSizeInput value={h} onChange={setH} onSubmit={apply} />
      <Box style={{ flexGrow: 1 }} />
      <Text style={{ color: COLORS.inkDim, fontSize: 9 }}>↵ to apply</Text>
    </Row>
  );
}

function CanvasSizeInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      onSubmit={onSubmit}
      onSubmitEditing={onSubmit}
      style={{
        width: 64,
        height: 26,
        paddingHorizontal: 8,
        borderRadius: 4,
        backgroundColor: COLORS.bgSoft,
        borderWidth: 1,
        borderColor: COLORS.border,
        color: COLORS.ink,
        fontSize: 11,
      }}
    />
  );
}

function AdvancedProperties({
  s,
  onnxStatus,
  runOnnxTest,
}: {
  s: CutoutState;
  onnxStatus: OnnxTestResult | null;
  runOnnxTest: () => void;
}) {
  return (
    <>
      <PropertyBlock title="Diagnostics">
        <Row style={{ gap: 7, alignItems: 'center' }}>
          <TinyButton label="Test runtime" onPress={runOnnxTest} />
          {onnxStatus ? (
            <Text style={{ color: onnxStatus.ok ? COLORS.good : COLORS.bad, fontSize: 10, fontWeight: '800' }}>
              {onnxStatus.ok ? `v${onnxStatus.version}` : 'fail'}
            </Text>
          ) : null}
        </Row>
        {onnxStatus && !onnxStatus.ok ? (
          <Text style={{ color: COLORS.inkDim, fontSize: 10 }} numberOfLines={3}>{onnxStatus.error}</Text>
        ) : null}
      </PropertyBlock>
      <PropertyBlock title="Stats">
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <Metric label="mask" value={s.hasMaskEdits ? 'edited' : 'empty'} />
          <Metric label="layers" value={String(s.layers.length + (s.hasBrushLayer ? 1 : 0))} />
          <Metric label="surface" value={surfaceLabel(s, s.effectMode)} />
        </Row>
      </PropertyBlock>
    </>
  );
}

function ResizeHandle({
  onBegin,
  onMove,
  onEnd,
}: {
  onBegin: (y: number) => void;
  onMove: (y: number) => void;
  onEnd: () => void;
}) {
  return (
    <Pressable
      onMouseDown={(p: any) => onBegin(p.y)}
      onMouseMove={(p: any) => onMove(p.y)}
      onMouseUp={onEnd}
      tooltip="Drag to resize layers"
    >
      <Box style={{
        height: 12,
        backgroundColor: COLORS.panel,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Box style={{ width: 56, height: 2, borderRadius: 1, backgroundColor: COLORS.borderStrong }} />
      </Box>
    </Pressable>
  );
}

function LayersPanel({
  s,
  height,
  selectedLayer,
  setSelectedLayer,
}: {
  s: CutoutState;
  height: number;
  selectedLayer: number | null;
  setSelectedLayer: (index: number | null) => void;
}) {
  const layerCount = s.compositionLayers.length;
  const actionTarget = selectedLayer ?? (s.hasBrushLayer ? -1 : 0);
  return (
    <Col style={{
      height,
      backgroundColor: COLORS.bgSoft,
      minHeight: 0,
    }}>
      <PanelHeader title={`Layers ${layerCount ? `(${layerCount})` : ''}`} compact />
      <Col style={{ paddingHorizontal: 10, paddingBottom: 8, gap: 6, minHeight: 0, flexGrow: 1, flexBasis: 0 }}>
        {!s.hasBrushLayer && s.layers.length === 0 ? (
          <Col style={{
            height: 64,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.panel,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
          }}>
            <Text style={{ color: COLORS.inkDim, fontSize: 11, fontWeight: '800' }}>No layers</Text>
            <Text style={{ color: COLORS.inkMuted, fontSize: 10 }}>Add paint or smart-select a region.</Text>
          </Col>
        ) : null}
        {s.hasBrushLayer ? (
          <PaintLayerRow
            s={s}
            selected={selectedLayer === -1}
            setSelectedLayer={setSelectedLayer}
          />
        ) : null}
        {s.layers.map((_, i) => {
          const cfg = s.layerConfigs[i];
          if (!cfg) return null;
          return (
            <LayerRow
              key={i}
              index={i}
              cfg={cfg}
              s={s}
              selected={selectedLayer === i}
              setSelectedLayer={setSelectedLayer}
            />
          );
        })}
      </Col>
      <LayerActionBar
        canTarget={layerCount > 0}
        onAdd={() => { setSelectedLayer(s.addPaintLayer()); }}
        onDuplicate={() => { if (layerCount > 0) s.duplicateLayer(actionTarget); }}
        onMoveUp={() => { if (actionTarget !== null) s.moveLayer(actionTarget, -1); }}
        onMoveDown={() => { if (actionTarget !== null) s.moveLayer(actionTarget, 1); }}
        onMerge={() => { if (actionTarget !== null) { s.mergeLayer(actionTarget); setSelectedLayer(-1); } }}
        onDelete={() => { if (actionTarget !== null) { s.deleteCompositionLayer(actionTarget); setSelectedLayer(null); } }}
      />
    </Col>
  );
}

function LayerActionBar({
  canTarget,
  onAdd,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onMerge,
  onDelete,
}: {
  canTarget: boolean;
  onAdd: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  return (
    <Row style={{
      height: 30,
      paddingHorizontal: 8,
      alignItems: 'center',
      gap: 6,
      borderTopWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.panel,
    }}>
      <LayerIconButton icon="Plus" label="Add paint layer" onPress={onAdd} />
      <LayerIconButton icon="Copy" label="Duplicate layer" disabled={!canTarget} onPress={onDuplicate} />
      <LayerIconButton icon="ArrowUp" label="Move layer up" disabled={!canTarget} onPress={onMoveUp} />
      <LayerIconButton icon="ArrowDown" label="Move layer down" disabled={!canTarget} onPress={onMoveDown} />
      <LayerIconButton icon="Merge" label="Merge layer" disabled={!canTarget} onPress={onMerge} />
      <Box style={{ flexGrow: 1 }} />
      <LayerIconButton icon="Trash2" label="Delete layer" disabled={!canTarget} danger onPress={onDelete} />
    </Row>
  );
}

function LayerIconButton({
  icon,
  label,
  disabled = false,
  danger = false,
  onPress,
}: {
  icon: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={() => { if (!disabled) onPress(); }} tooltip={label}>
      <Box style={{
        width: 24,
        height: 22,
        borderRadius: 4,
        backgroundColor: disabled ? COLORS.bgSoft : danger ? '#301822' : COLORS.panelAlt,
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.45 : 1,
      }}>
        <Icon name={icon} size={12} color={danger ? COLORS.bad : COLORS.inkDim} strokeWidth={2} />
      </Box>
    </Pressable>
  );
}

function PaintLayerRow({
  s,
  selected,
  setSelectedLayer,
}: {
  s: CutoutState;
  selected: boolean;
  setSelectedLayer: (index: number | null) => void;
}) {
  const meta = s.compositionLayers.find((l) => l.kind === 'paint');
  const [renaming, setRenaming] = useState(false);
  return (
    <Pressable onPress={() => setSelectedLayer(-1)}>
      <Col style={{
        gap: 6,
        padding: 8,
        borderRadius: 5,
        backgroundColor: selected ? COLORS.panelHi : COLORS.panel,
        borderWidth: 1,
        borderColor: selected ? COLORS.accent : COLORS.border,
      }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <SelectionStripe active={selected} />
          <SurfacePreview mode={s.effectMode} shader={surfaceShader(s, s.effectMode)} small />
          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 2 }}>
            <LayerName
              value={meta?.name || 'Paint Layer'}
              renaming={renaming}
              onRename={() => setRenaming(true)}
              onChange={(v) => s.setCompositionLayerName(-1, v)}
            />
            <Row style={{ gap: 6, alignItems: 'center' }}>
              <Text style={{ color: COLORS.inkDim, fontSize: 10 }} numberOfLines={1}>
                {surfaceLabel(s, s.effectMode)}
              </Text>
              {meta?.groupName ? <LayerGroupTag label={meta.groupName} /> : null}
            </Row>
          </Col>
          <LayerVisibilityButton muted={false} onPress={() => {}} />
        </Row>
      </Col>
    </Pressable>
  );
}

function LayerRow({
  index,
  cfg,
  s,
  selected,
  setSelectedLayer,
}: {
  index: number;
  cfg: any;
  s: CutoutState;
  selected: boolean;
  setSelectedLayer: (index: number | null) => void;
}) {
  const meta = s.compositionLayers.find((l) => l.kind === 'smart' && l.sourceIndex === index);
  const [renaming, setRenaming] = useState(false);
  return (
    <Pressable onPress={() => setSelectedLayer(index)}>
      <Col style={{
        gap: 6,
        padding: 8,
        borderRadius: 5,
        backgroundColor: selected ? COLORS.panelHi : COLORS.panel,
        borderWidth: 1,
        borderColor: selected ? COLORS.accent : cfg.muted ? COLORS.border : COLORS.border,
        opacity: cfg.muted ? 0.55 : 1,
      }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <SelectionStripe active={selected} />
          <SurfacePreview
            mode={cfg.mode}
            shader={surfaceShader(s, cfg.mode)}
            cells={s.layers[index]}
            gridSize={s.overlayRes}
            colors={cfg.colors}
            small
          />
          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 2 }}>
            <LayerName
              value={meta?.name || `Layer ${index + 1}`}
              renaming={renaming}
              onRename={() => setRenaming(true)}
              onChange={(v) => s.setCompositionLayerName(index, v)}
            />
            <Row style={{ gap: 6, alignItems: 'center' }}>
              <Text style={{ color: COLORS.inkDim, fontSize: 10 }} numberOfLines={1}>
                {surfaceLabel(s, cfg.mode)}
              </Text>
              {meta?.groupName ? <LayerGroupTag label={meta.groupName} /> : null}
            </Row>
          </Col>
          <LayerVisibilityButton muted={cfg.muted} onPress={() => s.toggleLayerMute(index)} />
        </Row>
      </Col>
    </Pressable>
  );
}

function SelectionStripe({ active }: { active: boolean }) {
  return (
    <Box style={{
      width: 3,
      height: 34,
      borderRadius: 2,
      backgroundColor: active ? COLORS.accent : COLORS.border,
    }} />
  );
}

function LayerGroupTag({ label }: { label: string }) {
  return (
    <Box style={{
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 3,
      backgroundColor: COLORS.bgSoft,
      borderWidth: 1,
      borderColor: COLORS.border,
    }}>
      <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '800' }} numberOfLines={1}>
        {label}
      </Text>
    </Box>
  );
}

function LayerVisibilityButton({ muted, onPress }: { muted: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} tooltip={muted ? 'Show layer' : 'Hide layer'}>
      <Box style={{
        width: 24,
        height: 24,
        borderRadius: 4,
        backgroundColor: muted ? COLORS.bgSoft : COLORS.panelAlt,
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Icon name="Eye" size={12} color={muted ? COLORS.inkMuted : COLORS.inkDim} strokeWidth={2} />
      </Box>
    </Pressable>
  );
}

function LayerName({
  value,
  renaming,
  onRename,
  onChange,
}: {
  value: string;
  renaming: boolean;
  onRename: () => void;
  onChange: (v: string) => void;
}) {
  return renaming ? (
    <TextInput
      value={value}
      onChangeText={onChange}
      onSubmit={() => {}}
      onSubmitEditing={() => {}}
      style={{
        height: 18,
        paddingHorizontal: 4,
        paddingVertical: 0,
        backgroundColor: COLORS.bgSoft,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 3,
        color: COLORS.ink,
        fontSize: 11,
        fontWeight: '800',
      }}
    />
  ) : (
    <Row style={{ gap: 6, alignItems: 'center' }}>
      <Text style={{ color: COLORS.ink, fontSize: 11, fontWeight: '800', flexGrow: 1 }} numberOfLines={1}>
        {value}
      </Text>
      <Pressable onPress={onRename} tooltip="Rename layer">
        <Box style={{
          width: 18,
          height: 18,
          borderRadius: 3,
          backgroundColor: COLORS.bgSoft,
          borderWidth: 1,
          borderColor: COLORS.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Icon name="Settings" size={10} color={COLORS.inkMuted} strokeWidth={2} />
        </Box>
      </Pressable>
    </Row>
  );
}

function SurfaceCard({
  mode,
  label,
  shader,
  active,
  onPress,
}: {
  mode: SurfaceId;
  label: string;
  shader?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Col style={{
        width: 82,
        gap: 5,
        padding: 6,
        borderRadius: 6,
        backgroundColor: active ? COLORS.panelHi : COLORS.bgSoft,
        borderWidth: 1,
        borderColor: active ? COLORS.accent : COLORS.border,
      }}>
        <SurfacePreview mode={mode} shader={shader} />
        <Text style={{ color: active ? COLORS.ink : COLORS.inkDim, fontSize: 10, fontWeight: '800' }} numberOfLines={1}>
          {label}
        </Text>
      </Col>
    </Pressable>
  );
}

function AddSurfaceCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Col style={{
        width: 82,
        height: 63,
        gap: 5,
        padding: 6,
        borderRadius: 6,
        backgroundColor: COLORS.bgSoft,
        borderWidth: 1,
        borderColor: COLORS.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Text style={{ color: COLORS.accent, fontSize: 22, lineHeight: 24, fontWeight: '900' }}>+</Text>
        <Text style={{ color: COLORS.inkDim, fontSize: 10, fontWeight: '800' }}>New FX</Text>
      </Col>
    </Pressable>
  );
}

function SurfacePreview({
  mode,
  shader,
  small = false,
  cells,
  gridSize,
  colors,
}: {
  mode: SurfaceId;
  shader?: string;
  small?: boolean;
  /** Override the fully-filled preview grid with a layer's actual mask
   *  cells. Used by LayerRow so each row shows the LAYER'S silhouette
   *  instead of a generic FX swatch — the user can see which layer is
   *  which at a glance. Falls back to PREVIEW_CELLS for the surface
   *  picker / FX gallery where the geometry isn't meaningful. */
  cells?: Set<number>;
  gridSize?: number;
  colors?: string[];
}) {
  const w = small ? 32 : 68;
  const h = small ? 22 : 34;
  const previewCells = cells ?? PREVIEW_CELLS;
  const previewGrid = gridSize ?? PREVIEW_GRID;
  return (
    <Box style={{
      width: w,
      height: h,
      borderRadius: 5,
      backgroundColor: COLORS.panel,
      borderWidth: 1,
      borderColor: COLORS.borderStrong,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <Box style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, backgroundColor: COLORS.bg }} />
      <MaskQuad
        cells={previewCells}
        gridSize={previewGrid}
        worldW={w}
        worldH={h}
        dim={1}
        mode={mode}
        customShader={shader}
        colors={colors}
      />
    </Box>
  );
}

export function EffectModal({
  s,
  onClose,
  onAdd,
}: {
  s: CutoutState;
  onClose: () => void;
  onAdd: (label: string, shader: string) => void;
}) {
  const [label, setLabel] = useState(`Custom ${s.customSurfaces.length + 1}`);
  const [shader, setShader] = useState(CUSTOM_EFFECT_TEMPLATE);
  const [previewShader, setPreviewShader] = useState(CUSTOM_EFFECT_TEMPLATE);
  const previewStale = shader !== previewShader;
  return (
    <Box style={{
      position: 'absolute',
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      zIndex: 90,
      backgroundColor: '#050812cc',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <Col style={{
        width: 820,
        height: 560,
        borderRadius: 10,
        backgroundColor: COLORS.panel,
        borderWidth: 1,
        borderColor: COLORS.borderStrong,
        overflow: 'hidden',
      }}>
        <Row style={{
          height: 52,
          paddingHorizontal: 18,
          alignItems: 'center',
          gap: 10,
          borderBottomWidth: 1,
          borderColor: COLORS.border,
          backgroundColor: COLORS.bgSoft,
        }}>
          <Text style={{ color: COLORS.ink, fontSize: 13, fontWeight: '900' }}>New FX</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: previewStale ? COLORS.warn : COLORS.inkDim, fontSize: 10, fontWeight: '800' }}>
            {previewStale ? 'preview stale' : 'preview live'}
          </Text>
        </Row>

        <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, padding: 18, gap: 16 }}>
          <Col style={{ width: 420, gap: 12, minHeight: 0 }}>
            <Col style={{ gap: 6 }}>
              <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>NAME</Text>
              <Box style={{
                borderRadius: 6,
                borderWidth: 1,
                borderColor: COLORS.border,
                backgroundColor: COLORS.bgSoft,
                overflow: 'hidden',
              }}>
                <TextArea
                  value={label}
                  onChangeText={setLabel}
                  style={{
                    height: 36,
                    paddingHorizontal: 10,
                    paddingVertical: 9,
                    color: COLORS.ink,
                    fontSize: 12,
                  }}
                />
              </Box>
            </Col>

            <Col style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, gap: 6 }}>
              <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>SHADER (WGSL)</Text>
              <Box style={{
                flexGrow: 1,
                flexBasis: 0,
                minHeight: 0,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: COLORS.border,
                backgroundColor: COLORS.bg,
                overflow: 'hidden',
              }}>
                <TextArea
                  value={shader}
                  onChangeText={setShader}
                  fontSize={11}
                  color={COLORS.ink}
                  style={{
                    flexGrow: 1,
                    flexBasis: 0,
                    minHeight: 0,
                    padding: 12,
                    color: COLORS.ink,
                    fontFamily: 'monospace',
                  }}
                />
              </Box>
            </Col>
          </Col>

          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 6 }}>
            <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>PREVIEW</Text>
            <Box style={{
              flexGrow: 1,
              flexBasis: 0,
              minHeight: 0,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: COLORS.border,
              backgroundColor: COLORS.bg,
              overflow: 'hidden',
              position: 'relative',
            }}>
              <MaskQuad
                cells={PREVIEW_CELLS}
                gridSize={PREVIEW_GRID}
                worldW={330}
                worldH={400}
                dim={1}
                mode="custom:draft"
                customShader={previewShader}
              />
            </Box>
          </Col>
        </Row>

        <Row style={{
          height: 56,
          paddingHorizontal: 18,
          alignItems: 'center',
          gap: 10,
          borderTopWidth: 1,
          borderColor: COLORS.border,
          backgroundColor: COLORS.bgSoft,
        }}>
          <Text style={{ color: COLORS.inkMuted, fontSize: 10 }}>
            Apply preview to recompile · Add commits to FX list
          </Text>
          <Box style={{ flexGrow: 1 }} />
          <TinyButton label="Cancel" onPress={onClose} />
          <TinyButton
            label="Apply preview"
            active={previewStale}
            onPress={() => setPreviewShader(shader)}
          />
          <TinyButton label="Add" active onPress={() => onAdd(label, shader)} />
        </Row>
      </Col>
    </Box>
  );
}

function surfaceLabel(s: CutoutState, id: SurfaceId): string {
  if (isBuiltinSurface(id)) return maskSurfaceLabel(id);
  return s.customSurfaces.find((fx) => fx.id === id)?.label || 'Custom FX';
}

function surfaceShader(s: CutoutState, id: SurfaceId): string | undefined {
  if (isBuiltinSurface(id)) return undefined;
  return s.customSurfaces.find((fx) => fx.id === id)?.shader;
}

function currentHelp(s: CutoutState): string {
  if (!s.srcDims) return 'Pick an image or create a blank canvas to begin.';
  if (s.busy) return s.status;
  if (s.smartBusy) return 'Smart select is refining the mask.';
  if (s.hasMaskEdits) return 'Mask edits are ready to save or refine.';
  if (s.isBlank) return 'Blank canvas — brush or smart-select to start.';
  return 'Use the left rail to choose a tool and start editing.';
}

function PanelHeader({ title, compact = false }: { title: string; compact?: boolean }) {
  return (
    <Row style={{
      height: compact ? 34 : 38,
      paddingHorizontal: 10,
      alignItems: 'center',
      gap: 8,
    }}>
      <Text style={{ color: COLORS.ink, fontSize: 12, fontWeight: '900' }}>{title}</Text>
      <Box style={{ flexGrow: 1 }} />
    </Row>
  );
}

function PropertyBlock({ title, children }: { title: string; children: any }) {
  return (
    <Col style={{
      gap: 7,
      padding: 9,
      borderRadius: 6,
      backgroundColor: COLORS.bgSoft,
      borderWidth: 1,
      borderColor: COLORS.border,
    }}>
      <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>
        {title.toUpperCase()}
      </Text>
      {children}
    </Col>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Col style={{ gap: 1 }}>
      <Text style={{ color: COLORS.inkMuted, fontSize: 9, fontWeight: '800' }}>{label.toUpperCase()}</Text>
      <Text style={{ color: COLORS.ink, fontSize: 11, fontWeight: '800' }}>{value}</Text>
    </Col>
  );
}

function Pill({ label, active = false, color = COLORS.panelHi }: { label: string; active?: boolean; color?: string }) {
  return (
    <Box style={{
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 4,
      backgroundColor: active ? color : COLORS.panel,
      borderWidth: 1,
      borderColor: active ? color : COLORS.border,
    }}>
      <Text style={{ color: active ? '#0b1018' : COLORS.inkDim, fontSize: 9, fontWeight: '800' }}>
        {label.toUpperCase()}
      </Text>
    </Box>
  );
}

function TinyButton({
  label,
  active = false,
  danger = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{
        paddingHorizontal: 7,
        paddingVertical: 4,
        borderRadius: 4,
        backgroundColor: active ? COLORS.accent : danger ? '#301822' : COLORS.panelAlt,
        borderWidth: 1,
        borderColor: active ? COLORS.accent : danger ? '#5a2630' : COLORS.border,
      }}>
        <Text style={{ color: active ? '#0b1018' : danger ? COLORS.bad : COLORS.inkDim, fontSize: 9, fontWeight: '800' }}>
          {label}
        </Text>
      </Box>
    </Pressable>
  );
}
