// claude — minimal cart that fills the window with one <Terminal>
// spawned into `claude`. Proves the mouse-CSI strip fix: clicks inside
// the embedded TUI must focus/select inside claude-code itself, not
// leak as literal "<35;…M" text into the shell.
//
// Run with:  scripts/tui tui/examples/claude.tsx
// Leave with: Ctrl+] (drops Terminal focus) then q.

import * as React from 'react';
import { Box, Terminal } from '../../runtime/primitives';
import { subscribeKey, leave } from '../host';

export default function ClaudeCart() {
  React.useEffect(() => subscribeKey(k => {
    if (k === 'q') { leave(); process.exit(0); }
  }), []);

  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Terminal shell="claude" style={{ width: '100%', height: '100%' }} />
    </Box>
  );
}
