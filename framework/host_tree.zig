//! framework/host_tree.zig — the React Node tree state container.
//!
//! Owns the structural side of the reconciler→Zig pipeline:
//!   - id → Node map
//!   - parent → children list map
//!   - child → parent map (the inverse, for O(depth) ancestor walks)
//!   - root-child id list
//!   - dirty flag + mutation hook (StaticSurface stamping etc. live in
//!     the consumer, not here)
//!   - CRUD primitives (ensureNode / appendChild / insertBefore / etc.)
//!   - applyCommand + applyCommandBatch — the per-batch JSON consumer
//!     that drives the tree from the reconciler's mutation stream
//!   - inheritTypography, jsonInt
//!
//! The GPU-coupled bits (CSS-shaped prop parsing, handler-flag
//! registration, host-window opens, .independent IPC routing) are
//! delegated to optional hooks installed by the consumer. v8_app
//! installs all of them; v8_tui_app installs a subset under
//! -Dhas-window so a <Window> subtree from a TUI cart can paint to a
//! real SDL3 surface via the same reconciler stream that powers the
//! ANSI grid.
//!
//! Why not just import v8_app.zig from v8_tui_app? Top-level
//! `@embedFile(BUNDLE_FILE_NAME)` in v8_app.zig:281 is eager-evaluated
//! on import — would double-embed the cart bundle into ship-tui. And
//! v8_app's globals are bound to the GPU paint loop's lifecycle. A
//! dedicated tree-state module is the clean cut.
//!
//! Migration status: v8_tui_app under HAS_WINDOW is the first
//! consumer. v8_app continues to own its parallel copy of the tree
//! state during the transition (its `g_node_by_id` et al. stay live)
//! — moving v8_app onto this module is the next sweep. Until then,
//! the two binaries each have independent tree state.

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
var g_root_child_ids: std.ArrayList(u32) = .empty;

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
    g_root_child_ids = .empty;
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

// Pointer accessors. The GPU shell (v8_app.zig) installs local pointer
// vars to these on startup so its existing `g_node_by_id.get(id)` /
// `g_children_ids.getPtr(pid)` / `g_root_child_ids.items` syntax keeps
// working without rewriting hundreds of call sites. The capacity to
// peek inside the maps directly is intentional for the GPU paint loop's
// hot path; the TUI shell uses the slice-shaped accessors above instead.
pub fn nodesPtr() *std.AutoHashMap(u32, *Node) {
    return &g_node_by_id;
}
pub fn childrenIdsPtr() *std.AutoHashMap(u32, std.ArrayList(u32)) {
    return &g_children_ids;
}
pub fn parentIdPtr() *std.AutoHashMap(u32, u32) {
    return &g_parent_id;
}
pub fn rootChildIdsPtr() *std.ArrayList(u32) {
    return &g_root_child_ids;
}
pub fn dirtyPtr() *bool {
    return &g_dirty;
}

pub fn nodeCount() usize {
    return g_node_by_id.count();
}

pub const NodeIterator = std.AutoHashMap(u32, *Node).Iterator;
pub fn nodesIter() NodeIterator {
    return g_node_by_id.iterator();
}

pub const NodeValueIterator = std.AutoHashMap(u32, *Node).ValueIterator;
pub fn nodesValueIter() NodeValueIterator {
    return g_node_by_id.valueIterator();
}

/// Remove `id` from the tree state and free its Node memory + children
/// list. Caller is responsible for any per-cart-feature teardown on the
/// Node's fields (gpu buffers, input slots, etc.) BEFORE calling — those
/// concerns live in the consumer shell, not here.
pub fn destroyNode(context: *anyopaque, id: u32) void {
    if (g_node_by_id.get(id)) |n| {
        if (g_hooks.before_destroy) |f| f(context, n, id);
    }
    if (g_children_ids.getPtr(id)) |list| list.deinit(g_alloc);
    _ = g_children_ids.remove(id);
    _ = g_parent_id.remove(id);
    if (g_node_by_id.fetchRemove(id)) |entry| {
        g_alloc.destroy(entry.value);
    }
}

