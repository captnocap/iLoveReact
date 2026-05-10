//! Kimi Wire SDK for Zig.
//!
//! This wraps Kimi Code CLI's Wire mode over stdio:
//!   `kimi --wire`
//!
//! The surface is intentionally transport-first:
//!   - spawn the subprocess
//!   - `initialize()`
//!   - send requests such as `prompt`, `steer`, `replay`, `cancel`
//!   - `poll()` inbound events, requests, and responses
//!   - reply to agent-originated requests (approval/tool/question/hook)
//!
//! This matches the normalized worker contract well because Kimi Wire exposes
//! structured turn, status, tool, and replay events directly.

const std = @import("std");
const posix = std.posix;
const ReadBuffer = @import("claude_sdk/buffer.zig").ReadBuffer;

pub const VERSION = "0.1.0";
pub const default_kimi_bin = "kimi";
pub const default_protocol_version = "1.9";
pub const default_client_name = "reactjit_kimi_wire_sdk";

pub const SessionOptions = struct {
    kimi_bin: ?[]const u8 = null,
    launch_args_override: ?[]const []const u8 = null,
    cwd: ?[]const u8 = null,
    add_dirs: []const []const u8 = &.{},
    model: ?[]const u8 = null,
    continue_session: bool = false,
    session_id: ?[]const u8 = null,
    yolo: bool = false,
    plan_mode: bool = false,
    thinking: ?bool = null,
    mcp_config_files: []const []const u8 = &.{},
    inherit_stderr: bool = true,
    max_line_bytes: usize = 8 * 1024 * 1024,
};

pub const InitializeOptions = struct {
    protocol_version: []const u8 = default_protocol_version,
    client_name: []const u8 = default_client_name,
    client_version: []const u8 = VERSION,
    supports_question: bool = false,
    supports_plan_mode: bool = false,
    external_tools_json: ?[]const u8 = null,
    hooks_json: ?[]const u8 = null,
};

pub const UserInput = union(enum) {
    text: []const u8,
    json: []const u8,
};

pub const ApprovalDecision = enum {
    approve,
    approve_for_session,
    reject,
};

pub const HookAction = enum {
    allow,
    block,
};

pub const RequestToken = struct {
    allocator: std.mem.Allocator,
    id: []const u8,

    pub fn deinit(self: *RequestToken) void {
        self.allocator.free(self.id);
    }
};

pub const Event = struct {
    event_type: []const u8,
    payload: std.json.Value,

    pub fn payloadJsonAlloc(self: *const Event, allocator: std.mem.Allocator) ![]u8 {
        return std.json.Stringify.valueAlloc(allocator, self.payload, .{});
    }

    pub fn statusUsage(self: *const Event) TokenUsage {
        if (!std.mem.eql(u8, self.event_type, "StatusUpdate")) return .{};
        return .{
            .input_tokens = uintFromPath(self.payload, &.{"token_usage", "input_other"}) orelse 0,
            .output_tokens = uintFromPath(self.payload, &.{"token_usage", "output"}) orelse 0,
            .cache_creation_input_tokens = uintFromPath(self.payload, &.{"token_usage", "input_cache_creation"}) orelse 0,
            .cache_read_input_tokens = uintFromPath(self.payload, &.{"token_usage", "input_cache_read"}) orelse 0,
        };
    }
};

pub const Request = struct {
    id: []const u8,
    request_type: []const u8,
    payload: std.json.Value,

    pub fn payloadJsonAlloc(self: *const Request, allocator: std.mem.Allocator) ![]u8 {
        return std.json.Stringify.valueAlloc(allocator, self.payload, .{});
    }

    pub fn payloadId(self: *const Request) ?[]const u8 {
        return getStringPath(self.payload, &.{"id"});
    }
};

