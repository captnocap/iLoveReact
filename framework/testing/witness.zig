//! Witness — record human-verified interactions, replay to catch regressions.
//!
//! RECORD mode (ZIGOS_WITNESS=record):
//!   Hooks into the engine event loop. On every click that hits an interactive
//!   node, records the semantic target (debug_name / test_id / text) plus a
//!   full state snapshot before and after. On frame 5, captures the node tree
//!   with computed layout. On exit, writes to witnesses/<app>.witness.
//!
//! REPLAY mode (ZIGOS_WITNESS=replay):
//!   Reads the witness file. After layout settles, replays each recorded click
//!   by finding the target node semantically (not by coordinates), clicks via
//!   testdriver, and compares state snapshots. Reports per-action PASS/FAIL.
//!   Exits 0 if all pass, 1 if any fail.
//!
//! Usage:
//!   ZIGOS_WITNESS=record ./app          # record interactions
//!   ZIGOS_WITNESS=replay ./app          # replay and verify

const std = @import("std");
const log = @import("../diag/log.zig");
const layout = @import("../layout.zig");
const Node = layout.Node;
const testdriver = @import("driver.zig");
const query = @import("query.zig");
const gpu = @import("../gpu/gpu.zig");
const capture = @import("../gpu/capture.zig");
const input_mod = @import("../primitive/input.zig");

const page_alloc = std.heap.page_allocator;

const MAX_ACTIONS = 256;
const MAX_TREE_NODES = 2048;
const MAX_SLOTS = 64;
const MAX_TEXTS = 512; // max text nodes to track
const NAME_LEN = 128;
const TEXT_LEN = 256;

// ── Types ───────────────────────────────────────────────────────────────

const Mode = enum { off, record, replay, autotest, snapshot };

// Slot-state machinery is vestigial — the Smith-era state.zig slot system was
// retired (replaced by React's in-V8 hook state). snapshotState() returns an
// empty StateSnapshot so the recording/diffing helpers compile and behave as
// no-ops. Witness now verifies parity via the captured tree + text snapshots.
const SlotKind = enum { int, float, boolean, string };

const SlotSnapshot = struct {
    kind: SlotKind = .int,
    int_val: i64 = 0,
    float_val: f64 = 0,
    bool_val: bool = false,
    str_buf: [TEXT_LEN]u8 = undefined,
    str_len: u16 = 0,
};

const StateSnapshot = struct {
    slots: [MAX_SLOTS]SlotSnapshot = undefined,
    count: u16 = 0,
};

const TreeNode = struct {
    depth: u16 = 0,
    name_buf: [NAME_LEN]u8 = undefined,
    name_len: u8 = 0,
    text_buf: [TEXT_LEN]u8 = undefined,
    text_len: u16 = 0,
    x: f32 = 0,
    y: f32 = 0,
    w: f32 = 0,
    h: f32 = 0,
    has_handler: bool = false,
};

const TextEntry = struct {
    buf: [TEXT_LEN]u8 = undefined,
    len: u16 = 0,
};

const TextSnapshot = struct {
    texts: [MAX_TEXTS]TextEntry = undefined,
    count: u16 = 0,
};

const ActionKind = enum { click, scroll };

const Action = struct {
    frame: u32 = 0,
    kind: ActionKind = .click,
    // Target identification (semantic — survives layout changes)
    target_name: [NAME_LEN]u8 = undefined,
    target_name_len: u8 = 0,
    target_text: [TEXT_LEN]u8 = undefined,
    target_text_len: u16 = 0,
    target_x: f32 = 0, // position of clicked node — disambiguates duplicate text
    target_y: f32 = 0,
    // Scroll data
    scroll_x: f32 = 0,
    scroll_y: f32 = 0,
    mouse_x: f32 = 0,
    mouse_y: f32 = 0,
    // State after this action (both zig slots and visible text)
    state_after: StateSnapshot = .{},
    texts_after: TextSnapshot = .{},
};

// ── Module state ────────────────────────────────────────────────────────

var mode: Mode = .off;
var frame_count: u32 = 0;

// Record state
var actions: [MAX_ACTIONS]Action = undefined;
var action_count: u16 = 0;
var tree_nodes: [MAX_TREE_NODES]TreeNode = undefined;
var tree_node_count: u16 = 0;
var initial_state: StateSnapshot = .{};
var initial_texts: TextSnapshot = .{};
var tree_captured: bool = false;
var recorded_root: ?*Node = null;
var pending_text_snap: bool = false; // defer text snapshot to next frame

// Replay state
var replay_idx: u16 = 0;
var replay_tree: [MAX_TREE_NODES]TreeNode = undefined;
var replay_tree_count: u16 = 0;
var replay_actions: [MAX_ACTIONS]Action = undefined;
var replay_action_count: u16 = 0;
var replay_initial_state: StateSnapshot = .{};
var replay_initial_texts: TextSnapshot = .{};
var replay_started: bool = false;
var replay_passed: u16 = 0;
var replay_failed: u16 = 0;
var replay_settle_frame: u32 = 8;
var replay_waiting_verify: bool = false; // true = next frame should verify, not click
var replay_waiting_settle: bool = false; // true = next frame is a settle frame (scroll)

// Autotest state
const AutoStep = struct {
    kind: enum { click, expect, reject, color, bg, border, styles, type_text, key_press, focus, clear, scroll, hover, rightclick, wheel, wheelx } = .click,
    text: [TEXT_LEN]u8 = undefined,
    text_len: u16 = 0,
    occurrence: u16 = 1, // 1-based: which occurrence (#1, #2, etc.)
    expected_color: layout.Color = .{}, // for color/bg checks
    // For 'type "text" into "target"': target identifies the TextInput
    target: [TEXT_LEN]u8 = undefined,
    target_len: u16 = 0,
    // For 'key': modifier flags
    key_ctrl: bool = false,
    key_shift: bool = false,
    key_alt: bool = false,
    key_code: c_int = 0, // SDL keycode
    // For `click @x,y` / `hover @x,y` / etc. — direct coordinate addressing,
    // used when a pressable has no text/test_id label (icon-only buttons).
    use_coord: bool = false,
    coord_x: f32 = 0,
    coord_y: f32 = 0,
};
const MAX_AUTO_STEPS = 2048;
var auto_steps: [MAX_AUTO_STEPS]AutoStep = undefined;
var auto_step_count: u16 = 0;
var auto_idx: u16 = 0;
var auto_started: bool = false;
var auto_passed: u16 = 0;
var auto_failed: u16 = 0;
var auto_settle_frames: u8 = 0; // frames to wait before next action (settle + render)
var auto_capture_pending: bool = false; // waiting for GPU readback callback
var expect_did_scroll: bool = false; // set when expect auto-scrolled an ancestor — bumps next settle

// ── Expect-scroll undo log ──────────────────────────────────────────────
// `expect` may auto-scroll ancestor scroll containers so a target lands in
// the viewport for pixel verification. But subsequent steps that use
// absolute click coords (click "X" @x,y) were authored assuming the page
// was at its initial scroll position — a leftover expect-scroll shifts
// every visual element under the cursor and the click misses. Solution:
// log the original scroll_y of every container we touch from expects, then
// restore them all at the start of any non-expect step.
const ExpectScrollEntry = struct { node: *Node, original_y: f32 };
const MAX_EXPECT_SCROLL_LOG = 32;
var expect_scroll_log: [MAX_EXPECT_SCROLL_LOG]ExpectScrollEntry = undefined;
var expect_scroll_log_count: usize = 0;

fn recordExpectScroll(sp: *Node) void {
    var i: usize = 0;
    while (i < expect_scroll_log_count) : (i += 1) {
        if (expect_scroll_log[i].node == sp) return; // already recorded — keep oldest baseline
    }
    if (expect_scroll_log_count >= MAX_EXPECT_SCROLL_LOG) return;
    expect_scroll_log[expect_scroll_log_count] = .{ .node = sp, .original_y = sp.scroll_y };
    expect_scroll_log_count += 1;
}

fn restoreExpectScrolls() void {
    if (expect_scroll_log_count == 0) return;
    var i: usize = 0;
    while (i < expect_scroll_log_count) : (i += 1) {
        expect_scroll_log[i].node.scroll_y = expect_scroll_log[i].original_y;
    }
    expect_scroll_log_count = 0;
    layout.markLayoutDirty();
}

// ── Scroll-hunt state ───────────────────────────────────────────────────
// Multi-frame hunt: when the current step targets text that isn't currently
// in the layout tree (typical cause: VirtualFileTree-style virtualization,
// where rows outside the scroll viewport never mount), we scroll every
// scroll container through its range, yielding a settle frame between each
// move, until the target text shows up — or all containers are exhausted.
// Settle frames matter because virtualization needs React to re-render in
// response to the new scroll_y before query.find can see the new rows.
const MAX_HUNT_CONTAINERS = 64;
var hunt_active: bool = false;
var hunt_exhausted: bool = false;
var hunt_settle: u8 = 0;
var hunt_containers: [MAX_HUNT_CONTAINERS]*Node = undefined;
var hunt_original_scrolls: [MAX_HUNT_CONTAINERS]f32 = undefined;
var hunt_container_count: u16 = 0;
var hunt_container_idx: u16 = 0;
var hunt_text_buf: [TEXT_LEN]u8 = undefined;
var hunt_text_len: u16 = 0;
var hunt_started_for_step: bool = false;

// Track all texts ever seen during the test run (for source audit)
var auto_seen_texts: [512][64]u8 = undefined;
var auto_seen_lens: [512]u8 = undefined;
var auto_seen_count: u16 = 0;

// Style snapshot for before/after comparison
const StyleEntry = struct {
    // Node identity
    text: [64]u8 = undefined,
    text_len: u8 = 0,
    depth: u8 = 0,
    // Computed layout
    x: f32 = 0,
    y: f32 = 0,
    w: f32 = 0,
    h: f32 = 0,
    // Style properties
    padding_top: f32 = 0,
    padding_bottom: f32 = 0,
    padding_left: f32 = 0,
    padding_right: f32 = 0,
    border_radius: f32 = 0,
    border_width: f32 = 0,
    gap: f32 = 0,
    font_size: u16 = 0,
    bg_r: u8 = 0,
    bg_g: u8 = 0,
    bg_b: u8 = 0,
    has_bg: bool = false,
    tc_r: u8 = 0,
    tc_g: u8 = 0,
    tc_b: u8 = 0,
    has_tc: bool = false,
};
const MAX_STYLE_ENTRIES = 256;
var style_snap_before: [MAX_STYLE_ENTRIES]StyleEntry = undefined;
var style_snap_before_count: u16 = 0;
var style_snap_has_before: bool = false;
var auto_manifest_buf: [16384]u8 = undefined; // manifest for grid composer
var auto_manifest_len: usize = 0;

// File path
var witness_path_buf: [512]u8 = undefined;
var witness_path: ?[]const u8 = null;

// ── Init ────────────────────────────────────────────────────────────────

pub fn init(io: std.Io, environ: *const std.process.Environ.Map) void {
    const env = environ.get("ZIGOS_WITNESS") orelse return;

    if (std.mem.eql(u8, env, "record")) {
        mode = .record;
        log.print("[witness] RECORD mode — interactions will be saved\n", .{});
    } else if (std.mem.eql(u8, env, "replay")) {
        mode = .replay;
        log.print("[witness] REPLAY mode — verifying against witness file\n", .{});
    } else if (std.mem.eql(u8, env, "autotest")) {
        mode = .autotest;
        log.print("[witness] AUTOTEST mode — discovering and clicking all interactive nodes\n", .{});
    } else if (std.mem.eql(u8, env, "snapshot")) {
        mode = .snapshot;
        log.print("[witness] SNAPSHOT mode — dumping rendered text to autotest file\n", .{});
    }

    // Witness file path
    if (environ.get("ZIGOS_WITNESS_FILE")) |p| {
        if (p.len < witness_path_buf.len) {
            @memcpy(witness_path_buf[0..p.len], p);
            witness_path = witness_path_buf[0..p.len];
        }
    }

    if (mode == .replay) {
        loadWitness(io);
    } else if (mode == .autotest) {
        loadAutotest(io);
    }
}

pub fn isActive() bool {
    return mode != .off;
}

pub fn isRecording() bool {
    return mode == .record;
}

pub fn isReplaying() bool {
    return mode == .replay or mode == .autotest or mode == .snapshot;
}

/// Exit code: 0 if recording or all checks passed, 1 if any failed.
pub fn exitCode() u8 {
    if (mode == .replay and replay_failed > 0) return 1;
    if (mode == .autotest and auto_failed > 0) return 1;
    if (mode == .snapshot and snap_nil_count > 0) return 1;
    return 0;
}

// ── State snapshotting ──────────────────────────────────────────────────

fn snapshotState() StateSnapshot {
    // Slots are always empty post-state.zig retirement; see SlotKind comment.
    return .{};
}

fn statesMatch(a: *const StateSnapshot, b: *const StateSnapshot) bool {
    if (a.count != b.count) return false;
    for (0..a.count) |i| {
        if (a.slots[i].kind != b.slots[i].kind) return false;
        switch (a.slots[i].kind) {
            .int => if (a.slots[i].int_val != b.slots[i].int_val) return false,
            .float => if (@abs(a.slots[i].float_val - b.slots[i].float_val) > 0.001) return false,
            .boolean => if (a.slots[i].bool_val != b.slots[i].bool_val) return false,
            .string => {
                const sa = a.slots[i].str_buf[0..a.slots[i].str_len];
                const sb = b.slots[i].str_buf[0..b.slots[i].str_len];
                if (!std.mem.eql(u8, sa, sb)) return false;
            },
        }
    }
    return true;
}

// ── Tree snapshotting ───────────────────────────────────────────────────

fn snapshotTree(root: *Node) void {
    tree_node_count = 0;
    walkTree(root, 0);
    tree_captured = true;
}

fn walkTree(node: *Node, depth: u16) void {
    if (tree_node_count >= MAX_TREE_NODES) return;
    if (node.style.display == .none) return;

    const idx = tree_node_count;
    tree_node_count += 1;

    tree_nodes[idx] = .{};
    tree_nodes[idx].depth = depth;
    tree_nodes[idx].x = node.computed.x;
    tree_nodes[idx].y = node.computed.y;
    tree_nodes[idx].w = node.computed.w;
    tree_nodes[idx].h = node.computed.h;

    if (node.debug_name) |name| {
        const len = @min(name.len, NAME_LEN);
        @memcpy(tree_nodes[idx].name_buf[0..len], name[0..len]);
        tree_nodes[idx].name_len = @intCast(len);
    }
    if (node.text) |txt| {
        const len = @min(txt.len, TEXT_LEN);
        @memcpy(tree_nodes[idx].text_buf[0..len], txt[0..len]);
        tree_nodes[idx].text_len = @intCast(len);
    }

    const h = node.handlers;
    tree_nodes[idx].has_handler = (h.on_press != null or h.js_on_press != null or h.lua_on_press != null);

    for (node.children) |*child| {
        walkTree(child, depth + 1);
    }
}

// ── Text snapshotting (captures what the user sees) ─────────────────────

fn snapshotTexts(root: *Node) TextSnapshot {
    var snap: TextSnapshot = .{};
    collectTexts(root, &snap);
    return snap;
}

fn collectTexts(node: *Node, snap: *TextSnapshot) void {
    if (node.style.display == .none) return;
    if (snap.count >= MAX_TEXTS) return;

    if (node.text) |txt| {
        if (txt.len > 0) {
            const idx = snap.count;
            snap.count += 1;
            const len = @min(txt.len, TEXT_LEN);
            @memcpy(snap.texts[idx].buf[0..len], txt[0..len]);
            snap.texts[idx].len = @intCast(len);
        }
    }
    for (node.children) |*child| {
        collectTexts(child, snap);
    }
}

fn textsMatch(a: *const TextSnapshot, b: *const TextSnapshot) bool {
    if (a.count != b.count) return false;
    for (0..a.count) |i| {
        const at = a.texts[i].buf[0..a.texts[i].len];
        const bt = b.texts[i].buf[0..b.texts[i].len];
        if (!std.mem.eql(u8, at, bt)) return false;
    }
    return true;
}

fn printTextDiff(before: *const TextSnapshot, after: *const TextSnapshot) bool {
    var any_change = false;
    const max = @max(before.count, after.count);
    for (0..max) |i| {
        if (i >= before.count) {
            const at = after.texts[i].buf[0..after.texts[i].len];
            log.print("  + \"{s}\"\n", .{at});
            any_change = true;
            continue;
        }
        if (i >= after.count) {
            const bt = before.texts[i].buf[0..before.texts[i].len];
            log.print("  - \"{s}\"\n", .{bt});
            any_change = true;
            continue;
        }
        const bt = before.texts[i].buf[0..before.texts[i].len];
        const at = after.texts[i].buf[0..after.texts[i].len];
        if (!std.mem.eql(u8, bt, at)) {
            log.print("  \"{s}\" → \"{s}\"\n", .{ bt, at });
            any_change = true;
        }
    }
    return any_change;
}

