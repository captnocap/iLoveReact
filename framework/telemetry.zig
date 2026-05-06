//! Telemetry — unified state mirror for all framework subsystems.
//!
//! Snapshots everything observable once per frame. Any consumer (inspector,
//! crash dump, network export, debug overlay) reads from the same snapshot.
//! Zero allocations. Fixed-size ring buffer for frame history.

const std = @import("std");
const layout = @import("layout.zig");
const gpu = @import("gpu/gpu.zig");
const state = @import("state.zig");
const canvas = @import("canvas.zig");
const selection = @import("selection.zig");
const input = @import("input.zig");
const tooltip = @import("tooltip.zig");
const breakpoint = @import("breakpoint.zig");
const windows = @import("windows.zig");
const router = @import("router.zig");
const log = @import("log.zig");

const Node = layout.Node;
const c = @import("c.zig").imports;

// ════════════════════════════════════════════════════════════════════════
// Snapshot
// ════════════════════════════════════════════════════════════════════════

pub const Snapshot = struct {
    // ── Frame timing ──
    frame_number: u64 = 0,
    fps: u32 = 0,
    tick_us: u64 = 0,
    layout_us: u64 = 0,
    paint_us: u64 = 0,
    // GPU encode + submit + present (the gpu.frame() call). Distinct from
    // paint_us, which is only the CPU-side walk that emits draw commands
    // into per-frame buffers. paint_us answers "how much per-node framework
    // overhead?"; gpu_us answers "how much actual GPU rasterization?".
    gpu_us: u64 = 0,
    frame_total_us: u64 = 0,

    // ── GPU ──
    rect_count: u32 = 0,
    glyph_count: u32 = 0,
    rect_capacity: u32 = 0,
    glyph_capacity: u32 = 0,
    atlas_glyph_count: u32 = 0,
    atlas_capacity: u32 = 0,
    atlas_row_x: u32 = 0,
    atlas_row_y: u32 = 0,
    scissor_depth: u32 = 0,
    scissor_segment_count: u32 = 0,
    gpu_surface_w: u32 = 0,
    gpu_surface_h: u32 = 0,
    frame_hash: u64 = 0,
    frames_since_drain: u64 = 0,

    // ── Text/Font ──
    glyph_cache_count: u32 = 0,
    glyph_cache_capacity: u32 = 0,
    measure_cache_hits: u32 = 0,
    measure_cache_misses: u32 = 0,
    fallback_font_count: u32 = 0,

    // ── Layout ──
    layout_budget: u32 = 0,
    layout_budget_used: u32 = 0,

    // ── Node tree ──
    visible_nodes: u32 = 0,
    hidden_nodes: u32 = 0,
    zero_size_nodes: u32 = 0,
    total_nodes: u32 = 0,
    max_depth: u32 = 0,
    scroll_nodes: u32 = 0,
    text_nodes: u32 = 0,
    image_nodes: u32 = 0,
    pressable_nodes: u32 = 0,
    canvas_nodes: u32 = 0,

    // ── State ──
    state_slot_count: u32 = 0,
    state_slot_capacity: u32 = 0,
    state_dirty: bool = false,
    array_slot_count: u32 = 0,
    array_slot_capacity: u32 = 0,

    // ── Bridge ──
    bridge_calls_per_sec: u64 = 0,

    // ── Input ──
    focused_input_id: i8 = -1,
    active_input_count: u32 = 0,

    // ── Selection ──
    has_selection: bool = false,
    selection_dragging: bool = false,

    // ── Window / System ──
    window_x: i32 = 0,
    window_y: i32 = 0,
    window_w: u32 = 0,
    window_h: u32 = 0,
    display_count: u32 = 0,
    current_display: i32 = 0,
    display_w: u32 = 0,
    display_h: u32 = 0,
    breakpoint_tier: u8 = 0,
    secondary_window_count: u32 = 0,

    // ── Canvas ──
    canvas_cam_x: f32 = 0,
    canvas_cam_y: f32 = 0,
    canvas_cam_zoom: f32 = 1.0,
    canvas_type_count: u32 = 0,

    // ── Network ──
    net_active_connections: u32 = 0,
    net_open_connections: u32 = 0,
    net_reconnecting: u32 = 0,
    net_event_queue_depth: u32 = 0,

    // ── Tooltip ──
    tooltip_visible: bool = false,

    // ── Router ──
    route_history_depth: u32 = 0,
    route_current_index: u32 = 0,

    // ── Logging ──
    log_channels_enabled: u16 = 0,

    // ── Hovered node ──
    hovered_node_tag: [64]u8 = [_]u8{0} ** 64,
    hovered_node_tag_len: u8 = 0,
    hovered_node_x: f32 = 0,
    hovered_node_y: f32 = 0,
    hovered_node_w: f32 = 0,
    hovered_node_h: f32 = 0,
};

// ════════════════════════════════════════════════════════════════════════
// Frame history ring buffer
// ════════════════════════════════════════════════════════════════════════

