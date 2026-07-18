//! Image segmentation via SlimSAM (SAM-family) ONNX models.
//!
//! Two ONNX sessions:
//!   ENCODER  pixel_values[1,3,1024,1024] f32
//!              → image_embeddings[1,256,64,64] + image_positional_embeddings[1,256,64,64]
//!   DECODER  (img_emb + pos_emb + input_points[1,1,N,2] f32 + input_labels[1,1,N] i64)
//!              → iou_scores[1,1,3], pred_masks[1,1,3,256,256] (logits)
//!
//! Per-image lifecycle:
//!   open(path)   load source, resize to 1024 letterbox, normalize, run encoder, cache embeddings
//!   refine(clicks) run decoder with cached embeddings + click prompts, return mask
//!   close()      drop embeddings
//!
//! Phase-2 simplifications (callouts are intentional, to be lifted in Phase 4):
//!   - Inference runs synchronously on the calling thread. Encoder is ~500ms-1s on
//!     CPU; decoder is ~50-100ms. The user clicks, the UI freezes for that
//!     duration, results come back. Worker thread + tick-drain is a follow-up.
//!   - Encoder cache is per-handle, not LRU. open() always re-runs encoder
//!     (so re-opening the same image is wasteful). LRU keyed by srcPath next.
//!   - We pick mask 0 (whole-object) from the 3 candidates. SAM convention:
//!     mask 0 = whole object, 1 = part, 2 = subpart. Highest-IoU isn't always
//!     "the object" — mask 2 often wins IoU but selects a tiny detail.

const std = @import("std");
const onnx = @import("onnx.zig");
const host_io = @import("../host_io.zig");
// Use onnx.c (shared cimport) so OrtApi/OrtValue/etc match the types
// returned by onnx.api() and other helpers. A second @cImport here would
// generate distinct-but-identical Zig types and break every cross-module
// call site at compile time.
const c = onnx.c;
// stb separately — independent cimport tree, no overlap concerns.
const stb = @cImport({
    @cInclude("stb/stb_image.h");
});

const log = std.log.scoped(.segment);

const SAM_INPUT_SIZE: usize = 1024;
const SAM_EMB_C: usize = 256;
const SAM_EMB_HW: usize = 64;
const SAM_DEC_OUT_SIZE: usize = 256; // pred_masks side
const SAM_MASKS_PER_DECODE: usize = 3;

// Standard SAM ImageNet-like normalization. Same constants as the python
// transformers reference.
const SAM_MEAN: [3]f32 = .{ 123.675, 116.28, 103.53 };
const SAM_STD:  [3]f32 = .{ 58.395, 57.12, 57.375 };

// ── Global ORT state ─────────────────────────────────────────────────

var g_env: ?*c.OrtEnv = null;
var g_encoder: ?*c.OrtSession = null;
var g_decoder: ?*c.OrtSession = null;
var g_mem_info: ?*c.OrtMemoryInfo = null;
var g_init_done: bool = false;
var g_init_failed: bool = false;
var g_init_error: ?[]u8 = null;

// ── Per-image handles ────────────────────────────────────────────────

const Handle = struct {
    in_use: bool = false,
    src_w: u32 = 0,         // original source width (pixels)
    src_h: u32 = 0,         // original source height (pixels)
    fit_w: u32 = 0,         // letterbox width inside 1024-canvas
    fit_h: u32 = 0,         // letterbox height inside 1024-canvas
    img_emb: ?[]f32 = null, // [1,256,64,64] = 1,048,576 f32 = 4MB
    pos_emb: ?[]f32 = null, // same shape
};

const MAX_HANDLES: usize = 8;
var g_handles: [MAX_HANDLES]Handle = undefined;
var g_handles_inited: bool = false;

fn allocHandle() ?u32 {
    if (!g_handles_inited) {
        for (&g_handles) |*h| h.* = .{};
        g_handles_inited = true;
    }
    for (&g_handles, 0..) |*h, i| {
        if (!h.in_use) {
            h.* = .{ .in_use = true };
            return @intCast(i);
        }
    }
    return null;
}

fn getHandle(id: u32) ?*Handle {
    if (id >= MAX_HANDLES) return null;
    const h = &g_handles[id];
    if (!h.in_use) return null;
    return h;
}

