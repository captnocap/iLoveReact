// tsz/runtime/fs.zig
//
// Core filesystem substrate for the tsz storage stack.
// Provides app data directory management, path confinement, and common file operations.
// All higher-level storage modules (localstore, fswatch, library_index, archive) build on this.
//
// Design:
// - Module-level globals with init/deinit (matches runtime convention)
// - Fixed-size buffers, no heap allocation
// - Path confinement: all paths validated before use (no .. escape, no absolute paths)
// - Operations take a Dir handle so callers can scope to different roots

const std = @import("std");
const host_io = @import("../host_io.zig");

pub const MAX_PATH = std.fs.max_path_bytes;
pub const MAX_NAME = 255;

// -- Types --

pub const FileStat = struct {
    size: u64,
    mtime_ns: i128, // nanoseconds since Unix epoch
    kind: std.Io.File.Kind,
    mode: std.Io.File.Permissions,

    /// Convert mtime to seconds (for comparison with Lua os.time() style timestamps)
    pub fn mtimeSec(self: FileStat) i64 {
        return @intCast(@divTrunc(self.mtime_ns, std.time.ns_per_s));
    }
};

pub const DirEntry = struct {
    name_buf: [MAX_NAME]u8 = undefined,
    name_len: u8 = 0,
    kind: std.Io.File.Kind = .file,

    pub fn name(self: *const DirEntry) []const u8 {
        return self.name_buf[0..self.name_len];
    }
};

// -- Module state --

var data_dir: ?std.Io.Dir = null;
var data_path: [MAX_PATH]u8 = undefined;
var data_path_len: usize = 0;

// -- Init / Deinit --

/// Initialize the filesystem substrate with an app name.
/// Resolves the XDG data directory ($XDG_DATA_HOME/<app> or ~/.local/share/<app>),
/// creates it if needed, and opens a Dir handle for subsequent operations.
pub fn init(app_name: []const u8) !void {
    if (data_dir != null) return;

    // Resolve XDG data home
    data_path_len = 0;
    if (host_io.getenv("XDG_DATA_HOME")) |xdg| {
        if (xdg.len > 0) {
            const s = std.fmt.bufPrint(&data_path, "{s}/{s}", .{ xdg, app_name }) catch
                return error.NameTooLong;
            data_path_len = s.len;
        }
    }
    if (data_path_len == 0) {
        const home = host_io.getenv("HOME") orelse return error.AppDataDirUnavailable;
        const s = std.fmt.bufPrint(&data_path, "{s}/.local/share/{s}", .{ home, app_name }) catch
            return error.NameTooLong;
        data_path_len = s.len;
    }

    // Create directory tree and open handle
    const path_slice = data_path[0..data_path_len];
    try std.Io.Dir.cwd().createDirPath(host_io.io(), path_slice);
    data_dir = try std.Io.Dir.cwd().openDir(host_io.io(), path_slice, .{ .iterate = true });
}

pub fn deinit() void {
    if (data_dir) |d| d.close(host_io.io());
    data_dir = null;
    data_path_len = 0;
}

/// Get the app data directory handle. Returns error if not initialized.
pub fn dataDir() error{NotInitialized}!std.Io.Dir {
    return data_dir orelse error.NotInitialized;
}

/// Get the absolute path to the app data directory.
pub fn dataDirPath() error{NotInitialized}![]const u8 {
    if (data_dir == null) return error.NotInitialized;
    return data_path[0..data_path_len];
}

pub fn isInitialized() bool {
    return data_dir != null;
}

// -- Path confinement --

/// Returns true if the path is safe to use: non-empty, relative, and cannot
/// escape the root directory via ".." traversal.
pub fn isConfined(path: []const u8) bool {
    if (path.len == 0) return false;
    // Reject absolute paths
    if (path[0] == '/') return false;
    // Reject null bytes (path injection)
    for (path) |c| {
        if (c == 0) return false;
    }

    // Walk segments, track depth. Any point where depth < 0 means escape.
    var depth: i32 = 0;
    var iter = std.mem.splitScalar(u8, path, '/');
    while (iter.next()) |seg| {
        if (seg.len == 0 or std.mem.eql(u8, seg, ".")) continue;
        if (std.mem.eql(u8, seg, "..")) {
            depth -= 1;
            if (depth < 0) return false;
        } else {
            depth += 1;
        }
    }
    return true;
}

