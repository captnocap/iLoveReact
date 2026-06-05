// editors/tunables.ts — THE P2 tunables registry (SETTINGS-0605, ruled).
//
// P2, verbatim: "Every number, value, name — all of it — arrives at an
// interface (the internal tool) where it can be changed at any time →
// compile and go. ... A constant buried in code that affects game behavior
// is a bug per this principle." And the user's settings ruling: "we need to
// get all those magic numbers into some route for interfacing with."
//
// This is that interface's data layer. The shape:
//   - REGISTRATION HAPPENS WHERE THE NUMBER LIVES. A tuning module keeps its
//     named table (the P2 cluster it already has) and registers each numeric
//     leaf here by dotted path — id, label, min/max/step/precision — at
//     module scope. The table stays the one consumers read; the registry
//     holds a live reference and writes THROUGH it, so a knob edit lands in
//     the very value the route's code reads next frame. No second copy.
//   - /settings only READS the registry (list + read/write/reset doors).
//     Nothing here imports a route; routes import this.
//   - Persistence is the V20 'tuning' stream (STRUCTURE.md already names it
//     in the streams enumeration): an edit is a {set,id,value} event, reset
//     removes the override, the materialized state is the override map.
//     applyOverrides() folds that map back over the registered defaults at
//     boot — registered-later tunables pick their override up at
//     registration (pending map), so stream order never races module order.
//
// createTunables() is the testable door (the createSessionLog split);
// editorTunables() is the live in-memory singleton. The singleton touches no
// host bindings — registration at module import stays safe under any test.

import type { StreamDef } from '../data';

/** KnobSpec-shaped on purpose: an entry feeds GAME_CHROME.Knob unchanged. */
export type TunableSpec = {
  label: string;
  min: number;
  max: number;
  step: number;
  precision: number;
};

export type TunableEntry = {
  /** `${system}.${path}` — the stable key tuning events carry */
  id: string;
  /** the owning P2 cluster (group header on /settings), kebab-case */
  system: string;
  /** the route/module the number lives in — display + filtering only */
  route: string;
  /** dotted path into the registered table */
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
  precision: number;
  /** the table's value at registration — what reset returns to */
  defaultValue: number;
};

export type TunableGroup = {
  /** kebab-case cluster name; one register() call per table */
  system: string;
  /** where the numbers live, e.g. '/cutout' or 'editors/paint' */
  route: string;
  /** the LIVE tuning table (not frozen — the registry writes through it) */
  table: Record<string, any>;
  /** dotted path → knob spec, one per numeric leaf exposed */
  specs: Record<string, TunableSpec>;
};

export type Tunables = {
  /** register a tuning table's numeric leaves; throws on spec/table drift */
  register: (group: TunableGroup) => void;
  /** every registered entry, registration order (group by system yourself) */
  list: () => TunableEntry[];
  /** current live value */
  read: (id: string) => number;
  /** clamp to [min,max], write through to the live table, return applied */
  write: (id: string, value: number) => number;
  /** back to the registration default; returns it */
  reset: (id: string) => number;
  isDefault: (id: string) => boolean;
  /** fold persisted overrides (the tuning snapshot) over the defaults;
   *  unknown ids wait for their registration instead of erroring (V20:
   *  old streams stay valid when a knob is renamed away) */
  applyOverrides: (overrides: Record<string, number>) => void;
  /** bumps on register/write/reset/applyOverrides — the page's poll signal */
  revision: () => number;
};

const SYSTEM_SHAPE = /^[a-z][a-z0-9-]*$/;

