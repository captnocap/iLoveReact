//! Backend Types for Swarm/Team Management
//!
//! Types for pane-based and in-process teammate execution backends.

const std = @import("std");
const ColorName = @import("../../agent_color_manager.zig").ColorName;

/// Types of backends available for teammate execution
pub const BackendType = enum {
    tmux,
    iterm2,
    in_process,
};

/// Subset for pane-based backends only
pub const PaneBackendType = enum {
    tmux,
    iterm2,
};

/// Opaque identifier for a pane managed by a backend
pub const PaneId = []const u8;

/// Result of creating a new teammate pane
pub const CreatePaneResult = struct {
    /// The pane ID for the newly created pane
    pane_id: PaneId,
    /// Whether this is the first teammate pane
    is_first_teammate: bool,
};

/// Identity fields for a teammate
pub const TeammateIdentity = struct {
    /// Agent name (e.g., "researcher", "tester")
    name: []const u8,
    /// Team name this teammate belongs to
    team_name: []const u8,
    /// Assigned color for UI differentiation
    color: ?ColorName = null,
    /// Whether plan mode approval is required before implementation
    plan_mode_required: bool = false,

    /// Get the unique agent ID (format: name@team_name)
    pub fn getAgentId(self: TeammateIdentity, allocator: std.mem.Allocator) error{OutOfMemory}![]const u8 {
        return try std.fmt.allocPrint(allocator, "{s}@{s}", .{ self.name, self.team_name });
    }
};

/// Configuration for spawning a teammate
pub const TeammateSpawnConfig = struct {
    /// Identity fields
    identity: TeammateIdentity,
    /// Initial prompt to send to the teammate
    prompt: []const u8,
    /// Working directory for the teammate
    cwd: []const u8,
    /// Model to use for this teammate
    model: ?[]const u8 = null,
    /// System prompt for this teammate
    system_prompt: ?[]const u8 = null,
    /// How to apply the system prompt
    system_prompt_mode: SystemPromptMode = .default,
    /// Optional git worktree path
    worktree_path: ?[]const u8 = null,
    /// Parent session ID (for context linking)
    parent_session_id: []const u8,
    /// Tool permissions to grant this teammate
    permissions: ?[][]const u8 = null,
    /// Whether teammate can show permission prompts for unlisted tools
    allow_permission_prompts: bool = false,
};

/// System prompt application mode
pub const SystemPromptMode = enum {
    default,
    replace,
    append,
};

/// Result from spawning a teammate
pub const TeammateSpawnResult = struct {
    /// Whether spawn was successful
    success: bool,
    /// Unique agent ID
    agent_id: []const u8,
    /// Error message if spawn failed
    error_message: ?[]const u8 = null,
    /// Pane ID (pane-based only)
    pane_id: ?PaneId = null,
};

/// Message to send to a teammate
pub const TeammateMessage = struct {
    /// Message content
    text: []const u8,
    /// Sender agent ID
    from: []const u8,
    /// Sender display color
    color: ?[]const u8 = null,
    /// Message timestamp (ISO string)
    timestamp: ?[]const u8 = null,
    /// 5-10 word summary shown as preview
    summary: ?[]const u8 = null,
};

/// Result from backend detection
pub const BackendDetectionResult = struct {
    /// The backend type that should be used
    backend: BackendType,
    /// Whether we're running inside the backend's native environment
    is_native: bool,
    /// If iTerm2 is detected but it2 not installed
    needs_it2_setup: bool = false,
};

/// Check if a backend type uses terminal panes
pub fn isPaneBackend(backend_type: BackendType) bool {
    return backend_type == .tmux or backend_type == .iterm2;
}

// =============================================================================
// Tests
// =============================================================================

test "BackendType enum values" {
    try std.testing.expectEqual(@as(u2, 0), @intFromEnum(BackendType.tmux));
    try std.testing.expectEqual(@as(u2, 1), @intFromEnum(BackendType.iterm2));
    try std.testing.expectEqual(@as(u2, 2), @intFromEnum(BackendType.in_process));
}

test "isPaneBackend returns correct values" {
    try std.testing.expect(isPaneBackend(.tmux));
    try std.testing.expect(isPaneBackend(.iterm2));
    try std.testing.expect(!isPaneBackend(.in_process));
}

test "TeammateIdentity getAgentId" {
    const allocator = std.testing.allocator;
    const identity = TeammateIdentity{
        .name = "researcher",
        .team_name = "myteam",
    };
    const agent_id = try identity.getAgentId(allocator);
    defer allocator.free(agent_id);
    try std.testing.expectEqualStrings("researcher@myteam", agent_id);
}

test "SystemPromptMode enum" {
    try std.testing.expectEqual(@as(u2, 0), @intFromEnum(SystemPromptMode.default));
    try std.testing.expectEqual(@as(u2, 1), @intFromEnum(SystemPromptMode.replace));
    try std.testing.expectEqual(@as(u2, 2), @intFromEnum(SystemPromptMode.append));
}
