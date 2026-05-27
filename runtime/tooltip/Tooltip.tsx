import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import { Box, Row, Text } from '@reactjit/runtime/primitives';
import { useAutoFlip, type TooltipRect, type TooltipViewport } from './useAutoFlip';
import { callHost, hasHost } from '../ffi';

type TooltipSide = 'top' | 'bottom' | 'left' | 'right';
export type TooltipVariant = 'sweatshop-ui' | 'sweatshop-chart' | 'component-gallery-chart';
export type TooltipRow = { label: string; value: string; color?: string };
export type TooltipAnchor =
  | { kind: 'cursor'; offsetX?: number; offsetY?: number }
  | { kind: 'absolute'; x: number; y: number; offsetX?: number; offsetY?: number };

type TooltipPreset = {
  minWidth: number;
  maxWidth: number;
  paddingX: number;
  paddingY: number;
  gap: number;
  radius: number;
  borderColor: string;
  backgroundColor: string;
  textColor: string;
  dimColor: string;
  shortcutBg?: string;
  shortcutBorder?: string;
  staticSurfaceOverlay?: boolean;
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffset?: { width: number; height: number };
};

type TooltipPopupProps = {
  variant?: TooltipVariant;
  title?: string;
  label?: string;
  rows?: TooltipRow[];
  shortcut?: string;
  markdown?: boolean;
  style?: any;
  staticSurfaceOverlay?: boolean;
};

type RectAnchorState = { kind: 'rect'; rect: TooltipRect; side?: TooltipSide };
type TooltipOverlayAnchor = RectAnchorState | TooltipAnchor;

type TooltipState = TooltipPopupProps & {
  sourceId: string;
  anchor: TooltipOverlayAnchor;
};

type TooltipContextValue = {
  setActive: (sourceId: string, payload: Omit<TooltipState, 'sourceId'> | null) => void;
};

type TriggerTooltipProps = TooltipPopupProps & {
  side?: TooltipSide;
  delayMs?: number;
  disabled?: boolean;
  children: any;
  visible?: never;
  x?: never;
  y?: never;
  anchor?: never;
};

type PositionedTooltipProps = TooltipPopupProps & {
  visible: boolean;
  anchor?: TooltipAnchor;
  x?: number;
  y?: number;
  children?: never;
};

export type TooltipProps = TriggerTooltipProps | PositionedTooltipProps;

const TooltipContext = createContext<TooltipContextValue | null>(null);

