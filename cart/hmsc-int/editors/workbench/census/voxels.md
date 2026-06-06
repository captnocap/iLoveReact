# CENSUS — /voxels (e2e walked 2026-06-06, session CENSUS-ITEMS-0606-voxels)
Status today: Voxel blockout is the route for quickly authoring a 1m-cube block shape that /items can import and smooth into a sculpted prop. The route is live, renders the blockout in a native Scene3D stage, and the cleaned witness pass drove 28/28 reachable controls; UNPLANNED rows: none found. Its authored stream persistence is intended but not live-proven today because the shared route session stream has an existing corrupt record.

## Capabilities (e2e-walked, line-referenced)
| id | what it does (user-visible behavior) | how (control/hotkey/gesture) | code | persistence | workbench accounting |
| C1 | Route mounts as a full shell overlay; boxes nav opens it and `Back` returns to the editor. | Chrome voxel-bake nav, `/voxels`, `Back` | cart/hmsc-int/shell/chrome.tsx:159; cart/hmsc-int/index.tsx:842; cart/hmsc-int/index.tsx:918; cart/hmsc-int/VoxelHybridRoute.tsx:601 | Route path hot state; no authored data | PENDING workbench step 5 itemsSource (ledger says kills /voxels; V24 says voxel remains alternate) |
| C2 | Declared blockout dimensions W/D/H can be stepped from the left panel; the derived locked floor resizes with dims. | W/D/H minus/plus steppers | cart/hmsc-int/VoxelHybridRoute.tsx:107; cart/hmsc-int/VoxelHybridRoute.tsx:219; cart/hmsc-int/VoxelHybridRoute.tsx:456; cart/hmsc-int/VoxelHybridRoute.tsx:546 | Intended `voxels` stream doc; live autosave blocked by session error | PENDING step 5 |
| C3 | Build and Mine are explicit tools; Mine refuses the locked floor and Build adds next to the selected face. | `Build`, `Mine`, scene face click | cart/hmsc-int/VoxelHybridRoute.tsx:236; cart/hmsc-int/VoxelHybridRoute.tsx:464; cart/hmsc-int/VoxelHybridRoute.tsx:551 | `tool`, `activeFace`, `selectedId` twigs; authored blocks intended in `voxels` stream | PENDING step 5 |
| C4 | Palette chooses user block kind: Wall, Glass, Trim, Floor; choosing a kind switches tool back to Build. | Palette chips | cart/hmsc-int/VoxelHybridRoute.tsx:52; cart/hmsc-int/VoxelHybridRoute.tsx:59; cart/hmsc-int/VoxelHybridRoute.tsx:556 | `activeKind` twig persisted | PENDING step 5 |
| C5 | Add preview block creates a custom block at the preview position when valid. | `Add preview block` | cart/hmsc-int/VoxelHybridRoute.tsx:447; cart/hmsc-int/VoxelHybridRoute.tsx:497; cart/hmsc-int/VoxelHybridRoute.tsx:567 | Intended `voxels` stream; live block did not survive return because session persistence was blocked | PENDING step 5 |
| C6 | 3D scene renders blocks batched by kind with selection box, face handles, build preview, and face-group overlay. | View/click 3D scene; face handles visible | cart/hmsc-int/VoxelHybridRoute.tsx:282; cart/hmsc-int/VoxelHybridRoute.tsx:373; cart/hmsc-int/VoxelHybridRoute.tsx:390; cart/hmsc-int/VoxelHybridRoute.tsx:393 | Scene state from React + route twigs; authored block state intended in stream | PENDING step 5 |
| C7 | Scene camera uses native orbit control and supports wheel zoom; click without drag selects/builds/mines a face, drag orbits. | Wheel over scene, scene click; drag is code path | cart/hmsc-int/VoxelHybridRoute.tsx:293; cart/hmsc-int/VoxelHybridRoute.tsx:309; cart/hmsc-int/VoxelHybridRoute.tsx:340; cart/hmsc-int/VoxelHybridRoute.tsx:367 | Camera look/dist refs are in-memory only; selected/tool twigs persist | PENDING step 5 |
| C8 | Right Blocks list shows custom block count and selectable custom blocks. | `#1001` / `#1002` block rows after build | cart/hmsc-int/VoxelHybridRoute.tsx:570; cart/hmsc-int/VoxelHybridRoute.tsx:576 | Custom block docs intended in `voxels` stream | PENDING step 5 |
| C9 | Face groups are computed from exposed faces and selectable in the right panel; selection highlights the grouped face overlay. | Face-group rows | cart/hmsc-int/VoxelHybridRoute.tsx:135; cart/hmsc-int/VoxelHybridRoute.tsx:258; cart/hmsc-int/VoxelHybridRoute.tsx:451; cart/hmsc-int/VoxelHybridRoute.tsx:584 | `selectedGroupId` twig survived return selfshot | PENDING step 5 |
| C10 | Clear removes all custom blocks, resets selected face/tool to build, and leaves only the derived floor. | `Clear` | cart/hmsc-int/VoxelHybridRoute.tsx:505; cart/hmsc-int/VoxelHybridRoute.tsx:551 | Intended `voxels` stream after debounce; live stream blocked | PENDING step 5 |
| C11 | Export writes a JSON blockout payload with dims, custom blocks, artificial floor, and face group metadata. | `Export JSON` | cart/hmsc-int/VoxelHybridRoute.tsx:513; cart/hmsc-int/VoxelHybridRoute.tsx:575 | Writes `cart/hmsc-int/exports/voxel-blockout.json` directly | PENDING step 5; not clicked due touch-only-census-files constraint |
| C12 | /items consumes this route as item input by reading the latest `voxels` stream doc and baking it to a Globe-wrap sculpt grid. | Build/save blockout here, then `/items` import | cart/hmsc-int/editors/voxels/stream.ts:24; cart/hmsc-int/editors/items/ItemsRoute.tsx:238; cart/hmsc-int/editors/items/bake.ts:1 | `voxels` stream snapshot/state -> /items import | PENDING step 5 items/voxel sculpt unification |

