//! ReactJIT Multi-Window Manager
//!
//! Three window types, one API:
//!
//!   .in_process    — SDL3 renderer in the same process. Zero latency, shared memory.
//!                    Use for: inspector, devtools, debug panels.
//!
//!   .notification  — In-process + X11 notification hints. No focus steal, auto-dismiss.
//!                    Use for: toast notifications, alerts, transient overlays.
//!
//!   .independent   — Separate OS process connected via TCP/NDJSON. Own wgpu surface.
//!                    Use for: docked multi-window UIs, complex multi-panel apps.
//!
//! In-process windows use the SDL3 2D renderer (not wgpu) because gpu.zig is a
//! singleton bound to one surface. This is intentional — secondary windows don't
//! need the full GPU pipeline. Independent windows each get their own process
//! with their own wgpu.
//!
//! Usage:
//!   const win = windows.open("Inspector", 400, 600, .in_process);
//!   windows.setRoot(win, &inspector_tree);
//!   // In main loop:
//!   windows.layoutAll();
//!   windows.paintAndPresent();
//!   // Event loop:
//!   windows.routeEvent(&event);

const std = @import("std");
const builtin = @import("builtin");
const c = @import("../c.zig").imports;
const layout = @import("../layout.zig");
const state_mod = @import("../state/dirty.zig");
const text_mod = @import("text.zig");
const events = @import("../events.zig");
const log = @import("../diag/log.zig");
const ipc = @import("../net/ipc.zig");

const Node = layout.Node;
const Color = layout.Color;
const TextEngine = text_mod.TextEngine;

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

pub const WindowKind = enum {
    /// Same process, SDL3 renderer. Shared address space, zero IPC overhead.
    in_process,
    /// Same process, SDL3 renderer + X11 notification window type.
    /// No focus steal, optional auto-dismiss timer.
    notification,
    /// Separate OS process with its own wgpu surface, connected via TCP/NDJSON.
    /// Full rendering pipeline, crash-isolated.
    independent,
};

const MAX_WINDOWS = 32;

pub const WindowSlot = struct {
    active: bool = false,
    kind: WindowKind = .in_process,

    // SDL3 (in_process + notification)
    window: ?*c.SDL_Window = null,
    renderer: ?*c.SDL_Renderer = null,
    sdl_window_id: u32 = 0,
    text_engine: ?TextEngine = null,
    root: ?*Node = null,
    hovered: ?*Node = null,
    win_w: f32 = 400,
    win_h: f32 = 300,
    bg_color: Color = Color.rgb(24, 24, 32),

    // Notification-specific
    auto_dismiss_ms: u32 = 0, // 0 = no auto-dismiss
    created_at: u32 = 0, // SDL_GetTicks at creation
    opacity: f32 = 1.0, // for fade in/out

    // Independent-specific (TCP/NDJSON)
    server: ?ipc.Server = null,
    child: ?std.process.Child = null,
    pending: std.ArrayList(u8) = .empty,
};

var slots: [MAX_WINDOWS]WindowSlot = [_]WindowSlot{.{}} ** MAX_WINDOWS;
var slot_count: usize = 0;
var g_js_dispatch_context: ?*anyopaque = null;
var g_js_dispatch_fn: ?*const fn (*anyopaque, u32, []const u8) void = null;
var g_sdl_inited: bool = false;
const WrappedLine = struct { start: usize, end: usize };

pub fn setJsDispatchFn(context: *anyopaque, f: *const fn (*anyopaque, u32, []const u8) void) void {
    g_js_dispatch_context = context;
    g_js_dispatch_fn = f;
}

// ── SDL3 lifecycle ─────────────────────────────────────────────────
//
// Lazy SDL_Init the first time a Window opens. Deferred so a TUI binary
// built with -Dhas-window=true but with a cart that never opens a
// <Window> doesn't pay the SDL_Init cost.

pub fn ensureSdlInited() bool {
    if (g_sdl_inited) return true;
    if (!c.SDL_Init(c.SDL_INIT_VIDEO)) {
        std.debug.print("[windows] SDL_Init failed\n", .{});
        return false;
    }
    g_sdl_inited = true;
    return true;
}

pub fn isSdlInited() bool {
    return g_sdl_inited;
}

pub fn shutdownSdl() void {
    if (!g_sdl_inited) return;
    c.SDL_Quit();
    g_sdl_inited = false;
}

/// Pump every queued SDL3 event into routeEvent. Drains the queue.
/// Returns when SDL_PollEvent has no more events to deliver.
pub fn pumpEvents(io: std.Io) void {
    if (!g_sdl_inited) return;
    var event: c.SDL_Event = undefined;
    while (c.SDL_PollEvent(&event)) {
        _ = routeEvent(io, &event);
    }
}

fn dispatchJs(node: *Node, handler: []const u8) bool {
    const f = g_js_dispatch_fn orelse return false;
    const context = g_js_dispatch_context orelse return false;
    if (node.scroll_persist_slot == 0) return false;
    f(context, node.scroll_persist_slot, handler);
    state_mod.markDirty();
    return true;
}

fn dispatchJsById(id: u32, handler: []const u8) bool {
    const f = g_js_dispatch_fn orelse return false;
    const context = g_js_dispatch_context orelse return false;
    if (id == 0) return false;
    f(context, id, handler);
    state_mod.markDirty();
    return true;
}

// ════════════════════════════════════════════════════════════════════════
// Open / Close
// ════════════════════════════════════════════════════════════════════════

pub const OpenOptions = struct {
    title: [*:0]const u8 = "Window",
    width: c_int = 400,
    height: c_int = 300,
    kind: WindowKind = .in_process,
    /// For notifications: auto-dismiss after N milliseconds (0 = manual close).
    auto_dismiss_ms: u32 = 5000,
    /// Position: null = SDL_WINDOWPOS_CENTERED
    x: ?c_int = null,
    y: ?c_int = null,
    /// Background color
    bg_color: Color = Color.rgb(24, 24, 32),
    /// Always on top (notifications default to true)
    always_on_top: bool = false,
    /// Borderless window (notifications default to true)
    borderless: bool = false,
    /// React host node id for independent child event routing.
    window_id: u32 = 0,
};

