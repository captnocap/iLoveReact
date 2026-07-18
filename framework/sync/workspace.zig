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
const MAX_HEADER_LEN = 4 * 1024; // sanity bound
const MAX_INLINE_PAYLOAD = 512 * 1024 * 1024; // 512MB — workspace tar fits

// ────────────────────────────────────────────────────────────────────
// Frame BUILDERS — format outbound bytes into a writer.
// All builders allocate at most one transient header buffer + read
// payload from disk in chunks, so a 200MB SET frame doesn't fragment
// the heap.
// ────────────────────────────────────────────────────────────────────

/// Write a SET/INIT-style frame: 4B length, header line, then `size`
/// bytes of payload streamed from `payload_file`.
pub fn writeFileFrame(
    io: std.Io,
    writer: anytype,
    op: []const u8,
    rel: []const u8,
    payload_file: std.Io.File,
    payload_size: u64,
) !void {
    var header_buf: [256]u8 = undefined;
    const header = try std.fmt.bufPrint(&header_buf, "{s} {s} {d}\n", .{ op, rel, payload_size });
    try writeLenPrefixed(writer, header);
    try streamFile(io, writer, payload_file, payload_size);
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
    io: std.Io,
    writer: anytype,
    rel: []const u8,
    local_path: []const u8,
) !void {
    const file = try std.Io.Dir.cwd().openFile(io, local_path, .{});
    defer file.close(io);
    const st = try file.stat(io);
    try writeFileFrame(io, writer, "SET", rel, file, st.size);
}

