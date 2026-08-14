const std = @import("std");
const policy = @import("mesh_selection_policy");

test "persistent additive selection supplements physical shift" {
    defer policy.setPersistentAdditive(false);

    policy.setPersistentAdditive(false);
    try std.testing.expect(!policy.additiveForPointer(false));
    try std.testing.expect(policy.additiveForPointer(true));

    policy.setPersistentAdditive(true);
    try std.testing.expect(policy.persistentAdditive());
    try std.testing.expect(policy.additiveForPointer(false));
    try std.testing.expect(policy.additiveForPointer(true));
}

test "the policy changes only through its explicit toggle" {
    defer policy.setPersistentAdditive(false);

    policy.setPersistentAdditive(true);
    _ = policy.additiveForPointer(false);
    _ = policy.additiveForPointer(true);
    try std.testing.expect(policy.persistentAdditive());
}
