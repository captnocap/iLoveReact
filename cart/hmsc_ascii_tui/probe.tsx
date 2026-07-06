// probe.tsx - headless snapshot entry for the HMSC ASCII TUI cart.

import * as React from 'react';
import HmscAsciiTui from './index';
import { headlessSnapshot, leave } from '../../tui/host';

export default function HmscAsciiTuiProbe() {
  React.useEffect(() => {
    setTimeout(() => {
      leave();
      const grid = headlessSnapshot(120, 42);
      process.stdout.write('--- hmsc ascii tui snapshot 120x42 ---\n' + grid + '\n--- end ---\n');
      process.exit(0);
    }, 150);
  }, []);

  return <HmscAsciiTui />;
}
