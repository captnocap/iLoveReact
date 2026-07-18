//! PTY (pseudo-terminal) — port of love2d/lua/pty.lua
//!
//! Opens a PTY master/slave pair via posix_openpt and forks a shell into the
//! slave. The kernel-specific setup stays at this boundary; steady-state
//! reads, writes, cancellation, and child waiting run through injected
//! `std.Io` capabilities.
//!
//! Unlike plain pipes, a PTY gives shells proper terminal behavior: readline
//! editing, color output, Ctrl+C handling, job control, cursor movement.
//!
//! Usage:
//!   var pty = try openPty(allocator, io, .{ .shell = "bash", .rows = 40, .cols = 120 });
//!   defer pty.close();
//!
//!   // Per-frame: drain available output
//!   if (pty.read()) |data| { vterm.feed(data); }
//!
//!   // Send keystrokes
//!   pty.write("ls -la\n");
//!
//!   // Resize (sends SIGWINCH)
//!   pty.resize(30, 120);

const std = @import("std");

// ════════════════════════════════════════════════════════════════════════
// POSIX constants (Linux x86-64)
// ════════════════════════════════════════════════════════════════════════

const O_RDWR: c_int = 2;
const O_NOCTTY: c_int = 0x400;
const O_CLOEXEC: c_int = 0x80000;
const TIOCSCTTY: c_ulong = 0x540E;
const TIOCSWINSZ: c_ulong = 0x5414;

// ════════════════════════════════════════════════════════════════════════
// POSIX externs (libc — linked by build.zig)
// ════════════════════════════════════════════════════════════════════════

extern fn posix_openpt(flags: c_int) c_int;
extern fn grantpt(fd: c_int) c_int;
extern fn unlockpt(fd: c_int) c_int;
extern fn ptsname_r(fd: c_int, buf: [*]u8, buflen: usize) c_int;
extern fn fork() c_int;
extern fn setsid() c_int;
extern fn dup2(oldfd: c_int, newfd: c_int) c_int;
extern fn execvp(file: [*:0]const u8, argv: [*]const ?[*:0]const u8) c_int;
extern fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern fn close(fd: c_int) c_int;
extern fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
extern fn chdir(path: [*:0]const u8) c_int;
extern fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;
extern fn _exit(status: c_int) noreturn;

const WinSize = extern struct {
    ws_row: u16,
    ws_col: u16,
    ws_xpixel: u16 = 0,
    ws_ypixel: u16 = 0,
};

// ════════════════════════════════════════════════════════════════════════
// PTY struct
// ════════════════════════════════════════════════════════════════════════

const READ_BUF_SIZE = 8192;
const OUTPUT_QUEUE_CAPACITY = 256 * 1024;
const WRITE_QUEUE_CAPACITY = 64;

pub const OpenOptions = struct {
    shell: [*:0]const u8 = "bash",
    rows: u16 = 40,
    cols: u16 = 120,
    cwd: ?[*:0]const u8 = null,
};

