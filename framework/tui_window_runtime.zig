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
const host_props = @import("host_props.zig");
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

/// Diagnostic: dump the post-layout Node tree when the set of open
/// windows changes (a <Window> mounted or unmounted). Gated by env
/// var RJIT_DUMP_LAYOUT — set to 1 to enable. Useful when the
/// rendered output looks off and we want to confirm what the engine
/// actually computed for each Node's rect.
var g_last_dumped_slot_count: u32 = 0;

/// Pool of allocated handler-expression strings (e.g.
/// "__dispatchEvent(42,'onClick')") whose pointers live on
/// Node.handlers.js_on_press etc. These strings are referenced from
/// arena-copied Nodes every frame, so they need a lifetime that
/// outlives any single frame's arena reset — hence a separate
/// permanent pool on g_alloc.
var g_handler_expr_pool: std.ArrayList([:0]u8) = .{};

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
        .apply_props = applyProps,
        .apply_handler_flags = applyHandlerFlags,
    });
    // Install the layout-side text-measure callback so Text intrinsic
    // widths come back non-zero. Without this, every Text node measures
    // 0×0, parent containers shrink-wrap to padding-only, and Row
    // children stack at the same x (which is exactly what the
    // tui_window_smoke + claudewrap screenshots showed). The callback
    // grabs whichever active window's TextEngine is around — they all
    // share the same FreeType face so the measurement is consistent
    // across windows.
    layout.setMeasureFn(measureText);
    // Wire the SDL3 paint side to call back into JS when handlers
    // fire on hit-tested nodes. windows.zig already does the hit
    // testing + dispatchJs walk; we just provide the eval.
    windows.setJsDispatchFn(jsDispatch);
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
// Layout text-measure callback
// ────────────────────────────────────────────────────────────────────

/// Called by framework/layout.zig to measure a Text node's intrinsic
/// dimensions. We borrow whichever active in-process window's
/// TextEngine is around — they all wrap the same FreeType face
/// (windows.zig:198 hard-codes DejaVuSans), so measurement is
/// consistent regardless of which window's engine answers. font_family_id
/// is ignored: the TUI window subset is single-font.
fn measureText(
    t: []const u8,
    font_size: u16,
    font_family_id: u8,
    max_width: f32,
    letter_spacing: f32,
    line_height: f32,
    max_lines: u16,
    no_wrap: bool,
    bold: bool,
) layout.TextMetrics {
    _ = font_family_id;
    _ = bold; // windows.zig SDL paint doesn't switch bold mid-line either yet
    var i: usize = 0;
    while (i < 32) : (i += 1) {
        const slot = windows.getSlot(i) orelse continue;
        if (slot.text_engine == null) continue;
        const te = &slot.text_engine.?;
        // Route through the FreeType-direct measurer that mirrors the
        // SDL paint path (windows.zig:wrapSdlText / measureSdlLine).
        // The default TextEngine.measureTextWrappedEx goes through
        // framework/gpu/text.zig — which depends on the wgpu atlas
        // being initialized. The TUI binary links wgpu but never
        // inits it, so gpu_text.getCharAdvance falls back to
        // `size_px / 2` per char — about 50% of real DejaVu Sans
        // advances. Layout then under-sizes every Text and paint
        // ends up wrapping mid-word.
        const r = windows.measureSdlTextForLayout(te, t, font_size, max_width, letter_spacing, line_height, max_lines, no_wrap);
        return .{ .width = r.w, .height = r.h, .ascent = r.x };
    }
    return .{ .width = 0, .height = 0, .ascent = 0 };
}

// ────────────────────────────────────────────────────────────────────
// Event dispatch — SDL3 hit → JS handler
// ────────────────────────────────────────────────────────────────────

