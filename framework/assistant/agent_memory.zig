//! Agent memory management
//! Handles persistent memory storage for agents across sessions

const std = @import("std");
const Allocator = std.mem.Allocator;

/// Memory scope for agent persistence
pub const MemoryScope = enum {
    /// User-wide memory (~/.agent-memory/)
    user,
    /// Project-specific memory (.agent-memory/)
    project,
    /// Local/non-shared memory (.agent-memory-local/)
    local,
};

/// Sanitize agent type for use as directory name
pub fn sanitizeAgentType(allocator: Allocator, agent_type: []const u8) ![]const u8 {
    // Replace colons with dashes (for plugin-namespaced agents)
    if (std.mem.indexOfScalar(u8, agent_type, ':')) |_| {
        var result = try allocator.alloc(u8, agent_type.len);
        for (agent_type, 0..) |c, i| {
            result[i] = if (c == ':') '-' else c;
        }
        return result;
    }
    return try allocator.dupe(u8, agent_type);
}

/// Configuration for memory directories
pub const MemoryConfig = struct {
    base_dir: []const u8,
    project_root: []const u8,
    remote_memory_dir: ?[]const u8,

    /// Get the memory directory for an agent type and scope
    pub fn getAgentMemoryDir(
        self: MemoryConfig,
        agent_type: []const u8,
        scope: MemoryScope,
        allocator: Allocator,
    ) ![]const u8 {
        const sanitized = try sanitizeAgentType(allocator, agent_type);
        defer allocator.free(sanitized);

        const path = switch (scope) {
            .user => try std.fs.path.join(allocator, &.{ self.base_dir, "agent-memory", sanitized }),
            .project => try std.fs.path.join(allocator, &.{ self.project_root, ".agent-memory", sanitized }),
            .local => try self.getLocalMemoryDir(sanitized, allocator),
        };
        defer allocator.free(path);

        // Ensure trailing separator
        return try std.fmt.allocPrint(allocator, "{s}{c}", .{ path, std.fs.path.sep });
    }

    fn getLocalMemoryDir(self: MemoryConfig, dir_name: []const u8, allocator: Allocator) ![]const u8 {
        if (self.remote_memory_dir) |remote| {
            const project_name = std.fs.path.basename(self.project_root);
            return try std.fs.path.join(allocator, &.{
                remote, "projects", project_name, "agent-memory-local", dir_name,
            });
        }
        return try std.fs.path.join(allocator, &.{ self.project_root, ".agent-memory-local", dir_name });
    }

    /// Get the memory entrypoint file path
    pub fn getMemoryEntrypoint(
        self: MemoryConfig,
        agent_type: []const u8,
        scope: MemoryScope,
        allocator: Allocator,
    ) ![]const u8 {
        const dir = try self.getAgentMemoryDir(agent_type, scope, allocator);
        defer allocator.free(dir);
        return try std.fs.path.join(allocator, &.{ dir, "MEMORY.md" });
    }

    /// Get display string for memory scope
    pub fn getScopeDisplay(self: MemoryConfig, scope: MemoryScope, allocator: Allocator) ![]const u8 {
        return switch (scope) {
            .user => try std.fmt.allocPrint(allocator, "User ({s}/)", .{self.base_dir}),
            .project => try allocator.dupe(u8, "Project (.agent-memory/)"),
            .local => blk: {
                const local_path = try self.getLocalMemoryDir("...", allocator);
                defer allocator.free(local_path);
                break :blk try std.fmt.allocPrint(allocator, "Local ({s})", .{local_path});
            },
        };
    }
};

/// Build memory prompt for agent initialization
pub const MemoryPromptBuilder = struct {
    /// Build a memory prompt with guidelines
    pub fn build(
        allocator: Allocator,
        display_name: []const u8,
        memory_dir: []const u8,
        extra_guidelines: ?[]const []const u8,
    ) ![]const u8 {
        var parts: std.ArrayList([]const u8) = .empty;
        defer parts.deinit(allocator);

        try parts.append(allocator, "# ");
        try parts.append(allocator, display_name);
        try parts.append(allocator, "\n\n");
        try parts.append(allocator, "Memory directory: ");
        try parts.append(allocator, memory_dir);
        try parts.append(allocator, "\n\n");

        if (extra_guidelines) |guidelines| {
            for (guidelines) |g| {
                try parts.append(allocator, g);
                try parts.append(allocator, "\n");
            }
        }

        return try std.mem.concat(allocator, u8, parts.items);
    }
};

// =============================================================================
// Tests
// =============================================================================

test "sanitizeAgentType" {
    const allocator = std.testing.allocator;

    const result1 = try sanitizeAgentType(allocator, "my-agent");
    defer allocator.free(result1);
    try std.testing.expectEqualStrings("my-agent", result1);

    const result2 = try sanitizeAgentType(allocator, "plugin:my-agent");
    defer allocator.free(result2);
    try std.testing.expectEqualStrings("plugin-my-agent", result2);
}

test "MemoryConfig - getAgentMemoryDir user scope" {
    const allocator = std.testing.allocator;
    const config = MemoryConfig{
        .base_dir = "/home/user/.config",
        .project_root = "/project",
        .remote_memory_dir = null,
    };

    const dir = try config.getAgentMemoryDir("explorer", .user, allocator);
    defer allocator.free(dir);
    try std.testing.expectEqualStrings("/home/user/.config/agent-memory/explorer/", dir);
}

test "MemoryConfig - getAgentMemoryDir project scope" {
    const allocator = std.testing.allocator;
    const config = MemoryConfig{
        .base_dir = "/home/user/.config",
        .project_root = "/project",
        .remote_memory_dir = null,
    };

    const dir = try config.getAgentMemoryDir("explorer", .project, allocator);
    defer allocator.free(dir);
    try std.testing.expectEqualStrings("/project/.agent-memory/explorer/", dir);
}

test "MemoryConfig - getMemoryEntrypoint" {
    const allocator = std.testing.allocator;
    const config = MemoryConfig{
        .base_dir = "/home/user/.config",
        .project_root = "/project",
        .remote_memory_dir = null,
    };

    const path = try config.getMemoryEntrypoint("explorer", .user, allocator);
    defer allocator.free(path);
    try std.testing.expectEqualStrings("/home/user/.config/agent-memory/explorer/MEMORY.md", path);
}

test "MemoryPromptBuilder" {
    const allocator = std.testing.allocator;
    const guidelines = &.{"- Keep notes organized", "- Review regularly"};

    const prompt = try MemoryPromptBuilder.build(
        allocator,
        "Agent Memory",
        "/path/to/memory",
        guidelines,
    );
    defer allocator.free(prompt);

    try std.testing.expect(std.mem.indexOf(u8, prompt, "# Agent Memory") != null);
    try std.testing.expect(std.mem.indexOf(u8, prompt, "/path/to/memory") != null);
    try std.testing.expect(std.mem.indexOf(u8, prompt, "Keep notes organized") != null);
}
