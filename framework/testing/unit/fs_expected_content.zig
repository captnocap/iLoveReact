//! Unit coverage for the expected-content comparison used immediately before
//! an atomic source-file replacement. The contract distinguishes reviewed
//! absence from an empty file and accepts only byte-for-byte equality.

const std = @import("std");
const testing = std.testing;
const fs = @import("fs_core");

test "reviewed absence is distinct from an empty file" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    try testing.expect(try fs.contentMatches(testing.io, tmp.dir, "page.md", testing.allocator, null));
    try testing.expect(!(try fs.contentMatches(testing.io, tmp.dir, "page.md", testing.allocator, "")));

    try fs.writeText(testing.io, tmp.dir, "page.md", "");
    try testing.expect(!(try fs.contentMatches(testing.io, tmp.dir, "page.md", testing.allocator, null)));
    try testing.expect(try fs.contentMatches(testing.io, tmp.dir, "page.md", testing.allocator, ""));
}

test "expected content requires exact bytes and exact length" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    const reviewed = "reviewed\x00bytes";
    try fs.writeText(testing.io, tmp.dir, "page.md", reviewed);
    try testing.expect(try fs.contentMatches(testing.io, tmp.dir, "page.md", testing.allocator, reviewed));

    try fs.writeText(testing.io, tmp.dir, "page.md", "reviewed\x00bytex");
    try testing.expect(!(try fs.contentMatches(testing.io, tmp.dir, "page.md", testing.allocator, reviewed)));

    try fs.writeText(testing.io, tmp.dir, "page.md", "reviewed\x00bytes-more");
    try testing.expect(!(try fs.contentMatches(testing.io, tmp.dir, "page.md", testing.allocator, reviewed)));

    try fs.writeText(testing.io, tmp.dir, "page.md", "reviewed\x00byte");
    try testing.expect(!(try fs.contentMatches(testing.io, tmp.dir, "page.md", testing.allocator, reviewed)));
}

test "expected-content comparison preserves path confinement" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    try testing.expectError(
        error.PathNotConfined,
        fs.contentMatches(testing.io, tmp.dir, "../page.md", testing.allocator, null),
    );
    try testing.expectError(
        error.PathNotConfined,
        fs.contentMatches(testing.io, tmp.dir, "/page.md", testing.allocator, "reviewed"),
    );
}

test "containing directory can be synchronized after an atomic rename" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    try tmp.dir.createDir(testing.io, "nested", .default_dir);
    try fs.writeAtomic(testing.io, tmp.dir, "nested/page.md", "durable bytes");
    try fs.syncContainingDir(testing.io, tmp.dir, "nested/page.md");
    try testing.expectError(
        error.PathNotConfined,
        fs.syncContainingDir(testing.io, tmp.dir, "../outside.md"),
    );
}

test "durable directory creation covers every missing ancestor" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    try fs.makePathDurable(testing.io, tmp.dir, "first/second/third");
    var nested = try tmp.dir.openDir(testing.io, "first/second/third", .{});
    nested.close(testing.io);
    // Repeating the operation validates existing components as directories.
    try fs.makePathDurable(testing.io, tmp.dir, "first/second/third");
    try testing.expectError(
        error.PathNotConfined,
        fs.makePathDurable(testing.io, tmp.dir, "../outside"),
    );
}

test "durable file removal retires the named directory entry" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    try fs.writeText(testing.io, tmp.dir, "marker", "retire me");
    try fs.deleteFileDurable(testing.io, tmp.dir, "marker");
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, "marker"));
    try testing.expectError(
        error.PathNotConfined,
        fs.deleteFileDurable(testing.io, tmp.dir, "../marker"),
    );
}

test "conditional replacement gives one reviewed snapshot only one winner" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    try fs.writeText(testing.io, tmp.dir, "page.md", "reviewed");
    try fs.writeText(testing.io, tmp.dir, "first.tmp", "first proposal");
    try fs.writeText(testing.io, tmp.dir, "second.tmp", "second proposal");

    try testing.expectEqual(
        fs.ReplacePreparedResult.written,
        try fs.replacePreparedFileIfUnchanged(
            testing.io,
            tmp.dir,
            "page.md",
            "first.tmp",
            "first.previous",
            testing.allocator,
            "reviewed",
        ),
    );
    try testing.expectEqual(
        fs.ReplacePreparedResult.changed,
        try fs.replacePreparedFileIfUnchanged(
            testing.io,
            tmp.dir,
            "page.md",
            "second.tmp",
            "second.previous",
            testing.allocator,
            "reviewed",
        ),
    );

    const current = try tmp.dir.readFileAlloc(testing.io, "page.md", testing.allocator, .limited(64));
    defer testing.allocator.free(current);
    try testing.expectEqualStrings("first proposal", current);
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "second.tmp"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "first.previous"));
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, "second.previous"));
}

