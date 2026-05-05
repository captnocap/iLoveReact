// Headless smoke test — render the cart, snapshot the grid as plain text,
// print it. No alt-screen, no stdin. Verifies layout + paint without
// taking over the terminal.
import { createElement } from 'react';
import { render, headlessSnapshot } from '../host';
import App from '../examples/counter-bun';

render(createElement(App));

// Wait two ticks so React's commit and the microtask-scheduled paint settle.
setTimeout(() => {
  const snap = headlessSnapshot(80, 18);
  process.stdout.write('--- snapshot 80x18 ---\n');
  process.stdout.write(snap + '\n');
  process.stdout.write('--- end ---\n');
  process.exit(0);
}, 50);
