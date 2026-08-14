//! One revisioned native door for character capture diagnostics.
//!
//! The JSON protocol is owned by skeleton/capture_session.zig. This binding
//! supplies only host mechanics:
//!
//! - snapshots a live V4L2 render feed into the bounded MoveNet mailbox;
//! - adopts the exact completed mailbox frame into retained native storage;
//! - publishes that immutable frame through `capture-session:<id>:camera`;
//! - forwards the same-ID source/target triplet through explicit target hooks.
//!
//! Target loading and target-pose publication intentionally remain callbacks.
//! The compiled-world character owner installs them, so capture cannot create
//! a second character loader or a second runtime pose ingress.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const HostContext = @import("host_context.zig");
const blazepose = @import("ml/blazepose.zig");
const render_surfaces = @import("render/render_surfaces.zig");
const capture = @import("skeleton/capture_session.zig");
const source = capture.source_skeleton;

// The skeleton consumes landmarks by index; the model emits them by index.
// One wire order, asserted here where both sides are visible.
comptime {
    const skeleton_fields = @typeInfo(source.WorldLandmarkName).@"enum".fields;
    const model_fields = @typeInfo(blazepose.LandmarkName).@"enum".fields;
    if (skeleton_fields.len != model_fields.len) @compileError("WorldLandmarkName / blazepose.LandmarkName length mismatch");
    for (skeleton_fields, model_fields) |skeleton_field, model_field| {
        if (!std.mem.eql(u8, skeleton_field.name, model_field.name) or skeleton_field.value != model_field.value) {
            @compileError("WorldLandmarkName order must match blazepose.LandmarkName: " ++ skeleton_field.name);
        }
    }
}

const log = std.log.scoped(.capture_session_host);
const allocator = std.heap.c_allocator;

const HOST_TUNING = struct {
    /// Native inference is serial and begins no faster than ~30 Hz. The next
    /// solve may start immediately after completion once this floor elapsed.
    const minimum_submit_interval_ms: u64 = 33;
};

const MANAGED_REQUEST_BIT: u32 = 0x8000_0000;
const MANAGED_REQUEST_LAST: u32 = 0xffff_fffe;
const FRAME_SLOT_COUNT: usize = capture.MAX_PENDING_INFERENCE_FRAMES + 2;
const SESSION_ID_BYTES: usize = 32;

/// The sole integration seam with the mounted saved-character owner.
///
/// `load_target` must hash-check already-saved artifacts and return their
/// stable canonical palette; it must never fit or solve. `publish_triplet`
/// receives one transaction whose camera, detected, reconstructed, and target
/// frame IDs have already been proven identical by capture_session.Manager.
pub const TargetHooks = struct {
    context: ?*anyopaque = null,
    load_target: *const fn (
        ?*anyopaque,
        session_id: []const u8,
        descriptor: capture.TargetDescriptor,
    ) anyerror!capture.TargetRigView,
    activate_target: *const fn (
        ?*anyopaque,
        session_id: []const u8,
        camera_render_source: []const u8,
        descriptor: capture.TargetDescriptor,
    ) anyerror!void,
    publish_triplet: *const fn (?*anyopaque, capture.DiagnosticPublication) anyerror!void,
    clear_triplet: *const fn (
        ?*anyopaque,
        session_id: []const u8,
        camera_render_source: []const u8,
        viewport_node_id: u32,
    ) void,
    close_target: *const fn (
        ?*anyopaque,
        session_id: []const u8,
        camera_render_source: []const u8,
        viewport_node_id: u32,
    ) void,
    /// Persist one encoded RJAN motion document (req_4285). Optional so a
    /// host without a motion store still captures live; recordStop then
    /// refuses loudly instead of losing takes silently.
    save_motion: ?*const fn (
        ?*anyopaque,
        directory: []const u8,
        encoded: []const u8,
    ) anyerror!capture.SavedMotion = null,
};

var g_target_hooks: ?TargetHooks = null;

/// Install before opening a capture target and remove only after its session
/// closes. There is one process-wide capture session by contract.
pub fn setTargetHooks(hooks: ?TargetHooks) void {
    g_target_hooks = hooks;
}

