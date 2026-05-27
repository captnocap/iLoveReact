// Shared contract for the composer's option/chain model.
//
// Pulled out of suggest.ts as the surface grew: catalog → suggest → graph →
// page all speak this shape now, so no single file should own it. An option
// is one selectable choice whose `capability` is the CHAIN that realizes it —
// because almost nothing is a single trigger/action; the interesting rules are
// composed (see composition.ts).

import type { Side } from './catalog';
export type { Side };

export const OTHER_ID = 'other';

/** The pipe separator the assistant uses between chain steps inside the
 *  capability="[ … | … ]" array. Pipe (not comma) because action tokens can
 *  carry free text with commas (e.g. notify-user:hey, it failed). */
export const CHAIN_SEP = '|';

export interface Suggestion {
  /** Stable id within the batch ("a", "b", … or "other"). */
  id: string;
  /** The chain that realizes this option: ordered, grounded primitive tokens.
   *  One element = a simple rule; several = a composed chain. `["other"]` for
   *  the clarification / "not supported" escape. Every element is validated
   *  live against the registry in suggest.ts. */
  capability: string[];
  /** Plain-language explanation of the whole chain (this is what carries the
   *  meaning when the chain is multi-step). */
  text: string;
  /** Which side this belongs to / flow-node kind. */
  kind: 'trigger' | 'action';
}

/** A saved IF/THEN configuration — one entry in the user's index. The picked
 *  chains ARE the stored data; nothing is compiled. Persisted both to a file
 *  and as a DB row (entity `if-then-config`, bucket `user-sweatshop`). */
export interface IfThenConfig {
  id: string;
  if: { capability: string[]; text: string };
  then: { capability: string[]; text: string };
  createdAt: number;
}

/** Build a config record from the two picked options. */
export function buildConfig(ifOpt: Suggestion, thenOpt: Suggestion): IfThenConfig {
  return {
    id: `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    if: { capability: ifOpt.capability, text: ifOpt.text },
    then: { capability: thenOpt.capability, text: thenOpt.text },
    createdAt: Date.now(),
  };
}

/** Parse a capability attribute — `[a | b | c]`, `a | b`, or a bare `a` — into
 *  an ordered list of trimmed, non-empty steps. */
export function parseChain(raw: string): string[] {
  return raw
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(CHAIN_SEP)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Render a chain back to the `[a | b | c]` form (display + recipe comments). */
export function formatChain(chain: string[]): string {
  return `[${chain.join(` ${CHAIN_SEP} `)}]`;
}

export function isOtherChain(chain: string[]): boolean {
  return chain.length === 0 || (chain.length === 1 && chain[0] === OTHER_ID);
}