/// Check if any window with this root is already open.
pub fn isRootOpen(root: *Node) bool {
    for (0..MAX_WINDOWS) |i| {
        if (slots[i].active and slots[i].root == root) return true;
    }
    return false;
}

/// Open a new window. Returns slot index, or null on failure.
pub fn open(io: std.Io, environ: *const std.process.Environ.Map, opts: OpenOptions) ?usize {
    // Find a free slot
    var idx: usize = 0;
    while (idx < MAX_WINDOWS) : (idx += 1) {
        if (!slots[idx].active) break;
    }
    if (idx >= MAX_WINDOWS) {
        log.warn(.engine, "windows: all {d} slots full", .{MAX_WINDOWS});
        return null;
    }

    switch (opts.kind) {
        .in_process, .notification => return openInProcess(idx, opts),
        .independent => return openIndependent(io, environ, idx, opts),
    }
}

fn openInProcess(idx: usize, opts: OpenOptions) ?usize {
    const is_notif = opts.kind == .notification;
    const pos_x = opts.x orelse c.SDL_WINDOWPOS_CENTERED;
    const pos_y = opts.y orelse c.SDL_WINDOWPOS_CENTERED;

    var flags: u64 = c.SDL_WINDOW_RESIZABLE;
    if (is_notif or opts.borderless) flags |= c.SDL_WINDOW_BORDERLESS;
    if (is_notif or opts.always_on_top) flags |= c.SDL_WINDOW_ALWAYS_ON_TOP;
    // Notifications should not steal focus or be resizable
    if (is_notif) flags = (flags & ~@as(u64, c.SDL_WINDOW_RESIZABLE)) | c.SDL_WINDOW_HIDDEN | c.SDL_WINDOW_NOT_FOCUSABLE | c.SDL_WINDOW_UTILITY;

    const window = c.SDL_CreateWindow(
        opts.title,
        opts.width,
        opts.height,
        flags,
    ) orelse {
        log.err(.engine, "windows: SDL_CreateWindow failed", .{});
        return null;
    };
    // SDL3: position is set after creation
    _ = c.SDL_SetWindowPosition(window, pos_x, pos_y);
    // Show the window (was implicit with SDL_WINDOW_SHOWN, now explicit for non-hidden)
    if (!is_notif) _ = c.SDL_ShowWindow(window);

    const renderer = c.SDL_CreateRenderer(
        window,
        null,
    ) orelse {
        log.err(.engine, "windows: SDL_CreateRenderer failed", .{});
        c.SDL_DestroyWindow(window);
        return null;
    };
    _ = c.SDL_SetRenderDrawBlendMode(renderer, c.SDL_BLENDMODE_BLEND);

    const sdl_id = c.SDL_GetWindowID(window);

    // Each in-process window gets its own text engine (SDL3 renderer mode)
    const te = TextEngine.init(renderer, "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf") catch {
        log.err(.engine, "windows: TextEngine init failed", .{});
        c.SDL_DestroyRenderer(renderer);
        c.SDL_DestroyWindow(window);
        return null;
    };

    // X11 notification window type hint
    if (is_notif) setX11NotificationType(window);
    if (is_notif) _ = c.SDL_ShowWindow(window);

    slots[idx] = .{
        .active = true,
        .kind = opts.kind,
        .window = window,
        .renderer = renderer,
        .sdl_window_id = sdl_id,
        .text_engine = te,
        .root = null,
        .hovered = null,
        .win_w = @floatFromInt(opts.width),
        .win_h = @floatFromInt(opts.height),
        .bg_color = opts.bg_color,
        .auto_dismiss_ms = if (is_notif) opts.auto_dismiss_ms else 0,
        .created_at = @truncate(c.SDL_GetTicks()),
        .opacity = if (is_notif) 0.0 else 1.0, // notifications fade in
    };
    slot_count += 1;

    log.info(.engine, "windows: opened slot {d} ({s}) as {s}", .{
        idx,
        opts.title,
        if (is_notif) "notification" else "in_process",
    });
    layout.markLayoutDirty();
    return idx;
}

