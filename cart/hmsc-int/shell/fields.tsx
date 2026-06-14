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

import { useEffect, useState } from 'react';
import { Box, Pressable, Slider, Text } from '@reactjit/primitives';
import { C, accentFor } from './workbench.cls';
import { colorRangeCells, type ColorRange } from './colorRange';
import { PickerChooser, type PickOption } from './picker';
import { ColorWheel } from '../editors/paint/ColorWheel';
import { groupSignature, panelGrammarViolations } from './panelGrammar';

export type { PickOption };

export type FieldSpec =
  | { k: string; t: 'val'; get(): string }
  // bool carries the same optional reset rider as num (PROPSFOLD-0610: the
  // in-focus tile overrides need clear-to-default on toggles too). Additive.
  | { k: string; t: 'bool'; get(): boolean; set(v: boolean): void; reset?: { hint: string; isDefault(): boolean; run(): void } }
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
  | { k: string; t: 'color'; get(): string; opts?: string[]; set?(v: string): void; range?: ColorRange; wheel?: boolean }
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
// tier (PANELGRAMMAR-0610, §11.4 rule 6): 'debug' groups render COLLAPSED by
// default — diagnostics never crowd the working controls. Additive.
export interface PanelGroup { title: string; fields: FieldSpec[]; layout?: 'rows'; tier?: 'debug' }
export interface PanelSpec { groups: PanelGroup[] }

export function panelFieldCount(spec: PanelSpec): number {
  return spec.groups.reduce((n, g) => n + g.fields.length, 0);
}

// group accents cycle the studio status palette (the wireframe's rhythm)
const ACCENTS = ['primary', 'info', 'warning', 'success', 'error', 'accentTeal'];
const SLIDER_TRACK_W = 124;
const NUM_INPUT_W = 66;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function stepDigits(step: number): number {
  const s = String(step);
  if (!s.includes('.')) return 0;
  return s.split('.')[1]?.length ?? 0;
}

function snapNum(f: Extract<FieldSpec, { t: 'num' }>, raw: number): number {
  const step = Number.isFinite(f.step) && f.step > 0 ? f.step : 1;
  const snapped = f.min + Math.round((raw - f.min) / step) * step;
  const digits = Math.min(6, Math.max(f.precision, stepDigits(step)));
  return Number(clamp(snapped, f.min, f.max).toFixed(digits));
}

function formatNum(f: Extract<FieldSpec, { t: 'num' }>, v: number): string {
  return v.toFixed(Math.max(0, f.precision));
}

// ── the typed controls (studio.cls vocabulary, no new classes) ────────────────

