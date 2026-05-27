// Launcher materialization for the bridge.
//
// Two consumers, two shapes:
//
//   - ensureClaudeLauncher(port) — the legacy single launcher. Used by
//     claudewrap's ATTACHED mode (a visible <Terminal session="default">
//     owns one claude) and kept for back-compat. Idempotent: rewrites
//     each boot so a stale launcher from a previous bridge version
//     doesn't stick around.
//
//   - writeSpawnLauncher({ model, port, key, resumeSid }) — a PER-THREAD
//     launcher script for the headless process pool. The framework execs
//     `spawnShell` as a BARE binary path (pty.zig: execvp(shell,[shell,
//     null]) — no shell, no args), so every thread needs its OWN script
//     file carrying its --resume sid and model-specific command. One
//     script per spawn, keyed by the sid (resume) or a random token
//     (fresh).
//
// The MCP config wires the in-VM/in-process claude to this bridge's /mcp
// endpoint via `--mcp-config`.

import { mkdir, writeFile } from '../../../runtime/hooks/fs';
import { cwdGet, envGet, shellQuote } from './common';

const LAUNCHER_DIR = '/tmp/reactjit-bridge';
const LAUNCHER_PATH = `${LAUNCHER_DIR}/claude-launcher.sh`;
const MCP_CONFIG_PATH = `${LAUNCHER_DIR}/mcp-config.json`;

// The two selectable backends the bridge exposes as OpenAI models.
//   disk-claude        → claude on the user's disk, in the process cwd.
//   firecracker-claude → claude isolated inside a firecracker VM
//                        (scripts/claude-ss boots it as PID 1).
export type BridgeModel = 'disk-claude' | 'firecracker-claude';

export function isBridgeModel(s: string): s is BridgeModel {
  return s === 'disk-claude' || s === 'firecracker-claude';
}

// Conversational nudge appended to disk-claude's system prompt so it
// behaves like a chat assistant rather than a task-seeking coding agent.
const CHAT_PERSONA =
  'You are a conversational chat assistant. Reply directly and naturally to ' +
  "what the user says. Brief messages like 'test', 'ping', or 'hi' are casual " +
  'conversation, not task requests — answer in kind and do not ask what the ' +
  'user would like you to do.';

function chmodX(path: string): void {
  const g: any = globalThis;
  // __spawnSync from cli_bindings takes (cmd, argsJsonArray, stdinContent).
  try { g.__spawnSync?.('chmod', JSON.stringify(['+x', path]), ''); } catch {}
}

function writeMcpConfig(port: number): void {
  mkdir(LAUNCHER_DIR);
  const mcpConfig = JSON.stringify({
    mcpServers: {
      bridge: { type: 'http', url: `http://127.0.0.1:${port}/mcp` },
    },
  }, null, 2);
  writeFile(MCP_CONFIG_PATH, mcpConfig);
}

export function ensureClaudeLauncher(port: number): string {
  writeMcpConfig(port);
  const launcher = '#!/bin/sh\n' + `exec claude --mcp-config ${MCP_CONFIG_PATH}\n`;
  writeFile(LAUNCHER_PATH, launcher);
  chmodX(LAUNCHER_PATH);
  return LAUNCHER_PATH;
}

export interface SpawnLauncherOpts {
  model: BridgeModel;
  port: number;
  /** The session id (a valid UUID) we assign to this claude via
   *  `--session-id` (fresh) or `--resume` (reattach). We pick it so the
   *  bridge knows the transcript path up front — no discovery race, no
   *  capture-before-paste deadlock. Also names the script file. */
  sessionId: string;
  /** When true, reattach to an existing session (`--resume`) instead of
   *  starting a new one (`--session-id`). */
  resume?: boolean;
}

export function writeSpawnLauncher(opts: SpawnLauncherOpts): string {
  const path = `${LAUNCHER_DIR}/launch-${opts.sessionId}.sh`;
  mkdir(LAUNCHER_DIR);
  let cmd: string;
  if (opts.model === 'firecracker-claude') {
    const root = envGet('REACTJIT_ROOT') || cwdGet();
    // NOTE: claude-ss boots an isolated VM and controls the in-VM claude
    // invocation itself — it doesn't take --session-id, and the VM's
    // transcript isn't on the host. Wiring that is future work; the pool
    // fails firecracker fast rather than spawning a VM that can't be
    // observed. This launcher stays for when that plumbing lands.
    cmd = `exec ${shellQuote(`${root}/scripts/claude-ss`)}`;
  } else {
    // No --mcp-config: that registered an MCP server literally named
    // "bridge", which Claude Code lists at startup — so claude would say
    // "pong — bridge is live" instead of just "pong". The pool resolves
    // replies from the transcript and claude uses its OWN native tools,
    // so the bridge MCP server isn't needed. This makes a pool claude
    // identical to a normal `claude` session in this directory.
    const idFlag = opts.resume
      ? `--resume ${shellQuote(opts.sessionId)}`
      : `--session-id ${shellQuote(opts.sessionId)}`;
    // --append-system-prompt nudges Claude Code (a coding agent by
    // default) toward plain chat, so a bare "test" gets a natural reply
    // instead of "that doesn't tell me what you'd like me to do." Tune
    // CHAT_PERSONA to taste; it can't fully override the base coding-agent
    // framing + CLAUDE.md, but it noticeably softens the tone.
    cmd = `exec claude ${idFlag} --append-system-prompt ${shellQuote(CHAT_PERSONA)}`;
  }
  // REACTJIT_BRIDGE_CHAT marks this as a bridge-driven chat session so
  // project hooks can opt out (session-ping.sh skips its "You are session
  // X" injection, which a fresh claude otherwise parrots back). Claude
  // inherits it; so do the hook subprocesses it spawns.
  writeFile(path, `#!/bin/sh\nexport REACTJIT_BRIDGE_CHAT=1\n${cmd}\n`);
  chmodX(path);
  return path;
}

export const BRIDGE_DIR = LAUNCHER_DIR;
export const BRIDGE_MCP_CONFIG = MCP_CONFIG_PATH;
export const BRIDGE_LAUNCHER = LAUNCHER_PATH;
