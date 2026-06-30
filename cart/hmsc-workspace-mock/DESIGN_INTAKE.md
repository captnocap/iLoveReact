# HMSC Workspace Mock Design Intake

Created: 2026-06-30

Purpose: capture every disliked area the user shares before doing another design
pass. Do not implement from a single screenshot in isolation. Ask what feels
wrong, record the answers, infer the pattern, then address related areas in one
sweep.

## Running Rules

- Every screenshot gets its own numbered intake item.
- Record the user's exact complaint before proposing fixes.
- Separate confirmed user answers from provisional deductions.
- Treat the mock as an interactive app shell backed by mock state, not as a
  static drawing.
- File menus remain the text/source-of-truth command registry. Icon/action
  surfaces mirror those commands.

## Global Workspace Doctrine

These rules apply across the whole mock/refactor, not just one panel.

### Visual Assets And Performance

- Asset lists should stay visual whenever possible. The editor should be highly
  user-friendly, but still built with heavy performance considerations so it can
  do real work.
- Visual catalogs must be designed for scale: paging, virtualization/static
  surface strategies, cached previews, and no expensive per-card bespoke render
  paths.
- Performance is not an excuse to make the asset browser abstract or text-only;
  it is a requirement to build the visual browser correctly.

### Shared Tools And Controls

- Start with one core brush set. Any surface that uses brushes uses that shared
  brush system. No separate half-compatible brush implementations.
- Shared control primitives are mandatory: sliders, buttons, select menus,
  toggles, icon buttons, table rows, toolbars, brush controls, and similar
  controls must come from one place.
- No one-off button sizes, no local slider variants, no ad hoc control styling.
  If a control shape does not have a home, create the shared home first.
- Anything that appears twice becomes a helper/component/system. Duplication is
  a design and maintenance bug.

### Styling And File Boundaries

- No inline styles for real implementation work. Styles must come through
  classifiers/shared style systems.
- No god files. The largest React entry file should still read as a clean set of
  small React components passing props from a central entrypoint.
- React files should have one export. TypeScript logic/data files may have many
  exports.
- Keep JSX easy to read. Components own presentation; logic/data helpers live in
  logic files.

### React Is UI Authoring; Tools Are Host-Owned

- React/TSX is the interface authoring layer. Its job is to render the editor
  chrome, panels, menus, inspectors, popovers, preview sockets, command surfaces,
  and temporary mock state needed to design those surfaces.
- React is not the owner of actual editor capability. Placement, snapping,
  movement, deletion, model import, model preview, rigging, texture atlas work,
  painting effects, shader/material evaluation, RLE encode/decode, dithering,
  pathing, collision, diagnostics, autosave, file IO, multiplayer sync, and
  compile/export behavior must be host-owned systems or data contracts consumed
  by host-owned systems.
- Production flow should read as:
  `React UI -> command/eventbus event -> host/native tool -> diagnostics/events -> React summary`.
  React may present and route the command, but the native tool owns execution,
  validation, timing, persistence, and failure reporting.
- Mock data is allowed only to make menus, panels, overlays, and state changes
  inspectable during design. Mock data is not permission to hide a real tool
  algorithm inside the UI layer.
- Any capability temporarily implemented in React because the host version does
  not exist yet must be labeled as a mock, preview shim, or adapter and must name
  the future host/native owner. Unlabeled React-side tool logic is architecture
  drift.
- Host-owned does not mean invisible. Every host tool still needs a first-class
  UI surface, menu entry, keybinding, icon, context-menu action, diagnostics
  channel, and eventbus contract. React owns those authoring affordances; the
  host owns the work.
- The command registry/file menus are the user-facing source of truth by name.
  Action bars, icons, context menus, hotkeys, and popovers mirror the same
  registry entries instead of inventing separate feature paths.
- Native preview sockets are the expected shape for expensive visual tools. The
  UI reserves and controls the viewport; the host renders model/material/shader
  truth into it.

### Eventbus Direction

- Everything should go through an eventbus. Actions travel into and out of the
  bus rather than directly mutating isolated local systems.
- The future goal includes multiplayer game editing: a host can invite a friend
  into the editor and both can work together. That requires event-shaped
  authoring where every meaningful change is bus-visible.
- Current design direction: do not model every feature as its own persistent
  undo/redo history. Prefer an eventbus with in-memory persistence plus autosave
  and backup capabilities.
- Reconciliation note: the current oracle still contains V20's older
  "unbreakable total cross-session history" language. Before implementation,
  this new eventbus/autosave/backup direction needs to be reconciled with that
  decision, likely by redefining history around eventbus events, autosave, and
  backup snapshots rather than feature-local undo stacks.
- Concrete reason V20 is considered wrong now: the V20 approach was implemented,
  but the user never actually had usable session rewind capability.
- The user also did not have reliable "leave route and come back" undo history,
  and barely had useful hot-reload history.
- Even if the codebase contains capability to rewind, it was not exposed
  properly to the user. Capability that exists internally but cannot be reached
  through the product does not count as a successful approach.
- The user has learned to work around the missing rewind/history affordance, so
  the new design should not optimize around invisible total-history promises.
- Any future history/recovery system must be surfaced as a clear user-facing
  workflow. If it cannot be operated without spelunking implementation details,
  it is not the right design.
- Implementation implication: eventbus/autosave/backups should prioritize
  observable, recoverable editor behavior over an abstract persistent undo chain.

### First-Class Instrumentation

- Every feature/tool/system must ship with its own timing recordings and debug
  signals from the start. Instrumentation is part of the feature contract, not a
  later cleanup pass.
- Debugging stays built in. Do not rely on temporary one-off debug panels,
  scattered logs, or rebuild-only probes that have to be re-added every time a
  system misbehaves.
- Each meaningful authoring action should be observable through shared
  diagnostics: start time, commit/apply time, render/update time, autosave or
  backup time when relevant, event count, affected ids/chunks, failure state,
  and a compact human-readable label.
- Timing data must be cheap enough to leave enabled during normal authoring.
  Hot paths should emit aggregate or sampled measurements through the shared
  diagnostics channel instead of expensive per-frame noise.
- The eventbus, bottom dock, build journal, and debug popovers should read from
  the same instrumentation stream. There should not be separate per-feature
  debug islands that drift from the real system.
