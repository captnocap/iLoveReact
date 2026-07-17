//! Codex app-server SDK for Zig.
//!
//! This is a small Zig-native port of the public surface in
//! `openai/codex/sdk/python`, adapted for this repository's conventions.
//! It speaks newline-delimited JSON-RPC v2 over
//! `codex app-server --listen stdio://`.
//!
//! The module intentionally keeps advanced request fields stringly-typed:
//! caller-provided enums and structured blobs such as `config` or
//! `output_schema` are passed as raw JSON strings. This keeps the file
//! self-contained while still covering the useful SDK path:
//!
//!   var codex = try codex_sdk.Codex.init(gpa, .{ .cwd = "/tmp" });
//!   defer codex.deinit();
//!
//!   var thread = try codex.threadStart(.{ .model = "gpt-5.4" });
//!   defer thread.deinit();
//!
//!   var result = try thread.run(.{ .text = "Say hello in one sentence." }, .{});
//!   defer result.deinit();
//!
//!   if (result.final_response) |text| log.print("{s}\n", .{text});

const std = @import("std");
const log = @import("../diag/log.zig");

pub const VERSION = "0.1.0";
pub const default_codex_bin = "codex";
pub const default_client_name = "reactjit_codex_sdk";
pub const default_client_title = "ReactJIT Codex SDK";

pub const AppServerConfig = struct {
    codex_bin: ?[]const u8 = null,
    launch_args_override: ?[]const []const u8 = null,
    config_overrides: []const []const u8 = &.{},
    cwd: ?[]const u8 = null,
    client_name: []const u8 = default_client_name,
    client_title: []const u8 = default_client_title,
    client_version: []const u8 = VERSION,
    experimental_api: bool = true,
    inherit_stderr: bool = true,
    max_line_bytes: usize = 8 * 1024 * 1024,
};

pub const ThreadStartOptions = struct {
    approval_policy: ?[]const u8 = null,
    approvals_reviewer: ?[]const u8 = null,
    base_instructions: ?[]const u8 = null,
    config_json: ?[]const u8 = null,
    cwd: ?[]const u8 = null,
    developer_instructions: ?[]const u8 = null,
    ephemeral: ?bool = null,
    model: ?[]const u8 = null,
    model_provider: ?[]const u8 = null,
    personality: ?[]const u8 = null,
    sandbox: ?[]const u8 = null,
    service_name: ?[]const u8 = null,
    service_tier: ?[]const u8 = null,
};

pub const ThreadResumeOptions = struct {
    approval_policy: ?[]const u8 = null,
    approvals_reviewer: ?[]const u8 = null,
    base_instructions: ?[]const u8 = null,
    config_json: ?[]const u8 = null,
    cwd: ?[]const u8 = null,
    developer_instructions: ?[]const u8 = null,
    model: ?[]const u8 = null,
    model_provider: ?[]const u8 = null,
    personality: ?[]const u8 = null,
    sandbox: ?[]const u8 = null,
    service_tier: ?[]const u8 = null,
};

pub const ThreadForkOptions = struct {
    approval_policy: ?[]const u8 = null,
    approvals_reviewer: ?[]const u8 = null,
    base_instructions: ?[]const u8 = null,
    config_json: ?[]const u8 = null,
    cwd: ?[]const u8 = null,
    developer_instructions: ?[]const u8 = null,
    ephemeral: ?bool = null,
    model: ?[]const u8 = null,
    model_provider: ?[]const u8 = null,
    sandbox: ?[]const u8 = null,
    service_tier: ?[]const u8 = null,
};

pub const ThreadListOptions = struct {
    archived: ?bool = null,
    cursor: ?[]const u8 = null,
    cwd: ?[]const u8 = null,
    limit: ?usize = null,
    model_providers: []const []const u8 = &.{},
    search_term: ?[]const u8 = null,
    sort_key: ?[]const u8 = null,
    source_kinds: []const []const u8 = &.{},
};

pub const TurnOptions = struct {
    approval_policy: ?[]const u8 = null,
    approvals_reviewer: ?[]const u8 = null,
    cwd: ?[]const u8 = null,
    effort: ?[]const u8 = null,
    model: ?[]const u8 = null,
    output_schema_json: ?[]const u8 = null,
    personality: ?[]const u8 = null,
    sandbox_policy_json: ?[]const u8 = null,
    service_tier: ?[]const u8 = null,
    summary: ?[]const u8 = null,
};

pub const NamedPath = struct {
    name: []const u8,
    path: []const u8,
};

pub const InputItem = union(enum) {
    text: []const u8,
    image: []const u8,
    local_image: []const u8,
    skill: NamedPath,
    mention: NamedPath,
};

pub const Input = union(enum) {
    text: []const u8,
    item: InputItem,
    items: []const InputItem,
};

pub const InitializeResponse = struct {
    allocator: std.mem.Allocator,
    user_agent: []const u8,
    server_name: []const u8,
    server_version: []const u8,
    platform_family: ?[]const u8 = null,
    platform_os: ?[]const u8 = null,

    pub fn deinit(self: *InitializeResponse) void {
        self.allocator.free(self.user_agent);
        self.allocator.free(self.server_name);
        self.allocator.free(self.server_version);
        if (self.platform_family) |value| self.allocator.free(value);
        if (self.platform_os) |value| self.allocator.free(value);
    }
};

pub const OwnedJson = struct {
    arena: std.heap.ArenaAllocator,
    value: std.json.Value,

    pub fn deinit(self: *OwnedJson) void {
        self.arena.deinit();
    }

    pub fn stringifyAlloc(self: *const OwnedJson, allocator: std.mem.Allocator) ![]u8 {
        return std.json.Stringify.valueAlloc(allocator, self.value, .{});
    }
};

pub const ThreadItem = struct {
    json: []const u8,
    item_type: ?[]const u8 = null,
    role: ?[]const u8 = null,
    phase: ?[]const u8 = null,
    text: ?[]const u8 = null,
};

