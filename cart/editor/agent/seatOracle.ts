// editor/agent/seatOracle.ts — the Agent Seat's phase-gate router.
//
// The disease this cures: the agent-seat and agent-skin skills were two monolithic
// documents, and a monolith fails twice. It costs full context on every task (a
// blockout job paid for the whole retopology corridor it would never enter), and it
// has nowhere for a process fix to LAND — improving agent behaviour meant editing a
// paragraph and hoping the next agent read it.
//
// So the docs became a corpus of phase slices, and this module routes them. A task
// gets classified into a PLAN (an ordered phase list); each phase serves three things
// — its doc slice, a checklist, and machine-checkable exit criteria. `advance` is a
// GATE, not a page-turn: it refuses with the exact failing checks, in the same voice
// `save` uses when it refuses unnamed faces. That is what makes a process fix stick —
// add a check to a phase and every agent hits it, because advance refuses.
//
// Two rules hold this together:
//   1. Phase state is mostly DERIVED. Almost every check is recomputed from the live
//      model, so a cold agent runs `oracle status` and gets real answers rather than a
//      remembered verdict. Only the task string and the phase cursor are stored.
//   2. A phase states its FORWARD OBLIGATIONS. The classic phased-doc failure is
//      teaching agents to defer debt to the phase that checks it — so the modelling
//      phases say "name every extrude NOW; naming only audits and refines".
//
// Pure by construction: doc text arrives through a reader function and model facts
// through a plain record, so the whole router is testable without a live editor.

import {
  articulationExemption,
  gradeArticulation,
  gradeDimensions,
  gradeNaming,
  gradeTriangleBudget,
  type ClassSpec,
} from './seatClassSpec';

export const ORACLE_PHASES = [
  'setup', 'blockout', 'topology', 'retopo', 'naming',
  'uv-skin', 'generate', 'map-back', 'variants', 'rig', 'finish',
] as const;
export type OraclePhase = (typeof ORACLE_PHASES)[number];

export type OracleCheck = {
  id: string;
  /** `host` is measured from the live model on every call. `agent-attest` exists only
   *  where no measurement exists yet — and each one is a filed feature request for a
   *  future audit, exactly like the python-escape signal that produced this module. */
  verified: 'host' | 'agent-attest';
  pass: boolean | null;
  detail: string;
};

export type OraclePlan = {
  id: string;
  summary: string;
  phases: OraclePhase[];
  /** Lowercase words that put a task on this plan; longest signal wins a tie. */
  signals: string[];
};

// A blockout task never loads the retopology corridor; a skinning task never loads the
// junction-repair doc. Context cost tracks the actual task.
export const ORACLE_PLANS: OraclePlan[] = [
  {
    id: 'retopo',
    summary: 'Turn an imported/generated triangle soup into clean, skinnable topology.',
    phases: ['setup', 'retopo', 'naming', 'uv-skin', 'finish'],
    signals: ['retopo', 'retopologize', 'retopology', 'soup', 'tripo', 'remesh', 'quadify', 'clean up the mesh'],
  },
  {
    id: 'skin',
    summary: 'Texture a modelled, named mesh through the UV atlas and bank it as a variant.',
    phases: ['setup', 'uv-skin', 'generate', 'map-back', 'variants', 'finish'],
    signals: ['skin', 'texture', 'atlas', 'paint variant', 'uv', 'material look', 'retexture'],
  },
  {
    id: 'rig',
    summary: 'Take a finished mesh through the rig/export gates.',
    phases: ['setup', 'rig', 'finish'],
    signals: ['rig', 'rigging', 'export character', 'skeleton', 'bones', 'placeable'],
  },
  {
    id: 'revise',
    summary: 'Change an existing model without rebuilding it.',
    phases: ['setup', 'topology', 'naming', 'finish'],
    signals: ['revise', 'fix', 'adjust', 'edit the', 'change the', 'repair', 'tweak'],
  },
  {
    id: 'blockout',
    summary: 'Model a new prop from a prompt or reference, from primitives to a saved package.',
    phases: ['setup', 'blockout', 'topology', 'naming', 'finish'],
    signals: ['model a', 'build a', 'make a', 'create a', 'blockout', 'from scratch', 'new prop'],
  },
];

