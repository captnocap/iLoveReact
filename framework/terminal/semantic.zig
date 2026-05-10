//! Semantic graph builder — structural interpretation of classified terminal output.
//!
//! Consumes classified rows (token + row index) and produces a graph:
//! nodes with stable identity, parent/child links, role/lane metadata,
//! session state flags, and frame diffs.
//!
//! Pipeline: PTY → vterm → classifier → semantic graph → render
//!
//! Port of love2d/lua/semantic_graph.lua + classification pipeline from
//! love2d/lua/capabilities/semantic_terminal.lua.

const std = @import("std");
const classifier = @import("classifier.zig");
const vterm_mod = @import("vterm.zig");
const Token = classifier.Token;

// ── Node identity ──────────────────────────────────────────────────

/// Compact node identifier — replaces Lua string IDs like "b:5", "r:12".
pub const NodeId = union(enum) {
    block: u16,
    row: u16,
    session_root,
    turn: u16,
    input,
    none,

    pub fn eql(a: NodeId, b: NodeId) bool {
        return switch (a) {
            .block => |v| switch (b) {
                .block => |bv| v == bv,
                else => false,
            },
            .row => |v| switch (b) {
                .row => |bv| v == bv,
                else => false,
            },
            .session_root => b == .session_root,
            .turn => |v| switch (b) {
                .turn => |bv| v == bv,
                else => false,
            },
            .input => b == .input,
            .none => b == .none,
        };
    }
};

// ── Node metadata ──────────────────────────────────────────────────

pub const Role = enum { user, assistant, system };
pub const Lane = enum { prompt, text, think, tool, result, diff, @"error", state };
pub const Scope = enum { session, turn, group };

pub fn roleOf(token: Token) Role {
    return switch (token) {
        .user_prompt, .user_text => .user,
        .thinking, .thought_complete, .assistant_text,
        .tool, .result, .diff, .@"error",
        .task_done, .task_open, .task_active, .task_summary => .assistant,
        else => .system,
    };
}

pub fn laneOf(token: Token) Lane {
    return switch (token) {
        .user_prompt, .input_zone, .input_border => .prompt,
        .user_text, .assistant_text, .output, .text => .text,
        .thinking, .thought_complete => .think,
        .tool => .tool,
        .result => .result,
        .diff => .diff,
        .@"error" => .@"error",
        else => .state,
    };
}

fn scopeOf(token: Token) Scope {
    return switch (token) {
        .banner, .status_bar, .input_zone, .input_border => .session,
        else => .turn,
    };
}

// ── Graph node ─────────────────────────────────────────────────────

pub const GraphNode = struct {
    id: NodeId = .none,
    kind: Token = .output,
    role: Role = .system,
    lane: Lane = .state,
    scope: Scope = .turn,
    parent_id: NodeId = .session_root,
    turn_id: u16 = 0,
    group_id: u16 = 0,
    row_start: u16 = 0,
    row_end: u16 = 0,
    row_count: u16 = 0,
    children_start: u16 = 0,
    children_count: u16 = 0,
    active: bool = false,
};

// ── Classified cache entry ─────────────────────────────────────────

pub const CacheEntry = struct {
    row: u16 = 0,
    kind: Token = .output,
    node_id: NodeId = .none,
    turn_id: u16 = 0,
    group_id: u16 = 0,
};

// ── Row history — transition trace per row ─────────────────────────

const MAX_HISTORY_PER_ROW = 8;

pub const HistoryEntry = struct {
    kind: Token = .output,
    frame: u32 = 0,
};

