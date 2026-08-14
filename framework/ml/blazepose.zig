//! 3D human pose estimation via BlazePose GHUM full (ONNX) — the capture
//! pipeline's per-frame tracker (req_4387, the MoveNet replacement).
//!
//! TWO sessions, MediaPipe's two-stage design:
//!   DETECTOR  input[1,224,224,3] f32 RGB in [-1,1] letterboxed
//!               → [1,2254,12] anchor-relative boxes + 4 alignment keypoints,
//!                 [1,2254,1] score logits
//!   LANDMARKS input[1,256,256,3] f32 RGB in [0,1], the rotated person ROI
//!               → [1,195]  39 × (x, y, z, visibility-logit, presence-logit)
//!                          in 256-crop pixels (indices 33..38 auxiliary),
//!                 [1,1]    pose-presence probability (NOT a logit),
//!                 [1,117]  39 × (x, y, z) WORLD landmarks in metres,
//!                          hip-centred — the real 3D output that retires
//!                          MoveNet's monocular depth-recovery machinery.
//!
//! Pre/post-processing follows the parity-proven contract in QtMeshEditor's
//! MOCAP_SPIKE.md (worst-case world-landmark delta 1.02 cm vs the Python
//! mediapipe reference): SSD anchors with strides [8,16,32,32,32], sigmoid
//! score threshold 0.5, weighted NMS at IoU 0.3, ROI = mid-hip-centred
//! square (side 2·radius·1.25) rotated to the 90° target angle, plain
//! (non-antialiased) bilinear sampling with zero border, screen landmarks
//! projected back through the ROI transform, world landmarks rotated by the
//! ROI rotation ONLY.
//!
//! MediaPipe tracking mode: after a confident solve the next ROI derives
//! from auxiliary landmarks 33 (centre) and 34 (scale) — the detector only
//! re-runs when pose presence drops below the floor. `resetTracking` must be
//! called on camera changes.
//!
//! Output tensors are resolved BY ELEMENT COUNT at session init, never by
//! name — tf2onnx-generated names are an implementation detail of the
//! conversion and the counts (195 / 1 / 117, 2254·12 / 2254) are the
//! contract. A model whose outputs don't resolve fails init loudly.
//!
//! Model files: ~/.reactjit/models/blazepose_{detector,landmarks}.onnx
//! (vendored via scripts/fetch-pose-models). Same ORT discipline as
//! pose.zig/segment.zig: onnx.c shared cimport, lazy init, init errors
//! recorded once and surfaced through initError(). Live inference owns a
//! copied camera frame and runs on one bounded worker; the engine thread
//! only submits/polls.

const std = @import("std");
const onnx = @import("onnx.zig");
const mailbox = @import("inference_mailbox.zig");
const c = onnx.c;
const stb = @cImport({
    @cInclude("stb/stb_image.h");
});

const log = std.log.scoped(.blazepose);

pub const DETECT_INPUT: usize = 224;
pub const LANDMARK_INPUT: usize = 256;
pub const LANDMARK_COUNT: usize = 33;
const RAW_LANDMARK_COUNT: usize = 39;
const ANCHOR_COUNT: usize = 2254;
const DETECT_VALUES: usize = 12; // cx, cy, w, h + 4 keypoints × (x, y)
const KEYPOINT_MID_HIP: usize = 0; // detector alignment keypoint: ROI centre
const KEYPOINT_SCALE: usize = 1; // detector alignment keypoint: ROI radius
const AUX_ROI_CENTER: usize = 33; // landmark model's predicted next-ROI centre
const AUX_ROI_SCALE: usize = 34; // landmark model's predicted next-ROI radius
const DETECT_SCORE_MIN: f32 = 0.5;
const DETECT_NMS_IOU: f32 = 0.3;
const ROI_EXPANSION: f32 = 1.25;
/// Below this pose-presence probability the solve is "nobody there": the
/// tracked ROI is dropped and the detector re-runs (MediaPipe's own floor).
pub const PRESENCE_MIN: f32 = 0.5;
/// Intra-op threads for both CPU sessions (same rationale as pose.zig:
/// small graphs saturate a handful of cores; more just adds scheduling
/// overhead against the frame loop).
const INTRA_OP_THREADS: c_int = 4;

/// Body landmark order — MediaPipe's canonical 33. Left/right are the
/// SUBJECT's left/right (odd = left, even = right after index 0).
pub const LandmarkName = enum(u8) {
    nose,
    eye_inner_left,
    eye_left,
    eye_outer_left,
    eye_inner_right,
    eye_right,
    eye_outer_right,
    ear_left,
    ear_right,
    mouth_left,
    mouth_right,
    shoulder_left,
    shoulder_right,
    elbow_left,
    elbow_right,
    wrist_left,
    wrist_right,
    pinky_left,
    pinky_right,
    index_left,
    index_right,
    thumb_left,
    thumb_right,
    hip_left,
    hip_right,
    knee_left,
    knee_right,
    ankle_left,
    ankle_right,
    heel_left,
    heel_right,
    foot_index_left,
    foot_index_right,
};

pub const Landmark = struct {
    /// Screen position normalized to the SOURCE frame (0..1, y down).
    x: f32,
    y: f32,
    /// Screen-space depth in source-height units (debug tier — `world` is
    /// the real 3D signal).
    z: f32,
    /// Sigmoid probabilities. Visibility ≈ "is this joint unoccluded";
    /// presence ≈ "is this joint inside the frame".
    visibility: f32,
    presence: f32,
    /// World position in metres, hip-centred, MediaPipe axes (x right,
    /// y down, z toward the subject's rear), de-rotated to image alignment.
    world: [3]f32,
};

pub const PoseFrame = struct {
    landmarks: [LANDMARK_COUNT]Landmark,
    /// Pose-presence probability from the landmark graph. Below PRESENCE_MIN
    /// the landmarks are meaningless ("we looked, nobody there") — that is a
    /// successful solve, distinct from a lane failure (null returns).
    presence: f32,
    /// True when the ROI came from the previous frame's auxiliary landmarks
    /// rather than a detector run.
    tracked: bool,
};

pub const NO_POSE = PoseFrame{
    .landmarks = @splat(std.mem.zeroes(Landmark)),
    .presence = 0,
    .tracked = false,
};

pub const FrameIdentity = mailbox.FrameIdentity;
pub const SubmitStatus = mailbox.SubmitStatus;
pub const Frame = mailbox.Frame;
const BlazeLane = mailbox.Lane(PoseFrame);
pub const AsyncResult = BlazeLane.Result;

