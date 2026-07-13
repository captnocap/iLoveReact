//! Platform-native application configuration directories.
//!
//! Settings are ordinary versioned files, not rows in the application data
//! database.  Keep the path decision here so carts never learn XDG/AppData/
//! Application Support conventions independently.

const std = @import("std");

pub const ResolveError = error{
    AppNameRequired,
    InvalidAppName,
    ConfigHomeUnavailable,
};

fn validAppName(app_name: []const u8) bool {
    if (app_name.len == 0 or app_name[0] == '/' or app_name[app_name.len - 1] == '/') return false;
    var segments = std.mem.splitScalar(u8, app_name, '/');
    while (segments.next()) |segment| {
        if (segment.len == 0 or std.mem.eql(u8, segment, ".") or std.mem.eql(u8, segment, "..")) return false;
        for (segment) |ch| {
            if (!(std.ascii.isAlphanumeric(ch) or ch == '-' or ch == '_' or ch == '.')) return false;
        }
    }
    return true;
}

/// Pure resolver used by the host binding and unit tests. Environment values
/// are passed in rather than read here so platform precedence is testable.
pub fn resolveFrom(
    alloc: std.mem.Allocator,
    os_tag: std.Target.Os.Tag,
    app_name: []const u8,
    xdg_config_home: ?[]const u8,
    app_data: ?[]const u8,
    home: ?[]const u8,
) (ResolveError || std.mem.Allocator.Error)![]u8 {
    if (app_name.len == 0) return error.AppNameRequired;
    if (!validAppName(app_name)) return error.InvalidAppName;

    return switch (os_tag) {
        .windows => if (app_data) |base|
            std.fs.path.join(alloc, &.{ base, app_name })
        else if (home) |base|
            std.fs.path.join(alloc, &.{ base, "AppData", "Roaming", app_name })
        else
            error.ConfigHomeUnavailable,
        .macos => if (home) |base|
            std.fs.path.join(alloc, &.{ base, "Library", "Application Support", app_name })
        else
            error.ConfigHomeUnavailable,
        else => if (xdg_config_home) |base|
            if (base.len > 0)
                std.fs.path.join(alloc, &.{ base, app_name })
            else if (home) |fallback|
                std.fs.path.join(alloc, &.{ fallback, ".config", app_name })
            else
                error.ConfigHomeUnavailable
        else if (home) |base|
            std.fs.path.join(alloc, &.{ base, ".config", app_name })
        else
            error.ConfigHomeUnavailable,
    };
}

/// Resolve from the current process environment.
pub fn resolve(alloc: std.mem.Allocator, app_name: []const u8) (ResolveError || std.mem.Allocator.Error)![]u8 {
    const xdg = std.process.getEnvVarOwned(alloc, "XDG_CONFIG_HOME") catch null;
    defer if (xdg) |value| alloc.free(value);
    const app_data = std.process.getEnvVarOwned(alloc, "APPDATA") catch null;
    defer if (app_data) |value| alloc.free(value);
    const home = std.process.getEnvVarOwned(alloc, "HOME") catch null;
    defer if (home) |value| alloc.free(value);
    return resolveFrom(
        alloc,
        @import("builtin").os.tag,
        app_name,
        xdg,
        app_data,
        home,
    );
}
