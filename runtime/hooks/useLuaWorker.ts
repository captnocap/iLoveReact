// useLuaWorker — typed wrapper around the LuaJIT off-thread worker.
//
// The worker (framework/process/luajit_worker.zig) is force-compiled into
// every cart but only does anything once `start()` runs. Two communication
// channels:
//
//   • Message queues — `sendMsg` / `recvMsg`: 512-byte ring slots, 1024
//     deep each direction. Lua reads via `host_recv_msg()` and writes via
//     `host_send_msg(str)`.
//   • Atomic counters — `send(count)` / `recvCount()`: zero-copy "I pushed
//     N units of work" / "N have been acked" pair, for tight benchmark
//     loops where parsing strings would dominate.
//
// Loading the hook into a cart bundle does two things:
//   1) tells dep-registry to bundle libluajit-5.1.so next to the binary
//      (without it, `start()` returns -1 because dlopen finds nothing).
//   2) makes the typed API discoverable to TS consumers; the underlying
//      host fns are already registered on every cart.
//
// This is NOT a React hook — no useEffect, no useState. It's a plain
// module that returns a small object you call imperatively. Cart code
// owns lifetimes (start on mount, stop on unmount).
//
// @example
//   import { luaWorker } from '@reactjit/hooks/useLuaWorker';
//   useEffect(() => {
//     if (!luaWorker.available()) return;
//     luaWorker.eval(`
//       while host_running() do
//         local m = host_recv_msg()
//         if m then host_send_msg('pong:' .. m) end
//       end
//     `);
//     luaWorker.start();
//     return () => luaWorker.stop();
//   }, []);

declare function __lua_available(): number;
declare function __lua_start(): number;
declare function __lua_stop(): number;
declare function __lua_eval(code: string): number;
declare function __lua_send_msg(msg: string): number;
declare function __lua_recv_msg(): string;
declare function __lua_elapsed_us(): number;
declare function __lua_send(count: number): number;
declare function __lua_recv_count(): number;
declare function __lua_set_n(n: number): number;

export const luaWorker = {
  /** True if libluajit-5.1 is loadable on this system. */
  available(): boolean {
    return __lua_available() === 1;
  },
  /** Returns 1=started, 0=already running, -1=libluajit missing. */
  start(): number {
    return __lua_start();
  },
  stop(): number {
    return __lua_stop();
  },
  /**
   * Replace the worker script. Effective on the NEXT `start()` —
   * a running worker keeps executing the script it was started with.
   */
  eval(code: string): number {
    return __lua_eval(code);
  },
  /** Push a message onto the worker's inbox. Returns bytes pushed, 0 if full. */
  sendMsg(msg: string): number {
    return __lua_send_msg(msg);
  },
  /** Pop a message from the worker's outbox. Empty string if none. */
  recvMsg(): string {
    return __lua_recv_msg();
  },
  /** Last counter-mode send→ack roundtrip in microseconds. */
  elapsedUs(): number {
    return __lua_elapsed_us();
  },
  /** Counter mode: enqueue N units (0 = use bridge_n default). */
  send(count = 0): number {
    return __lua_send(count);
  },
  /** Counter mode: total units acked. */
  recvCount(): number {
    return __lua_recv_count();
  },
  /** Counter mode: set bridge_n (work unit batch size). */
  setN(n: number): number {
    return __lua_set_n(n);
  },
};

export default luaWorker;
