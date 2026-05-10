//! Swarm/Team Management
//!
//! White-label multi-agent team management system.
//! Supports pane-based (tmux, iTerm2) and in-process teammate execution.

const std = @import("std");

// Sub-modules
pub const constants = @import("swarm/constants.zig");
pub const team_helpers = @import("swarm/team_helpers.zig");
pub const spawn_utils = @import("swarm/spawn_utils.zig");
pub const backend_types = @import("swarm/backends/types.zig");

// Re-export commonly used types
pub const BackendType = backend_types.BackendType;
pub const PaneBackendType = backend_types.PaneBackendType;
pub const PaneId = backend_types.PaneId;
pub const CreatePaneResult = backend_types.CreatePaneResult;
pub const TeammateIdentity = backend_types.TeammateIdentity;
pub const TeammateSpawnConfig = backend_types.TeammateSpawnConfig;
pub const TeammateSpawnResult = backend_types.TeammateSpawnResult;
pub const TeammateMessage = backend_types.TeammateMessage;
pub const SystemPromptMode = backend_types.SystemPromptMode;
pub const BackendDetectionResult = backend_types.BackendDetectionResult;
pub const isPaneBackend = backend_types.isPaneBackend;

pub const TeamFile = team_helpers.TeamFile;
pub const TeamMember = team_helpers.TeamMember;
pub const TeamAllowedPath = team_helpers.TeamAllowedPath;
pub const sanitizeName = team_helpers.sanitizeName;
pub const sanitizeAgentName = team_helpers.sanitizeAgentName;
pub const getTeamDir = team_helpers.getTeamDir;
pub const getTeamFilePath = team_helpers.getTeamFilePath;

pub const CliFlagOptions = spawn_utils.CliFlagOptions;
pub const PermissionMode = spawn_utils.PermissionMode;
pub const getTeammateCommand = spawn_utils.getTeammateCommand;
pub const buildInheritedCliFlags = spawn_utils.buildInheritedCliFlags;
pub const buildInheritedEnvVars = spawn_utils.buildInheritedEnvVars;
pub const shellQuote = spawn_utils.shellQuote;

// Constants
pub const TEAM_LEAD_NAME = constants.TEAM_LEAD_NAME;
pub const SWARM_SESSION_NAME = constants.SWARM_SESSION_NAME;
pub const SWARM_VIEW_WINDOW_NAME = constants.SWARM_VIEW_WINDOW_NAME;
pub const TMUX_COMMAND = constants.TMUX_COMMAND;
pub const HIDDEN_SESSION_NAME = constants.HIDDEN_SESSION_NAME;
pub const TEAMMATE_COMMAND_ENV_VAR = constants.TEAMMATE_COMMAND_ENV_VAR;
pub const TEAMMATE_COLOR_ENV_VAR = constants.TEAMMATE_COLOR_ENV_VAR;
pub const PLAN_MODE_REQUIRED_ENV_VAR = constants.PLAN_MODE_REQUIRED_ENV_VAR;

// =============================================================================
// High-level Team Management API
// =============================================================================

/// Team manager for high-level operations
pub const TeamManager = struct {
    allocator: std.mem.Allocator,
    base_dir: []const u8,

    pub fn init(allocator: std.mem.Allocator, base_dir: []const u8) TeamManager {
        return .{
            .allocator = allocator,
            .base_dir = base_dir,
        };
    }

    /// Create a new team
    pub fn createTeam(
        self: TeamManager,
        team_name: []const u8,
        lead_agent_id: []const u8,
        description: ?[]const u8,
    ) error{OutOfMemory}!TeamFile {
        const now = std.time.timestamp();

        return TeamFile{
            .name = try self.allocator.dupe(u8, team_name),
            .description = if (description) |d| try self.allocator.dupe(u8, d) else null,
            .created_at = now,
            .lead_agent_id = try self.allocator.dupe(u8, lead_agent_id),
            .members = &.{},
        };
    }

    /// Get the path to a team's directory
    pub fn getTeamDirPath(
        self: TeamManager,
        team_name: []const u8,
        buf: []u8,
    ) []const u8 {
        return team_helpers.getTeamDir(self.base_dir, team_name, buf);
    }

    /// Get the path to a team's config file
    pub fn getTeamConfigPath(
        self: TeamManager,
        team_name: []const u8,
        buf: []u8,
    ) []const u8 {
        return team_helpers.getTeamFilePath(self.base_dir, team_name, buf);
    }
};

/// Check if a team name is valid
pub fn isValidTeamName(name: []const u8) bool {
    if (name.len == 0 or name.len > 64) return false;

    for (name) |c| {
        if (!std.ascii.isAlphanumeric(c) and c != '-' and c != '_') {
            return false;
        }
    }

    return true;
}

/// Generate a unique team name based on a base name
pub fn generateTeamName(
    allocator: std.mem.Allocator,
    base_name: []const u8,
    existing_teams: []const []const u8,
) error{OutOfMemory}![]const u8 {
    // Check if base name is available
    var available = true;
    for (existing_teams) |team| {
        if (std.mem.eql(u8, team, base_name)) {
            available = false;
            break;
        }
    }

    if (available) {
        return try allocator.dupe(u8, base_name);
    }

    // Try numbered variants
    var i: u32 = 2;
    while (i < 1000) : (i += 1) {
        const candidate = try std.fmt.allocPrint(allocator, "{s}-{d}", .{ base_name, i });

        var candidate_available = true;
        for (existing_teams) |team| {
            if (std.mem.eql(u8, team, candidate)) {
                candidate_available = false;
                break;
            }
        }

        if (candidate_available) {
            return candidate;
        }

        allocator.free(candidate);
    }

    return error.OutOfMemory;
}

// =============================================================================
// Tests
// =============================================================================

test "TeamManager creates team correctly" {
    const allocator = std.testing.allocator;
    const manager = TeamManager.init(allocator, "/home/user/.config");

    const team = try manager.createTeam("my-team", "lead@my-team", "Test team");
    defer {
        allocator.free(team.name);
        if (team.description) |d| allocator.free(d);
        allocator.free(team.lead_agent_id);
    }

    try std.testing.expectEqualStrings("my-team", team.name);
    try std.testing.expectEqualStrings("lead@my-team", team.lead_agent_id);
    try std.testing.expect(team.created_at > 0);
}

test "isValidTeamName validates correctly" {
    try std.testing.expect(isValidTeamName("my-team"));
    try std.testing.expect(isValidTeamName("my_team"));
    try std.testing.expect(isValidTeamName("team123"));
    try std.testing.expect(!isValidTeamName(""));
    try std.testing.expect(!isValidTeamName("my team"));
    try std.testing.expect(!isValidTeamName("my@team"));
}

test "generateTeamName with unique name" {
    const allocator = std.testing.allocator;
    const existing = &[_][]const u8{"team-a", "team-b"};

    const name = try generateTeamName(allocator, "my-team", existing);
    defer allocator.free(name);

    try std.testing.expectEqualStrings("my-team", name);
}

test "generateTeamName with duplicate name" {
    const allocator = std.testing.allocator;
    const existing = &[_][]const u8{"my-team", "my-team-2"};

    const name = try generateTeamName(allocator, "my-team", existing);
    defer allocator.free(name);

    try std.testing.expectEqualStrings("my-team-3", name);
}
