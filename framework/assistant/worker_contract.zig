//! Normalized worker/session/event contract for multi-backend agent panes.
//!
//! Design goals:
//!   - A `WorkerStore` is the enduring task identity shown in the UI.
//!   - Each backend attachment is a `SessionEpisode`.
//!   - Claude NDJSON and Codex app-server notifications both normalize into
//!     append-only `WorkerEvent` records.
//!   - Readback is backend-agnostic: transcript consumers read one worker,
//!     one session timeline, and one event stream.

const std = @import("std");
const claude_types = @import("claude_sdk/types.zig");
const codex_sdk = @import("codex_sdk.zig");
const kimi_wire_sdk = @import("kimi_wire_sdk.zig");
const local_ai_runtime = @import("local_ai_runtime.zig");
const openai_compat_sdk = @import("openai_compat_sdk.zig");

pub const Backend = enum {
    claude_code,
    codex_app_server,
    kimi_cli_wire,
    local_ai,
    openai_compat,
};

pub const WorkerStatus = enum {
    idle,
    active,
    streaming,
    switching,
    completed,
    error_,
};

pub const SessionStatus = enum {
    starting,
    active,
    ended,
    error_,
};

pub const EventKind = enum {
    lifecycle,
    context_switch,
    status,
    user_message,
    assistant_message,
    reasoning,
    tool_call,
    tool_output,
    usage,
    completion,
    error_,
    raw,
};

pub const MessageRole = enum {
    system,
    user,
    assistant,
    tool,
    internal,
};

pub const UsageTotals = struct {
    input_tokens: u64 = 0,
    output_tokens: u64 = 0,
    cache_creation_input_tokens: u64 = 0,
    cache_read_input_tokens: u64 = 0,

    pub fn add(self: *UsageTotals, other: UsageTotals) void {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_creation_input_tokens += other.cache_creation_input_tokens;
        self.cache_read_input_tokens += other.cache_read_input_tokens;
    }
};

pub const StoreConfig = struct {
    worker_id: []const u8,
    display_name: ?[]const u8 = null,
    objective: ?[]const u8 = null,
    assigned_role: ?[]const u8 = null,
};

pub const StartSessionOptions = struct {
    backend: Backend,
    model: ?[]const u8 = null,
    reason_started: ?[]const u8 = null,
    external_session_id: ?[]const u8 = null,
    thread_id: ?[]const u8 = null,
};

pub const WorkerSnapshot = struct {
    worker_id: []const u8,
    display_name: ?[]const u8,
    objective: ?[]const u8,
    assigned_role: ?[]const u8,
    status: WorkerStatus,
    current_backend: ?Backend,
    current_model: ?[]const u8,
    created_at_ms: i64,
    last_active_at_ms: i64,
    switch_count: u32,
    total_cost_usd: f64,
    usage: UsageTotals,
    active_session_id: ?[]const u8,
    session_count: usize,
    event_count: usize,
};

pub const TranscriptEntry = struct {
    event_id: u64,
    session_id: []const u8,
    backend: Backend,
    kind: EventKind,
    role: ?MessageRole,
    model: ?[]const u8,
    phase: ?[]const u8,
    text: ?[]const u8,
    turn_id: ?[]const u8,
    thread_id: ?[]const u8,
    created_at_ms: i64,
};

pub const SessionEpisode = struct {
    id: []const u8,
    worker_id: []const u8,
    backend: Backend,
    model: ?[]const u8 = null,
    external_session_id: ?[]const u8 = null,
    thread_id: ?[]const u8 = null,
    status: SessionStatus = .starting,
    reason_started: ?[]const u8 = null,
    reason_ended: ?[]const u8 = null,
    started_at_ms: i64,
    ended_at_ms: ?i64 = null,
    switch_index: u32 = 0,
    turn_count: u32 = 0,
    total_cost_usd: f64 = 0,
    usage: UsageTotals = .{},
    event_count: u32 = 0,

    pub fn deinit(self: *SessionEpisode, allocator: std.mem.Allocator) void {
        allocator.free(self.id);
        allocator.free(self.worker_id);
        if (self.model) |value| allocator.free(value);
        if (self.external_session_id) |value| allocator.free(value);
        if (self.thread_id) |value| allocator.free(value);
        if (self.reason_started) |value| allocator.free(value);
        if (self.reason_ended) |value| allocator.free(value);
    }
};

pub const WorkerEvent = struct {
    id: u64,
    worker_id: []const u8,
    session_id: []const u8,
    backend: Backend,
    kind: EventKind,
    role: ?MessageRole = null,
    model: ?[]const u8 = null,
    phase: ?[]const u8 = null,
    text: ?[]const u8 = null,
    payload_json: ?[]const u8 = null,
    turn_id: ?[]const u8 = null,
    thread_id: ?[]const u8 = null,
    external_session_id: ?[]const u8 = null,
    status_text: ?[]const u8 = null,
    cost_usd_delta: f64 = 0,
    usage_delta: UsageTotals = .{},
    created_at_ms: i64,

    pub fn deinit(self: *WorkerEvent, allocator: std.mem.Allocator) void {
        allocator.free(self.worker_id);
        allocator.free(self.session_id);
        if (self.model) |value| allocator.free(value);
        if (self.phase) |value| allocator.free(value);
        if (self.text) |value| allocator.free(value);
        if (self.payload_json) |value| allocator.free(value);
        if (self.turn_id) |value| allocator.free(value);
        if (self.thread_id) |value| allocator.free(value);
        if (self.external_session_id) |value| allocator.free(value);
        if (self.status_text) |value| allocator.free(value);
    }
};

