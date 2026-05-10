//! Web Browser Automation for AI Agents
//!
//! Firefox-based browser automation with stealth capabilities for
//! bypassing bot detection. Supports both quick mode and session mode.

const std = @import("std");

// Sub-modules
pub const content = @import("browser/content.zig");
pub const stealth = @import("browser/stealth.zig");

// Re-export commonly used types
pub const Link = content.Link;
pub const FormField = content.FormField;
pub const Form = content.Form;
pub const PageContent = content.PageContent;
pub const EXTRACT_CONTENT_JS = content.EXTRACT_CONTENT_JS;
pub const dictToPageContent = content.dictToPageContent;

// Re-export stealth functions
pub const patchLibxul = stealth.patchLibxul;
pub const isPatched = stealth.isPatched;
pub const buildStealthExtension = stealth.buildStealthExtension;
pub const libxulName = stealth.libxulName;
pub const StealthError = stealth.StealthError;

/// Browser configuration
pub const BrowserConfig = struct {
    firefox_path: ?[]const u8 = null,
    proxy: ?[]const u8 = null,
    headless: bool = false,
    profile_path: ?[]const u8 = null,
};

/// Agent browser for web automation
pub const AgentBrowser = struct {
    allocator: std.mem.Allocator,
    config: BrowserConfig,
    is_session_mode: bool = false,

    pub fn init(allocator: std.mem.Allocator, config: BrowserConfig) AgentBrowser {
        return .{
            .allocator = allocator,
            .config = config,
        };
    }

    /// Navigate to a URL and extract content
    pub fn navigate(self: AgentBrowser, url: []const u8) error{ NotImplemented, OutOfMemory }!PageContent {
        // This would integrate with Selenium/WebDriver in a real implementation
        _ = self;
        _ = url;
        return error.NotImplemented;
    }

    /// Extract content from current page
    pub fn extractContent(self: AgentBrowser) error{NotImplemented}!PageContent {
        _ = self;
        return error.NotImplemented;
    }
};

/// Apply stealth patches to Firefox installation
pub fn applyStealthPatches(firefox_path: []const u8, force: bool) !void {
    const allocator = std.heap.page_allocator;

    // Layer 1: Binary patch
    stealth.patchLibxul(allocator, firefox_path, force) catch |err| {
        std.log.warn("Failed to patch libxul: {s}", .{@errorName(err)});
    };

    // Note: omni.ja patching would require zip/unzip utilities
}

/// Parse proxy URL into host and port
pub fn parseProxy(proxy_url: []const u8) ?struct { scheme: []const u8, host: []const u8, port: u16 } {
    // Simple parser for socks5://host:port or http://host:port
    const scheme_end = std.mem.indexOf(u8, proxy_url, "://") orelse return null;
    const scheme = proxy_url[0..scheme_end];

    const rest = proxy_url[scheme_end + 3 ..];
    const host_end = std.mem.indexOf(u8, rest, ":") orelse rest.len;
    const host = rest[0..host_end];

    var port: u16 = if (std.mem.eql(u8, scheme, "socks5")) 1080 else 8080;
    if (host_end < rest.len) {
        const port_str = rest[host_end + 1 ..];
        port = std.fmt.parseInt(u16, port_str, 10) catch return null;
    }

    return .{ .scheme = scheme, .host = host, .port = port };
}

// =============================================================================
// Tests
// =============================================================================

test "parseProxy extracts socks5 proxy" {
    const result = parseProxy("socks5://127.0.0.1:1080").?;
    try std.testing.expectEqualStrings("socks5", result.scheme);
    try std.testing.expectEqualStrings("127.0.0.1", result.host);
    try std.testing.expectEqual(@as(u16, 1080), result.port);
}

test "parseProxy extracts http proxy" {
    const result = parseProxy("http://proxy.example.com:8080").?;
    try std.testing.expectEqualStrings("http", result.scheme);
    try std.testing.expectEqualStrings("proxy.example.com", result.host);
    try std.testing.expectEqual(@as(u16, 8080), result.port);
}

test "parseProxy returns null for invalid URL" {
    try std.testing.expect(parseProxy("not-a-proxy-url") == null);
}

test "AgentBrowser init" {
    const browser = AgentBrowser.init(std.testing.allocator, .{
        .headless = true,
    });
    try std.testing.expect(browser.config.headless);
}