/** The plan a task falls to when nothing matches. Modelling something new is the
 *  common case, and its phase list is the superset most work needs. */
export const DEFAULT_PLAN_ID = 'blockout';

export function classifyTask(task: string): { plan: OraclePlan; matched: string | null } {
  const text = String(task ?? '').toLowerCase();
  let best: { plan: OraclePlan; signal: string } | null = null;
  for (const plan of ORACLE_PLANS) {
    for (const signal of plan.signals) {
      if (!text.includes(signal)) continue;
      // Longest signal wins: "retexture" must beat a bare "texture", and an explicit
      // "retopologize" must beat the "fix" that happens to appear in the same sentence.
      if (!best || signal.length > best.signal.length) best = { plan, signal };
    }
  }
  return best
    ? { plan: best.plan, matched: best.signal }
    : { plan: ORACLE_PLANS.find((plan) => plan.id === DEFAULT_PLAN_ID)!, matched: null };
}

// ── the measured facts a phase gate reads ─────────────────────────────────────

export type OracleFacts = {
  /** Null when no model is live — every host check then reads `null`, never `false`:
   *  "not measured" and "measured and failing" are different answers. */
  model: {
    id: string | null;
    faces: number;
    unnamed: number;
    placeholders: number;
    regions: number;
    islands: number;
    parts: number;
    auditComputed: boolean | undefined;
    intersectingFaces: number | undefined;
    unreachableFaces: number | undefined;
  } | null;
  /** The class this task was matched to, with its spec derived from approved exemplars.
   *  Null when no class matched or the class has no approved exemplars yet — a task
   *  with no spec is graded on the universal checks alone, never on invented bounds. */
  classSpec: ClassSpec | null;
  /** Live shapes the class checks read. Null when nothing is live. */
  shape: { bbox: [number, number, number, number, number, number] | null; regionNames: string[]; partNames: string[] } | null;
  claimed: boolean | null;
  /** From `package diff` — null when the shell lane was not consulted (the ambient
   *  per-reply counter deliberately does not pay for a disk read). */
  packageInSync: boolean | null;
  packageDirty: boolean | null;
  semanticHealthy: boolean | null;
  /** Check ids the agent has attested, with its own note. */
  attest: Record<string, string>;
};

/** Unreachable geometry a finished model may still carry. Measured, not guessed: a
 *  pile of un-joined `add`-ed solids shipped at ~43% unreachable, which is what this
 *  budget exists to refuse. */
export const UNREACHABLE_BUDGET = 0.05;
/** Semantic regions per 100 triangles. 11 regions over 489 triangles (2.2) reads as a
 *  model; 175 over 300 (58) is noise. The ceiling sits well above good work so it
 *  refuses only the noise. */
export const MAX_REGIONS_PER_100_FACES = 8;
/** Below this a per-100 density number is statistical noise — a 12-triangle cube with
 *  6 names is 50 per 100 and perfectly correct. */
export const DENSITY_SAMPLE_FLOOR = 100;

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

type CheckSpec = { id: string; verified: 'host' | 'agent-attest'; evaluate: (facts: OracleFacts) => { pass: boolean | null; detail: string } };

const attested = (id: string, want: string): CheckSpec => ({
  id,
  verified: 'agent-attest',
  evaluate: (facts) => {
    const note = facts.attest[id];
    return note === undefined
      ? { pass: null, detail: `${want} — no measurement exists yet; attest with \`oracle attest ${id} "<how you verified it>"\`` }
      : { pass: true, detail: `attested: ${note}` };
  },
});