/// Hot-reload teardown. Drops every Node + map entry but keeps the
/// allocations so the next bundle's CREATEs hit cached capacity. node.text
/// ownership is mixed (some g_alloc dupes, some slices into framework input
/// buffers) so we intentionally leak the text — kilobytes per reload, fine
/// for a dev-mode safety net.
pub fn clearAll(context: *anyopaque) void {
    if (g_hooks.before_destroy) |f| {
        var pre_it = g_node_by_id.iterator();
        while (pre_it.next()) |entry| f(context, entry.value_ptr.*, entry.key_ptr.*);
    }
    var nodes_it = g_node_by_id.valueIterator();
    while (nodes_it.next()) |np| g_alloc.destroy(np.*);
    g_node_by_id.clearRetainingCapacity();

    var children_it = g_children_ids.valueIterator();
    while (children_it.next()) |list| list.deinit(g_alloc);
    g_children_ids.clearRetainingCapacity();

    g_parent_id.clearRetainingCapacity();
    g_root_child_ids.clearRetainingCapacity();
    g_dirty = true;
}

// ════════════════════════════════════════════════════════════════════════
// Tree materialization
// ════════════════════════════════════════════════════════════════════════
//
// Walks the id-keyed tree under `parent_id` and copies it into a linear
// arena-allocated Node tree the painter can recurse through. Shallow copy
// per Node (style + computed + text pointers are all shared with the
// canonical node in g_node_by_id); the painter writes only to `computed`,
// which is per-frame anyway.
//
// Use this from a per-frame arena that's reset every tick — no individual
// frees, O(1) reuse. Multi-Window owner filtering (skipping children that
// belong to a different Window subtree) is a GPU-host concern and not
// handled here.

