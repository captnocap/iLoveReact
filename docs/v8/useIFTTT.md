# `useIFTTT` (V8 Runtime)

`useIFTTT` is the cart-side automation hook:

```ts
useIFTTT(trigger, action)
```

One trigger to one action, fully typed, fire metadata tracked for UI/debugging, and uses the shared `runtime/ffi.ts` listener registry as its bus. Most runtime events are plain bus events; Zig-origin system signals enter JS through `globalThis.__ifttt_*` handlers and are immediately re-emitted onto that same bus.

This is not the generated `framework/ifttt.zig` rule engine. That Zig module is a compile-time fast path for framework-side rules. The V8 cart API documented here lives in `runtime/hooks/useIFTTT.ts`.

> **What changed in v2 (this doc):** the result handle now exposes **three reactive surfaces** (`flow` itself, `flow.action`, `flow.completed`); the trigger union accepts another `flow` directly; the type surface is generic with `PayloadOf<S>` doing the trigger→payload lookup; action runners may return Promises (with proper in-flight tracking + a non-leaking `cancel()`); and the file layout moved every `runtime/hooks/ifttt-*.ts` under `runtime/hooks/ifttt/`. See the **Three Reactive Surfaces**, **Reactive Chaining**, **Type System**, and **Co-design with `useDuring`** sections.

## Public API

Import from either the hook file or the hooks barrel:

```ts
import {
  useIFTTT,
  useDuring,
  busOn,
  busEmit,
  getSharedState,
  setSharedState,
  dispatchClaudeEvent,
  registerIfttSource,
  registerIfttAction,
} from '@reactjit/runtime/hooks';
```

Hook signature (four overloads):

```ts
// 1) Literal string trigger — payload inferred from PayloadOf<S>
function useIFTTT<S extends TriggerString>(
  trigger: S,
  action: ActionString | ((event: PayloadOf<S>) => void | Promise<void>),
): IFTTTResult<PayloadOf<S>>;

// 2) Function trigger — false → true edge, no payload
function useIFTTT(
  trigger: () => boolean,
  action: ActionString | (() => void | Promise<void>),
): IFTTTResult<undefined>;

// 3) Reactive trigger — another IFTTTResult, `flow.completed`, or anything
//    exposing `subscribe(fn)`. Edges on fn invocation.
function useIFTTT<P>(
  trigger: ReactiveEdgeSource<P>,
  action: ActionString | ((event: P) => void | Promise<void>),
): IFTTTResult<P>;

// 4) Composable trigger — payload generic, defaults to unknown.
function useIFTTT<P = unknown>(
  trigger: Exclude<ComposableTrigger<P>, string | (() => boolean) | ReactiveEdgeSource<P>>,
  action: ActionString | ((event: P) => void | Promise<void>),
): IFTTTResult<P>;
```

The result handle:

```ts
interface IFTTTResult<P = unknown> extends ReactiveEdgeSource<P> {
  readonly fired: number;          // counter (Zig-tracked, read on demand)
  readonly lastEvent: P | undefined;
  readonly lastFiredAt: number;    // epoch ms
  fire(event?: P): void;           // imperative escape hatch
  subscribe(fn: (event: P) => void): () => void;   // trigger edges

  readonly action: ReactiveLevelSource;            // level: action in flight
  readonly completed: ReactiveEdgeSource<P>;       // edge: action settled
}
```

`fire(event?)` is an imperative escape hatch — runs the same action path as a real trigger fire and updates the counters.

Helpers:

```ts
function busOn(event: string, fn: (payload?: any) => void): () => void;
function busEmit(event: string, payload?: any): void;

function getSharedState(key: string): any;
function setSharedState(key: string, value: any): void;

function dispatchClaudeEvent(input: string | object): void;
```

Registry surface:

```ts
type IfttSubscription = {
  subscribe(onFire: (payload?: any) => void): () => void;
};

type IfttSource = {
  match(spec: string): IfttSubscription | null;
};

type IfttActionRunner = (rest: string, payload: any) => void | Promise<void>;

type IfttDispatchResult = { handled: boolean; ret: void | Promise<void> };

function registerIfttSource(prefix: string, src: IfttSource): void;
function registerIfttAction(prefix: string, run: IfttActionRunner): void;
function setIfttFallback(src: IfttSource): void;
function resolveTrigger(spec: string): IfttSubscription | null;
function dispatchAction(action: string, payload: any): IfttDispatchResult;
function listIfttSources(): string[];
function listIfttActions(): string[];
```

Registry prefix matching is **longest-prefix wins, by string length — not registration order**. Exact matches always work; prefix matches require a trailing `:` boundary, so `state:set:` beats `state:`. Order of `registerIfttSource(...)` calls is irrelevant. The check lives in `resolveTrigger` / `dispatchAction` at `runtime/hooks/ifttt/registry.ts`.

## The Three Reactive Surfaces

The returned `flow` object is **three reactive instances in one handle**. The caller picks the temporal semantics by which surface they reference. There is no "default" event — the right semantic depends on what you're doing.

```ts
const flow = useIFTTT('http:webhook:/inbox', 'fs:writefile:/tmp/last.json');

useDuring(flow.action, () => showToast('saving…'));         // level: while in flight
useIFTTT(flow.completed, 'notification:send:saved');        // edge: action settled
useIFTTT(flow, 'log:webhook arrived');                       // edge: trigger fired
```

| Surface | Kind | Fires when |
|---|---|---|
| `flow` itself | edge | The trigger matched. `flow.subscribe(fn)` listeners fire here, **before** the action runs. |
| `flow.action` | level | An action invocation is in flight. Open between trigger fire and action settle for async actions; never visibly opens for sync. Shape is `ReactiveLevelSource` — drop straight into `useDuring(flow.action, body)` with no wrapper. |
| `flow.completed` | edge | An action settled. Sync actions fire `completed` on the same tick as the trigger edge; async actions fire it on Promise resolve **or** reject. Carries the original trigger payload. |

### Fire order (the contract)

When the trigger matches:

1. `flow.subscribe` listeners fire (trigger edge, synchronous).
2. The Zig wire counter bumps; `fired` / `lastFiredAt` reads see the new values.
3. The action runs.
4. If the action returned a `Promise`:
   - `flow.action` opens (`active === true`, `startedAt === performance.now()`, `done` is a fresh pending promise).
   - On settle (resolve or reject): `flow.action` closes, `done` resolves, **then** `flow.completed` listeners fire.
5. If the action returned anything else (or threw): `flow.completed` listeners fire immediately.

Errors are logged but do not suppress `completed` — chains never silently stall.

### `flow.action` — level source

```ts
interface ReactiveLevelSource {
  readonly active: boolean;             // pendingCount > 0
  readonly startedAt: number;           // performance.now() at last 0 → 1+
  readonly done: Promise<void>;         // perpetually-pending; resolves on close
  cancel(): void;
}
```

`active` and `startedAt` are getters. The first read flips a sticky "subscribed" flag on the host — thereafter the host re-renders on every transition.

`done` is **always a pending Promise**. On each close it resolves, then is atomically swapped to a fresh pending one. So `await flow.action.done` captured **before any window opened** still blocks until the next close, not instantly. Consumers using `useEffect([flow.action.done], …)` re-fire on each rotation because the forceTick from open/close triggers a re-render with the new identity.