const CHECKS: Record<string, CheckSpec> = {
  'model-open': {
    id: 'model-open', verified: 'host',
    evaluate: (facts) => facts.model
      ? { pass: true, detail: `model ${facts.model.id ?? 'unnamed'} is live with ${facts.model.faces} triangles` }
      : { pass: false, detail: 'no live model — create one with `tools/seat new`' },
  },
  'model-claimed': {
    id: 'model-claimed', verified: 'host',
    evaluate: (facts) => facts.claimed === null
      ? { pass: null, detail: 'claim state not read' }
      : facts.claimed
        ? { pass: true, detail: 'the working model is claimed by this agent' }
        : { pass: false, detail: 'claim the model before structural work: `tools/seat claim <password> [agent]`' },
  },
  'every-face-named': {
    id: 'every-face-named', verified: 'host',
    evaluate: (facts) => !facts.model
      ? { pass: null, detail: 'no live model' }
      : facts.model.unnamed === 0
        ? { pass: true, detail: 'every triangle carries a semantic region' }
        : { pass: false, detail: `${facts.model.unnamed} unnamed triangles — name them at the operation that made them, not from normals later` },
  },
  'no-placeholders': {
    id: 'no-placeholders', verified: 'host',
    evaluate: (facts) => !facts.model
      ? { pass: null, detail: 'no live model' }
      : facts.model.placeholders === 0
        ? { pass: true, detail: 'no generator-named regions remain' }
        : { pass: false, detail: `${facts.model.placeholders} regions still carry a GENERATOR label, not a concept — replace each with what the surface means` },
  },
  'naming-density': {
    id: 'naming-density', verified: 'host',
    evaluate: (facts) => {
      if (!facts.model) return { pass: null, detail: 'no live model' };
      if (facts.model.faces < DENSITY_SAMPLE_FLOOR) {
        return { pass: true, detail: `${facts.model.faces} triangles is below the ${DENSITY_SAMPLE_FLOOR}-triangle sample floor; density is not meaningful yet` };
      }
      const density = (facts.model.regions / facts.model.faces) * 100;
      return density <= MAX_REGIONS_PER_100_FACES
        ? { pass: true, detail: `${facts.model.regions} regions over ${facts.model.faces} triangles (${density.toFixed(1)} per 100)` }
        : { pass: false, detail: `${facts.model.regions} regions over ${facts.model.faces} triangles (${density.toFixed(1)} per 100, ceiling ${MAX_REGIONS_PER_100_FACES}) — that is one label per face, not a model; merge them into regions that span real swaths` };
    },
  },
  'audit-measured': {
    id: 'audit-measured', verified: 'host',
    evaluate: (facts) => {
      if (!facts.model) return { pass: null, detail: 'no live model' };
      if (facts.model.auditComputed === undefined) return { pass: null, detail: 'host predates the geometry audit pass' };
      return facts.model.auditComputed
        ? { pass: true, detail: 'the host measured the geometry facts this reply reports' }
        : { pass: false, detail: 'mesh is over the audit budget — intersecting/unreachable are UNKNOWN, not zero; reduce the mesh or measure a part scope' };
    },
  },
  'no-intersecting': {
    id: 'no-intersecting', verified: 'host',
    evaluate: (facts) => {
      if (!facts.model || facts.model.auditComputed !== true) return { pass: null, detail: 'not measured' };
      const count = facts.model.intersectingFaces ?? 0;
      return count === 0
        ? { pass: true, detail: 'no triangle passes through another' }
        : { pass: false, detail: `${count} intersecting triangles — select them with \`tools/seat action select-audit '{"kind":"intersecting"}'\`` };
    },
  },
  'unreachable-budget': {
    id: 'unreachable-budget', verified: 'host',
    evaluate: (facts) => {
      if (!facts.model || facts.model.auditComputed !== true) return { pass: null, detail: 'not measured' };
      const count = facts.model.unreachableFaces ?? 0;
      const ratio = facts.model.faces > 0 ? count / facts.model.faces : 0;
      return ratio <= UNREACHABLE_BUDGET
        ? { pass: true, detail: `${count}/${facts.model.faces} unreachable (${percent(ratio)} ≤ ${percent(UNREACHABLE_BUDGET)})` }
        : { pass: false, detail: `${count}/${facts.model.faces} unreachable (${percent(ratio)} > ${percent(UNREACHABLE_BUDGET)}) — geometry sealed inside other geometry. Resolve junctions: delete the mating faces on BOTH sides, bridge the openings, weld the seam. \`part-merge\` resolves none of this. Select them with \`select-audit '{"kind":"unreachable"}'\`` };
    },
  },
  'parts-present': {
    id: 'parts-present', verified: 'host',
    evaluate: (facts) => !facts.model
      ? { pass: null, detail: 'no live model' }
      : facts.model.parts > 0
        ? { pass: true, detail: `${facts.model.parts} Outliner part(s)` }
        : { pass: false, detail: 'no Outliner parts yet' },
  },
  'atlas-built': {
    id: 'atlas-built', verified: 'host',
    evaluate: (facts) => !facts.model
      ? { pass: null, detail: 'no live model' }
      : facts.model.islands > 0
        ? { pass: true, detail: `${facts.model.islands} logical UV islands in the resident atlas` }
        : { pass: false, detail: 'no readable atlas — build one with `tools/seat atlas solid <r> <g> <b> <fit>` (fit is the BUDGET: 512/1024/2048/4096)' },
  },
  'package-saved': {
    id: 'package-saved', verified: 'host',
    evaluate: (facts) => facts.packageDirty === null
      ? { pass: null, detail: 'package state not read' }
      : facts.packageDirty
        ? { pass: false, detail: 'the document has unsaved changes — every uv-atlas operation refuses without a package on disk; run `tools/seat save`' }
        : { pass: true, detail: 'the document matches its on-disk package' },
  },
  'saved-in-sync': {
    id: 'saved-in-sync', verified: 'host',
    evaluate: (facts) => facts.packageInSync === null
      ? { pass: null, detail: 'saved package not compared — run `tools/seat package diff`' }
      : facts.packageInSync
        ? { pass: true, detail: 'the saved package matches the resident mesh on counts and region names' }
        : { pass: false, detail: 'the saved package DIVERGES from the resident mesh — read `tools/seat package diff` and save' },
  },
  'semantic-healthy': {
    id: 'semantic-healthy', verified: 'host',
    evaluate: (facts) => facts.semanticHealthy === null
      ? { pass: null, detail: 'semantic diagnostics not read — run `tools/seat semantic-status`' }
      : facts.semanticHealthy
        ? { pass: true, detail: 'saved RJMD, mount input, and resident semantics agree' }
        : { pass: false, detail: 'semantic-status is not healthy — names will not survive a cold restart' },
  },
  'class-dimensions': {
    id: 'class-dimensions', verified: 'host',
    evaluate: (facts) => {
      if (!facts.classSpec || !facts.shape) return { pass: null, detail: 'no class spec' };
      const verdict = gradeDimensions(facts.classSpec, facts.shape.bbox);
      return verdict ?? { pass: null, detail: 'the class spec carries no dimensions' };
    },
  },
  'class-triangle-budget': {
    id: 'class-triangle-budget', verified: 'host',
    evaluate: (facts) => (facts.classSpec && facts.model
      ? gradeTriangleBudget(facts.classSpec, facts.model.faces)
      : { pass: null, detail: 'no class spec' }),
  },
  'class-articulation': {
    id: 'class-articulation', verified: 'host',
    evaluate: (facts) => {
      if (!facts.classSpec || !facts.shape) return { pass: null, detail: 'no class spec' };
      const verdict = gradeArticulation(facts.classSpec, facts.shape.partNames);
      return verdict ?? { pass: null, detail: 'the class spec names no articulation parts' };
    },
  },
  'class-naming': {
    id: 'class-naming', verified: 'host',
    evaluate: (facts) => (facts.classSpec && facts.shape
      ? gradeNaming(facts.classSpec, facts.shape.regionNames)
      : { pass: null, detail: 'no class spec' }),
  },
  'scale-declared': attested('scale-declared', 'the model\'s intended real-world size in METERS is stated (1 unit = 1 meter)'),
  'proportions-declared': attested('proportions-declared', 'major parts and their meter dimensions are blocked out before detail'),
  'junctions-resolved': attested('junctions-resolved', 'every junction is joined by geometry — mating faces deleted on both sides, openings bridged, seams welded'),
  'bands-cleared': attested('bands-cleared', 'the retopology band map is resolved and the frozen source ghost has been compared against the new shell'),
  'prestack-reviewed': attested('prestack-reviewed', 'uv-prestack was dry-run, reviewed, and applied with its exact token'),
  'guide-exported': attested('guide-exported', 'the UV guide was exported with the export that matches the target image model (pink guide for gpt-image-2)'),
  'candidates-generated': attested('candidates-generated', '2-4 candidates were generated and picked with your eyes, with batches set explicitly'),
  'atlas-imported': attested('atlas-imported', 'the chosen skin was resized to the LIVE atlas dims and imported'),
  'shots-read': attested('shots-read', 'at least two viewport shots were taken AND read — alignment judged from the render, never from the flat PNG'),
  'variant-saved': attested('variant-saved', 'the accepted look was banked with paint-variant save-new'),
  'rig-gates': attested('rig-gates', 'the rig/export gates pass; no host rig audit exists yet, so say how you verified it'),
  'cold-verified': attested('cold-verified', 'the editor was fully reopened and the names proved with a generation-1 look'),
};

