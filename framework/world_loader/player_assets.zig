//! Player model, animation, and live-pose staging for the compiled world.
//!
//! Process-global ingress is isolated here; constructed scenes always receive owned copies.

const std = @import("std");
const constructor = @import("../world/constructor.zig");
const geometry = @import("geometry.zig");
const log = std.debug;
const buildCube = geometry.buildCube;

/// GLOBALS req_2770: a stand-in blocky figure for worlds whose bake carries no
/// PLAYER_MODEL lump (the editor's blank paint-first world) — tuning physics in
/// the playtest tab needs a VISIBLE body, not a silent camera target. Proportions
/// follow the scale contract (R4): 1.65m collider, stylized-tall ~2m visual
/// head-top. Feet at local y=0 (the baked player-model convention); each part is
/// one unit-cube group scaled/offset via the group transform, no texture. The
/// visor is an asymmetric marker so turning is visible while testing.
pub fn fallbackPlayerModel(allocator: std.mem.Allocator) ![]constructor.PlayerModelGroup {
    const cube = buildCube();
    const Part = struct { pos: [3]f32, scale: [3]f32, color: [3]f32 };
    const parts = [_]Part{
        .{ .pos = .{ -0.11, 0.475, 0 }, .scale = .{ 0.17, 0.95, 0.20 }, .color = .{ 0.24, 0.32, 0.48 } }, // left leg
        .{ .pos = .{ 0.11, 0.475, 0 }, .scale = .{ 0.17, 0.95, 0.20 }, .color = .{ 0.24, 0.32, 0.48 } }, // right leg
        .{ .pos = .{ 0, 1.275, 0 }, .scale = .{ 0.46, 0.65, 0.26 }, .color = .{ 0.30, 0.42, 0.38 } }, // torso
        .{ .pos = .{ -0.325, 1.30, 0 }, .scale = .{ 0.13, 0.60, 0.18 }, .color = .{ 0.30, 0.42, 0.38 } }, // left arm
        .{ .pos = .{ 0.325, 1.30, 0 }, .scale = .{ 0.13, 0.60, 0.18 }, .color = .{ 0.30, 0.42, 0.38 } }, // right arm
        .{ .pos = .{ 0, 1.82, 0 }, .scale = .{ 0.30, 0.32, 0.28 }, .color = .{ 0.78, 0.62, 0.50 } }, // head
        .{ .pos = .{ 0, 1.86, 0.16 }, .scale = .{ 0.22, 0.06, 0.06 }, .color = .{ 0.15, 0.15, 0.18 } }, // visor
    };
    var groups = try allocator.alloc(constructor.PlayerModelGroup, parts.len);
    var initialized: usize = 0;
    errdefer {
        for (groups[0..initialized]) |group| group.deinit(allocator);
        allocator.free(groups);
    }
    for (parts, 0..) |part, i| {
        const verts = try allocator.alloc(f32, cube.len);
        @memcpy(verts, cube[0..]);
        groups[i] = .{
            .color = part.color,
            .alpha = 1,
            .vertices = verts,
            .vertex_count = 36,
            .tex_w = 0,
            .tex_h = 0,
            .tex_rgba = null,
            .position = part.pos,
            .rotation = .{ 0, 0, 0 },
            .scale = part.scale,
        };
        initialized += 1;
    }
    return groups;
}

// ── the live-pushed player model (req_2780) ─────────────────────────────────
// The editor's EXPORTED player-role character (manifest placeable
// {as:'character', role:'player'}) replaces the stand-in figure in worlds whose
// gamefile carries no player lump (the blank editor/playtest world). The cart
// stages it through __compiled_world_set_player_model BEFORE the loader node
// constructs (the door is process-global, consumed at construct); pending
// survives remounts so every playtest session wears the last-pushed body until
// a new push or a clear. The gamefile lump, when present, still wins — this is
// the pre-Compile live lane, not a second bake truth.
var g_pending_player_model: []constructor.PlayerModelGroup = &.{};

