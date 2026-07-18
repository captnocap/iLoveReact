//! framework/host_props.zig — the shared JSON-prop→Node parser.
//!
//! Used by every host shell that consumes the React reconciler's
//! CREATE/APPEND/UPDATE batch:
//!
//!   - v8_app.zig          (GPU host, full surface; provides latch +
//!                          transition hooks for animatable props)
//!   - v8_tui_app.zig      (TUI host, paints <Window>/<Notification>
//!                          subtrees via SDL3; no hooks needed)
//!
//! Numbers in style props are **pixels**, uniformly, on both shells. The
//! terminal rasterizer (tui/host.ts) is responsible for quantizing
//! computed pixel rects to its cell grid — *that* divide is the only
//! place the "cells vs pixels" distinction exists. By the time prop
//! values reach this parser, they're numbers in one coordinate system.
//!
//! Two GPU-host-only concerns aren't generic enough to live here:
//!   1. Latches (`style.width = "latch:KEY"`) — the framework has no
//!      latch registry; the v8_app shell does. Hook callback below.
//!   2. Transitions (animating width/opacity/rotation/etc. through
//!      framework/gpu/transition.zig) — same shape, hook callback.
//!
//! Both hooks are optional. When unset, the parser does the plain
//! "parse the number, write to node.style.X" path.
//!
//! Things this file does NOT handle:
//!   - Input slots (onChangeText/onSubmit/value plumbing — v8_app owns
//!     the input slot registry).
//!   - Image src / render_src / staticSurface* / contentHandle (g_alloc
//!     dupes + content store integration).
//!   - linearGradient parsing / colorRows / contextMenuItems / inlineGlyphs
//!     (GPU-host heavyweight props).
//!   - canvas_*, graph_*, effect_*, physics_*, transition_*, animation_*,
//!     videoSrc, render_suspended (paint backends not present in TUI).
//!   - Terminal-specific `session` / `shell` props (v8_app owns the
//!     handler; the TUI host already gets these via runtime/primitives
//!     and forwards through tui/host.ts).
//!
//! Callers iterate the prop object themselves and call `applyProp` on
//! each entry. The parser returns whether the prop was consumed; callers
//! handle unconsumed keys with their own extension logic.

const std = @import("std");
const layout = @import("layout.zig");
const easing_mod = @import("math/easing.zig");

const Node = layout.Node;
const Color = layout.Color;

// ── Unit scaling ────────────────────────────────────────────────────
//
// Module-level multiplier applied to pixel-typed numeric reads
// (dimensions, padding, gap, border widths, etc.). The GPU host leaves
// this at 1.0 — its carts author in pixels. The TUI <Window> subtree
// flips it to 8.0 around its applyProps call so cell-authored carts
// (padding: 1 = one cell-height) keep working when the same JSX renders
// to a real SDL3 window. Percents (negative fractions) are NEVER scaled
// — they resolve against parent extent at layout time. Unit-less reads
// (flexGrow, opacity, rotation, fontSize, zIndex) bypass the scale by
// using plain `jsonFloat` / `jsonInt`.
//
// Long-term direction: TUI carts move to pixel-units (or tui/host.ts
// quantizes pixels → cells) and this scale dies. Tracked as a follow-up;
// the parameter is the bridge in the meantime.
var g_scale: f32 = 1.0;

pub fn setScale(s: f32) void {
    g_scale = if (s > 0) s else 1.0;
}

// ── JS handler expression pool ─────────────────────────────────────
//
// CREATE/UPDATE installs a null-terminated `__dispatchEvent(id,'name')`
// string on each Node's handler slot. The string outlives any single
// frame, so it has to live on a heap that's not arena-reset. The
// pool is process-lifetime; entries are tiny (~30 bytes) and never
// freed individually. Both shells share one pool so a node mutated by
// the GPU host AND queried by the TUI Window paint side never sees a
// stale pointer.

var g_handler_pool: std.ArrayList([:0]u8) = .empty;
var g_pool_alloc: ?std.mem.Allocator = null;

pub fn initHandlerPool(alloc: std.mem.Allocator) void {
    g_pool_alloc = alloc;
}

fn poolAllocator() std.mem.Allocator {
    return g_pool_alloc orelse std.heap.c_allocator;
}

pub fn installJsExpr(comptime expr_fmt: []const u8, id: u32) ?[*:0]const u8 {
    const alloc = poolAllocator();
    const s = std.fmt.allocPrint(alloc, expr_fmt, .{id}) catch return null;
    const sz: [:0]u8 = s[0 .. s.len - 1 :0];
    g_handler_pool.append(alloc, sz) catch {};
    return sz.ptr;
}

// ── Handler-name lookups against the reconciler's handlerNames array ──

pub fn cmdHasHandlerName(cmd: std.json.Value, name: []const u8) bool {
    const names_v = if (cmd == .object) cmd.object.get("handlerNames") else null;
    if (names_v == null or names_v.? != .array) return false;
    for (names_v.?.array.items) |entry| {
        if (entry == .string and std.mem.eql(u8, entry.string, name)) return true;
    }
    return false;
}

pub fn cmdHasAnyHandlerName(cmd: std.json.Value, comptime names: []const []const u8) bool {
    inline for (names) |name| {
        if (cmdHasHandlerName(cmd, name)) return true;
    }
    return false;
}

