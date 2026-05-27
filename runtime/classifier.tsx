/**
 * classifier — global registry of named primitives with theme tokens,
 * layout variants, and breakpoint overrides. Owns the live theme store.
 *
 *   classifier({
 *     Card: {
 *       type: 'Box',
 *       style: { padding: 16, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:surface' },
 *       hoverStyle: { borderColor: 'theme:primary' },
 *       variants: {
 *         magazine:  { style: { flexDirection: 'row', padding: 20 } },
 *         brutalist: { style: { padding: 8, borderRadius: 0 } },
 *       },
 *       bp: {
 *         sm: {
 *           style: { flexDirection: 'column', gap: 4 },
 *           variants: { magazine: { style: { gap: 2 } } },
 *         },
 *       },
 *       use: () => ({ ... })  // optional hook-produced prop overrides
 *     }
 *   });
 *
 * Import and render:
 *
 *   import { classifiers as C } from './classifier';
 *   <C.Card>...</C.Card>
 *
 * Style layer precedence (low → high):
 *   base → bp[current] → variants[active] → bp[current].variants[active] → user props → hook(use)
 *
 * Tokens: any string value like `'theme:bg'` or `'theme:radiusMd'` resolves
 * against the active color / style palettes. Unknown tokens pass through.
 *
 * Theme store: three tiers (colors / styles / variant) plus window-width
 * breakpoints (sm / md / lg / xl). Carts drive it imperatively via setPalette,
 * setVariant, setViewportWidth etc. useSyncExternalStore keeps subscribers in
 * sync. ThemeProvider seeds initial state and exposes colors via context.
 */

import * as React from 'react';
import {
  catppuccin_mocha,
  rounded_airy,
  type ThemeColors,
  type StylePalette,
  type ThemePreset,
} from './theme_presets';
import {
  Box, Text, Image, Pressable, ScrollView, TextInput,
  Canvas, Graph, Native,
} from './primitives';
import { Icon } from './icons/Icon';

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
  /** N-dimensional axis state. Each entry maps an axis name to the active value
   *  on that axis. Classifiers declare per-axis overrides under `dims:` and
   *  the resolver merges all active dims cumulatively. `variant` is the
   *  privileged legacy axis, kept top-level for backwards compat. */
  dims: Record<string, string | null>;
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
  dims: {},
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

/** Set the active value on a named dimension. Pass null to clear it.
 *  Dimensions are orthogonal axes carts can invent (e.g. 'anchor', 'density').
 *  Classifiers declare per-dim overrides under `dims: { <name>: { <value>: {...} } }`. */
export function setDim(name: string, value: string | null): void {
  if ((store.dims[name] ?? null) === value) return;
  const nextDims = { ...store.dims, [name]: value };
  if (value === null) delete nextDims[name];
  store = { ...store, dims: nextDims };
  notify();
}

/** Read the active value of a named dimension (null if unset). */
export function getDim(name: string): string | null {
  return store.dims[name] ?? null;
}

