// counter — minimal cart proving Box/Text/Pressable + focus + Enter
// activation through the shared runtime/primitives + renderer/hostConfig
// stack. Run with: scripts/tui tui/examples/counter.tsx

import * as React from 'react';
import { Box, Row, Col, Text, Pressable } from '../../runtime/primitives';
import { subscribeKey } from '../host';

const palette = {
  page: '#0b1020',
  card: '#111827',
  rail: '#0f172a',
  border: '#334155',
  accent: '#fbbf24',
  ink: '#e5e7eb',
  dim: '#94a3b8',
  good: '#34d399',
  bad: '#f87171',
};

export default function Counter() {
  const [count, setCount] = React.useState(0);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 200);
    return () => clearInterval(t);
  }, []);

  // App-level shortcuts that ignore focus — `q` quits, `-` decrements.
  // Tab cycles focus; Enter activates the focused Pressable; the focus
  // manager handles those without us subscribing.
  React.useEffect(() => subscribeKey(k => {
    if (k === 'q') process.exit(0);
    if (k === '-') setCount(n => Math.max(0, n - 1));
    if (k === 'r') setCount(0);
  }), []);

  const spinner = '|/-\\'[tick % 4];

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: palette.page, padding: 1, flexDirection: 'column', gap: 1 }}>
      <Row style={{ gap: 2, alignItems: 'center' }}>
        <Box style={{ backgroundColor: '#1d4ed8', padding: 1, borderWidth: 1, borderColor: '#60a5fa' }}>
          <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>ReactJIT TUI · runtime/primitives</Text>
        </Box>
        <Text style={{ color: palette.dim }}>tick {tick} {spinner}</Text>
      </Row>

      <Col style={{ borderWidth: 1, borderColor: palette.border, padding: 1, gap: 1, flexGrow: 1 }}>
        <Text style={{ color: palette.accent, fontWeight: 'bold' }}>state</Text>

        <Row style={{ gap: 2 }}>
          <Box style={{ backgroundColor: '#0f766e', padding: 1, width: 22, alignItems: 'center' }}>
            <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>count: {count}</Text>
          </Box>
          <Col style={{ gap: 0 }}>
            <Text style={{ color: palette.dim }}>Tab        — cycle focus</Text>
            <Text style={{ color: palette.dim }}>Enter      — activate focused</Text>
            <Text style={{ color: palette.dim }}>-          — decrement</Text>
            <Text style={{ color: palette.dim }}>r          — reset</Text>
            <Text style={{ color: palette.dim }}>q / ⌃C     — quit</Text>
          </Col>
        </Row>

        <Row style={{ gap: 2 }}>
          <Pressable onPress={() => setCount(n => n + 1)}>
            <Box style={{ backgroundColor: palette.card, padding: 1, borderWidth: 1, borderColor: palette.border }}>
              <Text style={{ color: palette.ink }}>+ increment</Text>
            </Box>
          </Pressable>
          <Pressable onPress={() => setCount(n => Math.max(0, n - 1))}>
            <Box style={{ backgroundColor: palette.card, padding: 1, borderWidth: 1, borderColor: palette.border }}>
              <Text style={{ color: palette.ink }}>- decrement</Text>
            </Box>
          </Pressable>
          <Pressable onPress={() => setCount(0)}>
            <Box style={{ backgroundColor: palette.card, padding: 1, borderWidth: 1, borderColor: palette.border }}>
              <Text style={{ color: palette.bad }}>* reset</Text>
            </Box>
          </Pressable>
        </Row>

        <Row style={{ gap: 1, flexWrap: 'wrap', flexGrow: 1 }}>
          {Array.from({ length: count }).map((_, i) => (
            <Box key={i} style={{ backgroundColor: '#7c3aed', width: 2, height: 1 }} />
          ))}
        </Row>
      </Col>

      <Text style={{ color: '#64748b' }}>same primitives the GPU host uses · paint to ANSI · 24-bit color · dirty diff</Text>
    </Box>
  );
}
