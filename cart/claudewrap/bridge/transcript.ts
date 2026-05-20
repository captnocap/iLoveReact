// Transcript scraping — identify the Claude Code session our HTTP
// request activated, then read the new JSONL entries it wrote to
// detect when the assistant turn ended (stop_reason==end_turn).
//
// Pipeline:
//   1. Snapshot session pings before writing to the PTY.
//   2. Send the prompt + directive.
//   3. Find the session whose ping advanced past its snapshot value —
//      that's the one our prompt activated.
//   4. Lock to that session's transcript file. Read its delta against
//      the pre-prompt size baseline.
//   5. Parse new JSONL lines; when end_turn arrives, return the text.
//
// Direct extraction from cart/claude_openai_bridge_tui.tsx.

import { listDir, readFile, stat } from '../../../runtime/hooks/fs';
import { claudeProjectDir, execOut, runtimeDir, shellQuote } from './common';
import type { BridgeTrace, PendingCompletion, TurnParseResult, SessionHookRow } from './types';

// ── Stat parsing ────────────────────────────────────────────────────

function parseStatLine(line: string): { mtimeMs: number; size: number; path: string } | null {
  const m = line.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s+(.+)$/);
  if (!m) return null;
  return {
    mtimeMs: Math.floor(Number(m[1]) * 1000),
    size: Number(m[2]),
    path: m[3],
  };
}

function shellTranscriptStats(dir: string): Array<{ mtimeMs: number; size: number; path: string }> {
  const out = execOut(`find ${shellQuote(dir)} -maxdepth 1 -name '*.jsonl' -type f -printf '%T@ %s %p\\n' 2>/dev/null | sort -nr | head -20`);
  return out.split('\n').map(parseStatLine).filter((x): x is { mtimeMs: number; size: number; path: string } => !!x);
}

function shellTranscriptPrefixStats(dir: string, prefix: string): Array<{ mtimeMs: number; size: number; path: string }> {
  if (!prefix) return [];
  const out = execOut(`find ${shellQuote(dir)} -maxdepth 1 -name ${shellQuote(`${prefix}*.jsonl`)} -type f -printf '%T@ %s %p\\n' 2>/dev/null | sort -nr | head -20`);
  return out.split('\n').map(parseStatLine).filter((x): x is { mtimeMs: number; size: number; path: string } => !!x);
}

function fsTranscriptStats(dir: string): Array<{ mtimeMs: number; size: number; path: string }> {
  return listDir(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const path = `${dir}/${name}`;
      const st = stat(path);
      return { path, mtimeMs: st?.mtimeMs ?? 0, size: st?.size ?? 0 };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// ── Session hook polling ────────────────────────────────────────────
//
// .claude/hooks/session-ping.sh writes one JSON per live Claude Code
// session to /run/user/$UID/claude-sessions/reactjit/<full-sid>.json.
// The full SID lets us compute the exact JSONL path:
// {projectDir}/<sid>.jsonl. Polling these files is how we identify
// the session our prompt just activated.

export function readSessionHookRows(): SessionHookRow[] {
  const dir = `${runtimeDir()}/claude-sessions/reactjit`;
  const rows: SessionHookRow[] = [];
  for (const name of listDir(dir)) {
    if (!name.endsWith('.json')) continue;
    if (name.startsWith('.')) continue; // skip atomic-rename tmp files
    const raw = readFile(`${dir}/${name}`) ?? '';
    if (!raw) continue;
    try {
      const row = JSON.parse(raw);
      const sid = String(row?.sid ?? '');
      if (!sid) continue;
      const transcriptPath = `${claudeProjectDir()}/${sid}.jsonl`;
      const st = stat(transcriptPath);
      rows.push({
        sid,
        short: String(row?.short ?? sid.slice(0, 4)).toLowerCase(),
        pingMs: Number(row?.ping ?? 0) * 1000,
        status: String(row?.status ?? ''),
        transcriptPath,
        transcriptSize: st?.size ?? 0,
        transcriptMtimeMs: st?.mtimeMs ?? 0,
      });
    } catch {
      // Malformed hook file; ignore. /transcripts surfaces raw state.
    }
  }
  return rows.sort((a, b) => b.pingMs - a.pingMs);
}

export function snapshotSessionPings(): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of readSessionHookRows()) out.set(row.sid, row.pingMs);
  return out;
}

