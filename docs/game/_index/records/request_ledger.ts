// request_ledger — extraction of docs/game/REQUESTS.md (REQLEDGER-0606).
// The ledger is knowledge-layer infrastructure, not a game cart: user asks
// as durable, oracle-served, resolution-accountable records.

import type { DocIndex } from '../types';

export const request_ledger: DocIndex = {
  name: 'request_ledger',
  file: 'REQUESTS.md',
  purpose: ['maintenance'],
  summary: 'The request ledger: every user ask logged verbatim (docs/game/_requests/req_<seq>.json, V20 by-addition), closed only by a real resolution paragraph + commit SHAs, served by tools/oracle as the REQUEST LEDGER tier.',
  interfaces: [
    {
      name: 'tools/request',
      purpose: ['maintenance'],
      kind: 'module',
      sourceFile: 'docs/game/_index/requestCli.ts',
      description: 'The ledger CLI: `log "<verbatim>" --origin <pane|lane|supervisor-relay>` → req id; `resolve <id> --para "<paragraph>" --shas <sha,...|none>` (paragraph also accepted on stdin); `list [--open]`; `show <id>`. Thin argv/printing layer over requests.ts; runs under tools/v8cli via the auto-rebundling tools/request wrapper.',
      dependsOn: ['RequestRecord'],
      consumers: ['every worker pane (conduct rule in CLAUDE.md)', 'supervisor relays'],
      status: 'live',
    },
    {
      name: 'RequestRecord',
      purpose: ['maintenance', 'persistence'],
      kind: 'data_model',
      sourceFile: 'docs/game/_index/requests.ts',
      description: 'One ledger entry: id (req_<seq>), at, origin, text (the user\'s words BYTE-VERBATIM), status open|resolved, then the one-time field-fill resolvedAt/resolution (≥120-char paragraph)/shas. Storage is one git-tracked JSON file per entry under docs/game/_requests/ — append-only set, entries never rewritten (V20 by-addition applied to process).',
      emits: ['docs/game/_requests/req_<seq>.json'],
      status: 'live',
    },
    {
      name: 'loadRequests/logRequest/resolveRequest',
      purpose: ['maintenance', 'persistence'],
      kind: 'utility',
      sourceFile: 'docs/game/_index/requests.ts',
      description: 'The storage surface (decisions.ts\'s sibling): explicit-dir functions (tests run on temp dirs; defaultRequestsDir() resolves RJIT_ROOT from the tools wrappers). Validation at the boundary: verbatim text required, origin required, resolution paragraph ≥ MIN_RESOLUTION_CHARS, SHAs 7–40 hex (or [] for no-code), double-resolution rejected.',
      consumers: ['tools/request', 'tools/oracle'],
      status: 'live',
    },
    {
      name: 'hook auto-capture (request hook-prompt / hook-stop)',
      purpose: ['maintenance'],
      kind: 'utility',
      sourceFile: 'docs/game/_index/requests.ts',
      codeRef: 'docs/game/_index/requests.ts (hookCapturePrompt, requestsForSession)',
      description: 'The addendum layer: .claude/settings.json registers tools/request-hook-prompt (UserPromptSubmit → log the LITERAL prompt with sessionId + captureMode hook; stdout puts the req id in session context) and tools/request-hook-stop (Stop → one {"decision":"block"} nudge per turn cycle listing the session\'s unresolved asks; stop_hook_active guards loops). CODEX PARITY (addendum 2): .codex/hooks.json registers tools/request-hook-{prompt,stop}-codex — thin adapters exec\'ing the SAME subcommands with --cli codex (origin codex:<id8>; Stop context-mode emits {"systemMessage"} because Codex Stop is JSON-only stdout). Codex skips the hooks until trusted via /hooks (per-hash trust + project .codex layer trust). The necessary-vs-noise rule is P2 data in docs/game/_requests/_config.json (minPromptChars, ackPattern, stopReminder block-once|context|off, dispatchPrefixes) — acks and slash/!/# commands are never logged; dispatchPrefixes-matched prompts (default SUPERVISOR) capture with origin supervisor-dispatch, exempt from the stop nudge + resolution requirement and hidden from list --open unless --all (mark-dispatch amends mis-captures by origin field-fill). Hook mode NEVER exits 2 (would block + erase the user\'s prompt).',
      dependsOn: ['RequestRecord', 'loadRequests/logRequest/resolveRequest'],
      emits: ['docs/game/_requests/req_<seq>.json'],
      consumers: ['every Claude session in this repo (.claude/settings.json hooks)', 'every trusted Codex session in this repo (.codex/hooks.json)'],
      status: 'live',
    },
    {
      name: 'oracle REQUEST LEDGER tier',
      purpose: ['maintenance'],
      kind: 'utility',
      sourceFile: 'docs/game/_index/oracle.ts',
      codeRef: 'docs/game/_index/oracle.ts (searchRequests)',
      description: 'tools/oracle\'s second tier, between RULINGS and INDEX RECORDS: ranks entries over verbatim text (weight 3) + resolution (1) + id/origin (1), prints status, ask, resolution slice, and commit SHAs. Ledger is read from disk at query time, so fresh logs serve immediately without a rebundle.',
      dependsOn: ['loadRequests/logRequest/resolveRequest'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'log-first ask handling',
      purpose: ['maintenance'],
      description: 'When a USER prompt arrives directly in a pane (or is relayed by the supervisor): FIRST `tools/request log` it verbatim; work is not done until `resolve` carries the paragraph + SHAs; the commit message cites the req id (the USER ASK marker convention gains an id). Un-logged asks historically get lost or half-resolved with no trace.',
      examples: ['CLAUDE.md "User Asks: the Request Ledger"'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'paraphrasing the ask corrupts the record',
      purpose: ['maintenance'],
      description: 'The `text` field is the user\'s words BYTE-VERBATIM — the whole point is that git does not capture prompts. Summarizing, trimming, or "cleaning up" the ask destroys the evidence the ledger exists to keep. Quote the shell argument; the CLI rejects multi-positional input rather than joining words.',
      evidence: ['docs/game/REQUESTS.md "The shape"', 'requests.test.ts verbatim suite'],
      severity: 'high',
    },
    {
      name: 'parallel id allocation race',
      purpose: ['maintenance'],
      description: 'Two workers logging in the same instant can both allocate the same req_<seq> and the second write wins. Per-entry files make the window tiny but not zero. If your freshly-logged entry is missing or shows someone else\'s text, log it again — never edit the other entry.',
      evidence: ['docs/game/_index/requests.ts nextId()'],
      severity: 'low',
    },
  ],
};
