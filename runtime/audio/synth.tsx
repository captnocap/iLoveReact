/**
 * Audio — bridges framework/audio.zig (modular synth engine).
 *
 * The engine runs at 44.1 kHz with up to 64 modules and 256 connections,
 * driven by a lock-free SPSC command queue. JS/React produces add/remove/
 * connect/disconnect/set_param/note_on/note_off/master_gain commands; the
 * audio thread consumes them between callbacks.
 *
 * React surface:
 *   <Synth masterGain={0.5}>
 *     <Synth.Oscillator name="osc" wave="sine"   freq={440} />
 *     <Synth.Filter     name="lpf" type="lowpass" cutoff={1200} input="osc" />
 *     <Synth.Amplifier  name="amp" gain={0.5}    input="lpf" />
 *     <Synth.Wire from="amp" toMaster />
 *   </Synth>
 *
 *   const { noteOn, noteOff, setParam } = useSynth();
 *   <Pressable onPress={() => noteOn('osc', 60)}>Play C4</Pressable>
 */

const React = require('react');

// ── Module-type enum (matches framework/audio.zig:ModuleType) ─────────

export const MODULE_TYPE = {
  oscillator: 0,
  filter: 1,
  amplifier: 2,
  mixer: 3,
  delay: 4,
  envelope: 5,
  lfo: 6,
  sequencer: 7,
  sampler: 8,
  custom: 9,
  instrument: 10,
  clock: 11,
} as const;

export type ModuleType = keyof typeof MODULE_TYPE;

// ── Host bridge ────────────────────────────────────────────────────────

const host = (): any => globalThis as any;

const hostAdd = (id: number, mt: number) => host().__audioAddModule?.(id, mt);
const hostRemove = (id: number) => host().__audioRemoveModule?.(id);
const hostConnect = (a: number, ap: number, b: number, bp: number) =>
  host().__audioConnect?.(a, ap, b, bp);
const hostDisconnect = (a: number, ap: number, b: number, bp: number) =>
  host().__audioDisconnect?.(a, ap, b, bp);
const hostSetParam = (id: number, p: number, v: number) => host().__audioSetParam?.(id, p, v);
const hostNoteOn = (id: number, midi: number) => host().__audioNoteOn?.(id, midi);
const hostNoteOff = (id: number) => host().__audioNoteOff?.(id);
const hostMasterGain = (g: number) => host().__audioMasterGain?.(g);

// Master is module id 0 by convention. Module ids are assigned sequentially
// from 1 by the Synth provider as children mount.
const MASTER_ID = 0;

// ── Synth context ─────────────────────────────────────────────────────

interface SynthCtx {
  /** Map of name → module id (assigned at mount). */
  names: Map<string, number>;
  /** Next id to hand out. */
  nextId: { current: number };
  /** Reverse lookup helper. */
  getId(name: string): number | undefined;
}

const SynthContext = React.createContext<SynthCtx | null>(null);

export function useSynth(): {
  getId: (name: string) => number | undefined;
  noteOn: (target: string | number, midi: number) => void;
  noteOff: (target: string | number) => void;
  setParam: (target: string | number, paramIndex: number, value: number) => void;
} {
  const ctx = React.useContext(SynthContext);
  const resolve = (t: string | number): number =>
    typeof t === 'number' ? t : (ctx?.getId(t) ?? -1);
  return {
    getId: (n: string) => ctx?.getId(n),
    noteOn: (t, midi) => { const id = resolve(t); if (id >= 0) hostNoteOn(id, midi); },
    noteOff: (t) => { const id = resolve(t); if (id >= 0) hostNoteOff(id); },
    setParam: (t, p, v) => { const id = resolve(t); if (id >= 0) hostSetParam(id, p, v); },
  };
}

// ── <Synth> provider ──────────────────────────────────────────────────

export function Synth({
  masterGain,
  children,
}: { masterGain?: number; children?: any }): any {
  const namesRef = React.useRef<Map<string, number>>(new Map());
  const nextIdRef = React.useRef({ current: 1 });

  React.useEffect(() => {
    if (typeof masterGain === 'number') hostMasterGain(masterGain);
  }, [masterGain]);

  const ctx: SynthCtx = {
    names: namesRef.current,
    nextId: nextIdRef.current,
    getId: (name) => namesRef.current.get(name),
  };
  return React.createElement(SynthContext.Provider, { value: ctx }, children);
}