/// Build a workspace tar (via `git ls-files | tar`) and ship it as a
/// single INIT frame. Filters out paths under DENY_PATTERNS and
/// missing files (tracked-but-deleted entries break tar otherwise).
pub fn writeInitTar(
    io: std.Io,
    environ: *const std.process.Environ.Map,
    writer: anytype,
    allocator: std.mem.Allocator,
    cwd: []const u8,
    dest: []const u8,
) !void {
    const tar_bytes = try buildTarBytes(allocator, io, environ, cwd);
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

fn streamFile(io: std.Io, writer: anytype, file: std.Io.File, total: u64) !void {
    var buf: [64 * 1024]u8 = undefined;
    var remaining = total;
    var offset: u64 = 0;
    while (remaining > 0) {
        const want = @min(buf.len, remaining);
        const n = try file.readPositional(io, &.{buf[0..want]}, offset);
        if (n == 0) return error.UnexpectedEof;
        try writer.writeAll(buf[0..n]);
        remaining -= @intCast(n);
        offset += @intCast(n);
    }
}

// ────────────────────────────────────────────────────────────────────
// Tar build — uses `git ls-files` + `tar` to capture the working tree.
// ────────────────────────────────────────────────────────────────────

// Paths under any of these segments are skipped both in the initial
// tar and in runtime inotify fanout. Backstop for non-git workspaces
// and for vendored deps that aren't in .gitignore.
const DENY_SEGMENTS = [_][]const u8{
    ".git",   ".zig-cache",  "node_modules", "zig-out",
    "target", "deps",        "archive",      "images",
    ".cache", "__pycache__", ".next",        "dist",
    "build",  ".DS_Store",
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

fn buildTarBytes(
    allocator: std.mem.Allocator,
    io: std.Io,
    environ: *const std.process.Environ.Map,
    cwd: []const u8,
) ![]u8 {
    // Step 1: `git ls-files -z --cached --others --exclude-standard`
    const ls = try runCapture(allocator, &.{
        "git",      "-C",       cwd,                  "ls-files", "-z",
        "--cached", "--others", "--exclude-standard",
    }, null, io, environ);
    defer allocator.free(ls);

    // Step 2: filter — drop denied + missing files. Reuse buffer.
    var kept: std.ArrayList(u8) = .empty;
    defer kept.deinit(allocator);

    var start: usize = 0;
    for (ls, 0..) |b, i| {
        if (b != 0) continue;
        if (i > start) {
            const path_rel = ls[start..i];
            if (!isDenied(path_rel) and existsUnder(io, cwd, path_rel)) {
                try kept.appendSlice(allocator, path_rel);
                try kept.append(allocator, 0);
            }
        }
        start = i + 1;
    }

    // Step 3: `tar -cf - -C <cwd> --ignore-failed-read --null --no-recursion --files-from -`
    return try runCapture(allocator, &.{
        "tar",    "-cf",            "-",
        "-C",     cwd,              "--ignore-failed-read",
        "--null", "--no-recursion", "--files-from",
        "-",
    }, kept.items, io, environ);
}

fn existsUnder(io: std.Io, cwd: []const u8, rel: []const u8) bool {
    var pathbuf: [4096]u8 = undefined;
    const full = std.fmt.bufPrint(&pathbuf, "{s}/{s}", .{ cwd, rel }) catch return false;
    std.Io.Dir.accessAbsolute(io, full, .{}) catch return false;
    return true;
}

fn runCapture(
    allocator: std.mem.Allocator,
    argv: []const []const u8,
    stdin_bytes: ?[]const u8,
    io: std.Io,
    environ: *const std.process.Environ.Map,
) ![]u8 {
    var child = try std.process.spawn(io, .{
        .argv = argv,
        .stdin = if (stdin_bytes != null) .pipe else .ignore,
        .stdout = .pipe,
        .stderr = .ignore,
        .environ_map = environ,
    });
    defer child.kill(io);

    // Feed stdin concurrently with stdout draining. `tar` can begin producing
    // output before it has consumed the complete file list, so sequentially
    // filling stdin first can deadlock once either pipe reaches capacity.
    if (stdin_bytes) |bytes| {
        const stdin = child.stdin.?;
        child.stdin = null;
        var input_task = try std.Io.concurrent(io, writeChildInput, .{ io, stdin, bytes });
        const output = try readChildOutput(allocator, io, child.stdout.?);
        errdefer allocator.free(output);
        try input_task.await(io);
        try acceptChildTerm(try child.wait(io), output.len);
        return output;
    }

    const output = try readChildOutput(allocator, io, child.stdout.?);
    errdefer allocator.free(output);
    try acceptChildTerm(try child.wait(io), output.len);
    return output;
}

fn writeChildInput(io: std.Io, file: std.Io.File, bytes: []const u8) !void {
    defer file.close(io);
    try file.writeStreamingAll(io, bytes);
}

fn readChildOutput(allocator: std.mem.Allocator, io: std.Io, file: std.Io.File) ![]u8 {
    var stdout_buf: std.ArrayList(u8) = .empty;
    errdefer stdout_buf.deinit(allocator);

    var read_buf: [64 * 1024]u8 = undefined;
    while (true) {
        const n = file.readStreaming(io, &.{&read_buf}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => |e| return e,
        };
        if (n == 0) continue;
        try stdout_buf.appendSlice(allocator, read_buf[0..n]);
    }
    return stdout_buf.toOwnedSlice(allocator);
}

fn acceptChildTerm(term: std.process.Child.Term, output_len: usize) !void {
    // tar can exit 1 if some files vanished mid-archive; accept if we
    // got bytes out.
    switch (term) {
        .exited => |code| {
            if (code != 0 and output_len == 0) return error.ChildFailed;
        },
        else => return error.ChildAbnormalExit,
    }
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
            .buf = .empty,
        };
    }

    pub fn deinit(self: *InboundParser) void {
        self.buf.deinit(self.allocator);
    }

    /// Append received bytes, parse and apply as many complete frames
    /// as fit. Partial frames stay in buf for next call.
    pub fn feed(self: *InboundParser, io: std.Io, bytes: []const u8) void {
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

            const header = std.mem.trimEnd(u8, self.buf.items[FRAME_LEN_BYTES .. FRAME_LEN_BYTES + hlen], "\n");
            const payload_size = parsePayloadSize(header);
            if (payload_size > MAX_INLINE_PAYLOAD) {
                self.buf.clearRetainingCapacity();
                return;
            }
            const total = FRAME_LEN_BYTES + hlen + payload_size;
            if (self.buf.items.len < total) return;

            const payload = self.buf.items[FRAME_LEN_BYTES + hlen .. total];
            self.applyFrame(io, header, payload);

            // Shift remaining bytes to the front. For small drains this
            // is cheap; for big payloads we already absorbed them.
            const remaining = self.buf.items.len - total;
            if (remaining > 0) {
                std.mem.copyForwards(u8, self.buf.items[0..remaining], self.buf.items[total..]);
            }
            self.buf.shrinkRetainingCapacity(remaining);
        }
    }

    fn applyFrame(self: *InboundParser, io: std.Io, header: []const u8, payload: []const u8) void {
        // Parse `OP <args...>` — first token is the op, remainder is args.
        const space = std.mem.indexOfScalar(u8, header, ' ') orelse header.len;
        const op = header[0..space];

        if (std.mem.eql(u8, op, "SET")) {
            const rest = if (space < header.len) header[space + 1 ..] else "";
            const rel = firstToken(rest);
            if (rel.len == 0 or isDenied(rel)) return;
            self.writeFile(io, rel, payload);
        } else if (std.mem.eql(u8, op, "DEL")) {
            const rel = firstToken(if (space < header.len) header[space + 1 ..] else "");
            if (rel.len == 0 or isDenied(rel)) return;
            self.deletePath(io, rel);
        } else if (std.mem.eql(u8, op, "DIR")) {
            const rel = firstToken(if (space < header.len) header[space + 1 ..] else "");
            if (rel.len == 0 or isDenied(rel)) return;
            self.makeDir(io, rel);
        }
        // INIT shouldn't appear on the host receive path (the host
        // sends INIT to the guest, not the other way around). PING/
        // PONG are no-ops at this layer.
    }

    fn fullPath(self: *InboundParser, rel: []const u8, buf: []u8) ?[]const u8 {
        const trimmed = if (rel.len > 0 and rel[0] == '/') rel[1..] else rel;
        return std.fmt.bufPrint(buf, "{s}/{s}", .{ self.root, trimmed }) catch null;
    }

    fn writeFile(self: *InboundParser, io: std.Io, rel: []const u8, payload: []const u8) void {
        var pathbuf: [4096]u8 = undefined;
        const full = self.fullPath(rel, &pathbuf) orelse return;
        if (std.mem.lastIndexOfScalar(u8, full, '/')) |idx| {
            std.Io.Dir.createDirAbsolute(io, full[0..idx], .default_dir) catch |e| switch (e) {
                error.PathAlreadyExists => {},
                else => {
                    std.Io.Dir.cwd().createDirPath(io, full[0..idx]) catch {};
                },
            };
        }
        // Atomic write via tmp + rename so readers never see a half-
        // written file. The .tmp suffix has a process-local salt so
        // concurrent writes from multiple syncs don't clobber each
        // other's temps.
        var tmpbuf: [4096 + 32]u8 = undefined;
        const tmp = std.fmt.bufPrint(&tmpbuf, "{s}.cwsync-{d}.tmp", .{ full, std.os.linux.getpid() }) catch return;
        const f = std.Io.Dir.createFileAbsolute(io, tmp, .{ .truncate = true }) catch return;
        defer f.close(io);
        f.writeStreamingAll(io, payload) catch {
            std.Io.Dir.deleteFileAbsolute(io, tmp) catch {};
            return;
        };
        std.Io.Dir.renameAbsolute(tmp, full, io) catch {
            std.Io.Dir.deleteFileAbsolute(io, tmp) catch {};
        };
    }

    fn deletePath(self: *InboundParser, io: std.Io, rel: []const u8) void {
        var pathbuf: [4096]u8 = undefined;
        const full = self.fullPath(rel, &pathbuf) orelse return;
        // Try as file first; if it was a directory, try rmdir (best-
        // effort — non-empty dirs stay).
        std.Io.Dir.deleteFileAbsolute(io, full) catch {
            std.Io.Dir.deleteDirAbsolute(io, full) catch {};
        };
    }

    fn makeDir(self: *InboundParser, io: std.Io, rel: []const u8) void {
        var pathbuf: [4096]u8 = undefined;
        const full = self.fullPath(rel, &pathbuf) orelse return;
        std.Io.Dir.cwd().createDirPath(io, full) catch {};
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

const TestBufferWriter = struct {
    bytes: std.ArrayList(u8) = .empty,

    fn deinit(self: *TestBufferWriter) void {
        self.bytes.deinit(std.testing.allocator);
    }

    pub fn writeAll(self: *TestBufferWriter, data: []const u8) !void {
        try self.bytes.appendSlice(std.testing.allocator, data);
    }
};

test "file frames and inbound writes use the supplied Io" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const payload = "hello workspace";
    const source = try tmp.dir.createFile(std.testing.io, "source.txt", .{ .read = true });
    defer source.close(std.testing.io);
    try source.writeStreamingAll(std.testing.io, payload);

    var out: TestBufferWriter = .{};
    defer out.deinit();
    try writeFileFrame(std.testing.io, &out, "SET", "copy.txt", source, payload.len);

    var path_buf: [std.fs.max_path_bytes]u8 = undefined;
    const path_len = try tmp.dir.realPath(std.testing.io, &path_buf);
    const owned_root = try std.testing.allocator.dupe(u8, path_buf[0..path_len]);
    defer std.testing.allocator.free(owned_root);
    var parser = InboundParser.init(std.testing.allocator, owned_root);
    defer parser.deinit();

    const split = @min(out.bytes.items.len, 7);
    parser.feed(std.testing.io, out.bytes.items[0..split]);
    parser.feed(std.testing.io, out.bytes.items[split..]);

    const copied = try tmp.dir.readFileAlloc(std.testing.io, "copy.txt", std.testing.allocator, .limited(1024));
    defer std.testing.allocator.free(copied);
    try std.testing.expectEqualStrings(payload, copied);
}
