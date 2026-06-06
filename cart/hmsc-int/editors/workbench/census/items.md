# CENSUS — /items (e2e walked 2026-06-06, session CENSUS-ITEMS-0606-items)
Status today: Item sculpt is a two-pane authoring route for making game props: start from a blank Globe item or import the latest /voxels blockout, then edit one 48x24 signed displacement grid through 2D depth paint and 3D grab controls. The route is visibly live and the cleaned witness pass drove 40/40 reachable controls; UNPLANNED rows: none found. The live save/remove/autosave path is blocked today by the existing ignored sessions stream corrupt record, so stream persistence is code-accounted but not live-proven.

## Capabilities (e2e-walked, line-referenced)
| id | what it does (user-visible behavior) | how (control/hotkey/gesture) | code | persistence | workbench accounting |
| C1 | Route mounts as a full shell overlay while persistent chrome stays available; gem nav opens it and `back to editor` returns to `/`. | Chrome item-sculpt nav, `/items`, `back to editor` | cart/hmsc-int/shell/chrome.tsx:157; cart/hmsc-int/index.tsx:838; cart/hmsc-int/index.tsx:930; cart/hmsc-int/editors/items/ItemsRoute.tsx:497 | Route path hot state; no authored data | ACCOUNTED workbench step 5 itemsSource; route flip pending |
| C2 | Roster area lists saved sculpted items, loads a chip, saves current draft, starts a new blank item, and conditionally removes a saved item. | `items` chips, `name` input, `save`, `new`, `x remove` when a saved draft exists | cart/hmsc-int/editors/items/ItemsRoute.tsx:511; cart/hmsc-int/editors/items/ItemsRoute.tsx:525; cart/hmsc-int/editors/items/ItemsRoute.tsx:264 | Intended: `items` stream plus sessions stream; live save showed `save unavailable` from sessions corruption | ACCOUNTED workbench step 5 itemsSource; saved item consumer ACCOUNTED character prop enum |
| C3 | Imports the latest /voxels blockout into the item draft and reports the star-shaped wrap limit. | `import /voxels blockout` | cart/hmsc-int/editors/items/ItemsRoute.tsx:238; cart/hmsc-int/editors/items/bake.ts:1; cart/hmsc-int/editors/items/bake.ts:86 | Reads `voxels` stream snapshot/state; writes item draft locally, intended autosave to `items` | ACCOUNTED workbench step 5 itemsSource |
| C4 | Uses one 48x24 signed displacement grid as the item shape truth; 2D paint, 3D grab, mesh, and lattice all read/write that grid. | Paint canvas click/stroke, 3D grab surface | cart/hmsc-int/editors/items/ItemsRoute.tsx:15; cart/hmsc-int/editors/items/stream.ts:13; cart/hmsc-int/editors/items/bake.ts:56 | Intended `items` stream stores radius/amount/grid/color/source | ACCOUNTED workbench step 5 itemsSource |
| C5 | Depth paint surface supports raise, carve, flatten, soften, clear, color-picking, and brush/strength/depth/radius knobs. | Mode chips, paint canvas, knob minus/plus, color swatches | cart/hmsc-int/editors/items/ItemsRoute.tsx:300; cart/hmsc-int/editors/items/ItemsRoute.tsx:545; cart/hmsc-int/editors/items/ItemsRoute.tsx:569 | Brush/mode/mirror/grid twigs plus item draft; live authored commit blocked | ACCOUNTED workbench step 5 itemsSource |
| C6 | Right stage renders the item as a Globe mesh with optional grab-grid shell and LabEnvironment lighting. | View right-side 3D stage, `grid` toggle | cart/hmsc-int/editors/items/ItemsRoute.tsx:579; cart/hmsc-int/editors/items/ItemsRoute.tsx:588; cart/hmsc-int/editors/items/ItemsRoute.tsx:592; cart/hmsc-int/editors/items/ItemsRoute.tsx:601 | `showGrabGrid` twig persisted to `_route-twigs.json` | ACCOUNTED workbench step 5 itemsSource |
| C7 | Camera supports orbit/fly modes, focus, wheel zoom-to-cursor/dolly, and F/C hotkeys. | `orbit`, `fly`, `focus · F`, wheel over stage, `F`, `C` | cart/hmsc-int/editors/items/ItemsRoute.tsx:379; cart/hmsc-int/editors/items/ItemsRoute.tsx:613; cart/hmsc-int/editors/items/ItemsRoute.tsx:624 | Camera mode/look/fly pose/zoom twigs survived return selfshot | ACCOUNTED workbench step 5 itemsSource |
| C8 | Grab-sculpt path picks a surface point, shows hover state, and on drag raises/carves the item surface through shared grabKit. | Click/hover on item stage; drag is code path | cart/hmsc-int/editors/items/ItemsRoute.tsx:402; cart/hmsc-int/editors/items/ItemsRoute.tsx:411; cart/hmsc-int/editors/items/ItemsRoute.tsx:431; cart/hmsc-int/editors/items/ItemsRoute.tsx:444 | Intended `items` stream note/commit after drag; live drag delta not driven by witness | ACCOUNTED workbench step 5 itemsSource |
| C9 | Undo/redo works through shared paint history and has both buttons and hotkeys. | `undo ^Z`, `redo ^Y`, `Ctrl+Z`, `Ctrl+Y`; code also has `Ctrl+Shift+Z` | cart/hmsc-int/editors/items/ItemsRoute.tsx:199; cart/hmsc-int/editors/items/ItemsRoute.tsx:221; cart/hmsc-int/editors/items/ItemsRoute.tsx:620 | Local history; intended session notes on restore | ACCOUNTED workbench step 5 itemsSource |
| C10 | Saved sculpted items become game item definitions and are already read by the workbench character store for held-prop options. | Save item, then character held-prop list reads it | cart/hmsc-int/editors/items/bake.ts:176; cart/hmsc-int/editors/workbench/characters/store.ts:45; cart/hmsc-int/editors/workbench/characters/store.ts:498; cart/hmsc-int/editors/workbench/WBCHAR.CAPTURE.md:95 | `items` stream snapshot feeds character workbench registry | ACCOUNTED workbench step 5 itemsSource and character panel prop enum |

