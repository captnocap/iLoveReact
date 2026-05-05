// Bundle stats pane — parses `.cache/bundle-<cart>.js.metafile.json`
// (esbuild's --metafile output) and shows what's inside the cart's
// bundle: total size, top contributing modules, top-level directory
// breakdown.
//
// Self-contained — no IPC, no socket, no dev-host required. Works
// whether the cart is running or not, since metafiles are written by
// scripts/dev's bundling step.
//
// Scrollable: ↑/↓ (or k/j) move by 1, PgUp/PgDn by viewport, g/Home top,
// G/End bottom. Subscribed via the host key bus; only fires while the
// pane is mounted (Shell unmounts on tab switch).

import { createElement, useState, useEffect, ReactElement } from 'react';
import { subscribeKey } from '../../host';

declare const __readFile: ((path: string) => string | null) | undefined;

type Meta = {
  inputs: Record<string, { bytes: number }>;
  outputs: Record<string, {
    bytes: number;
    entryPoint?: string;
    inputs: Record<string, { bytesInOutput: number }>;
  }>;
};

type Summary = {
  bundle: string;
  entryPoint: string;
  totalBytes: number;
  moduleCount: number;
  topModules: { path: string; bytes: number }[];
  topDirs: { dir: string; bytes: number; count: number }[];
};

