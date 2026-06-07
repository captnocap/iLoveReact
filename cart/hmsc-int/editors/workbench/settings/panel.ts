// editors/workbench/settings/panel.ts — the SETTINGS source's headless half
// (WBSET9-0606): roster + PanelSpec generation + the rig's data folds. No
// React in here (the characters.test.ts bundling law) — source.tsx adds the
// stage; the P4 suite drives THIS module against a fresh registry.
//
// The protocol is tunablesSource.ts grown to step 9: the panel is GENERATED
// straight from the registry (roster = registered systems, one group per
// owning route, one `num` field per knob carrying the registry's own
// min/max/step/precision), set() now ALSO lands the V20 tuning commit (store),
// and every field carries the reset affordance (census/settings.md C8 — the
// route's ↺-to-default chip, fields.tsx additive `reset` rider).

import type { PanelSpec } from '../../../shell/fields';
import type { TunableEntry } from '../../tunables';
import { busRows, type BusRow } from '../../settings/bus';
import { WORKBENCH_VIEW } from '../livePoll';
import type { SettingsStore } from './store';

export interface SettingsRosterRow { id: string; label: string }

/** gutter 2 — one row per registered system, registration order */
export function settingsRoster(store: SettingsStore): SettingsRosterRow[] {
  return store.systems().map((s) => ({ id: s, label: s }));
}

/** a dotted registry path's table cluster — `cursor.throttleMs` → `cursor`;
 *  dotless leaves (brushDefaultPx) have none and stay under the route header */
function sectionOf(path: string): string | null {
  const dot = path.indexOf('.');
  return dot === -1 ? null : path.slice(0, dot);
}

/** camelCase table key → group title: `edgeSnap` → `EDGE SNAP` */
function sectionTitle(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toUpperCase();
}

/** gutter 3 — the generated spec: num fields + reset, one field per ROW
 *  (SETDENSE-0607, the density verdict: the wrapping 4-across strip collided
 *  34 labels into soup). Groups follow the registry's own structure for free:
 *  the owning route holds the table's top-level knobs, then one group per
 *  dotted-path cluster (`cursor.*`, `lasso.*`, …) — section headers render
 *  only when the cluster exists (the SCULPTKIT conditional-sections law). */
export function settingsPanel(store: SettingsStore, system: string): PanelSpec {
  const entries = store.entries(system);
  type Bucket = { title: string; entries: typeof entries };
  const buckets: Bucket[] = [];
  const bucketFor = (title: string): Bucket => {
    let b = buckets.find((x) => x.title === title);
    if (!b) { b = { title, entries: [] }; buckets.push(b); }
    return b;
  };
  for (const e of entries) {
    const section = sectionOf(e.path);
    bucketFor(section === null ? e.route.toUpperCase() : sectionTitle(section)).entries.push(e);
  }
  return {
    groups: buckets.map((b) => ({
      title: b.title,
      layout: 'rows' as const,
      fields: b.entries.map((e) => ({
        k: e.label,
        t: 'num' as const,
        min: e.min,
        max: e.max,
        step: e.step,
        precision: e.precision,
        get: () => store.read(e.id),
        set: (v: number) => { store.set(e, v); },
        reset: {
          hint: store.formatValue(e.defaultValue, e),
          isDefault: () => store.isDefault(e.id),
          run: () => { store.reset(e); },
        },
      })),
    })),
  };
}

// ── the rig's data folds (column 4 demonstrates — these are its values) ──────

export type KnobBar = {
  label: string;
  value: number;
  shown: string;
  defaultShown: string;
  /** value's position in [min,max] — the bar fill */
  frac: number;
  /** the default's position — the bar's tick mark */
  defaultFrac: number;
  overridden: boolean;
};

/** every knob in the system as a live bar: value vs default, in-range */
export function knobBars(store: SettingsStore, system: string): KnobBar[] {
  return store.entries(system).map((e) => {
    const value = store.read(e.id);
    const span = e.max - e.min;
    const frac = span > 0 ? Math.max(0, Math.min(1, (value - e.min) / span)) : 0;
    const defaultFrac = span > 0 ? Math.max(0, Math.min(1, (e.defaultValue - e.min) / span)) : 0;
    return {
      label: e.label,
      value,
      shown: store.formatValue(value, e),
      defaultShown: store.formatValue(e.defaultValue, e),
      frac,
      defaultFrac,
      overridden: !store.isDefault(e.id),
    };
  });
}

/** the system's recent 'tuning' commits off the session bus, newest first —
 *  turn a knob in gutter 3 and the row lands here (the ACTING loop, visible) */
export function tuningFeed(store: SettingsStore, system: string, cap = WORKBENCH_VIEW.feedRowCap): BusRow[] {
  const state = store.bus();
  if (!state) return [];
  return busRows(state)
    .filter((row) => row.channel === 'tuning' && row.label.startsWith(`${system}.`))
    .slice(0, cap);
}

/** the owning route(s) of a system — the rig caption */
export function systemRoutes(entries: TunableEntry[]): string {
  const routes: string[] = [];
  for (const e of entries) if (!routes.includes(e.route)) routes.push(e.route);
  return routes.join(' · ');
}
