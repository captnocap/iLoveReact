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
    if (t.skewX || t.skewY) {
      parts.push(`skew(${t.skewX || 0}deg, ${t.skewY || 0}deg)`);
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
  if (style.visibility) css.visibility = style.visibility;

  // Per-corner border radius
  if (style.borderTopLeftRadius !== undefined) css.borderTopLeftRadius = style.borderTopLeftRadius;
  if (style.borderTopRightRadius !== undefined) css.borderTopRightRadius = style.borderTopRightRadius;
  if (style.borderBottomLeftRadius !== undefined) css.borderBottomLeftRadius = style.borderBottomLeftRadius;
  if (style.borderBottomRightRadius !== undefined) css.borderBottomRightRadius = style.borderBottomRightRadius;

  // Per-side border colors
  if (style.borderTopColor) css.borderTopColor = colorToCSS(style.borderTopColor);
  if (style.borderRightColor) css.borderRightColor = colorToCSS(style.borderRightColor);
  if (style.borderBottomColor) css.borderBottomColor = colorToCSS(style.borderBottomColor);
  if (style.borderLeftColor) css.borderLeftColor = colorToCSS(style.borderLeftColor);

  // Text shadow
  if (style.textShadowColor) {
    const ox = style.textShadowOffsetX || 0;
    const oy = style.textShadowOffsetY || 0;
    css.textShadow = `${ox}px ${oy}px ${colorToCSS(style.textShadowColor)}`;
  }

  // Outline
  if (style.outlineWidth !== undefined || style.outlineColor) {
    const ow = style.outlineWidth || 1;
    const oc = style.outlineColor ? colorToCSS(style.outlineColor) : 'currentColor';
    css.outline = `${ow}px solid ${oc}`;
    if (style.outlineOffset !== undefined) css.outlineOffset = style.outlineOffset;
  }

  // CSS Transition (web target maps directly to CSS transition)
  if (style.transition) {
    const parts: string[] = [];
    for (const [prop, config] of Object.entries(style.transition)) {
      const dur = (config.duration || 300) / 1000;
      const easingMap: Record<string, string> = {
        linear: 'linear',
        easeIn: 'ease-in',
        easeOut: 'ease-out',
        easeInOut: 'ease-in-out',
      };
      const cssEasing = easingMap[config.easing || 'easeInOut'] || 'ease-in-out';
      const delay = ((config.delay || 0) / 1000);
      // Map 'all' to CSS 'all', otherwise convert camelCase to kebab-case
      const cssProp = prop === 'all' ? 'all' : prop.replace(/([A-Z])/g, '-$1').toLowerCase();
      parts.push(`${cssProp} ${dur}s ${cssEasing} ${delay}s`);
    }
    css.transition = parts.join(', ');
  }

  return css;
}

// ── Shorthand prop → style merging ────────────────────

/** Build a Style from Box shorthand props. style={} overrides. */
function resolveBoxStyle(props: BoxProps): Style | undefined {
  const {
    direction, gap, padding, px, py, margin,
    align, justify, fill, grow, bg, radius,
    w, h, wrap, scroll, hidden, z, style,
  } = props;

  // Fast path: no shorthand props used
  if (
    direction === undefined && gap === undefined && padding === undefined &&
    px === undefined && py === undefined && margin === undefined &&
    align === undefined && justify === undefined && !fill && !grow &&
    bg === undefined && radius === undefined && w === undefined &&
    h === undefined && !wrap && !scroll && !hidden && z === undefined
  ) {
    return style;
  }

  const base: Style = {};
  if (direction === 'row') base.flexDirection = 'row';
  if (direction === 'col') base.flexDirection = 'column';
  if (gap !== undefined) base.gap = gap;
  if (padding !== undefined) base.padding = padding;
  if (px !== undefined) { base.paddingLeft = px; base.paddingRight = px; }
  if (py !== undefined) { base.paddingTop = py; base.paddingBottom = py; }
  if (margin !== undefined) base.margin = margin;
  if (align) base.alignItems = align;
  if (justify) base.justifyContent = justify;
  if (fill) { base.width = '100%'; base.height = '100%'; }
  if (grow) base.flexGrow = 1;
  if (bg !== undefined) base.backgroundColor = bg;
  if (radius !== undefined) base.borderRadius = radius;
  if (w !== undefined) base.width = w;
  if (h !== undefined) base.height = h;
  if (wrap) base.flexWrap = 'wrap';
  if (scroll) base.overflow = 'scroll';
  if (hidden) base.display = 'none';
  if (z !== undefined) base.zIndex = z;

  // style={} wins over shorthand props
  return style ? { ...base, ...style } : base;
}

