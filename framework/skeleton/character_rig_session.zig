//! Revisioned native character-rig session.
//!
//! This is the single stateful door behind `__character_rig_session`. It owns an
//! editable canonical skeleton and compact inspection state. Mesh topology,
//! fitting, weights, overlays, and save artifacts enter only through explicit
//! deep integrations; absent integrations fail visibly and never fabricate a
//! bound result.

const std = @import("std");
const model = @import("skeleton.zig");
const bones_loader = @import("bones_loader.zig");
const canonical = @import("generated/humanoid_v1.zig");
const meshdoc = @import("../gpu/meshdoc_format.zig");
const character_topology = @import("character_topology.zig");
const humanoid_fit = @import("humanoid_fit.zig");
const autoweights = @import("autoweights.zig");
const skin_binding = @import("skin_binding.zig");
const character_hashes = @import("character_hashes.zig");
const rig_pose = @import("rig_pose.zig");
const rig_weight_diagnostics = @import("rig_weight_diagnostics.zig");
const rig_bend_diagnostics = @import("rig_bend_diagnostics.zig");

pub const schema = model;
pub const canonical_humanoid = canonical;

const CANONICAL_BONE_COUNT = canonical.HUMANOID_V1_BONE_IDS.len;
pub const MAX_BONES = rig_pose.MAX_BONES;
const MAX_SEMANTIC_BINDINGS = 32;
const MAX_OBJECT_BINDINGS = 64;

pub const CharacterRigSessionTuning = struct {
    history_entry_cap: usize,
    history_byte_budget: usize,
    /// Compact snapshots may carry exact detached triangle ids for one-click
    /// repair, but never turn a large broken mesh into geometry-in-React.
    detached_face_index_cap: usize,
    uncovered_face_index_cap: usize,
};

/// Authored native-session policy. Kept as one visible tuning record so the
/// bounded journal cannot quietly acquire behavior-affecting literals in its
/// implementation. History is session-resident and is cleared only when that
/// native rig session is replaced or closed.
pub const CHARACTER_RIG_SESSION_TUNING = CharacterRigSessionTuning{
    .history_entry_cap = 128,
    .history_byte_budget = 128 << 20,
    .detached_face_index_cap = 1024,
    .uncovered_face_index_cap = 1024,
};

pub const ExternalRigTuning = struct {
    coordinate_epsilon: f32,
    leaf_tip_parent_fraction: f32,
    leaf_tip_bounds_fraction: f32,
    minimum_leaf_tip: f32,
    semantic_dominance_floor: f32,
    generated_fit_confidence: f32,
};

pub const EXTERNAL_RIG_TUNING = ExternalRigTuning{
    .coordinate_epsilon = 0.0001,
    .leaf_tip_parent_fraction = 0.35,
    .leaf_tip_bounds_fraction = 0.02,
    .minimum_leaf_tip = 0.001,
    .semantic_dominance_floor = 0.35,
    .generated_fit_confidence = 0.1,
};

/// Ephemeral, allocation-free view handed to the GPU owner after every native
/// session revision. The callback must copy anything it retains: all arrays
/// except `logical_weights` are stack-backed, and the resident RJMD snapshot is
/// valid only for the duration of the host-door call.
pub const RigViewportBone = struct {
    id: []const u8,
    display_name: []const u8,
    parent_index: ?u8,
    local_transform: model.Transform,
    local_tip: ?model.Vec3,
    fit_source: model.FitSource,
};

pub const RigViewportState = struct {
    source_key: []const u8,
    snapshot: *const meshdoc.Snapshot,
    bones: []const RigViewportBone,
    bind_global: []const rig_pose.Mat4,
    pose_global: []const rig_pose.Mat4,
    skin_matrices: []const rig_pose.Mat4,
    logical_weights: ?[]const autoweights.InfluenceRow,
    selected_bone: ?u8,
    selected_vertex: ?u32,
    /// The skeleton remains inspectable while topology/anatomy setup is
    /// incomplete, but native gizmos must not invite edits that cannot bind.
    joint_editable: bool,
    bind_mesh: bool,
    deformed_mesh: bool,
    axes: bool,
    names: bool,
    heatmap: bool,
    specimen_separation: f32,
};

/// GPU supplies one immutable resident save snapshot to the skeleton session.
/// Picking remains a GPU callback because it depends on the exact drawn camera.
pub const ResidentContext = struct {
    io: std.Io,
    source_key: []const u8,
    snapshot: *const meshdoc.Snapshot,
    ranges: []const u32,
    pick_logical_vertex: ?*const fn (viewport_x: f32, viewport_y: f32) ?u32 = null,
    pick_bone: ?*const fn (viewport_x: f32, viewport_y: f32) ?u8 = null,
    select_faces: ?*const fn (face_indices: []const u32) u32 = null,
    sync_rig_viewport: ?*const fn (state: *const RigViewportState) void = null,
    clear_rig_viewport: ?*const fn () void = null,
};

const Overlay = struct {
    bind_mesh: bool = true,
    deformed_mesh: bool = true,
    axes: bool = true,
    names: bool = true,
    heatmap: bool = false,
};

const TestPoseName = enum {
    bind,
    shoulder_abduction,
    elbow_flex,
    wrist_flex,
    hip_flex,
    knee_flex,
    selected_joint,
};

const TestPoseSide = enum { left, right, both };

const TestPose = struct {
    name: TestPoseName = .bind,
    side: ?TestPoseSide = null,
    angle_deg: ?f32 = null,
};

const ObjectMode = enum { body, deformable, rigid };

const OwnedObjectBinding = struct {
    object_id: []const u8,
    mode: ObjectMode,
    bone_id: ?[]const u8 = null,
};

const OwnedBone = struct {
    id: []const u8,
    display_name: []const u8,
    parent: ?[]const u8,
    transform: model.Transform,
    tip: ?model.Vec3,
    joint: ?model.Joint,
    fit: model.BoneFitMetadata,
};

/// Weight rows are the only potentially large part of an authored rig state.
/// They are immutable between solves, so history snapshots retain this native
/// buffer instead of copying every logical vertex for every joint gesture.
/// The character-rig door is serialized on the host thread; an atomic refcount
/// would add cost without adding safety.
const SharedWeights = struct {
    allocator: std.mem.Allocator,
    ref_count: usize = 1,
    rows: []autoweights.InfluenceRow,

    fn create(allocator: std.mem.Allocator, row_count: usize) !*SharedWeights {
        const shared = try allocator.create(SharedWeights);
        errdefer allocator.destroy(shared);
        shared.* = .{
            .allocator = allocator,
            .rows = try allocator.alloc(autoweights.InfluenceRow, row_count),
        };
        return shared;
    }

    fn retain(self: *SharedWeights) *SharedWeights {
        self.ref_count += 1;
        return self;
    }

    fn release(self: *SharedWeights) void {
        std.debug.assert(self.ref_count > 0);
        self.ref_count -= 1;
        if (self.ref_count != 0) return;
        self.allocator.free(self.rows);
        self.allocator.destroy(self);
    }
};

const Session = struct {
    backing_allocator: std.mem.Allocator,
    arena: std.heap.ArenaAllocator,
    session_id_buf: [40]u8 = undefined,
    session_id_len: usize = 0,
    revision: u64 = 0,
    document_id: []const u8,
    model_id: []const u8,
    package_path: []const u8,
    model_source_key: []const u8,
    skeleton_id: []const u8,
    shape_hash: []const u8,
    external_provenance: ?model.ExternalRigProvenance = null,
    state: model.CharacterRigState,
    bones: [MAX_BONES]OwnedBone,
    bone_count: usize,
    semantic_bindings: [MAX_SEMANTIC_BINDINGS]model.HumanoidSemanticBinding = undefined,
    semantic_count: usize = 0,
    object_bindings: [MAX_OBJECT_BINDINGS]OwnedObjectBinding = undefined,
    object_count: usize = 0,
    range_object_ids: [MAX_OBJECT_BINDINGS][]const u8 = undefined,
    range_object_count: usize = 0,
    viewport_active: bool = false,
    selected_bone: ?u8 = null,
    selected_vertex: ?u32 = null,
    overlay: Overlay = .{},
    test_pose: TestPose = .{},
    fit_needs_review: bool = false,
    bind_needs_review: bool = true,
    /// Persistent rebind debt. A fresh draft has no stale weights; any edit or
    /// resident hash mismatch after a bind sets this until auto-bind succeeds.
    weights_stale: bool = false,
    has_saved_binding: bool = false,
    saved_binding: ?model.SkinBindingRef = null,
    weights: ?*SharedWeights = null,
    bound_topology_hash: ?skin_binding.Hash = null,
    bound_semantic_hash: ?skin_binding.Hash = null,
    bound_object_binding_hash: ?skin_binding.Hash = null,
    binding_error: ?[]const u8 = null,

    fn id(self: *const Session) []const u8 {
        return self.session_id_buf[0..self.session_id_len];
    }

    fn deinit(self: *Session) void {
        if (self.weights) |weights| weights.release();
        self.arena.deinit();
    }

    fn boneIndex(self: *const Session, id_value: []const u8) ?u8 {
        for (self.bones[0..self.bone_count], 0..) |bone, index| {
            if (std.mem.eql(u8, bone.id, id_value)) return @intCast(index);
        }
        return null;
    }

    fn boneIds(self: *const Session, output: *[MAX_BONES][]const u8) []const []const u8 {
        for (self.bones[0..self.bone_count], 0..) |bone, index| output[index] = bone.id;
        return output[0..self.bone_count];
    }

    fn editableValid(self: *const Session) bool {
        var bones: [MAX_BONES]model.Bone = undefined;
        var fit: [MAX_BONES]model.BoneFitMetadata = undefined;
        for (self.bones[0..self.bone_count], 0..) |bone, index| {
            bones[index] = .{
                .id = bone.id,
                .display_name = bone.display_name,
                .parent = bone.parent,
                .transform = bone.transform,
                .tip = bone.tip,
                .joint = bone.joint,
            };
            fit[index] = bone.fit;
        }
        var objects: [MAX_OBJECT_BINDINGS]model.CharacterObjectBinding = undefined;
        for (self.object_bindings[0..self.object_count], 0..) |binding, index| {
            objects[index] = switch (binding.mode) {
                .body => .{ .body = binding.object_id },
                .deformable => .{ .deformable = binding.object_id },
                .rigid => .{ .rigid = .{ .object_id = binding.object_id, .bone_id = binding.bone_id.? } },
            };
        }
        const descriptor = model.CharacterRigDescriptor{
            .state = .draft,
            .semantic_bindings = self.semantic_bindings[0..self.semantic_count],
            .object_bindings = objects[0..self.object_count],
            .fit = fit[0..self.bone_count],
            .external_provenance = self.external_provenance,
        };
        const result = bones_loader.validate(self.backing_allocator, .{
            .id = self.skeleton_id,
            .bones = bones[0..self.bone_count],
            .character_rig = descriptor,
        }, bones_loader.accept_all) catch return false;
        return result.accepted();
    }
};

const ParsedOpen = struct {
    document_id: []const u8 = "",
    model_id: []const u8 = "",
    package_path: []const u8 = "",
    model_source_key: []const u8 = "",
    skeleton_id: []const u8 = "",
    bones: [MAX_BONES]model.Bone = undefined,
    bone_count: usize = 0,
    semantic_bindings: [MAX_SEMANTIC_BINDINGS]model.HumanoidSemanticBinding = undefined,
    semantic_count: usize = 0,
    object_bindings: [MAX_OBJECT_BINDINGS]model.CharacterObjectBinding = undefined,
    object_count: usize = 0,
    range_object_ids: [MAX_OBJECT_BINDINGS][]const u8 = undefined,
    range_object_count: usize = 0,
    fit: [MAX_BONES]model.BoneFitMetadata = undefined,
    fit_count: usize = 0,
    state: model.CharacterRigState = .draft,
    shape_hash: []const u8 = "",
    external_provenance: ?model.ExternalRigProvenance = null,
    meshes: ?model.Meshes = null,
    has_saved_binding: bool = false,
    saved_binding: ?model.SkinBindingRef = null,

    fn descriptor(self: *const ParsedOpen) model.CharacterRigDescriptor {
        return .{
            .state = self.state,
            .semantic_bindings = self.semantic_bindings[0..self.semantic_count],
            .object_bindings = self.object_bindings[0..self.object_count],
            .fit = self.fit[0..self.fit_count],
            .shape_hash = self.shape_hash,
            .external_provenance = self.external_provenance,
        };
    }

    fn skeleton(self: *const ParsedOpen) model.Skeleton {
        return .{
            .id = self.skeleton_id,
            .bones = self.bones[0..self.bone_count],
            .meshes = self.meshes,
            .character_rig = self.descriptor(),
        };
    }
};

var g_session: ?Session = null;
var g_next_session_id: u64 = 1;
var g_history_allocator: ?std.mem.Allocator = null;
var g_undo_history: std.ArrayList(Session) = .empty;
var g_redo_history: std.ArrayList(Session) = .empty;

fn clearHistoryStack(stack: *std.ArrayList(Session), allocator: std.mem.Allocator) void {
    for (stack.items) |*snapshot| snapshot.deinit();
    stack.deinit(allocator);
    stack.* = .empty;
}

fn clearHistory() void {
    const allocator = g_history_allocator orelse {
        std.debug.assert(g_undo_history.items.len == 0 and g_redo_history.items.len == 0);
        return;
    };
    clearHistoryStack(&g_undo_history, allocator);
    clearHistoryStack(&g_redo_history, allocator);
    g_history_allocator = null;
}

pub fn resetForTests() void {
    clearHistory();
    if (g_session) |*session| session.deinit();
    g_session = null;
    g_next_session_id = 1;
}

fn canonicalId(raw: []const u8) ?[]const u8 {
    for (canonical.HUMANOID_V1_BONE_IDS) |id| {
        if (std.mem.eql(u8, raw, id)) return id;
    }
    return null;
}

fn object(value: std.json.Value) !std.json.ObjectMap {
    return switch (value) {
        .object => |map| map,
        else => error.ExpectedObject,
    };
}

fn array(value: std.json.Value) !std.json.Array {
    return switch (value) {
        .array => |items| items,
        else => error.ExpectedArray,
    };
}

fn string(value: std.json.Value) ![]const u8 {
    return switch (value) {
        .string => |text| text,
        else => error.ExpectedString,
    };
}

fn boolean(value: std.json.Value) !bool {
    return switch (value) {
        .bool => |flag| flag,
        else => error.ExpectedBoolean,
    };
}

fn number(value: std.json.Value) !f64 {
    const result: f64 = switch (value) {
        .integer => |integer| @floatFromInt(integer),
        .float => |float| float,
        else => return error.ExpectedNumber,
    };
    if (!std.math.isFinite(result)) return error.NonFiniteNumber;
    return result;
}

fn unsigned(value: std.json.Value) !u64 {
    return switch (value) {
        .integer => |integer| if (integer >= 0) @intCast(integer) else error.ExpectedUnsigned,
        else => error.ExpectedUnsigned,
    };
}

fn signed(value: std.json.Value) !i64 {
    return switch (value) {
        .integer => |integer| integer,
        else => error.ExpectedInteger,
    };
}

fn required(map: std.json.ObjectMap, key: []const u8) !std.json.Value {
    return map.get(key) orelse error.MissingField;
}

fn requiredString(map: std.json.ObjectMap, key: []const u8) ![]const u8 {
    const result = try string(try required(map, key));
    if (result.len == 0) return error.EmptyString;
    return result;
}

fn optionalString(map: std.json.ObjectMap, key: []const u8) !?[]const u8 {
    const value = map.get(key) orelse return null;
    if (value == .null) return null;
    return try string(value);
}

fn vec3(value: std.json.Value) !model.Vec3 {
    const items = (try array(value)).items;
    if (items.len != 3) return error.InvalidVector;
    return .{
        @floatCast(try number(items[0])),
        @floatCast(try number(items[1])),
        @floatCast(try number(items[2])),
    };
}

fn quat(value: std.json.Value) !model.Quat {
    const items = (try array(value)).items;
    if (items.len != 4) return error.InvalidQuaternion;
    return .{
        @floatCast(try number(items[0])),
        @floatCast(try number(items[1])),
        @floatCast(try number(items[2])),
        @floatCast(try number(items[3])),
    };
}

fn jointRange(value: std.json.Value) !model.JointRange {
    const map = try object(value);
    return .{
        .min = @floatCast(try number(try required(map, "min"))),
        .max = @floatCast(try number(try required(map, "max"))),
    };
}

fn parseJoint(value: std.json.Value) !model.Joint {
    const map = try object(value);
    const kind = try requiredString(map, "kind");
    if (std.mem.eql(u8, kind, "fixed")) return .{ .kind = .fixed };
    if (std.mem.eql(u8, kind, "ball")) return .{
        .kind = .ball,
        .swing_x = try jointRange(try required(map, "swingX")),
        .swing_z = try jointRange(try required(map, "swingZ")),
        .twist_y = try jointRange(try required(map, "twistY")),
    };
    const parsed_kind: model.JointKind = if (std.mem.eql(u8, kind, "hinge"))
        .hinge
    else if (std.mem.eql(u8, kind, "slide"))
        .slide
    else if (std.mem.eql(u8, kind, "pivot"))
        .pivot
    else if (std.mem.eql(u8, kind, "spin"))
        .spin
    else
        return error.InvalidJointKind;
    var result = model.Joint{
        .kind = parsed_kind,
        .axis = try vec3(try required(map, "axis")),
    };
    if (map.get("limits")) |limits_value| {
        const limits = try jointRange(limits_value);
        result.limit_min = limits.min;
        result.limit_max = limits.max;
    }
    return result;
}

fn parseTransform(value: ?std.json.Value) !model.Transform {
    const raw = value orelse return .{};
    const map = try object(raw);
    return .{
        .pos = if (map.get("pos")) |row| try vec3(row) else .{ 0, 0, 0 },
        .rot = if (map.get("rot")) |row| try quat(row) else .{ 0, 0, 0, 1 },
        .scale = if (map.get("scale")) |row| try vec3(row) else .{ 1, 1, 1 },
    };
}

fn parseBone(value: std.json.Value) !model.Bone {
    const map = try object(value);
    const id = try requiredString(map, "id");
    const parent = try optionalString(map, "parent");
    const display_name = try optionalString(map, "displayName");
    const tip = if (map.get("tip")) |row| try vec3(row) else null;
    const joint = if (map.get("joint")) |row| try parseJoint(row) else null;
    return .{
        .id = id,
        .display_name = display_name,
        .parent = parent,
        .transform = try parseTransform(map.get("transform")),
        .tip = tip,
        .joint = joint,
    };
}

fn parseRole(raw: []const u8) !model.HumanoidSemanticRole {
    inline for (@typeInfo(model.HumanoidSemanticRole).@"enum".fields) |field| {
        if (std.mem.eql(u8, raw, field.name)) return @enumFromInt(field.value);
    }
    return error.InvalidSemanticRole;
}

fn parseSide(value: ?std.json.Value) !?model.HumanoidSide {
    const raw_value = value orelse return null;
    if (raw_value == .null) return null;
    const raw = try string(raw_value);
    if (std.mem.eql(u8, raw, "left")) return .left;
    if (std.mem.eql(u8, raw, "right")) return .right;
    return error.InvalidSide;
}

fn parseFitSource(raw: []const u8) !model.FitSource {
    if (std.mem.eql(u8, raw, "boundary")) return .boundary;
    if (std.mem.eql(u8, raw, "template")) return .template;
    if (std.mem.eql(u8, raw, "external")) return .external;
    if (std.mem.eql(u8, raw, "manual")) return .manual;
    return error.InvalidFitSource;
}

fn parseRigState(raw: []const u8) !model.CharacterRigState {
    if (std.mem.eql(u8, raw, "draft")) return .draft;
    if (std.mem.eql(u8, raw, "needs_bind")) return .needs_bind;
    if (std.mem.eql(u8, raw, "bound")) return .bound;
    return error.InvalidRigState;
}

fn parseSemanticBindings(value: std.json.Value, parsed: *ParsedOpen) !void {
    const items = (try array(value)).items;
    if (items.len > MAX_SEMANTIC_BINDINGS) return error.TooManySemanticBindings;
    for (items, 0..) |item, index| {
        const map = try object(item);
        parsed.semantic_bindings[index] = .{
            .role = try parseRole(try requiredString(map, "role")),
            .side = try parseSide(map.get("side")),
            .bone_id = try requiredString(map, "boneId"),
        };
    }
    parsed.semantic_count = items.len;
}

fn parseObjectBinding(value: std.json.Value) !OwnedObjectBinding {
    const map = try object(value);
    const mode = try requiredString(map, "mode");
    const object_id = try requiredString(map, "objectId");
    if (std.mem.eql(u8, mode, "body")) return .{ .object_id = object_id, .mode = .body };
    if (std.mem.eql(u8, mode, "deformable")) return .{ .object_id = object_id, .mode = .deformable };
    if (std.mem.eql(u8, mode, "rigid")) {
        const bone_id = try requiredString(map, "boneId");
        if (std.mem.eql(u8, bone_id, "root")) return error.RootCannotOwnRigidObject;
        return .{ .object_id = object_id, .mode = .rigid, .bone_id = bone_id };
    }
    return error.InvalidObjectMode;
}

fn borrowedObjectBinding(binding: OwnedObjectBinding) model.CharacterObjectBinding {
    return switch (binding.mode) {
        .body => .{ .body = binding.object_id },
        .deformable => .{ .deformable = binding.object_id },
        .rigid => .{ .rigid = .{ .object_id = binding.object_id, .bone_id = binding.bone_id.? } },
    };
}

fn parseObjectBindings(value: std.json.Value, parsed: *ParsedOpen) !void {
    const items = (try array(value)).items;
    if (items.len > MAX_OBJECT_BINDINGS) return error.TooManyObjectBindings;
    for (items, 0..) |item, index| {
        parsed.object_bindings[index] = borrowedObjectBinding(try parseObjectBinding(item));
    }
    parsed.object_count = items.len;
}

fn parseRangeObjectIds(value: std.json.Value, parsed: *ParsedOpen) !void {
    const items = (try array(value)).items;
    if (items.len == 0 or items.len > MAX_OBJECT_BINDINGS) return error.InvalidRangeObjectIds;
    for (items, 0..) |item, index| {
        const object_id = try string(item);
        if (object_id.len == 0) return error.InvalidRangeObjectIds;
        for (parsed.range_object_ids[0..index]) |prior| {
            if (std.mem.eql(u8, prior, object_id)) return error.DuplicateObjectId;
        }
        parsed.range_object_ids[index] = object_id;
    }
    parsed.range_object_count = items.len;
}

fn parseFit(value: std.json.Value, parsed: *ParsedOpen) !void {
    const map = try object(value);
    if (map.count() > MAX_BONES) return error.TooManyFitRows;
    var iterator = map.iterator();
    var index: usize = 0;
    while (iterator.next()) |entry| : (index += 1) {
        const bone_id = entry.key_ptr.*;
        const fit_map = try object(entry.value_ptr.*);
        parsed.fit[index] = .{
            .bone_id = bone_id,
            .source = try parseFitSource(try requiredString(fit_map, "source")),
            .confidence = @floatCast(try number(try required(fit_map, "confidence"))),
            .locked = try boolean(try required(fit_map, "locked")),
        };
    }
    parsed.fit_count = index;
}

fn parseDescriptor(value: std.json.Value, parsed: *ParsedOpen) !void {
    const map = try object(value);
    if (try unsigned(try required(map, "version")) != 1) return error.InvalidDescriptorVersion;
    parsed.state = try parseRigState(try requiredString(map, "state"));
    try parseSemanticBindings(try required(map, "semanticBindings"), parsed);
    try parseObjectBindings(try required(map, "objectBindings"), parsed);
    try parseFit(try required(map, "fit"), parsed);
    parsed.shape_hash = try string(try required(map, "shapeHash"));
    if (map.get("externalProvenance")) |provenance_value| {
        if (provenance_value != .null) {
            const provenance = try object(provenance_value);
            parsed.external_provenance = .{
                .provider = try requiredString(provenance, "provider"),
                .model_class = try optionalString(provenance, "modelClass"),
                .seconds = if (provenance.get("seconds")) |seconds| @floatCast(try number(seconds)) else null,
            };
        }
    }
}

