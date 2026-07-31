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

/// The shared mesh shader alpha-CUTS a texel at or below this byte
/// (`shaders.zig` scene3d_fs: `if (out_a <= 0.01) { discard; }` — 0.01 × 255).
/// A discarded fragment writes neither colour nor depth, so cutout alpha already
/// reveals whatever is behind it from inside the opaque depth-writing pass.
pub const SHADER_ALPHA_CUT_BYTE: u8 = 2;
/// At or above this byte a texel is solid: it must write depth like any opaque
/// surface. Matches the 0.999 node cutoff the collector sorts transparency on.
pub const SHADER_ALPHA_OPAQUE_BYTE: u8 = 250;

/// TRUE translucency: at least one texel the shader neither discards nor treats
/// as solid, so it must BLEND against what is behind it.
///
/// Binary CUTOUT alpha is deliberately not translucency (req_3562). Every
/// painted atlas bakes its untouched gutters between UV islands as alpha-zero,
/// so a `< 250` test flagged fully opaque props — 48 of the 131 model packages
/// on disk — and dragged them into the depth-write-off pass, where a mesh's own
/// triangles stop occluding each other and it paints in vertex-buffer order
/// instead (a bed's mattress and frame overwriting the blanket draped over
/// them). The shader's discard already covers the holes those gutters make.
pub fn rgbaHasTranslucency(rgba: []const u8) bool {
    var alpha_at: usize = 3;
    while (alpha_at < rgba.len) : (alpha_at += 4) {
        const alpha = rgba[alpha_at];
        if (alpha > SHADER_ALPHA_CUT_BYTE and alpha < SHADER_ALPHA_OPAQUE_BYTE) return true;
    }
    return false;
}

/// A resident mesh whose atlas carries genuinely translucent texels cannot write
/// depth in the opaque pass: those texels must blend against the world behind
/// them instead of hiding it. This route supplies the matching depth-write-off
/// draw. A cutout-only atlas stays opaque — the shader discard handles its holes
/// and the mesh keeps self-occlusion, which the transparent pass cannot give it.
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
    // The band edges: the shader's cut byte is still cutout, one above it blends.
    try std.testing.expect(!rgbaHasTranslucency(&.{ 40, 50, 60, SHADER_ALPHA_CUT_BYTE }));
    try std.testing.expect(rgbaHasTranslucency(&.{ 40, 50, 60, SHADER_ALPHA_CUT_BYTE + 1 }));
    try std.testing.expect(!rgbaHasTranslucency(&.{ 40, 50, 60, SHADER_ALPHA_OPAQUE_BYTE }));
    try std.testing.expect(rgbaHasTranslucency(&.{ 40, 50, 60, SHADER_ALPHA_OPAQUE_BYTE - 1 }));
}

test "a cutout-only painted atlas stays opaque so the mesh keeps self-occlusion" {
    // req_3562: alpha-zero UV gutters are the shader's discard band, not glass.
    // Routing this mesh transparent cost it depth-write and its own triangles
    // stopped occluding each other.
    try std.testing.expect(!routeTexturedMeshTransparent(rgbaHasTranslucency(&.{ 0, 0, 0, 0, 220, 90, 30, 255 })));
    try std.testing.expect(!routeTexturedMeshTransparent(rgbaHasTranslucency(&.{ 220, 90, 30, 255 })));
    // Real glass in the same atlas still earns the depth-write-off draw.
    try std.testing.expect(routeTexturedMeshTransparent(rgbaHasTranslucency(&.{ 0, 0, 0, 0, 220, 90, 30, 255, 169, 200, 216, 87 })));
}
