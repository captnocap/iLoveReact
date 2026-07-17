//! Local AI runtime — subprocess-based llama.cpp inference service.
//!
//! Architecture (post-rewrite):
//!   - Each Session spawns one `rjit-llm-worker` child process (built
//!     from framework/ffi/llm_worker.cpp against the bundled libllama).
//!   - The worker owns its own VkInstance for ggml-vulkan inference,
//!     so renderer wgpu/Vulkan never fights with llama's compute path.
//!   - We talk to it over stdin/stdout in a tiny line-delimited
//!     protocol (LOAD/CHAT/READY/TOK/DONE/ERR — see llm_worker.cpp).
//!   - The Session's worker thread translates between the host-side
//!     request queue / event ring and the subprocess pipes.
//!
//! Public API (SessionOptions, SubmitOptions, EventKind, OwnedEvent,
//! Session) is consumed by framework/assistant/worker_contract.zig and
//! framework/assistant/worker_bindings.zig — the unified __worker_*
//! host fns surface this backend to carts via useAssistant({ backend:
//! 'local_ai', modelPath, nCtx, maxTokens, ... }).
//!
//! Worker binary lookup order:
//!   1. RJIT_LLM_WORKER env var (absolute path) — dev override
//!   2. <exe_dir>/rjit-llm-worker — bundled next to cart binary
//!   3. <exe_dir>/../lib/rjit-llm-worker — self-extracting cart layout
//!   4. zig-out/bin/rjit-llm-worker — repo dev fallback

const std = @import("std");
const host_io = @import("../host_io.zig");
const log = @import("../diag/log.zig");
const RingBuffer = @import("../net/ring_buffer.zig").RingBuffer;

pub const SessionOptions = struct {
    cwd: ?[]const u8 = null,
    model_path: []const u8,
    session_id: ?[]const u8 = null,
    system_prompt: ?[]const u8 = null,
    n_ctx: u32 = 2048,
    n_batch: u32 = 512,
    n_ubatch: u32 = 256,
    n_threads: i32 = 4,
    n_threads_batch: i32 = 4,
    n_gpu_layers: i32 = 99,
    max_history_messages: usize = 24,
    verbose: bool = true,
};

pub const TaskKind = enum { chat };

pub const SubmitOptions = struct {
    text: []const u8,
    task: TaskKind = .chat,
    system_prompt: ?[]const u8 = null,
    // Default cap on generated tokens per turn. The previous 256 was a
    // conservative seed value that silently truncated every chat reply
    // mid-sentence; 4096 lets a normal response (and a model that
    // "thinks" before answering) finish without bumping into the cap.
    // Callers can still override per-submit.
    max_tokens: u32 = 4096,
};

pub const EventKind = enum {
    system,
    assistant_part,
    status,
    result,
    tool_call,
};

pub const OwnedEvent = struct {
    allocator: std.mem.Allocator = undefined,
    kind: EventKind,
    text: ?[]u8 = null,
    model: ?[]u8 = null,
    session_id: ?[]u8 = null,
    part_type: ?[]const u8 = null,
    is_error: bool = false,
    // tool_call extras (only populated for kind == .tool_call)
    tool_call_id: ?[]u8 = null,
    tool_call_name: ?[]u8 = null,
    tool_call_args: ?[]u8 = null,

    pub fn deinit(self: *OwnedEvent) void {
        if (self.text) |value| self.allocator.free(value);
        if (self.model) |value| self.allocator.free(value);
        if (self.session_id) |value| self.allocator.free(value);
        if (self.tool_call_id) |value| self.allocator.free(value);
        if (self.tool_call_name) |value| self.allocator.free(value);
        if (self.tool_call_args) |value| self.allocator.free(value);
    }
};

const Request = struct {
    text: []u8,
    task: TaskKind,
    system_prompt: ?[]u8,
    max_tokens: u32,

    fn deinit(self: *Request, allocator: std.mem.Allocator) void {
        allocator.free(self.text);
        if (self.system_prompt) |value| allocator.free(value);
    }
};

const ToolReply = struct {
    id: []u8,
    body: []u8,

    fn deinit(self: *ToolReply, allocator: std.mem.Allocator) void {
        allocator.free(self.id);
        allocator.free(self.body);
    }
};

