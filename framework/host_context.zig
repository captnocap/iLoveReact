//! Process capabilities owned by an application root.
//!
//! This is data, not a compatibility facade: roots construct it from
//! `std.process.Init`, then pass it through subsystem and callback boundaries.
//! Leaf functions should accept `std.Io` (and narrower capabilities) directly
//! whenever they do not need the rest of the process context.

const std = @import("std");

const HostContext = @This();

io: std.Io,
gpa: std.mem.Allocator,
arena: *std.heap.ArenaAllocator,
environ: *std.process.Environ.Map,
args: std.process.Args,

pub fn fromInit(init: std.process.Init) HostContext {
    return .{
        .io = init.io,
        .gpa = init.gpa,
        .arena = init.arena,
        .environ = init.environ_map,
        .args = init.minimal.args,
    };
}
