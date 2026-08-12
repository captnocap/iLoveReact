//! ──── GENERATED-LINEAGE FILE — NOT FULLY REGENERATED ────
//!
//! Original generated-era source:
//!   archive/tsz-gen/runtime/tsz/layout.mod.tsz
//!
//! Current authored intent source:
//!   tsz/framework/layout.mod.tsz
//!
//! This Zig file still contains the generated-era body plus later handwritten
//! updates. It does not round-trip from the current intent source yet.

const std = @import("std");
const easing_mod = @import("math/easing.zig");
const math = @import("math/root.zig");

// Map layout's JustifyContent (no .stretch) onto math.Distribute.
fn justifyToDistribute(j: JustifyContent) math.Distribute {
    return switch (j) {
        .start => .start,
        .center => .center,
        .end => .end,
        .space_between => .space_between,
        .space_around => .space_around,
        .space_evenly => .space_evenly,
    };
}

inline fn asF32(val: anytype) f32 {
    return switch (@typeInfo(@TypeOf(val))) {
        .int, .comptime_int => @floatFromInt(val),
        .comptime_float => val,
        .float => if (@TypeOf(val) == f32) val else @floatCast(val),
        .optional => blk: {
            const v = val orelse 0;
            break :blk switch (@typeInfo(@TypeOf(v))) {
                .int, .comptime_int => @as(f32, @floatFromInt(v)),
                .comptime_float => @as(f32, v),
                .float => if (@TypeOf(v) == f32) v else @floatCast(v),
                else => @compileError("asF32: unsupported optional inner type"),
            };
        },
        else => @compileError("asF32: unsupported type"),
    };
}

// ── Imports ────────────────────────────────────────
const log = @import("diag/log.zig");
const events = @import("events.zig");
const EventHandler = events.EventHandler;
const effect_ctx = @import("gpu/effects_ctx.zig");
const effect_shader = @import("gpu/effect_shader.zig");
const context_menu = @import("primitive/context_menu.zig");

// ── Type definitions ────────────────────────────────
/// One contiguous row range of a STATIC instance batch plus its world
/// bounding sphere — the frustum-cullable unit of scene3d_instance_segments
/// (req_2859). `first`/`count` index rows of the node's uploaded batch.
pub const InstanceSegment = extern struct {
    first: u32,
    count: u32,
    cx: f32,
    cy: f32,
    cz: f32,
    radius: f32,
};

pub const FlexDirection = enum { row, column, row_reverse, column_reverse };
pub const JustifyContent = enum { start, center, end, space_between, space_around, space_evenly };
pub const AlignItems = enum { start, center, end, stretch, baseline };
pub const AlignSelf = enum { auto, start, center, end, stretch, baseline };
pub const AlignContent = enum { start, center, end, stretch, space_between, space_around, space_evenly };
pub const FlexWrap = enum { no_wrap, wrap, wrap_reverse };
pub const Position = enum { relative, absolute };
pub const Display = enum { flex, none };
pub const ScrollbarSide = enum(u8) { auto, left, right, top, bottom };
pub const Overflow = enum { visible, hidden, scroll, auto };
pub const TextAlign = enum { left, center, right, justify };
pub const CodeLanguage = enum { none, zig, type_script, json, bash, markdown, plain };
pub const GradientDirection = enum { none, vertical, horizontal };
pub const DevtoolsViz = enum { none, sparkline, wireframe, node_tree, inspector_overlay };
pub const Color = struct {
    r: u8 = 0,
    g: u8 = 0,
    b: u8 = 0,
    a: u8 = 0,

    pub fn rgb(r: u8, g: u8, b: u8) Color {
        return .{ .r = r, .g = g, .b = b, .a = 255 };
    }
    pub fn rgba(r: u8, g: u8, b: u8, a: u8) Color {
        return .{ .r = r, .g = g, .b = b, .a = a };
    }

    /// Parse a "#RRGGBB" hex string at runtime. Returns transparent black on bad input.
    pub fn fromHex(hex: []const u8) Color {
        if (hex.len < 7 or hex[0] != '#') return .{};
        return .{
            .r = parseHexByte(hex[1], hex[2]),
            .g = parseHexByte(hex[3], hex[4]),
            .b = parseHexByte(hex[5], hex[6]),
            .a = 255,
        };
    }

    fn parseHexByte(hi: u8, lo: u8) u8 {
        return (@as(u8, hexNibble(hi)) << 4) | @as(u8, hexNibble(lo));
    }

    fn hexNibble(c: u8) u4 {
        if (c >= '0' and c <= '9') return @intCast(c - '0');
        if (c >= 'a' and c <= 'f') return @intCast(c - 'a' + 10);
        if (c >= 'A' and c <= 'F') return @intCast(c - 'A' + 10);
        return 0;
    }
};
/// Linear gradient stop — a color at a normalized offset along the gradient line.
pub const GradientStop = struct {
    offset: f32 = 0, // 0.0..1.0
    color: Color = .{},
};

/// Linear gradient spec — two endpoints in the path's coordinate space plus a
/// list of color stops. Stored on the node style via `canvas_fill_gradient`.
/// Slice lifetime matches other `?[]const u8` style fields (c_allocator duped
/// at CREATE/UPDATE time, leaked on replace — same pattern as canvas_path_d).
pub const LinearGradient = struct {
    x1: f32 = 0,
    y1: f32 = 0,
    x2: f32 = 0,
    y2: f32 = 0,
    stops: []const GradientStop = &.{},
};

pub const TextMetrics = struct {
    width: f32 = 0,
    height: f32 = 0,
    ascent: f32 = 0,
};

/// Descriptor for an inline glyph (polygon/3D embedded in text).
pub const InlineGlyph = struct {
    d: []const u8, // SVG path data
    fill: Color = Color.rgb(255, 255, 255),
    fill_effect: ?[]const u8 = null, // named effect for textured fill
    stroke: Color = Color.rgba(0, 0, 0, 0),
    stroke_width: f32 = 0,
    scale: f32 = 1.0, // multiplier on fontSize
};

/// Computed position for an inline glyph slot within rendered text.
pub const InlineSlot = struct {
    x: f32 = 0,
    y: f32 = 0,
    size: f32 = 0, // slot width/height (square)
    glyph_index: u8 = 0,
};

pub const ColorTextSpan = struct {
    text: []const u8 = "",
    color: Color = Color.rgb(255, 255, 255),
};

pub const ColorTextRow = struct {
    spans: []const ColorTextSpan = &.{},
};

