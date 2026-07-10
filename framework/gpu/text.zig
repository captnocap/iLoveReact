//! Text rendering pipeline — FreeType glyph atlas + instanced textured quads.
//!
//! Owns the GlyphInstance struct, atlas texture, glyph cache, FreeType
//! handles, CPU-side glyph batch, GPU buffer, pipeline, and bind group.

const std = @import("std");
const log = @import("../diag/log.zig");
const wgpu = @import("wgpu");
const bu = @import("buffer_upload.zig");
const pack = @import("pack.zig");
const m = @import("../math/root.zig");
const c = @import("../c.zig").imports;
const shaders = @import("shaders.zig");
const core = @import("gpu.zig");
const rects = @import("rects.zig");

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

/// Per-instance glyph data — 48 bytes (was 72). Size rides float16x2 (a
/// glyph quad is a few hundred px at most — sub-pixel exact), atlas UVs
/// unorm16x4 ([0,1] by construction, ≤1/16-texel error on the 4096 atlas),
/// color unorm8x4; the vertex fetch widens them back so text_wgsl is
/// unchanged. Position AND the 2D affine (m_a..m_ty) stay f32: the matrix
/// multiplies full screen-pixel coordinates in the shader, so f16
/// coefficients would jitter rotated/scaled text by whole pixels. Default
/// identity (m_a=m_d=1) keeps the axis-aligned fast path free.
pub const GlyphInstance = extern struct {
    pos_x: f32,
    pos_y: f32,
    size: [2]f16,
    uv: [4]u16,
    color: [4]u8,
    m_a: f32 = 1,
    m_b: f32 = 0,
    m_c: f32 = 0,
    m_d: f32 = 1,
    m_tx: f32 = 0,
    m_ty: f32 = 0,
};

comptime {
    if (@sizeOf(GlyphInstance) != 48 or @alignOf(GlyphInstance) != 4) {
        @compileError("GlyphInstance must match text_wgsl per-instance vertex layout (48 bytes)");
    }
}

// ════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════

// Per-frame glyph instance buffer. Bumped from 32768 — the gallery atoms
// page (186 tiles, several with paragraph-length variants like
// AnimatedTextScenes) exhausts 32k around tile #148, after which new
// glyphs get silently dropped (g_glyph_count >= MAX_GLYPHS short-circuits
// the appender) and the rest of the page renders frame chrome but no text.
// 131072 leaves enough headroom for a heavily-text-bearing 200+ tile grid.
pub const MAX_GLYPHS = 131072;
const ATLAS_SIZE = 4096;
const MAX_ATLAS_GLYPHS = 8192;

/// Line-height override for the next drawTextWrapped call. 0 = use FreeType natural.
/// Set via setLineHeightOverride before the call; cleared automatically after one use.
var g_line_height_override: f32 = 0;

pub fn setLineHeightOverride(lh: f32) void {
    g_line_height_override = lh;
}

/// Letter-spacing (px, can be negative) applied to the next drawTextLine /
/// drawTextWrapped call. Kept in sync with framework/text.zig's measure path so
/// paint's wrap bound agrees with layout's computed width. Cleared by caller.
var g_letter_spacing: f32 = 0;

pub fn setLetterSpacing(ls: f32) void {
    g_letter_spacing = ls;
}

fn inlineGlyphSentinelLen(text: []const u8, i: usize) usize {
    if (i >= text.len) return 0;
    if (text[i] == 0x01) return 1;
    if (text[i] != '\\') return 0;
    if (i + 2 < text.len and text[i + 1] == '\\' and text[i + 2] == '1') return 3;
    if (i + 4 < text.len and text[i + 1] == '\\' and text[i + 2] == 'x' and text[i + 3] == '0' and text[i + 4] == '1') return 5;
    if (i + 1 < text.len and text[i + 1] == '1') return 2;
    if (i + 3 < text.len and text[i + 1] == 'x' and text[i + 2] == '0' and text[i + 3] == '1') return 4;
    return 0;
}

// ════════════════════════════════════════════════════════════════════════
// Atlas cache types
// ════════════════════════════════════════════════════════════════════════

const AtlasGlyphKey = struct {
    codepoint: u32,
    size_px: u16,
    font_id: u8, // family*2 + weight slot
};

const AtlasGlyphInfo = struct {
    uv_x: f32,
    uv_y: f32,
    uv_w: f32,
    uv_h: f32,
    bearing_x: i32,
    bearing_y: i32,
    advance: f32,
    width: i32,
    height: i32,
};

// ════════════════════════════════════════════════════════════════════════
// State
// ════════════════════════════════════════════════════════════════════════

// GPU resources
var g_text_pipeline: ?*wgpu.RenderPipeline = null;
var g_text_buffer: ?*wgpu.Buffer = null;
var g_text_bind_group: ?*wgpu.BindGroup = null;
var g_text_bind_group_layout: ?*wgpu.BindGroupLayout = null;
var g_atlas_texture: ?*wgpu.Texture = null;
var g_atlas_view: ?*wgpu.TextureView = null;

/// Glyph atlas texture bytes (ATLAS_SIZE² × RGBA8), resident once created.
/// Shell-side (UI text); device-local (VRAM). Fixed once allocated.
pub fn atlasTextureBytes() u64 {
    return if (g_atlas_texture != null) @as(u64, ATLAS_SIZE) * ATLAS_SIZE * 4 else 0;
}

/// Glyph instance buffer capacity bytes — the per-glyph GPU instance array,
/// allocated once on first text draw. Shell-side; device-local (VRAM).
pub fn glyphBufferBytes() u64 {
    return if (g_text_buffer != null) @as(u64, MAX_GLYPHS) * @sizeOf(GlyphInstance) else 0;
}
var g_atlas_sampler: ?*wgpu.Sampler = null;

// CPU-side glyph batch
var g_glyphs: [MAX_GLYPHS]GlyphInstance = undefined;
var g_glyph_count: usize = 0;
var g_last_glyph_count: usize = 0;
var g_atlas_miss_count: usize = 0;
var g_last_atlas_miss_count: usize = 0;

const MAX_TEXT_TRACE_LINES = 128;
const MAX_TEXT_TRACE_SAMPLE = 64;
const MAX_TEXT_TRACE_SUMMARY = 12000;

const TextTraceLine = struct {
    hash: u64 = 0,
    count: u16 = 0,
    size_px: u16 = 0,
    render_size_px: u16 = 0,
    font_id: u8 = 0,
    text_len: u16 = 0,
    sample_len: u8 = 0,
    sample: [MAX_TEXT_TRACE_SAMPLE]u8 = [_]u8{0} ** MAX_TEXT_TRACE_SAMPLE,
};

var g_text_trace: [MAX_TEXT_TRACE_LINES]TextTraceLine = [_]TextTraceLine{.{}} ** MAX_TEXT_TRACE_LINES;
var g_text_trace_count: usize = 0;
var g_last_text_trace_summary: [MAX_TEXT_TRACE_SUMMARY]u8 = [_]u8{0} ** MAX_TEXT_TRACE_SUMMARY;
var g_last_text_trace_summary_len: usize = 0;

// Inline glyph slot recording — filled by drawTextWrapped/drawTextLine,
// read by engine.paintNode to render polygons into text slots.
const node_layout = @import("../layout.zig");
pub const MAX_RECORDED_SLOTS = node_layout.MAX_INLINE_SLOTS;
pub var g_inline_slots: [MAX_RECORDED_SLOTS]node_layout.InlineSlot = [_]node_layout.InlineSlot{.{}} ** MAX_RECORDED_SLOTS;
pub var g_inline_slot_count: u8 = 0;

pub fn resetInlineSlots() void {
    g_inline_slot_count = 0;
}

