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
//! Live pose inference runs on the BlazePose lane: the capture session
//! submits camera frames into blazepose.zig's bounded worker and tickDrain
//! routes completions back (req_4387; the MoveNet lane died in req_4390).

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const HostContext = @import("host_context.zig");
const onnx = @import("ml/onnx.zig");
const segment = @import("ml/segment.zig");
const blazepose = @import("ml/blazepose.zig");
const render_surfaces = @import("render/render_surfaces.zig");
const video_devices = @import("render/video_devices.zig");
const capture_session = @import("v8_bindings_capture_session.zig");
const build_options = @import("build_options");
const capture_world_target = if (@hasDecl(build_options, "has_compiled_world") and build_options.has_compiled_world)
    @import("v8_capture_world_target.zig")
else
    struct {
        pub fn register(_: *HostContext) void {}
    };

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
    const host = v8_runtime.hostContext(info.getIsolate());
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
    const handle = segment.openImage(host.io, host.environ, std.heap.c_allocator, path);
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
                    if (std.mem.eql(u8, key, "x")) x = num else if (std.mem.eql(u8, key, "y")) y = num else if (std.mem.eql(u8, key, "l")) l = if (num > 0.5) 1 else 0;
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
                const n: i32 = @trunc(num);
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
fn writeMaskPGM(io: std.Io, path: []const u8, mask: []const u8, w: u32, h: u32) bool {
    std.Io.Dir.cwd().createDirPath(io, std.fs.path.dirname(path) orelse ".") catch {};
    var file = std.Io.Dir.cwd().createFile(io, path, .{ .truncate = true }) catch return false;
    defer file.close(io);
    var hdr_buf: [64]u8 = undefined;
    const hdr = std.fmt.bufPrint(&hdr_buf, "P5\n{d} {d}\n1\n", .{ w, h }) catch return false;
    file.writeStreamingAll(io, hdr) catch return false;
    // segment.refineSegment returns 1=in-selection (erased), 0=keep. Our
    // P5 maxval=1 convention is identical — write the bytes as-is.
    file.writeStreamingAll(io, mask) catch return false;
    return true;
}

fn hostSegmentRefine(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
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
    if (!writeMaskPGM(host.io, out_path, mask, dims.w, dims.h)) {
        setReturnString(info, "err:write pgm failed");
        return;
    }
    const reply = std.fmt.allocPrint(alloc, "mask:{s}", .{out_path}) catch {
        setReturnString(info, "err:alloc reply");
        return;
    };
    setReturnString(info, reply);
}

// ── Pose host fns (req_4387/req_4390 — BlazePose only) ──────────────────────
// __pose_estimate_image(path) → single-image BlazePose solve (headless
//                               verify / agent probe): {ok, presence,
//                               kp:[x,y,visibility ×33], world:[x,y,z ×33 m]}.
// __pose_camera_devices()     → named V4L2 image-capture nodes (metadata-only
//                               companions are filtered by VIDIOC_QUERYCAP).
// Live inference has NO raw JS door: the capture session owns the camera
// lane end to end (framework/v8_bindings_capture_session.zig).

