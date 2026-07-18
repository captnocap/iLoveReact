//! Unit coverage for framework/diag/diag_registry.zig.
//!
//! These assert BEHAVIOR of the diagnostics ring + cost-tier sampling that the
//! `__diag_emit` door and the in-app console depend on: a disabled channel is a
//! true no-op (cheap branch), a sampled channel keeps exactly 1 of every N
//! lines, the bounded ring evicts oldest-first, recentJson returns the last
//! window chronologically, and the installed sink sees every accepted line.
//!
//! Pure: the registry imports only std (sinks are pointers), so this test links
//! no V8 and no sqlite.
//!
//! INTEGRATION: add to build.zig beside the other unit tests (the layout test is
//! the template, build.zig ~line 927):
//!     const diag_registry_test_mod = b.createModule(.{
//!         .root_source_file = b.path("framework/testing/unit/diag_registry.zig"),
//!         .target = target, .optimize = optimize,
//!     });
//!     diag_registry_test_mod.addImport("diag_registry",
//!         b.createModule(.{ .root_source_file = b.path("framework/diag/diag_registry.zig"),
//!                           .target = target, .optimize = optimize }));
//!     const diag_registry_test = b.addTest(.{ .root_module = diag_registry_test_mod });
//!     const run_diag_registry_test = b.addRunArtifact(diag_registry_test);
//!     b.step("test-diag-registry", "Run the diag registry unit tests")
//!         .dependOn(&run_diag_registry_test.step);
//!
//! Run (do NOT run as part of this workstream — the user runs builds):
//!     zig build test-diag-registry

const std = @import("std");
const testing = std.testing;
const diag = @import("diag_registry");

// ── Sink capture ────────────────────────────────────────────────────────────
var g_sink_hits: usize = 0;
var g_last_line_buf: [2048]u8 = undefined;
var g_last_line_len: usize = 0;

fn captureSink(_: ?*anyopaque, line_json: []const u8) void {
    g_sink_hits += 1;
    const n = @min(line_json.len, g_last_line_buf.len);
    @memcpy(g_last_line_buf[0..n], line_json[0..n]);
    g_last_line_len = n;
}

fn resetAll() void {
    diag.reset();
    diag.setFeedSink(null);
    g_sink_hits = 0;
    g_last_line_len = 0;
}

test "emit records a line and assigns a monotonic seq" {
    resetAll();
    const s1 = diag.emit(std.testing.io, "editor.place", .info, "placed wall", "{\"ms\":3}");
    const s2 = diag.emit(std.testing.io, "editor.place", .warn, "slow place", "{\"ms\":40}");
    try testing.expect(s1 == 1);
    try testing.expect(s2 == 2);
    try testing.expectEqual(@as(u64, 2), diag.ringCount());
    try testing.expectEqual(@as(usize, 1), diag.channelCount());
    try testing.expectEqual(@as(u64, 2), diag.emittedFor("editor.place"));
}

test "disabled channel is a cheap no-op — nothing reaches the ring" {
    resetAll();
    diag.setEnabled("editor.hot", false);
    const seq = diag.emit(std.testing.io, "editor.hot", .debug, "noise", "{}");
    try testing.expectEqual(@as(u64, 0), seq);
    try testing.expectEqual(@as(u64, 0), diag.ringCount());
    try testing.expectEqual(@as(u64, 0), diag.emittedFor("editor.hot"));

    diag.setEnabled("editor.hot", true);
    const seq2 = diag.emit(std.testing.io, "editor.hot", .debug, "now on", "{}");
    try testing.expect(seq2 == 1);
    try testing.expectEqual(@as(u64, 1), diag.ringCount());
}

test "cost-tier sampling keeps 1 of every N accepted lines" {
    resetAll();
    diag.setSampleDiv("editor.frame", 4);
    var i: usize = 0;
    var kept: usize = 0;
    while (i < 12) : (i += 1) {
        const seq = diag.emit(std.testing.io, "editor.frame", .trace, "tick", "{}");
        if (seq != 0) kept += 1;
    }
    // 12 emits, divisor 4 → lines 4, 8, 12 survive.
    try testing.expectEqual(@as(usize, 3), kept);
    try testing.expectEqual(@as(u64, 3), diag.emittedFor("editor.frame"));
    try testing.expectEqual(@as(u64, 9), diag.droppedFor("editor.frame"));
    try testing.expectEqual(@as(u64, 3), diag.ringCount());
}