/** Build a Style from Text shorthand props. style={} overrides. */
function resolveTextStyle(props: TextProps): Style | undefined {
  const { size, color, bold, italic, align, font, style } = props;

  if (
    size === undefined && color === undefined && !bold && !italic &&
    align === undefined && font === undefined
  ) {
    return style;
  }

  const base: Style = {};
  if (size !== undefined) base.fontSize = size;
  if (color !== undefined) base.color = color;
  if (bold) base.fontWeight = 'bold';
  if (italic) (base as any).fontStyle = 'italic';
  if (align) base.textAlign = align;
  if (font) base.fontFamily = font;

  return style ? { ...base, ...style } : base;
}

/** Build a Style from Image shorthand props. style={} overrides. */
function resolveImageStyle(props: ImageProps): Style | undefined {
  const { w, h, radius, style } = props;

  if (w === undefined && h === undefined && radius === undefined) {
    return style;
  }

  const base: Style = {};
  if (w !== undefined) base.width = w;
  if (h !== undefined) base.height = h;
  if (radius !== undefined) base.borderRadius = radius;

  return style ? { ...base, ...style } : base;
}

// ── Primitives ─────────────────────────────────────────

export function Box(props: BoxProps) {
  const {
    hoverStyle, activeStyle,
    onClick, onRelease, onPointerEnter, onPointerLeave,
    onKeyDown, onKeyUp, onTextInput, onWheel,
    onTouchStart, onTouchEnd, onTouchMove,
    onGamepadPress, onGamepadRelease, onGamepadAxis,
    onDragStart, onDrag, onDragEnd,
    children,
  } = props;

  const resolvedStyle = resolveBoxStyle(props);
  const mode = useRendererMode();

  if (mode === 'web') {
    const [isHovered, setIsHovered] = React.useState(false);
    const [isActive, setIsActive] = React.useState(false);
    const baseCSS = styleToCSS(resolvedStyle);
    if (onClick) baseCSS.cursor = 'pointer';
    baseCSS.userSelect = 'none';

    // Merge hover and active styles for web
    let css = baseCSS;
    if (isHovered && hoverStyle) {
      css = { ...css, ...styleToCSS({ ...resolvedStyle, ...hoverStyle }) };
      css.userSelect = 'none';
    }
    if (isActive && activeStyle) {
      css = { ...css, ...styleToCSS({ ...resolvedStyle, ...(isHovered ? hoverStyle : {}), ...activeStyle }) };
      css.userSelect = 'none';
    }

    const dragRef = React.useRef<{ startX: number; startY: number; lastX: number; lastY: number } | null>(null);
    const hasDrag = onDragStart || onDrag || onDragEnd;

    const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
      setIsActive(true);
      if (hasDrag) {
        dragRef.current = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        if (onDragStart) {
          onDragStart({ type: 'dragstart', x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, totalDeltaX: 0, totalDeltaY: 0 });
        }
      }
    }, [hasDrag, onDragStart]);

    const handlePointerMove = React.useCallback((e: React.PointerEvent) => {
      if (dragRef.current && onDrag) {
        const { startX, startY, lastX, lastY } = dragRef.current;
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
        onDrag({ type: 'drag', x: e.clientX, y: e.clientY, startX, startY, dx: e.clientX - lastX, dy: e.clientY - lastY, totalDeltaX: e.clientX - startX, totalDeltaY: e.clientY - startY });
      }
    }, [onDrag]);

    const handlePointerUp = React.useCallback((e: React.PointerEvent) => {
      setIsActive(false);
      if (dragRef.current) {
        const { startX, startY } = dragRef.current;
        if (onDragEnd) {
          onDragEnd({ type: 'dragend', x: e.clientX, y: e.clientY, startX, startY, dx: 0, dy: 0, totalDeltaX: e.clientX - startX, totalDeltaY: e.clientY - startY });
        }
        dragRef.current = null;
      }
    }, [onDragEnd]);

    return (
      <div
        style={css}
        onClick={onClick as any}
        onPointerEnter={(e: any) => {
          setIsHovered(true);
          if (onPointerEnter) onPointerEnter(e);
        }}
        onPointerLeave={(e: any) => {
          setIsHovered(false);
          if (!dragRef.current) setIsActive(false);
          if (onPointerLeave) onPointerLeave(e);
        }}
        onPointerDown={hasDrag ? handlePointerDown : (() => setIsActive(true)) as any}
        onPointerMove={hasDrag ? handlePointerMove : undefined}
        onPointerUp={hasDrag ? handlePointerUp : (() => setIsActive(false)) as any}
        onMouseDown={hasDrag ? undefined : (() => setIsActive(true))}
        onMouseUp={hasDrag ? undefined : (() => setIsActive(false))}
        onKeyDown={onKeyDown as any}
        onKeyUp={onKeyUp as any}
        onInput={onTextInput as any}
        onWheel={onWheel as any}
        onTouchStart={onTouchStart as any}
        onTouchEnd={onTouchEnd as any}
        onTouchMove={onTouchMove as any}
        tabIndex={onKeyDown || onKeyUp || onTextInput ? 0 : undefined}
      >
        {children}
      </div>
    );
  }

  // Native mode: host element for react-reconciler
  return React.createElement(
    'View',
    {
      style: resolvedStyle,
      hoverStyle,
      activeStyle,
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

/** Row — shorthand for <Box direction="row"> */
export function Row(props: BoxProps) {
  return <Box direction="row" {...props} />;
}

/** Col — shorthand for <Box direction="col"> (default, but explicit) */
export function Col(props: BoxProps) {
  return <Box direction="col" {...props} />;
}

export function Text(props: TextProps) {
  const { lines, numberOfLines, onKeyDown, onKeyUp, onTextInput, children } = props;
  const resolvedStyle = resolveTextStyle(props);
  // lines shorthand takes precedence, falls back to numberOfLines
  const resolvedLines = lines ?? numberOfLines;
  const mode = useRendererMode();

  if (mode === 'web') {
    const baseCSS: React.CSSProperties = {
      ...styleToCSS(resolvedStyle),
      display: 'inline',
      flexDirection: undefined,
      userSelect: 'none',
    };

    if (resolvedLines !== undefined) {
      baseCSS.display = '-webkit-box';
      (baseCSS as any).WebkitLineClamp = resolvedLines;
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

  return React.createElement('Text', { style: resolvedStyle, numberOfLines: resolvedLines, onKeyDown, onKeyUp, onTextInput }, children);
}

export function Image(props: ImageProps) {
  const { src, onClick, onWheel } = props;
  const resolvedStyle = resolveImageStyle(props);
  const mode = useRendererMode();

  if (mode === 'web') {
    return (
      <img
        src={src}
        style={{
          ...styleToCSS(resolvedStyle),
          display: 'block',
          flexDirection: undefined,
        }}
        onClick={onClick as any}
        onWheel={onWheel as any}
      />
    );
  }

  return React.createElement('Image', { src, style: resolvedStyle, onClick, onWheel });
}

// Re-export the CSS conversion for advanced usage
export { styleToCSS, colorToCSS };