/** Snapshot of all active dims (defensive copy). */
export function getDims(): Record<string, string | null> {
  return { ...store.dims };
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
  React.useLayoutEffect(() => {
    if (initialVariant !== undefined) setVariant(initialVariant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

/** Live active value of a named dimension. null means unset. */
export function useActiveDim(name: string): string | null {
  return React.useSyncExternalStore(subscribe, () => snapshot().dims[name] ?? null);
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

// ════════════════════════════════════════════════════════════════
// Classifier registry
// ════════════════════════════════════════════════════════════════

// The renderer's actual host elements. Row/Col are JSX sugar over Box
// with flexDirection set — they're not primitives and have no place here.
// Classifiers express direction explicitly: type: 'Box', style: { flexDirection: 'row' }.
//
// Icon is a wrapper over Graph that takes `icon` (path data) / `name` /
// `size` / `color` / `strokeWidth` as props. It earns a slot here so
// classifiers can theme `color` via `'theme:NAME'` resolution.
const PRIMITIVES: Record<string, any> = {
  Box, Text, Image, Pressable, ScrollView, TextInput,
  Canvas, CanvasNode: Canvas.Node, CanvasPath: Canvas.Path, CanvasClamp: Canvas.Clamp,
  Graph, GraphNode: Graph.Node, GraphPath: Graph.Path,
  Native, Icon,
};

const STYLE_KEYS = [
  'style', 'hoverStyle', 'activeStyle', 'focusStyle',
  'textStyle', 'contentContainerStyle',
];

const STYLE_KEY_SET = new Set(STYLE_KEYS);
const RESERVED_KEYS = new Set(['type', 'use', 'variants', 'bp', 'dims']);

// ── Types ─────────────────────────────────────────────

export type StyleBlock = Record<string, any>;

export interface ClassifierStyleSet {
  style?: StyleBlock;
  hoverStyle?: StyleBlock;
  activeStyle?: StyleBlock;
  focusStyle?: StyleBlock;
  textStyle?: StyleBlock;
  contentContainerStyle?: StyleBlock;
  /** Non-style default props passed through to the primitive. */
  [key: string]: any;
}

export type VariantMap = Record<string, ClassifierStyleSet>;

export interface BreakpointOverride extends ClassifierStyleSet {
  variants?: VariantMap;
}

export type BreakpointMap = Partial<Record<Breakpoint, BreakpointOverride>>;

/** Per-dim override table. The outer key is the dim name (e.g. 'anchor'),
 *  the inner key is the active value on that dim (e.g. 'left' / 'right'),
 *  the value is the style-set merged in when that value is active. */
export type DimMap = Record<string, Record<string, ClassifierStyleSet>>;

export interface ClassifierDef extends ClassifierStyleSet {
  type: string;
  use?: () => Record<string, any>;
  variants?: VariantMap;
  dims?: DimMap;
  bp?: BreakpointMap;
}

// ── Style merging ─────────────────────────────────────

function shallowMergeStyle(...blocks: Array<StyleBlock | undefined>): StyleBlock | undefined {
  const present = blocks.filter((b): b is StyleBlock => !!b && typeof b === 'object');
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return Object.assign({}, ...present);
}

/** Merge a layered ClassifierStyleSet (for every STYLE_KEY) plus flat defaults. */
function mergeStyleSets(...sets: Array<ClassifierStyleSet | undefined>): ClassifierStyleSet {
  const out: ClassifierStyleSet = {};
  for (const s of sets) {
    if (!s) continue;
    for (const k of Object.keys(s)) {
      if (RESERVED_KEYS.has(k)) continue;
      if (STYLE_KEY_SET.has(k)) {
        out[k] = shallowMergeStyle(out[k], s[k]);
      } else {
        // non-style defaults: later wins
        out[k] = s[k];
      }
    }
  }
  return out;
}

/** Merge resolved defaults with user props — style keys shallow-merge, others overwrite. */
function mergeUserProps(defaults: Record<string, any>, user: Record<string, any>): Record<string, any> {
  const merged: Record<string, any> = { ...defaults, ...user };
  for (const k of STYLE_KEYS) {
    if (defaults[k] && user[k]) {
      merged[k] = { ...defaults[k], ...user[k] };
    }
  }
  return merged;
}

// ── Per-classifier compile ────────────────────────────

/** Split a def into a style-set (style blocks + flat defaults), stripping reserved keys. */
function stripReserved(def: ClassifierDef | ClassifierStyleSet): ClassifierStyleSet {
  const out: ClassifierStyleSet = {};
  for (const k of Object.keys(def)) {
    if (RESERVED_KEYS.has(k)) continue;
    out[k] = (def as any)[k];
  }
  return out;
}

function collectTokens(def: ClassifierDef): boolean {
  if (hasTokens(stripReserved(def) as Record<string, any>)) return true;
  if (def.variants) {
    for (const v of Object.values(def.variants)) {
      if (hasTokens(v as Record<string, any>)) return true;
    }
  }
  if (def.dims) {
    for (const dim of Object.values(def.dims)) {
      if (!dim) continue;
      for (const v of Object.values(dim)) {
        if (hasTokens(v as Record<string, any>)) return true;
      }
    }
  }
  if (def.bp) {
    for (const bp of Object.values(def.bp)) {
      if (!bp) continue;
      if (hasTokens(bp as Record<string, any>)) return true;
    }
  }
  return false;
}

function hasAnyVariants(def: ClassifierDef): boolean {
  if (def.variants && Object.keys(def.variants).length) return true;
  if (def.bp) {
    for (const bp of Object.values(def.bp)) {
      if (bp?.variants && Object.keys(bp.variants).length) return true;
    }
  }
  return false;
}

function hasAnyDims(def: ClassifierDef): boolean {
  if (!def.dims) return false;
  for (const dim of Object.values(def.dims)) {
    if (dim && Object.keys(dim).length) return true;
  }
  return false;
}

function hasAnyBreakpoints(def: ClassifierDef): boolean {
  return !!(def.bp && Object.keys(def.bp).length);
}

/** Build the effective style-set for the active variant, breakpoint, and dims.
 *  Merge order: base → bp[current] → variants[variant] → bp[current].variants[variant]
 *               → dims.<dim1>[active] → dims.<dim2>[active] → ...
 *  Dims are independent axes; their overrides layer cumulatively on top of
 *  the variant-resolved base. Cross-axis specs (combos) are out of scope for v1. */
function resolveEffective(
  def: ClassifierDef,
  variant: string | null,
  bp: Breakpoint,
  dims: Record<string, string | null>,
): ClassifierStyleSet {
  const base = stripReserved(def);
  const bpBase = def.bp?.[bp] ? stripReserved(def.bp[bp] as ClassifierStyleSet) : undefined;
  const varBase = variant && def.variants?.[variant]
    ? stripReserved(def.variants[variant])
    : undefined;
  const bpVar = variant && def.bp?.[bp]?.variants?.[variant]
    ? stripReserved(def.bp[bp]!.variants![variant])
    : undefined;
  if (!def.dims) {
    return mergeStyleSets(base, bpBase, varBase, bpVar);
  }
  const dimMerges: ClassifierStyleSet[] = [];
  for (const dimName of Object.keys(def.dims)) {
    const active = dims[dimName];
    if (!active) continue;
    const styleSet = def.dims[dimName]?.[active];
    if (styleSet) dimMerges.push(stripReserved(styleSet));
  }
  return mergeStyleSets(base, bpBase, varBase, bpVar, ...dimMerges);
}

// ── Registry ──────────────────────────────────────────

const _registry: Record<string, any> = {};

export function classifier(defs: Record<string, ClassifierDef>): void {
  // Expand nested `.Suffix` siblings into top-level entries that inherit
  // the parent's type + style-set. Lets a family of variants live as
  // `Parent { '.Tool': { borderColor }, '.Stuck': { ... } }` instead of
  // copy-pasting the whole body per state.
  const expanded: Record<string, ClassifierDef> = {};
  for (const name of Object.keys(defs)) {
    const def = defs[name];
    const dotKeys = Object.keys(def).filter(k => k.startsWith('.'));
    if (dotKeys.length === 0) {
      expanded[name] = def;
      continue;
    }
    const parentClean: ClassifierDef = { type: def.type } as ClassifierDef;
    for (const k of Object.keys(def)) {
      if (k.startsWith('.')) continue;
      (parentClean as any)[k] = (def as any)[k];
    }
    expanded[name] = parentClean;
    for (const dk of dotKeys) {
      const childRaw = (def as any)[dk] as ClassifierStyleSet & { type?: string };
      const childName = name + dk.slice(1);
      const merged = mergeStyleSets(stripReserved(parentClean), childRaw);
      const childDef: ClassifierDef = {
        type: childRaw.type ?? parentClean.type,
        ...merged,
      };
      // Inherit parent variants/bp/use if child didn't set its own.
      if (parentClean.variants && !(childRaw as any).variants) childDef.variants = parentClean.variants;
      if (parentClean.bp && !(childRaw as any).bp) childDef.bp = parentClean.bp;
      if (parentClean.use && !(childRaw as any).use) childDef.use = parentClean.use;
      expanded[childName] = childDef;
    }
  }

  for (const name of Object.keys(expanded)) {
    if (_registry[name]) {
      throw new Error(
        `classifier: "${name}" already registered. Classifiers are global — one name, one definition.`,
      );
    }

    const def = expanded[name];
    const Primitive = PRIMITIVES[def.type];
    if (!Primitive) {
      throw new Error(
        `classifier: "${def.type}" is not a primitive. Valid: ${Object.keys(PRIMITIVES).join(', ')}`,
      );
    }

    const needsTokens = collectTokens(def);
    const needsVariants = hasAnyVariants(def);
    const needsDims = hasAnyDims(def);
    const needsBp = hasAnyBreakpoints(def);
    const needsHook = typeof def.use === 'function';
    const needsStore = needsTokens || needsVariants || needsDims || needsBp;

    // Precompute the static base (no variant, no bp) for the fast path.
    const staticBase = stripReserved(def);
    const staticBaseIsEmpty = Object.keys(staticBase).length === 0;

    let C: any;

    if (!needsStore && !needsHook && staticBaseIsEmpty) {
      // Identity: classifier adds nothing on top of the primitive.
      C = Primitive;
    } else if (!needsStore && !needsHook) {
      // Defaults only, no tokens, no variants, no bp, no hook.
      C = (props: any) =>
        React.createElement(Primitive, mergeUserProps(staticBase, props));
    } else {
      C = (props: any) => {
        const snap = needsStore ? __useClassifierSnapshot() : null;

        let effective: ClassifierStyleSet;
        if (snap && (needsVariants || needsBp || needsDims)) {
          effective = resolveEffective(def, snap.variant, snap.breakpoint, snap.dims);
        } else {
          effective = staticBase;
        }

        let resolved: Record<string, any>;
        if (needsTokens && snap) {
          resolved = resolveTokens(effective as Record<string, any>, snap.colors, snap.styles);
        } else {
          resolved = effective as Record<string, any>;
        }

        const hookProps = needsHook ? def.use!() : null;
        const merged = hookProps
          ? mergeUserProps(resolved, mergeUserProps(hookProps, props))
          : mergeUserProps(resolved, props);
        return React.createElement(Primitive, merged);
      };
    }

    C.displayName = name;
    C.__isClassifier = true;
    C.__def = def;
    _registry[name] = C;
  }
}

/** Read-only view of the classifier registry. `<C.Card>`, `<C.Header>`, etc. */
export const classifiers: Readonly<Record<string, any>> = _registry;

/** Inspect a registered classifier by name (for tooling). */
export function getClassifier(name: string): any | null {
  return _registry[name] ?? null;
}

/** All registered classifier names. */
export function classifierNames(): string[] {
  return Object.keys(_registry);
}
