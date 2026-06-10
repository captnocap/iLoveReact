// editors/paint/PaintControls.tsx — the painter's chrome-kit controls:
// tool rail (tools, modes, mirror, clear/invert, brush size, palette),
// layer strip (stack with add/dup/move/merge/mute/delete), and the look
// panel (surface mode, blend, hue/phase/dim knobs, smart tunables, undo).
// Each piece embeds independently so a hosting editor places them where
// they fit; PaintEditor composes the full painter in one line.
//
// Behavior reference: cart/cutout/components/{Tools,TopBar,Inspector}.tsx
// (read, never imported) — re-authored on GAME_CHROME.

import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { GAME_CHROME } from '../../game/chrome';
import { PAINT_TUNING } from './tuning';
import { MASK_SURFACES, maskSurfaceLabel, NUM_COLOR_SLOTS, PAINT_BLEND_MODES, SLOT_LABELS } from './surfaces';
import { PAINT_BRUSH_PRESETS } from './brushKinds';
import type { PaintTool, PaintMode } from './layers';
import type { PaintEditorState } from './usePaintEditor';
import { PaintSurface } from './PaintSurface';
import { PaintLayerStrip } from './LayerStrip';

export { PaintLayerStrip } from './LayerStrip';

const { Chip, Knob } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;

const TOOLS: { id: PaintTool; label: string }[] = [
  { id: 'hand', label: 'move' },
  { id: 'brush', label: 'brush' },
  { id: 'refine', label: 'refine' },
  { id: 'lasso', label: 'lasso' },
  { id: 'smart', label: 'smart' },
];

const MODES: { id: PaintMode; label: string; color: 'warn' | 'good' }[] = [
  { id: 'erase', label: 'paint', color: 'warn' },
  { id: 'restore', label: 'restore', color: 'good' },
];

const KNOBS = {
  hue: { min: 0, max: 1, step: 0.05, precision: 2 },
  phase: { min: 0, max: 6.3, step: 0.35, precision: 2 },
  dim: { min: 0, max: 1, step: 0.05, precision: 2 },
  fuzz: { min: 0, max: 60, step: 5, precision: 0 },
  reject: { min: 0.01, max: 0.2, step: 0.01, precision: 2 },
  samThreshold: { min: -8, max: 8, step: 1, precision: 0 },
  samMask: { min: 0, max: 2, step: 1, precision: 0 },
  angle: { min: -180, max: 180, step: 5, precision: 0 },
  aspect: { min: 0.2, max: 8, step: 0.1, precision: 1 },
  hardness: { min: 0, max: 1, step: 0.05, precision: 2 },
  flow: { min: 0.02, max: 1, step: 0.05, precision: 2 },
  scatter: { min: 0, max: 3, step: 0.05, precision: 2 },
};

export function PaintToolRail({ s }: { s: PaintEditorState }) {
  const activeSlot = s.activeColorSlot;
  const target = s.activeLayer; // palette taps recolor the active layer (or defaults when none)
  const colors = target >= 0 && target < s.layers.length
    ? (s.layers[target].config.colors ?? s.defaults.colors)
    : s.defaults.colors;
  return (
    <Col style={{ gap: 8 }}>
      <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>TOOLS</Text>
      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        {TOOLS.map((t) => (
          (t.id === 'smart' && !s.smartAvailable) ? null : (
            <Chip key={t.id} label={t.label} active={s.tool === t.id} color="accent" onPress={() => s.setTool(t.id)} />
          )
        ))}
      </Row>
      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        {MODES.map((m) => (
          <Chip key={m.id} label={m.label} active={s.mode === m.id} color={m.color} onPress={() => s.setMode(m.id)} />
        ))}
        <Chip label="mirror" active={s.mirror} color="cyan" onPress={() => s.setMirror(!s.mirror)} />
      </Row>
      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        <Chip label="clear" color="bad" onPress={s.clearMask} />
        <Chip label="invert" color="warn" onPress={s.invertMask} />
        {s.tool === 'lasso' && s.lassoPoints.length > 0 ? (
          <Chip label={`close (${s.lassoPoints.length})`} color="good" onPress={s.commitLasso} />
        ) : null}
      </Row>
      <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>BRUSH</Text>
      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        {PAINT_BRUSH_PRESETS.map((preset) => (
          <Chip
            key={preset.label}
            label={preset.label}
            active={s.brush.kind === preset.kind}
            color="cyan"
            onPress={() => s.setBrushPreset(preset)}
          />
        ))}
      </Row>
      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        {PAINT_TUNING.brushSizes.map((px) => (
          <Chip key={px} label={`${px}`} active={s.brushPx === px} color="dim" onPress={() => s.setBrushPx(px)} />
        ))}
      </Row>
      <Knob label="angle" value={s.brush.angleDeg} spec={KNOBS.angle} onChange={(v) => s.setBrushSettings({ angleDeg: v })} />
      <Knob label="aspect" value={s.brush.aspect} spec={KNOBS.aspect} onChange={(v) => s.setBrushSettings({ aspect: v })} />
      <Knob label="hard" value={s.brush.hardness} spec={KNOBS.hardness} onChange={(v) => s.setBrushSettings({ hardness: v })} />
      <Knob label="flow" value={s.brush.flow} spec={KNOBS.flow} onChange={(v) => s.setBrushSettings({ flow: v })} />
      <Knob label="scatter" value={s.brush.scatter} spec={KNOBS.scatter} onChange={(v) => s.setBrushSettings({ scatter: v })} />
      <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>COLOR</Text>
      <Row style={{ gap: 6 }}>
        {SLOT_LABELS.slice(0, NUM_COLOR_SLOTS).map((label, i) => (
          <Pressable key={label} onPress={() => s.setActiveColorSlot(i)}>
            <Row style={{ gap: 4, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: activeSlot === i ? T.accent : T.frame }}>
              <Box style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: colors[i] ?? '#ffffff', borderWidth: 1, borderColor: T.frame }} />
              <Text style={{ color: activeSlot === i ? T.ink : T.dim, fontSize: 10 }}>{label}</Text>
            </Row>
          </Pressable>
        ))}
      </Row>
      <Row style={{ gap: 5, flexWrap: 'wrap', maxWidth: 170 }}>
        {PAINT_TUNING.palette.map((hex) => (
          <Pressable key={hex} onPress={() => s.setLayerColor(target, activeSlot, hex)}>
            <Box style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: hex, borderWidth: 1, borderColor: T.frame }} />
          </Pressable>
        ))}
      </Row>
    </Col>
  );
}

