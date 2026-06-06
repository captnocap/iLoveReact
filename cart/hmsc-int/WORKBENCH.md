# WORKBENCH.md — the shared component shape (proposal, 2026-06-05)

The hmsc-int UI rework: every editor surface rebuilt fresh on ONE frame, made
from the intention of all of them in harmony — not an amalgamation of twelve
route dialects retrofitted after the fact. Wireframed and user-approved in
`cart/hmsc-wire/` (W1 chrome · W2 asset editor · W3 settings+logs).

This document is the end-to-end accountability ledger: the contract we build,
where every piece of TODAY's UI goes, and the order it happens in. If a file
isn't in the ledger, that's a bug in this document.

---

## 1. The shape

```
┌──────────────────────────────────────────────────────────────┐
│ CHROME  brand · map pill · new · ‹drag› · nav · undo · compile│ ← titlebar
│         · save · ─ □ ×                                        │
├──┬─────┬──────────┬───────────────────────────────────────────┤
│1 │ 2   │ 3        │ 4                                         │
│c │ ros │ props    │ THE DEMONSTRATION SURFACE                 │
│a │ ter │ panel    │                                           │
│t │     │ (knobs)  │                                           │
└──┴─────┴──────────┴───────────────────────────────────────────┘
 46  170    290        flexGrow
```

### The three laws (user-ruled)

1. **Column 3 edits. Column 4 demonstrates.** The stage receives values and
   exposes nothing. No control ever lives inside a preview/rig/stream.
2. **The preview bar holds LENSES only** (3D/2D ⇄ PAINT, ALL ⇄ channel, fit ⇄
   actual). A lens changes how you look; a property changes what is. Lenses in
   the bar, properties in gutter 3, never crossed.
3. **No dead space.** Column 4's content is the point of the page — it reads at
   full size (terminal-size log rows, full-bleed previews) and idle width gets
   spent on demonstrative dashboards (the logs stat band), never left black.

Column 4 is *not* "the 3D preview": assets demonstrate by RENDERING, settings
demonstrate by ACTING (physics = live jump rig, world = day-cycle relight),
logs demonstrate by STREAMING. One frame holds all three.

---

## 2. The contract

New files, all under `cart/hmsc-int/shell/` (the existing shell dir). The
classes graduated from `cart/hmsc-wire/wire.cls.ts` into an ADDITIVE sheet —
`shell/workbench.cls.ts` — rather than edits to `studio.cls.ts`: the classifier
registry is global per cart, so a new sheet registers new names and reuses
studio's existing control/panel kit (Toggle*/Slider*/Stepper*/Segment*/
ColorSwatch, Group*/Field*/Hero*, EmptyState) without touching the shared file.
Zero pre-existing files change during the build except two additive lines
(route mount + nav button).

```
shell/workbench.cls.ts — LANDED. The additive vocabulary: Chrome*/Win* strip,
                         CatRail/ItemRail/PropsCol/PreviewCol gutters, Lens*
                         (the bar's only widgets), Stage*, Stat*/Spark/Log*/
                         SelBar, ToolRail kit.
shell/Workbench.tsx    — LANDED. The four gutters. Pure layout: renders
                         WorkbenchSource[], owns selection/lens/filter/rev
                         state, knows zero category names.
shell/fields.tsx       — LANDED. ONE field renderer: FieldSpec/PanelSpec types
                         + typed controls (toggle / drag-slider / stepper /
                         enum segment / color swatch / value) via studio.cls.
shell/stage.tsx        — LANDED. LensBar (lens segments) + EmptyStage; rig and
                         log-stream components land with their sources.
shell/WorkbenchRoute.tsx — LANDED. Mounted at /workbench alongside every
                         existing route; sources arrive from
                         editors/workbench/sources.ts (shell stays generic).
shell/chrome.tsx       — LANDED (WBCHROME-0606). The W1 strip with window
                         controls (__window_minimize/maximize/close +
                         windowDrag); replaced ProjectBar.tsx at the swap
                         (MapsMenu/EventLog overlays carried over intact).
```

