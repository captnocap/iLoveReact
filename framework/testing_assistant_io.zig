//! Module root for assistant native-I/O ownership tests.
//!
//! Rooting the test at `framework/` keeps the implementation's sibling
//! imports inside the Zig module path.

const std = @import("std");
const child_stdout = @import("assistant/claude_sdk/child_stdout.zig");
const claude_sdk = @import("assistant/claude_sdk/mod.zig");
const kimi_wire_sdk = @import("assistant/kimi_wire_sdk.zig");
const local_ai_runtime = @import("assistant/local_ai_runtime.zig");
const local_ai_runtime_old = @import("assistant/local_ai_runtime_old.zig");
const tests = @import("testing/unit/assistant_io.zig");

test {
    std.testing.refAllDecls(child_stdout);
    std.testing.refAllDecls(claude_sdk);
    std.testing.refAllDecls(kimi_wire_sdk);
    std.testing.refAllDecls(local_ai_runtime);
    std.testing.refAllDecls(local_ai_runtime_old);
    std.testing.refAllDecls(tests);
}
