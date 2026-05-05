// Verify: (1) text updates after state change, (2) flexWrap wraps a row.
import { createElement, useState, useEffect } from 'react';
import { render, headlessSnapshot } from './host';

let bump: () => void = () => {};

function App() {
  const [n, setN] = useState(0);
  useEffect(() => { bump = () => setN(x => x + 1); }, []);
  return createElement(
    'box',
    { width: 'fill', height: 'fill', padding: 1, gap: 1 },
    createElement('text', { fg: '#fbbf24', bold: true }, 'count = ', n),
    createElement(
      'box',
      { flexDirection: 'row', gap: 1, wrap: true, height: 4 },
      ...Array.from({ length: n }).map((_, i) =>
        createElement('box', { key: i, bg: '#7c3aed', width: 2, height: 1 },
          createElement('text', null, '##'))
      ),
    ),
  );
}

render(createElement(App));

const W = 30, H = 6;
setTimeout(() => {
  process.stdout.write('--- n=0 ---\n' + headlessSnapshot(W, H) + '\n');
  for (let i = 0; i < 17; i++) bump();
  setTimeout(() => {
    process.stdout.write('--- n=17 ---\n' + headlessSnapshot(W, H) + '\n');
    process.exit(0);
  }, 30);
}, 30);
