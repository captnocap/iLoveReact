//! Unified worker bindings for V8.
//!
//! Five host fns expose worker_contract.WorkerStore + per-backend SDK
//! Sessions as one normalized agent surface to JS:
//!
//!   __worker_start(backend_name, opts_json)               → worker_id ("" on fail)
//!   __worker_send(worker_id, text)                        → bool
//!   __worker_poll(worker_id)                              → WorkerEvent[] | undefined
//!   __worker_respond(worker_id, request_id, payload_json) → bool
//!   __worker_close(worker_id)                             → void
//!
//! Each WorkerEvent on the JS side is the normalized Zig WorkerEvent
//! row, monotonically id'd. Poll returns events that arrived since
//! the last poll for that worker id.
//!
//! Phase 1 backends:
//!   - "claude_code"     — claude CLI subprocess via claude_sdk
//!   - "kimi_cli_wire"   — kimi --wire subprocess via kimi_wire_sdk
//!
//! "codex_app_server" is recognized but __worker_start returns "" until
//! its V8 bridge lands. local-runtime needs a Backend enum extension and
//! ingest function — handled in a follow-on phase.

const std = @import("std");
const host_io = @import("../host_io.zig");
const v8 = @import("v8");
const v8rt = @import("../v8_runtime.zig");

const worker_contract = @import("worker_contract.zig");
const claude_sdk = @import("claude_sdk/mod.zig");
const kimi_wire_sdk = @import("kimi_wire_sdk.zig");
const local_ai_runtime = @import("local_ai_runtime.zig");
const codex_sdk = @import("codex_sdk.zig");
const openai_compat_sdk = @import("openai_compat_sdk.zig");

const Backend = worker_contract.Backend;

// ── Codex session (threaded) ────────────────────────────────────────────
//
// Codex's app-server speaks JSON-RPC over stdio with no non-blocking
// poll path. To stay friendly to the JS event loop, each CodexSession
// owns a background thread that runs turn.next() while `__worker_poll`
// non-blocking-drains the resulting Notifications.

const CodexSession = struct {
    allocator: std.mem.Allocator,
    codex: codex_sdk.Codex,
    thread: codex_sdk.Thread,

    pending: std.ArrayList([]u8) = .empty,
    pending_mutex: host_io.Mutex = .{},
    pending_signal: std.Io.Event = .unset,

    inbox: std.ArrayList(codex_sdk.Notification) = .empty,
    inbox_mutex: host_io.Mutex = .{},

    worker: ?std.Thread = null,
    stop: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    pub fn destroy(self: *CodexSession) void {
        self.stop.store(true, .seq_cst);
        self.pending_signal.set(host_io.io());
        if (self.worker) |t| {
            t.join();
            self.worker = null;
        }

        self.pending_mutex.lock();
        for (self.pending.items) |item| self.allocator.free(item);
        self.pending.deinit(self.allocator);
        self.pending_mutex.unlock();

        self.inbox_mutex.lock();
        for (self.inbox.items) |*notification| notification.deinit();
        self.inbox.deinit(self.allocator);
        self.inbox_mutex.unlock();

        self.thread.deinit();
        self.codex.deinit();
        const allocator = self.allocator;
        allocator.destroy(self);
    }

    pub fn enqueue(self: *CodexSession, text: []const u8) !void {
        const dup = try self.allocator.dupe(u8, text);
        errdefer self.allocator.free(dup);
        self.pending_mutex.lock();
        defer self.pending_mutex.unlock();
        try self.pending.append(self.allocator, dup);
        self.pending_signal.set(host_io.io());
    }

    pub fn drainInbox(self: *CodexSession) ![]codex_sdk.Notification {
        self.inbox_mutex.lock();
        defer self.inbox_mutex.unlock();
        return self.inbox.toOwnedSlice(self.allocator);
    }

    fn workerEntry(self: *CodexSession) void {
        while (!self.stop.load(.seq_cst)) {
            self.pending_signal.waitUncancelable(host_io.io());
            self.pending_signal.reset();

            while (!self.stop.load(.seq_cst)) {
                self.pending_mutex.lock();
                const text_opt: ?[]u8 = if (self.pending.items.len > 0)
                    self.pending.orderedRemove(0)
                else
                    null;
                self.pending_mutex.unlock();

                const text = text_opt orelse break;
                defer self.allocator.free(text);

                var handle = self.thread.turn(.{ .text = text }, .{}) catch continue;
                defer handle.deinit();

                while (true) {
                    const maybe = handle.next() catch break;
                    var notif = maybe orelse break;
                    self.inbox_mutex.lock();
                    self.inbox.append(self.allocator, notif) catch {
                        notif.deinit();
                        self.inbox_mutex.unlock();
                        continue;
                    };
                    self.inbox_mutex.unlock();
                    if (handle.completed) break;
                }
            }
        }
    }
};

// ── Per-backend session container ───────────────────────────────────────

// ── Streaming-backend sessions (claude / kimi / local) ─────────────────
//
// Same shape across all three: a heap-allocated wrapper that owns the
// SDK Session plus a worker thread which drives init, send, and poll
// off the JS thread. JS-side __worker_start returns immediately;
// __worker_send pushes into a mutex'd queue; __worker_poll drains the
// mutex'd inbox of raw SDK messages and ingests each through the
// matching WorkerStore.ingest* fn on the JS thread.
//
// Codex uses its own variant (input-driven turn lifecycle); these three
// are continuous-stream backends.