const FrameSlot = struct {
    token: u64 = 0,
    request_id: u32 = 0,
    frame_id: u64 = 0,
    timestamp_ms: u64 = 0,
    width: u32 = 0,
    height: u32 = 0,
    retain_count: u8 = 0,
    frame: ?blazepose.Frame = null,

    fn reset(self: *FrameSlot) void {
        if (self.frame) |*owned| owned.deinit();
        self.* = .{};
    }
};

const FrameStore = struct {
    slots: [FRAME_SLOT_COUNT]FrameSlot = [_]FrameSlot{.{}} ** FRAME_SLOT_COUNT,
    next_token: u64 = 1,
    visible_token: u64 = 0,
    visible_source_buf: [96]u8 = undefined,
    visible_source_len: usize = 0,

    fn find(self: *FrameStore, token: u64) ?*FrameSlot {
        if (token == 0) return null;
        for (&self.slots) |*slot| {
            if (slot.token == token) return slot;
        }
        return null;
    }

    fn reserve(
        self: *FrameStore,
        request_id: u32,
        frame_id: u64,
        timestamp_ms: u64,
        width: u32,
        height: u32,
    ) !u64 {
        if (self.next_token == 0 or self.next_token == std.math.maxInt(u64)) {
            return error.CameraFrameTokenExhausted;
        }
        var vacant: ?*FrameSlot = null;
        for (&self.slots) |*slot| {
            if (slot.token == 0) {
                vacant = slot;
                break;
            }
        }
        const slot = vacant orelse return error.ImmutableFrameCapacity;
        const token = self.next_token;
        self.next_token += 1;
        slot.* = .{
            .token = token,
            .request_id = request_id,
            .frame_id = frame_id,
            .timestamp_ms = timestamp_ms,
            .width = width,
            .height = height,
        };
        return token;
    }

    fn abandonReservation(self: *FrameStore, token: u64) void {
        const slot = self.find(token) orelse return;
        if (slot.retain_count == 0) slot.reset();
    }

    fn retain(self: *FrameStore, immutable: capture.ImmutableCameraFrame) !void {
        const slot = self.find(immutable.identity.token) orelse return error.UnknownImmutableFrame;
        const expected_stride = std.math.mul(u32, immutable.width, 4) catch return error.ImmutableFrameIdentityMismatch;
        if (slot.frame_id != immutable.identity.frame_id or
            slot.timestamp_ms != immutable.identity.timestamp_ms or
            slot.width != immutable.width or slot.height != immutable.height or
            immutable.stride_bytes != expected_stride)
        {
            return error.ImmutableFrameIdentityMismatch;
        }
        if (slot.retain_count == std.math.maxInt(u8)) return error.ImmutableFrameLeaseOverflow;
        slot.retain_count += 1;
    }

    fn release(self: *FrameStore, immutable: capture.ImmutableCameraFrame) void {
        const slot = self.find(immutable.identity.token) orelse return;
        if (slot.frame_id != immutable.identity.frame_id or slot.timestamp_ms != immutable.identity.timestamp_ms) return;
        if (slot.retain_count == 0) return;
        slot.retain_count -= 1;
        if (slot.retain_count == 0) {
            if (self.visible_token == slot.token) self.clearVisible(null);
            slot.reset();
        }
    }

    /// Move the mailbox-owned frame into its already-retained token. The
    /// caller's frame becomes empty on success and remains owned on failure.
    fn adopt(self: *FrameStore, token: u64, owned: *blazepose.Frame) !void {
        const slot = self.find(token) orelse return error.UnknownImmutableFrame;
        if (slot.retain_count == 0 or slot.frame != null) return error.InvalidImmutableFrameLease;
        if (slot.request_id != owned.identity.request_id or
            slot.frame_id != owned.identity.frame_id or
            slot.timestamp_ms != owned.identity.timestamp_ms or
            slot.width != owned.width or slot.height != owned.height)
        {
            return error.ImmutableFrameIdentityMismatch;
        }
        slot.frame = owned.*;
        owned.rgba = &.{};
    }

    fn validatePublication(self: *FrameStore, source_name: []const u8, token: u64) !void {
        const slot = self.find(token) orelse return error.UnknownImmutableFrame;
        if (slot.frame == null or slot.retain_count == 0) return error.InvalidImmutableFrameLease;
        if (source_name.len > self.visible_source_buf.len) return error.RenderSourceTooLong;
    }

    fn publishValidated(self: *FrameStore, source_name: []const u8, token: u64) void {
        @memcpy(self.visible_source_buf[0..source_name.len], source_name);
        self.visible_source_len = source_name.len;
        self.visible_token = token;
    }

    /// `null` clears regardless of source. A named clear cannot tear down a
    /// newer session's publication.
    fn clearVisible(self: *FrameStore, source_name: ?[]const u8) void {
        if (source_name) |name| {
            if (!std.mem.eql(u8, self.visible_source_buf[0..self.visible_source_len], name)) return;
        }
        self.visible_token = 0;
        self.visible_source_len = 0;
    }

    fn memoryFrame(self: *FrameStore, source_name: []const u8) ?render_surfaces.MemoryFrame {
        if (self.visible_token == 0 or
            !std.mem.eql(u8, self.visible_source_buf[0..self.visible_source_len], source_name))
        {
            return null;
        }
        const slot = self.find(self.visible_token) orelse return null;
        const owned = slot.frame orelse return null;
        return .{
            .width = owned.width,
            .height = owned.height,
            .rgba = owned.rgba,
            .generation = slot.token,
        };
    }
};

