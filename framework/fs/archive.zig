// tsz/runtime/archive.zig
//
// Archive inspection and safe extraction using libarchive.
// Mirrors love2d/lua/archive.lua: list, readEntry, search, info.
// Adds real extraction (which Lua's version does not fully implement).
//
// Phase 6A: list, readEntry, search, info
// Phase 6B: safe extraction with path confinement
//
// Only compiled into the binary when archive features are used.
// The compiler writes "archive" to ffi_libs.txt so build.zig links it.

const std = @import("std");
const fs = @import("fs.zig");

const ar = @cImport({
    @cInclude("archive.h");
    @cInclude("archive_entry.h");
});

const BLOCK_SIZE = 16384;
const PATH_MAX = 256;

// -- Types --

pub const ArchiveEntry = struct {
    pathname_buf: [PATH_MAX]u8 = undefined,
    pathname_len: u16 = 0,
    size: i64 = 0,
    mtime: i64 = 0,
    is_dir: bool = false,
    is_file: bool = true,

    pub fn pathname(self: *const ArchiveEntry) []const u8 {
        return self.pathname_buf[0..self.pathname_len];
    }
};

pub const ArchiveInfo = struct {
    entry_count: u32 = 0,
    file_count: u32 = 0,
    dir_count: u32 = 0,
    total_size: u64 = 0,
    format_buf: [64]u8 = undefined,
    format_len: u8 = 0,

    pub fn format(self: *const ArchiveInfo) []const u8 {
        return self.format_buf[0..self.format_len];
    }
};

pub const ArchiveError = error{
    OpenFailed,
    ReadFailed,
    EntryNotFound,
    PathUnsafe,
    WriteFailed,
    ExtractionFailed,
};

// -- Helpers --

fn openArchive(path: []const u8) ArchiveError!*ar.archive {
    const a = ar.archive_read_new() orelse return ArchiveError.OpenFailed;
    _ = ar.archive_read_support_format_all(a);
    _ = ar.archive_read_support_filter_all(a);

    // Null-terminate path
    var path_buf: [std.fs.max_path_bytes + 1]u8 = undefined;
    if (path.len >= path_buf.len) return ArchiveError.OpenFailed;
    @memcpy(path_buf[0..path.len], path);
    path_buf[path.len] = 0;
    const path_z: [*:0]const u8 = @ptrCast(path_buf[0..path.len]);

    if (ar.archive_read_open_filename(a, path_z, BLOCK_SIZE) != ar.ARCHIVE_OK) {
        _ = ar.archive_read_free(a);
        return ArchiveError.OpenFailed;
    }

    return a;
}

fn closeArchive(a: *ar.archive) void {
    _ = ar.archive_read_close(a);
    _ = ar.archive_read_free(a);
}

fn fillEntry(entry: *ar.archive_entry, out: *ArchiveEntry) void {
    const raw_path = ar.archive_entry_pathname(entry);
    if (raw_path) |p| {
        const cstr: [*:0]const u8 = p;
        const pslice = std.mem.span(cstr);
        const plen: u16 = @intCast(@min(pslice.len, PATH_MAX));
        @memcpy(out.pathname_buf[0..plen], pslice[0..plen]);
        out.pathname_len = plen;
    } else {
        out.pathname_len = 0;
    }

    out.size = ar.archive_entry_size(entry);
    out.mtime = ar.archive_entry_mtime(entry);

    const ftype = ar.archive_entry_filetype(entry);
    out.is_dir = (ftype & 0o170000) == 0o040000; // S_IFDIR
    out.is_file = (ftype & 0o170000) == 0o100000; // S_IFREG
}

// -- Phase 6A: Inspection --

/// List all entries in an archive. Returns count written to `out`.
pub fn list(path: []const u8, out: []ArchiveEntry) ArchiveError!usize {
    const a = try openArchive(path);
    defer closeArchive(a);

    var count: usize = 0;
    var entry: ?*ar.archive_entry = null;

    while (ar.archive_read_next_header(a, &entry) == ar.ARCHIVE_OK) {
        if (count >= out.len) break;
        fillEntry(entry.?, &out[count]);
        count += 1;
    }

    return count;
}