pub const Pty = struct {
    state: *State,
    read_buf: [READ_BUF_SIZE]u8 = undefined,

    const WriteRequest = struct {
        bytes: []u8,
    };

    const State = struct {
        allocator: std.mem.Allocator,
        io: std.Io,
        master: std.Io.File,
        child: std.process.Child,
        tasks: std.Io.Group = .init,
        output: std.Io.Queue(u8),
        output_storage: [OUTPUT_QUEUE_CAPACITY]u8 = undefined,
        writes: std.Io.Queue(WriteRequest),
        write_storage: [WRITE_QUEUE_CAPACITY]WriteRequest = undefined,
        closed: std.atomic.Value(bool) = .init(false),
        exited: std.atomic.Value(bool) = .init(false),
        output_done: std.atomic.Value(bool) = .init(false),
        write_failed: std.atomic.Value(bool) = .init(false),
        exit_code: std.atomic.Value(c_int) = .init(-1),

        fn readLoop(state: *State) std.Io.Cancelable!void {
            defer {
                state.output_done.store(true, .release);
                state.output.close(state.io);
            }

            var backing: [READ_BUF_SIZE]u8 = undefined;
            var reader = state.master.readerStreaming(state.io, &backing);
            while (true) {
                reader.interface.fillMore() catch |err| switch (err) {
                    error.EndOfStream => return,
                    error.ReadFailed => {
                        const read_err = reader.err orelse error.Unexpected;
                        if (read_err == error.Canceled) return error.Canceled;
                        // Linux PTY masters report EIO after the slave closes.
                        // It is a terminal condition here, not a reason to
                        // recreate a raw errno/read loop.
                        return;
                    },
                };

                const available = reader.interface.buffered();
                if (available.len == 0) continue;
                state.output.putAll(state.io, available) catch |err| switch (err) {
                    error.Canceled => return error.Canceled,
                    error.Closed => return,
                };
                reader.interface.tossBuffered();
            }
        }

        fn writeLoop(state: *State) std.Io.Cancelable!void {
            while (true) {
                const request = state.writes.getOne(state.io) catch |err| switch (err) {
                    error.Canceled => return error.Canceled,
                    error.Closed => return,
                };
                defer state.allocator.free(request.bytes);

                state.master.writeStreamingAll(state.io, request.bytes) catch |err| {
                    if (err == error.Canceled) return error.Canceled;
                    state.write_failed.store(true, .release);
                    return;
                };
            }
        }

        fn waitLoop(state: *State) std.Io.Cancelable!void {
            const term = state.child.wait(state.io) catch |err| {
                if (err == error.Canceled) return error.Canceled;
                state.exit_code.store(-1, .release);
                state.exited.store(true, .release);
                return;
            };
            state.exit_code.store(termExitCode(term), .release);
            state.exited.store(true, .release);
        }

        fn termExitCode(term: std.process.Child.Term) c_int {
            return switch (term) {
                .exited => |code| @intCast(code),
                .signal => |signal| 128 + @as(c_int, @intCast(@intFromEnum(signal))),
                .stopped, .unknown => -1,
            };
        }
    };

    /// Non-blocking drain of bytes already produced by the Io reader task.
    pub fn readData(self: *Pty) ?[]const u8 {
        const state = self.state;
        if (state.closed.load(.acquire)) return null;
        const count = state.output.getUncancelable(state.io, &self.read_buf, 0) catch return null;
        return if (count == 0) null else self.read_buf[0..count];
    }

    /// Queues raw bytes for the Io writer task without blocking the frame loop.
    pub fn writeData(self: *Pty, data: []const u8) bool {
        const state = self.state;
        if (state.closed.load(.acquire) or state.write_failed.load(.acquire)) return false;
        if (data.len == 0) return true;

        const copy = state.allocator.dupe(u8, data) catch return false;
        const count = state.writes.putUncancelable(state.io, &.{.{ .bytes = copy }}, 0) catch {
            state.allocator.free(copy);
            return false;
        };
        if (count == 0) {
            state.allocator.free(copy);
            return false;
        }
        return true;
    }

    /// Update terminal window size and send SIGWINCH to shell.
    pub fn resize(self: *Pty, rows: u16, cols: u16) void {
        const state = self.state;
        if (state.closed.load(.acquire)) return;
        var ws = WinSize{ .ws_row = rows, .ws_col = cols };
        _ = ioctl(state.master.handle, TIOCSWINSZ, @intFromPtr(&ws));
    }

    /// Lock-free liveness snapshot maintained by the Io child-wait task.
    pub fn alive(self: *const Pty) bool {
        const state = self.state;
        if (state.closed.load(.acquire)) return false;
        // Keep the session drainable until both the child and its output pump
        // have finished. Callers that stop on `alive() == false` can then
        // perform one final queue drain without racing the reader task.
        return !state.exited.load(.acquire) or !state.output_done.load(.acquire);
    }

    pub fn exitCode(self: *const Pty) c_int {
        return self.state.exit_code.load(.acquire);
    }

    /// The child identifier exposed by Zig's native process owner. Callers
    /// that inspect `/proc` must tolerate it becoming null after reaping.
    pub fn processId(self: *const Pty) ?std.process.Child.Id {
        return self.state.child.id;
    }

    /// Cancel owned I/O tasks, terminate/reap the child through `std.Io`, and
    /// release every queued write. Safe to call once; callers null their owner.
    pub fn closePty(self: *Pty) void {
        const state = self.state;
        if (state.closed.swap(true, .acq_rel)) return;

        state.writes.close(state.io);
        state.tasks.cancel(state.io);
        if (state.child.id != null) {
            state.child.kill(state.io);
            state.exit_code.store(137, .release);
            state.exited.store(true, .release);
        }
        state.output.close(state.io);
        state.master.close(state.io);

        while (state.writes.getOneUncancelable(state.io)) |request| {
            state.allocator.free(request.bytes);
        } else |err| switch (err) {
            error.Closed => {},
        }

        const allocator = state.allocator;
        allocator.destroy(state);
        self.* = undefined;
    }
};

// ════════════════════════════════════════════════════════════════════════
// Open — fork a shell into a new PTY
// ════════════════════════════════════════════════════════════════════════

