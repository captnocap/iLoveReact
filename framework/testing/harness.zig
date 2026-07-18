//! Test harness — register and run tests against the live node tree.
//!
//! When ZIGOS_TEST=1 is set, the harness runs registered test functions
//! after the first rendered frame, prints results, and exits with 0/1.
//!
//! Usage from generated_app.zig:
//!   const harness = @import("framework/testing/harness.zig");
//!   harness.register("counter increments", myTestFn);
//!   // engine calls harness.tick() each frame — runs after frame 1

const std = @import("std");
const log = @import("../diag/log.zig");
const layout = @import("../layout.zig");
const Node = layout.Node;
const testassert = @import("assert.zig");
const TestResult = testassert.TestResult;

pub const TestOutcome = enum { pass, fail };
pub const TestFn = *const fn (*Node) TestOutcome;

const MAX_TESTS: usize = 64;

const TestEntry = struct {
    name: []const u8 = "",
    func: ?TestFn = null,
};

var tests: [MAX_TESTS]TestEntry = [_]TestEntry{.{}} ** MAX_TESTS;
var test_count: usize = 0;
var enabled: bool = false;
var frame_count: u32 = 0;
var run_after_frame: u32 = 1;

/// Register a test function.
pub fn register(name: []const u8, func: TestFn) void {
    if (test_count >= MAX_TESTS) return;
    tests[test_count] = .{ .name = name, .func = func };
    test_count += 1;
}

/// Enable test mode.
pub fn enable() void {
    enabled = true;
}

/// Set how many frames to wait before running tests (default: 1).
pub fn setRunAfterFrame(n: u32) void {
    run_after_frame = n;
}

/// Check if test mode is enabled.
pub fn isEnabled() bool {
    return enabled;
}

/// Called each frame. Returns true on the frame when tests should run.
pub fn tick() bool {
    if (!enabled) return false;
    frame_count += 1;
    return frame_count == run_after_frame;
}

/// Run all registered tests. Returns 0 if all pass, 1 if any fail.
pub fn runAll(root: *Node) u8 {
    log.print("\n", .{});
    var results: [MAX_TESTS]TestResult = undefined;
    var result_count: usize = 0;

    for (tests[0..test_count]) |entry| {
        const func = entry.func orelse continue;
        const outcome = func(root);
        results[result_count] = .{
            .name = entry.name,
            .status = if (outcome == .pass) .pass else .fail,
        };
        testassert.printResult(results[result_count]);
        result_count += 1;
    }

    testassert.printSummary(results[0..result_count]);

    for (results[0..result_count]) |r| {
        if (r.status == .fail) return 1;
    }
    return 0;
}

/// Check if ZIGOS_TEST=1 is set in the environment.
pub fn envEnabled(environ: *const std.process.Environ.Map) bool {
    const val = environ.get("ZIGOS_TEST") orelse return false;
    return std.mem.eql(u8, val, "1");
}

test "test mode reads the supplied environment" {
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();
    try environ.put("ZIGOS_TEST", "1");
    try std.testing.expect(envEnabled(&environ));
}
