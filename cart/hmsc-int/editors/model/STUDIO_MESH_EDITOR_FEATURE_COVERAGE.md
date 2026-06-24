# Studio Mesh Editor Feature Coverage

Last surveyed: 2026-06-24

- Scope:
  - This is the current feature map for the `hmsc-int` Studio mesh editor.
  - The active editor is `cart/hmsc-int/editors/model/studiokit/StudioViewport.tsx`.
  - The workbench mounts it through `cart/hmsc-int/editors/workbench/model/source.tsx`.
  - `cart/hmsc-int/editors/model/Studio.tsx` is the frozen pre-decomposition breadcrumb.
  - The deeper build history remains in `cart/hmsc-int/editors/MESH_EDITOR_PLAYBOOK.md`.

- Mental model:
  - `Studio` is the in-house, Blockbench-class model authoring surface.
  - A model is a saved scene containing ordered mesh parts.
  - Each part stores one `EditMesh`: vertices, n-gon faces, UVs, material/texture-slot data, optional pivot, optional mounts, and optional paint.
  - Source models are editable authoring data. Compile cooks them into installed runtime assets.
  - `16 u = 1 tile = 1 m`; all modeling-unit readouts use that basis.
  - Cold start opens a blank `+ new` scene. Hot reload preserves working twigs like camera, open model, mode, and selection.

## Exact Style Values

- Workbench shell columns:
  - Source: `cart/hmsc-int/shell/workbench.cls.ts`.
  - Route root: `position: absolute`, `left: 0`, `top: 0`, `width: '100%'`, `height: '100%'`, `flexDirection: 'column'`.
  - Workbench body: `flexGrow: 1`, `minHeight: 0`, `flexDirection: 'row'`.
  - Chrome height: `CHROME_H = 38`.
  - Column 1 category rail: `width: 46`, `height: '100%'`, `paddingTop: 8`, `paddingBottom: 8`, `gap: 6`.
  - Category buttons: `width: 30`, `height: 30`, centered, rounded by theme radius.
  - Column 2 roster rail: `width: 170`, `height: '100%'`, `paddingTop: 8`, `gap: 2`.
  - Roster search input: `marginLeft: 8`, `marginRight: 8`, `marginBottom: 6`, `paddingLeft: 8`, `paddingTop: 4`, `paddingBottom: 4`.
  - Roster rows: `gap: 7`, `marginLeft: 4`, `marginRight: 4`, `paddingLeft: 7`, `paddingRight: 7`, `paddingTop: 5`, `paddingBottom: 5`.
  - Column 3 properties column: `width: 360`, `height: '100%'`, `flexDirection: 'column'`.
  - Column 4 preview column: `flexGrow: 1`, `minWidth: 0`, `height: '100%'`, `flexDirection: 'column'`.
  - Preview bar: `paddingLeft: theme spacingMd`, `paddingRight: theme spacingMd`, `paddingTop: 6`, `paddingBottom: 6`, `gap: theme spacingMd`.
  - Preview lens cells: `paddingLeft: 10`, `paddingRight: 10`, `paddingTop: 4`, `paddingBottom: 4`.
  - Tool rail class, used by other stage lenses: `width: 40`, `height: '100%'`, `paddingTop: 8`, `gap: 5`; tool buttons are `28 x 28`.

- Workbench field renderer:
  - Source: `cart/hmsc-int/shell/fields.tsx`.
  - Numeric input width: `NUM_INPUT_W = 66`.
  - Slider track width: `SLIDER_TRACK_W = 124`, slider height `14`.
  - Text fields use `width: f.width ?? 140`; the Studio model name field passes `width: 150`.
  - Text fields also use `flexGrow: 0`, `paddingTop: 4`, `paddingBottom: 4`.
  - Row-layout fields use `width: '100%'`, `borderRightWidth: 0`; row label gutter is `ROW_LABEL_W = 104`.
  - Enum wrap has `maxWidth: 200`, `gap: 3`, `rowGap: 3`; enum cells use `paddingLeft: 6`, `paddingRight: 6`, `paddingTop: 3`, `paddingBottom: 3`.
  - Color wheel fields use `size: 112`.
  - Color range cells use `width: 12`, `height: 12`, `borderRadius: 2`.
  - Pick fields use `minWidth: 0`, `maxWidth: '100%'`; an open picker takes `width: '100%'`.
  - Node and paragraph fields take `width: '100%'` and stack as full-width column content.

- Studio workbench source:
  - Source: `cart/hmsc-int/editors/workbench/model/source.tsx`.
  - Model name field: `{ k: 'name', t: 'text', width: 150 }`, rendered by the shared text field above.
  - Column 3 groups are `MODEL`, `STUDIO`, `UV`, `RIG`, and `SHAPE`.
  - Column 4 stage is `<StudioEditor />`; the shell supplies the column width with `PreviewCol`.

- StudioEditor and route:
  - Source: `cart/hmsc-int/editors/model/studiokit/StudioViewport.tsx`.
  - `StudioRoute` wrapper: `flexGrow: 1`, `height: '100%'`, `minHeight: 0`, `backgroundColor: T.panelSolid`.
  - `StudioEditor` root row: `flexGrow: 1`, `height: '100%'`, `minHeight: 0`, `position: 'relative'`.
  - Viewport receives remaining width by `flexGrow: 1`.
  - Right outliner dock: `width: 236`, `minWidth: 236`, `height: '100%'`, `borderLeftWidth: 1`, `borderColor: '#1c2a3c'`, `backgroundColor: T.page`.
  - Viewport layout rect fallback: `{ x: 0, y: 0, width: 1000, height: 700 }`.
  - Viewport root: `flexGrow: 1`, `height: '100%'`, `position: 'relative'`, `overflow: 'hidden'`, `backgroundColor: '#0a0e14'`.
  - Scene3D: `width: '100%'`, `height: '100%'`, `backgroundColor: '#0a0e14'`.

- StudioViewport top chrome:
  - Tier-1 top strip: `position: 'absolute'`, `left: 8`, `right: 8`, `top: 8`, `alignItems: 'center'`, `justifyContent: 'space-between'`.
  - Top-left info cluster: `gap: 8`; undo/redo/import cluster: `gap: 4`.
  - Info pill: `paddingLeft: 8`, `paddingRight: 8`, `paddingTop: 4`, `paddingBottom: 4`, `borderRadius: 5`.
  - Mirror axis cluster: `gap: 3`, `paddingLeft: 5`, `paddingRight: 4`, `paddingTop: 2`, `paddingBottom: 2`, `borderRadius: 5`.
  - Mirror axis buttons: `paddingLeft: 5`, `paddingRight: 5`, `paddingTop: 2`, `paddingBottom: 2`, `borderRadius: 4`.
  - Tier-2 mode bar: `position: 'absolute'`, `left: 8`, `top: 40`, `gap: 4`, `rowGap: 4`, `flexWrap: 'wrap'`, `paddingLeft: 6`, `paddingRight: 6`, `paddingTop: 5`, `paddingBottom: 5`, `borderRadius: 7`.
  - Top-right file/texture/compile row: `position: 'absolute'`, `right: 8`, `top: 40`, `gap: 4`, `rowGap: 4`, `flexWrap: 'wrap'`, `justifyContent: 'flex-end'`.
  - Shared step button constant `STEP_BTN`: `paddingLeft: 7`, `paddingRight: 7`, `paddingTop: 4`, `paddingBottom: 4`, `borderRadius: 5`, `backgroundColor: '#13233aee'`, `borderWidth: 1`, `borderColor: '#2c4a6a'`.

