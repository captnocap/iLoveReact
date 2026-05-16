// tsz/runtime/fswatch.zig
//
// Poll-based filesystem watcher.
// Mirrors love2d/lua/capabilities/filewatcher.lua: snapshot diff, glob filter,
// exclude directories, configurable interval.
//
// Reuses the event-manager pattern from runtime/net/*.zig:
// - register watchers at init
// - poll each frame (accumulates dt, fires on interval)
// - returns change events to caller
//
// Does NOT use OS-native watchers (inotify/kqueue/FSEvents).
// Polling matches Lua behavior and keeps cross-platform semantics stable.

const std = @import("std");

pub const MAX_WATCHERS = 8;
pub const MAX_FILES = 512;
pub const MAX_EVENTS = 64;
const SNAP_PATH_MAX = 256;

// -- Types --

pub const ChangeType = enum {
    created,
    modified,
    deleted,
};

pub const ChangeEvent = struct {
    watcher_id: u8,
    change_type: ChangeType,
    path_buf: [SNAP_PATH_MAX]u8 = undefined,
    path_len: u16 = 0,
    size: u64 = 0,
    mtime_ns: i128 = 0,

    pub fn path(self: *const ChangeEvent) []const u8 {
        return self.path_buf[0..self.path_len];
    }
};

const SnapEntry = struct {
    rel_path: [SNAP_PATH_MAX]u8 = undefined,
    rel_len: u16 = 0,
    size: u64 = 0,
    mtime_ns: i128 = 0,

    fn relPath(self: *const SnapEntry) []const u8 {
        return self.rel_path[0..self.rel_len];
    }
};

const Watcher = struct {
    // Config
    watch_path: [std.fs.max_path_bytes]u8 = undefined,
    watch_path_len: usize = 0,
    recursive: bool = false,
    interval_ms: u32 = 1000,
    pattern: [128]u8 = undefined,
    pattern_len: u8 = 0,
    has_pattern: bool = false,
    exclude: [8][64]u8 = undefined,
    exclude_lens: [8]u8 = [_]u8{0} ** 8,
    exclude_count: u8 = 0,

    // State
    active: bool = false,
    is_dir: bool = false,
    elapsed_ms: u32 = 0,

    // Previous snapshot
    snapshot: [MAX_FILES]SnapEntry = undefined,
    snap_count: usize = 0,
    has_initial_snap: bool = false,
};

pub const WatcherConfig = struct {
    path: []const u8,
    recursive: bool = false,
    interval_ms: u32 = 1000,
    pattern: ?[]const u8 = null,
    exclude: ?[]const []const u8 = null,
};

// -- Module state --

var watchers: [MAX_WATCHERS]Watcher = [_]Watcher{.{}} ** MAX_WATCHERS;
var watcher_count: u8 = 0;

// -- Engine-driven event queue --
// Engine calls tick() once per frame, which polls watchers and accumulates
// events here until JS drains them. Bounded; overflow events are dropped.
var pending_events: [MAX_EVENTS]ChangeEvent = undefined;
var pending_count: usize = 0;

// -- Init / Deinit --

pub fn init() void {
    watcher_count = 0;
    for (&watchers) |*w| w.active = false;
}

pub fn deinit() void {
    watcher_count = 0;
    for (&watchers) |*w| w.active = false;
}

// -- Add / Remove --

