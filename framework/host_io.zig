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