pub const RunResult = struct {
    arena: std.heap.ArenaAllocator,
    turn_id: []const u8,
    status: ?[]const u8 = null,
    error_message: ?[]const u8 = null,
    final_response: ?[]const u8 = null,
    items: []const ThreadItem,
    usage_json: ?[]const u8 = null,

    pub fn deinit(self: *RunResult) void {
        self.arena.deinit();
    }
};

pub const Notification = struct {
    arena: std.heap.ArenaAllocator,
    method: []const u8,
    params: std.json.Value,

    pub fn deinit(self: *Notification) void {
        self.arena.deinit();
    }

    pub fn deltaText(self: *const Notification) ?[]const u8 {
        if (!std.mem.eql(u8, self.method, "item/agentMessage/delta")) return null;
        return getStringPath(self.params, &.{"delta"});
    }

    pub fn turnId(self: *const Notification) ?[]const u8 {
        if (getStringPath(self.params, &.{"turnId"})) |value| return value;
        return getStringPath(self.params, &.{ "turn", "id" });
    }

    pub fn itemValue(self: *const Notification) ?std.json.Value {
        if (!std.mem.eql(u8, self.method, "item/completed")) return null;
        return getPath(self.params, &.{"item"});
    }

    pub fn tokenUsageValue(self: *const Notification) ?std.json.Value {
        if (!std.mem.eql(u8, self.method, "thread/tokenUsageUpdated")) return null;
        return getPath(self.params, &.{"tokenUsage"});
    }

    pub fn completedStatus(self: *const Notification) ?[]const u8 {
        if (!std.mem.eql(u8, self.method, "turn/completed")) return null;
        return getStringPath(self.params, &.{ "turn", "status" });
    }

    pub fn completedErrorMessage(self: *const Notification) ?[]const u8 {
        if (!std.mem.eql(u8, self.method, "turn/completed")) return null;
        return getStringPath(self.params, &.{ "turn", "error", "message" });
    }
};

