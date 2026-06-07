// shell/fields.tsx — THE field renderer (WORKBENCH.md §2).
//
// One renderer draws every category's panel: a PanelSpec is DATA (groups of
// typed fields with getters/setters), and this module turns it into studio.cls
// controls. "Add an editor" means writing a source, not a layout. The `num`
// shape is deliberately the tunables registry's shape (min/max/step/precision)
// so settings sources generate their specs straight from editorTunables();
// asset sources speak the same protocol from draft/garage setters.
//
// Setters are the ONLY write path (LAW 1: column 3 edits, column 4
// demonstrates). After any set() the renderer calls onEdit() so the frame
// re-reads every get() — sources stay poll-free.

import { useRef, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { C, accentFor } from './workbench.cls';
import { colorRangeCells, type ColorRange } from './colorRange';
import { PickerChooser, type PickOption } from './picker';

export type { PickOption };

export type FieldSpec =
  | { k: string; t: 'val'; get(): string }
  | { k: string; t: 'bool'; get(): boolean; set(v: boolean): void }
  // num gains an optional reset affordance (WBSET9-0606, the /settings ↺
  // parity): non-default values show a reset chip carrying the default's
  // formatted hint; at-default values show a dim marker. Additive — every
  // existing num field renders unchanged.
  | { k: string; t: 'num'; get(): number; min: number; max: number; step: number; precision: number; set(v: number): void; reset?: { hint: string; isDefault(): boolean; run(): void } }
  | { k: string; t: 'slider'; get(): number; min: number; max: number; show(v: number): string; set(v: number): void }
  | { k: string; t: 'enum'; get(): string; opts: string[]; set(v: string): void }
  // WBCHAR-0606 additions (declared in WBCHAR.CAPTURE.md):
  // text — editable string (character name, anim script)
  | { k: string; t: 'text'; get(): string; set(v: string): void; placeholder?: string; width?: number }
  // act — a verb chip in the strip (generate face, reset part, anim preset)
  | { k: string; t: 'act'; tone?: string; run(): void }
  // color gains a palette (opts = quick-pick presets) and a RANGE
  // (SKINRANGE-0606: a full gradient grid — any tone reachable, presets on top)
  | { k: string; t: 'color'; get(): string; opts?: string[]; set?(v: string): void; range?: ColorRange }
  // pick (req_0184, the chip-wall verdict): ONE compact control — the current
  // value's label — that opens THE shared chooser (shell/picker.tsx:
  // searchable, grouped, counted). For any roster-sized option set (the
  // material registry, a piece list, a catalog); enum stays for short sets.
  | { k: string; t: 'pick'; get(): string | null; opts(): PickOption[]; set(v: string | null): void; show?(id: string): string; clearLabel?: string }
  // para (REQBOARD-0607, the readability verdict: "i still cant read anything
  // here"): a full-width WRAPPING text block — the detail surface for long
  // verbatim content (asks, resolution paragraphs). Read-only; the panel
  // column's own ScrollView makes it scrollable.
  | { k: string; t: 'para'; get(): string; color?: string };

// layout (SETDENSE-0607, the density verdict: "TOOO dense … sitting ass to
// mouth"): 'rows' renders the group's strip as a COLUMN — one field per row,
// label in a fixed gutter so controls align, no wrap, no label collisions.
// Additive: omitted = the flowing D1 strip every existing panel keeps.
export interface PanelGroup { title: string; fields: FieldSpec[]; layout?: 'rows' }
export interface PanelSpec { groups: PanelGroup[] }

export function panelFieldCount(spec: PanelSpec): number {
  return spec.groups.reduce((n, g) => n + g.fields.length, 0);
}

// group accents cycle the studio status palette (the wireframe's rhythm)
const ACCENTS = ['primary', 'info', 'warning', 'success', 'error', 'accentTeal'];
const SLIDER_TRACK_W = 60;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── the typed controls (studio.cls vocabulary, no new classes) ────────────────

function BoolField({ f, onEdit }: { f: Extract<FieldSpec, { t: 'bool' }>; onEdit: () => void }) {
  const on = f.get();
  const Track = on ? C.ToggleTrackOn : C.ToggleTrack;
  const Knob = on ? C.ToggleKnobOn : C.ToggleKnob;
  return (
    <Pressable onPress={() => { f.set(!f.get()); onEdit(); }}>
      <Track><Knob /></Track>
    </Pressable>
  );
}

function NumField({ f, onEdit }: { f: Extract<FieldSpec, { t: 'num' }>; onEdit: () => void }) {
  const step = (dir: -1 | 1) => {
    f.set(clamp(f.get() + f.step * dir, f.min, f.max));
    onEdit();
  };
  return (
    <>
      <C.Stepper>
        <C.StepperBtn onPress={() => step(-1)}><C.StepperBtnText>−</C.StepperBtnText></C.StepperBtn>
        <C.StepperValue>{f.get().toFixed(f.precision)}</C.StepperValue>
        <C.StepperBtn onPress={() => step(1)}><C.StepperBtnText>+</C.StepperBtnText></C.StepperBtn>
      </C.Stepper>
      {f.reset ? (
        f.reset.isDefault() ? (
          <C.FieldValue>default</C.FieldValue>
        ) : (
          <C.Chip onPress={() => { f.reset!.run(); onEdit(); }}>
            <C.ChipLabel color={accentFor('warning')}>{`↺ ${f.reset.hint}`}</C.ChipLabel>
          </C.Chip>
        )
      ) : null}
    </>
  );
}

// Slider drag: all three mouse handlers on the SAME node (pointer-capture
// rule) + onLayout for the track rect, the proven cutout BrushSlider wire.
// COMMIT ON RELEASE (WBCHAR-0606): drags preview locally and call set() ONCE
// on mouse-up — region sliders re-sculpt a mesh per set(), so per-move
// commits would melt the frame (the route's latch-preview law, kept).
export function WorkbenchSlider(props: {
  value: number;
  min: number;
  max: number;
  show: (v: number) => string;
  onChange: (v: number) => void;
  onCommit?: () => void;
  commitOnRelease?: boolean;
  toTrack?: (v: number) => number;
  fromTrack?: (t: number) => number;
  tooltip?: string;
}) {
  const rectRef = useRef<{ x: number; width: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null); // preview value while dragging
  const dragRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const toTrack = props.toTrack ?? ((v: number) => (props.max > props.min ? (v - props.min) / (props.max - props.min) : 0));
  const fromTrack = props.fromTrack ?? ((t: number) => props.min + t * (props.max - props.min));
  const preview = (px: number) => {
    const r = rectRef.current;
    if (!r || r.width <= 0) return;
    const frac = clamp((px - r.x) / r.width, 0, 1);
    const next = fromTrack(frac);
    if (props.commitOnRelease) {
      dragRef.current = next;
      setDrag(next);
    } else {
      props.onChange(next);
      props.onCommit?.();
    }
  };
  const v = drag ?? props.value;
  const frac = clamp(toTrack(v), 0, 1);
  return (
    <>
      <Pressable
        tooltip={props.tooltip}
        onMouseDown={(p: any) => { draggingRef.current = true; preview(p.x); }}
        onMouseMove={(p: any) => { if (draggingRef.current) preview(p.x); }}
        onMouseUp={() => {
          draggingRef.current = false;
          const final = dragRef.current;
          if (final === null) return;
          props.onChange(final);
          dragRef.current = null;
          setDrag(null);
          props.onCommit?.();
        }}
        onMouseLeave={() => {
          draggingRef.current = false;
          if (props.commitOnRelease) {
            dragRef.current = null;
            setDrag(null);
          }
        }}
      >
        <Box onLayout={(r: any) => { rectRef.current = { x: r.x, width: r.width }; }}>
          <C.SliderTrack>
            <C.SliderFill style={{ width: Math.round(frac * SLIDER_TRACK_W) }} />
            <C.SliderKnob style={{ left: Math.round(frac * (SLIDER_TRACK_W - 10)) }} />
          </C.SliderTrack>
        </Box>
      </Pressable>
      <C.SliderValue>{props.show(v)}</C.SliderValue>
    </>
  );
}

function SliderField({ f, onEdit }: { f: Extract<FieldSpec, { t: 'slider' }>; onEdit: () => void }) {
  return (
    <WorkbenchSlider
      value={f.get()}
      min={f.min}
      max={f.max}
      show={f.show}
      onChange={f.set}
      onCommit={onEdit}
      commitOnRelease
    />
  );
}

function TextField({ f, onEdit }: { f: Extract<FieldSpec, { t: 'text' }>; onEdit: () => void }) {
  return (
    <C.PromptInput
      value={f.get()}
      onChangeText={(t: string) => { f.set(t); onEdit(); }}
      placeholder={f.placeholder}
      fontSize={11}
      style={{ flexGrow: 0, width: f.width ?? 140, paddingTop: 4, paddingBottom: 4 }}
    />
  );
}

function ColorField({ f, onEdit }: { f: Extract<FieldSpec, { t: 'color' }>; onEdit: () => void }) {
  const cur = f.get();
  const pick = (c: string) => { f.set!(c); onEdit(); };
  if (f.set && (f.opts || f.range)) {
    return (
      <Box style={{ flexDirection: 'column', gap: 4 }}>
        {f.opts ? (
          <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
            {f.opts.map((c) => (
              <C.ColorSwatch
                key={c}
                style={{ backgroundColor: c, borderWidth: c === cur ? 2 : 1, borderColor: c === cur ? accentFor('primary') : accentFor('controlBorder') }}
                onPress={() => pick(c)}
              />
            ))}
            <C.FieldValue>{cur}</C.FieldValue>
          </Box>
        ) : null}
        {f.range ? (
          // SKINRANGE-0606: the full continuum under the quick-pick presets —
          // every cell a real value; any tone reachable
          <Box style={{ flexDirection: 'column', gap: 2 }}>
            {colorRangeCells(f.range).map((row, ri) => (
              <Box key={ri} style={{ flexDirection: 'row', gap: 2 }}>
                {row.map((c, ci) => (
                  <Pressable
                    key={`${ri}-${ci}`}
                    onPress={() => pick(c)}
                    style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: c, borderWidth: c === cur ? 2 : 0, borderColor: accentFor('primary') }}
                  />
                ))}
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    );
  }
  return (
    <>
      <C.ColorSwatch style={{ backgroundColor: cur }} onPress={() => {}} />
      <C.FieldValue>{cur}</C.FieldValue>
    </>
  );
}

// ENUMWRAP-0606 (USER: "one big row of buttons … i cant even see the name of
// that last one or if there are more"): options render as a WRAPPING chip
// grid — every option always visible, long sets read as tidy rows. Fixed
// ONCE here; every enum instance inherits.
function EnumField({ f, onEdit }: { f: Extract<FieldSpec, { t: 'enum' }>; onEdit: () => void }) {
  const cur = f.get();
  return (
    <C.FieldEnumWrap>
      {f.opts.map((o) => {
        const Cell = o === cur ? C.EnumCellOn : C.EnumCell;
        const T = o === cur ? C.EnumCellTextOn : C.EnumCellText;
        return <Cell key={o} onPress={() => { f.set(o); onEdit(); }}><T>{o}</T></Cell>;
      })}
    </C.FieldEnumWrap>
  );
}

// ONE chooser open across the whole panel at a time (req_0184: "one chooser
// instance shared by every row, never inlined per group"). Identity = the
// field's group-qualified path; onEdit re-renders every cell, so flipping
// this closes the previous one. Module scope is fine: there is one panel.
let openPickPath: string | null = null;

function PickField({ f, path, onEdit }: { f: Extract<FieldSpec, { t: 'pick' }>; path: string; onEdit: () => void }) {
  const open = openPickPath === path;
  const cur = f.get();
  const label = cur === null
    ? (f.clearLabel ? `(${f.clearLabel})` : '—')
    : f.show?.(cur) ?? f.opts().find((o) => o.id === cur)?.label ?? cur;
  return (
    <Box style={{ flexDirection: 'column', gap: 4, ...(open ? { width: '100%' } : {}) }}>
      <C.Chip onPress={() => { openPickPath = open ? null : path; onEdit(); }}>
        <C.ChipLabel color={cur === null ? accentFor('textFaint') : undefined}>{`${label} ${open ? '▴' : '▾'}`}</C.ChipLabel>
      </C.Chip>
      {open ? (
        <PickerChooser
          options={f.opts()}
          current={cur}
          clearLabel={f.clearLabel}
          onPick={(id) => { f.set(id); openPickPath = null; onEdit(); }}
          onClose={() => { openPickPath = null; onEdit(); }}
        />
      ) : null}
    </Box>
  );
}

// rows-mode cell shape (SETDENSE-0607): full row, no inter-cell rule, label
// gutter wide enough that every control starts on the same column.
const ROW_FIELD = { width: '100%' as const, borderRightWidth: 0 };
const ROW_LABEL_W = 104;

function FieldCell({ f, path, wide, onEdit }: { f: FieldSpec; path: string; wide?: boolean; onEdit: () => void }) {
  // act fields ARE their own label — a verb chip, no label/value split
  if (f.t === 'act') {
    return (
      <C.Field style={wide ? ROW_FIELD : undefined}>
        <C.Chip onPress={() => { f.run(); onEdit(); }}>
          <C.ChipLabel color={f.tone ? accentFor(f.tone) : undefined}>{f.k}</C.ChipLabel>
        </C.Chip>
      </C.Field>
    );
  }
  // para fields take the FULL strip width and stack label-over-body so the
  // text wraps across the whole panel column (REQBOARD-0607: the detail
  // surface must read, never clip to a one-line value chip)
  if (f.t === 'para') {
    return (
      <C.Field style={{ width: '100%', borderRightWidth: 0, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <C.FieldLabel>{f.k}</C.FieldLabel>
        <Text fontSize={10} color={accentFor(f.color ?? 'text')} style={{ fontFamily: 'monospace', width: '100%' }}>
          {f.get()}
        </Text>
      </C.Field>
    );
  }
  // an OPEN pick takes the full strip width so the chooser reads wide
  const open = f.t === 'pick' && openPickPath === path;
  const fieldStyle = wide || open ? { ...(wide ? ROW_FIELD : {}), ...(open ? { width: '100%' } : {}) } : undefined;
  return (
    <C.Field style={fieldStyle}>
      <C.FieldLabel style={wide ? { minWidth: ROW_LABEL_W } : undefined}>{f.k}</C.FieldLabel>
      {f.t === 'val' ? <C.FieldValue>{f.get()}</C.FieldValue> : null}
      {f.t === 'bool' ? <BoolField f={f} onEdit={onEdit} /> : null}
      {f.t === 'num' ? <NumField f={f} onEdit={onEdit} /> : null}
      {f.t === 'slider' ? <SliderField f={f} onEdit={onEdit} /> : null}
      {f.t === 'enum' ? <EnumField f={f} onEdit={onEdit} /> : null}
      {f.t === 'text' ? <TextField f={f} onEdit={onEdit} /> : null}
      {f.t === 'color' ? <ColorField f={f} onEdit={onEdit} /> : null}
      {f.t === 'pick' ? <PickField f={f} path={path} onEdit={onEdit} /> : null}
    </C.Field>
  );
}

// ── the panel ─────────────────────────────────────────────────────────────────

export function PanelGroups({ spec, onEdit }: { spec: PanelSpec; onEdit: () => void }) {
  return (
    <>
      {spec.groups.map((g, gi) => {
        const accent = accentFor(ACCENTS[gi % ACCENTS.length]);
        return (
          <C.Group key={g.title}>
            <C.GroupHead>
              <C.GroupAccentBar style={{ backgroundColor: accent }} />
              <C.GroupTitle color={accent}>{g.title}</C.GroupTitle>
              <C.GroupRule />
              <C.GroupCount>{`${g.fields.length}`}</C.GroupCount>
            </C.GroupHead>
            <C.FieldStrip style={g.layout === 'rows' ? { flexDirection: 'column', alignItems: 'stretch' } : undefined}>
              {g.fields.map((f) => <FieldCell key={f.k} f={f} path={`${g.title}/${f.k}`} wide={g.layout === 'rows'} onEdit={onEdit} />)}
            </C.FieldStrip>
          </C.Group>
        );
      })}
    </>
  );
}