// Active text effect — when set, glyph colors are sampled from effect pixel buffer
var g_text_effect_pixels: ?[*]const u8 = null;
var g_text_effect_w: u32 = 0;
var g_text_effect_h: u32 = 0;
var g_text_effect_sx: f32 = 0; // screen-space origin of effect texture
var g_text_effect_sy: f32 = 0;

pub fn setTextEffect(pixels: ?[*]const u8, w: u32, h: u32, sx: f32, sy: f32) void {
    g_text_effect_pixels = pixels;
    g_text_effect_w = w;
    g_text_effect_h = h;
    g_text_effect_sx = sx;
    g_text_effect_sy = sy;
}

pub fn clearTextEffect() void {
    g_text_effect_pixels = null;
}

/// Sample RGB from the active text effect at a screen position.
/// Uses screen position modulo effect size to tile the effect across text.
fn sampleTextEffect(screen_x: f32, screen_y: f32) ?[3]f32 {
    const pixels = g_text_effect_pixels orelse return null;
    const w = g_text_effect_w;
    const h = g_text_effect_h;
    if (w == 0 or h == 0) return null;
    const wf = @as(f32, @floatFromInt(w));
    const hf = @as(f32, @floatFromInt(h));
    // Tile: use screen position modulo effect texture size
    var ux = @mod(screen_x, wf);
    var vy = @mod(screen_y, hf);
    if (ux < 0) ux += wf;
    if (vy < 0) vy += hf;
    const ui: u32 = @min(@as(u32, @intFromFloat(ux)), w - 1);
    const vi: u32 = @min(@as(u32, @intFromFloat(vy)), h - 1);
    const idx = (vi * w + ui) * 4;
    return .{
        @as(f32, @floatFromInt(pixels[idx])) / 255.0,
        @as(f32, @floatFromInt(pixels[idx + 1])) / 255.0,
        @as(f32, @floatFromInt(pixels[idx + 2])) / 255.0,
    };
}

// Atlas packer state
var g_atlas_row_x: u32 = 0;
var g_atlas_row_y: u32 = 0;
var g_atlas_row_h: u32 = 0;

// Atlas glyph cache
var g_atlas_keys: [MAX_ATLAS_GLYPHS]AtlasGlyphKey = undefined;
var g_atlas_vals: [MAX_ATLAS_GLYPHS]AtlasGlyphInfo = undefined;
var g_atlas_count: usize = 0;
var g_atlas_index: std.AutoHashMap(u64, u32) = undefined;

// FreeType handles
const MAX_FONT_FAMILIES = 8;

const FontFamilySlot = struct {
    regular: c.FT_Face = null,
    bold: c.FT_Face = null,
    current_size_regular: u16 = 0,
    current_size_bold: u16 = 0,
};

var g_ft_library: c.FT_Library = null;
var g_ft_face: c.FT_Face = null;
var g_ft_face_bold: c.FT_Face = null;
var g_font_families: [MAX_FONT_FAMILIES]FontFamilySlot = [_]FontFamilySlot{.{}} ** MAX_FONT_FAMILIES;
var g_ft_fallbacks: [8]c.FT_Face = undefined;
var g_ft_fallback_count: usize = 0;
var g_ft_current_size: u16 = 0;
var g_ft_current_size_bold: u16 = 0;
var g_font_family_id: u8 = 0;

// Active weight for the next draw / measure call. Mirrors the existing
// g_letter_spacing / g_line_height_override pattern — engine.zig sets this
// before painting/measuring a Text node, then resets to false.
var g_use_bold: bool = false;

pub fn setBold(b: bool) void {
    g_use_bold = b;
}

pub fn setFontFamily(id: u8) void {
    const idx: usize = @intCast(id);
    g_font_family_id = if (idx < MAX_FONT_FAMILIES and g_font_families[idx].regular != null) id else 0;
}

fn recordTextTrace(text: []const u8, size_px: u16, render_size_px: u16) void {
    if (text.len == 0) return;
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(text);
    var meta: [5]u8 = .{
        @intCast(size_px & 0xff),
        @intCast((size_px >> 8) & 0xff),
        @intCast(render_size_px & 0xff),
        @intCast((render_size_px >> 8) & 0xff),
        activeFontId(),
    };
    hasher.update(&meta);
    const hash = hasher.final();

    for (0..g_text_trace_count) |i| {
        if (g_text_trace[i].hash == hash) {
            if (g_text_trace[i].count < std.math.maxInt(u16)) g_text_trace[i].count += 1;
            return;
        }
    }
    if (g_text_trace_count >= MAX_TEXT_TRACE_LINES) return;

    var line = TextTraceLine{
        .hash = hash,
        .count = 1,
        .size_px = size_px,
        .render_size_px = render_size_px,
        .font_id = activeFontId(),
        .text_len = @intCast(@min(text.len, std.math.maxInt(u16))),
    };
    const n = @min(text.len, MAX_TEXT_TRACE_SAMPLE);
    for (0..n) |i| {
        const b = text[i];
        line.sample[i] = if (b == '\n' or b == '\r' or b == '\t') ' ' else b;
    }
    line.sample_len = @intCast(n);
    g_text_trace[g_text_trace_count] = line;
    g_text_trace_count += 1;
}

pub fn testingResetAttributionState() void {
    g_glyph_count = 0;
    g_last_glyph_count = 0;
    g_atlas_miss_count = 0;
    g_last_atlas_miss_count = 0;
    g_text_trace_count = 0;
    g_last_text_trace_summary_len = 0;
}

pub fn testingRecordTextTrace(text: []const u8, size_px: u16, render_size_px: u16) void {
    recordTextTrace(text, size_px, render_size_px);
}

pub fn testingBumpAtlasMisses(n: usize) void {
    g_atlas_miss_count += n;
}

/// Pick the right face for the active weight and ensure its FreeType pixel
/// size matches `size_px`. Returns the face that subsequent FT calls should
/// target. Tracks size per face so flipping bold on/off doesn't thrash the
/// regular face's `FT_Set_Pixel_Sizes` cache.
fn activeFace(size_px: u16) c.FT_Face {
    const family_idx: usize = @intCast(g_font_family_id);
    var slot = &g_font_families[family_idx];
    if (slot.regular == null) slot = &g_font_families[0];

    if (g_use_bold and slot.bold != null) {
        if (slot.current_size_bold != size_px) {
            _ = c.FT_Set_Pixel_Sizes(slot.bold, 0, size_px);
            slot.current_size_bold = size_px;
        }
        return slot.bold;
    }
    if (slot.current_size_regular != size_px) {
        _ = c.FT_Set_Pixel_Sizes(slot.regular, 0, size_px);
        slot.current_size_regular = size_px;
    }
    return slot.regular;
}

fn activeFontId() u8 {
    const family_idx: usize = @intCast(g_font_family_id);
    const slot = if (family_idx < MAX_FONT_FAMILIES) g_font_families[family_idx] else g_font_families[0];
    const weight: u8 = if (g_use_bold and slot.bold != null) 1 else 0;
    return g_font_family_id * 2 + weight;
}

/// Register a bold face. Optional — if absent, every weight renders regular.
/// TextEngine.initHeadless calls this after loading the bold .ttf, mirroring
/// how `initText` registers the regular face + fallbacks.
pub fn setBoldFace(face_bold: c.FT_Face) void {
    g_ft_face_bold = face_bold;
    g_font_families[0].bold = face_bold;
    g_ft_current_size_bold = 0;
}

fn firstLoadableFace(paths: []const [*:0]const u8) c.FT_Face {
    for (paths) |path| {
        var face: c.FT_Face = undefined;
        if (c.FT_New_Face(g_ft_library, path, 0, &face) == 0) {
            _ = c.FT_Set_Pixel_Sizes(face, 0, 16);
            return face;
        }
    }
    return null;
}

