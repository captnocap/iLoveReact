import { createContext, useContext, type ReactNode } from 'react';
import type { IBridge } from './bridge';
import React from 'react';

// ── Bridge context (hooks consume this) ─────────────────

const BridgeContext = createContext<IBridge | null>(null);

export function BridgeProvider({
  bridge,
  children,
}: {
  bridge: IBridge;
  children: ReactNode;
}) {
  return React.createElement(BridgeContext.Provider, { value: bridge }, children);
}

export function useBridge(): IBridge {
  const bridge = useContext(BridgeContext);
  if (!bridge)
    throw new Error('useBridge must be used within a <BridgeProvider>');
  return bridge;
}

// ── Renderer mode context (primitives switch on this) ───

export type RendererMode = 'web' | 'native';

const RendererContext = createContext<RendererMode>('web');

export function RendererProvider({
  mode,
  children,
}: {
  mode: RendererMode;
  children: ReactNode;
}) {
  return React.createElement(RendererContext.Provider, { value: mode }, children);
}

export function useRendererMode(): RendererMode {
  return useContext(RendererContext);
}
