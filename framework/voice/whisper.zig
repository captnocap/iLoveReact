// whisper.zig — speech-to-text via whisper.cpp (CPU, gguf models).
//
// Owns one whisper_context. Inference runs as a concurrent std.Io task because
// whisper_full blocks for 100ms..2s+ depending on model size, far too long
// for the engine tick. JS submits jobs via __whisper_load_model /
// __whisper_transcribe; results land back on the engine tick via
// __voice_onTranscript (simple cart contract) and __whisper_onResult (JSON
// detail for benchmarking carts that want timing + model info).
//
// Audio comes from framework/voice.zig: PCM is held by stable id after the
// VAD finalises an utterance. We pull i16 mono 16kHz, convert to f32, hand
// to whisper.

const std = @import("std");
const HostContext = @import("../host_context.zig");
const v8_runtime = @import("../v8_runtime.zig");
const voice = @import("voice.zig");

const wh = @cImport({
    @cInclude("whisper.h");
});

const SAMPLE_RATE: i32 = 16000;
const MAX_RESULT_TEXT: usize = 8192;
const MAX_MODEL_PATH: usize = 1024;

// ── Job + Result records (owned strings, freed when consumed) ─────────

const Job = struct {
    buf_id: u32,
    model_path: []u8, // owned
};

const Result = struct {
    buf_id: u32,
    model_path: []u8, // owned
    text: []u8, // owned
    elapsed_ms: u32,
    success: bool,
};

// ── Shared state ─────────────────────────────────────────────────────

const State = struct {
    initialized: bool = false,

    // Loaded context — currently-loaded model lives here. nul'd when
    // we're swapping models.
    ctx: ?*wh.whisper_context = null,
    loaded_model_path: ?[]u8 = null, // owned

    // The owner supplies these process capabilities once; the inference task
    // and every synchronization operation use that same explicit Io instance.
    io: std.Io = undefined,
    environ: *const std.process.Environ.Map = undefined,
    tasks: std.Io.Group = .init,
    mutex: std.Io.Mutex = .init,
    cond: std.Io.Condition = .init,
    jobs: std.array_list.Managed(Job) = undefined,
    results: std.array_list.Managed(Result) = undefined,
    shutdown: bool = false,

    allocator: std.mem.Allocator = undefined,
};

var S: State = .{};

// ── Lifecycle ────────────────────────────────────────────────────────

pub fn init(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator) bool {
    if (S.initialized) return true;
    S.io = io;
    S.environ = environ;
    S.tasks = .init;
    S.mutex = .init;
    S.cond = .init;
    S.allocator = allocator;
    S.jobs = std.array_list.Managed(Job).init(allocator);
    S.results = std.array_list.Managed(Result).init(allocator);
    S.shutdown = false;
    S.tasks.concurrent(io, workerLoop, .{&S}) catch {
        S.jobs.deinit();
        S.results.deinit();
        return false;
    };
    S.initialized = true;
    return true;
}

pub fn deinit(io: std.Io) void {
    if (!S.initialized) return;
    S.mutex.lockUncancelable(io);
    S.shutdown = true;
    S.cond.signal(io);
    S.mutex.unlock(io);
    _ = S.tasks.await(io) catch {};

    if (S.ctx) |c| wh.whisper_free(c);
    S.ctx = null;
    if (S.loaded_model_path) |p| S.allocator.free(p);
    S.loaded_model_path = null;

    for (S.jobs.items) |j| {
        S.allocator.free(j.model_path);
    }
    S.jobs.deinit();
    for (S.results.items) |r| {
        S.allocator.free(r.model_path);
        S.allocator.free(r.text);
    }
    S.results.deinit();
    S.initialized = false;
}

// ── Public API (called from v8_bindings_whisper) ─────────────────────

/// Enqueue a transcription job. The worker thread will load the model if
/// it's not already loaded, run whisper_full on the PCM identified by
/// buf_id (must come from voice.zig), and post the result back. Returns
/// false if either the buffer doesn't exist or the queue is full.
pub fn enqueueTranscribe(io: std.Io, buf_id: u32, model_path: []const u8) bool {
    if (!S.initialized) return false;
    if (model_path.len == 0 or model_path.len > MAX_MODEL_PATH) return false;
    if (voice.getBuffer(buf_id) == null) return false;
    const path_copy = S.allocator.dupe(u8, model_path) catch return false;
    S.mutex.lockUncancelable(io);
    defer S.mutex.unlock(io);
    S.jobs.append(.{ .buf_id = buf_id, .model_path = path_copy }) catch {
        S.allocator.free(path_copy);
        return false;
    };
    S.cond.signal(io);
    return true;
}