fn loadFontFamily(id: u8, regular_paths: []const [*:0]const u8, bold_paths: []const [*:0]const u8) void {
    const idx: usize = @intCast(id);
    if (idx >= MAX_FONT_FAMILIES) return;
    const regular = firstLoadableFace(regular_paths);
    if (regular == null) return;
    g_font_families[idx] = .{
        .regular = regular,
        .bold = firstLoadableFace(bold_paths),
    };
}

// ════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════

/// Initialize text rendering. Call after gpu.init() and after TextEngine is created.
pub fn initText(library: c.FT_Library, face: c.FT_Face, fallbacks: anytype, fallback_count: usize) void {
    g_ft_library = library;
    g_ft_face = face;
    g_font_families[0] = .{ .regular = face, .bold = g_ft_face_bold };
    g_ft_fallback_count = @min(fallback_count, 8);
    for (0..g_ft_fallback_count) |i| {
        g_ft_fallbacks[i] = fallbacks[i];
    }
    g_ft_current_size = 0;
    g_ft_current_size_bold = 0;
    g_atlas_index = std.AutoHashMap(u64, u32).init(std.heap.page_allocator);

    const device = core.getDevice() orelse return;

    // Create atlas texture (RGBA8, 2048x2048)
    g_atlas_texture = device.createTexture(&.{
        .label = wgpu.StringView.fromSlice("glyph_atlas"),
        .size = .{ .width = ATLAS_SIZE, .height = ATLAS_SIZE, .depth_or_array_layers = 1 },
        .mip_level_count = 1,
        .sample_count = 1,
        .dimension = .@"2d",
        .format = .rgba8_unorm,
        .usage = wgpu.TextureUsages.texture_binding | wgpu.TextureUsages.copy_dst,
    });

    if (g_atlas_texture) |tex| {
        g_atlas_view = tex.createView(null);
    }

    g_atlas_sampler = device.createSampler(&.{
        .address_mode_u = .clamp_to_edge,
        .address_mode_v = .clamp_to_edge,
        .mag_filter = .linear,
        .min_filter = .linear,
    });

    // Create text instance buffer
    g_text_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("glyph_instances"),
        .size = MAX_GLYPHS * @sizeOf(GlyphInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    loadFontFamily(1, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf",
    }, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf",
    });
    loadFontFamily(2, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/opentype/urw-base35/NimbusRoman-Regular.otf",
    }, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
        "/usr/share/fonts/opentype/urw-base35/NimbusRoman-Bold.otf",
    });
    loadFontFamily(3, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
        "/usr/share/fonts/opentype/urw-base35/NimbusMonoPS-Regular.otf",
    }, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
        "/usr/share/fonts/opentype/urw-base35/NimbusMonoPS-Bold.otf",
    });
    loadFontFamily(4, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansDisplay-Regular.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    }, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansDisplay-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    });
    loadFontFamily(5, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf",
    }, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf",
    });
    loadFontFamily(6, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
        "/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf",
    }, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
        "/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf",
    });
    loadFontFamily(7, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/roboto/unhinted/RobotoCondensed-Regular.ttf",
        "/usr/share/fonts/truetype/quicksand/Quicksand-Regular.ttf",
    }, &[_][*:0]const u8{
        "/usr/share/fonts/truetype/roboto/unhinted/RobotoCondensed-Bold.ttf",
        "/usr/share/fonts/truetype/quicksand/Quicksand-Bold.ttf",
    });

    initPipeline(device);
}

/// Draw a single line of text at (x, y) with the given font size and color.
pub fn drawTextLine(text: []const u8, x: f32, y: f32, size_px: u16, cr: f32, cg: f32, cb: f32, ca: f32) void {
    if (g_ft_face == null or core.g_gpu_ops >= core.GPU_OPS_BUDGET) return;
    core.g_gpu_ops += 1;

    const transform = core.getTransform();
    const s = transform.scale;
    const has_transform = transform.active;

    // Active CSS node-matrix (rotate/scale/translate). Identity unless an
    // ancestor pushed a transform via engine.zig:paintNode.
    const node_m = core.getNodeMatrix();
    const node_active = core.nodeMatrixActive();
    const matrix_scale: f32 = if (node_active) m.mat2dScaleX(node_m.a, node_m.b) else 1;

    // When canvas transform OR a node CSS transform with scale is active,
    // rasterize the atlas at the effective size for crisp glyphs.
    const effective_size = @as(f32, @floatFromInt(size_px)) * s * matrix_scale;
    const render_size: u16 = if (has_transform or node_active)
        @intFromFloat(@max(4, @min(200, @round(effective_size))))
    else
        size_px;
    recordTextTrace(text, size_px, render_size);

    const face = activeFace(render_size);
    const ascent: f32 = @as(f32, @floatFromInt(face.*.size.*.metrics.ascender)) / 64.0;

    // Pen position: transform the starting point (when canvas is active),
    // then advance in screen space. Always round to integer pixels —
    // flex/centering routinely produces fractional x/y from layout, and a
    // half-pixel offset at draw time makes the linear atlas sampler blend
    // across neighbouring texel rows. That smear is invisible on small
    // hinted glyphs (the hinter already snapped them to whole pixels) but
    // softens every edge of larger sizes, producing the "small is crisp,
    // big is blurry" effect.
    // Skip integer snapping when a node CSS transform is active — rotated
    // glyph corners aren't pixel-aligned anyway, and snapping the line anchor
    // jiggles rotated text against its pivot.
    const snap = !node_active;
    var pen_x: f32 = if (has_transform) (x - transform.ox) * s + transform.ox + transform.tx else x;
    var start_y: f32 = if (has_transform) (y - transform.oy) * s + transform.oy + transform.ty else y;
    if (snap) {
        pen_x = @round(pen_x);
        start_y = @round(start_y);
    }
    const baseline_y = start_y + ascent;
    // Glyph atlas pixels were rasterized at matrix_scale * canvas_scale, so
    // divide the per-glyph advance/size/bearing by matrix_scale to keep them in
    // the pre-matrix coordinate space the shader will multiply through `m_*`.
    const inv_ms: f32 = if (node_active) 1.0 / matrix_scale else 1.0;

    var i: usize = 0;
    while (i < text.len) {
        // Inline glyph sentinel — record slot position, advance by fontSize
        const sentinel_len = inlineGlyphSentinelLen(text, i);
        if (sentinel_len > 0) {
            if (g_inline_slot_count < MAX_RECORDED_SLOTS) {
                const slot_size: f32 = @floatFromInt(size_px);
                g_inline_slots[g_inline_slot_count] = .{
                    .x = pen_x,
                    .y = start_y,
                    .size = slot_size,
                    .glyph_index = g_inline_slot_count,
                };
                g_inline_slot_count += 1;
            }
            pen_x += @floatFromInt(size_px);
            pen_x += g_letter_spacing;
            i += sentinel_len;
            continue;
        }
        const ch = decodeUtf8(text[i..]);
        if (ch.codepoint == '\n') {
            i += ch.len;
            continue;
        }

        if (cacheGlyph(ch.codepoint, render_size)) |glyph| {
            if (glyph.width > 0 and glyph.height > 0) {
                if (g_glyph_count < MAX_GLYPHS) {
                    const gx = pen_x + @as(f32, @floatFromInt(glyph.bearing_x)) * inv_ms;
                    const gy = baseline_y - @as(f32, @floatFromInt(glyph.bearing_y)) * inv_ms;
                    const sw = @as(f32, @floatFromInt(glyph.width)) * inv_ms;
                    const sh = @as(f32, @floatFromInt(glyph.height)) * inv_ms;
                    // Sample effect color at glyph center if text effect is active
                    const ecol = sampleTextEffect(gx + sw / 2, gy + sh / 2);
                    g_glyphs[g_glyph_count] = .{
                        .pos_x = gx,
                        .pos_y = gy,
                        .size = .{ pack.f16FromF32(sw), pack.f16FromF32(sh) },
                        .uv = .{ pack.unorm16(glyph.uv_x), pack.unorm16(glyph.uv_y), pack.unorm16(glyph.uv_w), pack.unorm16(glyph.uv_h) },
                        .color = pack.rgba8(
                            if (ecol) |e| e[0] else cr,
                            if (ecol) |e| e[1] else cg,
                            if (ecol) |e| e[2] else cb,
                            ca,
                        ),
                        .m_a = if (node_active) node_m.a else 1,
                        .m_b = if (node_active) node_m.b else 0,
                        .m_c = if (node_active) node_m.c else 0,
                        .m_d = if (node_active) node_m.d else 1,
                        .m_tx = if (node_active) node_m.tx else 0,
                        .m_ty = if (node_active) node_m.ty else 0,
                    };
                    g_glyph_count += 1;
                }
            }
            pen_x += glyph.advance * inv_ms;
            pen_x += g_letter_spacing;
        } else {
            // Atlas full / glyph load failure: still advance the pen so the
            // missing character leaves a roughly correct-width gap instead of
            // silently overlapping the next glyph. Matches getCharAdvance's
            // fallback so measurement and paint agree.
            pen_x += @as(f32, @floatFromInt(size_px)) * 0.5 * inv_ms;
            pen_x += g_letter_spacing;
        }
        i += ch.len;
    }
}

