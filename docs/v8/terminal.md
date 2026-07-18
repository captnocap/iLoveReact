# V8 Terminal Pipeline

`Terminal` is a native cell-grid terminal node. React creates a host node,
V8 marks it as `node.terminal`, the engine starts a PTY-backed shell, libvterm
tracks the terminal screen, and the GPU paints each cell.

This is not a browser terminal widget. There is no DOM textarea, no xterm.js,
and no React callback stream for terminal bytes. Input goes through SDL events
to Zig, output comes from a POSIX PTY, and rendering reads libvterm cell state
directly.

## Public primitive

Source: `runtime/primitives.tsx`

```tsx
export const Terminal: any = (props: any) => h('Terminal', props, props.children);
export const terminal: any = Terminal;
```

Usage:

```tsx
import { Terminal } from '@reactjit/runtime/primitives';

export default function App() {
  return (
    <Terminal
      terminalFontSize={13}
      style={{
        width: '100%',
        height: 320,
        backgroundColor: '#05070a',
        borderRadius: 6,
      }}
    />
  );
}
```

The lower-case helper `terminal` creates the same `Terminal` host type. A raw
lower-case JSX host tag, `<terminal />`, is also accepted by the V8 host because
`v8_app.zig` treats both `"Terminal"` and `"terminal"` as terminal types, but
the exported `Terminal` primitive is the normal API.

## Component API

| Prop | Type | Behavior |
| --- | --- | --- |
| `style` | object | Normal layout and visual style. Width/height determine terminal rows and columns during paint. Background, border, opacity, radius, etc. are applied by the normal node paint path before terminal cells are painted. |
| `fontSize` | number | For terminal nodes, this sets `node.terminal_font_size` instead of `node.font_size`. Minimum is 1. |
| `terminalFontSize` | number | Terminal-specific alias for the cell-grid font size. Minimum is 1. |
| `className` | string | Resolved by the reconciler through `tw()` and merged into `style`, the same as other primitives. |
| `children` | any | Passed through by React, but terminal painting ignores child content. Treat `Terminal` as a leaf node. |

Parsed but not currently meaningful for terminal cells:

| Prop | Why |
| --- | --- |
| `color` | Stored as normal text color, but `paintTerminal()` uses libvterm foreground colors or semantic overlay colors. |
| `fontFamily` | Stored as normal node font family, but terminal cell paint calls `gpu.drawGlyphAt(..., font_size, ...)`; the terminal paint path does not select a per-node font family. |
| `fontWeight`, `lineHeight`, `letterSpacing` | Stored on the node like text props, but terminal geometry comes from `terminal_font_size`, `gpu.getCharWidth()`, and `gpu.getLineHeight()`. |

Not currently public terminal props:

| Missing prop | Current behavior |
| --- | --- |
| `shell` | The engine hardcodes `"bash"` when a terminal node first appears. |
| `cwd` | There is no per-node prop. `globalThis.__terminal_set_cwd(path)` sets the global spawn cwd used by the next native terminal spawn. |
| `rows` / `cols` | Computed from layout every paint from node width/height and font size. |
| `onData` / `onInput` | No JS byte stream callback. PTY output stays in Zig/libvterm. |
| `value` | Not controlled by React. |

## Source map

| Layer | Files |
| --- | --- |
| Primitive export | `runtime/primitives.tsx`, `framework/ambient_primitives.ts`, `framework/ambient.d.ts` |
| Reconciler bridge | `renderer/hostConfig.ts` |
| V8 command application | `v8_app.zig` |
| Node fields/layout | `framework/layout.zig`, `framework/api.zig` |
| Engine tick/events/paint | `framework/engine.zig` |
| Feature gate | `framework/vterm.zig`, `framework/vterm_real.zig`, `framework/vterm_stub.zig`, `build.zig`, `sdk/dependency-registry.json` |
| PTY | `framework/terminal/pty.zig` |
| KMS input bridge | `framework/render/evdev.zig` |
| Semantic classification | `framework/classifier.zig`, `framework/semantic.zig` |
| Recording/player | `framework/recorder.zig`, `framework/player.zig`, `runtime/hooks/useTerminalRecorder.ts` |
| Related raw PTY host API | `framework/v8_bindings_telemetry.zig`, `framework/qjs_runtime.zig` |
| Dock resize helpers | `framework/v8_bindings_fs.zig`, `framework/qjs_runtime.zig` |

