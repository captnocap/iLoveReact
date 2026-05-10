// _probe.tsx — quick layout-debug entry. Mounts Counter, captures one
// frame at a fixed grid size, prints it, then exits. Lets us see what
// the layout produces without an interactive terminal.

import * as React from 'react';
import Counter from './counter';
import { headlessSnapshot, leave } from '../host';

export default function Probe() {
  React.useEffect(() => {
    setTimeout(() => {
      // Drop alt-screen so the dump is readable in a captured stdout.
      leave();
      const grid = headlessSnapshot(80, 24);
      // After leave(), the alt screen is restored; writing to stdout
      // lands in the user's normal terminal (or captured stdout).
      process.stdout.write('--- snapshot 80x24 ---\n' + grid + '\n--- end ---\n');
      process.exit(0);
    }, 100);
  }, []);
  return React.createElement(Counter as any, {});
}
