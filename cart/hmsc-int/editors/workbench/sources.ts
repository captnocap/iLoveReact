// editors/workbench/sources.ts — the WorkbenchSource registry (WORKBENCH.md §6).
//
// The migration ledger in code: each step lands a source here, and when it
// reaches parity its old route flips off in the same commit. Order (per the
// plan): characters → items (voxel SCULPT) → vehicles → materials (shader lab
// + compose + Materialize) → settings domains + logs. `tunables` is the
// scaffold's proof source — the panel-from-registry protocol, live today.

import type { WorkbenchSource } from '../../shell/Workbench';
import { tunablesSource } from './tunablesSource';
import { charactersSource } from './characters/source';
import { paintSource } from './paint/source';

export function workbenchSources(): Array<WorkbenchSource<any>> {
  return [
    charactersSource(), // WBCHAR-0606 — the pattern-setter (flip of /characters awaits the user's word)
    paintSource(),      // AGNOSTICPAINT-0606 — THE agnostic painting surface (flip of /cutout awaits the user's pass)
    tunablesSource(),
    // itemsSource(),        — step 5 (kills /items, /voxels)
    // vehiclesSource(),     — step 6 (kills /vehicles)
    // materialsSource(),    — step 7 (kills /textures, /compose; the bench already fronts material painting)
    // settings domains + logs — step 9 (kills /settings, /log; tunables folds in)
  ];
}
