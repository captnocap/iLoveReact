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
| `system:selection` | `{ text, textLen, downX, downY, upX, upY, screenW, screenH, at }` | OS-level text selection captured via `__ifttt_onSystemSelection`. |
| `system:selection:cleared` | `{ at }` | Selection cleared. |

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

## Selection And Clipboard Sources

`useIFTTT.ts` imports `runtime/hooks/system_selection.ts` for side-effect registration. Five sources sit on top of the raw `system:selection` / `system:selection:cleared` / `system:clipboard` channels documented above:

| Trigger | Payload | Notes |
|---|---|---|
| `select:cleared` | `{ at }` | Direct alias for `system:selection:cleared`. |
| `select:any` | full selection event | Direct alias for `system:selection`. |
| `select:nonempty` | full selection event | Filters out events where `text.length === 0`. |
| `select:long:<min>` | full selection event | Filters out events where `text.length < min`. Useful for "user highlighted a paragraph or more." |
| `clipboard:copy` | `{ text, at }` | Re-fired form of `system:clipboard` for parity with `select:*`; only fires for non-empty clipboard text. |

Examples:

```ts
useIFTTT('select:long:200', (e) => showQuickActions(e.text));
useIFTTT('clipboard:copy', (e) => recentClips.push(e.text));
```

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

## Stateful Aggregation Sources

Three primitives that hold state across emits. They build on the underlying bus and `match:` semantics; together they cover most pathology / verify-loop detection shapes that single-event sources can't.

### `count:<channel>::<n>:<windowMs>`

Edge-triggered windowed counter. Fires when the underlying channel has accumulated ≥ N events within the trailing windowMs. Fires **once on the transition** from <N to ≥N — won't re-fire until the count drops back below N and climbs again. For periodic re-fires while the count stays elevated, wrap with `{ trigger, cooldown: <ms> }`.

Fire payload:

```ts
{ channel: string; count: number; n: number; windowMs: number; payload: any; at: number }
```

Examples:

```ts
// Investigation addiction: 6 Reads in 30s
useIFTTT('count:event:append.tool_use.Read::6:30000', 'flag-pathology:pat_X');

// Stdout spam from a worker process
useIFTTT(
  { trigger: 'count:proc:stdout:1234::100:1000', cooldown: 10_000 },
  'notify-user:agent is spamming stdout',
);

// 3 guest events in 5s
useIFTTT('count:vm:abc:event:append::3:5000', (e) => console.log(e));
```

Source file: `runtime/hooks/ifttt-count.ts`.

### `firsthit:<channel>::<pattern>`

Same wire format and semantics as `match:` (regex `/source/flags` or literal substring; payload search via JSON.stringify; same fire shape) — except the subscription auto-unsubscribes after the first match. Useful for **session-first** detection like "loss narrative without recovery check": the rule fires once per scope, never repeats. Re-arming is implicit per useIFTTT subscription — a fresh subscribe creates a fresh fired-flag.

```ts
useIFTTT('firsthit:vm:abc:event:append::work was destroyed',
  'kick-to-supervisor:check_recovery_first');
```

Source file: `runtime/hooks/ifttt-firsthit.ts`.

### `repeat:<channel>::<lookback>:<minSim>`

Fires when an emit's text closely matches an earlier emit on the same channel. Catches the "claim shape didn't change after acknowledgment" pattern (multi-turn perf-ack, apology-without-change).

- `<channel>` — bus channel; may contain colons.
- `<lookback>` — integer; how many recent emits to compare against.
- `<minSim>` — float in `(0, 1]`. Jaccard similarity on normalized 4-character shingles. `~0.6` catches paraphrased repeats; `~0.85` catches rephrasings of the same sentence; `1.0` exact match.

Fire payload:

```ts
{
  channel: string;
  current: { text: string; payload: any };
  prior:   { text: string; payload: any };
  similarity: number;        // 0..1
  indexInLookback: number;   // 0 = oldest in window
}
```

Examples:

```ts
// Multi-turn performative acknowledgment: a near-duplicate claim within the last 5 emits.
useIFTTT('repeat:vm:abc:event:append::5:0.7',
  'flag-pathology:pat_acknowledgment_without_recalibration');

// Apology-without-change: any near-repeat in the last 3 turns.
useIFTTT('repeat:vm:abc:event:append::3:0.65',
  'kick-to-supervisor:apology_streak');
```

Companion helper:

```ts
import { similarity } from '@reactjit/runtime/hooks/ifttt-repeat';
similarity('the fix is in', 'fixed it now');  // → 0.31
```

Source file: `runtime/hooks/ifttt-repeat.ts`. Implementation is model-free (Jaccard on 4-shingles, normalized to lowercase / collapsed whitespace / non-word stripped). When a semantic-similarity primitive lands, `repeat:semantic:<...>` will register as a sibling.

### `registerGate({ after, suspect, requires, key?, onFire })`

Programmatic stateful gate — the "after-X-then-Y-unless-Z-in-between" shape. Three channels:

- `after` — opens a verification window when one of its emits arrives.
- `suspect` — fires the gate when an emit lands and no `requires` event has closed the window since the most recent `after`.
- `requires` — closes the window without firing.

Each channel takes an optional filter function (richer than a single regex) and a shared `key(payload)` extractor lets per-file / per-pid / per-id windows coexist.

```ts
import { registerGate } from '@reactjit/runtime/hooks/ifttt-gate';

// Manifest-as-truth: Edit on file F, then claim "fixed", with no Bash event in between.
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

// later: dispose() to tear down all three subscriptions.
```

Default behavior is **one fire per after-window**: the gate disarms after firing and re-arms when a fresh `after` event lands. Pass `reArmOnFire: true` to keep firing every suspect that arrives until a `requires` closes the window.

Why programmatic instead of a DSL spec: the three channels typically need filter functions richer than a single regex, and the key extractor usually inspects payload structure. A spec-string DSL would push that complexity into escaping. Callers can still drive this declaratively — a binder can call `registerGate` once per row of a Pathology dictionary or a verify-rule table.

Source file: `runtime/hooks/ifttt-gate.ts`.

## Turn Boundary Channels

`runtime/hooks/turn-tracker.ts` canonicalizes Claude Code phase events into per-turn boundaries:

| Channel | Payload | Trigger |
|---|---|---|
| `turn:start` | `{ at, turnId, phase: 'session-start' \| 'user-prompt' \| 'unknown' }` | `system:claude:session-start` or `system:claude:user-prompt`. |
| `turn:tool-use` | `{ at, turnId, name, count }` | every `system:claude:pre-tool` — fires per tool call with the running per-turn count. |
| `turn:end` | `{ at, turnId, count, tools, durationMs }` | `system:claude:stop`. |
| `turn:tool-count` | `{ count, name, turnId }` | IFTTT-source alias for `turn:tool-use` (designed as a leaf in composables). |

Examples:

```ts
// End_turn-as-API: the agent stopped after exactly one tool call.
useIFTTT(
  { all: ['turn:end', () => (currentTurn()?.count ?? 0) <= 1] },
  'flag-pathology:pat_premature_stop',
);

// Performative acknowledgment within a single turn: "you're right" + "that said"
// + a near-duplicate of the last claim, all between turn:start and turn:end.
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

If the Claude Code hook fanout hasn't been wired yet (no `system:claude:*` events on the bus), the tracker silently no-ops. When an agent emits a `system:claude:pre-tool` with no preceding `start`, the tracker synthesizes a `turn:start` with `phase: 'unknown'` so the count isn't lost.

`currentTurn()` returns the in-progress turn state for caller-side conditionals (used in the `useIFTTT` `() => boolean` example above).

Source file: `runtime/hooks/turn-tracker.ts`.

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

### Three-tier transport selection

`openVsock(opts)` picks among three implementations of the same `VsockTransport` interface so caller code never branches:

| Tier | When | Transport | Behavior |
|---|---|---|---|
| 1 | `__vsock_open` registered | `HostFnTransport` (production) | Real AF_VSOCK over the Zig binding. |
| 2 | No Zig binding + caller passed `vmid` | `LocalPairTransport` (dev / tests) | Two `openVsock` calls in the same process with matching `vmid` and opposite `kind` route to each other in-memory via `queueMicrotask`. Lights up the entire host↔guest mirror without a VM. |
| 3 | No Zig binding + no `vmid` | `NullTransport` | Warns once, drops sends. Keeps cart imports safe in early-init paths. |

Force a tier with `opts.transport: 'host' | 'localpair' | 'null'`; default is `'auto'` (1 → 2 → 3).

The Zig binding contract lives at `framework/v8_bindings_vsock.zig`. **It is currently a stub — the file is not registered in `build.zig`** so vsock.ts falls through to LocalPair. Activate by filling the `TODO(af-vsock)` blocks and registering `registerVsock` next to `registerEventBus` in the V8 init path.

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

## Claim Ledger & Verify-Loop

The bus + `match:` + `registerGate` triad is enough to *detect* most pathology shapes. Closing the verify-loop — making the agent come back and check — needs one more piece: a **Claim ledger**. The ledger holds an unresolved claim across the bus event stream and a forward-action gate emits `inject-message` when the agent moves on without verifying.

The entity is `cart/app/gallery/data/core/claim.ts`. Each row carries:

```ts
{
  id, sessionId, workerId?, vmid?, parentClaimId?,
  claimText, detectedFrom, kind,
  scope?,
  requiredEvidence: ClaimEvidenceKind[],   // any one resolves; requireAll for AND
  evidence: ClaimEvidenceRecord[],          // observed evidence so far
  status: 'unverified' | 'verified' | 'rejected' | 'expired',
  resolution?, resolvedAt?, resolutionNote?,
  injectTemplate?,                          // prompt-back template
  detectedAt, updatedAt,
}
```

### Auto-running engine

`cart/app/db/claim-engine.ts` subscribes to `session:lifecycle` and runs detection per active session. Imported through the package barrel:

```ts
import { installClaimEngine, listOpenClaims, resolveClaim } from '@reactjit/cart/app/db';
installClaimEngine();
```

For each `session:lifecycle status='running'` event the engine attaches a detector to the right `event:append` channel — host-side or `vm:<vmid>:event:append` if the session has a vmid. On session terminate it tears the detector down and expires every unresolved claim it owned.

### What it detects today

The default ruleset is intentionally inline + small — promote to a `ClaimRule` entity once stable. Each rule pairs a regex against the bus payload (JSON-stringified) with the evidence kinds that resolve it:

| `ClaimKind` | Pattern (case-insensitive) | Required evidence |
|---|---|---|
| `fix` | `fix(ed)?`, `the bug is gone`, `should be silenced`, `that should do it` | build-success, run-success |
| `ship` | `shipped`, `the work is in`, `landed`, `merged` | build-success, test-pass |
| `works` | `works (now)?`, `try it (now)?`, `good to go` | run-success |
| `cause` | `the cause is`, `happens because`, `the reason is`, `root cause is` | stack-trace, repro-run |
| `recovery` | `work was destroyed`, `unrecoverable`, `lost forever` | reflog-read |
| `pre-existing` | `pre-existing` / `preexisting` | log-grep |
| `completion` | `all done`, `all <n> tasks fixed`, `all steps complete` | test-pass, run-success |

### What it credits as evidence

Evidence detection runs against the same `event:append` payloads, looking for tool-use shapes:

| `ClaimEvidenceKind` | Triggered when payload contains | Credits |
|---|---|---|
| `build-success` | `Bash` tool-use with `zig build` / `cargo build` / `npm build` and `exitCode: 0` | fix, ship |
| `test-pass` | `Bash` with `zig test` / `cargo test` / `npm test` / `pytest` / `go test` and exit 0 / "passed" | ship, completion |
| `run-success` | `Bash` with any command and exit 0 | works, fix, completion |
| `reflog-read` | `Bash` with `git reflog` | recovery |
| `log-grep` | `Bash` with `git log --follow` / `git blame` | pre-existing |
| `stack-trace` | `Read` of a `.log` / `stderr` / panic / Traceback | cause |
| `repro-run` | `Bash` invoking `./` / `bash` / `sh` with an exit | cause |

### The loop

```text
1. agent emits "fixed" on event:append
2. claim-engine matches DEFAULT_RULES.fix → inserts Claim {
     status: 'unverified',
     requiredEvidence: ['build-success', 'run-success'],
     injectTemplate: 'You said "{claim}". No evidence ({requiredEvidence})...'
   }