// Pick the session our prompt most likely activated:
//   1. If a snapshot is provided, prefer any session whose ping
//      advanced past the snapshot value.
//   2. Otherwise, the most-recently-pinged session.
export function pickActiveSession(snapshot?: Map<string, number>): SessionHookRow | null {
  const rows = readSessionHookRows();
  if (rows.length === 0) return null;
  if (snapshot) {
    for (const row of rows) {
      const prev = snapshot.get(row.sid) ?? 0;
      if (row.pingMs > prev) return row;
    }
  }
  return rows[0];
}

function sessionAwarenessStats(_prefix?: string): Array<{ mtimeMs: number; size: number; path: string; sid: string }> {
  return readSessionHookRows().map((row) => ({
    sid: row.sid,
    path: row.transcriptPath,
    mtimeMs: row.transcriptMtimeMs || row.pingMs,
    size: row.transcriptSize,
  }));
}

export function transcriptStats(prefix = ''): Array<{ mtimeMs: number; size: number; path: string; source: string; sid?: string }> {
  const abs = claudeProjectDir();
  const rel = abs.startsWith('/') ? abs.slice(1) : abs;
  const sources = [
    { name: 'hook-session-exact', rows: sessionAwarenessStats(prefix) },
    { name: 'fs-relative', rows: fsTranscriptStats(rel) },
    { name: 'fs-absolute', rows: fsTranscriptStats(abs) },
    { name: 'shell-prefix-absolute', rows: shellTranscriptPrefixStats(abs, prefix) },
    { name: 'shell-absolute', rows: shellTranscriptStats(abs) },
  ];
  const seen = new Set<string>();
  const out: Array<{ mtimeMs: number; size: number; path: string; source: string; sid?: string }> = [];
  for (const source of sources) {
    for (const row of source.rows) {
      if (seen.has(row.path)) continue;
      seen.add(row.path);
      out.push({ ...row, source: source.name });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function latestTranscript(prefix = ''): { path: string; size: number } | null {
  const row = transcriptStats(prefix)[0];
  if (!row) return null;
  return { path: row.path, size: row.size };
}

export function describeCandidates(prefix = ''): Array<Record<string, any>> {
  return transcriptStats(prefix).slice(0, 8);
}

// ── Turn parsing ────────────────────────────────────────────────────

function textFromClaudeContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text ?? ''))
    .join('');
}

// Claude Code splits a single API turn into multiple JSONL lines —
// one per content block (thinking / text / tool_use), but every line
// for the same API call shares `message.id` AND `message.stop_reason`.
// A turn is "done" only when stop_reason === 'end_turn'; tool-using
// turns chain multiple API calls (each with stop_reason 'tool_use')
// until a final 'end_turn' arrives. We must wait for that signal, not
// the first text we see.
export function parseAssistantTurn(raw: string, startMs: number): TurnParseResult {
  const textByMsg = new Map<string, string>();
  const stopReasonByMsg = new Map<string, string>();
  const msgIdOrder: string[] = [];
  let sawUser = false;
  let newAssistantEntries = 0;
  let newUserEntries = 0;
  let lastStopReason = '';

  // Tight filter: only entries with timestamp >= startMs - 2s. This is
  // the single signal that an entry belongs to OUR turn. Previously we
  // also required seeing a "user" entry before counting assistant
  // entries, but that broke when the file got rewritten (size dipping
  // then growing back) — timestamp alone is enough.
  const tsFloor = startMs - 2000;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }
    const t = entry?.type;
    if (t !== 'assistant' && t !== 'user') continue;
    const ts = Date.parse(String(entry.timestamp ?? ''));
    if (Number.isFinite(ts) && ts < tsFloor) continue;

    if (t === 'user') {
      sawUser = true;
      newUserEntries++;
      continue;
    }

    newAssistantEntries++;
    const msgId = String(entry.message?.id ?? '');
    if (!msgId) continue;
    if (!stopReasonByMsg.has(msgId)) msgIdOrder.push(msgId);

    const stopReason = String(entry.message?.stop_reason ?? '');
    if (stopReason) {
      stopReasonByMsg.set(msgId, stopReason);
      lastStopReason = stopReason;
    }
    const text = textFromClaudeContent(entry.message?.content).trim();
    if (text) {
      const prev = textByMsg.get(msgId) ?? '';
      textByMsg.set(msgId, prev ? `${prev}\n${text}` : text);
    }
  }

  // Walk msgIds in append order — the LAST one that ended the turn is
  // the final assistant message of this exchange.
  let endedMsgId = '';
  for (const msgId of msgIdOrder) {
    if (stopReasonByMsg.get(msgId) === 'end_turn') endedMsgId = msgId;
  }
  if (endedMsgId) {
    return {
      complete: true,
      text: textByMsg.get(endedMsgId) ?? '',
      sawUser,
      endedMsgId,
      lastStopReason,
      newAssistantEntries,
      newUserEntries,
    };
  }
  // Incomplete: report current best-effort text but signal not-yet-done
  // so the poller keeps waiting.
  let partialText = '';
  for (const msgId of msgIdOrder) partialText = textByMsg.get(msgId) ?? partialText;
  return {
    complete: false,
    text: partialText,
    sawUser,
    endedMsgId: '',
    lastStopReason,
    newAssistantEntries,
    newUserEntries,
  };
}

