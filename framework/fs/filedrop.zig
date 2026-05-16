//! File drop event system — generic SDL_DROPFILE dispatch.
//!
//! Any framework module can subscribe to file drops. The engine calls
//! dispatch() when SDL_DROPFILE fires; all registered subscribers are
//! notified with the absolute file path and a pointer to the app root
//! node (so subscribers can patch the tree if needed).
//!
//! Usage from a module:
//!   filedrop.subscribe(myHandler);
//!
//! The handler signature:
//!   fn(path: []const u8, root: *Node) void
//!
//! The path is valid for the lifetime of the application (copied into a
//! persistent buffer). Subscribers are called synchronously in registration
//! order.

const std = @import("std");
const log = @import("../diag/log.zig");
const layout = @import("../layout.zig");
const state = @import("../state/dirty.zig");
const Node = layout.Node;

// ════════════════════════════════════════════════════════════════════════
// Subscriber registry
// ════════════════════════════════════════════════════════════════════════

pub const FileDropHandler = *const fn (path: []const u8, root: *Node) void;

const MAX_SUBSCRIBERS = 8;
var subscribers: [MAX_SUBSCRIBERS]FileDropHandler = undefined;
var subscriber_count: usize = 0;

/// Register a handler to be called on every file drop.
pub fn subscribe(handler: FileDropHandler) void {
    if (subscriber_count >= MAX_SUBSCRIBERS) {
        log.print("[filedrop] max subscribers reached ({d})\n", .{MAX_SUBSCRIBERS});
        return;
    }
    subscribers[subscriber_count] = handler;
    subscriber_count += 1;
}

// ════════════════════════════════════════════════════════════════════════
// Persistent path buffer
// ════════════════════════════════════════════════════════════════════════

var path_buf: [4096]u8 = undefined;
var last_path: ?[]const u8 = null;
var drop_seq: u64 = 0;

/// The most recently dropped file path, or null if nothing has been dropped.
pub fn getLastPath() ?[]const u8 {
    return last_path;
}

/// Monotonic counter — increments on every dispatch. JS hooks compare
/// against the prior frame's value to detect new drops without string
/// comparisons.
pub fn getDropSeq() u64 {
    return drop_seq;
}

// ════════════════════════════════════════════════════════════════════════
// Dispatch — called by the engine on SDL_DROPFILE
// ════════════════════════════════════════════════════════════════════════

/// Handle a file drop. Copies the path to a persistent buffer, then
/// notifies all subscribers. The engine passes the null-terminated C
/// string from SDL directly; this function takes a Zig slice.
pub fn dispatch(path: []const u8, root: *Node) void {
    if (path.len == 0 or path.len >= path_buf.len) return;

    // Copy to persistent buffer so subscribers can store the slice
    @memcpy(path_buf[0..path.len], path);
    last_path = path_buf[0..path.len];
    drop_seq +%= 1;

    log.print("[filedrop] {s} → {d} subscriber(s)\n", .{ last_path.?, subscriber_count });

    for (subscribers[0..subscriber_count]) |handler| {
        handler(last_path.?, root);
    }

    // Wake React so polling hooks (useFileDrop) re-render and observe the
    // new drop_seq.
    state.markDirty();
}
