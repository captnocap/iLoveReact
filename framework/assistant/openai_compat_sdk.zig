//! OpenAI Chat-Completions compatible SDK for Zig.
//!
//! Speaks `POST {base_url}/chat/completions` with `stream: true`,
//! parses the SSE response, and emits per-token delta events plus a
//! terminal completion event. Same shape covers OpenAI proper, OpenRouter,
//! LMStudio, Ollama (the openai-compat endpoint), and any provider that
//! mirrors the chat completions wire format.
//!
//! HTTP transport is the framework's net_http worker pool — same path
//! the JS-facing __http_stream_open hook uses. Streaming chunks fire on
//! the main thread via v8_bindings_sdk.tickDrain → our HttpZigCallbacks.
//!
//! There is no SDK-side worker thread. Session.enqueue records a pending
//! input; if no request is in flight, it kicks one off immediately;
//! otherwise it queues until the current turn completes.
//!
//! Tool calling: pass a `tools_json` array on init (or via setTools); the
//! SDK includes it in every request body. When the model emits tool_calls
//! (finish_reason="tool_calls"), the session accumulates them, emits a
//! tool_call Event per call, then PAUSES — waiting for the host to call
//! submitToolResult for each id. Once all results land, the session
//! folds the assistant tool_calls + tool results into history and fires
//! a continuation request automatically. The cart only has to: receive
//! tool_call events, run the tool, push the result back via
//! submitToolResult.

const std = @import("std");
const net_http = @import("../net/http.zig");
const v8_bindings_sdk = @import("../v8_bindings_sdk.zig");

pub const SessionOptions = struct {
    /// Base URL minus the path — e.g. "http://localhost:1234/v1" or
    /// "https://api.openai.com/v1". The SDK appends "/chat/completions".
    base_url: []const u8,
    /// Bearer token. Set null for unauthenticated local endpoints.
    api_key: ?[]const u8 = null,
    /// Model id passed in the request body.
    model: []const u8,
    /// Optional initial system prompt.
    system_prompt: ?[]const u8 = null,
    /// Optional tools schema as a JSON array string —
    /// `[{"type":"function","function":{"name","description","parameters":{...}}}]`.
    /// When set, included in every request body so the model can call tools.
    tools_json: ?[]const u8 = null,
    /// OpenAI `user` field, sent verbatim in every request body. The
    /// claudewrap bridge uses it as a thread's resume key (claude's sid),
    /// so the same claude process keeps serving one chat thread.
    user: ?[]const u8 = null,
};

pub const EventKind = enum { delta, tool_call, completion, error_ };

pub const Event = struct {
    allocator: std.mem.Allocator,
    kind: EventKind,
    text: ?[]u8 = null,
    is_error: bool = false,
    // tool_call extras
    tool_call_id: ?[]u8 = null,
    tool_call_name: ?[]u8 = null,
    tool_call_args: ?[]u8 = null,
    // completion extra: the backend's session id (claudewrap bridge sets
    // `external_session_id` on the response = claude's sid). Surfaced to
    // JS so a chat thread can persist + resume it.
    external_session_id: ?[]u8 = null,

    pub fn deinit(self: *Event) void {
        if (self.text) |t| self.allocator.free(t);
        if (self.tool_call_id) |v| self.allocator.free(v);
        if (self.tool_call_name) |v| self.allocator.free(v);
        if (self.tool_call_args) |v| self.allocator.free(v);
        if (self.external_session_id) |v| self.allocator.free(v);
        self.text = null;
        self.tool_call_id = null;
        self.tool_call_name = null;
        self.tool_call_args = null;
        self.external_session_id = null;
    }
};

const Message = struct {
    role: []u8,
    content: []u8,
    /// Assistant turns whose response was tool_calls — raw JSON array
    /// string of `[{"id","type":"function","function":{"name","arguments"}}, …]`.
    /// Serialized verbatim into the message body alongside `content`.
    tool_calls_json: ?[]u8 = null,
    /// Tool turns: ties this message to the matching assistant tool_call.
    tool_call_id: ?[]u8 = null,

    fn deinitAll(self: *Message, allocator: std.mem.Allocator) void {
        allocator.free(self.role);
        allocator.free(self.content);
        if (self.tool_calls_json) |v| allocator.free(v);
        if (self.tool_call_id) |v| allocator.free(v);
    }
};

