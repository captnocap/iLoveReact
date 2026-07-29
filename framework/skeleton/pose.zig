//! Pose → bone-palette math for skinned figures (SKIN-3499).
//!
//! A palette entry is the bone's MODEL-SPACE matrix with the inverse-bind
//! translation folded in: M = T(pos) · Ry · Rx · Rz · S · T(-center), stored
//! column-major (16 floats) followed by the bone's rgba tint (4 floats) — the
//! exact 80-byte std430 BoneData the skinned shaders read. The rotation order
//! and handedness MIRROR scene3d_wgsl's rebuild_model (T · Ry · Rx · Rz · S),
//! so an instance root × palette entry reproduces the legacy per-part node
//! transform exactly when weights are rigid.

/// Floats per palette entry: column-major mat4 (16) + rgba color (4).
pub const BONE_FLOATS: usize = 20;

const DEG_TO_RAD: f32 = 0.017453292;

/// Column-major 3×3 multiply: c = a · b, layout m[col * 3 + row].
fn mul3(a: [9]f32, b: [9]f32) [9]f32 {
    var c: [9]f32 = undefined;
    var col: usize = 0;
    while (col < 3) : (col += 1) {
        var row: usize = 0;
        while (row < 3) : (row += 1) {
            c[col * 3 + row] = a[0 * 3 + row] * b[col * 3 + 0] +
                a[1 * 3 + row] * b[col * 3 + 1] +
                a[2 * 3 + row] * b[col * 3 + 2];
        }
    }
    return c;
}

/// Write one palette entry at `index`: M = T(pos)·Ry(ry)·Rx(rx)·Rz(rz)·S·T(-center)
/// (rotations in DEGREES — the clip wire format), then the rgb tint (alpha 1).
/// The linear block L = Ry·Rx·Rz·diag(scale); the translation is pos − L·center.
pub fn writeBonePalette(
    out: []f32,
    index: usize,
    pos: [3]f32,
    rot_deg: [3]f32,
    scale: [3]f32,
    center: [3]f32,
    color: [3]f32,
) void {
    const at = index * BONE_FLOATS;
    if (at + BONE_FLOATS > out.len) return;

    const rx = rot_deg[0] * DEG_TO_RAD;
    const ry = rot_deg[1] * DEG_TO_RAD;
    const rz = rot_deg[2] * DEG_TO_RAD;
    const crx = @cos(rx);
    const srx = @sin(rx);
    const cry = @cos(ry);
    const sry = @sin(ry);
    const crz = @cos(rz);
    const srz = @sin(rz);
    // Column-major copies of rebuild_model's mRy/mRx/mRz 3×3 blocks.
    const m_ry = [9]f32{ cry, 0, -sry, 0, 1, 0, sry, 0, cry };
    const m_rx = [9]f32{ 1, 0, 0, 0, crx, srx, 0, -srx, crx };
    const m_rz = [9]f32{ crz, srz, 0, -srz, crz, 0, 0, 0, 1 };
    const rot = mul3(mul3(m_ry, m_rx), m_rz);
    // L = R · diag(scale): scale each column.
    var l: [9]f32 = undefined;
    var col: usize = 0;
    while (col < 3) : (col += 1) {
        l[col * 3 + 0] = rot[col * 3 + 0] * scale[col];
        l[col * 3 + 1] = rot[col * 3 + 1] * scale[col];
        l[col * 3 + 2] = rot[col * 3 + 2] * scale[col];
    }
    // t = pos − L · center (the folded inverse-bind translation).
    const tx = pos[0] - (l[0] * center[0] + l[3] * center[1] + l[6] * center[2]);
    const ty = pos[1] - (l[1] * center[0] + l[4] * center[1] + l[7] * center[2]);
    const tz = pos[2] - (l[2] * center[0] + l[5] * center[1] + l[8] * center[2]);

    out[at + 0] = l[0];
    out[at + 1] = l[1];
    out[at + 2] = l[2];
    out[at + 3] = 0;
    out[at + 4] = l[3];
    out[at + 5] = l[4];
    out[at + 6] = l[5];
    out[at + 7] = 0;
    out[at + 8] = l[6];
    out[at + 9] = l[7];
    out[at + 10] = l[8];
    out[at + 11] = 0;
    out[at + 12] = tx;
    out[at + 13] = ty;
    out[at + 14] = tz;
    out[at + 15] = 1;
    out[at + 16] = color[0];
    out[at + 17] = color[1];
    out[at + 18] = color[2];
    out[at + 19] = 1;
}

/// The bind-pose entry: identity deformation (pose == rest) + the bone tint.
pub fn writeRestPalette(out: []f32, index: usize, center: [3]f32, color: [3]f32) void {
    writeBonePalette(out, index, center, .{ 0, 0, 0 }, .{ 1, 1, 1 }, center, color);
}
