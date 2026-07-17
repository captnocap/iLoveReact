# Zig 0.15.2 → 0.16.0 Migration Spec

Status: **PREPPED, NOT STARTED** — waiting on the user's go signal for an overnight run.
Prepped 2026-07-16 (req_3147/req_3150/req_3151). This doc is the numbered spec for the
migration lanes (codex handoff pattern: Claude plans + verifies, codex executes mechanical
lanes against this spec).

## 0. Ground rules

- **The branch must die fast.** This is the ONE authorized exception to MAIN ONLY (user
  ruling, 2026-07-16 conversation): the migration happens on a short-lived branch, lands
  same-day or next-morning, or gets burned. A migration branch older than ~48h is a bug —
  repo velocity turns it into a second source of truth (world_loader two-copies lesson).
- Main stays on 0.15.2 and stays green the whole time. Nothing here touches main except
  the prep commits (REACTJIT_ZIG coverage, zon guard, this doc).
- Parity referee: the 0.15.2 baseline test log (see §7) + `rjit shot` set. Wrong-looking
  diffs lose to the baseline, always.

## 1. Toolchains (both installed side-by-side)

| version | path | role |
|---|---|---|
| 0.15.2 | `zig` on PATH (linuxbrew) | main, untouched |
| 0.16.0 | `~/toolchains/zig-x86_64-linux-0.16.0/zig` | migration branch only |

Selection: every build path honors `REACTJIT_ZIG` (ship/dev/gdev/tui TS commands,
scripts/ship + ship-tui + dev + tui bash, and — fixed in prep — the four `rjit game`
build sites in `cli/commands/game.ts`). On the branch, export:

```bash
export REACTJIT_ZIG=$HOME/toolchains/zig-x86_64-linux-0.16.0/zig
```

Raw `zig build ...` invocations in lane scripts must use `$REACTJIT_ZIG` explicitly.
`build.zig.zon` on main pins `.minimum_zig_version = "0.15.2"`; the branch bumps it to
`"0.16.0"` as its first commit (this makes a wrong-compiler invocation fail loudly).

**The authoritative API reference is on disk:** `~/toolchains/zig-x86_64-linux-0.16.0/lib/std/`.
When any mapping in §4 is ambiguous, grep the real std source — do NOT guess from memory
or blog posts.

## 2. The one ruling: where `io` lives

0.16 moves all blocking I/O (fs, net, time, sleep) behind an injectable `std.Io` handle,
obtained in `main` (`std.process.Init`) or manually (`var t: std.Io.Threaded = ...; t.io()`).

**Ruling: `io` lives on the engine context, next to the allocator.** One `std.Io.Threaded`
created at startup in each binary entry point (v8_app, v8cli, loader, test runners), its
`io()` stored on the engine/context struct that subsystems already receive. Host functions
called from V8 pull it from there. NOBODY threads `io` through ad-hoc function signatures,
and NOBODY creates a second Io instance mid-flight. Inconsistent plumbing across lanes is
the failure mode that kills this migration — one lane does §3, sequentially, before any
mechanical lane starts.

## 3. Plumbing lane (Claude, first, sequential)

