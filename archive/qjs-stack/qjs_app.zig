//! qjs_app.zig — React (via react-reconciler + love2d hostConfig) running in the
//! framework's real QuickJS VM, producing mutation commands that land directly on
//! framework.layout.Node. Event press → engine's js_on_press evals
//! `__dispatchEvent(id,'onClick')` → React handler runs → commit flushes new
//! mutations via __hostFlush → applied to the same Node pool → layout dirtied.
//! No hermes subprocess. Same AppConfig seam Smith uses.
//!
//! Build:
//!   zig build app -Dapp-name=qjs_d152 -Dapp-source=qjs_app.zig -Doptimize=ReleaseFast

const std = @import("std");
const build_options = @import("build_options");
const IS_LIB = if (@hasDecl(build_options, "is_lib")) build_options.is_lib else false;

const layout = @import("framework/layout.zig");
const Node = layout.Node;
const Style = layout.Style;
const Color = layout.Color;
const effect_ctx = @import("framework/effect_ctx.zig");
const input = @import("framework/input.zig");
const state = @import("framework/state.zig");
const events = @import("framework/events.zig");
const engine = if (IS_LIB) struct {} else @import("framework/engine.zig");
const qjs_runtime = @import("framework/qjs_runtime.zig");
const qjs_bindings = @import("framework/qjs_bindings.zig");
const luajit_runtime = @import("framework/luajit_runtime.zig");
const fs_mod = @import("framework/fs.zig");
const localstore = @import("framework/localstore.zig");
comptime {
    if (!IS_LIB) _ = @import("framework/core.zig");
}

const qjs = @cImport({
    @cInclude("quickjs.h");
});

// Per-cart bundle. Path is `bundle-<app-name>.js` so that two parallel ships
// (different carts) don't race on a shared `bundle.js`. If you run
// `zig build app` directly, make sure the matching bundle file exists.
const BUNDLE_FILE_NAME = std.fmt.comptimePrint("bundle-{s}.js", .{build_options.app_name});
const BUNDLE_BYTES = @embedFile(BUNDLE_FILE_NAME);
const QJS_UNDEFINED: qjs.JSValue = .{ .u = .{ .int32 = 0 }, .tag = 3 };

// Window title = the build's -Dapp-name (set by scripts/ship). Falls back to
// "reactjit" for plain `zig build app` invocations that don't pass a name.
const WINDOW_TITLE = std.fmt.comptimePrint("{s}", .{
    if (@hasDecl(build_options, "app_name") and build_options.app_name.len > 0)
        build_options.app_name
    else
        "reactjit",
});

// ── Globals ────────────────────────────────────────────────────────

var g_alloc: std.mem.Allocator = undefined;
var g_arena: std.heap.ArenaAllocator = undefined;
var g_node_by_id: std.AutoHashMap(u32, *Node) = undefined;
var g_children_ids: std.AutoHashMap(u32, std.ArrayList(u32)) = undefined;
var g_root_child_ids: std.ArrayList(u32) = .{};
var g_root: Node = .{};
var g_dirty: bool = true;
var g_press_expr_pool: std.ArrayList([:0]u8) = .{};
var g_input_slot_by_node_id: std.AutoHashMap(u32, u8) = undefined;
var g_node_id_by_input_slot: [input.MAX_INPUTS]u32 = [_]u32{0} ** input.MAX_INPUTS;

// Content store — Zig-owned buffers referenced by handle. Carts use the
// `useFileContent(path)` React hook to load a file's bytes once into this
// store and pass the returned handle as a prop on TextEditor. The actual
// text never crosses the JS bridge — only the u32 handle does. This fixes
// the "1MB prop diff on every file click" bottleneck.
var g_content_store: std.AutoHashMap(u32, []u8) = undefined;
var g_content_store_next_id: u32 = 1;

// Pending flush queue. host_flush is called mid-frame (from inside js_on_press
// evals, or inside __dispatchEvent's React commit). Applying CMDs mid-frame
// would destroy nodes whose heap memory is still referenced by the engine's
// rendered g_root.children copy — use-after-free. So we queue bytes here and
// drain at tick boundary before rebuildTree.
var g_pending_flush: std.ArrayList([]u8) = .{};

// ── Dev mode — hot reload of the JS bundle ──────────────────────────
// When DEV_MODE is enabled (via -Ddev-mode=true), the binary reads bundle.js
// from disk on startup and polls its mtime each tick. When the file changes
// (esbuild watch mode rebundles it), we tear down the tree + the QuickJS
// context, reinit, and re-eval the new bundle. React state resets on reload
// in phase 1; phase 2 will use LuaJIT hotstate atoms to preserve it.
const DEV_MODE = if (@hasDecl(build_options, "dev_mode")) build_options.dev_mode else false;
const CUSTOM_CHROME_MODE = if (@hasDecl(build_options, "custom_chrome")) build_options.custom_chrome else false;
const BORDERLESS_MODE = DEV_MODE or CUSTOM_CHROME_MODE;
const DEV_BUNDLE_PATH = "bundle.js";

var g_dev_bundle_buf: []u8 = &.{};
var g_last_bundle_mtime: i128 = 0;
var g_mtime_poll_counter: u32 = 0;
var g_reload_pending: bool = false;

const dev_ipc = @import("framework/dev_ipc.zig");

/// A dev-mode tab. Each tab has a human-readable name (cart name) and a
/// heap-owned bundle. The active tab is the one currently evaluated in QJS;
/// others sit dormant until re-activated via IPC push or (future) chrome click.
const Tab = struct {
    name: []u8, // owned
    bundle: []u8, // owned
};

var g_tabs: std.ArrayList(Tab) = .{};
var g_active_tab: usize = 0;

const MAX_TABS = 16;

/// Comptime-generated per-tab click handler. We can't close over an index at
/// runtime in Zig, so we specialize one callback per slot ahead of time.
fn makeTabClickCallback(comptime idx: usize) *const fn () void {
    return struct {
        fn callback() void {
            if (idx < g_tabs.items.len and idx != g_active_tab) switchToTab(idx);
        }
    }.callback;
}

const g_tab_click_callbacks = blk: {
    var arr: [MAX_TABS]*const fn () void = undefined;
    for (0..MAX_TABS) |i| arr[i] = makeTabClickCallback(i);
    break :blk arr;
};

const CHROME_HEIGHT: f32 = 32;
const CHROME_PAD: f32 = 6;
const TAB_PAD_H: f32 = 14;
const TAB_PAD_V: f32 = 4;

fn isInputType(type_name: []const u8) bool {
    return std.mem.eql(u8, type_name, "TextInput") or
        std.mem.eql(u8, type_name, "TextArea") or
        std.mem.eql(u8, type_name, "TextEditor");
}

fn isMultilineInputType(type_name: []const u8) bool {
    return std.mem.eql(u8, type_name, "TextArea") or
        std.mem.eql(u8, type_name, "TextEditor");
}

fn isTerminalType(type_name: []const u8) bool {
    return std.mem.eql(u8, type_name, "Terminal") or
        std.mem.eql(u8, type_name, "terminal");
}

fn dupJsonText(v: std.json.Value) ?[]const u8 {
    return switch (v) {
        .string => |s| g_alloc.dupe(u8, s) catch null,
        .integer => |i| std.fmt.allocPrint(g_alloc, "{d}", .{i}) catch null,
        .float => |f| std.fmt.allocPrint(g_alloc, "{d}", .{f}) catch null,
        .bool => |b| g_alloc.dupe(u8, if (b) "true" else "false") catch null,
        else => null,
    };
}

fn dispatchInputEvent(slot: u8, global_name: [*:0]const u8) void {
    const node_id = g_node_id_by_input_slot[slot];
    if (node_id == 0) return;
    qjs_runtime.callGlobal("__beginJsEvent");
    qjs_runtime.callGlobalInt(global_name, @intCast(node_id));
    qjs_runtime.callGlobal("__endJsEvent");
    // Additive LuaJIT dispatch — cart code running in the Lua VM picks up the
    // same event by defining a matching global. Silent no-op if absent.
    if (luajit_runtime.hasGlobal(global_name)) {
        luajit_runtime.callGlobalInt(global_name, @intCast(node_id));
    }
}

fn makeInputChangeCallback(comptime slot: u8) *const fn () void {
    return struct {
        fn callback() void {
            dispatchInputEvent(slot, "__dispatchInputChange");
        }
    }.callback;
}

fn makeInputSubmitCallback(comptime slot: u8) *const fn () void {
    return struct {
        fn callback() void {
            dispatchInputEvent(slot, "__dispatchInputSubmit");
        }
    }.callback;
}

fn makeInputFocusCallback(comptime slot: u8) *const fn () void {
    return struct {
        fn callback() void {
            dispatchInputEvent(slot, "__dispatchInputFocus");
        }
    }.callback;
}

fn makeInputBlurCallback(comptime slot: u8) *const fn () void {
    return struct {
        fn callback() void {
            dispatchInputEvent(slot, "__dispatchInputBlur");
        }
    }.callback;
}

fn dispatchInputKeyEvent(slot: u8, key: c_int, mods: u16) void {
    const node_id = g_node_id_by_input_slot[slot];
    if (node_id == 0) return;
    qjs_runtime.callGlobal("__beginJsEvent");
    qjs_runtime.callGlobal3Int("__dispatchInputKey", @intCast(node_id), key, mods);
    qjs_runtime.callGlobal("__endJsEvent");
    if (luajit_runtime.hasGlobal("__dispatchInputKey")) {
        luajit_runtime.callGlobal3Int("__dispatchInputKey", @intCast(node_id), key, mods);
    }
}

fn makeInputKeyCallback(comptime slot: u8) *const fn (key: c_int, mods: u16) void {
    return struct {
        fn callback(key: c_int, mods: u16) void {
            dispatchInputKeyEvent(slot, key, mods);
        }
    }.callback;
}

const g_input_change_callbacks = blk: {
    var arr: [input.MAX_INPUTS]*const fn () void = undefined;
    for (0..input.MAX_INPUTS) |i| arr[i] = makeInputChangeCallback(@intCast(i));
    break :blk arr;
};

const g_input_submit_callbacks = blk: {
    var arr: [input.MAX_INPUTS]*const fn () void = undefined;
    for (0..input.MAX_INPUTS) |i| arr[i] = makeInputSubmitCallback(@intCast(i));
    break :blk arr;
};

const g_input_focus_callbacks = blk: {
    var arr: [input.MAX_INPUTS]*const fn () void = undefined;
    for (0..input.MAX_INPUTS) |i| arr[i] = makeInputFocusCallback(@intCast(i));
    break :blk arr;
};

const g_input_blur_callbacks = blk: {
    var arr: [input.MAX_INPUTS]*const fn () void = undefined;
    for (0..input.MAX_INPUTS) |i| arr[i] = makeInputBlurCallback(@intCast(i));
    break :blk arr;
};

