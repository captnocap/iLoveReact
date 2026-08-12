//! v8_app.zig — the GPU shell. React (via react-reconciler + the love2d-shaped
//! hostConfig) runs inside V8, emitting CREATE/APPEND/UPDATE/REMOVE mutations
//! that __hostFlush queues; the engine drains the queue at the start of each
//! paint frame and host_tree.applyCommandBatch lands the mutations on the
//! shared Node pool with v8_app's hooks doing GPU-specific concerns (CSS-shape
//! prop parsing, handler-flag registration, host-window opens, .independent
//! child-window intercept). Event press → engine's js_on_press evals
//! `__dispatchEvent(id,'onClick')` → React handler runs → next commit flows
//! through the same path. The TUI shell (v8_tui_app.zig) shares the binding
//! and tree-state modules; the only difference is rasterization (SDL3
//! window vs cell grid).
//!
//! Build:
//!   zig build app -Dapp-name=<cart> -Dapp-source=v8_app.zig -Doptimize=ReleaseFast

const std = @import("std");
const build_options = @import("build_options");
const IS_LIB = if (@hasDecl(build_options, "is_lib")) build_options.is_lib else false;
// HAS_GPU drives the GPU/headless split inside v8_app. true (default):
// the SDL3/wgpu/freetype substrate is linked + every framework/gpu/* and
// framework/primitive/{windows,context_menu,input} import resolves to
// the real file. false: those imports collapse to no-op stubs so the
// headless binary compiles without the SDL include path, and main()
// branches into the TUI eval body (mirroring v8_tui_app.zig) instead
// of engine.run. C3 deletes v8_tui_app once this branch is proven.
const HAS_GPU = if (@hasDecl(build_options, "has_gpu")) build_options.has_gpu else true;
const HEADLESS = IS_LIB or !HAS_GPU;

const layout = @import("layout.zig");
const HostContext = @import("host_context.zig");
const Node = layout.Node;
const Style = layout.Style;
const Color = layout.Color;
// Tree state lives in framework/host_tree.zig — single owner across
// both shells. v8_app installs hooks (apply_props, apply_handler_flags,
// open_host_window, etc.) and consumes the tree via host_tree's
// accessors. Phase 3 of the host_tree.zig migration plan: complete.
const transition_mod = if (HEADLESS) struct {
    pub const TransitionConfig = struct { duration_ms: u32 = 0 };
    pub fn set(_: anytype, _: anytype, _: anytype, _: anytype) void {}
} else @import("gpu/transition.zig");
const easing_mod = @import("math/easing.zig");
const effect_ctx = if (HEADLESS) struct {
    pub const EffectContext = opaque {};
} else @import("gpu/effects_ctx.zig");
const input = if (HEADLESS) struct {
    pub const MAX_INPUTS: usize = 256;
    pub fn register(_: anytype) void {}
    pub fn registerMultiline(_: anytype) void {}
    pub fn unregister(_: anytype) void {}
    pub fn syncValue(_: anytype, _: anytype) void {}
    pub fn setSubmitOnEnter(_: anytype, _: anytype) void {}
    pub fn setOnChange(_: anytype, _: anytype) void {}
    pub fn setOnSubmit(_: anytype, _: anytype) void {}
    pub fn setOnFocus(_: anytype, _: anytype) void {}
    pub fn setOnBlur(_: anytype, _: anytype) void {}
    pub fn setOnKey(_: anytype, _: anytype) void {}
    pub fn setCallbackContext(_: anytype, _: anytype) void {}
} else @import("primitive/input.zig");
const state = @import("state/dirty.zig");
const events = @import("events.zig");
const context_menu = if (HEADLESS) struct {
    pub const MenuItem = struct {
        label: []const u8 = "",
        handler: *const fn (?*anyopaque) void,
    };
    pub fn activeNodeId() u32 {
        return 0;
    }
} else @import("primitive/context_menu.zig");
const engine = if (HEADLESS) struct {
    pub fn run(_: anytype) !void {
        unreachable;
    }
    pub fn windowMinimize() void {}
    pub fn windowMaximize() void {}
    pub fn windowClose() void {}
    pub fn dispatchScrollChanged(_: anytype, _: anytype) void {}
    pub fn setPanelRootProvider(_: anytype) void {}
} else @import("engine.zig");
const gpu = if (HEADLESS) struct {
    pub fn frameCounter() u64 {
        return 0;
    }
    pub fn scene3dResetForReload() void {}
} else @import("gpu/gpu.zig");
// PANELWIN-0628: the editor-panel pop-out (2D React subtree → 2nd OS window).
const panel_window = if (HEADLESS) struct {
    pub fn open(_: u32, _: u32) !void {}
    pub fn close() void {}
    pub fn isOpen() bool {
        return false;
    }
} else @import("gpu/panel_window.zig");
const game_camera = if (@hasDecl(build_options, "has_game_camera") and build_options.has_game_camera) @import("game/camera.zig") else struct {
    pub const Solved = struct {};
    pub fn activeNodeId() u32 {
        return 0;
    }
    pub fn bindNode(_: u32) void {}
    pub fn unbindNode(_: u32) void {}
    pub fn stepActive(_: u32) ?Solved {
        return null;
    }
    pub fn stepNode(_: u32, _: u32) ?Solved {
        return null;
    }
    pub fn writeNode(_: anytype, _: Solved) void {
        return;
    }
};
const world_loader = if (!HEADLESS and @hasDecl(build_options, "has_compiled_world") and build_options.has_compiled_world) @import("world_loader.zig") else struct {
    pub fn unmount(_: std.Io, _: u32) void {}
};
const latches = @import("state/latches.zig");
// Pure string assembly (no GPU deps) — the ONE Effect shader assembler, shared
// with the no-V8 material path (framework/gpu/effects.renderShaderToTexture).
const effect_assemble = @import("gpu/effect_assemble.zig");
const animations = if (HEADLESS) struct {
    pub fn clearAll() void {}
    pub fn tickAll(_: anytype) void {}
} else @import("gpu/animations.zig");
const paintable = if (HEADLESS) struct {
    pub fn destroy(_: anytype) void {}
    pub fn ensure(_: anytype, _: anytype, _: anytype, _: anytype) bool {
        return false;
    }
} else @import("gpu/paintable.zig");
const windows = if (HEADLESS) struct {
    pub const WindowKind = enum { window, notification };
    const Slot = opaque {};
    pub fn open(_: anytype, _: anytype, _: anytype) !usize {
        return 0;
    }
    pub fn close(_: anytype, _: anytype) void {}
    pub fn getSlot(_: anytype) ?*Slot {
        return null;
    }
    pub fn sendLineToChild(_: anytype, _: anytype, _: anytype) void {}
    pub fn setJsDispatchFn(_: anytype, _: anytype) void {}
    pub fn setRoot(_: anytype) void {}
    pub fn tickIndependent() void {}
} else @import("primitive/windows.zig");
const ipc = @import("net/ipc.zig");
const prepared_input = @import("state/prepared_input.zig");
const v8_runtime = @import("v8_runtime.zig");
const v8_bindings_core = if (HEADLESS) struct {
    pub fn contentStoreGet(_: anytype) ?[]const u8 {
        return null;
    }
    pub fn contentStoreTake(_: anytype) ?[]u8 {
        return null;
    }
} else @import("v8_bindings_core.zig");
const v8_bindings_reconciler = @import("v8_bindings_reconciler.zig");
const host_tree = @import("host_tree.zig");
// All V8 host-fn binding registration goes through this catalog. v8_app
// (GPU shell) and v8_tui_app (TUI shell) consume the same INGREDIENTS
// table — register/tickDrain is the same loop on both substrates. See
// framework/v8_ingredients.zig for the contract (one row + one build
// option + one scripts/ship grep). v8_bindings_core and
// v8_bindings_reconciler are imported above for direct calls
// (contentStoreGet, drainPending, etc.) that don't go through the
// catalog; everything else lives behind `ingredients`.
const ingredients = @import("v8_ingredients.zig");
const event_bus = @import("diag/event_bus.zig");
const diag_log = @import("diag/log.zig");

// ── Headless shell imports ──────────────────────────────────────────
// Used only by runHeadless() when HEADLESS=true (mirrors v8_tui_app's
// body). cli_bindings + worker_bindings are pure-Zig and don't pull
// SDL, so they import unconditionally. host_window does pull SDL via
// primitive/windows.zig; gate it on has_window the same way the
// catalog gates `core` + `window` on has_gpu.
const v8 = @import("v8");
const cli_bindings = @import("v8_bindings_cli.zig");
const proc_lifetime = @import("proc_lifetime.zig");
const worker_bindings = @import("assistant/worker_bindings.zig");
const host_window = if (@hasDecl(build_options, "has_window") and build_options.has_window)
    @import("v8_bindings_host_window.zig")
else
    struct {
        pub fn register() void {}
        pub fn init(_: *HostContext, _: std.mem.Allocator) !void {}
        pub fn tickDrain(_: *HostContext) void {}
        pub fn deinit(_: std.Io) void {}
    };

// Override std.log so every framework `std.log.info/warn/err` call routes
// through the bus. Single chokepoint; no call-site rewrites needed. Errors
// and warns ALSO go to stderr (preserved fallthrough); info/debug land on
// the bus only. The terminal becomes quiet for normal operation.
pub const std_options: std.Options = .{
    .logFn = event_bus.fromStdLog,
};

const fs_mod = @import("fs/fs.zig");
const localstore = @import("storage/localstore.zig");

// Per-cart bundle, embedded via the "cart_bundle" module build.zig maps to
// -Dbundle-path (default: bundle-<app-name>.js at the repo root, so two
// parallel ships don't race on a shared bundle.js; rjit-driven builds map
// CART_ROOT's own path). A module name is the only @embedFile form that can
// reach the bundle from here — v8_app.zig lives in framework/, and path
// embeds (absolute included) can't leave the module root.
const BUNDLE_BYTES = @embedFile("cart_bundle");

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
// Tree-state moved to framework/host_tree.zig. These four pointers are
// installed in main() (g_node_by_id = host_tree.nodesPtr(), …) so every
// `g_node_by_id.get(id)` / `g_children_ids.get(pid).items` / etc. that
// existed before the migration keeps working without rewriting every
// call site — they just dereference into host_tree's owned maps.
var g_node_by_id: *std.AutoHashMap(u32, *Node) = undefined;
var g_children_ids: *std.AutoHashMap(u32, std.ArrayList(u32)) = undefined;
var g_parent_id: *std.AutoHashMap(u32, u32) = undefined;
var g_root_child_ids: *std.ArrayList(u32) = undefined;

/// Sets of nodes with `latch_*_key` style bindings, one per supported
/// style field. The pre-frame `syncLatchesToNodes` pass iterates each
/// set when `latches.isDirty()` and writes the current latch value into
/// the corresponding `node.style.*` field. Adding to a set: applyStyle
/// sees `"latch:KEY"` for that field. Removing: currently never
/// (subtree teardown is OK to leave stale entries; the node lookup will
/// fail and the entry effectively becomes a no-op).
var g_latch_height_nodes: std.AutoHashMap(u32, void) = undefined;
var g_latch_width_nodes: std.AutoHashMap(u32, void) = undefined;
var g_latch_left_nodes: std.AutoHashMap(u32, void) = undefined;
var g_latch_top_nodes: std.AutoHashMap(u32, void) = undefined;
var g_latch_right_nodes: std.AutoHashMap(u32, void) = undefined;
var g_latch_bottom_nodes: std.AutoHashMap(u32, void) = undefined;
var g_window_owner_by_node_id: std.AutoHashMap(u32, u32) = undefined;
const WindowBinding = struct {
    slot: usize,
    kind: windows.WindowKind,
    title: ?[:0]u8 = null,
    // PANELWIN-0628: a <Window kind="popout"> renders into the wgpu pop-out
    // (framework/gpu/panel_window.zig), NOT a windows.zig SDL3 slot. We still
    // register it here so the main paint excludes its subtree (the existing
    // g_window_by_node_id.contains gate), but skip every windows.* call.
    is_popout: bool = false,
};
var g_window_by_node_id: std.AutoHashMap(u32, WindowBinding) = undefined;
// The single popped-out window's node id (0 = none). The panel root provider
// re-materializes this subtree each frame for the engine to render + hit-test.
var g_popout_node_id: u32 = 0;
var g_panel_arena: std.heap.ArenaAllocator = undefined;
var g_is_window_child: bool = false;
var g_child_window_id: u32 = 0;
var g_child_client: ?ipc.Client = null;
var g_child_auto_dismiss_ms: u32 = 0;
var g_child_started_ms: i64 = 0;
var g_root: Node = .{};
// host_tree owns the dirty flag. Local pointer installed in main(),
// dereferenced at every read/write site (`g_dirty.*`). See the
// pointer-aliasing rationale on g_node_by_id above.
var g_dirty: *bool = undefined;
var g_scroll_prop_slots: std.AutoHashMap(u32, void) = undefined;
var g_press_expr_pool: std.ArrayList([:0]u8) = .empty;
var g_input_slot_by_node_id: std.AutoHashMap(u32, u8) = undefined;
var g_node_id_by_input_slot: [input.MAX_INPUTS]u32 = [_]u32{0} ** input.MAX_INPUTS;

// Content store + pending-flush queue live in v8_bindings_core. Exposed via
// contentStoreGet/drainPendingFlushes accessors above.

// ── Dev mode — hot reload of the JS bundle ──────────────────────────
// When DEV_MODE is enabled (via -Ddev-mode=true), the binary reads bundle.js
// from disk on startup and polls its mtime each tick. When the file changes
// (esbuild watch mode rebundles it), we tear down the tree + the QuickJS
// context, reinit, and re-eval the new bundle. React state resets on reload
// in phase 1; phase 2 will use LuaJIT hotstate atoms to preserve it.
const DEV_MODE = if (@hasDecl(build_options, "dev_mode")) build_options.dev_mode else false;
const DEV_BUILD_ID = if (@hasDecl(build_options, "dev_build_id")) build_options.dev_build_id else "unknown";
const CUSTOM_CHROME_MODE = if (@hasDecl(build_options, "custom_chrome")) build_options.custom_chrome else false;
const BORDERLESS_MODE = DEV_MODE or CUSTOM_CHROME_MODE;
const DEV_BUNDLE_PATH = if (@hasDecl(build_options, "dev_bundle_path")) build_options.dev_bundle_path else "bundle.js";

var g_dev_bundle_buf: []u8 = &.{};
var g_last_bundle_mtime: i128 = 0;
var g_mtime_poll_counter: u32 = 0;
const dev_reload_policy = @import("dev_reload_policy.zig");
var g_dev_reload = dev_reload_policy.Controller{};
var g_pending_push_tab: ?usize = null;
var g_dev_reload_revision: u64 = 0;

pub fn devReloadSetPolicy(raw: u8) bool {
    if (!DEV_MODE) return false;
    return g_dev_reload.setPolicy(raw);
}

pub fn devReloadWaiting() bool {
    return DEV_MODE and g_dev_reload.waitingForApproval();
}

pub fn devReloadApply() bool {
    return DEV_MODE and g_dev_reload.applyHeld();
}

pub fn devReloadRevision() u64 {
    return if (DEV_MODE) g_dev_reload_revision else 0;
}

const dev_ipc = @import("diag/dev_ipc.zig");
var g_dev_ipc = dev_ipc.Server.init(std.heap.page_allocator, DEV_BUILD_ID);

/// A dev-mode tab. Each tab has a human-readable name (cart name) and a
/// heap-owned bundle. The active tab is the one currently evaluated in QJS;
/// others sit dormant until re-activated via IPC push or (future) chrome click.
const Tab = struct {
    name: []u8, // owned
    bundle: []u8, // owned — the bundle we will evaluate next
    // Last bundle that evaluated without throwing. When a hot-reload (edit +
    // rebundle + push) throws during eval — a runtime error in top-level or
    // initial render — we restore this instead of leaving the UI wiped.
    // Owned. null until the first successful eval on this tab.
    last_good: ?[]u8 = null,
};

var g_tabs: std.ArrayList(Tab) = .empty;
var g_active_tab: usize = 0;

const MAX_TABS = 16;

fn hostFromCallbackContext(context: ?*anyopaque) ?*HostContext {
    return @ptrCast(@alignCast(context orelse return null));
}

/// Comptime-generated per-tab click handler. We can't close over an index at
/// runtime in Zig, so we specialize one callback per slot ahead of time.
fn makeTabClickCallback(comptime idx: usize) *const fn (?*anyopaque) void {
    return struct {
        fn callback(context: ?*anyopaque) void {
            const host = hostFromCallbackContext(context) orelse return;
            if (idx < g_tabs.items.len and idx != g_active_tab) switchToTab(host, idx);
        }
    }.callback;
}

const g_tab_click_callbacks = blk: {
    var arr: [MAX_TABS]*const fn (?*anyopaque) void = undefined;
    for (0..MAX_TABS) |i| arr[i] = makeTabClickCallback(i);
    break :blk arr;
};

// V8 right-click dispatcher. The engine calls this with the click coords;
// it pulls the prepared node id (set by qjs_runtime.prepareNodeEvent in the
// engine) and dispatches __dispatchRightClick(id) into V8. The runtime-side
// __getPreparedRightClick host fn (registered in v8_bindings_core.zig:876)
// reads the coords back into the JS payload. qjs_runtime's own dispatcher
// uses callGlobal which is comptime-no-op when QuickJS isn't compiled in,
// so under V8-only builds we need this parallel path.
fn dispatchV8RightClick(context: ?*anyopaque, x: f32, y: f32) void {
    const host = hostFromCallbackContext(context) orelse return;
    const id = prepared_input.g_prepared_node_event_id;
    if (id == 0) return;
    prepared_input.g_prepared_node_event_id = 0;
    prepared_input.g_prepared_mouse_x = x;
    prepared_input.g_prepared_mouse_y = y;
    var buf: [128]u8 = undefined;
    const expr = std.fmt.bufPrintZ(&buf, "__dispatchRightClick({d})", .{id}) catch return;
    v8_runtime.evalScript(host, expr);
    state.markDirty();
}

// Same shape as dispatchV8RightClick — engine.dispatchScrollChanged calls
// prepareScrollEvent() to stash node id + scroll deltas in qjs_runtime
// globals, then invokes our handler. Under V8 we can't go through the
// QJS-only callGlobalInt; instead eval __dispatchScroll(id) and let the
// JS shim pull the coords back via __getPreparedScroll (registered in
// v8_bindings_core.zig:1200). Without this, onScroll handlers attached
// to a ScrollView never fire under V8 — content scrolls visually but
// no JS event is delivered.
fn dispatchV8Scroll(context: ?*anyopaque) void {
    const host = hostFromCallbackContext(context) orelse return;
    const id = prepared_input.g_prepared_node_event_id;
    if (id == 0) return;
    prepared_input.g_prepared_node_event_id = 0;
    var buf: [128]u8 = undefined;
    const expr = std.fmt.bufPrintZ(&buf, "__dispatchScroll({d})", .{id}) catch return;
    v8_runtime.evalScript(host, expr);
}

// ── Context menu item trampolines ────────────────────────
// MenuItem.handler is `*const fn () void` with no args, so a single
// dispatcher can't recover which item was clicked. We comptime-generate
// MAX_MENU_ITEMS trampolines, each closed over its own index. They look
// up the active node id from context_menu and dispatch back to React.
const MAX_MENU_ITEMS = 16;

fn dispatchContextMenuClick(context: ?*anyopaque, item_idx: usize) void {
    const host = hostFromCallbackContext(context) orelse return;
    const node_id = context_menu.activeNodeId();
    if (node_id == 0) return;
    var buf: [128]u8 = undefined;
    const expr = std.fmt.bufPrintZ(&buf, "__dispatchEvent({d},'onContextMenu',{d})\x00", .{ node_id, item_idx }) catch return;
    v8_runtime.evalScript(host, expr);
}

fn makeMenuItemHandler(comptime idx: usize) *const fn (?*anyopaque) void {
    return struct {
        fn callback(context: ?*anyopaque) void {
            dispatchContextMenuClick(context, idx);
        }
    }.callback;
}

const g_menu_item_handlers = blk: {
    var arr: [MAX_MENU_ITEMS]*const fn (?*anyopaque) void = undefined;
    for (0..MAX_MENU_ITEMS) |i| arr[i] = makeMenuItemHandler(i);
    break :blk arr;
};

// Per-node menu storage. Keyed by React id (scroll_persist_slot).
// Items slice points into the same alloc as labels — both freed together
// on next decode for that node, or on node removal.
var g_menu_items_by_node: std.AutoHashMap(u32, []context_menu.MenuItem) = undefined;
var g_menu_labels_by_node: std.AutoHashMap(u32, [][]u8) = undefined;

fn clearContextMenu(node_id: u32) void {
    if (g_menu_labels_by_node.fetchRemove(node_id)) |entry| {
        for (entry.value) |label| g_alloc.free(label);
        g_alloc.free(entry.value);
    }
    if (g_menu_items_by_node.fetchRemove(node_id)) |entry| {
        g_alloc.free(entry.value);
    }
}

fn applyContextMenuItems(node: *Node, val: std.json.Value) void {
    const node_id = node.scroll_persist_slot;
    clearContextMenu(node_id);
    if (val != .array) {
        node.context_menu_items = null;
        return;
    }
    const src = val.array.items;
    const n = @min(src.len, MAX_MENU_ITEMS);
    if (n == 0) {
        node.context_menu_items = null;
        return;
    }
    const labels = g_alloc.alloc([]u8, n) catch return;
    const items = g_alloc.alloc(context_menu.MenuItem, n) catch {
        g_alloc.free(labels);
        return;
    };
    for (0..n) |i| {
        var label_text: []const u8 = "";
        if (src[i] == .object) {
            if (src[i].object.get("label")) |lv| {
                if (lv == .string) label_text = lv.string;
            }
        }
        const owned = g_alloc.dupe(u8, label_text) catch "";
        labels[i] = @constCast(owned);
        items[i] = .{ .label = owned, .handler = g_menu_item_handlers[i] };
    }
    g_menu_labels_by_node.put(node_id, labels) catch {};
    g_menu_items_by_node.put(node_id, items) catch {};
    node.context_menu_items = items;
}

// ── Inline glyph storage ─────────────────────────────────
// Each glyph carries an alloc'd `d` (svg path) and optional fill_effect
// string. We hold both the slice and the strings so we can free everything
// in one pass when the prop changes or the node is destroyed.
const InlineGlyphAlloc = struct {
    glyphs: []layout.InlineGlyph,
    d_strings: [][]u8,
    effect_strings: [][]u8,
};

var g_inline_glyphs_by_node: std.AutoHashMap(u32, InlineGlyphAlloc) = undefined;

