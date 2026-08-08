// editor/agent/seatTelemetry.ts — the structured record of how agents actually fare.
//
// The oracle already generates this data; it was simply not being kept. Every refusal is
// a labelled observation: WHICH criterion failed, on WHICH phase, and how many attempts
// it took to clear. Aggregated, that tells you something no amount of reading the docs
// can — a check that takes four attempts on average across sessions is either badly
// specified or missing a supporting verb, exactly like the python escapes were.
//
// This is the corpus's telemetry half, and it obeys the corpus rules: append-only,
// measured, never mixed with the disposable per-model notes. It records what the editor
// can honestly observe about its own gates — not guesses about intent.

export type SeatTelemetryRow = {
  at: string;
  session: string;
  model: string | null;
  plan: string;
  classId: string | null;
  phase: string;
  event: 'start' | 'advance' | 'refused' | 'attest' | 'stop' | 'outcome';
  /** On `refused`: which criteria were unmet. On `advance`: what had to pass. */
  checks?: string[];
  /** How many refusals this phase had absorbed before this row. */
  attempt?: number;
  /** On `outcome`: the human verdict and the measured shape it applies to. */
  outcome?: { verdict: 'approved' | 'rejected'; reason?: string; triangles: number; unnamed: number; unreachableFaces: number | null };
};

export function telemetryRow(row: SeatTelemetryRow): string {
  return JSON.stringify(row);
}

export function parseTelemetry(text: string): SeatTelemetryRow[] {
  const rows: SeatTelemetryRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as SeatTelemetryRow;
      if (row && typeof row.event === 'string' && typeof row.phase === 'string') rows.push(row);
    } catch { /* a torn append is one lost row, never a lost corpus */ }
  }
  return rows;
}

export type CheckDifficulty = {
  id: string;
  refusals: number;
  /** Distinct sessions that hit this refusal at least once. */
  sessions: number;
  /** Mean refusals per session that hit it — the "four attempts to pass" signal. */
  attemptsPerSession: number;
};

export type PhaseDifficulty = { phase: string; refusals: number; sessions: number };

export type TelemetrySummary = {
  rows: number;
  sessions: number;
  /** Hardest first — the queue of checks worth re-specifying or supporting with a verb. */
  checks: CheckDifficulty[];
  phases: PhaseDifficulty[];
  outcomes: { approved: number; rejected: number; reasons: string[] };
};

export function summarizeTelemetry(rows: readonly SeatTelemetryRow[]): TelemetrySummary {
  const bySession = new Map<string, Map<string, number>>();
  const phaseRefusals = new Map<string, { refusals: number; sessions: Set<string> }>();
  const outcomes = { approved: 0, rejected: 0, reasons: [] as string[] };
  const sessions = new Set<string>();

  for (const row of rows) {
    sessions.add(row.session);
    if (row.event === 'refused') {
      const seen = bySession.get(row.session) ?? new Map<string, number>();
      for (const id of row.checks ?? []) seen.set(id, (seen.get(id) ?? 0) + 1);
      bySession.set(row.session, seen);
      const phase = phaseRefusals.get(row.phase) ?? { refusals: 0, sessions: new Set<string>() };
      phase.refusals += 1;
      phase.sessions.add(row.session);
      phaseRefusals.set(row.phase, phase);
    }
    if (row.event === 'outcome' && row.outcome) {
      if (row.outcome.verdict === 'approved') outcomes.approved += 1;
      else {
        outcomes.rejected += 1;
        // Rejections with reasons are the most valuable rows in the store: each one is
        // a candidate check that does not exist yet.
        if (row.outcome.reason) outcomes.reasons.push(row.outcome.reason);
      }
    }
  }

  const tally = new Map<string, { refusals: number; sessions: number }>();
  for (const seen of bySession.values()) {
    for (const [id, count] of seen) {
      const row = tally.get(id) ?? { refusals: 0, sessions: 0 };
      row.refusals += count;
      row.sessions += 1;
      tally.set(id, row);
    }
  }

  return {
    rows: rows.length,
    sessions: sessions.size,
    checks: [...tally.entries()]
      .map(([id, row]) => ({ id, refusals: row.refusals, sessions: row.sessions, attemptsPerSession: row.refusals / row.sessions }))
      .sort((a, b) => b.attemptsPerSession - a.attemptsPerSession || b.refusals - a.refusals),
    phases: [...phaseRefusals.entries()]
      .map(([phase, row]) => ({ phase, refusals: row.refusals, sessions: row.sessions.size }))
      .sort((a, b) => b.refusals - a.refusals),
    outcomes,
  };
}
