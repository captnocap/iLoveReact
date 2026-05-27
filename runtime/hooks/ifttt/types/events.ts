/**
 * events — augmentable map of literal-string IFTTT triggers → payload.
 *
 * Each owning module adds its emitted channels here via module
 * augmentation:
 *
 *   declare module '@reactjit/runtime/hooks/ifttt/types/events' {
 *     interface IFTTTEventMap {
 *       'my:channel': { foo: number };
 *     }
 *   }
 *
 * `PayloadOf<T>` (in ./triggers.ts) looks here first, then falls back
 * to template-literal pattern matching for prefix families like
 * `key:*`, `timer:every:${number}`, etc. Add a fixed-name channel
 * here; for prefix families with parameter suffixes, extend
 * `PayloadOf` in triggers.ts.
 */

/* eslint-disable @typescript-eslint/consistent-type-definitions */

// Shapes the built-in sources emit. Owning modules re-import and
// augment with their own channels; these stay in one place so the
// core surface is browsable.

export type SystemFocusPayload = { at: number };
export type SystemBlurPayload = { at: number };
export type SystemDropPayload = string;
export type SystemCursorPayload = { x: number; y: number; dx: number; dy: number };
export type SystemSlowFramePayload = { ms: number };
export type SystemHangPayload = { count: number };
export type SystemMemPayload = { used: number; total: number; percent: number };
export type SystemResizePayload = { w: number; h: number };
export type SystemClipboardPayload = string;
export type SystemSelectionPayload = {
  text: string;
  textLen: number;
  downX: number;
  downY: number;
  upX: number;
  upY: number;
  screenW: number;
  screenH: number;
  at: number;
};
export type SystemErrorPayload = {
  message: string;
  stack?: string;
  args: unknown[];
  at: number;
};

/** Generic shape of a Claude Code hook entry. Carts pipe these in via
 *  `dispatchClaudeEvent()`; the IFTTT side fans them out. */
export type ClaudeEvent = {
  tool?: string;
  phase?: string;
  [k: string]: unknown;
};

export interface IFTTTEventMap {
  /* Built-in core triggers — see useIFTTT.ts */
  'mount':                       { at: number };
  'click':                       unknown;
  'system:focus':                SystemFocusPayload;
  'system:blur':                 SystemBlurPayload;
  'system:fileDropped':          SystemDropPayload;
  'system:cursor:move':          SystemCursorPayload;
  'system:slowFrame':            SystemSlowFramePayload;
  'system:hang':                 SystemHangPayload;
  'system:ram':                  SystemMemPayload;
  'system:vram':                 SystemMemPayload;
  'system:resize':               SystemResizePayload;
  'system:clipboard':            SystemClipboardPayload;
  'system:selection':            SystemSelectionPayload;
  'system:selection:cleared':    { at: number };
  'system:error':                SystemErrorPayload;
  'system:claude':               ClaudeEvent;
}
