// IFTTT trigger / action autocomplete suggestions.
//
// Sources:
//   - Live registry via listIfttSources()/listIfttActions() — gives
//     us every prefix the runtime has registered (e.g. 'permission:',
//     'match:', 'approve-if-target-ext:').
//   - Concrete usable examples per family below — shows the full
//     string shapes the prefixes expand into.
//
// Prefix-only entries (e.g. 'permission:') come from the registry;
// the concrete forms below demonstrate how to fill them in.

import { listIfttSources, listIfttActions } from '../../../runtime/hooks/ifttt/registry';

export const TRIGGER_HINTS = [
  // permission scraping
  'permission:any',
  'permission:write',
  'permission:edit',
  'permission:bash',
  'permission:read',
  'permission:websearch',
  'permission:webfetch',
  'permission:dismissed',
  // lifecycle
  'mount',
  'click',
  // keys
  'key:ctrl+s',
  'key:ctrl+shift+z',
  'key:escape',
  'key:up:escape',
  // timers
  'timer:every:5000',
  'timer:once:1000',
  // shared state
  'state:flag:true',
  // process telemetry
  'proc:line:1234',
  'proc:ram:1234:200',
  'proc:cpu:1234:80',
  'proc:idle:1234:60',
  // selection / clipboard
  'select:any',
  'select:nonempty',
  'select:cleared',
  'select:long:20',
  'clipboard:copy',
  'system:clipboard',
  // Claude Code phase + tool fanout
  'system:claude',
  'system:claude:user-prompt',
  'system:claude:pre-tool',
  'system:claude:post-tool',
  'system:claude:stop',
  'system:claude:bash',
  'system:claude:write',
  // turn boundaries
  'turn:start',
  'turn:end',
  'turn:tool-use',
  'turn:tool-count',
  // semantic + pattern primitives
  'match:turn:end::I apologize',
  'match:event:append::/git\\s+(reset|clean)\\s+-/',
  'firsthit:event:append::session ended',
  'count:event:append::6:30000',
  'repeat:turn:end::3::0.8',
  // VM event passthrough
  'vm:default:event:append',
];

export const ACTION_HINTS = [
  // permission answers
  'permission:approve',
  'permission:deny',
  'approve-if-target-ext:.md,.txt',
  'approve-if-target-ext:.md,.txt,.json',
  'deny-if-target-ext:.env,.lock',
  'approve-if-target-word:docs/',
  'deny-if-target-word:secrets/',
  'approve-if-tool:Read,WebFetch',
  'deny-if-tool:Bash',
  // generic IFTTT verbs
  'log:fired',
  'send:my-event',
  'clipboard:hello',
  'state:set:flag:true',
  'state:toggle:paused',
  // process control
  'proc:spawn:echo hi',
  'proc:kill:1234',
  'proc:write:1234:hello\\n',
  // supervisor + pathology orchestration
  'flag-pathology:apology_without_change',
  'halt-run',
  'kick-to-supervisor',
  'queue-job:my-job',
  'invoke-verb:my-verb',
  'fire-rule:my-rule',
  'notify-user:agent crashed',
  'inject-message:please summarize',
  'spawn-worker:my-recipe',
  'modify-assembly:tone=terse',
  'set-variable:retries=3',
  'commit-state',
  'mark-status:run.42=halted',
];

export function getTriggerSuggestions(): string[] {
  return Array.from(new Set([...TRIGGER_HINTS, ...listIfttSources()])).sort();
}

export function getActionSuggestions(): string[] {
  return Array.from(new Set([...ACTION_HINTS, ...listIfttActions()])).sort();
}

export function filterSuggestions(value: string, all: string[]): string[] {
  const v = value.trim().toLowerCase();
  if (!v) return all.slice(0, 8);
  return all.filter(s => s.toLowerCase().includes(v)).slice(0, 8);
}
