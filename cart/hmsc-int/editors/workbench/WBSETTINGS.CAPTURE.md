# WBSET9-0606 CAPTURE — the settings source's capability parity table

The COVERAGE LAW deliverable for the SETTINGS half of step 9 (WORKBENCH.md
§6): every census/settings.md row, line-referenced to the dying /settings
route, with its workbench landing. Sources audited end to end:

- `editors/settings/SettingsRoute.tsx` (221 lines — every line read; UNTOUCHED, dies at the flip)
- `editors/settings/bus.ts` (the bus fold — imported UNCHANGED by the logs source)
- `editors/tunables.ts` (the P2 registry — the one write path, unchanged)
- `editors/workbench/tunablesSource.ts` (step 3's proof source — FOLDED IN, see notes)
- `cart/hmsc-wire/index.tsx:154-333,650-898` (the user-approved W3 shape)

New files: `editors/workbench/settings/{store.ts,panel.ts,live.ts,rigs.tsx,source.tsx,settings.test.ts}`,
`editors/workbench/livePoll.ts`, `editors/workbench/tone.ts`; additive edits:
`shell/fields.tsx` (the num reset rider), `editors/workbench/sources.ts`.

Landing legend — **R** roster (gutter 2) · **P** panel (gutter 3) · **S** stage
(column 4) · **L** lens (preview bar) · **A** action (hero bar) · **F** frame
(Workbench.tsx owns it) · **LOGS** lands in the logs source (WBLOGS.CAPTURE.md).

## The census rows (census/settings.md C1–C9)

| # | source (dying route) | capability | landing |
|---|---|---|---|
| C1 | index.tsx:803,844,945 · chrome.tsx:165 | opens as a full-shell overlay | **F** — the settings source lives on /workbench (sources.ts:29 `settingsSource()`); the /settings route + nav icon die at the flip, not today |
| C2 | SettingsRoute.tsx:141,145 | `← editor` exit | **F** — the frame's exit button (shell/Workbench.tsx SourceRail onExit), every source shares it |
| C3 | SettingsRoute.tsx:94-99,151 · bus.ts:41 | session event bus summary + rows, newest first | **LOGS** — the bus IS a stream, so it lands as the logs source's `session bus` roster row + per-channel dashboard cards (logs/store.ts:122-137 busLines, LogStream.tsx StatBand); the store-unavailable warning surfaces verbatim (logs/LogStream.tsx:53-57, logs/panel.ts store status). Cross-referenced in WBLOGS.CAPTURE.md |
| C4 | SettingsRoute.tsx:101,155-156 · bus.ts:81 | per-channel chip filter, `all` clears | **LOGS R+L** — one roster row per live channel + the CHANNEL ⇄ ALL lens (logs/panel.ts:22-28 — LAW 2's own "ALL ⇄ channel" example, made real). Twig parity: the route's `/settings.channelFilter` twig becomes the frame's `/workbench` selBySource/lensBySource twigs — persisted, different key |
| C5 | SettingsRoute.tsx:76-92 | polls undoPoint + tunables revision, re-renders only on movement | **WORKBENCH** — `editors/workbench/livePoll.ts:59` subscribeLiveDoors: the SAME two doors, one shared interval for both step-9 sources, notify only on movement; sources hook it via `subscribe` (settings/source.tsx:33, logs/source.tsx:33) |
| C6 | SettingsRoute.tsx:104-105,187 · tunables.ts:69 | lists registered systems + knobs | **R+P** — roster GENERATED from the registry (settings/panel.ts:22 settingsRoster), panel GENERATED per system, grouped by owning route, num fields carrying the registry's own min/max/step/precision (settings/panel.ts:27-52 — the tunablesSource protocol, grown). Counts live in the hero meta (GROUPS/FIELDS) |
| C7 | SettingsRoute.tsx:120-127,203 · tunables.ts:124 | knob edits write through + commit on the V20 'tuning' channel | **P** — every generated set() clamps, writes THROUGH the live table, and lands the route's exact commit label shape (settings/store.ts:69-76; label `id → value` per SettingsRoute.tsx:122-125). The commit history is now VISIBLE in the workbench too: the dashboard rig's RECENT TUNING feed (settings/panel.ts:90 tuningFeed) + the logs source's `tuning` channel row |
| C8 | SettingsRoute.tsx:128-135,204-210 · tunables.ts:180,216 | reset a non-default knob to its registered default | **P** — the num reset rider (shell/fields.tsx:26 — additive FieldSpec growth, the WBCHAR precedent): at-default shows the dim `default` marker, overridden shows the `↺ <formatted default>` chip (fields.tsx:77-86); run() = registry reset + the route's reset commit label (settings/store.ts:77-84, settings/panel.ts:45-49) |
| C9 | SettingsRoute.tsx:36-50 | the settings view registers its OWN tunables (dogfood) | **WORKBENCH** — the workbench view does the same: `workbench-view` (pollMs / logRowCap / feedRowCap) registers in livePoll.ts:17-33 and therefore appears in its own generated roster. The route's `settings-view` system keeps appearing while the route lives; it dies with the route at the flip |

## Column 4 — the rigs (settings demonstrate by ACTING, WORKBENCH.md §1)

| system | rig | what acts |
|---|---|---|
| `sculpt-camera` (the camera-feel cluster) | **CameraFeelRig** (settings/rigs.tsx:52-118) | a phantom mouse drags at 140 px/s in a circle; sculptCamera.orbitMove's EXACT hand math (sculptCamera.ts:326-358: yaw −= dx·yawPerPx, pitch clamped −= dy·pitchPerPx) replays against the LIVE table through the proven V23 native-orbit wire (ObjectInspect3D.tsx:73-88 engage + setInputDeltas; the interval never re-renders React). Turn `orbit yaw °/px` in gutter 3 → the sweep visibly accelerates that instant. The caption prints the derived °/s + zoom band + fly numbers (rigs.tsx:109-115) |
| every other system | **DashboardRig** (settings/rigs.tsx:122-194) | LAW 3's "demonstrative dashboards": stat cards (knobs / overridden / tuning commits — real registry + bus numbers), a full-bleed bar per knob (value fill + default tick, overridden knobs read amber), and the system's RECENT TUNING commits newest-first — a knob turn in gutter 3 lands a feed row while you watch |

## Notes / deviations (none dropped — the fold contract)

- **tunablesSource folded in** (sources.ts:29): the settings source carries
  everything step 3's proof source did (registry roster, generated num panel,
  write-through) and grows commits/reset/rigs. `tunablesSource.ts` stays on
  disk unreferenced; it deletes at the flip with the route.
- **Registry counts are a moving target by design.** The dispatch's snapshot
  said 7 systems / 69 knobs; in this tree the cutout-flip lane (parallel,
  uncommitted) has deleted CutoutRoute.tsx and its `cutout-view` system with
  it. Measured at this tree: 6 pre-existing systems / 64 knobs (+ `workbench-
  view`, 3, mine = 7 systems). Nothing here enumerates a system or a count —
  the roster/panel are GENERATED from `editorTunables().list()`, so whatever
  registers at boot is what shows.
- **livePoll's interval reads pollMs once at arm time** (livePoll.ts:63) —
  the same property the route had (SettingsRoute.tsx:90 captures pollMs at
  mount). Parity, not a regression.
- The P4 suite: `settings/settings.test.ts` (8 tests) — generation round-trip,
  clamp/write-through/commit-label parity, reset rider semantics, knob bars,
  tuning feed filtering, the down-store path. Headless per the
  characters.test.ts bundling law (panel.ts + store.ts only).

## SETDENSE-0607 — USER VERDICT fix (the density fail; relayed via req_0212 handoff)

| fail (user verbatim) | fix |
|---|---|
| "this is nice but its also TOOO dense on the settings. like im all for dense ui but that shit is sitting ass to mouth" — the gutter-3 generated panel rendered 34 paint knobs as a 4-across wrapping strip; labels collided into "brush px cursor ms smart r lasso r" soup over the `default` rows. (Column 4's DashboardRig bars PASSED — untouched) | one field per ROW, in THE shared renderer without forking it: additive `layout?: 'rows'` on `PanelGroup` (shell/fields.tsx) — rows-mode renders the group's FieldStrip as a column, every cell full-width with no inter-cell rule and the label in a fixed 104px gutter so controls align. Every existing panel (characters/buildings/…) omits the flag and keeps the flowing D1 strip, byte-identical render. AND the groups follow the registry's own structure now: settingsPanel (settings/panel.ts) buckets dotless paths under the route header and every dotted cluster (`cursor.*`, `edgeSnap.*`, `lasso.*`, …) under its own section title (`EDGE SNAP`) — section headers exist only when their cluster does (the SCULPTKIT conditional-sections law). 'paint' goes from one 34-field wall to EDITORS/PAINT(5) + CURSOR(3) + PRESSURE(3) + EDGE SNAP(4) + LASSO(5) + CANVAS(4) + HISTORY(2) + LAYER LOOK(3) + BACKENDS(5) |

Suite stays 8/8 (the generation test now asserts the cluster sub-grouping +
the rows layout flag). Shot: `/tmp/setdense-fix.png`.
