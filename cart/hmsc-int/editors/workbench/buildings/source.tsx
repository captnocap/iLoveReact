// editors/workbench/buildings/source.tsx — the BUILDING WorkbenchSource
// (BUILDSKIN-0606). A saved prefab IS a building type: the roster lists every
// prefab-building with its piece count; gutter 3 carries the generated skin
// panel (type globals + the selected piece's overrides + structure verbs);
// column 4 renders the building live from the resolved skins. Persistence is
// the V20 world stream (`prefabDefined` commits) — buildings stay live
// editable structures, never baked.

import type { WorkbenchSource } from '../../../shell/Workbench';
import { subscribeLiveDoors } from '../livePoll';
import { buildingsActions, buildingsPanel, buildingsRoster } from './panel';
import { buildingsWorkbenchStore } from './live';
import { BuildingStage } from './Stage';

export function buildingsSource(): WorkbenchSource<string> {
  const store = buildingsWorkbenchStore();
  return {
    id: 'building',
    icon: 'Building2',
    kicker: 'BUILDINGS',

    list: () => buildingsRoster(store),
    select: (rowId: string): string => rowId,
    panel: (id: string) => buildingsPanel(store, id),
    actions: (id: string) => buildingsActions(store, id),

    // column 4 demonstrates (LAW 1): the resolved skins, rendered
    stage: (id: string) => <BuildingStage store={store} buildingId={id} />,

    // stage picks + commits tick the store; another session's world commits
    // arrive through the shared live-doors poll
    subscribe: (fn: () => void) => {
      const offStore = store.subscribe(fn);
      const offDoors = subscribeLiveDoors(fn);
      return () => { offStore(); offDoors(); };
    },
  };
}