/// CREATE/UPDATE hook: install the six mouse/click/hover JS-eval expression
/// pointers on the Node based on which handler names the reconciler attached.
/// Both GPU and TUI-Window shells call this; the GPU shell additionally
/// handles onScroll/onRightClick/onMove/onRender/onLayout (those refer to
/// shell-specific dispatch callbacks).
pub fn applyMouseHandlerFlags(node: *Node, id: u32, cmd: std.json.Value) void {
    node.handlers.js_on_press = null;
    node.handlers.js_on_middle_click = null;
    node.handlers.js_on_mouse_down = null;
    node.handlers.js_on_mouse_move = null;
    node.handlers.js_on_mouse_up = null;
    node.handlers.js_on_hover_enter = null;
    node.handlers.js_on_hover_exit = null;
    node.handlers.js_on_scroll = null;
    if (cmdHasAnyHandlerName(cmd, &.{ "onClick", "onPress" })) {
        node.handlers.js_on_press = installJsExpr("__dispatchEvent({d},'onClick')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onMouseDown", "onPointerDown", "onPressIn" })) {
        node.handlers.js_on_mouse_down = installJsExpr("__dispatchEvent({d},'onMouseDown')\x00", id);
    }
    // Middle button: the engine's SDL_BUTTON_MIDDLE branch dispatches this
    // directly (it never enters the LEFT-only capture pipeline) — carts that
    // need a middle-drag poll getMouseButtons() from the handler (req_2704).
    if (cmdHasHandlerName(cmd, "onMiddleClick")) {
        node.handlers.js_on_middle_click = installJsExpr("__dispatchEvent({d},'onMiddleClick')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onMouseMove", "onPointerMove" })) {
        node.handlers.js_on_mouse_move = installJsExpr("__dispatchEvent({d},'onMouseMove')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onMouseUp", "onPointerUp", "onPressOut" })) {
        node.handlers.js_on_mouse_up = installJsExpr("__dispatchEvent({d},'onMouseUp')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onHoverEnter", "onMouseEnter" })) {
        node.handlers.js_on_hover_enter = installJsExpr("__dispatchEvent({d},'onHoverEnter')\x00", id);
    }
    if (cmdHasAnyHandlerName(cmd, &.{ "onHoverExit", "onMouseLeave" })) {
        node.handlers.js_on_hover_exit = installJsExpr("__dispatchEvent({d},'onHoverExit')\x00", id);
    }
    // onScroll: the GPU shell delivers the raw wheel delta to JS via
    // __dispatchScroll(id) (which reads the prepared scroll payload). A node
    // with onScroll need NOT be a scroll container — a transparent overlay
    // can opt into the wheel to drive a 3D camera dolly, a zoomable surface,
    // etc. The wheel handler in engine.zig hit-tests js_on_scroll as a
    // fallback when no scroll container captured the event.
    if (cmdHasHandlerName(cmd, "onScroll")) {
        node.handlers.js_on_scroll = installJsExpr("__dispatchScroll({d})\x00", id);
    }
}

pub fn getScale() f32 {
    return g_scale;
}

fn scaledFloat(v: std.json.Value) ?f32 {
    return if (jsonFloat(v)) |f| f * g_scale else null;
}

fn scaledMaybePct(v: std.json.Value) ?f32 {
    return switch (v) {
        .integer => |i| @as(f32, @floatFromInt(i)) * g_scale,
        .float => |f| @as(f32, @floatCast(f)) * g_scale,
        .string => |s| blk: {
            const t = std.mem.trim(u8, s, " \t\r\n");
            if (t.len == 0) break :blk null;
            if (std.mem.endsWith(u8, t, "%")) {
                const pct = std.fmt.parseFloat(f32, t[0 .. t.len - 1]) catch break :blk null;
                break :blk -(pct / 100.0);
            }
            // Bare numeric string ("18") — same scaling as integer/float.
            const n = std.fmt.parseFloat(f32, t) catch break :blk null;
            break :blk n * g_scale;
        },
        else => null,
    };
}

fn scaledSpacing(v: std.json.Value) ?f32 {
    return switch (v) {
        .string => |s| blk: {
            const t = std.mem.trim(u8, s, " \t\r\n");
            if (std.mem.eql(u8, t, "auto")) break :blk std.math.inf(f32);
            if (std.mem.endsWith(u8, t, "%")) {
                const pct = std.fmt.parseFloat(f32, t[0 .. t.len - 1]) catch break :blk null;
                break :blk -(pct / 100.0);
            }
            const n = parseStringFloat(t) orelse break :blk null;
            break :blk n * g_scale;
        },
        else => scaledFloat(v),
    };
}

// ── Hooks for shell-specific extensions ─────────────────────────────

pub const Hooks = struct {
    /// Called for the 6 latch-aware dimension keys (width, height, top,
    /// left, right, bottom) BEFORE the default jsonMaybePct path. The
    /// shell decides whether the value is a `latch:X` token and routes
    /// accordingly. Return true if the value was consumed; false to fall
    /// back to the default `style.<field> = jsonMaybePct(val)` write.
    on_dimension: ?*const fn (node: *Node, key: []const u8, val: std.json.Value) bool = null,

    /// Called for animatable visual keys (backgroundColor, opacity, rotation,
    /// scaleX, scaleY, plus transform.rotate) BEFORE the default write,
    /// only when the caller indicates `is_update`. Return true to consume.
    on_animatable: ?*const fn (node: *Node, key: []const u8, val: std.json.Value) bool = null,

    /// Called when a `transition: { all: {...} }` block is encountered.
    /// The shell installs the transition state on the node. Return true
    /// to consume.
    on_transition: ?*const fn (node: *Node, val: std.json.Value) bool = null,
};

// ── JSON value helpers ──────────────────────────────────────────────

