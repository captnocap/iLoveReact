const std = @import("std");
const policy = @import("instance_collider_policy");

test "instance-derived colliders keep finite vertical bands" {
    try std.testing.expect(!policy.blocksPlayerByHeight(0.2, 0.47));
    try std.testing.expect(policy.blocksPlayerByHeight(3.0, 0.47));

    try std.testing.expectApproxEqAbs(@as(f32, 3.0), policy.bandFloorY(3.1, 0.2), 1e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.0), policy.bandFloorY(1.5, 3.0), 1e-6);
}
