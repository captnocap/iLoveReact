// Devshell top-level. Cart-shaped: <Router> wraps a chrome layout
// (TitleBar / NavRail / Footer) with the active <Route>'s pane in the
// content area. Hotkeys (digit → route, l/y/?/q) are owned here;
// per-pane keys (filter, scroll, etc.) live in the panes themselves
// and gate via InputClaim.
//
// Run on the TUI host via `scripts/devshell <cart>`. Same primitives,
// reconciler, and theme machinery a GPU cart would use — when the TUI
// can't render something, fix the TUI in tui/host.ts rather than
// designing around it here.

import * as React from 'react';
import { Box, Col, Row, Text } from '../../runtime/primitives';
import { subscribeKey, headlessSnapshot } from '../host';
import { Router, Route, useNavigate, useRoute } from '../../cart/app/gallery/local-router';

import { installShellTokens } from './shell-tokens';
import { PANES, findPaneByHotkey, findPaneByRoute, type PaneCtx } from './registry';
import { TitleBar } from './components/TitleBar';
import { TelemetryStrip } from './components/TelemetryStrip';
import { Toast } from './components/Toast';
import { NavRail } from './components/NavRail';
import { Footer } from './components/Footer';
import { HelpPane } from './panes/HelpPane';
import { useLogLevel } from './services/LogLevel';
import { copyToClipboard } from './services/clipboard';
import { isInputClaimed, getCopyOverride } from './services/InputClaim';

const { useState, useEffect } = React;

declare const __fs_exists: ((path: string) => boolean) | undefined;
const probeHost = (): boolean => (typeof __fs_exists === 'function') ? __fs_exists('/tmp/reactjit.sock') : false;

installShellTokens();

export default function Shell() {
  return (
    <Router initialPath="/" hotKey="devshell">
      <ShellChrome />
    </Router>
  );
}

function ShellChrome() {
  const cart = (typeof process !== 'undefined' && process.argv?.[2]) || '<no cart>';
  const [tick, setTick] = useState(0);
  const [hostUp, setHostUp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const log = useLogLevel();
  const nav = useNavigate();
  const { path } = useRoute();

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 200);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { setHostUp(probeHost()); }, [tick]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => subscribeKey(k => {
    if (isInputClaimed()) return;
    if (k === 'q') process.exit(0);
    const hit = findPaneByHotkey(k);
    if (hit) { nav.push(hit.route); return; }
    if (k === '?') { setShowHelp(h => !h); return; }
    if (k === 'l') { log.cycle(); return; }
    if (k === 'y') {
      const override = getCopyOverride();
      const cols = (process.stdout?.columns) || 80;
      const rows = (process.stdout?.rows) || 24;
      const text = override ? override() : headlessSnapshot(cols, rows);
      copyToClipboard(text);
      const lines = text ? text.split('\n').length : 0;
      setToast(override
        ? `✓ copied ${text.length} chars · ${lines} lines`
        : `✓ copied ${rows}×${cols} as plain text`);
      return;
    }
    if (k === '\x1b' && showHelp) setShowHelp(false);
  }), [showHelp]);

  const spinner = '|/-\\'[tick % 4];
  const ctx: PaneCtx = { cart, hostUp, tick };

  return (
    <Box style={{
      width: '100%', height: '100%',
      backgroundColor: 'theme:bg', color: 'theme:ink',
      flexDirection: 'column',
    }}>
      {/* Top strip — TitleBar replaced by Toast on copy. Telemetry
          row sits below either way so width stays stable. */}
      <Col style={{ backgroundColor: 'theme:bg1' }}>
        {toast ? <Toast message={toast} /> : <TitleBar cart={cart} hostUp={hostUp} />}
        <Row style={{ paddingLeft: 1, paddingRight: 1 }}>
          <Box style={{ flexGrow: 1 }} />
          <TelemetryStrip hostUp={hostUp} spinner={spinner} />
        </Row>
      </Col>

      {/* Body — rail on the left, content on the right. */}
      <Row style={{ flexGrow: 1 }}>
        <NavRail />
        <Box style={{
          flexGrow: 1,
          paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1,
          backgroundColor: 'theme:bg',
        }}>
          {showHelp ? <HelpPane /> : <PaneRoutes ctx={ctx} />}
        </Box>
      </Row>

      <Footer />
    </Box>
  );
}

function PaneRoutes({ ctx }: { ctx: PaneCtx }) {
  // Render <Route>s for every registered pane. local-router only
  // matches one (first match wins via __matched); fallback handles
  // unknown paths by jumping to the default pane.
  return (
    <>
      {PANES.map(p => (
        <Route key={p.id} path={p.route}>
          {p.render(ctx)}
        </Route>
      ))}
      <Route fallback>
        <UnknownRoute />
      </Route>
    </>
  );
}

function UnknownRoute() {
  const { path } = useRoute();
  const nav = useNavigate();
  useEffect(() => {
    const fallback = findPaneByRoute('/');
    if (fallback) nav.replace(fallback.route);
  }, [path]);
  return <Text style={{ color: 'theme:inkDim' }}>routing…</Text>;
}
