// useScriptRules — persisted ScriptRule store + React subscriptions.
//
// Each script app (sniper, arb, DCA, …) gets its own bucket of
// rules. Rules persist to `./shitcoin_scripts.json` keyed by
// (playerAddress → appId). Same JSON-on-disk pattern as
// `achievements.ts`. Rules survive `sim.reset()` — the player's
// script library is a meta-progression layer, not a per-run setup.
//
// Each enabled rule is bound at render time by a `<RuleRunner>`
// component (see ScriptApp.tsx) via `useIFTTT(rule.triggerSpec,
// wrappedAction)`. The wrapper logs fires into a per-rule audit ring
// before dispatching the action verb through the IFTTT registry.

import { readFile, writeFile } from '../../runtime/hooks/fs.ts';
import { useEffect, useState } from 'react';

export type ScriptRule = {
  /** Stable per-app id (monotonic). */
  id: number;
  /** Player-facing label ("Pump catcher", "ETH arb", …). */
  label: string;
  enabled: boolean;
  /** Persisted as the IFTTT trigger DSL string. Always a string for
   *  JSON-round-trip safety. */
  triggerSpec: string;
  /** Action DSL string. */
  actionSpec: string;
  /** Numeric / boolean args interpolated into the spec templates at
   *  bind time. */
  args: Record<string, string | number | boolean>;
  /** Recent fire timestamps (real_ms). Audit log surface; kept small. */
  recentFires: number[];
};

interface SavedState {
  version: 1;
  perPlayer: Record<string, Record<string, ScriptRule[]>>;
}

const SAVE_PATH = './shitcoin_scripts.json';
const RECENT_FIRES_CAP = 32;

let _state: SavedState = { version: 1, perPlayer: {} };
let _loaded = false;
let _activeAddress: string | null = null;
let _nextId = 1;
const _listeners = new Set<(appId: string) => void>();

function load(): void {
  if (_loaded) return;
  _loaded = true;
  const raw = readFile(SAVE_PATH);
  if (raw == null) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && parsed.perPlayer) {
      _state = parsed as SavedState;
      // Recompute the id counter so new rules don't collide with
      // existing ones across re-loads.
      let max = 0;
      for (const perApp of Object.values(_state.perPlayer)) {
        for (const rules of Object.values(perApp)) {
          for (const r of rules) if (r.id > max) max = r.id;
        }
      }
      _nextId = max + 1;
    }
  } catch {
    // Corrupt save — default state stands.
  }
}

function save(): void {
  try { writeFile(SAVE_PATH, JSON.stringify(_state)); } catch {}
}

function ensurePlayer(addr: string): Record<string, ScriptRule[]> {
  let perApp = _state.perPlayer[addr];
  if (!perApp) {
    perApp = {};
    _state.perPlayer[addr] = perApp;
  }
  return perApp;
}

function notify(appId: string): void {
  for (const fn of Array.from(_listeners)) {
    try { fn(appId); } catch {}
  }
}

// ── Public surface ────────────────────────────────────────────────────

export function setActivePlayer(address: string | null): void {
  load();
  _activeAddress = address;
}

export function getRules(appId: string): ScriptRule[] {
  if (!_activeAddress) return [];
  const perApp = _state.perPlayer[_activeAddress];
  if (!perApp) return [];
  return perApp[appId] ?? [];
}

export function addRule(appId: string, partial: Omit<ScriptRule, 'id' | 'recentFires'>): ScriptRule {
  if (!_activeAddress) throw new Error('addRule: no active player');
  const perApp = ensurePlayer(_activeAddress);
  let list = perApp[appId];
  if (!list) { list = []; perApp[appId] = list; }
  const rule: ScriptRule = { id: _nextId++, recentFires: [], ...partial };
  list.push(rule);
  save();
  notify(appId);
  return rule;
}

export function updateRule(appId: string, ruleId: number, patch: Partial<ScriptRule>): void {
  if (!_activeAddress) return;
  const list = _state.perPlayer[_activeAddress]?.[appId];
  if (!list) return;
  const idx = list.findIndex((r) => r.id === ruleId);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...patch };
  save();
  notify(appId);
}

export function removeRule(appId: string, ruleId: number): void {
  if (!_activeAddress) return;
  const list = _state.perPlayer[_activeAddress]?.[appId];
  if (!list) return;
  const idx = list.findIndex((r) => r.id === ruleId);
  if (idx < 0) return;
  list.splice(idx, 1);
  save();
  notify(appId);
}

/** Append a fire timestamp to a rule's audit log. Called by the
 *  `<RuleRunner>` action wrapper. Capped at RECENT_FIRES_CAP entries. */
export function recordFire(appId: string, ruleId: number, realMs: number): void {
  if (!_activeAddress) return;
  const list = _state.perPlayer[_activeAddress]?.[appId];
  if (!list) return;
  const r = list.find((x) => x.id === ruleId);
  if (!r) return;
  r.recentFires.unshift(realMs);
  if (r.recentFires.length > RECENT_FIRES_CAP) r.recentFires.length = RECENT_FIRES_CAP;
  save();
  notify(appId);
}

export function onChange(fn: (appId: string) => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/** React hook — subscribes to rule changes for `appId` + returns the
 *  current rule list. */
export function useScriptRules(appId: string): ScriptRule[] {
  const [, force] = useState(0);
  useEffect(() => {
    const unsub = onChange((changed) => {
      if (changed === appId) force((n) => (n + 1) & 0xffff);
    });
    return unsub;
  }, [appId]);
  return getRules(appId);
}

// ── Template helpers ──────────────────────────────────────────────────

/** Substitute `$name` placeholders in a spec template against `args`. */
export function resolveSpec(spec: string, args: Record<string, any>): string {
  return spec.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    const v = args[name];
    return v == null ? `$${name}` : String(v);
  });
}