### WorkbenchSource — what a category implements

```ts
interface WorkbenchSource<S> {
  id: string;                    // 'character' | 'item' | ... | 'logs'
  icon: string; kicker: string;
  list(): RosterRow[];           // gutter 2 (+ filter; selection per source)
  select(rowId: string): S;      // resolve the subject
  panel(subject: S): PanelSpec;  // gutter 3 — a SPEC, not JSX
  stage(subject: S, lens: string): ReactNode;  // column 4 — receives, never edits
  lenses(subject: S): LensSpec[];              // what the preview bar offers
  actions?(subject: S): ActionSpec[];          // hero-bar verbs (save/export/clone)
}

interface PanelSpec { groups: Array<{ title: string; fields: FieldSpec[] }> }
type FieldSpec =
  | { k: string; t: 'bool';   get(): boolean;            set(v: boolean): void }
  | { k: string; t: 'num';    get(): number; step: number; min: number; max: number; precision: number; set(v: number): void }
  | { k: string; t: 'slider'; get(): number; min: number; max: number; show(v: number): string; set(v: number): void }
  | { k: string; t: 'enum';   get(): string; opts: string[]; set(v: string): void }
  | { k: string; t: 'color';  get(): string;             set(v: string): void }
  | { k: string; t: 'val';    get(): string }            // read-only display
```

Key properties of the contract:

- **The panel is data.** One renderer draws every category; "add an editor"
  means writing a source, not a layout. The `num` shape is deliberately the
  tunables registry's shape (`min/max/step/precision`) — settings sources
  generate their specs straight from `editorTunables()`, assets generate
  theirs from draft/garage setters. Same protocol end to end.
- **Setters are the only write path** (the wireframe's FieldBind, made total).
  A stage that wants interactivity (drag a vertex, paint a stroke) owns its
  input *inside its own surface* — but parameter edits round-trip through the
  panel spec so undo/sessions/autosave see one door.
- **Sources keep their persistence.** Drafts, rosters, streams, tunables — all
  already route-independent (see §4). The Workbench never persists anything.

---

## 3. What the nav becomes

Today's 13 flat icons → 6. The chrome gains window controls.

| today (13)                          | proposed (6)                          |
|-------------------------------------|---------------------------------------|
| editor                              | **editor** (map quad — own surface)   |
| test (play)                         | **play** (own surface)                |
| labs                                | **labs** (own surface)                |
| characters · items · vehicles ·     | **assets** (Workbench: character /    |
| textures · cutout · voxels ·        | item / vehicle / material gutter-1    |
| compose                             | categories + PAINT — the AGNOSTIC     |
|                                     | painting surface (AGNOSTICPAINT-0606, |
|                                     | USER RULING: "any thing at all is all |
|                                     | just the same thing at this level" —  |
|                                     | one bench paints figures, vehicles,   |
|                                     | materials, documents, blanks; per-    |
|                                     | source PAINT lenses are doorways into |
|                                     | the same bench; MATERIALIZE routes    |
|                                     | output by family). compose + shader   |
|                                     | lab = material stage modes, voxels =  |
|                                     | item SCULPT mode*)                    |
| settings · log                      | **settings** (Workbench: domains +    |
|                                     | logs domain)                          |
| assist3d                            | **assist3d** (own surface; candidate  |
|                                     | to fold into labs later*)             |

`*` = proposed, not yet user-ruled — see §7 open questions.

---

## 4. The machinery that survives untouched

The rebuild is VIEW-LAYER ONLY. These are already route-independent and become
the sources' backing stores. Zero edits expected (additions only where a spec
getter/setter is missing):

