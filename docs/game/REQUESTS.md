# REQUESTS.md — the Request Board (REQLEDGER-0606 → REQBOARD-0607 → REQSCOPE-0705)

User asks become durable, oracle-served, resolution-accountable JOBS moving
across a four-state board: **new → doing → review → done**.

## Why

git captures commits, not prompts. The user's asks — typed into any worker
pane, or relayed by the supervisor — historically got lost or half-resolved
with no trace. The ledger is the permanent ask→resolution record: the ask
verbatim, who received it, what was done about it, and the commit SHAs that
implement it (the bridge back to git). It is queryable through `tools/oracle`
like everything else in this knowledge layer.

In the user's words (the ask that created the ledger):

> maybe there is a way we can make a script that ties into the oracle where
> whenever i send a request to either you or a worker when ur not up, they
> place the request into a formatted and organized set that they come back to
> and have to write the resolution to the request as a paragraph, we can use
> that as a means to follow much better since git doesnt capture what my
> prompt is.

And the board ruling (REQBOARD-0607), verbatim anchors:

> so there are 4 states 1 new 2 in process 3 review 4 done

> no longer takes every single message of mine and makes a request, since a
> number of them are me just sending perf logs for bug hunting

## The board

| state    | meaning | who moves it there |
|----------|---------|--------------------|
| `new`    | intake — a marked job or a logged/relayed ask | the hook, `log`, or a review→new bounce |
| `doing`  | claimed, in process | a worker (`move <id> doing --by <you>`) |
| `review` | work finished, awaiting the user's word | the worker, WITH paragraph + SHAs |
| `done`   | accepted (or supervisor noise-closed from new) | the USER only — terminal |

**Legal transitions** — everything else is rejected, with the legal moves
named in the error:

- `new → doing` — a worker claims the job. Any actor.
- `doing → review` — REQUIRES the resolution paragraph
  (≥ `MIN_RESOLUTION_CHARS`, 120 chars) **and** `--shas` (commits, or `none`
  for a no-code resolution). The old resolve discipline lives at this edge.
  `resolution`/`shas`/`resolvedAt` fill here **exactly once, never
  rewritten** — a re-review after a bounce carries its fresh paragraph on the
  transition event instead.
- `review → done` — acceptance. **ONLY actor `user`** — the supervisor relays
  the user's word as `--by user`. A worker (or the supervisor acting alone)
  can never flip this.
- `review → new` — bounce back for rework; `--note` required.
- `new → done` — supervisor-only noise-close for triage; `--note` required.
  NEVER available from `doing` or `review`.
- `done` is **terminal**. No moves out, ever.

## The shape

One JSON file per entry: `docs/game/_requests/req_<seq>.json` — git-tracked,
the V20 by-addition discipline applied to process:

- the SET is append-only — entries are only ever added, never deleted;
- an entry's ask is **never rewritten**; history is **never rewritten** —
  every transition and note APPENDS to the entry's `events` array;
- `text` is the user's words **BYTE-VERBATIM** — never paraphrased, never
  trimmed, never "cleaned up" (job markers stay in). The user's words ARE
  the record;
- legacy two-state files (`"open"`/`"resolved"`) stay readable forever —
  the loader normalizes on read (`open`→`new`, `resolved`→`done`).

```json
{
  "id": "req_0007",
  "at": "2026-06-07T04:00:00.000Z",
  "origin": "session:abc12345",
  "text": "JOB: <the user's words, verbatim, marker included>",
  "status": "review",
  "sessionId": "abc12345-6789-...",
  "captureMode": "hook",
  "events": [
    { "at": "...", "actor": "worker-3", "kind": "state", "from": "new", "to": "doing" },
    { "at": "...", "actor": "worker-3", "kind": "note", "text": "the collider was the culprit" },
    { "at": "...", "actor": "worker-3", "kind": "state", "from": "doing", "to": "review" }
  ],
  "resolvedAt": "2026-06-07T05:00:00.000Z",
  "resolution": "<a real paragraph: what was done, why, what changed>",
  "shas": ["b6fd34eb9"]
}
```

`origin` is which pane/lane took the ask, `supervisor-relay`, or
`session:<id8>` / `codex:<id8>` for hook captures. `sessionId` is the Claude
session that received the ask — the report key. `events` is the append-only
history (absent on pre-board entries; migration invents none). `shas` is the
list of commits implementing the resolution (`[]` for a no-code resolution).

Per-entry files (rather than one shared file) keep parallel worker sessions
from clobbering each other's appends and give clean one-entry git diffs.