/// Decode + store the pushed player model. `table_bytes` is a Float32Array of
/// 8-float rows [vertStart, vertCount, cx, cy, cz, r, g, b]; `verts_bytes` is
/// the concatenated stride-8 vertex pool the rows slice (vertices are LOCAL to
/// each group's center so future clips can pose the parts). Empty table clears.
pub fn setPendingPlayerModel(verts_bytes: []const u8, table_bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    for (g_pending_player_model) |group| group.deinit(alloc);
    if (g_pending_player_model.len > 0) alloc.free(g_pending_player_model);
    g_pending_player_model = &.{};

    const vert_floats = verts_bytes.len / 4;
    const rows = table_bytes.len / (8 * 4);
    if (rows == 0 or vert_floats == 0) return;
    const table = alloc.alloc(f32, rows * 8) catch return;
    defer alloc.free(table);
    @memcpy(std.mem.sliceAsBytes(table), table_bytes[0 .. rows * 8 * 4]);

    var groups: std.ArrayListUnmanaged(constructor.PlayerModelGroup) = .empty;
    var r: usize = 0;
    while (r < rows) : (r += 1) {
        const row = table[r * 8 ..][0..8];
        const start: usize = @trunc(@max(0.0, row[0]));
        const count: usize = @trunc(@max(0.0, row[1]));
        if (count == 0) continue;
        const lo = start * 8 * 4;
        const hi = (start + count) * 8 * 4;
        if (hi > verts_bytes.len or lo >= hi) continue;
        const verts = alloc.alloc(f32, count * 8) catch continue;
        @memcpy(std.mem.sliceAsBytes(verts), verts_bytes[lo..hi]);
        groups.append(alloc, .{
            .color = .{ row[5], row[6], row[7] },
            .alpha = 1,
            .vertices = verts,
            .vertex_count = @intCast(count),
            .tex_w = 0,
            .tex_h = 0,
            .tex_rgba = null,
            .position = .{ row[2], row[3], row[4] },
            .rotation = .{ 0, 0, 0 },
            .scale = .{ 1, 1, 1 },
        }) catch {
            alloc.free(verts);
            continue;
        };
    }
    g_pending_player_model = groups.toOwnedSlice(alloc) catch &.{};
    log.print("[loader] player model staged — {d} groups (req_2780)\n", .{g_pending_player_model.len});
}

/// Figure geometry intern keys must name CONTENT, not a slot (req_2790): the
/// geometry intern cache never evicts, so a stable "player-model-{i}" key wears
/// whatever the FIRST construct interned under it forever — the stand-in
/// figure's cubes survived into the exported body's first seven parts (a boxy
/// torso over correct feet). Hashing the verts into the key makes a
/// stand-in→export swap or a re-export intern fresh, while an unchanged body
/// still cache-hits.
pub fn geomContentHash(verts: []const f32) u64 {
    return std.hash.Wyhash.hash(0, std.mem.sliceAsBytes(verts));
}

/// Deep-copy the staged player model for a constructing scene (the scene owns
/// its copy — Scene.deinit frees it exactly like a decoded lump). Null when
/// nothing is staged.
pub fn pendingPlayerModelCopy(allocator: std.mem.Allocator) ?[]constructor.PlayerModelGroup {
    if (g_pending_player_model.len == 0) return null;
    const groups = allocator.alloc(constructor.PlayerModelGroup, g_pending_player_model.len) catch return null;
    var initialized: usize = 0;
    for (g_pending_player_model, 0..) |src, i| {
        const verts = allocator.alloc(f32, src.vertices.len) catch {
            for (groups[0..initialized]) |g2| g2.deinit(allocator);
            allocator.free(groups);
            return null;
        };
        @memcpy(verts, src.vertices);
        groups[i] = .{
            .color = src.color,
            .alpha = src.alpha,
            .vertices = verts,
            .vertex_count = src.vertex_count,
            .tex_w = 0,
            .tex_h = 0,
            .tex_rgba = null,
            .position = src.position,
            .rotation = src.rotation,
            .scale = src.scale,
        };
        initialized += 1;
    }
    return groups;
}

// ── the live-pushed player SKIN (SKIN-3499) ─────────────────────────────────
// The skinned figure: ONE model-space mesh with per-vertex bone indices and
// weights, staged beside (and preferred over) the per-part model. Same
// process-global staging discipline as the model door. Wire formats:
//   verts — stride-16 f32 rows [px,py,pz, nx,ny,nz, u,v, j0,j1,j2,j3, w0,w1,w2,w3]
//   bones — stride-8 f32 rows  [cx,cy,cz, r,g,b, reserved, reserved]
// Bone order == per-vertex joint indices == the animation clips' node order.
// Two empty arrays clear the staging.
var g_pending_player_skin: ?constructor.PlayerSkin = null;

pub fn setPendingPlayerSkin(verts_bytes: []const u8, bones_bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    if (g_pending_player_skin) |skin| skin.deinit(alloc);
    g_pending_player_skin = null;

    const vert_count = verts_bytes.len / (16 * 4);
    const bone_rows = bones_bytes.len / (8 * 4);
    if (vert_count == 0 or bone_rows == 0) return;
    const verts = alloc.alloc(f32, vert_count * 16) catch return;
    @memcpy(std.mem.sliceAsBytes(verts), verts_bytes[0 .. vert_count * 16 * 4]);
    const rows = alloc.alloc(f32, bone_rows * 8) catch {
        alloc.free(verts);
        return;
    };
    defer alloc.free(rows);
    @memcpy(std.mem.sliceAsBytes(rows), bones_bytes[0 .. bone_rows * 8 * 4]);
    const bones = alloc.alloc(constructor.PlayerSkinBone, bone_rows) catch {
        alloc.free(verts);
        return;
    };
    for (bones, 0..) |*bone, i| {
        const row = rows[i * 8 ..][0..8];
        bone.* = .{
            .center = .{ row[0], row[1], row[2] },
            .color = .{ row[3], row[4], row[5] },
        };
    }
    g_pending_player_skin = .{
        .vertices = verts,
        .vertex_count = @intCast(vert_count),
        .bones = bones,
    };
    log.print("[loader] player skin staged — {d} verts × {d} bones (SKIN-3499)\n", .{ vert_count, bone_rows });
}

