// Budget — spending / token caps attached to a Settings profile. Multi-
// scoped: the same shape covers "global daily cap", "OpenAI monthly
// cap", "Opus-only weekly cap", and "this specific connection caps at
// $100/month." Scope + scopeTargetId disambiguate.
//
// onExceed='degrade-model' + degradeToModelId turns budgets from a
// wall into a ramp — hit the Opus cap, silently route to Haiku.

import type { GalleryDataReference, JsonObject } from '../../types';

export type BudgetScope = 'all' | 'provider' | 'connection' | 'model';
export type BudgetType =
  | 'spend-usd'
  | 'tokens-total'
  | 'tokens-input'
  | 'tokens-output'
  | 'requests';
export type BudgetPeriod = 'day' | 'week' | 'month' | 'forever';
export type BudgetOnExceed = 'warn' | 'block' | 'degrade-model';

export type Budget = {
  id: string;
  settingsId: string;
  label: string;
  scope: BudgetScope;
  scopeTargetId?: string; // provider.id / connection.id / model.id — null when scope='all'
  budgetType: BudgetType;
  amount: number;
  period: BudgetPeriod;
  onExceed: BudgetOnExceed;
  degradeToModelId?: string;
  consumedAmount: number;
  resetsAt?: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
};

export const budgetMockData: Budget[] = [
  {
    id: 'budget_global_daily',
    settingsId: 'settings_default',
    label: 'Global daily cap',
    scope: 'all',
    budgetType: 'spend-usd',
    amount: 50,
    period: 'day',
    onExceed: 'block',
    consumedAmount: 12.34,
    resetsAt: '2026-04-25T00:00:00Z',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-24T09:02:14Z',
    summary: 'Hard stop at $50/day across everything.',
  },
  {
    id: 'budget_opus_daily',
    settingsId: 'settings_default',
    label: 'Opus daily — degrade to Haiku',
    scope: 'model',
    scopeTargetId: 'claude-opus-4-7',
    budgetType: 'spend-usd',
    amount: 15,
    period: 'day',
    onExceed: 'degrade-model',
    degradeToModelId: 'claude-haiku-4-5',
    consumedAmount: 6.21,
    resetsAt: '2026-04-25T00:00:00Z',
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-24T09:02:14Z',
    summary:
      '$15/day on Opus; when exhausted, requests route to Haiku instead of blocking. Keeps the agent running on cheaper tier past the cap.',
  },
  {
    id: 'budget_openai_monthly',
    settingsId: 'settings_default',
    label: 'OpenAI monthly (free credits)',
    scope: 'provider',
    scopeTargetId: 'openai',
    budgetType: 'spend-usd',
    amount: 20,
    period: 'month',
    onExceed: 'block',
    consumedAmount: 3.47,
    resetsAt: '2026-05-01T00:00:00Z',
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-24T09:15:00Z',
    summary: 'OpenAI only. Sized to the monthly free-credit ceiling — blocks once burned through.',
  },
  {
    id: 'budget_work_conn_monthly',
    settingsId: 'settings_work_strict',
    label: 'Work API key monthly',
    scope: 'connection',
    scopeTargetId: 'conn_anthropic_api',
    budgetType: 'spend-usd',
    amount: 100,
    period: 'month',
    onExceed: 'warn',
    consumedAmount: 0,
    resetsAt: '2026-05-01T00:00:00Z',
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
    summary: 'Scoped to the work Console API key. Warns at exceed; does not hard-stop client work mid-session.',
  },
  {
    id: 'budget_tokens_daily',
    settingsId: 'settings_default',
    label: 'Daily output token cap',
    scope: 'all',
    budgetType: 'tokens-output',
    amount: 500_000,
    period: 'day',
    onExceed: 'warn',
    consumedAmount: 34_210,
    resetsAt: '2026-04-25T00:00:00Z',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-24T09:02:14Z',
    summary: 'Token-count equivalent of the dollar cap. Useful when pricing drifts or for local models (no $$ cost).',
  },
];

export const budgetSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Budget',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'settingsId',
      'label',
      'scope',
      'budgetType',
      'amount',
      'period',
      'onExceed',
      'consumedAmount',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      scope: { type: 'string', enum: ['all', 'provider', 'connection', 'model'] },
      scopeTargetId: { type: 'string' },
      budgetType: {
        type: 'string',
        enum: ['spend-usd', 'tokens-total', 'tokens-input', 'tokens-output', 'requests'],
      },
      amount: { type: 'number' },
      period: { type: 'string', enum: ['day', 'week', 'month', 'forever'] },
      onExceed: { type: 'string', enum: ['warn', 'block', 'degrade-model'] },
      degradeToModelId: { type: 'string' },
      consumedAmount: { type: 'number' },
      resetsAt: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      summary: { type: 'string' },
    },
  },
};

export const budgetReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary: 'Each budget belongs to a settings profile — swapping profiles swaps the active cap set.',
  },
  {
    kind: 'references',
    label: 'Scope target — provider',
    targetSource: 'cart/app/gallery/data/provider.ts',
    sourceField: 'scopeTargetId (when scope=provider)',
    targetField: 'id',
    summary: 'Budget scoped to a single Provider — e.g. "OpenAI monthly cap".',
  },
  {
    kind: 'references',
    label: 'Scope target — connection',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'scopeTargetId (when scope=connection)',
    targetField: 'id',
    summary: 'Budget scoped to a single Connection — e.g. "work Console API key monthly".',
  },
  {
    kind: 'references',
    label: 'Scope target — model',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'scopeTargetId (when scope=model)',
    targetField: 'id',
    summary: 'Budget scoped to a single Model — e.g. "Opus daily cap", paired with degradeToModelId for a ramp.',
  },
  {
    kind: 'references',
    label: 'Degrade target',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'degradeToModelId',
    targetField: 'id',
    summary:
      'When onExceed=degrade-model, requests that would have used the scoped model route to this model instead. Turns a wall into a ramp.',
  },
];
