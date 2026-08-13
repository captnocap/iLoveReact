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
const builtin = @import("builtin");

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
pub fn init(io: std.Io, environ: *const std.process.Environ.Map, app_name: []const u8) !void {
    if (data_dir != null) return;

    // Resolve XDG data home
    data_path_len = 0;
    if (environ.get("XDG_DATA_HOME")) |xdg| {
        if (xdg.len > 0) {
            const s = std.fmt.bufPrint(&data_path, "{s}/{s}", .{ xdg, app_name }) catch
                return error.NameTooLong;
            data_path_len = s.len;
        }
    }
    if (data_path_len == 0) {
        const home = environ.get("HOME") orelse return error.AppDataDirUnavailable;
        const s = std.fmt.bufPrint(&data_path, "{s}/.local/share/{s}", .{ home, app_name }) catch
            return error.NameTooLong;
        data_path_len = s.len;
    }

    // Create directory tree and open handle
    const path_slice = data_path[0..data_path_len];
    try std.Io.Dir.cwd().createDirPath(io, path_slice);
    data_dir = try std.Io.Dir.cwd().openDir(io, path_slice, .{ .iterate = true });
}

pub fn deinit(io: std.Io) void {
    if (data_dir) |d| d.close(io);
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
pub fn readText(io: std.Io, dir: std.Io.Dir, path: []const u8, buf: []u8) !usize {
    try checkPath(path);
    const file = try dir.openFile(io, path, .{});
    defer file.close(io);
    return file.readPositionalAll(io, buf, 0);
}

/// Write content to a file, creating or truncating as needed.
pub fn writeText(io: std.Io, dir: std.Io.Dir, path: []const u8, content: []const u8) !void {
    try checkPath(path);
    const file = try dir.createFile(io, path, .{ .truncate = true });
    defer file.close(io);
    try file.writeStreamingAll(io, content);
}

/// Write content atomically: write to a temp file, then rename over the target.
/// If the process crashes mid-write, the original file is untouched.
pub fn writeAtomic(io: std.Io, dir: std.Io.Dir, path: []const u8, content: []const u8) !void {
    try checkPath(path);

    // Build temp path
    var tmp_buf: [MAX_PATH]u8 = undefined;
    const tmp_path = std.fmt.bufPrint(&tmp_buf, "{s}.tmp", .{path}) catch
        return error.NameTooLong;

    // Write to temp file
    const file = try dir.createFile(io, tmp_path, .{
        .truncate = true,
        .permissions = replacementPermissions(io, dir, path, .default_file),
    });
    file.writeStreamingAll(io, content) catch |err| {
        file.close(io);
        dir.deleteFile(io, tmp_path) catch {};
        return err;
    };
    file.close(io);

    // Atomic rename (single syscall on POSIX)
    std.Io.Dir.rename(dir, tmp_path, dir, path, io) catch |err| {
        dir.deleteFile(io, tmp_path) catch {};
        return err;
    };
    try syncContainingDir(io, dir, path);
}

/// Compare current bytes with an expected snapshot. `null` means the caller
/// reviewed file absence. Conditional replacement uses this only after it has
/// atomically moved the live directory entry to a unique claimed path.
pub fn contentMatches(io: std.Io, dir: std.Io.Dir, path: []const u8, allocator: std.mem.Allocator, expected: ?[]const u8) !bool {
    try checkPath(path);
    const wanted = expected orelse return !pathExists(io, dir, path);
    const current = dir.readFileAlloc(io, path, allocator, .limited(wanted.len + 1)) catch return false;
    defer allocator.free(current);
    return std.mem.eql(u8, current, wanted);
}

pub const ReplacePreparedResult = enum { written, changed };
pub const FinalizePendingRecoveryResult = enum { finalized, changed };

pub const TargetWriteLock = struct {
    file: std.Io.File,
    io: std.Io,

    pub fn release(lock: *TargetWriteLock) void {
        lock.file.close(lock.io);
    }
};

/// Acquire the stable advisory lock shared by every conditional writer for one
/// target pathname. The lock file deliberately remains named between writes:
/// unlinking it while another process waits on the old inode would allow a
/// third process to create and lock a different inode under the same name.
pub fn acquireTargetWriteLock(io: std.Io, dir: std.Io.Dir, path: []const u8) !TargetWriteLock {
    try checkPath(path);
    var lock_buf: [MAX_PATH]u8 = undefined;
    const lock_path = std.fmt.bufPrint(&lock_buf, "{s}.write-lock", .{path}) catch return error.NameTooLong;
    const file = try dir.createFile(io, lock_path, .{
        .read = true,
        .truncate = false,
        .lock = .exclusive,
    });
    return .{ .file = file, .io = io };
}

/// Non-blocking sibling of `acquireTargetWriteLock`: returns `error.WouldBlock`
/// while another holder keeps the lock, so an interactive caller can bound its
/// wait instead of freezing behind a long-running maintenance transaction.
pub fn tryAcquireTargetWriteLock(io: std.Io, dir: std.Io.Dir, path: []const u8) !TargetWriteLock {
    try checkPath(path);
    var lock_buf: [MAX_PATH]u8 = undefined;
    const lock_path = std.fmt.bufPrint(&lock_buf, "{s}.write-lock", .{path}) catch return error.NameTooLong;
    const file = try dir.createFile(io, lock_path, .{
        .read = true,
        .truncate = false,
        .lock = .exclusive,
        .lock_nonblocking = true,
    });
    return .{ .file = file, .io = io };
}

/// Serialize atomic directory publication on the containing directory inode.
/// Unlike per-file conditional writes this creates no durable lock artifact,
/// so package catalogs and their safety backups never inventory coordination
/// files. Iteration capability forces a real directory fd rather than O_PATH.
pub fn acquireDirectoryPublishLock(io: std.Io, dir: std.Io.Dir, path: []const u8) !TargetWriteLock {
    try checkPath(path);
    var opened = try dir.openDir(io, path, .{ .iterate = true });
    const file: std.Io.File = .{ .handle = opened.handle, .flags = .{ .nonblocking = false } };
    file.lock(io, .exclusive) catch |err| {
        opened.close(io);
        return err;
    };
    // Ownership of the handle moves to TargetWriteLock; do not close `opened`.
    return .{ .file = file, .io = io };
}

fn targetWritePendingPath(buffer: []u8, path: []const u8) ![]const u8 {
    return std.fmt.bufPrint(buffer, "{s}.write-pending", .{path}) catch error.NameTooLong;
}

/// Unlike the convenience `pathExists`, this distinguishes definite absence
/// from permission, media, and other I/O failures. Transaction ownership must
/// fail closed on every result except `FileNotFound`.
fn fileExistsChecked(io: std.Io, dir: std.Io.Dir, path: []const u8) !bool {
    try checkPath(path);
    var file = dir.openFile(io, path, .{}) catch |err| switch (err) {
        error.FileNotFound => return false,
        else => return err,
    };
    file.close(io);
    return true;
}

fn createTargetWritePending(io: std.Io, dir: std.Io.Dir, pending_path: []const u8, prepared_path: []const u8) !void {
    var file = try dir.createFile(io, pending_path, .{ .truncate = false, .exclusive = true });
    // The marker's complete payload is the unique prepared path. Recovery may
    // proceed only when this identity matches, so an old process cannot adopt
    // a newer transaction's fixed per-target marker.
    file.writeStreamingAll(io, prepared_path) catch |err| {
        file.close(io);
        dir.deleteFile(io, pending_path) catch {};
        return err;
    };
    file.sync(io) catch |err| {
        file.close(io);
        dir.deleteFile(io, pending_path) catch {};
        return err;
    };
    file.close(io);
    try syncContainingDir(io, dir, pending_path);
}

fn clearTargetWritePending(io: std.Io, dir: std.Io.Dir, pending_path: []const u8) !void {
    try deleteFileDurable(io, dir, pending_path);
}

fn isPreparedPathForTarget(path: []const u8, prepared_path: []const u8) bool {
    if (prepared_path.len <= path.len + ".tmp.".len) return false;
    if (!std.mem.eql(u8, prepared_path[0..path.len], path)) return false;
    if (!std.mem.eql(u8, prepared_path[path.len .. path.len + ".tmp.".len], ".tmp.")) return false;
    for (prepared_path[path.len + ".tmp.".len ..]) |byte| {
        if (byte < '0' or byte > '9') return false;
    }
    return true;
}

/// Finish a validated recovery under the same stable lock used by writers.
/// Exact target bytes and marker ownership are rechecked before any artifact
/// is touched. The replay temp is retired first, its predecessor optionally,
/// and durable pending ownership last; a competing recovery therefore cannot
/// be left with an unmarked target vacancy.
pub fn finalizePendingRecovery(
    io: std.Io,
    dir: std.Io.Dir,
    path: []const u8,
    prepared_path: []const u8,
    allocator: std.mem.Allocator,
    expected_current: []const u8,
    retire_previous: bool,
) !FinalizePendingRecoveryResult {
    try checkPath(path);
    try checkPath(prepared_path);
    if (!isPreparedPathForTarget(path, prepared_path)) return .changed;
    var transaction_lock = try acquireTargetWriteLock(io, dir, path);
    defer transaction_lock.release();

    var pending_buf: [MAX_PATH]u8 = undefined;
    const pending_path = try targetWritePendingPath(&pending_buf, path);
    if (!(try fileExistsChecked(io, dir, pending_path))) {
        // Fully finalized is idempotent, but a missing marker must never
        // authorize deletion of surviving recovery artifacts.
        if (!(try contentMatches(io, dir, path, allocator, expected_current))) return .changed;
        if (try fileExistsChecked(io, dir, prepared_path)) return .changed;
        if (retire_previous) {
            var prior_buf: [MAX_PATH]u8 = undefined;
            const prior_path = std.fmt.bufPrint(&prior_buf, "{s}.previous", .{prepared_path}) catch return error.NameTooLong;
            if (try fileExistsChecked(io, dir, prior_path)) return .changed;
        }
        return .finalized;
    }

    if (!(try contentMatches(io, dir, pending_path, allocator, prepared_path))) return .changed;
    if (!(try contentMatches(io, dir, path, allocator, expected_current))) return .changed;

    deleteFileDurable(io, dir, prepared_path) catch |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    };
    if (retire_previous) {
        var prior_buf: [MAX_PATH]u8 = undefined;
        const prior_path = std.fmt.bufPrint(&prior_buf, "{s}.previous", .{prepared_path}) catch return error.NameTooLong;
        deleteFileDurable(io, dir, prior_path) catch |err| switch (err) {
            error.FileNotFound => {},
            else => return err,
        };
    }
    try clearTargetWritePending(io, dir, pending_path);
    return .finalized;
}

