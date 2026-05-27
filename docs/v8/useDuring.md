# `useDuring` (V8 Runtime)

`useDuring` runs `body` for the lifetime of `x`. Where [`useIFTTT`](./useIFTTT.md) is **edges**, `useDuring` is **levels** — they're the two halves of the same temporal primitive family.

```ts
useDuring(x, body)
```

Implementation: `runtime/hooks/useDuring.ts`.

## Signature

```ts
function useDuring(x: DuringLifetime, body: DuringBody): UseDuringHandle;

type DuringLifetime =
  | undefined
  | number
  | Promise<unknown>
  | AbortSignal
  | AsyncIterable<unknown>
  | UseDuringHandle
  | (() => unknown);

type DuringBody =
  | ((signal: AbortSignal) => void | (() => void))
  | ((signal: AbortSignal) => Promise<void | (() => void)>)
  | (() => void | (() => void))
  | (() => Promise<void | (() => void)>);

interface UseDuringHandle {
  readonly active: boolean;             // window currently open?
  readonly startedAt: number;           // performance.now() at last open
  readonly done: Promise<void>;         // perpetually-pending; resolves on next close
  cancel(): void;
}
```

`body` receives an `AbortSignal` so async bodies can bail when the window closes externally (cancel / unmount / shape-arm fires). If `body` returns a function, that fn runs as cleanup on close.

## Dispatch table

`useDuring` classifies `x` at effect setup and dispatches on shape:

| `x` | Window opens | Window closes |
|---|---|---|
| `undefined` | on mount | on unmount |
| `number` (ms) | immediately | after `ms` |
| `Promise` | immediately | when the promise settles |
| `AbortSignal` | immediately (if not already aborted) | on `'abort'` event |
| `AsyncIterable` | immediately | when iterator returns `done: true` |
| `UseDuringHandle` | immediately | when the other handle's `.done` resolves |
| `() => Promise<...>` | immediately | when the returned promise settles |
| `() => anything else` | momentarily | immediately (instant window) |

## Examples

```ts
// Mount cycle
useDuring(undefined, () => console.log('alive'));

// Timer
useDuring(5_000, () => setRagdoll(true));

// Promise span — show spinner while fetching
useDuring(fetchPromise, () => showSpinner());

// AbortSignal — react to upstream cancellation
useDuring(abortController.signal, () => keepConnected());

// AsyncIterable — long-poll consumption
useDuring(eventStream, () => banner('streaming'));

// Nested — borrow another handle's window
const outer = useDuring(fetchA, () => spinner('A'));
useDuring(outer, () => analytics('a-in-flight'));

// Thunk — async function spans its execution
useDuring(() => fetch('/api/sync'), (signal) => {
  const beat = setInterval(() => heartbeat({ signal }), 1000);
  return () => clearInterval(beat);
});
```

## Co-design with `useIFTTT`

The third reactive surface on an `IFTTTResult` — `flow.action` — is shaped exactly like `UseDuringHandle` (`active`, `startedAt`, `done`, `cancel`). It plugs directly into `useDuring` with no wrapper:

```ts
const save = useIFTTT('key:ctrl+s', async () => saveDocument());

useDuring(save.action, (signal) => {
  return showSpinner({ signal });           // body's signal fires on close
});

useIFTTT(save.completed, 'notification:send:saved');
```

That's the canonical "edge / level / completion edge" trio:
- `save` — edge: the trigger matched.
- `save.action` — level: the save action is in flight.
- `save.completed` — edge: the save action settled.

The caller picks the temporal semantic by which surface they reference. See [`useIFTTT.md`](./useIFTTT.md#the-three-reactive-surfaces) for the full story.

## What v2 dropped

If you remember an earlier version of `useDuring`:

- **`boolean` is no longer accepted** as `x`. Render-polled "during truthy" was a foot-gun (the semantic gap between `useDuring(isPaused, …)` and `useDuring(() => isPaused, …)` was too subtle). For boolean conditions, use `useEffect` keyed on the boolean — that's idiomatic React. For reactive booleans that change outside render, build a proper signal or `useIFTTT(() => isPaused, …)`.
- **Polled-thunk-boolean is gone.** A function returning `boolean` used to flip on a 50ms interval. Now functions are uniformly "call once, treat the return value as `x`." The returned boolean is discarded (instant window).
- **`startedAt` is `performance.now()`**, not `Date.now()`. Monotonic clock; use for "how long has this been open" math.

## Gotchas

**Stable `x`.** Every render re-evaluates `useDuring(EXPR, …)`. The hook keys its dispatch effect on a *shape key* (`'mount'` / `'num:5000'` / WeakMap-id / `'fn'`), not on `x`'s identity — so an inline thunk that changes identity every render does **not** restart the window. But for raw Promises/Signals/Iterables, two strategies:
- thunk form: `useDuring(() => fetch('/x'), …)` — called once per shape change inside the hook.
- stable ref: `const p = useMemo(() => fetch('/x'), [k]); useDuring(p, …)`.

**Async body cleanup race.** If body returns `Promise<() => void>` and the window closes before that promise resolves, the returned cleanup fn runs immediately (not stashed for a window that no longer exists). No leaks.

**AsyncIterable termination.** The hook holds the iterator manually and calls `iterator.return()` from cleanup — so long-polls (e.g. `for await (const msg of stream)`) actually terminate when you cancel, instead of waiting for the next yield.

**`cancel()` and underlying work.** `handle.cancel()` closes the level immediately, fires the body's `AbortSignal`, and resolves `done`. If body was an async operation that hadn't checked the signal, its underlying work keeps running invisibly until it settles on its own — `useDuring`'s reactive surface just stops observing it. Bodies that want true cancellation should respect the signal.

**`done` is always pending.** `await handle.done` before any window opens still blocks until the next close. The promise is atomically swapped to a fresh pending on each close, so multiple awaiters across the component lifetime all work correctly.

## File map

- Hook implementation: `runtime/hooks/useDuring.ts`
- Co-design partner: `runtime/hooks/useIFTTT.ts` (`flow.action` is a `UseDuringHandle`)
- Type re-exports: `runtime/hooks/index.ts` — `useDuring`, `DuringBody`, `DuringLifetime`, `UseDuringHandle`