pub fn measureTextLineWidth(text: []const u8, size_px: u16) f32 {
    if (g_ft_face == null) return 0;
    _ = activeFace(size_px);

    var width: f32 = 0;
    var i: usize = 0;
    while (i < text.len) {
        const sentinel_len = inlineGlyphSentinelLen(text, i);
        if (sentinel_len > 0) {
            width += @floatFromInt(size_px);
            i += sentinel_len;
            continue;
        }

        const ch = decodeUtf8(text[i..]);
        if (ch.codepoint == '\n') {
            i += ch.len;
            continue;
        }
        if (cacheGlyph(ch.codepoint, size_px)) |glyph| {
            width += glyph.advance;
        } else {
            width += @as(f32, @floatFromInt(size_px)) * 0.5;
        }
        i += ch.len;
    }
    return width;
}

pub fn drawColorTextRow(spans: []const node_layout.ColorTextSpan, x: f32, y: f32, size_px: u16, opacity: f32) void {
    var pen_x = x;
    for (spans) |span| {
        const color = span.color;
        const alpha = (@as(f32, @floatFromInt(color.a)) / 255.0) * opacity;
        drawTextLine(
            span.text,
            pen_x,
            y,
            size_px,
            @as(f32, @floatFromInt(color.r)) / 255.0,
            @as(f32, @floatFromInt(color.g)) / 255.0,
            @as(f32, @floatFromInt(color.b)) / 255.0,
            alpha,
        );
        // Step to the next colored span exactly as drawTextLine stepped this
        // one, including letter spacing and inline-glyph sentinels. Syntax
        // token boundaries must not alter the geometry of the glyph run.
        pen_x += subLineAdvance(span.text, size_px);
    }
}

// ── Shared word-wrap walker ────────────────────────────────────────────────
//
// One algorithm decides how a string breaks into visual lines. Both the
// painter (drawTextWrapped) and any sibling pass that needs to land pixels
// behind those same lines (drawSelectionRects, hit-testing, debug overlays)
// drive off it. Anything that wants to walk text MUST go through walkLines —
// reimplementing the wrap logic locally is what produced the per-cart
// selection drift this replaced.
//
// Caller passes a context value with an `onLine(byte_start, byte_end, x, y)`
// method; walkLines invokes it once per visual line in paint order.

pub fn walkLines(
    text: []const u8,
    x_start: f32,
    y_start: f32,
    size_px: u16,
    max_width: f32,
    max_lines: u16,
    ctx: anytype,
) f32 {
    if (g_ft_face == null) return 0;

    const face = activeFace(size_px);
    const natural_line_h: f32 = @as(f32, @floatFromInt(face.*.size.*.metrics.height)) / 64.0;
    const line_h: f32 = if (g_line_height_override > 0) g_line_height_override else natural_line_h;

    if (max_width <= 0) {
        // Single-line fast path: no wrap, one onLine emission for the whole string.
        ctx.onLine(0, text.len, x_start, y_start);
        return line_h;
    }

    const space_w = getCharAdvance(' ', size_px);
    const ls = g_letter_spacing;

    // Word-by-word wrap. Words wider than max_width get their own line (no
    // mid-word break) — matches `overflow-wrap: normal`.
    var pen_y: f32 = y_start;
    var lines_drawn: u16 = 0;
    var line_start: usize = 0;
    var line_width: f32 = 0;
    var last_word_end: usize = 0;
    var i: usize = 0;

    while (i < text.len) {
        if (max_lines > 0 and lines_drawn >= max_lines) break;
        if (text[i] == '\n') {
            const end = if (last_word_end > line_start) last_word_end else i;
            ctx.onLine(line_start, end, x_start, pen_y);
            lines_drawn += 1;
            pen_y += line_h;
            i += 1;
            line_start = i;
            last_word_end = i;
            line_width = 0;
            continue;
        }
        if (text[i] == ' ') {
            i += 1;
            continue;
        }

        const word_start = i;
        var word_width: f32 = 0;
        var word_chars: usize = 0;
        while (i < text.len and text[i] != ' ' and text[i] != '\n') {
            const sentinel_len = inlineGlyphSentinelLen(text, i);
            if (sentinel_len > 0) {
                if (word_chars > 0) word_width += ls;
                word_width += @as(f32, @floatFromInt(size_px));
                word_chars += 1;
                i += sentinel_len;
                continue;
            }
            const ch = decodeUtf8(text[i..]);
            if (word_chars > 0) word_width += ls;
            word_width += getCharAdvance(ch.codepoint, size_px);
            word_chars += 1;
            i += ch.len;
        }
        const word_end = i;

        const need_space = (line_width > 0);
        const separator_w: f32 = if (need_space) space_w + ls * 2 else 0;
        const with_word = line_width + separator_w + word_width;

        if (need_space and with_word > max_width) {
            ctx.onLine(line_start, last_word_end, x_start, pen_y);
            lines_drawn += 1;
            pen_y += line_h;
            line_start = word_start;
            line_width = word_width;
            last_word_end = word_end;
        } else {
            line_width = with_word;
            last_word_end = word_end;
        }
    }

    if (line_start < text.len and (max_lines == 0 or lines_drawn < max_lines)) {
        const end = if (last_word_end > line_start) last_word_end else text.len;
        ctx.onLine(line_start, end, x_start, pen_y);
        pen_y += line_h;
    }

    return pen_y - y_start;
}

/// Pen advance from a line's start to a substring boundary, mirroring
/// drawTextLine's stepping exactly so selection-rect endpoints land on the
/// same x as the painted glyphs. Letter-spacing is added after every glyph
/// (including inline sentinels and missing-glyph fallbacks) — same as the
/// painter — so adjacent selection rects abut cleanly.
pub fn subLineAdvance(text: []const u8, size_px: u16) f32 {
    if (g_ft_face == null) return 0;
    _ = activeFace(size_px);

    var pen_x: f32 = 0;
    var i: usize = 0;
    while (i < text.len) {
        const sentinel_len = inlineGlyphSentinelLen(text, i);
        if (sentinel_len > 0) {
            pen_x += @as(f32, @floatFromInt(size_px));
            pen_x += g_letter_spacing;
            i += sentinel_len;
            continue;
        }
        const ch = decodeUtf8(text[i..]);
        if (ch.codepoint == '\n') {
            i += ch.len;
            continue;
        }
        if (cacheGlyph(ch.codepoint, size_px)) |glyph| {
            pen_x += glyph.advance;
        } else {
            pen_x += @as(f32, @floatFromInt(size_px)) * 0.5;
        }
        pen_x += g_letter_spacing;
        i += ch.len;
    }
    return pen_x;
}