pub const Response = struct {
    id: []const u8,
    result: ?std.json.Value = null,
    error_code: ?i64 = null,
    error_message: ?[]const u8 = null,

    pub fn isError(self: *const Response) bool {
        return self.error_message != null;
    }

    pub fn status(self: *const Response) ?[]const u8 {
        const result = self.result orelse return null;
        return getStringPath(result, &.{"status"});
    }

    pub fn resultJsonAlloc(self: *const Response, allocator: std.mem.Allocator) !?[]u8 {
        const result = self.result orelse return null;
        return try std.json.Stringify.valueAlloc(allocator, result, .{});
    }
};

pub const InboundMessage = union(enum) {
    event: Event,
    request: Request,
    response: Response,
};

pub const OwnedInbound = struct {
    msg: InboundMessage,
    arena: std.heap.ArenaAllocator,

    pub fn deinit(self: *OwnedInbound) void {
        self.arena.deinit();
    }
};

pub const OwnedResponse = struct {
    response: Response,
    arena: std.heap.ArenaAllocator,

    pub fn deinit(self: *OwnedResponse) void {
        self.arena.deinit();
    }
};

pub const InitializeResult = struct {
    arena: std.heap.ArenaAllocator,
    protocol_version: []const u8,
    server_name: []const u8,
    server_version: []const u8,
    supports_question: bool = false,

    pub fn deinit(self: *InitializeResult) void {
        self.arena.deinit();
    }
};

pub const TokenUsage = struct {
    input_tokens: u64 = 0,
    output_tokens: u64 = 0,
    cache_creation_input_tokens: u64 = 0,
    cache_read_input_tokens: u64 = 0,
};

