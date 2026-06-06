// editors/workbench/sources.ts — the WorkbenchSource registry (WORKBENCH.md §6).
//
// The migration ledger in code: each step lands a source here, and when it
// reaches parity its old route flips off in the same commit. Order (per the
// plan): characters → items (voxel SCULPT) → vehicles → materials (shader lab
// + compose + Materialize) → settings domains + logs. `tunables` is the
// scaffold's proof source — the panel-from-registry protocol, live today.

import type { WorkbenchSource } from '../../shell/Workbench';
import { tunablesSource } from './tunablesSource';

export function workbenchSources(): Array<WorkbenchSource<any>> {
  return [
    tunablesSource(),
    // charactersSource(),   — step 4 (kills /characters)
    // itemsSource(),        — step 5 (kills /items, /voxels)
    // vehiclesSource(),     — step 6 (kills /vehicles)
    // materialsSource(),    — step 7 (kills /textures, /compose)
    // settings domains + logs — step 9 (kills /settings, /log; tunables folds in)
  ];
}
