//! ReactJIT Engine — owns the window lifecycle, GPU, text, layout, paint, and event loop.
//!
//! The generated app provides a node tree + callbacks. The engine handles everything else.
//! Adding new framework modules (geometry, watchdog, etc.) happens here — no codegen changes needed.

const std = @import("std");
const HostContext = @import("host_context.zig");
pub const c = @import("c.zig").imports;
const layout = @import("layout.zig");
const text_mod = @import("primitive/text.zig");
const gpu = @import("gpu/gpu.zig");
const kms = @import("render/kms.zig");
const evdev = @import("render/evdev.zig");
const geometry = @import("storage/geometry.zig");
const selection = @import("state/selection.zig");
const windows = @import("primitive/windows.zig");
const svg_path = @import("gpu/svg/path.zig");
const image_cache = @import("gpu/image_cache.zig");
const border_dash = @import("gpu/svg/dash.zig");
const animations = @import("gpu/animations.zig");
const log = @import("diag/log.zig");
const hit_trace = @import("diag/hit_trace.zig");
const tooltip = @import("primitive/tooltip.zig");
const context_menu = @import("primitive/context_menu.zig");
const telemetry = @import("diag/telemetry.zig");
const filedrop = @import("fs/filedrop.zig");
const fswatch = @import("fs/fswatch.zig");
const clipboard_watch = @import("ifttt/clipboard_watch.zig");
const key_pack = @import("key_pack.zig");
const selection_watch = @import("ifttt/selection_watch.zig");
const voice = @import("voice/voice.zig");
const audio_input = @import("audio_input/audio_input.zig");
const build_options_for_whisper = @import("build_options");
const whisper = if (@hasDecl(build_options_for_whisper, "has_whisper") and build_options_for_whisper.has_whisper)
    @import("voice/whisper.zig")
else
    struct {
        pub fn init(_: std.Io, _: *const std.process.Environ.Map, _: std.mem.Allocator) bool {
            return false;
        }
        pub fn deinit(_: std.Io) void {}
        pub fn tick(_: *HostContext, _: u32) void {}
    };
const blazepose = if (@hasDecl(build_options_for_whisper, "has_onnx") and build_options_for_whisper.has_onnx)
    @import("ml/blazepose.zig")
else
    struct {
        pub fn init(_: std.Io, _: *const std.process.Environ.Map, _: std.mem.Allocator) void {}
        pub fn deinit(_: std.Io) void {}
    };
const system_signals = @import("ifttt/system_signals.zig");
const ifttt_zig = @import("ifttt/ifttt.zig");
const sim = @import("sim/root.zig");
const input = @import("primitive/input.zig");
const slider_math = @import("primitive/slider_math.zig");
const latches = @import("state/latches.zig");
const mesh_selection_policy = @import("state/mesh_selection_policy.zig");
const crashlog = @import("diag/crashlog.zig");
const watchdog = @import("diag/watchdog.zig");
// ── Build-option-gated imports (lean tier omits these) ──────────────────
const build_options = @import("build_options");
const HAS_QUICKJS = if (@hasDecl(build_options, "has_quickjs")) build_options.has_quickjs else true;
const HAS_PHYSICS = if (@hasDecl(build_options, "has_physics")) build_options.has_physics else true;
const HAS_TERMINAL = if (@hasDecl(build_options, "has_terminal")) build_options.has_terminal else true;
const HAS_AUDIO = if (@hasDecl(build_options, "has_audio")) build_options.has_audio else false;
const HAS_VIDEO = if (@hasDecl(build_options, "has_video")) build_options.has_video else true;
const HAS_RENDER_SURFACES = if (@hasDecl(build_options, "has_render_surfaces")) build_options.has_render_surfaces else true;
const HAS_EFFECTS = if (@hasDecl(build_options, "has_effects")) build_options.has_effects else true;
const HAS_CANVAS = if (@hasDecl(build_options, "has_canvas")) build_options.has_canvas else true;
const HAS_3D = if (@hasDecl(build_options, "has_3d")) build_options.has_3d else true;
const HAS_COMPILED_WORLD = if (@hasDecl(build_options, "has_compiled_world")) build_options.has_compiled_world else false;
const HAS_TRANSITIONS = if (@hasDecl(build_options, "has_transitions")) build_options.has_transitions else true;
const HAS_DEBUG_SERVER = if (@hasDecl(build_options, "has_debug_server")) build_options.has_debug_server else false;

var g_paisley_debug_enabled: ?bool = null;

fn paisleyDebugEnabled() bool {
    return g_paisley_debug_enabled orelse false;
}

fn isPaisleyName(name: []const u8) bool {
    return std.mem.startsWith(u8, name, "paisley-");
}

const debug_server = if (HAS_DEBUG_SERVER) @import("diag/debug_server.zig") else struct {
    pub fn init(_: std.mem.Allocator, _: std.Io, _: *const std.process.Environ.Map, _: [*:0]const u8) void {}
    pub fn poll(_: std.Io) void {}
    pub fn deinit(_: std.Io) void {}
    pub fn getSelectedNode() i32 {
        return -1;
    }
    pub fn getPairingCode() ?[]const u8 {
        return null;
    }
};

// LuaJIT workers are compute-only, off-thread — they never touch rendering,
// layout, or state. The typed module API receives host capabilities explicitly.
const luajit_worker = @import("process/luajit_worker.zig");

// luajit_runtime archived to archive/qjs-stack/ — Smith-era .tsz script-block
// evaluator. V8 carts never set handlers.lua_on_* (only the .tsz toolchain
// did), so every evalExpr branch + initVM/tick/persistScrollSlot call below
// is dead. Stub struct keeps the call sites compiling until they're scrubbed.
const luajit_runtime = struct {
    pub fn initVM() void {}
    pub fn deinit() void {}
    pub fn tick() void {}
    pub fn evalExpr(_: []const u8) void {}
    pub fn persistScrollSlot(_: u32, _: f32) void {}
    pub var telemetry_fps: u32 = 0;
};
const mouse_state = @import("state/mouse_state.zig");

const pty_remote = if (HAS_TERMINAL) @import("terminal/pty_remote.zig") else struct {
    pub const Server = struct {
        pub fn init(_: std.mem.Allocator) Server {
            return .{};
        }
        pub fn start(_: *Server, _: std.Io) void {}
        pub fn deinit(_: *Server, _: std.Io) void {}
        pub fn poll(_: *Server, _: std.Io) void {}
    };
};

const vterm_mod = if (HAS_TERMINAL) @import("terminal/vterm.zig") else struct {
    pub const RGB = struct { r: u8, g: u8, b: u8 };
    pub const Cell = struct {
        char_buf: [4]u8 = .{ 0, 0, 0, 0 },
        char_len: u8 = 0,
        width: u8 = 1,
        fg: ?RGB = null,
        bg: ?RGB = null,
        bold: bool = false,
        italic: bool = false,
        underline: bool = false,
        strike: bool = false,
        reverse: bool = false,
    };
    pub const Pipe = struct {};
    pub const MAX_TERMINALS: u8 = 16;
    pub const DEFAULT_SESSION: []const u8 = "default";
    pub fn pipeCount() usize {
        return 0;
    }
    pub fn getPipe(_: []const u8) ?*Pipe {
        return null;
    }
    pub fn copySelectedTextByName(_: []const u8, _: u16, _: u16, _: u16, _: u16, _: []u8) usize {
        return 0;
    }
    pub fn getCellByName(_: []const u8, _: u16, _: u16) Cell {
        return .{};
    }
    pub fn getColsByName(_: []const u8) u16 {
        return 0;
    }
    pub fn getCursorColByName(_: []const u8) u16 {
        return 0;
    }
    pub fn getCursorRowByName(_: []const u8) u16 {
        return 0;
    }
    pub fn getCursorVisibleByName(_: []const u8) bool {
        return false;
    }
    pub fn getMouseModeByName(_: []const u8) c_int {
        return 0;
    }
    pub fn getRowsByName(_: []const u8) u16 {
        return 0;
    }
    pub fn getRowTextByName(_: []const u8, _: u16) []const u8 {
        return "";
    }
    pub fn scrollbackCellByName(_: []const u8, _: u16, _: u16) Cell {
        return .{};
    }
    pub fn pollPtyByName(_: std.Io, _: []const u8) bool {
        return false;
    }
    pub fn resizeByName(_: []const u8, _: u16, _: u16) void {}
    pub fn scrollDownByName(_: []const u8, _: u16) void {}
    pub fn scrollOffsetByName(_: []const u8) u16 {
        return 0;
    }
    pub fn scrollToBottomByName(_: []const u8) void {}
    pub fn scrollUpByName(_: []const u8, _: u16) void {}
    pub fn spawnShellByName(_: std.Io, _: []const u8, _: [*:0]const u8, _: u16, _: u16) void {}
    pub fn writePtyByName(_: []const u8, _: []const u8) void {}
    pub fn ptyAliveByName(_: []const u8) bool {
        return false;
    }
    pub fn ensurePipe(_: []const u8, _: u16, _: u16) ?*Pipe {
        return null;
    }
    pub fn hasDamageByName(_: []const u8) bool {
        return false;
    }
    pub fn clearDamageByName(_: []const u8) void {}
};

const classifier = if (HAS_TERMINAL) @import("terminal/classifier.zig") else struct {
    pub const Token = enum(u8) {
        output,
        command,
        @"error",
        success,
        heading,
        separator,
        progress,
        user_prompt,
        user_text,
        assistant_text,
        thinking,
        thought_complete,
        tool,
        result,
        diff,
        banner,
        status_bar,
        box_drawing,
        input_border,
        input_zone,
        permission,
        menu_title,
        menu_option,
        menu_desc,
        hint,
        task_done,
        task_active,
        task_open,
        task_summary,
        text,
    };
    pub const Mode = enum { none, basic, claude_code, json };
    pub fn tokenColor(_: Token) layout.Color {
        return .{};
    }
    pub fn getModeByName(_: []const u8) Mode {
        return .none;
    }
    pub fn setModeByName(_: []const u8, _: Mode) void {}
    pub fn markDirtyByName(_: []const u8) void {}
    pub fn isDirtyByName(_: []const u8) bool {
        return false;
    }
    pub fn clearDirtyByName(_: []const u8) void {}
    pub fn getRowTokenByName(_: []const u8, _: u16) Token {
        return .text;
    }
    pub fn classifyAndCacheByName(_: []const u8, _: u16, _: []const u8, _: u16) void {}
};

const semantic = if (HAS_TERMINAL) @import("terminal/semantic.zig") else struct {
    pub fn tickByName(_: []const u8, _: u16) void {}
};

// Force-reference pty_client.zig for unix socket terminal remote control.
comptime {
    if (HAS_TERMINAL) _ = @import("terminal/pty_client.zig");
}

const prepared_input = @import("state/prepared_input.zig");
const frame_telemetry = @import("diag/frame_telemetry.zig");
const js_vm = @import("v8_runtime.zig");
const canvas = if (HAS_CANVAS) @import("primitive/canvas.zig") else struct {
    pub const CameraTransform = struct { cx: f32 = 0, cy: f32 = 0, scale: f32 = 1 };
    pub fn init() void {}
    pub fn setCamera(_: f32, _: f32, _: f32) void {}
    pub fn getHoveredNode() ?u16 {
        return null;
    }
    pub fn setHoveredNode(_: ?u16) void {}
    pub fn getSelectedNode() ?u16 {
        return null;
    }
    pub fn clickNode() void {}
    pub fn screenToGraph(_: f32, _: f32, _: f32, _: f32) [2]f32 {
        return .{ 0, 0 };
    }
    pub fn handleDrag(_: f32, _: f32) void {}
    pub fn handleScroll(_: f32, _: f32, _: f32, _: f32, _: f32) void {}
    pub fn renderCanvas(_: ?[]const u8, _: f32, _: f32, _: f32, _: f32) void {}
    pub fn getCameraTransform(_: f32, _: f32, _: f32, _: f32) CameraTransform {
        return .{};
    }
    pub fn getNodeDim(_: u16) f32 {
        return 1.0;
    }
    pub fn getFlowOverride(_: u16) bool {
        return true;
    }
};
// devtools removed — inspector lives in tsz-tools (standalone IPC app)
const testharness = if (HAS_QUICKJS) @import("testing/harness.zig") else struct {
    pub fn envEnabled(_: *const std.process.Environ.Map) bool {
        return false;
    }
    pub fn enable() void {}
    pub fn tick() bool {
        return false;
    }
    pub fn runAll(_: *Node) u8 {
        return 0;
    }
};
const videos = if (HAS_VIDEO) @import("render/videos.zig") else struct {
    pub fn init() void {}
    pub fn deinit() void {}
    pub fn update() void {}
    pub fn handleKey(_: i32) bool {
        return false;
    }
    pub fn paintVideo(_: ?[]const u8, _: f32, _: f32, _: f32, _: f32, _: f32) bool {
        return false;
    }
    // Media-slider surface (MEDIASLIDER-0705) — no-video builds keep the
    // scrubber code compiling; a bound slider just never follows/seeks.
    pub fn getCurrentTime(_: []const u8) ?f64 {
        return null;
    }
    pub fn getDuration(_: []const u8) ?f64 {
        return null;
    }
    pub fn seek(_: []const u8, _: f64) void {}
    pub fn seekExact(_: []const u8, _: f64) void {}
    pub fn videoCount() usize {
        return 0;
    }
};
const render_surfaces = if (HAS_RENDER_SURFACES) @import("render/render_surfaces.zig") else struct {
    pub fn init() void {}
    pub fn deinit(_: std.Io) void {}
    pub fn update(_: std.Io, _: *const std.process.Environ.Map) void {}
    pub fn handleMouseDown(_: std.Io, _: *const std.process.Environ.Map, _: f32, _: f32, _: u8) bool {
        return false;
    }
    pub fn handleMouseUp(_: std.Io, _: *const std.process.Environ.Map, _: f32, _: f32, _: u8) bool {
        return false;
    }
    pub fn handleMouseMotion(_: std.Io, _: *const std.process.Environ.Map, _: f32, _: f32) bool {
        return false;
    }
    pub fn handleTextInput(_: [*:0]const u8) bool {
        return false;
    }
    pub fn handleKeyDown(_: std.Io, _: *const std.process.Environ.Map, _: i32) bool {
        return false;
    }
    pub fn handleKeyUp(_: std.Io, _: *const std.process.Environ.Map, _: i32) bool {
        return false;
    }
    pub fn paintSurface(_: std.Io, _: *const std.process.Environ.Map, _: ?[]const u8, _: f32, _: f32, _: f32, _: f32, _: f32) bool {
        return false;
    }
    pub fn setSuspended(_: std.Io, _: *const std.process.Environ.Map, _: []const u8, _: bool) void {}
};
const capture = if (HAS_EFFECTS) @import("gpu/capture.zig") else struct {
    pub fn init(_: *const std.process.Environ.Map) void {}
    pub fn deinit(_: std.Io) void {}
    pub fn handleKey(_: std.Io, _: *const std.process.Environ.Map, _: i32) bool {
        return false;
    }
    pub fn tick(_: *Node) bool {
        return false;
    }
};
const effects = if (HAS_EFFECTS) @import("gpu/effects.zig") else struct {
    pub fn init(_: *const std.process.Environ.Map) void {}
    pub fn deinit() void {}
    pub fn update(_: f32) void {}
    pub fn pollMouse(_: f32, _: f32, _: f32) void {}
    pub fn paintEffect(_: ?[]const u8, _: f32, _: f32, _: f32, _: f32, _: f32) bool {
        return false;
    }
    pub fn paintCustomEffect(_: std.Io, _: *const std.process.Environ.Map, _: *const Node, _: f32, _: f32, _: f32, _: f32, _: f32) bool {
        return false;
    }
    pub fn paintNamedEffect(_: *const Node, _: []const u8, _: f32, _: f32, _: f32, _: f32) bool {
        return false;
    }
    pub const EffectFillInfo = struct { pixel_buf: [*]const u8, width: u32, height: u32, screen_x: f32, screen_y: f32 };
    pub fn getEffectFill(_: []const u8) ?EffectFillInfo {
        return null;
    }
};
const paintable = if (HAS_EFFECTS) @import("gpu/paintable.zig") else struct {
    pub fn drainAll() void {}
};
const r3d = if (HAS_3D) @import("dev_modules/scene3d_runtime.zig") else struct {
    pub fn render(_: std.Io, _: *const std.process.Environ.Map, _: *Node, _: f32, _: f32, _: f32, _: f32, _: f32) bool {
        return false;
    }
    pub fn update(_: f32) void {}
    // Native mesh-editor input stubs (only ever called when meshEditCapturing() is true,
    // which a non-3D build can never set — these just satisfy the compiler).
    pub fn meshEditCapturing() bool {
        return false;
    }
    pub fn meshEditFocusTool() bool {
        return false;
    }
    pub fn meshEditModeRaw() u8 {
        return 0;
    }
    pub fn orbitDrag(_: f32, _: f32) void {}
    pub fn orbitPan(_: f32, _: f32) void {}
    pub fn orbitZoom(_: f32) void {}
    pub fn focusAt(_: f32, _: f32) bool {
        return false;
    }
    pub fn meshEditPick(_: f32, _: f32, _: bool) i32 {
        return -1;
    }
    pub fn meshEditOutOfScopePartAt(_: f32, _: f32) i32 {
        return -1;
    }
    pub fn meshEditBox(_: f32, _: f32, _: f32, _: f32, _: bool) i32 {
        return -1;
    }
    pub fn meshEditSelectAll() i32 {
        return -1;
    }
    pub fn meshEditSnapshot() void {}
    pub fn meshEditRevert() void {}
    pub fn meshGizmoHit(_: f32, _: f32) i32 {
        return -1;
    }
    pub fn meshGizmoBegin() void {}
    pub fn meshGizmoGrabAt(_: f32, _: f32, _: i32) void {}
    pub fn meshGizmoDrag(_: i32, _: f32, _: f32, _: bool, _: bool) bool {
        return false;
    }
    pub fn meshGizmoFinish() bool {
        return false;
    }
    pub fn bdGizmoHit(_: f32, _: f32) i32 {
        return -1;
    }
    pub fn bdGizmoBegin(_: i32) void {}
    pub fn bdGizmoDrag(_: f32, _: f32, _: bool, _: bool) bool {
        return false;
    }
    pub fn bdGizmoFinish() void {}
    pub fn meshGizmoNudge(_: u8, _: f32) bool {
        return false;
    }
    pub fn meshLcActive() bool {
        return false;
    }
    pub fn meshLcHandleHit(_: f32, _: f32) bool {
        return false;
    }
    pub fn meshLcHandleDrag(_: f32, _: f32, _: bool) bool {
        return false;
    }
    pub fn meshCompassHit(_: f32, _: f32) i32 {
        return -1;
    }
    pub fn meshCompassSnap(_: i32) bool {
        return false;
    }
    pub fn setMeshGizmoTool(_: u8) void {}
    pub fn drawEditorOverlay(_: f32, _: f32) void {}
    pub fn meshSetMarquee(_: f32, _: f32, _: f32, _: f32) void {}
    pub fn meshClearMarquee() void {}
};
const world_loader = if (HAS_3D and HAS_COMPILED_WORLD) @import("dev_modules/game_runtime.zig") else struct {
    pub fn renderEmbedded(_: std.Io, _: *const std.process.Environ.Map, _: std.mem.Allocator, _: *Node, _: f32, _: f32, _: f32, _: f32, _: f32) bool {
        return false;
    }
    pub fn mouseLook(_: u32, _: f32, _: f32) void {}
    pub fn setAiming(_: u32, _: bool) void {}
    pub fn isExternalCamera(_: u32) bool {
        return false;
    }
    // MAPPAINT req_2473 stubs — the input loop's paint claim compiles unconditionally;
    // without the compiled world there is never an armed painter. (req_2520 caught the
    // gap: a cart without -Dhas-compiled-world failed at the paintArmed call site.)
    pub const PaintPhase = enum { down, move, up };
    pub fn paintArmed(_: u32) bool {
        return false;
    }
    pub fn anyPaintArmed() bool {
        return false;
    }
    pub fn paintPointer(_: std.Io, _: u32, _: PaintPhase, _: f32, _: f32) void {}
};
// WORLDWIN-0611: the compiled-world pop-out window — same gate as the loader
// it hosts. The stub keeps the loop call-sites unconditional.
const world_window = if (HAS_3D and HAS_COMPILED_WORLD) @import("gpu/world_window.zig") else struct {
    pub fn routeEvent(_: std.Io, _: *const c.SDL_Event) bool {
        return false;
    }
    pub fn frame(_: std.Io, _: *const std.process.Environ.Map) void {}
    pub fn deinitAll(_: std.Io) void {}
};
// PANELWIN-0628: the editor-panel pop-out window — renders a 2D React subtree
// into a second OS window (2nd monitor). Pure 2D, so no HAS_3D gate.
const panel_window = @import("gpu/panel_window.zig");
// Below this pane size (px), a Scene3D is a preview thumbnail, not an editable
// viewport — the mesh-edit vertex/edge overlay is suppressed there.
const EDITOR_OVERLAY_MIN_PANE: f32 = 128;
const transition = if (HAS_TRANSITIONS) @import("gpu/transition.zig") else struct {
    pub fn tick(_: f32) bool {
        return false;
    }
    pub fn needsRelayout() bool {
        return false;
    }
};
const physics2d = if (HAS_PHYSICS) @import("phys/physics2d.zig") else struct {
    pub const BodyType = enum(c_int) { static_body = 0, kinematic = 1, dynamic = 2 };
    pub fn init(_: f32, _: f32) void {}
    pub fn isInitialized() bool {
        return false;
    }
    pub fn tick(_: f32) void {}
    pub fn createBody(_: BodyType, _: f32, _: f32, _: f32, _: ?*Node) ?u32 {
        return null;
    }
    pub fn addBoxCollider(_: u32, _: f32, _: f32, _: f32, _: f32, _: f32) void {}
    pub fn addCircleCollider(_: u32, _: f32, _: f32, _: f32, _: f32) void {}
    pub fn setFixedRotation(_: u32, _: bool) void {}
    pub fn setBullet(_: u32, _: bool) void {}
    pub fn setGravityScale(_: u32, _: f32) void {}
    pub fn startDrag(_: f32, _: f32) void {}
    pub fn updateDrag(_: f32, _: f32) void {}
    pub fn endDrag() void {}
    pub fn isDragging() bool {
        return false;
    }
};
const Node = layout.Node;
const Color = layout.Color;
const TextEngine = text_mod.TextEngine;
const state_mod = @import("state/dirty.zig");
const witness = @import("testing/witness.zig");

// ── Devtools removed — inspector lives in tsz-tools ─────────────────────

// ── Cursor blink state ───────────────────────────────────────────────────
var g_cursor_visible: bool = true;
var g_prev_tick: u32 = 0;

// Host-side per-frame spike trace. Off by default; the cart flips it on via the
// `__hmsc_spike_trace` host fn (driven by `gv_perflog 2`). When on, every frame
// slower than the budget below logs its REAL phase breakdown to stderr — the
// host's ground truth, to cross-check the JS perfWatch report (which only
// samples telemetry ~60Hz and can mis-attribute). Logged with the gpu frame
// counter so its lines line up with the JS report.
pub var g_host_spike_trace: bool = false;
const HOST_SPIKE_TRACE_US: i64 = 12_000; // log frames slower than ~83fps

// ── Resize HUD state ────────────────────────────────────────────────────
var g_resize_hud_until_ms: u64 = 0;
var g_resize_hud_w: i32 = 0;
var g_resize_hud_h: i32 = 0;

// ── Physics 2D state ────────────────────────────────────────────────────
var physics_initialized: bool = false;

// ── Terminal state ──────────────────────────────────────────────────────
//
// Multi-terminal dispatch is now keyed by session name (the `session` prop on
// <Terminal>), not by a positional index. Each unique name maps to one Pipe
// in vterm.zig; the engine looks up state by name and lets the pipe registry
// be the source of truth for "does this terminal exist". No parallel
// `[MAX_TERMINALS]bool` arrays — `vterm_mod.getPipe(name)` answers that
// directly. The classifier mode doubles as the "have we auto-detected the
// inner CLI yet?" flag: `.none` means undetected, anything else means done.
var g_focused_session_buf: [64]u8 = undefined;
var g_focused_session: []const u8 = vterm_mod.DEFAULT_SESSION;

/// Set the focused session, copying the name into our owned buffer so the
/// slice stays valid even if the source (Node prop) gets freed.
fn setFocusedSession(name: []const u8) void {
    const len = @min(name.len, g_focused_session_buf.len);
    @memcpy(g_focused_session_buf[0..len], name[0..len]);
    g_focused_session = g_focused_session_buf[0..len];
}

var term_sel_active: bool = false;
var term_sel_dragging: bool = false;
var term_sel_start_row: u16 = 0;
var term_sel_start_col: u16 = 0;
var term_sel_end_row: u16 = 0;
var term_sel_end_col: u16 = 0;

fn termPixelToCell(tn: *Node, mx: f32, my: f32) struct { row: u16, col: u16 } {
    const r = tn.computed;
    const font_size = tn.terminal_font_size;
    const padding: f32 = 4;
    const cell_w = gpu.getCharWidth(font_size);
    const cell_h = gpu.getLineHeight(font_size);
    if (cell_w <= 0 or cell_h <= 0) return .{ .row = 0, .col = 0 };
    const local_x = @max(0, mx - r.x - padding);
    const local_y = @max(0, my - r.y - padding);
    return .{
        .row = @trunc(@min(@floor(local_y / cell_h), 255)),
        .col = @trunc(@min(@floor(local_x / cell_w), 255)),
    };
}

// True while a left-button press has been forwarded into a terminal whose
// inner program enabled mouse reporting. Drag motion events fire SGR drag
// updates only while this is set, and release fires the SGR release event.
var g_term_mouse_forwarding: bool = false;

// Format an SGR (1006) mouse event and write it to the focused PTY.
// `button` is the SGR button code (0=L, 1=M, 2=R, +32 for drag, 64=wheel-up,
// 65=wheel-down, 3=no-button motion). `action` is 'M' for press/drag/motion
// and 'm' for release. Coordinates are 1-based per the SGR spec.
fn forwardTermMouse(tn: *Node, session: []const u8, mx: f32, my: f32, button: u32, action: u8) void {
    const cell = termPixelToCell(tn, mx, my);
    var buf: [48]u8 = undefined;
    const seq = std.fmt.bufPrint(&buf, "\x1b[<{d};{d};{d}{c}", .{
        button, cell.col + 1, cell.row + 1, action,
    }) catch return;
    vterm_mod.writePtyByName(session, seq);
}

/// The session name for a Terminal node — `<Terminal session="...">` if set,
/// otherwise the implicit "default" session.
inline fn terminalSessionOf(node: *const Node) []const u8 {
    return node.terminal_session orelse vterm_mod.DEFAULT_SESSION;
}

fn termCellSelected(row: u16, col: u16) bool {
    if (!term_sel_active) return false;
    var r0 = term_sel_start_row;
    var c0 = term_sel_start_col;
    var r1 = term_sel_end_row;
    var c1 = term_sel_end_col;
    if (r0 > r1 or (r0 == r1 and c0 > c1)) {
        r0 = term_sel_end_row;
        c0 = term_sel_end_col;
        r1 = term_sel_start_row;
        c1 = term_sel_start_col;
    }
    if (row < r0 or row > r1) return false;
    if (r0 == r1) return col >= c0 and col <= c1;
    if (row == r0) return col >= c0;
    if (row == r1) return col <= c1;
    return true;
}

fn termClearSelection() void {
    term_sel_active = false;
    term_sel_dragging = false;
}

/// Find the Terminal node whose `session` prop matches `name`.
fn findTerminalNodeBySession(node: *Node, name: []const u8) ?*Node {
    if (node.terminal) {
        const ns = node.terminal_session orelse vterm_mod.DEFAULT_SESSION;
        if (std.mem.eql(u8, ns, name)) return node;
    }
    for (node.children) |*child| {
        if (findTerminalNodeBySession(child, name)) |found| return found;
    }
    return null;
}

/// Iterator-style walk: callback gets each Terminal node and its session
/// name. Caller passes a mutable context pointer. Used by the per-tick
/// poll/init loop and by wheel/click hit-tests that need to enumerate
/// every live terminal.
fn forEachTerminalNode(
    node: *Node,
    ctx: anytype,
    comptime visit: fn (@TypeOf(ctx), *Node, []const u8) void,
) void {
    if (node.terminal) {
        const ns = node.terminal_session orelse vterm_mod.DEFAULT_SESSION;
        visit(ctx, node, ns);
    }
    for (node.children) |*child| {
        forEachTerminalNode(child, ctx, visit);
    }
}

/// True when any pipe currently exists in the vterm registry.
fn anyTerminalInitialized() bool {
    return vterm_mod.pipeCount() > 0;
}

/// True when the named session has a pipe that the engine has seen at
/// least once (i.e. a Terminal node carries this name AND a PTY was spawned).
fn sessionInitialized(name: []const u8) bool {
    return vterm_mod.ptyAliveByName(name);
}

/// Route SDL key event to the terminal PTY as ANSI escape sequences.
fn terminalHandleKey(sym: i32, mod_state: u16) void {
    const session = g_focused_session;
    const ctrl = (mod_state & c.SDL_KMOD_CTRL) != 0;
    termClearSelection();
    vterm_mod.scrollToBottomByName(session);
    // Ctrl+letter → raw control character
    if (ctrl and sym >= 'a' and sym <= 'z') {
        const buf = [1]u8{@intCast(sym - 'a' + 1)};
        vterm_mod.writePtyByName(session, &buf);
        return;
    }
    // Special keys → ANSI escape sequences
    const seq: ?[]const u8 = switch (sym) {
        c.SDLK_RETURN => "\r",
        c.SDLK_BACKSPACE => "\x7f",
        c.SDLK_TAB => "\t",
        c.SDLK_ESCAPE => "\x1b",
        c.SDLK_UP => "\x1b[A",
        c.SDLK_DOWN => "\x1b[B",
        c.SDLK_RIGHT => "\x1b[C",
        c.SDLK_LEFT => "\x1b[D",
        c.SDLK_HOME => "\x1b[H",
        c.SDLK_END => "\x1b[F",
        c.SDLK_DELETE => "\x1b[3~",
        c.SDLK_PAGEUP => "\x1b[5~",
        c.SDLK_PAGEDOWN => "\x1b[6~",
        c.SDLK_INSERT => "\x1b[2~",
        c.SDLK_F1 => "\x1bOP",
        c.SDLK_F2 => "\x1bOQ",
        c.SDLK_F3 => "\x1bOR",
        c.SDLK_F4 => "\x1bOS",
        c.SDLK_F5 => "\x1b[15~",
        c.SDLK_F6 => "\x1b[17~",
        c.SDLK_F7 => "\x1b[18~",
        c.SDLK_F8 => "\x1b[19~",
        c.SDLK_F9 => "\x1b[20~",
        c.SDLK_F10 => "\x1b[21~",
        c.SDLK_F11 => "\x1b[23~",
        else => null,
    };
    if (seq) |s| vterm_mod.writePtyByName(session, s);
}

fn terminalHandleTextInput(text: [*:0]const u8) void {
    const session = g_focused_session;
    const slice = std.mem.span(text);
    log.print("[terminal:{s}] textInput: len={d} chars=\"{s}\"\n", .{ session, slice.len, slice });
    if (slice.len > 0) {
        termClearSelection();
        vterm_mod.scrollToBottomByName(session);
        vterm_mod.writePtyByName(session, slice);
    }
}

/// Walk the node tree to find Physics.World/Body/Collider nodes and set up the simulation.
fn initPhysicsFromTree(root: *Node) void {
    initPhysicsNode(root);
}

fn initPhysicsNode(node: *Node) void {
    if (node.physics_world) {
        physics2d.init(node.physics_gravity_x, node.physics_gravity_y);
        // Recurse into world children to find bodies
        for (node.children) |*child| {
            initPhysicsNode(child);
        }
        return;
    }
    if (node.physics_body) {
        // Create the physics body
        // Find the first visual child to link the body to
        var visual_child: ?*Node = null;
        var collider_child: ?*Node = null;
        for (node.children) |*child| {
            if (child.physics_collider) {
                collider_child = child;
            } else if (!child.physics_world and !child.physics_body) {
                visual_child = child;
            }
        }
        const body_type: physics2d.BodyType = switch (node.physics_body_type) {
            0 => .static_body,
            1 => .kinematic,
            else => .dynamic,
        };
        // Link to the visual child node (or self if no visual child)
        const target = visual_child orelse node;
        if (physics2d.createBody(body_type, node.physics_x, node.physics_y, node.physics_angle, target)) |idx| {
            node.physics_body_idx = @intCast(idx);
            // Apply body properties
            if (node.physics_fixed_rotation) physics2d.setFixedRotation(idx, true);
            if (node.physics_bullet) physics2d.setBullet(idx, true);
            if (node.physics_gravity_scale != 1.0) physics2d.setGravityScale(idx, node.physics_gravity_scale);
            // Attach collider if found
            if (collider_child) |col| {
                if (col.physics_shape == 1) {
                    // Circle
                    physics2d.addCircleCollider(idx, col.physics_radius, col.physics_density, col.physics_friction, col.physics_restitution);
                } else {
                    // Rectangle — use the visual child's dimensions or collider's own
                    const w = if (visual_child) |v| (v.style.width orelse 40) else 40;
                    const h = if (visual_child) |v| (v.style.height orelse 40) else 40;
                    physics2d.addBoxCollider(idx, w, h, col.physics_density, col.physics_friction, col.physics_restitution);
                }
            }
        }
        return;
    }
    // Recurse
    for (node.children) |*child| {
        initPhysicsNode(child);
    }
}

// ── Hover state ─────────────────────────────────────────────────────────

var hovered_node: ?*Node = null;
// Set pre-tick when hovered_node is non-null and the tick may invalidate
// the pointer; cleared post-layout after re-hit-testing at the cursor pos.
// See the long comment around the tick call.
var hover_needs_resolve: bool = false;
var cursor_hand: ?*c.SDL_Cursor = null;
var cursor_arrow: ?*c.SDL_Cursor = null;
var cursor_is_hand: bool = false;
const ScrollbarAxis = enum { vertical, horizontal };
const ScrollbarHit = struct {
    node: *Node,
    axis: ScrollbarAxis,
    track_start: f32,
    track_len: f32,
    thumb_start: f32,
    thumb_len: f32,
    max_scroll: f32,
};
var scrollbar_drag_slot: u32 = 0;
var scrollbar_drag_axis: ScrollbarAxis = .vertical;
var scrollbar_drag_track_start: f32 = 0;
var scrollbar_drag_track_len: f32 = 0;
var scrollbar_drag_thumb_len: f32 = 0;
var scrollbar_drag_offset: f32 = 0;
var scrollbar_drag_cached_max_scroll: f32 = 0;
var scrollbar_hover_slot: u32 = 0;
var scrollbar_hover_axis: ScrollbarAxis = .vertical;
var pointer_capture_slot: u32 = 0;
var pointer_capture_button: u8 = 0;
var world_loader_mouse_node_id: u32 = 0;
var world_loader_mouse_aiming: bool = false;
// MAPPAINT req_2473: the loader node whose armed paint tool owns the left-drag.
// While set, motion events route straight into the host map painter
// (world_loader.paintPointer) — zero JS per dab, the modelview input pattern
// applied to the world viewport.
var world_loader_paint_node_id: u32 = 0;

