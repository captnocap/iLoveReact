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
  "resolvedAt": "2026-06-06T05:00:00.000Z",
  "resolution": "<a real paragraph: what was done, why, what changed>",
  "shas": ["b6fd34eb9"]
}
```

`origin` is which pane/lane took the ask, or `supervisor-relay`. `shas` is
the list of commits implementing the resolution (`[]` for a no-code
resolution, e.g. a question answered). The resolution paragraph has a
minimum bar (`MIN_RESOLUTION_CHARS`, 120 chars) — a commit-message one-liner
does not close a request.

Per-entry files (rather than one shared file) keep parallel worker sessions
from clobbering each other's appends and give clean one-entry git diffs.

## The CLI

```
tools/request log "<the user's words, VERBATIM>" --origin <pane|lane|supervisor-relay>
tools/request resolve <id> --para "<paragraph>" --shas <sha,sha|none>
echo "<paragraph>" | tools/request resolve <id> --shas <sha,...>
tools/request list [--open]
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
