//! Native GLB/OBJ mesh loader — the HOST side of the "drop a model, view it" path.
//!
//! This is the Zig sibling of cart/hmsc-int/editors/model/importMesh.ts. That file
//! lifts triangle soup into an editable EditMesh (every face a JS object) so the
//! Studio can PAINT it — heavy, round-trips through React, and is the wrong tool when
//! all you want is to LOOK at a model. This module is the lean path: it reads the
//! file bytes, parses them entirely in Zig, and produces a flat, GPU-ready interleaved
//! vertex array. Nothing crosses the JS bridge except a short intern key + a couple of
//! scalars (see scene3d.internFromHost / __mesh_load_file). Load once, view native.
//!
//! Output is a NON-indexed triangle list in the exact `Vertex` layout the scene3d
//! pipeline draws (px,py,pz, nx,ny,nz, u,v — 8 f32/vertex, 3 vertices/triangle), so it
//! can be handed straight to internGeometry with zero further massaging. Normals are
//! taken from the file when present, otherwise computed per face. UVs default to 0.
//!
//! Supported: GLB v2 (TRIANGLES primitives, node TRS hierarchy, all meshes merged),
//! and Wavefront OBJ (v/vt/vn/f, n-gon fan triangulation, 1-based + negative indices).
//! A GLB's embedded base-colour image is also surfaced when every emitted primitive
//! can honestly share one image/UV contract. The GPU/editor boundary decides whether
//! to adopt those encoded bytes as a live paint atlas; this headless parser never
//! decodes image formats.

const std = @import("std");

/// Interleaved vertex, byte-identical to `Vertex` in framework/gpu/3d.zig. Kept as a
/// local mirror so this module has no dependency on the GPU layer (it stays headless-
/// testable). The compileError in 3d.zig guards the scene3d pipeline's matching stride.
pub const FLOATS_PER_VERTEX = 8;

/// One encoded base-colour image carried inside a GLB. This is deliberately the
/// narrow single-atlas case the model painter can represent without flattening a
/// multi-material model into the wrong image.
pub const EmbeddedTexture = struct {
    encoded: []u8,
    image_index: u32,
    color_factor: [3]f32,

    fn deinit(self: *const EmbeddedTexture, alloc: std.mem.Allocator) void {
        alloc.free(self.encoded);
    }
};

pub const ParsedMesh = struct {
    /// Interleaved, non-indexed: FLOATS_PER_VERTEX * vert_count floats.
    verts: []f32,
    /// Vertices (= triangles * 3). Hand straight to internGeometry as the draw count.
    vert_count: u32,
    /// Bounding-box centre, in the model's own space (no transform baked into verts).
    center: [3]f32,
    /// Bounding-sphere radius about `center`. The orbit camera frames the model from
    /// this, so an arbitrary-scale import always lands sensibly in view.
    radius: f32,
    /// Present only when every emitted GLB triangle has TEXCOORD_0 and resolves to
    /// the same embedded base-colour image with one common colour factor.
    embedded_texture: ?EmbeddedTexture = null,

    pub fn deinit(self: *const ParsedMesh, alloc: std.mem.Allocator) void {
        alloc.free(self.verts);
        if (self.embedded_texture) |*texture| texture.deinit(alloc);
    }
};

pub const Error = error{
    NotGlb,
    UnsupportedGlbVersion,
    MalformedGlb,
    MalformedInterleavedMesh,
    BadAccessor,
    UnsupportedPrimitive,
    NoGeometry,
} || std.mem.Allocator.Error || std.json.ParseError(std.json.Scanner);

// ── public entry: sniff by extension, read, dispatch ────────────────────────────
/// Read `path` and parse it into a ParsedMesh. Caller owns the result (deinit). The
/// extension picks the parser; `.glb`/`.gltf` → GLB, everything else → OBJ.
pub fn loadFile(io: std.Io, alloc: std.mem.Allocator, path: []const u8) Error!ParsedMesh {
    const bytes = std.Io.Dir.cwd().readFileAlloc(io, path, alloc, .limited(256 * 1024 * 1024)) catch {
        return Error.MalformedGlb;
    };
    defer alloc.free(bytes);
    if (hasExtIgnoreCase(path, ".glb") or hasExtIgnoreCase(path, ".gltf")) {
        return parseGlb(alloc, bytes);
    }
    return parseObj(alloc, bytes);
}

/// Adopt already-cooked interleaved triangle data into the same ParsedMesh shape as
/// OBJ/GLB imports. This is the "asset is ours now" path: no source-file semantics,
/// just validated scene3d vertices and bounds.
pub fn fromInterleaved(alloc: std.mem.Allocator, verts: []const f32, vert_count: u32) Error!ParsedMesh {
    if (vert_count == 0 or vert_count % 3 != 0) return Error.NoGeometry;
    const need = @as(usize, vert_count) * FLOATS_PER_VERTEX;
    if (need > verts.len) return Error.MalformedInterleavedMesh;

    const owned = try alloc.dupe(f32, verts[0..need]);
    errdefer alloc.free(owned);
    const bounds = boundsForInterleaved(owned, vert_count);
    return .{
        .verts = owned,
        .vert_count = vert_count,
        .center = bounds.center,
        .radius = bounds.radius,
    };
}

const MeshBounds = struct {
    center: [3]f32,
    radius: f32,
};

fn boundsForInterleaved(verts: []const f32, vert_count: u32) MeshBounds {
    var lo: [3]f32 = .{ verts[0], verts[1], verts[2] };
    var hi: [3]f32 = lo;
    var i: usize = 1;
    while (i < vert_count) : (i += 1) {
        const base = i * FLOATS_PER_VERTEX;
        inline for (0..3) |axis| {
            const value = verts[base + axis];
            if (value < lo[axis]) lo[axis] = value;
            if (value > hi[axis]) hi[axis] = value;
        }
    }
    const center: [3]f32 = .{
        (lo[0] + hi[0]) * 0.5,
        (lo[1] + hi[1]) * 0.5,
        (lo[2] + hi[2]) * 0.5,
    };
    var radius2: f32 = 0;
    i = 0;
    while (i < vert_count) : (i += 1) {
        const base = i * FLOATS_PER_VERTEX;
        const dx = verts[base + 0] - center[0];
        const dy = verts[base + 1] - center[1];
        const dz = verts[base + 2] - center[2];
        radius2 = @max(radius2, dx * dx + dy * dy + dz * dz);
    }
    return .{ .center = center, .radius = @max(1e-4, @sqrt(radius2)) };
}

fn hasExtIgnoreCase(path: []const u8, ext: []const u8) bool {
    if (path.len < ext.len) return false;
    return std.ascii.eqlIgnoreCase(path[path.len - ext.len ..], ext);
}