fn freeHandle(id: u32, alloc: std.mem.Allocator) void {
    const h = getHandle(id) orelse return;
    if (h.img_emb) |e| alloc.free(e);
    if (h.pos_emb) |e| alloc.free(e);
    h.* = .{};
}

// ── Initialization (lazy) ────────────────────────────────────────────

/// Get default model paths from $HOME/.reactjit/models/ . Returns null if
/// the encoder doesn't exist (user needs to download). Caller frees both
/// returned slices.
fn modelPaths(alloc: std.mem.Allocator) ?struct { enc: []u8, dec: []u8 } {
    const home = host_io.getenv("HOME") orelse return null;
    const dir = std.fmt.allocPrint(alloc, "{s}/.reactjit/models", .{home}) catch return null;
    defer alloc.free(dir);
    const enc = std.fmt.allocPrint(alloc, "{s}/slimsam_encoder.onnx", .{dir}) catch return null;
    const dec = std.fmt.allocPrint(alloc, "{s}/slimsam_decoder.onnx", .{dir}) catch {
        alloc.free(enc);
        return null;
    };
    // Sanity check at least encoder exists.
    std.Io.Dir.cwd().access(host_io.io(), enc, .{}) catch {
        alloc.free(enc);
        alloc.free(dec);
        return null;
    };
    return .{ .enc = enc, .dec = dec };
}

/// Load the encoder + decoder sessions once. Idempotent — subsequent calls
/// short-circuit. Sets g_init_failed + g_init_error on failure so future
/// open() calls return the same error without re-attempting.
fn ensureInit(alloc: std.mem.Allocator) bool {
    if (g_init_done) return true;
    if (g_init_failed) return false;
    g_init_done = true; // set early so re-entry is a no-op

    const api = onnx.api() orelse {
        recordInitErr(alloc, "ORT API unavailable");
        return false;
    };

    // Environment
    {
        const create_env = api.CreateEnv orelse {
            recordInitErr(alloc, "CreateEnv fn pointer null");
            return false;
        };
        const status = create_env(c.ORT_LOGGING_LEVEL_WARNING, "reactjit.segment", &g_env);
        if (status != null) {
            recordOrtErr(api, alloc, status, "CreateEnv");
            return false;
        }
    }

    // Session options (CPU only)
    var session_opts: ?*c.OrtSessionOptions = null;
    const create_sopts = api.CreateSessionOptions orelse {
        recordInitErr(alloc, "CreateSessionOptions null");
        return false;
    };
    if (create_sopts(&session_opts) != null) {
        recordInitErr(alloc, "CreateSessionOptions failed");
        return false;
    }
    defer if (api.ReleaseSessionOptions) |fp| fp(session_opts);

    // CPU memory info — shared across all tensor allocs we create.
    {
        const create_mi = api.CreateCpuMemoryInfo orelse {
            recordInitErr(alloc, "CreateCpuMemoryInfo null");
            return false;
        };
        if (create_mi(c.OrtArenaAllocator, c.OrtMemTypeDefault, &g_mem_info) != null) {
            recordInitErr(alloc, "CreateCpuMemoryInfo failed");
            return false;
        }
    }

    // Load models from ~/.reactjit/models/
    const paths = modelPaths(alloc) orelse {
        recordInitErr(alloc, "SAM model files not found at ~/.reactjit/models/slimsam_{encoder,decoder}.onnx — download via scripts/fetch-sam-models");
        return false;
    };
    defer alloc.free(paths.enc);
    defer alloc.free(paths.dec);

    // Need null-terminated C strings for CreateSession. Allocate once.
    const enc_z = alloc.dupeZ(u8, paths.enc) catch {
        recordInitErr(alloc, "OOM duplicating enc path");
        return false;
    };
    defer alloc.free(enc_z);
    const dec_z = alloc.dupeZ(u8, paths.dec) catch {
        recordInitErr(alloc, "OOM duplicating dec path");
        return false;
    };
    defer alloc.free(dec_z);

    const create_session = api.CreateSession orelse {
        recordInitErr(alloc, "CreateSession null");
        return false;
    };

    {
        const status = create_session(g_env, enc_z.ptr, session_opts, &g_encoder);
        if (status != null) {
            recordOrtErr(api, alloc, status, "CreateSession(encoder)");
            return false;
        }
    }
    {
        const status = create_session(g_env, dec_z.ptr, session_opts, &g_decoder);
        if (status != null) {
            recordOrtErr(api, alloc, status, "CreateSession(decoder)");
            return false;
        }
    }

    log.info("SAM models loaded — encoder + decoder ready", .{});
    return true;
}