pub fn jsonFloat(v: std.json.Value) ?f32 {
    return switch (v) {
        .integer => |i| @floatFromInt(i),
        .float => |f| @floatCast(f),
        else => null,
    };
}

pub fn jsonInt(v: std.json.Value) ?i64 {
    return switch (v) {
        .integer => |i| i,
        .float => |f| @trunc(f),
        else => null,
    };
}

/// JSX idiom is `hoverable={1}` / `noWrap={0}` — accept bool or numeric 0/1
/// so carts don't have to care which literal the reconciler happens to emit.
pub fn jsonBool(v: std.json.Value) ?bool {
    return switch (v) {
        .bool => |b| b,
        .integer => |i| i != 0,
        .float => |f| f != 0,
        else => null,
    };
}

fn parseStringFloat(s: []const u8) ?f32 {
    const t = std.mem.trim(u8, s, " \t\r\n");
    if (t.len == 0) return null;
    return std.fmt.parseFloat(f32, t) catch null;
}

/// Numbers pass through verbatim. Strings ending in '%' parse as the
/// project-convention "negative fraction" (layout.zig:resolveMaybePct
/// expands these against the parent extent). Bare numeric strings parse
/// as plain pixels.
pub fn jsonMaybePct(v: std.json.Value) ?f32 {
    return switch (v) {
        .integer => |i| @floatFromInt(i),
        .float => |f| @floatCast(f),
        .string => |s| blk: {
            const t = std.mem.trim(u8, s, " \t\r\n");
            if (t.len == 0) break :blk null;
            if (std.mem.endsWith(u8, t, "%")) {
                const pct = std.fmt.parseFloat(f32, t[0 .. t.len - 1]) catch break :blk null;
                break :blk -(pct / 100.0);
            }
            break :blk std.fmt.parseFloat(f32, t) catch null;
        },
        else => null,
    };
}

/// Margin/spacing accepts an "auto" sentinel (= +inf) in addition to the
/// usual number/percent.
pub fn jsonSpacing(v: std.json.Value) ?f32 {
    return switch (v) {
        .string => |s| blk: {
            const t = std.mem.trim(u8, s, " \t\r\n");
            if (std.mem.eql(u8, t, "auto")) break :blk std.math.inf(f32);
            if (std.mem.endsWith(u8, t, "%")) {
                const pct = std.fmt.parseFloat(f32, t[0 .. t.len - 1]) catch break :blk null;
                break :blk -(pct / 100.0);
            }
            break :blk parseStringFloat(t);
        },
        else => jsonFloat(v),
    };
}

// ── Color parsing ───────────────────────────────────────────────────

fn parseHex(s: []const u8) ?Color {
    if (s.len < 4 or s[0] != '#') return null;
    const body = s[1..];
    if (body.len == 3) {
        const r = std.fmt.parseInt(u8, body[0..1], 16) catch return null;
        const g = std.fmt.parseInt(u8, body[1..2], 16) catch return null;
        const b = std.fmt.parseInt(u8, body[2..3], 16) catch return null;
        return Color.rgb(r * 17, g * 17, b * 17);
    }
    if (body.len == 6) {
        const r = std.fmt.parseInt(u8, body[0..2], 16) catch return null;
        const g = std.fmt.parseInt(u8, body[2..4], 16) catch return null;
        const b = std.fmt.parseInt(u8, body[4..6], 16) catch return null;
        return Color.rgb(r, g, b);
    }
    if (body.len == 8) {
        const r = std.fmt.parseInt(u8, body[0..2], 16) catch return null;
        const g = std.fmt.parseInt(u8, body[2..4], 16) catch return null;
        const b = std.fmt.parseInt(u8, body[4..6], 16) catch return null;
        const a = std.fmt.parseInt(u8, body[6..8], 16) catch return null;
        return Color.rgba(r, g, b, a);
    }
    return null;
}

fn parseRgb(s: []const u8) ?Color {
    var i: usize = 0;
    while (i < s.len and s[i] != '(') i += 1;
    if (i >= s.len or s[s.len - 1] != ')') return null;
    const body = s[i + 1 .. s.len - 1];
    var it = std.mem.splitScalar(u8, body, ',');
    var parts: [4]u8 = .{ 0, 0, 0, 255 };
    var idx: usize = 0;
    while (it.next()) |p| : (idx += 1) {
        if (idx >= 4) break;
        const t = std.mem.trim(u8, p, " \t");
        const v = std.fmt.parseFloat(f32, t) catch continue;
        // CSS alpha is 0..1; rgb channels are 0..255.
        const scaled = if (idx == 3) v * 255.0 else v;
        const clamped = @max(@min(scaled, 255.0), 0.0);
        parts[idx] = @trunc(clamped);
    }
    return Color.rgba(parts[0], parts[1], parts[2], parts[3]);
}

pub fn parseColor(s: []const u8) ?Color {
    if (s.len == 0) return null;
    if (s[0] == '#') return parseHex(s);
    if (std.mem.startsWith(u8, s, "rgb")) return parseRgb(s);
    const eq = std.mem.eql;
    if (eq(u8, s, "black")) return Color.rgb(0, 0, 0);
    if (eq(u8, s, "white")) return Color.rgb(255, 255, 255);
    if (eq(u8, s, "red")) return Color.rgb(220, 50, 50);
    if (eq(u8, s, "blue")) return Color.rgb(70, 130, 230);
    if (eq(u8, s, "green")) return Color.rgb(60, 190, 100);
    if (eq(u8, s, "yellow")) return Color.rgb(240, 210, 60);
    if (eq(u8, s, "cyan")) return Color.rgb(70, 210, 230);
    if (eq(u8, s, "magenta")) return Color.rgb(220, 80, 200);
    if (eq(u8, s, "transparent")) return Color.rgba(0, 0, 0, 0);
    return null;
}

