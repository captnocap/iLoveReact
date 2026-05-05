import { useEffect, useState } from 'react';
import { subscribeKey } from '../host';

const Box = (props: any) => <box {...props} />;
const Text = (props: any) => <text {...props}>{props.children}</text>;

export default function App() {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => subscribeKey(k => {
    if (k === ' ' || k === '\r') setCount(n => n + 1);
    else if (k === '-') setCount(n => Math.max(0, n - 1));
  }), []);

  const spinner = '|/-\\'[tick % 4];

  return (
    <Box width="fill" height="fill" bg="#0b1020" fg="#e5e7eb" padding={1} flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2} align="center">
        <Box bg="#1d4ed8" fg="#ffffff" padding={1} border borderColor="#60a5fa">
          <Text bold>ReactJIT TUI</Text>
        </Box>
        <Text fg="#94a3b8">primitives compiled to ANSI · {spinner} tick {tick}</Text>
      </Box>

      <Box border borderColor="#334155" padding={1} flexDirection="column" gap={1} flexGrow={1}>
        <Text fg="#fbbf24" bold>state</Text>
        <Box flexDirection="row" gap={2}>
          <Box bg="#0f766e" fg="#ffffff" padding={1} width={20} align="center">
            <Text bold>count: {count}</Text>
          </Box>
          <Box flexDirection="column" gap={0}>
            <Text fg="#cbd5e1">space / enter → +1</Text>
            <Text fg="#cbd5e1">-               → -1</Text>
            <Text fg="#cbd5e1">q / ctrl-c       → quit</Text>
          </Box>
        </Box>
        <Box flexDirection="row" gap={1} wrap flexGrow={1}>
          {Array.from({ length: count }).map((_, i) => (
            <Box key={i} bg="#7c3aed" width={2} height={1} />
          ))}
        </Box>
      </Box>

      <Box flexDirection="row" gap={1} justify="between">
        <Text fg="#64748b">flex / pad / gap / border / 24-bit color all routed through the same reconciler stream</Text>
        <Text fg="#64748b">{new Date().toLocaleTimeString()}</Text>
      </Box>
    </Box>
  );
}
