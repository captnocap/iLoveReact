// wrapt_tui — same wrapt prototype, shipped as a TUI cart.
//
// Two delivery routes for the same idea:
//   scripts/ship      cart/wrapt.tsx       → SDL3 window with <Terminal>
//   scripts/ship-tui  cart/wrapt_tui.tsx   → ANSI TUI with <Terminal>
//
// Identical hook surface, identical routes, identical PTY handling. The
// only thing that changes is the outer paint backend (GPU window vs.
// character grid). Both are useful: ship for desktop, ship-tui for SSH,
// containers, headless runners, or stacking inside tmux.
//
// Run:
//   scripts/ship-tui cart/wrapt_tui.tsx
//   zig-out/bin/wrapt_tui
//
// Then curl localhost:7779/ in another shell.

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Text, Terminal } from '@reactjit/runtime/primitives';
import { useHost } from '@reactjit/runtime/hooks/useHost';
import { useTerminal } from '@reactjit/runtime/hooks/useTerminal';

const PORT = 7779;
const SHELL = '/bin/bash';

const writePty = (data: string) => (globalThis as any).__vterm_write?.(0, data);

const ROUTES = [
  { path: '/', kind: 'handler' as const },
  { path: '/rows', kind: 'handler' as const },
  { path: '/state', kind: 'handler' as const },
  { path: '/send', kind: 'handler' as const },
  { path: '/run', kind: 'handler' as const },
];

function allRowsText(sem: ReturnType<typeof useTerminal>['sem']): string[] {
  const n = sem.vtermRows();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(sem.rowText(i));
  return out;
}

export default function WraptTui() {
  const term = useTerminal({ classifier: 'basic' });
  const [hits, setHits] = useState(0);
  const [lastPath, setLastPath] = useState('');

  const semRef = useRef(term.sem);
  semRef.current = term.sem;

  const host = useHost({
    kind: 'http',
    port: PORT,
    routes: ROUTES,
    onRequest: (req, res) => {
      setHits((h) => h + 1);
      setLastPath(`${req.method} ${req.path}`);
      const sem = semRef.current;

      try {
        if (req.method === 'GET' && req.path === '/') {
          res.send(200, 'application/json', JSON.stringify({
            wrapt: 'tui-edition',
            shell: SHELL,
            rows: sem.vtermRows(),
            routes: ROUTES.map((r) => r.path),
          }, null, 2));
          return;
        }
        if (req.method === 'GET' && req.path === '/rows') {
          res.send(200, 'text/plain', allRowsText(sem).join('\n'));
          return;
        }
        if (req.method === 'GET' && req.path === '/state') {
          res.send(200, 'application/json', JSON.stringify(sem.state() ?? {}, null, 2));
          return;
        }
        if (req.method === 'POST' && req.path === '/send') {
          writePty(req.body);
          res.send(200, 'application/json', JSON.stringify({ wrote: req.body.length }));
          return;
        }
        if (req.method === 'POST' && req.path === '/run') {
          writePty(req.body + '\n');
          res.send(200, 'application/json', JSON.stringify({ ran: req.body }));
          return;
        }
        res.send(404, 'text/plain', `no route: ${req.method} ${req.path}\n`);
      } catch (e: any) {
        res.send(500, 'text/plain', `err: ${e?.message ?? e}\n`);
      }
    },
  });

  useEffect(() => {
    const id = setInterval(() => semRef.current.buildGraph(), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: '#0b1020' }}>
      <Row style={{ paddingLeft: 1, paddingRight: 1, backgroundColor: '#1e293b', gap: 2 }}>
        <Text style={{ color: '#fbbf24' }}>wrapt-tui</Text>
        <Text style={{ color: '#94a3b8' }}>{`http://localhost:${PORT}`}</Text>
        <Text style={{ color: host.state === 'running' ? '#4ade80' : '#f87171' }}>
          {host.state}
        </Text>
        <Text style={{ color: '#94a3b8' }}>{`hits:${hits}`}</Text>
        <Text style={{ color: '#64748b' }}>{lastPath || '—'}</Text>
      </Row>
      <Box style={{ flexGrow: 1 }}>
        {/* autoFocus: route the host's stdin straight to this PTY without
            requiring a click. Makes nested-TUI setups (running wrapt_tui
            inside another wrapt window for the meme) actually typable. */}
        <Terminal shell={SHELL} autoFocus style={{ width: '100%', height: '100%' }} />
      </Box>
    </Col>
  );
}