const ClaudeSession = struct {
    allocator: std.mem.Allocator,
    inner: claude_sdk.Session,

    pending: std.ArrayList([]u8) = .empty,
    pending_mutex: host_io.Mutex = .{},

    inbox: std.ArrayList(claude_sdk.OwnedMessage) = .empty,
    inbox_mutex: host_io.Mutex = .{},

    worker: ?std.Thread = null,
    stop: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    pub fn destroy(self: *ClaudeSession) void {
        self.stop.store(true, .seq_cst);
        if (self.worker) |t| {
            t.join();
            self.worker = null;
        }
        self.pending_mutex.lock();
        for (self.pending.items) |p| self.allocator.free(p);
        self.pending.deinit(self.allocator);
        self.pending_mutex.unlock();
        self.inbox_mutex.lock();
        for (self.inbox.items) |*m| m.deinit();
        self.inbox.deinit(self.allocator);
        self.inbox_mutex.unlock();
        self.inner.close() catch {};
        self.inner.deinit();
        const allocator = self.allocator;
        allocator.destroy(self);
    }

    pub fn enqueue(self: *ClaudeSession, text: []const u8) !void {
        const dup = try self.allocator.dupe(u8, text);
        errdefer self.allocator.free(dup);
        self.pending_mutex.lock();
        defer self.pending_mutex.unlock();
        try self.pending.append(self.allocator, dup);
    }

    pub fn drainInbox(self: *ClaudeSession) ![]claude_sdk.OwnedMessage {
        self.inbox_mutex.lock();
        defer self.inbox_mutex.unlock();
        return self.inbox.toOwnedSlice(self.allocator);
    }

    fn workerEntry(self: *ClaudeSession) void {
        // claude_sdk.Session.init already spawns the CLI; no separate
        // initialize handshake. Start polling immediately.
        while (!self.stop.load(.seq_cst)) {
            var any = false;
            while (true) {
                const maybe = self.inner.poll() catch break;
                const owned = maybe orelse break;
                self.inbox_mutex.lock();
                self.inbox.append(self.allocator, owned) catch {
                    var o = owned;
                    o.deinit();
                };
                self.inbox_mutex.unlock();
                any = true;
            }
            self.pending_mutex.lock();
            const text_opt: ?[]u8 = if (self.pending.items.len > 0)
                self.pending.orderedRemove(0)
            else
                null;
            self.pending_mutex.unlock();
            if (text_opt) |text| {
                defer self.allocator.free(text);
                self.inner.send(text) catch {};
                any = true;
            }
            if (!any) host_io.sleep(2 * std.time.ns_per_ms);
        }
    }
};

const KimiSession = struct {
    allocator: std.mem.Allocator,
    inner: kimi_wire_sdk.Session,

    pending: std.ArrayList([]u8) = .empty,
    pending_mutex: host_io.Mutex = .{},

    inbox: std.ArrayList(kimi_wire_sdk.OwnedInbound) = .empty,
    inbox_mutex: host_io.Mutex = .{},

    worker: ?std.Thread = null,
    stop: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    pub fn destroy(self: *KimiSession) void {
        self.stop.store(true, .seq_cst);
        if (self.worker) |t| {
            t.join();
            self.worker = null;
        }
        self.pending_mutex.lock();
        for (self.pending.items) |p| self.allocator.free(p);
        self.pending.deinit(self.allocator);
        self.pending_mutex.unlock();
        self.inbox_mutex.lock();
        for (self.inbox.items) |*m| m.deinit();
        self.inbox.deinit(self.allocator);
        self.inbox_mutex.unlock();
        self.inner.close() catch {};
        self.inner.deinit();
        const allocator = self.allocator;
        allocator.destroy(self);
    }

    pub fn enqueue(self: *KimiSession, text: []const u8) !void {
        const dup = try self.allocator.dupe(u8, text);
        errdefer self.allocator.free(dup);
        self.pending_mutex.lock();
        defer self.pending_mutex.unlock();
        try self.pending.append(self.allocator, dup);
    }

    pub fn drainInbox(self: *KimiSession) ![]kimi_wire_sdk.OwnedInbound {
        self.inbox_mutex.lock();
        defer self.inbox_mutex.unlock();
        return self.inbox.toOwnedSlice(self.allocator);
    }

    fn workerEntry(self: *KimiSession) void {
        // kimi --wire requires an initialize handshake before any prompt.
        // Run it here so the JS thread isn't stuck waiting.
        var init_result = self.inner.initialize(.{}) catch {
            self.stop.store(true, .seq_cst);
            return;
        };
        init_result.deinit();

        while (!self.stop.load(.seq_cst)) {
            var any = false;
            while (true) {
                const maybe = self.inner.poll() catch break;
                const owned = maybe orelse break;
                self.inbox_mutex.lock();
                self.inbox.append(self.allocator, owned) catch {
                    var o = owned;
                    o.deinit();
                };
                self.inbox_mutex.unlock();
                any = true;
            }
            self.pending_mutex.lock();
            const text_opt: ?[]u8 = if (self.pending.items.len > 0)
                self.pending.orderedRemove(0)
            else
                null;
            self.pending_mutex.unlock();
            if (text_opt) |text| {
                defer self.allocator.free(text);
                var token = self.inner.prompt(.{ .text = text }) catch continue;
                token.deinit();
                any = true;
            }
            if (!any) host_io.sleep(2 * std.time.ns_per_ms);
        }
    }
};