/// Read a single entry's data from the archive. Returns bytes read.
pub fn readEntry(path: []const u8, entry_path: []const u8, buf: []u8) ArchiveError!usize {
    const a = try openArchive(path);
    defer closeArchive(a);

    var entry: ?*ar.archive_entry = null;

    while (ar.archive_read_next_header(a, &entry) == ar.ARCHIVE_OK) {
        const e = entry.?;
        const raw_path = ar.archive_entry_pathname(e);
        if (raw_path) |p| {
            const cstr: [*:0]const u8 = p;
            const pslice = std.mem.span(cstr);
            if (std.mem.eql(u8, pslice, entry_path)) {
                // Found it — read data
                const size = ar.archive_entry_size(e);
                const to_read: usize = @intCast(@min(size, @as(i64, @intCast(buf.len))));
                var total: usize = 0;

                while (total < to_read) {
                    const n = ar.archive_read_data(a, buf[total..].ptr, to_read - total);
                    if (n <= 0) break;
                    total += @intCast(n);
                }

                return total;
            }
        }
    }

    return ArchiveError.EntryNotFound;
}

/// Search entries by name substring (case-insensitive). Returns count.
pub fn search(path: []const u8, query: []const u8, out: []ArchiveEntry) ArchiveError!usize {
    const a = try openArchive(path);
    defer closeArchive(a);

    var count: usize = 0;
    var entry: ?*ar.archive_entry = null;

    while (ar.archive_read_next_header(a, &entry) == ar.ARCHIVE_OK) {
        if (count >= out.len) break;
        const e = entry.?;
        const raw_path = ar.archive_entry_pathname(e);
        if (raw_path) |p| {
            const cstr: [*:0]const u8 = p;
            const pslice = std.mem.span(cstr);
            if (containsInsensitive(pslice, query)) {
                fillEntry(e, &out[count]);
                count += 1;
            }
        }
    }

    return count;
}

/// Get archive-level metadata.
pub fn info(path: []const u8) ArchiveError!ArchiveInfo {
    const a = try openArchive(path);
    defer closeArchive(a);

    var result = ArchiveInfo{};
    var entry: ?*ar.archive_entry = null;
    var got_format = false;

    while (ar.archive_read_next_header(a, &entry) == ar.ARCHIVE_OK) {
        const e = entry.?;
        result.entry_count += 1;

        const ftype = ar.archive_entry_filetype(e);
        if ((ftype & 0o170000) == 0o040000) {
            result.dir_count += 1;
        } else {
            result.file_count += 1;
            const size = ar.archive_entry_size(e);
            if (size > 0) result.total_size += @intCast(size);
        }

        if (!got_format) {
            const fmt = ar.archive_format_name(a);
            if (fmt) |f| {
                const cstr: [*:0]const u8 = f;
                const fslice = std.mem.span(cstr);
                const flen: u8 = @intCast(@min(fslice.len, 64));
                @memcpy(result.format_buf[0..flen], fslice[0..flen]);
                result.format_len = flen;
                got_format = true;
            }
        }
    }

    return result;
}

// -- Phase 6B: Safe extraction --

/// Extract all files from an archive to a destination directory.
/// Returns the number of files extracted.
///
/// Safety:
/// - Absolute paths are rejected
/// - Paths containing ".." traversal are rejected
/// - Only regular files and directories are extracted
/// - All output stays confined under dest_dir
pub fn extractAll(archive_path: []const u8, dest_dir: std.fs.Dir) !u32 {
    const a = try openArchive(archive_path);
    defer closeArchive(a);

    var extracted: u32 = 0;
    var entry: ?*ar.archive_entry = null;

    while (ar.archive_read_next_header(a, &entry) == ar.ARCHIVE_OK) {
        const e = entry.?;
        const raw_path = ar.archive_entry_pathname(e);
        if (raw_path == null) continue;
        const cstr: [*:0]const u8 = raw_path.?;
        const entry_path = std.mem.span(cstr);

        // Safety check: path must be confined (no absolute, no ..)
        if (!fs.isConfined(entry_path)) continue;

        const ftype = ar.archive_entry_filetype(e);
        const is_dir = (ftype & 0o170000) == 0o040000;
        const is_file = (ftype & 0o170000) == 0o100000;

        if (is_dir) {
            // Create directory
            dest_dir.makePath(entry_path) catch continue;
        } else if (is_file) {
            // Ensure parent directory exists
            if (std.fs.path.dirname(entry_path)) |parent| {
                dest_dir.makePath(parent) catch continue;
            }

            // Extract file
            const file = dest_dir.createFile(entry_path, .{ .truncate = true }) catch continue;
            defer file.close();

            var buf: [BLOCK_SIZE]u8 = undefined;
            while (true) {
                const n = ar.archive_read_data(a, &buf, buf.len);
                if (n <= 0) break;
                file.writeAll(buf[0..@intCast(n)]) catch break;
            }

            extracted += 1;
        }
        // Skip symlinks, fifos, devices, etc.
    }

    return extracted;
}

