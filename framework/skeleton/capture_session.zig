//! Revisioned native capture/retarget session.
//!
//! The public JSON surface is deliberately small: openTarget, calibrate,
//! freeze, resume, record, recordStop, snapshot, and close.
//! Camera inference enters through the non-JSON
//! beginInference/ingestCompletedFrame seam. A retained immutable RGBA frame
//! is assigned before inference and that exact frame is transferred into the
//! promoted detected/source/target triplet. While a recording is active,
//! every promoted target frame also lands in a role-addressed RJAN motion
//! document (req_4285) — capture attributes to something durable.
//!
//! Manager calls and frame completions must be serialized by the host. The
//! frame-store hooks own synchronization for their opaque RGBA tokens.

const std = @import("std");
const retarget = @import("humanoid_retarget.zig");
const source = retarget.source;
const rig = retarget.rig;
const canonical = @import("generated/humanoid_v1.zig");
const motion = @import("motion_document.zig");

pub const humanoid_retarget = retarget;
pub const source_skeleton = source;
pub const canonical_humanoid = canonical;
pub const motion_document = motion;

pub const MAX_PENDING_INFERENCE_FRAMES: usize = 8;

pub const Tuning = struct {
    /// Host back-pressure limit. The compile-time capacity is a safety ceiling,
    /// while this value is the behavior-affecting limit.
    max_pending_frames: usize = 4,
};

pub const DEFAULT_TUNING = Tuning{};

pub const TargetDescriptor = struct {
    geometry_path: []const u8,
    skin_path: []const u8,
    skeleton_json: []const u8,
    camera_source: []const u8,
    viewport_node_id: u32,
};

/// Borrowed result from the strict saved-character loader. The session copies
/// both slices synchronously before loadTarget returns to the host boundary.
pub const TargetRigView = struct {
    bone_ids: []const []const u8,
    bones: []const rig.Bone,
};

/// Metadata for an immutable RGBA allocation held by the host frame store.
/// `token` identifies the pixels; retainFrame/releaseFrame own its lifetime.
pub const ImmutableCameraFrame = struct {
    identity: retarget.CameraFrameRef,
    width: u32,
    height: u32,
    stride_bytes: u32,
};

pub const DiagnosticPublication = struct {
    session_id: []const u8,
    camera_render_source: []const u8,
    viewport_node_id: u32,
    camera_frame: ImmutableCameraFrame,
    triplet: *const retarget.CompletedTriplet,
    bone_ids: []const []const u8,
    target_global_matrices: []const rig.Mat4,
};

fn zeroNow(_: ?*anyopaque) u64 {
    return 0;
}

fn unavailableLoadTarget(_: ?*anyopaque, _: []const u8, _: TargetDescriptor) anyerror!TargetRigView {
    return error.TargetArtifactLoaderUnavailable;
}

fn unavailableActivateTarget(
    _: ?*anyopaque,
    _: []const u8,
    _: []const u8,
    _: TargetDescriptor,
) anyerror!void {
    return error.TargetViewportUnavailable;
}

fn unavailableRetainFrame(_: ?*anyopaque, _: ImmutableCameraFrame) anyerror!void {
    return error.ImmutableFrameStoreUnavailable;
}

fn ignoreReleaseFrame(_: ?*anyopaque, _: ImmutableCameraFrame) void {}
fn ignorePublication(_: ?*anyopaque, _: DiagnosticPublication) anyerror!void {}
fn ignoreClear(_: ?*anyopaque, _: []const u8, _: []const u8, _: u32) void {}
fn ignoreClose(_: ?*anyopaque, _: []const u8, _: []const u8, _: u32) void {}
fn unavailableSaveMotion(_: ?*anyopaque, _: []const u8, _: []const u8) anyerror!SavedMotion {
    return error.MotionStoreUnavailable;
}

/// The host-side write result for one persisted motion document. Fixed-size
/// so ownership never crosses the hook boundary.
pub const SavedMotion = struct {
    path_buf: [512]u8 = undefined,
    path_len: usize = 0,

    pub fn path(self: *const SavedMotion) []const u8 {
        return self.path_buf[0..self.path_len];
    }

    pub fn set(self: *SavedMotion, value: []const u8) !void {
        if (value.len == 0 or value.len > self.path_buf.len) return error.InvalidMotionPath;
        @memcpy(self.path_buf[0..value.len], value);
        self.path_len = value.len;
    }
};

/// Host integration boundary.
///
/// * load_target hard-loads/hash-checks RJMD, RJSK, and the skeleton and returns
///   the stable canonical palette plus rig bones. It must never run a solver.
/// * activate_target mounts the bind/deformed viewport and registers
///   `camera_render_source`; it is keyed by session id so replacing a session
///   cannot let closing the old id tear down the new one.
/// * retain_frame/release_frame lease exact immutable RGBA storage.
/// * publish_triplet atomically updates the target viewport and retained camera
///   render source. Publication is fallible: the session will not hand a newer
///   snapshot to React unless both native panes accepted that exact frame.
/// * clear_triplet stops serving a prior camera/pose transaction.
/// * close_target stops inference, unregisters the source, and unmounts only
///   resources owned by the supplied session id.
pub const Hooks = struct {
    context: ?*anyopaque = null,
    now_ms: *const fn (?*anyopaque) u64 = zeroNow,
    load_target: *const fn (?*anyopaque, []const u8, TargetDescriptor) anyerror!TargetRigView = unavailableLoadTarget,
    activate_target: *const fn (?*anyopaque, []const u8, []const u8, TargetDescriptor) anyerror!void = unavailableActivateTarget,
    retain_frame: *const fn (?*anyopaque, ImmutableCameraFrame) anyerror!void = unavailableRetainFrame,
    release_frame: *const fn (?*anyopaque, ImmutableCameraFrame) void = ignoreReleaseFrame,
    publish_triplet: *const fn (?*anyopaque, DiagnosticPublication) anyerror!void = ignorePublication,
    clear_triplet: *const fn (?*anyopaque, []const u8, []const u8, u32) void = ignoreClear,
    close_target: *const fn (?*anyopaque, []const u8, []const u8, u32) void = ignoreClose,
    /// Persist one encoded RJAN motion document into `directory` and return
    /// the written path. The session stays io-free; the host owns file law.
    save_motion: *const fn (?*anyopaque, []const u8, []const u8) anyerror!SavedMotion = unavailableSaveMotion,
};