1. Branch `zig-0.16-migration` off fresh main. Bump zon `minimum_zig_version`.
2. Fix `build.zig` until `--list-steps` works under 0.16 (build-API churn: expect
   artifact/module API renames; consult 0.16 release notes + Ghostty's migration
   diffs — github.com/ghostty-org/ghostty issue #12228 era commits — for patterns).
3. Deps (see §5) until `zig build --list-steps` resolves the full graph.
4. Create the Io handle at every binary entry point; add it to the engine context.
5. Commit. Only now do mechanical lanes fan out.

## 4. Mechanical lanes (codex, parallel after §3)

Counts are 2026-07-16 `framework/` numbers; regenerate file lists live with the greps.
Each lane: transcribe per the mapping, build the affected test step, move on. No
creativity. If a site doesn't fit the mapping, SKIP IT and log it for Claude — do not
improvise.

**Lane A — filesystem (~350 sites)** — `grep -rln 'std\.fs\.' framework/`
- `std.fs.cwd().openFile(p, o)` → `std.Io.Dir.cwd().openFile(io, p, o)` (same verbs:
  createFile, readFileAlloc, openDirAbsolute, makeDirAbsolute→createDirAbsolute,
  accessAbsolute — `std.fs` → `std.Io.Dir`, `io` first arg)
- `std.fs.path.join/dirname/basename` and `max_path_bytes`: renamed home only, no io.
  Verify exact 0.16 namespace in lib/std before mass-applying.

**Lane B — time (~110 sites)** — `grep -rlnE 'std\.time\.(milli|micro|nano|time|Timer|Instant|sleep)' framework/`
- `std.time.{milli,micro,nano}Timestamp()` → `std.Io.Timestamp.now(io)` + unit accessor
- `std.time.sleep(ns)` → `io.sleep(...)`
- constants (`ns_per_ms` etc.) unchanged.
- FLAG any site inside the frame loop / paint path for the §8 perf check.

**Lane C — env (~75 sites)** — `grep -rln 'std\.posix\.getenv' framework/`
- → process env via the 0.16 API (verify in lib/std: env map on `std.process.Init` /
  `std.process` lookup). All 75 are startup/config reads; none are hot.

**Lane D — raw fd read/write/close (~65 sites, NON-socket only)** —
`grep -rlnE 'std\.posix\.(read|write|close)\(' framework/` minus §6 files
- → `std.Io.File` methods on the appropriate handle.

**Lane E — legacy std.io streams (~15 sites)** —
- `std.io.fixedBufferStream` → `std.Io.Writer.fixed` / `.Reader.fixed` (new form already
  exists in 0.15.2 — this lane can even run BEFORE the branch as a warm-up)
- `GenericReader/GenericWriter` → concrete `std.Io.Reader/Writer`.

## 5. Dependencies

| dep | pin today | 0.16 move | status |
|---|---|---|---|
| zuckdb | `?ref=zig-0.15` | flip to `zig-0.16` branch (`479fc9d...`) | **confirmed first blocker**: the zig-0.15 pin's lazy duckdb dep uses a legacy `1220...` multihash that 0.16 rejects at zon parse ("invalid hash: incomplete") — this is the first error `zig build` prints on 0.16, already reproduced |
| pg.zig | `?ref=zig-0.15` | flip to `master` (karlseguin convention: master tracks newest release; no zig-0.16 branch exists) | verify its transitive buffer/metrics hashes parse under 0.16 |
| tls.zig | vendored `deps/tls.zig` | upstream (ianic/tls.zig) has `zig-0.16.x` branch — diff & pull, keep our patches | only 16 std.(net/io/posix) sites |
| zig-v8 | vendored `deps/zig-v8` | ours; ~10 std.(fs/io) sites in glue + build.zig churn | patch in place |
| wgpu_native_zig | vendored | mostly extern bindings | patch build.zig only |
| zluajit | pinned commit, master-only upstream | thin LuaJIT C-API bindings | patch in place if it breaks; small |

## 6. EXEMPT: the nonblocking socket layer (ruled door (b))

**Files (do NOT migrate to std.Io.net):** `framework/net/{tcp,udp,websocket,wsserver,httpserver,ipc}.zig`,
`framework/terminal/pty_remote.zig`, `framework/diag/dev_ipc.zig`,
`framework/render/render_surfaces_vm.zig`, `framework/v8_bindings_cli.zig`.

This is a hand-rolled readiness loop (16× SOCK.NONBLOCK, 12× poll, 12× fcntl) under the
eventbus — load-bearing, frame-loop-adjacent. 0.16's Io wants to own blocking semantics;
restructuring onto it is a redesign, not a migration. **Ruling: these files move from
`std.posix.*` to `std.os.linux.*` raw syscalls 1:1** (we are Linux-first; the syscalls
are stable), each file gets one header comment: why exempt, revisit only if async Io
earns it. Zero behavior change, verified by the net-adjacent test steps + a live
websocket/eventbus smoke.

`std.Thread` (105 sites): not I/O, expected unchanged. Verify once in lib/std, then leave.

## 7. Verification protocol

- Baseline: `zig-out/zig016-baseline-0.15.2.log` — all `test-*` steps' PASS/FAIL on
  0.15.2 at the branch-point sha. The branch must reproduce this table exactly.
- Recorded 2026-07-16 @ 77864c067: **33/35 PASS**. Two pre-existing reds owned by main,
  NOT the migration: `test-luajit-runtime` (stale step — references deleted
  `framework/luajit_runtime_bridge.zig`) and `test-game-physics` (real behavioral fail:
  "heightfield: hollow ramp slab ascent reaches the crest with zero side grace").
  The branch matching 33/35 with the same two reds = parity.
- After each lane: rebuild that lane's test steps. After all lanes: full 35-step sweep +
  `SHIP_RUN_PACKAGE=0 rjit ship editor` + `rjit shot editor` against the baseline PNGs +
  the headless gesture harness (RJIT_MODELDOC/RJIT_MESHOPS).
- Morning gate (user): compiled build run by the user, their loop. Branch lands only
  after that.

## 8. Perf spot-checks (after green)

`std.Io.Timestamp.now(io)` goes through an interface where `clock_gettime` didn't.
Check the Lane-B FLAGged frame-loop sites; if any shows up hot under the existing perf
logging, that site gets the door-(b) treatment: direct syscall + comment. Measure, don't
theorize.

## 9. Night-of order

1. §3 plumbing lane (sequential, Claude) → commit "builds + deps resolve on 0.16"
2. Lanes A–E fan out (codex, parallel per lane, one lane per subsystem directory to
   avoid file collisions) → commit per lane
3. §6 exemption pass (Claude)
4. §7 full sweep, fix fallout, §8 perf pass
5. Morning report: green table vs baseline, or honest list of what fought back
