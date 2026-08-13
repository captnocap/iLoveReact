//! Strict saved-character construction for player and NPC consumers.
//!
//! Runtime never fits or solves. It accepts only a bound canonical skeleton, an
//! RJMD v5 logical mesh, and an RJSK v1 artifact whose intrinsic hashes match
//! freshly computed topology/semantic/skeleton/object-binding digests.

const std = @import("std");
const meshdoc_format = @import("../gpu/meshdoc_format.zig");
const skeleton_model = @import("../skeleton/skeleton.zig");
const skeleton_loader = @import("../skeleton/bones_loader.zig");
const skeleton_parser = @import("../skeleton/character_rig_session.zig");
const character_hashes = @import("../skeleton/character_hashes.zig");
const skin_binding = @import("../skeleton/skin_binding.zig");
const rig_pose = @import("../skeleton/rig_pose.zig");
const canonical = @import("../skeleton/generated/humanoid_v1.zig");

pub const MAX_ARTIFACT_BYTES: usize = 512 << 20;
pub const PALETTE_FLOATS_PER_BONE: usize = 20;

pub const CharacterAsset = struct {
    allocator: std.mem.Allocator,
    skeleton: skeleton_parser.OwnedCharacterSkeleton,
    /// Stable persisted palette identity in exact skeleton/RJSK order.
    bone_ids: []const []const u8,
    /// Capture-only channel identity derived from the descriptor's saved
    /// semantic bindings. Unmapped bones retain their stable persisted id.
    retarget_bone_ids: []const []const u8,
    /// Existing GPU wire: pos3, normal3, uv2, joint4, weight4.
    vertices: []f32,
    vertex_count: u32,
    rig_bones: []rig_pose.Bone,
    bind_global: []rig_pose.Mat4,
    inverse_bind: []rig_pose.Mat4,
    local_rotations: []rig_pose.Quat,
    global_pose: []rig_pose.Mat4,
    skin_matrices: []rig_pose.Mat4,
    /// mat4 + rgba per bone, consumed directly by the existing GPU LBS path.
    palette: []f32,
    /// The rig's own facing, solved from its anatomy at load (req_4291): the
    /// left/right role-bound pairs define the lateral axis, forward is
    /// cross(up, left→right), and this is the yaw (degrees) that rotates the
    /// body onto the canonical convention (forward = -Z). Placement sites add
    /// it, so a model authored facing any direction stands the right way
    /// everywhere — the skeleton solves facing exactly once.
    facing_yaw_offset_degrees: f32,
    geometry_artifact_hash: character_hashes.Hash,
    skin_artifact_hash: character_hashes.Hash,

    pub fn deinit(self: CharacterAsset) void {
        self.allocator.free(self.vertices);
        self.allocator.free(self.bone_ids);
        self.allocator.free(self.retarget_bone_ids);
        self.allocator.free(self.rig_bones);
        self.allocator.free(self.bind_global);
        self.allocator.free(self.inverse_bind);
        self.allocator.free(self.local_rotations);
        self.allocator.free(self.global_pose);
        self.allocator.free(self.skin_matrices);
        self.allocator.free(self.palette);
        var owned_skeleton = self.skeleton;
        owned_skeleton.deinit();
    }

    pub fn boneCount(self: *const CharacterAsset) usize {
        return self.rig_bones.len;
    }

    pub fn boneIds(self: *const CharacterAsset) []const []const u8 {
        return self.bone_ids;
    }

    pub fn retargetBoneIds(self: *const CharacterAsset) []const []const u8 {
        return self.retarget_bone_ids;
    }

    /// Apply absolute parent-space local quaternions and refresh the existing
    /// GPU matrix palette. Bind translations remain immutable inside rig_pose.
    pub fn evaluate(
        self: *CharacterAsset,
        root_translation: rig_pose.Vec3,
        requested_local_rotations: []const rig_pose.Quat,
    ) !void {
        try rig_pose.evaluate(
            self.rig_bones,
            self.inverse_bind,
            requested_local_rotations,
            root_translation,
            self.local_rotations,
            self.global_pose,
            self.skin_matrices,
        );
        writePalette(self.palette, self.skin_matrices);
    }
};