/// Register a new file watcher. Returns the watcher ID (0-based).
pub fn addWatcher(config: WatcherConfig) error{ TooManyWatchers, NameTooLong }!u8 {
    // Find a free slot
    var slot: ?u8 = null;
    for (0..MAX_WATCHERS) |i| {
        if (!watchers[i].active) {
            slot = @intCast(i);
            break;
        }
    }
    const id = slot orelse return error.TooManyWatchers;
    var w = &watchers[id];

    // Copy path
    if (config.path.len > w.watch_path.len) return error.NameTooLong;
    @memcpy(w.watch_path[0..config.path.len], config.path);
    w.watch_path_len = config.path.len;

    w.recursive = config.recursive;
    w.interval_ms = @max(config.interval_ms, 100); // min 100ms like Lua
    w.elapsed_ms = 0;
    w.has_initial_snap = false;
    w.snap_count = 0;

    // Copy pattern
    if (config.pattern) |pat| {
        const len: u8 = @intCast(@min(pat.len, w.pattern.len));
        @memcpy(w.pattern[0..len], pat[0..len]);
        w.pattern_len = len;
        w.has_pattern = true;
    } else {
        w.has_pattern = false;
        w.pattern_len = 0;
    }

    // Copy exclude list
    w.exclude_count = 0;
    if (config.exclude) |excludes| {
        for (excludes) |exc| {
            if (w.exclude_count >= 8) break;
            const elen: u8 = @intCast(@min(exc.len, 64));
            @memcpy(w.exclude[w.exclude_count][0..elen], exc[0..elen]);
            w.exclude_lens[w.exclude_count] = elen;
            w.exclude_count += 1;
        }
    }

    // Detect if path is a directory
    w.is_dir = blk: {
        const s = std.fs.cwd().statFile(config.path) catch break :blk false;
        break :blk s.kind == .directory;
    };

    w.active = true;
    if (id >= watcher_count) watcher_count = id + 1;

    // Build initial snapshot (no events emitted for initial state)
    buildSnapshot(w) catch {};

    return id;
}

/// Remove a watcher by ID.
pub fn removeWatcher(id: u8) void {
    if (id >= MAX_WATCHERS) return;
    watchers[id].active = false;
}

/// Engine-frame tick. Polls each active watcher, accumulates change events
/// in pending_events. Call once per frame from the engine main loop.
pub fn tick(dt_ms: u32) void {
    if (watcher_count == 0) return;
    var scratch: [MAX_EVENTS]ChangeEvent = undefined;
    const n = poll(dt_ms, &scratch);
    if (n == 0) return;
    var i: usize = 0;
    while (i < n and pending_count < MAX_EVENTS) : (i += 1) {
        pending_events[pending_count] = scratch[i];
        pending_count += 1;
    }
    // Overflow events silently dropped — JS should drain promptly.
}

/// Drain accumulated events into `out`, returning the number written.
/// After this returns, the internal queue is empty.
pub fn drainEvents(out: []ChangeEvent) usize {
    const n = @min(out.len, pending_count);
    @memcpy(out[0..n], pending_events[0..n]);
    pending_count = 0;
    return n;
}

// -- Poll --

/// Advance all watchers by dt_ms milliseconds and collect change events.
/// Call this once per frame. Returns the number of events written.
pub fn poll(dt_ms: u32, out: []ChangeEvent) usize {
    var event_count: usize = 0;

    for (0..watcher_count) |i| {
        var w = &watchers[i];
        if (!w.active) continue;

        w.elapsed_ms += dt_ms;
        if (w.elapsed_ms < w.interval_ms) continue;
        w.elapsed_ms = 0;

        // Build new snapshot
        var new_snap: [MAX_FILES]SnapEntry = undefined;
        const new_count = buildSnapshotInto(w, &new_snap) catch 0;

        if (!w.has_initial_snap) {
            // First scan: store as baseline, no events
            @memcpy(w.snapshot[0..new_count], new_snap[0..new_count]);
            w.snap_count = new_count;
            w.has_initial_snap = true;
            continue;
        }

        // Diff old vs new
        event_count += diffSnapshots(
            @intCast(i),
            w.snapshot[0..w.snap_count],
            new_snap[0..new_count],
            out[event_count..],
        );

        // Swap in new snapshot
        @memcpy(w.snapshot[0..new_count], new_snap[0..new_count]);
        w.snap_count = new_count;
    }

    return event_count;
}

// -- Scanning --

fn buildSnapshot(w: *Watcher) !void {
    w.snap_count = try buildSnapshotInto(w, &w.snapshot);
    w.has_initial_snap = true;
}

