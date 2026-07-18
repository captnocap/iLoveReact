//! transition.zig — CSS transition engine for the tsz framework
//!
//! Manages per-property per-node transitions. When the generated code changes a style
//! value and that property has a transition config, the engine interpolates smoothly
//! instead of snapping.
//!
//! Architecture:
//!   - Fixed-size pool of transition slots (no allocator needed)
//!   - set() called by generated code when a transitioned style value changes
//!   - tick(dt) called once per frame by engine.zig, AFTER app tick, BEFORE layout
//!   - Visual-only properties skip relayout; layout properties mark dirty
//!   - Color properties interpolated in RGBA space
//!   - Spring physics variant for organic motion
//!
//! Slot layout: MAX_ACTIVE transition slots. Each slot is a {node, property, from, to,
//! timing} record. When a node+property pair already has an active slot, it retargets
//! from the current interpolated value (no pop).

const std = @import("std");
const m = @import("../math/root.zig");
const easing_mod = @import("../math/easing.zig");
const layout = @import("../layout.zig");
const Node = layout.Node;
const Color = layout.Color;

// ============================================================================
// Types
// ============================================================================

/// Animatable style property. Each variant maps to exactly one field on Node or Node.style.
pub const Property = enum {
    // Visual-only (skip relayout)
    opacity,
    background_color,
    border_color,
    shadow_color,
    border_radius,
    border_width,
    rotation,
    scale_x,
    scale_y,
    shadow_offset_x,
    shadow_offset_y,
    shadow_blur,
    // Layout-affecting (mark dirty)
    width,
    height,
    min_width,
    max_width,
    min_height,
    max_height,
    padding,
    padding_left,
    padding_right,
    padding_top,
    padding_bottom,
    margin,
    margin_left,
    margin_right,
    margin_top,
    margin_bottom,
    gap,
    flex_grow,

    /// Returns true if this property is visual-only (no relayout needed).
    pub fn isVisualOnly(self: Property) bool {
        return switch (self) {
            .opacity,
            .background_color,
            .border_color,
            .shadow_color,
            .border_radius,
            .border_width,
            .rotation,
            .scale_x,
            .scale_y,
            .shadow_offset_x,
            .shadow_offset_y,
            .shadow_blur,
            => true,
            else => false,
        };
    }

    /// Returns true if this property is a color (needs RGBA interpolation).
    pub fn isColor(self: Property) bool {
        return switch (self) {
            .background_color, .border_color, .shadow_color => true,
            else => false,
        };
    }
};

/// Value being transitioned — either a scalar float or a color.
pub const AnimValue = union(enum) {
    float: f32,
    color: Color,

    pub fn eql(a: AnimValue, b: AnimValue) bool {
        return switch (a) {
            .float => |af| switch (b) {
                .float => |bf| af == bf,
                .color => false,
            },
            .color => |ac| switch (b) {
                .color => |bc| ac.r == bc.r and ac.g == bc.g and ac.b == bc.b and ac.a == bc.a,
                .float => false,
            },
        };
    }
};

/// Easing specification — either a named preset or a custom cubic bezier.
pub const EasingSpec = union(enum) {
    named: easing_mod.EasingType,
    bezier: easing_mod.CubicBezierEasing,

    pub fn eval(self: EasingSpec, t: f32) f32 {
        return switch (self) {
            .named => |n| n.resolve()(t),
            .bezier => |b| b.eval(t),
        };
    }
};

/// Configuration for a single property transition.
pub const TransitionConfig = struct {
    duration_ms: u16 = 300,
    delay_ms: u16 = 0,
    easing: EasingSpec = .{ .named = .ease_in_out },
};

/// Spring physics configuration (alternative to timing-based).
pub const SpringConfig = struct {
    stiffness: f32 = 100,
    damping: f32 = 10,
    mass: f32 = 1,
    rest_threshold: f32 = 0.001,
    delay_ms: u16 = 0,
};

// ============================================================================
// Transition slot
// ============================================================================

const SlotKind = enum { timing, spring };