`cancel()` force-closes every in-flight slot, resolves the current `done`, and bumps an internal **generation token**. Stale settles of cancelled action Promises become ghosts — no double `completed`, no negative `pendingCount` drift. The underlying Promises still run their work; this only unsubscribes the reactive surface from observing them.

### `flow.completed` — edge source

```ts
flow.completed.subscribe((event) => { /* … */ });
```

Standard `ReactiveEdgeSource<P>` shape — same as `flow` itself. Useful as a trigger for the next `useIFTTT` in a chain:

```ts
useIFTTT(flow.completed, 'notification:send:saved');
useIFTTT(flow.completed, (e) => analytics('webhook-saved', e));
```

Even for typo'd actions (`'state:tggle:foo'` — no registered prefix), `completed` still fires once per trigger. A `console.warn` flags the typo in dev; chains never silently stall. Catch typos at compile time by using `ActionString` (see **Type System**).

## Built-In Triggers

String triggers:

| Trigger | Payload | Source |
|---|---|---|
| `mount` | `{ at }` | Fires on next microtask after subscribe (so `flow.subscribe(fn)` registered after the hook returns still sees the edge). |
| `key:<key>` | `KeyPayload` | SDL keydown via `__ifttt_onKeyDown`. |
| `key:up:<key>` | `KeyPayload` | SDL keyup via `__ifttt_onKeyUp`. |
| `key:ctrl+s`, `key:meta+a`, etc. | `KeyPayload` | Modifier chain — `ctrl/control`, `shift`, `alt/option`, `meta/cmd/command`. |
| `timer:every:<ms>` | `{ at, interval }` | Zig-side timer wheel; falls back to JS `setInterval` if the binding isn't installed. Minimum interval clamped to `1`. |
| `timer:once:<ms>` | `{ at, delay }` | Same wheel; falls back to JS `setTimeout`. |
| `state:<key>:<value>` | matched value | In-memory shared-state map. Values coerced from string to `true`, `false`, `null`, number, or string. |
| `<event>` | event payload | Raw bus fallback. Pairs with `busEmit(event, payload)` or `send:<event>`. |
| `click` | TBD | Registered but no V8 producer emits `__click`. Prefer explicit `Pressable` handlers or `busEmit` until that producer is wired. |

System triggers — raw bus events produced by Zig/V8 handlers:

| Trigger | Payload | Producer |
|---|---|---|
| `system:clipboard` | clipboard text | `framework/clipboard_watch.zig` polls SDL clipboard every 250ms; JS reads `__clipboard_get()`. Handler is **self-registered in `runtime/hooks/clipboard.ts`** (no longer wired by `useIFTTT.ts`). |
| `system:focus` | `{ at }` | SDL focus gained. |
| `system:blur` | `{ at }` | SDL focus lost. |
| `system:fileDropped` | path string | SDL drop file. Zig stashes path; JS pulls with `__sys_drop_path()`. |
| `system:cursor:move` | `{ x, y, dx, dy }` | `SDL_GetGlobalMouseState`, ~60Hz max, only on movement. |
| `system:slowFrame` | `{ ms }` | Post-paint frame duration over 32ms. |
| `system:hang` | `{ count }` | 3 consecutive slow frames; recovery emits `{ count: 0 }`. |
| `system:ram` | `{ used, total, percent }` | `/proc/meminfo`, 1Hz, only on changed sample. |
| `system:vram` | `{ used, total, percent }` | `/sys/class/drm/cardN/device/mem_info_vram_*`, 1Hz. |
| `system:resize` | `{ w, h }` | Window pixel-size changes, tier-gated to sm/md/lg/xl crossings. |
| `system:claude` | normalized hook entry | `dispatchClaudeEvent`. |
| `system:claude:<tool>` | normalized hook entry | Lowercased `entry.tool`. |
| `system:claude:<phase>` | normalized hook entry | Lowercased `entry.phase`. |
| `system:selection` | full selection event | OS text selection via `__ifttt_onSystemSelection`. |
| `system:selection:cleared` | `{ at }` | Selection cleared. |
| `system:permission` | `PermissionEvent` | Claude Code permission prompt (terminal scrape — see `ifttt/permission.ts`). |
| `system:permission:dismissed` | `{ at }` | Permission prompt answered/closed. |

Function triggers:

```ts
useIFTTT(() => score > 100, 'send:victory');
```

Plain function triggers are **RAF-polled** — re-evaluated on every animation frame, fires on a false→true edge. Keep them pure and cheap. The predicate is read through a ref (`triggerRef.current`), so changing the function identity between renders does NOT restart the poll loop. Function leaves inside composable triggers are different: the composer polls them every 50ms via `setInterval`.

## Built-In Actions

| Action | Behavior |
|---|---|
| `state:set:<key>:<val>` | Coerces `<val>` and writes the shared-state map. |
| `state:toggle:<key>` | Writes `!getSharedState(key)`. |
| `send:<event>` | Emits the trigger payload to the named bus event. |
| `log:<message>` | `console.log('[ifttt]', message, payload ?? '')`. |
| `clipboard:<text>` | Writes text through `runtime/hooks/clipboard.ts` (**self-registered**). |
| function action | Called with the typed trigger payload. May return `Promise<void>` for tracked in-flight semantics. |

String actions pass through substitution before dispatch:

```ts
useIFTTT('proc:idle:123:5000', 'proc:kill:$pid');
useIFTTT('system:fileDropped', 'log:dropped $payload');
useIFTTT('custom:event', 'log:path $payload.path');
```

Supported substitutions:

- `$payload` → `JSON.stringify(payload)`
- `$payload.path.to.field` → nested field string
- `$id` → `payload.id ?? payload.pid ?? ''`
- `$pid` → `payload.pid ?? payload.id ?? ''`

### Async actions (Promise-returning)

Function actions may return `Promise<void>` to enable in-flight tracking via `flow.action`:

```ts
const flow = useIFTTT('key:ctrl+s', async (ev) => {
  await saveDocument(ev.key);
});

useDuring(flow.action, () => showSpinner());          // spins for the save duration
useIFTTT(flow.completed, 'notification:send:saved');  // confirms after save resolves
```

Registered string-action runners (those installed via `registerIfttAction`) follow the same contract — return `Promise<void>` and `flow.action` opens for the run.

## Composable Triggers

Composable shapes live in `runtime/hooks/ifttt/compose.ts`.

```ts
type IFTTTReactiveLeaf = { subscribe(fn: (event: unknown) => void): () => void };
type IFTTTLeaf = string | (() => boolean) | IFTTTReactiveLeaf;

type IFTTTComposable =
  | IFTTTLeaf
  | { on: IFTTTComposable | IFTTTComposable[]; when?: () => boolean }
  | { all: IFTTTComposable[] }
  | { any: IFTTTComposable[] }
  | { seq: IFTTTComposable[]; within: number }
  | {
      trigger: IFTTTComposable;
      debounce?: number;
      throttle?: number;
      once?: boolean;
      cooldown?: number;
    };
```

Examples:

