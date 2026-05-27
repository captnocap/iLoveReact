/**
 * theme — global theme state for classifier token resolution.
 *
 * Three tiers, one atomic swap:
 *   1. Color palette     — 18 semantic tokens, strings ('#rrggbb')
 *   2. Style palette     — 11 numeric tokens (radii, spacing, borders, fonts)
 *   3. Layout variant    — a named variant key that classifiers can override style on
 *
 * Plus: window-width breakpoints (sm / md / lg / xl) that classifiers can declare
 * `bp: { ... }` overrides for. Thresholds configurable via setBreakpointThresholds.
 *
 * ThemeProvider renders colors/styles into React context; variant and breakpoint
 * live on a module-level store that carts drive imperatively (setVariant,
 * setViewportWidth). useSyncExternalStore keeps subscribers in sync without
 * re-rendering the provider tree.
 *
 * Ported from tsz/framework/theme.zig + tsz/framework/breakpoint.zig.
 */

import * as React from 'react';
import {
  catppuccin_mocha,
  rounded_airy,
  type ThemeColors,
  type StylePalette,
  type ThemePreset,
} from './theme_presets';

export type { ThemeColors, StylePalette, ThemePreset } from './theme_presets';
export { themes, findTheme } from './theme_presets';

// ── Breakpoint tiers ─────────────────────────────────────────────

export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl';

const BP_ORDER: Breakpoint[] = ['sm', 'md', 'lg', 'xl'];

function bpFromWidth(w: number, md: number, lg: number, xl: number): Breakpoint {
  if (w >= xl) return 'xl';
  if (w >= lg) return 'lg';
  if (w >= md) return 'md';
  return 'sm';
}

// ── Module-level store ─────────────────────────────────────────

type Store = {
  colors: ThemeColors;
  styles: StylePalette;
  variant: string | null;
  viewportWidth: number;
  breakpoint: Breakpoint;
  thresholdMd: number;
  thresholdLg: number;
  thresholdXl: number;
};

let store: Store = {
  colors: catppuccin_mocha,
  styles: rounded_airy,
  variant: null,
  viewportWidth: 1280,
  breakpoint: 'lg',
  thresholdMd: 640,
  thresholdLg: 1024,
  thresholdXl: 1440,
};

const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function snapshot(): Store {
  return store;
}

// ── Imperative API ────────────────────────────────────────────

/** Replace the active color palette. */
export function setPalette(colors: ThemeColors): void {
  store = { ...store, colors };
  notify();
}

/** Merge individual color tokens into the active palette. */
export function setTokens(partial: Partial<ThemeColors>): void {
  store = { ...store, colors: { ...store.colors, ...(partial as Record<string, string>) } };
  notify();
}

/** Replace the active style (f32) palette. */
export function setStylePalette(styles: StylePalette): void {
  store = { ...store, styles };
  notify();
}

/** Merge individual style tokens into the active style palette. */
export function setStyleTokens(partial: Partial<StylePalette>): void {
  store = { ...store, styles: { ...store.styles, ...(partial as Record<string, number>) } };
  notify();
}

/** Set the active layout variant. Pass null to return to the base style. */
export function setVariant(variant: string | null): void {
  if (store.variant === variant) return;
  store = { ...store, variant };
  notify();
}

/** Apply colors + styles + (optional) variant atomically. */
export function applyPreset(preset: ThemePreset): void {
  store = {
    ...store,
    colors: preset.colors,
    styles: preset.styles,
    variant: preset.variant ?? store.variant,
  };
  notify();
}

/** Update the viewport width; recomputes the active breakpoint tier. */
export function setViewportWidth(width: number): void {
  const bp = bpFromWidth(width, store.thresholdMd, store.thresholdLg, store.thresholdXl);
  if (width === store.viewportWidth && bp === store.breakpoint) return;
  store = { ...store, viewportWidth: width, breakpoint: bp };
  notify();
}

/** Override breakpoint thresholds. sm is always 0. Call before the first render if possible. */
export function setBreakpointThresholds(md: number, lg: number, xl: number): void {
  const bp = bpFromWidth(store.viewportWidth, md, lg, xl);
  store = { ...store, thresholdMd: md, thresholdLg: lg, thresholdXl: xl, breakpoint: bp };
  notify();
}

// ── Read-only accessors (non-hook) ────────────────────────────

export function getColors(): ThemeColors { return store.colors; }
export function getStylePalette(): StylePalette { return store.styles; }
export function getVariant(): string | null { return store.variant; }
export function getBreakpoint(): Breakpoint { return store.breakpoint; }
export function getViewportWidth(): number { return store.viewportWidth; }
export function breakpointAtLeast(bp: Breakpoint): boolean {
  return BP_ORDER.indexOf(store.breakpoint) >= BP_ORDER.indexOf(bp);
}