| layer | files | feeds |
|---|---|---|
| sessions / streams | `editors/sessions.ts`, `editors/store.ts`, `editors/twigs.ts`, `editors/tunables.ts`, `editors/*/stream.ts` (characters? · items · voxels · materials · cutout · world), `editors/settings/bus.ts` | settings domains, logs channels, every source's autosave |
| character authoring | `editors/characters/{draft,roster,generate,regions,animPresets,paintKit,grabKit}.ts` | character source |
| item authoring | `editors/items/{bake,stream}.ts`, `editors/voxels/stream.ts` | item source |
| vehicle authoring | `editors/vehicles/edits.ts` (+ garage store in route — extract) | vehicle source |
| material pipeline | `game/textures/{shaders,materials,registry}.ts` (+ `index.ts`, CAPTURE.md) | material source |
| paint engine | `editors/paint/{usePaintEditor,layers,strokes,history,surfaces,colors,tuning}.ts`, `editors/paint/backends/` | PAINT lens (all assets) |
| cutout extraction | `editors/cutout/{extraction,models,sources,draft,stream}.ts` | PAINT lens save path |
| compose/decals | `editors/compose` doc model (inside ComposeRoute today — extract) | material source (decal mode) |
| play/build logic | `editors/play` state, `editors/build/{snap,commits,viewport}`, `game/*` | play surface (unchanged) |
| map editor world | `chunks,heightData,tileData,zoneData,mapStore,projects,editorWorld,chunkFloor,placements,tileOverrides,buildingEditor,objectPreview,kindTextures,editLog,worldFile,address,brush,usePaintedField,assets,assetPrompt,perfLog` (.ts) | map editor (unchanged) + logs domain (editLog, perfLog rings) |
| lab env / chrome kit | `game/chrome/` (LabEnvironment, sky presets) | settings rigs' scene dressing |
| theme | `theme.ts` (STUDIO_COLORS/STYLES) | everything |

Tests pinned to those modules (`*.test.ts`) all keep passing — nothing they
test moves.

---

## 5. END-TO-END ACCOUNTABILITY LEDGER (today's UI files)

Disposition key: **KEEP** = survives as-is · **EXTRACT** = logic lifts into a
source, shell dies · **FOLD** = absorbed into a Workbench source/lens ·
**DIE** = deleted at flip · **OWN** = stays its own surface (not Workbench).

### Routes

| file | lines | disposition |
|---|---|---|
| `index.tsx` (EditorShell, routes, map-editor wiring) | 958 | **KEEP/SHRINK** — stays the cart root + map editor host; route table shrinks to 6; ~~ProjectBar swap → `shell/chrome.tsx`~~ DONE (WBCHROME-0606) |
| `editors/characters/CharactersRoute.tsx` | 1141 | **EXTRACT→DIE** — chip-row layout dies; roster/draft wiring → character source |
| `editors/items/ItemsRoute.tsx` | 627 | **EXTRACT→DIE** — → item source |
| `editors/vehicles/VehiclesRoute.tsx` | 508 | **EXTRACT→DIE** — garage store lifts to `editors/vehicles/garage.ts`; → vehicle source |
| `editors/cutout/CutoutRoute.tsx` | 1159 | **EXTRACT→DIE** — becomes the PAINT lens of every asset source; library rail logic → cutout source files |
| `TextureStudio.tsx` | 188 | **FOLD→DIE** — material source: catalog rail = roster, Materialize = action, ShaderLab = stage mode |
| `editors/compose/ComposeRoute.tsx` | 455 | **EXTRACT→FOLD** — decal doc model extracts; stage/layers/3D-billboard = material source's COMPOSE stage mode; layers+props panel becomes PanelSpec |
| `VoxelHybridRoute.tsx` | 610 | **FOLD→DIE\*** — proposed: item source's SCULPT stage mode (ITEMSCULPT already made voxels the item input) |
| `editors/settings/SettingsRoute.tsx` | 221 | **FOLD→DIE** — settings sources generate from `tunables.ts` + `bus.ts`; the two-column page dies |
| `LogView.tsx` | 109 | **FOLD→DIE** — logs domain churn channel (perfLog ring) |
| `editors/play/PlayRoute.tsx` | 1034 | **OWN** — fullscreen game surface; F1/F2 modes; untouched |
| `shell/LabsRoute.tsx` | 99 | **OWN** — registry list → lab mount; untouched |
| `assist3d/Assist3DRoute.tsx` (+ `AssistMeshViewer`, `BackendBar`, `SceneSurface`, hooks) | — | **OWN\*** — stays; candidate to fold into labs later |