const ActiveRequest = struct {
    request_id: u32,
    frame_id: u64,
    timestamp_ms: u64,
    token: u64,
    session_id_buf: [SESSION_ID_BYTES]u8 = undefined,
    session_id_len: usize = 0,

    fn sessionId(self: *const ActiveRequest) []const u8 {
        return self.session_id_buf[0..self.session_id_len];
    }
};

var g_manager: ?capture.Manager = null;
var g_host: ?*HostContext = null;
var g_frame_store: FrameStore = .{};
var g_active_request: ?ActiveRequest = null;
var g_next_request_id: u32 = MANAGED_REQUEST_BIT;
var g_next_frame_id: u64 = 1;
var g_last_submit_ms: ?u64 = null;
/// The session the last submit belonged to. A change means a fresh camera —
/// the model's tracked ROI must not survive it.
var g_last_session_buf: [SESSION_ID_BYTES]u8 = undefined;
var g_last_session_len: usize = 0;

fn monotonicNowMs(_: ?*anyopaque) u64 {
    const host = g_host orelse return 0;
    const now = std.Io.Clock.now(.awake, host.io).toMilliseconds();
    return @intCast(@max(0, now));
}

fn targetLoad(
    _: ?*anyopaque,
    session_id: []const u8,
    descriptor: capture.TargetDescriptor,
) anyerror!capture.TargetRigView {
    const hooks = g_target_hooks orelse return error.CaptureTargetHooksUnavailable;
    return hooks.load_target(hooks.context, session_id, descriptor);
}

fn targetActivate(
    _: ?*anyopaque,
    session_id: []const u8,
    camera_render_source: []const u8,
    descriptor: capture.TargetDescriptor,
) anyerror!void {
    const hooks = g_target_hooks orelse return error.CaptureTargetHooksUnavailable;
    return hooks.activate_target(hooks.context, session_id, camera_render_source, descriptor);
}

fn retainFrame(_: ?*anyopaque, immutable: capture.ImmutableCameraFrame) anyerror!void {
    try g_frame_store.retain(immutable);
}

fn releaseFrame(_: ?*anyopaque, immutable: capture.ImmutableCameraFrame) void {
    g_frame_store.release(immutable);
}

fn targetPublish(_: ?*anyopaque, publication: capture.DiagnosticPublication) anyerror!void {
    // Prove the immutable camera commit cannot fail, then publish the target
    // pose, then flip the camera token. No callback exposes camera N if the
    // mounted target rejected pose N.
    try g_frame_store.validatePublication(
        publication.camera_render_source,
        publication.camera_frame.identity.token,
    );
    const hooks = g_target_hooks orelse return error.CaptureTargetHooksUnavailable;
    try hooks.publish_triplet(hooks.context, publication);
    g_frame_store.publishValidated(
        publication.camera_render_source,
        publication.camera_frame.identity.token,
    );
}

fn targetClear(
    _: ?*anyopaque,
    session_id: []const u8,
    camera_render_source: []const u8,
    viewport_node_id: u32,
) void {
    g_frame_store.clearVisible(camera_render_source);
    if (g_target_hooks) |hooks| {
        hooks.clear_triplet(hooks.context, session_id, camera_render_source, viewport_node_id);
    }
}

