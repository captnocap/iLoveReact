const std = @import("std");
const video_devices = @import("video_devices");

test "video node names parse strictly" {
    try std.testing.expectEqual(@as(?u32, 0), video_devices.parseVideoIndex("video0"));
    try std.testing.expectEqual(@as(?u32, 27), video_devices.parseVideoIndex("video27"));
    try std.testing.expectEqual(@as(?u32, null), video_devices.parseVideoIndex("video"));
    try std.testing.expectEqual(@as(?u32, null), video_devices.parseVideoIndex("video2-meta"));
    try std.testing.expectEqual(@as(?u32, null), video_devices.parseVideoIndex("camera0"));
}

test "capture capabilities exclude metadata-only nodes" {
    try std.testing.expect(video_devices.isCaptureCapabilities(0x00000001));
    try std.testing.expect(video_devices.isCaptureCapabilities(0x00001000));
    try std.testing.expect(!video_devices.isCaptureCapabilities(0x00800000));
}

test "discovered devices are usable capture nodes in stable order" {
    var devices = try video_devices.list(std.testing.io, std.testing.allocator);
    defer devices.deinit();
    var previous: ?u32 = null;
    for (devices.items) |device| {
        try std.testing.expect(std.mem.startsWith(u8, device.source, "/dev/video"));
        try std.testing.expect(device.name.len > 0);
        if (previous) |index| try std.testing.expect(index < device.index);
        previous = device.index;
    }
}
