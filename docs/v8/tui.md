# TUI Renderer & Dev Shell

Last updated: 2026-05-05.

ReactJIT primitives (`Box`, `Text`) compiled to a 24-bit ANSI terminal
surface, driven by the same React reconciler stream the GPU host
consumes. Runs entirely on `tools/v8cli` — no Node, no Bun, no web
runtime. The same `tui/host.ts` powers any TUI cart, and the dev shell
(`scripts/devshell`) is the first non-toy consumer.

## Why

The reconciler emits a clean JSON command stream (CREATE / APPEND /
UPDATE / CREATE_TEXT / …) that nothing about it makes GPU-specific. A
TUI is just a different consumer: build the same tree from the same
commands, run a flexbox-on-character-grid layout, paint with ANSI
escapes instead of GPU quads. The benefit is dual-target — every cart
written against `Box`/`Text` can render to a terminal without rewrite.

## Goals

- Single-file renderer (`tui/host.ts`) that any TUI cart links against.
- Zero Node/Bun. Pipeline is `tools/esbuild` → `tools/v8cli`.
- Identical authoring shape to GPU carts: TSX, React 18, hooks.
- Dirty-frame diff: a single character change emits a single cursor
  jump + the changed cells, not a full repaint.
- Live terminal resize without SIGWINCH wiring.
- Clean exit on signal — no stranded alt-screen / raw-mode terminals.

## Layout

```
tui/
  host.ts            reconciler config + flex layout + ANSI paint
  v8-preamble.js     v8cli polyfills (timers, stdin, microtask loop)
  jsx.d.ts           JSX intrinsic types for <box> / <text>
  package.json
  examples/
    counter.tsx          v8cli demo cart (the canonical small cart)
    counter-bun.tsx      bun-targeted version of the same cart
    counter-bun-run.tsx  bun runner (used by tests)
  devshell/
    main.tsx         devshell entry — calls Shell({ cart })
    Shell.tsx        title bar + tab strip + active pane + footer
  tests/
    smoke.tsx        headless layout snapshot
    diff-bench.tsx   proves the dirty-diff (frame N → frame N+1 byte
                     reduction)
    update-test.tsx  text update + flexWrap regression

scripts/
  tui              bundle-and-run wrapper for any TUI cart
  devshell         thin wrapper → tui/devshell/main.tsx
```

## Pipeline

`scripts/tui [<entry>]` (default entry: `tui/examples/counter.tsx`)
runs:

1. Materializes `tui/node_modules/{react, react-reconciler, scheduler,
   loose-envify, js-tokens}` as copies from `vendor/` on first run.
   Symlinks don't work — Bun followed them back into vendor/ and broke
   nested resolution. The copies are gitignored.
2. Reads `stty size` and bakes `__TUI_COLS__` / `__TUI_ROWS__` defines
   into the bundle as fallback constants only — runtime size comes from
   `__termSize()` (TIOCGWINSZ).
3. Calls `tools/esbuild` with `--platform=neutral --format=cjs --jsx=
   automatic --jsx-import-source=react --conditions=default
   --define:process.env.NODE_ENV='"production"'` to produce
   `tui/.cache/bundle-<name>.js`.
4. Execs `tools/v8cli <bundle> <…argv>`. `scripts/tui` shifts past its
   own first arg and forwards the rest, so the cart sees `process.argv
   = [<bundle>, ...passed]`.

The `tools/v8cli` binary needs to be ReleaseFast (Debug builds segfault
on startup). `build.zig` adds the `framework/ffi/v8_stack_shim.cpp`
source and a 64MB stack to the v8-cli target — same as the main app.

## Primitives

Two intrinsic JSX elements: `<box>` and `<text>`. Both accept the same
prop bag (`BoxProps` in `tui/host.ts`):