### Map-editor pane components (the quad — own surface, all KEEP)

| file | role |
|---|---|
| `QuadSplit.tsx` (133) | 2×2 pane grid + dividers |
| `PaintCanvas.tsx` (1305) | the 2D authoring canvas |
| `BrushRail.tsx` (215) · `railAtoms.tsx` (173) | canvas tool rail (future: re-skin on studio.cls atoms) |
| `ChunkSurface.tsx` (118) · `heightTileView.wgsl.ts` · `tileField.wgsl.ts` · `heightField.wgsl.ts` · `zoneView.wgsl.ts` | canvas render surfaces/shaders |
| `IsoPreview.tsx` (228) | the 3D preview pane |
| `PropertiesPanel.tsx` (716) | in-focus inspector — ALREADY on studio.cls; its Group/FieldStrip classes are the ones the Workbench panel shares |
| `RightPanel.tsx` (85) + `tabs/{ObjectsTab,ChatTab,NotesTab,SettingsTab}.tsx` | right rail. ObjectsTab (370) keeps serving placeables; its embedded ShaderLab/TexturePreview usage re-points at the material source's shared pieces |
| `ProjectBar.tsx` (264) | **DIED** (WBCHROME-0606) — replaced by `shell/chrome.tsx` (same shape + window controls; MapsMenu/EventLog overlays carried over; line-referenced parity table in the landing commit `34400c6e7`) |
| `ShaderLab.tsx` (189) | **KEEP/SHARE** — param lab becomes a material-source stage mode AND stays embeddable (ObjectsTab) |
| `TexturePreview.tsx` (33) · `ModelViewer.tsx` (152) · `ObjectInspect3D.tsx` (176) | **KEEP** — preview atoms; ModelViewer/ObjectInspect3D also serve asset stages |
| `Embodied.tsx` (709) · `EmbodiedHud.tsx` (373) | **KEEP** — play surface internals |
| `_panel_preview.html` · `_studio_*.html` · `properties-panel-interpretations.html` | **KEEP** — historical mockups (reference only) |

### Asset-editor internals

| file | disposition |
|---|---|
| `editors/characters/{preview,controls}.tsx` | **KEEP** — preview.tsx = character stage; controls.tsx re-renders via shared fields or retires if fully spec-covered |
| `editors/cutout/{Inspector,ModelPreview,ToolRail,StatusBar}.tsx` | **EXTRACT** — ToolRail/StatusBar shapes → `shell/stage.tsx` paint kit; ModelPreview → PAINT lens model view; Inspector's editable bits → PanelSpec |
| `editors/paint/{PaintSurface,PaintControls,ColorWheel}.tsx` | **KEEP** — the painter THE PAINT lens mounts; ColorWheel/PaintControls re-skin on studio.cls in place |

### Wireframes

| file | disposition |
|---|---|
| `cart/hmsc-wire/wire.cls.ts` | **GRADUATE→DIE** — classes move into `studio.cls.ts` verbatim, then the wire cart deletes |
| `cart/hmsc-wire/index.tsx` + `cart.json` | **DIE after graduation** — reference until parity, then delete (it answers "what was intended" during the build) |

---

## 6. Migration order

Additive landings, per-category flips, one deletion per parity. Never a big
bang; the old route works until the minute its replacement does.

1. ~~**Graduate the vocabulary.**~~ DONE — wire.cls.ts → `shell/workbench.cls.ts`
   (additive sheet; studio.cls untouched, its control/panel kit reused).
2. ~~**`shell/chrome.tsx`.**~~ DONE (WBCHROME-0606) — new strip with window
   controls replaced ProjectBar in index.tsx (same props, MapsMenu/EventLog
   carried over). ProjectBar.tsx dead. First visible win; map editor untouched.
