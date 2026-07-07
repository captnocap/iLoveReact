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
//! SlimSAM pair — any MoveNet-signature model drops in). Inference is
//! synchronous on the calling thread: Lightning is ~10-20ms on CPU, fine for
//! a 10-15Hz capture loop driven from the cart side.
//!
//! Same ORT discipline as segment.zig: onnx.c shared cimport, lazy init,
//! init errors recorded once and surfaced through initError().

const std = @import("std");
const onnx = @import("onnx.zig");
const c = onnx.c;
const stb = @cImport({
    @cInclude("stb/stb_image.h");
});

const log = std.log.scoped(.pose);

pub const INPUT_SIZE: usize = 192;
pub const KEYPOINTS: usize = 17;

var g_env: ?*c.OrtEnv = null;
var g_session: ?*c.OrtSession = null;
var g_mem_info: ?*c.OrtMemoryInfo = null;
var g_init_done: bool = false;
var g_init_failed: bool = false;
var g_init_error: ?[]u8 = null;

const page_alloc = std.heap.page_allocator;

pub fn initError() ?[]const u8 {
    return g_init_error;
}

fn recordInitErr(msg: []const u8) void {
    g_init_failed = true;
    g_init_error = page_alloc.dupe(u8, msg) catch null;
    log.err("init failed: {s}", .{msg});
}

fn recordOrtErr(api: *const c.OrtApi, status: ?*c.OrtStatus, where: []const u8) void {
    var msg: []const u8 = "unknown";
    if (api.GetErrorMessage) |fp| {
        const cstr = fp(status);
        if (cstr != null) msg = std.mem.span(cstr);
    }
    g_init_failed = true;
    g_init_error = std.fmt.allocPrint(page_alloc, "{s}: {s}", .{ where, msg }) catch null;
    log.err("{s}: {s}", .{ where, msg });
}

fn modelPath(alloc: std.mem.Allocator) ?[]u8 {
    const home = std.posix.getenv("HOME") orelse return null;
    const path = std.fmt.allocPrint(alloc, "{s}/.reactjit/models/movenet_lightning.onnx", .{home}) catch return null;
    std.fs.cwd().access(path, .{}) catch {
        alloc.free(path);
        return null;
    };
    return path;
}

fn ensureInit() bool {
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
        if (create_env(c.ORT_LOGGING_LEVEL_WARNING, "reactjit.pose", &g_env) != null) {
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
    const path = modelPath(page_alloc) orelse {
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

/// One keypoint: source-normalized x,y (0..1) + confidence score.
pub const Keypoint = struct { x: f32, y: f32, score: f32 };

/// Estimate the pose in an RGBA frame (top-down, stride w*4). Returns the 17
/// COCO keypoints in model order, or null when the model/init is unavailable.
pub fn estimateRgba(rgba: []const u8, width: u32, height: u32) ?[KEYPOINTS]Keypoint {
    if (!ensureInit()) return null;
    if (width == 0 or height == 0) return null;
    const api = onnx.api() orelse return null;

    // Letterbox into the model square (top-left pad, nearest-neighbor) as
    // i32 RGB — the MoveNet signature.
    const scale: f32 = @min(
        @as(f32, @floatFromInt(INPUT_SIZE)) / @as(f32, @floatFromInt(width)),
        @as(f32, @floatFromInt(INPUT_SIZE)) / @as(f32, @floatFromInt(height)),
    );
    const fit_w: usize = @max(1, @as(usize, @intFromFloat(@as(f32, @floatFromInt(width)) * scale)));
    const fit_h: usize = @max(1, @as(usize, @intFromFloat(@as(f32, @floatFromInt(height)) * scale)));
    var tensor = page_alloc.alloc(i32, INPUT_SIZE * INPUT_SIZE * 3) catch return null;
    defer page_alloc.free(tensor);
    @memset(tensor, 0);
    var ty: usize = 0;
    while (ty < fit_h) : (ty += 1) {
        const sy: usize = @min(@as(usize, height - 1), @as(usize, @intFromFloat(@as(f32, @floatFromInt(ty)) / scale)));
        var tx: usize = 0;
        while (tx < fit_w) : (tx += 1) {
            const sx: usize = @min(@as(usize, width - 1), @as(usize, @intFromFloat(@as(f32, @floatFromInt(tx)) / scale)));
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
            g_session, null,
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
pub fn estimateImage(path: [*:0]const u8) ?[KEYPOINTS]Keypoint {
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
    return estimateRgba(pixels[0 .. @as(usize, w) * @as(usize, h) * 4], w, h);
}
