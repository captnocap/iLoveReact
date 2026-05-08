//! ReactJIT API — types + extern function declarations for cart builds.
//!
//! This file is imported by carts instead of the full framework.
//! It compiles in milliseconds because it has NO function bodies
//! and NO imports of heavy framework modules.
//!
//! The engine .so provides all function implementations at link time.

const std = @import("std");

// ── Enums ──────────────────────────────────────────────────────────
pub const FlexDirection = enum { row, column, row_reverse, column_reverse };
pub const JustifyContent = enum { start, center, end, space_between, space_around, space_evenly };
pub const AlignItems = enum { start, center, end, stretch, baseline };
pub const AlignSelf = enum { auto, start, center, end, stretch, baseline };
pub const AlignContent = enum { start, center, end, stretch, space_between, space_around, space_evenly };
pub const FlexWrap = enum { no_wrap, wrap, wrap_reverse };
pub const Position = enum { relative, absolute };
pub const Display = enum { flex, none };
pub const Overflow = enum { visible, hidden, scroll, auto };
pub const ScrollbarSide = enum(u8) { auto, left, right, top, bottom };
pub const TextAlign = enum { left, center, right, justify };
pub const CodeLanguage = enum { none, zig, type_script, json, bash, markdown, plain };
pub const GradientDirection = enum { none, vertical, horizontal };
pub const DevtoolsViz = enum { none, sparkline, wireframe, node_tree, inspector_overlay };

// ── Color ──────────────────────────────────────────────────────────
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

// ── Gradient types (mirrors layout.zig) ────────────────────────────
pub const GradientStop = struct { offset: f32 = 0, color: Color = .{} };
pub const LinearGradient = struct {
    x1: f32 = 0,
    y1: f32 = 0,
    x2: f32 = 0,
    y2: f32 = 0,
    stops: []const GradientStop = &.{},
};

// ── Small types ────────────────────────────────────────────────────
pub const TextMetrics = struct { width: f32 = 0, height: f32 = 0, ascent: f32 = 0 };
pub const LayoutRect = struct { x: f32 = 0, y: f32 = 0, w: f32 = 0, h: f32 = 0 };
pub const ImageDims = struct { width: f32 = 0, height: f32 = 0 };
pub const InlineGlyph = struct {
    d: []const u8,
    fill: Color = Color.rgb(255, 255, 255),
    fill_effect: ?[]const u8 = null,
    stroke: Color = Color.rgba(0, 0, 0, 0),
    stroke_width: f32 = 0,
    scale: f32 = 1.0,
};
pub const InlineSlot = struct { x: f32 = 0, y: f32 = 0, size: f32 = 0, glyph_index: u8 = 0 };
pub const ColorTextSpan = struct { text: []const u8 = "", color: Color = Color.rgb(255, 255, 255) };
pub const ColorTextRow = struct { spans: []const ColorTextSpan = &.{} };
pub const MAX_INLINE_SLOTS = 8;

// ── Dependency types (inlined to avoid importing heavy modules) ────
pub const EventHandler = struct {
    on_press: ?*const fn () void = null,
    on_mouse_down: ?*const fn () void = null,
    on_mouse_move: ?*const fn () void = null,
    on_mouse_up: ?*const fn () void = null,
    on_hover_enter: ?*const fn () void = null,
    on_hover_exit: ?*const fn () void = null,
    js_on_hover_enter: ?[*:0]const u8 = null,
    lua_on_hover_enter: ?[*:0]const u8 = null,
    js_on_hover_exit: ?[*:0]const u8 = null,
    lua_on_hover_exit: ?[*:0]const u8 = null,
    on_key: ?*const fn (key: c_int, mods: u16) void = null,
    on_change_text: ?*const fn () void = null,
    on_submit: ?*const fn () void = null,
    on_scroll: ?*const fn () void = null,
    on_right_click: ?*const fn (x: f32, y: f32) void = null,
    js_on_press: ?[*:0]const u8 = null,
    js_on_mouse_down: ?[*:0]const u8 = null,
    js_on_mouse_move: ?[*:0]const u8 = null,
    js_on_mouse_up: ?[*:0]const u8 = null,
    lua_on_press: ?[*:0]const u8 = null,
    lua_on_mouse_down: ?[*:0]const u8 = null,
    lua_on_mouse_move: ?[*:0]const u8 = null,
    lua_on_mouse_up: ?[*:0]const u8 = null,
};

pub const GpuShaderDesc = struct { wgsl: []const u8 };
pub const MenuItem = struct { label: []const u8, handler: *const fn () void };