/// Descriptive alias used by host integration sites that own the one mounted
/// target publisher. `Hooks` remains the concise constructor spelling.
pub const TargetHooks = Hooks;

pub const IngestResult = enum {
    awaiting_calibration,
    invalid_calibration_frame,
    calibration_progress,
    calibration_failed,
    promoted,
};

/// Borrowed, read-only scheduler view. It deliberately exposes neither target
/// geometry nor mutation; the host submits only when `!frozen` and
/// `pending_count == 0` for the current one-request pose mailbox.
pub const InferenceTarget = struct {
    session_id: []const u8,
    camera_source: []const u8,
    frozen: bool,
    pending_count: usize,
};

const OwnedTarget = struct {
    geometry_path: []const u8 = "",
    skin_path: []const u8 = "",
    skeleton_json: []const u8 = "",
    camera_source: []const u8 = "",
    viewport_node_id: u32 = 0,

    fn descriptor(self: OwnedTarget) TargetDescriptor {
        return .{
            .geometry_path = self.geometry_path,
            .skin_path = self.skin_path,
            .skeleton_json = self.skeleton_json,
            .camera_source = self.camera_source,
            .viewport_node_id = self.viewport_node_id,
        };
    }
};

const PendingFrame = struct {
    frame: ImmutableCameraFrame,
    inference_generation: u64,
};

const MAX_RECORD_CHANNELS: usize = retarget.DRIVEN_CHANNEL_IDS.len;

/// The capture recording tap (req_4285). Promoted target frames accumulate as
/// bind-relative deltas per driven role channel — the motion document
/// transport currency — so a stopped take replays on any body that binds the
/// recorded roles, not only the target it was captured against.
const Recording = struct {
    channel_count: usize = 0,
    channel_bones: [MAX_RECORD_CHANNELS]u16 = undefined,
    channel_ids: [MAX_RECORD_CHANNELS][]const u8 = undefined,
    first_timestamp_ms: ?u64 = null,
    last_relative_seconds: f32 = -1,
    /// A dropped frame (allocation pressure or the run-frame ceiling) is
    /// reported at stop, never silently absorbed.
    truncated: bool = false,
    times: std.ArrayList(f32) = .empty,
    roots: std.ArrayList(motion.Vec3) = .empty,
    deltas: std.ArrayList(motion.Quat) = .empty,

    fn deinit(self: *Recording, allocator: std.mem.Allocator) void {
        self.times.deinit(allocator);
        self.roots.deinit(allocator);
        self.deltas.deinit(allocator);
        self.* = .{};
    }

    fn frameCount(self: *const Recording) usize {
        return self.times.items.len;
    }
};