const g_input_key_callbacks = blk: {
    var arr: [input.MAX_INPUTS]*const fn (key: c_int, mods: u16) void = undefined;
    for (0..input.MAX_INPUTS) |i| arr[i] = makeInputKeyCallback(@intCast(i));
    break :blk arr;
};

fn ensureInputSlot(node: *Node, id: u32, type_name: []const u8) void {
    if (!isInputType(type_name)) return;

    var slot = g_input_slot_by_node_id.get(id);
    if (slot == null) {
        var reusable: ?u8 = null;
        for (g_node_id_by_input_slot, 0..) |owner_id, i| {
            if (owner_id == 0) {
                reusable = @intCast(i);
                break;
            }
        }
        if (reusable == null) {
            std.debug.print("[qjs] input slot overflow for node {d} ({s})\n", .{ id, type_name });
            return;
        }
        const new_slot = reusable.?;
        g_input_slot_by_node_id.put(id, new_slot) catch {
            std.debug.print("[qjs] failed to allocate input slot for node {d}\n", .{id});
            return;
        };
        slot = new_slot;
    }

    const sid = slot.?;
    g_node_id_by_input_slot[sid] = id;
    if (isMultilineInputType(type_name)) input.registerMultiline(sid) else input.register(sid);
    input.setOnChange(sid, g_input_change_callbacks[sid]);
    input.setOnSubmit(sid, g_input_submit_callbacks[sid]);
    input.setOnFocus(sid, g_input_focus_callbacks[sid]);
    input.setOnBlur(sid, g_input_blur_callbacks[sid]);
    input.setOnKey(sid, g_input_key_callbacks[sid]);
    node.input_id = sid;
}

fn syncInputValue(node: *Node, text: []const u8) void {
    node.text = text;
    if (node.input_id) |slot| {
        input.syncValue(slot, text);
    }
}

fn releaseInputSlot(node_id: u32) void {
    const slot = g_input_slot_by_node_id.get(node_id) orelse return;
    input.unregister(slot);
    g_node_id_by_input_slot[slot] = 0;
    _ = g_input_slot_by_node_id.remove(node_id);
}

// ── Color & prop parsing (JSON-value version) ─────────────────────

fn jsonFloat(v: std.json.Value) ?f32 {
    return switch (v) {
        .integer => |i| @floatFromInt(i),
        .float => |f| @floatCast(f),
        else => null,
    };
}
fn jsonInt(v: std.json.Value) ?i64 {
    return switch (v) {
        .integer => |i| i,
        .float => |f| @intFromFloat(f),
        else => null,
    };
}

// JSX idiom is `hoverable={1}` / `noWrap={0}` — accept bool or numeric 0/1 so
// carts don't have to care which literal the reconciler happens to emit.
fn jsonBool(v: std.json.Value) ?bool {
    return switch (v) {
        .bool => |b| b,
        .integer => |i| i != 0,
        .float => |f| f != 0,
        else => null,
    };
}

fn parseStringFloat(s: []const u8) ?f32 {
    const t = std.mem.trim(u8, s, " \t\r\n");
    if (t.len == 0) return null;
    return std.fmt.parseFloat(f32, t) catch null;
}

fn jsonMaybePct(v: std.json.Value) ?f32 {
    return switch (v) {
        .integer => |i| @floatFromInt(i),
        .float => |f| @floatCast(f),
        .string => |s| blk: {
            const t = std.mem.trim(u8, s, " \t\r\n");
            if (t.len == 0) break :blk null;
            if (std.mem.endsWith(u8, t, "%")) {
                const pct = std.fmt.parseFloat(f32, t[0 .. t.len - 1]) catch break :blk null;
                break :blk -(pct / 100.0);
            }
            break :blk std.fmt.parseFloat(f32, t) catch null;
        },
        else => null,
    };
}

fn jsonSpacing(v: std.json.Value) ?f32 {
    return switch (v) {
        .string => |s| blk: {
            const t = std.mem.trim(u8, s, " \t\r\n");
            if (std.mem.eql(u8, t, "auto")) break :blk std.math.inf(f32);
            if (std.mem.endsWith(u8, t, "%")) {
                const pct = std.fmt.parseFloat(f32, t[0 .. t.len - 1]) catch break :blk null;
                break :blk -(pct / 100.0);
            }
            break :blk parseStringFloat(t);
        },
        else => jsonFloat(v),
    };
}

fn parseHex(s: []const u8) ?Color {
    if (s.len < 4 or s[0] != '#') return null;
    const body = s[1..];
    if (body.len == 3) {
        const r = std.fmt.parseInt(u8, body[0..1], 16) catch return null;
        const g = std.fmt.parseInt(u8, body[1..2], 16) catch return null;
        const b = std.fmt.parseInt(u8, body[2..3], 16) catch return null;
        return Color.rgb(r * 17, g * 17, b * 17);
    }
    if (body.len == 6) {
        const r = std.fmt.parseInt(u8, body[0..2], 16) catch return null;
        const g = std.fmt.parseInt(u8, body[2..4], 16) catch return null;
        const b = std.fmt.parseInt(u8, body[4..6], 16) catch return null;
        return Color.rgb(r, g, b);
    }
    if (body.len == 8) {
        const r = std.fmt.parseInt(u8, body[0..2], 16) catch return null;
        const g = std.fmt.parseInt(u8, body[2..4], 16) catch return null;
        const b = std.fmt.parseInt(u8, body[4..6], 16) catch return null;
        const a = std.fmt.parseInt(u8, body[6..8], 16) catch return null;
        return Color.rgba(r, g, b, a);
    }
    return null;
}

fn parseRgb(s: []const u8) ?Color {
    var i: usize = 0;
    while (i < s.len and s[i] != '(') i += 1;
    if (i >= s.len or s[s.len - 1] != ')') return null;
    const body = s[i + 1 .. s.len - 1];
    var it = std.mem.splitScalar(u8, body, ',');
    var parts: [4]u8 = .{ 0, 0, 0, 255 };
    var idx: usize = 0;
    while (it.next()) |p| : (idx += 1) {
        if (idx >= 4) break;
        const t = std.mem.trim(u8, p, " \t");
        const v = std.fmt.parseFloat(f32, t) catch continue;
        const clamped = @max(@min(v, 255.0), 0.0);
        parts[idx] = @intFromFloat(clamped);
    }
    return Color.rgba(parts[0], parts[1], parts[2], parts[3]);
}

fn parseColor(s: []const u8) ?Color {
    if (s.len == 0) return null;
    if (s[0] == '#') return parseHex(s);
    if (std.mem.startsWith(u8, s, "rgb")) return parseRgb(s);
    const eq = std.mem.eql;
    if (eq(u8, s, "black")) return Color.rgb(0, 0, 0);
    if (eq(u8, s, "white")) return Color.rgb(255, 255, 255);
    if (eq(u8, s, "red")) return Color.rgb(220, 50, 50);
    if (eq(u8, s, "blue")) return Color.rgb(70, 130, 230);
    if (eq(u8, s, "green")) return Color.rgb(60, 190, 100);
    if (eq(u8, s, "yellow")) return Color.rgb(240, 210, 60);
    if (eq(u8, s, "cyan")) return Color.rgb(70, 210, 230);
    if (eq(u8, s, "magenta")) return Color.rgb(220, 80, 200);
    if (eq(u8, s, "transparent")) return Color.rgba(0, 0, 0, 0);
    return null;
}

fn parseColorTextRows(v: std.json.Value) ?[]const layout.ColorTextRow {
    if (v != .array) return null;

    const rows = g_alloc.alloc(layout.ColorTextRow, v.array.items.len) catch return null;
    for (v.array.items, 0..) |row_v, row_idx| {
        if (row_v != .array) {
            rows[row_idx] = .{};
            continue;
        }

        const spans = g_alloc.alloc(layout.ColorTextSpan, row_v.array.items.len) catch {
            rows[row_idx] = .{};
            continue;
        };

        var span_count: usize = 0;
        for (row_v.array.items) |span_v| {
            if (span_v != .object) continue;
            const text_v = span_v.object.get("text") orelse continue;
            const color_v = span_v.object.get("color") orelse continue;
            if (text_v != .string or color_v != .string) continue;

            spans[span_count] = .{
                .text = g_alloc.dupe(u8, text_v.string) catch "",
                .color = parseColor(color_v.string) orelse Color.rgb(255, 255, 255),
            };
            span_count += 1;
        }

        rows[row_idx] = .{ .spans = spans[0..span_count] };
    }
    return rows;
}

fn parseOverflow(s: []const u8) layout.Overflow {
    if (std.mem.eql(u8, s, "hidden")) return .hidden;
    if (std.mem.eql(u8, s, "scroll")) return .scroll;
    if (std.mem.eql(u8, s, "auto")) return .auto;
    return .visible;
}

fn parseDisplay(s: []const u8) layout.Display {
    if (std.mem.eql(u8, s, "none")) return .none;
    return .flex;
}

fn parsePosition(s: []const u8) layout.Position {
    if (std.mem.eql(u8, s, "absolute")) return .absolute;
    return .relative;
}

fn parseTextAlign(s: []const u8) layout.TextAlign {
    if (std.mem.eql(u8, s, "center")) return .center;
    if (std.mem.eql(u8, s, "right")) return .right;
    if (std.mem.eql(u8, s, "justify")) return .justify;
    return .left;
}

fn parseAlignItems(s: []const u8) layout.AlignItems {
    if (std.mem.eql(u8, s, "center")) return .center;
    if (std.mem.eql(u8, s, "flex-start") or std.mem.eql(u8, s, "start")) return .start;
    if (std.mem.eql(u8, s, "flex-end") or std.mem.eql(u8, s, "end")) return .end;
    if (std.mem.eql(u8, s, "baseline")) return .baseline;
    return .stretch;
}

fn parseAlignSelf(s: []const u8) layout.AlignSelf {
    if (std.mem.eql(u8, s, "center")) return .center;
    if (std.mem.eql(u8, s, "flex-start") or std.mem.eql(u8, s, "start")) return .start;
    if (std.mem.eql(u8, s, "flex-end") or std.mem.eql(u8, s, "end")) return .end;
    if (std.mem.eql(u8, s, "stretch")) return .stretch;
    if (std.mem.eql(u8, s, "baseline")) return .baseline;
    return .auto;
}

fn parseAlignContent(s: []const u8) layout.AlignContent {
    if (std.mem.eql(u8, s, "center")) return .center;
    if (std.mem.eql(u8, s, "flex-start") or std.mem.eql(u8, s, "start")) return .start;
    if (std.mem.eql(u8, s, "flex-end") or std.mem.eql(u8, s, "end")) return .end;
    if (std.mem.eql(u8, s, "space-between") or std.mem.eql(u8, s, "spaceBetween")) return .space_between;
    if (std.mem.eql(u8, s, "space-around")) return .space_around;
    if (std.mem.eql(u8, s, "space-evenly")) return .space_evenly;
    return .stretch;
}

