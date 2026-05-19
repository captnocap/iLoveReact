//! framework/tui_window_runtime.zig — bridges the React reconciler
//! stream to real SDL3 windows from inside an otherwise-ANSI TUI
//! binary. Only compiled when the cart imports <Window>/<Notification>
//! (ship-tui passes -Dhas-window=true; build.zig links SDL3 + freetype
//! + the engine subset).
//!
//! Architecture:
//!   - host_tree.zig owns the React Node tree and consumes the
//!     reconciler's mutation batch via __hostFlush.
//!   - When CREATE fires with type="Window", we open an SDL3 in-process
//!     window via framework/primitive/windows.zig and track the slot
//!     keyed by the Window node's id.
//!   - tickDrain() pumps SDL3 events (mouse/keyboard/close), rebuilds
//!     each open window's Node-tree root via materializeWindowRoot,
//!     and runs windows.layoutAll + paintAndPresent.
//!
//! Stage 1 (this file): minimal — opens windows, paints empty frame
//! with the window's bg color. Cart sees a real SDL3 window appear
//! when state flips. Children inside the Window subtree don't render
//! yet because applyProps is a stub.
//!
//! Stage 2 (next iteration): minimal applyProps so Box/Text/Pressable
//! inside the Window paint with their styled props. Event handlers
//! routed back through the reconciler's onPress/onMouseDown registry.

const std = @import("std");
const build_options = @import("build_options");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");

const c = @import("c.zig").imports;
const layout = @import("layout.zig");
const windows = @import("primitive/windows.zig");
const host_tree = @import("host_tree.zig");
const log = @import("diag/log.zig");

const Node = layout.Node;

// ────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────

var g_alloc: std.mem.Allocator = undefined;
var g_inited: bool = false;
var g_sdl_inited: bool = false;

/// node_id → windows.zig slot index. Populated when CREATE with
/// type="Window" fires; consulted on tickDrain to know which slots
/// belong to which React nodes.
var g_slot_by_node_id: std.AutoHashMap(u32, usize) = undefined;

/// Per-frame arena: rebuilt every tickDrain. materializeWindowRoot
/// allocates the structured Node tree here so windows.zig can walk it.
/// Reset (not freed) each frame for cheap O(1) reuse.
var g_frame_arena: std.heap.ArenaAllocator = undefined;

// ────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────

pub fn init(alloc: std.mem.Allocator) !void {
    if (g_inited) return;
    g_alloc = alloc;
    g_slot_by_node_id = std.AutoHashMap(u32, usize).init(alloc);
    g_frame_arena = std.heap.ArenaAllocator.init(alloc);
    host_tree.init(alloc);
    host_tree.setHooks(.{
        .open_host_window = openHostWindow,
        // Stage 1: no apply_props / apply_handler_flags hooks yet.
        // The Window opens but its children paint as empty Nodes.
    });
    g_inited = true;
}

pub fn deinit() void {
    if (!g_inited) return;
    g_slot_by_node_id.deinit();
    g_frame_arena.deinit();
    windows.deinitAll();
    if (g_sdl_inited) {
        c.SDL_Quit();
        g_sdl_inited = false;
    }
    g_inited = false;
}

// ────────────────────────────────────────────────────────────────────
// SDL3 lazy init
// ────────────────────────────────────────────────────────────────────

/// Initialize SDL3 video on first window open. Deferred so ANSI-only
/// carts that just happen to be built with -Dhas-window=true (e.g.
/// transitively via a re-export) don't pay the SDL_Init cost.
fn ensureSdlInited() bool {
    if (g_sdl_inited) return true;
    if (!c.SDL_Init(c.SDL_INIT_VIDEO)) {
        log.err(.engine, "tui_window_runtime: SDL_Init failed", .{});
        return false;
    }
    g_sdl_inited = true;
    return true;
}

// ────────────────────────────────────────────────────────────────────
// host_tree hooks
// ────────────────────────────────────────────────────────────────────