fn openIndependent(io: std.Io, environ: *const std.process.Environ.Map, idx: usize, opts: OpenOptions) ?usize {
    var server = ipc.Server.bind(std.heap.c_allocator, io, 0) catch |err| {
        log.err(.engine, "windows: independent IPC bind failed: {}", .{err});
        return null;
    };
    errdefer server.close();

    const alloc = std.heap.c_allocator;
    const exe_path = std.process.executablePathAlloc(io, alloc) catch |err| {
        log.err(.engine, "windows: self exe path failed: {}", .{err});
        return null;
    };
    defer alloc.free(exe_path);
    const launcher_path = findChildLauncher(io, alloc, exe_path) catch |err| {
        log.err(.engine, "windows: child launcher resolve failed: {}", .{err});
        return null;
    };
    defer alloc.free(launcher_path);

    var port_buf: [16]u8 = undefined;
    const port_s = std.fmt.bufPrint(&port_buf, "{d}", .{server.getPort()}) catch return null;
    var w_buf: [16]u8 = undefined;
    const w_s = std.fmt.bufPrint(&w_buf, "{d}", .{opts.width}) catch return null;
    var h_buf: [16]u8 = undefined;
    const h_s = std.fmt.bufPrint(&h_buf, "{d}", .{opts.height}) catch return null;
    var id_buf: [16]u8 = undefined;
    const id_s = std.fmt.bufPrint(&id_buf, "{d}", .{opts.window_id}) catch return null;

    var env = cloneEnvironment(alloc, environ) catch |err| {
        log.err(.engine, "windows: child env inherit failed: {}", .{err});
        return null;
    };
    defer env.deinit();
    env.put("ZIGOS_WINDOW_CHILD", "1") catch return null;
    env.put("ZIGOS_IPC_PORT", port_s) catch return null;
    env.put("ZIGOS_WINDOW_W", w_s) catch return null;
    env.put("ZIGOS_WINDOW_H", h_s) catch return null;
    env.put("ZIGOS_WINDOW_TITLE", std.mem.span(opts.title)) catch return null;
    env.put("ZIGOS_WINDOW_ID", id_s) catch return null;
    if (opts.x) |x| {
        var x_buf: [16]u8 = undefined;
        const x_s = std.fmt.bufPrint(&x_buf, "{d}", .{x}) catch return null;
        env.put("ZIGOS_WINDOW_X", x_s) catch return null;
    }
    if (opts.y) |y| {
        var y_buf: [16]u8 = undefined;
        const y_s = std.fmt.bufPrint(&y_buf, "{d}", .{y}) catch return null;
        env.put("ZIGOS_WINDOW_Y", y_s) catch return null;
    }
    if (opts.borderless) env.put("ZIGOS_WINDOW_BORDERLESS", "1") catch return null;
    if (opts.always_on_top) env.put("ZIGOS_WINDOW_ALWAYS_ON_TOP", "1") catch return null;
    if (opts.kind == .notification) {
        var dismiss_buf: [16]u8 = undefined;
        const dismiss_s = std.fmt.bufPrint(&dismiss_buf, "{d}", .{opts.auto_dismiss_ms}) catch return null;
        env.put("ZIGOS_WINDOW_NOTIFICATION", "1") catch return null;
        env.put("ZIGOS_WINDOW_NOT_FOCUSABLE", "1") catch return null;
        env.put("ZIGOS_WINDOW_AUTO_DISMISS_MS", dismiss_s) catch return null;
    }

    const argv = [_][]const u8{ launcher_path, "--window-child" };
    const child = std.process.spawn(io, .{
        .argv = &argv,
        .environ_map = &env,
        .stdin = .ignore,
        .stdout = .inherit,
        .stderr = .inherit,
    }) catch |err| {
        log.err(.engine, "windows: child spawn failed: {}", .{err});
        return null;
    };

    slots[idx] = .{
        .active = true,
        .kind = .independent,
        .server = server,
        .child = child,
        .win_w = @floatFromInt(opts.width),
        .win_h = @floatFromInt(opts.height),
        .bg_color = opts.bg_color,
    };
    slot_count += 1;
    log.print("[window-ipc/parent] spawn slot={d} title={s} launcher={s} port={d} size={d}x{d} window_id={d}\n", .{
        idx,
        opts.title,
        launcher_path,
        slots[idx].server.?.getPort(),
        opts.width,
        opts.height,
        opts.window_id,
    });
    log.info(.engine, "windows: opened slot {d} ({s}) as independent IPC port {d}", .{
        idx,
        opts.title,
        slots[idx].server.?.getPort(),
    });
    return idx;
}

fn cloneEnvironment(alloc: std.mem.Allocator, source: *const std.process.Environ.Map) !std.process.Environ.Map {
    var result = std.process.Environ.Map.init(alloc);
    errdefer result.deinit();
    for (source.keys(), source.values()) |key, value| try result.put(key, value);
    return result;
}

fn findChildLauncher(io: std.Io, alloc: std.mem.Allocator, exe_path: []const u8) ![]u8 {
    const dir = std.fs.path.dirname(exe_path) orelse return alloc.dupe(u8, exe_path);
    const run_path = try std.fs.path.join(alloc, &.{ dir, "run" });
    if (std.Io.Dir.accessAbsolute(io, run_path, .{})) |_| {
        return run_path;
    } else |_| {
        alloc.free(run_path);
    }

    // When the packaged app is launched through the bundled dynamic loader,
    // /proc/self/exe resolves to .../lib/ld-linux-x86-64.so.2. The wrapper's
    // runnable entrypoint is one directory above that loader.
    const parent = std.fs.path.dirname(dir) orelse return alloc.dupe(u8, exe_path);
    const parent_run_path = try std.fs.path.join(alloc, &.{ parent, "run" });
    if (std.Io.Dir.accessAbsolute(io, parent_run_path, .{})) |_| {
        return parent_run_path;
    } else |_| {
        alloc.free(parent_run_path);
        return alloc.dupe(u8, exe_path);
    }
}

/// Close a window by slot index.
pub fn close(io: std.Io, idx: usize) void {
    if (idx >= MAX_WINDOWS or !slots[idx].active) return;

    switch (slots[idx].kind) {
        .in_process, .notification => {
            if (slots[idx].text_engine) |*te| te.deinit();
            if (slots[idx].renderer) |r| c.SDL_DestroyRenderer(r);
            if (slots[idx].window) |w| c.SDL_DestroyWindow(w);
        },
        .independent => {
            if (slots[idx].server) |*server| {
                _ = server.sendLine("{\"type\":\"quit\"}");
                server.close();
            }
            if (slots[idx].child) |*child| {
                child.kill(io);
            }
            slots[idx].pending.deinit(std.heap.c_allocator);
        },
    }

    log.info(.engine, "windows: closed slot {d}", .{idx});
    slots[idx] = .{};
    if (slot_count > 0) slot_count -= 1;
}

/// Close all windows.
pub fn deinitAll(io: std.Io) void {
    for (0..MAX_WINDOWS) |i| {
        if (slots[i].active) close(io, i);
    }
}

// ════════════════════════════════════════════════════════════════════════
// Tree binding
// ════════════════════════════════════════════════════════════════════════

/// Set the root node tree for a window.
pub fn setRoot(idx: usize, root: *Node) void {
    if (idx >= MAX_WINDOWS or !slots[idx].active) return;
    slots[idx].root = root;
    layout.markLayoutDirty();
}