fn applyStyleEntry(node: *Node, key: []const u8, val: std.json.Value) void {
    const eq = std.mem.eql;
    if (eq(u8, key, "width")) {
        if (jsonMaybePct(val)) |f| node.style.width = f;
    } else if (eq(u8, key, "height")) {
        if (jsonMaybePct(val)) |f| node.style.height = f;
    } else if (eq(u8, key, "minWidth")) {
        if (jsonMaybePct(val)) |f| node.style.min_width = f;
    } else if (eq(u8, key, "maxWidth")) {
        if (jsonMaybePct(val)) |f| node.style.max_width = f;
    } else if (eq(u8, key, "minHeight")) {
        if (jsonMaybePct(val)) |f| node.style.min_height = f;
    } else if (eq(u8, key, "maxHeight")) {
        if (jsonMaybePct(val)) |f| node.style.max_height = f;
    } else if (eq(u8, key, "flexDirection")) {
        if (val == .string) {
            const s = val.string;
            if (eq(u8, s, "row")) node.style.flex_direction = .row else if (eq(u8, s, "row-reverse")) node.style.flex_direction = .row_reverse else if (eq(u8, s, "column-reverse")) node.style.flex_direction = .column_reverse else node.style.flex_direction = .column;
        }
    } else if (eq(u8, key, "flex")) {
        // CSS shorthand: `flex: N` ≡ `flex: N 1 0%` → flexGrow=N, flexShrink=1, flexBasis=0.
        // Full `flex: grow shrink basis` parsing not needed yet — apps write them separate.
        if (jsonFloat(val)) |f| {
            node.style.flex_grow = f;
            node.style.flex_shrink = 1;
            node.style.flex_basis = 0;
        }
    } else if (eq(u8, key, "flexGrow")) {
        if (jsonFloat(val)) |f| node.style.flex_grow = f;
    } else if (eq(u8, key, "flexShrink")) {
        if (jsonFloat(val)) |f| node.style.flex_shrink = f;
    } else if (eq(u8, key, "flexBasis")) {
        if (jsonMaybePct(val)) |f| node.style.flex_basis = f;
    } else if (eq(u8, key, "flexWrap")) {
        if (val == .string) {
            if (eq(u8, val.string, "wrap")) node.style.flex_wrap = .wrap else if (eq(u8, val.string, "wrap-reverse")) node.style.flex_wrap = .wrap_reverse else node.style.flex_wrap = .no_wrap;
        }
    } else if (eq(u8, key, "gap")) {
        if (jsonFloat(val)) |f| node.style.gap = f;
    } else if (eq(u8, key, "rowGap")) {
        if (jsonFloat(val)) |f| node.style.row_gap = f;
    } else if (eq(u8, key, "columnGap")) {
        if (jsonFloat(val)) |f| node.style.column_gap = f;
    } else if (eq(u8, key, "justifyContent")) {
        if (val == .string) {
            const s = val.string;
            if (eq(u8, s, "center")) node.style.justify_content = .center else if (eq(u8, s, "space-between") or eq(u8, s, "spaceBetween")) node.style.justify_content = .space_between else if (eq(u8, s, "space-around")) node.style.justify_content = .space_around else if (eq(u8, s, "space-evenly")) node.style.justify_content = .space_evenly else if (eq(u8, s, "flex-end") or eq(u8, s, "end")) node.style.justify_content = .end else node.style.justify_content = .start;
        }
    } else if (eq(u8, key, "alignItems")) {
        if (val == .string) node.style.align_items = parseAlignItems(val.string);
    } else if (eq(u8, key, "alignSelf")) {
        if (val == .string) node.style.align_self = parseAlignSelf(val.string);
    } else if (eq(u8, key, "alignContent")) {
        if (val == .string) node.style.align_content = parseAlignContent(val.string);
    } else if (eq(u8, key, "padding")) {
        if (jsonFloat(val)) |f| node.style.padding = f;
    } else if (eq(u8, key, "paddingLeft")) {
        if (jsonFloat(val)) |f| node.style.padding_left = f;
    } else if (eq(u8, key, "paddingRight")) {
        if (jsonFloat(val)) |f| node.style.padding_right = f;
    } else if (eq(u8, key, "paddingTop")) {
        if (jsonFloat(val)) |f| node.style.padding_top = f;
    } else if (eq(u8, key, "paddingBottom")) {
        if (jsonFloat(val)) |f| node.style.padding_bottom = f;
    } else if (eq(u8, key, "margin")) {
        if (jsonSpacing(val)) |f| node.style.margin = f;
    } else if (eq(u8, key, "marginLeft")) {
        if (jsonSpacing(val)) |f| node.style.margin_left = f;
    } else if (eq(u8, key, "marginRight")) {
        if (jsonSpacing(val)) |f| node.style.margin_right = f;
    } else if (eq(u8, key, "marginTop")) {
        if (jsonSpacing(val)) |f| node.style.margin_top = f;
    } else if (eq(u8, key, "marginBottom")) {
        if (jsonSpacing(val)) |f| node.style.margin_bottom = f;
    } else if (eq(u8, key, "display")) {
        if (val == .string) node.style.display = parseDisplay(val.string);
    } else if (eq(u8, key, "overflow")) {
        if (val == .string) node.style.overflow = parseOverflow(val.string);
    } else if (eq(u8, key, "textAlign")) {
        if (val == .string) node.style.text_align = parseTextAlign(val.string);
    } else if (eq(u8, key, "position")) {
        if (val == .string) node.style.position = parsePosition(val.string);
    } else if (eq(u8, key, "top")) {
        if (jsonMaybePct(val)) |f| node.style.top = f;
    } else if (eq(u8, key, "left")) {
        if (jsonMaybePct(val)) |f| node.style.left = f;
    } else if (eq(u8, key, "right")) {
        if (jsonMaybePct(val)) |f| node.style.right = f;
    } else if (eq(u8, key, "bottom")) {
        if (jsonMaybePct(val)) |f| node.style.bottom = f;
    } else if (eq(u8, key, "aspectRatio")) {
        if (jsonFloat(val)) |f| node.style.aspect_ratio = f;
    } else if (eq(u8, key, "borderWidth")) {
        if (jsonFloat(val)) |f| node.style.border_width = f;
    } else if (eq(u8, key, "borderTopWidth")) {
        if (jsonFloat(val)) |f| node.style.border_top_width = f;
    } else if (eq(u8, key, "borderRightWidth")) {
        if (jsonFloat(val)) |f| node.style.border_right_width = f;
    } else if (eq(u8, key, "borderBottomWidth")) {
        if (jsonFloat(val)) |f| node.style.border_bottom_width = f;
    } else if (eq(u8, key, "borderLeftWidth")) {
        if (jsonFloat(val)) |f| node.style.border_left_width = f;
    } else if (eq(u8, key, "borderColor")) {
        if (val == .string) node.style.border_color = parseColor(val.string);
    } else if (eq(u8, key, "borderRadius")) {
        if (jsonFloat(val)) |f| node.style.border_radius = f;
    } else if (eq(u8, key, "borderTopLeftRadius")) {
        if (jsonFloat(val)) |f| node.style.border_top_left_radius = f;
    } else if (eq(u8, key, "borderTopRightRadius")) {
        if (jsonFloat(val)) |f| node.style.border_top_right_radius = f;
    } else if (eq(u8, key, "borderBottomRightRadius")) {
        if (jsonFloat(val)) |f| node.style.border_bottom_right_radius = f;
    } else if (eq(u8, key, "borderBottomLeftRadius")) {
        if (jsonFloat(val)) |f| node.style.border_bottom_left_radius = f;
    } else if (eq(u8, key, "backgroundColor")) {
        if (val == .string) node.style.background_color = parseColor(val.string);
    } else if (eq(u8, key, "opacity")) {
        if (jsonFloat(val)) |f| node.style.opacity = f;
    } else if (eq(u8, key, "rotation")) {
        if (jsonFloat(val)) |f| node.style.rotation = f;
    } else if (eq(u8, key, "scaleX")) {
        if (jsonFloat(val)) |f| node.style.scale_x = f;
    } else if (eq(u8, key, "scaleY")) {
        if (jsonFloat(val)) |f| node.style.scale_y = f;
    } else if (eq(u8, key, "zIndex")) {
        if (jsonInt(val)) |i| node.style.z_index = @intCast(i);
    }
    // Text-typography keys: also valid inside `style`, since React code
    // (and hostConfig.ts's HTML heading defaults) routes them there. Without
    // this block, `<Text style={{ fontSize: 14 }}>` and `<h1>...</h1>` both
    // silently render at the default size.
    else if (eq(u8, key, "fontSize")) {
        if (jsonInt(val)) |i| node.font_size = @intCast(@max(i, 1));
    } else if (eq(u8, key, "color")) {
        if (val == .string) node.text_color = parseColor(val.string);
    } else if (eq(u8, key, "letterSpacing")) {
        if (jsonFloat(val)) |f| node.letter_spacing = f;
    } else if (eq(u8, key, "lineHeight")) {
        if (jsonFloat(val)) |f| node.line_height = f;
    }
}

fn applyStyle(node: *Node, style_v: std.json.Value) void {
    if (style_v != .object) return;
    var it = style_v.object.iterator();
    while (it.next()) |e| applyStyleEntry(node, e.key_ptr.*, e.value_ptr.*);
}

