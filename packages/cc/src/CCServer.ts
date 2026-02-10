/**
 * CCServer — WebSocket server that bridges React rendering to ComputerCraft.
 *
 * On each React commit, walks the JS-side Instance tree, computes grid layout,
 * flattens to draw commands, and broadcasts JSON to all connected CC clients.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { ReactNode } from 'react';
import {
  setTransportFlush,
  getRootInstances,
  createRoot,
  type Instance,
} from '@ilovereact/native';
import { computeLayout } from './layout';
import { flatten, type DrawCommand } from './flatten';

export interface CCServerOptions {
  port?: number;   // default 8080
  width?: number;  // default 51 (CC terminal width)
  height?: number; // default 19 (CC terminal height)
}

export interface CCServerHandle {
  render(element: ReactNode): void;
  stop(): void;
}

export function createCCServer(options: CCServerOptions = {}): CCServerHandle {
  const port = options.port ?? 8080;
  const width = options.width ?? 51;
  const height = options.height ?? 19;

  const clients = new Set<WebSocket>();

  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));

    // Send current frame to newly connected client
    if (lastFrame) {
      ws.send(lastFrame);
    }
  });

  let lastFrame: string | null = null;

  // Hook into the reconciler: on each commit, compute layout and broadcast
  setTransportFlush((_commands) => {
    // We ignore the mutation commands — instead we walk the Instance tree directly
    const roots = getRootInstances();
    if (roots.length === 0) return;

    // Build a synthetic root if multiple root children
    const root: Instance = roots.length === 1
      ? roots[0]
      : {
          id: 0,
          type: 'View',
          props: { style: { width: '100%', height: '100%' } },
          handlers: {},
          children: roots,
        };

    const layoutTree = computeLayout(root, width, height);
    const drawCommands = flatten(layoutTree);
    const frame = JSON.stringify(drawCommands);

    lastFrame = frame;
    broadcast(frame);
  });

  function broadcast(data: string): void {
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  }

  // Create the React root
  const root = createRoot();

  return {
    render(element: ReactNode) {
      root.render(element);
    },
    stop() {
      root.unmount();
      wss.close();
      clients.clear();
    },
  };
}