/// Hit-test text laid out by walkLines: returns the byte index closest to
/// (target_x, target_y) in node-local coords (relative to the text's top-left).
/// Uses the same wrap and pen-stepping as the painter so a click lands on the
/// glyph it visually appears to land on. Past-last-line snaps to text.len;
/// past-end-of-line snaps to that line's last byte.
pub fn byteIndexAtPos(
    text: []const u8,
    size_px: u16,
    max_width: f32,
    target_x: f32,
    target_y: f32,
) usize {
    if (g_ft_face == null or text.len == 0) return 0;
    const face = activeFace(size_px);
    const natural_line_h: f32 = @as(f32, @floatFromInt(face.*.size.*.metrics.height)) / 64.0;
    const line_h: f32 = if (g_line_height_override > 0) g_line_height_override else natural_line_h;
    const target_line: usize = if (target_y < 0) 0 else @intFromFloat(target_y / line_h);

    const Ctx = struct {
        text: []const u8,
        size_px: u16,
        target_line: usize,
        target_x: f32,
        line_idx: usize = 0,
        result: usize = 0,
        result_set: bool = false,
        last_line_end: usize = 0,
        pub fn onLine(self: *@This(), byte_start: usize, byte_end: usize, lx: f32, ly: f32) void {
            _ = lx;
            _ = ly;
            self.last_line_end = byte_end;
            if (self.result_set) {
                self.line_idx += 1;
                return;
            }
            if (self.line_idx == self.target_line) {
                self.result = byte_start + closestByteOnSlice(self.text[byte_start..byte_end], self.size_px, self.target_x);
                self.result_set = true;
            }
            self.line_idx += 1;
        }
    };
    var ctx = Ctx{
        .text = text,
        .size_px = size_px,
        .target_line = target_line,
        .target_x = target_x,
    };
    _ = walkLines(text, 0, 0, size_px, max_width, 0, &ctx);
    if (ctx.result_set) return ctx.result;
    // Past last visual line: clamp to the end of the last line (excludes trailing
    // whitespace / newline byte to match the painter's byte_end semantics).
    return ctx.last_line_end;
}

/// Walk a single line slice with drawTextLine's exact pen-stepping; return
/// the byte index whose left/right midpoint best matches target_x.
fn closestByteOnSlice(text: []const u8, size_px: u16, target_x: f32) usize {
    if (g_ft_face == null) return 0;
    _ = activeFace(size_px);
    var pen_x: f32 = 0;
    var i: usize = 0;
    while (i < text.len) {
        var advance: f32 = 0;
        var step: usize = 0;
        const sentinel_len = inlineGlyphSentinelLen(text, i);
        if (sentinel_len > 0) {
            advance = @as(f32, @floatFromInt(size_px));
            step = sentinel_len;
        } else {
            const ch = decodeUtf8(text[i..]);
            if (ch.codepoint == '\n') {
                i += ch.len;
                continue;
            }
            if (cacheGlyph(ch.codepoint, size_px)) |glyph| {
                advance = glyph.advance;
            } else {
                advance = @as(f32, @floatFromInt(size_px)) * 0.5;
            }
            step = ch.len;
        }
        // Snap to the cursor BEFORE the glyph if the click is left of the
        // glyph's horizontal midpoint, AFTER if right of it. This is the
        // standard text-editor caret-placement rule.
        if (pen_x + advance / 2.0 > target_x) return i;
        pen_x += advance;
        pen_x += g_letter_spacing;
        i += step;
    }
    return text.len;
}

/// Draw text with word-wrapping at max_width. Returns total height drawn.
pub fn drawTextWrapped(text: []const u8, x: f32, y: f32, size_px: u16, max_width: f32, cr: f32, cg: f32, cb: f32, ca: f32, max_lines: u16) f32 {
    if (g_ft_face == null or core.g_gpu_ops >= core.GPU_OPS_BUDGET) return 0;
    core.g_gpu_ops += 1;

    const Ctx = struct {
        text: []const u8,
        size_px: u16,
        cr: f32,
        cg: f32,
        cb: f32,
        ca: f32,
        pub fn onLine(self: @This(), byte_start: usize, byte_end: usize, lx: f32, ly: f32) void {
            drawTextLine(self.text[byte_start..byte_end], lx, ly, self.size_px, self.cr, self.cg, self.cb, self.ca);
        }
    };
    const ctx = Ctx{
        .text = text,
        .size_px = size_px,
        .cr = cr,
        .cg = cg,
        .cb = cb,
        .ca = ca,
    };
    return walkLines(text, x, y, size_px, max_width, max_lines, ctx);
}

/// Draw selection highlight rectangles for a byte range within wrapped text.
/// Reuses walkLines so line breaks are guaranteed to match the painter, then
/// uses subLineAdvance — the same pen-stepping drawTextLine uses — to find
/// the x positions of the selection endpoints inside each line.
pub fn drawSelectionRects(text: []const u8, x: f32, y: f32, size_px: u16, max_width: f32, sel_start: usize, sel_end: usize) void {
    if (g_ft_face == null or sel_start >= sel_end) return;

    const face = activeFace(size_px);
    const natural_line_h: f32 = @as(f32, @floatFromInt(face.*.size.*.metrics.height)) / 64.0;
    const line_h: f32 = if (g_line_height_override > 0) g_line_height_override else natural_line_h;

    const Ctx = struct {
        text: []const u8,
        sel_start: usize,
        sel_end: usize,
        size_px: u16,
        line_h: f32,
        max_width: f32,
        pub fn onLine(self: @This(), byte_start: usize, byte_end: usize, lx: f32, ly: f32) void {
            const lo = @max(self.sel_start, byte_start);
            const hi = @min(self.sel_end, byte_end);
            if (lo >= hi) return;
            const x_off_lo = subLineAdvance(self.text[byte_start..lo], self.size_px);
            var x_off_hi = subLineAdvance(self.text[byte_start..hi], self.size_px);
            // Clip the highlight to the painter's visible width. walkLines
            // here doesn't char-wrap the way primitive/text.zig:wordWrap
            // does, so a long single word (e.g. a sample id like
            // "captured_mphd_blah") emits as one over-wide line; without
            // this clip, the selection rect extended past the container's
            // right edge while the painted glyphs were truncated by the
            // single-line text painter. Clamp to max_width so the rect
            // stops at the last visible letter.
            if (self.max_width > 0 and x_off_hi > self.max_width) {
                x_off_hi = self.max_width;
            }
            if (x_off_hi <= x_off_lo) return;
            const sel_r: f32 = 0.2;
            const sel_g: f32 = 0.4;
            const sel_b: f32 = 0.8;
            const sel_a: f32 = 0.4;
            rects.drawRect(lx + x_off_lo, ly, x_off_hi - x_off_lo, self.line_h, sel_r, sel_g, sel_b, sel_a, 0, 0, 0, 0, 0, 0);
        }
    };
    const ctx = Ctx{
        .text = text,
        .sel_start = sel_start,
        .sel_end = sel_end,
        .size_px = size_px,
        .line_h = line_h,
        .max_width = max_width,
    };
    _ = walkLines(text, x, y, size_px, max_width, 0, ctx);
}

