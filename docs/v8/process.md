# V8 process runner pipeline

This is the end-to-end path for running subprocesses from a V8 cart.

There are three separate process runner surfaces:

```text
sync shell command:
  globalThis.__exec(cmd)
  -> framework/v8_bindings_env.zig execCmd()
  -> std.process.run(host.io, /bin/sh -c ...)
  -> blocking stdout capture
  -> string return

async shell command:
  execAsync(cmd)
  -> globalThis.__exec_async(cmd, requestId)
  -> framework/v8_bindings_core.zig hostExecAsync()
  -> framework/process/exec_async.zig std.Io.Group task
  -> std.process.spawn(io, /bin/sh -c ...) + readStreaming(io, ...)
  -> v8_app.zig per-frame tickDrain()
  -> __ffiEmit("exec:<requestId>", {"code":N,"stdout":"..."})
  -> Promise resolves

long-lived process:
  spawn(...) or useHost({kind:"process", ...})
  -> globalThis.__proc_spawn(JSON)
  -> framework/v8_bindings_process.zig hostSpawn()
  -> framework/process/process.zig spawnPiped(host.io, ...)
  -> std.process.spawn(io, ...) + std.Io pipe pumps
  -> v8_app.zig per-frame tickDrain()
  -> __ffiEmit("proc:stdout:<pid>", line)
  -> __ffiEmit("proc:stderr:<pid>", line)
  -> __ffiEmit("proc:exit:<pid>", {"code":N,"signal":null})
```

Use the shell exec APIs for one-shot commands. Use `spawn()` or
`useHost({kind:"process"})` for anything long-lived, interactive, or streaming.

## Source map

- `runtime/hooks/process.ts` is the direct JS API for child processes,
  `execAsync`, environment helpers, process stats, and process IFTTT sources.
- `runtime/hooks/useHost.ts` exposes the React hook wrapper for
  `useHost({kind:"process"})`.
- `runtime/ffi.ts` owns `callHost`, `callHostJson`, `hasHost`, `subscribe`,
  and `globalThis.__ffiEmit`.
- `runtime/hooks/useIFTTT.ts` imports `runtime/hooks/process.ts` for side
  effects so `proc:*` sources and actions register.
- `framework/v8_bindings_core.zig` registers `__exec_async` and drains finished
  async exec jobs.
- `framework/process/exec_async.zig` owns the injected-Io task group and bounded
  completed-result store for async shell commands.
- `framework/v8_bindings_env.zig` registers `__exec`, `__env_get`, `__env_set`,
  `__exit`, and `__getpid`.
- `framework/v8_bindings_process.zig` registers the `__proc_*` host functions,
  owns child entries, drains pipes, emits process events, and samples `/proc`.
- `framework/process/process.zig` owns native `std.process.spawn`, child wait
  tasks, bounded stdout/stderr pumps, registry cleanup, and signal delivery.
- `v8_app.zig` source-gates optional bindings and calls binding `tickDrain()`
  methods once per frame.
- `scripts/ship` and `scripts/ship-metafile-gate.js` decide which optional V8
  bindings are compiled into a shipped cart.

## Public JS API

Direct process helpers are exported from `@reactjit/runtime/hooks/process`:

```ts
import {
  spawn,
  kill,
  stdinWrite,
  stdinClose,
  onStdout,
  onStderr,
  onExit,
  run,
  execAsync,
  envGet,
  envSet,
  exit,
  procStat,
  watchProcess,
} from '@reactjit/runtime/hooks/process';
```

The long-running spawn shape:

```ts
interface SpawnOptions {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: 'pipe' | 'inherit' | 'ignore';
}
```

The direct helpers:

