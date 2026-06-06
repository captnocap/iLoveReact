# WBITEMS.CAPTURE.md — item source + voxel SCULPT capture (WBSTEP5-0606)

Scope: additive Workbench source for `/workbench` only. The old `/items` and
`/voxels` routes are untouched and remain live until the flip commit lands on
the user's word.

Coverage law inputs:
- `editors/workbench/census/items.md`
- `editors/workbench/census/voxels.md`

## `/items` capability parity

| census | dying route source | behavior | workbench coverage |
|---|---|---|---|
| C1 | `shell/chrome.tsx:157`; `index.tsx:838`; `index.tsx:930`; `editors/items/ItemsRoute.tsx:497` | route/nav surface | ACCOUNTED by `/workbench` source registration in `editors/workbench/sources.ts`; old route untouched until flip |
| C2 | `editors/items/ItemsRoute.tsx:511`; `:525`; `:264` | item roster, name, save/new/remove | ACCOUNTED by `items/panel.ts` roster/actions and `items/store.ts` item stream save/load/remove |
| C3 | `editors/items/ItemsRoute.tsx:238`; `editors/items/bake.ts:1`; `:86` | import latest voxel blockout and report star-wrap limit | ACCOUNTED by `items/store.ts#importBlockout`, panel action, source action, and source test import coverage |
| C4 | `editors/items/ItemsRoute.tsx:15`; `editors/items/stream.ts:13`; `editors/items/bake.ts:56` | 48x24 grid is the single shape truth | ACCOUNTED by `items/store.ts` draft grid, `items/Stage.tsx` paint/grab paths, and item doc helpers |
| C5 | `editors/items/ItemsRoute.tsx:300`; `:545`; `:569` | raise/carve/flatten/soften/clear/color/brush/strength/depth/radius | ACCOUNTED by `items/panel.ts` controls plus `items/Stage.tsx` depth canvas and store setters |
| C6 | `editors/items/ItemsRoute.tsx:579`; `:588`; `:592`; `:601` | 3D Globe stage with grab grid and LabEnvironment | ACCOUNTED by `items/Stage.tsx` ITEM/SCULPT mesh stages using `Geometry.Globe`, grid shell, and `LabEnvironment` |
| C7 | `editors/items/ItemsRoute.tsx:379`; `:613`; `:624` | orbit/fly/focus/wheel camera | ACCOUNTED by `items/Stage.tsx` item mesh stage via shared `useSculptCamera` on `/workbench/items` |
| C8 | `editors/items/ItemsRoute.tsx:402`; `:411`; `:431`; `:444` | grab-sculpt hover/drag through shared grabKit | ACCOUNTED by `items/Stage.tsx` SCULPT mesh drag path through shared `grabKit` and `ItemStore.setGrid` |
| C9 | `editors/items/ItemsRoute.tsx:199`; `:221`; `:620` | undo/redo buttons/hotkeys | ACCOUNTED by `items/store.ts` shared paint history and Workbench hero actions; hotkey wiring remains route-owned until flip |
| C10 | `editors/items/bake.ts:176`; `editors/workbench/characters/store.ts:45`; `:498`; `WBCHAR.CAPTURE.md:95` | saved sculpted items become game item definitions/character prop options | ACCOUNTED by preserving `itemsStream` and existing character store consumer; item authoring is now covered by `items/store.ts` |

## `/voxels` capability parity

| census | dying route source | behavior | workbench coverage |
|---|---|---|---|
| C1 | `shell/chrome.tsx:159`; `index.tsx:842`; `index.tsx:918`; `VoxelHybridRoute.tsx:601` | route/nav surface | ACCOUNTED by `/workbench` item source VOXEL lens; old route untouched until flip |
| C2 | `VoxelHybridRoute.tsx:107`; `:219`; `:456`; `:546` | W/D/H steppers and derived floor resize | ACCOUNTED by `items/panel.ts` W/D/H fields and `items/store.ts#setVoxelDims` |
| C3 | `VoxelHybridRoute.tsx:236`; `:464`; `:551` | build/mine tools, mine refuses floor, build adds next to face | ACCOUNTED by `items/panel.ts` tool field and `items/store.ts#onVoxelFace`; tested headlessly |
| C4 | `VoxelHybridRoute.tsx:52`; `:59`; `:556` | wall/glass/trim/floor palette, pick switches to Build | ACCOUNTED by `items/panel.ts` kind field and `items/store.ts#setVoxelKind` |
| C5 | `VoxelHybridRoute.tsx:447`; `:497`; `:567` | add preview block when valid | ACCOUNTED by `items/panel.ts` add-preview action and `items/store.ts#addPreviewBlock` |
| C6 | `VoxelHybridRoute.tsx:282`; `:373`; `:390`; `:393` | 3D blocks batched by kind, selection, handles, preview, overlays | ACCOUNTED by `items/Stage.tsx` VOXEL lens Scene3D batching/handles/preview/group overlay |
| C7 | `VoxelHybridRoute.tsx:293`; `:309`; `:340`; `:367` | native orbit camera, wheel zoom, click vs drag | ACCOUNTED by `items/Stage.tsx` VOXEL lens native camera and click/drag split |
| C8 | `VoxelHybridRoute.tsx:570`; `:576` | custom block list/select | ACCOUNTED by Workbench panel values plus `items/store.ts#selectVoxel`; stage shows selected block context |
| C9 | `VoxelHybridRoute.tsx:135`; `:258`; `:451`; `:584` | face groups computed/selectable/highlighted | ACCOUNTED by `items/store.ts#detectVoxelFaceGroups`, panel face group value, and VOXEL stage overlay |
| C10 | `VoxelHybridRoute.tsx:505`; `:551` | clear custom blocks and reset build/face/selection | ACCOUNTED by `items/panel.ts` clear action and `items/store.ts#clearVoxel` |
| C11 | `VoxelHybridRoute.tsx:513`; `:575` | export JSON payload with dims/custom/floor/face groups | ACCOUNTED by `items/store.ts#exportVoxelJson`; tested with injected export door |
| C12 | `editors/voxels/stream.ts:24`; `editors/items/ItemsRoute.tsx:238`; `editors/items/bake.ts:1` | voxel blockout becomes item input through stream and bake | ACCOUNTED by one `ItemStore` owning both streams and `importBlockout` baking current voxel state |

## Test Pins

- `editors/workbench/items/source.test.ts` covers roster/list/load, item
  actions, source lenses, panel groups, voxel dims/build/mine/palette/groups,
  import, empty import, undo, export, and item document round-trip.

## Remaining Flip Work

- `/items` and `/voxels` route files and chrome nav entries die only in the
  later flip commit after the user passes the workbench source by hand.
- Route-local hotkeys remain on old routes until the flip; Workbench exposes
  undo/redo as source actions today.
