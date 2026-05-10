// Bundle stats pane — parses `.cache/bundle-<cart>.js.metafile.json`
// and shows what's inside the cart's bundle. Self-contained (no IPC).
//
// Scrollable: ↑/↓ (or k/j) move by 1, PgUp/PgDn by viewport, g/Home top,
// G/End bottom.

import * as React from 'react';
import { Box, Row, Col, Text } from '../../../runtime/primitives';
import { subscribeKey } from '../../host';

const { useState, useEffect } = React;

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
    const dir = segs[0] === 'deps' && segs.length > 1 ? `deps/${segs[1]}` : segs[0];
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

  type RowEl = React.ReactElement | null;
  const rows: RowEl[] = [];
  if (data) {
    const max = data.topModules[0]?.bytes ?? 1;
    rows.push(<Text key="title" style={{ color: '#fbbf24', fontWeight: 'bold' }}>Bundle</Text>);
    rows.push(<KV key="r1" k="output" v={data.bundle} />);
    rows.push(<KV key="r2" k="entry" v={data.entryPoint} />);
    rows.push(<KV key="r3" k="size" v={`${fmtBytes(data.totalBytes)} · ${data.moduleCount} modules`} />);
    rows.push(null);
    rows.push(<Text key="hd1" style={{ color: '#cbd5e1', fontWeight: 'bold' }}>Top modules</Text>);
    for (const m of data.topModules) {
      rows.push(
        <Row key={`m:${m.path}`} style={{ gap: 1, alignItems: 'flex-start' }}>
          <Text style={{ color: '#7c3aed' }}>{bar(m.bytes / max)}</Text>
          <Box style={{ width: 10 }}><Text style={{ color: '#fbbf24' }}>{fmtBytes(m.bytes)}</Text></Box>
          <Text style={{ color: '#cbd5e1' }}>{trimPath(m.path, 48)}</Text>
        </Row>,
      );
    }
    rows.push(null);
    rows.push(<Text key="hd2" style={{ color: '#cbd5e1', fontWeight: 'bold' }}>By directory</Text>);
    for (const d of data.topDirs) {
      rows.push(
        <Row key={`d:${d.dir}`} style={{ gap: 1, alignItems: 'flex-start' }}>
          <Text style={{ color: '#0f766e' }}>{bar(d.bytes / data.totalBytes)}</Text>
          <Box style={{ width: 8 }}><Text style={{ color: '#fbbf24' }}>{((d.bytes / data.totalBytes) * 100).toFixed(1)}%</Text></Box>
          <Box style={{ width: 10 }}><Text style={{ color: '#94a3b8' }}>{fmtBytes(d.bytes)}</Text></Box>
          <Text style={{ color: '#cbd5e1' }}>{d.dir}<Text style={{ color: '#64748b' }}> · {d.count}</Text></Text>
        </Row>,
      );
    }
  }

  const termRows = (typeof process !== 'undefined' && process.stdout?.rows) || 24;
  const viewportH = Math.max(1, termRows - CHROME_ROWS - 1);
  const maxScroll = Math.max(0, rows.length - viewportH);
  const clampedScroll = Math.min(scrollY, maxScroll);
  useEffect(() => {
    if (scrollY !== clampedScroll) setScrollY(clampedScroll);
  }, [clampedScroll, scrollY]);

  useEffect(() => subscribeKey(k => {
    if (k === '\x1b[A' || k === 'k') setScrollY(y => Math.max(0, y - 1));
    else if (k === '\x1b[B' || k === 'j') setScrollY(y => y + 1);
    else if (k === '\x1b[5~') setScrollY(y => Math.max(0, y - viewportH));
    else if (k === '\x1b[6~' || k === ' ') setScrollY(y => y + viewportH);
    else if (k === 'g' || k === '\x1b[H') setScrollY(0);
    else if (k === 'G' || k === '\x1b[F') setScrollY(99999);
  }), [viewportH]);

  if (error) {
    return (
      <Col>
        <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>Bundle</Text>
        <Text style={{ color: '#f87171' }}>{error}</Text>
      </Col>
    );
  }
  if (!data) return <Text style={{ color: '#94a3b8' }}>loading…</Text>;

  const slice = rows.slice(clampedScroll, clampedScroll + viewportH);
  const above = clampedScroll;
  const below = Math.max(0, rows.length - clampedScroll - viewportH);

  return (
    <Col style={{ height: viewportH + 1 }}>
      {slice.map((r, i) => r ?? <Text key={`blank:${i}`}> </Text>)}
      <ScrollIndicator above={above} below={below} cur={clampedScroll + 1} total={rows.length} />
    </Col>
  );
}

function ScrollIndicator({ above, below, cur, total }: { above: number; below: number; cur: number; total: number }) {
  const arrows: string[] = [];
  if (above > 0) arrows.push(`↑ ${above} more`);
  if (below > 0) arrows.push(`↓ ${below} more`);
  const hint = arrows.length ? arrows.join('  ·  ') : 'all visible';
  return (
    <Row style={{ gap: 2 }}>
      <Text style={{ color: '#64748b' }}>─── {cur}/{total}  {hint}  ·  k/j ↑↓ · PgUp/PgDn · g/G top/bottom</Text>
    </Row>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <Row style={{ gap: 2 }}>
      <Box style={{ width: 10 }}><Text style={{ color: '#94a3b8' }}>{k}</Text></Box>
      <Text style={{ color: '#e5e7eb' }}>{v}</Text>
    </Row>
  );
}
