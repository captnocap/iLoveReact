//! compiled_world.zig — retained native Scene3D source for baked game-files.
//!
//! React owns only the viewport node. This module loads a baked game-file once,
//! constructs the platform Scene via world/constructor.zig, then supplies a
//! synthetic Scene3D node tree to gpu/3d.zig during paint. No V8 or React
//! reconciliation participates in the per-frame render path.

const std = @import("std");
const layout = @import("../layout.zig");
const constructor = @import("constructor.zig");

const Node = layout.Node;
const Color = layout.Color;

const MAX_WORLDS = 8;
const MAX_GAMEFILE_BYTES = 256 << 20;
const CUBE_KEY = "compiled-world:unit-cube";
const PLAYER_KEY_PREFIX = "compiled-world:player";
const LIGHT_AMBIENT = "ambient";
const LIGHT_DIRECTIONAL = "directional";
const CUBE_RADIUS: f32 = 0.8660254;

const UnitCubeVertices = cubeVertices();

const Entry = struct {
    active: bool = false,
    node_id: u32 = 0,
    allocator: std.mem.Allocator = std.heap.c_allocator,
    game_file: []u8 = &.{},
    store_dir: []u8 = &.{},
    scene: ?constructor.Scene = null,
    node: Node = .{},
    children: []Node = &.{},
    mesh_keys: [][]u8 = &.{},

    fn deinit(self: *Entry) void {
        if (self.scene) |scene| scene.deinit(self.allocator);
        for (self.mesh_keys) |key| self.allocator.free(key);
        if (self.mesh_keys.len > 0) self.allocator.free(self.mesh_keys);
        if (self.children.len > 0) self.allocator.free(self.children);
        if (self.game_file.len > 0) self.allocator.free(self.game_file);
        if (self.store_dir.len > 0) self.allocator.free(self.store_dir);
        self.* = .{};
    }
};

const Frame = struct {
    target: [3]f32,
    pos: [3]f32,
    far: f32,
    fov: f32,
};

var g_entries: [MAX_WORLDS]Entry = [_]Entry{.{}} ** MAX_WORLDS;

pub fn mount(allocator: std.mem.Allocator, node_id: u32, game_file: []const u8, store_dir: []const u8) !void {
    if (node_id == 0) return error.BadNodeId;
    unmount(node_id);

    const entry = findVacant() orelse return error.TooManyCompiledWorlds;
    entry.* = .{
        .active = true,
        .node_id = node_id,
        .allocator = allocator,
        .game_file = try allocator.dupe(u8, game_file),
        .store_dir = try allocator.dupe(u8, store_dir),
    };
    errdefer entry.deinit();

    const bytes = try std.fs.cwd().readFileAlloc(allocator, game_file, MAX_GAMEFILE_BYTES);
    defer allocator.free(bytes);

    var dir = try std.fs.cwd().openDir(store_dir, .{});
    defer dir.close();

    entry.scene = try constructor.construct(allocator, bytes, dir);
    try buildNode(entry);
}

pub fn unmount(node_id: u32) void {
    if (findByNodeId(node_id)) |entry| entry.deinit();
}

pub fn sceneNodeFor(node: *Node) ?*Node {
    const entry = findByNodeId(node.id) orelse return null;
    if (entry.scene == null) return null;
    return &entry.node;
}

pub fn statusAlloc(allocator: std.mem.Allocator, node_id: u32) ![]u8 {
    const entry = findByNodeId(node_id) orelse return try allocator.dupe(u8, "unmounted");
    const scene = entry.scene orelse return try allocator.dupe(u8, "loading");
    return std.fmt.allocPrint(
        allocator,
        "loaded {d} instances ({d} pieces), {d} player mesh groups",
        .{ scene.instance_count, scene.piece_count, scene.player_model.len },
    );
}

fn findByNodeId(node_id: u32) ?*Entry {
    for (&g_entries) |*entry| {
        if (entry.active and entry.node_id == node_id) return entry;
    }
    return null;
}

fn findVacant() ?*Entry {
    for (&g_entries) |*entry| {
        if (!entry.active) return entry;
    }
    return null;
}