fn checkPath(path: []const u8) error{PathNotConfined}!void {
    if (!isConfined(path)) return error.PathNotConfined;
}

// -- File operations --

/// Read a file's contents into the provided buffer. Returns bytes read.
/// If the file is larger than the buffer, only buf.len bytes are read.
pub fn readText(dir: std.Io.Dir, path: []const u8, buf: []u8) !usize {
    try checkPath(path);
    const file = try dir.openFile(host_io.io(), path, .{});
    defer file.close(host_io.io());
    return file.readPositionalAll(host_io.io(), buf, 0);
}

/// Write content to a file, creating or truncating as needed.
pub fn writeText(dir: std.Io.Dir, path: []const u8, content: []const u8) !void {
    try checkPath(path);
    const file = try dir.createFile(host_io.io(), path, .{ .truncate = true });
    defer file.close(host_io.io());
    try file.writeStreamingAll(host_io.io(), content);
}

/// Write content atomically: write to a temp file, then rename over the target.
/// If the process crashes mid-write, the original file is untouched.
pub fn writeAtomic(dir: std.Io.Dir, path: []const u8, content: []const u8) !void {
    try checkPath(path);

    // Build temp path
    var tmp_buf: [MAX_PATH]u8 = undefined;
    const tmp_path = std.fmt.bufPrint(&tmp_buf, "{s}.tmp", .{path}) catch
        return error.NameTooLong;

    // Write to temp file
    const file = try dir.createFile(host_io.io(), tmp_path, .{ .truncate = true });
    file.writeStreamingAll(host_io.io(), content) catch |err| {
        file.close(host_io.io());
        dir.deleteFile(host_io.io(), tmp_path) catch {};
        return err;
    };
    file.close(host_io.io());

    // Atomic rename (single syscall on POSIX)
    std.Io.Dir.rename(dir, tmp_path, dir, path, host_io.io()) catch |err| {
        dir.deleteFile(host_io.io(), tmp_path) catch {};
        return err;
    };
}

/// Delete a file.
pub fn deleteFile(dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    try dir.deleteFile(host_io.io(), path);
}

/// Check if a path exists (file or directory).
pub fn pathExists(dir: std.Io.Dir, path: []const u8) bool {
    if (!isConfined(path)) return false;
    _ = dir.statFile(host_io.io(), path, .{}) catch return false;
    return true;
}

// -- Directory operations --

/// Create a single directory. Parent must exist.
pub fn makeDir(dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    try dir.createDir(host_io.io(), path, .default_dir);
}

/// Create a directory and all missing parents.
pub fn makePath(dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    try dir.createDirPath(host_io.io(), path);
}

/// List the contents of a directory. Returns the number of entries written to `out`.
/// If there are more entries than out.len, only the first out.len are returned.
pub fn listDir(dir: std.Io.Dir, path: []const u8, out: []DirEntry) !usize {
    try checkPath(path);
    var sub = try dir.openDir(host_io.io(), path, .{ .iterate = true });
    defer sub.close(host_io.io());
    return iterateDir(sub, out);
}

/// List the contents of an already-open directory handle.
pub fn listOpenDir(dir: std.Io.Dir, out: []DirEntry) !usize {
    // Re-open to get a fresh iterator without consuming the caller's handle
    var copy = try std.Io.Dir.openDir(dir, host_io.io(), ".", .{ .iterate = true });
    defer copy.close(host_io.io());
    return iterateDir(copy, out);
}

fn iterateDir(dir: std.Io.Dir, out: []DirEntry) !usize {
    var iter = dir.iterate();
    var count: usize = 0;
    while (try iter.next(host_io.io())) |entry| {
        if (count >= out.len) break;
        const len: u8 = @intCast(@min(entry.name.len, MAX_NAME));
        @memcpy(out[count].name_buf[0..len], entry.name[0..len]);
        out[count].name_len = len;
        out[count].kind = entry.kind;
        count += 1;
    }
    return count;
}