// ── Native mesh-editor input (modelview) — the engine owns the model-editor loop with
// ZERO JS per event. Gated by r3d.meshEditCapturing() (the cart sets it on a model load),
// and scoped to the viewport via meHitIsChrome so toolbar buttons/sliders still work.
// Middle-drag orbits, wheel zooms, double-click recentres focus, and left does the active
// tool: select/marquee (vertex/edge/face mode) or pan-pivot (Focus tool).
var me_orbiting: bool = false; // middle button held
var me_selecting: bool = false; // left held in a select mode (pick on press, marquee on drag)
var me_panning: bool = false; // left held with the Focus tool
var me_gizmo_dragging: bool = false; // left held on a transform gizmo handle
var me_gizmo_axis: i32 = -1;
var me_character_rig_gizmo_dragging: bool = false;
var me_bd_dragging: bool = false; // left held on the backdrop move gizmo (req_3080)
var me_lc_dragging: bool = false; // left held on the loop-cut plane handle (req_2625 DD)
var me_marquee: bool = false; // the select press travelled → became a marquee
var me_down_x: f32 = 0;
var me_down_y: f32 = 0;
var me_shift: bool = false;
// Ctrl-qualified gestures (req_4271): ctrl+click in edge mode path-picks (loop/ring
// cycling); ctrl+drag in face mode arms the marquee-projected CUT — the press defers
// its pick so a cut sweep never mutates the selection first.
var me_ctrl: bool = false;
var me_cut_armed: bool = false; // ctrl was down on a face-mode press → a drag cuts

// A hit is "chrome" (handle it normally) if it's an interactive control or
// pointer blocker. Everything else under the cursor (Scene3D, empty space) is
// the model viewport, which the native mesh-editor input owns.
fn meHitIsChrome(hit: ?*Node) bool {
    const h = hit orelse return false;
    return h.blocks_pointer_events or h.input_id != null or
        h.handlers.on_mouse_down != null or h.handlers.js_on_mouse_down != null or h.handlers.lua_on_mouse_down != null or
        h.handlers.on_press != null or h.handlers.js_on_press != null or h.handlers.lua_on_press != null or
        h.slider or h.href != null;
}

fn mapPaintHitIsChrome(root: *Node, mx: f32, my: f32) bool {
    if (hitTestSlider(root, mx, my) != null or hitTestScrollbar(root, mx, my) != null) return true;
    const hit = layout.hitTest(root, mx, my) orelse return false;
    if (hit.test_id) |test_id| {
        if (std.mem.eql(u8, test_id, "editor-world-input")) return false;
    }
    return meHitIsChrome(hit);
}
// <Slider> drag (SLIDER-0611) — engine-owned thumb, the scrollbar-drag wire
// applied to a value control. While slider_drag_slot != 0 every motion
// updates the pool node's slider_value and repaints with zero JS in the
// loop; the value streams to JS throttled (~60Hz, change-deduped) and the
// settle dispatch fires once on release.
var slider_drag_slot: u32 = 0;
var slider_drag_last_dispatch_ms: u32 = 0;
var slider_drag_last_sent: f32 = std.math.nan(f32);
// Media scrubber (MEDIASLIDER-0705) — keyframe seeks stream at most every
// SLIDER_MEDIA_SEEK_MS while dragging; release issues ONE exact seek and
// opens a settle window so the thumb holds the target instead of snapping
// back to the stale time-pos while mpv's demuxer catches up.
const SLIDER_MEDIA_SEEK_MS: u32 = 100;
const SLIDER_MEDIA_SETTLE_MS: u32 = 500;
var slider_media_last_seek_ms: u32 = 0;
var slider_media_settle_slot: u32 = 0;
var slider_media_settle_target: f32 = 0;
var slider_media_settle_until_ms: u32 = 0;
// Hover pointer-value: which slider the cursor is over and the last
// QUANTIZED bucket dispatched — JS only hears bucket transitions.
var slider_hover_slot: u32 = 0;
var slider_hover_last_bucket: i64 = std.math.minInt(i64);

fn findNodeByScrollSlot(node: *Node, slot: u32) ?*Node {
    if (slot == 0) return null;
    if (node.scroll_persist_slot == slot) return node;
    for (node.children) |*child| {
        if (findNodeByScrollSlot(child, slot)) |hit| return hit;
    }
    return null;
}

fn scrollableAxes(node: *Node, max_x: *f32, max_y: *f32) struct { x: bool, y: bool } {
    const r = node.computed;
    const ov = node.style.overflow;
    max_x.* = @max(0.0, node.content_width - r.w);
    max_y.* = @max(0.0, node.content_height - r.h);
    return .{
        .x = node.show_scrollbar and r.w > 0 and max_x.* > 0 and (ov == .scroll or ov == .auto),
        .y = node.show_scrollbar and r.h > 0 and max_y.* > 0 and (ov == .scroll or ov == .auto),
    };
}

fn scrollbarHitForNode(node: *Node, mx: f32, my: f32) ?ScrollbarHit {
    const r = node.computed;
    if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;

    var max_scroll_x: f32 = 0;
    var max_scroll_y: f32 = 0;
    const axes = scrollableAxes(node, &max_scroll_x, &max_scroll_y);
    if (!axes.x and !axes.y) return null;

    const inset: f32 = 2.0;
    const track_thickness: f32 = 3.0;
    const thumb_thickness: f32 = 4.0;
    const hit_thickness: f32 = 7.0;
    const min_thumb_len: f32 = 18.0;

    if (axes.y) {
        const track_x = switch (node.scrollbar_side) {
            .left => r.x + inset,
            else => r.x + r.w - inset - track_thickness,
        };
        const track_y = r.y + inset;
        const track_h = @max(0.0, r.h - inset * 2.0);
        const thumb_h = @min(track_h, @max(min_thumb_len, if (node.content_height > 0) (r.h * r.h / @max(node.content_height, 1.0)) else track_h));
        const thumb_y = if (max_scroll_y > 0)
            track_y + ((node.scroll_y / max_scroll_y) * @max(0.0, track_h - thumb_h))
        else
            track_y;
        const hit_center_x = track_x + thumb_thickness * 0.5;
        if (mx >= hit_center_x - hit_thickness * 0.5 and mx <= hit_center_x + hit_thickness * 0.5 and
            my >= thumb_y and my <= thumb_y + thumb_h)
        {
            return .{
                .node = node,
                .axis = .vertical,
                .track_start = track_y,
                .track_len = track_h,
                .thumb_start = thumb_y,
                .thumb_len = thumb_h,
                .max_scroll = max_scroll_y,
            };
        }
    }

    if (axes.x) {
        const track_y = switch (node.scrollbar_side) {
            .top => r.y + inset,
            else => r.y + r.h - inset - track_thickness,
        };
        const track_x = r.x + inset;
        const track_w = @max(0.0, r.w - inset * 2.0);
        const thumb_w = @min(track_w, @max(min_thumb_len, if (node.content_width > 0) (r.w * r.w / @max(node.content_width, 1.0)) else track_w));
        const thumb_x = if (max_scroll_x > 0)
            track_x + ((node.scroll_x / max_scroll_x) * @max(0.0, track_w - thumb_w))
        else
            track_x;
        const hit_center_y = track_y + thumb_thickness * 0.5;
        if (my >= hit_center_y - hit_thickness * 0.5 and my <= hit_center_y + hit_thickness * 0.5 and
            mx >= thumb_x and mx <= thumb_x + thumb_w)
        {
            return .{
                .node = node,
                .axis = .horizontal,
                .track_start = track_x,
                .track_len = track_w,
                .thumb_start = thumb_x,
                .thumb_len = thumb_w,
                .max_scroll = max_scroll_x,
            };
        }
    }

    return null;
}

fn hitTestScrollbar(node: *Node, mx: f32, my: f32) ?ScrollbarHit {
    if (node.style.display == .none) return null;

    const r = node.computed;
    // No AABB pre-reject on `node` itself — an absolute-positioned scroll
    // container (e.g. the model picker popover) extends past its anchor's
    // bounds, and pre-rejecting here would prevent the walker from ever
    // reaching it. scrollbarHitForNode does its own bounds check before
    // returning a hit, so removing the early reject is safe.

    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and (node.content_height > r.h or node.content_width > r.w)));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        child_mx = mx + node.scroll_x;
        child_my = my + node.scroll_y;
    }

    // Descend first so deepest scrollbar wins (front-most paint).
    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTestScrollbar(&node.children[i], child_mx, child_my)) |hit| return hit;
    }

    // Self last. Scrollbars are painted after children, so the owning node's
    // overlay wins only when no descendant claimed the hit.
    if (scrollbarHitForNode(node, mx, my)) |hit| return hit;
    return null;
}

fn hitTestWorldLoader(node: *Node, mx: f32, my: f32) ?*Node {
    if (node.style.display == .none) return null;

    const r = node.computed;
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        child_mx = mx + node.scroll_x;
        child_my = my + node.scroll_y;
    }

    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTestWorldLoader(&node.children[i], child_mx, child_my)) |hit| return hit;
    }

    if (node.world_loader and mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
        return node;
    }
    return null;
}

fn findWorldLoaderNodeById(node: *Node, id: u32) ?*Node {
    if (id == 0 or node.style.display == .none) return null;
    if (node.world_loader and node.id == id) return node;
    for (node.children) |*child| {
        if (findWorldLoaderNodeById(child, id)) |hit| return hit;
    }
    return null;
}

// <Slider> hit walker (SLIDER-0611) — deepest slider node containing the
// point, honoring scroll offsets exactly like hitTestWorldLoader above.
fn hitTestSlider(node: *Node, mx: f32, my: f32) ?*Node {
    if (node.style.display == .none) return null;

    const r = node.computed;
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        child_mx = mx + node.scroll_x;
        child_my = my + node.scroll_y;
    }

    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTestSlider(&node.children[i], child_mx, child_my)) |hit| return hit;
    }

    if (node.slider and mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
        return node;
    }
    return null;
}

// Slider geometry shared by paint + drag: the knob is a square of the node's
// height (capped), and the value span is the track minus one knob width so
// the knob center maps [min..max] without overhanging the rect.
fn sliderKnobW(r: layout.LayoutRect) f32 {
    return slider_math.knobW(r.h);
}

fn sliderSnap(node: *Node, raw: f32) f32 {
    return slider_math.snap(node.slider_min, node.slider_max, node.slider_step, raw);
}

fn dispatchSliderJs(host: *HostContext, comptime fmt: []const u8, slot: u32, value: f32) void {
    var buf: [96]u8 = undefined;
    if (std.fmt.bufPrintZ(&buf, fmt, .{ slot, value })) |expr| {
        js_vm.callGlobal(host, "__beginJsEvent");
        js_vm.evalExpr(host, expr);
        js_vm.callGlobal(host, "__endJsEvent");
    } else |_| {}
}

// Pointer-value plumbing shared by hover and drag (MEDIASLIDER-0705): write
// the tooltip-left latch every move (zero JS — the cart binds it via
// left:'latch:KEY'), dispatch __dispatchSliderHover ONLY when the quantized
// bucket changes. Quantize-by-meaning, not throttle-by-time.
fn updateSliderPointerValue(host: *HostContext, node: *Node, slot: u32, mx: f32, value: f32) void {
    if (!node.slider_hover) return;
    const r = node.computed;
    if (node.slider_hover_latch_key) |key| {
        latches.set(key, slider_math.tooltipLeft(mx - r.x, r.w, node.slider_hover_w));
    }
    if (slot != slider_hover_slot) {
        slider_hover_slot = slot;
        slider_hover_last_bucket = std.math.minInt(i64);
    }
    const bucket = slider_math.hoverBucket(value, node.slider_hover_step);
    if (bucket != slider_hover_last_bucket) {
        slider_hover_last_bucket = bucket;
        dispatchSliderJs(host, "__dispatchSliderHover({d},{d})", slot, slider_math.bucketValue(bucket, node.slider_hover_step));
    }
}

// Cursor moved without a slider drag active: track hover enter/move/leave.
// Leave dispatches value -1 once so the cart can hide its tooltip.
fn updateSliderHover(host: *HostContext, root: *Node, mx: f32, my: f32) void {
    const hit = hitTestSlider(root, mx, my);
    if (hit == null or !hit.?.slider_hover or hit.?.scroll_persist_slot == 0) {
        if (slider_hover_slot != 0) {
            const slot = slider_hover_slot;
            slider_hover_slot = 0;
            slider_hover_last_bucket = std.math.minInt(i64);
            dispatchSliderJs(host, "__dispatchSliderHover({d},{d})", slot, -1.0);
        }
        return;
    }
    const node = hit.?;
    const r = node.computed;
    const knob_w = sliderKnobW(r);
    const frac = slider_math.fracFromMouse(mx, r.x, r.w, knob_w);
    const value = sliderSnap(node, node.slider_min + frac * (node.slider_max - node.slider_min));
    updateSliderPointerValue(host, node, node.scroll_persist_slot, mx, value);
}

fn updateSliderDrag(host: *HostContext, root: *Node, mx: f32) void {
    if (slider_drag_slot == 0) return;
    const node = findNodeByScrollSlot(root, slider_drag_slot) orelse return;
    const r = node.computed;
    const knob_w = sliderKnobW(r);
    const frac = slider_math.fracFromMouse(mx, r.x, r.w, knob_w);
    const next = sliderSnap(node, node.slider_min + frac * (node.slider_max - node.slider_min));
    node.slider_value = next;
    state_mod.markDirty();

    const now_ms: u32 = @intCast(c.SDL_GetTicks() & 0xFFFFFFFF);

    // Stream the value (throttled + change-deduped) so the cart can mirror
    // it live; the AUTHORITATIVE write is the commit dispatch on release.
    if (next != slider_drag_last_sent and now_ms -% slider_drag_last_dispatch_ms >= 16) {
        slider_drag_last_dispatch_ms = now_ms;
        slider_drag_last_sent = next;
        dispatchSliderJs(host, "__dispatchSliderChange({d},{d})", slider_drag_slot, next);
    }

    // Media-bound scrub (MEDIASLIDER-0705): stream cheap keyframe seeks so
    // the video chases the thumb; the exact seek happens once on release.
    if (node.slider_media_src) |src| {
        if (now_ms -% slider_media_last_seek_ms >= SLIDER_MEDIA_SEEK_MS) {
            slider_media_last_seek_ms = now_ms;
            videos.seek(src, next);
        }
    }

    // The drag thumb IS the pointer value — tooltip follows it.
    updateSliderPointerValue(host, node, slider_drag_slot, mx, next);
}

fn endSliderDrag(host: *HostContext, root: *Node) void {
    if (slider_drag_slot == 0) return;
    const slot = slider_drag_slot;
    slider_drag_slot = 0;
    if (findNodeByScrollSlot(root, slot)) |node| {
        node.slider_dragging = false;
        // Media-bound settle: ONE frame-accurate seek, then hold the
        // displayed value at the target until mpv converges (or the
        // window expires) so the thumb never snaps back mid-seek.
        if (node.slider_media_src) |src| {
            videos.seekExact(src, node.slider_value);
            slider_media_settle_slot = slot;
            slider_media_settle_target = node.slider_value;
            slider_media_settle_until_ms = @as(u32, @intCast(c.SDL_GetTicks() & 0xFFFFFFFF)) +% SLIDER_MEDIA_SETTLE_MS;
        }
        dispatchSliderJs(host, "__dispatchSliderCommit({d},{d})", slot, node.slider_value);
        state_mod.markDirty();
    }
}

// Per-frame follow for media-bound sliders (MEDIASLIDER-0705): the engine
// owns value + range end to end. Range auto-sets to [0, duration] once mpv
// reports it; when idle the value tracks time-pos with zero JS anywhere in
// the loop. Called right after videos.update(); gated on any video existing
// so carts without media pay nothing.
fn tickMediaSliders(node: *Node) void {
    if (node.slider) {
        if (node.slider_media_src) |src| followMediaSlider(node, src);
    }
    for (node.children) |*child| tickMediaSliders(child);
}

fn followMediaSlider(node: *Node, src: []const u8) void {
    if (videos.getDuration(src)) |dur| {
        const dur_f: f32 = @floatCast(dur);
        if (dur_f > 0 and node.slider_max != dur_f) {
            node.slider_min = 0;
            node.slider_max = dur_f;
            state_mod.markDirty();
        }
    }
    if (node.slider_dragging) return;

    const slot = node.scroll_persist_slot;
    if (slider_media_settle_slot != 0 and slider_media_settle_slot == slot) {
        const now_ms: u32 = @intCast(c.SDL_GetTicks() & 0xFFFFFFFF);
        const t = videos.getCurrentTime(src) orelse slider_media_settle_target;
        if (slider_math.settleHold(now_ms, slider_media_settle_until_ms, t, slider_media_settle_target)) {
            if (node.slider_value != slider_media_settle_target) {
                node.slider_value = slider_media_settle_target;
                state_mod.markDirty();
            }
            return;
        }
        slider_media_settle_slot = 0;
    }

    const t = videos.getCurrentTime(src) orelse return;
    const next: f32 = @floatCast(t);
    if (@abs(next - node.slider_value) > 0.005) {
        node.slider_value = next;
        state_mod.markDirty();
    }
}

fn captureWorldLoaderPointer(node: *Node) void {
    world_loader_mouse_node_id = node.id;
    input.unfocus();
    _ = setRelativeMouseMode(true);
}

fn releaseWorldLoaderPointer() void {
    if (world_loader_mouse_node_id != 0 and world_loader_mouse_aiming) {
        world_loader.setAiming(world_loader_mouse_node_id, false);
    }
    world_loader_mouse_node_id = 0;
    world_loader_mouse_aiming = false;
    _ = setRelativeMouseMode(false);
}

fn updateScrollbarDrag(host: *HostContext, root: *Node, pos: f32) bool {
    if (scrollbar_drag_slot == 0) return false;
    const node = findNodeByScrollSlot(root, scrollbar_drag_slot) orelse return false;
    const movable = @max(0.0, scrollbar_drag_track_len - scrollbar_drag_thumb_len);
    if (movable <= 0 or scrollbar_drag_cached_max_scroll <= 0) return true;

    const raw_thumb_start = pos - scrollbar_drag_offset;
    const thumb_start = @max(scrollbar_drag_track_start, @min(raw_thumb_start, scrollbar_drag_track_start + movable));
    const next_scroll = ((thumb_start - scrollbar_drag_track_start) / movable) * scrollbar_drag_cached_max_scroll;

    switch (scrollbar_drag_axis) {
        .vertical => {
            const prev = node.scroll_y;
            node.scroll_y = @max(0.0, @min(next_scroll, scrollbar_drag_cached_max_scroll));
            if (node.scroll_y != prev) dispatchScrollChanged(host, node, 0, node.scroll_y - prev);
        },
        .horizontal => {
            const prev = node.scroll_x;
            node.scroll_x = @max(0.0, @min(next_scroll, scrollbar_drag_cached_max_scroll));
            if (node.scroll_x != prev) dispatchScrollChanged(host, node, node.scroll_x - prev, 0);
        },
    }
    return true;
}

fn setPointerCursor(active: bool) void {
    if (active) {
        if (!cursor_is_hand) {
            if (cursor_hand == null) cursor_hand = c.SDL_CreateSystemCursor(c.SDL_SYSTEM_CURSOR_POINTER);
            if (cursor_hand) |cur| _ = c.SDL_SetCursor(cur);
            cursor_is_hand = true;
        }
    } else if (cursor_is_hand) {
        if (cursor_arrow == null) cursor_arrow = c.SDL_CreateSystemCursor(c.SDL_SYSTEM_CURSOR_DEFAULT);
        if (cursor_arrow) |cur| _ = c.SDL_SetCursor(cur);
        cursor_is_hand = false;
    }
}

fn updateHover(host: *HostContext, root: *Node, mx: f32, my: f32) void {
    const scrollbar_hover = hitTestScrollbar(root, mx, my);
    if (scrollbar_hover) |hit| {
        if (scrollbar_hover_slot != hit.node.scroll_persist_slot or scrollbar_hover_axis != hit.axis) {
            scrollbar_hover_slot = hit.node.scroll_persist_slot;
            scrollbar_hover_axis = hit.axis;
            markScrollActivity(hit.node);
        }
    } else {
        scrollbar_hover_slot = 0;
    }

    const events = @import("events.zig");
    const hit = events.hitTestHoverable(root, mx, my);
    if (hit == hovered_node) {
        setPointerCursor(scrollbar_hover != null or (hit != null and hit.?.href != null));
        return;
    }

    // Exit previous
    if (hovered_node) |prev| {
        if (prev.handlers.on_hover_exit) |handler| handler(prev.handlers.context);
        if (prev.handlers.js_on_hover_exit) |js_expr| {
            js_vm.callGlobal(host, "__beginJsEvent");
            js_vm.evalExpr(host, std.mem.span(js_expr));
            js_vm.callGlobal(host, "__endJsEvent");
            state_mod.markDirty();
        }
    }
    hovered_node = hit;
    // Enter new
    if (hit) |node| {
        if (node.handlers.on_hover_enter) |handler| handler(node.handlers.context);
        if (node.handlers.js_on_hover_enter) |js_expr| {
            js_vm.callGlobal(host, "__beginJsEvent");
            js_vm.evalExpr(host, std.mem.span(js_expr));
            js_vm.callGlobal(host, "__endJsEvent");
            state_mod.markDirty();
        }
        // Tooltip: show if node carries tooltip text. `node.computed` is in
        // content space — translate to screen space by subtracting the
        // cumulative scroll offset of every scroll-ancestor.
        if (node.tooltip) |tt| {
            const r = node.computed;
            const off = events.cumulativeScrollOffset(root, node);
            tooltip.show(tt, r.x - off.sx, r.y - off.sy, r.w, r.h);
        } else {
            tooltip.hide();
        }
        setPointerCursor(scrollbar_hover != null or node.href != null);
    } else {
        tooltip.hide();
        setPointerCursor(scrollbar_hover != null);
    }
}

fn brighten(color: Color, amount: u8) Color {
    return .{
        .r = @min(255, @as(u16, color.r) + amount),
        .g = @min(255, @as(u16, color.g) + amount),
        .b = @min(255, @as(u16, color.b) + amount),
        .a = color.a,
    };
}

// ── App interface ────────────────────────────────────────────────────────

pub const AppConfig = struct {
    host: *HostContext,
    /// Root-owned diagnostics sink. Producers only enqueue; the engine flushes
    /// their bounded queues once per frame at the blocking boundary.
    diag_sink: *@import("diag/log.zig").Sink,
    title: [*:0]const u8 = "tsz app",
    width: u32 = 1280,
    height: u32 = 800,
    min_width: u32 = 320,
    min_height: u32 = 240,
    root: *Node,
    js_logic: []const u8 = "",
    lua_logic: []const u8 = "",
    /// Called once after QuickJS VM is ready. Register FFI host functions, set initial state.
    init: ?*const fn (*HostContext) void = null,
    /// Called every frame before layout. Do FFI polling, state dirty checks, dynamic text updates.
    tick: ?*const fn (*HostContext, now_ms: u32) void = null,
    /// Hot-reload callback — called at the start of each frame.
    /// If it returns true, root/init/tick were swapped and the engine re-inits.
    check_reload: ?*const fn (*HostContext, *AppConfig) bool = null,
    /// Called after init during a hot-reload, before tick. Used for state restoration.
    post_reload: ?*const fn (*HostContext) void = null,
    /// Called once during shutdown while host runtimes are still alive.
    shutdown: ?*const fn (*HostContext) void = null,
    /// Borderless window — removes OS window decorations (title bar, borders).
    /// The app must provide its own chrome using window_drag / window_resize nodes.
    borderless: bool = false,
    /// Keep the OS window above normal windows.
    always_on_top: bool = false,
    /// Prevent the OS window from accepting input focus.
    not_focusable: bool = false,
    /// Initial window position. Null keeps SDL/geometry default behavior.
    x: ?c_int = null,
    y: ?c_int = null,
    /// Optional callback that writes canvas_gx/gy directly to the host's Node pool
    /// (not the per-frame arena copy). Used by Alt+drag so the tile follows the
    /// cursor without firing a per-motion setState through React (which would
    /// re-render the entire Canvas.Node subtree every mouse event).
    set_canvas_node_position: ?*const fn (id: u32, gx: f32, gy: f32) void = null,
    /// Optional callback for hosts that want to intercept `__dispatchEvent(...)`
    /// handler expressions instead of evaluating them in the embedded JS VM.
    dispatch_js_event: ?*const fn (id: u32, handler: []const u8) void = null,
};

// ── Text measurement (framework-owned) ──────────────────────────────────

var g_text_engine: ?*TextEngine = null;
var g_dispatch_js_event: ?*const fn (id: u32, handler: []const u8) void = null;

// ── Custom window chrome (borderless mode) ──────────────────────────────

var g_chrome_root: ?*Node = null; // root node for hit-test callback
var g_chrome_window: ?*c.SDL_Window = null; // window pointer for control functions
var g_main_window: ?*c.SDL_Window = null;
const CHROME_DOUBLE_CLICK_MS: u32 = 400;
const CHROME_DOUBLE_CLICK_DIST: f32 = 8;
var g_chrome_last_click_ms: u32 = 0;
var g_chrome_last_click_x: f32 = 0;
var g_chrome_last_click_y: f32 = 0;
var g_chrome_dragging: bool = false;
var g_chrome_drag_mouse_x: f32 = 0;
var g_chrome_drag_mouse_y: f32 = 0;
var g_chrome_drag_window_x: c_int = 0;
var g_chrome_drag_window_y: c_int = 0;

// SIGINT/SIGTERM handler — flips a flag the main loop polls so the existing
// defer cleanup (SDL_Quit, geometry.save, SDL_CaptureMouse(false), etc.) runs
// on graceful shutdown. Without this, scripts/dev's `kill -TERM` is dropped on
// the floor (signal was previously ignored), the 0.5s grace period expires,
// and `kill -KILL` skips every defer — leaving SDL_CaptureMouse held on the
// X server, which manifests next session as a window glued to the cursor.
var g_received_quit_signal: bool = false;
fn quitSignalHandler(_: c_int) callconv(.c) void {
    g_received_quit_signal = true;
}

pub fn setRelativeMouseMode(enabled: bool) bool {
    const window = g_main_window orelse return false;
    return c.SDL_SetWindowRelativeMouseMode(window, enabled);
}

/// SDL hit-test callback — called by SDL to determine what region of a borderless
/// window the cursor is in. Walks the node tree looking for window_drag / window_resize nodes.
fn windowHitTestCallback(
    _: ?*c.SDL_Window,
    point: ?*const c.SDL_Point,
    _: ?*anyopaque,
) callconv(std.builtin.CallingConvention.c) c.SDL_HitTestResult {
    const root = g_chrome_root orelse return c.SDL_HITTEST_NORMAL;
    const pt = point orelse return c.SDL_HITTEST_NORMAL;
    const mx: f32 = @floatFromInt(pt.x);
    const my: f32 = @floatFromInt(pt.y);

    // Scrollbars sit on the inner edge of scroll containers and aren't real
    // DOM nodes, so they lose to any window_resize node along the same window
    // edge. Give them priority — otherwise the right-edge vertical scrollbar
    // is unclickable because SDL grabs the click for a window resize.
    if (hitTestScrollbar(root, mx, my)) |_| return c.SDL_HITTEST_NORMAL;

    // Resize still uses SDL's native hit-test. Drag regions are handled in the
    // event loop so the framework can count clicks before moving the window.
    if (hitTestChrome(root, mx, my)) |result| {
        if (result == c.SDL_HITTEST_DRAGGABLE) return c.SDL_HITTEST_NORMAL;
        return result;
    }
    return c.SDL_HITTEST_NORMAL;
}

fn hitTestChrome(node: *Node, mx: f32, my: f32) ?c.SDL_HitTestResult {
    if (node.style.display == .none) return null;
    const r = node.computed;
    // Only test nodes the cursor is actually inside
    if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;

    // Children first (deeper nodes take priority)
    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTestChrome(&node.children[i], mx, my)) |result| return result;
    }

    // Interactive nodes (buttons, inputs) override drag — let clicks through
    if (node.handlers.on_press != null or node.handlers.js_on_press != null or
        node.handlers.lua_on_press != null or node.input_id != null)
        return c.SDL_HITTEST_NORMAL;

    // Check this node
    if (node.window_drag) return c.SDL_HITTEST_DRAGGABLE;
    if (node.window_resize) return chromeResizeEdge(node, mx, my);

    return null;
}

fn resetChromeDoubleClick() void {
    g_chrome_last_click_ms = 0;
    g_chrome_last_click_x = 0;
    g_chrome_last_click_y = 0;
}

fn isDraggableChromeHit(mx: f32, my: f32) bool {
    const root = g_chrome_root orelse return false;
    if (hitTestChrome(root, mx, my)) |ht| return ht == c.SDL_HITTEST_DRAGGABLE;
    return false;
}

fn trackChromeDoubleClick(now_ms: u32, mx: f32, my: f32, sdl_clicks: u8) bool {
    if (!isDraggableChromeHit(mx, my)) {
        resetChromeDoubleClick();
        return false;
    }

    if (sdl_clicks == 2) {
        resetChromeDoubleClick();
        return true;
    }
    if (sdl_clicks > 1) {
        resetChromeDoubleClick();
        return false;
    }

    const dt = now_ms -| g_chrome_last_click_ms;
    const dx = mx - g_chrome_last_click_x;
    const dy = my - g_chrome_last_click_y;
    const close_enough = dx * dx + dy * dy <= CHROME_DOUBLE_CLICK_DIST * CHROME_DOUBLE_CLICK_DIST;
    const is_double = g_chrome_last_click_ms != 0 and dt <= CHROME_DOUBLE_CLICK_MS and close_enough;
    if (is_double) {
        resetChromeDoubleClick();
        return true;
    }

    g_chrome_last_click_ms = now_ms;
    g_chrome_last_click_x = mx;
    g_chrome_last_click_y = my;
    return false;
}

fn beginChromeDrag(mx: f32, my: f32) void {
    const w = g_chrome_window orelse return;
    if (windowIsMaximized()) return;

    var wx: c_int = 0;
    var wy: c_int = 0;
    var gx: f32 = mx;
    var gy: f32 = my;
    _ = c.SDL_GetWindowPosition(w, &wx, &wy);
    _ = c.SDL_GetGlobalMouseState(&gx, &gy);
    g_chrome_dragging = true;
    g_chrome_drag_mouse_x = gx;
    g_chrome_drag_mouse_y = gy;
    g_chrome_drag_window_x = wx;
    g_chrome_drag_window_y = wy;
    _ = c.SDL_CaptureMouse(true);
}

fn updateChromeDrag() void {
    const w = g_chrome_window orelse return;
    if (!g_chrome_dragging) return;

    var gx: f32 = 0;
    var gy: f32 = 0;
    _ = c.SDL_GetGlobalMouseState(&gx, &gy);
    const dx = gx - g_chrome_drag_mouse_x;
    const dy = gy - g_chrome_drag_mouse_y;
    const next_x: c_int = @round(@as(f32, @floatFromInt(g_chrome_drag_window_x)) + dx);
    const next_y: c_int = @round(@as(f32, @floatFromInt(g_chrome_drag_window_y)) + dy);
    _ = c.SDL_SetWindowPosition(w, next_x, next_y);
}

fn endChromeDrag() void {
    g_chrome_dragging = false;
    _ = c.SDL_CaptureMouse(false);
}

/// Determine which resize edge based on the node's position in the window.
/// Uses the root node's bounds to figure out which side this edge node is on.
fn chromeResizeEdge(node: *Node, mx: f32, my: f32) c.SDL_HitTestResult {
    const root = g_chrome_root orelse return c.SDL_HITTEST_NORMAL;
    const win_w = root.computed.w;
    const win_h = root.computed.h;
    const r = node.computed;

    // Node center relative to window
    const ncx = r.x + r.w / 2;
    const ncy = r.y + r.h / 2;
    const half_w = win_w / 2;
    const half_h = win_h / 2;

    // Corner zone: if cursor is near a window corner (within 20px)
    const corner_thresh: f32 = 20;
    const near_win_left = mx < corner_thresh;
    const near_win_right = mx > (win_w - corner_thresh);
    const near_win_top = my < corner_thresh;
    const near_win_bottom = my > (win_h - corner_thresh);

    if (near_win_top and near_win_left) return c.SDL_HITTEST_RESIZE_TOPLEFT;
    if (near_win_top and near_win_right) return c.SDL_HITTEST_RESIZE_TOPRIGHT;
    if (near_win_bottom and near_win_left) return c.SDL_HITTEST_RESIZE_BOTTOMLEFT;
    if (near_win_bottom and near_win_right) return c.SDL_HITTEST_RESIZE_BOTTOMRIGHT;

    // Edge: determine by where the node sits in the window
    if (r.w > r.h) {
        // Wide node = horizontal edge → top or bottom based on position
        return if (ncy > half_h) c.SDL_HITTEST_RESIZE_BOTTOM else c.SDL_HITTEST_RESIZE_TOP;
    } else {
        // Tall node = vertical edge → left or right based on position
        return if (ncx > half_w) c.SDL_HITTEST_RESIZE_RIGHT else c.SDL_HITTEST_RESIZE_LEFT;
    }
}

/// Close the window (for custom close button).
pub fn windowClose() void {
    if (witness.isReplaying()) return; // don't let snapshot/replay clicks kill the process
    if (g_chrome_window) |_| {
        // Push a close event so the normal shutdown path runs
        var event: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
        event.type = c.SDL_EVENT_QUIT;
        _ = c.SDL_PushEvent(&event);
    }
}

/// Minimize the window (for custom minimize button).
pub fn windowMinimize() void {
    if (g_chrome_window) |w| _ = c.SDL_MinimizeWindow(w);
}

/// Maximize or restore the window (toggles, for custom maximize button).
pub fn windowMaximize() void {
    if (g_chrome_window) |w| {
        const flags = c.SDL_GetWindowFlags(w);
        if ((flags & c.SDL_WINDOW_MAXIMIZED) != 0) {
            _ = c.SDL_RestoreWindow(w);
        } else {
            _ = c.SDL_MaximizeWindow(w);
        }
    }
}

/// Query whether the window is currently maximized.
pub fn windowIsMaximized() bool {
    if (g_chrome_window) |w| {
        return (c.SDL_GetWindowFlags(w) & c.SDL_WINDOW_MAXIMIZED) != 0;
    }
    return false;
}

/// Open a URL — if the app has a JS _browserNavigate handler, navigate in-app.
/// Otherwise open in the system browser via xdg-open.
fn openUrl(io: std.Io, url: []const u8) void {
    log.info(.events, "openUrl: {s}", .{url});
    // Try in-app navigation first (browser cart defines _browserNavigate in JS).
    // The QJS-side hasGlobal/callGlobalStr was archived (archive/qjs-stack/);
    // a V8 equivalent (e.g. v8_runtime.callGlobalIfDefined) needs to land
    // before in-app navigation re-activates. Falling through to xdg-open.
    if (false) {
        var url_buf: [2048]u8 = undefined;
        if (url.len < url_buf.len) {
            @memcpy(url_buf[0..url.len], url);
            url_buf[url.len] = 0;
            return;
        }
    }
    var cmd_buf: [2048]u8 = undefined;
    const cmd = std.fmt.bufPrint(&cmd_buf, "xdg-open '{s}' &", .{url}) catch return;
    const argv = [_][]const u8{ "sh", "-c", cmd };
    var child = std.process.spawn(io, .{ .argv = &argv }) catch return;
    _ = child.wait(io) catch {};
}

fn tryParseDispatchEventExpr(expr: []const u8) ?struct { id: u32, handler: []const u8 } {
    const prefix = "__dispatchEvent(";
    if (!std.mem.startsWith(u8, expr, prefix)) return null;
    var rest = expr[prefix.len..];
    const comma = std.mem.indexOfScalar(u8, rest, ',') orelse return null;
    const id = std.fmt.parseInt(u32, std.mem.trim(u8, rest[0..comma], " \t\r\n"), 10) catch return null;
    rest = std.mem.trimStart(u8, rest[comma + 1 ..], " \t\r\n");
    if (rest.len < 3 or rest[0] != '\'') return null;
    const end = std.mem.indexOfScalarPos(u8, rest, 1, '\'') orelse return null;
    const handler = rest[1..end];
    const suffix = std.mem.trim(u8, rest[end + 1 ..], " \t\r\n");
    if (!std.mem.startsWith(u8, suffix, ")") and !std.mem.startsWith(u8, suffix, ",")) return null;
    return .{ .id = id, .handler = handler };
}