// ── shared: an accumulating, self-bbox-tracking interleaved vertex sink ──────────
const Builder = struct {
    out: std.ArrayList(f32) = .empty,
    lo: [3]f32 = .{ std.math.floatMax(f32), std.math.floatMax(f32), std.math.floatMax(f32) },
    hi: [3]f32 = .{ -std.math.floatMax(f32), -std.math.floatMax(f32), -std.math.floatMax(f32) },
    count: u32 = 0,
    texture_use: ?TextureUse = null,
    texture_compatible: bool = true,

    fn vertex(self: *Builder, alloc: std.mem.Allocator, p: [3]f32, n: [3]f32, uv: [2]f32) !void {
        try self.out.appendSlice(alloc, &.{ p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1] });
        inline for (0..3) |i| {
            if (p[i] < self.lo[i]) self.lo[i] = p[i];
            if (p[i] > self.hi[i]) self.hi[i] = p[i];
        }
        self.count += 1;
    }

    /// Append one triangle, deriving a flat face normal when `face_normal` is true
    /// (no source normals); otherwise the caller's per-corner normals are used as-is.
    fn triangle(self: *Builder, alloc: std.mem.Allocator, p: [3][3]f32, n: [3][3]f32, uv: [3][2]f32, face_normal: bool) !void {
        var nrm = n;
        if (face_normal) {
            const fn3 = faceNormal(p[0], p[1], p[2]);
            nrm = .{ fn3, fn3, fn3 };
        }
        try self.vertex(alloc, p[0], nrm[0], uv[0]);
        try self.vertex(alloc, p[1], nrm[1], uv[1]);
        try self.vertex(alloc, p[2], nrm[2], uv[2]);
    }

    fn noteTextureUse(self: *Builder, use: ?TextureUse, unit_uvs: bool) void {
        if (!unit_uvs or use == null) {
            self.texture_compatible = false;
            return;
        }
        const incoming = use.?;
        if (self.texture_use) |existing| {
            if (existing.image_index != incoming.image_index or
                !colorFactorsEqual(existing.color_factor, incoming.color_factor))
            {
                self.texture_compatible = false;
            }
        } else {
            self.texture_use = incoming;
        }
    }

    fn finish(self: *Builder, alloc: std.mem.Allocator) Error!ParsedMesh {
        if (self.count == 0) {
            self.out.deinit(alloc);
            return Error.NoGeometry;
        }
        const center: [3]f32 = .{
            (self.lo[0] + self.hi[0]) * 0.5,
            (self.lo[1] + self.hi[1]) * 0.5,
            (self.lo[2] + self.hi[2]) * 0.5,
        };
        const half: [3]f32 = .{ self.hi[0] - center[0], self.hi[1] - center[1], self.hi[2] - center[2] };
        const radius = @max(1e-4, @sqrt(half[0] * half[0] + half[1] * half[1] + half[2] * half[2]));
        return .{
            .verts = try self.out.toOwnedSlice(alloc),
            .vert_count = self.count,
            .center = center,
            .radius = radius,
        };
    }
};

fn faceNormal(a: [3]f32, b: [3]f32, c: [3]f32) [3]f32 {
    const e1: [3]f32 = .{ b[0] - a[0], b[1] - a[1], b[2] - a[2] };
    const e2: [3]f32 = .{ c[0] - a[0], c[1] - a[1], c[2] - a[2] };
    var n: [3]f32 = .{
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
    };
    const len = @sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (len > 1e-12) {
        n[0] /= len;
        n[1] /= len;
        n[2] /= len;
    } else {
        n = .{ 0, 1, 0 };
    }
    return n;
}

// ════════════════════════════════════════════════════════════════════════════════
// GLB v2
// ════════════════════════════════════════════════════════════════════════════════

const Mat4 = [16]f32;
fn mat4Identity() Mat4 {
    return .{ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 };
}
fn mat4Mul(a: Mat4, b: Mat4) Mat4 {
    var out: Mat4 = undefined;
    for (0..4) |col| {
        for (0..4) |row| {
            out[col * 4 + row] =
                a[row] * b[col * 4] +
                a[4 + row] * b[col * 4 + 1] +
                a[8 + row] * b[col * 4 + 2] +
                a[12 + row] * b[col * 4 + 3];
        }
    }
    return out;
}
/// Transform a point (w=1) by a column-major mat4.
fn mat4Point(m: Mat4, x: f32, y: f32, z: f32) [3]f32 {
    return .{
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    };
}
/// Transform a direction (w=0) by the upper-left 3×3 and renormalize. Correct for the
/// rotation+uniform-scale that node hierarchies almost always use; a viewer doesn't
/// need the inverse-transpose subtlety of non-uniform scale.
fn mat4Dir(m: Mat4, x: f32, y: f32, z: f32) [3]f32 {
    var n: [3]f32 = .{
        m[0] * x + m[4] * y + m[8] * z,
        m[1] * x + m[5] * y + m[9] * z,
        m[2] * x + m[6] * y + m[10] * z,
    };
    const len = @sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (len > 1e-12) {
        n[0] /= len;
        n[1] /= len;
        n[2] /= len;
    }
    return n;
}

fn jget(v: std.json.Value, key: []const u8) ?std.json.Value {
    return switch (v) {
        .object => |o| o.get(key),
        else => null,
    };
}
fn jInt(v: ?std.json.Value) ?i64 {
    const val = v orelse return null;
    return switch (val) {
        .integer => |i| i,
        .float => |f| @trunc(f),
        else => null,
    };
}
fn jFloat(v: ?std.json.Value) ?f32 {
    const val = v orelse return null;
    return switch (val) {
        .integer => |i| @floatFromInt(i),
        .float => |f| @floatCast(f),
        else => null,
    };
}
fn jArr(v: ?std.json.Value) ?std.json.Array {
    const val = v orelse return null;
    return switch (val) {
        .array => |a| a,
        else => null,
    };
}
fn jString(v: ?std.json.Value) ?[]const u8 {
    const val = v orelse return null;
    return switch (val) {
        .string => |s| s,
        else => null,
    };
}

const TextureUse = struct {
    image_index: u32,
    color_factor: [3]f32,
};

const TextureImportTuning = struct {
    /// The finite paint atlas cannot reproduce sampler wrapping. Tiny exporter
    /// round-off at an image boundary is accepted; genuinely tiled UVs are not.
    const unit_uv_epsilon: f32 = 0.0001;
};

fn colorFactorsEqual(a: [3]f32, b: [3]f32) bool {
    inline for (0..3) |channel| {
        if (!std.math.approxEqAbs(f32, a[channel], b[channel], 0.000001)) return false;
    }
    return true;
}

fn textureSourceIndex(texture: std.json.Value) ?u32 {
    if (jInt(jget(texture, "source"))) |source| {
        if (source >= 0 and source <= std.math.maxInt(u32)) return @intCast(source);
        return null;
    }
    const extensions = jget(texture, "extensions") orelse return null;
    const webp = jget(extensions, "EXT_texture_webp") orelse return null;
    const source = jInt(jget(webp, "source")) orelse return null;
    if (source < 0 or source > std.math.maxInt(u32)) return null;
    return @intCast(source);
}

