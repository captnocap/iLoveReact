// oracle — the decision lookup every LLM calls FIRST, before grep/bash/ideas.
//
//   tools/oracle "which humanoid system"
//   tools/oracle "player height"
//   tools/oracle camera aim
//
// Searches four tiers, in authority order:
//   1. RULINGS    — the user's decisions (decisions.ts / DECISIONS.md). These
//                   override everything; competing ideas in code are history.
//   2. REQUESTS   — the request ledger (requests.ts / docs/game/_requests/):
//                   the user's asks, verbatim, with their resolutions + SHAs.
//   3. RECORDS    — the typed index over the 33-doc corpus (interfaces,
//                   patterns), with live/lab/dormant/deprecated status.
//   4. HAZARDS    — the traps: naming lies, drift, footguns.
//
// Output is compact, ranked, and source-cited so the caller can go deeper
// (DECISIONS.md / docs/game/<doc>.md) only when needed.

import { DECISIONS, type Decision } from './decisions';
import { loadRequests, type RequestRecord } from './requests';
import {
  ALL_INTERFACES, ALL_PATTERNS, ALL_HAZARDS,
  type OwnedInterface, type OwnedPattern, type OwnedHazard,
} from './index';

// ── scoring ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'we', 'our', 'us',
  'which', 'what', 'who', 'how', 'should', 'would', 'could', 'can', 'do', 'does',
  'use', 'uses', 'using', 'used', 'to', 'for', 'of', 'in', 'on', 'it', 'its',
  'this', 'that', 'and', 'or', 'not', 'with', 'about', 'best', 'right', 'correct',
]);

export function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Corpus-frequency damping: a query word that appears in a third of all items
// ("system", "game", "host"...) carries little signal; rare words carry a lot.
let g_df: Map<string, number> | null = null;
let g_dfTotal = 0;

function dampFor(token: string): number {
  if (!g_df) return 1;
  const df = g_df.get(token) ?? 0;
  // "system"/"game"/"host"-grade words appear in a big slice of the corpus and
  // carry near-zero signal; rare words ("humanoid", "crosswalk") carry it all.
  return df > g_dfTotal / 6 ? 0.15 : df > g_dfTotal / 25 ? 0.45 : 1;
}

function buildDf(corpora: { texts: string[] }[]): void {
  g_df = new Map();
  g_dfTotal = 0;
  for (const c of corpora) {
    for (const text of c.texts) {
      g_dfTotal += 1;
      const seen = new Set(tokenize(text));
      for (const t of seen) g_df.set(t, (g_df.get(t) ?? 0) + 1);
    }
  }
}

/** Per-token fuzzy hit: exact token > prefix > substring. */
function tokenScore(token: string, haystackTokens: string[], haystackJoined: string): number {
  let best = 0;
  for (const h of haystackTokens) {
    if (h === token) { best = Math.max(best, 3); break; }
    if (h.startsWith(token) || token.startsWith(h)) best = Math.max(best, 2);
  }
  if (best === 0 && haystackJoined.includes(token)) best = 1;
  return best;
}

type Scored<T> = { item: T; score: number };

function scoreText(queryTokens: string[], fields: { text: string; weight: number }[]): number {
  let total = 0;
  const matched = new Set<string>();
  for (const f of fields) {
    const toks = tokenize(f.text);
    const joined = f.text.toLowerCase();
    for (const q of queryTokens) {
      const s = tokenScore(q, toks, joined);
      if (s > 0) matched.add(q);
      total += s * f.weight * dampFor(q);
    }
  }
  // Coverage: an item matching ONE of three query words shouldn't outrank an
  // item matching all three just by repeating its one word across fields.
  return total * (matched.size / queryTokens.length);
}