## End-to-end flow

1. React renders `Terminal`.
2. The reconciler emits a normal `CREATE` mutation with `type: "Terminal"`.
3. V8 receives the mutation in `v8_app.zig`.
4. `applyTypeDefaults()` recognizes the type and sets `node.terminal = true`.
5. `applyProps()` parses `style`, `fontSize`, and `terminalFontSize`.
6. The layout engine computes the node rectangle like any other leaf node.
7. Each frame, `engine.zig` scans the node tree for terminal nodes and assigns
   `terminal_id` values.
8. For each discovered terminal slot, the engine starts a shell if that slot has
   not been initialized.
9. A cancelable task in the PTY's injected `std.Io.Group` reads shell output
   into a bounded `std.Io.Queue`; the frame only drains completed bytes.
10. libvterm consumes the PTY bytes and updates terminal cells, cursor state,
    damage rows, and scrollback.
11. The engine marks terminal classification/layout dirty when PTY output arrives.
12. `paintTerminal()` reads cells from libvterm and draws backgrounds, glyphs,
    selection, scrollback indicator, cursor, and semantic accents.
13. SDL text/key/mouse events are routed back to the focused terminal and queued
    for the PTY's injected-Io writer task.

## V8 node materialization

Source: `v8_app.zig`

Terminal type detection:

```zig
fn isTerminalType(type_name: []const u8) bool {
    return std.mem.eql(u8, type_name, "Terminal") or
        std.mem.eql(u8, type_name, "terminal");
}
```

On `CREATE`, `applyTypeDefaults()` marks the node:

```zig
} else if (isTerminalType(type_name)) {
    node.terminal = true;
}
```

Terminal props are parsed in `applyProps()`:

```zig
const is_terminal = node.terminal or (type_name != null and isTerminalType(type_name.?));

if (std.mem.eql(u8, k, "fontSize")) {
    const size: u16 = @intCast(@max(i, 1));
    if (is_terminal) node.terminal_font_size = size else node.font_size = size;
} else if (is_terminal and std.mem.eql(u8, k, "terminalFontSize")) {
    if (jsonInt(v)) |i| node.terminal_font_size = @intCast(@max(i, 1));
}
```

Terminal state lives on the layout node:

```zig
terminal: bool = false,
terminal_font_size: u16 = 13,
terminal_id: u8 = 0,
```

## Feature gate

Source: `framework/vterm.zig`, `build.zig`, `sdk/dependency-registry.json`

`framework/vterm.zig` is a compile-time dispatcher:

- With `-Dhas-terminal=true`, it imports `framework/vterm_real.zig`.
- Without that flag, it imports `framework/vterm_stub.zig`.

The real implementation links `libvterm` and opens PTYs. The stub preserves the
same Zig API but returns empty cells, zero dimensions, `false`, or no-op results.

`build.zig` defines:

```zig
const has_terminal = b.option(bool, "has-terminal", "Link libvterm + real vterm.zig (otherwise stub)") orelse false;
```

The SDK dependency registry maps the `terminal` feature to `has-terminal` and
`libvterm`. At the time of this trace, the registry lists
`runtime/hooks/useTerminalRecorder.ts` and `runtime/features/terminal.ts` as
feature triggers, but `runtime/features/terminal.ts` is not present in the repo.
That means a cart that only imports `Terminal` should be verified against the
ship resolver; dev builds may force the gate on, while a shipped cart may need a
feature marker/import path cleanup to avoid stub mode.

## Terminal discovery and shell spawn

Source: `framework/engine.zig`

The engine scans the materialized node tree every frame:

```zig
fn findTerminalNodes(node: *Node, count: *u8) void {
    if (node.terminal) {
        if (count.* < MAX_TERMINALS) {
            node.terminal_id = count.*;
            count.* += 1;
        }
        return;
    }
    for (node.children) |*child| {
        findTerminalNodes(child, count);
    }
}
```

Then the frame tick starts and polls terminals:

```zig
findTerminalNodes(config.root, &term_count);
while (ti < term_count) : (ti += 1) {
    if (!terminals_initialized[ti]) {
        vterm_mod.spawnShellIdx(ctx.io, ti, "bash", 24, 80);
        terminals_initialized[ti] = true;
    }
    if (vterm_mod.pollPtyIdx(ctx.io, ti)) {
        classifier.markDirtyIdx(ti);
        layout.markLayoutDirty();
    }
}
```