fn targetClose(
    _: ?*anyopaque,
    session_id: []const u8,
    camera_render_source: []const u8,
    viewport_node_id: u32,
) void {
    g_frame_store.clearVisible(camera_render_source);
    if (g_target_hooks) |hooks| {
        hooks.close_target(hooks.context, session_id, camera_render_source, viewport_node_id);
    }
}

fn targetSaveMotion(_: ?*anyopaque, directory: []const u8, encoded: []const u8) anyerror!capture.SavedMotion {
    const hooks = g_target_hooks orelse return error.CaptureTargetHooksUnavailable;
    const save = hooks.save_motion orelse return error.MotionStoreUnavailable;
    return save(hooks.context, directory, encoded);
}

fn memoryFrameProvider(source_name: []const u8) ?render_surfaces.MemoryFrame {
    return g_frame_store.memoryFrame(source_name);
}

fn ensureManager(host: *HostContext) !*capture.Manager {
    g_host = host;
    if (g_manager == null) {
        g_manager = try capture.Manager.init(allocator, .{
            .now_ms = monotonicNowMs,
            .load_target = targetLoad,
            .activate_target = targetActivate,
            .retain_frame = retainFrame,
            .release_frame = releaseFrame,
            .publish_triplet = targetPublish,
            .clear_triplet = targetClear,
            .close_target = targetClose,
            .save_motion = targetSaveMotion,
        }, capture.DEFAULT_TUNING);
    }
    return &g_manager.?;
}

fn argString(info: v8.FunctionCallbackInfo, index: u32, alloc: std.mem.Allocator) ?[]u8 {
    if (index >= info.length()) return null;
    const isolate = info.getIsolate();
    const context = isolate.getCurrentContext();
    const string = info.getArg(index).toString(context) catch return null;
    const length = string.lenUtf8(isolate);
    const bytes = alloc.alloc(u8, length) catch return null;
    _ = string.writeUtf8(isolate, bytes);
    return bytes;
}

fn setReturnString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), value));
}

pub fn hostCaptureSession(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const request = argString(info, 0, allocator) orelse {
        setReturnString(info, "{\"ok\":false,\"error\":\"missing capture session request\"}");
        return;
    };
    defer allocator.free(request);
    const manager = ensureManager(v8_runtime.hostContext(info.getIsolate())) catch |err| {
        var error_buffer: [160]u8 = undefined;
        const reply = std.fmt.bufPrint(
            &error_buffer,
            "{{\"ok\":false,\"error\":\"capture session unavailable: {s}\"}}",
            .{@errorName(err)},
        ) catch "{\"ok\":false,\"error\":\"capture session unavailable\"}";
        setReturnString(info, reply);
        return;
    };
    const reply = manager.handle(request) catch {
        setReturnString(info, "{\"ok\":false,\"error\":\"capture session allocation failure\"}");
        return;
    };
    defer allocator.free(reply);
    setReturnString(info, reply);
}

fn allocateManagedRequestId() u32 {
    const request_id = g_next_request_id;
    g_next_request_id = if (g_next_request_id >= MANAGED_REQUEST_LAST)
        MANAGED_REQUEST_BIT
    else
        g_next_request_id + 1;
    return request_id;
}

fn allocateFrameId() !u64 {
    if (g_next_frame_id == 0 or g_next_frame_id == std.math.maxInt(u64)) return error.CameraFrameIdExhausted;
    const frame_id = g_next_frame_id;
    g_next_frame_id += 1;
    return frame_id;
}

fn discardActive(manager: *capture.Manager, active: ActiveRequest) void {
    manager.discardInference(active.sessionId(), active.frame_id) catch {};
    g_frame_store.abandonReservation(active.token);
}