/// Get the advance width of a character at a given font size.
pub fn getCharAdvance(codepoint: u32, size_px: u16) f32 {
    if (cacheGlyph(codepoint, size_px)) |glyph| {
        return glyph.advance;
    }
    return @floatFromInt(size_px / 2); // fallback
}

/// How far this glyph's ink extends past its advance, on the right.
/// For most chars this is 0 (glyph stays within its pen box). For chars
/// like 'r', italic letters, or certain accented forms, the rasterized
/// ink can stick out past `advance` — and any caller that sizes a box to
/// the sum-of-advances will paint the glyph kissing or crossing the
/// right edge. Layout adds this for the LAST glyph in a line so the
/// reported width matches the visible right edge of the painted text.
pub fn getCharRightOverhang(codepoint: u32, size_px: u16) f32 {
    if (cacheGlyph(codepoint, size_px)) |glyph| {
        const visible_right = @as(f32, @floatFromInt(glyph.bearing_x)) + @as(f32, @floatFromInt(glyph.width));
        const overhang = visible_right - glyph.advance;
        return if (overhang > 0) overhang else 0;
    }
    return 0;
}

/// Get the line height (ascent + descent) for a given font size.
pub fn getLineHeight(size_px: u16) f32 {
    if (g_ft_face == null) return @floatFromInt(size_px);
    const face = activeFace(size_px);
    // Use FreeType's metrics.height (ascent + descent + line gap) to match
    // TextEngine.lineMetrics(). The old formula (ascender - descender + 2.0)
    // diverged at certain zoom-scaled font sizes where the real line gap != 2px,
    // causing 1-2px descender clipping at specific canvas zoom levels.
    return @as(f32, @floatFromInt(face.*.size.*.metrics.height)) / 64.0;
}

/// Get the advance width of 'M' (monospace cell width) for a given font size.
pub fn getCharWidth(size_px: u16) f32 {
    if (g_ft_face == null) return @as(f32, @floatFromInt(size_px)) * 0.6;
    const face = activeFace(size_px);
    // Load 'M' glyph to get its advance width
    if (c.FT_Load_Char(face, 'M', c.FT_LOAD_DEFAULT) == 0) {
        return @as(f32, @floatFromInt(face.*.glyph.*.advance.x)) / 64.0;
    }
    return @as(f32, @floatFromInt(size_px)) * 0.6; // fallback
}

/// Draw a single glyph at exact pixel position (for terminal cell-grid rendering).
/// Unlike drawTextLine, this does NOT use FreeType advance — the caller controls positioning.
pub fn drawGlyphAt(char_buf: []const u8, x: f32, y: f32, size_px: u16, cr: f32, cg: f32, cb: f32, ca: f32) void {
    if (g_ft_face == null) return;
    if (char_buf.len == 0) return;

    // Honor the active canvas transform the same way drawTextLine does — without
    // this, Terminal cells inside a Canvas.Node render at untransformed graph
    // coordinates and appear off-screen / at the wrong scale.
    const transform = core.getTransform();
    const s = transform.scale;
    const has_transform = transform.active;
    const render_size: u16 = if (has_transform)
        @intFromFloat(@max(4, @min(200, @round(@as(f32, @floatFromInt(size_px)) * s))))
    else
        size_px;

    const face = activeFace(render_size);
    const ascent: f32 = @as(f32, @floatFromInt(face.*.size.*.metrics.ascender)) / 64.0;
    const ch = decodeUtf8(char_buf);

    const pen_x: f32 = if (has_transform) @round((x - transform.ox) * s + transform.ox + transform.tx) else x;
    const pen_y: f32 = if (has_transform) @round((y - transform.oy) * s + transform.oy + transform.ty) else y;

    if (cacheGlyph(ch.codepoint, render_size)) |glyph| {
        if (glyph.width > 0 and glyph.height > 0 and g_glyph_count < MAX_GLYPHS) {
            g_glyphs[g_glyph_count] = .{
                .pos_x = pen_x + @as(f32, @floatFromInt(glyph.bearing_x)),
                .pos_y = pen_y + ascent - @as(f32, @floatFromInt(glyph.bearing_y)),
                .size = .{
                    pack.f16FromF32(@floatFromInt(glyph.width)),
                    pack.f16FromF32(@floatFromInt(glyph.height)),
                },
                .uv = .{ pack.unorm16(glyph.uv_x), pack.unorm16(glyph.uv_y), pack.unorm16(glyph.uv_w), pack.unorm16(glyph.uv_h) },
                .color = pack.rgba8(cr, cg, cb, ca),
            };
            g_glyph_count += 1;
        }
    }
}

/// Draw a batch of glyphs in the given instance range.
pub fn drawBatch(render_pass: *wgpu.RenderPassEncoder, start: u32, end: u32) void {
    if (end <= start) return;
    if (g_text_pipeline) |pipeline| {
        render_pass.setPipeline(pipeline);
        if (g_text_bind_group) |bg| render_pass.setBindGroup(0, bg, 0, null);
        if (g_text_buffer) |buf| {
            render_pass.setVertexBuffer(0, buf, 0, bu.bytesOfCount(GlyphInstance, g_glyph_count));
        }
        render_pass.draw(6, end - start, 0, start);
    }
}

/// Upload glyph instance data to the GPU.
pub fn upload(queue: *wgpu.Queue) void {
    if (g_glyph_count > 0) {
        if (g_text_buffer) |buf| {
            bu.writeTypedBuffer(queue, buf, 0, GlyphInstance, g_glyphs[0..g_glyph_count]);
        }
    }
}

/// Recreate buffer + bind group to reclaim fragmented GPU memory.
pub fn drain(device: *wgpu.Device, globals_buffer: *wgpu.Buffer) void {
    if (g_text_bind_group) |bg| bg.release();
    if (g_text_buffer) |b| b.release();

    g_text_buffer = device.createBuffer(&.{
        .label = wgpu.StringView.fromSlice("glyph_instances"),
        .size = MAX_GLYPHS * @sizeOf(GlyphInstance),
        .usage = wgpu.BufferUsages.vertex | wgpu.BufferUsages.copy_dst,
        .mapped_at_creation = 0,
    });

    if (g_text_bind_group_layout) |layout| {
        const bind_entries = [_]wgpu.BindGroupEntry{
            .{ .binding = 0, .buffer = globals_buffer, .offset = 0, .size = 8 },
            .{ .binding = 1, .texture_view = g_atlas_view },
            .{ .binding = 2, .sampler = g_atlas_sampler },
        };
        g_text_bind_group = device.createBindGroup(&.{
            .layout = layout,
            .entry_count = bind_entries.len,
            .entries = &bind_entries,
        });
    }
}

/// Release all GPU resources.
pub fn deinit() void {
    if (g_text_bind_group) |bg| bg.release();
    if (g_text_bind_group_layout) |l| l.release();
    if (g_text_buffer) |b| b.release();
    if (g_text_pipeline) |p| p.release();
    if (g_atlas_sampler) |s| s.release();
    if (g_atlas_view) |v| v.release();
    if (g_atlas_texture) |t| t.destroy();
    g_atlas_index.deinit();
    g_text_bind_group = null;
    g_text_bind_group_layout = null;
    g_text_buffer = null;
    g_text_pipeline = null;
    g_atlas_sampler = null;
    g_atlas_view = null;
    g_atlas_texture = null;
}

/// Current number of queued glyphs.
pub fn count() usize {
    return g_glyph_count;
}

/// Last frame's glyph count (captured before reset).
pub fn lastCount() usize {
    return g_last_glyph_count;
}

/// Number of glyph atlas cache misses in the last completed frame.
pub fn lastAtlasMissCount() usize {
    return g_last_atlas_miss_count;
}