| API | Host function | Behavior |
| --- | --- | --- |
| `spawn(opts)` | `__proc_spawn(JSON.stringify(opts))` | Starts a child and returns a pid, or `0` on failure. |
| `kill(pid, signal?)` | `__proc_kill(pid, signal)` | Sends `SIGTERM` by default; `SIGKILL` is also recognized. |
| `wait(pid)` | `__proc_wait(pid)` | Declared in JS, but the V8 process binding does not currently register `__proc_wait`. |
| `stdinWrite(pid, data)` | `__proc_stdin_write(pid, data)` | Writes to child stdin if the child was spawned with `stdin:"pipe"`. |
| `stdinClose(pid)` | `__proc_stdin_close(pid)` | Closes the parent-side `std.Io.File`. |
| `onStdout(pid, fn)` | `proc:stdout:<pid>` subscription | Receives line strings. |
| `onStderr(pid, fn)` | `proc:stderr:<pid>` subscription | Receives line strings. |
| `onExit(pid, fn)` | `proc:exit:<pid>` subscription | Receives `{ code, signal }`; signaled/stopped terms include a `SIG*` name. |
| `run(cmd, args?)` | wrapper around `spawn` | Collects stdout/stderr lines until exit and resolves `{ code, stdout, stderr }`. |
| `execAsync(cmd)` | `__exec_async(cmd, rid)` | Runs a shell command in an injected-Io task and resolves `{ code, stdout }`. |
| `envGet(name)` | `__env_get(name)` | Reads the host process environment; returns string or null. |
| `envSet(name, value)` | `__env_set(name, value)` | Sets an environment variable in the host process. |
| `exit(code?)` | `__exit(code)` | Exits the host process. |
| `procStat(pid)` | `__proc_stat(pid)` | Reads one Linux `/proc` sample, or returns null. |
| `watchProcess(pid, intervalMs?)` | `__proc_watch_add/remove` | Refcounted sampler for `proc:ram` and `proc:cpu` events. |

The `useHost` process wrapper:

```ts
const child = useHost({
  kind: 'process',
  cmd: 'node',
  args: ['server.js'],
  cwd: '/path/to/project',
  stdin: 'pipe',
  onStdout(line) {},
  onStderr(line) {},
  onExit(result) {},
});

child.pid;
child.state;       // 'starting' | 'running' | 'stopped' | 'error'
child.stdin('x\n');
child.stdinClose();
child.kill('SIGTERM');
child.stop();
```

## Shell exec path

`__exec(cmd)` is the synchronous shell command primitive registered by
`framework/v8_bindings_env.zig`.

```text
JS calls globalThis.__exec(cmd)
  -> v8_bindings_env.execCmd()
  -> std.process.run(page_allocator, host.io, {
       argv = ["/bin/sh", "-c", command],
       stdout_limit = 64 KiB,
       stderr_limit = 64 KiB,
       environ_map = host.environ,
     })
  -> return stdout string
```

Important behavior:

- It blocks the JS/UI frame for the whole command runtime.
- The native run captures both streams with 64 KiB limits, but the host function
  returns only stdout. Redirect stderr explicitly when the caller needs it.
- The exit status is ignored. Empty output and command failure both return an
  empty string.
- The command is intentionally interpreted by `/bin/sh -c`.

Use it only for tiny commands where blocking the frame is acceptable.

## Async exec path

`execAsync(cmd)` is the Promise wrapper around `__exec_async`.

```text
runtime/hooks/process.ts execAsync(cmd)
  -> allocate request id: x<N>:<Date.now()>
  -> subscribe("exec:<rid>", handler)
  -> callHost("__exec_async", cmd, rid)
  -> v8_bindings_core.hostExecAsync()
  -> process/exec_async.Executor.spawn(rid, cmd)
  -> std.Io.Group task:
       std.process.spawn(io, ["/bin/sh", "-c", cmd])
       readStreaming(io, ...) stdout into a capped ArrayList
       child.wait(io)
       publish an owned result into a bounded completed-result store
  -> v8_bindings_core.tickDrain()
  -> exec_async.drain(emitExecResult)
  -> __ffiEmit("exec:<rid>", JSON)
  -> JS listener parses JSON and resolves
```

`__exec_async` lives in the always-on core binding, not the optional process
binding. That is why `execAsync()` can work even when `__proc_*` is not shipped.