pub const WorkerStore = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    worker_id: []const u8,
    display_name: ?[]const u8,
    objective: ?[]const u8,
    assigned_role: ?[]const u8,
    status: WorkerStatus = .idle,
    current_backend: ?Backend = null,
    current_model: ?[]const u8 = null,
    created_at_ms: i64,
    last_active_at_ms: i64,
    switch_count: u32 = 0,
    total_cost_usd: f64 = 0,
    usage: UsageTotals = .{},
    next_session_seq: u32 = 1,
    next_event_id: u64 = 1,
    active_session_index: ?usize = null,
    sessions: std.ArrayList(SessionEpisode) = .empty,
    events: std.ArrayList(WorkerEvent) = .empty,

    pub fn init(io: std.Io, allocator: std.mem.Allocator, config: StoreConfig) !WorkerStore {
        const now = realMillis(io);
        return .{
            .io = io,
            .allocator = allocator,
            .worker_id = try allocator.dupe(u8, config.worker_id),
            .display_name = if (config.display_name) |value| try allocator.dupe(u8, value) else null,
            .objective = if (config.objective) |value| try allocator.dupe(u8, value) else null,
            .assigned_role = if (config.assigned_role) |value| try allocator.dupe(u8, value) else null,
            .created_at_ms = now,
            .last_active_at_ms = now,
        };
    }

    pub fn deinit(self: *WorkerStore) void {
        self.allocator.free(self.worker_id);
        if (self.display_name) |value| self.allocator.free(value);
        if (self.objective) |value| self.allocator.free(value);
        if (self.assigned_role) |value| self.allocator.free(value);
        if (self.current_model) |value| self.allocator.free(value);

        for (self.sessions.items) |*session| session.deinit(self.allocator);
        self.sessions.deinit(self.allocator);

        for (self.events.items) |*event| event.deinit(self.allocator);
        self.events.deinit(self.allocator);
    }

    pub fn snapshot(self: *const WorkerStore) WorkerSnapshot {
        return .{
            .worker_id = self.worker_id,
            .display_name = self.display_name,
            .objective = self.objective,
            .assigned_role = self.assigned_role,
            .status = self.status,
            .current_backend = self.current_backend,
            .current_model = self.current_model,
            .created_at_ms = self.created_at_ms,
            .last_active_at_ms = self.last_active_at_ms,
            .switch_count = self.switch_count,
            .total_cost_usd = self.total_cost_usd,
            .usage = self.usage,
            .active_session_id = if (self.activeSession()) |session| session.id else null,
            .session_count = self.sessions.items.len,
            .event_count = self.events.items.len,
        };
    }

    pub fn activeSession(self: *const WorkerStore) ?*const SessionEpisode {
        if (self.active_session_index) |index| return &self.sessions.items[index];
        return null;
    }

    pub fn activeSessionMut(self: *WorkerStore) ?*SessionEpisode {
        if (self.active_session_index) |index| return &self.sessions.items[index];
        return null;
    }

    pub fn beginSession(self: *WorkerStore, opts: StartSessionOptions) !*SessionEpisode {
        if (self.activeSessionMut()) |existing| {
            existing.status = .ended;
            existing.ended_at_ms = realMillis(self.io);
            if (existing.reason_ended == null) {
                existing.reason_ended = try dupOpt(self.allocator, "superseded");
            }
            self.switch_count += 1;
        }

        const session_id = try std.fmt.allocPrint(self.allocator, "{s}:session:{d}", .{
            self.worker_id,
            self.next_session_seq,
        });
        self.next_session_seq += 1;

        try self.sessions.append(self.allocator, .{
            .id = session_id,
            .worker_id = try self.allocator.dupe(u8, self.worker_id),
            .backend = opts.backend,
            .model = try dupOpt(self.allocator, opts.model),
            .external_session_id = try dupOpt(self.allocator, opts.external_session_id),
            .thread_id = try dupOpt(self.allocator, opts.thread_id),
            .status = .active,
            .reason_started = try dupOpt(self.allocator, opts.reason_started),
            .started_at_ms = realMillis(self.io),
            .switch_index = self.switch_count,
        });

        self.active_session_index = self.sessions.items.len - 1;
        self.status = .active;
        self.current_backend = opts.backend;
        try self.setCurrentModel(opts.model);
        self.last_active_at_ms = realMillis(self.io);

        const session = &self.sessions.items[self.active_session_index.?];
        try self.appendEvent(.{
            .session_id = session.id,
            .backend = session.backend,
            .kind = .lifecycle,
            .role = .internal,
            .model = session.model,
            .text = "session started",
            .thread_id = session.thread_id,
            .external_session_id = session.external_session_id,
            .status_text = @tagName(session.status),
        });
        return session;
    }

    pub fn switchSession(self: *WorkerStore, opts: StartSessionOptions) !*SessionEpisode {
        const session = try self.beginSession(opts);
        try self.appendEvent(.{
            .session_id = session.id,
            .backend = session.backend,
            .kind = .context_switch,
            .role = .internal,
            .model = session.model,
            .text = opts.reason_started orelse "worker switched backend session",
            .thread_id = session.thread_id,
            .external_session_id = session.external_session_id,
            .status_text = "switch",
        });
        self.status = .switching;
        return session;
    }

    pub fn endActiveSession(self: *WorkerStore, status: SessionStatus, reason: ?[]const u8) !void {
        const session = self.activeSessionMut() orelse return;
        if (session.reason_ended) |value| self.allocator.free(value);
        session.reason_ended = try dupOpt(self.allocator, reason);
        session.status = status;
        session.ended_at_ms = realMillis(self.io);
        self.active_session_index = null;
        self.current_backend = null;
        if (self.current_model) |value| {
            self.allocator.free(value);
            self.current_model = null;
        }
        self.status = switch (status) {
            .ended => .completed,
            .error_ => .error_,
            else => .idle,
        };
        try self.appendEvent(.{
            .session_id = session.id,
            .backend = session.backend,
            .kind = if (status == .error_) .error_ else .completion,
            .role = .internal,
            .model = session.model,
            .text = reason orelse "session ended",
            .thread_id = session.thread_id,
            .external_session_id = session.external_session_id,
            .status_text = @tagName(status),
        });
    }

    pub fn recordUserMessage(self: *WorkerStore, text: []const u8, turn_id: ?[]const u8) !void {
        const session = try self.ensureActiveSession(.claude_code);
        try self.appendEvent(.{
            .session_id = session.id,
            .backend = session.backend,
            .kind = .user_message,
            .role = .user,
            .model = session.model,
            .text = text,
            .turn_id = turn_id,
            .thread_id = session.thread_id,
            .external_session_id = session.external_session_id,
        });
        self.status = .active;
    }

    pub fn bindClaudeMetadata(
        self: *WorkerStore,
        session_id: ?[]const u8,
        model: ?[]const u8,
    ) !void {
        const session = try self.ensureActiveSession(.claude_code);
        try self.updateSessionModel(session, model);
        if (session_id != null) try self.updateSessionExternalId(session, session_id);
    }

    pub fn bindCodexThread(
        self: *WorkerStore,
        thread_id: []const u8,
        model: ?[]const u8,
        reason_started: ?[]const u8,
    ) !void {
        var session = self.activeSessionMut();
        if (session == null or session.?.backend != .codex_app_server) {
            session = try self.beginSession(.{
                .backend = .codex_app_server,
                .model = model,
                .thread_id = thread_id,
                .reason_started = reason_started,
            });
        } else {
            try self.updateSessionModel(session.?, model);
            try self.updateSessionThreadId(session.?, thread_id);
        }
    }

    pub fn bindKimiSession(
        self: *WorkerStore,
        external_session_id: ?[]const u8,
        model: ?[]const u8,
        reason_started: ?[]const u8,
    ) !void {
        var session = self.activeSessionMut();
        if (session == null or session.?.backend != .kimi_cli_wire) {
            session = try self.beginSession(.{
                .backend = .kimi_cli_wire,
                .model = model,
                .external_session_id = external_session_id,
                .reason_started = reason_started,
            });
        } else {
            try self.updateSessionModel(session.?, model);
            if (external_session_id != null) try self.updateSessionExternalId(session.?, external_session_id);
        }
    }

    pub fn ingestClaudeMessage(self: *WorkerStore, message: claude_types.Message) !void {
        switch (message) {
            .system => |payload| {
                const session = try self.ensureActiveSession(.claude_code);
                try self.updateSessionModel(session, payload.model);
                try self.updateSessionExternalId(session, payload.session_id);

                const tools_json = try stringifyClaudeTools(self.allocator, payload.tools);
                defer self.allocator.free(tools_json);

                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .claude_code,
                    .kind = .lifecycle,
                    .role = .system,
                    .model = session.model,
                    .text = "claude session metadata",
                    .payload_json = tools_json,
                    .external_session_id = session.external_session_id,
                    .status_text = "system",
                });
            },
            .assistant => |payload| {
                const session = try self.ensureActiveSession(.claude_code);
                try self.updateSessionModel(session, null);
                if (payload.session_id) |sid| try self.updateSessionExternalId(session, sid);
                const usage_delta = usageFromClaude(payload.usage);
                session.usage.add(usage_delta);
                self.usage.add(usage_delta);
                self.status = .streaming;

                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .claude_code,
                    .kind = .usage,
                    .role = .internal,
                    .model = session.model,
                    .external_session_id = session.external_session_id,
                    .usage_delta = usage_delta,
                    .status_text = "assistant_usage",
                });

                for (payload.content) |block| {
                    switch (block) {
                        .text => |text_block| try self.appendEvent(.{
                            .session_id = session.id,
                            .backend = .claude_code,
                            .kind = .assistant_message,
                            .role = .assistant,
                            .model = session.model,
                            .phase = "final",
                            .text = text_block.text,
                            .external_session_id = session.external_session_id,
                        }),
                        .thinking => |thinking_block| try self.appendEvent(.{
                            .session_id = session.id,
                            .backend = .claude_code,
                            .kind = .reasoning,
                            .role = .assistant,
                            .model = session.model,
                            .phase = "thinking",
                            .text = thinking_block.thinking,
                            .external_session_id = session.external_session_id,
                        }),
                        .tool_use => |tool_block| {
                            const tool_payload = try std.fmt.allocPrint(self.allocator, "{{\"id\":\"{s}\",\"name\":\"{s}\",\"input_json\":{s}}}", .{ tool_block.id, tool_block.name, tool_block.input_json });
                            defer self.allocator.free(tool_payload);

                            try self.appendEvent(.{
                                .session_id = session.id,
                                .backend = .claude_code,
                                .kind = .tool_call,
                                .role = .tool,
                                .model = session.model,
                                .phase = "tool_use",
                                .text = tool_block.name,
                                .payload_json = tool_payload,
                                .external_session_id = session.external_session_id,
                            });
                        },
                    }
                }
            },
            .user => |payload| {
                const session = try self.ensureActiveSession(.claude_code);
                if (payload.session_id) |sid| try self.updateSessionExternalId(session, sid);
                const maybe_text = try extractClaudeUserText(self.allocator, payload.content_json);
                defer if (maybe_text) |value| self.allocator.free(value);

                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .claude_code,
                    .kind = .user_message,
                    .role = .user,
                    .model = session.model,
                    .text = maybe_text orelse payload.content_json,
                    .payload_json = payload.content_json,
                    .external_session_id = session.external_session_id,
                });
            },
            .result => |payload| {
                const session = try self.ensureActiveSession(.claude_code);
                try self.updateSessionExternalId(session, payload.session_id);
                if (payload.num_turns > session.turn_count) session.turn_count = payload.num_turns;
                session.total_cost_usd = payload.total_cost_usd;
                self.total_cost_usd = @max(self.total_cost_usd, payload.total_cost_usd);
                self.status = if (payload.is_error) .error_ else .active;

                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .claude_code,
                    .kind = if (payload.is_error) .error_ else .completion,
                    .role = .internal,
                    .model = session.model,
                    .phase = @tagName(payload.subtype),
                    .text = payload.result,
                    .external_session_id = session.external_session_id,
                    .status_text = if (payload.is_error) "error" else "success",
                    .cost_usd_delta = payload.total_cost_usd,
                });
            },
        }
    }

    pub fn ingestCodexNotification(self: *WorkerStore, notification: *const codex_sdk.Notification) !void {
        const session = try self.ensureActiveSession(.codex_app_server);
        const payload_json = try std.json.Stringify.valueAlloc(self.allocator, notification.params, .{});
        defer self.allocator.free(payload_json);

        if (notification.turnId()) |turn_id| {
            _ = turn_id;
        }

        if (std.mem.eql(u8, notification.method, "turn/started")) {
            self.status = .streaming;
            session.turn_count += 1;
            try self.appendEvent(.{
                .session_id = session.id,
                .backend = .codex_app_server,
                .kind = .lifecycle,
                .role = .internal,
                .model = session.model,
                .phase = "turn_started",
                .payload_json = payload_json,
                .turn_id = notification.turnId(),
                .thread_id = session.thread_id,
                .status_text = "turn_started",
            });
            return;
        }

        if (std.mem.eql(u8, notification.method, "item/agentMessage/delta")) {
            self.status = .streaming;
            try self.appendEvent(.{
                .session_id = session.id,
                .backend = .codex_app_server,
                .kind = .assistant_message,
                .role = .assistant,
                .model = session.model,
                .phase = "delta",
                .text = notification.deltaText(),
                .payload_json = payload_json,
                .turn_id = notification.turnId(),
                .thread_id = session.thread_id,
            });
            return;
        }

        if (std.mem.eql(u8, notification.method, "reasoning/textDelta") or
            std.mem.eql(u8, notification.method, "reasoning/summaryTextDelta"))
        {
            try self.appendEvent(.{
                .session_id = session.id,
                .backend = .codex_app_server,
                .kind = .reasoning,
                .role = .assistant,
                .model = session.model,
                .phase = "reasoning",
                .text = getStringPath(notification.params, &.{"delta"}),
                .payload_json = payload_json,
                .turn_id = notification.turnId(),
                .thread_id = session.thread_id,
            });
            return;
        }

        if (std.mem.eql(u8, notification.method, "item/completed")) {
            const item_value = notification.itemValue() orelse {
                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .codex_app_server,
                    .kind = .raw,
                    .role = .internal,
                    .model = session.model,
                    .payload_json = payload_json,
                    .turn_id = notification.turnId(),
                    .thread_id = session.thread_id,
                    .status_text = notification.method,
                });
                return;
            };

            var normalized = try normalizeCodexItem(self.allocator, item_value);
            defer normalized.deinit(self.allocator);

            try self.appendEvent(.{
                .session_id = session.id,
                .backend = .codex_app_server,
                .kind = normalized.kind,
                .role = normalized.role,
                .model = session.model,
                .phase = normalized.phase,
                .text = normalized.text,
                .payload_json = payload_json,
                .turn_id = notification.turnId(),
                .thread_id = session.thread_id,
                .status_text = normalized.status_text,
            });
            return;
        }

        if (std.mem.eql(u8, notification.method, "thread/tokenUsageUpdated")) {
            const usage = extractCodexUsage(notification.params);
            session.usage.add(usage);
            self.usage.add(usage);
            try self.appendEvent(.{
                .session_id = session.id,
                .backend = .codex_app_server,
                .kind = .usage,
                .role = .internal,
                .model = session.model,
                .payload_json = payload_json,
                .turn_id = notification.turnId(),
                .thread_id = session.thread_id,
                .usage_delta = usage,
                .status_text = "token_usage",
            });
            return;
        }

        if (std.mem.eql(u8, notification.method, "turn/completed")) {
            const completed_status = notification.completedStatus();
            const completed_error = notification.completedErrorMessage();
            self.status = if (completed_error != null) .error_ else .active;
            try self.appendEvent(.{
                .session_id = session.id,
                .backend = .codex_app_server,
                .kind = if (completed_error != null) .error_ else .completion,
                .role = .internal,
                .model = session.model,
                .phase = "turn_completed",
                .text = completed_error,
                .payload_json = payload_json,
                .turn_id = notification.turnId(),
                .thread_id = session.thread_id,
                .status_text = completed_status,
            });
            return;
        }

        if (std.mem.eql(u8, notification.method, "item/commandExecution/outputDelta") or
            std.mem.eql(u8, notification.method, "item/fileChange/outputDelta") or
            std.mem.eql(u8, notification.method, "mcpToolCall/progress"))
        {
            try self.appendEvent(.{
                .session_id = session.id,
                .backend = .codex_app_server,
                .kind = .tool_output,
                .role = .tool,
                .model = session.model,
                .payload_json = payload_json,
                .turn_id = notification.turnId(),
                .thread_id = session.thread_id,
                .status_text = notification.method,
            });
            return;
        }

        try self.appendEvent(.{
            .session_id = session.id,
            .backend = .codex_app_server,
            .kind = .raw,
            .role = .internal,
            .model = session.model,
            .payload_json = payload_json,
            .turn_id = notification.turnId(),
            .thread_id = session.thread_id,
            .status_text = notification.method,
        });
    }

    pub fn ingestKimiWireMessage(self: *WorkerStore, message: *const kimi_wire_sdk.InboundMessage) !void {
        const session = try self.ensureActiveSession(.kimi_cli_wire);

        switch (message.*) {
            .event => |event| {
                const payload_json = try std.json.Stringify.valueAlloc(self.allocator, event.payload, .{});
                defer self.allocator.free(payload_json);

                if (std.mem.eql(u8, event.event_type, "TurnBegin") or std.mem.eql(u8, event.event_type, "SteerInput")) {
                    if (std.mem.eql(u8, event.event_type, "TurnBegin")) session.turn_count += 1;
                    self.status = .active;
                    const maybe_text = try extractKimiContentText(self.allocator, getPath(event.payload, &.{"user_input"}));
                    defer if (maybe_text) |value| self.allocator.free(value);
                    return self.appendKimiEvent(session, .user_message, .user, if (std.mem.eql(u8, event.event_type, "TurnBegin")) "turn_begin" else "steer", maybe_text, payload_json, event.event_type, .{});
                }
                if (std.mem.eql(u8, event.event_type, "TurnEnd")) {
                    self.status = .active;
                    return self.appendKimiEvent(session, .completion, .internal, "turn_end", null, payload_json, event.event_type, .{});
                }
                if (std.mem.eql(u8, event.event_type, "StatusUpdate")) {
                    const raw_usage = event.statusUsage();
                    const usage: UsageTotals = .{
                        .input_tokens = raw_usage.input_tokens,
                        .output_tokens = raw_usage.output_tokens,
                        .cache_creation_input_tokens = raw_usage.cache_creation_input_tokens,
                        .cache_read_input_tokens = raw_usage.cache_read_input_tokens,
                    };
                    if (usage.input_tokens != 0 or usage.output_tokens != 0 or usage.cache_creation_input_tokens != 0 or usage.cache_read_input_tokens != 0) {
                        session.usage.add(usage);
                        self.usage.add(usage);
                        return self.appendKimiEvent(session, .usage, .internal, "status_update", null, payload_json, event.event_type, usage);
                    }
                    return self.appendKimiEvent(session, .status, .internal, "status_update", null, payload_json, event.event_type, .{});
                }
                if (std.mem.eql(u8, event.event_type, "ContentPart")) {
                    const part_type = getStringPath(event.payload, &.{"type"}) orelse "unknown";
                    if (std.mem.eql(u8, part_type, "text")) {
                        self.status = .streaming;
                        return self.appendKimiEvent(session, .assistant_message, .assistant, "text", getStringPath(event.payload, &.{"text"}), payload_json, event.event_type, .{});
                    }
                    if (std.mem.eql(u8, part_type, "think")) {
                        self.status = .streaming;
                        return self.appendKimiEvent(session, .reasoning, .assistant, "think", getStringPath(event.payload, &.{"think"}), payload_json, event.event_type, .{});
                    }
                }
                if (std.mem.eql(u8, event.event_type, "ToolCall")) {
                    return self.appendKimiEvent(session, .tool_call, .tool, "tool_call", getStringPath(event.payload, &.{ "function", "name" }), payload_json, event.event_type, .{});
                }
                if (std.mem.eql(u8, event.event_type, "ToolCallPart")) {
                    return self.appendKimiEvent(session, .tool_call, .tool, "tool_call_delta", getStringPath(event.payload, &.{"arguments_part"}), payload_json, event.event_type, .{});
                }
                if (std.mem.eql(u8, event.event_type, "ToolResult")) {
                    const maybe_text = try extractKimiToolResultText(self.allocator, event.payload);
                    defer if (maybe_text) |value| self.allocator.free(value);
                    return self.appendKimiEvent(session, .tool_output, .tool, "tool_result", maybe_text, payload_json, if (boolFromPath(event.payload, &.{ "return_value", "is_error" }) orelse false) "error" else event.event_type, .{});
                }
                if (std.mem.eql(u8, event.event_type, "PlanDisplay")) {
                    return self.appendKimiEvent(session, .assistant_message, .assistant, "plan", getStringPath(event.payload, &.{"content"}), payload_json, event.event_type, .{});
                }
                if (std.mem.eql(u8, event.event_type, "BtwBegin")) {
                    return self.appendKimiEvent(session, .status, .internal, "btw_begin", getStringPath(event.payload, &.{"question"}), payload_json, event.event_type, .{});
                }
                if (std.mem.eql(u8, event.event_type, "BtwEnd")) {
                    const response_text = getStringPath(event.payload, &.{"response"});
                    const error_text = getStringPath(event.payload, &.{"error"});
                    return self.appendKimiEvent(session, if (error_text != null) .error_ else if (response_text != null) .assistant_message else .status, if (response_text != null) .assistant else .internal, "btw_end", if (error_text != null) error_text else response_text, payload_json, event.event_type, .{});
                }
                if (std.mem.eql(u8, event.event_type, "StepBegin") or std.mem.eql(u8, event.event_type, "StepInterrupted") or std.mem.eql(u8, event.event_type, "CompactionBegin") or std.mem.eql(u8, event.event_type, "CompactionEnd") or std.mem.eql(u8, event.event_type, "ApprovalResponse") or std.mem.eql(u8, event.event_type, "HookTriggered") or std.mem.eql(u8, event.event_type, "HookResolved")) {
                    return self.appendKimiEvent(session, .status, .internal, event.event_type, null, payload_json, event.event_type, .{});
                }
                return self.appendKimiEvent(session, .raw, .internal, null, null, payload_json, event.event_type, .{});
            },
            .request => |request| {
                const payload_json = try std.json.Stringify.valueAlloc(self.allocator, request.payload, .{});
                defer self.allocator.free(payload_json);

                if (std.mem.eql(u8, request.request_type, "ToolCallRequest")) {
                    return self.appendKimiEvent(session, .tool_call, .tool, "tool_request", getStringPath(request.payload, &.{"name"}), payload_json, request.request_type, .{});
                }
                if (std.mem.eql(u8, request.request_type, "ApprovalRequest")) {
                    return self.appendKimiEvent(session, .status, .internal, "approval_request", getStringPath(request.payload, &.{"description"}) orelse getStringPath(request.payload, &.{"action"}), payload_json, getStringPath(request.payload, &.{"sender"}) orelse request.request_type, .{});
                }
                if (std.mem.eql(u8, request.request_type, "QuestionRequest")) {
                    const maybe_text = try extractKimiQuestionText(self.allocator, request.payload);
                    defer if (maybe_text) |value| self.allocator.free(value);
                    return self.appendKimiEvent(session, .status, .internal, "question_request", maybe_text, payload_json, request.request_type, .{});
                }
                if (std.mem.eql(u8, request.request_type, "HookRequest")) {
                    return self.appendKimiEvent(session, .status, .internal, "hook_request", getStringPath(request.payload, &.{"target"}), payload_json, getStringPath(request.payload, &.{"event"}) orelse request.request_type, .{});
                }
                return self.appendKimiEvent(session, .raw, .internal, null, null, payload_json, request.request_type, .{});
            },
            .response => |response| {
                const result_json = try response.resultJsonAlloc(self.allocator);
                defer if (result_json) |value| self.allocator.free(value);
                if (response.isError()) {
                    self.status = .error_;
                    return self.appendKimiEvent(session, .error_, .internal, "rpc_response", response.error_message, result_json, response.id, .{});
                }
                return self.appendKimiEvent(session, kindForKimiResponseStatus(response.status()), .internal, "rpc_response", response.status(), result_json, response.id, .{});
            },
        }
    }

    pub fn ingestLocalAiEvent(self: *WorkerStore, event: *const local_ai_runtime.OwnedEvent) !void {
        const session = try self.ensureActiveSession(.local_ai);
        switch (event.kind) {
            .system => {
                if (event.model) |value| try self.updateSessionModel(session, value);
                if (event.session_id) |value| try self.updateSessionExternalId(session, value);
                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .local_ai,
                    .kind = .lifecycle,
                    .role = .system,
                    .model = session.model,
                    .text = "local model loaded",
                    .external_session_id = session.external_session_id,
                    .status_text = "system",
                });
            },
            .assistant_part => {
                self.status = .streaming;
                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .local_ai,
                    .kind = .assistant_message,
                    .role = .assistant,
                    .model = session.model,
                    .phase = event.part_type orelse "text",
                    .text = event.text,
                    .external_session_id = session.external_session_id,
                });
            },
            .status => {
                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .local_ai,
                    .kind = .status,
                    .role = .internal,
                    .model = session.model,
                    .text = event.text,
                    .external_session_id = session.external_session_id,
                    .status_text = if (event.is_error) "error" else "status",
                });
            },
            .result => {
                self.status = if (event.is_error) .error_ else .active;
                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .local_ai,
                    .kind = if (event.is_error) .error_ else .completion,
                    .role = .internal,
                    .model = session.model,
                    .text = event.text,
                    .external_session_id = session.external_session_id,
                    .status_text = if (event.is_error) "error" else "success",
                });
            },
            .tool_call => {
                const id = event.tool_call_id orelse "";
                const name = event.tool_call_name orelse "";
                const args = event.tool_call_args orelse "{}";
                const payload = try std.fmt.allocPrint(self.allocator, "{{\"id\":\"{s}\",\"name\":\"{s}\",\"input_json\":{s}}}", .{ id, name, args });
                defer self.allocator.free(payload);
                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .local_ai,
                    .kind = .tool_call,
                    .role = .tool,
                    .model = session.model,
                    .phase = "tool_use",
                    .text = name,
                    .payload_json = payload,
                    .external_session_id = session.external_session_id,
                });
            },
        }
    }

    pub fn ingestOpenAiEvent(self: *WorkerStore, event: *const openai_compat_sdk.Event) !void {
        const session = try self.ensureActiveSession(.openai_compat);
        switch (event.kind) {
            .delta => {
                self.status = .streaming;
                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .openai_compat,
                    .kind = .assistant_message,
                    .role = .assistant,
                    .model = session.model,
                    .phase = "delta",
                    .text = event.text,
                    .external_session_id = session.external_session_id,
                });
            },
            .tool_call => {
                const id = event.tool_call_id orelse "";
                const name = event.tool_call_name orelse "";
                const args = event.tool_call_args orelse "{}";
                const payload = try std.fmt.allocPrint(self.allocator, "{{\"id\":\"{s}\",\"name\":\"{s}\",\"input_json\":{s}}}", .{ id, name, args });
                defer self.allocator.free(payload);
                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .openai_compat,
                    .kind = .tool_call,
                    .role = .tool,
                    .model = session.model,
                    .phase = "tool_use",
                    .text = name,
                    .payload_json = payload,
                    .external_session_id = session.external_session_id,
                });
            },
            .completion => {
                self.status = .active;
                // The SDK captured the backend's session id off the
                // response (claudewrap bridge → claude's sid). Surface it
                // so a chat thread can persist + resume it.
                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .openai_compat,
                    .kind = .completion,
                    .role = .internal,
                    .model = session.model,
                    .text = event.text,
                    .external_session_id = event.external_session_id orelse session.external_session_id,
                    .status_text = "success",
                });
            },
            .error_ => {
                self.status = .error_;
                try self.appendEvent(.{
                    .session_id = session.id,
                    .backend = .openai_compat,
                    .kind = .error_,
                    .role = .internal,
                    .model = session.model,
                    .text = event.text,
                    .external_session_id = session.external_session_id,
                    .status_text = "error",
                });
            },
        }
    }

    pub fn recentTranscript(self: *const WorkerStore, allocator: std.mem.Allocator, limit: usize) ![]TranscriptEntry {
        const event_count = self.events.items.len;
        const start = if (event_count > limit) event_count - limit else 0;
        var out: std.ArrayList(TranscriptEntry) = .empty;
        defer out.deinit(allocator);

        for (self.events.items[start..]) |event| {
            try out.append(allocator, .{
                .event_id = event.id,
                .session_id = try allocator.dupe(u8, event.session_id),
                .backend = event.backend,
                .kind = event.kind,
                .role = event.role,
                .model = try dupOpt(allocator, event.model),
                .phase = try dupOpt(allocator, event.phase),
                .text = try dupOpt(allocator, event.text),
                .turn_id = try dupOpt(allocator, event.turn_id),
                .thread_id = try dupOpt(allocator, event.thread_id),
                .created_at_ms = event.created_at_ms,
            });
        }

        return out.toOwnedSlice(allocator);
    }

    fn ensureActiveSession(self: *WorkerStore, backend: Backend) !*SessionEpisode {
        if (self.activeSessionMut()) |session| {
            if (session.backend == backend) return session;
        }
        return self.beginSession(.{
            .backend = backend,
            .reason_started = "auto-attached",
        });
    }

    fn appendKimiEvent(
        self: *WorkerStore,
        session: *const SessionEpisode,
        kind: EventKind,
        role: ?MessageRole,
        phase: ?[]const u8,
        text: ?[]const u8,
        payload_json: ?[]const u8,
        status_text: ?[]const u8,
        usage_delta: UsageTotals,
    ) !void {
        try self.appendEvent(.{
            .session_id = session.id,
            .backend = .kimi_cli_wire,
            .kind = kind,
            .role = role,
            .model = session.model,
            .phase = phase,
            .text = text,
            .payload_json = payload_json,
            .external_session_id = session.external_session_id,
            .status_text = status_text,
            .usage_delta = usage_delta,
        });
    }

    fn appendEvent(self: *WorkerStore, spec: EventSpec) !void {
        const now = realMillis(self.io);
        try self.events.append(self.allocator, .{
            .id = self.next_event_id,
            .worker_id = try self.allocator.dupe(u8, self.worker_id),
            .session_id = try self.allocator.dupe(u8, spec.session_id),
            .backend = spec.backend,
            .kind = spec.kind,
            .role = spec.role,
            .model = try dupOpt(self.allocator, spec.model),
            .phase = try dupOpt(self.allocator, spec.phase),
            .text = try dupOpt(self.allocator, spec.text),
            .payload_json = try dupOpt(self.allocator, spec.payload_json),
            .turn_id = try dupOpt(self.allocator, spec.turn_id),
            .thread_id = try dupOpt(self.allocator, spec.thread_id),
            .external_session_id = try dupOpt(self.allocator, spec.external_session_id),
            .status_text = try dupOpt(self.allocator, spec.status_text),
            .cost_usd_delta = spec.cost_usd_delta,
            .usage_delta = spec.usage_delta,
            .created_at_ms = now,
        });
        self.next_event_id += 1;
        self.last_active_at_ms = now;

        if (self.activeSessionMut()) |session| {
            if (std.mem.eql(u8, session.id, spec.session_id)) {
                session.event_count += 1;
            }
        }
    }

    fn setCurrentModel(self: *WorkerStore, model: ?[]const u8) !void {
        if (self.current_model) |value| {
            self.allocator.free(value);
            self.current_model = null;
        }
        self.current_model = try dupOpt(self.allocator, model);
    }

    fn updateSessionModel(self: *WorkerStore, session: *SessionEpisode, model: ?[]const u8) !void {
        if (model == null) return;
        if (session.model) |existing| {
            self.allocator.free(existing);
            session.model = null;
        }
        session.model = try dupOpt(self.allocator, model);
        try self.setCurrentModel(model);
    }

    fn updateSessionExternalId(self: *WorkerStore, session: *SessionEpisode, external_session_id: ?[]const u8) !void {
        if (external_session_id == null) return;
        if (session.external_session_id) |existing| {
            if (std.mem.eql(u8, existing, external_session_id.?)) return;
            self.allocator.free(existing);
        }
        session.external_session_id = try dupOpt(self.allocator, external_session_id);
    }

    fn updateSessionThreadId(self: *WorkerStore, session: *SessionEpisode, thread_id: ?[]const u8) !void {
        if (thread_id == null) return;
        if (session.thread_id) |existing| {
            if (std.mem.eql(u8, existing, thread_id.?)) return;
            self.allocator.free(existing);
        }
        session.thread_id = try dupOpt(self.allocator, thread_id);
    }
};

