import type { DocIndex } from '../types';

export const editor_mesh_integrity: DocIndex = {
  name: 'editor_mesh_integrity',
  file: 'editor_mesh_integrity.md',
  cart: 'cart/editor/stage/ModelView.tsx',
  purpose: ['persistence', 'host_bridge', 'ui'],
  summary:
    'req_3484: the commit roll call. Every accepted topology transaction proves the part-ledger invariants at journalCommit/journalStep, heals what it can prove (overlap renormalize, stale empty-range compaction over the full displayed+hidden partition), and reports every fault loudly — a terminal line naming the guilty op plus an integrity_alert action event the shell resyncs and surfaces on. Ends the bug-site-vs-crash-site gap behind three weeks of chain-of-events corruption patches.',
  interfaces: [
    {
      name: 'meshIntegrityRollCall',
      purpose: ['persistence'],
      kind: 'module',
      sourceFile: 'framework/gpu/3d.zig',
      description:
        'ARMED at journalCommit (every accepted topology op) and after a successful journalStep (undo/redo); RUNS at meshActionDrain under a TWO-STRIKE protocol — the first faulty pass is silent detect-only and re-checks next drain, because a gesture’s own bookkeeping can settle a beat after its commit (loop cut renormalizes post-commit; observed transient unowned=8/16 on healthy chains). A fault surviving both passes heals what is provable — ensureDisjointPartRanges for overlaps, compactOccupiedPartRanges for declarations owning no face — plus a geometric tripwire for exact same-winding duplicate faces (canonicalFaceBits; reversed twins and wire faces excluded), then logs [mesh-integrity] and enqueues an integrity_alert event with declared part counts around the heal. Never guesses ownership; never blocks the op; meshJournalClear disarms across document loads.',
      consumers: ['cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'integrity-alert action event',
      purpose: ['host_bridge', 'ui'],
      kind: 'host_fn',
      sourceFile: 'cart/editor/model/nativeMeshEvents.ts',
      description:
        'ActionKind ordinal 26 (model.mesh.integrity-alert) on the existing mesh action ring — append-only bridge contract, pinned by nativeMeshEvents.test.ts. AppFrame’s drain loop special-cases it: calls ModelToolApi.resyncFromHost() (re-adopt session key, adoptHostSelection, resyncPartRanges) and sets a visible ⚠ mesh-integrity status naming what was healed, then boards the editor bus like every native action.',
      dependsOn: ['meshIntegrityRollCall'],
      consumers: ['cart/editor/shell/AppFrame.tsx', 'cart/editor/stage/ModelView.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'prove invariants at commit, not at the next gate',
      purpose: ['persistence'],
      description:
        'The pre-existing guards (ownsExactPartPartition before append, range-stamp refusal, save refusal) detect ledger drift ops AFTER its cause and refuse silently. The roll call moves detection to the op that first breaks an invariant so every fault is named at its origin. Slices 2–3 of the req_3469–3484 thread (single commit epilogue; stable document handle so JS never adopts keys) build on this hook.',
      examples: ['editor_mesh_integrity'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'action-kind ordinal contract',
      severity: 'medium',
      purpose: ['host_bridge'],
      description:
        'ActionKind and NATIVE_MESH_ACTIONS are one append-only ordinal contract (integrity_alert = 26). Inserting or reordering either side silently re-labels every native event the cart decodes. Add new kinds at the END of both tables and extend the .test.ts pin in the same commit.',
      evidence: ['framework/gpu/mesh_journal_log.zig ActionKind', 'cart/editor/model/nativeMeshEvents.test.ts ordinal pins'],
    },
    {
      name: 'heal ladder is proof-only',
      severity: 'low',
      purpose: ['persistence'],
      description:
        'Compaction runs only when every face has exactly one owner, and the gather must include hidden-part groups or healing would delete hidden parts’ range declarations. Unowned/multiply-owned faces are reported intact by design — a heal that guesses launders corruption.',
      evidence: ['framework/gpu/3d.zig meshIntegrityRollCall', 'mesh_journal_log.compactOccupiedPartRanges doc comment'],
    },
  ],
};