pub const Session = struct {
    allocator: std.mem.Allocator,
    options: SessionOptions,
    requests: RingBuffer(Request, 32) = .{},
    events: RingBuffer(OwnedEvent, 1024) = .{},
    tool_replies: RingBuffer(ToolReply, 16) = .{},
    worker: ?std.Thread = null,
    should_stop: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    // Pending tools schema to send to worker before next CHAT.
    // Mutex-protected so set_tools from JS thread doesn't race the worker
    // thread reading + clearing it.
    tools_mutex: std.Thread.Mutex = .{},
    tools_json: ?[]u8 = null, // owned, freed when consumed or session destroyed
    tools_dirty: bool = false, // true after setTools, false after worker sends

    // Hot-reload reuse: when the cart re-mounts (V8 context reset wiped
    // the React tree), we keep the loaded model alive and just clear the
    // worker subprocess's chat history. JS calls reset(); the worker
    // thread sees this flag at the top of its main loop, sends "RESET\n"
    // to the subprocess, and waits for the "READY" ack.
    reset_pending: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    pub fn create(allocator: std.mem.Allocator, options: SessionOptions) !*Session {
        const session = try allocator.create(Session);
        errdefer allocator.destroy(session);

        session.* = .{
            .allocator = allocator,
            .options = .{
                .cwd = if (options.cwd) |value| try allocator.dupe(u8, value) else null,
                .model_path = try allocator.dupe(u8, options.model_path),
                .session_id = if (options.session_id) |value| try allocator.dupe(u8, value) else null,
                .system_prompt = if (options.system_prompt) |value| try allocator.dupe(u8, value) else null,
                .n_ctx = options.n_ctx,
                .n_batch = options.n_batch,
                .n_ubatch = options.n_ubatch,
                .n_threads = options.n_threads,
                .n_threads_batch = options.n_threads_batch,
                .n_gpu_layers = options.n_gpu_layers,
                .max_history_messages = options.max_history_messages,
                .verbose = options.verbose,
            },
        };
        errdefer session.deinitInternal();

        session.worker = try std.Thread.spawn(.{ .stack_size = 4 * 1024 * 1024 }, workerMain, .{session});
        return session;
    }

    pub fn destroy(self: *Session) void {
        self.close();
        self.deinitInternal();
        self.allocator.destroy(self);
    }

    pub fn close(self: *Session) void {
        self.should_stop.store(true, .seq_cst);
        if (self.worker) |thread| {
            thread.join();
            self.worker = null;
        }
    }

    pub fn submit(self: *Session, options: SubmitOptions) !void {
        if (self.should_stop.load(.seq_cst)) return error.SessionClosed;

        var req = Request{
            .text = try self.allocator.dupe(u8, options.text),
            .task = options.task,
            .system_prompt = if (options.system_prompt) |value| try self.allocator.dupe(u8, value) else null,
            .max_tokens = options.max_tokens,
        };
        errdefer req.deinit(self.allocator);

        if (!self.requests.push(req)) return error.QueueFull;
    }

    /// Replace the pending tools schema. Worker will send TOOLS to the
    /// subprocess before its next CHAT. Empty string clears.
    pub fn setTools(self: *Session, tools_json: []const u8) !void {
        if (self.should_stop.load(.seq_cst)) return error.SessionClosed;
        const owned = try self.allocator.dupe(u8, tools_json);
        self.tools_mutex.lock();
        defer self.tools_mutex.unlock();
        if (self.tools_json) |old| self.allocator.free(old);
        self.tools_json = owned;
        self.tools_dirty = true;
    }

    /// Queue a chat-history reset. Worker thread sends "RESET\n" to the
    /// subprocess at the top of its next loop iteration; the model
    /// (weights, KV cache allocation, GPU layers) stays loaded — only
    /// the conversation buffer is cleared. Cheap to call, idempotent.
    pub fn reset(self: *Session) !void {
        if (self.should_stop.load(.seq_cst)) return error.SessionClosed;
        self.reset_pending.store(true, .seq_cst);
    }

    /// Push a tool-execution result into the worker's mid-CHAT reply queue.
    /// Called by JS after it executes the handler for a tool_call event.
    pub fn submitToolReply(self: *Session, id: []const u8, body: []const u8) !void {
        if (self.should_stop.load(.seq_cst)) return error.SessionClosed;
        var reply = ToolReply{
            .id = try self.allocator.dupe(u8, id),
            .body = try self.allocator.dupe(u8, body),
        };
        errdefer reply.deinit(self.allocator);
        if (!self.tool_replies.push(reply)) return error.QueueFull;
    }

    pub fn poll(self: *Session) ?OwnedEvent {
        return self.events.pop();
    }

    fn pushAssistantPart(self: *Session, text: []const u8) !void {
        try self.pushEvent(.{
            .kind = .assistant_part,
            .text = try self.allocator.dupe(u8, text),
            .part_type = "text",
        });
    }

    fn pushSystem(self: *Session, model: []const u8, session_id: []const u8) !void {
        try self.pushEvent(.{
            .kind = .system,
            .model = try self.allocator.dupe(u8, model),
            .session_id = try self.allocator.dupe(u8, session_id),
        });
    }

    fn pushToolCall(self: *Session, id: []const u8, name: []const u8, args: []const u8) !void {
        try self.pushEvent(.{
            .kind = .tool_call,
            .tool_call_id = try self.allocator.dupe(u8, id),
            .tool_call_name = try self.allocator.dupe(u8, name),
            .tool_call_args = try self.allocator.dupe(u8, args),
        });
    }

    fn pushStatus(self: *Session, text: []const u8, is_error: bool) !void {
        try self.pushEvent(.{
            .kind = .status,
            .text = try self.allocator.dupe(u8, text),
            .is_error = is_error,
        });
    }

    fn pushResult(self: *Session, text: ?[]const u8, is_error: bool) !void {
        try self.pushEvent(.{
            .kind = .result,
            .text = if (text) |value| try self.allocator.dupe(u8, value) else null,
            .is_error = is_error,
        });
    }

    fn pushEvent(self: *Session, event: OwnedEvent) !void {
        var owned = event;
        owned.allocator = self.allocator;
        if (!self.events.push(owned)) {
            owned.deinit();
            return error.EventQueueFull;
        }
    }

    fn deinitInternal(self: *Session) void {
        if (self.options.cwd) |value| self.allocator.free(value);
        self.allocator.free(self.options.model_path);
        if (self.options.session_id) |value| self.allocator.free(value);
        if (self.options.system_prompt) |value| self.allocator.free(value);

        while (self.requests.pop()) |item| {
            var req = item;
            req.deinit(self.allocator);
        }
        while (self.events.pop()) |item| {
            var evt = item;
            evt.deinit();
        }
        while (self.tool_replies.pop()) |item| {
            var reply = item;
            reply.deinit(self.allocator);
        }
        if (self.tools_json) |t| self.allocator.free(t);
    }
};

