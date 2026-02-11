/**
 * Universal Pressable component
 *
 * Provides interaction state tracking and callbacks for press, long press,
 * and hover interactions. Works in both web and native modes.
 *
 * Exposes interaction state via render props pattern and supports
 * both static and function-based style/children.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, styleToCSS } from './primitives';
import type { Style, LoveEvent } from './types';
import { useRendererMode } from './context';

export interface PressableState {
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
}

export interface HitSlop {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface PressableProps {
  onPress?: (event: LoveEvent) => void;
  onLongPress?: (event: LoveEvent) => void;
  onPressIn?: (event: LoveEvent) => void;
  onPressOut?: (event: LoveEvent) => void;
  onHoverIn?: (event: LoveEvent) => void;
  onHoverOut?: (event: LoveEvent) => void;
  disabled?: boolean;
  delayLongPress?: number;
  style?: Style | ((state: PressableState) => Style);
  children: React.ReactNode | ((state: PressableState) => React.ReactNode);
  hitSlop?: number | HitSlop;
  accessibilityRole?: string;
}

export function Pressable({
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  disabled = false,
  delayLongPress = 500,
  style,
  children,
  hitSlop,
  accessibilityRole,
}: PressableProps) {
  const mode = useRendererMode();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressFiredRef = useRef(false);

  // Clear long press timer
  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Reset all state when disabled
  useEffect(() => {
    if (disabled) {
      setPressed(false);
      setHovered(false);
      setFocused(false);
      clearLongPressTimer();
      longPressFiredRef.current = false;
    }
  }, [disabled, clearLongPressTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearLongPressTimer();
  }, [clearLongPressTimer]);

  // Press in handler
  const handlePressIn = useCallback((event: LoveEvent) => {
    if (disabled) return;

    setPressed(true);
    longPressFiredRef.current = false;

    if (onPressIn) {
      onPressIn(event);
    }

    // Start long press timer
    if (onLongPress) {
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        onLongPress(event);
      }, delayLongPress);
    }
  }, [disabled, onPressIn, onLongPress, delayLongPress]);

  // Press out handler
  const handlePressOut = useCallback((event: LoveEvent) => {
    if (disabled) return;

    const wasPressed = pressed;
    setPressed(false);
    clearLongPressTimer();

    if (onPressOut) {
      onPressOut(event);
    }

    // Fire onPress only if long press didn't fire and we were actually pressed
    if (wasPressed && !longPressFiredRef.current && onPress) {
      onPress(event);
    }

    longPressFiredRef.current = false;
  }, [disabled, pressed, onPressOut, onPress, clearLongPressTimer]);

  // Hover in handler
  const handleHoverIn = useCallback((event: LoveEvent) => {
    if (disabled) return;

    setHovered(true);

    if (onHoverIn) {
      onHoverIn(event);
    }
  }, [disabled, onHoverIn]);

  // Hover out handler
  const handleHoverOut = useCallback((event: LoveEvent) => {
    if (disabled) return;

    setHovered(false);

    if (onHoverOut) {
      onHoverOut(event);
    }

    // Cancel press if pointer leaves while pressed
    if (pressed) {
      setPressed(false);
      clearLongPressTimer();
      longPressFiredRef.current = false;
    }
  }, [disabled, onHoverOut, pressed, clearLongPressTimer]);

  // Keyboard handlers for accessibility
  const handleKeyDown = useCallback((event: LoveEvent) => {
    if (disabled) return;

    const key = event.key;
    if (key === 'Enter' || key === ' ') {
      handlePressIn(event);
      setFocused(true);
    }
  }, [disabled, handlePressIn]);

  const handleKeyUp = useCallback((event: LoveEvent) => {
    if (disabled) return;

    const key = event.key;
    if (key === 'Enter' || key === ' ') {
      handlePressOut(event);
    }
  }, [disabled, handlePressOut]);

  // Compute state object
  const state: PressableState = { pressed, hovered, focused };

  // Resolve style
  let resolvedStyle: Style = typeof style === 'function' ? style(state) : style || {};

  // Apply hitSlop in web mode using negative margin and padding trick
  if (mode === 'web' && hitSlop) {
    const slop = typeof hitSlop === 'number'
      ? { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop }
      : hitSlop;

    // Add padding to expand the hit area
    const expandedStyle: Style = { ...resolvedStyle };
    if (slop.top !== undefined) {
      expandedStyle.paddingTop = (resolvedStyle.paddingTop || 0) as number + slop.top;
      expandedStyle.marginTop = (resolvedStyle.marginTop || 0) as number - slop.top;
    }
    if (slop.bottom !== undefined) {
      expandedStyle.paddingBottom = (resolvedStyle.paddingBottom || 0) as number + slop.bottom;
      expandedStyle.marginBottom = (resolvedStyle.marginBottom || 0) as number - slop.bottom;
    }
    if (slop.left !== undefined) {
      expandedStyle.paddingLeft = (resolvedStyle.paddingLeft || 0) as number + slop.left;
      expandedStyle.marginLeft = (resolvedStyle.marginLeft || 0) as number - slop.left;
    }
    if (slop.right !== undefined) {
      expandedStyle.paddingRight = (resolvedStyle.paddingRight || 0) as number + slop.right;
      expandedStyle.marginRight = (resolvedStyle.marginRight || 0) as number - slop.right;
    }
    resolvedStyle = expandedStyle;
  }

  // Web mode: add cursor and opacity styles
  if (mode === 'web') {
    const webStyle = { ...resolvedStyle };

    // Cursor styling
    if (disabled) {
      webStyle.opacity = webStyle.opacity ?? 0.5;
    }

    resolvedStyle = webStyle;
  }

  // Resolve children
  const resolvedChildren = typeof children === 'function' ? children(state) : children;

  // Create Box props
  const boxProps: any = {
    style: resolvedStyle,
    onClick: handlePressIn,
    onRelease: handlePressOut,
    onPointerEnter: handleHoverIn,
    onPointerLeave: handleHoverOut,
    onKeyDown: handleKeyDown,
    onKeyUp: handleKeyUp,
  };

  // Native mode: pass interaction state and hitSlop as props
  if (mode === 'native') {
    boxProps.pressed = pressed;
    boxProps.hovered = hovered;
    boxProps.focused = focused;
    if (hitSlop) {
      boxProps.hitSlop = hitSlop;
    }
    if (accessibilityRole) {
      boxProps.accessibilityRole = accessibilityRole;
    }
  } else {
    // Web mode: use DOM attributes
    // Note: Box doesn't currently expose a way to pass through arbitrary DOM props,
    // so we'll create the div directly when in web mode to add role and tabIndex
    const css = styleToCSS(resolvedStyle);

    // Add web-specific cursor styling
    if (!disabled) {
      css.cursor = 'pointer';
    } else {
      css.cursor = 'not-allowed';
    }
    css.userSelect = 'none';

    return (
      <div
        style={css}
        onClick={handlePressIn as any}
        onMouseUp={handlePressOut as any}
        onPointerEnter={handleHoverIn as any}
        onPointerLeave={handleHoverOut as any}
        onKeyDown={handleKeyDown as any}
        onKeyUp={handleKeyUp as any}
        tabIndex={disabled ? -1 : 0}
        role={accessibilityRole || 'button'}
        aria-disabled={disabled}
      >
        {resolvedChildren}
      </div>
    );
  }

  return <Box {...boxProps}>{resolvedChildren}</Box>;
}
