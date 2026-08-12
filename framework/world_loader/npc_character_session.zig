//! Mounted NPC character ownership through strict saved artifacts.
//!
//! One revisioned session owns every NPC CharacterAsset and its independent FK
//! source. The request contains explicit instance transforms; this module never
//! invents population positions, decodes retired segmented lumps, or invokes a
//! weight solver.

const std = @import("std");
const character_assets = @import("character_assets.zig");
const character_pose = @import("player_character_pose.zig");

/// gpu/3d owns eight concurrent palette slots. The mounted player reserves one;
/// capture's bind specimen is static stride-8 geometry and needs no palette.
pub const MAX_INSTANCES: usize = 7;
pub const MAX_ID_BYTES: usize = 64;

pub const Placement = struct {
    position: [3]f32,
    yaw_radians: f32,
};

const InstanceSpec = struct {
    instance_id: []const u8,
    geometry_path: []const u8,
    skin_path: []const u8,
    skeleton_json: []const u8,
    placement: Placement,
};

pub const Instance = struct {
    instance_id: []u8,
    geometry_key: []u8,
    asset: character_assets.CharacterAsset,
    pose: character_pose.State,
    placement: Placement,
    faulted: bool = false,

    fn deinit(self: *Instance, allocator: std.mem.Allocator) void {
        allocator.free(self.instance_id);
        allocator.free(self.geometry_key);
        self.asset.deinit();
        self.* = undefined;
    }
};

pub const Session = struct {
    active: bool = false,
    revision: u64 = 0,
    owner: character_pose.OwnerId = .{},
    instances: []Instance = &.{},

    pub fn deinit(self: *Session, allocator: std.mem.Allocator) void {
        self.releaseInstances(allocator);
        self.* = .{};
    }

    fn releaseInstances(self: *Session, allocator: std.mem.Allocator) void {
        for (self.instances) |*instance| instance.deinit(allocator);
        if (self.instances.len > 0) allocator.free(self.instances);
        self.instances = &.{};
    }

    fn requireOwnerRevision(self: *Session, owner_id: []const u8, expected_revision: u64) !void {
        if (!self.active or !self.owner.matches(owner_id)) return error.NpcSessionOwnerMismatch;
        if (expected_revision != self.revision) return error.StaleNpcSessionRevision;
    }

    pub fn open(
        self: *Session,
        io: std.Io,
        allocator: std.mem.Allocator,
        owner_id: []const u8,
        expected_revision: u64,
        payload: std.json.Value,
    ) !void {
        if (self.active) return error.NpcSessionAlreadyOpen;
        if (expected_revision != self.revision) return error.StaleNpcSessionRevision;
        var owner: character_pose.OwnerId = .{};
        try owner.set(owner_id);
        const next = try loadInstances(io, allocator, payload);
        self.owner = owner;
        self.instances = next;
        self.active = true;
        self.revision +%= 1;
    }

    pub fn replace(
        self: *Session,
        io: std.Io,
        allocator: std.mem.Allocator,
        owner_id: []const u8,
        expected_revision: u64,
        payload: std.json.Value,
    ) !void {
        try self.requireOwnerRevision(owner_id, expected_revision);
        const next = try loadInstances(io, allocator, payload);
        self.releaseInstances(allocator);
        self.instances = next;
        self.revision +%= 1;
    }

    pub fn close(self: *Session, allocator: std.mem.Allocator, owner_id: []const u8, expected_revision: u64) !void {
        try self.requireOwnerRevision(owner_id, expected_revision);
        self.releaseInstances(allocator);
        self.owner.clear();
        self.active = false;
        self.revision +%= 1;
    }

    /// NPCs currently use the canonical idle clip; each instance nevertheless
    /// owns an independent clock, local quaternion state, and GPU palette.
    pub fn advance(self: *Session, dt: f32) void {
        if (!self.active) return;
        for (self.instances) |*instance| {
            const sampled = instance.pose.advance(dt, .idle, null) catch |err| {
                if (!instance.faulted) std.log.err("NPC pose source failed for {s}: {s}", .{ instance.instance_id, @errorName(err) });
                instance.faulted = true;
                continue;
            };
            instance.asset.evaluate(sampled.root_translation, sampled.rotations()) catch |err| {
                if (!instance.faulted) std.log.err("NPC FK failed for {s}: {s}", .{ instance.instance_id, @errorName(err) });
                instance.faulted = true;
                continue;
            };
            instance.faulted = false;
        }
    }

    pub fn snapshotJsonAlloc(self: *const Session, allocator: std.mem.Allocator) ![]u8 {
        var output: std.Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try output.writer.print(
            "{{\"ok\":true,\"version\":1,\"active\":{},\"revision\":{d},\"instanceCount\":{d},\"instances\":[",
            .{ self.active, self.revision, self.instances.len },
        );
        for (self.instances, 0..) |instance, index| {
            if (index > 0) try output.writer.writeByte(',');
            try output.writer.print(
                "{{\"instanceId\":\"{s}\",\"boneCount\":{d},\"savedWeights\":true}}",
                .{ instance.instance_id, instance.asset.boneCount() },
            );
        }
        try output.writer.writeAll("]}");
        return allocator.dupe(u8, output.written());
    }
};