fn parseBindingRef(value: std.json.Value) !model.SkinBindingRef {
    const map = try object(value);
    if (!std.mem.eql(u8, try requiredString(map, "format"), "RJSK")) return error.InvalidSkinFormat;
    const version = try unsigned(try required(map, "version"));
    const logical_vertex_count = try unsigned(try required(map, "logicalVertexCount"));
    const max_influences = try unsigned(try required(map, "maxInfluences"));
    return .{
        .path = try requiredString(map, "path"),
        .version = std.math.cast(u16, version) orelse return error.IntegerOverflow,
        .artifact_hash = try requiredString(map, "artifactHash"),
        .topology_hash = try requiredString(map, "topologyHash"),
        .semantic_hash = try requiredString(map, "semanticHash"),
        .skeleton_hash = try requiredString(map, "skeletonHash"),
        .object_binding_hash = try requiredString(map, "objectBindingHash"),
        .logical_vertex_count = std.math.cast(u32, logical_vertex_count) orelse return error.IntegerOverflow,
        .max_influences = std.math.cast(u8, max_influences) orelse return error.IntegerOverflow,
    };
}

fn parseMeshes(value: std.json.Value, parsed: *ParsedOpen) !void {
    if (value == .null) return;
    const map = try object(value);
    const kind = try requiredString(map, "kind");
    if (!std.mem.eql(u8, kind, "skinned")) return error.CharacterMeshMustBeSkinned;
    const binding = if (map.get("binding")) |binding_value|
        if (binding_value == .null) null else try parseBindingRef(binding_value)
    else
        null;
    parsed.meshes = .{ .skinned = .{
        .geometry_key = try optionalString(map, "geometryKey"),
        .geometry_path = try optionalString(map, "geometryPath"),
        .binding = binding,
    } };
    parsed.has_saved_binding = binding != null;
    parsed.saved_binding = binding;
}

const ParsedOpenDocument = struct {
    nested: std.json.Parsed(std.json.Value),
    open: ParsedOpen,

    fn deinit(self: *ParsedOpenDocument) void {
        self.nested.deinit();
    }
};

fn parseSkeletonValue(skeleton_value: std.json.Value, descriptor_override: ?std.json.Value) !ParsedOpen {
    const skeleton_map = try object(skeleton_value);
    var parsed = ParsedOpen{};
    parsed.skeleton_id = try requiredString(skeleton_map, "id");
    const bone_values = (try array(try required(skeleton_map, "bones"))).items;
    if (bone_values.len == 0 or bone_values.len > MAX_BONES) return error.InvalidBoneCount;
    for (bone_values, 0..) |bone_value, index| parsed.bones[index] = try parseBone(bone_value);
    parsed.bone_count = bone_values.len;
    if (skeleton_map.get("meshes")) |meshes_value| try parseMeshes(meshes_value, &parsed);

    const descriptor_value = descriptor_override orelse
        skeleton_map.get("characterRig") orelse return error.MissingDescriptor;
    if (descriptor_value == .null) return error.MissingDescriptor;
    try parseDescriptor(descriptor_value, &parsed);
    return parsed;
}

fn parseOpenPayload(allocator: std.mem.Allocator, payload_value: std.json.Value) !ParsedOpenDocument {
    const payload = try object(payload_value);
    const document_id = try requiredString(payload, "documentId");
    const model_id = try requiredString(payload, "modelId");
    const package_path = try requiredString(payload, "packagePath");
    const model_source_key = try requiredString(payload, "modelSourceKey");
    const skeleton_json = try requiredString(payload, "skeletonJson");
    var nested = try std.json.parseFromSlice(std.json.Value, allocator, skeleton_json, .{});
    errdefer nested.deinit();
    const descriptor_override = if (payload.get("descriptor")) |descriptor|
        if (descriptor == .null) null else descriptor
    else
        null;
    var parsed = try parseSkeletonValue(nested.value, descriptor_override);
    parsed.document_id = document_id;
    parsed.model_id = model_id;
    parsed.package_path = package_path;
    parsed.model_source_key = model_source_key;
    try parseRangeObjectIds(try required(payload, "rangeObjectIds"), &parsed);
    return .{ .nested = nested, .open = parsed };
}

fn findParsedBone(parsed: *const ParsedOpen, id_value: []const u8) ?model.Bone {
    for (parsed.bones[0..parsed.bone_count]) |bone| {
        if (std.mem.eql(u8, bone.id, id_value)) return bone;
    }
    return null;
}

fn parsedBoneIndex(parsed: *const ParsedOpen, id_value: []const u8) ?usize {
    for (parsed.bones[0..parsed.bone_count], 0..) |bone, index| {
        if (std.mem.eql(u8, bone.id, id_value)) return index;
    }
    return null;
}

fn findParsedFit(parsed: *const ParsedOpen, id_value: []const u8) ?model.BoneFitMetadata {
    for (parsed.fit[0..parsed.fit_count]) |fit| {
        if (std.mem.eql(u8, fit.bone_id, id_value)) return fit;
    }
    return null;
}

fn fitNeedsReview(session: *const Session) bool {
    for (session.bones[0..session.bone_count]) |bone| {
        if (bone.fit.source == .template or bone.fit.confidence < 0.75) return true;
    }
    return false;
}

fn ownSession(backing_allocator: std.mem.Allocator, parsed: *const ParsedOpen) !Session {
    var session = Session{
        .backing_allocator = backing_allocator,
        .arena = .init(backing_allocator),
        .document_id = undefined,
        .model_id = undefined,
        .package_path = undefined,
        .model_source_key = undefined,
        .skeleton_id = undefined,
        .shape_hash = undefined,
        .state = parsed.state,
        .bones = undefined,
        .bone_count = parsed.bone_count,
    };
    errdefer session.deinit();
    const allocator = session.arena.allocator();
    session.document_id = try allocator.dupe(u8, parsed.document_id);
    session.model_id = try allocator.dupe(u8, parsed.model_id);
    session.package_path = try allocator.dupe(u8, parsed.package_path);
    session.model_source_key = try allocator.dupe(u8, parsed.model_source_key);
    session.skeleton_id = try allocator.dupe(u8, parsed.skeleton_id);
    session.shape_hash = try allocator.dupe(u8, parsed.shape_hash);
    session.external_provenance = if (parsed.external_provenance) |provenance| .{
        .provider = try allocator.dupe(u8, provenance.provider),
        .model_class = try dupeOptional(allocator, provenance.model_class),
        .seconds = provenance.seconds,
    } else null;

    for (parsed.bones[0..parsed.bone_count], 0..) |bone, index| {
        const fit = findParsedFit(parsed, bone.id) orelse return error.MissingBoneFit;
        const bone_id = try allocator.dupe(u8, bone.id);
        session.bones[index] = .{
            .id = bone_id,
            .display_name = try allocator.dupe(u8, bone.display_name orelse bone.id),
            .parent = try dupeOptional(allocator, bone.parent),
            .transform = bone.transform,
            .tip = bone.tip,
            .joint = bone.joint,
            .fit = .{
                .bone_id = bone_id,
                .source = fit.source,
                .confidence = fit.confidence,
                .locked = fit.locked,
            },
        };
    }
    for (parsed.semantic_bindings[0..parsed.semantic_count], 0..) |binding, index| {
        const bone_index = session.boneIndex(binding.bone_id) orelse return error.UnknownBone;
        session.semantic_bindings[index] = .{
            .role = binding.role,
            .side = binding.side,
            .bone_id = session.bones[bone_index].id,
        };
    }
    session.semantic_count = parsed.semantic_count;
    for (parsed.object_bindings[0..parsed.object_count], 0..) |binding, index| {
        session.object_bindings[index] = switch (binding) {
            .body => |object_id| .{
                .object_id = try allocator.dupe(u8, object_id),
                .mode = .body,
            },
            .deformable => |object_id| .{
                .object_id = try allocator.dupe(u8, object_id),
                .mode = .deformable,
            },
            .rigid => |rigid| .{
                .object_id = try allocator.dupe(u8, rigid.object_id),
                .mode = .rigid,
                .bone_id = session.bones[session.boneIndex(rigid.bone_id) orelse return error.UnknownBone].id,
            },
        };
    }
    session.object_count = parsed.object_count;
    for (parsed.range_object_ids[0..parsed.range_object_count], 0..) |object_id, index| {
        session.range_object_ids[index] = try allocator.dupe(u8, object_id);
    }
    session.range_object_count = parsed.range_object_count;
    session.saved_binding = if (parsed.saved_binding) |binding| try ownSkinBinding(allocator, binding) else null;
    session.fit_needs_review = fitNeedsReview(&session);
    session.bind_needs_review = parsed.state != .bound;
    session.has_saved_binding = parsed.has_saved_binding;
    session.weights_stale = false;
    const session_id = try std.fmt.bufPrint(&session.session_id_buf, "rig:{d}", .{g_next_session_id});
    session.session_id_len = session_id.len;
    return session;
}

/// Arena-owned canonical character document for runtime loading. The returned
/// borrowed `Skeleton` view remains valid until `deinit`; callers never need to
/// reproduce the camelCase JSON parser used by the editor session door.
pub const OwnedCharacterSkeleton = struct {
    backing_allocator: std.mem.Allocator,
    arena: std.heap.ArenaAllocator,
    id: []const u8,
    bones: [MAX_BONES]model.Bone,
    bone_count: usize,
    semantic_bindings: [MAX_SEMANTIC_BINDINGS]model.HumanoidSemanticBinding = undefined,
    semantic_count: usize = 0,
    object_bindings: [MAX_OBJECT_BINDINGS]model.CharacterObjectBinding = undefined,
    object_count: usize = 0,
    fit: [MAX_BONES]model.BoneFitMetadata,
    state: model.CharacterRigState,
    shape_hash: []const u8,
    external_provenance: ?model.ExternalRigProvenance = null,
    skinned_mesh: ?model.SkinnedMesh = null,

    pub fn deinit(self: *OwnedCharacterSkeleton) void {
        self.arena.deinit();
    }

    pub fn descriptor(self: *const OwnedCharacterSkeleton) model.CharacterRigDescriptor {
        return .{
            .state = self.state,
            .semantic_bindings = self.semantic_bindings[0..self.semantic_count],
            .object_bindings = self.object_bindings[0..self.object_count],
            .fit = self.fit[0..self.bone_count],
            .shape_hash = self.shape_hash,
            .external_provenance = self.external_provenance,
        };
    }

    pub fn skeleton(self: *const OwnedCharacterSkeleton) model.Skeleton {
        return .{
            .id = self.id,
            .bones = self.bones[0..self.bone_count],
            .meshes = if (self.skinned_mesh) |mesh| .{ .skinned = mesh } else null,
            .character_rig = self.descriptor(),
        };
    }
};

fn dupeOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |text_value| try allocator.dupe(u8, text_value) else null;
}

fn ownSkinBinding(allocator: std.mem.Allocator, binding: model.SkinBindingRef) !model.SkinBindingRef {
    return .{
        .path = try allocator.dupe(u8, binding.path),
        .format = binding.format,
        .version = binding.version,
        .artifact_hash = try allocator.dupe(u8, binding.artifact_hash),
        .topology_hash = try allocator.dupe(u8, binding.topology_hash),
        .semantic_hash = try allocator.dupe(u8, binding.semantic_hash),
        .skeleton_hash = try allocator.dupe(u8, binding.skeleton_hash),
        .object_binding_hash = try allocator.dupe(u8, binding.object_binding_hash),
        .logical_vertex_count = binding.logical_vertex_count,
        .max_influences = binding.max_influences,
    };
}

/// Deep-copy one complete resident rig state for the session journal. View
/// state is copied here only so the snapshot is self-contained; history adoption
/// deliberately overwrites it with the live selection/overlay/test-pose state.
fn cloneSession(source: *const Session) !Session {
    var clone = Session{
        .backing_allocator = source.backing_allocator,
        .arena = .init(source.backing_allocator),
        .session_id_buf = source.session_id_buf,
        .session_id_len = source.session_id_len,
        .revision = source.revision,
        .document_id = undefined,
        .model_id = undefined,
        .package_path = undefined,
        .model_source_key = undefined,
        .skeleton_id = undefined,
        .shape_hash = undefined,
        .external_provenance = null,
        .state = source.state,
        .bones = undefined,
        .bone_count = source.bone_count,
        .semantic_bindings = undefined,
        .semantic_count = 0,
        .object_bindings = undefined,
        .object_count = 0,
        .range_object_ids = undefined,
        .range_object_count = 0,
        .viewport_active = source.viewport_active,
        .selected_bone = source.selected_bone,
        .selected_vertex = source.selected_vertex,
        .overlay = source.overlay,
        .test_pose = source.test_pose,
        .fit_needs_review = source.fit_needs_review,
        .bind_needs_review = source.bind_needs_review,
        .weights_stale = source.weights_stale,
        .has_saved_binding = source.has_saved_binding,
        .saved_binding = null,
        .weights = null,
        .bound_topology_hash = source.bound_topology_hash,
        .bound_semantic_hash = source.bound_semantic_hash,
        .bound_object_binding_hash = source.bound_object_binding_hash,
        .binding_error = null,
    };
    errdefer clone.deinit();
    const allocator = clone.arena.allocator();
    clone.document_id = try allocator.dupe(u8, source.document_id);
    clone.model_id = try allocator.dupe(u8, source.model_id);
    clone.package_path = try allocator.dupe(u8, source.package_path);
    clone.model_source_key = try allocator.dupe(u8, source.model_source_key);
    clone.skeleton_id = try allocator.dupe(u8, source.skeleton_id);
    clone.shape_hash = try allocator.dupe(u8, source.shape_hash);
    clone.external_provenance = if (source.external_provenance) |provenance| .{
        .provider = try allocator.dupe(u8, provenance.provider),
        .model_class = try dupeOptional(allocator, provenance.model_class),
        .seconds = provenance.seconds,
    } else null;
    for (source.bones[0..source.bone_count], 0..) |bone, index| {
        const bone_id = try allocator.dupe(u8, bone.id);
        clone.bones[index] = .{
            .id = bone_id,
            .display_name = try allocator.dupe(u8, bone.display_name),
            .parent = try dupeOptional(allocator, bone.parent),
            .transform = bone.transform,
            .tip = bone.tip,
            .joint = bone.joint,
            .fit = .{
                .bone_id = bone_id,
                .source = bone.fit.source,
                .confidence = bone.fit.confidence,
                .locked = bone.fit.locked,
            },
        };
    }
    for (source.semantic_bindings[0..source.semantic_count], 0..) |binding, index| {
        const bone_index = source.boneIndex(binding.bone_id) orelse return error.UnknownBone;
        clone.semantic_bindings[index] = .{
            .role = binding.role,
            .side = binding.side,
            .bone_id = clone.bones[bone_index].id,
        };
    }
    clone.semantic_count = source.semantic_count;
    for (source.object_bindings[0..source.object_count], 0..) |binding, index| {
        clone.object_bindings[index] = .{
            .object_id = try allocator.dupe(u8, binding.object_id),
            .mode = binding.mode,
            .bone_id = if (binding.bone_id) |bone_id|
                clone.bones[source.boneIndex(bone_id) orelse return error.UnknownBone].id
            else
                null,
        };
    }
    clone.object_count = source.object_count;
    for (source.range_object_ids[0..source.range_object_count], 0..) |object_id, index| {
        clone.range_object_ids[index] = try allocator.dupe(u8, object_id);
    }
    clone.range_object_count = source.range_object_count;
    clone.saved_binding = if (source.saved_binding) |binding| try ownSkinBinding(allocator, binding) else null;
    clone.binding_error = try dupeOptional(allocator, source.binding_error);
    clone.weights = if (source.weights) |weights| weights.retain() else null;
    return clone;
}

fn optionalTextEqual(left: ?[]const u8, right: ?[]const u8) bool {
    if (left == null or right == null) return left == null and right == null;
    return std.mem.eql(u8, left.?, right.?);
}

fn externalProvenanceEqual(left: ?model.ExternalRigProvenance, right: ?model.ExternalRigProvenance) bool {
    if (left == null or right == null) return left == null and right == null;
    return std.mem.eql(u8, left.?.provider, right.?.provider) and
        optionalTextEqual(left.?.model_class, right.?.model_class) and
        left.?.seconds == right.?.seconds;
}

fn skinBindingEqual(left: ?model.SkinBindingRef, right: ?model.SkinBindingRef) bool {
    if (left == null or right == null) return left == null and right == null;
    const a = left.?;
    const b = right.?;
    return std.mem.eql(u8, a.path, b.path) and
        a.format == b.format and a.version == b.version and
        std.mem.eql(u8, a.artifact_hash, b.artifact_hash) and
        std.mem.eql(u8, a.topology_hash, b.topology_hash) and
        std.mem.eql(u8, a.semantic_hash, b.semantic_hash) and
        std.mem.eql(u8, a.skeleton_hash, b.skeleton_hash) and
        std.mem.eql(u8, a.object_binding_hash, b.object_binding_hash) and
        a.logical_vertex_count == b.logical_vertex_count and
        a.max_influences == b.max_influences;
}

fn sharedWeightsEqual(left: ?*SharedWeights, right: ?*SharedWeights) bool {
    if (left == null or right == null) return left == null and right == null;
    if (left.? == right.?) return true;
    if (left.?.rows.len != right.?.rows.len) return false;
    for (left.?.rows, right.?.rows) |a, b| {
        if (!std.meta.eql(a, b)) return false;
    }
    return true;
}

fn authoredStateEqual(left: *const Session, right: *const Session) bool {
    if (left.state != right.state or
        !std.mem.eql(u8, left.shape_hash, right.shape_hash) or
        !externalProvenanceEqual(left.external_provenance, right.external_provenance) or
        left.semantic_count != right.semantic_count or
        left.object_count != right.object_count or
        left.fit_needs_review != right.fit_needs_review or
        left.bind_needs_review != right.bind_needs_review or
        left.weights_stale != right.weights_stale or
        left.has_saved_binding != right.has_saved_binding or
        !skinBindingEqual(left.saved_binding, right.saved_binding) or
        !sharedWeightsEqual(left.weights, right.weights) or
        !std.meta.eql(left.bound_topology_hash, right.bound_topology_hash) or
        !std.meta.eql(left.bound_semantic_hash, right.bound_semantic_hash) or
        !std.meta.eql(left.bound_object_binding_hash, right.bound_object_binding_hash) or
        !optionalTextEqual(left.binding_error, right.binding_error)) return false;
    if (left.bone_count != right.bone_count) return false;
    for (left.bones[0..left.bone_count], right.bones[0..right.bone_count]) |a, b| {
        if (!std.mem.eql(u8, a.display_name, b.display_name) or
            !std.meta.eql(a.transform, b.transform) or
            !std.meta.eql(a.tip, b.tip) or
            !std.meta.eql(a.joint, b.joint) or
            a.fit.source != b.fit.source or
            a.fit.confidence != b.fit.confidence or
            a.fit.locked != b.fit.locked) return false;
    }
    for (left.semantic_bindings[0..left.semantic_count], right.semantic_bindings[0..right.semantic_count]) |a, b| {
        if (a.role != b.role or a.side != b.side or !std.mem.eql(u8, a.bone_id, b.bone_id)) return false;
    }
    for (left.object_bindings[0..left.object_count], right.object_bindings[0..right.object_count]) |a, b| {
        if (!std.mem.eql(u8, a.object_id, b.object_id) or
            a.mode != b.mode or
            !optionalTextEqual(a.bone_id, b.bone_id)) return false;
    }
    return true;
}

fn sessionHistoryBaseBytes(session: *const Session) usize {
    var total = @sizeOf(Session) + session.document_id.len + session.model_id.len +
        session.package_path.len + session.model_source_key.len + session.skeleton_id.len +
        session.shape_hash.len;
    for (session.bones[0..session.bone_count]) |bone| total += bone.id.len + bone.display_name.len +
        (if (bone.parent) |parent| parent.len else 0);
    for (session.object_bindings[0..session.object_count]) |binding| total += binding.object_id.len;
    for (session.range_object_ids[0..session.range_object_count]) |object_id| total += object_id.len;
    if (session.saved_binding) |binding| {
        total += binding.path.len + binding.artifact_hash.len + binding.topology_hash.len +
            binding.semantic_hash.len + binding.skeleton_hash.len + binding.object_binding_hash.len;
    }
    if (session.binding_error) |message| total += message.len;
    if (session.external_provenance) |provenance| {
        total += provenance.provider.len + (if (provenance.model_class) |class| class.len else 0);
    }
    return total;
}

fn totalHistoryBytes() usize {
    var total: usize = 0;
    for (g_undo_history.items, 0..) |*snapshot, index| {
        total += sessionHistoryBaseBytes(snapshot);
        const weights = snapshot.weights orelse continue;
        var seen = false;
        for (g_undo_history.items[0..index]) |prior| {
            if (prior.weights == weights) {
                seen = true;
                break;
            }
        }
        if (!seen) total += weights.rows.len * @sizeOf(autoweights.InfluenceRow);
    }
    for (g_redo_history.items, 0..) |*snapshot, index| {
        total += sessionHistoryBaseBytes(snapshot);
        const weights = snapshot.weights orelse continue;
        var seen = false;
        for (g_undo_history.items) |prior| {
            if (prior.weights == weights) {
                seen = true;
                break;
            }
        }
        if (!seen) for (g_redo_history.items[0..index]) |prior| {
            if (prior.weights == weights) {
                seen = true;
                break;
            }
        };
        if (!seen) total += weights.rows.len * @sizeOf(autoweights.InfluenceRow);
    }
    return total;
}

fn trimUndoHistory() void {
    while (g_undo_history.items.len > 1 and
        (g_undo_history.items.len > CHARACTER_RIG_SESSION_TUNING.history_entry_cap or
            totalHistoryBytes() > CHARACTER_RIG_SESSION_TUNING.history_byte_budget))
    {
        var oldest = g_undo_history.orderedRemove(0);
        oldest.deinit();
    }
}

const LiveViewState = struct {
    viewport_active: bool,
    selected_bone: ?u8,
    selected_vertex: ?u32,
    overlay: Overlay,
    test_pose: TestPose,
};

fn adoptHistorySnapshot(session: *Session, target_value: Session) void {
    const view = LiveViewState{
        .viewport_active = session.viewport_active,
        .selected_bone = session.selected_bone,
        .selected_vertex = session.selected_vertex,
        .overlay = session.overlay,
        .test_pose = session.test_pose,
    };
    const next_revision = session.revision + 1;
    const session_id_buf = session.session_id_buf;
    const session_id_len = session.session_id_len;
    session.deinit();
    session.* = target_value;
    session.session_id_buf = session_id_buf;
    session.session_id_len = session_id_len;
    session.revision = next_revision;
    session.viewport_active = view.viewport_active;
    session.selected_bone = view.selected_bone;
    session.selected_vertex = view.selected_vertex;
    session.overlay = view.overlay;
    session.test_pose = view.test_pose;
}

fn ownCharacterSkeleton(backing_allocator: std.mem.Allocator, parsed: *const ParsedOpen) !OwnedCharacterSkeleton {
    var owned = OwnedCharacterSkeleton{
        .backing_allocator = backing_allocator,
        .arena = .init(backing_allocator),
        .id = undefined,
        .bones = undefined,
        .bone_count = parsed.bone_count,
        .fit = undefined,
        .state = parsed.state,
        .shape_hash = undefined,
    };
    errdefer owned.deinit();
    const allocator = owned.arena.allocator();
    owned.id = try allocator.dupe(u8, parsed.skeleton_id);
    owned.shape_hash = try allocator.dupe(u8, parsed.shape_hash);
    owned.external_provenance = if (parsed.external_provenance) |provenance| .{
        .provider = try allocator.dupe(u8, provenance.provider),
        .model_class = try dupeOptional(allocator, provenance.model_class),
        .seconds = provenance.seconds,
    } else null;
    for (parsed.bones[0..parsed.bone_count], 0..) |bone, index| {
        const fit = findParsedFit(parsed, bone.id) orelse return error.MissingBoneFit;
        const bone_id = try allocator.dupe(u8, bone.id);
        owned.bones[index] = .{
            .id = bone_id,
            .display_name = try allocator.dupe(u8, bone.display_name orelse bone.id),
            .parent = try dupeOptional(allocator, bone.parent),
            .transform = bone.transform,
            .tip = bone.tip,
            .joint = bone.joint,
        };
        owned.fit[index] = .{
            .bone_id = bone_id,
            .source = fit.source,
            .confidence = fit.confidence,
            .locked = fit.locked,
        };
    }
    for (parsed.semantic_bindings[0..parsed.semantic_count], 0..) |binding, index| {
        const bone_index = parsedBoneIndex(parsed, binding.bone_id) orelse return error.UnknownBone;
        owned.semantic_bindings[index] = .{
            .role = binding.role,
            .side = binding.side,
            .bone_id = owned.bones[bone_index].id,
        };
    }
    owned.semantic_count = parsed.semantic_count;
    for (parsed.object_bindings[0..parsed.object_count], 0..) |binding, index| {
        owned.object_bindings[index] = switch (binding) {
            .body => |object_id| .{ .body = try allocator.dupe(u8, object_id) },
            .deformable => |object_id| .{ .deformable = try allocator.dupe(u8, object_id) },
            .rigid => |rigid| .{ .rigid = .{
                .object_id = try allocator.dupe(u8, rigid.object_id),
                .bone_id = owned.bones[parsedBoneIndex(parsed, rigid.bone_id) orelse return error.UnknownBone].id,
            } },
        };
    }
    owned.object_count = parsed.object_count;
    if (parsed.meshes) |meshes| switch (meshes) {
        .per_bone => return error.CharacterMeshMustBeSkinned,
        .skinned => |mesh| {
            owned.skinned_mesh = .{
                .geometry_key = try dupeOptional(allocator, mesh.geometry_key),
                .geometry_path = try dupeOptional(allocator, mesh.geometry_path),
                .binding = if (mesh.binding) |binding| try ownSkinBinding(allocator, binding) else null,
            };
        },
    };
    return owned;
}

