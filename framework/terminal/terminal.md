# framework/terminal

Self-contained terminal subsystem for ReactJIT carts. PTY spawning, libvterm
emulation, token-level classification, semantic graph construction, recording,
playback, and the V8 host bindings that surface it all to JS.

When a cart's source code doesn't import `useTerminal`, nothing in this
directory compiles into the binary, no `libvterm` link, no `__play_*` /
`__rec_*` / `__sem_*` / `__terminal_set_cwd` host functions register.
Same shape as `framework/videos.zig` under `HAS_VIDEO`.

## Cart-side surface

One hook (`runtime/hooks/useTerminal.ts`) covers the entire subsystem,
mirroring `useAssistant`'s "everything under one roof" shape:

```ts
const term = useTerminal({ classifier: 'claude_code' });

term.isRecording / .frameCount / .semFrame / .hasDiff   // reactive state
term.setCwd(path)                                        // shell control
term.rec.{ start, stop, toggle, save }                   // record raw stream
term.play.{ load, play, pause, toggle, step, seek, speed, state }
term.sem.{ setMode, state, node, cacheEntry, rowText, rowToken,
           tree, snapshot, export, buildGraph, ... }
```

The `<Terminal>` primitive owns shell input/paint and stays
prop-less — the hook is for inspection / recording / replay / classifier
control, not for rendering.

## Pipeline

```
PTY ──► vterm ──► classifier ──► semantic ──► render
              \
               ─► recorder (raw stream, classifier-independent)
                       └► player (replays through vterm)
```

Each stage is a leaf module with a small public API. Higher stages call
lower stages; lower stages don't know about higher ones.

## Files

| File | Role |
|---|---|
| `pty.zig` | POSIX PTY master/slave, non-blocking I/O, SIGWINCH on resize. Pure POSIX, no libvterm. |
| `pty_client.zig` | NDJSON client over `supervisor.sock` for external terminal control. |
| `pty_remote.zig` | NDJSON server on `/run/user/<uid>/claude-sessions/supervisor.sock`. Routes ops to vterm slots. |
| `vterm.zig` | libvterm wrapper. Single-terminal API + `Idx` per-slot variants for `MAX_TERMINALS=4` slots. Contains the only `extern "vterm"` decls. |
| `classifier.zig` | Per-row token classification (basic / claude_code modes). Maps raw rows to a `Token` enum and provides `Color` for paint. |
| `semantic.zig` | Higher-level structural graph (block/row/turn nodes, role/lane metadata, frame diffs). Consumes classified rows. |
| `recorder.zig` | Captures raw PTY bytes with timestamps to a `TREC` file. Pure-Zig, no libvterm dep. |
| `player.zig` | Replays a recording through vterm. Allows reclassifying the same recording through different classifiers at playback time. |
| `v8_bindings_vterm.zig` | V8 host bindings that surface vterm directly. Registered at `v8_app.zig` only when `HAS_TERMINAL=true`. |

The recorder/player split is deliberate — recordings store the raw stream,
not classifier output, so a recording captured under one classifier replays
correctly through another.

## Feature gating

`-Dhas-terminal` is the build flag. `sdk/dependency-registry.json` ties it
to a metafile trigger:

```json
"terminal": {
  "triggers": [
    { "kind": "metafileInput", "input": "runtime/hooks/useTerminalRecorder.ts" }
  ],
  "buildOptions": ["has-terminal"],
  "nativeLibraries": ["libvterm"]
}
```

`scripts/ship` walks the cart's bundle metafile, sees the hook input, flips
the flag on. No flag → no link → no compile of this directory.

### How the gate actually works (no `_real`/`_stub` files)

Three external sites import this directory, all gated:

1. **`v8_app.zig`** registers `v8_bindings_vterm.zig` only when `HAS_TERMINAL`:
   ```zig
   const v8_bindings_vterm = if (HAS_TERMINAL)
       @import("framework/v8_bindings_vterm.zig")
   else struct {
       pub fn registerVterm(_: anytype) void {}
       pub fn tickDrain() void {}
   };
   ```

2. **`framework/engine.zig`** gates `vterm_mod` / `classifier` / `semantic` /
   `pty_remote` / `pty_client` the same way. Inline empty-struct fallbacks
   satisfy every method engine.zig actually calls (~25 vterm + 7 classifier
   + 1 semantic). Empty-struct return values let the existing engine paint
   loop short-circuit cleanly (e.g. `getRowsIdx` returns 0 → `if (rows == 0)
   return` skips the whole terminal paint block).

3. **`framework/assistant/v8_bindings_sdk.zig`** imports the cluster
   unconditionally but wraps every `registerHostFn("__play_…")` /
   `"__rec_…"` / `"__sem_…"` call in `if (HAS_TERMINAL) { … }`. Zig's
   comptime branch elision drops the dead block, the host fns become
   unreachable, their bodies (which call into vterm/classifier/semantic)
   are never analyzed, and the `extern "vterm"` references aren't emitted.

The pattern relies on Zig's lazy analysis: a `pub fn` referenced only from
inside a dead `if (comptime false)` block is considered unused, not
compiled, and contributes no symbols to the link. That's why no `_stub`
file is needed — the dual is the empty-struct else-branch at the use site.

## Adding a new terminal-only host fn

1. Define the host fn in `v8_bindings_vterm.zig` (or a new sibling) and
   register it in that file's `registerVterm`.
2. Add the JS-side hook to `runtime/hooks/`. If it's the trigger for
   `HAS_TERMINAL`, leave the metafile entry pointed at
   `useTerminalRecorder.ts`; otherwise add a new trigger entry to
   `sdk/dependency-registry.json` under `"terminal"`.
3. Done. No build flag plumbing in `scripts/ship`, no engine gate.

## Adding a new terminal-only Zig module

1. Add it under `framework/terminal/`. Internal cross-imports use bare
   filenames (`@import("vterm.zig")`, not `terminal/vterm.zig`).
2. Anything outside this directory that needs it must gate at the import
   site: `if (HAS_TERMINAL) @import("terminal/<file>.zig") else struct { … }`.
3. Don't add a `_stub.zig` companion. The empty-struct gate at the use
   site replaces it.

## Don'ts

- **Don't import this directory unconditionally from `framework/` or
  `runtime/` Zig code outside terminal/.** It will pull libvterm into every
  build and resurrect the stub problem.
- **Don't reach into `vterm.zig`'s extern declarations from above.** Use the
  Zig-side wrappers (`writePty`, `getCell`, etc.). Adding a new C call
  goes inside `vterm.zig`.
- **Don't merge `recorder.zig` into `vterm.zig`.** The classifier-independence
  of recordings depends on storing raw bytes upstream of vterm, not
  post-vterm cells.