const LocalAiSession = struct {
    allocator: std.mem.Allocator,
    inner: *local_ai_runtime.Session,

    pending: std.ArrayList([]u8) = .empty,
    pending_mutex: host_io.Mutex = .{},

    inbox: std.ArrayList(local_ai_runtime.OwnedEvent) = .empty,
    inbox_mutex: host_io.Mutex = .{},

    worker: ?std.Thread = null,
    stop: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    // Per-submit token cap. Pulled from worker_start opts JSON
    // (`max_tokens`) and reused for every text the JS side enqueues.
    // Defaults to the local_ai_runtime SubmitOptions default if the
    // caller doesn't supply one.
    max_tokens: u32 = 4096,

    pub fn destroy(self: *LocalAiSession) void {
        self.stop.store(true, .seq_cst);
        if (self.worker) |t| {
            t.join();
            self.worker = null;
        }
        self.pending_mutex.lock();
        for (self.pending.items) |p| self.allocator.free(p);
        self.pending.deinit(self.allocator);
        self.pending_mutex.unlock();
        self.inbox_mutex.lock();
        for (self.inbox.items) |*e| e.deinit();
        self.inbox.deinit(self.allocator);
        self.inbox_mutex.unlock();
        self.inner.close();
        self.inner.destroy();
        const allocator = self.allocator;
        allocator.destroy(self);
    }

    pub fn enqueue(self: *LocalAiSession, text: []const u8) !void {
        const dup = try self.allocator.dupe(u8, text);
        errdefer self.allocator.free(dup);
        self.pending_mutex.lock();
        defer self.pending_mutex.unlock();
        try self.pending.append(self.allocator, dup);
    }

    pub fn drainInbox(self: *LocalAiSession) ![]local_ai_runtime.OwnedEvent {
        self.inbox_mutex.lock();
        defer self.inbox_mutex.unlock();
        return self.inbox.toOwnedSlice(self.allocator);
    }

    fn workerEntry(self: *LocalAiSession) void {
        while (!self.stop.load(.seq_cst)) {
            var any = false;
            while (true) {
                const owned = self.inner.poll() orelse break;
                self.inbox_mutex.lock();
                self.inbox.append(self.allocator, owned) catch {
                    var o = owned;
                    o.deinit();
                };
                self.inbox_mutex.unlock();
                any = true;
            }
            self.pending_mutex.lock();
            const text_opt: ?[]u8 = if (self.pending.items.len > 0)
                self.pending.orderedRemove(0)
            else
                null;
            self.pending_mutex.unlock();
            if (text_opt) |text| {
                defer self.allocator.free(text);
                self.inner.submit(.{ .text = text, .max_tokens = self.max_tokens }) catch {};
                any = true;
            }
            if (!any) host_io.sleep(2 * std.time.ns_per_ms);
        }
    }
};

// HTTP-based — no persistent subprocess and no per-session worker thread.
// HTTP runs on net_http's worker pool; chunks are dispatched on the JS
// main thread by v8_bindings_sdk.tickDrain into our inner SDK's inbox.
// Both enqueue and drainInbox are main-thread only; no mutex needed.

const OpenAiSession = struct {
    allocator: std.mem.Allocator,
    inner: *openai_compat_sdk.Session,

    pub fn destroy(self: *OpenAiSession) void {
        self.inner.deinit();
        const allocator = self.allocator;
        allocator.destroy(self);
    }

    pub fn enqueue(self: *OpenAiSession, text: []const u8) !void {
        try self.inner.enqueue(text);
    }

    pub fn drainInbox(self: *OpenAiSession) ![]openai_compat_sdk.Event {
        return self.inner.drainInbox();
    }
};

const BackendSession = union(Backend) {
    claude_code: *ClaudeSession,
    codex_app_server: *CodexSession,
    kimi_cli_wire: *KimiSession,
    local_ai: *LocalAiSession,
    openai_compat: *OpenAiSession,

    pub fn deinit(self: *BackendSession) void {
        switch (self.*) {
            .claude_code => self.claude_code.destroy(),
            .codex_app_server => self.codex_app_server.destroy(),
            .kimi_cli_wire => self.kimi_cli_wire.destroy(),
            .local_ai => self.local_ai.destroy(),
            .openai_compat => self.openai_compat.destroy(),
        }
    }
};

// ── Worker registry ─────────────────────────────────────────────────────

const WorkerEntry = struct {
    id: []u8,
    backend: Backend,
    store: worker_contract.WorkerStore,
    session: BackendSession,
    last_emitted_event_id: u64 = 0,

    pub fn destroy(self: *WorkerEntry, allocator: std.mem.Allocator) void {
        self.session.deinit();
        self.store.deinit();
        allocator.free(self.id);
        allocator.destroy(self);
    }
};

var g_workers: ?std.StringHashMap(*WorkerEntry) = null;
var g_worker_seq: u64 = 0;