fn buildSnapshotInto(w: *const Watcher, out: *[MAX_FILES]SnapEntry) !usize {
    const watch_path = w.watch_path[0..w.watch_path_len];
    var count: usize = 0;

    if (!w.is_dir) {
        // Single file watch
        const s = std.fs.cwd().statFile(watch_path) catch return 0;
        const basename = std.fs.path.basename(watch_path);
        const len: u16 = @intCast(@min(basename.len, SNAP_PATH_MAX));
        @memcpy(out[0].rel_path[0..len], basename[0..len]);
        out[0].rel_len = len;
        out[0].size = s.size;
        out[0].mtime_ns = s.mtime;
        return 1;
    }

    // Directory watch
    var dir = std.fs.cwd().openDir(watch_path, .{ .iterate = true }) catch return 0;
    defer dir.close();

    if (w.recursive) {
        // Recursive scan using Dir.walk (requires allocator)
        var walker = dir.walk(std.heap.page_allocator) catch return 0;
        defer walker.deinit();

        while (walker.next() catch null) |entry| {
            if (count >= MAX_FILES) break;
            if (entry.kind == .directory) continue;

            // Check exclude
            if (w.exclude_count > 0 and isExcluded(w, entry.path)) continue;

            // Check pattern
            if (w.has_pattern and !matchGlob(w.pattern[0..w.pattern_len], entry.basename)) continue;

            // Stat
            const s = entry.dir.statFile(entry.basename) catch continue;
            const plen: u16 = @intCast(@min(entry.path.len, SNAP_PATH_MAX));
            @memcpy(out[count].rel_path[0..plen], entry.path[0..plen]);
            out[count].rel_len = plen;
            out[count].size = s.size;
            out[count].mtime_ns = s.mtime;
            count += 1;
        }
    } else {
        // Shallow scan
        var iter = dir.iterate();
        while (iter.next() catch null) |entry| {
            if (count >= MAX_FILES) break;
            if (entry.kind == .directory) continue;

            // Check pattern
            if (w.has_pattern and !matchGlob(w.pattern[0..w.pattern_len], entry.name)) continue;

            // Stat
            const s = dir.statFile(entry.name) catch continue;
            const nlen: u16 = @intCast(@min(entry.name.len, SNAP_PATH_MAX));
            @memcpy(out[count].rel_path[0..nlen], entry.name[0..nlen]);
            out[count].rel_len = nlen;
            out[count].size = s.size;
            out[count].mtime_ns = s.mtime;
            count += 1;
        }
    }

    // Sort by path for stable diffing
    std.mem.sort(SnapEntry, out[0..count], {}, struct {
        fn lessThan(_: void, a: SnapEntry, b: SnapEntry) bool {
            return std.mem.order(u8, a.relPath(), b.relPath()) == .lt;
        }
    }.lessThan);

    return count;
}

// -- Diffing --

fn diffSnapshots(watcher_id: u8, old: []const SnapEntry, new: []const SnapEntry, out: []ChangeEvent) usize {
    var count: usize = 0;
    var oi: usize = 0;
    var ni: usize = 0;

    // Merge-walk sorted arrays
    while (oi < old.len and ni < new.len) {
        if (count >= out.len) break;
        const cmp = std.mem.order(u8, old[oi].relPath(), new[ni].relPath());

        switch (cmp) {
            .eq => {
                // Same path — check for modification
                if (old[oi].size != new[ni].size or old[oi].mtime_ns != new[ni].mtime_ns) {
                    out[count] = makeEvent(watcher_id, .modified, &new[ni]);
                    count += 1;
                }
                oi += 1;
                ni += 1;
            },
            .lt => {
                // In old but not new → deleted
                out[count] = makeEvent(watcher_id, .deleted, &old[oi]);
                count += 1;
                oi += 1;
            },
            .gt => {
                // In new but not old → created
                out[count] = makeEvent(watcher_id, .created, &new[ni]);
                count += 1;
                ni += 1;
            },
        }
    }

    // Remaining old entries → deleted
    while (oi < old.len and count < out.len) {
        out[count] = makeEvent(watcher_id, .deleted, &old[oi]);
        count += 1;
        oi += 1;
    }

    // Remaining new entries → created
    while (ni < new.len and count < out.len) {
        out[count] = makeEvent(watcher_id, .created, &new[ni]);
        count += 1;
        ni += 1;
    }

    return count;
}

