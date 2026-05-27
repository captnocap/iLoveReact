// wrapt — prototype: wrap any TUI process as an HTTP backend.
//
// Spawns bash in a <Terminal>, runs the basic classifier over the vterm
// output, and exposes the live state + an action endpoint over HTTP.
//
// Routes (default port 7777):
//   GET  /          — status blob + route index
//   GET  /rows      — every visible row as plain text
//   GET  /state     — semantic SessionState (mode, streaming, turn, ...)
//   GET  /export    — full semantic export (tree + classified rows)
//   POST /send      — body is raw bytes to write to the PTY (keystrokes)
//   POST /run       — body is a shell command; appends "\n"
//
// Curl tour once the cart is running:
//   curl localhost:7777/rows
//   curl -X POST --data 'uname -a' localhost:7777/run
//   sleep 0.3 && curl localhost:7777/rows | tail -5
//   curl -X POST --data $'\x03' localhost:7777/send     # Ctrl-C

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Text, Terminal } from '@reactjit/runtime/primitives';
import { useHost } from '@reactjit/runtime/hooks/useHost';
import { useTerminal } from '@reactjit/runtime/hooks/useTerminal';

const PORT = 7777;
const SHELL = '/bin/bash';

const writePty = (data: string) => (globalThis as any).__vterm_write?.(0, data);

const ROUTES = [
  { path: '/', kind: 'handler' as const },
  { path: '/rows', kind: 'handler' as const },
  { path: '/state', kind: 'handler' as const },
  { path: '/export', kind: 'handler' as const },
  { path: '/send', kind: 'handler' as const },
  { path: '/run', kind: 'handler' as const },
];

function allRowsText(sem: ReturnType<typeof useTerminal>['sem']): string[] {
  const n = sem.vtermRows();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(sem.rowText(i));
  return out;
}

export default function Wrapt() {
  const term = useTerminal({ classifier: 'basic' });
  const [hits, setHits] = useState(0);
  const [lastPath, setLastPath] = useState('');

  // Keep a live ref to sem so the HTTP handler always sees the latest.
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
            wrapt: 'ok',
            shell: SHELL,
            classifier: 'basic',
            sem_frame: term.semFrame,
            rows: sem.vtermRows(),
            nodes: sem.nodeCount(),
            routes: ROUTES.map((r) => r.path),
          }, null, 2));
          return;
        }

        if (req.method === 'GET' && req.path === '/rows') {
          res.send(200, 'text/plain', allRowsText(sem).join('\n'));
          return;
        }

        if (req.method === 'GET' && req.path === '/state') {
          const st = sem.state();
          res.send(200, 'application/json', JSON.stringify(st ?? {}, null, 2));
          return;
        }

        if (req.method === 'GET' && req.path === '/export') {
          sem.buildGraph();
          const ex = sem.export();
          res.send(200, 'application/json', JSON.stringify(ex ?? {}, null, 2));
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

  // Periodically rebuild the graph so /export reflects fresh classification
  // even when no HTTP request triggers it.
  useEffect(() => {
    const id = setInterval(() => semRef.current.buildGraph(), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: '#0b1020' }}>
      <Row style={{ padding: 8, gap: 16, backgroundColor: '#1e293b' }}>
        <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>wrapt</Text>
        <Text style={{ color: '#94a3b8' }}>{`http://localhost:${PORT}`}</Text>
        <Text style={{ color: host.state === 'running' ? '#4ade80' : '#f87171' }}>
          {host.state}
        </Text>
        <Text style={{ color: '#94a3b8' }}>{`hits: ${hits}`}</Text>
        <Text style={{ color: '#64748b' }}>{lastPath || '—'}</Text>
        <Text style={{ color: '#64748b' }}>{`semFrame: ${term.semFrame}`}</Text>
      </Row>
      <Box style={{ flexGrow: 1, padding: 4, backgroundColor: '#000000' }}>
        <Terminal shell={SHELL} style={{ width: '100%', height: '100%' }} />
      </Box>
    </Col>
  );
}
