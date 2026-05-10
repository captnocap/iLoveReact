//! Async exec primitive — spawn a shell command on a detached thread, push its
//! result into a mutex-guarded queue, let the main-thread drain emit via
//! __ffiEmit. Mirrors the http request-async pattern. Keeps click handlers
//! from blocking on popen/pclose.

const std = @import("std");

const alloc = std.heap.c_allocator;

extern fn popen(command: [*:0]const u8, mode: [*:0]const u8) ?*anyopaque;
extern fn pclose(stream: *anyopaque) c_int;
extern fn fread(ptr: [*]u8, size: usize, nmemb: usize, stream: *anyopaque) usize;

const Completed = struct {
    rid: []u8,
    stdout: []u8,
    exit_code: i32,
};

var g_mutex: std.Thread.Mutex = .{};
var g_completed: std.ArrayList(Completed) = .{};

pub fn spawn(rid: []const u8, cmd: []const u8) void {
    const rid_copy = alloc.dupe(u8, rid) catch return;
    const cmd_copy = alloc.dupeZ(u8, cmd) catch {
        alloc.free(rid_copy);
        return;
    };
    const t = std.Thread.spawn(.{}, threadBody, .{ rid_copy, cmd_copy }) catch {
        alloc.free(rid_copy);
        alloc.free(cmd_copy);
        return;
    };
    t.detach();
}

fn threadBody(rid: []u8, cmd: [:0]u8) void {
    defer alloc.free(cmd);
    const stream = popen(cmd.ptr, "r");
    if (stream == null) {
        pushCompleted(rid, &.{}, -1);
        return;
    }
    var buf: std.ArrayList(u8) = .{};
    defer buf.deinit(alloc);
    var read_buf: [4096]u8 = undefined;
    while (true) {
        const n = fread(&read_buf, 1, read_buf.len, stream.?);
        if (n == 0) break;
        buf.appendSlice(alloc, read_buf[0..n]) catch break;
    }
    const code = pclose(stream.?);
    const stdout_owned = buf.toOwnedSlice(alloc) catch {
        pushCompleted(rid, &.{}, code);
        return;
    };
    pushCompleted(rid, stdout_owned, code);
}

fn pushCompleted(rid: []u8, stdout: []const u8, code: i32) void {
    const stdout_copy = alloc.dupe(u8, stdout) catch {
        alloc.free(rid);
        return;
    };
    g_mutex.lock();
    defer g_mutex.unlock();
    g_completed.append(alloc, .{ .rid = rid, .stdout = stdout_copy, .exit_code = code }) catch {
        alloc.free(rid);
        alloc.free(stdout_copy);
    };
}

pub const OnComplete = *const fn (rid: []const u8, stdout: []const u8, code: i32) void;

pub fn drain(cb: OnComplete) void {
    g_mutex.lock();
    if (g_completed.items.len == 0) {
        g_mutex.unlock();
        return;
    }
    const items = g_completed.toOwnedSlice(alloc) catch {
        g_mutex.unlock();
        return;
    };
    g_mutex.unlock();
    for (items) |item| {
        cb(item.rid, item.stdout, item.exit_code);
        alloc.free(item.rid);
        alloc.free(item.stdout);
    }
    alloc.free(items);
}
