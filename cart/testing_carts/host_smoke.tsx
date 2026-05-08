/**
 * host_smoke — minimal cart that exercises the networking trichotomy
 * (useHost / useConnection) plus useTelemetry. Used to flip the gate flags
 * in scripts/ship and verify the full binding surface compiles + registers.
 *
 * Renders the live state of each kind. Endpoints/cmds are chosen so the
 * cart starts up even with no external services running:
 *   - useHost http  on 0.0.0.0:8400 (listening)
 *   - useHost ws    on 0.0.0.0:8401 (listening)
 *   - useConnection tcp to 127.0.0.1:8400 (loopback to our own http server)
 *   - useConnection udp to 127.0.0.1:8400 (loopback; udp will silently never receive)
 *   - useHost process: /bin/echo "hello from useHost"
 *   - useTelemetry fps (1Hz poll)
 */

import * as React from 'react';
import { useHost } from '@reactjit/runtime/hooks/useHost';
import { useProcess } from '@reactjit/runtime/hooks/useProcess';
import { useConnection } from '@reactjit/runtime/hooks/useConnection';
import { useTelemetry } from '@reactjit/runtime/hooks/useTelemetry';

export default function App() {
  const http = useHost({
    kind: 'http',
    port: 8400,
    routes: [{ path: '/', kind: 'handler' }],
    onRequest: (_req, res) => res.send(200, 'text/plain', 'hi'),
  });

  const ws = useHost({
    kind: 'ws',
    port: 8401,
    onMessage: (cid, data) => ws.send(cid, `echo: ${data}`),
  });

  const tcp = useConnection({
    kind: 'tcp',
    host: '127.0.0.1',
    port: 8400,
    onData: () => {},
  });

  const udp = useConnection({
    kind: 'udp',
    host: '127.0.0.1',
    port: 8400,
  });

  const proc = useProcess({
    cmd: '/bin/echo',
    args: ['hello from useHost'],
    onStdout: () => {},
  });

  const { value: fps } = useTelemetry({ kind: 'fps', pollMs: 1000 });

  return (
    <div style={{ padding: 24, fontFamily: 'monospace' }}>
      <h1>useHost + useConnection + useTelemetry smoke</h1>
      <pre>{JSON.stringify({
        http: http.state,
        ws: ws.state,
        tcp: tcp.state,
        udp: udp.state,
        process: { state: proc.state, pid: proc.pid },
        fps,
      }, null, 2)}</pre>
    </div>
  );
}