pub fn materializeChildren(arena: std.mem.Allocator, parent_id: u32) []layout.Node {
    const ids = getChildren(parent_id);
    if (ids.len == 0) return &.{};
    const out = arena.alloc(layout.Node, ids.len) catch return &.{};
    var i: usize = 0;
    for (ids) |cid| {
        const src = getNode(cid) orelse {
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

/// Build a synthetic root for `node_id` carrying the node's own state plus
/// a recursively-materialized child tree. The caller usually wants this for
/// a <Window>'s subtree — i.e. a root that paints with a column flex and
/// some default background, with the cart's tree as children. Returns null
/// if the node isn't in the host tree.
pub fn materializeWindowRoot(arena: std.mem.Allocator, window_node_id: u32) ?*layout.Node {
    if (getNode(window_node_id) == null) return null;
    const root = arena.create(layout.Node) catch return null;
    root.* = .{};
    root.style.flex_direction = .column;
    root.style.background_color = layout.Color.rgb(17, 24, 39);
    root.children = materializeChildren(arena, window_node_id);
    return root;
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
    try g_children_ids.put(id, .empty);
    return n;
}

pub fn appendChild(parent_id: u32, child_id: u32) !void {
    _ = try ensureNode(parent_id);
    _ = try ensureNode(child_id);
    // Already in the tree ⇒ React is REPOSITIONING this node, not mounting it.
    const is_move = detachForPlacement(child_id);
    if (g_children_ids.getPtr(parent_id)) |list| try list.append(g_alloc, child_id);
    try g_parent_id.put(child_id, parent_id);
    dirtyForPlacement(parent_id, child_id, is_move);
    g_dirty = true;
}

pub fn insertBefore(parent_id: u32, child_id: u32, before_id: u32) !void {
    _ = try ensureNode(parent_id);
    _ = try ensureNode(child_id);
    // "Move X before X" is already satisfied. Detaching first would lose the
    // reference point and incorrectly append X to the end.
    if (child_id == before_id) return;
    const is_move = detachForPlacement(child_id);
    if (g_children_ids.getPtr(parent_id)) |list| {
        var idx: usize = list.items.len;
        for (list.items, 0..) |x, i| if (x == before_id) {
            idx = i;
            break;
        };
        try list.insert(g_alloc, idx, child_id);
    }
    try g_parent_id.put(child_id, parent_id);
    dirtyForPlacement(parent_id, child_id, is_move);
    g_dirty = true;
}

/// Stamp the content-dirty frame for a child placement. A fresh mount dirties
/// the child (its subtree is new). A REPOSITION (the child already lived in the
/// tree — a sibling-array shift) dirties only the parent/ancestors, whose child
/// ORDER changed, and deliberately NOT the moved node: a `<StaticSurface>`'s
/// baked texture is position-independent, so re-baking it on a move is pure
/// waste (this was the idle paint spike — a toggled sibling shifted the floor
/// captures and re-baked their 900×900 shaders every frame). Layout still
/// redraws the moved node's quad at its new spot from the cached texture.
fn dirtyForPlacement(parent_id: u32, child_id: u32, is_move: bool) void {
    if (is_move) markSubtreeDirty(parent_id) else markSubtreeDirty(child_id);
}

/// React mutation-mode APPEND/INSERT_BEFORE operations reposition an existing
/// keyed child. Remove its previous reference first so a move cannot leave the
/// same node id in both its stale and current sibling positions.
fn detachForPlacement(child_id: u32) bool {
    var removed = false;
    if (g_parent_id.get(child_id)) |old_parent_id| {
        if (g_children_ids.getPtr(old_parent_id)) |list| {
            removed = removeAllIds(list, child_id) or removed;
        }
        // A cross-parent move changes the old parent's ordered child set too.
        markSubtreeDirty(old_parent_id);
    }
    removed = removeAllIds(&g_root_child_ids, child_id) or removed;
    _ = g_parent_id.remove(child_id);
    return removed;
}

fn removeAllIds(list: *std.ArrayList(u32), child_id: u32) bool {
    var removed = false;
    var i: usize = list.items.len;
    while (i > 0) {
        i -= 1;
        if (list.items[i] != child_id) continue;
        _ = list.orderedRemove(i);
        removed = true;
    }
    return removed;
}

pub fn removeChild(parent_id: u32, child_id: u32) void {
    if (g_children_ids.getPtr(parent_id)) |list| {
        _ = removeAllIds(list, child_id);
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
    _ = detachForPlacement(child_id);
    try g_root_child_ids.append(g_alloc, child_id);
    _ = g_parent_id.remove(child_id);
    markSubtreeDirty(child_id);
    g_dirty = true;
}

pub fn insertBeforeRoot(child_id: u32, before_id: u32) !void {
    _ = try ensureNode(child_id);
    if (child_id == before_id) return;
    _ = detachForPlacement(child_id);
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
    _ = removeAllIds(&g_root_child_ids, child_id);
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
    // A TextInput/TextArea/TextEditor parks its controlled `value` in
    // node.text, so it reads as a bare text instance here — but it is NOT
    // one. It owns its own typography from its own props (fontSize, family,
    // weight), exactly like a real <input> carries the UA font rather than
    // inheriting the surrounding box's. Without this bail, APPEND (and every
    // parent UPDATE, which re-runs this for all children) stomps the input's
    // explicit font_size back to the parent's default — so a
    // `<TextInput style={{ fontSize: 32 }}>` silently painted at 16.
    if (child.input_id != null) return;
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
        .float => |f| @trunc(f),
        else => null,
    };
}

// ════════════════════════════════════════════════════════════════════════
// Hooks (GPU-coupled side effects)
// ════════════════════════════════════════════════════════════════════════

pub const Hooks = struct {
    /// CREATE: type_name has been determined. Apply type-specific
    /// defaults to the new Node (e.g. ScrollView sets overflow=hidden,
    /// font-bearing types stamp a default family/size). v8_app's
    /// installer mirrors `applyTypeDefaults` in v8_app.zig.
    type_defaults: ?*const fn (*Node, u32, []const u8) void = null,

    /// CREATE/UPDATE: apply the props object (CSS-shaped style + other
    /// reconciler props) to the Node. `type_name` is set on CREATE,
    /// null on UPDATE. The 590-line CSS parse lives in v8_app's
    /// `applyProps`; v8_tui_app installs a smaller version that
    /// handles only what a TUI-spawned <Window> subtree needs.
    apply_props: ?*const fn (*Node, std.json.Value, ?[]const u8) void = null,

    /// CREATE/UPDATE: extract event handler flags (onPress, onMouseDown,
    /// etc.) from the command and register them with the event system.
    apply_handler_flags: ?*const fn (*anyopaque, *Node, u32, std.json.Value) void = null,

    /// CREATE with type=Window/Notification: open the host window.
    /// Wraps `framework/primitive/windows.zig` calls. v8_app's
    /// installer also tracks the slot in its window-by-id map.
    open_host_window: ?*const fn (std.Io, *const std.process.Environ.Map, u32, []const u8, ?std.json.Value) void = null,

    /// Every applyCommand call: note which window owns this command.
    /// v8_app uses this for .independent window IPC routing; v8_tui_app
    /// can skip.
    note_window_owner: ?*const fn (std.json.Value) void = null,

    /// After every applyCommand in a batch: maybe forward the command
    /// across an IPC boundary for .independent windows. v8_app-only.
    route_to_window: ?*const fn (*const std.process.Environ.Map, std.json.Value) void = null,

    /// UPDATE: remove keys from props/style (when a prop is unset by
    /// the reconciler diff). v8_app's handlers clean up latch tracking
    /// and any GPU-coupled prop teardown.
    remove_prop_keys: ?*const fn (*Node, std.json.Value) void = null,
    remove_style_keys: ?*const fn (*Node, std.json.Value) void = null,

    /// Pre-op intercept for v8_app's `.independent` child-window mode
    /// (separate process connected via IPC). Returns true if the
    /// command was consumed and applyCommand should bail. Only set in
    /// v8_app when running as a child window.
    child_window_intercept: ?*const fn (std.json.Value, []const u8) bool = null,

    /// Called from `destroyNode` BEFORE the Node memory is freed, so
    /// per-cart-feature teardown (paintable textures, GPU buffers,
    /// input slots, etc.) gets a chance to run with the Node's fields
    /// still valid. Also called from `clearAll` for every live node.
    before_destroy: ?*const fn (*anyopaque, *Node, u32) void = null,
};

var g_hooks: Hooks = .{};

pub fn setHooks(h: Hooks) void {
    g_hooks = h;
}

pub fn getHooks() Hooks {
    return g_hooks;
}

// ════════════════════════════════════════════════════════════════════════
// applyCommand — drive the tree from one reconciler mutation
// ════════════════════════════════════════════════════════════════════════

fn cmdId(cmd: std.json.Value, key: []const u8) ?u32 {
    const v = cmd.object.get(key) orelse return null;
    const i = jsonInt(v) orelse return null;
    if (i < 0) return null;
    return @intCast(i);
}

pub fn applyCommand(context: *anyopaque, io: std.Io, environ: *const std.process.Environ.Map, cmd: std.json.Value) !void {
    if (cmd != .object) return;
    if (g_hooks.note_window_owner) |f| f(cmd);

    const op_v = cmd.object.get("op") orelse return;
    if (op_v != .string) return;
    const op = op_v.string;

    // Child-window IPC intercept (v8_app .independent mode only).
    if (g_hooks.child_window_intercept) |f| {
        if (f(cmd, op)) return;
    }

    if (std.mem.eql(u8, op, "CREATE")) {
        const id = cmdId(cmd, "id") orelse return;
        const n = try ensureNode(id);
        var type_name: ?[]const u8 = null;
        if (cmd.object.get("type")) |t| if (t == .string) {
            type_name = t.string;
            if (g_hooks.type_defaults) |f| f(n, id, t.string);
        };
        if (cmd.object.get("props")) |props| {
            if (g_hooks.apply_props) |f| f(n, props, type_name);
        }
        if (type_name) |tn| {
            if (g_hooks.open_host_window) |f| f(io, environ, id, tn, cmd.object.get("props"));
        }
        // debugName / debugSource are emitted as top-level siblings to
        // props by renderer/hostConfig.ts. Capture so witness/autotest
        // can label pressables by user-component name.
        if (cmd.object.get("debugName")) |dn| if (dn == .string and dn.string.len > 0) {
            if (g_alloc.dupe(u8, dn.string)) |owned| {
                n.debug_name = owned;
            } else |_| {}
        };
        if (g_hooks.apply_handler_flags) |f| f(context, n, id, cmd);
        markSubtreeDirty(id);
        g_dirty = true;
    } else if (std.mem.eql(u8, op, "CREATE_TEXT")) {
        const id = cmdId(cmd, "id") orelse return;
        const n = try ensureNode(id);
        if (cmd.object.get("text")) |t| if (t == .string) {
            n.text = try g_alloc.dupe(u8, t.string);
        };
        markSubtreeDirty(id);
        g_dirty = true;
    } else if (std.mem.eql(u8, op, "APPEND")) {
        const pid = cmdId(cmd, "parentId") orelse return;
        const cid = cmdId(cmd, "childId") orelse return;
        try appendChild(pid, cid);
        inheritTypography(pid, cid);
    } else if (std.mem.eql(u8, op, "APPEND_TO_ROOT")) {
        const cid = cmdId(cmd, "childId") orelse return;
        try appendToRoot(cid);
    } else if (std.mem.eql(u8, op, "INSERT_BEFORE_ROOT")) {
        const cid = cmdId(cmd, "childId") orelse return;
        const bid = cmdId(cmd, "beforeId") orelse return;
        try insertBeforeRoot(cid, bid);
    } else if (std.mem.eql(u8, op, "INSERT_BEFORE")) {
        const pid = cmdId(cmd, "parentId") orelse return;
        const cid = cmdId(cmd, "childId") orelse return;
        const bid = cmdId(cmd, "beforeId") orelse return;
        try insertBefore(pid, cid, bid);
        inheritTypography(pid, cid);
    } else if (std.mem.eql(u8, op, "REMOVE")) {
        const pid = cmdId(cmd, "parentId") orelse return;
        const cid = cmdId(cmd, "childId") orelse return;
        removeChild(pid, cid);
    } else if (std.mem.eql(u8, op, "REMOVE_FROM_ROOT")) {
        const cid = cmdId(cmd, "childId") orelse return;
        removeFromRoot(cid);
    } else if (std.mem.eql(u8, op, "UPDATE")) {
        const id = cmdId(cmd, "id") orelse return;
        if (g_node_by_id.get(id)) |n| {
            if (cmd.object.get("removeKeys")) |keys| {
                if (g_hooks.remove_prop_keys) |f| f(n, keys);
            }
            if (cmd.object.get("removeStyleKeys")) |keys| {
                if (g_hooks.remove_style_keys) |f| f(n, keys);
            }
            if (cmd.object.get("props")) |props| {
                if (g_hooks.apply_props) |f| f(n, props, null);
            }
            if (g_hooks.apply_handler_flags) |f| f(context, n, id, cmd);
            // Propagate typography to bare text children so dynamic
            // fontSize changes on the parent flow through to the child
            // TextInstances.
            if (g_children_ids.get(id)) |children| {
                for (children.items) |child_id| inheritTypography(id, child_id);
            }
            markSubtreeDirty(id);
            g_dirty = true;
        }
    } else if (std.mem.eql(u8, op, "UPDATE_TEXT")) {
        const id = cmdId(cmd, "id") orelse return;
        if (g_node_by_id.get(id)) |n| {
            if (cmd.object.get("text")) |t| if (t == .string) {
                n.text = try g_alloc.dupe(u8, t.string);
            };
            markSubtreeDirty(id);
            g_dirty = true;
        }
    }
}

/// Drain one batch of pending reconciler commands. JSON bytes are an
/// array of command objects emitted by renderer/hostConfig.ts. Errors
/// per-command are caught and logged so a single bad command can't
/// freeze the whole frame; parse failure aborts the whole batch.
pub fn applyCommandBatch(context: *anyopaque, io: std.Io, environ: *const std.process.Environ.Map, json_bytes: []const u8) void {
    const parsed = std.json.parseFromSlice(std.json.Value, g_alloc, json_bytes, .{}) catch |err| {
        std.log.scoped(.host_tree).err("parse error: {s}", .{@errorName(err)});
        return;
    };
    defer parsed.deinit();
    if (parsed.value != .array) return;
    for (parsed.value.array.items) |cmd| applyCommand(context, io, environ, cmd) catch |err| {
        std.log.scoped(.host_tree).err("apply error: {s}", .{@errorName(err)});
    };
    // .independent windows: forward the batch's commands across the IPC
    // boundary to the child process. v8_app installs this; v8_tui_app
    // doesn't use .independent (no need for crash isolation when the
    // window is in-process SDL3 anyway).
    if (g_hooks.route_to_window) |f| {
        for (parsed.value.array.items) |cmd| f(environ, cmd);
    }
}
