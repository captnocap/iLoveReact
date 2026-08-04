import type { DocIndex } from '../types';

export const editor_mesh_integrity: DocIndex = {
  name: 'editor_mesh_integrity',
  file: 'editor_mesh_integrity.md',
  cart: 'cart/editor/stage/ModelView.tsx',
  purpose: ['persistence', 'host_bridge', 'geometry', 'ui'],
  summary:
    'req_3484 + req_3507/3511–3513 + req_3763 + req_3771: every topology transaction gets a commit-time part-ledger roll call; Tris to Quads scans the whole model into a reversible live dry run before one confirmed journal transaction; the outliner ROW table reconciles against host range truth instead of latching on a count mismatch (the police_sedan corruption class) — restore from the host-restored journal note, else rebuild rows from geometry + semantic regions, always loud; and Merge Faces actually dissolves dropped seam/interior verts on convex fusions instead of leaving them in the soup as cornerless dots.',
  interfaces: [
    {
      name: 'reconcilePartRows / __editor_reconcile_parts',
      purpose: ['persistence', 'ui'],
      kind: 'module',
      sourceFile: 'cart/editor/shell/AppFrame.tsx',
      description:
        'req_3763 P0-1/P0-2. __modelPartRangesChanged used to drop the re-stamp whenever native part count != outliner row count — a permanent latch, since the blocked re-stamp was the only re-convergence path; any native-door undo across a structural boundary (the Agent Seat undo calls __mesh_undo directly, bypassing the shell note-restore) armed it. Now a mismatch defers ~280ms (a structural op’s own handler gets its beat to land the row) then reconciles loudly: adopt the journal note the host restored with the geometry (__mesh_journal_note() read-back — row identity survives undo/redo on every path), else rebuild rows from geometry (follow-patch sweep tallies each range’s dominant semantic region; part:rebuild:* rows named from it). meshUndoRedo refuses to apply a note whose count disagrees with host ranges. Regression: tools/part-sync-parity (shellparts/shelladd/shelldetach/reconcile/partsdump harness ops; scenarios A1–A6 + B + C).',
      consumers: ['cart/editor/stage/ModelView.tsx', 'cart/editor/agent/seatApi.ts'],
      status: 'live',
    },
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
    {
      name: 'meshMergeSelectedFaces / __mesh_topo_merge_faces',
      purpose: ['geometry', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/gpu/3d.zig',
      description:
        'req_3771 dual commit. Fuses a coplanar face selection into one authored face. When the fused boundary keeps every corner the recorded resident rows reference, the commit is group-only and byte-stable (commitIndexedFaceGrouping — winding/UVs/atlas/parts untouched). When the clean boundary DROPS corners (the inverse of a loop cut: collinear seam verts, interior grid verts) and the loop is CONVEX, indexed_edit_mesh.mergeFaceIds invalidates the source tessellation and the op commits through the Loop Cut lower()+lcInstallLowered path, so the dead verts actually leave the resident soup instead of lingering as selectable dots no authored edge runs through. Concave fusions always stay byte-stable — re-fanning a concave perimeter reverses render triangles (bookshelf corruption, unit-pinned). Verts still referenced by neighbouring faces survive until those merge/weld too. Headless proof: cube → ring cut → merge top halves (20→18 tris) → merge right halves (16 tris, 12→11 welded verts); undo/redo atomic.',
      dependsOn: ['meshIntegrityRollCall'],
      consumers: ['cart/editor/stage/ModelView.tsx', 'cart/editor/agent/seatApi.ts'],
      status: 'live',
    },
    {
      name: 'meshQuadifyBegin / meshQuadifyPreview / meshQuadifyEnd',
      purpose: ['geometry', 'host_bridge', 'ui'],
      kind: 'host_fn',
      sourceFile: 'framework/gpu/3d.zig',
      description:
        'req_3507/3511–3513 whole-topology recovery. Begin captures indexed topology, groups, selection, alpha masks, paint-stale state, and an uncommitted journal snapshot. Preview rebuilds from that base, finds every compatible one-triangle pair (one manifold edge, same part/material/alpha, plane/winding, durable four-corner boundary; concave is legal like two-face Merge Faces), then uses Edmonds blossom to produce an exact maximum-cardinality matching. Balanced, Short seams, and Alternate flow reorder candidates to expose different maxima without reducing the count. The live group-only preview hides proposed diagonals while reporting full dry-run stats/signature. End(false) restores the exact base with no history; End(true) commits the chosen result as ONE “tris to quads” entry without rebuilding/reordering resident triangles. Torso_Female003 proof: 1,156 candidates, 292 ambiguous triangles, 925 quads, 6,783→5,858 authored faces; three distinct plans; cancel 0/0 history; apply/undo/redo atomic.',
      dependsOn: ['meshIntegrityRollCall'],
      consumers: ['cart/editor/stage/ModelView.tsx', 'cart/editor/shell/AppFrame.tsx'],
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
        'ActionKind and NATIVE_MESH_ACTIONS are one append-only ordinal contract (integrity_alert = 26; tris_to_quads = 27). Inserting or reordering either side silently re-labels every native event the cart decodes. Add new kinds at the END of both tables and extend the .test.ts pin in the same commit.',
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
