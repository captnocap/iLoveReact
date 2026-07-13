const std = @import("std");
const reload = @import("dev_reload_policy");

test "automatic changes reload once" {
    var gate = reload.Controller{};
    gate.onBundleChanged();
    try std.testing.expect(gate.takeReload());
    try std.testing.expect(!gate.takeReload());
}

test "ask holds until explicit application" {
    var gate = reload.Controller{};
    try std.testing.expect(gate.setPolicy(1));
    gate.onBundleChanged();
    try std.testing.expect(gate.waitingForApproval());
    try std.testing.expect(!gate.takeReload());
    try std.testing.expect(gate.applyHeld());
    try std.testing.expect(gate.takeReload());
}

test "off holds and switching to automatic applies latest bundle" {
    var gate = reload.Controller{};
    try std.testing.expect(gate.setPolicy(2));
    gate.onBundleChanged();
    try std.testing.expect(!gate.waitingForApproval());
    try std.testing.expect(!gate.takeReload());
    try std.testing.expect(gate.setPolicy(0));
    try std.testing.expect(gate.takeReload());
}

test "unknown policy is rejected without changing behavior" {
    var gate = reload.Controller{};
    try std.testing.expect(!gate.setPolicy(9));
    gate.onBundleChanged();
    try std.testing.expect(gate.takeReload());
}
