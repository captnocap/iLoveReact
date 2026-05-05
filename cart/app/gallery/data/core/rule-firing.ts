// RuleFiring — per-firing log of every Rule consequence dispatch.
//
// Rule.fireCount + lastFiredAt are denorm summaries on the Rule row;
// this file is the row-grain log. One RuleFiring per (rule, triggering
// event, attempt). Lets the catalog answer "what rule fired what,
// when, and what happened" without scanning the rule rows themselves.
//
// `chainedFromRuleFiringId` and `chainedToRuleFiringIds` form the
// explicit chain via Rule.consequence.triggersRule. Implicit chains
// via emitted events are recoverable from Event.causalEventId.

import type { GalleryDataReference, JsonObject } from '../../types';

export type RuleFiringResult = 'completed' | 'failed' | 'skipped-cooldown' | 'skipped-maxfires' | 'skipped-disabled';

export type RuleFiringWorkerResponse =
  | 'unknown' // not measured
  | 'obeyed' // worker behaved consistently with the consequence
  | 'ignored' // worker continued unaffected
  | 'objected' // worker emitted a counter-action
  | 'no-op'; // consequence had no observable effect

export type RuleFiring = {
  id: string;
  ruleId: string;
  triggeringEventId: string;
  /** Snapshot of the consequence as it was dispatched. The rule row
   *  may be edited later; this row preserves what actually fired. */
  consequenceSnapshot: Record<string, unknown>;
  result: RuleFiringResult;
  /** Result message — error from a queue-job, empty for notify-user, etc. */
  resultMessage?: string;
  /** Chain links — populated when consequence.triggersRule was set. */
  chainedFromRuleFiringId?: string;
  chainedToRuleFiringIds?: string[];
  /** Post-hoc effectiveness — measured by the rule engine when possible. */
  workerResponseBehavior: RuleFiringWorkerResponse;
  /** Pointer at the active CompositionRun, if any. */
  compositionRunId?: string;
  firedAt: string;
  durationMs?: number;
};

export const ruleFiringMockData: RuleFiring[] = [
  {
    id: 'rfir_001',
    ruleId: 'rule_pathology_detected_halt',
    triggeringEventId: 'evt_pathology_detected_001',
    consequenceSnapshot: { kind: 'halt-run', spec: { reason: 'pathology' }, triggersRule: 'rule_supervisor_escalate_pathology' },
    result: 'completed',
    chainedToRuleFiringIds: ['rfir_002'],
    workerResponseBehavior: 'obeyed',
    compositionRunId: 'crun_001',
    firedAt: '2026-04-22T16:32:11Z',
    durationMs: 12,
  },
  {
    id: 'rfir_002',
    ruleId: 'rule_supervisor_escalate_pathology',
    triggeringEventId: 'evt_rule_fired_rfir_001',
    consequenceSnapshot: { kind: 'kick-to-supervisor', spec: { surface: 'cockpit-inbox', priority: 'critical' } },
    result: 'completed',
    chainedFromRuleFiringId: 'rfir_001',
    workerResponseBehavior: 'obeyed',
    compositionRunId: 'crun_001',
    firedAt: '2026-04-22T16:32:11.040Z',
    durationMs: 8,
  },
];

export const ruleFiringSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'RuleFiring',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'ruleId', 'triggeringEventId', 'consequenceSnapshot', 'result', 'workerResponseBehavior', 'firedAt'],
    properties: {
      id: { type: 'string' },
      ruleId: { type: 'string' },
      triggeringEventId: { type: 'string' },
      consequenceSnapshot: { type: 'object', additionalProperties: true },
      result: { type: 'string', enum: ['completed', 'failed', 'skipped-cooldown', 'skipped-maxfires', 'skipped-disabled'] },
      resultMessage: { type: 'string' },
      chainedFromRuleFiringId: { type: 'string' },
      chainedToRuleFiringIds: { type: 'array', items: { type: 'string' } },
      workerResponseBehavior: { type: 'string', enum: ['unknown', 'obeyed', 'ignored', 'objected', 'no-op'] },
      compositionRunId: { type: 'string' },
      firedAt: { type: 'string' },
      durationMs: { type: 'number' },
    },
  },
};

export const ruleFiringReferences: GalleryDataReference[] = [
  { kind: 'belongs-to', label: 'Rule', targetSource: 'cart/app/gallery/data/core/rule.ts', sourceField: 'ruleId', targetField: 'id' },
  { kind: 'references', label: 'Triggering event', targetSource: 'cart/app/gallery/data/core/event.ts', sourceField: 'triggeringEventId', targetField: 'id' },
  {
    kind: 'references',
    label: 'Chained-from firing',
    targetSource: 'cart/app/gallery/data/core/rule-firing.ts',
    sourceField: 'chainedFromRuleFiringId',
    targetField: 'id',
  },
  { kind: 'references', label: 'Composition run', targetSource: 'cart/app/gallery/data/core/composition-run.ts', sourceField: 'compositionRunId', targetField: 'id' },
];
