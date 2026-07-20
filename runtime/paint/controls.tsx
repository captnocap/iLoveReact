// runtime/paint/controls.tsx — the ONE canonical control vocabulary. Every
// brush number (size/hardness/flow/scatter/angle/aspect/spacing) is the SAME control everywhere: a labelled slider with an
// inline editable readout. No more "size is a slider here, a button there, an
// incrementer somewhere else" — that inconsistency is the whole reason this
// kit exists (USER ASK req_1447).
//
// BrushScalar is the single primitive; size/hardness/flow/scatter/angle all
// use it. `log` maps the slider track logarithmically (size wants fine control
// at the low end) while the readout always shows the real value.

import { useEffect, useRef, useState } from 'react';
import { Box, Row, Text, Pressable, TextInput, Graph, SdfIcon } from '../primitives';
import { BAKED_ICON_NAMES } from '../icons/baked-names';
import { type PaintTheme, DARK_THEME } from './theme';
import { sizeTrackToPx, sizePxToTrack } from './stroke';
import { brushIconLayers, toolIconLayers, type IconLayer } from './icons';
import type { BrushShape, BrushTool } from './model';
import { parseClampedNumericDraft, replacementDraftAfterEdit } from './numericInput';

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
  /** live value, fired continuously while dragging. */
  onChange: (v: number) => void;
  /** settled value, fired once on release (or text commit). Consumers that sync to an
   *  expensive store use this to defer the write off the per-move hot path. */
  onCommit?: (v: number) => void;
  theme?: PaintTheme;
  width?: number;
}

/** The universal brush number: label · slider · editable readout. */
export function BrushScalar(props: BrushScalarProps) {
  const T = props.theme ?? DARK_THEME;
  const precision = props.precision ?? 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fmt(props.value, precision));
  const replaceBaselineRef = useRef<string | null>(null);
  useEffect(() => { if (!editing) setDraft(fmt(props.value, precision)); }, [props.value, precision, editing]);

  const toTrack = (v: number) => (props.log ? sizePxToTrack(v) : (v - props.min) / Math.max(1e-6, props.max - props.min));
  const fromTrack = (t: number) => (props.log ? sizeTrackToPx(t) : props.min + t * (props.max - props.min));

  const commitDraft = (submitted?: unknown) => {
    const raw = typeof submitted === 'string' ? submitted : draft;
    const value = parseClampedNumericDraft(raw, props.min, props.max);
    replaceBaselineRef.current = null;
    setEditing(false);
    if (value !== null) {
      setDraft(fmt(value, precision));
      props.onChange(value);
      props.onCommit?.(value);
    } else setDraft(fmt(props.value, precision));
  };
  // End of a drag: settle the value once (props.value is the last live onChange result).
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    props.onCommit?.(props.value);
  };

  // Drag via a Pressable + measured track — the SAME general-hit-test path BrushKit's colour
  // wheel uses, which works anywhere. The host <Slider>'s dedicated hit-walker went dead deep
  // inside the editor's scrolled inspector panel (the thumb gave no read at all); a Pressable
  // does not (req_2322/2330). onLayout gives the track's screen rect so a pointer x maps to a
  // 0..1 fraction; down + move + up/leave live on the SAME node so the drag captures.
  const rectRef = useRef<{ x: number; width: number }>({ x: 0, width: 0 });
  const draggingRef = useRef(false);
  const [trackW, setTrackW] = useState(0);
  const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  const commitFromPointer = (p: any) => {
    const r = rectRef.current;
    if (r.width <= 0) return;
    props.onChange(fromTrack(clamp01((Number(p?.x) - r.x) / r.width)));
  };
  const frac = clamp01(toTrack(props.value));
  const THUMB = 12;

  return (
    <Row style={{ alignItems: 'center', gap: 8, width: props.width ?? '100%' }}>
      <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', width: 54 }}>{props.label}</Text>
      <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 18, justifyContent: 'center' }}>
        <Pressable
          onMouseDown={(p: any) => { draggingRef.current = true; commitFromPointer(p); }}
          onMouseMove={(p: any) => { if (draggingRef.current) commitFromPointer(p); }}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <Box
            onLayout={(r: any) => { rectRef.current = { x: r.x, width: r.width }; setTrackW(r.width); }}
            style={{ height: 18, justifyContent: 'center', position: 'relative' }}
          >
            <Box style={{ height: 6, borderRadius: 3, backgroundColor: T.control, overflow: 'hidden', position: 'relative' }}>
              <Box style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.round(frac * trackW), backgroundColor: T.accent }} />
            </Box>
            <Box style={{ position: 'absolute', top: 3, left: Math.round(frac * Math.max(0, trackW - THUMB)), width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: T.accent, borderWidth: 2, borderColor: T.page }} />
          </Box>
        </Pressable>
      </Box>
      <Box style={{ width: 52 }}>
        <TextInput
          value={editing ? draft : `${fmt(props.value, precision)}${props.unit ?? ''}`}
          onMouseDown={() => {
            replaceBaselineRef.current = editing ? draft : `${fmt(props.value, precision)}${props.unit ?? ''}`;
            setEditing(true);
            setDraft(fmt(props.value, precision));
          }}
          onChangeText={(value: string) => {
            const baseline = replaceBaselineRef.current;
            replaceBaselineRef.current = null;
            setEditing(true);
            setDraft(baseline === null ? value : replacementDraftAfterEdit(baseline, value));
          }}
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