fn clearInlineGlyphs(node_id: u32) void {
    if (g_inline_glyphs_by_node.fetchRemove(node_id)) |entry| {
        const a = entry.value;
        for (a.d_strings) |s| g_alloc.free(s);
        for (a.effect_strings) |s| g_alloc.free(s);
        g_alloc.free(a.d_strings);
        g_alloc.free(a.effect_strings);
        g_alloc.free(a.glyphs);
    }
}

fn applyInlineGlyphs(node: *Node, val: std.json.Value) void {
    const node_id = node.scroll_persist_slot;
    clearInlineGlyphs(node_id);
    if (val != .array or val.array.items.len == 0) {
        node.inline_glyphs = null;
        return;
    }
    const src = val.array.items;
    const n = src.len;
    const glyphs = g_alloc.alloc(layout.InlineGlyph, n) catch return;
    const d_strs = g_alloc.alloc([]u8, n) catch {
        g_alloc.free(glyphs);
        return;
    };
    const e_strs = g_alloc.alloc([]u8, n) catch {
        g_alloc.free(glyphs);
        g_alloc.free(d_strs);
        return;
    };
    for (0..n) |i| {
        var g = layout.InlineGlyph{ .d = "" };
        d_strs[i] = &.{};
        e_strs[i] = &.{};
        if (src[i] == .object) {
            const obj = src[i].object;
            if (obj.get("d")) |dv| if (dv == .string) {
                d_strs[i] = @constCast(g_alloc.dupe(u8, dv.string) catch "");
                g.d = d_strs[i];
            };
            if (obj.get("fill")) |fv| if (fv == .string) {
                if (parseColor(fv.string)) |c| g.fill = c;
            };
            if (obj.get("fillEffect")) |ev| if (ev == .string) {
                e_strs[i] = @constCast(g_alloc.dupe(u8, ev.string) catch "");
                g.fill_effect = e_strs[i];
            };
            if (obj.get("stroke")) |sv| if (sv == .string) {
                if (parseColor(sv.string)) |c| g.stroke = c;
            };
            if (obj.get("strokeWidth")) |swv| if (jsonFloat(swv)) |f| {
                g.stroke_width = f;
            };
            if (obj.get("scale")) |scv| if (jsonFloat(scv)) |f| {
                g.scale = f;
            };
        }
        glyphs[i] = g;
    }
    g_inline_glyphs_by_node.put(node_id, .{
        .glyphs = glyphs,
        .d_strings = d_strs,
        .effect_strings = e_strs,
    }) catch {};
    node.inline_glyphs = glyphs;
}

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

fn fontFamilyIdFor(raw: []const u8) u8 {
    var first = raw;
    if (std.mem.indexOfScalar(u8, raw, ',')) |comma| first = raw[0..comma];
    first = std.mem.trim(u8, first, " \t\r\n\"'");
    if (first.len == 0) return 0;

    var buf: [96]u8 = undefined;
    const n = @min(first.len, buf.len);
    for (first[0..n], 0..) |ch, i| buf[i] = std.ascii.toLower(ch);
    const s = buf[0..n];

    if (std.mem.eql(u8, s, "serif") or std.mem.indexOf(u8, s, "times") != null or std.mem.indexOf(u8, s, "roman") != null) return 2;
    if (std.mem.eql(u8, s, "monospace") or std.mem.indexOf(u8, s, "mono") != null or std.mem.indexOf(u8, s, "courier") != null) return 3;
    if (std.mem.indexOf(u8, s, "noto") != null) return 4;
    if (std.mem.indexOf(u8, s, "arial") != null or std.mem.indexOf(u8, s, "helvetica") != null or std.mem.indexOf(u8, s, "liberation sans") != null) return 5;
    if (std.mem.indexOf(u8, s, "segoe") != null or std.mem.indexOf(u8, s, "ubuntu") != null or std.mem.indexOf(u8, s, "sf pro") != null or std.mem.indexOf(u8, s, "inter") != null) return 6;
    if (std.mem.indexOf(u8, s, "roboto") != null or std.mem.indexOf(u8, s, "quicksand") != null) return 7;
    if (std.mem.eql(u8, s, "sans-serif") or std.mem.indexOf(u8, s, "dejavu sans") != null) return 1;
    return 0;
}

fn dispatchInputEvent(context: ?*anyopaque, slot: u8, global_name: [*:0]const u8) void {
    const host = hostFromCallbackContext(context) orelse return;
    const node_id = g_node_id_by_input_slot[slot];
    if (node_id == 0) return;
    v8_runtime.callGlobal(host, "__beginJsEvent");
    v8_runtime.callGlobal2Int(host, global_name, @intCast(node_id), @intCast(slot));
    v8_runtime.callGlobal(host, "__endJsEvent");
}

fn makeInputChangeCallback(comptime slot: u8) *const fn (?*anyopaque) void {
    return struct {
        fn callback(context: ?*anyopaque) void {
            dispatchInputEvent(context, slot, "__dispatchInputChange");
        }
    }.callback;
}

fn makeInputSubmitCallback(comptime slot: u8) *const fn (?*anyopaque) void {
    return struct {
        fn callback(context: ?*anyopaque) void {
            dispatchInputEvent(context, slot, "__dispatchInputSubmit");
        }
    }.callback;
}

fn makeInputFocusCallback(comptime slot: u8) *const fn (?*anyopaque) void {
    return struct {
        fn callback(context: ?*anyopaque) void {
            dispatchInputEvent(context, slot, "__dispatchInputFocus");
        }
    }.callback;
}

fn makeInputBlurCallback(comptime slot: u8) *const fn (?*anyopaque) void {
    return struct {
        fn callback(context: ?*anyopaque) void {
            dispatchInputEvent(context, slot, "__dispatchInputBlur");
        }
    }.callback;
}

fn dispatchInputKeyEvent(context: ?*anyopaque, slot: u8, key: c_int, mods: u16) void {
    const host = hostFromCallbackContext(context) orelse return;
    const node_id = g_node_id_by_input_slot[slot];
    if (node_id == 0) return;
    v8_runtime.callGlobal(host, "__beginJsEvent");
    v8_runtime.callGlobal3Int(host, "__dispatchInputKey", @intCast(node_id), key, mods);
    v8_runtime.callGlobal(host, "__endJsEvent");
}

fn makeInputKeyCallback(comptime slot: u8) *const fn (?*anyopaque, key: c_int, mods: u16) void {
    return struct {
        fn callback(context: ?*anyopaque, key: c_int, mods: u16) void {
            dispatchInputKeyEvent(context, slot, key, mods);
        }
    }.callback;
}

const g_input_change_callbacks = blk: {
    var arr: [input.MAX_INPUTS]*const fn (?*anyopaque) void = undefined;
    for (0..input.MAX_INPUTS) |i| arr[i] = makeInputChangeCallback(@intCast(i));
    break :blk arr;
};

const g_input_submit_callbacks = blk: {
    var arr: [input.MAX_INPUTS]*const fn (?*anyopaque) void = undefined;
    for (0..input.MAX_INPUTS) |i| arr[i] = makeInputSubmitCallback(@intCast(i));
    break :blk arr;
};

const g_input_focus_callbacks = blk: {
    var arr: [input.MAX_INPUTS]*const fn (?*anyopaque) void = undefined;
    for (0..input.MAX_INPUTS) |i| arr[i] = makeInputFocusCallback(@intCast(i));
    break :blk arr;
};

const g_input_blur_callbacks = blk: {
    var arr: [input.MAX_INPUTS]*const fn (?*anyopaque) void = undefined;
    for (0..input.MAX_INPUTS) |i| arr[i] = makeInputBlurCallback(@intCast(i));
    break :blk arr;
};

const g_input_key_callbacks = blk: {
    var arr: [input.MAX_INPUTS]*const fn (?*anyopaque, key: c_int, mods: u16) void = undefined;
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
    // TextEditor is a code editor — Enter must insert a newline, not submit.
    // TextArea keeps the chat-composer default (Enter submits, Shift+Enter
    // newlines). Carts that want the opposite for either type can flip the
    // bit via setSubmitOnEnter at the host_fn layer in the future.
    if (std.mem.eql(u8, type_name, "TextEditor")) input.setSubmitOnEnter(sid, false);
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
        .float => |f| @trunc(f),
        else => null,
    };
}