pub const AppServerClient = struct {
    allocator: std.mem.Allocator,
    config: AppServerConfig,
    child: ?std.process.Child = null,
    next_request_id: u64 = 1,
    pending_notifications: std.ArrayList(Notification) = .empty,
    active_turn_id: ?[]const u8 = null,
    last_rpc_error: ?[]u8 = null,

    pub fn init(allocator: std.mem.Allocator, config: AppServerConfig) AppServerClient {
        return .{
            .allocator = allocator,
            .config = config,
        };
    }

    pub fn deinit(self: *AppServerClient) void {
        self.close();
        for (self.pending_notifications.items) |*notification| notification.deinit();
        self.pending_notifications.deinit(self.allocator);
        if (self.active_turn_id) |value| self.allocator.free(value);
        if (self.last_rpc_error) |value| self.allocator.free(value);
    }

    pub fn start(self: *AppServerClient) !void {
        if (self.child != null) return;

        var argv_list: std.ArrayList([]const u8) = .empty;
        defer argv_list.deinit(self.allocator);

        if (self.config.launch_args_override) |override| {
            try argv_list.appendSlice(self.allocator, override);
        } else {
            try argv_list.append(self.allocator, self.config.codex_bin orelse default_codex_bin);
            for (self.config.config_overrides) |entry| {
                try argv_list.append(self.allocator, "--config");
                try argv_list.append(self.allocator, entry);
            }
            try argv_list.appendSlice(self.allocator, &.{ "app-server", "--listen", "stdio://" });
        }

        var child = std.process.Child.init(argv_list.items, self.allocator);
        child.cwd = self.config.cwd;
        child.stdin_behavior = .Pipe;
        child.stdout_behavior = .Pipe;
        child.stderr_behavior = if (self.config.inherit_stderr) .Inherit else .Ignore;

        try child.spawn();
        self.child = child;
    }

    pub fn close(self: *AppServerClient) void {
        if (self.child == null) return;

        var child = self.child.?;
        self.child = null;

        if (child.stdin) |stdin| {
            stdin.close();
            child.stdin = null;
        }

        _ = child.kill() catch {};
        _ = child.wait() catch {};
    }

    pub fn initialize(self: *AppServerClient) !InitializeResponse {
        const params_json = try buildInitializeParamsJson(self.allocator, self.config);
        defer self.allocator.free(params_json);

        var response = try self.requestJson("initialize", params_json);
        defer response.deinit();

        try self.notify("initialized", "{}");
        return try parseInitializeResponse(self.allocator, response.value);
    }

    pub fn notify(self: *AppServerClient, method: []const u8, params_json: []const u8) !void {
        try self.writeEnvelope(null, method, params_json);
    }

    pub fn requestJson(self: *AppServerClient, method: []const u8, params_json: []const u8) !OwnedJson {
        const request_id = self.next_request_id;
        self.next_request_id += 1;
        try self.writeEnvelope(request_id, method, params_json);

        while (true) {
            var message = try self.readMessage();
            const root = asObject(message.value) orelse {
                message.deinit();
                return error.InvalidResponse;
            };

            const maybe_method = getObjectString(root, "method");
            const has_id = root.contains("id");

            if (maybe_method) |incoming_method| {
                if (has_id) {
                    try self.respondToServerRequest(root);
                    message.deinit();
                    continue;
                }

                try self.pending_notifications.append(self.allocator, try notificationFromOwnedJson(message, incoming_method));
                continue;
            }

            const response_id = getObjectInt(root, "id") orelse {
                message.deinit();
                continue;
            };
            if (response_id != @as(i64, @intCast(request_id))) {
                message.deinit();
                continue;
            }

            if (root.get("error")) |err_value| {
                try self.setLastRpcError(err_value);
                message.deinit();
                return error.RemoteError;
            }

            const result_value = root.get("result") orelse {
                message.deinit();
                return error.InvalidResponse;
            };
            return .{
                .arena = message.arena,
                .value = result_value,
            };
        }
    }

    pub fn nextNotification(self: *AppServerClient) !Notification {
        if (self.pending_notifications.items.len > 0) {
            return self.pending_notifications.orderedRemove(0);
        }

        while (true) {
            var message = try self.readMessage();
            const root = asObject(message.value) orelse {
                message.deinit();
                return error.InvalidResponse;
            };
            const maybe_method = getObjectString(root, "method");

            if (maybe_method) |method| {
                if (root.contains("id")) {
                    try self.respondToServerRequest(root);
                    message.deinit();
                    continue;
                }
                return try notificationFromOwnedJson(message, method);
            }

            // Ignore out-of-band responses while streaming notifications.
            message.deinit();
        }
    }

    pub fn acquireTurnConsumer(self: *AppServerClient, turn_id: []const u8) !void {
        if (self.active_turn_id) |current| {
            if (!std.mem.eql(u8, current, turn_id)) return error.ConcurrentTurnConsumer;
            return;
        }
        self.active_turn_id = try self.allocator.dupe(u8, turn_id);
    }

    pub fn releaseTurnConsumer(self: *AppServerClient, turn_id: []const u8) void {
        if (self.active_turn_id) |current| {
            if (std.mem.eql(u8, current, turn_id)) {
                self.allocator.free(current);
                self.active_turn_id = null;
            }
        }
    }

    pub fn lastRpcError(self: *const AppServerClient) ?[]const u8 {
        return self.last_rpc_error;
    }

    fn writeEnvelope(
        self: *AppServerClient,
        request_id: ?u64,
        method: []const u8,
        params_json: []const u8,
    ) !void {
        const child = self.child orelse return error.TransportClosed;
        const stdin = child.stdin orelse return error.TransportClosed;

        var buf: std.ArrayList(u8) = .empty;
        defer buf.deinit(self.allocator);

        try buf.append(self.allocator, '{');
        if (request_id) |id| {
            try appendFieldPrefix(self.allocator, &buf, true);
            try appendJsonString(self.allocator, &buf, "id");
            try buf.append(self.allocator, ':');
            const id_text = try std.fmt.allocPrint(self.allocator, "{d}", .{id});
            defer self.allocator.free(id_text);
            try buf.appendSlice(self.allocator, id_text);
        }
        try appendFieldPrefix(self.allocator, &buf, request_id == null);
        try appendJsonString(self.allocator, &buf, "method");
        try buf.append(self.allocator, ':');
        try appendJsonString(self.allocator, &buf, method);
        try appendFieldPrefix(self.allocator, &buf, false);
        try appendJsonString(self.allocator, &buf, "params");
        try buf.append(self.allocator, ':');
        try buf.appendSlice(self.allocator, params_json);
        try buf.appendSlice(self.allocator, "}\n");

        try stdin.writeAll(buf.items);
    }

    fn readMessage(self: *AppServerClient) !OwnedJson {
        const child = self.child orelse return error.TransportClosed;
        const stdout = child.stdout orelse return error.TransportClosed;
        // deprecatedReader returns the legacy std.io.GenericReader which still
        // has readUntilDelimiterOrEofAlloc. The newer File.Reader requires a
        // pre-allocated buffer and exposes a different API; the codex SDK is
        // single-line-JSON-RPC and the old reader does the right thing here.
        const line = try stdout.deprecatedReader().readUntilDelimiterOrEofAlloc(
            self.allocator,
            '\n',
            self.config.max_line_bytes,
        );
        if (line == null) return error.TransportClosed;
        defer self.allocator.free(line.?);

        return parseOwnedJson(self.allocator, line.?);
    }

    fn respondToServerRequest(self: *AppServerClient, root: std.json.ObjectMap) !void {
        const request_id_value = root.get("id") orelse return;
        const request_id_json = try std.json.Stringify.valueAlloc(self.allocator, request_id_value, .{});
        defer self.allocator.free(request_id_json);

        const method = getObjectString(root, "method") orelse return;
        const response_json = approvalResponseJson(method);
        const child = self.child orelse return error.TransportClosed;
        const stdin = child.stdin orelse return error.TransportClosed;

        var buf: std.ArrayList(u8) = .empty;
        defer buf.deinit(self.allocator);

        try buf.appendSlice(self.allocator, "{\"id\":");
        try buf.appendSlice(self.allocator, request_id_json);
        try buf.appendSlice(self.allocator, ",\"result\":");
        try buf.appendSlice(self.allocator, response_json);
        try buf.appendSlice(self.allocator, "}\n");
        try stdin.writeAll(buf.items);
    }

    fn setLastRpcError(self: *AppServerClient, value: std.json.Value) !void {
        const json = try std.json.Stringify.valueAlloc(self.allocator, value, .{});
        if (self.last_rpc_error) |current| self.allocator.free(current);
        self.last_rpc_error = json;
    }
};