const EventSpec = struct {
    session_id: []const u8,
    backend: Backend,
    kind: EventKind,
    role: ?MessageRole = null,
    model: ?[]const u8 = null,
    phase: ?[]const u8 = null,
    text: ?[]const u8 = null,
    payload_json: ?[]const u8 = null,
    turn_id: ?[]const u8 = null,
    thread_id: ?[]const u8 = null,
    external_session_id: ?[]const u8 = null,
    status_text: ?[]const u8 = null,
    cost_usd_delta: f64 = 0,
    usage_delta: UsageTotals = .{},
};

const NormalizedCodexItem = struct {
    kind: EventKind,
    role: ?MessageRole = null,
    phase: ?[]const u8 = null,
    text: ?[]const u8 = null,
    status_text: ?[]const u8 = null,

    fn deinit(self: *NormalizedCodexItem, allocator: std.mem.Allocator) void {
        if (self.phase) |value| allocator.free(value);
        if (self.text) |value| allocator.free(value);
        if (self.status_text) |value| allocator.free(value);
    }
};

fn normalizeCodexItem(allocator: std.mem.Allocator, item: std.json.Value) !NormalizedCodexItem {
    const item_type = getStringPath(item, &.{"type"}) orelse return .{
        .kind = .raw,
    };

    if (std.mem.eql(u8, item_type, "agentMessage")) {
        const phase = getStringPath(item, &.{"phase"});
        const text = getStringPath(item, &.{"text"});
        return .{
            .kind = if (phase != null and std.mem.indexOf(u8, phase.?, "reason") != null) .reasoning else .assistant_message,
            .role = .assistant,
            .phase = try dupOpt(allocator, phase),
            .text = try dupOpt(allocator, text),
            .status_text = try dupOpt(allocator, item_type),
        };
    }

    if (std.mem.eql(u8, item_type, "message")) {
        const role_text = getStringPath(item, &.{"role"}) orelse "assistant";
        const content = getPath(item, &.{"content"});
        const joined = try joinCodexMessageText(allocator, content);
        return .{
            .kind = switchRoleToKind(role_text),
            .role = parseRole(role_text),
            .phase = null,
            .text = joined,
            .status_text = try allocator.dupe(u8, item_type),
        };
    }

    if (std.mem.eql(u8, item_type, "commandExecution") or
        std.mem.eql(u8, item_type, "fileChange") or
        std.mem.eql(u8, item_type, "mcpToolCall"))
    {
        return .{
            .kind = .tool_output,
            .role = .tool,
            .status_text = try allocator.dupe(u8, item_type),
        };
    }

    return .{
        .kind = .raw,
        .status_text = try allocator.dupe(u8, item_type),
    };
}