test "new-file replacement never overwrites a competing path" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    try fs.writeText(testing.io, tmp.dir, "first.tmp", "first proposal");
    try testing.expectEqual(
        fs.ReplacePreparedResult.written,
        try fs.replacePreparedFileIfUnchanged(
            testing.io,
            tmp.dir,
            "page.md",
            "first.tmp",
            "first.previous",
            testing.allocator,
            null,
        ),
    );
    try fs.writeText(testing.io, tmp.dir, "second.tmp", "second proposal");
    try testing.expectEqual(
        fs.ReplacePreparedResult.changed,
        try fs.replacePreparedFileIfUnchanged(
            testing.io,
            tmp.dir,
            "page.md",
            "second.tmp",
            "second.previous",
            testing.allocator,
            null,
        ),
    );
    const current = try tmp.dir.readFileAlloc(testing.io, "page.md", testing.allocator, .limited(64));
    defer testing.allocator.free(current);
    try testing.expectEqualStrings("first proposal", current);
}

test "a pre-open writer keeps a named inode after canonical replacement" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    try fs.writeText(testing.io, tmp.dir, "page.md", "reviewed");
    var external = try tmp.dir.openFile(testing.io, "page.md", .{ .mode = .read_write });
    defer external.close(testing.io);
    try fs.writeText(testing.io, tmp.dir, "proposal.tmp", "confirmed proposal");

    try testing.expectEqual(
        fs.ReplacePreparedResult.written,
        try fs.replacePreparedFileIfUnchanged(
            testing.io,
            tmp.dir,
            "page.md",
            "proposal.tmp",
            "claimed.previous",
            testing.allocator,
            "reviewed",
        ),
    );
    try external.writePositionalAll(testing.io, "external", 0);
    try external.sync(testing.io);

    const canonical = try tmp.dir.readFileAlloc(testing.io, "page.md", testing.allocator, .limited(64));
    defer testing.allocator.free(canonical);
    const displaced = try tmp.dir.readFileAlloc(testing.io, "claimed.previous", testing.allocator, .limited(64));
    defer testing.allocator.free(displaced);
    try testing.expectEqualStrings("confirmed proposal", canonical);
    try testing.expect(std.mem.startsWith(u8, displaced, "external"));
}

test "simultaneous reviewed writers produce exactly one winner" {
    const RaceContext = struct {
        io: std.Io,
        dir: std.Io.Dir,
        temp_path: []const u8,
        backup_path: []const u8,
        ready: *std.atomic.Value(u32),
        go: *std.atomic.Value(bool),
        result: ?fs.ReplacePreparedResult = null,
        failure: ?anyerror = null,

        fn run(context: *@This()) void {
            _ = context.ready.fetchAdd(1, .release);
            while (!context.go.load(.acquire)) std.Thread.yield() catch {};
            context.result = fs.replacePreparedFileIfUnchanged(
                context.io,
                context.dir,
                "page.md",
                context.temp_path,
                context.backup_path,
                std.heap.page_allocator,
                "reviewed",
            ) catch |err| {
                context.failure = err;
                return;
            };
        }
    };

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    try fs.writeText(testing.io, tmp.dir, "page.md", "reviewed");
    try fs.writeText(testing.io, tmp.dir, "first.tmp", "first proposal");
    try fs.writeText(testing.io, tmp.dir, "second.tmp", "second proposal");
    var ready: std.atomic.Value(u32) = .init(0);
    var go: std.atomic.Value(bool) = .init(false);
    var first: RaceContext = .{
        .io = testing.io,
        .dir = tmp.dir,
        .temp_path = "first.tmp",
        .backup_path = "first.previous",
        .ready = &ready,
        .go = &go,
    };
    var second: RaceContext = .{
        .io = testing.io,
        .dir = tmp.dir,
        .temp_path = "second.tmp",
        .backup_path = "second.previous",
        .ready = &ready,
        .go = &go,
    };
    const first_thread = try std.Thread.spawn(.{}, RaceContext.run, .{&first});
    const second_thread = try std.Thread.spawn(.{}, RaceContext.run, .{&second});
    while (ready.load(.acquire) != 2) std.Thread.yield() catch {};
    go.store(true, .release);
    first_thread.join();
    second_thread.join();

    try testing.expect(first.failure == null and second.failure == null);
    const winners: u8 = @intFromBool(first.result == .written) + @intFromBool(second.result == .written);
    const conflicts: u8 = @intFromBool(first.result == .changed) + @intFromBool(second.result == .changed);
    try testing.expectEqual(@as(u8, 1), winners);
    try testing.expectEqual(@as(u8, 1), conflicts);
}

