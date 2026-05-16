// =============================================================================
// AMBIENT PRIMITIVES — Phase 1 type declarations
// =============================================================================
// Globally exposes every identifier re-exported from framework/ambient.ts so
// TypeScript resolves free references (e.g. `<Box>`, `useState(0)`) without
// requiring an explicit import at the top of every .tsx file.
//
// Kept in sync with framework/ambient.ts. Each global's type is sourced via
// `typeof import('./ambient').X` so the shape follows whatever the runtime
// exports actually resolve to — no duplication of primitive or hook
// signatures here.
// =============================================================================

export {};

declare global {
  // ── React core + hooks ────────────────────────────────────────────────────
  const createElement:       typeof import('./ambient').createElement;
  const cloneElement:        typeof import('./ambient').cloneElement;
  const isValidElement:      typeof import('./ambient').isValidElement;
  const Fragment:            typeof import('./ambient').Fragment;

  const useState:            typeof import('./ambient').useState;
  const useEffect:           typeof import('./ambient').useEffect;
  const useLayoutEffect:     typeof import('./ambient').useLayoutEffect;
  const useCallback:         typeof import('./ambient').useCallback;
  const useMemo:             typeof import('./ambient').useMemo;
  const useRef:              typeof import('./ambient').useRef;
  const useContext:          typeof import('./ambient').useContext;
  const useReducer:          typeof import('./ambient').useReducer;
  const useId:               typeof import('./ambient').useId;
  const useImperativeHandle: typeof import('./ambient').useImperativeHandle;
  const useSyncExternalStore:typeof import('./ambient').useSyncExternalStore;
  const useTransition:       typeof import('./ambient').useTransition;
  const useDeferredValue:    typeof import('./ambient').useDeferredValue;

  const createContext:       typeof import('./ambient').createContext;
  const memo:                typeof import('./ambient').memo;
  const forwardRef:          typeof import('./ambient').forwardRef;

  // ── Runtime primitives ────────────────────────────────────────────────────
  const Box:         typeof import('./ambient').Box;
  const Row:         typeof import('./ambient').Row;
  const Col:         typeof import('./ambient').Col;
  const Text:        typeof import('./ambient').Text;
  const Image:       typeof import('./ambient').Image;
  const Pressable:   typeof import('./ambient').Pressable;
  const ScrollView:  typeof import('./ambient').ScrollView;
  const TextInput:   typeof import('./ambient').TextInput;
  const TextArea:    typeof import('./ambient').TextArea;
  const TextEditor:  typeof import('./ambient').TextEditor;
  const Terminal:    typeof import('./ambient').Terminal;
  const terminal:    typeof import('./ambient').terminal;
  const StaticSurface: typeof import('./ambient').StaticSurface;
  const Canvas:      typeof import('./ambient').Canvas;
  const Graph:       typeof import('./ambient').Graph;
  const Render:      typeof import('./ambient').Render;
  const Effect:      typeof import('./ambient').Effect;
  const Native:      typeof import('./ambient').Native;
}