// ── String-keyword enum parsers ─────────────────────────────────────

pub fn parseOverflow(s: []const u8) layout.Overflow {
    if (std.mem.eql(u8, s, "hidden")) return .hidden;
    if (std.mem.eql(u8, s, "scroll")) return .scroll;
    if (std.mem.eql(u8, s, "auto")) return .auto;
    return .visible;
}

pub fn parseScrollbarSide(s: []const u8) layout.ScrollbarSide {
    if (std.mem.eql(u8, s, "left") or std.mem.eql(u8, s, "start")) return .left;
    if (std.mem.eql(u8, s, "right") or std.mem.eql(u8, s, "end")) return .right;
    if (std.mem.eql(u8, s, "top")) return .top;
    if (std.mem.eql(u8, s, "bottom")) return .bottom;
    return .auto;
}

pub fn parseDisplay(s: []const u8) layout.Display {
    if (std.mem.eql(u8, s, "none")) return .none;
    return .flex;
}

pub fn parsePosition(s: []const u8) layout.Position {
    if (std.mem.eql(u8, s, "absolute")) return .absolute;
    return .relative;
}

pub fn parseTextAlign(s: []const u8) layout.TextAlign {
    if (std.mem.eql(u8, s, "center")) return .center;
    if (std.mem.eql(u8, s, "right")) return .right;
    if (std.mem.eql(u8, s, "justify")) return .justify;
    return .left;
}

pub fn parseAlignItems(s: []const u8) layout.AlignItems {
    if (std.mem.eql(u8, s, "center")) return .center;
    if (std.mem.eql(u8, s, "flex-start") or std.mem.eql(u8, s, "start")) return .start;
    if (std.mem.eql(u8, s, "flex-end") or std.mem.eql(u8, s, "end")) return .end;
    if (std.mem.eql(u8, s, "baseline")) return .baseline;
    return .stretch;
}

pub fn parseAlignSelf(s: []const u8) layout.AlignSelf {
    if (std.mem.eql(u8, s, "center")) return .center;
    if (std.mem.eql(u8, s, "flex-start") or std.mem.eql(u8, s, "start")) return .start;
    if (std.mem.eql(u8, s, "flex-end") or std.mem.eql(u8, s, "end")) return .end;
    if (std.mem.eql(u8, s, "stretch")) return .stretch;
    if (std.mem.eql(u8, s, "baseline")) return .baseline;
    return .auto;
}

pub fn parseAlignContent(s: []const u8) layout.AlignContent {
    if (std.mem.eql(u8, s, "center")) return .center;
    if (std.mem.eql(u8, s, "flex-start") or std.mem.eql(u8, s, "start")) return .start;
    if (std.mem.eql(u8, s, "flex-end") or std.mem.eql(u8, s, "end")) return .end;
    if (std.mem.eql(u8, s, "space-between") or std.mem.eql(u8, s, "spaceBetween")) return .space_between;
    if (std.mem.eql(u8, s, "space-around")) return .space_around;
    if (std.mem.eql(u8, s, "space-evenly")) return .space_evenly;
    return .stretch;
}

pub fn parseEasingName(s: []const u8) easing_mod.EasingType {
    const eq = std.mem.eql;
    if (eq(u8, s, "linear")) return .linear;
    if (eq(u8, s, "easeIn")) return .ease_in;
    if (eq(u8, s, "easeOut")) return .ease_out;
    if (eq(u8, s, "easeInOut")) return .ease_in_out;
    return .ease_in_out;
}

// ── Font family resolution ──────────────────────────────────────────

pub fn fontFamilyIdFor(raw: []const u8) u8 {
    var first = raw;
    if (std.mem.indexOfScalar(u8, raw, ',')) |comma| first = raw[0..comma];
    first = std.mem.trim(u8, first, " \t\r\n\"'");
    if (first.len == 0) return 0;

    var buf: [96]u8 = undefined;
    const n = @min(first.len, buf.len);
    for (first[0..n], 0..) |ch, i| buf[i] = std.ascii.toLower(ch);
    const s = buf[0..n];

    if (std.mem.eql(u8, s, "serif") or std.mem.indexOf(u8, s, "times") != null or std.mem.indexOf(u8, s, "roman") != null) return 2;
    if (std.mem.eql(u8, s, "monospace") or std.mem.indexOf(u8, s, "mono") != null or std.mem.indexOf(u8, s, "courier") != null) return 3;
    if (std.mem.indexOf(u8, s, "noto") != null) return 4;
    if (std.mem.indexOf(u8, s, "arial") != null or std.mem.indexOf(u8, s, "helvetica") != null or std.mem.indexOf(u8, s, "liberation sans") != null) return 5;
    if (std.mem.indexOf(u8, s, "segoe") != null or std.mem.indexOf(u8, s, "ubuntu") != null or std.mem.indexOf(u8, s, "sf pro") != null or std.mem.indexOf(u8, s, "inter") != null) return 6;
    if (std.mem.indexOf(u8, s, "roboto") != null or std.mem.indexOf(u8, s, "quicksand") != null) return 7;
    if (std.mem.eql(u8, s, "sans-serif") or std.mem.indexOf(u8, s, "dejavu sans") != null) return 1;
    return 0;
}

// ── Style entry applier ─────────────────────────────────────────────