fn makeEvent(watcher_id: u8, change_type: ChangeType, entry: *const SnapEntry) ChangeEvent {
    var ev = ChangeEvent{
        .watcher_id = watcher_id,
        .change_type = change_type,
        .size = entry.size,
        .mtime_ns = entry.mtime_ns,
    };
    @memcpy(ev.path_buf[0..entry.rel_len], entry.rel_path[0..entry.rel_len]);
    ev.path_len = entry.rel_len;
    return ev;
}

// -- Exclude check --

fn isExcluded(w: *const Watcher, rel_path: []const u8) bool {
    for (0..w.exclude_count) |i| {
        const exc = w.exclude[i][0..w.exclude_lens[i]];
        // Check if any path component matches the exclude name
        var iter = std.mem.splitScalar(u8, rel_path, '/');
        while (iter.next()) |seg| {
            if (std.mem.eql(u8, seg, exc)) return true;
        }
    }
    return false;
}

// -- Glob matching --

/// Simple glob pattern matching. Supports * (any sequence) and ? (one char).
pub fn matchGlob(pattern: []const u8, name: []const u8) bool {
    var pi: usize = 0;
    var ni: usize = 0;
    var star_pi: ?usize = null;
    var star_ni: usize = 0;

    while (ni < name.len) {
        if (pi < pattern.len and (pattern[pi] == name[ni] or pattern[pi] == '?')) {
            pi += 1;
            ni += 1;
        } else if (pi < pattern.len and pattern[pi] == '*') {
            star_pi = pi;
            star_ni = ni;
            pi += 1;
        } else if (star_pi) |sp| {
            pi = sp + 1;
            star_ni += 1;
            ni = star_ni;
        } else {
            return false;
        }
    }

    // Consume trailing stars
    while (pi < pattern.len and pattern[pi] == '*') pi += 1;
    return pi == pattern.len;
}

// -- Tests --

test "matchGlob basics" {
    try std.testing.expect(matchGlob("*.zig", "main.zig"));
    try std.testing.expect(matchGlob("*.zig", "fs.zig"));
    try std.testing.expect(!matchGlob("*.zig", "main.lua"));
    try std.testing.expect(matchGlob("test?", "test1"));
    try std.testing.expect(matchGlob("test?", "testX"));
    try std.testing.expect(!matchGlob("test?", "test"));
    try std.testing.expect(!matchGlob("test?", "test12"));
    try std.testing.expect(matchGlob("*", "anything"));
    try std.testing.expect(matchGlob("a*z", "az"));
    try std.testing.expect(matchGlob("a*z", "abcz"));
    try std.testing.expect(!matchGlob("a*z", "abcx"));
}

test "isExcluded" {
    var w = Watcher{};
    @memcpy(w.exclude[0][0..4], ".git");
    w.exclude_lens[0] = 4;
    @memcpy(w.exclude[1][0..12], "node_modules");
    w.exclude_lens[1] = 12;
    w.exclude_count = 2;

    try std.testing.expect(isExcluded(&w, ".git/objects/abc"));
    try std.testing.expect(isExcluded(&w, "src/node_modules/foo.js"));
    try std.testing.expect(!isExcluded(&w, "src/main.zig"));
    try std.testing.expect(!isExcluded(&w, "gitconfig"));
}

