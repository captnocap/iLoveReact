/**
 * Generic render server for grid-based targets.
 *
 * Hooks into the React reconciler's commit cycle, walks the Instance tree,
 * computes layout, flattens to draw commands, and broadcasts via a pluggable transport.
 */

import React from 'react';
import type { ReactNode } from 'react';
import {
  setTransportFlush,
  getRootInstances,
  createRoot,
  RendererProvider,
  type Instance,
} from '@ilovereact/native';
import { computeLayout, type LayoutOptions } from './layout';
import { flatten, type FlattenOptions } from './flatten';
import type { Transport } from './transports/types';

export interface RenderServerOptions {
  width: number;
  height: number;
  transport: Transport;
  coordBase?: number;
  flattenOptions?: FlattenOptions;
}

export interface RenderServerHandle {
  render(element: ReactNode): void;
  stop(): void;
}

export function createRenderServer(options: RenderServerOptions): RenderServerHandle {
  const { width, height, transport } = options;
  const layoutOptions: LayoutOptions = { coordBase: options.coordBase ?? 0 };

  let lastFrame: string | null = null;

  // Send current frame to newly connected clients
  if (transport.onConnect) {
    transport.onConnect((send) => {
      if (lastFrame) send(lastFrame);
    });
  }

  // Hook into the reconciler: on each commit, compute layout and broadcast
  setTransportFlush((_commands) => {
    const roots = getRootInstances();
    if (roots.length === 0) return;

    const root: Instance = roots.length === 1
      ? roots[0]
      : {
          id: 0,
          type: 'View',
          props: { style: { width: '100%', height: '100%' } },
          handlers: {},
          children: roots,
        };

    const layoutTree = computeLayout(root, width, height, layoutOptions);
    const drawCommands = flatten(layoutTree, options.flattenOptions);
    const frame = JSON.stringify(drawCommands);

    lastFrame = frame;
    transport.broadcast(frame);
  });

  const root = createRoot();

  return {
    render(element: ReactNode) {
      root.render(
        React.createElement(RendererProvider, { mode: 'native' as const }, element)
      );
    },
    stop() {
      root.unmount();
      transport.stop();
    },
  };
}
