//! Team Management Helpers
//!
//! Utilities for managing team files and member tracking.

const std = @import("std");
const BackendType = @import("backends/types.zig").BackendType;

/// Team member information
pub const TeamMember = struct {
    agent_id: []const u8,
    name: []const u8,
    agent_type: ?[]const u8 = null,
    model: ?[]const u8 = null,
    prompt: ?[]const u8 = null,
    color: ?[]const u8 = null,
    plan_mode_required: bool = false,
    joined_at: i64,
    tmux_pane_id: []const u8,
    cwd: []const u8,
    worktree_path: ?[]const u8 = null,
    session_id: ?[]const u8 = null,
    subscriptions: [][]const u8,
    backend_type: ?BackendType = null,
    is_active: ?bool = null,
    mode: ?[]const u8 = null,
};

/// Allowed path entry for team
pub const TeamAllowedPath = struct {
    path: []const u8,
    tool_name: []const u8,
    added_by: []const u8,
    added_at: i64,
};

/// Team file structure
pub const TeamFile = struct {
    name: []const u8,
    description: ?[]const u8 = null,
    created_at: i64,
    lead_agent_id: []const u8,
    lead_session_id: ?[]const u8 = null,
    hidden_pane_ids: ?[][]const u8 = null,
    team_allowed_paths: ?[]TeamAllowedPath = null,
    members: []TeamMember,

    /// Free allocated memory
    pub fn deinit(self: TeamFile, allocator: std.mem.Allocator) void {
        for (self.members) |m| {
            allocator.free(m.subscriptions);
        }
        allocator.free(self.members);
        if (self.hidden_pane_ids) |ids| {
            allocator.free(ids);
        }
        if (self.team_allowed_paths) |paths| {
            allocator.free(paths);
        }
    }
};

/// Sanitize a name for use in file paths and identifiers
pub fn sanitizeName(name: []const u8, buf: []u8) []const u8 {
    var i: usize = 0;
    for (name) |c| {
        if (i >= buf.len) break;
        if (std.ascii.isAlphanumeric(c)) {
            buf[i] = std.ascii.toLower(c);
            i += 1;
        } else if (i > 0 and buf[i - 1] != '-') {
            buf[i] = '-';
            i += 1;
        }
    }
    // Trim trailing hyphen
    if (i > 0 and buf[i - 1] == '-') {
        i -= 1;
    }
    return buf[0..i];
}

/// Sanitize agent name (replaces @ with -)
pub fn sanitizeAgentName(name: []const u8, buf: []u8) []const u8 {
    var i: usize = 0;
    for (name) |c| {
        if (i >= buf.len) break;
        buf[i] = if (c == '@') '-' else c;
        i += 1;
    }
    return buf[0..i];
}

/// Get the team directory path
pub fn getTeamDir(base_dir: []const u8, team_name: []const u8, buf: []u8) []const u8 {
    var sanitized_buf: [256]u8 = undefined;
    const sanitized = sanitizeName(team_name, &sanitized_buf);
    return std.fmt.bufPrint(buf, "{s}/teams/{s}", .{ base_dir, sanitized }) catch buf[0..0];
}

/// Get the team config file path
pub fn getTeamFilePath(base_dir: []const u8, team_name: []const u8, buf: []u8) []const u8 {
    var team_dir_buf: [512]u8 = undefined;
    const team_dir = getTeamDir(base_dir, team_name, &team_dir_buf);
    return std.fmt.bufPrint(buf, "{s}/config.json", .{team_dir}) catch buf[0..0];
}

// =============================================================================
// Tests
// =============================================================================

test "sanitizeName replaces non-alphanumeric with hyphens" {
    var buf: [256]u8 = undefined;
    const result = sanitizeName("My Team Name!", &buf);
    try std.testing.expectEqualStrings("my-team-name", result);
}

test "sanitizeName handles consecutive special chars" {
    var buf: [256]u8 = undefined;
    const result = sanitizeName("test---name", &buf);
    try std.testing.expectEqualStrings("test-name", result);
}

test "sanitizeAgentName replaces @ with hyphen" {
    var buf: [256]u8 = undefined;
    const result = sanitizeAgentName("agent@team", &buf);
    try std.testing.expectEqualStrings("agent-team", result);
}

test "getTeamDir returns expected path" {
    var buf: [512]u8 = undefined;
    const result = getTeamDir("/home/user/.config", "My Team", &buf);
    try std.testing.expectEqualStrings("/home/user/.config/teams/my-team", result);
}