pub const Codex = struct {
    allocator: std.mem.Allocator,
    client: AppServerClient,
    metadata: InitializeResponse,

    pub fn init(allocator: std.mem.Allocator, config: AppServerConfig) !Codex {
        var client = AppServerClient.init(allocator, config);
        errdefer client.deinit();

        try client.start();
        const metadata = try client.initialize();

        return .{
            .allocator = allocator,
            .client = client,
            .metadata = metadata,
        };
    }

    pub fn deinit(self: *Codex) void {
        self.metadata.deinit();
        self.client.deinit();
    }

    pub fn threadStart(self: *Codex, options: ThreadStartOptions) !Thread {
        const params_json = try buildThreadStartParamsJson(self.allocator, options);
        defer self.allocator.free(params_json);

        var response = try self.client.requestJson("thread/start", params_json);
        defer response.deinit();

        const thread_id = getStringPath(response.value, &.{ "thread", "id" }) orelse return error.InvalidResponse;
        return Thread.init(self.allocator, &self.client, thread_id);
    }

    pub fn threadResume(self: *Codex, thread_id: []const u8, options: ThreadResumeOptions) !Thread {
        const params_json = try buildThreadResumeParamsJson(self.allocator, thread_id, options);
        defer self.allocator.free(params_json);

        var response = try self.client.requestJson("thread/resume", params_json);
        defer response.deinit();

        const resumed_id = getStringPath(response.value, &.{ "thread", "id" }) orelse return error.InvalidResponse;
        return Thread.init(self.allocator, &self.client, resumed_id);
    }

    pub fn threadFork(self: *Codex, thread_id: []const u8, options: ThreadForkOptions) !Thread {
        const params_json = try buildThreadForkParamsJson(self.allocator, thread_id, options);
        defer self.allocator.free(params_json);

        var response = try self.client.requestJson("thread/fork", params_json);
        defer response.deinit();

        const forked_id = getStringPath(response.value, &.{ "thread", "id" }) orelse return error.InvalidResponse;
        return Thread.init(self.allocator, &self.client, forked_id);
    }

    pub fn threadUnarchive(self: *Codex, thread_id: []const u8) !Thread {
        const params_json = try buildThreadIdOnlyParamsJson(self.allocator, thread_id);
        defer self.allocator.free(params_json);

        var response = try self.client.requestJson("thread/unarchive", params_json);
        defer response.deinit();

        const reopened_id = getStringPath(response.value, &.{ "thread", "id" }) orelse return error.InvalidResponse;
        return Thread.init(self.allocator, &self.client, reopened_id);
    }

    pub fn threadArchive(self: *Codex, thread_id: []const u8) !OwnedJson {
        const params_json = try buildThreadIdOnlyParamsJson(self.allocator, thread_id);
        defer self.allocator.free(params_json);
        return self.client.requestJson("thread/archive", params_json);
    }

    pub fn threadList(self: *Codex, options: ThreadListOptions) !OwnedJson {
        const params_json = try buildThreadListParamsJson(self.allocator, options);
        defer self.allocator.free(params_json);
        return self.client.requestJson("thread/list", params_json);
    }

    pub fn models(self: *Codex, include_hidden: bool) !OwnedJson {
        const params_json = try buildModelListParamsJson(self.allocator, include_hidden);
        defer self.allocator.free(params_json);
        return self.client.requestJson("model/list", params_json);
    }
};

pub const Thread = struct {
    allocator: std.mem.Allocator,
    client: *AppServerClient,
    id: []const u8,

    pub fn init(allocator: std.mem.Allocator, client: *AppServerClient, id: []const u8) !Thread {
        return .{
            .allocator = allocator,
            .client = client,
            .id = try allocator.dupe(u8, id),
        };
    }

    pub fn deinit(self: *Thread) void {
        self.allocator.free(self.id);
    }

    pub fn run(self: *Thread, input: Input, options: TurnOptions) !RunResult {
        var handle = try self.turn(input, options);
        defer handle.deinit();
        return handle.run();
    }

    pub fn turn(self: *Thread, input: Input, options: TurnOptions) !TurnHandle {
        const params_json = try buildTurnStartParamsJson(self.allocator, self.id, input, options);
        defer self.allocator.free(params_json);

        var response = try self.client.requestJson("turn/start", params_json);
        defer response.deinit();

        const turn_id = getStringPath(response.value, &.{ "turn", "id" }) orelse return error.InvalidResponse;
        return TurnHandle.init(self.allocator, self.client, self.id, turn_id);
    }

    pub fn read(self: *Thread, include_turns: bool) !OwnedJson {
        const params_json = try buildThreadReadParamsJson(self.allocator, self.id, include_turns);
        defer self.allocator.free(params_json);
        return self.client.requestJson("thread/read", params_json);
    }

    pub fn setName(self: *Thread, name: []const u8) !OwnedJson {
        const params_json = try buildThreadSetNameParamsJson(self.allocator, self.id, name);
        defer self.allocator.free(params_json);
        return self.client.requestJson("thread/name/set", params_json);
    }

    pub fn compact(self: *Thread) !OwnedJson {
        const params_json = try buildThreadIdOnlyParamsJson(self.allocator, self.id);
        defer self.allocator.free(params_json);
        return self.client.requestJson("thread/compact/start", params_json);
    }
};

pub const TurnHandle = struct {
    allocator: std.mem.Allocator,
    client: *AppServerClient,
    thread_id: []const u8,
    id: []const u8,
    streaming: bool = false,
    completed: bool = false,

    pub fn init(
        allocator: std.mem.Allocator,
        client: *AppServerClient,
        thread_id: []const u8,
        turn_id: []const u8,
    ) !TurnHandle {
        return .{
            .allocator = allocator,
            .client = client,
            .thread_id = try allocator.dupe(u8, thread_id),
            .id = try allocator.dupe(u8, turn_id),
        };
    }

    pub fn deinit(self: *TurnHandle) void {
        if (self.streaming and !self.completed) {
            self.client.releaseTurnConsumer(self.id);
        }
        self.allocator.free(self.thread_id);
        self.allocator.free(self.id);
    }

    pub fn interrupt(self: *TurnHandle) !OwnedJson {
        const params_json = try buildTurnInterruptParamsJson(self.allocator, self.thread_id, self.id);
        defer self.allocator.free(params_json);
        return self.client.requestJson("turn/interrupt", params_json);
    }

    pub fn steer(self: *TurnHandle, input: Input) !OwnedJson {
        const params_json = try buildTurnSteerParamsJson(self.allocator, self.thread_id, self.id, input);
        defer self.allocator.free(params_json);
        return self.client.requestJson("turn/steer", params_json);
    }

    pub fn next(self: *TurnHandle) !?Notification {
        if (self.completed) return null;
        if (!self.streaming) {
            try self.client.acquireTurnConsumer(self.id);
            self.streaming = true;
        }

        var notification = try self.client.nextNotification();
        if (std.mem.eql(u8, notification.method, "turn/completed")) {
            if (notification.turnId()) |turn_id| {
                if (std.mem.eql(u8, turn_id, self.id)) {
                    self.completed = true;
                    self.client.releaseTurnConsumer(self.id);
                }
            }
        }
        return notification;
    }

    pub fn run(self: *TurnHandle) !RunResult {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        errdefer arena.deinit();

        var items: std.ArrayList(ThreadItem) = .empty;
        defer items.deinit(arena.allocator());

        var status: ?[]const u8 = null;
        var error_message: ?[]const u8 = null;
        var usage_json: ?[]const u8 = null;

        while (try self.next()) |*notification| {
            defer notification.deinit();

            if (notification.itemValue()) |item_value| {
                if (notification.turnId()) |turn_id| {
                    if (std.mem.eql(u8, turn_id, self.id)) {
                        try items.append(arena.allocator(), try buildThreadItem(arena.allocator(), item_value));
                    }
                }
                continue;
            }

            if (notification.tokenUsageValue()) |usage_value| {
                if (notification.turnId()) |turn_id| {
                    if (std.mem.eql(u8, turn_id, self.id)) {
                        usage_json = try std.json.Stringify.valueAlloc(arena.allocator(), usage_value, .{});
                    }
                }
                continue;
            }

            if (std.mem.eql(u8, notification.method, "turn/completed")) {
                if (notification.turnId()) |turn_id| {
                    if (std.mem.eql(u8, turn_id, self.id)) {
                        if (notification.completedStatus()) |value| {
                            status = try arena.allocator().dupe(u8, value);
                        }
                        if (notification.completedErrorMessage()) |value| {
                            error_message = try arena.allocator().dupe(u8, value);
                        }
                    }
                }
            }
        }

        const owned_items = try items.toOwnedSlice(arena.allocator());
        return .{
            .arena = arena,
            .turn_id = try arena.allocator().dupe(u8, self.id),
            .status = status,
            .error_message = error_message,
            .final_response = finalResponseFromItems(owned_items),
            .items = owned_items,
            .usage_json = usage_json,
        };
    }
};

