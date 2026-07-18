//! V8 host bindings for the ONNX Runtime subsystem (framework/ml/onnx.zig)
//! and SAM-based image segmentation (framework/ml/segment.zig).
//!
//! Surface:
//!   __onnx_test()                                   → JSON {ok, version?, error?}
//!   __segment_open(path)                            → handle:i32 (or -1 on fail)
//!   __segment_refine(handle, clicksJson, optsJson?) → "mask:<path>" or "err:<msg>".
//!       clicksJson is `[{"x":n,"y":n,"l":0|1},...]` where l=1 keep, l=0 reject.
//!       optsJson is an optional `{"threshold":N,"maskIdx":N}` carrying the
//!       SAM logit threshold (default 0) and mask-candidate index (0/1/2,
//!       default 0). The mask is written as a P5 binary PGM (maxval=1,
//!       bytes 0/1) to SCRATCH_DIR/segment_<handle>.pgm at source
//!       resolution, and the PATH is returned in the result string. JS
//!       reads it and turns it into a Uint8Array. (Matches the existing
//!       magick.ts file-path boundary; no in-process binary payload
//!       through V8.)
//!   __segment_close(handle)                         → void
//!
//! Segmentation remains synchronous (one-shot image/refine interactions).
//! Live pose inference is different: __pose_estimate_async snapshots a camera
//! frame into pose.zig's bounded worker and tickDrain emits the result.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const host_io = @import("host_io.zig");
const onnx = @import("ml/onnx.zig");
const segment = @import("ml/segment.zig");
const pose = @import("ml/pose.zig");
const render_surfaces = @import("render/render_surfaces.zig");
const video_devices = @import("render/video_devices.zig");

const SCRATCH_DIR = "/tmp/_reactjit_cutout";

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.String.initUtf8(iso, text));
}

fn hostTest(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    if (onnx.smokeTest(alloc)) |err_msg| {
        // JSON-escape the message minimally (replace " and \). The error
        // strings from ORT are typically simple ASCII so this is enough.
        const escaped = jsonEscape(alloc, err_msg) catch err_msg;
        const payload = std.fmt.allocPrint(alloc, "{{\"ok\":false,\"error\":\"{s}\"}}", .{escaped}) catch {
            setReturnString(info, "{\"ok\":false,\"error\":\"alloc failure\"}");
            return;
        };
        setReturnString(info, payload);
        return;
    }
    const ver = onnx.versionString();
    const payload = std.fmt.allocPrint(alloc, "{{\"ok\":true,\"version\":\"{s}\"}}", .{ver}) catch {
        setReturnString(info, "{\"ok\":true,\"version\":\"unknown\"}");
        return;
    };
    setReturnString(info, payload);
}

fn jsonEscape(alloc: std.mem.Allocator, s: []const u8) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(alloc);
    for (s) |ch| switch (ch) {
        '"', '\\' => {
            try out.append(alloc, '\\');
            try out.append(alloc, ch);
        },
        '\n' => try out.appendSlice(alloc, "\\n"),
        '\r' => try out.appendSlice(alloc, "\\r"),
        '\t' => try out.appendSlice(alloc, "\\t"),
        else => try out.append(alloc, ch),
    };
    return alloc.dupe(u8, out.items);
}

// ── Segment host fns ──────────────────────────────────────────────────

fn argString(info: v8.FunctionCallbackInfo, idx: u32, alloc: std.mem.Allocator) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const str = info.getArg(idx).toString(ctx) catch return null;
    const n = str.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = str.writeUtf8(iso, buf);
    return buf;
}

fn argI32(info: v8.FunctionCallbackInfo, idx: u32, default: i32) i32 {
    if (idx >= info.length()) return default;
    const ctx = info.getIsolate().getCurrentContext();
    return @intCast(info.getArg(idx).toI32(ctx) catch default);
}

fn hostSegmentOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const path = argString(info, 0, alloc) orelse {
        info.getReturnValue().set(v8.Integer.initI32(info.getIsolate(), -1));
        return;
    };
    // segment.openImage owns long-lived storage via std.heap.c_allocator (matches the
    // worker/whisper pattern). Pass that allocator, not the arena (which goes
    // out of scope at return).
    const handle = segment.openImage(std.heap.c_allocator, path);
    info.getReturnValue().set(v8.Integer.initI32(info.getIsolate(), handle));
}

fn hostSegmentClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const h = argI32(info, 0, -1);
    if (h < 0) return;
    segment.closeImage(std.heap.c_allocator, @intCast(h));
}