/// Per-mutation send/queue logs are gated behind ZIGOS_TRACE_IPC=1. A fat
/// initial cart paint is ~3000 mutations and the per-line logs drown
/// everything else. Once-per-window logs (spawn/accept/flush/recv) stay
/// on unconditionally.
fn ipcTracePerMessage(environ: *const std.process.Environ.Map) bool {
    const env = environ.get("ZIGOS_TRACE_IPC") orelse return false;
    return env.len > 0 and env[0] != '0';
}

/// Queue or send one NDJSON message to an independent child window.
pub fn sendLineToChild(environ: *const std.process.Environ.Map, idx: usize, line: []const u8) void {
    if (idx >= MAX_WINDOWS or !slots[idx].active or slots[idx].kind != .independent) return;
    const trace = ipcTracePerMessage(environ);
    if (slots[idx].server) |*server| {
        if (server.connected() and server.sendLine(line)) {
            if (trace) log.print("[window-ipc/parent] send slot={d} bytes={d}\n", .{ idx, line.len });
            return;
        }
    }
    slots[idx].pending.appendSlice(std.heap.c_allocator, line) catch return;
    slots[idx].pending.append(std.heap.c_allocator, '\n') catch {};
    if (trace) log.print("[window-ipc/parent] queue slot={d} bytes={d} pending={d}\n", .{
        idx,
        line.len,
        slots[idx].pending.items.len,
    });
}

pub fn tickIndependent() void {
    for (0..MAX_WINDOWS) |i| {
        if (!slots[i].active or slots[i].kind != .independent) continue;
        const server = &(slots[i].server orelse continue);
        const was_connected = server.connected();
        _ = server.acceptClient();
        if (!was_connected and server.connected()) {
            log.print("[window-ipc/parent] accepted slot={d} pending={d}\n", .{ i, slots[i].pending.items.len });
        }
        if (server.connected() and slots[i].pending.items.len > 0) {
            if (server.send(slots[i].pending.items)) {
                log.print("[window-ipc/parent] flush slot={d} bytes={d}\n", .{ i, slots[i].pending.items.len });
                slots[i].pending.clearRetainingCapacity();
            }
        }
        const messages = server.poll();
        for (messages) |msg| {
            log.print("[window-ipc/parent] recv slot={d} bytes={d} {s}\n", .{ i, msg.data.len, msg.data });
            handleChildMessage(msg.data);
        }
    }
}

fn handleChildMessage(line: []const u8) void {
    const parsed = std.json.parseFromSlice(std.json.Value, std.heap.c_allocator, line, .{}) catch return;
    defer parsed.deinit();
    if (parsed.value != .object) return;
    const typ_v = parsed.value.object.get("type") orelse return;
    if (typ_v != .string) return;
    if (std.mem.eql(u8, typ_v.string, "event")) {
        const target_v = parsed.value.object.get("targetId") orelse return;
        const handler_v = parsed.value.object.get("handler") orelse return;
        if (target_v != .integer or handler_v != .string) return;
        _ = dispatchJsById(@intCast(target_v.integer), handler_v.string);
    } else if (std.mem.eql(u8, typ_v.string, "windowEvent")) {
        const target_v = parsed.value.object.get("targetId") orelse return;
        const handler_v = parsed.value.object.get("handler") orelse return;
        if (target_v != .integer or handler_v != .string) return;
        _ = dispatchJsById(@intCast(target_v.integer), handler_v.string);
    }
}

// ════════════════════════════════════════════════════════════════════════
// Event routing
// ════════════════════════════════════════════════════════════════════════

/// Find which window slot an SDL window ID belongs to. Returns null for main window.
pub fn findByWindowId(sdl_window_id: u32) ?usize {
    for (0..MAX_WINDOWS) |i| {
        if (slots[i].active and slots[i].sdl_window_id == sdl_window_id) return i;
    }
    return null;
}

/// Route an SDL event to the correct window. Returns true if the event was consumed.
/// The engine should call this before its own event handling — if it returns true,
/// the event belongs to a secondary window and the engine should skip it.
pub fn routeEvent(io: std.Io, event: *c.SDL_Event) bool {
    switch (event.type) {
        c.SDL_EVENT_WINDOW_CLOSE_REQUESTED => {
            const win_id = event.window.windowID;
            const idx = findByWindowId(win_id) orelse return false;
            close(io, idx);
            return true;
        },
        c.SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED => {
            const win_id = event.window.windowID;
            const idx = findByWindowId(win_id) orelse return false;
            if (slots[idx].window) |w| {
                var ww: c_int = 0;
                var wh: c_int = 0;
                _ = c.SDL_GetWindowSize(w, &ww, &wh);
                slots[idx].win_w = @floatFromInt(ww);
                slots[idx].win_h = @floatFromInt(wh);
                layout.markLayoutDirty();
            }
            return true;
        },
        c.SDL_EVENT_MOUSE_BUTTON_DOWN => {
            const win_id = event.button.windowID;
            const idx = findByWindowId(win_id) orelse return false;
            if (event.button.button == c.SDL_BUTTON_LEFT) {
                handleClick(idx, event.button.x, event.button.y);
            }
            return true;
        },
        c.SDL_EVENT_MOUSE_MOTION => {
            const win_id = event.motion.windowID;
            const idx = findByWindowId(win_id) orelse return false;
            handleMouseMotion(idx, event.motion.x, event.motion.y);
            return true;
        },
        c.SDL_EVENT_MOUSE_WHEEL => {
            const win_id = event.wheel.windowID;
            const idx = findByWindowId(win_id) orelse return false;
            handleWheel(idx, event.wheel.mouse_x, event.wheel.mouse_y, event.wheel.y);
            return true;
        },
        else => return false,
    }
}