/// Resolve the one base-colour sampling contract this primitive uses. Unsupported
/// texture-coordinate sets/transforms and vertex colour modulation fail closed:
/// geometry still imports, but no single paint look is advertised.
fn primitiveTextureUse(root: std.json.Value, prim: std.json.Value, has_texcoord_0: bool) ?TextureUse {
    if (!has_texcoord_0) return null;
    const attrs = jget(prim, "attributes") orelse return null;
    if (jget(attrs, "COLOR_0") != null) return null;

    const material_index = jInt(jget(prim, "material")) orelse return null;
    const materials = jArr(jget(root, "materials")) orelse return null;
    if (material_index < 0 or material_index >= materials.items.len) return null;
    const material = materials.items[@intCast(material_index)];
    const pbr = jget(material, "pbrMetallicRoughness") orelse return null;
    const base_texture = jget(pbr, "baseColorTexture") orelse return null;
    if ((jInt(jget(base_texture, "texCoord")) orelse 0) != 0) return null;
    if (jget(base_texture, "extensions")) |extensions| {
        if (jget(extensions, "KHR_texture_transform") != null) return null;
    }

    const texture_index = jInt(jget(base_texture, "index")) orelse return null;
    const textures = jArr(jget(root, "textures")) orelse return null;
    if (texture_index < 0 or texture_index >= textures.items.len) return null;
    const image_index = textureSourceIndex(textures.items[@intCast(texture_index)]) orelse return null;

    var factor: [3]f32 = .{ 1, 1, 1 };
    if (jget(pbr, "baseColorFactor") != null) {
        const values = jArr(jget(pbr, "baseColorFactor")) orelse return null;
        if (values.items.len < 3) return null;
        inline for (0..3) |channel| {
            const value = jFloat(values.items[channel]) orelse return null;
            if (!std.math.isFinite(value) or value < 0 or value > 1) return null;
            factor[channel] = value;
        }
    }
    return .{ .image_index = image_index, .color_factor = factor };
}

const Accessor = struct {
    count: u32,
    component_type: i64,
    comps: u32, // 1/2/3/4/16
    offset: u32, // absolute byte offset into the BIN chunk
    stride: u32, // byte stride between elements
};

fn componentBytes(component_type: i64) ?u32 {
    return switch (component_type) {
        5120, 5121 => 1, // (u)byte
        5122, 5123 => 2, // (u)short
        5125, 5126 => 4, // uint / float
        else => null,
    };
}
fn typeComps(t: []const u8) ?u32 {
    if (std.mem.eql(u8, t, "SCALAR")) return 1;
    if (std.mem.eql(u8, t, "VEC2")) return 2;
    if (std.mem.eql(u8, t, "VEC3")) return 3;
    if (std.mem.eql(u8, t, "VEC4")) return 4;
    if (std.mem.eql(u8, t, "MAT4")) return 16;
    return null;
}

fn readAccessor(root: std.json.Value, index: i64) ?Accessor {
    const accessors = jArr(jget(root, "accessors")) orelse return null;
    if (index < 0 or index >= accessors.items.len) return null;
    const a = accessors.items[@intCast(index)];
    const ct = jInt(jget(a, "componentType")) orelse return null;
    const type_str = switch (jget(a, "type") orelse return null) {
        .string => |s| s,
        else => return null,
    };
    const comps = typeComps(type_str) orelse return null;
    const cbytes = componentBytes(ct) orelse return null;

    const bv_index = jInt(jget(a, "bufferView")) orelse return null;
    const views = jArr(jget(root, "bufferViews")) orelse return null;
    if (bv_index < 0 or bv_index >= views.items.len) return null;
    const bv = views.items[@intCast(bv_index)];

    const bv_off: u32 = @intCast(jInt(jget(bv, "byteOffset")) orelse 0);
    const acc_off: u32 = @intCast(jInt(jget(a, "byteOffset")) orelse 0);
    const stride: u32 = if (jInt(jget(bv, "byteStride"))) |s| @intCast(s) else cbytes * comps;
    return .{
        .count = @intCast(jInt(jget(a, "count")) orelse return null),
        .component_type = ct,
        .comps = comps,
        .offset = bv_off + acc_off,
        .stride = stride,
    };
}

fn readComponent(bin: []const u8, at: u32, component_type: i64) ?f32 {
    return switch (component_type) {
        5120 => @as(f32, @as(i8, @bitCast(bin[at]))),
        5121 => @as(f32, bin[at]),
        5122 => @as(f32, std.mem.readInt(i16, bin[at..][0..2], .little)),
        5123 => @as(f32, std.mem.readInt(u16, bin[at..][0..2], .little)),
        5125 => @floatFromInt(std.mem.readInt(u32, bin[at..][0..4], .little)),
        5126 => @bitCast(std.mem.readInt(u32, bin[at..][0..4], .little)),
        else => null,
    };
}
fn readIndex(bin: []const u8, at: u32, component_type: i64) ?u32 {
    return switch (component_type) {
        5121 => bin[at],
        5123 => std.mem.readInt(u16, bin[at..][0..2], .little),
        5125 => std.mem.readInt(u32, bin[at..][0..4], .little),
        else => null,
    };
}

/// Read a VECn accessor into a freshly-allocated flat []f32 (comps per element).
fn readVecAccessor(alloc: std.mem.Allocator, bin: []const u8, acc: Accessor) Error![]f32 {
    const out = try alloc.alloc(f32, acc.count * acc.comps);
    errdefer alloc.free(out);
    const cbytes = componentBytes(acc.component_type) orelse return Error.BadAccessor;
    var i: u32 = 0;
    while (i < acc.count) : (i += 1) {
        const base = acc.offset + i * acc.stride;
        var c: u32 = 0;
        while (c < acc.comps) : (c += 1) {
            const at = base + c * cbytes;
            if (at + cbytes > bin.len) return Error.BadAccessor;
            out[i * acc.comps + c] = readComponent(bin, at, acc.component_type) orelse return Error.BadAccessor;
        }
    }
    return out;
}

fn nodeMatrix(node: std.json.Value) Mat4 {
    if (jArr(jget(node, "matrix"))) |m| {
        if (m.items.len == 16) {
            var out: Mat4 = undefined;
            for (0..16) |i| out[i] = jFloat(m.items[i]) orelse 0;
            return out;
        }
    }
    var t: [3]f32 = .{ 0, 0, 0 };
    var s: [3]f32 = .{ 1, 1, 1 };
    var r: [4]f32 = .{ 0, 0, 0, 1 };
    if (jArr(jget(node, "translation"))) |a| {
        if (a.items.len == 3) for (0..3) |i| {
            t[i] = jFloat(a.items[i]) orelse 0;
        };
    }
    if (jArr(jget(node, "scale"))) |a| {
        if (a.items.len == 3) for (0..3) |i| {
            s[i] = jFloat(a.items[i]) orelse 1;
        };
    }
    if (jArr(jget(node, "rotation"))) |a| {
        if (a.items.len == 4) for (0..4) |i| {
            r[i] = jFloat(a.items[i]) orelse 0;
        };
    }
    const x = r[0];
    const y = r[1];
    const z = r[2];
    const w = r[3];
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const xz = x * z;
    const yz = y * z;
    const wx = w * x;
    const wy = w * y;
    const wz = w * z;
    return .{
        (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0],     (2 * (xz - wy)) * s[0],     0,
        (2 * (xy - wz)) * s[1],     (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1],     0,
        (2 * (xz + wy)) * s[2],     (2 * (yz - wx)) * s[2],     (1 - 2 * (xx + yy)) * s[2], 0,
        t[0],                       t[1],                       t[2],                       1,
    };
}