const Slot = struct {
    active: bool = false,
    node: ?*Node = null,
    property: Property = .opacity,
    from: AnimValue = .{ .float = 0 },
    to: AnimValue = .{ .float = 0 },
    current: AnimValue = .{ .float = 0 },
    kind: SlotKind = .timing,
    // Timing-based fields
    elapsed: f32 = 0, // seconds since transition start
    duration: f32 = 0.3, // seconds
    delay: f32 = 0, // seconds
    easing: EasingSpec = .{ .named = .ease_in_out },
    // Spring-based fields
    velocity: f32 = 0,
    progress: f32 = 0, // 0→1 normalized position for spring
    stiffness: f32 = 100,
    damping: f32 = 10,
    mass: f32 = 1,
    rest_threshold: f32 = 0.001,
};

// ============================================================================
// State
// ============================================================================

pub const MAX_ACTIVE: usize = 256;
var slots: [MAX_ACTIVE]Slot = [_]Slot{.{}} ** MAX_ACTIVE;
var needs_layout: bool = false;

// ============================================================================
// Public API
// ============================================================================

/// Start or retarget a transition on a node's property.
/// If a transition is already running for this node+property, retargets from
/// the current interpolated value (no snap/pop).
pub fn set(node: *Node, property: Property, new_value: AnimValue, config: TransitionConfig) void {
    // Read the current actual value from the node
    const current_value = readProperty(node, property);

    // If the new value matches what's already there (no change), skip
    if (current_value.eql(new_value)) {
        // But check: is there an active transition targeting something else?
        // If so, retarget it back.
        if (findSlot(node, property)) |idx| {
            if (!slots[idx].to.eql(new_value)) {
                retarget(idx, new_value, config);
            }
        }
        return;
    }

    // Check for existing transition on this node+property
    if (findSlot(node, property)) |idx| {
        // Only retarget if the target changed — otherwise the transition is
        // already heading to the right place. This is critical because _appTick
        // calls set() every frame with the same target.
        if (!slots[idx].to.eql(new_value)) {
            retarget(idx, new_value, config);
        }
        return;
    } else {
        // Allocate new slot
        if (allocSlot()) |idx| {
            slots[idx] = .{
                .active = true,
                .node = node,
                .property = property,
                .from = current_value,
                .to = new_value,
                .current = current_value,
                .kind = .timing,
                .elapsed = 0,
                .duration = @as(f32, config.duration_ms) / 1000.0,
                .delay = @as(f32, config.delay_ms) / 1000.0,
                .easing = config.easing,
            };
            // Write back from-value so visual doesn't jump
            writeProperty(node, property, current_value);
        }
        // If pool is full, snap immediately (graceful degradation)
    }
}

/// Start or retarget a spring transition.
pub fn setSpring(node: *Node, property: Property, new_value: AnimValue, config: SpringConfig) void {
    const current_value = readProperty(node, property);

    if (current_value.eql(new_value)) {
        if (findSlot(node, property)) |idx| {
            if (!slots[idx].to.eql(new_value)) {
                retargetSpring(idx, new_value, config);
            }
        }
        return;
    }

    if (findSlot(node, property)) |idx| {
        retargetSpring(idx, new_value, config);
    } else {
        if (allocSlot()) |idx| {
            slots[idx] = .{
                .active = true,
                .node = node,
                .property = property,
                .from = current_value,
                .to = new_value,
                .current = current_value,
                .kind = .spring,
                .elapsed = 0,
                .delay = @as(f32, config.delay_ms) / 1000.0,
                .velocity = 0,
                .progress = 0,
                .stiffness = config.stiffness,
                .damping = config.damping,
                .mass = config.mass,
                .rest_threshold = config.rest_threshold,
            };
            writeProperty(node, property, current_value);
        }
    }
}