fn handleMouseMotion(idx: usize, mx: f32, my: f32) void {
    if (idx >= MAX_WINDOWS or !slots[idx].active) return;
    if (slots[idx].root) |root| {
        const prev = slots[idx].hovered;
        slots[idx].hovered = events.hitTestHoverable(root, mx, my);
        if (prev != slots[idx].hovered) {
            if (prev) |p| {
                if (p.handlers.on_hover_exit) |h| h(p.handlers.context);
                if (p.handlers.js_on_hover_exit != null) _ = dispatchJs(p, "onHoverExit");
            }
            if (slots[idx].hovered) |n| {
                if (n.handlers.on_hover_enter) |h| h(n.handlers.context);
                if (n.handlers.js_on_hover_enter != null) _ = dispatchJs(n, "onHoverEnter");
            }
        }
    }
}

fn handleClick(idx: usize, mx: f32, my: f32) void {
    if (idx >= MAX_WINDOWS or !slots[idx].active) return;
    if (slots[idx].root) |root| {
        if (events.hitTest(root, mx, my)) |node| {
            if (node.handlers.on_press) |handler| handler(node.handlers.context) else if (node.handlers.js_on_press != null) _ = dispatchJs(node, "onClick");
        }
    }
}

fn handleWheel(idx: usize, mx: f32, my: f32, dy: f32) void {
    if (idx >= MAX_WINDOWS or !slots[idx].active) return;
    if (slots[idx].root) |root| {
        if (events.findScrollContainer(root, mx, my)) |scroll_node| {
            scroll_node.scroll_y -= dy * 30.0;
            const max_scroll = @max(0.0, scroll_node.content_height - scroll_node.computed.h);
            scroll_node.scroll_y = @max(0.0, @min(scroll_node.scroll_y, max_scroll));
        }
    }
}

// ════════════════════════════════════════════════════════════════════════
// Layout
// ════════════════════════════════════════════════════════════════════════

/// Layout all active in-process windows.
pub fn layoutAll() void {
    for (0..MAX_WINDOWS) |i| {
        if (!slots[i].active) continue;
        if (slots[i].kind == .independent) continue; // independent windows layout themselves
        if (slots[i].root) |root| {
            layout.layout(root, 0, 0, slots[i].win_w, slots[i].win_h);
        }
    }
}

// ════════════════════════════════════════════════════════════════════════
// Paint (SDL3 renderer for in-process windows)
// ════════════════════════════════════════════════════════════════════════

/// Paint and present all active in-process windows.
pub fn paintAndPresent(io: std.Io) void {
    const now: u32 = @truncate(c.SDL_GetTicks());

    for (0..MAX_WINDOWS) |i| {
        if (!slots[i].active) continue;
        if (slots[i].kind == .independent) continue;

        // Notification lifecycle: fade in, hold, fade out, auto-close
        if (slots[i].kind == .notification) {
            if (!tickNotification(io, i, now)) continue; // was closed
        }

        const rend = slots[i].renderer orelse continue;
        const root = slots[i].root orelse continue;
        if (slots[i].text_engine == null) continue;
        const te: *TextEngine = &slots[i].text_engine.?;

        // Clear with background color
        const bg = slots[i].bg_color;
        _ = c.SDL_SetRenderDrawColor(rend, bg.r, bg.g, bg.b, bg.a);
        _ = c.SDL_RenderClear(rend);

        // Paint tree
        paintNode(rend, te, root, slots[i].hovered, slots[i].opacity);

        _ = c.SDL_RenderPresent(rend);
    }
}

fn paintNode(
    rend: *c.SDL_Renderer,
    te: *TextEngine,
    node: *Node,
    hovered: ?*Node,
    window_opacity: f32,
) void {
    paintNodeImpl(rend, te, node, hovered, window_opacity, 1.0);
}

fn paintNodeImpl(
    rend: *c.SDL_Renderer,
    te: *TextEngine,
    node: *Node,
    hovered: ?*Node,
    window_opacity: f32,
    parent_opacity: f32,
) void {
    if (node.style.display == .none) return;
    const effective_opacity = parent_opacity * node.style.opacity * window_opacity;
    if (effective_opacity <= 0) return;

    const r = node.computed;
    const fx = r.x;
    const fy = r.y;
    const fw = r.w;
    const fh = r.h;

    // Background
    if (node.style.background_color) |col| {
        const is_hov = (hovered != null and hovered.? == node);
        const paint_col = if (is_hov) brightenColor(col) else col;
        const a: u8 = @intFromFloat(@as(f32, @floatFromInt(paint_col.a)) * effective_opacity);
        _ = c.SDL_SetRenderDrawColor(rend, paint_col.r, paint_col.g, paint_col.b, a);
        var rect = c.SDL_FRect{ .x = fx, .y = fy, .w = fw, .h = fh };
        _ = c.SDL_RenderFillRect(rend, &rect);
    }

    // Border (per-side widths)
    const bt = node.style.brdTop();
    const br_w = node.style.brdRight();
    const bb_w = node.style.brdBottom();
    const bl = node.style.brdLeft();
    if (bt > 0 or br_w > 0 or bb_w > 0 or bl > 0) {
        const bc = node.style.border_color orelse Color.rgb(255, 255, 255);
        const ba: u8 = @intFromFloat(@as(f32, @floatFromInt(bc.a)) * effective_opacity);
        _ = c.SDL_SetRenderDrawColor(rend, bc.r, bc.g, bc.b, ba);
        if (bt > 0) {
            var top_r = c.SDL_FRect{ .x = fx, .y = fy, .w = fw, .h = bt };
            _ = c.SDL_RenderFillRect(rend, &top_r);
        }
        if (bb_w > 0) {
            var bot_r = c.SDL_FRect{ .x = fx, .y = fy + fh - bb_w, .w = fw, .h = bb_w };
            _ = c.SDL_RenderFillRect(rend, &bot_r);
        }
        if (bl > 0) {
            var left_r = c.SDL_FRect{ .x = fx, .y = fy + bt, .w = bl, .h = fh - bt - bb_w };
            _ = c.SDL_RenderFillRect(rend, &left_r);
        }
        if (br_w > 0) {
            var right_r = c.SDL_FRect{ .x = fx + fw - br_w, .y = fy + bt, .w = br_w, .h = fh - bt - bb_w };
            _ = c.SDL_RenderFillRect(rend, &right_r);
        }
    }

    // Text
    if (node.text) |txt| {
        if (txt.len > 0) {
            const tc = node.text_color orelse Color.rgb(255, 255, 255);
            const pl = node.style.padLeft();
            const pt = node.style.padTop();
            const pr = node.style.padRight();
            const text_max_w = r.w - pl - pr;
            var color_with_opacity = tc;
            color_with_opacity.a = @intFromFloat(@as(f32, @floatFromInt(tc.a)) * effective_opacity);
            drawSdlTextWrapped(
                rend,
                te,
                txt,
                r.x + pl,
                r.y + pt,
                node.font_size,
                text_max_w,
                color_with_opacity,
                node.style.text_align,
                node.letter_spacing,
                node.line_height,
                node.number_of_lines,
            );
        }
    }

    // Children
    for (node.children) |*child| {
        paintNodeImpl(rend, te, child, hovered, window_opacity, effective_opacity);
    }
}

