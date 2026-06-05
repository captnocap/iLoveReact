# editors/settings — CAPTURE (SETTINGS-0605)

THE USER'S RULING, verbatim: "it would be nice to have a grand settings page
that shows an event bus for all of these [the routes' session/autosave
systems], and we need to get all those magic numbers into some route for
interfacing with."

P2, verbatim (the addendum's reminder): "Every number, value, name — all of
it — arrives at an interface (the internal tool) where it can be changed at
any time... A constant buried in code that affects game behavior is a bug per
this principle." **The registry built here IS that interface; everything in
the burndown below is therefore a BUG, not a backlog nicety.**

## What landed

- `editors/tunables.ts` — THE P2 registry: register-where-the-number-lives
  (dotted path + KnobSpec into the module's own live table), clamp at the
  boundary, write-through (no second copy), reset-to-default, revision poll
  signal, V20 `tuning` stream persistence (set/reset → override map; boot
  fold in index.tsx, pending until late registrations). 7 P4 cases.
- `editors/settings/SettingsRoute.tsx` + `bus.ts` — `/settings` (Settings
  nav icon): the SESSION EVENT BUS (pure fold over the `sessions` stream
  through the existing doors — every route's commits/notes on the one global
  seq, per-channel filters + counts + open dots; read-only, no second event
  system, no new persistence) and the TUNABLES surface (groups by system,
  GAME_CHROME knobs live, per-knob reset; every edit = one LABELED commit on
  this route's own `/settings` session over the `tuning` channel — knob
  turns ride the bus and persist). 5 P4 bus cases.
- Migrations (proof, each its own commit, behavior identical): `paint`
  (PAINT_TUNING, 33 leaves), `cutout-view` (CutoutRoute VIEW), `vehicles-view`
  (VIEW_TUNING), plus `settings-view` (the page's own chrome — dog food).

## THE P2 BUG BURNDOWN — un-migrated magic-number clusters

Found by sweeping the existing tuning/P2 clusters (not guessed from numeric
literals). Each row = one `editorTunables().register()` call where the table
lives + a spec per numeric leaf; the page picks it up with zero settings-side
work.

**Editor-side (the import arrow already allows registration in place):**

| cluster | where | notes |
|---|---|---|
| `RAIL` | editors/cutout/ToolRail.tsx:24 | rail chrome sizes (8 leaves) |
| `INSPECTOR` + `KNOBS` | editors/cutout/Inspector.tsx:30,40 | inspector chrome + per-knob specs (KNOBS rows are themselves min/max/step — registering a knob's BOUNDS is meta-tuning; decide whether bounds are tunable before registering) |
| `KNOBS` | editors/paint/PaintControls.tsx:36 | same meta-tuning question |
| `REGION_SLIDER_TUNING` | editors/characters/controls.tsx:15 | |
| `REGION_TUNING` | editors/characters/regions.ts:64 | |
| `GENERATE_TUNING` | editors/characters/generate.ts:24 | |
| `PAINT_EDITOR_TUNING` | editors/characters/paintKit.ts:19 | paintKit is slated for replacement by editors/paint (its CAPTURE hand-off) — register only if it survives |
| `HELD_ITEM_TUNING` | editors/characters/preview.tsx:126 | |
| `VEHICLE_EDITOR_TUNING` | editors/vehicles/edits.ts:25 | the two reference gasZ clamp ranges (P2, asymmetry surfaced in the vehicles CAPTURE) |

**Game-side (`game/**` P2 tables) — BLOCKED on a structural decision:**
`game/` may not import `editors/` (STRUCTURE.md arrows), so these tables
cannot self-register into `editors/tunables.ts` without violating the
constitution. Two honest shapes, pick one by ruling: (a) the registry
graduates OUT of editors/ to a layer game/ may import (data/-adjacent — the
`tuning` stream already lives in data/streams), or (b) an editors-side
registration shim per table (editors→game is a legal arrow; registration is
then NOT "where the number lives"). Until ruled, the clusters wait:
`CHANCE_TUNING` (chance.ts:91), `PERCEPTION_TUNING` (perception.ts:39),
`LANDFORM_TUNING` (kinds/landforms.ts:96), `TELEMETRY_TUNING`
(telemetry.ts:44), `COMMAND_TUNING` (commands/vocabulary.ts:46),
`VEHICLE_TUNING` (vehicle/index.ts:257), `MISSION_TUNING`
(missions/tuning.ts:13), `RAGDOLL_TUNING` (figure/ragdoll.ts:60),
`WORLD_TUNING` (world/grid.ts:29), `ANIMATION_DSL_TUNING`
(animation/index.ts:34), `LAB_SKY_TUNING` + `CHROME_TOKENS`/`CHROME_LAYOUT`/
`CHROME_KNOB_PRESETS` (chrome/index.ts), `STORY_TUNING` (story/tuning.ts:7),
`PLACED_TUNING` (build/placed.ts:64), `CUTSCENE_TUNING`
(cutscene/index.ts:32), `SNAP_TUNING_DEFAULTS` (editors/build/snap.ts:34 —
also pane-2 fenced, below).

**Deliberately excluded from the migrated tables (need registry kinds beyond
plain numbers — the v2 seam):**

- `PAINT_TUNING.bands` — MUST byte-match the in-shader compose in
  surfaces.ts; live-editing one side breaks a pinned invariant. Needs a
  one-source seam (shader reads the table at build) BEFORE registration.
- `PAINT_TUNING.overlayRes` — baked into stored asset preview cells; a live
  change desyncs old assets' grids. Needs res-stamped assets first.
- Arrays/vectors: `brushSizes`, `palette` (paint), `orbit.target` (vehicles).
- Enums/strings: `layerLook.defaultSurface/defaultBlend`, `samMaskIdx`
  (0|1|2), `sessionsDir`.
- `playback.secondsPerFrame` (vehicles) — a unit conversion coupled to the
  DSL's seconds; tuning it independently of frameMs lies about time.
- `SETTINGS_VIEW.pollMs` is registered but read at effect arm — a live edit
  applies on the next route visit, not mid-mount.

## PANE-2 HAND-OFF (fenced files — inventoried, NOT touched)

`editors/build/` + `TestRoute.tsx` (+ the new `Embodied.tsx` substrate) were
mid-extraction by another lane; their knobs are inventoried here for that
lane to register once the extraction settles:

| knobs | where | today |
|---|---|---|
| `reachMeters`, `ghostOpacity`, `groundMarchStepMeters` | editors/build/BuildRoute.tsx ~292 (defaults `SNAP_TUNING_DEFAULTS`, snap.ts:34) | LIVE in-route tuning panel (P2-in-interface already) — registering moves them onto the one registry + persistence |
| `BUILD_UI` | editors/build/BuildRoute.tsx:56 | static chrome cluster |
| `CONSOLE_UI` | TestRoute.tsx:25 | static chrome cluster |
| `GAIT`, `FRAME` | Embodied.tsx:91,95 | substrate feel numbers (gait cadence, dt clamps) — these are GAME-feel, may belong with the game-side ruling above |

## Surfaced, not guessed

- **Bus wall-clock display**: SessionsState doesn't fold the stored `at`
  stamp; the bus shows seq order (which IS V20's order). Folding `at` into
  the sessions materializer is a small sessions.ts addition — left to the
  sessions layer's owner, not done mid-flight while the autosave lane was on
  those files.
- **Cross-route liveness**: a knob edit writes through to the live table; a
  route that is MOUNTED at that moment repaints on its own next render —
  there is no broadcast. (The settings page itself polls.) If a route wants
  instant repaint-on-tune, it polls `revision()` like the page does.
- **One commit per knob press**: the sessions contract (the vehicles
  precedent). A future drag-slider knob wants the history.coalesceMs
  treatment before it lands on the registry path.
- **Renamed knobs orphan their overrides**: an override for an id that never
  registers again just sits in the pending map (and the stream keeps the
  event — V20 says old streams stay valid). A `gc` door was deliberately not
  built; revisit if the stream grows noisy.
