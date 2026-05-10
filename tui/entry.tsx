// tui/entry.tsx — boot a cart on the TUI backend.
//
// scripts/tui aliases @cart-entry to the user-supplied .tsx file. We
// import the cart's default export, mount it via the same react-reconciler
// the GPU host uses (renderer/hostConfig.ts), and drive paint off
// resetAfterCommit.
//
// The reconciler builds an Instance tree in JS; tui/host.ts walks that
// tree on every paint. setTransportFlush is wired to a no-op because we
// don't need the Command stream — we read the live tree directly. But we
// DO use the transport hook as a "react committed" signal, so paint
// happens at the right time.

import './v8-preamble.js';
import { installHostShims } from './host_shims';
installHostShims();

import * as React from 'react';
import { hostConfig, setTransportFlush } from '../renderer/hostConfig';
import { enter, leave, requestPaint, startInput } from './host';
import { installFocusManager } from './focus';

// @ts-ignore — bundle-time alias resolved by scripts/tui (--alias:@cart-entry=...)
import App from '@cart-entry';

declare const __runEventLoop: (done?: () => void) => void;

// Drain hostConfig commands (we don't need them — we walk the tree
// directly) and trigger a repaint.
setTransportFlush((_cmds: any) => { requestPaint(); });

const Reconciler: any = require('react-reconciler');
const reconciler = Reconciler(hostConfig);

const onRecoverableError = (e: any): void => {
  try { (process.stderr as any)?.write?.('[react] ' + (e?.stack || e?.message || String(e)) + '\n'); } catch {}
};

const container = reconciler.createContainer(
  { id: 0 }, 0, null, false, null, '', onRecoverableError, null,
);

enter();
startInput();
installFocusManager();

reconciler.updateContainer(
  React.createElement(App as any, {}),
  container, null, null,
);

__runEventLoop(() => { leave(); process.exit(0); });
