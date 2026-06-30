// diag/console/captures.ts — named log captures from the console feed.
//
// "The raw console should also support creating a named log capture from the
// current feed/window. A capture preserves channels, filters, time range,
// build id, request id when known, active map/context, and a short note."
// (DESIGN_INTAKE → Diagnostics Registry And Raw Console.)
//
// A capture is a frozen, filtered slice plus the context needed to make it a
// traceable build-history artifact. Attaching it to a bug/build thread is the
// build-journal workstream's (F) job — we go through a thin ADAPTER seam rather
// than hard-importing runtime/buildjournal so this console builds + ships
// independently and the journal can wire itself in at app boot.

import type { DiagLine } from './feed';
import type { FeedFilter } from './format';
import { linesToText } from './format';

/** A recorded diagnostics slice. Mirrors the build-journal LogCapture contract
 *  so the adapter can hand it straight to `journal.registerCapture`. */
export interface LogCapture {
  id: string;
  /** Human label, e.g. 'orbit jitter'. */
  name: string;
  /** Channels present in the slice (for the thread card summary). */
  channels: string[];
  /** Severity floor the capture was taken at. */
  severityFloor: string;
  /** Free-text filter that was active, if any. */
  textFilter: string;
  /** Wall-clock window the slice covers (ms). */
  timeRange: { from: number; to: number };
  /** Build-number stream value live when taken (when known). */
  buildId?: string;
  /** Originating request id when known. */
  requestId?: string;
  /** Map / scene context. */
  mapContext?: string;
  /** Short user/agent note. */
  note?: string;
  /** The frozen lines. */
  lines: DiagLine[];
  /** When the capture was created (ms). */
  createdAt: number;
}

export interface CaptureContext {
  buildId?: string;
  requestId?: string;
  mapContext?: string;
  note?: string;
}

/** The build-journal seam. Workstream F registers an adapter at boot:
 *    setJournalAdapter({ registerCapture, attachToThread, findThreads }) */
export interface JournalAdapter {
  registerCapture(capture: LogCapture): void;
  attachToThread(threadStableId: string, captureId: string): void;
  /** Semantic search for an existing thread to re-attach to ('jesus water
   *  walking'). Returns candidate {stableId,name}. */
  findThreads?(query: string): Array<{ stableId: string; name: string }>;
}

let _adapter: JournalAdapter | null = null;
export function setJournalAdapter(a: JournalAdapter | null): void {
  _adapter = a;
}
export function hasJournal(): boolean {
  return _adapter != null;
}

const _captures = new Map<string, LogCapture>();
let _captureSeq = 0;

function nextId(): string {
  _captureSeq += 1;
  return `cap_${Date.now().toString(36)}_${_captureSeq}`;
}

/** Build a named capture from a (already filtered) set of lines + the filter +
 *  context. Registers it locally and, when a journal adapter is wired, into the
 *  journal so threads can reference it. */
export function createCapture(
  name: string,
  lines: DiagLine[],
  filter: FeedFilter,
  ctx: CaptureContext = {},
): LogCapture {
  const channels = Array.from(new Set(lines.map((l) => l.ch))).sort();
  const from = lines.length ? lines[0]!.ts : Date.now();
  const to = lines.length ? lines[lines.length - 1]!.ts : from;
  const capture: LogCapture = {
    id: nextId(),
    name: name.trim() || `capture ${new Date().toLocaleTimeString()}`,
    channels: filter.channels ? Array.from(filter.channels).sort() : channels,
    severityFloor: filter.minSeverity,
    textFilter: filter.text,
    timeRange: { from, to },
    buildId: ctx.buildId,
    requestId: ctx.requestId,
    mapContext: ctx.mapContext,
    note: ctx.note,
    lines: lines.slice(),
    createdAt: Date.now(),
  };
  _captures.set(capture.id, capture);
  if (_adapter) {
    try { _adapter.registerCapture(capture); } catch { /* journal optional */ }
  }
  return capture;
}

export function capture(id: string): LogCapture | undefined {
  return _captures.get(id);
}

export function allCaptures(): LogCapture[] {
  return Array.from(_captures.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** The capture's lines as copyable plain text — the agent-paste payload. */
export function captureToText(id: string): string {
  const c = _captures.get(id);
  return c ? linesToText(c.lines) : '';
}

/** Attach an existing capture to a bug/build thread via the journal adapter.
 *  Returns false (graceful) when no journal is wired. */
export function attachCaptureToThread(captureId: string, threadStableId: string): boolean {
  if (!_adapter) return false;
  try { _adapter.attachToThread(threadStableId, captureId); return true; }
  catch { return false; }
}

/** Semantic thread search for the "attach to existing bug" flow. Empty when no
 *  journal is wired or it doesn't expose search. */
export function findThreads(query: string): Array<{ stableId: string; name: string }> {
  if (!_adapter || !_adapter.findThreads) return [];
  try { return _adapter.findThreads(query); } catch { return []; }
}
