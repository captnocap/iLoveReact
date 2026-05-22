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

const layout = @import("framework/layout.zig");
const Node = layout.Node;
const Style = layout.Style;
const Color = layout.Color;
// Tree state lives in framework/host_tree.zig — single owner across
// both shells. v8_app installs hooks (apply_props, apply_handler_flags,
// open_host_window, etc.) and consumes the tree via host_tree's
// accessors. Phase 3 of the host_tree.zig migration plan: complete.
const transition_mod = @import("framework/gpu/transition.zig");
const easing_mod = @import("framework/math/easing.zig");
const effect_ctx = @import("framework/gpu/effects_ctx.zig");
const input = @import("framework/primitive/input.zig");
const state = @import("framework/state/dirty.zig");
const events = @import("framework/events.zig");
const context_menu = @import("framework/primitive/context_menu.zig");
const engine = if (IS_LIB) struct {} else @import("framework/engine.zig");
const gpu = if (IS_LIB) struct {
    pub fn frameCounter() u64 {
        return 0;
    }
} else @import("framework/gpu/gpu.zig");
const latches = @import("framework/state/latches.zig");
const animations = @import("framework/gpu/animations.zig");
const paintable = @import("framework/gpu/paintable.zig");
const windows = @import("framework/primitive/windows.zig");
const ipc = @import("framework/net/ipc.zig");
const prepared_input = @import("framework/state/prepared_input.zig");
const v8_runtime = @import("framework/v8_runtime.zig");
const v8_bindings_core = @import("framework/v8_bindings_core.zig");
const v8_bindings_reconciler = @import("framework/v8_bindings_reconciler.zig");
const host_tree = @import("framework/host_tree.zig");
const v8_bindings_eventbus = @import("framework/v8_bindings_eventbus.zig");
const v8_bindings_ifttt = @import("framework/v8_bindings_ifttt.zig");
const v8_bindings_env = @import("framework/v8_bindings_env.zig");
const v8_bindings_window = @import("framework/v8_bindings_window.zig");
const v8_bindings_inspector = @import("framework/v8_bindings_inspector.zig");
const event_bus = @import("framework/diag/event_bus.zig");

// Override std.log so every framework `std.log.info/warn/err` call routes
// through the bus. Single chokepoint; no call-site rewrites needed. Errors
// and warns ALSO go to stderr (preserved fallthrough); info/debug land on
// the bus only. The terminal becomes quiet for normal operation.
pub const std_options: std.Options = .{
    .logFn = event_bus.fromStdLog,
};

// Conditional @import — when has_X is false the binding file is NEVER
// parsed, so its string literals (host-fn names like "getFps", "__zig_call")
// don't bleed into .rodata/DWARF of the final binary. The naive
// `_real = @import(...)` / `if cond _real else stub` shape compiles the
// file unconditionally and leaks the host-fn strings into the binary
// even when the gate is off; the `if cond @import(...) else struct{...}`
// shape below is the load-bearing trick.
//
// `@import` requires a string literal in Zig 0.15 — we can't fold it into
// a helper that takes the path as a parameter. What we CAN factor out is
// the `@hasDecl(build_options, "has_X") and build_options.has_X` ladder.
// That goes through `enabledFor`, killing the redundant `HAS_X` consts.
inline fn enabledFor(comptime opt_name: []const u8) bool {
    return @hasDecl(build_options, "has_" ++ opt_name) and @field(build_options, "has_" ++ opt_name);
}

