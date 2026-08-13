//! Focused native boundary tests for resident Lore recovery snapshots.

const std = @import("std");
const lore = @import("../../vcs/lore.zig");
const snapshot = @import("../../vcs/snapshot.zig");
const meshdoc_format = @import("../../gpu/meshdoc_format.zig");

test "process-wide Lore call gate serializes concurrent native workers" {
    const Probe = struct {
        first_entered: std.Io.Event = .unset,
        second_attempting: std.Io.Event = .unset,
        release_first: std.Io.Event = .unset,
        second_entered: std.atomic.Value(bool) = .init(false),
        active: std.atomic.Value(u32) = .init(0),
        overlap: std.atomic.Value(bool) = .init(false),
    };
    const Worker = struct {
        probe: *Probe,
        id: u8,

        fn enter(raw: ?*anyopaque) void {
            const self: *@This() = @ptrCast(@alignCast(raw orelse unreachable));
            const active = self.probe.active.fetchAdd(1, .acq_rel) + 1;
            if (active > 1) self.probe.overlap.store(true, .release);
            defer _ = self.probe.active.fetchSub(1, .acq_rel);
            if (self.id == 1) {
                self.probe.first_entered.set(std.testing.io);
                self.probe.release_first.waitUncancelable(std.testing.io);
            } else {
                self.probe.second_entered.store(true, .release);
            }
        }

        fn run(self: *@This()) void {
            if (self.id == 2) self.probe.second_attempting.set(std.testing.io);
            lore.withCallGateForTesting(self, enter);
        }
    };

    var probe = Probe{};
    var first = Worker{ .probe = &probe, .id = 1 };
    var second = Worker{ .probe = &probe, .id = 2 };
    var group: std.Io.Group = .init;
    try group.concurrent(std.testing.io, Worker.run, .{&first});
    probe.first_entered.waitUncancelable(std.testing.io);
    try group.concurrent(std.testing.io, Worker.run, .{&second});
    probe.second_attempting.waitUncancelable(std.testing.io);

    try std.testing.expect(!probe.second_entered.load(.acquire));
    try std.testing.expect(!probe.overlap.load(.acquire));
    probe.release_first.set(std.testing.io);
    try group.await(std.testing.io);
    try std.testing.expect(probe.second_entered.load(.acquire));
    try std.testing.expect(!probe.overlap.load(.acquire));
    try std.testing.expectEqual(@as(u32, 0), probe.active.load(.acquire));
}

test "a declared interactive budget turns a held gate into LoreGateBusy naming the holder" {
    const Probe = struct {
        holder_entered: std.Io.Event = .unset,
        release_holder: std.Io.Event = .unset,
    };
    const Holder = struct {
        probe: *Probe,

        fn enter(raw: ?*anyopaque) void {
            const self: *@This() = @ptrCast(@alignCast(raw orelse unreachable));
            self.probe.holder_entered.set(std.testing.io);
            self.probe.release_holder.waitUncancelable(std.testing.io);
        }

        fn run(self: *@This()) void {
            lore.withCallGateForTesting(self, enter);
        }
    };

    var probe = Probe{};
    var holder = Holder{ .probe = &probe };
    var group: std.Io.Group = .init;
    try group.concurrent(std.testing.io, Holder.run, .{&holder});
    probe.holder_entered.waitUncancelable(std.testing.io);

    // Bounded caller: refused within its budget, with the holder identified.
    lore.beginInteractiveGateBudget(30);
    try std.testing.expectError(error.LoreGateBusy, lore.acquireGateRespectingBudgetForTesting());
    const view = lore.gateHolderView() orelse return error.TestExpectedGateHolder;
    try std.testing.expect(std.mem.eql(u8, view.verb, "test_gate"));
    try std.testing.expect(view.held_ms >= 0);
    lore.endInteractiveGateBudget();

    probe.release_holder.set(std.testing.io);
    try group.await(std.testing.io);

    // Free gate: the same caller succeeds with or without a budget, and no
    // holder remains stamped after release.
    try lore.acquireGateRespectingBudgetForTesting();
    lore.beginInteractiveGateBudget(30);
    defer lore.endInteractiveGateBudget();
    try lore.acquireGateRespectingBudgetForTesting();
    try std.testing.expect(lore.gateHolderView() == null);
}

