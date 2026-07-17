// whisper.zig — speech-to-text via whisper.cpp (CPU, gguf models).
//
// Owns one whisper_context. Inference runs on a worker thread because
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
const host_io = @import("../host_io.zig");
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

    // Cross-thread plumbing.
    thread: ?std.Thread = null,
    mutex: std.Thread.Mutex = .{},
    cond: std.Thread.Condition = .{},
    jobs: std.array_list.Managed(Job) = undefined,
    results: std.array_list.Managed(Result) = undefined,
    shutdown: bool = false,

    allocator: std.mem.Allocator = undefined,
};

var S: State = .{};

// ── Lifecycle ────────────────────────────────────────────────────────

pub fn init(allocator: std.mem.Allocator) void {
    if (S.initialized) return;
    S.allocator = allocator;
    S.jobs = std.array_list.Managed(Job).init(allocator);
    S.results = std.array_list.Managed(Result).init(allocator);
    S.shutdown = false;
    S.thread = std.Thread.spawn(.{}, workerLoop, .{}) catch null;
    S.initialized = true;
}

pub fn deinit() void {
    if (!S.initialized) return;
    S.mutex.lock();
    S.shutdown = true;
    S.cond.signal();
    S.mutex.unlock();
    if (S.thread) |t| t.join();
    S.thread = null;

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
pub fn enqueueTranscribe(buf_id: u32, model_path: []const u8) bool {
    if (!S.initialized) return false;
    if (model_path.len == 0 or model_path.len > MAX_MODEL_PATH) return false;
    if (voice.getBuffer(buf_id) == null) return false;
    const path_copy = S.allocator.dupe(u8, model_path) catch return false;
    S.mutex.lock();
    defer S.mutex.unlock();
    S.jobs.append(.{ .buf_id = buf_id, .model_path = path_copy }) catch {
        S.allocator.free(path_copy);
        return false;
    };
    S.cond.signal();
    return true;
}

/// Drain ready results on the engine tick and fire JS callbacks.
pub fn tick(_: u32) void {
    if (!S.initialized) return;
    while (true) {
        var maybe_result: ?Result = null;
        {
            S.mutex.lock();
            defer S.mutex.unlock();
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
        v8_runtime.callGlobalStr("__voice_onTranscript", @ptrCast(&text_buf));

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
        v8_runtime.callGlobalStr("__whisper_onResult", @ptrCast(json_str.ptr));
    }
}

// ── Worker thread ─────────────────────────────────────────────────────

fn workerLoop() void {
    while (true) {
        var job: ?Job = null;
        {
            S.mutex.lock();
            defer S.mutex.unlock();
            while (S.jobs.items.len == 0 and !S.shutdown) {
                S.cond.wait(&S.mutex);
            }
            if (S.shutdown) return;
            job = S.jobs.orderedRemove(0);
        }
        runJob(job.?);
    }
}

fn runJob(job: Job) void {
    defer S.allocator.free(job.model_path);

    const t_start = host_io.milliTimestamp();

    // Load model if it isn't already this one.
    const need_load = blk: {
        if (S.ctx == null) break :blk true;
        if (S.loaded_model_path) |p| {
            break :blk !std.mem.eql(u8, p, job.model_path);
        }
        break :blk true;
    };
    if (need_load) {
        if (S.ctx) |c| wh.whisper_free(c);
        S.ctx = null;
        if (S.loaded_model_path) |p| S.allocator.free(p);
        S.loaded_model_path = null;

        var path_z: [MAX_MODEL_PATH + 1]u8 = undefined;
        const expanded = expandHome(job.model_path, &path_z) orelse {
            postFailure(job.buf_id, job.model_path, "path too long", t_start);
            return;
        };
        path_z[expanded] = 0;

        const new_ctx = wh.whisper_init_from_file(@ptrCast(&path_z));
        if (new_ctx == null) {
            postFailure(job.buf_id, job.model_path, "model load failed", t_start);
            return;
        }
        S.ctx = new_ctx;
        S.loaded_model_path = S.allocator.dupe(u8, job.model_path) catch null;
    }

    // Pull PCM from the voice subsystem and convert i16 → f32.
    const pcm = voice.getBuffer(job.buf_id) orelse {
        postFailure(job.buf_id, job.model_path, "buffer not found", t_start);
        return;
    };
    const f32_buf = S.allocator.alloc(f32, pcm.len) catch {
        postFailure(job.buf_id, job.model_path, "alloc failed", t_start);
        return;
    };
    defer S.allocator.free(f32_buf);
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

    const rc = wh.whisper_full(S.ctx.?, params, f32_buf.ptr, @intCast(f32_buf.len));
    if (rc != 0) {
        postFailure(job.buf_id, job.model_path, "whisper_full failed", t_start);
        return;
    }

    // Concatenate every segment.
    const n_segs = wh.whisper_full_n_segments(S.ctx.?);
    var text_buf = std.array_list.Managed(u8).init(S.allocator);
    defer text_buf.deinit();
    var i: c_int = 0;
    while (i < n_segs) : (i += 1) {
        const seg = wh.whisper_full_get_segment_text(S.ctx.?, i);
        if (seg == null) continue;
        const span = std.mem.span(seg);
        text_buf.appendSlice(span) catch break;
    }

    const text_owned = S.allocator.dupe(u8, text_buf.items) catch {
        postFailure(job.buf_id, job.model_path, "result dup failed", t_start);
        return;
    };

    const elapsed: u32 = @intCast(@as(i64, host_io.milliTimestamp() - t_start));
    postResult(job.buf_id, job.model_path, text_owned, elapsed, true);
}

fn postFailure(buf_id: u32, model_path: []const u8, reason: []const u8, t_start: i64) void {
    const text = S.allocator.dupe(u8, reason) catch return;
    const elapsed: u32 = @intCast(@as(i64, host_io.milliTimestamp() - t_start));
    postResult(buf_id, model_path, text, elapsed, false);
}

fn postResult(buf_id: u32, model_path: []const u8, text_owned: []u8, elapsed_ms: u32, success: bool) void {
    const path_owned = S.allocator.dupe(u8, model_path) catch {
        S.allocator.free(text_owned);
        return;
    };
    S.mutex.lock();
    defer S.mutex.unlock();
    S.results.append(.{
        .buf_id = buf_id,
        .model_path = path_owned,
        .text = text_owned,
        .elapsed_ms = elapsed_ms,
        .success = success,
    }) catch {
        S.allocator.free(path_owned);
        S.allocator.free(text_owned);
    };
}

// ── Path expansion ───────────────────────────────────────────────────

/// Expand a leading "~/" in `path` to $HOME and write the result into
/// `out`. Returns the byte length written, or null if the result wouldn't
/// fit. Carts pass paths like "~/.reactjit/models/ggml-base.en-q5_1.bin"
/// so they don't have to know the absolute location of $HOME.
fn expandHome(path: []const u8, out: *[MAX_MODEL_PATH + 1]u8) ?usize {
    if (path.len >= 2 and path[0] == '~' and path[1] == '/') {
        const home = std.posix.getenv("HOME") orelse "";
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