- The purpose is faster diagnosis while working: when placement, editing,
  material changes, imports, play validation, or native tools slow down, the
  editor should already show where the time went without requiring another
  rebuild just to add logging.

### Diagnostics Registry And Raw Console

- Every logging/debugging stream must register through one diagnostics registry.
  Direct one-off logs, private debug sinks, ad hoc stdout-only traces, and
  feature-local consoles are not acceptable product architecture.
- The registry owns the channel list, labels, descriptions, cost tier,
  default-on/off state, current toggle state, and allowed sinks for every debug
  stream.
- The settings UI should be able to render every debug channel as a searchable
  menu of toggles from registry metadata. Adding a new debug stream means adding
  it to the registry first.
- The editor needs a z-indexed in-app raw console overlay fed by that same
  registry. It should show the unfiltered/filtered raw feed in a copyable text
  form so the user can paste it into an agent prompt without caring whether
  anything reached terminal stdout.
- The raw console should support at minimum: channel filter, severity filter,
  pause/resume, clear view, copy visible feed, copy recent N entries, and jump
  to the setting toggle for a channel.
- The raw console should also support creating a named log capture from the
  current feed/window. A capture preserves channels, filters, time range, build
  id, request id when known, active map/context, and a short user/agent note.
- Captures can be attached directly to an ongoing bug/build thread from the
  console, so a useful diagnostic slice becomes part of the traceable build
  history without manual file hunting.
- Runtime logs may still write to structured files or stdout as secondary
  sinks, but those are implementation details. The user-facing debugging path is
  the registry plus in-app console.
- Hot-path channels must stay cheap: disabled channels are a branch, enabled
  high-frequency channels aggregate/throttle/sample before emitting. The
  registry should expose this cost tier so expensive channels are obvious.

### Placement Latency, Memory, And Recompute

- Placement, edit, move, rotate, reskin, and delete must feel like game input.
  The visual result should appear immediately, without waiting for full world
  assembly, bake, snapshot materialization, or route-level history machinery.
- The editor itself should behave like a game loop that authors a game:
  command input -> eventbus event -> compact authoring-state delta -> live render
  delta -> panels/status update from summaries.
- Empty-map placement and rich-map placement should have effectively the same
  authoring delta. If a single edit gets slower as the authored city grows, the
  implementation is touching too much state.
- Memory should be spent on compact hot indices that prevent world-scale scans:
  by-id piece maps, by-chunk/spatial indices, selected-id sets, dirty ids, dirty
  chunks, baked signatures, and small live-overlay/material caches.
- Memory should not be spent keeping full rendered worlds, full expanded
  geometry, full per-edit GameState snapshots, or entire undo histories resident
  just to make the next edit feel instant.
- Recompute is correct for derived/cold products: compiled GameState assembly,
  baked geometry, RLE/mapfile output, collision/pathing rebuilds, materialized
  snapshots, searchable history, and session rewind inspection.
- Hot placement should operate on semantic source data, not expanded render
  data. Example: placing a wall appends one semantic `piecePlaced` event and
  pushes one live overlay delta; it does not rebuild every piece in the city.
- Undo/redo should be event-shaped or inverse-event-shaped through the eventbus.
  Full historical rewind can be supported as a cold inspection/recovery path,
  but normal undo cannot depend on whole-state snapshots or hidden internals.
- Existing architecture to preserve: deferred snapshots, snapshot-plus-tail
  boot, live overlay feedback, semantic building instances, and one-event
  building moves.
- Existing shape to eliminate over time: any single edit path that copies,
  filters, scans, or rebuilds the whole authored world when only one object or
  chunk changed.
- Movement and deletion controls must use the same precision and semantics as
  placement. It is unacceptable to place freely but move/delete through a
  different or more constrained model.
- The bottom dock telemetry should make this doctrine visible: avg edit time,
  p95 edit time, latest edit timing, empty-map cost, rich-map cost, rich-map
  delta, event count, autosave state, and undo/checkpoint state.
- Performance gates should fail on scaling behavior, not just absolute timing.
  A 10 ms edit on an empty map and a 200 ms edit on a rich map is a design bug
  even if both paths eventually produce the correct result.

## 01 - Inspector Panel

Source image: `/tmp/codex-clipboard-63CPtT.png`

What was shared:

- Right inspector panel from `cart/hmsc-workspace-mock`.
- Selected object appears to be `TILE / Grass`.
- Header shows object kind, title, and color swatch.
- Metric row: `height m`, `opacity`, `lightThru`, `friction`.
- Sections shown: `PATHING`, `VISIBILITY`, `MISSION`, `FEATURE PIPELINE`.
- Field values are displayed as small boxed chips aligned on the right.

User complaint:

- The panel looks configurable, but the shown fields are not actually
  configurable. That mismatch exists in the current app too.
- Boxed value chips would be valuable if they were genuinely editable, but only
  with a clean editing surface that stays out of the way. Avoid bulky buttons,
  oversized sliders, giant value displays, or heavy controls.
- Immutable data is also valuable, but it needs to feel immutable rather than
  pretending to be editable.
- Sections should not appear unless applicable to the focused thing. Focus can
  be a tile, building piece, multiple pieces, prop, mission marker, NPC pathing,
  or many other object faces.

Questions to answer:

1. Is the main problem density, hierarchy, visual styling, or the actual
   information model?
2. Should this panel feel more like Photoshop's properties panel, a game-editor
   entity inspector, or a compact spreadsheet/property grid?
3. Are the boxed right-side values useful because they imply controls, or noisy
   because everything looks equally clickable?
4. Should sections like `PATHING`, `VISIBILITY`, and `MISSION` be visible for
   every object, or should the panel change hard based on selected object type?
5. Does `FEATURE PIPELINE` belong in the inspector at all, or should it live in a
   command/feature registry surface elsewhere?
6. Is the header too small/weak for the selected object, or is the problem that
   the body fields do not clearly explain what is being inspected?
7. Should metrics be editable controls, read-only diagnostics, or promoted into
   a graph/visual summary?

Provisional deductions:

- The current panel likely over-flattens unrelated concerns. Gameplay fields,
  mission wiring, command pipeline status, and physical tile metrics all share
  the same visual weight.