## Hotkey inventory
- No route-local hotkeys found in `VoxelHybridRoute.tsx`.
- Mouse/wheel gestures: click face selects/builds/mines; drag orbits; wheel zooms.

## Persistence inventory (what survives reload, via what)
- Route twigs survived fresh process return in `cart/hmsc-int/sessions/_route-twigs.json`: `/voxels` stored `selectedId`, `tool`, `activeKind`, `activeFace`, and `selectedGroupId`.
- Authored blockout persistence is intended through `voxels` stream `{kind: 'authored', doc}` events and `voxels.snapshot.json`; current snapshot is `doc: null` because the live route session could not open against the corrupt sessions stream.
- Export persistence is a direct file write to `cart/hmsc-int/exports/voxel-blockout.json`, separate from the stream path and separate from what /items imports.

## Oddities/bugs found while walking (report, do not fix)
- The shared sessions corruption at `cart/hmsc-int/data/streams/sessions.jsonl:884` blocks live session-backed autosave for this route too, but /voxels does not surface an explicit save-unavailable warning like /items.
- `Export JSON` writes to a non-ignored repo path; census constraints said touch only assigned census files, so it was source-verified but not clicked.
- The headless witness can click and wheel but cannot perform a real drag orbit, so drag-only camera motion was not live-driven.
- The host prints an existing crash/watchdog trailer after some successful autotest exits even when the manifest result is PASS.

## Unverified-live rows (code says it exists, could not trigger; why)
- `Export JSON`: not clicked because it would create `cart/hmsc-int/exports/voxel-blockout.json`, outside the assigned census files and not ignored.
- Real drag orbit: witness lacks a drag primitive; wheel zoom and click-select/build/mine were driven.
- Stream autosave survival: session open is blocked by the corrupt sessions record; route twigs did survive return, authored blockout stream did not.