pub fn initError() ?[]const u8 {
    if (g_init_error) |e| return e;
    return null;
}

fn recordInitErr(alloc: std.mem.Allocator, msg: []const u8) void {
    g_init_failed = true;
    g_init_error = alloc.dupe(u8, msg) catch null;
    log.err("init failed: {s}", .{msg});
}

fn recordOrtErr(api: *const c.OrtApi, alloc: std.mem.Allocator, status: ?*c.OrtStatus, where: []const u8) void {
    var msg: []const u8 = "unknown";
    if (api.GetErrorMessage) |fp| {
        const cstr = fp(status);
        if (cstr != null) msg = std.mem.span(cstr);
    }
    const combined = std.fmt.allocPrint(alloc, "{s}: {s}", .{ where, msg }) catch null;
    g_init_failed = true;
    g_init_error = combined;
    log.err("{s}: {s}", .{ where, msg });
    if (api.ReleaseStatus) |fp| fp(status);
}

// ── Preprocessing ────────────────────────────────────────────────────

/// Resize an RGB u8 image to fit inside (SAM_INPUT_SIZE × SAM_INPUT_SIZE)
/// preserving aspect ratio, padding the remainder with black. Output is a
/// normalized float32 NCHW tensor.
///
/// Returns the (fit_w, fit_h) — the inscribed region size before padding,
/// used later to crop the mask back to source aspect ratio.
fn preprocessToTensor(
    alloc: std.mem.Allocator,
    src_rgb: []const u8, // length src_w*src_h*3
    src_w: u32,
    src_h: u32,
) !struct { tensor: []f32, fit_w: u32, fit_h: u32 } {
    const longest: f32 = @floatFromInt(@max(src_w, src_h));
    const scale: f32 = @as(f32, @floatFromInt(SAM_INPUT_SIZE)) / longest;
    const fit_w: u32 = @intFromFloat(@as(f32, @floatFromInt(src_w)) * scale + 0.5);
    const fit_h: u32 = @intFromFloat(@as(f32, @floatFromInt(src_h)) * scale + 0.5);

    // Output tensor: [1,3,1024,1024] float32 = 12MB. Pre-zeroed for padding.
    const tensor_len: usize = 3 * SAM_INPUT_SIZE * SAM_INPUT_SIZE;
    const tensor = try alloc.alloc(f32, tensor_len);
    @memset(tensor, 0); // padding is zero in normalized space? No — see below.

    // Padding value in normalized space is (0 - mean) / std per channel,
    // which is what zero PIXELS would normalize to. We want zero PIXELS
    // (black padding), so we precompute the normalized zero per channel
    // and fill the buffer with that, then overwrite the fit region.
    inline for (0..3) |chan| {
        const norm_zero = (0.0 - SAM_MEAN[chan]) / SAM_STD[chan];
        const base = chan * SAM_INPUT_SIZE * SAM_INPUT_SIZE;
        @memset(tensor[base .. base + SAM_INPUT_SIZE * SAM_INPUT_SIZE], norm_zero);
    }

    // Bilinear resize from src into the (fit_w, fit_h) region, normalizing
    // each pixel as we go and writing directly to the NCHW tensor.
    const sx_step: f32 = @as(f32, @floatFromInt(src_w)) / @as(f32, @floatFromInt(fit_w));
    const sy_step: f32 = @as(f32, @floatFromInt(src_h)) / @as(f32, @floatFromInt(fit_h));
    var dy: u32 = 0;
    while (dy < fit_h) : (dy += 1) {
        const fy: f32 = (@as(f32, @floatFromInt(dy)) + 0.5) * sy_step - 0.5;
        const y0_f: f32 = @floor(fy);
        const y0: i32 = @intFromFloat(y0_f);
        const ty: f32 = fy - y0_f;
        const y0c: u32 = @intCast(std.math.clamp(y0, 0, @as(i32, @intCast(src_h)) - 1));
        const y1c: u32 = @intCast(std.math.clamp(y0 + 1, 0, @as(i32, @intCast(src_h)) - 1));

        var dx: u32 = 0;
        while (dx < fit_w) : (dx += 1) {
            const fx: f32 = (@as(f32, @floatFromInt(dx)) + 0.5) * sx_step - 0.5;
            const x0_f: f32 = @floor(fx);
            const x0: i32 = @intFromFloat(x0_f);
            const tx: f32 = fx - x0_f;
            const x0c: u32 = @intCast(std.math.clamp(x0, 0, @as(i32, @intCast(src_w)) - 1));
            const x1c: u32 = @intCast(std.math.clamp(x0 + 1, 0, @as(i32, @intCast(src_w)) - 1));

            // Four neighbors, RGB triples each.
            const p00 = (y0c * src_w + x0c) * 3;
            const p01 = (y0c * src_w + x1c) * 3;
            const p10 = (y1c * src_w + x0c) * 3;
            const p11 = (y1c * src_w + x1c) * 3;

            inline for (0..3) |chan| {
                const v00: f32 = @floatFromInt(src_rgb[p00 + chan]);
                const v01: f32 = @floatFromInt(src_rgb[p01 + chan]);
                const v10: f32 = @floatFromInt(src_rgb[p10 + chan]);
                const v11: f32 = @floatFromInt(src_rgb[p11 + chan]);
                const top  = v00 * (1 - tx) + v01 * tx;
                const bot  = v10 * (1 - tx) + v11 * tx;
                const raw  = top * (1 - ty) + bot * ty;
                const norm = (raw - SAM_MEAN[chan]) / SAM_STD[chan];
                tensor[chan * SAM_INPUT_SIZE * SAM_INPUT_SIZE
                    + dy * SAM_INPUT_SIZE + dx] = norm;
            }
        }
    }
    return .{ .tensor = tensor, .fit_w = fit_w, .fit_h = fit_h };
}

