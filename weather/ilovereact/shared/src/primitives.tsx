/**
 * Universal primitives: <Box>, <Text>, <Image>
 *
 * In web mode:   render as DOM elements with CSS flexbox
 * In native mode: render as string-typed host elements for react-reconciler
 *
 * The RendererMode context decides which path to take.
 */

import React from 'react';
import { useRendererMode } from './context';
import type { BoxProps, TextProps, ImageProps, Style, Color } from './types';

// ── Web-mode style conversion ──────────────────────────

function colorToCSS(c: Color): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    const [r, g, b, a = 1] = c;
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
  }
  return 'transparent';
}

function mapFlexValue(v: string | undefined): string | undefined {
  if (v === 'start') return 'flex-start';
  if (v === 'end') return 'flex-end';
  return v;
}

function styleToCSS(style?: Style): React.CSSProperties {
  if (!style) return { display: 'flex', flexDirection: 'column' };
  const css: React.CSSProperties = {
    display: style.display === 'none' ? 'none' : 'flex',
    flexDirection: style.flexDirection || 'column',
    boxSizing: 'border-box',
  };

  if (style.width !== undefined) css.width = style.width;
  if (style.height !== undefined) css.height = style.height;
  if (style.minWidth !== undefined) css.minWidth = style.minWidth;
  if (style.minHeight !== undefined) css.minHeight = style.minHeight;
  if (style.maxWidth !== undefined) css.maxWidth = style.maxWidth;
  if (style.maxHeight !== undefined) css.maxHeight = style.maxHeight;
  if (style.justifyContent)
    css.justifyContent = mapFlexValue(style.justifyContent);
  if (style.alignItems) css.alignItems = mapFlexValue(style.alignItems);
  if (style.alignSelf) css.alignSelf = mapFlexValue(style.alignSelf);
  if (style.flexWrap) css.flexWrap = style.flexWrap;
  if (style.flexGrow !== undefined) css.flexGrow = style.flexGrow;
  if (style.flexShrink !== undefined) css.flexShrink = style.flexShrink;
  if (style.flexBasis !== undefined) css.flexBasis = style.flexBasis;
  if (style.gap !== undefined) css.gap = style.gap;
  if (style.padding !== undefined) css.padding = style.padding;
  if (style.paddingLeft !== undefined) css.paddingLeft = style.paddingLeft;
  if (style.paddingRight !== undefined) css.paddingRight = style.paddingRight;
  if (style.paddingTop !== undefined) css.paddingTop = style.paddingTop;
  if (style.paddingBottom !== undefined) css.paddingBottom = style.paddingBottom;
  if (style.margin !== undefined) css.margin = style.margin;
  if (style.marginLeft !== undefined) css.marginLeft = style.marginLeft;
  if (style.marginRight !== undefined) css.marginRight = style.marginRight;
  if (style.marginTop !== undefined) css.marginTop = style.marginTop;
  if (style.marginBottom !== undefined) css.marginBottom = style.marginBottom;
  if (style.backgroundColor)
    css.backgroundColor = colorToCSS(style.backgroundColor);
  if (style.borderRadius !== undefined) css.borderRadius = style.borderRadius;
  if (style.borderWidth !== undefined) {
    css.borderWidth = style.borderWidth;
    css.borderStyle = 'solid';
  }
  if (style.borderColor) css.borderColor = colorToCSS(style.borderColor);
  if (style.overflow) css.overflow = style.overflow;
  if (style.opacity !== undefined) css.opacity = style.opacity;

  // Box shadow
  if (style.shadowColor) {
    const offsetX = style.shadowOffsetX || 0;
    const offsetY = style.shadowOffsetY || 0;
    const blur = style.shadowBlur || 0;
    css.boxShadow = `${offsetX}px ${offsetY}px ${blur}px ${colorToCSS(style.shadowColor)}`;
  }

  // Gradient (takes precedence over backgroundColor)
  if (style.backgroundGradient) {
    const { direction, colors } = style.backgroundGradient;
    const [c1, c2] = colors;
    let cssDir = 'to bottom';
    if (direction === 'horizontal') cssDir = 'to right';
    else if (direction === 'diagonal') cssDir = 'to bottom right';
    css.background = `linear-gradient(${cssDir}, ${colorToCSS(c1)}, ${colorToCSS(c2)})`;
  }

  // Transform
  if (style.transform) {
    const t = style.transform;
    const parts: string[] = [];
    if (t.translateX || t.translateY) {
      parts.push(`translate(${t.translateX || 0}px, ${t.translateY || 0}px)`);
    }
    if (t.rotate) {
      parts.push(`rotate(${t.rotate}deg)`);
    }
    if (t.scaleX || t.scaleY) {
      parts.push(`scale(${t.scaleX || 1}, ${t.scaleY || 1})`);
    }
    if (parts.length > 0) {
      css.transform = parts.join(' ');
    }
    if (t.originX !== undefined || t.originY !== undefined) {
      const ox = (t.originX !== undefined ? t.originX * 100 : 50) + '%';
      const oy = (t.originY !== undefined ? t.originY * 100 : 50) + '%';
      css.transformOrigin = `${ox} ${oy}`;
    }
  }

  if (style.color) css.color = colorToCSS(style.color);
  if (style.fontSize) css.fontSize = style.fontSize;
  if (style.fontFamily) css.fontFamily = style.fontFamily;
  if (style.fontWeight !== undefined) css.fontWeight = style.fontWeight;
  if (style.textAlign) css.textAlign = style.textAlign;
  if (style.textOverflow) css.textOverflow = style.textOverflow;
  if (style.lineHeight !== undefined) css.lineHeight = `${style.lineHeight}px`;
  if (style.letterSpacing !== undefined) css.letterSpacing = style.letterSpacing;
  if (style.objectFit) css.objectFit = style.objectFit;
  if (style.zIndex !== undefined) css.zIndex = style.zIndex;
  if (style.position) css.position = style.position;
  if (style.top !== undefined) css.top = style.top;
  if (style.bottom !== undefined) css.bottom = style.bottom;
  if (style.left !== undefined) css.left = style.left;
  if (style.right !== undefined) css.right = style.right;

  return css;
}

