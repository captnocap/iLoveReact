# `useIFTTT` (V8 Runtime)

`useIFTTT` is the cart-side automation hook:

```ts
useIFTTT(trigger, action)
```

It connects one trigger to one action, tracks fire metadata for UI/debugging, and uses the shared `runtime/ffi.ts` listener registry as its bus. Most runtime events are plain bus events; Zig-origin system signals enter JS through `globalThis.__ifttt_*` handlers and are immediately re-emitted onto that same bus.

This is not the generated `framework/ifttt.zig` rule engine. That Zig module is a compile-time fast path for framework-side rules. The V8 cart API documented here lives in `runtime/hooks/useIFTTT.ts`.

## Public API

Import from either the hook file or the hooks barrel:

```ts
import {
  useIFTTT,
  busOn,
  busEmit,
  getSharedState,
  setSharedState,
  dispatchClaudeEvent,
  registerIfttSource,
  registerIfttAction,
} from '@reactjit/runtime/hooks';
```

Hook signature:

```ts
type IFTTTTrigger =
  | string
  | (() => boolean)
  | IFTTTComposable;

type IFTTTAction =
  | string
  | ((event?: any) => void);

type IFTTTResult = {
  fired: number;
  lastEvent: any;
  lastFiredAt: number;
  fire: (event?: any) => void;
};

function useIFTTT(trigger: IFTTTTrigger, action: IFTTTAction): IFTTTResult;
```

`fire(event?)` is an imperative escape hatch. It runs the same action path as a trigger fire and updates `fired`, `lastEvent`, and `lastFiredAt`.

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

type IfttActionRunner = (rest: string, payload: any) => void;