// ── Public API ───────────────────────────────────────────────────────

/// Load an image, run the encoder, store embeddings under a fresh handle.
/// Returns -1 on failure (call initError() / lastError() for details);
/// otherwise a small int handle for refine() / close().
pub fn openImage(alloc: std.mem.Allocator, path: []const u8) i32 {
    if (!ensureInit(alloc)) return -1;
    const api = onnx.api() orelse return -1;

    // Decode source via stb_image → RGB u8 buffer.
    const path_z = alloc.dupeZ(u8, path) catch return -1;
    defer alloc.free(path_z);
    var sw: c_int = 0;
    var sh: c_int = 0;
    var sc: c_int = 0;
    const pixels = stb.stbi_load(path_z.ptr, &sw, &sh, &sc, 3); // force RGB
    if (pixels == null or sw <= 0 or sh <= 0) {
        log.err("stbi_load failed for {s}", .{path});
        return -1;
    }
    defer stb.stbi_image_free(pixels);
    const src_w: u32 = @intCast(sw);
    const src_h: u32 = @intCast(sh);
    const src_len: usize = @as(usize, src_w) * @as(usize, src_h) * 3;
    const src_slice = pixels[0..src_len];

    // Preprocess into NCHW tensor.
    const pp = preprocessToTensor(alloc, src_slice, src_w, src_h) catch {
        log.err("preprocess OOM", .{});
        return -1;
    };
    defer alloc.free(pp.tensor);

    // Wrap tensor as OrtValue.
    var pixel_dims: [4]i64 = .{ 1, 3, SAM_INPUT_SIZE, SAM_INPUT_SIZE };
    var pixel_val: ?*c.OrtValue = null;
    {
        const create_tensor = api.CreateTensorWithDataAsOrtValue orelse return -1;
        const byte_count: usize = pp.tensor.len * @sizeOf(f32);
        if (create_tensor(@ptrCast(g_mem_info), @ptrCast(pp.tensor.ptr), byte_count, &pixel_dims, pixel_dims.len, c.ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &pixel_val) != null) {
            log.err("CreateTensorWithDataAsOrtValue failed for encoder input", .{});
            return -1;
        }
    }
    defer if (api.ReleaseValue) |fp| fp(pixel_val);

    // Run encoder.
    var enc_in_names: [1][*:0]const u8 = .{"pixel_values"};
    var enc_out_names: [2][*:0]const u8 = .{ "image_embeddings", "image_positional_embeddings" };
    var enc_inputs: [1]?*c.OrtValue = .{pixel_val};
    var enc_outputs: [2]?*c.OrtValue = .{ null, null };
    {
        const run_fn = api.Run orelse return -1;
        const status = run_fn(
            g_encoder, null,
            @as([*c]const [*c]const u8, @ptrCast(&enc_in_names)),
            @as([*c]const ?*const c.OrtValue, @ptrCast(&enc_inputs)),
            enc_in_names.len,
            @as([*c]const [*c]const u8, @ptrCast(&enc_out_names)),
            enc_out_names.len,
            &enc_outputs,
        );
        if (status != null) {
            recordRunErr(api, status, "encoder Run");
            return -1;
        }
    }
    defer if (api.ReleaseValue) |fp| {
        if (enc_outputs[0]) |v| fp(v);
        if (enc_outputs[1]) |v| fp(v);
    };

    // Copy embeddings out of ORT-managed memory into a Zig-owned buffer
    // we can keep across the call boundary.
    const emb_len: usize = 1 * SAM_EMB_C * SAM_EMB_HW * SAM_EMB_HW;
    const img_emb = alloc.alloc(f32, emb_len) catch return -1;
    const pos_emb = alloc.alloc(f32, emb_len) catch {
        alloc.free(img_emb);
        return -1;
    };
    if (!copyTensorTo(api, enc_outputs[0], img_emb)) {
        alloc.free(img_emb); alloc.free(pos_emb);
        return -1;
    }
    if (!copyTensorTo(api, enc_outputs[1], pos_emb)) {
        alloc.free(img_emb); alloc.free(pos_emb);
        return -1;
    }

    const handle_id = allocHandle() orelse {
        log.err("all segment handles in use", .{});
        alloc.free(img_emb); alloc.free(pos_emb);
        return -1;
    };
    const h = &g_handles[handle_id];
    h.src_w = src_w;
    h.src_h = src_h;
    h.fit_w = pp.fit_w;
    h.fit_h = pp.fit_h;
    h.img_emb = img_emb;
    h.pos_emb = pos_emb;
    log.info("opened image #{d} ({d}x{d}) → fit {d}x{d}", .{ handle_id, src_w, src_h, pp.fit_w, pp.fit_h });
    return @intCast(handle_id);
}

