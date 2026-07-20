// runtime/paint/BrushKit.tsx — the drop-in brush surface. A controlled panel
// that renders the WHOLE brush experience from one place: tools, brush shapes
// + presets, the size/hardness/flow/scatter/angle/aspect/spacing dials (all the canonical
// BrushScalar), blend modes, the color wheel, and the palette (color AND
// texture/shader swatches). Drop it next to a <Paintable> + useBrushStroke and
// every tool in the repo gets the SAME paint UI (USER ASK req_1447).

import { useState } from 'react';
import { Box, Col, Row, Text, Pressable } from '../primitives';
import { BrushScalar, BrushIcon, ToolIcon } from './controls';
import { ColorField } from './ColorField';
import { type PaintTheme, DARK_THEME } from './theme';
import {
  type BlendMode, type Brush, type BrushTool, type BrushShape, type Palette, type PaintInk,
  BLEND_MODES, BRUSH_PRESETS, TOOL_HOTKEY,
  applyBrushPreset, pushRecent, inkKey,
} from './model';

function presetShape(p: typeof BRUSH_PRESETS[number]): BrushShape {
  const s = p.brush.stamp;
  return s && s.kind === 'analytic' ? s.shape : 'round';
}

const TOOL_LABEL: Record<BrushTool, string> = {
  brush: 'Brush', eraser: 'Eraser', line: 'Line', rect: 'Rect', ellipse: 'Oval',
  fill: 'Fill', eyedropper: 'Pick', smudge: 'Smudge', blur: 'Blur', text: 'Text',
  marquee: 'Marquee', lasso: 'Lasso',
};

const DEFAULT_TOOLS: BrushTool[] = ['brush', 'eraser', 'line', 'rect', 'ellipse', 'eyedropper'];

export interface BrushKitProps {
  brush: Brush;
  onBrushChange: (b: Brush) => void;
  /** settled brush, fired once when a control finishes (slider release, chip/shape click).
   *  Consumers whose onBrushChange is expensive (syncs to a heavy store) use this to defer
   *  that sync off the per-move hot path; when omitted, only onBrushChange fires. */
  onBrushCommit?: (b: Brush) => void;
  tool: BrushTool;
  onToolChange: (t: BrushTool) => void;
  palette: Palette;
  onPaletteChange?: (p: Palette) => void;
  /** which tools to surface (default: the host-supported set). */
  tools?: BrushTool[];
  /** Blend vocabulary this target can actually execute. Omit for the full set. */
  blendModes?: readonly BlendMode[];
  theme?: PaintTheme;
  width?: number;
  sections?: Partial<Record<'tools' | 'shapes' | 'dials' | 'blend' | 'color' | 'palette', boolean>>;
}

