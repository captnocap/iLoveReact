/**
 * useContextMenu — a TSX-rendered, host-positioned context menu.
 *
 * The framework provides the right-click trigger (via `onRightClick`) and a
 * z-index-based paint pass that lets a high-z-index sibling escape ancestor
 * `overflow: hidden` clipping (see `framework/engine.zig:paintChildrenInZOrder`).
 * Everything else — the menu chrome, items, hover state, separators, icons,
 * submenus — is yours to render in TSX.
 *
 * What this hook gives you:
 *   - `triggerProps`: spread onto any element to make it open the menu on
 *     right-click. The hook captures the click coordinates and stores them.
 *   - `ContextMenu`: a component that renders its children at the captured
 *     coordinates with a high z-index (so the menu sits above everything,
 *     unclipped), measures the rendered menu, and flips/clamps it at the app
 *     edges. A full-viewport invisible backdrop closes it on any click outside.
 *   - `close`: imperatively dismiss the menu. Call this from item onClick
 *     handlers after committing the action.
 *   - `isOpen`, `x`, `y`: the current menu state, if you need to read it.
 *
 * Usage:
 *
 *   const { triggerProps, ContextMenu, close } = useContextMenu();
 *
 *   return (
 *     <>
 *       <div {...triggerProps}>right-click me</div>
 *       <ContextMenu>
 *         <div onClick={() => { open(); close(); }}>Open</div>
 *         <div onClick={() => { del();  close(); }}>Delete</div>
 *       </ContextMenu>
 *     </>
 *   );
 *
 * Style the items however you want. The framework's z-index implementation
 * pushes a fresh full-viewport scissor for any node with non-zero `zIndex`,
 * which (a) escapes any ancestor `overflow: hidden`, and (b) forces a new
 * GPU primitive segment so menu rects + text actually z-stack above sibling
 * text. See `docs/v8/context_menu.md` for the underlying mechanics.
 */

import { useState, useCallback, type ReactNode, type CSSProperties } from 'react';
import {
  contextMenuPosition,
  contextMenuViewportSize,
  type ContextMenuSize,
} from './contextMenuPosition';

type ContextMenuState = {
  x: number;
  y: number;
  viewport: ContextMenuSize;
};

function viewportSize(): ContextMenuSize {
  const host = globalThis as any;
  const hostWidth = typeof host.__viewport_width === 'function' ? Number(host.__viewport_width()) : Number(host.innerWidth);
  const hostHeight = typeof host.__viewport_height === 'function' ? Number(host.__viewport_height()) : Number(host.innerHeight);
  return {
    width: Number.isFinite(hostWidth) && hostWidth > 0 ? hostWidth : 0,
    height: Number.isFinite(hostHeight) && hostHeight > 0 ? hostHeight : 0,
  };
}

export type ContextMenuApi = {
  triggerProps: { onRightClick: (e: { x: number; y: number }) => void };
  ContextMenu: (props: {
    children: ReactNode;
    /** Override the menu container's style. Position/zIndex are managed; everything else is yours. */
    style?: CSSProperties;
    /** Optional: called after the backdrop closes the menu (for analytics / focus restore). */
    onDismiss?: () => void;
  }) => ReactNode;
  /** Programmatically close the menu (e.g. after picking an item). */
  close: () => void;
  isOpen: boolean;
  x: number;
  y: number;
};

function ContextMenuLayer({ state, children, style, onBackdrop }: {
  state: ContextMenuState;
  children: ReactNode;
  style?: CSSProperties;
  onBackdrop: () => void;
}): ReactNode {
  const [menuSize, setMenuSize] = useState<ContextMenuSize | null>(null);
  const position = menuSize
    ? contextMenuPosition(state, menuSize, state.viewport)
    : { x: state.x, y: state.y };
  const available = contextMenuViewportSize(state.viewport);
  const constrainWidth = Boolean(menuSize && available.width > 0 && menuSize.width > available.width);
  const constrainHeight = Boolean(menuSize && available.height > 0 && menuSize.height > available.height);

  return (
    <>
      {/* Invisible backdrop — captures clicks outside the menu. Sits at
          zIndex 998 so the menu (999+) paints above it, but above the
          rest of the cart so any click anywhere lands here. */}
      <div
        onClick={onBackdrop}
        style={{
          position: 'absolute',
          zIndex: 998,
          left: 0,
          top: 0,
          width: 100000,
          height: 100000,
        }}
      />
      <div
        style={{
          position: 'absolute',
          zIndex: 999,
          left: position.x,
          top: position.y,
          maxWidth: constrainWidth ? available.width : undefined,
          maxHeight: constrainHeight ? available.height : undefined,
          overflow: constrainWidth || constrainHeight ? 'scroll' : undefined,
          // Never flash an unclamped menu beyond the window on its first
          // layout frame. Reopens are measured afresh because their
          // contextual rows may have a different height.
          opacity: menuSize ? 1 : 0,
          ...style,
        }}
      >
        {/* Measure the unconstrained content, not the scroll viewport. This
            keeps an oversized popup stably constrained instead of oscillating
            between its natural and clamped heights. */}
        <div
          onLayout={(layout: { width: number; height: number }) => {
            const width = Math.ceil(Number(layout.width));
            const height = Math.ceil(Number(layout.height));
            if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return;
            setMenuSize((current) => current?.width === width && current.height === height
              ? current
              : { width, height });
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

export function useContextMenu(): ContextMenuApi {
  const [state, setState] = useState<ContextMenuState | null>(null);

  const triggerProps = {
    onRightClick: (e: { x: number; y: number }) => {
      setState({ x: e.x, y: e.y, viewport: viewportSize() });
    },
  };

  const close = useCallback(() => setState(null), []);

  const ContextMenu = useCallback(
    ({
      children,
      style,
      onDismiss,
    }: {
      children: ReactNode;
      style?: CSSProperties;
      onDismiss?: () => void;
    }): ReactNode => {
      if (!state) return null;
      return (
        <ContextMenuLayer
          state={state}
          style={style}
          onBackdrop={() => {
            setState(null);
            onDismiss?.();
          }}
        >
          {children}
        </ContextMenuLayer>
      );
    },
    [state],
  );

  return {
    triggerProps,
    ContextMenu,
    close,
    isOpen: state !== null,
    x: state?.x ?? 0,
    y: state?.y ?? 0,
  };
}
