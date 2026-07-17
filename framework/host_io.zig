//! Ambient host Io for Zig 0.16's std.Io interface.
//!
//! This codebase's idiom is ambient capability access (std.heap.c_allocator at
//! call sites), not context threading — host_io mirrors that for I/O: one
//! blocking Threaded instance per process, comptime-initialized so every
//! binary and test root gets it with zero entry-point wiring. std.Io.Threaded
//! is documented thread-safe; blocking calls never touch its gpa (only
//! async/concurrent would, and nothing here uses those).
const std = @import("std");

pub var threaded: std.Io.Threaded = .init_single_threaded;

pub fn io() std.Io {
    return threaded.io();
}

/// 0.16 removed std.posix.getenv. We link libc in every binary, so route
/// through it. Call-site literals are already null-terminated.
pub fn getenv(name: [:0]const u8) ?[]const u8 {
    return if (std.c.getenv(name.ptr)) |p| std.mem.span(p) else null;
}

/// Real process environment as a 0.16 Environ (for process spawns — the
/// default Threaded environ is .empty, which would spawn children with an
/// empty environment).
pub fn environ() std.process.Environ {
    return .{ .block = .{ .slice = @ptrCast(std.mem.span(std.c.environ)) } };
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
