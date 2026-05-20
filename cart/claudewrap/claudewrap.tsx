// claudewrap — Claude operator cart.
//
// One face on a shared substrate (TUI + Window + bridge + recipes).
// Plan: ~/.claude/plans/alright-so-heres-what-transient-stroustrup.md
//
// Folded from:
//   - tui/examples/claudewrap.tsx           (TUI shell + IFTTT + live recipes)
//   - cart/claude_openai_bridge_tui.tsx     (HTTP bridge + MCP server)
//
// Build:    scripts/ship-tui cart/claudewrap/claudewrap.tsx
// Run:      zig-out/bin/claudewrap

import * as React from 'react';
import App from './App';
import './ifttt/side-effects';

export default function ClaudewrapCart() {
  return <App />;
}
