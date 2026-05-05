// rule-binder — auto-binds Rule rows from the DB to the IFTTT registry.
//
// Call `bindRules()` once on cart mount (after ensureBootstrapped). For
// each enabled Rule row we:
//
//   1. Resolve the trigger spec (Rule.match.kind, with event: prefix if
//      none of the registered IFTTT prefixes match).
//   2. Translate Rule.consequence to the registered action DSL string.
//   3. Subscribe via `resolveTrigger(spec)`. On fire:
//      a. Apply Rule.match.payloadEquals filter.
//      b. Honor cooldownMs / maxFires.
//      c. dispatchAction(actionString, payload).
//      d. Append a RuleFiring row (which emits 'rule:fired', enabling
//         chained rules that trigger off `rule:<id>.fired`).
//      e. Bump the Rule row's fireCount + lastFiredAt (denorm).
//      f. If consequence.triggersRule is set, dispatch that rule's
//         action immediately (explicit chain — does not require the
//         chained rule's match.kind to be `rule:<this>.fired`).
//
// Re-bindable: `rebindRules()` tears down current bindings and rebinds.
// Useful when the user edits a rule from the cockpit and wants the
// change to take effect without a full reload.

import {
  resolveTrigger,
  dispatchAction,
} from '@reactjit/runtime/hooks/ifttt-registry';
import { ensureBootstrapped } from './bootstrap';
import { query, exec } from './connections';
import { ident, lit, tableName, val } from './sql';
import { bucketFor } from './registry';
import { notifyRowChange } from './buses';

// ── Spec prefix detection ──────────────────────────────────────────
// IFTTT prefixes that supervisor + runtime hooks register. If the
// rule's match.kind starts with any of these, use as-is. Otherwise
// treat it as an event kind and prepend 'event:'.
const KNOWN_SUPERVISOR_PREFIXES = [
  'event:', 'rule:', 'verb:', 'worker:', 'run:',
  'key:', 'timer:', 'state:', 'system:',
];
const KNOWN_BARE_TRIGGERS = ['mount', 'click'];

function resolveSpec(matchKind: string): string {
  for (const p of KNOWN_SUPERVISOR_PREFIXES) {
    if (matchKind.startsWith(p)) return matchKind;
  }
  if (KNOWN_BARE_TRIGGERS.includes(matchKind)) return matchKind;
  // Default: treat as Event row kind. 'goal.reframed' → 'event:goal.reframed'.
  return `event:${matchKind}`;
}

// ── Consequence → action string translation ───────────────────────

type RuleConsequence = {
  kind: string;
  spec: Record<string, unknown>;
  triggersRule?: string;
};

function consequenceToActionString(cons: RuleConsequence): string {
  const s = cons.spec || {};
  switch (cons.kind) {
    case 'queue-job': return `queue-job:${(s as any).jobId ?? ''}`;
    case 'spawn-worker': return `spawn-worker:${(s as any).recipe ?? (s as any).role ?? ''}`;
    case 'emit-event': return `send:${(s as any).kind ?? 'custom'}`;
    case 'mark-status': {
      const sp = s as any;
      return `mark-status:${sp.entity ?? ''}.${sp.id ?? ''}=${sp.status ?? ''}`;
    }
    case 'notify-user':
    case 'send-notification':
      return `notify-user:${(s as any).title ?? (s as any).message ?? ''}`;
    case 'cancel': return `send:cancel`; // payload carries target
    case 'inject-message': return `inject-message:${(s as any).text ?? ''}`;
    case 'invoke-verb': return `invoke-verb:${(s as any).verbId ?? ''}`;
    case 'halt-run': return 'halt-run';
    case 'flag-pathology': return `flag-pathology:${(s as any).pathologyId ?? ''}`;
    case 'kick-to-supervisor': return 'kick-to-supervisor';
    case 'fire-rule': return `fire-rule:${(s as any).ruleId ?? ''}`;
    case 'modify-assembly':
      return `modify-assembly:${(s as any).key ?? ''}=${(s as any).value ?? ''}`;
    case 'set-variable':
      return `set-variable:${(s as any).key ?? ''}=${(s as any).value ?? ''}`;
    case 'commit-state': return 'commit-state';
    case 'custom': return String((s as any).action ?? '');
    default: return '';
  }
}

// ── Payload filter ─────────────────────────────────────────────────

function matchesPayloadEquals(
  payload: any,
  expected: Record<string, unknown> | undefined,
): boolean {
  if (!expected) return true;
  if (!payload || typeof payload !== 'object') return false;
  for (const [k, v] of Object.entries(expected)) {
    if ((payload as any)[k] !== v) return false;
  }
  return true;
}

// ── Bindings registry ──────────────────────────────────────────────

const bindings = new Map<string, () => void>(); // ruleId → unsubscribe

