//! 2D human pose estimation via MoveNet SinglePose (ONNX) — the CAPTURE
//! pipeline's per-frame tracker (req_2786, the animation workbench arc).
//!
//! ONE session:
//!   MOVENET  input[1,192,192,3] i32 RGB → output_0[1,1,17,3] f32 (y, x, score)
//!
//! 17 COCO keypoints in model order: nose, l/r eye, l/r ear, l/r shoulder,
//! l/r elbow, l/r wrist, l/r hip, l/r knee, l/r ankle. Coordinates come back
//! normalized to the SOURCE frame (the letterbox mapping is undone here) —
//! consumers never see the 192×192 model space.
//!
//! Model file: ~/.reactjit/models/movenet_lightning.onnx (vendored like the
//! SlimSAM pair — any MoveNet-signature model drops in). Live inference owns a
//! copied camera frame and runs on one bounded worker; the engine thread only
//! submits/polls. Image-file verification remains synchronous by design.
//!
//! Same ORT discipline as segment.zig: onnx.c shared cimport, lazy init,
//! init errors recorded once and surfaced through initError().

const std = @import("std");
const onnx = @import("onnx.zig");
const pose_mailbox = @import("pose_mailbox.zig");
const c = onnx.c;
const stb = @cImport({
    @cInclude("stb/stb_image.h");
});

const log = std.log.scoped(.pose);

pub const INPUT_SIZE: usize = 192;
pub const KEYPOINTS: usize = pose_mailbox.KEYPOINTS;
pub const Keypoint = pose_mailbox.Keypoint;
pub const AsyncResult = pose_mailbox.Result;
pub const SubmitStatus = pose_mailbox.SubmitStatus;

var g_env: ?*c.OrtEnv = null;
var g_session: ?*c.OrtSession = null;
var g_mem_info: ?*c.OrtMemoryInfo = null;
var g_init_done: bool = false;
var g_init_failed: bool = false;
var g_init_error: ?[]u8 = null;
var g_inference_mutex: std.Io.Mutex = .init;

var g_async_initialized: bool = false;
var g_async: AsyncState = undefined;

const AsyncState = struct {
    io: std.Io,
    environ: *const std.process.Environ.Map,
    queue: pose_mailbox.Queue,
    tasks: std.Io.Group = .init,
};

const page_alloc = std.heap.page_allocator;

pub fn initError() ?[]const u8 {
    return g_init_error;
}

fn recordInitErr(msg: []const u8) void {
    g_init_failed = true;
    if (g_init_error) |old| page_alloc.free(old);
    g_init_error = page_alloc.dupe(u8, msg) catch null;
    log.err("init failed: {s}", .{msg});
}

fn recordOrtErr(api: *const c.OrtApi, status: ?*c.OrtStatus, where: []const u8) void {
    defer if (api.ReleaseStatus) |fp| fp(status);
    var msg: []const u8 = "unknown";
    if (api.GetErrorMessage) |fp| {
        const cstr = fp(status);
        if (cstr != null) msg = std.mem.span(cstr);
    }
    g_init_failed = true;
    if (g_init_error) |old| page_alloc.free(old);
    g_init_error = std.fmt.allocPrint(page_alloc, "{s}: {s}", .{ where, msg }) catch null;
    log.err("{s}: {s}", .{ where, msg });
}

fn modelPath(io: std.Io, environ: *const std.process.Environ.Map, alloc: std.mem.Allocator) ?[]u8 {
    const home = environ.get("HOME") orelse return null;
    const path = std.fmt.allocPrint(alloc, "{s}/.reactjit/models/movenet_lightning.onnx", .{home}) catch return null;
    std.Io.Dir.cwd().access(io, path, .{}) catch {
        alloc.free(path);
        return null;
    };
    return path;
}

fn ensureInit(io: std.Io, environ: *const std.process.Environ.Map) bool {
    if (g_init_done and g_session != null) return true;
    if (g_init_failed) return false;
    g_init_done = true;

    const api = onnx.api() orelse {
        recordInitErr("ORT API unavailable");
        return false;
    };
    {
        const create_env = api.CreateEnv orelse {
            recordInitErr("CreateEnv fn pointer null");
            return false;
        };
        // This is a CPU-only session. ORT's warning-level Linux device probe
        // reports stale /sys/class/drm entries even though no GPU provider is
        // requested; errors still surface through our explicit result path.
        if (create_env(c.ORT_LOGGING_LEVEL_ERROR, "reactjit.pose", &g_env) != null) {
            recordInitErr("CreateEnv failed");
            return false;
        }
    }
    var session_opts: ?*c.OrtSessionOptions = null;
    const create_sopts = api.CreateSessionOptions orelse {
        recordInitErr("CreateSessionOptions null");
        return false;
    };
    if (create_sopts(&session_opts) != null) {
        recordInitErr("CreateSessionOptions failed");
        return false;
    }
    defer if (api.ReleaseSessionOptions) |fp| fp(session_opts);
    {
        const create_mi = api.CreateCpuMemoryInfo orelse {
            recordInitErr("CreateCpuMemoryInfo null");
            return false;
        };
        if (create_mi(c.OrtArenaAllocator, c.OrtMemTypeDefault, &g_mem_info) != null) {
            recordInitErr("CreateCpuMemoryInfo failed");
            return false;
        }
    }
    const path = modelPath(io, environ, page_alloc) orelse {
        recordInitErr("pose model not found at ~/.reactjit/models/movenet_lightning.onnx — download via scripts/fetch-pose-models");
        return false;
    };
    defer page_alloc.free(path);
    const path_z = page_alloc.dupeZ(u8, path) catch {
        recordInitErr("OOM duplicating model path");
        return false;
    };
    defer page_alloc.free(path_z);
    const create_session = api.CreateSession orelse {
        recordInitErr("CreateSession null");
        return false;
    };
    if (create_session(g_env, path_z.ptr, session_opts, &g_session) != null) {
        recordInitErr("CreateSession(movenet) failed");
        return false;
    }
    log.info("pose model loaded — MoveNet ready", .{});
    return true;
}