const RowHistory = struct {
    entries: [MAX_HISTORY_PER_ROW]HistoryEntry = [_]HistoryEntry{.{}} ** MAX_HISTORY_PER_ROW,
    count: u8 = 0,

    fn push(self: *RowHistory, kind: Token, frame: u32) void {
        if (self.count > 0 and self.entries[self.count - 1].kind == kind) return;
        if (self.count < MAX_HISTORY_PER_ROW) {
            self.entries[self.count] = .{ .kind = kind, .frame = frame };
            self.count += 1;
        } else {
            for (0..MAX_HISTORY_PER_ROW - 1) |i| {
                self.entries[i] = self.entries[i + 1];
            }
            self.entries[MAX_HISTORY_PER_ROW - 1] = .{ .kind = kind, .frame = frame };
        }
    }

    fn transitionCount(self: *const RowHistory) u8 {
        return self.count;
    }
};

// ── Session state (derived from graph) ─────────────────────────────

pub const SessionState = struct {
    mode: Mode = .idle,
    streaming: bool = false,
    streaming_kind: Token = .output,
    awaiting_input: bool = false,
    awaiting_decision: bool = false,
    modal_open: bool = false,
    interrupt_pending: bool = false,
    turn_count: u16 = 0,
    current_turn_id: u16 = 0,
    node_count: u16 = 0,
    group_count: u16 = 0,

    pub const Mode = enum { idle, thinking, responding, tool_use, permission, menu, picker, plan };
};

// ── Diff types ─────────────────────────────────────────────────────

pub const DiffOp = struct {
    op: Op = .add,
    node_idx: u16 = 0,
    pub const Op = enum { add, remove, update };
};

pub const StateDiff = struct {
    ops: [MAX_DIFF_OPS]DiffOp = undefined,
    op_count: u16 = 0,
    state_changed: bool = false,
};

const MAX_DIFF_OPS: u16 = 256;

// ── Graph storage ──────────────────────────────────────────────────

const MAX_NODES: u16 = 512;
const MAX_CACHE: u16 = 512;
const MAX_ROWS: u16 = 256;
const MAX_TURNS: u16 = 64;
const MAX_CHILDREN: u16 = 1024;

var nodes: [MAX_NODES]GraphNode = [_]GraphNode{.{}} ** MAX_NODES;
var node_count: u16 = 0;

var children_buf: [MAX_CHILDREN]u16 = [_]u16{0} ** MAX_CHILDREN;
var children_pos: u16 = 0;

var cache_buf: [MAX_CACHE]CacheEntry = [_]CacheEntry{.{}} ** MAX_CACHE;
var cache_count: u16 = 0;

var node_order: [MAX_NODES]u16 = [_]u16{0} ** MAX_NODES;
var node_order_count: u16 = 0;

var turn_list: [MAX_TURNS]u16 = [_]u16{0} ** MAX_TURNS;
var turn_count_storage: u16 = 0;

var row_history: [MAX_ROWS]RowHistory = [_]RowHistory{.{}} ** MAX_ROWS;

var state: SessionState = .{};
var prev_state: SessionState = .{};

var prev_node_count: u16 = 0;
var prev_nodes: [MAX_NODES]GraphNode = [_]GraphNode{.{}} ** MAX_NODES;

var frame_counter: u32 = 0;

// ── Public API ─────────────────────────────────────────────────────

pub fn getState() SessionState {
    return state;
}

pub fn getPrevState() SessionState {
    return prev_state;
}

pub fn getNode(idx: u16) ?GraphNode {
    if (idx >= node_count) return null;
    return nodes[idx];
}

pub fn nodeCount() u16 {
    return node_count;
}

pub fn getCacheEntry(idx: u16) ?CacheEntry {
    if (idx >= cache_count) return null;
    return cache_buf[idx];
}

pub fn cacheCount() u16 {
    return cache_count;
}

pub fn getFrame() u32 {
    return frame_counter;
}

pub fn getRowTransitionCount(row: u16) u8 {
    if (row >= MAX_ROWS) return 0;
    return row_history[row].transitionCount();
}

pub fn getNodeOrder() []const u16 {
    return node_order[0..node_order_count];
}