| Prop | Type | Notes |
|---|---|---|
| `width` / `height` | `number \| 'fill'` | cells. `'fill'` ⇒ flexGrow := 1. unset ⇒ shrink-wrap (column children) or stretch (cross). |
| `flexDirection` | `'row' \| 'column'` | default `'column'`. |
| `flexGrow` | `number` | distributes leftover main-axis space. |
| `gap` | `number` | between siblings, main axis. |
| `padding` | `number` | all four sides. |
| `paddingX` / `paddingY` | `number` | per-axis override. |
| `border` | `boolean` | 1-cell box-drawing border, consumes inner space. |
| `borderColor` | `string` | hex `#rrggbb`. |
| `bg` / `fg` | `string` | hex `#rrggbb`. 24-bit SGR. |
| `bold` | `boolean` | only honoured on `<text>`. |
| `justify` | `'start' \| 'center' \| 'end' \| 'between'` | main axis distribution. |
| `align` | `'start' \| 'center' \| 'end'` | cross-axis. CSS-flex semantics: child wins (align-self), parent cascades (align-items), unset defaults to **stretch**. |
| `wrap` | `boolean` | only meaningful on row direction; greedy line-pack. |

`<text>` content can mix string and number children: `<text>count =
{n}</text>` works. Children are concatenated at paint time so React's
text-update path stays correct (single-shot text caching at append time
is what caused the early "count: 0 never updates" bug).

## Layout rules

- **Default cross axis = stretch.** Like CSS `align-items: stretch`.
  Children fill the parent's cross dimension unless `align`,
  `width:'fill'`, or an explicit number says otherwise. This is what
  makes `<box bg="#111827">` actually paint full-width chrome.
- **`align` cascades parent → child.** Parent acts as align-items,
  child overrides as align-self. Unset on both = stretch.
- **`flexGrow`** distributes leftover *main-axis* space among siblings
  with `flexGrow > 0`.
- **`wrap`** packs row children greedily into lines, then stacks lines
  on the cross axis (with `gap` between lines).
- Pixel coordinates are **cells** — width is columns, height is rows.
  No px-to-cells conversion; carts author in cells.

## Painting

`repaint()` is debounced via a microtask trampoline and runs after
every reconciler commit:

1. Build a fresh grid sized to `process.stdout.columns` ×
   `process.stdout.rows` (read live each paint, see Resize below).
2. Recursive `layout()` walks the tree and pushes `Box` records into a
   flat list, parents before children (back-to-front paint order).
3. Each `box` fills its rect (bg + inherited fg) and optionally draws
   a 1-cell border. Each `text` writes its glyphs at its origin.
