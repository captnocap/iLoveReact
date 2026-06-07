# WBMATERIALS.CAPTURE.md

WBSTEP7-0606 folds `/textures` and `/compose` into the MATERIAL WorkbenchSource.
The old routes are untouched until the user's flip. The live source is
`editors/workbench/materials/source.tsx`; the headless state and PanelSpec/action
surface are `editors/workbench/materials/store.ts`; the shared consumer chooser
contract is `editors/workbench/materials/chooser.ts`; tests are
`editors/workbench/materials/source.test.ts`.

## Req 0003 Answer

`req_0003` asks when paintable shaders and game material shaders stop speaking
separate languages. WBSTEP7 is that boundary: MATERIAL is the authored material
door. Its roster owns shader recipes, stored game materials, React textures, and
decals (`store.ts:436-445`), and Materialize writes stored game materials through
`saveCustomTexture` / `saveDecalTexture` plus the `materials` stream
(`source.tsx:55-64`, `store.ts:296-333`). The PAINT source remains the one
agnostic painter, but material targets route back through this stored-material
door instead of growing a second texture path.

Downstream consumers mount the same material registry/chooser: the shared
grouping/label contract lives in `materials/chooser.ts:12-23`; building skins
validate and list `game/textures` ids through `allTextures` / `textureById`
(`buildings/live.ts:37-43`) and expose those ids through the shared `pick` field
(`buildings/panel.ts:69-70`, `buildings/panel.ts:121-142`); garment variants do
the same through `clothing/live.ts:36-42` and `clothing/panel.ts:140-144`.
Vehicle authoring currently has no separate material-variant model to merge:
vehicles use color/trim plus the shared agnostic PAINT lens for per-part texture
overlays (`vehicles/panel.ts:57-63`, `vehicles/panel.ts:153-158`), so this fold
does not invent a parallel vehicle-material store.

## `/textures` Parity

| Row | Dying route source | Workbench accounting |
|---|---|---|
| C1 shader recipe groups | `TextureStudio.tsx:82-87`, `TextureStudio.tsx:132-139` | ACCOUNTED: roster recipe rows from `recipes()` at `store.ts:46-50`, `store.ts:436-441`; source wires `HMSC_SHADERS` at `source.tsx:55-57`. |
| C2 React code textures | `TextureStudio.tsx:84`, `TextureStudio.tsx:140-143` | ACCOUNTED: roster React rows at `store.ts:441`; live deps pull React entries from `TEXTURE_REGISTRY` at `source.tsx:55-58`; preview resolves through `textureById` at `source.tsx:112-115`. |
| C3 saved custom materials | `TextureStudio.tsx:85`, `TextureStudio.tsx:144-147`, `TextureStudio.tsx:174-183` | ACCOUNTED: stored-material rows and decal rows at `store.ts:442-445`; preview/delete at `store.ts:513-521`, `source.tsx:112-115`. |
| C4 save-as name | `TextureStudio.tsx:87-88`, `TextureStudio.tsx:155-160` | ACCOUNTED: reads/writes `/textures:saveAs` at `store.ts:152-155`, `store.ts:170-174`; field at `store.ts:349-352`; verified at `source.test.ts:98-115`. |
| C5 live shader preview | `TextureStudio.tsx:153-164`, `ShaderLab.tsx:113-121` | ACCOUNTED: PREVIEW and SHADER LAB stages render `Effect` with current data at `source.tsx:94-101`, `source.tsx:118-130`. |
| C6 variant/overlay picker | `ShaderLab.tsx:90-103`, `ShaderLab.tsx:144-153` | ACCOUNTED: source-owned variant state and overlay maps at `store.ts:181-202`; variant field at `store.ts:349-353`. |
| C7 tune params | `ShaderLab.tsx:156-170` | ACCOUNTED: PanelSpec sliders for base and active variant params at `store.ts:357-366`, `store.ts:489-503`; tested at `source.test.ts:98-115`. |
| C8 reset recipe | `ShaderLab.tsx:103-106`, `ShaderLab.tsx:181-183` | ACCOUNTED: reset action field restores defaults at `store.ts:349-354`. |
| C9 Materialize persisted | `TextureStudio.tsx:108-120`, `ShaderLab.tsx:107-110`, `ShaderLab.tsx:176-180` | ACCOUNTED: hero Materialize action at `store.ts:539-545`; shader persistence and stream commit at `store.ts:296-315`; tested at `source.test.ts:98-115`. |
| C10 in-memory ShaderLab material bank | `ShaderLab.tsx:123-138` | ACCOUNTED: bank state at `store.ts:160`, `store.ts:302`, `store.ts:504-510`; stage strip at `source.tsx:132-146`; tested at `source.test.ts:112-114`. |
| C11 saved strip | `TextureStudio.tsx:174-183` | ACCOUNTED: Workbench roster is the visible saved-material strip (`store.ts:436-445`), with stored preview in PREVIEW mode (`source.tsx:112-115`) and delete in panel/action (`store.ts:513-521`, `store.ts:539-545`). |
| C12 delete saved material | `TextureStudio.tsx:122-125`, `TextureStudio.tsx:180-182` | ACCOUNTED: delete commit at `store.ts:335-343`; hero/panel delete actions at `store.ts:513-521`, `store.ts:539-545`; tested at `source.test.ts:147-154`. |
| C13 preview React/stored material | `TextureStudio.tsx:105-107`, `TextureStudio.tsx:166-168` | ACCOUNTED: PREVIEW stage resolves React/stored material through `textureById` and `TexturePreview` at `source.tsx:112-115`. |
| C14 session open/close | `TextureStudio.tsx:90-103` | ACCOUNTED: Workbench source opens the same `materialsStream` session on `/workbench` at `source.tsx:47-64`; events are identical `materialized` / `removed` shapes at `store.ts:296-337`. |