/// Tool calls that arrive across multiple SSE chunks — id/name come in the
/// first delta with that index, arguments stream as fragments.
const PartialToolCall = struct {
    index: u32,
    id: std.ArrayList(u8) = .empty,
    name: std.ArrayList(u8) = .empty,
    arguments: std.ArrayList(u8) = .empty,

    fn deinit(self: *PartialToolCall, allocator: std.mem.Allocator) void {
        self.id.deinit(allocator);
        self.name.deinit(allocator);
        self.arguments.deinit(allocator);
    }
};

pub const Session = struct {
    allocator: std.mem.Allocator,
    base_url_owned: []u8,
    api_key_owned: ?[]u8 = null,
    model_owned: []u8,
    auth_header: ?[]u8 = null,
    url_owned: []u8,
    tools_json_owned: ?[]u8 = null,
    user_owned: ?[]u8 = null,
    /// Last `external_session_id` seen on a response chunk — attached to
    /// the completion event so the host learns claude's sid.
    external_session_id_owned: ?[]u8 = null,

    messages: std.ArrayList(Message) = .empty,

    /// Pending user texts queued behind in-flight or awaiting-tools turns.
    pending: std.ArrayList([]u8) = .empty,
    /// True between request kickoff and the terminal complete/err event.
    in_flight: bool = false,
    /// SSE line-accumulating buffer used by the chunk callback.
    sse_buffer: std.ArrayList(u8) = .empty,
    sse_offset: usize = 0,
    /// Accumulated assistant text for the current turn.
    pending_assistant: std.ArrayList(u8) = .empty,
    /// Tool calls being assembled from streaming deltas (one per index).
    partial_tool_calls: std.ArrayList(PartialToolCall) = .empty,
    /// Outstanding tool calls awaiting submitToolResult — id → null
    /// before result arrives, id → owned content after.
    awaiting_tool_results: std.StringHashMapUnmanaged(?[]u8) = .{},
    /// Captured assistant message (with tool_calls JSON) staged until
    /// all tool results arrive. Then folded into messages + a continuation
    /// request fires automatically.
    staged_assistant_role: ?[]u8 = null,
    staged_assistant_content: ?[]u8 = null,
    staged_assistant_tool_calls: ?[]u8 = null,
    /// Outbound event queue drained by the host after each tick.
    inbox: std.ArrayList(Event) = .empty,
    /// Body buffer for the in-flight request — must outlive the request.
    body_owned: ?[]u8 = null,

    pub fn init(allocator: std.mem.Allocator, options: SessionOptions) !*Session {
        const self = try allocator.create(Session);
        self.* = .{
            .allocator = allocator,
            .base_url_owned = try allocator.dupe(u8, options.base_url),
            .api_key_owned = if (options.api_key) |k| try allocator.dupe(u8, k) else null,
            .model_owned = try allocator.dupe(u8, options.model),
            .auth_header = blk: {
                if (options.api_key) |k| {
                    break :blk try std.fmt.allocPrint(allocator, "Bearer {s}", .{k});
                }
                break :blk null;
            },
            .url_owned = try std.fmt.allocPrint(allocator, "{s}/chat/completions", .{options.base_url}),
            .tools_json_owned = if (options.tools_json) |t| try allocator.dupe(u8, t) else null,
            .user_owned = if (options.user) |u| try allocator.dupe(u8, u) else null,
        };
        if (options.system_prompt) |sys| {
            try self.messages.append(allocator, .{
                .role = try allocator.dupe(u8, "system"),
                .content = try allocator.dupe(u8, sys),
            });
        }
        return self;
    }

    pub fn deinit(self: *Session) void {
        for (self.messages.items) |*m| m.deinitAll(self.allocator);
        self.messages.deinit(self.allocator);
        for (self.pending.items) |p| self.allocator.free(p);
        self.pending.deinit(self.allocator);
        self.sse_buffer.deinit(self.allocator);
        self.pending_assistant.deinit(self.allocator);
        for (self.partial_tool_calls.items) |*p| p.deinit(self.allocator);
        self.partial_tool_calls.deinit(self.allocator);
        self.clearAwaiting();
        self.awaiting_tool_results.deinit(self.allocator);
        self.clearStaged();
        for (self.inbox.items) |*e| e.deinit();
        self.inbox.deinit(self.allocator);
        if (self.body_owned) |b| self.allocator.free(b);
        self.allocator.free(self.base_url_owned);
        if (self.api_key_owned) |k| self.allocator.free(k);
        self.allocator.free(self.model_owned);
        if (self.auth_header) |a| self.allocator.free(a);
        self.allocator.free(self.url_owned);
        if (self.tools_json_owned) |t| self.allocator.free(t);
        if (self.user_owned) |u| self.allocator.free(u);
        if (self.external_session_id_owned) |v| self.allocator.free(v);
        self.allocator.destroy(self);
    }

    /// Replace the tools schema. Takes effect on the next request.
    pub fn setTools(self: *Session, tools_json: []const u8) !void {
        const dup = try self.allocator.dupe(u8, tools_json);
        if (self.tools_json_owned) |old| self.allocator.free(old);
        self.tools_json_owned = dup;
    }

    pub fn enqueue(self: *Session, text: []const u8) !void {
        const dup = try self.allocator.dupe(u8, text);
        errdefer self.allocator.free(dup);
        if (self.in_flight or self.awaiting_tool_results.count() > 0) {
            try self.pending.append(self.allocator, dup);
            return;
        }
        try self.appendUserMessage(dup);
        try self.submitRequest();
    }

    /// Cart calls this after running a tool that the model requested.
    /// When all outstanding tool_call_ids have results, the session
    /// auto-fires a continuation request.
    pub fn submitToolResult(self: *Session, tool_call_id: []const u8, content: []const u8) !void {
        const entry = self.awaiting_tool_results.getEntry(tool_call_id) orelse return error.UnknownToolCallId;
        if (entry.value_ptr.*) |old| self.allocator.free(old);
        entry.value_ptr.* = try self.allocator.dupe(u8, content);

        // Have we collected results for every outstanding call?
        var it = self.awaiting_tool_results.iterator();
        while (it.next()) |kv| {
            if (kv.value_ptr.* == null) return; // still waiting on others
        }

        // All in. Append staged assistant + tool messages, fire continuation.
        try self.flushAwaiting();
        try self.submitRequest();
    }

    pub fn drainInbox(self: *Session) ![]Event {
        return self.inbox.toOwnedSlice(self.allocator);
    }

    fn appendUserMessage(self: *Session, text: []u8) !void {
        try self.messages.append(self.allocator, .{
            .role = try self.allocator.dupe(u8, "user"),
            .content = text,
        });
    }

    fn submitRequest(self: *Session) !void {
        self.pending_assistant.clearRetainingCapacity();
        self.sse_buffer.clearRetainingCapacity();
        self.sse_offset = 0;
        for (self.partial_tool_calls.items) |*p| p.deinit(self.allocator);
        self.partial_tool_calls.clearRetainingCapacity();

        if (self.body_owned) |old| {
            self.allocator.free(old);
            self.body_owned = null;
        }
        const body = try buildRequestBodyJson(
            self.allocator,
            self.model_owned,
            self.messages.items,
            self.tools_json_owned,
            self.user_owned,
        );
        self.body_owned = body;

        var headers: [3][2][]const u8 = undefined;
        var nh: usize = 0;
        headers[nh] = .{ "Content-Type", "application/json" };
        nh += 1;
        headers[nh] = .{ "Accept", "text/event-stream" };
        nh += 1;
        if (self.auth_header) |auth| {
            headers[nh] = .{ "Authorization", auth };
            nh += 1;
        }

        const opts = net_http.RequestOpts{
            .url = self.url_owned,
            .method = .POST,
            .headers = headers[0..nh],
            .body = body,
            .stream = true,
        };

        const callbacks = v8_bindings_sdk.HttpZigCallbacks{
            .onChunk = onChunkCb,
            .onEnd = onEndCb,
            .ctx = @ptrCast(self),
        };

        if (v8_bindings_sdk.httpStartZigStream(opts, callbacks) == null) {
            self.allocator.free(body);
            self.body_owned = null;
            try self.emitErrorString("net_http.request failed to start");
            return;
        }
        self.in_flight = true;
    }

    fn handleChunk(self: *Session, data: []const u8) void {
        self.sse_buffer.appendSlice(self.allocator, data) catch return;
        while (true) {
            const newline_idx = std.mem.indexOfScalarPos(u8, self.sse_buffer.items, self.sse_offset, '\n') orelse return;
            const raw = self.sse_buffer.items[self.sse_offset..newline_idx];
            const line = std.mem.trimRight(u8, raw, "\r");
            self.sse_offset = newline_idx + 1;

            if (!std.mem.startsWith(u8, line, "data: ")) continue;
            const payload = line[6..];
            if (std.mem.eql(u8, payload, "[DONE]")) continue;

            self.handleSseChunk(payload);
        }
    }

    fn handleSseChunk(self: *Session, json_str: []const u8) void {
        var parsed = std.json.parseFromSlice(std.json.Value, self.allocator, json_str, .{}) catch return;
        defer parsed.deinit();
        const root = parsed.value;
        if (root != .object) return;
        // Backend session id (claudewrap bridge → claude's sid). Remember
        // the latest non-empty value; attached to the completion event.
        if (root.object.get("external_session_id")) |esid| if (esid == .string and esid.string.len > 0) {
            const dup = self.allocator.dupe(u8, esid.string) catch null;
            if (dup) |d| {
                if (self.external_session_id_owned) |old| self.allocator.free(old);
                self.external_session_id_owned = d;
            }
        };
        const choices_val = root.object.get("choices") orelse return;
        if (choices_val != .array or choices_val.array.items.len == 0) return;
        const choice = choices_val.array.items[0];
        if (choice != .object) return;

        if (choice.object.get("delta")) |delta_val| if (delta_val == .object) {
            // Text content delta — same as before.
            if (delta_val.object.get("content")) |content_val| if (content_val == .string and content_val.string.len > 0) {
                const dup = self.allocator.dupe(u8, content_val.string) catch return;
                self.pending_assistant.appendSlice(self.allocator, dup) catch {
                    self.allocator.free(dup);
                    return;
                };
                self.pushEvent(.{
                    .allocator = self.allocator,
                    .kind = .delta,
                    .text = dup,
                }) catch {
                    self.allocator.free(dup);
                };
            };
            // Tool-call deltas — accumulate per-index.
            if (delta_val.object.get("tool_calls")) |tcs_val| if (tcs_val == .array) {
                for (tcs_val.array.items) |tc| if (tc == .object) {
                    self.absorbToolCallDelta(tc.object) catch return;
                };
            };
        };
    }

    fn absorbToolCallDelta(self: *Session, obj: std.json.ObjectMap) !void {
        const idx_val = obj.get("index") orelse return;
        const idx: u32 = switch (idx_val) {
            .integer => |i| @intCast(@max(i, 0)),
            else => return,
        };

        // Find or create the partial entry for this index.
        var partial: *PartialToolCall = blk: {
            for (self.partial_tool_calls.items) |*p| {
                if (p.index == idx) break :blk p;
            }
            try self.partial_tool_calls.append(self.allocator, .{ .index = idx });
            break :blk &self.partial_tool_calls.items[self.partial_tool_calls.items.len - 1];
        };

        if (obj.get("id")) |v| if (v == .string) {
            try partial.id.appendSlice(self.allocator, v.string);
        };
        if (obj.get("function")) |fn_val| if (fn_val == .object) {
            if (fn_val.object.get("name")) |v| if (v == .string) {
                try partial.name.appendSlice(self.allocator, v.string);
            };
            if (fn_val.object.get("arguments")) |v| if (v == .string) {
                try partial.arguments.appendSlice(self.allocator, v.string);
            };
        };
    }

    fn handleEnd(self: *Session, status: u16, err: ?[]const u8) void {
        if (self.body_owned) |b| {
            self.allocator.free(b);
            self.body_owned = null;
        }
        self.in_flight = false;

        if (err) |msg| {
            self.popLastUserMessageIfAny();
            self.emitErrorString(msg) catch {};
            self.kickNextPending();
            return;
        }
        if (status >= 400) {
            self.popLastUserMessageIfAny();
            const summary = std.fmt.allocPrint(self.allocator, "http {d}", .{status}) catch null;
            if (summary) |s| {
                self.emitErrorString(s) catch {};
                self.allocator.free(s);
            }
            self.kickNextPending();
            return;
        }

        // Did the model emit tool calls? If yes, stage them and pause.
        if (self.partial_tool_calls.items.len > 0) {
            self.beginToolCallTurn() catch {
                self.emitErrorString("failed to stage tool calls") catch {};
            };
            return;
        }

        // No tool calls — normal completion. Capture assistant reply, emit completion.
        if (self.pending_assistant.items.len > 0) {
            const owned = self.pending_assistant.toOwnedSlice(self.allocator) catch null;
            if (owned) |c| {
                self.messages.append(self.allocator, .{
                    .role = self.allocator.dupe(u8, "assistant") catch "",
                    .content = c,
                }) catch {
                    self.allocator.free(c);
                };
            }
        }
        const esid: ?[]u8 = if (self.external_session_id_owned) |v|
            (self.allocator.dupe(u8, v) catch null)
        else
            null;
        self.pushEvent(.{ .allocator = self.allocator, .kind = .completion, .external_session_id = esid }) catch {
            if (esid) |e| self.allocator.free(e);
        };
        self.kickNextPending();
    }

    fn beginToolCallTurn(self: *Session) !void {
        // Build the tool_calls JSON array from partials.
        var tcs_buf: std.ArrayList(u8) = .empty;
        defer tcs_buf.deinit(self.allocator);
        try tcs_buf.append(self.allocator, '[');
        for (self.partial_tool_calls.items, 0..) |p, i| {
            if (i > 0) try tcs_buf.append(self.allocator, ',');
            try tcs_buf.appendSlice(self.allocator, "{\"id\":");
            try jsonEscape(self.allocator, &tcs_buf, p.id.items);
            try tcs_buf.appendSlice(self.allocator, ",\"type\":\"function\",\"function\":{\"name\":");
            try jsonEscape(self.allocator, &tcs_buf, p.name.items);
            try tcs_buf.appendSlice(self.allocator, ",\"arguments\":");
            try jsonEscape(self.allocator, &tcs_buf, p.arguments.items);
            try tcs_buf.appendSlice(self.allocator, "}}");
        }
        try tcs_buf.append(self.allocator, ']');

        // Stage the assistant message (text + tool_calls); we'll fold it
        // into history after all tool results arrive.
        self.clearStaged();
        self.staged_assistant_role = try self.allocator.dupe(u8, "assistant");
        self.staged_assistant_content = try self.pending_assistant.toOwnedSlice(self.allocator);
        self.staged_assistant_tool_calls = try tcs_buf.toOwnedSlice(self.allocator);

        // Track outstanding tool call ids and emit one tool_call event each.
        for (self.partial_tool_calls.items) |p| {
            const id_dup = try self.allocator.dupe(u8, p.id.items);
            try self.awaiting_tool_results.put(self.allocator, id_dup, null);
            const name_dup = try self.allocator.dupe(u8, p.name.items);
            const args_dup = try self.allocator.dupe(u8, p.arguments.items);
            try self.pushEvent(.{
                .allocator = self.allocator,
                .kind = .tool_call,
                .tool_call_id = try self.allocator.dupe(u8, p.id.items),
                .tool_call_name = name_dup,
                .tool_call_args = args_dup,
            });
        }
    }

    fn flushAwaiting(self: *Session) !void {
        // Append the staged assistant message (if it had any content/tool_calls).
        if (self.staged_assistant_role) |role| {
            try self.messages.append(self.allocator, .{
                .role = role,
                .content = self.staged_assistant_content orelse try self.allocator.dupe(u8, ""),
                .tool_calls_json = self.staged_assistant_tool_calls,
            });
            self.staged_assistant_role = null;
            self.staged_assistant_content = null;
            self.staged_assistant_tool_calls = null;
        }

        // Append one tool message per result, in iteration order. (Order
        // doesn't matter to the API as long as each tool_call_id is matched.)
        var it = self.awaiting_tool_results.iterator();
        while (it.next()) |kv| {
            const id_owned = kv.key_ptr.*; // map keys are owned
            const content = kv.value_ptr.* orelse continue;
            try self.messages.append(self.allocator, .{
                .role = try self.allocator.dupe(u8, "tool"),
                .content = content, // ownership transfers
                .tool_call_id = try self.allocator.dupe(u8, id_owned),
            });
            kv.value_ptr.* = null; // prevent double free in clearAwaiting
        }
        self.clearAwaiting();
    }

    fn clearAwaiting(self: *Session) void {
        var it = self.awaiting_tool_results.iterator();
        while (it.next()) |kv| {
            self.allocator.free(kv.key_ptr.*);
            if (kv.value_ptr.*) |v| self.allocator.free(v);
        }
        self.awaiting_tool_results.clearRetainingCapacity();
    }

    fn clearStaged(self: *Session) void {
        if (self.staged_assistant_role) |v| self.allocator.free(v);
        if (self.staged_assistant_content) |v| self.allocator.free(v);
        if (self.staged_assistant_tool_calls) |v| self.allocator.free(v);
        self.staged_assistant_role = null;
        self.staged_assistant_content = null;
        self.staged_assistant_tool_calls = null;
    }

    fn kickNextPending(self: *Session) void {
        if (self.pending.items.len == 0) return;
        const next = self.pending.orderedRemove(0);
        self.appendUserMessage(next) catch {
            self.allocator.free(next);
            return;
        };
        self.submitRequest() catch |e| {
            self.emitErrorString(@errorName(e)) catch {};
        };
    }

    fn popLastUserMessageIfAny(self: *Session) void {
        if (self.messages.items.len == 0) return;
        const last = &self.messages.items[self.messages.items.len - 1];
        if (!std.mem.eql(u8, last.role, "user")) return;
        var popped = self.messages.pop() orelse return;
        popped.deinitAll(self.allocator);
    }

    fn pushEvent(self: *Session, ev: Event) !void {
        try self.inbox.append(self.allocator, ev);
    }

    fn emitErrorString(self: *Session, msg: []const u8) !void {
        const dup = try self.allocator.dupe(u8, msg);
        try self.pushEvent(.{
            .allocator = self.allocator,
            .kind = .error_,
            .text = dup,
            .is_error = true,
        });
    }
};

