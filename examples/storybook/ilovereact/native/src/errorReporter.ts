/**
 * errorReporter.ts
 *
 * Structured error reporting that sends errors to the Lua overlay
 * via __hostReportError and also logs to console.
 *
 * Usage:
 *   import { reportError } from './errorReporter';
 *   try { ... } catch (e) { reportError(e, 'event dispatch (click)'); }
 */

declare const globalThis: {
  __hostReportError?: (errorObj: object) => void;
  [key: string]: any;
};

/**
 * Report an error to the Lua error overlay and terminal.
 *
 * @param error - The caught error (Error object, string, or anything)
 * @param context - Human-readable description of what was happening (e.g. "event dispatch (click)")
 */
export function reportError(error: any, context: string): void {
  const msg = error?.message ?? String(error);
  const stack = error?.stack ?? '';
  const name = error?.name ?? 'Error';

  // Report to Lua overlay via host function
  try {
    if (typeof globalThis.__hostReportError === 'function') {
      globalThis.__hostReportError({ name, message: msg, stack, context });
    }
  } catch (_) {
    // Never let error reporting itself throw
  }

  // Also log to console (which goes to terminal via __hostLog)
  try {
    console.log('[react-love] ' + context + ': ' + name + ': ' + msg);
  } catch (_) {
    // console.log itself might not be available in edge cases
  }
}
