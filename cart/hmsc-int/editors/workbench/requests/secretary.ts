// editors/workbench/requests/secretary.ts — the SECRETARY's headless half
// (REQSEC-0607). USER ASK, verbatim: "we can use the useAssistant hook and
// hit a model who can evaluate and categorize and all that jazz. since the
// mix of them is a shit show. something like tags or whatever, that way can
// search by tag or etc. and if model doesnt know they dont do nada. but
// would keep it far more organized and can do it for free effectively and
// that way, we keep the hook on all the same, nothing changes, we just have
// a secretary".
//
// The contract, in laws:
//   • organization ONLY — the secretary proposes tags; it never touches
//     states, resolutions, or the user-only done gate (tagRequest can't).
//   • unsure → nada — entries the model omits (or answers garbage for) stay
//     byte-untouched; a junk reply parses to {} and nothing happens.
//   • never blocks — capture is the hook's (separate process); tagging is a
//     user-armed async run in the workbench. Model unavailable → everything
//     keeps working untagged.
//
// This file is pure protocol (prompt build + reply parse + batch pick) so
// the P4 suite covers it without React; SecretaryBar.tsx owns the
// useAssistant wiring.

import {
  DEFAULT_LEDGER_CONFIG, SECRETARY_PROMPT_PREFIX, SEED_TAGS, normalizeTags,
  type RequestRecord,
} from '../../../../../docs/game/_index/requests';

/** entries per run — one model turn, bounded prompt */
export const SECRETARY_BATCH = 12;
const ENTRY_CHARS = 400;

/** Machine-captured junk (a worker prompt that slipped into the ledger
 *  before the machinePrefixes capture gate existed) is never worth a model
 *  turn — and feeding the secretary its OWN prompt is the feedback loop the
 *  gate kills. Defense in depth on the read side. */
function isMachineEcho(record: RequestRecord): boolean {
  return DEFAULT_LEDGER_CONFIG.machinePrefixes.some((prefix) => record.text.trim().startsWith(prefix));
}

/** The untagged queue, oldest first — what the next run will categorize. */
export function untaggedEntries(records: RequestRecord[], cap = SECRETARY_BATCH): RequestRecord[] {
  return records.filter((record) => (record.tags ?? []).length === 0 && !isMachineEcho(record)).slice(0, cap);
}

/** The next batch of a multi-batch run: untagged AND not yet attempted this
 *  run. A run keeps batching until this comes back empty — `attempted` is
 *  what stops an entry the model stays unsure about from re-queueing forever
 *  (it stays untouched, exactly the nada contract; a later run may retry). */
export function nextBatch(records: RequestRecord[], attempted: Set<string>, cap = SECRETARY_BATCH): RequestRecord[] {
  return untaggedEntries(records.filter((record) => !attempted.has(record.id)), cap);
}

/** One model turn: strict JSON-only contract, omit-when-unsure spelled out. */
export function buildSecretaryPrompt(entries: RequestRecord[]): string {
  const lines = entries.map((record) => {
    const flat = record.text.replace(/\s+/g, ' ').trim();
    return `${record.id}: ${flat.length > ENTRY_CHARS ? `${flat.slice(0, ENTRY_CHARS)}…` : flat}`;
  });
  return [
    // the first line IS the capture gate's sentinel (SECRETARY_PROMPT_PREFIX,
    // shared constant — never reword one without the other): the repo's
    // UserPromptSubmit hook skips machinePrefixes prompts, which is what
    // keeps this very prompt out of the ledger it is organizing
    `${SECRETARY_PROMPT_PREFIX} Categorize each entry below with short`,
    `lowercase kebab-case tags. Seed vocabulary: ${SEED_TAGS.join(', ')} — extend it`,
    'only when an entry clearly needs a tag the seeds lack.',
    'If you are NOT confident about an entry, OMIT it entirely — no guesses.',
    'Reply with ONE JSON object mapping entry id to an array of tags, and NOTHING',
    'else — no prose, no code fences. Example: {"req_0003": ["bug", "ux"]}',
    '',
    'ENTRIES:',
    ...lines,
  ].join('\n');
}

/** Parse the model's reply into id → tags. Defensive at every step — prose
 *  around the JSON is tolerated, anything malformed yields {} (nada). Only
 *  ids that were actually in the batch survive; tags normalize through the
 *  ledger's own rule. */
export function parseSecretaryReply(text: string, batchIds: string[]): Record<string, string[]> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string[]> = {};
  for (const [id, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!batchIds.includes(id)) continue;        // the model invented an id → nada
    const tags = normalizeTags(raw);
    if (tags.length > 0) out[id] = tags;         // junk-only values → omitted
  }
  return out;
}
