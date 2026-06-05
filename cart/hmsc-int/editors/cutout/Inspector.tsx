// editors/cutout/Inspector.tsx — the cutout app's right-side stack remade:
// tabbed properties (TOOL · FX · SOURCE) over a drag-resizable LAYERS panel.
// This is the route's own chrome over the shared painter's state (the
// characters-route pattern — the ENGINE is consumed, the app composes its
// own inspector); PaintLayerStrip/PaintLookPanel stay the generic chrome-kit
// for other embedders.
//
// Behavior reference: cart/cutout/components/Inspector.tsx (read, never
// imported) — tab split, backend picker with SAM gating, live FX gallery
// cards, parameters with global-vs-layer targeting, source properties with
// the Enter-to-apply canvas size editor, layer rows with silhouette preview
// + rename + visibility, and the layers action bar.

import { useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { GAME_CHROME } from '@game';
import {
  PaintQuad, PAINT,
  type PaintEditorState, type PaintBlendMode, type SurfaceId,
} from '../paint';

const { Chip, Knob } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;

export type BackendChoice = 'flood' | 'sam';

// Chrome sizes + knob specs for this inspector (P2 — view tuning only; paint
// behavior numbers live in editors/paint/tuning.ts).
const INSPECTOR = Object.freeze({
  width: 280,
  layersDefault: 280,
  layersMin: 150,
  propsMin: 170,
  previewGrid: 18,
  card: { w: 76, previewH: 34 },
  rowPreview: { w: 34, h: 24 },
} as const);

const KNOBS = {
  hue: { min: 0, max: 1, step: 0.05, precision: 2 },
  phase: { min: 0, max: 6.3, step: 0.35, precision: 2 },
  dim: { min: 0, max: 1, step: 0.05, precision: 2 },
  fuzz: { min: 0, max: 60, step: 5, precision: 0 },
  reject: { min: 0.01, max: 0.2, step: 0.01, precision: 2 },
  samThreshold: { min: -8, max: 8, step: 1, precision: 0 },
};

// A fully-set preview grid so FX cards show the surface itself (the layer
// rows show real silhouettes instead — texture mode on the live masks).
const FULL_PREVIEW_CELLS = (() => {
  const cells = new Set<number>();
  for (let i = 0; i < INSPECTOR.previewGrid * INSPECTOR.previewGrid; i++) cells.add(i);
  return cells;
})();

type Tab = 'tool' | 'fx' | 'source';
type Rect = { x: number; y: number; width: number; height: number };

export function CutoutInspector(props: {
  s: PaintEditorState;
  /** the smart-select backend toggle (SAM gated on the onnx host binding) */
  samAvailable: boolean;
  backendChoice: BackendChoice;
  onBackendChoice: (b: BackendChoice) => void;
  /** the working target (SOURCE tab) */
  srcPath: string | null;
  /** the registry material under the paint (the material canvas), if any */
  textureId?: string | null;
  edited: boolean;
  lastSavedAt: number | null;
  onNewCanvas: (w: number, h: number) => void;
  onLoadImage: (path: string) => void;
  onOpenEffectModal: () => void;
}) {
  const { s } = props;
  const [tab, setTab] = useState<Tab>('tool');
  const [rect, setRect] = useState<Rect | null>(null);
  const [layersHeight, setLayersHeight] = useState<number>(INSPECTOR.layersDefault);
  const [resizing, setResizing] = useState(false);

  const resizeLayers = (screenY: number) => {
    if (!rect) return;
    const raw = rect.y + rect.height - screenY;
    const max = Math.max(INSPECTOR.layersMin, rect.height - INSPECTOR.propsMin);
    setLayersHeight(Math.round(Math.max(INSPECTOR.layersMin, Math.min(max, raw))));
  };

  return (
    <Col
      style={{
        width: INSPECTOR.width, minHeight: 0, position: 'relative',
        backgroundColor: T.panelSolid, borderLeftWidth: 1, borderColor: T.frame,
      }}
      onLayout={(r: any) => setRect(r)}
    >
      {/* tabs */}
      <Row style={{ padding: 8, gap: 4, borderBottomWidth: 1, borderColor: T.frame }}>
        {([['tool', 'Tool'], ['fx', 'FX'], ['source', 'Source']] as [Tab, string][]).map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} style={{ flexGrow: 1, flexBasis: 0 }}>
            <Box style={{
              height: 26, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
              backgroundColor: tab === id ? T.accent : T.control,
              borderWidth: 1, borderColor: tab === id ? T.accent : T.frame,
            }}>
              <Text style={{ color: tab === id ? '#0b1018' : T.dim, fontSize: 10, fontWeight: '800' }}>{label}</Text>
            </Box>
          </Pressable>
        ))}
      </Row>

      <ScrollView style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        <Col style={{ padding: 10, gap: 10 }}>
          {tab === 'tool' ? <ToolTab {...props} /> : null}
          {tab === 'fx' ? <FxTab s={s} onOpenEffectModal={props.onOpenEffectModal} /> : null}
          {tab === 'source' ? <SourceTab {...props} /> : null}
        </Col>
      </ScrollView>

      {/* drag handle — the properties/layers split is yours to set */}
      <Pressable
        onMouseDown={(p: any) => { setResizing(true); resizeLayers(p.y); }}
        onMouseMove={(p: any) => { if (resizing) resizeLayers(p.y); }}
        onMouseUp={() => setResizing(false)}
      >
        <Box style={{
          height: 10, alignItems: 'center', justifyContent: 'center',
          borderTopWidth: 1, borderBottomWidth: 1, borderColor: T.frame,
        }}>
          <Box style={{ width: 48, height: 2, borderRadius: 1, backgroundColor: T.dim }} />
        </Box>
      </Pressable>

      <LayersPanel s={s} height={layersHeight} />

      {resizing ? (
        <Pressable
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001', zIndex: 50 }}
          onMouseMove={(p: any) => resizeLayers(p.y)}
          onMouseUp={() => setResizing(false)}
        />
      ) : null}
    </Col>
  );
}