/// Parse, canonicalize, validate, and own a TS `Skeleton` JSON document. This is
/// the strict runtime/session ingestion boundary: aliases, inferred hierarchy,
/// and stale binding fallback are deliberately absent.
pub fn parseOwnedCharacterSkeleton(
    allocator: std.mem.Allocator,
    skeleton_json: []const u8,
) !OwnedCharacterSkeleton {
    var json = try std.json.parseFromSlice(std.json.Value, allocator, skeleton_json, .{});
    defer json.deinit();
    var parsed = try parseSkeletonValue(json.value, null);
    const verdict = try bones_loader.validate(allocator, parsed.skeleton(), bones_loader.accept_all);
    if (!verdict.accepted()) return error.CharacterSkeletonRejected;
    return ownCharacterSkeleton(allocator, &parsed);
}

fn writeJsonString(writer: *std.Io.Writer, value: []const u8) !void {
    try writer.writeByte('"');
    for (value) |byte| switch (byte) {
        '"' => try writer.writeAll("\\\""),
        '\\' => try writer.writeAll("\\\\"),
        '\n' => try writer.writeAll("\\n"),
        '\r' => try writer.writeAll("\\r"),
        '\t' => try writer.writeAll("\\t"),
        0...8, 11, 12, 14...31 => try writer.print("\\u{x:0>4}", .{byte}),
        else => try writer.writeByte(byte),
    };
    try writer.writeByte('"');
}

fn writeVec3(writer: *std.Io.Writer, value: model.Vec3) !void {
    try writer.print("[{d},{d},{d}]", .{ value[0], value[1], value[2] });
}

fn writeQuat(writer: *std.Io.Writer, value: model.Quat) !void {
    try writer.print("[{d},{d},{d},{d}]", .{ value[0], value[1], value[2], value[3] });
}

fn writeRange(writer: *std.Io.Writer, value: model.JointRange) !void {
    try writer.print("{{\"min\":{d},\"max\":{d}}}", .{ value.min, value.max });
}

fn writeJoint(writer: *std.Io.Writer, joint: model.Joint) !void {
    try writer.writeAll("{\"kind\":");
    try writeJsonString(writer, @tagName(joint.kind));
    switch (joint.kind) {
        .fixed => {},
        .ball => {
            try writer.writeAll(",\"swingX\":");
            try writeRange(writer, joint.swing_x.?);
            try writer.writeAll(",\"swingZ\":");
            try writeRange(writer, joint.swing_z.?);
            try writer.writeAll(",\"twistY\":");
            try writeRange(writer, joint.twist_y.?);
        },
        else => {
            try writer.writeAll(",\"axis\":");
            try writeVec3(writer, joint.axis.?);
            if (joint.limit_min != null and joint.limit_max != null) {
                try writer.print(",\"limits\":{{\"min\":{d},\"max\":{d}}}", .{
                    joint.limit_min.?, joint.limit_max.?,
                });
            }
        },
    }
    try writer.writeByte('}');
}

fn writeObjectBinding(writer: *std.Io.Writer, binding: OwnedObjectBinding) !void {
    try writer.writeAll("{\"objectId\":");
    try writeJsonString(writer, binding.object_id);
    try writer.writeAll(",\"mode\":");
    try writeJsonString(writer, @tagName(binding.mode));
    if (binding.bone_id) |bone_id| {
        try writer.writeAll(",\"boneId\":");
        try writeJsonString(writer, bone_id);
    }
    try writer.writeByte('}');
}

const ReadinessStatus = enum { ready, blocked, waiting, stale };

fn writeReadinessCheck(
    writer: *std.Io.Writer,
    first: *bool,
    id_value: []const u8,
    status: ReadinessStatus,
    detail: ?[]const u8,
) !void {
    if (!first.*) try writer.writeByte(',');
    first.* = false;
    try writer.writeAll("{\"id\":");
    try writeJsonString(writer, id_value);
    try writer.writeAll(",\"status\":");
    try writeJsonString(writer, @tagName(status));
    try writer.writeAll(",\"ready\":");
    try writer.writeAll(if (status == .ready) "true" else "false");
    if (detail) |text_value| {
        try writer.writeAll(",\"detail\":");
        try writeJsonString(writer, text_value);
    }
    try writer.writeByte('}');
}

fn writeSemanticKey(writer: *std.Io.Writer, semantic: humanoid_fit.Semantic) !void {
    try writer.writeByte('"');
    try writer.writeAll(@tagName(semantic.role));
    if (semantic.side) |side| {
        try writer.writeByte(':');
        try writer.writeAll(@tagName(side));
    }
    try writer.writeByte('"');
}

fn writeVertexProbe(
    writer: *std.Io.Writer,
    session: *const Session,
    topology: *const character_topology.Topology,
    logical_id: u32,
) !void {
    if (logical_id >= topology.positions.len) return error.InvalidLogicalVertex;
    var duplicates: u32 = 0;
    for (topology.snapshot.render_corner_logical_ids.?) |candidate| {
        if (candidate == logical_id) duplicates += 1;
    }
    try writer.print("{{\"logicalVertexId\":{d},\"renderDuplicateCount\":{d},\"modelPosition\":", .{ logical_id, duplicates });
    try writeVec3(writer, topology.positions[logical_id]);
    try writer.writeAll(",\"influences\":[");
    if (session.weights) |shared| {
        if (logical_id >= shared.rows.len) return error.InvalidLogicalVertex;
        const row = shared.rows[logical_id];
        for (row.bone_indices, row.weights, 0..) |bone_index, weight, slot| {
            if (slot != 0) try writer.writeByte(',');
            if (bone_index == autoweights.UNUSED_BONE) {
                try writer.writeAll("{\"boneId\":null,\"weight\":0}");
            } else {
                if (bone_index >= session.bone_count) return error.InvalidBoneIndex;
                try writer.writeAll("{\"boneId\":");
                try writeJsonString(writer, session.bones[bone_index].id);
                try writer.print(",\"weight\":{d}}}", .{weight});
            }
        }
    } else {
        try writer.writeAll("{\"boneId\":null,\"weight\":0},{\"boneId\":null,\"weight\":0},{\"boneId\":null,\"weight\":0},{\"boneId\":null,\"weight\":0}");
    }
    try writer.writeAll("]}");
}

fn viewportConstraint(joint_value: ?model.Joint) !rig_pose.Constraint {
    const joint = joint_value orelse return .fixed;
    return switch (joint.kind) {
        .fixed => .fixed,
        .ball => .{ .ball = .{
            .swing_x = .{
                .min = (joint.swing_x orelse return error.InvalidJoint).min,
                .max = joint.swing_x.?.max,
            },
            .swing_z = .{
                .min = (joint.swing_z orelse return error.InvalidJoint).min,
                .max = joint.swing_z.?.max,
            },
            .twist_y = .{
                .min = (joint.twist_y orelse return error.InvalidJoint).min,
                .max = joint.twist_y.?.max,
            },
        } },
        .hinge => blk: {
            const axis = joint.axis orelse return error.InvalidJoint;
            if (@abs(axis[0]) < 0.999 or @abs(axis[1]) > 0.001 or @abs(axis[2]) > 0.001) {
                return error.InvalidJoint;
            }
            const minimum = joint.limit_min orelse return error.InvalidJoint;
            const maximum = joint.limit_max orelse return error.InvalidJoint;
            break :blk .{ .hinge_x = if (axis[0] >= 0)
                .{ .min = minimum, .max = maximum }
            else
                .{ .min = -maximum, .max = -minimum } };
        },
        .slide, .pivot, .spin => return error.UnsupportedCharacterJoint,
    };
}

fn viewportSeparation(resident: ?*const ResidentContext) f32 {
    const context = resident orelse return 0;
    if (context.snapshot.verts.len < 8) return 0;
    var minimum = std.math.inf(f32);
    var maximum = -std.math.inf(f32);
    var corner: usize = 0;
    while (corner < context.snapshot.verts.len / 8) : (corner += 1) {
        const x = context.snapshot.verts[corner * 8];
        if (!std.math.isFinite(x)) continue;
        minimum = @min(minimum, x);
        maximum = @max(maximum, x);
    }
    if (!std.math.isFinite(minimum) or !std.math.isFinite(maximum)) return 0;
    return @max(0.001, maximum - minimum) * canonical.HUMANOID_RIG_TUNING.specimen_separation_bounds_width;
}

fn activeSpecimenSeparation(
    session: *const Session,
    resident: ?*const ResidentContext,
    deformed_mesh: bool,
) f32 {
    // Separation is a comparison layout, not a property of the generated rig.
    // With only one specimen visible, its mesh and native skeleton both stay in
    // the authored model space.
    return if (session.overlay.bind_mesh and deformed_mesh)
        viewportSeparation(resident)
    else
        0;
}

fn rotateViewportBone(
    session: *const Session,
    requested: *[MAX_BONES]rig_pose.Quat,
    bone_id: []const u8,
    degrees: f32,
) !void {
    const index = session.boneIndex(bone_id) orelse return error.UnknownBone;
    const joint = session.bones[index].joint;
    const axis: model.Vec3 = if (joint != null and joint.?.kind == .hinge)
        joint.?.axis orelse .{ 1, 0, 0 }
    else
        .{ 1, 0, 0 };
    const delta = try rig_pose.fk.axisAngle(axis, degrees * std.math.pi / 180.0);
    requested[index] = try rig_pose.fk.normalizeQuat(rig_pose.fk.multiplyQuat(requested[index], delta));
}

fn poseTargetsSide(pose: TestPose, side: TestPoseSide) bool {
    const selected = pose.side orelse .both;
    return selected == .both or selected == side;
}

fn buildRequestedPose(
    session: *const Session,
    pose: TestPose,
    requested: *[MAX_BONES]rig_pose.Quat,
) !void {
    for (session.bones[0..session.bone_count], 0..) |bone, index| requested[index] = bone.transform.rot;
    const tuning = canonical.HUMANOID_RIG_TUNING.bend_presets_deg;
    switch (pose.name) {
        .bind => {},
        .shoulder_abduction => {
            if (poseTargetsSide(pose, .left)) try rotateViewportBone(session, requested, "upper_arm_left", tuning.shoulder_abduction);
            if (poseTargetsSide(pose, .right)) try rotateViewportBone(session, requested, "upper_arm_right", tuning.shoulder_abduction);
        },
        .elbow_flex => {
            if (poseTargetsSide(pose, .left)) try rotateViewportBone(session, requested, "lower_arm_left", tuning.elbow_flex);
            if (poseTargetsSide(pose, .right)) try rotateViewportBone(session, requested, "lower_arm_right", tuning.elbow_flex);
        },
        .wrist_flex => {
            if (poseTargetsSide(pose, .left)) try rotateViewportBone(session, requested, "hand_left", tuning.wrist_flex);
            if (poseTargetsSide(pose, .right)) try rotateViewportBone(session, requested, "hand_right", tuning.wrist_flex);
        },
        .hip_flex => {
            if (poseTargetsSide(pose, .left)) try rotateViewportBone(session, requested, "upper_leg_left", tuning.hip_flex);
            if (poseTargetsSide(pose, .right)) try rotateViewportBone(session, requested, "upper_leg_right", tuning.hip_flex);
        },
        .knee_flex => {
            if (poseTargetsSide(pose, .left)) try rotateViewportBone(session, requested, "lower_leg_left", tuning.knee_flex);
            if (poseTargetsSide(pose, .right)) try rotateViewportBone(session, requested, "lower_leg_right", tuning.knee_flex);
        },
        .selected_joint => {
            const selected = session.selected_bone orelse return error.NoSelectedBone;
            try rotateViewportBone(
                session,
                requested,
                session.bones[selected].id,
                pose.angle_deg orelse return error.InvalidTestPose,
            );
        },
    }
}

fn buildRigPoseBones(
    session: *const Session,
    rig_bones: *[MAX_BONES]rig_pose.Bone,
) !void {
    for (session.bones[0..session.bone_count], 0..) |bone, index| {
        rig_bones[index] = .{
            .parent_index = if (bone.parent) |parent_id|
                session.boneIndex(parent_id) orelse return error.UnknownBone
            else
                null,
            .bind_translation = bone.transform.pos,
            .bind_rotation = bone.transform.rot,
            .constraint = try viewportConstraint(bone.joint),
        };
    }
}

fn evaluateSessionPose(
    session: *const Session,
    pose: TestPose,
    bind_global: *[MAX_BONES]rig_pose.Mat4,
    pose_global: *[MAX_BONES]rig_pose.Mat4,
    skin_matrices: *[MAX_BONES]rig_pose.Mat4,
) !void {
    var rig_bones: [MAX_BONES]rig_pose.Bone = undefined;
    try buildRigPoseBones(session, &rig_bones);
    var inverse_bind: [MAX_BONES]rig_pose.Mat4 = undefined;
    try rig_pose.prepareBind(rig_bones[0..session.bone_count], bind_global[0..session.bone_count], inverse_bind[0..session.bone_count]);
    var requested: [MAX_BONES]rig_pose.Quat = undefined;
    try buildRequestedPose(session, pose, &requested);
    var local_rotations: [MAX_BONES]rig_pose.Quat = undefined;
    try rig_pose.evaluate(
        rig_bones[0..session.bone_count],
        inverse_bind[0..session.bone_count],
        requested[0..session.bone_count],
        .{ 0, 0, 0 },
        local_rotations[0..session.bone_count],
        pose_global[0..session.bone_count],
        skin_matrices[0..session.bone_count],
    );
}

fn syncRigViewport(
    session: *const Session,
    resident: ?*const ResidentContext,
    joint_editable: bool,
    binding_current: bool,
) !void {
    const context = resident orelse return;
    if (!session.viewport_active) {
        if (context.clear_rig_viewport) |clear| clear();
        return;
    }
    const sync = context.sync_rig_viewport orelse return;
    if (!std.mem.eql(u8, session.model_source_key, context.source_key)) return error.ResidentSourceChanged;

    var viewport_bones: [MAX_BONES]RigViewportBone = undefined;
    for (session.bones[0..session.bone_count], 0..) |bone, index| {
        const parent_index = if (bone.parent) |parent_id|
            session.boneIndex(parent_id) orelse return error.UnknownBone
        else
            null;
        viewport_bones[index] = .{
            .id = bone.id,
            .display_name = bone.display_name,
            .parent_index = parent_index,
            .local_transform = bone.transform,
            .local_tip = bone.tip,
            .fit_source = bone.fit.source,
        };
    }
    var bind_global: [MAX_BONES]rig_pose.Mat4 = undefined;
    var pose_global: [MAX_BONES]rig_pose.Mat4 = undefined;
    var skin_matrices: [MAX_BONES]rig_pose.Mat4 = undefined;
    try evaluateSessionPose(session, session.test_pose, &bind_global, &pose_global, &skin_matrices);
    const deformed_mesh = session.overlay.deformed_mesh and binding_current;
    const state = RigViewportState{
        .source_key = context.source_key,
        .snapshot = context.snapshot,
        .bones = viewport_bones[0..session.bone_count],
        .bind_global = bind_global[0..session.bone_count],
        .pose_global = pose_global[0..session.bone_count],
        .skin_matrices = skin_matrices[0..session.bone_count],
        .logical_weights = if (binding_current) session.weights.?.rows else null,
        .selected_bone = session.selected_bone,
        .selected_vertex = session.selected_vertex,
        .joint_editable = joint_editable,
        .bind_mesh = session.overlay.bind_mesh,
        .deformed_mesh = deformed_mesh,
        .axes = session.overlay.axes,
        .names = session.overlay.names,
        .heatmap = session.overlay.heatmap,
        .specimen_separation = activeSpecimenSeparation(session, resident, deformed_mesh),
    };
    sync(&state);
}