pub const MAX_INLINE_SLOTS = 8;
pub const ImageDims = struct {
    width: f32 = 0,
    height: f32 = 0,
};
pub const LayoutRect = struct {
    x: f32 = 0,
    y: f32 = 0,
    w: f32 = 0,
    h: f32 = 0,
};
pub const Style = struct {
    width: ?f32 = null,
    height: ?f32 = null,
    min_width: ?f32 = null,
    max_width: ?f32 = null,
    min_height: ?f32 = null,
    max_height: ?f32 = null,
    flex_direction: FlexDirection = .column,
    flex_grow: f32 = 0,
    flex_shrink: ?f32 = null,
    flex_basis: ?f32 = null,
    flex_wrap: FlexWrap = .no_wrap,
    justify_content: JustifyContent = .start,
    align_items: AlignItems = .stretch,
    align_content: AlignContent = .stretch,
    align_self: AlignSelf = .auto,
    gap: f32 = 0,
    row_gap: ?f32 = null,
    column_gap: ?f32 = null,
    order: i32 = 0,
    position: Position = .relative,
    top: ?f32 = null,
    left: ?f32 = null,
    right: ?f32 = null,
    bottom: ?f32 = null,
    aspect_ratio: ?f32 = null,
    padding: f32 = 0,
    padding_left: ?f32 = null,
    padding_right: ?f32 = null,
    padding_top: ?f32 = null,
    padding_bottom: ?f32 = null,
    margin: f32 = 0,
    margin_left: ?f32 = null,
    margin_right: ?f32 = null,
    margin_top: ?f32 = null,
    margin_bottom: ?f32 = null,
    display: Display = .flex,
    overflow: Overflow = .visible,
    text_align: TextAlign = .left,
    background_color: ?Color = null,
    border_radius: f32 = 0,
    border_top_left_radius: ?f32 = null,
    border_top_right_radius: ?f32 = null,
    border_bottom_right_radius: ?f32 = null,
    border_bottom_left_radius: ?f32 = null,
    opacity: f32 = 1.0,
    rotation: f32 = 0,
    scale_x: f32 = 1.0,
    scale_y: f32 = 1.0,
    // CSS transform — origin defaults to center (0.5, 0.5). Translate is post-rotation.
    origin_x: f32 = 0.5,
    origin_y: f32 = 0.5,
    translate_x: f32 = 0,
    translate_y: f32 = 0,
    border_width: f32 = 0,
    border_top_width: ?f32 = null,
    border_right_width: ?f32 = null,
    border_bottom_width: ?f32 = null,
    border_left_width: ?f32 = null,
    border_color: ?Color = null,
    // Animated / dashed border. Any non-default value here switches the
    // border paint from the rect-shader's baked edge to an SDF-stroked
    // rounded-rectangle perimeter (see framework/border_dash.zig).
    //   border_dash_on  — dash length in px (0 = solid).
    //   border_dash_off — gap length in px (0 = no gaps; flow_speed still animates).
    //   border_flow_speed — marching speed in px/second (positive = CW).
    border_dash_on: f32 = 0,
    border_dash_off: f32 = 0,
    border_flow_speed: f32 = 0,
    // Width of the animated dashed stroke. 0 = fall back to border_width,
    // then to 1.5 px. Lets a cart suppress the baked border (border_width=0)
    // while still drawing thick animated dashes at an explicit width.
    border_dash_width: f32 = 0,
    // Inline-paint tween (mirrors border_dash.zig's wire model: animation
    // params live on the Box, the engine evaluates them per frame using
    // SDL_GetTicks. No registry, no latches, no per-frame JS work). The
    // eased value is added to translate_x/y in the painter just before the
    // existing transform compose at engine.zig:1683.
    //
    //   tween_translate_*_from / _to    — endpoint values in px.
    //   tween_translate_*_dur_ms        — cycle length. 0 = inactive.
    //   tween_translate_*_curve         — animations.CurveType byte
    //                                     (0..36; see framework/animations.zig).
    tween_translate_x_from: f32 = 0,
    tween_translate_x_to: f32 = 0,
    tween_translate_x_dur_ms: f32 = 0,
    tween_translate_x_curve: u8 = 0,
    tween_translate_y_from: f32 = 0,
    tween_translate_y_to: f32 = 0,
    tween_translate_y_dur_ms: f32 = 0,
    tween_translate_y_curve: u8 = 0,
    z_index: i16 = 0,
    gradient_color_end: ?Color = null,
    gradient_direction: GradientDirection = .none,
    shadow_offset_x: f32 = 0,
    shadow_offset_y: f32 = 0,
    shadow_blur: f32 = 0,
    shadow_color: ?Color = null,
    shadow_method: u8 = 0, // 0 = sdf (default), 1 = rect (multi-rect)

    pub fn padLeft(self: Style) f32 {
        return self.padding_left orelse self.padding;
    }
    pub fn padRight(self: Style) f32 {
        return self.padding_right orelse self.padding;
    }
    pub fn padTop(self: Style) f32 {
        return self.padding_top orelse self.padding;
    }
    pub fn padBottom(self: Style) f32 {
        return self.padding_bottom orelse self.padding;
    }
    pub fn brdTop(self: Style) f32 {
        return self.border_top_width orelse self.border_width;
    }
    pub fn brdRight(self: Style) f32 {
        return self.border_right_width orelse self.border_width;
    }
    pub fn brdBottom(self: Style) f32 {
        return self.border_bottom_width orelse self.border_width;
    }
    pub fn brdLeft(self: Style) f32 {
        return self.border_left_width orelse self.border_width;
    }
    pub fn marLeft(self: Style) f32 {
        const v = self.margin_left orelse self.margin;
        return if (std.math.isInf(v)) 0 else v;
    }
    pub fn marRight(self: Style) f32 {
        const v = self.margin_right orelse self.margin;
        return if (std.math.isInf(v)) 0 else v;
    }
    pub fn marTop(self: Style) f32 {
        const v = self.margin_top orelse self.margin;
        return if (std.math.isInf(v)) 0 else v;
    }
    pub fn marBottom(self: Style) f32 {
        const v = self.margin_bottom orelse self.margin;
        return if (std.math.isInf(v)) 0 else v;
    }
    pub fn isMarginAutoLeft(self: Style) bool {
        return if (self.margin_left) |v| std.math.isInf(v) else false;
    }
    pub fn isMarginAutoRight(self: Style) bool {
        return if (self.margin_right) |v| std.math.isInf(v) else false;
    }
    pub fn isMarginAutoTop(self: Style) bool {
        return if (self.margin_top) |v| std.math.isInf(v) else false;
    }
    pub fn isMarginAutoBottom(self: Style) bool {
        return if (self.margin_bottom) |v| std.math.isInf(v) else false;
    }
    pub fn radiusTL(self: Style) f32 {
        return self.border_top_left_radius orelse self.border_radius;
    }
    pub fn radiusTR(self: Style) f32 {
        return self.border_top_right_radius orelse self.border_radius;
    }
    pub fn radiusBR(self: Style) f32 {
        return self.border_bottom_right_radius orelse self.border_radius;
    }
    pub fn radiusBL(self: Style) f32 {
        return self.border_bottom_left_radius orelse self.border_radius;
    }
    pub fn mainGap(self: Style) f32 {
        const isRow = self.flex_direction == .row or self.flex_direction == .row_reverse;
        return if (isRow) (self.column_gap orelse self.gap) else (self.row_gap orelse self.gap);
    }
    pub fn crossGap(self: Style) f32 {
        const isRow = self.flex_direction == .row or self.flex_direction == .row_reverse;
        return if (isRow) (self.row_gap orelse self.gap) else (self.column_gap orelse self.gap);
    }
};
pub const Node = struct {
    /// React reconciler instance id. Set by `luajit_runtime.hostCreate` from
    /// the JS side. 0 = not assigned (synthetic / framework-built nodes).
    /// Used by `setRect` to fire onLayout events back to JS keyed by id.
    id: u32 = 0,
    /// JS handed us an `onLayout` handler — fire a layout event whenever
    /// `setRect` runs on this node. Wired through `g_emit_layout`.
    has_on_layout: bool = false,
    style: Style = .{},
    children: []Node = &.{},
    computed: LayoutRect = .{},
    text: ?[]const u8 = null,
    font_size: u16 = 16,
    /// Small runtime font-family id. 0 = default face. The JS host maps
    /// common CSS family names to these ids; the GPU text atlas selects the
    /// matching FreeType face during measure and paint.
    font_family_id: u8 = 0,
    /// CSS font-weight (100..900). 400 = regular, 700 = bold. Anything ≥600
    /// renders with the bold face when one is loaded; otherwise regular.
    font_weight: u16 = 400,
    text_color: ?Color = null,
    letter_spacing: f32 = 0,
    line_height: f32 = 0,
    number_of_lines: u16 = 0,
    no_wrap: bool = false,
    code_language: CodeLanguage = .none,
    image_src: ?[]const u8 = null,
    video_src: ?[]const u8 = null,
    render_src: ?[]const u8 = null,
    world_loader: bool = false,
    world_loader_game_file: ?[]const u8 = null,
    world_loader_store_dir: ?[]const u8 = null,
    /// When true, the framework SIGSTOPs the feed's subprocesses (qemu /
    /// Xvfb / app inside Xvfb) so they consume zero CPU. Last-rendered
    /// pixels remain on the texture so the surface still paints. Toggling
    /// back to false SIGCONTs them — VM/terminal resumes from where it left
    /// off, no boot wait. Use for putting build/test sandbox VMs in the
    /// background.
    render_suspended: bool = false,
    /// Latch bindings for layout-affecting style props. When set, the
    /// pre-frame syncLatchesToNodes pass resolves the value from
    /// `framework/latches.zig` and writes it into the corresponding
    /// `style.*` field before layout runs. Lets cart code animate any
    /// of these per-frame via `__latchSet(key, value)` without going
    /// through React reconciliation. See latches.zig and the
    /// `latch:KEY` style-prop token resolver in v8_app.zig:applyStyle.
    latch_height_key: ?[]const u8 = null,
    latch_width_key: ?[]const u8 = null,
    latch_left_key: ?[]const u8 = null,
    latch_top_key: ?[]const u8 = null,
    latch_right_key: ?[]const u8 = null,
    latch_bottom_key: ?[]const u8 = null,

    static_surface: bool = false,
    static_surface_key: ?[]const u8 = null,
    static_surface_scale: f32 = 1,
    static_surface_warmup_frames: u16 = 0,
    static_surface_intro_frames: u16 = 0,
    static_surface_overlay: bool = false,
    /// Last frame any descendant of this node (or this node itself) was
    /// mutated by the React reconciler. The host stamps this on every
    /// CREATE / UPDATE / APPEND / INSERT_BEFORE / REMOVE op and walks the
    /// parent chain stamping ancestors.
    ///
    /// `<StaticSurface>` reads this in the paint loop: if its captured
    /// texture was taken before this frame, the cache is stale and the
    /// surface re-captures. Lets stable keys auto-invalidate without
    /// folding state into the cache key.
    subtree_last_mutated_frame: u64 = 0,
    // Post-process shader filter — when set, the subtree is rendered into
    // an offscreen texture every frame and composited via the named
    // filter's fragment shader. See framework/gpu/filters.zig for the
    // available filters. The cache is intentionally disabled, so children
    // animate normally inside.
    filter_name: ?[]const u8 = null,
    filter_intensity: f32 = 1.0,
    effect_type: ?[]const u8 = null,
    // Paintable — owns a persistent GPU R8Unorm mask texture keyed by
    // `paintable_id`. Renders nothing visible itself; consumed by other
    // Effects via the `textures` prop. See framework/gpu/paintable.zig.
    // The Node is registered with paintable.ensure() after CREATE props
    // are applied, and unregistered via the host_tree before_destroy
    // hook so the texture survives exactly as long as the React subtree.
    paintable_id: ?[]const u8 = null,
    paintable_w: u32 = 0,
    paintable_h: u32 = 0,
    /// false = R8Unorm mask (default); true = RGBA8Unorm colour (the Studio
    /// model painter). Selects the texture format in paintable.ensure().
    paintable_rgba: bool = false,
    is_paintable: bool = false,
    input_id: ?u8 = null,
    input_paint_text: bool = true,
    input_color_rows: ?[]const ColorTextRow = null,
    placeholder: ?[]const u8 = null,
    debug_name: ?[]const u8 = null,
    test_id: ?[]const u8 = null,
    tooltip: ?[]const u8 = null,
    href: ?[]const u8 = null,
    hoverable: bool = false,
    /// Visual-only surfaces can opt into pointer hit-testing so modal scrims
    /// and overlays consume clicks without installing no-op JS handlers.
    blocks_pointer_events: bool = false,
    handlers: EventHandler = .{},
    scroll_x: f32 = 0,
    scroll_y: f32 = 0,
    /// Lua-tree: index into global `_scrollY` for persisting scroll across `__clearLuaNodes`.
    scroll_persist_slot: u32 = 0,
    show_scrollbar: bool = true,
    scrollbar_side: ScrollbarSide = .auto,
    scrollbar_auto_hide: bool = true,
    scrollbar_last_activity_ms: i64 = 0,
    content_height: f32 = 0,
    content_width: f32 = 0,
    devtools_viz: DevtoolsViz = .none,
    // 3D elements — inline in the 2D tree, rendered by gpu/3d.zig
    scene3d: bool = false, // true = contains 3D.* children
    scene3d_mesh: bool = false, // true = 3D.Mesh
    scene3d_camera: bool = false, // true = 3D.Camera
    scene3d_camera_orbit: bool = false, // true = host-driven orbit camera (drop-to-view); ignores pos/look props
    scene3d_wireframe: bool = false, // true = draw a barycentric wireframe over every mesh in this Scene3D
    scene3d_matcap: bool = false, // true = shade meshes by view-space normal (sculpt-style form reading), req_3766
    scene3d_player_scale_overlay: bool = false, // opt-in 1m/player ruler + mannequin; default-off view furniture
    scene3d_measurement_overlay: bool = false, // opt-in model/scope/selection dimensions in metres + modeling units
    scene3d_light: bool = false, // true = 3D.Light
    scene3d_group: bool = false, // true = 3D.Group
    scene3d_light_type: ?[]const u8 = null, // "ambient", "directional", "point"
    scene3d_color_r: f32 = 0.8,
    scene3d_color_g: f32 = 0.8,
    scene3d_color_b: f32 = 0.8,
    scene3d_color_a: f32 = 1.0, // <1 routes the mesh through the transparent pass (glass)
    scene3d_pos_x: f32 = 0,
    scene3d_pos_y: f32 = 0,
    scene3d_pos_z: f32 = 0,
    scene3d_rot_x: f32 = 0,
    scene3d_rot_y: f32 = 0,
    scene3d_rot_z: f32 = 0,
    scene3d_scale_x: f32 = 1,
    scene3d_scale_y: f32 = 1,
    scene3d_scale_z: f32 = 1,
    scene3d_look_x: f32 = 0, // Camera lookAt target
    scene3d_look_y: f32 = 0,
    scene3d_look_z: f32 = 0,
    scene3d_dir_x: f32 = 0, // Light direction
    scene3d_dir_y: f32 = -1,
    scene3d_dir_z: f32 = 0,
    scene3d_fov: f32 = 60, // Camera fov in degrees
    // Camera clip planes / draw radius. 0 = auto-derive from scene extent (the
    // historical behaviour). scene3d_far is BOTH the projection far plane and the
    // per-mesh cull distance: a mesh whose nearest point is past it is skipped.
    scene3d_far: f32 = 0, // draw radius (world units); 0 = auto
    scene3d_near: f32 = 0, // near clip (world units); 0 = auto
    scene3d_intensity: f32 = 1.0, // Light intensity
    // Placed (point/spot) light shape — the "pyramid" the user authors: a tip at
    // scene3d_pos, aimed down scene3d_dir, opening to scene3d_spread, carrying
    // scene3d_range. scene3d_spread == 0 → an omni bulb (full sphere); > 0 → a
    // spot cone of that half-angle (degrees). scene3d_range == 0 → a default reach.
    scene3d_range: f32 = 0, // point/spot reach (world units); 0 = default
    scene3d_spread: f32 = 0, // spot cone half-angle (deg); 0 = omni point light
    scene3d_cast_shadow: bool = false, // spot: render a shadow map from its POV
    // colorFrom (req_3396): live material region id whose palette slots drive
    // this light's color, host-stepped each frame. -1 = fixed color prop.
    scene3d_light_region: i32 = -1,
    // Skybox — a <Scene3D.Skybox> child flips this on. gpu/3d.zig draws an
    // analytic fullscreen sky (gradient + sun + haze + clouds + stars) before
    // the meshes and feeds `horizon` into the fog color so distant geometry
    // melts into the sky. Every field is a live uniform: animate them per
    // commit for day cycle / weather / per-zone mood.
    scene3d_skybox: bool = false,
    scene3d_sky_zenith: [3]f32 = .{ 0.16, 0.33, 0.62 }, // straight up
    scene3d_sky_horizon: [3]f32 = .{ 0.62, 0.72, 0.86 }, // at the horizon line
    scene3d_sky_ground: [3]f32 = .{ 0.10, 0.11, 0.13 }, // below horizon
    scene3d_sky_sun_dir: [3]f32 = .{ 0.4, 0.6, 0.3 }, // direction TO the sun
    scene3d_sky_sun_color: [3]f32 = .{ 1.0, 0.93, 0.78 },
    scene3d_sky_sun_size: f32 = 0.012, // angular radius of the disk (0..1)
    scene3d_sky_sun_glow: f32 = 0.25, // 0 = tight halo, 1 = broad wash
    scene3d_sky_haze: f32 = 0.3, // milky horizon lift / turbidity (0..1)
    scene3d_sky_cloud: f32 = 0.0, // cloud coverage (0 clear .. 1 overcast)
    scene3d_sky_night: f32 = 0.0, // star intensity (0 day .. 1 night)
    // Distance fog — a <Scene3D.Fog> child flips this on. When absent, fog
    // auto-anchors to the camera draw radius (scene3d_far) if one is set, else to
    // scene extent. When present, these explicit values win (linked → unlinked).
    // fog_color = {-1,-1,-1} sentinel means "use the skybox horizon colour".
    scene3d_fog: bool = false,
    scene3d_fog_color: [3]f32 = .{ -1, -1, -1 },
    scene3d_fog_near: f32 = 0, // 0 = auto
    scene3d_fog_far: f32 = 0, // 0 = auto
    // Per-mesh diffuse texture. When tex_w * tex_h > 0 and tex_rgba is set,
    // gpu/3d.zig uploads it to a wgpu texture (cached by hash) and binds
    // it as group(1) for that mesh's draw call. Otherwise the mesh samples
    // the global default white texture.
    scene3d_tex_w: u32 = 0,
    scene3d_tex_h: u32 = 0,
    scene3d_tex_rgba: ?[]const u8 = null, // raw RGBA bytes, length = w*h*4
    scene3d_tex_key: ?[]const u8 = null, // StaticSurface key — looked up in gpu/gpu.zig
    // Ground-formula surface (the data-shape ground — GUIDING_LIGHT). When set,
    // the mesh runs this WGSL formula per fragment (gpu/3d.zig assembles it with
    // scene3d_ground_prefix/epilogue + effect_math, compiled once) instead of
    // sampling a baked texture; scene3d_ground_data is the per-cell reference
    // stream bound as the formula's storage buffer D. Crisp at any zoom, no bake.
    scene3d_ground_formula: ?[]const u8 = null, // WGSL defining fn hf_ground_rgb(uv)->vec3f
    scene3d_ground_data: ?[]const f32 = null, // D ref stream (cols,rows,pal,palette…,cells…,ribbon)
    // Monotonic content identity for scene3d_ground_data. The GPU keeps each
    // resident D buffer across frames and uploads only when this value or the
    // backing slice changes; live paint increments it after height/look edits.
    scene3d_ground_data_version: u64 = 0,
    // @reactjit/geometries registry mesh. A geometry generator (TS) produced these
    // interleaved verts [px,py,pz,nx,ny,nz,u,v]×count; gpu/3d.zig interns them by
    // `scene3d_geom_key` (id+paramHash) into a RETAINED GPU buffer and redraws the
    // slice every frame — NO per-frame regeneration. The framework knows zero shape
    // names; it just uploads bytes. This is the ONLY way a mesh gets geometry.
    scene3d_geom_key: ?[]const u8 = null, // intern key
    scene3d_vertices: ?[]const f32 = null, // interleaved verts, read once on cache miss
    scene3d_vert_count: u32 = 0,
    scene3d_bounds_radius: f32 = 0, // unscaled bounding radius from the generator (culling)
    // Skinned mesh (SKIN-3499): a figure drawn as ONE matrix-palette-blended
    // draw instead of N per-part nodes. Wire verts are stride-16 f32
    // [pos3, normal3, uv2, joint4, weight4] in MODEL space; the palette is
    // bone_count × 20 floats (column-major model-space mat4 + rgba tint per
    // bone, inverse-bind folded in — skeleton/pose.zig), rewritten by the
    // world loader every frame. The node's own TRS is the figure's world root.
    scene3d_skin_geom_key: ?[]const u8 = null, // skinned intern key
    scene3d_skin_vertices: ?[]const f32 = null, // stride-16 wire verts, read once on cache miss
    scene3d_skin_vert_count: u32 = 0,
    scene3d_skin_palette: ?[]const f32 = null, // bone_count × 20 floats, live-posed
    scene3d_skin_bone_count: u32 = 0,
    // Host-generated heightfield (live-sculpted terrain). A regular grid's topology
    // (x/z, UVs, triangulation) is fixed; only the heights move as you paint. So
    // instead of shipping ~86k baked verts every sculpt, ship just the cols×rows
    // height grid + dims and let gpu/3d.zig generate the mesh verts host-side under a
    // "~hf~" key. ~47× less bridge traffic, and it's the SAME grid the heightfield
    // collider already takes (see-it==walk-it). heights len = hf_cols*hf_rows.
    scene3d_heights: ?[]const f32 = null,
    // Optional per-cell water DEPTH grid (surface − bed, metres), same cols×rows
    // as heights. Present only on water meshes; gpu/3d.zig hfGen bakes it into the
    // top-surface UV.x so the water shader can draw the deep/shallow gradient and
    // the shoreline foam (depth→0 = waterline). Null ⇒ UV stays grid coords.
    scene3d_hf_depths: ?[]const f32 = null,
    scene3d_hf_cols: u32 = 0,
    scene3d_hf_rows: u32 = 0,
    scene3d_hf_width: f32 = 0,
    scene3d_hf_depth: f32 = 0,
    scene3d_hf_base: f32 = 0,
    // Optional travelling surface wave (bodies of water): a heightfield with a
    // non-zero wave amplitude re-bakes every frame from the host clock, rippling
    // its top surface. Zero amplitude (the default, all terrain) = static, cached.
    scene3d_hf_wave_amp: f32 = 0,
    scene3d_hf_wave_len: f32 = 0,
    scene3d_hf_wave_speed: f32 = 0,
    scene3d_hf_wave_dx: f32 = 1,
    scene3d_hf_wave_dz: f32 = 0,
    // Packed instance stream for large static batches. One Scene3D node can
    // submit thousands of transforms/colors without creating one host node per
    // object. Layout: [px,py,pz, sx,sy,sz, r,g,b] * count when stride=9.
    scene3d_instance_data: ?[]const f32 = null,
    scene3d_instance_count: u32 = 0,
    scene3d_instance_stride: u32 = 0,
    // Optional populated prefix of scene3d_instance_data for a STATIC retained
    // batch. 0 = the full source slice (the default required by streamed families
    // whose nodes draw shared sub-ranges). A non-zero value uploads only that many
    // rows while still reserving the full source-slice capacity at a stable offset.
    // Bump scene3d_instance_version whenever the populated bytes/count change.
    scene3d_instance_populated_count: u32 = 0,
    // STATIC instanced batch: upload its instance data to the retained instance
    // buffer ONCE (keyed by the data pointer) and redraw it every frame with no
    // restage/upload. For world geometry that never moves (the no-V8 loader's
    // baked city). Only set this when scene3d_instance_data is stable + immutable.
    scene3d_instance_static: bool = false,
    // Re-stage hint for a STATIC batch (DIRTYRECT req_1891/1892): when the loader
    // edits the instance bytes IN PLACE (a dirty-rectangle erase — collapsing the
    // baked rows a moved/deleted piece left behind), it bumps this. The static
    // cache re-uploads the batch at its existing offset on a version change, so the
    // edit shows without a rebake and the retained offset (and any streamed
    // sub-ranges over it) stay valid. 0 = never edited (pure upload-once path).
    scene3d_instance_version: u32 = 0,
    // First row of the sub-range a STATIC node draws from its (shared) upload.
    // Streaming emits many nodes over one instance_data array, each drawing
    // [first, first+count) — the whole array uploads once regardless.
    scene3d_instance_first: u32 = 0,
    // Per-chunk sub-ranges of a STATIC batch for frustum culling (req_2859):
    // each segment is a contiguous row range of the uploaded batch plus its
    // world bounding sphere. When present, the renderer draws only segments
    // whose sphere survives the camera frustum — foliage behind the camera
    // costs zero. Absent (null) = the whole batch draws as one range.
    scene3d_instance_segments: ?[]const InstanceSegment = null,
    // Distance-density LOD over the segments (req_2868): a far segment draws
    // only a PREFIX of its rows. Set this ONLY when the producer shuffled
    // each segment's rows (a prefix must be a spatially uniform subset, not
    // a stripe of cells). Near segments stay exact; sub-pixel distant plants
    // are the ones thinned.
    scene3d_instance_lod_density: bool = false,
    // Physics 2D — inline in the 2D tree, driven by framework/physics2d.zig
    physics_world_id: u8 = 0, // multi-physics-world instance index (0..MAX_PHYSICS_WORLDS-1)
    physics_world: bool = false, // true = Physics.World container
    physics_body: bool = false, // true = Physics.Body (wraps child nodes)
    physics_collider: bool = false, // true = Physics.Collider (shape definition, no visual)
    physics_body_type: u8 = 2, // 0=static, 1=kinematic, 2=dynamic
    physics_x: f32 = 0, // initial body position (pixels)
    physics_y: f32 = 0,
    physics_angle: f32 = 0,
    physics_gravity_x: f32 = 0, // world gravity (pixels/s^2)
    physics_gravity_y: f32 = 980,
    physics_density: f32 = 1.0,
    physics_friction: f32 = 0.3,
    physics_restitution: f32 = 0.1,
    physics_radius: f32 = 0, // circle collider radius (pixels)
    physics_shape: u8 = 0, // 0=rectangle, 1=circle
    physics_body_idx: i16 = -1, // runtime: assigned body index from physics2d
    physics_fixed_rotation: bool = false,
    physics_bullet: bool = false,
    physics_gravity_scale: f32 = 1.0,
    context_menu_items: ?[]const context_menu.MenuItem = null,
    terminal: bool = false, // true = Terminal element (cell-grid rendering via vterm)
    terminal_font_size: u16 = 13, // monospace font size for terminal cell grid
    // Session name from <Terminal session="..." />. Each unique name maps to
    // its own Pipe (vterm + PTY + scrollback + classifier + semantic graph).
    // Null → engine falls back to the implicit "default" session. Sessions
    // persist across mount/unmount: PTYs keep running in the background while
    // their <Terminal> is unmounted, then resume when re-mounted under the
    // same name. Owned by g_alloc (dupZ'd in applyProps).
    terminal_session: ?[]const u8 = null,
    // Optional shell binary path from <Terminal shell="..." />. Null →
    // engine spawns "bash". Read once on the tick that spawns this session's
    // PTY; ignored on later updates of the same session.
    terminal_shell: ?[*:0]const u8 = null,
    // <Terminal dumb /> — no PTY, no shell. The pipe is a pure cell-grid the
    // cart paints into via __vterm_feed (ANSI bytes → parser → cells). The
    // engine tick skips spawn + poll for these and drives repaints off the
    // vterm damage flag instead. Backs the TUI playground's live preview.
    terminal_dumb: bool = false,
    graph_container: bool = false, // true = Graph element (SVG paths, no pan/zoom)
    // true = Graph/Canvas uses DOM-style origin (0,0 at element top-left).
    // Default is center-origin (world 0,0 sits at the element midpoint), which
    // suits polar / pan-zoom visualisations. Flip to true for chart code that
    // thinks in plot-area DOM coordinates (plotX, plotY, plotW, plotH).
    graph_origin_topleft: bool = false,
    canvas_id: u8 = 0, // multi-canvas instance index (0..MAX_CANVAS_INSTANCES-1)
    canvas_type: ?[]const u8 = null,
    // Canvas viewport — initial camera (center point + zoom)
    canvas_view_x: f32 = 0,
    canvas_view_y: f32 = 0,
    canvas_view_zoom: f32 = 1.0,
    canvas_view_set: bool = false, // true = apply on first frame
    // Canvas viewport drift — continuous camera animation (pixels/second)
    canvas_drift_x: f32 = 0, // horizontal drift speed (px/s, negative = left)
    canvas_drift_y: f32 = 0, // vertical drift speed (px/s, negative = up)
    canvas_drift_active: bool = false, // true = drift animation is running
    // false = this Canvas opts out of the engine's built-in Canvas.Node
    // click-to-select + hover/selected highlight. A selected node freezes
    // drift (paintCanvasContainer), so carts with their own selection model
    // (the hmsc-int map painter) must turn this off — otherwise a background
    // click over any node silently toggles a phantom selection that kills
    // WASD pan. Prop: selectNodes={false}.
    canvas_node_select: bool = true,
    canvas_auto_stacked: bool = false, // true = generative layout already applied this visit
    // Built-in grid overlay — painted under all Canvas children when grid_step > 0.
    canvas_grid_step: f32 = 0,
    canvas_grid_stroke: f32 = 1,
    canvas_grid_color: ?Color = null,
    canvas_grid_color_major: ?Color = null,
    canvas_grid_major_every: u8 = 0, // 0 = no majors
    // Per-node theme override (0 = inherit global, 1+ = palette ID from registry)
    theme_id: u8 = 0,
    // Canvas.Node fields — position + size in parent canvas's coordinate space
    canvas_node: bool = false, // true = this is a Canvas.Node
    canvas_gx: f32 = 0, // graph-space X (center)
    canvas_gy: f32 = 0, // graph-space Y (center)
    canvas_gw: f32 = 0, // graph-space width (0 = auto from content)
    canvas_gh: f32 = 0, // graph-space height (0 = auto from content)
    canvas_move_draggable: bool = false, // true = Alt+drag on this node fires onMove (for cart-driven reposition)
    // Canvas.Path fields — SVG path drawing
    canvas_clamp: bool = false, // true = this is a Canvas.Clamp (viewport-pinned)
    canvas_path: bool = false, // true = this is a Canvas.Path
    canvas_path_d: ?[]const u8 = null, // SVG path data string
    canvas_stroke_width: f32 = 2,
    canvas_stroke_opacity: f32 = 1,
    canvas_fill_color: ?Color = null,
    canvas_fill_opacity: f32 = 1,
    canvas_fill_gradient: ?LinearGradient = null, // linear gradient fill — Gouraud-interpolated via drawTriColored
    canvas_flow_speed: f32 = 0, // 0 = solid, >0 = flow forward, <0 = flow reverse
    canvas_fill_effect: ?[]const u8 = null, // effect name to use as polygon fill texture
    // SDF icon — when set, the engine paints this node as a textured quad
    // sampling the pre-baked icon atlas (framework/gpu/sdf_icons.zig). Cheap
    // alternative to <Graph.Path> for icons whose geometry doesn't change.
    // Tint comes from text_color; size comes from layout (style.width/height).
    icon_name: ?[]const u8 = null,
    // <Slider> — host-driven slider (SLIDER-0611, the V23 law applied to
    // scrubbing: the engine owns the thumb while the button is down). While
    // slider_dragging, motion updates slider_value pool-side and repaints with
    // ZERO JS in the loop; the value streams to JS via __dispatchSliderChange
    // (throttled) and settles via __dispatchSliderCommit on release. UPDATEs
    // to sliderValue are ignored mid-drag so a React echo never fights the
    // engine thumb. Track tint = style background, fill tint = text_color.
    slider: bool = false,
    slider_dragging: bool = false,
    slider_min: f32 = 0,
    slider_max: f32 = 1,
    slider_step: f32 = 0, // 0 = continuous
    slider_value: f32 = 0,
    // Media scrubber extension (MEDIASLIDER-0705): bind the slider to a
    // videos.zig entry by src. The ENGINE then owns value + range end to
    // end — follows mpv time-pos when idle, issues throttled keyframe
    // seeks during a drag and one exact seek on release. sliderValue/Min/
    // Max props are ignored while bound; range auto-sets to [0,duration].
    slider_media_src: ?[]const u8 = null,
    // Hover pointer-value (the vidstack value/pointerValue split, host-
    // side): while the cursor is over the slider the engine writes the
    // tooltip left-position latch every motion (zero JS) and dispatches
    // __dispatchSliderHover only when the QUANTIZED bucket changes
    // (slider_hover_step seconds per bucket; -1 on leave).
    slider_hover: bool = false,
    slider_hover_latch_key: ?[]const u8 = null,
    slider_hover_w: f32 = 0, // tooltip width for centering clamp; 0 = raw x
    slider_hover_step: f32 = 1, // bucket granularity in value units
    // Graph.Polyline — flat point array {x0, y0, x1, y1, …} parsed ONCE at
    // CREATE/UPDATE from the cart's `points` prop. Engine paint emits one
    // capsule-SDF line per segment, batched. Bypasses the SVG d-string
    // parser + bezier flattening that <Graph.Path> pays every paint.
    polyline_points: ?[]f32 = null,
    // Graph.Polyline `segments` mode: when true the point array is a SEGMENT
    // LIST (independent pairs p0p1, p2p3, …) instead of a connected strip — so
    // ONE node draws N DISJOINT capsule lines (a mesh wireframe's edges, axis
    // spokes) without spurious connectors and without N reconciler nodes. Engine
    // paint steps by pairs (i += 4) instead of point-by-point (i += 2).
    polyline_segments: bool = false,
    // Graph.GCurve — flat array of 6-float quadratic-bezier-triangle control
    // points: {p0x, p0y, p1x, p1y, p2x, p2y, p0x', p0y', …}. Each group of 6
    // is one Loop-Blinn fill triangle. Engine paint queues one g-curve fill
    // instance per group; batched into one draw call. Use canvas_fill_color
    // for the fill tint. Resolution-independent, perfectly anti-aliased,
    // no SDF texture or tessellation involved.
    gcurve_data: ?[]f32 = null,
    text_effect: ?[]const u8 = null, // effect name for per-glyph text coloring
    // Inline glyphs — polygons/3D embedded in text (emoji-like)
    inline_glyphs: ?[]const InlineGlyph = null,
    inline_slots: [MAX_INLINE_SLOTS]InlineSlot = [_]InlineSlot{.{}} ** MAX_INLINE_SLOTS,
    inline_slot_count: u8 = 0,
    // Effect — user-compiled pixel render callback
    effect_render: ?effect_ctx.RenderFn = null,
    effect_render_context: ?*anyopaque = null,
    effect_shader: ?effect_shader.GpuShaderDesc = null,
    effect_name: ?[]const u8 = null, // named effect — renders but not drawn, referenced by fillEffect
    // <Effect textures={['mask-A', 'src-img']}>. Each entry is a paintable
    // id string; effects.zig binds the paintable's view + sampler into the
    // pipeline at fixed slot pairs starting at @binding(2):
    //   index 0 → binding(2) = texture_2d<f32>, binding(3) = sampler
    //   index 1 → binding(4) = texture_2d<f32>, binding(5) = sampler
    // Owned by g_alloc; freed on prop replace or node destroy.
    effect_textures: ?[]const []const u8 = null,
    // Cart-supplied f32 array uploaded to the Effect's storage buffer at
    // @group(0) @binding(1). Lets the shader source stay static while the
    // data updates per frame — the chart-rendering analog of how text uses
    // a glyph atlas. Lifetime: parsed once at CREATE/UPDATE in v8_app.zig,
    // owned by the engine alloc, leaked on prop replace (same pattern as
    // canvas_path_d / polyline_points).
    effect_data: ?[]f32 = null,
    // <Boxxx>/RectBatch — effect_data holds a flat box buffer (count, then 14
    // floats/box: x,y,w,h, fill rgba, radius, borderW, border rgba). Emitted
    // directly into the instanced-rect pipeline in one paint pass: no per-box
    // reconciler node, no layout solve, no MAX_CHILDREN cap, no Effect/gather.
    rect_batch: bool = false,
    effect_background: bool = false, // true = render behind parent's children
    effect_mask: bool = false, // true = post-process parent's rendered content
    // Custom window chrome — borderless window drag/resize regions
    window_drag: bool = false, // true = dragging this node moves the window
    window_resize: bool = false, // true = this node is a resize edge (direction auto-detected from position)
    // CSS-style transition config — when set, animatable visual props
    // (opacity, scale, color, etc.) interpolate via framework/transition.zig
    // on UPDATE mutations instead of snapping to the new value.
    transition_active: bool = false,
    transition_duration_ms: u16 = 300,
    transition_delay_ms: u16 = 0,
    transition_easing: easing_mod.EasingType = .ease_in_out,
    _flex_w: ?f32 = null,
    _stretch_h: ?f32 = null,
    _parent_inner_w: ?f32 = null,
    _parent_inner_h: ?f32 = null,
    _cache_iw: f32 = -1,
    _cache_ih: f32 = -1,
    _cache_ih_avail: f32 = -1,
    // ── incremental relayout (the "dirty cycle") ──
    // Parent link + cached call frame let us replay ONE subtree's layout with
    // the exact inputs its parent gave it last full pass — so a change inside a
    // size-locked node reflows only that subtree, not the whole tree. All
    // additive: the full-reflow path never reads these.
    parent: ?*Node = null,
    _size_locked: bool = false, // outer size independent of descendant content
    _in_px: f32 = 0,
    _in_py: f32 = 0,
    _in_pw: f32 = 0,
    _in_ph: f32 = 0,
    _in_flexw: ?f32 = null,
    _in_stretchh: ?f32 = null,
};
pub const MeasureTextFn = *const fn (text: []const u8, font_size: u16, font_family_id: u8, max_width: f32, letter_spacing: f32, line_height: f32, max_lines: u16, no_wrap: bool, bold: bool) TextMetrics;
pub const MeasureImageCallback = struct {
    context: *anyopaque,
    function: *const fn (context: *anyopaque, path: []const u8) ImageDims,
};
/// Layout-event callback. Fires inside `setRect` for nodes flagged
/// `has_on_layout`. Engine wires this to a JS dispatcher; bench/standalone
/// callers leave it null and pay nothing.
pub const EmitLayoutCallback = struct {
    context: *anyopaque,
    function: *const fn (context: *anyopaque, id: u32, rect: LayoutRect) void,
};