fn drawSdlTextWrapped(
    rend: *c.SDL_Renderer,
    te: *TextEngine,
    text: []const u8,
    x: f32,
    y: f32,
    size_px: u16,
    max_width: f32,
    color: Color,
    text_align: layout.TextAlign,
    letter_spacing: f32,
    line_height_override: f32,
    max_lines: u16,
) void {
    const lm = te.lineMetrics(size_px);
    const line_h: f32 = if (line_height_override > 0) line_height_override else lm.height;
    var lines: [256]WrappedLine = undefined;
    const line_count = wrapSdlText(te, text, size_px, max_width, letter_spacing, &lines);
    const draw_count = if (max_lines > 0 and line_count > max_lines) max_lines else line_count;

    for (0..draw_count) |li| {
        const line = text[lines[li].start..lines[li].end];
        var line_x = x;
        if (text_align != .left and max_width > 0) {
            const line_w = measureSdlLine(te, line, size_px, letter_spacing);
            line_x = if (text_align == .center) x + (max_width - line_w) / 2.0 else x + max_width - line_w;
        }
        drawSdlTextLine(rend, te, line, line_x, y + line_h * @as(f32, @floatFromInt(li)), size_px, color, letter_spacing);
    }
}

fn decodeUtf8Sdl(bytes: []const u8) struct { cp: u32, len: usize } {
    if (bytes.len == 0) return .{ .cp = 0xFFFD, .len = 1 };
    const b0 = bytes[0];
    if (b0 < 0x80) return .{ .cp = b0, .len = 1 };
    if (b0 < 0xC0) return .{ .cp = 0xFFFD, .len = 1 };
    if (b0 < 0xE0) {
        if (bytes.len < 2) return .{ .cp = 0xFFFD, .len = 1 };
        return .{ .cp = (@as(u32, b0 & 0x1F) << 6) | @as(u32, bytes[1] & 0x3F), .len = 2 };
    }
    if (b0 < 0xF0) {
        if (bytes.len < 3) return .{ .cp = 0xFFFD, .len = 1 };
        return .{ .cp = (@as(u32, b0 & 0x0F) << 12) | (@as(u32, bytes[1] & 0x3F) << 6) | @as(u32, bytes[2] & 0x3F), .len = 3 };
    }
    if (bytes.len < 4) return .{ .cp = 0xFFFD, .len = 1 };
    return .{ .cp = (@as(u32, b0 & 0x07) << 18) | (@as(u32, bytes[1] & 0x3F) << 12) | (@as(u32, bytes[2] & 0x3F) << 6) | @as(u32, bytes[3] & 0x3F), .len = 4 };
}

fn glyphAdvance(te: *TextEngine, cp: u32, size_px: u16) f32 {
    const face = selectFace(te, cp, size_px);
    if (c.FT_Load_Char(face, cp, c.FT_LOAD_DEFAULT) != 0) return @as(f32, @floatFromInt(size_px)) * 0.5;
    return @as(f32, @floatFromInt(face.*.glyph.*.advance.x)) / 64.0;
}

fn selectFace(te: *TextEngine, cp: u32, size_px: u16) c.FT_Face {
    _ = c.FT_Set_Pixel_Sizes(te.face, 0, size_px);
    if (c.FT_Get_Char_Index(te.face, cp) != 0) return te.face;
    for (0..te.fallback_count) |fi| {
        const fb = te.fallback_faces[fi];
        if (c.FT_Get_Char_Index(fb, cp) != 0) {
            _ = c.FT_Set_Pixel_Sizes(fb, 0, size_px);
            return fb;
        }
    }
    return te.face;
}

fn measureSdlLine(te: *TextEngine, text: []const u8, size_px: u16, letter_spacing: f32) f32 {
    var width: f32 = 0;
    var chars: usize = 0;
    var i: usize = 0;
    while (i < text.len) {
        const ch = decodeUtf8Sdl(text[i..]);
        if (ch.cp >= 0x20) {
            width += glyphAdvance(te, ch.cp, size_px);
            chars += 1;
        }
        i += ch.len;
    }
    if (chars > 1) width += letter_spacing * @as(f32, @floatFromInt(chars - 1));
    return width;
}