fn hashesFromRef(reference: skeleton_model.SkinBindingRef) !skin_binding.Hashes {
    return .{
        .topology = try character_hashes.parseHex(reference.topology_hash),
        .semantic = try character_hashes.parseHex(reference.semantic_hash),
        .skeleton = try character_hashes.parseHex(reference.skeleton_hash),
        .object_binding = try character_hashes.parseHex(reference.object_binding_hash),
    };
}

fn hashesEqual(left: skin_binding.Hashes, right: skin_binding.Hashes) bool {
    return std.mem.eql(u8, &left.topology, &right.topology) and
        std.mem.eql(u8, &left.semantic, &right.semantic) and
        std.mem.eql(u8, &left.skeleton, &right.skeleton) and
        std.mem.eql(u8, &left.object_binding, &right.object_binding);
}

fn skinReference(skeleton: skeleton_model.Skeleton) !skeleton_model.SkinBindingRef {
    const descriptor = skeleton.character_rig orelse return error.MissingCharacterDescriptor;
    if (descriptor.state != .bound) return error.CharacterNotBound;
    const meshes = skeleton.meshes orelse return error.MissingCharacterMesh;
    const skinned = switch (meshes) {
        .skinned => |value| value,
        .per_bone => return error.CharacterMeshNotSkinned,
    };
    if (skinned.geometry_path == null) return error.MissingGeometryPath;
    return skinned.binding orelse error.MissingSkinBinding;
}

fn jointConstraint(joint_value: ?skeleton_model.Joint, external_formation: bool) !rig_pose.Constraint {
    // SkinTokens supplies a hierarchy and bind pose but no authored joint-limit
    // table. Treat those joints as unconstrained so the role-driven retargeter
    // can pose them; a missing constraint on the canonical authored formation
    // retains the historical fixed behavior.
    const joint = joint_value orelse return if (external_formation) .unconstrained else .fixed;
    return switch (joint.kind) {
        .fixed => .fixed,
        .ball => .{ .ball = .{
            .swing_x = .{ .min = joint.swing_x.?.min, .max = joint.swing_x.?.max },
            .swing_z = .{ .min = joint.swing_z.?.min, .max = joint.swing_z.?.max },
            .twist_y = .{ .min = joint.twist_y.?.min, .max = joint.twist_y.?.max },
        } },
        .hinge => blk: {
            const axis = joint.axis orelse return error.InvalidHingeAxis;
            if (@abs(axis[0]) < 0.999 or @abs(axis[1]) > 0.001 or @abs(axis[2]) > 0.001) {
                return error.InvalidHingeAxis;
            }
            const minimum = joint.limit_min orelse return error.MissingHingeLimit;
            const maximum = joint.limit_max orelse return error.MissingHingeLimit;
            break :blk .{ .hinge_x = if (axis[0] >= 0)
                .{ .min = minimum, .max = maximum }
            else
                .{ .min = -maximum, .max = -minimum } };
        },
        .slide, .pivot, .spin => return error.UnsupportedCharacterJoint,
    };
}

fn externalFormation(skeleton: skeleton_model.Skeleton) bool {
    const descriptor = skeleton.character_rig orelse return false;
    if (descriptor.external_provenance != null) return true;
    for (descriptor.fit) |entry| if (entry.source == .external) return true;
    return false;
}