pub fn getChildren(node: GraphNode) []const u16 {
    if (node.children_count == 0) return &.{};
    return children_buf[node.children_start .. node.children_start + node.children_count];
}

pub fn getTurnList() []const u16 {
    return turn_list[0..turn_count_storage];
}

// ── Classification pipeline ────────────────────────────────────────
// Bridges vterm → classifier → classified cache.
// Port of classifyVTerm() from semantic_terminal.lua.

pub fn classify(total_rows: u16) void {
    cache_count = 0;
    var turn_id: u16 = 0;
    var group_id: u16 = 0;
    var block_id: u16 = 0;
    var block_kind: Token = .output;
    var in_block: bool = false;
    var prev_kind: Token = .output;

    var last_nonempty: u16 = 0;
    {
        var r: u16 = total_rows;
        while (r > 0) {
            r -= 1;
            const text = vterm_mod.getRowText(r);
            if (text.len > 0) {
                last_nonempty = r;
                break;
            }
        }
    }

    var row: u16 = 0;
    while (row <= last_nonempty and row < total_rows and cache_count < MAX_CACHE) : (row += 1) {
        const kind = classifier.getRowToken(row);

        if (classifier.isTurnStart(kind)) {
            turn_id += 1;
        }

        const new_group = isGroupToken(kind);
        if (new_group and kind != prev_kind) {
            group_id += 1;
        }

        const is_block = isBlockType(kind);
        var node_id: NodeId = undefined;

        if (is_block and kind == block_kind and in_block) {
            node_id = .{ .block = block_id };
        } else {
            block_id += 1;
            if (is_block) {
                block_kind = kind;
                in_block = true;
                node_id = .{ .block = block_id };
            } else {
                block_kind = .output;
                in_block = false;
                if (kind == .input_zone) {
                    node_id = .input;
                } else {
                    node_id = .{ .row = row };
                }
            }
        }

        if (row < MAX_ROWS) {
            row_history[row].push(kind, frame_counter);
        }

        cache_buf[cache_count] = .{
            .row = row,
            .kind = kind,
            .node_id = node_id,
            .turn_id = turn_id,
            .group_id = if (group_id > 0) group_id else 0,
        };
        cache_count += 1;
        prev_kind = kind;
    }
}

// ── Graph builder ──────────────────────────────────────────────────
// Multi-pass construction from classified cache.
// Port of Graph.build() from semantic_graph.lua.

pub fn build() void {
    frame_counter += 1;

    // Snapshot for diffing
    prev_state = state;
    prev_node_count = node_count;
    @memcpy(prev_nodes[0..node_count], nodes[0..node_count]);

    // Reset
    node_count = 0;
    node_order_count = 0;
    children_pos = 0;
    turn_count_storage = 0;

    // Pass 1: Group cache entries by nodeId into nodes
    var i: u16 = 0;
    while (i < cache_count) : (i += 1) {
        const entry = cache_buf[i];
        if (entry.node_id == .none) continue;

        const existing = findNodeById(entry.node_id);
        if (existing) |idx| {
            nodes[idx].row_end = entry.row;
            nodes[idx].row_count += 1;
        } else {
            if (node_count >= MAX_NODES) break;
            const scope = scopeOf(entry.kind);
            const parent_id: NodeId = if (scope == .session)
                .session_root
            else
                NodeId{ .turn = entry.turn_id };

            nodes[node_count] = .{
                .id = entry.node_id,
                .kind = entry.kind,
                .role = roleOf(entry.kind),
                .lane = laneOf(entry.kind),
                .scope = scope,
                .parent_id = parent_id,
                .turn_id = entry.turn_id,
                .group_id = entry.group_id,
                .row_start = entry.row,
                .row_end = entry.row,
                .row_count = 1,
                .active = false,
            };

            if (node_order_count < MAX_NODES) {
                node_order[node_order_count] = node_count;
                node_order_count += 1;
            }
            node_count += 1;
        }

        if (entry.turn_id > 0) {
            addTurn(entry.turn_id);
        }
    }

    // Mark last content node active
    if (node_count > 0) {
        nodes[node_count - 1].active = true;
    }

    // Pass 2: Structural containers (session root + turn roots)
    if (node_count < MAX_NODES) {
        nodes[node_count] = .{
            .id = .session_root,
            .kind = .output,
            .role = .system,
            .lane = .state,
            .scope = .session,
            .parent_id = .none,
        };
        const root_idx = node_count;
        node_count += 1;

        for (turn_list[0..turn_count_storage]) |tid| {
            if (node_count >= MAX_NODES) break;
            nodes[node_count] = .{
                .id = .{ .turn = tid },
                .kind = .output,
                .role = .system,
                .lane = .state,
                .scope = .session,
                .parent_id = .session_root,
                .turn_id = tid,
            };
            node_count += 1;
        }

        // Pass 3: Wire parent→children links
        wireChildren(root_idx);
    }

    // Pass 4: Derive session state
    state = deriveState();
}

