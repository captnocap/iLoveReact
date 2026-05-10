// event_loop_autotest — autopilot cart that exercises useIFTTT under
// the real React reconciler, the real reactjit framework, and the real
// bus. Self-driving: fires all events from useEffect timers,
// accumulates pass/fail in refs, surfaces results both on screen AND
// via console.log.
//
// Build:   ./scripts/ship event_loop_autotest
// Run:     ./zig-out/bin/event_loop_autotest
//
// The binary boots, runs the autotest, prints a per-section matrix
// and final PASS/FAIL count to stdout. The window also displays the
// same. Quit when finished (the cart calls __hostExit if available).

import React, { useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Text, ScrollView } from '@reactjit/runtime/primitives';
import { useIFTTT, busEmit, setSharedState } from '@reactjit/runtime/hooks/useIFTTT';

// ── Result accumulator (lives in refs so the test driver isn't
// re-mounted by React state churn) ───────────────────────────────────

type Result = { name: string; pass: boolean; note?: string; section: string };

function newAcc() {
  const results: Result[] = [];
  const ok = (section: string, name: string, cond: boolean, note?: string) =>
    results.push({ section, name, pass: cond, note });
  const eq = <T,>(section: string, name: string, actual: T, expected: T) => {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    ok(section, name, a === b, a === b ? undefined : `expected ${b}, got ${a}`);
  };
  return { results, ok, eq };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Cart ───────────────────────────────────────────────────────────

export default function EventLoopAutotest() {
  const [done, setDone] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [funcGate, setFuncGate] = useState(false);  // for plain function trigger — needs render cadence
  const funcGateRef = useRef(false);                 // synced mirror for composable function leaves (avoids closure trap)
  funcGateRef.current = funcGate;
  const ranRef = useRef(false);

  // Counters incremented from useIFTTT action callbacks. Refs so we
  // can read them at any point without depending on React render
  // cycles.
  const c = {
    t1String: useRef(0),    // string trigger + function action
    t1LastEvent: useRef<any>(null),
    t2Match: useRef(0),
    t3Count: useRef(0),
    t4Function: useRef(0),
    t5State: useRef(0),
    t6Seq: useRef(0),
    t7Repeat: useRef(0),
    t8Send: useRef(0),
    t9CompAll: useRef(0),
  };

  // Test 1 — string trigger + function action receives payload + count.
  useIFTTT('test:cart:foo', (payload) => {
    c.t1String.current++;
    c.t1LastEvent.current = payload;
  });

  // Test 2 — match: source.
  useIFTTT('match:test:cart:line::DANGER', () => { c.t2Match.current++; });

  // Test 3 — count: source, edge-triggered.
  useIFTTT('count:test:cart:beep::3:5000', () => { c.t3Count.current++; });

  // Test 4 — function trigger with edge detection (false→true).
  // MUST read React state (not a ref) — plain function triggers
  // re-evaluate on render cadence, and refs don't trigger renders.
  useIFTTT(() => funcGate, () => { c.t4Function.current++; });

  // Test 5 — state: source.
  useIFTTT('state:mood:happy', () => { c.t5State.current++; });

  // Test 6 — composable seq within a window.
  useIFTTT(
    { seq: ['test:cart:a', 'test:cart:b'], within: 1000 },
    () => { c.t6Seq.current++; },
  );

  // Test 7 — repeat: source.
  useIFTTT('repeat:test:cart:claims::5:0.5', () => { c.t7Repeat.current++; });

  // Test 8 — string action `send:`.
  useIFTTT('test:cart:trigger', 'send:test:cart:relayed');
  useIFTTT('test:cart:relayed', () => { c.t8Send.current++; });

  // Test 9 — composable {all}: bus event + sustained function leaf.
  // The function leaf MUST read through a ref, not directly from
  // state. Closure semantics: useIFTTT may not re-bind the composable
  // when only state inside the leaf changes, so a closure over
  // `funcGate` would stay stale. The ref approach captures the ref
  // OBJECT in the closure; `.current` always reads the latest value
  // at poll time. This is the documented pattern for sustained
  // function conditions.
  useIFTTT(
    { all: ['test:cart:gate', () => funcGateRef.current === true] },
    () => { c.t9CompAll.current++; },
  );

  // ── Driver ──────────────────────────────────────────────────────
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const acc = newAcc();
    (async () => {
      console.log('[autotest] starting');

      // 1. String trigger.
      busEmit('test:cart:foo', { hello: 'world' });
      busEmit('test:cart:foo', { hello: 'again' });
      await wait(20);
      acc.eq('useIFTTT (string trigger)', 'fires twice', c.t1String.current, 2);
      acc.eq('useIFTTT (string trigger)', 'last payload received', c.t1LastEvent.current?.hello, 'again');

      // 2. match: source.
      busEmit('test:cart:line', 'all is well');
      busEmit('test:cart:line', 'this is DANGER stuff');
      busEmit('test:cart:line', { line: 'more DANGER ahead' });
      await wait(20);
      acc.eq('match:', 'fires on substring hit (string + object payload)', c.t2Match.current, 2);

      // 3. count: source.
      busEmit('test:cart:beep', 1);
      busEmit('test:cart:beep', 2);
      acc.eq('count:', 'not yet at threshold', c.t3Count.current, 0);
      busEmit('test:cart:beep', 3);
      busEmit('test:cart:beep', 4);
      busEmit('test:cart:beep', 5);
      await wait(20);
      acc.eq('count:', 'edge-triggered (single fire on threshold cross)', c.t3Count.current, 1);

      // 4. Function trigger (false→true edge).
      acc.eq('function trigger', 'starts not fired', c.t4Function.current, 0);
      // Flip via real React state so a re-render happens and the
      // function trigger re-evaluates.
      setFuncGate(true);
      await wait(80);
      acc.ok('function trigger', 'fires on false→true edge', c.t4Function.current >= 1,
        `count=${c.t4Function.current}`);

      // 5. state: source.
      setSharedState('mood', 'sad');
      await wait(20);
      acc.eq('state:', 'no fire on non-matching value', c.t5State.current, 0);
      setSharedState('mood', 'happy');
      await wait(20);
      acc.eq('state:', 'fires on matching value', c.t5State.current, 1);

      // 6. Composable seq.
      busEmit('test:cart:a');
      busEmit('test:cart:b');
      await wait(20);
      acc.eq('composable seq', 'fires when both arrive in window', c.t6Seq.current, 1);
      busEmit('test:cart:b');  // out-of-order, no preceding 'a' freshly
      await wait(20);
      acc.ok('composable seq', 'no fire on b alone', c.t6Seq.current === 1,
        `count=${c.t6Seq.current}`);

      // 7. repeat: source.
      busEmit('test:cart:claims', 'the bug is fixed now');
      busEmit('test:cart:claims', 'the moon is bright tonight');
      busEmit('test:cart:claims', 'the bug is fixed again');
      await wait(20);
      acc.eq('repeat:', 'fires on near-duplicate claim', c.t7Repeat.current, 1);

      // 8. send: action.
      busEmit('test:cart:trigger', { x: 1 });
      await wait(20);
      acc.eq('send: action', 'relays through bus', c.t8Send.current, 1);

      // 9. Composable {all} — bus + sustained function.
      busEmit('test:cart:gate', { ready: true });
      await wait(20);
      acc.ok('composable all', 'fires when both leaves true', c.t9CompAll.current >= 1,
        `count=${c.t9CompAll.current}`);

      // ── Print to console ────────────────────────────────────────
      console.log('');
      console.log('[autotest] results:');
      let pass = 0, fail = 0;
      const failures: string[] = [];
      let lastSec = '';
      for (const r of acc.results) {
        if (r.section !== lastSec) {
          console.log(`  [${r.section}]`);
          lastSec = r.section;
        }
        const mark = r.pass ? '✓' : '✗';
        const note = r.note ? ` — ${r.note}` : '';
        console.log(`    ${mark} ${r.name}${note}`);
        if (r.pass) pass++; else { fail++; failures.push(`${r.section} / ${r.name}${note}`); }
      }
      console.log('');
      console.log(`[autotest] ${pass} passed, ${fail} failed`);
      if (fail > 0) {
        console.log('[autotest] FAILURES:');
        for (const f of failures) console.log('  • ' + f);
      }

      setResults(acc.results);
      setDone(true);

      // Auto-exit so this can be run as part of a CI / one-shot smoke.
      const g = globalThis as any;
      if (typeof g.__hostExit === 'function') {
        await wait(100);
        g.__hostExit(fail > 0 ? 1 : 0);
      }
    })();
  }, []);

  // ── Render ─────────────────────────────────────────────────────
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.filter((r) => !r.pass).length;
  const sections = Array.from(new Set(results.map((r) => r.section)));

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#090d13', padding: 16 }}>
      <Col style={{ gap: 12, width: '100%', height: '100%' }}>
        <Row style={{ gap: 12, alignItems: 'center' }}>
          <Text fontSize={16} color="#eef2f8" style={{ fontWeight: 'bold' }}>
            event-loop autotest
          </Text>
          {!done && <Text fontSize={11} color="#7d8a9a">running…</Text>}
          {done && (
            <Text fontSize={12} color={failCount === 0 ? '#7ed957' : '#ff6e6e'} style={{ fontWeight: 'bold' }}>
              {passCount} passed, {failCount} failed
            </Text>
          )}
        </Row>
        <ScrollView style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
          <Col style={{ gap: 6 }}>
            {sections.map((sec) => (
              <Col key={sec} style={{ gap: 2 }}>
                <Text fontSize={11} color="#5db4ff" style={{ paddingTop: 6 }}>[{sec}]</Text>
                {results.filter((r) => r.section === sec).map((r, i) => (
                  <Row key={`${sec}-${i}`} style={{ gap: 8, paddingLeft: 8 }}>
                    <Text fontSize={11} color={r.pass ? '#7ed957' : '#ff6e6e'}>{r.pass ? '✓' : '✗'}</Text>
                    <Text fontSize={11} color="#eef2f8">{r.name}</Text>
                    {r.note && <Text fontSize={10} color="#7d8a9a">— {r.note}</Text>}
                  </Row>
                ))}
              </Col>
            ))}
          </Col>
        </ScrollView>
      </Col>
    </Box>
  );
}
