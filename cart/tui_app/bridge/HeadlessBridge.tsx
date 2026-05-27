// HeadlessBridge — runs the claudewrap OpenAI-compatible HTTP bridge as a
// background process inside tui_app, with NO visible terminal.
//
// Why this exists: `claude -p` (print mode) is moving to per-token API
// billing. The subscription stays attached to the *interactive* claude
// TUI. claudewrap proved you can drive that interactive claude over an
// HTTP API — write the prompt into its PTY, read the reply back out of
// the JSONL transcript (+ MCP). claudewrap
// did it with a painted <Terminal>; this verifies the same bridge runs
// purely behind the scenes. Replies come from the JSONL transcript (+
// MCP) only — there is no terminal-scrape fallback, so TUI chrome like
// the welcome banner can never leak into a chat reply.
//
// The mechanism: BridgeHost(spawnShell=…) calls __vterm_open() to spawn
// interactive claude into the framework's DEFAULT_SESSION pipe and pumps
// that PTY on a timer — there is no <Terminal> anywhere in tui_app, so
// the headless claude owns DEFAULT_SESSION outright and every reader in
// BridgeHost addresses the right pipe with no extra plumbing.
//
// Integration is "selectable backend only": we seed a local
// openai_compat connection (+ one model) pointed at the bridge so it
// shows up in /providers and /models for the user to pick. We do NOT
// bind it as the assistant default — the existing backend stays in
// place until the user selects "Claude (headless bridge)" themselves.
//
// Once selected, the chat path is unchanged: askAssistant → useAssistantChat
// → useAssistant(openai_compat) → POST http://127.0.0.1:PORT/v1/chat/completions
// → BridgeHost → headless claude → transcript reply → back up the stack.

import * as React from 'react';
import { BridgeHost } from '../../claudewrap/bridge/BridgeHost';
import { BRIDGE_LAUNCHER } from '../../claudewrap/bridge/launcher';
import { SETTINGS_ID, nowIso, useConnectionStore, useModelStore } from '../settings';

// Port for the in-process bridge. Distinct from claudewrap's 7781 so a
// running claudewrap and a running tui_app don't fight over the bind
// (they never share a process, but a developer may run both).
export const TUI_BRIDGE_PORT = 7782;

const CONN_ID = 'conn_tui_headless_bridge';

// The two selectable backends the bridge exposes. remoteId MUST match
// the model the bridge routes on (body.model → launcher choice in
// SessionPool): 'disk-claude' runs claude on the user's disk in the
// process cwd; 'firecracker-claude' runs it isolated in a VM.
const SEED_MODELS: Array<{ remoteId: string; displayName: string }> = [
  { remoteId: 'disk-claude', displayName: 'Claude (disk)' },
  { remoteId: 'firecracker-claude', displayName: 'Claude (firecracker)' },
];

// One-shot, no-clobber seed of the selectable backends. Creates the
// connection + model rows only when they're absent so the user can edit
// or delete them and the seed won't reappear over their changes within a
// session.
function useSeedBridgeBackend() {
  const connStore = useConnectionStore();
  const modelStore = useModelStore();
  const seededRef = React.useRef(false);

  React.useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    (async () => {
      try {
        const existingConn = await connStore.get(CONN_ID);
        if (!existingConn) {
          await connStore.create({
            id: CONN_ID,
            settingsId: SETTINGS_ID,
            kind: 'openai-api-like',
            label: 'headless claude bridge',
            status: 'active',
            // Localhost bridge needs no auth — source 'none' resolves to
            // an empty bearer in useAssistantChat.
            credentialRef: { source: 'none' },
            endpoint: `http://127.0.0.1:${TUI_BRIDGE_PORT}/v1`,
            createdAt: nowIso(),
          });
        }
        for (const m of SEED_MODELS) {
          const modelId = `${CONN_ID}:${m.remoteId}`;
          const existing = await modelStore.get(modelId);
          if (existing) continue;
          await modelStore.create({
            id: modelId,
            connectionId: CONN_ID,
            remoteId: m.remoteId,
            displayName: m.displayName,
            modality: 'text',
            favorite: false,
            custom: true,
            source: 'bridge-seed',
            createdAt: nowIso(),
            lastSeenIso: nowIso(),
          });
        }
      } catch {
        // Seeding is best-effort; the bridge still serves HTTP and the
        // user can add the provider by hand from /providers if this races
        // db bootstrap.
      }
    })();
  }, []);
}

export function HeadlessBridge() {
  useSeedBridgeBackend();
  // spawnShell present = headless mode: BridgeHost runs the per-thread
  // SessionPool (one claude process per chat thread) instead of painting
  // a <Terminal>. The value is the legacy launcher path; the pool writes
  // its own per-spawn launchers, so spawnShell now just flags "headless".
  return <BridgeHost port={TUI_BRIDGE_PORT} spawnShell={BRIDGE_LAUNCHER} rows={40} cols={120} />;
}