fn resetStyleEntry(node: *Node, key: []const u8) void {
    const d = Style{};
    const eq = std.mem.eql;
    if (eq(u8, key, "width")) node.style.width = d.width else if (eq(u8, key, "height")) node.style.height = d.height else if (eq(u8, key, "minWidth")) node.style.min_width = d.min_width else if (eq(u8, key, "maxWidth")) node.style.max_width = d.max_width else if (eq(u8, key, "minHeight")) node.style.min_height = d.min_height else if (eq(u8, key, "maxHeight")) node.style.max_height = d.max_height else if (eq(u8, key, "flexDirection")) node.style.flex_direction = d.flex_direction else if (eq(u8, key, "flexGrow")) node.style.flex_grow = d.flex_grow else if (eq(u8, key, "flexShrink")) node.style.flex_shrink = d.flex_shrink else if (eq(u8, key, "flexBasis")) node.style.flex_basis = d.flex_basis else if (eq(u8, key, "flexWrap")) node.style.flex_wrap = d.flex_wrap else if (eq(u8, key, "gap")) node.style.gap = d.gap else if (eq(u8, key, "rowGap")) node.style.row_gap = d.row_gap else if (eq(u8, key, "columnGap")) node.style.column_gap = d.column_gap else if (eq(u8, key, "justifyContent")) node.style.justify_content = d.justify_content else if (eq(u8, key, "alignItems")) node.style.align_items = d.align_items else if (eq(u8, key, "alignSelf")) node.style.align_self = d.align_self else if (eq(u8, key, "alignContent")) node.style.align_content = d.align_content else if (eq(u8, key, "padding")) node.style.padding = d.padding else if (eq(u8, key, "paddingLeft")) node.style.padding_left = d.padding_left else if (eq(u8, key, "paddingRight")) node.style.padding_right = d.padding_right else if (eq(u8, key, "paddingTop")) node.style.padding_top = d.padding_top else if (eq(u8, key, "paddingBottom")) node.style.padding_bottom = d.padding_bottom else if (eq(u8, key, "margin")) node.style.margin = d.margin else if (eq(u8, key, "marginLeft")) node.style.margin_left = d.margin_left else if (eq(u8, key, "marginRight")) node.style.margin_right = d.margin_right else if (eq(u8, key, "marginTop")) node.style.margin_top = d.margin_top else if (eq(u8, key, "marginBottom")) node.style.margin_bottom = d.margin_bottom else if (eq(u8, key, "display")) node.style.display = d.display else if (eq(u8, key, "overflow")) node.style.overflow = d.overflow else if (eq(u8, key, "textAlign")) node.style.text_align = d.text_align else if (eq(u8, key, "position")) node.style.position = d.position else if (eq(u8, key, "top")) node.style.top = d.top else if (eq(u8, key, "left")) node.style.left = d.left else if (eq(u8, key, "right")) node.style.right = d.right else if (eq(u8, key, "bottom")) node.style.bottom = d.bottom else if (eq(u8, key, "aspectRatio")) node.style.aspect_ratio = d.aspect_ratio else if (eq(u8, key, "borderWidth")) node.style.border_width = d.border_width else if (eq(u8, key, "borderTopWidth")) node.style.border_top_width = d.border_top_width else if (eq(u8, key, "borderRightWidth")) node.style.border_right_width = d.border_right_width else if (eq(u8, key, "borderBottomWidth")) node.style.border_bottom_width = d.border_bottom_width else if (eq(u8, key, "borderLeftWidth")) node.style.border_left_width = d.border_left_width else if (eq(u8, key, "borderColor")) node.style.border_color = d.border_color else if (eq(u8, key, "borderRadius")) node.style.border_radius = d.border_radius else if (eq(u8, key, "borderTopLeftRadius")) node.style.border_top_left_radius = d.border_top_left_radius else if (eq(u8, key, "borderTopRightRadius")) node.style.border_top_right_radius = d.border_top_right_radius else if (eq(u8, key, "borderBottomRightRadius")) node.style.border_bottom_right_radius = d.border_bottom_right_radius else if (eq(u8, key, "borderBottomLeftRadius")) node.style.border_bottom_left_radius = d.border_bottom_left_radius else if (eq(u8, key, "backgroundColor")) node.style.background_color = d.background_color else if (eq(u8, key, "opacity")) node.style.opacity = d.opacity else if (eq(u8, key, "rotation")) node.style.rotation = d.rotation else if (eq(u8, key, "scaleX")) node.style.scale_x = d.scale_x else if (eq(u8, key, "scaleY")) node.style.scale_y = d.scale_y else if (eq(u8, key, "zIndex")) node.style.z_index = d.z_index;
}

fn removeStyleKeys(node: *Node, keys_v: std.json.Value) void {
    if (keys_v != .array) return;
    for (keys_v.array.items) |entry| {
        if (entry == .string) resetStyleEntry(node, entry.string);
    }
}

fn removePropKeys(node: *Node, keys_v: std.json.Value) void {
    if (keys_v != .array) return;
    for (keys_v.array.items) |entry| {
        if (entry != .string) continue;
        const k = entry.string;
        if (std.mem.eql(u8, k, "fontSize")) {
            if (node.terminal) node.terminal_font_size = 13 else node.font_size = 16;
        } else if (std.mem.eql(u8, k, "color")) node.text_color = null else if (std.mem.eql(u8, k, "letterSpacing")) node.letter_spacing = 0 else if (std.mem.eql(u8, k, "lineHeight")) node.line_height = 0 else if (std.mem.eql(u8, k, "numberOfLines")) node.number_of_lines = 0 else if (std.mem.eql(u8, k, "noWrap")) node.no_wrap = false else if (std.mem.eql(u8, k, "paintText")) node.input_paint_text = true else if (std.mem.eql(u8, k, "colorRows")) node.input_color_rows = null else if (std.mem.eql(u8, k, "placeholder")) node.placeholder = null else if (std.mem.eql(u8, k, "value")) node.text = null else if (std.mem.eql(u8, k, "source")) node.image_src = null else if (std.mem.eql(u8, k, "href")) node.href = null else if (std.mem.eql(u8, k, "tooltip")) node.tooltip = null else if (std.mem.eql(u8, k, "hoverable")) node.hoverable = false else if (std.mem.eql(u8, k, "debugName")) node.debug_name = null else if (std.mem.eql(u8, k, "testID")) node.test_id = null else if (std.mem.eql(u8, k, "windowDrag")) node.window_drag = false else if (std.mem.eql(u8, k, "windowResize")) node.window_resize = false;
    }
}

fn applyTypeDefaults(node: *Node, id: u32, type_name: []const u8) void {
    const eq = std.mem.eql;
    if (eq(u8, type_name, "ScrollView")) {
        node.style.overflow = .scroll;
    } else if (eq(u8, type_name, "Canvas")) {
        // Infinite pan/zoom surface. `canvas_type` is what wires engine paint,
        // hit-testing, drag-to-pan and wheel-to-zoom in events.zig / engine.zig.
        node.canvas_type = "canvas";
        node.graph_container = true;
    } else if (eq(u8, type_name, "Graph")) {
        // Static viewport — view transform only, no interaction.
        node.graph_container = true;
    } else if (eq(u8, type_name, "Canvas.Node") or eq(u8, type_name, "Graph.Node")) {
        node.canvas_node = true;
    } else if (eq(u8, type_name, "Canvas.Path") or eq(u8, type_name, "Graph.Path")) {
        node.canvas_path = true;
    } else if (eq(u8, type_name, "Canvas.Clamp")) {
        node.canvas_clamp = true;
    } else if (isTerminalType(type_name)) {
        node.terminal = true;
    }
    ensureInputSlot(node, id, type_name);
}

fn applyProps(node: *Node, props: std.json.Value, type_name: ?[]const u8) void {
    if (props != .object) return;
    const is_input = node.input_id != null or (type_name != null and isInputType(type_name.?));
    const is_terminal = node.terminal or (type_name != null and isTerminalType(type_name.?));
    var it = props.object.iterator();
    while (it.next()) |e| {
        const k = e.key_ptr.*;
        const v = e.value_ptr.*;
        if (std.mem.eql(u8, k, "style")) applyStyle(node, v) else if (std.mem.eql(u8, k, "fontSize")) {
            if (jsonInt(v)) |i| {
                const size: u16 = @intCast(@max(i, 1));
                if (is_terminal) node.terminal_font_size = size else node.font_size = size;
            }
        } else if (is_terminal and std.mem.eql(u8, k, "terminalFontSize")) {
            if (jsonInt(v)) |i| node.terminal_font_size = @intCast(@max(i, 1));
        } else if (std.mem.eql(u8, k, "color")) {
            if (v == .string) node.text_color = parseColor(v.string);
        } else if (std.mem.eql(u8, k, "letterSpacing")) {
            if (jsonFloat(v)) |f| node.letter_spacing = f;
        } else if (std.mem.eql(u8, k, "lineHeight")) {
            if (jsonFloat(v)) |f| node.line_height = f;
        } else if (std.mem.eql(u8, k, "numberOfLines")) {
            if (jsonInt(v)) |i| node.number_of_lines = @intCast(@max(i, 0));
        } else if (std.mem.eql(u8, k, "noWrap")) {
            if (jsonBool(v)) |b| node.no_wrap = b;
        } else if (is_input and std.mem.eql(u8, k, "paintText")) {
            if (jsonBool(v)) |b| node.input_paint_text = b;
        } else if (is_input and std.mem.eql(u8, k, "colorRows")) {
            node.input_color_rows = parseColorTextRows(v);
        } else if (is_input and std.mem.eql(u8, k, "placeholder")) {
            if (dupJsonText(v)) |s| node.placeholder = s;
        } else if (is_input and std.mem.eql(u8, k, "value")) {
            if (dupJsonText(v)) |s| syncInputValue(node, s);
        } else if (is_input and std.mem.eql(u8, k, "contentHandle")) {
            // Handle-based content: skip the 1MB string-prop round-trip. The
            // buffer already lives in g_content_store; point node.text directly
            // at it so the paint path reads the Zig-owned bytes. Stays valid
            // until the hook cleanup releases the handle.
            const handle: u32 = switch (v) {
                .integer => @intCast(@max(0, v.integer)),
                .float => @intFromFloat(@max(0.0, v.float)),
                else => 0,
            };
            if (handle != 0) {
                if (contentStoreGet(handle)) |buf| syncInputValue(node, buf);
            }
        } else if (std.mem.eql(u8, k, "source")) {
            if (dupJsonText(v)) |s| node.image_src = s;
        } else if (std.mem.eql(u8, k, "renderSrc")) {
            if (dupJsonText(v)) |s| node.render_src = s;
        } else if (std.mem.eql(u8, k, "href")) {
            if (dupJsonText(v)) |s| node.href = s;
        } else if (std.mem.eql(u8, k, "tooltip")) {
            if (dupJsonText(v)) |s| node.tooltip = s;
        } else if (std.mem.eql(u8, k, "hoverable")) {
            if (jsonBool(v)) |b| node.hoverable = b;
        } else if (std.mem.eql(u8, k, "debugName")) {
            if (dupJsonText(v)) |s| node.debug_name = s;
        } else if (std.mem.eql(u8, k, "testID")) {
            if (dupJsonText(v)) |s| node.test_id = s;
        } else if (std.mem.eql(u8, k, "windowDrag")) {
            if (jsonBool(v)) |b| node.window_drag = b;
        } else if (std.mem.eql(u8, k, "windowResize")) {
            if (jsonBool(v)) |b| node.window_resize = b;
        }
        // ── Canvas / Graph props ──
        else if (std.mem.eql(u8, k, "gx")) {
            if (jsonFloat(v)) |f| node.canvas_gx = f;
        } else if (std.mem.eql(u8, k, "gy")) {
            if (jsonFloat(v)) |f| node.canvas_gy = f;
        } else if (std.mem.eql(u8, k, "gw")) {
            if (jsonFloat(v)) |f| node.canvas_gw = f;
        } else if (std.mem.eql(u8, k, "gh")) {
            if (jsonFloat(v)) |f| node.canvas_gh = f;
        } else if (std.mem.eql(u8, k, "d")) {
            if (dupJsonText(v)) |s| node.canvas_path_d = s;
        } else if (std.mem.eql(u8, k, "stroke")) {
            // `stroke` maps to text_color — that's the field engine_paint.zig
            // reads for Canvas.Path / Graph.Path stroke color.
            if (v == .string) node.text_color = parseColor(v.string);
        } else if (std.mem.eql(u8, k, "strokeWidth")) {
            if (jsonFloat(v)) |f| node.canvas_stroke_width = f;
        } else if (std.mem.eql(u8, k, "fill")) {
            if (v == .string) node.canvas_fill_color = parseColor(v.string);
        } else if (std.mem.eql(u8, k, "fillEffect")) {
            if (dupJsonText(v)) |s| node.canvas_fill_effect = s;
        } else if (std.mem.eql(u8, k, "textEffect")) {
            if (dupJsonText(v)) |s| node.text_effect = s;
        } else if (std.mem.eql(u8, k, "viewX")) {
            // Initial camera — engine applies once per canvas instance, then
            // user drag/scroll takes over (see paintCanvasContainer).
            if (jsonFloat(v)) |f| {
                node.canvas_view_x = f;
                node.canvas_view_set = true;
            }
        } else if (std.mem.eql(u8, k, "viewY")) {
            if (jsonFloat(v)) |f| {
                node.canvas_view_y = f;
                node.canvas_view_set = true;
            }
        } else if (std.mem.eql(u8, k, "viewZoom")) {
            if (jsonFloat(v)) |f| {
                node.canvas_view_zoom = f;
                node.canvas_view_set = true;
            }
        }
        // ── Effect props ──
        else if (std.mem.eql(u8, k, "name")) {
            if (dupJsonText(v)) |s| node.effect_name = s;
        } else if (std.mem.eql(u8, k, "background")) {
            if (jsonBool(v)) |b| node.effect_background = b;
        } else if (std.mem.eql(u8, k, "shader")) {
            // WGSL fragment shader body. We prepend a standard header
            // (uniforms struct, fullscreen-triangle vs_main) and the
            // shared math library (snoise, fbm, hsv2rgb, hsl2rgb, …)
            // before the user code so every cart sees the same surface.
            if (v == .string) {
                if (assembleEffectShader(v.string)) |wgsl| {
                    node.effect_shader = .{ .wgsl = wgsl };
                }
            }
        }
    }
}