/// Combined classify + build in one call (the per-frame tick).
pub fn tick(total_rows: u16) void {
    classify(total_rows);
    build();
}

// ── Diff engine ────────────────────────────────────────────────────
// Port of Graph.diff() from semantic_graph.lua.

pub fn computeDiff() StateDiff {
    var result = StateDiff{};

    // Added nodes
    for (0..node_count) |ci| {
        const cn = nodes[ci];
        if (cn.id == .none) continue;
        var found = false;
        for (0..prev_node_count) |pi| {
            if (prev_nodes[pi].id.eql(cn.id)) { found = true; break; }
        }
        if (!found and result.op_count < MAX_DIFF_OPS) {
            result.ops[result.op_count] = .{ .op = .add, .node_idx = @intCast(ci) };
            result.op_count += 1;
        }
    }

    // Removed nodes
    for (0..prev_node_count) |pi| {
        const pn = prev_nodes[pi];
        if (pn.id == .none) continue;
        var found = false;
        for (0..node_count) |ci| {
            if (nodes[ci].id.eql(pn.id)) { found = true; break; }
        }
        if (!found and result.op_count < MAX_DIFF_OPS) {
            result.ops[result.op_count] = .{ .op = .remove, .node_idx = @intCast(pi) };
            result.op_count += 1;
        }
    }

    // Updated nodes
    for (0..node_count) |ci| {
        const cn = nodes[ci];
        if (cn.id == .none) continue;
        for (0..prev_node_count) |pi| {
            const pn = prev_nodes[pi];
            if (pn.id.eql(cn.id)) {
                if (nodeChanged(pn, cn) and result.op_count < MAX_DIFF_OPS) {
                    result.ops[result.op_count] = .{ .op = .update, .node_idx = @intCast(ci) };
                    result.op_count += 1;
                }
                break;
            }
        }
    }

    result.state_changed = !stateEql(state, prev_state);
    return result;
}

pub fn hasDiff() bool {
    const d = computeDiff();
    return d.op_count > 0 or d.state_changed;
}

// ── Debug: format graph as text ────────────────────────────────────

pub fn formatTree(buf: []u8) []const u8 {
    var pos: usize = 0;
    const root_idx = findNodeById(.session_root) orelse return buf[0..0];
    formatNodeTree(buf, &pos, root_idx, 0);
    return buf[0..pos];
}

// ── Internal helpers ───────────────────────────────────────────────

fn findNodeById(id: NodeId) ?u16 {
    for (0..node_count) |idx| {
        if (nodes[idx].id.eql(id)) return @intCast(idx);
    }
    return null;
}

fn addTurn(tid: u16) void {
    for (turn_list[0..turn_count_storage]) |t| {
        if (t == tid) return;
    }
    if (turn_count_storage < MAX_TURNS) {
        turn_list[turn_count_storage] = tid;
        turn_count_storage += 1;
    }
}

