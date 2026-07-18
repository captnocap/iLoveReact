# V8 Render surfaces

Last updated: 2026-05-04.

This document traces the `<Render>` pipeline end to end in the V8 runtime. In
this repository, `<Render>` means "paint an external pixel source inside the
ReactJIT layout tree": screen capture, window capture, v4l2/FFmpeg camera
capture, virtual X displays, QEMU/VNC VMs, and app embeds.

It is not React rendering, and it is not the `<Effect onRender>` pixel callback
pipeline. For visual generative effects, see `docs/v8/effects.md`.

## Mental model

`<Render renderSrc="...">` creates or finds a feed for an external pixel source.
Each frame:

1. `framework/render_surfaces.zig:update()` polls the feed backend for new RGBA
   pixels.
2. Dirty pixels upload to a wgpu texture.
3. `engine.zig` paints the node by calling `render_surfaces.paintSurface`.
4. `paintSurface` queues the feed texture as a quad through `gpu/images.zig`.

Input can flow back into interactive feeds. VNC and virtual-display feeds get
mouse and keyboard events before normal React hit testing handles them.

## Public TSX surface

`runtime/primitives.tsx` exposes two helpers:

```tsx
import { Render, RenderTarget } from '@reactjit/runtime/primitives';

<Render renderSrc="app:kitty" style={{ flexGrow: 1, width: '100%' }} />

// Alias wrapper: src -> renderSrc on a normal View.
<RenderTarget src="screen:0" style={{ width: 640, height: 360 }} />
```

`Render` emits a host node of type `"Render"`. The type is not special in
`v8_app.zig`; the `renderSrc` prop is what matters.

`RenderTarget` emits a `"View"` with `renderSrc: renderSrc ?? src`. It lands on
the same Zig node field and follows the same paint path.

### Props

```ts
type RenderProps = {
  renderSrc: string;
  renderSuspended?: boolean;
  style?: Record<string, any>;
};
```

`runtime/host_props.ts` documents `renderSrc`, but currently omits
`renderSuspended`; the V8 decoder and `layout.Node` both support it.

`src` is not a `<Render>` alias. Use `renderSrc` on `<Render>`, or use
`<RenderTarget src="...">`.

There are no JS callbacks for render-surface status or input. Status and input
are currently host-internal: the cart declares a source string, the engine owns
feed creation, polling, painting, suspension, focus, and event forwarding.

### Source strings

Parsed by `framework/render_surfaces.zig:parseSource`:

| Source | Backend | Meaning |
| --- | --- | --- |
| `screen:0` | XShm, FFmpeg fallback | Capture the current X display. The index is parsed but the current XShm path captures the active display connection. |
| `window:Firefox` | XShm | Find the first window matching title via `xdotool`, then capture that root-window rectangle. |
| `cam:0` | FFmpeg/v4l2 | Capture `/dev/video0` at 1280x720/30fps. |
| `hdmi:0` | FFmpeg/v4l2 | Same v4l2 path, intended for capture cards. |
| `/dev/video0` | FFmpeg/v4l2 | Direct video device path. |
| `display` or `self` | Xvfb + XShm | Start a virtual display sized from the node rect. |
| `display:1280x720` | Xvfb + XShm | Start a virtual display at an explicit resolution. |
| `app:<command>` | Xvfb + XShm | Start a virtual display, then launch `<command>` inside it. |
| `vm:/path/disk.qcow2` | QEMU + VNC | Boot a VM and capture its VNC framebuffer. |
| `/path/file.iso`, `.img`, `.qcow2`, `.qcow`, `.vmdk`, `.vdi`, `.vhd` | QEMU + VNC | Auto-detect VM source from extension. |
| `vnc:127.0.0.1:5901` | VNC | Connect directly to an existing VNC server. |
| `monitor:Name` | XShm | Placeholder-ish monitor capture path; currently captures the active screen size. |

Examples:

```tsx
const BROWSE_PORT = 7332;

<Render
  renderSrc={`app:browse --port ${BROWSE_PORT} --disposable`}
  renderSuspended={paused}
  style={{ flexGrow: 1, width: '100%' }}
/>

<Render renderSrc={`vm:/images/test.qcow2`} style={{ flexGrow: 1 }} />
<Render renderSrc="vnc:127.0.0.1:5910" style={{ width: 800, height: 600 }} />
```

## End-to-end pipeline

### 1. React to host mutation

`renderer/hostConfig.ts` handles `<Render>` like any other host node:

1. `createInstance("Render", props, ...)` allocates a numeric host id.
2. `extractHandlers` strips function props, though `<Render>` does not need
   special JS handlers for surface input.
3. The clean props emit in `CREATE`.
4. `resetAfterCommit` schedules a microtask flush.
5. `flushToHost` sends coalesced JSON to `globalThis.__hostFlush`.

`runtime/index.tsx` installs the transport:

```ts
setTransportFlush((cmds) => globalThis.__hostFlush(JSON.stringify(cmds)));
```

### 2. V8 host prop decode

`v8_app.zig:applyCommandBatch` parses the JSON. `applyProps` decodes:

- `renderSrc` -> `node.render_src`
- `renderSuspended` -> `node.render_suspended`

`removePropKeys` resets them on prop removal:

- `renderSrc` -> `null`
- `renderSuspended` -> `false`

There is no `applyTypeDefaults` branch for type `"Render"`. A `"View"` with
`renderSrc` and a `"Render"` with `renderSrc` are equivalent to layout and
paint.

### 3. Layout

`framework/layout.zig` gives nodes with `render_src` the same layout behavior
as video nodes:

```zig
if (node.video_src != null or node.render_src != null) {
    node.computed = .{
        .x = px,
        .y = py,
        .w = @min(pw, 8192),
        .h = @min(ph, 8192),
    };
    return;
}
```

The render node fills its parent bounds and clamps dimensions to 8192 to avoid
exceeding GPU texture limits. Children are not laid out in this branch.

### 4. Frame update

Before paint, `engine.zig` calls:

```zig
render_surfaces.update();
```

`update()` walks up to `MAX_FEEDS = 8` feed slots. For ready feeds:

- `xshm` / `display_xshm`: `captureXShm(feed)`
- `ffmpeg`: `updateFFmpeg(feed)`
- `vnc`: `render_surfaces_vm.updateVnc(feed)`

When a feed becomes dirty, `ensureTexture(feed)` creates the wgpu texture,
view, sampler, and image bind group if needed. `uploadPixels(feed)` forces
alpha to `0xff`, row-flips into a scratch buffer, and writes the texture via
`queue.writeTexture`.

The row flip keeps `pixel_buf` canonical top-down for incremental VNC rects
while compensating for the shared image shader's Y flip.

Feeds not painted for `UNLOAD_DEBOUNCE_FRAMES = 180` ready frames are deinited.
The common pattern in `cart/testing_carts/render-test.tsx` keeps hidden panes
mounted with zero width/flex so feeds stay active and preserve VM/app state.

### 5. Paint

During `engine.zig:paintNode`, a render node paints after video and before
effect/3D paths:

```zig
if (node.render_src) |src| {
    render_surfaces.setSuspended(src, node.render_suspended);
    _ = render_surfaces.paintSurface(src, r.x, r.y, r.w, r.h, g_paint_opacity);
}
```

`paintSurface`:

1. Finds an existing feed by source string, or calls `createFeed(src, w, h)`.
2. Marks the feed active for the unload debounce.
3. Returns early unless `status == .ready` and a texture bind group exists.
4. Computes the draw rectangle.
5. Stores node/draw rectangles for input coordinate mapping.
6. Queues the texture quad with `images.queueQuad`.

Draw sizing depends on backend:

- `display_xshm`: stretch-fill the full node rect. This makes app embeds feel
  like the app owns the pane.
- all other backends: contain-fit inside the node rect while preserving source
  aspect ratio.

## Feed creation by backend

### XShm screen/window/monitor capture