fn restoreClaimedBackup(
    io: std.Io,
    dir: std.Io.Dir,
    backup_path: []const u8,
    path: []const u8,
    pending_path: []const u8,
) bool {
    std.Io.Dir.renamePreserve(dir, backup_path, dir, path, io) catch return false;
    syncContainingDir(io, dir, path) catch return false;
    clearTargetWritePending(io, dir, pending_path) catch return false;
    return true;
}

/// Conditionally install an already-written and synchronized temp file.
///
/// This does not compare and then overwrite. For an existing target it first
/// atomically claims the current directory entry by moving it to `backup_path`
/// with no-replace semantics, validates those claimed bytes, and installs the
/// temp with another no-replace rename. Competing writers therefore cannot
/// both validate the same snapshot and then silently overwrite one another.
/// The caller still owns `temp_path` when `.changed` is returned.
pub fn replacePreparedFileIfUnchanged(
    io: std.Io,
    dir: std.Io.Dir,
    path: []const u8,
    temp_path: []const u8,
    backup_path: []const u8,
    allocator: std.mem.Allocator,
    expected: ?[]const u8,
) !ReplacePreparedResult {
    return replacePreparedFileIfUnchangedWithPolicy(
        io,
        dir,
        path,
        temp_path,
        backup_path,
        allocator,
        expected,
        false,
        null,
    );
}