- StudioViewport left and bottom overlays:
  - Context rail: `position: 'absolute'`, `left: 8`, `top: 72`, `width: 168`, `gap: 4`, `rowGap: 4`, `flexWrap: 'wrap'`, `alignItems: 'flex-start'`, `alignContent: 'flex-start'`.
  - Context section divider: `height: 1`, `width: '100%'`, `marginTop: 3`, `marginBottom: 3`.
  - Transform tool row inside context rail: `gap: 4`, `width: '100%'`; each tool button adds `flexGrow: 1`, centered content.
  - Texture-slot row: `width: '100%'`, `gap: 3`, `alignItems: 'center'`.
  - Texture-slot text input: `flexGrow: 1`, `flexBasis: 0`, `minWidth: 0`, `borderRadius: 3`, `paddingLeft: 5`, `paddingRight: 4`, `paddingTop: 2`, `paddingBottom: 2`, `fontSize: 9`.
  - Paint diagnostics: `position: 'absolute'`, `left: 0`, `right: 0`, `bottom: 92`, centered; inner pill has `paddingLeft: 10`, `paddingRight: 10`, `paddingTop: 4`, `paddingBottom: 4`, `borderRadius: 6`.
  - Export toast: `left: 0`, `right: 0`, `bottom: 54`, centered; inner pill has `paddingLeft: 12`, `paddingRight: 12`, `paddingTop: 6`, `paddingBottom: 6`, `borderRadius: 6`.
  - Size readout: `position: 'absolute'`, `left: 14`, `bottom: 100`, `paddingLeft: 9`, `paddingRight: 9`, `paddingTop: 5`, `paddingBottom: 5`, `borderRadius: 6`.
  - Key legend container: `left: 0`, `right: 0`, `bottom: 8`, centered.
  - FOV controls: `position: 'absolute'`, `right: 12`, `bottom: 12`, `gap: 6`, `alignItems: 'flex-end'`.
  - FOV value pill: `paddingLeft: 8`, `paddingRight: 8`, `paddingTop: 5`, `paddingBottom: 5`, `borderRadius: 5`.
  - Reframe button: `paddingLeft: 10`, `paddingRight: 10`, `paddingTop: 5`, `paddingBottom: 5`, `borderRadius: 5`.
  - View compass: `left: 14`, `bottom: 14`, `width: 78`, `height: 78`, `borderRadius: 39`; axis radius `25`, positive node radius `9`, negative node radius `6`.
  - Live drag readout: placed at projected anchor plus `left: p.x + 14`, `top: p.y - 34`; pill padding is `7/7/3/3`, `borderRadius: 5`.

- Active paint stack inside StudioViewport:
  - Active paint scroll view: `position: 'absolute'`, `left: 8`, `top: 72`, `width: 276`, `height: Math.max(280, viewportHeight - 128)`.
  - Paint stack column: `gap: 8`, `paddingRight: 4`.
  - Runtime `BrushKit` is passed `width={264}`.
  - Paint layer panel card: `gap: 6`, `padding: 10`, `borderRadius: 8`, border `1`.
  - Layer strip inside paint card uses `maxHeight: 180`.
  - Layer opacity buttons: `paddingLeft: 7`, `paddingRight: 7`, `height: 22`, `borderRadius: 4`.
  - Saved palettes card: `gap: 6`, `padding: 10`, `borderRadius: 8`.
  - Saved palette name input: `flexGrow: 1`, `height: 24`, `paddingLeft: 8`, `paddingRight: 8`, `borderRadius: 5`, `fontSize: 11`.
  - Saved palette save/load/delete buttons: save uses `height: 24`; per-palette load/delete use `height: 20`, `paddingLeft: 7`, `paddingRight: 7`, `borderRadius: 4`.
  - Saved palette swatches: `width: 16`, `height: 16`, `borderRadius: 3`.
  - Text tool card: `gap: 6`, `padding: 10`, `borderRadius: 8`.
  - Text tool input: `height: 26`, `paddingLeft: 8`, `paddingRight: 8`, `borderRadius: 5`, `fontSize: 12`.
  - Text place button: `flexGrow: 1`, `height: 26`, `borderRadius: 5`; cancel button uses `paddingLeft: 10`, `paddingRight: 10`, `height: 26`.
  - Studio paint strip card: `gap: 8`, `padding: 10`, `borderRadius: 8`.
  - Material chips: `gap: 4`, `paddingLeft: 5`, `paddingRight: 7`, `height: 22`, `borderRadius: 4`; material swatch `11 x 11`, `borderRadius: 3`.
  - Paint action chips: `paddingLeft: 8`, `paddingRight: 8`, `height: 24`, `borderRadius: 5`.
  - Legacy standalone `PaintPanel` still in `cart/hmsc-int/editors/model/PaintPanel.tsx`: `left: 8`, `top: 84`, `width: 214`, `padding: 9`, `gap: 9`, `borderRadius: 9`; swatches are `SW = 19`; custom color wheel is `size: 120`.

- Layer stack / outliner rows:
  - Source: `cart/hmsc-int/editors/paint/LayerStrip.tsx`.
  - Layer preview constant: `PREVIEW = { w: 34, h: 24 }`.
  - Strip root with explicit height: `height: props.height`, `minHeight: 0`, `gap: 6`, `backgroundColor: T.page`.
  - Strip root without explicit height: body scroll uses `maxHeight: props.maxHeight ?? 220`.
  - Header row: `gap: 6`, `paddingHorizontal: props.height ? 10 : 0`, `paddingTop: props.height ? 6 : 0`.
  - Body column: `paddingHorizontal: props.height ? 10 : 0`, `paddingBottom: props.height ? 8 : 0`, `gap: 5`.
  - Generic Studio outliner row: `gap: 7`, `padding: 6`, `borderRadius: 5`; active stripe `width: 3`, `height: 38`, `borderRadius: 2`.
  - Paint-layer row: `gap: 7`, `padding: 6`, `borderRadius: 5`; active stripe `width: 3`, `height: 30`, `borderRadius: 2`.
  - Preview box: `width: 34`, `height: 24`, `borderRadius: 4`, `overflow: 'hidden'`.
  - Rename input: `height: 18`, `fontSize: 11`, `borderRadius: 3`, `paddingHorizontal: 4`.
  - Row text column: `flexGrow: 1`, `flexBasis: 0`, `minWidth: 0`; gap is `3` for generic rows and `1` for paint rows.
  - Layer action buttons: `width: 22`, `height: 22`, `borderRadius: 4`; icon size `11`.

- Column-3 Studio panels:
  - `StudioRigPanel` root: `gap: 8`, `width: '100%'`; empty state uses `padding: 12`, `borderRadius: 8`.
  - Rig buttons: `paddingLeft: 7`, `paddingRight: 7`, `paddingTop: 3`, `paddingBottom: 3`, `borderRadius: 5`.
  - Rig field input: `height: 22`, `fontSize: 11`, `borderRadius: 4`, `paddingHorizontal: 6`.
  - Rig stepper value text: `width: 34`; joint axis/spin labels: `width: 30`; joint and anchor cards use `gap: 6`, `padding: 8`, `borderRadius: 7`.
  - `StudioShapePanel` root: `gap: 8`, `width: '100%'`; card style `padding: 8`, `borderRadius: 7`.
  - Shape stat columns: `gap: 1`, `alignItems: 'center'`, `minWidth: 44`.
  - Shape empty state: `padding: 14`, `borderRadius: 8`; pivot dot `8 x 8`, `borderRadius: 4`; face index text `width: 20`.
  - Shape JSON box: `padding: 8`, `borderRadius: 6`; JSON text `fontSize: 8`, `width: '100%'`.
  - `StudioUVPanel` root: `gap: 8`, `width: '100%'`; `PANEL.pad = 10`, `fallbackWidth = 248`, `checker = 8`.
  - UV empty states: `padding: 14`, `borderRadius: 8`; UV header row `gap: 8`.
  - UV atlas box: dynamic `width` and `height`, `position: 'relative'`, `borderRadius: 4`, `overflow: 'hidden'`; face label is absolute `left: 2`, `top: 1`, `fontSize: 8`.

