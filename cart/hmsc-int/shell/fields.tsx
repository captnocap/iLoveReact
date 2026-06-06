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
import { Box, Pressable } from '@reactjit/primitives';
import { C, accentFor } from './workbench.cls';

export type FieldSpec =
  | { k: string; t: 'val'; get(): string }
  | { k: string; t: 'bool'; get(): boolean; set(v: boolean): void }
  | { k: string; t: 'num'; get(): number; min: number; max: number; step: number; precision: number; set(v: number): void }
  | { k: string; t: 'slider'; get(): number; min: number; max: number; show(v: number): string; set(v: number): void }
  | { k: string; t: 'enum'; get(): string; opts: string[]; set(v: string): void }
  | { k: string; t: 'color'; get(): string; set?(v: string): void };

export interface PanelGroup { title: string; fields: FieldSpec[] }
export interface PanelSpec { groups: PanelGroup[] }

export function panelFieldCount(spec: PanelSpec): number {
  return spec.groups.reduce((n, g) => n + g.fields.length, 0);
}

// group accents cycle the studio status palette (the wireframe's rhythm)
const ACCENTS = ['primary', 'info', 'warning', 'success', 'error', 'accentTeal'];

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
    <C.Stepper>
      <C.StepperBtn onPress={() => step(-1)}><C.StepperBtnText>−</C.StepperBtnText></C.StepperBtn>
      <C.StepperValue>{f.get().toFixed(f.precision)}</C.StepperValue>
      <C.StepperBtn onPress={() => step(1)}><C.StepperBtnText>+</C.StepperBtnText></C.StepperBtn>
    </C.Stepper>
  );
}

// Slider drag: all three mouse handlers on the SAME node (pointer-capture
// rule) + onLayout for the track rect, the proven cutout BrushSlider wire.
function SliderField({ f, onEdit }: { f: Extract<FieldSpec, { t: 'slider' }>; onEdit: () => void }) {
  const rectRef = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const apply = (px: number) => {
    const r = rectRef.current;
    if (!r || r.width <= 0) return;
    const frac = clamp((px - r.x) / r.width, 0, 1);
    f.set(f.min + frac * (f.max - f.min));
    onEdit();
  };
  const v = f.get();
  const frac = f.max > f.min ? clamp((v - f.min) / (f.max - f.min), 0, 1) : 0;
  const pct = Math.round(frac * 100);
  return (
    <>
      <Pressable
        onMouseDown={(p: any) => { setDragging(true); apply(p.x); }}
        onMouseMove={(p: any) => { if (dragging) apply(p.x); }}
        onMouseUp={() => setDragging(false)}
      >
        <Box onLayout={(r: any) => { rectRef.current = { x: r.x, width: r.width }; }}>
          <C.SliderTrack>
            <C.SliderFill style={{ width: `${pct}%` }} />
            <C.SliderKnob style={{ left: Math.round(frac * 50) }} />
          </C.SliderTrack>
        </Box>
      </Pressable>
      <C.SliderValue>{f.show(v)}</C.SliderValue>
    </>
  );
}

function EnumField({ f, onEdit }: { f: Extract<FieldSpec, { t: 'enum' }>; onEdit: () => void }) {
  const cur = f.get();
  return (
    <C.Segment>
      {f.opts.map((o) => {
        const Cell = o === cur ? C.SegOptionActive : C.SegOption;
        const T = o === cur ? C.SegTextActive : C.SegText;
        return <Cell key={o} onPress={() => { f.set(o); onEdit(); }}><T>{o}</T></Cell>;
      })}
    </C.Segment>
  );
}

function FieldCell({ f, onEdit }: { f: FieldSpec; onEdit: () => void }) {
  return (
    <C.Field>
      <C.FieldLabel>{f.k}</C.FieldLabel>
      {f.t === 'val' ? <C.FieldValue>{f.get()}</C.FieldValue> : null}
      {f.t === 'bool' ? <BoolField f={f} onEdit={onEdit} /> : null}
      {f.t === 'num' ? <NumField f={f} onEdit={onEdit} /> : null}
      {f.t === 'slider' ? <SliderField f={f} onEdit={onEdit} /> : null}
      {f.t === 'enum' ? <EnumField f={f} onEdit={onEdit} /> : null}
      {f.t === 'color' ? (
        <>
          <C.ColorSwatch style={{ backgroundColor: f.get() }} onPress={() => {}} />
          <C.FieldValue>{f.get()}</C.FieldValue>
        </>
      ) : null}
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
            <C.FieldStrip>
              {g.fields.map((f) => <FieldCell key={f.k} f={f} onEdit={onEdit} />)}
            </C.FieldStrip>
          </C.Group>
        );
      })}
    </>
  );
}