pub const PendingLayoutEvent = struct {
    id: u32,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
};
var pending_layout_events: std.ArrayList(PendingLayoutEvent) = .empty;

/// Drain the queue accumulated by `setRect` since the last drain. Caller owns
/// the returned slice — do not free it; the next `clearPendingLayoutEvents`
/// reuses the underlying capacity.
pub fn pendingLayoutEvents() []const PendingLayoutEvent {
    return pending_layout_events.items;
}

pub fn clearPendingLayoutEvents() void {
    pending_layout_events.clearRetainingCapacity();
}

// ── Module state ───────────────────────────────────
var measureFn: ?MeasureTextFn = null;
var measure_image_callback: ?MeasureImageCallback = null;
var emit_layout_callback: ?EmitLayoutCallback = null;
const LAYOUT_BUDGET: usize = 100000;
var layoutCount: usize = 0;

/// When false, the main loop may skip `layout.layout(root)` until something calls `markLayoutDirty`.
/// Starts true so the first frame always runs flex layout after app init.
var g_layout_dirty: bool = true;

// ── incremental-relayout state ──
// `markNodeDirty` records a single changed node; a second distinct node or any
// structural change (`markLayoutFull`) escalates the next pass to a full reflow.
// `g_have_layout` gates incremental until one full pass has populated parent
// links + cached frames. Default full so the first pass is always complete.
var g_dirty_one: ?*Node = null;
var g_dirty_full: bool = true;
var g_have_layout: bool = false;