`initXShm()` lazily `dlopen`s X11/Xext/XTest symbols, opens `DISPLAY`, and
checks XShm support.

For `screen:...`, `createFeed` creates an XShm image at the display width and
height. If XShm setup fails, it falls back to FFmpeg x11grab at 1920x1080.

For `window:<title>`, it shells through `xdotool` to find the first matching
window and geometry, clamps that geometry to screen bounds, then captures that
root-window rectangle.

`captureXShm` calls `XShmGetImage`, converts BGRX to RGBA, writes
`feed.pixel_buf`, and marks the feed dirty.

### FFmpeg/v4l2

`cam:`, `hdmi:`, and `/dev/video*` spawn:

```text
ffmpeg -nostdin -loglevel quiet -f v4l2 -framerate 30 -video_size WxH -i DEVICE -f rawvideo -pix_fmt rgba -an -sn -
```

`screen:` fallback uses `-f x11grab`. FFmpeg stdout is owned by an injected-Io
`std.Io.File.MultiReader`; `updateFFmpeg` uses a zero-duration fill to harvest
already-completed bytes without blocking the frame and accumulates exactly one
raw RGBA frame before marking the feed dirty. It does not set `O_NONBLOCK` or
probe the raw fd.

### Virtual display and app embeds

`display`, `display:WxH`, and `app:<command>` use the `display_xshm` backend:

1. Find a free X display number from `:10` through `:99`.
2. Spawn `Xvfb :N -screen 0 WxHx24`.
3. Wait `startup_wait` frames.
4. Open a dedicated X connection to `:N`.
5. Create an XShm capture for the virtual root window.
6. For `app:<command>`, launch `DISPLAY=:N <command>`, then use `xdotool` to
   resize and move the first visible window to fill the display.

Virtual display feeds are marked `interactive`.

### QEMU VM and VNC

`vm:<path>` and VM-like file extensions call `render_surfaces_vm.startVM`:

1. Find a free localhost VNC port from `5910` to `5998`.
2. Spawn `qemu-system-x86_64`.
3. Enable KVM when `/dev/kvm` exists.
4. Use `-cdrom ... -boot d` for `.iso`; otherwise use `-drive file=...,format=raw`.
5. Add `-vnc :N`, `-usb`, `-device usb-tablet`, `-display none`.
6. Wait for startup, then connect to VNC.

Direct `vnc:host:port` skips QEMU and connects to the provided server.

The VNC client implements the RFB handshake, selects no-auth security type,
requests 32bpp true-color raw encoding, then reads framebuffer updates. It
allows only one framebuffer update request in flight; after the first full
request it switches to incremental requests so QEMU does not flood the TCP
buffer.

RAW full-frame and partial-rect updates write into `feed.pixel_buf`; DesktopSize
pseudo-encoding resizes the feed and releases old wgpu texture resources.

## Input forwarding

`framework/render_surfaces.zig` re-exports input handlers from
`framework/render_surfaces_vm.zig`. `engine.zig` calls them before most normal
React/UI input handling:

- mouse down: `handleMouseDown`
- mouse motion: `handleMouseMotion`
- mouse up: `handleMouseUp`
- text input: `handleTextInput`
- key down: `handleKeyDown`
- key up: `handleKeyUp`

Hit testing uses the full node rect recorded by `paintSurface`, not only the
contain-fit draw rect. Coordinate mapping to the framebuffer uses the draw rect.

Only feeds with `interactive = true`, `status == .ready`, and
`suspended == false` can receive input. Current interactive backends are VNC and
virtual displays.

Forwarding paths:

- VNC: send RFB key and pointer events over the feed socket.
- `display_xshm`: use XTest for low-latency synthetic keyboard/mouse events
  through the virtual display connection; fall back to `xdotool` subprocesses
  when XTest is unavailable.

`handleTextInput` consumes focused printable text events because KEYDOWN already
sends key events; without this, printable keys would be delivered twice.

## Suspension

`renderSuspended={true}` calls `render_surfaces.setSuspended(src, true)` during
paint. That sends `SIGSTOP` to the feed's spawned processes:

- QEMU child
- Xvfb child
- app child launched inside Xvfb

The last uploaded texture stays alive and continues to paint. Toggling back to
false sends `SIGCONT`.

Suspended feeds skip update polling and input forwarding. If a focused feed is
suspended, key down returns false so the rest of the ReactJIT UI can handle the
keystroke instead of dropping it.

## Resource lifetime

Feed slots live in a fixed array:

- `MAX_FEEDS = 8`
- stopped slots are reused
- active source strings are copied into feed-owned page-allocator memory
- feed cleanup releases wgpu bind groups/views/samplers/textures, pixel buffers,
  XShm resources, VNC sockets, FFmpeg, QEMU, Xvfb, and app children

Texture cleanup uses `release()` rather than immediate `destroy()` so queued
draws that still reference the bind group do not trip wgpu validation.

`ZIGOS_HEADLESS=1` disables feed creation. This prevents snapshot/autotest runs
from orphaning QEMU/Xvfb/app subprocesses.

## Internal API surface

`framework/render_surfaces.zig` exposes the engine-facing API:

```zig
pub fn init() void
pub fn deinit() void
pub fn update() void
pub fn paintSurface(src: []const u8, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool
pub fn setSuspended(src: []const u8, suspended: bool) void
pub fn getStatus(src: []const u8) ?FeedStatus
pub fn isInteractive(src: []const u8) bool
pub fn getDimensions(src: []const u8) ?struct { w: u32, h: u32 }
```

It also re-exports input forwarding from `render_surfaces_vm.zig`:

```zig
pub const handleMouseDown = vm.handleMouseDown;
pub const handleMouseUp = vm.handleMouseUp;
pub const handleMouseMotion = vm.handleMouseMotion;
pub const handleKeyDown = vm.handleKeyDown;
pub const handleKeyUp = vm.handleKeyUp;
pub const handleTextInput = vm.handleTextInput;
pub const hasFocus = vm.hasFocus;
```

Those functions are not registered as JS host functions today. The only
cart-facing API is the TSX prop surface.

## Known gaps and gotchas

- `<Render>` must use `renderSrc`; `src` only works through `RenderTarget`.
- The host prop advisory type currently lacks `renderSuspended`.
- `RenderTarget`'s source comment mentions hot-loadable `.so` render hooks,
  but the live code routes through `render_surfaces.zig` just like `<Render>`.
- `screen:` parses an index, but the current XShm path captures the active X
  display connection rather than selecting a distinct monitor by index.
- `monitor:` is not a full xrandr virtual monitor implementation today; it uses
  the active screen dimensions.
- VM drives are always passed to QEMU as `format=raw` unless they are ISOs,
  even when the extension is `.qcow2`.
- `paintSurface` creates the feed during paint. First paint commonly returns
  false while the backend starts and uploads its first frame.
- All app/VM/display surfaces are Linux/X11-oriented. They depend on tools such
  as Xvfb, xdotool, ffmpeg, QEMU, and X11/XShm/XTest libraries being present.

## Related files

- `runtime/primitives.tsx` - `<Render>` and `<RenderTarget>`.
- `runtime/host_props.ts` - advisory `renderSrc` prop surface.
- `renderer/hostConfig.ts` - React reconciler mutation commands.
- `v8_app.zig` - `renderSrc` / `renderSuspended` prop decode.
- `framework/layout.zig` - render node layout behavior and `render_suspended`
  field.
- `framework/engine.zig` - per-frame update, paint call, and input forwarding
  order.
- `framework/render_surfaces.zig` - feed parsing, backend creation, polling,
  texture upload, painting, suspension, resource lifetime.
- `framework/render_surfaces_vm.zig` - VNC client, QEMU boot, coordinate
  mapping, keyboard/mouse forwarding.
- `framework/gpu/images.zig` - textured quad bind group and queue.
- `cart/testing_carts/render-test.tsx` - split app/VM render test.
- `cart/browse-mvp.tsx` - browser app embed through `app:browse ...`.
