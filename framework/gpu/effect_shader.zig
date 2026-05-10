//! effect_shader.zig — Metadata for compiler-generated GPU effect shaders.

pub const GpuShaderDesc = struct {
    wgsl: []const u8,
};