/// Mark a node whose layout-affecting style just changed (call from applyStyle
/// before the next `layout()`). Two distinct nodes in one frame → full pass.
pub fn markNodeDirty(node: *Node) void {
    if (g_dirty_one) |d| {
        if (d != node) g_dirty_full = true;
    } else {
        g_dirty_one = node;
    }
}

/// Force the next `layout()` to be a full pass — resize, or any structural
/// change (CREATE / APPEND / INSERT_BEFORE / REMOVE).
pub fn markLayoutFull() void {
    g_dirty_full = true;
}

/// True for the duration of a layout pass that was driven by an actual
/// mutation (state change, resize, hot-reload, etc.). `setRect` emits onLayout
/// events only when this is true, which means: idle frames with the every-frame
/// flex pass don't fire onLayout, but a real trigger fires it for every flagged
/// node in the tree — even ones whose rect coincidentally matches the previous
/// pass's value.
var g_emit_layout_pass: bool = false;

pub fn markLayoutDirty() void {
    g_layout_dirty = true;
}

pub fn isLayoutDirty() bool {
    return g_layout_dirty;
}

pub fn clearLayoutDirty() void {
    g_layout_dirty = false;
}

// ── Functions ──────────────────────────────────────

pub fn hitTest(node: *Node, mx: f32, my: f32) ?*Node {
    if (node.style.display == .none) {
        return null;
    }
    // Scroll container: clip hit test to container bounds and adjust coordinates
    const ov = node.style.overflow;
    const r = node.computed;
    const is_scroll = (ov == .scroll or (ov == .auto and node.content_height > r.h));
    var child_mx = mx;
    var child_my = my;
    if (is_scroll) {
        // Reject clicks outside the scroll container's visible bounds
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) {
            return null;
        }
        // Convert screen coordinates to content coordinates
        child_my = my + node.scroll_y;
        child_mx = mx + node.scroll_x;
    }

    // Filter-aware pointer warp. The CRT shader applies barrel distortion
    // in its fragment shader; without matching that math here, the
    // pointer hits where the un-warped layout thinks the element is,
    // not where the user visually sees it.
    if (node.filter_name) |fname| {
        if (std.mem.eql(u8, fname, "crt") and r.w > 0 and r.h > 0) {
            const u = (child_mx - r.x) / r.w;
            const v = (child_my - r.y) / r.h;
            const px = u * 2.0 - 1.0;
            const py = v * 2.0 - 1.0;
            const r2 = px * px + py * py;
            const k = 0.15 * node.filter_intensity;
            const scale = 1.0 + k * r2;
            const ppx = px * scale;
            const ppy = py * scale;
            const src_u = ppx * 0.5 + 0.5;
            const src_v = ppy * 0.5 + 0.5;
            // CRT shader returns transparent when source uv is OOB —
            // hit-test misses match the visible blackness.
            if (src_u < 0.0 or src_u > 1.0 or src_v < 0.0 or src_v > 1.0) {
                return null;
            }
            child_mx = r.x + src_u * r.w;
            child_my = r.y + src_v * r.h;
        }
    }

    // Canvas container: graph-space children (Canvas.Node / Canvas.Path and
    // their wrapper containers — positionOneCanvasNode writes RAW GRAPH
    // coordinates into their computed rects) must never be hit-tested with
    // screen coords. A panned canvas leaves children with rects far outside
    // the viewport — over the app's chrome — that swallow clicks wherever
    // graph coords coincide with screen coords (NAVDEAD-0605: hmsc-int's
    // route bar went unclickable under the buried editor's panned paint
    // canvas). Clicks INSIDE the canvas are routed by the engine's dedicated
    // canvas path (findCanvasNode → screenToGraph → hitTestCanvasNode); only
    // Canvas.Clamp children stay in screen space and hit-test normally.
    // Mirrors events.hitTestHoverable's guard.
    if (node.canvas_type != null) {
        if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) return null;
        var ci = node.children.len;
        while (ci > 0) {
            ci -= 1;
            const child = &node.children[ci];
            if (child.canvas_clamp) {
                if (hitTest(child, child_mx, child_my)) |hit| return hit;
            }
        }
        return node;
    }

    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        if (hitTest(&node.children[i], child_mx, child_my)) |hit| {
            return hit;
        }
    }
    if (node.blocks_pointer_events or hasHandlers(node.handlers) or node.href != null or node.input_id != null or node.canvas_type != null) {
        if (mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
            return node;
        }
    }
    return null;
}

fn hasHandlers(h: EventHandler) bool {
    return h.on_press != null or h.js_on_press != null or h.lua_on_press != null or
        h.on_mouse_down != null or h.js_on_mouse_down != null or h.lua_on_mouse_down != null or
        h.on_mouse_move != null or h.js_on_mouse_move != null or h.lua_on_mouse_move != null or
        h.on_mouse_up != null or h.js_on_mouse_up != null or h.lua_on_mouse_up != null or
        h.on_hover_enter != null or h.on_hover_exit != null or h.js_on_hover_enter != null or h.lua_on_hover_enter != null or h.js_on_hover_exit != null or h.lua_on_hover_exit != null or
        h.on_key != null or h.on_change_text != null or h.on_scroll != null or h.on_right_click != null;
}

pub fn hitTestText(node: *Node, mx: f32, my: f32) ?Node {
    if (node.style.display == .none) {
        return null;
    }
    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        const hit = &hitTestText(node.children[@intCast(i)], mx, my);
        if (hit != null) {
            return hit.?;
        }
    }
    if (node.text != null) {
        const r = node.computed;
        if (mx >= r.x and mx < r.x + r.w and my >= r.y and my < r.y + r.h) {
            return node;
        }
    }
    return null;
}

pub fn findScrollContainer(node: *Node, mx: f32, my: f32) ?Node {
    if (node.style.display == .none) {
        return null;
    }
    const r = node.computed;
    if (mx < r.x or mx >= r.x + r.w or my < r.y or my >= r.y + r.h) {
        return null;
    }
    var i = node.children.len;
    while (i > 0) {
        i -= 1;
        const hit = &findScrollContainer(node.children[@intCast(i)], mx, my);
        if (hit != null) {
            return hit.?;
        }
    }
    if (node.style.overflow == .scroll) {
        return node;
    }
    return null;
}

fn rgb(r: u8, g: u8, b: u8) Color {
    return .{ .r = r, .g = g, .b = b, .a = 255 };
}

fn rgba(r: u8, g: u8, b: u8, a: u8) Color {
    return .{ .r = r, .g = g, .b = b, .a = a };
}

pub fn setMeasureFn(f: ?MeasureTextFn) void {
    measureFn = f;
}

pub fn setMeasureImageCallback(callback: ?MeasureImageCallback) void {
    measure_image_callback = callback;
}

pub fn setEmitLayoutCallback(callback: ?EmitLayoutCallback) void {
    emit_layout_callback = callback;
}

/// Single chokepoint for assigning a node's computed rect. Replaces raw
/// `node.computed = .{...}` so onLayout-flagged nodes notify JS in the same
/// step that produced the rect — no post-pass walk, no diff cache.
///
/// Emission gates on `g_emit_layout_pass`, which `pub fn layout()` snapshots
/// from `g_layout_dirty` at pass entry. Layout itself runs every frame (the
/// dirty flag isn't currently used to skip the pass), but onLayout only fires
/// for the passes that were actually driven by a state change, resize, or
/// hot-reload — so idle frames stay silent and a real trigger fires the event
/// for every flagged node, including ones whose rect happens to be identical.
pub inline fn setRect(node: *Node, rect: LayoutRect) void {
    node.computed = rect;
    if (g_emit_layout_pass and node.has_on_layout and node.id != 0) {
        if (emit_layout_callback) |callback| callback.function(callback.context, node.id, rect);
    }
}

fn padLeft(s: Style) f32 {
    return s.padding_left orelse s.padding;
}

fn padRight(s: Style) f32 {
    return s.padding_right orelse s.padding;
}

fn padTop(s: Style) f32 {
    return s.padding_top orelse s.padding;
}

fn padBottom(s: Style) f32 {
    return s.padding_bottom orelse s.padding;
}

fn marLeft(s: Style) f32 {
    const v = s.margin_left orelse s.margin;
    return if (std.math.isInf(v)) 0 else v;
}
fn marRight(s: Style) f32 {
    const v = s.margin_right orelse s.margin;
    return if (std.math.isInf(v)) 0 else v;
}
fn marTop(s: Style) f32 {
    const v = s.margin_top orelse s.margin;
    return if (std.math.isInf(v)) 0 else v;
}

fn marBottom(s: Style) f32 {
    const v = s.margin_bottom orelse s.margin;
    return if (std.math.isInf(v)) 0 else v;
}

fn resolveMaybePct(val: ?f32, parent: f32) ?f32 {
    if (val == null) {
        return null;
    }
    if (val.? < 0) {
        return (-val.?) * parent;
    }
    return val.?;
}

fn clampVal(val: f32, minVal: ?f32, maxVal: ?f32) f32 {
    var v = val;
    if (minVal != null and asF32(v) < asF32(minVal.?)) {
        v = minVal.?;
    }
    if (maxVal != null and asF32(v) > asF32(maxVal.?)) {
        v = maxVal.?;
    }
    return v;
}

fn measureNodeImage(node: *Node) ImageDims {
    if (node.image_src) |src| {
        if (measure_image_callback) |callback| {
            return callback.function(callback.context, src);
        }
    }
    return .{ .width = 0, .height = 0 };
}

fn measureNodeText(node: *Node) TextMetrics {
    return measureNodeTextW(node, 0);
}

// ── Text measurement cache ──────────────────────────────────────
// Avoids redundant FreeType calls during estimation + layout.
// Keyed on the full measurement inputs. Text height/line breaks depend on
// spacing, line height, line clamps, and no-wrap just as much as width.
// Direct-mapped (hash & mask) for speed. Collisions just re-measure.

const TEXT_CACHE_SIZE = 1024; // must be power of 2
const TEXT_CACHE_MASK = TEXT_CACHE_SIZE - 1;

const TextCacheEntry = struct {
    text_ptr: usize = 0,
    text_len: usize = 0,
    font_size: u16 = 0,
    font_family_id: u8 = 0,
    font_weight: u16 = 0,
    max_width_bits: u32 = 0,
    letter_spacing_bits: u32 = 0,
    line_height_bits: u32 = 0,
    max_lines: u16 = 0,
    no_wrap: bool = false,
    result: TextMetrics = .{},
    valid: bool = false,
};

var textCache: [TEXT_CACHE_SIZE]TextCacheEntry = [_]TextCacheEntry{.{}} ** TEXT_CACHE_SIZE;

fn textCacheHash(text_ptr: usize, text_len: usize, font_size: u16, font_family_id: u8, font_weight: u16, max_width_bits: u32, letter_spacing_bits: u32, line_height_bits: u32, max_lines: u16, no_wrap: bool) usize {
    // FNV-1a style hash
    var h: usize = 0x811c9dc5;
    h ^= text_ptr;
    h *%= 0x01000193;
    h ^= text_len;
    h *%= 0x01000193;
    h ^= font_size;
    h *%= 0x01000193;
    h ^= font_family_id;
    h *%= 0x01000193;
    h ^= font_weight;
    h *%= 0x01000193;
    h ^= max_width_bits;
    h *%= 0x01000193;
    h ^= letter_spacing_bits;
    h *%= 0x01000193;
    h ^= line_height_bits;
    h *%= 0x01000193;
    h ^= max_lines;
    h *%= 0x01000193;
    h ^= if (no_wrap) 1 else 0;
    h *%= 0x01000193;
    return h & TEXT_CACHE_MASK;
}

fn measureNodeTextW(node: *Node, maxWidth: f32) TextMetrics {
    if (node.text == null or measureFn == null) {
        return .{ .width = 0, .height = 0, .ascent = 0 };
    }
    const txt = node.text.?;
    const text_ptr = @intFromPtr(txt.ptr);
    const text_len = txt.len;
    const mw_bits: u32 = @bitCast(@as(f32, maxWidth));
    const ls_bits: u32 = @bitCast(@as(f32, node.letter_spacing));
    const lh_bits: u32 = @bitCast(@as(f32, node.line_height));
    const bold = node.font_weight >= 600;
    const idx = textCacheHash(text_ptr, text_len, node.font_size, node.font_family_id, node.font_weight, mw_bits, ls_bits, lh_bits, node.number_of_lines, node.no_wrap);

    const entry = &textCache[idx];
    if (entry.valid and entry.text_ptr == text_ptr and entry.text_len == text_len and
        entry.font_size == node.font_size and entry.font_family_id == node.font_family_id and entry.font_weight == node.font_weight and
        entry.max_width_bits == mw_bits and
        entry.letter_spacing_bits == ls_bits and entry.line_height_bits == lh_bits and
        entry.max_lines == node.number_of_lines and entry.no_wrap == node.no_wrap)
    {
        return entry.result;
    }

    const result = measureFn.?(txt, node.font_size, node.font_family_id, maxWidth, node.letter_spacing, node.line_height, node.number_of_lines, node.no_wrap, bold);
    entry.* = .{
        .text_ptr = text_ptr,
        .text_len = text_len,
        .font_size = node.font_size,
        .font_family_id = node.font_family_id,
        .font_weight = node.font_weight,
        .max_width_bits = mw_bits,
        .letter_spacing_bits = ls_bits,
        .line_height_bits = lh_bits,
        .max_lines = node.number_of_lines,
        .no_wrap = node.no_wrap,
        .result = result,
        .valid = true,
    };
    return result;
}

fn invalidateTextCache() void {
    for (&textCache) |*entry| {
        entry.valid = false;
    }
}

fn estimateIntrinsicWidth(node: *Node) f32 {
    if (node._cache_iw >= 0) return node._cache_iw;
    const result = estimateIntrinsicWidthUncached(node);
    node._cache_iw = result;
    return result;
}

fn estimateIntrinsicWidthUncached(node: *Node) f32 {
    const s = node.style;
    if (s.width != null and s.width.? >= 0) {
        return s.width.?;
    }
    const pl = padLeft(s);
    const pr = padRight(s);
    const g = s.gap;
    const isRow = s.flex_direction == .row or s.flex_direction == .row_reverse;
    // Input nodes check BEFORE text — v8_app.zig:syncInputValue mirrors the
    // typed value into both input.syncValue(slot, ...) AND node.text, so on
    // an input the text branch below would otherwise win and measure the
    // typed string as wrap-able body text (every wrap line growing the
    // intrinsic). That caused cart/composer's library-rail SampleRow edit
    // mode to push its checkmark/cancel buttons down by one row every ~30
    // characters typed, even though the input renders single-line.
    if (node.input_id != null) {
        // TextInput's typed value lives in framework/input.zig's inputs[],
        // not node.text, so at intrinsic-sizing time we only see the
        // placeholder. Measure it if present; otherwise give the input a
        // reasonable default so a width-less TextInput doesn't collapse to
        // just padding and clip the placeholder.
        const bold = node.font_weight >= 600;
        var w: f32 = 0;
        if (node.placeholder) |ph| {
            if (measureFn) |mf| {
                const m = mf(ph, node.font_size, node.font_family_id, 0, node.letter_spacing, node.line_height, 1, true, bold);
                w = m.width;
            }
        }
        if (w <= 0) {
            w = @as(f32, @floatFromInt(node.font_size)) * 8.0;
        }
        return w + pl + pr;
    }
    if (node.text != null) {
        const m = measureNodeText(node);
        return m.width + pl + pr;
    }
    if (node.image_src != null) {
        const dims = measureNodeImage(node);
        return dims.width + pl + pr;
    }
    if (node.children.len == 0) {
        return pl + pr;
    }
    var total: f32 = 0;
    var maxCross: f32 = 0;
    var visibleCount: usize = 0;
    for (node.children) |*child| {
        if (child.style.display == .none) {
            continue;
        }
        // Same out-of-flow filter as estimateIntrinsicHeight: a 100000-wide
        // absolute backdrop (popover dismiss layer) would otherwise blow up
        // its parent's intrinsic width to 100000 and push the row layout
        // around. Mirrors paintChildrenInZOrder's z-index ordering — abs
        // children paint via their own pass, they shouldn't size the parent.
        if (child.style.position == .absolute) {
            continue;
        }
        const cw = estimateIntrinsicWidth(child);
        const cmL = marLeft(child.style);
        const cmR = marRight(child.style);
        if (isRow) {
            total += cw + cmL + cmR;
            visibleCount += 1;
        } else {
            const cross = cw + cmL + cmR;
            if (cross > maxCross) {
                maxCross = cross;
            }
        }
    }
    if (isRow) {
        const gaps = if (visibleCount > 1) g * @as(f32, @floatFromInt((visibleCount - 1))) else 0;
        return total + gaps + pl + pr;
    }
    return maxCross + pl + pr;
}