fn writeSnapshot(
    writer: *std.Io.Writer,
    session: *const Session,
    resident: ?*const ResidentContext,
) !void {
    var topology_result = openResidentTopology(session, resident) catch null;
    defer if (topology_result) |*topology| topology.deinit();
    var connected_body = false;
    var required_semantics = false;
    var body_topology: ?character_topology.ObjectComponentSummary = null;
    defer if (body_topology) |*summary| summary.deinit();
    var semantic_coverage: ?character_topology.SemanticCoverageAudit = null;
    defer if (semantic_coverage) |*audit| audit.deinit();
    var current_hashes: ?character_topology.CharacterHashes = null;
    var topology_detail: ?[]const u8 = null;
    var resident_shape_needs_review = false;
    if (topology_result) |*topology| {
        const body_id = bodyObjectId(session) catch null;
        if (body_id) |id| {
            body_topology = topology.objectComponentSummary(
                id,
                CHARACTER_RIG_SESSION_TUNING.detached_face_index_cap,
            ) catch null;
            connected_body = if (body_topology) |*summary| summary.connected() else false;
            semantic_coverage = topology.semanticCoverageAudit(
                id,
                CHARACTER_RIG_SESSION_TUNING.uncovered_face_index_cap,
            ) catch null;
            required_semantics = if (semantic_coverage) |*audit|
                audit.requiredComplete() and audit.coverageComplete()
            else
                false;
        }
        var bones_buffer: [MAX_BONES]model.Bone = undefined;
        const bones = borrowedBones(session, &bones_buffer);
        var object_buffer: [MAX_OBJECT_BINDINGS]model.CharacterObjectBinding = undefined;
        const objects = borrowedObjectBindings(session, &object_buffer);
        current_hashes = topology.computeHashes(bones, objects) catch null;
        if (current_hashes == null) topology_detail = "resident character hashes are invalid";
        const current_shape_hex = character_hashes.hex(topology.shapeHash());
        resident_shape_needs_review = !std.mem.eql(u8, session.shape_hash, &current_shape_hex);
    } else {
        topology_detail = "resident RJMD v5 logical topology is unavailable";
    }
    const has_resident_weights = session.weights != null;
    const topology_hash_current = if (current_hashes) |current|
        has_resident_weights and sameHash(session.bound_topology_hash, current.topology)
    else
        false;
    const semantic_hash_current = if (current_hashes) |current|
        has_resident_weights and sameHash(session.bound_semantic_hash, current.semantic)
    else
        false;
    const object_hash_current = if (current_hashes) |current|
        has_resident_weights and sameHash(session.bound_object_binding_hash, current.object_binding)
    else
        false;
    const weights_current = topology_hash_current and semantic_hash_current and object_hash_current;
    const external_preview = session.external_provenance != null;
    syncRigViewport(session, resident, external_preview or (connected_body and required_semantics), weights_current) catch {
        if (resident) |context| if (context.clear_rig_viewport) |clear| clear();
    };
    const has_binding_history = has_resident_weights or session.has_saved_binding or session.saved_binding != null or session.state == .bound;
    const weights_stale = session.weights_stale or (has_binding_history and !weights_current);
    const visible_state: model.CharacterRigState = if (session.state == .bound and !weights_current)
        .needs_bind
    else
        session.state;
    try writer.writeAll("{\"sessionId\":");
    try writeJsonString(writer, session.id());
    try writer.print(",\"revision\":{d},\"state\":", .{session.revision});
    try writeJsonString(writer, @tagName(visible_state));
    try writer.writeAll(",\"externalProvenance\":");
    if (session.external_provenance) |provenance| {
        try writer.writeAll("{\"provider\":");
        try writeJsonString(writer, provenance.provider);
        if (provenance.model_class) |model_class| {
            try writer.writeAll(",\"modelClass\":");
            try writeJsonString(writer, model_class);
        }
        if (provenance.seconds) |seconds| try writer.print(",\"seconds\":{d}", .{seconds});
        try writer.writeByte('}');
    } else try writer.writeAll("null");
    try writer.writeAll(",\"viewportActive\":");
    try writer.writeAll(if (session.viewport_active) "true" else "false");
    try writer.writeAll(",\"selectedBoneId\":");
    if (session.selected_bone) |index|
        try writeJsonString(writer, session.bones[index].id)
    else
        try writer.writeAll("null");
    try writer.writeAll(",\"selectedVertex\":");
    if (session.selected_vertex) |logical_id| probe: {
        const topology = if (topology_result) |*value| value else {
            try writer.writeAll("null");
            break :probe;
        };
        if (logical_id >= topology.positions.len or
            (session.weights != null and logical_id >= session.weights.?.rows.len))
        {
            try writer.writeAll("null");
            break :probe;
        }
        try writeVertexProbe(writer, session, topology, logical_id);
    } else try writer.writeAll("null");
    try writer.writeAll(",\"bones\":[");
    for (session.bones[0..session.bone_count], 0..) |bone, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.writeAll("{\"id\":");
        try writeJsonString(writer, bone.id);
        try writer.writeAll(",\"displayName\":");
        try writeJsonString(writer, bone.display_name);
        try writer.writeAll(",\"parent\":");
        if (bone.parent) |parent|
            try writeJsonString(writer, parent)
        else
            try writer.writeAll("null");
        try writer.writeAll(",\"transform\":{\"pos\":");
        try writeVec3(writer, bone.transform.pos);
        try writer.writeAll(",\"rot\":");
        try writeQuat(writer, bone.transform.rot);
        try writer.writeAll(",\"scale\":");
        try writeVec3(writer, bone.transform.scale);
        try writer.writeByte('}');
        if (bone.tip) |tip| {
            try writer.writeAll(",\"tip\":");
            try writeVec3(writer, tip);
        }
        if (bone.joint) |joint| {
            try writer.writeAll(",\"joint\":");
            try writeJoint(writer, joint);
        }
        try writer.writeAll(",\"fit\":{\"source\":");
        try writeJsonString(writer, @tagName(bone.fit.source));
        try writer.print(",\"confidence\":{d},\"locked\":{s}", .{
            bone.fit.confidence,
            if (bone.fit.locked) "true" else "false",
        });
        try writer.print("}},\"segmentLength\":{d}}}", .{boneSegmentLength(session, index)});
    }
    try writer.writeAll("],\"semanticBindings\":[");
    for (session.semantic_bindings[0..session.semantic_count], 0..) |binding, index| {
        if (index != 0) try writer.writeByte(',');
        try writeSemanticBinding(writer, binding);
    }
    try writer.writeAll("],\"objectBindings\":[");
    for (session.object_bindings[0..session.object_count], 0..) |binding, index| {
        if (index != 0) try writer.writeByte(',');
        try writeObjectBinding(writer, binding);
    }
    try writer.print(
        "],\"specimenSeparation\":{d},\"overlay\":{{\"bindMesh\":{s},\"deformedMesh\":{s},\"axes\":{s},\"names\":{s},\"heatmap\":{s}}},\"testPose\":{{\"name\":",
        .{
            activeSpecimenSeparation(session, resident, weights_current and session.overlay.deformed_mesh),
            if (session.overlay.bind_mesh) "true" else "false",
            if (session.overlay.deformed_mesh) "true" else "false",
            if (session.overlay.axes) "true" else "false",
            if (session.overlay.names) "true" else "false",
            if (session.overlay.heatmap) "true" else "false",
        },
    );
    try writeJsonString(writer, @tagName(session.test_pose.name));
    if (session.test_pose.side) |side| {
        try writer.writeAll(",\"side\":");
        try writeJsonString(writer, @tagName(side));
    }
    if (session.test_pose.angle_deg) |angle| try writer.print(",\"angleDeg\":{d}", .{angle});
    try writer.writeAll("},\"bodyTopology\":");
    if (body_topology) |summary| {
        try writer.print(
            "{{\"componentCount\":{d},\"mainLogicalVertexCount\":{d},\"mainTriangleCount\":{d},\"detachedLogicalVertexCount\":{d},\"detachedTriangleCount\":{d},\"detachedFaceIndices\":[",
            .{
                summary.component_count,
                summary.largest_component_logical_vertex_count,
                summary.largest_component_triangle_count,
                summary.stray_logical_vertex_count,
                summary.stray_triangle_count,
            },
        );
        for (summary.stray_face_indices, 0..) |face_index, index| {
            if (index != 0) try writer.writeByte(',');
            try writer.print("{d}", .{face_index});
        }
        try writer.print(
            "],\"detachedSelectionComplete\":{s}}}",
            .{if (summary.stray_face_indices_complete) "true" else "false"},
        );
    } else {
        try writer.writeAll("null");
    }
    try writer.writeAll(",\"semanticCoverage\":");
    if (semantic_coverage) |audit| {
        try writer.print(
            "{{\"bodyFaceCount\":{d},\"coveredBodyFaceCount\":{d},\"uncoveredBodyFaceCount\":{d},\"missingRequiredRoles\":[",
            .{ audit.body_face_count, audit.covered_body_face_count, audit.uncovered_body_face_count },
        );
        for (audit.missing_required_role_keys, 0..) |key, index| {
            if (index != 0) try writer.writeByte(',');
            try writeJsonString(writer, key);
        }
        try writer.writeAll("],\"roleFaceCounts\":[");
        for (audit.role_counts, 0..) |row, index| {
            if (index != 0) try writer.writeByte(',');
            try writer.writeAll("{\"key\":");
            try writeJsonString(writer, row.key);
            try writer.print(",\"faceCount\":{d}}}", .{row.face_count});
        }
        try writer.writeAll("],\"uncoveredFaceIndices\":[");
        for (audit.uncovered_face_indices, 0..) |face_index, index| {
            if (index != 0) try writer.writeByte(',');
            try writer.print("{d}", .{face_index});
        }
        try writer.print(
            "],\"uncoveredSelectionComplete\":{s}}}",
            .{if (audit.uncovered_face_indices_complete) "true" else "false"},
        );
    } else {
        try writer.writeAll("null");
    }
    try writer.writeAll(",\"readiness\":[");
    var first = true;
    var connected_detail_buffer: [220]u8 = undefined;
    const connected_detail: ?[]const u8 = if (connected_body)
        null
    else if (body_topology) |summary|
        if (summary.component_count == 0)
            "body object contains no logical triangles"
        else
            std.fmt.bufPrint(
                &connected_detail_buffer,
                "body has {d} logical edge components: main {d} triangle{s}; detached {d} triangle{s}",
                .{
                    summary.component_count,
                    summary.largest_component_triangle_count,
                    if (summary.largest_component_triangle_count == 1) "" else "s",
                    summary.stray_triangle_count,
                    if (summary.stray_triangle_count == 1) "" else "s",
                },
            ) catch "body has more than one logical edge component"
    else
        topology_detail orelse "body logical connectivity is unavailable";
    // Connected-body coverage is an input gate for the native Fit/Bind solver.
    // A validated external binding already supplies a hierarchy and one
    // normalized top-four row for every resident logical vertex, so retain the
    // connectivity measurement as an authoring diagnostic. External rigs do,
    // however, still require stable bone-role bindings before retargeting.
    const external_inputs_satisfied = session.external_provenance != null and has_resident_weights;
    try writeReadinessCheck(
        writer,
        &first,
        "connected_body",
        if (external_inputs_satisfied or connected_body) .ready else .blocked,
        if (external_inputs_satisfied)
            "external binding covers every resident logical vertex; body connectivity remains an authoring diagnostic"
        else
            connected_detail,
    );
    const external_semantic_count = requiredSemanticBindingCount(session);
    const external_semantics_ready = external_semantic_count == REQUIRED_SEMANTIC_BINDING_COUNT;
    var external_semantic_detail_buffer: [180]u8 = undefined;
    const external_semantic_detail = if (external_semantics_ready)
        null
    else
        std.fmt.bufPrint(
            &external_semantic_detail_buffer,
            "external skeleton has {d}/{d} required semantic bone roles",
            .{ external_semantic_count, REQUIRED_SEMANTIC_BINDING_COUNT },
        ) catch "external skeleton is missing required semantic bone roles";
    try writeReadinessCheck(
        writer,
        &first,
        "required_semantics",
        if (session.external_provenance != null)
            (if (external_semantics_ready) .ready else .blocked)
        else if (required_semantics)
            .ready
        else
            .blocked,
        if (session.external_provenance != null)
            external_semantic_detail
        else if (required_semantics)
            null
        else
            topology_detail orelse "required stable anatomy roles are missing",
    );
    const skeleton_valid = session.editableValid();
    try writeReadinessCheck(writer, &first, "canonical_skeleton", if (skeleton_valid) .ready else .blocked, if (skeleton_valid) null else "canonical skeleton validation failed");
    try writeReadinessCheck(
        writer,
        &first,
        "current_topology_hash",
        if (!has_resident_weights) .waiting else if (topology_hash_current) .ready else .stale,
        if (topology_hash_current) null else if (!has_resident_weights) "bind has not established a topology hash" else topology_detail orelse "topology differs from the resident binding",
    );
    try writeReadinessCheck(
        writer,
        &first,
        "current_semantic_hash",
        if (!has_resident_weights) .waiting else if (semantic_hash_current) .ready else .stale,
        if (semantic_hash_current) null else if (!has_resident_weights) "bind has not established a semantic hash" else topology_detail orelse "semantic roles differ from the resident binding",
    );
    try writeReadinessCheck(
        writer,
        &first,
        "current_object_binding_hash",
        if (!has_resident_weights) .waiting else if (object_hash_current) .ready else .stale,
        if (object_hash_current) null else if (!has_resident_weights) "bind has not established an object-binding hash" else topology_detail orelse "object bindings differ from the resident binding",
    );
    try writeReadinessCheck(
        writer,
        &first,
        "saved_four_influence_weights",
        if (weights_current and session.has_saved_binding) .ready else if (weights_stale) .stale else .waiting,
        if (weights_current and session.has_saved_binding)
            null
        else if (session.binding_error) |message|
            message
        else if (weights_current)
            "resident four-influence weights have not been saved"
        else if (session.has_saved_binding)
            "saved RJSK did not validate against the resident character"
        else
            "no current four-influence logical binding",
    );
    const owns_history = if (g_session) |*active| active == session else false;
    const undo_depth = if (owns_history) g_undo_history.items.len else 0;
    const redo_depth = if (owns_history) g_redo_history.items.len else 0;
    try writer.print("],\"weightsStale\":{s},\"fitNeedsReview\":{s},\"bindNeedsReview\":{s},\"history\":{{\"canUndo\":{s},\"canRedo\":{s},\"undoDepth\":{d},\"redoDepth\":{d}}}}}", .{
        if (weights_stale) "true" else "false",
        if (session.fit_needs_review or resident_shape_needs_review) "true" else "false",
        if (session.bind_needs_review) "true" else "false",
        if (undo_depth != 0) "true" else "false",
        if (redo_depth != 0) "true" else "false",
        undo_depth,
        redo_depth,
    });
}

fn snapshotReply(
    allocator: std.mem.Allocator,
    session: *const Session,
    resident: ?*const ResidentContext,
) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"value\":");
    try writeSnapshot(&output.writer, session, resident);
    try output.writer.writeByte('}');
    return allocator.dupe(u8, output.written());
}

fn nullReply(allocator: std.mem.Allocator) ![]u8 {
    return allocator.dupe(u8, "{\"ok\":true,\"value\":null}");
}

fn errorReply(
    allocator: std.mem.Allocator,
    message: []const u8,
    current_revision: ?u64,
) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"ok\":false,\"error\":");
    try writeJsonString(&output.writer, message);
    if (current_revision) |revision| try output.writer.print(",\"currentRevision\":{d}", .{revision});
    try output.writer.writeByte('}');
    return allocator.dupe(u8, output.written());
}

fn operationErrorReply(allocator: std.mem.Allocator, prefix: []const u8, err: anyerror) ![]u8 {
    var message_buffer: [180]u8 = undefined;
    const message = std.fmt.bufPrint(&message_buffer, "{s}: {s}", .{ prefix, @errorName(err) }) catch prefix;
    return errorReply(allocator, message, if (g_session) |*session| session.revision else null);
}

fn requireSession(request: std.json.ObjectMap, require_revision: bool) !*Session {
    const session = if (g_session) |*value| value else return error.NoOpenSession;
    const session_id = try requiredString(request, "sessionId");
    if (!std.mem.eql(u8, session.id(), session_id)) return error.SessionIdMismatch;
    if (request.get("expectedRevision")) |value| {
        if (try unsigned(value) != session.revision) return error.StaleRevision;
    } else if (require_revision) {
        return error.MissingExpectedRevision;
    }
    return session;
}

fn parseTestPoseName(raw: []const u8) !TestPoseName {
    inline for (@typeInfo(TestPoseName).@"enum".fields) |field| {
        if (std.mem.eql(u8, raw, field.name)) return @enumFromInt(field.value);
    }
    return error.InvalidTestPose;
}

fn parseTestPoseSide(value: ?std.json.Value) !?TestPoseSide {
    const raw_value = value orelse return null;
    if (raw_value == .null) return null;
    const raw = try string(raw_value);
    if (std.mem.eql(u8, raw, "left")) return .left;
    if (std.mem.eql(u8, raw, "right")) return .right;
    if (std.mem.eql(u8, raw, "both")) return .both;
    return error.InvalidTestPoseSide;
}

fn selectedAngleRangeDeg(bone: OwnedBone) !model.JointRange {
    const joint = bone.joint orelse return error.SelectedBoneHasNoJoint;
    const radians = switch (joint.kind) {
        .ball => joint.swing_x orelse return error.InvalidJoint,
        .hinge, .pivot, .spin, .slide => if (joint.limit_min != null and joint.limit_max != null)
            model.JointRange{ .min = joint.limit_min.?, .max = joint.limit_max.? }
        else
            return error.SelectedJointHasNoLimits,
        .fixed => return error.SelectedJointHasNoLimits,
    };
    if (joint.kind == .slide) return radians;
    const to_degrees: f32 = 180.0 / std.math.pi;
    return .{ .min = radians.min * to_degrees, .max = radians.max * to_degrees };
}

fn borrowedBones(session: *const Session, output: *[MAX_BONES]model.Bone) []const model.Bone {
    for (session.bones[0..session.bone_count], 0..) |bone, index| output[index] = .{
        .id = bone.id,
        .display_name = bone.display_name,
        .parent = bone.parent,
        .transform = bone.transform,
        .tip = bone.tip,
        .joint = bone.joint,
    };
    return output[0..session.bone_count];
}

fn borrowedObjectBindings(
    session: *const Session,
    output: *[MAX_OBJECT_BINDINGS]model.CharacterObjectBinding,
) []const model.CharacterObjectBinding {
    for (session.object_bindings[0..session.object_count], 0..) |binding, index| {
        output[index] = borrowedObjectBinding(binding);
    }
    return output[0..session.object_count];
}

fn bodyObjectId(session: *const Session) ![]const u8 {
    var result: ?[]const u8 = null;
    for (session.object_bindings[0..session.object_count]) |binding| {
        if (binding.mode != .body) continue;
        if (result != null) return error.MultipleBodyBindings;
        result = binding.object_id;
    }
    return result orelse error.MissingBodyBinding;
}

fn sessionOwnsObjectId(session: *const Session, object_id: []const u8) bool {
    for (session.range_object_ids[0..session.range_object_count]) |candidate| {
        if (std.mem.eql(u8, candidate, object_id)) return true;
    }
    return false;
}

fn openResidentTopology(
    session: *const Session,
    resident: ?*const ResidentContext,
) !character_topology.Topology {
    const context = resident orelse return error.ResidentTopologyUnavailable;
    if (!std.mem.eql(u8, session.model_source_key, context.source_key)) return error.ResidentSourceChanged;
    if (context.ranges.len != session.range_object_count * 2) return error.ObjectRangeCountMismatch;
    return character_topology.Topology.init(
        session.backing_allocator,
        context.snapshot,
        context.ranges,
        session.range_object_ids[0..session.range_object_count],
    );
}

/// Joint authoring is meaningful only after the resident body can eventually
/// bind. Keep this at the native command boundary so a stale or alternate UI
/// cannot recreate the dead-end flow where joints are positioned first and a
/// topology/anatomy failure appears only at Bind.
fn requireRigAuthoringReady(
    session: *const Session,
    resident: ?*const ResidentContext,
) !void {
    // `handle` is the context-free protocol harness used by skeleton/history
    // unit tests. The production host always enters through `handleResident`,
    // where resident topology makes this precondition enforceable.
    if (resident == null) return;
    // An adopted skin has already supplied and validated one normalized weight
    // row for every logical vertex. Connected-body and anatomy coverage are
    // prerequisites for the native solver, not for adjusting that external
    // skeleton over a deliberately multipart character (eyes, teeth, clothing).
    if (session.external_provenance != null) return;
    var topology = try openResidentTopology(session, resident);
    defer topology.deinit();
    const body_id = try bodyObjectId(session);
    if (!try topology.connectedObject(body_id)) return error.BodyNotConnected;
    if (session.external_provenance == null and !bodySemanticsReady(&topology, body_id)) {
        return error.RequiredSemanticCoverageIncomplete;
    }
}

fn sameHash(left: ?skin_binding.Hash, right: skin_binding.Hash) bool {
    return left != null and std.mem.eql(u8, &left.?, &right);
}

fn weightsMatchHashes(session: *const Session, current: character_topology.CharacterHashes) bool {
    return session.weights != null and
        sameHash(session.bound_topology_hash, current.topology) and
        sameHash(session.bound_semantic_hash, current.semantic) and
        sameHash(session.bound_object_binding_hash, current.object_binding);
}

fn requireCurrentWeights(
    session: *const Session,
    topology: *const character_topology.Topology,
) !*SharedWeights {
    const shared = session.weights orelse return error.NoCurrentWeights;
    var bones_buffer: [MAX_BONES]model.Bone = undefined;
    const bones = borrowedBones(session, &bones_buffer);
    var object_buffer: [MAX_OBJECT_BINDINGS]model.CharacterObjectBinding = undefined;
    const objects = borrowedObjectBindings(session, &object_buffer);
    const current = try topology.computeHashes(bones, objects);
    if (session.weights_stale or !weightsMatchHashes(session, current)) return error.StaleWeights;
    return shared;
}

fn testedJointId(test_name: TestPoseName, side: TestPoseSide) ![]const u8 {
    return switch (test_name) {
        .shoulder_abduction => switch (side) {
            .left => "upper_arm_left",
            .right => "upper_arm_right",
            .both => error.InvalidTestPoseSide,
        },
        .elbow_flex => switch (side) {
            .left => "lower_arm_left",
            .right => "lower_arm_right",
            .both => error.InvalidTestPoseSide,
        },
        .wrist_flex => switch (side) {
            .left => "hand_left",
            .right => "hand_right",
            .both => error.InvalidTestPoseSide,
        },
        .hip_flex => switch (side) {
            .left => "upper_leg_left",
            .right => "upper_leg_right",
            .both => error.InvalidTestPoseSide,
        },
        .knee_flex => switch (side) {
            .left => "lower_leg_left",
            .right => "lower_leg_right",
            .both => error.InvalidTestPoseSide,
        },
        .bind, .selected_joint => error.InvalidTestPose,
    };
}

fn runBendDiagnostic(
    allocator: std.mem.Allocator,
    session: *const Session,
    topology: *const character_topology.Topology,
    weights: []const autoweights.InfluenceRow,
    semantics: []const ?rig_bend_diagnostics.Semantic,
    joint_origins: []const rig_bend_diagnostics.JointOrigin,
    bone_ids: []const []const u8,
    test_name: TestPoseName,
    side: TestPoseSide,
) !rig_bend_diagnostics.Result {
    const tested_id = try testedJointId(test_name, side);
    const tested_index = session.boneIndex(tested_id) orelse return error.UnknownBone;
    var bind_global: [MAX_BONES]rig_pose.Mat4 = undefined;
    var pose_global: [MAX_BONES]rig_pose.Mat4 = undefined;
    var skin_matrices: [MAX_BONES]rig_pose.Mat4 = undefined;
    try evaluateSessionPose(session, .{ .name = test_name, .side = side }, &bind_global, &pose_global, &skin_matrices);
    return rig_bend_diagnostics.analyze(allocator, .{
        .logical_positions = topology.positions,
        .triangles = topology.triangles,
        .face_semantics = semantics,
        .influence_rows = weights,
        .bone_ids = bone_ids,
        .skin_matrices = skin_matrices[0..session.bone_count],
        .tested_joint = .{
            .bone_id = tested_id,
            .origin = joint_origins[tested_index].origin,
        },
        .joint_origins = joint_origins,
        .mirror_side = switch (side) {
            .left => .left,
            .right => .right,
            .both => unreachable,
        },
    }, rig_bend_diagnostics.DEFAULT_TUNING);
}

fn writeOptionalF64(writer: *std.Io.Writer, value: ?f64) !void {
    if (value) |number_value|
        try writer.print("{d}", .{number_value})
    else
        try writer.writeAll("null");
}

fn writeOptionalU32(writer: *std.Io.Writer, value: ?u32) !void {
    if (value) |number_value|
        try writer.print("{d}", .{number_value})
    else
        try writer.writeAll("null");
}

fn writeBendWorstVertices(writer: *std.Io.Writer, result: *const rig_bend_diagnostics.Result) !void {
    try writer.writeByte('[');
    for (result.worst_vertices, 0..) |worst, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.print("{{\"logicalVertexId\":{d},\"displacement\":{d},\"roles\":[", .{
            worst.logical_vertex_id,
            worst.displacement,
        });
        for (worst.roles(), 0..) |role, role_index| {
            if (role_index != 0) try writer.writeByte(',');
            try writeJsonString(writer, role);
        }
        try writer.writeAll("],\"nearestJoint\":");
        try writeJsonString(writer, worst.nearest_joint);
        try writer.writeByte('}');
    }
    try writer.writeByte(']');
}

fn writeBendSideResult(writer: *std.Io.Writer, result: *const rig_bend_diagnostics.Result) !void {
    const side = result.mirror_side orelse return error.MissingMirrorSide;
    try writer.writeAll("{\"side\":");
    try writeJsonString(writer, @tagName(side));
    try writer.print(",\"maxDisplacement\":{d},\"volumeDelta\":", .{result.max_displacement});
    try writeOptionalF64(writer, result.volume_delta);
    try writer.writeAll(",\"selfIntersections\":");
    try writeOptionalU32(writer, result.self_intersections);
    try writer.print(",\"creaseDepth\":{d},\"displacedVertices\":{d},\"worstVertexListComplete\":{s},\"worstVertices\":", .{
        result.crease_depth,
        result.displaced_vertex_count,
        if (result.worst_vertices_complete) "true" else "false",
    });
    try writeBendWorstVertices(writer, result);
    try writer.writeByte('}');
}

fn greaterAbsoluteVolume(left: ?f64, right: ?f64) ?f64 {
    if (left == null) return right;
    if (right == null) return left;
    return if (@abs(left.?) >= @abs(right.?)) left else right;
}

fn bodySemanticsReady(topology: *const character_topology.Topology, body_id: []const u8) bool {
    var audit = topology.semanticCoverageAudit(body_id, 0) catch return false;
    defer audit.deinit();
    return audit.requiredComplete() and audit.coverageComplete();
}

fn fitSkeleton(session: *Session, resident: ?*const ResidentContext) !void {
    if (session.bone_count != CANONICAL_BONE_COUNT) return error.CanonicalCommandUnavailable;
    var topology = try openResidentTopology(session, resident);
    defer topology.deinit();
    const body_id = try bodyObjectId(session);
    if (!try topology.connectedObject(body_id)) return error.BodyNotConnected;
    if (!bodySemanticsReady(&topology, body_id)) return error.RequiredSemanticCoverageIncomplete;
    var rig = try humanoid_fit.Rig.initHumanoidV1(session.backing_allocator);
    defer rig.deinit();

    var global_positions: [MAX_BONES]model.Vec3 = undefined;
    var global_rotations: [MAX_BONES]model.Quat = undefined;
    for (session.bones[0..session.bone_count], 0..) |bone, index| {
        const local_rotation = try rig_pose.fk.normalizeQuat(bone.transform.rot);
        if (bone.parent) |parent_id| {
            const parent_index = session.boneIndex(parent_id) orelse return error.UnknownBone;
            if (parent_index >= index) return error.InvalidBoneHierarchy;
            global_positions[index] = addVec3(
                global_positions[parent_index],
                try rig_pose.fk.rotateVec3(global_rotations[parent_index], bone.transform.pos),
            );
            global_rotations[index] = try rig_pose.fk.normalizeQuat(rig_pose.fk.multiplyQuat(
                global_rotations[parent_index],
                local_rotation,
            ));
        } else {
            global_positions[index] = bone.transform.pos;
            global_rotations[index] = local_rotation;
        }
        if (bone.fit.locked) {
            try rig.setManualGlobalTransform(bone.id, global_positions[index], global_rotations[index]);
        }
    }
    _ = try topology.refitBody(&rig, body_id);
    for (rig.bones, 0..) |fitted, index| {
        session.bones[index].transform = fitted.local_transform;
        session.bones[index].tip = fitted.local_tip;
        session.bones[index].fit = .{
            .bone_id = session.bones[index].id,
            .source = fitted.source,
            .confidence = fitted.confidence,
            .locked = fitted.locked,
        };
    }
    const shape_hex = character_hashes.hex(topology.shapeHash());
    session.shape_hash = try session.arena.allocator().dupe(u8, &shape_hex);
    session.fit_needs_review = fitNeedsReview(session);
    session.bind_needs_review = session.weights != null;
    if (session.weights == null and session.state != .draft) session.state = .needs_bind;
}

/// Preserve one adopted external binding while its resident mesh is uniformly
/// resized about the model origin. Palette order, semantic bindings, object
/// bindings, and logical top-four weights are scale-independent; only bind
/// translations, terminal tips, and the fitted resident-shape stamp move.
fn scaleExternalSkeleton(
    session: *Session,
    resident: ?*const ResidentContext,
    command: std.json.ObjectMap,
) !void {
    if (session.external_provenance == null) return error.ExternalRigRequired;
    const factor: f32 = @floatCast(try number(try required(command, "factor")));
    if (!std.math.isFinite(factor) or factor <= 0) return error.InvalidScaleFactor;

    var topology = try openResidentTopology(session, resident);
    defer topology.deinit();
    _ = try requireCurrentWeights(session, &topology);

    for (session.bones[0..session.bone_count]) |*bone| {
        for (&bone.transform.pos) |*component| component.* *= factor;
        if (bone.tip) |*tip| {
            for (tip) |*component| component.* *= factor;
        }
    }
    if (!session.editableValid()) return error.InvalidExternalSkeleton;

    const shape_hex = character_hashes.hex(topology.shapeHash());
    session.shape_hash = try session.arena.allocator().dupe(u8, &shape_hex);
    session.fit_needs_review = fitNeedsReview(session);
}

fn addVec3(left: model.Vec3, right: model.Vec3) model.Vec3 {
    return .{ left[0] + right[0], left[1] + right[1], left[2] + right[2] };
}

fn subVec3(left: model.Vec3, right: model.Vec3) model.Vec3 {
    return .{ left[0] - right[0], left[1] - right[1], left[2] - right[2] };
}

