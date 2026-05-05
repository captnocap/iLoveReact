// Bundle stats pane — parses `.cache/bundle-<cart>.js.metafile.json`
// (esbuild's --metafile output) and shows what's inside the cart's
// bundle: total size, top contributing modules, top-level directory
// breakdown.
//
// Self-contained — no IPC, no socket, no dev-host required. Works
// whether the cart is running or not, since metafiles are written by
// scripts/dev's bundling step.

import { createElement, useState, useEffect } from 'react';

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

  // Group by first directory segment. Vendored deps collapse into
  // `vendor/<pkg>` (two segments) so react / react-reconciler stay
  // distinguishable in the breakdown.
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
    topModules: entries.slice(0, 10),
    topDirs: topDirs.slice(0, 8),
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

export function BundlePane({ cart }: { cart: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) {
    return (
      <box flexDirection="column">
        <text fg="#fbbf24" bold>Bundle</text>
        <text fg="#f87171">{error}</text>
      </box>
    );
  }
  if (!data) return <text fg="#94a3b8">loading…</text>;

  const max = data.topModules[0]?.bytes ?? 1;
  return (
    <box flexDirection="column">
      <text fg="#fbbf24" bold>Bundle</text>
      <Row k="output" v={data.bundle} />
      <Row k="entry" v={data.entryPoint} />
      <Row k="size" v={`${fmtBytes(data.totalBytes)} · ${data.moduleCount} modules`} />
      <text> </text>
      <text fg="#cbd5e1" bold>Top modules</text>
      {data.topModules.map(m => (
        <box key={m.path} flexDirection="row" gap={1} align="start">
          <text fg="#7c3aed">{bar(m.bytes / max)}</text>
          <box width={10}><text fg="#fbbf24">{fmtBytes(m.bytes)}</text></box>
          <text fg="#cbd5e1">{trimPath(m.path, 48)}</text>
        </box>
      ))}
      <text> </text>
      <text fg="#cbd5e1" bold>By directory</text>
      {data.topDirs.map(d => (
        <box key={d.dir} flexDirection="row" gap={1} align="start">
          <text fg="#0f766e">{bar(d.bytes / data.totalBytes)}</text>
          <box width={8}><text fg="#fbbf24">{((d.bytes / data.totalBytes) * 100).toFixed(1)}%</text></box>
          <box width={10}><text fg="#94a3b8">{fmtBytes(d.bytes)}</text></box>
          <text fg="#cbd5e1">{d.dir}<text fg="#64748b"> · {d.count}</text></text>
        </box>
      ))}
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