test "all six native door bodies compile without mutating on incomplete requests" {
    const allocator = std.testing.allocator;
    var verts = [_]f32{0} ** 24;
    const document = meshdoc_format.Snapshot{
        .verts = &verts,
        .groups = null,
        .materials = null,
        .semantic_regions = null,
        .semantic_instances = null,
        .render_corner_logical_ids = null,
        .logical_vertex_count = 0,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = null,
        .glass_first_vertex = 3,
    };

    if (snapshot.snapshotJson(std.testing.io, allocator, &document, null, "{}")) |json| allocator.free(json) else |_| {}
    if (snapshot.historyJson(std.testing.io, allocator, "{}")) |json| allocator.free(json) else |_| {}
    if (snapshot.previewJson(std.testing.io, allocator, "{}")) |json| allocator.free(json) else |_| {}
    if (snapshot.restoreJson(std.testing.io, allocator, "{}")) |json| allocator.free(json) else |_| {}
    if (snapshot.pinJson(std.testing.io, allocator, "{}")) |json| allocator.free(json) else |_| {}
    const status = try snapshot.serverStatusJson(std.testing.io, allocator, "{}");
    defer allocator.free(status);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"available\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"unitActive\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"recentJournal\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"restoreCommands\"") != null);
}

test "snapshot IDs carry sortable timestamp identity" {
    const older = "1700000000000-00000000000000000000000000000001";
    const newer = "1700000000001-00000000000000000000000000000000";
    try std.testing.expect(snapshot.validSnapshotId(older));
    try std.testing.expect(snapshot.validSnapshotId(newer));
    try std.testing.expectEqual(@as(i64, 1_700_000_000_000), try snapshot.snapshotIdTimestampMs(older));
    try std.testing.expect(std.mem.lessThan(u8, older, newer));
    try std.testing.expect(!snapshot.validSnapshotId("1700000000000-nope"));
}

test "hard retention ceiling starts at exactly sixty days" {
    const day_ms: i64 = 24 * 60 * 60 * 1000;
    const timestamp_ms: i64 = 1_700_000_000_000;
    const expiry_ms = try snapshot.snapshotExpiresAtMs(timestamp_ms);
    try std.testing.expectEqual(timestamp_ms + 60 * day_ms, expiry_ms);
    try std.testing.expect(!(try snapshot.snapshotIsExpired(timestamp_ms, timestamp_ms + 59 * day_ms)));
    try std.testing.expect(!(try snapshot.snapshotIsExpired(timestamp_ms, expiry_ms - 1)));
    try std.testing.expect(try snapshot.snapshotIsExpired(timestamp_ms, expiry_ms));
    try std.testing.expect(try snapshot.snapshotIsExpired(timestamp_ms, timestamp_ms + 61 * day_ms));
    try std.testing.expectError(error.InvalidSnapshotTimestamp, snapshot.snapshotExpiresAtMs(-1));
    try std.testing.expectError(error.SnapshotTimestampOverflow, snapshot.snapshotExpiresAtMs(std.math.maxInt(i64)));
}

test "retention plan keeps active pins and expires pinned old snapshots" {
    const day_ms: i64 = 24 * 60 * 60 * 1000;
    const now_ms: i64 = 1_800_000_000_000;
    const active_pinned = "1794902400000-00000000000000000000000000000001";
    const active_plain = "1794902400001-00000000000000000000000000000002";
    const expired_pinned = "1794816000000-00000000000000000000000000000003";
    const entries = [_]snapshot.RetentionEntry{
        .{ .snapshot_id = active_pinned, .timestamp_ms = now_ms - 59 * day_ms, .pinned = true },
        .{ .snapshot_id = active_plain, .timestamp_ms = now_ms - 59 * day_ms + 1, .pinned = false },
        .{ .snapshot_id = expired_pinned, .timestamp_ms = now_ms - 60 * day_ms, .pinned = true },
    };
    var plan = try snapshot.retentionPlanAlloc(std.testing.allocator, &entries, now_ms);
    defer plan.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 1), plan.expired_snapshot_ids.len);
    try std.testing.expectEqualStrings(expired_pinned, plan.expired_snapshot_ids[0]);
    try std.testing.expectEqual(@as(usize, 1), plan.retained_pin_ids.len);
    try std.testing.expectEqualStrings(active_pinned, plan.retained_pin_ids[0]);
}

test "public panic request binds model token and exact generation" {
    const allocator = std.testing.allocator;
    const model_id = "import:compact_car_001";
    const token = snapshot.modelDocumentToken(model_id);
    const request_json = try std.fmt.allocPrint(
        allocator,
        "{{\"version\":1,\"modelId\":\"{s}\",\"sessionToken\":\"{d}\",\"expectedGeneration\":7,\"kind\":\"panic\",\"label\":\"Manual recovery snapshot\",\"push\":false}}",
        .{ model_id, token },
    );
    defer allocator.free(request_json);
    var parsed = try snapshot.parsePanicSnapshotRequestV1(allocator, request_json);
    defer parsed.deinit();
    try snapshot.validatePanicSession(&parsed.value, token, 7);
    try std.testing.expectError(error.WrongModel, snapshot.validatePanicSession(&parsed.value, token + 1, 7));
    try std.testing.expectError(error.StaleGeneration, snapshot.validatePanicSession(&parsed.value, token, 8));
}

