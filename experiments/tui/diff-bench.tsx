// Prove the dirty-frame diff: after the initial paint, a single-cell
// change should emit roughly one cursor-jump worth of ANSI, not a
// full-screen redraw.
import { createElement, useState, useEffect } from 'react';
import { enter, leave, render } from './host';

let captured = '';
let capturing = false;
const realWrite = process.stdout.write.bind(process.stdout);
(process.stdout as any).write = (s: any) => {
  if (capturing) captured += typeof s === 'string' ? s : s.toString();
  return true;
};

function App() {
  const [n, setN] = useState(0);
  useEffect(() => { (globalThis as any).__bump = () => setN(x => x + 1); }, []);
  return createElement(
    'box',
    { width: 'fill', height: 'fill', bg: '#0b1020', fg: '#e5e7eb', padding: 1, gap: 1 },
    createElement('text', { fg: '#fbbf24', bold: true }, `count = ${n}`),
    createElement('text', { fg: '#94a3b8' }, 'only the digit should change between frames'),
  );
}

Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
Object.defineProperty(process.stdout, 'rows', { value: 24, configurable: true });

capturing = true;
enter();
render(createElement(App));

setTimeout(() => {
  const frame1Bytes = captured.length;
  captured = '';
  (globalThis as any).__bump();
  setTimeout(() => {
    const frame2Bytes = captured.length;
    capturing = false;
    leave();
    process.stdout.write = realWrite;
    realWrite(`frame1 (full paint, 80x23 cells = 1840):  ${frame1Bytes} bytes\n`);
    realWrite(`frame2 (digit '0' → '1' changed)       :  ${frame2Bytes} bytes\n`);
    realWrite(`ratio                                  :  ${(frame2Bytes / frame1Bytes * 100).toFixed(2)}%\n`);
    process.exit(0);
  }, 30);
}, 30);
