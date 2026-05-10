//! Core constants for the Agent Tool system
//! White-label ready - no product-specific naming

const std = @import("std");

/// Name of the agent tool
pub const AGENT_TOOL_NAME = "Agent";

/// Legacy wire name for backward compatibility
pub const LEGACY_AGENT_TOOL_NAME = "Task";

/// Verification agent type identifier
pub const VERIFICATION_AGENT_TYPE = "verification";

/// Built-in agent types that run once and return a report
/// These skip the agentId/SendMessage trailer to save tokens
pub const ONE_SHOT_BUILTIN_AGENT_TYPES = [_][]const u8{
    "Explore",
    "Plan",
};

/// Check if an agent type is a one-shot built-in
pub fn isOneShotBuiltinAgentType(agent_type: []const u8) bool {
    for (ONE_SHOT_BUILTIN_AGENT_TYPES) |t| {
        if (std.mem.eql(u8, agent_type, t)) return true;
    }
    return false;
}
