//! Stable identity/state carry for editor-live cooked doors.
//!
//! Live mesh refs are replaced as a whole whenever the authoring world changes.
//! Door open/progress is transient runtime state, so a generation rebuild must
//! reconcile by semantic mesh reference + quantized transform rather than reset
//! every unchanged door to closed. Kept pure so the boundary is unit-testable.

const std = @import("std");

pub const State = struct {
    identity: u64,
    open: bool,
    progress: f32,
};

fn mix(h: u64, value: u64) u64 {
    return (h ^ value) *% 1099511628211;
}

fn quantized(value: f32, scale: f32) i64 {
    return @round(value * scale);
}

/// Stable live-door identity. Position is millimetre-quantized and yaw to
/// 0.01 degrees, matching the loader's other live-instance reconciliation.
/// Y participates so aligned doors on different storeys never share state.
pub fn identity(mesh_hash: u32, x: f32, y: f32, z: f32, yaw_degrees: f32) u64 {
    var h: u64 = 1469598103934665603;
    h = mix(h, mesh_hash);
    h = mix(h, @bitCast(quantized(x, 1000)));
    h = mix(h, @bitCast(quantized(y, 1000)));
    h = mix(h, @bitCast(quantized(z, 1000)));
    h = mix(h, @bitCast(quantized(yaw_degrees, 100)));
    return h;
}

/// Preserve a door's live target/progress across a ref-generation rebuild.
/// A genuinely new identity boots at the asset's authored start state.
pub fn reconcile(id: u64, start_open: bool, previous: []const State) State {
    for (previous) |state| {
        if (state.identity == id) return state;
    }
    return .{
        .identity = id,
        .open = start_open,
        .progress = if (start_open) 1 else 0,
    };
}

/// Live door slot transparency contract. RJMD v2 emits opaque leaf then glass
/// slots, so every slot after `leaf_slot` is transparent. A legacy v1 door has
/// only one mixed leaf slot; when its atlas contains alpha, route that entire
/// slot through the transparent pass so its opaque texels still draw normally
/// while glass texels cannot depth-block the later ground pass.
pub fn routeSlotTransparent(slot_index: usize, leaf_slot: usize, slot_count: usize, texture_has_translucency: bool) bool {
    if (slot_index > leaf_slot) return true;
    return texture_has_translucency and slot_index == leaf_slot and slot_count == leaf_slot + 1;
}

pub fn rgbaHasTranslucency(rgba: []const u8) bool {
    var alpha_at: usize = 3;
    while (alpha_at < rgba.len) : (alpha_at += 4) {
        if (rgba[alpha_at] < 250) return true;
    }
    return false;
}

/// A resident mesh whose atlas has non-opaque texels cannot write depth in the
/// opaque pass: its transparent texels would hide the world behind the mesh.
/// The shared mesh shader still alpha-discards fully empty texels; this route
/// supplies the matching depth-write-off draw for the painted texels.
pub fn routeTexturedMeshTransparent(texture_has_translucency: bool) bool {
    return texture_has_translucency;
}

test "identity separates storeys and mesh meanings while tolerating float noise below quantization" {
    const base = identity(11, 3.0, 0.0, 6.0, 90.0);
    try std.testing.expectEqual(base, identity(11, 3.0001, 0.0001, 6.0001, 90.001));
    try std.testing.expect(base != identity(12, 3.0, 0.0, 6.0, 90.0));
    try std.testing.expect(base != identity(11, 3.0, 3.0, 6.0, 90.0));
}

test "reconcile carries transient state and initializes a new door from authored state" {
    const old = [_]State{.{ .identity = 42, .open = true, .progress = 0.625 }};
    try std.testing.expectEqualDeep(old[0], reconcile(42, false, &old));
    try std.testing.expectEqualDeep(
        State{ .identity = 99, .open = true, .progress = 1 },
        reconcile(99, true, &old),
    );
}

test "legacy mixed leaf and v2 glass tail both route through the transparent pass" {
    try std.testing.expect(routeSlotTransparent(0, 0, 1, true));
    try std.testing.expect(!routeSlotTransparent(0, 0, 1, false));
    try std.testing.expect(!routeSlotTransparent(0, 0, 2, true));
    try std.testing.expect(routeSlotTransparent(1, 0, 2, true));
}

test "atlas alpha detection finds the Studio glass value without flagging opaque paint" {
    try std.testing.expect(rgbaHasTranslucency(&.{ 10, 20, 30, 255, 40, 50, 60, 87 }));
    try std.testing.expect(!rgbaHasTranslucency(&.{ 10, 20, 30, 255, 40, 50, 60, 255 }));
}

test "painted atlas with an empty background routes through the transparent pass" {
    try std.testing.expect(routeTexturedMeshTransparent(rgbaHasTranslucency(&.{ 0, 0, 0, 0, 220, 90, 30, 255 })));
    try std.testing.expect(!routeTexturedMeshTransparent(rgbaHasTranslucency(&.{ 220, 90, 30, 255 })));
}
