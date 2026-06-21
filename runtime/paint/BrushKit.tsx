// runtime/paint/BrushKit.tsx — the drop-in brush surface. A controlled panel
// that renders the WHOLE brush experience from one place: tools, brush shapes
// + presets, the size/hardness/flow/scatter/angle dials (all the canonical
// BrushScalar), blend modes, the color wheel, and the palette (color AND
// texture/shader swatches). Drop it next to a <Paintable> + useBrushStroke and
// every tool in the repo gets the SAME paint UI (USER ASK req_1447).

import { Box, Col, Row, Text, Pressable } from '../primitives';
import { BrushScalar, ChipRow, BrushIcon, ToolIcon, type ChipOption } from './controls';
import { ColorField } from './ColorField';
import { type PaintTheme, DARK_THEME } from './theme';
import {
  type Brush, type BrushTool, type BrushShape, type Palette, type PaintInk,
  BLEND_MODES, BRUSH_PRESETS, TOOL_HOTKEY,
  normalizeBrush, pushRecent, inkKey,
} from './model';

function presetShape(p: typeof BRUSH_PRESETS[number]): BrushShape {
  const s = p.brush.stamp;
  return s && s.kind === 'analytic' ? s.shape : 'round';
}

const TOOL_LABEL: Record<BrushTool, string> = {
  brush: 'Brush', eraser: 'Eraser', line: 'Line', rect: 'Rect', ellipse: 'Oval',
  fill: 'Fill', eyedropper: 'Pick', smudge: 'Smudge', blur: 'Blur', text: 'Text',
};

const DEFAULT_TOOLS: BrushTool[] = ['brush', 'eraser', 'line', 'rect', 'ellipse', 'eyedropper'];

export interface BrushKitProps {
  brush: Brush;
  onBrushChange: (b: Brush) => void;
  tool: BrushTool;
  onToolChange: (t: BrushTool) => void;
  palette: Palette;
  onPaletteChange?: (p: Palette) => void;
  /** which tools to surface (default: the host-supported set). */
  tools?: BrushTool[];
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

  const tools = props.tools ?? DEFAULT_TOOLS;
  const blendOpts: ChipOption<string>[] = BLEND_MODES.map((m) => ({ value: m, label: m }));

  const selectInk = (ink: PaintInk) => {
    patch({ ink });
    if (props.onPaletteChange) props.onPaletteChange(pushRecent(props.palette, ink));
  };

  const colorHex = b.ink.kind === 'color' ? b.ink.hex : '#ffffff';

  return (
    <Col style={{ width: props.width ?? 248, gap: 12, padding: 12, backgroundColor: T.panel, borderWidth: 1, borderColor: T.frame, borderRadius: 8 }}>
      {show('tools') ? (
        <Section title="Tool" theme={T}>
          {/* tools ship with a standard icon too — picker is glyphs, not names */}
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            {tools.map((t) => {
              const sel = props.tool === t;
              return (
                <Pressable
                  key={t}
                  tooltip={`${TOOL_LABEL[t]} (${TOOL_HOTKEY[t]})`}
                  onMouseDown={() => props.onToolChange(t)}
                  style={{
                    width: 34, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: sel ? T.accent : T.control, borderWidth: 1, borderColor: sel ? T.accent : T.frame,
                  }}
                >
                  <ToolIcon tool={t} size={22} color={sel ? T.page : T.ink} />
                </Pressable>
              );
            })}
          </Row>
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
                  onMouseDown={() => props.onBrushChange(normalizeBrush({ ...b, ...p.brush, ink: b.ink, size: b.size }))}
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
          <BrushScalar label="Size" value={b.size} min={1} max={512} precision={0} unit="px" log onChange={(v) => patch({ size: Math.round(v) })} theme={T} />
          <BrushScalar label="Hardness" value={b.hardness} min={0} max={1} precision={2} onChange={(v) => patch({ hardness: v })} theme={T} />
          <BrushScalar label="Flow" value={b.flow} min={0.02} max={1} precision={2} onChange={(v) => patch({ flow: v })} theme={T} />
          <BrushScalar label="Scatter" value={b.scatter} min={0} max={3} precision={2} onChange={(v) => patch({ scatter: v })} theme={T} />
          <BrushScalar label="Angle" value={b.angleDeg} min={-180} max={180} precision={0} unit="°" onChange={(v) => patch({ angleDeg: Math.round(v) })} theme={T} />
          <BrushScalar label="Aspect" value={b.aspect} min={0.2} max={8} precision={2} onChange={(v) => patch({ aspect: v })} theme={T} />
        </Section>
      ) : null}

      {show('blend') ? (
        <Section title="Blend" theme={T}>
          <ChipRow options={blendOpts} value={b.blend} onChange={(m) => patch({ blend: m as Brush['blend'] })} theme={T} wrap />
        </Section>
      ) : null}

      {show('color') ? (
        <Section title="Color" theme={T}>
          <ColorField value={colorHex} onChange={(hex) => selectInk({ kind: 'color', hex })} theme={T} size={150} />
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
