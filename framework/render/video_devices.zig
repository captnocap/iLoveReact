//! Linux V4L2 camera discovery for render-source consumers.
//!
//! A USB camera commonly exposes TWO `/dev/video*` nodes: one image stream and
//! one metadata stream with the same card name. Listing paths from sysfs alone
//! therefore produces convincing but unusable picker entries. This boundary
//! opens each node, asks VIDIOC_QUERYCAP, and keeps image-capture devices only.

const std = @import("std");
const builtin = @import("builtin");

fn io() std.Io {
    return std.Io.Threaded.global_single_threaded.io();
}

const c = if (builtin.os.tag == .linux) @cImport({
    @cInclude("fcntl.h");
    @cInclude("linux/videodev2.h");
    @cInclude("sys/ioctl.h");
    @cInclude("unistd.h");
}) else struct {};

pub const VideoDevice = struct {
    index: u32,
    source: []u8,
    name: []u8,
    driver: []u8,
    bus: []u8,

    fn deinit(self: *VideoDevice, allocator: std.mem.Allocator) void {
        allocator.free(self.source);
        allocator.free(self.name);
        allocator.free(self.driver);
        allocator.free(self.bus);
    }
};

pub const DeviceList = struct {
    items: []VideoDevice,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *DeviceList) void {
        for (self.items) |*device| device.deinit(self.allocator);
        self.allocator.free(self.items);
        self.items = &.{};
    }
};

pub fn parseVideoIndex(name: []const u8) ?u32 {
    if (!std.mem.startsWith(u8, name, "video") or name.len == "video".len) return null;
    const suffix = name["video".len..];
    for (suffix) |byte| if (byte < '0' or byte > '9') return null;
    return std.fmt.parseInt(u32, suffix, 10) catch null;
}

pub fn isCaptureCapabilities(capabilities: u32) bool {
    if (builtin.os.tag != .linux) return false;
    const capture_mask: u32 = @as(u32, c.V4L2_CAP_VIDEO_CAPTURE) | @as(u32, c.V4L2_CAP_VIDEO_CAPTURE_MPLANE);
    return capabilities & capture_mask != 0;
}

fn sanitizedCString(allocator: std.mem.Allocator, buf: anytype) ![]u8 {
    const source = std.mem.sliceTo(buf, 0);
    const out = try allocator.alloc(u8, source.len);
    for (source, 0..) |byte, i| out[i] = if (byte >= 0x20 and byte <= 0x7e) byte else '?';
    return out;
}

fn queryLinuxDevice(allocator: std.mem.Allocator, index: u32) !VideoDevice {
    if (builtin.os.tag != .linux) return error.UnsupportedPlatform;
    const source = try std.fmt.allocPrint(allocator, "/dev/video{d}", .{index});
    errdefer allocator.free(source);
    const source_z = try allocator.dupeZ(u8, source);
    defer allocator.free(source_z);

    const fd = c.open(source_z.ptr, c.O_RDONLY | c.O_NONBLOCK);
    if (fd < 0) return error.OpenFailed;
    defer _ = c.close(fd);

    var capability: c.struct_v4l2_capability = std.mem.zeroes(c.struct_v4l2_capability);
    if (c.ioctl(fd, c.VIDIOC_QUERYCAP, &capability) < 0) return error.QueryCapabilitiesFailed;
    const caps: u32 = if (capability.capabilities & @as(u32, c.V4L2_CAP_DEVICE_CAPS) != 0)
        capability.device_caps
    else
        capability.capabilities;
    if (!isCaptureCapabilities(caps)) return error.NotImageCapture;

    const name = try sanitizedCString(allocator, capability.card[0..]);
    errdefer allocator.free(name);
    const driver = try sanitizedCString(allocator, capability.driver[0..]);
    errdefer allocator.free(driver);
    const bus = try sanitizedCString(allocator, capability.bus_info[0..]);
    return .{ .index = index, .source = source, .name = name, .driver = driver, .bus = bus };
}

pub fn list(allocator: std.mem.Allocator) !DeviceList {
    if (builtin.os.tag != .linux) return .{ .items = try allocator.alloc(VideoDevice, 0), .allocator = allocator };
    var devices: std.ArrayList(VideoDevice) = .empty;
    errdefer {
        for (devices.items) |*device| device.deinit(allocator);
        devices.deinit(allocator);
    }

    var dev_dir = std.Io.Dir.openDirAbsolute(io(), "/dev", .{ .iterate = true }) catch {
        return .{ .items = try allocator.alloc(VideoDevice, 0), .allocator = allocator };
    };
    defer dev_dir.close(io());
    var iterator = dev_dir.iterate();
    while (try iterator.next(io())) |entry| {
        const index = parseVideoIndex(entry.name) orelse continue;
        var device = queryLinuxDevice(allocator, index) catch continue;
        devices.append(allocator, device) catch |err| {
            device.deinit(allocator);
            return err;
        };
    }
    std.mem.sort(VideoDevice, devices.items, {}, struct {
        fn lessThan(_: void, left: VideoDevice, right: VideoDevice) bool {
            return left.index < right.index;
        }
    }.lessThan);
    return .{ .items = try devices.toOwnedSlice(allocator), .allocator = allocator };
}
