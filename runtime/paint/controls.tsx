// runtime/paint/controls.tsx — the ONE canonical control vocabulary. Every
// brush number is the SAME control everywhere: a labelled slider with an
// inline editable readout. No more "size is a slider here, a button there, an
// incrementer somewhere else" — that inconsistency is the whole reason this
// kit exists (USER ASK req_1447).
//
// BrushScalar is the single primitive; size/hardness/flow/scatter/angle all
// use it. `log` maps the slider track logarithmically (size wants fine control
// at the low end) while the readout always shows the real value.

import { useEffect, useState } from 'react';
import { Box, Row, Text, Pressable, TextInput, Slider, Graph } from '../primitives';
import { type PaintTheme, DARK_THEME } from './theme';
import { sizeTrackToPx, sizePxToTrack } from './stroke';
import { brushIconLayers } from './icons';
import type { BrushShape } from './model';

function fmt(v: number, precision: number): string {
  return precision <= 0 ? String(Math.round(v)) : v.toFixed(precision);
}

export interface BrushScalarProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** decimals in the readout (0 = integer). */
  precision?: number;
  /** unit suffix shown after the readout (e.g. "px", "°"). */
  unit?: string;
  /** logarithmic size track (maps via stroke.sizeTrackToPx). */
  log?: boolean;
  onChange: (v: number) => void;
  theme?: PaintTheme;
  width?: number;
}

/** The universal brush number: label · slider · editable readout. */
export function BrushScalar(props: BrushScalarProps) {
  const T = props.theme ?? DARK_THEME;
  const precision = props.precision ?? 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fmt(props.value, precision));
  useEffect(() => { if (!editing) setDraft(fmt(props.value, precision)); }, [props.value, precision, editing]);

  const toTrack = (v: number) => (props.log ? sizePxToTrack(v) : (v - props.min) / Math.max(1e-6, props.max - props.min));
  const fromTrack = (t: number) => (props.log ? sizeTrackToPx(t) : props.min + t * (props.max - props.min));

  const commitDraft = () => {
    const n = Number(draft);
    setEditing(false);
    if (Number.isFinite(n)) props.onChange(Math.max(props.min, Math.min(props.max, n)));
    else setDraft(fmt(props.value, precision));
  };

  return (
    <Row style={{ alignItems: 'center', gap: 8, width: props.width ?? '100%' }}>
      <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', width: 54 }}>{props.label}</Text>
      <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 18, justifyContent: 'center' }}>
        <Slider
          value={toTrack(props.value)}
          min={0}
          max={1}
          step={0}
          onChange={(t: number) => props.onChange(fromTrack(t))}
          style={{ height: 6, backgroundColor: T.control, color: T.accent }}
        />
      </Box>
      <Box style={{ width: 52 }}>
        <TextInput
          value={editing ? draft : `${fmt(props.value, precision)}${props.unit ?? ''}`}
          onMouseDown={() => { setEditing(true); setDraft(fmt(props.value, precision)); }}
          onChangeText={(v: string) => { setEditing(true); setDraft(v); }}
          onSubmit={commitDraft}
          onSubmitEditing={commitDraft}
          onBlur={commitDraft}
          style={{
            height: 20, fontSize: 10, fontWeight: '700', textAlign: 'right',
            color: T.ink, backgroundColor: T.control,
            borderWidth: 1, borderColor: T.frame, borderRadius: 4, paddingHorizontal: 5,
          }}
        />
      </Box>
    </Row>
  );
}

// ── Segmented chip row — the one idiom for picking from a small enum (tools,
// blend modes, brush shapes). Selected = accent fill. ──────────────────────────

export interface ChipOption<T> {
  value: T;
  label: string;
  hint?: string;
}

export function ChipRow<T extends string>(props: {
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  theme?: PaintTheme;
  wrap?: boolean;
}) {
  const T = props.theme ?? DARK_THEME;
  return (
    <Row style={{ gap: 4, flexWrap: props.wrap ? 'wrap' : 'nowrap' }}>
      {props.options.map((o) => {
        const sel = o.value === props.value;
        return (
          <Pressable
            key={o.value}
            tooltip={o.hint ?? o.label}
            onMouseDown={() => props.onChange(o.value)}
            style={{
              paddingHorizontal: 8, height: 24, borderRadius: 5,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: sel ? T.accent : T.control,
              borderWidth: 1, borderColor: sel ? T.accent : T.frame,
            }}
          >
            <Text style={{ color: sel ? T.page : T.dim, fontSize: 10, fontWeight: '800' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

// ── BrushIcon — a brush shape drawn from its SVG path layers. This IS the brush
// choice in the picker (an icon, not a name) and the seed for the Phase B stamp.

export function BrushIcon(props: { shape: BrushShape; size?: number; color: string }) {
  const size = props.size ?? 26;
  const layers = brushIconLayers(props.shape);
  return (
    <Graph style={{ width: size, height: size, pointerEvents: 'none' }} viewX={0} viewY={0} viewZoom={1}>
      {layers.map((l, i) =>
        l.fill
          ? <Graph.Path key={i} d={l.d} fill={props.color} />
          : <Graph.Path key={i} d={l.d} stroke={props.color} strokeWidth={1.8} />,
      )}
    </Graph>
  );
}