/** Exit criteria per phase. A phase advances only when every check passes. */
export const PHASE_CHECKS: Record<OraclePhase, string[]> = {
  setup: ['model-open', 'model-claimed', 'scale-declared'],
  blockout: ['every-face-named', 'parts-present', 'proportions-declared'],
  topology: ['audit-measured', 'no-intersecting', 'unreachable-budget', 'junctions-resolved', 'every-face-named'],
  retopo: ['audit-measured', 'unreachable-budget', 'bands-cleared', 'every-face-named'],
  naming: ['every-face-named', 'no-placeholders', 'naming-density'],
  'uv-skin': ['package-saved', 'atlas-built', 'prestack-reviewed'],
  generate: ['guide-exported', 'candidates-generated'],
  'map-back': ['atlas-imported', 'shots-read'],
  variants: ['variant-saved', 'every-face-named'],
  rig: ['every-face-named', 'no-placeholders', 'rig-gates'],
  finish: ['saved-in-sync', 'semantic-healthy', 'every-face-named', 'cold-verified'],
};

export const PHASE_CHECKLISTS: Record<OraclePhase, string[]> = {
  setup: [
    '`tools/seat look` — the always-on shell answers even with no model open',
    '`tools/seat new <kind>` if it returns state:"no-live-model"; never ask the user to prepare one',
    '`tools/seat claim <password> [agent]` and export the credentials for the engagement',
    'State the target size in METERS before the first primitive',
  ],
  blockout: [
    'Block out major parts at real meter dimensions — proportions before detail',
    'NAME every add/extrude/create-face as you make it',
    'Keep parts separate where a junction will need resolving later',
  ],
  topology: [
    'Resolve every junction: delete mating faces on BOTH sides, bridge, weld',
    '`tools/seat action select-audit \'{"kind":"both"}\'` to see what the counts refer to',
    '`tools/seat measure contact <a> <b>` and `tools/seat align <a> onto <b>` to seat parts exactly',
    'Remove permanently occluded faces; keep anything articulation can expose',
  ],
  retopo: [
    'Freeze and review the source: `retopo-bands` ghost before replacing strips',
    '`follow start` while the user demonstrates a delete/create pair, then replay the pattern',
    '`tools/seat stats edges <target>` to catch stretched rows before they multiply',
    'Name each replacement strip as you build it',
  ],
  naming: [
    'Replace every generator label with a concept the user would recognise',
    'A repeated structure shares ONE name — never window1/window2',
    'Aim for regions that span real swaths, not one label per face',
  ],
  'uv-skin': [
    '`tools/seat save` — atlas operations refuse without a package on disk',
    '`tools/seat atlas <base> [r g b] [fit]` and RECORD the reply\'s exact {w,h}',
    'Dry-run `uv-prestack` plan, review, then apply with its exact token',
    'Export the guide that matches your image model — pink for gpt-image-2',
  ],
  generate: [
    'Set batches explicitly (the default is 25)',
    'Walk the islands in the prompt; anchor each to a silhouette or number',
    'Declare the FEATURELESS islands, not only the featured ones',
    'Generate 2-4 candidates and pick with your eyes',
  ],
  'map-back': [
    'Resize to the LIVE atlas dims from the atlas reply, never a remembered number',
    '`uv-atlas import` replies pending:true — it is async, wait before judging',
    'Shot at least two poses and READ the PNGs',
    'Misaligned? regenerate first; UV geometry edits are a last resort',
  ],
  variants: [
    '`paint-variant save-new` per accepted look — variants are the wardrobe',
    '`tools/seat save`, then `semantic-status`: the semantic table must survive skinning',
  ],
  rig: [
    'Confirm naming and connectivity BEFORE the rig gates — they are rig inputs',
    'Read the ruled export shape (`tools/oracle "prop export rigging"`) before inventing one',
  ],
  finish: [
    '`tools/seat save`, then `tools/seat package diff` — prove saved matches resident',
    '`tools/seat semantic-status` — require status:"healthy" with matching nonzero counts',
    'Reopen the editor cold and prove the names with a generation-1 `look`',
    '`tools/seat dismiss` at the end of the engagement',
  ],
};