pub const ClickIn = struct { x: f32, y: f32, label: u8 }; // label: 1=keep, 0=reject

/// Tunables the cart exposes to the user. `threshold` is the sigmoid-logit
/// cutoff in postprocessMask (default 0 = SAM's natural cutoff; positive
/// shrinks the mask, negative grows it). `mask_idx` selects which of the
/// three SAM candidate masks to use: 0=whole object (default), 1=part,
/// 2=subpart.
pub const RefineOpts = struct {
    threshold: f32 = 0,
    mask_idx: u8 = 0,
};

/// Run the decoder with the given clicks (source-pixel coords). Returns a
/// freshly-allocated mask Uint8Array sized src_w * src_h (1=erased/selected,
/// 0=keep) the caller must free. Returns null on failure.
pub fn refineSegment(
    alloc: std.mem.Allocator,
    handle_id: u32,
    clicks: []const ClickIn,
    opts: RefineOpts,
) ?[]u8 {
    const h = getHandle(handle_id) orelse {
        log.err("refineSegment: bad handle {d}", .{handle_id});
        return null;
    };
    const api = onnx.api() orelse return null;
    if (clicks.len == 0) {
        // Empty mask.
        const out = alloc.alloc(u8, h.src_w * h.src_h) catch return null;
        @memset(out, 0);
        return out;
    }

    // Build click tensors. Coords are in 1024-canvas space.
    const fit_w_f: f32 = @floatFromInt(h.fit_w);
    const src_w_f: f32 = @floatFromInt(h.src_w);
    const fit_h_f: f32 = @floatFromInt(h.fit_h);
    const src_h_f: f32 = @floatFromInt(h.src_h);
    const sx_scale: f32 = fit_w_f / src_w_f;
    const sy_scale: f32 = fit_h_f / src_h_f;

    const n = clicks.len;
    const points = alloc.alloc(f32, n * 2) catch return null;
    defer alloc.free(points);
    const labels = alloc.alloc(i64, n) catch return null;
    defer alloc.free(labels);
    for (clicks, 0..) |p, i| {
        points[i * 2 + 0] = p.x * sx_scale;
        points[i * 2 + 1] = p.y * sy_scale;
        labels[i] = if (p.label == 0) 0 else 1;
    }

    var pt_dims: [4]i64 = .{ 1, 1, @intCast(n), 2 };
    var lb_dims: [3]i64 = .{ 1, 1, @intCast(n) };
    var emb_dims: [4]i64 = .{ 1, SAM_EMB_C, SAM_EMB_HW, SAM_EMB_HW };

    const create_tensor = api.CreateTensorWithDataAsOrtValue orelse return null;

    var pt_val: ?*c.OrtValue = null;
    if (create_tensor(@ptrCast(g_mem_info), @ptrCast(points.ptr), points.len * @sizeOf(f32), &pt_dims, pt_dims.len, c.ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &pt_val) != null) return null;
    defer if (api.ReleaseValue) |fp| fp(pt_val);

    var lb_val: ?*c.OrtValue = null;
    if (create_tensor(@ptrCast(g_mem_info), @ptrCast(labels.ptr), labels.len * @sizeOf(i64), &lb_dims, lb_dims.len, c.ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64, &lb_val) != null) return null;
    defer if (api.ReleaseValue) |fp| fp(lb_val);

    var img_emb_val: ?*c.OrtValue = null;
    if (create_tensor(@ptrCast(g_mem_info), @ptrCast(h.img_emb.?.ptr), h.img_emb.?.len * @sizeOf(f32), &emb_dims, emb_dims.len, c.ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &img_emb_val) != null) return null;
    defer if (api.ReleaseValue) |fp| fp(img_emb_val);

    var pos_emb_val: ?*c.OrtValue = null;
    if (create_tensor(@ptrCast(g_mem_info), @ptrCast(h.pos_emb.?.ptr), h.pos_emb.?.len * @sizeOf(f32), &emb_dims, emb_dims.len, c.ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &pos_emb_val) != null) return null;
    defer if (api.ReleaseValue) |fp| fp(pos_emb_val);

    var dec_in_names: [4][*:0]const u8 = .{ "input_points", "input_labels", "image_embeddings", "image_positional_embeddings" };
    var dec_inputs: [4]?*c.OrtValue = .{ pt_val, lb_val, img_emb_val, pos_emb_val };
    var dec_out_names: [2][*:0]const u8 = .{ "iou_scores", "pred_masks" };
    var dec_outputs: [2]?*c.OrtValue = .{ null, null };
    {
        const run_fn = api.Run orelse return null;
        const status = run_fn(
            g_decoder, null,
            @as([*c]const [*c]const u8, @ptrCast(&dec_in_names)),
            @as([*c]const ?*const c.OrtValue, @ptrCast(&dec_inputs)),
            dec_in_names.len,
            @as([*c]const [*c]const u8, @ptrCast(&dec_out_names)),
            dec_out_names.len,
            &dec_outputs,
        );
        if (status != null) {
            recordRunErr(api, status, "decoder Run");
            return null;
        }
    }
    defer if (api.ReleaseValue) |fp| {
        if (dec_outputs[0]) |v| fp(v);
        if (dec_outputs[1]) |v| fp(v);
    };

    // Read pred_masks [1,1,3,256,256]. Caller picks one of the 3 candidates
    // via opts.mask_idx (0=whole, 1=part, 2=subpart).
    var masks_buf: ?*f32 = null;
    {
        const get_data = api.GetTensorMutableData orelse return null;
        if (get_data(dec_outputs[1], @ptrCast(&masks_buf)) != null) return null;
    }
    if (masks_buf == null) return null;
    const all_masks: []f32 = (@as([*]f32, @ptrCast(masks_buf.?)))[0 .. SAM_MASKS_PER_DECODE * SAM_DEC_OUT_SIZE * SAM_DEC_OUT_SIZE];
    const mask_stride: usize = SAM_DEC_OUT_SIZE * SAM_DEC_OUT_SIZE;
    const idx: usize = if (opts.mask_idx < SAM_MASKS_PER_DECODE) @as(usize, opts.mask_idx) else 0;
    const picked: []f32 = all_masks[idx * mask_stride .. (idx + 1) * mask_stride];

    return postprocessMask(alloc, picked, h.fit_w, h.fit_h, h.src_w, h.src_h, opts.threshold);
}

