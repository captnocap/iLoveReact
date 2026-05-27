// The grounded menu the assistant routes intent into.
//
// This is the load-bearing idea of the IF/THEN composer: the model is
// NOT drawing a path. It is a *router* into a finite, real space of
// primitives that the runtime actually understands. Every entry here
// corresponds to a live IFTTT source (IF side) or action (THEN side)
// registered under runtime/hooks/ifttt/. If it isn't in this catalog,
// the model may not suggest it — that's what keeps the suggestions
// honest instead of hallucinated.
//
// When a new source/action is registered in runtime/hooks/ifttt/, add
// a matching entry here so the composer can surface it.

export type Side = 'if' | 'then';

export interface CatalogEntry {
  /** Token family — the registry prefix, e.g. 'count:' or 'flag-pathology:'. */
  family: string;
  /** Human label shown to a non-coder. */
  label: string;
  /** A complete, concrete example token the model can pattern-match on. */
  example: string;
  /** One line: what firing/running this means. */
  hint: string;
}

// ── IF side: trigger sources ────────────────────────────────────────────
// Mirrors the registered sources in runtime/hooks/ifttt/{count,match,
// repeat,firsthit,supervisor,permission,vm}.ts.

export const TRIGGERS: CatalogEntry[] = [
  {
    family: 'verb:lifecycle:',
    label: 'A tool call happens',
    example: 'verb:lifecycle::failed',
    hint: 'Fires when the worker invokes a tool — :started, :succeeded, or :failed.',
  },
  {
    family: 'count:',
    label: 'Something happens N times',
    example: 'count:verb:lifecycle::failed:3',
    hint: 'Fires only after an underlying trigger has fired N times.',
  },
  {
    family: 'repeat:',
    label: 'The same thing repeats',
    example: 'repeat:verb:lifecycle::failed',
    hint: 'Fires when an event recurs back-to-back without changing.',
  },
  {
    family: 'match:',
    label: 'A message looks like…',
    example: 'match:apology',
    hint: 'Semantic match — fires when assistant text resembles a phrase.',
  },
  {
    family: 'task:',
    label: 'A plan task changes state',
    example: 'task:.started',
    hint: 'Fires on a sequencer task lifecycle: .started, .done, .failed.',
  },
  {
    family: 'run:',
    label: 'The run changes state',
    example: 'run:.halted',
    hint: 'Fires on whole-run lifecycle events.',
  },
  {
    family: 'worker:',
    label: 'A worker changes state',
    example: 'worker:.spawned',
    hint: 'Fires when a worker is spawned, finishes, or errors.',
  },
  {
    family: 'permission:',
    label: 'A permission is requested',
    example: 'permission:request',
    hint: 'Fires when the agent asks to run a tool that needs approval.',
  },
  {
    family: 'firsthit:',
    label: 'The first time only',
    example: 'firsthit:verb:lifecycle::failed',
    hint: 'Fires once on the first occurrence, then never again this run.',
  },
];

// ── THEN side: actions ──────────────────────────────────────────────────
// Mirrors registerIfttAction(...) in runtime/hooks/ifttt/{supervisor,
// permission}.ts.

export const ACTIONS: CatalogEntry[] = [
  {
    family: 'notify-user:',
    label: 'Tell me',
    example: 'notify-user:worker hit a snag',
    hint: 'Surfaces a message to the user without stopping the run.',
  },
  {
    family: 'halt-run',
    label: 'Stop the run',
    example: 'halt-run',
    hint: 'Hard stop — terminates the run immediately.',
  },
  {
    family: 'kick-to-supervisor',
    label: 'Escalate to supervisor',
    example: 'kick-to-supervisor',
    hint: 'Hands control up so the supervisor decides what to do next.',
  },
  {
    family: 'flag-pathology:',
    label: 'Flag a problem',
    example: 'flag-pathology:stuck_loop',
    hint: 'Marks a named failure mode so the trace and supervisor see it.',
  },
  {
    family: 'inject-message:',
    label: 'Inject a nudge',
    example: 'inject-message:try a different approach',
    hint: 'Drops a message into the worker mid-run to redirect it.',
  },
  {
    family: 'spawn-worker:',
    label: 'Spawn a worker',
    example: 'spawn-worker:reviewer',
    hint: 'Starts a new worker in the given role.',
  },
  {
    family: 'mark-status:',
    label: 'Set status',
    example: 'mark-status:blocked',
    hint: 'Records a status the trace and sequencer can read.',
  },
  {
    family: 'set-variable:',
    label: 'Remember a value',
    example: 'set-variable:retries=0',
    hint: 'Writes a shared variable other rules can read.',
  },
  {
    family: 'invoke-verb:',
    label: 'Run a tool',
    example: 'invoke-verb:read',
    hint: 'Fires a tool invocation directly.',
  },
];

export function entriesFor(side: Side): CatalogEntry[] {
  return side === 'if' ? TRIGGERS : ACTIONS;
}

/** The menu block embedded in the assistant prompt — the finite space
 *  the model is allowed to route into. */
export function catalogPromptBlock(side: Side): string {
  const verb = side === 'if' ? 'TRIGGER (the IF)' : 'ACTION (the THEN)';
  const lines = entriesFor(side).map(
    (e) => `- ${e.family}  →  ${e.label}. ${e.hint}  e.g. "${e.example}"`,
  );
  return `Available ${verb} primitives (the ONLY families you may use):\n${lines.join('\n')}`;
}