fn joinCodexMessageText(allocator: std.mem.Allocator, maybe_content: ?std.json.Value) !?[]const u8 {
    const content = maybe_content orelse return null;
    const array = asArray(content) orelse return null;

    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(allocator);

    for (array.items) |entry| {
        const obj = asObject(entry) orelse continue;
        const block_type = getObjectString(obj, "type") orelse continue;
        if (std.mem.eql(u8, block_type, "output_text") or
            std.mem.eql(u8, block_type, "input_text") or
            std.mem.eql(u8, block_type, "text"))
        {
            const text = getObjectString(obj, "text") orelse continue;
            try buf.appendSlice(allocator, text);
        }
    }

    if (buf.items.len == 0) return null;
    return try buf.toOwnedSlice(allocator);
}

fn extractCodexUsage(params: std.json.Value) UsageTotals {
    const usage_value = getPath(params, &.{"tokenUsage"}) orelse return .{};
    return .{
        .input_tokens = intFromPath(usage_value, &.{"inputTokens"}) orelse 0,
        .output_tokens = intFromPath(usage_value, &.{"outputTokens"}) orelse 0,
        .cache_creation_input_tokens = intFromPath(usage_value, &.{"cacheCreationInputTokens"}) orelse 0,
        .cache_read_input_tokens = intFromPath(usage_value, &.{"cacheReadInputTokens"}) orelse 0,
    };
}