// WGSL header: uniforms + fullscreen-triangle vertex shader. Matches the
// GpuUniforms layout in framework/effects.zig and the `vs_main`/`fs_main`
// entry points renderGpu expects.
const EFFECT_WGSL_HEADER: []const u8 =
    \\struct Uniforms {
    \\  size_w: f32,
    \\  size_h: f32,
    \\  time: f32,
    \\  dt: f32,
    \\  frame: f32,
    \\  mouse_x: f32,
    \\  mouse_y: f32,
    \\  mouse_inside: f32,
    \\};
    \\@group(0) @binding(0) var<uniform> U: Uniforms;
    \\
    \\struct VsOut {
    \\  @builtin(position) pos: vec4f,
    \\  @location(0) uv: vec2f,
    \\};
    \\
    \\@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VsOut {
    \\  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    \\  // UV's Y is inverted relative to framebuffer: the image shader
    \\  // (framework/gpu/shaders.zig image_wgsl) samples with `uv.y = 1 - corner.y`
    \\  // to compensate for CPU-path flipRowsInPlace. To get the same top-down
    \\  // display for shader-written textures, we map framebuffer y=0 → uv.y=1
    \\  // (user's "bottom"), so that texture row 0 holds "bottom content" and the
    \\  // image shader's flip displays "top content" at screen top.
    \\  let uvs = array<vec2f, 3>(vec2f(0.0, 0.0), vec2f(2.0, 0.0), vec2f(0.0, 2.0));
    \\  var out: VsOut;
    \\  out.pos = vec4f(positions[i], 0.0, 1.0);
    \\  out.uv = uvs[i];
    \\  return out;
    \\}
    \\
;

const EFFECT_WGSL_MATH: []const u8 = @embedFile("framework/gpu/effect_math.wgsl");

fn assembleEffectShader(user_wgsl: []const u8) ?[]const u8 {
    const total = EFFECT_WGSL_HEADER.len + EFFECT_WGSL_MATH.len + user_wgsl.len + 2;
    const out = g_alloc.alloc(u8, total) catch return null;
    var i: usize = 0;
    @memcpy(out[i .. i + EFFECT_WGSL_HEADER.len], EFFECT_WGSL_HEADER);
    i += EFFECT_WGSL_HEADER.len;
    @memcpy(out[i .. i + EFFECT_WGSL_MATH.len], EFFECT_WGSL_MATH);
    i += EFFECT_WGSL_MATH.len;
    out[i] = '\n';
    i += 1;
    @memcpy(out[i .. i + user_wgsl.len], user_wgsl);
    i += user_wgsl.len;
    return out[0..i];
}

// Called by effects.renderCpuNow when a node has node.effect_render pointing
// at us. `ctx.user_data` carries the React fiber id (set on the Instance as
// node_key = node.scroll_persist_slot, see effects.zig instanceKey). That id
// is what handlerRegistry maps to the user's onRender closure.
fn qjs_effect_shim(ctx: *effect_ctx.EffectContext) void {
    const id_u: usize = ctx.user_data;
    if (id_u == 0) return;
    const id: u32 = @intCast(id_u);
    const buf_len: usize = @as(usize, ctx.height) * @as(usize, ctx.stride);
    qjs_runtime.dispatchEffectRender(
        id,
        ctx.buf,
        buf_len,
        ctx.width,
        ctx.height,
        ctx.stride,
        ctx.time,
        ctx.dt,
        ctx.mouse_x,
        ctx.mouse_y,
        ctx.mouse_inside,
        ctx.frame,
    );
}

// Placeholder render_fn for shader-only effects. `paintCustomEffect` only
// engages when node.effect_render is non-null, so shader-only nodes need a
// real pointer here. The GPU path fires first (shouldTryGpu → renderGpu)
// and the CPU path never actually calls this — it's just a gate.
fn noop_effect_render(_: *effect_ctx.EffectContext) void {}

// ── Event wiring: set js_on_press = `__dispatchEvent(<id>, 'onClick')` ───

fn cmdHasHandlerName(cmd: std.json.Value, name: []const u8) bool {
    const names_v = cmd.object.get("handlerNames") orelse return false;
    if (names_v != .array) return false;
    for (names_v.array.items) |entry| {
        if (entry == .string and std.mem.eql(u8, entry.string, name)) return true;
    }
    return false;
}

fn cmdHasAnyHandlerName(cmd: std.json.Value, comptime names: []const []const u8) bool {
    inline for (names) |name| {
        if (cmdHasHandlerName(cmd, name)) return true;
    }
    return false;
}

fn installJsExpr(comptime expr_fmt: []const u8, id: u32) ?[*:0]const u8 {
    const s = std.fmt.allocPrint(g_alloc, expr_fmt, .{id}) catch return null;
    const sz: [:0]u8 = s[0 .. s.len - 1 :0];
    g_press_expr_pool.append(g_alloc, sz) catch {};
    return sz.ptr;
}

fn applyHandlerFlags(node: *Node, id: u32, cmd: std.json.Value) void {
    node.handlers.js_on_press = null;
    node.handlers.js_on_mouse_down = null;
    node.handlers.js_on_mouse_move = null;
    node.handlers.js_on_mouse_up = null;
    node.handlers.js_on_hover_enter = null;
    node.handlers.js_on_hover_exit = null;
    node.handlers.on_scroll = null;
    node.handlers.on_right_click = null;
    node.canvas_move_draggable = false;
    node.effect_render = null;

    if (cmdHasAnyHandlerName(cmd, &.{ "onClick", "onPress" })) {
        node.handlers.js_on_press = installJsExpr("__dispatchEvent({d},'onClick')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onMouseDown", "onPointerDown", "onPressIn" })) {
        node.handlers.js_on_mouse_down = installJsExpr("__dispatchEvent({d},'onMouseDown')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onMouseMove", "onPointerMove" })) {
        node.handlers.js_on_mouse_move = installJsExpr("__dispatchEvent({d},'onMouseMove')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onMouseUp", "onPointerUp", "onPressOut" })) {
        node.handlers.js_on_mouse_up = installJsExpr("__dispatchEvent({d},'onMouseUp')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onHoverEnter", "onMouseEnter" })) {
        node.handlers.js_on_hover_enter = installJsExpr("__dispatchEvent({d},'onHoverEnter')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onHoverExit", "onMouseLeave" })) {
        node.handlers.js_on_hover_exit = installJsExpr("__dispatchEvent({d},'onHoverExit')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{"onScroll"})) {
        node.handlers.on_scroll = qjs_runtime.dispatchPreparedScroll;
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onRightClick", "onContextMenu" })) {
        node.handlers.on_right_click = qjs_runtime.dispatchPreparedRightClick;
    }
    if (cmdHasAnyHandlerName(cmd, &.{"onMove"})) {
        node.canvas_move_draggable = true;
    }
    // onRender wires this node into the Effect custom-render path. The React
    // id is carried through materializeChildren via node.scroll_persist_slot
    // and read back from ctx.user_data inside qjs_effect_shim.
    if (cmdHasHandlerName(cmd, "onRender")) {
        node.effect_render = &qjs_effect_shim;
    } else if (node.effect_shader != null) {
        // Shader-only effect — paintCustomEffect gates on effect_render being
        // non-null. The GPU pipeline (shouldTryGpu → renderGpu) fires before
        // the CPU path so this pointer is only a gate, never called.
        node.effect_render = &noop_effect_render;
    }
}

// Engine-owned Alt+drag writes the in-progress canvas_gx/gy straight into the
// host Node pool so each motion picks up the new position without going through
// a React setState (which would re-render the whole Canvas.Node subtree and
// saturate __hostFlush with multi-KB UPDATE batches).
fn setCanvasNodePosition(id: u32, gx: f32, gy: f32) void {
    if (g_node_by_id.get(id)) |node| {
        node.canvas_gx = gx;
        node.canvas_gy = gy;
    }
}

// ── Command application ─────────────────────────────────────────

fn ensureNode(id: u32) !*Node {
    if (g_node_by_id.get(id)) |n| return n;
    const n = try g_alloc.create(Node);
    n.* = .{};
    n.scroll_persist_slot = id;
    try g_node_by_id.put(id, n);
    try g_children_ids.put(id, .{});
    return n;
}

/// When a bare text node (created by CREATE_TEXT, i.e. React's TextInstance
/// for a string child) is appended to a parent, copy the parent's typography
/// so `<Text fontSize={17}>Hello</Text>` actually renders "Hello" at 17. The
/// reconciler makes the parent Text and child TextInstance separate nodes;
/// without this propagation the child inherits nothing and uses the default 16.
fn inheritTypography(parent_id: u32, child_id: u32) void {
    const parent = g_node_by_id.get(parent_id) orelse return;
    const child = g_node_by_id.get(child_id) orelse return;
    if (child.text == null) return;
    child.font_size = parent.font_size;
    if (parent.text_color) |c| child.text_color = c;
    child.letter_spacing = parent.letter_spacing;
    // Only propagate line_height when the parent explicitly set one. Without
    // this guard, a child with its own `lineHeight` style would get stomped
    // back to 0 by any parent UPDATE (the default), which desynchronises
    // paint (uses node.line_height) from hit-test (uses node.line_height).
    if (parent.line_height > 0) child.line_height = parent.line_height;
}

