// Agent model claims — the in-memory lock table that lets several agents (and
// the user) work in one editor without stepping on each other's models
// (req_3850). An agent claims a model with a password of its own choosing; from
// then on every mutating door — seat actions and user-lane commands alike —
// admits only requests carrying that password. Reads are never gated: looking
// at a claimed model is always allowed, editing it is not.
//
// The table is deliberately process memory: restarting the editor wipes every
// claim (the ruled auto-release), and `dismiss` releases one explicitly. This
// is accident prevention between cooperating parties, not cryptography — the
// password stops the WRONG agent, not a hostile one, so a small non-reversible
// hash is enough and the plaintext is never stored.

export type ModelClaim = {
  model: string;
  agent: string;
  claimedAt: number;
};

type ClaimRecord = ModelClaim & { hash: number };

const claims = new Map<string, ClaimRecord>();
const listeners = new Set<() => void>();

/** The model the seat's un-addressed verbs land on. The shell keeps this
 * current; transport-neutral callers (tests) set it directly. */
let activeModel: string | null = null;

const hashPassword = (password: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < password.length; i++) {
    hash ^= password.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const notify = () => { for (const listener of listeners) listener(); };

export function setClaimActiveModel(model: string | null): void {
  activeModel = model;
}

export function claimActiveModel(): string | null {
  return activeModel;
}

/** Claim a model for an agent. Re-claiming with the same password is idempotent
 * (the agent label refreshes); a different password is refused while the claim
 * stands. */
export function claimModel(model: string, password: string, agent: string): { ok: boolean; reason?: string } {
  if (!model) return { ok: false, reason: 'claim needs a model — open or create one first' };
  if (!password) return { ok: false, reason: 'claim needs a non-empty password' };
  const existing = claims.get(model);
  if (existing && existing.hash !== hashPassword(password)) {
    return { ok: false, reason: `model is already claimed by ${existing.agent}` };
  }
  claims.set(model, {
    model,
    agent: agent || 'agent',
    claimedAt: existing?.claimedAt ?? Date.now(),
    hash: hashPassword(password),
  });
  notify();
  return { ok: true };
}

export function dismissClaim(model: string, password: string): { ok: boolean; reason?: string } {
  const existing = claims.get(model);
  if (!existing) return { ok: false, reason: 'model is not claimed' };
  if (existing.hash !== hashPassword(password)) {
    return { ok: false, reason: `wrong password — the claim belongs to ${existing.agent}` };
  }
  claims.delete(model);
  notify();
  return { ok: true };
}

export function claimHolder(model: string | null): ModelClaim | null {
  if (!model) return null;
  const existing = claims.get(model);
  return existing ? { model: existing.model, agent: existing.agent, claimedAt: existing.claimedAt } : null;
}

/** The admission check every mutating door calls. Unclaimed models admit
 * everyone; a claimed model admits only the matching password. */
export function claimAdmits(model: string | null, password: string | undefined): { ok: boolean; reason?: string } {
  if (!model) return { ok: true };
  const existing = claims.get(model);
  if (!existing) return { ok: true };
  if (password !== undefined && existing.hash === hashPassword(password)) return { ok: true };
  return { ok: false, reason: `locked — ${existing.agent} has this model claimed` };
}

export function listClaims(): ModelClaim[] {
  return [...claims.values()].map(({ model, agent, claimedAt }) => ({ model, agent, claimedAt }));
}

/** UI reactivity: fires on every claim/dismiss. Returns the unsubscribe. */
export function subscribeClaims(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test hygiene only — the production wipe is the process exiting. */
export function resetClaimsForTest(): void {
  claims.clear();
  activeModel = null;
}
