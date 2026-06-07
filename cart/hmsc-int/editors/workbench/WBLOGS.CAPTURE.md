# WBSET9-0606 CAPTURE — the logs source's capability parity table

The COVERAGE LAW deliverable for the LOGS half of step 9 (WORKBENCH.md §6):
every census/log.md row, line-referenced to the dying /log route, with its
workbench landing — plus the /settings session-bus rows that land HERE
(census/settings.md C3/C4; the bus is a stream, so it lives in the streaming
category). Sources audited end to end:

- `cart/hmsc-int/LogView.tsx` (109 lines — every line read; UNTOUCHED, dies at the flip)
- `cart/hmsc-int/perfLog.ts` (the ring + diagnostics doors — imported UNCHANGED)
- `editors/settings/bus.ts` (the V20 sessions fold — imported UNCHANGED)
- `cart/hmsc-wire/index.tsx:163-171,286-333,691-787` (the user-approved W3
  logs shape: dashboard band, SelBar select/copy, stripe/chip stream)

New files: `editors/workbench/logs/{churn.ts,store.ts,panel.ts,live.ts,LogStream.tsx,source.tsx,logs.test.ts}`.

Landing legend — **R** roster · **P** panel · **S** stage · **L** lens ·
**A** action (hero bar) · **F** frame.

## The census rows (census/log.md C1–C7)

| # | source (dying route) | capability | landing |
|---|---|---|---|
| C1 | index.tsx:803,843,915 · chrome.tsx:164 | opens as a full-shell overlay | **F** — the logs source lives on /workbench (sources.ts:30 `logsSource()`); the /log route + Activity nav icon die at the flip, not today |
| C2 | LogView.tsx:75-101 | header: CHURN LOG, shown/total counts, `tail -f <path>` hint, newest-first rows | **S+P** — counts live in the dashboard band's churn card (logs/store.ts:153-167 stats; big = ring lines, sub = logging state); the file path is a panel property (logs/panel.ts:49-63 FEED · file = perfLog.logFilePath, the route's hint kept findable); the stream stays newest-first (logs/store.ts:105-120 churnRows tail view) |
| C3 | LogView.tsx:37-43,68,72,85 | key-only ⇄ all-lines filter, twig-persisted | **L** — KEY ⇄ ALL lenses (logs/panel.ts:22-28); the key rule carried VERBATIM (churn.ts isKeyLine — KEY_TAGS + the regionSync-FIRE rule). Twig parity: `/log.keyOnly` becomes the frame's `/workbench` lensBySource twig — persisted, different key. KEY leads, matching the route's keyOnly=true default |
| C4 | LogView.tsx:69,86 · perfLog.ts:55,57 | pause/resume churn logging | **A** — the hero `pause`/`resume` verb (logs/panel.ts:30-47 logsActions), delegating to perfLog.setLoggingEnabled — the diagnostics channel, same wire |
| C5 | LogView.tsx:87 · perfLog.ts:52-53 | clear the in-memory + on-disk log | **A** — the hero `clear` verb (same actions table), delegating to perfLog.clearLog |
| C6 | LogView.tsx:96-98 | empty state reflects logging state | **S** — LogStream.tsx:53-57: `no log lines yet — paint something` ⇄ `logging paused`, the route's wording verbatim; bus feeds add `no session activity yet — edit on any route and it lands here` (SettingsRoute.tsx:169 parity) + the store-unavailable warning |
| C7 | LogView.tsx:65-67 · perfLog.ts:48,86 | subscribes to flushes, tails live | **WORKBENCH** — source.subscribe wires perfLog.subscribeLog AND the shared live-doors poll (logs/source.tsx:33-37); the frame's revision tick re-reads every fold |

## The /settings bus rows landing here (census/settings.md C3/C4)

| # | source (dying route) | capability | landing |
|---|---|---|---|
| set-C3 | SettingsRoute.tsx:94-99,151-180 · bus.ts:41-79 | bus summary (channels · commits) + newest-first rows with seq/channel/route/label | **R+S** — `session bus` roster row streams the whole bus (logs/store.ts:122-137; `#seq` time cell, channel chip, route+label text, note markers kept); the per-channel summary IS the dashboard band (commits, sessions, open count, activity spark — real numbers from busChannels). bus.ts imported UNCHANGED — no second fold |
| set-C4 | SettingsRoute.tsx:101,155-166 · bus.ts:81 | channel chips filter; `all` clears; channel tones | **R+L** — one roster row per live channel + CHANNEL ⇄ ALL lens (logs/panel.ts:22-28); channel tones via the shared hash (editors/workbench/tone.ts — SettingsRoute.tsx:52-58's toneFor, extracted once for stream stripes, chips, and the settings rig) |

## New capability (the W3 wireframe's user-approved additions)

| what | wire |
|---|---|
| dashboard band | LogStream.tsx StatBand — one card per feed, REAL numbers + 12-bin activity sparkline (logs/store.ts sparkBuckets; churn buckets by line stamp, channels by global seq). LAW 3: idle width spent demonstratively |
| select/copy | rows toggle selection on click (multi-select); the SelBar appears with the selection (count · Copy · Clear · copied-✓ feedback) and COPY puts the rows on the real system clipboard via the runtime clipboard door (`@reactjit/hooks/clipboard` set → `__clipboard_set`; LogStream.tsx:21,48). Wireframe wire: cart/hmsc-wire/index.tsx:695-719,748-761 |
| feed properties panel | the W3 panel law (panel = what the feed IS, stats = display in the band): churn → source/file/state; bus rows → source/routes/store status (logs/panel.ts:49-97) |

## Notes / deviations (none dropped — the fold contract)

- **churn.ts is a verbatim carry of LogView.tsx:19-50** (tagOf, TAG_COLOR,
  KEY_TAGS/isKeyLine, lineColor): the /log route is FROZEN until its flip, so
  the classification could not be exported from the dying file. Two copies
  exist until the flip deletes LogView.tsx; at that point churn.ts is the
  only one. The P4 suite pins the rules so drift breaks loudly.
- **No cross-family merged ALL.** The churn ring orders by perf-ms stamps,
  the bus by the V20 global seq — incomparable clocks. ALL widens within a
  family (churn → every line; a channel row → the whole bus); the wireframe's
  fake unified clock was display fiction and is not reproduced.
- **Selection keys ride the tail.** On a live-flushing churn feed, appended
  lines shift the tail and a standing selection may drift; selection is
  transient view state (cleared on feed/lens switch, the wireframe's rule —
  LogStream.tsx:36). Bus selections key by global seq and are stable.
- The P4 suite: `logs/logs.test.ts` (9 tests) — classification parity, KEY/ALL
  lens semantics, pause/clear verbs, roster shape, bus ordering/filtering,
  lens tables, dashboard stats, copy text, the down-store path. Headless per
  the characters.test.ts bundling law (store.ts/panel.ts/churn.ts only).