// ── worker binary path resolution ────────────────────────────────────

fn resolveWorkerPathAlloc(allocator: std.mem.Allocator) ![]u8 {
    if (host_io.getEnvVarOwned(allocator, "RJIT_LLM_WORKER")) |p| {
        return p;
    } else |_| {}

    const exe_path = try std.fs.selfExePathAlloc(allocator);
    defer allocator.free(exe_path);
    const exe_dir = std.fs.path.dirname(exe_path) orelse return error.NoExeDir;

    const candidates = [_][]const u8{
        "rjit-llm-worker",
        "../lib/rjit-llm-worker",
    };

    for (candidates) |rel| {
        const path = try std.fs.path.join(allocator, &.{ exe_dir, rel });
        if (std.fs.cwd().access(path, .{})) |_| return path else |_| allocator.free(path);
    }

    // Repo dev fallback.
    const dev_path = "/home/siah/creative/reactjit/zig-out/bin/rjit-llm-worker";
    if (std.fs.cwd().access(dev_path, .{})) |_| return allocator.dupe(u8, dev_path) else |_| {}

    return error.WorkerBinaryNotFound;
}

// ── stdout reader: line-buffered stream from child process ───────────

const LineReader = struct {
    file: std.fs.File,
    buf: [16 * 1024]u8 = undefined,
    head: usize = 0, // start of next unread byte
    tail: usize = 0, // one past last buffered byte
    eof: bool = false,

    /// Read one line (without trailing \n). Returns null on EOF / error.
    /// Caller does NOT own the returned slice — it points into self.buf
    /// and is invalidated by the next call.
    ///
    /// PRIOR-BUG NOTE: a previous version shifted the buffer down BEFORE
    /// returning the slice, so the returned bytes were always the NEXT
    /// line's content (off-by-one tokenization). Only visible when the
    /// caller examined the slice contents (prefix checks against
    /// "TOOL_CALL " etc); TOK piece extraction silently produced
    /// wrong-but-similar text. Now uses head/tail indices and only
    /// compacts when the buffer fills, keeping the returned slice valid
    /// until the next call.
    fn next(self: *LineReader) ?[]const u8 {
        while (true) {
            // Look for newline in unread region
            var i: usize = self.head;
            while (i < self.tail) : (i += 1) {
                if (self.buf[i] == '\n') {
                    const line = self.buf[self.head..i];
                    self.head = i + 1;
                    return line;
                }
            }

            if (self.eof) {
                if (self.head < self.tail) {
                    const line = self.buf[self.head..self.tail];
                    self.head = self.tail;
                    return line;
                }
                return null;
            }

            // No newline yet — make room to read more.
            if (self.tail == self.buf.len) {
                if (self.head == 0) {
                    // Buffer full with no newline → surface as truncated line.
                    const line = self.buf[0..self.tail];
                    self.head = self.tail;
                    return line;
                }
                // Compact unread region to start of buffer. This
                // invalidates any previously-returned slice, but the
                // contract says it's only valid until the next call —
                // which is what we are.
                const remaining = self.tail - self.head;
                std.mem.copyForwards(u8, self.buf[0..remaining], self.buf[self.head..self.tail]);
                self.head = 0;
                self.tail = remaining;
            }

            const read = self.file.read(self.buf[self.tail..]) catch {
                self.eof = true;
                continue;
            };
            if (read == 0) {
                self.eof = true;
                continue;
            }
            self.tail += read;
        }
    }
};

