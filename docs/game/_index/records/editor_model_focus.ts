import type { DocIndex } from '../types';

export const editor_model_focus: DocIndex = {
  name: 'editor_model_focus',
  file: 'editor_model_focus.md',
  cart: 'cart/editor/inspector/Inspector.tsx',
  purpose: ['ui', 'geometry', 'ai_edit'],
  summary:
    'Section G’s model pane rebuilt to the Model Focus Handoff (req_4392): identity header, SELECTION, SHAPE, SEMANTICS, PART, the one flexing merged OUTLINER, VIEWS. THE BOX IS THE AFFORDANCE — writable values (pivot, bounds center/radius, part position/rotation/scale) are click-to-edit, drag-to-scrub boxed cells committing ONE host-journaled exact transform through ModelFocusBridge.transformScope; derived facts stay plain text; empty sections collapse to a single header line. The outliner nests face regions, edge paths, and the hinge/mount/contact rig lane under their owning parts by EXACT joins (percept group spans + edge objectId), with an unattributed bucket instead of guesses.',
  interfaces: [
    {
      name: 'EditCell (NumberCell / TripleCells / AssignCell / ResetCol / CellRow)',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/editor/inspector/EditCell.tsx',
      description:
        'The boxed-cell edit primitive: click → in-place input (Enter commits, Esc cancels, blur commits); a ≥3px horizontal drag scrubs the numeric value and commits once on mouse-up so the host journal records one op. Overridden values read theme:text, defaults gold theme:valNum; the 18px ↺ reset column is ALWAYS reserved, dim (#3a4a58) at default. AssignCell is the dashed "assign…" enum cell for unassigned semantics.',
      consumers: ['cart/editor/inspector/ModelFocusSections.tsx'],
      status: 'live',
    },
    {
      name: 'ModelFocusBridge.transformScope',
      purpose: ['geometry', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'cart/editor/stage/ModelView.tsx',
      description:
        'One exact, host-journaled numeric transform over a scope. "model"/{lo,hi} select through __mesh_select_query (kind:all / kind:part — the Seat’s selector), refuse a scope-clipped selection (actionable < matched) instead of half-transforming, and pivot on the receipt bbox; "selection" applies to the live selection with its snapshot pivot. Ops: __mesh_transform_translate / _rotate_axis / _scale_axis / __mesh_gizmo_scale_by — all journaled, so Ctrl+Z rewinds a cell edit like a gizmo drag.',
      consumes: ['__mesh_select_query', '__mesh_transform_translate', '__mesh_transform_rotate_axis', '__mesh_transform_scale_axis', '__mesh_gizmo_scale_by'],
      consumers: ['cart/editor/inspector/ModelFocusSections.tsx'],
      status: 'live',
    },
    {
      name: 'PartSection session-transform ledger (editor.part-xform.v1)',
      purpose: ['ui', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/editor/inspector/ModelFocusSections.tsx',
      description:
        'Geometry bakes transforms — no retained per-part matrix exists — so PART position/rotation/scale surface the SESSION-APPLIED offsets in a hot twig keyed model:part. Commits apply deltas over the part’s authored range; ↺ unwinds the lane (reverse axis order for rotations — exact single-axis, approximate stacked). Host undo rewinds geometry but not the ledger: it is "what the panel applied", never a second source of geometric truth. In-process twig — cold restarts reset it by design.',
      dependsOn: ['ModelFocusBridge.transformScope', 'runtime/hooks/useHotState'],
      status: 'live',
    },
    {
      name: 'outlinerFocusTree (the merged-outliner join)',
      purpose: ['ui', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/editor/data/outlinerFocusTree.ts',
      description:
        'Pure join (own suite: outlinerFocusTree.test.ts) between the part table and the focus bridge’s semantic rows. A face region attaches to the part whose authored-group range CONTAINS its percept group span; an edge path joins by objectId (minted from modelActivePartId at naming time); hinge/mount/contact roles land in the rig lane. Rows without one exact owner go to a visible unattributed bucket — never a guess. Also renders the counts summaries ("2 rgn · 1 edg · 1 rig") and header totals.',
      consumers: ['cart/editor/stage/ModelOutliner.tsx'],
      status: 'live',
    },
    {
      name: '__mesh_semantic_state groups field',
      purpose: ['geometry', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/gpu/scene3d/edit_semantics.zig',
      codeRef: 'framework/gpu/scene3d/edit_semantics.zig meshSemanticStateJson',
      description:
        'The resident percept’s per-region row gained "groups":[lo,hi) — the authored-group span of the region’s faces, aggregated in the same loop that already tracked bbox. Threaded to the cart as ModelFocusFaceSemanticRow.groupSpan (null on pre-field hosts / non-resident rows). This is the capability that makes region→part attribution exact instead of guessed.',
      consumers: ['cart/editor/model/modelSemanticsFocus.ts', 'cart/editor/data/outlinerFocusTree.ts'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'empty section collapses to its header line',
      purpose: ['ui'],
      description:
        'A focus-panel section with nothing to say (SELECTION none, VIEWS none) renders ONLY its header row — dim accent, inline "none" — and never reserves body space. The affordance verb (+ pin, badge) stays on the header.',
      examples: ['editor_model_focus'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'part-transform ledger is not geometric truth',
      purpose: ['geometry', 'ui'],
      description:
        'Host undo rewinds the mesh but NOT the editor.part-xform.v1 twig, so after Ctrl+Z the PART rows can show an offset the geometry no longer carries. The ledger is a session readout of what the panel applied; treat divergence after undo as expected, not as data loss.',
      evidence: ['cart/editor/inspector/ModelFocusSections.tsx PartSection'],
      severity: 'medium',
    },
    {
      name: 'region groupSpan is resident-only and host-gated',
      purpose: ['geometry'],
      description:
        'groupSpan comes from the live percept: saved-only/mount-only rows and hosts predating the groups field yield null, which the outliner renders as the unattributed bucket. A rebuilt dev host is required before regions nest under parts.',
      evidence: ['framework/gpu/scene3d/edit_semantics.zig', 'cart/editor/data/outlinerFocusTree.ts'],
      severity: 'low',
    },
  ],
};
