// tui_playground — a React playground whose preview is rendered through the
// TUI rasterizer. You write a normal React component on the left; on the
// right you see it rasterized to a character grid, exactly as it would look
// shipped via scripts/ship-tui.
//
// How the pieces fit (all of these already existed — this cart just wires
// them together):
//
//   • tools/esbuild + scripts/cart-bundle.js --cartridge   bundle your TSX
//     into a guest .cart.js in ~30ms (spawned via the process hook).
//   • <Cartridge src> / cartridge_loader                   eval that guest in
//     this V8 context and mount its default export as a live subtree. We mount
//     it OFF-SCREEN (absolute, opacity 0) so it never paints in the GPU window.
//   • tui/host.ts rasterizeInstance(root, cols, rows)       the same layout +
//     char-grid paint the live TUI backend uses, run over just that subtree,
//     returning one ANSI frame.
//   • <Terminal dumb> + __vterm_feed                        a PTY-less vterm
//     cell grid we blit that ANSI frame into — the live preview surface.
//
// Run it from the repo root so the bundler (tools/v8cli, scripts/) is on the
// relative paths it expects:
//
//   ./scripts/dev tui_playground      (hot-reloads this cart's TSX)
//   ./scripts/ship tui_playground && (cd . && zig-out/bin/tui_playground)

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Text, TextEditor, Terminal, Cartridge } from '@reactjit/primitives';
// useTerminal's presence in the bundle is the registry signal that links the
// terminal ingredient (-Dhas-terminal → libvterm + __vterm_*). The dumb
// preview pipe needs it.
import { useTerminal } from '@reactjit/hooks/useTerminal';
import { writeFile } from '@reactjit/hooks/fs';
import { spawn, onExit, onStderr, envSet } from '@reactjit/hooks/process';
import { evictCartridge } from '@reactjit/cartridge_loader';
// Reached by relative path — carts only alias @reactjit/runtime, not the
// renderer / tui trees. getRootInstances is the live shared reconciler tree
// (one module instance across the whole bundle); rasterizeInstance is the
// pure TUI rasterizer core.
import { getRootInstances } from '../renderer/hostConfig';
import { rasterizeInstance, setTuiScale } from '../tui/host';

// ── config ──────────────────────────────────────────────────────────
const SESSION = 'tui-playground';
const SCRATCH_TSX = 'bundle-tui_playground.scratch.tsx';
const SCRATCH_OUT = 'bundle-tui_playground.scratch.cart.js';
const COLS = 72;          // preview grid width  (cells)
const ROWS = 26;          // preview grid height (cells)
const SCALE = 8;          // pixel→cell divisor: carts are written in GPU px
const CLEAR = '\x1b[2J\x1b[H';

const feed = (data: string) => (globalThis as any).__vterm_feed?.(SESSION, data);

// Starter component. A plain React tree — borders become box-drawing,
// backgroundColor becomes filled cells, Text becomes text. Edit it and watch
// the right pane re-rasterize.
const DEFAULT_CODE = `import { Box, Col, Row, Text } from '@reactjit/primitives';

export default function App() {
  return (
    <Col style={{ width: '100%', height: '100%', padding: 8, gap: 8, backgroundColor: '#0c1018' }}>
      <Row style={{ backgroundColor: '#1e6feb', padding: 8, justifyContent: 'space-between' }}>
        <Text bold style={{ color: '#ffffff' }}>★ My TUI App</Text>
        <Text style={{ color: '#bcd4ff' }}>v0.1</Text>
      </Row>

      <Box style={{ borderWidth: 8, borderColor: '#2b3a52', padding: 8, flexGrow: 1, gap: 4 }}>
        <Text style={{ color: '#9fe0b0' }}>● online    3 peers</Text>
        <Text style={{ color: '#e0c87a' }}>● syncing   42%</Text>
        <Text style={{ color: '#e07a8a' }}>● errors    0</Text>
        <Text style={{ color: '#5a6478' }}>edit the code on the left →</Text>
      </Box>

      <Row style={{ gap: 8 }}>
        <Box style={{ backgroundColor: '#21303f', padding: 8 }}>
          <Text style={{ color: '#cfe7ff' }}>[ OK ]</Text>
        </Box>
        <Box style={{ backgroundColor: '#3f2130', padding: 8 }}>
          <Text style={{ color: '#ffd0e0' }}>[ Cancel ]</Text>
        </Box>
      </Row>
    </Col>
  );
}
`;

// ── preview-subtree lookup ──────────────────────────────────────────
// DFS the live reconciler tree for the Box we tagged previewRoot. Its
// children are the mounted guest cart; rasterize from there.
function findPreviewRoot(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (node.props && node.props.previewRoot) return node;
  const ch = node.children;
  if (Array.isArray(ch)) {
    for (const c of ch) {
      const f = findPreviewRoot(c);
      if (f) return f;
    }
  }
  return null;
}

