// claude-inner — fullscreen Terminal wrapping claude-code.
//
// Runs INSIDE the Firecracker VM as a vterm layer between Claude Code's
// complex Ink TUI and the vsock byte stream. Our vterm parses Claude's
// ANSI output locally and re-emits a flat character grid — simple
// cursor-move + SGR that the outer vterm handles without corruption.
//
// Build: scripts/ship-tui tui/examples/claude-inner.tsx
// The binary is staged on the VM's cred drive by scripts/claude-ss.

import * as React from 'react';
import { Terminal } from '../../runtime/primitives';
import { subscribeKey } from '../host';
import { writeFile } from '../../runtime/hooks/fs';

// Materialize a launcher that runs claude with --mcp-config when the
// host-baked config file exists. The Terminal primitive only takes a
// single binary path (no args), so the only way to attach flags is to
// point shell= at a script that does the exec for us.
//
// /etc/claude-mcp-config.json is written into the rootfs by
// framework/firecracker/recipes/worker-minimal.ts; it lists the bridge
// MCP server at http://172.16.0.1:7781/mcp. When that file is present
// claude here connects to the bridge over plain HTTP MCP so
// bridge.respond / bridge.call_tool become reachable from inside the
// VM. Without the file (older image) the launcher falls back to plain
// claude.
const LAUNCHER_PATH = '/tmp/claude-inner-launcher.sh';

function ensureInnerLauncher(): string {
  // --dangerously-skip-permissions trips Claude Code's root check
  // (claude inside the VM runs as PID 1's descendant = root). The
  // bridge MCP tools (bridge.respond / bridge.call_tool) are
  // pre-approved via settings.json's `permissions.allow` instead,
  // which Claude Code accepts at any user level. Other tool gating
  // stays under the host-side IFTTT recipes.
  const script =
    '#!/bin/sh\n' +
    'MCP_CFG=/etc/claude-mcp-config.json\n' +
    'if [ -f "$MCP_CFG" ]; then\n' +
    '  exec /usr/local/bin/claude --mcp-config "$MCP_CFG"\n' +
    'fi\n' +
    'exec /usr/local/bin/claude\n';
  try {
    writeFile(LAUNCHER_PATH, script);
    const g: any = globalThis;
    g.__spawnSync?.('chmod', JSON.stringify(['+x', LAUNCHER_PATH]), '');
  } catch (e: any) {
    console.error('[claude-inner] failed to write launcher:', e?.message || e);
    return '/usr/local/bin/claude';
  }
  return LAUNCHER_PATH;
}

export default function ClaudeInner() {
  // useState init runs once, before Terminal mounts — so the script
  // exists by the time the PTY spawn happens.
  const [shellPath] = React.useState(ensureInnerLauncher);

  // Fallback for any keystroke the Terminal isn't currently focused
  // for — write it directly into the live PTY. Under the new
  // per-session vterm API the session name MUST be passed; '' falls
  // through to DEFAULT_SESSION which is also what <Terminal> binds
  // to here (no session prop = "tui-<node.id>" pinned by host.ts,
  // but the live pipe is still the only one this cart owns, so
  // DEFAULT_SESSION points at it).
  React.useEffect(() => subscribeKey(k => {
    const g: any = globalThis;
    if (typeof g.__vterm_write === 'function') {
      g.__vterm_write('', k);
    }
  }), []);

  return (
    <Terminal
      key="claude"
      shell={shellPath}
      autoFocus
      session="default"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