const Session = struct {
    allocator: std.mem.Allocator,
    hooks: Hooks,
    arena: std.heap.ArenaAllocator,
    session_id_buf: [32]u8 = undefined,
    session_id_len: usize = 0,
    render_source_buf: [96]u8 = undefined,
    render_source_len: usize = 0,
    revision: u64 = 0,
    target: OwnedTarget = .{},
    bone_ids: []const []const u8 = &.{},
    bones: []const rig.Bone = &.{},
    mapper: ?retarget.Retargeter = null,
    calibrator: source.Calibrator,
    triplets: retarget.TripletState = .{},
    latest_frame: ?ImmutableCameraFrame = null,
    pinned_frame: ?ImmutableCameraFrame = null,
    /// Separate lease for the frame currently exposed by the native camera
    /// source. A completed inference may replace `latest_frame` between render
    /// ticks; the previously presented camera must remain alive until the next
    /// synchronous snapshot transaction publishes its replacement.
    presented_frame: ?ImmutableCameraFrame = null,
    pending: [MAX_PENDING_INFERENCE_FRAMES]?PendingFrame = [_]?PendingFrame{null} ** MAX_PENDING_INFERENCE_FRAMES,
    max_pending_frames: usize,
    inference_generation: u64 = 0,
    external_loaded: bool = false,
    // The retargeter keeps only its newest FK result. Capture freeze, however,
    // may admit newer completed inference while presenting the pinned triplet.
    // Keep the two small native matrix palettes beside the corresponding
    // triplets so diagnostic skeleton positions can never cross frame IDs.
    latest_target_globals: [retarget.MAX_BONES]rig.Mat4 = undefined,
    latest_target_global_count: u16 = 0,
    pinned_target_globals: [retarget.MAX_BONES]rig.Mat4 = undefined,
    pinned_target_global_count: u16 = 0,
    recording: ?Recording = null,

    fn id(self: *const Session) []const u8 {
        return self.session_id_buf[0..self.session_id_len];
    }

    fn renderSource(self: *const Session) []const u8 {
        return self.render_source_buf[0..self.render_source_len];
    }

    fn cancelPending(self: *Session) void {
        for (&self.pending) |*slot| {
            if (slot.*) |pending| self.hooks.release_frame(self.hooks.context, pending.frame);
            slot.* = null;
        }
    }

    fn clearTriplets(self: *Session, notify_host: bool) void {
        if (notify_host and self.external_loaded) {
            self.hooks.clear_triplet(
                self.hooks.context,
                self.id(),
                self.renderSource(),
                self.target.viewport_node_id,
            );
        }
        if (self.latest_frame) |frame| self.hooks.release_frame(self.hooks.context, frame);
        if (self.pinned_frame) |frame| self.hooks.release_frame(self.hooks.context, frame);
        if (self.presented_frame) |frame| self.hooks.release_frame(self.hooks.context, frame);
        self.latest_frame = null;
        self.pinned_frame = null;
        self.presented_frame = null;
        self.triplets = .{};
        self.latest_target_global_count = 0;
        self.pinned_target_global_count = 0;
    }

    fn freshMapper(self: *Session) !void {
        const replacement = try retarget.Retargeter.init(
            self.allocator,
            self.bone_ids,
            self.bones,
            retarget.DEFAULT_TUNING,
        );
        if (self.mapper) |*old| old.deinit();
        self.mapper = replacement;
    }

    fn deinit(self: *Session) void {
        if (self.external_loaded) {
            self.hooks.close_target(
                self.hooks.context,
                self.id(),
                self.renderSource(),
                self.target.viewport_node_id,
            );
        }
        self.dropRecording();
        self.cancelPending();
        self.clearTriplets(false);
        if (self.mapper) |*mapper| mapper.deinit();
        self.arena.deinit();
        self.* = undefined;
    }

    fn dropRecording(self: *Session) void {
        if (self.recording) |*recording| recording.deinit(self.allocator);
        self.recording = null;
    }

    /// Append one promoted target frame to the active recording. Deltas are
    /// computed against the target's own bind rotations; a frame that fails
    /// quaternion hygiene or lands out of time order is skipped whole.
    fn recordCompletedTarget(self: *Session, target: *const retarget.TargetPoseFrame) void {
        const recording = if (self.recording) |*value| value else return;
        if (recording.frameCount() >= motion.MAX_RUN_FRAMES) {
            recording.truncated = true;
            return;
        }
        const first = recording.first_timestamp_ms orelse target.timestamp_ms;
        recording.first_timestamp_ms = first;
        const relative = @as(f32, @floatFromInt(target.timestamp_ms - first)) / 1000.0;
        if (recording.frameCount() > 0 and relative <= recording.last_relative_seconds) return;

        var frame_deltas: [MAX_RECORD_CHANNELS]motion.Quat = undefined;
        for (recording.channel_bones[0..recording.channel_count], 0..) |bone_index, channel| {
            const bind = rig.fk.normalizeQuat(self.bones[bone_index].bind_rotation) catch return;
            const local = rig.fk.normalizeQuat(target.local_rotations[bone_index]) catch return;
            frame_deltas[channel] = rig.fk.normalizeQuat(rig.fk.multiplyQuat(
                rig.fk.inverseUnitQuat(bind),
                local,
            )) catch return;
        }
        recording.times.append(self.allocator, relative) catch {
            recording.truncated = true;
            return;
        };
        recording.roots.append(self.allocator, target.root_translation) catch {
            recording.truncated = true;
            _ = recording.times.pop();
            return;
        };
        recording.deltas.appendSlice(self.allocator, frame_deltas[0..recording.channel_count]) catch {
            recording.truncated = true;
            _ = recording.times.pop();
            _ = recording.roots.pop();
            return;
        };
        recording.last_relative_seconds = relative;
    }

    fn pendingCount(self: *const Session) usize {
        var count: usize = 0;
        for (self.pending) |slot| if (slot != null) {
            count += 1;
        };
        return count;
    }

    fn findPending(self: *Session, frame_id: u64) ?usize {
        for (self.pending[0..self.max_pending_frames], 0..) |slot, index| {
            if (slot != null and slot.?.frame.identity.frame_id == frame_id) return index;
        }
        return null;
    }

    /// Publish the visible native camera + target pair. The caller must build
    /// the matching JSON reply first, then call this synchronously from the JS
    /// snapshot/command turn. React therefore receives and commits the exact
    /// compact diagnostic state before the following WorldLoader render.
    fn publishVisible(self: *Session) !void {
        const visible = self.triplets.visible() orelse return;
        const frame = if (self.triplets.frozen)
            self.pinned_frame orelse return error.PinnedFrameUnavailable
        else
            self.latest_frame orelse return error.LatestFrameUnavailable;
        const target_globals = self.visibleTargetGlobalMatrices() orelse return;
        if (self.presented_frame) |presented| {
            if (presented.identity.frame_id == frame.identity.frame_id and
                presented.identity.timestamp_ms == frame.identity.timestamp_ms and
                presented.identity.token == frame.identity.token)
            {
                return;
            }
        }

        // Acquire the new presentation lease before the host swaps its camera
        // token. On any target-publication failure, the old native pair and its
        // frame lease remain untouched.
        try self.hooks.retain_frame(self.hooks.context, frame);
        errdefer self.hooks.release_frame(self.hooks.context, frame);
        try self.hooks.publish_triplet(self.hooks.context, .{
            .session_id = self.id(),
            .camera_render_source = self.renderSource(),
            .viewport_node_id = self.target.viewport_node_id,
            .camera_frame = frame,
            .triplet = visible,
            .bone_ids = self.bone_ids,
            .target_global_matrices = target_globals,
        });
        const previous = self.presented_frame;
        self.presented_frame = frame;
        if (previous) |old| self.hooks.release_frame(self.hooks.context, old);
    }

    fn visibleTargetGlobalMatrices(self: *const Session) ?[]const rig.Mat4 {
        if (self.triplets.visible() == null) return null;
        const count: usize = if (self.triplets.frozen)
            self.pinned_target_global_count
        else
            self.latest_target_global_count;
        if (count != self.bones.len) return null;
        return if (self.triplets.frozen)
            self.pinned_target_globals[0..count]
        else
            self.latest_target_globals[0..count];
    }
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    hooks: Hooks,
    tuning: Tuning,
    session: ?*Session = null,
    next_session_id: u64 = 1,

    pub fn init(allocator: std.mem.Allocator, hooks: Hooks, tuning: Tuning) !Manager {
        if (tuning.max_pending_frames == 0 or tuning.max_pending_frames > MAX_PENDING_INFERENCE_FRAMES) {
            return error.InvalidTuning;
        }
        return .{ .allocator = allocator, .hooks = hooks, .tuning = tuning };
    }

    pub fn deinit(self: *Manager) void {
        if (self.session) |session| {
            session.deinit();
            self.allocator.destroy(session);
        }
        self.* = undefined;
    }

    pub fn currentSessionId(self: *const Manager) ?[]const u8 {
        return if (self.session) |session| session.id() else null;
    }

    pub fn currentRevision(self: *const Manager) ?u64 {
        return if (self.session) |session| session.revision else null;
    }

    pub fn inferenceTarget(self: *const Manager) ?InferenceTarget {
        const session = self.session orelse return null;
        return .{
            .session_id = session.id(),
            .camera_source = session.target.camera_source,
            .frozen = session.triplets.frozen,
            .pending_count = session.pendingCount(),
        };
    }

    pub fn cameraRenderSource(self: *const Manager, session_id: []const u8) ![]const u8 {
        const session = try self.requireSessionId(session_id);
        return session.renderSource();
    }

    fn requireSessionId(self: *const Manager, session_id: []const u8) !*Session {
        const session = self.session orelse return error.NoOpenSession;
        if (!std.mem.eql(u8, session.id(), session_id)) return error.SessionIdMismatch;
        return session;
    }

    /// Retain the exact immutable RGBA frame before submitting it to ONNX.
    /// Completion later names only frame_id; timestamp and token come from this
    /// retained assignment and cannot be swapped for a newer camera buffer.
    pub fn beginInference(
        self: *Manager,
        session_id: []const u8,
        frame: ImmutableCameraFrame,
    ) !void {
        const session = try self.requireSessionId(session_id);
        if (session.triplets.frozen) return error.SessionFrozen;
        if (frame.identity.token == 0 or frame.width == 0 or frame.height == 0) return error.InvalidCameraFrame;
        const minimum_stride = std.math.mul(u32, frame.width, 4) catch return error.InvalidCameraFrame;
        if (frame.stride_bytes < minimum_stride) return error.InvalidCameraFrame;
        if (session.findPending(frame.identity.frame_id) != null) return error.DuplicatePendingFrame;
        if (session.triplets.latest) |latest| {
            if (frame.identity.frame_id <= latest.camera.frame_id) return error.StaleFrame;
        }
        if (session.pendingCount() >= session.max_pending_frames) return error.PendingFrameCapacity;
        var empty_index: ?usize = null;
        for (session.pending[0..session.max_pending_frames], 0..) |slot, index| {
            if (slot == null) {
                empty_index = index;
                break;
            }
        }
        const index = empty_index orelse return error.PendingFrameCapacity;
        try session.hooks.retain_frame(session.hooks.context, frame);
        session.pending[index] = .{
            .frame = frame,
            .inference_generation = session.inference_generation,
        };
    }

    /// Consume and release one pending RGBA lease after inference failed or was
    /// abandoned. This is not authoring state: revision and visible triplet do
    /// not change.
    pub fn discardInference(self: *Manager, session_id: []const u8, frame_id: u64) !void {
        const session = try self.requireSessionId(session_id);
        const index = session.findPending(frame_id) orelse return error.UnknownPendingFrame;
        const pending = session.pending[index].?;
        session.pending[index] = null;
        session.hooks.release_frame(session.hooks.context, pending.frame);
    }

    /// Consume one completed landmark result. No JSON operation exposes this;
    /// the ONNX completion path calls it with the session id it captured when
    /// beginInference retained the source RGBA frame.
    pub fn ingestCompletedFrame(
        self: *Manager,
        session_id: []const u8,
        detected: source.WorldLandmarkFrame,
    ) !IngestResult {
        const session = try self.requireSessionId(session_id);
        const pending_index = session.findPending(detected.frame_id) orelse return error.UnknownPendingFrame;
        const pending = session.pending[pending_index].?;
        session.pending[pending_index] = null;
        var frame_transferred = false;
        defer if (!frame_transferred) session.hooks.release_frame(session.hooks.context, pending.frame);

        if (pending.frame.identity.timestamp_ms != detected.timestamp_ms) return error.FrameIdentityMismatch;
        if (pending.inference_generation != session.inference_generation) return error.StaleInferenceConfiguration;

        if (session.calibrator.state == .uncalibrated or session.calibrator.state == .failed) {
            return .awaiting_calibration;
        }
        if (session.calibrator.state == .collecting) {
            const push = try session.calibrator.push(&detected);
            switch (push) {
                .accepted => {
                    session.revision += 1;
                    return .calibration_progress;
                },
                .ignored_invalid, .not_collecting => return .invalid_calibration_frame,
                .deadline_exceeded => {
                    session.revision += 1;
                    return .calibration_failed;
                },
                .completed => {},
            }
        }

        const calibration = session.calibrator.result orelse return error.CalibrationUnavailable;
        var reconstructed = try source.reconstruct(
            &detected,
            calibration,
            source.DEFAULT_TUNING,
        );
        const target = try session.mapper.?.retarget(calibration, &reconstructed);
        const triplet = retarget.CompletedTriplet{
            .camera = pending.frame.identity,
            .detected = detected,
            .reconstructed = reconstructed,
            .target = target,
        };
        try session.triplets.promote(triplet);
        const target_globals = session.mapper.?.globalMatrices();
        if (target_globals.len > session.latest_target_globals.len) return error.InvalidTargetBoneCount;
        @memcpy(session.latest_target_globals[0..target_globals.len], target_globals);
        session.latest_target_global_count = @intCast(target_globals.len);

        const previous_latest = session.latest_frame;
        session.latest_frame = pending.frame;
        frame_transferred = true;
        session.revision += 1;
        if (previous_latest) |frame| session.hooks.release_frame(session.hooks.context, frame);
        session.recordCompletedTarget(&target);
        return .promoted;
    }

    fn createSession(self: *Manager, target: TargetDescriptor) !*Session {
        if (self.next_session_id == std.math.maxInt(u64)) return error.SessionIdExhausted;
        const candidate = try self.allocator.create(Session);
        errdefer self.allocator.destroy(candidate);
        candidate.* = .{
            .allocator = self.allocator,
            .hooks = self.hooks,
            .arena = .init(self.allocator),
            .calibrator = try source.Calibrator.init(source.DEFAULT_TUNING),
            .max_pending_frames = self.tuning.max_pending_frames,
        };
        errdefer candidate.deinit();

        candidate.session_id_len = (std.fmt.bufPrint(
            &candidate.session_id_buf,
            "{d}",
            .{self.next_session_id},
        ) catch return error.SessionIdExhausted).len;
        candidate.render_source_len = (std.fmt.bufPrint(
            &candidate.render_source_buf,
            "capture-session:{s}:camera",
            .{candidate.id()},
        ) catch return error.SessionIdExhausted).len;
        const arena = candidate.arena.allocator();
        candidate.target = .{
            .geometry_path = try arena.dupe(u8, target.geometry_path),
            .skin_path = try arena.dupe(u8, target.skin_path),
            .skeleton_json = try arena.dupe(u8, target.skeleton_json),
            .camera_source = try arena.dupe(u8, target.camera_source),
            .viewport_node_id = target.viewport_node_id,
        };

        const view = try self.hooks.load_target(self.hooks.context, candidate.id(), candidate.target.descriptor());
        candidate.external_loaded = true;
        try validateTargetRig(view);
        const ids = try arena.alloc([]const u8, view.bone_ids.len);
        for (view.bone_ids, 0..) |bone_id, index| ids[index] = try arena.dupe(u8, bone_id);
        const bones = try arena.dupe(rig.Bone, view.bones);
        candidate.bone_ids = ids;
        candidate.bones = bones;
        candidate.mapper = try retarget.Retargeter.init(
            self.allocator,
            candidate.bone_ids,
            candidate.bones,
            retarget.DEFAULT_TUNING,
        );
        return candidate;
    }

    fn openTarget(self: *Manager, target: TargetDescriptor) ![]u8 {
        try validateTargetDescriptor(target);
        const candidate = try self.createSession(target);
        errdefer {
            candidate.deinit();
            self.allocator.destroy(candidate);
        }
        const reply = try snapshotReply(self.allocator, candidate);
        errdefer self.allocator.free(reply);
        try self.hooks.activate_target(
            self.hooks.context,
            candidate.id(),
            candidate.renderSource(),
            candidate.target.descriptor(),
        );
        const previous = self.session;
        self.session = candidate;
        self.next_session_id += 1;
        if (previous) |old| {
            old.deinit();
            self.allocator.destroy(old);
        }
        return reply;
    }

    fn calibrate(self: *Manager, session: *Session) !void {
        _ = self;
        try session.freshMapper();
        // A recording cannot span two calibrations: the deltas would splice
        // incompatible rest references. Discard, never silently continue.
        session.dropRecording();
        session.clearTriplets(true);
        session.inference_generation +%= 1;
        session.calibrator.begin(session.hooks.now_ms(session.hooks.context));
        session.revision += 1;
    }

    fn freeze(self: *Manager, session: *Session) !void {
        _ = self;
        if (session.triplets.frozen) return;
        const frame = session.latest_frame orelse return error.NoCompletedFrame;
        const count: usize = session.latest_target_global_count;
        if (count != session.bones.len) return error.TargetDiagnosticUnavailable;
        try session.hooks.retain_frame(session.hooks.context, frame);
        errdefer session.hooks.release_frame(session.hooks.context, frame);
        try session.triplets.freeze();
        @memcpy(session.pinned_target_globals[0..count], session.latest_target_globals[0..count]);
        session.pinned_target_global_count = @intCast(count);
        session.pinned_frame = frame;
        session.revision += 1;
    }

    fn resumeLive(self: *Manager, session: *Session) void {
        _ = self;
        if (!session.triplets.frozen) return;
        session.triplets.resumeLive();
        if (session.pinned_frame) |frame| session.hooks.release_frame(session.hooks.context, frame);
        session.pinned_frame = null;
        session.pinned_target_global_count = 0;
        session.revision += 1;
    }

    fn startRecording(self: *Manager, session: *Session) !void {
        _ = self;
        if (session.recording != null) return error.RecordingActive;
        var recording = Recording{};
        for (retarget.DRIVEN_CHANNEL_IDS) |channel_id| {
            for (session.bone_ids, 0..) |bone_id, index| {
                if (std.mem.eql(u8, bone_id, channel_id)) {
                    recording.channel_ids[recording.channel_count] = channel_id;
                    recording.channel_bones[recording.channel_count] = @intCast(index);
                    recording.channel_count += 1;
                    break;
                }
            }
        }
        if (recording.channel_count == 0) return error.NoRecordableChannels;
        session.recording = recording;
        session.revision += 1;
    }

    /// Finalize the active recording into one RJAN document (a single
    /// dictated dense run), persist it through the host hook, and reply with
    /// the written path. The recording is consumed either way.
    fn stopRecording(self: *Manager, session: *Session, directory: []const u8, name: []const u8) ![]u8 {
        var recording = session.recording orelse return error.RecordingInactive;
        session.recording = null;
        defer recording.deinit(self.allocator);
        session.revision += 1;
        if (recording.frameCount() < 2) return error.RecordingTooShort;

        const frame_count = recording.frameCount();
        const duration = recording.times.items[frame_count - 1];
        const coverage: u32 = if (recording.channel_count >= 32)
            std.math.maxInt(u32)
        else
            (@as(u32, 1) << @intCast(recording.channel_count)) - 1;
        const run = motion.Run{
            .start_seconds = 0,
            .coverage = coverage,
            .times = recording.times.items,
            .root_translations = recording.roots.items,
            .deltas = recording.deltas.items,
        };
        const document = motion.Document{
            .allocator = self.allocator,
            .name = name,
            .looping = false,
            .duration_seconds = duration,
            .source = .capture,
            .channel_ids = recording.channel_ids[0..recording.channel_count],
            .keys = &.{},
            .runs = &.{run},
        };
        const encoded = try motion.encodeAlloc(self.allocator, &document);
        defer self.allocator.free(encoded);
        const saved = try session.hooks.save_motion(session.hooks.context, directory, encoded);

        var output: std.Io.Writer.Allocating = .init(self.allocator);
        defer output.deinit();
        try output.writer.writeAll("{\"ok\":true,\"value\":{\"path\":");
        try writeJsonString(&output.writer, saved.path());
        try output.writer.print(",\"frameCount\":{d},\"durationSeconds\":{d},\"truncated\":{s},\"revision\":{d}}}}}", .{
            frame_count,
            duration,
            if (recording.truncated) "true" else "false",
            session.revision,
        });
        return self.allocator.dupe(u8, output.written());
    }

    /// Process one camelCase CaptureSessionRequest. Protocol failures are JSON;
    /// only allocation failure escapes to the host callback.
    pub fn handle(self: *Manager, request_json: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, self.allocator, request_json, .{}) catch |err| {
            return self.operationErrorReply("invalid capture request JSON", err);
        };
        defer parsed.deinit();
        const request = object(parsed.value) catch |err| {
            return self.operationErrorReply("invalid capture request", err);
        };
        const op = requiredString(request, "op") catch |err| {
            return self.operationErrorReply("invalid capture request", err);
        };
        if (std.mem.eql(u8, op, "openTarget")) {
            const payload_value = required(request, "payload") catch |err| {
                return self.operationErrorReply("invalid capture target", err);
            };
            const payload = parseTarget(payload_value) catch |err| {
                return self.operationErrorReply("invalid capture target", err);
            };
            return self.openTarget(payload) catch |err| self.operationErrorReply("capture target open rejected", err);
        }
        if (std.mem.eql(u8, op, "poseKey")) {
            const session = self.requireRequestSession(request, false) catch |err| {
                return self.operationErrorReply("capture pose key rejected", err);
            };
            return self.poseKeyReply(session) catch |err|
                self.operationErrorReply("capture pose key rejected", err);
        }
        if (std.mem.eql(u8, op, "snapshot")) {
            const session = self.requireRequestSession(request, false) catch |err| {
                return self.operationErrorReply("capture snapshot rejected", err);
            };
            return self.presentedSnapshotReply(session) catch |err|
                self.operationErrorReply("capture snapshot publication rejected", err);
        }
        if (std.mem.eql(u8, op, "close")) {
            const session = self.requireRequestSession(request, false) catch |err| {
                return self.operationErrorReply("capture close rejected", err);
            };
            const reply = try nullReply(self.allocator);
            session.deinit();
            self.allocator.destroy(session);
            self.session = null;
            return reply;
        }

        const session = self.requireRequestSession(request, true) catch |err| {
            return self.operationErrorReply("capture command rejected", err);
        };
        if (std.mem.eql(u8, op, "calibrate")) {
            self.calibrate(session) catch |err| return self.operationErrorReply("capture calibration rejected", err);
        } else if (std.mem.eql(u8, op, "freeze")) {
            self.freeze(session) catch |err| return self.operationErrorReply("capture freeze rejected", err);
        } else if (std.mem.eql(u8, op, "resume")) {
            self.resumeLive(session);
        } else if (std.mem.eql(u8, op, "record")) {
            self.startRecording(session) catch |err| return self.operationErrorReply("capture record rejected", err);
        } else if (std.mem.eql(u8, op, "recordStop")) {
            const payload_value = required(request, "payload") catch |err| {
                return self.operationErrorReply("invalid record stop", err);
            };
            const payload = object(payload_value) catch |err| {
                return self.operationErrorReply("invalid record stop", err);
            };
            const directory = requiredString(payload, "directory") catch |err| {
                return self.operationErrorReply("invalid record stop", err);
            };
            const name = requiredString(payload, "name") catch |err| {
                return self.operationErrorReply("invalid record stop", err);
            };
            return self.stopRecording(session, directory, name) catch |err|
                self.operationErrorReply("capture record stop rejected", err);
        } else {
            return errorReply(self.allocator, "unknown capture session operation", session.revision);
        }
        return self.presentedSnapshotReply(session) catch |err|
            self.operationErrorReply("capture command publication rejected", err);
    }

    fn requireRequestSession(self: *Manager, request: std.json.ObjectMap, require_revision: bool) !*Session {
        const session_id = try requiredString(request, "sessionId");
        const session = try self.requireSessionId(session_id);
        if (request.get("expectedRevision")) |value| {
            if (try unsigned(value) != session.revision) return error.StaleRevision;
        } else if (require_revision) {
            return error.MissingExpectedRevision;
        }
        return session;
    }

    /// The visible promoted pose as role-addressed bind-relative deltas —
    /// the workbench's "add key from this pose" (req_4285). Deltas are the
    /// motion-document transport currency, computed here because the bind
    /// rotations live here; the authoring side declares time, never math.
    fn poseKeyReply(self: *Manager, session: *Session) ![]u8 {
        const triplet = session.triplets.visible() orelse return error.NoCompletedFrame;
        const target = &triplet.target;
        var output: std.Io.Writer.Allocating = .init(self.allocator);
        defer output.deinit();
        try output.writer.writeAll("{\"ok\":true,\"value\":{\"root\":");
        try writeVec3(&output.writer, target.root_translation);
        try output.writer.writeAll(",\"channels\":{");
        var first = true;
        for (retarget.DRIVEN_CHANNEL_IDS) |channel_id| {
            for (session.bone_ids, 0..) |bone_id, index| {
                if (!std.mem.eql(u8, bone_id, channel_id)) continue;
                const bind = try rig.fk.normalizeQuat(session.bones[index].bind_rotation);
                const local = try rig.fk.normalizeQuat(target.local_rotations[index]);
                const delta = try rig.fk.normalizeQuat(rig.fk.multiplyQuat(
                    rig.fk.inverseUnitQuat(bind),
                    local,
                ));
                if (!first) try output.writer.writeByte(',');
                first = false;
                try writeJsonString(&output.writer, channel_id);
                try output.writer.writeByte(':');
                try writeQuat(&output.writer, delta);
                break;
            }
        }
        try output.writer.writeAll("}}}");
        return self.allocator.dupe(u8, output.written());
    }

    fn operationErrorReply(self: *const Manager, prefix: []const u8, err: anyerror) ![]u8 {
        var message_buffer: [192]u8 = undefined;
        const message = std.fmt.bufPrint(&message_buffer, "{s}: {s}", .{ prefix, @errorName(err) }) catch prefix;
        return errorReply(self.allocator, message, self.currentRevision());
    }

    /// Allocate the exact compact snapshot before changing either native pane.
    /// If native publication fails, the reply is discarded and React keeps its
    /// previous known-good triplet. Successful publication and this prebuilt
    /// reply then complete within one synchronous JS turn.
    fn presentedSnapshotReply(self: *const Manager, session: *Session) ![]u8 {
        const reply = try snapshotReply(self.allocator, session);
        errdefer self.allocator.free(reply);
        try session.publishVisible();
        return reply;
    }
};