fn usageFromClaude(usage: claude_types.Usage) UsageTotals {
    return .{
        .input_tokens = usage.input_tokens,
        .output_tokens = usage.output_tokens,
        .cache_creation_input_tokens = usage.cache_creation_input_tokens,
        .cache_read_input_tokens = usage.cache_read_input_tokens,
    };
}

fn stringifyClaudeTools(allocator: std.mem.Allocator, tools: []const []const u8) ![]u8 {
    var buf: std.ArrayList(u8) = .empty;
    errdefer buf.deinit(allocator);

    try buf.append(allocator, '[');
    for (tools, 0..) |tool_name, index| {
        if (index > 0) try buf.append(allocator, ',');
        try appendJsonString(allocator, &buf, tool_name);
    }
    try buf.append(allocator, ']');
    return try buf.toOwnedSlice(allocator);
}

fn extractClaudeUserText(allocator: std.mem.Allocator, content_json: []const u8) !?[]u8 {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();

    const parsed = std.json.parseFromSlice(std.json.Value, arena.allocator(), content_json, .{}) catch {
        return null;
    };

    const message_obj = asObject(parsed.value) orelse return null;
    const content_value = message_obj.get("content") orelse return null;
    if (asString(content_value)) |text| return try allocator.dupe(u8, text);

    const content_array = asArray(content_value) orelse return null;
    for (content_array.items) |entry| {
        const obj = asObject(entry) orelse continue;
        if (getObjectString(obj, "text")) |text| return try allocator.dupe(u8, text);
    }
    return null;
}