test "snapshot diff detects changes" {
    var old = [_]SnapEntry{
        makeSnap("a.txt", 100, 1000),
        makeSnap("b.txt", 200, 2000),
        makeSnap("c.txt", 300, 3000),
    };
    var new = [_]SnapEntry{
        makeSnap("a.txt", 100, 1000), // unchanged
        makeSnap("b.txt", 250, 2500), // modified (size + mtime changed)
        makeSnap("d.txt", 400, 4000), // created
    };

    var events: [16]ChangeEvent = undefined;
    const count = diffSnapshots(0, &old, &new, &events);

    try std.testing.expectEqual(@as(usize, 3), count);

    // b.txt modified
    try std.testing.expectEqual(ChangeType.modified, events[0].change_type);
    try std.testing.expectEqualStrings("b.txt", events[0].path());

    // c.txt deleted
    try std.testing.expectEqual(ChangeType.deleted, events[1].change_type);
    try std.testing.expectEqualStrings("c.txt", events[1].path());

    // d.txt created
    try std.testing.expectEqual(ChangeType.created, events[2].change_type);
    try std.testing.expectEqualStrings("d.txt", events[2].path());
}

test "watcher lifecycle with real files" {
    // Create a temp directory with some files
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    // Write initial files
    var f1 = try tmp.dir.createFile("one.txt", .{});
    try f1.writeAll("hello");
    f1.close();
    var f2 = try tmp.dir.createFile("two.txt", .{});
    try f2.writeAll("world");
    f2.close();

    // Get the temp dir path
    var path_buf: [std.fs.max_path_bytes]u8 = undefined;
    const tmp_path = try tmp.dir.realpath(".", &path_buf);

    init();
    defer deinit();

    const id = try addWatcher(.{
        .path = tmp_path,
        .interval_ms = 100,
    });

    // First poll: no events (initial scan)
    var events: [16]ChangeEvent = undefined;
    var count = poll(200, &events);
    try std.testing.expectEqual(@as(usize, 0), count);

    // Create a new file
    var f3 = try tmp.dir.createFile("three.txt", .{});
    try f3.writeAll("new");
    f3.close();

    // Poll again: should detect created
    count = poll(200, &events);
    try std.testing.expectEqual(@as(usize, 1), count);
    try std.testing.expectEqual(ChangeType.created, events[0].change_type);
    try std.testing.expectEqualStrings("three.txt", events[0].path());

    // Delete a file
    try tmp.dir.deleteFile("one.txt");

    // Poll: should detect deleted
    count = poll(200, &events);
    try std.testing.expectEqual(@as(usize, 1), count);
    try std.testing.expectEqual(ChangeType.deleted, events[0].change_type);
    try std.testing.expectEqualStrings("one.txt", events[0].path());

    _ = id;
}

test "glob pattern filter" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    var f1 = try tmp.dir.createFile("app.zig", .{});
    f1.close();
    var f2 = try tmp.dir.createFile("app.lua", .{});
    f2.close();
    var f3 = try tmp.dir.createFile("test.zig", .{});
    f3.close();

    var path_buf: [std.fs.max_path_bytes]u8 = undefined;
    const tmp_path = try tmp.dir.realpath(".", &path_buf);

    init();
    defer deinit();

    _ = try addWatcher(.{
        .path = tmp_path,
        .interval_ms = 100,
        .pattern = "*.zig",
    });

    // Initial scan
    var events: [16]ChangeEvent = undefined;
    _ = poll(200, &events);

    // Only .zig files should be in snapshot
    // Verify by creating a .lua file — should not be detected
    var f4 = try tmp.dir.createFile("new.lua", .{});
    f4.close();

    var count = poll(200, &events);
    try std.testing.expectEqual(@as(usize, 0), count); // .lua filtered out

    // Creating a .zig file should be detected
    var f5 = try tmp.dir.createFile("new.zig", .{});
    f5.close();

    count = poll(200, &events);
    try std.testing.expectEqual(@as(usize, 1), count);
    try std.testing.expectEqualStrings("new.zig", events[0].path());
}

// Test helper
fn makeSnap(name: []const u8, size: u64, mtime: i128) SnapEntry {
    var entry = SnapEntry{};
    @memcpy(entry.rel_path[0..name.len], name);
    entry.rel_len = @intCast(name.len);
    entry.size = size;
    entry.mtime_ns = mtime;
    return entry;
}
