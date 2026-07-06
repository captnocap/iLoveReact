// hmsc_ascii_tui - compiled gamefile viewed as terminal data.

import * as React from 'react';
import { Box, Col, Text } from '@reactjit/primitives';
import { Plasma, PLASMA_DEFAULTS } from '@reactjit/effects';
import { readFileBase64 } from '@reactjit/hooks/fs';
import { base64ToBytes } from '@reactjit/workspace/lumps';
import { asciiFromGameFile, type AsciiMapResult } from '../hmsc-int/editors/play/asciiLoader/render';

const LEGEND_TEXT = '.:ground  +:prop  #:structure  H:tall  @:tower  /:ramp  o:round  *:foliage';

type LoadState =
  | { ok: true; path: string; bytes: number; ms: number; map: AsciiMapResult }
  | { ok: false; path: string; error: string };

function processLike(): any {
  return (globalThis as any).process;
}

function repoRoot(): string {
  const proc = processLike();
  const envRoot = proc?.env?.RJIT_HOME;
  if (typeof envRoot === 'string' && envRoot.length > 0) return envRoot;
  const cwd = typeof proc?.cwd === 'function' ? proc.cwd() : '';
  return cwd || '/home/siah/creative/reactjit';
}

function gamefilePath(): string {
  const proc = processLike();
  const explicit = proc?.env?.HMSC_GAMEFILE;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  return `${repoRoot()}/zig-out/game/hmsc.gamefile`;
}

function terminalCols(): number {
  const cols = processLike()?.stdout?.columns;
  return Number.isFinite(cols) ? cols : 120;
}

function terminalRows(): number {
  const rows = processLike()?.stdout?.rows;
  return Number.isFinite(rows) ? rows : 42;
}

function loadMap(path: string, cols: number, rows: number): LoadState {
  const started = Date.now();
  try {
    const b64 = readFileBase64(path);
    if (!b64) return { ok: false, path, error: `missing gamefile: ${path}` };
    const bytes = base64ToBytes(b64);
    const map = asciiFromGameFile(bytes, {
      cols,
      rows,
      scope: 'pieces',
      paddingMeters: 8,
    });
    return { ok: true, path, bytes: bytes.byteLength, ms: Date.now() - started, map };
  } catch (error: any) {
    return { ok: false, path, error: error?.message ?? String(error) };
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function Header({ state }: { state: LoadState }) {
  if (!state.ok) {
    return (
      <Col style={{ gap: 1 }}>
        <Text style={{ color: '#fca5a5', fontWeight: 'bold' }}>HMSC GAMEFILE ASCII</Text>
        <Text style={{ color: '#f87171' }}>{state.error}</Text>
      </Col>
    );
  }

  const stats = state.map.stats;
  return (
    <Col style={{ gap: 1 }}>
      <Text style={{ color: '#e5e7eb', fontWeight: 'bold' }}>
        HMSC GAMEFILE ASCII  {mb(state.bytes)}  {state.ms.toFixed(1)}ms
      </Text>
      <Text style={{ color: '#94a3b8' }}>
        {stats.sceneInstances.toLocaleString()} instances | {stats.projectedInstances.toLocaleString()} projected | {stats.heightfields} heightfields | {stats.cols}x{stats.rows}
      </Text>
      <Text style={{ color: '#64748b' }}>{state.path}</Text>
    </Col>
  );
}

function Legend() {
  return (
    <Text style={{ color: '#94a3b8' }}>{LEGEND_TEXT}</Text>
  );
}

export default function HmscAsciiTui() {
  const cols = Math.max(64, Math.min(150, terminalCols() - 4));
  const rows = Math.max(12, Math.min(48, terminalRows() - 16));
  const path = gamefilePath();
  const state = React.useMemo(() => loadMap(path, cols, rows), [path, cols, rows]);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#020617', padding: 1, flexDirection: 'column', gap: 1 }}>
      <Plasma
        params={{
          ...PLASMA_DEFAULTS,
          colors: { primary: '#0ea5e9', secondary: '#22c55e', tertiary: '#f97316' },
          drift: 0.075,
          velocity: 0.35,
          opacity: 0.8,
        }}
        style={{ width: '100%', height: 3 }}
      />

      <Header state={state} />

      {state.ok ? (
        <Col style={{ flexGrow: 1, gap: 0, backgroundColor: '#030712', paddingLeft: 1, paddingRight: 1 }}>
          {state.map.lines.map((line, index) => (
            <Text key={index} style={{ color: '#d1d5db' }}>{line}</Text>
          ))}
        </Col>
      ) : (
        <Box style={{ flexGrow: 1 }} />
      )}

      {state.ok ? <Legend /> : null}
    </Box>
  );
}