```ts
useIFTTT(
  { on: 'key:ctrl+s', when: () => isDirty },
  'send:save',
);

useIFTTT(
  {
    trigger: {
      all: [
        `proc:ram:${pid}:>:800MB`,
        () => processState === 'running',
      ],
    },
    cooldown: 10_000,
  },
  'proc:kill:$pid',
);

useIFTTT(
  { seq: ['key:up:up', 'key:up:up', 'key:down', 'key:down'], within: 2000 },
  'send:cheat',
);

// Reactive leaves — another useIFTTT result composed in
const save = useIFTTT('key:ctrl+s', () => doSave());
useIFTTT(
  { all: [save.completed, () => connected] },
  'notification:send:synced',
);
```

String leaves are edge events. They latch true for one microtask and then auto-clear, which lets `all` and `any` combine event edges with sustained function conditions. Function leaves are polled every 50ms. **Reactive leaves** (anything with `subscribe`) latch the same way as string leaves — `flow`, `flow.completed`, raw `EventSource`s with a subscribe shim, etc.

`composableKey()` walks the trigger and stamps every function/object leaf through a WeakMap, so two composables with different `when:` predicates **do** trigger re-subscribe (the old `JSON.stringify` path silently dropped functions and collided keys).

Current sharp edge: `{ on, when }` still calls `when()` without the trigger payload. Do not write `when: (event) => …` unless you update `compose.ts` to pass the payload.

## Reactive Chaining

Any `flow` (and any `flow.completed`) is a valid trigger for another `useIFTTT`, because both satisfy `ReactiveEdgeSource<P>`. The third overload accepts them with full payload inference:

```ts
const webhook = useIFTTT('http:webhook:/inbox', 'fs:writefile:/tmp/last.json');
const audit   = useIFTTT(webhook,           (e) => log.write('hit', e));    // edge: trigger fire
const notify  = useIFTTT(webhook.completed, 'notification:send:saved');     // edge: action settle
```

Internally the hook detects a Reactive trigger (`typeof trigger === 'object' && typeof trigger.subscribe === 'function'`) before falling through to the composable path. Memoization is keyed on object identity via the same WeakMap that handles inline functions, so passing `webhook` across renders doesn't restart the subscription.

## Co-design with `useDuring`

`useDuring(x, body)` runs `body` for the lifetime of `x` — boolean / number / Promise / AbortSignal / AsyncIterable / function / another `useDuring` handle / `undefined` (mount). Where `useIFTTT` is **edges**, `useDuring` is **levels**. They're the two halves of the same temporal primitive family.

The IFTTT result's `flow.action` is shaped exactly like a `UseDuringHandle`, so it plugs straight in with no wrapper:

```ts
const save = useIFTTT('key:ctrl+s', async () => saveDocument());

useDuring(save.action, (signal) => {
  return showSpinner({ signal });   // body's AbortSignal fires on close/cancel
});
```

The body receives an `AbortSignal` so async bodies can bail on unmount or `handle.cancel()`. See `runtime/hooks/useDuring.ts` for the full dispatch table.

## Type System

The full type surface lives in `runtime/hooks/ifttt/types/`:

```
runtime/hooks/ifttt/types/
├── events.ts      — IFTTTEventMap (augmentable fixed-name channels)
├── triggers.ts    — KeySpec, TriggerString, ActionString, PayloadOf,
│                    IFTTTActionMap, IFTTTPrefixMap,
│                    ReactiveEdgeSource, ReactiveLevelSource,
│                    ComposableTrigger<P>, IFTTTResult<P>
└── ids.ts         — branded WireId / KeyId / TimerId
```

### `PayloadOf<S>` — trigger → payload

```ts
type PayloadOf<T extends string> =
  T extends keyof IFTTTEventMap ? IFTTTEventMap[T] :
  T extends KeyTrigger          ? KeyPayload :
  T extends TimerTrigger        ? TimerPayload :
  T extends MatchTrigger        ? MatchPayload :
  T extends CountTrigger        ? CountPayload :
  T extends FirsthitTrigger     ? FirsthitPayload :
  T extends RepeatTrigger       ? RepeatPayload :
  T extends ClaudeToolTrigger   ? IFTTTEventMap['system:claude'] :
  [ResolvePrefix<T>] extends [never] ? unknown :
  ResolvePrefix<T>;
```

Resolution order:
1. Fixed-name channel in `IFTTTEventMap` (e.g. `'system:ram'` → `SystemMemPayload`).
2. Built-in prefix family — `key:*`, `timer:*`, `match:*`, `count:*`, `firsthit:*`, `repeat:*`, `system:claude:*`.
3. `IFTTTPrefixMap` entry (augmentable per owning module — see below).
4. `unknown` for anything that fell through.

### Augmenting the type tables

Three augmentation surfaces, each owned by the module that registers the channel:

**`IFTTTEventMap`** — fixed-name channels (one literal string per entry):

```ts
// in your_module.ts
declare module '@reactjit/runtime/hooks/ifttt/types/events' {
  interface IFTTTEventMap {
    'my:fixed:channel': { foo: number; bar: string };
  }
}
```

**`IFTTTPrefixMap`** — parameter-suffix prefix families:

```ts
declare module '@reactjit/runtime/hooks/ifttt/types/triggers' {
  interface IFTTTPrefixMap {
    'proc:ram:':  { pid: number; percent: number; rss: number };
    'proc:cpu:':  { pid: number; ticks: number };
  }
}
```

**`IFTTTActionMap`** — registered action verbs. Closed-union (no `string & {}` escape hatch) so typos to known prefixes get caught at compile time:

```ts
declare module '@reactjit/runtime/hooks/ifttt/types/triggers' {
  interface IFTTTActionMap {
    'my:action:': true;     // trailing colon = parameter follows
    'do:thing':   true;     // no colon = exact-match verb
  }
}
```

```ts
useIFTTT('key:ctrl+s', 'state:set:saved:true');     // ✓
useIFTTT('key:ctrl+s', 'state:tggle:saved');        // ✗ TS error — typo caught
useIFTTT('key:ctrl+s', 'send:my-bus-channel');      // ✓
```

The actual augmentation contracts for the built-in subsystems live in their owning modules:
- `ifttt/permission.ts` augments `IFTTTEventMap` with `system:permission*`
- `ifttt/turn-tracker.ts` augments with `turn:*`
- `ifttt/supervisor.ts` augments `IFTTTEventMap` (lifecycle channels) AND `IFTTTActionMap` (`queue-job:`, `flag-pathology:`, etc.)

### `TriggerString` — closed union + escape hatch

```ts
type TriggerString = KnownTrigger | (string & {});
```

The `string & {}` arm is the well-known TypeScript trick — keeps IntelliSense surfacing literal union members while still allowing arbitrary cart-defined bus channels (which resolve through the registry fallback at runtime).

### `ActionString` — closed-union, no escape hatch

Action verbs are dispatched through a closed registry; a typo should fail at compile time. Plugin verbs augment `IFTTTActionMap`. **No `string & {}`** here, so an unrecognized action prefix is a TS error.

### Branded IDs