fn buildRigBones(allocator: std.mem.Allocator, skeleton: skeleton_model.Skeleton) ![]rig_pose.Bone {
    const external_formation = externalFormation(skeleton);
    if (!external_formation and skeleton.bones.len != canonical.HUMANOID_V1_BONE_IDS.len) {
        return error.InvalidCanonicalBoneCount;
    }
    const result = try allocator.alloc(rig_pose.Bone, skeleton.bones.len);
    errdefer allocator.free(result);
    for (skeleton.bones, 0..) |bone, index| {
        if (!external_formation and !std.mem.eql(u8, bone.id, canonical.HUMANOID_V1_BONE_IDS[index])) {
            return error.UnstablePaletteOrder;
        }
        result[index] = .{
            .parent_index = if (bone.parent) |parent_id| blk: {
                var found: ?u8 = null;
                for (skeleton.bones[0..index], 0..) |candidate, parent_index| {
                    if (std.mem.eql(u8, candidate.id, parent_id)) {
                        found = @intCast(parent_index);
                        break;
                    }
                }
                break :blk found orelse return error.ParentMustPrecedeChild;
            } else null,
            .bind_translation = bone.transform.pos,
            .bind_rotation = bone.transform.rot,
            .constraint = try jointConstraint(bone.joint, external_formation),
        };
    }
    return result;
}

fn pairedRetargetId(
    side: ?skeleton_model.HumanoidSide,
    left: []const u8,
    right: []const u8,
) ![]const u8 {
    return switch (side orelse return error.InvalidSemanticSide) {
        .left => left,
        .right => right,
    };
}

fn semanticRetargetId(binding: skeleton_model.HumanoidSemanticBinding) ![]const u8 {
    return switch (binding.role) {
        .pelvis => "pelvis",
        .abdomen => "spine_lower",
        .chest => "spine_upper",
        .head => "head",
        .neck => "neck",
        .clavicle => pairedRetargetId(binding.side, "clavicle_left", "clavicle_right"),
        .upper_arm => pairedRetargetId(binding.side, "upper_arm_left", "upper_arm_right"),
        .lower_arm => pairedRetargetId(binding.side, "lower_arm_left", "lower_arm_right"),
        .hand => pairedRetargetId(binding.side, "hand_left", "hand_right"),
        .fingers => pairedRetargetId(binding.side, "fingers_left", "fingers_right"),
        .upper_leg => pairedRetargetId(binding.side, "upper_leg_left", "upper_leg_right"),
        .lower_leg => pairedRetargetId(binding.side, "lower_leg_left", "lower_leg_right"),
        .foot => pairedRetargetId(binding.side, "foot_left", "foot_right"),
        .toes => pairedRetargetId(binding.side, "toes_left", "toes_right"),
    };
}

fn buildBoneIds(
    allocator: std.mem.Allocator,
    skeleton: skeleton_model.Skeleton,
    semantic_aliases: bool,
) ![]const []const u8 {
    const ids = try allocator.alloc([]const u8, skeleton.bones.len);
    errdefer allocator.free(ids);
    for (skeleton.bones, 0..) |bone, index| ids[index] = bone.id;
    if (semantic_aliases) {
        const descriptor = skeleton.character_rig orelse return error.MissingCharacterDescriptor;
        for (descriptor.semantic_bindings) |binding| {
            var bone_index: ?usize = null;
            for (skeleton.bones, 0..) |bone, index| {
                if (std.mem.eql(u8, bone.id, binding.bone_id)) {
                    bone_index = index;
                    break;
                }
            }
            ids[bone_index orelse return error.MissingSemanticBone] = try semanticRetargetId(binding);
        }
    }
    for (ids, 0..) |id, index| {
        if (id.len == 0) return error.EmptyBoneId;
        for (ids[0..index]) |prior| {
            if (std.mem.eql(u8, prior, id)) return error.DuplicateBoneId;
        }
    }
    return ids;
}

const FACING_PAIRS = [_][2][]const u8{
    .{ "upper_arm_left", "upper_arm_right" },
    .{ "upper_leg_left", "upper_leg_right" },
    .{ "clavicle_left", "clavicle_right" },
};