/// Minimal JSON parser for the clicks array: `[{"x":N,"y":N,"l":0|1},...]`.
/// Skips whitespace, doesn't validate strictly — assumes well-formed input
/// from useSegment.ts (which we control). Returns a freshly-allocated slice.
fn parseClicks(alloc: std.mem.Allocator, json: []const u8) ?[]segment.ClickIn {
    var out: std.ArrayList(segment.ClickIn) = .empty;
    defer out.deinit(alloc);
    var i: usize = 0;
    while (i < json.len) {
        if (json[i] == '{') {
            var x: f32 = 0;
            var y: f32 = 0;
            var l: u8 = 1;
            i += 1;
            while (i < json.len and json[i] != '}') {
                if (json[i] == '"') {
                    const key_end = std.mem.indexOfScalarPos(u8, json, i + 1, '"') orelse return null;
                    const key = json[i + 1 .. key_end];
                    i = key_end + 1;
                    // skip : and whitespace
                    while (i < json.len and (json[i] == ':' or json[i] == ' ' or json[i] == '\t')) i += 1;
                    // read number (possibly negative / fractional)
                    const num_start = i;
                    while (i < json.len and (json[i] == '-' or json[i] == '.' or (json[i] >= '0' and json[i] <= '9'))) i += 1;
                    const num = std.fmt.parseFloat(f32, json[num_start..i]) catch return null;
                    if (std.mem.eql(u8, key, "x")) x = num
                    else if (std.mem.eql(u8, key, "y")) y = num
                    else if (std.mem.eql(u8, key, "l")) l = if (num > 0.5) 1 else 0;
                } else {
                    i += 1;
                }
            }
            out.append(alloc, .{ .x = x, .y = y, .label = l }) catch return null;
        }
        i += 1;
    }
    return alloc.dupe(segment.ClickIn, out.items) catch null;
}

/// Minimal JSON parser for the opts object: `{"threshold":N,"maskIdx":N}`.
/// Defaults preserved when keys are missing or the input is empty/null —
/// callers pass the optional third arg verbatim.
fn parseOpts(json: []const u8) segment.RefineOpts {
    var opts: segment.RefineOpts = .{};
    var i: usize = 0;
    while (i < json.len) {
        if (json[i] == '"') {
            const key_end = std.mem.indexOfScalarPos(u8, json, i + 1, '"') orelse return opts;
            const key = json[i + 1 .. key_end];
            i = key_end + 1;
            while (i < json.len and (json[i] == ':' or json[i] == ' ' or json[i] == '\t')) i += 1;
            const num_start = i;
            while (i < json.len and (json[i] == '-' or json[i] == '.' or (json[i] >= '0' and json[i] <= '9'))) i += 1;
            const num = std.fmt.parseFloat(f32, json[num_start..i]) catch continue;
            if (std.mem.eql(u8, key, "threshold")) {
                opts.threshold = num;
            } else if (std.mem.eql(u8, key, "maskIdx")) {
                const n: i32 = @intFromFloat(num);
                opts.mask_idx = if (n < 0) 0 else if (n > 2) 2 else @intCast(n);
            }
        } else {
            i += 1;
        }
    }
    return opts;
}

/// Encode the mask as a P5 binary PGM (maxval=1) to disk. Bytes 0/1 land
/// as single-byte UTF-8 — the cart's JS side knows how to read this format
/// (same encoding as cart/cutout/magick.ts:encodeMaskPGM).
fn writeMaskPGM(path: []const u8, mask: []const u8, w: u32, h: u32) bool {
    std.Io.Dir.cwd().createDirPath(host_io.io(), std.fs.path.dirname(path) orelse ".") catch {};
    var file = std.Io.Dir.cwd().createFile(host_io.io(), path, .{ .truncate = true }) catch return false;
    defer file.close(host_io.io());
    var hdr_buf: [64]u8 = undefined;
    const hdr = std.fmt.bufPrint(&hdr_buf, "P5\n{d} {d}\n1\n", .{ w, h }) catch return false;
    file.writeStreamingAll(host_io.io(), hdr) catch return false;
    // segment.refineSegment returns 1=in-selection (erased), 0=keep. Our
    // P5 maxval=1 convention is identical — write the bytes as-is.
    file.writeStreamingAll(host_io.io(), mask) catch return false;
    return true;
}