Important consequences:

- The shell is hardcoded to `bash`.
- The initial spawn size is `24x80`; paint resizes it to match the laid-out node.
- The node tree determines terminal slot order each frame.
- Only the first `MAX_TERMINALS` terminal nodes are assigned slots.
- Current `MAX_TERMINALS` is 4.

## PTY lifecycle

Source: `framework/terminal/pty.zig`, `framework/terminal/vterm.zig`

`framework/terminal/pty.zig` opens a real POSIX pseudo-terminal:

1. `posix_openpt()` opens the PTY master.
2. `grantpt()` and `unlockpt()` prepare the slave.
3. `ptsname_r()` resolves the slave path.
4. `fork()` creates the child process.
5. The child calls `setsid()`, opens the slave, makes it the controlling TTY
   with `TIOCSCTTY`, and `dup2()`s it to stdin/stdout/stderr.
6. Optional `cwd` is applied with `chdir()`.
7. `TERM=xterm-256color` and `COLORTERM=truecolor` are set.
8. `execvp(shell, [shell, null])` starts the shell.
9. The parent wraps the master fd as an `std.Io.File` and starts reader, writer,
   and child-wait tasks in an injected `std.Io.Group`. Fixed-capacity
   `std.Io.Queue` instances carry output bytes and pending writes between those
   tasks and the frame.

Raw libc ABI is intentionally limited to the PTY-specific setup boundary
(`posix_openpt`, `grantpt`, `unlockpt`, `ptsname_r`, `fork`/session setup, and
`execvp`) plus `ioctl` for controlling-terminal and window-size operations.
Steady-state reads, writes, cancellation, close, and child waiting use the
injected Zig 0.16 `std.Io`; there is no `O_NONBLOCK`/`fcntl` readiness loop.

This is why shell behavior is terminal-like: readline editing, color output,
Ctrl+C, job control, cursor movement, and SIGWINCH resize all happen through the
PTY instead of through plain pipes.

Each `vterm.zig` `Pipe` owns its PTY and passes the engine's injected capability
when spawning it:

```zig
pub fn spawnShell(self: *Pipe, io: std.Io, shell: [*:0]const u8, rows: u16, cols: u16) void {
    if (self.pty != null) self.closePty();
    self.pty = pty_mod.openPty(g_alloc, io, .{
        .shell = shell,
        .rows = rows,
        .cols = cols,
        .cwd = cwd,
    }) catch return;
}
```

`__terminal_set_cwd(path)` calls `vterm.setSpawnCwd(path)` and affects the next
native terminal spawn. It does not move an already-running shell.

## libvterm screen state

Source: `framework/terminal/vterm.zig`

`VTerm` wraps the libvterm handle and screen:

- `rows`, `cols`
- dirty row tracking
- cursor row/column/visibility
- alternate screen state
- scroll events
- reusable cell/text buffers

PTY output is drained once per frame:

```zig
pub fn pollPty(self: *Pipe, io: std.Io) bool {
    var p = &(self.pty orelse return false);
    var got_data = false;
    var iters: u32 = 0;
    while (iters < 32) : (iters += 1) {
        const data = p.readData() orelse break;
        got_data = true;
        if (self.recording_active) {
            const now_us: u64 = @intCast(@max(0, std.Io.Clock.now(.awake, io).toMicroseconds()));
            self.recorder.?.capture(now_us, data);
        }
        self.feedData(data);
    }
    if (got_data) {
        var out_buf: [4096]u8 = undefined;
        if (self.readOutputData(&out_buf)) |response| {
            _ = p.writeData(response); // queues work for the Io writer task
        }
    }
    return got_data;
}
```

Despite the historical `pollPty` name, this function does not poll a file
descriptor. It drains the bounded output queue with a zero-length wait and
feeds libvterm on the frame thread.

The last step matters: libvterm may generate terminal responses for queries
such as device attributes or cursor reports. Those bytes are written back to
the PTY so shells and full-screen programs do not hang waiting for an answer.

Cell reads are pull-based. Paint and semantic code call functions such as:

- `getRowsIdx(id)`
- `getColsIdx(id)`
- `getCellIdx(id, row, col)`
- `getRowTextIdx(id, row)`
- `getCursorRowIdx(id)`
- `getCursorColIdx(id)`
- `getCursorVisibleIdx(id)`