- The boxed values imply control affordances, but many values may be read-only
  or diagnostic. That makes the panel feel noisier than it is useful.
- The inspector may need stronger object-type modes: tile inspector, piece
  inspector, mission marker inspector, and command pipeline inspector should not
  all look like one generic key/value list.
- The panel currently lacks a clear primary task. It says many true things about
  Grass, but it does not make the next action obvious.

Confirmed answers:

- Affordance rule: any field that visually reads as configurable must either
  actually edit its value or be restyled as clearly immutable.
- Editable controls are acceptable only if the edit surface is clean, compact,
  and out of the way.
- Immutable information has real value, but must be presented as read-only data,
  not as fake controls.
- Applicability rule: inspector sections are focus-derived. Do not show
  `PATHING`, `VISIBILITY`, `MISSION`, etc. unless that section is meaningful for
  the current focus.
- Focus is polymorphic. The inspector must handle tiles, single building pieces,
  multi-piece selections, props, mission markers, NPC pathing, and other future
  object faces without collapsing them into one generic property sheet.
- Most editable values should not expose raw numbers directly in the inspector.
  Example: a `speed` variable should usually edit as a select menu with
  meaningful presets such as `default`, `fast`, or `slow`.
- Preset options must come from another authored setting surface such as game
  defaults/tunables. The inspector should choose a preset or mark a custom
  override, not invent isolated magic numbers.
- Named presets can still be factors over fixed numbers underneath. The
  inspector should express authoring intent (`fast`, `slow`, `default`) while
  the defaults/tuning surface owns the numeric values.
- Immutable data can and should consume more horizontal space. It can often be
  presented as a table of data or mini spreadsheet rather than a narrow vertical
  property stack.
- Multi-selection should do due diligence for the selected item family, but the
  future editor should avoid invalid mixed authoring modes in the first place.
  For example, placing wall pieces and prop pieces are separate workflows, so a
  prop plus building-piece mixed inspector should usually not arise.
- Tooltips are always valuable. The inspector can hide underlying raw numbers in
  the main row while revealing them through hover/detail affordances.
- Defaults/tunables should live in another menu/surface that opens inside the
  same workspace without disrupting flow.
- That defaults surface should work like an instant modal overlay or command
  interface: hotkey it, type a term such as `gravity`, and see global values for
  gravity at the top followed by related data around gravity.
- Immutable tables should be dense, searchable, filterable, and favorites-aware.
  Favorite properties should always surface at the top.
- Dense immutable data should use horizontal space inside the constrained panel,
  but should not require sideways scrolling to find data.
- The table/spreadsheet presentation needs to remain professional: compact and
  scannable, not a sprawling raw grid.
- Do not over-label preset provenance in the main row. Showing source labels
  like `game default` or `local override` inline is overkill as long as hover
  reveals the actual value and the value can be overridden/customized through the
  defaults flow.

Updated deductions:

- The inspector needs a typed focus model before layout decisions: every panel
  section should declare which focus faces it applies to and whether its fields
  are editable, immutable, or diagnostic.
- Visual language should split three states:
  - immutable facts: plain values, low chrome, no input border;
  - editable scalars/enums: compact inline edit affordance, likely activated on
    click/focus instead of always showing a control;
  - actions: explicit command buttons, not value chips.
- The current boxed values are ambiguous because they use action/control chrome
  for both immutable and editable values.
- Bulk/multi-selection needs its own inspector face. It should not pretend a
  mixed selection is one object; it should surface shared editable fields,
  mixed-value indicators, and aggregate read-only facts.
- Feature pipeline status probably does not belong in this object's inspector
  unless the focused thing is a feature/command. For normal world selections it
  should move to the command registry/action surface.
- The inspector should not be the canonical numeric tuning surface. It should
  point at defaults/presets and expose local overrides where they are meaningful.
- A clean edit surface probably means a compact select/dropdown, override chip,
  or inline popover, not a persistent slider/control row.
- Read-only inspector layouts can be wider and more tabular. The current narrow
  right-column layout underuses horizontal scanning and makes immutable facts
  feel like controls.
- Selection compatibility is partly enforced by the tool mode. The inspector can
  assume coherent authoring selections more often than generic design tools do.
- Tooltips are the right place to reveal implementation detail such as the raw
  numeric value behind a named preset. Main rows can stay semantic while still
  making the numeric substrate discoverable.
- Main preset rows should stay visually simple. Avoid always-visible provenance
  clutter; reserve actual value/source/customization detail for tooltip,
  detail-popover, or the defaults overlay.
- Predefined/default values in dense property panels should use compact
  dropdown/select controls, not horizontal pill groups. Pill rows quickly become
  noisy landmines when a panel has many editable defaults.
- Reserve pills for small visual mode groups, material variants, or focused tool
  controls where the options themselves are the task, not for every property
  preset in an inspector.
- Defaults/tunables need their own instant-access workspace overlay. It should
  behave more like a command palette for global values than a slow settings page.
- The overlay search should rank exact/global matches first, then related values
  and pertaining data. Example query: `gravity` -> global gravity first, then
  movement, physics, pathing, or object defaults that depend on it.
- Favorites are a first-class inspector/table concern. They let immutable dense
  data remain compact while still keeping the user's preferred facts pinned.
- Avoid horizontal scrolling as a default data strategy. Use column selection,
  wrapping groups, row density, search, filters, and favorites instead.

Potential sweep changes:

- Redesign inspector sections around focus faces and field modes.
- Replace always-boxed values with mode-specific presentation.
- Add a compact inline edit pattern for genuinely editable values.
- Add immutable read-only rows that look like facts, not disabled controls.
- Model editable values as `default preset -> named preset -> custom override`
  rather than raw inspector numbers.
- Prototype immutable sections as wider mini-spreadsheet/table bands.
- Add tooltip/detail affordances for raw numeric values, keeping provenance
  subtle unless the user is actively inspecting or overriding the value.
- Add a hotkey/menu-opened globals/tunables overlay with ranked search.
- Add table search, filters, and favorites/pinned properties.
- Design dense tables to fit the constrained panel without sideways scrolling.
- Add a coherent multi-selection face for same-family selections, not a general
  arbitrary-object merger.