test "divisor of 1 keeps everything" {
    resetAll();
    diag.setSampleDiv("editor.cheap", 1);
    var i: usize = 0;
    while (i < 5) : (i += 1) _ = diag.emit(std.testing.io, "editor.cheap", .info, "x", "{}");
    try testing.expectEqual(@as(u64, 5), diag.emittedFor("editor.cheap"));
    try testing.expectEqual(@as(u64, 0), diag.droppedFor("editor.cheap"));
}

test "ring evicts oldest, recentJson returns the last window chronologically" {
    resetAll();
    const total = diag.RING_SIZE + 50;
    var i: usize = 0;
    while (i < total) : (i += 1) {
        var msg_buf: [32]u8 = undefined;
        const msg = std.fmt.bufPrint(&msg_buf, "n{d}", .{i}) catch unreachable;
        _ = diag.emit(std.testing.io, "editor.bulk", .info, msg, "{}");
    }
    try testing.expectEqual(@as(u64, total), diag.ringCount());

    const json = try diag.recentJson(testing.allocator, 3);
    defer testing.allocator.free(json);
    // The three newest lines are n(total-3), n(total-2), n(total-1), in order.
    var nb: [40]u8 = undefined;
    const newest = std.fmt.bufPrint(&nb, "\"n{d}\"", .{total - 1}) catch unreachable;
    try testing.expect(std.mem.indexOf(u8, json, newest) != null);
    var ob: [40]u8 = undefined;
    const evicted = std.fmt.bufPrint(&ob, "\"n0\"", .{}) catch unreachable;
    try testing.expect(std.mem.indexOf(u8, json, evicted) == null);
    // Chronological: the third-newest appears before the newest in the string.
    var tb: [40]u8 = undefined;
    const third = std.fmt.bufPrint(&tb, "\"n{d}\"", .{total - 3}) catch unreachable;
    const p_third = std.mem.indexOf(u8, json, third).?;
    const p_new = std.mem.indexOf(u8, json, newest).?;
    try testing.expect(p_third < p_new);
}

test "installed sink sees every accepted line, not sampled-out ones" {
    resetAll();
    diag.setFeedSink(.{ .context = null, .write = captureSink });
    diag.setSampleDiv("editor.s", 3);
    var i: usize = 0;
    while (i < 9) : (i += 1) _ = diag.emit(std.testing.io, "editor.s", .info, "z", "{}");
    // 9 emits / div 3 → 3 accepted → 3 sink hits.
    try testing.expectEqual(@as(usize, 3), g_sink_hits);
    // Last line JSON carries the channel + severity contract fields.
    const line = g_last_line_buf[0..g_last_line_len];
    try testing.expect(std.mem.indexOf(u8, line, "\"ch\":\"editor.s\"") != null);
    try testing.expect(std.mem.indexOf(u8, line, "\"sev\":\"info\"") != null);
    try testing.expect(std.mem.indexOf(u8, line, "\"seq\":") != null);
}

test "msg JSON-escapes quotes and control chars" {
    resetAll();
    _ = diag.emit(std.testing.io, "editor.esc", .info, "he said \"hi\"\n", "{}");
    const json = try diag.recentJson(testing.allocator, 1);
    defer testing.allocator.free(json);
    try testing.expect(std.mem.indexOf(u8, json, "\\\"hi\\\"") != null);
    try testing.expect(std.mem.indexOf(u8, json, "\\n") != null);
}

test "channelsJson reports per-channel host state" {
    resetAll();
    diag.setSampleDiv("editor.a", 2);
    _ = diag.emit(std.testing.io, "editor.a", .info, "x", "{}");
    _ = diag.emit(std.testing.io, "editor.a", .info, "y", "{}"); // 1 kept, 1 dropped
    diag.setEnabled("editor.b", false);
    const json = try diag.channelsJson(testing.allocator);
    defer testing.allocator.free(json);
    try testing.expect(std.mem.indexOf(u8, json, "\"id\":\"editor.a\"") != null);
    try testing.expect(std.mem.indexOf(u8, json, "\"sampleDiv\":2") != null);
    try testing.expect(std.mem.indexOf(u8, json, "\"enabled\":false") != null);
}

test "severityFromStr round-trips the wire vocabulary" {
    try testing.expectEqual(diag.Severity.trace, diag.severityFromStr("trace"));
    try testing.expectEqual(diag.Severity.err, diag.severityFromStr("error"));
    try testing.expectEqual(diag.Severity.info, diag.severityFromStr("bogus"));
    try testing.expectEqualStrings("error", diag.Severity.err.name());
}
