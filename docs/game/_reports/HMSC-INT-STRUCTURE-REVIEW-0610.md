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
5. **`<Window>` pop-out for /test** (§6) — the highest-joy QoL item; small if
   the gating checks pass.
6. **EditorShell extraction along the four seams** (§2) — the enabling move
   for everything after; do it before the map editor goes event-sourced.
7. **Map edits onto the world channel** (§2 V20 note) — the big one; erases
   the undo-reconcile machinery and the per-stroke whole-map serialize as a
   side effect.
8. **One lab registry** (§5.3) + root-directory sweep (§8) — hygiene with
   compounding payoff.
