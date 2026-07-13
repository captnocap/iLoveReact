const std = @import("std");
const testing = std.testing;
const app_config = @import("app_config");

test "linux prefers XDG config and falls back to dot config" {
    const xdg = try app_config.resolveFrom(testing.allocator, .linux, "reactjit/editor", "/tmp/config", null, "/home/test");
    defer testing.allocator.free(xdg);
    try testing.expectEqualStrings("/tmp/config/reactjit/editor", xdg);

    const fallback = try app_config.resolveFrom(testing.allocator, .linux, "reactjit/editor", null, null, "/home/test");
    defer testing.allocator.free(fallback);
    try testing.expectEqualStrings("/home/test/.config/reactjit/editor", fallback);
}

test "macOS and Windows use their native configuration homes" {
    const mac = try app_config.resolveFrom(testing.allocator, .macos, "reactjit/editor", null, null, "/Users/test");
    defer testing.allocator.free(mac);
    try testing.expectEqualStrings("/Users/test/Library/Application Support/reactjit/editor", mac);

    const windows = try app_config.resolveFrom(testing.allocator, .windows, "reactjit/editor", null, "C:\\Users\\test\\AppData\\Roaming", null);
    defer testing.allocator.free(windows);
    try testing.expect(std.mem.endsWith(u8, windows, "reactjit/editor") or std.mem.endsWith(u8, windows, "reactjit\\editor"));
}

test "application identity cannot escape the config root" {
    try testing.expectError(error.InvalidAppName, app_config.resolveFrom(testing.allocator, .linux, "../editor", "/tmp/config", null, "/home/test"));
    try testing.expectError(error.InvalidAppName, app_config.resolveFrom(testing.allocator, .linux, "reactjit//editor", "/tmp/config", null, "/home/test"));
    try testing.expectError(error.AppNameRequired, app_config.resolveFrom(testing.allocator, .linux, "", "/tmp/config", null, "/home/test"));
}
