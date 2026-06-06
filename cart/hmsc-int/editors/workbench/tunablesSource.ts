// editors/workbench/tunablesSource.ts — the first WorkbenchSource: the P2
// tunables registry as a workbench category (WORKBENCH.md §6, the scaffold's
// proof source).
//
// This is the protocol demonstration: the source generates its PanelSpec
// STRAIGHT from editorTunables() — roster = registered systems, one group per
// owning route, one `num` field per knob carrying the registry's own
// min/max/step/precision, set() = tunables.write() (live write-through to the
// running editor, the same wire /settings turns). Zero layout code. When the
// settings flip lands (step 9) this source grows rigs + the V20 tuning-stream
// commits; until then it coexists with /settings — same registry, same
// values, additive.
//
// Subject = the system name (string). No JSX in here — stages are built in
// shell/ or returned null (the frame shows EmptyStage).

import { editorTunables } from '../tunables';
import type { WorkbenchSource, RosterRow } from '../../shell/Workbench';
import type { PanelSpec } from '../../shell/fields';

export function tunablesSource(): WorkbenchSource<string> {
  const t = editorTunables();
  return {
    id: 'tunables',
    icon: 'SlidersHorizontal',
    kicker: 'TUNABLES',

    list(): RosterRow[] {
      const systems: string[] = [];
      for (const e of t.list()) if (!systems.includes(e.system)) systems.push(e.system);
      return systems.map((s) => ({ id: s, label: s }));
    },

    select(rowId: string): string {
      return rowId;
    },

    panel(system: string): PanelSpec {
      const entries = t.list().filter((e) => e.system === system);
      // group by owning route (usually one per system; keeps mixed tables honest)
      const routes: string[] = [];
      for (const e of entries) if (!routes.includes(e.route)) routes.push(e.route);
      return {
        groups: routes.map((route) => ({
          title: route.toUpperCase(),
          fields: entries
            .filter((e) => e.route === route)
            .map((e) => ({
              k: e.label,
              t: 'num' as const,
              min: e.min,
              max: e.max,
              step: e.step,
              precision: e.precision,
              get: () => t.read(e.id),
              set: (v: number) => { t.write(e.id, v); },
            })),
        })),
      };
    },

    // rigs land with the settings flip; the frame's EmptyStage covers until then
    stage(): null {
      return null;
    },
  };
}