fn object(value: std.json.Value) !std.json.ObjectMap {
    return switch (value) {
        .object => |map| map,
        else => error.ExpectedNpcObject,
    };
}

fn array(value: std.json.Value) !std.json.Array {
    return switch (value) {
        .array => |items| items,
        else => error.ExpectedNpcArray,
    };
}

fn required(map: std.json.ObjectMap, key: []const u8) !std.json.Value {
    return map.get(key) orelse error.MissingNpcSessionField;
}

fn requiredString(map: std.json.ObjectMap, key: []const u8) ![]const u8 {
    return switch (try required(map, key)) {
        .string => |text| if (text.len > 0) text else error.EmptyNpcSessionField,
        else => error.ExpectedNpcString,
    };
}

fn unsigned(value: std.json.Value) !u64 {
    return switch (value) {
        .integer => |integer| if (integer >= 0) @intCast(integer) else error.ExpectedNpcUnsigned,
        else => error.ExpectedNpcUnsigned,
    };
}

fn number(value: std.json.Value) !f32 {
    const result: f32 = switch (value) {
        .integer => |integer| @floatFromInt(integer),
        .float => |float| @floatCast(float),
        else => return error.ExpectedNpcNumber,
    };
    if (!std.math.isFinite(result)) return error.NonFiniteNpcTransform;
    return result;
}

fn validId(value: []const u8) bool {
    if (value.len == 0 or value.len > MAX_ID_BYTES) return false;
    for (value) |byte| switch (byte) {
        'a'...'z', 'A'...'Z', '0'...'9', '-', '_', '.', ':' => {},
        else => return false,
    };
    return true;
}

fn parsePlacement(value: std.json.Value) !Placement {
    const map = try object(value);
    const position = (try array(try required(map, "position"))).items;
    if (position.len != 3) return error.InvalidNpcPosition;
    return .{
        .position = .{
            try number(position[0]),
            try number(position[1]),
            try number(position[2]),
        },
        .yaw_radians = try number(try required(map, "yawRadians")),
    };
}

fn parseSpecs(payload_value: std.json.Value, output: *[MAX_INSTANCES]InstanceSpec) ![]const InstanceSpec {
    const payload = try object(payload_value);
    if (try unsigned(try required(payload, "version")) != 1) return error.UnsupportedNpcSessionVersion;
    const items = (try array(try required(payload, "instances"))).items;
    if (items.len > MAX_INSTANCES) return error.TooManyNpcCharacters;
    for (items, 0..) |item, index| {
        const map = try object(item);
        const instance_id = try requiredString(map, "instanceId");
        if (!validId(instance_id)) return error.InvalidNpcInstanceId;
        for (output[0..index]) |prior| {
            if (std.mem.eql(u8, prior.instance_id, instance_id)) return error.DuplicateNpcInstanceId;
        }
        if (!std.mem.eql(u8, try requiredString(map, "role"), "npc")) return error.InvalidNpcCharacterRole;
        output[index] = .{
            .instance_id = instance_id,
            .geometry_path = try requiredString(map, "geometryPath"),
            .skin_path = try requiredString(map, "skinPath"),
            .skeleton_json = try requiredString(map, "skeletonJson"),
            .placement = try parsePlacement(try required(map, "transform")),
        };
    }
    return output[0..items.len];
}

fn loadInstances(io: std.Io, allocator: std.mem.Allocator, payload_value: std.json.Value) ![]Instance {
    var spec_buffer: [MAX_INSTANCES]InstanceSpec = undefined;
    const specs = try parseSpecs(payload_value, &spec_buffer);
    if (specs.len == 0) return &.{};
    const result = try allocator.alloc(Instance, specs.len);
    var initialized: usize = 0;
    errdefer {
        for (result[0..initialized]) |*instance| instance.deinit(allocator);
        allocator.free(result);
    }
    for (specs, 0..) |spec, index| {
        var asset = try character_assets.loadFiles(
            io,
            allocator,
            spec.geometry_path,
            spec.skin_path,
            spec.skeleton_json,
        );
        errdefer asset.deinit();
        var pose: character_pose.State = .{};
        try pose.resetRig(asset.rig_bones, asset.retargetBoneIds());
        const instance_id = try allocator.dupe(u8, spec.instance_id);
        errdefer allocator.free(instance_id);
        const hash_text = std.fmt.bytesToHex(asset.geometry_artifact_hash, .lower);
        const geometry_key = try std.fmt.allocPrint(allocator, "npc-character-{s}", .{hash_text});
        errdefer allocator.free(geometry_key);
        result[index] = .{
            .instance_id = instance_id,
            .geometry_key = geometry_key,
            .asset = asset,
            .pose = pose,
            .placement = spec.placement,
        };
        initialized += 1;
    }
    return result;
}