`runtime/hooks/ifttt/types/ids.ts` exports `WireId`, `KeyId`, `TimerId` as branded `number` newtypes plus zero-cost constructors and `NO_WIRE` / `NO_KEY` / `NO_TIMER` sentinels. They prevent mixing handles across the three Zig-side registries without runtime overhead.

### Type/runtime drift

`PayloadOf<S>` is a compile-time table; the registry resolves at runtime by prefix. If someone registers a custom source whose actual payload differs from the table's entry, TypeScript happily believes the table — it won't catch the drift. Keep the table in sync with the registrations; for new prefix families, augment `IFTTTPrefixMap` from the owning module rather than editing `triggers.ts`.

### Typed FFI bridges

Two augmentable interfaces sit one level up at `runtime/`:

- **`HostCalls`** in `runtime/ffi.ts` — typed catalog of `__name`/signature pairs for `callHost(name, fallback, ...args)`. Subsystems augment with their own entries (see `useIFTTT.ts` for the `__ifttt_*` block). Untyped calls still flow through the wide `callHost<T>` overload.
- **`HostGlobals`** in `runtime/host-globals.ts` — typed view of the `__*` globals exported by `globalThis`. Use the exported `G` handle instead of `globalThis as any`. Both directions of the Zig↔JS bridge live here.

## Selection and Clipboard Sources

`useIFTTT.ts` side-effect-imports `runtime/hooks/system_selection.ts` and `runtime/hooks/clipboard.ts`. Selection sources sit on the raw `system:selection` / `system:selection:cleared` / `system:clipboard` channels:

| Trigger | Payload | Notes |
|---|---|---|
| `select:cleared` | `{ at }` | Alias for `system:selection:cleared`. |
| `select:any` | full selection event | Alias for `system:selection`. |
| `select:nonempty` | full selection event | Filters out `text.length === 0`. |
| `select:long:<min>` | full selection event | Filters out `text.length < min`. Useful for "user highlighted a paragraph or more." |
| `clipboard:copy` | `{ text, at }` | Re-fired form of `system:clipboard`; only fires for non-empty text. |

```ts
useIFTTT('select:long:200', (e) => showQuickActions(e.text));
useIFTTT('clipboard:copy', (e) => recentClips.push(e.text));
```

The `clipboard:<text>` **action** is now registered inside `runtime/hooks/clipboard.ts` itself (along with `__ifttt_onClipboardChange`). Previously `useIFTTT.ts` wired both — an outlier from the early days of the codebase, before the self-registration pattern crystallised.

## Process Sources and Actions

`runtime/hooks/process.ts` (side-effect imported). `runtime/package.json` marks it side-effectful so esbuild keeps the registrations.

Sources:

| Trigger | Payload | Notes |
|---|---|---|
| `proc:line:<pid>:<regex>` | `{ pid, line, match }` | Subscribes to `proc:stdout:<pid>` and applies a JS `RegExp`. |
| `proc:ram:<pid>` | proc stat payload | Auto-arms `__proc_watch_add`. |
| `proc:ram:<pid>:>:<threshold>` | proc stat payload | Threshold: fraction (`0.8`), percent (`80%`), or bytes (`500MB`, `2GB`). |
| `proc:ram:<pid>:<:<threshold>` | proc stat payload | Same threshold parser. |
| `proc:cpu:<pid>` | cpu sample payload | Auto-arms watcher. |
| `proc:idle:<pid>:<ms>` | `{ pid, id, idleMs, at }` | Fires after no cpu/stdout/stderr activity for the window. |

Actions:

| Action | Behavior |
|---|---|
| `proc:spawn:<cmd>` | Spawns a process with no args. Result pid is dropped. |
| `proc:kill:<pid>` | Sends `SIGTERM`. Pairs well with `$pid`/`$id` substitution. |
| `proc:write:<pid>:<text>` | Writes text to stdin. |

Zig side: `framework/v8_bindings_process.zig` drains stdout/stderr/exit and proc sampling in `tickDrain()`, emitting through `__ffiEmit`.

Raw channels also work through the fallback:

```ts
useIFTTT(`proc:stdout:${pid}`, (line) => {});
useIFTTT(`proc:stderr:${pid}`, (line) => {});
useIFTTT(`proc:exit:${pid}`, (result) => {});
```

## File Watch Sources

`runtime/hooks/useFileWatch.ts`:

| Trigger | Payload |
|---|---|
| `fs:changed:<path>` | `FileWatchEvent` for modified entries. |
| `fs:created:<path>` | `FileWatchEvent` for created entries. |
| `fs:deleted:<path>` | `FileWatchEvent` for deleted entries. |
| `fs:any:<path>` | Any file-watch event. |

```ts
type FileWatchEvent = {
  watcherId: number;
  type: 'created' | 'modified' | 'deleted';
  path: string;
  size: number;
  mtimeNs: number;
};
```

Recursive watchers attached automatically. `framework/fswatch.zig` ticks every frame; JS drains queued events through `__fswatchDrain()` on a singleton 100ms timer.

## Generic Pattern Source (`match:`)

`runtime/hooks/ifttt/match.ts` watches an arbitrary bus channel for text patterns — substring or regex — and fires when a payload contains a hit.

Spec:

```
match:<channel>::<pattern>
```

`<channel>` may itself contain colons (`vm:abc:event:append`); the parser splits on the FIRST `::`. `<pattern>` is either a regex `/source/flags` or a literal case-sensitive substring.

Payload search:
- String payloads search verbatim.
- Object payloads are `JSON.stringify`'d and searched.

Fire payload (`MatchPayload`):

```ts
{
  channel: string;     // the channel that emitted
  payload: unknown;    // the original emit payload
  text: string;        // the searchable string actually tested
  match: string;       // the matched substring (group 0 for regex)
  index: number;       // byte offset into `text`
  groups?: string[];   // capture groups when using a regex with parens
}
```

```ts
useIFTTT('match:event:append::pkill -f', 'flag-pathology:pat_session_kill_pattern');
useIFTTT('match:vm:abc:event:append::/git\\s+add\\s+(-A|\\.|\\*)/', 'halt-run:reason=indiscriminate-stage');
useIFTTT('match:proc:stdout:1234::ERROR', 'notify-user:agent crashed');
```

Companion helper for binders that compose specs from data rows:

```ts
import { matchSpec } from '@reactjit/runtime/hooks/ifttt/match';
matchSpec('vm:abc:event:append', '/rm\\s+-rf/i');
// → 'match:vm:abc:event:append::/rm\\s+-rf/i'
```

The load-bearing primitive behind features like the **Pathology dictionary** (`cart/app/gallery/data/core/pathology.ts`).

## Stateful Aggregation Sources

Three primitives that hold state across emits.

### `count:<channel>::<n>:<windowMs>`

Edge-triggered windowed counter. Fires once on the transition from <N to ≥N within the trailing windowMs window. For periodic re-fires while elevated, wrap with `{ trigger, cooldown: <ms> }`.

`CountPayload`:

```ts
{ channel: string; count: number; n: number; windowMs: number; payload: unknown; at: number }
```

```ts
useIFTTT('count:event:append.tool_use.Read::6:30000', 'flag-pathology:pat_investigation_loop');
useIFTTT(
  { trigger: 'count:proc:stdout:1234::100:1000', cooldown: 10_000 },
  'notify-user:agent is spamming stdout',
);
```

