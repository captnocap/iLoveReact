//! Test assertions + layout audit.
//!
//! Assertion functions for verifying node visibility, text content,
//! and layout geometry. Plus a layout auditor that detects common
//! violations: child overflow, sibling overlap, off-viewport nodes.

const std = @import("std");
const log = @import("../diag/log.zig");
const layout = @import("../layout.zig");
const Node = layout.Node;
const query = @import("query.zig");
const QueryResult = query.QueryResult;
const QueryOpts = query.QueryOpts;

pub const AssertError = error{
    NotVisible,
    Visible,
    TextMismatch,
    NoText,
    TextNotFound,
    RectMismatch,
    WidthMismatch,
    HeightMismatch,
    NotFound,
    CountMismatch,
};

pub const TestStatus = enum { pass, fail, skip };

pub const TestResult = struct {
    name: []const u8 = "",
    status: TestStatus = .pass,
    error_msg: ?[]const u8 = null,
};

pub const ViolationKind = enum { child_overflow, sibling_overlap, off_viewport };

pub const Violation = struct {
    kind: ViolationKind = .child_overflow,
    node: *Node = undefined,
    message: [256]u8 = undefined,
    msg_len: u8 = 0,

    pub fn getMessage(self: *const Violation) []const u8 {
        return self.message[0..self.msg_len];
    }
};

// ── Assertions ──

pub fn expectVisible(result: QueryResult) AssertError!void {
    if (result.w <= 0 or result.h <= 0) return error.NotVisible;
}

pub fn expectHidden(result: QueryResult) AssertError!void {
    if (result.w > 0 and result.h > 0 and result.node.style.display != .none)
        return error.Visible;
}

pub fn expectText(node: *Node, expected: []const u8) AssertError!void {
    const nt = node.text orelse return error.NoText;
    if (!std.mem.eql(u8, nt, expected)) return error.TextMismatch;
}

pub fn expectContainsText(node: *Node, substring: []const u8) AssertError!void {
    const nt = node.text orelse return error.NoText;
    if (std.mem.indexOf(u8, nt, substring) == null) return error.TextNotFound;
}

pub fn expectRect(result: QueryResult, ex: f32, ey: f32, ew: f32, eh: f32) AssertError!void {
    const tol: f32 = 1.0;
    if (@abs(result.x - ex) > tol or @abs(result.y - ey) > tol or
        @abs(result.w - ew) > tol or @abs(result.h - eh) > tol)
        return error.RectMismatch;
}

pub fn expectWidth(result: QueryResult, expected: f32) AssertError!void {
    if (@abs(result.w - expected) > 1.0) return error.WidthMismatch;
}

pub fn expectHeight(result: QueryResult, expected: f32) AssertError!void {
    if (@abs(result.h - expected) > 1.0) return error.HeightMismatch;
}

pub fn expectExists(root: *Node, opts: QueryOpts) AssertError!void {
    if (query.find(root, opts) == null) return error.NotFound;
}

pub fn expectCount(root: *Node, opts: QueryOpts, expected: usize) AssertError!void {
    if (query.countMatches(root, opts) != expected) return error.CountMismatch;
}

// ── Layout audit ──

pub fn audit(root: *Node, viewport_w: f32, viewport_h: f32, out: []Violation) usize {
    var count: usize = 0;
    auditRecurse(root, viewport_w, viewport_h, out, &count);
    return count;
}

fn auditRecurse(node: *Node, viewport_w: f32, viewport_h: f32, out: []Violation, count: *usize) void {
    if (node.style.display == .none) return;
    if (count.* >= out.len) return;

    const r = node.computed;

    // Off-viewport check
    if (r.w > 0 and r.h > 0) {
        if (r.x + r.w < 0 or r.y + r.h < 0 or r.x > viewport_w or r.y > viewport_h) {
            writeViolation(out, count, .off_viewport, node, "off-viewport: at ({d:.0},{d:.0} {d:.0}x{d:.0})", .{ r.x, r.y, r.w, r.h });
        }
    }

    // Child overflow + sibling overlap
    for (node.children, 0..) |*child, ci| {
        if (child.style.display == .none) continue;
        if (child.style.position == .absolute) continue;
        const cr = child.computed;

        // Overflow check (only for non-visible overflow parents)
        if (node.style.overflow != .visible and cr.w > 0 and cr.h > 0) {
            if (cr.x + cr.w > r.x + r.w + 2 or cr.y + cr.h > r.y + r.h + 2 or
                cr.x < r.x - 2 or cr.y < r.y - 2)
            {
                writeViolation(out, count, .child_overflow, child, "child overflow: ({d:.0}x{d:.0}) in ({d:.0}x{d:.0})", .{ cr.w, cr.h, r.w, r.h });
            }
        }

        if (cr.w <= 0 or cr.h <= 0) continue;

        // Sibling overlap
        for (node.children[ci + 1 ..]) |*sibling| {
            if (sibling.style.display == .none) continue;
            if (sibling.style.position == .absolute) continue;
            const sr = sibling.computed;
            if (sr.w <= 0 or sr.h <= 0) continue;
            const overlap_x = @min(cr.x + cr.w, sr.x + sr.w) - @max(cr.x, sr.x);
            const overlap_y = @min(cr.y + cr.h, sr.y + sr.h) - @max(cr.y, sr.y);
            if (overlap_x > 2 and overlap_y > 2) {
                writeViolation(out, count, .sibling_overlap, child, "sibling overlap: {d:.0}x{d:.0}px", .{ overlap_x, overlap_y });
            }
        }
    }

    for (node.children) |*child| {
        auditRecurse(child, viewport_w, viewport_h, out, count);
    }
}

fn writeViolation(out: []Violation, count: *usize, kind: ViolationKind, node: *Node, comptime fmt: []const u8, args: anytype) void {
    if (count.* >= out.len) return;
    var v = &out[count.*];
    v.kind = kind;
    v.node = node;
    const result = std.fmt.bufPrint(&v.message, fmt, args) catch {
        v.msg_len = 0;
        count.* += 1;
        return;
    };
    v.msg_len = @intCast(result.len);
    count.* += 1;
}

// ── Result printing ──

pub fn printResult(result: TestResult) void {
    const status_str: []const u8 = switch (result.status) {
        .pass => "PASS",
        .fail => "FAIL",
        .skip => "SKIP",
    };
    log.print("TEST {s} ... {s}", .{ result.name, status_str });
    if (result.error_msg) |msg| {
        log.print(" ({s})", .{msg});
    }
    log.print("\n", .{});
}

pub fn printSummary(results: []const TestResult) void {
    var passed: usize = 0;
    var failed: usize = 0;
    var skipped: usize = 0;
    for (results) |r| {
        switch (r.status) {
            .pass => passed += 1,
            .fail => failed += 1,
            .skip => skipped += 1,
        }
    }
    log.print("\n{d}/{d} tests passed", .{ passed, passed + failed });
    if (skipped > 0) log.print(" ({d} skipped)", .{skipped});
    log.print("\n", .{});
}
