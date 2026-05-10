//! Claude Code SDK Message Types — NDJSON events emitted on stdout.
//!
//! Ported from codeberg/duhnist/claude-code-sdk-zig types.zig.
//! All strings in returned messages are arena-owned by OwnedMessage.

const std = @import("std");

pub const TextBlock = struct {
    text: []const u8,
};

pub const ThinkingBlock = struct {
    thinking: []const u8,
};

pub const ToolUseBlock = struct {
    id: []const u8,
    name: []const u8,
    input_json: []const u8,
};

pub const ContentBlock = union(enum) {
    text: TextBlock,
    thinking: ThinkingBlock,
    tool_use: ToolUseBlock,
};

pub const Usage = struct {
    input_tokens: u64 = 0,
    output_tokens: u64 = 0,
    cache_creation_input_tokens: u64 = 0,
    cache_read_input_tokens: u64 = 0,
};

pub const SystemMsg = struct {
    session_id: []const u8,
    model: ?[]const u8 = null,
    cwd: ?[]const u8 = null,
    tools: []const []const u8,
};

pub const AssistantMsg = struct {
    id: ?[]const u8 = null,
    session_id: ?[]const u8 = null,
    content: []const ContentBlock,
    stop_reason: ?[]const u8 = null,
    usage: Usage = .{},
};

pub const UserMsg = struct {
    session_id: ?[]const u8 = null,
    content_json: []const u8,
};

pub const ResultSubtype = enum { success, error_result };

pub const ResultMsg = struct {
    subtype: ResultSubtype,
    session_id: []const u8,
    result: ?[]const u8 = null,
    total_cost_usd: f64 = 0.0,
    duration_ms: u64 = 0,
    duration_api_ms: u64 = 0,
    num_turns: u32 = 0,
    is_error: bool = false,
};

pub const Message = union(enum) {
    system: SystemMsg,
    assistant: AssistantMsg,
    user: UserMsg,
    result: ResultMsg,
};

/// Message plus its own arena — all slices in `msg` are backed by the arena.
/// Call deinit() to free. Returned by Session.receive().
pub const OwnedMessage = struct {
    msg: Message,
    arena: std.heap.ArenaAllocator,

    pub fn deinit(self: *OwnedMessage) void {
        self.arena.deinit();
    }
};