// ── Bounded live-inference worker ──────────────────────────────────────

pub fn init(io: std.Io, environ: *const std.process.Environ.Map, allocator: std.mem.Allocator) void {
    if (g_async_initialized) return;
    g_async = .{
        .io = io,
        .environ = environ,
        .queue = undefined,
    };
    g_async.queue.init(allocator);
    g_async.tasks.concurrent(io, asyncWorkerLoop, .{&g_async}) catch {
        g_async.queue.stop(io);
        g_async.queue.deinit(io);
        return;
    };
    g_async_initialized = true;
}

pub fn deinit(io: std.Io) void {
    if (!g_async_initialized) return;
    g_async.queue.stop(io);
    g_async.tasks.cancel(io);
    g_async.queue.deinit(io);
    releaseOrt();
    g_async_initialized = false;
}

/// Main-thread boundary: validate + copy one render-surface frame, then return.
/// Busy is backpressure, never an instruction to grow a frame queue.
pub fn enqueueRgba(io: std.Io, request_id: u32, rgba: []const u8, width: u32, height: u32) SubmitStatus {
    if (!g_async_initialized) return .stopped;
    return g_async.queue.submitCopy(io, request_id, rgba, width, height);
}

/// Engine-tick boundary: non-blocking take of the worker's completed result.
pub fn pollAsync(io: std.Io) ?AsyncResult {
    if (!g_async_initialized) return null;
    return g_async.queue.poll(io);
}

fn asyncWorkerLoop(state: *AsyncState) std.Io.Cancelable!void {
    while (try state.queue.waitTake(state.io)) |owned_frame_value| {
        var owned_frame = owned_frame_value;
        defer owned_frame.deinit();
        const started_ms = std.Io.Clock.now(.awake, state.io).toMilliseconds();
        const estimate = estimateRgba(state.io, state.environ, owned_frame.rgba, owned_frame.width, owned_frame.height);
        const elapsed_i64 = @max(0, std.Io.Clock.now(.awake, state.io).toMilliseconds() - started_ms);
        const elapsed_ms: u32 = @intCast(@min(elapsed_i64, @as(i64, std.math.maxInt(u32))));
        const result = if (estimate) |keypoints|
            AsyncResult.success(owned_frame.request_id, keypoints, elapsed_ms)
        else
            AsyncResult.failure(owned_frame.request_id, initError() orelse "pose inference failed", elapsed_ms);
        _ = state.queue.publish(state.io, result);
    }
}

fn releaseOrt() void {
    if (onnx.api()) |api| {
        if (g_session) |session| if (api.ReleaseSession) |fp| fp(session);
        if (g_mem_info) |mem_info| if (api.ReleaseMemoryInfo) |fp| fp(mem_info);
        if (g_env) |env| if (api.ReleaseEnv) |fp| fp(env);
    }
    g_session = null;
    g_mem_info = null;
    g_env = null;
    if (g_init_error) |message| page_alloc.free(message);
    g_init_error = null;
    g_init_done = false;
    g_init_failed = false;
}