Each `Cell` carries:

- UTF-8 glyph bytes and length
- display width
- optional foreground/background color
- bold, italic, underline, strike, reverse attributes

## Layout and resize

`Terminal` participates in normal layout like a leaf node. Its pixel rectangle
comes from flex, explicit dimensions, parent layout, and style.

During paint, rows and columns are derived from the actual computed rectangle:

```zig
const cell_w = gpu.getCharWidth(font_size);
const cell_h = gpu.getLineHeight(font_size);
const cols: u16 = @intFromFloat(@max(1, @floor((r.w - 8) / cell_w)));
const rows: u16 = @intFromFloat(@max(1, @floor((r.h - 8) / cell_h)));

if (vt_rows != rows or vt_cols != cols) {
    vterm_mod.resizeVtermIdx(ti, rows, cols);
}
```

`resizeVterm()` resizes both libvterm and the PTY. The PTY resize uses
`TIOCSWINSZ`, which causes terminal-aware processes to receive the expected
window-size change.

## Paint pipeline

Source: `framework/engine.zig`

Normal node visuals are painted first. Then terminal nodes call
`paintTerminal(node)`.

`paintTerminal()`:

1. Reads `node.terminal_id`, `node.computed`, and `node.terminal_font_size`.
2. Skips if the vterm has not initialized.
3. Computes cell width/height from the GPU font helpers.
4. Derives rows/columns from the laid-out rectangle.
5. Resizes vterm/PTY when rows/columns changed.
6. Computes visible scrollback rows from `scrollOffsetIdx()`.
7. Draws a subtle alternating row background.
8. Draws a left accent bar from the classifier token for live rows.
9. Reads each cell from scrollback or the live screen.
10. Draws selection highlights.
11. Draws non-default cell background rectangles.
12. Draws non-space glyphs through `gpu.drawGlyphAt()`.
13. Skips the trailing cell for wide glyphs.
14. Draws a scrollback indicator bar when scrolled up.
15. Draws the cursor only when at live view and cursor blink is visible.

Terminal cell colors come from libvterm unless semantic overlay is active. When
semantic overlay is active, classified live rows can replace the foreground
color with `classifier.tokenColor(token)`.

## Input pipeline

Source: `framework/engine.zig`

Terminal focus is tracked by the engine, not React:

```zig
var g_focused_terminal: u8 = 0;
```

Mouse down scans initialized terminal nodes. If the pointer is inside a terminal
rect, that terminal becomes focused and a selection drag starts. Otherwise the
terminal selection is cleared and normal app selection proceeds.

Text input events go to the focused native terminal first:

```zig
if (terminals_initialized[g_focused_terminal]) {
    terminalHandleTextInput(text_ptr);
    continue;
}
```

`terminalHandleTextInput()` queues the UTF-8 text bytes for the PTY's
injected-Io writer task and scrolls to the bottom. The frame does not issue a
raw `write(2)` call.

Key-down events also go to the focused native terminal first. Special handling:

| Input | Terminal behavior |
| --- | --- |
| printable text | Sent through SDL text input as UTF-8 bytes. |
| `Ctrl` + letter | Sends raw control character, so `Ctrl+C` sends `0x03` to the shell. |
| Enter | `\r` |
| Backspace | `\x7f` |
| Tab | `\t` |
| Escape | `\x1b` |
| Arrow keys | ANSI cursor sequences. |
| Home/End/Delete/PageUp/PageDown/Insert | ANSI key sequences. |
| F1-F11 | ANSI function-key sequences. |
| `Ctrl+Shift+C` | Copies selected terminal text to SDL clipboard. |
| `Ctrl+Shift+V` | Pastes SDL clipboard text to the PTY. |
| `Ctrl+Shift+D` | Toggles semantic color overlay. |

While a terminal is initialized and focused, terminal text/key handling takes
priority over normal inputs, render surfaces, and JS key callbacks.

In KMS/no-display-server mode, `framework/render/evdev.zig` owns input-device
I/O. It opens devices through the injected `std.Io`, runs one cancelable reader
task per device in an `std.Io.Group`, and feeds parsed events into a bounded
`std.Io.Queue`. The frame drains that queue and synthesizes SDL events. Linux
`ioctl` remains only for evdev-specific axis metadata; ordinary open, read,
cancellation, and close ownership do not use a raw fd-readiness loop.

