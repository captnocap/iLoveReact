// wrapt_acme — wrap a 1987 COBOL TUI as an HTTP backend.
//
// The "process" is /tmp/legacy/acme — a GnuCOBOL build of ACME ORDER
// ENTRY SYSTEM REL 14.7C. Same wrapt skeleton, same routes, but pointed
// at a binary nobody could write an API for from documentation alone.
//
// Curl tour once running:
//   curl localhost:7778/rows
//   curl -X POST --data 'OPER001' localhost:7778/run    # login
//   curl -X POST --data 'WIDGETS' localhost:7778/run    # password
//   curl -X POST --data '1' localhost:7778/run          # MAIN MENU -> CUSTOMER INQUIRY
//   curl -X POST --data '10002' localhost:7778/run      # look up customer
//   curl localhost:7778/rows | tail -10                 # read the screen

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Text, Terminal } from '@reactjit/runtime/primitives';
import { useHost } from '@reactjit/runtime/hooks/useHost';
import { useTerminal } from '@reactjit/runtime/hooks/useTerminal';

const PORT = 7778;
const LAUNCHER = '/tmp/legacy/run-acme.sh';

const writePty = (data: string) => (globalThis as any).__vterm_write?.(0, data);

const ROUTES = [
  { path: '/', kind: 'handler' as const },
  { path: '/rows', kind: 'handler' as const },
  { path: '/screen', kind: 'handler' as const },
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

export default function WraptAcme() {
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
            wrapt: 'acme-order-entry-rel-14.7c',
            launcher: LAUNCHER,
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

        // /screen — same as /rows but only non-empty rows, easier on eyes
        if (req.method === 'GET' && req.path === '/screen') {
          const rows = allRowsText(sem).filter((r) => r.trim().length > 0);
          res.send(200, 'text/plain', rows.join('\n'));
          return;
        }

        if (req.method === 'GET' && req.path === '/state') {
          res.send(200, 'application/json', JSON.stringify(sem.state() ?? {}, null, 2));
          return;
        }

        if (req.method === 'GET' && req.path === '/export') {
          sem.buildGraph();
          res.send(200, 'application/json', JSON.stringify(sem.export() ?? {}, null, 2));
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
    <Col style={{ width: '100%', height: '100%', backgroundColor: '#001100' }}>
      <Row style={{ padding: 8, gap: 16, backgroundColor: '#003300' }}>
        <Text style={{ color: '#33ff33', fontWeight: 'bold' }}>wrapt :: ACME ORDER ENTRY REL 14.7C</Text>
        <Text style={{ color: '#88cc88' }}>{`http://localhost:${PORT}`}</Text>
        <Text style={{ color: host.state === 'running' ? '#33ff33' : '#ff3333' }}>
          {host.state}
        </Text>
        <Text style={{ color: '#88cc88' }}>{`hits: ${hits}`}</Text>
        <Text style={{ color: '#66aa66' }}>{lastPath || '—'}</Text>
      </Row>
      <Box style={{ flexGrow: 1, padding: 4, backgroundColor: '#000000' }}>
        <Terminal shell={LAUNCHER} style={{ width: '100%', height: '100%' }} />
      </Box>
    </Col>
  );
}