/// Solve the rig's facing from its own left/right anatomy. Returns the yaw
/// (degrees, about +Y) from the canonical forward (-Z) to this rig's forward.
/// A rig binding no side pairs (props, single bones) faces canonically by
/// definition and returns zero.
pub fn facingYawOffsetDegrees(
    retarget_ids: []const []const u8,
    bind_global: []const rig_pose.Mat4,
) f32 {
    var left_sum: [3]f32 = .{ 0, 0, 0 };
    var right_sum: [3]f32 = .{ 0, 0, 0 };
    var pair_count: f32 = 0;
    for (FACING_PAIRS) |pair| {
        var left_position: ?[3]f32 = null;
        var right_position: ?[3]f32 = null;
        for (retarget_ids, 0..) |id, index| {
            const origin = [3]f32{ bind_global[index][12], bind_global[index][13], bind_global[index][14] };
            if (std.mem.eql(u8, id, pair[0])) left_position = origin;
            if (std.mem.eql(u8, id, pair[1])) right_position = origin;
        }
        const left = left_position orelse continue;
        const right = right_position orelse continue;
        for (0..3) |axis| {
            left_sum[axis] += left[axis];
            right_sum[axis] += right[axis];
        }
        pair_count += 1;
    }
    if (pair_count == 0) return 0;
    const lateral = [3]f32{
        (right_sum[0] - left_sum[0]) / pair_count,
        (right_sum[1] - left_sum[1]) / pair_count,
        (right_sum[2] - left_sum[2]) / pair_count,
    };
    // forward = cross(up=(0,1,0), left→right) = (lateral.z, 0, -lateral.x).
    const forward = [2]f32{ lateral[2], -lateral[0] };
    if (@sqrt(forward[0] * forward[0] + forward[1] * forward[1]) < 1.0e-6) return 0;
    // Canonical forward is (0, -1) in this (x, z) plane; zero offset there.
    const radians = std.math.atan2(forward[0], -forward[1]);
    return radians * 180.0 / std.math.pi;
}

fn writePalette(palette: []f32, matrices: []const rig_pose.Mat4) void {
    if (palette.len != matrices.len * PALETTE_FLOATS_PER_BONE) return;
    for (matrices, 0..) |matrix, index| {
        const at = index * PALETTE_FLOATS_PER_BONE;
        @memcpy(palette[at .. at + 16], &matrix);
        // Ordinary play is not a weight-debug view; native rig inspection owns
        // the selected-bone heatmap. White preserves authored mesh colour here.
        palette[at + 16] = 1;
        palette[at + 17] = 1;
        palette[at + 18] = 1;
        palette[at + 19] = 1;
    }
}

fn expandVertices(
    allocator: std.mem.Allocator,
    doc: *const meshdoc_format.Document,
    binding: *const skin_binding.Binding,
    palette_map: []const u8,
) ![]f32 {
    const logical_ids = doc.render_corner_logical_ids orelse return error.MissingLogicalTopology;
    const influences = try allocator.alloc(skin_binding.GpuInfluence, logical_ids.len);
    defer allocator.free(influences);
    try skin_binding.expandLogicalToCorners(
        binding.bone_indices,
        binding.weights,
        palette_map,
        logical_ids,
        influences,
    );
    const vertices = try allocator.alloc(f32, logical_ids.len * 16);
    errdefer allocator.free(vertices);
    for (influences, 0..) |influence, corner| {
        const source = corner * 8;
        const target = corner * 16;
        @memcpy(vertices[target .. target + 8], doc.verts[source .. source + 8]);
        for (0..4) |slot| {
            vertices[target + 8 + slot] = @floatFromInt(influence.joints[slot]);
            vertices[target + 12 + slot] = @as(f32, @floatFromInt(influence.weights[slot])) / 255.0;
        }
    }
    return vertices;
}

fn rootIsUnweighted(binding: *const skin_binding.Binding) bool {
    var root_index: ?u16 = null;
    for (binding.bone_ids, 0..) |bone_id, index| {
        if (std.mem.eql(u8, bone_id, "root")) {
            root_index = @intCast(index);
            break;
        }
    }
    const index = root_index orelse return true;
    for (binding.bone_indices) |row| for (row) |bone_index| {
        if (bone_index == index) return false;
    };
    return true;
}

