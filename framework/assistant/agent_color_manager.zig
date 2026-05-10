//! Agent color management for UI display
//! Maps agent types to theme colors for visual distinction

const std = @import("std");
const Allocator = std.mem.Allocator;
const StringHashMap = std.StringHashMap;

/// Available color names for agents
pub const ColorName = enum {
    red,
    blue,
    green,
    yellow,
    purple,
    orange,
    pink,
    cyan,
};

/// All available colors
pub const ALL_COLORS: []const ColorName = &.{
    .red, .blue, .green, .yellow,
    .purple, .orange, .pink, .cyan,
};

/// Maps color names to theme color keys
pub const COLOR_TO_THEME = std.enums.EnumMap(ColorName, []const u8).init(.{
    .red = "red_FOR_AGENTS_ONLY",
    .blue = "blue_FOR_AGENTS_ONLY",
    .green = "green_FOR_AGENTS_ONLY",
    .yellow = "yellow_FOR_AGENTS_ONLY",
    .purple = "purple_FOR_AGENTS_ONLY",
    .orange = "orange_FOR_AGENTS_ONLY",
    .pink = "pink_FOR_AGENTS_ONLY",
    .cyan = "cyan_FOR_AGENTS_ONLY",
});

/// Color manager for assigning and tracking agent colors
pub const ColorManager = struct {
    allocator: Allocator,
    color_map: StringHashMap(ColorName),
    mutex: std.Thread.Mutex,

    pub fn init(allocator: Allocator) ColorManager {
        return .{
            .allocator = allocator,
            .color_map = StringHashMap(ColorName).init(allocator),
            .mutex = .{},
        };
    }

    pub fn deinit(self: *ColorManager) void {
        // Keys are assumed to be owned externally or static
        self.color_map.deinit();
    }

    /// Get the theme color for an agent type
    pub fn getAgentColor(self: *ColorManager, agent_type: []const u8) ?[]const u8 {
        // General purpose agent has no special color
        if (std.mem.eql(u8, agent_type, "general-purpose")) {
            return null;
        }

        self.mutex.lock();
        defer self.mutex.unlock();

        const entry = self.color_map.get(agent_type);
        if (entry) |color| {
            return COLOR_TO_THEME.get(color);
        }
        return null;
    }

    /// Set the color for an agent type
    pub fn setAgentColor(self: *ColorManager, agent_type: []const u8, color: ?ColorName) !void {
        self.mutex.lock();
        defer self.mutex.unlock();

        if (color) |c| {
            try self.color_map.put(agent_type, c);
        } else {
            _ = self.color_map.remove(agent_type);
        }
    }

    /// Check if a color name is valid
    pub fn isValidColor(color: []const u8) bool {
        inline for (std.meta.fields(ColorName)) |field| {
            if (std.mem.eql(u8, color, field.name)) return true;
        }
        return false;
    }

    /// Parse a color name string
    pub fn parseColor(color: []const u8) ?ColorName {
        inline for (std.meta.fields(ColorName)) |field| {
            if (std.mem.eql(u8, color, field.name)) {
                return @enumFromInt(field.value);
            }
        }
        return null;
    }
};

// =============================================================================
// Tests
// =============================================================================

test "ColorManager - basic operations" {
    const allocator = std.testing.allocator;
    var manager = ColorManager.init(allocator);
    defer manager.deinit();

    // Test general-purpose has no color
    try std.testing.expectEqual(@as(?[]const u8, null), manager.getAgentColor("general-purpose"));

    // Test setting and getting color
    try manager.setAgentColor("explorer", .blue);
    try std.testing.expectEqualStrings("blue_FOR_AGENTS_ONLY", manager.getAgentColor("explorer").?);

    // Test removing color
    try manager.setAgentColor("explorer", null);
    try std.testing.expectEqual(@as(?[]const u8, null), manager.getAgentColor("explorer"));
}

test "ColorManager - parse color" {
    try std.testing.expectEqual(ColorName.red, ColorManager.parseColor("red").?);
    try std.testing.expectEqual(ColorName.cyan, ColorManager.parseColor("cyan").?);
    try std.testing.expectEqual(@as(?ColorName, null), ColorManager.parseColor("invalid"));
}

test "isOneShotBuiltinAgentType" {
    const constants = @import("constants.zig");
    try std.testing.expect(constants.isOneShotBuiltinAgentType("Explore"));
    try std.testing.expect(constants.isOneShotBuiltinAgentType("Plan"));
    try std.testing.expect(!constants.isOneShotBuiltinAgentType("general-purpose"));
}
