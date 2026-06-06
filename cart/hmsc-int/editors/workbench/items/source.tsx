// editors/workbench/items/source.tsx -- ITEM WorkbenchSource wrapper.

import type { WorkbenchSource } from '../../../shell/Workbench';
import { itemSourceCore } from './panel';
import type { ItemLens, ItemStore } from './store';
import { ItemStage } from './Stage';

export { itemPanel, ITEM_LENSES } from './panel';

export function itemsSource(store?: ItemStore): WorkbenchSource<ItemStore> {
  const core = itemSourceCore(store);
  return {
    ...core,
    stage: (subject, lens) => <ItemStage store={subject} lens={lens as ItemLens} />,
  };
}