function registerIfttSource(prefix: string, src: IfttSource): void;
function registerIfttAction(prefix: string, run: IfttActionRunner): void;
function setIfttFallback(src: IfttSource): void;
function resolveTrigger(spec: string): IfttSubscription | null;
function dispatchAction(action: string, payload: any): boolean;
function listIfttSources(): string[];
function listIfttActions(): string[];
```

Registry prefix matching is longest-prefix wins. Exact matches always work; prefix matches require a trailing `:` boundary, so `state:set:` beats `state:`.

## Built-In Triggers

String triggers:

| Trigger | Payload | Source |
|---|---|---|
| `mount` | `{ at }` | Fires synchronously when subscribed. |
| `key:<key>` | decoded key event | SDL keydown via `__ifttt_onKeyDown`. |
| `key:up:<key>` | decoded key event | SDL keyup via `__ifttt_onKeyUp`. |
| `key:ctrl+s`, `key:meta+a`, etc. | decoded key event | Key parser supports `ctrl/control`, `shift`, `alt/option`, `meta/cmd/command`. |
| `timer:every:<ms>` | `{ at, interval }` | JS `setInterval`. Minimum interval is clamped to `1`. |
| `timer:once:<ms>` | `{ at, delay }` | JS `setTimeout`. Delay is clamped to `0+`. |
| `state:<key>:<value>` | matched value | In-memory shared-state map. Values are coerced from string to `true`, `false`, `null`, number, or string. |
| `<event>` | event payload | Raw bus fallback. Pairs with `busEmit(event, payload)` or `send:<event>`. |
| `click` | intended click payload | Registered, but currently no V8 producer emits `__click`. Prefer explicit `Pressable` handlers or `busEmit` until that producer is wired. |

System triggers are raw bus events produced by Zig/V8 handlers:

| Trigger | Payload | Producer |
|---|---|---|
| `system:clipboard` | clipboard text | `framework/clipboard_watch.zig` polls SDL clipboard every 250ms, then JS reads `__clipboard_get()`. |
| `system:focus` | `{ at }` | SDL focus gained. |
| `system:blur` | `{ at }` | SDL focus lost. |
| `system:fileDropped` | path string | SDL drop file. Zig stashes path; JS pulls with `__sys_drop_path()`. |
| `system:cursor:move` | `{ x, y, dx, dy }` | `SDL_GetGlobalMouseState`, at about 60Hz max and only on movement. |
| `system:slowFrame` | `{ ms }` | Post-paint frame duration over 32ms. |
| `system:hang` | `{ count }` | 3 consecutive slow frames; recovery emits `{ count: 0 }`. |
| `system:ram` | `{ used, total, percent }` | `/proc/meminfo`, 1Hz, only on changed sample. |
| `system:vram` | `{ used, total, percent }` | `/sys/class/drm/cardN/device/mem_info_vram_*`, 1Hz, first card with stats. |
| `system:resize` | `{ w, h }` | Window pixel-size changes, tier-gated to sm/md/lg/xl breakpoint crossings. |
| `system:claude` | normalized hook entry | `dispatchClaudeEvent`. |
| `system:claude:<tool>` | normalized hook entry | Lowercased `entry.tool`. |
| `system:claude:<phase>` | normalized hook entry | Lowercased `entry.phase`. |

Function triggers:

```ts
useIFTTT(() => score > 100, 'send:victory');
```

Plain function triggers run after every render and fire on a false to true edge. Keep them pure and cheap. Function leaves inside composable triggers are different: the composer polls them every 50ms.

## Built-In Actions

| Action | Behavior |
|---|---|
| `state:set:<key>:<val>` | Coerces `<val>` and writes the shared-state map. |
| `state:toggle:<key>` | Writes `!getSharedState(key)`. |
| `send:<event>` | Emits the trigger payload to the named bus event. |
| `log:<message>` | `console.log('[ifttt]', message, payload ?? '')`. |
| `clipboard:<text>` | Writes text through `runtime/hooks/clipboard.ts` and `__clipboard_set`. |
| function action | Called with the trigger payload. |

String actions pass through substitution first:

```ts
useIFTTT('proc:idle:123:5000', 'proc:kill:$pid');
useIFTTT('system:fileDropped', 'log:dropped $payload');
useIFTTT('custom:event', 'log:path $payload.path');
```

Supported substitutions:

- `$payload` -> `JSON.stringify(payload)`
- `$payload.path.to.field` -> nested field string
- `$id` -> `payload.id ?? payload.pid ?? ''`
- `$pid` -> `payload.pid ?? payload.id ?? ''`

## Composable Triggers

Composable shapes live in `runtime/hooks/ifttt-compose.ts`.

```ts
type IFTTTComposable =
  | string
  | (() => boolean)
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
```

String leaves are edge events. They latch true for one microtask and then auto-clear, which lets `all` and `any` combine event edges with sustained function conditions. Function leaves are polled every 50ms.

Current sharp edge: `{ on, when }` calls `when()` without the trigger payload. Do not write `when: (event) => ...` unless `ifttt-compose.ts` is changed to pass the payload.

## Process Sources And Actions

`useIFTTT.ts` imports `runtime/hooks/process.ts` for side-effect registration. `runtime/package.json` marks that file as side-effectful so esbuild keeps the registrations.

Sources:

| Trigger | Payload | Notes |
|---|---|---|
| `proc:line:<pid>:<regex>` | `{ pid, line, match }` | Subscribes to `proc:stdout:<pid>` and applies a JS `RegExp`. |
| `proc:ram:<pid>` | proc stat payload | Auto-arms `__proc_watch_add`. |
| `proc:ram:<pid>:>:<threshold>` | proc stat payload | Threshold can be fraction (`0.8`), percent (`80%`), or bytes (`500MB`, `2GB`). |
| `proc:ram:<pid>:<:<threshold>` | proc stat payload | Same threshold parser. |
| `proc:cpu:<pid>` | cpu sample payload | Auto-arms watcher. |
| `proc:idle:<pid>:<ms>` | `{ pid, id, idleMs, at }` | Fires after no cpu/stdout/stderr activity for the window. |

Actions:

| Action | Behavior |
|---|---|
| `proc:spawn:<cmd>` | Spawns a process with no args. Result pid is dropped. |
| `proc:kill:<pid>` | Sends `SIGTERM`. Works well with `$pid`/`$id` substitution. |
| `proc:write:<pid>:<text>` | Writes text to stdin. |

Zig side: `framework/v8_bindings_process.zig` drains stdout/stderr/exit and proc sampling in `tickDrain()`, emitting channels through `__ffiEmit`.

Raw process channels also work through the fallback:

```ts
useIFTTT(`proc:stdout:${pid}`, (line) => {});
useIFTTT(`proc:stderr:${pid}`, (line) => {});
useIFTTT(`proc:exit:${pid}`, (result) => {});
```

## File Watch Sources

`useIFTTT.ts` also imports `runtime/hooks/useFileWatch.ts` for side-effect registration.

| Trigger | Payload |
|---|---|
| `fs:changed:<path>` | `FileWatchEvent` for modified entries. |
| `fs:created:<path>` | `FileWatchEvent` for created entries. |
| `fs:deleted:<path>` | `FileWatchEvent` for deleted entries. |
| `fs:any:<path>` | Any file-watch event. |

`FileWatchEvent`:

```ts
type FileWatchEvent = {
  watcherId: number;
  type: 'created' | 'modified' | 'deleted';
  path: string;
  size: number;
  mtimeNs: number;
};
```

The DSL always attaches recursive watchers. `framework/fswatch.zig` ticks every frame; JS drains queued events through `__fswatchDrain()` on a singleton 100ms timer.

## Generic Pattern Source (`match:`)

`useIFTTT.ts` imports `runtime/hooks/ifttt-match.ts` for side-effect registration. This source watches an arbitrary bus channel for text patterns — substring or regex — and fires when a payload contains a hit.

Spec:

```
match:<channel>::<pattern>
```

`<channel>` may itself contain colons (`vm:abc:event:append`); the parser splits on the FIRST `::` to keep arbitrary channel namespaces intact. `<pattern>` is either:

- A regex of the form `/source/flags`
- Otherwise, a literal case-sensitive substring

Payload search:

- String payloads search verbatim.
- Object payloads are `JSON.stringify`'d and the result is searched. A needle `rm -rf` fires whether the line was emitted as `{ line: 'rm -rf /' }`, `{ payload: { text: 'rm -rf /' } }`, or any other nested shape. Tradeoff: a needle that collides with a JSON key can produce false positives — usually fine for keyword detection; use regex bounds when it matters.

Fire payload:

```ts
{
  channel: string;     // the channel that emitted
  payload: any;        // the original emit payload
  text: string;        // the searchable string actually tested
  match: string;       // the matched substring (group 0 for regex)
  index: number;       // byte offset into `text`
  groups?: string[];   // capture groups when using a regex with parens
}
```

Examples:

```ts
useIFTTT('match:event:append::pkill -f',
  'flag-pathology:pat_session_kill_pattern');