/// Recovery uses the same serialized compare/install protocol but may enter
/// while a durable pending marker from the crashed owner is present. In that
/// mode the marker remains armed until the caller validates and retires the
/// original claim artifacts.
pub fn replacePreparedFileIfUnchangedWithPolicy(
    io: std.Io,
    dir: std.Io.Dir,
    path: []const u8,
    temp_path: []const u8,
    backup_path: []const u8,
    allocator: std.mem.Allocator,
    expected: ?[]const u8,
    allow_pending_recovery: bool,
    recovery_owner_path: ?[]const u8,
) !ReplacePreparedResult {
    try checkPath(path);
    try checkPath(temp_path);
    try checkPath(backup_path);
    var transaction_lock = try acquireTargetWriteLock(io, dir, path);
    defer transaction_lock.release();
    var pending_buf: [MAX_PATH]u8 = undefined;
    const pending_path = try targetWritePendingPath(&pending_buf, path);
    const pending_exists = try fileExistsChecked(io, dir, pending_path);
    if (pending_exists and !allow_pending_recovery) return .changed;
    // Recovery authority comes from durable ownership left by the interrupted
    // writer. A stale recovery process must never mint a fresh marker after a
    // different process has already finalized and retired that transaction.
    if (allow_pending_recovery) {
        if (!pending_exists) return .changed;
        const owner_path = recovery_owner_path orelse return .changed;
        try checkPath(owner_path);
        if (!isPreparedPathForTarget(path, owner_path)) return .changed;
        if (!(try contentMatches(io, dir, pending_path, allocator, owner_path))) return .changed;
    } else if (recovery_owner_path != null) {
        return .changed;
    }

    if (expected == null) {
        // A crashed existing-file writer may have released its OS lock while
        // the target remains durably claimed at a unique backup pathname. The
        // fixed pending marker distinguishes that internal vacancy from true
        // reviewed absence until startup recovery restores or retires it.
        std.Io.Dir.renamePreserve(dir, temp_path, dir, path, io) catch |err| switch (err) {
            error.PathAlreadyExists => return .changed,
            else => return err,
        };
        try syncContainingDir(io, dir, path);
        return .written;
    }

    if (!allow_pending_recovery) try createTargetWritePending(io, dir, pending_path, temp_path);

    std.Io.Dir.renamePreserve(dir, path, dir, backup_path, io) catch |err| switch (err) {
        error.FileNotFound, error.PathAlreadyExists => {
            if (!allow_pending_recovery) try clearTargetWritePending(io, dir, pending_path);
            return .changed;
        },
        else => {
            if (!allow_pending_recovery) clearTargetWritePending(io, dir, pending_path) catch {};
            return err;
        },
    };
    syncContainingDir(io, dir, backup_path) catch |err| {
        if (allow_pending_recovery) {
            std.Io.Dir.renamePreserve(dir, backup_path, dir, path, io) catch {};
            syncContainingDir(io, dir, path) catch {};
        } else {
            _ = restoreClaimedBackup(io, dir, backup_path, path, pending_path);
        }
        return err;
    };

    if (!(try contentMatches(io, dir, backup_path, allocator, expected))) {
        std.Io.Dir.renamePreserve(dir, backup_path, dir, path, io) catch |err| switch (err) {
            // A competing writer installed a new canonical file while the
            // reviewed bytes were claimed. Keep both: its file at `path` and
            // the displaced bytes at the unique backup path.
            error.PathAlreadyExists => {
                try syncContainingDir(io, dir, backup_path);
                return .changed;
            },
            else => return err,
        };
        try syncContainingDir(io, dir, path);
        if (!allow_pending_recovery) try clearTargetWritePending(io, dir, pending_path);
        return .changed;
    }

    std.Io.Dir.renamePreserve(dir, temp_path, dir, path, io) catch |err| switch (err) {
        error.PathAlreadyExists => {
            // Do not overwrite the winner. The reviewed prior version remains
            // at backup_path for recovery because path is no longer vacant.
            try syncContainingDir(io, dir, backup_path);
            return .changed;
        },
        else => {
            // Best-effort restore after an I/O failure. If another writer has
            // occupied path, leaving the unique backup is safer than replacing
            // either set of bytes.
            if (allow_pending_recovery) {
                std.Io.Dir.renamePreserve(dir, backup_path, dir, path, io) catch {};
                syncContainingDir(io, dir, path) catch {};
            } else {
                _ = restoreClaimedBackup(io, dir, backup_path, path, pending_path);
            }
            return err;
        },
    };

    // Persist both the installed proposal and its recoverable predecessor.
    // The predecessor deliberately stays named: an external editor may have
    // opened that inode before our claim and can still write through its fd.
    // Keeping the versioned backup means those racing bytes are recoverable
    // instead of being silently unlinked.
    try syncContainingDir(io, dir, path);
    if (!allow_pending_recovery) try clearTargetWritePending(io, dir, pending_path);
    return .written;
}