test "public panic request rejects legacy and forged fields" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidRequest, snapshot.parsePanicSnapshotRequestV1(
        allocator,
        "{\"modelId\":\"m\",\"kind\":\"panic\"}",
    ));
    try std.testing.expectError(error.InvalidRequest, snapshot.parsePanicSnapshotRequestV1(
        allocator,
        "{\"version\":1,\"modelId\":\"m\",\"sessionToken\":\"1\",\"expectedGeneration\":1,\"kind\":\"panic\",\"label\":\"x\",\"push\":false,\"packageGeometryPath\":\"stale.rjmd\"}",
    ));
    try std.testing.expectError(error.InvalidRequest, snapshot.parsePanicSnapshotRequestV1(
        allocator,
        "{\"version\":1,\"modelId\":\"m\",\"sessionToken\":\"1\",\"expectedGeneration\":1,\"kind\":\"normal\",\"label\":\"forged\",\"push\":false,\"saveReceiptToken\":\"save-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}",
    ));
}

test "verified ordinary Save accepts exact current bytes without reencoding" {
    const allocator = std.testing.allocator;
    var verts = [_]f32{0} ** 24;
    const groups = [_]u32{0};
    const ranges = [_]u32{ 0, 1 };
    const object_ids = [_][]const u8{"body"};
    const document = meshdoc_format.Snapshot{
        .verts = &verts,
        .groups = @constCast(&groups),
        .materials = null,
        .semantic_regions = null,
        .semantic_instances = null,
        .render_corner_logical_ids = null,
        .logical_vertex_count = 0,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = null,
        .glass_first_vertex = 3,
    };
    const bytes = try meshdoc_format.encodeCurrentSnapshotWithRangeObjectIdsAlloc(
        allocator,
        &document,
        &ranges,
        &object_ids,
    );
    defer allocator.free(bytes);
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    const sha = std.fmt.bytesToHex(digest, .lower);
    var save = try snapshot.verifiedSaveFromBytesAlloc(
        allocator,
        "car",
        "cart/editor/data/models/props/car/mesh/doc.blob",
        bytes,
        &sha,
    );
    defer save.deinit(allocator);
    try std.testing.expectEqual(@as(u32, 5), save.format_version);
    try std.testing.expectEqualSlices(u8, bytes, save.bytes);

    var wrong_sha = sha;
    wrong_sha[0] = if (wrong_sha[0] == '0') '1' else '0';
    try std.testing.expectError(error.VerifiedSaveHashMismatch, snapshot.verifiedSaveFromBytesAlloc(
        allocator,
        "car",
        "cart/editor/data/models/props/car/mesh/doc.blob",
        bytes,
        &wrong_sha,
    ));
}

test "verified Save receipt is model-bound and consumed exactly once" {
    const allocator = std.testing.allocator;
    var registry = snapshot.VerifiedSaveReceiptRegistry.init(allocator);
    defer registry.deinit(std.testing.io);
    const sha = [_]u8{'a'} ** 64;
    const model_id = try allocator.dupe(u8, "car");
    errdefer allocator.free(model_id);
    const path = try allocator.dupe(u8, "cart/editor/data/models/props/car/mesh/doc.blob");
    errdefer allocator.free(path);
    const bytes = try allocator.dupe(u8, "exact-rjmd-bytes");
    errdefer allocator.free(bytes);
    const token = try registry.issueOwned(std.testing.io, .{
        .model_id = model_id,
        .package_geometry_path = path,
        .bytes = bytes,
        .sha256 = sha,
        .format_version = 5,
    });
    defer allocator.free(token);

    try std.testing.expectError(error.SaveReceiptWrongModel, registry.consume(std.testing.io, token, "truck"));
    var consumed = try registry.consume(std.testing.io, token, "car");
    defer consumed.deinit(allocator);
    try std.testing.expectEqualStrings("exact-rjmd-bytes", consumed.bytes);
    try std.testing.expectError(error.SaveReceiptNotFound, registry.consume(std.testing.io, token, "car"));
}

test "normal append parser accepts only one-use token shape and normal kind" {
    const allocator = std.testing.allocator;
    const valid =
        "{\"version\":1,\"modelId\":\"car\",\"kind\":\"normal\",\"saveReceiptToken\":\"save-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"label\":\"Save\",\"push\":true}";
    var parsed = try snapshot.parseNormalSnapshotRequestV1(allocator, valid);
    parsed.deinit();
    try std.testing.expectError(error.InvalidRequest, snapshot.parseNormalSnapshotRequestV1(
        allocator,
        "{\"version\":1,\"modelId\":\"car\",\"kind\":\"normal\",\"saveReceiptToken\":\"save-v1-short\",\"label\":\"Save\",\"push\":true}",
    ));
    try std.testing.expectError(error.InvalidRequest, snapshot.parseNormalSnapshotRequestV1(
        allocator,
        "{\"version\":1,\"modelId\":\"car\",\"kind\":\"panic\",\"saveReceiptToken\":\"save-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"label\":\"Save\",\"push\":true}",
    ));
}

