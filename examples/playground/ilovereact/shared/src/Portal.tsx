/**
 * Portal component system for react-love
 *
 * Renders children at the top level of the render tree, useful for modals,
 * tooltips, dropdowns, and overlays.
 *
 * Works in both web mode (with ReactDOM.createPortal fallback) and native mode.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useRendererMode } from './context';
import { Box } from './primitives';

// ── Portal Context ─────────────────────────────────────

interface PortalContextValue {
  register: (key: string, children: ReactNode) => void;
  unregister: (key: string) => void;
}

const PortalContext = createContext<PortalContextValue | null>(null);

// ── PortalHost ─────────────────────────────────────────

export interface PortalHostProps {
  children: ReactNode;
}

export function PortalHost({ children }: PortalHostProps) {
  const [portals, setPortals] = useState<Map<string, ReactNode>>(new Map());

  const contextValue = useRef<PortalContextValue>({
    register: (key: string, content: ReactNode) => {
      setPortals((prev) => {
        const next = new Map(prev);
        next.set(key, content);
        return next;
      });
    },
    unregister: (key: string) => {
      setPortals((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    },
  }).current;

  return (
    <PortalContext.Provider value={contextValue}>
      {children}
      {Array.from(portals.entries()).map(([key, portalContent]) => (
        <Box
          key={key}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 1000,
          }}
        >
          {portalContent}
        </Box>
      ))}
    </PortalContext.Provider>
  );
}

// ── Web fallback portal (rendered via ReactDOM.createPortal) ──

function WebFallbackPortal({ children }: { children: ReactNode }) {
  const [containerElement] = useState(() => {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.zIndex = '1000';
    el.style.pointerEvents = 'none';
    return el;
  });

  useEffect(() => {
    document.body.appendChild(containerElement);
    return () => {
      document.body.removeChild(containerElement);
    };
  }, [containerElement]);

  const ReactDOM = require('react-dom');
  return ReactDOM.createPortal(children, containerElement);
}

// ── Context-based portal (registers with nearest PortalHost) ──

function ContextPortal({
  portalKey,
  children,
}: {
  portalKey: string;
  children: ReactNode;
}) {
  const portalContext = useContext(PortalContext);

  useEffect(() => {
    if (portalContext) {
      portalContext.register(portalKey, children);
      return () => {
        portalContext.unregister(portalKey);
      };
    }
  }, [portalContext, portalKey, children]);

  return null;
}

// ── Portal ─────────────────────────────────────────────

export interface PortalProps {
  children: ReactNode;
  name?: string;
}

let portalCounter = 0;

export function Portal({ children, name }: PortalProps) {
  const mode = useRendererMode();
  const portalContext = useContext(PortalContext);
  const portalKeyRef = useRef<string>(`portal-${name || portalCounter++}`);

  // Web mode without PortalHost: fall back to ReactDOM.createPortal
  if (mode === 'web' && !portalContext) {
    return <WebFallbackPortal>{children}</WebFallbackPortal>;
  }

  // Native mode or web mode with PortalHost context
  return <ContextPortal portalKey={portalKeyRef.current}>{children}</ContextPortal>;
}
