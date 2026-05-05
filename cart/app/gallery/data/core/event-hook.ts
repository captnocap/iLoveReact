// Shim — event-hook.ts was renamed to rule.ts on 2026-05-05 with a
// shape upgrade per the supervisor architecture spec (added scope,
// priority, triggersRule, broader consequence kinds). Old TS export
// names are aliased here so existing stories keep compiling.
//
// Field shape note: Rule.consequence is the upgraded EventHookAction.
// Most existing consumers only read `.kind` + `.spec`, which Rule
// preserves. Consumers that read EventHook.action need to switch to
// rule.consequence — the alias below preserves the shape but not the
// field name.
//
// Remove this shim after one cycle once consumers move to rule.

import type { Rule } from './rule';
export {
  ruleMockData as eventHookMockData,
  ruleSchema as eventHookSchema,
  ruleReferences as eventHookReferences,
  type Rule as EventHook,
  type RuleConsequenceKind as EventHookActionKind,
  type RuleMatchSelector as EventHookMatchSelector,
  type RuleConsequence as EventHookAction,
} from './rule';

// Legacy compat: some consumers may have read `.action` instead of
// `.consequence`. Provide a getter wrapper if needed; for now keep the
// alias type only — the mock data uses `consequence`, so any code
// reading `.action` will need to migrate.
export type LegacyEventHookView = Omit<Rule, 'consequence'> & { action: Rule['consequence'] };
