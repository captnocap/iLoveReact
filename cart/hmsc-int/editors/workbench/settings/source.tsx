// editors/workbench/settings/source.tsx — the SETTINGS WorkbenchSource
// (WBSET9-0606, WORKBENCH.md §6 step 9). tunablesSource grown to the full
// settings category: roster = every registered system (the 7 live clusters
// incl. the camera-feel cluster), panel GENERATED from the registry with
// write-through + V20 tuning commits + per-knob reset, and column 4
// demonstrates by ACTING (rigs.tsx). The /settings route stays untouched
// until the flip — same registry, same values, additive.

import type { WorkbenchSource, RosterRow } from '../../../shell/Workbench';
import type { PanelSpec } from '../../../shell/fields';
import { subscribeLiveDoors } from '../livePoll';
import { settingsPanel, settingsRoster } from './panel';
import { settingsWorkbenchStore } from './live';
import { SettingsRig } from './rigs';

export function settingsSource(): WorkbenchSource<string> {
  const store = settingsWorkbenchStore();
  return {
    id: 'settings',
    icon: 'Settings',
    kicker: 'SETTINGS',

    list: (): RosterRow[] => settingsRoster(store),
    select: (rowId: string): string => rowId,
    panel: (system: string): PanelSpec => settingsPanel(store, system),

    // column 4 demonstrates (LAW 1): the camera-feel rig for the
    // sculpt-camera cluster, the live dashboard for every other system
    stage: (system: string) => <SettingsRig store={store} system={system} />,

    // knobs can move underneath us (the /settings route, console verbs,
    // another session's tuning commits) — the live doors tick re-reads
    subscribe: (fn: () => void) => subscribeLiveDoors(fn),
  };
}