fn registry() *std.StringHashMap(*WorkerEntry) {
    if (g_workers == null) {
        g_workers = std.StringHashMap(*WorkerEntry).init(std.heap.c_allocator);
    }
    return &g_workers.?;
}

fn lookup(id: []const u8) ?*WorkerEntry {
    if (g_workers == null) return null;
    return g_workers.?.get(id);
}

// ── Backend name dispatch ───────────────────────────────────────────────

fn parseBackend(name: []const u8) ?Backend {
    if (std.mem.eql(u8, name, "claude_code")) return .claude_code;
    if (std.mem.eql(u8, name, "codex_app_server")) return .codex_app_server;
    if (std.mem.eql(u8, name, "kimi_cli_wire")) return .kimi_cli_wire;
    if (std.mem.eql(u8, name, "local_ai")) return .local_ai;
    if (std.mem.eql(u8, name, "openai_compat")) return .openai_compat;
    return null;
}

fn backendName(b: Backend) []const u8 {
    return switch (b) {
        .claude_code => "claude_code",
        .codex_app_server => "codex_app_server",
        .kimi_cli_wire => "kimi_cli_wire",
        .local_ai => "local_ai",
        .openai_compat => "openai_compat",
    };
}

// ── Tiny V8 helpers (mirrors v8_bindings_sdk.zig) ───────────────────────

fn callbackCtx(info: v8.FunctionCallbackInfo) struct { iso: v8.Isolate, ctx: v8.Context } {
    const iso = info.getIsolate();
    return .{ .iso = iso, .ctx = iso.getCurrentContext() };
}

fn setReturnUndefined(info: v8.FunctionCallbackInfo, iso: v8.Isolate) void {
    info.getReturnValue().set(v8.initUndefined(iso));
}

fn setReturnBool(info: v8.FunctionCallbackInfo, iso: v8.Isolate, val: bool) void {
    info.getReturnValue().set(v8.Boolean.init(iso, val));
}

fn setReturnString(info: v8.FunctionCallbackInfo, iso: v8.Isolate, text: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(iso, text));
}

fn jsStringArg(alloc: std.mem.Allocator, info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const cx = callbackCtx(info);
    const s = info.getArg(idx).toString(cx.ctx) catch return null;
    const len = s.lenUtf8(cx.iso);
    const buf = alloc.alloc(u8, len) catch return null;
    _ = s.writeUtf8(cx.iso, buf);
    return buf;
}

fn setStrProp(iso: v8.Isolate, ctx: v8.Context, obj: v8.Object, key: []const u8, val: []const u8) void {
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, key), v8.String.initUtf8(iso, val));
}

fn setNumProp(iso: v8.Isolate, ctx: v8.Context, obj: v8.Object, key: []const u8, val: f64) void {
    _ = obj.setValue(ctx, v8.String.initUtf8(iso, key), v8.Number.init(iso, val));
}

fn setIntProp(iso: v8.Isolate, ctx: v8.Context, obj: v8.Object, key: []const u8, val: i64) void {
    setNumProp(iso, ctx, obj, key, @floatFromInt(val));
}

// ── opts_json helpers ───────────────────────────────────────────────────

fn jsonStrField(value: std.json.Value, key: []const u8) ?[]const u8 {
    const obj = switch (value) {
        .object => |o| o,
        else => return null,
    };
    const v = obj.get(key) orelse return null;
    return switch (v) {
        .string => |s| if (s.len > 0) s else null,
        else => null,
    };
}

fn jsonBoolField(value: std.json.Value, key: []const u8) ?bool {
    const obj = switch (value) {
        .object => |o| o,
        else => return null,
    };
    const v = obj.get(key) orelse return null;
    return switch (v) {
        .bool => |b| b,
        else => null,
    };
}

fn jsonIntField(value: std.json.Value, key: []const u8) ?i64 {
    const obj = switch (value) {
        .object => |o| o,
        else => return null,
    };
    const v = obj.get(key) orelse return null;
    return switch (v) {
        .integer => |i| i,
        else => null,
    };
}

// ── WorkerEvent → JS object ─────────────────────────────────────────────

fn workerEventToJs(iso: v8.Isolate, ctx: v8.Context, ev: *const worker_contract.WorkerEvent) v8.Object {
    const obj = v8.Object.init(iso);
    setIntProp(iso, ctx, obj, "id", @intCast(ev.id));
    setStrProp(iso, ctx, obj, "worker_id", ev.worker_id);
    setStrProp(iso, ctx, obj, "session_id", ev.session_id);
    setStrProp(iso, ctx, obj, "backend", backendName(ev.backend));
    setStrProp(iso, ctx, obj, "kind", @tagName(ev.kind));
    if (ev.role) |r| setStrProp(iso, ctx, obj, "role", @tagName(r));
    if (ev.model) |v| setStrProp(iso, ctx, obj, "model", v);
    if (ev.phase) |v| setStrProp(iso, ctx, obj, "phase", v);
    if (ev.text) |v| setStrProp(iso, ctx, obj, "text", v);
    if (ev.payload_json) |v| setStrProp(iso, ctx, obj, "payload_json", v);
    if (ev.turn_id) |v| setStrProp(iso, ctx, obj, "turn_id", v);
    if (ev.thread_id) |v| setStrProp(iso, ctx, obj, "thread_id", v);
    if (ev.external_session_id) |v| setStrProp(iso, ctx, obj, "external_session_id", v);
    if (ev.status_text) |v| setStrProp(iso, ctx, obj, "status_text", v);
    if (ev.cost_usd_delta != 0) setNumProp(iso, ctx, obj, "cost_usd_delta", ev.cost_usd_delta);
    setIntProp(iso, ctx, obj, "created_at_ms", ev.created_at_ms);

    const u = ev.usage_delta;
    if (u.input_tokens > 0 or u.output_tokens > 0 or u.cache_creation_input_tokens > 0 or u.cache_read_input_tokens > 0) {
        const usage = v8.Object.init(iso);
        setIntProp(iso, ctx, usage, "input_tokens", @intCast(u.input_tokens));
        setIntProp(iso, ctx, usage, "output_tokens", @intCast(u.output_tokens));
        setIntProp(iso, ctx, usage, "cache_creation_input_tokens", @intCast(u.cache_creation_input_tokens));
        setIntProp(iso, ctx, usage, "cache_read_input_tokens", @intCast(u.cache_read_input_tokens));
        _ = obj.setValue(ctx, v8.String.initUtf8(iso, "usage"), usage.toValue());
    }
    return obj;
}

