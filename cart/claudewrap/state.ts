// Shared typed settings + lightweight subscribable store. The cart
// uses this for cross-page state that needs to outlive a single tab
// render (active backend, bridge port, vm image, window visibility,
// live IFTTT rules).
//
// Kept dependency-free on purpose: useSyncExternalStore-style mini
// subscribe pattern, no react-redux/zustand needed.

import { useEffect, useState } from 'react';
import type { AssistantBackend } from '../../runtime/hooks/useAssistant';
import type { RecipeRule } from './types';

export interface Settings {
  /** Active assistant backend. claude_code is the default (drives the
   *  vterm). Other backends mount as worker-event timelines inside the
   *  BackendsPanel. */
  activeBackend: AssistantBackend;
  /** HTTP bridge port. Bound at boot; mutable later from BridgePanel. */
  bridgePort: number;
  /** Active firecracker image id. scripts/claude-ss reads this from a
   *  config file at boot. */
  vmImage: string;
  /** Settings window open/closed. Toggled by chord + Pressable. */
  windowOpen: boolean;
  /** Active panel inside the settings window. */
  activePanel: 'bridge' | 'backends' | 'memory' | 'library' | 'vm' | 'canvas';
  /** Live IFTTT bindings. App.tsx maps these into <RuleBinding>
   *  children (one useIFTTT call each); RecipesPage edits them. */
  rules: RecipeRule[];
}

const INITIAL_RULES: RecipeRule[] = [
  {
    id: 'auto-approve-file-ext',
    label: 'auto-approve writes/edits by extension',
    trigger: 'permission:any',
    action: 'approve-if-target-ext:.txt,.md',
    enabled: true,
    source: 'live',
  },
  {
    id: 'auto-approve-tool',
    label: 'auto-approve safe tools',
    trigger: 'permission:any',
    action: 'approve-if-tool:Read',
    enabled: false,
    source: 'live',
  },
  {
    id: 'auto-deny-tool',
    label: 'auto-deny tools',
    trigger: 'permission:any',
    action: 'deny-if-tool:',
    enabled: false,
    source: 'live',
  },
  {
    id: 'auto-approve-target-word',
    label: 'auto-approve when target contains word',
    trigger: 'permission:any',
    action: 'approve-if-target-word:',
    enabled: false,
    source: 'live',
  },
];

const initial: Settings = {
  activeBackend: 'claude_code',
  bridgePort: 7781,
  vmImage: 'worker-minimal',
  windowOpen: false,
  activePanel: 'bridge',
  rules: INITIAL_RULES,
};

let state: Settings = initial;
const listeners = new Set<() => void>();

export function getSettings(): Settings { return state; }

export function setSettings(patch: Partial<Settings>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) {
    try { fn(); } catch (e: any) {
      console.error('[claudewrap.state] listener error:', e?.message || e);
    }
  }
}

// ── Rule helpers ────────────────────────────────────────────────────

export function updateRule(id: string, patch: Partial<RecipeRule>): void {
  setSettings({
    rules: state.rules.map(r => r.id === id ? { ...r, ...patch } : r),
  });
}

export function addRule(rule: RecipeRule): void {
  setSettings({ rules: [...state.rules, rule] });
}

export function removeRule(id: string): void {
  setSettings({ rules: state.rules.filter(r => r.id !== id) });
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useSettings(): Settings {
  const [, force] = useState(0);
  useEffect(() => subscribeSettings(() => force(n => (n + 1) & 0xffff)), []);
  return state;
}
