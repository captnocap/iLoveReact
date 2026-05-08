const std = @import("std");
const testing = std.testing;

extern fn test_init_vm() void;
extern fn test_deinit_vm() void;
extern fn test_eval_script(ptr: [*]const u8, len: usize) void;
extern fn test_call_global(name: [*:0]const u8) void;
extern fn test_root_child_count() usize;
extern fn test_root_total_node_count() usize;
extern fn test_root_text_value_ptr() [*]const u8;
extern fn test_root_text_value_len() usize;

fn rootTextSlice() []const u8 {
    return test_root_text_value_ptr()[0..test_root_text_value_len()];
}

test "luajit runtime JSRT counter mutates the Zig node pool" {
    test_init_vm();
    defer test_deinit_vm();

    const script: []const u8 = @embedFile("luajit_runtime_test.lua");
    test_eval_script(script.ptr, script.len);

    try testing.expectEqual(@as(usize, 1), test_root_child_count());
    try testing.expectEqual(@as(usize, 3), test_root_total_node_count());
    try testing.expectEqualStrings("0", rootTextSlice());

    test_call_global("__zig_dispatch");

    try testing.expectEqual(@as(usize, 1), test_root_child_count());
    try testing.expectEqual(@as(usize, 3), test_root_total_node_count());
    try testing.expectEqualStrings("1", rootTextSlice());
}