/// Make a completed rename durable by synchronizing the directory entry that
/// owns `path`. A file fsync alone does not guarantee that the rename survives
/// a sudden power loss.
pub fn syncContainingDir(io: std.Io, dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    const parent_path = std.fs.path.dirname(path) orelse ".";
    // Zig opens non-iterable directories with O_PATH on Linux; fsync rejects
    // that descriptor. Iteration capability gives us a real directory fd.
    var parent = try dir.openDir(io, parent_path, .{ .iterate = true });
    defer parent.close(io);
    const parent_file: std.Io.File = .{
        .handle = parent.handle,
        .flags = .{ .nonblocking = false },
    };
    try parent_file.sync(io);
}

/// Delete a file.
pub fn deleteFile(io: std.Io, dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    try dir.deleteFile(io, path);
}

/// Delete one file and persist removal of its directory entry. Recovery code
/// uses this to disarm replay markers only after the restored source is durable.
pub fn deleteFileDurable(io: std.Io, dir: std.Io.Dir, path: []const u8) !void {
    try deleteFile(io, dir, path);
    try syncContainingDir(io, dir, path);
}

/// Check if a path exists (file or directory).
pub fn pathExists(io: std.Io, dir: std.Io.Dir, path: []const u8) bool {
    if (!isConfined(path)) return false;
    _ = dir.statFile(io, path, .{}) catch return false;
    return true;
}