// ── evaluation + state ────────────────────────────────────────────────────────

/** Class-scoped criteria, appended to a phase's universal ones when a spec exists.
 *  Budget and scale are graded DURING blockout rather than at the end, because a model
 *  that is 4x oversized or ten times over budget is cheapest to fix before detail. */
const CLASS_PHASE_CHECKS: Partial<Record<OraclePhase, string[]>> = {
  blockout: ['class-dimensions', 'class-triangle-budget'],
  topology: ['class-articulation', 'class-triangle-budget'],
  retopo: ['class-triangle-budget'],
  naming: ['class-naming'],
  finish: ['class-dimensions', 'class-triangle-budget'],
};

export function checksForPhase(phase: OraclePhase, facts: OracleFacts): string[] {
  const universal = PHASE_CHECKS[phase] ?? [];
  if (!facts.classSpec) return universal;
  return [...universal, ...(CLASS_PHASE_CHECKS[phase] ?? [])];
}

export function evaluatePhase(phase: OraclePhase, facts: OracleFacts): OracleCheck[] {
  return checksForPhase(phase, facts).map((id) => {
    const spec = CHECKS[id];
    if (!spec) return { id, verified: 'agent-attest' as const, pass: null, detail: 'unknown check' };
    const outcome = spec.evaluate(facts);
    return { id, verified: spec.verified, pass: outcome.pass, detail: outcome.detail };
  });
}

