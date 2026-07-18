//! framework/v8_bindings_host_window.zig — V8 binding that bridges the
//! React reconciler stream to real SDL3 windows. Only linked when a cart
//! imports `<Window>`/`<Notification>` (ship-tui passes `-Dhas-window=true`,
//! build.zig links SDL3 + FreeType + the windows.zig paint subset).
//!
//! Naming convention: sibling to v8_bindings_vterm.zig, v8_bindings_process.zig,
//! v8_bindings_telemetry.zig, etc. NOT a "runtime" — the only runtime is
//! runtime/ (the JS side); this is a V8 host binding that registers
//! `__hostFlush` and pumps SDL3 events per tick.
//!
//! Architecture:
//!   - host_tree.zig owns the React Node tree and consumes the reconciler's
//!     mutation batch via __hostFlush.
//!   - host_props.zig is the shared prop parser (same one v8_app.zig uses).
//!   - windows.zig owns the SDL3 lifecycle, slot table, event routing,
//!     paint, and FreeType text measurement.
//!   - host_tree.zig owns per-frame Node-tree materialization.
//!   - This file is just the glue that wires those modules to the TUI
//!     binary's V8 isolate: open a window on CREATE, run host_props
//!     with the cell→pixel scale on UPDATE, eval __dispatchEvent on
//!     mouse hits, pump per tick.

const std = @import("std");
const build_options = @import("build_options");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const HostContext = @import("host_context.zig");

const layout = @import("layout.zig");
const windows = @import("primitive/windows.zig");
const host_tree = @import("host_tree.zig");
const host_props = @import("host_props.zig");

const Node = layout.Node;

// ────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────

var g_alloc: std.mem.Allocator = undefined;
var g_inited: bool = false;

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

// ────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────

pub fn init(host: *HostContext, alloc: std.mem.Allocator) !void {
    if (g_inited) return;
    g_alloc = alloc;
    g_slot_by_node_id = std.AutoHashMap(u32, usize).init(alloc);
    g_frame_arena = std.heap.ArenaAllocator.init(alloc);
    host_tree.init(alloc);
    host_props.initHandlerPool(alloc);
    host_tree.setHooks(.{
        .open_host_window = openHostWindow,
        .apply_props = applyProps,
        .apply_handler_flags = host_props.applyMouseHandlerFlags,
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
    windows.setJsDispatchFn(host, jsDispatch);
    g_inited = true;
}

pub fn deinit(io: std.Io) void {
    if (!g_inited) return;
    g_slot_by_node_id.deinit();
    g_frame_arena.deinit();
    windows.deinitAll(io);
    windows.shutdownSdl();
    g_inited = false;
}

// (SDL3 lazy init lives in framework/primitive/windows.zig —
// windows.ensureSdlInited() / pumpEvents() / shutdownSdl().)

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
fn jsDispatch(context: *anyopaque, node_id: u32, event_name: []const u8) void {
    const host: *HostContext = @ptrCast(@alignCast(context));
    var buf: [128]u8 = undefined;
    const expr = std.fmt.bufPrint(&buf, "__dispatchEvent({d},'{s}')", .{ node_id, event_name }) catch return;
    v8_runtime.evalExpr(host, expr);
}

// (handler-name lookups, JS-eval string pool, and applyMouseHandlerFlags
// live in framework/host_props.zig — both shells share them. The hook is
// wired in init() above.)

// ────────────────────────────────────────────────────────────────────
// host_tree hooks
// ────────────────────────────────────────────────────────────────────

/// CREATE hook: when a Window/Notification node is created, open the
/// corresponding SDL3 window and remember the slot. Props on the
/// Window itself (title, width, height) are parsed here directly —
/// they're a small fixed set, not subject to the full applyProps
/// CSS-parser path that we still don't have wired.
fn openHostWindow(io: std.Io, environ: *const std.process.Environ.Map, id: u32, type_name: []const u8, props: ?std.json.Value) void {
    const is_window = std.mem.eql(u8, type_name, "Window");
    const is_notif = std.mem.eql(u8, type_name, "Notification");
    if (!is_window and !is_notif) return;
    if (!windows.ensureSdlInited()) return;
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

    std.debug.print("[host_window] opening window id={d} w={d} h={d}\n", .{ id, width, height });
    const slot = windows.open(io, environ, .{
        .title = title,
        .width = width,
        .height = height,
        .kind = if (is_notif) .notification else .in_process,
        .window_id = id,
    }) orelse {
        std.debug.print("[host_window] windows.open FAILED for node {d}\n", .{id});
        return;
    };
    std.debug.print("[host_window] windows.open OK node={d} slot={d}\n", .{ id, slot });

    g_slot_by_node_id.put(id, slot) catch {
        std.debug.print("[host_window] map put OOM\n", .{});
        windows.close(io, slot);
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

// __hostFlush is registered by framework/v8_bindings_reconciler.zig (the
// single owner across both shells). v8_tui_app.zig calls reconciler.register()
// directly. The default `.sync` mode routes payloads through
// host_tree.applyCommandBatch — exactly what this file used to do inline.

pub fn register() void {}

// ────────────────────────────────────────────────────────────────────
// Per-tick pump: SDL events → routeEvent; layout + paint all windows
// ────────────────────────────────────────────────────────────────────

// (materializeWindowRoot + materializeChildren live in
// framework/host_tree.zig — same function, same algorithm, used by both
// shells. tickDrain below calls host_tree.materializeWindowRoot directly.)

pub fn tickDrain(host: *HostContext) void {
    if (!g_inited or !windows.isSdlInited()) return;
    if (g_slot_by_node_id.count() == 0) return;

    // Pump SDL events into per-window routing. In a slim TUI binary
    // there's nothing else polling the queue, so we own it.
    windows.pumpEvents(host.io);

    // Rebuild every open Window's Node tree this frame, point its
    // slot at the new root, then layout + paint. Arena reset is
    // free per-frame allocation.
    _ = g_frame_arena.reset(.retain_capacity);
    const arena = g_frame_arena.allocator();

    var it = g_slot_by_node_id.iterator();
    while (it.next()) |entry| {
        const window_node_id = entry.key_ptr.*;
        const slot_idx = entry.value_ptr.*;
        const root = host_tree.materializeWindowRoot(arena, window_node_id) orelse continue;
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
        const dump_env = host.environ.get("RJIT_DUMP_LAYOUT") orelse "";
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
    windows.paintAndPresent(host.io);
}

fn dumpTree(node: *Node, depth: u32) void {
    var i: u32 = 0;
    while (i < depth) : (i += 1) std.debug.print("  ", .{});
    const r = node.computed;
    const txt: []const u8 = node.text orelse "";
    std.debug.print("rect=({d:.0},{d:.0},{d:.0}x{d:.0}) w_style={?d:.0} h_style={?d:.0} fg={d} '{s}'\n", .{
        r.x,              r.y,               r.w,                  r.h,
        node.style.width, node.style.height, node.style.flex_grow, if (txt.len > 30) txt[0..30] else txt,
    });
    for (node.children) |*child| dumpTree(child, depth + 1);
}