fn computeGlobalTransforms(
    session: *const Session,
    positions: *[MAX_BONES]model.Vec3,
    rotations: *[MAX_BONES]model.Quat,
) !void {
    for (session.bones[0..session.bone_count], 0..) |bone, index| {
        const local_rotation = try rig_pose.fk.normalizeQuat(bone.transform.rot);
        if (bone.parent) |parent_id| {
            const parent_index = session.boneIndex(parent_id) orelse return error.UnknownBone;
            if (parent_index >= index) return error.InvalidBoneHierarchy;
            positions[index] = addVec3(
                positions[parent_index],
                try rig_pose.fk.rotateVec3(rotations[parent_index], bone.transform.pos),
            );
            rotations[index] = try rig_pose.fk.normalizeQuat(rig_pose.fk.multiplyQuat(
                rotations[parent_index],
                local_rotation,
            ));
        } else {
            positions[index] = bone.transform.pos;
            rotations[index] = local_rotation;
        }
    }
}

fn localFromGlobal(
    parent_position: model.Vec3,
    parent_rotation: model.Quat,
    global_position: model.Vec3,
    global_rotation: model.Quat,
) !struct { pos: model.Vec3, rot: model.Quat } {
    const inverse_parent = rig_pose.fk.inverseUnitQuat(try rig_pose.fk.normalizeQuat(parent_rotation));
    return .{
        .pos = try rig_pose.fk.rotateVec3(inverse_parent, subVec3(global_position, parent_position)),
        .rot = try rig_pose.fk.normalizeQuat(rig_pose.fk.multiplyQuat(inverse_parent, global_rotation)),
    };
}

fn mirrorQuatAcrossX(value: model.Quat) !model.Quat {
    const normalized = try rig_pose.fk.normalizeQuat(value);
    return .{ normalized[0], -normalized[1], -normalized[2], normalized[3] };
}

fn oppositeSideBoneId(id: []const u8, source: TestPoseSide) ?[]const u8 {
    const source_suffix = if (source == .left) "_left" else "_right";
    const target_suffix = if (source == .left) "_right" else "_left";
    if (!std.mem.endsWith(u8, id, target_suffix)) return null;
    const stem = id[0 .. id.len - target_suffix.len];
    for (canonical.HUMANOID_V1_BONE_IDS) |candidate| {
        if (candidate.len == stem.len + source_suffix.len and
            std.mem.startsWith(u8, candidate, stem) and std.mem.endsWith(u8, candidate, source_suffix))
        {
            return candidate;
        }
    }
    return null;
}

fn vec3LengthSquared(value: model.Vec3) f32 {
    return value[0] * value[0] + value[1] * value[1] + value[2] * value[2];
}

fn boneSegmentLength(session: *const Session, bone_index: usize) f32 {
    const bone = session.bones[bone_index];
    if (std.mem.eql(u8, bone.id, "root")) return 0;
    for (session.bones[0..session.bone_count]) |child| {
        if (child.parent != null and std.mem.eql(u8, child.parent.?, bone.id)) {
            return @sqrt(vec3LengthSquared(child.transform.pos));
        }
    }
    return if (bone.tip) |tip| @sqrt(vec3LengthSquared(tip)) else 0;
}

fn setJointGlobalTransform(
    session: *Session,
    resident: ?*const ResidentContext,
    command: std.json.ObjectMap,
) !void {
    try requireRigAuthoringReady(session, resident);
    const index = session.boneIndex(try requiredString(command, "boneId")) orelse return error.UnknownBone;
    const origin = try vec3(try required(command, "origin"));
    var global_positions: [MAX_BONES]model.Vec3 = undefined;
    var global_rotations: [MAX_BONES]model.Quat = undefined;
    try computeGlobalTransforms(session, &global_positions, &global_rotations);
    const frame = if (command.get("frame")) |value|
        try rig_pose.fk.normalizeQuat(try quat(value))
    else
        global_rotations[index];
    const previous_bones = session.bones;
    errdefer session.bones = previous_bones;

    if (session.bones[index].parent) |parent_id| {
        const parent_index = session.boneIndex(parent_id) orelse return error.UnknownBone;
        const local = try localFromGlobal(
            global_positions[parent_index],
            global_rotations[parent_index],
            origin,
            frame,
        );
        session.bones[index].transform.pos = local.pos;
        session.bones[index].transform.rot = local.rot;
    } else {
        // `root` is the one deliberate whole-hierarchy translation control.
        session.bones[index].transform.pos = origin;
        session.bones[index].transform.rot = frame;
    }
    session.bones[index].fit = .{
        .bone_id = session.bones[index].id,
        .source = .manual,
        .confidence = 1,
        .locked = true,
    };

    // Every anatomical joint edit is an absolute placement operation. Keep its
    // immediate child joints and frames fixed in model space so moving a pelvis,
    // elbow, or knee actually changes adjacent segment lengths. Root is the only
    // exception: translating it intentionally carries the hierarchy.
    if (session.bones[index].parent != null) {
        for (session.bones[0..session.bone_count], 0..) |*child, child_index| {
            if (child.parent == null or !std.mem.eql(u8, child.parent.?, session.bones[index].id)) continue;
            const local = try localFromGlobal(origin, frame, global_positions[child_index], global_rotations[child_index]);
            child.transform.pos = local.pos;
            child.transform.rot = local.rot;
        }
    }
    if (!session.editableValid()) return error.InvalidSkeletonEdit;
    session.fit_needs_review = fitNeedsReview(session);
    session.bind_needs_review = true;
}

fn mirrorJoints(
    session: *Session,
    resident: ?*const ResidentContext,
    source: TestPoseSide,
) !void {
    if (source == .both) return error.InvalidMirrorSide;
    if (session.bone_count != CANONICAL_BONE_COUNT) return error.CanonicalCommandUnavailable;
    try requireRigAuthoringReady(session, resident);
    var global_positions: [MAX_BONES]model.Vec3 = undefined;
    var global_rotations: [MAX_BONES]model.Quat = undefined;
    try computeGlobalTransforms(session, &global_positions, &global_rotations);
    const previous_bones = session.bones;
    errdefer session.bones = previous_bones;

    for (session.bones[0..session.bone_count], 0..) |*target, target_index| {
        const source_id = oppositeSideBoneId(target.id, source) orelse continue;
        const source_index = session.boneIndex(source_id) orelse return error.UnknownBone;
        const desired_position = model.Vec3{
            -global_positions[source_index][0],
            global_positions[source_index][1],
            global_positions[source_index][2],
        };
        const desired_rotation = try mirrorQuatAcrossX(global_rotations[source_index]);
        if (target.parent) |parent_id| {
            const parent_index = session.boneIndex(parent_id) orelse return error.UnknownBone;
            const local = try localFromGlobal(
                global_positions[parent_index],
                global_rotations[parent_index],
                desired_position,
                desired_rotation,
            );
            target.transform.pos = local.pos;
            target.transform.rot = local.rot;
        } else {
            target.transform.pos = desired_position;
            target.transform.rot = desired_rotation;
        }
        if (session.bones[source_index].tip) |tip| target.tip = .{ -tip[0], tip[1], tip[2] };
        target.fit = .{
            .bone_id = target.id,
            .source = .manual,
            .confidence = 1,
            .locked = true,
        };
        // Later descendants must derive locals against this newly mirrored
        // parent, not the stale pre-operation target frame.
        global_positions[target_index] = desired_position;
        global_rotations[target_index] = desired_rotation;
    }
    if (!session.editableValid()) return error.InvalidSkeletonEdit;
    session.fit_needs_review = fitNeedsReview(session);
    session.bind_needs_review = true;
}

const PartSemantic = struct {
    role: model.HumanoidSemanticRole,
    side: ?model.HumanoidSide = null,
};

fn normalizedPartNameEqual(raw: []const u8, expected: []const u8) bool {
    var raw_index: usize = 0;
    var expected_index: usize = 0;
    while (true) {
        while (raw_index < raw.len and !std.ascii.isAlphanumeric(raw[raw_index])) raw_index += 1;
        while (expected_index < expected.len and !std.ascii.isAlphanumeric(expected[expected_index])) expected_index += 1;
        if (raw_index == raw.len or expected_index == expected.len) {
            return raw_index == raw.len and expected_index == expected.len;
        }
        if (std.ascii.toLower(raw[raw_index]) != std.ascii.toLower(expected[expected_index])) return false;
        raw_index += 1;
        expected_index += 1;
    }
}

fn partSemantic(name: []const u8) ?PartSemantic {
    const Alias = struct { name: []const u8, semantic: PartSemantic };
    const aliases = [_]Alias{
        .{ .name = "pelvis", .semantic = .{ .role = .pelvis } },
        .{ .name = "hips", .semantic = .{ .role = .pelvis } },
        .{ .name = "abdomen", .semantic = .{ .role = .abdomen } },
        .{ .name = "stomach", .semantic = .{ .role = .abdomen } },
        .{ .name = "chest", .semantic = .{ .role = .chest } },
        .{ .name = "torso", .semantic = .{ .role = .chest } },
        .{ .name = "head", .semantic = .{ .role = .head } },
        .{ .name = "neck", .semantic = .{ .role = .neck } },
        .{ .name = "clavicle_left", .semantic = .{ .role = .clavicle, .side = .left } },
        .{ .name = "left_clavicle", .semantic = .{ .role = .clavicle, .side = .left } },
        .{ .name = "clavicle_right", .semantic = .{ .role = .clavicle, .side = .right } },
        .{ .name = "right_clavicle", .semantic = .{ .role = .clavicle, .side = .right } },
        .{ .name = "upper_arm_left", .semantic = .{ .role = .upper_arm, .side = .left } },
        .{ .name = "left_upper_arm", .semantic = .{ .role = .upper_arm, .side = .left } },
        .{ .name = "upper_arm_right", .semantic = .{ .role = .upper_arm, .side = .right } },
        .{ .name = "right_upper_arm", .semantic = .{ .role = .upper_arm, .side = .right } },
        .{ .name = "lower_arm_left", .semantic = .{ .role = .lower_arm, .side = .left } },
        .{ .name = "left_lower_arm", .semantic = .{ .role = .lower_arm, .side = .left } },
        .{ .name = "forearm_left", .semantic = .{ .role = .lower_arm, .side = .left } },
        .{ .name = "lower_arm_right", .semantic = .{ .role = .lower_arm, .side = .right } },
        .{ .name = "right_lower_arm", .semantic = .{ .role = .lower_arm, .side = .right } },
        .{ .name = "forearm_right", .semantic = .{ .role = .lower_arm, .side = .right } },
        .{ .name = "hand_left", .semantic = .{ .role = .hand, .side = .left } },
        .{ .name = "left_hand", .semantic = .{ .role = .hand, .side = .left } },
        .{ .name = "hand_right", .semantic = .{ .role = .hand, .side = .right } },
        .{ .name = "right_hand", .semantic = .{ .role = .hand, .side = .right } },
        .{ .name = "upper_leg_left", .semantic = .{ .role = .upper_leg, .side = .left } },
        .{ .name = "left_upper_leg", .semantic = .{ .role = .upper_leg, .side = .left } },
        .{ .name = "thigh_left", .semantic = .{ .role = .upper_leg, .side = .left } },
        .{ .name = "upper_leg_right", .semantic = .{ .role = .upper_leg, .side = .right } },
        .{ .name = "right_upper_leg", .semantic = .{ .role = .upper_leg, .side = .right } },
        .{ .name = "thigh_right", .semantic = .{ .role = .upper_leg, .side = .right } },
        .{ .name = "lower_leg_left", .semantic = .{ .role = .lower_leg, .side = .left } },
        .{ .name = "left_lower_leg", .semantic = .{ .role = .lower_leg, .side = .left } },
        .{ .name = "shin_left", .semantic = .{ .role = .lower_leg, .side = .left } },
        .{ .name = "lower_leg_right", .semantic = .{ .role = .lower_leg, .side = .right } },
        .{ .name = "right_lower_leg", .semantic = .{ .role = .lower_leg, .side = .right } },
        .{ .name = "shin_right", .semantic = .{ .role = .lower_leg, .side = .right } },
        .{ .name = "foot_left", .semantic = .{ .role = .foot, .side = .left } },
        .{ .name = "left_foot", .semantic = .{ .role = .foot, .side = .left } },
        .{ .name = "foot_right", .semantic = .{ .role = .foot, .side = .right } },
        .{ .name = "right_foot", .semantic = .{ .role = .foot, .side = .right } },
        .{ .name = "fingers_left", .semantic = .{ .role = .fingers, .side = .left } },
        .{ .name = "fingers_right", .semantic = .{ .role = .fingers, .side = .right } },
        .{ .name = "toes_left", .semantic = .{ .role = .toes, .side = .left } },
        .{ .name = "toes_right", .semantic = .{ .role = .toes, .side = .right } },
    };
    for (aliases) |alias| if (normalizedPartNameEqual(name, alias.name)) return alias.semantic;
    return null;
}

fn semanticBindingIndex(
    session: *const Session,
    semantic: PartSemantic,
) ?usize {
    for (session.semantic_bindings[0..session.semantic_count], 0..) |binding, index| {
        if (binding.role == semantic.role and binding.side == semantic.side) return index;
    }
    return null;
}

const REQUIRED_CENTER_SEMANTICS = [_]model.HumanoidSemanticRole{
    .pelvis, .abdomen, .chest, .head,
};

const REQUIRED_PAIRED_SEMANTICS = [_]model.HumanoidSemanticRole{
    .upper_arm, .lower_arm, .hand, .upper_leg, .lower_leg, .foot,
};

const REQUIRED_SEMANTIC_BINDING_COUNT =
    REQUIRED_CENTER_SEMANTICS.len + REQUIRED_PAIRED_SEMANTICS.len * 2;

fn requiredSemanticBindingCount(session: *const Session) usize {
    var count: usize = 0;
    for (REQUIRED_CENTER_SEMANTICS) |role| {
        if (semanticBindingIndex(session, .{ .role = role }) != null) count += 1;
    }
    for (REQUIRED_PAIRED_SEMANTICS) |role| {
        if (semanticBindingIndex(session, .{ .role = role, .side = .left }) != null) count += 1;
        if (semanticBindingIndex(session, .{ .role = role, .side = .right }) != null) count += 1;
    }
    return count;
}

fn semanticSideWellFormed(role: model.HumanoidSemanticRole, side: ?model.HumanoidSide) bool {
    return switch (role) {
        .pelvis, .abdomen, .chest, .head, .neck => side == null,
        .upper_arm,
        .lower_arm,
        .hand,
        .upper_leg,
        .lower_leg,
        .foot,
        .clavicle,
        .fingers,
        .toes,
        => side != null,
    };
}

fn semanticDisplayName(
    allocator: std.mem.Allocator,
    role: model.HumanoidSemanticRole,
    side: ?model.HumanoidSide,
) ![]const u8 {
    const role_name = switch (role) {
        .pelvis => "Pelvis",
        .abdomen => "Abdomen",
        .chest => "Chest",
        .head => "Head",
        .upper_arm => "Upper Arm",
        .lower_arm => "Lower Arm",
        .hand => "Hand",
        .upper_leg => "Upper Leg",
        .lower_leg => "Lower Leg",
        .foot => "Foot",
        .neck => "Neck",
        .clavicle => "Clavicle",
        .fingers => "Fingers",
        .toes => "Toes",
    };
    if (side) |value| {
        return std.fmt.allocPrint(allocator, "{s} {s}", .{
            if (value == .left) "Left" else "Right",
            role_name,
        });
    }
    return allocator.dupe(u8, role_name);
}

fn setSemanticBinding(session: *Session, command: std.json.ObjectMap) !void {
    const bone_index = session.boneIndex(try requiredString(command, "boneId")) orelse return error.UnknownBone;
    const role = try parseRole(try requiredString(command, "role"));
    const side = try parseSide(command.get("side"));
    if (!semanticSideWellFormed(role, side)) return error.InvalidSemanticSide;

    const bone_id = session.bones[bone_index].id;
    var write_index: usize = 0;
    for (session.semantic_bindings[0..session.semantic_count]) |binding| {
        const same_semantic = binding.role == role and binding.side == side;
        const same_bone = std.mem.eql(u8, binding.bone_id, bone_id);
        if (same_semantic or same_bone) continue;
        session.semantic_bindings[write_index] = binding;
        write_index += 1;
    }
    if (write_index == MAX_SEMANTIC_BINDINGS) return error.TooManySemanticBindings;
    session.semantic_bindings[write_index] = .{
        .role = role,
        .side = side,
        .bone_id = bone_id,
    };
    session.semantic_count = write_index + 1;
    session.bones[bone_index].display_name = try semanticDisplayName(session.arena.allocator(), role, side);
}

fn partIndexForFace(context: *const ResidentContext, face_index: usize) !usize {
    const part_count = context.ranges.len / 2;
    if (part_count == 1) return 0;
    const groups = context.snapshot.groups orelse return error.ExternalPartGroupsUnavailable;
    if (face_index >= groups.len) return error.InvalidExternalFace;
    const group = groups[face_index];
    for (0..part_count) |part_index| {
        const lo = context.ranges[part_index * 2];
        const hi = context.ranges[part_index * 2 + 1];
        if (group >= lo and group < hi) return part_index;
    }
    return error.ExternalFaceOutsidePartRanges;
}

fn externalDisplayName(
    allocator: std.mem.Allocator,
    part_name: ?[]const u8,
    ordinal: usize,
    part_bone_count: usize,
    bone_index: usize,
) ![]const u8 {
    if (part_name) |name| {
        if (name.len != 0) {
            if (part_bone_count == 1) return allocator.dupe(u8, name);
            return std.fmt.allocPrint(allocator, "{s} {d}", .{ name, ordinal + 1 });
        }
    }
    return std.fmt.allocPrint(allocator, "Generated joint {d}", .{bone_index + 1});
}

const ExternalCoordinateBasis = struct {
    axes: [3]u2,
    signs: [3]f32,

    fn apply(self: ExternalCoordinateBasis, value: model.Vec3) model.Vec3 {
        return .{
            self.signs[0] * value[self.axes[0]],
            self.signs[1] * value[self.axes[1]],
            self.signs[2] * value[self.axes[2]],
        };
    }
};

/// OBJ does not carry an axis declaration. Importers may therefore rotate its
/// Y-up coordinates into their native basis even while preserving vertex
/// identity. Admit only one of the 48 exact signed-axis permutations that maps
/// every returned vertex back onto the same resident render corner. This keeps
/// index correspondence authoritative and rejects translation, scale,
/// reordering, or fuzzy position matching.
fn externalCoordinateBasis(
    incoming_vertices: []const model.Vec3,
    resident_vertices: []const f32,
) ?ExternalCoordinateBasis {
    const axis_permutations = [_][3]u2{
        .{ 0, 1, 2 },
        .{ 0, 2, 1 },
        .{ 1, 0, 2 },
        .{ 1, 2, 0 },
        .{ 2, 0, 1 },
        .{ 2, 1, 0 },
    };
    for (axis_permutations) |axes| {
        for (0..8) |sign_mask| {
            const basis = ExternalCoordinateBasis{
                .axes = axes,
                .signs = .{
                    if (sign_mask & 1 == 0) 1 else -1,
                    if (sign_mask & 2 == 0) 1 else -1,
                    if (sign_mask & 4 == 0) 1 else -1,
                },
            };
            var matches = true;
            for (incoming_vertices, 0..) |incoming, corner| {
                const transformed = basis.apply(incoming);
                const at = corner * 8;
                for (0..3) |axis| {
                    if (@abs(transformed[axis] - resident_vertices[at + axis]) > EXTERNAL_RIG_TUNING.coordinate_epsilon) {
                        matches = false;
                        break;
                    }
                }
                if (!matches) break;
            }
            if (matches) return basis;
        }
    }
    return null;
}