/// Deep-copy the staged skin for a constructing scene (the scene owns its
/// copy — Scene.deinit frees it like every decoded lump). Null when nothing
/// is staged.
pub fn pendingPlayerSkinCopy(allocator: std.mem.Allocator) ?constructor.PlayerSkin {
    const src = g_pending_player_skin orelse return null;
    const verts = allocator.alloc(f32, src.vertices.len) catch return null;
    @memcpy(verts, src.vertices);
    const bones = allocator.alloc(constructor.PlayerSkinBone, src.bones.len) catch {
        allocator.free(verts);
        return null;
    };
    @memcpy(bones, src.bones);
    return .{ .vertices = verts, .vertex_count = src.vertex_count, .bones = bones };
}

// ── the live-pushed player ANIMATION (req_2781) ──────────────────────────────
// The basic animation shapes (idle/walk/jump/sit/lay) generated by the editor
// for the pushed body's exact node order — staged beside the model, consumed
// at construct when the gamefile carries no animation. Payload layout (f32):
// [nodeCount, clipCount, per clip: id, duration, looping, keyCount,
//  per key: time, per node: px,py,pz, rx,ry,rz, sx,sy,sz].
var g_pending_player_animation: ?constructor.PlayerAnimationSet = null;

pub fn setPendingPlayerAnimation(bytes: []const u8) void {
    const alloc = std.heap.page_allocator;
    if (g_pending_player_animation) |set| set.deinit(alloc);
    g_pending_player_animation = null;

    const float_count = bytes.len / 4;
    if (float_count < 2) return;
    const data = alloc.alloc(f32, float_count) catch return;
    defer alloc.free(data);
    @memcpy(std.mem.sliceAsBytes(data), bytes[0 .. float_count * 4]);

    const node_count: usize = @trunc(@max(0.0, data[0]));
    const clip_count: usize = @trunc(@max(0.0, data[1]));
    if (node_count == 0 or clip_count == 0) return;

    var clips: std.ArrayListUnmanaged(constructor.PlayerAnimationClip) = .empty;
    var at: usize = 2;
    var ci: usize = 0;
    decode: while (ci < clip_count) : (ci += 1) {
        if (at + 4 > data.len) break;
        const id: u32 = @trunc(@max(0.0, data[at]));
        const duration = data[at + 1];
        const looping = data[at + 2] != 0;
        const key_count: usize = @trunc(@max(0.0, data[at + 3]));
        at += 4;
        var keys: std.ArrayListUnmanaged(constructor.PlayerAnimationKeyframe) = .empty;
        var ki: usize = 0;
        while (ki < key_count) : (ki += 1) {
            if (at + 1 + node_count * 9 > data.len) {
                for (keys.items) |k| k.deinit(alloc);
                keys.deinit(alloc);
                break :decode;
            }
            const time = data[at];
            at += 1;
            const transforms = alloc.alloc(constructor.PlayerTransform, node_count) catch {
                for (keys.items) |k| k.deinit(alloc);
                keys.deinit(alloc);
                break :decode;
            };
            var ni: usize = 0;
            while (ni < node_count) : (ni += 1) {
                const t = data[at .. at + 9];
                transforms[ni] = .{
                    .position = .{ t[0], t[1], t[2] },
                    .rotation = .{ t[3], t[4], t[5] },
                    .scale = .{ t[6], t[7], t[8] },
                };
                at += 9;
            }
            keys.append(alloc, .{ .time = time, .transforms = transforms }) catch {
                alloc.free(transforms);
                for (keys.items) |k| k.deinit(alloc);
                keys.deinit(alloc);
                break :decode;
            };
        }
        const owned_keys = keys.toOwnedSlice(alloc) catch break :decode;
        clips.append(alloc, .{ .id = id, .duration = duration, .looping = looping, .keyframes = owned_keys }) catch {
            for (owned_keys) |k| k.deinit(alloc);
            alloc.free(owned_keys);
            break :decode;
        };
    }
    const owned = clips.toOwnedSlice(alloc) catch return;
    if (owned.len == 0) {
        alloc.free(owned);
        return;
    }
    g_pending_player_animation = .{
        .node_count = @intCast(node_count),
        .content_hash = [_]u8{0} ** 32,
        .clips = owned,
    };
    log.print("[loader] player animation staged — {d} clips × {d} nodes (req_2781)\n", .{ owned.len, node_count });
}