function Section(props: { title: string; theme: PaintTheme; children: any }) {
  return (
    <Col style={{ gap: 6 }}>
      <Text style={{ color: props.theme.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{props.title.toUpperCase()}</Text>
      {props.children}
    </Col>
  );
}

/** The canonical icon picker, exported so a dock can pin the tools above its
 * scrolling brush controls without reimplementing their labels or hit targets. */
export function BrushToolPicker(props: {
  tool: BrushTool;
  onToolChange: (tool: BrushTool) => void;
  tools?: readonly BrushTool[];
  theme?: PaintTheme;
}) {
  const T = props.theme ?? DARK_THEME;
  const tools = props.tools ?? DEFAULT_TOOLS;
  return (
    <Row style={{ gap: 6, flexWrap: 'wrap' }}>
      {tools.map((tool) => {
        const selected = props.tool === tool;
        return (
          <Pressable
            key={tool}
            tooltip={`${TOOL_LABEL[tool]} (${TOOL_HOTKEY[tool]})`}
            onMouseDown={() => props.onToolChange(tool)}
            style={{
              width: 34, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
              backgroundColor: selected ? T.accent : T.control,
              borderWidth: 1, borderColor: selected ? T.accent : T.frame,
            }}
          >
            <ToolIcon tool={tool} size={22} color={selected ? T.page : T.ink} />
          </Pressable>
        );
      })}
    </Row>
  );
}

function blendLabel(mode: BlendMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

/** GIMP-shaped blend control: one stable readout, with its choices expanding
 * vertically in the panel flow instead of nine chips competing for one row. */
function BlendModePicker(props: {
  value: BlendMode;
  modes: readonly BlendMode[];
  onChange: (mode: BlendMode) => void;
  theme: PaintTheme;
}) {
  const [open, setOpen] = useState(false);
  const T = props.theme;
  return (
    <Col style={{ gap: 4 }}>
      <Pressable
        tooltip="Choose how this brush combines with existing paint"
        onPress={() => setOpen((value) => !value)}
        style={{ height: 27, paddingLeft: 9, paddingRight: 9, borderRadius: 5, borderWidth: 1, borderColor: T.frame, backgroundColor: T.control, flexDirection: 'row', alignItems: 'center' }}
      >
        <Text style={{ color: T.ink, fontSize: 10, fontWeight: '800' }}>{blendLabel(props.value)}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: T.dim, fontSize: 10 }}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open ? (
        <Col style={{ borderWidth: 1, borderColor: T.frame, borderRadius: 5, overflow: 'hidden' }}>
          {props.modes.map((mode) => {
            const selected = mode === props.value;
            return (
              <Pressable
                key={mode}
                onPress={() => { props.onChange(mode); setOpen(false); }}
                style={{ height: 25, paddingLeft: 9, paddingRight: 9, flexDirection: 'row', alignItems: 'center', backgroundColor: selected ? T.accent : T.control, borderBottomWidth: mode === props.modes[props.modes.length - 1] ? 0 : 1, borderBottomColor: T.frame }}
              >
                <Text style={{ color: selected ? T.page : T.ink, fontSize: 10, fontWeight: selected ? '800' : '600' }}>{blendLabel(mode)}</Text>
              </Pressable>
            );
          })}
        </Col>
      ) : null}
    </Col>
  );
}

