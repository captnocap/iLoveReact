//! Workspace sync protocol — frame builder + parser + filesystem apply.
//!
//! Used by tui/sync-host.ts (host-side) and the guest's
//! scripts/claudewrap-sync-guest.py to keep a directory in sync between
//! the host and a firecracker VM. All byte handling stays Zig-side so
//! we never have to round-trip binary payloads through V8 strings.
//!
//! Wire format (matches scripts/claudewrap-sync-guest.py):
//!
//!   ┌───────┬───────────────┬───────────┐
//!   │ 4 B   │ header (UTF8) │ payload   │
//!   │ NBO   │ ending in \n  │ (size in  │
//!   │ hlen  │               │  header)  │
//!   └───────┴───────────────┴───────────┘
//!
//! Headers:
//!   SET  <rel> <size>\n   — payload is file content
//!   DEL  <rel>\n          — no payload
//!   DIR  <rel>\n          — no payload (mkdir -p)
//!   INIT <dest> <size>\n  — payload is workspace tar
//!   PING / PONG\n         — liveness, no payload

const std = @import("std");

const FRAME_LEN_BYTES = 4;
const MAX_HEADER_LEN = 4 * 1024;       // sanity bound
const MAX_INLINE_PAYLOAD = 512 * 1024 * 1024; // 512MB — workspace tar fits

// ────────────────────────────────────────────────────────────────────
// Frame BUILDERS — format outbound bytes into a writer.
// All builders allocate at most one transient header buffer + read
// payload from disk in chunks, so a 200MB SET frame doesn't fragment
// the heap.
// ────────────────────────────────────────────────────────────────────

/// Write a SET/INIT-style frame: 4B length, header line, then `size`
/// bytes of payload streamed from `payload_fd`.
pub fn writeFileFrame(
    writer: anytype,
    op: []const u8,
    rel: []const u8,
    payload_fd: std.posix.fd_t,
    payload_size: u64,
) !void {
    var header_buf: [256]u8 = undefined;
    const header = try std.fmt.bufPrint(&header_buf, "{s} {s} {d}\n", .{ op, rel, payload_size });
    try writeLenPrefixed(writer, header);
    try streamFd(writer, payload_fd, payload_size);
}

/// Write a header-only frame (DEL/DIR/PING).
pub fn writeMsgFrame(
    writer: anytype,
    op: []const u8,
    arg: []const u8,
) !void {
    var header_buf: [512]u8 = undefined;
    const header = if (arg.len > 0)
        try std.fmt.bufPrint(&header_buf, "{s} {s}\n", .{ op, arg })
    else
        try std.fmt.bufPrint(&header_buf, "{s}\n", .{op});
    try writeLenPrefixed(writer, header);
}

/// Convenience: SET frame for a file at `local_path`, with the given
/// rel path. Opens, stats, streams. Closes the fd on return.
pub fn writeSetFromFile(
    writer: anytype,
    rel: []const u8,
    local_path: []const u8,
) !void {
    const fd = try std.posix.open(local_path, .{ .ACCMODE = .RDONLY }, 0);
    defer std.posix.close(fd);
    const st = try std.posix.fstat(fd);
    if (st.size < 0) return error.NegativeFileSize;
    const size: u64 = @intCast(st.size);
    try writeFileFrame(writer, "SET", rel, fd, size);
}

/// Build a workspace tar (via `git ls-files | tar`) and ship it as a
/// single INIT frame. Filters out paths under DENY_PATTERNS and
/// missing files (tracked-but-deleted entries break tar otherwise).
pub fn writeInitTar(
    writer: anytype,
    allocator: std.mem.Allocator,
    cwd: []const u8,
    dest: []const u8,
) !void {
    const tar_bytes = try buildTarBytes(allocator, cwd);
    defer allocator.free(tar_bytes);

    var header_buf: [256]u8 = undefined;
    const header = try std.fmt.bufPrint(&header_buf, "INIT {s} {d}\n", .{ dest, tar_bytes.len });
    try writeLenPrefixed(writer, header);
    try writer.writeAll(tar_bytes);
}