fn applyCommand(cmd: std.json.Value) !void {
    if (cmd != .object) return;
    const op = (cmd.object.get("op") orelse return).string;

    if (std.mem.eql(u8, op, "CREATE")) {
        const id: u32 = @intCast(cmd.object.get("id").?.integer);
        const n = try ensureNode(id);
        var type_name: ?[]const u8 = null;
        if (cmd.object.get("type")) |t| if (t == .string) {
            type_name = t.string;
            applyTypeDefaults(n, id, t.string);
        };
        if (cmd.object.get("props")) |props| applyProps(n, props, type_name);
        applyHandlerFlags(n, id, cmd);
        g_dirty = true;
    } else if (std.mem.eql(u8, op, "CREATE_TEXT")) {
        const id: u32 = @intCast(cmd.object.get("id").?.integer);
        const n = try ensureNode(id);
        if (cmd.object.get("text")) |t| if (t == .string) {
            n.text = try g_alloc.dupe(u8, t.string);
        };
        g_dirty = true;
    } else if (std.mem.eql(u8, op, "APPEND")) {
        const pid: u32 = @intCast(cmd.object.get("parentId").?.integer);
        const cid: u32 = @intCast(cmd.object.get("childId").?.integer);
        _ = try ensureNode(pid);
        _ = try ensureNode(cid);
        if (g_children_ids.getPtr(pid)) |list| try list.append(g_alloc, cid);
        inheritTypography(pid, cid);
        g_dirty = true;
    } else if (std.mem.eql(u8, op, "APPEND_TO_ROOT")) {
        const cid: u32 = @intCast(cmd.object.get("childId").?.integer);
        _ = try ensureNode(cid);
        try g_root_child_ids.append(g_alloc, cid);
        g_dirty = true;
    } else if (std.mem.eql(u8, op, "INSERT_BEFORE_ROOT")) {
        const cid: u32 = @intCast(cmd.object.get("childId").?.integer);
        const bid: u32 = @intCast(cmd.object.get("beforeId").?.integer);
        _ = try ensureNode(cid);
        var idx: usize = g_root_child_ids.items.len;
        for (g_root_child_ids.items, 0..) |x, i| if (x == bid) {
            idx = i;
            break;
        };
        try g_root_child_ids.insert(g_alloc, idx, cid);
        g_dirty = true;
    } else if (std.mem.eql(u8, op, "INSERT_BEFORE")) {
        const pid: u32 = @intCast(cmd.object.get("parentId").?.integer);
        const cid: u32 = @intCast(cmd.object.get("childId").?.integer);
        const bid: u32 = @intCast(cmd.object.get("beforeId").?.integer);
        _ = try ensureNode(cid);
        if (g_children_ids.getPtr(pid)) |list| {
            var idx: usize = list.items.len;
            for (list.items, 0..) |x, i| if (x == bid) {
                idx = i;
                break;
            };
            try list.insert(g_alloc, idx, cid);
        }
        inheritTypography(pid, cid);
        g_dirty = true;
    } else if (std.mem.eql(u8, op, "REMOVE")) {
        const pid: u32 = @intCast(cmd.object.get("parentId").?.integer);
        const cid: u32 = @intCast(cmd.object.get("childId").?.integer);
        if (g_children_ids.getPtr(pid)) |list| {
            for (list.items, 0..) |x, i| if (x == cid) {
                _ = list.orderedRemove(i);
                break;
            };
        }
        g_dirty = true;
    } else if (std.mem.eql(u8, op, "REMOVE_FROM_ROOT")) {
        const cid: u32 = @intCast(cmd.object.get("childId").?.integer);
        for (g_root_child_ids.items, 0..) |x, i| if (x == cid) {
            _ = g_root_child_ids.orderedRemove(i);
            break;
        };
        g_dirty = true;
    } else if (std.mem.eql(u8, op, "UPDATE")) {
        const id: u32 = @intCast(cmd.object.get("id").?.integer);
        if (g_node_by_id.get(id)) |n| {
            if (cmd.object.get("removeKeys")) |keys| removePropKeys(n, keys);
            if (cmd.object.get("removeStyleKeys")) |keys| removeStyleKeys(n, keys);
            if (cmd.object.get("props")) |props| applyProps(n, props, null);
            applyHandlerFlags(n, id, cmd);
            // Propagate typography to bare text children so dynamic fontSize
            // changes on the parent flow through to the child TextInstances.
            if (g_children_ids.get(id)) |children| {
                for (children.items) |child_id| inheritTypography(id, child_id);
            }
            g_dirty = true;
        }
    } else if (std.mem.eql(u8, op, "UPDATE_TEXT")) {
        const id: u32 = @intCast(cmd.object.get("id").?.integer);
        if (g_node_by_id.get(id)) |n| {
            if (cmd.object.get("text")) |t| if (t == .string) {
                n.text = try g_alloc.dupe(u8, t.string);
            };
            g_dirty = true;
        }
    }
}

fn applyCommandBatch(json_bytes: []const u8) void {
    const t0 = std.time.microTimestamp();
    const parsed = std.json.parseFromSlice(std.json.Value, g_alloc, json_bytes, .{}) catch |err| {
        std.debug.print("[qjs] parse error: {s}\n", .{@errorName(err)});
        return;
    };
    defer parsed.deinit();
    if (parsed.value != .array) return;
    const t1 = std.time.microTimestamp();
    const cmd_count = parsed.value.array.items.len;
    for (parsed.value.array.items) |cmd| applyCommand(cmd) catch |err| {
        std.debug.print("[qjs] apply error: {s}\n", .{@errorName(err)});
    };
    const t2 = std.time.microTimestamp();
    cleanupDetachedNodes();
    const t3 = std.time.microTimestamp();
    if (json_bytes.len > 10_000) {
        std.debug.print("[batch-timing] bytes={d} cmds={d} parse={d}ms apply={d}ms cleanup={d}ms\n", .{
            json_bytes.len,           cmd_count,
            @divTrunc(t1 - t0, 1000), @divTrunc(t2 - t1, 1000),
            @divTrunc(t3 - t2, 1000),
        });
    }
}

// ── QJS host function: __hostFlush(json) ────────────────────────
// JSCFunction signature: fn(ctx, this, argc, argv) -> JSValue

export fn host_flush(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) qjs.JSValue {
    _ = argc;
    if (ctx == null) return QJS_UNDEFINED;
    const c_str = qjs.JS_ToCString(ctx, argv[0]);
    if (c_str == null) return QJS_UNDEFINED;
    defer qjs.JS_FreeCString(ctx, c_str);
    const slice = std.mem.span(c_str);
    // Do not apply inline. host_flush fires inside js_on_press evals and
    // React's commit-on-setState path — both mid-frame. Destroying nodes now
    // frees memory the engine's current g_root.children slice still points at.
    // Queue the bytes and drain in appTick before rebuildTree.
    const owned = g_alloc.dupe(u8, slice) catch return QJS_UNDEFINED;
    g_pending_flush.append(g_alloc, owned) catch {
        g_alloc.free(owned);
    };
    g_dirty = true;
    const preview_len: usize = @min(slice.len, 80);
    std.debug.print("[host_flush] queued {d} bytes: {s}{s}\n", .{ slice.len, slice[0..preview_len], if (slice.len > 80) "..." else "" });
    return QJS_UNDEFINED;
}

fn drainPendingFlushes() void {
    if (g_pending_flush.items.len == 0) return;
    const count = g_pending_flush.items.len;
    // Snapshot the pending list — applyCommandBatch can't re-enter host_flush
    // from Zig, but defensive copy keeps the loop safe anyway.
    const batches = g_pending_flush.toOwnedSlice(g_alloc) catch return;
    defer {
        for (batches) |bytes| g_alloc.free(bytes);
        g_alloc.free(batches);
    }
    for (batches) |bytes| applyCommandBatch(bytes);
    std.debug.print("[drain] applied {d} batches\n", .{count});
}

export fn host_get_input_text_for_node(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) qjs.JSValue {
    if (ctx == null or argc < 1) return qjs.JS_NewString(ctx, "");
    var node_id: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &node_id, argv[0]);
    if (node_id <= 0) return qjs.JS_NewString(ctx, "");
    const slot = g_input_slot_by_node_id.get(@intCast(node_id)) orelse return qjs.JS_NewString(ctx, "");
    const text = input.getText(slot);
    if (text.len == 0) return qjs.JS_NewString(ctx, "");
    return qjs.JS_NewStringLen(ctx, text.ptr, @intCast(text.len));
}

// Read `path` into a Zig-owned buffer, store under a fresh u32 handle, and
// return that handle to JS. Returns 0 on failure (empty path, missing file,
// read error). 64MB cap matches __fs_readfile's sanity limit.
export fn host_load_file_to_buffer(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) qjs.JSValue {
    if (ctx == null or argc < 1) return qjs.JS_NewInt32(ctx, 0);
    const c_str = qjs.JS_ToCString(ctx, argv[0]);
    if (c_str == null) return qjs.JS_NewInt32(ctx, 0);
    defer qjs.JS_FreeCString(ctx, c_str);
    const path = std.mem.span(c_str);
    if (path.len == 0) return qjs.JS_NewInt32(ctx, 0);

    const data = std.fs.cwd().readFileAlloc(g_alloc, path, 64 * 1024 * 1024) catch |e| {
        std.log.warn("[content-store] read failed path={s}: {}", .{ path, e });
        return qjs.JS_NewInt32(ctx, 0);
    };

    const id = g_content_store_next_id;
    g_content_store_next_id += 1;
    g_content_store.put(id, data) catch {
        g_alloc.free(data);
        return qjs.JS_NewInt32(ctx, 0);
    };
    return qjs.JS_NewInt32(ctx, @intCast(id));
}

// Release a buffer by handle. Safe to call with 0 or an unknown id.
export fn host_release_file_buffer(ctx: ?*qjs.JSContext, _: qjs.JSValue, argc: c_int, argv: [*c]qjs.JSValue) qjs.JSValue {
    if (ctx == null or argc < 1) return QJS_UNDEFINED;
    var id_i32: i32 = 0;
    _ = qjs.JS_ToInt32(ctx, &id_i32, argv[0]);
    if (id_i32 <= 0) return QJS_UNDEFINED;
    if (g_content_store.fetchRemove(@intCast(id_i32))) |entry| {
        g_alloc.free(entry.value);
    }
    return QJS_UNDEFINED;
}

fn contentStoreGet(id: u32) ?[]const u8 {
    return g_content_store.get(id);
}

// ── Tree materialization ────────────────────────────────────────

fn materializeChildren(arena: std.mem.Allocator, parent_id: u32) []Node {
    const ids = g_children_ids.get(parent_id) orelse return &.{};
    if (ids.items.len == 0) return &.{};
    const out = arena.alloc(Node, ids.items.len) catch return &.{};
    for (ids.items, 0..) |cid, i| {
        const src = g_node_by_id.get(cid) orelse {
            out[i] = .{};
            continue;
        };
        out[i] = src.*;
        out[i].children = materializeChildren(arena, cid);
    }
    return out;
}

