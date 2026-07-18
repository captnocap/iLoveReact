//! evdev → SDL event bridge for KMS / no-display-server mode.
//!
//! The Linux ioctl surface is necessarily platform-specific, but ordinary
//! device opening, reads, readiness, cancellation, and close ownership use an
//! injected Zig 0.16 `std.Io`. One Io task blocks on each device and feeds a
//! bounded queue; the frame loop only drains already-completed input events.

const builtin = @import("builtin");
const std = @import("std");
const c = @import("../c.zig").imports;

const is_linux = builtin.os.tag == .linux;

pub const Bridge = if (is_linux) Impl.Bridge else struct {
    pub fn poll(_: *@This()) void {}
    pub fn deinit(_: *@This()) void {}
    pub fn deviceCount(_: *const @This()) usize {
        return 0;
    }
    pub fn mouseX(_: *const @This()) f32 {
        return 0;
    }
    pub fn mouseY(_: *const @This()) f32 {
        return 0;
    }
};

pub fn init(
    allocator: std.mem.Allocator,
    io: std.Io,
    window: *c.SDL_Window,
    width: f32,
    height: f32,
) !Bridge {
    if (comptime is_linux) {
        return Impl.Bridge.init(allocator, io, window, width, height);
    } else {
        return .{};
    }
}

