# hmsc-int structure review — readable-code + deep-interfaces opportunities (req_0602, 2026-06-10)

Reviewed against `docs/game/DECISIONS.md` (the constitution, P1–P6, V1–V30) and
`GUIDING_LIGHT.md` (the low-rank law). Direct source inspection, no subagents.
Scope: `cart/hmsc-int/` — 638 files, 23 top-level directories, plus the data
layer and the framework surfaces it touches.

The headline: the tool's NEW layers (data streams, Workbench, GAME_* door,
tunables, twigs) are genuinely written to the P3 bar — deep interfaces, strict
boundaries, honest comments. The pain the user reports (menus resetting,
inconsistent keys, same-feeling panels, lengthening startup, "you have to be a
bit autistic to use it") all traces to the SEAMS where pre-fold lab-era
surfaces haven't been pulled through those layers yet. Every finding below
names the seam and the existing in-repo pattern that already solves it.

---

## 1. STARTUP — the growth has one mechanical cause (highest priority)

**Finding: boot cost is O(everything you have ever done).**

`data/index.ts:642-696` — `defineStream` loads EVERY event for the stream from
SQLite (`SELECT id, record FROM events WHERE stream = ? ORDER BY id`),
`JSON.parse`s every row, keeps the full array resident in `open.events`, and
folds the state from `initial()` from scratch. **The snapshot files are written
(`materializeSnapshots`) but never read on the boot path.** `readSnapshot`
exists (`data/index.ts:783`) and only the game/compile consumes it.

Measured on disk today:

| stream domain | size | what it is |
|---|---|---|
| `data/domains/sessions/` | 9.6MB db + 4.1MB WAL, 3.4MB snapshot | every interaction marker EVER (sessions stream `commits` arrays only grow) |
| `data/domains/world/` | 8.2MB db + 4.2MB WAL | every world edit event |
| `data/domains/characters/` | 924KB | |

The `/` route opens sessions on `world` + `buildings` + folds `tuning`
(`index.tsx:530-579`), each a full-history replay. `editorSessions()` folds the
sessions stream — the one that grows on every single interaction and is never
compacted. **This is the "startup behavior getting longer and longer."** It
will keep getting longer linearly with use, forever, until the boot path reads
snapshots.

The fix is already V20-shaped — V20 says it explicitly: *"What the game LOADS
is not the history... the snapshot is for the game."* The tool deserves the
same deal: **boot = read `snapshots/<name>.snapshot.json`, then replay only
events with `seq > snapshot.globalSeq`.** The undo time machine doesn't need
the full log in memory — `stateAt(seq)` (a cold path) can page history in
lazily. Two further wins fall out:
- `open.events` stops being resident (today: the full event history of every
  opened stream lives in JS heap for the whole session — GC pressure P1 warns
  about).
- `stateAt` stops being an O(total-history) refold from zero
  (`foldUpTo`, `data/index.ts:633`).

**Secondary boot costs, same theme:**

- `index.tsx:209-242` — `readInitialView()` synchronously reads + envelope-parses
  the full map session file; `readInitialLegacyPieceMapName()` calls it AGAIN
  and additionally `deserializeMap`s the whole world; then the workspace
  restore parses it a third time through `applyPayload`. Three full-map parses
  before first paint. One read, shared.
- `index.tsx:1130` — `useMemo(workbenchSources, [])` runs ALL ELEVEN source
  factories at editor mount even when /workbench is never opened. Sources that
  open stores/streams lazily inside `live()` are fine; any factory doing work
  at construction bills the `/` boot. The bench should get its sources when the
  bench mounts.
- `index.tsx:441-447` — the `[mapgone]` probe iterates every painted cell of
  every chunk and `console.warn`s on EVERY `applyPayload` (boot, map switch,
  undo). It is marked "stays until the user confirms" — fine as a deliberate
  hunt, but it's an unconditional O(world) scan + sync print on the boot path,
  the exact shape V27 ruled out. If the hunt is over, rip it; if not, put it
  behind a `GAME_TELEMETRY` channel like `perfLog.ts` already does (that module
  is the V27-compliant model — off-by-default channel, debounced disk flush).

---

## 2. THE GOD COMPONENT — `EditorShell` (deep-interfaces, the big one)

`index.tsx` is 1,287 lines; `EditorShell` alone is ~1,000 lines holding ~40
hooks. It is simultaneously: the map persistence engine (build/apply payload,
flush, open/new/rename/delete), the undo reconciler (`pieceValueKey`,
`reconcileBuildPieces`, `reconcileBuildUndoRef` — a ref-wired circular-dep
workaround), the placements CRUD store, two event-stream session managers, the
compile pipeline, the event log, the router shell, the pane-layout owner, and
the WASD-focus arbiter.

Litmus question 1 ("what does a caller have to learn?") fails everywhere it
touches: `PaintCanvas` takes ~20 props; `RightPanel` takes 14, several of which
are pass-throughs to one-line setters (`onClearNotes`, `onResetLayout` —
shallow wrappers in the deep-interfaces sense; they relay, absorb nothing).
Adding any feature to the editor means threading state through this one
closure — which is why the file keeps growing and why hot-reload behavior is
hard to reason about (every concern re-renders when any concern changes; the
`useChurn('cart', …)` probe at `index.tsx:1144` exists precisely because of
this).

The repo already owns the right pattern — **the Workbench**.
`shell/Workbench.tsx` is pure frame; concerns arrive as `WorkbenchSource`
values (a 13-method deep interface) and the frame knows ZERO category names.
The editor route should be held to the same bar. Extraction seams the file's
own comments already draw:

1. **`useMapSession(cart)`** — MapPayload build/apply, flush, open/new/rename/
   delete, the workspace wiring, the view-sanity laws (VIEWRUNAWAY/MAPGONE).
   Today this is ~350 lines of `EditorShell`; it is one concern with a
   four-verb surface.
2. **`useBuildUndo(worldSession, buildingsSession)`** — `pieceValueKey` +
   `reconcileBuildPieces` + `reconcileBuildUndoRef` + `commitBuildEvent(s)`
   (~200 lines). Note the boundary smell inside it: `commitBuildEvents`
   feature-detects `commitMany` via structural cast
   (`(buildingsSession as { commitMany?: … })`, `index.tsx:818,823,854,863` —
   four copies). Make `commitMany` part of the `RouteSession` contract and
   validate at the boundary once; the call sites stop branching on uncertainty.
3. **`usePlacements()`** — the legacy placement CRUD (add/move/clone/remove/
   settle-snap, `placeSeq`). Already grouped into the `place` memo
   (`index.tsx:989`); it wants to be a module, not a memo.
4. **`previewWorld` assembly** (`index.tsx:1035-1088`) — a compiler from
   (floors, placements, kind textures) → GameState. Pure function, own file.

None of this is a rewrite — it is cutting along fold lines the comments
already drew. The payoff is the user-visible one: each extracted concern
re-renders alone, and the next feature lands as a module, not 40 more lines in
the closure.

**V20 conflict worth naming:** the map world still persists as ONE JSON
envelope per autosave (`serializeMap` of all chunks per stroke-debounce,
`index.tsx:406`) — the "monolithic blob" shape V20 explicitly retired
("a state update writes to its specific workspace storage … never one
monolithic blob"). The file admits it's transitional ("content events join the
same channel later by ADDITION"). It is also the perf tax on every stroke and
the reason `MapPayload` carries `pieces` (a snapshot of STREAM data inside the
FILE payload — a second source of truth that exists only so undo can diff;
V20's "an undo point is a log position" erases the entire
`reconcileBuildPieces` machine when the world goes event-sourced). The
highest-leverage V20 completion in the repo is moving paint/height/placement
edits onto the world channel.

---

## 3. KEYBOARD — three systems, no shared vocabulary (the "autistic to use" complaint, part 1)

`game/input.ts` (GAME_INPUT) says it itself: *"BINDINGS ARE DATA (P2): the
control vocabulary is hmsc's input/controlContract.ts carried as a table …
readers walk the table instead of hardcoding keys."* That contract exists,
is exactly the right shape (`HmscInputBinding`: action / inputs / label /
playerIntent / availability) — **and only `commands/registry.ts` and
`game/input.ts` read it.** It covers GAMEPLAY only. The EDITOR has no
contract at all, so every surface hand-rolled its own bindings on raw
`__keydown`:

| key | PaintCanvas (`/` canvas) | IsoAuthor (`/` build pane) | PlayRoute F2 build | Workbench paint editor | gameplay (contract) |
|---|---|---|---|---|---|
| **E** | rotate ghost +90° | orbit camera right | EDIT piece variant | brush+restore mode | interact (sit/lie/search) |
| **R** | rotate ghost +90° (same as E) | rotate SELECTION | rotate | restore mode | reload (reserved) |
| **Q** | rotate ghost −90° | orbit camera left | — | — | — |
| **F** | — | recenter view | — | refine tool | — |
| **G** | — | — | grab/smart-select | — | — |
| **ctrl+Z** | workspace layer binding | (inherits) | ? | useIFTTT in two places | — |

Three transport mechanisms: raw `busOn('__keydown')` (PaintCanvas:581,
IsoAuthor:289/997/1020, Embodied, sculptCamera, usePlayerDrive), `useIFTTT('key:…')`
(Workbench:195-198, paint editor tools), and `GAME_INPUT`'s KeyState. The
typing gate (`isTextEditing`) is re-implemented per surface. Undo is bound by
two different mechanisms in three places.

**The fix is the move the repo already made twice** (controlContract for
gameplay, `workbenchShortcutHandlers` for the bench): an EDITOR control
contract — one table of editor actions (rotate-selection, rotate-camera,
recenter, delete, undo/redo/save, layer-pan…) with per-surface activation,
one dispatcher that owns focus + the typing gate, surfaces declare which
action-sets they consume. Two QoL wins fall out free, both per P2:
- **A discoverable keymap.** PlayRoute already renders its status-line key
  legend from its bindings (`PlayRoute.tsx:1823`) — the only surface that
  teaches itself. With bindings as data, EVERY surface gets a legend (and the
  settings bench can render the whole map) for zero marginal cost. This is the
  single cheapest cut at the "you have to already know" feeling.
- **Conflict detection.** A table can assert "E means one thing per focus
  scope" at registration; hand-rolled `busOn` handlers can't.

V25 applies: per-surface divergence in MEANING is the ~30-cameras disease.
Sign/feel conventions get pinned once; surfaces keep only tuning values.

---

## 4. HOT-RELOAD RESETS — twigs exist; adoption stopped halfway

`editors/twigs.ts` is the established, correct answer ("route working-state
persistence … how I was holding the tool"), and the Workbench is fully twigged
(`source`, `selBySource`, `lensBySource` — `Workbench.tsx:117-119`, with the
TWIGSTATE-0606 comment naming exactly the user's bug: "painting on a texture →
reload → staring at a 3D model, never again"). The map editor persists its
holding state through MapPayload. Good.

**Where it stopped:** `tabs/ObjectsTab.tsx` — the placement palette, the menu
most used while authoring — holds `sel`, `palCat`, `catOpen`, `itemOpen`,
`selPart`, `texOpen` in plain `useState` (lines 255-265). Every hot reload
snaps the palette back to "first building, prop category, everything
collapsed." This is almost certainly the literal "menus that reset on hot
updates." Same audit applies to any panel holding disclosure/selection in
bare `useState`: `RightPanel`'s scroll positions, picker expansions in
`PropertiesPanel`, etc.

**Recommend a written rule (CLAUDE-level or WORKBENCH.md):** any selection,
disclosure, or mode state that should survive leaving-and-returning is a twig,
never a bare `useState`. The hook is one line; the sweep is mechanical.

---

## 5. PANELS — the "feel the same / feel useless" inventory

Doubled surfaces found, each pair = one pre-fold survivor + the ruled home:

1. **Two settings surfaces.** `tabs/SettingsTab.tsx` (3 controls: grid toggle,
   layout reset, notepad clear) vs the workbench `settingsSource` — the ruled
   P2 home (WBSET9-0606 killed `/settings` for it). The tab is the "useless
   panel": its three controls belong to the canvas toolbar / the bench. Retire
   the tab; the RightPanel rail drops to objects/notes(/chat).
2. **Two property-panel renderers.** `shell/fields.tsx` is documented as *"THE
   field renderer … 'Add an editor' means writing a source, not a layout"* —
   while `PropertiesPanel.tsx` (root, 3 importers) hand-rolls its own rows,
   toggles, steppers, swatches. They feel like siblings who dress differently
   because they are. The in-focus panel should EMIT a `PanelSpec` (plus its
   bespoke hero band — radar/gauges stay) and render through the one renderer.
   Then "panels feel the same" becomes a feature: they ARE the same.
3. **Two lab registries.** `labs/index.ts` (`LABS`, the V13 route — ONE entry)
   vs `labs/labDefinitions.ts` (`HMSC_LAB_DEFINITIONS`, the console's scene
   steps — which is where AimLabScene/ScaleLabScene/TextureLabScene actually
   live). V13 says the labs route IS the collection of every lab, instantly
   loadable; today two-thirds of the labs are invisible to it. Fold: one
   registry, the console's scene-step verbs and the route both read it.
4. **Four hand-built rails.** `BrushRail`, `PainterRail`, `RoadRail`,
   `editors/paint/LayerStrip` are separate bespoke vertical-rail
   implementations (plus `TargetDock`). Same move as fields.tsx: one rail
   frame, per-layer content as data/specs. Lower priority than 1–3 but it's
   the same disease.
5. **Dead at root:** `gameShell.tsx` — zero importers. Plus four `_*.html`
   mockups (`_panel_preview`, `_studio_layout`, `_studio_preview`,
   `_rightpanel_preview`, `properties-panel-interpretations`) living beside
   live code. Archive or delete.
6. **`ChatTab`** — an in-editor assistant chat. If it has a user, keep; if it
   predates the workbench requests source (REQPANEL-0606), it's a candidate.

One frame-level QoL bug while in there: `Workbench.runSourceAction`
(`Workbench.tsx:157-163`) re-targets the roster selection to
`defaultRow ?? last` after EVERY action — so pressing Save while editing row 3
of 10 can jump your selection to row 10. Selection should only re-target when
the acted-on row disappeared.

---

## 6. `<Window>` — the unused framework primitive (the multi-route ask)

`runtime/primitives/window.tsx` ships a real multi-OS-window primitive,
metafile-gated (`-Dhas-window`), proven in `cart/claudewrap`
(`SettingsWindow.tsx`: conditional `<Window title= width= height=>` mounts a
whole surface in its own OS window) and `cart/desktop.tsx`. **hmsc-int never
uses it.** Today the routes are mutually exclusive overlays in one window —
`/test` unmounts when you check the bench; comparing the map and the compiled
world means flipping routes.

Window-shaped wins, in order of value:

1. **Pop-out `/test`.** The editor's whole premise is edit→feel loops; a
   `<Window>`-hosted PlayRoute beside the editor turns the F1/F2 flip into
   *both at once* — paint a road, watch the playable world take it live in the
   second window. This is V24's "ONE MODEL, TWO VIEWS" made literal (embodied
   view + plan view simultaneously over the same semantic data).
2. **Pop-out the event log / console / diagnostics** — chrome popovers
   (`logOpen`) stop covering the canvas.
3. **Workbench beside the map** — edit a material in the bench window, see the
   painted world re-skin in the main window (the shared-globals law:
   "change a global and every map follows" gets a live demonstration).

Shape: a `windows` twig on the shell (`{test?: bool, log?: bool}`), rendered
as root-level conditional `<Window>` mounts — the claudewrap pattern verbatim.
Two checks first: (a) `sdk/dependency-registry.json` + the metafile gate flip
`has-window` for hmsc-int once the import lands (V18: gated ingredient, no
unconditional addImport); (b) input focus routing across windows (the WASD
arbiter currently assumes one window — the editor control contract from §3 is
the right place for per-window focus).

---

## 7. GUIDING_LIGHT alignment — where the rank is hiding

**Holding the line well:** the data layer (append-only streams + snapshots,
schema evolution by addition), content-addressed exports (`exports/hmsc.rjpkg`
per V29), `editorTunables` (P2 as a registry, knobs write through to the very
value the route reads), the GAME_* door (`game/index.ts` — V17's standard
imports, real), `WorkbenchSource`/`PanelSpec`/`FieldSpec` (interfaces as data),
`defineStream`'s boundary validation ("a stream without snapshot support is an
incomplete change" — fail-fast with a message that teaches the law).

**Where the obvious shape won:**

- **Storing the product, not the factors:** the per-stroke map autosave
  serializes the entire world to one JSON blob (§2). The factors (events)
  exist as a system; the map editor just doesn't emit them yet.
- **Boot replays history instead of loading bytes** (§1) — "Use JSON at
  runtime" row of the temptation table, paid at every boot. The V29 ruling
  already names the cure (snapshot consumed, log archived); apply it to the
  tool's own boot.
- **`previewWorld` rebuild** (`index.tsx:1035`): every placement change
  rebuilds the full GameState by chaining immutable `placeWorldProp` spreads
  over ALL placements — O(n) copies per edit. Fine at today's n; it is the
  per-frame-adjacent shape P1 warns about. When it shows up in churn logs, the
  fix is incremental application (apply the delta, not the world).
- **`pieceValueKey` uses `JSON.stringify(p.skin)`** in a hot diff path —
  works, but it's the "re-derive intent from a string" smell; a canonical skin
  key would be cheaper and collision-honest.

---

## 8. READABLE-CODE findings (names that don't carry their face)

The comment culture in this cart is genuinely excellent — files open with the
ruling that shaped them, probes cite their incident codenames (MAPGONE2-0605),
and the why-not-what discipline is real. The gaps are NAMES, mostly positional
ones from the quad-layout era:

- **`RightPanel`** — a position, not a thing. It is the palette/notes rail.
  When the settings tab retires (§5.1) it's the `AuthoringRail` or
  `PaletteRail`; a name that says what it holds survives the next layout
  change (the panel may not always be on the right).
- **`PropertiesPanel` + `Focus`** vs workbench's panel — after §5.2 they
  converge and the name distinction ("in-focus instance inspector" vs "kind
  editor", per the ruled split) should be IN the names: `InstanceInspector` vs
  the bench's kind panels.
- **`MapPayload.fx/fy`** (`index.tsx:88-89`) — pane-split fractions named like
  math locals at persistent-schema scope. The scope rule says these carry
  their meaning: `splitX/splitY` (schema migration is cheap now — optional
  fields already tolerate absence).
- **`tab: TabId`** for objects/notes/chat/settings vs the workbench's
  source/lens vocabulary — two words for the same idea ("which sub-surface is
  active"). Pick one across the tool.
- **`Pane label="build"`** + `IsoAuthor` vs `IsoPreview` vs `Assist3D` vs
  `ObjectInspect3D` — four 3D viewport components whose names don't reveal
  which camera law (V26) or edit capability each carries. A Doom-style prefix
  would pay here: the cart already half-does this with `GAME_*`; the editor
  surfaces deserve the same (e.g. `Wb*` for bench sources is already implicit
  in paths).
- **Root sprawl is a naming problem at directory scope:** 60 loose files at
  cart root mix live editors (PaintCanvas), the legacy V2-retirement layer
  (`render3d/` — still 56 importers, so it's a real dependency, not cruft, but
  its consumers should know they're on borrowed surface), dead code
  (`gameShell.tsx`), mockup HTML, and tests. V13's premise is that hmsc-int is
  the place where "a human has declared where things actually live" — the
  root directory currently declares nothing. The `editors/` + `game/` +
  `shell/` split is the declared order; finishing the sweep (root keeps
  `index.tsx` + `cart.json`, everything else moves into its declared home or
  `_archive/`) is mostly `git mv` + import fixes and would make the structure
  legible at a glance.

---

## 9. Priority order (if the findings become work)

1. **Boot from snapshots + tail** (§1) — stops the startup growth permanently;
   contained in `data/index.ts`.
2. **Editor control contract + keymap legend** (§3) — the biggest single cut
   at the discoverability complaint; the pattern exists twice already.
3. **Twig sweep over panel state, starting with ObjectsTab** (§4) — kills the
   menus-reset complaint; mechanical.
4. **Retire SettingsTab into the bench; PropertiesPanel onto fields.tsx**
   (§5.1, §5.2) — kills the same/useless-panels feeling.
5. **`<Window>` pop-out** (§6) — the highest-joy QoL item; small if the
   gating checks pass. ~~for /test~~ → **for /compiled** (§10.2 — the user's
   actual daily driver).
6. **EditorShell extraction along the four seams** (§2) — the enabling move
   for everything after; do it before the map editor goes event-sourced.
7. **Map edits onto the world channel** (§2 V20 note) — the big one; erases
   the undo-reconcile machinery and the per-stroke whole-map serialize as a
   side effect.
8. **One lab registry** (§5.3) + root-directory sweep (§8) — hygiene with
   compounding payoff.

---

## 10. ADDENDUM (req_0603, same day) — user workflow corrections + the noise panel

The user's response to this review pinned two findings more precisely.

### 10.1 The 281-row "pieces" dump — `PrefabInfo` (`tabs/ObjectsTab.tsx:123-146`)

User, verbatim: *"this panel is worthless at this point, its all just literal
noise and un helpful … just a huge list of rects that dont let me do anything
about it."* The screenshot: a building inspected in the OBJ tab renders
`theme common · 281 pieces` followed by 281 near-identical rows of
`Concrete Floor  floor·concrete  (1.5,1.5)`.

What it is: `PrefabInfo` maps `GAME_BUILD.prefabs.decompose(prefab)` straight
to one `<Box>` row per piece — label, `kind·material`, edit, local cell. The
comment says why it exists: *"This is the see-through — a placed motel is
still walls/doors/floor to every consumer"* — it was written to PROVE the V24
no-opaque-blobs law, and as a proof it worked. As an interface it renders the
**outer product instead of the factors** — GUIDING_LIGHT's one law, violated
in information design: 281 rows whose true rank is ~4 (a handful of distinct
(kind, material, edit) classes × a position list nobody reads as text).

It also fails both halves of "useful": the rows carry no data a builder acts
on (positions in local grid coords duplicate what the 3D view above already
shows spatially), and they afford no action (no click→highlight, no select,
no re-skin). 281 dead rects.

What the panel should be — factor the decomposition, then attach verbs:

- **A bill of materials** (the factored sum): one row per distinct
  (piece kind, material, edit-variant) with a count —
  `120× Concrete Floor`, `84× Brick Wall (12 window, 2 door)`, `4× Ramp` —
  plus rollup facts that actually inform building: footprint W×D in tiles,
  height/floor count, distinct materials list, collision/cover summary when
  the bake contract surfaces it (V24's gameplay tags are the panel's real
  payload).
- **Rows as verbs, not text**: click a BOM class → highlight those pieces in
  the inspect view above (the renderer already draws them; selection is a
  color override away); a re-skin affordance per material row (the
  buildingsSource already owns per-type global skins — this panel should be a
  door to it, not a sibling); isolate/hide a class to see inside.
- The flat per-piece listing, if kept at all, belongs behind a disclosure
  ("show all 281") — it is debugging output, not authoring surface.

This slots into §5.2's consolidation: when the in-focus panel emits a
`PanelSpec`, the BOM is just a group of rows with `set()`s — the one renderer
gives it tooltips/reset/edit affordances for free.

### 10.2 Workflow correction: /test is avoided; /compiled is the daily driver

User, verbatim: *"i dont even use the test route in comparison to the compiled
route. the test route is just unreliably laggy, the compiled route is smooth.
i use the iso3d for building everything. and the map tile painter."*

Three consequences:

1. **§6's pop-out target re-aims at /compiled** (+ the iso build pane). The
   edit→feel loop the user actually runs is: paint/build on `/` → Compile →
   `/compiled`. A `<Window>`-hosted CompiledWorldRoute beside the editor makes
   that loop two-windows-zero-flips (compile button already bumps
   `compiledReloadKey` — the second window picks it up for free).
2. **The /test lag is itself evidence for the constitution.** /test is the
   V28 dynamic JS path ("always rencoding, doing tons of work" — correct by
   design); /compiled is the no-JS Zig loader path. The user's felt experience
   — JS path unreliable, baked path smooth — is P1/V28 confirmed in practice.
   The implication: stop spending /test polish budget on rendering smoothness
   and spend it on COMPILE-LOOP latency (make Compile→/compiled so fast that
   /test's only remaining job is what genuinely needs live JS: console
   scripting, physics pokes, V19 verify runs).
3. **The lag deserves a named hunt anyway** — "unreliably laggy" (intermittent,
   not constant) matches the OPEN StaticSurface re-bake spike hunt (the
   120-390ms idle CPU-paint spikes that never reproduce in the standalone
   binary — see memory `devhost_hotreload_rebake_spike`). /test runs the same
   live-JS + StaticSurface stack inside the dev host; /compiled does not.
   These are likely the same bug, and V27's channels (`log churn on`) on a
   /test session while it stutters is the cheap next probe.

Priority list update: §9.5's pop-out re-targets /compiled; the PrefabInfo →
BOM rework joins §9.4 (it is the same "panels carry data + verbs through the
one renderer" move).

---

## 11. ADDENDUM (req_0604, same day) — the thirteen-screenshot UX audit

The user supplied 13 screenshots across the workbench, the buildings panel,
the paint/compose/shader-lab editors, and /assist3d, with four explicit laws.
Verdict on "straightforward or confusing as fuck": **confusing** — and the
confusion has ONE structural cause, diagnosed in §11.4. First the laws, then
the per-screenshot evidence.

### 11.1 The user's laws (codify these — they are P2/P3 rulings in UX form)

- **L1 — A JavaScript slider is bad; sliders are host-driven.** Verified:
  the framework has NO native slider primitive — every slider in the tool is
  `WorkbenchSlider` (JS pointer math → re-render per move). The repo already
  owns the precedent twice: placement drag is engine-native (the engine owns
  `canvas_gx` while the button is down, JS gets the settle — `index.tsx`
  movePlacement) and V23/V26 moved camera drags host-side for exactly this
  lag. A first-class host `Slider` (engine-owned thumb, value streamed on
  change, settle event for commit) is V23's law applied to scrubbing. Every
  `t:'num'`/`t:'slider'` field then upgrades in ONE place (`fields.tsx`
  NumField), which is the payoff of having the one renderer.
- **L2 — A ± stepper with no slider and no direct entry is bad.** Live
  violations on screen: viewport zoom `- 8.2 +` (vehicles), `- 9.4 +`
  (animation/characters), SAM threshold `- 0 +` (paint bench). NumField
  already does input+slider correctly — the steppers are surfaces that
  bypassed the renderer. Rule: a number is ALWAYS (direct entry + slider);
  steppers exist only as an optional third affordance.
- **L3 — An unconstrained container width is bad.** Violations: panel fields
  stretch to whatever the column is; the shader-lab stage renders a 1m-tile
  material as a full-bleed ~1600px quad with zero tile-scale context; the
  compose route's 3D billboard preview is half cut off below the canvas;
  materials-browser rows stretch full width with two words in them. Constraint
  belongs in the RENDERER and the stage frames, not per-source.
- **L4 — One settings door.** Today there are THREE: the chrome's SET door,
  the workbench rail's settings source icon, and the `/` RightPanel SET tab
  (§5.1). The chrome door should navigate to the bench source; the others
  retire.

### 11.2 "Why do I have 3 color swatches and no wheel" — the buildings panel

The buildings source emits WALLS·GLOBAL / ROOFS·GLOBAL / PROPS·GLOBAL as
three structurally identical groups — each with its own copy of the same
11-swatch palette, its own `target` dropdown, its own material row, its own
browse/paint verbs. That is the outer product again (3 piece classes × one
identical picker), rendered vertically. And the missing wheel is NOT missing
machinery: `FieldSpec` `t:'color'` already supports `wheel?: boolean` and
`range` (`shell/fields.tsx:40`, ColorWheel is already imported there) — the
characters source uses the range grid; the buildings source just never opted
in. **The fix is data, not new UI**: one COLOR field with `wheel`+`range`,
one MATERIAL row, and the class becomes a selector (`enum`:
walls/roofs/props — the panel already has exactly this shape in its `target`
dropdown). Three duplicated groups collapse into one task-shaped group.

When image 4 is open, the screen shows FIVE simultaneous swatch collections
(3 building palettes + the paint editor's P/S pair + its quick palette).
One color system, presented once per task, is the bar.

### 11.3 Per-screenshot findings

- **Materials browser (img 3):** two categories are both named "FACADES"
  ("BUILDING FACADES · 6" and "FACADES · 7") — distinguished only by their
  sublabels `recipe · i-brick-*` vs `react · *`, which leak the
  IMPLEMENTATION (shader recipe vs react-rendered) into the user's taxonomy.
  Readable-code rule: name the meaning, not the mechanism. "no building face
  target" / "84 / 84 assignable materials" is internal-state jargon as
  headline copy.
- **Compose (img 5):** width/height are JS sliders + free steppers (L1/L2);
  three deletion-adjacent verbs with unclear scopes (Remove · delete stored ·
  Materialize); layers auto-name `text 7/6/5/3/2` (rename affordance exists
  but the default names carry nothing); the 3D billboard preview is cropped
  (L3).
- **Shader lab (img 6):** "TAKE 1 PARAMETERS" / "Take seed shift" /
  "MATERIAL BANK · count 0 · latest none" — names that fail the travel test
  cold (what is a Take? what does banking do?). The hint text exists
  ("Materialize banks the current look here") but the NAMES should carry it.
  Value renders BELOW the slider here while NumField renders input BESIDE
  slider — same control, two layouts (the one-renderer rule violated by a
  bespoke surface).
- **Vehicles (img 7):** P2 executed literally but without TIERS — identity,
  population tuning, color variations, motion, DEBUG (hitboxes/anchors), gas
  tank, damage all flat and equal. A developer sentence ("consumer: world
  vehicle spawner reads per-type population rows") renders as UI copy. Hex
  colors display as dead text instead of `t:'color'` fields. Zoom is a bare
  stepper (L2). Wants: tier the groups (identity → gameplay tuning →
  debug-collapsed), every number through NumField.
- **Items / TV (img 8):** the useless-panel archetype — five read-only facts
  ("registry item · unaudited scale", "6 parts", a note) and zero verbs
  beyond New/Voxel Blockout. Nothing to do, nothing to learn. Either the
  panel earns fields (scale audit controls — R5 says every item NEEDS scale
  work; this is the natural surface for it) or the source isn't ready to be
  a category. Stage: dark mesh on dark void, no ground/grid reference.
- **Paint roster (img 9):** 77 ungrouped rows mixing real materials with
  draft junk (`shitbrick0`, `whitebrick1`) and a raw content-hash name
  (`chr-mq5aleby-p3g`) — internal ids leaking into the roster. The roster
  needs the same grouping the materials browser already has, and a
  draft-vs-library split. (Counter-example done RIGHT in the same shot: the
  tiny B/E/H/L/F/S key legend — §3's bindings-as-data idea, already alive,
  just 7px small.)
- **Animation (img 10):** 35 action verbs as a full-width vertical chip wall
  — the EXACT shape req_0184 already ruled against ("the chip-wall verdict")
  and built `t:'pick'` for (searchable grouped chooser). The script DSL
  string is cut off in a narrow input (`t:'text'` with width, or `t:'para'`).
  Undo/redo appears THREE times in one view (hero buttons + stage buttons +
  ^Z/^Y). Zoom stepper (L2).
- **Clothing (img 11):** the panel is starved — GARMENT facts + one verb —
  while the real interaction (variant thumbnails, "click a variant to wear
  it") lives at the stage's bottom. LAW 1 says column 3 edits, column 4
  demonstrates; here the edit surface migrated INTO the stage.
- **Characters (img 12):** LAW 1 violated in BOTH directions in one source:
  column 3 is the longest scroll in the tool (SEVEN hero verbs wrapping, an
  8+40-swatch skin dump, sliders for skull/photo/sculpt/six face regions —
  every slider a label/slider/value triple-stack), AND the sculpt-map stage
  carries its own embedded edit panel (MODE/ACTIONS/TOGGLES/BRUSH/STRENGTH/
  PASSES) on the right of column 4. Undo/redo duplicated again (hero + stage
  toolbar). The skin grid is what `t:'color'` `range` exists for — one
  field, not 48 chips.
- **/assist3d (img 13, "this route is ass"):** the last pre-fold lab shell
  still standing as a route — its own backend bar, its own objects tree, its
  own inspector, none of the workbench grammar. Plus a visible controlled-
  input echo bug: MODEL shows `claude-opus-4-7claude-opus-4-7` (BackendBar
  `Field` round-trips value→onChange→patch and doubles —
  `assist3d/BackendBar.tsx:70`). V17-TRIAGE already names the fix: capture it
  as a workbench source (prompt+backend = panel, generated scene = stage,
  objects tree = roster, generate = action) or retire it. As-is it is the
  tool's "30th camera."

### 11.4 The structural diagnosis — panels mirror the data, not the task

Every screenshot is the same disease at a different stage: **a source's
panel is whatever shape its backing data happened to have.** Three piece
classes in the data → three duplicate groups on screen. 35 DSL actions in a
table → 35 buttons. A registry row with five fields → a five-fact dead
panel. The PanelSpec system made panels CHEAP to emit — but it has no
composition LAWS, so each source dumps its state shape raw.

The Workbench has LAW 1 and LAW 2. It needs a PANEL GRAMMAR, enforced where
deep-interfaces says to enforce — at the boundary, in the one renderer, so
no source can violate it:

1. A number is entry + slider, always (L2); sliders are host-driven (L1).
2. Widths are renderer-owned constants; sources cannot produce an
   unconstrained row (L3).
3. One color surface per panel: `t:'color'` with wheel/range; >K quick-picks
   forbidden (the swatch-dump killer).
4. Repeated group shapes are ILLEGAL — if two groups have identical field
   signatures, the spec must factor them into one group + a selector field
   (the buildings fix, made a rule; this is GUIDING_LIGHT's factor law
   applied to UI and it is mechanically detectable in the spec).
5. Verb-set caps: > N actions requires `t:'pick'`/grouped chooser
   (req_0184 already ruled this); hero verbs ≤ 4, the rest behind a menu.
6. Tiers: identity / working controls / debug — debug groups render
   collapsed by default.
7. Undo/redo/save render ONCE (the hero), never per-stage.
8. Stages frame their subject (fit-to-content + ground/grid reference +
   real-scale context for materials), never full-bleed (L3).

Because every source already speaks PanelSpec, the grammar lands in ONE file
(`shell/fields.tsx` + a spec validator) and every panel inherits it — the
same leverage that made the panels cheap makes fixing them cheap. That is
the answer to "repetitive and horribly thought about": the thought belongs
in the renderer's laws, once, not in eleven sources.

Priority insert: the panel grammar + host slider slot between §9.4 and §9.5
— they multiply §9.4's value across every source at once.

---

## 12. ADDENDUM (req_0606, same day) — why the decal composer CAN be part of the normal painter

The user asked directly: "look one more time at the way you make decals and
tell me why this cant be a part of the normal painter." Read both stacks
end-to-end. **Answer: nothing structural separates them. They are the raster
half and the vector half of ONE editor, split only by lineage** (the painter
descends from the cutout cart → `paintSource`; the decal composer descends
from the /compose route → a lens of `materialsSource`). Every "difference" is
a seam, not a wall:

| | painter (`editors/paint/`) | decal composer (`game/textures/` + materials compose lens) |
|---|---|---|
| document | layer stack: RLE byte masks + per-layer config (`layers.ts`) | layer stack: rect/text/image NODES with x/y/w/h + props (`decal.ts`) |
| layer strip | LayerStrip — name/hide/reorder/dup/delete | compose layers rail — same verbs, second implementation |
| image layers | `PaintLayerImage` — has them | `DecalImageNode` — has them |
| render | WGSL surfaces composited through masks on GPU paintables | React subtree (`DecalSurface`) → StaticSurface/TextureCapture |
| persistence | RLE masks on a V20 stream | DecalDoc riding the material record (lossless re-edit law) |
| exit | **Materialize → the same materials store** | **Materialize → the same materials store** |

Both already converge at the exit. Both are layer stacks. Both even have
image layers. The user is looking at two implementations of the same idea
with different layer TYPES.

**The unified model is the one every real art tool ships** (Photoshop: raster
layers, text layers, shape layers in ONE stack): the paint document's layer
gains a kind —

    layer.kind: 'mask' (today's painter layer)
              | 'text' | 'rect' | 'image' (today's decal nodes)

Mask layers brush/smart-select exactly as now; node layers stay parametric
(re-edit the string, swap the font, drag the frame); a "rasterize" verb
flattens a node layer into a mask layer when you want to brush over it (the
standard one-way door). The merged doc rides the material the way DecalDoc
does today — masks AND nodes both lossless, V20 schema-evolution-by-addition.

**What this buys, in the user's own pain vocabulary:**
- One canvas, one layer strip, one color system, one undo, one draft/save —
  the compose lens retires; §11's duplicate-surfaces count drops again.
- Capabilities COMBINE instead of round-tripping: graffiti text over a
  painted brick layer, a shader-filled rect under hand-painted weathering —
  today each requires materializing in one editor and reopening in the other
  (lossy, two drafts, two histories).
- The locked vocabulary SURVIVES intact (memory: shader|decal|image →
  Materialize → material): those three stay the SOURCE KINDS — they become
  layer kinds in one authoring canvas instead of three authoring surfaces.
  Materialize remains the one exit. A `decal` material record stays a decal;
  only its EDITOR folds.

**The honest cost (the actual engineering seams):**
1. **The compositor interleave** — the real work. Mask layers draw via GPU
   paintable surfaces; node layers draw via React capture. One stack must
   z-order them together: render node layers as captured textures (Static-
   Surface already invalidates on subtree mutation — the compose preview
   relies on this today) sandwiched between paintable quads. Contained to
   the paint surface; the engine already owns both halves.
2. **A move/select tool** in the painter's tool row + the compose stage's
   selection chrome ported over. The painter is already tool-modal
   (brush/smart/hand/lasso/refine) — 'move' is one more, and it resolves the
   input-modality difference entirely.
3. **History unification** — paint `history.ts` vs the materials session.
   V20 answers this (undo = log position); the merged editor commits to one
   channel.
4. **Migration is trivial** — an existing DecalDoc is already the merged doc
   with zero mask layers; an existing paint doc is the merged doc with zero
   node layers. Nobody loses anything.

This is the same fold the workbench was built to perform on routes, applied
one level deeper — to documents. It also future-proofs the graffiti/custom-
font direction for free: a font is a node-layer property (decal.ts already
carries the full font surface "so the planned custom-font work is a host-side
family addition, never a schema migration").

Priority: joins the §9.4 panel-consolidation family; sequence it AFTER the
panel grammar (§11.4) so the merged editor is born under the new laws rather
than retrofitted.

### 12.1 REVISION (req_0607, same day) — the user's answer is better: lower it ALL to the GPU

The user, on §12's "compositor interleave" cost: *"why dont you just move it
all to the gpu instead? i mean look at cart/boxxx_demo.tsx."* Checked the
engine. **He's right, and the engine is closer than §12 assumed.** Cost #1
(React-captured node layers sandwiched between paintable quads) is the wrong
plan — capture leaves the loop entirely:

- `paintRectBatch` (`framework/engine.zig:2420`) already has a **flat-spec
  path**: boxes as PURE DATA — 14-float rows (pos/size/color/radius/border),
  no child nodes, no layout pass, straight into the instanced SDF-rect
  pipeline (`framework/gpu/rects.zig`, 80-byte instances). A `DecalRectNode`
  IS one of those rows with names. The decal doc never needed the JSX walk —
  `decal.ts` is already "data only, no React imports"; only `decalRender.tsx`
  hydrates it into React so StaticSurface can capture it. Cut the middleman:
  **DecalDoc → instance rows is a direct serialization**, the document is
  already the Boxxx flat-spec format.
- So the merged painter canvas becomes ALL GPU: mask layers on paintable
  surfaces (as today) + node layers as instanced rows, z-ordered as DRAW
  ORDER between two GPU pipelines — not as React-capture sandwiching. No
  StaticSurface in the edit loop at all. That also deletes the per-keystroke
  React-render+capture the compose preview pays today, and removes the
  editor's dependency on the exact mechanism implicated in the open re-bake
  spike hunt (§10.2.3) — the same machinery the user experiences as /test
  lag leaves his daily canvas.
- Constitution math: this is P1 verbatim (JS authors the doc; Zig runs it),
  GUIDING_LIGHT's narrow waist (declarative data through a fixed system),
  and V28's shape (the canvas becomes engine capability parameterized by
  data). §12's React-capture plan was the obvious-shape temptation table's
  left column; the flat-spec path is the right column and it already exists.

**The real dependency list** (smaller than §12's, and each item is already
on a roadmap):
1. **Glyph-atlas emit for text rows** — the SOLE hard gap, and it is
   literally the named "next layer" in the Boxxx plan (boxxx_demo.tsx:12,
   engine.zig: "Text/Image are skipped for now (next layer: glyph-atlas
   emit)"). gpu_text already owns the FT faces; the work is emitting
   positioned glyph quads into a batch instead of scatter paint. Building it
   for the painter UNBLOCKS Boxxx v2 for every cart — shared win, one
   roadmap item funded twice. (Mind the shared-FT-face pixel-size hazard —
   memory `ft_face_shared`.)
2. **Textured-quad instances** for image rows (atlas/texture binding in the
   rect pipeline, or a sibling instanced pipeline).
3. **Shader-filled rects**: `fillData` is a FROZEN recipe — bake it once to
   a content-addressed texture (V29's move exactly; the material bank
   already does this) and it becomes a textured quad. Re-bake per EDIT when
   tweaking, never per frame.
4. Selection chrome/handles can stay React — overlay UI, tiny, not hot.

Materialize then needs no special path either: the export is one readback of
the GPU canvas — `framework/gpu/capture.zig` (the SELFSHOT machinery) already
reads back its own frame.

§12's verdict stands (one editor, one layer stack); §12.1 replaces its
rendering plan: **don't composite two render worlds — lower the document to
the one the engine already batches.**

---

## 13. ADDENDUM (req_0608, same day) — props vs items: props have NO workspace existence

The user's hint checks out, and the asymmetry is stark. **Items** are
first-class workspace citizens: `itemsSource()` on the bench (roster, panel,
voxel SCULPT stage), `items` + `voxels` streams, their own data domains —
author an item in the tool, it persists, the registry serves it. **Props are
not in the workspace at all**: no source, no stream, no data domain, no
roster. Verified: `ls data/domains/ | grep prop` → nothing;
`editors/workbench/sources.ts` → no props source.

Where props actually live is the pre-fold disease at full strength —
**FOUR hand-synced code homes for one concept**:

1. `world/propKinds.ts` (722 lines) — the LEGACY kind registry, still the
   one consumed by the live editor surfaces: ObjectsTab's palette
   (`ObjectsTab.tsx:36`), PropertiesPanel, placements.ts, editorWorld,
   npc/kinds, **and compile/worldGeometry.ts**.
2. `game/kinds/props.ts` (791 lines) — the V17-captured registry ("fresh
   capture of … behavior reference only"), consumed by the OTHER half:
   `game/kinds/index.ts`, the build catalog, command vocabulary.
   **The two registries have SPLIT consumers — the editor and compile read
   the legacy file; the game door reads the capture.** That is a live
   divergence hazard, not just duplication: a prop edited in one table
   silently differs in the other's consumers.
3. `render3d/props/*.tsx` — a hand-written React mesh file PER PROP
   (Bush.tsx, FireHydrant.tsx, Mailbox.tsx, Payphone.tsx, …) on the layer
   V2 already retired.
4. `compile/worldGeometry.ts` — `propColor`/`propAt` re-encode prop
   geometry/colors AGAIN for the baked world.

So the lifecycle today: adding or changing a prop = an agent edits 2–4 code
files + rebuild. `game/kinds/props.ts` opens with "THE TABLE IS THE DATA
(P2)" — but a table you cannot reach from the tool is exactly the buried
constant P2 outlaws; the memory layer even carries standing instructions for
which files to hand-sync (`hmsc_dir_dissolved`: "new prop kinds go in
world/propKinds.ts AND game/kinds/props.ts + compiled parts in
compile/worldGeometry.ts"). And the prop INTERACTION layer just shipped
(PROPUSE-0610: seats, searchable containers, cover, mounts) — more per-kind
data, also code-only.

The constitution has already ruled the destination twice:
- **V24**: "Props remain PROMPT-GENERATED assets — the catalog's prop
  entries fill from the existing items/model pipelines, not from the
  builder." Props are supposed to ride the SAME model pipeline items ride.
- **V11/R5**: the items registry is the source for small objects, with the
  scale audit as standing work — a workspace surface is where an audit can
  actually happen.

**The fold (the same shape every other concern already took):**
1. **One kind registry.** `game/kinds/props.ts` is the ruled home (V17
   capture, V18 game door); the legacy `world/propKinds.ts` consumers
   (ObjectsTab, PropertiesPanel, placements, compile) repoint to
   `GAME_KINDS` and the legacy file retires. This kills the split-consumer
   divergence hazard FIRST — it's the cheapest and most dangerous item.
2. **A `props` workbench source** on the tunables pattern (code-table
   defaults + a V20 `props` stream of overrides/additions folded at boot —
   `editorTunables` is the exact precedent): roster = the kind table,
   panel = the property bundle (footprint, tileKind borrow, cover/
   concealment, the PROPUSE interaction rows), stage = the placed prop at
   1-tile scale. P2 satisfied: every prop number reachable in the tool,
   compile consumes the merged snapshot.
3. **Models from the items/voxel/carve pipeline** (V24's ruling): a prop's
   mesh becomes authored data like an item's — voxel blockout, carve, or
   prompt-generated — replacing the per-prop hand-written `.tsx` mesh files
   and `worldGeometry`'s re-encoded colors with one model record the
   compile bakes (V29 content-addressed, same as everything else).

Items vs props then stops being two systems: both are "small 3D things with
a property bundle and a model"; an item is the carryable specialization
(HUD icon, in-hand pose), a prop is the placeable one (collision, cover,
interactions). One authoring stack, two property schemas — the sum, not the
product.

Priority: step 1 (registry unification) is a hazard fix and belongs in the
§9 list immediately after §9.1; steps 2–3 join the §9.4 panel family.