/// Apply one `style.<key> = <val>` pair to the node. Returns true if the
/// key was recognized (even if the value was malformed and silently
/// ignored). Callers iterate the style object and pass each entry here;
/// keys this function doesn't know about return false so the caller can
/// route them to its own extension logic (gradients, image src, etc.).
pub fn applyStyleEntry(
    node: *Node,
    key: []const u8,
    val: std.json.Value,
    is_update: bool,
    hooks: Hooks,
) bool {
    const eq = std.mem.eql;

    // Latch-aware dimensions — give the shell first crack at "latch:X" strings.
    if (eq(u8, key, "width")) {
        if (hooks.on_dimension) |h| {
            if (h(node, key, val)) return true;
        }
        if (scaledMaybePct(val)) |f| node.style.width = f;
        return true;
    }
    if (eq(u8, key, "height")) {
        if (hooks.on_dimension) |h| {
            if (h(node, key, val)) return true;
        }
        if (scaledMaybePct(val)) |f| node.style.height = f;
        return true;
    }
    if (eq(u8, key, "top")) {
        if (hooks.on_dimension) |h| {
            if (h(node, key, val)) return true;
        }
        if (scaledMaybePct(val)) |f| node.style.top = f;
        return true;
    }
    if (eq(u8, key, "left")) {
        if (hooks.on_dimension) |h| {
            if (h(node, key, val)) return true;
        }
        if (scaledMaybePct(val)) |f| node.style.left = f;
        return true;
    }
    if (eq(u8, key, "right")) {
        if (hooks.on_dimension) |h| {
            if (h(node, key, val)) return true;
        }
        if (scaledMaybePct(val)) |f| node.style.right = f;
        return true;
    }
    if (eq(u8, key, "bottom")) {
        if (hooks.on_dimension) |h| {
            if (h(node, key, val)) return true;
        }
        if (scaledMaybePct(val)) |f| node.style.bottom = f;
        return true;
    }

    // Min/max dimensions
    if (eq(u8, key, "minWidth")) {
        if (scaledMaybePct(val)) |f| node.style.min_width = f;
        return true;
    }
    if (eq(u8, key, "maxWidth")) {
        if (scaledMaybePct(val)) |f| node.style.max_width = f;
        return true;
    }
    if (eq(u8, key, "minHeight")) {
        if (scaledMaybePct(val)) |f| node.style.min_height = f;
        return true;
    }
    if (eq(u8, key, "maxHeight")) {
        if (scaledMaybePct(val)) |f| node.style.max_height = f;
        return true;
    }

    // Flex
    if (eq(u8, key, "flexDirection")) {
        if (val == .string) {
            const s = val.string;
            if (eq(u8, s, "row")) {
                node.style.flex_direction = .row;
            } else if (eq(u8, s, "row-reverse")) {
                node.style.flex_direction = .row_reverse;
            } else if (eq(u8, s, "column-reverse")) {
                node.style.flex_direction = .column_reverse;
            } else {
                node.style.flex_direction = .column;
            }
        }
        return true;
    }
    if (eq(u8, key, "flex")) {
        // CSS shorthand: `flex: N` ≡ `flex: N 1 0%` → flexGrow=N, flexShrink=1, flexBasis=0.
        if (jsonFloat(val)) |f| {
            node.style.flex_grow = f;
            node.style.flex_shrink = 1;
            node.style.flex_basis = 0;
        }
        return true;
    }
    if (eq(u8, key, "flexGrow")) {
        if (jsonFloat(val)) |f| node.style.flex_grow = f;
        return true;
    }
    if (eq(u8, key, "flexShrink")) {
        if (jsonFloat(val)) |f| node.style.flex_shrink = f;
        return true;
    }
    if (eq(u8, key, "flexBasis")) {
        if (scaledMaybePct(val)) |f| node.style.flex_basis = f;
        return true;
    }
    if (eq(u8, key, "order")) {
        if (jsonInt(val)) |i| node.style.order = @intCast(i);
        return true;
    }
    if (eq(u8, key, "flexWrap")) {
        if (val == .string) {
            if (eq(u8, val.string, "wrap")) {
                node.style.flex_wrap = .wrap;
            } else if (eq(u8, val.string, "wrap-reverse")) {
                node.style.flex_wrap = .wrap_reverse;
            } else {
                node.style.flex_wrap = .no_wrap;
            }
        }
        return true;
    }
    if (eq(u8, key, "gap")) {
        if (scaledFloat(val)) |f| node.style.gap = f;
        return true;
    }
    if (eq(u8, key, "rowGap")) {
        if (scaledFloat(val)) |f| node.style.row_gap = f;
        return true;
    }
    if (eq(u8, key, "columnGap")) {
        if (scaledFloat(val)) |f| node.style.column_gap = f;
        return true;
    }
    if (eq(u8, key, "justifyContent")) {
        if (val == .string) {
            const s = val.string;
            if (eq(u8, s, "center")) {
                node.style.justify_content = .center;
            } else if (eq(u8, s, "space-between") or eq(u8, s, "spaceBetween")) {
                node.style.justify_content = .space_between;
            } else if (eq(u8, s, "space-around")) {
                node.style.justify_content = .space_around;
            } else if (eq(u8, s, "space-evenly")) {
                node.style.justify_content = .space_evenly;
            } else if (eq(u8, s, "flex-end") or eq(u8, s, "end")) {
                node.style.justify_content = .end;
            } else {
                node.style.justify_content = .start;
            }
        }
        return true;
    }
    if (eq(u8, key, "alignItems")) {
        if (val == .string) node.style.align_items = parseAlignItems(val.string);
        return true;
    }
    if (eq(u8, key, "alignSelf")) {
        if (val == .string) node.style.align_self = parseAlignSelf(val.string);
        return true;
    }
    if (eq(u8, key, "alignContent")) {
        if (val == .string) node.style.align_content = parseAlignContent(val.string);
        return true;
    }

    // Padding
    if (eq(u8, key, "padding")) {
        if (scaledFloat(val)) |f| node.style.padding = f;
        return true;
    }
    if (eq(u8, key, "paddingLeft")) {
        if (scaledFloat(val)) |f| node.style.padding_left = f;
        return true;
    }
    if (eq(u8, key, "paddingRight")) {
        if (scaledFloat(val)) |f| node.style.padding_right = f;
        return true;
    }
    if (eq(u8, key, "paddingTop")) {
        if (scaledFloat(val)) |f| node.style.padding_top = f;
        return true;
    }
    if (eq(u8, key, "paddingBottom")) {
        if (scaledFloat(val)) |f| node.style.padding_bottom = f;
        return true;
    }
    // RN axis shorthands. Without these, `paddingVertical`/`paddingHorizontal`
    // silently no-op (padTop/padLeft fall back to `padding` = 0) — which is how
    // a multiline input ended up rendering its text flush against the corner.
    if (eq(u8, key, "paddingVertical")) {
        if (scaledFloat(val)) |f| {
            node.style.padding_top = f;
            node.style.padding_bottom = f;
        }
        return true;
    }
    if (eq(u8, key, "paddingHorizontal")) {
        if (scaledFloat(val)) |f| {
            node.style.padding_left = f;
            node.style.padding_right = f;
        }
        return true;
    }

    // Margin (scaled + "auto" sentinel via scaledSpacing)
    if (eq(u8, key, "margin")) {
        if (scaledSpacing(val)) |f| node.style.margin = f;
        return true;
    }
    if (eq(u8, key, "marginLeft")) {
        if (scaledSpacing(val)) |f| node.style.margin_left = f;
        return true;
    }
    if (eq(u8, key, "marginRight")) {
        if (scaledSpacing(val)) |f| node.style.margin_right = f;
        return true;
    }
    if (eq(u8, key, "marginTop")) {
        if (scaledSpacing(val)) |f| node.style.margin_top = f;
        return true;
    }
    if (eq(u8, key, "marginBottom")) {
        if (scaledSpacing(val)) |f| node.style.margin_bottom = f;
        return true;
    }
    if (eq(u8, key, "marginVertical")) {
        if (scaledSpacing(val)) |f| {
            node.style.margin_top = f;
            node.style.margin_bottom = f;
        }
        return true;
    }
    if (eq(u8, key, "marginHorizontal")) {
        if (scaledSpacing(val)) |f| {
            node.style.margin_left = f;
            node.style.margin_right = f;
        }
        return true;
    }

    // Display, overflow, position
    if (eq(u8, key, "display")) {
        if (val == .string) node.style.display = parseDisplay(val.string);
        return true;
    }
    if (eq(u8, key, "overflow")) {
        if (val == .string) node.style.overflow = parseOverflow(val.string);
        return true;
    }
    if (eq(u8, key, "position")) {
        if (val == .string) node.style.position = parsePosition(val.string);
        return true;
    }
    if (eq(u8, key, "textAlign")) {
        if (val == .string) node.style.text_align = parseTextAlign(val.string);
        return true;
    }
    if (eq(u8, key, "aspectRatio")) {
        if (jsonFloat(val)) |f| node.style.aspect_ratio = f;
        return true;
    }

    // Borders — widths, dash params, radii are all pixel-typed → scaled.
    if (eq(u8, key, "borderWidth")) {
        if (jsonFloat(val)) |f| node.style.border_width = f;
        return true;
    }
    if (eq(u8, key, "borderTopWidth")) {
        if (jsonFloat(val)) |f| node.style.border_top_width = f;
        return true;
    }
    if (eq(u8, key, "borderRightWidth")) {
        if (jsonFloat(val)) |f| node.style.border_right_width = f;
        return true;
    }
    if (eq(u8, key, "borderBottomWidth")) {
        if (jsonFloat(val)) |f| node.style.border_bottom_width = f;
        return true;
    }
    if (eq(u8, key, "borderLeftWidth")) {
        if (jsonFloat(val)) |f| node.style.border_left_width = f;
        return true;
    }
    if (eq(u8, key, "borderColor")) {
        if (val == .string) node.style.border_color = parseColor(val.string);
        return true;
    }
    if (eq(u8, key, "borderDash")) {
        if (val == .array and val.array.items.len >= 2) {
            if (jsonFloat(val.array.items[0])) |on| node.style.border_dash_on = on;
            if (jsonFloat(val.array.items[1])) |off| node.style.border_dash_off = off;
        }
        return true;
    }
    if (eq(u8, key, "borderDashOn")) {
        if (jsonFloat(val)) |f| node.style.border_dash_on = f;
        return true;
    }
    if (eq(u8, key, "borderDashOff")) {
        if (jsonFloat(val)) |f| node.style.border_dash_off = f;
        return true;
    }
    if (eq(u8, key, "borderFlowSpeed")) {
        // px/sec — pixel-typed, so scale.
        if (jsonFloat(val)) |f| node.style.border_flow_speed = f;
        return true;
    }
    if (eq(u8, key, "borderDashWidth")) {
        if (jsonFloat(val)) |f| node.style.border_dash_width = f;
        return true;
    }
    if (eq(u8, key, "borderRadius")) {
        if (jsonFloat(val)) |f| node.style.border_radius = f;
        return true;
    }
    if (eq(u8, key, "borderTopLeftRadius")) {
        if (jsonFloat(val)) |f| node.style.border_top_left_radius = f;
        return true;
    }
    if (eq(u8, key, "borderTopRightRadius")) {
        if (jsonFloat(val)) |f| node.style.border_top_right_radius = f;
        return true;
    }
    if (eq(u8, key, "borderBottomRightRadius")) {
        if (jsonFloat(val)) |f| node.style.border_bottom_right_radius = f;
        return true;
    }
    if (eq(u8, key, "borderBottomLeftRadius")) {
        if (jsonFloat(val)) |f| node.style.border_bottom_left_radius = f;
        return true;
    }

    // Animatable visual props — give the shell a chance to route through
    // a transition system before the default write.
    if (eq(u8, key, "backgroundColor")) {
        if (is_update and hooks.on_animatable != null) {
            if (hooks.on_animatable.?(node, key, val)) return true;
        }
        if (val == .string) node.style.background_color = parseColor(val.string);
        return true;
    }
    if (eq(u8, key, "opacity")) {
        if (is_update and hooks.on_animatable != null) {
            if (hooks.on_animatable.?(node, key, val)) return true;
        }
        if (jsonFloat(val)) |f| node.style.opacity = f;
        return true;
    }
    if (eq(u8, key, "rotation")) {
        if (is_update and hooks.on_animatable != null) {
            if (hooks.on_animatable.?(node, key, val)) return true;
        }
        if (jsonFloat(val)) |f| node.style.rotation = f;
        return true;
    }
    if (eq(u8, key, "scaleX")) {
        if (is_update and hooks.on_animatable != null) {
            if (hooks.on_animatable.?(node, key, val)) return true;
        }
        if (jsonFloat(val)) |f| node.style.scale_x = f;
        return true;
    }
    if (eq(u8, key, "scaleY")) {
        if (is_update and hooks.on_animatable != null) {
            if (hooks.on_animatable.?(node, key, val)) return true;
        }
        if (jsonFloat(val)) |f| node.style.scale_y = f;
        return true;
    }

    // transform: { rotate, scaleX, scaleY, translateX, translateY, originX, originY }
    if (eq(u8, key, "transform")) {
        if (val == .object) {
            if (val.object.get("rotate")) |v| {
                if (is_update and hooks.on_animatable != null) {
                    _ = hooks.on_animatable.?(node, "rotation", v);
                } else if (jsonFloat(v)) |f| {
                    node.style.rotation = f;
                }
            }
            if (val.object.get("scaleX")) |v| {
                if (jsonFloat(v)) |f| node.style.scale_x = f;
            }
            if (val.object.get("scaleY")) |v| {
                if (jsonFloat(v)) |f| node.style.scale_y = f;
            }
            if (val.object.get("originX")) |v| {
                if (jsonFloat(v)) |f| node.style.origin_x = f;
            }
            if (val.object.get("originY")) |v| {
                if (jsonFloat(v)) |f| node.style.origin_y = f;
            }
            if (val.object.get("translateX")) |v| {
                if (jsonFloat(v)) |f| node.style.translate_x = f;
            }
            if (val.object.get("translateY")) |v| {
                if (jsonFloat(v)) |f| node.style.translate_y = f;
            }
        }
        return true;
    }

    // Tweens — pixel-typed translation values are scaled; duration/curve
    // are unit-less (ms, curve id) and stay literal.
    if (eq(u8, key, "tweenTranslateXFrom")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_x_from = f;
        return true;
    }
    if (eq(u8, key, "tweenTranslateXTo")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_x_to = f;
        return true;
    }
    if (eq(u8, key, "tweenTranslateXDurMs")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_x_dur_ms = f;
        return true;
    }
    if (eq(u8, key, "tweenTranslateXCurve")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_x_curve = @trunc(@max(0, @min(255, f)));
        return true;
    }
    if (eq(u8, key, "tweenTranslateYFrom")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_from = f;
        return true;
    }
    if (eq(u8, key, "tweenTranslateYTo")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_to = f;
        return true;
    }
    if (eq(u8, key, "tweenTranslateYDurMs")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_dur_ms = f;
        return true;
    }
    if (eq(u8, key, "tweenTranslateYCurve")) {
        if (jsonFloat(val)) |f| node.style.tween_translate_y_curve = @trunc(@max(0, @min(255, f)));
        return true;
    }

    // Transition config — shell installs animation state.
    if (eq(u8, key, "transition")) {
        if (hooks.on_transition) |h| {
            _ = h(node, val);
        }
        return true;
    }

    // Z-index + shadows
    if (eq(u8, key, "zIndex")) {
        if (jsonInt(val)) |i| node.style.z_index = @intCast(i);
        return true;
    }
    if (eq(u8, key, "shadowOffsetX")) {
        if (jsonFloat(val)) |f| node.style.shadow_offset_x = f;
        return true;
    }
    if (eq(u8, key, "shadowOffsetY")) {
        if (jsonFloat(val)) |f| node.style.shadow_offset_y = f;
        return true;
    }
    if (eq(u8, key, "shadowBlur")) {
        if (jsonFloat(val)) |f| node.style.shadow_blur = f;
        return true;
    }
    if (eq(u8, key, "shadowColor")) {
        if (val == .string) node.style.shadow_color = parseColor(val.string);
        return true;
    }
    if (eq(u8, key, "shadowMethod")) {
        if (val == .string) {
            if (eq(u8, val.string, "rect")) {
                node.style.shadow_method = 1;
            } else {
                node.style.shadow_method = 0;
            }
        } else if (jsonInt(val)) |i| {
            node.style.shadow_method = if (i == 1) 1 else 0;
        }
        return true;
    }

    // Typography (also valid inside `style`, since React code routes them
    // here for HTML tags like <h1>).
    if (eq(u8, key, "fontSize")) {
        if (jsonInt(val)) |i| node.font_size = @intCast(@max(i, 1));
        return true;
    }
    if (eq(u8, key, "fontFamily")) {
        if (val == .string) node.font_family_id = fontFamilyIdFor(val.string);
        return true;
    }
    if (eq(u8, key, "fontWeight")) {
        if (val == .string) {
            const s = val.string;
            if (eq(u8, s, "bold") or eq(u8, s, "bolder")) {
                node.font_weight = 700;
            } else if (eq(u8, s, "normal") or eq(u8, s, "lighter")) {
                node.font_weight = 400;
            } else if (jsonInt(val)) |i| {
                node.font_weight = @intCast(@max(@min(i, 900), 1));
            }
        } else if (jsonInt(val)) |i| {
            node.font_weight = @intCast(@max(@min(i, 900), 1));
        }
        return true;
    }
    if (eq(u8, key, "color")) {
        if (val == .string) node.text_color = parseColor(val.string);
        return true;
    }
    if (eq(u8, key, "letterSpacing")) {
        if (jsonFloat(val)) |f| node.letter_spacing = f;
        return true;
    }
    if (eq(u8, key, "lineHeight")) {
        if (jsonFloat(val)) |f| node.line_height = f;
        return true;
    }

    return false;
}