useIFTTT('match:vm:abc:event:append::/git\\s+add\\s+(-A|\\.|\\*)/',
  'halt-run:reason=indiscriminate-stage');

useIFTTT('match:proc:stdout:1234::ERROR',
  'notify-user:agent crashed');
```

Companion helper for binders that compose specs from data rows:

```ts
import { matchSpec } from '@reactjit/runtime/hooks/ifttt-match';
matchSpec('vm:abc:event:append', '/rm\\s+-rf/i');
// → 'match:vm:abc:event:append::/rm\\s+-rf/i'
```

This is the load-bearing primitive behind features like the **Pathology dictionary** (`cart/app/gallery/data/core/pathology.ts`): each `Pathology.detectionSignals[]` entry — `{ kind: 'pattern', spec: '<regex>', surface: 'stdout' | 'tool-call' | … }` — can be bound by emitting one `match:<surface-channel>::<spec>` per row. Adding a new banned phrase becomes a data write.

## VM Boundary Source (`vm:`)

`runtime/hooks/ifttt-vm.ts` registers the `vm:` prefix so cart-side rules can subscribe to events emitted from inside a Firecracker worker VM:

```ts
useIFTTT('vm:vmrun_001:event:tool-call.dispatched', 'flag-pathology:pat_X');
useIFTTT('vm:vmrun_001:rule:smoke.fired', (e) => console.log(e));
useIFTTT('vm:vmrun_001:verb:verb_build_dev.completed', 'queue-job:job_promote');
```

The principle: there is only one substrate. Reactjit runs on both sides of the VM boundary, and vsock is a transport that mirrors selected bus channels across it. Same hooks, same DSL inside the VM as on the host — events just travel further.

Per-VM bridge lifecycle (typically driven by the auto-attach module described below):

```ts
import { attachVm, detachVm, listAttachedVms } from '@reactjit/runtime/hooks/ifttt-vm';
attachVm('vmrun_001');   // open vsock, mirror under 'vm:vmrun_001:*'
detachVm('vmrun_001');   // tear down
```

`attachVm` is idempotent. While attached, every guest emit on a mirrored channel becomes `vm:<vmid>:<channel>` on the host bus, and any host emit on `vm:<vmid>:<channel>` is forwarded back into the guest as `<channel>` (so a host rule can issue `supervisor:halt-run` and the in-VM cart reacts).

Default mirrored channels (configurable via `mirrorChannels` / `mirrorPrefix` from `runtime/hooks/vsock.ts`):

| Direction | Channels |
|---|---|
| guest → host | `event:append`, `rule:fired`, `verb:lifecycle`, `worker:lifecycle`, `run:lifecycle` |
| host → guest | `supervisor:halt-run`, `supervisor:invoke-verb`, `supervisor:inject-message`, `supervisor:flag-pathology`, `supervisor:set-variable`, `supervisor:modify-assembly`, `supervisor:commit-state` |

The transport binds via `__vsock_open` / `__vsock_send` / `__vsock_close` host functions (`runtime/hooks/vsock.ts`). When those bindings are absent (pre-firecracker dev), `openVsock()` returns a `NullTransport` that warns once and otherwise no-ops — cart code stays valid and inert; the moment the bindings ship, every wire activates without changes.

## Auto-Attach Bridge

`cart/app/db/vm-bridges.ts` watches the `session:lifecycle` channel and calls `attachVm(vmid)` / `detachVm(vmid)` automatically when a `worker-session` row transitions. No cart has to call attach/detach by hand.

```text
useCRUD writes worker-session row { id, status: 'running', vmid: 'vmrun_001' }
  → cart/app/db/buses.ts notifyRowChange('worker-session', row)
  → emitSessionLifecycle({ sessionId, status, vmid, ... })
  → 'session:lifecycle' bus event
  → cart/app/db/vm-bridges.ts subscriber → attachVm('vmrun_001')
  → namespaceMirror over vsock
  → host useIFTTT('vm:vmrun_001:event:tool-call.dispatched', …) fires
