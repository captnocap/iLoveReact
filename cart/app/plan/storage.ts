// Plan storage — JSON files under .reactjit/plans/<planId>.json.
//
// Project-scoped. The directory is the working directory the cart was
// launched from; we resolve it lazily so a cold cart (no plans dir
// yet) doesn't error.
//
// Each file holds the full rev history of one plan. The head rev is
// revs[0]. Older revs are kept so the user can fork or revert. There
// is no "small edits skip the rev counter" optimization — every
// applied batch is a checkpoint.
//
// The plans[] array the canvas pulls from is the directory listing;
// we don't keep a separate index file.

import { exists, listDir, mkdir, readFile, writeFile } from '@reactjit/runtime/hooks/fs';
import type { Plan, PlanFile, PlanRev } from './types';

const PLANS_DIR = '.reactjit/plans';

function ensureDir(): void {
  if (!exists(PLANS_DIR)) mkdir(PLANS_DIR);
}

function pathFor(planId: string): string {
  return `${PLANS_DIR}/${planId}.json`;
}

export function listPlans(): PlanFile[] {
  ensureDir();
  const names = listDir(PLANS_DIR).filter((n) => n.endsWith('.json'));
  const out: PlanFile[] = [];
  for (const name of names) {
    const raw = readFile(`${PLANS_DIR}/${name}`);
    if (!raw) continue;
    try { out.push(JSON.parse(raw) as PlanFile); } catch { /* skip malformed */ }
  }
  return out;
}

export function loadPlan(planId: string): PlanFile | null {
  const raw = readFile(pathFor(planId));
  if (!raw) return null;
  try { return JSON.parse(raw) as PlanFile; } catch { return null; }
}

export function savePlan(file: PlanFile): boolean {
  ensureDir();
  return writeFile(pathFor(file.planId), JSON.stringify(file, null, 2));
}

export function newPlanId(): string {
  // 8 hex chars + ms timestamp suffix → readable in the directory listing.
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(36)}_${rnd}`;
}

export function headRev(file: PlanFile): PlanRev | undefined {
  return file.revs[0];
}

/** Append a new rev. Returns the updated file (does NOT persist). */
export function appendRev(file: PlanFile, plan: Plan, applied?: PlanRev['appliedComments']): PlanFile {
  const parent = file.revs[0];
  const next: PlanRev = {
    planId: file.planId,
    rev: (parent?.rev ?? -1) + 1,
    parentRev: parent?.rev,
    plan,
    appliedComments: applied,
    createdAt: Date.now(),
  };
  return { ...file, revs: [next, ...file.revs] };
}

/** Build a fresh PlanFile with rev 0. */
export function initPlanFile(plan: Plan): PlanFile {
  const rev0: PlanRev = { planId: plan.id, rev: 0, plan, createdAt: Date.now() };
  return { planId: plan.id, name: plan.name, revs: [rev0] };
}