/// Estimate the pose in an RGBA frame (top-down, stride w*4). Returns the 17
/// COCO keypoints in model order, or null when the model/init is unavailable.
pub fn estimateRgba(
    io: std.Io,
    environ: *const std.process.Environ.Map,
    rgba: []const u8,
    width: u32,
    height: u32,
) ?[KEYPOINTS]Keypoint {
    g_inference_mutex.lockUncancelable(io);
    defer g_inference_mutex.unlock(io);
    if (!ensureInit(io, environ)) return null;
    if (width == 0 or height == 0) return null;
    const api = onnx.api() orelse return null;

    // Letterbox into the model square (top-left pad, nearest-neighbor) as
    // i32 RGB — the MoveNet signature.
    const scale: f32 = @min(
        @as(f32, @floatFromInt(INPUT_SIZE)) / @as(f32, @floatFromInt(width)),
        @as(f32, @floatFromInt(INPUT_SIZE)) / @as(f32, @floatFromInt(height)),
    );
    const fit_w: usize = @max(1, @as(usize, @trunc(@as(f32, @floatFromInt(width)) * scale)));
    const fit_h: usize = @max(1, @as(usize, @trunc(@as(f32, @floatFromInt(height)) * scale)));
    var tensor = page_alloc.alloc(i32, INPUT_SIZE * INPUT_SIZE * 3) catch return null;
    defer page_alloc.free(tensor);
    @memset(tensor, 0);
    var ty: usize = 0;
    while (ty < fit_h) : (ty += 1) {
        const sy: usize = @min(@as(usize, height - 1), @as(usize, @trunc(@as(f32, @floatFromInt(ty)) / scale)));
        var tx: usize = 0;
        while (tx < fit_w) : (tx += 1) {
            const sx: usize = @min(@as(usize, width - 1), @as(usize, @trunc(@as(f32, @floatFromInt(tx)) / scale)));
            const src_at = (sy * @as(usize, width) + sx) * 4;
            const dst_at = (ty * INPUT_SIZE + tx) * 3;
            tensor[dst_at + 0] = rgba[src_at + 0];
            tensor[dst_at + 1] = rgba[src_at + 1];
            tensor[dst_at + 2] = rgba[src_at + 2];
        }
    }

    var dims: [4]i64 = .{ 1, INPUT_SIZE, INPUT_SIZE, 3 };
    var input_val: ?*c.OrtValue = null;
    {
        const create_tensor = api.CreateTensorWithDataAsOrtValue orelse return null;
        const byte_count: usize = tensor.len * @sizeOf(i32);
        if (create_tensor(@ptrCast(g_mem_info), @ptrCast(tensor.ptr), byte_count, &dims, dims.len, c.ONNX_TENSOR_ELEMENT_DATA_TYPE_INT32, &input_val) != null) {
            log.err("CreateTensorWithDataAsOrtValue failed", .{});
            return null;
        }
    }
    defer if (api.ReleaseValue) |fp| fp(input_val);

    var in_names: [1][*:0]const u8 = .{"input"};
    var out_names: [1][*:0]const u8 = .{"output_0"};
    var inputs: [1]?*c.OrtValue = .{input_val};
    var outputs: [1]?*c.OrtValue = .{null};
    {
        const run_fn = api.Run orelse return null;
        const status = run_fn(
            g_session,
            null,
            @as([*c]const [*c]const u8, @ptrCast(&in_names)),
            @as([*c]const ?*const c.OrtValue, @ptrCast(&inputs)),
            in_names.len,
            @as([*c]const [*c]const u8, @ptrCast(&out_names)),
            out_names.len,
            &outputs,
        );
        if (status != null) {
            recordOrtErr(api, status, "movenet Run");
            g_init_failed = false; // a bad frame shouldn't poison future calls
            return null;
        }
    }
    defer if (api.ReleaseValue) |fp| {
        if (outputs[0]) |v| fp(v);
    };

    var data_ptr: ?*anyopaque = null;
    const get_data = api.GetTensorMutableData orelse return null;
    if (get_data(outputs[0], &data_ptr) != null or data_ptr == null) return null;
    const raw: [*]const f32 = @ptrCast(@alignCast(data_ptr));

    // Undo the letterbox: model coords are normalized to the 192 square;
    // keypoints map back to source-normalized 0..1.
    const inv_w = @as(f32, @floatFromInt(INPUT_SIZE)) / @as(f32, @floatFromInt(fit_w));
    const inv_h = @as(f32, @floatFromInt(INPUT_SIZE)) / @as(f32, @floatFromInt(fit_h));
    var out: [KEYPOINTS]Keypoint = undefined;
    var k: usize = 0;
    while (k < KEYPOINTS) : (k += 1) {
        const y = raw[k * 3 + 0];
        const x = raw[k * 3 + 1];
        const score = raw[k * 3 + 2];
        out[k] = .{ .x = std.math.clamp(x * inv_w, 0, 1), .y = std.math.clamp(y * inv_h, 0, 1), .score = score };
    }
    return out;
}

/// Estimate from an image FILE (stb) — the headless verification door.
pub fn estimateImage(io: std.Io, environ: *const std.process.Environ.Map, path: [*:0]const u8) ?[KEYPOINTS]Keypoint {
    var sw: c_int = 0;
    var sh: c_int = 0;
    var comp: c_int = 0;
    const pixels = stb.stbi_load(path, &sw, &sh, &comp, 4) orelse {
        log.err("stbi_load failed", .{});
        return null;
    };
    defer stb.stbi_image_free(pixels);
    const w: u32 = @intCast(sw);
    const h: u32 = @intCast(sh);
    return estimateRgba(io, environ, pixels[0 .. @as(usize, w) * @as(usize, h) * 4], w, h);
}