/// Split a GLB into its JSON text + BIN slices (both borrow from `bytes`).
fn glbChunks(bytes: []const u8) Error!struct { json: []const u8, bin: []const u8 } {
    if (bytes.len < 12 or !std.mem.eql(u8, bytes[0..4], "glTF")) return Error.NotGlb;
    if (std.mem.readInt(u32, bytes[4..8], .little) != 2) return Error.UnsupportedGlbVersion;
    const total = std.mem.readInt(u32, bytes[8..12], .little);
    var at: u32 = 12;
    var json: ?[]const u8 = null;
    var bin: ?[]const u8 = null;
    while (at + 8 <= @min(total, bytes.len)) {
        const clen = std.mem.readInt(u32, bytes[at..][0..4], .little);
        const ctype = std.mem.readInt(u32, bytes[at + 4 ..][0..4], .little);
        const start = at + 8;
        if (start + clen > bytes.len) return Error.MalformedGlb;
        const data = bytes[start .. start + clen];
        if (ctype == 0x4E4F534A) json = data; // "JSON"
        if (ctype == 0x004E4942) bin = data; // "BIN\0"
        at = start + clen;
    }
    return .{
        .json = json orelse return Error.MalformedGlb,
        .bin = bin orelse return Error.MalformedGlb,
    };
}

pub fn parseGlb(alloc: std.mem.Allocator, bytes: []const u8) Error!ParsedMesh {
    const chunks = try glbChunks(bytes);
    var parsed = try std.json.parseFromSlice(std.json.Value, alloc, chunks.json, .{});
    defer parsed.deinit();
    const root = parsed.value;

    var b = Builder{};
    errdefer b.out.deinit(alloc);

    const scenes = jArr(jget(root, "scenes"));
    if (scenes != null and scenes.?.items.len > 0) {
        const scene_index: usize = @intCast(jInt(jget(root, "scene")) orelse 0);
        const scene = scenes.?.items[@min(scene_index, scenes.?.items.len - 1)];
        if (jArr(jget(scene, "nodes"))) |nodes| {
            for (nodes.items) |ni| {
                if (jInt(ni)) |idx| try visitNode(alloc, root, chunks.bin, &b, idx, mat4Identity());
            }
        }
    } else if (jArr(jget(root, "meshes"))) |meshes| {
        // No scene graph — draw every mesh at identity.
        for (meshes.items) |mesh| try emitMesh(alloc, root, chunks.bin, &b, mesh, mat4Identity());
    }

    var mesh = try b.finish(alloc);
    errdefer mesh.deinit(alloc);
    if (b.texture_compatible) {
        if (b.texture_use) |use| {
            if (try extractEmbeddedImage(alloc, root, chunks.bin, use.image_index)) |encoded| {
                mesh.embedded_texture = .{
                    .encoded = encoded,
                    .image_index = use.image_index,
                    .color_factor = use.color_factor,
                };
            }
        }
    }
    return mesh;
}

fn embeddedBufferViewBytes(
    alloc: std.mem.Allocator,
    root: std.json.Value,
    bin: []const u8,
    view_index: i64,
) Error!?[]u8 {
    const views = jArr(jget(root, "bufferViews")) orelse return null;
    if (view_index < 0 or view_index >= views.items.len) return null;
    const view = views.items[@intCast(view_index)];
    if ((jInt(jget(view, "buffer")) orelse 0) != 0) return null;
    const offset_raw = jInt(jget(view, "byteOffset")) orelse 0;
    const length_raw = jInt(jget(view, "byteLength")) orelse return null;
    if (offset_raw < 0 or length_raw <= 0) return null;
    const offset: usize = @intCast(offset_raw);
    const length: usize = @intCast(length_raw);
    if (offset > bin.len or length > bin.len - offset) return null;
    return try alloc.dupe(u8, bin[offset .. offset + length]);
}

fn embeddedDataUriBytes(alloc: std.mem.Allocator, uri: []const u8) Error!?[]u8 {
    if (!std.mem.startsWith(u8, uri, "data:")) return null;
    const comma = std.mem.indexOfScalar(u8, uri, ',') orelse return null;
    if (std.mem.indexOf(u8, uri[0..comma], ";base64") == null) return null;
    const payload = uri[comma + 1 ..];
    const decoder = std.base64.standard.Decoder;
    const decoded_len = decoder.calcSizeForSlice(payload) catch return null;
    if (decoded_len == 0) return null;
    const decoded = try alloc.alloc(u8, decoded_len);
    decoder.decode(decoded, payload) catch {
        alloc.free(decoded);
        return null;
    };
    return decoded;
}

fn extractEmbeddedImage(
    alloc: std.mem.Allocator,
    root: std.json.Value,
    bin: []const u8,
    image_index: u32,
) Error!?[]u8 {
    const images = jArr(jget(root, "images")) orelse return null;
    if (image_index >= images.items.len) return null;
    const image = images.items[image_index];
    if (jInt(jget(image, "bufferView"))) |view_index| {
        return embeddedBufferViewBytes(alloc, root, bin, view_index);
    }
    if (jString(jget(image, "uri"))) |uri| {
        return embeddedDataUriBytes(alloc, uri);
    }
    return null;
}

fn visitNode(alloc: std.mem.Allocator, root: std.json.Value, bin: []const u8, b: *Builder, node_index: i64, parent: Mat4) Error!void {
    const nodes = jArr(jget(root, "nodes")) orelse return;
    if (node_index < 0 or node_index >= nodes.items.len) return;
    const node = nodes.items[@intCast(node_index)];
    const m = mat4Mul(parent, nodeMatrix(node));
    if (jInt(jget(node, "mesh"))) |mesh_index| {
        const meshes = jArr(jget(root, "meshes")) orelse return Error.BadAccessor;
        if (mesh_index >= 0 and mesh_index < meshes.items.len) {
            try emitMesh(alloc, root, bin, b, meshes.items[@intCast(mesh_index)], m);
        }
    }
    if (jArr(jget(node, "children"))) |children| {
        for (children.items) |ci| {
            if (jInt(ci)) |idx| try visitNode(alloc, root, bin, b, idx, m);
        }
    }
}

fn emitMesh(alloc: std.mem.Allocator, root: std.json.Value, bin: []const u8, b: *Builder, mesh: std.json.Value, m: Mat4) Error!void {
    const prims = jArr(jget(mesh, "primitives")) orelse return;
    for (prims.items) |prim| try emitPrimitive(alloc, root, bin, b, prim, m);
}