fn validateTargetRig(view: TargetRigView) !void {
    if (view.bone_ids.len == 0 or view.bone_ids.len > retarget.MAX_BONES or
        view.bones.len != view.bone_ids.len)
    {
        return error.InvalidTargetBoneCount;
    }
    for (view.bone_ids, 0..) |bone_id, index| {
        if (bone_id.len == 0) return error.RequiredBoneMissing;
        for (view.bone_ids[0..index]) |prior| {
            if (std.mem.eql(u8, prior, bone_id)) return error.DuplicateBoneId;
        }
    }
}

fn cameraSourceValid(value: []const u8) bool {
    const prefix = if (std.mem.startsWith(u8, value, "cam:"))
        "cam:"
    else if (std.mem.startsWith(u8, value, "/dev/video"))
        "/dev/video"
    else
        return false;
    const digits = value[prefix.len..];
    if (digits.len == 0) return false;
    for (digits) |byte| if (byte < '0' or byte > '9') return false;
    return true;
}

fn validateTargetDescriptor(target: TargetDescriptor) !void {
    if (target.geometry_path.len == 0 or target.skin_path.len == 0 or target.skeleton_json.len == 0) {
        return error.MissingTargetArtifact;
    }
    if (!cameraSourceValid(target.camera_source)) return error.InvalidCameraSource;
    if (target.viewport_node_id == 0) return error.InvalidViewportNode;
}