/// windows.zig calls this for any hit-tested node whose js_on_* slot
/// is non-null. The contract here (set by windows.zig:dispatchJs, NOT
/// by engine.zig — those differ!) is that we receive (node_id,
/// event_name) — e.g. (42, "onClick") — and are responsible for
/// constructing the `__dispatchEvent(42,'onClick')` call ourselves.
/// The js_on_* fields on the Node act as a non-null gate; their
/// contents are not consumed by windows.zig.
fn jsDispatch(node_id: u32, event_name: []const u8) void {
    var buf: [128]u8 = undefined;
    const expr = std.fmt.bufPrint(&buf, "__dispatchEvent({d},'{s}')", .{ node_id, event_name }) catch return;
    v8_runtime.evalExpr(expr);
}

/// Per-handler-name check — the reconciler attaches a top-level
/// `handlerNames: ["onClick", ...]` array to CREATE/UPDATE commands.
/// Mirrors v8_app.zig's cmdHasHandlerName.
fn cmdHasHandlerName(cmd: std.json.Value, name: []const u8) bool {
    const v = cmd.object.get("handlerNames") orelse return false;
    if (v != .array) return false;
    for (v.array.items) |entry| {
        if (entry == .string and std.mem.eql(u8, entry.string, name)) return true;
    }
    return false;
}

fn cmdHasAnyHandler(cmd: std.json.Value, comptime names: []const []const u8) bool {
    inline for (names) |n| {
        if (cmdHasHandlerName(cmd, n)) return true;
    }
    return false;
}

/// Allocate a permanent null-terminated JS-eval string and stash its
/// pointer on the Node. Strings live in g_handler_expr_pool for the
/// process lifetime — they're tiny (~30 bytes each) and stable.
fn installJsExpr(comptime expr_fmt: []const u8, id: u32) ?[*:0]const u8 {
    const s = std.fmt.allocPrint(g_alloc, expr_fmt, .{id}) catch return null;
    const sz: [:0]u8 = s[0 .. s.len - 1 :0];
    g_handler_expr_pool.append(g_alloc, sz) catch {};
    return sz.ptr;
}

