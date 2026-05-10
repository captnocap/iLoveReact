//! Web Content Extraction
//!
//! Structures and functions for extracting and formatting web page content.

const std = @import("std");
const Allocator = std.mem.Allocator;

/// A link extracted from a web page
pub const Link = struct {
    text: []const u8,
    href: []const u8,

    pub fn deinit(self: Link, allocator: Allocator) void {
        allocator.free(self.text);
        allocator.free(self.href);
    }
};

/// A form field extracted from a web page
pub const FormField = struct {
    name: []const u8,
    field_type: []const u8,
    value: []const u8 = "",
    placeholder: []const u8 = "",

    pub fn deinit(self: FormField, allocator: Allocator) void {
        allocator.free(self.name);
        allocator.free(self.field_type);
        allocator.free(self.value);
        allocator.free(self.placeholder);
    }
};

/// A form extracted from a web page
pub const Form = struct {
    action: []const u8,
    method: []const u8,
    fields: []FormField,

    pub fn deinit(self: Form, allocator: Allocator) void {
        for (self.fields) |f| f.deinit(allocator);
        allocator.free(self.fields);
        allocator.free(self.action);
        allocator.free(self.method);
    }
};

/// Complete content extracted from a web page
pub const PageContent = struct {
    url: []const u8,
    title: []const u8,
    text: []const u8,
    links: []Link = &.{},
    forms: []Form = &.{},
    meta: std.StringHashMap([]const u8),

    pub const TEXT_LIMIT = 8000; // max characters to send to model

    pub fn deinit(self: *PageContent, allocator: Allocator) void {
        allocator.free(self.url);
        allocator.free(self.title);
        allocator.free(self.text);
        for (self.links) |l| l.deinit(allocator);
        allocator.free(self.links);
        for (self.forms) |f| f.deinit(allocator);
        allocator.free(self.forms);
        var it = self.meta.iterator();
        while (it.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            allocator.free(entry.value_ptr.*);
        }
        self.meta.deinit();
    }

    /// Format page content for LLM consumption with untrusted-data boundaries
    pub fn forLlm(self: PageContent, allocator: Allocator) error{OutOfMemory}![]const u8 {
        const domain = extractDomain(self.url);

        var parts: std.ArrayList([]const u8) = .empty;
        defer parts.deinit(allocator);

        try parts.append(allocator, try std.fmt.allocPrint(allocator, "===== UNTRUSTED WEB CONTENT [{s}] =====", .{domain}));
        try parts.append(allocator, try std.fmt.allocPrint(allocator, "URL: {s}", .{self.url}));
        try parts.append(allocator, try std.fmt.allocPrint(allocator, "Title: {s}", .{self.title}));
        try parts.append(allocator, "");

        // Truncate text if needed
        var text = self.text;
        var truncated_text: ?[]const u8 = null;
        if (text.len > TEXT_LIMIT) {
            truncated_text = try std.fmt.allocPrint(
                allocator,
                "{s}\n\n[...truncated — {d} chars total, showing first {d}]",
                .{ text[0..TEXT_LIMIT], text.len, TEXT_LIMIT },
            );
            text = truncated_text.?;
        }
        defer if (truncated_text) |t| allocator.free(t);

        try parts.append(allocator, text);

        // Add links
        if (self.links.len > 0) {
            try parts.append(allocator, "");
            try parts.append(allocator, try std.fmt.allocPrint(allocator, "--- Links ({d}) ---", .{self.links.len}));
            const max_links = @min(self.links.len, 100);
            for (self.links[0..max_links]) |link| {
                try parts.append(allocator, try std.fmt.allocPrint(allocator, "  [{s}] -> {s}", .{ link.text, link.href }));
            }
        }

        // Add forms
        if (self.forms.len > 0) {
            try parts.append(allocator, "");
            try parts.append(allocator, try std.fmt.allocPrint(allocator, "--- Forms ({d}) ---", .{self.forms.len}));
            for (self.forms) |form| {
                try parts.append(allocator, try std.fmt.allocPrint(allocator, "  <form action={s} method={s}>", .{ form.action, form.method }));
                for (form.fields) |field| {
                    try parts.append(allocator, try std.fmt.allocPrint(allocator, "    {s}: name={s}", .{ field.field_type, field.name }));
                }
            }
        }

        try parts.append(allocator, try std.fmt.allocPrint(allocator, "===== END UNTRUSTED WEB CONTENT [{s}] =====", .{domain}));

        return try std.mem.join(allocator, "\n", parts.items);
    }
};

/// Extract domain from URL
fn extractDomain(url: []const u8) []const u8 {
    // Simple domain extraction - look for :// and then take until next /
    if (std.mem.indexOf(u8, url, "://")) |scheme_end| {
        const after_scheme = url[scheme_end + 3 ..];
        if (std.mem.indexOf(u8, after_scheme, "/")) |path_start| {
            return after_scheme[0..path_start];
        }
        return after_scheme;
    }
    return "unknown";
}