/// Reset for next frame.
pub fn reset() void {
    g_last_glyph_count = g_glyph_count;
    g_last_atlas_miss_count = g_atlas_miss_count;
    var stream = std.io.fixedBufferStream(&g_last_text_trace_summary);
    var writer = stream.writer();
    var wrote_any = false;
    for (g_text_trace[0..g_text_trace_count]) |line| {
        if (wrote_any) writer.writeAll(" | ") catch break;
        if (line.render_size_px != line.size_px) {
            writer.print("sz={d} render={d} font={d} n={d} bytes={d} text=\"{s}\"", .{
                line.size_px,
                line.render_size_px,
                line.font_id,
                line.count,
                line.text_len,
                line.sample[0..line.sample_len],
            }) catch break;
        } else {
            writer.print("sz={d} font={d} n={d} bytes={d} text=\"{s}\"", .{
                line.size_px,
                line.font_id,
                line.count,
                line.text_len,
                line.sample[0..line.sample_len],
            }) catch break;
        }
        wrote_any = true;
    }
    g_last_text_trace_summary_len = stream.pos;
    g_glyph_count = 0;
    g_atlas_miss_count = 0;
    g_text_trace_count = 0;
}

pub fn lastTraceSummary() []const u8 {
    return g_last_text_trace_summary[0..g_last_text_trace_summary_len];
}

/// Hash the current glyph instance data for dirty checking.
pub fn hashData() u64 {
    var h: u64 = @as(u64, g_glyph_count) *% 0x517cc1b727220a95;
    if (g_glyph_count > 0) {
        const len = g_glyph_count * @sizeOf(GlyphInstance);
        const bytes: [*]const u8 = @ptrCast(&g_glyphs);
        var i: usize = 0;
        while (i + 8 <= len) : (i += 8) {
            h ^= std.mem.readInt(u64, bytes[i..][0..8], .little);
            h = h *% 0x2127599bf4325c37 +% 0x880355f21e6d1965;
        }
    }
    return h;
}

/// Atlas stats for telemetry/diagnostics.
pub fn atlasCount() usize {
    return g_atlas_count;
}

pub fn atlasCapacity() usize {
    return MAX_ATLAS_GLYPHS;
}

pub fn atlasRowY() u32 {
    return g_atlas_row_y;
}

pub fn atlasSize() u32 {
    return ATLAS_SIZE;
}

// ════════════════════════════════════════════════════════════════════════
// Text pipeline setup
// ════════════════════════════════════════════════════════════════════════

fn initPipeline(device: *wgpu.Device) void {
    const shader_desc = wgpu.shaderModuleWGSLDescriptor(.{
        .label = "text_shader",
        .code = shaders.text_wgsl,
    });
    const shader_module = device.createShaderModule(&shader_desc) orelse {
        log.print("Failed to create text shader module\n", .{});
        return;
    };
    defer shader_module.release();

    const atlas_view = g_atlas_view orelse return;
    const atlas_sampler = g_atlas_sampler orelse return;

    // Bind group layout: globals uniform + atlas texture + sampler
    const layout_entries = [_]wgpu.BindGroupLayoutEntry{
        .{ // binding 0: globals uniform
            .binding = 0,
            .visibility = wgpu.ShaderStages.vertex,
            .buffer = .{ .type = .uniform, .has_dynamic_offset = 0, .min_binding_size = 8 },
        },
        .{ // binding 1: atlas texture
            .binding = 1,
            .visibility = wgpu.ShaderStages.fragment,
            .texture = .{
                .sample_type = .float,
                .view_dimension = .@"2d",
                .multisampled = 0,
            },
        },
        .{ // binding 2: sampler
            .binding = 2,
            .visibility = wgpu.ShaderStages.fragment,
            .sampler = .{ .type = .filtering },
        },
    };

    const bind_group_layout = device.createBindGroupLayout(&.{
        .entry_count = layout_entries.len,
        .entries = &layout_entries,
    }) orelse return;
    g_text_bind_group_layout = bind_group_layout;

    // Bind group with actual resources
    const globals_buffer = core.getGlobalsBuffer() orelse return;
    const bind_entries = [_]wgpu.BindGroupEntry{
        .{ .binding = 0, .buffer = globals_buffer, .offset = 0, .size = 8 },
        .{ .binding = 1, .texture_view = atlas_view },
        .{ .binding = 2, .sampler = atlas_sampler },
    };

    g_text_bind_group = device.createBindGroup(&.{
        .layout = bind_group_layout,
        .entry_count = bind_entries.len,
        .entries = &bind_entries,
    });

    const pipeline_layout = device.createPipelineLayout(&.{
        .bind_group_layout_count = 1,
        .bind_group_layouts = @ptrCast(&bind_group_layout),
    }) orelse return;
    defer pipeline_layout.release();

    // Glyph instance vertex attributes over the 48-byte row (see GlyphInstance)
    const glyph_attrs = [_]wgpu.VertexAttribute{
        .{ .format = .float32x2, .offset = 0, .shader_location = 0 }, // pos
        .{ .format = .float16x2, .offset = 8, .shader_location = 1 }, // size
        .{ .format = .unorm16x2, .offset = 12, .shader_location = 2 }, // uv_pos
        .{ .format = .unorm16x2, .offset = 16, .shader_location = 3 }, // uv_size
        .{ .format = .unorm8x4, .offset = 20, .shader_location = 4 }, // color
        .{ .format = .float32x4, .offset = 24, .shader_location = 5 }, // m_abcd (linear part)
        .{ .format = .float32x2, .offset = 40, .shader_location = 6 }, // m_txy (translation)
    };

    const glyph_buffer_layout = wgpu.VertexBufferLayout{
        .step_mode = .instance,
        .array_stride = @sizeOf(GlyphInstance),
        .attribute_count = glyph_attrs.len,
        .attributes = &glyph_attrs,
    };

    const blend_state = wgpu.BlendState.premultiplied_alpha_blending;
    const color_target = wgpu.ColorTargetState{
        .format = core.getFormat(),
        .blend = &blend_state,
        .write_mask = wgpu.ColorWriteMasks.all,
    };

    const fragment_state = wgpu.FragmentState{
        .module = shader_module,
        .entry_point = wgpu.StringView.fromSlice("fs_main"),
        .target_count = 1,
        .targets = @ptrCast(&color_target),
    };

    g_text_pipeline = device.createRenderPipeline(&.{
        .layout = pipeline_layout,
        .vertex = .{
            .module = shader_module,
            .entry_point = wgpu.StringView.fromSlice("vs_main"),
            .buffer_count = 1,
            .buffers = @ptrCast(&glyph_buffer_layout),
        },
        .primitive = .{ .topology = .triangle_list },
        .multisample = .{},
        .fragment = &fragment_state,
    });

    if (g_text_pipeline == null) {
        log.print("Failed to create text render pipeline\n", .{});
    }
}

// ════════════════════════════════════════════════════════════════════════
// Glyph atlas — FreeType rasterization -> wgpu texture
// ════════════════════════════════════════════════════════════════════════