export function PaintLookPanel({ s }: { s: PaintEditorState }) {
  const i = s.activeLayer;
  const layer = i >= 0 && i < s.layers.length ? s.layers[i] : null;
  const cfg = layer?.config ?? null;
  const mode = cfg?.mode ?? s.defaults.mode;
  return (
    <Col style={{ gap: 8 }}>
      <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>
        {layer ? `SURFACE · ${layer.name}` : 'SURFACE · defaults'}
      </Text>
      <Row style={{ gap: 6, flexWrap: 'wrap' }}>
        {MASK_SURFACES.map((m) => (
          <Chip key={m} label={maskSurfaceLabel(m)} active={mode === m} color="accent" onPress={() => s.setLayerMode(i, m)} />
        ))}
        {s.customSurfaces.map((cs) => (
          <Chip key={cs.id} label={cs.label} active={mode === cs.id} color="cyan" onPress={() => s.setLayerMode(i, cs.id)} />
        ))}
      </Row>
      {cfg ? (
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          {PAINT_BLEND_MODES.map((b) => (
            <Chip key={b} label={b} active={(cfg.blend ?? 'normal') === b} color="dim" onPress={() => s.setLayerBlend(i, b)} />
          ))}
        </Row>
      ) : null}
      <Knob label="hue" value={cfg?.hueOffset ?? s.defaults.hueOffset} spec={KNOBS.hue} onChange={(v) => s.setLayerHueOffset(i, v)} />
      <Knob label="phase" value={cfg?.phaseOffset ?? s.defaults.phaseOffset} spec={KNOBS.phase} onChange={(v) => s.setLayerPhaseOffset(i, v)} />
      <Knob label="opacity" value={cfg?.dim ?? s.defaults.dim} spec={KNOBS.dim} onChange={(v) => s.setLayerDim(i, v)} />
      {s.smartAvailable ? (
        <Col style={{ gap: 6 }}>
          <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>
            SMART · {s.backendName} · {s.clicks.length} click{s.clicks.length === 1 ? '' : 's'}
          </Text>
          {s.backendName === 'sam' ? (
            <>
              <Knob label="threshold" value={s.samThreshold} spec={KNOBS.samThreshold} onChange={(v) => s.setSamThreshold(v)} />
              <Knob label="candidate" value={s.samMaskIdx} spec={KNOBS.samMask} onChange={(v) => s.setSamMaskIdx(Math.max(0, Math.min(2, Math.round(v))) as 0 | 1 | 2)} />
            </>
          ) : (
            <>
              <Knob label="fuzz %" value={s.floodFuzz} spec={KNOBS.fuzz} onChange={(v) => s.setFloodFuzz(v)} />
              <Knob label="reject r" value={s.floodRejectFrac} spec={KNOBS.reject} onChange={(v) => s.setFloodRejectFrac(v)} />
            </>
          )}
          <Row style={{ gap: 6 }}>
            <Chip label="clear clicks" color="warn" onPress={s.clearClicks} />
          </Row>
        </Col>
      ) : null}
      <Row style={{ gap: 6 }}>
        <Chip label="undo" active={false} color={s.canUndo ? 'ink' : 'dim'} onPress={s.undo} />
        <Chip label="redo" active={false} color={s.canRedo ? 'ink' : 'dim'} onPress={s.redo} />
      </Row>
      <Text style={{ color: T.dim, fontSize: 10 }} numberOfLines={1}>{s.status}</Text>
    </Col>
  );
}

/** The full painter in one line: rail | viewport | layers+look. The host
 *  gives it a box (any size — the viewport is rect-driven) and the painter
 *  fills it. */
export function PaintEditor({ s, style }: { s: PaintEditorState; style?: Record<string, unknown> }) {
  return (
    <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, gap: 0, ...(style ?? {}) }}>
      <Col style={{
        width: 190, padding: 10, gap: 12,
        backgroundColor: T.panelSolid,
        borderRightWidth: 1, borderColor: T.frame,
      }}>
        <ScrollView showScrollbar style={{ flexGrow: 1 }}>
          <PaintToolRail s={s} />
        </ScrollView>
      </Col>
      <PaintSurface s={s} />
      <Col style={{
        width: 260, padding: 10, gap: 12,
        backgroundColor: T.panelSolid,
        borderLeftWidth: 1, borderColor: T.frame,
      }}>
        <ScrollView style={{ flexGrow: 1 }}>
          <Col style={{ gap: 12 }}>
            <PaintLayerStrip s={s} />
            <PaintLookPanel s={s} />
          </Col>
        </ScrollView>
      </Col>
    </Row>
  );
}