// ── SSD anchors ────────────────────────────────────────────────────────
//
// MediaPipe's SSD anchor calculator with strides [8,16,32,32,32], aspect
// ratio 1.0 + interpolated 1.0, fixed anchor size: consecutive same-stride
// layers merge, so per-cell anchor counts are 2 / 2 / 6. With fixed size
// every anchor at a cell is identical — only (cx, cy) matter, and decode is
// `raw / 224 + anchor`.
const AnchorGroup = struct { cells: usize, repeats: usize };
const ANCHOR_GROUPS = [_]AnchorGroup{
    .{ .cells = DETECT_INPUT / 8, .repeats = 2 },
    .{ .cells = DETECT_INPUT / 16, .repeats = 2 },
    .{ .cells = DETECT_INPUT / 32, .repeats = 6 },
};

pub const ANCHORS: [ANCHOR_COUNT][2]f32 = buildAnchors();

fn buildAnchors() [ANCHOR_COUNT][2]f32 {
    @setEvalBranchQuota(100_000);
    var anchors: [ANCHOR_COUNT][2]f32 = undefined;
    var index: usize = 0;
    for (ANCHOR_GROUPS) |group| {
        for (0..group.cells) |row| {
            for (0..group.cells) |col| {
                const cx = (@as(f32, @floatFromInt(col)) + 0.5) / @as(f32, @floatFromInt(group.cells));
                const cy = (@as(f32, @floatFromInt(row)) + 0.5) / @as(f32, @floatFromInt(group.cells));
                for (0..group.repeats) |_| {
                    anchors[index] = .{ cx, cy };
                    index += 1;
                }
            }
        }
    }
    std.debug.assert(index == ANCHOR_COUNT);
    return anchors;
}

// ── Global ORT state ───────────────────────────────────────────────────

const page_alloc = std.heap.page_allocator;

const Session = struct {
    session: ?*c.OrtSession = null,
    input_name: ?[:0]u8 = null,
    /// Output names in OUR canonical order (detector: regressors, scores;
    /// landmarks: screen, presence, world), resolved by element count.
    output_names: [3]?[:0]u8 = .{ null, null, null },
    output_count: usize = 0,

    fn release(self: *Session, api: *const c.OrtApi) void {
        if (self.session) |session| if (api.ReleaseSession) |fp| fp(session);
        self.session = null;
        if (self.input_name) |name| page_alloc.free(name);
        self.input_name = null;
        for (&self.output_names) |*name| {
            if (name.*) |owned| page_alloc.free(owned);
            name.* = null;
        }
        self.output_count = 0;
    }
};

var g_env: ?*c.OrtEnv = null;
var g_mem_info: ?*c.OrtMemoryInfo = null;
var g_detector: Session = .{};
var g_landmarks: Session = .{};
var g_init_done: bool = false;
var g_init_failed: bool = false;
var g_init_error: ?[]u8 = null;
var g_inference_mutex: std.Io.Mutex = .init;

/// Tracking-mode state: the ROI predicted by the previous confident solve.
/// Guarded by g_inference_mutex (one worker, engine thread never touches it).
var g_track_roi: ?Roi = null;
/// A detector-ROI crop and a tracked-ROI crop see the subject slightly
/// differently; re-baselining the filters on the first TRACKED solve stops
/// them chasing that systematic gap for hundreds of frames (req_4397).
var g_prime_filters_on_track: bool = false;

var g_async_initialized: bool = false;
var g_async: AsyncState = undefined;

/// Persistent inference inputs — the detector square and the landmark crop.
/// estimateRgba holds g_inference_mutex, so one set serves all callers.
var g_detect_scratch: [DETECT_INPUT * DETECT_INPUT * 3]f32 = undefined;
var g_landmark_scratch: [LANDMARK_INPUT * LANDMARK_INPUT * 3]f32 = undefined;

const AsyncState = struct {
    io: std.Io,
    environ: *const std.process.Environ.Map,
    queue: BlazeLane.Queue,
    tasks: std.Io.Group = .init,
};

pub fn initError() ?[]const u8 {
    return g_init_error;
}