function readTranscriptDelta(path: string, offset: number): string {
  let raw = readFile(path) ?? '';
  if (!raw) raw = execOut(`cat ${shellQuote(path)} 2>/dev/null`);
  if (offset > 0 && offset < raw.length) return raw.slice(offset);
  return raw;
}

// ── Locked-session resolver ─────────────────────────────────────────

export function resolveLockedPath(pending: PendingCompletion, trace?: BridgeTrace): string {
  if (pending.lockedPath) return pending.lockedPath;
  const activated = pickActiveSession(pending.sessionSnapshot);
  if (!activated) return '';
  pending.lockedSid = activated.sid;
  pending.lockedPath = activated.transcriptPath;
  // If we never captured a baseline (no transcript existed at request
  // time), fix it now to the activated session's start-of-turn size.
  if (!pending.baseline) {
    pending.baseline = { path: activated.transcriptPath, size: activated.transcriptSize };
  } else if (pending.baseline.path !== activated.transcriptPath) {
    pending.baseline = { path: activated.transcriptPath, size: activated.transcriptSize };
  }
  trace?.events.push({
    at: Date.now(),
    phase: 'session-lock',
    sid: activated.sid,
    short: activated.short,
    pingMs: activated.pingMs,
    transcriptPath: activated.transcriptPath,
    baselineSize: pending.baseline?.size ?? 0,
  });
  return pending.lockedPath;
}

export function scanPathForReply(
  path: string,
  baseline: { path: string; size: number } | null,
  startMs: number,
  trace: BridgeTrace | undefined,
  source: string,
): { complete: boolean; text: string; partial: string } {
  const offset = baseline?.path === path ? baseline.size : 0;
  const raw = readTranscriptDelta(path, offset);
  const result = parseAssistantTurn(raw, startMs);
  trace?.events.push({
    at: Date.now(),
    phase: 'scan-file',
    source,
    path,
    offset,
    rawLength: raw.length,
    complete: result.complete,
    sawUser: result.sawUser,
    lastStopReason: result.lastStopReason,
    newUserEntries: result.newUserEntries,
    newAssistantEntries: result.newAssistantEntries,
    textPreview: result.text.slice(0, 80),
  });
  return { complete: result.complete, text: result.text, partial: result.text };
}

export function findClaudeTranscriptReply(
  pending: PendingCompletion,
): { complete: boolean; text: string } {
  const { startMs, trace } = pending;
  const lockedPath = resolveLockedPath(pending, trace);

  // Primary path: the session our prompt activated.
  if (lockedPath) {
    const r = scanPathForReply(lockedPath, pending.baseline, startMs, trace, 'locked-session');
    if (r.complete) {
      trace.resolvedBy = `transcript:${lockedPath}`;
      return { complete: true, text: r.text };
    }
    return { complete: false, text: r.partial };
  }

  // Fallback: no hook file yet. Scan the top few by mtime.
  const stats = transcriptStats('').slice(0, 3);
  trace?.events.push({
    at: Date.now(),
    phase: 'scan-fallback',
    candidateCount: stats.length,
    candidates: stats,
  });
  let bestPartial = '';
  for (const row of stats) {
    const r = scanPathForReply(row.path, pending.baseline, startMs, trace, 'fallback-mtime');
    if (r.complete) {
      trace.resolvedBy = `transcript:${row.path}`;
      return { complete: true, text: r.text };
    }
    if (!bestPartial && r.partial) bestPartial = r.partial;
  }
  return { complete: false, text: bestPartial };
}

export function transcriptDiagnostics(): any {
  const abs = claudeProjectDir();
  const hookRows = readSessionHookRows();
  const picked = pickActiveSession();
  return {
    cwd: claudeProjectDir(),
    runtimeDir: runtimeDir(),
    projectDir: abs,
    hookSessionsDir: `${runtimeDir()}/claude-sessions/reactjit`,
    hookSessionRows: hookRows,
    pickedActiveSession: picked,
    fsLatest: fsTranscriptStats(abs).slice(0, 5),
    shellLatest: shellTranscriptStats(abs).slice(0, 5),
  };
}
