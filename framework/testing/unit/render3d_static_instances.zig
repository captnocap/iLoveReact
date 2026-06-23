const std = @import("std");
const policy = @import("static_instance_policy");

test "retained static instance uploads are all or dynamic" {
    try std.testing.expect(policy.canRetainWholeBatch(10, 0, 10));
    try std.testing.expect(policy.canRetainWholeBatch(4, 6, 10));
    try std.testing.expect(!policy.canRetainWholeBatch(5, 6, 10));
    try std.testing.expect(!policy.canRetainWholeBatch(11, 0, 10));
    try std.testing.expect(!policy.canRetainWholeBatch(0, 0, 10));
}
