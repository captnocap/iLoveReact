// editors/workbench/settings/store.ts — the SETTINGS source's headless store
// (WBSET9-0606, WORKBENCH.md §6 step 9).
//
// The fold of /settings' write half: every knob edit goes through the P2
// registry (write/reset clamp + write THROUGH the owning module's live
// table) and lands a commit on the V20 'tuning' channel with the exact
// label shape SettingsRoute.tsx:120-135 mints — so a workbench knob turn
// shows up in the session bus beside everyone else's interactions and
// persists across boots through the same tuning snapshot. No second write
// path, no second event system.
//
// Deps are injected (the createCharacterStore discipline) so the P4 suite
// drives a fresh createTunables() + a fake session with zero host wiring;
// live.ts builds the singleton over editorTunables()/editorSessions().

import type { SessionsState } from '../../sessions';
import type { Tunables, TunableEntry, TuningEvent } from '../../tunables';
import { GAME_CHROME } from '../../../game/chrome';

export type SettingsSession = {
  commit(event: TuningEvent, label: string): void;
};

export type SettingsStoreDeps = {
  tunables: Tunables;
  /** the '/workbench' session on the 'tuning' channel; null = store down */
  session: SettingsSession | null;
  /** why the session is down (the census C3 store-unavailable parity) */
  error: string | null;
  /** the sessions fold for the rig's tuning feed; null when the store is down */
  bus: () => SessionsState | null;
};

export type SettingsStore = {
  /** registered systems, registration order — the roster */
  systems(): string[];
  /** a system's entries, registration order */
  entries(system: string): TunableEntry[];
  /** clamp + write through + commit (route label parity); returns applied */
  set(entry: TunableEntry, value: number): number;
  /** back to the registration default + commit; returns the default */
  reset(entry: TunableEntry): number;
  read(id: string): number;
  isDefault(id: string): boolean;
  /** non-default knobs in a system (the rig's OVERRIDDEN stat) */
  overriddenCount(system: string): number;
  knobCount(system?: string): number;
  formatValue(value: number, entry: TunableEntry): string;
  error(): string | null;
  bus(): SessionsState | null;
};

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStore {
  const t = deps.tunables;

  const entries = (system: string): TunableEntry[] =>
    t.list().filter((e) => e.system === system);

  const formatValue = (value: number, entry: TunableEntry): string =>
    GAME_CHROME.formatKnobValue(value, entry);

  return {
    systems(): string[] {
      const seen: string[] = [];
      for (const e of t.list()) if (!seen.includes(e.system)) seen.push(e.system);
      return seen;
    },
    entries,
    set(entry: TunableEntry, value: number): number {
      const applied = t.write(entry.id, value);
      deps.session?.commit(
        { kind: 'set', id: entry.id, value: applied },
        `${entry.id} → ${formatValue(applied, entry)}`,
      );
      return applied;
    },
    reset(entry: TunableEntry): number {
      const value = t.reset(entry.id);
      deps.session?.commit(
        { kind: 'reset', id: entry.id },
        `${entry.id} → default (${formatValue(value, entry)})`,
      );
      return value;
    },
    read: (id) => t.read(id),
    isDefault: (id) => t.isDefault(id),
    overriddenCount: (system) => entries(system).filter((e) => !t.isDefault(e.id)).length,
    knobCount: (system) => (system ? entries(system).length : t.list().length),
    formatValue,
    error: () => deps.error,
    bus: () => deps.bus(),
  };
}