pub const Session = struct {
    allocator: std.mem.Allocator,
    options: SessionOptions,
    child: std.process.Child,
    line_buf: ReadBuffer,
    chunk: [8192]u8 = undefined,
    pending_inbound: std.ArrayList(OwnedInbound) = .{},
    next_request_seq: u64 = 1,
    last_rpc_error: ?[]u8 = null,
    closed: bool = false,

    pub fn init(allocator: std.mem.Allocator, options: SessionOptions) !Session {
        if (options.continue_session and options.session_id != null) return error.InvalidOptions;

        var argv = try buildArgv(allocator, options);
        defer argv.deinit(allocator);

        var child = std.process.Child.init(argv.items, allocator);
        child.cwd = options.cwd;
        child.stdin_behavior = .Pipe;
        child.stdout_behavior = .Pipe;
        child.stderr_behavior = if (options.inherit_stderr) .Inherit else .Ignore;

        child.spawn() catch return error.SpawnFailed;
        if (child.stdout) |stdout| {
            setNonBlocking(stdout.handle) catch {};
        }

        return .{
            .allocator = allocator,
            .options = options,
            .child = child,
            .line_buf = ReadBuffer.init(allocator),
        };
    }

    pub fn deinit(self: *Session) void {
        if (!self.closed) {
            if (self.child.stdin) |stdin| {
                stdin.close();
                self.child.stdin = null;
            }
            _ = self.child.kill() catch {};
            self.closed = true;
        }
        for (self.pending_inbound.items) |*owned| owned.deinit();
        self.pending_inbound.deinit(self.allocator);
        self.line_buf.deinit();
        if (self.last_rpc_error) |value| self.allocator.free(value);
    }

    pub fn close(self: *Session) !void {
        if (self.closed) return;
        self.closed = true;
        if (self.child.stdin) |stdin| {
            stdin.close();
            self.child.stdin = null;
        }
        _ = self.child.wait() catch {};
    }

    pub fn initialize(self: *Session, options: InitializeOptions) !InitializeResult {
        const params_json = try buildInitializeParamsJson(self.allocator, options);
        defer self.allocator.free(params_json);

        var token = try self.sendRequest("initialize", params_json);
        defer token.deinit();

        var owned = try self.waitForResponse(token.id);
        errdefer owned.deinit();
        try self.requireOk(&owned.response);

        const result = owned.response.result orelse return error.InvalidResponse;
        const protocol_version = getStringPath(result, &.{"protocol_version"}) orelse return error.InvalidResponse;
        const server_name = getStringPath(result, &.{"server", "name"}) orelse return error.InvalidResponse;
        const server_version = getStringPath(result, &.{"server", "version"}) orelse return error.InvalidResponse;

        return .{
            .arena = owned.arena,
            .protocol_version = protocol_version,
            .server_name = server_name,
            .server_version = server_version,
            .supports_question = boolFromPath(result, &.{"capabilities", "supports_question"}) orelse false,
        };
    }

    pub fn prompt(self: *Session, input: UserInput) !RequestToken {
        const params_json = try buildUserInputParamsJson(self.allocator, input);
        defer self.allocator.free(params_json);
        return self.sendRequest("prompt", params_json);
    }

    pub fn steer(self: *Session, input: UserInput) !RequestToken {
        const params_json = try buildUserInputParamsJson(self.allocator, input);
        defer self.allocator.free(params_json);
        return self.sendRequest("steer", params_json);
    }

    pub fn replay(self: *Session) !RequestToken {
        return self.sendRequest("replay", "{}");
    }

    pub fn cancel(self: *Session) !RequestToken {
        return self.sendRequest("cancel", "{}");
    }

    pub fn setPlanMode(self: *Session, enabled: bool) !RequestToken {
        const params_json = if (enabled) "{\"enabled\":true}" else "{\"enabled\":false}";
        return self.sendRequest("set_plan_mode", params_json);
    }

    pub fn poll(self: *Session) !?OwnedInbound {
        if (self.pending_inbound.items.len > 0) {
            return self.pending_inbound.orderedRemove(0);
        }

        while (true) {
            if (self.line_buf.drain()) |line| {
                const parsed = parseInboundJson(self.allocator, line) catch |err| switch (err) {
                    error.InvalidJson => continue,
                    else => return err,
                };
                return parsed;
            }

            const stdout = self.child.stdout orelse return null;
            const n = posix.read(stdout.handle, &self.chunk) catch |err| switch (err) {
                error.WouldBlock => return null,
                else => return error.ReadError,
            };
            if (n == 0) {
                self.closed = true;
                if (self.child.stdin) |stdin| {
                    stdin.close();
                    self.child.stdin = null;
                }
                return null;
            }
            try self.line_buf.append(self.chunk[0..n]);
            if (self.line_buf.buffer.items.len > self.options.max_line_bytes) return error.LineTooLong;
        }
    }

    pub fn waitForResponse(self: *Session, request_id: []const u8) !OwnedResponse {
        while (true) {
            if (try self.poll()) |owned| {
                var should_deinit = true;
                switch (owned.msg) {
                    .response => |response| {
                        if (std.mem.eql(u8, response.id, request_id)) {
                            return .{
                                .response = response,
                                .arena = owned.arena,
                            };
                        }
                    },
                    else => {
                        try self.pending_inbound.append(self.allocator, owned);
                        should_deinit = false;
                    },
                }
                if (should_deinit) {
                    var discard = owned;
                    discard.deinit();
                }
            }
            if (self.closed) return error.SessionClosed;
            std.Thread.sleep(1 * std.time.ns_per_ms);
        }
    }

    pub fn respondApproval(
        self: *Session,
        request: *const Request,
        decision: ApprovalDecision,
        feedback: ?[]const u8,
    ) !void {
        if (!std.mem.eql(u8, request.request_type, "ApprovalRequest")) return error.InvalidRequestType;
        const inner_id = request.payloadId() orelse return error.InvalidRequest;

        var buf: std.ArrayList(u8) = .{};
        defer buf.deinit(self.allocator);

        try buf.appendSlice(self.allocator, "{\"request_id\":");
        try appendJsonString(self.allocator, &buf, inner_id);
        try buf.appendSlice(self.allocator, ",\"response\":");
        try appendJsonString(self.allocator, &buf, @tagName(decision));
        if (feedback) |value| {
            try buf.appendSlice(self.allocator, ",\"feedback\":");
            try appendJsonString(self.allocator, &buf, value);
        }
        try buf.append(self.allocator, '}');

        try self.sendResultResponse(request.id, buf.items);
    }

    pub fn respondToolCall(self: *Session, request: *const Request, return_value_json: []const u8) !void {
        if (!std.mem.eql(u8, request.request_type, "ToolCallRequest")) return error.InvalidRequestType;
        const inner_id = request.payloadId() orelse return error.InvalidRequest;

        var buf: std.ArrayList(u8) = .{};
        defer buf.deinit(self.allocator);

        try buf.appendSlice(self.allocator, "{\"tool_call_id\":");
        try appendJsonString(self.allocator, &buf, inner_id);
        try buf.appendSlice(self.allocator, ",\"return_value\":");
        try buf.appendSlice(self.allocator, return_value_json);
        try buf.append(self.allocator, '}');

        try self.sendResultResponse(request.id, buf.items);
    }

    pub fn respondQuestion(self: *Session, request: *const Request, answers_json: []const u8) !void {
        if (!std.mem.eql(u8, request.request_type, "QuestionRequest")) return error.InvalidRequestType;
        const inner_id = request.payloadId() orelse return error.InvalidRequest;

        var buf: std.ArrayList(u8) = .{};
        defer buf.deinit(self.allocator);

        try buf.appendSlice(self.allocator, "{\"request_id\":");
        try appendJsonString(self.allocator, &buf, inner_id);
        try buf.appendSlice(self.allocator, ",\"answers\":");
        try buf.appendSlice(self.allocator, answers_json);
        try buf.append(self.allocator, '}');

        try self.sendResultResponse(request.id, buf.items);
    }

    pub fn respondHook(self: *Session, request: *const Request, action: HookAction, reason: []const u8) !void {
        if (!std.mem.eql(u8, request.request_type, "HookRequest")) return error.InvalidRequestType;
        const inner_id = request.payloadId() orelse return error.InvalidRequest;

        var buf: std.ArrayList(u8) = .{};
        defer buf.deinit(self.allocator);

        try buf.appendSlice(self.allocator, "{\"request_id\":");
        try appendJsonString(self.allocator, &buf, inner_id);
        try buf.appendSlice(self.allocator, ",\"action\":");
        try appendJsonString(self.allocator, &buf, @tagName(action));
        try buf.appendSlice(self.allocator, ",\"reason\":");
        try appendJsonString(self.allocator, &buf, reason);
        try buf.append(self.allocator, '}');

        try self.sendResultResponse(request.id, buf.items);
    }

    pub fn rpcError(self: *const Session) ?[]const u8 {
        return self.last_rpc_error;
    }

    fn sendRequest(self: *Session, method: []const u8, params_json: []const u8) !RequestToken {
        const request_id = try std.fmt.allocPrint(self.allocator, "reactjit-kimi-{d}", .{self.next_request_seq});
        errdefer self.allocator.free(request_id);
        self.next_request_seq += 1;

        var buf: std.ArrayList(u8) = .{};
        defer buf.deinit(self.allocator);

        try buf.appendSlice(self.allocator, "{\"jsonrpc\":\"2.0\",\"method\":");
        try appendJsonString(self.allocator, &buf, method);
        try buf.appendSlice(self.allocator, ",\"id\":");
        try appendJsonString(self.allocator, &buf, request_id);
        try buf.appendSlice(self.allocator, ",\"params\":");
        try buf.appendSlice(self.allocator, params_json);
        try buf.appendSlice(self.allocator, "}\n");

        try self.writeLine(buf.items);
        return .{
            .allocator = self.allocator,
            .id = request_id,
        };
    }

    fn sendResultResponse(self: *Session, request_id: []const u8, result_json: []const u8) !void {
        var buf: std.ArrayList(u8) = .{};
        defer buf.deinit(self.allocator);

        try buf.appendSlice(self.allocator, "{\"jsonrpc\":\"2.0\",\"id\":");
        try appendJsonString(self.allocator, &buf, request_id);
        try buf.appendSlice(self.allocator, ",\"result\":");
        try buf.appendSlice(self.allocator, result_json);
        try buf.appendSlice(self.allocator, "}\n");
        try self.writeLine(buf.items);
    }

    fn writeLine(self: *Session, line: []const u8) !void {
        if (self.closed) return error.SessionClosed;
        const stdin = self.child.stdin orelse return error.SessionClosed;
        stdin.writeAll(line) catch return error.WriteError;
    }

    fn requireOk(self: *Session, response: *const Response) !void {
        if (!response.isError()) return;
        if (self.last_rpc_error) |value| self.allocator.free(value);
        self.last_rpc_error = try dupOpt(self.allocator, response.error_message);
        return error.RemoteError;
    }
};