/// Release a non-fatal OrtStatus from a session-tuning call — a failed knob
/// must not poison init (the session still works at ORT defaults).
fn discardStatus(api: *const c.OrtApi, status: ?*c.OrtStatus) void {
    if (status != null) if (api.ReleaseStatus) |fp| fp(status);
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

fn modelPath(
    io: std.Io,
    environ: *const std.process.Environ.Map,
    alloc: std.mem.Allocator,
    comptime file: []const u8,
) ?[]u8 {
    const home = environ.get("HOME") orelse return null;
    const path = std.fmt.allocPrint(alloc, "{s}/.reactjit/models/" ++ file, .{home}) catch return null;
    std.Io.Dir.cwd().access(io, path, .{}) catch {
        alloc.free(path);
        return null;
    };
    return path;
}

/// The expected element counts of each session's outputs, in OUR canonical
/// order. Batch/dynamic dims count as 1, so the products are conversion-
/// stable identities of the tensors.
const DETECTOR_OUTPUT_COUNTS = [_]usize{ ANCHOR_COUNT * DETECT_VALUES, ANCHOR_COUNT };
const LANDMARK_OUTPUT_COUNTS = [_]usize{ RAW_LANDMARK_COUNT * 5, 1, RAW_LANDMARK_COUNT * 3 };

fn resolveSessionIo(
    api: *const c.OrtApi,
    session: *Session,
    expected_counts: []const usize,
    what: []const u8,
) bool {
    const get_default_alloc = api.GetAllocatorWithDefaultOptions orelse {
        recordInitErr("GetAllocatorWithDefaultOptions null");
        return false;
    };
    var ort_alloc: ?*c.OrtAllocator = null;
    if (get_default_alloc(&ort_alloc) != null or ort_alloc == null) {
        recordInitErr("default OrtAllocator unavailable");
        return false;
    }

    var input_count: usize = 0;
    const get_in_count = api.SessionGetInputCount orelse return false;
    if (get_in_count(session.session, &input_count) != null or input_count != 1) {
        recordInitErr("model does not expose exactly one input");
        return false;
    }
    {
        const get_in_name = api.SessionGetInputName orelse return false;
        var raw_name: [*c]u8 = null;
        if (get_in_name(session.session, 0, ort_alloc, &raw_name) != null or raw_name == null) {
            recordInitErr("SessionGetInputName failed");
            return false;
        }
        defer if (api.AllocatorFree) |fp| discardStatus(api, fp(ort_alloc, raw_name));
        session.input_name = page_alloc.dupeZ(u8, std.mem.span(raw_name)) catch {
            recordInitErr("OOM duplicating input name");
            return false;
        };
    }

    var output_count: usize = 0;
    const get_out_count = api.SessionGetOutputCount orelse return false;
    if (get_out_count(session.session, &output_count) != null or output_count == 0) {
        recordInitErr("SessionGetOutputCount failed");
        return false;
    }
    const get_out_name = api.SessionGetOutputName orelse return false;
    const get_type_info = api.SessionGetOutputTypeInfo orelse return false;
    const cast_tensor_info = api.CastTypeInfoToTensorInfo orelse return false;
    const get_dims_count = api.GetDimensionsCount orelse return false;
    const get_dims = api.GetDimensions orelse return false;

    session.output_count = expected_counts.len;
    for (0..output_count) |index| {
        var type_info: ?*c.OrtTypeInfo = null;
        if (get_type_info(session.session, index, &type_info) != null or type_info == null) continue;
        defer if (api.ReleaseTypeInfo) |fp| fp(type_info);
        var tensor_info: ?*const c.OrtTensorTypeAndShapeInfo = null;
        if (cast_tensor_info(type_info, &tensor_info) != null or tensor_info == null) continue;
        var dims_count: usize = 0;
        if (get_dims_count(tensor_info, &dims_count) != null or dims_count == 0 or dims_count > 8) continue;
        var dims: [8]i64 = undefined;
        if (get_dims(tensor_info, &dims, dims_count) != null) continue;
        var elements: usize = 1;
        for (dims[0..dims_count]) |dim| {
            elements *= if (dim > 0) @as(usize, @intCast(dim)) else 1;
        }
        for (expected_counts, 0..) |expected, slot| {
            if (elements != expected or session.output_names[slot] != null) continue;
            var raw_name: [*c]u8 = null;
            if (get_out_name(session.session, index, ort_alloc, &raw_name) != null or raw_name == null) break;
            defer if (api.AllocatorFree) |fp| discardStatus(api, fp(ort_alloc, raw_name));
            session.output_names[slot] = page_alloc.dupeZ(u8, std.mem.span(raw_name)) catch null;
            break;
        }
    }
    for (expected_counts, 0..) |expected, slot| {
        if (session.output_names[slot] == null) {
            var buffer: [160]u8 = undefined;
            const msg = std.fmt.bufPrint(
                &buffer,
                "{s}: no output with {d} elements — wrong or truncated model file",
                .{ what, expected },
            ) catch what;
            recordInitErr(msg);
            return false;
        }
    }
    return true;
}

fn createSession(
    api: *const c.OrtApi,
    io: std.Io,
    environ: *const std.process.Environ.Map,
    comptime file: []const u8,
    slot: *Session,
    expected_counts: []const usize,
) bool {
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
    if (api.SetIntraOpNumThreads) |fp| discardStatus(api, fp(session_opts, INTRA_OP_THREADS));
    if (api.SetSessionGraphOptimizationLevel) |fp| discardStatus(api, fp(session_opts, c.ORT_ENABLE_ALL));
    if (api.AddSessionConfigEntry) |fp| discardStatus(api, fp(session_opts, "session.intra_op.allow_spinning", "0"));

    const path = modelPath(io, environ, page_alloc, file) orelse {
        recordInitErr("model not found at ~/.reactjit/models/" ++ file ++ " — download via scripts/fetch-pose-models");
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
    if (create_session(g_env, path_z.ptr, session_opts, &slot.session) != null) {
        recordInitErr("CreateSession(" ++ file ++ ") failed");
        return false;
    }
    return resolveSessionIo(api, slot, expected_counts, file);
}

fn ensureInit(io: std.Io, environ: *const std.process.Environ.Map) bool {
    if (g_init_done and g_detector.session != null and g_landmarks.session != null) return true;
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
        // CPU-only sessions; same logging posture as pose.zig.
        if (create_env(c.ORT_LOGGING_LEVEL_ERROR, "reactjit.blazepose", &g_env) != null) {
            recordInitErr("CreateEnv failed");
            return false;
        }
    }
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
    if (!createSession(api, io, environ, "blazepose_detector.onnx", &g_detector, &DETECTOR_OUTPUT_COUNTS)) return false;
    if (!createSession(api, io, environ, "blazepose_landmarks.onnx", &g_landmarks, &LANDMARK_OUTPUT_COUNTS)) return false;
    log.info("blazepose models loaded — detector + landmarks ready", .{});
    return true;
}

fn releaseOrt() void {
    if (onnx.api()) |api| {
        g_detector.release(api);
        g_landmarks.release(api);
        if (g_mem_info) |mem_info| if (api.ReleaseMemoryInfo) |fp| fp(mem_info);
        if (g_env) |env| if (api.ReleaseEnv) |fp| fp(env);
    }
    g_mem_info = null;
    g_env = null;
    if (g_init_error) |message| page_alloc.free(message);
    g_init_error = null;
    g_init_done = false;
    g_init_failed = false;
    g_track_roi = null;
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

/// Main-thread boundary: validate + copy one render-surface frame, then
/// return. Busy is backpressure, never an instruction to grow a frame queue.
pub fn enqueueRgba(io: std.Io, request_id: u32, rgba: []const u8, width: u32, height: u32) SubmitStatus {
    if (!g_async_initialized) return .stopped;
    return g_async.queue.submitCopy(io, request_id, rgba, width, height);
}

/// Native capture-session twin retaining an explicit immutable camera identity.
pub fn enqueueIdentifiedRgba(
    io: std.Io,
    identity: FrameIdentity,
    rgba: []const u8,
    width: u32,
    height: u32,
) SubmitStatus {
    if (!g_async_initialized) return .stopped;
    return g_async.queue.submitIdentifiedCopy(io, identity, rgba, width, height);
}

/// Engine-tick boundary: non-blocking take of the worker's completed result.
pub fn pollAsync(io: std.Io) ?AsyncResult {
    if (!g_async_initialized) return null;
    return g_async.queue.poll(io);
}

/// Drop the tracked ROI and all temporal filter state so the next solve
/// re-runs the detector cold. Camera changes and session opens must call
/// this — a stale ROI from another feed is a confidently wrong crop, and a
/// stale filter smears two feeds together.
pub fn resetTracking(io: std.Io) void {
    g_inference_mutex.lockUncancelable(io);
    defer g_inference_mutex.unlock(io);
    g_track_roi = null;
    g_filters.reset();
}

fn asyncWorkerLoop(state: *AsyncState) std.Io.Cancelable!void {
    while (try state.queue.waitTake(state.io)) |owned_frame_value| {
        var owned_frame: ?Frame = owned_frame_value;
        defer if (owned_frame) |*frame| frame.deinit();
        const started_ms = std.Io.Clock.now(.awake, state.io).toMilliseconds();
        const estimate = estimateRgba(
            state.io,
            state.environ,
            owned_frame.?.rgba,
            owned_frame.?.width,
            owned_frame.?.height,
            owned_frame.?.identity.timestamp_ms,
        );
        const elapsed_i64 = @max(0, std.Io.Clock.now(.awake, state.io).toMilliseconds() - started_ms);
        const elapsed_ms: u32 = @intCast(@min(elapsed_i64, @as(i64, std.math.maxInt(u32))));
        const result = if (estimate) |pose_frame|
            AsyncResult.success(owned_frame.?, pose_frame, elapsed_ms)
        else
            AsyncResult.failure(owned_frame.?, initError() orelse "blazepose inference failed", elapsed_ms);
        owned_frame = null;
        _ = state.queue.publish(state.io, result);
    }
}

// ── Geometry ───────────────────────────────────────────────────────────

/// Person ROI in SOURCE PIXELS: a rotated square. `cos_t`/`sin_t` cache the
/// rotation so crop sampling and back-projection share one transform.
pub const Roi = struct {
    center_x: f32,
    center_y: f32,
    side: f32,
    theta: f32,
    cos_t: f32,
    sin_t: f32,
};

// ── ROI lock (req_4397) ────────────────────────────────────────────────
//
// The tracking window is re-derived from landmarks every frame, and the
// landmarks are re-derived from the window — a closed loop with no fixed
// point under sensor noise: a STILL IMAGE fed on a loop kept jittering
// because each micro-shifted crop produced micro-shifted landmarks forever.
// The lock is a deadband on the window itself: when the candidate next ROI
// is within these fractions of the current one, the current ROI is KEPT
// EXACTLY. A held window + an unchanged input = a bit-identical crop, a
// deterministic solve, and a frozen skeleton — the still-image baseline.
// Landmarks keep moving freely WITHIN the held window, so this adds zero
// tracking lag; the window snaps loose the moment the subject actually
// travels.
const ROI_LOCK_CENTER_FRACTION: f32 = 0.01;
const ROI_LOCK_SIDE_FRACTION: f32 = 0.02;
const ROI_LOCK_THETA_RADIANS: f32 = 0.01;

fn roiSettled(current: Roi, candidate: Roi) bool {
    const dx = candidate.center_x - current.center_x;
    const dy = candidate.center_y - current.center_y;
    const center_delta = @sqrt(dx * dx + dy * dy);
    const side_delta = @abs(candidate.side - current.side);
    const theta_delta = @abs(normalizeRadians(candidate.theta - current.theta));
    return center_delta < current.side * ROI_LOCK_CENTER_FRACTION and
        side_delta < current.side * ROI_LOCK_SIDE_FRACTION and
        theta_delta < ROI_LOCK_THETA_RADIANS;
}

fn sigmoid(x: f32) f32 {
    return 1.0 / (1.0 + @exp(-std.math.clamp(x, -100.0, 100.0)));
}

// ── Temporal filtering (MediaPipe's smoothing stage, req_4389) ─────────
//
// Raw per-frame network output jitters at sensor-noise frequency, and the
// tracked ROI feeds landmarks back into the next frame's crop window, so an
// unfiltered pipeline oscillates visibly even on a motionless subject.
// MediaPipe stabilizes with One Euro filters on landmarks (scaled by ROI
// size so the cutoffs are resolution-invariant), a much stiffer One Euro on
// the aux ROI landmarks (calming the crop-window feedback loop), and a
// low-pass on visibilities (so confidence gates cannot flap frame-to-frame).
// Same filter family and constants here.

pub const OneEuroConfig = struct { min_cutoff: f32, beta: f32, derivate_cutoff: f32 };
const DEFAULT_FRAME_DT: f32 = 1.0 / 30.0;

/// The live-tunable smoothing surface (req_4391): the capture workbench
/// exposes these as sliders so stability is found by hand on real footage,
/// not guessed in code. min_cutoff — LOWER is calmer when still; beta —
/// HIGHER follows fast motion sooner; visibility_alpha — LOWER means
/// steadier confidence gates. Defaults are MediaPipe's own constants.
pub const SmoothingTuning = struct {
    screen_min_cutoff: f32 = 0.05,
    screen_beta: f32 = 80.0,
    world_min_cutoff: f32 = 0.1,
    world_beta: f32 = 40.0,
    aux_min_cutoff: f32 = 0.01,
    aux_beta: f32 = 10.0,
    visibility_alpha: f32 = 0.1,

    pub fn valid(self: SmoothingTuning) bool {
        // Bounds admit the sliders' full ±2-decade sweep around the defaults
        // (req_4397) while still refusing degenerate values.
        inline for ([_]f32{ self.screen_min_cutoff, self.world_min_cutoff, self.aux_min_cutoff }) |cutoff| {
            if (!std.math.isFinite(cutoff) or cutoff < 0.00001 or cutoff > 100.0) return false;
        }
        inline for ([_]f32{ self.screen_beta, self.world_beta, self.aux_beta }) |beta| {
            if (!std.math.isFinite(beta) or beta < 0 or beta > 10_000.0) return false;
        }
        return std.math.isFinite(self.visibility_alpha) and
            self.visibility_alpha > 0.0001 and self.visibility_alpha <= 1.0;
    }
};

/// Guarded by g_inference_mutex; the worker reads it once per solve.
var g_smoothing: SmoothingTuning = .{};

/// Replace the smoothing tuning for all subsequent solves. Rejects invalid
/// values wholesale — a half-applied tuning is worse than the old one.
pub fn setSmoothing(io: std.Io, tuning: SmoothingTuning) bool {
    if (!tuning.valid()) return false;
    g_inference_mutex.lockUncancelable(io);
    defer g_inference_mutex.unlock(io);
    g_smoothing = tuning;
    return true;
}

pub fn smoothing(io: std.Io) SmoothingTuning {
    g_inference_mutex.lockUncancelable(io);
    defer g_inference_mutex.unlock(io);
    return g_smoothing;
}

/// A geometric low-pass chases a constant forever without reaching it; once
/// the raw input sits within this distance of the filtered value the output
/// snaps to it exactly. 2e-4 frame-heights ≈ 0.2 px at 1080p (0.2 mm on the
/// world filters) — invisible during motion, and the difference between "a
/// still input decays asymptotically" and "a still input FREEZES" (req_4397).
const ONE_EURO_SNAP: f32 = 2.0e-4;

/// One Euro: a low-pass whose cutoff rises with speed — still signals get
/// heavy smoothing (jitter dies), fast motion gets light smoothing (no lag).
pub const OneEuro = struct {
    initialized: bool = false,
    value: f32 = 0,
    derivative: f32 = 0,

    fn smoothingAlpha(cutoff: f32, dt: f32) f32 {
        const tau = 1.0 / (2.0 * std.math.pi * cutoff);
        return 1.0 / (1.0 + tau / dt);
    }

    pub fn filter(self: *OneEuro, raw: f32, dt: f32, config: OneEuroConfig) f32 {
        if (!self.initialized) {
            self.* = .{ .initialized = true, .value = raw, .derivative = 0 };
            return raw;
        }
        if (@abs(raw - self.value) < ONE_EURO_SNAP) {
            self.value = raw;
            self.derivative = 0;
            return raw;
        }
        const raw_derivative = (raw - self.value) / dt;
        const derivative_alpha = smoothingAlpha(config.derivate_cutoff, dt);
        self.derivative = derivative_alpha * raw_derivative + (1 - derivative_alpha) * self.derivative;
        const cutoff = config.min_cutoff + config.beta * @abs(self.derivative);
        const alpha = smoothingAlpha(cutoff, dt);
        self.value = alpha * raw + (1 - alpha) * self.value;
        return self.value;
    }
};

const LowPass = struct {
    initialized: bool = false,
    value: f32 = 0,

    fn filter(self: *LowPass, raw: f32, alpha: f32) f32 {
        if (!self.initialized) {
            self.* = .{ .initialized = true, .value = raw };
            return raw;
        }
        self.value = alpha * raw + (1 - alpha) * self.value;
        return self.value;
    }
};

/// Guarded by g_inference_mutex like the tracking ROI. Reset on every
/// tracking (re)acquisition — filtering across a detector re-lock would
/// smear two different crops together.
const FilterState = struct {
    last_timestamp_ms: u64 = 0,
    screen: [LANDMARK_COUNT][2]OneEuro = std.mem.zeroes([LANDMARK_COUNT][2]OneEuro),
    world: [LANDMARK_COUNT][3]OneEuro = std.mem.zeroes([LANDMARK_COUNT][3]OneEuro),
    visibility: [LANDMARK_COUNT]LowPass = std.mem.zeroes([LANDMARK_COUNT]LowPass),
    landmark_presence: [LANDMARK_COUNT]LowPass = std.mem.zeroes([LANDMARK_COUNT]LowPass),
    aux: [2][2]OneEuro = std.mem.zeroes([2][2]OneEuro),

    fn reset(self: *FilterState) void {
        self.* = .{};
    }

    /// Seconds since the previous solve, clamped to sane frame times.
    /// Zero/backwards timestamps (legacy door, image probe) get the default.
    fn stepDt(self: *FilterState, timestamp_ms: u64) f32 {
        defer self.last_timestamp_ms = timestamp_ms;
        if (self.last_timestamp_ms == 0 or timestamp_ms <= self.last_timestamp_ms) return DEFAULT_FRAME_DT;
        const dt = @as(f32, @floatFromInt(timestamp_ms - self.last_timestamp_ms)) / 1000.0;
        return std.math.clamp(dt, 1.0 / 120.0, 0.25);
    }
};

var g_filters: FilterState = .{};

/// MediaPipe NormalizeRadians: wrap into [-π, π).
fn normalizeRadians(angle: f32) f32 {
    const two_pi = 2.0 * std.math.pi;
    return angle - two_pi * @floor((angle + std.math.pi) / two_pi);
}

/// ROI from a centre point and a scale point (both source pixels): square of
/// side 2·radius·1.25, rotated so centre→scale points up (90° target angle,
/// y-down image coords). Public because it IS the contract's ROI rule — the
/// unit suite pins it across the module boundary.
pub fn roiFromPoints(center_x: f32, center_y: f32, scale_x: f32, scale_y: f32) ?Roi {
    if (!std.math.isFinite(center_x) or !std.math.isFinite(center_y)) return null;
    const dx = scale_x - center_x;
    const dy = scale_y - center_y;
    const radius = @sqrt(dx * dx + dy * dy);
    if (!(std.math.isFinite(radius) and radius > 1.0)) return null;
    const theta = normalizeRadians(std.math.pi / 2.0 - std.math.atan2(-dy, dx));
    return .{
        .center_x = center_x,
        .center_y = center_y,
        .side = 2.0 * radius * ROI_EXPANSION,
        .theta = theta,
        .cos_t = @cos(theta),
        .sin_t = @sin(theta),
    };
}

/// Plain bilinear RGBA sample with zero border — the contract's parity
/// maker-or-breaker (antialiased resampling produced centimetre-scale
/// world-landmark errors in the reference spike).
fn sampleBilinear(rgba: []const u8, width: u32, height: u32, x: f32, y: f32, out: *[3]f32) void {
    const fx = @floor(x);
    const fy = @floor(y);
    const tx = x - fx;
    const ty = y - fy;
    const x0 = @as(i64, @intFromFloat(fx));
    const y0 = @as(i64, @intFromFloat(fy));
    var accum: [3]f32 = .{ 0, 0, 0 };
    const w_i64 = @as(i64, width);
    const h_i64 = @as(i64, height);
    inline for (0..2) |dy| {
        inline for (0..2) |dx| {
            const sx = x0 + @as(i64, dx);
            const sy = y0 + @as(i64, dy);
            const weight = (if (dx == 0) 1.0 - tx else tx) * (if (dy == 0) 1.0 - ty else ty);
            if (sx >= 0 and sx < w_i64 and sy >= 0 and sy < h_i64) {
                const at = (@as(usize, @intCast(sy)) * @as(usize, width) + @as(usize, @intCast(sx))) * 4;
                accum[0] += weight * @as(f32, @floatFromInt(rgba[at + 0]));
                accum[1] += weight * @as(f32, @floatFromInt(rgba[at + 1]));
                accum[2] += weight * @as(f32, @floatFromInt(rgba[at + 2]));
            }
        }
    }
    out.* = accum;
}

const Letterbox = struct {
    scale: f32,
    pad_x: f32,
    pad_y: f32,
};

fn letterboxInto(
    rgba: []const u8,
    width: u32,
    height: u32,
    comptime dst_size: usize,
    dst: []f32,
    comptime offset: f32,
    comptime divisor: f32,
) Letterbox {
    const dst_f = @as(f32, @floatFromInt(dst_size));
    const scale = @min(
        dst_f / @as(f32, @floatFromInt(width)),
        dst_f / @as(f32, @floatFromInt(height)),
    );
    const fit_w = @as(f32, @floatFromInt(width)) * scale;
    const fit_h = @as(f32, @floatFromInt(height)) * scale;
    const pad_x = (dst_f - fit_w) * 0.5;
    const pad_y = (dst_f - fit_h) * 0.5;
    // Exact warpAffine mapping (integer destination coords, no half-pixel
    // terms) — matching the reference implementation bit-for-bit is what the
    // parity numbers were proven against.
    var pixel: [3]f32 = undefined;
    for (0..dst_size) |ty| {
        const sy = (@as(f32, @floatFromInt(ty)) - pad_y) / scale;
        for (0..dst_size) |tx| {
            const sx = (@as(f32, @floatFromInt(tx)) - pad_x) / scale;
            sampleBilinear(rgba, width, height, sx, sy, &pixel);
            const at = (ty * dst_size + tx) * 3;
            dst[at + 0] = pixel[0] / divisor + offset;
            dst[at + 1] = pixel[1] / divisor + offset;
            dst[at + 2] = pixel[2] / divisor + offset;
        }
    }
    return .{ .scale = scale, .pad_x = pad_x, .pad_y = pad_y };
}

fn cropRoiInto(rgba: []const u8, width: u32, height: u32, roi: Roi, dst: []f32) void {
    const dst_f = @as(f32, @floatFromInt(LANDMARK_INPUT));
    var pixel: [3]f32 = undefined;
    for (0..LANDMARK_INPUT) |v| {
        const ny = @as(f32, @floatFromInt(v)) / dst_f - 0.5;
        for (0..LANDMARK_INPUT) |u| {
            const nx = @as(f32, @floatFromInt(u)) / dst_f - 0.5;
            const dx = nx * roi.side;
            const dy = ny * roi.side;
            const sx = roi.center_x + roi.cos_t * dx - roi.sin_t * dy;
            const sy = roi.center_y + roi.sin_t * dx + roi.cos_t * dy;
            sampleBilinear(rgba, width, height, sx, sy, &pixel);
            const at = (v * LANDMARK_INPUT + u) * 3;
            dst[at + 0] = pixel[0] / 255.0;
            dst[at + 1] = pixel[1] / 255.0;
            dst[at + 2] = pixel[2] / 255.0;
        }
    }
}

// ── ORT run helper ─────────────────────────────────────────────────────

fn runSession(
    api: *const c.OrtApi,
    session: *const Session,
    input: []f32,
    comptime input_size: usize,
    outputs: []?*c.OrtValue,
    where: []const u8,
) bool {
    var dims: [4]i64 = .{ 1, input_size, input_size, 3 };
    var input_val: ?*c.OrtValue = null;
    {
        const create_tensor = api.CreateTensorWithDataAsOrtValue orelse return false;
        const byte_count: usize = input.len * @sizeOf(f32);
        if (create_tensor(@ptrCast(g_mem_info), @ptrCast(input.ptr), byte_count, &dims, dims.len, c.ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &input_val) != null) {
            log.err("CreateTensorWithDataAsOrtValue failed ({s})", .{where});
            return false;
        }
    }
    defer if (api.ReleaseValue) |fp| fp(input_val);

    var in_names: [1][*:0]const u8 = .{session.input_name.?.ptr};
    var out_names: [3][*:0]const u8 = undefined;
    for (0..session.output_count) |slot| out_names[slot] = session.output_names[slot].?.ptr;
    var inputs: [1]?*c.OrtValue = .{input_val};
    {
        const run_fn = api.Run orelse return false;
        const status = run_fn(
            session.session,
            null,
            @as([*c]const [*c]const u8, @ptrCast(&in_names)),
            @as([*c]const ?*const c.OrtValue, @ptrCast(&inputs)),
            in_names.len,
            @as([*c]const [*c]const u8, @ptrCast(&out_names)),
            session.output_count,
            outputs.ptr,
        );
        if (status != null) {
            recordOrtErr(api, status, where);
            g_init_failed = false; // a bad frame shouldn't poison future calls
            return false;
        }
    }
    return true;
}

fn tensorData(api: *const c.OrtApi, value: ?*c.OrtValue) ?[*]const f32 {
    var data_ptr: ?*anyopaque = null;
    const get_data = api.GetTensorMutableData orelse return null;
    if (get_data(value, &data_ptr) != null or data_ptr == null) return null;
    return @ptrCast(@alignCast(data_ptr));
}

fn releaseOutputs(api: *const c.OrtApi, outputs: []?*c.OrtValue) void {
    if (api.ReleaseValue) |fp| {
        for (outputs) |value| if (value) |owned| fp(owned);
    }
    for (outputs) |*value| value.* = null;
}

// ── Detector ───────────────────────────────────────────────────────────

const InferError = error{Infra};

/// Run the person detector and derive the landmark ROI from the blended best
/// detection's mid-hip and scale alignment keypoints. Null when no candidate
/// clears the score floor (nobody in frame); error.Infra when the session
/// itself failed (recorded via recordOrtErr).
fn detectPersonRoi(api: *const c.OrtApi, rgba: []const u8, width: u32, height: u32) InferError!?Roi {
    const letterbox = letterboxInto(rgba, width, height, DETECT_INPUT, g_detect_scratch[0..], -1.0, 127.5);
    var outputs: [2]?*c.OrtValue = .{ null, null };
    if (!runSession(api, &g_detector, g_detect_scratch[0..], DETECT_INPUT, outputs[0..], "blazepose detector Run")) return error.Infra;
    defer releaseOutputs(api, outputs[0..]);
    const regressors = tensorData(api, outputs[0]) orelse return error.Infra;
    const score_logits = tensorData(api, outputs[1]) orelse return error.Infra;

    // Weighted NMS, single best cluster: find the top candidate, then blend
    // every ≥-threshold candidate overlapping it (IoU > 0.3), weighted by
    // score. One person per capture session by design.
    var best_index: ?usize = null;
    var best_score: f32 = DETECT_SCORE_MIN;
    for (0..ANCHOR_COUNT) |index| {
        const score = sigmoid(score_logits[index]);
        if (score >= best_score) {
            best_score = score;
            best_index = index;
        }
    }
    const top = best_index orelse return null;
    const top_box = decodeBox(regressors, top);

    var blended: [DETECT_VALUES]f32 = @splat(0);
    var weight_sum: f32 = 0;
    for (0..ANCHOR_COUNT) |index| {
        const score = sigmoid(score_logits[index]);
        if (score < DETECT_SCORE_MIN) continue;
        const box = decodeBox(regressors, index);
        if (iou(top_box, box) <= DETECT_NMS_IOU and index != top) continue;
        const raw = regressors[index * DETECT_VALUES ..][0..DETECT_VALUES];
        const anchor = ANCHORS[index];
        for (0..DETECT_VALUES) |value_index| {
            const decoded = switch (value_index) {
                0 => raw[0] / DETECT_INPUT_F + anchor[0],
                1 => raw[1] / DETECT_INPUT_F + anchor[1],
                2, 3 => raw[value_index] / DETECT_INPUT_F,
                else => if (value_index % 2 == 0)
                    raw[value_index] / DETECT_INPUT_F + anchor[0]
                else
                    raw[value_index] / DETECT_INPUT_F + anchor[1],
            };
            blended[value_index] += score * decoded;
        }
        weight_sum += score;
    }
    if (weight_sum <= 0) return null;
    for (&blended) |*value| value.* /= weight_sum;

    // Alignment keypoints, un-letterboxed into source pixels.
    const center = unLetterbox(blended[4 + KEYPOINT_MID_HIP * 2], blended[5 + KEYPOINT_MID_HIP * 2], letterbox);
    const scale_point = unLetterbox(blended[4 + KEYPOINT_SCALE * 2], blended[5 + KEYPOINT_SCALE * 2], letterbox);
    return roiFromPoints(center[0], center[1], scale_point[0], scale_point[1]);
}

const DETECT_INPUT_F: f32 = @floatFromInt(DETECT_INPUT);

const Box = struct { x0: f32, y0: f32, x1: f32, y1: f32 };

fn decodeBox(regressors: [*]const f32, index: usize) Box {
    const raw = regressors[index * DETECT_VALUES ..][0..DETECT_VALUES];
    const anchor = ANCHORS[index];
    const cx = raw[0] / DETECT_INPUT_F + anchor[0];
    const cy = raw[1] / DETECT_INPUT_F + anchor[1];
    const w = raw[2] / DETECT_INPUT_F;
    const h = raw[3] / DETECT_INPUT_F;
    return .{ .x0 = cx - w * 0.5, .y0 = cy - h * 0.5, .x1 = cx + w * 0.5, .y1 = cy + h * 0.5 };
}

fn iou(a: Box, b: Box) f32 {
    const ix = @max(0.0, @min(a.x1, b.x1) - @max(a.x0, b.x0));
    const iy = @max(0.0, @min(a.y1, b.y1) - @max(a.y0, b.y0));
    const intersection = ix * iy;
    const area_a = @max(0.0, a.x1 - a.x0) * @max(0.0, a.y1 - a.y0);
    const area_b = @max(0.0, b.x1 - b.x0) * @max(0.0, b.y1 - b.y0);
    const union_area = area_a + area_b - intersection;
    return if (union_area > 0) intersection / union_area else 0;
}

/// Letterbox-normalized (0..1 of the square) → source pixels.
fn unLetterbox(x: f32, y: f32, letterbox: Letterbox) [2]f32 {
    return .{
        (x * DETECT_INPUT_F - letterbox.pad_x) / letterbox.scale,
        (y * DETECT_INPUT_F - letterbox.pad_y) / letterbox.scale,
    };
}

// ── Landmark solve ─────────────────────────────────────────────────────

const RawSolve = struct {
    frame: PoseFrame,
    /// Next-frame tracking ROI predicted by aux landmarks 33/34, in source px.
    next_roi: ?Roi,
};

fn solveLandmarks(
    api: *const c.OrtApi,
    rgba: []const u8,
    width: u32,
    height: u32,
    roi: Roi,
    tracked: bool,
    dt: f32,
) InferError!RawSolve {
    cropRoiInto(rgba, width, height, roi, g_landmark_scratch[0..]);
    var outputs: [3]?*c.OrtValue = .{ null, null, null };
    if (!runSession(api, &g_landmarks, g_landmark_scratch[0..], LANDMARK_INPUT, outputs[0..], "blazepose landmarks Run")) return error.Infra;
    defer releaseOutputs(api, outputs[0..]);
    const screen = tensorData(api, outputs[0]) orelse return error.Infra;
    const presence = tensorData(api, outputs[1]) orelse return error.Infra;
    const world = tensorData(api, outputs[2]) orelse return error.Infra;

    const crop_f = @as(f32, @floatFromInt(LANDMARK_INPUT));
    const width_f = @as(f32, @floatFromInt(width));
    const height_f = @as(f32, @floatFromInt(height));
    // Filtering units are FRAME-HEIGHT-relative — a constant per camera.
    // Normalizing by roi.side (the earlier choice) coupled every filtered
    // value to the tracking window's own wobble: even a converged filter
    // output re-multiplied by a jittering side jitters (req_4397).
    const filter_scale = height_f;
    const screen_filter = OneEuroConfig{ .min_cutoff = g_smoothing.screen_min_cutoff, .beta = g_smoothing.screen_beta, .derivate_cutoff = 1.0 };
    const world_filter = OneEuroConfig{ .min_cutoff = g_smoothing.world_min_cutoff, .beta = g_smoothing.world_beta, .derivate_cutoff = 1.0 };
    const aux_filter = OneEuroConfig{ .min_cutoff = g_smoothing.aux_min_cutoff, .beta = g_smoothing.aux_beta, .derivate_cutoff = 1.0 };
    const visibility_alpha = g_smoothing.visibility_alpha;

    var solve = RawSolve{
        .frame = .{
            .landmarks = undefined,
            .presence = std.math.clamp(presence[0], 0, 1),
            .tracked = tracked,
        },
        .next_roi = null,
    };
    var source_px: [RAW_LANDMARK_COUNT][2]f32 = undefined;
    for (0..RAW_LANDMARK_COUNT) |index| {
        const raw = screen[index * 5 ..][0..5];
        const dx = (raw[0] / crop_f - 0.5) * roi.side;
        const dy = (raw[1] / crop_f - 0.5) * roi.side;
        source_px[index] = .{
            roi.center_x + roi.cos_t * dx - roi.sin_t * dy,
            roi.center_y + roi.sin_t * dx + roi.cos_t * dy,
        };
        if (index >= LANDMARK_COUNT) continue;
        const filtered_x = g_filters.screen[index][0].filter(source_px[index][0] / filter_scale, dt, screen_filter) * filter_scale;
        const filtered_y = g_filters.screen[index][1].filter(source_px[index][1] / filter_scale, dt, screen_filter) * filter_scale;
        const raw_world = world[index * 3 ..][0..3];
        // World landmarks rotate by the ROI rotation ONLY (no
        // scale/translate) — they are already metric and hip-centred.
        const rotated_world = [3]f32{
            roi.cos_t * raw_world[0] - roi.sin_t * raw_world[1],
            roi.sin_t * raw_world[0] + roi.cos_t * raw_world[1],
            raw_world[2],
        };
        solve.frame.landmarks[index] = .{
            .x = filtered_x / width_f,
            .y = filtered_y / height_f,
            .z = (raw[2] / crop_f) * roi.side / height_f,
            .visibility = g_filters.visibility[index].filter(sigmoid(raw[3]), visibility_alpha),
            .presence = g_filters.landmark_presence[index].filter(sigmoid(raw[4]), visibility_alpha),
            .world = .{
                g_filters.world[index][0].filter(rotated_world[0], dt, world_filter),
                g_filters.world[index][1].filter(rotated_world[1], dt, world_filter),
                g_filters.world[index][2].filter(rotated_world[2], dt, world_filter),
            },
        };
    }
    // The next tracking window derives from HEAVILY smoothed aux landmarks —
    // this is what breaks the crop→landmarks→crop oscillation.
    const aux_center_x = g_filters.aux[0][0].filter(source_px[AUX_ROI_CENTER][0] / filter_scale, dt, aux_filter) * filter_scale;
    const aux_center_y = g_filters.aux[0][1].filter(source_px[AUX_ROI_CENTER][1] / filter_scale, dt, aux_filter) * filter_scale;
    const aux_scale_x = g_filters.aux[1][0].filter(source_px[AUX_ROI_SCALE][0] / filter_scale, dt, aux_filter) * filter_scale;
    const aux_scale_y = g_filters.aux[1][1].filter(source_px[AUX_ROI_SCALE][1] / filter_scale, dt, aux_filter) * filter_scale;
    solve.next_roi = roiFromPoints(aux_center_x, aux_center_y, aux_scale_x, aux_scale_y);
    return solve;
}

// ── Full-pipeline entry points ─────────────────────────────────────────

/// Estimate the pose in an RGBA frame (top-down, stride w*4). Tracking mode:
/// reuses the previous confident solve's predicted ROI and only re-runs the
/// detector on loss; the temporal filters reset on every (re)acquisition.
/// `timestamp_ms` paces the One Euro filters — pass 0 when no real cadence
/// exists (single images) and the default frame time is assumed.
/// Returns null only for infra failures (missing models, ORT errors);
/// "nobody in frame" is a successful NO_POSE-shaped result.
pub fn estimateRgba(
    io: std.Io,
    environ: *const std.process.Environ.Map,
    rgba: []const u8,
    width: u32,
    height: u32,
    timestamp_ms: u64,
) ?PoseFrame {
    g_inference_mutex.lockUncancelable(io);
    defer g_inference_mutex.unlock(io);
    if (!ensureInit(io, environ)) return null;
    if (width == 0 or height == 0) return null;
    const api = onnx.api() orelse return null;

    const tracked = g_track_roi != null;
    if (!tracked) {
        g_filters.reset();
    } else if (g_prime_filters_on_track) {
        g_filters.reset();
        g_prime_filters_on_track = false;
    }
    const dt = g_filters.stepDt(timestamp_ms);
    var roi = g_track_roi orelse (detectPersonRoi(api, rgba, width, height) catch return null) orelse return NO_POSE;
    var solve = solveLandmarks(api, rgba, width, height, roi, tracked, dt) catch return null;
    if (solve.frame.presence < PRESENCE_MIN and tracked) {
        // The tracked ROI went stale (subject left it). One fresh detector
        // pass this frame before conceding; the filters restart with it.
        g_track_roi = null;
        g_filters.reset();
        roi = (detectPersonRoi(api, rgba, width, height) catch return null) orelse return NO_POSE;
        solve = solveLandmarks(api, rgba, width, height, roi, false, DEFAULT_FRAME_DT) catch return null;
    }
    g_track_roi = if (solve.frame.presence < PRESENCE_MIN)
        null
    else if (g_track_roi != null and solve.next_roi != null and roiSettled(g_track_roi.?, solve.next_roi.?))
        // Window locked (req_4397): an unchanged input now reproduces a
        // bit-identical crop and therefore a frozen solve.
        g_track_roi
    else
        solve.next_roi;
    if (!solve.frame.tracked) g_prime_filters_on_track = true;
    return solve.frame;
}

/// Still-input convergence probe (req_4397): feed one image through the
/// TRACKING path `frames` times (33 ms cadence) and report the worst screen
/// landmark delta between the last two solves, in frame-height units. Zero
/// is the contract for a still input — the ROI lock plus a deterministic
/// session leave the loop nothing to wander on. Null on infra failure or
/// when nobody is in the image.
pub fn probeStillConvergence(
    io: std.Io,
    environ: *const std.process.Environ.Map,
    path: [*:0]const u8,
    frames: u32,
) ?f32 {
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
    const rgba = pixels[0 .. @as(usize, w) * @as(usize, h) * 4];

    resetTracking(io);
    defer resetTracking(io);
    var previous: ?PoseFrame = null;
    var worst_delta: f32 = 0;
    for (0..@max(frames, 2)) |index| {
        const timestamp_ms: u64 = 1_000 + @as(u64, index) * 33;
        const solve = estimateRgba(io, environ, rgba, w, h, timestamp_ms) orelse return null;
        if (solve.presence < PRESENCE_MIN) return null;
        if (index + 2 >= @max(frames, 2)) {
            if (previous) |last| {
                worst_delta = 0;
                for (solve.landmarks, last.landmarks) |current, prior| {
                    worst_delta = @max(worst_delta, @abs(current.x - prior.x));
                    worst_delta = @max(worst_delta, @abs(current.y - prior.y));
                }
            }
            previous = solve;
        }
    }
    return worst_delta;
}

/// Estimate from an image FILE (stb) — the headless verification door.
/// Single-shot by definition: tracking and filter state reset first so a
/// probe never smears into (or inherits from) a live session.
pub fn estimateImage(io: std.Io, environ: *const std.process.Environ.Map, path: [*:0]const u8) ?PoseFrame {
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
    resetTracking(io);
    return estimateRgba(io, environ, pixels[0 .. @as(usize, w) * @as(usize, h) * 4], w, h, 0);
}
