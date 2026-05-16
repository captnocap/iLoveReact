//! Router — memory history + pattern matcher for compile-time routing.
//!
//! The .tsz compiler detects <Routes>/<Route> and emits display-toggle
//! code that calls into this module. No React Context, no runtime
//! reconciliation — just a path string and a match function.
//!
//! Zero allocations. Fixed-size history stack + segment matching.

const std = @import("std");
const log = @import("../diag/log.zig");

// ── Memory History ──────────────────────────────────────────────────

const MAX_HISTORY = 64;
const MAX_PATH_LEN = 256;

var history: [MAX_HISTORY][MAX_PATH_LEN]u8 = undefined;
var history_lens: [MAX_HISTORY]u16 = [_]u16{0} ** MAX_HISTORY;
var history_count: usize = 0;
var history_index: usize = 0;
var _dirty: bool = false;

pub fn init(initial_path: []const u8) void {
    const len: u16 = @intCast(@min(initial_path.len, MAX_PATH_LEN));
    @memcpy(history[0][0..len], initial_path[0..len]);
    history_lens[0] = len;
    history_count = 1;
    history_index = 0;
    _dirty = true;
    log.info(.engine, "router init: {s}", .{initial_path});
}

/// Push a new path, truncating forward history (standard browser behavior).
pub fn push(path: []const u8) void {
    // Truncate forward entries
    history_count = history_index + 1;
    if (history_count < MAX_HISTORY) {
        const len: u16 = @intCast(@min(path.len, MAX_PATH_LEN));
        @memcpy(history[history_count][0..len], path[0..len]);
        history_lens[history_count] = len;
        history_count += 1;
        history_index = history_count - 1;
        _dirty = true;
        log.info(.engine, "router push: {s}", .{path});
    }
}

/// Replace current entry without adding to history stack.
pub fn replace(path: []const u8) void {
    const len: u16 = @intCast(@min(path.len, MAX_PATH_LEN));
    @memcpy(history[history_index][0..len], path[0..len]);
    history_lens[history_index] = len;
    _dirty = true;
    log.info(.engine, "router replace: {s}", .{path});
}

/// Go back one entry.
pub fn back() void {
    if (history_index > 0) {
        history_index -= 1;
        _dirty = true;
        log.info(.engine, "router back -> {s}", .{currentPath()});
    }
}

/// Go forward one entry.
pub fn forward() void {
    if (history_index + 1 < history_count) {
        history_index += 1;
        _dirty = true;
        log.info(.engine, "router forward -> {s}", .{currentPath()});
    }
}

/// Return the current path.
pub fn currentPath() []const u8 {
    const len = history_lens[history_index];
    return history[history_index][0..len];
}

pub fn isDirty() bool {
    return _dirty;
}

pub fn clearDirty() void {
    _dirty = false;
}

// ── Pattern Matcher ─────────────────────────────────────────────────

pub const Param = struct {
    name: [32]u8 = undefined,
    name_len: u8 = 0,
    value: [128]u8 = undefined,
    value_len: u8 = 0,

    pub fn nameSlice(self: *const Param) []const u8 {
        return self.name[0..self.name_len];
    }

    pub fn valueSlice(self: *const Param) []const u8 {
        return self.value[0..self.value_len];
    }
};

pub const RouteMatch = struct {
    matched: bool = false,
    score: u32 = 0,
    params: [8]Param = [_]Param{.{}} ** 8,
    param_count: u8 = 0,
};

// Current match params (set by updateRoutes in generated code)
var current_params: [8]Param = [_]Param{.{}} ** 8;
var current_param_count: u8 = 0;

pub fn setCurrentMatch(match: *const RouteMatch) void {
    current_params = match.params;
    current_param_count = match.param_count;
}

/// Get a URL param by name (e.g., getParam("id") for :id).
pub fn getParam(name: []const u8) ?[]const u8 {
    for (0..current_param_count) |i| {
        if (std.mem.eql(u8, current_params[i].name[0..current_params[i].name_len], name)) {
            return current_params[i].value[0..current_params[i].value_len];
        }
    }
    return null;
}