/// Advance all active transitions by dt seconds.
/// Returns true if any transitions are still active (caller should keep ticking).
pub fn tick(dt: f32) bool {
    needs_layout = false;
    var any_active = false;
    const spring_dt = @min(dt, 0.064); // cap spring integration at ~15fps to prevent explosion

    for (&slots) |*slot| {
        if (!slot.active) continue;
        if (slot.node == null) {
            slot.active = false;
            continue;
        }

        slot.elapsed += dt;

        // Delay period
        if (slot.elapsed < slot.delay) {
            any_active = true;
            continue;
        }

        const active_elapsed = slot.elapsed - slot.delay;

        switch (slot.kind) {
            .timing => {
                var progress: f32 = 1.0;
                if (slot.duration > 0) {
                    progress = @min(active_elapsed / slot.duration, 1.0);
                }

                const eased = slot.easing.eval(progress);
                const value = interpolate(slot.from, slot.to, eased);
                slot.current = value;
                writeProperty(slot.node.?, slot.property, value);

                if (progress >= 1.0) {
                    writeProperty(slot.node.?, slot.property, slot.to);
                    slot.active = false;
                } else {
                    any_active = true;
                }
            },
            .spring => {
                // Spring physics: Verlet integration toward target (progress 0→1)
                // Use capped dt to prevent numerical explosion
                const displacement = slot.progress - 1.0;
                const spring_force = -slot.stiffness * displacement;
                const damping_force = -slot.damping * slot.velocity;
                const acceleration = (spring_force + damping_force) / slot.mass;

                slot.velocity += acceleration * spring_dt;
                slot.progress += slot.velocity * spring_dt;

                const value = interpolate(slot.from, slot.to, slot.progress);
                slot.current = value;
                writeProperty(slot.node.?, slot.property, value);

                // Rest condition
                if (@abs(slot.velocity) < slot.rest_threshold and
                    @abs(slot.progress - 1.0) < slot.rest_threshold)
                {
                    writeProperty(slot.node.?, slot.property, slot.to);
                    slot.active = false;
                } else {
                    any_active = true;
                }
            },
        }

        // Mark layout dirty if this property affects layout
        if (!slot.property.isVisualOnly()) {
            needs_layout = true;
        }
    }

    return any_active;
}

/// Returns true if the last tick() call modified any layout-affecting properties.
pub fn needsRelayout() bool {
    return needs_layout;
}

/// Cancel all transitions for a specific node (call on node removal).
pub fn cancelNode(node: *Node) void {
    for (&slots) |*slot| {
        if (slot.active and slot.node == node) {
            slot.active = false;
        }
    }
}

/// Cancel a specific property transition on a node.
pub fn cancel(node: *Node, property: Property) void {
    if (findSlot(node, property)) |idx| {
        slots[idx].active = false;
    }
}

/// Clear all active transitions. Call on hot reload or tree reset.
pub fn clear() void {
    for (&slots) |*slot| {
        slot.active = false;
    }
}

/// Number of currently active transitions.
pub fn activeCount() u32 {
    var count: u32 = 0;
    for (&slots) |*slot| {
        if (slot.active) count += 1;
    }
    return count;
}

/// Check if a specific node+property has an active transition.
pub fn isAnimating(node: *Node, property: Property) bool {
    return findSlot(node, property) != null;
}

// ============================================================================
// Interpolation
// ============================================================================

fn interpolate(from: AnimValue, to: AnimValue, t: f32) AnimValue {
    return switch (from) {
        .float => |fv| switch (to) {
            .float => |tv| .{ .float = m.lerp(fv, tv, t) },
            .color => to, // type mismatch, snap
        },
        .color => |fc| switch (to) {
            .color => |tc| .{ .color = lerpColor(fc, tc, t) },
            .float => to,
        },
    };
}

fn lerpColor(a: Color, b: Color, t: f32) Color {
    return .{
        .r = lerpU8(a.r, b.r, t),
        .g = lerpU8(a.g, b.g, t),
        .b = lerpU8(a.b, b.b, t),
        .a = lerpU8(a.a, b.a, t),
    };
}

fn lerpU8(a: u8, b: u8, t: f32) u8 {
    const fa: f32 = a;
    const fb: f32 = b;
    const result = m.lerp(fa, fb, t);
    return @trunc(m.clamp(result, 0, 255));
}

// ============================================================================
// Slot management
// ============================================================================

fn findSlot(node: *Node, property: Property) ?usize {
    for (0..MAX_ACTIVE) |i| {
        if (slots[i].active and slots[i].node == node and slots[i].property == property) {
            return i;
        }
    }
    return null;
}

fn allocSlot() ?usize {
    for (0..MAX_ACTIVE) |i| {
        if (!slots[i].active) return i;
    }
    return null; // pool full
}

fn retarget(idx: usize, new_target: AnimValue, config: TransitionConfig) void {
    slots[idx].from = slots[idx].current;
    slots[idx].to = new_target;
    slots[idx].elapsed = 0;
    slots[idx].duration = @as(f32, config.duration_ms) / 1000.0;
    slots[idx].delay = @as(f32, config.delay_ms) / 1000.0;
    slots[idx].easing = config.easing;
    slots[idx].kind = .timing;
}