fn wrapSdlText(
    te: *TextEngine,
    text: []const u8,
    size_px: u16,
    max_width: f32,
    letter_spacing: f32,
    out: []WrappedLine,
) usize {
    if (out.len == 0) return 0;
    if (text.len == 0) {
        out[0] = .{ .start = 0, .end = 0 };
        return 1;
    }
    var line_count: usize = 0;
    var line_start: usize = 0;
    var last_space: ?usize = null;
    var line_width: f32 = 0;
    var i: usize = 0;
    while (i < text.len) {
        if (text[i] == '\n') {
            out[line_count] = .{ .start = line_start, .end = i };
            line_count += 1;
            if (line_count >= out.len) return line_count;
            i += 1;
            line_start = i;
            last_space = null;
            line_width = 0;
            continue;
        }
        if (text[i] == ' ') last_space = i;
        const ch = decodeUtf8Sdl(text[i..]);
        const adv = glyphAdvance(te, ch.cp, size_px) + letter_spacing;
        if (max_width > 0 and line_width > 0 and line_width + adv > max_width) {
            const end = last_space orelse i;
            if (end > line_start) {
                out[line_count] = .{ .start = line_start, .end = end };
                line_count += 1;
                if (line_count >= out.len) return line_count;
                line_start = if (last_space) |space| space + 1 else i;
                i = line_start;
                last_space = null;
                line_width = 0;
                continue;
            }
        }
        line_width += adv;
        i += ch.len;
    }
    if (line_count < out.len and line_start <= text.len) {
        out[line_count] = .{ .start = line_start, .end = text.len };
        line_count += 1;
    }
    return line_count;
}

fn drawSdlTextLine(
    rend: *c.SDL_Renderer,
    te: *TextEngine,
    text: []const u8,
    x: f32,
    y: f32,
    size_px: u16,
    color: Color,
    letter_spacing: f32,
) void {
    if (text.len == 0) return;
    _ = c.FT_Set_Pixel_Sizes(te.face, 0, size_px);
    const lm = te.lineMetrics(size_px);
    const baseline = y + lm.ascent;
    var pen_x = x;
    var i: usize = 0;
    while (i < text.len) {
        const ch = decodeUtf8Sdl(text[i..]);
        i += ch.len;
        if (ch.cp < 0x20) continue;
        const face = selectFace(te, ch.cp, size_px);
        if (c.FT_Load_Char(face, ch.cp, c.FT_LOAD_RENDER) != 0) continue;
        const glyph = face.*.glyph;
        const bitmap = glyph.*.bitmap;
        const bw: usize = @intCast(bitmap.width);
        const bh: usize = @intCast(bitmap.rows);
        if (bw > 0 and bh > 0 and bitmap.buffer != null) {
            const rgba = std.heap.c_allocator.alloc(u8, bw * bh * 4) catch return;
            defer std.heap.c_allocator.free(rgba);
            const src_pitch_abs: usize = @intCast(if (bitmap.pitch < 0) -bitmap.pitch else bitmap.pitch);
            for (0..bh) |row| {
                for (0..bw) |col| {
                    const alpha = bitmap.buffer[row * src_pitch_abs + col];
                    const dst = (row * bw + col) * 4;
                    rgba[dst + 0] = color.r;
                    rgba[dst + 1] = color.g;
                    rgba[dst + 2] = color.b;
                    rgba[dst + 3] = @intCast((@as(u16, alpha) * @as(u16, color.a)) / 255);
                }
            }
            const tex = c.SDL_CreateTexture(rend, c.SDL_PIXELFORMAT_RGBA32, c.SDL_TEXTUREACCESS_STATIC, @intCast(bw), @intCast(bh));
            if (tex) |texture| {
                defer c.SDL_DestroyTexture(texture);
                _ = c.SDL_SetTextureBlendMode(texture, c.SDL_BLENDMODE_BLEND);
                _ = c.SDL_UpdateTexture(texture, null, rgba.ptr, @intCast(bw * 4));
                var dst = c.SDL_FRect{
                    .x = pen_x + @as(f32, @floatFromInt(glyph.*.bitmap_left)),
                    .y = baseline - @as(f32, @floatFromInt(glyph.*.bitmap_top)),
                    .w = @floatFromInt(bw),
                    .h = @floatFromInt(bh),
                };
                _ = c.SDL_RenderTexture(rend, texture, null, &dst);
            }
        }
        pen_x += @as(f32, @floatFromInt(glyph.*.advance.x)) / 64.0 + letter_spacing;
    }
}

fn brightenColor(col: Color) Color {
    return .{
        .r = @min(255, @as(u16, col.r) + 20),
        .g = @min(255, @as(u16, col.g) + 20),
        .b = @min(255, @as(u16, col.b) + 20),
        .a = col.a,
    };
}

// ════════════════════════════════════════════════════════════════════════
// Notification lifecycle
// ════════════════════════════════════════════════════════════════════════

const FADE_IN_MS: u32 = 200;
const FADE_OUT_MS: u32 = 300;

/// Tick a notification window's lifecycle. Returns false if the window was closed.
fn tickNotification(io: std.Io, idx: usize, now: u32) bool {
    const slot = &slots[idx];
    const age = now -| slot.created_at;
    const dismiss = slot.auto_dismiss_ms;

    if (dismiss > 0 and age >= dismiss + FADE_OUT_MS) {
        // Expired — close it
        close(io, idx);
        return false;
    }

    // Fade in
    if (age < FADE_IN_MS) {
        slot.opacity = @as(f32, @floatFromInt(age)) / @as(f32, @floatFromInt(FADE_IN_MS));
        if (slot.window) |w| _ = c.SDL_SetWindowOpacity(w, slot.opacity);
        return true;
    }

    // Fade out
    if (dismiss > 0 and age >= dismiss) {
        const fade_age = age - dismiss;
        slot.opacity = 1.0 - @as(f32, @floatFromInt(fade_age)) / @as(f32, @floatFromInt(FADE_OUT_MS));
        slot.opacity = @max(0.0, slot.opacity);
        if (slot.window) |w| _ = c.SDL_SetWindowOpacity(w, slot.opacity);
        return true;
    }

    // Full opacity
    slot.opacity = 1.0;
    return true;
}

