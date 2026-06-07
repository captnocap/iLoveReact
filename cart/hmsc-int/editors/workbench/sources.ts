// editors/workbench/sources.ts — the WorkbenchSource registry (WORKBENCH.md §6).
//
// The migration ledger in code: each step lands a source here, and when it
// reaches parity its old route flips off in the same commit. Order (per the
// plan): characters → items (voxel SCULPT) → vehicles → materials (shader lab
// + compose + Materialize) → settings domains + logs. `tunables` is the
// scaffold's proof source — the panel-from-registry protocol, live today.

import type { WorkbenchSource } from '../../shell/Workbench';
import { charactersSource } from './characters/source';
import { animationSource } from './characters/animationSource';
import { paintSource } from './paint/source';
import { itemsSource } from './items/source';
import { vehiclesSource } from './vehicles/source';
import { materialsSource } from './materials/source';
import { buildingsSource } from './buildings/source';
import { settingsSource } from './settings/source';
import { logsSource } from './logs/source';
import { requestsSource } from './requests/source';
import { garmentsSource } from './clothing/source';

export function workbenchSources(): Array<WorkbenchSource<any>> {
  return [
    charactersSource(), // WBCHAR-0606 — the MESH context (/characters DEAD — user-ordered kill)
    garmentsSource(),   // CLOTHFLIP-0607 (req_0234) — THE clothing authority: items alone + the variant grid + the painter design spine; the cosplay clothing context is DEAD (user verdict; outfit/props are character/play domain)
    animationSource(),  // CLOTHSPLIT-0606 phase 2 — the rig/posing context (USER RULING req_0040)
    paintSource(),      // AGNOSTICPAINT-0606 — THE agnostic painting surface (/cutout DEAD — CUTOUTFLIP-0606)
    itemsSource(),      // WBSTEP5-0606 — item source + ruled-in voxel SCULPT mode (/items + /voxels DEAD — WBITEMS-FLIP-0606)
    vehiclesSource(),   // WBSTEP6-0606 — vehicle source (/vehicles DEAD — WBSTEP6-FLIP-0606)
    materialsSource(),  // WBSTEP7-0606 — material source (/textures + /compose DEAD — WBMATERIALS-FLIP-0607)
    buildingsSource(),  // BUILDSKIN-0606 — prefab-buildings: per-type global skins + per-piece/per-face overrides (skins ARE materials), live structure edits
    settingsSource(),   // WBSET9-0606 — settings domains + rigs; the tunables proof source FOLDED IN (/settings DEAD — WBSTEP9-FLIP-0607)
    logsSource(),       // WBSET9-0606 — churn tail + session event bus as one streaming category (/log DEAD — WBSTEP9-FLIP-0607)
    requestsSource(),   // REQPANEL-0606 — the request ledger: what is left unresolved, click it done (same resolveRequest door as tools/request)
  ];
}