fn retargetSpring(idx: usize, new_target: AnimValue, config: SpringConfig) void {
    slots[idx].from = slots[idx].current;
    slots[idx].to = new_target;
    slots[idx].elapsed = 0;
    slots[idx].delay = @as(f32, config.delay_ms) / 1000.0;
    slots[idx].velocity = 0;
    slots[idx].progress = 0;
    slots[idx].stiffness = config.stiffness;
    slots[idx].damping = config.damping;
    slots[idx].mass = config.mass;
    slots[idx].rest_threshold = config.rest_threshold;
    slots[idx].kind = .spring;
}

// ============================================================================
// Property read/write — maps Property enum to actual Node.style fields
// ============================================================================

fn readProperty(node: *Node, property: Property) AnimValue {
    const s = &node.style;
    return switch (property) {
        .opacity => .{ .float = s.opacity },
        .border_radius => .{ .float = s.border_radius },
        .border_width => .{ .float = s.border_width },
        .rotation => .{ .float = s.rotation },
        .scale_x => .{ .float = s.scale_x },
        .scale_y => .{ .float = s.scale_y },
        .shadow_offset_x => .{ .float = s.shadow_offset_x },
        .shadow_offset_y => .{ .float = s.shadow_offset_y },
        .shadow_blur => .{ .float = s.shadow_blur },
        .gap => .{ .float = s.gap },
        .padding => .{ .float = s.padding },
        .margin => .{ .float = s.margin },
        .flex_grow => .{ .float = s.flex_grow },
        .width => .{ .float = s.width orelse 0 },
        .height => .{ .float = s.height orelse 0 },
        .min_width => .{ .float = s.min_width orelse 0 },
        .max_width => .{ .float = s.max_width orelse 0 },
        .min_height => .{ .float = s.min_height orelse 0 },
        .max_height => .{ .float = s.max_height orelse 0 },
        .padding_left => .{ .float = s.padding_left orelse s.padding },
        .padding_right => .{ .float = s.padding_right orelse s.padding },
        .padding_top => .{ .float = s.padding_top orelse s.padding },
        .padding_bottom => .{ .float = s.padding_bottom orelse s.padding },
        .margin_left => .{ .float = s.margin_left orelse s.margin },
        .margin_right => .{ .float = s.margin_right orelse s.margin },
        .margin_top => .{ .float = s.margin_top orelse s.margin },
        .margin_bottom => .{ .float = s.margin_bottom orelse s.margin },
        .background_color => .{ .color = s.background_color orelse Color{} },
        .border_color => .{ .color = s.border_color orelse Color{} },
        .shadow_color => .{ .color = s.shadow_color orelse Color{} },
    };
}

fn writeProperty(node: *Node, property: Property, value: AnimValue) void {
    const s = &node.style;
    switch (property) {
        .opacity => s.opacity = value.float,
        .border_radius => s.border_radius = value.float,
        .border_width => s.border_width = value.float,
        .rotation => s.rotation = value.float,
        .scale_x => s.scale_x = value.float,
        .scale_y => s.scale_y = value.float,
        .shadow_offset_x => s.shadow_offset_x = value.float,
        .shadow_offset_y => s.shadow_offset_y = value.float,
        .shadow_blur => s.shadow_blur = value.float,
        .gap => s.gap = value.float,
        .padding => s.padding = value.float,
        .margin => s.margin = value.float,
        .flex_grow => s.flex_grow = value.float,
        .width => s.width = value.float,
        .height => s.height = value.float,
        .min_width => s.min_width = value.float,
        .max_width => s.max_width = value.float,
        .min_height => s.min_height = value.float,
        .max_height => s.max_height = value.float,
        .padding_left => s.padding_left = value.float,
        .padding_right => s.padding_right = value.float,
        .padding_top => s.padding_top = value.float,
        .padding_bottom => s.padding_bottom = value.float,
        .margin_left => s.margin_left = value.float,
        .margin_right => s.margin_right = value.float,
        .margin_top => s.margin_top = value.float,
        .margin_bottom => s.margin_bottom = value.float,
        .background_color => s.background_color = value.color,
        .border_color => s.border_color = value.color,
        .shadow_color => s.shadow_color = value.color,
    }
}

// ============================================================================
// Tests
// ============================================================================