/// Preserve the permission mode of a file replaced through temp+rename. A new
/// path uses the caller's ordinary creation mode.
pub fn replacementPermissions(
    io: std.Io,
    dir: std.Io.Dir,
    path: []const u8,
    default_permissions: std.Io.File.Permissions,
) std.Io.File.Permissions {
    const facts = dir.statFile(io, path, .{}) catch return default_permissions;
    return if (facts.kind == .file) facts.permissions else default_permissions;
}

pub const DirectoryFingerprint = [std.crypto.hash.sha2.Sha256.digest_length]u8;

fn collectDirectoryPaths(
    io: std.Io,
    root: std.Io.Dir,
    allocator: std.mem.Allocator,
) !std.ArrayList([]u8) {
    var paths: std.ArrayList([]u8) = .empty;
    errdefer {
        for (paths.items) |path| allocator.free(path);
        paths.deinit(allocator);
    }
    var walker = try root.walk(allocator);
    defer walker.deinit();
    while (try walker.next(io)) |entry| {
        try paths.append(allocator, try allocator.dupe(u8, entry.path));
    }
    std.mem.sort([]u8, paths.items, {}, struct {
        fn lessThan(_: void, lhs: []u8, rhs: []u8) bool {
            return std.mem.lessThan(u8, lhs, rhs);
        }
    }.lessThan);
    return paths;
}

fn hashTreeField(hasher: *std.crypto.hash.sha2.Sha256, value: []const u8) void {
    var length: [8]u8 = undefined;
    std.mem.writeInt(u64, &length, value.len, .little);
    hasher.update(&length);
    hasher.update(value);
}

fn hashTreeU64(hasher: *std.crypto.hash.sha2.Sha256, value: u64) void {
    var encoded: [8]u8 = undefined;
    std.mem.writeInt(u64, &encoded, value, .little);
    hasher.update(&encoded);
}

fn hashTreeMode(hasher: *std.crypto.hash.sha2.Sha256, permissions: std.Io.File.Permissions) void {
    var mode: [8]u8 = undefined;
    std.mem.writeInt(u64, &mode, @intFromEnum(permissions), .little);
    hasher.update(&mode);
}

/// Hash every relative path, entry kind, permission mode and file byte. This is
/// the optimistic-concurrency identity checked under the package target lock
/// immediately before EXCHANGE; mtimes/inodes are intentionally excluded.
pub fn directoryFingerprint(
    io: std.Io,
    dir: std.Io.Dir,
    path: []const u8,
    allocator: std.mem.Allocator,
) !DirectoryFingerprint {
    try checkPath(path);
    const root_stat = try dir.statFile(io, path, .{});
    if (root_stat.kind != .directory) return error.NotDir;
    var root = try dir.openDir(io, path, .{ .iterate = true });
    defer root.close(io);
    var paths = try collectDirectoryPaths(io, root, allocator);
    defer {
        for (paths.items) |entry_path| allocator.free(entry_path);
        paths.deinit(allocator);
    }

    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    hasher.update("RJDIR1");
    hashTreeMode(&hasher, root_stat.permissions);
    var buffer: [64 * 1024]u8 = undefined;
    for (paths.items) |entry_path| {
        const entry_stat = try root.statFile(io, entry_path, .{});
        hashTreeField(&hasher, entry_path);
        hashTreeMode(&hasher, entry_stat.permissions);
        switch (entry_stat.kind) {
            .directory => hasher.update("D"),
            .file => {
                hasher.update("F");
                hashTreeU64(&hasher, entry_stat.size);
                var file = try root.openFile(io, entry_path, .{});
                defer file.close(io);
                var offset: u64 = 0;
                while (true) {
                    const count = try file.readPositional(io, &.{&buffer}, offset);
                    if (count == 0) break;
                    hasher.update(buffer[0..count]);
                    offset += count;
                }
            },
            else => return error.OperationUnsupported,
        }
    }
    var digest: DirectoryFingerprint = undefined;
    hasher.final(&digest);
    return digest;
}

