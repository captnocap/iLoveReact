# Capture note — game/telemetry.ts (V14, capture wave 2026-06-04)

The measurement + copy-diagnostics surface, rewritten fresh per V14
("Telemetry panel + copy-diagnostics button: in" — ground floor, every lab
gets it free). References untouched.

**THE FENCE:** this module measures and serializes; it renders nothing. The
panel that displays these numbers is chrome's (game/chrome Panel/Meter + the
labs route) — chrome polls this surface at `TELEMETRY_TUNING.panel` cadences
and maps `fpsTone` tones to its own palette.

## Sources (read, never moved/copied/imported)

| piece | old file | what it contained |
|---|---|---|
| the spike flight recorder | `cart/hmsc/state/perfWatch.ts` (gv_perflog lineage) | baseline = median of the host `__tel_history` ring; two-gate detection (ratio 1.15 AND ≥500us jump); calm-vs-spike counter diff over the gpu/nodes/input blobs (`zero_size` excluded — cumulative garbage); the WHAT-FIRED classifier (CONTENT SWAP ≥20 nodes/50 glyphs/12 meshes → GLYPH RASTERIZE ≥5 atlas → paint→CAPTURE RE-BAKE±hash → gpu→VSYNC vs DRAW/UPLOAD (cpu<1500us, drawSwing<3) → TICK → GC/NATIVE → REPAINT → unclear); 400ms cooldown; 48-frame tape; warn-severity emit; armed heartbeat |
| copy-diagnostics | `cart/hmsc_massive_map_lab.tsx` (the button) | one JSON snapshot — label, capturedAt ISO, every telemetry blob, domain extras — pretty-printed to the system clipboard via `__clipboard_set` |
| the panel idiom | `cart/render_perf_lab.tsx` / `cart/hmsc_massive_map_lab.tsx` | scalars @250ms + JSON @500ms; fps thresholds good ≥55 / warn ≥30 / bad below |
| the wire vocabulary | `runtime/hooks/useTelemetry.ts` (live platform code) | kind → host fn catalog; this door carries the GAME subset as table data (`SCALAR_HOST_FN` / `SNAPSHOT_HOST_FN`) |

## Verification

- `game/telemetry.test.ts`: **26/26** P4 meaning-tests green under v8cli —
  honesty (availability naming, fallback reads), kind→fn mapping, snake_case
  normalization, ring sanitation, both detector gates (the canonical
  240→190fps dip fires; ratio-only and jump-only do not), the full verdict
  tree, the report shape, snapshot + clipboard transport, runtime diagnostics
  toggles, aggregate JSONL output, and disabled-channel overhead measurement.
- `rjit game verify`: **VERDICT GREEN — 26/26 suites, 2/2 scripts.**
- Metafile gate: `cart/hmsc-int/game/telemetry.ts` added as a trigger on the
  existing `telemetry` registry entry (`sdk/dependency-registry.json`) — the
  game-pathing "or the door" pattern. Importing the game door now compiles
  the `__tel_*` bindings in; without this the capture would have shipped the
  exact "diagnostics silently degrade" hazard it set out to fix.

## Shape decisions

- **V27 PERFLOG-0605: one switchable diagnostics system**:
  `GAME_TELEMETRY` owns `DIAGNOSTIC_CHANNELS` (`frame`, `tick`, `physics`,
  `camera`, `figure`, `worldStream`, `bridge`, `draw`, `capture`, `hmr`,
  `pools`, `churn`, `spikes`). Every channel is off by default. A disabled
  channel exits after the boolean check; enabled channels aggregate samples
  over `TELEMETRY_TUNING.diagnostics.aggregateWindowMs` and flush structured
  JSONL to `/tmp/hmsc-int-diagnostics.jsonl`. This is the CAMSTUTTER lesson:
  no hot-path per-call `console.*` prints.
- **Runtime control is command vocabulary**: `log status`,
  `log all on|off|toggle`, `log <channel> on|off|toggle`, `log dump [label]`,
  and `log overhead [iterations]` are real GAME_COMMANDS registrations so
  verify scripts and the live console use the same path. `gv_perflog`
  remains as a compatibility alias onto the `spikes` channel.
  `diagnosticToggles()` exposes
  `diagnostics.<channel>` keys for the settings/tunables registry hand-off.
- **Folded families**: `perfLog.ts`/`useChurn` no longer writes a separate
  churn log; it records into the `churn` channel. The old spike watcher now
  records `spikes` aggregates while preserving its visible warn report for
  actual spike events.

- **Pure core, thin loop**: `detectSpike` / `classifySpike` /
  `buildSpikeReport` are pure (testable without a host); `startSpikeWatch` is
  the only loop — idempotent, setTimeout-16 fallback (no rAF on this host),
  calm-snapshot refresh on calm ticks, warn-severity output (console.log
  never reaches a terminal).
- **The honesty rule** (the ruled-in fix for the LOW hazard "diagnostics
  silently degrade if host fns are missing"): every read tolerates an
  unwired host AND `availability()` names exactly which fns are absent so
  the panel can say "telemetry not wired" instead of rendering zeros.
- **P2**: every threshold/cadence/gate in `TELEMETRY_TUNING`; the wire names
  and the diffable counter set are table data (`COUNTER_SPEC`).
- **Faithful duality carried**: the reference checked "did __tel_frame carry
  the spike frame?" against the fps-implied baseline in its classifier but
  the measured baseline in its report line. Both kept, documented at
  `caughtRatio`.
- **`__clipboard_set` called directly** (not `runtime/hooks/clipboard.ts`):
  that module's import side-effect registers IFTTT verbs — wrong baggage for
  a measurement module in every game cart. The wire name is the contract,
  same as input.ts's `__keydown`.
- **First feeds**: GAME_PHYSICS `hostMicroseconds` (and any lab number) rides
  `createSampleRing` + `buildDiagnostics(label, extra)` — the door never
  reaches into physics.

## Deliberately NOT carried

- **The platform telemetry catalog** (net/system/canvas/layout/processes/
  threads/per-node queries) — stays in `runtime/hooks/useTelemetry.ts`; a lab
  wanting OS process listings is doing platform work, not game work.
- **The old standalone `gv_perflog` path** — no separate spike-toggle system
  was carried; the command vocabulary keeps `gv_perflog` only as a
  compatibility alias onto the `spikes` diagnostics channel.
- **The React hook itself** (`useTelemetry`) — the door stays react-free so
  it bundles/tests under v8cli; chrome owns polling-in-render.
- **massive-map's hardcoded cap labels** (meshCap 8192 / nodeIndexCap 4096) —
  the HIGH "stale printed caps" hazard; the snapshot carries live host
  numbers only, never printed constants.

## Ambiguities surfaced (not guessed)

1. **sqlite3 rides the telemetry gate**: the registry entry lists `sqlite3`
   under nativeLibraries, so every cart importing `@game` now bundles it.
   Pre-existing coupling on the platform entry, not introduced here — but the
   ruling maker should know the ground floor's weight grew by one .so.
2. **The GAME snapshot subset** (frame/gpu/nodes/input) was chosen from the
   panel idiom + perfWatch's diff set; if a lab needs `canvas`/`layout`
   blobs, widening `SNAPSHOT_HOST_FN` is a one-line table edit.
3. **`GAME PERF SPIKE` header** replaces the reference's `HMSC PERF SPIKE` —
   the recorder is ground floor now, not hmsc's. Grep-compat with old logs
   was judged not load-bearing.