const PRESETS: Record<TooltipVariant, TooltipPreset> = {
  'sweatshop-ui': {
    minWidth: 120,
    maxWidth: 320,
    paddingX: 8,
    paddingY: 5,
    gap: 8,
    radius: 6,
    borderColor: '#30363d',
    backgroundColor: '#161b22',
    textColor: '#f0f6fc',
    dimColor: '#8b949e',
    shortcutBg: '#0d1117',
    shortcutBorder: '#30363d',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  'sweatshop-chart': {
    minWidth: 140,
    maxWidth: 260,
    paddingX: 10,
    paddingY: 10,
    gap: 6,
    radius: 12,
    borderColor: '#30363d',
    backgroundColor: '#161b22',
    textColor: '#f0f6fc',
    dimColor: '#8b949e',
    shadowColor: 'rgba(0,0,0,0.32)',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  'component-gallery-chart': {
    minWidth: 120,
    maxWidth: 240,
    paddingX: 8,
    paddingY: 8,
    gap: 4,
    radius: 6,
    borderColor: '#364151',
    backgroundColor: '#202631',
    textColor: '#edf2f7',
    dimColor: '#9aa6b7',
    staticSurfaceOverlay: true,
  },
};

function getMousePoint() {
  return {
    x: Number(callHost<number>('getMouseX', 0)) || 0,
    y: Number(callHost<number>('getMouseY', 0)) || 0,
  };
}

function useFade(target: boolean, durationMs: number = 120): number {
  const [value, setValue] = useState(target ? 1 : 0);

  useEffect(() => {
    if (durationMs <= 0) {
      setValue(target ? 1 : 0);
      return;
    }
    const start = value;
    const goal = target ? 1 : 0;
    if (start === goal) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const t = Math.max(0, Math.min(1, elapsed / durationMs));
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(start + (goal - start) * eased);
      if (t >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [durationMs, target]);

  return value;
}

function useCursorPoint(active: boolean) {
  const [point, setPoint] = useState(() => getMousePoint());

  useEffect(() => {
    if (!active) return;
    setPoint(getMousePoint());
    const timer = setInterval(() => setPoint(getMousePoint()), 16);
    return () => clearInterval(timer);
  }, [active]);

  return point;
}

function getViewport(): TooltipViewport {
  // Browser globals (innerWidth/innerHeight) first; fall back to legacy Zig
  // FFI fields (__viewportWidth/__viewportHeight, plain values not fns).
  const host = globalThis as any;
  const width = typeof host?.innerWidth === 'number' ? host.innerWidth : typeof host?.__viewportWidth === 'number' ? host.__viewportWidth : 0;
  const height = typeof host?.innerHeight === 'number' ? host.innerHeight : typeof host?.__viewportHeight === 'number' ? host.__viewportHeight : 0;
  return { width, height };
}

function tooltipPreset(variant?: TooltipVariant): TooltipPreset {
  // Unknown variants (e.g. legacy "gallery") slip through the type system at
  // runtime — fall back to the default preset rather than returning undefined
  // and crashing estimateSize() on `.minWidth`.
  return PRESETS[variant as TooltipVariant] || PRESETS['sweatshop-ui'];
}

function estimateSize(content: TooltipPopupProps): { width: number; height: number } {
  const preset = tooltipPreset(content.variant);
  const title = content.title || content.label || '';
  const rows = content.rows || [];
  const shortcut = content.shortcut || '';
  let width = Math.max(preset.minWidth, 20 + title.length * 6 + (shortcut ? shortcut.length * 6 + 24 : 0));
  for (const row of rows) width = Math.max(width, 28 + row.label.length * 5 + row.value.length * 6);
  width = Math.min(preset.maxWidth, width);
  const titleLines = Math.max(1, Math.ceil(title.length / 32));
  const height = preset.paddingY * 2 + titleLines * 14 + (rows.length > 0 ? rows.length * 16 + preset.gap : 0);
  return { width, height };
}

function ShortcutChip(props: { chord: string; preset: TooltipPreset }) {
  return (
    <Box
      style={{
        paddingLeft: 6,
        paddingRight: 6,
        paddingTop: 2,
        paddingBottom: 2,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: props.preset.shortcutBorder || props.preset.borderColor,
        backgroundColor: props.preset.shortcutBg || props.preset.backgroundColor,
      }}
    >
      <Text fontSize={8} color={props.preset.dimColor} style={{ fontWeight: 'bold' }}>
        {props.chord}
      </Text>
    </Box>
  );
}

function TooltipCard(props: TooltipPopupProps) {
  const preset = tooltipPreset(props.variant);
  const rows = props.rows || [];
  const title = props.title || props.label;
  return (
    <Box
      style={{
        minWidth: preset.minWidth,
        maxWidth: preset.maxWidth,
        paddingLeft: preset.paddingX,
        paddingRight: preset.paddingX,
        paddingTop: preset.paddingY,
        paddingBottom: preset.paddingY,
        gap: preset.gap,
        borderRadius: preset.radius,
        borderWidth: 1,
        borderColor: preset.borderColor,
        backgroundColor: preset.backgroundColor,
        pointerEvents: 'none',
        shadowColor: preset.shadowColor,
        shadowOpacity: preset.shadowOpacity,
        shadowRadius: preset.shadowRadius,
        shadowOffset: preset.shadowOffset,
        ...(props.style || {}),
      }}
    >
      {title ? (
        rows.length > 0 ? (
          <Text fontSize={10} color={preset.textColor} style={{ fontWeight: 'bold' }}>
            {title}
          </Text>
        ) : (
          <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Text fontSize={9} color={preset.textColor} style={{ fontWeight: 'bold', flexShrink: 1 }}>
              {title}
            </Text>
            {props.shortcut ? <ShortcutChip chord={props.shortcut} preset={preset} /> : null}
          </Row>
        )
      ) : null}
      {rows.map((row) => (
        <Row key={row.label} style={{ gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
          <Row style={{ gap: 6, alignItems: 'center' }}>
            {row.color ? <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color }} /> : null}
            <Text fontSize={9} color={preset.dimColor}>{row.label}</Text>
          </Row>
          <Text fontSize={9} color={preset.textColor} style={{ fontWeight: 'bold' }}>{row.value}</Text>
        </Row>
      ))}
    </Box>
  );
}

function pointPlacement(point: { x: number; y: number }, size: { width: number; height: number }, viewport: TooltipViewport, offsetX: number, offsetY: number) {
  const padding = 8;
  let left = point.x + offsetX;
  let top = point.y + offsetY;
  if (left + size.width > viewport.width - padding) left = Math.max(padding, point.x - size.width - offsetX);
  if (top + size.height > viewport.height - padding) top = Math.max(padding, point.y - size.height - offsetY);
  left = Math.max(padding, Math.min(left, Math.max(padding, viewport.width - size.width - padding)));
  top = Math.max(padding, Math.min(top, Math.max(padding, viewport.height - size.height - padding)));
  return { left, top, maxWidth: Math.max(0, viewport.width - padding * 2) };
}

function TooltipOverlay(props: { active: TooltipState | null; viewport: TooltipViewport }) {
  const visible = !!props.active;
  const opacity = useFade(visible, 120);
  const active = props.active;
  const size = active ? estimateSize(active) : { width: 0, height: 0 };
  const cursor = useCursorPoint(visible);
  const rectPlacement = useAutoFlip({
    anchor: active && active.anchor.kind === 'rect' ? active.anchor.rect : null,
    side: active && active.anchor.kind === 'rect' ? active.anchor.side : undefined,
    size,
    viewport: props.viewport,
  });
  const placement = useMemo(() => {
    if (!active) return { left: 0, top: 0, maxWidth: 0 };
    if (active.anchor.kind === 'rect') return rectPlacement;
    if (active.anchor.kind === 'cursor') {
      return pointPlacement(cursor, size, props.viewport, active.anchor.offsetX ?? 14, active.anchor.offsetY ?? 14);
    }
    return pointPlacement({ x: active.anchor.x, y: active.anchor.y }, size, props.viewport, active.anchor.offsetX ?? 0, active.anchor.offsetY ?? 0);
  }, [active, cursor, props.viewport, rectPlacement, size]);

  if (!active || opacity <= 0.01) return null;

  return (
    <Box
      staticSurfaceOverlay={active.staticSurfaceOverlay ?? tooltipPreset(active.variant).staticSurfaceOverlay}
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 10000, pointerEvents: 'none', overflow: 'visible' }}
    >
      <Box
        style={{
          position: 'absolute',
          left: placement.left,
          top: placement.top,
          maxWidth: placement.maxWidth,
          opacity,
        }}
      >
        <TooltipCard {...active} />
      </Box>
    </Box>
  );
}

function isPositionedTooltip(props: TooltipProps): props is PositionedTooltipProps {
  return typeof (props as PositionedTooltipProps).visible === 'boolean';
}

export function TooltipRoot(props: { children: any }) {
  const [viewport, setViewport] = useState<TooltipViewport>(getViewport());
  const [active, setActive] = useState<TooltipState | null>(null);

  useEffect(() => {
    // addEventListener is a DOM API, not Zig FFI — host stays cast.
    const host = globalThis as any;
    const target = typeof host?.addEventListener === 'function' ? host : (typeof window !== 'undefined' ? window : null);
    if (!target || typeof target.addEventListener !== 'function') return;
    const update = () => setViewport(getViewport());
    update();
    target.addEventListener('resize', update);
    return () => target.removeEventListener('resize', update);
  }, []);

  const setActiveForSource = useCallback((sourceId: string, payload: Omit<TooltipState, 'sourceId'> | null) => {
    setActive((current) => {
      if (!payload) return current?.sourceId === sourceId ? null : current;
      return { ...payload, sourceId };
    });
  }, []);

  const value = useMemo(() => ({ setActive: setActiveForSource }), [setActiveForSource]);

  return (
    <TooltipContext.Provider value={value}>
      <Box style={{ position: 'relative', width: '100%', height: '100%', overflow: 'visible' }}>
        {props.children}
        <TooltipOverlay active={active} viewport={viewport} />
      </Box>
    </TooltipContext.Provider>
  );
}

export function Tooltip(props: TooltipProps) {
  const ctx = useContext(TooltipContext);
  const sourceId = useId();

  if (isPositionedTooltip(props)) {
    const anchor: TooltipAnchor = props.anchor || { kind: 'absolute', x: props.x ?? 0, y: props.y ?? 0 };
    useEffect(() => {
      if (!ctx) return;
      if (!props.visible) {
        ctx.setActive(sourceId, null);
        return;
      }
      ctx.setActive(sourceId, {
        variant: props.variant,
        title: props.title,
        label: props.label,
        rows: props.rows,
        shortcut: props.shortcut,
        markdown: props.markdown,
        style: props.style,
        staticSurfaceOverlay: props.staticSurfaceOverlay,
        anchor,
      });
      return () => ctx.setActive(sourceId, null);
    }, [anchor, ctx, props.label, props.markdown, props.rows, props.shortcut, props.staticSurfaceOverlay, props.style, props.title, props.variant, props.visible, sourceId]);

    if (ctx) return null;

    const preset = tooltipPreset(props.variant);
    if (!props.visible) return null;
    const fallbackPoint = anchor.kind === 'absolute' ? { x: anchor.x, y: anchor.y } : getMousePoint();
    const fallbackPlacement = pointPlacement(fallbackPoint, estimateSize(props), getViewport(), anchor.offsetX ?? (anchor.kind === 'cursor' ? 14 : 0), anchor.offsetY ?? (anchor.kind === 'cursor' ? 14 : 0));
    return (
      <Box
        staticSurfaceOverlay={props.staticSurfaceOverlay ?? preset.staticSurfaceOverlay}
        style={{
          position: 'absolute',
          left: fallbackPlacement.left,
          top: fallbackPlacement.top,
          zIndex: 30,
          pointerEvents: 'none',
        }}
      >
        <TooltipCard {...props} />
      </Box>
    );
  }

  const [hovered, setHovered] = useState(false);
  const [anchor, setAnchor] = useState<TooltipRect | null>(null);
  const side = props.side || 'top';
  const delayMs = props.delayMs ?? 500;
  const variant = props.variant || 'sweatshop-ui';

  useEffect(() => {
    if (!ctx || props.disabled || !hovered || !anchor) {
      ctx?.setActive(sourceId, null);
      return;
    }
    const timer = setTimeout(() => {
      ctx.setActive(sourceId, {
        label: props.label,
        markdown: props.markdown,
        shortcut: props.shortcut,
        variant,
        anchor: { kind: 'rect', rect: anchor, side },
      });
    }, delayMs);
    return () => {
      clearTimeout(timer);
      ctx.setActive(sourceId, null);
    };
  }, [anchor, ctx, delayMs, hovered, props.disabled, props.label, props.markdown, props.shortcut, side, sourceId, variant]);

  if (props.disabled) return props.children;

  return (
    <Box
      onHoverEnter={() => setHovered(true)}
      onHoverExit={() => setHovered(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onLayout={(rect: any) => setAnchor(rect)}
      style={{ position: 'relative', display: 'flex', overflow: 'visible' }}
    >
      {props.children}
    </Box>
  );
}
