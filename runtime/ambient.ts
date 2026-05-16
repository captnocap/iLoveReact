// =============================================================================
// AMBIENT REACT — hooks + element helpers
// =============================================================================
// Every named export here becomes a globally-available identifier in every
// .tsx source under the build pipeline, via esbuild's `inject` option. A
// source file can write `useState(0)` with no imports at the top — esbuild
// sees the free identifier, matches it against an export here, and inserts
// the equivalent of a named import at bundle time. Additive: existing
// files with explicit imports keep working.
//
// Every export is a LAZY WRAPPER around require('react'). This is the only
// shape that survives esbuild's interaction with react/index.js: the
// bundler injects `init_ambient()` into react's own CJS body, which makes
// init_ambient run recursively during require_react's first call — at
// which point mod.exports is still the partial `{}`. A top-level
// `const memo = require('react').memo` captures undefined. Wrapping each
// export so the `require('react').X` lookup happens at CALL TIME (render
// time, not module init) means the lookup runs long after react/index.js
// has finished its body and mod.exports points at the real React module.
// =============================================================================

function r(): any { return require('react'); }

// ── Hooks (called at render time, lazy lookup is fine) ──────────────────────

export const useState = function useState(...a: any[])               { return r().useState(...a); };
export const useEffect = function useEffect(...a: any[])             { return r().useEffect(...a); };
export const useLayoutEffect = function useLayoutEffect(...a: any[]) { return r().useLayoutEffect(...a); };
export const useCallback = function useCallback(...a: any[])         { return r().useCallback(...a); };
export const useMemo = function useMemo(...a: any[])                 { return r().useMemo(...a); };
export const useRef = function useRef(...a: any[])                   { return r().useRef(...a); };
export const useContext = function useContext(...a: any[])           { return r().useContext(...a); };
export const useReducer = function useReducer(...a: any[])           { return r().useReducer(...a); };
export const useId = function useId(...a: any[])                     { return r().useId(...a); };
export const useImperativeHandle = function useImperativeHandle(...a: any[])  { return r().useImperativeHandle(...a); };
export const useSyncExternalStore = function useSyncExternalStore(...a: any[]) { return r().useSyncExternalStore(...a); };
export const useTransition = function useTransition(...a: any[])     { return r().useTransition(...a); };
export const useDeferredValue = function useDeferredValue(...a: any[]) { return r().useDeferredValue(...a); };

// ── Element helpers (also call-time, same logic) ────────────────────────────

export const createElement = function createElement(...a: any[]) { return r().createElement(...a); };
export const cloneElement  = function cloneElement(...a: any[])  { return r().cloneElement(...a); };
export const isValidElement = function isValidElement(...a: any[]) { return r().isValidElement(...a); };
export const memo = function memo(...a: any[])                 { return r().memo(...a); };
export const forwardRef = function forwardRef(...a: any[])     { return r().forwardRef(...a); };
export const lazy = function lazy(...a: any[])                 { return r().lazy(...a); };
export const createContext = function createContext(...a: any[]) { return r().createContext(...a); };
export const startTransition = function startTransition(...a: any[]) { return r().startTransition(...a); };

// ── Values that must be the actual React reference (not a wrapper) ─────────
// Fragment is the well-known Symbol — use it directly so identity checks
// inside React.createElement work. Suspense and Children are used as
// JSX element types / namespaces; they are real components/objects so a
// Proxy works fine.

export const Fragment: any = Symbol.for('react.fragment');

function lazyProp(name: string): any {
  return new Proxy(function () {}, {
    get(_t, prop)        { return (r()[name] as any)[prop]; },
    apply(_t, _self, a)  { return (r()[name] as any)(...a); },
    construct(_t, a)     { return new (r()[name] as any)(...a); },
    has(_t, prop)        { return prop in (r()[name] as any); },
    ownKeys(_t)          { return Reflect.ownKeys(r()[name] as any); },
    getOwnPropertyDescriptor(_t, prop) { return Object.getOwnPropertyDescriptor(r()[name] as any, prop); },
  });
}

export const Suspense = lazyProp('Suspense');
export const Children = lazyProp('Children');