test "absence reviewer cannot win through an existing writer claim gap" {
    const NullWriter = struct {
        io: std.Io,
        dir: std.Io.Dir,
        go: *std.atomic.Value(bool),
        started: *std.atomic.Value(bool),
        finished: *std.atomic.Value(bool),
        result: ?fs.ReplacePreparedResult = null,
        failure: ?anyerror = null,

        fn run(context: *@This()) void {
            while (!context.go.load(.acquire)) std.Thread.yield() catch {};
            context.started.store(true, .release);
            context.result = fs.replacePreparedFileIfUnchanged(
                context.io,
                context.dir,
                "page.md",
                "absence.tmp",
                "absence.previous",
                std.heap.page_allocator,
                null,
            ) catch |err| {
                context.failure = err;
                context.finished.store(true, .release);
                return;
            };
            context.finished.store(true, .release);
        }
    };

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    try fs.writeText(testing.io, tmp.dir, "page.md", "reviewed");
    try fs.writeText(testing.io, tmp.dir, "existing.tmp", "existing proposal");
    try fs.writeText(testing.io, tmp.dir, "absence.tmp", "absence proposal");

    var transaction_lock = try fs.acquireTargetWriteLock(testing.io, tmp.dir, "page.md");
    var lock_held = true;
    defer if (lock_held) transaction_lock.release();
    // Hold the exact existing-writer gap that previously exposed a false
    // absence to a null-expected writer.
    try std.Io.Dir.renamePreserve(tmp.dir, "page.md", tmp.dir, "existing.previous", testing.io);
    try fs.syncContainingDir(testing.io, tmp.dir, "existing.previous");

    var go: std.atomic.Value(bool) = .init(false);
    var started: std.atomic.Value(bool) = .init(false);
    var finished: std.atomic.Value(bool) = .init(false);
    var null_writer: NullWriter = .{
        .io = testing.io,
        .dir = tmp.dir,
        .go = &go,
        .started = &started,
        .finished = &finished,
    };
    const thread = try std.Thread.spawn(.{}, NullWriter.run, .{&null_writer});
    go.store(true, .release);
    while (!started.load(.acquire)) std.Thread.yield() catch {};
    var yields: usize = 0;
    while (yields < 10_000 and !finished.load(.acquire)) : (yields += 1) std.Thread.yield() catch {};
    try testing.expect(!finished.load(.acquire));

    try std.Io.Dir.renamePreserve(tmp.dir, "existing.tmp", tmp.dir, "page.md", testing.io);
    try fs.syncContainingDir(testing.io, tmp.dir, "page.md");
    transaction_lock.release();
    lock_held = false;
    thread.join();

    try testing.expect(null_writer.failure == null);
    try testing.expectEqual(fs.ReplacePreparedResult.changed, null_writer.result.?);
    const current = try tmp.dir.readFileAlloc(testing.io, "page.md", testing.allocator, .limited(64));
    defer testing.allocator.free(current);
    try testing.expectEqualStrings("existing proposal", current);
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "absence.tmp"));
}

test "absence reviewer cannot win after existing claim owner crashes" {
    const NullWriter = struct {
        io: std.Io,
        dir: std.Io.Dir,
        started: *std.atomic.Value(bool),
        result: ?fs.ReplacePreparedResult = null,
        failure: ?anyerror = null,

        fn run(context: *@This()) void {
            context.started.store(true, .release);
            context.result = fs.replacePreparedFileIfUnchanged(
                context.io,
                context.dir,
                "page.md",
                "absence.tmp",
                "absence.previous",
                std.heap.page_allocator,
                null,
            ) catch |err| {
                context.failure = err;
                return;
            };
        }
    };

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    try fs.writeText(testing.io, tmp.dir, "page.md", "reviewed");
    try fs.writeText(testing.io, tmp.dir, "absence.tmp", "absence proposal");

    var crashed_owner_lock = try fs.acquireTargetWriteLock(testing.io, tmp.dir, "page.md");
    try fs.writeAtomic(testing.io, tmp.dir, "page.md.write-pending", "pending\n");
    try std.Io.Dir.renamePreserve(tmp.dir, "page.md", tmp.dir, "crashed.previous", testing.io);
    try fs.syncContainingDir(testing.io, tmp.dir, "crashed.previous");

    var started: std.atomic.Value(bool) = .init(false);
    var null_writer: NullWriter = .{
        .io = testing.io,
        .dir = tmp.dir,
        .started = &started,
    };
    const thread = try std.Thread.spawn(.{}, NullWriter.run, .{&null_writer});
    while (!started.load(.acquire)) std.Thread.yield() catch {};
    // Simulate owner death: the OS releases its advisory lock, but no target
    // pathname was reinstalled. The durable pending marker must keep that
    // vacancy from becoming a successful expected-absence write.
    crashed_owner_lock.release();
    thread.join();

    try testing.expect(null_writer.failure == null);
    try testing.expectEqual(fs.ReplacePreparedResult.changed, null_writer.result.?);
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, "page.md"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md.write-pending"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "crashed.previous"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "absence.tmp"));
}