/// Match a route pattern against a pathname.
///
/// Scoring (per segment):
///   literal  = 4    `:param`  = 3    `:param?` = 2    `*` = 1
pub fn matchRoute(pattern: []const u8, pathname: []const u8) RouteMatch {
    var result = RouteMatch{};

    // Fast path: no params or wildcards → exact match
    if (std.mem.indexOfScalar(u8, pattern, ':') == null and
        std.mem.indexOfScalar(u8, pattern, '*') == null)
    {
        if (std.mem.eql(u8, pattern, pathname)) {
            result.matched = true;
            // Count non-empty segments for score
            var seg_count: u32 = 0;
            var iter = std.mem.splitScalar(u8, pattern, '/');
            while (iter.next()) |seg| {
                if (seg.len > 0) seg_count += 1;
            }
            result.score = if (seg_count == 0) 4 else seg_count * 4;
        }
        return result;
    }

    // Segment-by-segment matching
    var pat_iter = std.mem.splitScalar(u8, pattern, '/');
    var path_iter = std.mem.splitScalar(u8, pathname, '/');

    // Skip leading empty segments (before first /)
    _ = pat_iter.next();
    _ = path_iter.next();

    while (pat_iter.next()) |pat_seg| {
        if (pat_seg.len == 0) continue;

        if (pat_seg[0] == '*') {
            // Wildcard: matches rest of path
            result.score += 1;
            result.matched = true;
            return result;
        }

        const path_seg = path_iter.next();

        if (pat_seg[0] == ':') {
            // Parameter segment
            const is_optional = pat_seg[pat_seg.len - 1] == '?';
            const param_name = if (is_optional) pat_seg[1 .. pat_seg.len - 1] else pat_seg[1..];

            if (path_seg) |seg| {
                if (seg.len > 0) {
                    // Capture param
                    if (result.param_count < 8) {
                        var p = &result.params[result.param_count];
                        const nlen: u8 = @intCast(@min(param_name.len, 32));
                        @memcpy(p.name[0..nlen], param_name[0..nlen]);
                        p.name_len = nlen;
                        const vlen: u8 = @intCast(@min(seg.len, 128));
                        @memcpy(p.value[0..vlen], seg[0..vlen]);
                        p.value_len = vlen;
                        result.param_count += 1;
                    }
                    result.score += if (is_optional) @as(u32, 2) else @as(u32, 3);
                } else if (is_optional) {
                    result.score += 2;
                } else {
                    return result; // Required param, empty segment
                }
            } else if (is_optional) {
                result.score += 2;
            } else {
                return result; // Required param missing
            }
        } else {
            // Literal segment — exact match required
            if (path_seg) |seg| {
                if (!std.mem.eql(u8, pat_seg, seg)) return result;
                result.score += 4;
            } else {
                return result; // Path too short
            }
        }
    }

    // Ensure path has no extra segments
    while (path_iter.next()) |extra| {
        if (extra.len > 0) return result;
    }

    result.matched = true;
    return result;
}

/// Find the best matching route from an array of patterns.
/// Returns the index of the best match, or null if none match.
pub fn findBestMatch(patterns: []const []const u8, pathname: []const u8) ?usize {
    var best_idx: ?usize = null;
    var best_score: u32 = 0;
    var best_match: RouteMatch = .{};

    for (patterns, 0..) |pattern, i| {
        const m = matchRoute(pattern, pathname);
        if (m.matched and m.score > best_score) {
            best_score = m.score;
            best_idx = i;
            best_match = m;
        }
    }

    // Store params from best match
    if (best_idx != null) {
        setCurrentMatch(&best_match);
    }

    return best_idx;
}

// ── Telemetry ────────────────────────────────────────────────────────────

pub const TelemetryRouterStats = struct {
    history_depth: u32,
    current_index: u32,
};

pub fn telemetryStats() TelemetryRouterStats {
    return .{
        .history_depth = @intCast(history_count),
        .current_index = @intCast(history_index),
    };
}