- Dialog controls and Add Shape:
  - `NumberField`: row `gap: 8`; label `width: 64`; input box `width: 66`; `TextInput` `height: 24`, `fontSize: 12`, `borderRadius: 4`, `paddingHorizontal: 6`.
  - `LCField`: row `width: '100%'`, `gap: 10`; label `width: 60`; child box `flexGrow: 1`, `flexBasis: 0`, `minWidth: 0`.
  - `LCStepper`: row `gap: 4`; input box `width: props.width ?? 54`; `TextInput` `height: 22`, `fontSize: 11`, `borderRadius: 4`, `paddingHorizontal: 6`.
  - Add Shape modal overlay: full-screen absolute `left/top/right/bottom: 0`, centered, `backgroundColor: '#03060caa'`.
  - Add Shape card: `width: 360`, `gap: 11`, `padding: 16`, `borderRadius: 10`.
  - Shape/build-seed buttons: `paddingLeft: 9`, `paddingRight: 9`, `paddingTop: 5`, `paddingBottom: 5`, `borderRadius: 6`.
  - Lattice pattern buttons: `flexGrow: 1`, centered, `paddingTop: 5`, `paddingBottom: 5`, `borderRadius: 6`.
  - Dialog action row: `gap: 8`, `justifyContent: 'flex-end'`, `marginTop: 4`; cancel `paddingLeft: 12`, `paddingRight: 12`; confirm `paddingLeft: 14`, `paddingRight: 14`; both use `paddingTop: 6`, `paddingBottom: 6`, `borderRadius: 6`.

- Modal card widths:
  - Add Shape: `width: 360`.
  - Create Texture: `width: 420`, `gap: 9`, `padding: 16`, `borderRadius: 10`.
  - Import Part: `width: 420`, `maxHeight: '80%'`, `gap: 11`, `padding: 16`, `borderRadius: 10`; inner scroll `maxHeight: 420`.
  - Load painting from prop: `width: 420`, `maxHeight: 420`, `padding: 14`, `gap: 10`, `borderRadius: 8`; inner scroll `maxHeight: 300`.
  - Compile Asset: `width: 440`, `gap: 9`, `padding: 16`, `borderRadius: 10`.
  - Import Model: `width: 460`, `gap: 11`, `padding: 16`, `borderRadius: 10`.
  - Import Texture: `width: 460`, `gap: 11`, `padding: 16`, `borderRadius: 10`.
  - AI Texture: `width: 480`, `gap: 10`, `padding: 16`, `borderRadius: 10`.
  - Backdrops panel: `width: 540`, `maxHeight: '86%'`, `gap: 12`, `padding: 16`, `borderRadius: 10`.
  - Hotkeys panel: `minWidth: 380`, `gap: 8`, `paddingLeft: 16`, `paddingRight: 16`, `paddingTop: 14`, `paddingBottom: 14`, `borderRadius: 10`.
  - Bevel popup: bottom centered at `bottom: 18`; card `minWidth: 230`, `gap: 7`, `paddingLeft: 12`, `paddingRight: 12`, `paddingTop: 10`, `paddingBottom: 10`, `borderRadius: 9`.
  - Concave fix popup: bottom centered at `bottom: 18`; card `minWidth: 280`, `gap: 8`, `paddingLeft: 14`, `paddingRight: 14`, `paddingTop: 11`, `paddingBottom: 11`, `borderRadius: 9`.

- Dialog text inputs and controls:
  - Create Texture name input: `height: 24`, `fontSize: 11`, `borderRadius: 4`, `paddingHorizontal: 6`.
  - Create Texture color input wrapper: `width: 92`; input `height: 22`, `fontSize: 11`, `paddingHorizontal: 6`; color swatch `20 x 20`, `borderRadius: 4`.
  - Create Texture checkboxes: `width: 20`, `height: 20`, `borderRadius: 4`.
  - Import Texture path input: `height: 24`, `fontSize: 11`, `borderRadius: 4`, `paddingHorizontal: 6`.
  - Compile Asset label input: `height: 24`, `fontSize: 11`, `borderRadius: 4`, `paddingHorizontal: 6`.
  - AI Texture shared field: `height: 24`, `fontSize: 11`, `borderRadius: 4`, `paddingHorizontal: 6`.
  - AI status row: `gap: 8`, `justifyContent: 'space-between'`, `marginTop: 2`; status box `flexShrink: 1`.
  - Import Part row: `gap: 8`, `paddingLeft: 8`, `paddingRight: 8`, `paddingTop: 6`, `paddingBottom: 6`, `borderRadius: 6`; swatch `14 x 14`, `borderRadius: 3`.
  - Hotkeys chord box: `minWidth: 96`, `alignItems: 'flex-end'`; close/rebind/reset buttons use `paddingLeft: 8`, `paddingRight: 8`, `paddingTop: 3`, `paddingBottom: 3`, `borderRadius: 5`.

- Backdrops panel:
  - Button constant: `paddingLeft: 8`, `paddingRight: 8`, `paddingTop: 4`, `paddingBottom: 4`, `borderRadius: 5`.
  - Slider row: `gap: 8`; label `width: 52`; value text `width: 50`, right-aligned.
  - Backdrop card rows: `gap: 7`, `padding: 10`, `borderRadius: 8`.
  - Orientation buttons: `paddingLeft: 8`, `paddingRight: 8`, `paddingTop: 3`, `paddingBottom: 3`, `borderRadius: 4`.
  - Add-row choose button: `paddingLeft: 14`, `paddingRight: 14`, `paddingTop: 8`, `paddingBottom: 8`, `borderRadius: 6`.
  - Path input row: `gap: 8`; path input `height: 26`, `fontSize: 11`, `borderRadius: 4`, `paddingHorizontal: 8`.
  - Offscreen backdrop surface: `position: 'absolute'`, `left: -99999`, `top: 0`, `width: w`, `height: h`; bake size `BACKDROP_PX = 1024`.
  - Moving backdrop banner: `top: 44`, centered; inner row `gap: 8`, `paddingLeft: 10`, `paddingRight: 8`, `paddingTop: 4`, `paddingBottom: 4`, `borderRadius: 6`.
  - Backdrop diagnostics box: `left: 8`, `bottom: 8`, `paddingLeft: 8`, `paddingRight: 8`, `paddingTop: 5`, `paddingBottom: 5`, `borderRadius: 6`.

- Texture and offscreen surfaces:
  - Scene texture atlas offscreen surface: `position: 'absolute'`, `left: -99999`, `top: 0`, `width: px`, `height: px`.
  - Texture atlas root: `width: px`, `height: px`, `position: 'relative'`, `overflow: 'hidden'`.
  - Texture atlas image fill: `position: 'absolute'`, `left: 0`, `top: 0`, `width: px`, `height: px`.
  - Paint texture size: `PAINT_TEX = 1024`; layer paintables mount at `w={PAINT_TEX}`, `h={PAINT_TEX}`.