fn wireChildren(root_idx: u16) void {
    // Turn containers → children of session root
    const root_children_start = children_pos;
    var root_child_count: u16 = 0;

    for (turn_list[0..turn_count_storage]) |tid| {
        if (findNodeById(.{ .turn = tid })) |turn_idx| {
            if (children_pos < MAX_CHILDREN) {
                children_buf[children_pos] = turn_idx;
                children_pos += 1;
                root_child_count += 1;
            }
        }
    }
    // Session-scoped content nodes → children of root
    for (node_order[0..node_order_count]) |ni| {
        if (nodes[ni].scope == .session and !nodes[ni].id.eql(.session_root)) {
            if (children_pos < MAX_CHILDREN) {
                children_buf[children_pos] = ni;
                children_pos += 1;
                root_child_count += 1;
            }
        }
    }
    nodes[root_idx].children_start = root_children_start;
    nodes[root_idx].children_count = root_child_count;

    // Content nodes → children of their turn containers
    for (turn_list[0..turn_count_storage]) |tid| {
        if (findNodeById(.{ .turn = tid })) |turn_idx| {
            const turn_children_start = children_pos;
            var tc: u16 = 0;
            for (node_order[0..node_order_count]) |ni| {
                if (nodes[ni].turn_id == tid and nodes[ni].scope != .session) {
                    if (children_pos < MAX_CHILDREN) {
                        children_buf[children_pos] = ni;
                        children_pos += 1;
                        tc += 1;
                    }
                }
            }
            nodes[turn_idx].children_start = turn_children_start;
            nodes[turn_idx].children_count = tc;
        }
    }
}

fn deriveState() SessionState {
    var s = SessionState{
        .turn_count = turn_count_storage,
        .current_turn_id = if (turn_count_storage > 0) turn_list[turn_count_storage - 1] else 0,
        .node_count = node_count,
    };

    // Count unique groups
    var max_group: u16 = 0;
    for (node_order[0..node_order_count]) |ni| {
        if (nodes[ni].group_id > max_group) max_group = nodes[ni].group_id;
    }
    s.group_count = max_group;

    // Scan content nodes — last state wins
    for (node_order[0..node_order_count]) |ni| {
        const n = nodes[ni];
        switch (n.kind) {
            .thinking => {
                s.mode = .thinking;
                s.streaming = true;
                s.streaming_kind = .thinking;
            },
            .tool => {
                s.mode = .tool_use;
                s.streaming = true;
                s.streaming_kind = .tool;
            },
            .assistant_text => {
                s.mode = .responding;
                s.streaming = true;
                s.streaming_kind = .assistant_text;
            },
            .permission => {
                s.mode = .permission;
                s.awaiting_decision = true;
                s.modal_open = true;
            },
            .menu_title, .menu_option => {
                s.mode = .menu;
                s.modal_open = true;
            },
            else => {},
        }
    }

    // Input zone present + nothing streaming/modal → idle awaiting input
    if (findNodeById(.input) != null and !s.streaming and !s.modal_open) {
        s.awaiting_input = true;
        s.mode = .idle;
    }

    // Check for interrupt prompts
    for (node_order[0..node_order_count]) |ni| {
        const n = nodes[ni];
        if (n.kind == .result and n.row_start < MAX_ROWS) {
            const text = vterm_mod.getRowText(n.row_start);
            if (std.mem.indexOf(u8, text, "Interrupted") != null) {
                s.awaiting_decision = true;
                s.interrupt_pending = true;
            }
        }
    }

    return s;
}

fn isGroupToken(kind: Token) bool {
    return switch (kind) {
        .menu_title, .menu_option, .menu_desc, .hint,
        .task_summary, .task_done, .task_open, .task_active,
        .permission => true,
        else => false,
    };
}

fn isBlockType(kind: Token) bool {
    return switch (kind) {
        .assistant_text, .user_text, .diff, .text, .output,
        .banner, .thinking, .status_bar, .input_border => true,
        else => false,
    };
}