// ── Primitives ─────────────────────────────────────────

export function Box({
  style,
  onClick,
  onRelease,
  onPointerEnter,
  onPointerLeave,
  onKeyDown,
  onKeyUp,
  onTextInput,
  onWheel,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  onGamepadPress,
  onGamepadRelease,
  onGamepadAxis,
  onDragStart,
  onDrag,
  onDragEnd,
  children,
}: BoxProps) {
  const mode = useRendererMode();

  if (mode === 'web') {
    const css = styleToCSS(style);
    if (onClick) css.cursor = 'pointer';
    css.userSelect = 'none';
    return (
      <div
        style={css}
        onClick={onClick as any}
        onPointerEnter={onPointerEnter as any}
        onPointerLeave={onPointerLeave as any}
        onKeyDown={onKeyDown as any}
        onKeyUp={onKeyUp as any}
        onInput={onTextInput as any}
        onWheel={onWheel as any}
        onTouchStart={onTouchStart as any}
        onTouchEnd={onTouchEnd as any}
        onTouchMove={onTouchMove as any}
        tabIndex={onKeyDown || onKeyUp || onTextInput ? 0 : undefined}
      >
        {/* TODO: Web drag implementation - use HTML5 drag API or pointer events */}
        {children}
      </div>
    );
  }

  // Native mode: host element for react-reconciler
  return React.createElement(
    'View',
    {
      style,
      onClick,
      onRelease,
      onPointerEnter,
      onPointerLeave,
      onKeyDown,
      onKeyUp,
      onTextInput,
      onWheel,
      onTouchStart,
      onTouchEnd,
      onTouchMove,
      onGamepadPress,
      onGamepadRelease,
      onGamepadAxis,
      onDragStart,
      onDrag,
      onDragEnd,
    },
    children
  );
}

export function Text({ style, numberOfLines, onKeyDown, onKeyUp, onTextInput, children }: TextProps) {
  const mode = useRendererMode();

  if (mode === 'web') {
    const baseCSS: React.CSSProperties = {
      ...styleToCSS(style),
      display: 'inline',
      flexDirection: undefined,
      userSelect: 'none',
    };

    // numberOfLines uses -webkit-line-clamp for multi-line truncation
    if (numberOfLines !== undefined) {
      baseCSS.display = '-webkit-box';
      (baseCSS as any).WebkitLineClamp = numberOfLines;
      (baseCSS as any).WebkitBoxOrient = 'vertical';
      baseCSS.overflow = 'hidden';
    }

    return (
      <span
        style={baseCSS}
        onKeyDown={onKeyDown as any}
        onKeyUp={onKeyUp as any}
        onInput={onTextInput as any}
        tabIndex={onKeyDown || onKeyUp || onTextInput ? 0 : undefined}
      >
        {children}
      </span>
    );
  }

  return React.createElement('Text', { style, numberOfLines, onKeyDown, onKeyUp, onTextInput }, children);
}

export function Image({ src, style, onClick, onWheel }: ImageProps) {
  const mode = useRendererMode();

  if (mode === 'web') {
    return (
      <img
        src={src}
        style={{
          ...styleToCSS(style),
          display: 'block',
          flexDirection: undefined,
        }}
        onClick={onClick as any}
        onWheel={onWheel as any}
      />
    );
  }

  return React.createElement('Image', { src, style, onClick, onWheel });
}

// Re-export the CSS conversion for advanced usage
export { styleToCSS, colorToCSS };