fn emitPrimitive(alloc: std.mem.Allocator, root: std.json.Value, bin: []const u8, b: *Builder, prim: std.json.Value, m: Mat4) Error!void {
    const mode = jInt(jget(prim, "mode")) orelse 4;
    if (mode != 4) return; // only TRIANGLES — points/lines/strips are not a viewer concern

    const attrs = jget(prim, "attributes") orelse return;
    const pos_acc = readAccessor(root, jInt(jget(attrs, "POSITION")) orelse return Error.BadAccessor) orelse return Error.BadAccessor;
    if (pos_acc.comps != 3) return Error.BadAccessor;
    const positions = try readVecAccessor(alloc, bin, pos_acc);
    defer alloc.free(positions);

    var normals: ?[]f32 = null;
    if (jInt(jget(attrs, "NORMAL"))) |ni| {
        if (readAccessor(root, ni)) |na| {
            if (na.comps == 3 and na.count == pos_acc.count) normals = try readVecAccessor(alloc, bin, na);
        }
    }
    defer if (normals) |n| alloc.free(n);

    var uvs: ?[]f32 = null;
    if (jInt(jget(attrs, "TEXCOORD_0"))) |ui| {
        if (readAccessor(root, ui)) |ua| {
            if (ua.comps == 2 and ua.count == pos_acc.count) uvs = try readVecAccessor(alloc, bin, ua);
        }
    }
    defer if (uvs) |u| alloc.free(u);

    const vert_count = pos_acc.count;
    const texture_use = primitiveTextureUse(root, prim, uvs != null);
    var unit_uvs = true;
    const count_before = b.count;

    // Index stream — explicit, or implicit 0,1,2,… when absent.
    var indices: ?[]u32 = null;
    if (jInt(jget(prim, "indices"))) |ii| {
        const ia = readAccessor(root, ii) orelse return Error.BadAccessor;
        const idx = try alloc.alloc(u32, ia.count);
        const cbytes = componentBytes(ia.component_type) orelse return Error.BadAccessor;
        var i: u32 = 0;
        while (i < ia.count) : (i += 1) {
            const at = ia.offset + i * ia.stride;
            if (at + cbytes > bin.len) return Error.BadAccessor;
            idx[i] = readIndex(bin, at, ia.component_type) orelse return Error.BadAccessor;
        }
        indices = idx;
    }
    defer if (indices) |idx| alloc.free(idx);

    const tri_corners: u32 = if (indices) |idx| @intCast(idx.len) else vert_count;
    var t: u32 = 0;
    while (t + 3 <= tri_corners) : (t += 3) {
        const ca = if (indices) |idx| idx[t] else t;
        const cb = if (indices) |idx| idx[t + 1] else t + 1;
        const cc = if (indices) |idx| idx[t + 2] else t + 2;
        if (ca >= vert_count or cb >= vert_count or cc >= vert_count) continue;

        const corner = [3]u32{ ca, cb, cc };
        var p: [3][3]f32 = undefined;
        var n: [3][3]f32 = undefined;
        var uv: [3][2]f32 = undefined;
        inline for (0..3) |k| {
            const vi = corner[k];
            p[k] = mat4Point(m, positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
            if (normals) |src| {
                n[k] = mat4Dir(m, src[vi * 3], src[vi * 3 + 1], src[vi * 3 + 2]);
            } else {
                n[k] = .{ 0, 0, 0 };
            }
            uv[k] = if (uvs) |src| .{ src[vi * 2], src[vi * 2 + 1] } else .{ 0, 0 };
            inline for (0..2) |coordinate| {
                const value = uv[k][coordinate];
                if (!std.math.isFinite(value) or
                    value < -TextureImportTuning.unit_uv_epsilon or
                    value > 1 + TextureImportTuning.unit_uv_epsilon)
                {
                    unit_uvs = false;
                }
            }
        }
        try b.triangle(alloc, p, n, uv, normals == null);
    }
    if (b.count > count_before) b.noteTextureUse(texture_use, unit_uvs);
}

// ════════════════════════════════════════════════════════════════════════════════
// Wavefront OBJ
// ════════════════════════════════════════════════════════════════════════════════

pub fn parseObj(alloc: std.mem.Allocator, bytes: []const u8) Error!ParsedMesh {
    // Positions, texcoords, normals accumulate as the file lists them; faces reference
    // them by (1-based or negative) index. Two list types kept flat.
    var pos: std.ArrayList(f32) = .empty;
    defer pos.deinit(alloc);
    var tex: std.ArrayList(f32) = .empty;
    defer tex.deinit(alloc);
    var nrm: std.ArrayList(f32) = .empty;
    defer nrm.deinit(alloc);

    var b = Builder{};
    errdefer b.out.deinit(alloc);

    var lines = std.mem.splitScalar(u8, bytes, '\n');
    while (lines.next()) |raw| {
        const line = std.mem.trim(u8, raw, " \t\r");
        if (line.len == 0 or line[0] == '#') continue;
        var toks = std.mem.tokenizeAny(u8, line, " \t");
        const kind = toks.next() orelse continue;

        if (std.mem.eql(u8, kind, "v")) {
            try pushFloats(alloc, &pos, &toks, 3);
        } else if (std.mem.eql(u8, kind, "vt")) {
            try pushFloats(alloc, &tex, &toks, 2);
        } else if (std.mem.eql(u8, kind, "vn")) {
            try pushFloats(alloc, &nrm, &toks, 3);
        } else if (std.mem.eql(u8, kind, "f")) {
            try emitObjFace(alloc, &b, line, pos.items, tex.items, nrm.items);
        }
    }
    return b.finish(alloc);
}

fn pushFloats(alloc: std.mem.Allocator, list: *std.ArrayList(f32), toks: *std.mem.TokenIterator(u8, .any), n: u32) !void {
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        const t = toks.next() orelse "0";
        try list.append(alloc, std.fmt.parseFloat(f32, t) catch 0);
    }
}

/// Resolve an OBJ index: positive is 1-based, negative is relative to the end. Returns
/// a 0-based index into the flat list (one element = `comps` floats), or null if OOR.
fn resolveIndex(token: []const u8, list_elems: usize) ?usize {
    const v = std.fmt.parseInt(i64, token, 10) catch return null;
    if (v > 0) {
        const idx: usize = @intCast(v - 1);
        return if (idx < list_elems) idx else null;
    }
    if (v < 0) {
        const back: i64 = @as(i64, @intCast(list_elems)) + v;
        return if (back >= 0) @intCast(back) else null;
    }
    return null;
}