fn estimateIntrinsicHeight(node: *Node, availableWidth: f32) f32 {
    if (node._cache_ih >= 0 and node._cache_ih_avail == availableWidth) return node._cache_ih;
    var result = estimateIntrinsicHeightUncached(node, availableWidth);
    // Clamp to min_height / max_height — otherwise a container that computes
    // its indefinite height from children's intrinsic sums can end up SHORTER
    // than the child's effective min_height, and children paint outside the
    // container. Example: a Box with minHeight=30 and no explicit height reports
    // intrinsic=textHeight (~15), the parent Col sums that, then at paint time
    // the Box is clamped to 30 and overflows. Mirrors the clamp already applied
    // in the concrete layout pass (see clampVal calls around lines 1119/1157).
    const s = node.style;
    if (resolveMaybePct(s.min_height, availableWidth)) |mh| {
        if (result < mh) result = mh;
    }
    if (resolveMaybePct(s.max_height, availableWidth)) |mx| {
        if (result > mx) result = mx;
    }
    node._cache_ih = result;
    node._cache_ih_avail = availableWidth;
    return result;
}

fn estimateIntrinsicHeightUncached(node: *Node, availableWidth: f32) f32 {
    const s = node.style;
    if (s.height != null and s.height.? >= 0) {
        return s.height.?;
    }
    if (s.aspect_ratio != null and s.aspect_ratio.? > 0 and s.width != null) {
        if (resolveMaybePct(s.width, availableWidth)) |rw| {
            const ownW = clampVal(rw, resolveMaybePct(s.min_width, availableWidth), resolveMaybePct(s.max_width, availableWidth));
            return ownW / s.aspect_ratio.?;
        }
    }
    // Scroll containers isolate their content from intrinsic sizing.
    // Summing children of an overflow:scroll|auto box makes the box appear
    // as tall as its content, which pushes flex siblings (in a Row,
    // cross-axis is height) to grow past the viewport. Real browsers don't
    // do this — scroll boxes use their own explicit/min height, not content.
    //
    // overflow:hidden is intentionally NOT in this short-circuit. CSS
    // hidden does not establish a scrolling viewport; it just clips
    // overflow that exceeds the box's natural size. A bare overflow:hidden
    // box with no explicit height should still size to its children, then
    // clip anything that overflows that natural size. Lumping it with
    // scroll/auto produced the "card body collapses to ~padding" bug:
    // every wrap-row card hit this branch, the row decided its height was
    // ~24px (padding only), and overflow:hidden then clipped the actual
    // children that the layout pass painted at correct y offsets. If you
    // want the scroll-style isolation for a hidden box, give it an
    // explicit height/min_height/max_height — those branches handle it.
    //
    // Exception: when the box has a max_height, we DO sum children (the
    // outer estimateIntrinsicHeight wrapper then clamps to max_height). A
    // bare short-circuit here returns just padding, which a flex parent
    // uses for sibling-space allocation — but the actual layout pass
    // measures content and clamps to max_height, so the parent thinks
    // the box is ~28px tall while the box paints at ~max_height. Result:
    // siblings overlap the box. With max_height in play, both passes
    // need to agree on min(content, max_height).
    if ((s.overflow == .scroll or s.overflow == .auto) and s.max_height == null) {
        const mh = s.min_height orelse 0;
        const mhResolved = if (mh >= 0) mh else 0;
        return mhResolved + padTop(s) + padBottom(s);
    }
    const pt = padTop(s);
    const pb = padBottom(s);
    const pl = padLeft(s);
    const pr = padRight(s);
    const g = s.gap;
    const isRow = s.flex_direction == .row or s.flex_direction == .row_reverse;
    const ownW = clampVal(
        resolveMaybePct(s.width, availableWidth) orelse availableWidth,
        resolveMaybePct(s.min_width, availableWidth),
        resolveMaybePct(s.max_width, availableWidth),
    );
    const innerW = @max(0, ownW - pl - pr);
    // Input check BEFORE text — see estimateIntrinsicWidthUncached above for
    // the same reasoning. syncInputValue mirrors typed text into node.text,
    // so the text branch would otherwise wrap-measure the typed string and
    // grow the input's height by one line per ~30 typed characters.
    if (node.input_id != null) {
        return @as(f32, @floatFromInt(node.font_size)) * 1.4 + pt + pb;
    }
    if (node.text != null) {
        const m = measureNodeTextW(node, innerW);
        return m.height + pt + pb;
    }
    if (node.image_src != null) {
        const dims = measureNodeImage(node);
        return dims.height + pt + pb;
    }
    if (node.children.len == 0) {
        return pt + pb;
    }
    var total: f32 = 0;
    var maxCross: f32 = 0;
    var visibleCount: usize = 0;
    if (isRow and innerW > 0) {
        // Row: estimate each child's actual allocated width before measuring height.
        // Without this, text children get measured at full row width and don't wrap,
        // causing the row's height estimate to be too short.
        const MAX_ROW_EST = 32;
        var childWidths: [MAX_ROW_EST]f32 = undefined;
        var totalIntrinsic: f32 = 0;
        var growTotal: f32 = 0;
        var vc: usize = 0;
        for (node.children) |*child| {
            if (child.style.display == .none) continue;
            if (child.style.position == .absolute) continue;
            if (vc >= MAX_ROW_EST) break;
            // Mirror the actual layout pass's defaultBasis (line ~1703):
            // grow children with no explicit width have basis=0, so they
            // absorb free space instead of inflating totalIntrinsic. If
            // we used intrinsic here, totalIntrinsic could exceed innerW
            // and the grow branch wouldn't fire — even though the real
            // layout will give grow children all available space. The
            // recursive height measurement then runs at a slightly-off
            // allocated width (post-shrink instead of post-grow), causing
            // sub-pixel text-wrap divergence between estimate and actual.
            const cs = child.style;
            const cw = if (cs.width != null)
                (resolveMaybePct(cs.width, innerW) orelse estimateIntrinsicWidth(child))
            else if (cs.flex_grow > 0)
                @as(f32, 0)
            else
                estimateIntrinsicWidth(child);
            const cmL = marLeft(cs);
            const cmR = marRight(cs);
            childWidths[vc] = cw;
            totalIntrinsic += cw + cmL + cmR;
            growTotal += cs.flex_grow;
            vc += 1;
        }
        const rowGaps = if (vc > 1) g * @as(f32, @floatFromInt(vc - 1)) else 0;
        const freeSpace = innerW - totalIntrinsic - rowGaps;
        // Distribute free space to grow children
        if (freeSpace > 0 and growTotal > 0) {
            var ri: usize = 0;
            for (node.children) |*child| {
                if (child.style.display == .none) continue;
                if (child.style.position == .absolute) continue;
                if (ri >= vc) break;
                if (child.style.flex_grow > 0) {
                    childWidths[ri] += (child.style.flex_grow / growTotal) * freeSpace;
                }
                ri += 1;
            }
        } else if (freeSpace < 0) {
            // Mirror the actual layout pass's row-direction flex-shrink
            // (see lines ~1858-1924): when intrinsic widths overflow the
            // row, all items shrink proportionally to shrink × basis,
            // floored at min-content. Without this, grow children kept
            // their full intrinsic width here, so the recursive
            // estimateIntrinsicHeight call under-wrapped any text inside
            // (label measured at 230px on one line, then actually painted
            // at 170px on two lines). The row's height came back ~14px
            // short per wrapping label; cart/composer's input picker had
            // three wrapping labels → bottom Col overshot the rail by
            // ~46px and shoved "capture from mic" under the StatusBar.
            var totalShrinkScaled: f32 = 0;
            var si: usize = 0;
            for (node.children) |*child| {
                if (child.style.display == .none) continue;
                if (child.style.position == .absolute) continue;
                if (si >= vc) break;
                const sh = child.style.flex_shrink orelse 1.0;
                totalShrinkScaled += sh * childWidths[si];
                si += 1;
            }
            if (totalShrinkScaled > 0) {
                const overflow = -freeSpace;
                var sj: usize = 0;
                for (node.children) |*child| {
                    if (child.style.display == .none) continue;
                    if (child.style.position == .absolute) continue;
                    if (sj >= vc) break;
                    const sh = child.style.flex_shrink orelse 1.0;
                    const amount = (sh * childWidths[sj] / totalShrinkScaled) * overflow;
                    var newW = childWidths[sj] - amount;
                    const minCW = if (child.style.min_width == null)
                        computeMinContentW(child)
                    else
                        (resolveMaybePct(child.style.min_width, innerW) orelse 0);
                    if (newW < minCW) newW = minCW;
                    if (newW < 0) newW = 0;
                    childWidths[sj] = newW;
                    sj += 1;
                }
            }
        }
        // Now measure height with estimated widths
        var ri2: usize = 0;
        for (node.children) |*child| {
            if (child.style.display == .none) continue;
            if (child.style.position == .absolute) continue;
            if (ri2 >= vc) break;
            const allocW = childWidths[ri2];
            const ch = estimateIntrinsicHeight(child, allocW);
            const cmT = marTop(child.style);
            const cmB = marBottom(child.style);
            const cross = ch + cmT + cmB;
            if (cross > maxCross) maxCross = cross;
            ri2 += 1;
        }
        visibleCount = vc;
    } else {
        for (node.children) |*child| {
            if (child.style.display == .none) continue;
            // Absolute children are out-of-flow — must not contribute to the
            // parent's intrinsic main- or cross-axis size, otherwise opening
            // a position:absolute popover (model picker, tooltip) inflates the
            // anchor and pushes the rest of the page around. The wrap branch
            // below already skips abs; the simple-row + column paths above
            // and this branch were missing the filter.
            if (child.style.position == .absolute) continue;
            const ch = estimateIntrinsicHeight(child, innerW);
            const cmT = marTop(child.style);
            const cmB = marBottom(child.style);
            if (!isRow) {
                total += ch + cmT + cmB;
                visibleCount += 1;
            } else {
                const cross = ch + cmT + cmB;
                if (cross > maxCross) maxCross = cross;
            }
        }
    }
    if (!isRow) {
        const gaps = if (visibleCount > 1) g * @as(f32, @floatFromInt((visibleCount - 1))) else 0;
        return total + gaps + pt + pb;
    }
    if ((s.flex_wrap == .wrap or s.flex_wrap == .wrap_reverse) and innerW > 0) {
        // Two-pass: collect each visible child's main+cross sizes, hand the
        // main sizes to math.wrapPack, then aggregate cross-max per line.
        const MAX_WRAP_CHILDREN = 2048;
        var itemMains: [MAX_WRAP_CHILDREN]f32 = undefined;
        var itemCrosses: [MAX_WRAP_CHILDREN]f32 = undefined;
        var n: usize = 0;
        for (node.children) |*child| {
            if (child.style.display == .none) continue;
            if (child.style.position == .absolute) continue;
            if (n >= MAX_WRAP_CHILDREN) break;
            itemMains[n] = estimateIntrinsicWidth(child) + marLeft(child.style) + marRight(child.style);
            itemCrosses[n] = estimateIntrinsicHeight(child, innerW) + marTop(child.style) + marBottom(child.style);
            n += 1;
        }
        var lines: [64]math.Line = undefined;
        const numLines: usize = @intCast(math.wrapPack(itemMains[0..n], innerW, g, lines[0..]));
        var totalCross: f32 = 0;
        for (lines[0..numLines]) |ln| {
            var lineCrossMax: f32 = 0;
            const start: usize = @intCast(ln.start);
            const stop: usize = start + @as(usize, @intCast(ln.count));
            var i = start;
            while (i < stop) : (i += 1) {
                if (itemCrosses[i] > lineCrossMax) lineCrossMax = itemCrosses[i];
            }
            totalCross += lineCrossMax;
        }
        const lineGaps = if (numLines > 1) g * @as(f32, @floatFromInt(numLines - 1)) else 0;
        return totalCross + lineGaps + pt + pb;
    }
    return maxCross + pt + pb;
}

fn computeMinContentW(node: *Node) f32 {
    // CSS `min-width: auto` for flex items resolves to min-content — the smallest
    // size the content can shrink to without overflowing its own contents. The
    // explicit `width` is a stated size, not a content floor, so it must NOT
    // clamp here; flex-shrink is allowed to take a 200×80 empty box down to 0.
    const s = node.style;
    const pl = padLeft(s);
    const pr = padRight(s);
    // Input nodes BEFORE text — same hazard as estimateIntrinsicWidthUncached
    // (~1024) and estimateIntrinsicHeightUncached (~1169). syncInputValue
    // (v8_bindings_host_window.zig) mirrors the typed value into node.text,
    // but an input renders its content in a scroll/wrap viewport — the typed
    // string is NOT layout content. If it were treated as min-content, a long
    // no-space run (e.g. holding one key) becomes one giant unbreakable
    // "word", the flex basis floor (a few lines below) bumps the input up to
    // that width, and it shoves its row-siblings off-screen. An input's
    // min-content is just its padding box: it can shrink toward nothing
    // because the content scrolls/wraps inside whatever width it ends up with.
    // (Note: the placeholder is deliberately NOT measured here — it's a hint,
    // not a content floor; flooring to it would re-introduce the same class
    // of bug for a long placeholder.)
    if (node.input_id != null) {
        return pl + pr;
    }
    if (node.text != null and measureFn != null) {
        var maxWordW: f32 = 0;
        var i: usize = 0;
        while (i < node.text.?.len) {
            while (i < node.text.?.len and (node.text.?[@intCast(i)] == ' ' or node.text.?[@intCast(i)] == '\n')) : (i += 1) {}
            if (i >= node.text.?.len) {
                break;
            }
            const wordStart = i;
            while (i < node.text.?.len and node.text.?[@intCast(i)] != ' ' and node.text.?[@intCast(i)] != '\n') : (i += 1) {}
            const word = node.text.?[@intCast(wordStart)..@intCast(i)];
            const m = measureFn.?(word, node.font_size, node.font_family_id, 0, node.letter_spacing, node.line_height, node.number_of_lines, false, node.font_weight >= 600);
            if (m.width > maxWordW) {
                maxWordW = m.width;
            }
        }
        return maxWordW + pl + pr;
    }
    if (node.children.len == 0) {
        return pl + pr;
    }
    const isRow = s.flex_direction == .row or s.flex_direction == .row_reverse;
    const g = s.gap;
    var minW: f32 = 0;
    var visCount: usize = 0;
    for (node.children) |*child| {
        if (child.style.display == .none) {
            continue;
        }
        if (child.style.position == .absolute) {
            continue;
        }
        const childMin = computeMinContentW(child);
        if (isRow) {
            minW += childMin;
            visCount += 1;
        } else {
            if (asF32(childMin) > asF32(minW)) {
                minW = childMin;
            }
        }
    }
    if (isRow and visCount > 1) {
        minW += @as(f32, @floatFromInt((visCount - 1))) * g;
    }
    return minW + pl + pr;
}