// A [r, g, b] (or [x, y, z]) JSON array → [3]f32. Used by the skybox props,
// which receive colors already resolved to 0..1 floats on the JS side.
fn jsonVec3(v: std.json.Value) ?[3]f32 {
    if (v != .array or v.array.items.len < 3) return null;
    return .{
        jsonFloat(v.array.items[0]) orelse return null,
        jsonFloat(v.array.items[1]) orelse return null,
        jsonFloat(v.array.items[2]) orelse return null,
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

fn objectField(obj: std.json.Value, key: []const u8) ?std.json.Value {
    if (obj != .object) return null;
    return obj.object.get(key);
}

fn propString(props: std.json.Value, key: []const u8) ?[]const u8 {
    const v = objectField(props, key) orelse return null;
    return if (v == .string) v.string else null;
}

fn propInt(props: std.json.Value, key: []const u8) ?i32 {
    const v = objectField(props, key) orelse return null;
    const i = jsonInt(v) orelse return null;
    return @intCast(@max(std.math.minInt(i32), @min(std.math.maxInt(i32), i)));
}

fn propFloat(props: std.json.Value, key: []const u8) ?f32 {
    const v = objectField(props, key) orelse return null;
    return jsonFloat(v);
}

fn propBool(props: std.json.Value, key: []const u8) ?bool {
    const v = objectField(props, key) orelse return null;
    return jsonBool(v);
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
        // CSS alpha is 0..1; rgb channels are 0..255.
        const scaled = if (idx == 3) v * 255.0 else v;
        const clamped = @max(@min(scaled, 255.0), 0.0);
        parts[idx] = @trunc(clamped);
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

fn markScrollPropSlot(node: *Node) void {
    if (node.scroll_persist_slot != 0) {
        g_scroll_prop_slots.put(node.scroll_persist_slot, {}) catch {};
    }
}

/// Parse a linear-gradient prop from JSON:
///   { x1, y1, x2, y2, stops: [{ offset, color, opacity? }] }
/// Coordinates default to (0,0)→(24,24) — the SVG viewBox icons are authored in.
/// Stops are allocated in g_alloc; lifetime matches the node (leaked on replace,
/// same pattern as canvas_path_d). Returns null on malformed input so the
/// dispatcher can fall through to canvas_fill_color.
fn parseLinearGradient(v: std.json.Value) ?layout.LinearGradient {
    if (v != .object) return null;
    var grad: layout.LinearGradient = .{ .x2 = 24, .y2 = 24 };
    if (v.object.get("x1")) |x1v| if (jsonFloat(x1v)) |f| {
        grad.x1 = f;
    };
    if (v.object.get("y1")) |y1v| if (jsonFloat(y1v)) |f| {
        grad.y1 = f;
    };
    if (v.object.get("x2")) |x2v| if (jsonFloat(x2v)) |f| {
        grad.x2 = f;
    };
    if (v.object.get("y2")) |y2v| if (jsonFloat(y2v)) |f| {
        grad.y2 = f;
    };

    const stops_v = v.object.get("stops") orelse return null;
    if (stops_v != .array) return null;
    if (stops_v.array.items.len == 0) return null;

    const buf = g_alloc.alloc(layout.GradientStop, stops_v.array.items.len) catch return null;
    var n: usize = 0;
    for (stops_v.array.items) |sv| {
        if (sv != .object) continue;
        const off_v = sv.object.get("offset") orelse continue;
        const col_v = sv.object.get("color") orelse continue;
        if (col_v != .string) continue;
        const offset = jsonFloat(off_v) orelse continue;
        var color = parseColor(col_v.string) orelse continue;
        if (sv.object.get("opacity")) |op_v| {
            if (jsonFloat(op_v)) |op| {
                const clamped: f32 = if (op < 0) 0 else if (op > 1) 1 else op;
                color.a = @trunc(@as(f32, color.a) * clamped);
            }
        }
        buf[n] = .{ .offset = offset, .color = color };
        n += 1;
    }
    if (n == 0) return null;
    grad.stops = buf[0..n];
    return grad;
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

fn parseScrollbarSide(s: []const u8) layout.ScrollbarSide {
    if (std.mem.eql(u8, s, "left") or std.mem.eql(u8, s, "start")) return .left;
    if (std.mem.eql(u8, s, "right") or std.mem.eql(u8, s, "end")) return .right;
    if (std.mem.eql(u8, s, "top")) return .top;
    if (std.mem.eql(u8, s, "bottom")) return .bottom;
    return .auto;
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

fn parseEasingName(s: []const u8) easing_mod.EasingType {
    const eq = std.mem.eql;
    if (eq(u8, s, "linear")) return .linear;
    if (eq(u8, s, "easeIn")) return .ease_in;
    if (eq(u8, s, "easeOut")) return .ease_out;
    if (eq(u8, s, "easeInOut")) return .ease_in_out;
    return .ease_in_out;
}

fn nodeTransitionConfig(node: *Node) transition_mod.TransitionConfig {
    return .{
        .duration_ms = node.transition_duration_ms,
        .delay_ms = node.transition_delay_ms,
        .easing = .{ .named = node.transition_easing },
    };
}

/// Generic latch-or-pct style applier. Handles `style.X = "latch:KEY"`
/// for any layout-affecting style field by registering the node in the
/// per-field registry and seeding the style with the current latch
/// value. Falls back to literal pct/number parsing if the value isn't
/// a latch token. Mirror of the original height-only path generalized
/// across width/left/top/right/bottom.
fn applyLatchOrPct(
    node: *Node,
    val: std.json.Value,
    latch_field: *?[]const u8,
    style_field: *?f32,
    nodes_set: *std.AutoHashMap(u32, void),
) void {
    if (val == .string and std.mem.startsWith(u8, val.string, "latch:")) {
        const suffix = val.string[6..];
        if (latch_field.*) |old| g_alloc.free(old);
        const owned = g_alloc.dupe(u8, suffix) catch null;
        latch_field.* = owned;
        // Seed with whatever the latch currently holds so first-frame
        // layout has a sensible value before any tick fires.
        style_field.* = latches.getF32(suffix);
        // Node.id is stamped by ensureNode — no map scan needed.
        if (node.id != 0) nodes_set.put(node.id, {}) catch {};
    } else if (jsonMaybePct(val)) |f| {
        style_field.* = f;
        // Clear any prior latch binding when the value becomes literal.
        if (latch_field.*) |old| {
            g_alloc.free(old);
            latch_field.* = null;
        }
    }
}

fn applyStyleEntry(node: *Node, key: []const u8, val: std.json.Value, is_update: bool) void {
    const eq = std.mem.eql;
    if (eq(u8, key, "width")) {
        applyLatchOrPct(node, val, &node.latch_width_key, &node.style.width, &g_latch_width_nodes);
    } else if (eq(u8, key, "height")) {
        applyLatchOrPct(node, val, &node.latch_height_key, &node.style.height, &g_latch_height_nodes);
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
        applyLatchOrPct(node, val, &node.latch_top_key, &node.style.top, &g_latch_top_nodes);
    } else if (eq(u8, key, "left")) {
        applyLatchOrPct(node, val, &node.latch_left_key, &node.style.left, &g_latch_left_nodes);
    } else if (eq(u8, key, "right")) {
        applyLatchOrPct(node, val, &node.latch_right_key, &node.style.right, &g_latch_right_nodes);
    } else if (eq(u8, key, "bottom")) {
        applyLatchOrPct(node, val, &node.latch_bottom_key, &node.style.bottom, &g_latch_bottom_nodes);
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
    } else if (eq(u8, key, "borderDash")) {
        // Accept [onPx, offPx] — both required, but only one needed to switch
        // the border paint path. Anything shorter/longer is ignored.
        if (val == .array and val.array.items.len >= 2) {
            if (jsonFloat(val.array.items[0])) |on| node.style.border_dash_on = on;
            if (jsonFloat(val.array.items[1])) |off| node.style.border_dash_off = off;
        }
    } else if (eq(u8, key, "borderDashOn")) {
        if (jsonFloat(val)) |f| node.style.border_dash_on = f;
    } else if (eq(u8, key, "borderDashOff")) {
        if (jsonFloat(val)) |f| node.style.border_dash_off = f;
    } else if (eq(u8, key, "borderFlowSpeed")) {
        // px/second, positive = clockwise march, negative = reverse.
        if (jsonFloat(val)) |f| node.style.border_flow_speed = f;
    } else if (eq(u8, key, "borderDashWidth")) {
        // Explicit stroke width for the animated dashed border, independent of
        // `borderWidth`. Use this when you want `borderWidth: 0` (no baked
        // outline) but still want thick animated dashes.
        if (jsonFloat(val)) |f| node.style.border_dash_width = f;
    } else if (eq(u8, key, "tweenTranslateXFrom")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_x_from = f;
    } else if (eq(u8, key, "tweenTranslateXTo")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_x_to = f;
    } else if (eq(u8, key, "tweenTranslateXDurMs")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_x_dur_ms = f;
    } else if (eq(u8, key, "tweenTranslateXCurve")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_x_curve = @trunc(@max(0, @min(255, f)));
    } else if (eq(u8, key, "tweenTranslateYFrom")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_from = f;
    } else if (eq(u8, key, "tweenTranslateYTo")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_to = f;
    } else if (eq(u8, key, "tweenTranslateYDurMs")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_dur_ms = f;
    } else if (eq(u8, key, "tweenTranslateYCurve")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_curve = @trunc(@max(0, @min(255, f)));
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
        if (val == .string) {
            const c = parseColor(val.string);
            if (is_update and node.transition_active and c != null) {
                transition_mod.set(node, .background_color, .{ .color = c.? }, nodeTransitionConfig(node));
            } else {
                node.style.background_color = c;
            }
        }
    } else if (eq(u8, key, "opacity")) {
        if (jsonFloat(val)) |f| {
            if (is_update and node.transition_active) {
                transition_mod.set(node, .opacity, .{ .float = f }, nodeTransitionConfig(node));
            } else {
                node.style.opacity = f;
            }
        }
    } else if (eq(u8, key, "rotation")) {
        if (jsonFloat(val)) |f| {
            if (is_update and node.transition_active) {
                transition_mod.set(node, .rotation, .{ .float = f }, nodeTransitionConfig(node));
            } else {
                node.style.rotation = f;
            }
        }
    } else if (eq(u8, key, "scaleX")) {
        if (jsonFloat(val)) |f| {
            if (is_update and node.transition_active) {
                transition_mod.set(node, .scale_x, .{ .float = f }, nodeTransitionConfig(node));
            } else {
                node.style.scale_x = f;
            }
        }
    } else if (eq(u8, key, "scaleY")) {
        if (jsonFloat(val)) |f| {
            if (is_update and node.transition_active) {
                transition_mod.set(node, .scale_y, .{ .float = f }, nodeTransitionConfig(node));
            } else {
                node.style.scale_y = f;
            }
        }
    } else if (eq(u8, key, "transform")) {
        // CSS-style transform: { rotate, scaleX, scaleY, translateX, translateY,
        // originX, originY }. Mirrors love2d's painter.lua applyTransform — visual
        // only, does not affect layout or hit-testing.
        if (val == .object) {
            if (val.object.get("rotate")) |v| {
                if (jsonFloat(v)) |f| {
                    if (is_update and node.transition_active) {
                        transition_mod.set(node, .rotation, .{ .float = f }, nodeTransitionConfig(node));
                    } else {
                        node.style.rotation = f;
                    }
                }
            }
            if (val.object.get("scaleX")) |v| {
                if (jsonFloat(v)) |f| node.style.scale_x = f;
            }
            if (val.object.get("scaleY")) |v| {
                if (jsonFloat(v)) |f| node.style.scale_y = f;
            }
            if (val.object.get("originX")) |v| {
                if (jsonFloat(v)) |f| node.style.origin_x = f;
            }
            if (val.object.get("originY")) |v| {
                if (jsonFloat(v)) |f| node.style.origin_y = f;
            }
            if (val.object.get("translateX")) |v| {
                if (jsonFloat(v)) |f| node.style.translate_x = f;
            }
            if (val.object.get("translateY")) |v| {
                if (jsonFloat(v)) |f| node.style.translate_y = f;
            }
        }
    } else if (eq(u8, key, "transition")) {
        // Renderer emits `transition: { all: { duration, easing, delay } }`
        // (see runtime/tw.ts emit). Only the `all` shape is supported today.
        if (val == .object) {
            if (val.object.get("all")) |all_v| {
                if (all_v == .object) {
                    node.transition_active = true;
                    if (all_v.object.get("duration")) |d| {
                        if (jsonInt(d)) |i| node.transition_duration_ms = @intCast(@max(0, i));
                    }
                    if (all_v.object.get("delay")) |d| {
                        if (jsonInt(d)) |i| node.transition_delay_ms = @intCast(@max(0, i));
                    }
                    if (all_v.object.get("easing")) |e| {
                        if (e == .string) node.transition_easing = parseEasingName(e.string);
                    }
                }
            }
        }
    } else if (eq(u8, key, "zIndex")) {
        if (jsonInt(val)) |i| node.style.z_index = @intCast(i);
    } else if (eq(u8, key, "shadowOffsetX")) {
        if (jsonFloat(val)) |f| node.style.shadow_offset_x = f;
    } else if (eq(u8, key, "shadowOffsetY")) {
        if (jsonFloat(val)) |f| node.style.shadow_offset_y = f;
    } else if (eq(u8, key, "shadowBlur")) {
        if (jsonFloat(val)) |f| node.style.shadow_blur = f;
    } else if (eq(u8, key, "shadowColor")) {
        if (val == .string) node.style.shadow_color = parseColor(val.string);
    } else if (eq(u8, key, "shadowMethod")) {
        // 'sdf' (default) = single rect with GPU SDF blur in the WGSL fragment
        // shader. 'rect' = multi-rect CPU fallback (N expanded rects with
        // fading alpha). Accept the integer too so transition.zig can target it.
        if (val == .string) {
            if (eq(u8, val.string, "rect")) node.style.shadow_method = 1 else node.style.shadow_method = 0;
        } else if (jsonInt(val)) |i| {
            node.style.shadow_method = if (i == 1) 1 else 0;
        }
    }
    // Text-typography keys: also valid inside `style`, since React code
    // (and hostConfig.ts's HTML heading defaults) routes them there. Without
    // this block, `<Text style={{ fontSize: 14 }}>` and `<h1>...</h1>` both
    // silently render at the default size.
    else if (eq(u8, key, "fontSize")) {
        if (jsonInt(val)) |i| node.font_size = @intCast(@max(i, 1));
    } else if (eq(u8, key, "fontFamily")) {
        if (val == .string) node.font_family_id = fontFamilyIdFor(val.string);
    } else if (eq(u8, key, "fontWeight")) {
        // Accept either a CSS keyword ('bold', 'normal') or a numeric weight
        // (100..900). Anything ≥600 maps to bold at paint time; everything
        // else is regular.
        if (val == .string) {
            const s = val.string;
            if (eq(u8, s, "bold") or eq(u8, s, "bolder")) {
                node.font_weight = 700;
            } else if (eq(u8, s, "normal") or eq(u8, s, "lighter")) {
                node.font_weight = 400;
            } else if (jsonInt(val)) |i| {
                node.font_weight = @intCast(@max(@min(i, 900), 1));
            }
        } else if (jsonInt(val)) |i| {
            node.font_weight = @intCast(@max(@min(i, 900), 1));
        }
    } else if (eq(u8, key, "color")) {
        if (val == .string) node.text_color = parseColor(val.string);
    } else if (eq(u8, key, "letterSpacing")) {
        if (jsonFloat(val)) |f| node.letter_spacing = f;
    } else if (eq(u8, key, "lineHeight")) {
        if (jsonFloat(val)) |f| node.line_height = f;
    }
}

fn applyStyle(node: *Node, style_v: std.json.Value, is_update: bool) void {
    if (style_v != .object) return;
    // Process the "transition" key first so animatable property writes in this
    // same batch see the latest config. Without ordering, a single CREATE/UPDATE
    // that includes both `transition: {...}` and `opacity: 1` could write opacity
    // before the transition config was visible on the node.
    if (style_v.object.get("transition")) |t| applyStyleEntry(node, "transition", t, is_update);
    var it = style_v.object.iterator();
    while (it.next()) |e| {
        const k = e.key_ptr.*;
        if (std.mem.eql(u8, k, "transition")) continue;
        applyStyleEntry(node, k, e.value_ptr.*, is_update);
    }
}

fn resetStyleEntry(node: *Node, key: []const u8) void {
    const d = Style{};
    const eq = std.mem.eql;
    if (eq(u8, key, "width")) node.style.width = d.width else if (eq(u8, key, "height")) node.style.height = d.height else if (eq(u8, key, "minWidth")) node.style.min_width = d.min_width else if (eq(u8, key, "maxWidth")) node.style.max_width = d.max_width else if (eq(u8, key, "minHeight")) node.style.min_height = d.min_height else if (eq(u8, key, "maxHeight")) node.style.max_height = d.max_height else if (eq(u8, key, "flexDirection")) node.style.flex_direction = d.flex_direction else if (eq(u8, key, "flexGrow")) node.style.flex_grow = d.flex_grow else if (eq(u8, key, "flexShrink")) node.style.flex_shrink = d.flex_shrink else if (eq(u8, key, "flexBasis")) node.style.flex_basis = d.flex_basis else if (eq(u8, key, "flexWrap")) node.style.flex_wrap = d.flex_wrap else if (eq(u8, key, "gap")) node.style.gap = d.gap else if (eq(u8, key, "rowGap")) node.style.row_gap = d.row_gap else if (eq(u8, key, "columnGap")) node.style.column_gap = d.column_gap else if (eq(u8, key, "justifyContent")) node.style.justify_content = d.justify_content else if (eq(u8, key, "alignItems")) node.style.align_items = d.align_items else if (eq(u8, key, "alignSelf")) node.style.align_self = d.align_self else if (eq(u8, key, "alignContent")) node.style.align_content = d.align_content else if (eq(u8, key, "padding")) node.style.padding = d.padding else if (eq(u8, key, "paddingLeft")) node.style.padding_left = d.padding_left else if (eq(u8, key, "paddingRight")) node.style.padding_right = d.padding_right else if (eq(u8, key, "paddingTop")) node.style.padding_top = d.padding_top else if (eq(u8, key, "paddingBottom")) node.style.padding_bottom = d.padding_bottom else if (eq(u8, key, "margin")) node.style.margin = d.margin else if (eq(u8, key, "marginLeft")) node.style.margin_left = d.margin_left else if (eq(u8, key, "marginRight")) node.style.margin_right = d.margin_right else if (eq(u8, key, "marginTop")) node.style.margin_top = d.margin_top else if (eq(u8, key, "marginBottom")) node.style.margin_bottom = d.margin_bottom else if (eq(u8, key, "display")) node.style.display = d.display else if (eq(u8, key, "overflow")) node.style.overflow = d.overflow else if (eq(u8, key, "textAlign")) node.style.text_align = d.text_align else if (eq(u8, key, "position")) node.style.position = d.position else if (eq(u8, key, "top")) node.style.top = d.top else if (eq(u8, key, "left")) node.style.left = d.left else if (eq(u8, key, "right")) node.style.right = d.right else if (eq(u8, key, "bottom")) node.style.bottom = d.bottom else if (eq(u8, key, "aspectRatio")) node.style.aspect_ratio = d.aspect_ratio else if (eq(u8, key, "borderWidth")) node.style.border_width = d.border_width else if (eq(u8, key, "borderTopWidth")) node.style.border_top_width = d.border_top_width else if (eq(u8, key, "borderRightWidth")) node.style.border_right_width = d.border_right_width else if (eq(u8, key, "borderBottomWidth")) node.style.border_bottom_width = d.border_bottom_width else if (eq(u8, key, "borderLeftWidth")) node.style.border_left_width = d.border_left_width else if (eq(u8, key, "borderColor")) node.style.border_color = d.border_color else if (eq(u8, key, "borderRadius")) node.style.border_radius = d.border_radius else if (eq(u8, key, "borderTopLeftRadius")) node.style.border_top_left_radius = d.border_top_left_radius else if (eq(u8, key, "borderTopRightRadius")) node.style.border_top_right_radius = d.border_top_right_radius else if (eq(u8, key, "borderBottomRightRadius")) node.style.border_bottom_right_radius = d.border_bottom_right_radius else if (eq(u8, key, "borderBottomLeftRadius")) node.style.border_bottom_left_radius = d.border_bottom_left_radius else if (eq(u8, key, "backgroundColor")) node.style.background_color = d.background_color else if (eq(u8, key, "opacity")) node.style.opacity = d.opacity else if (eq(u8, key, "rotation")) node.style.rotation = d.rotation else if (eq(u8, key, "scaleX")) node.style.scale_x = d.scale_x else if (eq(u8, key, "scaleY")) node.style.scale_y = d.scale_y else if (eq(u8, key, "zIndex")) node.style.z_index = d.z_index else if (eq(u8, key, "shadowOffsetX")) node.style.shadow_offset_x = d.shadow_offset_x else if (eq(u8, key, "shadowOffsetY")) node.style.shadow_offset_y = d.shadow_offset_y else if (eq(u8, key, "shadowBlur")) node.style.shadow_blur = d.shadow_blur else if (eq(u8, key, "shadowColor")) node.style.shadow_color = d.shadow_color else if (eq(u8, key, "shadowMethod")) node.style.shadow_method = d.shadow_method;
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
        if (std.mem.eql(u8, k, "scrollY")) {
            node.scroll_y = 0;
            markScrollPropSlot(node);
            continue;
        } else if (std.mem.eql(u8, k, "scrollX")) {
            node.scroll_x = 0;
            markScrollPropSlot(node);
            continue;
        } else if (std.mem.eql(u8, k, "showScrollbar")) {
            node.show_scrollbar = true;
            continue;
        } else if (std.mem.eql(u8, k, "scene3dCameraNative")) {
            game_camera.unbindNode(node.id);
            continue;
        } else if (std.mem.eql(u8, k, "scrollbarSide")) {
            node.scrollbar_side = .auto;
            continue;
        } else if (std.mem.eql(u8, k, "autoHide")) {
            node.scrollbar_auto_hide = true;
            continue;
        }
        if (std.mem.eql(u8, k, "fontSize")) {
            if (node.terminal) node.terminal_font_size = 13 else node.font_size = 16;
        } else if (std.mem.eql(u8, k, "fontWeight")) {
            node.font_weight = 400;
        } else if (std.mem.eql(u8, k, "color")) {
            node.text_color = null;
        } else if (std.mem.eql(u8, k, "letterSpacing")) {
            node.letter_spacing = 0;
        } else if (std.mem.eql(u8, k, "lineHeight")) {
            node.line_height = 0;
        } else if (std.mem.eql(u8, k, "numberOfLines")) {
            node.number_of_lines = 0;
        } else if (std.mem.eql(u8, k, "noWrap")) {
            node.no_wrap = false;
        } else if (std.mem.eql(u8, k, "paintText")) {
            node.input_paint_text = true;
        } else if (std.mem.eql(u8, k, "colorRows")) {
            node.input_color_rows = null;
        } else if (std.mem.eql(u8, k, "placeholder")) {
            node.placeholder = null;
        } else if (std.mem.eql(u8, k, "value")) {
            node.text = null;
        } else if (std.mem.eql(u8, k, "source")) {
            node.image_src = null;
        } else if (std.mem.eql(u8, k, "renderSrc")) {
            node.render_src = null;
        } else if (std.mem.eql(u8, k, "renderSuspended")) {
            node.render_suspended = false;
        } else if (std.mem.eql(u8, k, "staticSurface")) {
            node.static_surface = false;
        } else if (std.mem.eql(u8, k, "staticSurfaceKey")) {
            node.static_surface_key = null;
        } else if (std.mem.eql(u8, k, "staticSurfaceScale")) {
            node.static_surface_scale = 1;
        } else if (std.mem.eql(u8, k, "staticSurfaceWarmupFrames")) {
            node.static_surface_warmup_frames = 0;
        } else if (std.mem.eql(u8, k, "staticSurfaceIntroFrames")) {
            node.static_surface_intro_frames = 0;
        } else if (std.mem.eql(u8, k, "staticSurfaceOverlay")) {
            node.static_surface_overlay = false;
        } else if (std.mem.eql(u8, k, "filterName")) {
            node.filter_name = null;
        } else if (std.mem.eql(u8, k, "filterIntensity")) {
            node.filter_intensity = 1.0;
        } else if (std.mem.eql(u8, k, "d")) {
            node.canvas_path_d = null;
        } else if (std.mem.eql(u8, k, "stroke")) {
            node.text_color = null;
        } else if (std.mem.eql(u8, k, "strokeWidth")) {
            node.canvas_stroke_width = 2;
        } else if (std.mem.eql(u8, k, "strokeOpacity")) {
            node.canvas_stroke_opacity = 1;
        } else if (std.mem.eql(u8, k, "fill")) {
            node.canvas_fill_color = null;
        } else if (std.mem.eql(u8, k, "fillOpacity")) {
            node.canvas_fill_opacity = 1;
        } else if (std.mem.eql(u8, k, "gradient")) {
            node.canvas_fill_gradient = null;
        } else if (std.mem.eql(u8, k, "fillEffect")) {
            node.canvas_fill_effect = null;
        } else if (std.mem.eql(u8, k, "href")) {
            node.href = null;
        } else if (std.mem.eql(u8, k, "tooltip")) {
            node.tooltip = null;
        } else if (std.mem.eql(u8, k, "hoverable")) {
            node.hoverable = false;
        } else if (std.mem.eql(u8, k, "blocksPointerEvents")) {
            node.blocks_pointer_events = false;
        } else if (std.mem.eql(u8, k, "debugName")) {
            node.debug_name = null;
        } else if (std.mem.eql(u8, k, "testID")) {
            node.test_id = null;
        } else if (std.mem.eql(u8, k, "windowDrag")) {
            node.window_drag = false;
        } else if (std.mem.eql(u8, k, "windowResize")) {
            node.window_resize = false;
        }
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
    } else if (eq(u8, type_name, "RectBatch")) {
        // <Boxxx> — direct-to-instanced-rect batch. The box buffer arrives via
        // the effectData prop (→ node.effect_data); engine.paintRectBatch emits.
        node.rect_batch = true;
    } else if (eq(u8, type_name, "Paintable")) {
        // Persistent GPU mask texture, never painted visibly. The real
        // texture allocation happens in applyProps once paintableW/H and
        // paintableId are known. See framework/gpu/paintable.zig.
        node.is_paintable = true;
    } else if (eq(u8, type_name, "WorldLoader")) {
        node.world_loader = true;
    } else if (eq(u8, type_name, "Slider")) {
        // Host-driven slider (SLIDER-0611): engine owns the thumb while the
        // button is down; value streams via __dispatchSliderChange and settles
        // via __dispatchSliderCommit. See engine.zig slider drag + paintSlider.
        node.slider = true;
    } else if (isTerminalType(type_name)) {
        node.terminal = true;
    }
    ensureInputSlot(node, id, type_name);
}

fn openHostWindowForNode(io: std.Io, environ: *const std.process.Environ.Map, id: u32, type_name: []const u8, props: ?std.json.Value) void {
    if (g_window_by_node_id.contains(id)) return;
    if (!std.mem.eql(u8, type_name, "Window") and !std.mem.eql(u8, type_name, "Notification")) return;

    const p = props orelse .null;
    const is_notification = std.mem.eql(u8, type_name, "Notification");
    const title_src = propString(p, "title") orelse if (is_notification) "Notification" else "Window";
    const title = g_alloc.dupeZ(u8, title_src) catch return;

    const default_width: i32 = if (is_notification) 380 else 640;
    const default_height: i32 = if (is_notification) 100 else 480;
    const width = propInt(p, "width") orelse default_width;
    const height = propInt(p, "height") orelse default_height;

    // PANELWIN-0628: kind="popout" → the wgpu editor-panel window. Registered in
    // g_window_by_node_id (so the main paint excludes its subtree) but bound to
    // NO windows.zig slot — the engine renders + hit-tests it via the panel
    // root provider. Only one pop-out at a time; ignore extras.
    if (!is_notification) {
        if (propString(p, "kind")) |k| {
            if (std.mem.eql(u8, k, "popout")) {
                if (g_popout_node_id != 0) {
                    g_alloc.free(title);
                    return;
                }
                panel_window.open(@intCast(@max(1, width)), @intCast(@max(1, height))) catch {
                    std.debug.print("[panel-window/parent] open FAILED node={d}\n", .{id});
                    g_alloc.free(title);
                    return;
                };
                g_window_by_node_id.put(id, .{
                    .slot = 0,
                    .kind = .in_process, // unused; routeCommandToHostWindow ignores non-independent
                    .title = title,
                    .is_popout = true,
                }) catch {
                    panel_window.close();
                    g_alloc.free(title);
                    return;
                };
                g_popout_node_id = id;
                std.debug.print("[panel-window/parent] open node={d} size={d}x{d}\n", .{ id, width, height });
                return;
            }
        }
    }

    const duration_ms: u32 = if (propFloat(p, "duration")) |sec|
        @trunc(@max(0, sec) * 1000.0)
    else
        5000;

    // Read optional `kind` prop. Defaults preserved: notifications →
    // .notification, plain Windows → .independent. Carts that want the
    // Window to live in the same V8 isolate as the parent (so the
    // cart's bundle globals — __dispatchLayout, __dispatchEvent, etc.
    // — are available to nodes inside the Window) pass kind="in_process".
    const kind: windows.WindowKind = if (is_notification) .notification else blk: {
        if (propString(p, "kind")) |k| {
            if (std.mem.eql(u8, k, "in_process")) break :blk .in_process;
            if (std.mem.eql(u8, k, "notification")) break :blk .notification;
            if (std.mem.eql(u8, k, "independent")) break :blk .independent;
        }
        break :blk .independent;
    };
    const slot = windows.open(io, environ, .{
        .title = title.ptr,
        .width = @intCast(@max(1, width)),
        .height = @intCast(@max(1, height)),
        .kind = kind,
        .auto_dismiss_ms = duration_ms,
        .x = propInt(p, "x"),
        .y = propInt(p, "y"),
        .always_on_top = propBool(p, "alwaysOnTop") orelse is_notification,
        .borderless = propBool(p, "borderless") orelse is_notification,
        .window_id = id,
    }) orelse {
        std.debug.print("[window-open/parent] FAILED node={d} type={s} title={s}\n", .{ id, type_name, title_src });
        g_alloc.free(title);
        return;
    };
    std.debug.print("[window-open/parent] node={d} type={s} slot={d} title={s} size={d}x{d}\n", .{ id, type_name, slot, title_src, width, height });

    g_window_by_node_id.put(id, .{
        .slot = slot,
        .kind = kind,
        .title = title,
    }) catch {
        windows.close(io, slot);
        g_alloc.free(title);
        return;
    };
}

fn commandWindowId(cmd: std.json.Value) ?u32 {
    if (cmd != .object) return null;
    if (cmd.object.get("window_id")) |v| {
        if (jsonInt(v)) |i| if (i > 0) return @intCast(i);
    }
    if (cmd.object.get("windowId")) |v| {
        if (jsonInt(v)) |i| if (i > 0) return @intCast(i);
    }
    return null;
}

fn routeCommandToHostWindow(environ: *const std.process.Environ.Map, cmd: std.json.Value) void {
    const explicit_window_id = commandWindowId(cmd);
    const window_id = explicit_window_id orelse blk: {
        if (cmd != .object) return;
        if (cmd.object.get("id")) |v| {
            if (jsonInt(v)) |i| {
                if (i > 0) {
                    if (g_window_owner_by_node_id.get(@intCast(i))) |owner| break :blk owner;
                }
            }
        }
        if (cmd.object.get("childId")) |v| {
            if (jsonInt(v)) |i| {
                if (i > 0) {
                    if (g_window_owner_by_node_id.get(@intCast(i))) |owner| break :blk owner;
                }
            }
        }
        if (cmd.object.get("parentId")) |v| {
            if (jsonInt(v)) |i| {
                if (i > 0) {
                    const pid: u32 = @intCast(i);
                    if (g_window_by_node_id.contains(pid)) break :blk pid;
                    if (g_window_owner_by_node_id.get(pid)) |owner| break :blk owner;
                }
            }
        }
        return;
    };
    const binding = g_window_by_node_id.get(window_id) orelse return;
    if (binding.kind != .independent) return;
    if (cmd != .object) return;
    const op_v = cmd.object.get("op") orelse return;
    if (op_v != .string) return;
    if (std.mem.eql(u8, op_v.string, "CREATE")) {
        if (cmd.object.get("id")) |id_v| {
            if (jsonInt(id_v)) |id| if (id == window_id) return;
        }
    }

    // APPEND/INSERT_BEFORE/REMOVE with parentId == window_id can't replay
    // verbatim on the child — the Window node itself was never CREATE'd
    // there (we filter it above). Translate into the *_ROOT / *_FROM_ROOT
    // variants so the child anchors the subtree on its own root list.
    var line: std.ArrayList(u8) = .empty;
    defer line.deinit(g_alloc);
    line.appendSlice(g_alloc, "{\"type\":\"mutations\",\"commands\":[") catch return;

    var translated: ?[]const u8 = null;
    const op_str = op_v.string;
    if (std.mem.eql(u8, op_str, "APPEND") or std.mem.eql(u8, op_str, "INSERT_BEFORE") or std.mem.eql(u8, op_str, "REMOVE")) {
        if (cmd.object.get("parentId")) |pid_v| if (jsonInt(pid_v)) |pid| if (@as(u32, @intCast(pid)) == window_id) {
            const cid_v = cmd.object.get("childId") orelse return;
            const cid = jsonInt(cid_v) orelse return;
            if (std.mem.eql(u8, op_str, "APPEND")) {
                var print_buf: [96]u8 = undefined;
                const rendered = std.fmt.bufPrint(&print_buf, "{{\"op\":\"APPEND_TO_ROOT\",\"childId\":{d}}}", .{cid}) catch return;
                line.appendSlice(g_alloc, rendered) catch return;
                translated = "APPEND_TO_ROOT";
            } else if (std.mem.eql(u8, op_str, "INSERT_BEFORE")) {
                const bid_v = cmd.object.get("beforeId") orelse return;
                const bid = jsonInt(bid_v) orelse return;
                var print_buf: [128]u8 = undefined;
                const rendered = std.fmt.bufPrint(&print_buf, "{{\"op\":\"INSERT_BEFORE_ROOT\",\"childId\":{d},\"beforeId\":{d}}}", .{ cid, bid }) catch return;
                line.appendSlice(g_alloc, rendered) catch return;
                translated = "INSERT_BEFORE_ROOT";
            } else { // REMOVE
                var print_buf: [96]u8 = undefined;
                const rendered = std.fmt.bufPrint(&print_buf, "{{\"op\":\"REMOVE_FROM_ROOT\",\"childId\":{d}}}", .{cid}) catch return;
                line.appendSlice(g_alloc, rendered) catch return;
                translated = "REMOVE_FROM_ROOT";
            }
        };
    }
    if (translated == null) {
        const rendered = std.fmt.allocPrint(g_alloc, "{f}", .{std.json.fmt(cmd, .{})}) catch return;
        defer g_alloc.free(rendered);
        line.appendSlice(g_alloc, rendered) catch return;
    }
    line.appendSlice(g_alloc, "]}") catch return;
    // Per-mutation log — gated behind ZIGOS_TRACE_IPC=1 to avoid drowning
    // the rest of the host log on a fat initial cart paint.
    const trace_ipc = blk: {
        const env = environ.get("ZIGOS_TRACE_IPC") orelse break :blk false;
        break :blk env.len > 0 and env[0] != '0';
    };
    if (trace_ipc) {
        if (translated) |t| {
            std.debug.print("[window-route/parent] window={d} slot={d} op={s}→{s} bytes={d}\n", .{ window_id, binding.slot, op_str, t, line.items.len });
        } else {
            std.debug.print("[window-route/parent] window={d} slot={d} op={s} bytes={d}\n", .{ window_id, binding.slot, op_str, line.items.len });
        }
    }
    windows.sendLineToChild(environ, binding.slot, line.items);
}

fn noteCommandWindowOwner(cmd: std.json.Value) void {
    const window_id = commandWindowId(cmd) orelse return;
    if (cmd.object.get("id")) |v| {
        if (jsonInt(v)) |i| if (i > 0 and @as(u32, @intCast(i)) != window_id) {
            g_window_owner_by_node_id.put(@intCast(i), window_id) catch {};
        };
    }
    if (cmd.object.get("childId")) |v| {
        if (jsonInt(v)) |i| if (i > 0 and @as(u32, @intCast(i)) != window_id) {
            g_window_owner_by_node_id.put(@intCast(i), window_id) catch {};
        };
    }
}

fn applyProps(node: *Node, props: std.json.Value, type_name: ?[]const u8) void {
    if (props != .object) return;
    const is_input = node.input_id != null or (type_name != null and isInputType(type_name.?));
    const is_terminal = node.terminal or (type_name != null and isTerminalType(type_name.?));
    // Renderer convention: type_name is non-null on CREATE and null on UPDATE
    // (see applyCommand). UPDATE writes to animatable visual props go through
    // framework/transition.zig when node.transition_active is set.
    const is_update = type_name == null;
    var it = props.object.iterator();
    while (it.next()) |e| {
        const k = e.key_ptr.*;
        const v = e.value_ptr.*;
        if (std.mem.eql(u8, k, "style")) applyStyle(node, v, is_update) else if (std.mem.eql(u8, k, "fontSize")) {
            if (jsonInt(v)) |i| {
                const size: u16 = @intCast(@max(i, 1));
                if (is_terminal) node.terminal_font_size = size else node.font_size = size;
            }
        } else if (std.mem.eql(u8, k, "fontFamily")) {
            if (v == .string) node.font_family_id = fontFamilyIdFor(v.string);
        } else if (std.mem.eql(u8, k, "fontWeight")) {
            if (v == .string) {
                const s = v.string;
                if (std.mem.eql(u8, s, "bold") or std.mem.eql(u8, s, "bolder")) {
                    node.font_weight = 700;
                } else if (std.mem.eql(u8, s, "normal") or std.mem.eql(u8, s, "lighter")) {
                    node.font_weight = 400;
                } else if (jsonInt(v)) |i| {
                    node.font_weight = @intCast(@max(@min(i, 900), 1));
                }
            } else if (jsonInt(v)) |i| {
                node.font_weight = @intCast(@max(@min(i, 900), 1));
            }
        } else if (is_terminal and std.mem.eql(u8, k, "terminalFontSize")) {
            if (jsonInt(v)) |i| node.terminal_font_size = @intCast(@max(i, 1));
        } else if (is_terminal and std.mem.eql(u8, k, "shell")) {
            // Path to the binary the PTY should exec. Stored null-terminated
            // because spawnShellByName → execvp wants [*:0]const u8.
            if (v == .string) {
                if (g_alloc.dupeZ(u8, v.string)) |z| {
                    node.terminal_shell = z.ptr;
                } else |_| {}
            }
        } else if (is_terminal and std.mem.eql(u8, k, "session")) {
            // Named session for multi-Terminal carts. Each unique name maps
            // to its own Pipe (vterm + PTY + scrollback). Unset → engine
            // falls back to the implicit "default" session.
            if (v == .string and v.string.len > 0) {
                if (g_alloc.dupe(u8, v.string)) |s| {
                    node.terminal_session = s;
                } else |_| {}
            }
        } else if (is_terminal and std.mem.eql(u8, k, "dumb")) {
            // <Terminal dumb /> — pure cell-grid, no PTY. The tick skips
            // spawn/poll; the cart feeds bytes via __vterm_feed.
            node.terminal_dumb = jsonBool(v) orelse false;
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
                .float => @trunc(@max(0.0, v.float)),
                else => 0,
            };
            if (handle != 0) {
                if (contentStoreGet(handle)) |buf| syncInputValue(node, buf);
            }
        } else if (std.mem.eql(u8, k, "source")) {
            if (dupJsonText(v)) |s| node.image_src = s;
        } else if (std.mem.eql(u8, k, "renderSrc")) {
            if (dupJsonText(v)) |s| node.render_src = s;
        } else if (std.mem.eql(u8, k, "worldLoader")) {
            if (jsonBool(v)) |b| node.world_loader = b;
        } else if (std.mem.eql(u8, k, "gameFile")) {
            if (dupJsonText(v)) |s| node.world_loader_game_file = s;
        } else if (std.mem.eql(u8, k, "storeDir")) {
            if (dupJsonText(v)) |s| node.world_loader_store_dir = s;
        } else if (std.mem.eql(u8, k, "worldLoaderGameFile")) {
            if (dupJsonText(v)) |s| node.world_loader_game_file = s;
        } else if (std.mem.eql(u8, k, "worldLoaderStoreDir")) {
            if (dupJsonText(v)) |s| node.world_loader_store_dir = s;
        } else if (std.mem.eql(u8, k, "renderSuspended")) {
            if (jsonBool(v)) |b| node.render_suspended = b;
        } else if (std.mem.eql(u8, k, "staticSurface")) {
            if (jsonBool(v)) |b| node.static_surface = b;
        } else if (std.mem.eql(u8, k, "staticSurfaceKey")) {
            if (dupJsonText(v)) |s| node.static_surface_key = s;
        } else if (std.mem.eql(u8, k, "staticSurfaceScale")) {
            if (jsonFloat(v)) |f| node.static_surface_scale = @max(1.0, @min(f, 4.0));
        } else if (std.mem.eql(u8, k, "staticSurfaceWarmupFrames")) {
            if (jsonInt(v)) |i| node.static_surface_warmup_frames = @intCast(@max(0, @min(i, std.math.maxInt(u16))));
        } else if (std.mem.eql(u8, k, "staticSurfaceIntroFrames")) {
            if (jsonInt(v)) |i| node.static_surface_intro_frames = @intCast(@max(0, @min(i, std.math.maxInt(u16))));
        } else if (std.mem.eql(u8, k, "staticSurfaceOverlay")) {
            if (jsonBool(v)) |b| node.static_surface_overlay = b;
        } else if (std.mem.eql(u8, k, "filterName")) {
            if (dupJsonText(v)) |s| node.filter_name = s;
        } else if (std.mem.eql(u8, k, "filterIntensity")) {
            if (jsonFloat(v)) |f| node.filter_intensity = @max(0.0, @min(@as(f32, @floatCast(f)), 1.0));
        } else if (std.mem.eql(u8, k, "videoSrc")) {
            // Path or URL to a video. framework/videos.zig hooks the paint
            // pass and decodes lazily — no audio yet, just frames.
            if (dupJsonText(v)) |s| node.video_src = s;
        } else if (std.mem.eql(u8, k, "href")) {
            if (dupJsonText(v)) |s| node.href = s;
        } else if (std.mem.eql(u8, k, "tooltip")) {
            if (dupJsonText(v)) |s| node.tooltip = s;
        } else if (std.mem.eql(u8, k, "hoverable")) {
            if (jsonBool(v)) |b| node.hoverable = b;
        } else if (std.mem.eql(u8, k, "blocksPointerEvents")) {
            if (jsonBool(v)) |b| node.blocks_pointer_events = b;
        } else if (std.mem.eql(u8, k, "debugName")) {
            if (dupJsonText(v)) |s| node.debug_name = s;
        } else if (std.mem.eql(u8, k, "testID")) {
            if (dupJsonText(v)) |s| node.test_id = s;
        } else if (std.mem.eql(u8, k, "windowDrag")) {
            if (jsonBool(v)) |b| node.window_drag = b;
        } else if (std.mem.eql(u8, k, "windowResize")) {
            if (jsonBool(v)) |b| node.window_resize = b;
        } else if (std.mem.eql(u8, k, "physicsWorld")) {
            if (jsonBool(v)) |b| node.physics_world = b;
        } else if (std.mem.eql(u8, k, "physicsWorldId")) {
            if (jsonInt(v)) |i| node.physics_world_id = @intCast(@max(0, i));
        } else if (std.mem.eql(u8, k, "physicsBody")) {
            if (jsonBool(v)) |b| node.physics_body = b;
        } else if (std.mem.eql(u8, k, "physicsCollider")) {
            if (jsonBool(v)) |b| node.physics_collider = b;
        } else if (std.mem.eql(u8, k, "physicsBodyType")) {
            // String form: 'static'|'kinematic'|'dynamic' → 0|1|2 (Box2D enum order).
            if (v == .string) {
                const s = v.string;
                if (std.mem.eql(u8, s, "static")) node.physics_body_type = 0 else if (std.mem.eql(u8, s, "kinematic")) node.physics_body_type = 1 else node.physics_body_type = 2;
            } else if (jsonInt(v)) |i| node.physics_body_type = @intCast(@max(0, @min(i, 2)));
        } else if (std.mem.eql(u8, k, "physicsShape")) {
            // 'box' | 'circle' → 0|1.
            if (v == .string) {
                node.physics_shape = if (std.mem.eql(u8, v.string, "circle")) 1 else 0;
            } else if (jsonInt(v)) |i| node.physics_shape = @intCast(@max(0, i));
        } else if (std.mem.eql(u8, k, "physicsRadius")) {
            if (jsonFloat(v)) |f| node.physics_radius = f;
        } else if (std.mem.eql(u8, k, "physicsX")) {
            if (jsonFloat(v)) |f| node.physics_x = f;
        } else if (std.mem.eql(u8, k, "physicsY")) {
            if (jsonFloat(v)) |f| node.physics_y = f;
        } else if (std.mem.eql(u8, k, "physicsAngle")) {
            if (jsonFloat(v)) |f| node.physics_angle = f;
        } else if (std.mem.eql(u8, k, "physicsGravityX")) {
            if (jsonFloat(v)) |f| node.physics_gravity_x = f;
        } else if (std.mem.eql(u8, k, "physicsGravityY")) {
            if (jsonFloat(v)) |f| node.physics_gravity_y = f;
        } else if (std.mem.eql(u8, k, "physicsGravityScale")) {
            if (jsonFloat(v)) |f| node.physics_gravity_scale = f;
        } else if (std.mem.eql(u8, k, "physicsDensity")) {
            if (jsonFloat(v)) |f| node.physics_density = f;
        } else if (std.mem.eql(u8, k, "physicsFriction")) {
            if (jsonFloat(v)) |f| node.physics_friction = f;
        } else if (std.mem.eql(u8, k, "physicsRestitution")) {
            if (jsonFloat(v)) |f| node.physics_restitution = f;
        } else if (std.mem.eql(u8, k, "physicsFixedRotation")) {
            if (jsonBool(v)) |b| node.physics_fixed_rotation = b;
        } else if (std.mem.eql(u8, k, "physicsBullet")) {
            if (jsonBool(v)) |b| node.physics_bullet = b;
        }
        // ── Scene3D props (framework/gpu/3d.zig reads these per node) ──
        else if (std.mem.eql(u8, k, "scene3d")) {
            if (jsonBool(v)) |b| node.scene3d = b;
        } else if (std.mem.eql(u8, k, "scene3dMesh")) {
            if (jsonBool(v)) |b| node.scene3d_mesh = b;
        } else if (std.mem.eql(u8, k, "scene3dCamera")) {
            if (jsonBool(v)) |b| node.scene3d_camera = b;
        } else if (std.mem.eql(u8, k, "scene3dWireframe")) {
            if (jsonBool(v)) |b| node.scene3d_wireframe = b;
        } else if (std.mem.eql(u8, k, "scene3dMatcap")) {
            if (jsonBool(v)) |b| node.scene3d_matcap = b;
        } else if (std.mem.eql(u8, k, "scene3dPlayerScaleOverlay")) {
            if (jsonBool(v)) |b| node.scene3d_player_scale_overlay = b;
        } else if (std.mem.eql(u8, k, "scene3dMeasurementOverlay")) {
            if (jsonBool(v)) |b| node.scene3d_measurement_overlay = b;
        } else if (std.mem.eql(u8, k, "scene3dCameraOrbit")) {
            // Drop-to-view orbit camera: the host owns the view (gpu/3d.zig orbit
            // state). Distinct from scene3dCameraNative, which binds the game FPS
            // camera (game_camera.zig).
            if (jsonBool(v)) |b| node.scene3d_camera_orbit = b;
        } else if (std.mem.eql(u8, k, "scene3dCameraNative")) {
            if (jsonBool(v)) |b| {
                if (b) {
                    game_camera.bindNode(node.id);
                } else {
                    game_camera.unbindNode(node.id);
                }
            }
        } else if (std.mem.eql(u8, k, "scene3dLight")) {
            if (jsonBool(v)) |b| node.scene3d_light = b;
        } else if (std.mem.eql(u8, k, "scene3dGroup")) {
            if (jsonBool(v)) |b| node.scene3d_group = b;
        } else if (std.mem.eql(u8, k, "scene3dLightType")) {
            if (dupJsonText(v)) |s| node.scene3d_light_type = s;
        } else if (std.mem.eql(u8, k, "scene3dColorR")) {
            if (jsonFloat(v)) |f| node.scene3d_color_r = f;
        } else if (std.mem.eql(u8, k, "scene3dColorG")) {
            if (jsonFloat(v)) |f| node.scene3d_color_g = f;
        } else if (std.mem.eql(u8, k, "scene3dColorB")) {
            if (jsonFloat(v)) |f| node.scene3d_color_b = f;
        } else if (std.mem.eql(u8, k, "scene3dColorA")) {
            if (jsonFloat(v)) |f| node.scene3d_color_a = f;
        } else if (std.mem.eql(u8, k, "scene3dPosX")) {
            if (jsonFloat(v)) |f| node.scene3d_pos_x = f;
        } else if (std.mem.eql(u8, k, "scene3dPosY")) {
            if (jsonFloat(v)) |f| node.scene3d_pos_y = f;
        } else if (std.mem.eql(u8, k, "scene3dPosZ")) {
            if (jsonFloat(v)) |f| node.scene3d_pos_z = f;
        } else if (std.mem.eql(u8, k, "scene3dRotX")) {
            if (jsonFloat(v)) |f| node.scene3d_rot_x = f;
        } else if (std.mem.eql(u8, k, "scene3dRotY")) {
            if (jsonFloat(v)) |f| node.scene3d_rot_y = f;
        } else if (std.mem.eql(u8, k, "scene3dRotZ")) {
            if (jsonFloat(v)) |f| node.scene3d_rot_z = f;
        } else if (std.mem.eql(u8, k, "scene3dScaleX")) {
            if (jsonFloat(v)) |f| node.scene3d_scale_x = f;
        } else if (std.mem.eql(u8, k, "scene3dScaleY")) {
            if (jsonFloat(v)) |f| node.scene3d_scale_y = f;
        } else if (std.mem.eql(u8, k, "scene3dScaleZ")) {
            if (jsonFloat(v)) |f| node.scene3d_scale_z = f;
        } else if (std.mem.eql(u8, k, "scene3dLookX")) {
            if (jsonFloat(v)) |f| node.scene3d_look_x = f;
        } else if (std.mem.eql(u8, k, "scene3dLookY")) {
            if (jsonFloat(v)) |f| node.scene3d_look_y = f;
        } else if (std.mem.eql(u8, k, "scene3dLookZ")) {
            if (jsonFloat(v)) |f| node.scene3d_look_z = f;
        } else if (std.mem.eql(u8, k, "scene3dDirX")) {
            if (jsonFloat(v)) |f| node.scene3d_dir_x = f;
        } else if (std.mem.eql(u8, k, "scene3dDirY")) {
            if (jsonFloat(v)) |f| node.scene3d_dir_y = f;
        } else if (std.mem.eql(u8, k, "scene3dDirZ")) {
            if (jsonFloat(v)) |f| node.scene3d_dir_z = f;
        } else if (std.mem.eql(u8, k, "scene3dFov")) {
            if (jsonFloat(v)) |f| node.scene3d_fov = f;
        } else if (std.mem.eql(u8, k, "scene3dFar")) {
            if (jsonFloat(v)) |f| node.scene3d_far = f;
        } else if (std.mem.eql(u8, k, "scene3dNear")) {
            if (jsonFloat(v)) |f| node.scene3d_near = f;
        } else if (std.mem.eql(u8, k, "scene3dIntensity")) {
            if (jsonFloat(v)) |f| node.scene3d_intensity = f;
        } else if (std.mem.eql(u8, k, "scene3dRange")) {
            if (jsonFloat(v)) |f| node.scene3d_range = f;
        } else if (std.mem.eql(u8, k, "scene3dSpread")) {
            if (jsonFloat(v)) |f| node.scene3d_spread = f;
        } else if (std.mem.eql(u8, k, "scene3dCastShadow")) {
            if (jsonBool(v)) |b| node.scene3d_cast_shadow = b;
        } else if (std.mem.eql(u8, k, "scene3dLightRegion")) {
            if (jsonFloat(v)) |f| node.scene3d_light_region = @intFromFloat(f);
        }
        // ── Distance fog (one <Scene3D.Fog> child). near/far in world units,
        // color as [r,g,b] 0..1. 0 / sentinel = auto (anchor to camera far). ──
        else if (std.mem.eql(u8, k, "scene3dFog")) {
            if (jsonBool(v)) |b| node.scene3d_fog = b;
        } else if (std.mem.eql(u8, k, "scene3dFogColor")) {
            if (jsonVec3(v)) |c| node.scene3d_fog_color = c;
        } else if (std.mem.eql(u8, k, "scene3dFogNear")) {
            if (jsonFloat(v)) |f| node.scene3d_fog_near = f;
        } else if (std.mem.eql(u8, k, "scene3dFogFar")) {
            if (jsonFloat(v)) |f| node.scene3d_fog_far = f;
        }
        // ── Skybox props (one <Scene3D.Skybox> child). Colors arrive as
        // [r,g,b] 0..1 arrays already resolved on the JS side. ──
        else if (std.mem.eql(u8, k, "scene3dSkybox")) {
            if (jsonBool(v)) |b| node.scene3d_skybox = b;
        } else if (std.mem.eql(u8, k, "scene3dSkyZenith")) {
            if (jsonVec3(v)) |c| node.scene3d_sky_zenith = c;
        } else if (std.mem.eql(u8, k, "scene3dSkyHorizon")) {
            if (jsonVec3(v)) |c| node.scene3d_sky_horizon = c;
        } else if (std.mem.eql(u8, k, "scene3dSkyGround")) {
            if (jsonVec3(v)) |c| node.scene3d_sky_ground = c;
        } else if (std.mem.eql(u8, k, "scene3dSkySunDir")) {
            if (jsonVec3(v)) |c| node.scene3d_sky_sun_dir = c;
        } else if (std.mem.eql(u8, k, "scene3dSkySunColor")) {
            if (jsonVec3(v)) |c| node.scene3d_sky_sun_color = c;
        } else if (std.mem.eql(u8, k, "scene3dSkySunSize")) {
            if (jsonFloat(v)) |f| node.scene3d_sky_sun_size = f;
        } else if (std.mem.eql(u8, k, "scene3dSkySunGlow")) {
            if (jsonFloat(v)) |f| node.scene3d_sky_sun_glow = f;
        } else if (std.mem.eql(u8, k, "scene3dSkyHaze")) {
            if (jsonFloat(v)) |f| node.scene3d_sky_haze = f;
        } else if (std.mem.eql(u8, k, "scene3dSkyCloud")) {
            if (jsonFloat(v)) |f| node.scene3d_sky_cloud = f;
        } else if (std.mem.eql(u8, k, "scene3dSkyNight")) {
            if (jsonFloat(v)) |f| node.scene3d_sky_night = f;
        } else if (std.mem.eql(u8, k, "scene3dTexW")) {
            if (jsonInt(v)) |i| node.scene3d_tex_w = if (i > 0 and i < 65536) @intCast(i) else 0;
        } else if (std.mem.eql(u8, k, "scene3dTexH")) {
            if (jsonInt(v)) |i| node.scene3d_tex_h = if (i > 0 and i < 65536) @intCast(i) else 0;
        } else if (std.mem.eql(u8, k, "scene3dTexKey")) {
            if (dupJsonText(v)) |s| node.scene3d_tex_key = s;
        } else if (std.mem.eql(u8, k, "scene3dGeomKey")) {
            // @reactjit/geometries intern key (e.g. "Sphere:r0.12s24g16"). gpu/3d.zig
            // caches the retained vertex slice under this key; identical keys across
            // meshes share one upload + one buffer region.
            if (dupJsonText(v)) |s| node.scene3d_geom_key = s;
        } else if (std.mem.eql(u8, k, "scene3dGroundFormula")) {
            // Data-shape ground (GUIDING_LIGHT): WGSL the mesh runs per fragment
            // (gpu/3d.zig assembles + compiles it once) instead of sampling a baked
            // texture. Defines fn hf_ground_rgb(uv)->vec3f over the D ref stream.
            if (dupJsonText(v)) |s| node.scene3d_ground_formula = s;
        } else if (std.mem.eql(u8, k, "scene3dGroundData")) {
            // The per-cell reference stream the formula reads (cols,rows,pal,
            // palette…, cell idx…, ribbon section) — bound as storage buffer D.
            // Same g_alloc-owned []f32 pattern as scene3dHeights.
            if (v == .array) {
                const items = v.array.items;
                if (items.len > 0 and items.len <= (1 << 22)) {
                    const buf = g_alloc.alloc(f32, items.len) catch null;
                    if (buf) |out| {
                        for (items, 0..) |fv, n| out[n] = jsonFloat(fv) orelse 0;
                        node.scene3d_ground_data = out;
                    }
                }
            }
        } else if (std.mem.eql(u8, k, "scene3dVertices")) {
            // Interleaved verts [px,py,pz,nx,ny,nz,u,v]×count produced by the TS
            // generator. Read ONCE on cache miss, then the retained GPU slice is
            // redrawn every frame — same g_alloc-owned []f32 pattern as heights.
            if (v == .array) {
                const items = v.array.items;
                if (items.len > 0 and items.len <= (1 << 24)) {
                    const buf = g_alloc.alloc(f32, items.len) catch null;
                    if (buf) |out| {
                        for (items, 0..) |fv, n| out[n] = jsonFloat(fv) orelse 0;
                        node.scene3d_vertices = out;
                    }
                }
            }
        } else if (std.mem.eql(u8, k, "scene3dVerticesHandle")) {
            if (jsonInt(v)) |i| {
                if (i > 0 and i < std.math.maxInt(u32)) {
                    if (contentStoreTake(@intCast(i))) |bytes| {
                        defer std.heap.c_allocator.free(bytes);
                        if (bytes.len > 0 and bytes.len <= (1 << 28) and bytes.len % @sizeOf(f32) == 0) {
                            const len = bytes.len / @sizeOf(f32);
                            const buf = g_alloc.alloc(f32, len) catch null;
                            if (buf) |out| {
                                @memcpy(std.mem.sliceAsBytes(out), bytes);
                                node.scene3d_vertices = out;
                            }
                        }
                    }
                }
            }
        } else if (std.mem.eql(u8, k, "scene3dVertCount")) {
            if (jsonInt(v)) |i| node.scene3d_vert_count = if (i > 0 and i < (1 << 22)) @intCast(i) else 0;
        } else if (std.mem.eql(u8, k, "scene3dBoundsRadius")) {
            if (jsonFloat(v)) |f| node.scene3d_bounds_radius = f;
        } else if (std.mem.eql(u8, k, "scene3dHeights")) {
            // Host-generated heightfield: the cols×rows height grid (1 f32/sample).
            // gpu/3d.zig builds the mesh verts from these — see scene3d_heights.
            if (v == .array) {
                const items = v.array.items;
                if (items.len > 0 and items.len <= (1 << 22)) {
                    const buf = g_alloc.alloc(f32, items.len) catch null;
                    if (buf) |out| {
                        for (items, 0..) |fv, n| out[n] = jsonFloat(fv) orelse 0;
                        node.scene3d_heights = out;
                    }
                }
            }
        } else if (std.mem.eql(u8, k, "scene3dHfDepths")) {
            // Per-cell water depth grid (water meshes); gpu/3d.zig hfGen bakes it
            // into UV.x for the water shader. Same []f32 pattern as scene3dHeights.
            if (v == .array) {
                const items = v.array.items;
                if (items.len > 0 and items.len <= (1 << 22)) {
                    const buf = g_alloc.alloc(f32, items.len) catch null;
                    if (buf) |out| {
                        for (items, 0..) |fv, n| out[n] = jsonFloat(fv) orelse 0;
                        node.scene3d_hf_depths = out;
                    }
                }
            }
        } else if (std.mem.eql(u8, k, "scene3dHfCols")) {
            if (jsonInt(v)) |i| node.scene3d_hf_cols = if (i > 0 and i < (1 << 16)) @intCast(i) else 0;
        } else if (std.mem.eql(u8, k, "scene3dHfRows")) {
            if (jsonInt(v)) |i| node.scene3d_hf_rows = if (i > 0 and i < (1 << 16)) @intCast(i) else 0;
        } else if (std.mem.eql(u8, k, "scene3dHfWidth")) {
            if (jsonFloat(v)) |f| node.scene3d_hf_width = f;
        } else if (std.mem.eql(u8, k, "scene3dHfDepth")) {
            if (jsonFloat(v)) |f| node.scene3d_hf_depth = f;
        } else if (std.mem.eql(u8, k, "scene3dHfBase")) {
            if (jsonFloat(v)) |f| node.scene3d_hf_base = f;
        } else if (std.mem.eql(u8, k, "scene3dInstanceData")) {
            if (v == .array) {
                const items = v.array.items;
                if (items.len > 0 and items.len <= (1 << 24)) {
                    const buf = g_alloc.alloc(f32, items.len) catch null;
                    if (buf) |out| {
                        for (items, 0..) |fv, n| out[n] = jsonFloat(fv) orelse 0;
                        node.scene3d_instance_data = out;
                    }
                }
            }
        } else if (std.mem.eql(u8, k, "scene3dInstanceCount")) {
            if (jsonInt(v)) |i| node.scene3d_instance_count = if (i > 0 and i < (1 << 20)) @intCast(i) else 0;
        } else if (std.mem.eql(u8, k, "scene3dInstanceStride")) {
            if (jsonInt(v)) |i| node.scene3d_instance_stride = if (i >= 9 and i <= 16) @intCast(i) else 0;
        } else if (std.mem.eql(u8, k, "scene3dTexData")) {
            // RRGGBBAA hex string, 8 chars per pixel. Length must equal
            // 8 * w * h. Decoded into a fresh RGBA byte buffer owned by
            // g_alloc; the gpu/3d.zig texture cache reads the pointer
            // and hashes (w, h, ptr) to dedupe uploads.
            if (v == .string) {
                const hex = v.string;
                if (hex.len % 8 == 0 and hex.len > 0) {
                    const px_count = hex.len / 8;
                    const buf = g_alloc.alloc(u8, px_count * 4) catch null;
                    if (buf) |out| {
                        var ok: bool = true;
                        var i: usize = 0;
                        while (i < px_count) : (i += 1) {
                            const slice = hex[i * 8 .. i * 8 + 8];
                            const r = std.fmt.parseInt(u8, slice[0..2], 16) catch {
                                ok = false;
                                break;
                            };
                            const g = std.fmt.parseInt(u8, slice[2..4], 16) catch {
                                ok = false;
                                break;
                            };
                            const b = std.fmt.parseInt(u8, slice[4..6], 16) catch {
                                ok = false;
                                break;
                            };
                            const a = std.fmt.parseInt(u8, slice[6..8], 16) catch {
                                ok = false;
                                break;
                            };
                            out[i * 4 + 0] = r;
                            out[i * 4 + 1] = g;
                            out[i * 4 + 2] = b;
                            out[i * 4 + 3] = a;
                        }
                        if (ok) {
                            // Replace any prior texture buffer this node held —
                            // React commits update the prop in-place rather than
                            // through a node teardown, so without this swap each
                            // archetype/seed/frame change would orphan the old
                            // buffer.
                            if (node.scene3d_tex_rgba) |old| g_alloc.free(old);
                            node.scene3d_tex_rgba = out;
                        } else {
                            g_alloc.free(out);
                        }
                    }
                }
            }
        } else if (std.mem.eql(u8, k, "devtoolsViz")) {
            // Inspector overlay mode for this node:
            //   'sparkline' | 'wireframe' | 'node_tree' | 'inspector_overlay' | 'none'
            if (v == .string) {
                const s = v.string;
                if (std.mem.eql(u8, s, "sparkline")) node.devtools_viz = .sparkline else if (std.mem.eql(u8, s, "wireframe")) node.devtools_viz = .wireframe else if (std.mem.eql(u8, s, "node_tree") or std.mem.eql(u8, s, "nodeTree")) node.devtools_viz = .node_tree else if (std.mem.eql(u8, s, "inspector_overlay") or std.mem.eql(u8, s, "inspectorOverlay")) node.devtools_viz = .inspector_overlay else node.devtools_viz = .none;
            }
        } else if (std.mem.eql(u8, k, "inlineGlyphs")) {
            // Inline SVG glyphs threaded into a `<Text>`. Each `\x01` byte in
            // the text reserves a fontSize×fontSize slot; glyphs[i] paints
            // into the i-th slot. Each item: {d, fill?, fillEffect?, stroke?,
            // strokeWidth?, scale?}. See framework/text.zig:40 for sentinels.
            applyInlineGlyphs(node, v);
        } else if (std.mem.eql(u8, k, "contextMenuItems")) {
            // Native context menu (framework/context_menu.zig). Items must be
            // [{ label: string }, ...]; the handler is wired automatically and
            // dispatches `__dispatchEvent(<id>,'onContextMenu',<itemIdx>)` when
            // an item is clicked. Cap MAX_MENU_ITEMS items.
            applyContextMenuItems(node, v);
        } else if (std.mem.eql(u8, k, "scrollY")) {
            if (jsonFloat(v)) |f| {
                node.scroll_y = f;
                markScrollPropSlot(node);
            }
        } else if (std.mem.eql(u8, k, "scrollX")) {
            if (jsonFloat(v)) |f| {
                node.scroll_x = f;
                markScrollPropSlot(node);
            }
        } else if (std.mem.eql(u8, k, "sliderValue")) {
            // Controlled value — but the ENGINE owns the thumb while the
            // button is down (SLIDER-0611): a React echo arriving mid-drag
            // must never fight the pool-resident drag value. Media-bound
            // sliders (MEDIASLIDER-0705) are engine-owned ALWAYS.
            if (!node.slider_dragging and node.slider_media_src == null) {
                if (jsonFloat(v)) |f| node.slider_value = f;
            }
        } else if (std.mem.eql(u8, k, "sliderMin")) {
            if (node.slider_media_src == null) {
                if (jsonFloat(v)) |f| node.slider_min = f;
            }
        } else if (std.mem.eql(u8, k, "sliderMax")) {
            if (node.slider_media_src == null) {
                if (jsonFloat(v)) |f| node.slider_max = f;
            }
        } else if (std.mem.eql(u8, k, "sliderStep")) {
            if (jsonFloat(v)) |f| node.slider_step = @max(0, f);
        } else if (std.mem.eql(u8, k, "sliderMedia")) {
            // Bind the slider to a videos.zig entry by src (MEDIASLIDER-0705).
            // The engine then owns value + range: time-pos follow when idle,
            // keyframe seeks while dragging, exact seek + settle on release.
            // NOTE: runtime/primitives.tsx emits this key BEFORE sliderValue/
            // Min/Max so the ownership guard above sees it on CREATE.
            if (dupJsonText(v)) |s| node.slider_media_src = s;
        } else if (std.mem.eql(u8, k, "sliderHover")) {
            if (jsonBool(v)) |b| node.slider_hover = b;
        } else if (std.mem.eql(u8, k, "sliderHoverLatch")) {
            // Latch key the engine writes the tooltip left-position to on
            // every hover/drag motion — the cart binds left:'latch:KEY'.
            if (dupJsonText(v)) |s| node.slider_hover_latch_key = s;
        } else if (std.mem.eql(u8, k, "sliderHoverWidth")) {
            if (jsonFloat(v)) |f| node.slider_hover_w = @max(0, f);
        } else if (std.mem.eql(u8, k, "sliderHoverStep")) {
            if (jsonFloat(v)) |f| node.slider_hover_step = @max(0.01, f);
        } else if (std.mem.eql(u8, k, "showScrollbar")) {
            if (jsonBool(v)) |b| node.show_scrollbar = b;
        } else if (std.mem.eql(u8, k, "scrollbarSide")) {
            if (v == .string) node.scrollbar_side = parseScrollbarSide(v.string);
        } else if (std.mem.eql(u8, k, "autoHide")) {
            if (jsonBool(v)) |b| node.scrollbar_auto_hide = b;
        } else if (std.mem.eql(u8, k, "initialScrollY")) {
            // One-shot: set scroll_y on CREATE so dev hot reloads can restore
            // the user's scroll position via the ScrollView React wrapper.
            // CREATE passes a non-null type_name; UPDATE passes null. Applying
            // on UPDATE would clobber the user's live scroll on every prop
            // commit. The framework clamps this to content bounds on first layout.
            if (type_name != null) {
                if (jsonFloat(v)) |f| node.scroll_y = f;
            }
        } else if (std.mem.eql(u8, k, "initialScrollX")) {
            if (type_name != null) {
                if (jsonFloat(v)) |f| node.scroll_x = f;
            }
        } else if (std.mem.eql(u8, k, "originTopLeft")) {
            // Graph/Canvas container: flip world-origin from center to top-left.
            // Opt-in; polar / pan-zoom code stays on the center-origin default.
            if (jsonBool(v)) |b| node.graph_origin_topleft = b;
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
        } else if (std.mem.eql(u8, k, "iconName")) {
            // SDF-baked icon — engine paints this node as a single textured
            // quad sampling framework/gpu/sdf_icons.zig's atlas. Tint from
            // text_color; size from style.width/height.
            if (dupJsonText(v)) |s| node.icon_name = s;
        } else if (std.mem.eql(u8, k, "points")) {
            // Graph.Polyline — flat array {x0, y0, x1, y1, …}. Parsed ONCE
            // here, then engine paint emits a batched line draw per segment
            // every frame without re-parsing. Free the previous buffer if any
            // (UPDATE replaces the array).
            if (v == .array) {
                if (node.polyline_points) |old| g_alloc.free(old);
                const buf = g_alloc.alloc(f32, v.array.items.len) catch null;
                if (buf) |out| {
                    for (v.array.items, 0..) |item, i| {
                        out[i] = jsonFloat(item) orelse 0;
                    }
                    node.polyline_points = out;
                }
            }
        } else if (std.mem.eql(u8, k, "polylineSegments")) {
            // Graph.Polyline `segments` — the point array is a DISJOINT segment
            // list (pairs), not a connected strip. One node, N independent lines.
            node.polyline_segments = jsonBool(v) orelse false;
        } else if (std.mem.eql(u8, k, "gcurves")) {
            // Graph.GCurve — flat array of 6-float quadratic-bezier-triangle
            // control points: {p0x,p0y, p1x,p1y, p2x,p2y, …}. Parsed once at
            // CREATE/UPDATE; engine paint queues one g-curve fill instance
            // per group of 6 floats.
            if (v == .array) {
                if (node.gcurve_data) |old| g_alloc.free(old);
                const buf = g_alloc.alloc(f32, v.array.items.len) catch null;
                if (buf) |out| {
                    for (v.array.items, 0..) |item, i| {
                        out[i] = jsonFloat(item) orelse 0;
                    }
                    node.gcurve_data = out;
                }
            }
        } else if (std.mem.eql(u8, k, "effectData")) {
            // <Effect data={[…]}> — uploaded to the GPU storage buffer at
            // @group(0) @binding(1). Lets shader source stay static while
            // data updates per frame, so the pipeline doesn't recompile.
            if (v == .array) {
                if (node.effect_data) |old| g_alloc.free(old);
                const buf = g_alloc.alloc(f32, v.array.items.len) catch null;
                if (buf) |out| {
                    for (v.array.items, 0..) |item, i| {
                        out[i] = jsonFloat(item) orelse 0;
                    }
                    node.effect_data = out;
                }
            }
        } else if (std.mem.eql(u8, k, "stroke")) {
            // `stroke` maps to text_color — that's the field engine_paint.zig
            // reads for Canvas.Path / Graph.Path stroke color.
            if (v == .string) node.text_color = parseColor(v.string);
        } else if (std.mem.eql(u8, k, "strokeOpacity")) {
            if (jsonFloat(v)) |f| node.canvas_stroke_opacity = @max(0, @min(f, 1));
        } else if (std.mem.eql(u8, k, "strokeWidth")) {
            if (jsonFloat(v)) |f| node.canvas_stroke_width = f;
        } else if (std.mem.eql(u8, k, "fill")) {
            if (v == .string) node.canvas_fill_color = parseColor(v.string);
        } else if (std.mem.eql(u8, k, "fillOpacity")) {
            if (jsonFloat(v)) |f| node.canvas_fill_opacity = @max(0, @min(f, 1));
        } else if (std.mem.eql(u8, k, "gradient")) {
            node.canvas_fill_gradient = parseLinearGradient(v);
        } else if (std.mem.eql(u8, k, "fillEffect")) {
            if (dupJsonText(v)) |s| node.canvas_fill_effect = s;
        } else if (std.mem.eql(u8, k, "flowSpeed")) {
            // Animated stroke flow along the path: 0 = solid, >0 = forward,
            // <0 = reverse. Pairs with borderFlowSpeed for box borders.
            if (jsonFloat(v)) |f| node.canvas_flow_speed = f;
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
        } else if (std.mem.eql(u8, k, "driftX")) {
            // Ambient horizontal drift (px/sec, negative = leftward).
            // Engine ticks while drift_active=true and the user isn't dragging.
            if (jsonFloat(v)) |f| node.canvas_drift_x = f;
        } else if (std.mem.eql(u8, k, "driftY")) {
            if (jsonFloat(v)) |f| node.canvas_drift_y = f;
        } else if (std.mem.eql(u8, k, "driftActive")) {
            if (jsonBool(v)) |b| node.canvas_drift_active = b;
        } else if (std.mem.eql(u8, k, "selectNodes")) {
            // false = opt out of the engine's built-in Canvas.Node click-to-select
            // and its hover/selected rings. A selected node freezes drift
            // (paintCanvasContainer), so editors with their own selection model
            // (hmsc-int map painter) set selectNodes={false} — otherwise any
            // background click over a node gridlocks WASD pan until re-clicked.
            if (jsonBool(v)) |b| node.canvas_node_select = b;
        } else if (std.mem.eql(u8, k, "gridStep")) {
            if (jsonFloat(v)) |f| node.canvas_grid_step = if (f > 0) f else 0;
        } else if (std.mem.eql(u8, k, "gridStroke")) {
            if (jsonFloat(v)) |f| node.canvas_grid_stroke = if (f > 0) f else 1;
        } else if (std.mem.eql(u8, k, "gridColor")) {
            if (v == .string) node.canvas_grid_color = parseColor(v.string);
        } else if (std.mem.eql(u8, k, "gridMajorColor")) {
            if (v == .string) node.canvas_grid_color_major = parseColor(v.string);
        } else if (std.mem.eql(u8, k, "gridMajorEvery")) {
            if (jsonFloat(v)) |f| {
                const i: i64 = @trunc(@max(0, @min(f, 255)));
                node.canvas_grid_major_every = @intCast(i);
            }
        }
        // ── Effect props ──
        else if (std.mem.eql(u8, k, "name")) {
            if (dupJsonText(v)) |s| node.effect_name = s;
        } else if (std.mem.eql(u8, k, "background")) {
            if (jsonBool(v)) |b| node.effect_background = b;
        } else if (std.mem.eql(u8, k, "mask")) {
            // CSS mask-image equivalent: when set, the effect's alpha is used
            // as the parent's clip mask (effects.zig CPU-only path for now).
            if (jsonBool(v)) |b| node.effect_mask = b;
        } else if (std.mem.eql(u8, k, "shader")) {
            // WGSL fragment shader body. We prepend a standard header
            // (uniforms struct, fullscreen-triangle vs_main) and the
            // shared math library (snoise, fbm, hsv2rgb, hsl2rgb, …)
            // before the user code so every cart sees the same surface.
            if (v == .string) {
                if (effect_assemble.assemble(g_alloc, v.string)) |wgsl| {
                    node.effect_shader = .{ .wgsl = wgsl };
                }
            }
        } else if (std.mem.eql(u8, k, "textures")) {
            // <Effect textures={['paintable-A', 'src-img']} /> — array of
            // paintable handle strings, slot order. effects.zig binds each
            // into the pipeline at @binding(2+2i) / @binding(3+2i).
            if (node.effect_textures) |old| {
                for (old) |s| g_alloc.free(s);
                g_alloc.free(old);
                node.effect_textures = null;
            }
            if (v == .array) {
                const arr = g_alloc.alloc([]const u8, v.array.items.len) catch null;
                if (arr) |out| {
                    var ok = true;
                    for (v.array.items, 0..) |item, i| {
                        if (item != .string) {
                            ok = false;
                            break;
                        }
                        const dup = g_alloc.dupe(u8, item.string) catch {
                            ok = false;
                            break;
                        };
                        out[i] = dup;
                    }
                    if (ok) {
                        node.effect_textures = out;
                    } else {
                        // Partial allocation — free what we managed.
                        g_alloc.free(out);
                    }
                }
            }
        } else if (std.mem.eql(u8, k, "paintableId")) {
            // String handle that uniquely identifies the paintable's
            // GPU texture across the cart. Dup'd on g_alloc (matches
            // the canvas_fill_effect / text_effect lifetime model).
            if (v == .string) {
                if (node.paintable_id) |old| g_alloc.free(old);
                if (dupJsonText(v)) |s| node.paintable_id = s;
            }
        } else if (std.mem.eql(u8, k, "paintableW")) {
            if (jsonFloat(v)) |f| {
                const iw: i64 = @trunc(@max(0, f));
                node.paintable_w = @intCast(iw);
            }
        } else if (std.mem.eql(u8, k, "paintableH")) {
            if (jsonFloat(v)) |f| {
                const ih: i64 = @trunc(@max(0, f));
                node.paintable_h = @intCast(ih);
            }
        } else if (std.mem.eql(u8, k, "paintableRGBA")) {
            node.paintable_rgba = (v == .bool and v.bool);
        }
    }
    // After all props are applied, if we have a complete paintable spec,
    // (re-)allocate the GPU texture. ensure() is idempotent and handles
    // re-sizing by re-allocating, so prop updates that change w/h work.
    if (node.is_paintable) {
        if (node.paintable_id) |pid| {
            if (node.paintable_w > 0 and node.paintable_h > 0) {
                _ = paintable.ensure(pid, node.paintable_w, node.paintable_h, node.paintable_rgba);
            }
        }
    }
}

// The Effect shader header + math prelude + assembleEffectShader moved to the
// shared framework/gpu/effect_assemble.zig (imported above as `effect_assemble`)
// so the V8 host and the no-V8 material path assemble shaders identically.

// Called by effects.renderCpuNow when a node has node.effect_render pointing
// at us. `ctx.user_data` carries the React fiber id (set on the Instance as
// node_key = node.scroll_persist_slot, see effects.zig instanceKey). That id
// is what handlerRegistry maps to the user's onRender closure.
fn v8_effect_shim(ctx: *effect_ctx.EffectContext) void {
    const host = hostFromCallbackContext(ctx.callback_context) orelse return;
    const id_u: usize = ctx.user_data;
    if (id_u == 0) return;
    const id: u32 = @intCast(id_u);
    const buf_len: usize = @as(usize, ctx.height) * @as(usize, ctx.stride);
    v8_runtime.dispatchEffectRender(
        host,
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

fn applyHandlerFlags(context: *anyopaque, node: *Node, id: u32, cmd: std.json.Value) void {
    node.handlers.context = context;
    if (node.input_id) |slot| input.setCallbackContext(slot, context);
    node.handlers.js_on_press = null;
    node.handlers.js_on_middle_click = null;
    node.handlers.js_on_mouse_down = null;
    node.handlers.js_on_mouse_move = null;
    node.handlers.js_on_mouse_up = null;
    node.handlers.js_on_hover_enter = null;
    node.handlers.js_on_hover_exit = null;
    node.handlers.on_scroll = null;
    node.handlers.on_right_click = null;
    node.canvas_move_draggable = false;
    node.effect_render = null;
    node.effect_render_context = null;
    node.has_on_layout = false;
    if (cmdHasHandlerName(cmd, "onLayout")) {
        node.has_on_layout = true;
    }

    if (cmdHasAnyHandlerName(cmd, &.{ "onClick", "onPress" })) {
        node.handlers.js_on_press = installJsExpr("__dispatchEvent({d},'onClick')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onMouseDown", "onPointerDown", "onPressIn" })) {
        node.handlers.js_on_mouse_down = installJsExpr("__dispatchEvent({d},'onMouseDown')\x00", id);
    }
    // Middle button: the engine's SDL_BUTTON_MIDDLE branch dispatches this
    // directly (it never enters the LEFT-only capture pipeline) — carts that
    // need a middle-drag poll getMouseButtons() from the handler (req_2704).
    if (cmdHasHandlerName(cmd, "onMiddleClick")) {
        node.handlers.js_on_middle_click = installJsExpr("__dispatchEvent({d},'onMiddleClick')\x00", id);
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
        node.handlers.on_scroll = dispatchV8Scroll;
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onRightClick", "onContextMenu" })) {
        node.handlers.on_right_click = dispatchV8RightClick;
    }
    if (cmdHasAnyHandlerName(cmd, &.{"onMove"})) {
        node.canvas_move_draggable = true;
    }
    // onRender wires this node into the Effect custom-render path. The React
    // id is carried through materializeChildren via node.scroll_persist_slot
    // and read back from ctx.user_data inside v8_effect_shim.
    if (cmdHasHandlerName(cmd, "onRender")) {
        node.effect_render = &v8_effect_shim;
        node.effect_render_context = context;
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

fn dispatchWindowEvent(context: *anyopaque, id: u32, handler: []const u8) void {
    const host: *HostContext = @ptrCast(@alignCast(context));
    var buf: [160]u8 = undefined;
    const expr = std.fmt.bufPrintZ(&buf, "__dispatchEvent({d},'{s}')", .{ id, handler }) catch return;
    v8_runtime.evalScript(host, expr);
}

fn writeJsonString(out: *std.ArrayList(u8), value: []const u8) !void {
    const rendered = try std.fmt.allocPrint(g_alloc, "{f}", .{std.json.fmt(value, .{})});
    defer g_alloc.free(rendered);
    try out.appendSlice(g_alloc, rendered);
}

fn appendBoundedPrint(out: *std.ArrayList(u8), comptime fmt: []const u8, args: anytype) !void {
    var print_buf: [160]u8 = undefined;
    try out.appendSlice(g_alloc, try std.fmt.bufPrint(&print_buf, fmt, args));
}

// ── Command application ─────────────────────────────────────────
//
// applyCommand, ensureNode, inheritTypography, and the structural side
// of markSubtreeDirty all live in framework/host_tree.zig now (single
// owner across both shells). v8_app installs hooks (apply_props,
// apply_handler_flags, open_host_window, note_window_owner,
// route_to_window, remove_prop_keys, remove_style_keys,
// child_window_intercept, type_defaults) plus a mutation hook that
// stamps `subtree_last_mutated_frame` for <StaticSurface> invalidation.
// See installHostTreeHooks() in main().

fn ensureNode(id: u32) !*Node {
    return host_tree.ensureNode(id);
}

fn inheritTypography(parent_id: u32, child_id: u32) void {
    host_tree.inheritTypography(parent_id, child_id);
}

/// host_tree fires the mutation hook for `id` and every ancestor on each
/// applyCommand — see hostTreeMutationHook below. Local callers (Alt-drag,
/// dev-mode reload paths) that aren't inside the reconciler stream call
/// this wrapper to get the same stamp.
fn markSubtreeDirty(id: u32) void {
    const frame = gpu.frameCounter();
    var current: ?u32 = id;
    var hops: u32 = 0;
    while (current) |cur| {
        if (g_node_by_id.get(cur)) |node| {
            node.subtree_last_mutated_frame = frame;
        }
        current = g_parent_id.get(cur);
        hops += 1;
        if (hops > 4096) break;
    }
}

fn hostTreeMutationHook(node: *Node) void {
    node.subtree_last_mutated_frame = gpu.frameCounter();
}

/// child_window_intercept hook — when this process is a spawned child
/// (.independent window mode), CREATE/UPDATE on the window-node id are
/// suppressed (the window is already managed externally), and
/// APPEND/INSERT_BEFORE/REMOVE that target the window id as parent are
/// re-routed onto the root list (the child sees the window's subtree as
/// its top-level tree). Returning true means "command consumed, do not
/// let host_tree fall through to its standard CRUD".
fn childWindowIntercept(cmd: std.json.Value, op: []const u8) bool {
    if (!g_is_window_child) return false;
    if (cmd != .object) return false;
    if (std.mem.eql(u8, op, "CREATE") or std.mem.eql(u8, op, "UPDATE")) {
        if (cmd.object.get("id")) |v| {
            if (host_tree.jsonInt(v)) |id| {
                if (id == g_child_window_id) return true;
            }
        }
        return false;
    }
    const pid_v = cmd.object.get("parentId") orelse return false;
    const pid_i = host_tree.jsonInt(pid_v) orelse return false;
    if (pid_i != g_child_window_id) return false;
    const cid_v = cmd.object.get("childId") orelse return false;
    const cid_i = host_tree.jsonInt(cid_v) orelse return false;
    if (cid_i < 0) return false;
    const cid: u32 = @intCast(cid_i);
    if (std.mem.eql(u8, op, "APPEND")) {
        _ = host_tree.ensureNode(cid) catch return true;
        for (host_tree.getRootChildren()) |existing| if (existing == cid) return true;
        host_tree.appendToRoot(cid) catch {};
        return true;
    } else if (std.mem.eql(u8, op, "INSERT_BEFORE")) {
        const bid_v = cmd.object.get("beforeId") orelse return false;
        const bid_i = host_tree.jsonInt(bid_v) orelse return false;
        host_tree.insertBeforeRoot(cid, @intCast(bid_i)) catch {};
        return true;
    } else if (std.mem.eql(u8, op, "REMOVE")) {
        host_tree.removeFromRoot(cid);
        return true;
    }
    return false;
}

fn beforeNodeDestroy(context: *anyopaque, node: *Node, _: u32) void {
    const host: *HostContext = @ptrCast(@alignCast(context));
    // Release GPU resources tied to per-node fields before the Node
    // itself is freed. Add new releases here when more handle-typed
    // fields land — the order doesn't matter, all branches are
    // independent.
    if (node.is_paintable) {
        if (node.paintable_id) |pid| {
            paintable.destroy(pid);
        }
    }
    if (node.paintable_id) |pid| {
        g_alloc.free(pid);
        node.paintable_id = null;
    }
    game_camera.unbindNode(node.id);
    if (node.world_loader) world_loader.unmount(host.io, node.id);
    if (node.world_loader_game_file) |s| {
        g_alloc.free(s);
        node.world_loader_game_file = null;
    }
    if (node.world_loader_store_dir) |s| {
        g_alloc.free(s);
        node.world_loader_store_dir = null;
    }
    if (node.effect_textures) |arr| {
        for (arr) |s| g_alloc.free(s);
        g_alloc.free(arr);
        node.effect_textures = null;
    }
}

fn installHostTreeHooks() void {
    host_tree.setHooks(.{
        .type_defaults = applyTypeDefaults,
        .apply_props = applyProps,
        .apply_handler_flags = applyHandlerFlags,
        .open_host_window = openHostWindowForNode,
        .note_window_owner = noteCommandWindowOwner,
        .route_to_window = routeCommandToHostWindow,
        .remove_prop_keys = removePropKeys,
        .remove_style_keys = removeStyleKeys,
        .child_window_intercept = childWindowIntercept,
        .before_destroy = beforeNodeDestroy,
    });
    host_tree.setMutationHook(hostTreeMutationHook);
    engine.setPanelRootProvider(providePanelRoot); // PANELWIN-0628
}

/// Per-batch reconciler drain. Delegates the actual mutation work to
/// host_tree.applyCommandBatch (hooks installed above handle the
/// GPU-specific concerns), then runs v8_app-only diagnostics and the
/// detached-node sweep. Called by the reconciler binding via
/// v8_bindings_reconciler.drainPending().
fn applyCommandBatch(host: *HostContext, json_bytes: []const u8) void {
    const t0 = std.Io.Clock.now(.awake, host.io).toMicroseconds();
    host_tree.applyCommandBatch(host, host.io, host.environ, json_bytes);
    const t1 = std.Io.Clock.now(.awake, host.io).toMicroseconds();
    cleanupDetachedNodes(host.io);
    const t2 = std.Io.Clock.now(.awake, host.io).toMicroseconds();

    const trace_ops = blk: {
        const env = host.environ.get("ZIGOS_TRACE_BATCH_OPS") orelse break :blk false;
        break :blk env.len > 0 and env[0] != '0';
    };
    const verbose = host.environ.get("REACTJIT_VERBOSE_BATCHES") != null;
    if (!trace_ops and !verbose) return;

    // Re-parse for diagnostics. Gated behind env vars, so the double-parse
    // is invisible in normal runs.
    const parsed = std.json.parseFromSlice(std.json.Value, g_alloc, json_bytes, .{}) catch return;
    defer parsed.deinit();
    if (parsed.value != .array) return;
    const cmd_count = parsed.value.array.items.len;

    if (trace_ops and cmd_count > 0) {
        var n_create: u32 = 0;
        var n_update: u32 = 0;
        var n_append: u32 = 0;
        var n_remove: u32 = 0;
        var n_other: u32 = 0;
        var update_summary: std.ArrayList(u8) = .empty;
        defer update_summary.deinit(g_alloc);
        var first_other_op: []const u8 = "";
        var update_seen: u32 = 0;
        for (parsed.value.array.items) |cmd| {
            if (cmd != .object) continue;
            const op_v = cmd.object.get("op") orelse continue;
            if (op_v != .string) continue;
            const op = op_v.string;
            if (std.mem.eql(u8, op, "CREATE")) {
                n_create += 1;
            } else if (std.mem.eql(u8, op, "UPDATE")) {
                n_update += 1;
                if (update_seen < 4) {
                    update_seen += 1;
                    var id_v: i64 = -1;
                    if (cmd.object.get("id")) |idv| if (jsonInt(idv)) |i| {
                        id_v = i;
                    };
                    appendBoundedPrint(&update_summary, " #{d}=id:{d}[", .{ update_seen, id_v }) catch {};
                    if (cmd.object.get("props")) |pv| if (pv == .object) {
                        var iter = pv.object.iterator();
                        var first = true;
                        while (iter.next()) |entry| {
                            if (!first) update_summary.appendSlice(g_alloc, ",") catch break;
                            update_summary.appendSlice(g_alloc, entry.key_ptr.*) catch break;
                            first = false;
                            if (std.mem.eql(u8, entry.key_ptr.*, "style") and entry.value_ptr.* == .object) {
                                update_summary.appendSlice(g_alloc, "{") catch break;
                                var sit = entry.value_ptr.*.object.iterator();
                                var sfirst = true;
                                while (sit.next()) |se| {
                                    if (!sfirst) update_summary.appendSlice(g_alloc, ",") catch break;
                                    update_summary.appendSlice(g_alloc, se.key_ptr.*) catch break;
                                    sfirst = false;
                                }
                                update_summary.appendSlice(g_alloc, "}") catch break;
                            }
                        }
                    };
                    update_summary.appendSlice(g_alloc, "]") catch {};
                }
            } else if (std.mem.eql(u8, op, "APPEND") or std.mem.eql(u8, op, "INSERT_BEFORE")) {
                n_append += 1;
            } else if (std.mem.eql(u8, op, "REMOVE")) {
                n_remove += 1;
            } else {
                n_other += 1;
                if (first_other_op.len == 0) {
                    first_other_op = op;
                    var id_v: i64 = -1;
                    if (cmd.object.get("id")) |idv| if (jsonInt(idv)) |i| {
                        id_v = i;
                    };
                    appendBoundedPrint(&update_summary, " other=id:{d}", .{id_v}) catch {};
                    if (cmd.object.get("text")) |tv| if (tv == .string) {
                        const t = tv.string;
                        const head_len = if (t.len > 24) 24 else t.len;
                        appendBoundedPrint(&update_summary, " text:{s}", .{t[0..head_len]}) catch {};
                    };
                }
            }
        }
        std.debug.print(
            "[batch-ops] cmds={d} C={d} U={d} A={d} R={d} other={d}({s}) updates:{s}\n",
            .{ cmd_count, n_create, n_update, n_append, n_remove, n_other, first_other_op, update_summary.items },
        );
    }

    if (verbose) {
        const apply_us = t1 - t0;
        const cleanup_us = t2 - t1;
        std.debug.print("[batch-timing] bytes={d} cmds={d} apply={d}ms cleanup={d}ms\n", .{
            json_bytes.len,            cmd_count,
            @divTrunc(apply_us, 1000), @divTrunc(cleanup_us, 1000),
        });
    }
}

// __hostFlush is registered by framework/v8_bindings_reconciler.zig.
// The content store lives in v8_bindings_core. The pending-flush queue
// + drain + reload-clear all live in v8_bindings_reconciler.

fn contentStoreGet(id: u32) ?[]const u8 {
    return v8_bindings_core.contentStoreGet(id);
}

fn contentStoreTake(id: u32) ?[]u8 {
    return v8_bindings_core.contentStoreTake(id);
}

fn drainPendingFlushes(host: *HostContext) void {
    v8_bindings_reconciler.drainPending(host, applyCommandBatch);
}

/// Pre-frame sync: write current latch values into the corresponding
/// node style fields, then mark the global tree dirty so layout/paint
/// re-run. Skipped when no latches were touched since last frame.
///
/// This is the substitute for the React reconciliation path when cart
/// code uses `__latchSet(key, value)` instead of `setState`. The
/// expensive parts of the React path (vdom diff → JSON → bridge →
/// applyCommand parse) are entirely bypassed; the only per-tick cost
/// is the latches.set() FFI call from JS plus this O(N latch-bound
/// nodes) sweep.
fn syncLatchesToNodes() void {
    if (!latches.isDirty()) return;
    var hit = g_latch_height_nodes.keyIterator();
    while (hit.next()) |id_ptr| {
        const node = g_node_by_id.get(id_ptr.*) orelse continue;
        if (node.latch_height_key) |key| node.style.height = latches.getF32(key);
    }
    var wit = g_latch_width_nodes.keyIterator();
    while (wit.next()) |id_ptr| {
        const node = g_node_by_id.get(id_ptr.*) orelse continue;
        if (node.latch_width_key) |key| node.style.width = latches.getF32(key);
    }
    var lit = g_latch_left_nodes.keyIterator();
    while (lit.next()) |id_ptr| {
        const node = g_node_by_id.get(id_ptr.*) orelse continue;
        if (node.latch_left_key) |key| node.style.left = latches.getF32(key);
    }
    var tit = g_latch_top_nodes.keyIterator();
    while (tit.next()) |id_ptr| {
        const node = g_node_by_id.get(id_ptr.*) orelse continue;
        if (node.latch_top_key) |key| node.style.top = latches.getF32(key);
    }
    var rit = g_latch_right_nodes.keyIterator();
    while (rit.next()) |id_ptr| {
        const node = g_node_by_id.get(id_ptr.*) orelse continue;
        if (node.latch_right_key) |key| node.style.right = latches.getF32(key);
    }
    var bit = g_latch_bottom_nodes.keyIterator();
    while (bit.next()) |id_ptr| {
        const node = g_node_by_id.get(id_ptr.*) orelse continue;
        if (node.latch_bottom_key) |key| node.style.bottom = latches.getF32(key);
    }
    latches.clearDirty();
    g_dirty.* = true;
}

// ── Tree materialization ────────────────────────────────────────

fn materializeChildren(arena: std.mem.Allocator, parent_id: u32) []Node {
    return materializeChildrenForOwner(arena, parent_id, null);
}

fn materializeChildrenForOwner(arena: std.mem.Allocator, parent_id: u32, owner: ?u32) []Node {
    const ids = g_children_ids.get(parent_id) orelse return &.{};
    if (ids.items.len == 0) return &.{};
    var visible_count: usize = 0;
    for (ids.items) |cid| {
        if (!g_is_window_child) {
            if (g_window_by_node_id.contains(cid)) {
                continue;
            }
            const child_owner = g_window_owner_by_node_id.get(cid);
            if (owner == null and child_owner != null) {
                continue;
            }
            if (owner != null and child_owner != owner.?) {
                continue;
            }
        }
        visible_count += 1;
    }
    if (visible_count == 0) return &.{};
    const out = arena.alloc(Node, visible_count) catch return &.{};
    var i: usize = 0;
    for (ids.items) |cid| {
        if (!g_is_window_child) {
            if (g_window_by_node_id.contains(cid)) continue;
            const child_owner = g_window_owner_by_node_id.get(cid);
            if (owner == null and child_owner != null) continue;
            if (owner != null and child_owner != owner.?) continue;
        }
        const src = g_node_by_id.get(cid) orelse {
            out[i] = .{};
            i += 1;
            continue;
        };
        out[i] = src.*;
        out[i].children = materializeChildrenForOwner(arena, cid, owner);
        i += 1;
    }
    return out;
}

fn materializeWindowRoot(arena: std.mem.Allocator, window_node_id: u32) ?*Node {
    if (g_node_by_id.get(window_node_id) == null) return null;
    const root = arena.create(Node) catch return null;
    root.* = .{};
    root.style.flex_direction = .column;
    root.style.background_color = Color.rgb(17, 24, 39);
    root.children = materializeChildrenForOwner(arena, window_node_id, window_node_id);
    return root;
}

// PANELWIN-0628: hand the engine a freshly materialized + owner-filtered copy of
// the popped-out subtree each frame. The engine lays it out at the 2nd window's
// size, paints it into a gpu RT, and keeps the pointer alive (the arena resets
// only on the NEXT call) so this window's mouse events hit-test real rects.
fn providePanelRoot() ?*Node {
    if (g_popout_node_id == 0) return null;
    if (g_node_by_id.get(g_popout_node_id) == null) return null;
    _ = g_panel_arena.reset(.retain_capacity);
    return materializeWindowRoot(g_panel_arena.allocator(), g_popout_node_id);
}

fn syncRenderedNodeState(node: *const Node) void {
    if (node.scroll_persist_slot != 0) {
        if (g_node_by_id.get(node.scroll_persist_slot)) |stable| {
            if (!g_scroll_prop_slots.contains(node.scroll_persist_slot)) {
                stable.scroll_x = node.scroll_x;
                stable.scroll_y = node.scroll_y;
            }
            // <Slider> (req_2528): the engine owns the thumb while grabbed, but
            // it writes the RENDERED copy of the tree — and the grab itself marks
            // dirty, so without this carry-back the very next rebuild re-clones
            // the stable node and resurrects the stale prop value (the "slider
            // snaps back to 32" bug). Value syncs only across the drag window
            // (either side sees dragging) so React props own it when idle; the
            // dragging flag always syncs so applyProp's mid-drag guard actually
            // guards the node React writes to.
            if (node.slider) {
                if (node.slider_dragging or stable.slider_dragging)
                    stable.slider_value = node.slider_value;
                stable.slider_dragging = node.slider_dragging;
                // Media-bound (MEDIASLIDER-0705): the engine owns value AND
                // range continuously (time-pos follow + duration auto-set),
                // not just across the drag window — carry both back so a
                // rebuild never resurrects the pre-bind 0..1 range.
                if (node.slider_media_src != null) {
                    stable.slider_value = node.slider_value;
                    stable.slider_min = node.slider_min;
                    stable.slider_max = node.slider_max;
                }
            }
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

fn destroyDetachedNode(io: std.Io, id: u32) void {
    if (g_window_by_node_id.fetchRemove(id)) |entry| {
        if (entry.value.is_popout) {
            panel_window.close();
            if (g_popout_node_id == id) g_popout_node_id = 0;
        } else {
            windows.close(io, entry.value.slot);
        }
        if (entry.value.title) |title| g_alloc.free(title);
    }
    releaseInputSlot(id);
    _ = g_window_owner_by_node_id.remove(id);
    clearContextMenu(id);
    clearInlineGlyphs(id);
    if (g_children_ids.getPtr(id)) |children| {
        children.deinit(g_alloc);
    }
    _ = g_children_ids.remove(id);
    if (g_node_by_id.get(id)) |node| {
        if (node.world_loader) world_loader.unmount(io, node.id);
        // Per-mesh diffuse texture buffer is owned by g_alloc — free
        // before the node memory itself is destroyed so the bytes don't
        // orphan when a textured mesh unmounts (route change / parent
        // teardown).
        if (node.scene3d_tex_rgba) |buf| {
            g_alloc.free(buf);
            node.scene3d_tex_rgba = null;
        }
        g_alloc.destroy(node);
    }
    _ = g_node_by_id.remove(id);
}

fn cleanupDetachedNodes(io: std.Io) void {
    var reachable = std.AutoHashMap(u32, void).init(g_alloc);
    defer reachable.deinit();
    for (g_root_child_ids.items) |child_id| {
        markReachable(&reachable, child_id);
    }

    var stale: std.ArrayList(u32) = .empty;
    defer stale.deinit(g_alloc);

    var it = g_node_by_id.iterator();
    while (it.next()) |entry| {
        const id = entry.key_ptr.*;
        if (!reachable.contains(id)) {
            stale.append(g_alloc, id) catch return;
        }
    }

    for (stale.items) |id| {
        destroyDetachedNode(io, id);
    }
}

fn cleanupClosedHostWindows(host: *HostContext) void {
    var stale: std.ArrayList(u32) = .empty;
    defer stale.deinit(g_alloc);

    var it = g_window_by_node_id.iterator();
    while (it.next()) |entry| {
        if (windows.getSlot(entry.value_ptr.slot) == null) {
            stale.append(g_alloc, entry.key_ptr.*) catch return;
        }
    }

    for (stale.items) |id| {
        if (g_window_by_node_id.fetchRemove(id)) |entry| {
            const handler = if (entry.value.kind == .notification) "onDismiss" else "onClose";
            dispatchWindowEvent(host, id, handler);
            if (entry.value.title) |title| g_alloc.free(title);
        }
    }
}

fn snapshotRuntimeState() void {
    for (g_root.children) |*child| syncRenderedNodeState(child);
    var win_it = g_window_by_node_id.valueIterator();
    while (win_it.next()) |binding| {
        if (windows.getSlot(binding.slot)) |slot| {
            if (slot.root) |root| syncRenderedNodeState(root);
        }
    }
}

/// Build the dev-mode tab strip as a row of arena-allocated Nodes. Returns
/// a single Node (the row container) whose children are the individual tab
/// buttons. Callers prepend this to g_root.children in rebuildTree.
fn onWinMinimize(_: ?*anyopaque) void {
    engine.windowMinimize();
}
fn onWinMaximize(_: ?*anyopaque) void {
    engine.windowMaximize();
}
fn onWinClose(_: ?*anyopaque) void {
    engine.windowClose();
}

fn buildChromeNode(host: *HostContext, arena: std.mem.Allocator) ?Node {
    // Filter out the "main" bootstrap tab (a duplicate of whatever was first pushed)
    var visible: std.ArrayList(usize) = .empty;
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
            children[i].handlers.context = host;
            children[i].handlers.on_press = g_tab_click_callbacks[tab_idx];
        }
    }

    // Spacer — flex-grows to push window controls to the right edge.
    children[tab_count] = .{};
    children[tab_count].style.flex_grow = 1;

    // Window controls. Using unicode dashes/squares/X so we don't need icons.
    const ctrl_labels = [_][]const u8{ "\u{2013}", "\u{25A1}", "\u{00D7}" };
    const ctrl_handlers = [_]*const fn (?*anyopaque) void{ onWinMinimize, onWinMaximize, onWinClose };
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
        children[idx].handlers.context = host;
        children[idx].handlers.on_press = ctrl_handlers[k];
    }

    var chrome: Node = .{};
    chrome.style.position = .absolute;
    chrome.style.top = 0;
    chrome.style.left = 0;
    chrome.style.right = 0;
    chrome.style.height = CHROME_HEIGHT;
    chrome.style.flex_direction = .row;
    chrome.style.align_items = .end;
    chrome.style.gap = 3;
    chrome.style.padding_left = CHROME_PAD;
    chrome.style.padding_right = CHROME_PAD;
    chrome.style.background_color = layout.Color.rgb(8, 11, 15);
    // Empty chrome space in this top strip drags the (borderless) window.
    // Tab + control buttons have on_press which overrides drag in
    // framework/engine.zig's hitTestChrome.
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

fn rebuildTree(host: *HostContext) void {
    _ = g_arena.reset(.retain_capacity);
    const arena = g_arena.allocator();

    if (g_is_window_child) {
        const out = arena.alloc(Node, g_root_child_ids.items.len) catch return;
        for (g_root_child_ids.items, 0..) |cid, i| {
            const src = g_node_by_id.get(cid) orelse {
                out[i] = .{};
                continue;
            };
            out[i] = src.*;
            out[i].children = materializeChildren(arena, cid);
        }
        g_root.children = out;
        return;
    }

    var win_it = g_window_by_node_id.iterator();
    while (win_it.next()) |entry| {
        // The pop-out has no windows.zig slot — the engine renders it via the
        // panel root provider (providePanelRoot), not setRoot here.
        if (entry.value_ptr.is_popout) continue;
        if (materializeWindowRoot(arena, entry.key_ptr.*)) |window_root| {
            windows.setRoot(entry.value_ptr.slot, window_root);
        }
    }

    const chrome_opt = if (DEV_MODE) buildChromeNode(host, arena) else null;
    const resize_edges = if (BORDERLESS_MODE) buildResizeEdges(arena) else null;
    var cart_child_count: usize = 0;
    for (g_root_child_ids.items) |cid| {
        if (!g_window_by_node_id.contains(cid)) cart_child_count += 1;
    }
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
        var i: usize = 0;
        for (g_root_child_ids.items) |cid| {
            if (g_window_by_node_id.contains(cid)) continue;
            const src = g_node_by_id.get(cid) orelse {
                cart_nodes[i] = .{};
                i += 1;
                continue;
            };
            cart_nodes[i] = src.*;
            cart_nodes[i].children = materializeChildren(arena, cid);
            i += 1;
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
        var i: usize = 0;
        for (g_root_child_ids.items) |cid| {
            if (g_window_by_node_id.contains(cid)) continue;
            const dst_idx = chrome_count + i;
            const src = g_node_by_id.get(cid) orelse {
                out[dst_idx] = .{};
                i += 1;
                continue;
            };
            out[dst_idx] = src.*;
            out[dst_idx].children = materializeChildren(arena, cid);
            i += 1;
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

fn readBundleFromDisk(io: std.Io) ![]u8 {
    const file = try std.Io.Dir.cwd().openFile(io, DEV_BUNDLE_PATH, .{});
    defer file.close(io);
    const stat = try file.stat(io);
    const buf = try g_alloc.alloc(u8, stat.size);
    errdefer g_alloc.free(buf);
    const n = try file.readPositionalAll(io, buf, 0);
    return buf[0..n];
}

fn bundleMtimeOrZero(io: std.Io) i128 {
    const s = std.Io.Dir.cwd().statFile(io, DEV_BUNDLE_PATH, .{}) catch return 0;
    return @intCast(s.mtime.toNanoseconds());
}

fn maybeScheduleReload(io: std.Io) void {
    if (!DEV_MODE) return;
    g_mtime_poll_counter +%= 1;
    // Poll every 16 ticks (~250ms at 60fps) — cheap, responsive enough.
    if (g_mtime_poll_counter & 0xF != 0) return;
    const mt = bundleMtimeOrZero(io);
    if (mt != 0 and mt != g_last_bundle_mtime) {
        g_last_bundle_mtime = mt;
        g_dev_reload_revision +%= 1;
        g_dev_reload.onBundleChanged();
    }
}

fn clearTreeStateForReload(host: *HostContext) void {
    // Drop the engine's reference to the current node tree BEFORE freeing any
    // memory it points into. The engine paints from g_root.children each
    // frame — leave it pointing at stale memory and we SIGSEGV on paint.
    g_root.children = &.{};

    for (g_press_expr_pool.items) |s| g_alloc.free(s);
    g_press_expr_pool.clearRetainingCapacity();

    // pending_flush queue is owned by v8_bindings_reconciler. The original
    // code skipped this on the assumption that VM tear-down would free the
    // queue — but reload only swaps the V8 Context, NOT the VM. Stale
    // batches queued by the prior bundle that survive into the new bundle's
    // eval get replayed on top of fresh React-assigned node IDs, building
    // cycles in the host tree's children map and wedging materializeChildren
    // in infinite recursion.
    v8_bindings_reconciler.clearPending();

    // Unregister every live input slot so framework/input.zig doesn't keep
    // dispatching callbacks that read into the freed Node pool.
    var slot_it = g_input_slot_by_node_id.valueIterator();
    while (slot_it.next()) |slot| input.unregister(slot.*);
    g_input_slot_by_node_id.clearRetainingCapacity();
    for (&g_node_id_by_input_slot) |*v| v.* = 0;

    var win_it = g_window_by_node_id.valueIterator();
    while (win_it.next()) |binding| {
        windows.close(host.io, binding.slot);
        if (binding.title) |title| g_alloc.free(title);
    }
    g_window_by_node_id.clearRetainingCapacity();

    // host_tree owns all tree state — destroy every Node, free children
    // lists, clear parent map + root-child list in one call. node.text
    // ownership is mixed (some g_alloc dupes, some slices into
    // framework/input.zig's buffers) so the text leaks for dev-mode
    // safety — kilobytes per reload, acceptable.
    host_tree.clearAll(host);
    g_latch_height_nodes.clearRetainingCapacity();
    g_latch_width_nodes.clearRetainingCapacity();
    g_latch_left_nodes.clearRetainingCapacity();
    g_latch_top_nodes.clearRetainingCapacity();
    g_latch_right_nodes.clearRetainingCapacity();
    g_latch_bottom_nodes.clearRetainingCapacity();
    animations.clearAll();
    latches.clearAll();
    g_window_owner_by_node_id.clearRetainingCapacity();
    g_scroll_prop_slots.clearRetainingCapacity();

    // Drop the retained 3D-geometry intern caches. The new bundle re-evals in a
    // fresh V8 context, so JS re-ships every first-per-key mesh's verts; the
    // host caches are append-only bump allocators that never evict, so without
    // this they accumulate dead geometry across reloads until they overflow and
    // SILENTLY DROP meshes (grid + buildings vanish, props survive — req_0725/
    // 0727, seen as "turn the camera after a reload and the world disappears").
    gpu.scene3dResetForReload();

    // host_tree.clearAll above already cleared the root-child list.

    // Arena holds only materializeChildren output (rebuilt every frame from
    // host_tree's maps). Safe to reset now that g_root.children no longer
    // references it.
    _ = g_arena.reset(.retain_capacity);

    g_dirty.* = true;
}

fn performReload(host: *HostContext) void {
    // Re-read the active tab's source file. Only the first tab ("main") has a
    // disk-backed source; others come from IPC pushes and have no disk file.
    if (g_active_tab != 0) return;
    const new_bundle = readBundleFromDisk(host.io) catch |e| {
        std.log.warn("[dev] bundle read failed: {}, skipping reload", .{e});
        return;
    };
    replaceActiveTabBundle(new_bundle);
    evalActiveTab(host);
    std.log.info("[dev] reloaded '{s}' ({d} bytes)", .{ tabName(g_active_tab), new_bundle.len });
}

fn applyScheduledReload(host: *HostContext) void {
    // Give the currently mounted application one synchronous checkpoint edge.
    // The callback is optional and must only copy in-process state; the policy
    // gate has already decided that this context is about to be replaced.
    _ = v8_runtime.evalScriptChecked(host, "if(typeof globalThis.__beforeDevReload==='function')globalThis.__beforeDevReload();");
    if (g_pending_push_tab) |idx| {
        g_pending_push_tab = null;
        if (idx >= g_tabs.items.len) return;
        g_active_tab = idx;
        evalActiveTab(host);
        std.log.info("[dev] applied pushed update for '{s}'", .{tabName(idx)});
        return;
    }
    performReload(host);
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
/// V8's platform is single-shot (InitializePlatform cannot run twice in a
/// process), so we keep the Isolate and Platform alive and only rebuild the
/// Context + top-level HandleScope. appInit() re-registers host funcs onto
/// the fresh context.
fn evalActiveTab(host: *HostContext) void {
    std.log.info("[dev] evalActiveTab: clearing tree", .{});
    clearTreeStateForReload(host);
    std.log.info("[dev] evalActiveTab: resetting context", .{});
    v8_runtime.resetContextForReload(host);
    std.log.info("[dev] evalActiveTab: appInit", .{});
    appInit(host);
    const tab = &g_tabs.items[g_active_tab];
    std.log.info("[dev] evalActiveTab: evalScript ({d} bytes)", .{tab.bundle.len});
    const ok = v8_runtime.evalScriptChecked(host, tab.bundle);
    if (ok) {
        // Snapshot this bundle as the rollback target for the next reload.
        if (tab.last_good) |lg| g_alloc.free(lg);
        tab.last_good = g_alloc.dupe(u8, tab.bundle) catch null;
        std.log.info("[dev] evalActiveTab: done", .{});
        return;
    }
    // New bundle threw. Tree was already cleared, so the UI is currently
    // blank. Restore the last good bundle if we have one so the user keeps
    // working instead of staring at an empty window until their next clean
    // save. If we have nothing to restore (first-ever eval failed), leave
    // the window blank and log — there's nothing better to do.
    if (tab.last_good) |lg| {
        std.log.warn("[dev] bundle failed — restoring last good ({d} bytes)", .{lg.len});
        clearTreeStateForReload(host);
        v8_runtime.resetContextForReload(host);
        appInit(host);
        _ = v8_runtime.evalScriptChecked(host, lg);
    } else {
        std.log.warn("[dev] bundle failed — no last good to restore", .{});
    }
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

fn switchToTab(host: *HostContext, idx: usize) void {
    if (idx >= g_tabs.items.len) return;
    g_active_tab = idx;
    evalActiveTab(host);
    std.log.info("[dev] active tab: '{s}'", .{tabName(idx)});
}

/// Pull any pending IPC push messages and act on them. Called each tick.
fn processIncomingPushes(host: *HostContext) void {
    while (g_dev_ipc.takeNext()) |msg| {
        switch (msg) {
            .push => |push| {
                const idx = upsertTab(push.name, push.bundle) catch |e| {
                    std.log.warn("[dev] upsertTab failed: {}", .{e});
                    continue;
                };
                // IPC and disk-watch updates share ONE policy gate. The pushed
                // bytes are retained as the latest candidate, but Ask/Off keep
                // the currently evaluated context alive until approval.
                g_pending_push_tab = idx;
                g_dev_reload_revision +%= 1;
                g_dev_reload.onBundleChanged();
            },
            .notice => |notice| {
                emitDevNotice(host, notice.json);
                g_alloc.free(notice.json);
            },
        }
    }
}

fn emitDevNotice(host: *HostContext, json: []const u8) void {
    var parsed = std.json.parseFromSlice(std.json.Value, g_alloc, json, .{}) catch |e| {
        std.log.warn("[dev] notice JSON parse failed: {}", .{e});
        return;
    };
    defer parsed.deinit();

    const canonical = std.json.Stringify.valueAlloc(g_alloc, parsed.value, .{}) catch |e| {
        std.log.warn("[dev] notice JSON stringify failed: {}", .{e});
        return;
    };
    defer g_alloc.free(canonical);

    const script = std.fmt.allocPrint(
        g_alloc,
        "(function(){{var f=globalThis.__ffiEmit;if(typeof f==='function')f('system:notification',{s});}})();",
        .{canonical},
    ) catch |e| {
        std.log.warn("[dev] notice script alloc failed: {}", .{e});
        return;
    };
    defer g_alloc.free(script);
    _ = v8_runtime.evalScriptChecked(host, script);
}

// ── init / tick ─────────────────────────────────────────────────

fn appInit(host: *HostContext) void {
    // QJS VM is already initialized by engine before this is called (engine calls
    // v8_runtime.initVM() then evalScript(js_logic)). But we need __hostFlush
    // registered BEFORE evalScript runs. Engine order matters — see below.
    //
    // We piggyback on engine's eval: we pass the bundle via AppConfig.js_logic,
    // engine evals it, hostConfig's transportFlush tries to call globalThis.__hostFlush.
    // We must register __hostFlush BEFORE the bundle evals. Since appInit runs BEFORE
    // evalScript in engine.run order (tsz convention: init → evalScript), register here.
    // EVERY V8 binding registration goes through ingredients — no
    // exceptions. Required bindings always register; opt-in bindings
    // register only when the cart's bundle ordered them. See
    // framework/v8_ingredients.zig for the contract (one row + one
    // build option + one scripts/ship grep).
    ingredients.registerAll(host);
    // process.argv/env/cwd for GPU-host carts. TUI carts already register the
    // CLI surface before eval; shipped GUI carts need the same package-argument
    // contract without pulling in Node.
    cli_bindings.registerAll();
    // __hostFlush — single registration site shared with v8_tui_app.
    // Mode was set to `.queue` in main() so per-commit payloads go into
    // the queue and the engine drains them at the right frame phase.
    v8_bindings_reconciler.register();
    windows.setJsDispatchFn(host, dispatchWindowEvent);

    // Bridge the dev-mode flag to JS so runtime/index.tsx can wrap the
    // active cart's tree with a sibling eventlog Window. Keep it small —
    // just a single boolean global; runtime checks it once at mount time.
    if (DEV_MODE) {
        v8_runtime.evalScript(host, "globalThis.__DEV_MODE = true;");
    } else {
        v8_runtime.evalScript(host, "globalThis.__DEV_MODE = false;");
    }

    // Polyfills — V8 has no setTimeout/setInterval/console.log. QJS path
    // installs an equivalent block from qjs_runtime.initVM; mirror the minimal
    // subset here so the bundle boot (React + runtime/index.tsx) succeeds.
    v8_runtime.evalScript(host,
        \\globalThis.console = {
        \\  log: function(){ var s=''; for (var i=0;i<arguments.length;i++){ if(i)s+=' '; s+=String(arguments[i]); } __hostLog(0, s); },
        \\  warn: function(){ var s=''; for (var i=0;i<arguments.length;i++){ if(i)s+=' '; s+=String(arguments[i]); } __hostLog(1, s); },
        \\  error: function(){ var s=''; for (var i=0;i<arguments.length;i++){ if(i)s+=' '; s+=String(arguments[i]); } __hostLog(2, s); },
        \\  info: function(){ var s=''; for (var i=0;i<arguments.length;i++){ if(i)s+=' '; s+=String(arguments[i]); } __hostLog(0, s); },
        \\  debug: function(){ var s=''; for (var i=0;i<arguments.length;i++){ if(i)s+=' '; s+=String(arguments[i]); } __hostLog(0, s); },
        \\};
        \\globalThis._timers = [];
        \\globalThis._timerIdNext = 1;
        \\globalThis.setTimeout = function(fn, ms) {
        \\  var id = globalThis._timerIdNext++;
        \\  globalThis._timers.push({ id: id, fn: fn, ms: ms || 0, at: Date.now() + (ms || 0), interval: false });
        \\  return id;
        \\};
        \\globalThis.setInterval = function(fn, ms) {
        \\  var id = globalThis._timerIdNext++;
        \\  globalThis._timers.push({ id: id, fn: fn, ms: ms || 16, at: Date.now() + (ms || 16), interval: true });
        \\  return id;
        \\};
        \\globalThis.clearTimeout = function(id) {
        \\  globalThis._timers = globalThis._timers.filter(function(t){ return t.id !== id; });
        \\};
        \\globalThis.clearInterval = globalThis.clearTimeout;
        \\globalThis.__jsTick = function(now) {
        \\  var ready = [];
        \\  for (var i=0; i<globalThis._timers.length; i++) {
        \\    var t = globalThis._timers[i];
        \\    if (now >= t.at) ready.push(t);
        \\  }
        \\  for (var j=0; j<ready.length; j++) {
        \\    var t = ready[j];
        \\    try { t.fn(); } catch(e) { __hostLog(2, 'timer error: ' + e); }
        \\    if (t.interval) t.at = now + t.ms;
        \\  }
        \\  var keep = [];
        \\  for (var k=0; k<globalThis._timers.length; k++) {
        \\    var t = globalThis._timers[k];
        \\    if (t.interval || now < t.at) keep.push(t);
        \\  }
        \\  globalThis._timers = keep;
        \\};
        \\globalThis.__beginJsEvent = function(){};
        \\globalThis.__endJsEvent = function(){};
        \\globalThis.process = {
        \\  get argv() { return JSON.parse(__argv()); },
        \\  env: new Proxy({}, { get: (_, k) => __env(String(k)) }),
        \\  exit: (code) => __exit(code | 0),
        \\  cwd: () => __cwd(),
        \\  platform: 'linux',
        \\};
    );

    // Persistent-store substrate for runtime/hooks/localstore. Best-effort —
    // if init fails the hooks gracefully no-op (see qjs_bindings.storeGet etc.).
    fs_mod.init(host.io, host.environ, "reactjit") catch |e| std.log.warn("fs init failed: {}", .{e});
    localstore.init(host.io) catch |e| std.log.warn("localstore init failed: {}", .{e});

    // Window-child mode: install no-op stubs for the runtime dispatch
    // globals. The cart bundle (which normally defines these in
    // runtime/index.tsx) does not load in the child process. Without
    // these stubs the framework's evalExpr("__dispatchLayout(...)") at
    // engine.zig:1208 fires a ReferenceError on the first laid-out
    // node with on_layout — V8 then enters an error state, every
    // subsequent dispatch fails, the window appears unresponsive
    // (clicks don't register, selection misroutes, etc.).
    //
    // Click events still round-trip correctly because runJsHandlerExpr
    // (engine.zig:1071) routes through the dispatch_js_event callback
    // (childDispatchEvent) — that path is independent of these globals.
    // Layout / input-change / etc. don't have a callback path yet, so
    // they're stubs here and would need their own engine callbacks to
    // round-trip back to the parent's React handlers.
    if (g_is_window_child) {
        v8_runtime.evalScript(host,
            \\globalThis.__dispatchEvent = function(){};
            \\globalThis.__dispatchLayout = function(){};
            \\globalThis.__dispatchInputChange = function(){};
            \\globalThis.__dispatchInputSubmit = function(){};
            \\globalThis.__dispatchInputFocus = function(){};
            \\globalThis.__dispatchInputBlur = function(){};
            \\globalThis.__dispatchInputKey = function(){};
            \\globalThis.__dispatchRightClick = function(){};
            \\globalThis.__beginJsEvent = function(){};
            \\globalThis.__endJsEvent = function(){};
            \\globalThis.__ffiEmit = function(){};
        );
    }
}

fn appTick(host: *HostContext, now: u32) void {
    // Bridge framework-side state.markDirty() into v8_app's g_dirty so that
    // SDL-event-driven dispatches (filedrop, router, system_signals, …) cause
    // a React re-render on the next tick. Without this, polling hooks like
    // useFileDrop never observe the new seq because the JS world is never
    // re-evaluated after the event.
    if (state.isDirty()) {
        g_dirty.* = true;
        state.clearDirty();
    }

    // Dev-mode: accept incoming IPC pushes (may switch the active tab) and
    // check the active tab's disk source for mtime-triggered reloads. Either
    // path tears down the JS world and re-evals before the rest of the frame.
    if (DEV_MODE) {
        g_dev_ipc.pollOnce(host.io);
        processIncomingPushes(host);
    }
    maybeScheduleReload(host.io);
    if (g_dev_reload.takeReload()) {
        applyScheduledReload(host);
        return;
    }

    // APPTICKSPLIT (req_1984, TEMP): the frame partition fingered `appTick` as the
    // ~260ms place cost; appTick is opaque, so split it. __jsTick fires JS timers
    // AND drains the V8 microtask queue (where React's deferred render + passive
    // effects run) — bridge time lands here. Name which sub-step burns the frame.
    const _at0 = std.Io.Clock.now(.awake, host.io).toMicroseconds();
    _ = v8_runtime.gcTakeNs(); // GCPROBE (req_1995): reset, then read after __jsTick to get GC ns during the drain
    // Fire any JS timers whose due-time has arrived. setTimeout/setInterval
    // in the bundle are implemented against this — see runtime/index.tsx.
    // This may append new batches to g_pending_flush via React commits triggered
    // from handlers that ran inside timers. Drain after.
    v8_runtime.callGlobalInt(host, "__jsTick", @intCast(now));
    const _gc_ns_jstick = v8_runtime.gcTakeNs();
    const _gc_count_jstick = v8_runtime.gcTakeCount();
    const _at1 = std.Io.Clock.now(.awake, host.io).toMicroseconds();

    // Per-tick drains for every binding domain that defines tickDrain().
    // Required bindings (core, websocket) and opt-in bindings (httpsrv,
    // wssrv, process) all flow through here. Stubs are no-ops, so this is
    // free for carts that didn't order the opt-in domains. Note: subscriber
    // callbacks fired by these drains defer through setTimeout(0) (see
    // runtime/ffi.ts), so emit-during-tick is observed by JS on the NEXT
    // __jsTick — no ordering dependency vs the call above. The bool
    // return is the vterm-drained signal the TUI shell uses to repaint
    // without polling latency; engine.run owns its own repaint cadence,
    // so the GPU shell discards it.
    _ = ingredients.tickDrain(host);
    const _at2 = std.Io.Clock.now(.awake, host.io).toMicroseconds();

    // Apply any CMD batches that accumulated during press events since last tick.
    // Must happen BEFORE rebuildTree so the tree reflects the new g_node_by_id.
    drainPendingFlushes(host);
    const _at3 = std.Io.Clock.now(.awake, host.io).toMicroseconds();
    // V23 native game camera: when a cart opts a Scene3D.Camera node into
    // native ownership, the host solves/smooths that node's camera before
    // layout/paint. Carts that never opt in stay on the declarative JS-props
    // path, and multiple native cameras each carry independent per-node state.
    var camera_it = g_node_by_id.valueIterator();
    while (camera_it.next()) |camera_node_ptr| {
        const camera_node = camera_node_ptr.*;
        if (camera_node.scene3d_camera) {
            if (game_camera.stepNode(camera_node.id, now)) |solved| {
                game_camera.writeNode(camera_node, solved);
                g_dirty.* = true;
            }
        }
    }
    // Host-side animation tick. Walks the animation registry and writes
    // current values into latches; syncLatchesToNodes then propagates
    // those into node.style. Cart-side `useHostAnimation` registers
    // animations via __anim_register / __anim_unregister.
    const _now_ms_for_anim = std.Io.Clock.now(.awake, host.io).toMilliseconds();
    animations.tickAll(_now_ms_for_anim);
    syncLatchesToNodes();
    windows.tickIndependent();
    cleanupClosedHostWindows(host);

    var _snap_us: i64 = 0;
    var _rebuild_us: i64 = 0;
    if (g_dirty.*) {
        const t0 = std.Io.Clock.now(.awake, host.io).toMicroseconds();
        snapshotRuntimeState();
        const t1 = std.Io.Clock.now(.awake, host.io).toMicroseconds();
        rebuildTree(host);
        const t2 = std.Io.Clock.now(.awake, host.io).toMicroseconds();
        layout.markLayoutDirty();
        g_dirty.* = false;
        g_scroll_prop_slots.clearRetainingCapacity();
        _snap_us = t1 - t0;
        _rebuild_us = t2 - t1;
        if (host.environ.get("REACTJIT_VERBOSE_BATCHES") != null) {
            // Count the tree size for context.
            var node_count: usize = 0;
            var kid_it = g_children_ids.valueIterator();
            while (kid_it.next()) |list| node_count += list.items.len;
            std.debug.print("[rebuild-timing] snapshot={d}us rebuildTree={d}us nodes={d} (g_node_by_id={d})\n", .{ _snap_us, _rebuild_us, node_count, g_node_by_id.count() });
        }
    }

    // APPTICKSPLIT (req_1984, TEMP): print the appTick breakdown whenever it ran
    // slow (>40ms), so a place's ~260ms gets attributed to ONE sub-step instead of
    // an opaque "appTick". jsTick includes the V8 microtask drain (React render +
    // passive effects). dirty = snapshotRuntimeState + rebuildTree (the host tree
    // rebuild). Units: ms.
    const _at4 = std.Io.Clock.now(.awake, host.io).toMicroseconds();
    const _jstick_ms = @as(f64, @floatFromInt(_at1 - _at0)) / 1000.0;
    const _drain_ms = @as(f64, @floatFromInt(_at2 - _at1)) / 1000.0;
    const _flush_ms = @as(f64, @floatFromInt(_at3 - _at2)) / 1000.0;
    const _total_ms = @as(f64, @floatFromInt(_at4 - _at0)) / 1000.0;
    const _gc_ms_jstick = @as(f64, @floatFromInt(_gc_ns_jstick)) / 1_000_000.0;
    if (_total_ms > 40.0) {
        std.debug.print("[apptick-split] total={d:.1}ms | jsTick(+microtasks)={d:.1} (of which GC={d:.1}ms x{d}) tickDrain={d:.1} drainFlush={d:.1} dirty(snap={d:.1}+rebuild={d:.1})\n", .{ _total_ms, _jstick_ms, _gc_ms_jstick, _gc_count_jstick, _drain_ms, _flush_ms, @as(f64, @floatFromInt(_snap_us)) / 1000.0, @as(f64, @floatFromInt(_rebuild_us)) / 1000.0 });
    }
}

fn childTitle(environ: *const std.process.Environ.Map) [*:0]const u8 {
    if (environ.get("ZIGOS_WINDOW_TITLE")) |title| {
        const owned = g_alloc.dupeZ(u8, title) catch return "Window";
        return owned.ptr;
    }
    return "Window";
}

fn childInit(host: *HostContext) void {
    // Install no-op stubs for the runtime dispatch globals. The cart
    // bundle (runtime/index.tsx) defines these in the main process but
    // never loads in the child — without these stubs the framework's
    // evalExpr("__dispatchLayout(...)") at engine.zig:1208 fires a
    // ReferenceError on the first laid-out node with on_layout, V8
    // enters an error state, and subsequent dispatches all fail
    // (clicks unrouted, selection misroutes, etc.). The earlier
    // attempt to install these in appInit() never ran for child
    // windows because childInit() — not appInit() — is the engine's
    // config.init for the child branch.
    //
    // Click events still round-trip correctly because runJsHandlerExpr
    // (engine.zig:1071) goes through the dispatch_js_event callback
    // (childDispatchEvent) — that path is independent of these globals.
    v8_runtime.evalScript(host,
        \\globalThis.__dispatchEvent = function(){};
        \\globalThis.__dispatchLayout = function(){};
        \\globalThis.__dispatchInputChange = function(){};
        \\globalThis.__dispatchInputSubmit = function(){};
        \\globalThis.__dispatchInputFocus = function(){};
        \\globalThis.__dispatchInputBlur = function(){};
        \\globalThis.__dispatchInputKey = function(){};
        \\globalThis.__dispatchRightClick = function(){};
        \\globalThis.__beginJsEvent = function(){};
        \\globalThis.__endJsEvent = function(){};
        \\globalThis.__ffiEmit = function(){};
    );

    const port_s = host.environ.get("ZIGOS_IPC_PORT") orelse return;
    const port = std.fmt.parseInt(u16, port_s, 10) catch return;
    std.debug.print("[window-child] init port={d} window_id={d}\n", .{ port, g_child_window_id });
    g_child_client = ipc.Client.connect(g_alloc, host.io, port) catch |err| {
        std.debug.print("[window-child] IPC connect failed: {}\n", .{err});
        return;
    };
    if (g_child_client) |*client| {
        _ = client.sendLine("{\"type\":\"ready\"}");
    }
    if (host.environ.get("ZIGOS_WINDOW_AUTO_DISMISS_MS")) |dismiss_s| {
        g_child_auto_dismiss_ms = std.fmt.parseInt(u32, dismiss_s, 10) catch 0;
    }
    g_child_started_ms = std.Io.Clock.now(.awake, host.io).toMilliseconds();
}

fn childDispatchEvent(id: u32, handler: []const u8) void {
    var client = &(g_child_client orelse return);
    var line: std.ArrayList(u8) = .empty;
    defer line.deinit(g_alloc);
    var print_buf: [96]u8 = undefined;
    const rendered = std.fmt.bufPrint(&print_buf, "{{\"type\":\"event\",\"targetId\":{d},\"handler\":", .{id}) catch return;
    line.appendSlice(g_alloc, rendered) catch return;
    writeJsonString(&line, handler) catch return;
    line.appendSlice(g_alloc, "}") catch return;
    _ = client.sendLine(line.items);
}

fn childApplyMessage(host: *HostContext, line: []const u8) void {
    // Per-message recv/apply lines gated behind ZIGOS_TRACE_IPC=1.
    const trace = blk: {
        const env = host.environ.get("ZIGOS_TRACE_IPC") orelse break :blk false;
        break :blk env.len > 0 and env[0] != '0';
    };
    if (trace) std.debug.print("[window-child] recv bytes={d} {s}\n", .{ line.len, line });
    const parsed = std.json.parseFromSlice(std.json.Value, g_alloc, line, .{}) catch return;
    defer parsed.deinit();
    if (parsed.value != .object) return;
    const typ_v = parsed.value.object.get("type") orelse return;
    if (typ_v != .string) return;
    if (std.mem.eql(u8, typ_v.string, "quit")) {
        std.process.exit(0);
    }
    if (!std.mem.eql(u8, typ_v.string, "mutations") and !std.mem.eql(u8, typ_v.string, "init")) return;
    const commands_v = parsed.value.object.get("commands") orelse return;
    if (commands_v != .array) return;
    if (trace) std.debug.print("[window-child] apply commands={d}\n", .{commands_v.array.items.len});
    for (commands_v.array.items) |cmd| host_tree.applyCommand(host, host.io, host.environ, cmd) catch |err| {
        std.debug.print("[window-child] apply error: {s}\n", .{@errorName(err)});
    };
}

fn childTick(host: *HostContext, _: u32) void {
    var client = &(g_child_client orelse return);
    // Drain the WHOLE socket backlog this tick. ipc.Client.poll() is
    // capped at MAX_MESSAGES_PER_POLL (32) per call to keep msg_out small,
    // but a fat initial flush can be ~3000 messages. Without this loop,
    // the window painted gradually over ~88 ticks (~1.5s @ 60fps) — long
    // enough to look "broken" before it filled in. Looping until poll
    // returns nothing makes the whole tree land in a single frame.
    while (true) {
        const messages = client.poll();
        if (messages.len == 0) break;
        for (messages) |msg| childApplyMessage(host, msg.data);
    }
    if (g_child_auto_dismiss_ms > 0 and g_child_started_ms > 0) {
        const now_ms = std.Io.Clock.now(.awake, host.io).toMilliseconds();
        if (now_ms - g_child_started_ms >= @as(i64, @intCast(g_child_auto_dismiss_ms))) {
            std.process.exit(0);
        }
    }

    if (g_dirty.*) {
        snapshotRuntimeState();
        rebuildTree(host);
        std.debug.print("[window-child] rebuild root_children={d} rendered={d} nodes={d}\n", .{
            g_root_child_ids.items.len,
            g_root.children.len,
            g_node_by_id.count(),
        });
        layout.markLayoutDirty();
        g_dirty.* = false;
        g_scroll_prop_slots.clearRetainingCapacity();
    }
}

fn childShutdown(_: *HostContext) void {
    if (g_child_client) |*client| {
        var line: std.ArrayList(u8) = .empty;
        defer line.deinit(g_alloc);
        format_line: {
            var print_buf: [128]u8 = undefined;
            const rendered = std.fmt.bufPrint(&print_buf, "{{\"type\":\"windowEvent\",\"targetId\":{d},\"handler\":\"onClose\"}}", .{g_child_window_id}) catch break :format_line;
            line.appendSlice(g_alloc, rendered) catch {};
        }
        if (line.items.len > 0) _ = client.sendLine(line.items);
        client.close();
        g_child_client = null;
    }
}

fn appShutdown(host: *HostContext) void {
    var win_it = g_window_by_node_id.valueIterator();
    while (win_it.next()) |binding| {
        if (binding.title) |title| g_alloc.free(title);
    }
    g_window_by_node_id.clearRetainingCapacity();
    localstore.deinit(host.io);
    fs_mod.deinit(host.io);
}

// ── Headless shell — TUI/ANSI main body ─────────────────────────────
//
// Used when HEADLESS=true (build_options.has_gpu=false). Mirrors
// v8_tui_app's main: register cli bindings, the INGREDIENTS catalog
// (which stubs `core` + `window` for us via the same has_gpu gate),
// reconciler, worker_bindings, and host_window. Then eval the bundle
// and return. There is no engine.run; the cart's React tree drives
// paint through tui/host.ts's ANSI walker, pumped from JS via
// __runEventLoop in tui/v8-preamble.js.
//
// Lives inline in v8_app.zig (not a separate file) so the single
// entry-point goal is literal: one main, one binary, two substrates.

fn hostTickDrain(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const drained = ingredients.tickDrain(host);
    // SDL3 event pump + paint for any <Window> nodes the cart opened
    // — no-op when has_window is false (stub above).
    host_window.tickDrain(host);
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), if (drained) @as(f64, 1) else @as(f64, 0)));
}

// PANELWIN-0628: the cart polls this to re-dock its rail when the user closes
// the pop-out via the OS window button (the <Window> node is still mounted, but
// panel_window.isOpen() has flipped). Returns 1 = open, 0 = closed.
fn hostPanelWindowStatus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), if (panel_window.isOpen()) @as(f64, 1) else @as(f64, 0)));
}

fn runHeadless(host: *HostContext) !void {
    var gpa = std.heap.DebugAllocator(.{}){};
    defer _ = gpa.deinit();
    const alloc = gpa.allocator();

    // process.argv[0] = bundle name; argv[1..] = the user's args.
    const raw_argv = try host.args.toSlice(host.arena.allocator());
    const script_argv = try alloc.alloc([]const u8, raw_argv.len);
    defer alloc.free(script_argv);
    script_argv[0] = if (@hasDecl(build_options, "app_name")) build_options.app_name else "v8_app";
    for (raw_argv[1..], 1..) |a, i| script_argv[i] = a;

    v8_runtime.initVM(host);
    defer v8_runtime.teardownVM();

    cli_bindings.setArgv(@constCast(script_argv));
    cli_bindings.registerAll();
    cli_bindings.registerTerminal();
    cli_bindings.installSignalHandlers();

    // INGREDIENTS catalog — same source of truth the GPU shell uses.
    // Stubs `core` + `window` because has_gpu=false; the rest of the
    // opt-in bindings (pg/embed/fs/process/etc.) compile in based on
    // the cart's metafile gate, same as the GPU shell.
    ingredients.registerAll(host);

    // host_tree owns the React tree state across both shells. Initialize
    // its hashmaps BEFORE the reconciler registers __hostFlush — in
    // sync mode (TUI default) every mutation batch lands directly in
    // host_tree.applyCommandBatch via __hostFlush, and walking
    // uninitialized maps SEGVs at the first batch. The GPU shell does
    // this same init at the top of its appInit/main; the headless body
    // needs it too. The TUI's ANSI walker (tui/host.ts) consumes the
    // React Instance tree directly and ignores host_tree's contents,
    // but the writes still have to land somewhere allocated.
    host_tree.init(std.heap.c_allocator);

    // __hostFlush registration. Mode defaults to .sync (TUI has no
    // Zig-side paint loop to defer to); applyCommandBatch on the
    // host_tree side lands every mutation inline.
    v8_bindings_reconciler.register();

    // Assistant SDK bindings — registered directly so useAssistant
    // works in TUI carts even when has_sdk is off (in the GPU path
    // worker_bindings rides on v8_bindings_sdk.registerSdk).
    worker_bindings.register();

    // host_window — opt-in <Window>/<Notification> support for TUI
    // carts that want to paint a real SDL3 surface from inside an
    // otherwise-ANSI binary. No-op when has_window=false.
    try host_window.init(host, std.heap.c_allocator);
    defer host_window.deinit(host.io);
    host_window.register();

    v8_runtime.registerHostFn("__tickDrain", hostTickDrain);
    v8_runtime.registerHostFn("__panel_window_status", hostPanelWindowStatus);

    // Same console + process shim v8_cli installs. The cart bundle
    // then layers tui/v8-preamble.js on top via its first line.
    v8_runtime.evalScript(host,
        \\globalThis.console = {
        \\  log:   (...args) => __writeStdout(args.map(fmtArg).join(' ') + '\n'),
        \\  info:  (...args) => __writeStdout(args.map(fmtArg).join(' ') + '\n'),
        \\  warn:  (...args) => __writeStderr(args.map(fmtArg).join(' ') + '\n'),
        \\  error: (...args) => __writeStderr(args.map(fmtArg).join(' ') + '\n'),
        \\};
        \\function fmtArg(a) {
        \\  if (typeof a === 'string') return a;
        \\  if (a === null) return 'null';
        \\  if (a === undefined) return 'undefined';
        \\  if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
        \\  return String(a);
        \\}
        \\globalThis.process = {
        \\  get argv() { return JSON.parse(__argv()); },
        \\  env: new Proxy({}, { get: (_, k) => __env(String(k)) }),
        \\  exit: (code) => __exit(code | 0),
        \\  cwd: () => __cwd(),
        \\  platform: 'linux',
        \\};
    );

    const ok = v8_runtime.evalScriptChecked(host, BUNDLE_BYTES);
    if (!ok) return error.ScriptEvaluationFailed;
}

// ── main ────────────────────────────────────────────────────────

pub fn main(init: std.process.Init) !void {
    var host = HostContext.fromInit(init);
    if (IS_LIB) return;

    // A dev host launched by `rjit dev` must not outlive its supervisor. The
    // supervisor's signal handlers only fire on a polite death; PR_SET_PDEATHSIG
    // fires on every death, including the SIGKILLs and crashes that produced the
    // orphan hosts in req_4074/req_4109. No-op for a shipped cart.
    _ = proc_lifetime.dieWithParentOrExit(host.environ);

    // Bring up the observability bus before anything else so that boot-time
    // events (window-child detection, dev-mode bundle read, IPC start) all
    // land in the log instead of vanishing pre-bus. Best-effort — failure
    // (e.g. no $HOME) leaves emit() as a no-op and the runtime keeps going.
    event_bus.init();
    diag_log.init(host.environ);
    var diag_sink = diag_log.open(host.io, host.environ);
    defer {
        _ = diag_sink.close(host.io);
        diag_log.deinit();
        event_bus.deinit();
    }

    // Headless (TUI) branch — bypass the entire GPU init + engine.run
    // path. Substrate dispatched at compile time via the has_gpu
    // build option so each binary only carries the substrate it
    // shipped with.
    if (HEADLESS) {
        var terminal_host: cli_bindings.TerminalHost = undefined;
        try terminal_host.init(host);
        defer terminal_host.deinit();
        try runHeadless(&terminal_host.host);
        return;
    }

    var gpa = std.heap.DebugAllocator(.{}){};
    g_alloc = gpa.allocator();
    g_arena = std.heap.ArenaAllocator.init(g_alloc);

    // host_tree owns the React tree state across both shells. Initialize
    // it with our allocator, then install local pointer aliases so the
    // existing `g_node_by_id.get(id)` / `g_children_ids.getPtr(pid)` /
    // `g_root_child_ids.items` syntax keeps working without rewriting
    // hundreds of paint / layout / cleanup call sites. Hooks (style
    // parsing, handler flags, host-window opens, child-window intercept)
    // are installed AFTER init so they're in place before the first
    // __hostFlush could fire.
    host_tree.init(g_alloc);
    g_node_by_id = host_tree.nodesPtr();
    g_children_ids = host_tree.childrenIdsPtr();
    g_parent_id = host_tree.parentIdPtr();
    g_root_child_ids = host_tree.rootChildIdsPtr();
    g_dirty = host_tree.dirtyPtr();
    installHostTreeHooks();
    v8_bindings_reconciler.setMode(.queue);

    g_latch_height_nodes = std.AutoHashMap(u32, void).init(g_alloc);
    g_latch_width_nodes = std.AutoHashMap(u32, void).init(g_alloc);
    g_latch_left_nodes = std.AutoHashMap(u32, void).init(g_alloc);
    g_latch_top_nodes = std.AutoHashMap(u32, void).init(g_alloc);
    g_latch_right_nodes = std.AutoHashMap(u32, void).init(g_alloc);
    g_latch_bottom_nodes = std.AutoHashMap(u32, void).init(g_alloc);
    g_window_owner_by_node_id = std.AutoHashMap(u32, u32).init(g_alloc);
    g_window_by_node_id = std.AutoHashMap(u32, WindowBinding).init(g_alloc);
    g_panel_arena = std.heap.ArenaAllocator.init(g_alloc); // PANELWIN-0628
    g_scroll_prop_slots = std.AutoHashMap(u32, void).init(g_alloc);
    g_input_slot_by_node_id = std.AutoHashMap(u32, u8).init(g_alloc);
    g_menu_items_by_node = std.AutoHashMap(u32, []context_menu.MenuItem).init(g_alloc);
    g_menu_labels_by_node = std.AutoHashMap(u32, [][]u8).init(g_alloc);
    g_inline_glyphs_by_node = std.AutoHashMap(u32, InlineGlyphAlloc).init(g_alloc);

    g_root = .{};

    // process.argv for GPU-host carts. The headless/TUI path already installs
    // this before eval; the GUI shell needs the same argv contract so shipped
    // carts can receive package paths and other runtime arguments.
    const raw_argv = try host.args.toSlice(host.arena.allocator());
    const script_argv = try g_alloc.alloc([]const u8, raw_argv.len);
    script_argv[0] = if (@hasDecl(build_options, "app_name")) build_options.app_name else "v8_app";
    for (raw_argv[1..], 1..) |a, i| script_argv[i] = a;
    cli_bindings.setArgv(@constCast(script_argv));

    if (host.environ.get("ZIGOS_WINDOW_CHILD") != null) {
        g_is_window_child = true;
        if (host.environ.get("ZIGOS_WINDOW_ID")) |id_s| {
            g_child_window_id = std.fmt.parseInt(u32, id_s, 10) catch 0;
        }
        try engine.run(.{
            .host = &host,
            .diag_sink = &diag_sink,
            .title = childTitle(host.environ),
            .root = &g_root,
            .js_logic = "",
            .lua_logic = "",
            .init = childInit,
            .tick = childTick,
            .shutdown = childShutdown,
            .borderless = host.environ.get("ZIGOS_WINDOW_BORDERLESS") != null,
            .always_on_top = host.environ.get("ZIGOS_WINDOW_ALWAYS_ON_TOP") != null,
            .not_focusable = host.environ.get("ZIGOS_WINDOW_NOT_FOCUSABLE") != null,
            .dispatch_js_event = childDispatchEvent,
            .set_canvas_node_position = setCanvasNodePosition,
        });
        return;
    }

    const initial_bundle: []const u8 = if (DEV_MODE) blk: {
        g_dev_bundle_buf = readBundleFromDisk(host.io) catch |e| {
            std.log.err("[dev] initial bundle.js read failed: {}", .{e});
            return e;
        };
        g_last_bundle_mtime = bundleMtimeOrZero(host.io);

        // Seed the tab registry with the disk-backed "main" tab. Pre-seed
        // last_good with a dupe of the boot bundle so the first post-boot
        // reload can roll back if it throws (the boot bundle is the baseline
        // known-working state — engine.run will eval it immediately after we
        // return from main()'s setup).
        const name_copy = try g_alloc.dupe(u8, "main");
        const last_good_seed = try g_alloc.dupe(u8, g_dev_bundle_buf);
        try g_tabs.append(g_alloc, .{
            .name = name_copy,
            .bundle = g_dev_bundle_buf,
            .last_good = last_good_seed,
        });
        g_active_tab = 0;

        // dev_ipc must allocate push buffers with the SAME allocator qjs_app
        // uses when it later frees them via upsertTab. Cross-allocator free is
        // UB — this caller caused the SIGSEGV on re-push (2026-04-19 fix).
        g_dev_ipc = dev_ipc.Server.init(g_alloc, DEV_BUILD_ID);
        g_dev_ipc.start(host.io);

        std.log.info("[dev] dev mode — watching {s} ({d} bytes), IPC @ {s}", .{ DEV_BUNDLE_PATH, g_dev_bundle_buf.len, dev_ipc.SOCKET_PATH });
        break :blk g_dev_bundle_buf;
    } else BUNDLE_BYTES;
    defer if (DEV_MODE) g_dev_ipc.deinit(host.io);

    try engine.run(.{
        .host = &host,
        .diag_sink = &diag_sink,
        .title = WINDOW_TITLE,
        .root = &g_root,
        .js_logic = initial_bundle,
        .lua_logic = "",
        .init = appInit,
        .tick = appTick,
        .shutdown = appShutdown,
        // In dev mode, strip the OS titlebar so our tab chrome sits in the
        // titlebar position. Empty chrome area gets window_drag; tab buttons
        // with on_press override drag so clicks still switch tabs.
        .borderless = BORDERLESS_MODE,
        .set_canvas_node_position = setCanvasNodePosition,
    });
}