- Modeling and camera tunables that affect visible layout:
  - Source: `cart/hmsc-int/editors/model/studiokit/config.ts`.
  - Grid: `gridTiles: 3`, `tileMeters: 1`, `unitsPerTile: 16`, `fineDivisions: 16`.
  - Lines: `gridLineMeters: 0.012`, `fineLineMeters: 0.006`, `gridLiftMeters: 0.001`.
  - Axes: `axisLengthMeters: 1`, `axisThicknessMeters: 0.02`.
  - Camera boot: `bootYaw: 35`, `bootPitch: 28`, `fov: 38`.
  - Camera drag: `yawPerPixel: 0.4`, `pitchPerPixel: 0.32`, `minPitch: -89.9`, `maxPitch: 89.9`.
  - Zoom and fit: `minDistance: 0.4`, `maxDistance: 40`, `zoomStepFraction: 0.12`, `fitDistanceFactor: 3.2`, `emptyFitRadius: 1.6`.
  - Scale figure gap: `scaleFigureGapMeters: 0.5`.
  - Glass: `glassColor: '#a9cbe0'`, `glassOpacity: 0.34`.
  - Selection: `selectFaceColor: '#ff8a3d'`, `selectFacePushMeters: 0.004`.
  - Wheel defaults: `wheelWidthFraction: 0.5`, `wheelSides: 16`.
  - Solidify shell thickness: `shellThicknessMeters: 2 / 16`.
  - Edit step defaults: `extrudeMeters: 1 / 16`, `bevelMeters: 2 / 16`, `gizmoStepMeters: 1 / 16`, `gizmoStepFineMeters: 1 / 64`, `gizmoUniformStep: 0.1`, `gizmoUniformStepFine: 0.05`, `rotateStepDeg: 15`, `rotateStepFineDeg: 1`.
  - Texture and paint: `textureAtlasPx: 512`, `textureCheckerCells: 8`, `paintBakeMs: 70`, `paintGridCells: 64`, `paintCellUnits: 2`, `paintAtlasTexels: 1024`, `paintStrokeStepPx: 4`, `aiTextureSize: 1024`, `textureInlineMaxBytes: 256 * 1024`.

## ASCII Layout Map

- Full workbench shape:

```text
+--------------------------------------------------------------------------------------+
| HMSC-INT WORKBENCH                                                                    |
|                                                                                      |
|  LEFT ROSTER                         COLUMN 3 PANEL             COLUMN 4 STAGE        |
|  -------------------------------     ----------------------     --------------------  |
|  STUDIO source                       MODEL                      StudioEditor          |
|    + new                             - model name               - viewport            |
|    model:new_mesh_001                - rename                   - right outliner      |
|    model:new_mesh_002                                                                   |
|    ...                               STUDIO                                             |
|                                      - tool = mesh editor                               |
|  Row actions                         - outliner facts                                  |
|    delete saved model                - scale facts                                     |
|    Save a Copy                                                                          |
|                                      UV                                                |
|  Row pick behavior                   - stored UV atlas                                  |
|    + new -> blank scene              - selected-face islands                           |
|    model -> open saved model                                                            |
|                                      RIG                                               |
|                                      - pivot metadata                                  |
|                                      - joint metadata                                  |
|                                      - anchor metadata                                 |
|                                                                                       |
|                                      SHAPE                                             |
|                                      - encoded mesh stats                              |
|                                      - face loops                                      |
|                                      - mounts                                          |
|                                      - copy/show JSON                                  |
+--------------------------------------------------------------------------------------+
```

- StudioEditor stage:

```text
+--------------------------------------------------------------------------------------+
| StudioEditor                                                                          |
|                                                                                      |
|  +--------------------------------------------------------------------------+  +----+ |
|  | StudioViewport                                                           |  |OUT | |
|  |                                                                          |  |LIN | |
|  |  Scene3D: grid + axes + backdrops + meshes + glass pass + paint texture  |  |ER  | |
|  |                                                                          |  |    | |
|  |  top-left:      branch/edit controls + mode toolbar                      |  |part| |
|  |  left rail:     context operations                                       |  |rows| |
|  |  top-right:     file / texture / compile operations                      |  |    | |
|  |  bottom-left:   size readout + view compass                              |  |+add| |
|  |  bottom-center: key legend / paint diagnostics                           |  |part| |
|  |  bottom-right:  fov + reframe                                            |  |imp | |
|  |  modal layer:   add/import/texture/compile/backdrop/AI/bevel/loop dialogs|  |    | |
|  +--------------------------------------------------------------------------+  +----+ |
|                                                                                      |
|  Right outliner verbs: select, rename, visibility, duplicate, reorder, delete, merge  |
+--------------------------------------------------------------------------------------+
```

- Viewport chrome by screen area:

```text
                         +-----------------------------------+
                         | TOP-RIGHT FILE/TEXTURE/COMPILE    |
                         |  textureize                       |
                         |  compile                          |
                         |  texture view toggle              |
                         |  export atlas                     |
                         |  import atlas                     |
                         |  AI fill atlas                    |
                         |  export/import/AI slice           |
                         +-----------------------------------+

+------------------------------+-------------------------------------------------------+
| TOP-LEFT MODE BAR            |                                                       |
|  object vertex edge face     |                                                       |
|  rig paint                   |                                                       |
|                              |                                                       |
| LEFT CONTEXT RAIL            |                                                       |
|  always when part active:    |                                                       |
|    center                    |                                                       |
|    symmetrize                |                 3D MODELING VIEWPORT                  |
|    mesh lint                 |                                                       |
|                              |  - host orbit camera                                  |
|  object:                     |  - grid + axes                                        |
|    merge down                |  - active model parts                                 |
|    move/resize/rotate        |  - selected-face highlight                            |
|    all parts transform       |  - transform gizmos                                   |
|                              |  - normal handle                                      |
|  face:                       |  - rig handles                                        |
|    extrude                   |  - backdrop planes                                    |
|    loop cut                  |  - scale ghost                                        |
|    flip                      |                                                       |
|    merge faces               |                                                       |
|    glass                     |                                                       |
|    detach                    |                                                       |
|    solidify                  |                                                       |
|    wheel from face           |                                                       |
|    texture slots             |                                                       |
|                              |                                                       |
|  edge:                       |                                                       |
|    extrude                   |                                                       |
|    bevel                     |                                                       |
|    create face               |                                                       |
|                              |                                                       |
|  vertex:                     |                                                       |
|    bevel                     |                                                       |
|    create edge               |                                                       |
|    create face               |                                                       |
|    wheel center              |                                                       |
|    make wheel                |                                                       |
|                              |                                                       |
|  rig:                        |                                                       |
|    + pivot                   |                                                       |
|    + joint                   |                                                       |
|    + seat                    |                                                       |
|    mirror joint/seat         |                                                       |
+------------------------------+-------------------------------------------------------+
| BOTTOM-LEFT                    BOTTOM-CENTER                         BOTTOM-RIGHT     |
|  size readout                  key legend / paint diag               fov -/+          |
|  view compass                  toast / status                         reframe          |
+--------------------------------------------------------------------------------------+
```

- Mode-to-capability map:

```text
mode: object
  target: active part, or every part when "all parts" is on
  tools:  move | resize | rotate
  ops:    center | symmetrize | mesh lint | merge down | all parts transform
  notes:  entering object mode arms rotate; transforms commit once on release

mode: vertex
  target: selected vertices
  tools:  move | resize | rotate
  ops:    bevel | create edge | create face | wheel center | make wheel
  notes:  3+ arch verts can fit a tire radius / axle center

mode: edge
  target: selected edges
  tools:  move | resize | rotate
  ops:    extrude | bevel | create face
  notes:  edge extrude leaves the new edge selected for shaping

mode: face
  target: selected faces
  tools:  move | resize | rotate | normal-depth handle
  ops:    extrude | loop cut | flip | merge faces | glass | detach | solidify
          wheel from face | texture slots
  notes:  one selected face unlocks extrude, loop cut, normal-depth, wheel-from-face,
          and texture slice export/import/AI fill

mode: rig
  target: pivot, joints, anchors
  tools:  move handle only
  ops:    + pivot | + joint | + seat | mirror joint | mirror seat
  notes:  viewport places handles; column-3 RIG panel edits names, axis, limits,
          role, and facing

mode: paint
  target: model paint atlas and active paint layer
  tools:  brush | eraser | line | rect | ellipse | eyedropper | text
  ops:    face fill | lock face | fill all | save swatch | saved palettes
          layer add/rename/show/hide/opacity/reorder/duplicate/delete
          load from prop | clear
  notes:  entering paint ensures unique face islands; painted texture displays in
          every mode after paint exists
```

- Dialog map:

```text
outliner + add
  -> Add Shape dialog
       native shapes: cube, cylinder, cone, pyramid, plane, sphere, icosphere, lattice
       build seeds: wall, half wall, window wall, door wall, garage door,
                    floor, stairs, ramp

viewport import mesh
  -> Import Model dialog
       file picker -> GLB/OBJ -> EditMesh -> UV unwrap -> new saved model

outliner import part
  -> Import Part dialog
       browse other saved models -> clone part -> add into open model

textureize
  -> Create Texture dialog
       name, type, density, color, UV rearrange, power-of-2, occupancy,
       combine islands, angle thresholds, padding, dedupe

compile
  -> Compile Asset dialog
       kind: prop ready; item/vehicle part/clothing listed as later
       prop nature: static | foliage | physics
       piece type: prop | wall | railing | fence | floor | stairs | trim

import texture
  -> Import Texture dialog
       whole atlas or selected face slice

AI fill
  -> AI Texture dialog
       whole atlas or selected face slice
       prompt, image model, api key, reference on/off, enhance off/nano/claude

backdrops
  -> Reference Backdrops panel
       choose image, plane, size, opacity, visibility, flip, move, remove

loop cut
  -> Loop Cut popup
       direction, cuts, offset, units/percent, apply/cancel

bevel
  -> Bevel popup
       edge or vertex width, live preview, apply/cancel

concave guard
  -> Concave Fix popup
       split, ignore, revert

hotkeys
  -> Hotkeys panel
       current studio scope, plus studio-paint scope while painting
```

- Paint panel layout:

```text
+---------------------------------------------------+
| PAINT MODE FLOATING PANEL                         |
|                                                   |
| BrushKit                                          |
|  tools: brush eraser line rect ellipse eyedropper |
|  brush: size, ink/color, shared kit settings      |
|                                                   |
| Layers                                            |
|  active layer                                     |
|  visibility                                       |
|  opacity                                          |
|  rename                                           |
|  duplicate                                        |
|  reorder                                          |
|  delete                                           |
|                                                   |
| Palettes                                          |
|  model swatches                                   |
|  recents                                          |
|  saved named palettes                             |
|  save/load/delete saved set                       |
|                                                   |
| Text tool section, only when text tool is active  |
|  text input                                       |
|  place                                            |
|  cancel                                           |
|                                                   |
| Model texture ops                                 |
|  sample                                           |
|  face fill                                        |
|  lock face                                        |
|  + save swatch                                    |
|  fill all                                         |
|  load from prop                                   |
|  clear                                            |
+---------------------------------------------------+
```

- Column-3 detail panels:

```text
MODEL
  name text field

STUDIO
  tool = mesh editor
  outliner = parts -> layers (+ add)
  scale = 16 u = 1 tile = 1 m

UV
  active part stored UV layout
  selected faces filter the visible islands
  read-only view of stored UVs

RIG
  pivot
    present/absent
    clear
  joints
    name
    axis X/Y/Z
    full spin or min/max limit
    remove
  anchors
    name
    role driver/passenger/cargo/mount
    facing
    remove

SHAPE
  counts
    verts
    faces
    edges
    uv'd faces
    mounts
  pivot
  face vertex loops
  mounts list
  copy encoded JSON
  show encoded JSON
```

- Data and compile flow:

```text
User edits
  |
  v
StudioViewport twigs
  camera, selection, mode, gizmo, paint tool, open popup
  hot reload survives; cold start resets
  |
  v
StudioModel branch mutators
  add part, edit mesh, rename, visibility, reorder, paint, palette, bake paint
  persisted and undoable
  |
  v
modelStream
  StoredModel library
  StoredPart order
  EditMesh JSON
  palette
  paintRef -> content-addressed PNG blob
  |
  +-------------------------------+
  |                               |
  v                               v
Viewport rendering                Column-3 panels
  editMeshToGeometry                UVPanel
  glass split                       RigMetaPanel
  Scene3D dynamic slots             ShapePanel
  Paintable texture
  backdrops
  |
  v
Compile Asset
  |
  v
cookProp
  visible parts -> flattened mesh soup
  glass -> transparent subrange
  texture slots -> cooked slot ranges
  mounts -> cooked mounts
  collision/footprint/height -> derived
  descriptor -> prop/item/etc meaning
  |
  v
Cooked asset store
  meshRef: content-addressed geometry factor
  texRef: content-addressed texture factor
  descriptor: gameplay factor
  |
  v
hmsc-int compile path -> baked game data -> stateless engine loader
```

- Source layout:

```text
cart/hmsc-int/editors/model/
  STUDIO_MESH_EDITOR_FEATURE_COVERAGE.md
  Studio.tsx                         frozen pre-decomposition breadcrumb
  studioModel.ts                     open model projection + mutators
  modelStream.ts                     saved model library stream
  editMesh.ts                        core geometry IR + pure mesh ops
  Outliner.tsx                       LayerStackStrip adapter for parts
  UVPanel.tsx                        stored UV preview
  RigMetaPanel.tsx                   pivot/joint/anchor metadata
  ShapePanel.tsx                     encoded mesh read-only view
  Backdrops.tsx                      reference image planes
  meshSelect.tsx                     picking and selection overlay
  meshGizmo.tsx                      transform gizmo
  meshRig.tsx                        rig handles and overlay
  meshPaint.tsx                      3D paint picking and surface dabs
  meshPaintTexture.ts                paintable texture, layers, undo/redo
  textureize.ts                      atlas packing/rasterizing
  textureGen.ts                      AI texture prompt/generation helpers
  cookedAsset.ts                     pure cook core
  cookedAssets.ts                    cooked asset access
  cookedAssetStream.ts               cooked asset persistence
  studiokit/
    index.tsx                        public active Studio entry
    StudioViewport.tsx               main active viewport/editor behavior
    config.ts                        STUDIO tunables and constants
    helpers.ts                       units, snapping, loop-cut helpers
    scene/staging.tsx                grid, axes, drag readout
    overlays/                       compass and frame diagnostics
    panels/                         small reusable panel widgets
    dialogs/                        add/import/texture/compile/AI/etc dialogs
```

- One-screen capability index:

```text
+----------------------+----------------------------+-----------------------------+
| Area                 | Main controls              | Main output                 |
+----------------------+----------------------------+-----------------------------+
| Roster               | + new, open, delete, copy  | open saved model            |
| Outliner             | add, import part, rows     | ordered parts               |
| Viewport             | orbit, zoom, fov, reframe  | live visual edit            |
| Modes                | 1..6 tabs                  | object/vertex/edge/face/etc |
| Transform            | move, resize, rotate       | edited vertex positions     |
| Mesh ops             | extrude/cut/bevel/etc      | edited topology             |
| Symmetry             | center, mirror, keep +/-   | mirrored geometry/mounts    |
| Rig                  | pivot, joint, seat         | mounts and anchors          |
| UV                   | stored atlas preview       | UV understanding            |
| Texture              | textureize/import/export   | atlas and image refs        |
| Paint                | brush kit, layers, text    | content-addressed paint PNG |
| Backdrops            | image, plane, move, opacity| trace references            |
| Compile              | kind, nature, piece type   | installed cooked asset      |
| Diagnostics          | frame, lint, shape, keys   | verification/inspection     |
+----------------------+----------------------------+-----------------------------+
```

## Entry Points

- Workbench STUDIO tab:
  - Source: `editors/workbench/model/source.tsx`.
  - Roster rows:
    - `+ new` opens a blank scene.
    - Saved model rows open library models.
  - Roster actions:
    - Delete saved model rows.
    - `Save a Copy` duplicates the open saved model and opens the copy.
  - Column-3 panel groups:
    - `MODEL`: rename open model.
    - `STUDIO`: static facts such as `mesh editor`, `parts -> layers (+ add)`, and scale.
    - `UV`: live stored-UV preview.
    - `RIG`: pivot, joint, and anchor metadata.
    - `SHAPE`: read-only encoded `EditMesh` view.
  - Stage:
    - Mounts `StudioEditor`.

- Standalone route:
  - `StudioRoute` mounts the same `StudioEditor`.