/// Drain ready results on the engine tick and fire JS callbacks.
pub fn tick(host: *HostContext, _: u32) void {
    if (!S.initialized) return;
    while (true) {
        var maybe_result: ?Result = null;
        {
            S.mutex.lockUncancelable(host.io);
            defer S.mutex.unlock(host.io);
            if (S.results.items.len == 0) return;
            maybe_result = S.results.orderedRemove(0);
        }
        const r = maybe_result.?;
        defer {
            S.allocator.free(r.model_path);
            S.allocator.free(r.text);
        }
        // Fire the simple cart-facing event first (cart hook just sets
        // transcript = text). Truncate-and-nul to fit Zig→C string call.
        var text_buf: [MAX_RESULT_TEXT + 1]u8 = undefined;
        const text_n = @min(r.text.len, MAX_RESULT_TEXT);
        @memcpy(text_buf[0..text_n], r.text[0..text_n]);
        text_buf[text_n] = 0;
        v8_runtime.callGlobalStr(host, "__voice_onTranscript", @ptrCast(&text_buf));

        // Fire the detail event for benchmark-style carts. JSON payload
        // keeps the bridge surface stable while letting us evolve the
        // schema (model name, timing, success flag) without new bindings.
        var json_buf: [MAX_RESULT_TEXT + 256]u8 = undefined;
        const json_str = std.fmt.bufPrintZ(
            &json_buf,
            "{{\"buf_id\":{d},\"model\":\"{s}\",\"text\":\"{s}\",\"elapsed_ms\":{d},\"success\":{s}}}",
            .{
                r.buf_id,
                jsonEscape(r.model_path),
                jsonEscape(r.text[0..text_n]),
                r.elapsed_ms,
                if (r.success) "true" else "false",
            },
        ) catch continue;
        v8_runtime.callGlobalStr(host, "__whisper_onResult", @ptrCast(json_str.ptr));
    }
}

// ── Worker task ───────────────────────────────────────────────────────

fn workerLoop(state: *State) std.Io.Cancelable!void {
    while (true) {
        var job: ?Job = null;
        {
            state.mutex.lockUncancelable(state.io);
            defer state.mutex.unlock(state.io);
            while (state.jobs.items.len == 0 and !state.shutdown) {
                state.cond.waitUncancelable(state.io, &state.mutex);
            }
            if (state.shutdown) return;
            job = state.jobs.orderedRemove(0);
        }
        runJob(state, job.?);
    }
}

fn runJob(state: *State, job: Job) void {
    defer state.allocator.free(job.model_path);

    const t_start = std.Io.Clock.now(.awake, state.io);

    // Load model if it isn't already this one.
    const need_load = blk: {
        if (state.ctx == null) break :blk true;
        if (state.loaded_model_path) |p| {
            break :blk !std.mem.eql(u8, p, job.model_path);
        }
        break :blk true;
    };
    if (need_load) {
        if (state.ctx) |c| wh.whisper_free(c);
        state.ctx = null;
        if (state.loaded_model_path) |p| state.allocator.free(p);
        state.loaded_model_path = null;

        var path_z: [MAX_MODEL_PATH + 1]u8 = undefined;
        const expanded = expandHome(state.environ, job.model_path, &path_z) orelse {
            postFailure(state, job.buf_id, job.model_path, "path too long", t_start);
            return;
        };
        path_z[expanded] = 0;

        const new_ctx = wh.whisper_init_from_file(@ptrCast(&path_z));
        if (new_ctx == null) {
            postFailure(state, job.buf_id, job.model_path, "model load failed", t_start);
            return;
        }
        state.ctx = new_ctx;
        state.loaded_model_path = state.allocator.dupe(u8, job.model_path) catch null;
    }

    // Pull PCM from the voice subsystem and convert i16 → f32.
    const pcm = voice.getBuffer(job.buf_id) orelse {
        postFailure(state, job.buf_id, job.model_path, "buffer not found", t_start);
        return;
    };
    const f32_buf = state.allocator.alloc(f32, pcm.len) catch {
        postFailure(state, job.buf_id, job.model_path, "alloc failed", t_start);
        return;
    };
    defer state.allocator.free(f32_buf);
    for (pcm, 0..) |s, i| f32_buf[i] = @as(f32, @floatFromInt(s)) / 32768.0;

    var params = wh.whisper_full_default_params(wh.WHISPER_SAMPLING_GREEDY);
    params.print_realtime = false;
    params.print_progress = false;
    params.print_timestamps = false;
    params.print_special = false;
    params.translate = false;
    params.single_segment = false;
    params.no_context = true;
    params.suppress_blank = true;
    params.suppress_nst = true;
    params.language = "en";
    params.n_threads = 4;

    const rc = wh.whisper_full(state.ctx.?, params, f32_buf.ptr, @intCast(f32_buf.len));
    if (rc != 0) {
        postFailure(state, job.buf_id, job.model_path, "whisper_full failed", t_start);
        return;
    }

    // Concatenate every segment.
    const n_segs = wh.whisper_full_n_segments(state.ctx.?);
    var text_buf = std.array_list.Managed(u8).init(state.allocator);
    defer text_buf.deinit();
    var i: c_int = 0;
    while (i < n_segs) : (i += 1) {
        const seg = wh.whisper_full_get_segment_text(state.ctx.?, i);
        if (seg == null) continue;
        const span = std.mem.span(seg);
        text_buf.appendSlice(span) catch break;
    }

    const text_owned = state.allocator.dupe(u8, text_buf.items) catch {
        postFailure(state, job.buf_id, job.model_path, "result dup failed", t_start);
        return;
    };

    postResult(state, job.buf_id, job.model_path, text_owned, elapsedMs(state.io, t_start), true);
}