fn parseOwnedJson(allocator: std.mem.Allocator, text: []const u8) !OwnedJson {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();

    const parsed = std.json.parseFromSlice(std.json.Value, arena.allocator(), text, .{}) catch {
        return error.InvalidJson;
    };
    return .{
        .arena = arena,
        .value = parsed.value,
    };
}

fn notificationFromOwnedJson(message: OwnedJson, method: []const u8) !Notification {
    var owned = message;
    const root = asObject(owned.value) orelse return error.InvalidResponse;
    const params = root.get("params") orelse std.json.Value{ .object = std.json.ObjectMap.init(owned.arena.allocator()) };
    return .{
        .arena = owned.arena,
        .method = method,
        .params = params,
    };
}

fn parseInitializeResponse(allocator: std.mem.Allocator, value: std.json.Value) !InitializeResponse {
    const trimmed_user_agent = std.mem.trim(u8, getStringPath(value, &.{"userAgent"}) orelse "", &std.ascii.whitespace);
    var server_name = std.mem.trim(u8, getStringPath(value, &.{ "serverInfo", "name" }) orelse "", &std.ascii.whitespace);
    var server_version = std.mem.trim(u8, getStringPath(value, &.{ "serverInfo", "version" }) orelse "", &std.ascii.whitespace);

    if (server_name.len == 0 or server_version.len == 0) {
        const split = splitUserAgent(trimmed_user_agent);
        if (server_name.len == 0) {
            if (split.name) |candidate| server_name = candidate;
        }
        if (server_version.len == 0) {
            if (split.version) |candidate| server_version = candidate;
        }
    }

    if (trimmed_user_agent.len == 0 or server_name.len == 0 or server_version.len == 0) {
        return error.InvalidResponse;
    }

    return .{
        .allocator = allocator,
        .user_agent = try allocator.dupe(u8, trimmed_user_agent),
        .server_name = try allocator.dupe(u8, server_name),
        .server_version = try allocator.dupe(u8, server_version),
        .platform_family = if (getStringPath(value, &.{"platformFamily"})) |candidate| try allocator.dupe(u8, candidate) else null,
        .platform_os = if (getStringPath(value, &.{"platformOs"})) |candidate| try allocator.dupe(u8, candidate) else null,
    };
}

fn buildThreadItem(allocator: std.mem.Allocator, item_value: std.json.Value) !ThreadItem {
    return .{
        .json = try std.json.Stringify.valueAlloc(allocator, item_value, .{}),
        .item_type = if (getStringPath(item_value, &.{"type"})) |value| try allocator.dupe(u8, value) else null,
        .role = if (getStringPath(item_value, &.{"role"})) |value| try allocator.dupe(u8, value) else null,
        .phase = if (getStringPath(item_value, &.{"phase"})) |value| try allocator.dupe(u8, value) else null,
        .text = try assistantTextFromItem(allocator, item_value),
    };
}

fn finalResponseFromItems(items: []const ThreadItem) ?[]const u8 {
    var fallback: ?[]const u8 = null;
    var i = items.len;
    while (i > 0) {
        i -= 1;
        const item = items[i];
        if (item.text == null) continue;

        if (item.item_type) |item_type| {
            if (std.mem.eql(u8, item_type, "agentMessage")) {
                if (item.phase) |phase| {
                    if (std.mem.eql(u8, phase, "final_answer")) return item.text;
                } else if (fallback == null) {
                    fallback = item.text;
                }
                continue;
            }
        }

        if (fallback == null) fallback = item.text;
    }
    return fallback;
}