function BoolField({ f, onEdit }: { f: Extract<FieldSpec, { t: 'bool' }>; onEdit: () => void }) {
  const on = f.get();
  const Track = on ? C.ToggleTrackOn : C.ToggleTrack;
  const Knob = on ? C.ToggleKnobOn : C.ToggleKnob;
  return (
    <>
      <Pressable onPress={() => { f.set(!f.get()); onEdit(); }}>
        <Track><Knob /></Track>
      </Pressable>
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

function NumField({ f, onEdit }: { f: Extract<FieldSpec, { t: 'num' }>; onEdit: () => void }) {
  const value = f.get();
  const [draft, setDraft] = useState(formatNum(f, value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(formatNum(f, f.get()));
  }, [editing, f, value]);
  const commit = (raw: number) => {
    const next = snapNum(f, raw);
    f.set(next);
    setDraft(formatNum(f, next));
    onEdit();
  };
  const commitDraft = () => {
    const next = Number(draft);
    setEditing(false);
    if (Number.isFinite(next)) commit(next);
    else setDraft(formatNum(f, f.get()));
  };
  const typeDraft = (v: string) => {
    setEditing(true);
    setDraft(v);
    const next = Number(v);
    if (Number.isFinite(next)) commit(next);
  };
  return (
    <>
      <Box style={{ flexDirection: 'column', gap: 4, width: SLIDER_TRACK_W }}>
        <C.PromptInput
          value={draft}
          onMouseDown={() => setEditing(true)}
          onChangeText={typeDraft}
          onBlur={commitDraft}
          onSubmit={commitDraft}
          onSubmitEditing={commitDraft}
          fontSize={11}
          style={{
            width: NUM_INPUT_W,
            flexGrow: 0,
            paddingLeft: 6,
            paddingRight: 6,
            paddingTop: 3,
            paddingBottom: 3,
            fontFamily: 'monospace',
            fontWeight: 800,
            color: Number.isFinite(Number(draft)) ? accentFor('text') : accentFor('error'),
          }}
        />
        <WorkbenchSlider
          value={value}
          min={f.min}
          max={f.max}
          show={(v) => formatNum(f, snapNum(f, v))}
          onChange={(v) => {
            const next = snapNum(f, v);
            f.set(next);
            setDraft(formatNum(f, next));
          }}
          onCommit={onEdit}
          commitOnRelease
          showValue={false}
        />
      </Box>
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

// HOST-DRIVEN slider (SLIDER-0611, L1: "a JavaScript slider is bad"). The
// engine owns the thumb while the button is down — pointer math, capture,
// repaint all happen host-side with zero JS in the loop; this component only
// mirrors the streamed value into the label and forwards the settle. The
// nonlinear toTrack/fromTrack consumers keep working: the host runs the
// 0..1 track domain and the mapping stays JS-side at the seams.
// COMMIT ON RELEASE (WBCHAR-0606, kept): set() fires ONCE on mouse-up —
// region sliders re-sculpt a mesh per set(), so per-move commits would melt
// the frame. The live stream only updates the local preview label.
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
  showValue?: boolean;
}) {
  const [live, setLive] = useState<number | null>(null); // streamed value while dragging
  const toTrack = props.toTrack ?? ((v: number) => (props.max > props.min ? (v - props.min) / (props.max - props.min) : 0));
  const fromTrack = props.fromTrack ?? ((t: number) => props.min + t * (props.max - props.min));
  const v = live ?? props.value;
  return (
    <>
      <Slider
        value={clamp(toTrack(v), 0, 1)}
        min={0}
        max={1}
        tooltip={props.tooltip}
        onChange={(t: number) => {
          const next = fromTrack(clamp(t, 0, 1));
          if (props.commitOnRelease) {
            setLive(next);
          } else {
            props.onChange(next);
            props.onCommit?.();
          }
        }}
        onCommit={(t: number) => {
          const next = fromTrack(clamp(t, 0, 1));
          setLive(null);
          props.onChange(next);
          props.onCommit?.();
        }}
        style={{
          width: SLIDER_TRACK_W,
          height: 14,
          backgroundColor: accentFor('controlBg'),
          color: accentFor('primary'),
        }}
      />
      {props.showValue === false ? null : <C.SliderValue>{props.show(v)}</C.SliderValue>}
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
  if (f.set && f.wheel) {
    return <ColorWheel value={cur || '#000000'} onChange={pick} size={112} />;
  }
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
    <Box style={{ flexDirection: 'column', gap: 4, minWidth: 0, maxWidth: '100%', ...(open ? { width: '100%' } : {}) }}>
      <C.Chip style={{ maxWidth: '100%', minWidth: 0 }} onPress={() => { openPickPath = open ? null : path; onEdit(); }}>
        <C.ChipLabel color={cur === null ? accentFor('textFaint') : undefined} numberOfLines={1}>{`${label} ${open ? '▴' : '▾'}`}</C.ChipLabel>
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
  if (open) {
    return (
      <C.Field style={{ width: '100%', maxWidth: '100%', minWidth: 0, borderRightWidth: 0, flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
        <C.FieldLabel>{f.k}</C.FieldLabel>
        <PickField f={f} path={path} onEdit={onEdit} />
      </C.Field>
    );
  }
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

// The grammar gate (PANELGRAMMAR-0610): every rendered panel is checked
// against shell/panelGrammar.ts and violations warn LOUDLY, once per
// offending panel shape — render continues (a broken panel teaches; a blank
// one hides). The warned-set is module-level so a re-render doesn't repeat.
const warnedPanelShapes = new Set<string>();
function warnGrammar(spec: PanelSpec): void {
  const violations = panelGrammarViolations(spec);
  if (!violations.length) return;
  const shape = spec.groups.map(groupSignature).join(';');
  if (warnedPanelShapes.has(shape)) return;
  warnedPanelShapes.add(shape);
  for (const v of violations) {
    console.warn(`[panel-grammar] ${v.law}${v.group ? ` (${v.group})` : ''}: ${v.detail}`);
  }
}

function GroupBlock({ g, accent, onEdit }: { g: PanelGroup; accent: string; onEdit: () => void }) {
  // §11.4 rule 6: debug-tier groups open collapsed — diagnostics on demand.
  const [open, setOpen] = useState(g.tier !== 'debug');
  return (
    <C.Group>
      <Pressable onPress={g.tier === 'debug' ? () => setOpen((o) => !o) : undefined}>
        <C.GroupHead>
          <C.GroupAccentBar style={{ backgroundColor: accent }} />
          <C.GroupTitle color={accent}>{g.tier === 'debug' ? `${open ? '▾' : '▸'} ${g.title}` : g.title}</C.GroupTitle>
          <C.GroupRule />
          <C.GroupCount>{`${g.fields.length}`}</C.GroupCount>
        </C.GroupHead>
      </Pressable>
      {open ? (
        <C.FieldStrip style={g.layout === 'rows' ? { flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'stretch' } : undefined}>
          {g.fields.map((f) => <FieldCell key={f.k} f={f} path={`${g.title}/${f.k}`} wide={g.layout === 'rows'} onEdit={onEdit} />)}
        </C.FieldStrip>
      ) : null}
    </C.Group>
  );
}

export function PanelGroups({ spec, onEdit }: { spec: PanelSpec; onEdit: () => void }) {
  warnGrammar(spec);
  return (
    <>
      {spec.groups.map((g, gi) => (
        <GroupBlock key={g.title} g={g} accent={accentFor(ACCENTS[gi % ACCENTS.length])} onEdit={onEdit} />
      ))}
    </>
  );
}
