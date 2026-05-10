//! devtools.zig — No-op stub (inspector moved to tsz-tools)
//!
//! The embedded F12 inspector has been removed from app binaries.
//! Apps now only keep the thin debug_server hook + highlight overlay.
//! The full inspector lives in carts/tools/ as a standalone app that
//! connects over IPC (NDJSON/TCP) via the debug protocol.
//!
//! To inspect an app: run `tsz tools inspect` and attach to the target.

const layout = @import("../layout.zig");

pub var root: layout.Node = .{};

pub const JS_LOGIC: []const u8 = "";

pub fn _appInit() void {}
pub fn _appTick(_: u32) void {}
