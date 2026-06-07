// editors/workbench/logs/churn.ts — the churn line CLASSIFICATION
// (WBSET9-0606). Carried over from LogView.tsx:19-50 VERBATIM (tag pull,
// tag→color map, key-line rule, line color): the /log route is FROZEN until
// its flip, so the rules move here unexported-from-there rather than by
// editing the dying file. At the flip this module is the only copy.

/** Pull the tag out of `[t +dt] tag: msg` to colour/filter the line. */
export function tagOf(line: string): string {
  const m = /\]\s+([a-zA-Z]+):/.exec(line);
  return m ? m[1] : '';
}

export const TAG_COLOR: Record<string, string> = {
  stroke: '#86efac',
  landforms: '#fbbf24',
  regionSync: '#7dd3fc',
  buildFloors: '#a78bfa',
  previewWorld: '#f472b6',
  floors: '#38bdf8',
  edit: '#e2e8f0',
  render: '#64748b',
  chunkSurface: '#475569',
  autosave: '#475569',
};

/** The signal lines worth seeing at a glance (the rest is per-render churn). */
const KEY_TAGS = new Set(['stroke', 'landforms', 'buildFloors', 'floors', 'previewWorld']);
export function isKeyLine(line: string): boolean {
  const t = tagOf(line);
  if (KEY_TAGS.has(t)) return true;
  return t === 'regionSync' && line.includes('FIRE'); // keep FIRE, drop schedule/coalesce
}

export function lineColor(line: string): string {
  if (line.includes('⚠')) return '#fca5a5';
  if (line.includes('✓')) return '#86efac';
  if (line.startsWith('====')) return '#64748b';
  return TAG_COLOR[tagOf(line)] ?? '#cbd5e1';
}

/** the `[123.4 +5.6] ` stamp, for the stream's time cell (raw line kept whole
 *  when it doesn't parse — session headers, hand-written lines) */
export function lineStamp(line: string): { time: string; rest: string } {
  const m = /^\[(\d+\.?\d*) \+\d+\.?\d*\]\s*(.*)$/.exec(line);
  return m ? { time: m[1], rest: m[2] } : { time: '', rest: line };
}