function summarize(m: Meta): Summary | null {
  const outputName = Object.keys(m.outputs)[0];
  if (!outputName) return null;
  const out = m.outputs[outputName];
  const entries = Object.entries(out.inputs).map(([path, v]) => ({ path, bytes: v.bytesInOutput }));
  entries.sort((a, b) => b.bytes - a.bytes);

  const dirs = new Map<string, { bytes: number; count: number }>();
  for (const e of entries) {
    const segs = e.path.split('/');
    const dir = segs[0] === 'vendor' && segs.length > 1 ? `vendor/${segs[1]}` : segs[0];
    const cur = dirs.get(dir) ?? { bytes: 0, count: 0 };
    cur.bytes += e.bytes;
    cur.count += 1;
    dirs.set(dir, cur);
  }
  const topDirs = [...dirs.entries()].map(([dir, v]) => ({ dir, ...v })).sort((a, b) => b.bytes - a.bytes);

  return {
    bundle: outputName,
    entryPoint: out.entryPoint ?? '?',
    totalBytes: out.bytes,
    moduleCount: entries.length,
    topModules: entries.slice(0, 50),
    topDirs,
  };
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

const BAR_WIDTH = 22;
function bar(frac: number): string {
  const cells = Math.max(0, Math.min(BAR_WIDTH, Math.round(frac * BAR_WIDTH)));
  return '█'.repeat(cells) + ' '.repeat(BAR_WIDTH - cells);
}

function trimPath(p: string, max: number): string {
  if (p.length <= max) return p;
  return '…' + p.slice(p.length - max + 1);
}

// Chrome rows owned by the Shell that the pane has to subtract: title +
// tabs + footer + pane Y-padding (top + bottom).
const CHROME_ROWS = 5;

export function BundlePane({ cart }: { cart: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    if (typeof __readFile !== 'function') {
      setError('__readFile not available — bundle stats require v8cli');
      return;
    }
    const path = `.cache/bundle-${cart}.js.metafile.json`;
    const raw = __readFile(path);
    if (raw === null) {
      setError(`no metafile at ${path}\n(run scripts/dev ${cart} to produce one)`);
      return;
    }
    try {
      const summary = summarize(JSON.parse(raw) as Meta);
      if (!summary) setError('metafile has no outputs');
      else { setData(summary); setError(null); }
    } catch (e) {
      setError('parse error: ' + String(e));
    }
  }, [cart]);

  // Build the flat list of rows once per data change. `null` slots become
  // blank lines; everything else is a ReactElement.
  const rows: (ReactElement | null)[] = [];
  if (data) {
    const max = data.topModules[0]?.bytes ?? 1;
    rows.push(<text key="title" fg="#fbbf24" bold>Bundle</text>);
    rows.push(<Row key="r1" k="output" v={data.bundle} />);
    rows.push(<Row key="r2" k="entry" v={data.entryPoint} />);
    rows.push(<Row key="r3" k="size" v={`${fmtBytes(data.totalBytes)} · ${data.moduleCount} modules`} />);
    rows.push(null);
    rows.push(<text key="hd1" fg="#cbd5e1" bold>Top modules</text>);
    for (const m of data.topModules) {
      rows.push(
        <box key={`m:${m.path}`} flexDirection="row" gap={1} align="start">
          <text fg="#7c3aed">{bar(m.bytes / max)}</text>
          <box width={10}><text fg="#fbbf24">{fmtBytes(m.bytes)}</text></box>
          <text fg="#cbd5e1">{trimPath(m.path, 48)}</text>
        </box>,
      );
    }
    rows.push(null);
    rows.push(<text key="hd2" fg="#cbd5e1" bold>By directory</text>);
    for (const d of data.topDirs) {
      rows.push(
        <box key={`d:${d.dir}`} flexDirection="row" gap={1} align="start">
          <text fg="#0f766e">{bar(d.bytes / data.totalBytes)}</text>
          <box width={8}><text fg="#fbbf24">{((d.bytes / data.totalBytes) * 100).toFixed(1)}%</text></box>
          <box width={10}><text fg="#94a3b8">{fmtBytes(d.bytes)}</text></box>
          <text fg="#cbd5e1">{d.dir}<text fg="#64748b"> · {d.count}</text></text>
        </box>,
      );
    }
  }

  // Live viewport — Shell re-renders at 5Hz so reading process.stdout.rows
  // here picks up resize naturally.
  const termRows = (typeof process !== 'undefined' && process.stdout?.rows) || 24;
  // Reserve 1 row inside the pane for the scroll indicator.
  const viewportH = Math.max(1, termRows - CHROME_ROWS - 1);
  const maxScroll = Math.max(0, rows.length - viewportH);
  const clampedScroll = Math.min(scrollY, maxScroll);
  // If clamped (e.g. on resize that shrunk the list), correct stored
  // state next tick to keep keys mapped to the right window.
  useEffect(() => {
    if (scrollY !== clampedScroll) setScrollY(clampedScroll);
  }, [clampedScroll, scrollY]);

  useEffect(() => subscribeKey(k => {
    if (k === '\x1b[A' || k === 'k') setScrollY(y => Math.max(0, y - 1));
    else if (k === '\x1b[B' || k === 'j') setScrollY(y => y + 1); // clamp on render
    else if (k === '\x1b[5~') setScrollY(y => Math.max(0, y - viewportH));
    else if (k === '\x1b[6~' || k === ' ') setScrollY(y => y + viewportH);
    else if (k === 'g' || k === '\x1b[H') setScrollY(0);
    else if (k === 'G' || k === '\x1b[F') setScrollY(99999); // clamp on render
  }), [viewportH]);

  if (error) {
    return (
      <box flexDirection="column">
        <text fg="#fbbf24" bold>Bundle</text>
        <text fg="#f87171">{error}</text>
      </box>
    );
  }
  if (!data) return <text fg="#94a3b8">loading…</text>;

  const slice = rows.slice(clampedScroll, clampedScroll + viewportH);
  const above = clampedScroll;
  const below = Math.max(0, rows.length - clampedScroll - viewportH);

  return (
    <box flexDirection="column" height={viewportH + 1}>
      {slice.map((r, i) => r ?? <text key={`blank:${i}`}> </text>)}
      <ScrollIndicator above={above} below={below} cur={clampedScroll + 1} total={rows.length} />
    </box>
  );
}

function ScrollIndicator({ above, below, cur, total }: { above: number; below: number; cur: number; total: number }) {
  const arrows: string[] = [];
  if (above > 0) arrows.push(`↑ ${above} more`);
  if (below > 0) arrows.push(`↓ ${below} more`);
  const hint = arrows.length ? arrows.join('  ·  ') : 'all visible';
  return (
    <box flexDirection="row" gap={2}>
      <text fg="#64748b">─── {cur}/{total}  {hint}  ·  k/j ↑↓ · PgUp/PgDn · g/G top/bottom</text>
    </box>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <box flexDirection="row" gap={2}>
      <box width={10}><text fg="#94a3b8">{k}</text></box>
      <text fg="#e5e7eb">{v}</text>
    </box>
  );
}