fn hostPoseEstimateImage(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
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
    const frame = blazepose.estimateImage(host.io, host.environ, path_z.ptr) orelse {
        const msg = blazepose.initError() orelse "no frame";
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
    const header = std.fmt.allocPrint(alloc, "{{\"ok\":true,\"presence\":{d:.3},\"kp\":[", .{frame.presence}) catch return;
    out.appendSlice(alloc, header) catch return;
    for (frame.landmarks, 0..) |landmark, i| {
        const chunk = std.fmt.allocPrint(
            alloc,
            "{s}{d:.4},{d:.4},{d:.3}",
            .{ if (i == 0) "" else ",", landmark.x, landmark.y, landmark.visibility },
        ) catch return;
        out.appendSlice(alloc, chunk) catch return;
    }
    out.appendSlice(alloc, "],\"world\":[") catch return;
    for (frame.landmarks, 0..) |landmark, i| {
        const chunk = std.fmt.allocPrint(
            alloc,
            "{s}{d:.4},{d:.4},{d:.4}",
            .{ if (i == 0) "" else ",", landmark.world[0], landmark.world[1], landmark.world[2] },
        ) catch return;
        out.appendSlice(alloc, chunk) catch return;
    }
    out.appendSlice(alloc, "]}") catch return;
    setReturnString(info, out.items);
}

fn hostPoseCameraDevices(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    var devices = video_devices.list(host.io, alloc) catch {
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

// __pose_smoothing(json?) → read/write the live BlazePose smoothing tuning
// (req_4391 — the capture workbench's stability sliders). With no argument
// it reports current values; with a JSON object it applies the given fields
// over the current tuning (rejected wholesale when out of range). Reply is
// always the full current tuning.
fn hostPoseSmoothing(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    var accepted = true;
    if (argString(info, 0, alloc)) |raw| {
        if (raw.len > 0) {
            accepted = false;
            if (std.json.parseFromSlice(std.json.Value, alloc, raw, .{}) catch null) |parsed| {
                if (parsed.value == .object) {
                    var tuning = blazepose.smoothing(host.io);
                    applySmoothingField(parsed.value.object, "screenMinCutoff", &tuning.screen_min_cutoff);
                    applySmoothingField(parsed.value.object, "screenBeta", &tuning.screen_beta);
                    applySmoothingField(parsed.value.object, "worldMinCutoff", &tuning.world_min_cutoff);
                    applySmoothingField(parsed.value.object, "worldBeta", &tuning.world_beta);
                    applySmoothingField(parsed.value.object, "auxMinCutoff", &tuning.aux_min_cutoff);
                    applySmoothingField(parsed.value.object, "auxBeta", &tuning.aux_beta);
                    applySmoothingField(parsed.value.object, "visibilityAlpha", &tuning.visibility_alpha);
                    accepted = blazepose.setSmoothing(host.io, tuning);
                }
            }
        }
    }
    const current = blazepose.smoothing(host.io);
    const payload = std.fmt.allocPrint(
        alloc,
        "{{\"ok\":{s},\"screenMinCutoff\":{d},\"screenBeta\":{d},\"worldMinCutoff\":{d},\"worldBeta\":{d},\"auxMinCutoff\":{d},\"auxBeta\":{d},\"visibilityAlpha\":{d}}}",
        .{
            if (accepted) "true" else "false",
            current.screen_min_cutoff,
            current.screen_beta,
            current.world_min_cutoff,
            current.world_beta,
            current.aux_min_cutoff,
            current.aux_beta,
            current.visibility_alpha,
        },
    ) catch {
        setReturnString(info, "{\"ok\":false}");
        return;
    };
    setReturnString(info, payload);
}

fn applySmoothingField(map: std.json.ObjectMap, key: []const u8, out: *f32) void {
    const value = map.get(key) orelse return;
    out.* = switch (value) {
        .float => |number| @floatCast(number),
        .integer => |number| @floatFromInt(number),
        else => return,
    };
}

fn hostCharacterCaptureSession(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    capture_session.hostCaptureSession(info_c);
}

pub fn registerOnnx(host: *HostContext) void {
    v8_runtime.registerHostFn("__onnx_test", hostTest);
    v8_runtime.registerHostFn("__segment_open", hostSegmentOpen);
    v8_runtime.registerHostFn("__segment_close", hostSegmentClose);
    v8_runtime.registerHostFn("__segment_refine", hostSegmentRefine);
    v8_runtime.registerHostFn("__pose_estimate_image", hostPoseEstimateImage);
    v8_runtime.registerHostFn("__pose_camera_devices", hostPoseCameraDevices);
    v8_runtime.registerHostFn("__pose_smoothing", hostPoseSmoothing);
    capture_session.register(host);
    capture_world_target.register(host);
    v8_runtime.registerHostFn("__capture_session", hostCharacterCaptureSession);
}

pub fn tickDrain(host: *HostContext) void {
    capture_session.tickSubmit(host);
    while (blazepose.pollAsync(host.io)) |result_value| {
        var result = result_value;
        defer result.deinit();
        _ = capture_session.consumePoseResult(host, &result);
    }
    // A completion frees the one-entry mailbox. Submit here as well as at
    // the start of the tick so capture stays inference-bound without waiting
    // an extra render frame; the native cadence floor still applies.
    capture_session.tickSubmit(host);
}
