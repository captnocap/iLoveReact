//! framework/host_tree.zig — the React Node tree state container.
//!
//! Phase 1 (this file): structural state + CRUD primitives only.
//!   - id → Node map
//!   - parent → children list map
//!   - child → parent map (the inverse, for O(depth) ancestor walks)
//!   - root-child id list
//!   - dirty flag
//!   - ensureNode / appendChild / insertBefore / removeChild / appendToRoot /
//!     insertBeforeRoot / removeFromRoot / markSubtreeDirty
//!   - mutation hook (so StaticSurface stays correct in v8_app without
//!     pulling gpu.frameCounter into this module — the hook fires once
//!     per ancestor on every mutation, and v8_app installs a function
//!     that stamps node.subtree_last_mutated_frame)
//!
//! Phase 2 (next session): move applyCommand + applyCommandBatch off
//!   v8_app.zig into this module so v8_tui_app can drive a Window
//!   subtree's reconciler stream without re-implementing the loop.
//!   applyProps (590 lines of CSS-shaped style parsing) is the big
//!   piece. It touches latches, font handles, image cache — some of
//!   which are GPU-only. The plan is to extract the pure-data parts
//!   here and expose extension hooks for the GPU-coupled ones.
//!
//! Phase 3 (later): the GPU side (v8_app.zig) drops its own
//!   `g_node_by_id`, `g_children_ids`, `g_parent_id`, `g_root_child_ids`,
//!   `g_dirty` globals and reads from this module instead. Until then,
//!   v8_app keeps its tree state; only v8_tui_app (under -Dhas-window)
//!   uses this module.
//!
//! Why not just import v8_app.zig from v8_tui_app? Top-level
//! `@embedFile(BUNDLE_FILE_NAME)` in v8_app.zig:281 is eager-evaluated
//! on import — would double-embed the cart bundle into ship-tui. And
//! v8_app's globals are bound to the GPU paint loop's lifecycle. A
//! dedicated tree-state module is the clean cut.

const std = @import("std");
const layout = @import("layout.zig");

pub const Node = layout.Node;

// ════════════════════════════════════════════════════════════════════════
// State
// ════════════════════════════════════════════════════════════════════════

var g_alloc: std.mem.Allocator = undefined;
var g_inited: bool = false;

/// id → *Node. Every CREATE/CREATE_TEXT op writes here; UPDATE/REMOVE
/// reads here. Lifetime of every *Node is g_alloc's; node bytes are
/// owned by this module after `ensureNode`.
var g_node_by_id: std.AutoHashMap(u32, *Node) = undefined;

/// parent_id → ordered list of child ids. APPEND pushes, INSERT_BEFORE
/// inserts at index, REMOVE orderedRemoves. Lists are owned here.
var g_children_ids: std.AutoHashMap(u32, std.ArrayList(u32)) = undefined;

/// child_id → parent_id. Inverse of `g_children_ids`. Maintained
/// alongside every APPEND / INSERT_BEFORE / REMOVE so `markSubtreeDirty`
/// can walk the ancestor chain in O(depth) instead of scanning every
/// children list per mutation.
var g_parent_id: std.AutoHashMap(u32, u32) = undefined;

/// Ordered list of top-level child ids (children of the React root).
/// APPEND_TO_ROOT pushes, INSERT_BEFORE_ROOT inserts, REMOVE_FROM_ROOT
/// removes. Nodes here have no entry in `g_parent_id`.
var g_root_child_ids: std.ArrayList(u32) = .{};

/// Set when any mutation runs. The consumer (paint loop, ANSI walker)
/// reads + clears this per frame to decide whether to relayout.
var g_dirty: bool = true;

/// Optional callback fired once per ancestor (including the mutated
/// node itself) on every mutation. v8_app installs a hook that stamps
/// `node.subtree_last_mutated_frame = gpu.frameCounter()` so
/// `<StaticSurface>` cache invalidation keeps working. v8_tui_app
/// doesn't install one — `<StaticSurface>` inside a TUI-spawned
/// `<Window>` subtree paints fine without it (no texture cache to
/// invalidate; the SDL3 renderer redraws every frame anyway). Sparse
/// use across the cart tree means the absent stamping is acceptable.
var g_on_mutation: ?*const fn (*Node) void = null;