- Move non-object concerns such as command/feature pipeline out of normal object
  inspection unless explicitly focused.

## 02 - Left Library / Workspace Memory Panel

Source image: `/tmp/codex-clipboard-wXgVg1.png`

What was shared:

- Left panel from `cart/hmsc-workspace-mock`.
- Top domain label reads `WORLD`.
- Three tabs: `Build`, `Props`, `Skins`; `Skins` is active.
- Search field says `search current library...`.
- Asset grid shows six material cards: `Grass`, `Road`, `Concrete`, `Brick`,
  `Sand`, `Water`.
- `WORKSPACE MEMORY` lists `skin`, `object`, `tool`, `snap`, `floor`,
  `mission`.
- `DOCUMENTS` lists `city_block_04`, `motel_prefab`, `mission_night_raid`,
  `traffic_layers`.
- Large amount of empty vertical space below the document list.
- Related behavior/reference image shared afterward:
  `/tmp/codex-clipboard-4bQBVj.png`.
  It shows existing material/shader controls: mode tabs (`preview`, `shader`,
  `compose`), `SHADER RECIPE`, recipe name, save-as field, variant tabs,
  reset recipe, `BASE PARAMETERS` with seed/detail sliders, `TAKE 2 PARAMETERS`,
  and `MATERIAL BANK`.

User complaint:

- The panel has wasted space, mixed concerns, and weak overall functionality.
- `WORKSPACE MEMORY` currently looks like duplicated data rather than useful
  memory.
- `Build`, `Props`, and `Skins` should not be fixed top-level tabs.
- `DOCUMENTS` does not belong in this panel.
- The panel should become a contextual asset/material/tool panel driven by the
  active tool or focused object.

Questions to answer:

1. Is the biggest issue that this panel wastes space, that it mixes unrelated
   concerns, or that the hierarchy feels too weak?
2. Should `WORKSPACE MEMORY` be visible here, or should remembered context be
   expressed through active controls/tabs/history instead of a separate facts
   list?
3. Are `Build`, `Props`, and `Skins` the right top-level categories for this
   panel, or should the library be organized by the active tool/action menu?
4. Should `DOCUMENTS` be in this left library panel, or should documents/maps be
   a separate file/workspace browser surface?
5. For the asset grid, do you want larger inspectable swatches, denser rows, or
   a more table-like searchable catalog?
6. Should this panel preserve a history of recently used assets/tools per
   context, or only show the current catalog?
7. Does the left panel need to collapse/resize, or should it always be a dense
   fixed work surface?

Provisional deductions:

- The panel currently reads like three unrelated blocks stacked vertically:
  library search/grid, memory facts, and document links. That may be why the
  bottom half feels dead.
- `WORKSPACE MEMORY` is valuable only if it behaves like actual retained
  context. As a static text list it risks duplicating state already shown in
  tabs, toolbar, selection, and status.
- `DOCUMENTS` may be too passive here. If this is the asset/tool library, map
  documents probably need either richer controls or a different surface.
- The asset cards are recognizable but low-information. They show color and name
  but no type, usage, favorite/recent status, override state, or drag/place
  affordance.
- Search is scoped to the current library, but the panel does not reveal what
  counts as searchable or filtered.
- The empty lower area suggests the panel needs either denser useful content,
  collapsible sections, or a role split where only one primary concern owns the
  panel at a time.

Confirmed answers:

- Biggest issues: wasted space, mixed concerns, and the panel's overall
  functionality.
- `WORKSPACE MEMORY` is currently duplicated state. It is the same class of
  issue as the inspector problem: it displays information already represented by
  active controls/selection/tooling, without making that information actionable.
- `WORKSPACE MEMORY` could become valuable only if it becomes real remembered
  context, recents, history, or restoration. As a passive list of active state,
  remove it.
- Fixed top-level tabs `Build`, `Props`, and `Skins` are wrong. Those are
  factors of the current tool or focused item.
- If the prop tool is active, the panel should become a prop menu.
- If a building tool is active, the panel should show build pieces and
  pre-skinning.
- If an existing map item is selected, the panel should show the skinning
  interface for that selected item.
- `DOCUMENTS` should not live in this left library/material/tool panel.
- Asset/material list structure: top portion should be a full asset list,
  paged, with no scrolling.
- Asset/material list presentation should stay visual all the time. It should be
  friendly and inspectable, while still designed for performance.
- Asset/material ordering: favorites and recent history always first, then most
  used, then alphabetical.
- Below the asset list, show the capabilities for the selected material/tool:
  seed, variant, material controls/material bank, and related shader recipe
  controls like the existing material panel reference image.
- Material focus workflow: from this panel, the user should be able to bring a
  material into focus for deeper refinement.
- Focused material refinement should repopulate the workspace with real painting
  and layers tooling, already focused on the selected material.
- After refining, the user should be able to export/save it back into the
  material list as a new name, variant, or chosen structure, then immediately
  return to using it in the world at the previous context.

Potential sweep changes:

- Replace fixed `Build / Props / Skins` tabs with a contextual panel mode derived
  from active tool or focused object.
- Remove passive `WORKSPACE MEMORY`; replace only if it becomes actionable
  recents/history/context restoration.
- Remove `DOCUMENTS` from this panel and move file/map/document concerns to the
  proper workspace/file surface.
- Redesign the top of the panel as a paged asset list with favorites, recents,
  most-used, and alphabetical ordering.
- Keep the asset list visual, but design it for performance from the start.
- Add selected-material capabilities below the list: shader recipe, seed,
  variant, material bank, reset/save-as, and any applicable material controls.
- Add a "focus material" workflow that swaps the workspace into full material
  painting/layer tooling without route/context loss.
- Add save/export-back flow so edited material returns to the material list and
  can immediately be used in the world.

Follow-up correction:

- The material results area must not depend on scrolling inside the panel.
- Large catalogs should be paged into fixed visible slots. Page changes are an
  explicit action, not an accidental overflow behavior.
- The selected-material capability surface should remain visible under the page
  results so the user can always rename, favorite, inspect variants, and focus
  the material without first fighting the panel.
- A page with fewer results should still preserve the fixed result-slot geometry
  so the panel does not resize around search/filter changes.