fn object(value: std.json.Value) !std.json.ObjectMap {
    return switch (value) {
        .object => |map| map,
        else => error.ExpectedObject,
    };
}

fn string(value: std.json.Value) ![]const u8 {
    return switch (value) {
        .string => |text| text,
        else => error.ExpectedString,
    };
}

fn required(map: std.json.ObjectMap, key: []const u8) !std.json.Value {
    return map.get(key) orelse error.MissingField;
}

fn requiredString(map: std.json.ObjectMap, key: []const u8) ![]const u8 {
    const value = try string(try required(map, key));
    if (value.len == 0) return error.EmptyString;
    return value;
}

fn unsigned(value: std.json.Value) !u64 {
    return switch (value) {
        .integer => |integer| if (integer >= 0) @intCast(integer) else error.ExpectedUnsigned,
        else => error.ExpectedUnsigned,
    };
}

fn parseTarget(value: std.json.Value) !TargetDescriptor {
    const map = try object(value);
    const viewport = try unsigned(try required(map, "viewportNodeId"));
    if (viewport > std.math.maxInt(u32)) return error.InvalidViewportNode;
    return .{
        .geometry_path = try requiredString(map, "geometryPath"),
        .skin_path = try requiredString(map, "skinPath"),
        .skeleton_json = try requiredString(map, "skeletonJson"),
        .camera_source = try requiredString(map, "cameraSource"),
        .viewport_node_id = @intCast(viewport),
    };
}