// ── shared helpers ──────────────────────────────────────────────────

fn writeLenPrefixed(writer: anytype, header: []const u8) !void {
    if (header.len > MAX_HEADER_LEN) return error.HeaderTooLong;
    var lenbuf: [4]u8 = undefined;
    std.mem.writeInt(u32, &lenbuf, @intCast(header.len), .big);
    try writer.writeAll(&lenbuf);
    try writer.writeAll(header);
}

fn streamFd(writer: anytype, fd: std.posix.fd_t, total: u64) !void {
    var buf: [64 * 1024]u8 = undefined;
    var remaining = total;
    while (remaining > 0) {
        const want = @min(buf.len, remaining);
        const n = try std.posix.read(fd, buf[0..want]);
        if (n == 0) return error.UnexpectedEof;
        try writer.writeAll(buf[0..n]);
        remaining -= @intCast(n);
    }
}

// ────────────────────────────────────────────────────────────────────
// Tar build — uses `git ls-files` + `tar` to capture the working tree.
// ────────────────────────────────────────────────────────────────────

// Paths under any of these segments are skipped both in the initial
// tar and in runtime inotify fanout. Backstop for non-git workspaces
// and for vendored deps that aren't in .gitignore.
const DENY_SEGMENTS = [_][]const u8{
    ".git",       ".zig-cache", "node_modules", "zig-out",
    "target",     "deps",       "archive",      "images",
    ".cache",     "__pycache__", ".next",        "dist",
    "build",      ".DS_Store",
};

pub fn isDenied(rel_path: []const u8) bool {
    if (rel_path.len == 0) return true;
    var it = std.mem.splitScalar(u8, rel_path, '/');
    while (it.next()) |seg| {
        if (seg.len == 0) continue;
        if (std.mem.endsWith(u8, seg, ".pyc")) return true;
        for (DENY_SEGMENTS) |d| {
            if (std.mem.eql(u8, seg, d)) return true;
        }
    }
    return false;
}

fn buildTarBytes(allocator: std.mem.Allocator, cwd: []const u8) ![]u8 {
    // Step 1: `git ls-files -z --cached --others --exclude-standard`
    const ls = try runCapture(allocator, &.{
        "git", "-C", cwd, "ls-files", "-z",
        "--cached", "--others", "--exclude-standard",
    }, null);
    defer allocator.free(ls);

    // Step 2: filter — drop denied + missing files. Reuse buffer.
    var kept: std.ArrayList(u8) = .empty;
    defer kept.deinit(allocator);

    var start: usize = 0;
    for (ls, 0..) |b, i| {
        if (b != 0) continue;
        if (i > start) {
            const path_rel = ls[start..i];
            if (!isDenied(path_rel) and existsUnder(cwd, path_rel)) {
                try kept.appendSlice(allocator, path_rel);
                try kept.append(allocator, 0);
            }
        }
        start = i + 1;
    }

    // Step 3: `tar -cf - -C <cwd> --ignore-failed-read --null --no-recursion --files-from -`
    return try runCapture(allocator, &.{
        "tar",                 "-cf",                 "-",
        "-C",                  cwd,                   "--ignore-failed-read",
        "--null",              "--no-recursion",      "--files-from",
        "-",
    }, kept.items);
}

fn existsUnder(cwd: []const u8, rel: []const u8) bool {
    var pathbuf: [4096]u8 = undefined;
    const full = std.fmt.bufPrint(&pathbuf, "{s}/{s}", .{ cwd, rel }) catch return false;
    std.fs.accessAbsolute(full, .{}) catch return false;
    return true;
}