Source: `runtime/hooks/ifttt/count.ts`.

### `firsthit:<channel>::<pattern>`

Same wire format as `match:` but auto-unsubscribes after the first match. Useful for session-first detection.

```ts
useIFTTT('firsthit:vm:abc:event:append::work was destroyed',
  'kick-to-supervisor:check_recovery_first');
```

Source: `runtime/hooks/ifttt/firsthit.ts`. `FirsthitPayload` matches `MatchPayload`.

### `repeat:<channel>::<lookback>:<minSim>`

Fires when an emit's text closely matches an earlier emit on the same channel (Jaccard similarity on normalized 4-shingles).

`RepeatPayload`:

```ts
{
  channel: string;
  current: { text: string; payload: unknown };
  prior:   { text: string; payload: unknown };
  similarity: number;        // 0..1
  indexInLookback: number;   // 0 = oldest in window
}
```

```ts
useIFTTT('repeat:vm:abc:event:append::5:0.7', 'flag-pathology:pat_acknowledgment_without_recalibration');
useIFTTT('repeat:vm:abc:event:append::3:0.65', 'kick-to-supervisor:apology_streak');
```

Companion helper:

```ts
import { similarity } from '@reactjit/runtime/hooks/ifttt/repeat';
similarity('the fix is in', 'fixed it now');  // → 0.31
```

Source: `runtime/hooks/ifttt/repeat.ts`.

### `registerGate({ after, suspect, requires, key?, onFire })`

Programmatic stateful gate — the "after-X-then-Y-unless-Z-in-between" shape. See the original v1 doc (preserved verbatim here):

```ts
import { registerGate } from '@reactjit/runtime/hooks/ifttt/gate';

const dispose = registerGate({
  after:    'event:append',
  afterFilter:    (p) => p.kind === 'tool_use' && p.name === 'Edit',
  key:            (p) => p?.payload?.input?.file_path,

  suspect:  'event:append',
  suspectFilter:  (p) => /\bfix(ed)?\b|\bshipped\b|\btry it now\b/i.test(JSON.stringify(p)),

  requires: 'event:append',
  requiresFilter: (p) => p.kind === 'tool_use' && p.name === 'Bash',

  onFire: ({ key, suspectPayload, afterPayload }) => {
    emit('rule:fired', { ruleId: 'r_manifest_as_truth', file: key, suspectPayload, afterPayload });
  },
});
```

Default behavior: one fire per after-window; `reArmOnFire: true` to keep firing until a `requires` closes the window.

Source: `runtime/hooks/ifttt/gate.ts`.

## Turn Boundary Channels

`runtime/hooks/ifttt/turn-tracker.ts` canonicalizes Claude Code phase events into per-turn boundaries:

| Channel | Payload | Trigger |
|---|---|---|
| `turn:start` | `{ at, turnId, phase: 'session-start' \| 'user-prompt' \| 'unknown' }` | `system:claude:session-start` / `:user-prompt`. |
| `turn:tool-use` | `{ at, turnId, name, count }` | Every `system:claude:pre-tool`. |
| `turn:end` | `{ at, turnId, count, tools, durationMs }` | `system:claude:stop`. |
| `turn:tool-count` | `{ count, name, turnId }` | IFTTT-source alias for `turn:tool-use` (designed as a leaf in composables). |

All four are augmented into `IFTTTEventMap` from the tracker module, so `useIFTTT('turn:end', (e) => …)` infers the payload directly.

```ts
useIFTTT(
  { all: ['turn:end', () => (currentTurn()?.count ?? 0) <= 1] },
  'flag-pathology:pat_premature_stop',
);

useIFTTT(
  {
    seq: [
      'match:event:append::/you\'re right/i',
      'match:event:append::/that said|however|but/i',
      'repeat:event:append::3:0.7',
    ],
    within: 60_000,
  },
  'kick-to-supervisor:performative_ack',
);
```

`currentTurn()` returns the in-progress turn state for caller-side conditionals.

Source: `runtime/hooks/ifttt/turn-tracker.ts`.

## Permission Detection

`runtime/hooks/ifttt/permission.ts` polls the framework's terminal classifier for permission-prompt state transitions and emits `system:permission*` channels. The `permission:` source registers three trigger forms:

| Trigger | Payload | Fires on |
|---|---|---|
| `permission:any` | `PermissionEvent` | Every permission prompt. |
| `permission:<tool>` | `PermissionEvent` | A specific tool name (`permission:Write`, `permission:Bash`, etc.). |
| `permission:dismissed` | `{ at }` | Prompt closed / answered. |

```ts
type PermissionEvent = {
  tool: string;
  target: string;
  options: Record<string, string>;   // 'yes' / 'no' / 'always' / 'always_session' → option text
  fullText: string;
  at: number;
};

useIFTTT('permission:Write', (e) => autoApproveIfTrusted(e.target));
useIFTTT('permission:dismissed', 'send:permission-handled');
```

Source: `runtime/hooks/ifttt/permission.ts`.

## VM Boundary Source (`vm:`)

`runtime/hooks/ifttt/vm.ts` registers the `vm:` prefix so cart-side rules can subscribe to events emitted from inside a Firecracker worker VM:

```ts
useIFTTT('vm:vmrun_001:event:tool-call.dispatched', 'flag-pathology:pat_X');
useIFTTT('vm:vmrun_001:rule:smoke.fired', (e) => console.log(e));
useIFTTT('vm:vmrun_001:verb:verb_build_dev.completed', 'queue-job:job_promote');
```

The principle: there is only one substrate. Reactjit runs on both sides of the VM boundary, and vsock is a transport that mirrors selected bus channels across it. Same hooks, same DSL inside the VM as on the host — events just travel further.

Per-VM bridge lifecycle:

```ts
import { attachVm, detachVm, listAttachedVms } from '@reactjit/runtime/hooks/ifttt/vm';
attachVm('vmrun_001');   // open vsock, mirror under 'vm:vmrun_001:*'
detachVm('vmrun_001');   // tear down
```

`attachVm` is idempotent. While attached, every guest emit on a mirrored channel becomes `vm:<vmid>:<channel>` on the host bus, and any host emit on `vm:<vmid>:<channel>` is forwarded back into the guest.

Default mirrored channels (configurable via `mirrorChannels` / `mirrorPrefix` from `runtime/hooks/vsock.ts`):

| Direction | Channels |
|---|---|
| guest → host | `event:append`, `rule:fired`, `verb:lifecycle`, `worker:lifecycle`, `run:lifecycle` |
| host → guest | `supervisor:halt-run`, `supervisor:invoke-verb`, `supervisor:inject-message`, `supervisor:flag-pathology`, `supervisor:set-variable`, `supervisor:modify-assembly`, `supervisor:commit-state` |

### Three-tier transport selection

`openVsock(opts)` picks among three implementations of the same `VsockTransport` interface:

| Tier | When | Transport |
|---|---|---|
| 1 | `__vsock_open` registered | `HostFnTransport` — real AF_VSOCK over the Zig binding. |
| 2 | No Zig binding + caller passed `vmid` | `LocalPairTransport` — two `openVsock` calls in the same process route to each other in-memory. |
| 3 | No Zig binding + no `vmid` | `NullTransport` — warns once, drops sends. |

