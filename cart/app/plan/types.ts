// Plan data model — the structured form is canonical, prose is rendered
// from it. See docs/03-sequencer-plan-trace.md ("structured form is
// canonical; the prose is rendered from it").
//
// A Plan owns Intent (what we're trying to do) + Phases (how it breaks
// down). Phases are what the sequencer eventually arms as columns; each
// Cell is what the sequencer arms within a column. Cells reference
// either a useIFTTT spec (reactive substrate) or a Composition id
// (declarative substrate); see docs/02-canvas-and-substrates.md.
//
// Every structural node has an `id` so comments can pin to it. The id
// is the @target the user clicks. When the planning worker rewrites a
// node it preserves its id (or sets `revisedFrom` on a fresh id).

export type CellKind = 'reactive' | 'declarative';

export interface Cell {
  id: string;
  kind: CellKind;
  /** Human-readable label that shows in the rendered plan. */
  label: string;
  /**
   * For reactive cells: an IFTTT spec string compatible with
   * runtime/hooks/useIFTTT (e.g. 'timer:every:5000', 'key:ctrl+s').
   * For declarative cells: a Composition id from the gallery's
   * composition table. Free-form for now; tightened to the canvas
   * vocabulary at stamp time.
   */
  spec: string;
  /** Optional one-line note under the cell. */
  note?: string;
  revisedFrom?: string;
}

export interface Modifier {
  id: string;
  label: string;
  detail?: string;
  revisedFrom?: string;
}

export interface Phase {
  id: string;
  label: string;
  /** Why this phase exists. One sentence. */
  rationale?: string;
  cells: Cell[];
  modifiers: Modifier[];
  /** What makes this phase done. */
  exit?: string;
  revisedFrom?: string;
}

export interface Intent {
  /** One-sentence what-are-we-doing. */
  objective: string;
  /** Don'ts, scopes, budgets. */
  constraints: string[];
  /** What makes the whole run done. */
  exitCriteria: string[];
}

export interface Plan {
  id: string;
  name: string;
  intent: Intent;
  phases: Phase[];
}

export type CommentStatus = 'queued' | 'sent' | 'addressed';

export interface Comment {
  id: string;
  /**
   * Structural ref. Examples:
   *   'intent.objective'
   *   'intent.constraints[2]'
   *   'intent.exitCriteria[0]'
   *   'phase:<phaseId>'
   *   'phase:<phaseId>.rationale'
   *   'phase:<phaseId>.exit'
   *   'cell:<cellId>'
   *   'modifier:<modifierId>'
   */
  ref: string;
  /** Short human label of what was clicked, for the comment chip. */
  refLabel: string;
  body: string;
  status: CommentStatus;
  createdAt: number;
}

export interface PlanRev {
  /** Stable across revs of the same plan. */
  planId: string;
  /** Monotonic. */
  rev: number;
  /** Previous rev number, if any. */
  parentRev?: number;
  plan: Plan;
  /** Comments that produced this rev (set on N>0). */
  appliedComments?: Comment[];
  createdAt: number;
}

export interface PlanFile {
  planId: string;
  name: string;
  /** Most-recent-first. revs[0] is the head. */
  revs: PlanRev[];
}
