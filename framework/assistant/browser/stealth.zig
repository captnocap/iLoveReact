//! Stealth Patches for Hiding Automation Signals
//!
//! Three layers of protection against bot detection:
//!
//! Layer 1 — Binary patch: Replaces the "webdriver" string in the Firefox engine
//!     library (libxul.so / libxul.dylib / xul.dll) so navigator.webdriver
//!     ceases to exist entirely. Not overridden, not false — genuinely
//!     undefined, same as a normal browser.
//!
//! Layer 1b — Omni.ja patch: Replaces the red candy-stripe automation indicator
//!     CSS with hidden rules so the candycane never appears.
//!
//! Layer 2 — WebExtension: Injects a content script at document_start in the
//!     MAIN world that does a prototype-level override of navigator.webdriver
//!     as defense-in-depth. Also manages per-tab agent indicators and theme.

const std = @import("std");
const Allocator = std.mem.Allocator;

// =============================================================================
// Platform Helpers
// =============================================================================

/// Get platform-specific libxul filename
pub fn libxulName() []const u8 {
    const os_tag = @import("builtin").os.tag;
    return switch (os_tag) {
        .macos => "libxul.dylib",
        .windows => "xul.dll",
        else => "libxul.so",
    };
}

/// Get platform-specific Firefox config directory
pub fn firefoxConfigDir(buf: []u8) ![]const u8 {
    const home = std.posix.getenv("HOME") orelse return error.NoHomeDir;
    return try std.fmt.bufPrint(buf, "{s}/.mozilla/firefox", .{home});
}

// =============================================================================
// Layer 1: Binary Patch
// =============================================================================

const PATCH_TARGET = "webdriver";
const PATCH_MARKER = ".browse_patched";

/// Generate a random replacement string of given length
fn generateReplacement(length: usize, buf: []u8) []const u8 {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    var i: usize = 0;
    while (i < length) : (i += 1) {
        const idx = std.crypto.random.int(u8) % chars.len;
        buf[i] = chars[idx];
    }
    return buf[0..length];
}

/// Find libxul in Firefox or Tor Browser directory
pub fn findLibxul(firefox_path: []const u8, buf: []u8) error{NotFound}![]const u8 {
    const name = libxulName();

    // Firefox ESR: engine lib at root of install dir
    const candidate1 = std.fmt.bufPrint(buf, "{s}/{s}", .{ firefox_path, name }) catch return error.NotFound;
    if (fileExists(candidate1)) return candidate1;

    // Tor Browser: engine lib is under Browser/
    const candidate2 = std.fmt.bufPrint(buf, "{s}/Browser/{s}", .{ firefox_path, name }) catch return error.NotFound;
    if (fileExists(candidate2)) return candidate2;

    return error.NotFound;
}

/// Check if file exists
fn fileExists(path: []const u8) bool {
    std.fs.cwd().access(path, .{}) catch return false;
    return true;
}

/// Check if Firefox installation has been patched
pub fn isPatched(firefox_path: []const u8) bool {
    var marker_buf: [512]u8 = undefined;
    const marker = std.fmt.bufPrint(&marker_buf, "{s}/{s}", .{ firefox_path, PATCH_MARKER }) catch return false;
    return fileExists(marker);
}

/// Patch libxul to remove navigator.webdriver property
///
/// Replaces the "webdriver" WebIDL property name string with random
/// bytes of the same length. This makes navigator.webdriver undefined
/// (the property does not exist) rather than true or false.
pub fn patchLibxul(allocator: Allocator, firefox_path: []const u8, force: bool) error{ AlreadyPatched, NotFound, OutOfMemory, WriteFailed }!void {
    var marker_buf: [512]u8 = undefined;
    const marker_path = std.fmt.bufPrint(&marker_buf, "{s}/{s}", .{ firefox_path, PATCH_MARKER }) catch return error.NotFound;

    if (!force and fileExists(marker_path)) {
        return error.AlreadyPatched;
    }

    var libxul_buf: [512]u8 = undefined;
    const libxul = findLibxul(firefox_path, &libxul_buf) catch return error.NotFound;

    // Read binary
    const data = std.fs.cwd().readFileAlloc(allocator, libxul, 100 * 1024 * 1024) catch return error.NotFound;
    defer allocator.free(data);

    // Count occurrences
    var count: usize = 0;
    var i: usize = 0;
    while (i < data.len - PATCH_TARGET.len) : (i += 1) {
        if (std.mem.eql(u8, data[i .. i + PATCH_TARGET.len], PATCH_TARGET)) {
            count += 1;
        }
    }

    if (count == 0) {
        // Already patched or unexpected binary
        const f = std.fs.cwd().createFile(marker_path, .{}) catch return error.WriteFailed;
        f.writeAll("already_clean") catch return error.WriteFailed;
        f.close();
        return;
    }

    // Generate replacement
    var repl_buf: [16]u8 = undefined;
    const replacement = generateReplacement(PATCH_TARGET.len, &repl_buf);

    // Replace all occurrences
    var patched = allocator.alloc(u8, data.len) catch return error.OutOfMemory;
    defer allocator.free(patched);
    @memcpy(patched, data);

    i = 0;
    while (i < patched.len - PATCH_TARGET.len) : (i += 1) {
        if (std.mem.eql(u8, patched[i .. i + PATCH_TARGET.len], PATCH_TARGET)) {
            @memcpy(patched[i .. i + replacement.len], replacement);
        }
    }

    // Write back
    std.fs.cwd().writeFile(.{
        .sub_path = libxul,
        .data = patched,
    }) catch return error.WriteFailed;

    // Write marker
    const marker_content = std.fmt.allocPrint(allocator,
        \\{{"original": "{s}", "replacement": "{s}", "occurrences": {d}, "libxul_size": {d}}}
    , .{ PATCH_TARGET, replacement, count, data.len }) catch return error.OutOfMemory;
    defer allocator.free(marker_content);

    std.fs.cwd().writeFile(.{
        .sub_path = marker_path,
        .data = marker_content,
    }) catch return error.WriteFailed;
}