test "basic float transition" {
    clear();
    var node = Node{};
    node.style.opacity = 1.0;

    // Start transition: opacity 1.0 → 0.0 over 1 second
    set(&node, .opacity, .{ .float = 0.0 }, .{
        .duration_ms = 1000,
        .easing = .{ .named = .linear },
    });

    try std.testing.expectEqual(@as(u32, 1), activeCount());

    // Tick half a second — should be ~0.5
    _ = tick(0.5);
    try std.testing.expect(@abs(node.style.opacity - 0.5) < 0.05);

    // Tick remaining — should snap to 0.0
    _ = tick(0.6);
    try std.testing.expect(@abs(node.style.opacity - 0.0) < 0.01);
    try std.testing.expectEqual(@as(u32, 0), activeCount());
}

test "color transition" {
    clear();
    var node = Node{};
    node.style.background_color = Color.rgb(0, 0, 0);

    set(&node, .background_color, .{ .color = Color.rgb(255, 255, 255) }, .{
        .duration_ms = 1000,
        .easing = .{ .named = .linear },
    });

    _ = tick(0.5);
    const bg = node.style.background_color.?;
    // At t=0.5 linear, should be ~128
    try std.testing.expect(bg.r > 100 and bg.r < 156);
    try std.testing.expect(bg.g > 100 and bg.g < 156);

    _ = tick(0.6);
    const final = node.style.background_color.?;
    try std.testing.expectEqual(@as(u8, 255), final.r);
}

test "retarget mid-transition" {
    clear();
    var node = Node{};
    node.style.opacity = 0.0;

    set(&node, .opacity, .{ .float = 1.0 }, .{
        .duration_ms = 1000,
        .easing = .{ .named = .linear },
    });

    _ = tick(0.5); // opacity ~0.5
    const mid = node.style.opacity;
    try std.testing.expect(mid > 0.4 and mid < 0.6);

    // Retarget back to 0
    set(&node, .opacity, .{ .float = 0.0 }, .{
        .duration_ms = 1000,
        .easing = .{ .named = .linear },
    });

    // Should still be 1 active transition (retargeted, not new)
    try std.testing.expectEqual(@as(u32, 1), activeCount());

    _ = tick(0.5); // should be heading back toward 0
    try std.testing.expect(node.style.opacity < mid);
}

test "spring transition" {
    clear();
    var node = Node{};
    node.style.scale_x = 1.0;

    setSpring(&node, .scale_x, .{ .float = 1.5 }, .{
        .stiffness = 200,
        .damping = 15,
    });

    // Tick several frames
    var overshoots = false;
    for (0..120) |_| {
        _ = tick(1.0 / 60.0);
        if (node.style.scale_x > 1.5) overshoots = true;
    }

    // Spring should overshoot
    try std.testing.expect(overshoots);
    // Should converge near target
    try std.testing.expect(@abs(node.style.scale_x - 1.5) < 0.05);
}

test "delay" {
    clear();
    var node = Node{};
    node.style.opacity = 1.0;

    set(&node, .opacity, .{ .float = 0.0 }, .{
        .duration_ms = 500,
        .delay_ms = 200,
        .easing = .{ .named = .linear },
    });

    // During delay, value should stay at 1.0
    _ = tick(0.1);
    try std.testing.expect(@abs(node.style.opacity - 1.0) < 0.01);

    // After delay, should start transitioning
    _ = tick(0.2);
    try std.testing.expect(node.style.opacity < 0.95);
}

test "visual-only property does not flag relayout" {
    clear();
    var node = Node{};
    node.style.opacity = 1.0;

    set(&node, .opacity, .{ .float = 0.0 }, .{
        .duration_ms = 300,
        .easing = .{ .named = .linear },
    });
    _ = tick(0.1);
    try std.testing.expect(!needsRelayout());
}

test "layout property flags relayout" {
    clear();
    var node = Node{};
    node.style.width = 100;

    set(&node, .width, .{ .float = 200 }, .{
        .duration_ms = 300,
        .easing = .{ .named = .linear },
    });
    _ = tick(0.1);
    try std.testing.expect(needsRelayout());
}

test "cancelNode removes all transitions" {
    clear();
    var node = Node{};
    node.style.opacity = 1.0;
    node.style.scale_x = 1.0;

    set(&node, .opacity, .{ .float = 0.0 }, .{ .duration_ms = 300 });
    set(&node, .scale_x, .{ .float = 2.0 }, .{ .duration_ms = 300 });
    try std.testing.expectEqual(@as(u32, 2), activeCount());

    cancelNode(&node);
    try std.testing.expectEqual(@as(u32, 0), activeCount());
}