// -- Utility --

fn containsInsensitive(haystack: []const u8, needle: []const u8) bool {
    if (needle.len == 0) return true;
    if (needle.len > haystack.len) return false;
    var i: usize = 0;
    while (i <= haystack.len - needle.len) : (i += 1) {
        if (std.ascii.eqlIgnoreCase(haystack[i .. i + needle.len], needle)) return true;
    }
    return false;
}

// -- Tests --

test "open nonexistent archive returns error" {
    const result = list("/tmp/nonexistent.tar.gz", &[_]ArchiveEntry{});
    try std.testing.expectError(ArchiveError.OpenFailed, result);
}

test "list tar archive" {
    // Create a small tar via shell, then test
    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    // Create test files
    var f1 = try tmp_dir.dir.createFile("hello.txt", .{});
    try f1.writeAll("hello world");
    f1.close();
    var f2 = try tmp_dir.dir.createFile("data.bin", .{});
    try f2.writeAll("binary data here");
    f2.close();

    // Get real path for tar command
    var path_buf: [std.fs.max_path_bytes]u8 = undefined;
    const dir_path = try tmp_dir.dir.realpath(".", &path_buf);

    // Create tar archive using shell
    var tar_path_buf: [std.fs.max_path_bytes]u8 = undefined;
    const tar_path = std.fmt.bufPrint(&tar_path_buf, "{s}/test.tar", .{dir_path}) catch unreachable;

    // Use std.process.Child to run tar
    var cmd_buf: [std.fs.max_path_bytes * 2]u8 = undefined;
    const cmd = std.fmt.bufPrint(&cmd_buf, "tar cf {s} -C {s} hello.txt data.bin", .{ tar_path, dir_path }) catch unreachable;

    // Shell out to create tar
    const argv = [_][]const u8{ "sh", "-c", cmd };
    var child = std.process.Child.init(&argv, std.heap.page_allocator);
    const term = try child.spawnAndWait();
    if (term.Exited != 0) return error.TarFailed;

    // Now test listing
    var entries: [16]ArchiveEntry = undefined;
    const count = try list(tar_path, &entries);
    try std.testing.expect(count >= 2);

    // Test info
    const i = try info(tar_path);
    try std.testing.expect(i.file_count >= 2);

    // Test readEntry
    var buf: [256]u8 = undefined;
    const n = try readEntry(tar_path, "hello.txt", &buf);
    try std.testing.expectEqualStrings("hello world", buf[0..n]);

    // Test search
    var search_results: [16]ArchiveEntry = undefined;
    const scount = try search(tar_path, "hello", &search_results);
    try std.testing.expectEqual(@as(usize, 1), scount);

    // Test safe extraction
    var extract_tmp = std.testing.tmpDir(.{});
    defer extract_tmp.cleanup();
    const extracted = try extractAll(tar_path, extract_tmp.dir);
    try std.testing.expectEqual(@as(u32, 2), extracted);

    // Verify extracted content
    var verify_buf: [256]u8 = undefined;
    const vf = try extract_tmp.dir.openFile("hello.txt", .{});
    defer vf.close();
    const vn = try vf.readAll(&verify_buf);
    try std.testing.expectEqualStrings("hello world", verify_buf[0..vn]);
}

test "extractAll rejects unsafe paths" {
    // This test verifies the path safety logic directly
    try std.testing.expect(!fs.isConfined("../escape.txt"));
    try std.testing.expect(!fs.isConfined("/etc/passwd"));
    try std.testing.expect(!fs.isConfined("foo/../../etc/passwd"));
    try std.testing.expect(fs.isConfined("safe/path/file.txt"));
}