/// Deep-copy the staged animation for a constructing scene (scene owns its
/// copy). Null when nothing staged or the node count doesn't match the model.
pub fn pendingPlayerAnimationCopy(allocator: std.mem.Allocator, model_len: usize) ?constructor.PlayerAnimationSet {
    const src = g_pending_player_animation orelse return null;
    if (src.node_count != model_len) {
        log.print("[loader] staged animation skipped — {d} nodes vs {d} model groups\n", .{ src.node_count, model_len });
        return null;
    }
    const clips = allocator.alloc(constructor.PlayerAnimationClip, src.clips.len) catch return null;
    var ci: usize = 0;
    while (ci < src.clips.len) : (ci += 1) {
        const sclip = src.clips[ci];
        const keys = allocator.alloc(constructor.PlayerAnimationKeyframe, sclip.keyframes.len) catch {
            for (clips[0..ci]) |done_clip| done_clip.deinit(allocator);
            allocator.free(clips);
            return null;
        };
        var ki: usize = 0;
        while (ki < sclip.keyframes.len) : (ki += 1) {
            const transforms = allocator.alloc(constructor.PlayerTransform, sclip.keyframes[ki].transforms.len) catch {
                for (keys[0..ki]) |done_key| done_key.deinit(allocator);
                allocator.free(keys);
                for (clips[0..ci]) |done_clip| done_clip.deinit(allocator);
                allocator.free(clips);
                return null;
            };
            @memcpy(transforms, sclip.keyframes[ki].transforms);
            keys[ki] = .{ .time = sclip.keyframes[ki].time, .transforms = transforms };
        }
        clips[ci] = .{ .id = sclip.id, .duration = sclip.duration, .looping = sclip.looping, .keyframes = keys };
    }
    return .{ .node_count = src.node_count, .content_hash = [_]u8{0} ** 32, .clips = clips };
}

// ── the LIVE player pose (req_2786 — webcam capture drives the body) ────────
// The capture surface pushes per-node transforms every solve tick
// (__compiled_world_set_player_live_pose); while fresh they OVERRIDE the clip
// sampler entirely — the figure mirrors the camera. Node-scoped (the iso
// viewport's loader must never wear the capture pose) with the same slot
// discipline as the physics override. A stale pose (no push for ~3/4s)
// falls back to clips, so a dropped tracker never freezes the body.
pub const LIVE_POSE_STALE_FRAMES: u32 = 45;

pub const PendingPose = struct {
    node_id: u32 = 0,
    set: bool = false,
    transforms: []f32 = &.{}, // n × 9 floats (px,py,pz, rx,ry,rz, sx,sy,sz), page_allocator
    count: usize = 0,
    age_frames: u32 = 0,
};
var g_pending_pose: [4]PendingPose = .{ .{}, .{}, .{}, .{} };

pub fn pendingPoseFor(node_id: u32) ?*PendingPose {
    if (node_id == 0) return null;
    for (&g_pending_pose) |*p| {
        if (p.set and p.node_id == node_id) return p;
    }
    return null;
}

pub fn setPlayerLivePose(node_id: u32, bytes: []const u8) void {
    if (node_id == 0) return;
    const alloc = std.heap.page_allocator;
    var slot: ?*PendingPose = pendingPoseFor(node_id);
    if (slot == null) {
        for (&g_pending_pose) |*p| {
            if (!p.set) {
                slot = p;
                break;
            }
        }
    }
    const p = slot orelse return;
    const float_count = bytes.len / 4;
    if (float_count == 0 or float_count % 9 != 0) {
        clearPlayerLivePose(node_id);
        return;
    }
    if (p.transforms.len != float_count) {
        if (p.transforms.len > 0) alloc.free(p.transforms);
        p.transforms = alloc.alloc(f32, float_count) catch {
            p.transforms = &.{};
            p.set = false;
            return;
        };
    }
    @memcpy(std.mem.sliceAsBytes(p.transforms), bytes[0 .. float_count * 4]);
    p.node_id = node_id;
    p.set = true;
    p.count = float_count / 9;
    p.age_frames = 0;
}

pub fn clearPlayerLivePose(node_id: u32) void {
    const p = pendingPoseFor(node_id) orelse return;
    if (p.transforms.len > 0) std.heap.page_allocator.free(p.transforms);
    p.transforms = &.{};
    p.count = 0;
    p.set = false;
    p.node_id = 0;
}