// ── Host fn: __worker_start ─────────────────────────────────────────────

fn hostWorkerStart(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 2) return setReturnString(info, cx.iso, "");

    const backend_name_arg = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnString(info, cx.iso, "");
    defer std.heap.page_allocator.free(backend_name_arg);
    const opts_json = jsStringArg(std.heap.page_allocator, info, 1) orelse return setReturnString(info, cx.iso, "");
    defer std.heap.page_allocator.free(opts_json);

    const backend = parseBackend(backend_name_arg) orelse return setReturnString(info, cx.iso, "");

    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const parsed = std.json.parseFromSlice(std.json.Value, arena.allocator(), opts_json, .{}) catch
        return setReturnString(info, cx.iso, "");

    const cwd_opt = jsonStrField(parsed.value, "cwd");
    const model = jsonStrField(parsed.value, "model");

    // ── local_ai hot-reload reuse ───────────────────────────────────────
    // V8 context resets on every cart hot-reload (framework/v8_runtime.zig
    // resetContextForReload). The React tree is rebuilt with a fresh
    // workerIdRef, so the cart calls __worker_start again — but the
    // worker registry is a Zig static and survives. Without this block,
    // every reload spawned a fresh rjit-llm-worker subprocess, leaving
    // the old one as an orphan zombie (parent never waitpid'd).
    //
    // Behavior: scan the registry for an existing local_ai entry. If
    // (model_path, n_ctx) match the new opts, reuse it: drain queued
    // events/sends, push RESET into the worker so chat history clears,
    // refresh tools_json + max_tokens, return its id. The model stays
    // loaded in RAM/VRAM. If a local_ai entry exists with DIFFERENT
    // opts (user picked a new model), evict it so we don't leak.
    if (backend == .local_ai) {
        const new_model_path = jsonStrField(parsed.value, "model_path") orelse return setReturnString(info, cx.iso, "");
        const new_n_ctx_raw = jsonIntField(parsed.value, "n_ctx") orelse 2048;
        const new_n_ctx: u32 = if (new_n_ctx_raw > 0) @intCast(new_n_ctx_raw) else 2048;

        if (g_workers) |*map| {
            var it = map.iterator();
            var stale_id_buf: ?[]const u8 = null;
            while (it.next()) |kv| {
                const e = kv.value_ptr.*;
                if (e.backend != .local_ai) continue;
                const inner = e.session.local_ai.inner;
                const same_model = std.mem.eql(u8, inner.options.model_path, new_model_path);
                const same_ctx = inner.options.n_ctx == new_n_ctx;
                if (same_model and same_ctx) {
                    // Reuse path: drain queues, refresh per-turn caps,
                    // refresh tools schema, send RESET, return existing id.
                    const ls = e.session.local_ai;

                    const new_max_tokens_raw = jsonIntField(parsed.value, "max_tokens") orelse 4096;
                    ls.max_tokens = if (new_max_tokens_raw > 0) @intCast(new_max_tokens_raw) else 4096;

                    ls.pending_mutex.lock();
                    for (ls.pending.items) |p| ls.allocator.free(p);
                    ls.pending.clearRetainingCapacity();
                    ls.pending_mutex.unlock();

                    ls.inbox_mutex.lock();
                    for (ls.inbox.items) |*ev| ev.deinit();
                    ls.inbox.clearRetainingCapacity();
                    ls.inbox_mutex.unlock();

                    // Drain any events the local_ai worker thread already
                    // pulled into the inner ring but hasn't surfaced yet.
                    while (inner.poll()) |evt| {
                        var owned = evt;
                        owned.deinit();
                    }

                    if (jsonStrField(parsed.value, "tools_json")) |tools_json| {
                        inner.setTools(tools_json) catch {};
                    }
                    inner.reset() catch {};

                    return setReturnString(info, cx.iso, e.id);
                }
                // Different opts → mark for eviction. Can't destroy mid-
                // iteration; remember the key and clean up after the loop.
                stale_id_buf = e.id;
            }
            if (stale_id_buf) |stale_id| {
                if (map.fetchRemove(stale_id)) |kv| {
                    kv.value.destroy(std.heap.c_allocator);
                }
            }
        }
    }

    var session: BackendSession = switch (backend) {
        .claude_code => blk: {
            const cwd = cwd_opt orelse return setReturnString(info, cx.iso, "");
            const opts = claude_sdk.SessionOptions{
                .cwd = cwd,
                .model = model,
                .resume_session = jsonStrField(parsed.value, "resume_session"),
                .config_dir = jsonStrField(parsed.value, "config_dir"),
                .verbose = true,
                .permission_mode = .bypass_permissions,
                .inherit_stderr = true,
            };
            const inner = claude_sdk.Session.init(std.heap.c_allocator, opts) catch
                return setReturnString(info, cx.iso, "");
            const cs = std.heap.c_allocator.create(ClaudeSession) catch {
                var s = inner;
                s.close() catch {};
                s.deinit();
                return setReturnString(info, cx.iso, "");
            };
            cs.* = .{ .allocator = std.heap.c_allocator, .inner = inner };
            cs.worker = std.Thread.spawn(.{}, ClaudeSession.workerEntry, .{cs}) catch {
                cs.destroy();
                return setReturnString(info, cx.iso, "");
            };
            break :blk .{ .claude_code = cs };
        },
        .kimi_cli_wire => blk: {
            const cwd = cwd_opt orelse return setReturnString(info, cx.iso, "");
            const k_opts = kimi_wire_sdk.SessionOptions{
                .cwd = cwd,
                .model = model,
                .session_id = jsonStrField(parsed.value, "session_id"),
                .yolo = jsonBoolField(parsed.value, "yolo") orelse true,
                .inherit_stderr = true,
            };
            const inner = kimi_wire_sdk.Session.init(std.heap.c_allocator, k_opts) catch
                return setReturnString(info, cx.iso, "");
            const ks = std.heap.c_allocator.create(KimiSession) catch {
                var s = inner;
                s.close() catch {};
                s.deinit();
                return setReturnString(info, cx.iso, "");
            };
            ks.* = .{ .allocator = std.heap.c_allocator, .inner = inner };
            ks.worker = std.Thread.spawn(.{}, KimiSession.workerEntry, .{ks}) catch {
                ks.destroy();
                return setReturnString(info, cx.iso, "");
            };
            break :blk .{ .kimi_cli_wire = ks };
        },
        .codex_app_server => blk: {
            const cs = std.heap.c_allocator.create(CodexSession) catch
                return setReturnString(info, cx.iso, "");
            cs.* = .{
                .allocator = std.heap.c_allocator,
                .codex = codex_sdk.Codex.init(std.heap.c_allocator, .{ .cwd = cwd_opt }) catch {
                    std.heap.c_allocator.destroy(cs);
                    return setReturnString(info, cx.iso, "");
                },
                .thread = undefined,
            };
            cs.thread = cs.codex.threadStart(.{
                .cwd = cwd_opt,
                .model = model,
            }) catch {
                cs.codex.deinit();
                std.heap.c_allocator.destroy(cs);
                return setReturnString(info, cx.iso, "");
            };
            cs.worker = std.Thread.spawn(.{}, CodexSession.workerEntry, .{cs}) catch {
                cs.thread.deinit();
                cs.codex.deinit();
                std.heap.c_allocator.destroy(cs);
                return setReturnString(info, cx.iso, "");
            };
            break :blk .{ .codex_app_server = cs };
        },
        .local_ai => blk: {
            const model_path = jsonStrField(parsed.value, "model_path") orelse return setReturnString(info, cx.iso, "");
            const n_ctx_raw = jsonIntField(parsed.value, "n_ctx") orelse 2048;
            const n_ctx: u32 = if (n_ctx_raw > 0) @intCast(n_ctx_raw) else 2048;
            const max_tokens_raw = jsonIntField(parsed.value, "max_tokens") orelse 4096;
            const max_tokens: u32 = if (max_tokens_raw > 0) @intCast(max_tokens_raw) else 4096;
            const opts = local_ai_runtime.SessionOptions{
                .cwd = cwd_opt,
                .model_path = model_path,
                .session_id = jsonStrField(parsed.value, "session_id"),
                .n_ctx = n_ctx,
                .verbose = false,
            };
            const inner = local_ai_runtime.Session.create(std.heap.c_allocator, opts) catch
                return setReturnString(info, cx.iso, "");
            const ls = std.heap.c_allocator.create(LocalAiSession) catch {
                inner.close();
                inner.destroy();
                return setReturnString(info, cx.iso, "");
            };
            ls.* = .{ .allocator = std.heap.c_allocator, .inner = inner, .max_tokens = max_tokens };
            // local_ai_runtime takes tools via setTools (not init opts);
            // forward it here so the schema is in place before the
            // worker thread sends its first CHAT.
            if (jsonStrField(parsed.value, "tools_json")) |tools_json| {
                inner.setTools(tools_json) catch {};
            }
            ls.worker = std.Thread.spawn(.{}, LocalAiSession.workerEntry, .{ls}) catch {
                ls.destroy();
                return setReturnString(info, cx.iso, "");
            };
            break :blk .{ .local_ai = ls };
        },
        .openai_compat => blk: {
            const base_url = jsonStrField(parsed.value, "base_url") orelse return setReturnString(info, cx.iso, "");
            const model_id = model orelse return setReturnString(info, cx.iso, "");
            const api_key = jsonStrField(parsed.value, "api_key");
            const system_prompt = jsonStrField(parsed.value, "system_prompt");
            const tools_json = jsonStrField(parsed.value, "tools_json");
            // session_id rides through as the OpenAI `user` field — the
            // claudewrap bridge reads it as a thread's resume key (claude's
            // sid), so one chat thread keeps the same claude process.
            const user_field = jsonStrField(parsed.value, "session_id");
            const inner = openai_compat_sdk.Session.init(std.heap.c_allocator, .{
                .base_url = base_url,
                .api_key = api_key,
                .model = model_id,
                .system_prompt = system_prompt,
                .tools_json = tools_json,
                .user = user_field,
            }) catch return setReturnString(info, cx.iso, "");
            const os = std.heap.c_allocator.create(OpenAiSession) catch {
                inner.deinit();
                return setReturnString(info, cx.iso, "");
            };
            os.* = .{ .allocator = std.heap.c_allocator, .inner = inner };
            break :blk .{ .openai_compat = os };
        },
    };

    const allocator = std.heap.c_allocator;
    g_worker_seq += 1;
    const id = std.fmt.allocPrint(allocator, "worker_{d}", .{g_worker_seq}) catch {
        session.deinit();
        return setReturnString(info, cx.iso, "");
    };

    var store = worker_contract.WorkerStore.init(allocator, .{ .worker_id = id }) catch {
        allocator.free(id);
        session.deinit();
        return setReturnString(info, cx.iso, "");
    };

    _ = store.beginSession(.{
        .backend = backend,
        .model = model,
        .reason_started = "worker started via __worker_start",
    }) catch {
        store.deinit();
        allocator.free(id);
        session.deinit();
        return setReturnString(info, cx.iso, "");
    };

    const entry = allocator.create(WorkerEntry) catch {
        store.deinit();
        allocator.free(id);
        session.deinit();
        return setReturnString(info, cx.iso, "");
    };
    entry.* = .{
        .id = id,
        .backend = backend,
        .store = store,
        .session = session,
    };

    registry().put(id, entry) catch {
        entry.destroy(allocator);
        return setReturnString(info, cx.iso, "");
    };

    setReturnString(info, cx.iso, id);
}