// ── TOOL tab — mask state, selection metrics, backend picker + tunables ──────

function ToolTab(props: {
  s: PaintEditorState;
  samAvailable: boolean;
  backendChoice: BackendChoice;
  onBackendChoice: (b: BackendChoice) => void;
  srcPath: string | null;
  edited: boolean;
}) {
  const { s } = props;
  return (
    <>
      <Block title="Mask state">
        <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill label={props.edited ? 'edited' : 'empty'} color={props.edited ? T.good : T.dim} />
          {s.smartBusy ? <Pill label="refining" color={T.warn} /> : null}
          <Box style={{ flexGrow: 1 }} />
          <Chip label="undo" color={s.canUndo ? 'ink' : 'dim'} onPress={s.undo} />
          <Chip label="redo" color={s.canRedo ? 'ink' : 'dim'} onPress={s.redo} />
        </Row>
        <Text style={{ color: T.dim, fontSize: 10 }} numberOfLines={2}>{s.status}</Text>
      </Block>

      <Block title="Selection">
        <Row style={{ gap: 10, alignItems: 'center' }}>
          <Metric label="backend" value={s.backendName} />
          <Metric label="clicks" value={String(s.clicks.length)} />
          <Metric label="layers" value={String(s.layers.length)} />
          <Box style={{ flexGrow: 1 }} />
          {s.clicks.length > 0 ? <Chip label="clear" color="warn" onPress={s.clearClicks} /> : null}
        </Row>

        <Text style={{ color: T.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>BACKEND</Text>
        <Row style={{ gap: 6 }}>
          {([
            ['flood', 'Flood', 'magick floodfill · wand tool · always works'],
            ['sam', 'SAM', 'MobileSAM via ONNX · photo-quality edges'],
          ] as [BackendChoice, string, string][]).map(([id, label, help]) => {
            const disabled = id === 'sam' && !props.samAvailable;
            const active = props.backendChoice === id;
            return (
              <Pressable
                key={id}
                onPress={() => { if (!disabled) props.onBackendChoice(id); }}
                tooltip={disabled ? `${help} (build with -Dhas-onnx=true)` : help}
                style={{ flexGrow: 1, flexBasis: 0 }}
              >
                <Box style={{
                  height: 26, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: active ? T.accent : T.control,
                  borderWidth: 1, borderColor: active ? T.accent : T.frame,
                  opacity: disabled ? 0.4 : 1,
                }}>
                  <Text style={{ color: active ? '#0b1018' : T.dim, fontSize: 10, fontWeight: '800' }}>{label}</Text>
                </Box>
              </Pressable>
            );
          })}
        </Row>
        {!props.srcPath ? (
          <Text style={{ color: T.dim, fontSize: 10 }}>smart select needs an image source — load one in the Source tab</Text>
        ) : null}

        {props.backendChoice === 'sam' && props.samAvailable ? (
          <>
            <Knob label="threshold" value={s.samThreshold} spec={KNOBS.samThreshold} onChange={(v) => s.setSamThreshold(v)} />
            <Text style={{ color: T.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>MASK CANDIDATE</Text>
            <Row style={{ gap: 5 }}>
              {(['Whole', 'Part', 'Subpart'] as const).map((label, i) => (
                <Chip
                  key={label}
                  label={label.toLowerCase()}
                  active={s.samMaskIdx === i}
                  color="accent"
                  onPress={() => s.setSamMaskIdx(i as 0 | 1 | 2)}
                />
              ))}
            </Row>
          </>
        ) : (
          <>
            <Knob label="fuzz %" value={s.floodFuzz} spec={KNOBS.fuzz} onChange={(v) => s.setFloodFuzz(v)} />
            <Knob label="reject r" value={s.floodRejectFrac} spec={KNOBS.reject} onChange={(v) => s.setFloodRejectFrac(v)} />
          </>
        )}
      </Block>
    </>
  );
}

// ── FX tab — target picker, live surface gallery, parameters ─────────────────

function FxTab({ s, onOpenEffectModal }: { s: PaintEditorState; onOpenEffectModal: () => void }) {
  const i = s.activeLayer;
  const layer = i >= 0 && i < s.layers.length ? s.layers[i] : null;
  const cfg = layer?.config ?? null;
  const mode = cfg?.mode ?? s.defaults.mode;
  return (
    <>
      <Block title="Overlay surface">
        <Text style={{ color: T.dim, fontSize: 10 }}>
          Visual mask preview only — extraction uses the mask, not the shader.
        </Text>
        <Row style={{ gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <Metric label="target" value={layer ? layer.name : 'defaults'} />
          <Box style={{ flexGrow: 1 }} />
          <Chip label="defaults" active={!layer} color="dim" onPress={() => s.setActiveLayer(-1)} />
          {s.layers.map((_, idx) => (
            <Chip key={idx} label={`${idx + 1}`} active={i === idx} color="dim" onPress={() => s.setActiveLayer(idx)} />
          ))}
        </Row>
      </Block>

      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        {PAINT.MASK_SURFACES.map((m) => (
          <SurfaceCard
            key={m}
            s={s}
            id={m}
            label={PAINT.maskSurfaceLabel(m)}
            colors={cfg?.colors ?? s.defaults.colors}
            active={mode === m}
            onPress={() => s.setLayerMode(i, m)}
          />
        ))}
        {s.customSurfaces.map((cs) => (
          <SurfaceCard
            key={cs.id}
            s={s}
            id={cs.id}
            label={cs.label}
            colors={cfg?.colors ?? s.defaults.colors}
            active={mode === cs.id}
            onPress={() => s.setLayerMode(i, cs.id)}
          />
        ))}
        <Pressable onPress={onOpenEffectModal}>
          <Col style={{
            width: INSPECTOR.card.w, height: INSPECTOR.card.previewH + 24,
            borderRadius: 6, borderWidth: 1, borderColor: T.accent, backgroundColor: T.control,
            alignItems: 'center', justifyContent: 'center', gap: 2,
          }}>
            <Text style={{ color: T.accent, fontSize: 18, fontWeight: '900' }}>+</Text>
            <Text style={{ color: T.dim, fontSize: 9, fontWeight: '800' }}>New FX</Text>
          </Col>
        </Pressable>
      </Row>

      <Block title="Parameters">
        <Knob label="hue" value={cfg?.hueOffset ?? s.defaults.hueOffset} spec={KNOBS.hue} onChange={(v) => s.setLayerHueOffset(i, v)} />
        <Knob label="phase" value={cfg?.phaseOffset ?? s.defaults.phaseOffset} spec={KNOBS.phase} onChange={(v) => s.setLayerPhaseOffset(i, v)} />
        <Knob label="opacity" value={cfg?.dim ?? s.defaults.dim} spec={KNOBS.dim} onChange={(v) => s.setLayerDim(i, v)} />
        {cfg ? (
          <>
            <Text style={{ color: T.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>BLEND</Text>
            <Row style={{ gap: 5, flexWrap: 'wrap' }}>
              {PAINT.PAINT_BLEND_MODES.map((b: PaintBlendMode) => (
                <Chip key={b} label={b} active={(cfg.blend ?? 'normal') === b} color="dim" onPress={() => s.setLayerBlend(i, b)} />
              ))}
            </Row>
            <Row style={{ gap: 6, alignItems: 'center' }}>
              <Text style={{ color: T.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>VISIBILITY</Text>
              <Box style={{ flexGrow: 1 }} />
              <Chip label={cfg.muted ? 'show' : 'hide'} active={cfg.muted} color="warn" onPress={() => s.toggleLayerMute(i)} />
            </Row>
          </>
        ) : null}
      </Block>
    </>
  );
}

function SurfaceCard(props: {
  s: PaintEditorState;
  id: SurfaceId;
  label: string;
  colors: string[];
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={props.onPress}>
      <Col style={{
        width: INSPECTOR.card.w, gap: 4, padding: 5, borderRadius: 6,
        backgroundColor: props.active ? T.controlAlt : T.control,
        borderWidth: 1, borderColor: props.active ? T.accent : T.frame,
      }}>
        <Box style={{
          width: INSPECTOR.card.w - 10, height: INSPECTOR.card.previewH,
          borderRadius: 4, overflow: 'hidden', position: 'relative',
          backgroundColor: T.page, borderWidth: 1, borderColor: T.frame,
        }}>
          <PaintQuad
            cells={FULL_PREVIEW_CELLS}
            gridSize={INSPECTOR.previewGrid}
            worldW={INSPECTOR.card.w - 10}
            worldH={INSPECTOR.card.previewH}
            mode={props.id}
            customSurfaces={props.s.customSurfaces}
            colors={props.colors}
            dim={1}
          />
        </Box>
        <Text style={{ color: props.active ? T.ink : T.dim, fontSize: 9, fontWeight: '800' }} numberOfLines={1}>
          {props.label}
        </Text>
      </Col>
    </Pressable>
  );
}

// ── SOURCE tab — working surface management ───────────────────────────────────

function SourceTab(props: {
  s: PaintEditorState;
  srcPath: string | null;
  textureId?: string | null;
  lastSavedAt: number | null;
  onNewCanvas: (w: number, h: number) => void;
  onLoadImage: (path: string) => void;
}) {
  const { s } = props;
  const [w, setW] = useState(String(s.dims.w));
  const [h, setH] = useState(String(s.dims.h));
  const [path, setPath] = useState(props.srcPath ?? '');
  const applySize = () => props.onNewCanvas(Number(w), Number(h));
  return (
    <>
      <Block title="Source">
        {props.srcPath ? (
          <>
            <Text style={{ color: T.dim, fontSize: 10 }} numberOfLines={3}>{props.srcPath}</Text>
            <Text style={{ color: T.ink, fontSize: 11, fontWeight: '700' }}>{`${s.dims.w} × ${s.dims.h}`}</Text>
          </>
        ) : props.textureId ? (
          <>
            <Text style={{ color: T.accent, fontSize: 11, fontWeight: '700' }}>Material canvas</Text>
            <Text style={{ color: T.dim, fontSize: 10 }} numberOfLines={2}>{props.textureId}</Text>
            <Text style={{ color: T.ink, fontSize: 11, fontWeight: '700' }}>{`${s.dims.w} × ${s.dims.h}`}</Text>
            <Text style={{ color: T.dim, fontSize: 9 }}>pick materials/recipes in the library rail</Text>
          </>
        ) : (
          <Text style={{ color: T.dim, fontSize: 11 }}>{`Blank canvas · ${s.dims.w} × ${s.dims.h}`}</Text>
        )}
      </Block>

      <Block title="New canvas">
        <Row style={{ gap: 6, alignItems: 'center' }}>
          <SizeInput value={w} onChange={setW} onSubmit={applySize} />
          <Text style={{ color: T.dim, fontSize: 11 }}>×</Text>
          <SizeInput value={h} onChange={setH} onSubmit={applySize} />
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: T.dim, fontSize: 9 }}>↵ to apply</Text>
        </Row>
        <Row style={{ gap: 5, flexWrap: 'wrap' }}>
          {[256, 512, 1024].map((px) => (
            <Chip key={px} label={`${px}`} color="dim" onPress={() => { setW(String(px)); setH(String(px)); props.onNewCanvas(px, px); }} />
          ))}
          <Chip label="new canvas" color="warn" onPress={applySize} />
        </Row>
      </Block>

      <Block title="Load image">
        <TextInput
          value={path}
          onChangeText={setPath}
          onSubmit={() => props.onLoadImage(path)}
          onSubmitEditing={() => props.onLoadImage(path)}
          placeholder="/path/to/image.png"
          style={{
            height: 26, fontSize: 11, color: T.ink, backgroundColor: T.control,
            borderWidth: 1, borderColor: T.frame, borderRadius: 5, paddingHorizontal: 8,
          }}
        />
        <Row style={{ gap: 6, alignItems: 'center' }}>
          <Chip label="load" color="cyan" onPress={() => props.onLoadImage(path)} />
          <Text style={{ color: T.dim, fontSize: 10 }}>or drop a file anywhere</Text>
        </Row>
      </Block>

      {props.lastSavedAt ? (
        <Block title="Last saved">
          <Text style={{ color: T.good, fontSize: 10 }}>{formatSaveAge(props.lastSavedAt)} ago · on the cutout stream</Text>
        </Block>
      ) : null}
    </>
  );
}

function SizeInput({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      onSubmit={onSubmit}
      onSubmitEditing={onSubmit}
      style={{
        width: 58, height: 26, fontSize: 11, color: T.ink, backgroundColor: T.control,
        borderWidth: 1, borderColor: T.frame, borderRadius: 5, paddingHorizontal: 6,
      }}
    />
  );
}

// ── LAYERS panel — rows with silhouette, rename, visibility; action bar ──────

function LayersPanel({ s, height }: { s: PaintEditorState; height: number }) {
  const i = s.activeLayer;
  const canTarget = i >= 0 && i < s.layers.length;
  return (
    <Col style={{ height, minHeight: 0, backgroundColor: T.page }}>
      <Row style={{ paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', gap: 6 }}>
        <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>
          {`LAYERS${s.layers.length ? ` (${s.layers.length})` : ''}`}
        </Text>
        <Box style={{ flexGrow: 1 }} />
        {s.clipboard ? <Chip label="paste" color="dim" onPress={s.pasteLayer} /> : null}
      </Row>
      <ScrollView style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        <Col style={{ paddingHorizontal: 10, paddingBottom: 8, gap: 5 }}>
          {s.layers.length === 0 ? (
            <Text style={{ color: T.dim, fontSize: 10 }}>No layers — paint or smart-select a region.</Text>
          ) : null}
          {s.layers.map((layer, idx) => (
            <LayerRow key={layer.id} s={s} index={idx} />
          ))}
        </Col>
      </ScrollView>
      <Row style={{
        height: 30, paddingHorizontal: 8, alignItems: 'center', gap: 6,
        borderTopWidth: 1, borderColor: T.frame, backgroundColor: T.panelSolid,
      }}>
        <LayerAction icon="Plus" label="Add layer" onPress={() => s.addLayer()} />
        <LayerAction icon="Copy" label="Duplicate layer" disabled={!canTarget} onPress={() => s.duplicateLayer(i)} />
        <LayerAction icon="ArrowUp" label="Move layer up" disabled={!canTarget} onPress={() => s.moveLayer(i, -1)} />
        <LayerAction icon="ArrowDown" label="Move layer down" disabled={!canTarget} onPress={() => s.moveLayer(i, 1)} />
        <LayerAction icon="Merge" label="Merge down" disabled={!canTarget} onPress={() => s.mergeLayer(i)} />
        <LayerAction icon="Scissors" label="Cut layer to clipboard" disabled={!canTarget} onPress={() => s.cutLayer(i)} />
        <Box style={{ flexGrow: 1 }} />
        <LayerAction icon="Trash2" label="Delete layer" disabled={!canTarget} danger onPress={() => s.deleteLayer(i)} />
      </Row>
    </Col>
  );
}

function LayerRow({ s, index }: { s: PaintEditorState; index: number }) {
  const layer = s.layers[index];
  const active = index === s.activeLayer;
  const [renaming, setRenaming] = useState(false);
  const surfaceLabel = PAINT.isBuiltinSurface(layer.config.mode)
    ? PAINT.maskSurfaceLabel(layer.config.mode)
    : (s.customSurfaces.find((c) => c.id === layer.config.mode)?.label ?? 'Custom FX');
  return (
    <Pressable onPress={() => s.setActiveLayer(index)}>
      <Row style={{
        gap: 7, alignItems: 'center', padding: 6, borderRadius: 5,
        backgroundColor: active ? T.controlAlt : T.control,
        borderWidth: 1, borderColor: active ? T.accent : T.frame,
        opacity: layer.config.muted ? 0.55 : 1,
      }}>
        <Box style={{ width: 3, height: 30, borderRadius: 2, backgroundColor: active ? T.accent : T.frame }} />
        {/* the layer's REAL silhouette — its live mask textures through its
            own surface (texture mode), not a generic swatch */}
        <Box style={{
          width: INSPECTOR.rowPreview.w, height: INSPECTOR.rowPreview.h,
          borderRadius: 4, overflow: 'hidden', position: 'relative',
          backgroundColor: T.page, borderWidth: 1, borderColor: T.frame,
        }}>
          <PaintQuad
            paintableId={s.baseIdOf(layer)}
            overrideId={s.brushIdOf(layer)}
            worldW={INSPECTOR.rowPreview.w}
            worldH={INSPECTOR.rowPreview.h}
            mode={layer.config.mode}
            customSurfaces={s.customSurfaces}
            colors={layer.config.colors}
            dim={1}
          />
        </Box>
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 1 }}>
          {renaming ? (
            <TextInput
              value={layer.name}
              onChangeText={(v: string) => s.setLayerName(index, v)}
              onSubmit={() => setRenaming(false)}
              onSubmitEditing={() => setRenaming(false)}
              style={{
                height: 18, fontSize: 11, color: T.ink, backgroundColor: T.page,
                borderWidth: 1, borderColor: T.accent, borderRadius: 3, paddingHorizontal: 4,
              }}
            />
          ) : (
            <Row style={{ gap: 5, alignItems: 'center' }}>
              <Text style={{ color: active ? T.ink : T.dim, fontSize: 11, fontWeight: '700', flexGrow: 1 }} numberOfLines={1}>
                {layer.name}
              </Text>
              <Pressable onPress={() => setRenaming(true)} tooltip="Rename layer">
                <Icon name="Pencil" size={10} color={T.dim} />
              </Pressable>
            </Row>
          )}
          <Row style={{ gap: 5, alignItems: 'center' }}>
            <Text style={{ color: T.dim, fontSize: 9 }} numberOfLines={1}>{surfaceLabel}</Text>
            {layer.groupName ? (
              <Box style={{ paddingHorizontal: 4, borderRadius: 3, borderWidth: 1, borderColor: T.frame }}>
                <Text style={{ color: T.dim, fontSize: 8, fontWeight: '800' }} numberOfLines={1}>{layer.groupName}</Text>
              </Box>
            ) : null}
            {layer.clicks.length > 0 ? (
              <Text style={{ color: T.dim, fontSize: 8 }}>{`${layer.clicks.length}c`}</Text>
            ) : null}
          </Row>
        </Col>
        <Pressable onPress={() => s.toggleLayerMute(index)} tooltip={layer.config.muted ? 'Show layer' : 'Hide layer'}>
          <Box style={{
            width: 22, height: 22, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
            backgroundColor: layer.config.muted ? T.page : T.controlAlt,
            borderWidth: 1, borderColor: T.frame,
          }}>
            <Icon name={layer.config.muted ? 'EyeOff' : 'Eye'} size={11} color={T.dim} />
          </Box>
        </Pressable>
      </Row>
    </Pressable>
  );
}

function LayerAction(props: { icon: string; label: string; disabled?: boolean; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={() => { if (!props.disabled) props.onPress(); }} tooltip={props.label}>
      <Box style={{
        width: 24, height: 22, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
        backgroundColor: props.danger ? '#301822' : T.control,
        borderWidth: 1, borderColor: T.frame,
        opacity: props.disabled ? 0.4 : 1,
      }}>
        <Icon name={props.icon} size={12} color={props.danger ? T.bad : T.dim} />
      </Box>
    </Pressable>
  );
}

// ── shared bits ───────────────────────────────────────────────────────────────

function Block({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Col style={{ gap: 6, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: T.frame, backgroundColor: T.control }}>
      <Text style={{ color: T.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>{title.toUpperCase()}</Text>
      {children}
    </Col>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <Box style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: color }}>
      <Text style={{ color, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{label.toUpperCase()}</Text>
    </Box>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Col style={{ gap: 1 }}>
      <Text style={{ color: T.dim, fontSize: 8, fontWeight: '800', letterSpacing: 1 }}>{label.toUpperCase()}</Text>
      <Text style={{ color: T.ink, fontSize: 10, fontWeight: '700' }} numberOfLines={1}>{value}</Text>
    </Col>
  );
}

export function formatSaveAge(saved: number): string {
  const sec = Math.max(0, Math.round((Date.now() - saved) / 1000));
  if (sec < 2) return 'now';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}