// ── Record: click ───────────────────────────────────────────────────────

/// Called from engine.zig after a click hits an interactive node and the
/// handler has run. Records the semantic target + state snapshot.
pub fn recordClick(hit_node: *Node) void {
    if (mode != .record) return;
    if (action_count >= MAX_ACTIONS) return;

    const idx = action_count;
    action_count += 1;

    actions[idx] = .{};
    actions[idx].frame = frame_count;

    // Capture semantic target + position for disambiguation
    actions[idx].target_x = hit_node.computed.x;
    actions[idx].target_y = hit_node.computed.y;
    if (hit_node.debug_name) |name| {
        const len = @min(name.len, NAME_LEN);
        @memcpy(actions[idx].target_name[0..len], name[0..len]);
        actions[idx].target_name_len = @intCast(len);
    }
    if (hit_node.text) |txt| {
        const len = @min(txt.len, TEXT_LEN);
        @memcpy(actions[idx].target_text[0..len], txt[0..len]);
        actions[idx].target_text_len = @intCast(len);
    } else {
        // If the pressable itself has no text, check first child (common pattern)
        if (hit_node.children.len > 0) {
            if (hit_node.children[0].text) |txt| {
                const len = @min(txt.len, TEXT_LEN);
                @memcpy(actions[idx].target_text[0..len], txt[0..len]);
                actions[idx].target_text_len = @intCast(len);
            }
        }
    }

    // Zig state slots (immediate — setSlot happens synchronously)
    actions[idx].state_after = snapshotState();
    // Text snapshot is DEFERRED to next frame — tree hasn't rebuilt yet
    pending_text_snap = true;

    // Get previous snapshots for diffing zig state
    const state_before = if (idx > 0) actions[idx - 1].state_after else initial_state;

    const target_name = actions[idx].target_name[0..actions[idx].target_name_len];
    const target_text = actions[idx].target_text[0..actions[idx].target_text_len];
    log.print("[witness] click #{d}: \"{s}\" (frame {d})\n", .{
        idx,
        if (target_text.len > 0) target_text else target_name,
        frame_count,
    });

    // Print zig state slot changes (if any exist)
    const after = &actions[idx].state_after;
    var slot_change = false;
    for (0..after.count) |si| {
        if (si >= state_before.count) break;
        const a = &after.slots[si];
        const b = &state_before.slots[si];
        if (a.kind != b.kind) continue;
        switch (a.kind) {
            .int => {
                if (a.int_val != b.int_val) {
                    log.print("  slot[{d}]: {d} → {d}\n", .{ si, b.int_val, a.int_val });
                    slot_change = true;
                }
            },
            .float => {
                if (@abs(a.float_val - b.float_val) > 0.001) {
                    log.print("  slot[{d}]: {d:.2} → {d:.2}\n", .{ si, b.float_val, a.float_val });
                    slot_change = true;
                }
            },
            .boolean => {
                if (a.bool_val != b.bool_val) {
                    log.print("  slot[{d}]: {} → {}\n", .{ si, b.bool_val, a.bool_val });
                    slot_change = true;
                }
            },
            .string => {
                const sa = a.str_buf[0..a.str_len];
                const sb = b.str_buf[0..b.str_len];
                if (!std.mem.eql(u8, sa, sb)) {
                    log.print("  slot[{d}]: \"{s}\" → \"{s}\"\n", .{ si, sb, sa });
                    slot_change = true;
                }
            },
        }
    }
    if (!slot_change) {
        log.print("  (text diff next frame)\n", .{});
    }
}

// ── Record: scroll ──────────────────────────────────────────────────────

/// Called from engine.zig on mouse wheel events.
pub fn recordScroll(mx: f32, my: f32, wx: f32, wy: f32) void {
    if (mode != .record) return;
    if (action_count >= MAX_ACTIONS) return;

    const idx = action_count;
    action_count += 1;

    actions[idx] = .{};
    actions[idx].frame = frame_count;
    actions[idx].kind = .scroll;
    actions[idx].mouse_x = mx;
    actions[idx].mouse_y = my;
    actions[idx].scroll_x = wx;
    actions[idx].scroll_y = wy;

    log.print("[witness] scroll @ ({d:.0},{d:.0}) delta=({d:.1},{d:.1}) frame={d}\n", .{
        mx, my, wx, wy, frame_count,
    });

    // Scroll doesn't change state, so no text snapshot needed immediately.
    // The next click's text snapshot will capture the scrolled view.
}

// ── Tick — called every frame from engine ────────────────────────────────

/// Returns true if the app should exit (replay complete).
pub fn tick(io: std.Io, environ: *const std.process.Environ.Map, root: *Node) bool {
    frame_count += 1;

    if (mode == .record) {
        // Capture initial tree + state on frame 5 (after layout settles)
        if (frame_count == 5 and !tree_captured) {
            recorded_root = root;
            snapshotTree(root);
            initial_state = snapshotState();
            initial_texts = snapshotTexts(root);
            log.print("\n\xe2\x95\x90\xe2\x95\x90 WITNESS RECORDING \xe2\x95\x90\xe2\x95\x90\n\n", .{});
            log.print("  {d} nodes, {d} state slots\n\n", .{
                tree_node_count, initial_state.count,
            });
            // Print the full tree
            for (0..tree_node_count) |i| {
                const tn = &tree_nodes[i];
                const name = tn.name_buf[0..tn.name_len];
                const txt = tn.text_buf[0..tn.text_len];
                // Indent by depth
                var pad: [64]u8 = undefined;
                const pad_len = @min(tn.depth * 2, 62);
                for (0..pad_len) |pi| pad[pi] = ' ';
                const vis: []const u8 = if (tn.w <= 0 or tn.h <= 0) " !! ZERO" else "";
                if (txt.len > 0) {
                    log.print("  {s}{s}  {d:.0}x{d:.0} @ ({d:.0},{d:.0}){s}  \"{s}\"\n", .{
                        pad[0..pad_len], if (name.len > 0) name else "?",
                        tn.w,            tn.h,
                        tn.x,            tn.y,
                        vis,             txt,
                    });
                } else {
                    log.print("  {s}{s}  {d:.0}x{d:.0} @ ({d:.0},{d:.0}){s}{s}\n", .{
                        pad[0..pad_len], if (name.len > 0) name else "?",
                        tn.w,            tn.h,
                        tn.x,            tn.y,
                        vis,             if (tn.has_handler) " [pressable]" else "",
                    });
                }
            }
            // Print initial state
            if (initial_state.count > 0) {
                log.print("\n  State:\n", .{});
                for (0..initial_state.count) |i| {
                    const s = &initial_state.slots[i];
                    switch (s.kind) {
                        .int => log.print("    slot[{d}]: {d}\n", .{ i, s.int_val }),
                        .float => log.print("    slot[{d}]: {d:.2}\n", .{ i, s.float_val }),
                        .boolean => log.print("    slot[{d}]: {}\n", .{ i, s.bool_val }),
                        .string => log.print("    slot[{d}]: \"{s}\"\n", .{ i, s.str_buf[0..s.str_len] }),
                    }
                }
            }
            log.print("\n  Interact with the app. Close window to save.\n\n", .{});
        }

        // Deferred text snapshot: capture text on the frame AFTER a click
        // (tree rebuilds between frames, so text reflects the new state now)
        if (pending_text_snap and action_count > 0) {
            pending_text_snap = false;
            const idx = action_count - 1;
            actions[idx].texts_after = snapshotTexts(root);

            // Print text diff
            const texts_before = if (idx > 0) &actions[idx - 1].texts_after else &initial_texts;
            const text_changed = printTextDiff(texts_before, &actions[idx].texts_after);
            if (!text_changed) {
                log.print("  (no visible change)\n", .{});
            }
        }

        return false;
    }

    if (mode == .replay) {
        return replayTick(root);
    }

    if (mode == .autotest) {
        return autotestTick(io, environ, root);
    }

    if (mode == .snapshot) {
        return snapshotTick(io, root);
    }

    return false;
}

// ── Replay logic ────────────────────────────────────────────────────────

fn replayTick(root: *Node) bool {
    // Wait for layout to settle
    if (frame_count < replay_settle_frame) return false;

    // On settle frame: verify initial state and print what we're checking
    if (!replay_started) {
        replay_started = true;
        log.print("\n\xe2\x95\x90\xe2\x95\x90 WITNESS REPLAY \xe2\x95\x90\xe2\x95\x90\n\n", .{});
        log.print("  {d} tree nodes, {d} text strings, {d} actions to replay\n\n", .{
            replay_tree_count, replay_initial_texts.count, replay_action_count,
        });

        // Show and verify initial visible text
        if (replay_initial_texts.count > 0) {
            const current_texts = snapshotTexts(root);
            log.print("  ── Initial text ──\n", .{});
            for (0..replay_initial_texts.count) |i| {
                const expected = replay_initial_texts.texts[i].buf[0..replay_initial_texts.texts[i].len];
                if (i < current_texts.count) {
                    const actual = current_texts.texts[i].buf[0..current_texts.texts[i].len];
                    if (std.mem.eql(u8, expected, actual)) {
                        log.print("    \xe2\x9c\x93 \"{s}\"\n", .{actual});
                    } else {
                        log.print("    \xe2\x9c\x97 expected \"{s}\", got \"{s}\"\n", .{ expected, actual });
                    }
                } else {
                    log.print("    \xe2\x9c\x97 expected \"{s}\", MISSING\n", .{expected});
                }
            }
            if (textsMatch(&replay_initial_texts, &current_texts)) {
                log.print("  initial text ... PASS\n\n", .{});
                replay_passed += 1;
            } else {
                log.print("  initial text ... FAIL\n\n", .{});
                replay_failed += 1;
            }
        }

        // Verify tree node count
        var live_count: u16 = 0;
        countLiveNodes(root, &live_count);
        if (replay_tree_count > 0) {
            const diff = if (live_count > replay_tree_count) live_count - replay_tree_count else replay_tree_count - live_count;
            if (diff <= 2) {
                log.print("  tree structure ({d} nodes) ... PASS\n", .{live_count});
                replay_passed += 1;
            } else {
                log.print("  tree structure ... FAIL (expected {d} nodes, got {d})\n", .{ replay_tree_count, live_count });
                replay_failed += 1;
            }
        }

        // Verify initial zig state slots (if any)
        if (replay_initial_state.count > 0) {
            const current = snapshotState();
            if (statesMatch(&replay_initial_state, &current)) {
                log.print("  initial state ({d} slots) ... PASS\n", .{replay_initial_state.count});
                replay_passed += 1;
            } else {
                log.print("  initial state ... FAIL\n", .{});
                printStateDiff(&replay_initial_state, &current);
                replay_failed += 1;
            }
        }

        if (replay_action_count == 0) {
            return finishReplay();
        }
        log.print("\n  ── Replaying {d} clicks ──\n", .{replay_action_count});
    }

    // Verify frame: check text from PREVIOUS click (one frame delay for tree rebuild)
    if (replay_waiting_verify and replay_idx > 0) {
        replay_waiting_verify = false;
        const prev = &replay_actions[replay_idx - 1];
        if (prev.texts_after.count > 0) {
            const current_texts = snapshotTexts(root);
            if (textsMatch(&prev.texts_after, &current_texts)) {
                log.print(" ... PASS\n", .{});
                replay_passed += 1;
            } else {
                log.print(" ... FAIL\n", .{});
                _ = printTextDiff(&prev.texts_after, &current_texts);
                replay_failed += 1;
            }
        } else {
            log.print(" ... PASS (no text baseline)\n", .{});
            replay_passed += 1;
        }

        // If that was the last action, we're done
        if (replay_idx >= replay_action_count) {
            return finishReplay();
        }
    }

    // Wait for scroll to settle (SDL event queue needs a frame to process)
    if (replay_waiting_settle) {
        replay_waiting_settle = false;
        // If that was the last action, finish
        if (replay_idx >= replay_action_count) {
            return finishReplay();
        }
        return false;
    }

    // Execute next action
    if (replay_idx < replay_action_count and !replay_waiting_verify) {
        const action = &replay_actions[replay_idx];

        if (action.kind == .scroll) {
            // Scroll: send wheel event with mouse position
            testdriver.scrollAt(action.scroll_x, action.scroll_y, action.mouse_x, action.mouse_y);
            log.print("  [{d}/{d}] scroll ({d:.1},{d:.1}) @ ({d:.0},{d:.0})\n", .{
                replay_idx + 1,  replay_action_count,
                action.scroll_x, action.scroll_y,
                action.mouse_x,  action.mouse_y,
            });
            replay_idx += 1;
            replay_waiting_settle = true; // wait 1 frame for SDL to process
            return false;
        }

        // Click action
        const target_name = action.target_name[0..action.target_name_len];
        const target_text = action.target_text[0..action.target_text_len];
        const label = if (target_text.len > 0) target_text else target_name;

        // Find and click the target node
        var clicked = false;
        if (target_name.len > 0) {
            clicked = testdriver.clickNode(root, .{ .debug_name = target_name });
        }
        if (!clicked and target_text.len > 0) {
            // Find all text matches and use position to disambiguate.
            // Text nodes don't have handlers — clicking their coordinates
            // lets the engine hit-test up to the Pressable parent.
            var results: [32]query.QueryResult = undefined;
            const found = query.findAll(root, .{ .text_contains = target_text }, &results);
            if (found > 1 and (action.target_x != 0 or action.target_y != 0)) {
                var best: usize = 0;
                var best_dist = dist2d(results[0].x, results[0].y, action.target_x, action.target_y);
                for (1..found) |fi| {
                    const d = dist2d(results[fi].x, results[fi].y, action.target_x, action.target_y);
                    if (d < best_dist) {
                        best_dist = d;
                        best = fi;
                    }
                }
                testdriver.click(results[best].cx, results[best].cy);
                clicked = true;
            } else if (found > 0) {
                testdriver.click(results[0].cx, results[0].cy);
                clicked = true;
            }
        }

        log.print("  [{d}/{d}] click \"{s}\"", .{ replay_idx + 1, replay_action_count, label });
        if (!clicked) {
            log.print(" ... FAIL (node not found)\n", .{});
            replay_failed += 1;
        }

        replay_idx += 1;
        replay_waiting_verify = true; // verify on next frame
    }

    return false;
}

fn countLiveNodes(node: *Node, count: *u16) void {
    if (node.style.display == .none) return;
    count.* += 1;
    for (node.children) |*child| {
        countLiveNodes(child, count);
    }
}

// ── Autotest logic ─────────────────────────────────────────────────────

