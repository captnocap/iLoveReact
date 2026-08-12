//! Capture-session adapter for the one WorldLoader character owner.
//!
//! This module is compiled only when a cart declares both ONNX capture and a
//! compiled world. Capture-open explicitly ensures its diagnostic world is
//! mounted, then each hook forwards to that world's strict saved-character
//! slot. It does not load, stage, or animate a second character.

const std = @import("std");
const HostContext = @import("host_context.zig");
const capture_host = @import("v8_bindings_capture_session.zig");
const capture = @import("skeleton/capture_session.zig");
const game_runtime = @import("dev_modules/game_runtime.zig");

fn hostFromContext(context: ?*anyopaque) !*HostContext {
    return @ptrCast(@alignCast(context orelse return error.MissingCaptureHostContext));
}

fn loadTarget(
    context: ?*anyopaque,
    session_id: []const u8,
    descriptor: capture.TargetDescriptor,
) anyerror!capture.TargetRigView {
    const host = try hostFromContext(context);
    // The Game runtime wrapper ensures the blank diagnostic world and loads
    // the target in the SAME compilation image that renders this WorldLoader.
    // A direct world_loader.zig import creates a second invisible registry in
    // replaceable-module development builds (USER ASK req_4254).
    const resident = try game_runtime.loadMountedPlayerCharacterTarget(
        host.io,
        host.environ,
        descriptor.viewport_node_id,
        session_id,
        descriptor.geometry_path,
        descriptor.skin_path,
        descriptor.skeleton_json,
    );
    return .{
        .bone_ids = resident.bone_ids,
        .bones = resident.bones,
    };
}

fn activateTarget(
    _: ?*anyopaque,
    session_id: []const u8,
    _: []const u8,
    descriptor: capture.TargetDescriptor,
) anyerror!void {
    try game_runtime.activateMountedPlayerCharacterTarget(
        descriptor.viewport_node_id,
        session_id,
    );
}

fn poseFrameFromTarget(target: capture.humanoid_retarget.TargetPoseFrame) game_runtime.pose_stream.Frame {
    var frame = game_runtime.pose_stream.Frame{
        .bone_count = target.bone_count,
        .frame_id = target.frame_id,
        .root_translation = target.root_translation,
    };
    @memcpy(
        frame.local_quaternions[0..target.bone_count],
        target.local_rotations[0..target.bone_count],
    );
    return frame;
}

fn publishTriplet(_: ?*anyopaque, publication: capture.DiagnosticPublication) anyerror!void {
    const frame = poseFrameFromTarget(publication.triplet.target);
    // publishMountedPlayerCharacterPose validates the complete frame before
    // mutating its interpolator and, by contract, returns this exact input ID.
    // There is intentionally no fallible work after that commit; the host can
    // now flip the prevalidated camera token without creating a half-frame.
    _ = try game_runtime.publishMountedPlayerCharacterPose(
        publication.viewport_node_id,
        publication.session_id,
        frame,
    );
}

fn clearTriplet(
    _: ?*anyopaque,
    session_id: []const u8,
    _: []const u8,
    viewport_node_id: u32,
) void {
    game_runtime.clearMountedPlayerCharacterPose(viewport_node_id, session_id);
}

fn closeTarget(
    _: ?*anyopaque,
    session_id: []const u8,
    _: []const u8,
    viewport_node_id: u32,
) void {
    game_runtime.closeMountedPlayerCharacterTarget(viewport_node_id, session_id);
}

/// Persist one encoded RJAN motion document, content-addressed like every
/// other saved character artifact: `motion-<sha256>.rjan`. Idempotent installs
/// and no version drift, the V29 asset law. Written tmp-then-rename so an
/// interrupted write can never corrupt a live take.
fn saveMotion(context: ?*anyopaque, directory: []const u8, encoded: []const u8) anyerror!capture.SavedMotion {
    const host = try hostFromContext(context);
    if (directory.len == 0) return error.InvalidMotionDirectory;
    const trimmed = std.mem.trimRight(u8, directory, "/");

    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(encoded, &hash, .{});
    const hex = std.fmt.bytesToHex(hash, .lower);

    var saved = capture.SavedMotion{};
    var path_buf: [std.fs.max_path_bytes]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, "{s}/motion-{s}.rjan", .{ trimmed, hex }) catch {
        return error.InvalidMotionDirectory;
    };
    try saved.set(path);

    std.Io.Dir.cwd().createDirPath(host.io, trimmed) catch {};
    var tmp_buf: [std.fs.max_path_bytes]u8 = undefined;
    const tmp_path = std.fmt.bufPrint(&tmp_buf, "{s}.tmp", .{path}) catch {
        return error.InvalidMotionDirectory;
    };
    {
        var file = try std.Io.Dir.cwd().createFile(host.io, tmp_path, .{ .truncate = true });
        errdefer std.Io.Dir.cwd().deleteFile(host.io, tmp_path) catch {};
        defer file.close(host.io);
        try file.writeStreamingAll(host.io, encoded);
        try file.sync(host.io);
    }
    std.Io.Dir.rename(std.Io.Dir.cwd(), tmp_path, std.Io.Dir.cwd(), path, host.io) catch |err| {
        std.Io.Dir.cwd().deleteFile(host.io, tmp_path) catch {};
        return err;
    };
    return saved;
}

/// Install the sole target publisher for the process-wide capture session.
pub fn register(host: *HostContext) void {
    capture_host.setTargetHooks(.{
        .context = host,
        .load_target = loadTarget,
        .activate_target = activateTarget,
        .publish_triplet = publishTriplet,
        .clear_triplet = clearTriplet,
        .close_target = closeTarget,
        .save_motion = saveMotion,
    });
}