/** Anything not demonstrably passing blocks. `null` is "unknown", and advancing on an
 *  unknown is exactly how unmeasured debt reaches a saved model. */
export function blockedCount(checks: readonly OracleCheck[]): number {
  return checks.filter((check) => check.pass !== true).length;
}

export type OracleSession = {
  task: string;
  planId: string;
  /** Set when the task matched a corpus class. The spec itself is re-derived from the
   *  approved exemplars on every read, so a session never carries a stale distribution. */
  classId: string | null;
  phases: OraclePhase[];
  phaseIndex: number;
  attest: Record<string, string>;
  matchedSignal: string | null;
};

export function startSession(task: string): OracleSession {
  const { plan, matched } = classifyTask(task);
  return { task: String(task ?? '').trim(), planId: plan.id, classId: null, phases: [...plan.phases], phaseIndex: 0, attest: {}, matchedSignal: matched };
}

export function currentPhase(session: OracleSession): OraclePhase {
  return session.phases[Math.min(session.phaseIndex, session.phases.length - 1)]!;
}

export function isComplete(session: OracleSession): boolean {
  return session.phaseIndex >= session.phases.length;
}

export type OracleView = {
  task: string;
  plan: string;
  classId: string | null;
  /** The one thing a spec changes about the finish gate, said in words so an agent
   *  does not have to infer it from a part list. */
  articulation: string;
  phase: OraclePhase | null;
  phases: OraclePhase[];
  position: string;
  checks: OracleCheck[];
  checklist: string[];
  next: OraclePhase | null;
  blocked: number;
  complete: boolean;
};