/// CREATE hook: when a Window/Notification node is created, open the
/// corresponding SDL3 window and remember the slot. Props on the
/// Window itself (title, width, height) are parsed here directly —
/// they're a small fixed set, not subject to the full applyProps
/// CSS-parser path that we still don't have wired.
fn openHostWindow(id: u32, type_name: []const u8, props: ?std.json.Value) void {
    const is_window = std.mem.eql(u8, type_name, "Window");
    const is_notif = std.mem.eql(u8, type_name, "Notification");
    if (!is_window and !is_notif) return;
    if (!ensureSdlInited()) return;
    if (g_slot_by_node_id.contains(id)) return;

    var title_buf: [256:0]u8 = undefined;
    var title: [*:0]const u8 = "Window";
    var width: c_int = 640;
    var height: c_int = 480;

    if (props) |p| if (p == .object) {
        if (p.object.get("title")) |t| if (t == .string) {
            const len = @min(t.string.len, 255);
            @memcpy(title_buf[0..len], t.string[0..len]);
            title_buf[len] = 0;
            title = @ptrCast(&title_buf);
        };
        if (p.object.get("width")) |w| if (host_tree.jsonInt(w)) |i| {
            width = @intCast(i);
        };
        if (p.object.get("height")) |h| if (host_tree.jsonInt(h)) |i| {
            height = @intCast(i);
        };
    };

    std.debug.print("[tui_window_runtime] opening window id={d} w={d} h={d}\n", .{ id, width, height });
    const slot = windows.open(.{
        .title = title,
        .width = width,
        .height = height,
        .kind = if (is_notif) .notification else .in_process,
        .window_id = id,
    }) orelse {
        std.debug.print("[tui_window_runtime] windows.open FAILED for node {d}\n", .{id});
        return;
    };
    std.debug.print("[tui_window_runtime] windows.open OK node={d} slot={d}\n", .{ id, slot });

    g_slot_by_node_id.put(id, slot) catch {
        std.debug.print("[tui_window_runtime] map put OOM\n", .{});
        windows.close(slot);
        return;
    };
}

// ────────────────────────────────────────────────────────────────────
// __hostFlush v8 binding — drives host_tree from JS reconciler stream
// ────────────────────────────────────────────────────────────────────

fn hostFlush(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const isolate = info.getIsolate();
    const arg = info.getArg(0);
    if (!arg.isString()) return;
    const str = arg.castTo(v8.String);
    const len = str.lenUtf8(isolate);
    const buf = std.heap.c_allocator.alloc(u8, @intCast(len)) catch return;
    defer std.heap.c_allocator.free(buf);
    _ = str.writeUtf8(isolate, buf);
    host_tree.applyCommandBatch(buf);
}

pub fn register() void {
    v8_runtime.registerHostFn("__hostFlush", hostFlush);
}

// ────────────────────────────────────────────────────────────────────
// Per-tick pump: SDL events → routeEvent; layout + paint all windows
// ────────────────────────────────────────────────────────────────────

/// Materialize a Window's children into an arena-allocated linked
/// Node tree that windows.zig can walk. Mirrors v8_app.zig's
/// `materializeWindowRoot` but reads from host_tree's state instead of
/// v8_app's globals, and skips owner filtering (the TUI host doesn't
/// yet support nested Windows owning sub-Windows).
fn materializeWindowRoot(arena: std.mem.Allocator, window_node_id: u32) ?*Node {
    if (host_tree.getNode(window_node_id) == null) return null;
    const root = arena.create(Node) catch return null;
    root.* = .{};
    root.style.flex_direction = .column;
    root.style.background_color = layout.Color.rgb(17, 24, 39);
    root.children = materializeChildren(arena, window_node_id);
    return root;
}

fn materializeChildren(arena: std.mem.Allocator, parent_id: u32) []Node {
    const ids = host_tree.getChildren(parent_id);
    if (ids.len == 0) return &.{};
    const out = arena.alloc(Node, ids.len) catch return &.{};
    var i: usize = 0;
    for (ids) |cid| {
        const src = host_tree.getNode(cid) orelse {
            out[i] = .{};
            i += 1;
            continue;
        };
        out[i] = src.*;
        out[i].children = materializeChildren(arena, cid);
        i += 1;
    }
    return out;
}

pub fn tickDrain() void {
    if (!g_inited or !g_sdl_inited) return;
    if (g_slot_by_node_id.count() == 0) return;

    // Pump SDL events. Each event gets routed to the right slot.
    // Caveat: we share the host process event queue with anything else
    // that might also be polling — in a slim TUI binary there's
    // nothing else, so we own the queue.
    var event: c.SDL_Event = undefined;
    while (c.SDL_PollEvent(&event)) {
        _ = windows.routeEvent(&event);
    }

    // Rebuild every open Window's Node tree this frame, point its
    // slot at the new root, then layout + paint. Arena reset is
    // free per-frame allocation.
    _ = g_frame_arena.reset(.retain_capacity);
    const arena = g_frame_arena.allocator();

    var it = g_slot_by_node_id.iterator();
    while (it.next()) |entry| {
        const window_node_id = entry.key_ptr.*;
        const slot_idx = entry.value_ptr.*;
        const root = materializeWindowRoot(arena, window_node_id) orelse continue;
        windows.setRoot(slot_idx, root);
    }

    windows.layoutAll();
    windows.paintAndPresent();
}