/// CREATE/UPDATE hook: extract event handler flags from the command
/// and install JS-eval strings on the Node. windows.zig:routeEvent
/// hit-tests against these on every SDL3 mouse event and fires
/// dispatchJs (→ jsDispatch above) when one matches.
fn applyHandlerFlags(node: *Node, id: u32, cmd: std.json.Value) void {
    node.handlers.js_on_press = null;
    node.handlers.js_on_mouse_down = null;
    node.handlers.js_on_mouse_move = null;
    node.handlers.js_on_mouse_up = null;
    node.handlers.js_on_hover_enter = null;
    node.handlers.js_on_hover_exit = null;
    if (cmdHasAnyHandler(cmd, &.{ "onClick", "onPress" })) {
        node.handlers.js_on_press = installJsExpr("__dispatchEvent({d},'onClick')\x00", id);
    }
    if (cmdHasAnyHandler(cmd, &.{ "onMouseDown", "onPointerDown", "onPressIn" })) {
        node.handlers.js_on_mouse_down = installJsExpr("__dispatchEvent({d},'onMouseDown')\x00", id);
    }
    if (cmdHasAnyHandler(cmd, &.{ "onMouseMove", "onPointerMove" })) {
        node.handlers.js_on_mouse_move = installJsExpr("__dispatchEvent({d},'onMouseMove')\x00", id);
    }
    if (cmdHasAnyHandler(cmd, &.{ "onMouseUp", "onPointerUp", "onPressOut" })) {
        node.handlers.js_on_mouse_up = installJsExpr("__dispatchEvent({d},'onMouseUp')\x00", id);
    }
    if (cmdHasAnyHandler(cmd, &.{ "onHoverEnter", "onMouseEnter" })) {
        node.handlers.js_on_hover_enter = installJsExpr("__dispatchEvent({d},'onHoverEnter')\x00", id);
    }
    if (cmdHasAnyHandler(cmd, &.{ "onHoverExit", "onMouseLeave" })) {
        node.handlers.js_on_hover_exit = installJsExpr("__dispatchEvent({d},'onHoverExit')\x00", id);
    }
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
// apply_props hook — delegates to framework/host_props.zig
// ────────────────────────────────────────────────────────────────────
//
// All style + typography prop parsing is shared with v8_app.zig via
// framework/host_props.zig. This file's only job is to set the cell→pixel
// scale around the call (TUI carts author in cell-units; SDL3 paints in
// pixels), then route any non-style top-level props (text, value) to
// node fields. No GPU-host hooks (latches, transitions) — those don't
// reach a Window subtree.
//
// Long-term: cart authoring unit unifies on pixels and the scale dies.

// Cell → pixel scale for ship-tui <Window> subtrees. The same JSX renders
// to either an ANSI cell grid (1 unit = 1 cell) or a real SDL3 window
// (1 unit = 1 pixel). To keep cart numbers consistent across both, the
// SDL3 path multiplies spatial reads by ~one-cell-in-pixels. 8.0 is the
// width of a DejaVuSans cell at the default 16 px font size.
const CELL_SCALE: f32 = 8.0;

fn applyProps(node: *Node, props: std.json.Value, type_name: ?[]const u8) void {
    _ = type_name;
    if (props != .object) return;

    host_props.setScale(CELL_SCALE);
    defer host_props.setScale(1.0);

    var it = props.object.iterator();
    while (it.next()) |entry| {
        const key = entry.key_ptr.*;
        const val = entry.value_ptr.*;
        // The shared parser handles style{}, fontSize, fontFamily, fontWeight,
        // color, letterSpacing, lineHeight, numberOfLines, noWrap.
        if (host_props.applyTopLevelProp(node, key, val, false, .{})) continue;

        // `text` and `value` both drive node.text — SDL paint reads it
        // uniformly. TextInput cursor/edit handling isn't wired yet.
        if (std.mem.eql(u8, key, "text") or std.mem.eql(u8, key, "value")) {
            if (val == .string) {
                node.text = g_alloc.dupe(u8, val.string) catch null;
            }
        }
        // Other top-level props (children, src, onPress, debugSource,
        // gradients, image src, etc.) intentionally ignored — Window-
        // subtree minimum surface.
    }
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
    // Diagnostic: dump the post-layout tree when the open-window set
    // changes (a new <Window> mounted or one unmounted). Gated by
    // RJIT_DUMP_LAYOUT=1. Lets you `RJIT_DUMP_LAYOUT=1 ./binary` and
    // see the layout each time a Window pops up — far more useful
    // than a one-shot fire on first paint, since most carts open
    // Windows on user action, not at mount.
    const slot_count = g_slot_by_node_id.count();
    if (slot_count != g_last_dumped_slot_count) {
        g_last_dumped_slot_count = slot_count;
        const dump_env = std.posix.getenv("RJIT_DUMP_LAYOUT") orelse "";
        if (dump_env.len > 0 and dump_env[0] != '0' and slot_count > 0) {
            var dit = g_slot_by_node_id.iterator();
            while (dit.next()) |entry| {
                const slot_idx = entry.value_ptr.*;
                if (windows.getSlot(slot_idx)) |slot| {
                    if (slot.root) |root| {
                        std.debug.print("[layout-dump] window node={d} slot={d}\n", .{ entry.key_ptr.*, slot_idx });
                        dumpTree(root, 0);
                    }
                }
            }
        }
    }
    windows.paintAndPresent();
}

fn dumpTree(node: *Node, depth: u32) void {
    var i: u32 = 0;
    while (i < depth) : (i += 1) std.debug.print("  ", .{});
    const r = node.computed;
    const txt: []const u8 = node.text orelse "";
    std.debug.print("rect=({d:.0},{d:.0},{d:.0}x{d:.0}) w_style={?d:.0} h_style={?d:.0} fg={d} '{s}'\n", .{
        r.x, r.y, r.w, r.h,
        node.style.width,
        node.style.height,
        node.style.flex_grow,
        if (txt.len > 30) txt[0..30] else txt,
    });
    for (node.children) |*child| dumpTree(child, depth + 1);
}