fn emitObjFace(alloc: std.mem.Allocator, b: *Builder, line: []const u8, pos: []const f32, tex: []const f32, nrm: []const f32) !void {
    // Gather the face's corners (fan-triangulated below). A face rarely exceeds a few
    // corners; cap generously and skip the overflow loudly-but-cheaply (drop extras).
    var cp: [64][3]f32 = undefined;
    var cn: [64][3]f32 = undefined;
    var cu: [64][2]f32 = undefined;
    var had_normal: [64]bool = undefined;
    var n_corners: usize = 0;

    var toks = std.mem.tokenizeAny(u8, line, " \t");
    _ = toks.next(); // skip "f"
    while (toks.next()) |corner| : (n_corners += 1) {
        if (n_corners >= cp.len) break;
        var parts = std.mem.splitScalar(u8, corner, '/');
        const v_tok = parts.next() orelse "";
        const vt_tok = parts.next() orelse "";
        const vn_tok = parts.next() orelse "";

        const pos_elems = pos.len / 3;
        const vi = resolveIndex(v_tok, pos_elems) orelse {
            n_corners -= 1; // not a real corner; undo the loop's += 1
            continue;
        };
        cp[n_corners] = .{ pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2] };

        cu[n_corners] = .{ 0, 0 };
        if (vt_tok.len > 0) {
            if (resolveIndex(vt_tok, tex.len / 2)) |ti| cu[n_corners] = .{ tex[ti * 2], tex[ti * 2 + 1] };
        }

        had_normal[n_corners] = false;
        cn[n_corners] = .{ 0, 0, 0 };
        if (vn_tok.len > 0) {
            if (resolveIndex(vn_tok, nrm.len / 3)) |ni| {
                cn[n_corners] = .{ nrm[ni * 3], nrm[ni * 3 + 1], nrm[ni * 3 + 2] };
                had_normal[n_corners] = true;
            }
        }
    }
    if (n_corners < 3) return;

    var i: usize = 1;
    while (i + 1 < n_corners) : (i += 1) {
        const tri_p: [3][3]f32 = .{ cp[0], cp[i], cp[i + 1] };
        const tri_n: [3][3]f32 = .{ cn[0], cn[i], cn[i + 1] };
        const tri_uv: [3][2]f32 = .{ cu[0], cu[i], cu[i + 1] };
        const have_all_normals = had_normal[0] and had_normal[i] and had_normal[i + 1];
        try b.triangle(alloc, tri_p, tri_n, tri_uv, !have_all_normals);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// Decimation — the live "quality" knob (vertex clustering)
// ════════════════════════════════════════════════════════════════════════════════
// Snap every vertex onto a grid³ lattice over the model's bounding box, collapse each
// cell's vertices to their average, and drop triangles that fold flat. Higher `grid` =
// finer cells = more surviving detail. One pass over verts + one over faces, memory-
// flat — this is what turns a 400k-tri scan into its general shape for the game (and
// what makes painting/raycasting on a huge model cheap: you edit the reduced mesh).
// The Zig sibling of importMesh.ts decimateSoup, but it works directly on the expanded
// (non-indexed) Vertex stream this module produces and re-emits the same stream.
//
// It also returns `face_to_source`: for each surviving decimated face, the ORIGINAL
// source-face index it was emitted from. That's the thread paint rides down a level —
// a displayed face inherits (and writes back) the colour of its source face, so paint
// is resolution-independent and every LoD derives from one authoritative paint.
pub const DecimatedMesh = struct {
    mesh: ParsedMesh,
    face_to_source: []u32, // length = mesh.vert_count / 3
    pub fn deinit(self: *const DecimatedMesh, alloc: std.mem.Allocator) void {
        self.mesh.deinit(alloc);
        alloc.free(self.face_to_source);
    }
};

pub fn decimateExpanded(alloc: std.mem.Allocator, verts: []const f32, vert_count: u32, grid: u32) Error!DecimatedMesh {
    const fc = vert_count / 3;
    if (fc == 0) return Error.NoGeometry;
    const R: u32 = @min(1024, @max(2, grid));

    // Bounding box over every input position.
    var lo: [3]f32 = .{ std.math.floatMax(f32), std.math.floatMax(f32), std.math.floatMax(f32) };
    var hi: [3]f32 = .{ -std.math.floatMax(f32), -std.math.floatMax(f32), -std.math.floatMax(f32) };
    var i: u32 = 0;
    while (i < vert_count) : (i += 1) {
        inline for (0..3) |k| {
            const v = verts[i * 8 + k];
            if (v < lo[k]) lo[k] = v;
            if (v > hi[k]) hi[k] = v;
        }
    }
    const ext = @max(@max(hi[0] - lo[0], hi[1] - lo[1]), hi[2] - lo[2]);
    const inv: f32 = if (ext > 1e-9) @as(f32, @floatFromInt(R)) / ext else 0;

    // Cluster: cell key → centroid accumulator. remap[v] = the input vert's cell index.
    var cell_map = std.AutoHashMap(u64, u32).init(alloc);
    defer cell_map.deinit();
    var sum = std.ArrayList([3]f64).empty;
    defer sum.deinit(alloc);
    var cnt = std.ArrayList(u32).empty;
    defer cnt.deinit(alloc);
    const remap = try alloc.alloc(u32, vert_count);
    defer alloc.free(remap);

    i = 0;
    while (i < vert_count) : (i += 1) {
        const x = verts[i * 8 + 0];
        const y = verts[i * 8 + 1];
        const z = verts[i * 8 + 2];
        const cellOf = struct {
            fn f(val: f32, base: f32, scale: f32, r: u32) u64 {
                var c: i64 = @trunc((val - base) * scale);
                if (c < 0) c = 0;
                if (c >= r) c = @as(i64, r) - 1;
                return @intCast(c);
            }
        }.f;
        const ix = cellOf(x, lo[0], inv, R);
        const iy = cellOf(y, lo[1], inv, R);
        const iz = cellOf(z, lo[2], inv, R);
        const key = ix + iy * R + iz * @as(u64, R) * R;
        const gop = try cell_map.getOrPut(key);
        if (!gop.found_existing) {
            gop.value_ptr.* = @intCast(sum.items.len);
            try sum.append(alloc, .{ x, y, z });
            try cnt.append(alloc, 1);
        } else {
            const ci = gop.value_ptr.*;
            sum.items[ci][0] += x;
            sum.items[ci][1] += y;
            sum.items[ci][2] += z;
            cnt.items[ci] += 1;
        }
        remap[i] = gop.value_ptr.*;
    }

    // Cell centroids.
    const centroids = try alloc.alloc([3]f32, sum.items.len);
    defer alloc.free(centroids);
    for (sum.items, cnt.items, 0..) |s, c, ci| {
        const count_f: f64 = c;
        const inv_c = 1.0 / count_f;
        centroids[ci] = .{ @floatCast(s[0] * inv_c), @floatCast(s[1] * inv_c), @floatCast(s[2] * inv_c) };
    }

    // Re-emit surviving (non-collapsed) triangles, recomputing face normals, and record
    // the source face each one came from (emit order == map order).
    var b = Builder{};
    errdefer b.out.deinit(alloc);
    var map = std.ArrayList(u32).empty;
    errdefer map.deinit(alloc);
    var f: u32 = 0;
    while (f < fc) : (f += 1) {
        const a = remap[f * 3 + 0];
        const bb = remap[f * 3 + 1];
        const cc = remap[f * 3 + 2];
        if (a == bb or bb == cc or a == cc) continue; // folded flat — drop
        const p: [3][3]f32 = .{ centroids[a], centroids[bb], centroids[cc] };
        const n: [3][3]f32 = .{ .{ 0, 0, 0 }, .{ 0, 0, 0 }, .{ 0, 0, 0 } };
        const uv: [3][2]f32 = .{ .{ 0, 0 }, .{ 0, 0 }, .{ 0, 0 } };
        try b.triangle(alloc, p, n, uv, true);
        try map.append(alloc, f);
    }
    const mesh = try b.finish(alloc);
    return .{ .mesh = mesh, .face_to_source = try map.toOwnedSlice(alloc) };
}

// ════════════════════════════════════════════════════════════════════════════════
// Tests — headless, no GPU. A hand-built minimal GLB + a tiny OBJ exercise both paths.
// ════════════════════════════════════════════════════════════════════════════════

test "obj: single triangle, computed normal + bbox" {
    const alloc = std.testing.allocator;
    const src =
        \\v 0 0 0
        \\v 1 0 0
        \\v 0 1 0
        \\f 1 2 3
    ;
    var mesh = try parseObj(alloc, src);
    defer mesh.deinit(alloc);
    try std.testing.expectEqual(@as(u32, 3), mesh.vert_count);
    // 8 floats/vertex.
    try std.testing.expectEqual(@as(usize, 24), mesh.verts.len);
    // Face normal of a CCW triangle in the XY plane points +Z.
    try std.testing.expectApproxEqAbs(@as(f32, 1.0), mesh.verts[5], 1e-5);
    // Centre is the bbox midpoint.
    try std.testing.expectApproxEqAbs(@as(f32, 0.5), mesh.center[0], 1e-5);
    try std.testing.expectApproxEqAbs(@as(f32, 0.5), mesh.center[1], 1e-5);
}

test "obj: quad fan-triangulates to two triangles" {
    const alloc = std.testing.allocator;
    const src =
        \\v 0 0 0
        \\v 1 0 0
        \\v 1 1 0
        \\v 0 1 0
        \\f 1 2 3 4
    ;
    var mesh = try parseObj(alloc, src);
    defer mesh.deinit(alloc);
    try std.testing.expectEqual(@as(u32, 6), mesh.vert_count); // 2 tris * 3
}

test "decimate: a fine grid of triangles collapses at low resolution" {
    const alloc = std.testing.allocator;
    // A 10×10 grid of vertices → 9×9×2 = 162 triangles spanning a unit square in z=0.
    var obj = std.ArrayList(u8).empty;
    defer obj.deinit(alloc);
    var aw: std.Io.Writer.Allocating = .fromArrayList(alloc, &obj);
    defer obj = aw.toArrayList();
    const w = &aw.writer;
    var r: u32 = 0;
    while (r < 10) : (r += 1) {
        var c: u32 = 0;
        while (c < 10) : (c += 1) {
            try w.print("v {d} {d} 0\n", .{ @as(f32, @floatFromInt(c)) / 9.0, @as(f32, @floatFromInt(r)) / 9.0 });
        }
    }
    r = 0;
    while (r < 9) : (r += 1) {
        var c: u32 = 0;
        while (c < 9) : (c += 1) {
            const a = r * 10 + c + 1;
            const b = a + 1;
            const d = a + 10;
            const e = d + 1;
            try w.print("f {d} {d} {d}\n", .{ a, b, d });
            try w.print("f {d} {d} {d}\n", .{ b, e, d });
        }
    }
    var full = try parseObj(alloc, aw.written());
    defer full.deinit(alloc);
    try std.testing.expectEqual(@as(u32, 162 * 3), full.vert_count);

    // Decimate to a coarse 3×3 lattice — far fewer triangles, still valid geometry.
    const low = try decimateExpanded(alloc, full.verts, full.vert_count, 3);
    defer low.deinit(alloc);
    try std.testing.expect(low.mesh.vert_count > 0);
    try std.testing.expect(low.mesh.vert_count < full.vert_count);
    // One source-face index per surviving decimated face, all in range.
    try std.testing.expectEqual(low.mesh.vert_count / 3, @as(u32, @intCast(low.face_to_source.len)));
    for (low.face_to_source) |sf| try std.testing.expect(sf < 162);
    // A fine lattice keeps (nearly) everything.
    const high = try decimateExpanded(alloc, full.verts, full.vert_count, 1024);
    defer high.deinit(alloc);
    try std.testing.expect(high.mesh.vert_count >= low.mesh.vert_count);
}

test "obj: negative (relative) indices resolve against verts-so-far" {
    const alloc = std.testing.allocator;
    const src =
        \\v 0 0 0
        \\v 1 0 0
        \\v 0 1 0
        \\f -3 -2 -1
    ;
    var mesh = try parseObj(alloc, src);
    defer mesh.deinit(alloc);
    try std.testing.expectEqual(@as(u32, 3), mesh.vert_count);
    try std.testing.expectApproxEqAbs(@as(f32, 0.0), mesh.verts[0], 1e-5);
}

test "glb: minimal single-triangle file round-trips" {
    const alloc = std.testing.allocator;
    const glb = try buildTestGlb(alloc);
    defer alloc.free(glb);
    var mesh = try parseGlb(alloc, glb);
    defer mesh.deinit(alloc);
    try std.testing.expectEqual(@as(u32, 3), mesh.vert_count);
    // Positions survive the BIN round-trip (third vertex is (0,1,0)).
    try std.testing.expectApproxEqAbs(@as(f32, 1.0), mesh.verts[2 * 8 + 1], 1e-5);
}

test "glb: one compatible embedded base-colour image is retained with source UVs" {
    const alloc = std.testing.allocator;
    const glb = try buildTexturedTestGlb(alloc, false);
    defer alloc.free(glb);
    var mesh = try parseGlb(alloc, glb);
    defer mesh.deinit(alloc);

    const texture = mesh.embedded_texture orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u32, 0), texture.image_index);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3, 4 }, texture.encoded);
    try std.testing.expectEqualSlices(f32, &.{ 0.5, 0.75, 1.0 }, &texture.color_factor);
    try std.testing.expectApproxEqAbs(@as(f32, 1.0), mesh.verts[1 * 8 + 6], 1e-5);
    try std.testing.expectApproxEqAbs(@as(f32, 1.0), mesh.verts[2 * 8 + 7], 1e-5);
}

