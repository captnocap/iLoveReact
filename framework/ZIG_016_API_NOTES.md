# Zig 0.16 API — the pointers that aren't in any LLM's training data

**Read this before "fixing" any std call in `framework/`.** This repo migrated from
Zig 0.15.2 → 0.16.0 (branch landed 2026-07-18, req_3153). 0.16 shipped April 2026,
*after* the training cutoff of every model that works here — so an agent's instinct for
"correct" std usage is the 0.15 API, and blindly applying it will REVERT this migration.
When a call below looks wrong to you, it isn't; 0.16 changed it. Grep the real std source
to confirm: **the compiler at `tools/zig/zig` is the authority** (its `lib/std/`).

## The one big idea: I/O is an injected capability now

0.16 moved everything that blocks — fs, net, time, sleep, process spawn, randomness —
behind an `std.Io` handle you pass as the first argument, exactly like an allocator.
This repo does NOT thread it through signatures. Instead:

- **`framework/host_io.zig`** is the hub. It rides std's own process-wide instance
  (`std.Io.Threaded.global_single_threaded`), so `host_io.io()` works everywhere with
  zero entry-point wiring. Import it by relative path (`../host_io.zig` by depth).
- Files compiled as **standalone module roots or dual-context** (both an app member AND a
  test root — compiler error "import of file outside module path") can't import the hub.
  They use `std.Io.Threaded.global_single_threaded.io()` directly, or an inline shim
  (copy from `framework/fs/app_config.zig`). SAME instance either way.

## host_io.zig provides these 0.15-shaped shims (use them; don't reinvent)

| deleted 0.15 API | use instead |
|---|---|
| `std.time.milliTimestamp()` / micro / nano / timestamp | `host_io.milliTimestamp()` … (same names) |
| `std.time.Timer` | `host_io.Timer` |
| `std.Thread.Mutex` | `host_io.Mutex` (rides `std.Io.Mutex.lockUncancelable`) |
| `std.Thread.sleep(ns)` | `host_io.sleep(ns)` |
| `std.posix.getenv(name)` | `host_io.getenv(name)` (libc-backed) |
| `std.process.getEnvVarOwned(a,name)` | `host_io.getEnvVarOwned(a,name)` |
| `std.process.argsAlloc/argsFree` | `host_io.argsAlloc/argsFree` (main must take `std.process.Init`; call `host_io.setup(init)` first) |
| the real process environment | `host_io.environ()` → `std.process.Environ` |

## Direct 0.16 API changes (no shim — this is just how 0.16 is)

- **Filesystem**: `std.fs.cwd()` → `std.Io.Dir.cwd()`; `std.fs.Dir/File` → `std.Io.Dir/File`.
  Ops take `io` first: `dir.openFile(io, path, opts)`, `dir.createFile(io, …)`,
  `dir.access(io, path, .{})`, `dir.statFile(io, path, .{})`, `file.close(io)`.
  `std.fs.openFileAbsolute` → `std.Io.Dir.openFileAbsolute(io, …)` (same for
  createFileAbsolute, accessAbsolute); `makeDirAbsolute` → `createDirAbsolute(io, p, .default_dir)`;
  `.makePath` → `.createDirPath(io, p)`.
- **File read/write**: no `.writeAll`/`.readAll` on `std.Io.File`.
  `.writeAll(x)` → `.writeStreamingAll(io, x)`; `.readAll(&buf)` → `.readPositionalAll(io, &buf, 0)`;
  no `.seekFromEnd` — append = `file.writePositionalAll(io, bytes, (file.stat(io)).size)`.
  `std.io.fixedBufferStream` / GenericReader/Writer are GONE → `std.Io.Writer.fixed(&buf)`
  (+ `.buffered()`) / `std.Io.Reader`. `file.deprecatedReader()` is gone — read a line with
  a manual `sysx.read(fd, &byte)` loop (see `framework/assistant/codex_sdk.zig readMessage`).
- **ArrayList/HashMap are unmanaged by default**: `= .{}` or `std.ArrayList(T){}` →
  `= .empty`. Methods take the allocator: `.append(alloc, x)`, `.deinit(alloc)`,
  `.writer(alloc)` is GONE → `std.Io.Writer.Allocating.init(alloc)` (read back `.written()`),
  or bufPrint+`appendSlice`. `std.json.ObjectMap.init(a)` → `.empty` (it's a
  StringArrayHashMap, unmanaged).
- **Process**: `std.process.Child.init(argv,a) + behaviors + .spawn()` →
  `std.process.spawn(io, .{ .argv=…, .cwd = .{.path=p} | .inherit, .stdin/.stdout/.stderr = .pipe|.ignore|.inherit, .environ_map = ?*const Environ.Map })`.
  `.wait()` → `.wait(io)`; `.kill()` → `.kill(io)` (returns void — no catch). `child.id` is
  `?pid` now (`orelse 0`). Term members are lowercase; `.signal` carries a `SIG` enum
  (`@intFromEnum` for a number). Env map: `host_io.environ().createMap(alloc)` (managed,
  `.put(k,v)`, `.deinit()` — no alloc args).
- **std.net is DELETED**, **std.http.Client reworked** (needs `.io`; `initDefaultProxies`
  takes an `environ_map`). Do NOT re-migrate these — the whole networking/readiness layer
  is EXEMPT (see below).
- **crypto**: `std.crypto.random.bytes(&b)` / `.int(T)` → `host_io.io().random(&b)`;
  `X25519.KeyPair.generate()` → `.generate(io)`.
- **fmt/mem renames**: `std.fmt.format(w, fmt, args)` free fn is gone → `w.print(fmt, args)`.
  `std.mem.trimRight/trimLeft` → `trimEnd/trimStart`.
- **build.zig**: link/add forwarders moved off `Compile` onto `Module`:
  `exe.linkLibC()` → `exe.root_module.link_libc = true`; `exe.linkSystemLibrary(n)` →
  `exe.root_module.linkSystemLibrary(n, .{})`; same for addIncludePath/addCSourceFile/etc.
- **Allocator**: `std.heap.GeneralPurposeAllocator` → `std.heap.DebugAllocator`.

## EXEMPT — never migrate these to std.Io.net, they carry 0.15 shims by design

`framework/net/**` — includes:
- `sysx.zig` — the syscalls 0.16 deleted from `std.posix` (socket/bind/connect/accept/
  listen/send/recv/read/write/close/fcntl/open/waitpid/fchmodat/…), lifted **verbatim from
  0.15.2 std source** so `error.WouldBlock` discrimination stays byte-identical. Re-exports
  the survivors so the layer says `sysx.*` uniformly.
- `netx.zig` — the `std.net` subset 0.16 deleted (Address/Ip4/Ip6, getAddressList via libc
  getaddrinfo, tcpConnectToHost, the fd-wrapper Stream), posix routed through sysx.
- `http.zig` — on the reworked `std.http.Client`.

Plus `host_io.zig`, `pty_remote.zig`, `dev_ipc.zig`, `sock_util.zig`, `render_surfaces_vm.zig`,
`v8_bindings_cli.zig`. This is "door (b)" of the migration: the hand-rolled nonblocking
readiness loop stays on raw posix-shaped syscalls by ruling. See `docs/ZIG_016_MIGRATION.md §6`.

## Gates (regenerate a green baseline before trusting any further change)

`./verify-zig016-editor.sh` — the full dev-host flag closure + all binaries + all 34 tests.
`./verify-zig016-tests.sh`, `verify-zig016-bins.sh`, `verify-zig016-lane0.sh` — subsets.