pub fn parseInboundJson(allocator: std.mem.Allocator, text: []const u8) !OwnedInbound {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();

    const parsed = std.json.parseFromSlice(std.json.Value, arena.allocator(), text, .{}) catch {
        return error.InvalidJson;
    };
    const root = asObject(parsed.value) orelse return error.InvalidResponse;

    if (getObjectString(root, "method")) |method| {
        if (std.mem.eql(u8, method, "event")) {
            const params = root.get("params") orelse return error.InvalidResponse;
            const event_type = getStringPath(params, &.{"type"}) orelse return error.InvalidResponse;
            const payload = getPath(params, &.{"payload"}) orelse emptyObject(arena.allocator());
            return .{
                .arena = arena,
                .msg = .{
                    .event = .{
                        .event_type = event_type,
                        .payload = payload,
                    },
                },
            };
        }

        if (std.mem.eql(u8, method, "request")) {
            const jsonrpc_id = root.get("id") orelse return error.InvalidResponse;
            const params = root.get("params") orelse return error.InvalidResponse;
            const request_type = getStringPath(params, &.{"type"}) orelse return error.InvalidResponse;
            const payload = getPath(params, &.{"payload"}) orelse emptyObject(arena.allocator());
            return .{
                .arena = arena,
                .msg = .{
                    .request = .{
                        .id = try idValueToText(arena.allocator(), jsonrpc_id),
                        .request_type = request_type,
                        .payload = payload,
                    },
                },
            };
        }
    }

    const jsonrpc_id = root.get("id") orelse return error.InvalidResponse;
    const result = root.get("result");
    const err_value = root.get("error");
    if (result == null and err_value == null) return error.InvalidResponse;

    return .{
        .arena = arena,
        .msg = .{
            .response = .{
                .id = try idValueToText(arena.allocator(), jsonrpc_id),
                .result = result,
                .error_code = if (err_value) |value| intFromPath(value, &.{"code"}) else null,
                .error_message = if (err_value) |value| getStringPath(value, &.{"message"}) else null,
            },
        },
    };
}