fn buildNode(entry: *Entry) !void {
    const scene = &(entry.scene orelse return error.NoScene);
    const has_instances = scene.instance_count > 0 and scene.instance_stride >= 9 and scene.instances.len > 0;
    const fixed_children: usize = 5 + if (has_instances) @as(usize, 1) else 0;
    const child_count = fixed_children + scene.player_model.len;
    entry.children = try entry.allocator.alloc(Node, child_count);
    @memset(entry.children, .{});

    entry.node = .{
        .id = entry.node_id,
        .scene3d = true,
        .style = .{ .background_color = Color.rgb(13, 20, 31) },
        .children = entry.children,
    };

    const frame = computeFrame(scene);
    var at: usize = 0;

    entry.children[at] = .{
        .scene3d_camera = true,
        .scene3d_pos_x = frame.pos[0],
        .scene3d_pos_y = frame.pos[1],
        .scene3d_pos_z = frame.pos[2],
        .scene3d_look_x = frame.target[0],
        .scene3d_look_y = frame.target[1],
        .scene3d_look_z = frame.target[2],
        .scene3d_fov = frame.fov,
        .scene3d_far = frame.far,
        .scene3d_near = 0.05,
    };
    at += 1;

    entry.children[at] = .{
        .scene3d_skybox = true,
        .scene3d_sky_zenith = scene.env.sky_zenith,
        .scene3d_sky_horizon = scene.env.sky_horizon,
        .scene3d_sky_ground = scene.env.sky_ground,
        .scene3d_sky_sun_dir = scene.env.sky_sun_dir,
        .scene3d_sky_sun_color = scene.env.sky_sun_color,
        .scene3d_sky_haze = scene.env.sky_haze,
        .scene3d_sky_cloud = scene.env.sky_cloud,
        .scene3d_sky_night = scene.env.sky_night,
    };
    at += 1;

    entry.children[at] = .{
        .scene3d_light = true,
        .scene3d_light_type = LIGHT_AMBIENT,
        .scene3d_color_r = scene.env.ambient_color[0],
        .scene3d_color_g = scene.env.ambient_color[1],
        .scene3d_color_b = scene.env.ambient_color[2],
        .scene3d_intensity = scene.env.ambient_intensity,
    };
    at += 1;

    entry.children[at] = .{
        .scene3d_light = true,
        .scene3d_light_type = LIGHT_DIRECTIONAL,
        .scene3d_color_r = scene.env.dir_color[0],
        .scene3d_color_g = scene.env.dir_color[1],
        .scene3d_color_b = scene.env.dir_color[2],
        .scene3d_dir_x = scene.env.dir[0],
        .scene3d_dir_y = scene.env.dir[1],
        .scene3d_dir_z = scene.env.dir[2],
        .scene3d_intensity = scene.env.dir_intensity,
    };
    at += 1;

    entry.children[at] = .{
        .scene3d_fog = true,
        .scene3d_fog_near = frame.far * 0.62,
        .scene3d_fog_far = frame.far,
    };
    at += 1;

    if (has_instances) {
        entry.children[at] = .{
            .scene3d_mesh = true,
            .scene3d_geom_key = CUBE_KEY,
            .scene3d_vertices = UnitCubeVertices[0..],
            .scene3d_vert_count = @intCast(UnitCubeVertices.len / 8),
            .scene3d_bounds_radius = CUBE_RADIUS,
            .scene3d_instance_data = scene.instances,
            .scene3d_instance_count = scene.instance_count,
            .scene3d_instance_stride = scene.instance_stride,
        };
        at += 1;
    }

    entry.mesh_keys = try entry.allocator.alloc([]u8, scene.player_model.len);
    var initialized_keys: usize = 0;
    errdefer {
        for (entry.mesh_keys[0..initialized_keys]) |key| entry.allocator.free(key);
        entry.allocator.free(entry.mesh_keys);
        entry.mesh_keys = &.{};
    }

    for (scene.player_model, 0..) |group, i| {
        const key = try std.fmt.allocPrint(entry.allocator, "{s}:{d}:{d}", .{ PLAYER_KEY_PREFIX, entry.node_id, i });
        entry.mesh_keys[i] = key;
        initialized_keys += 1;
        entry.children[at] = .{
            .scene3d_mesh = true,
            .scene3d_geom_key = key,
            .scene3d_vertices = group.vertices,
            .scene3d_vert_count = group.vertex_count,
            .scene3d_bounds_radius = 3.0,
            .scene3d_color_r = group.color[0],
            .scene3d_color_g = group.color[1],
            .scene3d_color_b = group.color[2],
            .scene3d_color_a = group.alpha,
            .scene3d_pos_x = frame.target[0] + group.position[0],
            .scene3d_pos_y = group.position[1],
            .scene3d_pos_z = frame.target[2] + group.position[2],
            .scene3d_rot_x = group.rotation[0],
            .scene3d_rot_y = group.rotation[1],
            .scene3d_rot_z = group.rotation[2],
            .scene3d_scale_x = group.scale[0],
            .scene3d_scale_y = group.scale[1],
            .scene3d_scale_z = group.scale[2],
            .scene3d_tex_w = group.tex_w,
            .scene3d_tex_h = group.tex_h,
            .scene3d_tex_rgba = group.tex_rgba,
        };
        at += 1;
    }
}