test "validated recovery installs under pending ownership then retires marker" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const owner_path = "page.md.tmp.123";
    try fs.writeAtomic(testing.io, tmp.dir, "page.md.write-pending", owner_path);
    try fs.writeText(testing.io, tmp.dir, owner_path, "reviewed proposal");
    try fs.writeText(testing.io, tmp.dir, "page.md.tmp.123.previous", "durable prior");
    try fs.writeText(testing.io, tmp.dir, "restore.tmp", "durable prior");

    try testing.expectEqual(
        fs.ReplacePreparedResult.written,
        try fs.replacePreparedFileIfUnchangedWithPolicy(
            testing.io,
            tmp.dir,
            "page.md",
            "restore.tmp",
            "restore.previous",
            testing.allocator,
            null,
            true,
            owner_path,
        ),
    );
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md.write-pending"));
    try testing.expectEqual(
        fs.FinalizePendingRecoveryResult.finalized,
        try fs.finalizePendingRecovery(
            testing.io,
            tmp.dir,
            "page.md",
            owner_path,
            testing.allocator,
            "durable prior",
            false,
        ),
    );
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, owner_path));
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, "page.md.write-pending"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md.tmp.123.previous"));
    const restored = try tmp.dir.readFileAlloc(testing.io, "page.md", testing.allocator, .limited(64));
    defer testing.allocator.free(restored);
    try testing.expectEqualStrings("durable prior", restored);
}

test "recovery cannot adopt a differently owned pending marker" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const stale_owner = "page.md.tmp.128";
    const current_owner = "page.md.tmp.129";
    try fs.writeAtomic(testing.io, tmp.dir, "page.md.write-pending", current_owner);
    try fs.writeText(testing.io, tmp.dir, stale_owner, "stale proposal");
    try fs.writeText(testing.io, tmp.dir, "page.md.tmp.128.previous", "stale prior");
    try fs.writeText(testing.io, tmp.dir, "restore.tmp", "stale prior");

    try testing.expectEqual(
        fs.ReplacePreparedResult.changed,
        try fs.replacePreparedFileIfUnchangedWithPolicy(
            testing.io,
            tmp.dir,
            "page.md",
            "restore.tmp",
            "restore.previous",
            testing.allocator,
            null,
            true,
            stale_owner,
        ),
    );
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, "page.md"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "restore.tmp"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, stale_owner));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md.tmp.128.previous"));
    const marker = try tmp.dir.readFileAlloc(testing.io, "page.md.write-pending", testing.allocator, .limited(64));
    defer testing.allocator.free(marker);
    try testing.expectEqualStrings(current_owner, marker);
}

test "transient recovery finalization retires its bounded predecessor and is idempotent" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const owner_path = "page.md.tmp.124";
    try fs.writeText(testing.io, tmp.dir, "page.md", "recovered");
    try fs.writeText(testing.io, tmp.dir, owner_path, "new envelope");
    try fs.writeText(testing.io, tmp.dir, "page.md.tmp.124.previous", "old envelope");
    try fs.writeAtomic(testing.io, tmp.dir, "page.md.write-pending", owner_path);

    try testing.expectEqual(
        fs.FinalizePendingRecoveryResult.finalized,
        try fs.finalizePendingRecovery(testing.io, tmp.dir, "page.md", owner_path, testing.allocator, "recovered", true),
    );
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, owner_path));
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, "page.md.tmp.124.previous"));
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, "page.md.write-pending"));
    try testing.expectEqual(
        fs.FinalizePendingRecoveryResult.finalized,
        try fs.finalizePendingRecovery(testing.io, tmp.dir, "page.md", owner_path, testing.allocator, "recovered", true),
    );
}