// ════════════════════════════════════════════════════════════════════════
// Lifecycle
// ════════════════════════════════════════════════════════════════════════

pub fn init(alloc: std.mem.Allocator) void {
    if (g_inited) return;
    g_alloc = alloc;
    g_node_by_id = std.AutoHashMap(u32, *Node).init(alloc);
    g_children_ids = std.AutoHashMap(u32, std.ArrayList(u32)).init(alloc);
    g_parent_id = std.AutoHashMap(u32, u32).init(alloc);
    g_root_child_ids = .{};
    g_dirty = true;
    g_inited = true;
}

pub fn deinit() void {
    if (!g_inited) return;
    var children_it = g_children_ids.valueIterator();
    while (children_it.next()) |list| list.deinit(g_alloc);
    g_children_ids.deinit();

    var nodes_it = g_node_by_id.valueIterator();
    while (nodes_it.next()) |np| g_alloc.destroy(np.*);
    g_node_by_id.deinit();

    g_parent_id.deinit();
    g_root_child_ids.deinit(g_alloc);
    g_inited = false;
}

// ════════════════════════════════════════════════════════════════════════
// Mutation hook
// ════════════════════════════════════════════════════════════════════════

pub fn setMutationHook(f: *const fn (*Node) void) void {
    g_on_mutation = f;
}

pub fn clearMutationHook() void {
    g_on_mutation = null;
}

// ════════════════════════════════════════════════════════════════════════
// Accessors
// ════════════════════════════════════════════════════════════════════════

pub fn getNode(id: u32) ?*Node {
    return g_node_by_id.get(id);
}

pub fn getParent(id: u32) ?u32 {
    return g_parent_id.get(id);
}

pub fn getChildren(parent_id: u32) []const u32 {
    if (g_children_ids.get(parent_id)) |list| return list.items;
    return &.{};
}

pub fn getRootChildren() []const u32 {
    return g_root_child_ids.items;
}

pub fn isDirty() bool {
    return g_dirty;
}

pub fn clearDirty() void {
    g_dirty = false;
}

pub fn markDirty() void {
    g_dirty = true;
}

pub fn allocator() std.mem.Allocator {
    return g_alloc;
}

// ════════════════════════════════════════════════════════════════════════
// CRUD primitives
// ════════════════════════════════════════════════════════════════════════

pub fn ensureNode(id: u32) !*Node {
    if (g_node_by_id.get(id)) |n| return n;
    const n = try g_alloc.create(Node);
    n.* = .{};
    n.id = id;
    n.scroll_persist_slot = id;
    try g_node_by_id.put(id, n);
    try g_children_ids.put(id, .{});
    return n;
}

pub fn appendChild(parent_id: u32, child_id: u32) !void {
    _ = try ensureNode(parent_id);
    _ = try ensureNode(child_id);
    if (g_children_ids.getPtr(parent_id)) |list| try list.append(g_alloc, child_id);
    try g_parent_id.put(child_id, parent_id);
    markSubtreeDirty(child_id);
    g_dirty = true;
}

pub fn insertBefore(parent_id: u32, child_id: u32, before_id: u32) !void {
    _ = try ensureNode(child_id);
    if (g_children_ids.getPtr(parent_id)) |list| {
        var idx: usize = list.items.len;
        for (list.items, 0..) |x, i| if (x == before_id) {
            idx = i;
            break;
        };
        try list.insert(g_alloc, idx, child_id);
    }
    try g_parent_id.put(child_id, parent_id);
    markSubtreeDirty(child_id);
    g_dirty = true;
}