// ════════════════════════════════════════════════════════════════════════
// X11 notification window type
// ════════════════════════════════════════════════════════════════════════

/// Set X11 _NET_WM_WINDOW_TYPE to _NET_WM_WINDOW_TYPE_NOTIFICATION.
/// This tells the WM: no taskbar entry, no focus steal, float above other windows.
/// Linux only — no-op on macOS.
fn setX11NotificationType(window: *c.SDL_Window) void {
    if (comptime builtin.os.tag != .linux) return;
    const props = c.SDL_GetWindowProperties(window);

    // Only on X11 — check if X11 display property exists
    const display = c.SDL_GetPointerProperty(props, c.SDL_PROP_WINDOW_X11_DISPLAY_POINTER, null);
    const x11_window_num = c.SDL_GetNumberProperty(props, c.SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0);
    if (display == null or x11_window_num == 0) return;

    const x11_window: c_ulong = @intCast(x11_window_num);

    const wm_type = x11Atom(display, "_NET_WM_WINDOW_TYPE");
    const notif_type = x11Atom(display, "_NET_WM_WINDOW_TYPE_NOTIFICATION");
    if (wm_type == 0 or notif_type == 0) return;

    // XChangeProperty(display, window, property, type, format, mode, data, nelements)
    const XA_ATOM: c_ulong = 4;
    const PropModeReplace: c_int = 0;
    var val = notif_type;
    _ = x11ChangeProperty(display, x11_window, wm_type, XA_ATOM, 32, PropModeReplace, @ptrCast(&val), 1);
}

// X11 FFI helpers — Linux only (SDL exposes the display/window but not Xlib functions directly)
const x11_available = builtin.os.tag == .linux;
extern fn XInternAtom(display: ?*anyopaque, name: [*:0]const u8, only_if_exists: c_int) c_ulong;
extern fn XChangeProperty(display: ?*anyopaque, window: c_ulong, property: c_ulong, prop_type: c_ulong, format: c_int, mode: c_int, data: ?*const anyopaque, nelements: c_int) c_int;

fn x11Atom(display: ?*anyopaque, name: [*:0]const u8) c_ulong {
    if (comptime !x11_available) return 0;
    return XInternAtom(display, name, 0);
}

fn x11ChangeProperty(display: ?*anyopaque, window: c_ulong, property: c_ulong, prop_type: c_ulong, format: c_int, mode: c_int, data: ?*const anyopaque, nelements: c_int) c_int {
    if (comptime !x11_available) return 0;
    return XChangeProperty(display, window, property, prop_type, format, mode, data, nelements);
}

// ════════════════════════════════════════════════════════════════════════
// Queries
// ════════════════════════════════════════════════════════════════════════

/// Return how many windows are active.
pub fn count() usize {
    return slot_count;
}

/// Get a slot (for external read access).
pub fn getSlot(idx: usize) ?*WindowSlot {
    if (idx >= MAX_WINDOWS or !slots[idx].active) return null;
    return &slots[idx];
}

/// Iterate all active slots. Callback receives (slot_index, *WindowSlot).
pub fn forEach(callback: *const fn (usize, *WindowSlot) void) void {
    for (0..MAX_WINDOWS) |i| {
        if (slots[i].active) callback(i, &slots[i]);
    }
}

// ── Public text measurement (FreeType-direct, matches paint path) ──────
//
// The default layout measureFn used by GPU carts routes through
// framework/gpu/text.zig's glyph atlas — which depends on wgpu being
// initialized. When framework/primitive/windows.zig paints in its
// in_process SDL3 mode it uses FreeType directly (via the wrapSdlText
// / measureSdlLine / glyphAdvance helpers above) — the gpu_text atlas
// is bypassed entirely. For layout measurements to match paint, the
// host (tui_window_runtime) installs a measureFn that calls this
// helper instead of TextEngine.measureTextWrappedEx — which transitively
// goes through gpu_text and returns a fallback `size_px / 2 per char`
// when the atlas is empty, producing widths ~50% smaller than reality
// and causing every Text to wrap.

pub fn measureSdlTextForLayout(
    te: *TextEngine,
    text: []const u8,
    font_size: u16,
    max_width: f32,
    letter_spacing: f32,
    line_height_override: f32,
    max_lines: u16,
    no_wrap: bool,
) layout.LayoutRect {
    if (text.len == 0) return .{ .x = 0, .y = 0, .w = 0, .h = 0 };
    const lm = te.lineMetrics(font_size);
    const line_h: f32 = if (line_height_override > 0) line_height_override else lm.height;

    // No wrap (single line) — return single-line metrics.
    if (no_wrap or max_width <= 0) {
        const w = measureSdlLine(te, text, font_size, letter_spacing);
        const clamped_w = if (no_wrap and max_width > 0) @min(w, max_width) else w;
        return .{ .x = lm.ascent, .y = 0, .w = clamped_w, .h = line_h };
    }

    // Wrapped — use the same wrapSdlText the painter uses so layout
    // and paint can't disagree on where lines break.
    var lines: [256]WrappedLine = undefined;
    const line_count = wrapSdlText(te, text, font_size, max_width, letter_spacing, &lines);
    const draw_count = if (max_lines > 0 and line_count > max_lines) max_lines else line_count;
    var widest: f32 = 0;
    for (0..draw_count) |li| {
        const line = text[lines[li].start..lines[li].end];
        const lw = measureSdlLine(te, line, font_size, letter_spacing);
        if (lw > widest) widest = lw;
    }
    return .{ .x = lm.ascent, .y = 0, .w = widest, .h = line_h * @as(f32, @floatFromInt(draw_count)) };
}

// ── Telemetry ────────────────────────────────────────────────────────────

pub fn telemetryActiveCount() u32 {
    var n: u32 = 0;
    for (0..MAX_WINDOWS) |i| {
        if (slots[i].active) n += 1;
    }
    return n;
}
