//! Agent Tool Library
//! White-label agent orchestration system
//!
//! This library provides core functionality for managing and executing
//! autonomous agents with configurable behaviors, permissions, and capabilities.

const std = @import("std");

// Core modules
pub const constants = @import("constants.zig");
pub const agent_definition = @import("agent_definition.zig");
pub const agent_color_manager = @import("agent_color_manager.zig");
pub const agent_display = @import("agent_display.zig");
pub const agent_memory = @import("agent_memory.zig");
pub const agent_memory_snapshot = @import("agent_memory_snapshot.zig");
pub const built_in_agents = @import("built_in_agents.zig");

// Shell tool module
pub const bash_tool = @import("bash_tool.zig");

// Swarm/Team management module
pub const swarm = @import("swarm.zig");

// Browser automation module
pub const browser = @import("browser.zig");

// Re-export commonly used types
pub const AgentDefinition = agent_definition.AgentDefinition;
pub const AgentSource = agent_definition.AgentSource;
pub const PermissionMode = agent_definition.PermissionMode;
pub const EffortLevel = agent_definition.EffortLevel;
pub const MemoryScope = agent_definition.MemoryScope;
pub const ColorName = agent_color_manager.ColorName;
pub const ColorManager = agent_color_manager.ColorManager;

// Version
pub const VERSION = "0.1.0";

/// Initialize the agent tool library
pub fn init() void {
    // Initialization code if needed
}

/// Deinitialize the agent tool library
pub fn deinit() void {
    // Cleanup code if needed
}

// Run all tests
test {
    _ = @import("constants.zig");
    _ = @import("agent_definition.zig");
    _ = @import("agent_color_manager.zig");
    _ = @import("agent_display.zig");
    _ = @import("agent_memory.zig");
    _ = @import("agent_memory_snapshot.zig");
    _ = @import("built_in_agents.zig");
    _ = @import("bash_tool.zig");
    _ = @import("swarm.zig");
    _ = @import("browser.zig");
}