fn buildArgv(allocator: std.mem.Allocator, options: SessionOptions) !std.ArrayList([]const u8) {
    var argv: std.ArrayList([]const u8) = .{};
    errdefer argv.deinit(allocator);

    if (options.launch_args_override) |override| {
        try argv.appendSlice(allocator, override);
        return argv;
    }

    try argv.append(allocator, options.kimi_bin orelse default_kimi_bin);
    try argv.append(allocator, "--wire");

    if (options.cwd) |value| {
        try argv.append(allocator, "--work-dir");
        try argv.append(allocator, value);
    }
    for (options.add_dirs) |value| {
        try argv.append(allocator, "--add-dir");
        try argv.append(allocator, value);
    }
    if (options.model) |value| {
        try argv.append(allocator, "--model");
        try argv.append(allocator, value);
    }
    if (options.session_id) |value| {
        try argv.append(allocator, "--session");
        try argv.append(allocator, value);
    } else if (options.continue_session) {
        try argv.append(allocator, "--continue");
    }
    if (options.yolo) try argv.append(allocator, "--yolo");
    if (options.plan_mode) try argv.append(allocator, "--plan");
    if (options.thinking) |enabled| {
        try argv.append(allocator, if (enabled) "--thinking" else "--no-thinking");
    }
    for (options.mcp_config_files) |value| {
        try argv.append(allocator, "--mcp-config-file");
        try argv.append(allocator, value);
    }

    return argv;
}