// ── Host fn: __worker_send ──────────────────────────────────────────────

fn hostWorkerSend(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 2) return setReturnBool(info, cx.iso, false);

    const id = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnBool(info, cx.iso, false);
    defer std.heap.page_allocator.free(id);
    const text = jsStringArg(std.heap.page_allocator, info, 1) orelse return setReturnBool(info, cx.iso, false);
    defer std.heap.page_allocator.free(text);

    const entry = lookup(id) orelse return setReturnBool(info, cx.iso, false);

    switch (entry.session) {
        .claude_code => entry.session.claude_code.enqueue(text) catch return setReturnBool(info, cx.iso, false),
        .kimi_cli_wire => entry.session.kimi_cli_wire.enqueue(text) catch return setReturnBool(info, cx.iso, false),
        .local_ai => entry.session.local_ai.enqueue(text) catch return setReturnBool(info, cx.iso, false),
        .codex_app_server => entry.session.codex_app_server.enqueue(text) catch return setReturnBool(info, cx.iso, false),
        .openai_compat => entry.session.openai_compat.enqueue(text) catch return setReturnBool(info, cx.iso, false),
    }
    setReturnBool(info, cx.iso, true);
}

// ── Host fn: __worker_poll ──────────────────────────────────────────────

fn hostWorkerPoll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 1) return setReturnUndefined(info, cx.iso);

    const id = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(id);

    const entry = lookup(id) orelse return setReturnUndefined(info, cx.iso);

    // Drain the worker thread's inbox into the WorkerStore. The worker
    // thread populates the inbox from its SDK in the background; we
    // dispatch on the JS thread so each ingest fn can use the store
    // without locking it.
    switch (entry.session) {
        .claude_code => {
            if (entry.session.claude_code.drainInbox()) |drained| {
                defer std.heap.c_allocator.free(drained);
                for (drained) |item| {
                    var owned = item;
                    entry.store.ingestClaudeMessage(owned.msg) catch {};
                    owned.deinit();
                }
            } else |_| {}
        },
        .kimi_cli_wire => {
            if (entry.session.kimi_cli_wire.drainInbox()) |drained| {
                defer std.heap.c_allocator.free(drained);
                for (drained) |item| {
                    var owned = item;
                    entry.store.ingestKimiWireMessage(&owned.msg) catch {};
                    owned.deinit();
                }
            } else |_| {}
        },
        .local_ai => {
            if (entry.session.local_ai.drainInbox()) |drained| {
                defer std.heap.c_allocator.free(drained);
                for (drained) |item| {
                    var owned = item;
                    entry.store.ingestLocalAiEvent(&owned) catch {};
                    owned.deinit();
                }
            } else |_| {}
        },
        .codex_app_server => {
            if (entry.session.codex_app_server.drainInbox()) |drained| {
                defer std.heap.c_allocator.free(drained);
                for (drained) |notification| {
                    var n = notification;
                    entry.store.ingestCodexNotification(&n) catch {};
                    n.deinit();
                }
            } else |_| {}
        },
        .openai_compat => {
            if (entry.session.openai_compat.drainInbox()) |drained| {
                defer std.heap.c_allocator.free(drained);
                for (drained) |item| {
                    var ev = item;
                    entry.store.ingestOpenAiEvent(&ev) catch {};
                    ev.deinit();
                }
            } else |_| {}
        },
    }

    const events = entry.store.events.items;
    var first: usize = events.len;
    for (events, 0..) |ev, i| {
        if (ev.id > entry.last_emitted_event_id) {
            first = i;
            break;
        }
    }

    const new_count: u32 = if (first < events.len) @intCast(events.len - first) else 0;
    const arr = v8.Array.init(cx.iso, new_count);
    if (new_count > 0) {
        var out_idx: u32 = 0;
        var i = first;
        while (i < events.len) : (i += 1) {
            const obj = workerEventToJs(cx.iso, cx.ctx, &events[i]);
            _ = arr.castTo(v8.Object).setValueAtIndex(cx.ctx, out_idx, obj.toValue());
            out_idx += 1;
            entry.last_emitted_event_id = events[i].id;
        }
    }
    info.getReturnValue().set(arr.castTo(v8.Object).toValue());
}