fn syncDirectoryPath(io: std.Io, dir: std.Io.Dir, path: []const u8) !void {
    var opened = try dir.openDir(io, path, .{ .iterate = true });
    defer opened.close(io);
    const file: std.Io.File = .{ .handle = opened.handle, .flags = .{ .nonblocking = false } };
    try file.sync(io);
}

/// Clone one package tree without translating its bytes or permission modes.
/// Files also retain timestamps through updateFile. The target must not exist.
pub fn cloneDirectoryExact(
    io: std.Io,
    dir: std.Io.Dir,
    source_path: []const u8,
    target_path: []const u8,
    allocator: std.mem.Allocator,
) !void {
    try checkPath(source_path);
    try checkPath(target_path);
    if (pathExists(io, dir, target_path)) return error.PathAlreadyExists;
    const root_stat = try dir.statFile(io, source_path, .{});
    if (root_stat.kind != .directory) return error.NotDir;
    var source = try dir.openDir(io, source_path, .{ .iterate = true });
    defer source.close(io);
    var paths = try collectDirectoryPaths(io, source, allocator);
    defer {
        for (paths.items) |entry_path| allocator.free(entry_path);
        paths.deinit(allocator);
    }

    try dir.createDir(io, target_path, .default_dir);
    errdefer dir.deleteTree(io, target_path) catch {};
    for (paths.items) |entry_path| {
        const entry_stat = try source.statFile(io, entry_path, .{});
        const target_entry = try std.fs.path.join(allocator, &.{ target_path, entry_path });
        defer allocator.free(target_entry);
        switch (entry_stat.kind) {
            .directory => try dir.createDir(io, target_entry, .default_dir),
            .file => {
                _ = try std.Io.Dir.updateFile(source, io, entry_path, dir, target_entry, .{});
                var copied = try dir.openFile(io, target_entry, .{});
                defer copied.close(io);
                try copied.sync(io);
            },
            else => return error.OperationUnsupported,
        }
    }
    // Children were created while directories were writable. Apply authored
    // modes deepest-first only after their contents and directory entries sync.
    var index = paths.items.len;
    while (index > 0) {
        index -= 1;
        const entry_path = paths.items[index];
        const entry_stat = try source.statFile(io, entry_path, .{});
        if (entry_stat.kind != .directory) continue;
        const target_entry = try std.fs.path.join(allocator, &.{ target_path, entry_path });
        defer allocator.free(target_entry);
        try syncDirectoryPath(io, dir, target_entry);
        try dir.setFilePermissions(io, target_entry, entry_stat.permissions, .{});
    }
    try syncDirectoryPath(io, dir, target_path);
    try dir.setFilePermissions(io, target_path, root_stat.permissions, .{});
    try syncContainingDir(io, dir, target_path);
}

pub const InstallPreparedDirectoryError = error{
    PathNotConfined,
    FileNotFound,
    PathAlreadyExists,
    NotDir,
    CrossDevice,
    OperationUnsupported,
    NameTooLong,
    TargetChanged,
    Unexpected,
};

/// Publish one fully prepared directory tree without exposing a mixed revision.
///
/// A first install uses a no-replace rename, so a manifestless recovery/orphan
/// directory that appeared after planning is never overwritten. Replacing an
/// existing tree uses Linux renameat2(RENAME_EXCHANGE): after the single syscall
/// `target_path` is the complete prepared revision and `prepared_path` owns the
/// complete predecessor. The caller deliberately keeps that predecessor until
/// it has read back and validated the installed tree; calling this function a
/// second time exchanges the two complete trees back for deterministic rollback.
pub fn installPreparedDirectoryAtomic(
    io: std.Io,
    dir: std.Io.Dir,
    prepared_path: []const u8,
    target_path: []const u8,
    replace_existing: bool,
) InstallPreparedDirectoryError!void {
    return installPreparedDirectoryAtomicIfMatches(io, dir, prepared_path, target_path, replace_existing, null);
}