## Selection, clipboard, and scrollback

Selection is stored globally in engine state:

- `term_sel_start_row`
- `term_sel_start_col`
- `term_sel_end_row`
- `term_sel_end_col`
- `term_sel_active`
- `term_sel_dragging`

Mouse drag updates the end cell. Paint checks `termCellSelected(row, col)` for
each visible cell and draws a selection rectangle.

Copy uses `vterm_mod.copySelectedTextIdx()`, which normalizes the rectangular
selection, reads from scrollback or live cells, trims trailing spaces per line,
and writes newline-separated text into a fixed buffer before setting the SDL
clipboard.

Scrollback is implemented in `vterm_real.zig` as a ring buffer:

- `SB_MAX_LINES = 500`
- `SB_MAX_COLS = 200`
- `sb_scroll = 0` means live view

Mouse wheel over a terminal scrolls by three terminal rows per wheel step.
Scrolling up reads top visible rows from scrollback and the remaining rows from
the live screen. Any text input or special key sent to the terminal snaps
scrollback to bottom before writing to the PTY.

## Canvas interaction

Terminals can be placed in a `Canvas.Node`, but the event support is asymmetric.

Mouse wheel has explicit Canvas support. If the pointer is over a Canvas, the
engine transforms screen coordinates to graph coordinates and checks terminal
rects in graph space before applying terminal scrollback.

Mouse click/focus/selection does not currently do the same graph transform. The
mouse-down path compares screen `mx/my` directly with `tn.computed`. For a
terminal whose computed rect is in graph space inside a `Canvas.Node`, wheel
scrolling can work while click focus and drag selection may not.

## Semantic classifier overlay

Source: `framework/classifier.zig`, `framework/semantic.zig`, `framework/engine.zig`

On PTY output, the engine marks the terminal classifier dirty. It also scans the
first six terminal rows for `"Claude Code"` and switches that terminal to the
`claude_code` classifier when detected.

When a classifier mode is active and dirty:

1. The engine reads each row through `vterm_mod.getRowTextIdx()`.
2. `classifier.classifyAndCacheIdx()` assigns semantic tokens per row.
3. The dirty flag is cleared.
4. Terminal `0` also drives `semantic.tick(rows)` to build the semantic graph.

Paint uses the classifier in two ways:

- It always draws a left accent bar per live row.
- When `Ctrl+Shift+D` enables semantic overlay, it can also recolor foreground
  glyphs for classified rows.

The semantic graph is primary-terminal only today: `semantic.tick()` runs for
terminal `0`.

## Recording API

Source: `runtime/hooks/useTerminalRecorder.ts`, `framework/v8_bindings_core.zig`,
`framework/recorder.zig`

The public hook is:

```ts
export interface TerminalRecorder {
  start(rows: number, cols: number): void;
  stop(): void;
  save(path: string): boolean;
  isRecording(): boolean;
}
```

It wraps process-wide host functions:

| Host function | Behavior |
| --- | --- |
| `__vtermStartRecording(rows, cols)` | Starts the global recorder with initial dimensions. |
| `__vtermStopRecording()` | Stops the recorder. |
| `__vtermSaveRecording(path)` | Saves recording data; returns `1` on success, `0` on failure. |
| `__vtermIsRecording()` | Returns `1` when recording, otherwise `0`. |

Recording taps raw PTY data in `pollPty()` before the bytes are fed to libvterm.
The recorder is a singleton. It is not per `Terminal` node.

`framework/v8_bindings_sdk.zig` also exposes recorder aliases used by some
cart code:

| Host function | Behavior |
| --- | --- |
| `__rec_start()` | Starts recording with the current vterm dimensions. |
| `__rec_stop()` | Stops recording. |
| `__rec_toggle()` | Toggles recording. |
| `__rec_save(path)` | Saves recording data. |
| `__rec_is_recording()` | Returns numeric recording state. |
| `__rec_frame_count()` | Returns recorded frame count. |

## Related host helpers

| Function | Source | Relation |
| --- | --- | --- |
| `__terminal_set_cwd(path)` | `framework/v8_bindings_core.zig` | Sets the global cwd used by the next native terminal spawn. |
| `__beginTerminalDockResize(startY, startHeight)` | `framework/v8_bindings_fs.zig` | Starts app-level terminal dock resize tracking. |
| `__endTerminalDockResize()` | `framework/v8_bindings_fs.zig` | Ends dock resize tracking. |
| `__getTerminalDockResizeState()` | `framework/v8_bindings_fs.zig` | Returns `{ active, startY, startHeight }`. |
| `globalThis.__setTerminalDockHeight(height)` | Cart-defined JS callback | Called by the engine during dock resize if present. Not part of the terminal primitive itself. |