const HISTORY_SIZE = 120; // 2 seconds at 60fps

var history: [HISTORY_SIZE]Snapshot = [_]Snapshot{.{}} ** HISTORY_SIZE;
var history_head: usize = 0;
var history_count: usize = 0;

/// The most recent snapshot. Read this from host functions.
pub var current: Snapshot = .{};

/// Get the Nth most recent snapshot (0 = current, 1 = previous, ...).
pub fn getHistory(n: usize) ?*const Snapshot {
    if (n >= history_count) return null;
    const idx = (history_head + HISTORY_SIZE - n) % HISTORY_SIZE;
    return &history[idx];
}

/// How many history frames are available.
pub fn historyCount() usize {
    return history_count;
}

// ════════════════════════════════════════════════════════════════════════
// Node tree stats (computed via single recursive walk)
// ════════════════════════════════════════════════════════════════════════

const TreeStats = struct {
    total: u32 = 0,
    max_depth: u32 = 0,
    scroll: u32 = 0,
    text: u32 = 0,
    image: u32 = 0,
    pressable: u32 = 0,
    canvas: u32 = 0,
};

fn walkTree(node: *const Node, depth: u32, stats: *TreeStats) void {
    stats.total += 1;
    if (depth > stats.max_depth) stats.max_depth = depth;

    const ov = node.style.overflow;
    if (ov == .scroll or ov == .auto) stats.scroll += 1;
    if (node.text != null) stats.text += 1;
    if (node.image_src != null) stats.image += 1;
    if (node.handlers.on_press != null) stats.pressable += 1;
    if (node.canvas_type != null) stats.canvas += 1;

    for (node.children) |*child| {
        walkTree(child, depth + 1, stats);
    }
}

// ════════════════════════════════════════════════════════════════════════
// DFS node index — for cursor API (__tel_node)
// ════════════════════════════════════════════════════════════════════════

const MAX_INDEXED_NODES = 4096;

var dfs_nodes: [MAX_INDEXED_NODES]*const Node = undefined;
var dfs_depths: [MAX_INDEXED_NODES]u16 = undefined;
var dfs_count: usize = 0;
var dfs_frame: u64 = 0; // frame number when index was built

fn buildDfsIndex(node: *const Node, depth: u16) void {
    if (dfs_count >= MAX_INDEXED_NODES) return;
    dfs_nodes[dfs_count] = node;
    dfs_depths[dfs_count] = depth;
    dfs_count += 1;
    for (node.children) |*child| {
        buildDfsIndex(child, depth + 1);
    }
}

/// Get total number of nodes in DFS order.
pub fn nodeCount() usize {
    return dfs_count;
}

/// Get node at DFS index. Returns null if out of bounds.
pub fn getNode(index: usize) ?*const Node {
    if (index >= dfs_count) return null;
    return dfs_nodes[index];
}

/// Get depth of node at DFS index.
pub fn getNodeDepth(index: usize) u16 {
    if (index >= dfs_count) return 0;
    return dfs_depths[index];
}

// ════════════════════════════════════════════════════════════════════════
// Collect — called once per frame from engine.zig
// ════════════════════════════════════════════════════════════════════════

pub const CollectArgs = struct {
    tick_us: u64,
    layout_us: u64,
    paint_us: u64,
    gpu_us: u64,
    frame_total_us: u64,
    fps: u32,
    bridge_calls_per_sec: u64,
    root: *const Node,
    visible_nodes: u32,
    hidden_nodes: u32,
    zero_size_nodes: u32,
    window: ?*c.SDL_Window,
    hovered_node: ?*const Node,
};