pub fn installPreparedDirectoryAtomicIfMatches(
    io: std.Io,
    dir: std.Io.Dir,
    prepared_path: []const u8,
    target_path: []const u8,
    replace_existing: bool,
    expected_target: ?DirectoryFingerprint,
) InstallPreparedDirectoryError!void {
    try checkPath(prepared_path);
    try checkPath(target_path);

    const target_parent = std.fs.path.dirname(target_path) orelse ".";
    var target_lock = acquireDirectoryPublishLock(io, dir, target_parent) catch return error.Unexpected;
    defer target_lock.release();

    const prepared_stat = dir.statFile(io, prepared_path, .{}) catch return error.FileNotFound;
    if (prepared_stat.kind != .directory) return error.NotDir;

    if (!replace_existing) {
        if (pathExists(io, dir, target_path)) return error.PathAlreadyExists;
        std.Io.Dir.renamePreserve(dir, prepared_path, dir, target_path, io) catch |err| switch (err) {
            error.FileNotFound => return error.FileNotFound,
            error.PathAlreadyExists, error.DirNotEmpty => return error.PathAlreadyExists,
            error.NotDir, error.IsDir => return error.NotDir,
            error.CrossDevice => return error.CrossDevice,
            error.NameTooLong => return error.NameTooLong,
            else => return error.Unexpected,
        };
        syncContainingDir(io, dir, target_path) catch return error.Unexpected;
        return;
    }

    const target_stat = dir.statFile(io, target_path, .{}) catch return error.FileNotFound;
    if (target_stat.kind != .directory) return error.NotDir;
    if (expected_target) |expected| {
        const current = directoryFingerprint(io, dir, target_path, std.heap.page_allocator) catch return error.Unexpected;
        if (!std.mem.eql(u8, &expected, &current)) return error.TargetChanged;
    }
    if (builtin.os.tag != .linux) return error.OperationUnsupported;

    const linux = std.os.linux;
    const prepared_z = std.posix.toPosixPath(prepared_path) catch return error.NameTooLong;
    const target_z = std.posix.toPosixPath(target_path) catch return error.NameTooLong;
    switch (linux.errno(linux.renameat2(
        dir.handle,
        &prepared_z,
        dir.handle,
        &target_z,
        .{ .EXCHANGE = true },
    ))) {
        .SUCCESS => {},
        .NOENT => return error.FileNotFound,
        .EXIST, .NOTEMPTY => return error.PathAlreadyExists,
        .NOTDIR, .ISDIR => return error.NotDir,
        .XDEV => return error.CrossDevice,
        .NOSYS, .OPNOTSUPP => return error.OperationUnsupported,
        else => return error.Unexpected,
    }
    syncContainingDir(io, dir, target_path) catch return error.Unexpected;
    if (!std.mem.eql(u8, std.fs.path.dirname(prepared_path) orelse ".", std.fs.path.dirname(target_path) orelse ".")) {
        syncContainingDir(io, dir, prepared_path) catch return error.Unexpected;
    }
}

// -- Directory operations --

/// Create a single directory. Parent must exist.
pub fn makeDir(io: std.Io, dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    try dir.createDir(io, path, .default_dir);
}

/// Create a directory and all missing parents.
pub fn makePath(io: std.Io, dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    try dir.createDirPath(io, path);
}

/// Create every missing directory component and fsync the parent immediately
/// after each new edge. A final-parent fsync alone is insufficient when several
/// ancestors were born in the same first-run write.
pub fn makePathDurable(io: std.Io, dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    var current: [MAX_PATH]u8 = undefined;
    var current_len: usize = 0;
    var segments = std.mem.splitScalar(u8, path, '/');
    while (segments.next()) |segment| {
        if (segment.len == 0 or std.mem.eql(u8, segment, ".")) continue;
        if (current_len != 0) {
            if (current_len == current.len) return error.NameTooLong;
            current[current_len] = '/';
            current_len += 1;
        }
        if (segment.len > current.len - current_len) return error.NameTooLong;
        @memcpy(current[current_len..][0..segment.len], segment);
        current_len += segment.len;
        const current_path = current[0..current_len];
        var created = true;
        dir.createDir(io, current_path, .default_dir) catch |err| switch (err) {
            error.PathAlreadyExists => created = false,
            else => return err,
        };
        if (!created) {
            var existing = try dir.openDir(io, current_path, .{});
            existing.close(io);
            continue;
        }
        try syncContainingDir(io, dir, current_path);
    }
}

/// List the contents of a directory. Returns the number of entries written to `out`.
/// If there are more entries than out.len, only the first out.len are returned.
pub fn listDir(io: std.Io, dir: std.Io.Dir, path: []const u8, out: []DirEntry) !usize {
    try checkPath(path);
    var sub = try dir.openDir(io, path, .{ .iterate = true });
    defer sub.close(io);
    return iterateDir(io, sub, out);
}