// =============================================================================
// Layer 1b: Omni.ja Patch (Automation Indicator)
// =============================================================================

const OMNI_PATCH_MARKER = ".browse_omni_patched";

const REMOTE_CONTROL_CSS_OLD =
    \\:root[remotecontrol] {
    \\  #remote-control-box {
    \\    visibility: visible;
    \\    padding-inline: var(--urlbar-icon-padding);
    \\  }
    \\  #remote-control-icon {
    \\    list-style-image: url(chrome://browser/content/static-robot.png);
    \\    width: 16px;
    \\    height: 16px;
    \\  }
    \\  #urlbar-background {
    \\    background-image: repeating-linear-gradient(
    \\      -45deg,
    \\      rgba(255, 60, 60, 0.25) 0 25px,
    \\      rgba(175, 0, 0, 0.25) 25px 50px
    \\    );
    \\    background-attachment: fixed;
    \\    animation: none !important;
    \\  }
    \\}
;

const REMOTE_CONTROL_CSS_NEW =
    \\:root[remotecontrol] {
    \\  #remote-control-box {
    \\    visibility: hidden;
    \\  }
    \\  #remote-control-icon {
    \\    display: none;
    \\  }
    \\  #urlbar-background {
    \\    background-image: none;
    \\    animation: none !important;
    \\  }
    \\}
;

/// Find browser/omni.ja in Firefox directory
pub fn findOmni(firefox_path: []const u8, buf: []u8) error{NotFound}![]const u8 {
    // macOS Firefox.app: Contents/Resources/browser/omni.ja
    if (@import("builtin").os.tag == .macos) {
        const candidate1 = std.fmt.bufPrint(buf, "{s}/../Resources/browser/omni.ja", .{firefox_path}) catch return error.NotFound;
        if (fileExists(candidate1)) return candidate1;

        // Tor Browser on macOS
        const candidate2 = std.fmt.bufPrint(buf, "{s}/Browser/browser/omni.ja", .{firefox_path}) catch return error.NotFound;
        if (fileExists(candidate2)) return candidate2;
    } else {
        // Linux/Windows: browser/omni.ja
        const candidate1 = std.fmt.bufPrint(buf, "{s}/browser/omni.ja", .{firefox_path}) catch return error.NotFound;
        if (fileExists(candidate1)) return candidate1;

        // Tor Browser
        const candidate2 = std.fmt.bufPrint(buf, "{s}/Browser/browser/omni.ja", .{firefox_path}) catch return error.NotFound;
        if (fileExists(candidate2)) return candidate2;
    }

    return error.NotFound;
}

/// Check if omni.ja has been patched
pub fn isOmniPatched(firefox_path: []const u8) bool {
    var marker_buf: [512]u8 = undefined;
    const marker = std.fmt.bufPrint(&marker_buf, "{s}/{s}", .{ firefox_path, OMNI_PATCH_MARKER }) catch return false;
    return fileExists(marker);
}

// =============================================================================
// Layer 2: Stealth WebExtension
// =============================================================================