// ── Module factory ────────────────────────────────────────────────────
//
// Each typed module wrapper:
//  1. Allocates a stable numeric id on first mount (synth-scoped counter).
//  2. Registers `name → id` in the synth context (if `name` given).
//  3. Calls __audioAddModule(id, type) on mount, __audioRemoveModule(id) on
//     unmount.
//  4. Pushes initial params + reacts to subsequent prop changes.
//  5. If `input` prop is set, wires `getId(input):0 → this:0` after mount.

interface ModuleProps {
  name?: string;
  /** Wire a sibling module's port 0 into this module's port 0. */
  input?: string;
  /** Connect this module's port 0 to master output (module id 0, port 0). */
  toMaster?: boolean;
  /** Per-param-index initial values, indexed by module-type-specific schema. */
  params?: Record<number, number>;
}

function useModule(type: ModuleType, props: ModuleProps): number {
  const ctx = React.useContext(SynthContext);
  const idRef = React.useRef<number>(-1);
  if (idRef.current === -1 && ctx) {
    idRef.current = ctx.nextId.current++;
    if (props.name) ctx.names.set(props.name, idRef.current);
  }
  const id = idRef.current;

  React.useEffect(() => {
    if (id < 0) return;
    hostAdd(id, MODULE_TYPE[type]);
    return () => {
      hostRemove(id);
      if (props.name && ctx) ctx.names.delete(props.name);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Param updates
  React.useEffect(() => {
    if (id < 0 || !props.params) return;
    for (const [k, v] of Object.entries(props.params)) {
      hostSetParam(id, Number(k), v);
    }
  }, [id, props.params]);

  // Wiring: input → this, this → master
  React.useEffect(() => {
    if (id < 0) return;
    let inputId: number | undefined;
    if (props.input && ctx) {
      // Defer one tick so the input module has registered.
      const t = setTimeout(() => {
        inputId = ctx.getId(props.input!);
        if (inputId !== undefined) hostConnect(inputId, 0, id, 0);
      }, 0);
      return () => {
        clearTimeout(t);
        if (inputId !== undefined) hostDisconnect(inputId, 0, id, 0);
      };
    }
  }, [id, props.input]);

  React.useEffect(() => {
    if (id < 0 || !props.toMaster) return;
    hostConnect(id, 0, MASTER_ID, 0);
    return () => hostDisconnect(id, 0, MASTER_ID, 0);
  }, [id, props.toMaster]);

  return id;
}

// ── Per-module-type wrappers ──────────────────────────────────────────
//
// Each renders nothing — they register host commands via effects and live
// purely in the audio domain. Children are not rendered (modules are leaves).

function moduleWrapper(type: ModuleType) {
  return function Module(props: ModuleProps): any {
    useModule(type, props);
    return null;
  };
}

const Oscillator = moduleWrapper('oscillator');
const Filter = moduleWrapper('filter');
const Amplifier = moduleWrapper('amplifier');
const Mixer = moduleWrapper('mixer');
const Delay = moduleWrapper('delay');
const Envelope = moduleWrapper('envelope');
const Lfo = moduleWrapper('lfo');
const Sequencer = moduleWrapper('sequencer');
const Sampler = moduleWrapper('sampler');
const Custom = moduleWrapper('custom');
const Instrument = moduleWrapper('instrument');
const Clock = moduleWrapper('clock');

// ── Explicit <Synth.Wire> for non-port-0 connections ──────────────────

function Wire({
  from,
  to,
  fromPort = 0,
  toPort = 0,
  toMaster,
}: {
  from: string | number;
  to?: string | number;
  fromPort?: number;
  toPort?: number;
  toMaster?: boolean;
}): any {
  const ctx = React.useContext(SynthContext);
  const resolve = (t: string | number): number =>
    typeof t === 'number' ? t : (ctx?.getId(t) ?? -1);
  React.useEffect(() => {
    const a = resolve(from);
    const b = toMaster ? MASTER_ID : resolve(to ?? -1);
    if (a < 0 || b < 0) return;
    hostConnect(a, fromPort, b, toPort);
    return () => hostDisconnect(a, fromPort, b, toPort);
  }, [from, to, fromPort, toPort, toMaster]);
  return null;
}

(Synth as any).Oscillator = Oscillator;
(Synth as any).Filter = Filter;
(Synth as any).Amplifier = Amplifier;
(Synth as any).Mixer = Mixer;
(Synth as any).Delay = Delay;
(Synth as any).Envelope = Envelope;
(Synth as any).Lfo = Lfo;
(Synth as any).Sequencer = Sequencer;
(Synth as any).Sampler = Sampler;
(Synth as any).Custom = Custom;
(Synth as any).Instrument = Instrument;
(Synth as any).Clock = Clock;
(Synth as any).Wire = Wire;