// ── escape protocol ─────────────────────────────────────────────────

/// Reverse the worker's escape: \n → LF, \\ → \, otherwise pass through.
fn unescapePieceAlloc(allocator: std.mem.Allocator, piece: []const u8) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(allocator);
    var i: usize = 0;
    while (i < piece.len) : (i += 1) {
        if (piece[i] == '\\' and i + 1 < piece.len) {
            const nxt = piece[i + 1];
            if (nxt == 'n') {
                try out.append(allocator, '\n');
                i += 1;
                continue;
            }
            if (nxt == '\\') {
                try out.append(allocator, '\\');
                i += 1;
                continue;
            }
        }
        try out.append(allocator, piece[i]);
    }
    return try out.toOwnedSlice(allocator);
}

// ── worker thread main ──────────────────────────────────────────────

fn workerMain(session: *Session) void {
    workerMainInner(session) catch |err| {
        const msg = std.fmt.allocPrint(session.allocator, "worker fatal: {s}", .{@errorName(err)}) catch return;
        defer session.allocator.free(msg);
        session.pushStatus(msg, true) catch {};
        session.pushResult(msg, true) catch {};
    };
}

fn workerMainInner(session: *Session) !void {
    const worker_path = resolveWorkerPathAlloc(session.allocator) catch |err| {
        const msg = try std.fmt.allocPrint(session.allocator, "worker binary missing: {s}", .{@errorName(err)});
        defer session.allocator.free(msg);
        try session.pushStatus(msg, true);
        try session.pushResult(msg, true);
        return;
    };
    defer session.allocator.free(worker_path);

    try session.pushStatus("spawning local inference worker...", false);

    var argv = [_][]const u8{worker_path};
    var child = std.process.Child.init(&argv, session.allocator);
    child.stdin_behavior = .Pipe;
    child.stdout_behavior = .Pipe;
    child.stderr_behavior = .Inherit;

    // Build LD_LIBRARY_PATH so the worker finds libllama.so + ggml
    // siblings. In a shipped cart they're bundled in the same lib/
    // dir as the cart's libs (next to the worker). In dev they live
    // under deps/llama.cpp-fresh/build/bin. We prepend both, then
    // anything already on LD_LIBRARY_PATH.
    var env_map = std.process.getEnvMap(session.allocator) catch std.process.EnvMap.init(session.allocator);
    defer env_map.deinit();

    var ld_paths: std.ArrayList(u8) = .empty;
    defer ld_paths.deinit(session.allocator);

    const worker_dir = std.fs.path.dirname(worker_path) orelse worker_path;
    const sibling_lib = try std.fs.path.join(session.allocator, &.{ worker_dir, "lib" });
    defer session.allocator.free(sibling_lib);
    try ld_paths.appendSlice(session.allocator, sibling_lib);

    // Dev fallback (the cmake build output).
    const dev_lib = "/home/siah/creative/reactjit/deps/llama.cpp-fresh/build/bin";
    if (std.fs.cwd().access(dev_lib, .{})) |_| {
        try ld_paths.append(session.allocator, ':');
        try ld_paths.appendSlice(session.allocator, dev_lib);
    } else |_| {}

    if (env_map.get("LD_LIBRARY_PATH")) |existing| {
        if (existing.len > 0) {
            try ld_paths.append(session.allocator, ':');
            try ld_paths.appendSlice(session.allocator, existing);
        }
    }
    env_map.put("LD_LIBRARY_PATH", ld_paths.items) catch {};
    child.env_map = &env_map;

    child.spawn() catch |err| {
        const msg = try std.fmt.allocPrint(session.allocator, "spawn {s} failed: {s}", .{ worker_path, @errorName(err) });
        defer session.allocator.free(msg);
        try session.pushStatus(msg, true);
        try session.pushResult(msg, true);
        return;
    };
    defer {
        _ = child.kill() catch {};
    }

    const stdin_file = child.stdin orelse return error.NoStdin;
    const stdout_file = child.stdout orelse return error.NoStdout;
    var reader = LineReader{ .file = stdout_file };

    // Send LOAD with absolute path
    const resolved_path = try resolveModelPathAlloc(session.allocator, session.options.cwd, session.options.model_path);
    defer session.allocator.free(resolved_path);

    {
        // Protocol: LOAD <n_ctx> <abs_path>. Worker parses n_ctx as the
        // max context window (KV cache size). Without this the worker
        // would hardcode 4096 and the first multi-turn chat would hit
        // "context exceeded" — even though the user's GPU can handle
        // much more. Backward-compat: worker falls back to 4096 if no
        // numeric prefix is present.
        const cmd = try std.fmt.allocPrint(session.allocator, "LOAD {d} {s}\n", .{ session.options.n_ctx, resolved_path });
        defer session.allocator.free(cmd);
        try stdin_file.writeAll(cmd);
    }

    try session.pushStatus("loading model into VRAM...", false);

    // Wait for READY
    while (true) {
        const line = reader.next() orelse {
            try session.pushStatus("worker EOF before READY", true);
            try session.pushResult("worker EOF before READY", true);
            return;
        };
        if (std.mem.eql(u8, line, "READY")) break;
        if (std.mem.startsWith(u8, line, "ERR ")) {
            const e = line[4..];
            try session.pushStatus(e, true);
            try session.pushResult(e, true);
            return;
        }
        // Ignore other lines (TOK before READY shouldn't happen)
    }

    const sid = session.options.session_id orelse "local";
    try session.pushSystem(resolved_path, sid);
    try session.pushStatus("local model ready", false);

    // Main request loop
    while (!session.should_stop.load(.seq_cst)) {
        // Flush a pending RESET (cart hot-reload reuse) before anything
        // else. Drops the subprocess's chat history; model stays loaded.
        try flushPendingReset(session, stdin_file, &reader);

        // Flush pending TOOLS schema before processing the next CHAT.
        // setTools() may fire from JS at any moment; we drain it here so
        // the worker subprocess has the latest schema for the upcoming turn.
        try flushPendingTools(session, stdin_file, &reader);

        if (session.requests.pop()) |req| {
            var owned = req;
            defer owned.deinit(session.allocator);

            const sys_prompt = owned.system_prompt orelse session.options.system_prompt orelse "";

            const cmd = try std.fmt.allocPrint(
                session.allocator,
                "CHAT {d}\n{s}\n.\n{s}\n.\n",
                .{ owned.max_tokens, sys_prompt, owned.text },
            );
            defer session.allocator.free(cmd);
            try stdin_file.writeAll(cmd);

            // Stream tokens until DONE or ERR. TOOL_CALL lines pause the
            // stream — we wait for a matching TOOL_RESULT from JS, write
            // it to the worker subprocess, then keep reading.
            var assistant_buf: std.ArrayList(u8) = .empty;
            defer assistant_buf.deinit(session.allocator);

            while (true) {
                const line = reader.next() orelse {
                    try session.pushStatus("worker EOF mid-generation", true);
                    try session.pushResult("worker EOF mid-generation", true);
                    return;
                };

                // DEBUG: log every non-TOK line so we can see what Zig
                // actually receives from the worker after generate ends.
                if (!std.mem.startsWith(u8, line, "TOK ")) {
                    const preview_len = @min(line.len, 200);
                    log.print("[zig-session] CHAT line: '{s}' (len={d})\n", .{ line[0..preview_len], line.len });
                }

                if (std.mem.eql(u8, line, "DONE")) {
                    try session.pushResult(assistant_buf.items, false);
                    break;
                }
                if (std.mem.startsWith(u8, line, "ERR ")) {
                    const e = line[4..];
                    try session.pushStatus(e, true);
                    try session.pushResult(e, true);
                    break;
                }
                if (std.mem.startsWith(u8, line, "TOK ")) {
                    const piece_escaped = line[4..];
                    const piece = try unescapePieceAlloc(session.allocator, piece_escaped);
                    defer session.allocator.free(piece);
                    try session.pushAssistantPart(piece);
                    try assistant_buf.appendSlice(session.allocator, piece);
                    continue;
                }
                if (std.mem.startsWith(u8, line, "TOOL_CALL ")) {
                    log.print("[zig-session] TOOL_CALL line received: {s}\n", .{line});
                    const id = try session.allocator.dupe(u8, line[10..]);
                    defer session.allocator.free(id);

                    const name_line = reader.next() orelse {
                        try session.pushStatus("worker EOF after TOOL_CALL header", true);
                        try session.pushResult("worker EOF after TOOL_CALL header", true);
                        return;
                    };
                    const name = try session.allocator.dupe(u8, name_line);
                    defer session.allocator.free(name);

                    var args_buf: std.ArrayList(u8) = .empty;
                    defer args_buf.deinit(session.allocator);
                    while (true) {
                        const al = reader.next() orelse {
                            try session.pushStatus("worker EOF mid TOOL_CALL args", true);
                            try session.pushResult("worker EOF mid TOOL_CALL args", true);
                            return;
                        };
                        if (std.mem.eql(u8, al, ".")) break;
                        if (args_buf.items.len > 0) try args_buf.append(session.allocator, '\n');
                        try args_buf.appendSlice(session.allocator, al);
                    }

                    log.print("[zig-session] pushing tool_call event id={s} name={s} args.len={d}\n", .{ id, name, args_buf.items.len });
                    try session.pushToolCall(id, name, args_buf.items);

                    // Block-poll for matching TOOL_RESULT. The JS side
                    // dispatches the tool_call event, runs the handler,
                    // then calls submitToolReply.
                    log.print("[zig-session] awaiting TOOL_RESULT for id={s}\n", .{id});
                    const reply = try awaitToolReply(session, id);
                    var owned_reply = reply;
                    defer owned_reply.deinit(session.allocator);
                    log.print("[zig-session] got TOOL_RESULT for id={s} body.len={d}\n", .{ owned_reply.id, owned_reply.body.len });

                    const tr_cmd = try std.fmt.allocPrint(
                        session.allocator,
                        "TOOL_RESULT {s}\n{s}\n.\n",
                        .{ owned_reply.id, owned_reply.body },
                    );
                    defer session.allocator.free(tr_cmd);
                    try stdin_file.writeAll(tr_cmd);
                    continue;
                }
                // Unknown line type — log and ignore
            }
        } else {
            std.Thread.sleep(2 * std.time.ns_per_ms);
        }
    }

    // Clean shutdown
    stdin_file.writeAll("QUIT\n") catch {};
    _ = child.wait() catch {};
}

