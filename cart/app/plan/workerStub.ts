// workerStub — a placeholder for the planning worker. Takes the
// current plan and the staged comment batch and returns a new plan
// rev. Surgical-by-default: it touches only the structural nodes
// addressed by the comments. Anything not addressed is byte-identical.
//
// This is mocked. Real integration goes through useAssistant +
// useEmbed (searchCode/searchPriorPlans/searchChat). When that lands
// this file is replaced with the wire layer; the contract — `(plan,
// comments) → newPlan` — stays the same.

import type { Cell, Comment, Modifier, Phase, Plan } from './types';

const APPENDED_NOTE_PREFIX = '[rev applied:]';

function appendNote(existing: string | undefined, body: string): string {
  const tag = `${APPENDED_NOTE_PREFIX} ${body}`;
  return existing ? `${existing} ${tag}` : tag;
}

function applyToCell(cell: Cell, body: string): Cell {
  return { ...cell, note: appendNote(cell.note, body) };
}

function applyToModifier(m: Modifier, body: string): Modifier {
  return { ...m, detail: appendNote(m.detail, body) };
}

function applyToPhase(phase: Phase, refTail: string, body: string): Phase {
  if (refTail === 'rationale') return { ...phase, rationale: appendNote(phase.rationale, body) };
  if (refTail === 'exit')      return { ...phase, exit:      appendNote(phase.exit,      body) };
  // bare phase ref — annotate the rationale as a default landing spot
  return { ...phase, rationale: appendNote(phase.rationale, body) };
}

function applyOne(plan: Plan, comment: Comment): Plan {
  const ref = comment.ref;
  const body = comment.body.trim();

  if (ref === 'intent.objective') {
    return { ...plan, intent: { ...plan.intent, objective: appendNote(plan.intent.objective, body) } };
  }
  const cm = ref.match(/^intent\.constraints\[(\d+)\]$/);
  if (cm) {
    const i = parseInt(cm[1], 10);
    const next = plan.intent.constraints.slice();
    if (next[i] !== undefined) next[i] = appendNote(next[i], body);
    return { ...plan, intent: { ...plan.intent, constraints: next } };
  }
  const em = ref.match(/^intent\.exitCriteria\[(\d+)\]$/);
  if (em) {
    const i = parseInt(em[1], 10);
    const next = plan.intent.exitCriteria.slice();
    if (next[i] !== undefined) next[i] = appendNote(next[i], body);
    return { ...plan, intent: { ...plan.intent, exitCriteria: next } };
  }

  // phase:<id>[.rationale|.exit]
  const pm = ref.match(/^phase:([^.]+)(?:\.(.+))?$/);
  if (pm) {
    const pid = pm[1];
    const tail = pm[2] ?? '';
    return {
      ...plan,
      phases: plan.phases.map((p) => (p.id === pid ? applyToPhase(p, tail, body) : p)),
    };
  }

  const cellM = ref.match(/^cell:(.+)$/);
  if (cellM) {
    const cid = cellM[1];
    return {
      ...plan,
      phases: plan.phases.map((p) => ({
        ...p,
        cells: p.cells.map((c) => (c.id === cid ? applyToCell(c, body) : c)),
      })),
    };
  }

  const modM = ref.match(/^modifier:(.+)$/);
  if (modM) {
    const mid = modM[1];
    return {
      ...plan,
      phases: plan.phases.map((p) => ({
        ...p,
        modifiers: p.modifiers.map((m) => (m.id === mid ? applyToModifier(m, body) : m)),
      })),
    };
  }

  return plan;
}

export async function applyCommentBatch(plan: Plan, comments: Comment[]): Promise<Plan> {
  // Simulate a brief worker turn so the UI can show sending state.
  await new Promise((r) => setTimeout(r, 250));
  let next = plan;
  for (const c of comments) next = applyOne(next, c);
  return next;
}