test "glb: an untextured emitted primitive refuses a misleading single-atlas claim" {
    const alloc = std.testing.allocator;
    const glb = try buildTexturedTestGlb(alloc, true);
    defer alloc.free(glb);
    var mesh = try parseGlb(alloc, glb);
    defer mesh.deinit(alloc);

    try std.testing.expectEqual(@as(u32, 6), mesh.vert_count);
    try std.testing.expect(mesh.embedded_texture == null);
}

test "glb: embedded base64 data image bytes decode without involving image codecs" {
    const alloc = std.testing.allocator;
    const decoded = (try embeddedDataUriBytes(alloc, "data:image/png;base64,AQIDBA==")) orelse
        return error.TestUnexpectedResult;
    defer alloc.free(decoded);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3, 4 }, decoded);
    try std.testing.expect((try embeddedDataUriBytes(alloc, "external.png")) == null);
    try std.testing.expect((try embeddedDataUriBytes(alloc, "data:image/png;base64,not!base64")) == null);
}

test "glb: rejects non-glTF bytes" {
    const alloc = std.testing.allocator;
    try std.testing.expectError(Error.NotGlb, parseGlb(alloc, "not a glb at all!!"));
}

test "interleaved cooked triangle data adopts as a parsed mesh" {
    const alloc = std.testing.allocator;
    const verts = [_]f32{
        -1, 0, -2, 0, 1, 0, 0, 0,
        3,  0, -2, 0, 1, 0, 1, 0,
        -1, 2, 2,  0, 1, 0, 0, 1,
    };
    var mesh = try fromInterleaved(alloc, &verts, 3);
    defer mesh.deinit(alloc);
    try std.testing.expectEqual(@as(u32, 3), mesh.vert_count);
    try std.testing.expectApproxEqAbs(@as(f32, 1.0), mesh.center[0], 1e-5);
    try std.testing.expectApproxEqAbs(@as(f32, 1.0), mesh.center[1], 1e-5);
    try std.testing.expectApproxEqAbs(@as(f32, 0.0), mesh.center[2], 1e-5);
    try std.testing.expectApproxEqAbs(@sqrt(@as(f32, 9.0)), mesh.radius, 1e-5);
}