## The CLI

```
tools/request board [--since <ISO>] [--all] [--tag <tag>]
tools/request log "<the user's words, VERBATIM>" --origin <pane|lane|supervisor-relay> [--session <id>]
tools/request move <id> <new|doing|review|done> --by <actor> [--para "<paragraph>"] [--shas <sha,sha|none>] [--note "<why>"]
tools/request note <id> --by <actor> "<text>"
tools/request tag <id> <tag,tag,...>      # the SECRETARY door (union; organization only)
tools/request tags                        # every tag in use, with counts
tools/request resolve <id> --para "<paragraph>" --shas <sha,sha|none>   # ALIAS for `move <id> review`
tools/request list [--open] [--session <id>] [--tag <tag>]
tools/request show <id>
tools/request oneoff <id> --by <actor>    # REQSCOPE-0705: unrelated ask → off the board, record kept
tools/request migrate-board
```

- **`board`** is the supervisor's loop tool: the four columns with counts and
  compact rows (id, age, origin, first 80 chars of the ask; `done` shows its
  recent tail). **Off-board-exempt by default**: supervisor dispatches and
  one-offs are records, not jobs — they never appear in any column (the
  columns agree with the true open-asks set, exactly the old `list --open`
  filter); `--all` is the only door to them. `--since <ISO>` appends an
  ACTIVITY section — every event after that timestamp (id, transition/note,
  actor) — so a supervisor pass reads exactly what moved since the last pass.
- **`resolve` is REDEFINED**: it is now an alias for `move <id> review`. The
  workers' existing habit lands work in **review, not done** — only the user
  flips review→done. `resolve` on an unclaimed (`new`) entry is rejected:
  claim first.
- **`migrate-board`** is the one-shot legacy rewrite (`open`→`new`,
  `resolved`→`done`), idempotent, status field only. Run once at adoption;
  reading legacy files works either way.