fn runCapture(
    allocator: std.mem.Allocator,
    argv: []const []const u8,
    stdin_bytes: ?[]const u8,
) ![]u8 {
    var child = std.process.Child.init(argv, allocator);
    child.stdin_behavior = if (stdin_bytes != null) .Pipe else .Ignore;
    child.stdout_behavior = .Pipe;
    child.stderr_behavior = .Ignore;
    try child.spawn();

    // Feed stdin in a separate "thread of control" if provided.
    if (stdin_bytes) |bytes| {
        var stdin = child.stdin.?;
        stdin.writeAll(bytes) catch {};
        stdin.close();
        child.stdin = null;
    }

    var stdout_buf: std.ArrayList(u8) = .empty;
    errdefer stdout_buf.deinit(allocator);

    var read_buf: [64 * 1024]u8 = undefined;
    while (true) {
        const n = child.stdout.?.read(&read_buf) catch break;
        if (n == 0) break;
        try stdout_buf.appendSlice(allocator, read_buf[0..n]);
    }

    const term = try child.wait();
    // tar can exit 1 if some files vanished mid-archive; accept if we
    // got bytes out.
    switch (term) {
        .Exited => |code| {
            if (code != 0 and stdout_buf.items.len == 0) return error.ChildFailed;
        },
        else => return error.ChildAbnormalExit,
    }
    return stdout_buf.toOwnedSlice(allocator);
}

// ────────────────────────────────────────────────────────────────────
// Inbound parser — feeds bytes received over the wire, applies
// SET/DEL/DIR/INIT frames to a workspace root. Stateful across calls
// so partial frames buffer until complete.
// ────────────────────────────────────────────────────────────────────