export function viewSession(session: OracleSession, facts: OracleFacts): OracleView {
  const complete = isComplete(session);
  const phase = complete ? null : currentPhase(session);
  const checks = phase ? evaluatePhase(phase, facts) : [];
  return {
    task: session.task,
    plan: session.planId,
    classId: session.classId,
    articulation: articulationExemption(facts.classSpec),
    phase,
    phases: session.phases,
    position: complete
      ? `${session.phases.length}/${session.phases.length} complete`
      : `${session.phaseIndex + 1}/${session.phases.length}`,
    checks,
    checklist: phase ? PHASE_CHECKLISTS[phase] ?? [] : [],
    next: complete ? null : session.phases[session.phaseIndex + 1] ?? null,
    blocked: blockedCount(checks),
    complete,
  };
}

export type OracleAdvance =
  | { ok: true; from: OraclePhase; to: OraclePhase | null; complete: boolean; view: OracleView }
  | { ok: false; reason: string; failing: OracleCheck[]; view: OracleView };

/** The gate. Refusal names the failing checks with their measured detail — the same
 *  shape `save` uses when it refuses unnamed faces, because a refusal that does not
 *  say what to fix just teaches agents to route around the gate. */
export function advanceSession(session: OracleSession, facts: OracleFacts): OracleAdvance {
  const view = viewSession(session, facts);
  if (view.complete) return { ok: false, reason: 'the plan is already complete', failing: [], view };
  const failing = view.checks.filter((check) => check.pass !== true);
  if (failing.length > 0) {
    return {
      ok: false,
      reason: `phase "${view.phase}" is not clear — ${failing.length} of ${view.checks.length} exit criteria unmet: ${failing.map((check) => check.id).join(', ')}`,
      failing,
      view,
    };
  }
  const from = currentPhase(session);
  session.phaseIndex += 1;
  const after = viewSession(session, facts);
  return { ok: true, from, to: after.phase, complete: after.complete, view: after };
}

// ── doc routing ───────────────────────────────────────────────────────────────

export type OracleDocReader = (phase: string) => string | null;

/** Every phase name plus the always-available lookup corpus. */
export const ORACLE_DOC_NAMES = [...ORACLE_PHASES, 'reference'] as const;

export type OracleDocHit = { doc: string; heading: string; body: string; score: number };

/** Free-text lookup that does NOT touch plan state — routing is not state. An agent
 *  mid-topology hitting a UV question gets the slice it needs without leaving its phase. */
export function askCorpus(query: string, read: OracleDocReader, limit = 3): OracleDocHit[] {
  const terms = String(query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2);
  if (terms.length === 0) return [];
  const hits: OracleDocHit[] = [];
  for (const doc of ORACLE_DOC_NAMES) {
    const text = read(doc);
    if (!text) continue;
    for (const section of splitSections(text)) {
      const haystack = `${section.heading}\n${section.body}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        // A heading hit is what makes a section ABOUT the question rather than merely
        // mentioning it, so it counts for more than a body mention.
        if (section.heading.toLowerCase().includes(term)) score += 8;
        const mentions = haystack.split(term).length - 1;
        if (mentions > 0) score += Math.min(mentions, 4);
      }
      if (score > 0) hits.push({ doc, heading: section.heading, body: section.body, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
}

export function splitSections(text: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  let heading = '(preamble)';
  let body: string[] = [];
  for (const line of text.split('\n')) {
    if (/^#{1,4}\s/.test(line)) {
      if (body.join('\n').trim()) sections.push({ heading, body: body.join('\n').trim() });
      heading = line.replace(/^#{1,4}\s+/, '').trim();
      body = [];
    } else body.push(line);
  }
  if (body.join('\n').trim()) sections.push({ heading, body: body.join('\n').trim() });
  return sections;
}