## Data And Persistence

- `StudioModel`:
  - Shared model store used by the viewport and column-3 panels.
  - Projects one open saved model from the `modelStream`.
  - Exposes parts, active part, visible parts, palette, paint reference, selected faces, undo, redo, and library verbs.

- `modelStream`:
  - V20 per-concern stream for saved Studio models.
  - Stores a library of `StoredModel` records.
  - Stores each model as ordered `StoredPart` records.
  - Unknown future event kinds pass through safely.
  - Model edits are branch data: persisted and undoable.
  - Working state is twig data: hot-reload state, not undoable, reset on cold restart.

- Auto-create behavior:
  - Adding the first part to a blank scene creates a saved model.
  - Auto names new models as `new_mesh_NNN`.
  - The new saved model appears in the roster immediately.

- Undo and redo:
  - `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` operate on model edits.
  - In paint mode, the same shortcuts first step the paint snapshot ring.
  - Text inputs consume typing before the editor shortcut bus.

- Paint blob storage:
  - Pixel paint is baked to a content-addressed PNG blob.
  - The model stores a `paintRef` hash pointing at the blob.
  - Superseded paint blobs are garbage-collected unless another model still references them.

## Viewport And Camera

- Scene base:
  - Empty scene starts with only grid and axes.
  - Ground grid is 3 tiles wide by default.
  - Center tile has a 16x16 fine grid matching modeling units.
  - Origin axes are rendered as scene geometry.

- Host-owned camera:
  - Uses `GAME_NATIVE_CAMERA.forNode`.
  - Orbit solving runs in the host camera controller.
  - JS sends deltas; host solves and smooths every frame.
  - Default smoothing is direct `0` for Blockbench-style direct manipulation.
  - Smoothing cycle exists for diagnostics: `0`, `24`, `80`, `160`.

- Camera controls:
  - Empty-space drag orbits.
  - Scroll zooms orbit distance.
  - FOV `-` / `+` controls adjust field of view.
  - Reframe recenters the camera on the model.
  - `F` / `Home` trigger reframe.
  - Camera state persists across hot reload.

- View compass:
  - Shows projected axis ends.
  - Clicking an axis snaps the camera to that side.
  - Snaps ease along the shortest yaw path.

- Scale ghost:
  - Toggle shows the in-game player as a reference figure.
  - It stands beside the model at real game scale.

- Frame diagnostics:
  - `FrameDiagBar` reads host frame telemetry.
  - Tracks frame timing, skips, GC, and present timing.
  - Camera trace can log coalesced drag angle data.

## Library And Outliner

- Outliner:
  - Reuses the paint editor `LayerStackStrip`.
  - Each part appears as a row with name, color swatch, vertex count, and face count.
  - Active row selects the active part.
  - Visibility toggles hide/show parts.
  - Rename edits part names.
  - Duplicate, reorder, delete, and merge actions come through the same layer strip.

- Merge active:
  - In object mode, the active part can merge down into the previous part in order.
  - The merge uses `mergeMesh` and deletes the source part.
  - Used as the durable re-attach/weld path after splitting panels.

- Import part:
  - `ImportPartDialog` clones a part from another saved model into the open model.
  - The clone is a deep mesh copy, not a live alias.
  - Shape, UVs, mounts, pivot, and lift copy over.
  - Model-level pixel paint does not copy; the imported part repaints in the new model.

## Add And Import

- Add Shape dialog:
  - Adds native `EditMesh` parts, not render-only geometry.
  - Parametric shapes:
    - `Cube`
    - `Cylinder`
    - `Cone`
    - `Pyramid`
    - `Plane`
    - `Sphere`
    - `Icosphere`
    - `Lattice`
  - Shape parameters:
    - Diameter / width in modeling units.
    - Height where applicable.
    - Sides for cylinder, cone, and sphere.
    - Subdivision for icosphere.
  - Lattice parameters:
    - `Diamond (chainlink)` or `Grid (slots)`.
    - Openings across.
    - Openings up.
    - Wire width.
    - Frame thickness.
    - Panel thickness.

- Build-piece seeds:
  - Seed real build catalog pieces as editable meshes.
  - Current seeds:
    - `Wall`
    - `Half Wall`
    - `Window Wall`
    - `Door Wall`
    - `Garage Door`
    - `Floor`
    - `Stairs`
    - `Ramp`
  - These use the same visual decomposition that the world editor renders.
  - Intended flow: start from a real build piece, cut or add detail, then compile it back as a custom placeable asset.

- Import mesh:
  - `ImportModelDialog` imports external `.glb` or `.obj`.
  - Uses the native file picker when available.
  - Falls back to path handling through the file system doors.
  - Converts the mesh into `EditMesh`.
  - Unwraps UVs so the pixel painter can work immediately.
  - Import creates a new Studio model and adds one part.

## Selection Modes

- Mode toolbar:
  - `object`
  - `vertex`
  - `edge`
  - `face`
  - `rig`
  - `paint`

- Object mode:
  - Transforms the whole active part.
  - Defaults to rotate when entering object mode.
  - Can toggle `all parts` to transform every visible part about the shared model center.

- Vertex mode:
  - Selects individual vertices.
  - Supports vertex bevel, create edge, create face, wheel center, and make wheel.

- Edge mode:
  - Selects mesh edges.
  - Supports edge extrude, edge bevel, and create face.

- Face mode:
  - Selects faces.
  - Supports face extrude, loop cut, flip, merge, glass, detach, solidify, wheel from face, and texture slots.

- Rig mode:
  - Places and edits pivots, joints, and anchors.
  - Spatial placement happens with viewport handles.
  - Metadata edits happen in the RIG panel.

- Paint mode:
  - Builds or refreshes the paint atlas.
  - Shows the painted texture on the model.
  - Activates the universal paint kit.

- Selection behavior:
  - Clicking an element selects it.
  - Dragging on a selected transform handle transforms instead of orbiting.
  - Clicking a miss keeps the current selection and lets the drag orbit.
  - `Shift`, `Ctrl`, or `Meta` add/toggle selections.
  - `Esc` clears selection, closes some popups, or exits backdrop move.
  - `Ctrl+A` selects all elements in the active geometry mode.
  - `Delete` / `Backspace` deletes selected faces or selected rig handles.

## Transform Tools

- Move:
  - Drag axis arrows to translate the selected vertices.
  - In face mode with one face selected, the orange normal handle moves along the face normal.
  - The normal handle can pull a face outward or push inward for recess-like shaping after extrusion.

- Resize:
  - Drag axis handles to scale the selection along one axis.
  - Drag uniform handle to scale all axes.

- Rotate:
  - Drag axis rings to rotate around an axis.
  - Object mode uses rotate as the default tool.

- Snapping:
  - Default move/resize snap: whole modeling units.
  - `Shift`: fine snap.
  - `Alt`: freeform.
  - Rotate default snap: 15 degrees.
  - Rotate `Shift`: 1 degree.
  - Uniform resize snaps scale factors.

- Live drag path:
  - Gizmo drags patch the host dynamic slot directly.
  - React state is not updated per move.
  - The model store commits once on release.
  - A floating readout shows the current movement, rotation, or scale amount.

- Size readout:
  - Shows selected object/element dimensions in modeling units.
  - Single edge shows edge length.
  - Updates from the live draft during transforms.

## Symmetry And Mirror

- Center:
  - `center` moves the active part so its bounds center sits on the origin.
  - This is the setup step for mirror edit and mirror paint.

- Mirror axes:
  - X, Y, and Z mirror planes can be enabled.
  - Mirror axes can be combined.
  - Active mirror planes reflect vertex edits, rig joint moves, rig anchor moves, and paint dabs.

- Symmetry report:
  - Badge reports the best symmetry axis when no explicit mirror axis is enabled.
  - With a mirror axis enabled, the badge reports that axis.
  - Clean symmetric state shows a check.
  - Drift shows unmatched count.