fn nodeChanged(a: GraphNode, b: GraphNode) bool {
    return a.kind != b.kind or
        a.row_start != b.row_start or
        a.row_end != b.row_end or
        a.row_count != b.row_count or
        a.children_count != b.children_count or
        a.active != b.active;
}

fn stateEql(a: SessionState, b: SessionState) bool {
    return a.mode == b.mode and
        a.streaming == b.streaming and
        a.streaming_kind == b.streaming_kind and
        a.awaiting_input == b.awaiting_input and
        a.awaiting_decision == b.awaiting_decision and
        a.modal_open == b.modal_open and
        a.interrupt_pending == b.interrupt_pending and
        a.turn_count == b.turn_count and
        a.current_turn_id == b.current_turn_id and
        a.node_count == b.node_count and
        a.group_count == b.group_count;
}

fn formatNodeTree(buf: []u8, pos: *usize, idx: u16, depth: u16) void {
    if (idx >= node_count) return;
    const n = nodes[idx];

    // Indent
    var d: u16 = 0;
    while (d < depth and pos.* + 2 < buf.len) : (d += 1) {
        buf[pos.*] = ' ';
        pos.* += 1;
        buf[pos.*] = ' ';
        pos.* += 1;
    }

    // Node label
    const id_str = formatNodeId(n.id);
    appendStr(buf, pos, id_str);
    appendStr(buf, pos, " (");
    appendStr(buf, pos, @tagName(n.kind));
    appendStr(buf, pos, ") ");
    appendStr(buf, pos, @tagName(n.scope));
    appendStr(buf, pos, "/");
    appendStr(buf, pos, @tagName(n.role));
    appendStr(buf, pos, "/");
    appendStr(buf, pos, @tagName(n.lane));

    if (n.row_count > 0) {
        appendStr(buf, pos, " [r");
        appendU16(buf, pos, n.row_start);
        if (n.row_end != n.row_start) {
            appendStr(buf, pos, "-");
            appendU16(buf, pos, n.row_end);
        }
        appendStr(buf, pos, "]");
    }

    if (n.row_start < MAX_ROWS) {
        const tc = row_history[n.row_start].transitionCount();
        if (tc > 1) {
            appendStr(buf, pos, " (");
            appendU16(buf, pos, tc);
            appendStr(buf, pos, "x)");
        }
    }

    appendStr(buf, pos, "\n");

    // Recurse children
    if (n.children_count > 0) {
        const child_slice = children_buf[n.children_start .. n.children_start + n.children_count];
        for (child_slice) |child_idx| {
            formatNodeTree(buf, pos, child_idx, depth + 1);
        }
    }
}

fn formatNodeId(id: NodeId) []const u8 {
    return switch (id) {
        .session_root => "session:root",
        .input => "s:input",
        .none => "(none)",
        .block => "block",
        .row => "row",
        .turn => "turn",
    };
}

fn appendStr(buf: []u8, pos: *usize, s: []const u8) void {
    const avail = buf.len - pos.*;
    const copy_len = @min(s.len, avail);
    @memcpy(buf[pos.* .. pos.* + copy_len], s[0..copy_len]);
    pos.* += copy_len;
}

fn appendU16(buf: []u8, pos: *usize, val: u16) void {
    var tmp: [6]u8 = undefined;
    var n: usize = 0;
    var v = val;
    if (v == 0) {
        tmp[0] = '0';
        n = 1;
    } else {
        while (v > 0) : (n += 1) {
            tmp[n] = @intCast('0' + (v % 10));
            v /= 10;
        }
        var lo: usize = 0;
        var hi: usize = n - 1;
        while (lo < hi) {
            const t = tmp[lo];
            tmp[lo] = tmp[hi];
            tmp[hi] = t;
            lo += 1;
            hi -= 1;
        }
    }
    appendStr(buf, pos, tmp[0..n]);
}

