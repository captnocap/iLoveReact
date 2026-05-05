import './preamble.js';
import { createElement, useState, useEffect } from 'react';
import { enter, leave, render, startInput, subscribeKey } from '../host';

declare const __runEventLoop: (done?: () => void) => void;

function App() {
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
    <box width="fill" height="fill" bg="#0b1020" fg="#e5e7eb" padding={1} flexDirection="column" gap={1}>
      <box flexDirection="row" gap={2} align="center">
        <box bg="#1d4ed8" fg="#ffffff" padding={1} border borderColor="#60a5fa">
          <text bold>ReactJIT TUI · v8cli</text>
        </box>
        <text fg="#94a3b8">primitives compiled to ANSI · {spinner} tick {tick}</text>
      </box>

      <box border borderColor="#334155" padding={1} flexDirection="column" gap={1} flexGrow={1}>
        <text fg="#fbbf24" bold>state</text>
        <box flexDirection="row" gap={2}>
          <box bg="#0f766e" fg="#ffffff" padding={1} width={20} align="center">
            <text bold>count: {count}</text>
          </box>
          <box flexDirection="column" gap={0}>
            <text fg="#cbd5e1">space / enter → +1</text>
            <text fg="#cbd5e1">-               → -1</text>
            <text fg="#cbd5e1">q / ctrl-c       → quit</text>
          </box>
        </box>
        <box flexDirection="row" gap={1} wrap flexGrow={1}>
          {Array.from({ length: count }).map((_, i) => (
            <box key={i} bg="#7c3aed" width={2} height={1} />
          ))}
        </box>
      </box>

      <text fg="#64748b">flex / wrap / pad / gap / border / 24-bit color · stdin via __setStdinRaw + __readStdin</text>
    </box>
  );
}

enter();
startInput();
render(createElement(App));
__runEventLoop(() => { leave(); process.exit(0); });