/// The descriptor is keyed by stable object ID and may be authored in any order.
/// Geometry range rank is never an identity source: every persisted RJMD range ID
/// must have exactly one descriptor binding before topology hashes are evaluated.
pub fn objectBindingsCoverRangeIds(
    bindings: []const skeleton_model.CharacterObjectBinding,
    range_object_ids: []const []const u8,
) bool {
    if (bindings.len == 0 or bindings.len != range_object_ids.len) return false;
    for (range_object_ids, 0..) |object_id, range_index| {
        if (object_id.len == 0) return false;
        for (range_object_ids[0..range_index]) |prior| {
            if (std.mem.eql(u8, prior, object_id)) return false;
        }
        var matches: usize = 0;
        for (bindings) |binding| {
            if (std.mem.eql(u8, binding.objectId(), object_id)) matches += 1;
        }
        if (matches != 1) return false;
    }
    return true;
}

pub fn loadBytes(
    allocator: std.mem.Allocator,
    geometry_bytes: []const u8,
    skin_bytes: []const u8,
    skeleton_json: []const u8,
) !CharacterAsset {
    var owned_skeleton = try skeleton_parser.parseOwnedCharacterSkeleton(allocator, skeleton_json);
    errdefer owned_skeleton.deinit();
    const skeleton = owned_skeleton.skeleton();
    const verdict = try skeleton_loader.validate(allocator, skeleton, skeleton_loader.accept_all);
    if (!verdict.accepted()) return error.CharacterSkeletonRejected;
    const reference = try skinReference(skeleton);
    if (reference.version != 1 or reference.max_influences != 4) return error.UnsupportedSkinBinding;

    var document = try meshdoc_format.decodeDocument(allocator, geometry_bytes);
    defer document.deinit(allocator);
    if (document.version != meshdoc_format.VERSION_LOGICAL_TOPOLOGY or
        document.render_corner_logical_ids == null or document.groups == null or
        document.semantic_regions == null or document.semantic_instances == null or
        document.semantic_table_json == null)
    {
        return error.CharacterRequiresRjmdV5;
    }
    if (document.logical_vertex_count != reference.logical_vertex_count) return error.LogicalVertexCountMismatch;
    const descriptor = skeleton.character_rig.?;
    const object_ids = document.range_object_ids orelse return error.MissingRangeObjectIds;
    if (!objectBindingsCoverRangeIds(descriptor.object_bindings, object_ids)) {
        return error.ObjectBindingCoverage;
    }

    const computed_hashes = skin_binding.Hashes{
        .topology = try character_hashes.topologyHash(allocator, .{
            .logical_vertex_count = document.logical_vertex_count,
            .render_corner_logical_ids = document.render_corner_logical_ids.?,
            .face_groups = document.groups.?,
            .ranges = document.ranges,
            .range_object_ids = object_ids,
        }),
        .semantic = try character_hashes.semanticHash(allocator, .{
            .render_corner_logical_ids = document.render_corner_logical_ids.?,
            .semantic_regions = document.semantic_regions.?,
            .semantic_instances = document.semantic_instances.?,
            .semantic_table_json = document.semantic_table_json.?,
        }),
        .skeleton = try character_hashes.skeletonHash(skeleton.bones),
        .object_binding = try character_hashes.objectBindingHash(allocator, descriptor.object_bindings),
    };
    const referenced_hashes = try hashesFromRef(reference);
    if (!hashesEqual(computed_hashes, referenced_hashes)) return error.StaleSkinBinding;

    var binding = try skin_binding.decodeExpected(allocator, skin_bytes, referenced_hashes);
    defer binding.deinit();
    if (binding.logical_vertex_count != document.logical_vertex_count) return error.LogicalVertexCountMismatch;
    if (!rootIsUnweighted(&binding)) return error.RootBoneWeighted;
    const expected_skin_artifact = try character_hashes.parseHex(reference.artifact_hash);
    const actual_skin_artifact = skin_binding.artifactHash(skin_bytes);
    if (!std.mem.eql(u8, &expected_skin_artifact, &actual_skin_artifact)) return error.SkinArtifactHashMismatch;

    const bone_ids = try buildBoneIds(allocator, skeleton, false);
    errdefer allocator.free(bone_ids);
    const retarget_bone_ids = try buildBoneIds(allocator, skeleton, true);
    errdefer allocator.free(retarget_bone_ids);
    const palette_map = try allocator.alloc(u8, binding.bone_ids.len);
    defer allocator.free(palette_map);
    try skin_binding.stableIdPaletteMap(binding.bone_ids, bone_ids, palette_map);
    const vertices = try expandVertices(allocator, &document, &binding, palette_map);
    errdefer allocator.free(vertices);
    const rig_bones = try buildRigBones(allocator, skeleton);
    errdefer allocator.free(rig_bones);
    const bind_global = try allocator.alloc(rig_pose.Mat4, rig_bones.len);
    errdefer allocator.free(bind_global);
    const inverse_bind = try allocator.alloc(rig_pose.Mat4, rig_bones.len);
    errdefer allocator.free(inverse_bind);
    try rig_pose.prepareBind(rig_bones, bind_global, inverse_bind);
    const local_rotations = try allocator.alloc(rig_pose.Quat, rig_bones.len);
    errdefer allocator.free(local_rotations);
    const requested = try allocator.alloc(rig_pose.Quat, rig_bones.len);
    defer allocator.free(requested);
    for (rig_bones, requested) |bone, *rotation| rotation.* = bone.bind_rotation;
    const global_pose = try allocator.alloc(rig_pose.Mat4, rig_bones.len);
    errdefer allocator.free(global_pose);
    const skin_matrices = try allocator.alloc(rig_pose.Mat4, rig_bones.len);
    errdefer allocator.free(skin_matrices);
    const palette = try allocator.alloc(f32, rig_bones.len * PALETTE_FLOATS_PER_BONE);
    errdefer allocator.free(palette);
    try rig_pose.evaluate(
        rig_bones,
        inverse_bind,
        requested,
        .{ 0, 0, 0 },
        local_rotations,
        global_pose,
        skin_matrices,
    );
    writePalette(palette, skin_matrices);

    var geometry_artifact_hash: character_hashes.Hash = undefined;
    std.crypto.hash.sha2.Sha256.hash(geometry_bytes, &geometry_artifact_hash, .{});
    return .{
        .allocator = allocator,
        .skeleton = owned_skeleton,
        .bone_ids = bone_ids,
        .retarget_bone_ids = retarget_bone_ids,
        .facing_yaw_offset_degrees = facingYawOffsetDegrees(retarget_bone_ids, bind_global),
        .vertices = vertices,
        .vertex_count = @intCast(document.render_corner_logical_ids.?.len),
        .rig_bones = rig_bones,
        .bind_global = bind_global,
        .inverse_bind = inverse_bind,
        .local_rotations = local_rotations,
        .global_pose = global_pose,
        .skin_matrices = skin_matrices,
        .palette = palette,
        .geometry_artifact_hash = geometry_artifact_hash,
        .skin_artifact_hash = actual_skin_artifact,
    };
}