fn loadAutotest(io: std.Io) void {
    const path = witness_path orelse {
        log.print("[autotest] ERROR: no test file (set ZIGOS_WITNESS_FILE)\n", .{});
        return;
    };
    const file = std.Io.Dir.cwd().openFile(io, path, .{}) catch {
        log.print("[autotest] ERROR: cannot open {s}\n", .{path});
        return;
    };
    defer file.close(io);

    // Must fit the entire .autotest file. Sweatshop-scale snapshots emit
    // ~800 steps / ~30KB; leave headroom for growth.
    var buf: [262144]u8 = undefined;
    const len = file.readPositionalAll(io, &buf, 0) catch return;
    const content = buf[0..len];

    var lines = std.mem.splitScalar(u8, content, '\n');
    while (lines.next()) |raw_line| {
        if (auto_step_count >= MAX_AUTO_STEPS) break;
        // Trim carriage return
        const line = if (raw_line.len > 0 and raw_line[raw_line.len - 1] == '\r') raw_line[0 .. raw_line.len - 1] else raw_line;
        // Skip empty lines and comments
        if (line.len == 0) continue;
        if (line[0] == '#') continue;

        const idx = auto_step_count;
        auto_steps[idx] = .{};

        // Parse: click "text" [#N]
        //        expect "text"
        //        reject "text"
        if (std.mem.startsWith(u8, line, "click ")) {
            auto_steps[idx].kind = .click;
            parseAutoText(line[6..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "hover ")) {
            auto_steps[idx].kind = .hover;
            parseAutoText(line[6..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "rightclick ")) {
            auto_steps[idx].kind = .rightclick;
            parseAutoText(line[11..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "wheelx ")) {
            auto_steps[idx].kind = .wheelx;
            parseAutoText(line[7..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "wheel ")) {
            auto_steps[idx].kind = .wheel;
            parseAutoText(line[6..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "expect ")) {
            auto_steps[idx].kind = .expect;
            parseAutoText(line[7..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "reject ")) {
            auto_steps[idx].kind = .reject;
            parseAutoText(line[7..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "color ")) {
            auto_steps[idx].kind = .color;
            parseAutoTextWithColor(line[6..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "bg ")) {
            auto_steps[idx].kind = .bg;
            parseAutoTextWithColor(line[3..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "border ")) {
            auto_steps[idx].kind = .border;
            parseAutoTextWithColor(line[7..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "styles ")) {
            auto_steps[idx].kind = .styles;
            // Store "before" or "after" as the text field
            const label = line[7..];
            const copy_len = @min(label.len, TEXT_LEN);
            @memcpy(auto_steps[idx].text[0..copy_len], label[0..copy_len]);
            auto_steps[idx].text_len = @intCast(copy_len);
        } else if (std.mem.startsWith(u8, line, "type ")) {
            auto_steps[idx].kind = .type_text;
            parseTypeCommand(line[5..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "key ")) {
            auto_steps[idx].kind = .key_press;
            parseKeyCommand(line[4..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "focus ")) {
            auto_steps[idx].kind = .focus;
            parseAutoText(line[6..], &auto_steps[idx]);
        } else if (std.mem.startsWith(u8, line, "scroll ")) {
            auto_steps[idx].kind = .scroll;
            parseAutoText(line[7..], &auto_steps[idx]);
        } else if (std.mem.eql(u8, line, "clear")) {
            auto_steps[idx].kind = .clear;
            // No text needed — operates on focused input
            auto_steps[idx].text_len = 5;
            @memcpy(auto_steps[idx].text[0..5], "clear");
        } else {
            continue; // unknown line, skip
        }

        if (auto_steps[idx].text_len > 0) {
            auto_step_count += 1;
        }
    }

    log.print("[autotest] loaded {d} steps from {s}\n", .{ auto_step_count, path });
}

fn parseAutoText(rest: []const u8, step: *AutoStep) void {
    // Parse any of:
    //   "text"              — find by text
    //   "text" #N           — find by text, pick Nth occurrence
    //   @x,y                — direct coordinate click (icon-only buttons)
    //   "Name" @x,y         — hybrid: "Name" labels the click for humans/proof
    //                         grid, @x,y is the actual replay target. Emitted
    //                         when the reconciler can resolve a debugName for
    //                         an icon-only pressable.
    // parseTail handles the trailing `@x,y` (if present) and `#N`.
    const trimmed_lead = std.mem.trimStart(u8, rest, " \t");
    if (trimmed_lead.len > 0 and trimmed_lead[0] == '@') {
        parseCoordTail(trimmed_lead, step);
        if (step.use_coord) {
            // Store full "@x,y" as the display label for logs/manifest.
            const label_len = std.mem.indexOfScalarPos(u8, trimmed_lead, 0, ' ') orelse trimmed_lead.len;
            const copy_len = @min(label_len, TEXT_LEN);
            @memcpy(step.text[0..copy_len], trimmed_lead[0..copy_len]);
            step.text_len = @intCast(copy_len);
        }
        return;
    }

    // Parse: "text" [@x,y] [#N]
    // Find opening quote
    const q1 = std.mem.indexOfScalar(u8, rest, '"') orelse return;
    const after_q1 = rest[q1 + 1 ..];
    const q2 = std.mem.indexOfScalar(u8, after_q1, '"') orelse return;
    const text = after_q1[0..q2];
    const copy_len = @min(text.len, TEXT_LEN);
    @memcpy(step.text[0..copy_len], text[0..copy_len]);
    step.text_len = @intCast(copy_len);

    // Check for optional `@x,y` (coord-override, used with a human-readable
    // label) and `#N` (occurrence index) after the closing quote.
    const after_text = after_q1[q2 + 1 ..];
    const at_marker = std.mem.indexOfScalar(u8, after_text, '@');
    if (at_marker) |pos| {
        parseCoordTail(after_text[pos..], step);
    }
    if (std.mem.indexOf(u8, after_text, "#")) |hash| {
        const num_start = after_text[hash + 1 ..];
        var end: usize = 0;
        while (end < num_start.len and num_start[end] >= '0' and num_start[end] <= '9') : (end += 1) {}
        if (end > 0) {
            step.occurrence = std.fmt.parseInt(u16, num_start[0..end], 10) catch 1;
        }
    }
}

/// Parse `@<x>,<y>` into step.coord_x/coord_y, setting use_coord. Caller passes
/// a slice starting at the `@`; no-op if the tail doesn't look like a coord.
fn parseCoordTail(tail: []const u8, step: *AutoStep) void {
    if (tail.len < 3 or tail[0] != '@') return;
    const body = tail[1..];
    const comma = std.mem.indexOfScalar(u8, body, ',') orelse return;
    const x_str = std.mem.trim(u8, body[0..comma], " \t");
    const y_rest = body[comma + 1 ..];
    var y_end: usize = 0;
    while (y_end < y_rest.len) : (y_end += 1) {
        const c = y_rest[y_end];
        if (!(c == '-' or c == '.' or c == '+' or (c >= '0' and c <= '9'))) break;
    }
    const y_str = std.mem.trim(u8, y_rest[0..y_end], " \t");
    const x = std.fmt.parseFloat(f32, x_str) catch return;
    const y = std.fmt.parseFloat(f32, y_str) catch return;
    step.use_coord = true;
    step.coord_x = x;
    step.coord_y = y;
}

fn parseAutoTextWithColor(rest: []const u8, step: *AutoStep) void {
    // Parse: "text" #RRGGBB
    parseAutoText(rest, step);
    // Find #RRGGBB after closing quote
    const q1 = std.mem.indexOfScalar(u8, rest, '"') orelse return;
    const after_q1 = rest[q1 + 1 ..];
    const q2 = std.mem.indexOfScalar(u8, after_q1, '"') orelse return;
    const after_text = after_q1[q2 + 1 ..];
    if (std.mem.indexOf(u8, after_text, "#")) |hash_pos| {
        const hex = after_text[hash_pos..];
        if (hex.len >= 7) {
            step.expected_color = layout.Color.fromHex(hex[0..7]);
        }
    }
}

/// Parse: type "text to type" [into "placeholder"]
fn parseTypeCommand(rest: []const u8, step: *AutoStep) void {
    // First quoted string = text to type
    parseAutoText(rest, step);
    // Look for 'into "target"'
    const q1 = std.mem.indexOfScalar(u8, rest, '"') orelse return;
    const after_q1 = rest[q1 + 1 ..];
    const q2 = std.mem.indexOfScalar(u8, after_q1, '"') orelse return;
    const after_first = after_q1[q2 + 1 ..];
    if (std.mem.indexOf(u8, after_first, "into ")) |into_pos| {
        const target_rest = after_first[into_pos + 5 ..];
        const tq1 = std.mem.indexOfScalar(u8, target_rest, '"') orelse return;
        const target_after = target_rest[tq1 + 1 ..];
        const tq2 = std.mem.indexOfScalar(u8, target_after, '"') orelse return;
        const target = target_after[0..tq2];
        const tlen = @min(target.len, TEXT_LEN);
        @memcpy(step.target[0..tlen], target[0..tlen]);
        step.target_len = @intCast(tlen);
    }
}

/// Parse: key "ctrl+s", key "escape", key "enter", key "f3"
/// Resolves to SDL keycodes + modifier flags
fn parseKeyCommand(rest: []const u8, step: *AutoStep) void {
    parseAutoText(rest, step);
    const text = step.text[0..step.text_len];

    // Split on + and resolve modifiers + key
    var remaining: []const u8 = text;
    step.key_code = 0;
    step.key_ctrl = false;
    step.key_shift = false;
    step.key_alt = false;

    while (remaining.len > 0) {
        const plus = std.mem.indexOfScalar(u8, remaining, '+');
        const part = if (plus) |p| remaining[0..p] else remaining;
        remaining = if (plus) |p| remaining[p + 1 ..] else "";

        if (std.mem.eql(u8, part, "ctrl") or std.mem.eql(u8, part, "control")) {
            step.key_ctrl = true;
        } else if (std.mem.eql(u8, part, "shift")) {
            step.key_shift = true;
        } else if (std.mem.eql(u8, part, "alt")) {
            step.key_alt = true;
        } else {
            step.key_code = resolveKeyName(part);
        }
    }
}

/// Map key names to SDL keycodes (SDLK_*)
fn resolveKeyName(name: []const u8) c_int {
    const ci = @import("../c.zig").imports;
    if (name.len == 1) {
        // Single character: a-z maps to SDLK_a..SDLK_z
        const ch = name[0];
        if (ch >= 'a' and ch <= 'z') return @as(c_int, ch);
        if (ch >= '0' and ch <= '9') return @as(c_int, ch);
    }
    if (std.mem.eql(u8, name, "enter") or std.mem.eql(u8, name, "return")) return ci.SDLK_RETURN;
    if (std.mem.eql(u8, name, "escape") or std.mem.eql(u8, name, "esc")) return ci.SDLK_ESCAPE;
    if (std.mem.eql(u8, name, "backspace")) return ci.SDLK_BACKSPACE;
    if (std.mem.eql(u8, name, "tab")) return ci.SDLK_TAB;
    if (std.mem.eql(u8, name, "space")) return ci.SDLK_SPACE;
    if (std.mem.eql(u8, name, "delete") or std.mem.eql(u8, name, "del")) return ci.SDLK_DELETE;
    if (std.mem.eql(u8, name, "up")) return ci.SDLK_UP;
    if (std.mem.eql(u8, name, "down")) return ci.SDLK_DOWN;
    if (std.mem.eql(u8, name, "left")) return ci.SDLK_LEFT;
    if (std.mem.eql(u8, name, "right")) return ci.SDLK_RIGHT;
    if (std.mem.eql(u8, name, "home")) return ci.SDLK_HOME;
    if (std.mem.eql(u8, name, "end")) return ci.SDLK_END;
    if (std.mem.eql(u8, name, "f1")) return ci.SDLK_F1;
    if (std.mem.eql(u8, name, "f2")) return ci.SDLK_F2;
    if (std.mem.eql(u8, name, "f3")) return ci.SDLK_F3;
    if (std.mem.eql(u8, name, "f4")) return ci.SDLK_F4;
    if (std.mem.eql(u8, name, "f5")) return ci.SDLK_F5;
    if (std.mem.eql(u8, name, "f6")) return ci.SDLK_F6;
    if (std.mem.eql(u8, name, "f7")) return ci.SDLK_F7;
    if (std.mem.eql(u8, name, "f8")) return ci.SDLK_F8;
    if (std.mem.eql(u8, name, "f9")) return ci.SDLK_F9;
    if (std.mem.eql(u8, name, "f10")) return ci.SDLK_F10;
    if (std.mem.eql(u8, name, "f11")) return ci.SDLK_F11;
    if (std.mem.eql(u8, name, "f12")) return ci.SDLK_F12;
    if (std.mem.eql(u8, name, "grave") or std.mem.eql(u8, name, "`")) return ci.SDLK_GRAVE;
    return 0;
}

/// Find a TextInput node by matching its placeholder text, current text content,
/// or a text node nearby (e.g., a sibling label). Returns a clickable QueryResult.
fn findTextInput(root: *Node, search_text: []const u8) ?query.QueryResult {
    return findTextInputWalk(root, search_text, 0);
}

/// Walk the tree to find the nearest scroll container ancestor of `target`.
fn findScrollParent(node: *Node, target: *Node) ?*Node {
    return findScrollParentWalk(node, target, null);
}

fn findScrollParentWalk(node: *Node, target: *Node, current_scroll: ?*Node) ?*Node {
    const ov = node.style.overflow;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > node.computed.h));
    const new_scroll = if (is_scroll) node else current_scroll;
    if (node == target) return if (new_scroll) |s| s else null;
    for (node.children) |*child| {
        if (findScrollParentWalk(child, target, new_scroll)) |result| return result;
    }
    return null;
}

fn isScrollContainer(node: *const Node) bool {
    const ov = node.style.overflow;
    if (ov == .scroll) return node.content_height > node.computed.h;
    if (ov == .auto) return node.content_height > node.computed.h;
    return false;
}

/// Walk the path root→target and collect every scroll-container ancestor
/// (overflow=scroll, or overflow=auto with content overflow) into `out`.
/// Returns the count, ordered outermost-first. `false` if target not found.
fn collectScrollAncestors(node: *Node, target: *Node, out: []*Node, count: *usize) bool {
    if (node == target) return true;
    const before = count.*;
    if (isScrollContainer(node) and count.* < out.len) {
        out[count.*] = node;
        count.* += 1;
    }
    for (node.children) |*child| {
        if (collectScrollAncestors(child, target, out, count)) return true;
    }
    // Target wasn't under this subtree — pop the tentative entry.
    count.* = before;
    return false;
}

/// Walk every scroll-container ancestor of `target` and adjust each one's
/// `scroll_y` so `target` ends up inside that container's visible window.
/// Necessary because a target can be visible inside its innermost scroll
/// parent (whose content fits) yet still clipped by an OUTER scroll parent
/// (e.g. the page's main ScrollView). Returns true if any container moved.
///
/// Used by the `expect` step so text below a ScrollView's fold passes pixel
/// verification — the autotest nudges the scroll, settles, then the next
/// captured screenshot sees the element in the viewport.
fn scrollNodeIntoView(root: *Node, target: *Node) bool {
    var ancestors: [16]*Node = undefined;
    var n: usize = 0;
    if (!collectScrollAncestors(root, target, &ancestors, &n)) return false;
    if (n == 0) return false;

    const target_y = target.computed.y;
    const target_h = target.computed.h;
    var any_scrolled: bool = false;

    var i: usize = 0;
    while (i < n) : (i += 1) {
        const sp = ancestors[i];
        const scroll_top = sp.computed.y;
        const scroll_h = sp.computed.h;
        const visible_top = scroll_top + sp.scroll_y;
        const visible_bottom = visible_top + scroll_h;
        if (target_y >= visible_top and (target_y + target_h) <= visible_bottom) continue;

        recordExpectScroll(sp);
        if (target_y + target_h > visible_bottom) {
            sp.scroll_y = target_y + target_h - scroll_top - scroll_h + 20;
        } else if (target_y < visible_top) {
            sp.scroll_y = target_y - scroll_top - 10;
        }
        if (sp.scroll_y < 0) sp.scroll_y = 0;
        const max_scroll = @max(0.0, sp.content_height - sp.computed.h);
        if (sp.scroll_y > max_scroll) sp.scroll_y = max_scroll;
        any_scrolled = true;
    }

    if (any_scrolled) layout.markLayoutDirty();
    return any_scrolled;
}

fn collectScrollContainersRecurse(node: *Node) void {
    if (hunt_container_count >= MAX_HUNT_CONTAINERS) return;
    if (isScrollContainer(node)) {
        hunt_containers[hunt_container_count] = node;
        hunt_original_scrolls[hunt_container_count] = node.scroll_y;
        hunt_container_count += 1;
    }
    for (node.children) |*child| collectScrollContainersRecurse(child);
}

/// Returns true if a step of this kind wants to locate a named target in the
/// tree. Hunt only makes sense for these — `reject`, `key_press`, and `clear`
/// don't need a target to find.
fn stepNeedsTextTarget(kind: anytype) bool {
    return switch (kind) {
        .click, .hover, .rightclick, .wheel, .wheelx, .expect, .scroll, .color, .bg, .border, .styles, .focus, .type_text => true,
        else => false,
    };
}

/// Begin a scroll hunt for `text`. Snapshots the current scroll_y of every
/// scroll container (so a hunt that fails can roll the UI back), resets them
/// all to zero, then lets huntTick walk each one through its range. If the
/// hunt eventually locates the text, scroll positions stay where they are so
/// the subsequent click/expect lands on the now-visible node.
fn startHunt(root: *Node, text: []const u8) void {
    hunt_container_count = 0;
    collectScrollContainersRecurse(root);

    hunt_text_len = @intCast(@min(text.len, TEXT_LEN));
    @memcpy(hunt_text_buf[0..hunt_text_len], text[0..hunt_text_len]);

    // Start every container at 0 so the hunt covers the whole range.
    for (hunt_containers[0..hunt_container_count]) |c| c.scroll_y = 0;

    hunt_container_idx = 0;
    hunt_settle = 3; // let React re-render virtualized rows before first check
    hunt_active = true;
    hunt_exhausted = (hunt_container_count == 0);
    layout.markLayoutDirty();

    log.print("  [hunt] target \"{s}\" not in tree — scanning {d} scroll container(s)\n", .{ text, hunt_container_count });
}

/// Called on every tick while `hunt_active`. Returns true the moment the
/// target text appears in the tree (caller should stop hunting and execute
/// the pending step). Returns false otherwise; when all scroll containers
/// have been walked, sets `hunt_exhausted` and restores original scrolls.
fn huntTick(root: *Node) bool {
    if (hunt_settle > 0) {
        hunt_settle -= 1;
        return false;
    }
    const text = hunt_text_buf[0..hunt_text_len];
    if (query.find(root, .{ .text_contains = text }) != null) {
        log.print("  [hunt] found \"{s}\" after scrolling\n", .{text});
        return true;
    }
    if (hunt_container_idx >= hunt_container_count) {
        // Ran out of containers to try — restore original scroll positions
        // so we don't leave the UI in an arbitrary scrolled state that would
        // make every subsequent step fail too.
        for (hunt_containers[0..hunt_container_count], 0..) |c, i| c.scroll_y = hunt_original_scrolls[i];
        layout.markLayoutDirty();
        hunt_exhausted = true;
        log.print("  [hunt] exhausted — \"{s}\" not reachable\n", .{text});
        return false;
    }

    const c = hunt_containers[hunt_container_idx];
    const viewport = if (c.computed.h > 0) c.computed.h else 100.0;
    const step_px = @max(viewport * 0.9, 40.0);
    const max_scroll: f32 = if (c.content_height > c.computed.h) c.content_height - c.computed.h else 0.0;

    if (c.scroll_y < max_scroll) {
        c.scroll_y = @min(c.scroll_y + step_px, max_scroll);
    } else {
        // Container fully walked — reset it and advance.
        c.scroll_y = hunt_original_scrolls[hunt_container_idx];
        hunt_container_idx += 1;
        if (hunt_container_idx < hunt_container_count) {
            hunt_containers[hunt_container_idx].scroll_y = 0;
        }
    }
    layout.markLayoutDirty();
    hunt_settle = 3;
    return false;
}

fn findTextInputWalk(node: *Node, search_text: []const u8, scroll_y: f32) ?query.QueryResult {
    if (node.style.display == .none) return null;

    // Check if this node IS a TextInput and matches the search text
    if (node.input_id) |input_id| {
        // Match against the live native buffer first, then fall back to bound text
        // and placeholder values when the input is currently empty.
        const live_text = input_mod.getText(input_id);
        if (live_text.len > 0 and std.mem.indexOf(u8, live_text, search_text) != null) {
            return query.QueryResult{
                .node = node,
                .x = node.computed.x,
                .y = node.computed.y - scroll_y,
                .w = node.computed.w,
                .h = node.computed.h,
                .cx = node.computed.x + node.computed.w / 2.0,
                .cy = node.computed.y - scroll_y + node.computed.h / 2.0,
            };
        }
        if (node.text) |txt| {
            if (txt.len > 0 and std.mem.indexOf(u8, txt, search_text) != null) {
                return query.QueryResult{
                    .node = node,
                    .x = node.computed.x,
                    .y = node.computed.y - scroll_y,
                    .w = node.computed.w,
                    .h = node.computed.h,
                    .cx = node.computed.x + node.computed.w / 2.0,
                    .cy = node.computed.y - scroll_y + node.computed.h / 2.0,
                };
            }
        }
        if (node.placeholder) |txt| {
            if (txt.len > 0 and std.mem.indexOf(u8, txt, search_text) != null) {
                return query.QueryResult{
                    .node = node,
                    .x = node.computed.x,
                    .y = node.computed.y - scroll_y,
                    .w = node.computed.w,
                    .h = node.computed.h,
                    .cx = node.computed.x + node.computed.w / 2.0,
                    .cy = node.computed.y - scroll_y + node.computed.h / 2.0,
                };
            }
        }
        // Also match against the debug_name
        if (node.debug_name) |dn| {
            if (std.mem.indexOf(u8, dn, search_text) != null) {
                return query.QueryResult{
                    .node = node,
                    .x = node.computed.x,
                    .y = node.computed.y - scroll_y,
                    .w = node.computed.w,
                    .h = node.computed.h,
                    .cx = node.computed.x + node.computed.w / 2.0,
                    .cy = node.computed.y - scroll_y + node.computed.h / 2.0,
                };
            }
        }
    }

    const child_scroll = scroll_y + node.scroll_y;
    for (node.children) |*child| {
        if (findTextInputWalk(child, search_text, child_scroll)) |result| return result;
    }
    return null;
}

/// Find the first TextInput node in the tree (any input_id).
fn findFirstTextInput(root: *Node) ?query.QueryResult {
    return findFirstTextInputWalk(root, 0);
}

fn findFirstTextInputWalk(node: *Node, scroll_y: f32) ?query.QueryResult {
    if (node.style.display == .none) return null;
    if (node.input_id != null) {
        return query.QueryResult{
            .node = node,
            .x = node.computed.x,
            .y = node.computed.y - scroll_y,
            .w = node.computed.w,
            .h = node.computed.h,
            .cx = node.computed.x + node.computed.w / 2.0,
            .cy = node.computed.y - scroll_y + node.computed.h / 2.0,
        };
    }
    const child_scroll = scroll_y + node.scroll_y;
    for (node.children) |*child| {
        if (findFirstTextInputWalk(child, child_scroll)) |result| return result;
    }
    return null;
}

fn findActionTargets(root: *Node, label: []const u8, out: []query.QueryResult) usize {
    const by_test_id = query.findAll(root, .{ .test_id = label }, out);
    if (by_test_id > 0) return by_test_id;

    const by_debug_name = query.findAll(root, .{ .debug_name = label }, out);
    if (by_debug_name > 0) return by_debug_name;

    return query.findAll(root, .{ .text_contains = label }, out);
}

fn findActionTarget(root: *Node, label: []const u8, occurrence: u16) ?query.QueryResult {
    var results: [32]query.QueryResult = undefined;
    const found = findActionTargets(root, label, &results);
    if (occurrence == 0 or occurrence > found) return null;
    return results[occurrence - 1];
}

fn colorToHex(col: layout.Color, buf: *[7]u8) []const u8 {
    const hex_chars = "0123456789abcdef";
    buf[0] = '#';
    buf[1] = hex_chars[col.r >> 4];
    buf[2] = hex_chars[col.r & 0xf];
    buf[3] = hex_chars[col.g >> 4];
    buf[4] = hex_chars[col.g & 0xf];
    buf[5] = hex_chars[col.b >> 4];
    buf[6] = hex_chars[col.b & 0xf];
    return buf[0..7];
}

fn colorEql(a: layout.Color, b: layout.Color) bool {
    return a.r == b.r and a.g == b.g and a.b == b.b;
}

// ── Snapshot logic ─────────────────────────────────────────────────────
// Auto-generates a full autotest from the running binary:
//   1. Collect initial text expects + health metrics (node/handler/state counts)
//   2. Click every pressable node, settle, collect new text after each click
//   3. Write the complete autotest to ZIGOS_WITNESS_FILE
// The autotest is a build artifact — never hand-written.

const SNAP_MAX_CLICKS = 1024;
const SNAP_MAX_LINES = 8192;

const SnapPhase = enum { wait_settle, collect_initial, clicking, settle_after_click, done };

var snap_phase: SnapPhase = .wait_settle;
var snap_settle_countdown: u8 = 0;

// Pressable nodes discovered on initial render + re-discovered after each click
var snap_pressables: [SNAP_MAX_CLICKS]query.QueryResult = undefined;
var snap_press_labels: [SNAP_MAX_CLICKS][64]u8 = undefined;
var snap_press_label_lens: [SNAP_MAX_CLICKS]u8 = undefined;
// true → label is `@x,y` coordinate form (icon-only / text-less button); emit unquoted.
var snap_press_is_coord: [SNAP_MAX_CLICKS]bool = undefined;
var snap_pressable_count: u16 = 0;
var snap_click_idx: u16 = 0;

// Output buffer — lines of autotest content
var snap_lines: [SNAP_MAX_LINES][128]u8 = undefined;
var snap_line_lens: [SNAP_MAX_LINES]u16 = undefined;
var snap_line_count: u16 = 0;

// Health counters
var snap_node_count: u16 = 0;
var snap_text_count: u16 = 0;
var snap_handler_count: u16 = 0;
var snap_nil_count: u16 = 0;

fn snapAddLine(line: []const u8) void {
    if (snap_line_count >= SNAP_MAX_LINES) return;
    const idx = snap_line_count;
    const clen = @min(line.len, 128);
    @memcpy(snap_lines[idx][0..clen], line[0..clen]);
    snap_line_lens[idx] = @intCast(clen);
    snap_line_count += 1;
}

fn snapAddFmt(comptime fmt: []const u8, args: anytype) void {
    var buf: [128]u8 = undefined;
    const s = std.fmt.bufPrint(&buf, fmt, args) catch return;
    snapAddLine(s);
}

fn snapCountTree(node: *Node) void {
    if (node.style.display == .none) return;
    snap_node_count += 1;
    if (node.text != null) snap_text_count += 1;
    const h = node.handlers;
    if (h.on_press != null or h.js_on_press != null or h.lua_on_press != null) {
        snap_handler_count += 1;
    }
    for (node.children) |*child| {
        snapCountTree(child);
    }
}

var snap_emitted_expects: u16 = 0;

fn snapCollectTexts(root: *Node) void {
    collectSeenTexts(root);
    const start: u16 = snap_emitted_expects;
    snap_emitted_expects = auto_seen_count;
    for (start..auto_seen_count) |i| {
        const raw_txt = auto_seen_texts[i][0..auto_seen_lens[i]];
        var normalized_buf: [TEXT_LEN]u8 = undefined;
        var normalized_len: usize = 0;
        var saw_glyph_placeholder = false;
        var ri: usize = 0;
        while (ri < raw_txt.len and normalized_len < normalized_buf.len) : (ri += 1) {
            const ch = raw_txt[ri];
            if (ch == 0x01) {
                saw_glyph_placeholder = true;
                continue;
            }
            if (ch == '\\' and ri + 1 < raw_txt.len and raw_txt[ri + 1] == '1') {
                saw_glyph_placeholder = true;
                ri += 1;
                continue;
            }
            if (ch == '\\' and ri + 2 < raw_txt.len and raw_txt[ri + 1] == '\\' and raw_txt[ri + 2] == '1') {
                saw_glyph_placeholder = true;
                ri += 2;
                continue;
            }
            if (ch == '\\' and ri + 3 < raw_txt.len and raw_txt[ri + 1] == 'x' and raw_txt[ri + 2] == '0' and raw_txt[ri + 3] == '1') {
                saw_glyph_placeholder = true;
                ri += 3;
                continue;
            }
            if (ch == '\\' and ri + 4 < raw_txt.len and raw_txt[ri + 1] == '\\' and raw_txt[ri + 2] == 'x' and raw_txt[ri + 3] == '0' and raw_txt[ri + 4] == '1') {
                saw_glyph_placeholder = true;
                ri += 4;
                continue;
            }
            normalized_buf[normalized_len] = ch;
            normalized_len += 1;
        }
        // Trim any incomplete trailing UTF-8 sequence — byte-level truncation
        // above can split a multi-byte codepoint, yielding invalid UTF-8 that
        // no rendered text will ever match (e.g. braille glyphs are 3 bytes).
        while (normalized_len > 0) {
            const last = normalized_buf[normalized_len - 1];
            if (last < 0x80) break;
            if (last >= 0xC0) {
                normalized_len -= 1;
                break;
            }
            var k: usize = normalized_len - 1;
            while (k > 0 and (normalized_buf[k] & 0xC0) == 0x80) : (k -= 1) {}
            const lead = normalized_buf[k];
            if (lead < 0xC0) {
                normalized_len = k;
                break;
            }
            const expected: usize = if (lead >= 0xF0) 4 else if (lead >= 0xE0) 3 else 2;
            if (normalized_len - k < expected) {
                normalized_len = k;
            }
            break;
        }
        const txt = normalized_buf[0..normalized_len];
        if (txt.len < 2) continue;
        var all_space = true;
        for (txt) |ch| {
            if (ch != ' ' and ch != '\t') {
                all_space = false;
                break;
            }
        }
        if (all_space) continue;
        // Detect nil values — broken Lua expressions that rendered as "nil"
        if (std.mem.eql(u8, txt, "nil") or
            std.mem.indexOf(u8, txt, "nil ") != null or
            std.mem.indexOf(u8, txt, " nil") != null or
            std.mem.indexOf(u8, txt, ": nil") != null or
            std.mem.indexOf(u8, txt, "nil,") != null)
        {
            snap_nil_count += 1;
            snapAddFmt("# FAIL: nil in rendered text: \"{s}\"", .{txt});
            continue;
        }
        // If the node text was only glyph sentinel data, it is not user-visible text.
        // If visible text remains after stripping sentinels, snapshot the text that the user sees.
        if (saw_glyph_placeholder and txt.len == 0) {
            continue;
        }
        if (saw_glyph_placeholder) {
            snap_nil_count += 1;
            snapAddFmt("# FAIL: unresolved glyph placeholder in: \"{s}\"", .{raw_txt});
            continue;
        }
        // Detect internal markers leaking as visible text (__name__)
        if (txt.len > 4 and txt[0] == '_' and txt[1] == '_' and
            txt[txt.len - 1] == '_' and txt[txt.len - 2] == '_')
        {
            snap_nil_count += 1;
            snapAddFmt("# FAIL: internal marker leaked: \"{s}\"", .{txt});
            continue;
        }
        // Detect unresolved prop references (props.field rendered as literal text)
        if (txt.len >= 6 and std.mem.startsWith(u8, txt, "props.")) {
            snap_nil_count += 1;
            snapAddFmt("# FAIL: unresolved prop reference: \"{s}\"", .{txt});
            continue;
        }
        snapAddFmt("expect \"{s}\"", .{txt});
    }
}

var snap_viewport_w: f32 = 0;
var snap_viewport_h: f32 = 0;

fn snapFindPressables(root: *Node) void {
    // Record the viewport once so on-screen checks inside the recursion don't
    // have to re-walk up to the root.
    snap_viewport_w = root.computed.w;
    snap_viewport_h = root.computed.h;
    snapFindPressRecurse(root, 0);
}

fn snapFindPressRecurse(node: *Node, scroll_y: f32) void {
    if (node.style.display == .none) return;
    if (snap_pressable_count >= SNAP_MAX_CLICKS) return;

    const h = node.handlers;
    var has_press = (h.on_press != null or h.js_on_press != null or h.lua_on_press != null);

    // Skip window control handlers — clicking these kills/minimizes the app
    if (has_press) {
        if (h.js_on_press) |jp| {
            const jp_span = std.mem.span(jp);
            if (std.mem.startsWith(u8, jp_span, "__window")) has_press = false;
        }
    }

    if (has_press) {
        const cx = node.computed.x + node.computed.w / 2.0;
        const cy = node.computed.y - scroll_y + node.computed.h / 2.0;

        // Resolve label, preferring stable identifiers over visible text.
        // 1. test_id — compiler-injected from handler name. Best option.
        // 2. node.text — own visible text.
        // 3. First child's visible text — common button-wraps-text pattern.
        // Handler strings (__dispatchEvent(...), debug_name) are NOT used as
        // labels: they're not addressable at replay time. Icon-only and
        // otherwise text-less pressables get a @cx,cy coordinate label so
        // the replay hits the same pixel instead of failing the step.
        var text_label: ?[]const u8 = node.test_id;
        if (text_label == null) text_label = node.text;
        if (text_label == null) text_label = findFirstChildText(node);

        // Filter out glyph placeholder / non-printable labels — they're not
        // addressable at replay and usually mean the handler label leaked a
        // raw SDF-atlas index byte. Fall back to coord form in that case.
        if (text_label) |lbl| {
            var ok = lbl.len >= 2;
            if (ok) for (lbl) |ch| {
                if (ch < 0x20) {
                    ok = false;
                    break;
                }
            };
            if (ok) {
                if (std.mem.indexOf(u8, lbl, "\\1") != null) ok = false;
                if (std.mem.eql(u8, lbl, "\\1")) ok = false;
                if (std.mem.indexOf(u8, lbl, "\\\\1") != null) ok = false;
                if (std.mem.eql(u8, lbl, "\\\\1")) ok = false;
                if (std.mem.indexOf(u8, lbl, "\\x01") != null) ok = false;
                if (std.mem.eql(u8, lbl, "\\x01")) ok = false;
                if (std.mem.indexOf(u8, lbl, "\\\\x01") != null) ok = false;
                if (std.mem.eql(u8, lbl, "\\\\x01")) ok = false;
            }
            if (!ok) text_label = null;
        }

        // Skip pressables whose center isn't on-screen — off-screen click
        // hits nothing useful and just wastes a step.
        const on_screen = cx >= 0 and cy >= 0 and cx < snap_viewport_w and cy < snap_viewport_h;

        if (on_screen) {
            // Build the label. Three forms in priority order:
            //   1. plain text    — pressable had text/test_id.
            //   2. "Name" @x,y   — no text, but the reconciler resolved a
            //                      component debug_name (e.g. TabCloseButton).
            //                      Name is for readability, @x,y is the
            //                      replay target.
            //   3. @x,y          — anonymous icon button, no component name.
            var label_buf: [64]u8 = undefined;
            var label: []const u8 = undefined;
            var is_coord = false;
            if (text_label) |lbl| {
                const clen = @min(lbl.len, 64);
                label = lbl[0..clen];
            } else if (node.debug_name) |dn| {
                // Sanitize: component names should be ASCII word chars; reject
                // anything weird (keeps the autotest file parseable).
                var dn_ok = dn.len > 0 and dn.len < 48;
                if (dn_ok) for (dn) |ch| {
                    const alpha = (ch >= 'A' and ch <= 'Z') or (ch >= 'a' and ch <= 'z');
                    const digit = ch >= '0' and ch <= '9';
                    if (!(alpha or digit or ch == '_' or ch == '.' or ch == '-')) {
                        dn_ok = false;
                        break;
                    }
                };
                if (dn_ok) {
                    // Hybrid label stored as `Name|@x,y` internally; split on
                    // '|' at emission time so the autotest file reads
                    //   click "Name" @x,y
                    // and the parser sees coords OUTSIDE the quoted label.
                    const s = std.fmt.bufPrint(&label_buf, "{s}|@{d:.0},{d:.0}", .{ dn, cx, cy }) catch "";
                    label = s;
                    is_coord = true;
                } else {
                    const s = std.fmt.bufPrint(&label_buf, "@{d:.0},{d:.0}", .{ cx, cy }) catch "@0,0";
                    label = s;
                    is_coord = true;
                }
            } else {
                const s = std.fmt.bufPrint(&label_buf, "@{d:.0},{d:.0}", .{ cx, cy }) catch "@0,0";
                label = s;
                is_coord = true;
            }

            // Dedupe: skip if an identical label was already captured.
            var seen = false;
            var si: u16 = 0;
            while (si < snap_pressable_count) : (si += 1) {
                const prev = snap_press_labels[si][0..snap_press_label_lens[si]];
                if (prev.len == label.len and std.mem.eql(u8, prev, label)) {
                    seen = true;
                    break;
                }
            }
            if (!seen) {
                const idx = snap_pressable_count;
                snap_pressables[idx] = .{
                    .node = node,
                    .x = node.computed.x,
                    .y = node.computed.y - scroll_y,
                    .w = node.computed.w,
                    .h = node.computed.h,
                    .cx = cx,
                    .cy = cy,
                };
                const clen: u8 = @intCast(label.len);
                @memcpy(snap_press_labels[idx][0..label.len], label);
                snap_press_label_lens[idx] = clen;
                snap_press_is_coord[idx] = is_coord;
                snap_pressable_count += 1;
            }
        }
    }

    const child_scroll = scroll_y + node.scroll_y;
    for (node.children) |*child| {
        if (snap_pressable_count >= SNAP_MAX_CLICKS) return;
        snapFindPressRecurse(child, child_scroll);
    }
}

fn findFirstChildText(node: *Node) ?[]const u8 {
    for (node.children) |*child| {
        if (child.style.display == .none) continue;
        if (child.text) |t| {
            // Skip invalid labels: too short, non-printable, glyph placeholders, markers
            if (t.len < 2) continue; // too short
            var has_printable = false;
            var has_nonprintable = false;
            for (t) |ch| {
                if (ch >= 'A' and ch <= 'z') has_printable = true;
                if (ch < 0x20) has_nonprintable = true;
            }
            if (has_nonprintable) continue; // glyph byte
            if (!has_printable) continue; // no letters at all
            if (std.mem.indexOf(u8, t, "\\1") != null) continue; // escaped glyph
            if (std.mem.indexOf(u8, t, "\\x01") != null) continue; // hex escaped glyph
            if (t[0] == '_' and t[1] == '_') continue; // __marker__
            return t;
        }
        const sub = findFirstChildText(child);
        if (sub != null) return sub;
    }
    return null;
}

fn snapshotTick(io: std.Io, root: *Node) bool {
    if (frame_count < 8 and snap_phase == .wait_settle) return false;

    switch (snap_phase) {
        .wait_settle => {
            snap_phase = .collect_initial;
            return false;
        },
        .collect_initial => {
            // Count tree health
            snapCountTree(root);
            const slot_count: usize = 0;

            // Collect initial text expects first (populates snap_nil_count)
            snapCollectTexts(root);

            // Header — emitted after collection so fail count is accurate
            // Insert at position 0 by shifting lines down
            var header_lines: [3][128]u8 = undefined;
            var header_lens: [3]u16 = undefined;
            var hdr_buf0: [128]u8 = undefined;
            const hdr0 = std.fmt.bufPrint(&hdr_buf0, "# Verify all visible text on initial render", .{}) catch "";
            var hdr_buf1: [128]u8 = undefined;
            const hdr1 = std.fmt.bufPrint(&hdr_buf1, "# health: {d} nodes, {d} text, {d} pressable, {d} state slots, {d} fails", .{
                snap_node_count, snap_text_count, snap_handler_count, slot_count, snap_nil_count,
            }) catch "";
            const hdr2 = "# Initial render";

            // Prepend header lines before the expects
            const existing_count = snap_line_count;
            if (existing_count + 4 < SNAP_MAX_LINES) {
                // Shift existing lines forward by 4 (3 header + 1 blank)
                var si: u16 = existing_count;
                while (si > 0) {
                    si -= 1;
                    snap_lines[si + 4] = snap_lines[si];
                    snap_line_lens[si + 4] = snap_line_lens[si];
                }
                @memcpy(header_lines[0][0..hdr0.len], hdr0);
                header_lens[0] = @intCast(hdr0.len);
                snap_lines[0] = header_lines[0];
                snap_line_lens[0] = header_lens[0];

                @memcpy(header_lines[1][0..hdr1.len], hdr1);
                header_lens[1] = @intCast(hdr1.len);
                snap_lines[1] = header_lines[1];
                snap_line_lens[1] = header_lens[1];

                // blank line
                snap_lines[2] = undefined;
                snap_line_lens[2] = 0;

                @memcpy(header_lines[2][0..hdr2.len], hdr2);
                header_lens[2] = @intCast(hdr2.len);
                snap_lines[3] = header_lines[2];
                snap_line_lens[3] = header_lens[2];

                snap_line_count = existing_count + 4;
            }

            // Find pressable nodes for click-through
            snapFindPressables(root);

            if (snap_pressable_count > 0) {
                snapAddLine("");
                snapAddFmt("# Click-through: {d} pressable nodes", .{snap_pressable_count});
                snap_click_idx = 0;
                snap_phase = .clicking;
            } else {
                snap_phase = .done;
            }
            return false;
        },
        .clicking => {
            if (snap_click_idx >= snap_pressable_count) {
                snap_phase = .done;
                return false;
            }

            const label = snap_press_labels[snap_click_idx][0..snap_press_label_lens[snap_click_idx]];
            const is_coord = snap_press_is_coord[snap_click_idx];

            // Click using stored coordinates (don't re-find — avoids hitting wrong node with same label).
            // Emission forms:
            //   pure coord        → click @x,y           (anonymous icon button)
            //   hybrid name+coord → click "Name" @x,y    (readable + replay-precise)
            //
            // ALL text-labeled clicks get the coord suffix too. Without it,
            // replay does a label-based `findActionTarget` which walks the
            // tree in its own order and may resolve to a different node than
            // the one snapshot actually clicked (e.g., two pressables both
            // containing "Quilt", or a text node vs. its enclosing Pressable).
            // That divergence cascades: wrong click → wrong state → every
            // expect after fails. Coords eliminate the ambiguity.
            const p = snap_pressables[snap_click_idx];
            snapAddLine("");
            if (is_coord) {
                // Pure coord labels start with '@'. Hybrid labels are stored
                // as `Name|@x,y` and split on '|' here so the output is
                //   click "Name" @x,y
                if (label.len > 0 and label[0] == '@') {
                    snapAddFmt("click {s}", .{label});
                } else if (std.mem.indexOfScalar(u8, label, '|')) |pipe| {
                    snapAddFmt("click \"{s}\" {s}", .{ label[0..pipe], label[pipe + 1 ..] });
                } else {
                    snapAddFmt("click \"{s}\" @{d:.0},{d:.0}", .{ label, p.cx, p.cy });
                }
            } else {
                snapAddFmt("click \"{s}\" @{d:.0},{d:.0}", .{ label, p.cx, p.cy });
            }
            testdriver.click(p.cx, p.cy);
            snap_settle_countdown = 3;
            snap_phase = .settle_after_click;
            return false;
        },
        .settle_after_click => {
            if (snap_settle_countdown > 0) {
                snap_settle_countdown -= 1;
                return false;
            }

            // Re-collect texts after click — keep auto_seen across clicks so
            // only NEW strings get appended (otherwise every click dumps ~500
            // expects and fills the line buffer within ~10 clicks).
            snapCollectTexts(root);

            // Re-discover pressables: clicking may have revealed new buttons
            // (open menus, nav to another screen, expand a tree row, etc.).
            // Dedupe inside snapFindPressRecurse keeps us from looping on the
            // same buttons forever.
            snapFindPressables(root);

            snap_click_idx += 1;
            if (snap_click_idx >= snap_pressable_count) {
                snap_phase = .done;
            } else {
                snap_phase = .clicking;
            }
            return false;
        },
        .done => {
            snapWriteFile(io);
            return true;
        },
    }
}

fn snapWriteFile(io: std.Io) void {
    const path = witness_path orelse {
        log.print("[snapshot] no ZIGOS_WITNESS_FILE, printing to stderr\n", .{});
        for (0..snap_line_count) |i| {
            log.print("{s}\n", .{snap_lines[i][0..snap_line_lens[i]]});
        }
        return;
    };

    const file = std.Io.Dir.cwd().createFile(io, path, .{}) catch |err| {
        log.print("[snapshot] cannot create {s}: {}\n", .{ path, err });
        return;
    };
    defer file.close(io);

    // Derive test name
    var test_name: []const u8 = path;
    if (std.mem.lastIndexOfScalar(u8, path, '/')) |slash| {
        test_name = path[slash + 1 ..];
    }
    if (std.mem.indexOf(u8, test_name, ".autotest")) |dot| {
        test_name = test_name[0..dot];
    }

    // Write header + all lines
    var out_buf: [65536]u8 = undefined;
    var pos: usize = 0;

    const title_line: []const u8 = std.fmt.bufPrint(out_buf[pos..], "# {s}: auto-generated from runtime snapshot\n", .{test_name}) catch "";
    pos += title_line.len;
    const generated_line: []const u8 = std.fmt.bufPrint(out_buf[pos..], "# Generated by ZIGOS_WITNESS=snapshot — do not edit by hand\n\n", .{}) catch "";
    pos += generated_line.len;

    var expect_count: u16 = 0;
    var click_count: u16 = 0;
    for (0..snap_line_count) |i| {
        const line = snap_lines[i][0..snap_line_lens[i]];
        if (pos + line.len + 1 >= out_buf.len) break;
        @memcpy(out_buf[pos .. pos + line.len], line);
        pos += line.len;
        out_buf[pos] = '\n';
        pos += 1;
        if (line.len > 7 and std.mem.startsWith(u8, line, "expect ")) expect_count += 1;
        if (line.len > 6 and std.mem.startsWith(u8, line, "click ")) click_count += 1;
    }

    file.writeStreamingAll(io, out_buf[0..pos]) catch {};
    if (snap_nil_count > 0) {
        log.print("[snapshot] wrote {d} expects + {d} clicks + {d} FAILS to {s}\n", .{ expect_count, click_count, snap_nil_count, path });
    } else {
        log.print("[snapshot] wrote {d} expects + {d} clicks to {s}\n", .{ expect_count, click_count, path });
    }
}

fn autotestTick(io: std.Io, environ: *const std.process.Environ.Map, root: *Node) bool {
    if (frame_count < 8) return false; // wait for settle

    if (!auto_started) {
        auto_started = true;
        log.print("\n\xe2\x95\x90\xe2\x95\x90 AUTOTEST \xe2\x95\x90\xe2\x95\x90\n\n", .{});
        log.print("  {d} steps to execute\n\n", .{auto_step_count});
        // Wait a few frames for initial render, then screenshot
        auto_settle_frames = 3;
        return false;
    }

    // Waiting for GPU readback callback — skip this frame
    if (auto_capture_pending) return false;

    // Settling: count down frames, then capture screenshot
    if (auto_settle_frames > 0) {
        auto_settle_frames -= 1;
        if (auto_settle_frames == 0) {
            gpu.captureScreenshot(&onAutotestCapture);
            auto_capture_pending = true;
        }
        return false;
    }

    // ── Scroll-hunt ────────────────────────────────────────────────────
    // If a hunt is in progress, drive it. Suspend step dispatch while we
    // scroll through containers; resume the moment huntTick reports found
    // (target is now visible) or exhaustion (give up — the step will FAIL
    // normally, but with every scroll position we tried documented).
    if (hunt_active) {
        if (huntTick(root)) {
            hunt_active = false;
        } else if (hunt_exhausted) {
            hunt_active = false;
        } else {
            return false;
        }
    }

    if (auto_idx >= auto_step_count) {
        // Audits: verify source texts render + check colors
        auditSourceTexts(io, environ, root);
        auditColors(root);

        // Write final result to manifest THEN print
        const total = auto_passed + auto_failed;
        const remaining = auto_manifest_buf[auto_manifest_len..];
        const result_str: []const u8 = if (auto_failed == 0) "PASS" else "FAIL";
        const written = std.fmt.bufPrint(remaining, "RESULT|{d}|{d}|{s}\n", .{ auto_passed, total, result_str }) catch "";
        auto_manifest_len += written.len;

        finishAutotest(io);
        log.print("\n\xe2\x95\x90\xe2\x95\x90 AUTOTEST RESULT: {d}/{d} passed \xe2\x95\x90\xe2\x95\x90\n\n", .{ auto_passed, total });
        return true; // signal exit
    }

    const step = &auto_steps[auto_idx];
    const text = step.text[0..step.text_len];
    var passed = false;
    var hit_result: ?query.QueryResult = null;

    // Pre-step scroll hunt: if this step targets named text and the text
    // isn't in the current layout tree, try scrolling every scroll container
    // before we declare FAIL. One hunt attempt per step — if it completes
    // without finding the text, we fall through to the switch and the step
    // records its FAIL as usual. hunt_started_for_step guards against
    // re-entering hunt in the same step after exhaustion.
    if (!hunt_started_for_step and !step.use_coord and step.text_len > 0 and stepNeedsTextTarget(step.kind)) {
        if (query.find(root, .{ .text_contains = text }) == null) {
            hunt_started_for_step = true;
            startHunt(root, text);
            return false;
        }
    }

    // Restore any scroll positions we nudged during prior `expect` steps,
    // so absolute click coords (authored at the test's initial scroll
    // state) line up with their intended visual targets.
    if (step.kind != .expect and step.kind != .reject) {
        restoreExpectScrolls();
    }

    switch (step.kind) {
        .click => {
            log.print("  [{d}/{d}] click \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
            if (step.use_coord) {
                testdriver.click(step.coord_x, step.coord_y);
                log.print(" ... OK (coord)\n", .{});
                passed = true;
            } else if (findActionTarget(root, text, step.occurrence)) |result| {
                hit_result = result;
                testdriver.click(result.cx, result.cy);
                log.print(" ... OK\n", .{});
                passed = true;
            } else {
                var results: [32]query.QueryResult = undefined;
                const found = findActionTargets(root, text, &results);
                log.print(" ... FAIL (not found, {d} matches)\n", .{found});
            }
        },
        .hover => {
            log.print("  [{d}/{d}] hover \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
            if (step.use_coord) {
                testdriver.moveMouse(step.coord_x, step.coord_y);
                log.print(" ... OK (coord)\n", .{});
                passed = true;
            } else if (findActionTarget(root, text, step.occurrence)) |result| {
                hit_result = result;
                testdriver.moveMouse(result.cx, result.cy);
                log.print(" ... OK\n", .{});
                passed = true;
            } else {
                var results: [32]query.QueryResult = undefined;
                const found = findActionTargets(root, text, &results);
                log.print(" ... FAIL (not found, {d} matches)\n", .{found});
            }
        },
        .rightclick => {
            log.print("  [{d}/{d}] rightclick \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
            if (step.use_coord) {
                testdriver.rightClick(step.coord_x, step.coord_y);
                log.print(" ... OK (coord)\n", .{});
                passed = true;
            } else if (findActionTarget(root, text, step.occurrence)) |result| {
                hit_result = result;
                testdriver.rightClick(result.cx, result.cy);
                log.print(" ... OK\n", .{});
                passed = true;
            } else {
                var results: [32]query.QueryResult = undefined;
                const found = findActionTargets(root, text, &results);
                log.print(" ... FAIL (not found, {d} matches)\n", .{found});
            }
        },
        .wheel => {
            log.print("  [{d}/{d}] wheel \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
            if (step.use_coord) {
                testdriver.scrollAt(0, -3, step.coord_x, step.coord_y);
                log.print(" ... OK (coord)\n", .{});
                passed = true;
            } else if (findActionTarget(root, text, step.occurrence)) |result| {
                hit_result = result;
                testdriver.scrollAt(0, -3, result.cx, result.cy);
                log.print(" ... OK\n", .{});
                passed = true;
            } else {
                var results: [32]query.QueryResult = undefined;
                const found = findActionTargets(root, text, &results);
                log.print(" ... FAIL (not found, {d} matches)\n", .{found});
            }
        },
        .wheelx => {
            log.print("  [{d}/{d}] wheelx \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
            if (step.use_coord) {
                testdriver.scrollAt(-3, 0, step.coord_x, step.coord_y);
                log.print(" ... OK (coord)\n", .{});
                passed = true;
            } else if (findActionTarget(root, text, step.occurrence)) |result| {
                hit_result = result;
                testdriver.scrollAt(-3, 0, result.cx, result.cy);
                log.print(" ... OK\n", .{});
                passed = true;
            } else {
                var results: [32]query.QueryResult = undefined;
                const found = findActionTargets(root, text, &results);
                log.print(" ... FAIL (not found, {d} matches)\n", .{found});
            }
        },
        .expect => {
            log.print("  [{d}/{d}] expect \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
            if (query.find(root, .{ .text_contains = text })) |result| {
                hit_result = result;
                // Auto-scroll: if the node is inside a scroll container but not
                // currently in its visible window, nudge the container's scroll
                // so the node is on-screen. The 3-frame settle after this step
                // lets layout reflow before the next screenshot, so the pixel
                // verify sees the node. Without this, snapshot-emitted expects
                // for text below a ScrollView's fold fail pixel verification
                // even though the app renders them correctly when scrolled.
                if (scrollNodeIntoView(root, result.node)) {
                    // Re-query: scrollNodeIntoView nudged a scroll container,
                    // so the node's viewport coords shifted. query.find
                    // accumulates ancestor scroll_y, so a fresh lookup gives
                    // us the post-scroll region. The manifest (and downstream
                    // pixel verifier) need that region to match the
                    // screenshot captured after the settle frames.
                    if (query.find(root, .{ .text_contains = text })) |post_scroll| {
                        hit_result = post_scroll;
                    }
                    expect_did_scroll = true;
                    log.print(" ... PASS (scrolled into view)\n", .{});
                } else {
                    log.print(" ... PASS\n", .{});
                }
                passed = true;
            } else {
                log.print(" ... FAIL (not found)\n", .{});
            }
        },
        .reject => {
            log.print("  [{d}/{d}] reject \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
            if (query.find(root, .{ .text_contains = text })) |result| {
                hit_result = result;
                log.print(" ... FAIL (still visible)\n", .{});
            } else {
                log.print(" ... PASS\n", .{});
                passed = true;
            }
        },
        .scroll => {
            log.print("  [{d}/{d}] scroll \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
            if (findActionTarget(root, text, step.occurrence)) |result| {
                hit_result = result;
                // Find the nearest scroll container ancestor and scroll to make this node visible
                const target_y = result.node.computed.y;
                const target_h = result.node.computed.h;
                if (findScrollParent(root, result.node)) |sp| {
                    const scroll_top = sp.computed.y;
                    const scroll_h = sp.computed.h;
                    // If target is below visible area, scroll down
                    if (target_y + target_h > scroll_top + scroll_h + sp.scroll_y) {
                        sp.scroll_y = target_y + target_h - scroll_top - scroll_h + 20;
                    }
                    // If target is above visible area, scroll up
                    if (target_y < scroll_top + sp.scroll_y) {
                        sp.scroll_y = target_y - scroll_top - 10;
                    }
                    if (sp.scroll_y < 0) sp.scroll_y = 0;
                    layout.markLayoutDirty();
                    log.print(" ... OK (scrolled to y={d:.0})\n", .{sp.scroll_y});
                    passed = true;
                } else {
                    log.print(" ... OK (no scroll needed)\n", .{});
                    passed = true;
                }
            } else {
                log.print(" ... FAIL (not found)\n", .{});
            }
        },
        .color => {
            var exp_hex: [7]u8 = undefined;
            const exp_str = colorToHex(step.expected_color, &exp_hex);
            log.print("  [{d}/{d}] color \"{s}\" = {s}", .{ auto_idx + 1, auto_step_count, text, exp_str });
            if (query.find(root, .{ .text_contains = text })) |result| {
                hit_result = result;
                if (result.node.text_color) |tc| {
                    if (colorEql(tc, step.expected_color)) {
                        log.print(" ... PASS\n", .{});
                        passed = true;
                    } else {
                        var got_hex: [7]u8 = undefined;
                        log.print(" ... FAIL (got {s})\n", .{colorToHex(tc, &got_hex)});
                    }
                } else {
                    log.print(" ... FAIL (no text_color set)\n", .{});
                }
            } else {
                log.print(" ... FAIL (not found)\n", .{});
            }
        },
        .border => {
            var exp_hex: [7]u8 = undefined;
            const exp_str = colorToHex(step.expected_color, &exp_hex);
            log.print("  [{d}/{d}] border \"{s}\" = {s}", .{ auto_idx + 1, auto_step_count, text, exp_str });
            var border_node: ?*Node = null;
            findBorderNode(root, text, &border_node);
            if (border_node) |bn| {
                const bw = bn.style.border_width;
                if (bn.style.border_color) |actual_bc| {
                    if (bw > 0 and colorEql(actual_bc, step.expected_color)) {
                        // Data matches — emit BORDER_PIXEL for Python pixel verification
                        log.print(" ... VERIFY (width={d:.0})\n", .{bw});
                        const remaining = auto_manifest_buf[auto_manifest_len..];
                        const written = std.fmt.bufPrint(remaining, "BORDER_PIXEL|{d}|{d:.0},{d:.0},{d:.0},{d:.0}|{d:.0}|{s}\n", .{
                            auto_idx, bn.computed.x, bn.computed.y, bn.computed.w, bn.computed.h, bw, exp_str,
                        }) catch "";
                        auto_manifest_len += written.len;
                        passed = true; // tentative — Python overrides if pixels fail
                        hit_result = .{
                            .node = bn,
                            .x = bn.computed.x,
                            .y = bn.computed.y,
                            .w = bn.computed.w,
                            .h = bn.computed.h,
                            .cx = bn.computed.x + bn.computed.w / 2,
                            .cy = bn.computed.y + bn.computed.h / 2,
                        };
                    } else if (bw == 0) {
                        log.print(" ... FAIL (borderWidth=0)\n", .{});
                    } else {
                        var got_hex: [7]u8 = undefined;
                        log.print(" ... FAIL (got {s})\n", .{colorToHex(actual_bc, &got_hex)});
                    }
                } else {
                    log.print(" ... FAIL (no borderColor set)\n", .{});
                }
            } else {
                log.print(" ... FAIL (text not found)\n", .{});
            }
        },
        .styles => {
            // Parse: "before <target>" or "after <target>" or bare "before"/"after"
            var mode_str: []const u8 = text;
            var target: ?[]const u8 = null;
            if (std.mem.startsWith(u8, text, "before ")) {
                mode_str = "before";
                target = text[7..];
            } else if (std.mem.startsWith(u8, text, "after ")) {
                mode_str = "after";
                target = text[6..];
            }

            if (std.mem.eql(u8, mode_str, "before")) {
                const label = target orelse "(all)";
                log.print("  [{d}/{d}] styles before \"{s}\"", .{ auto_idx + 1, auto_step_count, label });
                // Find the target node and snapshot it + its parent subtree
                const snap_root = if (target) |t| blk: {
                    if (query.find(root, .{ .text_contains = t })) |result| {
                        hit_result = result;
                        break :blk result.node;
                    }
                    break :blk root;
                } else root;
                style_snap_before_count = 0;
                snapshotStyles(snap_root, &style_snap_before, &style_snap_before_count, 0);
                style_snap_has_before = true;
                log.print(" ... {d} nodes captured\n", .{style_snap_before_count});
                passed = true;
            } else if (std.mem.eql(u8, mode_str, "after")) {
                const label = target orelse "(all)";
                log.print("  [{d}/{d}] styles after \"{s}\"", .{ auto_idx + 1, auto_step_count, label });
                if (!style_snap_has_before) {
                    log.print(" ... FAIL (no 'before' snapshot)\n", .{});
                } else {
                    const snap_root = if (target) |t| blk: {
                        if (query.find(root, .{ .text_contains = t })) |result| {
                            hit_result = result;
                            break :blk result.node;
                        }
                        break :blk root;
                    } else root;
                    var snap_after: [MAX_STYLE_ENTRIES]StyleEntry = undefined;
                    var snap_after_count: u16 = 0;
                    snapshotStyles(snap_root, &snap_after, &snap_after_count, 0);
                    const diffs = diffStyles(&style_snap_before, style_snap_before_count, &snap_after, snap_after_count);
                    if (diffs > 0) {
                        log.print(" ... PASS ({d} property changes)\n", .{diffs});
                        passed = true;
                    } else {
                        log.print(" ... FAIL (0 changes — styles identical)\n", .{});
                    }
                    style_snap_has_before = false;
                }
            } else {
                log.print("  [{d}/{d}] styles \"{s}\" ... FAIL (use 'before' or 'after')\n", .{ auto_idx + 1, auto_step_count, text });
            }
        },
        .bg => {
            var exp_hex: [7]u8 = undefined;
            const exp_str = colorToHex(step.expected_color, &exp_hex);
            log.print("  [{d}/{d}] bg \"{s}\" = {s}", .{ auto_idx + 1, auto_step_count, text, exp_str });
            if (query.find(root, .{ .text_contains = text })) |result| {
                hit_result = result;
                if (result.node.style.background_color) |bg_c| {
                    if (colorEql(bg_c, step.expected_color)) {
                        log.print(" ... PASS\n", .{});
                        passed = true;
                    } else {
                        var got_hex: [7]u8 = undefined;
                        log.print(" ... FAIL (got {s})\n", .{colorToHex(bg_c, &got_hex)});
                    }
                } else {
                    log.print(" ... FAIL (no background_color set)\n", .{});
                }
            } else {
                log.print(" ... FAIL (not found)\n", .{});
            }
        },

        // ── Input-based commands ──────────────────────────────────────

        .focus => {
            // Click a TextInput node to focus it. Finds by placeholder or visible text.
            log.print("  [{d}/{d}] focus \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
            if (findTextInput(root, text)) |result| {
                hit_result = result;
                testdriver.click(result.cx, result.cy);
                log.print(" ... OK (input_id={d})\n", .{result.node.input_id orelse 255});
                passed = true;
            } else {
                log.print(" ... FAIL (no TextInput found)\n", .{});
            }
        },

        .type_text => {
            // Type text into a TextInput. If 'into "target"' specified, focus that
            // input first. Otherwise type into whatever is focused (or first input).
            const target = step.target[0..step.target_len];
            if (target.len > 0) {
                log.print("  [{d}/{d}] type \"{s}\" into \"{s}\"", .{ auto_idx + 1, auto_step_count, text, target });
                if (findTextInput(root, target)) |result| {
                    hit_result = result;
                    testdriver.click(result.cx, result.cy);
                } else {
                    log.print(" ... FAIL (target \"{s}\" not found)\n", .{target});
                    // still record failure
                }
            } else {
                log.print("  [{d}/{d}] type \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
                // If nothing focused, try to find the first TextInput
                if (input_mod.getFocusedId() == null) {
                    if (findFirstTextInput(root)) |result| {
                        hit_result = result;
                        testdriver.click(result.cx, result.cy);
                    }
                }
            }
            // Actually type the text
            if (input_mod.getFocusedId() != null) {
                testdriver.typeText(text);
                log.print(" ... OK ({d} chars)\n", .{step.text_len});
                passed = true;
            } else {
                log.print(" ... FAIL (no input focused)\n", .{});
            }
        },

        .key_press => {
            // Send a key event, optionally with modifiers.
            // For combos (ctrl+s), pushes modifier down, key down/up, modifier up.
            log.print("  [{d}/{d}] key \"{s}\"", .{ auto_idx + 1, auto_step_count, text });
            const ci = @import("../c.zig").imports;

            if (step.key_code == 0) {
                log.print(" ... FAIL (unknown key)\n", .{});
            } else {
                // Push modifier key-down events
                if (step.key_ctrl) {
                    var ev: ci.SDL_Event = std.mem.zeroes(ci.SDL_Event);
                    ev.type = ci.SDL_EVENT_KEY_DOWN;
                    ev.key.key = ci.SDLK_LCTRL;
                    ev.key.mod = ci.SDL_KMOD_LCTRL;
                    ev.key.down = true;
                    _ = ci.SDL_PushEvent(&ev);
                }
                if (step.key_shift) {
                    var ev: ci.SDL_Event = std.mem.zeroes(ci.SDL_Event);
                    ev.type = ci.SDL_EVENT_KEY_DOWN;
                    ev.key.key = ci.SDLK_LSHIFT;
                    ev.key.mod = ci.SDL_KMOD_LSHIFT;
                    ev.key.down = true;
                    _ = ci.SDL_PushEvent(&ev);
                }
                if (step.key_alt) {
                    var ev: ci.SDL_Event = std.mem.zeroes(ci.SDL_Event);
                    ev.type = ci.SDL_EVENT_KEY_DOWN;
                    ev.key.key = ci.SDLK_LALT;
                    ev.key.mod = ci.SDL_KMOD_LALT;
                    ev.key.down = true;
                    _ = ci.SDL_PushEvent(&ev);
                }

                // Build combined modifier mask
                var mod: u16 = 0;
                if (step.key_ctrl) mod |= @as(u16, ci.SDL_KMOD_LCTRL);
                if (step.key_shift) mod |= @as(u16, ci.SDL_KMOD_LSHIFT);
                if (step.key_alt) mod |= @as(u16, ci.SDL_KMOD_LALT);

                // Key down + up with modifier mask
                var down: ci.SDL_Event = std.mem.zeroes(ci.SDL_Event);
                down.type = ci.SDL_EVENT_KEY_DOWN;
                down.key.key = @intCast(step.key_code);
                down.key.mod = @intCast(mod);
                down.key.down = true;
                _ = ci.SDL_PushEvent(&down);

                var up: ci.SDL_Event = std.mem.zeroes(ci.SDL_Event);
                up.type = ci.SDL_EVENT_KEY_UP;
                up.key.key = @intCast(step.key_code);
                up.key.mod = @intCast(mod);
                up.key.down = false;
                _ = ci.SDL_PushEvent(&up);

                // Release modifiers
                if (step.key_ctrl) {
                    var ev: ci.SDL_Event = std.mem.zeroes(ci.SDL_Event);
                    ev.type = ci.SDL_EVENT_KEY_UP;
                    ev.key.key = ci.SDLK_LCTRL;
                    ev.key.down = false;
                    _ = ci.SDL_PushEvent(&ev);
                }
                if (step.key_shift) {
                    var ev: ci.SDL_Event = std.mem.zeroes(ci.SDL_Event);
                    ev.type = ci.SDL_EVENT_KEY_UP;
                    ev.key.key = ci.SDLK_LSHIFT;
                    ev.key.down = false;
                    _ = ci.SDL_PushEvent(&ev);
                }
                if (step.key_alt) {
                    var ev: ci.SDL_Event = std.mem.zeroes(ci.SDL_Event);
                    ev.type = ci.SDL_EVENT_KEY_UP;
                    ev.key.key = ci.SDLK_LALT;
                    ev.key.down = false;
                    _ = ci.SDL_PushEvent(&ev);
                }

                log.print(" ... OK\n", .{});
                passed = true;
            }
        },

        .clear => {
            // Clear the currently focused TextInput
            log.print("  [{d}/{d}] clear", .{ auto_idx + 1, auto_step_count });
            if (input_mod.getFocusedId()) |fid| {
                input_mod.clear(fid);
                log.print(" ... OK (input {d})\n", .{fid});
                passed = true;
            } else {
                log.print(" ... FAIL (no input focused)\n", .{});
            }
        },
    }

    if (passed) auto_passed += 1 else auto_failed += 1;

    // Record all currently visible text for source audit
    collectSeenTexts(root);

    appendManifest(auto_idx, step, passed, hit_result);

    // Flush manifest to disk incrementally so a SIGKILL (via `timeout -s KILL`)
    // still leaves a partial proof grid instead of wiping the run. finishAutotest
    // is idempotent — it just rewrites the full buffer.
    finishAutotest(io);

    auto_idx += 1;
    hunt_started_for_step = false;
    hunt_exhausted = false;

    // Settle frames before the next step runs. State-mutating steps (click,
    // scroll, type, key, focus, clear) dispatch SDL events whose handlers
    // run next frame, trigger a React re-render one or more frames later,
    // and only then settle in layout. If the NEXT step is an `expect` that
    // queries the tree, it must see the POST-reconcile DOM — otherwise an
    // expected element that a click just removed (or revealed) fails to
    // match against a stale pre-reconcile tree. 3 frames was tuned for the
    // screenshot path but isn't enough for tree stability after mutations.
    // Pure queries (expect/reject/color/bg/border/styles) don't mutate, so
    // 3 frames is still fine there.
    const mutated = switch (step.kind) {
        .click, .rightclick, .wheel, .wheelx, .scroll, .type_text, .key_press, .focus, .clear, .hover => true,
        else => false,
    };
    // expect_did_scroll: an expect that auto-scrolled an ancestor needs the
    // longer settle so layout reflow lands before the screenshot.
    auto_settle_frames = if (mutated or expect_did_scroll) 8 else 3;
    expect_did_scroll = false;

    return false;
}

var auto_capture_idx: u16 = 0;

fn onAutotestCapture(io: std.Io, pixels: [*]const u8, w: u32, h: u32, stride: u32) void {
    // Stop continuous capture — we only want one frame per request
    gpu.stopCapture();

    // Save into per-test screenshot dir: tests/screenshots/<test_name>/step_NN.png
    // Derive test name from witness file path (e.g., "tests/d03_foo.autotest" → "d03_foo")
    const dir_name = blk: {
        const wp = witness_path orelse break :blk "unknown";
        // Find filename without extension
        var start: usize = 0;
        for (wp, 0..) |ch, i| {
            if (ch == '/') start = i + 1;
        }
        const filename = wp[start..];
        var end = filename.len;
        for (filename, 0..) |ch, i| {
            if (ch == '.') {
                end = i;
                break;
            }
        }
        break :blk filename[0..end];
    };

    var dir_buf: [512]u8 = undefined;
    const dir_path = std.fmt.bufPrint(&dir_buf, "tests/screenshots/{s}", .{dir_name}) catch return;

    var path_buf: [512]u8 = undefined;
    const path = std.fmt.bufPrintZ(&path_buf, "tests/screenshots/{s}/step_{d:0>2}.png", .{ dir_name, auto_capture_idx }) catch return;

    // Ensure directory exists
    if (auto_capture_idx == 0) {
        std.Io.Dir.cwd().createDirPath(io, dir_path) catch {};
    }

    // Convert BGRA → RGBA
    const size = @as(usize, w) * @as(usize, h) * 4;
    const rgba = page_alloc.alloc(u8, size) catch return;
    defer page_alloc.free(rgba);

    var y: u32 = 0;
    while (y < h) : (y += 1) {
        var x: u32 = 0;
        while (x < w) : (x += 1) {
            const src = @as(usize, y) * @as(usize, stride) + @as(usize, x) * 4;
            const dst = (@as(usize, y) * @as(usize, w) + @as(usize, x)) * 4;
            rgba[dst + 0] = pixels[src + 2]; // R ← B
            rgba[dst + 1] = pixels[src + 1]; // G
            rgba[dst + 2] = pixels[src + 0]; // B ← R
            rgba[dst + 3] = pixels[src + 3]; // A
        }
    }

    _ = capture.writeRgbaPng(io, path, rgba, w, h);
    auto_capture_idx += 1;
    auto_capture_pending = false;
}

fn appendManifest(idx: u16, step: *const AutoStep, passed: bool, node_result: ?query.QueryResult) void {
    const text = step.text[0..step.text_len];
    const kind_str: []const u8 = switch (step.kind) {
        .click => "click",
        .hover => "hover",
        .rightclick => "rightclick",
        .wheel => "wheel",
        .wheelx => "wheelx",
        .expect => "expect",
        .reject => "reject",
        .color => "color",
        .bg => "bg",
        .border => "border",
        .styles => "styles",
        .type_text => "type",
        .key_press => "key",
        .focus => "focus",
        .clear => "clear",
        .scroll => "scroll",
    };
    const result_str: []const u8 = if (passed) "PASS" else "FAIL";
    const remaining = auto_manifest_buf[auto_manifest_len..];
    if (node_result) |nr| {
        const written = std.fmt.bufPrint(remaining, "{d}|{s}|{s}|{s}|{d:.0},{d:.0},{d:.0},{d:.0}\n", .{
            idx, kind_str, text, result_str, nr.x, nr.y, nr.w, nr.h,
        }) catch return;
        auto_manifest_len += written.len;
    } else {
        const written = std.fmt.bufPrint(remaining, "{d}|{s}|{s}|{s}|\n", .{
            idx, kind_str, text, result_str,
        }) catch return;
        auto_manifest_len += written.len;
    }
}

fn finishAutotest(io: std.Io) void {
    if (auto_manifest_len == 0) return;

    // Derive dir from witness path
    const dir_name = blk: {
        const wp = witness_path orelse break :blk "unknown";
        var start: usize = 0;
        for (wp, 0..) |ch, i| {
            if (ch == '/') start = i + 1;
        }
        const filename = wp[start..];
        var end = filename.len;
        for (filename, 0..) |ch, i| {
            if (ch == '.') {
                end = i;
                break;
            }
        }
        break :blk filename[0..end];
    };

    var path_buf: [512]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "tests/screenshots/{s}/manifest.txt", .{dir_name}) catch return;

    const f = std.Io.Dir.cwd().createFile(io, path, .{}) catch return;
    defer f.close(io);
    f.writeStreamingAll(io, auto_manifest_buf[0..auto_manifest_len]) catch {};
}

fn collectSeenTexts(node: *Node) void {
    if (node.style.display == .none) return;
    if (node.text) |txt| {
        const trunc = @min(txt.len, @as(usize, 64));
        // Check if already seen
        var found = false;
        for (0..auto_seen_count) |i| {
            if (auto_seen_lens[i] == trunc and std.mem.eql(u8, auto_seen_texts[i][0..trunc], txt[0..trunc])) {
                found = true;
                break;
            }
        }
        if (!found and auto_seen_count < 512) {
            @memcpy(auto_seen_texts[auto_seen_count][0..trunc], txt[0..trunc]);
            auto_seen_lens[auto_seen_count] = @intCast(trunc);
            auto_seen_count += 1;
        }
    }
    for (node.children) |*child| {
        collectSeenTexts(child);
    }
}

fn wasEverSeen(text: []const u8) bool {
    const trunc = @min(text.len, @as(usize, 64));
    for (0..auto_seen_count) |i| {
        const seen = auto_seen_texts[i][0..auto_seen_lens[i]];
        if (std.mem.indexOf(u8, seen, text[0..trunc]) != null) return true;
    }
    return false;
}

fn findBorderNode(node: *Node, target_text: []const u8, result: *?*Node) void {
    if (node.style.display == .none) return;
    if (result.* != null) return;

    if (subtreeContainsText(node, target_text)) {
        if (node.style.border_width > 0 and node.style.border_color != null) {
            result.* = node;
            return;
        }
        for (node.children) |*child| {
            findBorderNode(child, target_text, result);
            if (result.* != null) return;
        }
    }
}

fn subtreeContainsText(node: *Node, target: []const u8) bool {
    if (node.text) |txt| {
        if (std.mem.indexOf(u8, txt, target) != null) return true;
    }
    for (node.children) |*child| {
        if (subtreeContainsText(child, target)) return true;
    }
    return false;
}

fn snapshotStyles(node: *Node, snap: *[MAX_STYLE_ENTRIES]StyleEntry, count: *u16, depth: u8) void {
    if (node.style.display == .none) return;
    if (count.* >= MAX_STYLE_ENTRIES) return;

    const idx = count.*;
    snap[idx] = .{};
    snap[idx].depth = depth;

    // Capture text identity
    if (node.text) |txt| {
        const copy_len = @min(txt.len, @as(usize, 64));
        @memcpy(snap[idx].text[0..copy_len], txt[0..copy_len]);
        snap[idx].text_len = @intCast(copy_len);
    }

    // Computed layout
    snap[idx].x = node.computed.x;
    snap[idx].y = node.computed.y;
    snap[idx].w = node.computed.w;
    snap[idx].h = node.computed.h;

    // Style properties
    snap[idx].padding_top = node.style.padding_top orelse 0;
    snap[idx].padding_bottom = node.style.padding_bottom orelse 0;
    snap[idx].padding_left = node.style.padding_left orelse 0;
    snap[idx].padding_right = node.style.padding_right orelse 0;
    snap[idx].border_radius = node.style.border_radius;
    snap[idx].border_width = node.style.border_width;
    snap[idx].gap = node.style.gap;
    snap[idx].font_size = node.font_size;

    if (node.style.background_color) |bg| {
        snap[idx].bg_r = bg.r;
        snap[idx].bg_g = bg.g;
        snap[idx].bg_b = bg.b;
        snap[idx].has_bg = true;
    }
    if (node.text_color) |tc| {
        snap[idx].tc_r = tc.r;
        snap[idx].tc_g = tc.g;
        snap[idx].tc_b = tc.b;
        snap[idx].has_tc = true;
    }

    count.* += 1;

    for (node.children) |*child| {
        snapshotStyles(child, snap, count, depth + 1);
    }
}

fn diffStyles(before: *const [MAX_STYLE_ENTRIES]StyleEntry, before_count: u16, after: *const [MAX_STYLE_ENTRIES]StyleEntry, after_count: u16) u16 {
    var diffs: u16 = 0;
    const max = @min(before_count, after_count);

    for (0..max) |i| {
        const b = &before[i];
        const a = &after[i];
        var node_changed = false;

        if (b.w != a.w or b.h != a.h or b.x != a.x or b.y != a.y) node_changed = true;
        if (b.padding_top != a.padding_top or b.padding_bottom != a.padding_bottom) node_changed = true;
        if (b.padding_left != a.padding_left or b.padding_right != a.padding_right) node_changed = true;
        if (b.border_radius != a.border_radius) node_changed = true;
        if (b.border_width != a.border_width) node_changed = true;
        if (b.gap != a.gap) node_changed = true;
        if (b.font_size != a.font_size) node_changed = true;
        if (b.bg_r != a.bg_r or b.bg_g != a.bg_g or b.bg_b != a.bg_b or b.has_bg != a.has_bg) node_changed = true;
        if (b.tc_r != a.tc_r or b.tc_g != a.tc_g or b.tc_b != a.tc_b or b.has_tc != a.has_tc) node_changed = true;

        if (node_changed) {
            diffs += 1;
            const name = if (b.text_len > 0) b.text[0..b.text_len] else "(box)";
            log.print("    changed: \"{s}\" d={d}", .{ name, b.depth });
            if (b.padding_top != a.padding_top) log.print(" pad:{d:.0}→{d:.0}", .{ b.padding_top, a.padding_top });
            if (b.border_radius != a.border_radius) log.print(" radius:{d:.0}→{d:.0}", .{ b.border_radius, a.border_radius });
            if (b.gap != a.gap) log.print(" gap:{d:.0}→{d:.0}", .{ b.gap, a.gap });
            if (b.w != a.w) log.print(" w:{d:.0}→{d:.0}", .{ b.w, a.w });
            if (b.h != a.h) log.print(" h:{d:.0}→{d:.0}", .{ b.h, a.h });
            log.print("\n", .{});
        }
    }

    // Also flag if node count changed
    if (before_count != after_count) {
        log.print("    node count: {d} → {d}\n", .{ before_count, after_count });
        diffs += 1;
    }

    return diffs;
}

fn auditSourceTexts(io: std.Io, environ: *const std.process.Environ.Map, root: *Node) void {
    // Read the .tsz source files and extract quoted strings.
    // Compare against what's actually rendering. Missing text = FAIL.
    const source_env = environ.get("ZIGOS_SOURCE") orelse return;

    // Read all source files (colon-separated)
    var src_buf: [32768]u8 = undefined;
    var total_len: usize = 0;
    var paths = std.mem.splitScalar(u8, source_env, ':');
    while (paths.next()) |source_path| {
        if (source_path.len == 0) continue;
        const file = std.Io.Dir.cwd().openFile(io, source_path, .{}) catch continue;
        defer file.close(io);
        const remaining = src_buf[total_len..];
        const read = file.readPositionalAll(io, remaining, 0) catch 0;
        total_len += read;
        if (total_len < src_buf.len) {
            src_buf[total_len] = '\n';
            total_len += 1;
        }
    }
    if (total_len == 0) return;
    const source = src_buf[0..total_len];

    // Extract static strings from: <Text ...>STRING</Text> patterns
    // and from script data like: { title: 'Revenue', value: '$12.4k' }
    // Strategy: find all single-quoted and double-quoted string literals that look like content
    var expected_texts: [128][TEXT_LEN]u8 = undefined;
    var expected_lens: [128]u16 = undefined;
    var expected_count: u16 = 0;

    var i: usize = 0;
    while (i < source.len and expected_count < 128) {
        // Look for quoted strings that are likely visible text content
        if (source[i] == '\'' or source[i] == '"') {
            const quote = source[i];
            const start = i + 1;
            i += 1;
            while (i < source.len and source[i] != quote and source[i] != '\n') : (i += 1) {}
            if (i < source.len and source[i] == quote) {
                const text = source[start..i];
                // Filter: skip short strings, CSS values, hex colors, import paths, etc.
                if (text.len >= 3 and text.len <= TEXT_LEN and
                    !std.mem.startsWith(u8, text, "#") and
                    !std.mem.startsWith(u8, text, "./") and
                    !std.mem.startsWith(u8, text, "theme-") and
                    !std.mem.startsWith(u8, text, "100%") and
                    std.mem.indexOf(u8, text, "backgroundColor") == null and
                    std.mem.indexOf(u8, text, "flexDirection") == null and
                    std.mem.indexOf(u8, text, "spaceBetween") == null and
                    std.mem.indexOf(u8, text, ".tsz") == null and
                    std.mem.indexOf(u8, text, ".cls") == null and
                    std.mem.indexOf(u8, text, ".script") == null and
                    !isStyleValue(text))
                {
                    const idx = expected_count;
                    const copy_len = @min(text.len, TEXT_LEN);
                    @memcpy(expected_texts[idx][0..copy_len], text[0..copy_len]);
                    expected_lens[idx] = @intCast(copy_len);
                    expected_count += 1;
                }
            }
        }
        i += 1;
    }

    if (expected_count == 0) return;

    // Also collect current frame's texts
    collectSeenTexts(root);

    log.print("\n  ── Source Text Audit ──\n", .{});
    var found: u16 = 0;
    var missing: u16 = 0;

    for (0..expected_count) |si| {
        const text = expected_texts[si][0..expected_lens[si]];
        if (wasEverSeen(text)) {
            found += 1;
        } else {
            missing += 1;
            log.print("    NEVER SEEN: \"{s}\"\n", .{text});
        }
    }

    // Append to manifest
    const remaining = auto_manifest_buf[auto_manifest_len..];
    const written = std.fmt.bufPrint(remaining, "SOURCE_AUDIT|{d} expected|{d} found|{d} missing\n", .{
        expected_count, found, missing,
    }) catch return;
    auto_manifest_len += written.len;

    if (missing > 0) {
        log.print("  source audit: {d}/{d} source texts ever appeared ({d} NEVER SEEN)\n", .{ found, expected_count, missing });
        auto_failed += missing;
    } else {
        log.print("  source audit: {d}/{d} source texts appeared during test\n", .{ found, expected_count });
    }
}

fn isStyleValue(text: []const u8) bool {
    // Filter out CSS-like values: "row", "center", "column", etc.
    const style_words = [_][]const u8{
        "row",          "column",      "center",      "flex-start",
        "flex-end",     "stretch",     "wrap",        "nowrap",
        "absolute",     "relative",    "hidden",      "visible",
        "none",         "solid",       "dashed",      "init",
        "spaceBetween", "spaceAround", "spaceEvenly", "flexStart",
        "flexEnd",      "flexGrow",    "alignItems",  "justifyContent",
        "borderRadius", "padding",     "gap",         "width",
        "height",       "auto",
    };
    for (style_words) |w| {
        if (std.mem.eql(u8, text, w)) return true;
    }
    return false;
}

fn auditColors(root: *Node) void {
    log.print("\n  ── Color Audit ──\n", .{});
    var count: u16 = 0;
    var missing: u16 = 0;
    auditColorsRecurse(root, &count, &missing);

    // Append summary to manifest
    const remaining = auto_manifest_buf[auto_manifest_len..];
    const written = std.fmt.bufPrint(remaining, "COLOR_AUDIT|{d} text nodes|{d} with color|{d} missing\n", .{
        count, count - missing, missing,
    }) catch return;
    auto_manifest_len += written.len;

    if (missing == 0) {
        log.print("  color audit: {d}/{d} text nodes have color set\n", .{ count, count });
    } else {
        log.print("  color audit: {d}/{d} text nodes missing color ({d} unset)\n", .{ count - missing, count, missing });
    }
}

fn auditColorsRecurse(node: *Node, count: *u16, missing: *u16) void {
    if (node.style.display == .none) return;
    if (node.text) |txt| {
        count.* += 1;
        if (node.text_color) |tc| {
            var hex: [7]u8 = undefined;
            const hex_str = colorToHex(tc, &hex);
            // Append each node's color to manifest
            const remaining = auto_manifest_buf[auto_manifest_len..];
            const trunc_len = @min(txt.len, @as(usize, 40));
            const written = std.fmt.bufPrint(remaining, "COLOR|{s}|{s}\n", .{
                hex_str, txt[0..trunc_len],
            }) catch return;
            auto_manifest_len += written.len;
        } else {
            missing.* += 1;
            const remaining = auto_manifest_buf[auto_manifest_len..];
            const trunc_len = @min(txt.len, @as(usize, 40));
            const written = std.fmt.bufPrint(remaining, "COLOR|NONE|{s}\n", .{
                txt[0..trunc_len],
            }) catch return;
            auto_manifest_len += written.len;
        }
    }
    for (node.children) |*child| {
        auditColorsRecurse(child, count, missing);
    }
}

fn dist2d(x1: f32, y1: f32, x2: f32, y2: f32) f32 {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy; // squared distance is fine for comparison
}

fn finishReplay() bool {
    const total = replay_passed + replay_failed;
    log.print("\n\xe2\x95\x90\xe2\x95\x90 WITNESS RESULT: {d}/{d} passed \xe2\x95\x90\xe2\x95\x90\n\n", .{ replay_passed, total });
    return true; // signal engine to exit
}

fn printStateDiff(expected: *const StateSnapshot, actual: *const StateSnapshot) void {
    const max = @max(expected.count, actual.count);
    for (0..max) |i| {
        if (i >= expected.count or i >= actual.count) {
            log.print("    slot[{d}]: count mismatch\n", .{i});
            continue;
        }
        const e = &expected.slots[i];
        const a = &actual.slots[i];
        if (e.kind != a.kind) {
            log.print("    slot[{d}]: kind mismatch\n", .{i});
            continue;
        }
        switch (e.kind) {
            .int => {
                if (e.int_val != a.int_val)
                    log.print("    slot[{d}]: expected {d}, got {d}\n", .{ i, e.int_val, a.int_val });
            },
            .float => {
                if (@abs(e.float_val - a.float_val) > 0.001)
                    log.print("    slot[{d}]: expected {d:.3}, got {d:.3}\n", .{ i, e.float_val, a.float_val });
            },
            .boolean => {
                if (e.bool_val != a.bool_val)
                    log.print("    slot[{d}]: expected {}, got {}\n", .{ i, e.bool_val, a.bool_val });
            },
            .string => {
                const es = e.str_buf[0..e.str_len];
                const as = a.str_buf[0..a.str_len];
                if (!std.mem.eql(u8, es, as))
                    log.print("    slot[{d}]: expected \"{s}\", got \"{s}\"\n", .{ i, es, as });
            },
        }
    }
}

// ── File I/O ────────────────────────────────────────────────────────────

/// Write the witness recording to disk.
pub fn flush(io: std.Io) void {
    if (mode != .record) return;
    if (!tree_captured and action_count == 0) return;

    const path = witness_path orelse {
        log.print("[witness] no ZIGOS_WITNESS_FILE set, cannot save\n", .{});
        return;
    };

    const file = std.Io.Dir.cwd().createFile(io, path, .{ .truncate = true }) catch |err| {
        log.print("[witness] cannot create {s}: {}\n", .{ path, err });
        return;
    };
    defer file.close(io);

    var buf: [4096]u8 = undefined;

    // Header
    emit(io, file, &buf, "WITNESS v1\n", .{});
    emit(io, file, &buf, "SLOTS {d}\n", .{initial_state.count});

    // Initial state (zig slots)
    emit(io, file, &buf, "STATE_INIT\n", .{});
    writeStateToFile(io, file, &buf, &initial_state);
    emit(io, file, &buf, "END\n", .{});

    // Initial visible text
    emit(io, file, &buf, "TEXTS_INIT {d}\n", .{initial_texts.count});
    writeTextsToFile(io, file, &buf, &initial_texts);
    emit(io, file, &buf, "END\n", .{});

    // Tree
    if (tree_captured) {
        emit(io, file, &buf, "TREE {d}\n", .{tree_node_count});
        for (0..tree_node_count) |i| {
            const tn = &tree_nodes[i];
            const name = tn.name_buf[0..tn.name_len];
            const txt = tn.text_buf[0..tn.text_len];
            emit(io, file, &buf, "N {d} {d:.0} {d:.0} {d:.0} {d:.0} {d} {d}:{s} {d}:{s}\n", .{
                tn.depth,                              tn.x,     tn.y, tn.w,    tn.h,
                @as(u8, if (tn.has_handler) 1 else 0), name.len, name, txt.len, txt,
            });
        }
        emit(io, file, &buf, "END\n", .{});
    }

    // Actions
    for (0..action_count) |i| {
        const a = &actions[i];
        switch (a.kind) {
            .click => {
                const aname = a.target_name[0..a.target_name_len];
                const atxt = a.target_text[0..a.target_text_len];
                emit(io, file, &buf, "CLICK {d} {d}:{s} {d}:{s} P{d:.0},{d:.0}\n", .{
                    a.frame, aname.len, aname, atxt.len, atxt, a.target_x, a.target_y,
                });
                emit(io, file, &buf, "STATE_AFTER\n", .{});
                writeStateToFile(io, file, &buf, &a.state_after);
                emit(io, file, &buf, "END\n", .{});
                emit(io, file, &buf, "TEXTS_AFTER {d}\n", .{a.texts_after.count});
                writeTextsToFile(io, file, &buf, &a.texts_after);
                emit(io, file, &buf, "END\n", .{});
            },
            .scroll => {
                emit(io, file, &buf, "SCROLL {d} {d:.1} {d:.1} {d:.0} {d:.0}\n", .{
                    a.frame, a.scroll_x, a.scroll_y, a.mouse_x, a.mouse_y,
                });
            },
        }
    }

    emit(io, file, &buf, "DONE\n", .{});

    log.print("[witness] saved {d} tree nodes + {d} actions to {s}\n", .{
        tree_node_count, action_count, path,
    });
}

fn emit(io: std.Io, file: std.Io.File, buf: []u8, comptime fmt: []const u8, args: anytype) void {
    const s = std.fmt.bufPrint(buf, fmt, args) catch return;
    file.writeStreamingAll(io, s) catch {};
}

fn writeTextsToFile(io: std.Io, file: std.Io.File, buf: []u8, snap: *const TextSnapshot) void {
    for (0..snap.count) |i| {
        const t = &snap.texts[i];
        const tv = t.buf[0..t.len];
        emit(io, file, buf, "T {d}:{s}\n", .{ tv.len, tv });
    }
}

fn writeStateToFile(io: std.Io, file: std.Io.File, buf: []u8, snap: *const StateSnapshot) void {
    for (0..snap.count) |i| {
        const s = &snap.slots[i];
        switch (s.kind) {
            .int => emit(io, file, buf, "I {d}\n", .{s.int_val}),
            .float => emit(io, file, buf, "F {d:.6}\n", .{s.float_val}),
            .boolean => emit(io, file, buf, "B {d}\n", .{@as(u8, if (s.bool_val) 1 else 0)}),
            .string => {
                const sv = s.str_buf[0..s.str_len];
                emit(io, file, buf, "S {d}:{s}\n", .{ sv.len, sv });
            },
        }
    }
}

// ── Load witness file for replay ────────────────────────────────────────

fn loadWitness(io: std.Io) void {
    const path = witness_path orelse {
        log.print("[witness] no ZIGOS_WITNESS_FILE set for replay\n", .{});
        mode = .off;
        return;
    };

    const data = std.Io.Dir.cwd().readFileAlloc(io, path, std.heap.page_allocator, .limited(4 * 1024 * 1024)) catch |err| {
        log.print("[witness] cannot read {s}: {}\n", .{ path, err });
        mode = .off;
        return;
    };

    var lines = std.mem.splitScalar(u8, data, '\n');
    var in_state_init = false;
    var in_state_after = false;
    var in_tree = false;
    var in_texts_init = false;
    var in_texts_after = false;
    var state_slot_idx: u16 = 0;
    var current_action: ?*Action = null;
    var action_state_idx: u16 = 0;
    var texts_idx: u16 = 0;

    while (lines.next()) |line| {
        if (line.len == 0) continue;

        if (std.mem.eql(u8, line, "END")) {
            if (in_texts_init) {
                replay_initial_texts.count = texts_idx;
            }
            if (in_texts_after) {
                if (current_action) |a| {
                    a.texts_after.count = texts_idx;
                }
                // TEXTS_AFTER is the last section per action — clear current_action
                current_action = null;
            }
            if (in_state_after) {
                if (current_action) |a| {
                    a.state_after.count = action_state_idx;
                }
                // Don't clear current_action here — TEXTS_AFTER still needs it
            }
            in_state_init = false;
            in_state_after = false;
            in_tree = false;
            in_texts_init = false;
            in_texts_after = false;
            continue;
        }

        if (std.mem.eql(u8, line, "STATE_INIT")) {
            in_state_init = true;
            state_slot_idx = 0;
            continue;
        }

        if (std.mem.eql(u8, line, "STATE_AFTER")) {
            in_state_after = true;
            action_state_idx = 0;
            continue;
        }

        if (std.mem.startsWith(u8, line, "TEXTS_INIT ")) {
            in_texts_init = true;
            texts_idx = 0;
            continue;
        }

        if (std.mem.startsWith(u8, line, "TEXTS_AFTER ")) {
            in_texts_after = true;
            texts_idx = 0;
            continue;
        }

        if (std.mem.startsWith(u8, line, "TREE ")) {
            in_tree = true;
            replay_tree_count = 0;
            continue;
        }

        // Parse text lines (T <len>:<data>)
        if (in_texts_init or in_texts_after) {
            if (line[0] == 'T' and line.len > 2) {
                const snap = if (in_texts_init) &replay_initial_texts else if (current_action) |a| &a.texts_after else continue;
                if (texts_idx >= MAX_TEXTS) continue;
                const rest = line[2..];
                if (std.mem.indexOfScalar(u8, rest, ':')) |colon| {
                    const tlen = std.fmt.parseInt(u16, rest[0..colon], 10) catch 0;
                    const tdata = rest[colon + 1 ..];
                    const copy_len = @min(tlen, @as(u16, @intCast(@min(tdata.len, TEXT_LEN))));
                    @memcpy(snap.texts[texts_idx].buf[0..copy_len], tdata[0..copy_len]);
                    snap.texts[texts_idx].len = copy_len;
                    texts_idx += 1;
                }
            }
            continue;
        }

        // Parse state lines (I/F/B/S)
        if (in_state_init or in_state_after) {
            const snap = if (in_state_init) &replay_initial_state else if (current_action) |a| &a.state_after else continue;
            const idx = if (in_state_init) state_slot_idx else action_state_idx;

            if (idx >= MAX_SLOTS) continue;

            if (line[0] == 'I' and line.len > 2) {
                snap.slots[idx].kind = .int;
                snap.slots[idx].int_val = std.fmt.parseInt(i64, std.mem.trim(u8, line[2..], " "), 10) catch 0;
            } else if (line[0] == 'F' and line.len > 2) {
                snap.slots[idx].kind = .float;
                snap.slots[idx].float_val = std.fmt.parseFloat(f64, std.mem.trim(u8, line[2..], " ")) catch 0;
            } else if (line[0] == 'B' and line.len > 2) {
                snap.slots[idx].kind = .boolean;
                snap.slots[idx].bool_val = line[2] == '1';
            } else if (line[0] == 'S' and line.len > 2) {
                snap.slots[idx].kind = .string;
                // Parse "S <len>:<data>"
                const rest = line[2..];
                if (std.mem.indexOfScalar(u8, rest, ':')) |colon| {
                    const slen = std.fmt.parseInt(u16, rest[0..colon], 10) catch 0;
                    const sdata = rest[colon + 1 ..];
                    const copy_len = @min(slen, @as(u16, @intCast(@min(sdata.len, TEXT_LEN))));
                    @memcpy(snap.slots[idx].str_buf[0..copy_len], sdata[0..copy_len]);
                    snap.slots[idx].str_len = copy_len;
                }
            }

            if (in_state_init) {
                state_slot_idx += 1;
                replay_initial_state.count = state_slot_idx;
            } else {
                action_state_idx += 1;
            }
            continue;
        }

        // Parse tree nodes
        if (in_tree) {
            if (line[0] == 'N' and line.len > 2) {
                if (replay_tree_count >= MAX_TREE_NODES) continue;
                // Minimal parse — just count for now
                replay_tree_count += 1;
            }
            continue;
        }

        // Parse CLICK lines
        if (std.mem.startsWith(u8, line, "CLICK ")) {
            if (replay_action_count >= MAX_ACTIONS) continue;
            const idx = replay_action_count;
            replay_action_count += 1;
            replay_actions[idx] = .{};
            current_action = &replay_actions[idx];

            // Parse "CLICK <frame> <name_len>:<name> <text_len>:<text>"
            // Use positional parsing — name and text can contain spaces.
            const rest = line[6..];

            // Frame number ends at first space
            const frame_end = std.mem.indexOfScalar(u8, rest, ' ') orelse continue;
            replay_actions[idx].frame = std.fmt.parseInt(u32, rest[0..frame_end], 10) catch 0;

            // Name field: <name_len>:<name>
            var pos = frame_end + 1;
            const name_colon = std.mem.indexOfScalarPos(u8, rest, pos, ':') orelse continue;
            const nlen = std.fmt.parseInt(u8, rest[pos..name_colon], 10) catch 0;
            if (nlen > 0) {
                const name_data = rest[name_colon + 1 ..];
                const copy_len = @min(nlen, @as(u8, @intCast(@min(name_data.len, NAME_LEN))));
                @memcpy(replay_actions[idx].target_name[0..copy_len], name_data[0..copy_len]);
                replay_actions[idx].target_name_len = copy_len;
            }
            // Advance past name field: colon + nlen + trailing space
            pos = name_colon + 1 + nlen;
            if (pos < rest.len and rest[pos] == ' ') pos += 1;

            // Text field: <text_len>:<text>
            if (pos >= rest.len) continue;
            const text_colon = std.mem.indexOfScalarPos(u8, rest, pos, ':') orelse continue;
            const tlen = std.fmt.parseInt(u16, rest[pos..text_colon], 10) catch 0;
            if (tlen > 0) {
                const text_data = rest[text_colon + 1 ..];
                const copy_len = @min(tlen, @as(u16, @intCast(@min(text_data.len, TEXT_LEN))));
                @memcpy(replay_actions[idx].target_text[0..copy_len], text_data[0..copy_len]);
                replay_actions[idx].target_text_len = copy_len;
            }

            // Optional position for disambiguation: " P<x>,<y>" or legacy " Y<y>"
            const p_pos = text_colon + 1 + tlen;
            if (p_pos + 2 < rest.len and rest[p_pos] == ' ') {
                if (rest[p_pos + 1] == 'P') {
                    const coords = rest[p_pos + 2 ..];
                    if (std.mem.indexOfScalar(u8, coords, ',')) |comma| {
                        replay_actions[idx].target_x = std.fmt.parseFloat(f32, coords[0..comma]) catch 0;
                        replay_actions[idx].target_y = std.fmt.parseFloat(f32, coords[comma + 1 ..]) catch 0;
                    }
                } else if (rest[p_pos + 1] == 'Y') {
                    // Legacy format
                    replay_actions[idx].target_y = std.fmt.parseFloat(f32, rest[p_pos + 2 ..]) catch 0;
                }
            }
            continue;
        }

        // Parse SCROLL lines: "SCROLL <frame> <sx> <sy> <mx> <my>"
        if (std.mem.startsWith(u8, line, "SCROLL ")) {
            if (replay_action_count >= MAX_ACTIONS) continue;
            const idx = replay_action_count;
            replay_action_count += 1;
            replay_actions[idx] = .{};
            replay_actions[idx].kind = .scroll;

            const rest = line[7..];
            var parts = std.mem.splitScalar(u8, rest, ' ');
            if (parts.next()) |f| replay_actions[idx].frame = std.fmt.parseInt(u32, f, 10) catch 0;
            if (parts.next()) |v| replay_actions[idx].scroll_x = std.fmt.parseFloat(f32, v) catch 0;
            if (parts.next()) |v| replay_actions[idx].scroll_y = std.fmt.parseFloat(f32, v) catch 0;
            if (parts.next()) |v| replay_actions[idx].mouse_x = std.fmt.parseFloat(f32, v) catch 0;
            if (parts.next()) |v| replay_actions[idx].mouse_y = std.fmt.parseFloat(f32, v) catch 0;
            continue;
        }

        // SLOTS line
        if (std.mem.startsWith(u8, line, "SLOTS ")) continue; // informational
        if (std.mem.eql(u8, line, "DONE")) break;
    }

    log.print("[witness] loaded: {d} tree nodes, {d} actions, {d} state slots\n", .{
        replay_tree_count, replay_action_count, replay_initial_state.count,
    });
}