// ── Token resolution (string + f32) ────────────────────────────

const THEME_PREFIX = 'theme:';

export function isThemeToken(v: unknown): v is string {
  return typeof v === 'string' && (v as string).startsWith(THEME_PREFIX);
}

/**
 * Resolve a single `'theme:xxx'` token against the supplied palettes.
 * Order: colors first (strings), then styles (numbers). Unknown names
 * pass through verbatim so carts can use `theme:` names the engine
 * understands even when this runtime doesn't.
 */
export function resolveToken(
  token: string,
  colors: ThemeColors,
  styles: StylePalette,
): string | number {
  const name = token.slice(THEME_PREFIX.length);
  if (name in colors) return (colors as any)[name] as string;
  if (name in styles) return (styles as any)[name] as number;
  return token;
}

/** Deep-resolve every `theme:` token in an object. Arrays + functions pass through. */
export function resolveTokens<T extends Record<string, any>>(
  obj: T,
  colors: ThemeColors,
  styles: StylePalette,
): T {
  const out: Record<string, any> = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (isThemeToken(v)) {
      out[k] = resolveToken(v as string, colors, styles);
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Function)) {
      out[k] = resolveTokens(v, colors, styles);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/** True if any leaf string starts with `'theme:'`. */
export function hasTokens(obj: Record<string, any>): boolean {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (isThemeToken(v)) return true;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Function)) {
      if (hasTokens(v)) return true;
    }
  }
  return false;
}

// ── React integration ────────────────────────────────────────────

const ThemeContext = React.createContext<ThemeColors | null>(null);

export interface ThemeProviderProps {
  /** Override individual color tokens. Merged onto the module-level palette. */
  colors?: Partial<ThemeColors>;
  /** Override individual style tokens. Merged onto the module-level style palette. */
  styles?: Partial<StylePalette>;
  /** Initial layout variant (only applied once on first mount; imperative after). */
  initialVariant?: string | null;
  children?: any;
}

/**
 * ThemeProvider — seeds module-level state from props on mount, then exposes
 * the current colors via context for components that don't need variant/bp
 * reactivity. For anything that reads variant or breakpoint, use the hooks.
 */
export function ThemeProvider({ colors, styles, initialVariant, children }: ThemeProviderProps) {
  // One-time initial seed (happens in a layout effect, before paint).
  React.useLayoutEffect(() => {
    if (initialVariant !== undefined) setVariant(initialVariant);
    // initialVariant is intentionally read only once; imperative setVariant drives it after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the module store in sync with the props on every identity change.
  React.useLayoutEffect(() => {
    if (colors) setTokens(colors);
  }, [colors]);

  React.useLayoutEffect(() => {
    if (styles) setStyleTokens(styles);
  }, [styles]);

  const current = useThemeColors();
  return React.createElement(ThemeContext.Provider, { value: current }, children);
}

/** Live colors — re-renders when the palette or individual tokens change. */
export function useThemeColors(): ThemeColors {
  return React.useSyncExternalStore(subscribe, () => snapshot().colors);
}

/** Live colors, but returns null outside a ThemeProvider (compat shim). */
export function useThemeColorsOptional(): ThemeColors | null {
  // Module store always has a palette; this shim exists for the old classifier API.
  return useThemeColors();
}

/** Live style (f32) palette. */
export function useStylePalette(): StylePalette {
  return React.useSyncExternalStore(subscribe, () => snapshot().styles);
}

/** Live active variant. null means the base style. */
export function useActiveVariant(): string | null {
  return React.useSyncExternalStore(subscribe, () => snapshot().variant);
}

/** Live breakpoint tier. Updates when setViewportWidth crosses a threshold. */
export function useBreakpoint(): Breakpoint {
  return React.useSyncExternalStore(subscribe, () => snapshot().breakpoint);
}

/** Live viewport width. */
export function useViewportWidth(): number {
  return React.useSyncExternalStore(subscribe, () => snapshot().viewportWidth);
}

/** Subscribe to any store change (colors / styles / variant / viewport). */
export function useThemeStore(): {
  colors: ThemeColors;
  styles: StylePalette;
  variant: string | null;
  breakpoint: Breakpoint;
} {
  return React.useSyncExternalStore(subscribe, () => {
    const s = snapshot();
    return { colors: s.colors, styles: s.styles, variant: s.variant, breakpoint: s.breakpoint };
  });
}

// Internal — classifier reads the store directly + subscribes in one hook.
export function __useClassifierSnapshot(): Store {
  return React.useSyncExternalStore(subscribe, snapshot);
}
