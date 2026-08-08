//! Two-process Lore durability proof. The build target runs this executable as
//! `capture` and then starts a fresh process as `browse`; no working spool is
//! required by the second process.

const std = @import("std");
const snapshot = @import("vcs/snapshot.zig");
const meshdoc = @import("gpu/meshdoc_format.zig");
const event_bus = @import("diag/event_bus.zig");

const model_id = "__rjit_lore_cold_process_v1";
const label = "cold-process-capture-v1";

const SnapshotReply = struct {
    ok: bool,
    revision: []const u8,
    sha256: []const u8,
};

const HistoryEntry = struct {
    revision: []const u8,
    label: []const u8,
    sha256: []const u8,
};

const HistoryReply = struct {
    state: []const u8,
    entries: []const HistoryEntry,
};

const PreviewReply = struct {
    ok: bool,
    path: []const u8,
    sha256: []const u8,
};

const CaptureToken = struct {
    version: u32 = 1,
    revision: []const u8,
    sha256: []const u8,
};

fn fixture() meshdoc.Snapshot {
    const Data = struct {
        var verts = [_]f32{
            0, 0, 0, 0, 0, 1, 0, 0,
            4, 0, 0, 0, 0, 1, 1, 0,
            0, 5, 0, 0, 0, 1, 0, 1,
        };
        var groups = [_]u32{12};
    };
    return .{
        .verts = &Data.verts,
        .groups = &Data.groups,
        .materials = null,
        .semantic_regions = null,
        .semantic_instances = null,
        .render_corner_logical_ids = null,
        .logical_vertex_count = 0,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = null,
        .glass_first_vertex = 3,
    };
}

fn writeCaptureToken(
    io: std.Io,
    allocator: std.mem.Allocator,
    path: []const u8,
    revision: []const u8,
    sha256: []const u8,
) !void {
    const bytes = try std.json.Stringify.valueAlloc(allocator, CaptureToken{
        .revision = revision,
        .sha256 = sha256,
    }, .{});
    defer allocator.free(bytes);
    var file = try std.Io.Dir.cwd().createFile(io, path, .{
        .exclusive = true,
        .permissions = std.Io.File.Permissions.fromMode(0o600),
    });
    defer file.close(io);
    try file.setPermissions(io, std.Io.File.Permissions.fromMode(0o600));
    try file.writeStreamingAll(io, bytes);
    try file.sync(io);
}

fn capture(io: std.Io, allocator: std.mem.Allocator, token_path: []const u8) !void {
    var document = fixture();
    const ranges = [_]u32{ 12, 13 };
    const request = try std.json.Stringify.valueAlloc(allocator, .{
        .modelId = model_id,
        .label = label,
        .note = "must be browsable by a new process",
        .kind = "panic",
        .push = false,
    }, .{});
    defer allocator.free(request);
    const response = try snapshot.snapshotJson(io, allocator, &document, &ranges, request);
    defer allocator.free(response);
    var parsed = try std.json.parseFromSlice(SnapshotReply, allocator, response, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();
    if (!parsed.value.ok or parsed.value.revision.len != 64 or parsed.value.sha256.len != 64) {
        return error.ColdCaptureInvalid;
    }
    try writeCaptureToken(io, allocator, token_path, parsed.value.revision, parsed.value.sha256);
    std.debug.print("cold-capture revision={s} sha={s}\n", .{ parsed.value.revision, parsed.value.sha256 });
}

fn browse(io: std.Io, allocator: std.mem.Allocator, token_path: []const u8) !void {
    const token_stat = try std.Io.Dir.cwd().statFile(io, token_path, .{});
    if (token_stat.permissions.toMode() & 0o077 != 0) return error.InsecureColdCaptureToken;
    const token_bytes = try std.Io.Dir.cwd().readFileAlloc(io, token_path, allocator, .limited(4096));
    defer allocator.free(token_bytes);
    var token = try std.json.parseFromSlice(CaptureToken, allocator, token_bytes, .{});
    defer token.deinit();
    if (token.value.version != 1 or token.value.revision.len != 64 or token.value.sha256.len != 64) {
        return error.ColdCaptureTokenInvalid;
    }

    const history = try snapshot.historyJson(
        io,
        allocator,
        "{\"modelId\":\"__rjit_lore_cold_process_v1\",\"limit\":100}",
    );
    defer allocator.free(history);
    var parsed_history = try std.json.parseFromSlice(HistoryReply, allocator, history, .{ .ignore_unknown_fields = true });
    defer parsed_history.deinit();
    if (!std.mem.eql(u8, parsed_history.value.state, "ready")) return error.ColdHistoryMissing;
    const entry = for (parsed_history.value.entries) |candidate| {
        if (std.mem.eql(u8, candidate.revision, token.value.revision)) break candidate;
    } else return error.ColdRevisionMissing;
    if (!std.mem.eql(u8, entry.label, label) or !std.mem.eql(u8, entry.sha256, token.value.sha256)) {
        return error.ColdHistoryTokenMismatch;
    }

    const request = try std.json.Stringify.valueAlloc(allocator, .{
        .modelId = model_id,
        .revision = token.value.revision,
    }, .{});
    defer allocator.free(request);
    const response = try snapshot.previewJson(io, allocator, request);
    defer allocator.free(response);
    var preview = try std.json.parseFromSlice(PreviewReply, allocator, response, .{ .ignore_unknown_fields = true });
    defer preview.deinit();
    if (!preview.value.ok or
        !std.mem.eql(u8, preview.value.sha256, token.value.sha256) or
        !std.mem.eql(u8, preview.value.sha256, entry.sha256))
    {
        return error.ColdPreviewMismatch;
    }
    const bytes = try std.Io.Dir.cwd().readFileAlloc(io, preview.value.path, allocator, .unlimited);
    defer allocator.free(bytes);
    var expected_document = fixture();
    const expected = try meshdoc.encodeCurrentSnapshotAlloc(allocator, &expected_document, &.{ 12, 13 });
    defer allocator.free(expected);
    if (!std.mem.eql(u8, bytes, expected)) return error.ColdPreviewBytesMismatch;
    std.debug.print("cold-browse revision={s} sha={s}\n", .{ entry.revision, entry.sha256 });
}

pub fn main(init: std.process.Init) !void {
    defer event_bus.deinit();
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 3) return error.ExpectedCaptureOrBrowseAndTokenPath;
    if (std.mem.eql(u8, args[1], "capture")) return capture(init.io, init.gpa, args[2]);
    if (std.mem.eql(u8, args[1], "browse")) return browse(init.io, init.gpa, args[2]);
    return error.ExpectedCaptureOrBrowse;
}
