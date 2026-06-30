// diag/console/format.ts — pure filtering + copy serialization for the console.
//
// Kept separate from the feed store so the filter predicate and the
// copy-to-text shape are unit-reasonable and reused by both the live view and
// named captures (a capture is just a frozen filtered slice).

import type { DiagLine } from './feed';
import { callHost } from '../../ffi';

export type Severity = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** Low → high. A severity filter keeps lines at or above the chosen floor. */
export const SEVERITY_ORDER: Severity[] = ['trace', 'debug', 'info', 'warn', 'error'];

export function severityRank(sev: string): number {
  const i = SEVERITY_ORDER.indexOf(sev as Severity);
  return i < 0 ? SEVERITY_ORDER.indexOf('info') : i;
}

/** Active console filter. `channels: null` means all channels; a Set restricts
 *  to those ids. `minSeverity` is the floor; `text` is a case-insensitive
 *  substring matched against channel/msg/fields. */
export interface FeedFilter {
  channels: Set<string> | null;
  minSeverity: Severity;
  text: string;
}

export const ALL_PASS: FeedFilter = { channels: null, minSeverity: 'trace', text: '' };

export function passesFilter(line: DiagLine, f: FeedFilter): boolean {
  if (f.channels && !f.channels.has(line.ch)) return false;
  if (severityRank(line.sev) < severityRank(f.minSeverity)) return false;
  if (f.text) {
    const needle = f.text.toLowerCase();
    if (!line.ch.toLowerCase().includes(needle) &&
        !line.msg.toLowerCase().includes(needle) &&
        !fieldsText(line).toLowerCase().includes(needle)) {
      return false;
    }
  }
  return true;
}

export function applyFilter(lines: DiagLine[], f: FeedFilter): DiagLine[] {
  if (f === ALL_PASS) return lines;
  return lines.filter((l) => passesFilter(l, f));
}

export function fieldsText(line: DiagLine): string {
  try { return JSON.stringify(line.fields); } catch { return ''; }
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** One line as copyable plain text. The form is agent-paste friendly:
 *    HH:MM:SS.mmm  WARN  editor.place  slow place  {"ms":40} */
export function lineToText(line: DiagLine): string {
  const fields = line.fields && Object.keys(line.fields).length ? '  ' + fieldsText(line) : '';
  const trunc = line.trunc ? '  …(truncated)' : '';
  return `${fmtTime(line.ts)}  ${line.sev.toUpperCase().padEnd(5)}  ${line.ch}  ${line.msg}${fields}${trunc}`;
}

/** A block of lines as copyable text (oldest → newest). */
export function linesToText(lines: DiagLine[]): string {
  return lines.map(lineToText).join('\n');
}

/** Write text to the system clipboard via the host door, falling back to a
 *  stashed global so a caller can still retrieve it when no clipboard exists
 *  (headless / pre-wire). Returns true when the host clipboard accepted it. */
export function copyText(text: string): boolean {
  (globalThis as any).__diagLastCopy = text;
  const fn = (globalThis as any).__clipboard_set;
  if (typeof fn === 'function') {
    try { fn(text); return true; } catch { return false; }
  }
  return false;
}