3. claim-engine emits 'claim:opened:<id>' to seed the verify-gate window
4. registerGate watches the same event:append channel:
     - suspect = any tool_use that isn't an evidence event
     - requires = an event matching one of requiredEvidence
5a. agent runs `zig build && ./bin` (exit 0)  → engine credits evidence,
    if requireAll satisfied (or any) → status='verified', gate disposes
5b. agent emits another forward action with no evidence → gate fires,
    emits 'vm:<vmid>:supervisor:inject-message' with the filled template
6. worker shell cart receives supervisor:inject-message, writes the
   prompt back into the agent process via stdin
7. agent re-prompts itself → runs verification → step 5a closes the loop
```

The injected message uses `{claim}` / `{scope}` / `{requiredEvidence}` substitutions from the row's `injectTemplate`. Override per row to customize the prompt-back.

### `claim:lifecycle` channel

Every status transition emits on `claim:lifecycle`:

```ts
useIFTTT('claim:lifecycle', (e) => {
  if (e.status === 'unverified') /* show in supervisor surface */;
  if (e.status === 'expired') /* aged-out, surface for retro */;
});
```

A useCRUD write on a `claim` row also emits this channel, via `emitClaimLifecycle` in `cart/app/db/buses.ts`.

### Manual resolution

The supervisor surface or a higher-priority rule can resolve a claim without bus evidence:

```ts
resolveClaim('claim_001', 'supervisor-overrode', 'shipping the ack manually');
resolveClaim('claim_002', 'rule-rejected',      'a higher-priority pathology fired');
```

### Subagent inheritance

A child worker's claim chains via `parentClaimId`. The semantics — "a parent only resolves when every descendant resolves" — are captured in the entity reference (`claimReferences` in `claim.ts`) but not yet enforced by the engine. Add the inheritance walk when subagent claim-binding lands.

### Files

- Entity: `cart/app/gallery/data/core/claim.ts`
- Engine: `cart/app/db/claim-engine.ts`
- Bucket assignment: `cart/app/db/registry.ts` (`'claim': 'supervisor-sweatshop'`)
- Row → bus mapping: `cart/app/db/buses.ts`
- Emit helper: `runtime/hooks/ifttt-supervisor.ts` (`emitClaimLifecycle`)

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
| `claim:lifecycle` | `emitClaimLifecycle(row)` | `claim` row update. **Drives the verify-loop UI** — see Claim Ledger section above. |

Subscribe with the raw bus fallback or, namespaced through a VM, with the `vm:` prefix:

```ts
useIFTTT('event:append', (e) => { /* every host-side event */ });
useIFTTT('vm:vmrun_001:event:append', (e) => { /* guest events only */ });
useIFTTT('match:event:append::/rm\\s+-rf/i', 'halt-run:reason=destructive');
```

### Supervisor source specs (kind-filtered)

`runtime/hooks/ifttt-supervisor.ts` registers five **kind-filtered prefixes** on top of the raw lifecycle channels above. Each one watches the underlying channel and only fires when a row's identifying field matches the spec, with `.*` for suffix-wildcards:

| Spec form | Underlying channel | Matches when | Example |
|---|---|---|---|
| `event:<kind>` | `event:append` | `row.kind === '<kind>'` | `event:tool-call.dispatched` |
| `event:<prefix>.*` | `event:append` | `row.kind` starts with `<prefix>.` | `event:tool-call.*` |
| `rule:<ruleId>.fired` | `rule:fired` | `row.ruleId === '<ruleId>'` | `rule:smoke.fired` |
| `verb:<verbId>.<status>` | `verb:lifecycle` | `verbId` and `status` both match. Status: `started` / `succeeded` / `failed` / `timed-out` / `killed` | `verb:verb_build_dev.completed` |
| `worker:<workerId>.<lifecycle>` | `worker:lifecycle` | `workerId` and `lifecycle` both match. Lifecycle: `spawning` / `active` / `idle` / `streaming` / `suspended` / `terminating` / `terminated` / `crashed` | `worker:w1.streaming` |
| `run:<runId>.<status>` | `run:lifecycle` | `runId` and `status` both match. Status from `CompositionRunStatus` | `run:cr_001.stage2-executing` |

Suffix-wildcard semantics: `task.*` matches `task.X` for any `X` (one segment). Comma-list isn't supported here; express OR by binding the same action to multiple specs.

```ts
// Any tool-call event from any worker
useIFTTT('event:tool-call.*', (e) => observability.tool(e));

