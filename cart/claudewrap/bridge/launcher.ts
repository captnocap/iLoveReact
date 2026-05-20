// ensureClaudeLauncher — materializes a shell launcher + MCP config
// the bridge spawns claude with. Idempotent: rewrites each boot so a
// stale launcher from a previous bridge version doesn't stick around.
//
// The launcher is what Terminal spawns instead of plain `claude`
// because <Terminal shell=…> only takes a binary name and we need to
// pass `--mcp-config <path>` to wire the in-VM claude to this bridge's
// MCP endpoint.
//
// Note: in claudewrap the live terminal runs `scripts/claude-ss` (a
// firecracker boot), not the launcher this materializes. The launcher
// path is still exposed because future plumbing may inject the same
// MCP config into the VM's claude settings — keeping the materialization
// in place preserves the option.

import { mkdir, writeFile } from '../../../runtime/hooks/fs';

const LAUNCHER_DIR = '/tmp/reactjit-bridge';
const LAUNCHER_PATH = `${LAUNCHER_DIR}/claude-launcher.sh`;
const MCP_CONFIG_PATH = `${LAUNCHER_DIR}/mcp-config.json`;

export function ensureClaudeLauncher(port: number): string {
  mkdir(LAUNCHER_DIR);
  const mcpConfig = JSON.stringify({
    mcpServers: {
      bridge: {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
      },
    },
  }, null, 2);
  writeFile(MCP_CONFIG_PATH, mcpConfig);
  const launcher =
    '#!/bin/sh\n' +
    `exec claude --mcp-config ${MCP_CONFIG_PATH}\n`;
  writeFile(LAUNCHER_PATH, launcher);
  // chmod +x. __spawnSync from cli_bindings takes (cmd, argsJsonArray,
  // stdinContent) and returns JSON {code, stdout, stderr}.
  const g: any = globalThis;
  try {
    g.__spawnSync?.('chmod', JSON.stringify(['+x', LAUNCHER_PATH]), '');
  } catch {}
  return LAUNCHER_PATH;
}

export const BRIDGE_DIR = LAUNCHER_DIR;
export const BRIDGE_MCP_CONFIG = MCP_CONFIG_PATH;
export const BRIDGE_LAUNCHER = LAUNCHER_PATH;
