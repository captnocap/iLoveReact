// The composition guide.
//
// This is the knowledge the assistant needs so it treats a user's IF/THEN
// prompt as something to REALIZE THROUGH A CHAIN OF PRIMITIVES — not as a
// single capability to match. Almost no real rule is one trigger → one
// action; the interesting ones are compound, stateful, and chained across
// rules. Without this, the assistant looks for a single matching capability,
// fails to find one for anything sophisticated, and falls to "other". With
// it, the assistant answers "yes — here's the chain."
//
// Each idiom names the REAL primitive that backs it (every primitive named
// here is validated live against the registry in suggest.ts, so the assistant
// can describe a chain but can't fabricate an atom). When an intent genuinely
// needs an atom that doesn't exist yet, the assistant says so via `other`
// rather than faking it — and that surfaces a real "build this primitive"
// signal (e.g. a `handoff:` convenience atom).

export const COMPOSITION_PRINCIPLE =
  'A rule is a CHAIN of primitives glued by shared state — not one trigger and ' +
  'one action. The IF box and THEN box are a facade over that chain. Your job ' +
  'is to compose the smallest chain of REAL primitives that realizes the intent. ' +
  'Assume composition is normal; a single-primitive rule is the rare case.';

// The chaining vocabulary. Each entry: the shape of intent it covers, and the
// concrete primitive(s) it compiles to.
export const CHAIN_IDIOMS: { when: string; chain: string }[] = [
  {
    when: 'Several things must ALL hold before firing (a compound condition).',
    chain:
      'A GATE: registerGate({ after, suspect, requires, …Filter }). `after` opens a ' +
      'window, `suspect` is the candidate event, `requires` is the evidence that ' +
      'cancels it. The *Filter predicates carry the rest of the condition ' +
      '(e.g. "the message words are in the index", "the task is solvable").',
  },
  {
    when: 'The rule needs MEMORY — an index/list it checks against or grows.',
    chain:
      'STATE. Read it on the IF side (a filter consults a state key); write it on ' +
      'the THEN side (state:set: / set-variable:). An "index" is just a state key ' +
      'you append to and match against — use similarity() for fuzzy word/phrase matching.',
  },
  {
    when: 'One rule should trigger because ANOTHER rule produced a result (chaining).',
    chain:
      'Through state, never directly. Rule A\'s THEN does state:set:K = result. Rule ' +
      'B\'s IF is `state:K` changed, with a filter on the value. The two rules share ' +
      'only the key K — that IS the chain.',
  },
  {
    when: 'Part of the work is a JUDGEMENT that needs a fresh worker to evaluate.',
    chain:
      'spawn-worker:<recipe> with the relevant context as its payload; the spawned ' +
      'worker writes its verdict back to a state key (state:set:). Note: handing it ' +
      'the current thread\'s full transcript is read→state→spawn today (composable but ' +
      'manual) — a `handoff:` atom would collapse that to one step.',
  },
  {
    when: 'A stored value should become the text of a prompt/notification.',
    chain:
      'inject-message:{{key}} or notify-user:{{key}} — substituteAction interpolates ' +
      'state/payload into the text. This is how a stored evaluation gets reused ' +
      'verbatim as the re-prompt that pushes a worker to continue.',
  },
];

// Worked example — a full compound intent decomposed into its chain. This is
// the shape of reasoning the assistant should imitate: read the intent, name
// the chain, ground every step in a real primitive.
export const WORKED_EXAMPLES: { intent: string; chain: string[] }[] = [
  {
    intent:
      'When a worker stops early on a task that has a clear solution and its parting ' +
      'words match a known index, judge whether stopping was warranted and remember ' +
      'the judgement; later, if that judgement was bogus, push the worker to continue.',
    chain: [
      'GATE  after=task:.started  suspect=worker:.stopped  requires=task:.done',
      '  suspectFilter: parting words ∈ state:index/stop_words  AND  task is solvable',
      'on fire → spawn-worker:evaluator  (payload = thread context)',
      '  evaluator writes → state:set:stop_eval = { warranted, reason }   // grows the index',
      'SECOND RULE — IF state:stop_eval changed  (filter: !warranted)',
      '  THEN inject-message:{{stop_eval.reason}}   // reuse the judgement as the re-prompt',
    ],
  },
];

/** The block embedded into the assistant prompt (suggest.ts) so it composes
 *  chains instead of matching single tokens. */
export function compositionGuide(): string {
  const idioms = CHAIN_IDIOMS.map((i) => `• ${i.when}\n    → ${i.chain}`).join('\n');
  const examples = WORKED_EXAMPLES.map(
    (e) => `INTENT: ${e.intent}\nCHAIN:\n${e.chain.map((s) => '  ' + s).join('\n')}`,
  ).join('\n\n');
  return [
    COMPOSITION_PRINCIPLE,
    '',
    'How primitives chain (the vocabulary you compose with):',
    idioms,
    '',
    'Worked example — decompose intent into a grounded chain like this:',
    examples,
  ].join('\n');
}