// ── Host fn: __worker_respond ───────────────────────────────────────────
//
// __worker_respond(worker_id, request_id, payload_json)
//
// For tool_call replies on local_ai and openai_compat, request_id is a
// tool_call_id and payload_json is the result content. Other reply
// shapes (Kimi approval/question/hook, Codex approvals) ride here too
// once those backends grow respond paths.

fn hostWorkerRespond(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 3) return setReturnBool(info, cx.iso, false);

    const id = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnBool(info, cx.iso, false);
    defer std.heap.page_allocator.free(id);
    const request_id = jsStringArg(std.heap.page_allocator, info, 1) orelse return setReturnBool(info, cx.iso, false);
    defer std.heap.page_allocator.free(request_id);
    const payload = jsStringArg(std.heap.page_allocator, info, 2) orelse return setReturnBool(info, cx.iso, false);
    defer std.heap.page_allocator.free(payload);

    const entry = lookup(id) orelse return setReturnBool(info, cx.iso, false);
    switch (entry.session) {
        .local_ai => {
            entry.session.local_ai.inner.submitToolReply(request_id, payload) catch return setReturnBool(info, cx.iso, false);
            return setReturnBool(info, cx.iso, true);
        },
        .openai_compat => {
            entry.session.openai_compat.inner.submitToolResult(request_id, payload) catch return setReturnBool(info, cx.iso, false);
            return setReturnBool(info, cx.iso, true);
        },
        else => return setReturnBool(info, cx.iso, false),
    }
}