fn extractKimiContentText(allocator: std.mem.Allocator, maybe_value: ?std.json.Value) !?[]const u8 {
    const value = maybe_value orelse return null;
    if (asString(value)) |text| return try allocator.dupe(u8, text);

    const array = asArray(value) orelse return null;
    var buf: std.ArrayList(u8) = .empty;
    defer buf.deinit(allocator);

    for (array.items) |entry| {
        const obj = asObject(entry) orelse continue;
        const part_type = getObjectString(obj, "type") orelse continue;
        const text = if (std.mem.eql(u8, part_type, "text"))
            getObjectString(obj, "text")
        else if (std.mem.eql(u8, part_type, "think"))
            getObjectString(obj, "think")
        else
            null;
        if (text) |slice| try buf.appendSlice(allocator, slice);
    }

    if (buf.items.len == 0) return null;
    return try buf.toOwnedSlice(allocator);
}

fn extractKimiToolResultText(allocator: std.mem.Allocator, payload: std.json.Value) !?[]const u8 {
    if (getStringPath(payload, &.{ "return_value", "message" })) |message| {
        return try allocator.dupe(u8, message);
    }
    return extractKimiContentText(allocator, getPath(payload, &.{ "return_value", "output" }));
}

fn extractKimiQuestionText(allocator: std.mem.Allocator, payload: std.json.Value) !?[]const u8 {
    const questions_value = getPath(payload, &.{"questions"}) orelse return null;
    const questions = asArray(questions_value) orelse return null;
    if (questions.items.len == 0) return null;
    const first = asObject(questions.items[0]) orelse return null;
    const question = first.get("question") orelse return null;
    if (asString(question)) |text| return try allocator.dupe(u8, text);
    return null;
}