fn syncRenderedNodeState(node: *const Node) void {
    if (node.scroll_persist_slot != 0) {
        if (g_node_by_id.get(node.scroll_persist_slot)) |stable| {
            stable.scroll_x = node.scroll_x;
            stable.scroll_y = node.scroll_y;
        }
    }
    for (node.children) |*child| syncRenderedNodeState(child);
}

fn markReachable(reachable: *std.AutoHashMap(u32, void), id: u32) void {
    if (reachable.contains(id)) return;
    reachable.put(id, {}) catch return;
    if (g_children_ids.get(id)) |children| {
        for (children.items) |child_id| {
            markReachable(reachable, child_id);
        }
    }
}

fn destroyDetachedNode(id: u32) void {
    releaseInputSlot(id);
    if (g_children_ids.getPtr(id)) |children| {
        children.deinit(g_alloc);
    }
    _ = g_children_ids.remove(id);
    if (g_node_by_id.get(id)) |node| {
        g_alloc.destroy(node);
    }
    _ = g_node_by_id.remove(id);
}

fn cleanupDetachedNodes() void {
    var reachable = std.AutoHashMap(u32, void).init(g_alloc);
    defer reachable.deinit();
    for (g_root_child_ids.items) |child_id| {
        markReachable(&reachable, child_id);
    }

    var stale: std.ArrayList(u32) = .{};
    defer stale.deinit(g_alloc);

    var it = g_node_by_id.iterator();
    while (it.next()) |entry| {
        const id = entry.key_ptr.*;
        if (!reachable.contains(id)) {
            stale.append(g_alloc, id) catch return;
        }
    }

    for (stale.items) |id| {
        destroyDetachedNode(id);
    }
}

fn snapshotRuntimeState() void {
    for (g_root.children) |*child| syncRenderedNodeState(child);
}

/// Build the dev-mode tab strip as a row of arena-allocated Nodes. Returns
/// a single Node (the row container) whose children are the individual tab
/// buttons. Callers prepend this to g_root.children in rebuildTree.
fn onWinMinimize() void {
    engine.windowMinimize();
}
fn onWinMaximize() void {
    engine.windowMaximize();
}
fn onWinClose() void {
    engine.windowClose();
}

fn buildChromeNode(arena: std.mem.Allocator) ?Node {
    // Filter out the "main" bootstrap tab (a duplicate of whatever was first pushed)
    var visible: std.ArrayList(usize) = .{};
    defer visible.deinit(arena);
    for (g_tabs.items, 0..) |t, i| {
        if (std.mem.eql(u8, t.name, "main")) continue;
        visible.append(arena, i) catch return null;
    }

    // Chrome layout: [tab1, tab2, ..., spacer(flex), min, max, close]
    // Even with zero visible tabs we still show the window controls so the
    // borderless window is always closable.
    const tab_count = visible.items.len;
    const control_count: usize = 3;
    const child_count = tab_count + 1 + control_count; // +1 = spacer
    const children = arena.alloc(Node, child_count) catch return null;

    for (visible.items, 0..) |tab_idx, i| {
        children[i] = .{};
        const name = arena.dupe(u8, g_tabs.items[tab_idx].name) catch g_tabs.items[tab_idx].name;
        children[i].text = name;
        children[i].font_size = 13;
        children[i].text_color = layout.Color.rgb(230, 232, 237);
        children[i].style.padding_left = TAB_PAD_H;
        children[i].style.padding_right = TAB_PAD_H;
        children[i].style.padding_top = TAB_PAD_V;
        children[i].style.padding_bottom = TAB_PAD_V;
        children[i].style.border_top_left_radius = 6;
        children[i].style.border_top_right_radius = 6;
        children[i].style.background_color = if (tab_idx == g_active_tab)
            layout.Color.rgb(30, 40, 56)
        else
            layout.Color.rgb(17, 22, 30);
        children[i].hoverable = true;
        if (tab_idx < MAX_TABS) {
            children[i].handlers.on_press = g_tab_click_callbacks[tab_idx];
        }
    }

    // Spacer — flex-grows to push window controls to the right edge.
    children[tab_count] = .{};
    children[tab_count].style.flex_grow = 1;

    // Window controls. Using unicode dashes/squares/X so we don't need icons.
    const ctrl_labels = [_][]const u8{ "\u{2013}", "\u{25A1}", "\u{00D7}" };
    const ctrl_handlers = [_]*const fn () void{ onWinMinimize, onWinMaximize, onWinClose };
    const ctrl_hover_bg = [_]layout.Color{
        layout.Color.rgb(40, 46, 56),
        layout.Color.rgb(40, 46, 56),
        layout.Color.rgb(200, 40, 40),
    };
    _ = ctrl_hover_bg; // future use — framework doesn't expose hover background yet
    for (0..control_count) |k| {
        const idx = tab_count + 1 + k;
        children[idx] = .{};
        children[idx].text = ctrl_labels[k];
        children[idx].font_size = 16;
        children[idx].text_color = layout.Color.rgb(200, 204, 212);
        children[idx].style.width = 36;
        children[idx].style.height = 26;
        children[idx].style.padding_top = 2;
        children[idx].style.align_items = .center;
        children[idx].style.justify_content = .center;
        children[idx].style.text_align = .center;
        children[idx].style.border_top_left_radius = 4;
        children[idx].style.border_top_right_radius = 4;
        children[idx].hoverable = true;
        children[idx].handlers.on_press = ctrl_handlers[k];
    }

    var chrome: Node = .{};
    chrome.style.height = CHROME_HEIGHT;
    chrome.style.flex_direction = .row;
    chrome.style.align_items = .end;
    chrome.style.gap = 3;
    chrome.style.padding_left = CHROME_PAD;
    chrome.style.padding_right = CHROME_PAD;
    chrome.style.background_color = layout.Color.rgb(8, 11, 15);
    // Empty chrome space drags the (borderless) window. Tab + control buttons
    // have on_press which overrides drag in framework/engine.zig's hitTestChrome.
    chrome.window_drag = true;
    chrome.children = children;
    return chrome;
}

/// Build four invisible absolute-positioned edge nodes with window_resize=true
/// so the (borderless) window can still be resized by dragging its edges.
/// Corners are auto-detected in chromeResizeEdge (framework/engine.zig) from
/// cursor position within a 20px threshold of the window corners.
fn buildResizeEdges(arena: std.mem.Allocator) ?[]Node {
    const edges = arena.alloc(Node, 4) catch return null;

    // Top — thin (3px) so it barely overlaps the chrome's click area.
    edges[0] = .{};
    edges[0].style.position = .absolute;
    edges[0].style.top = 0;
    edges[0].style.left = 0;
    edges[0].style.right = 0;
    edges[0].style.height = 3;
    edges[0].window_resize = true;

    // Bottom
    edges[1] = .{};
    edges[1].style.position = .absolute;
    edges[1].style.bottom = 0;
    edges[1].style.left = 0;
    edges[1].style.right = 0;
    edges[1].style.height = 6;
    edges[1].window_resize = true;

    // Left
    edges[2] = .{};
    edges[2].style.position = .absolute;
    edges[2].style.top = 0;
    edges[2].style.bottom = 0;
    edges[2].style.left = 0;
    edges[2].style.width = 6;
    edges[2].window_resize = true;

    // Right
    edges[3] = .{};
    edges[3].style.position = .absolute;
    edges[3].style.top = 0;
    edges[3].style.bottom = 0;
    edges[3].style.right = 0;
    edges[3].style.width = 6;
    edges[3].window_resize = true;

    return edges;
}

fn rebuildTree() void {
    _ = g_arena.reset(.retain_capacity);
    const arena = g_arena.allocator();

    const chrome_opt = if (DEV_MODE) buildChromeNode(arena) else null;
    const resize_edges = if (BORDERLESS_MODE) buildResizeEdges(arena) else null;
    const cart_child_count = g_root_child_ids.items.len;
    const chrome_count: usize = if (chrome_opt != null) 1 else 0;
    const edge_count: usize = if (resize_edges) |e| e.len else 0;

    if (cart_child_count == 0 and chrome_count == 0 and edge_count == 0) {
        g_root.children = &.{};
        return;
    }

    g_root.style.flex_direction = .column;

    // When the chrome exists, wrap the cart's top-level children in a
    // flex-grow container so the cart's `height: '100%'` is relative to the
    // remaining space (window - chrome), not the full window. Without this
    // wrapper, chrome (32px) + cart (100% of full window) overflows and the
    // cart's bottom toolbar disappears below the visible area.
    const use_wrapper = chrome_count > 0 and cart_child_count > 0;
    const wrapper_count: usize = if (use_wrapper) 1 else 0;
    const flat_cart_count: usize = if (use_wrapper) 0 else cart_child_count;

    const total = chrome_count + wrapper_count + flat_cart_count + edge_count;
    const out = arena.alloc(Node, total) catch return;

    if (chrome_opt) |c| out[0] = c;

    if (use_wrapper) {
        // Materialize the cart's children into the wrapper's children array.
        const cart_nodes = arena.alloc(Node, cart_child_count) catch return;
        for (g_root_child_ids.items, 0..) |cid, i| {
            const src = g_node_by_id.get(cid) orelse {
                cart_nodes[i] = .{};
                continue;
            };
            cart_nodes[i] = src.*;
            cart_nodes[i].children = materializeChildren(arena, cid);
        }
        var wrapper: Node = .{};
        wrapper.style.flex_grow = 1;
        wrapper.style.flex_direction = .column;
        wrapper.style.overflow = .hidden;
        wrapper.style.width = null;
        wrapper.children = cart_nodes;
        out[chrome_count] = wrapper;
    } else {
        // No chrome — keep the original flat layout used by non-dev builds.
        for (g_root_child_ids.items, 0..) |cid, i| {
            const dst_idx = chrome_count + i;
            const src = g_node_by_id.get(cid) orelse {
                out[dst_idx] = .{};
                continue;
            };
            out[dst_idx] = src.*;
            out[dst_idx].children = materializeChildren(arena, cid);
        }
    }

    // Resize edges go LAST so hitTestChrome (which walks children in reverse)
    // checks them first. A cursor near a window edge gets a resize cursor
    // before the chrome's drag region takes over.
    if (resize_edges) |edges| {
        const base = chrome_count + wrapper_count + flat_cart_count;
        for (edges, 0..) |edge, i| out[base + i] = edge;
    }
    g_root.children = out;
    g_root.style.width = null;
    g_root.style.height = null;
}

// ── Dev reload helpers ──────────────────────────────────────────

fn readBundleFromDisk() ![]u8 {
    const file = try std.fs.cwd().openFile(DEV_BUNDLE_PATH, .{});
    defer file.close();
    const stat = try file.stat();
    const buf = try g_alloc.alloc(u8, stat.size);
    errdefer g_alloc.free(buf);
    const n = try file.readAll(buf);
    return buf[0..n];
}