// Send RESET\n to the worker subprocess if Session.reset() was called.
// Drains the READY ack. No-op if no reset is pending. Cheap when idle.
fn flushPendingReset(session: *Session, stdin_file: std.fs.File, reader: *LineReader) !void {
    if (!session.reset_pending.swap(false, .seq_cst)) return;

    log.print("[zig-session] flushing RESET to subprocess\n", .{});
    try stdin_file.writeAll("RESET\n");

    // Drain the READY (or ERR) ack. The worker only emits one of those
    // for RESET, so a single line is enough — but we keep the loop in
    // case stray lines from a prior turn are still buffered.
    while (true) {
        const line = reader.next() orelse return error.WorkerEofDuringReset;
        if (std.mem.eql(u8, line, "READY")) {
            log.print("[zig-session] RESET ack: READY\n", .{});
            // Re-emit the same "ready" status the cart sees on first
            // load. Without this, a reused session never pushes any
            // event to the new React tree, so derivePhase stays at
            // 'starting' forever and the chat input stays disabled.
            try session.pushStatus("local model ready", false);
            return;
        }
        if (std.mem.startsWith(u8, line, "ERR ")) {
            try session.pushStatus(line[4..], true);
            return error.WorkerResetFailed;
        }
        // Ignore stray TOK / status lines from a CHAT that wrapped up
        // between the JS-side reset() call and this drain.
    }
}