fn runJsHandlerExpr(host: *HostContext, expr: []const u8) void {
    if (g_dispatch_js_event) |dispatch| {
        if (tryParseDispatchEventExpr(expr)) |event| {
            dispatch(event.id, event.handler);
            state_mod.markDirty();
            return;
        }
    }
    js_vm.callGlobal(host, "__beginJsEvent");
    js_vm.evalExpr(host, expr);
    js_vm.callGlobal(host, "__endJsEvent");
    state_mod.markDirty();
}

fn dispatchPointerHandler(host: *HostContext, node: *Node, comptime kind: enum { down, move, up }) void {
    const handlers = &node.handlers;
    switch (kind) {
        .down => {
            if (handlers.on_mouse_down) |handler| handler(handlers.context);
            if (handlers.js_on_mouse_down) |js_expr| runJsHandlerExpr(host, std.mem.span(js_expr));
            if (handlers.lua_on_mouse_down) |lua_expr| luajit_runtime.evalExpr(std.mem.span(lua_expr));
        },
        .move => {
            if (handlers.on_mouse_move) |handler| handler(handlers.context);
            if (handlers.js_on_mouse_move) |js_expr| runJsHandlerExpr(host, std.mem.span(js_expr));
            if (handlers.lua_on_mouse_move) |lua_expr| luajit_runtime.evalExpr(std.mem.span(lua_expr));
        },
        .up => {
            if (handlers.on_mouse_up) |handler| handler(handlers.context);
            if (handlers.js_on_mouse_up) |js_expr| runJsHandlerExpr(host, std.mem.span(js_expr));
            if (handlers.lua_on_mouse_up) |lua_expr| luajit_runtime.evalExpr(std.mem.span(lua_expr));
        },
    }
}

fn nodeWantsPointerCapture(node: *const Node) bool {
    const h = node.handlers;
    return h.on_mouse_move != null or h.js_on_mouse_move != null or h.lua_on_mouse_move != null or
        h.on_mouse_up != null or h.js_on_mouse_up != null or h.lua_on_mouse_up != null;
}

fn measureCallback(t: []const u8, font_size: u16, font_family_id: u8, max_width: f32, letter_spacing: f32, line_height: f32, max_lines: u16, no_wrap: bool, bold: bool) layout.TextMetrics {
    if (g_text_engine) |te| {
        // gpu_text holds the active-weight flag — set it for the duration of
        // the measurement so glyph advances pull from the right atlas face,
        // then restore. Mirrors the paint path (drawNodeTextCommon).
        gpu.setFontFamily(font_family_id);
        defer gpu.setFontFamily(0);
        gpu.setBold(bold);
        defer gpu.setBold(false);
        return te.measureTextWrappedEx(t, font_size, max_width, letter_spacing, line_height, max_lines, no_wrap, bold);
    }
    return .{};
}

fn measureWidthOnly(t: []const u8, font_size: u16) f32 {
    if (g_text_engine) |te| {
        return te.measureTextWrappedEx(t, font_size, 0, 0, 0, 1, true, false).width;
    }
    return 0;
}

fn drawNodeTextCommon(node: *Node, text: []const u8, x: f32, y: f32, max_width: f32, max_lines: u16, color: Color) f32 {
    const final_a = @as(f32, color.a) / 255.0 * g_paint_opacity;
    gpu.resetInlineSlots();
    if (node.text_effect) |ename| {
        if (effects.getEffectFill(ename)) |info| {
            gpu.setTextEffect(info.pixel_buf, info.width, info.height, info.screen_x, info.screen_y);
        }
    }
    if (node.line_height > 0) gpu.setLineHeightOverride(node.line_height);
    if (node.letter_spacing != 0) gpu.setLetterSpacing(node.letter_spacing);
    const bold = node.font_weight >= 600;
    if (node.font_family_id != 0) gpu.setFontFamily(node.font_family_id);
    if (bold) gpu.setBold(true);
    const draw_width = if (node.no_wrap) @as(f32, 0) else max_width;
    // Route through the text engine so paint shares the wordWrap algorithm
    // with measurement — single source of truth for line breaks.
    const text_h = if (g_text_engine) |te| te.drawTextWrappedRGBA(
        text,
        x,
        y,
        node.font_size,
        draw_width,
        @as(f32, color.r) / 255.0,
        @as(f32, color.g) / 255.0,
        @as(f32, color.b) / 255.0,
        final_a,
        max_lines,
        node.letter_spacing,
        node.line_height,
    ) else 0;
    if (node.line_height > 0) gpu.setLineHeightOverride(0);
    if (node.letter_spacing != 0) gpu.setLetterSpacing(0);
    if (bold) gpu.setBold(false);
    if (node.font_family_id != 0) gpu.setFontFamily(0);
    if (node.inline_glyphs) |glyphs| {
        paintInlineGlyphs(glyphs, node.font_size);
    }
    if (node.text_effect != null) gpu.clearTextEffect();
    if (node.href != null) {
        const text_w = measureWidthOnly(text, node.font_size);
        const underline_y = y + text_h - 2;
        gpu.drawRect(
            x,
            underline_y,
            text_w,
            1,
            @as(f32, color.r) / 255.0,
            @as(f32, color.g) / 255.0,
            @as(f32, color.b) / 255.0,
            final_a * 0.6,
            0,
            0,
            0,
            0,
            0,
            0,
        );
    }
    return text_h;
}

fn measureImageCallback(context: *anyopaque, src: []const u8) layout.ImageDims {
    const host: *HostContext = @ptrCast(@alignCast(context));
    const m = image_cache.measure(host.io, host.environ, src);
    return .{ .width = m.w, .height = m.h };
}

/// Layout-event callback — invoked by `layout.setRect` for nodes flagged
/// `has_on_layout`. Builds a small JS expression that calls into the runtime
/// dispatcher with the just-computed rect; the dispatcher routes by id to the
/// React handlerRegistry's `onLayout` callback.
fn emitLayoutCallback(context: *anyopaque, id: u32, rect: layout.LayoutRect) void {
    const host: *HostContext = @ptrCast(@alignCast(context));
    var buf: [192]u8 = undefined;
    const expr = std.fmt.bufPrintZ(&buf, "__dispatchLayout({d},{d:.2},{d:.2},{d:.2},{d:.2})", .{
        id, rect.x, rect.y, rect.w, rect.h,
    }) catch return;
    js_vm.evalExpr(host, expr);
}

// ── Node painting (framework-owned) ─────────────────────────────────────

fn offsetDescendants(node: *Node, dx: f32, dy: f32) void {
    for (node.children) |*child| {
        child.computed.x += dx;
        child.computed.y += dy;
        offsetDescendants(child, dx, dy);
    }
}

/// Recursively offset a node and all descendants by dx/dy.
fn offsetNodeXY(node: *Node, dx: f32, dy: f32) void {
    node.computed.x += dx;
    node.computed.y += dy;
    for (node.children) |*child| offsetNodeXY(child, dx, dy);
}

/// Position a single Canvas.Node at its raw graph coordinates (gx/gy = center).
fn positionOneCanvasNode(child: *Node) void {
    const target_x = child.canvas_gx - child.computed.w / 2;
    const target_y = child.canvas_gy - child.computed.h / 2;
    const dx = target_x - child.computed.x;
    const dy = target_y - child.computed.y;
    child.computed.x = target_x;
    child.computed.y = target_y;
    for (child.children) |*gc| offsetNodeXY(gc, dx, dy);
}

/// Translate Canvas.Node children from flex positions to raw graph-space.
/// Flattens through non-canvas containers (e.g., map pool wrappers from .map() inside Canvas).
/// On drift-enabled canvases, auto-distributes and stacks tiles generatively:
///   - Collects all Canvas.Node children into a flat list
///   - Shuffles them randomly (Fisher-Yates, seeded by SDL_GetTicks)
///   - Distributes round-robin across N columns at COLUMN_SPACING apart
///   - Each column gets a randomized stagger — no flat horizontal edges
///   - Tiles stack outward from stagger anchor: odd down, even up
///   - Uniform CANVAS_NODE_GAP (30px) between all tiles
///   - Re-stacks every time the canvas becomes visible (generative layout)
fn positionCanvasNodes(parent: *Node) void {
    for (parent.children) |*child| {
        if (child.canvas_node) {
            positionOneCanvasNode(child);
        } else if (!child.canvas_path and !child.canvas_clamp) {
            // Flatten through non-canvas container (map pool wrapper)
            for (child.children) |*gc| {
                if (gc.canvas_node) positionOneCanvasNode(gc);
            }
        }
    }
}

const PAINT_BUDGET: u32 = 50_000;
var g_paint_count: u32 = 0;
var g_hidden_count: u32 = 0;
var g_zero_count: u32 = 0;
var g_budget_exceeded: bool = false;
var g_effect_child_seen2: bool = false;
var g_effect_bg_logged2: bool = false;
var g_dt_sec: f32 = 0;
var g_paint_opacity: f32 = 1.0; // global opacity multiplier for dim/highlight
var g_static_surface_capture: bool = false;
var g_flow_enabled: bool = true; // per-child flow override for hover mode
var g_hover_changed: bool = false; // debug flag
var g_semantic_overlay: bool = false; // Ctrl+Shift+D toggles semantic color overlay

// One-shot visible-node coord dump (gated by REACTJIT_NODEDUMP env var).
// Fires once at tick 60, after layout has settled, so a supervisor can read
// post-layout pixel rects for the first ~50 visible nodes.
var g_nodedump_tick: u32 = 0;
var g_nodedump_done: bool = false;

fn nodedumpTag(node: *Node) []const u8 {
    if (node.text != null) return "Text";
    if (node.canvas_path) return "Canvas.Path";
    if (node.canvas_clamp) return "Canvas.Clamp";
    if (node.canvas_node) return "Canvas.Node";
    if (node.canvas_type != null) return "Canvas";
    if (node.image_src != null) return "Image";
    if (node.video_src != null) return "Video";
    if (node.render_src != null) return "Render";
    if (node.input_id != null) return "TextInput";
    if (node.effect_type != null) return "Effect";
    if (node.scene3d) return "Scene3D";
    if (node.handlers.on_press != null or node.handlers.js_on_press != null or node.handlers.lua_on_press != null) return "Pressable";
    return "Box";
}

fn nodedumpWalk(node: *Node, count: *u32, depth: u32, limit: u32) void {
    if (count.* >= limit) return;
    const r = node.computed;
    if (r.w > 0 and r.h > 0) {
        var tbuf: [20]u8 = undefined;
        var text_len: usize = 0;
        if (node.text) |t| {
            const take = @min(t.len, tbuf.len);
            var i: usize = 0;
            while (i < take) : (i += 1) {
                const ch = t[i];
                tbuf[i] = if (ch >= 0x20 and ch < 0x7F) ch else '?';
            }
            text_len = take;
        }
        const dbg_name: []const u8 = node.debug_name orelse "";
        log.print("[nodedump] t=60 i={d} d={d} kids={d} tag={s} x={d} y={d} w={d} h={d} name={s} text={s}\n", .{
            count.*,
            depth,
            node.children.len,
            nodedumpTag(node),
            @as(i32, @trunc(r.x)),
            @as(i32, @trunc(r.y)),
            @as(i32, @trunc(r.w)),
            @as(i32, @trunc(r.h)),
            dbg_name,
            tbuf[0..text_len],
        });
        count.* += 1;
    }
    for (node.children) |*child| {
        if (count.* >= limit) return;
        nodedumpWalk(child, count, depth + 1, limit);
    }
}

fn nodedumpMaybeEmit(environ: *const std.process.Environ.Map, root: *Node, win_w: f32, win_h: f32) void {
    if (g_nodedump_done) return;
    g_nodedump_tick +%= 1;
    if (g_nodedump_tick != 60) return;
    g_nodedump_done = true;
    if (environ.get("REACTJIT_NODEDUMP") == null) return;
    log.print("[nodedump] window={d}x{d}\n", .{
        @as(i32, @trunc(win_w)),
        @as(i32, @trunc(win_h)),
    });
    var count: u32 = 0;
    nodedumpWalk(root, &count, 0, 500);
}

// Canvas drag state — tracks which canvas is being dragged for pan
var canvas_drag_node: ?*Node = null;
var canvas_drag_last_x: f32 = 0;
var canvas_drag_last_y: f32 = 0;

// Canvas.Node move-drag state — Alt+drag on a Canvas.Node with onMove handler.
// Per-motion updates go straight to the host Node pool (via AppConfig callback)
// so the tile follows the cursor without firing a React setState on every
// motion. One onMove dispatch fires on release to commit the final position
// into React state. IDs (not pointers) because the arena is rebuilt per tick.
var canvas_move_drag_id: u32 = 0;
var canvas_move_drag_canvas_id: u32 = 0;
var canvas_move_drag_offset_x: f32 = 0;
var canvas_move_drag_offset_y: f32 = 0;
var canvas_move_last_gx: f32 = 0;
var canvas_move_last_gy: f32 = 0;
var canvas_move_last_dispatch_ms: u32 = 0;

// TextInput drag-select state
var input_drag_active: bool = false;
var input_drag_id: u8 = 0;
var input_drag_node_x: f32 = 0; // node rect x (for computing local_x)
var input_drag_node_y: f32 = 0; // node rect y (for computing local_y)
var input_drag_node_pl: f32 = 0; // node padding-left
var input_drag_node_pt: f32 = 0; // node padding-top
// Device-aware pointer (req_3089): SDL3 synthesizes mouse events from a tablet
// pen with `which == SDL_PEN_MOUSEID`, so the whole mouse pipeline keeps working
// unchanged for a pen — this only records WHO is driving the cursor. On the
// change edge (mouse ⇄ pen) the useIFTTT `system:pointerDevice` signal fires so
// carts can swap tools per device (GIMP semantics: pen and mouse each remember
// their own tool).
fn notePointerDevice(host: *HostContext, which: c.SDL_MouseID) void {
    const dev: mouse_state.PointerDevice = if (which == c.SDL_PEN_MOUSEID) .pen else .mouse;
    if (mouse_state.updatePointerDevice(dev)) system_signals.notifyPointerDevice(host, @intFromEnum(dev));
}

// Coalesced drag position — set per SDL_EVENT_MOUSE_MOTION, consumed once
// per frame after the event pump. Avoids N hit-tests per frame when SDL
// delivers a burst of motion events during rapid dragging.
var input_drag_pending: bool = false;
var input_drag_pending_x: f32 = 0;
var input_drag_pending_y: f32 = 0;

// Input-to-present latency probe. Stamped on the SDL event that produces
// a text/cursor change; logged once the next frame has finished painting.
// Answers "how long from keypress/drag to pixels on screen?".
var g_input_latency_ts_us: i64 = 0;
var g_input_latency_kind: []const u8 = "";
var g_input_latency_event_count: u32 = 0; // events batched into this frame

fn stampClickLatency() void {
    // Click-latency telemetry was a one-off measurement; the storage that
    // fed it (framework/lua/jsrt/click_latency.zig) was removed alongside
    // JSRT. Kept as a no-op so the ~9 stamp call sites in this file don't
    // need surgery; if a future click-paint-latency tool needs the hook,
    // wire it back in here.
    _ = .{};
}

fn stampInputLatency(io: std.Io, kind: []const u8) void {
    if (g_input_latency_ts_us == 0) {
        g_input_latency_ts_us = std.Io.Clock.now(.awake, io).toMicroseconds();
        g_input_latency_kind = kind;
    }
    g_input_latency_event_count += 1;
}

fn scrollOffsetForNode(node: *Node, target: *Node, sx: *f32, sy: *f32) bool {
    if (node == target) return true;
    const ov = node.style.overflow;
    const r = node.computed;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    for (node.children) |*child| {
        if (scrollOffsetForNode(child, target, sx, sy)) {
            if (is_scroll) {
                sx.* += node.scroll_x;
                sy.* += node.scroll_y;
            }
            return true;
        }
    }
    return false;
}

fn markScrollActivity(node: *Node) void {
    node.scrollbar_last_activity_ms = @intCast(c.SDL_GetTicks());
}

fn dispatchScrollChanged(host: *HostContext, node: *Node, dx: f32, dy: f32) void {
    markScrollActivity(node);
    luajit_runtime.persistScrollSlot(node.scroll_persist_slot, node.scroll_y);
    fireScrollHandlers(host, node, dx, dy);
}

/// Deliver a wheel delta to a node's onScroll handler(s). The Lua path uses the
/// on_scroll fn pointer; the V8 path uses js_on_scroll, an installed
/// `__dispatchScroll(id)` expr that reads the prepared scroll payload. Both read
/// the same prepared globals, so we stage them once and fire whichever exists.
fn fireScrollHandlers(host: *HostContext, node: *Node, dx: f32, dy: f32) void {
    if (node.handlers.on_scroll == null and node.handlers.js_on_scroll == null) return;
    prepared_input.prepareScrollEvent(
        node.scroll_persist_slot,
        node.scroll_x,
        node.scroll_y,
        dx,
        dy,
    );
    if (node.handlers.on_scroll) |handler| handler(node.handlers.context);
    if (node.handlers.js_on_scroll) |expr| runJsHandlerExpr(host, std.mem.span(expr));
}

fn scrollbarOpacity(node: *Node) f32 {
    if (!node.show_scrollbar) return 0;
    if (!node.scrollbar_auto_hide) return 0.72;
    if (node.scroll_persist_slot != 0 and (node.scroll_persist_slot == scrollbar_hover_slot or node.scroll_persist_slot == scrollbar_drag_slot)) return 0.82;
    const last = node.scrollbar_last_activity_ms;
    if (last <= 0) return 0;

    const now: i64 = @intCast(c.SDL_GetTicks());
    const age = now - last;
    if (age <= 0) return 0.72;

    const hold_ms: i64 = 650;
    const fade_ms: i64 = 260;
    if (age <= hold_ms) return 0.82;

    const fade_age = age - hold_ms;
    if (fade_age >= fade_ms) return 0;
    const t = @as(f32, @floatFromInt(fade_age)) / @as(f32, @floatFromInt(fade_ms));
    return 0.82 * (1.0 - t);
}

// <Slider> paint (SLIDER-0611) — track (style background, default studio
// dark), fill (text_color, default studio accent), square knob sized to the
// node height. Geometry shared with updateSliderDrag via sliderKnobW so the
// knob center maps the value span exactly the way the drag computes it.
fn paintSlider(node: *Node) void {
    const r = node.computed;
    const knob_w = sliderKnobW(r);
    const span = @max(1.0, r.w - knob_w);
    const denom = node.slider_max - node.slider_min;
    const frac_raw = if (denom != 0) (node.slider_value - node.slider_min) / denom else 0;
    const frac = @max(0.0, @min(frac_raw, 1.0));

    const track_h = @min(r.h, 5.0);
    const track_y = r.y + (r.h - track_h) * 0.5;

    const tc = node.style.background_color orelse Color.rgb(46, 51, 61);
    gpu.drawRect(
        r.x,
        track_y,
        r.w,
        track_h,
        @as(f32, tc.r) / 255.0,
        @as(f32, tc.g) / 255.0,
        @as(f32, tc.b) / 255.0,
        @as(f32, tc.a) / 255.0 * g_paint_opacity,
        track_h * 0.5,
        0,
        0,
        0,
        0,
        0,
    );

    const fc = node.text_color orelse Color.rgb(96, 165, 250);
    const fill_w = knob_w * 0.5 + frac * span;
    gpu.drawRect(
        r.x,
        track_y,
        fill_w,
        track_h,
        @as(f32, fc.r) / 255.0,
        @as(f32, fc.g) / 255.0,
        @as(f32, fc.b) / 255.0,
        @as(f32, fc.a) / 255.0 * g_paint_opacity,
        track_h * 0.5,
        0,
        0,
        0,
        0,
        0,
    );

    const knob_x = r.x + frac * span;
    const knob_alpha: f32 = if (node.slider_dragging) 1.0 else 0.92;
    gpu.drawRect(
        knob_x,
        r.y,
        knob_w,
        r.h,
        0.84,
        0.88,
        0.94,
        knob_alpha * g_paint_opacity,
        @min(knob_w, r.h) * 0.5,
        0,
        0,
        0,
        0,
        0,
    );
}

fn paintScrollbars(node: *Node) void {
    const ov = node.style.overflow;
    const r = node.computed;
    const max_scroll_x = @max(0.0, node.content_width - r.w);
    const max_scroll_y = @max(0.0, node.content_height - r.h);
    const show_vertical = node.show_scrollbar and r.h > 0 and max_scroll_y > 0 and (ov == .scroll or ov == .auto);
    const show_horizontal = node.show_scrollbar and r.w > 0 and max_scroll_x > 0 and (ov == .scroll or ov == .auto);
    const opacity = scrollbarOpacity(node);
    if (opacity <= 0 or (!show_vertical and !show_horizontal)) return;

    const track_alpha = opacity * 0.14 * g_paint_opacity;
    const thumb_alpha = opacity * 0.62 * g_paint_opacity;
    const inset: f32 = 2.0;
    const track_thickness: f32 = 3.0;
    const thumb_thickness: f32 = 4.0;
    const min_thumb_len: f32 = 18.0;

    if (show_vertical) {
        const track_x = switch (node.scrollbar_side) {
            .left => r.x + inset,
            else => r.x + r.w - inset - track_thickness,
        };
        const track_y = r.y + inset;
        const track_h = @max(0.0, r.h - inset * 2.0);
        const thumb_h = @min(track_h, @max(min_thumb_len, if (node.content_height > 0) (r.h * r.h / @max(node.content_height, 1.0)) else track_h));
        const thumb_y = if (max_scroll_y > 0)
            track_y + ((node.scroll_y / max_scroll_y) * @max(0.0, track_h - thumb_h))
        else
            track_y;

        gpu.drawRect(track_x, track_y, track_thickness, track_h, 0.18, 0.20, 0.24, track_alpha, track_thickness * 0.5, 0, 0, 0, 0, 0);
        gpu.drawRect(track_x + 0.5, thumb_y, thumb_thickness, thumb_h, 0.84, 0.88, 0.94, thumb_alpha, thumb_thickness * 0.5, 0, 0, 0, 0, 0);
    }

    if (show_horizontal) {
        const track_y = switch (node.scrollbar_side) {
            .top => r.y + inset,
            else => r.y + r.h - inset - track_thickness,
        };
        const track_x = r.x + inset;
        const track_w = @max(0.0, r.w - inset * 2.0);
        const thumb_w = @min(track_w, @max(min_thumb_len, if (node.content_width > 0) (r.w * r.w / @max(node.content_width, 1.0)) else track_w));
        const thumb_x = if (max_scroll_x > 0)
            track_x + ((node.scroll_x / max_scroll_x) * @max(0.0, track_w - thumb_w))
        else
            track_x;

        gpu.drawRect(track_x, track_y, track_w, track_thickness, 0.18, 0.20, 0.24, track_alpha, track_thickness * 0.5, 0, 0, 0, 0, 0);
        gpu.drawRect(thumb_x, track_y + 0.5, thumb_w, thumb_thickness, 0.84, 0.88, 0.94, thumb_alpha, thumb_thickness * 0.5, 0, 0, 0, 0, 0);
    }
}

fn hitTestInputByte(node: *const Node, id: u8, local_x: f32, local_y: f32) u32 {
    const typed = input.getText(id);
    if (typed.len == 0) return 0;

    if (g_text_engine) |te| {
        const scope = selection.applyNodeTextScope(node);
        defer selection.restoreNodeTextScope(scope);
        const max_width = node.computed.w - node.style.padLeft() - node.style.padRight();
        const idx = if (input.isMultiline(id))
            te.hitTestWrappedAlignedStyledLH(
                typed,
                @max(@as(f32, 0), local_x),
                @max(@as(f32, 0), local_y),
                node.font_size,
                @max(@as(f32, 1), max_width),
                .left,
                node.letter_spacing,
                node.line_height,
            )
        else
            te.hitTestWrappedAlignedStyledLH(typed, @max(@as(f32, 0), local_x), 0, node.font_size, 0, .left, node.letter_spacing, node.line_height);
        return @intCast(@min(idx, typed.len));
    }

    return if (local_x <= 0) 0 else @intCast(@min(typed.len, @as(usize, std.math.maxInt(u32))));
}

fn findInputNode(node: *Node, id: u8) ?*Node {
    if (node.input_id) |input_id| {
        if (input_id == id) return node;
    }
    for (node.children) |*child| {
        if (findInputNode(child, id)) |hit| return hit;
    }
    return null;
}

fn handleInputVerticalKey(root: *Node, sym: c_int, mods: u16) bool {
    if (sym != c.SDLK_UP and sym != c.SDLK_DOWN) return false;
    const id = input.getFocusedId() orelse return false;
    if (!input.isMultiline(id)) return false;
    const node = findInputNode(root, id) orelse return false;
    const typed = input.getText(id);
    if (typed.len == 0) return true;
    const te = g_text_engine orelse return false;

    const pl = node.style.padLeft();
    const pr = node.style.padRight();
    const max_w = @max(@as(f32, 1), node.computed.w - pl - pr);
    const cursor_pos = input.getCursorPos(id);
    const scope = selection.applyNodeTextScope(node);
    defer selection.restoreNodeTextScope(scope);
    const point = te.byteToPosStyledLH(typed, @as(usize, cursor_pos), node.font_size, max_w, node.letter_spacing, node.line_height);
    const lm = te.lineMetrics(node.font_size);
    const line_h: f32 = if (node.line_height > 0) node.line_height else lm.height;
    const target_y = if (sym == c.SDLK_UP)
        point.y - line_h
    else
        point.y + line_h;
    const next = te.hitTestWrappedAlignedStyledLH(
        typed,
        point.x,
        @max(@as(f32, 0), target_y),
        node.font_size,
        max_w,
        .left,
        node.letter_spacing,
        node.line_height,
    );
    const shift = (mods & c.SDL_KMOD_SHIFT) != 0;
    input.moveCursorTo(id, @intCast(@min(next, typed.len)), shift);
    return true;
}

fn paintStaticSurfaceOverlays(io: std.Io, environ: *const std.process.Environ.Map, node: *Node) void {
    for (node.children) |*child| {
        if (child.static_surface_overlay) {
            paintNode(io, environ, child);
        } else if (child.children.len > 0) {
            paintStaticSurfaceOverlays(io, environ, child);
        }
    }
}

fn restoreGpuTransform(tf: gpu.Transform) void {
    if (tf.active) {
        gpu.setTransform(tf.ox, tf.oy, tf.tx, tf.ty, tf.scale);
    } else {
        gpu.resetTransform();
    }
}

fn transformX(tf: gpu.Transform, x: f32) f32 {
    return (x - tf.ox) * tf.scale + tf.ox + tf.tx;
}

fn transformY(tf: gpu.Transform, y: f32) f32 {
    return (y - tf.oy) * tf.scale + tf.oy + tf.ty;
}

fn setComposedGpuTransform(ox: f32, oy: f32, tx: f32, ty: f32, scale: f32) void {
    const parent = gpu.getTransform();
    if (!parent.active) {
        gpu.setTransform(ox, oy, tx, ty, scale);
        return;
    }

    const parent_bx = parent.ox + parent.tx - parent.ox * parent.scale;
    const parent_by = parent.oy + parent.ty - parent.oy * parent.scale;
    const child_bx = ox + tx - ox * scale;
    const child_by = oy + ty - oy * scale;
    gpu.setTransform(0, 0, parent_bx + parent.scale * child_bx, parent_by + parent.scale * child_by, parent.scale * scale);
}

// Paint a node's children in z-index order (ascending: lower paints first,
// higher paints on top). Stable on equal z_index so DOM order wins for ties.
// Fast-paths the common case where no child has a non-zero z_index.
fn paintChildrenInZOrder(io: std.Io, environ: *const std.process.Environ.Map, node: *Node) void {
    const n = node.children.len;
    if (n == 0) return;
    if (n == 1) {
        if (!node.children[0].effect_background) paintNode(io, environ, &node.children[0]);
        return;
    }
    var any_z = false;
    for (node.children) |*child| {
        if (child.style.z_index != 0) {
            any_z = true;
            break;
        }
    }
    if (!any_z) {
        for (node.children) |*child| if (!child.effect_background) paintNode(io, environ, child);
        return;
    }
    var indices: [256]u16 = undefined;
    const m = @min(n, indices.len);
    for (0..m) |i| indices[i] = @intCast(i);
    var i: usize = 1;
    while (i < m) : (i += 1) {
        const cur = indices[i];
        const cur_z = node.children[cur].style.z_index;
        var j = i;
        while (j > 0 and node.children[indices[j - 1]].style.z_index > cur_z) : (j -= 1) {
            indices[j] = indices[j - 1];
        }
        indices[j] = cur;
    }
    const win_w: f32 = @floatFromInt(gpu.getWidth());
    const win_h: f32 = @floatFromInt(gpu.getHeight());
    for (0..m) |k| {
        const child = &node.children[indices[k]];
        if (child.effect_background) continue;
        // Non-zero z-index: push a fresh full-viewport scissor before painting.
        // Two effects in one move: (a) the scissor change forces a new GPU
        // segment, so this child's rects + text + curves draw together AFTER
        // all preceding siblings — making text actually z-stack correctly;
        // (b) the full-viewport extent escapes any ancestor overflow:hidden,
        // letting menus/tooltips/popovers extend outside their parent.
        if (child.style.z_index != 0) {
            gpu.pushScissor(0, 0, win_w, win_h);
            paintNode(io, environ, child);
            gpu.popScissor();
        } else {
            paintNode(io, environ, child);
        }
    }
    // Anything past slot 256 falls back to DOM order.
    if (n > m) {
        for (node.children[m..]) |*child| if (!child.effect_background) paintNode(io, environ, child);
    }
}

// ════════════════════════════════════════════════════════════════════════
// Panel pop-out window (PANELWIN-0628) — render an editor subtree into a 2nd
// OS window and route its input. The subtree's nodes carry their real
// reconciler ids (the window root is re-materialized each frame from the shared
// host tree by the provider the app installs), so input dispatches through the
// SAME JS event path as the main window → shared editor React state.
// ════════════════════════════════════════════════════════════════════════

var g_panel_root_provider: ?*const fn () ?*Node = null;
// The last materialized + laid-out panel root, kept alive between renders so
// mouse events (which arrive between frames) can hit-test against real rects.
var g_panel_root_cached: ?*Node = null;
var g_panel_paint_root: ?*Node = null;

/// The app installs a provider that re-materializes the pop-out window's subtree
/// from the shared host tree (or returns null when nothing is popped out).
pub fn setPanelRootProvider(f: *const fn () ?*Node) void {
    g_panel_root_provider = f;
}

fn panelPaintCallback(io: std.Io, environ: *const std.process.Environ.Map) void {
    const root = g_panel_paint_root orelse return;
    selection.resetWalkState();
    g_paint_count = 0;
    g_budget_exceeded = false;
    g_hidden_count = 0;
    g_paint_opacity = 1.0;
    paintNode(io, environ, root);
}

/// Called from the main loop AFTER gpu.frame() (the shared 2D batches are reset
/// and ours for this pass). Lays out the popped-out subtree at the 2nd window's
/// size, paints it into a gpu RT, and blits that RT into the window's swapchain.
fn renderPanelWindow(host: *HostContext) void {
    if (!panel_window.isOpen()) return;
    // Reconcile surface + RT dims with the real window size every frame so
    // resize/maximize follow even when the WM withholds PIXEL_SIZE_CHANGED.
    panel_window.syncSize();
    const provider = g_panel_root_provider orelse return;
    const root = provider() orelse {
        g_panel_root_cached = null;
        return;
    };
    const sz = panel_window.size();
    if (sz[0] == 0 or sz[1] == 0) return;
    layout.layoutNode(root, 0, 0, @floatFromInt(sz[0]), @floatFromInt(sz[1]));
    g_panel_root_cached = root;
    g_panel_paint_root = root;
    if (gpu.renderPanelInto(host.io, host.environ, sz[0], sz[1], panelPaintCallback)) |view| {
        panel_window.blitView(view);
    }
}

// ── pop-out window input (installed as panel_window's EventHook) ─────────────
fn panelHover(context: *anyopaque, x: f32, y: f32) void {
    const host: *HostContext = @ptrCast(@alignCast(context));
    const root = g_panel_root_cached orelse return;
    updateHover(host, root, x, y);
}

fn panelPress(context: *anyopaque, x: f32, y: f32, button: u8, down: bool) void {
    const host: *HostContext = @ptrCast(@alignCast(context));
    const root = g_panel_root_cached orelse return;
    if (!down or button != c.SDL_BUTTON_LEFT) return;
    const events = @import("events.zig");
    const hit = events.hitTest(root, x, y) orelse return;
    if (hit.handlers.js_on_mouse_down) |expr| {
        js_vm.callGlobal(host, "__beginJsEvent");
        js_vm.evalExpr(host, std.mem.span(expr));
        js_vm.callGlobal(host, "__endJsEvent");
    }
    if (hit.handlers.js_on_press) |expr| {
        input.unfocus();
        js_vm.callGlobal(host, "__beginJsEvent");
        js_vm.evalExpr(host, std.mem.span(expr));
        js_vm.callGlobal(host, "__endJsEvent");
        state_mod.markDirty();
    }
}

fn panelWheel(context: *anyopaque, x: f32, y: f32, dx: f32, dy: f32) void {
    const host: *HostContext = @ptrCast(@alignCast(context));
    const root = g_panel_root_cached orelse return;
    const events = @import("events.zig");
    const scroll_node = events.findScrollContainer(root, x, y) orelse {
        // No scroll container — deliver the raw delta to an onScroll handler.
        if (events.hitTestScroll(root, x, y)) |sn| fireScrollHandlers(host, sn, dx, dy);
        return;
    };
    const scale: f32 = if (comptime @import("builtin").os.tag == .macos) 10.0 else 30.0;
    if (dy != 0) scroll_node.scroll_y -= dy * scale;
    if (dx != 0) scroll_node.scroll_x -= dx * @max(scroll_node.computed.h * 0.8, 60.0);
    const max_sx = @max(0.0, scroll_node.content_width - scroll_node.computed.w);
    const max_sy = @max(0.0, scroll_node.content_height - scroll_node.computed.h);
    scroll_node.scroll_x = @max(0.0, @min(scroll_node.scroll_x, max_sx));
    scroll_node.scroll_y = @max(0.0, @min(scroll_node.scroll_y, max_sy));
    markScrollActivity(scroll_node);
    luajit_runtime.persistScrollSlot(scroll_node.scroll_persist_slot, scroll_node.scroll_y);
    fireScrollHandlers(host, scroll_node, dx, dy);
    state_mod.markDirty();
}

