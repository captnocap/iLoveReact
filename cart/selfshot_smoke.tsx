// selfshot_smoke — the SELFSHOT-0606 capability's smoke cart.
//
// USER RULING (2026-06-06): desktop/X11 capture of the user's system is
// BANNED; the app screenshots ITSELF. This cart proves BOTH self-capture
// paths on one boot, with zero desktop access (run it under rjit shot —
// ZIGOS_HEADLESS=1 keeps the window hidden):
//
//   1. the LIVE host door: ~0.8s after mount it calls captureFrame()
//      (runtime/capture.ts → __capture_frame → gpu/capture.zig readback) and
//      writes RJIT_SELFSHOT_OUT (default selfshot-door.png) — the exact path
//      the in-app console verb `shot` rides;
//   2. the ENV one-shot: `rjit shot selfshot_smoke` captures the same boot
//      through ZIGOS_SCREENSHOT and asserts the PNG.
//
// The surface is deliberately high-contrast (distinct bands + text) so a
// black/empty capture can't pass for a real one.

import { useEffect, useState } from 'react';
import { Box, Col, Row, Text } from '@reactjit/primitives';
import { captureFrame } from '@reactjit/capture';
import { callHost } from '@reactjit/ffi';

const BANDS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];

export default function SelfshotSmoke() {
  const [doorStatus, setDoorStatus] = useState('door capture pending…');

  useEffect(() => {
    const t = setTimeout(() => {
      const path = callHost<string | null>('__env_get', null, 'RJIT_SELFSHOT_OUT') ?? 'selfshot-door.png';
      const ok = captureFrame(path);
      setDoorStatus(ok ? `door capture → ${path}` : 'door capture REFUSED');
      console.warn(`[selfshot] __capture_frame(${path}) accepted=${ok}`);
    }, 800);
    return () => clearTimeout(t);
  }, []);

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: '#0b1320' }}>
      <Row style={{ flexGrow: 1 }}>
        {BANDS.map((c) => (
          <Box key={c} style={{ flexGrow: 1, height: '100%', backgroundColor: c }} />
        ))}
      </Row>
      <Col style={{ padding: 24, gap: 8 }}>
        <Text fontSize={28} color="#f8fafc" style={{ fontWeight: 800 }}>SELFSHOT-0606</Text>
        <Text fontSize={14} color="#cbd5e1">the app screenshots ITSELF — the desktop is off-limits</Text>
        <Text fontSize={12} color="#86efac" style={{ fontFamily: 'monospace' }}>{doorStatus}</Text>
      </Col>
    </Col>
  );
}