fn cacheGlyph(codepoint: u32, size_px: u16) ?*const AtlasGlyphInfo {
    if (g_ft_face == null) return null;

    // activeFace() picks regular or bold based on g_use_bold and ensures
    // FT_Set_Pixel_Sizes is current. The atlas key includes font_id so
    // bold and regular variants of the same codepoint coexist in the cache.
    const face = activeFace(size_px);
    const font_id = activeFontId();

    // Pack codepoint(21b) + size_px(16b) + font_id(8b) into the hash key.
    const packed_key: u64 = (@as(u64, codepoint) << 24) | (@as(u64, size_px) << 8) | @as(u64, font_id);
    // Check cache
    if (g_atlas_index.get(packed_key)) |idx| {
        return &g_atlas_vals[idx];
    }
    for (0..g_atlas_count) |i| {
        if (g_atlas_keys[i].codepoint == codepoint and
            g_atlas_keys[i].size_px == size_px and
            g_atlas_keys[i].font_id == font_id)
        {
            const found_idx: u32 = @intCast(i);
            g_atlas_index.put(packed_key, found_idx) catch {};
            return &g_atlas_vals[i];
        }
    }
    if (g_atlas_count >= MAX_ATLAS_GLYPHS) return null;
    g_atlas_miss_count += 1;

    // DIAG: reaching here is a cache MISS — about to FreeType-rasterize a
    // (codepoint, size_px, font) never seen before. After warmup this should be
    // ~0 per frame; a steady stream means some text is re-rendering at changing
    // sizes, which is the CPU paint spike. Logs the char + size to find it.
    if (std.posix.getenv("HMSC_GLYPH_TRACE") != null) {
        std.debug.print("[glyph-raster] cp={d} '{c}' size={d} font={d} atlas_total={d}\n", .{
            codepoint,
            if (codepoint >= 32 and codepoint < 127) @as(u8, @intCast(codepoint)) else @as(u8, '?'),
            size_px,
            font_id,
            g_atlas_count,
        });
    }

    // Load glyph — try primary face, then fallbacks. Fallback faces are
    // shared regular-only (CJK/emoji/symbols rarely have weighted variants);
    // a missing glyph in the bold face still routes through them.
    var use_face = face;
    if (c.FT_Get_Char_Index(face, codepoint) == 0) {
        for (0..g_ft_fallback_count) |fi| {
            const fb = g_ft_fallbacks[fi];
            if (c.FT_Get_Char_Index(fb, codepoint) != 0) {
                _ = c.FT_Set_Pixel_Sizes(fb, 0, size_px);
                use_face = fb;
                break;
            }
        }
    }

    if (c.FT_Load_Char(use_face, codepoint, c.FT_LOAD_RENDER) != 0) {
        return null;
    }

    const glyph = use_face.*.glyph;
    const bitmap = glyph.*.bitmap;
    const bw: u32 = @intCast(bitmap.width);
    const bh: u32 = @intCast(bitmap.rows);

    // Pack into atlas (row-based)
    var atlas_x: u32 = 0;
    var atlas_y: u32 = 0;

    if (bw > 0 and bh > 0) {
        // Check if glyph fits in current row
        if (g_atlas_row_x + bw + 1 > ATLAS_SIZE) {
            // Start new row
            g_atlas_row_y += g_atlas_row_h + 1;
            g_atlas_row_x = 0;
            g_atlas_row_h = 0;
        }
        if (g_atlas_row_y + bh > ATLAS_SIZE) {
            // Atlas full
            return null;
        }

        atlas_x = g_atlas_row_x;
        atlas_y = g_atlas_row_y;
        g_atlas_row_x += bw + 1;
        if (bh > g_atlas_row_h) g_atlas_row_h = bh;

        // Upload glyph bitmap to atlas texture
        uploadGlyphToAtlas(bitmap, atlas_x, atlas_y, bw, bh);
    }

    const idx = g_atlas_count;
    g_atlas_keys[idx] = .{ .codepoint = codepoint, .size_px = size_px, .font_id = font_id };
    g_atlas_vals[idx] = .{
        .uv_x = @as(f32, @floatFromInt(atlas_x)) / @as(f32, ATLAS_SIZE),
        .uv_y = @as(f32, @floatFromInt(atlas_y)) / @as(f32, ATLAS_SIZE),
        .uv_w = @as(f32, @floatFromInt(bw)) / @as(f32, ATLAS_SIZE),
        .uv_h = @as(f32, @floatFromInt(bh)) / @as(f32, ATLAS_SIZE),
        .bearing_x = glyph.*.bitmap_left,
        .bearing_y = glyph.*.bitmap_top,
        // Sub-pixel advance: FreeType stores .advance.x in 26.6 fixed-point.
        // Truncating via `>> 6` threw away up to ~1px per glyph, which fed
        // measureLineWidth / wordWrap under-reported widths — paint then
        // rendered slightly wider than measurement expected, tripping strict
        // `word_width > max_width` wraps at the column edge.
        .advance = @as(f32, @floatFromInt(glyph.*.advance.x)) / 64.0,
        .width = @intCast(bw),
        .height = @intCast(bh),
    };
    g_atlas_count += 1;
    g_atlas_index.put(packed_key, @intCast(idx)) catch {};

    return &g_atlas_vals[idx];
}

fn uploadGlyphToAtlas(bitmap: anytype, atlas_x: u32, atlas_y: u32, bw: u32, bh: u32) void {
    const queue = core.getQueue() orelse return;
    const atlas = g_atlas_texture orelse return;

    // Convert grayscale bitmap to RGBA
    const pixel_count = bw * bh;
    if (pixel_count == 0) return;

    // Stack buffer for small glyphs, otherwise skip (most glyphs are small)
    var rgba_buf: [256 * 256 * 4]u8 = undefined;
    if (pixel_count * 4 > rgba_buf.len) return;

    const src_pitch: usize = @intCast(bitmap.pitch);
    for (0..bh) |row| {
        for (0..bw) |col| {
            const alpha = bitmap.buffer[row * src_pitch + col];
            const dst = (row * bw + col) * 4;
            rgba_buf[dst + 0] = 255; // R
            rgba_buf[dst + 1] = 255; // G
            rgba_buf[dst + 2] = 255; // B
            rgba_buf[dst + 3] = alpha; // A
        }
    }

    // Upload to atlas via queue.writeTexture
    queue.writeTexture(
        &.{
            .texture = atlas,
            .mip_level = 0,
            .origin = .{ .x = atlas_x, .y = atlas_y, .z = 0 },
            .aspect = .all,
        },
        @ptrCast(&rgba_buf),
        bw * bh * 4,
        &.{
            .offset = 0,
            .bytes_per_row = bw * 4,
            .rows_per_image = bh,
        },
        &.{ .width = bw, .height = bh, .depth_or_array_layers = 1 },
    );
}

// ════════════════════════════════════════════════════════════════════════
// UTF-8 decoding
// ════════════════════════════════════════════════════════════════════════

const Utf8Char = struct {
    codepoint: u32,
    len: u3,
};

fn decodeUtf8(bytes: []const u8) Utf8Char {
    if (bytes.len == 0) return .{ .codepoint = 0xFFFD, .len = 1 };
    const b0 = bytes[0];
    if (b0 < 0x80) return .{ .codepoint = b0, .len = 1 };
    if (b0 < 0xC0) return .{ .codepoint = 0xFFFD, .len = 1 };
    if (b0 < 0xE0) {
        if (bytes.len < 2) return .{ .codepoint = 0xFFFD, .len = 1 };
        return .{ .codepoint = (@as(u32, b0 & 0x1F) << 6) | @as(u32, bytes[1] & 0x3F), .len = 2 };
    }
    if (b0 < 0xF0) {
        if (bytes.len < 3) return .{ .codepoint = 0xFFFD, .len = 1 };
        return .{ .codepoint = (@as(u32, b0 & 0x0F) << 12) | (@as(u32, bytes[1] & 0x3F) << 6) | @as(u32, bytes[2] & 0x3F), .len = 3 };
    }
    if (bytes.len < 4) return .{ .codepoint = 0xFFFD, .len = 1 };
    return .{ .codepoint = (@as(u32, b0 & 0x07) << 18) | (@as(u32, bytes[1] & 0x3F) << 12) | (@as(u32, bytes[2] & 0x3F) << 6) | @as(u32, bytes[3] & 0x3F), .len = 4 };
}