// Send TOOLS\n{json}\n.\n to the worker subprocess if setTools fired
// since the last flush. Drains the worker's READY ack so the next CHAT
// sees a clean stream. No-op if no schema is pending.
fn flushPendingTools(session: *Session, stdin_file: std.fs.File, reader: *LineReader) !void {
    var pending: ?[]u8 = null;
    {
        session.tools_mutex.lock();
        defer session.tools_mutex.unlock();
        if (!session.tools_dirty) return;
        if (session.tools_json) |json| {
            pending = try session.allocator.dupe(u8, json);
        }
        session.tools_dirty = false;
    }

    const json_body = pending orelse "[]";
    defer if (pending) |p| session.allocator.free(p);

    log.print("[zig-session] flushing TOOLS to subprocess ({d} bytes)\n", .{json_body.len});
    const cmd = try std.fmt.allocPrint(session.allocator, "TOOLS\n{s}\n.\n", .{json_body});
    defer session.allocator.free(cmd);
    try stdin_file.writeAll(cmd);

    // Drain the READY (or ERR) ack
    while (true) {
        const line = reader.next() orelse return error.WorkerEofDuringTools;
        if (std.mem.eql(u8, line, "READY")) {
            log.print("[zig-session] TOOLS ack: READY\n", .{});
            return;
        }
        if (std.mem.startsWith(u8, line, "ERR ")) {
            log.print("[zig-session] TOOLS ack: ERR {s}\n", .{line[4..]});
            try session.pushStatus(line[4..], true);
            return;
        }
        // Anything else — ignore, keep waiting
    }
}

