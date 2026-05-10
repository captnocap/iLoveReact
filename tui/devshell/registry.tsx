// Pane registry. The Shell maps these to <Route>s and the NavRail
// renders them in order. Adding a pane = adding an entry here + a
// component file.
//
// route is the local-router path; hotkey is the digit key that jumps
// to it (Shell installs the global handler).

import * as React from 'react';
import { StatusPane } from './panes/StatusPane';
import { LogsPane } from './panes/Logs';
import { BundlePane } from './panes/Bundle';
import { Placeholder } from './panes/Placeholder';

export interface PaneCtx {
  cart: string;
  hostUp: boolean;
  tick: number;
}

export interface PaneEntry {
  id: string;
  label: string;
  route: string;
  hotkey: string;
  render: (ctx: PaneCtx) => React.ReactElement;
}

export const PANES: PaneEntry[] = [
  {
    id: 'status', label: 'Status', route: '/', hotkey: '1',
    render: ({ cart, hostUp }) => <StatusPane cart={cart} hostUp={hostUp} />,
  },
  {
    id: 'logs', label: 'Logs', route: '/logs', hotkey: '2',
    render: () => <LogsPane />,
  },
  {
    id: 'events', label: 'Events', route: '/events', hotkey: '3',
    render: () => <Placeholder name="Eventlog" next="extend dev_ipc.zig with QUERY-EVENTS command; reuse SQL filter from cart/eventlog" />,
  },
  {
    id: 'inspect', label: 'Inspect', route: '/inspect', hotkey: '4',
    render: () => <Placeholder name="Inspector" next="extend dev_ipc.zig with PICK-ELEMENT (request) + ELEMENT-INFO (reply); cart enters pick mode" />,
  },
  {
    id: 'bundle', label: 'Bundle', route: '/bundle', hotkey: '5',
    render: ({ cart }) => <BundlePane cart={cart} />,
  },
];

export function findPaneByRoute(path: string): PaneEntry | null {
  return PANES.find(p => p.route === path) ?? PANES[0] ?? null;
}

export function findPaneByHotkey(k: string): PaneEntry | null {
  return PANES.find(p => p.hotkey === k) ?? null;
}