```

Reverses cleanly when status moves off `'running'`. Internal refcounts (per-vmid `Set<sessionId>`) make duplicate row writes idempotent and protect against tearing a bridge that another active session on the same VM still depends on.

```ts
import { installVmBridges, uninstallVmBridges, listVmBridgeRefs } from '@reactjit/cart/app/db';
installVmBridges();    // subscribe; idempotent
listVmBridgeRefs();    // [ { vmid, sessionIds: [...] }, ... ]
uninstallVmBridges();  // for hot reload
```

The producer inside the VM is the **worker shell cart** (`framework/firecracker/vm-runtime/cart.tsx`): a reactjit cart that mounts at boot, reads `/worker/assignment.json`, spawns the agent CLI subprocess, pipes its stdout/stderr/exit onto the local bus as `event:append` rows, and reacts to host-issued supervisor channels. Every recipe wraps with `withWorkerRuntime(spec)` from `framework/firecracker/lib/with-worker-runtime.ts` to bake the runtime + worker shell into the rootfs.

## Supervisor Lifecycle Channels

`runtime/hooks/ifttt-supervisor.ts` exposes typed `emit*` helpers for the supervisor namespace and registers an action prefix. The DB writer (`cart/app/db/buses.ts`) calls these on each row insert / transition; tests can call them too. Wrapping `emit` keeps channel names canonical — no string typos in writers.

| Channel | Helper | Triggered by |
|---|---|---|
| `event:append` | `emitEventAppend(row)` | `event` row insert. |
| `rule:fired` | `emitRuleFired(row)` | `rule-firing` row insert. |
| `verb:lifecycle` | `emitVerbLifecycle(row)` | `verb-invocation` row insert / transition. |
| `worker:lifecycle` | `emitWorkerLifecycle(row)` | `worker` row update. |
| `run:lifecycle` | `emitRunLifecycle(row)` | `composition-run` row update. |
| `session:lifecycle` | `emitSessionLifecycle(row)` | `worker-session` row update. **Drives auto-attach.** |

Subscribe with the raw bus fallback or, namespaced through a VM, with the `vm:` prefix:

```ts
useIFTTT('event:append', (e) => { /* every host-side event */ });
useIFTTT('vm:vmrun_001:event:append', (e) => { /* guest events only */ });
useIFTTT('match:event:append::/rm\\s+-rf/i', 'halt-run:reason=destructive');
```

Supervisor *action* channels — the DSL targets that the rule engine emits when a rule fires — are documented in `cart/app/db/MECHANICAL_WIRES.md`. Examples: `halt-run:<reason>`, `flag-pathology:<pathologyId>`, `invoke-verb:<verbId>`, `inject-message:<text>`, `queue-job:<jobId>`, `modify-assembly:<spec>`, `set-variable:<spec>`, `commit-state`.

## End-To-End Pipeline

1. A cart calls `useIFTTT(trigger, action)`.
2. The hook stores the latest action in a ref, creates a local `fire` function, and returns live metadata.
3. For a string trigger, `resolveTrigger(trigger)` selects the longest matching registry source. If none matches, the fallback subscribes to a raw bus channel of the same name.
4. For a composable trigger, `compileTrigger()` builds a tree of nodes and returns the same subscription shape as a registry source.
5. For a function trigger, React `useEffect` evaluates it after render and fires on false to true.
6. When a source fires, `fire(event)` increments the counter, records payload/time, executes the action, then forces a small state tick so the returned metadata updates.
7. String actions run through `substituteAction()` and `dispatchAction()`. Function actions receive the payload directly.

Bus mechanics:

```ts
busEmit('app:navigate', '/chat');
useIFTTT('app:navigate', (path) => nav.push(path));
```

`busEmit` is synchronous because it calls `ffi.emit()`. Zig-origin async domains usually call `globalThis.__ffiEmit(channel, payload)`, and `ffi.ts` defers listener dispatch with `setTimeout(0)` to avoid setState during host/event commit.

System signal path:

```text
SDL or per-frame poll
  -> framework/system_signals.zig or framework/clipboard_watch.zig
  -> v8_runtime.callGlobal("__beginJsEvent")
  -> v8_runtime.evalExpr("__ifttt_onSystemFoo(...)")
  -> runtime/hooks/useIFTTT.ts global handler
  -> ffi.emit("system:foo", payload)
  -> useIFTTT subscriber fire(payload)
  -> action