test "interleaved cooked mesh rejects incomplete vertex layout" {
    const alloc = std.testing.allocator;
    const verts = [_]f32{ 0, 0, 0, 0, 1, 0, 0 };
    try std.testing.expectError(Error.MalformedInterleavedMesh, fromInterleaved(alloc, &verts, 3));
}

fn assembleTestGlb(alloc: std.mem.Allocator, json: []const u8, bin: []const u8) ![]u8 {
    // Pad JSON to a 4-byte boundary with spaces (the GLB spec's filler).
    const json_pad = (4 - (json.len % 4)) % 4;
    const json_len = json.len + json_pad;
    const bin_pad = (4 - (bin.len % 4)) % 4;
    const bin_len = bin.len + bin_pad;
    const total = 12 + 8 + json_len + 8 + bin_len;

    var out = try alloc.alloc(u8, total);
    errdefer alloc.free(out);
    @memcpy(out[0..4], "glTF");
    std.mem.writeInt(u32, out[4..8], 2, .little);
    std.mem.writeInt(u32, out[8..12], @intCast(total), .little);
    // JSON chunk
    std.mem.writeInt(u32, out[12..16], @intCast(json_len), .little);
    std.mem.writeInt(u32, out[16..20], 0x4E4F534A, .little);
    @memcpy(out[20 .. 20 + json.len], json);
    for (0..json_pad) |i| out[20 + json.len + i] = ' ';
    // BIN chunk
    const bin_chunk = 20 + json_len;
    std.mem.writeInt(u32, out[bin_chunk..][0..4], @intCast(bin_len), .little);
    std.mem.writeInt(u32, out[bin_chunk + 4 ..][0..4], 0x004E4942, .little);
    @memcpy(out[bin_chunk + 8 ..][0..bin.len], bin);
    for (0..bin_pad) |i| out[bin_chunk + 8 + bin.len + i] = 0;
    return out;
}

/// Assemble a tiny valid GLB v2: one mesh, one triangle, indexed, POSITION only.
fn buildTestGlb(alloc: std.mem.Allocator) ![]u8 {
    // BIN: 3 vec3 positions (36 B) + 3 u16 indices (6 B), padded to 4 → 44 B.
    var bin: [44]u8 = [_]u8{0} ** 44;
    const pos = [_]f32{ 0, 0, 0, 1, 0, 0, 0, 1, 0 };
    for (pos, 0..) |f, i| std.mem.writeInt(u32, bin[i * 4 ..][0..4], @bitCast(f), .little);
    const idx = [_]u16{ 0, 1, 2 };
    for (idx, 0..) |v, i| std.mem.writeInt(u16, bin[36 + i * 2 ..][0..2], v, .little);

    const json =
        \\{"asset":{"version":"2.0"},"scene":0,
        \\"scenes":[{"nodes":[0]}],
        \\"nodes":[{"mesh":0}],
        \\"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1,"mode":4}]}],
        \\"accessors":[
        \\ {"bufferView":0,"componentType":5126,"count":3,"type":"VEC3"},
        \\ {"bufferView":1,"componentType":5123,"count":3,"type":"SCALAR"}],
        \\"bufferViews":[
        \\ {"buffer":0,"byteOffset":0,"byteLength":36},
        \\ {"buffer":0,"byteOffset":36,"byteLength":6}],
        \\"buffers":[{"byteLength":44}]}
    ;
    return assembleTestGlb(alloc, json, &bin);
}

fn buildTexturedTestGlb(alloc: std.mem.Allocator, include_untextured_primitive: bool) ![]u8 {
    // BIN: positions 36 B, UVs 24 B, indices 6 B + 2 B pad, encoded image 4 B.
    var bin: [72]u8 = [_]u8{0} ** 72;
    const pos = [_]f32{ 0, 0, 0, 1, 0, 0, 0, 1, 0 };
    for (pos, 0..) |f, i| std.mem.writeInt(u32, bin[i * 4 ..][0..4], @bitCast(f), .little);
    const uv = [_]f32{ 0, 0, 1, 0, 0, 1 };
    for (uv, 0..) |f, i| std.mem.writeInt(u32, bin[36 + i * 4 ..][0..4], @bitCast(f), .little);
    const idx = [_]u16{ 0, 1, 2 };
    for (idx, 0..) |v, i| std.mem.writeInt(u16, bin[60 + i * 2 ..][0..2], v, .little);
    @memcpy(bin[68..72], &[_]u8{ 1, 2, 3, 4 });

    const one_primitive =
        \\{"asset":{"version":"2.0"},"scene":0,
        \\"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0}],
        \\"meshes":[{"primitives":[
        \\ {"attributes":{"POSITION":0,"TEXCOORD_0":1},"indices":2,"material":0,"mode":4}]}],
        \\"materials":[{"pbrMetallicRoughness":{"baseColorTexture":{"index":0},"baseColorFactor":[0.5,0.75,1,1]}}],
        \\"textures":[{"source":0}],"images":[{"bufferView":3,"mimeType":"image/png"}],
        \\"accessors":[
        \\ {"bufferView":0,"componentType":5126,"count":3,"type":"VEC3"},
        \\ {"bufferView":1,"componentType":5126,"count":3,"type":"VEC2"},
        \\ {"bufferView":2,"componentType":5123,"count":3,"type":"SCALAR"}],
        \\"bufferViews":[
        \\ {"buffer":0,"byteOffset":0,"byteLength":36},
        \\ {"buffer":0,"byteOffset":36,"byteLength":24},
        \\ {"buffer":0,"byteOffset":60,"byteLength":6},
        \\ {"buffer":0,"byteOffset":68,"byteLength":4}],
        \\"buffers":[{"byteLength":72}]}
    ;
    const mixed_primitives =
        \\{"asset":{"version":"2.0"},"scene":0,
        \\"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0}],
        \\"meshes":[{"primitives":[
        \\ {"attributes":{"POSITION":0,"TEXCOORD_0":1},"indices":2,"material":0,"mode":4},
        \\ {"attributes":{"POSITION":0,"TEXCOORD_0":1},"indices":2,"mode":4}]}],
        \\"materials":[{"pbrMetallicRoughness":{"baseColorTexture":{"index":0},"baseColorFactor":[0.5,0.75,1,1]}}],
        \\"textures":[{"source":0}],"images":[{"bufferView":3,"mimeType":"image/png"}],
        \\"accessors":[
        \\ {"bufferView":0,"componentType":5126,"count":3,"type":"VEC3"},
        \\ {"bufferView":1,"componentType":5126,"count":3,"type":"VEC2"},
        \\ {"bufferView":2,"componentType":5123,"count":3,"type":"SCALAR"}],
        \\"bufferViews":[
        \\ {"buffer":0,"byteOffset":0,"byteLength":36},
        \\ {"buffer":0,"byteOffset":36,"byteLength":24},
        \\ {"buffer":0,"byteOffset":60,"byteLength":6},
        \\ {"buffer":0,"byteOffset":68,"byteLength":4}],
        \\"buffers":[{"byteLength":72}]}
    ;
    return assembleTestGlb(alloc, if (include_untextured_primitive) mixed_primitives else one_primitive, &bin);
}