fn computeFrame(scene: *const constructor.Scene) Frame {
    var min_x: f32 = 0;
    var max_x: f32 = @floatFromInt(@max(scene.width, 1));
    var min_z: f32 = 0;
    var max_z: f32 = @floatFromInt(@max(scene.height, 1));
    var min_y: f32 = 0;
    var max_y: f32 = 3;
    var saw = false;

    const count = if (scene.piece_count > 0) scene.piece_count else scene.instance_count;
    if (scene.instance_stride >= 9 and scene.instances.len >= @as(usize, count) * scene.instance_stride) {
        var i: u32 = 0;
        while (i < count) : (i += 1) {
            const base = @as(usize, i) * scene.instance_stride;
            const scale_base: usize = if (scene.instance_stride >= 12) 6 else 3;
            const px = scene.instances[base + 0];
            const py = scene.instances[base + 1];
            const pz = scene.instances[base + 2];
            const sx = @abs(scene.instances[base + scale_base + 0]);
            const sy = @abs(scene.instances[base + scale_base + 1]);
            const sz = @abs(scene.instances[base + scale_base + 2]);
            const lo_x = px - sx * 0.5;
            const hi_x = px + sx * 0.5;
            const lo_y = py - sy * 0.5;
            const hi_y = py + sy * 0.5;
            const lo_z = pz - sz * 0.5;
            const hi_z = pz + sz * 0.5;
            if (!saw) {
                min_x = lo_x;
                max_x = hi_x;
                min_y = lo_y;
                max_y = hi_y;
                min_z = lo_z;
                max_z = hi_z;
                saw = true;
            } else {
                min_x = @min(min_x, lo_x);
                max_x = @max(max_x, hi_x);
                min_y = @min(min_y, lo_y);
                max_y = @max(max_y, hi_y);
                min_z = @min(min_z, lo_z);
                max_z = @max(max_z, hi_z);
            }
        }
    }

    const span_x = @max(1.0, max_x - min_x);
    const span_z = @max(1.0, max_z - min_z);
    const span_y = @max(1.0, max_y - min_y);
    const horiz = @max(span_x, span_z);
    const target = [3]f32{
        (min_x + max_x) * 0.5,
        @max(0.8, min_y + span_y * 0.35),
        (min_z + max_z) * 0.5,
    };
    const cam_xz = horiz * scene.env.cam_horiz_factor + scene.env.cam_horiz_base;
    const cam_y = span_y * scene.env.cam_height_factor + scene.env.cam_height_base;
    const far = @max(80.0, @max(cam_xz * 2.5, horiz * scene.env.cam_far_factor + 48.0));
    return .{
        .target = target,
        .pos = .{ target[0] + cam_xz, target[1] + cam_y, target[2] + cam_xz },
        .far = far,
        .fov = scene.env.cam_fov,
    };
}

fn putVertex(out: *[36 * 8]f32, i: *usize, p: [3]f32, n: [3]f32, u: f32, v: f32) void {
    out[i.* + 0] = p[0];
    out[i.* + 1] = p[1];
    out[i.* + 2] = p[2];
    out[i.* + 3] = n[0];
    out[i.* + 4] = n[1];
    out[i.* + 5] = n[2];
    out[i.* + 6] = u;
    out[i.* + 7] = v;
    i.* += 8;
}

fn putFace(out: *[36 * 8]f32, i: *usize, a: [3]f32, b: [3]f32, c: [3]f32, d: [3]f32, n: [3]f32) void {
    putVertex(out, i, a, n, 0, 0);
    putVertex(out, i, b, n, 1, 0);
    putVertex(out, i, c, n, 1, 1);
    putVertex(out, i, a, n, 0, 0);
    putVertex(out, i, c, n, 1, 1);
    putVertex(out, i, d, n, 0, 1);
}

fn cubeVertices() [36 * 8]f32 {
    const l: f32 = -0.5;
    const r: f32 = 0.5;
    const b: f32 = -0.5;
    const t: f32 = 0.5;
    const n: f32 = -0.5;
    const f: f32 = 0.5;
    var out: [36 * 8]f32 = undefined;
    var i: usize = 0;
    putFace(&out, &i, .{ l, b, f }, .{ r, b, f }, .{ r, t, f }, .{ l, t, f }, .{ 0, 0, 1 });
    putFace(&out, &i, .{ r, b, n }, .{ l, b, n }, .{ l, t, n }, .{ r, t, n }, .{ 0, 0, -1 });
    putFace(&out, &i, .{ l, b, n }, .{ l, b, f }, .{ l, t, f }, .{ l, t, n }, .{ -1, 0, 0 });
    putFace(&out, &i, .{ r, b, f }, .{ r, b, n }, .{ r, t, n }, .{ r, t, f }, .{ 1, 0, 0 });
    putFace(&out, &i, .{ l, t, f }, .{ r, t, f }, .{ r, t, n }, .{ l, t, n }, .{ 0, 1, 0 });
    putFace(&out, &i, .{ l, b, n }, .{ r, b, n }, .{ r, b, f }, .{ l, b, f }, .{ 0, -1, 0 });
    return out;
}