- Symmetrize:
  - `keep +X/Y/Z` keeps the positive half and rebuilds the negative half.
  - `keep -X/Y/Z` keeps the negative half and rebuilds the positive half.
  - The chosen axis follows the current symmetry report.

## Mesh Operations

- Mesh lint:
  - `meshHealth` checks the active part.
  - Clean mesh shows `clean`.
  - Dirty mesh shows error/warn count.
  - Clicking the dirty badge selects offending faces when available and logs details.

- Concave Auto-Fix:
  - Transform commits compare the result against the start mesh.
  - Newly concave faces open a resolution popup.
  - Choices are split, ignore, or revert.

- Face extrude:
  - Requires exactly one selected face.
  - Commits a thin lip.
  - Leaves move tool active so the normal handle can pull the cap.

- Loop cut:
  - Requires exactly one selected face.
  - Popup controls:
    - Direction.
    - Cuts.
    - Offset.
    - Unit: size units or percent.
  - Preview is live.
  - Apply commits; cancel drops the draft.
  - A slide gizmo on the cut can drag the offset in the viewport.
  - Selection follows the kept half after apply.

- Flip:
  - Reverses selected face winding.
  - Used when a created face normal points the wrong way.

- Merge faces:
  - Requires at least two selected faces.
  - Fuses connected, coplanar selected faces into one clean face.
  - Acts as the inverse of a loop cut when the selection is valid.

- Glass:
  - Toggles selected faces as translucent glass.
  - Glass faces render in a separate transparent pass.
  - Glass skips texturing and slot assignment in the cooked mesh.

- Detach:
  - Peels selected faces into a new thin panel part.
  - Leaves the body with those faces removed.
  - New panel gets thickness and can be rigged as a door, hood, trunk, or light housing.

- Solidify:
  - Gives selected faces thickness in place.
  - Adds an inner skin and wall quads around the rim.
  - Holes stay open but gain thickness around their boundaries.

- Wheel from face:
  - Requires one selected face, usually the flat back face of a wheel well.
  - Fits center and radius from that face.
  - Adds axle joint(s) and creates separate wheel part(s).
  - Mirror-aware, so one face can create paired or four-way wheels.

- Edge extrude:
  - Requires one selected edge.
  - Pulls a new edge off the selected edge and bridges it with a quad.
  - Keeps the new edge selected for shaping.

- Edge bevel:
  - Requires one selected manifold edge.
  - Opens bevel sizing popup.
  - Live previews the chamfer before apply.

- Vertex bevel:
  - Requires one selected corner with enough incident edges.
  - Opens the same bevel sizing popup.
  - Cuts the corner and caps the hole.

- Create edge:
  - Requires two selected vertices.
  - Connects two non-adjacent corners of one face.
  - Splits the face.

- Create face:
  - Edge mode: two or more selected edges.
  - Vertex mode: three or four selected vertices.
  - Fills a closed edge loop, lofts bridge chains, or creates a tri/quad.

- Wheel center:
  - Requires at least three selected wheel-well arch vertices.
  - Fits a circle to find axle center and tire radius.
  - Adds a wheel socket joint at the center.
  - Mirror-aware.

- Make wheel:
  - Requires at least three selected wheel-well arch vertices.
  - Fits the wheel radius.
  - Generates tire mesh and merges it into the body.
  - Mirror-aware.

## Rig, Joints, And Anchors

- Pivot:
  - Optional per part.
  - Represents the rotation origin for parts that rotate.
  - Can be added in rig mode or from the RIG panel.
  - Can be cleared.

- Joint:
  - Named socket mount point.
  - Used for child parts that connect and rotate.
  - Viewport gizmo places the joint spatially.
  - RIG panel edits:
    - Name.
    - Axis: X, Y, or Z.
    - Spin: full rotation or min/max degree limits.
  - Binding by name is the practical contract; the dormant type vocabulary is not exposed as the main UI.

- Seat / anchor:
  - Fixed mount point, not a rotating joint.
  - Used for occupants and cargo-like fixed attachments.
  - Viewport button is `+ seat`.
  - RIG panel calls them anchors.
  - Roles:
    - `driver`
    - `passenger`
    - `cargo`
    - `mount`
  - Facing can be edited in the RIG panel.

- Mirror joint / mirror seat:
  - Available when a joint/anchor is selected and mirror axes are enabled.
  - Reflects the selected mount into matching partner locations.
  - Preserves kind, role, and facing where applicable.

## UV And Texture

- Stored UV preview:
  - `StudioUVPanel` shows stored per-corner UVs for the active part.
  - UVs are stable under vertex/edge movement.
  - Topology edits can rewrite UVs.
  - Face selection scopes the panel to selected islands.
  - No UV-editing UI is currently exposed in this panel.

- Create Texture:
  - Builds one packed scene atlas.
  - Rewrites part UVs as a branch edit.
  - Shows textured view after confirmation.
  - Dialog options:
    - Name.
    - Type: `Texture Template`, `Solid Color`, `Blank`.
    - Pixel Density: 16x, 32x, 64x, 128x.
    - Color for solid textures.
    - Rearrange UV.
    - Power-of-2 Size.
    - Keep Multi Texture Occupancy.
    - Combine Islands.
    - Edge Angle.
    - Island Angle.
    - Padding.
    - Dedupe Islands.

- Texture view:
  - Toggles between solid part colors and texture sampling.
  - Painted models sample the pixel paint texture in every mode, not only paint mode.

- Texture export:
  - Exports the whole atlas to `cart/hmsc-int/exports/`.
  - Uses model name when possible.
  - Adds numeric suffixes instead of overwriting.

- Texture import:
  - Imports edited PNGs back onto the model.
  - Whole-sheet imports replace the atlas image.
  - Slice imports apply only to one selected face island.
  - Small images are inlined as data URLs.
  - Large images are cached under content-addressed file paths.

- AI Fill:
  - Generates a whole sheet or selected face slice.
  - Can use current art as img2img reference.
  - Can generate from prompt only.
  - Prompt enhancement options:
    - Off.
    - Nano text model.
    - Claude worker.
  - Uses a nano-gpt API key stored in localstore.
  - Generated result is applied through the same texture-import path.

- Texture slots:
  - Face-mode section for named re-skinnable surfaces.
  - `+ slot from selection` creates a slot from selected faces.
  - Existing slots can be renamed.
  - Slot faces can be reselected.
  - Current selection can be added to a slot.
  - Slots can be deleted.
  - `unslot selection` clears selected faces from their slot.
  - Cook carries slots so the build editor can target those surfaces later.

## Paint Mode

- Paint activation:
  - Entering paint mode ensures a paint atlas exists.
  - The paint pack disables dedup so every face owns a distinct paintable island.
  - Hidden parts are included in the atlas pack so visibility changes do not shift paint.
  - Repacking happens when topology or UV sharing requires it.

- Universal BrushKit:
  - Studio uses the shared runtime paint kit, not a one-off painter.
  - Tools:
    - Brush.
    - Eraser.
    - Line.
    - Rectangle.
    - Ellipse.
    - Eyedropper.
    - Text.
  - Brush settings include size, color/ink, and the shared kit controls.
  - Line and shape tools show a drag ghost before commit.
  - Shift constrains lines and square/circle shapes.

- 3D surface freehand:
  - Brush and eraser raycast onto the model surface.
  - Dabs are applied in world-radius terms across faces.
  - Strokes interpolate along screen movement to avoid gaps.
  - Mirror painting duplicates dabs across enabled mirror axes.

- Lock face:
  - Keeps brush/eraser dabs inside the face currently under the cursor.
  - Off means freehand strokes can cross seams smoothly.

- Face fill:
  - Fills the hovered face island with one flat color.
  - Scissor-clips to the island.

- Fill all:
  - Fills the entire model texture with the current color in one operation.

- Eyedropper / sample:
  - Samples a color from the painted model.