```

Key path:

```text
SDL_EVENT_KEY_DOWN / KEY_UP
  -> engine.zig packs (mod << 16) | (sym & 0xFFFF)
  -> __ifttt_onKeyDown(packed) / __ifttt_onKeyUp(packed)
  -> JS decodes SDL keycode + modifier mask
  -> emits __keydown / __keyup internal bus events
  -> key:* registry source filters by parsed key spec
```

Clipboard path:

```text
clipboard_watch.tick()
  -> SDL_GetClipboardText()
  -> Wyhash change detection
  -> __ifttt_onClipboardChange()
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

Then `runtime/index.tsx` requires `./hooks/useIFTTT` for side effects. The real handlers are installed once using `globalThis.__ifttt_handlers_installed`.

Core host bindings used by the hook:

| Host function | Registered in | Used for |
|---|---|---|
| `__clipboard_get` | `framework/v8_bindings_core.zig` | Clipboard trigger payload. |
| `__clipboard_set` | `framework/v8_bindings_core.zig` | Clipboard action. |
| `__sys_drop_path` | `framework/v8_bindings_core.zig` | File drop payload pull. |
| `__viewport_width` / `__viewport_height` | `framework/v8_bindings_core.zig` | Resize bridge seed. |
| `__fswatchAdd` / `__fswatchRemove` / `__fswatchDrain` | `framework/v8_bindings_core.zig` | `fs:*` sources. |
| `__proc_*` | `framework/v8_bindings_process.zig` | `proc:*` sources/actions. |

