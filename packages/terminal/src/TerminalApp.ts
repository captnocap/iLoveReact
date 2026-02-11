/**
 * TerminalApp — Pure JS terminal renderer for iLoveReact.
 *
 * Renders React UIs directly to the terminal using ANSI escape codes.
 * No Lua, no WebSocket, no external client — runs entirely in Node.js.
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
import { computeLayout, flatten } from '@ilovereact/grid';
import {
  ANSI,
  createScreenBuffer,
  clearBuffer,
  applyCommands,
  renderFull,
  renderDiff,
  cloneBuffer,
  type Cell,
} from './ansi';

export interface TerminalAppOptions {
  /** Max frame rate. Default 30. */
  fps?: number;
  /** Use alternate screen buffer. Default true. */
  fullscreen?: boolean;
}

export interface TerminalAppHandle {
  render(element: ReactNode): void;
  stop(): void;
}

export function createTerminalApp(options: TerminalAppOptions = {}): TerminalAppHandle {
  const fps = options.fps ?? 30;
  const fullscreen = options.fullscreen ?? true;

  let cols = process.stdout.columns || 80;
  let rows = process.stdout.rows || 24;

  let currentBuffer = createScreenBuffer(cols, rows);
  let prevBuffer: Cell[][] | null = null;
  let dirty = false;
  let renderTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  // ── Terminal setup ──────────────────────────────────────

  if (fullscreen) {
    process.stdout.write(ANSI.altScreenEnter);
  }
  process.stdout.write(ANSI.hideCursor);
  process.stdout.write(ANSI.clearScreen);

  // ── Resize handling ─────────────────────────────────────

  const onResize = () => {
    cols = process.stdout.columns || 80;
    rows = process.stdout.rows || 24;
    currentBuffer = createScreenBuffer(cols, rows);
    prevBuffer = null; // force full repaint
    dirty = true;
  };

  process.stdout.on('resize', onResize);

  // ── Reconciler hook ─────────────────────────────────────

  setTransportFlush((_commands) => {
    if (stopped) return;

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

    const layoutTree = computeLayout(root, cols, rows, { coordBase: 0 });
    const drawCommands = flatten(layoutTree);

    // Apply to buffer
    clearBuffer(currentBuffer);
    applyCommands(currentBuffer, drawCommands);
    dirty = true;
  });

  // ── Frame loop ──────────────────────────────────────────

  const frameInterval = Math.round(1000 / fps);

  renderTimer = setInterval(() => {
    if (!dirty || stopped) return;
    dirty = false;

    let output: string;
    if (prevBuffer) {
      output = renderDiff(prevBuffer, currentBuffer);
    } else {
      output = renderFull(currentBuffer);
    }

    if (output) {
      process.stdout.write(output);
    }

    prevBuffer = cloneBuffer(currentBuffer);
  }, frameInterval);

  // ── Clean exit ──────────────────────────────────────────

  const cleanup = () => {
    if (stopped) return;
    stopped = true;

    if (renderTimer) {
      clearInterval(renderTimer);
      renderTimer = null;
    }

    process.stdout.write(ANSI.resetColors);
    process.stdout.write(ANSI.showCursor);
    if (fullscreen) {
      process.stdout.write(ANSI.altScreenLeave);
    }

    process.stdout.removeListener('resize', onResize);
  };

  // Safety: restore terminal on exit signals
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // ── React root ──────────────────────────────────────────

  const root = createRoot();

  return {
    render(element: ReactNode) {
      root.render(
        React.createElement(RendererProvider, { mode: 'native' as const }, element)
      );
    },
    stop() {
      root.unmount();
      cleanup();
    },
  };
}