fn hostSegmentRefine(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const handle_i32 = argI32(info, 0, -1);
    if (handle_i32 < 0) {
        setReturnString(info, "err:bad handle");
        return;
    }
    const clicks_json = argString(info, 1, alloc) orelse {
        setReturnString(info, "err:no clicks arg");
        return;
    };
    const clicks = parseClicks(alloc, clicks_json) orelse {
        setReturnString(info, "err:click parse");
        return;
    };
    defer alloc.free(clicks);

    // Opts are optional — if the cart hasn't been updated to pass them, we
    // fall back to RefineOpts defaults (threshold=0, mask_idx=0).
    const opts_json: []const u8 = argString(info, 2, alloc) orelse "";
    const opts = parseOpts(opts_json);

    const handle: u32 = @intCast(handle_i32);
    const mask = segment.refineSegment(std.heap.c_allocator, handle, clicks, opts) orelse {
        setReturnString(info, "err:refine failed");
        return;
    };
    defer std.heap.c_allocator.free(mask);

    // Recover dims via the handle (segment.zig exposes them via getHandleDims).
    const dims = segment.getHandleDims(handle) orelse {
        setReturnString(info, "err:handle missing dims");
        return;
    };

    const out_path = std.fmt.allocPrint(alloc, "{s}/segment_{d}.pgm", .{ SCRATCH_DIR, handle }) catch {
        setReturnString(info, "err:alloc path");
        return;
    };
    if (!writeMaskPGM(out_path, mask, dims.w, dims.h)) {
        setReturnString(info, "err:write pgm failed");
        return;
    }
    const reply = std.fmt.allocPrint(alloc, "mask:{s}", .{out_path}) catch {
        setReturnString(info, "err:alloc reply");
        return;
    };
    setReturnString(info, reply);
}

// ── Pose host fns (req_2786 — the CAPTURE pipeline's per-frame tracker) ──────
// __pose_estimate_async(src, requestId) → immediate numeric enqueue status;
//                               result emits on `pose:<requestId>` as JSON
//                               {ok, kp:[x,y,s ×17], elapsed_ms}. The frame is
//                               copied from a LIVE cam:N / /dev/video surface
//                               (SELFSHOT: never screen:/window: sources).
// __pose_estimate_image(path) → same, from an image file (headless verify).
// __pose_camera_devices()     → named V4L2 image-capture nodes (metadata-only
//                               companions are filtered by VIDIOC_QUERYCAP).
// Keypoints are source-normalized 0..1, COCO order (nose, eyes, ears,
// shoulders, elbows, wrists, hips, knees, ankles — L before R).

fn poseReply(info: v8.FunctionCallbackInfo, alloc: std.mem.Allocator, kps: ?[pose.KEYPOINTS]pose.Keypoint) void {
    const points = kps orelse {
        const msg = pose.initError() orelse "no frame";
        const escaped = jsonEscape(alloc, msg) catch msg;
        const payload = std.fmt.allocPrint(alloc, "{{\"ok\":false,\"error\":\"{s}\"}}", .{escaped}) catch {
            setReturnString(info, "{\"ok\":false,\"error\":\"alloc failure\"}");
            return;
        };
        setReturnString(info, payload);
        return;
    };
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(alloc);
    out.appendSlice(alloc, "{\"ok\":true,\"kp\":[") catch return;
    for (points, 0..) |kp, i| {
        const chunk = std.fmt.allocPrint(alloc, "{s}{d:.4},{d:.4},{d:.3}", .{ if (i == 0) "" else ",", kp.x, kp.y, kp.score }) catch return;
        out.appendSlice(alloc, chunk) catch return;
    }
    out.appendSlice(alloc, "]}") catch return;
    setReturnString(info, out.items);
}

const PoseRequestStatus = enum(i32) {
    queued = @intFromEnum(pose.SubmitStatus.queued),
    busy = @intFromEnum(pose.SubmitStatus.busy),
    worker_stopped = @intFromEnum(pose.SubmitStatus.stopped),
    invalid_frame = @intFromEnum(pose.SubmitStatus.invalid_frame),
    out_of_memory = @intFromEnum(pose.SubmitStatus.out_of_memory),
    invalid_source = 5,
    no_live_frame = 6,
    bad_request = 7,
};

fn setPoseRequestStatus(info: v8.FunctionCallbackInfo, status: PoseRequestStatus) void {
    info.getReturnValue().set(v8.Integer.initI32(info.getIsolate(), @intFromEnum(status)));
}