const Impl = if (is_linux) struct {
    const ie = @cImport({
        @cInclude("linux/input.h");
        @cInclude("linux/input-event-codes.h");
    });
    const linux = std.os.linux;

    const MAX_DEVS = 32;
    const EVENT_QUEUE_CAPACITY = 4096;
    const READ_BUFFER_EVENTS = 64;

    const Device = struct {
        file: std.Io.File,
        abs: bool,
        ax_min: f32 = 0,
        ax_max: f32 = 32767,
        ay_min: f32 = 0,
        ay_max: f32 = 32767,
        pend_x: ?i32 = null,
        pend_y: ?i32 = null,
        rel_dx: f32 = 0,
        rel_dy: f32 = 0,
        moved: bool = false,
    };

    const InputEvent = struct {
        device_index: u8,
        event_type: u16,
        code: u16,
        value: i32,
    };

    const State = struct {
        allocator: std.mem.Allocator,
        io: std.Io,
        tasks: std.Io.Group = .init,
        devices: [MAX_DEVS]Device = undefined,
        device_count: usize = 0,
        events: std.Io.Queue(InputEvent),
        event_storage: [EVENT_QUEUE_CAPACITY]InputEvent = undefined,
        win_id: c.SDL_WindowID,
        width: f32,
        height: f32,
        mouse_x: f32,
        mouse_y: f32,
        button_mask: u32 = 0,
        motion_logged: bool = false,

        fn readDevice(state: *State, device_index: u8) std.Io.Cancelable!void {
            const file = state.devices[device_index].file;
            var backing: [READ_BUFFER_EVENTS * @sizeOf(ie.struct_input_event)]u8 = undefined;
            var reader = file.readerStreaming(state.io, &backing);

            while (true) {
                const raw = reader.interface.takeStructPointer(ie.struct_input_event) catch |err| switch (err) {
                    error.EndOfStream => return,
                    error.ReadFailed => {
                        const read_err = reader.err orelse error.Unexpected;
                        if (read_err == error.Canceled) return error.Canceled;
                        return;
                    },
                };
                state.events.putOne(state.io, .{
                    .device_index = device_index,
                    .event_type = raw.type,
                    .code = raw.code,
                    .value = raw.value,
                }) catch |err| switch (err) {
                    error.Canceled => return error.Canceled,
                    error.Closed => return,
                };
            }
        }
    };

    pub const Bridge = struct {
        state: *State,

        fn init(
            allocator: std.mem.Allocator,
            io: std.Io,
            window: *c.SDL_Window,
            width: f32,
            height: f32,
        ) !@This() {
            const state = try allocator.create(State);
            errdefer allocator.destroy(state);
            state.* = .{
                .allocator = allocator,
                .io = io,
                .events = .init(&state.event_storage),
                .win_id = c.SDL_GetWindowID(window),
                .width = width,
                .height = height,
                .mouse_x = width / 2,
                .mouse_y = height / 2,
            };
            errdefer {
                state.tasks.cancel(io);
                for (state.devices[0..state.device_count]) |device| device.file.close(io);
            }

            var path_buf: [32]u8 = undefined;
            var number: u8 = 0;
            while (number < 64 and state.device_count < MAX_DEVS) : (number += 1) {
                const path = std.fmt.bufPrintZ(&path_buf, "/dev/input/event{d}", .{number}) catch continue;
                const file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch continue;

                var device = Device{ .file = file, .abs = false };
                var axis_x: ie.struct_input_absinfo = undefined;
                var axis_y: ie.struct_input_absinfo = undefined;
                const got_x = linux.ioctl(file.handle, eviocgabs(ie.ABS_X), @intFromPtr(&axis_x));
                const got_y = linux.ioctl(file.handle, eviocgabs(ie.ABS_Y), @intFromPtr(&axis_y));
                if (linux.errno(got_x) == .SUCCESS and linux.errno(got_y) == .SUCCESS and axis_x.maximum > axis_x.minimum) {
                    device.abs = true;
                    device.ax_min = @floatFromInt(axis_x.minimum);
                    device.ax_max = @floatFromInt(axis_x.maximum);
                    device.ay_min = @floatFromInt(axis_y.minimum);
                    device.ay_max = @floatFromInt(axis_y.maximum);
                }

                const index: u8 = @intCast(state.device_count);
                state.devices[index] = device;
                state.tasks.concurrent(io, State.readDevice, .{ state, index }) catch {
                    file.close(io);
                    continue;
                };
                state.device_count += 1;
                report(io, "[evdev] opened {s} abs={}\n", .{ path, device.abs });
            }
            report(io, "[evdev] {d} input device(s)\n", .{state.device_count});
            return .{ .state = state };
        }

        pub fn poll(bridge: *@This()) void {
            const state = bridge.state;
            var batch: [256]InputEvent = undefined;
            while (true) {
                const count = state.events.getUncancelable(state.io, &batch, 0) catch return;
                if (count == 0) return;
                for (batch[0..count]) |event| {
                    handleEvent(state, &state.devices[event.device_index], event.event_type, event.code, event.value);
                }
            }
        }

        pub fn deinit(bridge: *@This()) void {
            const state = bridge.state;
            state.events.close(state.io);
            state.tasks.cancel(state.io);
            for (state.devices[0..state.device_count]) |device| device.file.close(state.io);
            const allocator = state.allocator;
            allocator.destroy(state);
            bridge.* = undefined;
        }

        pub fn deviceCount(bridge: *const @This()) usize {
            return bridge.state.device_count;
        }

        pub fn mouseX(bridge: *const @This()) f32 {
            return bridge.state.mouse_x;
        }

        pub fn mouseY(bridge: *const @This()) f32 {
            return bridge.state.mouse_y;
        }
    };

    /// _IOR('E', 0x40 + abs, struct input_absinfo). The EVIOCGABS macro takes
    /// an argument, so translate-c cannot expose it directly.
    fn eviocgabs(abs: u32) u32 {
        const size: u32 = @sizeOf(ie.struct_input_absinfo);
        return (2 << 30) | (size << 16) | (0x45 << 8) | (0x40 + abs);
    }

    fn handleEvent(state: *State, device: *Device, event_type: u16, code: u16, value: i32) void {
        switch (event_type) {
            ie.EV_ABS => {
                if (code == ie.ABS_X) {
                    device.pend_x = value;
                    device.moved = true;
                } else if (code == ie.ABS_Y) {
                    device.pend_y = value;
                    device.moved = true;
                }
            },
            ie.EV_REL => {
                if (code == ie.REL_X) {
                    device.rel_dx += @floatFromInt(value);
                    device.moved = true;
                } else if (code == ie.REL_Y) {
                    device.rel_dy += @floatFromInt(value);
                    device.moved = true;
                }
            },
            ie.EV_KEY => {
                const sdl_button: u8 = switch (code) {
                    ie.BTN_LEFT => c.SDL_BUTTON_LEFT,
                    ie.BTN_RIGHT => c.SDL_BUTTON_RIGHT,
                    ie.BTN_MIDDLE => c.SDL_BUTTON_MIDDLE,
                    else => return,
                };
                pushButton(state, sdl_button, value != 0);
            },
            ie.EV_SYN => if (code == ie.SYN_REPORT and device.moved) flushMotion(state, device),
            else => {},
        }
    }

    fn flushMotion(state: *State, device: *Device) void {
        var next_x = state.mouse_x;
        var next_y = state.mouse_y;
        if (device.abs) {
            if (device.pend_x) |value| next_x = (@as(f32, @floatFromInt(value)) - device.ax_min) / (device.ax_max - device.ax_min) * state.width;
            if (device.pend_y) |value| next_y = (@as(f32, @floatFromInt(value)) - device.ay_min) / (device.ay_max - device.ay_min) * state.height;
        } else {
            next_x = state.mouse_x + device.rel_dx;
            next_y = state.mouse_y + device.rel_dy;
        }
        next_x = std.math.clamp(next_x, 0, state.width - 1);
        next_y = std.math.clamp(next_y, 0, state.height - 1);

        const delta_x = next_x - state.mouse_x;
        const delta_y = next_y - state.mouse_y;
        state.mouse_x = next_x;
        state.mouse_y = next_y;
        device.pend_x = null;
        device.pend_y = null;
        device.rel_dx = 0;
        device.rel_dy = 0;
        device.moved = false;

        var event: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
        event.type = c.SDL_EVENT_MOUSE_MOTION;
        event.motion.windowID = state.win_id;
        event.motion.state = state.button_mask;
        event.motion.x = state.mouse_x;
        event.motion.y = state.mouse_y;
        event.motion.xrel = delta_x;
        event.motion.yrel = delta_y;
        const pushed = c.SDL_PushEvent(&event);
        if (!state.motion_logged) {
            state.motion_logged = true;
            report(state.io, "[evdev] first motion x={d:.0} y={d:.0} pushed={} winID={d}\n", .{ state.mouse_x, state.mouse_y, pushed, state.win_id });
        }
    }

    fn pushButton(state: *State, button: u8, down: bool) void {
        const mask: u32 = @as(u32, 1) << @intCast(button - 1);
        if (down) state.button_mask |= mask else state.button_mask &= ~mask;

        var event: c.SDL_Event = std.mem.zeroes(c.SDL_Event);
        event.type = if (down) c.SDL_EVENT_MOUSE_BUTTON_DOWN else c.SDL_EVENT_MOUSE_BUTTON_UP;
        event.button.windowID = state.win_id;
        event.button.button = button;
        event.button.down = down;
        event.button.clicks = 1;
        event.button.x = state.mouse_x;
        event.button.y = state.mouse_y;
        const pushed = c.SDL_PushEvent(&event);
        report(state.io, "[evdev] button {d} down={} at x={d:.0} y={d:.0} pushed={}\n", .{ button, down, state.mouse_x, state.mouse_y, pushed });
    }

    fn report(io: std.Io, comptime format: []const u8, args: anytype) void {
        var buffer: [256]u8 = undefined;
        const message = std.fmt.bufPrint(&buffer, format, args) catch return;
        std.Io.File.stderr().writeStreamingAll(io, message) catch {};
    }
} else struct {};