Important behavior:

- It captures stdout only; stderr is inherited by the host process.
- The command is shell-interpreted by `/bin/sh -c`.
- Captured stdout is capped at 4 MiB.
- The emitted `code` comes from `std.process.Child.Term`: normal exits use their
  exit code, while signal/stopped terms are returned as negative signal numbers.
- The executor admits at most 32 in-flight commands and holds at most 64
  completed results pending a frame drain.
- Listener dispatch still goes through `__ffiEmit` and `setTimeout(0)`, so the
  Promise resolves on a later JS tick after the native drain.

If `__exec_async` is missing, `execAsync()` falls back to `globalThis.__exec`
when present, then resolves `{ code:0, stdout }`; otherwise it resolves
`{ code:-1, stdout:'' }`.

## Piped process path

`spawn()` and `useHost({kind:"process"})` both serialize a `SpawnOptions` object
and call `__proc_spawn`.

```text
JS SpawnOptions
  -> JSON.stringify({cmd,args,cwd,env,stdin})
  -> v8_bindings_process.hostSpawn()
  -> hand-parse cmd/cwd/stdin and args array
  -> process.spawnPiped(alloc, host.io, {
       argv: [cmd, ...args],
       cwd: cwd path or inherit,
       environ_map: host.environ,
       stdin: pipe | ignore | inherit,
       stdout: pipe,
       stderr: pipe,
     })
```

In `framework/process/process.zig`, `spawnPiped()` stays on Zig 0.16's native
process and I/O model:

```text
std.process.spawn(io, SpawnOptions)
  -> optional stdin/stdout/stderr std.Io.File values
  -> one cancelable std.Io.Group reader task per output pipe
       readStreaming(io, ...)
       put bytes into a fixed 128 KiB std.Io.Queue
  -> one std.Io.Group waiter task owns child.wait(io)
       publish native Child.Term + signal an std.Io.Event
  -> return PipedProcess { process, stdin, stdout pump, stderr pump }
```

The tasks are allowed to block inside the injected `std.Io` capability. Queue
capacity supplies backpressure. The frame thread never changes descriptor flags
and never probes raw fds for readiness.

`v8_bindings_process.zig` stores each child in `g_entries`:

```zig
Entry {
  pid,
  piped: process.PipedProcess,
  out_buf: [65536]u8,
  out_len,
  err_buf: [65536]u8,
  err_len,
}
```

On every native frame, `tickDrain()`:

1. Drains bytes already available in each child's stdout queue without waiting.
2. Emits each complete newline-terminated line on `proc:stdout:<pid>`.
3. Drains and emits stderr the same way on `proc:stderr:<pid>`.
4. Flushes a full 64 KiB partial line as one event.
5. Reads the atomic state published by the native child-wait task.
6. After the child terminates and both pipe queues reach EOF, flushes trailing
   partial stdout/stderr text.
7. Emits `proc:exit:<pid>` from the native `Child.Term`.
8. Removes the entry, cancels/joins owned I/O tasks, closes files, and
   closes/deregisters the process handle.

No raw `waitpid(..., WNOHANG)` status decoder is involved. Normal exit codes and
signals come directly from `std.process.Child.Term`.

## Event delivery

Process events use the same FFI event bus as other V8 host bindings:

```text
Zig:
  v8_runtime.callGlobal2Str("__ffiEmit", channel, payload)

JS:
  subscribe(channel, fn)
  __ffiEmit(channel, payload) {
    setTimeout(() => dispatchListeners(channel, payload), 0)
  }
```

That means process stdout/stderr/exit callbacks do not run synchronously inside
native `tickDrain()`. They run on a later JS timer turn.

Raw channels:

| Channel | Payload |
| --- | --- |
| `proc:stdout:<pid>` | stdout line string, without the newline |
| `proc:stderr:<pid>` | stderr line string, without the newline |
| `proc:exit:<pid>` | JSON string shaped like `{ "code": number, "signal": string \| null }` |
| `proc:ram:<pid>` | JSON string shaped like `{ pid, id, rss, vsize, memTotal, percent }` |
| `proc:cpu:<pid>` | JSON string shaped like `{ pid, id, utime, stime, delta, intervalMs }` |
| `exec:<rid>` | JSON string shaped like `{ code, stdout }` |

## Process stats and watchers

`procStat(pid)` and `watchProcess(pid)` are Linux `/proc` features implemented
in `framework/v8_bindings_process.zig`.

One-shot stat path:

```text
procStat(pid)
  -> __proc_stat(pid)
  -> read /proc/<pid>/status for VmRSS and VmSize
  -> read /proc/<pid>/stat for utime and stime
  -> read /proc/meminfo for MemTotal
  -> return JSON or null
```

Watcher path:

```text
watchProcess(pid, intervalMs)
  -> JS refcount map
  -> __proc_watch_add(pid, max(100, intervalMs))
  -> v8_bindings_process tickWatches()
  -> readProcSample(pid)
  -> emit proc:ram and proc:cpu events when samples change
  -> release() calls __proc_watch_remove(pid) when refcount reaches zero
```

Watcher behavior:

- Watches can target arbitrary pids, not only children spawned by this binding.
- The JS API clamps intervals to at least 100 ms.
- The Zig watcher also clamps intervals to at least 100 ms.
- The first valid sample emits a RAM event.
- Later RAM events emit only on noticeable RSS change: at least 1 MiB or at
  least 0.5 percent of total memory.
- CPU events emit when user/system CPU ticks advance.
- If `/proc` is unavailable or the pid disappears, `procStat` returns null and
  watcher samples are skipped.

The `percent` field is RSS divided by total memory, emitted as a decimal
fraction. For example, `0.125` means 12.5 percent.

## Process IFTTT API

`runtime/hooks/process.ts` registers process sources and actions for
`useIFTTT`.

Sources:

| Source spec | Meaning |
| --- | --- |
| `proc:line:<pid>:<regex>` | Fires when a stdout line matches the regex. |
| `proc:ram:<pid>` | Fires on each emitted RAM sample. |
| `proc:ram:<pid>:>:<threshold>` | Fires when RSS or memory fraction is above a threshold. |
| `proc:ram:<pid>:<:<threshold>` | Fires when RSS or memory fraction is below a threshold. |
| `proc:cpu:<pid>` | Fires when CPU ticks advance. |
| `proc:idle:<pid>:<ms>` | Fires when there is no CPU/stdout/stderr activity for the requested time. |

RAM thresholds accept fractions, percentages, and byte units:

```text
0.80    fraction of system RAM
5%      percent of system RAM
50MB    absolute RSS threshold
2GB     absolute RSS threshold
512KB   absolute RSS threshold
```

Actions:

| Action spec | Meaning |
| --- | --- |
| `proc:spawn:<cmd>` | Spawns a child with no args and drops the resulting pid. |
| `proc:kill:<pid>` | Sends `SIGTERM`. |
| `proc:write:<pid>:<text>` | Writes text to child stdin. |

The idle source is JS-derived. It arms `watchProcess(pid)`, starts a timer,
and resets that timer whenever any of these events arrive:

```text
proc:cpu:<pid>
proc:stdout:<pid>
proc:stderr:<pid>
```

## Build and registration

`__exec_async` is registered by the always-on core binding:

```text
v8_bindings_core.registerCore()
  -> __exec_async
```

`__exec`, `__env_get`, `__env_set`, `__exit`, and `__getpid` are registered by
the required environment ingredient:

```text
v8_bindings_env.registerEnv()
  -> __exec
  -> __env_get
  -> __env_set
  -> __exit
  -> __getpid
```

The long-running process binding is optional:

```text
v8_app.zig ingredient "process"
  -> -Dhas-process=true
  -> v8_bindings_process.registerProcess()
  -> __proc_spawn
  -> __proc_kill
  -> __proc_stdin_write
  -> __proc_stdin_close
  -> __proc_stat
  -> __proc_watch_add
  -> __proc_watch_remove
```