Force a tier with `opts.transport: 'host' | 'localpair' | 'null'`; default is `'auto'`.

The Zig binding contract lives at `framework/v8_bindings_vsock.zig`. **It is currently a stub — the file is not registered in `build.zig`** so vsock.ts falls through to LocalPair.

## Auto-Attach Bridge

`cart/app/db/vm-bridges.ts` watches the `session:lifecycle` channel and calls `attachVm(vmid)` / `detachVm(vmid)` automatically when a `worker-session` row transitions.

```text
useCRUD writes worker-session row { id, status: 'running', vmid: 'vmrun_001' }
  → cart/app/db/buses.ts notifyRowChange('worker-session', row)
  → emitSessionLifecycle({ sessionId, status, vmid, ... })
  → 'session:lifecycle' bus event
  → cart/app/db/vm-bridges.ts subscriber → attachVm('vmrun_001')
  → namespaceMirror over vsock
  → host useIFTTT('vm:vmrun_001:event:tool-call.dispatched', …) fires
```

```ts
import { installVmBridges, uninstallVmBridges, listVmBridgeRefs } from '@reactjit/cart/app/db';
installVmBridges();
listVmBridgeRefs();    // [ { vmid, sessionIds: [...] }, ... ]
uninstallVmBridges();
```

The in-VM producer is the **worker shell cart** (`framework/firecracker/vm-runtime/cart.tsx`): mounts at boot, reads `/worker/assignment.json`, spawns the agent CLI subprocess, pipes its stdout/stderr/exit onto the local bus as `event:append` rows, and reacts to host-issued supervisor channels.

## Claim Ledger & Verify-Loop

The bus + `match:` + `registerGate` triad detects most pathology shapes. Closing the verify-loop — making the agent come back and check — needs a **Claim ledger**. The entity is `cart/app/gallery/data/core/claim.ts`; the engine is `cart/app/db/claim-engine.ts`.

```ts
import { installClaimEngine, listOpenClaims, resolveClaim } from '@reactjit/cart/app/db';
installClaimEngine();
```

For each `session:lifecycle status='running'` event the engine attaches a detector to the right `event:append` channel — host-side or `vm:<vmid>:event:append`. On session terminate it tears the detector down and expires every unresolved claim it owned.

### Default ruleset

| `ClaimKind` | Pattern | Required evidence |
|---|---|---|
| `fix` | `fix(ed)?`, "the bug is gone", "should be silenced", "that should do it" | build-success, run-success |
| `ship` | "shipped", "the work is in", "landed", "merged" | build-success, test-pass |
| `works` | "works", "try it now", "good to go" | run-success |
| `cause` | "the cause is", "happens because", "root cause is" | stack-trace, repro-run |
| `recovery` | "work was destroyed", "unrecoverable", "lost forever" | reflog-read |
| `pre-existing` | "pre-existing" / "preexisting" | log-grep |
| `completion` | "all done", "all <n> tasks fixed", "all steps complete" | test-pass, run-success |

### Evidence shapes

| `ClaimEvidenceKind` | Triggered when payload contains | Credits |
|---|---|---|
| `build-success` | `Bash` `zig build`/`cargo build`/`npm build` exit 0 | fix, ship |
| `test-pass` | `Bash` `zig test`/`cargo test`/`npm test`/`pytest`/`go test` exit 0 / "passed" | ship, completion |
| `run-success` | `Bash` any command exit 0 | works, fix, completion |
| `reflog-read` | `Bash` `git reflog` | recovery |
| `log-grep` | `Bash` `git log --follow` / `git blame` | pre-existing |
| `stack-trace` | `Read` of `.log` / stderr / panic / Traceback | cause |
| `repro-run` | `Bash` `./` / `bash` / `sh` with an exit | cause |

### The loop

```text
1. agent emits "fixed" on event:append
2. claim-engine matches DEFAULT_RULES.fix → inserts Claim {
     status: 'unverified',
     requiredEvidence: ['build-success', 'run-success'],
     injectTemplate: 'You said "{claim}". No evidence ({requiredEvidence})...'
   }
3. claim-engine emits 'claim:opened:<id>' to seed the verify-gate window
4. registerGate watches event:append:
     - suspect = any tool_use that isn't an evidence event
     - requires = an event matching one of requiredEvidence
5a. agent runs `zig build && ./bin` (exit 0) → engine credits evidence,
    status='verified', gate disposes
5b. agent emits another forward action with no evidence → gate fires,
    emits 'vm:<vmid>:supervisor:inject-message' with the filled template
6. worker shell cart receives supervisor:inject-message, writes the
   prompt back into the agent process via stdin
7. agent re-prompts itself → runs verification → step 5a closes the loop
```

`{claim}` / `{scope}` / `{requiredEvidence}` substitutions come from the row's `injectTemplate`. Override per row to customize.

Manual resolution:

```ts
resolveClaim('claim_001', 'supervisor-overrode', 'shipping the ack manually');
resolveClaim('claim_002', 'rule-rejected',      'higher-priority pathology fired');
```

## Supervisor Lifecycle Channels

`runtime/hooks/ifttt/supervisor.ts` exposes typed `emit*` helpers for the supervisor namespace and registers source/action prefixes. The DB writer (`cart/app/db/buses.ts`) calls these on each row insert/transition; tests can call them too.

| Channel | Helper | Triggered by |
|---|---|---|
| `event:append` | `emitEventAppend(row)` | `event` row insert. |
| `rule:fired` | `emitRuleFired(row)` | `rule-firing` row insert. |
| `verb:lifecycle` | `emitVerbLifecycle(row)` | `verb-invocation` row insert/transition. |
| `worker:lifecycle` | `emitWorkerLifecycle(row)` | `worker` row update. |
| `run:lifecycle` | `emitRunLifecycle(row)` | `composition-run` row update. |
| `session:lifecycle` | `emitSessionLifecycle(row)` | `worker-session` row update. **Drives auto-attach.** |
| `claim:lifecycle` | `emitClaimLifecycle(row)` | `claim` row update. **Drives the verify-loop UI.** |

All five core lifecycle channels are augmented into `IFTTTEventMap` from `ifttt/supervisor.ts`, so a subscriber gets typed row shapes:

```ts
useIFTTT('event:append', (e) => { /* e.kind: string, e.subjectId?: string, … */ });
useIFTTT('vm:vmrun_001:event:append', (e) => { /* guest events only */ });
useIFTTT('match:event:append::/rm\\s+-rf/i', 'halt-run:reason=destructive');
```

### Supervisor source specs (kind-filtered)

Five **kind-filtered prefixes** on top of the raw lifecycle channels — each watches the underlying channel and only fires when a row's identifying field matches the spec, with `.*` for suffix-wildcards:

| Spec form | Underlying channel | Matches when |
|---|---|---|
| `event:<kind>` | `event:append` | `row.kind === '<kind>'` |
| `event:<prefix>.*` | `event:append` | `row.kind` starts with `<prefix>.` |
| `rule:<ruleId>.fired` | `rule:fired` | `row.ruleId === '<ruleId>'` |
| `verb:<verbId>.<status>` | `verb:lifecycle` | `verbId` and `status` both match |
| `worker:<workerId>.<lifecycle>` | `worker:lifecycle` | `workerId` and `lifecycle` both match |
| `run:<runId>.<status>` | `run:lifecycle` | `runId` and `status` both match |

```ts
useIFTTT('event:tool-call.*', (e) => observability.tool(e));
useIFTTT('verb:verb_build_dev.completed', 'queue-job:job_promote');
useIFTTT('worker:w1.streaming', 'log:w1 is live');
```

### Supervisor actions

`ifttt/supervisor.ts` registers thirteen action prefixes (all entered into `IFTTTActionMap` so typos compile-error). Each emits a normalized `supervisor:<kind>` bus event:

| Action | Emits on | Behavior |
|---|---|---|
| `halt-run` / `halt-run:<reason>` | `supervisor:halt-run` | `{ reason, triggerPayload }`. Halts the active CompositionRun. |
| `flag-pathology:<pathologyId>` | `supervisor:flag-pathology` | Inserts a pending `pathology-detection` row. |
| `invoke-verb:<verbId>` | `supervisor:invoke-verb` | Dispatches a verb. Trigger payload attached as args. |
| `fire-rule:<ruleId>` | `supervisor:fire-rule` + `rule:fired` | Synthesizes a rule firing. |
| `kick-to-supervisor` | `supervisor:kick-to-supervisor` | Routes the agent's next step through the supervisor. |
| `notify-user:<text>` | `supervisor:notify-user` | Surfaces a notification in the cockpit. |
| `inject-message:<text>` | `supervisor:inject-message` | Writes back into the agent's stdin. **The verify-loop's prompt-back action.** |
| `spawn-worker:<role>` | `supervisor:spawn-worker` | Adds a worker to the active crew. |
| `modify-assembly:<spec>` | `supervisor:modify-assembly` | Mutates the active prompt assembly mid-run. |
| `set-variable:<spec>` | `supervisor:set-variable` | Sets a run-scoped variable. |
| `commit-state` | `supervisor:commit-state` | Snapshots state to the run's history. |
| `mark-status:<spec>` | `supervisor:mark-status` | Updates a status field on the active run. |
| `queue-job:<jobId>` | `supervisor:queue-job` | Enqueues a job. |

```ts
useIFTTT(
  'match:vm:abc:event:append::/pkill\\s+-f/i',
  'flag-pathology:pat_session_kill_pattern',
);
```

The receiver side — what actually persists/dispatches when these `supervisor:*` events land — is documented in `cart/app/db/MECHANICAL_WIRES.md`.

## End-to-End Pipeline

1. A cart calls `useIFTTT(trigger, action)`.
2. The hook allocates a Zig wire via `useState(() => allocWire(...))` — StrictMode-safe; the React-tracked state survives bailed renders. The cleanup `useEffect` frees the wire on unmount.
3. For a string trigger, `resolveTrigger(trigger)` selects the longest-matching registry source. If none matches, the fallback subscribes to a raw bus channel of the same name.
4. For a Reactive trigger (another `flow`, `flow.completed`, anything with `subscribe`), the hook uses it directly as an `IfttSubscription`.
5. For a composable trigger, `compileTrigger()` builds a tree of nodes and returns the same subscription shape as a registry source. Reactive leaves inside composables get the same edge-latch-and-microtask-clear semantics as string leaves.
6. For a function trigger, RAF polls the predicate at frame rate; the function is read through a ref so identity changes don't restart the loop.
7. When a source fires, the per-hook `fire()` runs the contract documented in **Fire order** above: trigger subs → wire bump → action → action-window tracking (if Promise) → completed subs.

Bus mechanics:

```ts
busEmit('app:navigate', '/chat');
useIFTTT('app:navigate', (path) => nav.push(path));
```

`busEmit` is synchronous because it calls `ffi.emit()`. Zig-origin async domains call `globalThis.__ffiEmit(channel, payload)`, and `ffi.ts` defers listener dispatch with `setTimeout(0)` to avoid setState during host/event commit.

System signal path:

```text
SDL or per-frame poll
  -> framework/system_signals.zig or framework/clipboard_watch.zig
  -> v8_runtime.callGlobal("__beginJsEvent")
  -> v8_runtime.evalExpr("__ifttt_onSystemFoo(...)")
  -> runtime/hooks/useIFTTT.ts global handler  (or clipboard.ts for __ifttt_onClipboardChange)
  -> ffi.emit("system:foo", payload)
  -> useIFTTT subscriber fire(payload)
  -> action
```

Key path:

```text
SDL_EVENT_KEY_DOWN / KEY_UP
  -> engine.zig packs (mod << 16) | (sym & 0xFFFF)
  -> __ifttt_onKeyDown(packed) / __ifttt_onKeyUp(packed)
  -> JS decodes SDL3 keycode + modifier mask
  -> emits __keydown / __keyup internal bus events
  -> key:* registry source filters by parsed key spec
```

SDL keymask constants are pinned to **SDL3** (the version Zig links against). Each mask covers both left and right variants (e.g. `CTRL = LCTRL | RCTRL`).

Clipboard path:

```text
clipboard_watch.tick()
  -> SDL_GetClipboardText()
  -> Wyhash change detection
  -> __ifttt_onClipboardChange()           ← installed in clipboard.ts
  -> JS clipboard.get()
  -> system:clipboard
```

File drop path:

```text
SDL_EVENT_DROP_FILE
  -> system_signals.notifyDrop(path)
  -> path copied into Zig stash
  -> __ifttt_onSystemDrop()
  -> JS pulls __sys_drop_path()
  -> system:fileDropped
```

Resize path:

```text
SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED
  -> system_signals.notifyResize(w, h)
  -> update latest w/h
  -> only fire JS if breakpoint tier changes
  -> system:resize
  -> installResizeBridge() updates runtime/theme viewport width
```

Claude hook path:

```text
Claude Code hook JSON
  -> .claude/hooks/ifttt-bus.sh
  -> normalize to one JSON line
  -> fan out by .claude/ifttt-transports.json
  -> HTTP POST http://127.0.0.1:7421/claude-bus
  -> cart useHost({ kind: 'http', port: 7421, onRequest })
  -> dispatchClaudeEvent(req.body)
  -> system:claude, system:claude:<tool>, system:claude:<phase>
```

The bundled isolated test cart implements that listener in `cart/app/isolated_tests/ifttt_test.tsx`.

## Runtime Initialization

`runtime/index.tsx` installs no-op `__ifttt_*` globals before React/runtime imports finish. That prevents telemetry/system-signals from spamming reference errors if a Zig tick fires before `useIFTTT.ts` has installed the real handlers.

Then `runtime/index.tsx` requires `./hooks/useIFTTT` for side effects. The real handlers are installed once using `globalThis.__ifttt_handlers_installed`. The `__ifttt_onClipboardChange` handler is installed once using a separate `if (!G.__ifttt_onClipboardChange)` guard inside `clipboard.ts`.

Core host bindings used by the hook:

| Host function | Registered in | Used for |
|---|---|---|
| `__clipboard_get` | `framework/v8_bindings_core.zig` | Clipboard trigger payload. |
| `__clipboard_set` | `framework/v8_bindings_core.zig` | Clipboard action. |
| `__sys_drop_path` | `framework/v8_bindings_core.zig` | File drop payload pull. |
| `__viewport_width` / `__viewport_height` | `framework/v8_bindings_core.zig` | Resize bridge seed. |
| `__fswatchAdd` / `__fswatchRemove` / `__fswatchDrain` | `framework/v8_bindings_core.zig` | `fs:*` sources. |
| `__proc_*` | `framework/v8_bindings_process.zig` | `proc:*` sources/actions. |
| `__ifttt_wire_*`, `__ifttt_timer_*`, `__ifttt_key_*`, `__ifttt_state_*`, `__ifttt_last_key` | `framework/v8_bindings_ifttt.zig` | Per-wire counters, timer wheel, key matcher, shared-state map. Typed in `runtime/hooks/useIFTTT.ts` via `declare module '../ffi' { interface HostCalls { … } }`. |

## Current Users

Representative cart usage:

- `cart/app/index.tsx` subscribes to `app:navigate` and routes bus payloads through `nav.push`.
- `cart/app/InputStrip.tsx` emits `app:navigate`.
- `cart/app/composer/page.tsx` uses key triggers for editor shortcuts.
- `cart/app/EffectProfilerOverlay.tsx` toggles on `key:ctrl+shift+f`.
- `cart/testing_carts/watchdog.tsx` combines `proc:ram`, `proc:idle`, and `system:hang`.
- `cart/app/isolated_tests/ifttt_test.tsx` is the manual trigger/action test surface.

## Legacy and Adjacent Code

- `framework/ifttt.zig` is generated from `framework/ifttt.mod.tsz`. It stores up to 64 framework-side rules with typed trigger/action unions and executes them from `init`, `tick`, `onKeyDown`, and `onKeyUp`.
- `framework/qjs_runtime.zig` embeds an older QuickJS IFTTT implementation. QJS is maintenance-only — V8 is the default runtime.
- `framework/lua/ifttt.lua` and `framework/ifttt_lua.mod.tsz` are LuaJIT-era rule engines. The repo direction is V8 + Zig/TS, not new Lua IFTTT work.

## Review Notes

- **Lazy reactivity is sticky.** Reading `fired` / `lastEvent` / `lastFiredAt` once flips the host's "subscribed to trigger" flag for the component's lifetime. Same for `action.active` / `action.startedAt` / `action.done` (separate flag). Reading any of `fired`/`lastEvent`/`lastFiredAt` subscribes to all three — they change together; cheap.
- **`fired` can be ahead of `lastEvent` by one** in render output. `lastEvent` is JS-side (set in `fire()` before the commit); `fired` is read from Zig at render time, so a burst between commit and render can show a higher counter.
- **`completed` fires for typo'd actions.** When `dispatchAction` returns `handled: false`, `completed` still fires and a `console.warn` flags the bad spec. Catch typos at compile time by using `ActionString`.
- **Bare `click` source** is registered but currently no V8 producer emits `__click`. Treat as unfinished.
- **`{ on, when }`** does not pass payload into `when`. Use external refs/state in the predicate, or update the composer before relying on payload-aware gating.
- **`state:*` shared state** is JS-side cache + Zig hotstate backing (`framework/hotstate.zig` via `__ifttt_state_get/set`). Survives V8 isolate teardown; not SQLite/localstore-backed.
- **Plain function triggers** are RAF-polled (`runtime/hooks/useIFTTT.ts:980` area). If a condition can change without rendering, that's fine — the poll cadence is decoupled from React. The poll reads via `triggerRef.current` so identity changes don't restart the loop.
- **`system:vram`** only covers Linux DRM files exposing `mem_info_vram_total` and `mem_info_vram_used`; NVIDIA proprietary setups silently skip.
- **System resize events** are breakpoint-tier gated, not per-pixel resize streams.

## File Map

- Hook surface and built-ins: `runtime/hooks/useIFTTT.ts`
- Type surface: `runtime/hooks/ifttt/types/{events,triggers,ids}.ts`
- Shared listener bus: `runtime/ffi.ts` (`subscribe` / `subscribeAll` / `emit` + augmentable `HostCalls`)
- Typed globalThis: `runtime/host-globals.ts` (augmentable `HostGlobals` + exported `G`)
- Registry: `runtime/hooks/ifttt/registry.ts`
- Compositional triggers + action substitution: `runtime/hooks/ifttt/compose.ts`
- Process IFTTT registrations: `runtime/hooks/process.ts`
- File-watch IFTTT registrations: `runtime/hooks/useFileWatch.ts`
- Clipboard (action + handler self-registered): `runtime/hooks/clipboard.ts`
- Generic pattern source (`match:`): `runtime/hooks/ifttt/match.ts`
- Windowed counter source (`count:`): `runtime/hooks/ifttt/count.ts`
- Single-shot pattern source (`firsthit:`): `runtime/hooks/ifttt/firsthit.ts`
- Programmatic stateful gate (`registerGate`): `runtime/hooks/ifttt/gate.ts`
- Claim-shape similarity source (`repeat:`): `runtime/hooks/ifttt/repeat.ts`
- Permission detector (`permission:`): `runtime/hooks/ifttt/permission.ts`
- Turn boundary tracker (`turn:*`): `runtime/hooks/ifttt/turn-tracker.ts`
- VM boundary source (`vm:`) + per-VM bridge lifecycle: `runtime/hooks/ifttt/vm.ts`
- Supervisor lifecycle emit helpers + actions: `runtime/hooks/ifttt/supervisor.ts`
- Vsock transport + channel-mirror helpers: `runtime/hooks/vsock.ts`
- Production vsock binding contract (stub, not yet registered): `framework/v8_bindings_vsock.zig`
- Co-design partner — `useDuring(x, body)`: `runtime/hooks/useDuring.ts`
- Row-change → bus mapping: `cart/app/db/buses.ts`
- Auto-attach bridge (worker-session → vsock): `cart/app/db/vm-bridges.ts`
- Claim ledger entity: `cart/app/gallery/data/core/claim.ts`
- Claim detector + verify-gate engine: `cart/app/db/claim-engine.ts`
- Worker shell cart (in-VM event producer): `framework/firecracker/vm-runtime/cart.tsx`
- Recipe helper that bakes the runtime into a worker rootfs: `framework/firecracker/lib/with-worker-runtime.ts`
- Side-effect preservation: `runtime/package.json`
- Runtime no-op bootstrap: `runtime/index.tsx`
- V8 core host bindings: `framework/v8_bindings_core.zig`
- Process host bindings: `framework/v8_bindings_process.zig`
- System signal producers: `framework/system_signals.zig`, `framework/clipboard_watch.zig`
- SDL event dispatch/ticks: `framework/engine.zig`
- Claude hook fanout: `.claude/hooks/ifttt-bus.sh`, `.claude/ifttt-transports.json`
- Manual test cart: `cart/app/isolated_tests/ifttt_test.tsx`
- Zig-side generated rule engine: `framework/ifttt.zig`, `framework/ifttt.mod.tsz`