/// Delete an empty directory.
pub fn deleteDir(dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    try dir.deleteDir(host_io.io(), path);
}

/// Recursively delete a directory and all its contents.
pub fn deleteTree(dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    try dir.deleteTree(host_io.io(), path);
}

// -- Stat --

/// Get metadata for a file or directory.
pub fn statPath(dir: std.Io.Dir, path: []const u8) !FileStat {
    try checkPath(path);
    const s = try dir.statFile(host_io.io(), path, .{});
    return FileStat{
        .size = s.size,
        .mtime_ns = @intCast(s.mtime.toNanoseconds()),
        .kind = s.kind,
        .mode = s.permissions,
    };
}

// -- Tests --

test "isConfined rejects absolute paths" {
    try std.testing.expect(!isConfined("/etc/passwd"));
    try std.testing.expect(!isConfined("/"));
}

test "isConfined rejects .. traversal" {
    try std.testing.expect(!isConfined(".."));
    try std.testing.expect(!isConfined("../foo"));
    try std.testing.expect(!isConfined("foo/../../bar"));
    try std.testing.expect(!isConfined("a/b/../../../c"));
}

test "isConfined allows safe paths" {
    try std.testing.expect(isConfined("foo"));
    try std.testing.expect(isConfined("foo/bar"));
    try std.testing.expect(isConfined("foo/bar/baz.txt"));
    try std.testing.expect(isConfined("foo/../foo/bar")); // depth never goes negative
    try std.testing.expect(isConfined("."));
    try std.testing.expect(isConfined("./foo"));
    try std.testing.expect(isConfined("a/b/../c"));
}

test "isConfined rejects empty and null bytes" {
    try std.testing.expect(!isConfined(""));
    try std.testing.expect(!isConfined("foo\x00bar"));
}

test "file round-trip in tmp dir" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const content = "hello, tsz filesystem";
    try writeText(tmp.dir, "test.txt", content);

    var buf: [256]u8 = undefined;
    const n = try readText(tmp.dir, "test.txt", &buf);
    try std.testing.expectEqualStrings(content, buf[0..n]);

    // Stat
    const s = try statPath(tmp.dir, "test.txt");
    try std.testing.expectEqual(@as(u64, content.len), s.size);
    try std.testing.expectEqual(std.Io.File.Kind.file, s.kind);

    // Delete
    try deleteFile(tmp.dir, "test.txt");
    try std.testing.expect(!pathExists(tmp.dir, "test.txt"));
}

test "atomic write" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    // Write original
    try writeText(tmp.dir, "data.txt", "version1");

    // Atomic overwrite
    try writeAtomic(tmp.dir, "data.txt", "version2");

    var buf: [256]u8 = undefined;
    const n = try readText(tmp.dir, "data.txt", &buf);
    try std.testing.expectEqualStrings("version2", buf[0..n]);

    // Temp file should not remain
    try std.testing.expect(!pathExists(tmp.dir, "data.txt.tmp"));
}

test "directory operations" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    // makePath creates nested dirs
    try makePath(tmp.dir, "a/b/c");
    try std.testing.expect(pathExists(tmp.dir, "a/b/c"));

    // Write files in subdirectory
    try writeText(tmp.dir, "a/b/c/one.txt", "1");
    try writeText(tmp.dir, "a/b/c/two.txt", "2");

    // listDir
    var entries: [16]DirEntry = undefined;
    const count = try listDir(tmp.dir, "a/b/c", &entries);
    try std.testing.expectEqual(@as(usize, 2), count);

    // deleteTree
    try deleteTree(tmp.dir, "a");
    try std.testing.expect(!pathExists(tmp.dir, "a"));
}

test "path confinement enforcement" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    // Absolute path rejected
    try std.testing.expectError(error.PathNotConfined, readText(tmp.dir, "/etc/passwd", &[_]u8{}));

    // Traversal rejected
    try std.testing.expectError(error.PathNotConfined, writeText(tmp.dir, "../escape.txt", "bad"));

    // Empty rejected
    try std.testing.expectError(error.PathNotConfined, deleteFile(tmp.dir, ""));
}