fn kindForKimiResponseStatus(status: ?[]const u8) EventKind {
    if (status) |value| {
        if (std.mem.eql(u8, value, "finished") or
            std.mem.eql(u8, value, "cancelled") or
            std.mem.eql(u8, value, "max_steps_reached"))
        {
            return .completion;
        }
        return .status;
    }
    return .raw;
}

fn switchRoleToKind(role_text: []const u8) EventKind {
    if (std.mem.eql(u8, role_text, "user")) return .user_message;
    if (std.mem.eql(u8, role_text, "assistant")) return .assistant_message;
    if (std.mem.eql(u8, role_text, "system")) return .lifecycle;
    if (std.mem.eql(u8, role_text, "tool")) return .tool_output;
    return .raw;
}

fn parseRole(role_text: []const u8) ?MessageRole {
    if (std.mem.eql(u8, role_text, "user")) return .user;
    if (std.mem.eql(u8, role_text, "assistant")) return .assistant;
    if (std.mem.eql(u8, role_text, "system")) return .system;
    if (std.mem.eql(u8, role_text, "tool")) return .tool;
    return null;
}

fn dupOpt(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    if (value) |unwrapped| return try allocator.dupe(u8, unwrapped);
    return null;
}

fn realMillis(io: std.Io) i64 {
    return std.Io.Clock.now(.real, io).toMilliseconds();
}

fn getPath(root: std.json.Value, path: []const []const u8) ?std.json.Value {
    var current = root;
    for (path) |segment| {
        const obj = asObject(current) orelse return null;
        current = obj.get(segment) orelse return null;
    }
    return current;
}

fn getStringPath(root: std.json.Value, path: []const []const u8) ?[]const u8 {
    const value = getPath(root, path) orelse return null;
    return asString(value);
}

fn intFromPath(root: std.json.Value, path: []const []const u8) ?u64 {
    const value = getPath(root, path) orelse return null;
    return switch (value) {
        .integer => |number| @intCast(@max(number, 0)),
        else => null,
    };
}

fn boolFromPath(root: std.json.Value, path: []const []const u8) ?bool {
    const value = getPath(root, path) orelse return null;
    return switch (value) {
        .bool => |flag| flag,
        else => null,
    };
}

fn getObjectString(obj: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    const value = obj.get(key) orelse return null;
    return asString(value);
}

fn asObject(value: std.json.Value) ?std.json.ObjectMap {
    return switch (value) {
        .object => |object| object,
        else => null,
    };
}

fn asArray(value: std.json.Value) ?std.json.Array {
    return switch (value) {
        .array => |array| array,
        else => null,
    };
}

fn asString(value: std.json.Value) ?[]const u8 {
    return switch (value) {
        .string => |text| text,
        else => null,
    };
}

fn appendJsonString(
    allocator: std.mem.Allocator,
    buf: *std.ArrayList(u8),
    value: []const u8,
) !void {
    try buf.append(allocator, '"');
    for (value) |char| {
        switch (char) {
            '"' => try buf.appendSlice(allocator, "\\\""),
            '\\' => try buf.appendSlice(allocator, "\\\\"),
            '\n' => try buf.appendSlice(allocator, "\\n"),
            '\r' => try buf.appendSlice(allocator, "\\r"),
            '\t' => try buf.appendSlice(allocator, "\\t"),
            0x00...0x08, 0x0b...0x0c, 0x0e...0x1f => {
                var encoded: [6]u8 = undefined;
                const slice = try std.fmt.bufPrint(&encoded, "\\u{x:0>4}", .{char});
                try buf.appendSlice(allocator, slice);
            },
            else => try buf.append(allocator, char),
        }
    }
    try buf.append(allocator, '"');
}

fn freeTranscriptEntries(allocator: std.mem.Allocator, entries: []TranscriptEntry) void {
    for (entries) |entry| {
        allocator.free(entry.session_id);
        if (entry.model) |value| allocator.free(value);
        if (entry.phase) |value| allocator.free(value);
        if (entry.text) |value| allocator.free(value);
        if (entry.turn_id) |value| allocator.free(value);
        if (entry.thread_id) |value| allocator.free(value);
    }
    allocator.free(entries);
}

fn makeCodexNotification(
    allocator: std.mem.Allocator,
    method: []const u8,
    params_json: []const u8,
) !codex_sdk.Notification {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();

    const parsed = std.json.parseFromSlice(std.json.Value, arena.allocator(), params_json, .{}) catch {
        return error.InvalidJson;
    };

    return .{
        .arena = arena,
        .method = try arena.allocator().dupe(u8, method),
        .params = parsed.value,
    };
}

fn makeKimiInbound(
    allocator: std.mem.Allocator,
    json_line: []const u8,
) !kimi_wire_sdk.OwnedInbound {
    return kimi_wire_sdk.parseInboundJson(allocator, json_line);
}

