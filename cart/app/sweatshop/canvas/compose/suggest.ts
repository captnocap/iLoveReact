// The assistant round-trip for the IF/THEN composer.
//
// On prompt submit we hand the assistant (a) the composition guide, (b) the
// FULL capability range for this side, and (c) the user's intent, and ask it
// to emit a stack of <option> tags. This isn't tool-calling — it's just text
// the assistant writes inline (the same way it emits primitive markup), and
// we parse it. So it works on every backend, CLI or API.
//
// The contract the assistant writes back — note `capability` is a CHAIN:
//   <option id="a" capability="[step1 | step2 | step3]" text="<explanation>" />
//   <option id="other" capability="[other]"             text="Something else…" />
//
// `capability` is the ordered list of grounded primitives that realizes the
// option (one step = a simple rule, several = a composed chain — see
// composition.ts); `text` explains the whole chain in plain language. There
// is ALWAYS an `other` option for "none of these — let me clarify" / "not
// supported". Few options when intent is specific, several when ambiguous.

import { listIfttSources, listIfttActions } from '@reactjit/hooks/ifttt/registry';
import { catalogPromptBlock, entriesFor, type Side } from './catalog';
import { compositionGuide } from './composition';
import { OTHER_ID, parseChain, type Suggestion } from './types';

// Re-export the shared contract so existing importers (graph.ts, page.tsx)
// keep resolving through this module.
export { OTHER_ID } from './types';
export type { Suggestion } from './types';

type AskFn = (text: string, opts?: { onPart?: (s: string) => void }) => Promise<string>;

function buildPrompt(side: Side, intent: string): string {
  const noun = side === 'if' ? 'TRIGGER (the IF)' : 'ACTION (the THEN)';
  const example =
    side === 'if'
      ? '  <option id="a" capability="[task:.started | worker:.stopped | match:apology]" text="Worker bails on a task sounding unsure" />'
      : '  <option id="a" capability="[spawn-worker:evaluator | state:set:stop_eval]" text="Have another worker judge it and remember the verdict" />';
  return [
    'You are helping a non-coder author one automation rule: IF <trigger> THEN <action>.',
    `Right now you are composing the ${noun} for the user.`,
    '',
    compositionGuide(),
    '',
    'These are the ONLY primitives that exist — every chain step must come from here:',
    catalogPromptBlock(side),
    '',
    `The user's intent for this side: "${intent}"`,
    '',
    'Offer choices as <option> tags. Each option is ONE selectable choice whose',
    '`capability` is the CHAIN that realizes it.',
    'Rules:',
    '- `capability` is an ordered, pipe-separated array of grounded primitives:',
    '  capability="[step1 | step2 | step3]". A simple choice is a one-step chain;',
    '  most good answers compose several steps. Compose freely.',
    '- Every step MUST be one of the primitives above with a concrete suffix filled',
    '  in (e.g. "count:verb:lifecycle::failed:3"). Never invent a step.',
    '- `text` explains the WHOLE chain in plain language a non-coder understands',
    '  (no jargon, one short sentence) — this is what carries the meaning.',
    '- If the intent is specific, offer 1–2 chains; if ambiguous, offer several that',
    '  open up different interpretations. You need not cover everything at once.',
    '- If a chain only partly fits, offer the closest one and be honest in `text`',
    '  about the gap. If genuinely NOTHING composes from these primitives, return',
    '  ONLY the other option with a one-line explanation of what is missing in its',
    '  text (e.g. text="No way to read email here — would need a new primitive").',
    `- ALWAYS end with an other option: <option id="${OTHER_ID}" capability="[${OTHER_ID}]" text="…" />`,
    '',
    'Output ONLY the <option> tags, one per line, nothing else. Example shape:',
    example,
    `  <option id="${OTHER_ID}" capability="[${OTHER_ID}]" text="Something else — let me clarify" />`,
  ].join('\n');
}

function parseAttrs(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagBody)) !== null) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  return attrs;
}