fn buildInitializeParamsJson(allocator: std.mem.Allocator, options: InitializeOptions) ![]u8 {
    var buf: std.ArrayList(u8) = .{};
    errdefer buf.deinit(allocator);

    try buf.appendSlice(allocator, "{\"protocol_version\":");
    try appendJsonString(allocator, &buf, options.protocol_version);

    try buf.appendSlice(allocator, ",\"client\":{");
    try appendJsonKeyValueString(allocator, &buf, true, "name", options.client_name);
    try appendJsonKeyValueString(allocator, &buf, false, "version", options.client_version);
    try buf.append(allocator, '}');

    try buf.appendSlice(allocator, ",\"capabilities\":{");
    try appendJsonKeyValueBool(allocator, &buf, true, "supports_question", options.supports_question);
    try appendJsonKeyValueBool(allocator, &buf, false, "supports_plan_mode", options.supports_plan_mode);
    try buf.append(allocator, '}');

    if (options.external_tools_json) |value| {
        try buf.appendSlice(allocator, ",\"external_tools\":");
        try buf.appendSlice(allocator, value);
    }
    if (options.hooks_json) |value| {
        try buf.appendSlice(allocator, ",\"hooks\":");
        try buf.appendSlice(allocator, value);
    }

    try buf.append(allocator, '}');
    return try buf.toOwnedSlice(allocator);
}

fn buildUserInputParamsJson(allocator: std.mem.Allocator, input: UserInput) ![]u8 {
    var buf: std.ArrayList(u8) = .{};
    errdefer buf.deinit(allocator);

    try buf.appendSlice(allocator, "{\"user_input\":");
    switch (input) {
        .text => |value| try appendJsonString(allocator, &buf, value),
        .json => |value| try buf.appendSlice(allocator, value),
    }
    try buf.append(allocator, '}');
    return try buf.toOwnedSlice(allocator);
}

fn setNonBlocking(fd: posix.fd_t) !void {
    const flags = try posix.fcntl(fd, posix.F.GETFL, 0);
    _ = try posix.fcntl(fd, posix.F.SETFL, flags | @as(u32, @bitCast(posix.O{ .NONBLOCK = true })));
}

fn appendJsonKeyValueString(
    allocator: std.mem.Allocator,
    buf: *std.ArrayList(u8),
    first: bool,
    key: []const u8,
    value: []const u8,
) !void {
    if (!first) try buf.append(allocator, ',');
    try appendJsonString(allocator, buf, key);
    try buf.append(allocator, ':');
    try appendJsonString(allocator, buf, value);
}

fn appendJsonKeyValueBool(
    allocator: std.mem.Allocator,
    buf: *std.ArrayList(u8),
    first: bool,
    key: []const u8,
    value: bool,
) !void {
    if (!first) try buf.append(allocator, ',');
    try appendJsonString(allocator, buf, key);
    try buf.append(allocator, ':');
    try buf.appendSlice(allocator, if (value) "true" else "false");
}