## Hotkey inventory
- `Ctrl+Z`: item draft undo, e2e pressed.
- `Ctrl+Y`: item draft redo, e2e pressed.
- `Ctrl+Shift+Z`: redo in code, not separately driven live.
- `F`: focus/refit item camera, e2e pressed.
- `C`: switch back to orbit from fly, e2e pressed.

## Persistence inventory (what survives reload, via what)
- Route twigs survive fresh process return via `cart/hmsc-int/sessions/_route-twigs.json`: `/items` stored `sculptMode`, `showGrabGrid`, `mirror`, `camMode`, `orbitLook`, `orbitDistance`, `orbitTargetPan`, and `flyPose` after the walk; implemented by `useRouteTwigState`.
- Authored item persistence is intended through `items` stream events `{authored, removed}` and materialized snapshots. Today the snapshot is empty and live save reported `save unavailable — Error: data store: corrupt record at cart/hmsc-int/data/streams/sessions.jsonl:884`.
- /voxels entanglement is direct: import reads the latest `voxelsStream` doc and bakes it into the item grid. It does not consume `voxel-blockout.json`.

## Oddities/bugs found while walking (report, do not fix)
- Live save/autosave/remove cannot be proven today because route session open fails against the existing ignored `sessions.jsonl` corruption; the route surfaces this as `save unavailable` on /items.
- The headless witness can press/click/wheel but has no true drag primitive, so grab-pull and paint-stroke movement are only partially live-driven.
- TextInput witness `clear` reported PASS but the field visually retained/appended around `new item` during the first pass.
- The host prints an existing crash/watchdog trailer after some successful autotest exits even when the manifest result is PASS.

## Unverified-live rows (code says it exists, could not trigger; why)
- Roster `x remove`: code only renders it when `draftId` exists; live save could not create a saved item because the sessions stream is corrupt.
- Real 3D grab drag delta and continuous paint stroke movement: witness has click/wheel/key but no drag action.
- `Ctrl+Shift+Z`: code binds it to redo, but the live script covered `Ctrl+Y` and the redo button instead.