function Swatch(props: { ink: PaintInk; selected: boolean; theme: PaintTheme; onPress: () => void }) {
  const T = props.theme;
  const bg = props.ink.kind === 'color' ? props.ink.hex : T.control;
  const isTex = props.ink.kind !== 'color';
  return (
    <Pressable
      tooltip={props.ink.kind === 'color' ? props.ink.hex : props.ink.kind}
      onMouseDown={props.onPress}
      style={{
        width: 20, height: 20, borderRadius: 4, backgroundColor: bg,
        borderWidth: props.selected ? 2 : 1, borderColor: props.selected ? T.accent : T.frame,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {isTex ? <Text style={{ color: T.dim, fontSize: 9, fontWeight: '900' }}>{props.ink.kind === 'texture' ? 'T' : 'S'}</Text> : null}
    </Pressable>
  );
}

export function BrushKit(props: BrushKitProps) {
  const T = props.theme ?? DARK_THEME;
  const b = props.brush;
  const sec = props.sections ?? {};
  const show = (k: keyof NonNullable<BrushKitProps['sections']>) => sec[k] !== false;
  const patch = (delta: Partial<Brush>) => props.onBrushChange({ ...b, ...delta });
  // Live change AND settle in one go — for discrete controls (shape/blend chips) that have no
  // drag, and for a slider's release. onBrushChange keeps any live preview in sync; onBrushCommit
  // lets an expensive consumer sync once, off the hot path.
  const commit = (delta: Partial<Brush>) => { const nb = { ...b, ...delta }; props.onBrushChange(nb); props.onBrushCommit?.(nb); };

  const tools = props.tools ?? DEFAULT_TOOLS;
  const blendModes = props.blendModes ?? BLEND_MODES;

  // Record an ink in the recents ring (a DELIBERATE choice — a swatch click or a
  // settled colour), kept separate from setting the live brush ink. The colour
  // wheel fires onChange continuously while dragging; pushing a recent on every
  // tick floods the 12-cap ring and wipes your history (req_1729), so the live
  // drag only sets the ink and the recent is recorded once on commit.
  const recordRecent = (ink: PaintInk) => {
    if (props.onPaletteChange) props.onPaletteChange(pushRecent(props.palette, ink));
  };
  const selectInk = (ink: PaintInk) => {
    patch({ ink });
    recordRecent(ink);
  };

  const colorHex = b.ink.kind === 'color' ? b.ink.hex : '#ffffff';

  return (
    <Col style={{ width: props.width ?? 248, gap: 12, padding: 12, backgroundColor: T.panel, borderWidth: 1, borderColor: T.frame, borderRadius: 8 }}>
      {show('tools') ? (
        <Section title="Tool" theme={T}>
          <BrushToolPicker tool={props.tool} tools={tools} onToolChange={props.onToolChange} theme={T} />
        </Section>
      ) : null}

      {show('shapes') ? (
        <Section title="Brush" theme={T}>
          {/* the brush choice IS the icon (its SVG footprint), not a name */}
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            {BRUSH_PRESETS.map((p) => {
              const sh = presetShape(p);
              const sel = b.stamp.kind === 'analytic' && b.stamp.shape === sh;
              return (
                <Pressable
                  key={p.id}
                  tooltip={p.label}
                  // Presets start from the canonical baseline. Inheriting Spray's
                  // scatter/flow into Knife (or Soft's hardness into Rake) made the
                  // footprint lie about the icon after the first selection.
                  onMouseDown={() => {
                    commit(applyBrushPreset(b, p));
                  }}
                  style={{
                    width: 34, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: sel ? T.accent : T.control, borderWidth: 1, borderColor: sel ? T.accent : T.frame,
                  }}
                >
                  <BrushIcon shape={sh} size={24} color={sel ? T.page : T.ink} />
                </Pressable>
              );
            })}
          </Row>
        </Section>
      ) : null}

      {show('dials') ? (
        <Section title="Dials" theme={T}>
          <BrushScalar label="Size" value={b.size} min={1} max={512} precision={0} unit="px" log onChange={(v) => patch({ size: Math.round(v) })} onCommit={(v) => commit({ size: Math.round(v) })} theme={T} />
          <BrushScalar label="Hardness" value={b.hardness} min={0} max={1} precision={2} onChange={(v) => patch({ hardness: v })} onCommit={(v) => commit({ hardness: v })} theme={T} />
          <BrushScalar label="Flow" value={b.flow} min={0.02} max={1} precision={2} onChange={(v) => patch({ flow: v })} onCommit={(v) => commit({ flow: v })} theme={T} />
          <BrushScalar label="Scatter" value={b.scatter} min={0} max={3} precision={2} onChange={(v) => patch({ scatter: v })} onCommit={(v) => commit({ scatter: v })} theme={T} />
          <BrushScalar label="Angle" value={b.angleDeg} min={-180} max={180} precision={0} unit="°" onChange={(v) => patch({ angleDeg: Math.round(v) })} onCommit={(v) => commit({ angleDeg: Math.round(v) })} theme={T} />
          <BrushScalar label="Aspect" value={b.aspect} min={0.2} max={8} precision={2} onChange={(v) => patch({ aspect: v })} onCommit={(v) => commit({ aspect: v })} theme={T} />
          <BrushScalar label="Spacing" value={b.spacing} min={0.05} max={1} precision={2} onChange={(v) => patch({ spacing: v })} onCommit={(v) => commit({ spacing: v })} theme={T} />
        </Section>
      ) : null}

      {show('blend') ? (
        <Section title="Blend" theme={T}>
          <BlendModePicker value={b.blend} modes={blendModes} onChange={(blend) => commit({ blend })} theme={T} />
        </Section>
      ) : null}

      {show('color') ? (
        <Section title="Color" theme={T}>
          <ColorField
            value={colorHex}
            onChange={(hex) => patch({ ink: { kind: 'color', hex } })}
            onCommit={(hex) => recordRecent({ kind: 'color', hex })}
            theme={T}
            size={150}
          />
        </Section>
      ) : null}

      {show('palette') ? (
        <Section title="Palette" theme={T}>
          <Row style={{ gap: 5, flexWrap: 'wrap' }}>
            {props.palette.swatches.map((e) => (
              <Swatch key={e.id} ink={e.ink} theme={T} selected={inkKey(e.ink) === inkKey(b.ink)} onPress={() => selectInk(e.ink)} />
            ))}
          </Row>
          {props.palette.recents.length ? (
            <>
              <Text style={{ color: T.dim, fontSize: 8, fontWeight: '800' }}>RECENT</Text>
              <Row style={{ gap: 5, flexWrap: 'wrap' }}>
                {props.palette.recents.map((e) => (
                  <Swatch key={e.id} ink={e.ink} theme={T} selected={inkKey(e.ink) === inkKey(b.ink)} onPress={() => selectInk(e.ink)} />
                ))}
              </Row>
            </>
          ) : null}
        </Section>
      ) : null}
    </Col>
  );
}
