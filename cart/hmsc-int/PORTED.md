# PORTED.md — flat route status (easy-read view)

Derived from the WORKBENCH.md route census. The supervisor keeps this current;
every flip commit that deletes a route updates its row here.
Last updated: 2026-06-07 (STEP10-COLLAPSE-0607 — THE FOLD IS COMPLETE).

## DEAD — ported to the workbench, route deleted

| old route | replaced by | died in |
|---|---|---|
| /characters | CHARACTER source (FIGURE/PART grab-sculpt, SCULPT, PAINT lens) | user-ordered kill (mount died then; the route FILE's orphan deletion landed in STEP10-COLLAPSE-0607) |
| clothing source (in-workbench cosplay surface — never a route; OUTFIT/EXTRAS/PROP over the dressed figure) | GARMENT source (`editors/workbench/clothing/` — items alone, variant grid, painter design spine) | CLOTHFLIP-0607 (req_0234, user verdict “not this shit where its asking me about a prop”) |
| /items | ITEM source — ITEM lens | dd3b11817 + 11f7b54de |
| /voxels | ITEM source — SCULPT/VOXEL lenses (voxel→item import via Globe bake) | 11f7b54de |
| /vehicles | VEHICLE source — garage authoring, 3D preview, shared PAINT lens | WBSTEP6-FLIP-0606 |
| /textures | MATERIAL source — PREVIEW / SHADER LAB / COMPOSE | WBMATERIALS-FLIP-0607 |
| /compose | MATERIAL source — COMPOSE stage mode | WBMATERIALS-FLIP-0607 |
| /settings | SETTINGS source — domains generated from the tunables registry + rigs (`SettingsRoute.tsx` + `tunablesSource.ts` deleted; `bus.ts`/`tunables.ts` stay as backing stores) | WBSTEP9-FLIP-0607 (parity supervisor-pre-verified 9/9) |
| /log | LOGS source — churn tail + session bus as one streaming category (`LogView.tsx` deleted; the perfLog ring stays) | WBSTEP9-FLIP-0607 (parity supervisor-pre-verified 7/7) |
| /cutout | AGNOSTIC PAINT surface (+ EffectModal extraction; shared `editors/cutout/` internals stay as bench modules) | CUTOUTFLIP-0606 (`12d36473c`) — row was stale in DYING; route file confirmed gone at HEAD, fixed in the step-10 audit |

## DYING — ported, deletion commit in flight

| old route | replaced by | gate |
|---|---|---|
| *(none)* | | |

## LIVE — not yet ported (this is the remaining bloat)

| old route | workbench step | state |
|---|---|---|
| *(none — every LIVE row has flipped)* | | |

## STAYS — own route by ruling

| route | why |
|---|---|
| /assist3d | all 17 capabilities ACCOUNTED-AS-OWN; fold into labs is a later, non-blocking question |

## THE END STATE — REACHED (STEP10-COLLAPSE-0607)

All LIVE rows reached DEAD → the chrome collapsed 13→6 icons (editor · play ·
labs · assets · settings · assist3d; assets + settings are two doors into
/workbench via `shell/workbenchDoor.ts`) → `cart/hmsc-wire/` deleted.
Nothing is hidden or flagged off — a ported route is a deleted route.