3. ~~**Frame at a separate route.**~~ DONE — `shell/{Workbench,fields,stage,
   WorkbenchRoute}.tsx` mounted at `/workbench` (temporary Columns3 nav icon)
   alongside everything existing, with `editors/workbench/tunablesSource.ts`
   as the live proof source (panel generated from the tunables registry,
   write-through). Touches to pre-existing files: 2 additive edits
   (index.tsx route+handler, ProjectBar button) — both die at the flip.
4. ~~**Character source**~~ BUILT (WBCHAR-0606, awaiting user test): the
   coverage-law parity table lives at `editors/workbench/WBCHAR.CAPTURE.md`
   (every CharactersRoute capability line-referenced; zero open deferrals —
   K4 live-3D-in-PAINT-lens and K5 workbench-scoped slot book both user-ruled
   in). `editors/workbench/characters/{store.ts,panel.ts,source.tsx,Stage.tsx,
   PaintLens.tsx}` + 13-test P4 suite; CHARACTER is live on /workbench
   (FIGURE/PART grab-sculpt · SCULPT canvas · PAINT in-page with live 3D).
   The FLIP (`/characters` route + nav icon die) is a separate commit on the
   user's word — the route is untouched today.
5. **Item source** (+ ruled-in voxel SCULPT mode → VoxelHybridRoute dies).
   Flip: `/items`, `/voxels`.
6. **Vehicle source.** Flip: `/vehicles`.
7. **Material source** (roster = stored materials + shader recipes + decals;
   stage modes: PREVIEW / SHADER LAB / COMPOSE; Materialize = action). Flip:
   `/textures`, `/compose`.
8. **Cutout retirement — RE-SEQUENCED (AGNOSTICPAINT-0606).** /cutout dies
   as soon as the AGNOSTIC PAINT surface passes the user's test (one bench:
   shirt + car door + material + blank canvas + materialize) — NOT after
   all-four-source parity. USER-RULED, to kill split-brain updates. /cutout
   is FROZEN until that flip (its CAPTURE carries the note; the supervisor
   rejects /cutout-touching commits). The bench is LIVE on /workbench
   (editors/workbench/paint/, parity table AGNOSTICPAINT.CAPTURE.md);
   remaining at the flip: EffectModal extracts from the frozen route.
9. **Settings + logs sources** (panel generated from tunables registry; rigs;
   log stream with dashboard band + select/copy). Flip: `/settings`, `/log`.
10. **Chrome collapse** to 6 icons. Delete `cart/hmsc-wire/`. Done.

Each flip's commit deletes the old route file(s), updates this ledger, and
updates `docs/game/` per the maintenance contract.

---

## 7. Open questions (need a ruling before their step)

1. **Voxels → item SCULPT mode** (step 5): ITEMSCULPT-0606 already made voxel
   blockouts the item input — assuming VoxelHybridRoute's standalone surface
   has nothing left that items doesn't cover. Confirm before deleting.
2. **assist3d**: stays its own route here. Fold into labs later? Not blocking.
3. **Map-editor convergence**: the quad's PropertiesPanel and the Workbench
   panel share classes today and should eventually share `shell/fields.tsx` —
   in-scope for the rebuild, or a follow-up? (Proposed: follow-up; the quad is
   load-bearing daily.)
4. **xl breakpoints**: gutters are fixed 46/170/290 — on a 4K monitor the frame
   reads sparse. Classifier `bp.xl` overrides can widen gutters + bump type
   scale with zero component edits. When?

---

## 8. Invariants & risks

- **Parallel sessions are hot in these files** (cutout/paint/compose lanes
  active). Everything lands additively; flips are single-commit, coordinated;
  never rebase someone's open lane away.
- **Hot reload is the dev loop** — every step verifiable in the running host;
  framework/ is untouched (windowDrag + __window_* + __clipboard_set already
  exist), so no rebuilds are forced by this work.
- **Sessions/undo/autosave** flow through existing stores; the Workbench owns
  only ephemeral view state (selection, lens). If a source needs new
  persistence it adds a stream the V20 way — by addition.
- **No duplication**: one field renderer, one painter, one stage kit. A second
  implementation of any of these appearing during migration is a review-blocker.