fn adoptExternalRig(
    session: *Session,
    resident: ?*const ResidentContext,
    command: std.json.ObjectMap,
) !void {
    const context = resident orelse return error.ResidentTopologyUnavailable;
    if (!std.mem.eql(u8, session.model_source_key, context.source_key)) return error.ResidentSourceChanged;
    const logical_ids = context.snapshot.render_corner_logical_ids orelse return error.LogicalTopologyUnavailable;
    const corner_count = context.snapshot.verts.len / 8;
    if (corner_count == 0 or logical_ids.len != corner_count or context.snapshot.logical_vertex_count == 0) {
        return error.LogicalTopologyUnavailable;
    }
    const part_names_values = (try array(try required(command, "partNames"))).items;
    const part_count = context.ranges.len / 2;
    if (part_count == 0 or part_names_values.len != part_count or part_count != session.range_object_count) {
        return error.ExternalPartCountMismatch;
    }
    var part_names: [MAX_OBJECT_BINDINGS][]const u8 = undefined;
    for (part_names_values, 0..) |value, index| {
        const name = try string(value);
        if (name.len > 128) return error.ExternalPartNameTooLong;
        part_names[index] = name;
    }

    const rig = try object(try required(command, "rig"));
    if (rig.get("ok")) |ok_value| if (!try boolean(ok_value)) return error.ExternalRigServiceRejected;
    const model_class = try optionalString(rig, "cls");
    const generation_seconds: ?f32 = if (rig.get("seconds")) |seconds_value|
        @floatCast(try number(seconds_value))
    else
        null;
    const joint_values = (try array(try required(rig, "joints"))).items;
    const parent_values = (try array(try required(rig, "parents"))).items;
    const vertex_values = (try array(try required(rig, "vertices"))).items;
    const skin_values = (try array(try required(rig, "skin_top4"))).items;
    if (joint_values.len == 0 or joint_values.len > MAX_BONES or parent_values.len != joint_values.len) {
        return error.InvalidExternalBoneCount;
    }
    if (vertex_values.len != corner_count or skin_values.len != corner_count) {
        return error.ExternalCornerCountMismatch;
    }
    const bone_count = joint_values.len;
    var joints: [MAX_BONES]model.Vec3 = undefined;
    var parents: [MAX_BONES]?u8 = undefined;
    var child_counts: [MAX_BONES]u16 = @splat(0);
    var root_count: usize = 0;
    for (joint_values, parent_values, 0..) |joint_value, parent_value, index| {
        joints[index] = try vec3(joint_value);
        const parent = try signed(parent_value);
        if (parent < 0) {
            parents[index] = null;
            root_count += 1;
        } else {
            const parent_index = std.math.cast(usize, parent) orelse return error.InvalidExternalParent;
            if (parent_index >= index or parent_index >= bone_count) return error.InvalidExternalParent;
            parents[index] = @intCast(parent_index);
            child_counts[parent_index] += 1;
        }
    }
    if (root_count != 1 or parents[0] != null) return error.InvalidExternalHierarchy;

    const external_vertices = try session.backing_allocator.alloc(model.Vec3, corner_count);
    defer session.backing_allocator.free(external_vertices);
    for (vertex_values, 0..) |vertex_value, corner| external_vertices[corner] = try vec3(vertex_value);
    const coordinate_basis = externalCoordinateBasis(external_vertices, context.snapshot.verts) orelse
        return error.ExternalCoordinateMismatch;
    for (joints[0..bone_count]) |*joint| joint.* = coordinate_basis.apply(joint.*);

    var bounds_min: model.Vec3 = @splat(std.math.inf(f32));
    var bounds_max: model.Vec3 = @splat(-std.math.inf(f32));
    for (0..corner_count) |corner| {
        const at = corner * 8;
        for (0..3) |axis| {
            const resident_value = context.snapshot.verts[at + axis];
            bounds_min[axis] = @min(bounds_min[axis], resident_value);
            bounds_max[axis] = @max(bounds_max[axis], resident_value);
        }
    }

    const logical_count: usize = context.snapshot.logical_vertex_count;
    const dense_len = std.math.mul(usize, logical_count, bone_count) catch return error.ExternalWeightsTooLarge;
    const dense = try session.backing_allocator.alloc(f64, dense_len);
    defer session.backing_allocator.free(dense);
    @memset(dense, 0);
    const logical_corner_counts = try session.backing_allocator.alloc(u32, logical_count);
    defer session.backing_allocator.free(logical_corner_counts);
    @memset(logical_corner_counts, 0);
    const score_len = std.math.mul(usize, bone_count, part_count) catch return error.ExternalWeightsTooLarge;
    const part_scores = try session.backing_allocator.alloc(f64, score_len);
    defer session.backing_allocator.free(part_scores);
    @memset(part_scores, 0);

    for (skin_values, logical_ids, 0..) |skin_value, logical_id, corner| {
        if (logical_id >= logical_count) return error.InvalidLogicalVertex;
        const influences = (try array(skin_value)).items;
        if (influences.len == 0 or influences.len > autoweights.MAX_INFLUENCES) return error.InvalidExternalWeightRow;
        var seen: [MAX_BONES]bool = @splat(false);
        var previous = std.math.inf(f64);
        var sum: f64 = 0;
        const face_part = try partIndexForFace(context, corner / 3);
        for (influences) |influence_value| {
            const pair = (try array(influence_value)).items;
            if (pair.len != 2) return error.InvalidExternalWeightRow;
            const bone = try unsigned(pair[0]);
            if (bone >= bone_count or seen[bone]) return error.InvalidExternalWeightRow;
            const weight = try number(pair[1]);
            if (weight < 0 or weight > previous) return error.InvalidExternalWeightRow;
            previous = weight;
            seen[bone] = true;
            sum += weight;
            dense[@as(usize, logical_id) * bone_count + @as(usize, @intCast(bone))] += weight;
            part_scores[@as(usize, @intCast(bone)) * part_count + face_part] += weight;
        }
        if (@abs(sum - 1.0) > skin_binding.NORMALIZATION_TOLERANCE) return error.InvalidExternalWeightSum;
        logical_corner_counts[logical_id] += 1;
    }

    const next_weights = try SharedWeights.create(session.backing_allocator, logical_count);
    errdefer next_weights.release();
    for (next_weights.rows, logical_corner_counts, 0..) |*row, duplicates, logical_id| {
        if (duplicates == 0) return error.MissingExternalLogicalVertex;
        row.* = .{};
        const source = dense[logical_id * bone_count .. (logical_id + 1) * bone_count];
        for (source, 0..) |accumulated, bone_index| {
            if (accumulated <= 0) continue;
            const averaged = accumulated / @as(f64, @floatFromInt(duplicates));
            var slot: usize = 0;
            while (slot < autoweights.MAX_INFLUENCES and averaged <= row.weights[slot]) : (slot += 1) {}
            if (slot == autoweights.MAX_INFLUENCES) continue;
            var shift = autoweights.MAX_INFLUENCES - 1;
            while (shift > slot) : (shift -= 1) {
                row.bone_indices[shift] = row.bone_indices[shift - 1];
                row.weights[shift] = row.weights[shift - 1];
            }
            row.bone_indices[slot] = @intCast(bone_index);
            row.weights[slot] = @floatCast(averaged);
        }
        var retained_sum: f32 = 0;
        for (row.weights) |weight| retained_sum += weight;
        if (!std.math.isFinite(retained_sum) or retained_sum <= 0) return error.InvalidExternalWeightRow;
        for (&row.weights) |*weight| weight.* /= retained_sum;
        var normalized_sum: f32 = 0;
        for (row.weights) |weight| normalized_sum += weight;
        row.weights[0] += 1 - normalized_sum;
    }

    // External rows obey the same joint-span law the native solver enforces
    // (req_4303/req_4304): influence dust on a bone far from the row's
    // dominant chain is invisible at bind and tears the mesh the moment the
    // near chain animates away — the M4004 toe-weighted finger. Prune at
    // the adoption boundary so no external service can hand us one.
    {
        var prune_segments: [MAX_BONES]autoweights.BoneSegment = undefined;
        for (0..bone_count) |bone_index| {
            prune_segments[bone_index] = .{
                .parent_index = if (parents[bone_index]) |parent| parent else null,
                .origin = .{ 0, 0, 0 },
                .tip = .{ 0, 1, 0 },
            };
        }
        autoweights.pruneDistantInfluences(prune_segments[0..bone_count], next_weights.rows);
    }

    var dominant_parts: [MAX_BONES]?u8 = @splat(null);
    var dominance: [MAX_BONES]f32 = @splat(0);
    var part_bone_counts: [MAX_OBJECT_BINDINGS]u16 = @splat(0);
    for (0..bone_count) |bone_index| {
        const scores = part_scores[bone_index * part_count .. (bone_index + 1) * part_count];
        var total: f64 = 0;
        var best: f64 = 0;
        var best_part: ?usize = null;
        for (scores, 0..) |score, part_index| {
            total += score;
            if (score > best) {
                best = score;
                best_part = part_index;
            }
        }
        if (best_part) |part_index| {
            dominant_parts[bone_index] = @intCast(part_index);
            dominance[bone_index] = if (total > 0) @floatCast(best / total) else 0;
            part_bone_counts[part_index] += 1;
        }
    }

    const arena = session.arena.allocator();
    var part_ordinals: [MAX_OBJECT_BINDINGS]u16 = @splat(0);
    session.semantic_count = 0;
    var semantic_scores: [MAX_SEMANTIC_BINDINGS]f64 = @splat(0);
    for (0..bone_count) |bone_index| {
        const parent = parents[bone_index];
        const local_position = if (parent) |parent_index|
            subVec3(joints[bone_index], joints[parent_index])
        else
            joints[bone_index];
        const id = try std.fmt.allocPrint(arena, "external_joint_{d}", .{bone_index});
        const dominant_part = dominant_parts[bone_index];
        const display_name = if (dominant_part) |part_index| blk: {
            const ordinal = part_ordinals[part_index];
            part_ordinals[part_index] += 1;
            break :blk try externalDisplayName(
                arena,
                part_names[part_index],
                ordinal,
                part_bone_counts[part_index],
                bone_index,
            );
        } else try externalDisplayName(arena, null, 0, 0, bone_index);
        const semantic = if (dominant_part) |part_index| partSemantic(part_names[part_index]) else null;
        const confidence = if (semantic != null and dominance[bone_index] >= EXTERNAL_RIG_TUNING.semantic_dominance_floor)
            dominance[bone_index]
        else
            @min(EXTERNAL_RIG_TUNING.generated_fit_confidence, dominance[bone_index]);
        session.bones[bone_index] = .{
            .id = id,
            .display_name = display_name,
            .parent = if (parent) |parent_index| session.bones[parent_index].id else null,
            .transform = .{ .pos = local_position },
            .tip = null,
            .joint = null,
            .fit = .{
                .bone_id = id,
                .source = .external,
                .confidence = confidence,
                .locked = false,
            },
        };
        if (semantic) |binding_semantic| if (dominance[bone_index] >= EXTERNAL_RIG_TUNING.semantic_dominance_floor) {
            const direct_score = part_scores[bone_index * part_count + dominant_part.?];
            if (semanticBindingIndex(session, binding_semantic)) |binding_index| {
                if (direct_score > semantic_scores[binding_index]) {
                    session.semantic_bindings[binding_index].bone_id = id;
                    semantic_scores[binding_index] = direct_score;
                }
            } else if (session.semantic_count < MAX_SEMANTIC_BINDINGS) {
                const binding_index = session.semantic_count;
                session.semantic_bindings[binding_index] = .{
                    .role = binding_semantic.role,
                    .side = binding_semantic.side,
                    .bone_id = id,
                };
                semantic_scores[binding_index] = direct_score;
                session.semantic_count += 1;
            }
        };
    }
    session.bone_count = bone_count;

    var maximum_extent: f32 = 0;
    for (0..3) |axis| maximum_extent = @max(maximum_extent, bounds_max[axis] - bounds_min[axis]);
    const fallback_tip = @max(
        EXTERNAL_RIG_TUNING.minimum_leaf_tip,
        maximum_extent * EXTERNAL_RIG_TUNING.leaf_tip_bounds_fraction,
    );
    for (session.bones[0..session.bone_count], child_counts[0..session.bone_count]) |*bone, children| {
        if (children != 0) continue;
        const length_squared = vec3LengthSquared(bone.transform.pos);
        bone.tip = if (length_squared > 1.0e-12) blk: {
            const scale = EXTERNAL_RIG_TUNING.leaf_tip_parent_fraction;
            break :blk .{
                bone.transform.pos[0] * scale,
                bone.transform.pos[1] * scale,
                bone.transform.pos[2] * scale,
            };
        } else .{ 0, fallback_tip, 0 };
    }

    if (!session.editableValid()) return error.InvalidExternalSkeleton;
    var topology = try openResidentTopology(session, resident);
    defer topology.deinit();
    var bones_buffer: [MAX_BONES]model.Bone = undefined;
    const bones = borrowedBones(session, &bones_buffer);
    var object_buffer: [MAX_OBJECT_BINDINGS]model.CharacterObjectBinding = undefined;
    const objects = borrowedObjectBindings(session, &object_buffer);
    const current = try topology.computeHashes(bones, objects);
    const shape_hex = character_hashes.hex(topology.shapeHash());
    session.shape_hash = try arena.dupe(u8, &shape_hex);
    session.skeleton_id = try arena.dupe(u8, "skintokens-external");
    session.external_provenance = .{
        .provider = try arena.dupe(u8, "SkinTokens"),
        .model_class = try dupeOptional(arena, model_class),
        .seconds = generation_seconds,
    };
    if (session.weights) |weights| weights.release();
    session.weights = next_weights;
    session.bound_topology_hash = current.topology;
    session.bound_semantic_hash = current.semantic;
    session.bound_object_binding_hash = current.object_binding;
    session.state = .bound;
    session.fit_needs_review = fitNeedsReview(session);
    session.bind_needs_review = false;
    session.has_saved_binding = false;
    session.saved_binding = null;
    session.binding_error = null;
    session.weights_stale = false;
    session.selected_bone = null;
    session.selected_vertex = null;
}

fn autoBind(session: *Session, resident: ?*const ResidentContext) !void {
    var topology = try openResidentTopology(session, resident);
    defer topology.deinit();
    const body_id = try bodyObjectId(session);
    if (!try topology.connectedObject(body_id)) return error.BodyNotConnected;
    if (!bodySemanticsReady(&topology, body_id)) return error.RequiredSemanticCoverageIncomplete;
    var bones_buffer: [MAX_BONES]model.Bone = undefined;
    const bones = borrowedBones(session, &bones_buffer);
    var object_buffer: [MAX_OBJECT_BINDINGS]model.CharacterObjectBinding = undefined;
    const objects = borrowedObjectBindings(session, &object_buffer);
    const next_weights = try SharedWeights.create(session.backing_allocator, topology.positions.len);
    errdefer next_weights.release();
    try topology.solveWeights(bones, session.semantic_bindings[0..session.semantic_count], objects, next_weights.rows);
    const current = try topology.computeHashes(bones, objects);
    if (session.weights) |weights| weights.release();
    session.weights = next_weights;
    session.bound_topology_hash = current.topology;
    session.bound_semantic_hash = current.semantic;
    session.bound_object_binding_hash = current.object_binding;
    session.state = .bound;
    session.bind_needs_review = false;
    session.has_saved_binding = false;
    session.saved_binding = null;
    session.binding_error = null;
    session.weights_stale = false;
}

/// In-place joint-span repair (req_4304): re-apply the prune law to the
/// resident weight rows without re-solving or re-adopting. Heals bindings
/// that entered before the law existed. Copy-on-write — consumers holding
/// the old shared rows are never mutated under their feet; save then
/// persists the pruned rows as a fresh content-addressed artifact.
fn pruneResidentWeights(session: *Session) !void {
    if (session.state != .bound) return error.RigNotBound;
    const current_weights = session.weights orelse return error.RigNotBound;
    if (session.bone_count == 0) return error.InvalidBoneCount;

    var segments: [MAX_BONES]autoweights.BoneSegment = undefined;
    for (session.bones[0..session.bone_count], 0..) |bone, index| {
        const parent_index: ?u16 = if (bone.parent) |parent_id| blk: {
            const parent = session.boneIndex(parent_id) orelse return error.InvalidBoneHierarchy;
            if (parent >= index) return error.InvalidBoneHierarchy;
            break :blk parent;
        } else null;
        segments[index] = .{
            .parent_index = parent_index,
            .origin = .{ 0, 0, 0 },
            .tip = .{ 0, 1, 0 },
        };
    }

    const next_weights = try SharedWeights.create(session.backing_allocator, current_weights.rows.len);
    errdefer next_weights.release();
    @memcpy(next_weights.rows, current_weights.rows);
    autoweights.pruneDistantInfluences(segments[0..session.bone_count], next_weights.rows);
    current_weights.release();
    session.weights = next_weights;
    session.has_saved_binding = false;
    session.saved_binding = null;
    session.binding_error = null;
    session.weights_stale = false;
}

fn safeRelativeArtifactPath(path: []const u8) bool {
    if (path.len == 0 or path[0] == '/' or path[0] == '\\') return false;
    var components = std.mem.splitScalar(u8, path, '/');
    while (components.next()) |component| {
        if (component.len == 0 or std.mem.eql(u8, component, ".") or std.mem.eql(u8, component, "..")) return false;
    }
    return std.mem.indexOfScalar(u8, path, '\\') == null;
}

fn loadSavedWeights(session: *Session, resident: ?*const ResidentContext) !void {
    const context = resident orelse return error.ResidentTopologyUnavailable;
    const reference = session.saved_binding orelse return;
    if (!safeRelativeArtifactPath(reference.path)) return error.UnsafeBindingPath;
    var topology = try openResidentTopology(session, resident);
    defer topology.deinit();
    var bones_buffer: [MAX_BONES]model.Bone = undefined;
    const bones = borrowedBones(session, &bones_buffer);
    var object_buffer: [MAX_OBJECT_BINDINGS]model.CharacterObjectBinding = undefined;
    const objects = borrowedObjectBindings(session, &object_buffer);
    const current = try topology.computeHashes(bones, objects);
    const expected = skin_binding.Hashes{
        .topology = try character_hashes.parseHex(reference.topology_hash),
        .semantic = try character_hashes.parseHex(reference.semantic_hash),
        .skeleton = try character_hashes.parseHex(reference.skeleton_hash),
        .object_binding = try character_hashes.parseHex(reference.object_binding_hash),
    };
    try skin_binding.expectHashes(.{
        .topology = current.topology,
        .semantic = current.semantic,
        .skeleton = current.skeleton,
        .object_binding = current.object_binding,
    }, expected);
    if (reference.logical_vertex_count != topology.positions.len or reference.max_influences != 4 or reference.version != 1) {
        return error.BindingReferenceMismatch;
    }
    const path = try std.fmt.allocPrint(session.backing_allocator, "{s}/{s}", .{ session.package_path, reference.path });
    defer session.backing_allocator.free(path);
    const bytes = try std.Io.Dir.cwd().readFileAlloc(
        context.io,
        path,
        session.backing_allocator,
        .limited(512 << 20),
    );
    defer session.backing_allocator.free(bytes);
    const artifact = skin_binding.artifactHash(bytes);
    const declared_artifact = try character_hashes.parseHex(reference.artifact_hash);
    if (!std.mem.eql(u8, &artifact, &declared_artifact)) return error.ArtifactHashMismatch;
    var binding = try skin_binding.decodeExpected(session.backing_allocator, bytes, expected);
    defer binding.deinit();
    if (binding.logical_vertex_count != topology.positions.len) return error.BindingReferenceMismatch;
    const palette_map = try session.backing_allocator.alloc(u8, binding.bone_ids.len);
    defer session.backing_allocator.free(palette_map);
    var palette_ids_buffer: [MAX_BONES][]const u8 = undefined;
    try skin_binding.stableIdPaletteMap(binding.bone_ids, session.boneIds(&palette_ids_buffer), palette_map);
    const rows = try SharedWeights.create(session.backing_allocator, binding.bone_indices.len);
    errdefer rows.release();
    for (binding.bone_indices, binding.weights, rows.rows) |indices, weights, *row| {
        row.* = .{};
        for (indices, weights, 0..) |bone_table_index, weight, influence| {
            row.weights[influence] = weight;
            if (bone_table_index == skin_binding.UNUSED_BONE) continue;
            const palette_index = palette_map[bone_table_index];
            row.bone_indices[influence] = palette_index;
        }
    }
    if (session.weights) |weights| weights.release();
    session.weights = rows;
    session.bound_topology_hash = current.topology;
    session.bound_semantic_hash = current.semantic;
    session.bound_object_binding_hash = current.object_binding;
    session.state = .bound;
    session.bind_needs_review = false;
    session.has_saved_binding = true;
    session.binding_error = null;
    session.weights_stale = false;
}

const CommandHistoryKind = enum { authoring, view, undo, redo };

fn commandHistoryKind(kind: []const u8) CommandHistoryKind {
    if (std.mem.eql(u8, kind, "undo")) return .undo;
    if (std.mem.eql(u8, kind, "redo")) return .redo;
    if (std.mem.eql(u8, kind, "fitSkeleton") or
        std.mem.eql(u8, kind, "setJointTransform") or
        std.mem.eql(u8, kind, "setJointGlobalTransform") or
        std.mem.eql(u8, kind, "setJointConstraint") or
        std.mem.eql(u8, kind, "setJointLock") or
        std.mem.eql(u8, kind, "mirrorJoints") or
        std.mem.eql(u8, kind, "scaleExternalSkeleton") or
        std.mem.eql(u8, kind, "setSemanticBinding") or
        std.mem.eql(u8, kind, "setObjectBinding") or
        std.mem.eql(u8, kind, "adoptExternalRig") or
        std.mem.eql(u8, kind, "pruneWeights") or
        std.mem.eql(u8, kind, "autoBind")) return .authoring;
    return .view;
}

fn historyAllocator(session: *const Session) std.mem.Allocator {
    if (g_history_allocator == null) g_history_allocator = session.backing_allocator;
    return g_history_allocator.?;
}

fn clearRedoHistory(session: *const Session) void {
    if (g_redo_history.items.len == 0) return;
    clearHistoryStack(&g_redo_history, historyAllocator(session));
}

fn undoHistory(session: *Session) !void {
    if (g_undo_history.items.len == 0) return error.NothingToUndo;
    const allocator = historyAllocator(session);
    var current = try cloneSession(session);
    errdefer current.deinit();
    try g_redo_history.append(allocator, current);
    const target = g_undo_history.pop() orelse unreachable;
    adoptHistorySnapshot(session, target);
}

fn redoHistory(session: *Session) !void {
    if (g_redo_history.items.len == 0) return error.NothingToRedo;
    const allocator = historyAllocator(session);
    var current = try cloneSession(session);
    errdefer current.deinit();
    try g_undo_history.append(allocator, current);
    const target = g_redo_history.pop() orelse unreachable;
    adoptHistorySnapshot(session, target);
}

fn applyCommand(session: *Session, command_value: std.json.Value, resident: ?*const ResidentContext) !void {
    const command = try object(command_value);
    const kind = try requiredString(command, "kind");
    if (std.mem.eql(u8, kind, "setViewportActive")) {
        session.viewport_active = try boolean(try required(command, "active"));
        return;
    }
    if (std.mem.eql(u8, kind, "fitSkeleton")) return fitSkeleton(session, resident);
    if (std.mem.eql(u8, kind, "autoBind")) return autoBind(session, resident);
    if (std.mem.eql(u8, kind, "pruneWeights")) return pruneResidentWeights(session);
    if (std.mem.eql(u8, kind, "adoptExternalRig")) return adoptExternalRig(session, resident, command);
    if (std.mem.eql(u8, kind, "setJointGlobalTransform")) return setJointGlobalTransform(session, resident, command);
    if (std.mem.eql(u8, kind, "scaleExternalSkeleton")) return scaleExternalSkeleton(session, resident, command);
    if (std.mem.eql(u8, kind, "mirrorJoints")) {
        const source = try parseTestPoseSide(try required(command, "source")) orelse return error.InvalidMirrorSide;
        return mirrorJoints(session, resident, source);
    }
    if (std.mem.eql(u8, kind, "setSemanticBinding")) return setSemanticBinding(session, command);
    if (std.mem.eql(u8, kind, "selectVertex")) {
        if (!session.viewport_active) return error.RigViewportInactive;
        const context = resident orelse return error.ResidentTopologyUnavailable;
        const viewport_x: f32 = @floatCast(try number(try required(command, "viewportX")));
        const viewport_y: f32 = @floatCast(try number(try required(command, "viewportY")));
        // Skeleton overlays win the same viewport gesture. A miss falls through
        // to the resident mesh raycast and its durable logical-vertex record.
        if (context.pick_bone) |pick_bone| if (pick_bone(viewport_x, viewport_y)) |bone_index| {
            if (bone_index >= session.bone_count) return error.UnknownBone;
            session.selected_bone = bone_index;
            session.selected_vertex = null;
            return;
        };
        const picker = context.pick_logical_vertex orelse return error.VertexPickingUnavailable;
        session.selected_vertex = picker(viewport_x, viewport_y);
        if (session.selected_vertex) |logical_id| {
            if (logical_id >= context.snapshot.logical_vertex_count) return error.InvalidLogicalVertex;
        }
        return;
    }

    if (std.mem.eql(u8, kind, "selectBone")) {
        const value = try required(command, "boneId");
        session.selected_bone = if (value == .null)
            null
        else
            session.boneIndex(try string(value)) orelse return error.UnknownBone;
        return;
    }
    if (std.mem.eql(u8, kind, "setJointLock")) {
        try requireRigAuthoringReady(session, resident);
        const index = session.boneIndex(try requiredString(command, "boneId")) orelse return error.UnknownBone;
        session.bones[index].fit.locked = try boolean(try required(command, "locked"));
        return;
    }
    if (std.mem.eql(u8, kind, "setJointTransform")) {
        try requireRigAuthoringReady(session, resident);
        const index = session.boneIndex(try requiredString(command, "boneId")) orelse return error.UnknownBone;
        const transform = try parseTransform(command.get("transform"));
        const preserve_children = if (command.get("preserveChildren")) |value| try boolean(value) else false;
        const previous_bones = session.bones;
        errdefer session.bones = previous_bones;
        const previous_transform = previous_bones[index].transform;
        session.bones[index].transform = transform;
        session.bones[index].fit = .{
            .bone_id = session.bones[index].id,
            .source = .manual,
            .confidence = 1,
            .locked = true,
        };
        // Root remains the explicit whole-hierarchy control. For every other
        // joint, bind-fitting translation can instead resize its adjacent
        // segments: immediate child origins are counter-transformed in the
        // selected joint's local frame, which anchors those child joints (and
        // therefore their entire descendant subtrees) in model space.
        if (preserve_children and session.bones[index].parent != null) {
            const translation_delta = subVec3(transform.pos, previous_transform.pos);
            if (vec3LengthSquared(translation_delta) > 1.0e-16) {
                const selected_bone_id = session.bones[index].id;
                const previous_rotation = try rig_pose.fk.normalizeQuat(previous_transform.rot);
                const next_rotation = try rig_pose.fk.normalizeQuat(transform.rot);
                const inverse_next_rotation = rig_pose.fk.inverseUnitQuat(next_rotation);
                for (session.bones[0..session.bone_count]) |*child| {
                    if (child.parent == null or !std.mem.eql(u8, child.parent.?, selected_bone_id)) continue;
                    const previous_offset = try rig_pose.fk.rotateVec3(previous_rotation, child.transform.pos);
                    const anchored_offset = subVec3(previous_offset, translation_delta);
                    child.transform.pos = try rig_pose.fk.rotateVec3(inverse_next_rotation, anchored_offset);
                }
            }
        }
        if (!session.editableValid()) return error.InvalidSkeletonEdit;
        session.fit_needs_review = fitNeedsReview(session);
        session.bind_needs_review = true;
        return;
    }
    if (std.mem.eql(u8, kind, "setJointConstraint")) {
        try requireRigAuthoringReady(session, resident);
        const index = session.boneIndex(try requiredString(command, "boneId")) orelse return error.UnknownBone;
        const previous = session.bones[index].joint;
        session.bones[index].joint = try parseJoint(try required(command, "joint"));
        if (!session.editableValid()) {
            session.bones[index].joint = previous;
            return error.InvalidSkeletonEdit;
        }
        session.bind_needs_review = true;
        return;
    }
    if (std.mem.eql(u8, kind, "setObjectBinding")) {
        const incoming = try parseObjectBinding(try required(command, "binding"));
        // Production always supplies a resident range table. The context-free
        // protocol harness intentionally has no object topology to validate.
        if (resident != null and !sessionOwnsObjectId(session, incoming.object_id)) return error.UnknownObject;
        var existing: ?usize = null;
        var previous_body: ?usize = null;
        for (session.object_bindings[0..session.object_count], 0..) |binding, index| {
            if (std.mem.eql(u8, binding.object_id, incoming.object_id)) {
                existing = index;
            }
            if (binding.mode == .body) previous_body = index;
        }
        if (existing) |index| {
            const previous_target = session.object_bindings[index];
            const prior_body = if (previous_body) |body_index| session.object_bindings[body_index] else null;
            if (incoming.mode == .body and previous_body != null and previous_body.? != index) {
                session.object_bindings[previous_body.?].mode = .deformable;
                session.object_bindings[previous_body.?].bone_id = null;
            }
            session.object_bindings[index] = .{
                .object_id = previous_target.object_id,
                .mode = incoming.mode,
                .bone_id = incoming.bone_id,
            };
            const valid = session.editableValid();
            if (!valid) {
                session.object_bindings[index] = previous_target;
                if (previous_body) |body_index| session.object_bindings[body_index] = prior_body.?;
                return error.InvalidObjectBinding;
            }
        } else {
            if (session.object_count == MAX_OBJECT_BINDINGS) return error.TooManyObjectBindings;
            const prior_body = if (previous_body) |body_index| session.object_bindings[body_index] else null;
            if (incoming.mode == .body and previous_body != null) {
                session.object_bindings[previous_body.?].mode = .deformable;
                session.object_bindings[previous_body.?].bone_id = null;
            }
            session.object_bindings[session.object_count] = incoming;
            session.object_count += 1;
            const valid = session.editableValid();
            session.object_count -= 1;
            if (!valid) {
                if (previous_body) |body_index| session.object_bindings[body_index] = prior_body.?;
                return error.InvalidObjectBinding;
            }
            session.object_bindings[session.object_count] = incoming;
            session.object_bindings[session.object_count].object_id = try session.arena.allocator().dupe(u8, incoming.object_id);
            session.object_count += 1;
        }
        session.state = .needs_bind;
        session.bind_needs_review = true;
        session.has_saved_binding = false;
        session.saved_binding = null;
        // Keep the prior f32 rows and their domain hashes resident so readiness
        // can name exactly which domain changed. Viewport deformation and Seat
        // diagnostics use them only while all hashes remain current.
        session.weights_stale = true;
        return;
    }
    if (std.mem.eql(u8, kind, "setOverlay")) {
        const overlay = try object(try required(command, "overlay"));
        if (overlay.get("bindMesh")) |value| session.overlay.bind_mesh = try boolean(value);
        if (overlay.get("deformedMesh")) |value| session.overlay.deformed_mesh = try boolean(value);
        if (overlay.get("axes")) |value| session.overlay.axes = try boolean(value);
        if (overlay.get("names")) |value| session.overlay.names = try boolean(value);
        if (overlay.get("heatmap")) |value| session.overlay.heatmap = try boolean(value);
        return;
    }
    if (std.mem.eql(u8, kind, "setTestPose")) {
        try requireRigAuthoringReady(session, resident);
        const pose = try object(try required(command, "pose"));
        const name = try parseTestPoseName(try requiredString(pose, "name"));
        var angle_deg: ?f32 = null;
        if (name == .selected_joint) {
            const bone_index = session.selected_bone orelse return error.NoSelectedBone;
            const authored_range = try selectedAngleRangeDeg(session.bones[bone_index]);
            const requested: f32 = @floatCast(try number(try required(pose, "angleDeg")));
            angle_deg = std.math.clamp(requested, authored_range.min, authored_range.max);
        } else if (pose.get("angleDeg")) |value| {
            angle_deg = @floatCast(try number(value));
        }
        session.test_pose = .{
            .name = name,
            .side = try parseTestPoseSide(pose.get("side")),
            .angle_deg = angle_deg,
        };
        return;
    }
    return error.UnknownCommand;
}