fn assistantTextFromItem(allocator: std.mem.Allocator, item_value: std.json.Value) !?[]const u8 {
    const item_type = getStringPath(item_value, &.{"type"});
    if (item_type) |value| {
        if (std.mem.eql(u8, value, "agentMessage")) {
            if (getStringPath(item_value, &.{"text"})) |text| {
                return try allocator.dupe(u8, text);
            }
        }

        if (std.mem.eql(u8, value, "message")) {
            const role = getStringPath(item_value, &.{"role"}) orelse return null;
            if (!std.mem.eql(u8, role, "assistant")) return null;
            const content_value = getPath(item_value, &.{"content"}) orelse return null;
            const content = asArray(content_value) orelse return null;

            var buf: std.ArrayList(u8) = .empty;
            defer buf.deinit(allocator);

            for (content.items) |entry| {
                const obj = asObject(entry) orelse continue;
                const content_type = getObjectString(obj, "type") orelse continue;
                if (!std.mem.eql(u8, content_type, "output_text")) continue;
                const text = getObjectString(obj, "text") orelse continue;
                try buf.appendSlice(allocator, text);
            }

            if (buf.items.len == 0) return null;
            return try buf.toOwnedSlice(allocator);
        }
    }
    return null;
}

fn approvalResponseJson(method: []const u8) []const u8 {
    if (std.mem.endsWith(u8, method, "/requestApproval")) return "{\"decision\":\"accept\"}";
    if (std.mem.eql(u8, method, "item/commandExecution/requestApproval")) return "{\"decision\":\"accept\"}";
    if (std.mem.eql(u8, method, "item/fileChange/requestApproval")) return "{\"decision\":\"accept\"}";
    return "{}";
}

fn splitUserAgent(value: []const u8) struct { name: ?[]const u8, version: ?[]const u8 } {
    const trimmed = std.mem.trim(u8, value, &std.ascii.whitespace);
    if (trimmed.len == 0) return .{ .name = null, .version = null };

    if (std.mem.indexOfScalar(u8, trimmed, '/')) |idx| {
        const left = trimmed[0..idx];
        const right = trimmed[idx + 1 ..];
        return .{
            .name = if (left.len == 0) null else left,
            .version = if (right.len == 0) null else right,
        };
    }

    var iter = std.mem.splitScalar(u8, trimmed, ' ');
    const first = iter.next() orelse return .{ .name = null, .version = null };
    const second = iter.next();
    if (second) |value2| {
        return .{
            .name = first,
            .version = if (value2.len == 0) null else value2,
        };
    }

    return .{
        .name = first,
        .version = null,
    };
}

fn buildInitializeParamsJson(allocator: std.mem.Allocator, config: AppServerConfig) ![]u8 {
    var client_info = try JsonObjectBuilder.init(allocator);
    defer client_info.deinit();
    try client_info.stringField("name", config.client_name);
    try client_info.stringField("title", config.client_title);
    try client_info.stringField("version", config.client_version);
    const client_info_json = try client_info.finish();
    defer allocator.free(client_info_json);

    var capabilities = try JsonObjectBuilder.init(allocator);
    defer capabilities.deinit();
    try capabilities.boolField("experimentalApi", config.experimental_api);
    const capabilities_json = try capabilities.finish();
    defer allocator.free(capabilities_json);

    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.rawField("clientInfo", client_info_json);
    try params.rawField("capabilities", capabilities_json);
    return params.finish();
}

fn buildThreadStartParamsJson(allocator: std.mem.Allocator, options: ThreadStartOptions) ![]u8 {
    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try appendThreadStartLikeFields(&params, options);
    return params.finish();
}

fn buildThreadResumeParamsJson(
    allocator: std.mem.Allocator,
    thread_id: []const u8,
    options: ThreadResumeOptions,
) ![]u8 {
    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.stringField("threadId", thread_id);
    try appendThreadResumeLikeFields(&params, options);
    return params.finish();
}

fn buildThreadForkParamsJson(
    allocator: std.mem.Allocator,
    thread_id: []const u8,
    options: ThreadForkOptions,
) ![]u8 {
    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.stringField("threadId", thread_id);
    try appendThreadForkLikeFields(&params, options);
    return params.finish();
}

fn buildThreadListParamsJson(allocator: std.mem.Allocator, options: ThreadListOptions) ![]u8 {
    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.optionalBoolField("archived", options.archived);
    try params.optionalStringField("cursor", options.cursor);
    try params.optionalStringField("cwd", options.cwd);
    try params.optionalUsizeField("limit", options.limit);
    try params.optionalStringArrayField("modelProviders", options.model_providers);
    try params.optionalStringField("searchTerm", options.search_term);
    try params.optionalStringField("sortKey", options.sort_key);
    try params.optionalStringArrayField("sourceKinds", options.source_kinds);
    return params.finish();
}

fn buildThreadIdOnlyParamsJson(allocator: std.mem.Allocator, thread_id: []const u8) ![]u8 {
    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.stringField("threadId", thread_id);
    return params.finish();
}

fn buildThreadReadParamsJson(
    allocator: std.mem.Allocator,
    thread_id: []const u8,
    include_turns: bool,
) ![]u8 {
    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.stringField("threadId", thread_id);
    try params.boolField("includeTurns", include_turns);
    return params.finish();
}

fn buildThreadSetNameParamsJson(
    allocator: std.mem.Allocator,
    thread_id: []const u8,
    name: []const u8,
) ![]u8 {
    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.stringField("threadId", thread_id);
    try params.stringField("name", name);
    return params.finish();
}

fn buildTurnStartParamsJson(
    allocator: std.mem.Allocator,
    thread_id: []const u8,
    input: Input,
    options: TurnOptions,
) ![]u8 {
    const input_json = try buildInputJson(allocator, input);
    defer allocator.free(input_json);

    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.stringField("threadId", thread_id);
    try params.rawField("input", input_json);
    try appendTurnFields(&params, options);
    return params.finish();
}

fn buildTurnInterruptParamsJson(
    allocator: std.mem.Allocator,
    thread_id: []const u8,
    turn_id: []const u8,
) ![]u8 {
    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.stringField("threadId", thread_id);
    try params.stringField("turnId", turn_id);
    return params.finish();
}

fn buildTurnSteerParamsJson(
    allocator: std.mem.Allocator,
    thread_id: []const u8,
    turn_id: []const u8,
    input: Input,
) ![]u8 {
    const input_json = try buildInputJson(allocator, input);
    defer allocator.free(input_json);

    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.stringField("threadId", thread_id);
    try params.stringField("expectedTurnId", turn_id);
    try params.rawField("input", input_json);
    return params.finish();
}

