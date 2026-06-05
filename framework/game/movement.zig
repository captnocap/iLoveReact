//! framework/game/movement.zig — the game's ONE host-side movement integrator (V7).
//!
//! WASD-becomes-velocity lives in the host. JS keysRef is input TRANSPORT
//! only: a cart ships a direction vector (or raw key axes) down the packed
//! physics input buffer once per frame; nothing JS-side integrates movement.
//!
//! Two pieces, both graduated here:
//!   • wasdDirection()      — the camera-relative keys→direction formula,
//!     out of framework/v8_bindings_input_bench.zig. The bench file keeps a
//!     deliberately-mirrored copy (it exists to compare the SAME math across
//!     JS/Lua/Zig backends); THIS is the canonical gameplay copy.
//!   • integrateHorizontal() — the accelerate-toward-target / friction-drag
//!     velocity update that used to live inline in __hmsc_physics_step.
//!     framework/game/physics.zig calls it inside its step, so the physics
//!     step and the movement integrator are one system, not two.
//!
//! Pure math — no V8, no SDL, no engine. Behavior-tested in
//! framework/testing/unit/game_physics.zig.

const std = @import("std");

pub const Direction = struct { x: f32, z: f32 };

fn clamp(n: f32, a: f32, b: f32) f32 {
    return @max(a, @min(b, n));
}

/// Camera-relative WASD direction. `forward` is W(+1)/S(−1), `strafe` is
/// D(+1)/A(−1), `yaw` is the camera yaw in radians. Diagonals are normalized
/// so |direction| never exceeds 1.
///
/// Sign convention: the engine renders world +X as screen-LEFT (lookForward
/// uses −sin(yaw) for X), so strafe gets the opposite sign of forward to keep
/// D walking screen-right. Same formula as cart/input_bench's keys.ts — that
/// benchmark mirrors it across backends on purpose.
pub fn wasdDirection(forward: f32, strafe: f32, yaw: f32) Direction {
    var fwd = forward;
    var str = strafe;
    const len2 = fwd * fwd + str * str;
    if (len2 > 1.0) {
        const inv = 1.0 / @sqrt(len2);
        fwd *= inv;
        str *= inv;
    }
    const cy = @cos(yaw);
    const sy = @sin(yaw);
    return .{
        .x = fwd * sy - str * cy,
        .z = fwd * cy + str * sy,
    };
}

/// One frame of horizontal velocity integration. With input, velocity blends
/// toward the normalized move direction at `speed` (the blend rate scales
/// with `acceleration_multiplier`); without input it decays under a drag that
/// stiffens with `surface_friction`. Mutates vx/vz in place — this runs
/// inside the physics step's player block, before position integration.
pub fn integrateHorizontal(
    vx: *f32,
    vz: *f32,
    move_x: f32,
    move_z: f32,
    speed: f32,
    acceleration_multiplier: f32,
    surface_friction: f32,
    dt: f32,
) void {
    const move_len = @sqrt(move_x * move_x + move_z * move_z);
    if (move_len > 0.001) {
        const target_vx = move_x / move_len * speed;
        const target_vz = move_z / move_len * speed;
        const acceleration_blend = clamp(dt * 18 * acceleration_multiplier, 0, 1);
        vx.* += (target_vx - vx.*) * acceleration_blend;
        vz.* += (target_vz - vz.*) * acceleration_blend;
    } else {
        const drag = @max(@as(f32, 0), 1 - dt * (6 + surface_friction * 16));
        vx.* *= drag;
        vz.* *= drag;
    }
}