pub fn openPty(allocator: std.mem.Allocator, io: std.Io, opts: OpenOptions) !Pty {
    // 1. Open PTY master
    const masterfd = posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC);
    if (masterfd < 0) return error.PosixOpenPtFailed;

    // 2. Grant and unlock slave
    if (grantpt(masterfd) != 0) {
        _ = close(masterfd);
        return error.GrantPtFailed;
    }
    if (unlockpt(masterfd) != 0) {
        _ = close(masterfd);
        return error.UnlockPtFailed;
    }

    // 3. Get slave device name
    var namebuf: [64]u8 = undefined;
    if (ptsname_r(masterfd, &namebuf, 64) != 0) {
        _ = close(masterfd);
        return error.PtsnameFailed;
    }
    // Find null terminator for the name
    var name_len: usize = 0;
    while (name_len < 64 and namebuf[name_len] != 0) name_len += 1;

    // 4. Set window size BEFORE fork so the child sees the correct
    //    dimensions immediately. The old post-fork ioctl raced: the child
    //    could call `stty size` before the parent's ioctl, getting the
    //    kernel's default PTY size instead of the intended layout box.
    var ws = WinSize{ .ws_row = opts.rows, .ws_col = opts.cols };
    _ = ioctl(masterfd, TIOCSWINSZ, @intFromPtr(&ws));

    // Allocate the stable owner before fork. Background tasks receive this
    // pointer only in the parent, after every field is initialized.
    const state = try allocator.create(Pty.State);
    errdefer allocator.destroy(state);

    // 5. Fork
    const pid = fork();
    if (pid < 0) {
        _ = close(masterfd);
        return error.ForkFailed;
    }

    if (pid == 0) {
        // ── CHILD ──
        _ = close(masterfd);
        _ = setsid();

        const slavefd = open(@ptrCast(&namebuf), O_RDWR);
        if (slavefd < 0) _exit(1);

        _ = ioctl(slavefd, TIOCSCTTY, @as(c_int, 0));

        _ = dup2(slavefd, 0);
        _ = dup2(slavefd, 1);
        _ = dup2(slavefd, 2);
        if (slavefd > 2) _ = close(slavefd);

        if (opts.cwd) |cwd| _ = chdir(cwd);
        _ = setenv("TERM", "xterm-256color", 0);
        _ = setenv("COLORTERM", "truecolor", 1);

        var argv = [_]?[*:0]const u8{ opts.shell, null };
        _ = execvp(opts.shell, &argv);
        _exit(127);
    }

    // ── PARENT ──

    state.* = .{
        .allocator = allocator,
        .io = io,
        .master = .{ .handle = masterfd, .flags = .{ .nonblocking = false } },
        .child = .{
            .id = @intCast(pid),
            .thread_handle = {},
            .stdin = null,
            .stdout = null,
            .stderr = null,
            .request_resource_usage_statistics = false,
        },
        .output = .init(&state.output_storage),
        .writes = .init(&state.write_storage),
    };
    errdefer {
        state.tasks.cancel(io);
        state.child.kill(io);
        state.master.close(io);
    }

    try state.tasks.concurrent(io, Pty.State.readLoop, .{state});
    try state.tasks.concurrent(io, Pty.State.writeLoop, .{state});
    try state.tasks.concurrent(io, Pty.State.waitLoop, .{state});

    return .{ .state = state };
}

test "PTY owns native Io read, write, and child-wait tasks" {
    var pty = try openPty(std.testing.allocator, std.testing.io, .{
        .shell = "/bin/sh",
        .rows = 24,
        .cols = 80,
    });
    defer pty.closePty();

    try std.testing.expect(pty.writeData("printf 'rjit-pty-ok\\n'; exit 7\n"));

    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(std.testing.allocator);
    const deadline = std.Io.Clock.now(.awake, std.testing.io).addDuration(.fromSeconds(5));
    while ((!pty.state.exited.load(.acquire) or !pty.state.output_done.load(.acquire)) and
        std.Io.Clock.now(.awake, std.testing.io).toNanoseconds() < deadline.toNanoseconds())
    {
        if (pty.readData()) |bytes| try output.appendSlice(std.testing.allocator, bytes);
        try std.Io.sleep(std.testing.io, .fromMilliseconds(1), .awake);
    }
    while (pty.readData()) |bytes| try output.appendSlice(std.testing.allocator, bytes);

    try std.testing.expect(pty.state.exited.load(.acquire));
    try std.testing.expect(pty.state.output_done.load(.acquire));
    try std.testing.expectEqual(@as(c_int, 7), pty.exitCode());
    try std.testing.expect(std.mem.indexOf(u8, output.items, "rjit-pty-ok") != null);
}
