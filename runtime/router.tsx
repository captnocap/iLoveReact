/**
 * Router — bridges framework/router.zig (memory history + pattern matcher).
 *
 * The Zig router is the source of truth: it owns the history stack, the
 * current path, and pattern matching. This module exposes it to React via
 * the V8 host fns __routerInit/Push/Replace/Back/Forward/CurrentPath.
 *
 * The Zig side marks the host dirty after navigation; this module also keeps
 * a tiny JS subscription so React routes re-render immediately when a cart
 * calls useNavigate()/Link inside an event handler. In dev mode, the current
 * path is mirrored through __hot_get/__hot_set so hot reload can reinitialize
 * the Zig router at the active route instead of the starting route.
 *
 * Usage:
 *   <Router initialPath="/">
 *     <Route path="/">         {() => <Home />}              </Route>
 *     <Route path="/users/:id">{({ id }) => <User id={id} />}</Route>
 *     <Route fallback>         {() => <NotFound />}          </Route>
 *   </Router>
 *
 *   const { push, replace, back, forward } = useNavigate();
 *   const { path, params } = useRoute();
 *   <Link to="/settings">Settings</Link>
 */

const React = require('react');
import { callHost } from './ffi';

// ── Host bridge ─────────────────────────────────────────────
const DEFAULT_ROUTER_HOT_KEY = 'router:path';
type RouterListener = () => void;
const routerListeners = new Set<RouterListener>();

function subscribeRouter(listener: RouterListener): () => void {
  routerListeners.add(listener);
  return () => {
    routerListeners.delete(listener);
  };
}

function notifyRouterListeners(): void {
  for (const listener of Array.from(routerListeners)) {
    try {
      listener();
    } catch (e: any) {
      console.error('[router] listener error:', e?.message || e);
    }
  }
}

function hostInit(path: string): void {
  callHost('__routerInit', undefined, path);
}

function hostPush(path: string, hotKey: string): void {
  callHost('__routerPush', undefined, normalizePath(path));
  persistCurrentPath(hotKey);
  notifyRouterListeners();
}

function hostReplace(path: string, hotKey: string): void {
  callHost('__routerReplace', undefined, normalizePath(path));
  persistCurrentPath(hotKey);
  notifyRouterListeners();
}

function hostBack(hotKey: string): void {
  callHost('__routerBack', undefined);
  persistCurrentPath(hotKey);
  notifyRouterListeners();
}

function hostForward(hotKey: string): void {
  callHost('__routerForward', undefined);
  persistCurrentPath(hotKey);
  notifyRouterListeners();
}

function hostCurrentPath(): string {
  return callHost<string>('__routerCurrentPath', '/');
}

function normalizePath(path: any, fallback = '/'): string {
  if (typeof path !== 'string' || path.length === 0) return fallback;
  return path.startsWith('/') ? path : `/${path}`;
}

function readHotPath(hotKey: string): string | null {
  const raw = callHost<string | null>('__hot_get', null, hotKey);
  if (raw == null || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' && parsed.length > 0 ? normalizePath(parsed) : null;
  } catch {
    return raw.startsWith('/') ? raw : null;
  }
}

function writeHotPath(hotKey: string, path: string): void {
  if (!hotKey) return;
  callHost('__hot_set', undefined, hotKey, JSON.stringify(normalizePath(path)));
}

function persistCurrentPath(hotKey: string): void {
  writeHotPath(hotKey, hostCurrentPath());
}

// ── Pattern matching (mirrors framework/router.zig:matchRoute) ──────────

export type RouteParams = Record<string, string>;

export interface RouteMatch {
  matched: boolean;
  params: RouteParams;
}

const NO_MATCH: RouteMatch = { matched: false, params: {} };

export function matchRoute(pattern: string, pathname: string): RouteMatch {
  const pat = stripTrailingSlash(pattern);
  const path = stripTrailingSlash(pathname);
  if (pat === path) return { matched: true, params: {} };

  const patSegs = pat.split('/').filter(Boolean);
  const pathSegs = path.split('/').filter(Boolean);

  // Wildcard: pattern ending in '*' eats remaining path segments.
  const wildcard = patSegs[patSegs.length - 1] === '*';
  if (wildcard) {
    if (pathSegs.length < patSegs.length - 1) return NO_MATCH;
  } else {
    if (patSegs.length !== pathSegs.length) return NO_MATCH;
  }

  const params: RouteParams = {};
  for (let i = 0; i < patSegs.length; i++) {
    const ps = patSegs[i];
    if (ps === '*') break;
    const seg = pathSegs[i];
    if (ps.startsWith(':')) {
      params[ps.slice(1)] = decodeSegment(seg);
    } else if (ps !== seg) {
      return NO_MATCH;
    }
  }
  return { matched: true, params };
}

function stripTrailingSlash(s: string): string {
  return s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s;
}