- Text tool:
  - Text is placed as a movable layer.
  - Click places text on the model.
  - Drag moves the live text over the surface.
  - `place` bakes it into the texture.
  - `cancel` restores the surface underneath.
  - Brush size controls text scale.
  - Brush color controls text ink.

- Paint layers:
  - Bottom-to-top layer stack.
  - New layer starts transparent.
  - Supports select, rename, visibility, delete, duplicate, move up/down, and opacity.
  - Display is recomposited from visible layers.
  - Durable output flattens to the model paint blob on commit.
  - Reopened flattened paint collapses back to a single base layer.

- Palettes:
  - Model palette stores saved swatches and material slots.
  - Recents persist in shared localstore.
  - Named saved palettes persist in shared localstore.
  - Saved palette can be loaded into another model.
  - Current color can be saved into the model palette.

- Load from prop:
  - Loads a painted texture from a compiled prop back onto the open model.
  - Uses compiled prop texture blobs as durable backups.
  - Works best when the prop was compiled from the same model topology.

- Clear:
  - Clears all paint on the model.
  - Resets to a single base layer.

- Paint diagnostics:
  - Paint mode shows atlas size, textured/solid state, and cell count.
  - Internal diagnostic tracks UV overlap and repack need.

## Reference Backdrops

- Backdrop purpose:
  - Reference image planes for tracing over blueprints, photos, or concept art.
  - Rendered as translucent textured quads in the 3D scene.

- Add image:
  - Uses a native image picker through `zenity` when available.
  - Falls back to a typed file path.
  - Supports PNG/JPEG size detection directly from headers.
  - Preserves image aspect ratio.
  - Small images inline; large images use the same content-addressed cache strategy as textures.

- Backdrop planes:
  - `Front`
  - `Back`
  - `Left`
  - `Right`
  - `Top`
  - `Bottom`

- Backdrop controls:
  - Show/hide.
  - Flip left/right.
  - Remove.
  - Size slider.
  - Opacity slider.
  - Plane/orientation picker.
  - `Move` activates a transform gizmo in the viewport.

- Backdrop behavior:
  - Backdrop geometry is double-sided so it remains visible while orbiting.
  - Position changes do not rebake geometry.
  - Backdrops persist through localstore.
  - A diagnostic readout currently shows mount epoch, texture key, and position.

## Compile And Cooked Assets

- Compile Asset:
  - Cooks the Studio model into a typed installed asset.
  - Current ready kind is `Prop`.
  - Listed but not ready yet:
    - `Item`
    - `Vehicle part`
    - `Clothing`

- Prop nature:
  - `Static`: fixed obstacle, solid, wall-like tile donor, blocks movement/sight, gives cover.
  - `Foliage`: walk-through scenery, bush-like tile donor, conceals.
  - `Physics`: kickable dynamic body, solid, measured radius, authored bounce.

- Physics bounce:
  - Editable restitution from 0 to 1.
  - Body radius is derived from mesh footprint at cook time.

- Piece type:
  - `Prop`: free scenery.
  - `Wall`: wall catalog placement, edge snap, full cover, blocks sight.
  - `Railing`: edge snap, low cover.
  - `Fence`: edge snap, low cover.
  - `Floor`: grid snap, floor catalog placement.
  - `Stairs`: grid snap, stairs catalog placement.
  - `Trim`: surface snap, poster/molding-style placement.

- Cook behavior:
  - `cookProp` flattens all visible parts into one mesh blob.
  - Mesh blob is content-addressed.
  - Texture blob is referenced by hash when the model is painted.
  - Descriptor is separate from mesh and texture factors.
  - Footprint, height, radius, collision boxes, and physics body radius are derived from geometry.
  - Mounts ride into the cooked asset.
  - Texture slots ride into the cooked asset.
  - Glass faces are split into a trailing transparent range.
  - Compile installs into the cooked asset store and shows a toast summary.

## Diagnostics And Read-Only Panels

- UV panel:
  - Shows stored UV islands and selected-face islands.
  - Uses the same island coloring as texture export and viewport atlas.

- RIG panel:
  - Shows pivot state.
  - Lists joints with name, axis, spin mode, and position.
  - Lists anchors with name, role, facing, and position.
  - Edits metadata while the viewport handles placement.

- SHAPE panel:
  - Shows counts:
    - Vertices.
    - Faces.
    - Edges.
    - UV'd faces.
    - Mounts.
  - Shows pivot information.
  - Can expand per-face vertex loops.
  - Lists mounts.
  - Can copy exact encoded mesh JSON.
  - Can show raw JSON.

- Key legend:
  - Bottom overlay renders live Studio shortcut bindings.
  - Hotkeys panel can display or rebind Studio controls.

## Default Shortcuts

- General Studio:
  - `Esc`: clear selection, close the current popup, or finish moving a backdrop.
  - `Ctrl+A` / `Meta+A`: select all in active element mode.
  - `Delete` / `Backspace`: delete selected faces, selected joint, or selected pivot.
  - `F` / `Home`: reframe the model.

- Modes:
  - `1`: object.
  - `2`: vertex.
  - `3`: edge.
  - `4`: face.
  - `5`: rig.
  - `6`: paint.

- Transform tools:
  - `G`: move.
  - `R`: rotate.
  - `S`: resize.

- Mesh ops:
  - `E`: extrude selected face.
  - `C`: loop cut selected face.
  - `X`: flip selected face winding.
  - `B`: toggle selected faces as glass.
  - `D`: detach selected faces into a panel.
  - `O`: solidify selected faces in place.
  - `Y`: symmetrize, keeping the positive half.

- Paint tools:
  - `B`: brush.
  - `E`: eraser.
  - `L`: line.
  - `R`: rectangle.
  - `O`: ellipse.
  - `I`: eyedropper.
  - `T`: text.

## Source Map

- Active editor:
  - `cart/hmsc-int/editors/model/studiokit/StudioViewport.tsx`
  - `cart/hmsc-int/editors/model/studiokit/index.tsx`

- Workbench integration:
  - `cart/hmsc-int/editors/workbench/model/source.tsx`

- Model data:
  - `cart/hmsc-int/editors/model/studioModel.ts`
  - `cart/hmsc-int/editors/model/modelStream.ts`
  - `cart/hmsc-int/editors/model/editMesh.ts`

- Selection and transforms:
  - `cart/hmsc-int/editors/model/meshSelect.tsx`
  - `cart/hmsc-int/editors/model/meshGizmo.tsx`
  - `cart/hmsc-int/editors/model/meshRig.tsx`

- Texture and paint:
  - `cart/hmsc-int/editors/model/textureize.ts`
  - `cart/hmsc-int/editors/model/TextureAtlas.tsx`
  - `cart/hmsc-int/editors/model/meshPaint.tsx`
  - `cart/hmsc-int/editors/model/meshPaintTexture.ts`
  - `cart/hmsc-int/editors/model/textureGen.ts`
  - `cart/hmsc-int/editors/model/paintPalettes.ts`

- Compile:
  - `cart/hmsc-int/editors/model/cookedAsset.ts`
  - `cart/hmsc-int/editors/model/cookedAssets.ts`
  - `cart/hmsc-int/editors/model/cookedAssetStream.ts`

- Panels and dialogs:
  - `cart/hmsc-int/editors/model/Outliner.tsx`
  - `cart/hmsc-int/editors/model/UVPanel.tsx`
  - `cart/hmsc-int/editors/model/RigMetaPanel.tsx`
  - `cart/hmsc-int/editors/model/ShapePanel.tsx`
  - `cart/hmsc-int/editors/model/Backdrops.tsx`
  - `cart/hmsc-int/editors/model/studiokit/dialogs/*.tsx`

- Prior design/build history:
  - `cart/hmsc-int/editors/MESH_EDITOR_PLAYBOOK.md`
  - `docs/game/HMSC_INT_ASSET_PIPELINE.md`