fn writeJsonString(writer: *std.Io.Writer, value: []const u8) !void {
    try writer.writeByte('"');
    for (value) |byte| switch (byte) {
        '"' => try writer.writeAll("\\\""),
        '\\' => try writer.writeAll("\\\\"),
        '\n' => try writer.writeAll("\\n"),
        '\r' => try writer.writeAll("\\r"),
        '\t' => try writer.writeAll("\\t"),
        0...8, 11, 12, 14...31 => try writer.print("\\u{x:0>4}", .{byte}),
        else => try writer.writeByte(byte),
    };
    try writer.writeByte('"');
}

fn writeVec3(writer: *std.Io.Writer, value: source.Vec3) !void {
    try writer.print("[{d},{d},{d}]", .{ value[0], value[1], value[2] });
}

fn writeQuat(writer: *std.Io.Writer, value: rig.Quat) !void {
    try writer.print("[{d},{d},{d},{d}]", .{ value[0], value[1], value[2], value[3] });
}

fn writeDetected(writer: *std.Io.Writer, frame: source.WorldLandmarkFrame) !void {
    try writer.print("{{\"frameId\":{d},\"timestampMs\":{d},\"presence\":{d},\"landmarks\":[", .{
        frame.frame_id,
        frame.timestamp_ms,
        frame.presence,
    });
    for (frame.landmarks, 0..) |landmark, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.writeAll("{\"name\":");
        try writeJsonString(writer, @tagName(@as(source.WorldLandmarkName, @enumFromInt(index))));
        try writer.print(",\"x\":{d},\"y\":{d},\"visibility\":{d}}}", .{
            landmark.screen[0],
            landmark.screen[1],
            landmark.visibility,
        });
    }
    try writer.writeAll("]}");
}