// Same longest-prefix boundary rule the runtime registry uses to dispatch
// (registry.ts: exact match, or a prefix ending in ':').
function prefixMatches(spec: string, prefix: string): boolean {
  if (spec === prefix) return true;
  if (prefix.endsWith(':') && spec.startsWith(prefix)) return true;
  return false;
}

/** The capabilities that ACTUALLY EXIST right now — the runtime's live
 *  registered sources (IF) / actions (THEN), not a hand-written catalog.
 *  Falls back to the catalog only if the registry isn't loaded yet. */
function registeredPrefixes(side: Side): string[] {
  try {
    const live = side === 'if' ? listIfttSources() : listIfttActions();
    if (live && live.length > 0) return live;
  } catch {
    /* registry unavailable — fall through to catalog */
  }
  return entriesFor(side).map((e) => e.family);
}

/** A single chain step is real iff it prefix-matches a CURRENTLY-REGISTERED
 *  source/action. Grounding guarantee: we trust the live runtime, not the
 *  assistant's claim and not a catalog that can drift. Prefix-level — confirms
 *  a real handler exists for the family; we don't execute the concrete suffix
 *  (dispatching an action has side effects), so that depth is the honest ceiling. */
function stepIsKnown(side: Side, step: string): boolean {
  return registeredPrefixes(side).some((p) => prefixMatches(step, p));
}

/** Parse the <option> tags out of a reply. Each option's capability is a
 *  chain; we keep only the steps that validate live and drop options whose
 *  chain collapses to nothing. Always guarantees one trailing "other",
 *  preserving the assistant's explanation when it gave one. */
export function parseOptions(side: Side, reply: string): Suggestion[] {
  const kind: Suggestion['kind'] = side === 'if' ? 'trigger' : 'action';
  const out: Suggestion[] = [];
  let otherText = '';
  const tagRe = /<option\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = tagRe.exec(reply)) !== null) {
    const a = parseAttrs(m[1]);
    const rawCap = (a.capability || '').trim();
    const text = (a.text || '').trim();
    const chain = parseChain(rawCap);

    const isOther = a.id?.trim() === OTHER_ID || chain.length === 0 || chain.includes(OTHER_ID);
    if (isOther) {
      if (text) otherText = text; // captured; we append a canonical "other" below
      continue;
    }

    // Keep only grounded steps; if the whole chain is invented, drop the option.
    const grounded = chain.filter((s) => stepIsKnown(side, s));
    if (grounded.length === 0) continue;

    out.push({
      id: a.id?.trim() || String.fromCharCode(97 + n),
      capability: grounded,
      text: text || grounded.join(' → '),
      kind,
    });
    n += 1;
  }
  out.push({
    id: OTHER_ID,
    capability: [OTHER_ID],
    text: otherText || 'Something else — let me clarify',
    kind,
  });
  return out;
}

/** Catalog-derived fallback when the model is unavailable or unparseable —
 *  the surface still offers grounded (single-step) options instead of dead-ending. */
export function fallbackSuggestions(side: Side): Suggestion[] {
  const kind: Suggestion['kind'] = side === 'if' ? 'trigger' : 'action';
  const opts: Suggestion[] = entriesFor(side)
    .slice(0, 3)
    .map((e, i) => ({ id: String.fromCharCode(97 + i), capability: [e.example], text: e.label, kind }));
  opts.push({ id: OTHER_ID, capability: [OTHER_ID], text: 'Something else — let me clarify', kind });
  return opts;
}

export async function suggestOptions(side: Side, intent: string, ask: AskFn): Promise<Suggestion[]> {
  const trimmed = intent.trim();
  if (!trimmed) return [];
  let reply = '';
  try {
    reply = await ask(buildPrompt(side, trimmed));
  } catch {
    return fallbackSuggestions(side);
  }
  // Only treat it as model failure when there are NO option tags at all. A
  // reply of just "other" is a LEGITIMATE answer ("nothing composes") and must
  // be honored — falling back to catalog there would bury the honest answer.
  if (!/<option\b/i.test(reply)) return fallbackSuggestions(side);
  return parseOptions(side, reply);
}