Dock resize state is stored in `qjs_runtime.zig` for historical reasons, but
the V8 bindings expose the same helpers.

## Related raw PTY API

Source: `framework/v8_bindings_telemetry.zig`, `framework/qjs_runtime.zig`

These functions are separate from native `<Terminal>`:

| Function | Behavior |
| --- | --- |
| `__pty_open(cols, rows, shell?, cwd?)` | Opens a raw PTY handle. Defaults to `80`, `24`, and `bash`. |
| `__pty_read(handle)` | Reads available PTY output for that handle. |
| `__pty_write(handle, data)` | Writes raw bytes to the PTY. |
| `__pty_alive(handle)` | Checks liveness. |
| `__pty_close(handle)` | Closes the PTY. |
| `__pty_focus(handle)` | Sets the active raw PTY handle for legacy key routing. |
| `__pty_cwd(handle)` | Reads `/proc/<pid>/cwd` for the raw PTY child and returns the current working directory string. |

The native `Terminal` primitive does not use these handle APIs. It uses
`framework/vterm.zig` and the engine's terminal event path. The raw PTY API is
for tools or legacy UI code that wants PTY bytes in JS instead of native
cell-grid rendering.

## Multi-terminal caveat

The engine is shaped for multiple terminal slots:

- `MAX_TERMINALS = 4`
- each terminal node gets `terminal_id`
- event, paint, classifier, and scroll functions pass an index

But `framework/vterm_real.zig` currently has one global vterm and one global
PTY:

```zig
var g_vterm: ?VTerm = null;
var g_pty: ?pty_mod.Pty = null;
```

The indexed API is explicitly a compatibility layer:

```zig
// The refactor consolidated to a single terminal, but the engine API
// still passes a terminal index. These ignore the index and delegate.
```

So multiple `Terminal` nodes are not independent sessions today. In real mode,
calling `spawnShellIdx()` for another slot delegates to `spawnShell()`, which
closes any existing PTY before opening a new shell. Paint and input for all
slots ultimately read/write the same global libvterm/PTY state.

Treat current multi-terminal support as incomplete until `vterm_real.zig` owns
per-slot `VTerm` and `Pty` instances.

## Current caveats

- `Terminal` auto-spawns `bash`; there is no `shell` prop.
- `__terminal_set_cwd(path)` only affects the next spawn, not a running shell.
- Rows and columns are layout-derived; there are no `rows` or `cols` props.
- Terminal cells ignore `children`.
- Terminal cells do not use per-node `fontFamily`, `fontWeight`, `lineHeight`,
  `letterSpacing`, or `color`.
- The terminal feature can compile to a stub if `-Dhas-terminal=true` is not
  selected.
- The dependency registry references a missing `runtime/features/terminal.ts`
  marker, so terminal-only shipped carts should verify feature resolution.
- Multiple terminal nodes currently share one global PTY/vterm backend.
- Mouse wheel supports terminals inside `Canvas.Node`; click focus and drag
  selection likely do not because their hit-test path lacks the Canvas transform.
- Selection state is global, not per terminal node.
- Recording is global, not per terminal node.
- Semantic graph ticking is only performed for terminal `0`.
- `Ctrl+C` sends SIGINT to the shell; terminal copy is `Ctrl+Shift+C`.
- `F12` is not mapped in the current terminal key sequence table.

## Minimal debug checklist

When a `Terminal` renders blank:

1. Confirm the cart was built with `-Dhas-terminal=true`.
2. Confirm `libvterm` is available for the shipped binary.
3. Confirm the terminal node has non-zero computed width and height.
4. Confirm `paintTerminal()` is not skipping because `getRowsIdx(id) == 0`.
5. Confirm the frame tick discovered the node and called `spawnShellIdx()`.
6. Confirm `pty.openPty()` succeeded and the spawned shell is alive.
7. Confirm `pollPtyIdx()` receives bytes and marks classifier/layout dirty.
8. Confirm the terminal is at live scrollback offset when expecting cursor/input.
