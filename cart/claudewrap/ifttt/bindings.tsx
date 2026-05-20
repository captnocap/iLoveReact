// One rule = one real useIFTTT(trigger, action) call. When the user
// toggles `enabled` off we swap the action for a 'log:' string action
// so the trigger subscription stays mounted at a stable hook position;
// nothing fires.
//
// Toggling/editing the trigger forces a re-subscribe via the
// composeKey inside useIFTTT — see runtime/hooks/useIFTTT.ts.

import * as React from 'react';
import { useIFTTT } from '../../../runtime/hooks/useIFTTT';
import type { RecipeRule } from '../types';

export const DISABLED_ACTION = 'log:[disabled]';

export function RuleBinding({ rule }: { rule: RecipeRule }) {
  const trigger = rule.trigger || 'permission:any';
  const action = rule.enabled ? (rule.action || DISABLED_ACTION) : DISABLED_ACTION;
  useIFTTT(trigger, action);
  return null;
}