fn writeSource(writer: *std.Io.Writer, frame: source.SourceSkeletonFrame) !void {
    try writer.print("{{\"frameId\":{d},\"joints\":[", .{frame.frame_id});
    for (frame.joints, 0..) |joint, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.writeAll("{\"id\":");
        try writeJsonString(writer, @tagName(joint.id));
        try writer.writeAll(",\"position\":");
        try writeVec3(writer, joint.position);
        try writer.print(",\"confidence\":{d}}}", .{joint.confidence});
    }
    try writer.writeAll("]}");
}

fn writeTarget(writer: *std.Io.Writer, session: *const Session, frame: retarget.TargetPoseFrame) !void {
    try writer.print("{{\"frameId\":{d},\"rootTranslation\":", .{frame.frame_id});
    try writeVec3(writer, frame.root_translation);
    try writer.writeAll(",\"localRotations\":{");
    for (session.bone_ids, 0..) |bone_id, index| {
        if (index != 0) try writer.writeByte(',');
        try writeJsonString(writer, bone_id);
        try writer.writeByte(':');
        try writeQuat(writer, frame.local_rotations[index]);
    }
    try writer.writeAll("}}");
}

fn writeMatrixOrigin(writer: *std.Io.Writer, matrix: rig.Mat4) !void {
    try writer.print("[{d},{d},{d}]", .{ matrix[12], matrix[13], matrix[14] });
}