4. The grid is **diffed against `prev`** (previous frame's grid). For
   each row, contiguous runs of changed cells get a single cursor-move
   plus the new content + the SGR codes. Unchanged cells are skipped.

A frame that changes one digit emits ~50 bytes vs ~2KB for a full
repaint (~43× reduction; see `tui/tests/diff-bench.tsx`).

`headlessSnapshot(width, height)` paints once into a fixed-size grid
and returns plain text — no ANSI, no stdout. Used by tests.

## Lifecycle

```ts
import { enter, leave, render, startInput, subscribeKey } from './host';

enter();              // alt-screen on, hide cursor, start resize-poll
startInput();         // raw mode + stdin polling (TUI cart only)
render(<App />);      // standard React reconciler render
__runEventLoop(() => { leave(); process.exit(0); });
```

`enter()` also installs a 4Hz resize poll that reads
`process.stdout.{columns,rows}` (which calls `__termSize()` →
TIOCGWINSZ on stdin). When dimensions change, `prev` is nulled and a
full repaint is scheduled. No SIGWINCH plumbing needed.

`leave()` is idempotent — also runs unconditionally from a v8cli
atexit hook (`framework/v8_bindings_cli.zig::restoreTty`) and from the
SIGINT/SIGTERM/SIGHUP handler before re-raise. Together that means the
terminal is always restored even on signal-killed exits.

`subscribeKey(fn)` registers a key handler. `startInput()` already
intercepts `q` and `\x03` (ctrl-c) for clean exit.

## v8cli bindings used

These live in `framework/v8_bindings_cli.zig` and are exposed as
globals from any v8cli script:

| Function | Purpose |
|---|---|
| `__writeStdout(s)` | direct stdout write. |
| `__termSize()` | JSON `[cols, rows]` via TIOCGWINSZ. `[0,0]` if not a TTY. |
| `__setStdinRaw(enable)` | termios save/restore. Keeps ISIG. |
| `__readStdin()` | non-blocking drain of the root-owned stdin queue. |
| `__nowMs` / `__sleepMs` | for the timer trampoline. |
| `__unixConnect/Write/ReadAll/Close` | for the dev shell socket. |

Polyfilled in `tui/v8-preamble.js` so the rest of the code uses
node-shaped APIs (`setTimeout`, `setInterval`, `process.stdout`,
`process.stdin.on('data', …)`, `process.stdin.setRawMode`, etc.).

`__runEventLoop(done)` is the microtask trampoline. v8cli has no
event loop of its own. The trampoline pulls timers in order, runs the
callback, then yields via `Promise.resolve().then(step)` — that gives
V8 a chance to drain microtasks (queueMicrotask repaints, scheduler
internals) at top-level before the next timer fires. A naive
`while(timers.length)` loop would prevent any microtask from ever
running.

## Dev shell

`scripts/devshell <cart-name>` boots a tab-switched terminal UI
oriented around a running cart. The shell is one v8cli process; the
cart it talks about is a separate process the user launched with
`scripts/dev`.

Current panes (one is real, the rest are scaffolded):

| # | Pane | Status |
|---|---|---|
| 1 | Logs | placeholder. Plan: spawn dev host as child via `__spawn`, capture stdout/stderr via `__childReadLine`, ring-buffer + scrollback. |
| 2 | Events | placeholder. Plan: extend `framework/dev_ipc.zig` with `QUERY-EVENTS` command; reuse SQL filter from `cart/eventlog/`. |
| 3 | Inspect | placeholder. Plan: `PICK-ELEMENT` (request) + `ELEMENT-INFO` (reply); cart enters pick mode; render fiber tree as Box/Text. |
| 4 | Bundle | live. Parses `.cache/bundle-<cart>.js.metafile.json`. Shows total bundle size + module count, top 10 modules by `bytesInOutput` with bar charts, and per-top-level-directory breakdown (`vendor/<pkg>` collapses to two segments so react / react-reconciler stay distinct). Self-contained — no IPC, runs whether the cart is up or not. |
| 5 | Status | live. cart name, dev-host socket up/down probe, heartbeat counter, runtime info. |

Tab keys `1..5` switch panes. `q` / ctrl-c quits. `F2` / `F3` / `F5`
are reserved for restart / rebuild / element-pick (not wired).

The Status pane probes `/tmp/reactjit.sock` existence at 5Hz; that's
the same socket `scripts/dev` and `scripts/push-bundle.js` already
speak. The IPC protocol today is line-based:

```
PUSH <name> <bundle_byte_length>\n
<bundle bytes>
→ ack line
```

Future panes will extend the protocol. See `framework/dev_ipc.zig` for
the listener.

## Constraints / non-goals

- **No bun, no node** — both are banned in this stack. New TUI scripts
  must run under `tools/v8cli`. The Bun-targeted tests in `tui/tests/`
  exist for fast headless iteration on the host itself; they are not
  in the production path.
- **No GPU concepts** — no `Canvas`, `Graph`, `Image`, `Pressable`,
  `ScrollView`, `Modal`, `Window`. The TUI host doesn't know about
  them. Carts that want to dual-target must avoid those primitives or
  fork their components.
- **Cells, not pixels** — sizing is integer cell counts. Don't pass
  `padding: 24` expecting 24px; you'd get 24 cells of margin.
- **One process** — the dev shell and the running cart are separate
  processes. The shell never tries to `embed` or `link` against the
  cart runtime; it talks over the unix socket.
- **Debug v8cli builds segfault.** Always build with `-Doptimize=
  ReleaseFast`. The committed `tools/v8cli` is staged from
  `zig-out/bin/v8cli` after a Release build.

## Tests

```
bun tui/tests/smoke.tsx         # headless layout snapshot
bun tui/tests/diff-bench.tsx    # confirms dirty diff byte reduction
bun tui/tests/update-test.tsx   # text-update + flexWrap regression
scripts/tui                     # interactive: counter cart on v8cli
scripts/devshell <cart>         # interactive: dev shell
```

The bun tests are headless and fast; they don't enter alt-screen and
don't need a TTY. They guard the host's flex/text/dirty-diff logic.
The interactive scripts need a real terminal.