fn hostPoseEstimateAsync(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    const src = argString(info, 0, alloc) orelse {
        setPoseRequestStatus(info, .bad_request);
        return;
    };
    const request_i32 = argI32(info, 1, -1);
    if (request_i32 < 0) {
        setPoseRequestStatus(info, .bad_request);
        return;
    }
    // The camera-only law (SELFSHOT): the pose tracker reads the USER's cam
    // feed, never a desktop surface.
    if (!std.mem.startsWith(u8, src, "cam:") and !std.mem.startsWith(u8, src, "/dev/video")) {
        setPoseRequestStatus(info, .invalid_source);
        return;
    }
    const frame = render_surfaces.latestCpuFrame(src) orelse {
        setPoseRequestStatus(info, .no_live_frame);
        return;
    };
    const status = pose.enqueueRgba(@intCast(request_i32), frame.rgba, frame.width, frame.height);
    setPoseRequestStatus(info, @enumFromInt(@intFromEnum(status)));
}

fn hostPoseEstimateImage(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    const path = argString(info, 0, alloc) orelse {
        setReturnString(info, "{\"ok\":false,\"error\":\"no path arg\"}");
        return;
    };
    const path_z = alloc.dupeZ(u8, path) catch {
        setReturnString(info, "{\"ok\":false,\"error\":\"alloc failure\"}");
        return;
    };
    poseReply(info, alloc, pose.estimateImage(path_z.ptr));
}

fn hostPoseCameraDevices(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    var devices = video_devices.list(alloc) catch {
        setReturnString(info, "{\"ok\":false,\"error\":\"camera discovery failed\",\"devices\":[]}");
        return;
    };
    defer devices.deinit();

    var out: std.ArrayList(u8) = .empty;
    out.appendSlice(alloc, "{\"ok\":true,\"devices\":[") catch return;
    var emitted: usize = 0;
    for (devices.items) |device| {
        const source = jsonEscape(alloc, device.source) catch continue;
        const name = jsonEscape(alloc, device.name) catch continue;
        const driver = jsonEscape(alloc, device.driver) catch continue;
        const bus = jsonEscape(alloc, device.bus) catch continue;
        const row = std.fmt.allocPrint(
            alloc,
            "{s}{{\"index\":{d},\"source\":\"{s}\",\"name\":\"{s}\",\"driver\":\"{s}\",\"bus\":\"{s}\"}}",
            .{ if (emitted == 0) "" else ",", device.index, source, name, driver, bus },
        ) catch continue;
        out.appendSlice(alloc, row) catch return;
        emitted += 1;
    }
    out.appendSlice(alloc, "]}") catch return;
    setReturnString(info, out.items);
}

pub fn registerOnnx(_: anytype) void {
    v8_runtime.registerHostFn("__onnx_test", hostTest);
    v8_runtime.registerHostFn("__segment_open", hostSegmentOpen);
    v8_runtime.registerHostFn("__segment_close", hostSegmentClose);
    v8_runtime.registerHostFn("__segment_refine", hostSegmentRefine);
    v8_runtime.registerHostFn("__pose_estimate_async", hostPoseEstimateAsync);
    v8_runtime.registerHostFn("__pose_estimate_image", hostPoseEstimateImage);
    v8_runtime.registerHostFn("__pose_camera_devices", hostPoseCameraDevices);
}

fn emitPoseResult(result: *const pose.AsyncResult) void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const payload = if (!result.ok) blk: {
        const message = if (result.errorText().len > 0) result.errorText() else "pose inference failed";
        const escaped = jsonEscape(alloc, message) catch message;
        break :blk std.fmt.allocPrint(
            alloc,
            "{{\"ok\":false,\"error\":\"{s}\",\"elapsed_ms\":{d}}}",
            .{ escaped, result.elapsed_ms },
        ) catch return;
    } else blk: {
        var out: std.ArrayList(u8) = .empty;
        out.appendSlice(alloc, "{\"ok\":true,\"kp\":[") catch return;
        for (result.keypoints, 0..) |kp, i| {
            const chunk = std.fmt.allocPrint(
                alloc,
                "{s}{d:.4},{d:.4},{d:.3}",
                .{ if (i == 0) "" else ",", kp.x, kp.y, kp.score },
            ) catch return;
            out.appendSlice(alloc, chunk) catch return;
        }
        const tail = std.fmt.allocPrint(alloc, "],\"elapsed_ms\":{d}}}", .{result.elapsed_ms}) catch return;
        out.appendSlice(alloc, tail) catch return;
        break :blk out.toOwnedSlice(alloc) catch return;
    };

    var channel_buf: [64]u8 = undefined;
    const channel = std.fmt.bufPrintZ(&channel_buf, "pose:{d}", .{result.request_id}) catch return;
    const payload_z = alloc.dupeZ(u8, payload) catch return;
    v8_runtime.callGlobal2Str("__ffiEmit", channel, payload_z);
}

pub fn tickDrain() void {
    while (pose.pollAsync()) |result_value| {
        const result = result_value;
        emitPoseResult(&result);
    }
}