const v8_bindings_fs = if (enabledFor("fs")) @import("framework/v8_bindings_fs.zig") else struct {
    pub fn registerFs(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_websocket = if (enabledFor("websocket")) @import("framework/v8_bindings_websocket.zig") else struct {
    pub fn registerWebSocket(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_telemetry = if (enabledFor("telemetry")) @import("framework/v8_bindings_telemetry.zig") else struct {
    pub fn registerTelemetry(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_zigcall = if (enabledFor("zigcall")) @import("framework/v8_bindings_zigcall.zig") else struct {
    pub fn registerZigCall(_: anytype) void {}
    pub fn registerZigCallList(_: anytype) void {}
    pub fn tickDrain() void {}
};

// ── INGREDIENTS — opt-in V8 binding surface per cart ────────────────
//
// The contract: a cart's bundle is the order ticket. The kitchen (this file
// + scripts/ship + build.zig) only puts an ingredient in the burrito if the
// ticket asks for it. Carts that don't order an ingredient never see its
// host-fn surface on globalThis.
//
// ⚠️ Every new V8 binding that registers host fns goes HERE. Three pieces,
// all required — forgetting any one is how allergens get into burritos:
//
//   1. One row in INGREDIENTS below (grep_prefix / reg_fn / mod)
//   2. A `has-<name>` option in build.zig — referenced by build_options.has_X
//   3. A `grep -qE '<grep_prefix>'` in scripts/ship that flips -Dhas-X=true
//
// The kitchen story: scripts/ship reads the cart's bundle, looks for the
// grep_prefix (e.g. "__proc_"), and if found passes `-Dhas-process=true` to
// zig build. build.zig exposes that as `build_options.has_process`. The
// import below resolves to the real module when the option is true, or to
// a stub with matching public API when false. appInit and appTick iterate
// INGREDIENTS uniformly — register the real impl or the no-op stub.
//
// What happens if you skip any step:
//   - Skip step 1 → binding never gets registered. Cart's hook silently
//     no-ops on the cart that imports it. Visible failure for that cart's
//     author. Other carts unaffected.
//   - Skip step 2 → comptime fails. Build won't compile. Self-correcting.
//   - Skip step 3 → binding never gets registered (option defaults false).
//     Same visible failure as skip step 1.
//
// What previously happened when this contract DIDN'T exist (2026-04-25):
// worker 571f added httpsrv/wssrv/process bindings and called register()
// for all three unconditionally in appInit. Every cart in the repo paid
// the cost of registering host-fn surface they never asked for. The extra
// V8 Function-table load corrupted Function::Call such that callGlobalInt
// from C++ threw RangeError on every cart — even carts that never imported
// useHost. Three hours of debugging burritos that had ingredients nobody
// ordered. Don't re-litigate. Add the row.
const Ingredient = struct {
    name: []const u8,
    /// `true` = framework-essential, registered on every cart. `grep_prefix` ignored.
    /// `false` = opt-in; only registered when scripts/ship sees `grep_prefix` in the bundle.
    required: bool,
    /// Bundle-grep token — must match the host-fn prefix that the corresponding
    /// hook calls via callHost(). Empty when required=true.
    grep_prefix: []const u8,
    /// Public name of the register function inside `mod`.
    reg_fn: []const u8,
    /// Module to register from — already gated to a stub if `required=false`
    /// and the cart didn't ask for it (see comptime imports above).
    mod: type,
};

const v8_bindings_httpserver = if (enabledFor("httpsrv")) @import("framework/v8_bindings_httpserver.zig") else struct {
    pub fn registerHttpServer(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_wsserver = if (enabledFor("wssrv")) @import("framework/v8_bindings_wsserver.zig") else struct {
    pub fn registerWsServer(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_process = if (enabledFor("process")) @import("framework/v8_bindings_process.zig") else struct {
    pub fn registerProcess(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_net = if (enabledFor("net")) @import("framework/v8_bindings_net.zig") else struct {
    pub fn registerNet(_: anytype) void {}
    pub fn tickDrain() void {}
};
// Source RCON + A2S Source Query — gated alongside has_net since they sit on
// top of net/tcp.zig and net/udp.zig and ride the useConnection trichotomy.
// Any cart shipping `useConnection({kind:'rcon'|'a2s'})` already trips
// has-net via the metafile gate, so no separate ingredient flag is needed.
const v8_bindings_gameserver = if (enabledFor("net")) @import("framework/v8_bindings_gameserver.zig") else struct {
    pub fn registerGameServer(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_tor = if (enabledFor("tor")) @import("framework/v8_bindings_tor.zig") else struct {
    pub fn registerTor(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_privacy = if (enabledFor("privacy")) @import("framework/v8_bindings_privacy.zig") else struct {
    pub fn registerPrivacy(_: anytype) void {}
};
const v8_bindings_sdk = if (enabledFor("sdk")) @import("framework/v8_bindings_sdk.zig") else struct {
    pub fn registerSdk(_: anytype) void {}
};
const v8_bindings_voice = if (enabledFor("voice")) @import("framework/v8_bindings_voice.zig") else struct {
    pub fn registerVoice(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_whisper = if (enabledFor("whisper")) @import("framework/v8_bindings_whisper.zig") else struct {
    pub fn registerWhisper(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_onnx = if (enabledFor("onnx")) @import("framework/v8_bindings_onnx.zig") else struct {
    pub fn registerOnnx(_: anytype) void {}
};
const v8_bindings_pg = if (enabledFor("pg")) @import("framework/v8_bindings_pg.zig") else struct {
    pub fn registerPg(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_embed = if (enabledFor("embed")) @import("framework/v8_bindings_embed.zig") else struct {
    pub fn registerEmbed(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_video = if (enabledFor("video")) @import("framework/v8_bindings_video.zig") else struct {
    pub fn registerVideo(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_audio = if (enabledFor("audio")) @import("framework/v8_bindings_audio.zig") else struct {
    pub fn registerAudio(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_midi = if (enabledFor("midi")) @import("framework/v8_bindings_midi.zig") else struct {
    pub fn registerMidi(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_vterm = if (enabledFor("terminal")) @import("framework/v8_bindings_vterm.zig") else struct {
    pub fn registerVterm(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_doom = if (enabledFor("doom")) @import("framework/v8_bindings_doom.zig") else struct {
    pub fn registerDoom(_: anytype) void {}
    pub fn tickDrain() void {}
};
// Paintable mask textures — opt-in via the `__paintable_` host fn prefix.
// Carts that import usePaintable() reference __paintable_circle etc., the
// metafile-gate sees the prefix, scripts/ship flips -Dhas-paintable=true.
const v8_bindings_paintable = if (enabledFor("paintable")) @import("framework/v8_bindings_paintable.zig") else struct {
    pub fn registerPaintable(_: anytype) void {}
};

const INGREDIENTS = [_]Ingredient{
    // Framework-essential (always-on). These bindings expose host fns the
    // React renderer / runtime depend on unconditionally — __hostFlush,
    // __fs_*, __zigCall, telemetry counters, etc. They're "in every burrito"
    // because no cart can run without them. New required bindings still go
    // here (do NOT bypass by hardcoding a register call elsewhere in appInit).
    // Core is the only truly framework-internal binding — its host fns
    // (__hostFlush/__setState/__markDirty/getMouse*/isKeyDown/...) are called
    // by runtime/index.tsx + runtime/primitives.tsx which every cart bundles
    // unconditionally as React reconciler scaffolding. So gating it on a
    // hook-file presence is degenerate; it's always shipped because the
    // framework boilerplate in the bundle always references it.
    .{ .name = "core", .required = true, .grep_prefix = "", .reg_fn = "registerCore", .mod = v8_bindings_core },
    // Observability bus — always-on. The whole point is that every cart
    // gets free crash/overflow/perf diagnostics with no opt-in. Cost is
    // five host fns and a circular ring; nothing the cart has to import.
    .{ .name = "eventbus", .required = true, .grep_prefix = "", .reg_fn = "registerEventBus", .mod = v8_bindings_eventbus },
    // useIFTTT registry + timer wheel — always-on. runtime/index.tsx
    // unconditionally requires useIFTTT.ts (it's the system-signal sink),
    // so every cart pulls the wire/timer host fns. Source-gating this is
    // degenerate for the same reason core is.
    .{ .name = "ifttt", .required = true, .grep_prefix = "", .reg_fn = "registerIFTTT", .mod = v8_bindings_ifttt },
    .{ .name = "env", .required = true, .grep_prefix = "", .reg_fn = "registerEnv", .mod = v8_bindings_env },
    .{ .name = "window", .required = true, .grep_prefix = "", .reg_fn = "registerWindow", .mod = v8_bindings_window },
    .{ .name = "inspector", .required = true, .grep_prefix = "", .reg_fn = "registerInspector", .mod = v8_bindings_inspector },
    // Everything below is source-gated: scripts/ship reads the esbuild
    // metafile and only flips the matching -Dhas-X=true if a JS file
    // that calls into the binding is actually shipped.
    .{ .name = "fs", .required = false, .grep_prefix = "__fs_", .reg_fn = "registerFs", .mod = v8_bindings_fs },
    .{ .name = "websocket", .required = false, .grep_prefix = "__ws_", .reg_fn = "registerWebSocket", .mod = v8_bindings_websocket },
    .{ .name = "telemetry", .required = false, .grep_prefix = "__tel_", .reg_fn = "registerTelemetry", .mod = v8_bindings_telemetry },
    .{ .name = "zigcall", .required = false, .grep_prefix = "__zig_call", .reg_fn = "registerZigCall", .mod = v8_bindings_zigcall },
    .{ .name = "zigcall_list", .required = false, .grep_prefix = "__zig_call", .reg_fn = "registerZigCallList", .mod = v8_bindings_zigcall },
    // Opt-in per cart — scripts/ship grep flips -Dhas-X when the bundle
    // references the matching prefix. Carts that don't order them get a
    // comptime stub (no host-fn registration, no tickDrain).
    .{ .name = "process", .required = false, .grep_prefix = "__proc_", .reg_fn = "registerProcess", .mod = v8_bindings_process },
    .{ .name = "httpsrv", .required = false, .grep_prefix = "__httpsrv_", .reg_fn = "registerHttpServer", .mod = v8_bindings_httpserver },
    .{ .name = "wssrv", .required = false, .grep_prefix = "__wssrv_", .reg_fn = "registerWsServer", .mod = v8_bindings_wsserver },
    .{ .name = "net", .required = false, .grep_prefix = "__tcp_", .reg_fn = "registerNet", .mod = v8_bindings_net },
    .{ .name = "gameserver", .required = false, .grep_prefix = "__rcon_", .reg_fn = "registerGameServer", .mod = v8_bindings_gameserver },
    .{ .name = "tor", .required = false, .grep_prefix = "__tor_", .reg_fn = "registerTor", .mod = v8_bindings_tor },
    .{ .name = "privacy", .required = false, .grep_prefix = "__priv_", .reg_fn = "registerPrivacy", .mod = v8_bindings_privacy },
    .{ .name = "sdk", .required = false, .grep_prefix = "__http_request_", .reg_fn = "registerSdk", .mod = v8_bindings_sdk },
    .{ .name = "voice", .required = false, .grep_prefix = "__voice_", .reg_fn = "registerVoice", .mod = v8_bindings_voice },
    .{ .name = "whisper", .required = false, .grep_prefix = "__whisper_", .reg_fn = "registerWhisper", .mod = v8_bindings_whisper },
    .{ .name = "onnx", .required = false, .grep_prefix = "__onnx_", .reg_fn = "registerOnnx", .mod = v8_bindings_onnx },
    .{ .name = "pg", .required = false, .grep_prefix = "__pg_", .reg_fn = "registerPg", .mod = v8_bindings_pg },
    .{ .name = "embed", .required = false, .grep_prefix = "__embed_", .reg_fn = "registerEmbed", .mod = v8_bindings_embed },
    .{ .name = "video", .required = false, .grep_prefix = "__video_", .reg_fn = "registerVideo", .mod = v8_bindings_video },
    .{ .name = "audio", .required = false, .grep_prefix = "__audio_", .reg_fn = "registerAudio", .mod = v8_bindings_audio },
    .{ .name = "midi", .required = false, .grep_prefix = "__midi_", .reg_fn = "registerMidi", .mod = v8_bindings_midi },
    .{ .name = "vterm", .required = false, .grep_prefix = "__vterm_", .reg_fn = "registerVterm", .mod = v8_bindings_vterm },
    .{ .name = "doom", .required = false, .grep_prefix = "__doom_", .reg_fn = "registerDoom", .mod = v8_bindings_doom },
    .{ .name = "paintable", .required = false, .grep_prefix = "__paintable_", .reg_fn = "registerPaintable", .mod = v8_bindings_paintable },
};
const fs_mod = @import("framework/fs/fs.zig");
const localstore = @import("framework/storage/localstore.zig");

// Per-cart bundle. Default path is `bundle-<app-name>.js` (relative to
// v8_app.zig) so that two parallel ships don't race on a shared bundle.js.
// When -Dbundle-path=<abs> is passed (rjit-driven builds where the user's
// cart lives outside the SDK install), @embedFile uses that absolute path
// instead — letting the bundle sit in CART_ROOT while build.zig and
// v8_app.zig live in RJIT_HOME.
const BUNDLE_FILE_NAME = if (@hasDecl(build_options, "bundle_path") and build_options.bundle_path.len > 0)
    build_options.bundle_path
else
    std.fmt.comptimePrint("bundle-{s}.js", .{build_options.app_name});
const BUNDLE_BYTES = @embedFile(BUNDLE_FILE_NAME);

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
};
var g_window_by_node_id: std.AutoHashMap(u32, WindowBinding) = undefined;
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
var g_press_expr_pool: std.ArrayList([:0]u8) = .{};
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
const CUSTOM_CHROME_MODE = if (@hasDecl(build_options, "custom_chrome")) build_options.custom_chrome else false;
const BORDERLESS_MODE = DEV_MODE or CUSTOM_CHROME_MODE;
const DEV_BUNDLE_PATH = "bundle.js";

var g_dev_bundle_buf: []u8 = &.{};
var g_last_bundle_mtime: i128 = 0;
var g_mtime_poll_counter: u32 = 0;
var g_reload_pending: bool = false;

const dev_ipc = @import("framework/diag/dev_ipc.zig");

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

// V8 right-click dispatcher. The engine calls this with the click coords;
// it pulls the prepared node id (set by qjs_runtime.prepareNodeEvent in the
// engine) and dispatches __dispatchRightClick(id) into V8. The runtime-side
// __getPreparedRightClick host fn (registered in v8_bindings_core.zig:876)
// reads the coords back into the JS payload. qjs_runtime's own dispatcher
// uses callGlobal which is comptime-no-op when QuickJS isn't compiled in,
// so under V8-only builds we need this parallel path.
fn dispatchV8RightClick(x: f32, y: f32) void {
    const id = prepared_input.g_prepared_node_event_id;
    if (id == 0) return;
    prepared_input.g_prepared_node_event_id = 0;
    prepared_input.g_prepared_mouse_x = x;
    prepared_input.g_prepared_mouse_y = y;
    var buf: [128]u8 = undefined;
    const expr = std.fmt.bufPrintZ(&buf, "__dispatchRightClick({d})", .{id}) catch return;
    v8_runtime.evalScript(expr);
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
fn dispatchV8Scroll() void {
    const id = prepared_input.g_prepared_node_event_id;
    if (id == 0) return;
    prepared_input.g_prepared_node_event_id = 0;
    var buf: [128]u8 = undefined;
    const expr = std.fmt.bufPrintZ(&buf, "__dispatchScroll({d})", .{id}) catch return;
    v8_runtime.evalScript(expr);
}

// ── Context menu item trampolines ────────────────────────
// MenuItem.handler is `*const fn () void` with no args, so a single
// dispatcher can't recover which item was clicked. We comptime-generate
// MAX_MENU_ITEMS trampolines, each closed over its own index. They look
// up the active node id from context_menu and dispatch back to React.
const MAX_MENU_ITEMS = 16;

fn dispatchContextMenuClick(item_idx: usize) void {
    const node_id = context_menu.activeNodeId();
    if (node_id == 0) return;
    var buf: [128]u8 = undefined;
    const expr = std.fmt.bufPrintZ(&buf, "__dispatchEvent({d},'onContextMenu',{d})\x00", .{ node_id, item_idx }) catch return;
    v8_runtime.evalScript(expr);
}

fn makeMenuItemHandler(comptime idx: usize) *const fn () void {
    return struct {
        fn callback() void {
            dispatchContextMenuClick(idx);
        }
    }.callback;
}

const g_menu_item_handlers = blk: {
    var arr: [MAX_MENU_ITEMS]*const fn () void = undefined;
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

fn dispatchInputEvent(slot: u8, global_name: [*:0]const u8) void {
    const node_id = g_node_id_by_input_slot[slot];
    if (node_id == 0) return;
    v8_runtime.callGlobal("__beginJsEvent");
    v8_runtime.callGlobal2Int(global_name, @intCast(node_id), @intCast(slot));
    v8_runtime.callGlobal("__endJsEvent");
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
    v8_runtime.callGlobal("__beginJsEvent");
    v8_runtime.callGlobal3Int("__dispatchInputKey", @intCast(node_id), key, mods);
    v8_runtime.callGlobal("__endJsEvent");
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
                color.a = @intFromFloat(@as(f32, @floatFromInt(color.a)) * clamped);
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
        if (jsonFloat(val)) |f| node.style.tween_translate_x_curve = @intFromFloat(@max(0, @min(255, f)));
    } else if (eq(u8, key, "tweenTranslateYFrom")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_from = f;
    } else if (eq(u8, key, "tweenTranslateYTo")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_to = f;
    } else if (eq(u8, key, "tweenTranslateYDurMs")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_dur_ms = f;
    } else if (eq(u8, key, "tweenTranslateYCurve")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_curve = @intFromFloat(@max(0, @min(255, f)));
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
    } else if (eq(u8, type_name, "Paintable")) {
        // Persistent GPU mask texture, never painted visibly. The real
        // texture allocation happens in applyProps once paintableW/H and
        // paintableId are known. See framework/gpu/paintable.zig.
        node.is_paintable = true;
    } else if (isTerminalType(type_name)) {
        node.terminal = true;
    }
    ensureInputSlot(node, id, type_name);
}

fn openHostWindowForNode(id: u32, type_name: []const u8, props: ?std.json.Value) void {
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
    const duration_ms: u32 = if (propFloat(p, "duration")) |sec|
        @intFromFloat(@max(0, sec) * 1000.0)
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
    const slot = windows.open(.{
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
        windows.close(slot);
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

fn routeCommandToHostWindow(cmd: std.json.Value) void {
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
    var line: std.ArrayList(u8) = .{};
    defer line.deinit(g_alloc);
    line.appendSlice(g_alloc, "{\"type\":\"mutations\",\"commands\":[") catch return;

    var translated: ?[]const u8 = null;
    const op_str = op_v.string;
    if (std.mem.eql(u8, op_str, "APPEND") or std.mem.eql(u8, op_str, "INSERT_BEFORE") or std.mem.eql(u8, op_str, "REMOVE")) {
        if (cmd.object.get("parentId")) |pid_v| if (jsonInt(pid_v)) |pid| if (@as(u32, @intCast(pid)) == window_id) {
            const cid_v = cmd.object.get("childId") orelse return;
            const cid = jsonInt(cid_v) orelse return;
            if (std.mem.eql(u8, op_str, "APPEND")) {
                line.writer(g_alloc).print("{{\"op\":\"APPEND_TO_ROOT\",\"childId\":{d}}}", .{cid}) catch return;
                translated = "APPEND_TO_ROOT";
            } else if (std.mem.eql(u8, op_str, "INSERT_BEFORE")) {
                const bid_v = cmd.object.get("beforeId") orelse return;
                const bid = jsonInt(bid_v) orelse return;
                line.writer(g_alloc).print("{{\"op\":\"INSERT_BEFORE_ROOT\",\"childId\":{d},\"beforeId\":{d}}}", .{ cid, bid }) catch return;
                translated = "INSERT_BEFORE_ROOT";
            } else { // REMOVE
                line.writer(g_alloc).print("{{\"op\":\"REMOVE_FROM_ROOT\",\"childId\":{d}}}", .{cid}) catch return;
                translated = "REMOVE_FROM_ROOT";
            }
        };
    }
    if (translated == null) {
        line.writer(g_alloc).print("{f}", .{std.json.fmt(cmd, .{})}) catch return;
    }
    line.appendSlice(g_alloc, "]}") catch return;
    // Per-mutation log — gated behind ZIGOS_TRACE_IPC=1 to avoid drowning
    // the rest of the host log on a fat initial cart paint.
    const trace_ipc = blk: {
        const env = std.posix.getenv("ZIGOS_TRACE_IPC") orelse break :blk false;
        break :blk env.len > 0 and env[0] != '0';
    };
    if (trace_ipc) {
        if (translated) |t| {
            std.debug.print("[window-route/parent] window={d} slot={d} op={s}→{s} bytes={d}\n", .{ window_id, binding.slot, op_str, t, line.items.len });
        } else {
            std.debug.print("[window-route/parent] window={d} slot={d} op={s} bytes={d}\n", .{ window_id, binding.slot, op_str, line.items.len });
        }
    }
    windows.sendLineToChild(binding.slot, line.items);
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
        } else if (std.mem.eql(u8, k, "scene3dLight")) {
            if (jsonBool(v)) |b| node.scene3d_light = b;
        } else if (std.mem.eql(u8, k, "scene3dGroup")) {
            if (jsonBool(v)) |b| node.scene3d_group = b;
        } else if (std.mem.eql(u8, k, "scene3dGeometry")) {
            if (dupJsonText(v)) |s| node.scene3d_geometry = s;
        } else if (std.mem.eql(u8, k, "scene3dLightType")) {
            if (dupJsonText(v)) |s| node.scene3d_light_type = s;
        } else if (std.mem.eql(u8, k, "scene3dColorR")) {
            if (jsonFloat(v)) |f| node.scene3d_color_r = f;
        } else if (std.mem.eql(u8, k, "scene3dColorG")) {
            if (jsonFloat(v)) |f| node.scene3d_color_g = f;
        } else if (std.mem.eql(u8, k, "scene3dColorB")) {
            if (jsonFloat(v)) |f| node.scene3d_color_b = f;
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
        } else if (std.mem.eql(u8, k, "scene3dIntensity")) {
            if (jsonFloat(v)) |f| node.scene3d_intensity = f;
        } else if (std.mem.eql(u8, k, "scene3dRadius")) {
            if (jsonFloat(v)) |f| node.scene3d_radius = f;
        } else if (std.mem.eql(u8, k, "scene3dTubeRadius")) {
            if (jsonFloat(v)) |f| node.scene3d_tube_radius = f;
        } else if (std.mem.eql(u8, k, "scene3dSizeX")) {
            if (jsonFloat(v)) |f| node.scene3d_size_x = f;
        } else if (std.mem.eql(u8, k, "scene3dSizeY")) {
            if (jsonFloat(v)) |f| node.scene3d_size_y = f;
        } else if (std.mem.eql(u8, k, "scene3dSizeZ")) {
            if (jsonFloat(v)) |f| node.scene3d_size_z = f;
        } else if (std.mem.eql(u8, k, "scene3dShowGrid")) {
            if (jsonBool(v)) |b| node.scene3d_show_grid = b;
        } else if (std.mem.eql(u8, k, "scene3dShowAxes")) {
            if (jsonBool(v)) |b| node.scene3d_show_axes = b;
        } else if (std.mem.eql(u8, k, "scene3dTexW")) {
            if (jsonInt(v)) |i| node.scene3d_tex_w = if (i > 0 and i < 65536) @intCast(i) else 0;
        } else if (std.mem.eql(u8, k, "scene3dTexH")) {
            if (jsonInt(v)) |i| node.scene3d_tex_h = if (i > 0 and i < 65536) @intCast(i) else 0;
        } else if (std.mem.eql(u8, k, "scene3dTexKey")) {
            if (dupJsonText(v)) |s| node.scene3d_tex_key = s;
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
                const i: i64 = @intFromFloat(@max(0, @min(f, 255)));
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
                if (assembleEffectShader(v.string)) |wgsl| {
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
                        if (item != .string) { ok = false; break; }
                        const dup = g_alloc.dupe(u8, item.string) catch {
                            ok = false; break;
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
                const iw: i64 = @intFromFloat(@max(0, f));
                node.paintable_w = @intCast(iw);
            }
        } else if (std.mem.eql(u8, k, "paintableH")) {
            if (jsonFloat(v)) |f| {
                const ih: i64 = @intFromFloat(@max(0, f));
                node.paintable_h = @intCast(ih);
            }
        }
    }
    // After all props are applied, if we have a complete paintable spec,
    // (re-)allocate the GPU texture. ensure() is idempotent and handles
    // re-sizing by re-allocating, so prop updates that change w/h work.
    if (node.is_paintable) {
        if (node.paintable_id) |pid| {
            if (node.paintable_w > 0 and node.paintable_h > 0) {
                _ = paintable.ensure(pid, node.paintable_w, node.paintable_h);
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
fn v8_effect_shim(ctx: *effect_ctx.EffectContext) void {
    const id_u: usize = ctx.user_data;
    if (id_u == 0) return;
    const id: u32 = @intCast(id_u);
    const buf_len: usize = @as(usize, ctx.height) * @as(usize, ctx.stride);
    v8_runtime.dispatchEffectRender(
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

fn dispatchWindowEvent(id: u32, handler: []const u8) void {
    var buf: [160]u8 = undefined;
    const expr = std.fmt.bufPrintZ(&buf, "__dispatchEvent({d},'{s}')", .{ id, handler }) catch return;
    v8_runtime.evalScript(expr);
}

fn writeJsonString(out: *std.ArrayList(u8), value: []const u8) !void {
    try out.writer(g_alloc).print("{f}", .{std.json.fmt(value, .{})});
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

fn beforeNodeDestroy(node: *Node, _: u32) void {
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
}

/// Per-batch reconciler drain. Delegates the actual mutation work to
/// host_tree.applyCommandBatch (hooks installed above handle the
/// GPU-specific concerns), then runs v8_app-only diagnostics and the
/// detached-node sweep. Called by the reconciler binding via
/// v8_bindings_reconciler.drainPending().
fn applyCommandBatch(json_bytes: []const u8) void {
    const t0 = std.time.microTimestamp();
    host_tree.applyCommandBatch(json_bytes);
    const t1 = std.time.microTimestamp();
    cleanupDetachedNodes();
    const t2 = std.time.microTimestamp();

    const trace_ops = blk: {
        const env = std.posix.getenv("ZIGOS_TRACE_BATCH_OPS") orelse break :blk false;
        break :blk env.len > 0 and env[0] != '0';
    };
    const verbose = std.posix.getenv("REACTJIT_VERBOSE_BATCHES") != null;
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
        var update_summary: std.ArrayList(u8) = .{};
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
                    if (cmd.object.get("id")) |idv| if (jsonInt(idv)) |i| { id_v = i; };
                    update_summary.writer(g_alloc).print(" #{d}=id:{d}[", .{ update_seen, id_v }) catch {};
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
                    if (cmd.object.get("id")) |idv| if (jsonInt(idv)) |i| { id_v = i; };
                    update_summary.writer(g_alloc).print(" other=id:{d}", .{id_v}) catch {};
                    if (cmd.object.get("text")) |tv| if (tv == .string) {
                        const t = tv.string;
                        const head_len = if (t.len > 24) 24 else t.len;
                        update_summary.writer(g_alloc).print(" text:{s}", .{t[0..head_len]}) catch {};
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
            json_bytes.len,                cmd_count,
            @divTrunc(apply_us, 1000),     @divTrunc(cleanup_us, 1000),
        });
    }
}

// __hostFlush is registered by framework/v8_bindings_reconciler.zig.
// The content store lives in v8_bindings_core. The pending-flush queue
// + drain + reload-clear all live in v8_bindings_reconciler.

fn contentStoreGet(id: u32) ?[]const u8 {
    return v8_bindings_core.contentStoreGet(id);
}

fn drainPendingFlushes() void {
    v8_bindings_reconciler.drainPending(applyCommandBatch);
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

fn syncRenderedNodeState(node: *const Node) void {
    if (node.scroll_persist_slot != 0) {
        if (g_node_by_id.get(node.scroll_persist_slot)) |stable| {
            if (!g_scroll_prop_slots.contains(node.scroll_persist_slot)) {
                stable.scroll_x = node.scroll_x;
                stable.scroll_y = node.scroll_y;
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

fn destroyDetachedNode(id: u32) void {
    if (g_window_by_node_id.fetchRemove(id)) |entry| {
        windows.close(entry.value.slot);
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

fn cleanupClosedHostWindows() void {
    var stale: std.ArrayList(u32) = .{};
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
            dispatchWindowEvent(id, handler);
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

fn rebuildTree() void {
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
        if (materializeWindowRoot(arena, entry.key_ptr.*)) |window_root| {
            windows.setRoot(entry.value_ptr.slot, window_root);
        }
    }

    const chrome_opt = if (DEV_MODE) buildChromeNode(arena) else null;
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
        windows.close(binding.slot);
        if (binding.title) |title| g_alloc.free(title);
    }
    g_window_by_node_id.clearRetainingCapacity();

    // host_tree owns all tree state — destroy every Node, free children
    // lists, clear parent map + root-child list in one call. node.text
    // ownership is mixed (some g_alloc dupes, some slices into
    // framework/input.zig's buffers) so the text leaks for dev-mode
    // safety — kilobytes per reload, acceptable.
    host_tree.clearAll();
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

    // host_tree.clearAll above already cleared the root-child list.

    // Arena holds only materializeChildren output (rebuilt every frame from
    // host_tree's maps). Safe to reset now that g_root.children no longer
    // references it.
    _ = g_arena.reset(.retain_capacity);

    g_dirty.* = true;
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
/// V8's platform is single-shot (InitializePlatform cannot run twice in a
/// process), so we keep the Isolate and Platform alive and only rebuild the
/// Context + top-level HandleScope. appInit() re-registers host funcs onto
/// the fresh context.
fn evalActiveTab() void {
    std.log.info("[dev] evalActiveTab: clearing tree", .{});
    clearTreeStateForReload();
    std.log.info("[dev] evalActiveTab: resetting context", .{});
    v8_runtime.resetContextForReload();
    std.log.info("[dev] evalActiveTab: appInit", .{});
    appInit();
    const tab = &g_tabs.items[g_active_tab];
    std.log.info("[dev] evalActiveTab: evalScript ({d} bytes)", .{tab.bundle.len});
    const ok = v8_runtime.evalScriptChecked(tab.bundle);
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
        clearTreeStateForReload();
        v8_runtime.resetContextForReload();
        appInit();
        _ = v8_runtime.evalScriptChecked(lg);
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
    // v8_runtime.initVM() then evalScript(js_logic)). But we need __hostFlush
    // registered BEFORE evalScript runs. Engine order matters — see below.
    //
    // We piggyback on engine's eval: we pass the bundle via AppConfig.js_logic,
    // engine evals it, hostConfig's transportFlush tries to call globalThis.__hostFlush.
    // We must register __hostFlush BEFORE the bundle evals. Since appInit runs BEFORE
    // evalScript in engine.run order (tsz convention: init → evalScript), register here.
    // EVERY V8 binding registration goes through INGREDIENTS — no exceptions.
    // Required bindings always register; opt-in bindings register only when
    // the cart's bundle ordered them. See INGREDIENTS comment block for the
    // full contract (one row + one build option + one scripts/ship grep).
    inline for (INGREDIENTS) |ing| @field(ing.mod, ing.reg_fn)({});
    // __hostFlush — single registration site shared with v8_tui_app.
    // Mode was set to `.queue` in main() so per-commit payloads go into
    // the queue and the engine drains them at the right frame phase.
    v8_bindings_reconciler.register();
    windows.setJsDispatchFn(dispatchWindowEvent);
    v8_bindings_sdk.registerSdk({});

    // Bridge the dev-mode flag to JS so runtime/index.tsx can wrap the
    // active cart's tree with a sibling eventlog Window. Keep it small —
    // just a single boolean global; runtime checks it once at mount time.
    if (DEV_MODE) {
        v8_runtime.evalScript("globalThis.__DEV_MODE = true;");
    } else {
        v8_runtime.evalScript("globalThis.__DEV_MODE = false;");
    }

    // Polyfills — V8 has no setTimeout/setInterval/console.log. QJS path
    // installs an equivalent block from qjs_runtime.initVM; mirror the minimal
    // subset here so the bundle boot (React + runtime/index.tsx) succeeds.
    v8_runtime.evalScript(
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
    );

    // Persistent-store substrate for runtime/hooks/localstore. Best-effort —
    // if init fails the hooks gracefully no-op (see qjs_bindings.storeGet etc.).
    fs_mod.init("reactjit") catch |e| std.log.warn("fs init failed: {}", .{e});
    localstore.init() catch |e| std.log.warn("localstore init failed: {}", .{e});

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
        v8_runtime.evalScript(
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

fn appTick(now: u32) void {
    // ── PROBE: first-tick milestones (only first 3 ticks log) ──
    const _probe_n = struct {
        var v: u32 = 0;
    };
    _probe_n.v += 1;
    const _probe = _probe_n.v <= 3;
    if (_probe) std.debug.print("[probe-tick] #{d} entry now={d}\n", .{ _probe_n.v, now });

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
        dev_ipc.pollOnce();
        processIncomingPushes();
    }
    if (_probe) std.debug.print("[probe-tick] #{d} after dev_ipc+push\n", .{_probe_n.v});
    maybeScheduleReload();
    if (g_reload_pending) {
        g_reload_pending = false;
        performReload();
        return;
    }

    // Fire any JS timers whose due-time has arrived. setTimeout/setInterval
    // in the bundle are implemented against this — see runtime/index.tsx.
    // This may append new batches to g_pending_flush via React commits triggered
    // from handlers that ran inside timers. Drain after.
    if (_probe) std.debug.print("[probe-tick] #{d} before __jsTick\n", .{_probe_n.v});
    v8_runtime.callGlobalInt("__jsTick", @intCast(now));
    if (_probe) std.debug.print("[probe-tick] #{d} after __jsTick\n", .{_probe_n.v});

    // Per-tick drains for every binding domain that defines tickDrain().
    // Required bindings (core, websocket) and opt-in bindings (httpsrv,
    // wssrv, process) all flow through here. Stubs are no-ops, so this is
    // free for carts that didn't order the opt-in domains. Note: subscriber
    // callbacks fired by these drains defer through setTimeout(0) (see
    // runtime/ffi.ts), so emit-during-tick is observed by JS on the NEXT
    // __jsTick — no ordering dependency vs the call above.
    inline for (INGREDIENTS) |ing| {
        if (@hasDecl(ing.mod, "tickDrain")) {
            // vterm's tickDrain returns bool (whether to repaint — the TUI
            // host consumes it); the rest return void. Discard either way.
            _ = ing.mod.tickDrain();
        }
    }
    if (_probe) std.debug.print("[probe-tick] #{d} after tickDrain\n", .{_probe_n.v});

    // Apply any CMD batches that accumulated during press events since last tick.
    // Must happen BEFORE rebuildTree so the tree reflects the new g_node_by_id.
    drainPendingFlushes();
    if (_probe) std.debug.print("[probe-tick] #{d} after drainPendingFlushes\n", .{_probe_n.v});
    // Host-side animation tick. Walks the animation registry and writes
    // current values into latches; syncLatchesToNodes then propagates
    // those into node.style. Cart-side `useHostAnimation` registers
    // animations via __anim_register / __anim_unregister.
    const _now_ms_for_anim: i64 = @as(i64, @truncate(@divFloor(std.time.nanoTimestamp(), 1_000_000)));
    animations.tickAll(_now_ms_for_anim);
    syncLatchesToNodes();
    windows.tickIndependent();
    cleanupClosedHostWindows();
    if (_probe) std.debug.print("[probe-tick] #{d} after windows+cleanup, dirty={}\n", .{ _probe_n.v, g_dirty.* });

    if (g_dirty.*) {
        if (_probe) std.debug.print("[probe-tick] #{d} before snapshotRuntimeState\n", .{_probe_n.v});
        const t0 = std.time.microTimestamp();
        snapshotRuntimeState();
        const t1 = std.time.microTimestamp();
        if (_probe) std.debug.print("[probe-tick] #{d} before rebuildTree\n", .{_probe_n.v});
        rebuildTree();
        const t2 = std.time.microTimestamp();
        if (_probe) std.debug.print("[probe-tick] #{d} before markLayoutDirty\n", .{_probe_n.v});
        layout.markLayoutDirty();
        g_dirty.* = false;
        g_scroll_prop_slots.clearRetainingCapacity();
        const snap_us = t1 - t0;
        const rebuild_us = t2 - t1;
        if (std.posix.getenv("REACTJIT_VERBOSE_BATCHES") != null) {
            // Count the tree size for context.
            var node_count: usize = 0;
            var kid_it = g_children_ids.valueIterator();
            while (kid_it.next()) |list| node_count += list.items.len;
            std.debug.print("[rebuild-timing] snapshot={d}us rebuildTree={d}us nodes={d} (g_node_by_id={d})\n", .{ snap_us, rebuild_us, node_count, g_node_by_id.count() });
        }
    }
    if (_probe) std.debug.print("[probe-tick] #{d} END\n", .{_probe_n.v});
}

fn childTitle() [*:0]const u8 {
    if (std.posix.getenv("ZIGOS_WINDOW_TITLE")) |title| {
        const owned = g_alloc.dupeZ(u8, title) catch return "Window";
        return owned.ptr;
    }
    return "Window";
}

fn childInit() void {
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
    v8_runtime.evalScript(
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

    const port_s = std.posix.getenv("ZIGOS_IPC_PORT") orelse return;
    const port = std.fmt.parseInt(u16, port_s, 10) catch return;
    std.debug.print("[window-child] init port={d} window_id={d}\n", .{ port, g_child_window_id });
    g_child_client = ipc.Client.connect(port) catch |err| {
        std.debug.print("[window-child] IPC connect failed: {}\n", .{err});
        return;
    };
    if (g_child_client) |*client| {
        _ = client.sendLine("{\"type\":\"ready\"}");
    }
    if (std.posix.getenv("ZIGOS_WINDOW_AUTO_DISMISS_MS")) |dismiss_s| {
        g_child_auto_dismiss_ms = std.fmt.parseInt(u32, dismiss_s, 10) catch 0;
    }
    g_child_started_ms = @truncate(std.time.milliTimestamp());
}

fn childDispatchEvent(id: u32, handler: []const u8) void {
    var client = &(g_child_client orelse return);
    var line: std.ArrayList(u8) = .{};
    defer line.deinit(g_alloc);
    line.writer(g_alloc).print("{{\"type\":\"event\",\"targetId\":{d},\"handler\":", .{id}) catch return;
    writeJsonString(&line, handler) catch return;
    line.appendSlice(g_alloc, "}") catch return;
    _ = client.sendLine(line.items);
}

fn childApplyMessage(line: []const u8) void {
    // Per-message recv/apply lines gated behind ZIGOS_TRACE_IPC=1.
    const trace = blk: {
        const env = std.posix.getenv("ZIGOS_TRACE_IPC") orelse break :blk false;
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
    for (commands_v.array.items) |cmd| host_tree.applyCommand(cmd) catch |err| {
        std.debug.print("[window-child] apply error: {s}\n", .{@errorName(err)});
    };
}

fn childTick(_: u32) void {
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
        for (messages) |msg| childApplyMessage(msg.data);
    }
    if (g_child_auto_dismiss_ms > 0 and g_child_started_ms > 0) {
        const now_ms = std.time.milliTimestamp();
        if (now_ms - g_child_started_ms >= @as(i64, @intCast(g_child_auto_dismiss_ms))) {
            std.process.exit(0);
        }
    }

    if (g_dirty.*) {
        snapshotRuntimeState();
        rebuildTree();
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

fn childShutdown() void {
    if (g_child_client) |*client| {
        var line: std.ArrayList(u8) = .{};
        defer line.deinit(g_alloc);
        line.writer(g_alloc).print("{{\"type\":\"windowEvent\",\"targetId\":{d},\"handler\":\"onClose\"}}", .{g_child_window_id}) catch {};
        if (line.items.len > 0) _ = client.sendLine(line.items);
        client.close();
        g_child_client = null;
    }
}

fn appShutdown() void {
    var win_it = g_window_by_node_id.valueIterator();
    while (win_it.next()) |binding| {
        if (binding.title) |title| g_alloc.free(title);
    }
    g_window_by_node_id.clearRetainingCapacity();
    localstore.deinit();
    fs_mod.deinit();
}

// ── main ────────────────────────────────────────────────────────

pub fn main() !void {
    if (IS_LIB) return;

    // Bring up the observability bus before anything else so that boot-time
    // events (window-child detection, dev-mode bundle read, IPC start) all
    // land in the log instead of vanishing pre-bus. Best-effort — failure
    // (e.g. no $HOME) leaves emit() as a no-op and the runtime keeps going.
    event_bus.init();

    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
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
    g_scroll_prop_slots = std.AutoHashMap(u32, void).init(g_alloc);
    g_input_slot_by_node_id = std.AutoHashMap(u32, u8).init(g_alloc);
    g_menu_items_by_node = std.AutoHashMap(u32, []context_menu.MenuItem).init(g_alloc);
    g_menu_labels_by_node = std.AutoHashMap(u32, [][]u8).init(g_alloc);
    g_inline_glyphs_by_node = std.AutoHashMap(u32, InlineGlyphAlloc).init(g_alloc);

    g_root = .{};

    if (std.posix.getenv("ZIGOS_WINDOW_CHILD") != null) {
        g_is_window_child = true;
        if (std.posix.getenv("ZIGOS_WINDOW_ID")) |id_s| {
            g_child_window_id = std.fmt.parseInt(u32, id_s, 10) catch 0;
        }
        try engine.run(.{
            .title = childTitle(),
            .root = &g_root,
            .js_logic = "",
            .lua_logic = "",
            .init = childInit,
            .tick = childTick,
            .shutdown = childShutdown,
            .borderless = std.posix.getenv("ZIGOS_WINDOW_BORDERLESS") != null,
            .always_on_top = std.posix.getenv("ZIGOS_WINDOW_ALWAYS_ON_TOP") != null,
            .not_focusable = std.posix.getenv("ZIGOS_WINDOW_NOT_FOCUSABLE") != null,
            .dispatch_js_event = childDispatchEvent,
            .set_canvas_node_position = setCanvasNodePosition,
        });
        return;
    }

    const initial_bundle: []const u8 = if (DEV_MODE) blk: {
        g_dev_bundle_buf = readBundleFromDisk() catch |e| {
            std.log.err("[dev] initial bundle.js read failed: {}", .{e});
            return e;
        };
        g_last_bundle_mtime = bundleMtimeOrZero();

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
        .shutdown = appShutdown,
        // In dev mode, strip the OS titlebar so our tab chrome sits in the
        // titlebar position. Empty chrome area gets window_drag; tab buttons
        // with on_press override drag so clicks still switch tabs.
        .borderless = BORDERLESS_MODE,
        .set_canvas_node_position = setCanvasNodePosition,
    });
}