pub fn closeImage(alloc: std.mem.Allocator, handle_id: u32) void {
    freeHandle(handle_id, alloc);
}

pub const Dims = struct { w: u32, h: u32 };

/// Source dimensions for a previously-opened handle. Used by the binding
/// layer to size the output mask PGM.
pub fn getHandleDims(handle_id: u32) ?Dims {
    const h = getHandle(handle_id) orelse return null;
    return .{ .w = h.src_w, .h = h.src_h };
}

// ── Helpers ──────────────────────────────────────────────────────────

fn copyTensorTo(api: *const c.OrtApi, val: ?*c.OrtValue, dst: []f32) bool {
    var src_ptr: ?*f32 = null;
    const get_data = api.GetTensorMutableData orelse return false;
    if (get_data(val, @ptrCast(&src_ptr)) != null) return false;
    if (src_ptr == null) return false;
    const src: [*]f32 = @ptrCast(src_ptr.?);
    @memcpy(dst, src[0..dst.len]);
    return true;
}

fn recordRunErr(api: *const c.OrtApi, status: ?*c.OrtStatus, where: []const u8) void {
    if (api.GetErrorMessage) |fp| {
        const cstr = fp(status);
        if (cstr != null) log.err("{s}: {s}", .{ where, std.mem.span(cstr) });
    }
    if (api.ReleaseStatus) |fp| fp(status);
}