## Concept Art Review: Traditional Content Browser Direction

Source directory:

- `/home/siah/creative/reactjit/pics`
- Seven 2560x1440 concept images named
  `prototype of a internal game tool for authoring 3d game worl*.png`.

Observed strengths to absorb:

- The strongest concepts treat the editor as a professional content suite, not a
  loose collection of panels.
- A traditional content browser works well as the stable navigation layer:
  folders, disclosure arrows, selected path, item counts, and search.
- The high-value folder leaf should expand into the specialized visual browser
  for that asset family. Example: `Materials` can use rich swatches, variants,
  stats, favorite, rename, and selected-material controls.
- The tree itself should stay compact and boring. The detail surface underneath
  or beside it can become visually rich.
- Wide/tall layouts should not leave blank vertical panels. They should stack
  purposeful work surfaces: tree, content results, selected item capability,
  timeline/state strip, eventbus/status, inspector.
- The concepts consistently use durable workplace patterns: outliner, asset
  browser, properties/inspector, world-state timeline, minimap, validation,
  performance/status, and contextual tool palettes.
- Strongest pages preserve a large central viewport while surrounding it with
  dense, readable, high-utility controls.
- The UI feels best when the asset browser has both hierarchy and visual
  output: folder tree for location, cards/rows for what can actually be used.
- The bottom state/timeline areas are important. They make mission/world-state
  authoring feel like first-class data, not a hidden mode.
- Concept art repeatedly validates that mission/story tools should be able to
  occupy the same workspace shell as world/build/material tools.

Design deductions:

- The left panel should become a content browser pattern first, contextual tool
  panel second.
- Do not choose between "traditional folder browser" and "visual materials".
  Use both: folders decide scope, visual browser renders the scoped content.
- Materials should not be a tiny tab or icon toggle. A material folder should
  open into rich material rows/cards with visible variants, usage stats, and
  direct actions.
- Asset family leaves should be allowed to have custom renderers:
  materials use swatches/variants; build pieces use semantic piece previews;
  props use thumbnails/tags; missions use graph/timeline records.
- Keep tree navigation textual and legible. Use icons as support, not as the
  only way to discover a capability.
- Item counts matter. They communicate scale and make huge catalogs feel
  navigable.
- Filters/search should live near the tree and the scoped result surface.
- A selected asset should expose immediate local actions: favorite, rename,
  focus/open, duplicate/export variant, and relevant stats.
- Folder selection should not leak unrelated context. Selecting an empty folder
  should show an empty folder state, not silently reuse the last active tool's
  materials.

Mock changes implied by this direction:

- Content-browser tree at the top/side of the library panel.
- Material folders under `/Game/Materials`:
  `Core`, `Generated`, `Favorites`, `Recent`.
- Architecture/build folders under `/Game/Architecture`.
- Props as their own folder.
- Rich material renderer appears only when a material folder is selected.
- Other folders can show empty or family-specific surfaces until their data is
  mocked.

## Bottom Dock And Build Journal

What was shared:

- Thin status/build strips from concept art:
  - Build number with green saved/valid icon.
  - Validation section such as `No Errors`, `2 Warnings`.
  - Position/grid controls such as `GO TO POSITION`, `X`, `Y`, `Z`, `GRID`,
    `ANGLE`, `WORLD UNITS`.
  - Performance readout such as `Triangles`, `Draw Calls`, `FPS`, `Mem`.
  - Sync/build state such as `Up to date`, memory budget.

User direction:

- The current request system is too hidden.
- Do not keep unresolved requests as a manual approval chore.
- Treat requests and their handled resolutions as a self-incrementing build
  number stream.
- The build number should be clickable.
- Clicking it should open a dialog showing the requests, how an agent handled
  them, and build notes over time.
- Bug-hunting history should be traceable end-to-end.
- If an issue breaks today, gets fixed over several prompts, then breaks again
  weeks later, the new break should attach to the same ongoing bug thread with
  prior context readily available for agents.
- Diagnostic log captures should be attachable to those ongoing bug/build
  threads, so a recorded console slice travels with the issue history and the
  incrementing build version that produced it.
- Bug threads need user-editable semantic names, e.g. `jesus water walking`, so
  a recurring issue can be recognized and reattached in future sessions by a
  human memorable label instead of only a request/build id.

Design deductions:

- Request ledger remains useful as source data, but the interface should present
  it as a build journal.
- `review`/`done` state should become metadata in the journal, not a blocking
  inbox the user must constantly close.
- Build number can be request-derived, e.g. `1.0.0.2108`, where `2108` maps to
  the latest request/build note.
- The bottom dock should be the single thin authority for:
  - build identity,
  - validation,
  - sync/autosave state,
  - coordinates/grid/units,
  - performance/memory,
  - request/build-note status.
- Detailed build notes belong in a modal/dialog opened from the build number.
- Build notes should contain:
  - request id,
  - build id,
  - agent,
  - handled summary,
  - trace tags,
  - linked bug/thread ids,
  - attached diagnostic captures.
- Repeated bugs should resolve to ongoing threads, not isolated request cards.
- Each bug thread should have a stable internal id plus a semantic display name,
  optional aliases, tags, and search tokens. Renaming the bug should not break
  existing build/request/log links.
- The build journal should support "attach to existing bug" by semantic search:
  type the remembered name, pick the ongoing thread, and attach the new request,
  build note, and diagnostic capture to that same history.
- A bug/build thread should be able to show attached log captures inline:
  capture name, channels, time range, build id, map/context, short note, and a
  copy/open action for the raw feed.
- Creating a capture should not require leaving the editor, opening a terminal,
  or knowing where files are written.

Mock changes:

- Added a global thin bottom dock.
- Added clickable build number `1.0.0.2108`.
- Added build journal dialog with recent request/build notes.
- Added ongoing thread cards to show how future repeated bugs should inherit
  previous context.
- Removed duplicated workspace coordinate/status strip so the bottom dock owns
  that information.

Follow-up delivery-to-thread direction (req_2229):

- The journal's left column is now RECENT DELIVERIES. Every delivery (build
  note) shows whether it already belongs to a thread or is unthreaded, with a
  `thread it` / `move thread` action on each card.