fn paintNode(io: std.Io, environ: *const std.process.Environ.Map, node: *Node) void {
    if (node.style.display == .none) {
        g_hidden_count += 1;
        return;
    }
    // Paintable nodes own a GPU mask texture but render nothing visible.
    // Brush ops accumulated since last frame were already drained at the
    // top of the frame; children of a Paintable are unusual but allowed
    // (paintable is conceptually a leaf).
    if (node.is_paintable) {
        g_hidden_count += 1;
        return;
    }
    if (g_static_surface_capture and node.static_surface_overlay) return;
    g_paint_count += 1;
    if (g_paint_count > PAINT_BUDGET) {
        if (!g_budget_exceeded) {
            g_budget_exceeded = true;
            log.print("[BUDGET] Paint pass exceeded {d} nodes — bailing (likely infinite loop)\n", .{PAINT_BUDGET});
        }
        return;
    }

    // Canvas.Path: draw before size check
    if (node.canvas_path or node.canvas_path_d != null) {
        paintCanvasPath(node);
        return;
    }

    // RectBatch (<Boxxx>): emit the whole box buffer as native instanced rects
    // in one pass — the direct-to-pipeline alternative to per-box <Box> nodes
    // (no MAX_CHILDREN, no per-box layout solve) and to the gather shader
    // (native instancing, not per-pixel O(N)). Boxes are origin-relative.
    if (node.rect_batch) {
        paintRectBatch(node);
        return;
    }

    // Graph.GCurve — flat array of 6-float quadratic-bezier-triangle control
    // points. Each group of 6 is one Loop-Blinn fill triangle queued to the
    // gcurve_fill pipeline, batched into one draw call. Resolution-independent,
    // perfectly anti-aliased per-fragment via the `u*u - v < 0` interior test.
    // Lives inside <Graph> so the parent's transform is already on the GPU stack.
    if (node.gcurve_data) |gd| {
        if (gd.len >= 6) {
            const fc = node.canvas_fill_color orelse Color.rgb(255, 255, 255);
            const r = @as(f32, fc.r) / 255.0;
            const g = @as(f32, fc.g) / 255.0;
            const b = @as(f32, fc.b) / 255.0;
            const a = @as(f32, fc.a) / 255.0 * g_paint_opacity * node.canvas_fill_opacity;
            var i: usize = 0;
            while (i + 5 < gd.len) : (i += 6) {
                gpu.gcurve_fill.drawGCurveFill(
                    gd[i],
                    gd[i + 1],
                    gd[i + 2],
                    gd[i + 3],
                    gd[i + 4],
                    gd[i + 5],
                    r,
                    g,
                    b,
                    a,
                );
            }
        }
        return;
    }

    // Graph.Polyline / Graph.Polygon — flat point array parsed once at
    // update time. If canvas_fill_color is set, fan-triangulate from vertex 0
    // for filled polygons (caller ensures shape is star-shaped from v0; bars,
    // fan-baseline area charts, and donut wedges all qualify). Otherwise
    // stroke as capsules. Both paths bypass the SVG d-string parser entirely.
    if (node.polyline_points) |pts| {
        if (node.canvas_fill_color) |fc| {
            // Filled polygon — n points → n-2 triangles in a fan from v0.
            if (pts.len >= 6) {
                const r = @as(f32, fc.r) / 255.0;
                const g = @as(f32, fc.g) / 255.0;
                const b = @as(f32, fc.b) / 255.0;
                const a = @as(f32, fc.a) / 255.0 * g_paint_opacity * node.canvas_fill_opacity;
                const x0 = pts[0];
                const y0 = pts[1];
                var i: usize = 2;
                while (i + 3 < pts.len) : (i += 2) {
                    gpu.polys.drawTri(
                        x0,
                        y0,
                        pts[i],
                        pts[i + 1],
                        pts[i + 2],
                        pts[i + 3],
                        r,
                        g,
                        b,
                        a,
                    );
                }
            }
        } else if (pts.len >= 4) {
            const tc = node.text_color orelse Color.rgb(255, 255, 255);
            const r = @as(f32, tc.r) / 255.0;
            const g = @as(f32, tc.g) / 255.0;
            const b = @as(f32, tc.b) / 255.0;
            const a = @as(f32, tc.a) / 255.0 * g_paint_opacity * node.canvas_stroke_opacity;
            const sw = node.canvas_stroke_width;
            // segments mode → independent pairs (i += 4: p0p1, p2p3, …); strip
            // mode → connected (i += 2: p0p1, p1p2, …). One node, N disjoint
            // lines for a wireframe vs one continuous path for a chart line.
            const stride: usize = if (node.polyline_segments) 4 else 2;
            var i: usize = 0;
            while (i + 3 < pts.len) : (i += stride) {
                gpu.drawCapsule(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], r, g, b, a, sw);
            }
        }
        return;
    }

    const r = node.computed;
    if (r.w <= 0 or r.h <= 0) {
        g_zero_count += 1;
        return;
    }

    // <Slider> — host-painted track/fill/knob from the pool-resident value
    // (SLIDER-0611). No children, no JS: the thumb stays glued to the cursor
    // even when the cart's render loop lags.
    if (node.slider) {
        paintSlider(node);
        return;
    }

    // SDF icon — single textured quad sampling the pre-baked atlas. Cheap
    // alternative to <Graph.Path> for any icon whose geometry is fixed.
    // 50 of these cost the same as 1 because the engine's render loop batches
    // them into a single instanced draw call (see framework/gpu/sdf_icons.zig).
    if (node.icon_name) |name| {
        if (gpu.sdf_icons.lookup(name)) |uv| {
            const tc = node.text_color orelse Color.rgb(255, 255, 255);
            gpu.sdf_icons.queueIcon(
                r.x,
                r.y,
                r.w,
                r.h,
                uv,
                @as(f32, tc.r) / 255.0,
                @as(f32, tc.g) / 255.0,
                @as(f32, tc.b) / 255.0,
                @as(f32, tc.a) / 255.0 * g_paint_opacity,
            );
            return;
        }
        // Unknown icon name → render nothing rather than fall through to a
        // background-only box. Cart should fall back to <Graph.Path> on the
        // JS side via runtime/icons/Icon.tsx.
        return;
    }

    // CSS transform — push onto the node-matrix stack so this node's visuals
    // and all descendants inherit the rotation/scale/translate. Origin defaults
    // to center (0.5, 0.5). Mirrors love2d's painter.lua applyTransform: visual
    // only, does not affect layout positions or hit-testing.
    // Inline-paint tween — mirrors border_dash's "set on style, host evaluates
    // every frame from the engine clock" model. Adds to whatever the cart
    // already set as translate_x/y so the existing transform pipeline stays
    // unchanged. Curve byte is animations.CurveType (0..36).
    var tween_dx: f32 = 0;
    var tween_dy: f32 = 0;
    if (node.style.tween_translate_x_dur_ms > 0 or node.style.tween_translate_y_dur_ms > 0) {
        const ticks_ms_xf = c.SDL_GetTicks();
        const now_ms_xf: f32 = @floatFromInt(ticks_ms_xf);
        if (node.style.tween_translate_x_dur_ms > 0) {
            const t = @mod(now_ms_xf, node.style.tween_translate_x_dur_ms) / node.style.tween_translate_x_dur_ms;
            const curve_x: animations.CurveType = @enumFromInt(node.style.tween_translate_x_curve);
            const eased = animations.applyCurvePub(curve_x, t);
            tween_dx = node.style.tween_translate_x_from + (node.style.tween_translate_x_to - node.style.tween_translate_x_from) * eased;
        }
        if (node.style.tween_translate_y_dur_ms > 0) {
            const t = @mod(now_ms_xf, node.style.tween_translate_y_dur_ms) / node.style.tween_translate_y_dur_ms;
            const curve_y: animations.CurveType = @enumFromInt(node.style.tween_translate_y_curve);
            const eased = animations.applyCurvePub(curve_y, t);
            tween_dy = node.style.tween_translate_y_from + (node.style.tween_translate_y_to - node.style.tween_translate_y_from) * eased;
        }
    }
    const has_xform = node.style.rotation != 0 or node.style.scale_x != 1.0 or node.style.scale_y != 1.0 or node.style.translate_x != 0 or node.style.translate_y != 0 or tween_dx != 0 or tween_dy != 0;
    if (has_xform) {
        const pivot_x = r.x + node.style.origin_x * r.w;
        const pivot_y = r.y + node.style.origin_y * r.h;
        gpu.pushNodeMatrix();
        gpu.composeNodeTransform(
            pivot_x,
            pivot_y,
            std.math.degreesToRadians(node.style.rotation),
            node.style.scale_x,
            node.style.scale_y,
            node.style.translate_x + tween_dx,
            node.style.translate_y + tween_dy,
        );
    }
    defer if (has_xform) gpu.popNodeMatrix();

    // Apply node opacity (cascades to children via g_paint_opacity)
    const saved_opacity = g_paint_opacity;
    if (node.style.opacity < 1.0) {
        g_paint_opacity *= node.style.opacity;
    }
    if (g_paint_opacity <= 0) {
        g_paint_opacity = saved_opacity;
        return;
    }

    // Filter: render the subtree into an offscreen texture EVERY frame and
    // composite via a fragment-shader pass (deepfry, crt, vhs, etc.). Same
    // capture machinery as StaticSurface but the cache is disabled, so
    // animated children keep playing.
    if (node.filter_name) |filter_name| {
        // Stable key derived from the node pointer (8 bytes, alignment-safe).
        // Across frames the same node sees the same key → texture is reused.
        const ptr_int: usize = @intFromPtr(node);
        var key_buf: [@sizeOf(usize)]u8 = undefined;
        std.mem.writeInt(usize, key_buf[0..], ptr_int, .little);
        const filter_key: []const u8 = key_buf[0..];
        const surface_scale: f32 = 1.0;
        if (gpu.beginFilterCapture(filter_key, filter_name, node.filter_intensity, r.x, r.y, r.w, r.h, surface_scale)) |token| {
            const scissor_snapshot = gpu.suspendScissorForStaticCapture(token.width, token.height);
            const start_counts = gpu.primitiveCounts();
            const saved_capture_tf = gpu.getTransform();
            const saved_static_surface_capture = g_static_surface_capture;
            g_static_surface_capture = true;
            offsetDescendants(node, -r.x, -r.y);
            const capture_saved_opacity = g_paint_opacity;
            g_paint_opacity = saved_opacity;
            for (node.children) |*child| if (!child.effect_background) paintNode(io, environ, child);
            g_paint_opacity = capture_saved_opacity;
            restoreGpuTransform(saved_capture_tf);
            offsetDescendants(node, r.x, r.y);
            g_static_surface_capture = saved_static_surface_capture;
            const end_counts = gpu.primitiveCounts();
            gpu.restoreScissorAfterStaticCapture(scissor_snapshot);
            gpu.finishFilterCapture(token, start_counts, end_counts, filter_name, node.filter_intensity, r.x, r.y, r.w, r.h);
            g_paint_opacity = saved_opacity;
            return;
        }
    }

    // StaticSurface: cache a stable subtree into a GPU texture. The children
    // stay in the layout/hit-test tree, but paint collapses to one image quad
    // after the texture has been populated.
    if (node.static_surface) {
        if (node.static_surface_key) |surface_key| {
            const surface_scale = @max(1.0, @min(node.static_surface_scale, 4.0));
            const dirty_frame = node.subtree_last_mutated_frame;
            if (gpu.queueStaticSurface(surface_key, r.x, r.y, r.w, r.h, g_paint_opacity, node.static_surface_intro_frames, surface_scale, dirty_frame)) {
                paintStaticSurfaceOverlays(io, environ, node);
                g_paint_opacity = saved_opacity;
                return;
            }
            if (!gpu.staticSurfaceWarming(surface_key, r.w, r.h, node.static_surface_warmup_frames, surface_scale, dirty_frame)) {
                if (gpu.beginStaticSurfaceCapture(surface_key, r.x, r.y, r.w, r.h, g_paint_opacity, node.static_surface_intro_frames, surface_scale)) |token| {
                    const scissor_snapshot = gpu.suspendScissorForStaticCapture(token.width, token.height);
                    const start_counts = gpu.primitiveCounts();
                    const saved_capture_tf = gpu.getTransform();
                    const saved_static_surface_capture = g_static_surface_capture;
                    g_static_surface_capture = true;
                    offsetDescendants(node, -r.x, -r.y);
                    if (surface_scale != 1.0) setComposedGpuTransform(0, 0, 0, 0, surface_scale);
                    // Children render into the offscreen texture at the parent's
                    // cascade — this node's own opacity is applied once at the
                    // composite step (queueStaticSurface above / the quad emitted
                    // by beginStaticSurfaceCapture). Without this reset, opacity
                    // multiplies twice: once into every primitive, then again
                    // when the texture quad is composited.
                    const capture_saved_opacity = g_paint_opacity;
                    g_paint_opacity = saved_opacity;
                    for (node.children) |*child| if (!child.effect_background) paintNode(io, environ, child);
                    g_paint_opacity = capture_saved_opacity;
                    restoreGpuTransform(saved_capture_tf);
                    offsetDescendants(node, r.x, r.y);
                    g_static_surface_capture = saved_static_surface_capture;
                    const end_counts = gpu.primitiveCounts();
                    gpu.restoreScissorAfterStaticCapture(scissor_snapshot);
                    gpu.finishStaticSurfaceCapture(token, start_counts, end_counts);
                    paintStaticSurfaceOverlays(io, environ, node);
                    g_paint_opacity = saved_opacity;
                    return;
                }
            }
        }
    }

    // Paint this node's visuals (background, text, input, selection)
    paintNodeVisuals(io, environ, node);

    // Background effects — children with effect_background paint behind siblings
    for (node.children) |*child| {
        if (child.effect_render != null and !g_effect_child_seen2) {
            g_effect_child_seen2 = true;
            log.print("[eng effect-seen] parent={x} child={x} bg={} parent_rect={d}x{d} child_rect={d}x{d}\n", .{ @intFromPtr(node), @intFromPtr(child), child.effect_background, r.w, r.h, child.computed.w, child.computed.h });
        }
        if (child.effect_background and child.effect_render != null) {
            if (!g_effect_bg_logged2) {
                g_effect_bg_logged2 = true;
                log.print("[eng effect-bg-paint] firing rect={d}x{d}\n", .{ r.w, r.h });
            }
            _ = effects.paintCustomEffect(io, environ, child, r.x, r.y, r.w, r.h, g_paint_opacity);
        }
    }

    // Canvas rendering — separate heavy path
    if (node.canvas_type != null) {
        paintCanvasContainer(io, environ, node);
        return;
    }

    // Graph container — lightweight canvas with transform for SVG path children
    if (node.graph_container) {
        const saved_tf = gpu.getTransform();
        if (saved_tf.active) {
            gpu.pushScissor(transformX(saved_tf, r.x), transformY(saved_tf, r.y), r.w * saved_tf.scale, r.h * saved_tf.scale);
        } else {
            gpu.pushScissor(r.x, r.y, r.w, r.h);
        }
        // Set up transform. Default: graph-space (viewX,viewY) maps to element
        // CENTER — correct for polar/pan-zoom visuals. Carts that set
        // graph_origin_topleft=true anchor world (0,0) at the element's
        // top-left corner instead, matching DOM plot-area conventions.
        const vx: f32 = node.canvas_view_x;
        const vy: f32 = node.canvas_view_y;
        const vz: f32 = if (node.canvas_view_zoom > 0) node.canvas_view_zoom else 1.0;
        const ox: f32 = if (node.graph_origin_topleft) r.x else r.x + r.w / 2;
        const oy: f32 = if (node.graph_origin_topleft) r.y else r.y + r.h / 2;
        setComposedGpuTransform(0, 0, ox - vx * vz, oy - vy * vz, vz);
        for (node.children) |*child| paintNode(io, environ, child);
        restoreGpuTransform(saved_tf);
        gpu.popScissor();
        return;
    }

    // Overflow clipping + scroll offset + recurse children
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    const is_clipped = is_scroll or ov == .hidden;

    if (is_clipped) {
        // When a canvas transform is active, scissor coordinates are in graph space
        // but pushScissor expects screen space. Transform through the active GPU transform.
        const tf = gpu.getTransform();
        if (tf.active) {
            gpu.pushScissor(r.x * tf.scale + tf.tx, r.y * tf.scale + tf.ty, r.w * tf.scale, r.h * tf.scale);
        } else {
            gpu.pushScissor(r.x, r.y, r.w, r.h);
        }
    }

    if (is_scroll and (node.scroll_x != 0 or node.scroll_y != 0)) {
        const sx = node.scroll_x;
        const sy = node.scroll_y;
        offsetDescendants(node, -sx, -sy);
        paintChildrenInZOrder(io, environ, node);
        offsetDescendants(node, sx, sy);
    } else {
        paintChildrenInZOrder(io, environ, node);
    }

    if (is_scroll) paintScrollbars(node);

    if (is_clipped) gpu.popScissor();
    g_paint_opacity = saved_opacity;
}

/// Paint a Canvas.Path node (SVG stroke curves + optional fill).
fn paintCanvasPath(node: *Node) callconv(.auto) void {
    @setRuntimeSafety(false);
    if (node.canvas_path_d) |d| {
        const tc = node.text_color orelse Color.rgb(255, 255, 255);
        // Standalone path (icon mode): scale 24×24 viewbox into node's rect.
        // Inline paths (canvas_path=true) overlay parent and don't transform.
        const r = node.computed;
        const is_icon = !node.canvas_path and r.w > 0 and r.h > 0;
        var saved_icon_tf: gpu.Transform = undefined;
        if (is_icon) {
            saved_icon_tf = gpu.getTransform();
            const vb: f32 = 24.0;
            const scale = @min(r.w / vb, r.h / vb);
            const ox = r.x + (r.w - vb * scale) / 2;
            const oy = r.y + (r.h - vb * scale) / 2;
            setComposedGpuTransform(0, 0, ox, oy, scale);
        }
        // Fill pass — either from named effect texture or flat color
        if (node.canvas_fill_effect) |ename| {
            // Look up the named effect's pixel buffer and fill triangles with sampled colors
            if (effects.getEffectFill(ename)) |info| {
                const fill_path = svg_path.parsePath(d);
                // Compute path bounding box for UV mapping
                var min_x: f32 = 1e9;
                var min_y: f32 = 1e9;
                var max_x: f32 = -1e9;
                var max_y: f32 = -1e9;
                for (0..fill_path.subpath_count) |si2| {
                    const sp2 = &fill_path.subpaths[si2];
                    var pi2: u32 = 0;
                    while (pi2 + 1 < sp2.count) : (pi2 += 2) {
                        if (sp2.points[pi2] < min_x) min_x = sp2.points[pi2];
                        if (sp2.points[pi2 + 1] < min_y) min_y = sp2.points[pi2 + 1];
                        if (sp2.points[pi2] > max_x) max_x = sp2.points[pi2];
                        if (sp2.points[pi2 + 1] > max_y) max_y = sp2.points[pi2 + 1];
                    }
                }
                if (paisleyDebugEnabled() and isPaisleyName(ename)) {
                    log.print(
                        "[paisley] paintCanvasPath name={s} d_len={d} bbox=({d:.1},{d:.1},{d:.1},{d:.1}) stroke_w={d:.2} curve_count={d} subpaths={d}\n",
                        .{
                            ename,
                            d.len,
                            min_x,
                            min_y,
                            max_x - min_x,
                            max_y - min_y,
                            node.canvas_stroke_width,
                            fill_path.curve_count,
                            fill_path.subpath_count,
                        },
                    );
                }
                svg_path.drawFillFromEffect(
                    &fill_path,
                    info.pixel_buf,
                    info.width,
                    info.height,
                    min_x,
                    min_y,
                    max_x - min_x,
                    max_y - min_y,
                );
            } else if (paisleyDebugEnabled() and isPaisleyName(ename)) {
                log.print("[paisley] paintCanvasPath name={s} missing fill source\n", .{ename});
            }
        } else if (node.canvas_fill_gradient) |grad| {
            // Linear gradient fill — translate layout.GradientStop (u8 Color) to
            // svg_path.GradientStopF (f32 RGBA) on the stack, apply paint_opacity
            // uniformly, then delegate to the Gouraud-interpolated rasterizer.
            // Coarser tolerance for fills: icons are 24×24 and ear-clipping cost
            // grows O(n²) in flattened-vertex count; tol=2.0 collapses redundant
            // near-colinear points from bezier flattening without visible loss.
            const fill_path = svg_path.parsePath(d);
            var stops_buf: [16]svg_path.GradientStopF = undefined;
            const n = @min(grad.stops.len, stops_buf.len);
            for (0..n) |si2| {
                const s = grad.stops[si2];
                stops_buf[si2] = .{
                    .offset = s.offset,
                    .r = @as(f32, s.color.r) / 255.0,
                    .g = @as(f32, s.color.g) / 255.0,
                    .b = @as(f32, s.color.b) / 255.0,
                    .a = @as(f32, s.color.a) / 255.0 * g_paint_opacity * node.canvas_fill_opacity,
                };
            }
            svg_path.drawFillLinearGradient(&fill_path, grad.x1, grad.y1, grad.x2, grad.y2, stops_buf[0..n]);
        } else if (node.canvas_fill_color) |fc| {
            const fill_path = svg_path.parsePath(d);
            svg_path.drawFill(
                &fill_path,
                @as(f32, fc.r) / 255.0,
                @as(f32, fc.g) / 255.0,
                @as(f32, fc.b) / 255.0,
                @as(f32, fc.a) / 255.0 * g_paint_opacity * node.canvas_fill_opacity,
            );
        }
        // Stroke pass (GPU-native SDF curves)
        const path = svg_path.parsePath(d);
        svg_path.drawStrokeCurves(
            &path,
            @as(f32, tc.r) / 255.0,
            @as(f32, tc.g) / 255.0,
            @as(f32, tc.b) / 255.0,
            @as(f32, tc.a) / 255.0 * g_paint_opacity * node.canvas_stroke_opacity,
            node.canvas_stroke_width,
            if (g_flow_enabled) node.canvas_flow_speed else 0,
            @as(u32, @truncate(c.SDL_GetTicks())),
        );
        if (is_icon) restoreGpuTransform(saved_icon_tf);
    }
}

/// Emit a flat box buffer straight into the instanced-rect pipeline. One node,
/// N rects, no per-box layout. Buffer layout (effect_data): [count], then per
/// box 14 floats: x, y, w, h, fillR, fillG, fillB, fillA, radius, borderW,
/// borderR, borderG, borderB, borderA. Box x/y are relative to this node.
fn paintRectBatch(node: *Node) void {
    if (node.effect_data) |data| {
        // Flat-spec path: boxes are pure data (no child nodes, no layout).
        if (data.len < 1) return;
        const r = node.computed;
        const total: usize = @trunc(@max(0.0, data[0]));
        var i: usize = 0;
        while (i < total) : (i += 1) {
            const o = 1 + i * 14;
            if (o + 13 >= data.len) break;
            const rad = data[o + 8];
            gpu.drawRectCorners(
                r.x + data[o],
                r.y + data[o + 1],
                data[o + 2],
                data[o + 3],
                data[o + 4],
                data[o + 5],
                data[o + 6],
                data[o + 7] * g_paint_opacity,
                rad,
                rad,
                rad,
                rad,
                data[o + 9],
                data[o + 10],
                data[o + 11],
                data[o + 12],
                data[o + 13] * g_paint_opacity,
            );
        }
        return;
    }
    // Children path (<Boxxx>{normal JSX}</Boxxx>): the subtree is already laid
    // out as real nodes; walk it and emit each node's bg+border as ONE batched
    // rect instead of scatter-painting each. Box children only — Text/Image are
    // skipped for now (next layer: glyph-atlas emit for Text).
    for (node.children) |*child| emitNodeRect(child);
}

/// Emit one laid-out node's bg+border into the rect pipeline, then recurse.
/// The batch fast-path analog of paintNodeVisuals' bg/border block (no shadow,
/// gradient, hover, text — those need the full paint walk).
fn emitNodeRect(node: *Node) void {
    if (node.style.display == .none) return;
    const r = node.computed;
    if (r.w > 0 and r.h > 0) {
        if (node.style.background_color) |bg| {
            if (bg.a > 0) {
                const bc = node.style.border_color orelse Color.rgb(0, 0, 0);
                gpu.drawRectCorners(
                    r.x,
                    r.y,
                    r.w,
                    r.h,
                    @as(f32, bg.r) / 255.0,
                    @as(f32, bg.g) / 255.0,
                    @as(f32, bg.b) / 255.0,
                    @as(f32, bg.a) / 255.0 * g_paint_opacity,
                    node.style.radiusTL(),
                    node.style.radiusTR(),
                    node.style.radiusBR(),
                    node.style.radiusBL(),
                    node.style.brdTop(),
                    @as(f32, bc.r) / 255.0,
                    @as(f32, bc.g) / 255.0,
                    @as(f32, bc.b) / 255.0,
                    @as(f32, bc.a) / 255.0 * g_paint_opacity,
                );
            }
        } else if (node.style.border_color) |bc| {
            if (node.style.brdTop() > 0 and bc.a > 0) {
                gpu.drawRectCorners(
                    r.x,
                    r.y,
                    r.w,
                    r.h,
                    0,
                    0,
                    0,
                    0,
                    node.style.radiusTL(),
                    node.style.radiusTR(),
                    node.style.radiusBR(),
                    node.style.radiusBL(),
                    node.style.brdTop(),
                    @as(f32, bc.r) / 255.0,
                    @as(f32, bc.g) / 255.0,
                    @as(f32, bc.b) / 255.0,
                    @as(f32, bc.a) / 255.0 * g_paint_opacity,
                );
            }
        }
    }
    for (node.children) |*child| emitNodeRect(child);
}

/// Paint node visuals: background, hover, text, selection, text input.
/// Separated from paintNode to reduce the recursive frame size.
noinline fn paintNodeVisuals(io: std.Io, environ: *const std.process.Environ.Map, node: *Node) void {
    const r = node.computed;
    // Auto-hover affordance: dark slate rect drawn over hovered nodes that
    // opt in via `hoverable=true`. Previously this fired for ANY node with
    // hover handlers — but charts use Pressables purely as invisible hit
    // overlays (onMouseEnter/Leave to drive React-side highlight), and the
    // square hit box was getting painted as a dark "container" behind the
    // visible chart elements. Make the visual opt-in explicit instead.
    const is_hovered = (hovered_node == node) and node.hoverable;

    if (is_hovered and node.style.background_color == null) {
        gpu.drawRectCorners(r.x, r.y, r.w, r.h, 0.15, 0.15, 0.22, 0.6, node.style.radiusTL(), node.style.radiusTR(), node.style.radiusBR(), node.style.radiusBL(), 0, 0, 0, 0, 0);
    }

    // Box shadow — draw BEFORE background so it appears behind
    if (node.style.shadow_color) |sc| {
        if (node.style.shadow_blur > 0) {
            const sa = @as(f32, sc.a) / 255.0 * g_paint_opacity;
            const sr = @as(f32, sc.r) / 255.0;
            const sg = @as(f32, sc.g) / 255.0;
            const sb = @as(f32, sc.b) / 255.0;
            const ox = node.style.shadow_offset_x;
            const oy = node.style.shadow_offset_y;
            const blur = node.style.shadow_blur;
            if (node.style.shadow_method == 1) {
                // Multi-rect: N expanded rects with fading alpha (shadowMethod: 'rect')
                var steps: u32 = @ceil(blur);
                if (steps > 16) steps = 16;
                if (steps < 1) steps = 1;
                const fsteps = @as(f32, @floatFromInt(steps));
                var i: u32 = steps;
                while (i >= 1) : (i -= 1) {
                    const expand = @as(f32, @floatFromInt(i));
                    const alpha = (sa / fsteps) * (fsteps - expand + 1);
                    const rad = node.style.radiusTL() + expand;
                    gpu.drawRect(
                        r.x + ox - expand,
                        r.y + oy - expand,
                        r.w + expand * 2,
                        r.h + expand * 2,
                        sr,
                        sg,
                        sb,
                        alpha,
                        rad,
                        0,
                        0,
                        0,
                        0,
                        0,
                    );
                }
            } else {
                // SDF shader: single rect with GPU blur (default, shadowMethod: 'sdf')
                gpu.drawRectShadow(
                    r.x + ox,
                    r.y + oy,
                    r.w,
                    r.h,
                    sr,
                    sg,
                    sb,
                    sa,
                    node.style.radiusTL(),
                    node.style.radiusTR(),
                    node.style.radiusBR(),
                    node.style.radiusBL(),
                    blur,
                );
            }
        }
    }

    if (node.style.background_color) |bg_raw| {
        if (bg_raw.a > 0) {
            const bg = if (is_hovered) brighten(bg_raw, 20) else bg_raw;
            const bc = node.style.border_color orelse Color.rgb(0, 0, 0);
            // Rotation/scale/translate handled centrally via the GPU node-matrix
            // stack pushed at the top of paintNode — drawRectCorners picks up the
            // active matrix and decomposes it into the per-rect rotation field.
            if (node.style.gradient_color_end) |ge| {
                if (node.style.gradient_direction != .none) {
                    const dir: f32 = switch (node.style.gradient_direction) {
                        .vertical => 1.0,
                        .horizontal => 2.0,
                        else => 0.0,
                    };
                    gpu.drawRectGradient(
                        r.x,
                        r.y,
                        r.w,
                        r.h,
                        @as(f32, bg.r) / 255.0,
                        @as(f32, bg.g) / 255.0,
                        @as(f32, bg.b) / 255.0,
                        @as(f32, bg.a) / 255.0 * g_paint_opacity,
                        node.style.radiusTL(),
                        node.style.radiusTR(),
                        node.style.radiusBR(),
                        node.style.radiusBL(),
                        node.style.brdTop(),
                        @as(f32, bc.r) / 255.0,
                        @as(f32, bc.g) / 255.0,
                        @as(f32, bc.b) / 255.0,
                        @as(f32, bc.a) / 255.0 * g_paint_opacity,
                        @as(f32, ge.r) / 255.0,
                        @as(f32, ge.g) / 255.0,
                        @as(f32, ge.b) / 255.0,
                        @as(f32, ge.a) / 255.0 * g_paint_opacity,
                        dir,
                    );
                } else {
                    gpu.drawRectCorners(
                        r.x,
                        r.y,
                        r.w,
                        r.h,
                        @as(f32, bg.r) / 255.0,
                        @as(f32, bg.g) / 255.0,
                        @as(f32, bg.b) / 255.0,
                        @as(f32, bg.a) / 255.0 * g_paint_opacity,
                        node.style.radiusTL(),
                        node.style.radiusTR(),
                        node.style.radiusBR(),
                        node.style.radiusBL(),
                        node.style.brdTop(),
                        @as(f32, bc.r) / 255.0,
                        @as(f32, bc.g) / 255.0,
                        @as(f32, bc.b) / 255.0,
                        @as(f32, bc.a) / 255.0 * g_paint_opacity,
                    );
                }
            } else {
                gpu.drawRectCorners(
                    r.x,
                    r.y,
                    r.w,
                    r.h,
                    @as(f32, bg.r) / 255.0,
                    @as(f32, bg.g) / 255.0,
                    @as(f32, bg.b) / 255.0,
                    @as(f32, bg.a) / 255.0 * g_paint_opacity,
                    node.style.radiusTL(),
                    node.style.radiusTR(),
                    node.style.radiusBR(),
                    node.style.radiusBL(),
                    node.style.brdTop(),
                    @as(f32, bc.r) / 255.0,
                    @as(f32, bc.g) / 255.0,
                    @as(f32, bc.b) / 255.0,
                    @as(f32, bc.a) / 255.0 * g_paint_opacity,
                );
            }
        }
    }

    // <Image> — decode via image_cache and submit a textured quad. Draws on
    // top of the background (so a padded/rounded container shows behind) and
    // before the border (so a framed image gets its border on top).
    if (node.image_src) |src| {
        image_cache.queueQuad(io, environ, src, r.x, r.y, r.w, r.h, g_paint_opacity);
    }

    // Border without background — draw border-only rect with transparent fill
    if (node.style.background_color == null and (node.style.brdTop() > 0 or node.style.border_width > 0)) {
        if (node.style.border_color) |bc| {
            gpu.drawRectCorners(
                r.x,
                r.y,
                r.w,
                r.h,
                0,
                0,
                0,
                0,
                node.style.radiusTL(),
                node.style.radiusTR(),
                node.style.radiusBR(),
                node.style.radiusBL(),
                node.style.brdTop(),
                @as(f32, bc.r) / 255.0,
                @as(f32, bc.g) / 255.0,
                @as(f32, bc.b) / 255.0,
                @as(f32, bc.a) / 255.0 * g_paint_opacity,
            );
        }
    }

    // Animated border — dashed and/or flowing. Draws on top of any baked
    // border so cart authors who want the animated stroke ALONE should set
    // border_width / border_color on the node to zero/transparent. When
    // either dash field is non-zero, `border_dash.emitDashedStroke` walks a
    // rounded-rect perimeter with the given on/off pattern; when flow_speed
    // is non-zero, the phase offset advances over time to march the pattern.
    if (node.style.border_dash_on > 0 or node.style.border_dash_off > 0 or node.style.border_flow_speed != 0) {
        const bc = node.style.border_color orelse Color.rgb(255, 255, 255);
        // Stroke width priority: explicit border_dash_width → border_width → 1.5 px.
        const stroke_w = if (node.style.border_dash_width > 0)
            node.style.border_dash_width
        else if (node.style.brdTop() > 0)
            node.style.brdTop()
        else
            @as(f32, 1.5);
        // Inset the perimeter by half a stroke so the drawn line sits
        // centered on the rect boundary rather than half outside.
        const inset = stroke_w * 0.5;
        var peri = border_dash.buildRoundedRectPerimeter(
            r.x + inset,
            r.y + inset,
            r.w - inset * 2,
            r.h - inset * 2,
            @max(0, node.style.radiusTL() - inset),
            @max(0, node.style.radiusTR() - inset),
            @max(0, node.style.radiusBR() - inset),
            @max(0, node.style.radiusBL() - inset),
        );
        const ticks_ms = c.SDL_GetTicks();
        const elapsed_sec = @as(f32, @floatFromInt(ticks_ms)) * 0.001;
        // Negative phase = the drawn dash pattern is further along the
        // perimeter, so visually dashes march in the positive-perimeter
        // direction (clockwise). Flipping the sign of border_flow_speed
        // reverses direction — matches what cart authors expect.
        const phase_offset = -node.style.border_flow_speed * elapsed_sec;
        const DashCtx = struct {
            r: f32,
            g: f32,
            b: f32,
            a: f32,
            w: f32,
            fn draw(opaque_ctx: *anyopaque, x0: f32, y0: f32, x1: f32, y1: f32) void {
                const self: *@This() = @ptrCast(@alignCast(opaque_ctx));
                svg_path.drawLineSegment(x0, y0, x1, y1, self.w, self.r, self.g, self.b, self.a);
            }
        };
        var dctx = DashCtx{
            .r = @as(f32, bc.r) / 255.0,
            .g = @as(f32, bc.g) / 255.0,
            .b = @as(f32, bc.b) / 255.0,
            .a = @as(f32, bc.a) / 255.0 * g_paint_opacity,
            .w = stroke_w,
        };
        border_dash.emitDashedStroke(
            &peri,
            node.style.border_dash_on,
            node.style.border_dash_off,
            phase_offset,
            &dctx,
            DashCtx.draw,
        );
    }

    // Video frame — draw after background, before text
    if (node.video_src) |src| {
        _ = videos.paintVideo(src, r.x, r.y, r.w, r.h, g_paint_opacity);
    }

    // Render surface — screen capture, webcam, VM, etc.
    if (node.render_src) |src| {
        render_surfaces.setSuspended(io, environ, src, node.render_suspended);
        _ = render_surfaces.paintSurface(io, environ, src, r.x, r.y, r.w, r.h, g_paint_opacity);
    }

    // Effect — generative visual
    if (node.effect_type) |etype| {
        _ = effects.paintEffect(etype, r.x, r.y, r.w, r.h, g_paint_opacity);
    }
    // Custom effect — user-compiled onRender callback
    if (node.effect_render) |render_fn| {
        _ = render_fn;
        if (node.effect_name) |ename| {
            _ = effects.paintNamedEffect(node, ename, r.x, r.y, r.w, r.h);
        } else {
            _ = effects.paintCustomEffect(io, environ, node, r.x, r.y, r.w, r.h, g_paint_opacity);
        }
    }
    // WorldLoader — the no-V8 compiled-game loader as a native host primitive.
    // React owns only this rectangle; world_loader.zig owns construction,
    // camera/player stepping, and the Scene3D render tree behind it.
    if (node.world_loader) {
        _ = world_loader.renderEmbedded(io, environ, std.heap.c_allocator, node, r.x, r.y, r.w, r.h, g_paint_opacity);
    }

    // 3D.View — 3D viewport rendered offscreen, composited here
    if (node.scene3d) {
        _ = r3d.render(io, environ, node, r.x, r.y, r.w, r.h, g_paint_opacity);
        // Editor overlay (vertex dots / edge highlights / marquee) on top of the
        // composite. The overlay projects the ACTIVE mesh-edit session with the
        // editor's own camera, so it only belongs on the interactive editor
        // viewport — NOT on the many small Scene3D preview tiles (model
        // thumbnails), which would otherwise get the edited mesh's dots smeared
        // over them. Gate on pane size: real viewports are large, thumbnails
        // ~50px. (Precise fix is to scope the overlay to the g_paint viewport
        // rect inside 3d.zig; done here in engine.zig to stay off that file.)
        if (r.w >= EDITOR_OVERLAY_MIN_PANE and r.h >= EDITOR_OVERLAY_MIN_PANE) {
            r3d.drawEditorOverlay(r.x, r.y);
        }
    }

    selection.paintHighlight(node, r.x, r.y);

    // Terminal — cell-grid rendering via vterm
    if (node.terminal) {
        crashlog.logFmt("paint:term session={s}", .{terminalSessionOf(node)});
        paintTerminal(node);
        crashlog.log("paint:term-done");
    }

    if (node.text) |t| {
        // Skip text rendering for TextInput nodes — the input buffer paints instead
        if (t.len > 0 and node.input_id == null) {
            const tc = node.text_color orelse Color.rgb(255, 255, 255);
            const pl = node.style.padLeft();
            const pt = node.style.padTop();
            const pr = node.style.padRight();
            _ = drawNodeTextCommon(node, t, r.x + pl, r.y + pt, @max(1.0, r.w - pl - pr), node.number_of_lines, tc);
        }
    }

    if (node.input_id) |id| {
        if (node.text) |t| {
            // Controlled-value reconciliation: safe while focused because
            // syncValue only rewrites the buffer when the cart's value
            // genuinely changed since the last sync — user keystrokes don't
            // get clobbered by paint-driven resyncs of an unchanged prop.
            input.syncValue(id, t);
        }
        paintTextInput(node, id);
    }
}