// A specific verb completion
useIFTTT('verb:verb_build_dev.completed', 'queue-job:job_promote');

// One worker entering streaming state
useIFTTT('worker:w1.streaming', 'log:w1 is live');
```

### Supervisor actions

`ifttt-supervisor.ts` also registers thirteen action prefixes. Each emits a normalized `supervisor:<kind>` bus event (carts subscribe to persist as rows; tests subscribe to assert without a DB):

| Action | Emits on | Behavior |
|---|---|---|
| `halt-run` | `supervisor:halt-run` | `{ reason, triggerPayload }`. Halts the active CompositionRun. |
| `halt-run:<reason>` | same | Reason is the rest of the spec; trigger payload still attached. |
| `flag-pathology:<pathologyId>` | `supervisor:flag-pathology` | Inserts a pending `pathology-detection` row through the writer side. |
| `invoke-verb:<verbId>` | `supervisor:invoke-verb` | Dispatches a verb. Trigger payload attached as args. |
| `fire-rule:<ruleId>` | `supervisor:fire-rule` + `rule:fired` | Synthesizes a rule firing — used to compose rules from rules. |
| `kick-to-supervisor` | `supervisor:kick-to-supervisor` | Routes the agent's next step through the supervisor for review. |
| `notify-user:<text>` | `supervisor:notify-user` | Surfaces a notification in the cockpit. |
| `inject-message:<text>` | `supervisor:inject-message` | Writes back into the agent's stdin via the worker shell cart. **The verify-loop's prompt-back action.** |
| `spawn-worker:<role>` | `supervisor:spawn-worker` | Adds a worker to the active crew. |
| `modify-assembly:<spec>` | `supervisor:modify-assembly` | Mutates the active prompt assembly mid-run. |
| `set-variable:<spec>` | `supervisor:set-variable` | Sets a run-scoped variable. |
| `commit-state` | `supervisor:commit-state` | Snapshots the current state to the run's history. |
| `mark-status:<spec>` | `supervisor:mark-status` | Updates a status field on the active run. |
| `queue-job:<jobId>` | `supervisor:queue-job` | Enqueues a job. |

These are first-class targets for any `useIFTTT` binding — for example a Pathology row's consequence becomes:

```ts
useIFTTT(
  'match:vm:abc:event:append::/pkill\\s+-f/i',
  'flag-pathology:pat_session_kill_pattern',
);
```

The receiver side — what actually persists / dispatches when these `supervisor:*` events land — is documented in `cart/app/db/MECHANICAL_WIRES.md`.

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
- Windowed counter source (`count:`): `runtime/hooks/ifttt-count.ts`
- Single-shot pattern source (`firsthit:`): `runtime/hooks/ifttt-firsthit.ts`
- Programmatic stateful gate (`registerGate`): `runtime/hooks/ifttt-gate.ts`
- Claim-shape similarity source (`repeat:`): `runtime/hooks/ifttt-repeat.ts`
- Turn boundary tracker (`turn:start` / `turn:end` / `turn:tool-use`): `runtime/hooks/turn-tracker.ts`
- Production vsock binding contract (stub, not yet registered): `framework/v8_bindings_vsock.zig`
- VM boundary source (`vm:`) + per-VM bridge lifecycle: `runtime/hooks/ifttt-vm.ts`
- Vsock transport + channel-mirror helpers: `runtime/hooks/vsock.ts`
- Supervisor lifecycle emit helpers: `runtime/hooks/ifttt-supervisor.ts`
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