/// Start at most one native capture solve. All calls are non-blocking; the
/// bounded pose mailbox performs the RGBA copy before returning `.queued`.
pub fn tickSubmit(host: *HostContext) void {
    if (g_active_request != null) return;
    const manager = ensureManager(host) catch return;
    const target = manager.inferenceTarget() orelse return;
    if (target.frozen or target.pending_count != 0) return;
    const now_ms = monotonicNowMs(null);
    if (g_last_submit_ms) |last| {
        if (now_ms -| last < HOST_TUNING.minimum_submit_interval_ms) return;
    }
    const frame = render_surfaces.latestCpuFrame(target.camera_source) orelse return;
    if (target.session_id.len > SESSION_ID_BYTES) return;
    const stride_bytes = std.math.mul(u32, frame.width, 4) catch return;
    const request_id = allocateManagedRequestId();
    const frame_id = allocateFrameId() catch return;
    const token = g_frame_store.reserve(request_id, frame_id, now_ms, frame.width, frame.height) catch return;
    const immutable = capture.ImmutableCameraFrame{
        .identity = .{ .frame_id = frame_id, .timestamp_ms = now_ms, .token = token },
        .width = frame.width,
        .height = frame.height,
        .stride_bytes = stride_bytes,
    };
    manager.beginInference(target.session_id, immutable) catch {
        g_frame_store.abandonReservation(token);
        return;
    };

    var active = ActiveRequest{
        .request_id = request_id,
        .frame_id = frame_id,
        .timestamp_ms = now_ms,
        .token = token,
    };
    @memcpy(active.session_id_buf[0..target.session_id.len], target.session_id);
    active.session_id_len = target.session_id.len;

    if (!std.mem.eql(u8, g_last_session_buf[0..g_last_session_len], target.session_id)) {
        blazepose.resetTracking(host.io);
        @memcpy(g_last_session_buf[0..target.session_id.len], target.session_id);
        g_last_session_len = target.session_id.len;
    }
    const status = blazepose.enqueueIdentifiedRgba(host.io, .{
        .request_id = request_id,
        .frame_id = frame_id,
        .timestamp_ms = now_ms,
    }, frame.rgba, frame.width, frame.height);
    if (status != .queued) {
        discardActive(manager, active);
        return;
    }
    g_active_request = active;
    g_last_submit_ms = now_ms;
}

fn worldFrame(result: *const blazepose.AsyncResult) source.WorldLandmarkFrame {
    var landmarks: [source.WORLD_LANDMARK_COUNT]source.WorldLandmark = undefined;
    for (result.payload.landmarks, 0..) |landmark, index| {
        landmarks[index] = .{
            .screen = .{ landmark.x, landmark.y },
            .world = .{ landmark.world[0], landmark.world[1], landmark.world[2] },
            // The skeleton's confidence is the JOINT of "unoccluded" and
            // "actually inside the frame" — presence is what knows a
            // sitting subject has no legs on camera, and it is the signal
            // that stops hallucinated limbs from driving the rig (req_4389).
            .visibility = std.math.clamp(@min(landmark.visibility, landmark.presence), 0, 1),
        };
    }
    return .{
        .frame_id = result.frame_id,
        .timestamp_ms = result.timestamp_ms,
        .presence = std.math.clamp(result.payload.presence, 0, 1),
        .landmarks = landmarks,
    };
}

/// Consume only high-bit request IDs reserved by this binding — the
/// BlazePose lane is capture's, but the reservation bit stays the contract.
pub fn consumePoseResult(host: *HostContext, result: *blazepose.AsyncResult) bool {
    _ = host;
    if ((result.request_id & MANAGED_REQUEST_BIT) == 0) return false;
    const active = g_active_request orelse return true;
    if (active.request_id != result.request_id) {
        if (g_manager) |*manager| discardActive(manager, active);
        g_active_request = null;
        return true;
    }
    g_active_request = null;
    const manager = if (g_manager) |*value| value else return true;

    if (active.frame_id != result.frame_id or active.timestamp_ms != result.timestamp_ms) {
        discardActive(manager, active);
        return true;
    }
    if (!result.ok) {
        discardActive(manager, active);
        return true;
    }

    var owned = result.takeFrame() orelse {
        discardActive(manager, active);
        return true;
    };
    if (g_frame_store.adopt(active.token, &owned)) |_| {
        _ = manager.ingestCompletedFrame(active.sessionId(), worldFrame(result)) catch |err| {
            log.debug("capture frame {d} discarded: {s}", .{ active.frame_id, @errorName(err) });
        };
    } else |err| {
        log.debug("capture frame {d} storage rejected: {s}", .{ active.frame_id, @errorName(err) });
        owned.deinit();
        discardActive(manager, active);
    }
    return true;
}

pub fn register(host: *HostContext) void {
    _ = ensureManager(host) catch {};
    render_surfaces.setMemoryFrameProvider(memoryFrameProvider);
}