pub const EffectContext = @import("effect_ctx.zig").EffectContext;
pub const RenderFn = *const fn (*EffectContext) void;

// ── Style ──────────────────────────────────────────────────────────
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
    // See framework/layout.zig for semantics; kept in sync so the public api
    // surface matches the layout struct.
    border_dash_on: f32 = 0,
    border_dash_off: f32 = 0,
    border_flow_speed: f32 = 0,
    border_dash_width: f32 = 0,
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
};

// ── Node ───────────────────────────────────────────────────────────
pub const Node = struct {
    style: Style = .{},
    children: []Node = &.{},
    computed: LayoutRect = .{},
    text: ?[]const u8 = null,
    font_size: u16 = 16,
    text_color: ?Color = null,
    letter_spacing: f32 = 0,
    line_height: f32 = 0,
    number_of_lines: u16 = 0,
    no_wrap: bool = false,
    code_language: CodeLanguage = .none,
    image_src: ?[]const u8 = null,
    video_src: ?[]const u8 = null,
    render_src: ?[]const u8 = null,
    effect_type: ?[]const u8 = null,
    input_id: ?u8 = null,
    input_paint_text: bool = true,
    input_color_rows: ?[]const ColorTextRow = null,
    placeholder: ?[]const u8 = null,
    debug_name: ?[]const u8 = null,
    test_id: ?[]const u8 = null,
    tooltip: ?[]const u8 = null,
    href: ?[]const u8 = null,
    hoverable: bool = false,
    handlers: EventHandler = .{},
    scroll_x: f32 = 0,
    scroll_y: f32 = 0,
    scroll_persist_slot: u32 = 0,
    show_scrollbar: bool = true,
    scrollbar_side: ScrollbarSide = .auto,
    scrollbar_auto_hide: bool = true,
    scrollbar_last_activity_ms: i64 = 0,
    content_height: f32 = 0,
    content_width: f32 = 0,
    devtools_viz: DevtoolsViz = .none,
    scene3d: bool = false,
    scene3d_mesh: bool = false,
    scene3d_camera: bool = false,
    scene3d_light: bool = false,
    scene3d_group: bool = false,
    scene3d_geometry: ?[]const u8 = null,
    scene3d_light_type: ?[]const u8 = null,
    scene3d_color_r: f32 = 0.8,
    scene3d_color_g: f32 = 0.8,
    scene3d_color_b: f32 = 0.8,
    scene3d_pos_x: f32 = 0,
    scene3d_pos_y: f32 = 0,
    scene3d_pos_z: f32 = 0,
    scene3d_rot_x: f32 = 0,
    scene3d_rot_y: f32 = 0,
    scene3d_rot_z: f32 = 0,
    scene3d_scale_x: f32 = 1,
    scene3d_scale_y: f32 = 1,
    scene3d_scale_z: f32 = 1,
    scene3d_look_x: f32 = 0,
    scene3d_look_y: f32 = 0,
    scene3d_look_z: f32 = 0,
    scene3d_dir_x: f32 = 0,
    scene3d_dir_y: f32 = -1,
    scene3d_dir_z: f32 = 0,
    scene3d_fov: f32 = 60,
    scene3d_intensity: f32 = 1.0,
    scene3d_radius: f32 = 0.5,
    scene3d_tube_radius: f32 = 0.25,
    scene3d_size_x: f32 = 1,
    scene3d_size_y: f32 = 1,
    scene3d_size_z: f32 = 1,
    scene3d_show_grid: bool = false,
    scene3d_show_axes: bool = false,
    scene3d_tex_w: u32 = 0,
    scene3d_tex_h: u32 = 0,
    scene3d_tex_rgba: ?[]const u8 = null,
    physics_world_id: u8 = 0,
    physics_world: bool = false,
    physics_body: bool = false,
    physics_collider: bool = false,
    physics_body_type: u8 = 2,
    physics_x: f32 = 0,
    physics_y: f32 = 0,
    physics_angle: f32 = 0,
    physics_gravity_x: f32 = 0,
    physics_gravity_y: f32 = 980,
    physics_density: f32 = 1.0,
    physics_friction: f32 = 0.3,
    physics_restitution: f32 = 0.1,
    physics_radius: f32 = 0,
    physics_shape: u8 = 0,
    physics_body_idx: i16 = -1,
    physics_fixed_rotation: bool = false,
    physics_bullet: bool = false,
    physics_gravity_scale: f32 = 1.0,
    context_menu_items: ?[]const MenuItem = null,
    terminal: bool = false,
    terminal_font_size: u16 = 13,
    terminal_id: u8 = 0,
    graph_container: bool = false,
    canvas_id: u8 = 0,
    canvas_type: ?[]const u8 = null,
    canvas_view_x: f32 = 0,
    canvas_view_y: f32 = 0,
    canvas_view_zoom: f32 = 1.0,
    canvas_view_set: bool = false,
    canvas_drift_x: f32 = 0,
    canvas_drift_y: f32 = 0,
    canvas_drift_active: bool = false,
    canvas_auto_stacked: bool = false,
    theme_id: u8 = 0,
    canvas_node: bool = false,
    canvas_gx: f32 = 0,
    canvas_gy: f32 = 0,
    canvas_gw: f32 = 0,
    canvas_gh: f32 = 0,
    canvas_clamp: bool = false,
    canvas_path: bool = false,
    canvas_path_d: ?[]const u8 = null,
    canvas_stroke_width: f32 = 2,
    canvas_fill_color: ?Color = null,
    canvas_fill_gradient: ?LinearGradient = null,
    canvas_flow_speed: f32 = 0,
    canvas_fill_effect: ?[]const u8 = null,
    icon_name: ?[]const u8 = null,
    text_effect: ?[]const u8 = null,
    inline_glyphs: ?[]const InlineGlyph = null,
    inline_slots: [MAX_INLINE_SLOTS]InlineSlot = [_]InlineSlot{.{}} ** MAX_INLINE_SLOTS,
    inline_slot_count: u8 = 0,
    effect_render: ?RenderFn = null,
    effect_shader: ?GpuShaderDesc = null,
    effect_name: ?[]const u8 = null,
    effect_background: bool = false,
    effect_mask: bool = false,
    // Custom window chrome — borderless window drag/resize regions
    window_drag: bool = false,
    window_resize: bool = false,
    _flex_w: ?f32 = null,
    _stretch_h: ?f32 = null,
    _parent_inner_w: ?f32 = null,
    _parent_inner_h: ?f32 = null,
    _cache_iw: f32 = -1,
    _cache_ih: f32 = -1,
    _cache_ih_avail: f32 = -1,
};