/// Render inline glyphs (polygons embedded in text) at their recorded slot positions.
fn paintInlineGlyphs(glyphs: []const layout.InlineGlyph, font_size: u16) void {
    const slot_count = gpu.getInlineSlotCount();
    const slots = gpu.getInlineSlots();
    var gi: usize = 0;
    while (gi < slot_count and gi < glyphs.len) : (gi += 1) {
        const slot = slots[gi];
        const glyph = glyphs[gi];
        const slot_size = slot.size * glyph.scale;
        if (slot_size <= 0) continue;
        const path = svg_path.parsePath(glyph.d);
        if (path.subpath_count == 0) continue;
        // Compute path bounding box
        var min_x: f32 = 1e9;
        var min_y: f32 = 1e9;
        var max_x: f32 = -1e9;
        var max_y: f32 = -1e9;
        for (0..path.subpath_count) |si| {
            const sp = &path.subpaths[si];
            var pi: u32 = 0;
            while (pi + 1 < sp.count) : (pi += 2) {
                if (sp.points[pi] < min_x) min_x = sp.points[pi];
                if (sp.points[pi + 1] < min_y) min_y = sp.points[pi + 1];
                if (sp.points[pi] > max_x) max_x = sp.points[pi];
                if (sp.points[pi + 1] > max_y) max_y = sp.points[pi + 1];
            }
        }
        const pw = max_x - min_x;
        const ph = max_y - min_y;
        if (pw <= 0 or ph <= 0) continue;
        // Scale to fit slot, centered
        const scale = @min(slot_size / pw, slot_size / ph);
        const cx_path = (min_x + max_x) / 2;
        const cy_path = (min_y + max_y) / 2;
        const cx_slot = slot.x + slot_size / 2;
        const cy_slot = slot.y + @as(f32, font_size) / 2;
        // Transform: translate path center to slot center, scale around slot center
        gpu.setTransform(cx_path, cy_path, cx_slot - cx_path * scale, cy_slot - cy_path * scale, scale);
        // Fill: effect texture or flat color
        var used_effect = false;
        if (glyph.fill_effect) |ename| {
            if (effects.getEffectFill(ename)) |info| {
                // Always use direct triangle fill for inline glyphs. The
                // Blend2D path uses a shared surface that can be overwritten
                // between glyph paints, which breaks effect-masked icons.
                svg_path.drawFillFromEffect(&path, info.pixel_buf, info.width, info.height, min_x, min_y, pw, ph);
                used_effect = true;
            }
        }
        if (!used_effect) {
            const fc = glyph.fill;
            svg_path.drawFill(&path, @as(f32, fc.r) / 255.0, @as(f32, fc.g) / 255.0, @as(f32, fc.b) / 255.0, @as(f32, fc.a) / 255.0 * g_paint_opacity);
        }
        // Stroke
        if (glyph.stroke_width > 0 and glyph.stroke.a > 0) {
            const sc = glyph.stroke;
            svg_path.drawStrokeCurves(&path, @as(f32, sc.r) / 255.0, @as(f32, sc.g) / 255.0, @as(f32, sc.b) / 255.0, @as(f32, sc.a) / 255.0 * g_paint_opacity, glyph.stroke_width, 0, 0);
        }
        gpu.resetTransform();
    }
}

/// Paint TextInput: typed text, placeholder, selection highlight, blinking cursor.
noinline fn paintTextInput(node: *Node, id: u8) void {
    const r = node.computed;
    const pl = node.style.padLeft();
    const pt = node.style.padTop();
    const pr = node.style.padRight();
    const pb = node.style.padBottom();
    const inner_h = @max(@as(f32, 0), r.h - pt - pb);
    const typed = input.getText(id);
    const is_placeholder = typed.len == 0;
    const is_multiline = input.isMultiline(id);
    const is_focused = input.isFocused(id);
    const max_w = @max(@as(f32, 1), r.w - pl - pr);
    const cursor_pos = input.getCursorPos(id);
    var text_y = r.y + pt;
    if (!is_multiline) {
        const metrics = measureCallback(
            if (!is_placeholder) typed else (node.placeholder orelse ""),
            node.font_size,
            node.font_family_id,
            max_w,
            node.letter_spacing,
            node.line_height,
            1,
            true,
            node.font_weight >= 600,
        );
        if (metrics.height > 0 and inner_h > metrics.height) {
            text_y += @floor((inner_h - metrics.height) / 2);
        }
    }
    text_y = @floor(text_y);

    // Resolve every caret-dependent position under the same transient font
    // style the painter uses. Without this scope, a monospace/bold input was
    // measured with the default proportional face, so spaces and punctuation
    // accumulated visible drift between the glyph run and the caret.
    var caret_tx: f32 = 0;
    var caret_ty: f32 = 0;
    var text_w: f32 = 0;
    if (!is_multiline or is_focused) {
        if (g_text_engine) |te| {
            const scope = selection.applyNodeTextScope(node);
            defer selection.restoreNodeTextScope(scope);
            const caret_point = te.byteToPosStyledLH(
                typed,
                @as(usize, cursor_pos),
                node.font_size,
                if (is_multiline) max_w else 0,
                node.letter_spacing,
                node.line_height,
            );
            caret_tx = caret_point.x;
            caret_ty = caret_point.y;
            if (!is_multiline) {
                text_w = te.byteToPosStyledLH(
                    typed,
                    typed.len,
                    node.font_size,
                    0,
                    node.letter_spacing,
                    node.line_height,
                ).x;
            }
        }
    }

    // ── Single-line horizontal scroll (the "trailing" behavior) ──────────
    // A single-line input never wraps; its text slides left so the caret
    // stays inside the box as you type past the right edge. The paint pass
    // owns the offset (recomputed every frame from the caret), and the click
    // hit-test reads it back via input.getScrollX so a click lands on the
    // glyph the user sees. Multiline inputs keep hscroll = 0 (they wrap).
    var hscroll: f32 = 0;
    if (!is_multiline) {
        hscroll = input.getScrollX(id);
        if (is_focused) {
            // Keep a small margin of context on either side of the caret so
            // it never sits flush against the clipping edge.
            const margin: f32 = @min(max_w * 0.5, @as(f32, node.font_size) * 0.4 + 2);
            if (caret_tx - hscroll > max_w - margin) hscroll = caret_tx - max_w + margin;
            if (caret_tx - hscroll < margin) hscroll = caret_tx - margin;
        }
        // Never scroll past the text's end or into negative space.
        const max_scroll = @max(@as(f32, 0), text_w - max_w);
        hscroll = @max(@as(f32, 0), @min(hscroll, max_scroll));
        input.setScrollX(id, hscroll);
    }

    // Clip the input's own content to its box. paintNodeVisuals (our caller)
    // paints node content BEFORE the overflow scissor that wraps children, so
    // without this an input's text bleeds out over its siblings. Single-line
    // only — multiline TextArea/TextEditor manage their own viewport (often
    // inside a parent ScrollView) and must not be re-clipped to one line.
    const clip_content = !is_multiline;
    if (clip_content) gpu.pushScissor(r.x + pl, r.y, max_w, r.h);
    defer if (clip_content) gpu.popScissor();

    const tx0 = r.x + pl - hscroll;
    if (!is_placeholder) {
        const sel = input.getSelection(id);
        if (sel.hi > sel.lo) {
            const scope = selection.applyNodeTextScope(node);
            defer selection.restoreNodeTextScope(scope);
            gpu.drawSelectionRects(typed, tx0, text_y, node.font_size, max_w, sel.lo, sel.hi);
        }
    }
    if (!is_placeholder) {
        if (node.input_color_rows) |rows| {
            // Syntax-colored rows bypass drawNodeTextCommon, so establish the
            // node's family/weight/spacing explicitly for the whole row run.
            const scope = selection.applyNodeTextScope(node);
            defer selection.restoreNodeTextScope(scope);
            const line_h: f32 = if (node.line_height > 0) node.line_height else gpu.getLineHeight(node.font_size);
            var start_row: usize = 0;
            var end_row: usize = rows.len;
            if (is_multiline) {
                if (gpu.getActiveScissor()) |clip| {
                    const clip_top = @as(f32, @floatFromInt(clip.y));
                    const clip_bottom = clip_top + @as(f32, @floatFromInt(clip.h));
                    const visible_top = (clip_top - text_y) / line_h;
                    const visible_bottom = (clip_bottom - text_y) / line_h;
                    if (visible_bottom <= 0) {
                        end_row = 0;
                    } else {
                        start_row = if (visible_top > 0) @floor(visible_top) else 0;
                        end_row = @min(rows.len, @as(usize, @ceil(@max(visible_bottom, 0))) + 1);
                    }
                }
            }
            var row_y = text_y + line_h * @as(f32, @floatFromInt(start_row));
            for (rows[start_row..end_row]) |row| {
                gpu.drawColorTextRow(row.spans, tx0, row_y, node.font_size, g_paint_opacity);
                row_y += line_h;
            }
        } else if (node.input_paint_text) {
            const display_text: ?[]const u8 = typed;
            if (display_text) |t| {
                if (t.len > 0) {
                    const tc = node.text_color orelse Color.rgb(220, 220, 220);
                    const max_lines: u16 = if (is_multiline) 0 else 1;
                    // Single-line: wrap width 0 (no wrap) so the full line is
                    // laid out and scrolled via tx0, not truncated at max_w.
                    const wrap_w: f32 = if (is_multiline) max_w else 0;
                    _ = drawNodeTextCommon(node, t, tx0, text_y, wrap_w, max_lines, tc);
                }
            }
        }
    } else if (node.input_paint_text) {
        const display_text: ?[]const u8 = if (!is_placeholder) typed else node.placeholder;
        if (display_text) |t| {
            if (t.len > 0) {
                const tc = if (is_placeholder)
                    Color.rgb(100, 100, 110)
                else
                    (node.text_color orelse Color.rgb(220, 220, 220));
                const max_lines: u16 = if (is_multiline) 0 else 1;
                const wrap_w: f32 = if (is_multiline) max_w else 0;
                _ = drawNodeTextCommon(node, t, tx0, text_y, wrap_w, max_lines, tc);
            }
        }
    }
    if (is_focused and g_cursor_visible) {
        const cx = tx0 + caret_tx;
        // Match the caret to the line box the text and selection use — same
        // metric as the color-row path above and gpu.drawSelectionRects —
        // instead of a hardcoded 1.3×font_size, which left the caret a
        // different height from both the glyphs and the selection highlight.
        const line_h: f32 = if (node.line_height > 0) node.line_height else gpu.getLineHeight(node.font_size);
        const cy = text_y + caret_ty;
        gpu.drawRect(cx, @max(cy, text_y), 2, @max(@min(line_h, inner_h), 4), 1, 1, 1, 0.8, 0, 0, 0, 0, 0, 0);
    }
}

/// Paint a Terminal node: cell-grid rendering via vterm.
/// Each cell gets its own fg color; non-default backgrounds get a bg rect.
/// Uses span-based batching: consecutive cells with the same fg are drawn as one string.
noinline fn paintTerminal(node: *Node) void {
    const session = terminalSessionOf(node);
    const r = node.computed;
    const font_size = node.terminal_font_size;
    const padding: f32 = 4;

    // Sanity check: don't paint if vterm not initialized
    if (vterm_mod.getRowsByName(session) == 0) {
        crashlog.logFmt("paint:skip session={s} rows=0", .{session});
        return;
    }

    // Force monospace family (DejaVuSansMono) for the whole terminal paint.
    // Otherwise glyphs render in the global default (family 0 / proportional
    // DejaVuSans) but cells are sized to `M`'s advance — narrow letters
    // like 'i' end up sitting in a wide cell with visible right-side
    // padding. Family 3 is the mono triple loaded in gpu/text.zig.
    gpu.setFontFamily(3);
    defer gpu.setFontFamily(0);

    const cell_w = gpu.getCharWidth(font_size);
    const cell_h = gpu.getLineHeight(font_size);
    if (cell_w <= 0 or cell_h <= 0) return;

    const avail_w = r.w - padding * 2;
    const avail_h = r.h - padding * 2;
    const cols: u16 = @trunc(@max(1, @floor(avail_w / cell_w)));
    const rows: u16 = @trunc(@max(1, @floor(avail_h / cell_h)));

    // Auto-resize vterm to match layout (only if changed)
    const vt_rows = vterm_mod.getRowsByName(session);
    const vt_cols = vterm_mod.getColsByName(session);
    if (vt_rows != rows or vt_cols != cols) {
        vterm_mod.resizeByName(session, rows, cols);
    }

    const base_x = r.x + padding;
    const base_y = r.y + padding;

    // Scrollback: when scrolled up, top rows come from scrollback, rest from live screen
    const scroll_off = vterm_mod.scrollOffsetByName(session);
    const sb_visible: u16 = @min(scroll_off, rows);

    // Draw cells row by row
    var row: u16 = 0;
    while (row < rows) : (row += 1) {
        const cy = base_y + @as(f32, @floatFromInt(row)) * cell_h;

        // Alternating row background for visual tracking
        if (row % 2 == 1) {
            gpu.drawRect(base_x, cy, avail_w, cell_h, 1.0, 1.0, 1.0, 0.02 * g_paint_opacity, 0, 0, 0, 0, 0, 0);
        }

        // Left accent bar: bright for classified tokens, dim for output
        if (row >= sb_visible) {
            const live_r = row - sb_visible;
            const tok = classifier.getRowTokenByName(session, live_r);
            if (tok != .output and tok != .text) {
                const ac = classifier.tokenColor(tok);
                gpu.drawRect(r.x, cy, 2, cell_h, @as(f32, ac.r) / 255.0, @as(f32, ac.g) / 255.0, @as(f32, ac.b) / 255.0, 0.9 * g_paint_opacity, 0, 0, 0, 0, 0, 0);
            } else {
                gpu.drawRect(r.x, cy + cell_h * 0.35, 2, cell_h * 0.3, 0.3, 0.33, 0.4, 0.25 * g_paint_opacity, 0, 0, 0, 0, 0, 0);
            }
        }

        var col: u16 = 0;
        while (col < cols) : (col += 1) {
            const cell = if (row < sb_visible)
                vterm_mod.scrollbackCellByName(session, row, col)
            else
                vterm_mod.getCellByName(session, row - sb_visible, col);
            const cx = base_x + @as(f32, @floatFromInt(col)) * cell_w;

            // Selection highlight
            if (termCellSelected(row, col)) {
                gpu.drawRect(cx, cy, cell_w, cell_h, 0.3, 0.45, 0.8, 0.45 * g_paint_opacity, 0, 0, 0, 0, 0, 0);
            }

            // Background rect (non-default bg only)
            if (cell.bg) |bg| {
                const actual_bg = if (cell.reverse) (cell.fg orelse @TypeOf(cell.fg.?){ .r = 204, .g = 204, .b = 204 }) else bg;
                gpu.drawRect(cx, cy, cell_w * @as(f32, cell.width), cell_h, @as(f32, actual_bg.r) / 255.0, @as(f32, actual_bg.g) / 255.0, @as(f32, actual_bg.b) / 255.0, g_paint_opacity, 0, 0, 0, 0, 0, 0);
            }

            // Foreground glyph — semantic color for live rows, cell color for scrollback
            if (cell.char_len > 0 and cell.char_buf[0] != ' ') {
                const default_fg = @TypeOf(cell.fg.?){ .r = 204, .g = 204, .b = 204 };
                const raw_fg = if (cell.reverse) (cell.bg orelse @TypeOf(cell.bg.?){ .r = 0, .g = 0, .b = 0 }) else (cell.fg orelse default_fg);
                // Use semantic classifier color for live screen rows (only when overlay active)
                const fg = if (g_semantic_overlay and row >= sb_visible) blk: {
                    const live_row = row - sb_visible;
                    const token = classifier.getRowTokenByName(session, live_row);
                    if (token != .output and token != .text) {
                        const tc = classifier.tokenColor(token);
                        break :blk @TypeOf(raw_fg){ .r = tc.r, .g = tc.g, .b = tc.b };
                    }
                    break :blk raw_fg;
                } else raw_fg;
                gpu.drawGlyphAt(
                    cell.char_buf[0..cell.char_len],
                    cx,
                    cy,
                    font_size,
                    @as(f32, fg.r) / 255.0,
                    @as(f32, fg.g) / 255.0,
                    @as(f32, fg.b) / 255.0,
                    g_paint_opacity,
                );
            }

            // Skip wide characters (CJK occupies 2 cells)
            if (cell.width > 1) col += cell.width - 1;
        }
    }

    // Scrollback indicator — dim bar at top when scrolled up
    if (scroll_off > 0) {
        gpu.drawRect(base_x, r.y, avail_w, 2, 0.5, 0.5, 0.8, 0.6 * g_paint_opacity, 0, 0, 0, 0, 0, 0);
    }

    // Cursor — only show when at live view (not scrolled up)
    if (scroll_off == 0 and vterm_mod.getCursorVisibleByName(session) and g_cursor_visible) {
        const crow = vterm_mod.getCursorRowByName(session);
        const ccol = vterm_mod.getCursorColByName(session);
        if (crow < rows and ccol < cols) {
            const cx = base_x + @as(f32, @floatFromInt(ccol)) * cell_w;
            const cy_cur = base_y + @as(f32, @floatFromInt(crow)) * cell_h;
            gpu.drawRect(cx, cy_cur, cell_w, cell_h, 0.8, 0.8, 0.8, 0.7 * g_paint_opacity, 0, 0, 0, 0, 0, 0);
        }
    }
}

/// Check if a Canvas.Node contains graph-space coordinates (for hover detection).
fn hoverTestCanvasNode(child: *const Node, gpos: [2]f32) bool {
    const hw = child.canvas_gw / 2;
    const hh = child.canvas_gh / 2;
    return gpos[0] >= child.canvas_gx - hw and gpos[0] <= child.canvas_gx + hw and
        gpos[1] >= child.canvas_gy - hh and gpos[1] <= child.canvas_gy + hh;
}

/// Hit-test a Canvas.Node against graph-space coordinates.
fn hitTestCanvasNode(child: *Node, gpos: [2]f32) ?*Node {
    const hw = child.canvas_gw / 2;
    const hh = child.canvas_gh / 2;
    if (gpos[0] >= child.canvas_gx - hw and gpos[0] <= child.canvas_gx + hw and
        gpos[1] >= child.canvas_gy - hh and gpos[1] <= child.canvas_gy + hh)
    {
        return layout.hitTest(child, gpos[0], gpos[1]);
    }
    return null;
}

/// Paint a single canvas child (Canvas.Path or Canvas.Node) with highlight + dim/flow.
fn paintCanvasChild(io: std.Io, environ: *const std.process.Environ.Map, child: *Node, child_idx: u16, hovered: ?u16, selected: ?u16) void {
    if (child.canvas_node) {
        const node_selected = selected != null and selected.? == child_idx;
        const node_hovered = hovered != null and hovered.? == child_idx;
        if (node_selected) {
            const hw = child.canvas_gw / 2 + 5;
            const hh = child.canvas_gh / 2 + 5;
            gpu.drawRect(child.canvas_gx - hw, child.canvas_gy - hh, hw * 2, hh * 2, 0.5, 0.4, 1.0, 0.4, 8, 2, 2, 2, 2, 1.0);
        } else if (node_hovered) {
            const hw = child.canvas_gw / 2 + 4;
            const hh = child.canvas_gh / 2 + 4;
            gpu.drawRect(child.canvas_gx - hw, child.canvas_gy - hh, hw * 2, hh * 2, 0.4, 0.3, 0.9, 0.25, 8, 0, 0, 0, 0, 0);
        }
    }
    g_paint_opacity = canvas.getNodeDim(child_idx);
    g_flow_enabled = canvas.getFlowOverride(child_idx);
    paintNode(io, environ, child);
    g_paint_opacity = 1.0;
    g_flow_enabled = true;
}

/// Paint a Canvas container: transform setup, graph children, HUD layer.
noinline fn paintCanvasContainer(io: std.Io, environ: *const std.process.Environ.Map, node: *Node) void {
    const r = node.computed;
    const ct = node.canvas_type.?;
    // Honor cart-driven viewX/viewY/viewZoom updates, but only when the prop
    // values have actually changed since the last paint — otherwise a routine
    // re-render would snap the camera back and clobber user pan/zoom.
    // applyPropView tracks per-canvas last-applied values and short-circuits
    // when nothing changed. focusWorkerById (cart) calls setViewX/setViewY →
    // prop changes → camera recentres on the newly selected card.
    if (node.canvas_view_set) {
        _ = canvas.applyPropView(node.canvas_id, node.canvas_view_x, node.canvas_view_y, node.canvas_view_zoom);
        node.canvas_view_set = false;
    }
    // Apply drift — continuous camera animation (pauses during drag or node
    // selection; a no-select canvas ignores selection entirely, so a stale
    // global selection can never freeze its WASD pan).
    if (node.canvas_drift_active and canvas_drag_node == null and (!node.canvas_node_select or canvas.getSelectedNode() == null) and g_dt_sec > 0) {
        canvas.handleDrag(-node.canvas_drift_x * g_dt_sec, -node.canvas_drift_y * g_dt_sec);
    }
    gpu.pushScissor(r.x, r.y, r.w, r.h);
    canvas.renderCanvas(ct, r.x, r.y, r.w, r.h);
    positionCanvasNodes(node);
    const cam = canvas.getCameraTransform(r.x, r.y, r.w, r.h);
    const vp_cx = r.x + r.w / 2;
    const vp_cy = r.y + r.h / 2;
    gpu.setTransform(0, 0, vp_cx - cam.cx * cam.scale, vp_cy - cam.cy * cam.scale, cam.scale);
    // Built-in grid overlay — painted under children when canvas_grid_step > 0.
    // Drawn as thin axis-aligned rects in graph space so the active gpu transform
    // converts them to screen-space at current zoom for free.
    if (node.canvas_grid_step > 0) {
        const step: f32 = node.canvas_grid_step;
        const stroke_g: f32 = if (cam.scale > 0) (node.canvas_grid_stroke / cam.scale) else node.canvas_grid_stroke;
        const half: f32 = stroke_g * 0.5;
        const half_w: f32 = (r.w * 0.5) / cam.scale;
        const half_h: f32 = (r.h * 0.5) / cam.scale;
        const gx_min: f32 = cam.cx - half_w - step;
        const gx_max: f32 = cam.cx + half_w + step;
        const gy_min: f32 = cam.cy - half_h - step;
        const gy_max: f32 = cam.cy + half_h + step;
        const minor = node.canvas_grid_color orelse layout.Color.rgba(22, 29, 39, 255);
        const major = node.canvas_grid_color_major orelse minor;
        const major_every: i32 = @intCast(node.canvas_grid_major_every);
        const mr: f32 = @as(f32, minor.r) / 255.0;
        const mg: f32 = @as(f32, minor.g) / 255.0;
        const mb: f32 = @as(f32, minor.b) / 255.0;
        const ma: f32 = @as(f32, minor.a) / 255.0;
        const Mr: f32 = @as(f32, major.r) / 255.0;
        const Mg: f32 = @as(f32, major.g) / 255.0;
        const Mb: f32 = @as(f32, major.b) / 255.0;
        const Ma: f32 = @as(f32, major.a) / 255.0;
        const i_start_x: i32 = @floor(gx_min / step);
        const i_end_x: i32 = @ceil(gx_max / step);
        var ix: i32 = i_start_x;
        while (ix <= i_end_x) : (ix += 1) {
            const gx: f32 = @as(f32, @floatFromInt(ix)) * step;
            const is_major = major_every > 0 and @rem(ix, major_every) == 0;
            const cr = if (is_major) Mr else mr;
            const cg = if (is_major) Mg else mg;
            const cb = if (is_major) Mb else mb;
            const ca = if (is_major) Ma else ma;
            gpu.drawRect(gx - half, gy_min, stroke_g, gy_max - gy_min, cr, cg, cb, ca, 0, 0, 0, 0, 0, 0);
        }
        const i_start_y: i32 = @floor(gy_min / step);
        const i_end_y: i32 = @ceil(gy_max / step);
        var iy: i32 = i_start_y;
        while (iy <= i_end_y) : (iy += 1) {
            const gy: f32 = @as(f32, @floatFromInt(iy)) * step;
            const is_major = major_every > 0 and @rem(iy, major_every) == 0;
            const cr = if (is_major) Mr else mr;
            const cg = if (is_major) Mg else mg;
            const cb = if (is_major) Mb else mb;
            const ca = if (is_major) Ma else ma;
            gpu.drawRect(gx_min, gy - half, gx_max - gx_min, stroke_g, cr, cg, cb, ca, 0, 0, 0, 0, 0, 0);
        }
    }
    {
        // No-select canvases never paint the built-in hover/selected rings.
        const hovered = if (node.canvas_node_select) canvas.getHoveredNode() else null;
        const selected = if (node.canvas_node_select) canvas.getSelectedNode() else null;
        var child_idx: u16 = 0;
        for (node.children) |*child| {
            if (child.canvas_clamp) continue;
            if (child.canvas_node or child.canvas_path) {
                paintCanvasChild(io, environ, child, child_idx, hovered, selected);
                child_idx += 1;
            } else {
                // Flatten through non-canvas container (map pool wrapper)
                for (child.children) |*gc| {
                    if (gc.canvas_clamp) continue;
                    paintCanvasChild(io, environ, gc, child_idx, hovered, selected);
                    child_idx += 1;
                }
            }
        }
    }
    gpu.resetTransform();
    // Force a scissor segment boundary so tile text (batched) renders
    // BEFORE the clamp's background rect. Without this, all rects draw
    // first then all text — tile text bleeds over the clamp background.
    gpu.popScissor();
    gpu.pushScissor(r.x, r.y, r.w, r.h);
    for (node.children) |*child| {
        if (child.canvas_clamp) {
            layout.layoutNode(child, r.x, r.y, r.w, r.h);
            paintNode(io, environ, child);
        } else if (!child.canvas_node and !child.canvas_path) {
            // Flatten through container for clamp grandchildren
            for (child.children) |*gc| {
                if (gc.canvas_clamp) {
                    layout.layoutNode(gc, r.x, r.y, r.w, r.h);
                    paintNode(io, environ, gc);
                }
            }
        }
    }
    gpu.popScissor();
}

// ── Software cursor (KMS mode — no compositor draws a pointer) ───────────

/// Classic arrow pointer, hotspot at the tip (ox,oy). Triangle-fan from tip.
fn drawCursorArrow(ox: f32, oy: f32, r: f32, g: f32, b: f32, a: f32) void {
    const ax = ox;
    const ay = oy + 17;
    const bx = ox + 4;
    const by = oy + 13;
    const cx = ox + 7;
    const cy = oy + 20;
    const dx = ox + 10;
    const dy = oy + 19;
    const ex = ox + 7;
    const ey = oy + 12;
    const fx = ox + 11;
    const fy = oy + 11;
    gpu.drawTri(ox, oy, ax, ay, bx, by, r, g, b, a);
    gpu.drawTri(ox, oy, bx, by, ex, ey, r, g, b, a);
    gpu.drawTri(ox, oy, ex, ey, fx, fy, r, g, b, a);
    gpu.drawTri(bx, by, cx, cy, dx, dy, r, g, b, a);
    gpu.drawTri(bx, by, dx, dy, ex, ey, r, g, b, a);
}

fn drawSoftwareCursor(x: f32, y: f32) void {
    drawCursorArrow(x + 1.5, y + 1.5, 0.0, 0.0, 0.0, 0.55); // drop shadow
    drawCursorArrow(x, y, 1.0, 1.0, 1.0, 1.0); // white pointer
}

// ── Engine entry point ──────────────────────────────────────────────────

