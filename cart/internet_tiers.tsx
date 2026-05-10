/**
 * internet_tiers — verify tier 0 (useTheInternet) and tier 1 (fetch/useHost/useConnection)
 * end-to-end in a single cart.
 *
 * Hosts an HTTP server and a WS server, then hits both from the client side
 * using the tier-1 APIs. Renders live state + last response so success/failure
 * is visible without opening the console.
 */

import { useEffect, useState } from 'react';
import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { useHost } from '@reactjit/runtime/hooks/useHost';
import { useConnection } from '@reactjit/runtime/hooks/useConnection';
import { fetch, getAsync } from '@reactjit/runtime/hooks/fetch';

const HTTP_PORT = 9400;
const WS_PORT = 9401;

export default function App() {
  // ── Tier 1: inbound hosts ─────────────────────────────────────────
  const httpSrv = useHost({
    kind: 'http',
    port: HTTP_PORT,
    routes: [{ path: '/', kind: 'handler' }],
    onRequest: (_req, res) => res.send(200, 'application/json', '{"ok":true,"msg":"hello from httpSrv"}'),
  });

  const [wsLastMsg, setWsLastMsg] = useState<string>('—');
  const wsSrv = useHost({
    kind: 'ws',
    port: WS_PORT,
    onMessage: (clientId, data) => {
      wsSrv.send(clientId, `echo:${data}`);
    },
  });

  // ── Tier 1: outbound connections ──────────────────────────────────
  const [tcpData, setTcpData] = useState<string>('—');
  const tcp = useConnection({
    kind: 'tcp',
    host: '127.0.0.1',
    port: HTTP_PORT,
    onData: (data) => setTcpData(data.slice(0, 200)),
  });

  const [wsClientMsg, setWsClientMsg] = useState<string>('—');
  const wsClient = useConnection({
    kind: 'ws',
    url: `ws://127.0.0.1:${WS_PORT}`,
    onOpen: () => wsClient.send('ping'),
    onMessage: (data) => setWsClientMsg(data),
  });

  const [httpStreamData, setHttpStreamData] = useState<string>('—');
  const httpStream = useConnection({
    kind: 'http',
    url: `http://127.0.0.1:${HTTP_PORT}/`,
    onChunk: (data) => setHttpStreamData(data.slice(0, 200)),
    onComplete: () => {},
  });

  // ── Tier 1: fetch() smoke ─────────────────────────────────────────
  const [fetchResult, setFetchResult] = useState<string>('—');
  const [getAsyncResult, setGetAsyncResult] = useState<string>('—');

  useEffect(() => {
    let alive = true;

    // Poll fetch() every 2s against our own HTTP server.
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/`);
        const j = await r.json();
        if (alive) setFetchResult(JSON.stringify(j));
      } catch (e: any) {
        if (alive) setFetchResult(`err: ${e?.message || e}`);
      }
    }, 2000);

    // One-shot getAsync.
    getAsync(`http://127.0.0.1:${HTTP_PORT}/`).then((r) => {
      if (alive) setGetAsyncResult(`${r.status} ${r.body.slice(0, 60)}`);
    }).catch((e: any) => {
      if (alive) setGetAsyncResult(`err: ${e?.message || e}`);
    });

    return () => { alive = false; clearInterval(iv); };
  }, []);

  // ── Render ────────────────────────────────────────────────────────
  const Section = ({ title, children }: { title: string; children: any }) => (
    <Col style={{ gap: 4, padding: 12, backgroundColor: '#0f1420', borderRadius: 8, borderWidth: 1, borderColor: '#1e293b' }}>
      <Text fontSize={12} color="#38bdf8" fontWeight="bold">{title}</Text>
      {children}
    </Col>
  );

  const KV = ({ k, v }: { k: string; v: string }) => (
    <Row style={{ gap: 8 }}>
      <Text fontSize={10} color="#64748b" style={{ width: 100 }}>{k}</Text>
      <Text fontSize={10} color="#e2e8f0">{v}</Text>
    </Row>
  );

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: '#020617', padding: 20, gap: 12 }}>
      <Text fontSize={16} color="#f8fafc">internet_tiers — tier 0 + tier 1 smoke</Text>

      <Section title="useHost (inbound)">
        <KV k="http state" v={httpSrv.state} />
        <KV k="http port" v={String(HTTP_PORT)} />
        <KV k="ws state" v={wsSrv.state} />
        <KV k="ws port" v={String(WS_PORT)} />
      </Section>

      <Section title="fetch (tier 1 HTTP)">
        <KV k="fetch()" v={fetchResult} />
        <KV k="getAsync()" v={getAsyncResult} />
      </Section>

      <Section title="useConnection (outbound)">
        <KV k="tcp state" v={tcp.state} />
        <KV k="tcp last data" v={tcpData} />
        <KV k="ws client state" v={wsClient.state} />
        <KV k="ws client msg" v={wsClientMsg} />
        <KV k="http stream state" v={httpStream.state} />
        <KV k="http stream chunk" v={httpStreamData} />
      </Section>
    </Col>
  );
}