`list --open` shows everything not yet `done`. Source:
`docs/game/_index/requestCli.ts` (arg parsing/printing) over
`docs/game/_index/requests.ts` (storage + the transition function,
decisions.ts's sibling). Runs under `tools/v8cli`, bundle auto-rebuilds,
no node.

## The oracle

`tools/oracle "<query>"` matches request entries (verbatim text +
resolutions) and returns them as the REQUEST LEDGER tier, between RULINGS
and INDEX RECORDS, with board status + SHAs. The ledger is read from disk at
query time (the tools wrappers export `RJIT_ROOT`), so a fresh `log` is
servable immediately — no rebundle.

## Capture: blanket (the hook layer)

**Capture changes NOTHING** (REQSEC-0607 — the user's words: "we keep the
hook on all the same, nothing changes, we just have a secretary"). Every
substantive prompt is captured verbatim, landing in `new`; only the original
noise rule skips: trivial acks (`ackPattern`), prompts under
`minPromptChars` (default 40), and slash/`!`/`#` commands. The marker-only
capture REQBOARD-0607 briefly introduced is REMOVED — organization is the
secretary's job, not the capture gate's. Prompts starting with a
`dispatchPrefixes` entry (default `["SUPERVISOR"]`) capture with origin
`supervisor-dispatch` — exempt from the board flow and the stop nudge (their
XYZ-NNNN markers already track resolution), hidden from `list --open` and
the board unless `--all`. Manual `tools/request log` remains for relays and
hook-less contexts.

Repo-level `.claude/settings.json` registers the two hooks (Codex parity via
`.codex/hooks.json`, same payload shape, `--cli codex` only changes the
origin label — see HOOKJSON-0606 in the git history for the JSON-emission
contract both CLIs share):

- **UserPromptSubmit** → `tools/request-hook-prompt` → `request hook-prompt`:
  blanket capture of the LITERAL prompt. On capture, the req id lands in
  front of the worker as added context. Never exits 2 (that would block and
  erase the user's prompt); skips are silent.
- **Stop** → `tools/request-hook-stop` → `request hook-stop`: scans ONLY the
  entries this session holds in **`doing`** — claimed-but-not-reviewed is the
  only debt a worker owns — and nudges once per turn cycle
  (`stop_hook_active` guards loops) to move them to review.

Config is P2 data in `docs/game/_requests/_config.json`: `minPromptChars`,
`ackPattern`, `stopReminder` (`block-once` | `context` | `off`),
`dispatchPrefixes`. Mis-captured dispatches amend with
`tools/request mark-dispatch <id>` — a field-fill on origin only.

## The SCOPE GATE: one-offs (REQSCOPE-0705)

The user's ask, verbatim:

> hey the current hook system effectively treats all requests between both
> claude and codex as game-based requests, which, for the last month or more
> has been correct, but there has been intermittent requests that are totally
> unrelated, so im wondering if we can change the system where the hook would
> prompt that if it is related to the editor/game building that then the
> request can be picked up and forwarded into the pile otherwise to drop it
> off as one offs/unrelated

Mechanism — **capture stays blanket; the SESSION judges scope**. The hook
can't tell a game ask from a resume-formatting favor, but the model receiving
the prompt can. So the capture context line now carries the scope gate:

- **Related to the editor/game building** (the game, its editors, carts,
  framework) → claim it into the pile as ever (`move <id> doing`), board flow
  unchanged — and the same line enforces the ORACLE for both CLIs
  (V32 SURFACE-0705): consult `tools/oracle "<topic>"` before deciding an
  approach; its output opens with the ACTIVE SURFACE banner (going-forward
  work is `cart/editor/`; hmsc-era pointers are flagged as reference).
- **Unrelated / a one-off** → `tools/request oneoff <id> --by <you>` and just
  answer it. The entry's origin flips to `one-off` (a field-fill; the ask
  text and history are untouched, plus one appended note event naming who
  made the call). Same exemption fold as supervisor dispatches: off the
  board, off `list --open`, off the stop nudge — but the record stays
  durable and oracle-served. Already-one-off is a no-op; `done` entries
  can't be amended. The workbench shows them behind their own `one-offs`
  view (no board verbs — records, not jobs).

## The SECRETARY: tags (REQSEC-0607)

The user's ask, verbatim:

> we can use the useAssistant hook and hit a model who can evaluate and
> categorize and all that jazz. since the mix of them is a shit show.
> something like tags or whatever, that way can search by tag or etc. and if
> model doesnt know they dont do nada. but would keep it far more organized
> and can do it for free effectively and that way, we keep the hook on all
> the same, nothing changes, we just have a secretary

Mechanism:

- **Tags are organization ONLY.** `tags?: string[]` on the record; persisted
  ONLY through `tagRequest` (the same store door as everything else —
  append-only union, tags are added never removed, junk dropped silently).
  States, the resolve discipline, and the user-only done gate are untouched
  by the secretary — `tagRequest` *cannot* move anything.
- **The model proposes.** The workbench requests surface runs untagged
  entries through the framework's existing `useAssistant` hook
  (`claude_code` subprocess — free under the Max subscription) in bounded
  batches, with a strict-JSON, omit-when-unsure contract. **Unsure → nada**:
  omitted/garbage replies leave entries byte-untouched, never an error.
  Seed vocabulary: `bug, perf-log, ask, ruling, ux, idea` — the model may
  extend it. Armed by a click (no model process spawns on tab open);
  **tagging never blocks or delays capture** (capture is the hook, a
  separate process entirely); model unavailable → everything works untagged.
- **Search by tag**: CLI `board --tag <t>` / `list --tag <t>` / `tags`;
  workbench rail grows a `#tag · n` chip per tag in use — selecting one is
  the search. Sources: `editors/workbench/requests/secretary.ts` (protocol)
  + `SecretaryBar.tsx` (the useAssistant wiring).

## The process (who does what)

**Worker contract:** claim (`move <id> doing --by <you>`) → work → 
`move <id> review --by <you> --para "<paragraph>" --shas <sha,...|none>` →
STOP. Cite the req id in the commit message (`USER ASK req_NNNN`). **done is
never yours to flip.**

**Supervisor:** watches `board --since <last pass>`, relays the user's
acceptance as `move <id> done --by user`, bounces with
`move <id> new --by supervisor --note "<why>"`, noise-closes intake mistakes
with `move <id> done --by supervisor --note "<why>"` (from `new` only).

**User:** the only source of acceptance. Their word, relayed by the
supervisor, is what `--by user` means.

The conduct rule lives in **CLAUDE.md → "User Asks: the Request Board"**
(one home; it is the doc auto-loaded into every worker pane). Backfill is
not required — historical `USER ASK` commits and pre-board entries stay as
they are.

## Maintenance contract

This doc + `docs/game/_index/records/request_ledger.ts` describe the feature;
touching the ledger code (`requests.ts`, `requestCli.ts`, `tools/request`,
the oracle tier) means updating both in the same commit. The P4 suite is
`docs/game/_index/requests.test.ts` (board transitions, legacy
normalization, marker capture, migrate idempotence, verbatim preservation,
oracle match), run by `rjit game verify`.