/// Compact native FK diagnostic. Bind origins are always inspectable after a
/// target opens; deformed origins appear only with the exact visible triplet
/// (latest while live, pinned while frozen).
fn writeTargetSkeleton(writer: *std.Io.Writer, session: *const Session) !void {
    const mapper = if (session.mapper) |*value| value else return error.TargetDiagnosticUnavailable;
    const bind_globals = mapper.bindGlobalMatrices();
    if (bind_globals.len != session.bones.len or session.bone_ids.len != session.bones.len) {
        return error.TargetDiagnosticUnavailable;
    }
    const visible = session.triplets.visible();
    const deformed_globals = session.visibleTargetGlobalMatrices();
    if ((visible == null) != (deformed_globals == null)) return error.TargetDiagnosticUnavailable;

    try writer.writeAll("{\"frameId\":");
    if (visible) |triplet|
        try writer.print("{d}", .{triplet.target.frame_id})
    else
        try writer.writeAll("null");
    try writer.writeAll(",\"bones\":[");
    for (session.bones, 0..) |bone, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.writeAll("{\"boneId\":");
        try writeJsonString(writer, session.bone_ids[index]);
        try writer.writeAll(",\"parentBoneId\":");
        if (bone.parent_index) |parent_index|
            try writeJsonString(writer, session.bone_ids[parent_index])
        else
            try writer.writeAll("null");
        try writer.writeAll(",\"bindPosition\":");
        try writeMatrixOrigin(writer, bind_globals[index]);
        try writer.writeAll(",\"deformedPosition\":");
        if (deformed_globals) |matrices|
            try writeMatrixOrigin(writer, matrices[index])
        else
            try writer.writeAll("null");
        try writer.writeByte('}');
    }
    try writer.writeAll("]}");
}

fn writeSnapshot(writer: *std.Io.Writer, session: *const Session) !void {
    try writer.writeAll("{\"sessionId\":");
    try writeJsonString(writer, session.id());
    try writer.print(",\"revision\":{d},\"frozen\":{s},\"calibration\":{{\"state\":", .{
        session.revision,
        if (session.triplets.frozen) "true" else "false",
    });
    try writeJsonString(writer, @tagName(session.calibrator.state));
    try writer.print(",\"validFrameCount\":{d},\"requiredFrameCount\":{d}", .{
        session.calibrator.valid_frame_count,
        source.CALIBRATION_FRAME_COUNT,
    });
    if (session.calibrator.state == .collecting) {
        try writer.print(",\"deadlineMs\":{d}", .{
            session.calibrator.started_ms +| source.DEFAULT_TUNING.calibration_deadline_ms,
        });
    } else if (session.calibrator.state == .failed) {
        try writer.writeAll(",\"detail\":\"30 valid frames were not collected within 10000 ms\"");
    }
    try writer.writeAll("},\"detected\":");
    if (session.triplets.visible()) |triplet| {
        try writeDetected(writer, triplet.detected);
        try writer.writeAll(",\"source\":");
        try writeSource(writer, triplet.reconstructed);
        try writer.writeAll(",\"target\":");
        try writeTarget(writer, session, triplet.target);
    } else {
        try writer.writeAll("null,\"source\":null,\"target\":null");
    }
    try writer.writeAll(",\"recording\":");
    if (session.recording) |*recording| {
        try writer.print("{{\"frameCount\":{d},\"truncated\":{s}}}", .{
            recording.frameCount(),
            if (recording.truncated) "true" else "false",
        });
    } else {
        try writer.writeAll("null");
    }
    try writer.writeAll(",\"targetSkeleton\":");
    try writeTargetSkeleton(writer, session);
    try writer.writeByte('}');
}

fn snapshotReply(allocator: std.mem.Allocator, session: *const Session) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"value\":");
    try writeSnapshot(&output.writer, session);
    try output.writer.writeByte('}');
    return allocator.dupe(u8, output.written());
}

fn nullReply(allocator: std.mem.Allocator) ![]u8 {
    return allocator.dupe(u8, "{\"ok\":true,\"value\":null}");
}

fn errorReply(allocator: std.mem.Allocator, message: []const u8, current_revision: ?u64) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"ok\":false,\"error\":");
    try writeJsonString(&output.writer, message);
    if (current_revision) |revision| try output.writer.print(",\"currentRevision\":{d}", .{revision});
    try output.writer.writeByte('}');
    return allocator.dupe(u8, output.written());
}
