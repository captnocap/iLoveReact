//! devtools_state.zig — No-op stub (inspector moved to tsz-tools)
//!
//! This file previously contained a full copy of the state system for
//! the embedded devtools panel. Now that the inspector is standalone,
//! this is a no-op stub that satisfies the import in case any legacy
//! code references it.

const std = @import("std");

pub const MAX_SLOTS = 512;
pub const MAX_ARRAY_LEN = 256;

pub fn getSlot(_: u32) i64 { return 0; }
pub fn setSlot(_: u32, _: i64) void {}
pub fn getSlotString(_: u32) []const u8 { return ""; }
pub fn setSlotString(_: u32, _: []const u8) void {}
pub fn isDirty() bool { return false; }
pub fn clearDirty() void {}