fn buildModelListParamsJson(allocator: std.mem.Allocator, include_hidden: bool) ![]u8 {
    var params = try JsonObjectBuilder.init(allocator);
    defer params.deinit();
    try params.boolField("includeHidden", include_hidden);
    return params.finish();
}

fn buildInputJson(allocator: std.mem.Allocator, input: Input) ![]u8 {
    var buf: std.ArrayList(u8) = .empty;
    errdefer buf.deinit(allocator);

    try buf.append(allocator, '[');
    switch (input) {
        .text => |value| try appendWireInputItem(allocator, &buf, .{ .text = value }),
        .item => |value| try appendWireInputItem(allocator, &buf, value),
        .items => |items| {
            for (items, 0..) |item, index| {
                if (index > 0) try buf.append(allocator, ',');
                try appendWireInputItem(allocator, &buf, item);
            }
        },
    }
    try buf.append(allocator, ']');
    return try buf.toOwnedSlice(allocator);
}

fn appendWireInputItem(
    allocator: std.mem.Allocator,
    buf: *std.ArrayList(u8),
    item: InputItem,
) !void {
    try buf.append(allocator, '{');
    switch (item) {
        .text => |value| {
            try appendJsonKeyValueString(allocator, buf, true, "type", "text");
            try appendJsonKeyValueString(allocator, buf, false, "text", value);
        },
        .image => |value| {
            try appendJsonKeyValueString(allocator, buf, true, "type", "image");
            try appendJsonKeyValueString(allocator, buf, false, "url", value);
        },
        .local_image => |value| {
            try appendJsonKeyValueString(allocator, buf, true, "type", "localImage");
            try appendJsonKeyValueString(allocator, buf, false, "path", value);
        },
        .skill => |value| {
            try appendJsonKeyValueString(allocator, buf, true, "type", "skill");
            try appendJsonKeyValueString(allocator, buf, false, "name", value.name);
            try appendJsonKeyValueString(allocator, buf, false, "path", value.path);
        },
        .mention => |value| {
            try appendJsonKeyValueString(allocator, buf, true, "type", "mention");
            try appendJsonKeyValueString(allocator, buf, false, "name", value.name);
            try appendJsonKeyValueString(allocator, buf, false, "path", value.path);
        },
    }
    try buf.append(allocator, '}');
}

fn appendThreadStartLikeFields(builder: *JsonObjectBuilder, options: ThreadStartOptions) !void {
    try builder.optionalStringField("approvalPolicy", options.approval_policy);
    try builder.optionalStringField("approvalsReviewer", options.approvals_reviewer);
    try builder.optionalStringField("baseInstructions", options.base_instructions);
    try builder.optionalRawField("config", options.config_json);
    try builder.optionalStringField("cwd", options.cwd);
    try builder.optionalStringField("developerInstructions", options.developer_instructions);
    try builder.optionalBoolField("ephemeral", options.ephemeral);
    try builder.optionalStringField("model", options.model);
    try builder.optionalStringField("modelProvider", options.model_provider);
    try builder.optionalStringField("personality", options.personality);
    try builder.optionalStringField("sandbox", options.sandbox);
    try builder.optionalStringField("serviceName", options.service_name);
    try builder.optionalStringField("serviceTier", options.service_tier);
}

fn appendThreadResumeLikeFields(builder: *JsonObjectBuilder, options: ThreadResumeOptions) !void {
    try builder.optionalStringField("approvalPolicy", options.approval_policy);
    try builder.optionalStringField("approvalsReviewer", options.approvals_reviewer);
    try builder.optionalStringField("baseInstructions", options.base_instructions);
    try builder.optionalRawField("config", options.config_json);
    try builder.optionalStringField("cwd", options.cwd);
    try builder.optionalStringField("developerInstructions", options.developer_instructions);
    try builder.optionalStringField("model", options.model);
    try builder.optionalStringField("modelProvider", options.model_provider);
    try builder.optionalStringField("personality", options.personality);
    try builder.optionalStringField("sandbox", options.sandbox);
    try builder.optionalStringField("serviceTier", options.service_tier);
}

fn appendThreadForkLikeFields(builder: *JsonObjectBuilder, options: ThreadForkOptions) !void {
    try builder.optionalStringField("approvalPolicy", options.approval_policy);
    try builder.optionalStringField("approvalsReviewer", options.approvals_reviewer);
    try builder.optionalStringField("baseInstructions", options.base_instructions);
    try builder.optionalRawField("config", options.config_json);
    try builder.optionalStringField("cwd", options.cwd);
    try builder.optionalStringField("developerInstructions", options.developer_instructions);
    try builder.optionalBoolField("ephemeral", options.ephemeral);
    try builder.optionalStringField("model", options.model);
    try builder.optionalStringField("modelProvider", options.model_provider);
    try builder.optionalStringField("sandbox", options.sandbox);
    try builder.optionalStringField("serviceTier", options.service_tier);
}

fn appendTurnFields(builder: *JsonObjectBuilder, options: TurnOptions) !void {
    try builder.optionalStringField("approvalPolicy", options.approval_policy);
    try builder.optionalStringField("approvalsReviewer", options.approvals_reviewer);
    try builder.optionalStringField("cwd", options.cwd);
    try builder.optionalStringField("effort", options.effort);
    try builder.optionalStringField("model", options.model);
    try builder.optionalRawField("outputSchema", options.output_schema_json);
    try builder.optionalStringField("personality", options.personality);
    try builder.optionalRawField("sandboxPolicy", options.sandbox_policy_json);
    try builder.optionalStringField("serviceTier", options.service_tier);
    try builder.optionalStringField("summary", options.summary);
}