## `/compose` Parity

| Row | Dying route source | Workbench accounting |
|---|---|---|
| C1 draft autosave | `ComposeRoute.tsx:125-140` | ACCOUNTED: compose doc/name/editing/show3d read/write the `/compose` twigs at `store.ts:162-179`, `store.ts:255-279`; tested at `source.test.ts:117-145`. |
| C2 name/editingId | `ComposeRoute.tsx:130-134`, `ComposeRoute.tsx:215-225` | ACCOUNTED: state at `store.ts:162-165`; fields at `store.ts:368-376`; Materialize updates editing id/name at `store.ts:317-333`. |
| C3 session open/close | `ComposeRoute.tsx:142-151` | ACCOUNTED: Workbench source opens `materialsStream` at `source.tsx:47-64`; decal Materialize/remove events at `store.ts:317-337`. |
| C4 size presets | `ComposeRoute.tsx:247-260`, `ComposeRoute.tsx:385-388` | ACCOUNTED: size enum and numeric width/height fields at `store.ts:368-374`, `store.ts:394-401`. |
| C5 add nodes | `ComposeRoute.tsx:162-168`, `ComposeRoute.tsx:263-265` | ACCOUNTED: add-node helpers and panel actions at `store.ts:268-279`, `store.ts:376-380`; tested at `source.test.ts:117-145`. |
| C6 3D toggle | `ComposeRoute.tsx:133-134`, `ComposeRoute.tsx:266` | ACCOUNTED: show3d twig state at `store.ts:162-179`; bool field at `store.ts:375`; stage conditional at `source.tsx:216-235`. |
| C7 Materialize decal | `ComposeRoute.tsx:214-225`, `ComposeRoute.tsx:267-269` | ACCOUNTED: hero Materialize action at `store.ts:539-545`; decal save/commit at `store.ts:317-333`; tested at `source.test.ts:117-145`. |
| C8 saved decal list/open/new/delete | `ComposeRoute.tsx:153-154`, `ComposeRoute.tsx:226-245`, `ComposeRoute.tsx:273-295` | ACCOUNTED: stored/decal roster rows at `store.ts:436-445`; open/new/delete at `store.ts:237-253`, `store.ts:335-343`, `store.ts:368-380`; tested at `source.test.ts:117-154`. |
| C9 2D stage click select/deselect | `ComposeRoute.tsx:300-333` | ACCOUNTED: COMPOSE stage click-away/select overlay at `source.tsx:179-214`; store selection at `store.ts:558-563`. |
| C10 drag node | `ComposeRoute.tsx:191-212`, `ComposeRoute.tsx:316-320` | ACCOUNTED: cursor-channel drag in COMPOSE stage at `source.tsx:156-177`; node move write at `store.ts:559-563`; tested at `source.test.ts:124-128`. |
| C11 3D billboard | `ComposeRoute.tsx:339-356`, `ComposeRoute.tsx:445-451` | ACCOUNTED: workbench mesh preview + `StaticSurface` capture at `source.tsx:216-235`. |
| C12 reorder/duplicate/remove/select layers | `ComposeRoute.tsx:170-189`, `ComposeRoute.tsx:362-379` | ACCOUNTED: layer actions at `store.ts:274-294`, `store.ts:382-391`; tested at `source.test.ts:140-145`. |
| C13 canvas props | `ComposeRoute.tsx:381-390` | ACCOUNTED: canvas width/height/background fields at `store.ts:394-401`. |
| C14 selected geometry/opacity | `ComposeRoute.tsx:394-400` | ACCOUNTED: selected x/y/w/h/opacity fields at `store.ts:403-409`. |
| C15 rect props | `ComposeRoute.tsx:401-407` | ACCOUNTED: rect fill/radius/border/border-color fields at `store.ts:410-416`. |
| C16 text props | `ComposeRoute.tsx:409-430` | ACCOUNTED: text/color/size/tracking/weight/family/align fields at `store.ts:417-426`. |
| C17 image src | `ComposeRoute.tsx:433-435` | ACCOUNTED: image src/radius fields at `store.ts:427-431`. |
| C18 materialized decals available | `ComposeRoute.tsx:214-225`, `ComposeRoute.tsx:273-295` | ACCOUNTED: decals are saved through the same stored-material door (`store.ts:317-333`) and immediately reappear in MATERIAL roster (`store.ts:436-445`) and texture preview path (`source.tsx:104-115`). |

## Verification

- Focused suites GREEN: `workbench/materials` 6/6, `workbench/buildings`
  13/13, `workbench/clothing` 9/9.
- `tools/rjit game verify` reached `1/1 oracle, 68/69 suites, 2/2 scripts`;
  the only RED suite is the supervisor-reported unrelated REQBOARD lane
  (`docs/game/_index/requests.test.ts`: 3 request-marker/session grouping
  failures). Per supervisor stop order, this lane did not touch request-system
  files.
- Suite: `editors/workbench/materials/source.test.ts`, 6/6 passing
  (`source.test.ts:80-170`), including the shared chooser contract at
  `source.test.ts:157-168`.