test "worker store tracks claude session metadata and transcript" {
    const allocator = std.testing.allocator;

    var store = try WorkerStore.init(std.testing.io, allocator, .{
        .worker_id = "worker-alpha",
        .display_name = "Atlas",
        .objective = "triage cockpit task",
    });
    defer store.deinit();

    _ = try store.beginSession(.{
        .backend = .claude_code,
        .model = "claude-opus-4-6",
        .reason_started = "primary backend",
    });
    try store.recordUserMessage("scan the current state", null);

    try store.ingestClaudeMessage(.{
        .system = .{
            .session_id = "claude-session-1",
            .model = "claude-opus-4-6",
            .cwd = "/tmp",
            .tools = &.{ "bash", "read_file" },
        },
    });
    try store.ingestClaudeMessage(.{
        .assistant = .{
            .session_id = "claude-session-1",
            .content = &.{
                .{ .thinking = .{ .thinking = "checking repo" } },
                .{ .text = .{ .text = "There are two obvious hotspots." } },
            },
            .usage = .{
                .input_tokens = 10,
                .output_tokens = 20,
            },
        },
    });
    try store.ingestClaudeMessage(.{
        .result = .{
            .subtype = .success,
            .session_id = "claude-session-1",
            .result = "done",
            .total_cost_usd = 0.12,
            .num_turns = 1,
            .is_error = false,
        },
    });

    const snapshot = store.snapshot();
    try std.testing.expectEqual(Backend.claude_code, snapshot.current_backend.?);
    try std.testing.expectEqualStrings("claude-opus-4-6", snapshot.current_model.?);
    try std.testing.expect(snapshot.total_cost_usd >= 0.12);
    try std.testing.expect(snapshot.event_count >= 5);

    const transcript = try store.recentTranscript(allocator, 8);
    defer freeTranscriptEntries(allocator, transcript);
    try std.testing.expect(transcript.len >= 3);
}

test "worker store normalizes codex notifications into one session timeline" {
    const allocator = std.testing.allocator;

    var store = try WorkerStore.init(std.testing.io, allocator, .{
        .worker_id = "worker-beta",
        .display_name = "Beta",
    });
    defer store.deinit();

    try store.bindCodexThread("thread-1", "gpt-5.4", "hotbar switch");

    var started = try makeCodexNotification(allocator, "turn/started", "{\"turn\":{\"id\":\"turn-1\",\"status\":\"running\"}}");
    defer started.deinit();
    try store.ingestCodexNotification(&started);

    var delta = try makeCodexNotification(allocator, "item/agentMessage/delta", "{\"turnId\":\"turn-1\",\"delta\":\"hello \"}");
    defer delta.deinit();
    try store.ingestCodexNotification(&delta);

    var completed_item = try makeCodexNotification(allocator, "item/completed", "{\"turnId\":\"turn-1\",\"item\":{\"type\":\"agentMessage\",\"phase\":\"final_answer\",\"text\":\"world\"}}");
    defer completed_item.deinit();
    try store.ingestCodexNotification(&completed_item);

    var usage = try makeCodexNotification(allocator, "thread/tokenUsageUpdated", "{\"turnId\":\"turn-1\",\"tokenUsage\":{\"inputTokens\":12,\"outputTokens\":34}}");
    defer usage.deinit();
    try store.ingestCodexNotification(&usage);

    var completed = try makeCodexNotification(allocator, "turn/completed", "{\"turn\":{\"id\":\"turn-1\",\"status\":\"completed\"}}");
    defer completed.deinit();
    try store.ingestCodexNotification(&completed);

    const snapshot = store.snapshot();
    try std.testing.expectEqual(Backend.codex_app_server, snapshot.current_backend.?);
    try std.testing.expectEqualStrings("gpt-5.4", snapshot.current_model.?);
    try std.testing.expectEqual(@as(u64, 12), snapshot.usage.input_tokens);
    try std.testing.expectEqual(@as(u64, 34), snapshot.usage.output_tokens);

    const transcript = try store.recentTranscript(allocator, 10);
    defer freeTranscriptEntries(allocator, transcript);
    try std.testing.expect(transcript.len >= 4);
}

test "switching sessions preserves worker identity and increments switch count" {
    const allocator = std.testing.allocator;

    var store = try WorkerStore.init(std.testing.io, allocator, .{
        .worker_id = "worker-switch",
    });
    defer store.deinit();

    _ = try store.beginSession(.{
        .backend = .claude_code,
        .model = "claude-opus-4-6",
        .reason_started = "start claude",
    });
    _ = try store.switchSession(.{
        .backend = .codex_app_server,
        .model = "gpt-5.4",
        .thread_id = "thread-x",
        .reason_started = "operator switched to codex",
    });

    const snapshot = store.snapshot();
    try std.testing.expectEqualStrings("worker-switch", snapshot.worker_id);
    try std.testing.expect(snapshot.switch_count >= 1);
    try std.testing.expectEqual(@as(usize, 2), snapshot.session_count);
    try std.testing.expectEqual(Backend.codex_app_server, snapshot.current_backend.?);
}

test "worker store normalizes kimi wire events into one session timeline" {
    const allocator = std.testing.allocator;

    var store = try WorkerStore.init(std.testing.io, allocator, .{
        .worker_id = "worker-kimi",
        .display_name = "Kimi",
    });
    defer store.deinit();

    try store.bindKimiSession("kimi-session-1", "k2", "operator switched to kimi");

    var turn_begin = try makeKimiInbound(allocator, "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"TurnBegin\",\"payload\":{\"user_input\":\"scan the repo\"}}}");
    defer turn_begin.deinit();
    try store.ingestKimiWireMessage(&turn_begin.msg);

    var thinking = try makeKimiInbound(allocator, "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"ContentPart\",\"payload\":{\"type\":\"think\",\"think\":\"checking files\"}}}");
    defer thinking.deinit();
    try store.ingestKimiWireMessage(&thinking.msg);

    var text = try makeKimiInbound(allocator, "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"ContentPart\",\"payload\":{\"type\":\"text\",\"text\":\"Found two hotspots.\"}}}");
    defer text.deinit();
    try store.ingestKimiWireMessage(&text.msg);

    var tool_request = try makeKimiInbound(allocator, "{\"jsonrpc\":\"2.0\",\"method\":\"request\",\"id\":\"wire-req-1\",\"params\":{\"type\":\"ToolCallRequest\",\"payload\":{\"id\":\"tc-1\",\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"README.md\\\"}\"}}}");
    defer tool_request.deinit();
    try store.ingestKimiWireMessage(&tool_request.msg);

    var usage = try makeKimiInbound(allocator, "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"StatusUpdate\",\"payload\":{\"token_usage\":{\"input_other\":7,\"output\":11,\"input_cache_read\":3,\"input_cache_creation\":2}}}}");
    defer usage.deinit();
    try store.ingestKimiWireMessage(&usage.msg);

    var finished = try makeKimiInbound(allocator, "{\"jsonrpc\":\"2.0\",\"id\":\"reactjit-kimi-1\",\"result\":{\"status\":\"finished\"}}");
    defer finished.deinit();
    try store.ingestKimiWireMessage(&finished.msg);

    const snapshot = store.snapshot();
    try std.testing.expectEqual(Backend.kimi_cli_wire, snapshot.current_backend.?);
    try std.testing.expectEqualStrings("k2", snapshot.current_model.?);
    try std.testing.expectEqual(@as(u64, 7), snapshot.usage.input_tokens);
    try std.testing.expectEqual(@as(u64, 11), snapshot.usage.output_tokens);
    try std.testing.expectEqual(@as(u64, 3), snapshot.usage.cache_read_input_tokens);
    try std.testing.expectEqual(@as(u64, 2), snapshot.usage.cache_creation_input_tokens);

    const transcript = try store.recentTranscript(allocator, 10);
    defer freeTranscriptEntries(allocator, transcript);
    try std.testing.expect(transcript.len >= 5);
}