## Current Users

Representative cart usage:

- `cart/app/index.tsx` subscribes to `app:navigate` and routes bus payloads through `nav.push`.
- `cart/app/InputStrip.tsx` emits `app:navigate`.
- `cart/app/composer/page.tsx` uses key triggers for editor shortcuts.
- `cart/app/EffectProfilerOverlay.tsx` toggles on `key:ctrl+shift+f`.
- `cart/testing_carts/watchdog.tsx` combines `proc:ram`, `proc:idle`, and `system:hang`.
- `cart/app/isolated_tests/ifttt_test.tsx` is the manual trigger/action test surface.

## Legacy And Adjacent Code

- `framework/ifttt.zig` is generated from `framework/ifttt.mod.tsz`. It stores up to 64 framework-side rules with typed trigger/action unions and executes them from `init`, `tick`, `onKeyDown`, and `onKeyUp`.
- `framework/qjs_runtime.zig` embeds an older QuickJS IFTTT implementation. QJS is maintenance-only.
- `framework/lua/ifttt.lua` and `framework/ifttt_lua.mod.tsz` are LuaJIT-era rule engines. The repo direction is V8 + Zig/TS, not new Lua IFTTT work.

## Review Notes

- `click` is documented in the hook header and registered as a source, but current V8 code does not emit `__click`. Treat it as unfinished.
- `{ on, when }` does not pass payload into `when`. Use external refs/state in the predicate, or update the composer before relying on payload-aware gating.
- `state:*` shared state is module-local in-memory state. It is not SQLite/localstore-backed and does not survive process restart.
- Plain function triggers depend on render cadence. If a condition can change without rendering, use a composable function leaf or a bus event instead.
- `system:vram` only covers Linux DRM files exposing `mem_info_vram_total` and `mem_info_vram_used`; NVIDIA proprietary setups silently skip.
- System resize events are breakpoint-tier gated, not per-pixel resize streams.

## File Map

- Hook surface and built-ins: `runtime/hooks/useIFTTT.ts`
- Shared listener bus: `runtime/ffi.ts` (`subscribe` / `subscribeAll` / `emit`)
- Registry: `runtime/hooks/ifttt-registry.ts`
- Compositional triggers and action substitution: `runtime/hooks/ifttt-compose.ts`
- Process IFTTT registrations: `runtime/hooks/process.ts`
- File-watch IFTTT registrations: `runtime/hooks/useFileWatch.ts`
- Generic pattern source (`match:`): `runtime/hooks/ifttt-match.ts`
- VM boundary source (`vm:`) + per-VM bridge lifecycle: `runtime/hooks/ifttt-vm.ts`
- Vsock transport + channel-mirror helpers: `runtime/hooks/vsock.ts`
- Supervisor lifecycle emit helpers: `runtime/hooks/ifttt-supervisor.ts`
- Row-change → bus mapping: `cart/app/db/buses.ts`
- Auto-attach bridge (worker-session → vsock): `cart/app/db/vm-bridges.ts`
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