fn contentHashFromPath(path: []const u8, prefix: []const u8, suffix: []const u8) !character_hashes.Hash {
    const basename = std.fs.path.basename(path);
    if (!std.mem.startsWith(u8, basename, prefix) or !std.mem.endsWith(u8, basename, suffix)) return error.NonContentAddressedPath;
    const hash_text = basename[prefix.len .. basename.len - suffix.len];
    return character_hashes.parseHex(hash_text) catch error.NonContentAddressedPath;
}

pub fn loadFiles(
    io: std.Io,
    allocator: std.mem.Allocator,
    geometry_path: []const u8,
    skin_path: []const u8,
    skeleton_json: []const u8,
) !CharacterAsset {
    const geometry_bytes = try std.Io.Dir.cwd().readFileAlloc(io, geometry_path, allocator, .limited(MAX_ARTIFACT_BYTES));
    defer allocator.free(geometry_bytes);
    const skin_bytes = try std.Io.Dir.cwd().readFileAlloc(io, skin_path, allocator, .limited(MAX_ARTIFACT_BYTES));
    defer allocator.free(skin_bytes);
    var asset = try loadBytes(allocator, geometry_bytes, skin_bytes, skeleton_json);
    errdefer asset.deinit();
    const path_geometry_hash = try contentHashFromPath(geometry_path, "character-", ".rjmd");
    if (!std.mem.eql(u8, &path_geometry_hash, &asset.geometry_artifact_hash)) return error.GeometryArtifactHashMismatch;
    const path_skin_hash = try contentHashFromPath(skin_path, "skin-", ".rjsk");
    if (!std.mem.eql(u8, &path_skin_hash, &asset.skin_artifact_hash)) return error.SkinArtifactHashMismatch;
    return asset;
}

