//! Built-in Agent Definitions
//! Registry of all built-in agent types

const std = @import("std");
const AgentDefinition = @import("agent_definition.zig").AgentDefinition;
const Allocator = std.mem.Allocator;

// Import individual agent modules
pub const explore_agent = @import("built_in/explore_agent.zig");
pub const plan_agent = @import("built_in/plan_agent.zig");
pub const general_purpose_agent = @import("built_in/general_purpose_agent.zig");
pub const verification_agent = @import("built_in/verification_agent.zig");
pub const statusline_agent = @import("built_in/statusline_agent.zig");
pub const guide_agent = @import("built_in/guide_agent.zig");

/// Configuration for built-in agents
pub const BuiltInConfig = struct {
    /// Whether explore/plan agents are enabled
    explore_plan_enabled: bool = true,
    /// Whether verification agent is enabled
    verification_enabled: bool = false,
    /// Whether guide agent is enabled
    guide_enabled: bool = true,
    /// Whether statusline agent is enabled
    statusline_enabled: bool = true,
    /// Whether running in internal mode
    is_internal: bool = false,
    /// Whether using embedded search tools
    has_embedded_search: bool = false,
    /// Whether in non-interactive/SDK mode
    is_sdk_mode: bool = false,
    /// Whether in coordinator mode
    is_coordinator: bool = false,
};

/// Get all enabled built-in agents
pub fn getBuiltInAgents(config: BuiltInConfig, allocator: Allocator) ![]AgentDefinition {
    // Maximum possible agents
    var agents: [6]AgentDefinition = undefined;
    var count: usize = 0;

    // Always include general-purpose
    agents[count] = general_purpose_agent.createAgent();
    count += 1;

    // Include statusline if enabled
    if (config.statusline_enabled) {
        agents[count] = statusline_agent.createAgent();
        count += 1;
    }

    // Include explore/plan if enabled
    if (config.explore_plan_enabled) {
        agents[count] = explore_agent.createAgent(config.has_embedded_search, config.is_internal);
        count += 1;
        agents[count] = plan_agent.createAgent(config.has_embedded_search);
        count += 1;
    }

    // Include guide if enabled (not in SDK mode)
    if (config.guide_enabled and !config.is_sdk_mode) {
        agents[count] = guide_agent.createAgent(config.has_embedded_search);
        count += 1;
    }

    // Include verification if enabled
    if (config.verification_enabled) {
        agents[count] = verification_agent.createAgent();
        count += 1;
    }

    // Copy to heap
    const result = try allocator.alloc(AgentDefinition, count);
    @memcpy(result, agents[0..count]);
    return result;
}

/// Find a built-in agent by type
pub fn findBuiltInAgent(agent_type: []const u8, config: BuiltInConfig) ?AgentDefinition {
    if (std.mem.eql(u8, agent_type, general_purpose_agent.AGENT_TYPE)) {
        return general_purpose_agent.createAgent();
    }
    if (config.statusline_enabled and std.mem.eql(u8, agent_type, statusline_agent.AGENT_TYPE)) {
        return statusline_agent.createAgent();
    }
    if (config.explore_plan_enabled and std.mem.eql(u8, agent_type, explore_agent.AGENT_TYPE)) {
        return explore_agent.createAgent(config.has_embedded_search, config.is_internal);
    }
    if (config.explore_plan_enabled and std.mem.eql(u8, agent_type, plan_agent.AGENT_TYPE)) {
        return plan_agent.createAgent(config.has_embedded_search);
    }
    if (config.guide_enabled and !config.is_sdk_mode and std.mem.eql(u8, agent_type, guide_agent.AGENT_TYPE)) {
        return guide_agent.createAgent(config.has_embedded_search);
    }
    if (config.verification_enabled and std.mem.eql(u8, agent_type, verification_agent.AGENT_TYPE)) {
        return verification_agent.createAgent();
    }
    return null;
}

/// Check if agent type is a built-in
pub fn isBuiltInAgentType(agent_type: []const u8, config: BuiltInConfig) bool {
    return findBuiltInAgent(agent_type, config) != null;
}

/// Get count of built-in agents
pub fn getBuiltInAgentCount(config: BuiltInConfig) u32 {
    var count: u32 = 1; // general-purpose
    if (config.statusline_enabled) count += 1;
    if (config.explore_plan_enabled) count += 2;
    if (config.guide_enabled and !config.is_sdk_mode) count += 1;
    if (config.verification_enabled) count += 1;
    return count;
}

// =============================================================================
// Tests
// =============================================================================

test "getBuiltInAgents basic" {
    const allocator = std.testing.allocator;
    const config = BuiltInConfig{};
    const agents = try getBuiltInAgents(config, allocator);
    defer allocator.free(agents);

    // general-purpose + statusline + explore + plan + guide = 5
    try std.testing.expectEqual(@as(usize, 5), agents.len);
}

test "getBuiltInAgents without explore/plan" {
    const allocator = std.testing.allocator;
    const config = BuiltInConfig{ .explore_plan_enabled = false };
    const agents = try getBuiltInAgents(config, allocator);
    defer allocator.free(agents);

    // general-purpose + statusline + guide = 3
    try std.testing.expectEqual(@as(usize, 3), agents.len);
}

test "getBuiltInAgents SDK mode" {
    const allocator = std.testing.allocator;
    const config = BuiltInConfig{ .is_sdk_mode = true };
    const agents = try getBuiltInAgents(config, allocator);
    defer allocator.free(agents);

    // general-purpose + statusline + explore + plan (no guide) = 4
    try std.testing.expectEqual(@as(usize, 4), agents.len);
}

test "findBuiltInAgent" {
    const config = BuiltInConfig{};

    const gp = findBuiltInAgent("general-purpose", config);
    try std.testing.expect(gp != null);
    try std.testing.expectEqualStrings("general-purpose", gp.?.agent_type);

    const explore = findBuiltInAgent("Explore", config);
    try std.testing.expect(explore != null);
    try std.testing.expectEqualStrings("Explore", explore.?.agent_type);

    const unknown = findBuiltInAgent("unknown", config);
    try std.testing.expect(unknown == null);
}

test "isBuiltInAgentType" {
    const config = BuiltInConfig{};
    try std.testing.expect(isBuiltInAgentType("general-purpose", config));
    try std.testing.expect(isBuiltInAgentType("Explore", config));
    try std.testing.expect(!isBuiltInAgentType("custom-agent", config));
}

test "getBuiltInAgentCount" {
    const config1 = BuiltInConfig{};
    try std.testing.expectEqual(@as(u32, 5), getBuiltInAgentCount(config1));

    const config2 = BuiltInConfig{ .explore_plan_enabled = false };
    try std.testing.expectEqual(@as(u32, 3), getBuiltInAgentCount(config2));

    const config3 = BuiltInConfig{ .explore_plan_enabled = false, .statusline_enabled = false };
    try std.testing.expectEqual(@as(u32, 2), getBuiltInAgentCount(config3));
}
