# REQPANEL-0606 CAPTURE — the request-ledger interface's parity table

USER ASK, verbatim: "for the request method we have been doing where its
recorded, we should get someone to make a simple interface for us from the
data. just so i can see what is left unresolved and can click it was resolved
or not".

Sources audited: `docs/game/_index/requests.ts` (the ledger module — every
line read), `docs/game/_index/requestCli.ts` (tools/request),
`docs/game/REQUESTS.md`, `docs/game/_requests/_config.json`.

New files: `editors/workbench/requests/{store.ts,panel.ts,live.ts,RequestList.tsx,source.tsx,requests.test.ts}`.
Additive edit: `editors/workbench/sources.ts` (registration). The ledger
module itself is **byte-untouched** — its own suite stays 12/12.

## The ask, point by point

| spec | where it lives |
|---|---|
| a simple interface from the data — list every request: id, date, origin, the verbatim ask, status | **S** — column 4 is the list (RequestList.tsx): newest first, status stripe (amber open / green resolved), id, `YYYY-MM-DD HH:MM`, status chip, the ask's first line; clicking a row selects it and its FULL VERBATIM text reads in the detail band (RequestList.tsx:63) with the resolution paragraph when one exists. **P** carries id/asked/origin/status fields for the selected ask |
| see what is LEFT unresolved — unresolved on top / the default view | **R** — roster = four views with live counts, `unresolved · N` first and default (store.ts:29 REQUESTS_VIEWS, source.tsx defaultRow); empty state says "nothing left unresolved — the ledger is clean" |
| click it was resolved | **P+A** — `✓ mark resolved` (panel.ts:48 act + the hero verb, panel.ts:61) → store.markResolvedByUser (store.ts:106) |
| …or not (unresolve) | the ledger says resolution is ONE-WAY (requests.ts:237-242: "entries are never rewritten; log a new request instead" — resolveRequest throws on a resolved id). Per dispatch, the interface SURFACES this instead of inventing a parallel store: resolved entries show `unresolve: one-way (by-addition law) — log a new request instead` (panel.ts:55), no act, no hero verb; the suite pins the second click throwing |

## ONE SOURCE OF TRUTH (the non-negotiable)

- The store's deps ARE `docs/game/_index/requests.ts` — `loadRequests` /
  `resolveRequest` over `defaultRequestsDir()` (live.ts), the SAME module
  `tools/request` bundles (requestCli.ts). No parallel status store exists:
  a click writes the entry's own JSON through the ledger's one field-fill.
- The user-click resolution is a REAL paragraph clearing the ledger's own
  `MIN_RESOLUTION_CHARS` bar (store.ts:38 USER_CLICK_RESOLUTION — "Resolved
  by the user via the workbench request panel…"), shas `[]` (the CLI's
  `--shas none` semantics).
- Dispatch hiding mirrors `list --open` exactly: `origin ===
  DISPATCH_ORIGIN` is filtered from unresolved/resolved/all and lives behind
  its own `dispatches` view (store.ts:70 inView — the same exemption
  requests.ts:160-165 documents).
- The cart host has the module's `__fs_*` doors already (the V20 data layer
  flips `has-fs` for hmsc-int); `defaultRequestsDir()` resolves from
  RJIT_ROOT/cwd — the dev host runs at repo root.

## Three chrome laws

- LAW 1: the resolve click is a gutter-3 act (+ hero verb); the stage's only
  input is row SELECTION (RequestList.tsx:43, click again deselects — the
  WBCHAR C3 precedent). The detail band is display.
- LAW 2: no lenses claimed; the views are roster rows (subjects), nothing
  property-shaped in the preview bar.
- LAW 3: the list reads at terminal size, full-bleed; the verbatim ask gets
  the detail band. Deliberately NO dashboard band — the dispatch's "no
  dashboard ambitions" overrides the idle-width habit; counts live in the
  roster labels.

## Notes

- The P4 suite (`requests.test.ts`, 7 tests) runs the store against the REAL
  ledger module on a temp dir: default-view filtering + dispatch hiding, the
  click flipping the JSON on disk (read back through the same module),
  one-way refusal + its surfacing, panel/hero act lifecycle, live roster
  counts, row fold + selection toggle, broken-ledger surfacing. The ledger's
  own suite (docs/game/_index/requests.test.ts) stays 12/12 — untouched.
- Resolving a DISPATCH by hand from its view is possible (the ledger allows
  it; the act shows on any open entry) — markers still track those; the
  default views never show them either way.
- No new persistence, no stream, no tunables: the ledger files are the
  state; the only view state (selection) is ephemeral in-store.