// ── State extern functions (resolved from engine .so at link time) ──
pub const state = struct {
    pub extern fn rjit_state_create_slot(initial: i64) usize;
    pub extern fn rjit_state_create_slot_float(initial: f64) usize;
    pub extern fn rjit_state_create_slot_bool(initial: bool) usize;
    pub extern fn rjit_state_create_slot_string(ptr: [*]const u8, len: usize) usize;
    pub extern fn rjit_state_get_slot(id: usize) i64;
    pub extern fn rjit_state_set_slot(id: usize, val: i64) void;
    pub extern fn rjit_state_get_slot_float(id: usize) f64;
    pub extern fn rjit_state_set_slot_float(id: usize, val: f64) void;
    pub extern fn rjit_state_get_slot_bool(id: usize) bool;
    pub extern fn rjit_state_set_slot_bool(id: usize, val: bool) void;
    pub extern fn rjit_state_get_slot_string_ptr(id: usize) [*]const u8;
    pub extern fn rjit_state_get_slot_string_len(id: usize) usize;
    pub extern fn rjit_state_set_slot_string(id: usize, ptr: [*]const u8, len: usize) void;
    pub extern fn rjit_state_mark_dirty() void;
    pub extern fn rjit_state_is_dirty() bool;
    pub extern fn rjit_state_clear_dirty() void;

    // Convenience wrappers matching the current API
    pub fn createSlot(initial: i64) usize {
        return rjit_state_create_slot(initial);
    }
    pub fn createSlotFloat(initial: f64) usize {
        return rjit_state_create_slot_float(initial);
    }
    pub fn createSlotBool(initial: bool) usize {
        return rjit_state_create_slot_bool(initial);
    }
    pub fn createSlotString(s: []const u8) usize {
        return rjit_state_create_slot_string(s.ptr, s.len);
    }
    pub fn getSlot(id: usize) i64 {
        return rjit_state_get_slot(id);
    }
    pub fn setSlot(id: usize, val: i64) void {
        rjit_state_set_slot(id, val);
    }
    pub fn getSlotFloat(id: usize) f64 {
        return rjit_state_get_slot_float(id);
    }
    pub fn setSlotFloat(id: usize, val: f64) void {
        rjit_state_set_slot_float(id, val);
    }
    pub fn getSlotBool(id: usize) bool {
        return rjit_state_get_slot_bool(id);
    }
    pub fn setSlotBool(id: usize, val: bool) void {
        rjit_state_set_slot_bool(id, val);
    }
    pub fn getSlotString(id: usize) []const u8 {
        return rjit_state_get_slot_string_ptr(id)[0..rjit_state_get_slot_string_len(id)];
    }
    pub fn setSlotString(id: usize, s: []const u8) void {
        rjit_state_set_slot_string(id, s.ptr, s.len);
    }
    pub fn markDirty() void {
        rjit_state_mark_dirty();
    }
    pub fn isDirty() bool {
        return rjit_state_is_dirty();
    }
    pub fn clearDirty() void {
        rjit_state_clear_dirty();
    }
};