pub fn requestNodeId(allocator: std.mem.Allocator, request_json: []const u8) !u32 {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, request_json, .{});
    defer parsed.deinit();
    const map = try object(parsed.value);
    const raw = try unsigned(try required(map, "nodeId"));
    if (raw == 0 or raw > std.math.maxInt(u32)) return error.InvalidNpcViewportNode;
    return @intCast(raw);
}

pub fn dispatch(
    self: *Session,
    io: std.Io,
    allocator: std.mem.Allocator,
    expected_node_id: u32,
    request_json: []const u8,
) ![]u8 {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, request_json, .{});
    defer parsed.deinit();
    const request = try object(parsed.value);
    const raw_node_id = try unsigned(try required(request, "nodeId"));
    if (raw_node_id != expected_node_id) return error.NpcViewportNodeMismatch;
    const operation = try requiredString(request, "op");
    const owner_id = try requiredString(request, "sessionId");
    if (std.mem.eql(u8, operation, "snapshot")) {
        if (!self.active or !self.owner.matches(owner_id)) return error.NpcSessionOwnerMismatch;
        return self.snapshotJsonAlloc(allocator);
    }
    const expected_revision = try unsigned(try required(request, "expectedRevision"));
    if (std.mem.eql(u8, operation, "open")) {
        try self.open(io, allocator, owner_id, expected_revision, try required(request, "payload"));
    } else if (std.mem.eql(u8, operation, "replace")) {
        try self.replace(io, allocator, owner_id, expected_revision, try required(request, "payload"));
    } else if (std.mem.eql(u8, operation, "close")) {
        try self.close(allocator, owner_id, expected_revision);
    } else {
        return error.UnknownNpcSessionOperation;
    }
    return self.snapshotJsonAlloc(allocator);
}

test "NPC payload requires exact role, unique stable ids, and explicit finite transforms" {
    const testing = std.testing;
    const valid =
        \\{"version":1,"instances":[{"instanceId":"civilian:1","role":"npc","geometryPath":"character-a.rjmd","skinPath":"skin-a.rjsk","skeletonJson":"{}","transform":{"position":[1,2,3],"yawRadians":0.5}}]}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, testing.allocator, valid, .{});
    defer parsed.deinit();
    var specs: [MAX_INSTANCES]InstanceSpec = undefined;
    const rows = try parseSpecs(parsed.value, &specs);
    try testing.expectEqual(@as(usize, 1), rows.len);
    try testing.expectEqualStrings("civilian:1", rows[0].instance_id);
    try testing.expectApproxEqAbs(@as(f32, 0.5), rows[0].placement.yaw_radians, 0.00001);

    const wrong_role =
        \\{"version":1,"instances":[{"instanceId":"player:1","role":"player","geometryPath":"character-a.rjmd","skinPath":"skin-a.rjsk","skeletonJson":"{}","transform":{"position":[0,0,0],"yawRadians":0}}]}
    ;
    var wrong = try std.json.parseFromSlice(std.json.Value, testing.allocator, wrong_role, .{});
    defer wrong.deinit();
    try testing.expectError(error.InvalidNpcCharacterRole, parseSpecs(wrong.value, &specs));

    const duplicate =
        \\{"version":1,"instances":[{"instanceId":"same","role":"npc","geometryPath":"a","skinPath":"b","skeletonJson":"{}","transform":{"position":[0,0,0],"yawRadians":0}},{"instanceId":"same","role":"npc","geometryPath":"a","skinPath":"b","skeletonJson":"{}","transform":{"position":[0,0,0],"yawRadians":0}}]}
    ;
    var dup = try std.json.parseFromSlice(std.json.Value, testing.allocator, duplicate, .{});
    defer dup.deinit();
    try testing.expectError(error.DuplicateNpcInstanceId, parseSpecs(dup.value, &specs));
}

test "NPC request node identity is explicit" {
    const testing = std.testing;
    try testing.expectEqual(
        @as(u32, 42),
        try requestNodeId(testing.allocator, "{\"op\":\"snapshot\",\"nodeId\":42,\"sessionId\":\"test\"}"),
    );
    try testing.expectError(
        error.InvalidNpcViewportNode,
        requestNodeId(testing.allocator, "{\"op\":\"snapshot\",\"nodeId\":0,\"sessionId\":\"test\"}"),
    );
}

test "NPC session mutations require the exact owner and revision" {
    const testing = std.testing;
    var session: Session = .{ .active = true, .revision = 4 };
    try session.owner.set("playtest:npcs");
    try session.requireOwnerRevision("playtest:npcs", 4);
    try testing.expectError(error.NpcSessionOwnerMismatch, session.requireOwnerRevision("other:npcs", 4));
    try testing.expectError(error.StaleNpcSessionRevision, session.requireOwnerRevision("playtest:npcs", 3));
    try session.close(testing.allocator, "playtest:npcs", 4);
    try testing.expect(!session.active);
    try testing.expectEqual(@as(u64, 5), session.revision);
    try testing.expectError(error.NpcSessionOwnerMismatch, session.requireOwnerRevision("playtest:npcs", 5));
}