pub fn collect(args: CollectArgs) void {
    var snap = Snapshot{};

    // ── Frame timing ──
    snap.tick_us = args.tick_us;
    snap.layout_us = args.layout_us;
    snap.paint_us = args.paint_us;
    snap.gpu_us = args.gpu_us;
    snap.frame_total_us = args.frame_total_us;
    snap.fps = args.fps;
    snap.frame_number = gpu.telemetryFrameCounter();

    // ── GPU ──
    const gpu_stats = gpu.telemetryStats();
    snap.rect_count = gpu_stats.rect_count;
    snap.glyph_count = gpu_stats.glyph_count;
    snap.rect_capacity = gpu_stats.rect_capacity;
    snap.glyph_capacity = gpu_stats.glyph_capacity;
    snap.atlas_glyph_count = gpu_stats.atlas_glyph_count;
    snap.atlas_capacity = gpu_stats.atlas_capacity;
    snap.atlas_row_x = gpu_stats.atlas_row_x;
    snap.atlas_row_y = gpu_stats.atlas_row_y;
    snap.scissor_depth = gpu_stats.scissor_depth;
    snap.scissor_segment_count = gpu_stats.scissor_segment_count;
    snap.gpu_surface_w = gpu_stats.surface_w;
    snap.gpu_surface_h = gpu_stats.surface_h;
    snap.frame_hash = gpu_stats.frame_hash;
    snap.frames_since_drain = gpu_stats.frames_since_drain;

    // ── Layout ──
    snap.layout_budget = layout.telemetryBudget();
    snap.layout_budget_used = layout.telemetryBudgetUsed();

    // ── Node tree walk ──
    var tree_stats = TreeStats{};
    walkTree(args.root, 0, &tree_stats);
    snap.total_nodes = tree_stats.total;
    snap.max_depth = tree_stats.max_depth;
    snap.scroll_nodes = tree_stats.scroll;
    snap.text_nodes = tree_stats.text;
    snap.image_nodes = tree_stats.image;
    snap.pressable_nodes = tree_stats.pressable;
    snap.canvas_nodes = tree_stats.canvas;
    snap.visible_nodes = args.visible_nodes;
    snap.hidden_nodes = args.hidden_nodes;
    snap.zero_size_nodes = args.zero_size_nodes;

    // ── Build DFS index (for cursor API) ──
    dfs_count = 0;
    buildDfsIndex(args.root, 0);
    dfs_frame = snap.frame_number;

    // ── State ──
    snap.state_slot_count = @intCast(state.slotCount());
    snap.state_slot_capacity = state.MAX_SLOTS;
    snap.state_dirty = state.isDirty();
    snap.array_slot_count = @intCast(state.telemetryArraySlotCount());
    snap.array_slot_capacity = 16; // MAX_ARRAY_SLOTS

    // ── Bridge ──
    snap.bridge_calls_per_sec = args.bridge_calls_per_sec;

    // ── Input ──
    const input_stats = input.telemetryStats();
    snap.focused_input_id = input_stats.focused_id;
    snap.active_input_count = input_stats.active_count;

    // ── Selection ──
    snap.has_selection = selection.telemetryHasSelection();
    snap.selection_dragging = selection.telemetryIsDragging();

    // ── Window / System ──
    if (args.window) |win| {
        var wx: c_int = 0;
        var wy: c_int = 0;
        _ = c.SDL_GetWindowPosition(win, &wx, &wy);
        snap.window_x = wx;
        snap.window_y = wy;

        var ww: c_int = 0;
        var wh: c_int = 0;
        _ = c.SDL_GetWindowSize(win, &ww, &wh);
        snap.window_w = @intCast(@max(0, ww));
        snap.window_h = @intCast(@max(0, wh));

        var n_displays: c_int = 0;
        const display_ids = c.SDL_GetDisplays(&n_displays);
        snap.display_count = @intCast(@max(0, n_displays));
        if (display_ids != null) c.SDL_free(display_ids);
        const current_disp = c.SDL_GetDisplayForWindow(win);
        snap.current_display = @intCast(current_disp);

        var bounds: c.SDL_Rect = undefined;
        if (c.SDL_GetDisplayBounds(current_disp, &bounds)) {
            snap.display_w = @intCast(@max(0, bounds.w));
            snap.display_h = @intCast(@max(0, bounds.h));
        }
    }

    snap.breakpoint_tier = @intFromEnum(breakpoint.current());
    snap.secondary_window_count = windows.telemetryActiveCount();

    // ── Canvas ──
    const cam = canvas.telemetryCameraState();
    snap.canvas_cam_x = cam.x;
    snap.canvas_cam_y = cam.y;
    snap.canvas_cam_zoom = cam.zoom;
    snap.canvas_type_count = cam.type_count;

    // ── Tooltip ──
    snap.tooltip_visible = tooltip.telemetryVisible();

    // ── Router ──
    const route_stats = router.telemetryStats();
    snap.route_history_depth = route_stats.history_depth;
    snap.route_current_index = route_stats.current_index;

    // ── Logging ──
    snap.log_channels_enabled = log.telemetryEnabledMask();

    // ── Hovered node ──
    if (args.hovered_node) |hn| {
        const tag = hn.debug_name orelse nodeTypeName(hn);
        const len = @min(tag.len, 64);
        @memcpy(snap.hovered_node_tag[0..len], tag[0..len]);
        snap.hovered_node_tag_len = @intCast(len);
        snap.hovered_node_x = hn.computed.x;
        snap.hovered_node_y = hn.computed.y;
        snap.hovered_node_w = hn.computed.w;
        snap.hovered_node_h = hn.computed.h;
    }

    // ── Commit to history ──
    history_head = (history_head + 1) % HISTORY_SIZE;
    history[history_head] = snap;
    if (history_count < HISTORY_SIZE) history_count += 1;
    current = snap;
}

pub fn nodeTypeName(node: *const Node) []const u8 {
    if (node.canvas_type != null) return "Canvas";
    if (node.input_id != null) return "TextInput";
    if (node.image_src != null) return "Image";
    if (node.handlers.on_press != null) return "Pressable";
    if (node.text != null) return "Text";
    return "Box";
}