pub const InboundParser = struct {
    allocator: std.mem.Allocator,
    root: []const u8, // borrowed; caller keeps alive
    buf: std.ArrayList(u8),

    pub fn init(allocator: std.mem.Allocator, root: []const u8) InboundParser {
        return .{
            .allocator = allocator,
            .root = root,
            .buf = .{},
        };
    }

    pub fn deinit(self: *InboundParser) void {
        self.buf.deinit(self.allocator);
    }

    /// Append received bytes, parse and apply as many complete frames
    /// as fit. Partial frames stay in buf for next call.
    pub fn feed(self: *InboundParser, bytes: []const u8) void {
        self.buf.appendSlice(self.allocator, bytes) catch return;
        while (true) {
            if (self.buf.items.len < FRAME_LEN_BYTES) return;
            const hlen: usize = @intCast(std.mem.readInt(u32, self.buf.items[0..4], .big));
            if (hlen == 0 or hlen > MAX_HEADER_LEN) {
                // Corrupt stream — drop everything to resync.
                self.buf.clearRetainingCapacity();
                return;
            }
            if (self.buf.items.len < FRAME_LEN_BYTES + hlen) return;

            const header = std.mem.trimRight(u8, self.buf.items[FRAME_LEN_BYTES .. FRAME_LEN_BYTES + hlen], "\n");
            const payload_size = parsePayloadSize(header);
            if (payload_size > MAX_INLINE_PAYLOAD) {
                self.buf.clearRetainingCapacity();
                return;
            }
            const total = FRAME_LEN_BYTES + hlen + payload_size;
            if (self.buf.items.len < total) return;

            const payload = self.buf.items[FRAME_LEN_BYTES + hlen .. total];
            self.applyFrame(header, payload);

            // Shift remaining bytes to the front. For small drains this
            // is cheap; for big payloads we already absorbed them.
            const remaining = self.buf.items.len - total;
            if (remaining > 0) {
                std.mem.copyForwards(u8, self.buf.items[0..remaining], self.buf.items[total..]);
            }
            self.buf.shrinkRetainingCapacity(remaining);
        }
    }

    fn applyFrame(self: *InboundParser, header: []const u8, payload: []const u8) void {
        // Parse `OP <args...>` — first token is the op, remainder is args.
        const space = std.mem.indexOfScalar(u8, header, ' ') orelse header.len;
        const op = header[0..space];

        if (std.mem.eql(u8, op, "SET")) {
            const rest = if (space < header.len) header[space + 1 ..] else "";
            const rel = firstToken(rest);
            if (rel.len == 0 or isDenied(rel)) return;
            self.writeFile(rel, payload);
        } else if (std.mem.eql(u8, op, "DEL")) {
            const rel = firstToken(if (space < header.len) header[space + 1 ..] else "");
            if (rel.len == 0 or isDenied(rel)) return;
            self.deletePath(rel);
        } else if (std.mem.eql(u8, op, "DIR")) {
            const rel = firstToken(if (space < header.len) header[space + 1 ..] else "");
            if (rel.len == 0 or isDenied(rel)) return;
            self.makeDir(rel);
        }
        // INIT shouldn't appear on the host receive path (the host
        // sends INIT to the guest, not the other way around). PING/
        // PONG are no-ops at this layer.
    }

    fn fullPath(self: *InboundParser, rel: []const u8, buf: []u8) ?[]const u8 {
        const trimmed = if (rel.len > 0 and rel[0] == '/') rel[1..] else rel;
        return std.fmt.bufPrint(buf, "{s}/{s}", .{ self.root, trimmed }) catch null;
    }

    fn writeFile(self: *InboundParser, rel: []const u8, payload: []const u8) void {
        var pathbuf: [4096]u8 = undefined;
        const full = self.fullPath(rel, &pathbuf) orelse return;
        if (std.mem.lastIndexOfScalar(u8, full, '/')) |idx| {
            std.fs.makeDirAbsolute(full[0..idx]) catch |e| switch (e) {
                error.PathAlreadyExists => {},
                else => {
                    std.fs.cwd().makePath(full[0..idx]) catch {};
                },
            };
        }
        // Atomic write via tmp + rename so readers never see a half-
        // written file. The .tmp suffix has a process-local salt so
        // concurrent writes from multiple syncs don't clobber each
        // other's temps.
        var tmpbuf: [4096 + 32]u8 = undefined;
        const tmp = std.fmt.bufPrint(&tmpbuf, "{s}.cwsync-{d}.tmp", .{ full, std.os.linux.getpid() }) catch return;
        const f = std.fs.createFileAbsolute(tmp, .{ .truncate = true }) catch return;
        defer f.close();
        f.writeAll(payload) catch {
            std.fs.deleteFileAbsolute(tmp) catch {};
            return;
        };
        std.fs.renameAbsolute(tmp, full) catch {
            std.fs.deleteFileAbsolute(tmp) catch {};
        };
    }

    fn deletePath(self: *InboundParser, rel: []const u8) void {
        var pathbuf: [4096]u8 = undefined;
        const full = self.fullPath(rel, &pathbuf) orelse return;
        // Try as file first; if it was a directory, try rmdir (best-
        // effort — non-empty dirs stay).
        std.fs.deleteFileAbsolute(full) catch {
            std.fs.deleteDirAbsolute(full) catch {};
        };
    }

    fn makeDir(self: *InboundParser, rel: []const u8) void {
        var pathbuf: [4096]u8 = undefined;
        const full = self.fullPath(rel, &pathbuf) orelse return;
        std.fs.cwd().makePath(full) catch {};
    }
};

fn parsePayloadSize(header: []const u8) usize {
    // Last whitespace-separated token, if numeric.
    var idx: usize = header.len;
    while (idx > 0 and header[idx - 1] == ' ') idx -= 1;
    var start = idx;
    while (start > 0 and header[start - 1] != ' ') start -= 1;
    const tok = header[start..idx];
    return std.fmt.parseInt(usize, tok, 10) catch 0;
}

fn firstToken(s: []const u8) []const u8 {
    const end = std.mem.indexOfScalar(u8, s, ' ') orelse s.len;
    return s[0..end];
}
