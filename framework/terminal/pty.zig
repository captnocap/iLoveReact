//! PTY (pseudo-terminal) — port of love2d/lua/pty.lua
//!
//! Opens a PTY master/slave pair via posix_openpt, forks a shell into the
//! slave, and provides non-blocking bidirectional I/O via the master fd.
//!
//! Unlike plain pipes, a PTY gives shells proper terminal behavior: readline
//! editing, color output, Ctrl+C handling, job control, cursor movement.
//!
//! Usage:
//!   var pty = try Pty.open(.{ .shell = "bash", .rows = 40, .cols = 120 });
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
const log = @import("../diag/log.zig");

// ════════════════════════════════════════════════════════════════════════
// POSIX constants (Linux x86-64)
// ════════════════════════════════════════════════════════════════════════

const O_RDWR: c_int = 2;
const O_NOCTTY: c_int = 0x400;
const O_CLOEXEC: c_int = 0x80000;
const O_NONBLOCK: c_int = 0x800;
const F_GETFL: c_int = 3;
const F_SETFL: c_int = 4;
const TIOCSCTTY: c_ulong = 0x540E;
const TIOCSWINSZ: c_ulong = 0x5414;
const WNOHANG: c_int = 1;
const SIGTERM: c_int = 15;
const SIGKILL: c_int = 9;
const EAGAIN: c_int = 11;
const EINTR: c_int = 4;
const EIO: c_int = 5;

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
extern fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern fn fcntl(fd: c_int, cmd: c_int, ...) c_int;
extern fn ioctl(fd: c_int, request: c_ulong, ...) c_int;
extern fn waitpid(pid: c_int, status: *c_int, options: c_int) c_int;
extern fn kill(pid: c_int, sig: c_int) c_int;
extern fn chdir(path: [*:0]const u8) c_int;
extern fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: c_int) c_int;
extern fn _exit(status: c_int) noreturn;
// errno access — Linux uses __errno_location, macOS uses __error
extern fn __errno_location() *c_int;
extern fn __error() *c_int;

const WinSize = extern struct {
    ws_row: u16,
    ws_col: u16,
    ws_xpixel: u16 = 0,
    ws_ypixel: u16 = 0,
};

fn getErrno() c_int {
    if (comptime @import("builtin").os.tag == .macos) {
        return __error().*;
    }
    return __errno_location().*;
}

// ════════════════════════════════════════════════════════════════════════
// PTY struct
// ════════════════════════════════════════════════════════════════════════

const READ_BUF_SIZE = 8192;

pub const OpenOptions = struct {
    shell: [*:0]const u8 = "bash",
    rows: u16 = 40,
    cols: u16 = 120,
    cwd: ?[*:0]const u8 = null,
};

pub const Pty = struct {
    pid: c_int,
    masterfd: c_int,
    closed: bool = false,
    exited: bool = false,
    child_exited: bool = false,
    exit_code: c_int = -1,
    read_buf: [READ_BUF_SIZE]u8 = undefined,

    /// Non-blocking drain: returns all available output, or null if none ready.
    pub fn readData(self: *Pty) ?[]const u8 {
        if (self.closed or self.masterfd < 0) return null;

        var total: usize = 0;
        while (total < self.read_buf.len - 1) {
            const n = read(self.masterfd, self.read_buf[total..].ptr, self.read_buf.len - total);
            if (n > 0) {
                total += @intCast(n);
            } else if (n == 0) {
                self.child_exited = true;
                break;
            } else {
                const e = getErrno();
                if (e == EAGAIN or e == EINTR) break;
                if (e == EIO) {
                    self.child_exited = true;
                    break;
                }
                break;
            }
        }

        if (total == 0) return null;
        return self.read_buf[0..total];
    }

    /// Write raw bytes to the PTY master (keyboard input to shell).
    pub fn writeData(self: *Pty, data: []const u8) bool {
        if (self.closed or self.masterfd < 0) return false;
        if (data.len == 0) return true;

        var written: usize = 0;
        while (written < data.len) {
            const n = write(self.masterfd, data[written..].ptr, data.len - written);
            if (n < 0) {
                const e = getErrno();
                if (e == EAGAIN or e == EINTR) continue;
                if (e == EIO) {
                    self.child_exited = true;
                    return false;
                }
                return false;
            }
            written += @intCast(n);
        }
        return true;
    }

    /// Update terminal window size and send SIGWINCH to shell.
    pub fn resize(self: *Pty, rows: u16, cols: u16) void {
        if (self.closed or self.masterfd < 0) return;
        var ws = WinSize{ .ws_row = rows, .ws_col = cols };
        _ = ioctl(self.masterfd, TIOCSWINSZ, @intFromPtr(&ws));
    }

    /// Non-blocking liveness check.
    pub fn alive(self: *Pty) bool {
        if (self.closed or self.exited) return false;
        if (self.child_exited) {
            var status: c_int = 0;
            const ret = waitpid(self.pid, &status, WNOHANG);
            if (ret == self.pid or ret < 0) {
                self.exited = true;
                self.exit_code = (status >> 8) & 0xFF;
                return false;
            }
            return true;
        }
        var status: c_int = 0;
        const ret = waitpid(self.pid, &status, WNOHANG);
        if (ret == 0) return true;
        if (ret == self.pid) {
            self.exited = true;
            self.exit_code = (status >> 8) & 0xFF;
            return false;
        }
        self.exited = true;
        return false;
    }

    pub fn exitCode(self: *Pty) c_int {
        return self.exit_code;
    }

    /// Close the PTY and reap child. Safe to call multiple times.
    pub fn closePty(self: *Pty) void {
        if (self.closed) return;
        self.closed = true;

        if (self.masterfd >= 0) {
            _ = close(self.masterfd);
            self.masterfd = -1;
        }

        if (!self.exited) {
            var status: c_int = 0;
            var ret = waitpid(self.pid, &status, WNOHANG);
            if (ret == 0) {
                _ = kill(self.pid, SIGTERM);
                // Brief spin wait for graceful exit
                for (0..200) |_| {
                    ret = waitpid(self.pid, &status, WNOHANG);
                    if (ret != 0) break;
                }
                if (ret == 0) {
                    _ = kill(self.pid, SIGKILL);
                    _ = waitpid(self.pid, &status, 0); // blocking final reap
                }
            }
            self.exited = true;
            self.exit_code = (status >> 8) & 0xFF;
        }
    }
};

// ════════════════════════════════════════════════════════════════════════
// Open — fork a shell into a new PTY
// ════════════════════════════════════════════════════════════════════════

pub fn openPty(opts: OpenOptions) !Pty {
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

    // 4. Fork
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
    // Set initial window size before child renders first prompt
    var ws = WinSize{ .ws_row = opts.rows, .ws_col = opts.cols };
    _ = ioctl(masterfd, TIOCSWINSZ, @intFromPtr(&ws));

    // Non-blocking master
    const flags = fcntl(masterfd, F_GETFL);
    if (flags >= 0) _ = fcntl(masterfd, F_SETFL, flags | O_NONBLOCK);

    log.print("[pty] PID={d} slave={s} shell={s}\n", .{ pid, namebuf[0..name_len], std.mem.span(opts.shell) });

    return Pty{ .pid = pid, .masterfd = masterfd };
}
