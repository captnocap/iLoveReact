//! Swarm/Team Constants
//!
//! White-label constants for multi-agent team management.
//! Replaces product-specific terms with generic equivalents.

const std = @import("std");

/// Name of the team lead agent
pub const TEAM_LEAD_NAME = "team-lead";

/// Name of the swarm session
pub const SWARM_SESSION_NAME = "agent-swarm";

/// Name of the swarm view window
pub const SWARM_VIEW_WINDOW_NAME = "swarm-view";

/// tmux command
pub const TMUX_COMMAND = "tmux";

/// Name for hidden session
pub const HIDDEN_SESSION_NAME = "agent-hidden";

/// Environment variable to override the command used to spawn team members
pub const TEAMMATE_COMMAND_ENV_VAR = "AGENT_TEAMMATE_COMMAND";

/// Environment variable set on spawned team members to indicate their assigned color
pub const TEAMMATE_COLOR_ENV_VAR = "AGENT_TEAM_COLOR";

/// Environment variable to require plan mode before implementation
pub const PLAN_MODE_REQUIRED_ENV_VAR = "AGENT_PLAN_MODE_REQUIRED";

/// Legacy environment variable names for backward compatibility
pub const LEGACY_TEAMMATE_COMMAND_ENV_VAR = "CLAUDE_CODE_TEAMMATE_COMMAND";
pub const LEGACY_TEAMMATE_COLOR_ENV_VAR = "CLAUDE_CODE_AGENT_COLOR";
pub const LEGACY_PLAN_MODE_REQUIRED_ENV_VAR = "CLAUDE_CODE_PLAN_MODE_REQUIRED";

/// Gets the socket name for external swarm sessions
pub fn getSwarmSocketName(buf: []u8) ![]const u8 {
    const pid = std.process.getPidBase();
    return try std.fmt.bufPrint(buf, "agent-swarm-{d}", .{pid});
}

// =============================================================================
// Tests
// =============================================================================

test "constants have expected values" {
    try std.testing.expectEqualStrings("team-lead", TEAM_LEAD_NAME);
    try std.testing.expectEqualStrings("agent-swarm", SWARM_SESSION_NAME);
    try std.testing.expectEqualStrings("swarm-view", SWARM_VIEW_WINDOW_NAME);
    try std.testing.expectEqualStrings("tmux", TMUX_COMMAND);
    try std.testing.expectEqualStrings("agent-hidden", HIDDEN_SESSION_NAME);
}

test "getSwarmSocketName returns valid format" {
    var buf: [256]u8 = undefined;
    const name = try getSwarmSocketName(&buf);
    try std.testing.expect(std.mem.startsWith(u8, name, "agent-swarm-"));
}
