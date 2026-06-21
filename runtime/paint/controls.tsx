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
import { Box, Row, Text, Pressable, TextInput, Slider, Graph, SdfIcon } from '../primitives';
import { BAKED_ICON_NAMES } from '../icons/baked-names';
import { type PaintTheme, DARK_THEME } from './theme';
import { sizeTrackToPx, sizePxToTrack } from './stroke';
import { brushIconLayers, toolIconLayers, type IconLayer } from './icons';
import type { BrushShape, BrushTool } from './model';

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

// ── Path icons — a glyph drawn from SVG path layers, shared by the brush-shape
// picker and the tool picker. The choice IS the icon, not a name (the brush
// path also seeds the Phase B stamp). One renderer, two thin wrappers.

export function PathIcon(props: { layers: IconLayer[]; size?: number; color: string }) {
  const size = props.size ?? 26;
  return (
    <Graph style={{ width: size, height: size, pointerEvents: 'none' }} viewX={0} viewY={0} viewZoom={1}>
      {props.layers.map((l, i) =>
        l.fill
          ? <Graph.Path key={i} d={l.d} fill={props.color} />
          : <Graph.Path key={i} d={l.d} stroke={props.color} strokeWidth={1.8} />,
      )}
    </Graph>
  );
}

// The kit can render dozens of these; a live <Graph.Path> re-parses + re-tessellates
// its d-string EVERY frame (the per-frame cost that tanked paint-mode fps, req_1549).
// So prefer the pre-baked SDF atlas — `brush.<shape>` / `tool.<tool>` are baked by
// `rjit bake-icons` from the SAME runtime/paint/icons.ts paths, drawn as one batched
// quad regardless of count. Falls back to the live path render if a glyph isn't baked
// yet (atlas not regenerated), so the picker never goes blank.
export function BrushIcon(props: { shape: BrushShape; size?: number; color: string }) {
  const name = `brush.${props.shape}`;
  if (BAKED_ICON_NAMES.has(name)) return <SdfIcon name={name} size={props.size ?? 26} color={props.color} />;
  return <PathIcon layers={brushIconLayers(props.shape)} size={props.size} color={props.color} />;
}

export function ToolIcon(props: { tool: BrushTool; size?: number; color: string }) {
  const name = `tool.${props.tool}`;
  if (BAKED_ICON_NAMES.has(name)) return <SdfIcon name={name} size={props.size ?? 26} color={props.color} />;
  return <PathIcon layers={toolIconLayers(props.tool)} size={props.size} color={props.color} />;
}