function decodeSegment(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// ── Context ─────────────────────────────────────────────────

interface LocalNav {
  push: (path: string) => void;
  replace: (path: string) => void;
  back: () => void;
  forward: () => void;
}

interface RouterCtx {
  path: string;
  params: RouteParams;
  hotKey: string;
  // Set when this branch was opened by a `local` Router. When present,
  // useNavigate routes through these instead of the process-global host
  // history — so a nested Router can run its own path independent of
  // the main app router. Untouched in the default (host-backed) case.
  localNav?: LocalNav;
}

const RouterContext = React.createContext<RouterCtx>({
  path: '/',
  params: {},
  hotKey: DEFAULT_ROUTER_HOT_KEY,
});

// ── <Router> ────────────────────────────────────────────────

export function Router({
  initialPath = '/',
  hotKey = DEFAULT_ROUTER_HOT_KEY,
  local = false,
  children,
}: {
  initialPath?: string;
  hotKey?: string;
  /** Run an in-memory history independent of the process-global host
   *  router. Required when nesting a Router inside another Router (e.g.
   *  inside a `<Window>`) — without this both routers fight over one
   *  history and clicking a Link in the nested router moves the outer
   *  app too. Local routers don't persist across reloads. */
  local?: boolean;
  children?: any;
}): any {
  const routerHotKey = hotKey || DEFAULT_ROUTER_HOT_KEY;
  const [, forceRender] = React.useState(0);

  // ── Local-history branch ─────────────────────────────────────
  if (local) {
    const stateRef = React.useRef<null | {
      stack: string[];
      cursor: number;  // index into stack
    }>(null);
    if (stateRef.current === null) {
      stateRef.current = { stack: [normalizePath(initialPath)], cursor: 0 };
    }
    const s = stateRef.current;
    const path = s.stack[s.cursor];

    const navigate = (next: string, replace: boolean) => {
      const p = normalizePath(next);
      if (replace) {
        s.stack[s.cursor] = p;
      } else {
        // Drop any forward history then push.
        s.stack = s.stack.slice(0, s.cursor + 1);
        s.stack.push(p);
        s.cursor = s.stack.length - 1;
      }
      forceRender((n: number) => n + 1);
    };
    const localNav: LocalNav = {
      push: (p: string) => navigate(p, false),
      replace: (p: string) => navigate(p, true),
      back: () => {
        if (s.cursor > 0) { s.cursor -= 1; forceRender((n: number) => n + 1); }
      },
      forward: () => {
        if (s.cursor < s.stack.length - 1) { s.cursor += 1; forceRender((n: number) => n + 1); }
      },
    };
    return React.createElement(
      RouterContext.Provider,
      { value: { path, params: {}, hotKey: routerHotKey, localNav } },
      children,
    );
  }

  // ── Host-backed branch (process-global, persisted) ───────────
  const initRef = React.useRef(null);
  if (initRef.current !== routerHotKey) {
    const restoredPath = readHotPath(routerHotKey);
    const path = restoredPath ?? normalizePath(initialPath);
    hostInit(path);
    writeHotPath(routerHotKey, path);
    initRef.current = routerHotKey;
  }
  React.useEffect(() => subscribeRouter(() => forceRender((n: number) => n + 1)), []);

  // Read on every render. currentPath() is O(1), and navigation notifications
  // above make this component re-render when the host history changes.
  const path = hostCurrentPath();
  return React.createElement(
    RouterContext.Provider,
    { value: { path, params: {}, hotKey: routerHotKey } },
    children,
  );
}

// ── <Route> ─────────────────────────────────────────────────
//
// Two forms accepted:
//   <Route path="/x">{() => <X />}</Route>          — render-prop
//   <Route path="/x"><X /></Route>                  — child element

export function Route({
  path,
  fallback,
  children,
}: {
  path?: string;
  fallback?: boolean;
  children?: any;
}): any {
  const ctx = React.useContext(RouterContext);

  if (fallback) {
    // Sibling Routes register their patterns via context; the fallback
    // surfaces only when no preceding sibling matched. To keep this simple
    // and not require a registry, the fallback renders unless ctx.matched
    // was set by a prior <Route>. We use a context bump per render.
    const matched = (ctx as any).__matched;
    if (matched) return null;
    return typeof children === 'function' ? children({}) : children;
  }

  if (!path) return null;
  const m = matchRoute(path, ctx.path);
  if (!m.matched) return null;
  // Mark as matched so a sibling <Route fallback> stays hidden. Mutates the
  // shared ctx object — fine because Provider value is recreated each
  // render (so this state is per-render, not persisted).
  (ctx as any).__matched = true;
  if (typeof children === 'function') return children(m.params);
  // Child mode: don't cloneElement to inject params unless the route
  // actually captured some — m.params is a fresh object every render
  // and cloneElement would write a new `params` prop on every paint,
  // which React diffs as changed and emits an UPDATE every frame.
  // Routes without `:foo` segments hit this hot path, so the default
  // is just `return children`. Render-prop form (children-as-function)
  // remains the way to consume params.
  if (React.isValidElement(children) && Object.keys(m.params).length > 0) {
    return React.cloneElement(children, { params: m.params });
  }
  return children;
}

// ── <Link> ──────────────────────────────────────────────────

export function Link({
  to,
  replace,
  children,
  style,
  ...rest
}: {
  to: string;
  replace?: boolean;
  children?: any;
  style?: any;
  [key: string]: any;
}): any {
  const nav = useNavigate();
  const onPress = () => (replace ? nav.replace(to) : nav.push(to));
  return React.createElement(
    'Pressable',
    { ...rest, style, onPress },
    children,
  );
}

// ── Hooks ───────────────────────────────────────────────────

export function useRoute(): RouterCtx {
  return React.useContext(RouterContext);
}

export function useNavigate(): {
  push: (path: string) => void;
  replace: (path: string) => void;
  back: () => void;
  forward: () => void;
} {
  const ctx = React.useContext(RouterContext);
  // Local Routers carry their own nav functions on the context so
  // navigation stays inside that subtree's history; fall back to the
  // process-global host history for the default top-level Router.
  if (ctx.localNav) return ctx.localNav;
  const hotKey = ctx.hotKey || DEFAULT_ROUTER_HOT_KEY;
  return {
    push: (path: string) => hostPush(path, hotKey),
    replace: (path: string) => hostReplace(path, hotKey),
    back: () => hostBack(hotKey),
    forward: () => hostForward(hotKey),
  };
}