fn appendJsonString(allocator: std.mem.Allocator, buf: *std.ArrayList(u8), value: []const u8) !void {
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

fn idValueToText(allocator: std.mem.Allocator, value: std.json.Value) ![]const u8 {
    return switch (value) {
        .string => |text| text,
        .integer => |number| try std.fmt.allocPrint(allocator, "{d}", .{number}),
        else => error.InvalidResponse,
    };
}

fn emptyObject(allocator: std.mem.Allocator) std.json.Value {
    return .{
        .object = std.json.ObjectMap.init(allocator),
    };
}

fn dupOpt(allocator: std.mem.Allocator, value: ?[]const u8) !?[]u8 {
    if (value) |text| return try allocator.dupe(u8, text);
    return null;
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

fn intFromPath(root: std.json.Value, path: []const []const u8) ?i64 {
    const value = getPath(root, path) orelse return null;
    return switch (value) {
        .integer => |number| number,
        else => null,
    };
}

fn uintFromPath(root: std.json.Value, path: []const []const u8) ?u64 {
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

fn asString(value: std.json.Value) ?[]const u8 {
    return switch (value) {
        .string => |text| text,
        else => null,
    };
}

test "buildArgv adds wire and session controls" {
    const allocator = std.testing.allocator;
    var argv = try buildArgv(allocator, .{
        .cwd = "/tmp/project",
        .model = "k2",
        .continue_session = true,
        .yolo = true,
    });
    defer argv.deinit(allocator);

    try std.testing.expectEqualStrings("kimi", argv.items[0]);
    try std.testing.expectEqualStrings("--wire", argv.items[1]);
    try std.testing.expectEqualStrings("--work-dir", argv.items[2]);
    try std.testing.expectEqualStrings("/tmp/project", argv.items[3]);
    try std.testing.expectEqualStrings("--model", argv.items[4]);
    try std.testing.expectEqualStrings("k2", argv.items[5]);
    try std.testing.expectEqualStrings("--continue", argv.items[6]);
    try std.testing.expectEqualStrings("--yolo", argv.items[7]);
}

test "parseInboundJson parses event envelopes" {
    const allocator = std.testing.allocator;
    var owned = try parseInboundJson(allocator,
        "{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"ContentPart\",\"payload\":{\"type\":\"text\",\"text\":\"hello\"}}}");
    defer owned.deinit();

    switch (owned.msg) {
        .event => |event| {
            try std.testing.expectEqualStrings("ContentPart", event.event_type);
            try std.testing.expectEqualStrings("text", getStringPath(event.payload, &.{"type"}).?);
            try std.testing.expectEqualStrings("hello", getStringPath(event.payload, &.{"text"}).?);
        },
        else => return error.UnexpectedMessageType,
    }
}

test "parseInboundJson parses request envelopes" {
    const allocator = std.testing.allocator;
    var owned = try parseInboundJson(allocator,
        "{\"jsonrpc\":\"2.0\",\"method\":\"request\",\"id\":\"abc\",\"params\":{\"type\":\"ToolCallRequest\",\"payload\":{\"id\":\"tc-1\",\"name\":\"open_in_ide\"}}}");
    defer owned.deinit();

    switch (owned.msg) {
        .request => |request| {
            try std.testing.expectEqualStrings("abc", request.id);
            try std.testing.expectEqualStrings("ToolCallRequest", request.request_type);
            try std.testing.expectEqualStrings("tc-1", request.payloadId().?);
        },
        else => return error.UnexpectedMessageType,
    }
}

test "parseInboundJson parses response envelopes" {
    const allocator = std.testing.allocator;
    var owned = try parseInboundJson(allocator,
        "{\"jsonrpc\":\"2.0\",\"id\":\"req-1\",\"result\":{\"status\":\"finished\"}}");
    defer owned.deinit();

    switch (owned.msg) {
        .response => |response| {
            try std.testing.expectEqualStrings("req-1", response.id);
            try std.testing.expectEqualStrings("finished", response.status().?);
            try std.testing.expect(!response.isError());
        },
        else => return error.UnexpectedMessageType,
    }
}