/// List the contents of an already-open directory handle.
pub fn listOpenDir(io: std.Io, dir: std.Io.Dir, out: []DirEntry) !usize {
    // Re-open to get a fresh iterator without consuming the caller's handle
    var copy = try std.Io.Dir.openDir(dir, io, ".", .{ .iterate = true });
    defer copy.close(io);
    return iterateDir(io, copy, out);
}

fn iterateDir(io: std.Io, dir: std.Io.Dir, out: []DirEntry) !usize {
    var iter = dir.iterate();
    var count: usize = 0;
    while (try iter.next(io)) |entry| {
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
pub fn deleteDir(io: std.Io, dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    try dir.deleteDir(io, path);
}

/// Recursively delete a directory and all its contents.
pub fn deleteTree(io: std.Io, dir: std.Io.Dir, path: []const u8) !void {
    try checkPath(path);
    try dir.deleteTree(io, path);
}

// -- Stat --

/// Get metadata for a file or directory.
pub fn statPath(io: std.Io, dir: std.Io.Dir, path: []const u8) !FileStat {
    try checkPath(path);
    const s = try dir.statFile(io, path, .{});
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
    try writeText(std.testing.io, tmp.dir, "test.txt", content);

    var buf: [256]u8 = undefined;
    const n = try readText(std.testing.io, tmp.dir, "test.txt", &buf);
    try std.testing.expectEqualStrings(content, buf[0..n]);

    // Stat
    const s = try statPath(std.testing.io, tmp.dir, "test.txt");
    try std.testing.expectEqual(@as(u64, content.len), s.size);
    try std.testing.expectEqual(std.Io.File.Kind.file, s.kind);

    // Delete
    try deleteFile(std.testing.io, tmp.dir, "test.txt");
    try std.testing.expect(!pathExists(std.testing.io, tmp.dir, "test.txt"));
}

test "atomic write" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    // Write original
    try writeText(std.testing.io, tmp.dir, "data.txt", "version1");

    // Atomic overwrite
    try writeAtomic(std.testing.io, tmp.dir, "data.txt", "version2");

    var buf: [256]u8 = undefined;
    const n = try readText(std.testing.io, tmp.dir, "data.txt", &buf);
    try std.testing.expectEqualStrings("version2", buf[0..n]);

    // Temp file should not remain
    try std.testing.expect(!pathExists(std.testing.io, tmp.dir, "data.txt.tmp"));
}

test "contentMatches distinguishes reviewed bytes and reviewed absence" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    try std.testing.expect(try contentMatches(std.testing.io, tmp.dir, "page.md", std.testing.allocator, null));
    try writeText(std.testing.io, tmp.dir, "page.md", "reviewed");
    try std.testing.expect(!(try contentMatches(std.testing.io, tmp.dir, "page.md", std.testing.allocator, null)));
    try std.testing.expect(try contentMatches(std.testing.io, tmp.dir, "page.md", std.testing.allocator, "reviewed"));
    try std.testing.expect(!(try contentMatches(std.testing.io, tmp.dir, "page.md", std.testing.allocator, "changed")));
}

test "directory operations" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    // makePath creates nested dirs
    try makePath(std.testing.io, tmp.dir, "a/b/c");
    try std.testing.expect(pathExists(std.testing.io, tmp.dir, "a/b/c"));

    // Write files in subdirectory
    try writeText(std.testing.io, tmp.dir, "a/b/c/one.txt", "1");
    try writeText(std.testing.io, tmp.dir, "a/b/c/two.txt", "2");

    // listDir
    var entries: [16]DirEntry = undefined;
    const count = try listDir(std.testing.io, tmp.dir, "a/b/c", &entries);
    try std.testing.expectEqual(@as(usize, 2), count);

    // deleteTree
    try deleteTree(std.testing.io, tmp.dir, "a");
    try std.testing.expect(!pathExists(std.testing.io, tmp.dir, "a"));
}

test "path confinement enforcement" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    // Absolute path rejected
    try std.testing.expectError(error.PathNotConfined, readText(std.testing.io, tmp.dir, "/etc/passwd", &[_]u8{}));

    // Traversal rejected
    try std.testing.expectError(error.PathNotConfined, writeText(std.testing.io, tmp.dir, "../escape.txt", "bad"));

    // Empty rejected
    try std.testing.expectError(error.PathNotConfined, deleteFile(std.testing.io, tmp.dir, ""));
}
