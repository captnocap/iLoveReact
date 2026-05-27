// App — top-level TUI shell.
//
// Layout:
//
//   <Col>                                    // outer
//     <BridgeHost/>                          // invisible, always mounted
//     <SettingsWindow/>                      // off-screen unless windowOpen
//     <TabBar/>                              // 1-row top
//     <Row>                                  // body
//       {tab !== 'main' && <PageContent/>}   // page on the left
//       <Terminal/>                          // PiP sidebar or full pane
//     </Row>
//     <StatusBar/>                           // 1-row bottom
//   </Col>
//
// The <Terminal> is mounted ONCE at a stable JSX position with a
// stable key. Tabs vary only its style (full-width on main, 40-cell
// PiP sidebar elsewhere). React keeps the same instance across tab
// switches → same node.id → same vterm slot → same PTY → same live
// Claude Code session.

import * as React from 'react';
import { Col, Row, Terminal } from '../../runtime/primitives';
import { subscribeKey, leave } from '../../tui/host';
import { startWorkspaceSync } from '../../tui/sync-host';
import { palette } from './ui/palette';
import { TabBar } from './ui/TabBar';
import { StatusBar } from './ui/StatusBar';
// ClaudePage: when tab=main, only <Terminal> renders. ClaudePage is
// kept in pages/ as a future home for main-tab overlay UI (e.g. tiny
// status indicators on top of the terminal). Not imported here yet.
import { IftttPage } from './pages/IftttPage';
import { RecipesPage } from './pages/RecipesPage';
import { HelpPage } from './pages/HelpPage';
import { SettingsWindow } from './window/SettingsWindow';
import { BridgeHost } from './bridge/BridgeHost';
import { RuleBinding } from './ifttt/bindings';
import { setSettings, useSettings } from './state';
import type { TabId } from './types';

// ── Session + launcher paths ────────────────────────────────────────

const SESSION_ID = `${Date.now()}${Math.floor(Math.random() * 1e6)
  .toString().padStart(6, '0')}`;

export const IFTTT_LOG_PATH = (() => {
  const g: any = globalThis;
  const home = g.__env?.('HOME') ?? '/tmp';
  const dir = `${home}/.cache/reactjit`;
  // Write the session ID so claude-ss (child process) can read it.
  try { g.__fs_write?.(`${dir}/session-id`, SESSION_ID); } catch {}
  return `${dir}/ifttt-${SESSION_ID}.log`;
})();

const CLAUDE_SS_LAUNCHER = (() => {
  const g: any = globalThis;
  const root = g.__env?.('REACTJIT_ROOT') || g.__cwd?.() || '.';
  return `${root}/scripts/claude-ss`;
})();

// ── App ─────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = React.useState<TabId>('main');
  const settings = useSettings();

  // Enable claude_code classifier on the TUI vterm so ifttt-permission
  // and the semantic graph work. Mode 2 = claude_code.
  React.useEffect(() => {
    const g: any = globalThis;
    g.__sem_set_mode?.(2);
  }, []);

  // ── Workspace sync (lazy ref so it runs once, before <Terminal> mounts)
  //
  // Pre-bind the vsock UDS the guest sync daemon will dial into AND
  // export the path via env so claude-ss inherits it. If this ran in
  // useEffect, the Terminal would mount + claude-ss would spawn before
  // the UDS listener is bound, and the guest's first dial would race
  // the listener.
  const syncRef = React.useRef<{ stop: () => void } | null>(null);
  if (!syncRef.current) {
    const g: any = globalThis;
    const pid = typeof g.__getpid === 'function' ? g.__getpid() : Math.floor(Date.now() % 1e9);
    const cwd = typeof g.__cwd === 'function' ? g.__cwd() : '.';
    const vsockUdsPath = `/tmp/claudewrap-${pid}-vsock.sock`;
    if (typeof g.__env_set === 'function') {
      g.__env_set('CLAUDEWRAP_VSOCK_UDS', vsockUdsPath);
    }
    syncRef.current = startWorkspaceSync({ cwd, vsockUdsPath });
  }
  React.useEffect(() => {
    return () => {
      syncRef.current?.stop();
      syncRef.current = null;
    };
  }, []);

  // ── Keyboard navigation ────────────────────────────────────────────
  //
  // Only fires when the Terminal isn't focused (the host routes all
  // keystrokes to the PTY while a Terminal owns focus). After Ctrl+]
  // the cart sees keys again.
  React.useEffect(() => subscribeKey(k => {
    if (k === 'q') { leave(); process.exit(0); }
    if (k === '1') setTab('main');
    if (k === '2') setTab('ifttt');
    if (k === '3') setTab('recipes');
    if (k === '4') setTab('help');
    // 5 is the settings window — toggle visibility. The TabBar also
    // exposes this as a clickable button (rightmost cell) so the
    // affordance is discoverable without knowing the keystroke.
    if (k === '5' || k === ',') setSettings({ windowOpen: !settings.windowOpen });
  }), [settings.windowOpen]);

  // Per-tab Terminal style: full width on the claude tab, PiP sidebar
  // (fixed 40 cells) on every other tab so the page content gets the
  // main column while claude stays peripherally visible.
  const termStyle = tab === 'main'
    ? { flexGrow: 1, height: '100%' as const }
    : { width: 40, height: '100%' as const, borderWidth: 1, borderColor: palette.accent };

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: palette.bg }}>
      {/* Each rule mounts one useIFTTT(trigger, action) binding through
          the real DSL — same path a cart's recipe scaffold uses. Stable
          id = stable hook position; toggling enabled flips the action
          to a no-op rather than unmounting (rule-of-hooks-safe). */}
      {settings.rules.map(r => <RuleBinding key={r.id} rule={r} />)}
      {/* Invisible — useHost binds the HTTP server at boot. No spawnShell:
          the <Terminal session="default"> below owns the PTY, so the
          bridge runs in attached mode and just drives that pipe. */}
      <BridgeHost port={settings.bridgePort} />
      {/* Settings GUI window. Visibility gated by state.ts.windowOpen. */}
      <SettingsWindow />

      <TabBar tab={tab} onSelect={setTab} />
      <Row style={{ flexGrow: 1 }} key="body">
        {tab !== 'main' && (
          <Col key="page" style={{ flexGrow: 1, padding: 1 }}>
            {tab === 'ifttt'   && <IftttPage />}
            {tab === 'recipes' && <RecipesPage />}
            {tab === 'help'    && <HelpPage />}
          </Col>
        )}
        {/* session="default" pins this Terminal to the framework's
            DEFAULT_SESSION so every host-fn call without an explicit
            session arg (BridgeHost writes, ifttt-permission answers,
            autocomplete-fed actions, etc.) lands on the same pipe.
            Without this prop the host would name the session
            "tui-<node.id>" which nothing else can target. */}
        <Terminal key="term" session="default" shell={CLAUDE_SS_LAUNCHER} style={termStyle} />
      </Row>
      <StatusBar tab={tab} />
    </Col>
  );
}