/// Convenience wrapper: iterate every key in a style object. Returns the
/// number of keys the parser did NOT recognize (callers can use this to
/// detect when their extension handlers should kick in — though it's
/// cleaner to iterate the object yourself and check the per-key return).
pub fn applyStyle(
    node: *Node,
    style_v: std.json.Value,
    is_update: bool,
    hooks: Hooks,
) usize {
    if (style_v != .object) return 0;
    var unrecognized: usize = 0;
    // Process `transition` first so animatable property writes in the same
    // batch see the latest config. Mirrors v8_app.zig's ordering invariant.
    if (style_v.object.get("transition")) |t| {
        _ = applyStyleEntry(node, "transition", t, is_update, hooks);
    }
    var it = style_v.object.iterator();
    while (it.next()) |e| {
        if (std.mem.eql(u8, e.key_ptr.*, "transition")) continue;
        if (!applyStyleEntry(node, e.key_ptr.*, e.value_ptr.*, is_update, hooks)) {
            unrecognized += 1;
        }
    }
    return unrecognized;
}

// ── Top-level prop applier (the layout/font/color subset only) ──────

/// Apply one top-level prop entry. Returns true if recognized. Callers
/// pass each entry from the props object; unrecognized keys go to the
/// shell's extension handler.
///
/// Recognized:  style, fontSize, fontFamily, fontWeight, color,
///              letterSpacing, lineHeight, numberOfLines, noWrap.
///
/// Not recognized here (shell handles):  text, value, placeholder,
///              colorRows, contentHandle, source, render*, staticSurface*,
///              canvas_*, graph_*, effect_*, physics_*, shell, session,
///              terminalFontSize, paintText, contextMenuItems, inlineGlyphs,
///              hoverable, blocksPointerEvents, tooltip, href, debugName, testID, devtoolsViz,
///              + every `on*` handler name.
pub fn applyTopLevelProp(
    node: *Node,
    key: []const u8,
    val: std.json.Value,
    is_update: bool,
    hooks: Hooks,
) bool {
    const eq = std.mem.eql;
    if (eq(u8, key, "style")) {
        _ = applyStyle(node, val, is_update, hooks);
        return true;
    }
    // Typography at the top level (HTML defaults / direct cart usage).
    if (eq(u8, key, "fontSize")) {
        if (jsonInt(val)) |i| node.font_size = @intCast(@max(i, 1));
        return true;
    }
    if (eq(u8, key, "fontFamily")) {
        if (val == .string) node.font_family_id = fontFamilyIdFor(val.string);
        return true;
    }
    if (eq(u8, key, "fontWeight")) {
        if (val == .string) {
            const s = val.string;
            if (eq(u8, s, "bold") or eq(u8, s, "bolder")) {
                node.font_weight = 700;
            } else if (eq(u8, s, "normal") or eq(u8, s, "lighter")) {
                node.font_weight = 400;
            } else if (jsonInt(val)) |i| {
                node.font_weight = @intCast(@max(@min(i, 900), 1));
            }
        } else if (jsonInt(val)) |i| {
            node.font_weight = @intCast(@max(@min(i, 900), 1));
        }
        return true;
    }
    if (eq(u8, key, "color")) {
        if (val == .string) node.text_color = parseColor(val.string);
        return true;
    }
    if (eq(u8, key, "letterSpacing")) {
        if (jsonFloat(val)) |f| node.letter_spacing = f;
        return true;
    }
    if (eq(u8, key, "lineHeight")) {
        if (jsonFloat(val)) |f| node.line_height = f;
        return true;
    }
    if (eq(u8, key, "numberOfLines")) {
        if (jsonInt(val)) |i| node.number_of_lines = @intCast(@max(i, 0));
        return true;
    }
    if (eq(u8, key, "noWrap")) {
        if (jsonBool(val)) |b| node.no_wrap = b;
        return true;
    }
    if (eq(u8, key, "blocksPointerEvents")) {
        if (jsonBool(val)) |b| node.blocks_pointer_events = b;
        return true;
    }
    return false;
}
