//! Session configuration for the Claude Code SDK.
//!
//! Ported from codeberg/duhnist/claude-code-sdk-zig options.zig.
//! MCP server config deferred — add back when cockpit needs it.

const std = @import("std");

pub const PermissionMode = enum {
    default,
    accept_edits,
    plan,
    bypass_permissions,

    pub fn toCli(self: PermissionMode) []const u8 {
        return switch (self) {
            .default => "default",
            .accept_edits => "acceptEdits",
            .plan => "plan",
            .bypass_permissions => "bypassPermissions",
        };
    }
};

pub const SessionOptions = struct {
    /// Working directory for the claude subprocess. Must be an absolute path.
    cwd: []const u8,

    /// Path to the claude binary. If null, we search PATH.
    cli_path: ?[]const u8 = null,

    /// Model identifier (e.g. "claude-opus-4-6"). If null, CLI picks default.
    model: ?[]const u8 = null,

    /// Override the default system prompt.
    system_prompt: ?[]const u8 = null,

    /// Tool names to whitelist. Empty = all tools allowed.
    allowed_tools: []const []const u8 = &.{},

    /// Tool names to explicitly disallow.
    disallowed_tools: []const []const u8 = &.{},

    /// Tool permission mode. Defaults to bypass_permissions for programmatic use.
    permission_mode: PermissionMode = .bypass_permissions,

    /// Maximum agentic turns per send.
    max_turns: ?u32 = null,

    /// Resume a prior session by session_id (from SystemMsg.session_id).
    resume_session: ?[]const u8 = null,

    /// Continue the most recent conversation in cwd.
    continue_conversation: bool = false,

    /// Pass --verbose. Required for stream-json when stdin is not a TTY.
    verbose: bool = true,

    /// Additional project directories to --add-dir.
    add_dirs: []const []const u8 = &.{},

    /// Forward subprocess stderr to the parent. Useful for auth failure diagnosis.
    inherit_stderr: bool = false,

    /// Override CLAUDE_CONFIG_DIR for the spawned subprocess. The CLI
    /// reads its credentials, sessions, and project state from this
    /// directory; setting it lets a single cart talk to multiple
    /// Claude installs (e.g. `~/.claude` vs `~/.claude-overflow`).
    /// When null, the subprocess inherits the parent's environment
    /// unchanged. The path is taken literally — no `~` expansion or
    /// `/.claude` suffix; pass an absolute path or a `~`-prefixed
    /// path the caller has already resolved.
    config_dir: ?[]const u8 = null,
};
