# REQUESTS.md — the Request Ledger (REQLEDGER-0606)

User asks become durable, oracle-served, resolution-accountable records.

## Why

git captures commits, not prompts. The user's asks — typed into any worker
pane, or relayed by the supervisor — historically got lost or half-resolved
with no trace. The ledger is the permanent ask→resolution record: the ask
verbatim, who received it, what was done about it, and the commit SHAs that
implement it (the bridge back to git). It is queryable through `tools/oracle`
like everything else in this knowledge layer.

In the user's words (the ask that created this):

> maybe there is a way we can make a script that ties into the oracle where
> whenever i send a request to either you or a worker when ur not up, they
> place the request into a formatted and organized set that they come back to
> and have to write the resolution to the request as a paragraph, we can use
> that as a means to follow much better since git doesnt capture what my
> prompt is.

## The shape

One JSON file per entry: `docs/game/_requests/req_<seq>.json` — git-tracked,
the V20 by-addition discipline applied to process:

- the SET is append-only — entries are only ever added, never deleted;
- an entry's ask is **never rewritten** — resolution is a one-time field-fill
  (status flips `open` → `resolved`, the empty resolution fields get filled);
- `text` is the user's words **BYTE-VERBATIM** — never paraphrased, never
  trimmed, never "cleaned up". The user's words ARE the record.

```json
{
  "id": "req_0007",
  "at": "2026-06-06T04:00:00.000Z",
  "origin": "supervisor-relay",
  "text": "<the user's words, verbatim>",
  "status": "resolved",
  "sessionId": "abc12345-6789-...",
  "captureMode": "hook",
  "resolvedAt": "2026-06-06T05:00:00.000Z",
  "resolution": "<a real paragraph: what was done, why, what changed>",
  "shas": ["b6fd34eb9"]
}
```

`origin` is which pane/lane took the ask, `supervisor-relay`, or
`session:<id8>` for hook captures. `sessionId` is the Claude session that
received the ask — the report key (`list --session <id>` groups a session's
asks). `captureMode` is `hook` (auto-captured) or `manual`. `shas` is
the list of commits implementing the resolution (`[]` for a no-code
resolution, e.g. a question answered). The resolution paragraph has a
minimum bar (`MIN_RESOLUTION_CHARS`, 120 chars) — a commit-message one-liner
does not close a request.

Per-entry files (rather than one shared file) keep parallel worker sessions
from clobbering each other's appends and give clean one-entry git diffs.

## The CLI

```
tools/request log "<the user's words, VERBATIM>" --origin <pane|lane|supervisor-relay> [--session <id>]
tools/request resolve <id> --para "<paragraph>" --shas <sha,sha|none>
echo "<paragraph>" | tools/request resolve <id> --shas <sha,...>
tools/request list [--open] [--session <id>]
tools/request show <id>
```

`list --open` is the standing debt list — it should be empty when no work is
in flight. Source: `docs/game/_index/requestCli.ts` (arg parsing/printing)
over `docs/game/_index/requests.ts` (storage + validation, decisions.ts's
sibling). Runs under `tools/v8cli`, bundle auto-rebuilds, no node.

## The oracle

`tools/oracle "<query>"` matches request entries (verbatim text +
resolutions) and returns them as the REQUEST LEDGER tier, between RULINGS
and INDEX RECORDS, with status + SHAs. The ledger is read from disk at query
time (the tools wrappers export `RJIT_ROOT`), so a fresh `log` is servable
immediately — no rebundle.

## Automatic capture (the hook layer)

The user's addendum, verbatim:

> we can use the claude hook system to see when i submit a prompt -> read the
> file -> capture my literal text -> use this to build the report with a
> session id, that the worker can comment on at the end of every turn cycle
> that is necessary.

Repo-level `.claude/settings.json` registers two hooks for every Claude
session in this cwd (merged with each machine's `settings.local.json`):

- **UserPromptSubmit** → `tools/request-hook-prompt` → `request hook-prompt`:
  reads the hook payload JSON from stdin and logs the LITERAL prompt with
  `sessionId` + `captureMode: "hook"` — zero paraphrasing, zero worker
  cooperation. On capture, the hook's stdout becomes session context, so the
  req id lands in front of the worker immediately. Never exits 2 (that would
  block and erase the user's prompt).
- **Stop** → `tools/request-hook-stop` → `request hook-stop`: when the
  session has unresolved captured asks, emits ONE `{"decision":"block"}`
  nudge listing them (`stop_hook_active` guards against loops — at most one
  nudge per turn cycle, never a hard block).

**The necessary-vs-noise rule** (which prompts get logged at all) is P2
tunable data in `docs/game/_requests/_config.json`, not a buried constant:

- `minPromptChars` (default 40) — shorter prompts are conversation, not asks;
- `ackPattern` — trivial acks ("ok do it", "yes", "lgtm…") are never logged
  (cleaner than logging + auto-closing them); slash/`!`/`#` commands are
  always skipped;
- `stopReminder` — `block-once` (default) | `context` (transcript-only) |
  `off`.

Manual `tools/request log` keeps working unchanged — relays and hook-less
contexts still need it (`--session <id>` attaches a session by hand).

**Codex panes are captured too** (addendum 2, USER ASK: "have them also make
it do the same thing with codex"). Codex's hook vocabulary mirrors Claude's —
`UserPromptSubmit` and `Stop` both exist, with the same `session_id`/`prompt`/
`stop_hook_active` payload fields — so the ledger write path is shared, not
reimplemented: `<repo>/.codex/hooks.json` registers
`tools/request-hook-prompt-codex` and `tools/request-hook-stop-codex`, thin
adapters that exec `request hook-prompt|hook-stop --cli codex`. The flag's two
effects: captures get origin `codex:<id8>` (vs `session:<id8>` for Claude),
and the Stop reminder's `context` mode emits `{"systemMessage": ...}` because
Codex Stop accepts JSON-only stdout (plain text is invalid there; `block-once`
is already JSON on both). Stop-nudge parity is full — Codex supports
`decision:block` continuation and the `stop_hook_active` loop guard.

Codex trust caveat: Codex requires non-managed hooks to be reviewed and
trusted per hook hash — run `/hooks` in a Codex pane once after this lands
(and re-trust if the hook files change); project-local hooks also need the
repo's `.codex/` layer trusted. Until trusted, Codex lists them but skips
execution.

Verification honesty: the hook payload path is tested by piping fabricated
UserPromptSubmit/Stop JSON through the real scripts (see requests.test.ts and
the REQLEDGER-0606 report); settings.json loads at session start, so the
live end-to-end fires for sessions opened after this lands — confirm by
typing any ≥40-char prompt in a fresh pane and seeing the
`[request-ledger] captured req_NNNN` context line.

## The process

The conduct rule lives in **CLAUDE.md → "User Asks: the Request Ledger"**
(one home; it is the doc auto-loaded into every worker pane): log the ask
FIRST, verbatim; work is not done until `resolve` carries the paragraph +
SHAs; cite the req id in the commit message (`USER ASK req_NNNN`).

Backfill is not required — the ledger starts at its introduction; historical
`USER ASK` commits stay as they are.

## Maintenance contract

This doc + `docs/game/_index/records/request_ledger.ts` describe the feature;
touching the ledger code (`requests.ts`, `requestCli.ts`, `tools/request`,
the oracle tier) means updating both in the same commit. The P4 suite is
`docs/game/_index/requests.test.ts` (log/resolve round-trip, verbatim
preservation, oracle match), run by `rjit game verify`.