// ── Flex resolver: ChildSlot bundle + helpers ──────────────────────
// Two cap constants:
//   MAX_CHILDREN — visible+absolute children PER layoutNode frame. 2048
//     was historically asserted by a stress grid, but at Debug stack
//     frames of ~120KB+ per layoutNode × deep recursion it overflowed a
//     12.5MB stack on the wrap-test fixture. 512 is still bigger than any
//     real flex container; carts exceeding it should split into rows.
//   MAX_LINES — wrap lines per container. 64 covers any plausible grid.
const MAX_CHILDREN = 512;

/// Per-flex-child measurement bundle. Collapses what used to live in nine
/// parallel `[MAX_CHILDREN]f32` arrays plus a `visibleIndices` array. The
/// CSS-order sort now swaps a child by moving one struct instead of ten
/// keyed values, and the grow/shrink resolvers read `slots[i].field`
/// directly instead of indexing into ten side-by-side arrays.
const ChildSlot = struct {
    index: usize = 0,
    basis: f32 = 0,
    grow: f32 = 0,
    shrink: f32 = 0,
    main_size: f32 = 0,
    cross_size: f32 = 0,
    main_margin_start: f32 = 0,
    main_margin_end: f32 = 0,
    cross_margin_start: f32 = 0,
    cross_margin_end: f32 = 0,
};

/// Iterative flex-grow distribution. CSS Flexbox §9.7: distribute free
/// main-axis space proportionally to each item's `flex-grow`, freeze any
/// item that hits its min/max clamp, redistribute the remainder over the
/// still-active set. Capped at 10 passes — past that an oscillating clamp
/// configuration is the only thing that could keep us iterating, and real
/// layouts converge in 1-3.
fn solveFlexGrow(
    node: *Node,
    slots: []ChildSlot,
    ls: usize,
    lc: usize,
    mainSize: f32,
    lineGaps: f32,
    totalMainMargin: f32,
    isRow: bool,
    innerW: f32,
    innerH: f32,
) void {
    var frozen = std.mem.zeroes([MAX_CHILDREN]bool);
    var savedBasis = std.mem.zeroes([MAX_CHILDREN]f32);
    {
        var i = ls;
        while (i < ls + lc) : (i += 1) {
            frozen[i] = slots[i].grow <= 0;
            savedBasis[i] = slots[i].basis;
        }
    }
    var passes: usize = 0;
    while (passes < 10) : (passes += 1) {
        var used: f32 = 0;
        var activeFlex: f32 = 0;
        {
            var i = ls;
            while (i < ls + lc) : (i += 1) {
                if (frozen[i]) {
                    used += slots[i].basis;
                } else {
                    used += savedBasis[i];
                    activeFlex += slots[i].grow;
                }
            }
        }
        if (activeFlex <= 0) return;
        const space = mainSize - used - lineGaps - totalMainMargin;
        if (space <= 0) return;
        var anyClamped = false;
        var i = ls;
        while (i < ls + lc) : (i += 1) {
            if (frozen[i]) continue;
            slots[i].basis = savedBasis[i] + (slots[i].grow / activeFlex) * space;
            const csG = &node.children[slots[i].index].style;
            const mn = resolveMaybePct(if (isRow) csG.min_width else csG.min_height, if (isRow) innerW else innerH);
            const mx = resolveMaybePct(if (isRow) csG.max_width else csG.max_height, if (isRow) innerW else innerH);
            const clampedVal = clampVal(slots[i].basis, mn, mx);
            if (clampedVal != slots[i].basis) {
                slots[i].basis = clampedVal;
                frozen[i] = true;
                anyClamped = true;
            }
        }
        if (!anyClamped) return;
    }
}

/// Absolute-positioned children pass. Runs after the in-flow layout finishes
/// so it can resolve `width: 100%` / `top+bottom` against the parent's final
/// inner box. Out-of-flow: contributes nothing to the parent's main/cross
/// extent, doesn't advance the flex cursor.
fn layoutAbsoluteChildren(
    node: *Node,
    absoluteIndices: []const usize,
    absoluteCount: usize,
    x: f32,
    y: f32,
    pl: f32,
    pt: f32,
    pb: f32,
    innerW: f32,
    resolvedH: f32,
) void {
    var ai: usize = 0;
    while (ai < absoluteCount) : (ai += 1) {
        const absIdx = absoluteIndices[@intCast(ai)];
        const absChild = &node.children[@intCast(absIdx)];
        const acs = absChild.style;
        var absW: f32 = undefined;
        const resolvedW = resolveMaybePct(acs.width, innerW);
        if (resolvedW != null) {
            absW = resolvedW.?;
        } else if (acs.left != null and acs.right != null) {
            absW = innerW - (acs.left orelse 0) - (acs.right orelse 0);
        } else {
            absW = estimateIntrinsicWidth(absChild);
        }
        absW = clampVal(absW, resolveMaybePct(acs.min_width, innerW), resolveMaybePct(acs.max_width, innerW));
        const absInnerH = resolvedH - pt - pb;
        var absH: f32 = undefined;
        const resolvedAH = resolveMaybePct(acs.height, absInnerH);
        if (resolvedAH != null) {
            absH = resolvedAH.?;
        } else if (acs.top != null and acs.bottom != null) {
            absH = absInnerH - (acs.top orelse 0) - (acs.bottom orelse 0);
        } else {
            absH = estimateIntrinsicHeight(absChild, absW);
        }
        absH = clampVal(absH, resolveMaybePct(acs.min_height, absInnerH), resolveMaybePct(acs.max_height, absInnerH));
        var absX = x + pl;
        var absY = y + pt;
        if (acs.left != null) {
            absX = x + pl + acs.left.?;
        } else if (acs.right != null) {
            absX = asF32(x + pl + innerW - absW) - asF32(acs.right);
        }
        if (acs.top != null) {
            absY = y + pt + acs.top.?;
        } else if (acs.bottom != null) {
            absY = asF32(y + pt + absInnerH - absH) - asF32(acs.bottom);
        }
        absChild._flex_w = absW;
        absChild._stretch_h = absH;
        layoutNode(absChild, absX, absY, absW, absH);
    }
}