fn handleOpen(
    allocator: std.mem.Allocator,
    payload: std.json.Value,
    resident: ?*const ResidentContext,
) ![]u8 {
    var parsed_document = parseOpenPayload(allocator, payload) catch |err| {
        return operationErrorReply(allocator, "invalid character rig open payload", err);
    };
    defer parsed_document.deinit();
    const verdict = bones_loader.validate(allocator, parsed_document.open.skeleton(), bones_loader.accept_all) catch |err| {
        return operationErrorReply(allocator, "character skeleton validation failed", err);
    };
    switch (verdict) {
        .ok => {},
        .reject => |rejection| {
            var message_buffer: [220]u8 = undefined;
            const message = std.fmt.bufPrint(&message_buffer, "character skeleton rejected: {s} ({s})", .{
                @tagName(rejection.reason), rejection.detail,
            }) catch "character skeleton rejected";
            return errorReply(allocator, message, if (g_session) |*session| session.revision else null);
        },
    }
    var candidate = ownSession(allocator, &parsed_document.open) catch |err| {
        return operationErrorReply(allocator, "character session ownership failed", err);
    };
    errdefer candidate.deinit();
    if (resident) |context| {
        if (!std.mem.eql(u8, candidate.model_source_key, context.source_key)) {
            return errorReply(allocator, "character rig open rejected: resident source key changed", if (g_session) |*session| session.revision else null);
        }
        if (context.ranges.len != candidate.range_object_count * 2) {
            return errorReply(allocator, "character rig open rejected: stable object ids do not match resident ranges", if (g_session) |*session| session.revision else null);
        }
    }
    if (candidate.saved_binding != null) {
        loadSavedWeights(&candidate, resident) catch |err| {
            candidate.state = .needs_bind;
            candidate.has_saved_binding = false;
            if (candidate.weights) |weights| weights.release();
            candidate.weights = null;
            candidate.bind_needs_review = true;
            candidate.weights_stale = true;
            candidate.binding_error = try candidate.arena.allocator().dupe(u8, @errorName(err));
        };
    }
    const reply = try snapshotReply(allocator, &candidate, resident);
    clearHistory();
    if (g_session) |*old| old.deinit();
    g_session = candidate;
    g_history_allocator = allocator;
    g_next_session_id += 1;
    return reply;
}

fn handleCommand(
    allocator: std.mem.Allocator,
    request: std.json.ObjectMap,
    resident: ?*const ResidentContext,
) ![]u8 {
    const session = requireSession(request, true) catch |err| {
        return operationErrorReply(allocator, "character rig command rejected", err);
    };
    const payload = required(request, "payload") catch |err| {
        return operationErrorReply(allocator, "character rig command rejected", err);
    };
    const command = object(payload) catch |err| {
        return operationErrorReply(allocator, "character rig command rejected", err);
    };
    const kind = requiredString(command, "kind") catch |err| {
        return operationErrorReply(allocator, "character rig command rejected", err);
    };
    switch (commandHistoryKind(kind)) {
        .undo => {
            undoHistory(session) catch |err| {
                return operationErrorReply(allocator, "character rig undo rejected", err);
            };
            return snapshotReply(allocator, session, resident);
        },
        .redo => {
            redoHistory(session) catch |err| {
                return operationErrorReply(allocator, "character rig redo rejected", err);
            };
            return snapshotReply(allocator, session, resident);
        },
        .view => {
            applyCommand(session, payload, resident) catch |err| {
                return operationErrorReply(allocator, "character rig command rejected", err);
            };
            session.revision += 1;
            return snapshotReply(allocator, session, resident);
        },
        .authoring => {},
    }

    var before = cloneSession(session) catch |err| {
        return operationErrorReply(allocator, "character rig history capture failed", err);
    };
    const history_allocator = historyAllocator(session);
    g_undo_history.append(history_allocator, before) catch |err| {
        before.deinit();
        return operationErrorReply(allocator, "character rig history capture failed", err);
    };
    applyCommand(session, payload, resident) catch |err| {
        const restore = g_undo_history.pop() orelse unreachable;
        session.deinit();
        session.* = restore;
        return operationErrorReply(allocator, "character rig command rejected", err);
    };
    const captured = &g_undo_history.items[g_undo_history.items.len - 1];
    if (authoredStateEqual(captured, session)) {
        var discarded = g_undo_history.pop() orelse unreachable;
        discarded.deinit();
        // The accepted command is still an acknowledged revision, but it is
        // not an undo unit and cannot abandon an existing redo branch.
        session.revision += 1;
        return snapshotReply(allocator, session, resident);
    }
    clearRedoHistory(session);
    trimUndoHistory();
    session.revision += 1;
    return snapshotReply(allocator, session, resident);
}

fn handleSnapshot(
    allocator: std.mem.Allocator,
    request: std.json.ObjectMap,
    resident: ?*const ResidentContext,
) ![]u8 {
    const session = requireSession(request, false) catch |err| {
        return operationErrorReply(allocator, "character rig snapshot rejected", err);
    };
    return snapshotReply(allocator, session, resident);
}

/// Inspect the resident object partition before installing a humanoid
/// descriptor. The largest connected component, not outliner order or display
/// name, determines which stable object id is the only safe default BODY.
fn handleAttachPreflight(
    allocator: std.mem.Allocator,
    request: std.json.ObjectMap,
    resident: ?*const ResidentContext,
) ![]u8 {
    const context = resident orelse {
        return errorReply(allocator, "character rig attach preflight rejected: resident topology is unavailable", null);
    };
    const payload = object(required(request, "payload") catch |err| {
        return operationErrorReply(allocator, "character rig attach preflight rejected", err);
    }) catch |err| {
        return operationErrorReply(allocator, "character rig attach preflight rejected", err);
    };
    const items = (array(required(payload, "rangeObjectIds") catch |err| {
        return operationErrorReply(allocator, "character rig attach preflight rejected", err);
    }) catch |err| {
        return operationErrorReply(allocator, "character rig attach preflight rejected", err);
    }).items;
    if (items.len == 0 or items.len > MAX_OBJECT_BINDINGS) {
        return errorReply(allocator, "character rig attach preflight rejected: rangeObjectIds must name every resident object", null);
    }
    var object_ids: [MAX_OBJECT_BINDINGS][]const u8 = undefined;
    for (items, 0..) |item, index| {
        const object_id = string(item) catch |err| {
            return operationErrorReply(allocator, "character rig attach preflight rejected", err);
        };
        if (object_id.len == 0) {
            return errorReply(allocator, "character rig attach preflight rejected: stable object ids cannot be empty", null);
        }
        for (object_ids[0..index]) |prior| if (std.mem.eql(u8, prior, object_id)) {
            return errorReply(allocator, "character rig attach preflight rejected: stable object ids must be unique", null);
        };
        object_ids[index] = object_id;
    }
    if (context.ranges.len != items.len * 2) {
        return errorReply(allocator, "character rig attach preflight rejected: resident object ranges do not match the outliner", null);
    }
    var topology = character_topology.Topology.init(
        allocator,
        context.snapshot,
        context.ranges,
        object_ids[0..items.len],
    ) catch |err| {
        return operationErrorReply(allocator, "character rig attach preflight rejected", err);
    };
    defer topology.deinit();

    var summaries: [MAX_OBJECT_BINDINGS]character_topology.ObjectComponentSummary = undefined;
    var initialized: usize = 0;
    defer for (summaries[0..initialized]) |*summary| summary.deinit();
    var recommended_index: usize = 0;
    for (object_ids[0..items.len], 0..) |object_id, index| {
        summaries[index] = topology.objectComponentSummary(object_id, 0) catch |err| {
            return operationErrorReply(allocator, "character rig attach preflight rejected", err);
        };
        initialized += 1;
        const candidate = summaries[index];
        const best = summaries[recommended_index];
        if (candidate.largest_component_triangle_count > best.largest_component_triangle_count or
            (candidate.largest_component_triangle_count == best.largest_component_triangle_count and
                candidate.largest_component_logical_vertex_count > best.largest_component_logical_vertex_count))
        {
            recommended_index = index;
        }
    }

    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"value\":{\"accepted\":");
    try output.writer.writeAll(if (recommended_index == 0) "true" else "false");
    try output.writer.writeAll(",\"candidateBodyObjectId\":");
    try writeJsonString(&output.writer, object_ids[0]);
    try output.writer.writeAll(",\"recommendedBodyObjectId\":");
    try writeJsonString(&output.writer, object_ids[recommended_index]);
    try output.writer.writeAll(",\"objects\":[");
    for (object_ids[0..items.len], summaries[0..items.len], 0..) |object_id, summary, index| {
        if (index != 0) try output.writer.writeByte(',');
        try output.writer.writeAll("{\"objectId\":");
        try writeJsonString(&output.writer, object_id);
        try output.writer.print(",\"rank\":{d},\"components\":{d},\"triangles\":{d},\"largestConnectedTriangles\":{d},\"largestConnectedVertices\":{d}}}", .{
            index,
            summary.component_count,
            summary.triangle_count,
            summary.largest_component_triangle_count,
            summary.largest_component_logical_vertex_count,
        });
    }
    try output.writer.writeAll("]}}");
    return allocator.dupe(u8, output.written());
}

fn handleInspect(
    allocator: std.mem.Allocator,
    request: std.json.ObjectMap,
    resident: ?*const ResidentContext,
) ![]u8 {
    const session = requireSession(request, true) catch |err| {
        return operationErrorReply(allocator, "character rig inspection rejected", err);
    };
    const payload = object(required(request, "payload") catch |err| {
        return operationErrorReply(allocator, "character rig inspection rejected", err);
    }) catch |err| {
        return operationErrorReply(allocator, "character rig inspection rejected", err);
    };
    const kind = requiredString(payload, "kind") catch |err| {
        return operationErrorReply(allocator, "character rig inspection rejected", err);
    };
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"value\":");

    if (std.mem.eql(u8, kind, "skeleton")) {
        var global_positions: [MAX_BONES]model.Vec3 = undefined;
        var global_rotations: [MAX_BONES]model.Quat = undefined;
        computeGlobalTransforms(session, &global_positions, &global_rotations) catch |err| {
            return operationErrorReply(allocator, "character rig skeleton inspection rejected", err);
        };
        try output.writer.writeAll("{\"bones\":[");
        for (session.bones[0..session.bone_count], 0..) |bone, index| {
            if (index != 0) try output.writer.writeByte(',');
            try output.writer.writeAll("{\"id\":");
            try writeJsonString(&output.writer, bone.id);
            try output.writer.writeAll(",\"parent\":");
            if (bone.parent) |parent| try writeJsonString(&output.writer, parent) else try output.writer.writeAll("null");
            try output.writer.writeAll(",\"origin\":");
            try writeVec3(&output.writer, global_positions[index]);
            try output.writer.writeAll(",\"frame\":");
            try writeQuat(&output.writer, global_rotations[index]);
            try output.writer.writeAll(",\"localTransform\":{\"pos\":");
            try writeVec3(&output.writer, bone.transform.pos);
            try output.writer.writeAll(",\"rot\":");
            try writeQuat(&output.writer, bone.transform.rot);
            try output.writer.writeAll(",\"scale\":");
            try writeVec3(&output.writer, bone.transform.scale);
            try output.writer.writeByte('}');
            if (bone.tip) |tip| {
                try output.writer.writeAll(",\"tip\":");
                try writeVec3(&output.writer, tip);
            }
            if (bone.joint) |joint| {
                try output.writer.writeAll(",\"joint\":");
                try writeJoint(&output.writer, joint);
            }
            try output.writer.writeAll(",\"fit\":{\"source\":");
            try writeJsonString(&output.writer, @tagName(bone.fit.source));
            try output.writer.print(",\"confidence\":{d},\"locked\":{s}}},\"segmentLength\":{d}}}", .{
                bone.fit.confidence,
                if (bone.fit.locked) "true" else "false",
                boneSegmentLength(session, index),
            });
        }
        try output.writer.writeAll("]}}");
        return allocator.dupe(u8, output.written());
    }

    var topology = openResidentTopology(session, resident) catch |err| {
        return operationErrorReply(allocator, "character rig inspection rejected", err);
    };
    defer topology.deinit();
    const body_id = bodyObjectId(session) catch |err| {
        return operationErrorReply(allocator, "character rig inspection rejected", err);
    };

    if (std.mem.eql(u8, kind, "probe")) {
        _ = requireCurrentWeights(session, &topology) catch |err| {
            return operationErrorReply(allocator, "character rig vertex probe rejected", err);
        };
        const logical_id_raw = unsigned(required(payload, "logicalVertexId") catch |err| {
            return operationErrorReply(allocator, "character rig vertex probe rejected", err);
        }) catch |err| {
            return operationErrorReply(allocator, "character rig vertex probe rejected", err);
        };
        const logical_id = std.math.cast(u32, logical_id_raw) orelse {
            return errorReply(allocator, "character rig vertex probe rejected: logical vertex id is out of range", session.revision);
        };
        writeVertexProbe(&output.writer, session, &topology, logical_id) catch |err| {
            return operationErrorReply(allocator, "character rig vertex probe rejected", err);
        };
        try output.writer.writeByte('}');
        return allocator.dupe(u8, output.written());
    }
    if (std.mem.eql(u8, kind, "bendTest")) {
        const shared_weights = requireCurrentWeights(session, &topology) catch |err| {
            return operationErrorReply(allocator, "character rig bend test rejected", err);
        };
        if (shared_weights.rows.len != topology.positions.len) {
            return errorReply(allocator, "character rig bend test rejected: resident logical vertex count changed", session.revision);
        }
        const test_name = parseTestPoseName(requiredString(payload, "test") catch |err| {
            return operationErrorReply(allocator, "character rig bend test rejected", err);
        }) catch |err| {
            return operationErrorReply(allocator, "character rig bend test rejected", err);
        };
        switch (test_name) {
            .bind, .selected_joint => return errorReply(
                allocator,
                "character rig bend test rejected: expected shoulder, elbow, wrist, hip, or knee preset",
                session.revision,
            ),
            else => {},
        }
        const requested_side = parseTestPoseSide(payload.get("side")) catch |err| {
            return operationErrorReply(allocator, "character rig bend test rejected", err);
        } orelse return errorReply(
            allocator,
            "character rig bend test rejected: side is required",
            session.revision,
        );

        const diagnostic_semantics = allocator.alloc(?rig_bend_diagnostics.Semantic, topology.face_semantics.len) catch |err| {
            return operationErrorReply(allocator, "character rig bend test rejected", err);
        };
        defer allocator.free(diagnostic_semantics);
        for (topology.face_semantics, diagnostic_semantics) |semantic, *converted| {
            converted.* = if (semantic) |value| .{ .role = value.role, .side = value.side } else null;
        }
        var global_positions: [MAX_BONES]model.Vec3 = undefined;
        var global_rotations: [MAX_BONES]model.Quat = undefined;
        computeGlobalTransforms(session, &global_positions, &global_rotations) catch |err| {
            return operationErrorReply(allocator, "character rig bend test rejected", err);
        };
        var joint_origins: [MAX_BONES]rig_bend_diagnostics.JointOrigin = undefined;
        var bone_ids: [MAX_BONES][]const u8 = undefined;
        for (session.bones[0..session.bone_count], 0..) |bone, index| {
            bone_ids[index] = bone.id;
            joint_origins[index] = .{ .bone_id = bone.id, .origin = global_positions[index] };
        }

        try output.writer.writeAll("{\"test\":");
        try writeJsonString(&output.writer, @tagName(test_name));
        try output.writer.writeAll(",\"side\":");
        try writeJsonString(&output.writer, @tagName(requested_side));

        if (requested_side != .both) {
            var result = runBendDiagnostic(
                allocator,
                session,
                &topology,
                shared_weights.rows,
                diagnostic_semantics,
                joint_origins[0..session.bone_count],
                bone_ids[0..session.bone_count],
                test_name,
                requested_side,
            ) catch |err| {
                return operationErrorReply(allocator, "character rig bend test rejected", err);
            };
            defer result.deinit();
            try output.writer.print(",\"maxDisplacement\":{d},\"volumeDelta\":", .{result.max_displacement});
            try writeOptionalF64(&output.writer, result.volume_delta);
            try output.writer.writeAll(",\"selfIntersections\":");
            try writeOptionalU32(&output.writer, result.self_intersections);
            try output.writer.print(",\"creaseDepth\":{d},\"asymmetry\":null,\"worstVertices\":", .{result.crease_depth});
            try writeBendWorstVertices(&output.writer, &result);
            try output.writer.writeAll(",\"sides\":[");
            try writeBendSideResult(&output.writer, &result);
            try output.writer.writeAll("]}}");
            return allocator.dupe(u8, output.written());
        }

        var left = runBendDiagnostic(
            allocator,
            session,
            &topology,
            shared_weights.rows,
            diagnostic_semantics,
            joint_origins[0..session.bone_count],
            bone_ids[0..session.bone_count],
            test_name,
            .left,
        ) catch |err| {
            return operationErrorReply(allocator, "character rig bend test rejected", err);
        };
        defer left.deinit();
        var right = runBendDiagnostic(
            allocator,
            session,
            &topology,
            shared_weights.rows,
            diagnostic_semantics,
            joint_origins[0..session.bone_count],
            bone_ids[0..session.bone_count],
            test_name,
            .right,
        ) catch |err| {
            return operationErrorReply(allocator, "character rig bend test rejected", err);
        };
        defer right.deinit();
        const comparison = rig_bend_diagnostics.compareMirroredSides(&left, &right) catch |err| {
            return operationErrorReply(allocator, "character rig bend test rejected", err);
        };
        const maximum_displacement = @max(left.max_displacement, right.max_displacement);
        const maximum_crease = @max(left.crease_depth, right.crease_depth);
        const maximum_intersections: ?u32 = if (left.self_intersections != null and right.self_intersections != null)
            @max(left.self_intersections.?, right.self_intersections.?)
        else
            null;
        try output.writer.print(",\"maxDisplacement\":{d},\"volumeDelta\":", .{maximum_displacement});
        try writeOptionalF64(&output.writer, greaterAbsoluteVolume(left.volume_delta, right.volume_delta));
        try output.writer.writeAll(",\"selfIntersections\":");
        try writeOptionalU32(&output.writer, maximum_intersections);
        try output.writer.print(",\"creaseDepth\":{d},\"asymmetry\":{d},\"worstVertices\":[", .{
            maximum_crease,
            comparison.asymmetry,
        });
        for (left.worst_vertices, 0..) |worst, index| {
            if (index != 0) try output.writer.writeByte(',');
            try output.writer.print("{{\"logicalVertexId\":{d},\"displacement\":{d},\"roles\":[", .{
                worst.logical_vertex_id,
                worst.displacement,
            });
            for (worst.roles(), 0..) |role, role_index| {
                if (role_index != 0) try output.writer.writeByte(',');
                try writeJsonString(&output.writer, role);
            }
            try output.writer.writeAll("],\"nearestJoint\":");
            try writeJsonString(&output.writer, worst.nearest_joint);
            try output.writer.writeByte('}');
        }
        for (right.worst_vertices, 0..) |worst, index| {
            if (left.worst_vertices.len != 0 or index != 0) try output.writer.writeByte(',');
            try output.writer.print("{{\"logicalVertexId\":{d},\"displacement\":{d},\"roles\":[", .{
                worst.logical_vertex_id,
                worst.displacement,
            });
            for (worst.roles(), 0..) |role, role_index| {
                if (role_index != 0) try output.writer.writeByte(',');
                try writeJsonString(&output.writer, role);
            }
            try output.writer.writeAll("],\"nearestJoint\":");
            try writeJsonString(&output.writer, worst.nearest_joint);
            try output.writer.writeByte('}');
        }
        try output.writer.writeAll("],\"sides\":[");
        try writeBendSideResult(&output.writer, &left);
        try output.writer.writeByte(',');
        try writeBendSideResult(&output.writer, &right);
        try output.writer.writeAll("]}}");
        return allocator.dupe(u8, output.written());
    }
    if (std.mem.eql(u8, kind, "weightsSummary") or std.mem.eql(u8, kind, "weightsSymmetry")) {
        const shared_weights = requireCurrentWeights(session, &topology) catch |err| {
            return operationErrorReply(allocator, "character rig weight inspection rejected", err);
        };
        if (shared_weights.rows.len != topology.positions.len) {
            return errorReply(allocator, "character rig weight inspection rejected: resident logical vertex count changed", session.revision);
        }
        const diagnostic_semantics = allocator.alloc(?rig_weight_diagnostics.Semantic, topology.face_semantics.len) catch |err| {
            return operationErrorReply(allocator, "character rig weight inspection rejected", err);
        };
        defer allocator.free(diagnostic_semantics);
        for (topology.face_semantics, diagnostic_semantics) |semantic, *converted| {
            converted.* = if (semantic) |value| .{ .role = value.role, .side = value.side } else null;
        }
        const input = rig_weight_diagnostics.Input{
            .logical_positions = topology.positions,
            .triangles = topology.triangles,
            .face_semantics = diagnostic_semantics,
            .influence_rows = shared_weights.rows,
            .bone_ids = canonical.HUMANOID_V1_BONE_IDS[0..],
            .semantic_bindings = session.semantic_bindings[0..session.semantic_count],
        };
        if (std.mem.eql(u8, kind, "weightsSummary")) {
            const bone_id = canonicalId(requiredString(payload, "boneId") catch |err| {
                return operationErrorReply(allocator, "character rig weight summary rejected", err);
            }) orelse {
                return errorReply(allocator, "character rig weight summary rejected: unknown stable bone id", session.revision);
            };
            var summary = rig_weight_diagnostics.weightsSummary(
                allocator,
                input,
                bone_id,
                rig_weight_diagnostics.DEFAULT_TUNING,
            ) catch |err| {
                return operationErrorReply(allocator, "character rig weight summary rejected", err);
            };
            defer summary.deinit();
            try output.writer.writeAll("{\"boneId\":");
            try writeJsonString(&output.writer, bone_id);
            try output.writer.print(",\"vertices\":{d},\"totalWeight\":{d},\"bbox\":", .{
                summary.influenced_vertex_count,
                summary.total_weight,
            });
            if (summary.bounds) |bounds| {
                try output.writer.print("[{d},{d},{d},{d},{d},{d}]", .{
                    bounds.min[0], bounds.min[1], bounds.min[2],
                    bounds.max[0], bounds.max[1], bounds.max[2],
                });
            } else try output.writer.writeAll("null");
            try output.writer.print(",\"maxWeightOutsideRole\":{d},\"bleedsInto\":[", .{
                summary.max_weight_outside_mapped_roles,
            });
            for (summary.role_bleed_rows, 0..) |row, index| {
                if (index != 0) try output.writer.writeByte(',');
                try output.writer.writeAll("{\"role\":");
                try writeJsonString(&output.writer, row.stable_role_key);
                try output.writer.print(",\"totalWeight\":{d},\"maxWeight\":{d}}}", .{ row.total_weight, row.max_weight });
            }
            try output.writer.writeAll("]}}");
            return allocator.dupe(u8, output.written());
        }

        const tolerance: ?f32 = if (payload.get("tolerance")) |value|
            @floatCast(number(value) catch |err| {
                return operationErrorReply(allocator, "character rig weight symmetry rejected", err);
            })
        else
            null;
        var symmetry = rig_weight_diagnostics.weightsSymmetry(allocator, input, .{
            .position_tolerance = tolerance,
        }) catch |err| {
            return operationErrorReply(allocator, "character rig weight symmetry rejected", err);
        };
        defer symmetry.deinit();
        try output.writer.print("{{\"tolerance\":{d},\"comparedVertices\":{d},\"unmatchedVertices\":{d},\"offenderCount\":{d},\"maxError\":{d},\"offenderVertexIds\":[", .{
            tolerance orelse rig_weight_diagnostics.DEFAULT_TUNING.symmetry_position_tolerance,
            symmetry.compared_vertex_count,
            symmetry.unmatched_vertex_count,
            symmetry.offender_vertex_count,
            symmetry.max_error,
        });
        for (symmetry.offender_logical_ids, 0..) |logical_id, index| {
            if (index != 0) try output.writer.writeByte(',');
            try output.writer.print("{d}", .{logical_id});
        }
        try output.writer.print("],\"offenderListComplete\":{s}}}}}", .{
            if (symmetry.offender_ids_complete) "true" else "false",
        });
        return allocator.dupe(u8, output.written());
    }
    if (std.mem.eql(u8, kind, "boundaryAudit")) {
        var audit = topology.boundaryAudit(body_id, humanoid_fit.DEFAULT_TUNING) catch |err| {
            return operationErrorReply(allocator, "character rig boundary audit rejected", err);
        };
        defer audit.deinit();
        var ragged_count: u32 = 0;
        for (audit.rows) |row| if (row.ragged) {
            ragged_count += 1;
        };
        try output.writer.writeAll("{\"entries\":[");
        for (audit.rows, 0..) |row, index| {
            if (index != 0) try output.writer.writeByte(',');
            try output.writer.writeAll("{\"proximalRole\":");
            try writeSemanticKey(&output.writer, row.proximal);
            try output.writer.writeAll(",\"distalRole\":");
            try writeSemanticKey(&output.writer, row.distal);
            try output.writer.print(",\"sharedEdgeCount\":{d},\"componentCount\":{d},\"closedLoopCount\":{d},\"ragged\":{s}", .{
                row.shared_edge_count,
                row.component_count,
                row.closed_loop_count,
                if (row.ragged) "true" else "false",
            });
            if (row.fit) |fitted| {
                try output.writer.writeAll(",\"point\":");
                try writeVec3(&output.writer, fitted.point);
                try output.writer.writeAll(",\"planeNormal\":");
                try writeVec3(&output.writer, fitted.plane_normal);
                try output.writer.print(",\"width\":{d},\"perimeter\":{d},\"planarity\":{d},\"confidence\":{d}", .{
                    fitted.width, fitted.perimeter, fitted.planarity, fitted.confidence,
                });
            }
            try output.writer.writeByte('}');
        }
        try output.writer.print("],\"raggedCount\":{d}}}}}", .{ragged_count});
        return allocator.dupe(u8, output.written());
    }
    if (std.mem.eql(u8, kind, "selectDetached")) {
        var summary = topology.objectComponentSummary(body_id, topology.triangles.len) catch |err| {
            return operationErrorReply(allocator, "character rig detached selection rejected", err);
        };
        defer summary.deinit();
        const selector = if (resident) |context| context.select_faces orelse {
            return errorReply(allocator, "character rig detached selection rejected: native face selection is unavailable", session.revision);
        } else {
            return errorReply(allocator, "character rig detached selection rejected: resident topology is unavailable", session.revision);
        };
        const selected = selector(summary.stray_face_indices);
        try output.writer.print("{{\"selectedFaces\":{d},\"expectedFaces\":{d}}}}}", .{ selected, summary.stray_triangle_count });
        return allocator.dupe(u8, output.written());
    }
    if (std.mem.eql(u8, kind, "selectUncovered")) {
        var coverage = topology.semanticCoverageAudit(body_id, topology.triangles.len) catch |err| {
            return operationErrorReply(allocator, "character rig uncovered selection rejected", err);
        };
        defer coverage.deinit();
        const selector = if (resident) |context| context.select_faces orelse {
            return errorReply(allocator, "character rig uncovered selection rejected: native face selection is unavailable", session.revision);
        } else {
            return errorReply(allocator, "character rig uncovered selection rejected: resident topology is unavailable", session.revision);
        };
        const selected = selector(coverage.uncovered_face_indices);
        try output.writer.print("{{\"selectedFaces\":{d},\"expectedFaces\":{d}}}}}", .{ selected, coverage.uncovered_body_face_count });
        return allocator.dupe(u8, output.written());
    }
    return errorReply(allocator, "unknown character rig inspection", session.revision);
}