// ── Theme extern functions ──────────────────────────────────────────
pub const theme = struct {
    pub extern fn rjit_theme_active_variant() u8;
    pub extern fn rjit_theme_set_variant(v: u8) void;

    pub fn activeVariant() u8 {
        return rjit_theme_active_variant();
    }
    pub fn setVariant(v: u8) void {
        rjit_theme_set_variant(v);
    }
};

// ── Breakpoint extern functions ────────────────────────────────────
pub const breakpoint = struct {
    pub extern fn rjit_breakpoint_current() u8;

    pub fn current() @import("breakpoint.zig").Breakpoint {
        return @enumFromInt(rjit_breakpoint_current());
    }
};

// ── Engine extern (main loop entry point) ───────────────────────────
pub const EngineConfig = extern struct {
    title: [*:0]const u8,
    root: *Node,
    js_logic_ptr: [*]const u8,
    js_logic_len: usize,
    lua_logic_ptr: [*]const u8,
    lua_logic_len: usize,
    init: ?*const fn () void,
    tick: ?*const fn (u32) void,
    borderless: bool = false,
};

pub extern fn rjit_engine_run(config: *const EngineConfig) c_int;

pub const engine = struct {
    pub fn run(opts: anytype) !void {
        const config = EngineConfig{
            .title = opts.title,
            .root = opts.root,
            .js_logic_ptr = opts.js_logic.ptr,
            .js_logic_len = opts.js_logic.len,
            .lua_logic_ptr = opts.lua_logic.ptr,
            .lua_logic_len = opts.lua_logic.len,
            .init = opts.init,
            .tick = opts.tick,
            .borderless = if (@hasField(@TypeOf(opts), "borderless")) opts.borderless else false,
        };
        const rc = rjit_engine_run(&config);
        if (rc != 0) return error.EngineError;
    }
};

// ── Window chrome (borderless window controls) ───────────────────────
pub const window = struct {
    pub extern fn rjit_window_close() void;
    pub extern fn rjit_window_minimize() void;
    pub extern fn rjit_window_maximize() void;
    pub extern fn rjit_window_is_maximized() bool;

    pub fn close() void {
        rjit_window_close();
    }
    pub fn minimize() void {
        rjit_window_minimize();
    }
    /// Toggle maximize/restore.
    pub fn maximize() void {
        rjit_window_maximize();
    }
    pub fn isMaximized() bool {
        return rjit_window_is_maximized();
    }
};

// ── NodePool ───────────────────────────────────────────────────────
/// Dynamic arena-backed node pool. Replaces static pre-allocated Node arrays.
/// Nodes are allocated from an arena — contiguous, cache-friendly, stable pointers.
/// Call reset() before each rebuild cycle to free all nodes at once.
pub const NodePool = struct {
    arena: std.heap.ArenaAllocator,
    node_count: usize = 0,

    pub fn init(backing: std.mem.Allocator) NodePool {
        return .{ .arena = std.heap.ArenaAllocator.init(backing) };
    }

    /// Allocate a single node, return a stable pointer.
    pub fn add(self: *NodePool, node: Node) *Node {
        const slice = self.arena.allocator().alloc(Node, 1) catch @panic("NodePool: out of memory");
        slice[0] = node;
        self.node_count += 1;
        return &slice[0];
    }

    /// Copy nodes into the pool, return a stable slice.
    pub fn addSlice(self: *NodePool, nodes: []const Node) []Node {
        const slice = self.arena.allocator().alloc(Node, nodes.len) catch @panic("NodePool: out of memory");
        @memcpy(slice, nodes);
        self.node_count += nodes.len;
        return slice;
    }

    /// Allocate N zero-initialized nodes, return a stable slice to fill in.
    pub fn allocChildren(self: *NodePool, n: usize) []Node {
        const slice = self.arena.allocator().alloc(Node, n) catch @panic("NodePool: out of memory");
        for (slice) |*s| s.* = .{};
        self.node_count += n;
        return slice;
    }

    /// Free all nodes at once. O(1). Call before each rebuild cycle.
    pub fn reset(self: *NodePool) void {
        _ = self.arena.reset(.retain_capacity);
        self.node_count = 0;
    }

    /// How many nodes are currently live in the pool.
    pub fn count(self: NodePool) usize {
        return self.node_count;
    }

    pub fn deinit(self: *NodePool) void {
        self.arena.deinit();
    }
};