pub fn layoutNode(node: *Node, px: f32, py: f32, pw: f32, ph: f32) void {
    layoutCount += 1;
    if (layoutCount > LAYOUT_BUDGET) {
        return;
    }
    const s = node.style;
    // Incremental-relayout bookkeeping (additive — full reflow ignores it).
    // Snapshot the call frame BEFORE _flex_w/_stretch_h are consumed below;
    // flag whether this node's outer size is content-independent (a valid
    // relayout boundary); link children to parent for the boundary walk.
    node._in_px = px;
    node._in_py = py;
    node._in_pw = pw;
    node._in_ph = ph;
    node._in_flexw = node._flex_w;
    node._in_stretchh = node._stretch_h;
    node._size_locked = (node._flex_w != null or s.width != null) and (node._stretch_h != null or s.height != null);
    for (node.children) |*c| c.parent = node;
    if (s.display == .none) {
        setRect(node, .{ .x = px, .y = py, .w = 0, .h = 0 });
        return;
    }
    // Canvas.Path: standalone (icon) paths take their box's style/parent size
    // so paintCanvasPath can scale the 24×24 viewbox to fit. Inline paths
    // (canvas_path=true) collapse — they overlay their parent.
    if (node.canvas_path) {
        setRect(node, .{ .x = px, .y = py, .w = 0, .h = 0 });
        return;
    }
    if (node.canvas_path_d != null) {
        const pin_w: f32 = node._parent_inner_w orelse 0;
        const pin_h: f32 = node._parent_inner_h orelse 0;
        const fb_w: f32 = if (s.flex_basis) |fb| fb else 0;
        const w_pref = if (s.width) |v| v else if (fb_w > 0) fb_w else if (pw > 0) pw else if (pin_w > 0) pin_w else 24;
        const h_pref = if (s.height) |v| v else if (ph > 0) ph else if (pin_h > 0) pin_h else 24;
        setRect(node, .{ .x = px, .y = py, .w = w_pref, .h = h_pref });
        return;
    }
    // Canvas.Clamp: spans full parent bounds (viewport overlay).
    if (node.canvas_clamp) {
        setRect(node, .{ .x = px, .y = py, .w = pw, .h = ph });
        for (node.children) |*child| {
            layoutNode(child, px, py, pw, ph);
        }
        return;
    }
    // Video/Render: fill parent bounds, clamped to GPU texture limit (8192).
    // The proportional fallback can produce ph=9999 which exceeds the GPU max.
    if (node.video_src != null or node.render_src != null) {
        setRect(node, .{ .x = px, .y = py, .w = @min(pw, 8192), .h = @min(ph, 8192) });
        return;
    }
    // Canvas.Node layout:
    // - gw sets width (or parent width if 0)
    // - gh>0: fixed height
    // - gh=0: auto-height — allocate generous box, layout children, measure
    //   content extent, shrink node to fit, re-layout with real height
    if (node.canvas_node) {
        const cw = if (node.canvas_gw > 0) node.canvas_gw else pw;
        if (node.canvas_gh > 0) {
            // Fixed dimensions
            setRect(node, .{ .x = px, .y = py, .w = cw, .h = node.canvas_gh });
            for (node.children) |*child| {
                layoutNode(child, px, py, cw, node.canvas_gh);
            }
        } else {
            // Auto-height: allocate big, measure content, shrink to fit
            const alloc_h: f32 = 500; // generous initial box
            setRect(node, .{ .x = px, .y = py, .w = cw, .h = alloc_h });
            for (node.children) |*child| {
                layoutNode(child, px, py, cw, alloc_h);
            }
            // Measure actual content extent (subtract dead space)
            var max_bottom: f32 = 0;
            for (node.children) |*child| {
                const bottom = (child.computed.y - py) + child.computed.h;
                if (bottom > max_bottom) max_bottom = bottom;
            }
            const content_h = if (max_bottom > 0) max_bottom else 0;
            // Shrink node to content and re-layout so % children get real height
            node.computed.h = content_h;
            node.canvas_gh = content_h;
            for (node.children) |*child| {
                layoutNode(child, px, py, cw, content_h);
            }
        }
        return;
    }
    var w: f32 = undefined;
    var h: ?f32 = null;
    if (node._flex_w != null) {
        w = node._flex_w.?;
        node._flex_w = null;
    } else {
        const resolved = resolveMaybePct(s.width, pw);
        w = if (resolved != null) resolved.? else pw;
    }
    w = clampVal(w, resolveMaybePct(s.min_width, pw), resolveMaybePct(s.max_width, pw));
    if (node._stretch_h != null) {
        h = node._stretch_h.?;
        node._stretch_h = null;
    } else {
        h = resolveMaybePct(s.height, ph);
    }
    if (h != null) {
        h.? = clampVal(h.?, resolveMaybePct(s.min_height, ph), resolveMaybePct(s.max_height, ph));
    }
    if (s.aspect_ratio != null and s.aspect_ratio.? > 0) {
        if (s.width != null and s.height == null and h == null) {
            h = w / s.aspect_ratio.?;
        } else if (s.height != null and s.width == null and node._flex_w == null) {
            if (h != null) {
                w = h.? * s.aspect_ratio.?;
                w = clampVal(w, resolveMaybePct(s.min_width, pw), resolveMaybePct(s.max_width, pw));
            }
        }
    }
    const pl = padLeft(s);
    const pr = padRight(s);
    const pt = padTop(s);
    const pb = padBottom(s);
    const ml = marLeft(s);
    const mt = marTop(s);
    const x = px + ml;
    const y = py + mt;
    const innerW = w - pl - pr;
    const autoHeight = h == null;
    // Scroll containers need TWO heights:
    // - innerH: the REAL container height (for flex distribution — children share this space)
    // - childLayoutH: unlimited (so children can overflow and be scrolled to)
    //
    // When height is indefinite, innerH must be derived from content + min/max,
    // NOT a 9999 sentinel. If 9999 flows into flex distribution, a flex-grow
    // child with flex-basis:0 eats the 9999 — producing ~10000-tall containers
    // whose centered content ends up at y≈5000. Top-down rule: every container
    // has a concrete height from parent offer or its own floor; flex-grow
    // distributes only over that concrete height's free space.
    var innerH: f32 = undefined;
    if (h != null) {
        innerH = h.? - pt - pb;
    } else {
        const intrinsic_total = estimateIntrinsicHeight(node, innerW);
        const intrinsic_inner = intrinsic_total - pt - pb;
        const min_raw = resolveMaybePct(s.min_height, ph);
        const max_raw = resolveMaybePct(s.max_height, ph);
        var v: f32 = intrinsic_inner;
        if (min_raw) |m| {
            const m_inner = m - pt - pb;
            if (v < m_inner) v = m_inner;
        }
        if (max_raw) |m| {
            const m_inner = m - pt - pb;
            if (v > m_inner) v = m_inner;
        }
        if (v < 0) v = 0;
        innerH = v;
    }
    const hasExplicitFlexSpacing = s.gap != 0 or s.row_gap != null or s.column_gap != null or s.padding != 0 or s.padding_left != null or s.padding_right != null or s.padding_top != null or s.padding_bottom != null or s.flex_wrap != .no_wrap or s.flex_direction == .row or s.flex_direction == .row_reverse;
    var onlyTextChildren = node.text == null and node.children.len > 0 and !hasExplicitFlexSpacing;
    if (onlyTextChildren) {
        var ti: usize = 0;
        while (ti < node.children.len) : (ti += 1) {
            const child = &node.children[ti];
            if (child.style.display == .none) continue;
            if (child.text == null or child.children.len != 0) {
                onlyTextChildren = false;
                break;
            }
        }
    }
    const isRow = s.flex_direction == .row or s.flex_direction == .row_reverse or onlyTextChildren;
    const isReverse = s.flex_direction == .row_reverse or s.flex_direction == .column_reverse;
    // Vertical scroll containers should preserve child heights and overflow.
    // If we shrink them to fit the viewport, content_height collapses to the
    // container height and there is nothing left to scroll.
    const preserveMainOverflow = !isRow and (s.overflow == .scroll or s.overflow == .auto);
    const gap = s.mainGap();
    const crossGapVal = s.crossGap();
    const justify = s.justify_content;
    const @"align" = s.align_items;
    const mainSize = if (isRow) innerW else innerH;
    // Stack-allocated per-flex-call child measurement bundle. See ChildSlot
    // above the function for the per-slot layout. ~80KB / frame.
    var slots: [MAX_CHILDREN]ChildSlot = undefined;
    var visibleCount: usize = 0;
    var absoluteIndices: [MAX_CHILDREN]usize = undefined;
    var absoluteCount: usize = 0;
    {
        var i: usize = 0;
        while (i < node.children.len) : (i += 1) {
            const child = &node.children[@intCast(i)];
            if (child.style.display == .none) {
                setRect(child, .{ .x = 0, .y = 0, .w = 0, .h = 0 });
                continue;
            }
            // Canvas.Node is positioned in graph space by canvas.zig's
            // positionOneCanvasNode after layout — it must NOT advance
            // the parent's flex cursor or it pushes following siblings
            // (e.g. a Canvas.Clamp HUD overlay) down by tile-height per
            // tile. Route through the absolute pass so layoutNode still
            // fires (the canvas_node branch in layoutNode sets the rect
            // from gw/gh) without the flex cursor advancing.
            if (child.style.position == .absolute or child.canvas_node) {
                if (absoluteCount < MAX_CHILDREN) {
                    absoluteIndices[@intCast(absoluteCount)] = i;
                    absoluteCount += 1;
                }
                continue;
            }
            if (visibleCount >= MAX_CHILDREN) {
                break;
            }
            const cs = child.style;
            const cw = resolveMaybePct(cs.width, innerW) orelse estimateIntrinsicWidth(child);
            const chVal = resolveMaybePct(cs.height, innerH) orelse estimateIntrinsicHeight(child, innerW);
            const cwClamped = clampVal(cw, resolveMaybePct(cs.min_width, innerW), resolveMaybePct(cs.max_width, innerW));
            const chClamped = clampVal(chVal, resolveMaybePct(cs.min_height, innerH), resolveMaybePct(cs.max_height, innerH));
            const grow = cs.flex_grow;
            const shrink = cs.flex_shrink orelse 1.0;
            // flex_grow children with no explicit size: basis=0 so they don't inflate totalBasis
            // and steal space from fixed-size siblings. They grow INTO free space, not FROM content.
            const defaultBasis = if (grow > 0 and ((isRow and cs.width == null) or (!isRow and cs.height == null)))
                @as(f32, 0)
            else
                (if (isRow) cwClamped else chClamped);
            const basis = resolveMaybePct(cs.flex_basis, if (isRow) innerW else innerH) orelse defaultBasis;
            const cmL = marLeft(cs);
            const cmR = marRight(cs);
            const cmT = marTop(cs);
            const cmB = marBottom(cs);
            slots[visibleCount] = .{
                .index = i,
                .basis = basis,
                .grow = grow,
                .shrink = shrink,
                .main_size = if (isRow) cwClamped else chClamped,
                .cross_size = if (isRow) chClamped else cwClamped,
                .main_margin_start = if (isRow) cmL else cmT,
                .main_margin_end = if (isRow) cmR else cmB,
                .cross_margin_start = if (isRow) cmT else cmL,
                .cross_margin_end = if (isRow) cmB else cmR,
            };
            visibleCount += 1;
        }
    }
    // Sort visible children by CSS order property (stable insertion sort).
    // With ChildSlot bundling, swapping a child is one struct assignment
    // instead of ten parallel keyed copies.
    if (visibleCount > 1) {
        var hasOrder = false;
        for (slots[0..visibleCount]) |sl| {
            if (node.children[sl.index].style.order != 0) {
                hasOrder = true;
                break;
            }
        }
        if (hasOrder) {
            var si: usize = 1;
            while (si < visibleCount) : (si += 1) {
                const key = slots[si];
                const keyOrder = node.children[key.index].style.order;
                var j: usize = si;
                while (j > 0 and node.children[slots[j - 1].index].style.order > keyOrder) : (j -= 1) {
                    slots[j] = slots[j - 1];
                }
                slots[j] = key;
            }
        }
    }
    const MAX_LINES = 64;
    var lines: [MAX_LINES]math.Line = undefined;
    var numLines: usize = 0;
    if ((s.flex_wrap == .wrap or s.flex_wrap == .wrap_reverse) and visibleCount > 0) {
        // Pre-aggregate per-item main sizes (basis + margins) into a contiguous
        // buffer, then delegate the greedy pack to math.wrapPack.
        var itemMains: [MAX_CHILDREN]f32 = undefined;
        var i: usize = 0;
        while (i < visibleCount) : (i += 1) {
            itemMains[i] = slots[i].basis + slots[i].main_margin_start + slots[i].main_margin_end;
        }
        numLines = @intCast(math.wrapPack(itemMains[0..visibleCount], mainSize, gap, lines[0..]));
    } else if (visibleCount > 0) {
        lines[0] = .{ .start = 0, .count = @intCast(visibleCount) };
        numLines = 1;
    }
    // wrap_reverse: reverse line order so last line appears first on cross axis
    if (s.flex_wrap == .wrap_reverse and numLines > 1) {
        var lo: usize = 0;
        var hi: usize = numLines - 1;
        while (lo < hi) {
            const tmp = lines[lo];
            lines[lo] = lines[hi];
            lines[hi] = tmp;
            lo += 1;
            hi -= 1;
        }
    }
    // Pre-compute line cross sizes for align-content distribution
    var lineCrossSizes: [MAX_LINES]f32 = undefined;
    var totalLineCross: f32 = 0;
    {
        var li: usize = 0;
        while (li < numLines) : (li += 1) {
            var lcMax: f32 = 0;
            const lls: usize = @intCast(lines[li].start);
            const llc: usize = @intCast(lines[li].count);
            var lci = lls;
            while (lci < lls + llc) : (lci += 1) {
                const cc = slots[lci].cross_size + slots[lci].cross_margin_start + slots[lci].cross_margin_end;
                if (cc > lcMax) lcMax = cc;
            }
            if (numLines == 1) {
                if (isRow and h != null) {
                    lcMax = if (h) |hv| hv - pt - pb else lcMax;
                } else if (!isRow) {
                    lcMax = innerW;
                }
            }
            lineCrossSizes[@intCast(li)] = lcMax;
            totalLineCross += lcMax;
        }
    }
    // align-content: distribute free cross space between wrapped lines
    const crossSize = if (isRow) (if (h != null) h.? - pt - pb else totalLineCross) else innerW;
    const crossGaps = if (numLines > 1) crossGapVal * @as(f32, @floatFromInt(numLines - 1)) else 0;
    const freeCross = crossSize - totalLineCross - crossGaps;
    var crossOffset: f32 = 0;
    var extraCrossGap: f32 = 0;
    if (numLines > 1 and freeCross > 0) {
        if (s.align_content == .stretch) {
            // Stretch grows each line, not the gaps — handled outside math.distribute.
            const perLine = freeCross / @as(f32, @floatFromInt(numLines));
            var sli: usize = 0;
            while (sli < numLines) : (sli += 1) {
                lineCrossSizes[@intCast(sli)] += perLine;
            }
        } else {
            const dmode: math.Distribute = switch (s.align_content) {
                .start => .start,
                .center => .center,
                .end => .end,
                .space_between => .space_between,
                .space_around => .space_around,
                .space_evenly => .space_evenly,
                .stretch => unreachable,
            };
            const d = math.distribute(dmode, freeCross, @intCast(numLines));
            crossOffset = d.offset;
            extraCrossGap = d.extra_gap;
        }
    }
    var crossCursor: f32 = crossOffset;
    var contentMainEnd: f32 = 0;
    var contentCrossEnd: f32 = 0;
    {
        var lineIdx: usize = 0;
        while (lineIdx < numLines) : (lineIdx += 1) {
            const ls: usize = @intCast(lines[lineIdx].start);
            const lc: usize = @intCast(lines[lineIdx].count);
            var totalBasis: f32 = 0;
            var totalFlex: f32 = 0;
            var totalMainMargin: f32 = 0;
            {
                var i = ls;
                while (i < ls + lc) : (i += 1) {
                    totalBasis += slots[i].basis;
                    totalMainMargin += slots[i].main_margin_start + slots[i].main_margin_end;
                    if (slots[i].grow > 0) {
                        totalFlex += slots[i].grow;
                    }
                }
            }
            const lineGaps = if (lc > 1) gap * @as(f32, @floatFromInt((lc - 1))) else 0;
            const freeSpace = mainSize - totalBasis - lineGaps - totalMainMargin;
            if (freeSpace > 0 and totalFlex > 0) {
                solveFlexGrow(node, slots[0..], ls, lc, mainSize, lineGaps, totalMainMargin, isRow, innerW, innerH);
            } else if (freeSpace < 0 and !preserveMainOverflow) {
                // Column direction min-height: auto, applied BEFORE shrink so
                // floored items don't push the container past mainSize. A
                // `flex: 1 1 0` panel in a column-flex parent has basis=0 and
                // shrink × basis = 0, so the proportional shrink alone would
                // leave it at 0 height and its content-sized sibling would eat
                // the full container. Floor basis<=0 items at their intrinsic
                // content height first, freeze them, then absorb the (now
                // larger) overflow into the remaining shrinkable items. The
                // row-direction equivalent is the post-shrink floor below;
                // doing it pre-shrink here keeps the totals balanced so the
                // panel's bottom edge — and its border-radius — lands exactly
                // at the viewport bottom rather than just past it.
                var shrinkFrozen = std.mem.zeroes([MAX_CHILDREN]bool);
                var floorAdded: f32 = 0;
                if (!isRow) {
                    var i = ls;
                    while (i < ls + lc) : (i += 1) {
                        const childIdx = slots[i].index;
                        const childNode = &node.children[@intCast(childIdx)];
                        if (childNode.style.min_height != null) continue;
                        if (slots[i].basis <= 0) {
                            const autoMinH = slots[i].main_size;
                            const maxH = resolveMaybePct(childNode.style.max_height, innerH);
                            const floorH = if (maxH != null) @min(autoMinH, maxH.?) else autoMinH;
                            if (asF32(floorH) > asF32(slots[i].basis)) {
                                floorAdded += floorH - slots[i].basis;
                                slots[i].basis = floorH;
                                shrinkFrozen[@intCast(i)] = true;
                            }
                        }
                    }
                }
                var totalShrinkScaled: f32 = 0;
                {
                    var i = ls;
                    while (i < ls + lc) : (i += 1) {
                        if (shrinkFrozen[@intCast(i)]) continue;
                        totalShrinkScaled += slots[i].shrink * slots[i].basis;
                    }
                }
                if (totalShrinkScaled > 0) {
                    const shrinkOverflow = -freeSpace + floorAdded;
                    {
                        var i = ls;
                        while (i < ls + lc) : (i += 1) {
                            if (shrinkFrozen[@intCast(i)]) continue;
                            const amount = (slots[i].shrink * slots[i].basis / totalShrinkScaled) * shrinkOverflow;
                            slots[i].basis -= amount;
                        }
                    }
                }
                if (isRow) {
                    {
                        var i = ls;
                        while (i < ls + lc) : (i += 1) {
                            const childIdx = slots[i].index;
                            const childNode = &node.children[@intCast(childIdx)];
                            if (childNode.style.min_width != null) {
                                continue;
                            }
                            const mcw = computeMinContentW(childNode);
                            if (asF32(slots[i].basis) < asF32(mcw)) {
                                slots[i].basis = mcw;
                            }
                        }
                    }
                }
            }
            if (isRow) {
                var i = ls;
                while (i < ls + lc) : (i += 1) {
                    const childIdx = slots[i].index;
                    const childNode = &node.children[@intCast(childIdx)];
                    if (childNode.style.min_width != null) {
                        continue;
                    }
                    if (slots[i].basis <= 0) {
                        const autoMinW = computeMinContentW(childNode);
                        const maxW = resolveMaybePct(childNode.style.max_width, innerW);
                        const floorW = if (maxW != null) @min(autoMinW, maxW.?) else autoMinW;
                        if (asF32(slots[i].basis) < asF32(floorW)) {
                            slots[i].basis = floorW;
                        }
                    }
                }
            } else {
                // Column direction mirror of the isRow basis<=0 floor above.
                // A `flex: 1 1 0` panel in a column-flex parent resolves to
                // basis=0 and never grows (no positive freeSpace) when a
                // content-sized sibling has already claimed the full mainSize.
                // The shrink pass leaves it at 0 because shrink × basis = 0,
                // so the panel paints at zero height and the user sees nothing.
                // Floor it at its intrinsic content height (childMainSize was
                // resolved from estimateIntrinsicHeight at innerW above) so the
                // declared grower gets its content size at minimum, the way
                // CSS min-height: auto would. Positive-basis siblings stay
                // shrunk, matching the row-direction rule.
                var i = ls;
                while (i < ls + lc) : (i += 1) {
                    const childIdx = slots[i].index;
                    const childNode = &node.children[@intCast(childIdx)];
                    if (childNode.style.min_height != null) {
                        continue;
                    }
                    if (slots[i].basis <= 0) {
                        const autoMinH = slots[i].main_size;
                        const maxH = resolveMaybePct(childNode.style.max_height, innerH);
                        const floorH = if (maxH != null) @min(autoMinH, maxH.?) else autoMinH;
                        if (asF32(slots[i].basis) < asF32(floorH)) {
                            slots[i].basis = floorH;
                        }
                    }
                }
            }
            {
                var i = ls;
                while (i < ls + lc) : (i += 1) {
                    const childIdx = slots[i].index;
                    const child = &node.children[@intCast(childIdx)];
                    if (isRow) {
                        if (child.text != null) {
                            if (child.style.height != null) continue;
                            // CSS flex: a wrappable text child can't exceed the parent's
                            // content cross-axis (innerW for both row main-axis and the
                            // wrap floor). The column branch below already clamps to
                            // innerW; mirror it here so onlyTextChildren (which forces
                            // isRow=true on a Text wrapper laying out its __TEXT__ leaf)
                            // also respects the wrap constraint. `no_wrap` opts out.
                            if (!child.no_wrap and slots[i].basis > innerW) {
                                slots[i].basis = innerW;
                                slots[i].main_size = innerW;
                            }
                            const finalW = clampVal(slots[i].basis, resolveMaybePct(child.style.min_width, innerW), resolveMaybePct(child.style.max_width, innerW));
                            const prevW = slots[i].main_size;
                            if (@abs(finalW - prevW) > 0.5) {
                                const cpl = padLeft(child.style);
                                const cpr = padRight(child.style);
                                const cpt = padTop(child.style);
                                const cpb = padBottom(child.style);
                                const constrainW = finalW - cpl - cpr;
                                const m = measureNodeTextW(child, if (constrainW > 0) constrainW else 0);
                                slots[i].cross_size = clampVal(m.height + cpt + cpb, resolveMaybePct(child.style.min_height, innerH), resolveMaybePct(child.style.max_height, innerH));
                            }
                        }
                    } else {
                        // Column: re-estimate height at actual cross-axis width for ALL auto-height children,
                        // not just direct text nodes. Nested text may wrap at narrower widths than innerW.
                        const effAlign = resolveAlign(child.style.align_self, @"align");
                        // CSS flex: an auto-cross-sized child can't exceed the parent's
                        // content cross-axis (innerW) — that's what makes a long text inside
                        // a width-constrained button wrap to multiple lines instead of
                        // bleeding out either side. `no_wrap` (white-space: nowrap) opts
                        // out, matching the browser. Explicit `width` always wins.
                        const finalW = resolveMaybePct(child.style.width, innerW) orelse blk: {
                            if (effAlign == .stretch) break :blk innerW;
                            const natural = slots[i].cross_size;
                            if (child.no_wrap) break :blk natural;
                            break :blk @min(natural, innerW);
                        };
                        // Always store the constrained cross-axis size, not just
                        // for direct-text children. A wrapper that contains text
                        // (e.g. React's <Text> host with a __TEXT__ leaf inside)
                        // has child.text == null, but it still needs to inherit
                        // the parent's innerW so its own children wrap correctly.
                        // Without this, the wrapper kept its intrinsic 160px and
                        // overflowed its 72px-inner Pressable.
                        slots[i].cross_size = finalW;
                        if (child.text != null) {
                            const cpl = padLeft(child.style);
                            const cpr = padRight(child.style);
                            const cpt = padTop(child.style);
                            const cpb = padBottom(child.style);
                            const constrainW = asF32(finalW) - asF32(cpl) - cpr;
                            const m = measureNodeTextW(child, if (constrainW > 0) constrainW else 0);
                            const newH = clampVal(m.height + cpt + cpb, resolveMaybePct(child.style.min_height, innerH), resolveMaybePct(child.style.max_height, innerH));
                            if (child.style.height == null) {
                                slots[i].basis = newH;
                                slots[i].main_size = newH;
                            }
                        }
                    }
                }
            }
            const lineCross = lineCrossSizes[@intCast(lineIdx)];
            var usedMain: f32 = 0;
            {
                var i = ls;
                while (i < ls + lc) : (i += 1) {
                    usedMain += slots[i].basis + slots[i].main_margin_start + slots[i].main_margin_end;
                }
            }
            const freeMain = mainSize - usedMain - lineGaps;
            // Auto margins: distribute free space to auto margins before justify-content
            var autoMarginCount: usize = 0;
            // Pre-scan: count auto margins even before checking freeMain
            // (needed to zero out the auto margin from usedMain calculation)
            {
                var am_pre = ls;
                while (am_pre < ls + lc) : (am_pre += 1) {
                    const am_pre_cs = node.children[slots[am_pre].index].style;
                    if (isRow) {
                        if (am_pre_cs.isMarginAutoLeft()) autoMarginCount += 1;
                        if (am_pre_cs.isMarginAutoRight()) autoMarginCount += 1;
                    } else {
                        if (am_pre_cs.isMarginAutoTop()) autoMarginCount += 1;
                        if (am_pre_cs.isMarginAutoBottom()) autoMarginCount += 1;
                    }
                }
            }

            if (freeMain > 0 and autoMarginCount > 0) {
                {
                    const perAuto = freeMain / @as(f32, @floatFromInt(autoMarginCount));
                    var am_j = ls;
                    while (am_j < ls + lc) : (am_j += 1) {
                        const am_cs = node.children[slots[am_j].index].style;
                        if (isRow) {
                            if (am_cs.isMarginAutoLeft()) slots[am_j].main_margin_start = perAuto;
                            if (am_cs.isMarginAutoRight()) slots[am_j].main_margin_end = perAuto;
                        } else {
                            if (am_cs.isMarginAutoTop()) slots[am_j].main_margin_start = perAuto;
                            if (am_cs.isMarginAutoBottom()) slots[am_j].main_margin_end = perAuto;
                        }
                    }
                }
            }
            var mainOffset: f32 = 0;
            var extraGap: f32 = 0;
            // Don't apply justify offsets when the main axis is auto-sized (h == null for columns).
            // The 9999 sentinel is not a real size — centering against it produces absurd offsets.
            const mainAxisAuto = if (isRow) false else autoHeight;
            if (!mainAxisAuto and autoMarginCount == 0) {
                const d = math.distribute(justifyToDistribute(justify), freeMain, @intCast(lc));
                mainOffset = d.offset;
                extraGap = d.extra_gap;
            }
            var cursor = if (isReverse) mainSize - mainOffset else mainOffset;
            {
                var i = ls;
                while (i < ls + lc) : (i += 1) {
                    const childIdx = slots[i].index;
                    const child = &node.children[@intCast(childIdx)];
                    var cx: f32 = undefined;
                    var cy: f32 = undefined;
                    var cwFinal: f32 = undefined;
                    var chFinal: f32 = undefined;
                    const effAlign = resolveAlign(child.style.align_self, @"align");
                    if (isRow) {
                        cwFinal = clampVal(slots[i].basis, resolveMaybePct(child.style.min_width, innerW), resolveMaybePct(child.style.max_width, innerW));
                        if (isReverse) {
                            cursor -= slots[i].main_margin_end + cwFinal;
                        }
                        // Forward: cursor sits at the child's outer-left; the
                        // recursive layoutNode adds marLeft itself (line 1177).
                        // Pre-adding here would double-apply the margin.
                        cx = x + pl + cursor;
                        chFinal = slots[i].cross_size;
                        const crossAvail = lineCross - slots[i].cross_margin_start - slots[i].cross_margin_end;
                        switch (effAlign) {
                            .center => {
                                cy = y + pt + crossCursor + @floor((crossAvail - chFinal) / 2);
                            },
                            .end => {
                                cy = y + pt + crossCursor + crossAvail - chFinal;
                            },
                            .stretch => {
                                cy = y + pt + crossCursor;
                                if (child.style.height == null) {
                                    chFinal = clampVal(crossAvail, resolveMaybePct(child.style.min_height, innerH), resolveMaybePct(child.style.max_height, innerH));
                                }
                            },
                            .baseline => {
                                // Baseline alignment: offset by ascent difference
                                // Ascent ≈ font_size * 0.8; align first text baselines
                                const childBaseline = padTop(child.style) + @as(f32, @floatFromInt(child.font_size)) * 0.8;
                                const lineBaseline = @as(f32, @floatFromInt(node.font_size)) * 0.8;
                                const maxBaseline = @max(childBaseline, lineBaseline);
                                cy = y + pt + crossCursor + (maxBaseline - childBaseline);
                            },
                            .start => {
                                cy = y + pt + crossCursor;
                            },
                        }
                    } else {
                        chFinal = clampVal(slots[i].basis, resolveMaybePct(child.style.min_height, innerH), resolveMaybePct(child.style.max_height, innerH));
                        if (isReverse) {
                            cursor -= slots[i].main_margin_end + chFinal;
                        }
                        // Forward: cursor is the child's outer-top; layoutNode
                        // applies marTop itself. Pre-adding here would double.
                        cy = y + pt + cursor;
                        cwFinal = slots[i].cross_size;
                        const crossAvail = lineCross - slots[i].cross_margin_start - slots[i].cross_margin_end;
                        switch (effAlign) {
                            .center => {
                                cx = x + pl + crossCursor + (crossAvail - cwFinal) / 2;
                            },
                            .end => {
                                cx = x + pl + crossCursor + crossAvail - cwFinal;
                            },
                            .stretch => {
                                cx = x + pl + crossCursor;
                                if (child.style.width == null) {
                                    cwFinal = clampVal(crossAvail, resolveMaybePct(child.style.min_width, innerW), resolveMaybePct(child.style.max_width, innerW));
                                }
                            },
                            .baseline => {
                                // Baseline on cross=horizontal doesn't apply; treat as start
                                cx = x + pl + crossCursor;
                            },
                            .start => {
                                cx = x + pl + crossCursor;
                            },
                        }
                    }
                    if (isRow) {
                        if (child.style.width == null or cwFinal != (child.style.width orelse 0)) {
                            child._flex_w = cwFinal;
                        }
                        if (child.style.height == null and effAlign == .stretch) {
                            child._stretch_h = chFinal;
                        } else if (child.style.height != null and child.style.height.? < 0) {
                            // Percentage height already resolved — prevent double-resolution
                            child._stretch_h = chFinal;
                        }
                    } else {
                        if (child.style.height == null and child.style.flex_grow > 0) {
                            child._stretch_h = chFinal;
                        } else if (child.style.height != null and child.style.height.? < 0) {
                            // Percentage height already resolved — prevent double-resolution
                            child._stretch_h = chFinal;
                        } else if (child.style.height != null and chFinal < (resolveMaybePct(child.style.height, innerH) orelse chFinal)) {
                            // Flex shrink: child was compressed below its explicit height
                            child._stretch_h = chFinal;
                        }
                        if (child.style.width == null and effAlign == .stretch) {
                            child._flex_w = cwFinal;
                        } else if (child.style.width != null and child.style.width.? < 0) {
                            // Percentage width already resolved — prevent double-resolution
                            child._flex_w = cwFinal;
                        }
                    }
                    if (child.style.text_align == .left and s.text_align != .left) {
                        child.style.text_align = s.text_align;
                    }
                    child._parent_inner_w = innerW;
                    child._parent_inner_h = innerH;
                    layoutNode(child, cx, cy, cwFinal, chFinal);
                    const actualMain = if (isRow) child.computed.w else child.computed.h;
                    if (isReverse) {
                        cursor -= slots[i].main_margin_start + gap + extraGap;
                    } else {
                        // Advance past the entire outer box (start margin + content + end margin).
                        // The pre-cursor addition of marginStart was removed above so the child's
                        // own layoutNode wouldn't double-apply it; we fold it back in here so the
                        // next sibling's outer-left is correctly positioned.
                        cursor += slots[i].main_margin_start + actualMain + slots[i].main_margin_end + gap + extraGap;
                    }
                    if (isRow) {
                        const me = (child.computed.x - x) + child.computed.w + slots[i].main_margin_end;
                        const ce = (child.computed.y - y) + child.computed.h + slots[i].cross_margin_end;
                        if (me > contentMainEnd) {
                            contentMainEnd = me;
                        }
                        if (ce > contentCrossEnd) {
                            contentCrossEnd = ce;
                        }
                    } else {
                        const me = (child.computed.y - y) + child.computed.h + slots[i].main_margin_end;
                        const ce = (child.computed.x - x) + child.computed.w + slots[i].cross_margin_end;
                        if (me > contentMainEnd) {
                            contentMainEnd = me;
                        }
                        if (ce > contentCrossEnd) {
                            contentCrossEnd = ce;
                        }
                    }
                }
            }
            crossCursor += lineCross + (if (lineIdx + 1 < numLines) crossGapVal + extraCrossGap else 0);
        }
    }
    if (h == null) {
        if (node.input_id != null) {
            // A height-less input is one line tall. Use the line box
            // (~1.4×font), not the bare em — font_size alone is shorter than
            // the glyphs' line height, so the text clips top/bottom and sits
            // high in the box. Matches estimateIntrinsicHeightUncached above
            // (estimate and actual layout must agree).
            h = @as(f32, @floatFromInt(node.font_size)) * 1.4 + pt + pb;
        } else if (node.text != null) {
            const m = measureNodeTextW(node, innerW);
            h = m.height + pt + pb;
        } else if (isRow) {
            h = contentCrossEnd + pb;
        } else {
            h = contentMainEnd + pb;
        }
        if (h != null) {
            h.? = clampVal(h.?, resolveMaybePct(s.min_height, ph), resolveMaybePct(s.max_height, ph));
        }
    }
    if (s.overflow == .scroll or s.overflow == .hidden or s.overflow == .auto) {
        var visual_right: f32 = 0;
        var visual_bottom: f32 = 0;
        accumulateVisibleContentExtent(node, node, &visual_right, &visual_bottom);
        const measured_width = if (isRow) contentMainEnd + pr else contentCrossEnd + pr;
        const measured_height = if (isRow) contentCrossEnd + pb else contentMainEnd + pb;
        node.content_width = @max(measured_width, visual_right + pr);
        node.content_height = @max(measured_height, visual_bottom + pb);
        // Re-clamp scroll offsets to the new content extent. Without this,
        // a route swap or filter that shrinks the list leaves scroll_y at
        // its old value — viewport renders below all items until a wheel
        // event triggers the wheel-handler's clamp. Clamping here makes
        // the next paint authoritative.
        if (s.overflow == .scroll or s.overflow == .auto) {
            const viewport_h = h orelse 0;
            const viewport_w = resolveMaybePct(s.width, pw) orelse 0;
            const max_sy = @max(0.0, node.content_height - viewport_h);
            const max_sx = @max(0.0, node.content_width - viewport_w);
            if (node.scroll_y > max_sy) node.scroll_y = max_sy;
            if (node.scroll_x > max_sx) node.scroll_x = max_sx;
        }
    }
    const resolvedH = h orelse 0;
    layoutAbsoluteChildren(node, absoluteIndices[0..], absoluteCount, x, y, pl, pt, pb, innerW, resolvedH);
    setRect(node, .{ .x = x, .y = y, .w = w, .h = resolvedH });
}

