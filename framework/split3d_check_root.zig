//! split3d_check_root.zig — semantic gate for the req_4375 verbatim split
//! (framework/gpu/3d_refactor_2nd_attempt/). Forces analysis of the split
//! orchestrator and, through its per-decl re-exports, every moved decl.
//! Compiled by the additive `check-3d-split` build step; the shipping build
//! never touches this tree.

const std = @import("std");

// Zig 0.16 dropped std.testing.refAllDeclsRecursive; this is the classic
// implementation, scoped to this gate.
fn refAllDeclsRecursive(comptime T: type) void {
    @setEvalBranchQuota(2_000_000);
    inline for (comptime std.meta.declarations(T)) |decl| {
        if (@TypeOf(@field(T, decl.name)) == type) {
            switch (@typeInfo(@field(T, decl.name))) {
                .@"struct", .@"enum", .@"union", .@"opaque" => refAllDeclsRecursive(@field(T, decl.name)),
                else => {},
            }
        }
        _ = &@field(T, decl.name);
    }
}

test "3d split tree fully analyzes" {
    refAllDeclsRecursive(@import("gpu/scene3d/root.zig"));
}
