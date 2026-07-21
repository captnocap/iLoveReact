const std = @import("std");
const policy = @import("static_instance_policy");

test "retained static instance uploads are all or dynamic" {
    try std.testing.expect(policy.canRetainWholeBatch(10, 0, 10));
    try std.testing.expect(policy.canRetainWholeBatch(4, 6, 10));
    try std.testing.expect(!policy.canRetainWholeBatch(5, 6, 10));
    try std.testing.expect(!policy.canRetainWholeBatch(11, 0, 10));
    try std.testing.expect(!policy.canRetainWholeBatch(0, 0, 10));
}

test "populated static prefix preserves the full-array default" {
    try std.testing.expectEqual(@as(?u32, 10), policy.populatedRowCount(10, 0));
    try std.testing.expectEqual(@as(?u32, 4), policy.populatedRowCount(10, 4));
    try std.testing.expectEqual(@as(?u32, null), policy.populatedRowCount(10, 11));
    try std.testing.expectEqual(@as(?u32, null), policy.populatedRowCount(0, 0));
}