const JsonObjectBuilder = struct {
    allocator: std.mem.Allocator,
    buf: std.ArrayList(u8),
    first: bool = true,
    finished: bool = false,

    pub fn init(allocator: std.mem.Allocator) !JsonObjectBuilder {
        var buf: std.ArrayList(u8) = .empty;
        try buf.append(allocator, '{');
        return .{
            .allocator = allocator,
            .buf = buf,
        };
    }

    pub fn deinit(self: *JsonObjectBuilder) void {
        self.buf.deinit(self.allocator);
    }

    pub fn finish(self: *JsonObjectBuilder) ![]u8 {
        if (!self.finished) {
            self.finished = true;
            try self.buf.append(self.allocator, '}');
        }
        return try self.buf.toOwnedSlice(self.allocator);
    }

    pub fn stringField(self: *JsonObjectBuilder, name: []const u8, value: []const u8) !void {
        try self.prefix();
        try appendJsonString(self.allocator, &self.buf, name);
        try self.buf.append(self.allocator, ':');
        try appendJsonString(self.allocator, &self.buf, value);
    }

    pub fn optionalStringField(self: *JsonObjectBuilder, name: []const u8, value: ?[]const u8) !void {
        if (value) |unwrapped| try self.stringField(name, unwrapped);
    }

    pub fn boolField(self: *JsonObjectBuilder, name: []const u8, value: bool) !void {
        try self.prefix();
        try appendJsonString(self.allocator, &self.buf, name);
        try self.buf.append(self.allocator, ':');
        try self.buf.appendSlice(self.allocator, if (value) "true" else "false");
    }

    pub fn optionalBoolField(self: *JsonObjectBuilder, name: []const u8, value: ?bool) !void {
        if (value) |unwrapped| try self.boolField(name, unwrapped);
    }

    pub fn optionalUsizeField(self: *JsonObjectBuilder, name: []const u8, value: ?usize) !void {
        if (value) |unwrapped| {
            try self.prefix();
            try appendJsonString(self.allocator, &self.buf, name);
            try self.buf.append(self.allocator, ':');
            const text = try std.fmt.allocPrint(self.allocator, "{d}", .{unwrapped});
            defer self.allocator.free(text);
            try self.buf.appendSlice(self.allocator, text);
        }
    }

    pub fn rawField(self: *JsonObjectBuilder, name: []const u8, raw_json: []const u8) !void {
        try self.prefix();
        try appendJsonString(self.allocator, &self.buf, name);
        try self.buf.append(self.allocator, ':');
        try self.buf.appendSlice(self.allocator, raw_json);
    }

    pub fn optionalRawField(self: *JsonObjectBuilder, name: []const u8, raw_json: ?[]const u8) !void {
        if (raw_json) |unwrapped| try self.rawField(name, unwrapped);
    }

    pub fn optionalStringArrayField(
        self: *JsonObjectBuilder,
        name: []const u8,
        values: []const []const u8,
    ) !void {
        if (values.len == 0) return;
        try self.prefix();
        try appendJsonString(self.allocator, &self.buf, name);
        try self.buf.appendSlice(self.allocator, ":[");
        for (values, 0..) |value, index| {
            if (index > 0) try self.buf.append(self.allocator, ',');
            try appendJsonString(self.allocator, &self.buf, value);
        }
        try self.buf.append(self.allocator, ']');
    }

    fn prefix(self: *JsonObjectBuilder) !void {
        if (!self.first) {
            try self.buf.append(self.allocator, ',');
        } else {
            self.first = false;
        }
    }
};

fn appendFieldPrefix(
    allocator: std.mem.Allocator,
    buf: *std.ArrayList(u8),
    first: bool,
) !void {
    if (!first) try buf.append(allocator, ',');
}

fn appendJsonKeyValueString(
    allocator: std.mem.Allocator,
    buf: *std.ArrayList(u8),
    first: bool,
    key: []const u8,
    value: []const u8,
) !void {
    try appendFieldPrefix(allocator, buf, first);
    try appendJsonString(allocator, buf, key);
    try buf.append(allocator, ':');
    try appendJsonString(allocator, buf, value);
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
                const text = try std.fmt.bufPrint(&encoded, "\\u{x:0>4}", .{char});
                try buf.appendSlice(allocator, text);
            },
            else => try buf.append(allocator, char),
        }
    }
    try buf.append(allocator, '"');
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

fn getObjectString(obj: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    const value = obj.get(key) orelse return null;
    return asString(value);
}

fn getObjectInt(obj: std.json.ObjectMap, key: []const u8) ?i64 {
    const value = obj.get(key) orelse return null;
    return asInt(value);
}

fn asString(value: std.json.Value) ?[]const u8 {
    return switch (value) {
        .string => |text| text,
        else => null,
    };
}

fn asInt(value: std.json.Value) ?i64 {
    return switch (value) {
        .integer => |int_value| int_value,
        else => null,
    };
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

test "splitUserAgent parses slash format" {
    const split = splitUserAgent("codex-cli/0.116.0-alpha.1");
    try std.testing.expectEqualStrings("codex-cli", split.name.?);
    try std.testing.expectEqualStrings("0.116.0-alpha.1", split.version.?);
}

test "assistantTextFromItem handles agentMessage" {
    const alloc = std.testing.allocator;
    var parsed = try parseOwnedJson(alloc, "{\"type\":\"agentMessage\",\"text\":\"hello\",\"phase\":\"final_answer\"}");
    defer parsed.deinit();

    const text = try assistantTextFromItem(alloc, parsed.value);
    defer if (text) |value| alloc.free(value);

    try std.testing.expect(text != null);
    try std.testing.expectEqualStrings("hello", text.?);
}

test "buildInputJson emits local image wire shape" {
    const alloc = std.testing.allocator;
    const json = try buildInputJson(alloc, .{
        .items = &.{
            .{ .text = "caption" },
            .{ .local_image = "/tmp/example.png" },
        },
    });
    defer alloc.free(json);

    try std.testing.expect(std.mem.indexOf(u8, json, "\"type\":\"text\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"type\":\"localImage\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, json, "\"path\":\"/tmp/example.png\"") != null);
}