// Block-poll the tool_replies queue until a reply with matching id arrives,
// or until the session is shut down. Mid-flight cancellation surfaces as
// an error so the caller can abort the CHAT loop.
fn awaitToolReply(session: *Session, want_id: []const u8) !ToolReply {
    while (!session.should_stop.load(.seq_cst)) {
        if (session.tool_replies.pop()) |reply| {
            if (std.mem.eql(u8, reply.id, want_id)) return reply;
            // ID mismatch — drop on the floor; the dispatcher should
            // pair calls and replies correctly. (Could re-queue if we
            // ever support out-of-order replies.)
            var stale = reply;
            stale.deinit(session.allocator);
            continue;
        }
        std.Thread.sleep(2 * std.time.ns_per_ms);
    }
    return error.SessionClosed;
}

// ── small helpers ───────────────────────────────────────────────────

fn resolveModelPathAlloc(allocator: std.mem.Allocator, cwd: ?[]const u8, model_path: []const u8) ![]u8 {
    if (std.fs.path.isAbsolute(model_path)) return allocator.dupe(u8, model_path);
    if (cwd) |value| return std.fs.path.join(allocator, &.{ value, model_path });
    return allocator.dupe(u8, model_path);
}

test "resolveModelPathAlloc joins cwd when relative" {
    const allocator = std.testing.allocator;
    const joined = try resolveModelPathAlloc(allocator, "/tmp/project", "models/qwen.gguf");
    defer allocator.free(joined);
    try std.testing.expectEqualStrings("/tmp/project/models/qwen.gguf", joined);
}

test "unescapePieceAlloc handles \\n" {
    const allocator = std.testing.allocator;
    const out = try unescapePieceAlloc(allocator, "hello\\nworld");
    defer allocator.free(out);
    try std.testing.expectEqualStrings("hello\nworld", out);
}