/// Content script that runs at document_start in the MAIN world
/// Does prototype-level override with toString patching
pub const CONTENT_SCRIPT =
    \\(function() {
    \\    var proto = Navigator.prototype;
    \\    var desc = Object.getOwnPropertyDescriptor(proto, 'webdriver');
    \\    if (!desc) {
    \\        var nativeGet = function webdriver() { return false; };
    \\        Object.defineProperty(proto, 'webdriver', {
    \\            get: nativeGet,
    \\            configurable: true,
    \\            enumerable: true
    \\        });
    \\        var origToString = Function.prototype.toString;
    \\        var toStringProxy = new Proxy(origToString, {
    \\            apply: function(target, thisArg, args) {
    \\                if (thisArg === nativeGet) {
    \\                    return 'function get webdriver() { [native code] }';
    \\                }
    \\                if (thisArg === toStringProxy) {
    \\                    return 'function toString() { [native code] }';
    \\                }
    \\                return Reflect.apply(target, thisArg, args);
    \\            }
    \\        });
    \\        Function.prototype.toString = toStringProxy;
    \\        return;
    \\    }
    \\    var originalGetter = desc.get;
    \\    var fakeGetter = new Proxy(originalGetter, {
    \\        apply: function(target, thisArg, args) {
    \\            return false;
    \\        }
    \\    });
    \\    Object.defineProperty(proto, 'webdriver', {
    \\        get: fakeGetter,
    \\        configurable: desc.configurable,
    \\        enumerable: desc.enumerable
    \\    });
    \\    var origToString = Function.prototype.toString;
    \\    var toStringProxy = new Proxy(origToString, {
    \\        apply: function(target, thisArg, args) {
    \\            if (thisArg === fakeGetter) {
    \\                return 'function get webdriver() { [native code] }';
    \\            }
    \\            if (thisArg === toStringProxy) {
    \\                return 'function toString() { [native code] }';
    \\            }
    \\            return Reflect.apply(target, thisArg, args);
    \\        }
    \\    });
    \\    Function.prototype.toString = toStringProxy;
    \\})();
;

/// Extension manifest for stealth extension
pub const STEALTH_MANIFEST =
    \\{
    \\  "manifest_version": 2,
    \\  "name": "Browse Stealth",
    \\  "version": "1.0",
    \\  "description": "Defense-in-depth stealth for browse agent",
    \\  "content_scripts": [
    \\    {
    \\      "matches": ["<all_urls>"],
    \\      "js": ["stealth.js"],
    \\      "run_at": "document_start",
    \\      "all_frames": true,
    \\      "match_about_blank": true
    \\    }
    \\  ]
    \\}
;

/// Build the stealth WebExtension as an .xpi file
pub fn buildStealthExtension(allocator: Allocator, output_dir: []const u8) error{OutOfMemory, WriteFailed}![]const u8 {
    const xpi_path = std.fs.path.join(allocator, &.{ output_dir, "browse_stealth.xpi" }) catch return error.OutOfMemory;

    // Note: In real implementation, use a zip library
    // For now, just write the files separately
    std.fs.cwd().makePath(output_dir) catch return error.WriteFailed;

    std.fs.cwd().writeFile(.{
        .sub_path = xpi_path,
        .data = STEALTH_MANIFEST, // Simplified - should be zip
    }) catch return error.WriteFailed;

    return xpi_path;
}

// =============================================================================
// Errors
// =============================================================================

pub const StealthError = error{
    AlreadyPatched,
    NotFound,
    OutOfMemory,
    WriteFailed,
    NoHomeDir,
};

// =============================================================================
// Tests
// =============================================================================

test "libxulName returns correct filename" {
    const name = libxulName();
    try std.testing.expect(name.len > 0);
    // Should be one of the three variants
    const is_valid = std.mem.eql(u8, name, "libxul.so") or
        std.mem.eql(u8, name, "libxul.dylib") or
        std.mem.eql(u8, name, "xul.dll");
    try std.testing.expect(is_valid);
}

test "generateReplacement produces correct length" {
    var buf: [16]u8 = undefined;
    const repl = generateReplacement(9, &buf);
    try std.testing.expectEqual(@as(usize, 9), repl.len);
    // Should be lowercase letters only
    for (repl) |c| {
        try std.testing.expect(std.ascii.isLower(c));
    }
}

test "isPatched returns false for non-existent path" {
    // This should return false for a path that doesn't exist
    const result = isPatched("/nonexistent/path/that/does/not/exist");
    try std.testing.expect(!result);
}

test "CONTENT_SCRIPT contains expected patterns" {
    try std.testing.expect(std.mem.indexOf(u8, CONTENT_SCRIPT, "Navigator.prototype") != null);
    try std.testing.expect(std.mem.indexOf(u8, CONTENT_SCRIPT, "webdriver") != null);
    try std.testing.expect(std.mem.indexOf(u8, CONTENT_SCRIPT, "return false") != null);
}

test "REMOTE_CONTROL_CSS_OLD contains candy-stripe pattern" {
    try std.testing.expect(std.mem.indexOf(u8, REMOTE_CONTROL_CSS_OLD, "repeating-linear-gradient") != null);
    try std.testing.expect(std.mem.indexOf(u8, REMOTE_CONTROL_CSS_OLD, "255, 60, 60") != null);
}

test "REMOTE_CONTROL_CSS_NEW hides indicator" {
    try std.testing.expect(std.mem.indexOf(u8, REMOTE_CONTROL_CSS_NEW, "visibility: hidden") != null);
    try std.testing.expect(std.mem.indexOf(u8, REMOTE_CONTROL_CSS_NEW, "display: none") != null);
    try std.testing.expect(std.mem.indexOf(u8, REMOTE_CONTROL_CSS_NEW, "background-image: none") != null);
}