- Choosing the action swaps the right column into an attach panel: a semantic
  search over thread name/alias/tag/id/delivery tokens, a one-click `open new
  thread` using the typed name (or the delivery title), and a ranked list of
  matching threads to attach into.
- Attaching a delivery moves it into exactly one thread; it is removed from any
  prior thread so a delivery never double-counts. Detach is available per
  delivery inside the thread card.
- Threads carry a stable id, a user-editable semantic display name (inline
  rename; the previous name is kept as an alias so existing links stay valid),
  alias chips, tag chips, their attached deliveries (resolved to build/title),
  the narrative history, and attached diagnostic captures.
- Diagnostic captures from the raw-console pool can be attached to any thread
  and render inline with name, channels, time range, build id, map/context, and
  a copy action, matching the raw-console capture contract.
- The bottom dock now also reports the live thread count next to build-note and
  reversible counts.
- Still a mock: thread/delivery/capture state lives in in-memory MockState; the
  production owner is the request-ledger/eventbus, not the React layer.

Follow-up dock telemetry direction:

- The dock should also expose in-memory edit history as an expandable popover.
- Authoring cost is a first-class signal. The user wants to watch average time
  per edit, p95 edit cost, and the delta between an empty map and a fully rich
  authored map.
- Placement on an empty map should remain effectively the same cost as
  placement on a large authored map. If that delta grows, the authoring approach
  is probably wrong and the UI should make that visible early.
- The history popover should read from the same event-shaped edit stream as the
  rest of the workspace. It is not a separate profiler bolted onto the side.
- Useful dock telemetry includes:
  - retained in-memory edit count,
  - avg edit time,
  - p95 edit time,
  - rich-map delta,
  - latest edit timing,
  - compact event trace showing operation, target, empty-map cost, rich-map
    cost, and undo/checkpoint state.

Follow-up eventbus placement direction:

- The Eventbus review area should not be a permanent bottom strip inside the
  editor workspace.
- It fits the bottom dock architecture: a compact dock entry with the current
  event count and state, expanding into a popover only when the user wants to
  review the stream.
- This keeps event data one click away without shrinking the stage, material
  editor, or other primary authoring surfaces.
- The popover should combine the useful old Eventbus strip content with the new
  edit telemetry: event stream, undo/redo state, autosave state, invite state,
  avg/p95 timing, and rich-map delta.
- Eventbus data remains central architecture. The UI treatment is about
  progressive disclosure, not hiding or demoting the system.

## In-App File Explorer

User direction:

- The editor needs a baked-in file exploring menu instead of relying on system
  menus/dialogs or repeatedly searching externally for imports and related
  files.
- It should have history so recent work can be reopened quickly.
- The goal is to reduce time spent searching and increase time spent working.
- The file selection interface should carry forward as the import path for
  assets, breaking away from the system picker.
- Directory history is required, not only file history.
- Model files should be previewable before import. The realtime native preview
  does not need to exist in this mock, but the interface should reserve the
  preview slot and import controls for it now.

Design deductions:

- `File` menu commands should open an in-app project explorer surface.
- The explorer should search paths, imports/symbols, tags, summaries, and
  ownership/context metadata from a prebuilt project index.
- File history is part of the workspace state: recent opens, pinned files,
  prior queries, and jump actions should remain visible and clickable.
- Directory history is also workspace state: prior import roots and project
  folders should remain visible and clickable inside the picker.
- Results should be dense and fixed-row, not a loose OS-style picker. The user
  should be able to keep orientation while filtering.
- Preview should show why a file is relevant: imports/symbols, tags, owner,
  modified state, and a human summary.
- Model preview should expose import-relevant metadata before import: source
  format, triangle count, material count, bounds, up-axis, import target,
  texture slots, and import checks.
- The preview viewport should be treated as a native preview socket. Later, the
  Zig/native model preview and camera can bind there without redesigning the
  picker.
- This remains a mock for now. No real filesystem mutation or import parsing is
  required yet; the interaction shape is the point.

Mock changes:

- Added `Open Project File Explorer` and `Find Import Source` to the `File`
  command menu.
- `Open Workspace` now opens the same in-app explorer rather than implying a
  system picker.
- Added a project tree, query row, fixed result list, selected-file preview,
  and file-history strip backed by mock data/state.
- Added import roots under `/Imports` with `Recent`, `Models`, `Textures`, and
  `Audio`.
- Added directory memory in the left column; changing folders records the
  directory and can restore it later.
- Added mock model assets (`.glb`, `.obj`, `.gltf`, `.fbx`) with model-preview
  metadata.
- Added a model import preview panel with native preview slot, mesh/material
  stats, texture-slot chips, import checks, `stage preview`, and `queue import`
  actions.

## Shader Palette And Authored Effect Layers

Source image:

- `/tmp/codex-clipboard-HveL9q.png`

What was shared:

- Concept panels for material palettes, color studios, harmony/no-mode color
  pickers, pigment labs, world samplers, and ramp/gradient forges.
- The current thought: the existing dithering brush should not be treated as
  final noisy pixel data. It should become a special authored layer type.
- The same direction applies to shaders generally: painting tools should author
  structured shader/effect layers, not just destructive pixels.

Confirmed direction:

- Dithering is not stored as dithered pixel data. Dithered pixels are high
  entropy and hostile to RLE.
- Dithering should be represented as an engine-owned effect function plus small
  authored parameters such as density, intensity, scale, threshold, palette
  stops, seed, phase, and animation rate.
- The dither brush becomes an authoring gesture for a dither/effect layer. It
  paints the mask, placement, or local influence of that layer rather than
  directly burning noisy pixels into the base texture.
- Shader brushes should follow the same model: a brush can author or edit a
  shader layer, palette layer, ramp layer, pigment mix layer, world-sampled
  layer, or procedural material layer.
- A brush is the interaction tool. A layer is the stored authoring product.
  Avoid conflating them.
- The stored material should remain compact and deterministic:
  - RLE-friendly base/color/mask data;
  - named engine effect id;
  - bounded parameter data;
  - optional animation parameters;
  - palette/ramp references;
  - version/hash metadata.
- Runtime/generated dithered pixels are cache or shader output, never the source
  of truth.

Design deductions:

- The material editor needs first-class palette surfaces, not only color
  swatches. Palettes should understand workbench colors, no-mode global colors,
  harmony relationships, pigment mixing, sampled world colors, and ramp
  generation.
- Dither/effect layers need their own clean inspector:
  - effect family;
  - seed;
  - density;
  - intensity;
  - scale;
  - palette/ramp source;
  - animation phase/rate;
  - mask/source mode;
  - preview/cache status.
- The layer stack should visually distinguish destructive paint layers from
  procedural/effect layers.
- Dither/effect layers should be maskable and editable, with a compact preview
  of the resulting look, but their controls must stay parameter-driven.
- The engine should own a small vocabulary of deterministic effect functions
  such as ordered dither, hash dither, blue-noise-style lookup, scanline,
  palette ramp, pigment blend, and animated threshold.
- Avoid arbitrary per-game shader scripts as stored data. If a new effect class
  is needed, it becomes an engine/editor capability with named params.
- Content addressing should include base source hash, effect id, effect version,
  palette/ramp ids, and parameter values.
- Animated material effects should be deterministic over stable inputs such as
  UV, world position, seed, and tick/phase. They should not depend on unstable
  frame randomness.

Implementation implications:

- Current shared paint already has a dual-source layer model. Dither/effect
  layers should extend that model as a layer source/config type rather than a
  one-off brush fork.
- Current texture materials already support shader recipes with frozen
  `{ shaderId, data[] }`. Dither layers should fit this recipe/materialize path,
  but with named parameters kept visible in the editor so `data[]` never becomes
  magic numbers.
- Painting a dither layer should commit small semantic events: create layer,
  paint mask, set density, set palette, set seed, set animation rate, etc.
- Compile can either bake a static effect result into an installable cached
  texture or ship the compact base data plus effect params when the effect is
  meant to remain dynamic/animated.

## 2026-06-30 - Platform Framing: Shitty Games / Nogame Release

What was shared:

- The editor/tooling may be released as a "nogame" engine-first build before
  the hmsc game content is complete.
- The analogy is Fortnite Save the World / Battle Royale: the side surface can
  ship early and become the way people understand the platform while the game
  continues to develop.
- The loader is already positioned as game-agnostic. hmsc can become one game
  package loaded by the platform rather than the platform itself.
- The public framing should be humble and direct: this is a different kind of
  game engine, still heavily under development, built through AI-assisted real
  content authoring, and already useful enough for people to tinker with.
- Branding direction for the mock: replace the corner "WORLD EDITOR" identity
  with "Shitty Games."

Confirmed direction:

- "Shitty Games" is the platform/editor brand for the current mock direction.
- hmsc-int is no longer the user-facing identity. It is an internal/project
  lineage name that should give way to the engine/tooling brand.
- The engine/tooling can ship without a bundled finished game as long as it
  lets people author, load, inspect, and play with data packages.
- hmsc remains the first game/content package, not the only reason the platform
  exists.
- The best pitch is not "Unity competitor." It is closer to a Roblox/GMod-like
  authoring platform with a data-first loader and native tools, but able to
  graduate from simple block/Roblox-like assets into high-detail imported
  models and authored game packages.

Design deductions:

- The editor chrome should foreground the platform brand and make game/project
  selection feel like loaded content, not the app identity.
- Routes should continue consolidating toward `/editor` and `/play`; brand and
  navigation should reinforce that the app is a loader/editor shell.
- Build notes, request history, debug logs, eventbus records, and package
  manifests become part of the platform story: people can see how a game was
  built and updated.
- The content browser needs to keep separating engine-global resources,
  package-local game data, model homes, global materials, and shader/effect
  libraries.
- RLE remains a core public technical story, but with the caveat already
  discovered: noisy final pixels such as dithered texture data are the wrong
  source format. Dither should be stored as compact parameters consumed by an
  engine function.

Implementation implications:

- Do not rename production directories casually. The user-facing brand can move
  first in mock/UI surfaces while code paths migrate deliberately.
- Public packaging should distinguish platform/editor builds from game packages.
- Dither and shader effects should be represented as data-driven engine
  capabilities so the same compact game-data story remains true for authored
  texture effects.
- When agents add new UI, avoid "hmsc-int" as visible product language unless
  referring to an existing internal path or migration note.

## 2026-06-30 - Color Studio: Material/Shader-Aware Color Tool

What was shared:

- The provided `Color Pickers.dc.html` handoff is a design reference, not
  production code to copy.
- The target is a material/shader-aware Color Studio that replaces a generic
  color picker with a tool for authoring the named color slots that shaders
  consume.
- The highest-value first build is the Material Palette view: select a material,
  see its preview, change variant/seed/quality, expose baked shader color
  constants as slots, and fill/reset those slots.
- The prototype's preview uses CSS approximations. Production previews should
  render the real WGSL/material output so the user sees ground truth.

Confirmed direction:

- The important destination is not a hue wheel. It is ownership of shader color
  constants that currently live as baked `vec3f(...)` values.
- Slots are per material and per variant. Overrides should key by material,
  variant, and slot index/name.
- The UI should make the default explicit with a readout like
  `was baked: vec3f(...)` so the magic-color system is visibly removed.
- `materialId`, `variant`, `seed`, `quality`, and `board` remain the visible
  shader descriptor; palette slots are the new missing piece.
- A low-risk migration path is one material first: default uniforms match the
  old literals, then the tool writes overrides, then the pattern generalizes.

Design deductions:

- Material cards should be visual, but text names remain first-class so the
  capability is searchable and visible by name.
- Variant, seed, and quality controls belong close to the preview because they
  are part of the shader descriptor, not generic inspector metadata.
- Slots should behave like owned data records: active slot, default/baked state,
  override state, reset to baked, and fill from assist/library.
- Fill assists should derive from the material context, not a global color wheel.
  "A paint that fits this wood" is the correct mental model.
- Library pulls should remain local/offline in the hot path. Online discovery is
  an import into the local library, not a live dependency while picking.

Implementation implications:

- Start in the mock with explicit material data from `fillShader.ts` samples:
  Rot Siding, Neon Stucco, and Pool Tile.
- Production should parse or codegen slots from material definitions, or better,
  refactor material functions to read named palette entries from a parallel
  palette buffer/uniform contract.
