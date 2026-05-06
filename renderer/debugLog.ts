// Reconciler / cart debug log. Routes through the event bus so entries
// land in devshell's Logs pane (and cart/eventlog/) alongside everything
// else. Default importance 0.15 (debug-tier) — so per-commit / per-
// frame call sites don't flood at the default `info` threshold.
//
//   debugLog.log('recon', 'flushed N commands')      // 0.15, opt-in via `l → debug`
//   debugLog.info('cart', 'user clicked button')     // 0.30, visible at default
//
// Tolerates a missing host: in tests / standalone runs (no v8cli host
// fns) the calls become silent no-ops instead of throwing.

declare const __busEmitWithImportance:
  | ((type: string, source: string, imp: number, payload: string) => number)
  | undefined;

function emit(channel: string, msg: string, imp: number): void {
  if (typeof __busEmitWithImportance !== 'function') return;
  let payload = '{}';
  try { payload = JSON.stringify({ msg }); } catch {}
  __busEmitWithImportance(`debug.${channel}`, 'renderer/debugLog', imp, payload);
}

export const debugLog = {
  /** Default tier — debug (0.15). Hidden until devshell `l` cycles to
   *  trace or debug. Use for per-frame / per-commit chatter. */
  log(channel: string, msg: string): void { emit(channel, msg, 0.15); },

  /** Info tier (0.30). Visible at the default devshell threshold. Use
   *  for cart-level events the user wants surfaced without flipping
   *  the level. */
  info(channel: string, msg: string): void { emit(channel, msg, 0.30); },

  /** Warn tier (0.70). Always visible unless threshold is set above
   *  warn. Use for unexpected-but-recoverable conditions. */
  warn(channel: string, msg: string): void { emit(channel, msg, 0.70); },
};