function readPath(table: Record<string, any>, path: string): unknown {
  let node: any = table;
  for (const key of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

function writePath(table: Record<string, any>, path: string, value: number): void {
  const keys = path.split('.');
  let node: any = table;
  for (let i = 0; i < keys.length - 1; i += 1) node = node[keys[i]];
  node[keys[keys.length - 1]] = value;
}

export function createTunables(): Tunables {
  type Live = { entry: TunableEntry; table: Record<string, any> };
  const byId = new Map<string, Live>();
  const order: string[] = [];
  /** overrides that arrived before their tunable registered */
  const pending = new Map<string, number>();
  let revision = 0;

  const clamp = (entry: TunableEntry, value: number): number =>
    Math.max(entry.min, Math.min(entry.max, value));

  const must = (id: string): Live => {
    const live = byId.get(id);
    if (!live) throw new Error(`tunables: unknown id "${id}"`);
    return live;
  };

  const write = (id: string, value: number): number => {
    const live = must(id);
    if (!Number.isFinite(value)) throw new Error(`tunables: ${id} ← non-finite value`);
    const applied = clamp(live.entry, value);
    writePath(live.table, live.entry.path, applied);
    revision += 1;
    return applied;
  };

  return {
    register: (group: TunableGroup): void => {
      // The boundary is strict so spec/table drift dies at module import,
      // not as a silent wrong knob on the settings page (P3).
      if (!group || !SYSTEM_SHAPE.test(group.system ?? '')) {
        throw new Error(`tunables: system must be kebab-case (got ${JSON.stringify(group?.system)})`);
      }
      if (typeof group.route !== 'string' || group.route === '') {
        throw new Error(`tunables: register("${group.system}") needs the owning route`);
      }
      if (group.table == null || typeof group.table !== 'object') {
        throw new Error(`tunables: register("${group.system}") needs the live table`);
      }
      for (const [path, spec] of Object.entries(group.specs)) {
        const id = `${group.system}.${path}`;
        if (byId.has(id)) throw new Error(`tunables: "${id}" is already registered`);
        const value = readPath(group.table, path);
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(`tunables: "${id}" does not resolve to a number in its table`);
        }
        if (!(spec.min < spec.max) || !(spec.step > 0)) {
          throw new Error(`tunables: "${id}" spec is malformed (min<max, step>0 required)`);
        }
        if (value < spec.min || value > spec.max) {
          throw new Error(`tunables: "${id}" default ${value} is outside [${spec.min}, ${spec.max}]`);
        }
        const entry: TunableEntry = {
          id, system: group.system, route: group.route, path,
          label: spec.label, min: spec.min, max: spec.max, step: spec.step,
          precision: spec.precision, defaultValue: value,
        };
        byId.set(id, { entry, table: group.table });
        order.push(id);
        revision += 1;
        const held = pending.get(id);
        if (held !== undefined) {
          pending.delete(id);
          write(id, held);
        }
      }
    },
    list: () => order.map((id) => byId.get(id)!.entry),
    read: (id) => {
      const live = must(id);
      return readPath(live.table, live.entry.path) as number;
    },
    write,
    reset: (id) => write(id, must(id).entry.defaultValue),
    isDefault: (id) => {
      const live = must(id);
      return (readPath(live.table, live.entry.path) as number) === live.entry.defaultValue;
    },
    applyOverrides: (overrides) => {
      for (const [id, value] of Object.entries(overrides ?? {})) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue; // tolerate stream noise
        if (byId.has(id)) write(id, value);
        else { pending.set(id, value); revision += 1; }
      }
    },
    revision: () => revision,
  };
}

// ── the V20 'tuning' concern ─────────────────────────────────────────────────
// One event per knob edit; the materialized state is the override map the
// boot fold (applyOverrides) consumes. Reset REMOVES the override — a reset
// knob follows its code default again, including when the default changes.

export type TuningEvent =
  | { kind: 'set'; id: string; value: number }
  | { kind: 'reset'; id: string };

export type TuningState = { overrides: Record<string, number> };

export const tuningStream: StreamDef<TuningState, TuningEvent> = Object.freeze({
  name: 'tuning',
  initial: (): TuningState => ({ overrides: {} }),
  apply: (state: TuningState, event: TuningEvent): TuningState => {
    switch (event?.kind) {
      case 'set': {
        if (typeof event.id !== 'string' || typeof event.value !== 'number') return state;
        return { overrides: { ...state.overrides, [event.id]: event.value } };
      }
      case 'reset': {
        if (!(event.id in state.overrides)) return state;
        const overrides = { ...state.overrides };
        delete overrides[event.id];
        return { overrides };
      }
      default:
        // Unknown kinds from the future pass through (V20 addition law).
        return state;
    }
  },
});

let live: Tunables | null = null;

/** The LIVE registry every tuning module registers into at import. Pure
 *  in-memory — safe under tests and headless runs (no host bindings). */
export function editorTunables(): Tunables {
  if (!live) live = createTunables();
  return live;
}
