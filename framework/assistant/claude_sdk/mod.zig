//! Claude Code Agent SDK — subprocess wrapper around the `claude` CLI in
//! stream-json mode. Zig 0.15.2 port, inspired by
//! codeberg/duhnist/claude-code-sdk-zig.
//!
//! Model:
//!   * One long-lived subprocess per Session.
//!   * send() writes a user turn to stdin as NDJSON.
//!   * poll() drains any parsed events from stdout — non-blocking, called
//!     once per frame from the GUI loop.

const std = @import("std");

pub const options = @import("options.zig");
pub const types = @import("types.zig");
pub const Session = @import("session.zig").Session;

pub const PermissionMode = options.PermissionMode;
pub const SessionOptions = options.SessionOptions;

pub const Message = types.Message;
pub const OwnedMessage = types.OwnedMessage;
pub const ContentBlock = types.ContentBlock;
pub const TextBlock = types.TextBlock;
pub const ThinkingBlock = types.ThinkingBlock;
pub const ToolUseBlock = types.ToolUseBlock;
pub const Usage = types.Usage;
pub const SystemMsg = types.SystemMsg;
pub const AssistantMsg = types.AssistantMsg;
pub const UserMsg = types.UserMsg;
pub const ResultMsg = types.ResultMsg;
pub const ResultSubtype = types.ResultSubtype;

test {
    _ = @import("buffer.zig");
    _ = @import("types.zig");
    _ = @import("options.zig");
    _ = @import("parser.zig");
    _ = @import("argv.zig");
    _ = @import("session.zig");
}