fn writeSemanticBinding(writer: *std.Io.Writer, binding: model.HumanoidSemanticBinding) !void {
    try writer.writeAll("{\"role\":");
    try writeJsonString(writer, @tagName(binding.role));
    if (binding.side) |side| {
        try writer.writeAll(",\"side\":");
        try writeJsonString(writer, @tagName(side));
    }
    try writer.writeAll(",\"boneId\":");
    try writeJsonString(writer, binding.bone_id);
    try writer.writeByte('}');
}

fn writeDescriptor(
    writer: *std.Io.Writer,
    session: *const Session,
    state_value: model.CharacterRigState,
    shape_hash: []const u8,
) !void {
    try writer.writeAll("{\"version\":1,\"state\":");
    try writeJsonString(writer, @tagName(state_value));
    try writer.writeAll(",\"semanticBindings\":[");
    for (session.semantic_bindings[0..session.semantic_count], 0..) |binding, index| {
        if (index != 0) try writer.writeByte(',');
        try writeSemanticBinding(writer, binding);
    }
    try writer.writeAll("],\"objectBindings\":[");
    for (session.object_bindings[0..session.object_count], 0..) |binding, index| {
        if (index != 0) try writer.writeByte(',');
        try writeObjectBinding(writer, binding);
    }
    try writer.writeAll("],\"fit\":{");
    for (session.bones[0..session.bone_count], 0..) |bone, index| {
        if (index != 0) try writer.writeByte(',');
        try writeJsonString(writer, bone.id);
        try writer.writeAll(":{\"source\":");
        try writeJsonString(writer, @tagName(bone.fit.source));
        try writer.print(",\"confidence\":{d},\"locked\":{s}}}", .{
            bone.fit.confidence,
            if (bone.fit.locked) "true" else "false",
        });
    }
    try writer.writeAll("},\"shapeHash\":");
    try writeJsonString(writer, shape_hash);
    if (session.external_provenance) |provenance| {
        try writer.writeAll(",\"externalProvenance\":{\"provider\":");
        try writeJsonString(writer, provenance.provider);
        if (provenance.model_class) |model_class| {
            try writer.writeAll(",\"modelClass\":");
            try writeJsonString(writer, model_class);
        }
        if (provenance.seconds) |seconds| try writer.print(",\"seconds\":{d}", .{seconds});
        try writer.writeByte('}');
    }
    try writer.writeByte('}');
}

fn writeSkeleton(
    writer: *std.Io.Writer,
    session: *const Session,
    state_value: model.CharacterRigState,
    shape_hash: []const u8,
) !void {
    try writer.writeAll("{\"id\":");
    try writeJsonString(writer, session.skeleton_id);
    try writer.writeAll(",\"bones\":[");
    for (session.bones[0..session.bone_count], 0..) |bone, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.writeAll("{\"id\":");
        try writeJsonString(writer, bone.id);
        try writer.writeAll(",\"displayName\":");
        try writeJsonString(writer, bone.display_name);
        if (bone.parent) |parent| {
            try writer.writeAll(",\"parent\":");
            try writeJsonString(writer, parent);
        }
        try writer.writeAll(",\"transform\":{\"pos\":");
        try writeVec3(writer, bone.transform.pos);
        try writer.writeAll(",\"rot\":");
        try writeQuat(writer, bone.transform.rot);
        try writer.writeAll(",\"scale\":");
        try writeVec3(writer, bone.transform.scale);
        try writer.writeByte('}');
        if (bone.tip) |tip| {
            try writer.writeAll(",\"tip\":");
            try writeVec3(writer, tip);
        }
        if (bone.joint) |joint| {
            try writer.writeAll(",\"joint\":");
            try writeJoint(writer, joint);
        }
        try writer.writeByte('}');
    }
    try writer.writeAll("],\"static\":false,\"characterRig\":");
    try writeDescriptor(writer, session, state_value, shape_hash);
    try writer.writeByte('}');
}

fn writeVerifiedArtifact(
    allocator: std.mem.Allocator,
    io: std.Io,
    path: []const u8,
    bytes: []const u8,
    expected_hash: skin_binding.Hash,
) !void {
    const file = try std.Io.Dir.cwd().createFile(io, path, .{ .truncate = true });
    errdefer std.Io.Dir.cwd().deleteFile(io, path) catch {};
    defer file.close(io);
    try file.writeStreamingAll(io, bytes);
    file.sync(io) catch return error.ArtifactSyncFailed;
    const readback = try std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .limited(512 << 20));
    defer allocator.free(readback);
    if (!std.mem.eql(u8, bytes, readback)) return error.ArtifactReadbackMismatch;
    const actual_hash = skin_binding.artifactHash(readback);
    if (!std.mem.eql(u8, &actual_hash, &expected_hash)) return error.ArtifactHashMismatch;
}

fn preparedPath(
    allocator: std.mem.Allocator,
    session: *const Session,
    io: std.Io,
    extension: []const u8,
) ![]u8 {
    const nonce = std.Io.Clock.now(.real, io).toNanoseconds();
    return std.fmt.allocPrint(allocator, "/tmp/reactjit-{s}-{d}-{d}.{s}", .{
        session.id(), session.revision, nonce, extension,
    });
}

fn prepareSaveReply(
    allocator: std.mem.Allocator,
    session: *Session,
    resident: ?*const ResidentContext,
) ![]u8 {
    const context = resident orelse return error.ResidentTopologyUnavailable;
    var topology = try openResidentTopology(session, resident);
    defer topology.deinit();
    var bones_buffer: [MAX_BONES]model.Bone = undefined;
    const bones = borrowedBones(session, &bones_buffer);
    var object_buffer: [MAX_OBJECT_BINDINGS]model.CharacterObjectBinding = undefined;
    const objects = borrowedObjectBindings(session, &object_buffer);
    const current = try topology.computeHashes(bones, objects);
    const weights_current = weightsMatchHashes(session, current);
    const save_state: model.CharacterRigState = if (weights_current) .bound else if (session.state == .draft) .draft else .needs_bind;
    const topology_hex = character_hashes.hex(current.topology);
    const semantic_hex = character_hashes.hex(current.semantic);
    const skeleton_hex = character_hashes.hex(current.skeleton);
    const object_hex = character_hashes.hex(current.object_binding);

    const geometry_bytes = try meshdoc.encodeSnapshotWithRangeObjectIdsAlloc(
        allocator,
        context.snapshot,
        context.ranges,
        session.range_object_ids[0..session.range_object_count],
    );
    defer allocator.free(geometry_bytes);
    const geometry_hash = skin_binding.artifactHash(geometry_bytes);
    const geometry_hex = character_hashes.hex(geometry_hash);
    const geometry_path = try preparedPath(allocator, session, context.io, "rjmd");
    defer allocator.free(geometry_path);
    try writeVerifiedArtifact(allocator, context.io, geometry_path, geometry_bytes, geometry_hash);
    errdefer std.Io.Dir.cwd().deleteFile(context.io, geometry_path) catch {};

    var skin_bytes: ?[]u8 = null;
    defer if (skin_bytes) |bytes| allocator.free(bytes);
    var skin_hash: ?skin_binding.Hash = null;
    var skin_path: ?[]u8 = null;
    defer if (skin_path) |path| allocator.free(path);
    if (weights_current) {
        const weights = session.weights.?.rows;
        const indices = try allocator.alloc(skin_binding.BoneIndices, weights.len);
        defer allocator.free(indices);
        const values = try allocator.alloc(skin_binding.Weights, weights.len);
        defer allocator.free(values);
        for (weights, indices, values) |row, *index_row, *weight_row| {
            index_row.* = row.bone_indices;
            weight_row.* = row.weights;
        }
        var palette_ids_buffer: [MAX_BONES][]const u8 = undefined;
        skin_bytes = try skin_binding.encodeAlloc(allocator, .{
            .logical_vertex_count = @intCast(weights.len),
            .bone_ids = session.boneIds(&palette_ids_buffer),
            .hashes = .{
                .topology = current.topology,
                .semantic = current.semantic,
                .skeleton = current.skeleton,
                .object_binding = current.object_binding,
            },
            .bone_indices = indices,
            .weights = values,
        });
        skin_hash = skin_binding.artifactHash(skin_bytes.?);
        skin_path = try preparedPath(allocator, session, context.io, "rjsk");
        try writeVerifiedArtifact(allocator, context.io, skin_path.?, skin_bytes.?, skin_hash.?);
        errdefer std.Io.Dir.cwd().deleteFile(context.io, skin_path.?) catch {};
    }

    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"value\":{\"sessionId\":");
    try writeJsonString(&output.writer, session.id());
    try output.writer.print(",\"revision\":{d},\"logicalVertexCount\":{d},\"topologyHash\":", .{
        session.revision, context.snapshot.logical_vertex_count,
    });
    try writeJsonString(&output.writer, &topology_hex);
    try output.writer.writeAll(",\"semanticHash\":");
    try writeJsonString(&output.writer, &semantic_hex);
    try output.writer.writeAll(",\"skeletonHash\":");
    try writeJsonString(&output.writer, &skeleton_hex);
    try output.writer.writeAll(",\"objectBindingHash\":");
    try writeJsonString(&output.writer, &object_hex);
    try output.writer.writeAll(",\"geometry\":{\"temporaryPath\":");
    try writeJsonString(&output.writer, geometry_path);
    try output.writer.writeAll(",\"artifactHash\":");
    try writeJsonString(&output.writer, &geometry_hex);
    try output.writer.print(",\"byteLength\":{d}}}", .{geometry_bytes.len});
    if (skin_bytes) |bytes| {
        const hash_hex = character_hashes.hex(skin_hash.?);
        try output.writer.writeAll(",\"skin\":{\"temporaryPath\":");
        try writeJsonString(&output.writer, skin_path.?);
        try output.writer.writeAll(",\"artifactHash\":");
        try writeJsonString(&output.writer, &hash_hex);
        try output.writer.print(",\"byteLength\":{d},\"binding\":{{\"path\":", .{bytes.len});
        try writeJsonString(&output.writer, skin_path.?);
        try output.writer.writeAll(",\"format\":\"RJSK\",\"version\":1,\"artifactHash\":");
        try writeJsonString(&output.writer, &hash_hex);
        try output.writer.writeAll(",\"topologyHash\":");
        try writeJsonString(&output.writer, &topology_hex);
        try output.writer.writeAll(",\"semanticHash\":");
        try writeJsonString(&output.writer, &semantic_hex);
        try output.writer.writeAll(",\"skeletonHash\":");
        try writeJsonString(&output.writer, &skeleton_hex);
        try output.writer.writeAll(",\"objectBindingHash\":");
        try writeJsonString(&output.writer, &object_hex);
        try output.writer.print(",\"logicalVertexCount\":{d},\"maxInfluences\":4}}}}", .{session.weights.?.rows.len});
    }
    try output.writer.writeAll(",\"skeleton\":");
    // `shapeHash` is the geometry shape last accepted by Fit Skeleton, not the
    // bytes merely being saved now. Position-only sculpting keeps valid weights
    // but must cold-reopen with fit review still visible until an explicit refit.
    try writeSkeleton(&output.writer, session, save_state, session.shape_hash);
    try output.writer.writeAll(",\"descriptor\":");
    try writeDescriptor(&output.writer, session, save_state, session.shape_hash);
    try output.writer.writeAll("}}");
    return allocator.dupe(u8, output.written());
}

fn handlePrepareSave(
    allocator: std.mem.Allocator,
    request: std.json.ObjectMap,
    resident: ?*const ResidentContext,
) ![]u8 {
    const session = requireSession(request, true) catch |err| {
        return operationErrorReply(allocator, "character rig save rejected", err);
    };
    return prepareSaveReply(allocator, session, resident) catch |err| {
        return operationErrorReply(allocator, "character rig save rejected", err);
    };
}

fn handleCommitSave(
    allocator: std.mem.Allocator,
    request: std.json.ObjectMap,
    resident: ?*const ResidentContext,
) ![]u8 {
    const session = requireSession(request, true) catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    const payload = object(required(request, "payload") catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    }) catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    const binding_value = required(payload, "binding") catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    if (binding_value == .null) {
        session.has_saved_binding = false;
        session.saved_binding = null;
        return snapshotReply(allocator, session, resident);
    }
    const binding = parseBindingRef(binding_value) catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    var topology = openResidentTopology(session, resident) catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    defer topology.deinit();
    var bones_buffer: [MAX_BONES]model.Bone = undefined;
    const bones = borrowedBones(session, &bones_buffer);
    var object_buffer: [MAX_OBJECT_BINDINGS]model.CharacterObjectBinding = undefined;
    const objects = borrowedObjectBindings(session, &object_buffer);
    const current = topology.computeHashes(bones, objects) catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    if (!weightsMatchHashes(session, current) or binding.logical_vertex_count != topology.positions.len or
        binding.max_influences != 4 or binding.version != 1)
    {
        return errorReply(allocator, "character rig save acknowledgement rejected: resident binding changed before manifest cutover", session.revision);
    }
    const declared_topology = character_hashes.parseHex(binding.topology_hash) catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    const declared_semantic = character_hashes.parseHex(binding.semantic_hash) catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    const declared_skeleton = character_hashes.parseHex(binding.skeleton_hash) catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    const declared_objects = character_hashes.parseHex(binding.object_binding_hash) catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    if (!std.mem.eql(u8, &declared_topology, &current.topology) or
        !std.mem.eql(u8, &declared_semantic, &current.semantic) or
        !std.mem.eql(u8, &declared_skeleton, &current.skeleton) or
        !std.mem.eql(u8, &declared_objects, &current.object_binding))
    {
        return errorReply(allocator, "character rig save acknowledgement rejected: saved hashes do not match the resident binding", session.revision);
    }
    session.saved_binding = ownSkinBinding(session.arena.allocator(), binding) catch |err| {
        return operationErrorReply(allocator, "character rig save acknowledgement rejected", err);
    };
    session.has_saved_binding = true;
    session.weights_stale = false;
    session.state = .bound;
    return snapshotReply(allocator, session, resident);
}

fn handleClose(
    allocator: std.mem.Allocator,
    request: std.json.ObjectMap,
    resident: ?*const ResidentContext,
) ![]u8 {
    _ = requireSession(request, false) catch |err| {
        return operationErrorReply(allocator, "character rig close rejected", err);
    };
    const reply = try nullReply(allocator);
    if (resident) |context| if (context.clear_rig_viewport) |clear| clear();
    clearHistory();
    g_session.?.deinit();
    g_session = null;
    return reply;
}

/// Process one camelCase `CharacterRigSessionRequest`. Every protocol failure is
/// returned as JSON; allocation failure is the only escaping error.
pub fn handleResident(
    allocator: std.mem.Allocator,
    request_json: []const u8,
    resident: ?*const ResidentContext,
) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, request_json, .{}) catch |err| {
        return operationErrorReply(allocator, "invalid character rig request JSON", err);
    };
    defer parsed.deinit();
    const request = object(parsed.value) catch |err| {
        return operationErrorReply(allocator, "invalid character rig request", err);
    };
    const op = requiredString(request, "op") catch |err| {
        return operationErrorReply(allocator, "invalid character rig request", err);
    };
    if (std.mem.eql(u8, op, "preflightAttach")) return handleAttachPreflight(allocator, request, resident);
    if (std.mem.eql(u8, op, "open")) {
        const payload = required(request, "payload") catch |err| {
            return operationErrorReply(allocator, "invalid character rig open request", err);
        };
        return handleOpen(allocator, payload, resident);
    }
    if (std.mem.eql(u8, op, "command")) return handleCommand(allocator, request, resident);
    if (std.mem.eql(u8, op, "snapshot")) return handleSnapshot(allocator, request, resident);
    if (std.mem.eql(u8, op, "inspect")) return handleInspect(allocator, request, resident);
    if (std.mem.eql(u8, op, "prepareSave")) return handlePrepareSave(allocator, request, resident);
    if (std.mem.eql(u8, op, "commitSave")) return handleCommitSave(allocator, request, resident);
    if (std.mem.eql(u8, op, "close")) return handleClose(allocator, request, resident);
    return errorReply(allocator, "unknown character rig session operation", if (g_session) |*session| session.revision else null);
}

/// Context-free protocol entry retained for focused parser/revision tests. Any
/// geometry-dependent command fails closed rather than inventing a topology.
pub fn handle(allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    return handleResident(allocator, request_json, null);
}

/// Validate the complete open payload before the GPU owner promotes any
/// resident metadata. This shares the authoritative parser and skeleton
/// validator with handleOpen, so malformed/stale/rejected requests remain
/// read-only even though a valid open may need one-body range synthesis before
/// ResidentContext can satisfy the strict range/object count check.
pub fn preflightOpenRangeObjectCount(
    allocator: std.mem.Allocator,
    request_json: []const u8,
    resident_source_key: []const u8,
) ?usize {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, request_json, .{}) catch return null;
    defer parsed.deinit();
    const request = object(parsed.value) catch return null;
    const op = requiredString(request, "op") catch return null;
    if (!std.mem.eql(u8, op, "open")) return null;
    const payload = required(request, "payload") catch return null;
    var parsed_document = parseOpenPayload(allocator, payload) catch return null;
    defer parsed_document.deinit();
    if (!std.mem.eql(u8, parsed_document.open.model_source_key, resident_source_key)) return null;
    const verdict = bones_loader.validate(
        allocator,
        parsed_document.open.skeleton(),
        bones_loader.accept_all,
    ) catch return null;
    return switch (verdict) {
        .ok => blk: {
            var candidate = ownSession(allocator, &parsed_document.open) catch return null;
            defer candidate.deinit();
            if (!std.mem.eql(u8, candidate.model_source_key, resident_source_key)) return null;
            break :blk candidate.range_object_count;
        },
        .reject => null,
    };
}
