// tui/host_shims.ts — inert FFI globals for the TUI backend.
//
// runtime/* and renderer/* expect a handful of globals that the GPU host
// (v8_app.zig) injects into V8 at boot. The TUI backend doesn't have a
// GPU host, so hooks that look up these globals would otherwise hit
// undefined and crash. Each shim returns a sensible no-op default.
//
// We deliberately do NOT install __hostFlush — the TUI backend walks
// the reconciler tree directly via getRootInstances() each paint, and
// installs setTransportFlush() in tui/entry.tsx as a no-op that just
// calls requestPaint(). That way, any cart that bundles the renderer
// emits CREATE/UPDATE commands into the void and we still re-paint after
// every commit.
//
// Animations: __anim_register/unregister are made into no-ops; carts
// that use useHostAnimation get a static (no animation) value but don't
// crash.

import { forcePaint } from './host';

declare const globalThis: any;

export function installHostShims(): void {
  // ── stdout-side shims ──────────────────────────────────────────────

  // hostConfig falls back to globalThis.__hostFlush when no transport is
  // installed. We install setTransportFlush in entry.tsx so this is only
  // a safety net in case some path skips the transport register.
  if (typeof globalThis.__hostFlush !== 'function') {
    globalThis.__hostFlush = (_payload: string) => {};
  }

  if (typeof globalThis.__hostLog !== 'function') {
    // Drop into stderr instead of dropping silently — the TUI grabs
    // stdout for paint, but stderr stays available.
    globalThis.__hostLog = (_level: number, msg: string) => {
      try {
        if (typeof globalThis.process?.stderr?.write === 'function') {
          globalThis.process.stderr.write(String(msg) + '\n');
        }
      } catch {}
    };
  }

  // ── input-side shims ──────────────────────────────────────────────

  // Carts call this when reading TextInput values during render. We
  // don't store text on Instances yet (Phase 2), so always return empty.
  if (typeof globalThis.__getInputTextForNode !== 'function') {
    globalThis.__getInputTextForNode = (_id: number): string => '';
  }
  if (typeof globalThis.__getPreparedRightClick !== 'function') {
    globalThis.__getPreparedRightClick = () => ({});
  }
  if (typeof globalThis.__getPreparedScroll !== 'function') {
    globalThis.__getPreparedScroll = () => ({});
  }

  // ── React event-priority sentinels ─────────────────────────────────

  globalThis.__beginJsEvent = globalThis.__beginJsEvent || (() => {});
  globalThis.__endJsEvent   = globalThis.__endJsEvent   || (() => {});

  // ── Animation shims (Phase 2) ──────────────────────────────────────

  // Returning the request id but never firing the callback means
  // useHostAnimation snaps to the target value immediately. Acceptable
  // for Phase 1; carts render but don't tween.
  let animSeq = 1;
  if (typeof globalThis.__anim_register !== 'function') {
    globalThis.__anim_register = (_spec: any) => animSeq++;
  }
  if (typeof globalThis.__anim_unregister !== 'function') {
    globalThis.__anim_unregister = (_id: number) => {};
  }

  // ── Hot-state (cross-reload persistence) — TUI sessions are cheap to
  //    re-launch; we just store in-memory. ScrollView's __hot_get for
  //    initial scrollY then resolves to 0 on first run, persists during
  //    the session.

  const hot = new Map<string, string>();
  if (typeof globalThis.__hot_get !== 'function') {
    globalThis.__hot_get = (k: string): string | null => hot.get(k) ?? null;
  }
  if (typeof globalThis.__hot_set !== 'function') {
    globalThis.__hot_set = (k: string, v: string): void => { hot.set(k, String(v)); };
  }
  if (typeof globalThis.__hot_remove !== 'function') {
    globalThis.__hot_remove = (k: string): void => { hot.delete(k); };
  }
  if (typeof globalThis.__hot_clear !== 'function') {
    globalThis.__hot_clear = (): void => { hot.clear(); };
  }
  if (typeof globalThis.__hot_keys_json !== 'function') {
    globalThis.__hot_keys_json = (): string => JSON.stringify([...hot.keys()]);
  }

  // ── Router (in-memory history) ─────────────────────────────────
  //
  // runtime/router.tsx delegates path state to host functions: init /
  // push / replace / back / forward / currentPath. The GPU host owns
  // these from Zig. Here we keep a simple JS-side history stack —
  // enough for full forward/back navigation through <Link> clicks.
  //
  // History: an array of paths + an index pointing at the current
  // entry. push trims forward history (canonical browser semantics).

  const history: string[] = ['/'];
  let cursor = 0;

  if (typeof globalThis.__routerInit !== 'function') {
    globalThis.__routerInit = (path: string): void => {
      const norm = (typeof path === 'string' && path.startsWith('/')) ? path : '/';
      // Only init if we haven't already mounted a non-default path.
      if (history.length === 1 && history[0] === '/') {
        history[0] = norm;
        cursor = 0;
      }
    };
  }
  if (typeof globalThis.__routerCurrentPath !== 'function') {
    globalThis.__routerCurrentPath = (): string => history[cursor] ?? '/';
  }
  if (typeof globalThis.__routerPush !== 'function') {
    globalThis.__routerPush = (path: string): void => {
      const norm = (typeof path === 'string' && path.startsWith('/')) ? path : '/';
      if (norm === history[cursor]) return;
      history.length = cursor + 1;
      history.push(norm);
      cursor = history.length - 1;
      // Discard the prev-frame buffer so cells the new route doesn't
      // cover get cleared instead of bleeding through visually.
      forcePaint();
    };
  }
  if (typeof globalThis.__routerReplace !== 'function') {
    globalThis.__routerReplace = (path: string): void => {
      const norm = (typeof path === 'string' && path.startsWith('/')) ? path : '/';
      history[cursor] = norm;
      forcePaint();
    };
  }
  if (typeof globalThis.__routerBack !== 'function') {
    globalThis.__routerBack = (): void => {
      if (cursor > 0) { cursor--; forcePaint(); }
    };
  }
  if (typeof globalThis.__routerForward !== 'function') {
    globalThis.__routerForward = (): void => {
      if (cursor < history.length - 1) { cursor++; forcePaint(); }
    };
  }
}