fn onChunkCb(ctx: *anyopaque, data: []const u8) void {
    const sess: *Session = @ptrCast(@alignCast(ctx));
    sess.handleChunk(data);
}

fn onEndCb(ctx: *anyopaque, status: u16, err: ?[]const u8) void {
    const sess: *Session = @ptrCast(@alignCast(ctx));
    sess.handleEnd(status, err);
}

fn buildRequestBodyJson(
    allocator: std.mem.Allocator,
    model: []const u8,
    messages: []const Message,
    tools_json: ?[]const u8,
    user: ?[]const u8,
) ![]u8 {
    var buf: std.ArrayList(u8) = .empty;
    errdefer buf.deinit(allocator);
    try buf.appendSlice(allocator, "{\"model\":");
    try jsonEscape(allocator, &buf, model);
    try buf.appendSlice(allocator, ",\"stream\":true,\"messages\":[");
    for (messages, 0..) |msg, i| {
        if (i > 0) try buf.append(allocator, ',');
        try buf.appendSlice(allocator, "{\"role\":");
        try jsonEscape(allocator, &buf, msg.role);
        try buf.appendSlice(allocator, ",\"content\":");
        try jsonEscape(allocator, &buf, msg.content);
        if (msg.tool_calls_json) |tcs| {
            try buf.appendSlice(allocator, ",\"tool_calls\":");
            try buf.appendSlice(allocator, tcs);
        }
        if (msg.tool_call_id) |tcid| {
            try buf.appendSlice(allocator, ",\"tool_call_id\":");
            try jsonEscape(allocator, &buf, tcid);
        }
        try buf.append(allocator, '}');
    }
    try buf.append(allocator, ']');
    if (tools_json) |tools| {
        try buf.appendSlice(allocator, ",\"tools\":");
        try buf.appendSlice(allocator, tools);
    }
    if (user) |u| {
        try buf.appendSlice(allocator, ",\"user\":");
        try jsonEscape(allocator, &buf, u);
    }
    try buf.append(allocator, '}');
    return try buf.toOwnedSlice(allocator);
}

fn jsonEscape(allocator: std.mem.Allocator, buf: *std.ArrayList(u8), s: []const u8) !void {
    try buf.append(allocator, '"');
    for (s) |ch| switch (ch) {
        '"' => try buf.appendSlice(allocator, "\\\""),
        '\\' => try buf.appendSlice(allocator, "\\\\"),
        '\n' => try buf.appendSlice(allocator, "\\n"),
        '\r' => try buf.appendSlice(allocator, "\\r"),
        '\t' => try buf.appendSlice(allocator, "\\t"),
        0x00...0x08, 0x0b...0x0c, 0x0e...0x1f => {
            var enc: [6]u8 = undefined;
            const slice = try std.fmt.bufPrint(&enc, "\\u{x:0>4}", .{ch});
            try buf.appendSlice(allocator, slice);
        },
        else => try buf.append(allocator, ch),
    };
    try buf.append(allocator, '"');
}