pub fn run(config_in: AppConfig) !void {
    var config = config_in;
    const io = config.host.io;
    const environ = config.host.environ;
    g_paisley_debug_enabled = environ.get("ZIGOS_PAISLEY_DEBUG") != null;
    g_dispatch_js_event = config.dispatch_js_event;
    defer g_dispatch_js_event = null;
    const startup_t0 = std.Io.Clock.now(.awake, io).toMicroseconds();
    // Crash log + signal handling for file-explorer launches (no stderr).
    // Logs to /run/user/<uid>/claude-sessions/supervisor-crash.log
    crashlog.init(io, environ);
    crashlog.log("engine.run: starting");

    // Ignore signals that kill the process when launched without a controlling terminal
    crashlog.ignoreSignal(13); // SIGPIPE
    crashlog.ignoreSignal(1); // SIGHUP
    crashlog.installQuitHandler(2, &quitSignalHandler); // SIGINT — ctrl-c from terminal
    crashlog.installQuitHandler(15, &quitSignalHandler); // SIGTERM — `kill` / scripts/dev cleanup
    crashlog.ignoreSignal(20); // SIGTSTP

    // External watchdog: monitors RSS spikes + heartbeat from a separate process.
    // Skipped in dev mode — Debug builds allocate 50MB+ per click-driven React
    // commit which trips the spike threshold and SIGKILLs the host silently.
    const is_dev = if (@hasDecl(build_options, "dev_mode")) build_options.dev_mode else false;
    if (!is_dev) watchdog.init(io);

    // Debug server — auto-start if TSZ_DEBUG=1 (before SDL so it works headless)
    debug_server.init(std.heap.c_allocator, io, environ, config.title);
    defer debug_server.deinit(io);

    // Witness — record/replay for regression testing
    witness.init(io, environ);

    // Loopback / "monitor" sources (capture-what's-playing) — by default
    // SDL3's PulseAudio backend hides them, and the native PipeWire backend
    // hides them outright. Force pulseaudio (PipeWire's pulse compat layer
    // serves the same devices) AND flip the include-monitors hint so the
    // recording-device enumeration surfaces every output's monitor source
    // alongside the physical mics. Carts that don't care about this still
    // pay nothing — the hint only affects enumeration. Must run BEFORE
    // SDL_Init.
    // Linux-only: forcing the pulseaudio driver (PipeWire's pulse compat) and
    // the monitor-source hint is a Linux/PipeWire concern. On macOS there is no
    // pulseaudio driver, so setting it makes SDL_Init(AUDIO) — and thus the
    // whole VIDEO|AUDIO init below — fail; let SDL pick CoreAudio there.
    if (@import("builtin").os.tag == .linux) {
        _ = c.SDL_SetHint("SDL_AUDIO_DRIVER", "pulseaudio");
        _ = c.SDL_SetHint("SDL_AUDIO_INCLUDE_MONITORS", "1");
    }

    // KMS / no-display-server mode: reactjit IS the display server. Take over
    // the console via DRM scanout (framework/render/kms.zig) and run SDL with
    // the dummy video+audio drivers — we keep SDL only for its window/event
    // bookkeeping; pixels go straight to the framebuffer, input via evdev.
    const kms_mode = environ.get("ZIGOS_KMS") != null;
    if (kms_mode) {
        kms.init() catch |err| {
            log.print("[kms] init failed: {}\n", .{err});
            return error.KmsInitFailed;
        };
        _ = c.SDL_SetHint("SDL_VIDEO_DRIVER", "dummy");
        _ = c.SDL_SetHint("SDL_AUDIO_DRIVER", "dummy");
        gpu.setKmsMode(true);
    }
    defer if (kms_mode) kms.deinit();

    if (!c.SDL_Init(c.SDL_INIT_VIDEO | c.SDL_INIT_AUDIO)) {
        log.print("[engine] SDL_Init failed: {s}\n", .{c.SDL_GetError()});
        return error.SDLInitFailed;
    }
    defer {
        // Release any held SDL captures BEFORE SDL_Quit so the X server (or
        // equivalent on macOS/Wayland) drops the pointer grab. SDL_Quit alone
        // sometimes leaves grabs dangling if the binary was mid-chrome-drag
        // when shutdown started; this is the belt to SDL_Quit's suspenders.
        _ = c.SDL_CaptureMouse(false);
        if (g_chrome_dragging) endChromeDrag();
        blazepose.deinit(io);
        whisper.deinit(io);
        voice.deinit(config.host);
        audio_input.deinit();
        c.SDL_Quit();
        watchdog.markCleanExit(io);
        crashlog.markCleanShutdown();
    }
    log.info(.engine, "SDL initialized", .{});

    // Mic-capture + WebRTC VAD scaffolding. Cheap when idle (no SDL stream
    // opened until JS calls __voice_start). Always present so carts can
    // useVoiceInput() without scripts/ship needing to flip a fresh -Dhas-X.
    voice.init(std.heap.c_allocator);
    _ = whisper.init(io, environ, std.heap.c_allocator);
    blazepose.init(io, environ, std.heap.c_allocator);
    audio_input.init(std.heap.c_allocator);

    // Canvas system init
    canvas.init();

    // Geometry: restore saved window position/size
    geometry.init(std.mem.span(config.title));
    var init_w: c_int = @intCast(config.width);
    var init_h: c_int = @intCast(config.height);
    var init_x: c_int = c.SDL_WINDOWPOS_CENTERED;
    var init_y: c_int = c.SDL_WINDOWPOS_CENTERED;
    const explicit_size = config.width != 1280 or config.height != 800;
    const headless_skip_geo = environ.get("ZIGOS_HEADLESS") != null;
    var loaded_geom: ?geometry.WindowGeometry = null;
    if (!headless_skip_geo) {
        loaded_geom = geometry.load(io);
        if (loaded_geom) |g| {
            init_x = g.x;
            init_y = g.y;
            if (!explicit_size) {
                init_w = g.width;
                init_h = g.height;
            }
            log.info(.geometry, "restored {d}x{d} at ({d},{d}) max={d}", .{ g.width, g.height, g.x, g.y, g.maximized });
        }
    }
    if (environ.get("ZIGOS_WINDOW_W")) |ws| {
        if (std.fmt.parseInt(c_int, ws, 10) catch null) |w| init_w = w;
    }
    if (environ.get("ZIGOS_WINDOW_H")) |hs| {
        if (std.fmt.parseInt(c_int, hs, 10) catch null) |h| init_h = h;
    }
    if (environ.get("ZIGOS_WINDOW_X")) |xs| {
        if (std.fmt.parseInt(c_int, xs, 10) catch null) |x| init_x = x;
    }
    if (environ.get("ZIGOS_WINDOW_Y")) |ys| {
        if (std.fmt.parseInt(c_int, ys, 10) catch null) |y| init_y = y;
    }
    if (config.x) |x| init_x = x;
    if (config.y) |y| init_y = y;

    // KMS mode: the offscreen window must match the DRM scanout size exactly,
    // since gpu.init reads the window size for the offscreen render target.
    if (kms_mode) {
        init_w = @intCast(kms.width());
        init_h = @intCast(kms.height());
        init_x = 0;
        init_y = 0;
    }

    const builtin_os = @import("builtin").os.tag;
    const headless = environ.get("ZIGOS_HEADLESS") != null;
    const resizable_flag: u64 = if (config.not_focusable) 0 else c.SDL_WINDOW_RESIZABLE;
    const window_flags: u64 = resizable_flag |
        (if (comptime builtin_os == .macos) c.SDL_WINDOW_METAL else @as(u64, 0)) |
        (if (headless) c.SDL_WINDOW_HIDDEN else @as(u64, 0)) |
        (if (config.borderless) c.SDL_WINDOW_BORDERLESS else @as(u64, 0)) |
        (if (config.always_on_top) c.SDL_WINDOW_ALWAYS_ON_TOP else @as(u64, 0)) |
        (if (config.not_focusable) c.SDL_WINDOW_NOT_FOCUSABLE | c.SDL_WINDOW_UTILITY else @as(u64, 0));
    const window = c.SDL_CreateWindow(
        config.title,
        init_w,
        init_h,
        window_flags,
    ) orelse return error.WindowCreateFailed;
    g_main_window = window;
    defer g_main_window = null;
    defer _ = c.SDL_SetWindowRelativeMouseMode(window, false);
    defer c.SDL_DestroyWindow(window);
    defer windows.deinitAll(io); // close all secondary windows before SDL_Quit
    defer world_window.deinitAll(io); // the compiled-world pop-out too (WORLDWIN-0611)
    defer panel_window.deinitAll(); // the editor-panel pop-out (PANELWIN-0628)
    defer gpu.releasePanelTarget();
    // PANELWIN-0628: route the pop-out window's UI input through engine dispatch.
    panel_window.setEventHook(.{ .hover = panelHover, .press = panelPress, .wheel = panelWheel });
    // SDL3: position is set after creation (not in CreateWindow)
    _ = c.SDL_SetWindowPosition(window, init_x, init_y);
    if (config.always_on_top) _ = c.SDL_SetWindowAlwaysOnTop(window, true);
    _ = c.SDL_SetWindowMinimumSize(window, @intCast(config.min_width), @intCast(config.min_height));

    // Custom window chrome — register hit-test callback for borderless windows
    if (config.borderless) {
        g_chrome_root = config.root;
        g_chrome_window = window;
        _ = c.SDL_SetWindowHitTest(window, windowHitTestCallback, null);
    }

    // Enable text input events (SDL_EVENT_TEXT_INPUT) — required for keyboard input to work
    _ = c.SDL_StartTextInput(window);

    if (loaded_geom) |g| {
        geometry.blockSaves();
        if (g.maximized != 0) _ = c.SDL_MaximizeWindow(window);
    }

    videos.init();
    defer videos.deinit();

    render_surfaces.init();
    defer render_surfaces.deinit(io, environ);

    capture.init(environ);
    defer capture.deinit(io);

    effects.init(environ);
    defer effects.deinit();

    // GPU init
    gpu.init(io, environ, window) catch |err| {
        log.print("wgpu init failed: {}\n", .{err});
        return error.GPUInitFailed;
    };
    defer gpu.deinit();
    {
        const dt = @divTrunc(std.Io.Clock.now(.awake, io).toMicroseconds() - startup_t0, 1000);
        log.print("[startup] gpu: {d}ms\n", .{dt});
    }

    // KMS mode: SDL's dummy video driver delivers no input, so bridge kernel
    // input devices into the SDL queue through an explicit-Io owner.
    var evdev_bridge: ?evdev.Bridge = if (kms_mode)
        evdev.init(config.host.gpa, io, window, @floatFromInt(init_w), @floatFromInt(init_h)) catch |err| blk: {
            log.print("[evdev] init failed: {s}\n", .{@errorName(err)});
            break :blk null;
        }
    else
        null;
    defer if (evdev_bridge) |*bridge| bridge.deinit();

    // Text engine (FreeType)
    var te = TextEngine.initHeadless("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf") catch
        TextEngine.initHeadless("/usr/share/fonts/dejavu/DejaVuSans.ttf") catch // Alpine (font-dejavu)
        TextEngine.initHeadless("/System/Library/Fonts/Supplemental/Arial.ttf") catch
        TextEngine.initHeadless("C:/Windows/Fonts/segoeui.ttf") catch
        return error.FontNotFound;
    defer te.deinit();

    gpu.initText(environ, te.library, te.face, te.fallback_faces, te.fallback_count);
    if (te.face_bold != null) gpu.setBoldFace(te.face_bold);
    g_text_engine = &te;
    layout.setMeasureFn(measureCallback);
    layout.setMeasureImageCallback(.{ .context = config.host, .function = measureImageCallback });
    layout.setEmitLayoutCallback(.{ .context = config.host, .function = emitLayoutCallback });
    input.setMeasureWidthFn(measureWidthOnly);
    {
        const dt = @divTrunc(std.Io.Clock.now(.awake, io).toMicroseconds() - startup_t0, 1000);
        log.print("[startup] text: {d}ms\n", .{dt});
    }

    var win_w: f32 = @floatFromInt(init_w);
    var win_h: f32 = @floatFromInt(init_h);

    // QuickJS VM
    js_vm.initVM(config.host);
    defer js_vm.deinit();

    // IFTTT host-fn no-op stubs — telemetry/system_signals fire these
    // unconditionally via v8_runtime.evalExpr at ~1Hz. The cart bundle
    // (runtime/index.tsx) installs the real shims via useIFTTT.ts, but
    // window-child processes go through the same engine startup WITHOUT
    // ever loading the cart bundle, so without this every system poll
    // floods the child's stderr with ReferenceErrors. Defining no-ops
    // up front means the worst case is "silently dropped event" rather
    // than "log spam every second forever." useIFTTT.ts later overwrites
    // these with the real emit dispatchers in the parent host.
    js_vm.evalScript(config.host, "for (const k of [" ++
        "'__ifttt_onKeyDown','__ifttt_onKeyUp','__ifttt_onClipboardChange'," ++
        "'__ifttt_onSystemFocus','__ifttt_onSystemDrop','__ifttt_onSystemCursor'," ++
        "'__ifttt_onSystemSlowFrame','__ifttt_onSystemHang'," ++
        "'__ifttt_onSystemRam','__ifttt_onSystemVram','__ifttt_onSystemResize'," ++
        "'__ifttt_onSystemSelection','__ifttt_onSystemSelectionCleared'" ++
        "]) if (typeof globalThis[k] !== 'function') globalThis[k] = () => {};");

    // LuaJIT logic VM (main-thread — events, state, conditionals)
    luajit_runtime.initVM();
    defer luajit_runtime.deinit();
    defer {
        if (config.shutdown) |shutdown| shutdown(config.host);
    }
    {
        const dt = @divTrunc(std.Io.Clock.now(.awake, io).toMicroseconds() - startup_t0, 1000);
        log.print("[startup] vms: {d}ms\n", .{dt});
    }

    // App init (FFI registration, state slots, initial conditionals/maps)
    if (config.init) |initFn| initFn(config.host);
    {
        const dt = @divTrunc(std.Io.Clock.now(.awake, io).toMicroseconds() - startup_t0, 1000);
        log.print("[startup] app_init: {d}ms\n", .{dt});
    }

    // Load embedded scripts — after init so host functions are registered,
    // then mark dirty so first tick re-evaluates conditionals with scripts available.
    if (config.js_logic.len > 0) js_vm.evalScript(config.host, config.js_logic);
    if (config.js_logic.len > 0) js_vm.evalExpr(config.host, "__luaReady = true;");
    if (config.js_logic.len > 0 or config.lua_logic.len > 0) state_mod.markDirty();
    {
        const dt = @divTrunc(std.Io.Clock.now(.awake, io).toMicroseconds() - startup_t0, 1000);
        log.print("[startup] scripts: {d}ms\n", .{dt});
    }

    // Test harness — enable if ZIGOS_TEST=1
    if (testharness.envEnabled(environ)) testharness.enable();

    // Initial tick — set up dynamic texts after JS/Lua is evaluated
    if (config.tick) |tickFn| tickFn(config.host, @truncate(c.SDL_GetTicks()));
    {
        const dt = @divTrunc(std.Io.Clock.now(.awake, io).toMicroseconds() - startup_t0, 1000);
        log.print("[startup] first_tick: {d}ms → ready\n", .{dt});
    }

    // PTY remote control socket
    var pty_remote_server = pty_remote.Server.init(config.host.gpa);
    pty_remote_server.start(io);
    defer pty_remote_server.deinit(io);

    // Main loop
    var running = true;
    var fps_last: u64 = c.SDL_GetTicks();
    var fps_previous_frame_us: i64 = 0;
    var fps_interval_count: u32 = 0;
    var fps_interval_elapsed_us: u64 = 0;
    // Last time stderr telemetry was printed. Separate from fps_last so the
    // in-memory bucket still flips every second (drives per-second averages)
    // but the stderr line only actually prints every 10s.
    var telemetry_stderr_last: u64 = 0;

    while (running) {
        // Graceful shutdown via SIGINT/SIGTERM — drop out of the loop so the
        // defer block below runs SDL_CaptureMouse(false) + SDL_Quit + state
        // saves before the process exits.
        if (g_received_quit_signal) {
            running = false;
            break;
        }

        // Hot-reload: check if the app .so was recompiled
        if (config.check_reload) |check| {
            if (check(config.host, &config)) {
                // Reset stale pointers from the old .so
                canvas_drag_node = null;
                canvas_move_drag_id = 0;
                canvas_move_drag_canvas_id = 0;
                scrollbar_drag_slot = 0;
                scrollbar_hover_slot = 0;
                input_drag_active = false;
                input_drag_pending = false;
                term_sel_dragging = false;
                endChromeDrag();
                hovered_node = null;
                g_hover_changed = true;
                // Re-init first (registers host functions), then load scripts
                // (matches startup order: _appInit → evalScript)
                if (config.init) |initFn| initFn(config.host);
                if (config.js_logic.len > 0) js_vm.evalScript(config.host, config.js_logic);
                if (config.js_logic.len > 0) js_vm.evalExpr(config.host, "__luaReady = true;");
                // Restore preserved state (after init resets to defaults, before tick uses it)
                if (config.post_reload) |postFn| postFn(config.host);
                if (config.tick) |tickFn| tickFn(config.host, @truncate(c.SDL_GetTicks()));
                // Update chrome root for borderless hit-testing after root swap
                if (config.borderless) g_chrome_root = config.root;
                layout.markLayoutDirty();
                log.print("[hot-reload] App reloaded\n", .{});
            }
        }

        // [drag-trace] per-iteration counters for chrome-drag freeze diagnosis.
        // Counters and timestamps are unconditional (cheap); the print at the
        // end of the iteration is gated on g_chrome_dragging.
        const dt_iter_start = std.Io.Clock.now(.awake, io).toMicroseconds();
        const dt_evt_start = dt_iter_start;
        var dt_evt_count: u32 = 0;
        var dt_motion_count: u32 = 0;

        // KMS mode: pump raw input devices into the SDL queue first, so the
        // poll loop below sees synthesized mouse events just like real ones.
        if (evdev_bridge) |*bridge| bridge.poll();

        var event: c.SDL_Event = undefined;
        while (c.SDL_PollEvent(&event)) {
            dt_evt_count += 1;
            if (event.type == c.SDL_EVENT_MOUSE_MOTION) dt_motion_count += 1;
            // Route to secondary windows first — if consumed, skip main window handling
            if (windows.routeEvent(io, &event)) continue;
            if (world_window.routeEvent(io, &event)) continue;
            if (panel_window.routeEvent(&event, config.host)) continue;

            switch (event.type) {
                c.SDL_EVENT_QUIT => {
                    log.print("[engine] SDL_EVENT_QUIT received\n", .{});
                    witness.flush(io); // save recording before exit
                    running = false;
                },
                c.SDL_EVENT_WINDOW_CLOSE_REQUESTED => {
                    log.print("[engine] SDL_EVENT_WINDOW_CLOSE_REQUESTED for window {d}\n", .{event.window.windowID});
                    running = false;
                },
                c.SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED => {
                    var ww: c_int = 0;
                    var wh: c_int = 0;
                    _ = c.SDL_GetWindowSize(window, &ww, &wh);
                    win_w = @floatFromInt(ww);
                    win_h = @floatFromInt(wh);
                    gpu.resize(@intCast(ww), @intCast(wh));
                    system_signals.notifyResize(config.host, win_w, win_h);
                    geometry.save(io, window);
                    layout.markLayoutDirty();
                    g_resize_hud_w = @trunc(win_w);
                    g_resize_hud_h = @trunc(win_h);
                    g_resize_hud_until_ms = c.SDL_GetTicks() + 500;
                },
                c.SDL_EVENT_WINDOW_MOVED => {
                    geometry.save(io, window);
                },
                c.SDL_EVENT_PEN_PROXIMITY_IN => {
                    // Pen hovered into tablet range — pre-switch before it touches,
                    // so the pen's remembered tool is already active on contact.
                    if (mouse_state.updatePointerDevice(.pen)) system_signals.notifyPointerDevice(config.host, 1);
                },
                c.SDL_EVENT_PEN_DOWN, c.SDL_EVENT_PEN_UP => {
                    if (mouse_state.updatePointerDevice(.pen)) system_signals.notifyPointerDevice(config.host, 1);
                    if (!event.ptouch.down) mouse_state.g_pen_pressure = 0;
                },
                c.SDL_EVENT_PEN_AXIS => {
                    // Live pressure (0..1) — the JS pointer payload reads this getter,
                    // so brush strokes finally get real Wacom pressure.
                    if (event.paxis.axis == c.SDL_PEN_AXIS_PRESSURE)
                        mouse_state.g_pen_pressure = event.paxis.value;
                },
                c.SDL_EVENT_MOUSE_BUTTON_DOWN => {
                    notePointerDevice(config.host, event.button.which);
                    // Standard OS window behavior: double-click on a drag region
                    // (the borderless app's titlebar) toggles maximize/restore.
                    if (config.borderless and event.button.button == c.SDL_BUTTON_LEFT) {
                        const now_ms: u32 = @intCast(c.SDL_GetTicks() & 0xFFFFFFFF);
                        if (trackChromeDoubleClick(now_ms, event.button.x, event.button.y, event.button.clicks)) {
                            windowMaximize();
                            continue;
                        }
                        if (isDraggableChromeHit(event.button.x, event.button.y)) {
                            beginChromeDrag(event.button.x, event.button.y);
                            continue;
                        }
                    }
                    mouse_state.updateMouse(event.button.x, event.button.y);
                    mouse_state.updateMouseButton(true, event.button.button == c.SDL_BUTTON_RIGHT);
                    // Render surface input forwarding (VNC mouse) — check first
                    {
                        const rmx: f32 = event.button.x;
                        const rmy: f32 = event.button.y;
                        if (render_surfaces.handleMouseDown(io, environ, rmx, rmy, event.button.button)) continue;
                    }
                    // Native mesh-editor input (modelview): middle starts an orbit; left
                    // over the viewport does the active tool (select/marquee or pan-pivot)
                    // or recentres focus on a double-click. No JS in the loop.
                    if (r3d.meshEditCapturing()) {
                        const mx: f32 = event.button.x;
                        const my: f32 = event.button.y;
                        if (event.button.button == c.SDL_BUTTON_MIDDLE) {
                            // Native orbit owns the model stage, not editor chrome.
                            // A middle-specific handler (the UV canvas) or a blocking
                            // chrome node must receive/consume this press below.
                            const middle_events = @import("events.zig");
                            if (middle_events.hitTestMiddleClick(config.root, mx, my) == null) {
                                me_orbiting = true;
                                input.unfocus();
                                continue;
                            }
                        }
                        // A slider/scrollbar under the cursor is chrome — yield so the LEFT
                        // handler below can grab it. meHitIsChrome uses layout.hitTest (topmost
                        // node), which can disagree with the slider/scrollbar walkers the grab
                        // actually uses; check those walkers directly so a value control always
                        // wins instead of being eaten by the mesh-editor select/pan (req_2511).
                        const on_value_ctl = hitTestSlider(config.root, mx, my) != null or hitTestScrollbar(config.root, mx, my) != null;
                        if (r3d.characterRigActive() and event.button.button == c.SDL_BUTTON_LEFT and
                            !on_value_ctl and !meHitIsChrome(layout.hitTest(config.root, mx, my)))
                        {
                            input.unfocus();
                            const rig_gizmo_hit = r3d.characterRigGizmoHit(mx, my);
                            if (rig_gizmo_hit >= 0 and r3d.characterRigGizmoBegin(rig_gizmo_hit)) {
                                me_character_rig_gizmo_dragging = true;
                                state_mod.markDirty();
                                continue;
                            }
                            var select_buf: [160]u8 = undefined;
                            if (std.fmt.bufPrintZ(&select_buf, "__characterRigViewportSelect({d},{d})", .{ mx, my })) |expr| {
                                js_vm.callGlobal(config.host, "__beginJsEvent");
                                js_vm.evalExpr(config.host, expr);
                                js_vm.callGlobal(config.host, "__endJsEvent");
                                state_mod.markDirty();
                            } else |_| {}
                            continue;
                        }
                        // Ctrl+right-click (req_4271): extrude the live edge/face selection
                        // TOWARD the clicked point. One JS round-trip (not a direct host
                        // call) so the cart adopts the new mesh key like every topo op;
                        // without a usable selection the press falls through to the
                        // ordinary context-menu route below.
                        if (event.button.button == c.SDL_BUTTON_RIGHT and
                            !on_value_ctl and !meHitIsChrome(layout.hitTest(config.root, mx, my)) and
                            (c.SDL_GetModState() & c.SDL_KMOD_CTRL) != 0 and !r3d.meshLcActive())
                        {
                            const mode_now = r3d.meshEditModeRaw();
                            if ((mode_now == 2 or mode_now == 3) and r3d.meshEditSelectionCount() > 0) {
                                var extrude_buf: [96]u8 = undefined;
                                if (std.fmt.bufPrintZ(&extrude_buf, "__meshEditExtrudeTo({d},{d})", .{ mx, my })) |expr| {
                                    js_vm.callGlobal(config.host, "__beginJsEvent");
                                    js_vm.evalExpr(config.host, expr);
                                    js_vm.callGlobal(config.host, "__endJsEvent");
                                } else |_| {}
                                state_mod.markDirty();
                                continue;
                            }
                        }
                        if (event.button.button == c.SDL_BUTTON_LEFT and !on_value_ctl and !meHitIsChrome(layout.hitTest(config.root, mx, my))) {
                            input.unfocus();
                            me_down_x = mx;
                            me_down_y = my;
                            me_marquee = false;
                            if (event.button.clicks >= 2) {
                                _ = r3d.focusAt(mx, my);
                                state_mod.markDirty();
                                continue;
                            }
                            if (r3d.meshEditFocusTool()) {
                                me_panning = true;
                                continue;
                            }
                            // A LIVE loop-cut session is MODAL (req_2625 gap DD): the
                            // drawn cut-plane handle is the only grabbable — a hit
                            // starts the host-side offset drag; any other press is
                            // inert (falling through to a face pick would mutate the
                            // selection the session's captured base was built from).
                            // The popup buttons and Esc are the exits.
                            if (r3d.meshLcActive()) {
                                if (r3d.meshLcHandleHit(mx, my)) {
                                    me_lc_dragging = true;
                                    state_mod.markDirty();
                                }
                                continue;
                            }
                            // Orientation compass (req_2643 gap LL): the bottom-left
                            // nav ball is furniture, never a mesh pick — an axis dot
                            // snaps the orbit to that axis-aligned view; its centre
                            // rebases the full-model frame, and the remaining ball body
                            // consumes the press so nothing selects through it.
                            // Checked after the loop-cut modal (its law: other presses
                            // are inert) and before every pick.
                            const compass_hit = r3d.meshCompassHit(mx, my);
                            if (compass_hit >= 0) {
                                if (r3d.meshCompassSnap(compass_hit)) state_mod.markDirty();
                                continue;
                            }
                            // Backdrop move gizmo (req_3080) — its arms sit at the
                            // reference image's center, never the selection pivot, so
                            // checking it before the mesh gizmo can't steal a mesh grab.
                            const bh = r3d.bdGizmoHit(mx, my);
                            if (bh >= 0) {
                                me_bd_dragging = true;
                                r3d.bdGizmoBegin(bh);
                                state_mod.markDirty();
                                continue;
                            }
                            const gh = r3d.meshGizmoHit(mx, my);
                            if (gh >= 0) {
                                me_gizmo_dragging = true;
                                me_gizmo_axis = gh;
                                r3d.meshGizmoBegin();
                                // Handle code + grab point: the gold glow and the uniform
                                // hub's radial ×1 base (req_2827 studio-gizmo port).
                                r3d.meshGizmoGrabAt(mx, my, gh);
                                state_mod.markDirty();
                                continue;
                            }
                            const m = r3d.meshEditModeRaw();
                            if (m >= 1 and m <= 3) {
                                // A geometry click is also an outliner focus gesture.
                                // Switch scope synchronously, then let this SAME press
                                // perform the requested element pick in the new part.
                                const part = r3d.meshEditOutOfScopePartAt(mx, my);
                                if (part >= 0) {
                                    var focus_buf: [96]u8 = undefined;
                                    if (std.fmt.bufPrintZ(&focus_buf, "__meshEditFocusPart({d})", .{part})) |expr| {
                                        js_vm.callGlobal(config.host, "__beginJsEvent");
                                        js_vm.evalExpr(config.host, expr);
                                        js_vm.callGlobal(config.host, "__endJsEvent");
                                    } else |_| {}
                                }
                                me_selecting = true;
                                const me_mods = c.SDL_GetModState();
                                me_shift = mesh_selection_policy.additiveForPointer((me_mods & c.SDL_KMOD_SHIFT) != 0);
                                me_ctrl = (me_mods & c.SDL_KMOD_CTRL) != 0;
                                me_cut_armed = false;
                                if (me_ctrl and m == 3) {
                                    // Ctrl on a face-mode press arms the marquee-projected
                                    // CUT (req_4271). The pick defers to release so a cut
                                    // sweep never mutates the selection on the way in.
                                    me_cut_armed = true;
                                    r3d.meshEditSnapshot();
                                } else if (me_ctrl and m == 2) {
                                    // Ctrl+click in edge mode selects the edge PATH under
                                    // the cursor, cycling loop → ring → single edge on
                                    // repeated clicks (req_4271); shift adds a second path.
                                    r3d.meshEditSnapshot();
                                    _ = r3d.meshEditPathPick(mx, my, me_shift);
                                } else {
                                    r3d.meshEditSnapshot();
                                    _ = r3d.meshEditPick(mx, my, me_shift);
                                }
                                state_mod.markDirty();
                            }
                            continue;
                        }
                    }
                    if (event.button.button == c.SDL_BUTTON_LEFT or event.button.button == c.SDL_BUTTON_RIGHT) {
                        const mx: f32 = event.button.x;
                        const my: f32 = event.button.y;
                        const over_paint_chrome = mapPaintHitIsChrome(config.root, mx, my);
                        if (!over_paint_chrome) {
                            if (hitTestWorldLoader(config.root, mx, my)) |loader_node| {
                                // MAPPAINT req_2473: an armed paint tool claims the LEFT
                                // button before the external-camera fall-through — the
                                // stroke runs host-side, zero JS per event.
                                if (event.button.button == c.SDL_BUTTON_LEFT and world_loader.paintArmed(loader_node.id)) {
                                    world_loader_paint_node_id = loader_node.id;
                                    world_loader.paintPointer(io, loader_node.id, .down, mx, my);
                                    state_mod.markDirty();
                                    continue;
                                }
                                // LOADERVIEW req_1776: an editor-driven loader (external camera)
                                // is a passive viewport — DON'T capture the pointer for in-world
                                // look; fall through so the event reaches the editor's JS overlay
                                // (its drag rotates the iso camera). Only a playable loader grabs it.
                                if (!world_loader.isExternalCamera(loader_node.id)) {
                                    captureWorldLoaderPointer(loader_node);
                                    if (event.button.button == c.SDL_BUTTON_RIGHT) {
                                        world_loader.setAiming(loader_node.id, true);
                                        world_loader_mouse_aiming = true;
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                    // Physics drag — try to grab a dynamic body
                    if (event.button.button == c.SDL_BUTTON_LEFT and physics2d.isInitialized()) {
                        const pmx: f32 = event.button.x;
                        const pmy: f32 = event.button.y;
                        physics2d.startDrag(pmx, pmy);
                    }
                    // Context menu: dismiss on left-click, consume if item was hit
                    if (event.button.button == c.SDL_BUTTON_LEFT and context_menu.isVisible()) {
                        const cmx: f32 = event.button.x;
                        const cmy: f32 = event.button.y;
                        if (context_menu.handleClick(config.host, cmx, cmy)) continue;
                        // handleClick returns false for outside clicks (and hides the menu)
                        // — fall through to normal left-click handling
                    }
                    // Right-click — context menu items or on_right_click handler
                    if (event.button.button == c.SDL_BUTTON_RIGHT) {
                        const mx: f32 = event.button.x;
                        const my: f32 = event.button.y;
                        context_menu.hide(); // dismiss any existing native menu first
                        const rc_events = @import("events.zig");
                        if (rc_events.hitTestRightClick(config.root, mx, my)) |h| {
                            // Prefer the native context_menu_items overlay when
                            // explicitly declared. on_right_click is also set
                            // when JS attaches onContextMenu (alias), so the
                            // explicit-items path wins.
                            if (h.context_menu_items) |items| {
                                context_menu.showFor(mx, my, items, h.scroll_persist_slot);
                            } else if (h.handlers.on_right_click) |handler| {
                                prepared_input.prepareNodeEvent(h.scroll_persist_slot);
                                handler(h.handlers.context, mx, my);
                            }
                        }
                    }
                    // Middle-click — dispatch onMiddleClick to JSRT
                    if (event.button.button == c.SDL_BUTTON_MIDDLE) {
                        const mx: f32 = event.button.x;
                        const my: f32 = event.button.y;
                        const events = @import("events.zig");
                        if (events.hitTestMiddleClick(config.root, mx, my)) |h| {
                            if (h.handlers.js_on_middle_click) |expr| {
                                input.unfocus();
                                const expr_str = std.mem.span(expr);
                                js_vm.callGlobal(config.host, "__beginJsEvent");
                                js_vm.evalExpr(config.host, expr_str);
                                js_vm.callGlobal(config.host, "__endJsEvent");
                                state_mod.markDirty();
                            }
                        }
                    }
                    if (event.button.button == c.SDL_BUTTON_LEFT) {
                        const mx: f32 = event.button.x;
                        const my: f32 = event.button.y;
                        const events = @import("events.zig");
                        if (hitTestScrollbar(config.root, mx, my)) |hit| {
                            const pos = if (hit.axis == .vertical) my else mx;
                            scrollbar_drag_slot = hit.node.scroll_persist_slot;
                            scrollbar_drag_axis = hit.axis;
                            scrollbar_drag_track_start = hit.track_start;
                            scrollbar_drag_track_len = hit.track_len;
                            scrollbar_drag_thumb_len = hit.thumb_len;
                            scrollbar_drag_cached_max_scroll = hit.max_scroll;
                            scrollbar_drag_offset = if (pos >= hit.thumb_start and pos <= hit.thumb_start + hit.thumb_len)
                                pos - hit.thumb_start
                            else
                                hit.thumb_len * 0.5;
                            input.unfocus();
                            markScrollActivity(hit.node);
                            _ = updateScrollbarDrag(config.host, config.root, pos);
                            continue;
                        }
                        // <Slider> grab (SLIDER-0611) — engine owns the thumb until
                        // release; the press position IS the first value write.
                        if (hitTestSlider(config.root, mx, my)) |sn| {
                            if (sn.scroll_persist_slot != 0) {
                                slider_drag_slot = sn.scroll_persist_slot;
                                slider_drag_last_dispatch_ms = 0;
                                slider_drag_last_sent = std.math.nan(f32);
                                sn.slider_dragging = true;
                                input.unfocus();
                                updateSliderDrag(config.host, config.root, mx);
                                continue;
                            }
                        }
                        // Alt+click on a Canvas.Node with canvas_move_draggable starts a
                        // position-drag that the cart commits via onMove(gx, gy) on release.
                        const mod_state = c.SDL_GetModState();
                        if ((mod_state & c.SDL_KMOD_ALT) != 0) {
                            if (events.findCanvasNode(config.root, mx, my)) |cn| {
                                const vp_cx = cn.computed.x + cn.computed.w / 2;
                                const vp_cy = cn.computed.y + cn.computed.h / 2;
                                const gpos = canvas.screenToGraph(mx, my, vp_cx, vp_cy);
                                var target: ?*Node = null;
                                for (cn.children) |*child| {
                                    if (child.canvas_node and child.canvas_move_draggable and hoverTestCanvasNode(child, gpos)) {
                                        target = child;
                                        break;
                                    } else if (!child.canvas_path and !child.canvas_clamp and !child.canvas_node) {
                                        for (child.children) |*gc| {
                                            if (gc.canvas_node and gc.canvas_move_draggable and hoverTestCanvasNode(gc, gpos)) {
                                                target = gc;
                                                break;
                                            }
                                        }
                                        if (target != null) break;
                                    }
                                }
                                if (target) |node| {
                                    canvas_move_drag_id = node.scroll_persist_slot;
                                    canvas_move_drag_canvas_id = cn.scroll_persist_slot;
                                    canvas_move_drag_offset_x = node.canvas_gx - gpos[0];
                                    canvas_move_drag_offset_y = node.canvas_gy - gpos[1];
                                    input.unfocus();
                                    continue;
                                }
                            }
                        }
                        const hit = layout.hitTest(config.root, mx, my);
                        // NAVDEAD-0605 diagnostic: dump the full hit-candidate
                        // stack for every left click → stderr + /tmp/reactjit-hit.log.
                        hit_trace.trace(io, environ, config.root, mx, my, hit);
                        const hit_is_interactive = if (hit) |h| (h.input_id != null or h.handlers.on_mouse_down != null or h.handlers.js_on_mouse_down != null or h.handlers.lua_on_mouse_down != null or h.handlers.on_mouse_move != null or h.handlers.js_on_mouse_move != null or h.handlers.lua_on_mouse_move != null or h.handlers.on_mouse_up != null or h.handlers.js_on_mouse_up != null or h.handlers.lua_on_mouse_up != null or h.handlers.on_press != null or h.handlers.js_on_press != null or h.handlers.lua_on_press != null or h.href != null) else false;
                        const hit_blocks_pointer = if (hit) |h| h.blocks_pointer_events else false;
                        const canvas_hit = if (!hit_blocks_pointer) events.findCanvasNode(config.root, mx, my) else null;
                        if (hit_is_interactive) {
                            const h = hit.?;
                            if (h.input_id) |id| {
                                stampClickLatency();
                                const now_ms: u32 = @intCast(c.SDL_GetTicks() & 0xFFFFFFFF);
                                const clicks = input.trackClick(now_ms);
                                input.focus(id);
                                // Single-global-highlight: input took focus, drop tree highlight.
                                selection.clear();
                                const pl = h.style.padLeft();
                                const pt = h.style.padTop();
                                var scroll_x: f32 = 0;
                                var scroll_y: f32 = 0;
                                _ = scrollOffsetForNode(config.root, h, &scroll_x, &scroll_y);
                                // Add the input's own horizontal text-scroll so the click maps to
                                // the glyph the user sees, not the one that would be there at scroll 0.
                                const local_x = mx + scroll_x - h.computed.x - pl + input.getScrollX(id);
                                const local_y = my + scroll_y - h.computed.y - pt;
                                const cursor_pos = hitTestInputByte(h, id, local_x, local_y);
                                if (clicks == 3) {
                                    input.selectAll(id);
                                } else if (clicks == 2) {
                                    input.setCursorPos(id, cursor_pos);
                                    input.selectWord(id);
                                } else {
                                    input.setCursorPos(id, cursor_pos);
                                    input.startDrag(id);
                                    input_drag_active = true;
                                    input_drag_id = id;
                                    input_drag_node_x = h.computed.x - scroll_x;
                                    input_drag_node_y = h.computed.y - scroll_y;
                                    input_drag_node_pl = pl;
                                    input_drag_node_pt = pt;
                                }
                            } else if (h.handlers.on_mouse_down != null or h.handlers.js_on_mouse_down != null or h.handlers.lua_on_mouse_down != null) {
                                input.unfocus();
                                stampClickLatency();
                                stampInputLatency(config.host.io, "click");
                                dispatchPointerHandler(config.host, h, .down);
                                if (nodeWantsPointerCapture(h)) {
                                    pointer_capture_slot = h.scroll_persist_slot;
                                    pointer_capture_button = event.button.button;
                                }
                            } else if (h.handlers.js_on_mouse_down) |js_expr| {
                                input.unfocus();
                                stampClickLatency();
                                stampInputLatency(config.host.io, "click");
                                const expr = std.mem.span(js_expr);
                                js_vm.callGlobal(config.host, "__beginJsEvent");
                                js_vm.evalExpr(config.host, expr);
                                js_vm.callGlobal(config.host, "__endJsEvent");
                                state_mod.markDirty();
                            } else if (h.handlers.lua_on_mouse_down) |lua_expr| {
                                input.unfocus();
                                stampClickLatency();
                                stampInputLatency(config.host.io, "click");
                                luajit_runtime.evalExpr(std.mem.span(lua_expr));
                            } else if (h.handlers.on_press) |handler| {
                                input.unfocus();
                                stampClickLatency();
                                stampInputLatency(config.host.io, "click");
                                log.print("[press] zig handler at ({d:.0},{d:.0})\n", .{ mx, my });
                                handler(h.handlers.context);
                                // Also run JS handler if present
                                if (h.handlers.js_on_press) |js_expr| {
                                    const expr = std.mem.span(js_expr);
                                    log.print("[press] +js: '{s}'\n", .{expr});
                                    runJsHandlerExpr(config.host, expr);
                                    log.print("[press] +js done\n", .{});
                                }
                                // Also run Lua handler if present
                                if (h.handlers.lua_on_press) |lua_expr| {
                                    luajit_runtime.evalExpr(std.mem.span(lua_expr));
                                }
                            } else if (h.handlers.lua_on_press) |lua_expr| {
                                input.unfocus();
                                stampClickLatency();
                                stampInputLatency(config.host.io, "click");
                                log.print("[lua_on_press] eval: '{s}'\n", .{std.mem.span(lua_expr)});
                                luajit_runtime.evalExpr(std.mem.span(lua_expr));
                                log.print("[lua_on_press] done\n", .{});
                            } else if (h.handlers.js_on_press) |js_expr| {
                                input.unfocus();
                                stampClickLatency();
                                stampInputLatency(config.host.io, "click");
                                const expr = std.mem.span(js_expr);
                                log.print("[js_on_press] eval: '{s}'\n", .{expr});
                                const jt0 = std.Io.Clock.now(.awake, io).toMicroseconds();
                                runJsHandlerExpr(config.host, expr);
                                const jt1 = std.Io.Clock.now(.awake, io).toMicroseconds();
                                log.print("[js_on_press] done ({d}us)\n", .{jt1 - jt0});
                            } else if (h.href) |url| {
                                stampClickLatency();
                                stampInputLatency(config.host.io, "click");
                                openUrl(config.host.io, url);
                            }
                            // Witness: record the click with semantic target
                            witness.recordClick(h);
                        } else if (canvas_hit) |cn| {
                            // Canvas click — check for interactive elements inside Canvas.Nodes
                            // Convert screen coords to graph space for canvas-child hit testing
                            const vp_cx = cn.computed.x + cn.computed.w / 2;
                            const vp_cy = cn.computed.y + cn.computed.h / 2;
                            const gpos = canvas.screenToGraph(mx, my, vp_cx, vp_cy);
                            // Find which Canvas.Node child contains the click (flatten through containers)
                            var canvas_child_hit: ?*Node = null;
                            for (cn.children) |*child| {
                                if (child.canvas_node) {
                                    canvas_child_hit = hitTestCanvasNode(child, gpos);
                                    if (canvas_child_hit != null) break;
                                } else if (!child.canvas_path and !child.canvas_clamp) {
                                    for (child.children) |*gc| {
                                        if (gc.canvas_node) {
                                            canvas_child_hit = hitTestCanvasNode(gc, gpos);
                                            if (canvas_child_hit != null) break;
                                        }
                                    }
                                    if (canvas_child_hit != null) break;
                                }
                            }
                            // Dispatch interactive element if found, otherwise select node + start drag
                            var handled_interactive = false;
                            if (canvas_child_hit) |h| {
                                if (h.input_id) |id| {
                                    stampClickLatency();
                                    input.focus(id);
                                    // Single-global-highlight: input took focus, drop tree highlight.
                                    selection.clear();
                                    const pl = h.style.padLeft();
                                    const pt = h.style.padTop();
                                    const local_x = gpos[0] - h.computed.x - pl + input.getScrollX(id);
                                    const local_y = gpos[1] - h.computed.y - pt;
                                    const cursor_pos = hitTestInputByte(h, id, local_x, local_y);
                                    input.setCursorPos(id, cursor_pos);
                                    input.startDrag(id);
                                    input_drag_active = true;
                                    input_drag_id = id;
                                    input_drag_node_x = h.computed.x;
                                    input_drag_node_y = h.computed.y;
                                    input_drag_node_pl = pl;
                                    input_drag_node_pt = pt;
                                    handled_interactive = true;
                                } else if (h.handlers.on_mouse_down) |handler| {
                                    stampClickLatency();
                                    stampInputLatency(config.host.io, "click");
                                    handler(h.handlers.context);
                                    if (h.handlers.js_on_mouse_down) |js_expr| {
                                        js_vm.callGlobal(config.host, "__beginJsEvent");
                                        js_vm.evalExpr(config.host, std.mem.span(js_expr));
                                        js_vm.callGlobal(config.host, "__endJsEvent");
                                        state_mod.markDirty();
                                    }
                                    if (h.handlers.lua_on_mouse_down) |lua_expr| {
                                        luajit_runtime.evalExpr(std.mem.span(lua_expr));
                                    }
                                    handled_interactive = true;
                                } else if (h.handlers.js_on_mouse_down) |js_expr| {
                                    stampClickLatency();
                                    stampInputLatency(config.host.io, "click");
                                    js_vm.callGlobal(config.host, "__beginJsEvent");
                                    js_vm.evalExpr(config.host, std.mem.span(js_expr));
                                    js_vm.callGlobal(config.host, "__endJsEvent");
                                    state_mod.markDirty();
                                    handled_interactive = true;
                                } else if (h.handlers.lua_on_mouse_down) |lua_expr| {
                                    stampClickLatency();
                                    stampInputLatency(config.host.io, "click");
                                    luajit_runtime.evalExpr(std.mem.span(lua_expr));
                                    handled_interactive = true;
                                } else if (h.handlers.on_press) |handler| {
                                    stampClickLatency();
                                    stampInputLatency(config.host.io, "click");
                                    handler(h.handlers.context);
                                    if (h.handlers.js_on_press) |js_expr| {
                                        runJsHandlerExpr(config.host, std.mem.span(js_expr));
                                    }
                                    if (h.handlers.lua_on_press) |lua_expr| {
                                        luajit_runtime.evalExpr(std.mem.span(lua_expr));
                                    }
                                    handled_interactive = true;
                                } else if (h.handlers.lua_on_press) |lua_expr| {
                                    stampClickLatency();
                                    stampInputLatency(config.host.io, "click");
                                    luajit_runtime.evalExpr(std.mem.span(lua_expr));
                                    handled_interactive = true;
                                } else if (h.handlers.js_on_press) |js_expr| {
                                    stampClickLatency();
                                    stampInputLatency(config.host.io, "click");
                                    runJsHandlerExpr(config.host, std.mem.span(js_expr));
                                    handled_interactive = true;
                                } else if (h.href) |url| {
                                    stampClickLatency();
                                    stampInputLatency(config.host.io, "click");
                                    openUrl(config.host.io, url);
                                    handled_interactive = true;
                                }
                                if (handled_interactive) witness.recordClick(h);
                            }
                            if (!handled_interactive) {
                                // Background click — select/deselect canvas node and start drag.
                                // selectNodes={false} canvases skip the toggle: their carts own
                                // selection, and a phantom engine selection freezes drift pan.
                                input.unfocus();
                                if (cn.canvas_node_select and canvas.getHoveredNode() != null) canvas.clickNode();
                                canvas_drag_node = cn;
                                canvas_drag_last_x = mx;
                                canvas_drag_last_y = my;
                            }
                        } else if (!hit_blocks_pointer) {
                            // Hit-test live Terminal nodes for the click.
                            const HitCtx = struct {
                                mx: f32,
                                my: f32,
                                hit: ?*Node = null,
                            };
                            var hit_ctx = HitCtx{ .mx = mx, .my = my };
                            forEachTerminalNode(config.root, &hit_ctx, struct {
                                fn visit(c_: *HitCtx, tn: *Node, _: []const u8) void {
                                    if (c_.hit != null) return;
                                    const tr = tn.computed;
                                    if (c_.mx >= tr.x and c_.mx <= tr.x + tr.w and c_.my >= tr.y and c_.my <= tr.y + tr.h) {
                                        c_.hit = tn;
                                    }
                                }
                            }.visit);
                            if (hit_ctx.hit) |tn| {
                                const sess = terminalSessionOf(tn);
                                setFocusedSession(sess);
                                // If the inner program enabled SGR mouse
                                // reporting, forward the click rather
                                // than starting a host-side selection.
                                if (vterm_mod.getMouseModeByName(sess) > 0) {
                                    forwardTermMouse(tn, sess, mx, my, 0, 'M');
                                    g_term_mouse_forwarding = true;
                                } else {
                                    const cell = termPixelToCell(tn, mx, my);
                                    term_sel_start_row = cell.row;
                                    term_sel_start_col = cell.col;
                                    term_sel_end_row = cell.row;
                                    term_sel_end_col = cell.col;
                                    term_sel_active = false;
                                    term_sel_dragging = true;
                                }
                            } else {
                                termClearSelection();
                                selection.onMouseDown(config.root, mx, my, @intCast(c.SDL_GetTicks() & 0xFFFFFFFF));
                            }
                            input.unfocus();
                            // Single-global-highlight: tree-text takes over, wipe input highlights.
                            input.clearAllSelections();
                        }
                    }
                },
                c.SDL_EVENT_MOUSE_MOTION => {
                    notePointerDevice(config.host, event.motion.which);
                    const mx: f32 = event.motion.x;
                    const my: f32 = event.motion.y;
                    mouse_state.updateMouse(mx, my);
                    mouse_state.addMouseDelta(event.motion.xrel, event.motion.yrel);
                    // Native mesh-editor drag (modelview): orbit / pan-pivot / marquee — all
                    // host-side, repaint only, no JS render per move.
                    if (r3d.meshEditCapturing()) {
                        if (me_orbiting) {
                            r3d.orbitDrag(event.motion.xrel, event.motion.yrel);
                            state_mod.markDirty();
                            continue;
                        }
                        if (me_panning) {
                            r3d.orbitPan(event.motion.xrel, event.motion.yrel);
                            state_mod.markDirty();
                            continue;
                        }
                        if (me_character_rig_gizmo_dragging) {
                            const rig_mod = c.SDL_GetModState();
                            _ = r3d.characterRigGizmoDrag(
                                event.motion.xrel,
                                event.motion.yrel,
                                (rig_mod & c.SDL_KMOD_SHIFT) != 0,
                            );
                            state_mod.markDirty();
                            continue;
                        }
                        if (me_bd_dragging) {
                            // Backdrop move gizmo (req_3080): same stepped mapping as the
                            // mesh gizmo; the cart polls the pose back to move the quad.
                            const bmod = c.SDL_GetModState();
                            _ = r3d.bdGizmoDrag(
                                event.motion.xrel,
                                event.motion.yrel,
                                (bmod & c.SDL_KMOD_SHIFT) != 0,
                                (bmod & (c.SDL_KMOD_CTRL | c.SDL_KMOD_ALT)) != 0,
                            );
                            state_mod.markDirty();
                            continue;
                        }
                        if (me_gizmo_dragging) {
                            // Stepped drags (req_2759): no modifier = whole modeling units,
                            // Shift = the fine grid, Ctrl (or Alt, the old studio's key) = freeform.
                            // Held V (req_3378) = vertex snapping on the MOVE tool.
                            const gmod = c.SDL_GetModState();
                            const gkeys = c.SDL_GetKeyboardState(null);
                            const snap_vertex = gkeys != null and gkeys[c.SDL_SCANCODE_V];
                            _ = r3d.meshGizmoDrag(
                                me_gizmo_axis,
                                event.motion.xrel,
                                event.motion.yrel,
                                (gmod & c.SDL_KMOD_SHIFT) != 0,
                                (gmod & (c.SDL_KMOD_CTRL | c.SDL_KMOD_ALT)) != 0,
                                snap_vertex,
                            );
                            state_mod.markDirty();
                            continue;
                        }
                        if (me_lc_dragging) {
                            // Loop-cut handle drag: the host re-previews internally; the
                            // popup polls __mesh_lc_state to track it (no JS per move).
                            // Default SNAPS the offset to whole size-units; a held Shift
                            // frees it to continuous (req_2644 QQ).
                            const lc_snap = (c.SDL_GetModState() & c.SDL_KMOD_SHIFT) == 0;
                            _ = r3d.meshLcHandleDrag(event.motion.xrel, event.motion.yrel, lc_snap);
                            state_mod.markDirty();
                            continue;
                        }
                        if (me_selecting) {
                            if (!me_marquee and (@abs(mx - me_down_x) > 4 or @abs(my - me_down_y) > 4)) {
                                me_marquee = true; // the press became a drag → revert the press-pick, switch to marquee
                                r3d.meshEditRevert();
                            }
                            if (me_marquee) {
                                // An armed CUT sweep (ctrl+face press, req_4271) draws the
                                // rectangle but never box-selects — the cut on release is
                                // the gesture, not a selection.
                                if (!me_cut_armed) _ = r3d.meshEditBox(me_down_x, me_down_y, mx, my, me_shift);
                                r3d.meshSetMarquee(me_down_x, me_down_y, mx, my); // draw the box outline
                            }
                            state_mod.markDirty();
                            continue;
                        }
                    }
                    if (world_loader_paint_node_id != 0) {
                        // MAPPAINT req_2473: an active paint drag — stroke host-side.
                        if (findWorldLoaderNodeById(config.root, world_loader_paint_node_id) == null) {
                            world_loader.paintPointer(io, world_loader_paint_node_id, .up, mx, my);
                            world_loader_paint_node_id = 0;
                        } else if (mapPaintHitIsChrome(config.root, mx, my)) {
                            world_loader.paintPointer(io, world_loader_paint_node_id, .up, mx, my);
                            world_loader_paint_node_id = 0;
                            state_mod.markDirty();
                            continue;
                        } else {
                            world_loader.paintPointer(io, world_loader_paint_node_id, .move, mx, my);
                            state_mod.markDirty();
                            continue;
                        }
                    } else if (world_loader.anyPaintArmed()) {
                        // hover: the loader polls the mouse per frame for the brush
                        // beam — just keep frames coming while the cursor moves.
                        state_mod.markDirty();
                    }
                    if (world_loader_mouse_node_id != 0) {
                        if (findWorldLoaderNodeById(config.root, world_loader_mouse_node_id) == null) {
                            releaseWorldLoaderPointer();
                            continue;
                        }
                        world_loader.mouseLook(world_loader_mouse_node_id, event.motion.xrel, event.motion.yrel);
                    }
                    effects.pollMouse(mx, my, 0.016);
                    if (g_chrome_dragging) {
                        // Use the LIVE global mouse state, not event.motion.state.
                        // event.motion.state is captured when SDL queued the
                        // event; on 60Hz monitors a fast mouse-whip lets SDL
                        // queue motion events whose cached state briefly drops
                        // LMASK (cursor escapes the still-async-catching-up
                        // window hitbox). That false release was killing the
                        // drag mid-whip. Re-querying right now avoids the
                        // staleness while still catching real releases when
                        // the button-up event happens outside the window.
                        var gx_now: f32 = 0;
                        var gy_now: f32 = 0;
                        const buttons_now = c.SDL_GetGlobalMouseState(&gx_now, &gy_now);
                        if ((buttons_now & c.SDL_BUTTON_LMASK) != 0) {
                            updateChromeDrag();
                        } else {
                            endChromeDrag();
                        }
                        continue;
                    }
                    if (prepared_input.terminalDockResizeActive()) {
                        if ((event.motion.state & c.SDL_BUTTON_LMASK) != 0) {
                            const next_height = prepared_input.terminalDockResizeStartHeight() + (prepared_input.terminalDockResizeStartY() - my);
                            js_vm.callGlobalFloat(config.host, "__setTerminalDockHeight", @floatCast(next_height));
                        } else {
                            prepared_input.endTerminalDockResize();
                        }
                    }
                    // Render surface mouse motion forwarding
                    if (render_surfaces.handleMouseMotion(io, environ, mx, my)) continue;
                    if (scrollbar_drag_slot != 0) {
                        const pos = if (scrollbar_drag_axis == .vertical) my else mx;
                        _ = updateScrollbarDrag(config.host, config.root, pos);
                        continue;
                    }
                    // <Slider> drag (SLIDER-0611) — engine-owned thumb; zero JS
                    // in the loop beyond the throttled value stream.
                    if (slider_drag_slot != 0) {
                        updateSliderDrag(config.host, config.root, mx);
                        continue;
                    }
                    // <Slider> hover pointer-value (MEDIASLIDER-0705) — non-
                    // consuming: tracks enter/move/leave for hover-enabled
                    // sliders (tooltip latch + quantized bucket dispatch).
                    updateSliderHover(config.host, config.root, mx, my);
                    // Physics drag update
                    if (physics2d.isDragging()) {
                        physics2d.updateDrag(mx, my);
                    }
                    // Terminal mouse forwarding — if a press was forwarded
                    // (or the inner program asked for any-motion via 1003),
                    // emit SGR motion events instead of growing a selection.
                    if (HAS_TERMINAL and sessionInitialized(g_focused_session)) {
                        const mm = vterm_mod.getMouseModeByName(g_focused_session);
                        if (mm > 0) {
                            if (findTerminalNodeBySession(config.root, g_focused_session)) |tn| {
                                const r = tn.computed;
                                const inside = mx >= r.x and mx <= r.x + r.w and my >= r.y and my <= r.y + r.h;
                                // Any-motion (3) reports continuously; drag (2)
                                // / click (1) only while a button is held.
                                if (inside and (g_term_mouse_forwarding or mm >= 3)) {
                                    // SGR motion-no-button is button 35 (3+32);
                                    // motion-with-left is 32 (0+32).
                                    const btn: u32 = if (g_term_mouse_forwarding) 32 else 35;
                                    forwardTermMouse(tn, g_focused_session, mx, my, btn, 'M');
                                }
                            }
                        }
                    }
                    // Terminal drag selection
                    if (term_sel_dragging) {
                        if (findTerminalNodeBySession(config.root, g_focused_session)) |tn| {
                            const cell = termPixelToCell(tn, mx, my);
                            term_sel_end_row = cell.row;
                            term_sel_end_col = cell.col;
                            term_sel_active = (term_sel_start_row != term_sel_end_row or term_sel_start_col != term_sel_end_col);
                        }
                    }
                    // TextInput drag selection — latch latest position only.
                    // We used to call hitTestInputByte per motion event, but
                    // hitTestWrapped on a 143 KB buffer dominates the frame
                    // when SDL delivers 4000+ motion events in a burst. Coalesce
                    // into one hit-test after the event pump (see below).
                    if (input_drag_active) {
                        input_drag_pending = true;
                        input_drag_pending_x = mx;
                        input_drag_pending_y = my;
                        stampInputLatency(config.host.io, "drag");
                    }
                    updateHover(config.host, config.root, mx, my);
                    // Context menu hover tracking
                    context_menu.updateHover(mx, my);
                    // Canvas hit testing — find which Canvas.Node the mouse is over
                    {
                        const mevents = @import("events.zig");
                        if (mevents.findCanvasNode(config.root, mx, my)) |cn| {
                            const vp_cx = cn.computed.x + cn.computed.w / 2;
                            const vp_cy = cn.computed.y + cn.computed.h / 2;
                            const gpos = canvas.screenToGraph(mx, my, vp_cx, vp_cy);
                            // Check Canvas.Node children (flatten through containers)
                            var found_idx: ?u16 = null;
                            var ci: u16 = 0;
                            for (cn.children) |*child| {
                                if (child.canvas_node) {
                                    if (hoverTestCanvasNode(child, gpos)) found_idx = ci;
                                    ci += 1;
                                } else if (!child.canvas_path and !child.canvas_clamp) {
                                    for (child.children) |*gc| {
                                        if (gc.canvas_node) {
                                            if (hoverTestCanvasNode(gc, gpos)) found_idx = ci;
                                            ci += 1;
                                        } else if (gc.canvas_path) {
                                            ci += 1;
                                        }
                                    }
                                } else if (child.canvas_path) {
                                    ci += 1;
                                }
                            }
                            canvas.setHoveredNode(found_idx);
                            g_hover_changed = true;
                        } else {
                            if (canvas.getHoveredNode() != null) g_hover_changed = true;
                            canvas.setHoveredNode(null);
                        }
                    }
                    const dragging_left = (event.motion.state & c.SDL_BUTTON_LMASK) != 0;
                    if (dragging_left and canvas_move_drag_id != 0) {
                        // Canvas.Node position drag — write the new graph coords straight
                        // into the host Node pool (so next frame's materialized arena picks
                        // them up). Also fire onMove live so the cart's React state can
                        // track the position during the drag (e.g. for edges anchored to
                        // node coords). Throttled to ~60 Hz to avoid flooding the flush
                        // pipeline with multi-KB UPDATE batches.
                        if (findNodeByScrollSlot(config.root, canvas_move_drag_canvas_id)) |cn| {
                            const vp_cx = cn.computed.x + cn.computed.w / 2;
                            const vp_cy = cn.computed.y + cn.computed.h / 2;
                            const gpos = canvas.screenToGraph(mx, my, vp_cx, vp_cy);
                            canvas_move_last_gx = gpos[0] + canvas_move_drag_offset_x;
                            canvas_move_last_gy = gpos[1] + canvas_move_drag_offset_y;
                            if (config.set_canvas_node_position) |setFn| {
                                setFn(canvas_move_drag_id, canvas_move_last_gx, canvas_move_last_gy);
                            }
                            if (findNodeByScrollSlot(config.root, canvas_move_drag_id)) |node| {
                                node.canvas_gx = canvas_move_last_gx;
                                node.canvas_gy = canvas_move_last_gy;
                            }
                            const now_ms: u32 = @intCast(c.SDL_GetTicks() & 0xFFFFFFFF);
                            if (now_ms -% canvas_move_last_dispatch_ms >= 16) {
                                canvas_move_last_dispatch_ms = now_ms;
                                var mbuf: [160]u8 = undefined;
                                if (std.fmt.bufPrintZ(&mbuf, "__dispatchCanvasMove({d},{d},{d})", .{
                                    canvas_move_drag_id,
                                    canvas_move_last_gx,
                                    canvas_move_last_gy,
                                })) |sentinel| {
                                    js_vm.callGlobal(config.host, "__beginJsEvent");
                                    js_vm.evalExpr(config.host, sentinel);
                                    js_vm.callGlobal(config.host, "__endJsEvent");
                                } else |_| {}
                            }
                            state_mod.markDirty();
                        }
                    } else if (dragging_left and pointer_capture_slot != 0) {
                        if (findNodeByScrollSlot(config.root, pointer_capture_slot)) |node| {
                            dispatchPointerHandler(config.host, node, .move);
                        }
                    } else if (dragging_left and canvas_drag_node != null) {
                        // Canvas pan — built-in
                        const dx = mx - canvas_drag_last_x;
                        const dy = my - canvas_drag_last_y;
                        canvas.handleDrag(dx, dy);
                        canvas_drag_last_x = mx;
                        canvas_drag_last_y = my;
                    } else if (dragging_left) {
                        selection.onMouseDrag(config.root, mx, my);
                    }
                },
                c.SDL_EVENT_MOUSE_BUTTON_UP => {
                    notePointerDevice(config.host, event.button.which);
                    mouse_state.updateMouse(event.button.x, event.button.y);
                    mouse_state.updateMouseButton(false, event.button.button == c.SDL_BUTTON_RIGHT);
                    // Native mesh-editor release: end the orbit/pan, or commit the selection
                    // (one JS callback to refresh the count HUD — not in the move loop).
                    if (r3d.meshEditCapturing()) {
                        if (event.button.button == c.SDL_BUTTON_MIDDLE and me_orbiting) {
                            me_orbiting = false;
                            continue;
                        }
                        if (event.button.button == c.SDL_BUTTON_LEFT) {
                            if (me_character_rig_gizmo_dragging) {
                                me_character_rig_gizmo_dragging = false;
                                if (r3d.characterRigGizmoEnd()) |result| {
                                    var commit_buf: [512]u8 = undefined;
                                    if (std.fmt.bufPrintZ(
                                        &commit_buf,
                                        "__characterRigGizmoCommit({d},{d},{d},{d},{d},{d},{d},{d},{d},{d},{d})",
                                        .{
                                            result.bone_index,
                                            result.pos[0],
                                            result.pos[1],
                                            result.pos[2],
                                            result.rot[0],
                                            result.rot[1],
                                            result.rot[2],
                                            result.rot[3],
                                            result.scale[0],
                                            result.scale[1],
                                            result.scale[2],
                                        },
                                    )) |expr| {
                                        js_vm.callGlobal(config.host, "__beginJsEvent");
                                        js_vm.evalExpr(config.host, expr);
                                        js_vm.callGlobal(config.host, "__endJsEvent");
                                    } else |_| {}
                                }
                                state_mod.markDirty();
                                continue;
                            }
                            if (me_panning) {
                                me_panning = false;
                                continue;
                            }
                            if (me_lc_dragging) {
                                // Release just ends the grab — the previewed cut stays
                                // live in the session (commit/cancel remain the popup's).
                                me_lc_dragging = false;
                                state_mod.markDirty();
                                continue;
                            }
                            if (me_bd_dragging) {
                                // Release ends the grab; the pose stays in the session
                                // for the cart's poll to persist (no journal — a
                                // backdrop is a tracing aid, never model data).
                                me_bd_dragging = false;
                                r3d.bdGizmoFinish();
                                state_mod.markDirty();
                                continue;
                            }
                            if (me_gizmo_dragging) {
                                me_gizmo_dragging = false;
                                me_gizmo_axis = -1;
                                const guarded = r3d.meshGizmoFinish();
                                js_vm.callGlobal(config.host, "__beginJsEvent");
                                if (guarded) {
                                    js_vm.callGlobal(config.host, "__meshEditGuardChanged");
                                } else {
                                    js_vm.callGlobal(config.host, "__meshEditSelChanged");
                                }
                                js_vm.callGlobal(config.host, "__endJsEvent");
                                state_mod.markDirty();
                                continue;
                            }
                            if (me_selecting) {
                                me_selecting = false;
                                const was_marquee = me_marquee;
                                const was_cut = me_cut_armed;
                                me_marquee = false;
                                me_cut_armed = false;
                                r3d.meshClearMarquee(); // drop the box outline on release
                                js_vm.callGlobal(config.host, "__beginJsEvent");
                                if (was_cut and was_marquee) {
                                    // The armed sweep IS the cut (req_4271): hand the rect to
                                    // the cart so the topo op's new mesh key gets adopted.
                                    var cut_buf: [128]u8 = undefined;
                                    if (std.fmt.bufPrintZ(&cut_buf, "__meshEditMarqueeCut({d},{d},{d},{d})", .{ me_down_x, me_down_y, event.button.x, event.button.y })) |expr| {
                                        js_vm.evalExpr(config.host, expr);
                                    } else |_| {}
                                } else if (was_cut) {
                                    // Armed but never dragged: a plain ctrl+click on a face
                                    // is still a click — run the pick it deferred.
                                    _ = r3d.meshEditPick(event.button.x, event.button.y, me_shift);
                                }
                                js_vm.callGlobal(config.host, "__meshEditSelChanged");
                                js_vm.callGlobal(config.host, "__endJsEvent");
                                state_mod.markDirty();
                                continue;
                            }
                        }
                    }
                    if (event.button.button == c.SDL_BUTTON_LEFT and world_loader_paint_node_id != 0) {
                        // MAPPAINT req_2473: release ends the stroke (ramp/slope stamp here).
                        world_loader.paintPointer(io, world_loader_paint_node_id, .up, event.button.x, event.button.y);
                        world_loader_paint_node_id = 0;
                        state_mod.markDirty();
                        continue;
                    }
                    if (event.button.button == c.SDL_BUTTON_RIGHT and world_loader_mouse_node_id != 0 and world_loader_mouse_aiming) {
                        world_loader.setAiming(world_loader_mouse_node_id, false);
                        world_loader_mouse_aiming = false;
                        continue;
                    }
                    if (event.button.button == c.SDL_BUTTON_LEFT) {
                        prepared_input.endTerminalDockResize();
                        if (g_chrome_dragging) {
                            endChromeDrag();
                            continue;
                        }
                    }
                    // Render surface mouse up forwarding
                    {
                        const rmx: f32 = event.button.x;
                        const rmy: f32 = event.button.y;
                        if (render_surfaces.handleMouseUp(io, environ, rmx, rmy, event.button.button)) continue;
                    }
                    if (event.button.button == c.SDL_BUTTON_LEFT) {
                        if (pointer_capture_slot != 0 and pointer_capture_button == event.button.button) {
                            if (findNodeByScrollSlot(config.root, pointer_capture_slot)) |node| {
                                dispatchPointerHandler(config.host, node, .up);
                            }
                            pointer_capture_slot = 0;
                            pointer_capture_button = 0;
                        }
                        // Commit Canvas.Node move-drag — fire onMove once with the final
                        // pool-resident position so the cart's React state catches up.
                        if (canvas_move_drag_id != 0) {
                            var buf: [160]u8 = undefined;
                            if (std.fmt.bufPrintZ(&buf, "__dispatchCanvasMove({d},{d},{d})", .{
                                canvas_move_drag_id,
                                canvas_move_last_gx,
                                canvas_move_last_gy,
                            })) |sentinel| {
                                js_vm.callGlobal(config.host, "__beginJsEvent");
                                js_vm.evalExpr(config.host, sentinel);
                                js_vm.callGlobal(config.host, "__endJsEvent");
                                state_mod.markDirty();
                            } else |_| {}
                            canvas_move_drag_id = 0;
                            canvas_move_drag_canvas_id = 0;
                        }
                        scrollbar_drag_slot = 0;
                        // <Slider> settle (SLIDER-0611) — ONE commit dispatch with
                        // the final value; the cart's React state catches up here.
                        endSliderDrag(config.host, config.root);
                        physics2d.endDrag();
                        canvas_drag_node = null;
                        input_drag_active = false;
                        input_drag_pending = false;
                        term_sel_dragging = false;
                        // Terminal mouse-up forwarding — emit SGR release if
                        // we forwarded the press. Button 0 + 'm' is "left up".
                        if (HAS_TERMINAL and g_term_mouse_forwarding) {
                            if (findTerminalNodeBySession(config.root, g_focused_session)) |tn| {
                                forwardTermMouse(tn, g_focused_session, event.button.x, event.button.y, 0, 'm');
                            }
                            g_term_mouse_forwarding = false;
                        }
                        selection.onMouseUp();
                    }
                },
                c.SDL_EVENT_TEXT_INPUT => {
                    // SDL3: event.text.text is a const char* pointer
                    const text_ptr: [*:0]const u8 = @ptrCast(event.text.text orelse continue);
                    // Native terminal gets text first
                    if (HAS_TERMINAL and sessionInitialized(g_focused_session)) {
                        terminalHandleTextInput(text_ptr);
                        continue;
                    }
                    // (PTY text-input fast-path was QJS-routed; archived
                    // with qjs_runtime. PTY input now flows through the V8
                    // bindings — see framework/v8_bindings_vterm.zig.)
                    // Render surface text input forwarding
                    if (render_surfaces.handleTextInput(text_ptr)) continue;
                    if (input.getFocusedId() != null) stampInputLatency(config.host.io, "type");
                    input.handleTextInput(text_ptr);
                },
                c.SDL_EVENT_KEY_DOWN => {
                    const sym: c_int = @intCast(event.key.key);
                    const mod = event.key.mod;
                    if (sym == c.SDLK_ESCAPE and world_loader_mouse_node_id != 0) {
                        releaseWorldLoaderPointer();
                        continue;
                    }
                    // Full-width sym packing — extended keys (0x4000xxxx)
                    // must survive the wire; see framework/key_pack.zig.
                    const packed_key: i64 = key_pack.pack(@intCast(event.key.key), @intCast(mod));
                    // Capture key (F9 recording toggle)
                    if (capture.handleKey(io, environ, sym)) continue;
                    // Terminal copy/paste: Ctrl+Shift+C/V (not Ctrl+C which is SIGINT)
                    if (sessionInitialized(g_focused_session)) {
                        const t_ctrl = (mod & c.SDL_KMOD_CTRL) != 0;
                        const t_shift = (mod & c.SDL_KMOD_SHIFT) != 0;
                        if (t_ctrl and t_shift and sym == c.SDLK_C) {
                            if (term_sel_active) {
                                var copy_buf: [8192]u8 = undefined;
                                const len = vterm_mod.copySelectedTextByName(
                                    g_focused_session,
                                    term_sel_start_row,
                                    term_sel_start_col,
                                    term_sel_end_row,
                                    term_sel_end_col,
                                    &copy_buf,
                                );
                                if (len > 0 and len < copy_buf.len) {
                                    copy_buf[len] = 0;
                                    _ = c.SDL_SetClipboardText(@ptrCast(&copy_buf));
                                }
                            }
                            continue;
                        }
                        // Ctrl+Shift+D — toggle semantic overlay
                        if (t_ctrl and t_shift and sym == c.SDLK_D) {
                            g_semantic_overlay = !g_semantic_overlay;
                            // When overlay turns on, activate basic classifier if none set
                            if (g_semantic_overlay and classifier.getModeByName(g_focused_session) == .none) {
                                classifier.setModeByName(g_focused_session, .basic);
                                classifier.markDirtyByName(g_focused_session);
                            }
                            log.print("[semantic] overlay {s}\n", .{if (g_semantic_overlay) "ON" else "OFF"});
                            continue;
                        }
                        if (t_ctrl and t_shift and sym == c.SDLK_V) {
                            const clip = c.SDL_GetClipboardText();
                            if (clip != null) {
                                vterm_mod.scrollToBottomByName(g_focused_session);
                                vterm_mod.writePtyByName(g_focused_session, std.mem.span(clip));
                                c.SDL_free(@ptrCast(clip));
                            }
                            continue;
                        }
                    }
                    // Native terminal special key routing
                    if (sessionInitialized(g_focused_session)) {
                        terminalHandleKey(sym, mod);
                        continue;
                    }
                    // (PTY key-down fast-path was QJS-routed; archived
                    // with qjs_runtime. PTY input now flows through the V8
                    // bindings — see framework/v8_bindings_vterm.zig.)
                    // Render surface key forwarding
                    if (render_surfaces.handleKeyDown(io, environ, sym)) continue;
                    {
                        const ctrl = (mod & c.SDL_KMOD_CTRL) != 0;
                        // Mesh editor Ctrl+A → select all elements (scoped to the focused
                        // part), NOT the app-wide text select-all. Only when no text field is
                        // focused and the model editor is capturing in a select mode. Clearing
                        // the tree selection here (same dispatch) stops the app-wide highlight
                        // from ever rendering. (USER req_2421)
                        if (ctrl and sym == 'a' and input.getFocusedId() == null and r3d.meshEditCapturing()) {
                            // In a select mode this selects every scoped element; in view mode
                            // it's a no-op — but either way we swallow Ctrl+A so it never
                            // lights up the whole app's text.
                            _ = r3d.meshEditSelectAll();
                            selection.clear();
                            js_vm.callGlobal(config.host, "__meshEditSelChanged");
                            state_mod.markDirty();
                            continue;
                        }
                        // A bare PRINTABLE keydown while a text field is focused belongs to
                        // that field — the character arrives via SDL_EVENT_TEXT_INPUT, so
                        // handleKey correctly returns false here, but the keydown must still
                        // count as consumed or it leaks to the JS key bus and fires app
                        // hotkeys mid-typing (searching "wasd" panned the world map,
                        // req_2745). Chords (ctrl) keep their existing routing.
                        const printable = sym >= 32 and sym != 127 and sym < 0x40000000;
                        const input_consumed = if (input.getFocusedId() != null)
                            (handleInputVerticalKey(config.root, sym, mod) or
                                (if (ctrl) input.handleCtrlKey(sym, mod) else input.handleKey(sym, mod)) or
                                (!ctrl and printable))
                        else
                            false;
                        if (input_consumed) stampInputLatency(config.host.io, "key");
                        // Studio navigation is a native capture mode: once Tab enables it,
                        // WASD updates host-held axes and never reaches the model command
                        // keymap (W wireframe, A align, S scale, D detach). Text inputs still
                        // win above, and the shell owns Tab so modal discipline stays intact.
                        // The physical modifier edge wins over SDL's aggregate mask:
                        // on some backends a Shift/Ctrl key-up still reports that bit,
                        // which otherwise leaves navigation latched at its old speed.
                        const nav_shift = (mod & c.SDL_KMOD_SHIFT) != 0 or sym == c.SDLK_LSHIFT or sym == c.SDLK_RSHIFT;
                        const nav_ctrl = (mod & c.SDL_KMOD_CTRL) != 0 or sym == c.SDLK_LCTRL or sym == c.SDLK_RCTRL;
                        const studio_navigation_consumed = !input_consumed and r3d.meshEditCapturing() and
                            r3d.orbitNavigationKey(
                                sym,
                                true,
                                nav_shift,
                                nav_ctrl,
                            );
                        if (studio_navigation_consumed) {
                            state_mod.markDirty();
                            continue;
                        }
                        if (!input_consumed and !videos.handleKey(sym)) {
                            selection.onKeyDown(config.root, sym, mod);
                            ifttt_zig.dispatchKeyDown(config.host, packed_key);
                            js_vm.callGlobalInt(config.host, "__ifttt_onKeyDown", packed_key);
                            // Forward key events to QuickJS script layer
                            js_vm.callGlobalInt(config.host, "__onKeyDown", @intCast(sym));
                        }
                    }
                },
                c.SDL_EVENT_KEY_UP => {
                    // Same full-width packing as KEY_DOWN (key_pack.zig).
                    const sym: i32 = @intCast(event.key.key);
                    const packed_key: i64 = key_pack.pack(@intCast(event.key.key), @intCast(event.key.mod));
                    const nav_shift = (event.key.mod & c.SDL_KMOD_SHIFT) != 0 and sym != c.SDLK_LSHIFT and sym != c.SDLK_RSHIFT;
                    const nav_ctrl = (event.key.mod & c.SDL_KMOD_CTRL) != 0 and sym != c.SDLK_LCTRL and sym != c.SDLK_RCTRL;
                    if (r3d.orbitNavigationKey(
                        sym,
                        false,
                        nav_shift,
                        nav_ctrl,
                    )) {
                        state_mod.markDirty();
                        continue;
                    }
                    _ = render_surfaces.handleKeyUp(io, environ, @intCast(event.key.key));
                    ifttt_zig.dispatchKeyUp(config.host, packed_key);
                    js_vm.callGlobalInt(config.host, "__ifttt_onKeyUp", packed_key);
                },
                c.SDL_EVENT_MOUSE_WHEEL => {
                    // SDL3: mouse_x/mouse_y are in the wheel event itself
                    const mx: f32 = event.wheel.mouse_x;
                    const my: f32 = event.wheel.mouse_y;
                    const events = @import("events.zig");
                    // Wheel ownership is stricter than click ownership. A ScrollView's blank
                    // body has no click handler, but it is still the scroll surface under the
                    // pointer and must win before the native model camera. Interactive children
                    // are irrelevant to this decision (req_4244).
                    const scroll_container_owns_wheel = events.scrollContainerOwnsWheel(config.root, mx, my);
                    // Native mesh-editor zoom (modelview): wheel over the viewport dollies the
                    // orbit camera. Over chrome or any scroll surface it falls through.
                    if (r3d.meshEditCapturing() and !scroll_container_owns_wheel and !meHitIsChrome(layout.hitTest(config.root, mx, my))) {
                        r3d.orbitZoom(event.wheel.y);
                        state_mod.markDirty();
                        continue;
                    }
                    witness.recordScroll(mx, my, event.wheel.x, event.wheel.y);
                    // Terminal scrollback — mouse wheel scrolls history (check all terminals).
                    // When a terminal is nested inside a Canvas.Node its computed rect is in
                    // graph space; transform the cursor into graph space before hit-testing.
                    {
                        const canvas_hit = events.findCanvasNode(config.root, mx, my);
                        var gx: f32 = mx;
                        var gy: f32 = my;
                        if (canvas_hit) |cn| {
                            const vp_cx = cn.computed.x + cn.computed.w / 2;
                            const vp_cy = cn.computed.y + cn.computed.h / 2;
                            const gpos = canvas.screenToGraph(mx, my, vp_cx, vp_cy);
                            gx = gpos[0];
                            gy = gpos[1];
                        }
                        const ScrollCtx = struct {
                            mx: f32,
                            my: f32,
                            gx: f32,
                            gy: f32,
                            canvas_hit: bool,
                            wheel_y: i32,
                            handled: bool = false,
                        };
                        var sctx = ScrollCtx{
                            .mx = mx,
                            .my = my,
                            .gx = gx,
                            .gy = gy,
                            .canvas_hit = canvas_hit != null,
                            .wheel_y = @trunc(event.wheel.y),
                        };
                        forEachTerminalNode(config.root, &sctx, struct {
                            fn visit(s: *ScrollCtx, tn: *Node, sess: []const u8) void {
                                if (s.handled) return;
                                if (!sessionInitialized(sess)) return;
                                const tr = tn.computed;
                                const screen_hit = s.mx >= tr.x and s.mx <= tr.x + tr.w and s.my >= tr.y and s.my <= tr.y + tr.h;
                                const graph_hit = s.canvas_hit and s.gx >= tr.x and s.gx <= tr.x + tr.w and s.gy >= tr.y and s.gy <= tr.y + tr.h;
                                if (screen_hit or graph_hit) {
                                    if (s.wheel_y > 0) {
                                        vterm_mod.scrollUpByName(sess, @intCast(s.wheel_y * 3));
                                    } else if (s.wheel_y < 0) {
                                        vterm_mod.scrollDownByName(sess, @intCast(-s.wheel_y * 3));
                                    }
                                    s.handled = true;
                                }
                            }
                        }.visit);
                        if (sctx.handled) continue;
                    }
                    // Canvas: check for scroll containers inside tiles before zooming
                    if (events.findCanvasNode(config.root, mx, my)) |cn| {
                        // Canvas.Clamp panels (HUD / viewport overlays) live in
                        // screen space, not graph space — search them first with
                        // raw mouse coords so a ScrollView inside a clamp captures
                        // the wheel instead of falling through to canvas zoom.
                        var scroll_hit: ?*Node = null;
                        for (cn.children) |*clamp| {
                            if (!clamp.canvas_clamp) continue;
                            if (events.findScrollContainer(clamp, mx, my)) |s| {
                                scroll_hit = s;
                                break;
                            }
                        }
                        // Transform mouse to graph space, then search each canvas tile for ScrollViews
                        const vp_cx = cn.computed.x + cn.computed.w / 2;
                        const vp_cy = cn.computed.y + cn.computed.h / 2;
                        const gpos = canvas.screenToGraph(mx, my, vp_cx, vp_cy);
                        if (scroll_hit == null) {
                            for (cn.children) |*tile| {
                                if (!tile.canvas_node) continue;
                                // Each canvas tile's children have graph-space computed rects
                                for (tile.children) |*tile_child| {
                                    if (events.findScrollContainer(tile_child, gpos[0], gpos[1])) |s| {
                                        scroll_hit = s;
                                        break;
                                    }
                                }
                                if (scroll_hit != null) break;
                            }
                        }
                        if (scroll_hit) |scroll_node| {
                            const sc: f32 = if (comptime @import("builtin").os.tag == .macos) 10.0 else 30.0;
                            if (event.wheel.y != 0) scroll_node.scroll_y -= event.wheel.y * sc;
                            if (event.wheel.x != 0) scroll_node.scroll_x -= event.wheel.x * sc;
                            const max_sx = @max(0.0, scroll_node.content_width - scroll_node.computed.w);
                            const max_sy = @max(0.0, scroll_node.content_height - scroll_node.computed.h);
                            scroll_node.scroll_x = @max(0.0, @min(scroll_node.scroll_x, max_sx));
                            scroll_node.scroll_y = @max(0.0, @min(scroll_node.scroll_y, max_sy));
                            markScrollActivity(scroll_node);
                            luajit_runtime.persistScrollSlot(scroll_node.scroll_persist_slot, scroll_node.scroll_y);
                            fireScrollHandlers(config.host, scroll_node, event.wheel.x, event.wheel.y);
                        } else {
                            const delta: f32 = event.wheel.y;
                            canvas.handleScroll(mx - cn.computed.x, my - cn.computed.y, delta, cn.computed.w, cn.computed.h);
                        }
                    } else if (events.findScrollContainer(config.root, mx, my)) |scroll_node| {
                        if (event.wheel.y != 0) {
                            // macOS trackpad: SDL3 gives pixel-precise fractional deltas
                            // Mouse wheel: SDL3 gives ±1.0 per notch
                            const scale: f32 = if (comptime @import("builtin").os.tag == .macos) 10.0 else 30.0;
                            scroll_node.scroll_y -= event.wheel.y * scale;
                        }
                        if (event.wheel.x != 0) {
                            const scale_x: f32 = if (comptime @import("builtin").os.tag == .macos) 10.0 else @max(scroll_node.computed.h * 0.8, 60.0);
                            scroll_node.scroll_x -= event.wheel.x * scale_x;
                        }
                        const max_scroll_x = @max(0.0, scroll_node.content_width - scroll_node.computed.w);
                        const max_scroll_y = @max(0.0, scroll_node.content_height - scroll_node.computed.h);
                        scroll_node.scroll_x = @max(0.0, @min(scroll_node.scroll_x, max_scroll_x));
                        scroll_node.scroll_y = @max(0.0, @min(scroll_node.scroll_y, max_scroll_y));
                        markScrollActivity(scroll_node);
                        luajit_runtime.persistScrollSlot(scroll_node.scroll_persist_slot, scroll_node.scroll_y);
                        fireScrollHandlers(config.host, scroll_node, event.wheel.x, event.wheel.y);
                    } else if (events.hitTestScroll(config.root, mx, my)) |scroll_node| {
                        // No scroll container under the cursor, but a node opted
                        // into the raw wheel via onScroll (e.g. a transparent
                        // overlay driving a 3D camera dolly). Deliver the delta
                        // straight to its handler — nothing scrolls in the layout.
                        fireScrollHandlers(config.host, scroll_node, event.wheel.x, event.wheel.y);
                    }
                },
                c.SDL_EVENT_DROP_FILE => {
                    if (event.drop.data) |data_ptr| {
                        const path = std.mem.span(data_ptr);
                        filedrop.dispatch(path, config.root);
                        system_signals.notifyDrop(config.host, path);
                        // SDL3: drop data is managed by SDL, no SDL_free needed
                    }
                },
                c.SDL_EVENT_WINDOW_FOCUS_GAINED => {
                    system_signals.notifyFocus(config.host, true);
                },
                c.SDL_EVENT_WINDOW_FOCUS_LOST => {
                    releaseWorldLoaderPointer();
                    // SDL may not deliver key-up after focus leaves the window.
                    // Clear every Studio navigation axis without changing the Tab
                    // toggle, so returning to the editor cannot inherit a stuck walk.
                    _ = r3d.orbitNavigationKey('w', false, false, false);
                    _ = r3d.orbitNavigationKey('a', false, false, false);
                    _ = r3d.orbitNavigationKey('s', false, false, false);
                    _ = r3d.orbitNavigationKey('d', false, false, false);
                    if (world_loader_paint_node_id != 0) {
                        world_loader.paintPointer(io, world_loader_paint_node_id, .up, 0, 0);
                        world_loader_paint_node_id = 0;
                    }
                    system_signals.notifyFocus(config.host, false);
                },
                else => {},
            }
        }

        const dt_evt_end = std.Io.Clock.now(.awake, io).toMicroseconds();

        // The `app` phase begins exactly where event processing ended — phases
        // are a contiguous partition of the frame, so the next boundary is the
        // previous one. No gap, no "other".
        const phase_t0 = dt_evt_end;

        // NOTE: the per-frame `js_vm.tick()` QuickJS frame-pump was removed
        // 2026-06-25. Under V8 it was `pub fn tick() void {}` — a no-op — because
        // V8 runs its work synchronously inside event callbacks (the React
        // reconcile on a click happens during event dispatch, timed via the
        // bridge accumulator), not on a per-frame VM pump like QuickJS needed.
        // Its `tick_us` telemetry therefore measured an empty function and read
        // 0.0 forever, poisoning every diagnostic that trusted it. Gone now.

        // LuaJIT tick (legacy; ~0 under V8). Folded into the `app` phase below.
        luajit_runtime.tick();

        // App tick (FFI polling, state updates, dynamic texts)
        if (config.tick) |tickFn| {
            // tick may rebuild the arena that hovered_node points into, so the
            // pre-tick pointer becomes stale. The old recovery path used
            // scroll_persist_slot, but the V8 path never sets that field on
            // Pressables — so hovered_node always got nulled, and the next
            // updateHover call short-circuited (`hit == hovered_node` when both
            // were null) without firing on_hover_exit. React state stayed stuck
            // and chart highlights never released. Instead, defer until after
            // the layout pass and re-hit-test at the current cursor position
            // (post-tick / pre-layout the computed rects are stale).
            hover_needs_resolve = hovered_node != null;
            hovered_node = null;
            tickFn(config.host, @truncate(c.SDL_GetTicks()));
        }
        const phase_t1 = std.Io.Clock.now(.awake, io).toMicroseconds();

        // Transition tick — interpolate active transitions AFTER style updates, BEFORE layout
        {
            const now_t: u32 = @truncate(c.SDL_GetTicks());
            const dt_t = now_t -% g_prev_tick;
            const dt_t_sec = @as(f32, @floatFromInt(dt_t)) / 1000.0;
            _ = transition.tick(dt_t_sec);
            if (transition.needsRelayout()) layout.markLayoutDirty();
        }

        // Physics 2D init — create world and bodies on first frame (before layout)
        if (!physics_initialized) {
            initPhysicsFromTree(config.root);
            physics_initialized = true;
        }

        // PTY remote control — accept connections, process commands
        pty_remote_server.poll(io);

        // Terminal tick — walk every Terminal node in the tree, ensure its
        // pipe exists, poll for output, run classifier + semantic per session.
        {
            crashlog.log("tick:term-start");
            const TickCtx = struct { io: std.Io };
            var tick_ctx = TickCtx{ .io = io };
            forEachTerminalNode(config.root, &tick_ctx, struct {
                fn visit(ctx: *TickCtx, tn: *Node, sess: []const u8) void {
                    // <Terminal dumb /> — no PTY. Ensure the cell-grid pipe
                    // exists (so paint has rows) but never spawn a shell or
                    // poll. The cart feeds bytes via __vterm_feed; repaint is
                    // driven off the vterm damage flag the feed sets.
                    if (tn.terminal_dumb) {
                        if (vterm_mod.getPipe(sess) == null) {
                            _ = vterm_mod.ensurePipe(sess, 24, 80);
                        }
                        if (vterm_mod.hasDamageByName(sess)) {
                            vterm_mod.clearDamageByName(sess);
                            classifier.markDirtyByName(sess);
                            layout.markLayoutDirty();
                        }
                        return;
                    }
                    // First sight of this session → spawn its shell. The
                    // pipe is auto-created at the default 24×80; paintTerminal
                    // resizes on first paint once the layout is known.
                    if (vterm_mod.getPipe(sess) == null) {
                        const shell_path: [*:0]const u8 =
                            if (tn.terminal_shell) |s| s else "bash";
                        vterm_mod.spawnShellByName(ctx.io, sess, shell_path, 24, 80);
                    }
                    crashlog.log("tick:poll");
                    if (vterm_mod.pollPtyByName(ctx.io, sess)) {
                        classifier.markDirtyByName(sess);
                        layout.markLayoutDirty();
                    }
                    // Auto-detect CLI from banner text (first 6 rows). Once the
                    // classifier mode is non-`.none`, we treat detection as
                    // settled (no separate boolean flag needed).
                    if (classifier.getModeByName(sess) == .none) {
                        const detect_rows = @min(vterm_mod.getRowsByName(sess), 6);
                        var dr: u16 = 0;
                        while (dr < detect_rows) : (dr += 1) {
                            const dt = vterm_mod.getRowTextByName(sess, dr);
                            if (dt.len > 0 and std.mem.indexOf(u8, dt, "Claude Code") != null) {
                                classifier.setModeByName(sess, .claude_code);
                                classifier.markDirtyByName(sess);
                                break;
                            }
                        }
                    }
                    // Re-classify when damage occurred. Semantic graph builds
                    // per-session (no more "only terminal 0" restriction).
                    if (classifier.isDirtyByName(sess) and classifier.getModeByName(sess) != .none and classifier.getModeByName(sess) != .json) {
                        const cls_rows = vterm_mod.getRowsByName(sess);
                        var cls_r: u16 = 0;
                        while (cls_r < cls_rows) : (cls_r += 1) {
                            const cls_text = vterm_mod.getRowTextByName(sess, cls_r);
                            classifier.classifyAndCacheByName(sess, cls_r, cls_text, cls_rows);
                        }
                        classifier.clearDirtyByName(sess);
                        semantic.tickByName(sess, cls_rows);
                    }
                }
            }.visit);
        }

        // Coalesced TextInput drag hit-test — runs once per frame regardless
        // of how many SDL_EVENT_MOUSE_MOTION events were pumped. hitTestWrapped
        // on a large buffer is O(n) shape+wrap; without coalescing a fast drag
        // over a 143 KB file saturates the frame with redundant hit-tests.
        if (input_drag_pending) {
            input_drag_pending = false;
            const local_x = input_drag_pending_x - input_drag_node_x - input_drag_node_pl + input.getScrollX(input_drag_id);
            const local_y = input_drag_pending_y - input_drag_node_y - input_drag_node_pt;
            if (findInputNode(config.root, input_drag_id)) |drag_node| {
                const cursor_pos = hitTestInputByte(drag_node, input_drag_id, local_x, local_y);
                input.updateDragToPos(input_drag_id, cursor_pos);
            }
        }

        // Layout (main window) — skip full flex pass when nothing invalidated geometry
        const t2 = std.Io.Clock.now(.awake, io).toMicroseconds();
        const app_h = win_h;
        layout.layout(config.root, 0, 0, win_w, app_h);
        const t3 = std.Io.Clock.now(.awake, io).toMicroseconds();
        frame_telemetry.telemetry_layout_us = @intCast(@max(0, t3 - t2));

        // Re-resolve hovered_node after layout (computed rects are now valid).
        // Pre-tick we nulled the stale pointer; this restores it so the next
        // mouse-motion can dispatch on_hover_exit when the cursor leaves.
        if (hover_needs_resolve) {
            hover_needs_resolve = false;
            var hx: f32 = 0;
            var hy: f32 = 0;
            _ = c.SDL_GetMouseState(&hx, &hy);
            const events_mod = @import("events.zig");
            hovered_node = events_mod.hitTestHoverable(config.root, hx, hy);
        }

        // One-shot visible-node coord dump at tick 60 (REACTJIT_NODEDUMP gate).
        nodedumpMaybeEmit(config.host.environ, config.root, win_w, app_h);

        // Physics 2D tick — step world, sync body positions to nodes AFTER layout
        // (physics overwrites computed.x/y — must happen after layout sets them)
        if (physics2d.isInitialized()) {
            const now_p: u32 = @truncate(c.SDL_GetTicks());
            const dt_p = now_p -% g_prev_tick;
            const dt_p_sec = @as(f32, @floatFromInt(dt_p)) / 1000.0;
            physics2d.tick(@min(dt_p_sec, 0.05)); // cap at 50ms to prevent explosion
        }

        // Layout + paint secondary windows (in-process, notifications)
        windows.layoutAll();
        windows.paintAndPresent(io);

        // Resolve deferred selection (safe — layout is done, FT mutations won't corrupt measurements)
        selection.resolvePending();

        // Video update — poll mpv for new frames before paint
        videos.update();

        // Media-bound sliders follow mpv time-pos (MEDIASLIDER-0705).
        // Gated on a video existing so media-free carts skip the walk.
        if (videos.videoCount() > 0) tickMediaSliders(config.root);

        // Render surfaces update — poll XShm/FFmpeg/VNC for new frames
        render_surfaces.update(io, environ);

        // Cursor blink — update before paint so cursor state is fresh
        const now_tick: u32 = @truncate(c.SDL_GetTicks());
        const dt_ms = now_tick -% g_prev_tick;
        g_prev_tick = now_tick;
        const dt_sec = @as(f32, @floatFromInt(dt_ms)) / 1000.0;
        g_cursor_visible = input.tickBlink(dt_sec);

        // Effects update — animate and render all effect instances
        effects.update(dt_sec);
        // Drain any brush ops that JS pushed onto paintable mask textures
        // since the last frame. Runs BEFORE the paint walk so consumers
        // (Effects that sample a paintable via `textures`) see the latest
        // texture state.
        paintable.drainAll();
        r3d.update(dt_sec);
        fswatch.tick(dt_ms);
        clipboard_watch.tick(config.host, dt_ms);
        selection_watch.tick(config.host, dt_ms);
        voice.tick(config.host, dt_ms);
        audio_input.tick(config.host, dt_ms);
        whisper.tick(config.host, dt_ms);
        system_signals.tick(config.host, dt_ms);
        ifttt_zig.tick(config.host, dt_ms);
        sim.tick(dt_ms);

        // Paint (main window — wgpu)
        g_dt_sec = dt_sec;
        selection.resetWalkState();
        g_paint_count = 0;
        g_budget_exceeded = false;
        g_hidden_count = 0;
        const t4 = std.Io.Clock.now(.awake, io).toMicroseconds();
        paintNode(io, environ, config.root);
        system_signals.tickPostPaint(config.host, dt_sec);

        // (devtools paint removed — inspector lives in tsz-tools)

        // Tooltip overlay (always on top of main tree)
        tooltip.paintOverlay(measureCallback, win_w, win_h);

        // Context menu overlay (on top of everything except debug pairing)
        context_menu.paintOverlay(measureCallback, win_w, win_h);

        // Resize HUD — shows "W × H" centered for ~500ms after a resize event
        if (g_resize_hud_until_ms != 0) {
            const now_ms = c.SDL_GetTicks();
            if (now_ms >= g_resize_hud_until_ms) {
                g_resize_hud_until_ms = 0;
            } else {
                const remaining: f32 = @floatFromInt(g_resize_hud_until_ms - now_ms);
                const alpha: f32 = if (remaining < 200) remaining / 200.0 else 1.0;
                var buf: [48]u8 = undefined;
                const label = std.fmt.bufPrint(&buf, "{d} × {d}", .{ g_resize_hud_w, g_resize_hud_h }) catch "";
                const size_px: u16 = 20;
                const text_w = gpu.measureTextLineWidth(label, size_px);
                const cw: f32 = @max(140, text_w + 36);
                const ch: f32 = 56;
                const cx = (win_w - cw) / 2;
                const cy = (win_h - ch) / 2;
                const tx = cx + (cw - text_w) / 2;
                const ty = cy + (ch - @as(f32, size_px)) / 2;
                gpu.drawRect(cx, cy, cw, ch, 0.10, 0.12, 0.16, 0.85 * alpha, 10, 1, 1, 1, 1, 0.30 * alpha);
                gpu.drawTextLine(label, tx, ty, size_px, 0.92, 0.94, 0.97, alpha);
            }
        }

        // Debug pairing overlay — modal with 6-digit code
        if (debug_server.getPairingCode()) |code| {
            // Semi-transparent backdrop
            gpu.drawRect(0, 0, win_w, win_h, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0);
            // Card background
            const cw: f32 = 320;
            const ch: f32 = 140;
            const cx = (win_w - cw) / 2;
            const cy = (win_h - ch) / 2;
            gpu.drawRect(cx, cy, cw, ch, 0.12, 0.14, 0.20, 0.95, 12, 0, 0, 0, 0, 0);
            // Border
            gpu.drawRect(cx, cy, cw, ch, 0, 0, 0, 0, 12, 1.5, 1.5, 1.5, 1.5, 0.38);
            // Title
            _ = gpu.drawTextWrapped("Debug Pairing", cx + 20, cy + 16, 15, cw - 40, 0.89, 0.91, 0.94, 1.0, 0);
            // Code (large)
            _ = gpu.drawTextWrapped(code, cx + 60, cy + 55, 36, cw - 120, 0.38, 0.65, 0.98, 1.0, 0);
            // Hint
            _ = gpu.drawTextWrapped("Enter this code in tsz-tools", cx + 20, cy + 108, 11, cw - 40, 0.58, 0.63, 0.73, 0.8, 0);
        }

        // KMS mode: no compositor draws a pointer, so render a software cursor
        // at the evdev position on top of everything else this frame.
        if (evdev_bridge) |*bridge| drawSoftwareCursor(bridge.mouseX(), bridge.mouseY());

        const t5 = std.Io.Clock.now(.awake, io).toMicroseconds();
        frame_telemetry.telemetry_paint_us = @intCast(@max(0, t5 - t4));

        const phase_t_preframe = std.Io.Clock.now(.awake, io).toMicroseconds();
        gpu.frame(io, environ, 0.051, 0.067, 0.090);
        const phase_t_postframe = std.Io.Clock.now(.awake, io).toMicroseconds();
        frame_telemetry.telemetry_gpu_us = @intCast(@max(0, phase_t_postframe - phase_t_preframe));

        // WORLDWIN-0611: the compiled-world pop-out presents its own surface
        // after the main frame — fully self-contained (own RT, own encoder),
        // a no-op while the window is closed.
        world_window.frame(io, environ);
        // PANELWIN-0628: the editor-panel pop-out renders its 2D subtree into a
        // gpu RT and blits to its own swapchain — also after the main frame, also
        // a no-op while closed.
        renderPanelWindow(config.host);
        if (g_input_latency_ts_us != 0) {
            const since_click = phase_t_postframe - g_input_latency_ts_us;
            if (since_click > 50000) {
                log.print("[frame-timing] since_click={d}ms  app={d}us  layout={d}us  paint={d}us  gpu.frame={d}us\n", .{
                    @divTrunc(since_click, 1000),
                    phase_t1 - phase_t0,
                    frame_telemetry.telemetry_layout_us,
                    t5 - t4,
                    phase_t_postframe - phase_t_preframe,
                });
            }
        }

        // Input-to-present latency: time from first SDL input event in this
        // frame's cycle to post-present. Prints every time so a live typing
        // or drag session produces a running latency trace in stderr.
        if (g_input_latency_ts_us != 0) {
            const latency_us = std.Io.Clock.now(.awake, io).toMicroseconds() - g_input_latency_ts_us;
            log.print("[input-latency] {s}: {d}ms (batched {d} event{s})\n", .{
                g_input_latency_kind,
                @divTrunc(latency_us, 1000),
                g_input_latency_event_count,
                if (g_input_latency_event_count == 1) "" else "s",
            });
            g_input_latency_ts_us = 0;
            g_input_latency_event_count = 0;
        }

        // Capture — screenshot/recording (fires inside gpu.frame via callback)
        if (capture.tick(config.root)) {
            std.process.exit(0); // screenshot captured — clean exit
        }

        // Test harness — run tests after layout+paint, then exit
        if (testharness.tick()) {
            const exit_code = testharness.runAll(config.root);
            std.process.exit(exit_code);
        }

        // Witness — record tree snapshots / replay actions
        if (witness.tick(io, environ, config.root)) {
            witness.flush(io);
            std.process.exit(witness.exitCode());
        }

        // Outside-render attribution — measured at real boundaries, taken once
        // per frame. GC fired wherever V8 collected (any phase); bridge is the
        // Zig→JS app-tick/event time (lives in `other`); present is the vsync
        // wait inside the gpu phase. These split the old "GC / NATIVE" guess.
        const gc_ns_frame = js_vm.gcTakeNs();
        const gc_count_frame = js_vm.gcTakeCount();
        const gc_type_frame = js_vm.gcLastType();
        const bridge_us_frame = js_vm.bridgeTakeUs();
        const present_us_frame = gpu.presentWaitUs();

        // Unified telemetry snapshot.
        //
        // CONTIGUOUS PARTITION (req_1974/1975): the eight phase buckets below are
        // defined as differences of ADJACENT frame boundaries, in execution order
        // from dt_evt_start to t6. By construction they sum to frame_total_us
        // exactly — so a consumer that adds them all and subtracts from the total
        // gets 0. There is no "other": every microsecond of the frame lands in a
        // named bucket. The boundary order is:
        //   dt_evt_start → dt_evt_end : events     (SDL pump + input dispatch)
        //   dt_evt_end   → phase_t1   : app_tick   (luajit + V8 config.tick)
        //   phase_t1     → t2         : pre_layout (transitions, pty, terminal, drag hit-test)
        //   t2           → t3         : layout
        //   t3           → t4         : pre_paint  (physics2d, windows, effects, r3d.update, the .tick pile)
        //   t4           → t5         : paint
        //   t5           → t_postframe: gpu        (gpu.frame; present_us is the vsync subset)
        //   t_postframe  → t6         : post_frame (world_window.frame, capture/test/witness)
        // bridge_us / present_us / gc_ns are CROSS-CUTTING overlays (they nest
        // inside the phases above), not partition members — kept as annotations.
        const t6 = std.Io.Clock.now(.awake, io).toMicroseconds();
        telemetry.collect(.{
            .layout_us = @intCast(@max(0, t3 - t2)),
            .paint_us = @intCast(@max(0, t5 - t4)),
            .gpu_us = @intCast(@max(0, phase_t_postframe - t5)),
            .frame_total_us = @intCast(@max(0, t6 - dt_evt_start)),
            .event_us = @intCast(@max(0, dt_evt_end - dt_evt_start)),
            .app_tick_us = @intCast(@max(0, phase_t1 - phase_t0)),
            .pre_layout_us = @intCast(@max(0, t2 - phase_t1)),
            .pre_paint_us = @intCast(@max(0, t4 - t3)),
            .post_frame_us = @intCast(@max(0, t6 - phase_t_postframe)),
            .gc_ns = gc_ns_frame,
            .gc_count = gc_count_frame,
            .gc_type = gc_type_frame,
            .present_us = present_us_frame,
            .bridge_us = bridge_us_frame,
            .fps = frame_telemetry.telemetry_fps,
            .bridge_calls_per_sec = frame_telemetry.telemetry_bridge_calls,
            .root = config.root,
            .visible_nodes = g_paint_count,
            .hidden_nodes = g_hidden_count,
            .zero_size_nodes = g_zero_count,
            .window = window,
            .hovered_node = hovered_node,
        });

        // Host-side spike trace (gv_perflog 2). Ground-truth per-frame phases to
        // cross-check the JS perfWatch report. CONTIGUOUS PARTITION (req_1974):
        // the eight phases tile the whole frame, so cpu = total − gpu exactly and
        // there is NO "other" — every phase is named. A non-zero `residual` would
        // mean the boundaries drifted (a bug to fix), not a bucket to hide work in.
        if (g_host_spike_trace) {
            const events_i: i64 = dt_evt_end - dt_evt_start;
            const app_i: i64 = phase_t1 - phase_t0;
            const prelayout_i: i64 = t2 - phase_t1;
            const layout_i: i64 = t3 - t2;
            const prepaint_i: i64 = t4 - t3;
            const paint_i: i64 = t5 - t4;
            const gpu_i: i64 = phase_t_postframe - t5;
            const post_i: i64 = t6 - phase_t_postframe;
            const cpu_i: i64 = events_i + app_i + prelayout_i + layout_i + prepaint_i + paint_i + post_i;
            if (cpu_i > HOST_SPIKE_TRACE_US) {
                const frame_total_i: i64 = t6 - dt_evt_start;
                const residual_i: i64 = frame_total_i - (cpu_i + gpu_i); // ≈0 by construction
                std.debug.print("[host-spike] frame={d} total={d}us | events={d} app={d} preLayout={d} layout={d} prePaint={d} paint={d} gpu={d} post={d} | residual={d}\n", .{
                    gpu.frameCounter(), frame_total_i, events_i, app_i, prelayout_i, layout_i, prepaint_i, paint_i, gpu_i, post_i, residual_i,
                });
                // Cross-cutting overlays (measured at real boundaries, NOT partition
                // members): GC fires frame-wide; present is the vsync subset of gpu;
                // bridge is the Zig→JS time nested inside events+app+pre_layout.
                std.debug.print("[host-spike-attrib] frame={d} gc={d}ns(x{d},type={d}) present={d}us(in-gpu) bridge={d}us(in-app/events)\n", .{
                    gpu.frameCounter(), gc_ns_frame, gc_count_frame, gc_type_frame, present_us_frame, bridge_us_frame,
                });
                const gpu_stats = gpu.telemetryStats();
                std.debug.print("[host-spike-gpu] frame={d} rects={d} glyphs={d} atlas={d} atlas_miss={d} static_caps={d} frame_hash={d} rect_hash={d} text_hash={d} drain={d}\n", .{
                    gpu.frameCounter(),
                    gpu_stats.rect_count,
                    gpu_stats.glyph_count,
                    gpu_stats.atlas_glyph_count,
                    gpu_stats.atlas_miss_count,
                    gpu_stats.static_capture_count,
                    gpu_stats.frame_hash,
                    gpu_stats.rect_hash,
                    gpu_stats.text_hash,
                    gpu_stats.frames_since_drain,
                });
                if (gpu_stats.text_trace.len > 0) {
                    std.debug.print("[host-spike-text] frame={d} {s}\n", .{ gpu.frameCounter(), gpu_stats.text_trace });
                }
                if (gpu_stats.static_capture_trace.len > 0) {
                    std.debug.print("[host-spike-capture] frame={d} {s}\n", .{ gpu.frameCounter(), gpu_stats.static_capture_trace });
                }
            }
        }

        // Debug server — poll for requests + push telemetry stream
        debug_server.poll(io);

        // Telemetry (legacy stderr + qjs_runtime vars)
        const fps_frame_us = std.Io.Clock.now(.awake, io).toMicroseconds();
        if (fps_previous_frame_us != 0 and fps_frame_us > fps_previous_frame_us) {
            fps_interval_count += 1;
            fps_interval_elapsed_us += @intCast(fps_frame_us - fps_previous_frame_us);
        }
        fps_previous_frame_us = fps_frame_us;
        const now: u64 = c.SDL_GetTicks();
        if (now -% fps_last >= 1000) {
            const sampled_fps = frame_telemetry.fpsFromIntervals(fps_interval_count, fps_interval_elapsed_us);
            frame_telemetry.telemetry_fps = sampled_fps;
            luajit_runtime.telemetry_fps = sampled_fps;
            // Use last frame's counts directly (counters reset per-frame for budget checks)
            const ppf = g_paint_count;
            const hpf = g_hidden_count;
            const zpf = g_zero_count;
            // Stderr gets throttled to once every 10s so an idle dev terminal
            // isn't flooded with 3600 lines/hour. The log-file copy below is
            // unthrottled because nobody watches it live. Set ZIGOS_TELEMETRY=1
            // to print to stderr every second for perf-hunting.
            const verbose = environ.get("ZIGOS_TELEMETRY") != null;
            if (verbose or (now -% telemetry_stderr_last) >= 10_000) {
                telemetry_stderr_last = now;
                log.print("[telemetry] FPS: {d} | layout: {d}us | paint: {d}us | gpu: {d}us | visible: {d}/{d} | gpuops: {d}/{d} | hidden: {d} | zero: {d} | bridge: {d}/s\n", .{
                    sampled_fps, frame_telemetry.telemetry_layout_us, frame_telemetry.telemetry_paint_us, frame_telemetry.telemetry_gpu_us, ppf, PAINT_BUDGET, gpu.g_gpu_ops, gpu.GPU_OPS_BUDGET, hpf, zpf, frame_telemetry.bridge_calls_this_second,
                });
            }
            log.writeLine("[telemetry] FPS: {d} | layout: {d}us | paint: {d}us | gpu: {d}us | visible: {d}/{d} | gpuops: {d}/{d} | hidden: {d} | zero: {d} | bridge: {d}/s", .{
                sampled_fps, frame_telemetry.telemetry_layout_us, frame_telemetry.telemetry_paint_us, frame_telemetry.telemetry_gpu_us, ppf, PAINT_BUDGET, gpu.g_gpu_ops, gpu.GPU_OPS_BUDGET, hpf, zpf, frame_telemetry.bridge_calls_this_second,
            });
            frame_telemetry.telemetry_bridge_calls = frame_telemetry.bridge_calls_this_second;
            frame_telemetry.bridge_calls_this_second = 0;
            if (luajit_worker.takeTelemetry()) |lua_stats| {
                log.print("[lua-worker] N={d} | processed: {d}/s | total: {d} | pending: {d} | latency: {d}us\n", .{
                    lua_stats.bridge_n,
                    lua_stats.processed_per_second,
                    lua_stats.processed_total,
                    lua_stats.pending,
                    lua_stats.latency_us,
                });
            }
            if (HAS_AUDIO) @import("audio/api.zig").logTelemetry();
            watchdog.heartbeat(io);
            g_budget_exceeded = false;
            g_hover_changed = false;
            g_hidden_count = 0;
            g_zero_count = 0;
            fps_interval_count = 0;
            fps_interval_elapsed_us = 0;
            fps_last = now;
        }

        // [drag-trace] only fires while chrome is being dragged. One line per
        // iteration: where did the time go in this frame? Lets us pinpoint
        // which phase causes the chrome-drag freeze. Goes to log.writeLine
        // (file only, no stderr) so a stalled terminal doesn't itself become
        // the bottleneck we're trying to measure. Set ZIGOS_LOG_FILE=/tmp/drag.log
        // before launching the dev host to capture.
        if (g_chrome_dragging) {
            const dt_iter_end = std.Io.Clock.now(.awake, io).toMicroseconds();
            log.writeLine(
                "[drag-trace] iter={d}us evt={d}us(n={d},mot={d}) apptick={d}us preLayout={d}us layout={d}us paint={d}us gpufrm={d}us",
                .{
                    dt_iter_end - dt_iter_start,
                    dt_evt_end - dt_evt_start,
                    dt_evt_count,
                    dt_motion_count,
                    phase_t1 - phase_t0,
                    t2 - phase_t1,
                    t3 - t2,
                    t5 - t4,
                    phase_t_postframe - phase_t_preframe,
                },
            );
        }

        _ = config.diag_sink.flush(io);
    }
}