Current ship gate behavior:

- `scripts/ship-metafile-gate.js` reads the esbuild metafile and consults
  `sdk/dependency-registry.json`.
- The current registry maps `runtime/hooks/useHost.ts` to `has-process`,
  `has-httpsrv`, `has-wssrv`, and `has-net`.
- `scripts/ship` therefore enables `__proc_*` when `useHost.ts` is shipped.
- `runtime/hooks/process.ts` itself is marked side-effectful in
  `runtime/package.json` because it registers IFTTT sources.

Sharp edge: a cart that imports only `runtime/hooks/process.ts` may include the
JS process API without causing `has-process` to be enabled by the current
dependency registry. `execAsync()`, `envGet()`, `envSet()`, `exit()`, and sync
`__exec` are always registered; `spawn()`, `procStat()`, and `watchProcess()`
still depend on the optional process ingredient.

## Child ownership and cleanup

`framework/process/process.zig` keeps a small child registry:

```text
/tmp/tsz_children_<parent_pid>
```

Every spawned child is registered. The registry supports cleanup on host exit
or crash watchdog cleanup.

`Process.closeProcess(io)` does:

```text
if still running:
  SIGTERM
  wait up to about 200 ms
  SIGKILL if still alive
wait for the std.Io.Event published by the child.wait(io) task
join the owned std.Io.Group

deregister(pid)
```

Raw POSIX is limited here to sending a selected signal without taking wait/reap
ownership away from the native child task. Spawn, wait, sleep, files, and
registry-file I/O all use the injected `std.Io` capability.

The V8 process binding calls this when removing a child entry after exit and
also when tearing down an entry.

`useHost({kind:"process"})` also sends `SIGTERM` from its React cleanup when the
component unmounts or the process spec changes.

## Current implementation notes

- `wait(pid)` is present in the JS API, but V8 does not register
  `__proc_wait`.
- `SpawnOptions.env` is serialized by JS but currently ignored by
  `v8_bindings_process.hostSpawn()`. The child receives the root host environment
  map; the V8 JSON parser does not overlay the per-call entries yet.
- `stdin:"pipe"`, `stdin:"inherit"`, and `stdin:"ignore"` map to the matching
  native `std.process.SpawnOptions` behavior.
- Stdout and stderr are always piped for `__proc_spawn`.
- Args are parsed by a small hand-rolled JSON string-array parser, not a full
  JSON parser.
- The V8 process binding builds a fixed argv buffer for at most 1024 args.
- Pipe line buffers are 64 KiB per stream per child. A longer line is emitted
  as a partial line when the buffer fills.
- Stdout/stderr events are text line events. Binary protocols should use a
  dedicated transport instead.
- `stdinWrite()` uses `std.Io.File.writeStreamingAll(host.io, bytes)` and returns
  true only when the full write succeeds.
- `kill(pid)` only searches the V8 process binding's child entries. Process
  watchers can sample arbitrary pids, but `__proc_kill` cannot kill arbitrary
  pids that were not spawned by the binding.
- `SIGKILL` maps to kill. Any other signal string maps to SIGTERM.
- `proc:exit` emits native exited/signaled/stopped terms; signal terms include a
  `SIG*` string and use `code:-1`.
- `__exec` and `__exec_async` are shell-command APIs. Do not pass unsanitized
  user text into them.

## Which API to use

Use `execAsync(cmd)` for one-shot UI actions such as:

- `git status --short`
- `ls`
- fingerprinting a file with a shell command

Use `run(cmd, args)` for short commands where you want separated stdout and
stderr but still want the direct child-process path.

Use `spawn(opts)` for manual long-lived process control.

Use `useHost({kind:"process"})` when process lifetime should follow React
component lifetime and stdout/stderr/exit should flow into component callbacks.

Use `watchProcess()` or `useIFTTT("proc:*", ...)` for RAM/CPU/idle watchdog
behavior.