test "recovery finalization preserves every artifact on owner or content mismatch" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const owner_path = "page.md.tmp.125";
    const newer_owner = "page.md.tmp.126";
    try fs.writeText(testing.io, tmp.dir, "page.md", "current");
    try fs.writeText(testing.io, tmp.dir, owner_path, "proposal");
    try fs.writeText(testing.io, tmp.dir, "page.md.tmp.125.previous", "prior");
    try fs.writeAtomic(testing.io, tmp.dir, "page.md.write-pending", newer_owner);

    try testing.expectEqual(
        fs.FinalizePendingRecoveryResult.changed,
        try fs.finalizePendingRecovery(testing.io, tmp.dir, "page.md", owner_path, testing.allocator, "current", true),
    );
    try testing.expect(fs.pathExists(testing.io, tmp.dir, owner_path));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md.tmp.125.previous"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md.write-pending"));

    try fs.writeAtomic(testing.io, tmp.dir, "page.md.write-pending", owner_path);
    try testing.expectEqual(
        fs.FinalizePendingRecoveryResult.changed,
        try fs.finalizePendingRecovery(testing.io, tmp.dir, "page.md", owner_path, testing.allocator, "different", true),
    );
    try testing.expect(fs.pathExists(testing.io, tmp.dir, owner_path));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md.tmp.125.previous"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md.write-pending"));
}

test "finalizer cannot clear ownership while another recovery vacates the target" {
    const Finalizer = struct {
        io: std.Io,
        dir: std.Io.Dir,
        started: *std.atomic.Value(bool),
        finished: *std.atomic.Value(bool),
        result: ?fs.FinalizePendingRecoveryResult = null,
        failure: ?anyerror = null,

        fn run(context: *@This()) void {
            context.started.store(true, .release);
            context.result = fs.finalizePendingRecovery(
                context.io,
                context.dir,
                "page.md",
                "page.md.tmp.127",
                std.heap.page_allocator,
                "restored",
                false,
            ) catch |err| {
                context.failure = err;
                context.finished.store(true, .release);
                return;
            };
            context.finished.store(true, .release);
        }
    };

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    try fs.writeText(testing.io, tmp.dir, "page.md", "restored");
    try fs.writeText(testing.io, tmp.dir, "page.md.tmp.127", "proposal");
    try fs.writeText(testing.io, tmp.dir, "page.md.tmp.127.previous", "prior");
    try fs.writeAtomic(testing.io, tmp.dir, "page.md.write-pending", "page.md.tmp.127");
    try fs.writeText(testing.io, tmp.dir, "absence.tmp", "absence proposal");

    var recovery_lock = try fs.acquireTargetWriteLock(testing.io, tmp.dir, "page.md");
    var lock_held = true;
    defer if (lock_held) recovery_lock.release();
    var started: std.atomic.Value(bool) = .init(false);
    var finished: std.atomic.Value(bool) = .init(false);
    var finalizer: Finalizer = .{
        .io = testing.io,
        .dir = tmp.dir,
        .started = &started,
        .finished = &finished,
    };
    const thread = try std.Thread.spawn(.{}, Finalizer.run, .{&finalizer});
    while (!started.load(.acquire)) std.Thread.yield() catch {};
    var yields: usize = 0;
    while (yields < 10_000 and !finished.load(.acquire)) : (yields += 1) std.Thread.yield() catch {};
    try testing.expect(!finished.load(.acquire));

    try std.Io.Dir.renamePreserve(tmp.dir, "page.md", tmp.dir, "second.previous", testing.io);
    try fs.syncContainingDir(testing.io, tmp.dir, "second.previous");
    recovery_lock.release();
    lock_held = false;
    thread.join();

    try testing.expect(finalizer.failure == null);
    try testing.expectEqual(fs.FinalizePendingRecoveryResult.changed, finalizer.result.?);
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, "page.md"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md.write-pending"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "second.previous"));
    try testing.expectEqual(
        fs.ReplacePreparedResult.changed,
        try fs.replacePreparedFileIfUnchanged(
            testing.io,
            tmp.dir,
            "page.md",
            "absence.tmp",
            "absence.previous",
            testing.allocator,
            null,
        ),
    );
    try testing.expect(!fs.pathExists(testing.io, tmp.dir, "page.md"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "page.md.write-pending"));
    try testing.expect(fs.pathExists(testing.io, tmp.dir, "absence.tmp"));
}