test "normal append consumes its receipt before artifact or repository work" {
    const allocator = std.testing.allocator;
    var registry = snapshot.VerifiedSaveReceiptRegistry.init(allocator);
    defer registry.deinit(std.testing.io);
    const invalid_bytes = "not-rjmd";
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(invalid_bytes, &digest, .{});
    const sha = std.fmt.bytesToHex(digest, .lower);
    const model_id = try allocator.dupe(u8, "car");
    errdefer allocator.free(model_id);
    const path = try allocator.dupe(u8, "cart/editor/data/models/props/car/mesh/doc.blob");
    errdefer allocator.free(path);
    const bytes = try allocator.dupe(u8, invalid_bytes);
    errdefer allocator.free(bytes);
    const token = try registry.issueOwned(std.testing.io, .{
        .model_id = model_id,
        .package_geometry_path = path,
        .bytes = bytes,
        .sha256 = sha,
        .format_version = 5,
    });
    defer allocator.free(token);
    const request = try std.fmt.allocPrint(
        allocator,
        "{{\"version\":1,\"modelId\":\"car\",\"kind\":\"normal\",\"saveReceiptToken\":\"{s}\",\"label\":\"Save\",\"push\":false}}",
        .{token},
    );
    defer allocator.free(request);
    try std.testing.expectError(
        error.InvalidVerifiedSaveArtifact,
        snapshot.normalSnapshotJson(std.testing.io, allocator, &registry, request),
    );
    try std.testing.expectError(
        error.SaveReceiptNotFound,
        snapshot.normalSnapshotJson(std.testing.io, allocator, &registry, request),
    );
}

test "strict v1 history rows never expose private package paths" {
    try std.testing.expect(!@hasField(snapshot.HistoryItemV1, "packageGeometryPath"));
}

test "public preview validates the capability protocol without leaking a path" {
    const allocator = std.testing.allocator;
    const preview = try snapshot.previewProtocolJson(std.testing.io, allocator, "{}");
    defer allocator.free(preview);
    try std.testing.expect(std.mem.indexOf(u8, preview, "\"ok\":false") != null);
    try std.testing.expect(std.mem.indexOf(u8, preview, "\"code\":\"invalid_request\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, preview, "\"path\"") == null);

    const restore = try snapshot.restoreProtocolJson(std.testing.io, allocator, "{}");
    defer allocator.free(restore);
    try std.testing.expect(std.mem.indexOf(u8, restore, "\"code\":\"legacy_restore_disabled\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, restore, "\"path\"") == null);
}

test "restore candidates require exact provenance and a recomputed namespace match" {
    const namespace = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    try snapshot.validateExactRestoreCandidateProvenance("exact", 0, namespace, namespace);
    try std.testing.expectError(
        error.DegradedRestoreCandidate,
        snapshot.validateExactRestoreCandidateProvenance("degraded", 0, namespace, namespace),
    );
    try std.testing.expectError(
        error.DegradedRestoreCandidate,
        snapshot.validateExactRestoreCandidateProvenance("exact", 1, namespace, namespace),
    );
    try std.testing.expectError(
        error.RestoreCandidateNamespaceMismatch,
        snapshot.validateExactRestoreCandidateProvenance(
            "exact",
            0,
            namespace,
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ),
    );
}

test "status receipt carries the strict v1 service and retention envelope" {
    const allocator = std.testing.allocator;
    const status = try snapshot.serverStatusJson(std.testing.io, allocator, "{\"version\":1}");
    defer allocator.free(status);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"version\":1") != null);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"retention\":{") != null);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"days\":60") != null);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"legacyLayoutCutover\":false") != null);
}

test "public history pin and status doors reject non-v1 requests with typed envelopes" {
    const allocator = std.testing.allocator;
    const history = try snapshot.historyProtocolJson(std.testing.io, allocator, "{}");
    defer allocator.free(history);
    try std.testing.expect(std.mem.indexOf(u8, history, "\"code\":\"invalid_request\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, history, "\"error\"") == null);

    const pin = try snapshot.pinProtocolJson(std.testing.io, allocator, "{}");
    defer allocator.free(pin);
    try std.testing.expect(std.mem.indexOf(u8, pin, "\"code\":\"invalid_request\"") != null);

    const status = try snapshot.serverStatusProtocolJson(std.testing.io, allocator, "{}");
    defer allocator.free(status);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"code\":\"invalid_request\"") != null);
}