function rank<T>(items: T[], queryTokens: string[], fieldsOf: (item: T) => { text: string; weight: number }[], minScore: number): Scored<T>[] {
  const out: Scored<T>[] = [];
  for (const item of items) {
    const score = scoreText(queryTokens, fieldsOf(item));
    if (score >= minScore) out.push({ item, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ── search ───────────────────────────────────────────────────────────────────

export function searchDecisions(queryTokens: string[]): Scored<Decision>[] {
  return rank(DECISIONS, queryTokens, (d) => [
    { text: d.name, weight: 3 },
    { text: d.keywords.join(' '), weight: 3 },
    { text: d.ruling, weight: 1 },
    { text: d.detail ?? '', weight: 1 },
    { text: (d.retires ?? []).join(' '), weight: 1 },
    { text: (d.cites ?? []).join(' '), weight: 1 },
  ], 3);
}

/** The ledger is runtime data, not bundled — callers pass the loaded list
 *  (oracle() loads the real one; tests pass fabricated records). */
export function searchRequests(queryTokens: string[], requests: RequestRecord[]): Scored<RequestRecord>[] {
  return rank(requests, queryTokens, (r) => [
    { text: r.text, weight: 3 },
    { text: r.resolution ?? '', weight: 1 },
    { text: `${r.id} ${r.origin}`, weight: 1 },
  ], 3);
}

export function searchInterfaces(queryTokens: string[]): Scored<OwnedInterface>[] {
  return rank(ALL_INTERFACES, queryTokens, (i) => [
    { text: i.name, weight: 3 },
    { text: i.purpose.join(' '), weight: 2 },
    { text: i.description, weight: 1 },
    { text: `${i.sourceFile ?? ''} ${i.codeRef ?? ''} ${i.doc}`, weight: 1 },
  ], 3);
}

export function searchPatterns(queryTokens: string[]): Scored<OwnedPattern>[] {
  return rank(ALL_PATTERNS, queryTokens, (p) => [
    { text: p.name, weight: 3 },
    { text: p.purpose.join(' '), weight: 2 },
    { text: p.description, weight: 1 },
    { text: p.promoteTo ?? '', weight: 2 },
  ], 3);
}

export function searchHazards(queryTokens: string[]): Scored<OwnedHazard>[] {
  return rank(ALL_HAZARDS, queryTokens, (h) => [
    { text: h.name, weight: 3 },
    { text: h.purpose.join(' '), weight: 2 },
    { text: h.description, weight: 1 },
    { text: h.evidence.join(' '), weight: 1 },
  ], 3);
}

// ── report ───────────────────────────────────────────────────────────────────

const RULE_CAP = 4;
const REQ_CAP = 4;
const REC_CAP = 8;
const PAT_CAP = 4;
const HAZ_CAP = 5;

/** Damped scores get float-noisy — one decimal is plenty for a rank label. */
function fmtScore(s: number): string {
  return String(Math.round(s * 10) / 10);
}

function decisionBlock(d: Decision, score: number): string {
  const amended = d.amendedBy?.length ? ` ⚠ AMENDED by ${d.amendedBy.join(', ')}` : '';
  const lines = [`[${d.id} · ${d.status.toUpperCase()}${amended} · ${fmtScore(score)}] ${d.name}`, `  ${d.ruling}`];
  if (d.amendedBy?.length) lines.push(`  ⚠ Read ${d.amendedBy.join(', ')} before acting on this ruling — part of it is overruled.`);
  if (d.amends?.length) lines.push(`  amends: ${d.amends.join(', ')}`);
  if (d.detail) lines.push(`  ${d.detail}`);
  if (d.retires?.length) lines.push(`  retires: ${d.retires.join('; ')}`);
  if (d.cites?.length) lines.push(`  files: ${d.cites.join(' · ')}`);
  return lines.join('\n');
}

// ── era awareness (V32 SURFACE-0705) ─────────────────────────────────────────
//
// The corpus was written in the hmsc-int era; the going-forward build surface
// is cart/editor/. Previous-era records stay served (reference is welcome)
// but must READ as reference, not as "build here" — the banner says it once
// per query, the per-record flag says it at the pointer.

const ACTIVE_SURFACE_BANNER =
  'ACTIVE SURFACE (V32 SURFACE-0705): going-forward work lives in cart/editor/ (+ its /play route). ' +
  'cart/hmsc-int/ and the labs are the PREVIOUS ERA — pointers into them are reference ("how the last era did it"), never the build site. ' +
  'Game-design RULINGS below still stand regardless of era.';

const PREV_ERA_RE = /hmsc/i;

/** Flag a record whose pointers land in the previous era. */
function eraFlag(i: OwnedInterface): string {
  return PREV_ERA_RE.test(`${i.sourceFile ?? ''} ${i.codeRef ?? ''} ${i.doc}`)
    ? ' · hmsc era — build in cart/editor (V32)'
    : '';
}

/** A record's status can be overridden by a ruling — say so inline. */
function retiredBy(i: OwnedInterface): string | null {
  const hay = `${i.name} ${i.sourceFile ?? ''} ${i.doc}`.toLowerCase();
  for (const d of DECISIONS) {
    for (const r of d.retires ?? []) {
      const needle = r.toLowerCase();
      // match on any meaningful fragment of the retire entry
      const frag = needle.split(/[\s(]/)[0];
      if (frag.length > 4 && hay.includes(frag.replace(/^cart\//, '').replace(/\/$/, ''))) {
        return d.id;
      }
    }
  }
  return null;
}

function requestLine(r: RequestRecord, score: number): string {
  const ask = r.text.length > 220 ? `${r.text.slice(0, 220)}…` : r.text;
  const lines = [
    `[${r.id} · ${r.status.toUpperCase()} · ${fmtScore(score)}] ${r.at.slice(0, 10)} · ${r.origin}`,
    `  "${ask.replace(/\n/g, ' ')}"`,
  ];
  if (r.resolution) lines.push(`  resolution: ${r.resolution.length > 200 ? `${r.resolution.slice(0, 200)}…` : r.resolution}`);
  // resolution fields fill at doing→review; done is acceptance only (REQBOARD-0607)
  if (r.resolution !== undefined) lines.push(`  commits: ${r.shas && r.shas.length > 0 ? r.shas.join(' ') : '(none — no-code resolution)'}`);
  return lines.join('\n');
}

function interfaceLine(i: OwnedInterface, score: number): string {
  const where = i.codeRef ?? i.sourceFile ?? '';
  const retired = retiredBy(i);
  const status = retired ? `${i.status} ⚠ RETIRED by ${retired}` : i.status;
  return `[${status} · ${fmtScore(score)}] ${i.name} (${i.doc})${where ? ` — ${where}` : ''}${eraFlag(i)}\n  ${i.description.slice(0, 200)}`;
}

function patternLine(p: OwnedPattern, score: number): string {
  const promote = p.promoteTo ? ` → promote to: ${p.promoteTo}` : '';
  return `[${p.status} · ${fmtScore(score)}] ${p.name} (seen in: ${p.examples.slice(0, 6).join(', ')})${promote}\n  ${p.description.slice(0, 180)}`;
}

function hazardLine(h: OwnedHazard, score: number): string {
  return `[${h.severity.toUpperCase()} · ${fmtScore(score)}] ${h.name} (${h.doc})\n  ${h.description.slice(0, 200)}${h.fix ? `\n  fix: ${h.fix.slice(0, 150)}` : ''}`;
}

export function oracle(query: string): string {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 'usage: tools/oracle "<query>"  (e.g. tools/oracle "which humanoid", tools/oracle "player height")';
  }

  // The ledger is data on disk, not bundled — a corrupt entry shouldn't take
  // every oracle query down, but it must be SAID, not swallowed.
  let requests: RequestRecord[] = [];
  let ledgerWarning: string | null = null;
  try {
    requests = loadRequests();
  } catch (error: any) {
    ledgerWarning = `⚠ request ledger unreadable: ${error?.message ?? String(error)}`;
  }

  buildDf([
    { texts: DECISIONS.map((d) => `${d.name} ${d.keywords.join(' ')} ${d.ruling}`) },
    { texts: requests.map((r) => `${r.text} ${r.resolution ?? ''}`) },
    { texts: ALL_INTERFACES.map((i) => `${i.name} ${i.purpose.join(' ')} ${i.description}`) },
    { texts: ALL_PATTERNS.map((p) => `${p.name} ${p.description}`) },
    { texts: ALL_HAZARDS.map((h) => `${h.name} ${h.description}`) },
  ]);

  const rulings = searchDecisions(queryTokens).slice(0, RULE_CAP);
  const asks = searchRequests(queryTokens, requests).slice(0, REQ_CAP);
  const records = searchInterfaces(queryTokens).slice(0, REC_CAP);
  const patterns = searchPatterns(queryTokens).slice(0, PAT_CAP);
  const hazards = searchHazards(queryTokens).slice(0, HAZ_CAP);

  const out: string[] = [];
  out.push(`oracle: "${query}"`);
  out.push(ACTIVE_SURFACE_BANNER);
  if (ledgerWarning) out.push(ledgerWarning);

  if (rulings.length > 0) {
    out.push('', '═══ RULINGS — the user\'s decisions. These OVERRIDE all code/ideas below. ═══');
    for (const r of rulings) out.push('', decisionBlock(r.item, r.score));
  } else {
    out.push('', '═══ RULINGS ═══', '(no ruling matches — this area may be UNDECIDED; check DECISIONS.md open/show-me items before inventing an approach)');
  }

  if (asks.length > 0) {
    out.push('', '─── REQUEST LEDGER (user asks, verbatim → resolutions · tools/request) ───');
    for (const a of asks) out.push(requestLine(a.item, a.score));
  }

  if (records.length > 0) {
    out.push('', '─── INDEX RECORDS (status: live > lab > candidate > deprecated/dormant) ───');
    for (const r of records) out.push(interfaceLine(r.item, r.score));
  }

  if (patterns.length > 0) {
    out.push('', '─── PATTERNS ───');
    for (const p of patterns) out.push(patternLine(p.item, p.score));
  }

  if (hazards.length > 0) {
    out.push('', '─── HAZARDS (traps for agents) ───');
    for (const h of hazards) out.push(hazardLine(h.item, h.score));
  }

  out.push('', 'sources: docs/game/DECISIONS.md · docs/game/<doc>.md · docs/game/_index/ · docs/game/_requests/');
  return out.join('\n');
}

// CLI entry: oracleCli.ts (tools/oracle bundles that, not this). Keeping this
// module side-effect-free lets requests.test.ts import searchRequests/tokenize
// without firing a query.