- The `D[]` descriptor should not become a bag of unexplained numbers. The
  editor must keep names attached to every parameter and slot.
- Color edits should travel through the eventbus as semantic events such as
  `material.slot.fill`, `material.slot.reset`, `material.seed.roll`, and
  `material.variant.select`.
- Shader-slot editing and dither/effect layers are the same design family:
  compact authored data drives engine-owned functions rather than storing noisy
  final pixels as source truth.

## 2026-06-30 - PRIORITY BACKFILL: concerns dropped by the authoring pass

These three were given to codex in the same 09:33-09:58 window as the Color
Studio and Platform Framing handoffs (which did get sections), but never made it
into this doc. Backfilled here verbatim-faithfully and flagged PRIORITY because
they are unresolved architecture, not nice-to-haves. Source requests cited per
section. (req_2267)

## PRIORITY - Model Package Layout: a model is a self-contained directory

Source request: `req_2168` (codex, 2026-06-30T09:33Z).

What was shared:

- The full authoring loop for a model is: make/import a model -> rig it -> paint
  it. The storage model has to serve that whole loop, not just import.
- Painting must be able to store many versions of a model's textures, for two
  distinct reasons: visual variations, and decompositions of the model for LoD
  and for breaking the model apart (e.g. explosions).
- The on-disk shape the user wants: a `models/` folder where every model has its
  own directory. Inside that one model directory lives:
  - the model's own data (mesh/rig);
  - a texture atlas for the model;
  - a texture atlas for every decomposition of the model that gets stored;
  - for each atlas, the paint applied to it, storable arbitrarily many times.
- Example: a ball can be painted a million different ways and every one of those
  paintings lives inside that single model's folder.
- Global textures are explicitly NOT this. Textures that come from shaders or
  images are less model-specific and are generally applied; they live elsewhere
  and must not be confused with a model's owned paint.
- Exception that keeps the home self-contained: if a paint variation uses a
  shader for part of itself, that shader code reference is stored alongside the
  same model data. So everything is in one home, and copying the entire folder
  for a single model carries all of its bases end to end.
- Sketched structure:
  ```
  -models/
  --props/
  ---wip/...
  ---vase/...
  ---cd_player/...
  ```

Confirmed direction:

- A model is a self-contained package directory, not a single importable file.
  The directory is the unit of copy/move/share: copy the folder and you have the
  mesh, every decomposition, every atlas, every stored paint variation, and any
  referenced shader code, end to end.
- Two axes of multiplicity live inside one model directory: variations (many
  paints over the same atlas) and decompositions (LoD tiers + break-apart pieces
  like explosion chunks), each decomposition carrying its own atlas.
- Model-owned paint and globally-applied textures (shader/image sourced) are
  separate storage classes. Model paint is package-local; global textures are
  shared and generally applied. A shader merely referenced by a model paint is
  copied into the model home so the package stays portable.
- This is the concrete file-structure expression of the "model homes" the
  Platform Framing and content-browser sections only gestured at, and it is a
  sibling to the Skeleton Object Model (`docs/game/SKELETON_OBJECT_MODEL.md`),
  where an object = bones + carried data (meshes/collision/animation/...). Both
  say the same thing: a thing is a bundle of its assets, not one flat file.

Open questions to resolve before implementation:

- Where do global (shader/image) textures live relative to `models/`, and how is
  a model-local copy of a referenced shader kept in sync with its global source?
- Naming/identity of decompositions and paint variations inside a model dir so
  LoD tiers, explosion chunks, and named paints are addressable and RLE-friendly.
- Reconcile with the package-local-vs-engine-global split already named in the
  Platform Framing section so model homes are one consistent story.

## PRIORITY - Overlays Must Block Pointer Events To What Is Behind Them

Source request: `req_2167` (codex, 2026-06-30T09:25Z).

What was shared:

- With a modal/menu open, clicks still reach the elements behind it. The user
  called this out as a real framework problem to stab as soon as possible, not a
  per-screen cosmetic issue.

Confirmed direction:

- This is a framework-level pointer-routing concern, not a one-off fix in a
  single popover. Any open overlay (modal, dropdown, context menu, popover) must
  block pointer events to everything painted behind it for as long as it is open.
- It ties directly to the existing overlay rule that overlays paint and hit-test
  as the root's last child: an open overlay owns input until dismissed.
- Acceptance: with any overlay open, a click outside the overlay either dismisses
  the overlay or is swallowed by its scrim. It must never fall through to world
  geometry, toolbar buttons, or panels underneath.

## PRIORITY - Layout Reachability Validation (host-run, pre-open)

Source requests: `req_2171`, `req_2172` (codex, 2026-06-30T09:56-09:58Z).

What was shared:

- The user wants a validation script that enforces menus and content are always
  reachable, and that the layout is not doing a jank wrap or missing a scroll
  container.
- The mental model of layout here is that everything is predetermined and has a
  fixed size even at runtime. That is treated as the coherent way to build a UI:
  a gutter is a known width (e.g. 420px); percentages and flex have precise,
  resolvable calculations against the other style constraints within the exact
  same set of nested elements; and even runtime data loads into a fixed-size
  component.
- Because of that determinism, layout correctness should be verifiable at the
  user's breakpoint BEFORE the app is ever opened and looked at.
- Implementation constraint: validate with the system already in place. No
  python. Use zig or ts and invoke it the same way the project runs its v8-based
  CLI functions.

Confirmed direction:

- Layout reachability is a pre-open, host-run gate, not a manual visual check.
  It should fail the build/check when content can become unreachable: silent
  wrap, a region that needs a scroll container and lacks one, a fixed gutter that
  no longer adds up against its siblings, or children dropped past a container
  cap.
- The validator runs on the same deterministic layout the engine computes, so a
  failure is provable from the predetermined sizes without rendering to a screen.
- Tooling rule: zig or ts only, invoked through the existing v8 CLI path; no
  python anywhere in this validator.
- Note: a first cut exists in the tree as `layoutValidateCli.ts` /
  `bundle-layout-validate.js`; this section is the design contract it must satisfy
  (reachability + fixed-size invariants + no-python), and it should be reconciled
  against that script rather than re-invented.