// ── Tests ──────────────────────────────────────────────────────────

test "roleOf maps tokens correctly" {
    const testing = std.testing;
    try testing.expectEqual(Role.user, roleOf(.user_prompt));
    try testing.expectEqual(Role.user, roleOf(.user_text));
    try testing.expectEqual(Role.assistant, roleOf(.thinking));
    try testing.expectEqual(Role.assistant, roleOf(.tool));
    try testing.expectEqual(Role.assistant, roleOf(.assistant_text));
    try testing.expectEqual(Role.system, roleOf(.banner));
    try testing.expectEqual(Role.system, roleOf(.status_bar));
    try testing.expectEqual(Role.system, roleOf(.menu_title));
}

test "laneOf maps tokens correctly" {
    const testing = std.testing;
    try testing.expectEqual(Lane.prompt, laneOf(.user_prompt));
    try testing.expectEqual(Lane.text, laneOf(.assistant_text));
    try testing.expectEqual(Lane.think, laneOf(.thinking));
    try testing.expectEqual(Lane.tool, laneOf(.tool));
    try testing.expectEqual(Lane.result, laneOf(.result));
    try testing.expectEqual(Lane.diff, laneOf(.diff));
    try testing.expectEqual(Lane.state, laneOf(.banner));
}

test "NodeId equality" {
    const testing = std.testing;
    try testing.expect(NodeId.eql(.{ .block = 5 }, .{ .block = 5 }));
    try testing.expect(!NodeId.eql(.{ .block = 5 }, .{ .block = 6 }));
    try testing.expect(!NodeId.eql(.{ .block = 5 }, .{ .row = 5 }));
    try testing.expect(NodeId.eql(.session_root, .session_root));
    try testing.expect(NodeId.eql(.input, .input));
    try testing.expect(!NodeId.eql(.input, .session_root));
    try testing.expect(NodeId.eql(.{ .turn = 3 }, .{ .turn = 3 }));
}

test "RowHistory push and transition count" {
    const testing = std.testing;
    var h = RowHistory{};
    try testing.expectEqual(@as(u8, 0), h.transitionCount());

    h.push(.output, 1);
    try testing.expectEqual(@as(u8, 1), h.transitionCount());

    h.push(.output, 2);
    try testing.expectEqual(@as(u8, 1), h.transitionCount());

    h.push(.thinking, 3);
    try testing.expectEqual(@as(u8, 2), h.transitionCount());

    h.push(.assistant_text, 4);
    try testing.expectEqual(@as(u8, 3), h.transitionCount());
}

test "stateEql detects differences" {
    const testing = std.testing;
    const a = SessionState{};
    const b = SessionState{};
    try testing.expect(stateEql(a, b));

    var c = SessionState{};
    c.mode = .thinking;
    try testing.expect(!stateEql(a, c));

    var dd = SessionState{};
    dd.streaming = true;
    try testing.expect(!stateEql(a, dd));
}

test "formatTree produces output for empty graph" {
    node_count = 0;
    var buf: [256]u8 = undefined;
    const result = formatTree(&buf);
    try std.testing.expectEqual(@as(usize, 0), result.len);
}

test "isGroupToken classification" {
    const testing = std.testing;
    try testing.expect(isGroupToken(.menu_title));
    try testing.expect(isGroupToken(.permission));
    try testing.expect(isGroupToken(.task_done));
    try testing.expect(!isGroupToken(.output));
    try testing.expect(!isGroupToken(.assistant_text));
}

test "isBlockType classification" {
    const testing = std.testing;
    try testing.expect(isBlockType(.assistant_text));
    try testing.expect(isBlockType(.user_text));
    try testing.expect(isBlockType(.diff));
    try testing.expect(isBlockType(.thinking));
    try testing.expect(!isBlockType(.permission));
    try testing.expect(!isBlockType(.menu_title));
}