/// Convert a dictionary (from JSON) back into PageContent
pub fn dictToPageContent(allocator: Allocator, data: std.json.Value) error{OutOfMemory}!PageContent {
    var links = std.ArrayList(Link).init(allocator);
    defer links.deinit();

    if (data.object.get("links")) |links_arr| {
        for (links_arr.array.items) |link_data| {
            try links.append(.{
                .text = try allocator.dupe(u8, link_data.object.get("text").?.string),
                .href = try allocator.dupe(u8, link_data.object.get("href").?.string),
            });
        }
    }

    var forms = std.ArrayList(Form).init(allocator);
    defer forms.deinit();

    if (data.object.get("forms")) |forms_arr| {
        for (forms_arr.array.items) |form_data| {
            var fields = std.ArrayList(FormField).init(allocator);
            defer fields.deinit();

            if (form_data.object.get("fields")) |fields_arr| {
                for (fields_arr.array.items) |field_data| {
                    try fields.append(.{
                        .name = try allocator.dupe(u8, field_data.object.get("name").?.string),
                        .field_type = try allocator.dupe(u8, field_data.object.get("type").?.string),
                        .value = if (field_data.object.get("value")) |v| try allocator.dupe(u8, v.string) else try allocator.dupe(u8, ""),
                        .placeholder = if (field_data.object.get("placeholder")) |p| try allocator.dupe(u8, p.string) else try allocator.dupe(u8, ""),
                    });
                }
            }

            try forms.append(.{
                .action = try allocator.dupe(u8, form_data.object.get("action").?.string),
                .method = try allocator.dupe(u8, form_data.object.get("method").?.string),
                .fields = try fields.toOwnedSlice(),
            });
        }
    }

    var meta = std.StringHashMap([]const u8).init(allocator);
    if (data.object.get("meta")) |meta_obj| {
        var it = meta_obj.object.iterator();
        while (it.next()) |entry| {
            try meta.put(
                try allocator.dupe(u8, entry.key_ptr.*),
                try allocator.dupe(u8, entry.value_ptr.*.string),
            );
        }
    }

    return PageContent{
        .url = try allocator.dupe(u8, data.object.get("url").?.string),
        .title = try allocator.dupe(u8, data.object.get("title").?.string),
        .text = try allocator.dupe(u8, data.object.get("text").?.string),
        .links = try links.toOwnedSlice(),
        .forms = try forms.toOwnedSlice(),
        .meta = meta,
    };
}

// =============================================================================
// JavaScript for content extraction
// =============================================================================

/// JavaScript executed in the page to extract structured content.
/// Filters out hidden/invisible elements to block prompt injection.
pub const EXTRACT_CONTENT_JS =
    \\return (function() {
    \\    var result = {};
    \\    result.url = window.location.href;
    \\    result.title = document.title || '';
    \\
    \\    function isVisible(el) {
    \\        if (el === document.body || el === document.documentElement) return true;
    \\        if (el.hidden) return false;
    \\        if (el.getAttribute('aria-hidden') === 'true') return false;
    \\        var style = window.getComputedStyle(el);
    \\        if (style.display === 'none') return false;
    \\        if (style.visibility === 'hidden') return false;
    \\        if (style.opacity === '0') return false;
    \\        return true;
    \\    }
    \\
    \\    function getTextContent(el) {
    \\        if (!isVisible(el)) return '';
    \\        if (el.nodeType === Node.TEXT_NODE) return el.textContent || '';
    \\        var text = '';
    \\        for (var i = 0; i < el.childNodes.length; i++) {
    \\            text += getTextContent(el.childNodes[i]);
    \\        }
    \\        return text;
    \\    }
    \\
    \\    result.text = getTextContent(document.body).replace(/\\s+/g, ' ').trim();
    \\
    \\    var links = [];
    \\    document.querySelectorAll('a[href]').forEach(function(a) {
    \\        if (isVisible(a)) {
    \\            links.push({
    \\                text: a.textContent.trim().substring(0, 100),
    \\                href: a.href
    \\            });
    \\        }
    \\    });
    \\    result.links = links;
    \\
    \\    var forms = [];
    \\    document.querySelectorAll('form').forEach(function(form) {
    \\        if (isVisible(form)) {
    \\            var fields = [];
    \\            form.querySelectorAll('input, textarea, select').forEach(function(input) {
    \\                fields.push({
    \\                    name: input.name || '',
    \\                    type: input.type || input.tagName.toLowerCase(),
    \\                    value: input.value || '',
    \\                    placeholder: input.placeholder || ''
    \\                });
    \\            });
    \\            forms.push({
    \\                action: form.action || '',
    \\                method: form.method || 'get',
    \\                fields: fields
    \\            });
    \\        }
    \\    });
    \\    result.forms = forms;
    \\
    \\    result.meta = {};
    \\    document.querySelectorAll('meta[name][content]').forEach(function(meta) {
    \\        result.meta[meta.getAttribute('name')] = meta.getAttribute('content');
    \\    });
    \\
    \\    return result;
    \\})();
;

// =============================================================================
// Tests
// =============================================================================

test "extractDomain extracts domain from URL" {
    try std.testing.expectEqualStrings("example.com", extractDomain("https://example.com/path"));
    try std.testing.expectEqualStrings("example.com:8080", extractDomain("http://example.com:8080/"));
    try std.testing.expectEqualStrings("unknown", extractDomain("not-a-url"));
}

test "PageContent constants" {
    try std.testing.expectEqual(@as(usize, 8000), PageContent.TEXT_LIMIT);
}
