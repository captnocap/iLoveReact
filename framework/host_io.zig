//! Ambient host Io for Zig 0.16's std.Io interface.
//!
//! This codebase's idiom is ambient capability access (std.heap.c_allocator at
//! call sites), not context threading — host_io mirrors that for I/O, riding
//! std's own process-wide instance (std.Io.Threaded.global_single_threaded) so
//! every binary and test root gets it with zero entry-point wiring, and files
//! compiled as standalone module roots (which can't import this hub) reach the
//! SAME instance via the std name. std.Io.Threaded is documented thread-safe;
//! blocking calls never touch its gpa (only async/concurrent would, and
//! nothing here uses those).
const std = @import("std");

pub fn io() std.Io {
    return std.Io.Threaded.global_single_threaded.io();
}

/// 0.16 removed std.posix.getenv. We link libc in every binary, so route
/// through it. Call-site literals are already null-terminated.
pub fn getenv(name: [:0]const u8) ?[]const u8 {
    return if (std.c.getenv(name.ptr)) |p| std.mem.span(p) else null;
}

/// 0.15-shaped getEnvVarOwned (deleted in 0.16): owned copy or
/// error.EnvironmentVariableNotFound, iterating the libc environ.
pub fn getEnvVarOwned(alloc: std.mem.Allocator, name: []const u8) error{ OutOfMemory, EnvironmentVariableNotFound }![]u8 {
    var it: usize = 0;
    while (std.c.environ[it]) |entry_ptr| : (it += 1) {
        const entry = std.mem.span(entry_ptr);
        const eq = std.mem.indexOfScalar(u8, entry, '=') orelse continue;
        if (std.mem.eql(u8, entry[0..eq], name)) return alloc.dupe(u8, entry[eq + 1 ..]);
    }
    return error.EnvironmentVariableNotFound;
}

/// Real process environment as a 0.16 Environ (for process spawns — the
/// default Threaded environ is .empty, which would spawn children with an
/// empty environment).
pub fn environ() std.process.Environ {
    return .{ .block = .{ .slice = @ptrCast(std.mem.span(std.c.environ)) } };
}

/// One-call main wiring: stash args and hand the real environment to the
/// process-wide Threaded instance (spawned children inherit it; the default
/// is .empty). Every binary's `main(init: std.process.Init)` calls this first.
pub fn setup(init: std.process.Init) void {
    args = init.minimal.args;
    std.Io.Threaded.global_single_threaded.environ = .{ .process_environ = init.minimal.environ };
}

/// Command-line args, stashed by each binary's `main(init: std.process.Init)`
/// first thing (0.16 removed std.process.argsAlloc; argv only arrives via the
/// Init main parameter now). Helpers deep in the call graph read it through
/// argsAlloc below.
pub var args: ?std.process.Args = null;

/// 0.15-shaped argsAlloc over the stashed args. Panics if no main stashed
/// them — that binary's main needs the Init signature, a build-time wiring
/// bug, not a runtime condition.
pub fn argsAlloc(alloc: std.mem.Allocator) ![][:0]u8 {
    const a = args orelse @panic("host_io.args not stashed: main() must take std.process.Init and set host_io.args");
    var list: std.ArrayList([:0]u8) = .empty;
    errdefer argsFree(alloc, list.items);
    var it = std.process.Args.Iterator.init(a);
    while (it.next()) |arg| try list.append(alloc, try alloc.dupeZ(u8, arg));
    return try list.toOwnedSlice(alloc);
}

pub fn argsFree(alloc: std.mem.Allocator, slice: []const [:0]u8) void {
    for (slice) |arg| alloc.free(arg);
    alloc.free(@as([]const [:0]const u8, slice));
}

// ---- 0.15-shaped shims over the 0.16 Io clock ----
// Wall-clock timestamps, signatures identical to the deleted std.time fns so
// call sites are a pure rename. If one of these ever shows up hot in the
// frame loop, swap its body for a direct clock_gettime — here, in one place.

pub fn milliTimestamp() i64 {
    return std.Io.Clock.now(.real, io()).toMilliseconds();
}

pub fn microTimestamp() i64 {
    return @intCast(@divTrunc(std.Io.Clock.now(.real, io()).toNanoseconds(), std.time.ns_per_us));
}

pub fn nanoTimestamp() i128 {
    return std.Io.Clock.now(.real, io()).toNanoseconds();
}

pub fn timestamp() i64 {
    return @divTrunc(milliTimestamp(), std.time.ms_per_s);
}

/// 0.15-shaped monotonic timer (std.time.Timer was deleted in 0.16).
pub const Timer = struct {
    started: std.Io.Timestamp,

    pub fn start() error{TimerUnsupported}!Timer {
        return .{ .started = std.Io.Clock.now(.awake, io()) };
    }

    pub fn read(t: *Timer) u64 {
        const now_ts = std.Io.Clock.now(.awake, io());
        return @intCast(@max(0, now_ts.toNanoseconds() - t.started.toNanoseconds()));
    }

    pub fn reset(t: *Timer) void {
        t.started = std.Io.Clock.now(.awake, io());
    }

    pub fn lap(t: *Timer) u64 {
        const elapsed = t.read();
        t.reset();
        return elapsed;
    }
};

/// 0.15-shaped blocking mutex (std.Thread.Mutex was deleted in 0.16).
/// Uses lockUncancelable: nothing in this codebase uses async Io, so
/// cancellation cannot occur.
pub const Mutex = struct {
    inner: std.Io.Mutex = .init,

    pub fn lock(m: *Mutex) void {
        m.inner.lockUncancelable(io());
    }

    pub fn tryLock(m: *Mutex) bool {
        return m.inner.tryLock();
    }

    pub fn unlock(m: *Mutex) void {
        m.inner.unlock(io());
    }
};