// ── QJS Runtime extern ──────────────────────────────────────────────
pub const qjs_runtime = struct {
    pub extern fn rjit_qjs_register_host_fn(name: [*:0]const u8, fn_ptr: ?*const anyopaque, argc: u8) void;
    pub extern fn rjit_qjs_call_global(name: [*:0]const u8) void;
    pub extern fn rjit_qjs_call_global_str(name: [*:0]const u8, arg: [*:0]const u8) void;
    pub extern fn rjit_qjs_call_global_int(name: [*:0]const u8, arg: i64) void;
    pub extern fn rjit_qjs_eval_expr(expr: [*:0]const u8) void;
    pub extern fn rjit_qjs_eval_to_string(expr: [*]const u8, expr_len: usize, buf: [*]u8, buf_len: usize) usize;
    pub extern fn rjit_qjs_eval_lua_map_data(index: usize, expr: [*]const u8, expr_len: usize) void;
    pub extern fn rjit_qjs_sync_scalar_to_lua(name: [*:0]const u8) void;
    pub extern fn rjit_qjs_sync_lua_to_qjs(name: [*:0]const u8) void;

    pub fn registerHostFn(name: [*:0]const u8, fn_ptr: ?*const anyopaque, argc: u8) void {
        rjit_qjs_register_host_fn(name, fn_ptr, argc);
    }
    pub fn callGlobal(name: [*:0]const u8) void {
        rjit_qjs_call_global(name);
    }
    pub fn callGlobalStr(name: [*:0]const u8, arg: [*:0]const u8) void {
        rjit_qjs_call_global_str(name, arg);
    }
    pub fn callGlobalInt(name: [*:0]const u8, arg: i64) void {
        rjit_qjs_call_global_int(name, arg);
    }
    pub fn evalExpr(expr: [*:0]const u8) void {
        rjit_qjs_eval_expr(expr);
    }
    pub fn evalToString(code: []const u8, buf: *[256]u8) []const u8 {
        const n = rjit_qjs_eval_to_string(code.ptr, code.len, buf, 256);
        return buf[0..n];
    }
    pub fn evalLuaMapData(index: usize, expr: []const u8) void {
        rjit_qjs_eval_lua_map_data(index, expr.ptr, expr.len);
    }
    pub fn syncScalarToLua(name: [*:0]const u8) void {
        rjit_qjs_sync_scalar_to_lua(name);
    }
    pub fn syncLuaToQjs(name: [*:0]const u8) void {
        rjit_qjs_sync_lua_to_qjs(name);
    }
};

// ── LuaJIT Runtime extern ──────────────────────────────────────────
pub const luajit_runtime = struct {
    pub extern fn rjit_lua_call_global(name: [*:0]const u8) void;
    pub extern fn rjit_lua_set_map_wrapper(index: usize, ptr: *anyopaque) void;
    pub extern fn rjit_lua_register_host_fn(name: [*:0]const u8, func: ?*const anyopaque, argc: c_int) void;
    pub extern fn rjit_lua_set_global_int(name: [*:0]const u8, val: i64) void;
    pub extern fn rjit_lua_set_effect_render(id: usize, fn_ptr: ?*const anyopaque) void;
    pub extern fn rjit_lua_set_effect_shader(id: usize, shader_ptr: ?*const anyopaque) void;

    pub fn callGlobal(name: [*:0]const u8) void {
        rjit_lua_call_global(name);
    }
    pub fn setMapWrapper(index: usize, ptr: *anyopaque) void {
        rjit_lua_set_map_wrapper(index, ptr);
    }
    pub fn registerHostFn(name: [*:0]const u8, func: ?*const anyopaque, argc: c_int) void {
        rjit_lua_register_host_fn(name, func, argc);
    }
    pub fn setGlobalInt(name: [*:0]const u8, val: i64) void {
        rjit_lua_set_global_int(name, val);
    }
    pub fn setEffectRender(id: usize, fn_ptr: *const anyopaque) void {
        rjit_lua_set_effect_render(id, fn_ptr);
    }
    pub fn setEffectShader(id: usize, shader_ptr: *const anyopaque) void {
        rjit_lua_set_effect_shader(id, shader_ptr);
    }
};