fn resolveAlign(self: AlignSelf, parent: AlignItems) AlignItems {
    switch (self) {
        .auto => {
            return parent;
        },
        .start => {
            return .start;
        },
        .center => {
            return .center;
        },
        .end => {
            return .end;
        },
        .stretch => {
            return .stretch;
        },
        .baseline => {
            return .baseline;
        },
    }
}

fn accumulateVisibleContentExtent(container: *const Node, node: *const Node, out_right: *f32, out_bottom: *f32) void {
    for (node.children) |*child| {
        if (child.style.display == .none) {
            continue;
        }

        const right = (child.computed.x - container.computed.x) + child.computed.w;
        const bottom = (child.computed.y - container.computed.y) + child.computed.h;
        if (right > out_right.*) out_right.* = right;
        if (bottom > out_bottom.*) out_bottom.* = bottom;

        if (child.style.overflow == .visible) {
            accumulateVisibleContentExtent(container, child, out_right, out_bottom);
        }
    }
}

/// Nearest size-locked ancestor of the changed node — the subtree we can reflow
/// in isolation. The changed node's own size may shift, so start at its parent
/// (siblings redistribute) and walk up to the first locked node.
fn findBoundary(changed: *Node) ?*Node {
    var n = changed.parent;
    while (n) |cur| {
        if (cur._size_locked) return cur;
        n = cur.parent;
    }
    return null; // reached the top with no locked ancestor → full pass
}

/// Replay one subtree's layout with the exact inputs its parent gave it last
/// full pass. Valid only when `b` is size-locked and the change is inside it:
/// the parent's distribution is then unaffected, so these inputs are unchanged
/// and the result is identical to a full pass — but only `b`'s subtree is touched.
fn relayoutSubtree(b: *Node) void {
    layoutCount = 0;
    invalidateTextCache();
    invalidateCaches(b); // cache reset scoped to this subtree
    g_emit_layout_pass = g_layout_dirty;
    g_layout_dirty = false;
    b._flex_w = b._in_flexw;
    b._stretch_h = b._in_stretchh;
    layoutNode(b, b._in_px, b._in_py, b._in_pw, b._in_ph);
    g_emit_layout_pass = false;
}

pub fn layout(root: *Node, x: f32, y: f32, w: f32, h: f32) void {
    // Incremental path: one marked node, a prior full pass to replay from, no
    // escalation, and the root frame unchanged (a resize forces a full pass).
    if (g_have_layout and !g_dirty_full and g_dirty_one != null and
        root._in_px == x and root._in_py == y and root._in_pw == w and root._in_ph == h)
    {
        const changed = g_dirty_one.?;
        g_dirty_one = null;
        if (findBoundary(changed)) |b| {
            relayoutSubtree(b);
            return;
        }
        // no locked ancestor → fall through to a full pass
    }
    g_dirty_one = null;
    g_dirty_full = false;
    g_have_layout = true;
    layoutCount = 0;
    invalidateTextCache();
    invalidateCaches(root);
    // Snapshot the dirty flag for this pass — setRect uses it to decide
    // whether to emit onLayout events. Cleared here so subsequent every-frame
    // passes (with no real trigger) stay silent until the next mutation.
    g_emit_layout_pass = g_layout_dirty;
    g_layout_dirty = false;
    root._flex_w = w;
    root._stretch_h = h;
    layoutNode(root, x, y, w, h);
    g_emit_layout_pass = false;
    if (log.isEnabled(.layout)) logTree(root, 0);
}

fn logTree(node: *Node, depth: u32) void {
    const name = node.debug_name orelse "?";
    const r = node.computed;
    const zero: []const u8 = if (r.w <= 0 or r.h <= 0) " <<ZERO>>" else "";
    log.info(.layout, "d={d} node={s} x={d:.0} y={d:.0} w={d:.0} h={d:.0}{s}", .{ depth, name, r.x, r.y, r.w, r.h, zero });
    for (node.children) |*child| logTree(child, depth + 1);
}

fn invalidateCaches(node: *Node) void {
    node._cache_iw = -1;
    node._cache_ih = -1;
    node._cache_ih_avail = -1;
    for (node.children) |*child| {
        invalidateCaches(child);
    }
}

// ── Telemetry ────────────────────────────────────────────────────────────

pub fn telemetryBudget() u32 {
    return LAYOUT_BUDGET;
}

pub fn telemetryBudgetUsed() u32 {
    return @intCast(layoutCount);
}