function ruleRows(): any[] {
  const bucket = bucketFor('rule');
  const t = tableName('rule');
  const rows = query<{ data: any }>(bucket, `SELECT data FROM ${ident(t)}`);
  return rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
}

function appendRuleFiring(rule: any, eventPayload: any, actionString: string, result: 'completed' | 'failed' | 'skipped-cooldown' | 'skipped-maxfires' | 'skipped-disabled', resultMessage?: string): void {
  const id = `rfir_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    id,
    ruleId: rule.id,
    triggeringEventId: eventPayload?.id ?? '',
    consequenceSnapshot: { ...rule.consequence, actionString },
    result,
    resultMessage,
    chainedFromRuleFiringId: undefined,
    chainedToRuleFiringIds: undefined,
    workerResponseBehavior: 'unknown' as const,
    compositionRunId: eventPayload?.compositionRunId,
    firedAt: new Date().toISOString(),
    durationMs: 0,
  };
  const bucket = bucketFor('rule-firing');
  const t = tableName('rule-firing');
  const sql =
    `INSERT INTO ${ident(t)} (id, data) VALUES (${val(row.id)}, ${val(row)})` +
    ` ON CONFLICT (id) DO NOTHING`;
  exec(bucket, sql);
  // Manual fan-out: useCRUD's notifyRowChange isn't on the path for raw
  // INSERTs from outside the hook. Call it explicitly so 'rule:fired'
  // propagates to chained rules.
  notifyRowChange('rule-firing', row);
}

function bumpRule(rule: any): void {
  const next = {
    ...rule,
    fireCount: (rule.fireCount ?? 0) + 1,
    lastFiredAt: new Date().toISOString(),
  };
  const bucket = bucketFor('rule');
  const t = tableName('rule');
  const sql = `UPDATE ${ident(t)} SET data = ${val(next)}, updated_at = NOW() WHERE id = ${lit(rule.id)}`;
  exec(bucket, sql);
}

function bindOne(rule: any): () => void {
  if (!rule.enabled) {
    return () => {};
  }
  const spec = resolveSpec(rule.match?.kind ?? '');
  const actionString = consequenceToActionString(rule.consequence as RuleConsequence);
  const sub = resolveTrigger(spec);
  if (!sub) {
    console.warn(`[rule-binder] no trigger source for spec '${spec}' (rule ${rule.id})`);
    return () => {};
  }
  return sub.subscribe((payload: any) => {
    // payloadEquals filter
    if (!matchesPayloadEquals(payload, rule.match?.payloadEquals)) return;

    // cooldown
    if (rule.cooldownMs && rule.lastFiredAt) {
      const since = Date.now() - new Date(rule.lastFiredAt).getTime();
      if (since < rule.cooldownMs) {
        appendRuleFiring(rule, payload, actionString, 'skipped-cooldown');
        return;
      }
    }
    // maxFires
    if (rule.maxFires != null && (rule.fireCount ?? 0) >= rule.maxFires) {
      appendRuleFiring(rule, payload, actionString, 'skipped-maxfires');
      return;
    }

    // Dispatch primary consequence.
    let result: 'completed' | 'failed' = 'completed';
    let resultMessage: string | undefined;
    try {
      const handled = dispatchAction(actionString, payload);
      if (!handled) {
        result = 'failed';
        resultMessage = `unhandled action '${actionString}'`;
      }
    } catch (e: any) {
      result = 'failed';
      resultMessage = e?.message ?? String(e);
    }

    // Bump denorm + log firing.
    try { bumpRule(rule); } catch { /* swallow */ }
    appendRuleFiring(rule, payload, actionString, result, resultMessage);

    // Explicit chain via consequence.triggersRule.
    const triggersRule = (rule.consequence as RuleConsequence)?.triggersRule;
    if (triggersRule) {
      try { dispatchAction(`fire-rule:${triggersRule}`, payload); }
      catch { /* swallow */ }
    }
  });
}

/** Bind all enabled Rule rows. Idempotent: calling twice without
 *  unbind first will double-fire — use `rebindRules` instead. */
export async function bindRules(): Promise<void> {
  await ensureBootstrapped();
  for (const rule of ruleRows()) {
    if (bindings.has(rule.id)) continue;
    const unsub = bindOne(rule);
    bindings.set(rule.id, unsub);
  }
}

/** Unbind all rules + rebind from current DB state. Use after editing
 *  rules from the cockpit. */
export async function rebindRules(): Promise<void> {
  for (const u of bindings.values()) {
    try { u(); } catch { /* ignore */ }
  }
  bindings.clear();
  await bindRules();
}

/** Unbind all rules. Useful for tests + hot-reload teardown. */
export function unbindAllRules(): void {
  for (const u of bindings.values()) {
    try { u(); } catch { /* ignore */ }
  }
  bindings.clear();
}

/** Inspect: which rule ids are currently bound. */
export function listBoundRules(): string[] {
  return Array.from(bindings.keys()).sort();
}
