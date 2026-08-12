# Phase 2 — Thesis

## The change

`framework/gpu/3d.zig` (23,041 lines) gets refactored in TWO strictly ordered phases,
per the user's sequence (req_4255/req_4259: "freeze → clone → helpers to remove
redundancy → same test results → freeze that → break into scoped parts"):

**Phase B (tonight, codex-executed): redundancy removal in place.** Same file, same
public surface, same behavior. Dead superseded code deleted; exact-duplicate blocks
become helpers; old-idiom ops migrate to the file's OWN modern idiom (jalloc +
defer-per-allocation + existing capture helpers). The frozen pre-B file stays on disk
as `framework/gpu/3d_frozen.zig.ref` (unimported ⇒ inert; the diff breadcrumb, per the
user's `_old` pattern).

**Phase C (later, planned against the post-B freeze): the chapter split.** The book
becomes volumes: `gpu/3d/` chapter files + `3d.zig` remaining as an explicit-re-export
façade (`usingnamespace` no longer exists in Zig 0.16 — 0 uses in framework and std),
so all 28 importers and both build roots stay untouched. Phase C is PLANNED tonight
only as an inventory artifact (symbol→chapter manifest); it does NOT execute tonight.

## Why this order

- The user's ruling: dedupe lands and re-freezes BEFORE any splitting.
- A 23k-line file cannot even fit in one codex context; dedupe shrinks and
  regularizes it so the C-manifest is cut against stable, idiom-consistent text.
- The comment-carry ruling (req_3830 closing exchange) makes the split a chaptering
  exercise; doing it after dedupe means rationale moves exactly once.

## Done standard — Phase B (tonight)

1. Every wave's verify.sh green + grade gates green: `SHIP_RUN_PACKAGE=0 rjit ship
   editor` builds; `zig build test-scene3d-mesh-drag`, `tools/mesh-port-parity`,
   `tools/part-sync-parity` match W0 baselines (known drift allowed ONLY where the
   baseline already carries it).
2. `pub fn` surface byte-identical to W0 except the W1 deletion list.
3. Zero remaining hand-rolled free-ladders in converted regions; every fn on a wave's
   OPS list either converted or SKIP-reported with a reason.
4. Comments preserved: rationale lines (req_ ids, rulings, trap notes) survive verbatim
   or move with their code. Net comment-line loss per wave ≈ 0 outside deleted fns.
5. Each wave = one commit citing req_4259; the whole run reversible per-wave via git.
6. Morning report in `reports/`: per-wave per-requirement PASS/FAIL scorecard, net
   line delta, skipped items, anything reverted.

## Explicit non-goals (tonight)

- NO behavior changes: `prepareRetopoBandInheritance` wiring (real missing hookup —
  user decides), `orbitFocus` removal (eclipsed seam — user decides), face-tint
  skeleton removal (hot-reload policy), journal transaction unification (audit: the
  43 snapshot sites differ on purpose), any hashKey/vector-helper consolidation
  (audit: different thresholds/algorithms encode real differences).
- NO Phase C execution, no new files beyond helpers the specs name, no reformatting,
  no comment "cleanup", no renames beyond the spec'd deletions.
- NO touching: resetForReload's mesh-session exemption, transparent-pipeline config,
  banner comments, `jalloc` definition.

Gate: thesis_names_target_shape_and_done_standard: **true**