test "runtime range identity uses persisted ids and ignores descriptor order" {
    const bindings = [_]skeleton_model.CharacterObjectBinding{
        .{ .rigid = .{ .object_id = "object-hat", .bone_id = "head" } },
        .{ .body = "object-body" },
    };
    try std.testing.expect(objectBindingsCoverRangeIds(&bindings, &.{ "object-body", "object-hat" }));
    try std.testing.expect(!objectBindingsCoverRangeIds(&bindings, &.{ "object-body", "object-body" }));
    try std.testing.expect(!objectBindingsCoverRangeIds(&bindings, &.{ "object-body", "rank-1" }));
}

test "external runtime palette preserves 53 stable ids and derives retarget aliases from semantics" {
    const bone_count = 53;
    var id_storage: [bone_count][24]u8 = undefined;
    var bones: [bone_count]skeleton_model.Bone = undefined;
    var fit: [bone_count]skeleton_model.BoneFitMetadata = undefined;
    var previous_id: ?[]const u8 = null;
    for (&bones, &fit, 0..) |*bone, *fit_entry, index| {
        const id = try std.fmt.bufPrint(&id_storage[index], "external_joint_{d}", .{index});
        bone.* = .{
            .id = id,
            .parent = previous_id,
            .transform = .{ .pos = if (index == 0) .{ 0, 0, 0 } else .{ 0, 0.01, 0 } },
        };
        fit_entry.* = .{ .bone_id = id, .source = .external, .confidence = 0.5, .locked = false };
        previous_id = id;
    }
    const semantics = [_]skeleton_model.HumanoidSemanticBinding{
        .{ .role = .pelvis, .bone_id = bones[1].id },
        .{ .role = .head, .bone_id = bones[52].id },
    };
    const skeleton = skeleton_model.Skeleton{
        .id = "external-53",
        .bones = &bones,
        .character_rig = .{
            .state = .bound,
            .semantic_bindings = &semantics,
            .fit = &fit,
            .shape_hash = "shape",
            .external_provenance = .{ .provider = "SkinTokens" },
        },
    };

    const stable_ids = try buildBoneIds(std.testing.allocator, skeleton, false);
    defer std.testing.allocator.free(stable_ids);
    const retarget_ids = try buildBoneIds(std.testing.allocator, skeleton, true);
    defer std.testing.allocator.free(retarget_ids);
    const rig_bones = try buildRigBones(std.testing.allocator, skeleton);
    defer std.testing.allocator.free(rig_bones);

    try std.testing.expectEqual(@as(usize, bone_count), stable_ids.len);
    try std.testing.expectEqualStrings("external_joint_1", stable_ids[1]);
    try std.testing.expectEqualStrings("pelvis", retarget_ids[1]);
    try std.testing.expectEqualStrings("head", retarget_ids[52]);
    try std.testing.expectEqual(@as(usize, bone_count), rig_bones.len);
    try std.testing.expect(rig_bones[1].constraint == .unconstrained);
}
