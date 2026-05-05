// BudgetLedger — append-only consumption rows. Replaces the
// race-prone `Budget.consumedAmount` mutation. Each entry is one
// chargeable event: an inference request completed, a tool call
// metered, a periodic reset.
//
// "Consumed amount" becomes a SUM-on-read query, not a mutating
// counter. Concurrent writes do not race because each writer inserts
// its own row. The cost is one extra query at read time; the benefit
// is correctness under any level of parallelism plus a complete audit
// trail.
//
// Reset events are also rows (kind='reset', amount=0, with a marker
// in `note`). Sum aggregations filter to "since last reset of period
// X" rather than mutating the budget.

import type { GalleryDataReference, JsonObject } from '../../types';

export type BudgetLedgerEntryKind =
  | 'consumption' // a request consumed budget
  | 'reset' // periodic reset boundary marker
  | 'adjustment' // manual correction (refund, gift, write-off)
  | 'reservation' // pre-flight reservation, finalized later
  | 'reservation-release'; // reservation expired or was cancelled

export type BudgetLedgerEntry = {
  id: string;
  budgetId: string;
  kind: BudgetLedgerEntryKind;
  amount: number; // delta — positive consumes, negative refunds
  unit: 'usd' | 'tokens-input' | 'tokens-output' | 'tokens-total' | 'requests';
  occurredAt: string;
  // What caused the entry — exactly one of these is typically set.
  inferenceRequestId?: string;
  taskClaimId?: string;
  workerId?: string;
  // Pre-flight reservations link to the consumption that finalizes them.
  reservationOfId?: string; // points at an earlier 'reservation' entry
  finalizedById?: string; // points at a later 'consumption' / 'reservation-release'
  note?: string;
};

export const budgetLedgerMockData: BudgetLedgerEntry[] = [
  // Daily reset boundary
  {
    id: 'led_reset_global_2026_04_25',
    budgetId: 'budget_global_daily',
    kind: 'reset',
    amount: 0,
    unit: 'usd',
    occurredAt: '2026-04-25T00:00:00Z',
    note: 'Daily reset; sum-on-read aggregations filter to entries with occurredAt > this.',
  },
  // Three consumption events from the morning
  {
    id: 'led_req_001_consume',
    budgetId: 'budget_global_daily',
    kind: 'consumption',
    amount: 0.0123,
    unit: 'usd',
    occurredAt: '2026-04-25T09:00:02.140Z',
    inferenceRequestId: 'req_001',
    workerId: 'w1',
  },
  {
    id: 'led_req_002_consume',
    budgetId: 'budget_global_daily',
    kind: 'consumption',
    amount: 0.0087,
    unit: 'usd',
    occurredAt: '2026-04-25T09:06:03Z',
    inferenceRequestId: 'req_002',
    workerId: 'worker_sub_02',
  },
  // Same request charged against the OPUS-only budget too — one event,
  // two ledger rows, different budgets.
  {
    id: 'led_req_001_consume_opus',
    budgetId: 'budget_opus_daily',
    kind: 'consumption',
    amount: 0.0123,
    unit: 'usd',
    occurredAt: '2026-04-25T09:00:02.140Z',
    inferenceRequestId: 'req_001',
    workerId: 'w1',
    note: 'Same request as led_req_001_consume — also counts against the model-scoped Opus budget.',
  },
  // Pre-flight reservation pattern (request started but not finished)
  {
    id: 'led_req_003_reserve',
    budgetId: 'budget_openai_monthly',
    kind: 'reservation',
    amount: 0.05,
    unit: 'usd',
    occurredAt: '2026-04-25T09:15:00Z',
    inferenceRequestId: 'req_003',
    workerId: 'worker_sup_01',
    note: 'Estimated max cost reserved before stream begins. Will be finalized when request completes.',
  },
  // Manual adjustment example
  {
    id: 'led_adjust_credit',
    budgetId: 'budget_openai_monthly',
    kind: 'adjustment',
    amount: -10.0,
    unit: 'usd',
    occurredAt: '2026-04-22T00:00:00Z',
    note: 'Free credits applied at month start; reduces consumed-amount.',
  },
];

export const budgetLedgerSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'BudgetLedger',
  description:
    'Append-only ledger. Sum entries by (budgetId, period-start) to get current consumed amount; do not mutate Budget.consumedAmount.',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'budgetId', 'kind', 'amount', 'unit', 'occurredAt'],
    properties: {
      id: { type: 'string' },
      budgetId: { type: 'string' },
      kind: {
        type: 'string',
        enum: ['consumption', 'reset', 'adjustment', 'reservation', 'reservation-release'],
      },
      amount: { type: 'number' },
      unit: {
        type: 'string',
        enum: ['usd', 'tokens-input', 'tokens-output', 'tokens-total', 'requests'],
      },
      occurredAt: { type: 'string' },
      inferenceRequestId: { type: 'string' },
      taskClaimId: { type: 'string' },
      workerId: { type: 'string' },
      reservationOfId: { type: 'string' },
      finalizedById: { type: 'string' },
      note: { type: 'string' },
    },
  },
};

export const budgetLedgerReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Budget',
    targetSource: 'cart/app/gallery/data/budget.ts',
    sourceField: 'budgetId',
    targetField: 'id',
    summary:
      'Replaces the ambient Budget.consumedAmount counter. Sum of (this.amount) where this.budgetId matches and occurredAt > last reset = current consumed.',
  },
  {
    kind: 'references',
    label: 'Inference request',
    targetSource: 'cart/app/gallery/data/inference-request.ts',
    sourceField: 'inferenceRequestId',
    targetField: 'id',
    summary: 'The request that triggered this charge.',
  },
  {
    kind: 'references',
    label: 'Worker',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'workerId',
    targetField: 'id',
    summary: 'For workload accounting — "which worker has burned the most spend this week."',
  },
  {
    kind: 'references',
    label: 'Reservation finalization',
    targetSource: 'cart/app/gallery/data/budget-ledger.ts',
    sourceField: 'finalizedById / reservationOfId',
    targetField: 'id',
    summary:
      'Reservation entries link to the later consumption entry that finalizes them. Both rows stay in the ledger; net effect is computed by sum.',
  },
];