// ── bundle pipeline ─────────────────────────────────────────────────
function runBundle(done: (ok: boolean, err: string) => void): void {
  // __proc_spawn drops the env field today; the child inherits our environ,
  // so set the harness gate on ourselves first. cwd is inherited too — hence
  // the "run from repo root" note up top, so tools/v8cli + scripts/ resolve.
  envSet('BUNDLE_FROM_HARNESS', '1');
  let err = '';
  const pid = spawn({
    cmd: 'tools/v8cli',
    args: ['scripts/cart-bundle.js', SCRATCH_TSX, '--cartridge', '-o', SCRATCH_OUT],
  });
  if (!pid) {
    done(false, 'could not spawn tools/v8cli — launch the playground from the repo root');
    return;
  }
  onStderr(pid, (line) => { err += line + '\n'; });
  onExit(pid, ({ code }) => done(code === 0, err.trim()));
}

export default function TuiPlayground() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [ready, setReady] = useState(false);     // first good bundle mounted
  const [version, setVersion] = useState(0);      // bump → remount <Cartridge>
  const [status, setStatus] = useState<'bundling' | 'ok' | 'error'>('bundling');
  const [err, setErr] = useState('');

  useTerminal({ classifier: 'none' });
  useEffect(() => { setTuiScale(SCALE); }, []);

  // Debounced rebuild on every edit: write source → bundle → remount guest.
  useEffect(() => {
    setStatus('bundling');
    const t = setTimeout(() => {
      writeFile(SCRATCH_TSX, code);
      runBundle((ok, e) => {
        if (ok) {
          evictCartridge(SCRATCH_OUT);
          setErr('');
          setStatus('ok');
          setReady(true);
          setVersion((v) => v + 1);
        } else {
          setStatus('error');
          setErr(e || 'bundle failed');
        }
      });
    }, 450);
    return () => clearTimeout(t);
  }, [code]);

  // Rasterize the mounted guest subtree into the dumb terminal, on a tick so
  // the preview stays live even while the guest animates / runs effects.
  useEffect(() => {
    const id = setInterval(() => {
      const root = findPreviewRoot({ children: getRootInstances() });
      if (!root) return;
      try { feed(CLEAR + rasterizeInstance(root, COLS, ROWS)); }
      catch { /* mid-commit tree; next tick */ }
    }, 120);
    return () => clearInterval(id);
  }, []);

  const statusColor = status === 'ok' ? '#7ee08a' : status === 'error' ? '#ff7a8a' : '#e0c87a';
  const statusText = status === 'ok' ? 'rendered' : status === 'error' ? 'bundle error' : 'bundling…';

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: '#0b0e14' }}>
      <Row style={{ paddingTop: 10, paddingBottom: 10, paddingLeft: 16, paddingRight: 16, alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#1c2230' }}>
        <Text fontSize={13} bold color="#7ee0ff" style={{ letterSpacing: 1.5 }}>REACT</Text>
        <Text fontSize={13} color="#5a6678" style={{ letterSpacing: 1.5 }}>→ TUI PLAYGROUND</Text>
        <Box style={{ flexGrow: 1 }} />
        <Box style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: statusColor }} />
        <Text fontSize={11} color={statusColor}>{statusText}</Text>
      </Row>

      <Row style={{ flexGrow: 1, width: '100%' }}>
        {/* editor */}
        <Col style={{ flexGrow: 1, flexBasis: 1, borderRightWidth: 1, borderRightColor: '#1c2230' }}>
          <Text fontSize={10} color="#5a6678" style={{ paddingTop: 6, paddingBottom: 6, paddingLeft: 14 }}>App.tsx</Text>
          <TextEditor
            text={code}
            onChange={(t: string) => setCode(t)}
            fontSize={13}
            style={{ width: '100%', flexGrow: 1, backgroundColor: '#0d1119', color: '#c6d0e0', padding: 12 }}
          />
        </Col>

        {/* TUI-rasterized preview */}
        <Col style={{ flexGrow: 1, flexBasis: 1 }}>
          <Text fontSize={10} color="#5a6678" style={{ paddingTop: 6, paddingBottom: 6, paddingLeft: 14 }}>TUI PREVIEW · {COLS}×{ROWS}</Text>
          <Box style={{ width: '100%', flexGrow: 1, backgroundColor: '#07090f' }}>
            <Terminal dumb session={SESSION} terminalFontSize={14} style={{ width: '100%', height: '100%' }} />
          </Box>
          {status === 'error' && (
            <Box style={{ backgroundColor: '#1a0f12', borderTopWidth: 1, borderTopColor: '#3a1f24', padding: 10, maxHeight: 140 }}>
              <Text fontSize={11} color="#ff9aa6" style={{ fontFamily: 'mono' }}>{err.slice(0, 600)}</Text>
            </Box>
          )}
        </Col>
      </Row>

      {/* Off-screen live guest. Absolute → out of flow; far off-screen +
          opacity 0 → never visible. Its Instances still exist, which is all
          the rasterizer needs. */}
      {ready && (
        <Box style={{ position: 'absolute', left: -10000, top: -10000, width: COLS * SCALE, height: ROWS * SCALE, opacity: 0 }}>
          <Box previewRoot style={{ width: '100%', height: '100%' }}>
            <Cartridge key={version} src={SCRATCH_OUT} />
          </Box>
        </Box>
      )}
    </Col>
  );
}
