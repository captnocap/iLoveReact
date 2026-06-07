# PORTED.md — flat route status (easy-read view)

Derived from the WORKBENCH.md route census. The supervisor keeps this current;
every flip commit that deletes a route updates its row here.
Last updated: 2026-06-07 (post vehicles flip).

## DEAD — ported to the workbench, route deleted

| old route | replaced by | died in |
|---|---|---|
| /characters | CHARACTER source (FIGURE/PART grab-sculpt, SCULPT, PAINT lens) | user-ordered kill |
| /items | ITEM source — ITEM lens | dd3b11817 + 11f7b54de |
| /voxels | ITEM source — SCULPT/VOXEL lenses (voxel→item import via Globe bake) | 11f7b54de |
| /vehicles | VEHICLE source — garage authoring, 3D preview, shared PAINT lens | WBSTEP6-FLIP-0606 |

## DYING — ported, deletion commit in flight

| old route | replaced by | gate |
|---|---|---|
| /cutout | AGNOSTIC PAINT surface (+ EffectModal extraction) | flip commit pending bench-crash repair |

## LIVE — not yet ported (this is the remaining bloat)

| old route | workbench step | state |
|---|---|---|
| /textures | step 7 — material source (PREVIEW / SHADER LAB / COMPOSE) | queued |
| /compose | step 7 — material source | queued (18 rows, biggest) |
| /settings | step 9 — settings source (tunables-generated) | built; density respec pending; flip after |
| /log | step 9 — logs source (stream + dashboard band) | in step-9 scope |

## STAYS — own route by ruling

| route | why |
|---|---|
| /assist3d | all 17 capabilities ACCOUNTED-AS-OWN; fold into labs is a later, non-blocking question |

## THE END STATE

All LIVE rows reach DEAD → chrome collapses 13→6 icons → `cart/hmsc-wire/` deleted (step 10).
Nothing is hidden or flagged off — a ported route is a deleted route.