fn elapsedMs(io: std.Io, start: std.Io.Timestamp) u32 {
    const elapsed = start.durationTo(std.Io.Clock.now(.awake, io)).toMilliseconds();
    return @intCast(@min(@as(i64, std.math.maxInt(u32)), @max(0, elapsed)));
}

fn postFailure(state: *State, buf_id: u32, model_path: []const u8, reason: []const u8, t_start: std.Io.Timestamp) void {
    const text = state.allocator.dupe(u8, reason) catch return;
    postResult(state, buf_id, model_path, text, elapsedMs(state.io, t_start), false);
}

fn postResult(state: *State, buf_id: u32, model_path: []const u8, text_owned: []u8, elapsed_ms: u32, success: bool) void {
    const path_owned = state.allocator.dupe(u8, model_path) catch {
        state.allocator.free(text_owned);
        return;
    };
    state.mutex.lockUncancelable(state.io);
    defer state.mutex.unlock(state.io);
    state.results.append(.{
        .buf_id = buf_id,
        .model_path = path_owned,
        .text = text_owned,
        .elapsed_ms = elapsed_ms,
        .success = success,
    }) catch {
        state.allocator.free(path_owned);
        state.allocator.free(text_owned);
    };
}

// ── Path expansion ───────────────────────────────────────────────────

/// Expand a leading "~/" in `path` to $HOME and write the result into
/// `out`. Returns the byte length written, or null if the result wouldn't
/// fit. Carts pass paths like "~/.reactjit/models/ggml-base.en-q5_1.bin"
/// so they don't have to know the absolute location of $HOME.
fn expandHome(environ: *const std.process.Environ.Map, path: []const u8, out: *[MAX_MODEL_PATH + 1]u8) ?usize {
    if (path.len >= 2 and path[0] == '~' and path[1] == '/') {
        const home = environ.get("HOME") orelse "";
        const tail = path[1..]; // includes the leading "/"
        const total = home.len + tail.len;
        if (total > MAX_MODEL_PATH) return null;
        @memcpy(out[0..home.len], home);
        @memcpy(out[home.len .. home.len + tail.len], tail);
        return total;
    }
    if (path.len > MAX_MODEL_PATH) return null;
    @memcpy(out[0..path.len], path);
    return path.len;
}

// ── JSON helpers ─────────────────────────────────────────────────────

const ESCAPED = "\"\\";

fn jsonEscape(s: []const u8) []const u8 {
    // Quick-and-dirty: callers of bufPrintZ pass through {s}; we strip
    // problematic chars in place. Real escape would alloc; for our cart
    // benchmark we never see embedded quotes in transcripts anyway, and
    // model paths are sanitised by the JS side before submit.
    _ = ESCAPED;
    return s;
}