// __worker_set_tools(worker_id, tools_json)
//
// Pushes a tools schema (JSON array string) onto the worker's session.
// local_ai routes to local_ai_runtime.Session.setTools (sent as a TOOLS
// message before the next CHAT). openai_compat stores it on the SDK
// Session so it rides every chat-completions request body.
fn hostWorkerSetTools(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 2) return setReturnBool(info, cx.iso, false);

    const id = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnBool(info, cx.iso, false);
    defer std.heap.page_allocator.free(id);
    const tools_json = jsStringArg(std.heap.page_allocator, info, 1) orelse return setReturnBool(info, cx.iso, false);
    defer std.heap.page_allocator.free(tools_json);

    const entry = lookup(id) orelse return setReturnBool(info, cx.iso, false);
    switch (entry.session) {
        .local_ai => {
            entry.session.local_ai.inner.setTools(tools_json) catch return setReturnBool(info, cx.iso, false);
            return setReturnBool(info, cx.iso, true);
        },
        .openai_compat => {
            entry.session.openai_compat.inner.setTools(tools_json) catch return setReturnBool(info, cx.iso, false);
            return setReturnBool(info, cx.iso, true);
        },
        else => return setReturnBool(info, cx.iso, false),
    }
}

// ── Host fn: __worker_close ─────────────────────────────────────────────

fn hostWorkerClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const cx = callbackCtx(info);
    if (info.length() < 1) return setReturnUndefined(info, cx.iso);

    const id = jsStringArg(std.heap.page_allocator, info, 0) orelse return setReturnUndefined(info, cx.iso);
    defer std.heap.page_allocator.free(id);

    const entry = lookup(id) orelse return setReturnUndefined(info, cx.iso);

    entry.store.endActiveSession(.ended, "worker closed via __worker_close") catch {};

    if (g_workers) |*map| {
        _ = map.remove(id);
    }
    entry.destroy(std.heap.c_allocator);

    setReturnUndefined(info, cx.iso);
}

// ── Registration ────────────────────────────────────────────────────────

pub fn register() void {
    v8rt.registerHostFn("__worker_start", hostWorkerStart);
    v8rt.registerHostFn("__worker_send", hostWorkerSend);
    v8rt.registerHostFn("__worker_poll", hostWorkerPoll);
    v8rt.registerHostFn("__worker_respond", hostWorkerRespond);
    v8rt.registerHostFn("__worker_set_tools", hostWorkerSetTools);
    v8rt.registerHostFn("__worker_close", hostWorkerClose);
}