/// Mask 0 is at SAM_DEC_OUT_SIZE × SAM_DEC_OUT_SIZE (256x256) logits, covers
/// the 1024 canvas. fit_w/fit_h are the inscribed-image region within the
/// 1024 canvas (in canvas pixels). We:
///   1. Compute the inscribed region in the 256-mask: (fit_w/1024)*256 etc.
///   2. Threshold logits > 0 inside that region.
///   3. Nearest-neighbor resize the cropped 256-region to (src_w × src_h).
fn postprocessMask(
    alloc: std.mem.Allocator,
    mask_logits: []const f32,
    fit_w: u32, fit_h: u32,
    src_w: u32, src_h: u32,
    threshold: f32,
) ?[]u8 {
    const dec_size_f: f32 = @floatFromInt(SAM_DEC_OUT_SIZE);
    const input_size_f: f32 = @floatFromInt(SAM_INPUT_SIZE);
    const crop_w_f: f32 = (@as(f32, @floatFromInt(fit_w)) / input_size_f) * dec_size_f;
    const crop_h_f: f32 = (@as(f32, @floatFromInt(fit_h)) / input_size_f) * dec_size_f;
    const crop_w: u32 = @intFromFloat(@floor(crop_w_f));
    const crop_h: u32 = @intFromFloat(@floor(crop_h_f));
    if (crop_w == 0 or crop_h == 0) return null;

    const out = alloc.alloc(u8, @as(usize, src_w) * @as(usize, src_h)) catch return null;
    const sx_step: f32 = @as(f32, @floatFromInt(crop_w)) / @as(f32, @floatFromInt(src_w));
    const sy_step: f32 = @as(f32, @floatFromInt(crop_h)) / @as(f32, @floatFromInt(src_h));
    var dy: u32 = 0;
    while (dy < src_h) : (dy += 1) {
        const sy_f: f32 = @as(f32, @floatFromInt(dy)) * sy_step;
        var sy: u32 = @intFromFloat(sy_f);
        if (sy >= crop_h) sy = crop_h - 1;
        const row_base: usize = sy * SAM_DEC_OUT_SIZE;
        const out_row_base: usize = dy * src_w;
        var dx: u32 = 0;
        while (dx < src_w) : (dx += 1) {
            const sx_f: f32 = @as(f32, @floatFromInt(dx)) * sx_step;
            var sx: u32 = @intFromFloat(sx_f);
            if (sx >= crop_w) sx = crop_w - 1;
            // Logit > threshold → foreground (mask convention: 1=in selection).
            // threshold=0 is SAM's natural cutoff; positive shrinks the
            // selection, negative grows it.
            out[out_row_base + dx] = if (mask_logits[row_base + sx] > threshold) 1 else 0;
        }
    }
    return out;
}