fn bundleMtimeOrZero() i128 {
    const s = std.fs.cwd().statFile(DEV_BUNDLE_PATH) catch return 0;
    return s.mtime;
}

fn maybeScheduleReload() void {
    if (!DEV_MODE) return;
    g_mtime_poll_counter +%= 1;
    // Poll every 16 ticks (~250ms at 60fps) — cheap, responsive enough.
    if (g_mtime_poll_counter & 0xF != 0) return;
    const mt = bundleMtimeOrZero();
    if (mt != 0 and mt != g_last_bundle_mtime) {
        g_last_bundle_mtime = mt;
        g_reload_pending = true;
    }
}

fn clearTreeStateForReload() void {
    // Drop the engine's reference to the current node tree BEFORE freeing any
    // memory it points into. The engine paints from g_root.children each
    // frame — leave it pointing at stale memory and we SIGSEGV on paint.
    g_root.children = &.{};

    for (g_press_expr_pool.items) |s| g_alloc.free(s);
    g_press_expr_pool.clearRetainingCapacity();

    for (g_pending_flush.items) |batch| g_alloc.free(batch);
    g_pending_flush.clearRetainingCapacity();

    // Unregister every live input slot so framework/input.zig doesn't keep
    // dispatching callbacks that read into the freed Node pool.
    var slot_it = g_input_slot_by_node_id.valueIterator();
    while (slot_it.next()) |slot| input.unregister(slot.*);
    g_input_slot_by_node_id.clearRetainingCapacity();
    for (&g_node_id_by_input_slot) |*v| v.* = 0;

    // Destroy every Node struct. node.text ownership is mixed (some g_alloc
    // dupes, some slices into framework/input.zig's buffers) so we leak the
    // text for dev-mode safety — kilobytes per reload, acceptable.
    var node_it = g_node_by_id.valueIterator();
    while (node_it.next()) |n_ptr| g_alloc.destroy(n_ptr.*);
    g_node_by_id.clearRetainingCapacity();

    var cid_it = g_children_ids.valueIterator();
    while (cid_it.next()) |list| list.deinit(g_alloc);
    g_children_ids.clearRetainingCapacity();

    // The root-child list is populated by APPEND_ROOT; clear so new React
    // mounts don't see stale IDs mixed with fresh ones.
    g_root_child_ids.clearRetainingCapacity();

    // Arena holds only materializeChildren output (rebuilt every frame from
    // g_children_ids + g_node_by_id). Safe to reset now that g_root.children
    // no longer references it.
    _ = g_arena.reset(.retain_capacity);

    g_dirty = true;
}

fn performReload() void {
    // Re-read the active tab's source file. Only the first tab ("main") has a
    // disk-backed source; others come from IPC pushes and have no disk file.
    if (g_active_tab != 0) return;
    const new_bundle = readBundleFromDisk() catch |e| {
        std.log.warn("[dev] bundle read failed: {}, skipping reload", .{e});
        return;
    };
    replaceActiveTabBundle(new_bundle);
    evalActiveTab();
    std.log.info("[dev] reloaded '{s}' ({d} bytes)", .{ tabName(g_active_tab), new_bundle.len });
}

/// Swap the active tab's stored bundle bytes for `new_bundle`. Frees the old
/// storage. Takes ownership of `new_bundle`.
fn replaceActiveTabBundle(new_bundle: []u8) void {
    g_alloc.free(g_tabs.items[g_active_tab].bundle);
    g_tabs.items[g_active_tab].bundle = new_bundle;
    if (g_active_tab == 0) {
        // Keep the legacy fields in sync for the disk-backed "main" tab.
        g_dev_bundle_buf = new_bundle;
    }
}

/// Tear down the JS world and re-eval the currently-active tab's bundle.
fn evalActiveTab() void {
    std.log.info("[dev] evalActiveTab: clearing tree", .{});
    clearTreeStateForReload();
    std.log.info("[dev] evalActiveTab: tearing down VM", .{});
    qjs_runtime.teardownVM();
    std.log.info("[dev] evalActiveTab: initVM", .{});
    qjs_runtime.initVM();
    std.log.info("[dev] evalActiveTab: appInit", .{});
    appInit();
    std.log.info("[dev] evalActiveTab: evalScript ({d} bytes)", .{g_tabs.items[g_active_tab].bundle.len});
    qjs_runtime.evalScript(g_tabs.items[g_active_tab].bundle);
    std.log.info("[dev] evalActiveTab: done", .{});
}

fn tabName(idx: usize) []const u8 {
    return g_tabs.items[idx].name;
}

/// Find a tab by name. Returns its index or null.
fn findTab(name: []const u8) ?usize {
    for (g_tabs.items, 0..) |t, i| {
        if (std.mem.eql(u8, t.name, name)) return i;
    }
    return null;
}

/// Install a tab. If one with `name` already exists, replaces its bundle.
/// Otherwise appends a new tab. Takes ownership of both slices.
fn upsertTab(name: []u8, bundle: []u8) !usize {
    if (findTab(name)) |idx| {
        g_alloc.free(name); // duplicate — free the new name
        g_alloc.free(g_tabs.items[idx].bundle);
        g_tabs.items[idx].bundle = bundle;
        return idx;
    }
    try g_tabs.append(g_alloc, .{ .name = name, .bundle = bundle });
    return g_tabs.items.len - 1;
}

fn switchToTab(idx: usize) void {
    if (idx >= g_tabs.items.len) return;
    g_active_tab = idx;
    evalActiveTab();
    std.log.info("[dev] active tab: '{s}'", .{tabName(idx)});
}

/// Pull any pending IPC push messages and act on them. Called each tick.
fn processIncomingPushes() void {
    while (dev_ipc.takeNext()) |msg| {
        const idx = upsertTab(msg.name, msg.bundle) catch |e| {
            std.log.warn("[dev] upsertTab failed: {}", .{e});
            continue;
        };
        switchToTab(idx);
    }
}

// ── init / tick ─────────────────────────────────────────────────

fn appInit() void {
    // QJS VM is already initialized by engine before this is called (engine calls
    // qjs_runtime.initVM() then evalScript(js_logic)). But we need __hostFlush
    // registered BEFORE evalScript runs. Engine order matters — see below.
    //
    // We piggyback on engine's eval: we pass the bundle via AppConfig.js_logic,
    // engine evals it, hostConfig's transportFlush tries to call globalThis.__hostFlush.
    // We must register __hostFlush BEFORE the bundle evals. Since appInit runs BEFORE
    // evalScript in engine.run order (tsz convention: init → evalScript), register here.
    qjs_runtime.registerHostFn("__hostFlush", @ptrCast(&host_flush), 1);
    qjs_runtime.registerHostFn("__getInputTextForNode", @ptrCast(&host_get_input_text_for_node), 1);
    qjs_runtime.registerHostFn("__hostLoadFileToBuffer", @ptrCast(&host_load_file_to_buffer), 1);
    qjs_runtime.registerHostFn("__hostReleaseFileBuffer", @ptrCast(&host_release_file_buffer), 1);

    // Persistent-store substrate for runtime/hooks/localstore. Best-effort —
    // if init fails the hooks gracefully no-op (see qjs_bindings.storeGet etc.).
    fs_mod.init("reactjit") catch |e| std.log.warn("fs init failed: {}", .{e});
    localstore.init() catch |e| std.log.warn("localstore init failed: {}", .{e});
}

fn appTick(now: u32) void {
    // Dev-mode: accept incoming IPC pushes (may switch the active tab) and
    // check the active tab's disk source for mtime-triggered reloads. Either
    // path tears down the JS world and re-evals before the rest of the frame.
    if (DEV_MODE) {
        dev_ipc.pollOnce();
        processIncomingPushes();
    }
    maybeScheduleReload();
    if (g_reload_pending) {
        g_reload_pending = false;
        performReload();
        return;
    }

    // Flush async hook events (http, future: process, ws). Fires __ffiEmit for
    // any responses the background workers completed since the last tick.
    qjs_bindings.tickDrain();

    // Fire any JS timers whose due-time has arrived. setTimeout/setInterval
    // in the bundle are implemented against this — see runtime/index.tsx.
    // This may append new batches to g_pending_flush via React commits triggered
    // from handlers that ran inside timers. Drain after.
    qjs_runtime.callGlobalInt("__jsTick", @intCast(now));

    // Apply any CMD batches that accumulated during press events since last tick.
    // Must happen BEFORE rebuildTree so the tree reflects the new g_node_by_id.
    drainPendingFlushes();

    if (g_dirty) {
        snapshotRuntimeState();
        rebuildTree();
        layout.markLayoutDirty();
        g_dirty = false;
    }
}

// ── main ────────────────────────────────────────────────────────

pub fn main() !void {
    if (IS_LIB) return;

    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    g_alloc = gpa.allocator();
    g_arena = std.heap.ArenaAllocator.init(g_alloc);
    g_node_by_id = std.AutoHashMap(u32, *Node).init(g_alloc);
    g_children_ids = std.AutoHashMap(u32, std.ArrayList(u32)).init(g_alloc);
    g_input_slot_by_node_id = std.AutoHashMap(u32, u8).init(g_alloc);
    g_content_store = std.AutoHashMap(u32, []u8).init(g_alloc);

    g_root = .{};

    const initial_bundle: []const u8 = if (DEV_MODE) blk: {
        g_dev_bundle_buf = readBundleFromDisk() catch |e| {
            std.log.err("[dev] initial bundle.js read failed: {}", .{e});
            return e;
        };
        g_last_bundle_mtime = bundleMtimeOrZero();

        // Seed the tab registry with the disk-backed "main" tab.
        const name_copy = try g_alloc.dupe(u8, "main");
        try g_tabs.append(g_alloc, .{ .name = name_copy, .bundle = g_dev_bundle_buf });
        g_active_tab = 0;

        // dev_ipc must allocate push buffers with the SAME allocator qjs_app
        // uses when it later frees them via upsertTab. Cross-allocator free is
        // UB — this caller caused the SIGSEGV on re-push (2026-04-19 fix).
        dev_ipc.setAllocator(g_alloc);
        dev_ipc.start();

        std.log.info("[dev] dev mode — watching bundle.js ({d} bytes), IPC @ {s}", .{ g_dev_bundle_buf.len, dev_ipc.SOCKET_PATH });
        break :blk g_dev_bundle_buf;
    } else BUNDLE_BYTES;

    try engine.run(.{
        .title = WINDOW_TITLE,
        .root = &g_root,
        .js_logic = initial_bundle,
        .lua_logic = "",
        .init = appInit,
        .tick = appTick,
        // In dev mode, strip the OS titlebar so our tab chrome sits in the
        // titlebar position. Empty chrome area gets window_drag; tab buttons
        // with on_press override drag so clicks still switch tabs.
        .borderless = BORDERLESS_MODE,
        .set_canvas_node_position = setCanvasNodePosition,
    });
}