pub fn removeChild(parent_id: u32, child_id: u32) void {
    if (g_children_ids.getPtr(parent_id)) |list| {
        for (list.items, 0..) |x, i| if (x == child_id) {
            _ = list.orderedRemove(i);
            break;
        };
    }
    // Stamp dirty BEFORE clearing the parent link so the walk reaches
    // the (former) parent's ancestors. After this the detached subtree
    // is gone from the tree anyway.
    markSubtreeDirty(child_id);
    _ = g_parent_id.remove(child_id);
    g_dirty = true;
}

pub fn appendToRoot(child_id: u32) !void {
    _ = try ensureNode(child_id);
    try g_root_child_ids.append(g_alloc, child_id);
    _ = g_parent_id.remove(child_id);
    markSubtreeDirty(child_id);
    g_dirty = true;
}

pub fn insertBeforeRoot(child_id: u32, before_id: u32) !void {
    _ = try ensureNode(child_id);
    var idx: usize = g_root_child_ids.items.len;
    for (g_root_child_ids.items, 0..) |x, i| if (x == before_id) {
        idx = i;
        break;
    };
    try g_root_child_ids.insert(g_alloc, idx, child_id);
    _ = g_parent_id.remove(child_id);
    markSubtreeDirty(child_id);
    g_dirty = true;
}

pub fn removeFromRoot(child_id: u32) void {
    for (g_root_child_ids.items, 0..) |x, i| if (x == child_id) {
        _ = g_root_child_ids.orderedRemove(i);
        break;
    };
    markSubtreeDirty(child_id);
    _ = g_parent_id.remove(child_id);
    g_dirty = true;
}

// ════════════════════════════════════════════════════════════════════════
// Dirty propagation
// ════════════════════════════════════════════════════════════════════════

/// Fire the mutation hook on `id` and every ancestor up to the root.
/// O(depth). Cycle-guarded at 4096 hops — should never trip but a
/// corrupt parent-id chain would otherwise hang here.
pub fn markSubtreeDirty(id: u32) void {
    const hook = g_on_mutation orelse return;
    var current: ?u32 = id;
    var hops: u32 = 0;
    while (current) |cur| : (hops += 1) {
        if (g_node_by_id.get(cur)) |node| hook(node);
        current = g_parent_id.get(cur);
        if (hops > 4096) break;
    }
}

// ════════════════════════════════════════════════════════════════════════
// Typography propagation
// ════════════════════════════════════════════════════════════════════════

/// When a bare text node (CREATE_TEXT, i.e. React's TextInstance for a
/// string child) is appended to a parent, copy the parent's typography
/// so `<Text fontSize={17}>Hello</Text>` actually renders "Hello" at 17.
/// The reconciler makes the parent Text and child TextInstance separate
/// nodes; without this the child inherits nothing and uses the default.
pub fn inheritTypography(parent_id: u32, child_id: u32) void {
    const parent = g_node_by_id.get(parent_id) orelse return;
    const child = g_node_by_id.get(child_id) orelse return;
    if (child.text == null) return;
    child.font_size = parent.font_size;
    child.font_family_id = parent.font_family_id;
    child.font_weight = parent.font_weight;
    if (parent.text_color) |c| child.text_color = c;
    child.letter_spacing = parent.letter_spacing;
    child.number_of_lines = parent.number_of_lines;
    child.no_wrap = parent.no_wrap;
    // Only propagate line_height when the parent explicitly set one.
    // Without this guard, a child with its own `lineHeight` style would
    // get stomped back to 0 by any parent UPDATE (the default).
    if (parent.line_height > 0) child.line_height = parent.line_height;
}

// ════════════════════════════════════════════════════════════════════════
// JSON helpers
// ════════════════════════════════════════════════════════════════════════

/// Coerce a std.json.Value to i64 if it's a number-shaped node.
/// React commands sometimes emit floats where ids are expected; this
/// folds both to integers cleanly. Returns null for non-numeric values.
pub fn jsonInt(v: std.json.Value) ?i64 {
    return switch (v) {
        .integer => |i| i,
        .float => |f| @as(i64, @intFromFloat(f)),
        else => null,
    };
}
