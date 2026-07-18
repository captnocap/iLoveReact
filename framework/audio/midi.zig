//! MIDI input source.
//!
//! Linux uses ALSA sequencer directly, ported from love2d/lua/audio/midi.lua.
//! Other platforms degrade to unavailable until native backends are added.

const std = @import("std");
const builtin = @import("builtin");

const MAX_DEVICES: usize = 64;
const MAX_EVENTS: usize = 256;
const MAX_NAME: usize = 96;

const SND_SEQ_EVENT_NOTEON: u8 = 6;
const SND_SEQ_EVENT_NOTEOFF: u8 = 7;
const SND_SEQ_EVENT_CONTROLLER: u8 = 10;
const SND_SEQ_EVENT_CLOCK: u8 = 36;
const SND_SEQ_EVENT_START: u8 = 40;
const SND_SEQ_EVENT_STOP: u8 = 42;

const SND_SEQ_OPEN_INPUT: c_int = 2;
const SND_SEQ_NONBLOCK: c_int = 1;
const SND_SEQ_PORT_CAP_WRITE: c_uint = 0x02;
const SND_SEQ_PORT_CAP_SUBS_WRITE: c_uint = 0x40;
const SND_SEQ_PORT_CAP_READ: c_uint = 0x01;
const SND_SEQ_PORT_CAP_SUBS_READ: c_uint = 0x20;
const SND_SEQ_PORT_TYPE_MIDI_GENERIC: c_uint = 0x02;
const SND_SEQ_PORT_TYPE_APPLICATION: c_uint = 0x100000;

const MidiKind = enum(u8) {
    note_on,
    note_off,
    cc,
    clock,
    start,
    stop,
};

pub const MidiEvent = struct {
    kind: MidiKind = .clock,
    note: u8 = 0,
    velocity: u8 = 0,
    cc: u8 = 0,
    value: u8 = 0,
    channel: u8 = 0,
    device: [16]u8 = [_]u8{0} ** 16,
    device_len: u8 = 0,
};

const MidiDevice = struct {
    active: bool = false,
    id: [16]u8 = [_]u8{0} ** 16,
    id_len: u8 = 0,
    name: [MAX_NAME]u8 = [_]u8{0} ** MAX_NAME,
    name_len: u8 = 0,
    client: c_int = 0,
    port: c_int = 0,
    connected: bool = false,
};

const State = struct {
    started: bool = false,
    available: bool = false,
    seq: ?*snd_seq_t = null,
    port_id: c_int = -1,
    devices: [MAX_DEVICES]MidiDevice = [_]MidiDevice{.{}} ** MAX_DEVICES,
    device_count: usize = 0,
    events: [MAX_EVENTS]MidiEvent = [_]MidiEvent{.{}} ** MAX_EVENTS,
    head: usize = 0,
    tail: usize = 0,
};

var S: State = .{};

const snd_seq_t = opaque {};
const snd_seq_event_t = extern struct {
    type: u8,
    flags: u8,
    tag: u8,
    queue: u8,
    time_tick: c_int,
    time_pad: c_int,
    source_client: u8,
    source_port: u8,
    dest_client: u8,
    dest_port: u8,
    data: [12]u8,
};

extern fn snd_seq_open(handle: *?*snd_seq_t, name: [*:0]const u8, streams: c_int, mode: c_int) c_int;
extern fn snd_seq_close(handle: ?*snd_seq_t) c_int;
extern fn snd_seq_set_client_name(handle: ?*snd_seq_t, name: [*:0]const u8) c_int;
extern fn snd_seq_client_id(handle: ?*snd_seq_t) c_int;
extern fn snd_seq_create_simple_port(handle: ?*snd_seq_t, name: [*:0]const u8, caps: c_uint, port_type: c_uint) c_int;
extern fn snd_seq_connect_from(handle: ?*snd_seq_t, myport: c_int, src_client: c_int, src_port: c_int) c_int;
extern fn snd_seq_event_input(handle: ?*snd_seq_t, ev: *?*snd_seq_event_t) c_int;
extern fn snd_seq_event_input_pending(handle: ?*snd_seq_t, fetch_sequencer: c_int) c_int;

extern fn snd_seq_client_info_sizeof() usize;
extern fn snd_seq_port_info_sizeof() usize;
extern fn snd_seq_client_info_set_client(info: *anyopaque, client: c_int) void;
extern fn snd_seq_client_info_get_client(info: *anyopaque) c_int;
extern fn snd_seq_client_info_get_name(info: *anyopaque) [*:0]const u8;
extern fn snd_seq_port_info_set_client(info: *anyopaque, client: c_int) void;
extern fn snd_seq_port_info_set_port(info: *anyopaque, port: c_int) void;
extern fn snd_seq_port_info_get_port(info: *anyopaque) c_int;
extern fn snd_seq_port_info_get_name(info: *anyopaque) [*:0]const u8;
extern fn snd_seq_port_info_get_capability(info: *anyopaque) c_uint;
extern fn snd_seq_query_next_client(handle: ?*snd_seq_t, info: *anyopaque) c_int;
extern fn snd_seq_query_next_port(handle: ?*snd_seq_t, info: *anyopaque) c_int;

pub fn start() bool {
    if (builtin.os.tag != .linux) return false;
    return linuxStart();
}

pub fn stop() void {
    if (builtin.os.tag != .linux) {
        S = .{};
        return;
    }
    linuxStop();
}

pub fn isAvailable() bool {
    return S.available;
}

pub fn poll() usize {
    if (builtin.os.tag != .linux or !S.started or !S.available) return 0;
    return linuxPoll();
}

pub fn nextEvent() ?MidiEvent {
    if (S.head == S.tail) return null;
    const ev = S.events[S.head];
    S.head = (S.head + 1) % MAX_EVENTS;
    return ev;
}

pub fn devicesJson(out: []u8) []const u8 {
    var w = std.Io.Writer.fixed(out);
    w.writeAll("[") catch return w.buffered();
    for (0..S.device_count) |i| {
        const d = S.devices[i];
        if (i > 0) w.writeAll(",") catch break;
        w.print("{{\"id\":\"{s}\",\"name\":\"", .{d.id[0..d.id_len]}) catch break;
        writeJsonEscaped(&w, d.name[0..d.name_len]) catch break;
        w.print("\",\"connected\":{s}}}", .{if (d.connected) "true" else "false"}) catch break;
    }
    w.writeAll("]") catch {};
    return w.buffered();
}

pub fn eventJson(ev: MidiEvent, out: []u8) []const u8 {
    var w = std.Io.Writer.fixed(out);
    const typ = switch (ev.kind) {
        .note_on => "note_on",
        .note_off => "note_off",
        .cc => "cc",
        .clock => "clock",
        .start => "start",
        .stop => "stop",
    };
    w.print("{{\"type\":\"{s}\",\"note\":{d},\"velocity\":{d},\"cc\":{d},\"value\":{d},\"channel\":{d},\"device\":\"{s}\"}}", .{
        typ,
        ev.note,
        ev.velocity,
        ev.cc,
        ev.value,
        ev.channel,
        ev.device[0..ev.device_len],
    }) catch {};
    return w.buffered();
}

fn linuxStart() bool {
    if (S.started) return S.available;
    S = .{};

    var seq: ?*snd_seq_t = null;
    if (snd_seq_open(&seq, "default", SND_SEQ_OPEN_INPUT, SND_SEQ_NONBLOCK) < 0 or seq == null) {
        return false;
    }
    _ = snd_seq_set_client_name(seq, "ReactJIT Audio");
    const caps = SND_SEQ_PORT_CAP_WRITE | SND_SEQ_PORT_CAP_SUBS_WRITE;
    const port_type = SND_SEQ_PORT_TYPE_MIDI_GENERIC | SND_SEQ_PORT_TYPE_APPLICATION;
    const port_id = snd_seq_create_simple_port(seq, "MIDI In", caps, port_type);
    if (port_id < 0) {
        _ = snd_seq_close(seq);
        return false;
    }

    S.seq = seq;
    S.port_id = port_id;
    S.started = true;
    S.available = true;
    scanDevices();
    return true;
}

fn linuxStop() void {
    if (S.seq) |seq| {
        _ = snd_seq_close(seq);
    }
    S = .{};
}

fn linuxPoll() usize {
    const seq = S.seq orelse return 0;
    var count: usize = 0;
    while (snd_seq_event_input_pending(seq, 1) > 0) {
        var ev_ptr: ?*snd_seq_event_t = null;
        if (snd_seq_event_input(seq, &ev_ptr) < 0) break;
        const ev = ev_ptr orelse break;
        if (convertEvent(ev.*)) |midi_ev| {
            pushEvent(midi_ev);
            count += 1;
        }
        if (count >= MAX_EVENTS) break;
    }
    return count;
}

fn convertEvent(ev: snd_seq_event_t) ?MidiEvent {
    var out = MidiEvent{};
    setDevice(&out, ev.source_client, ev.source_port);
    switch (ev.type) {
        SND_SEQ_EVENT_NOTEON => {
            out.channel = ev.data[0];
            out.note = ev.data[1];
            out.velocity = ev.data[2];
            out.kind = if (out.velocity == 0) .note_off else .note_on;
            return out;
        },
        SND_SEQ_EVENT_NOTEOFF => {
            out.kind = .note_off;
            out.channel = ev.data[0];
            out.note = ev.data[1];
            out.velocity = 0;
            return out;
        },
        SND_SEQ_EVENT_CONTROLLER => {
            out.kind = .cc;
            out.channel = ev.data[0];
            const cc_raw: u16 = @as(u16, ev.data[4]) | (@as(u16, ev.data[5]) << 8);
            const value_raw: u16 = @as(u16, ev.data[8]) | (@as(u16, ev.data[9]) << 8);
            out.cc = @intCast(cc_raw % 128);
            out.value = @intCast(value_raw % 128);
            return out;
        },
        SND_SEQ_EVENT_CLOCK => {
            out.kind = .clock;
            return out;
        },
        SND_SEQ_EVENT_START => {
            out.kind = .start;
            return out;
        },
        SND_SEQ_EVENT_STOP => {
            out.kind = .stop;
            return out;
        },
        else => return null,
    }
}

fn pushEvent(ev: MidiEvent) void {
    const next = (S.tail + 1) % MAX_EVENTS;
    if (next == S.head) {
        S.head = (S.head + 1) % MAX_EVENTS;
    }
    S.events[S.tail] = ev;
    S.tail = next;
}

fn scanDevices() void {
    const seq = S.seq orelse return;
    S.device_count = 0;
    const my_client = snd_seq_client_id(seq);
    const client_info_size = snd_seq_client_info_sizeof();
    const port_info_size = snd_seq_port_info_sizeof();
    if (client_info_size == 0 or port_info_size == 0) return;

    const allocator = std.heap.c_allocator;
    const client_buf = allocator.alloc(u8, client_info_size) catch return;
    defer allocator.free(client_buf);
    const port_buf = allocator.alloc(u8, port_info_size) catch return;
    defer allocator.free(port_buf);

    @memset(client_buf, 0);
    snd_seq_client_info_set_client(client_buf.ptr, -1);
    while (snd_seq_query_next_client(seq, client_buf.ptr) >= 0) {
        const client_id = snd_seq_client_info_get_client(client_buf.ptr);
        if (client_id == my_client) continue;
        const client_name = std.mem.span(snd_seq_client_info_get_name(client_buf.ptr));

        @memset(port_buf, 0);
        snd_seq_port_info_set_client(port_buf.ptr, client_id);
        snd_seq_port_info_set_port(port_buf.ptr, -1);
        while (snd_seq_query_next_port(seq, port_buf.ptr) >= 0) {
            if (S.device_count >= MAX_DEVICES) break;
            const caps = snd_seq_port_info_get_capability(port_buf.ptr);
            const can_read = (caps & (SND_SEQ_PORT_CAP_READ | SND_SEQ_PORT_CAP_SUBS_READ)) == (SND_SEQ_PORT_CAP_READ | SND_SEQ_PORT_CAP_SUBS_READ);
            if (!can_read) continue;

            const port = snd_seq_port_info_get_port(port_buf.ptr);
            const port_name = std.mem.span(snd_seq_port_info_get_name(port_buf.ptr));
            var d = &S.devices[S.device_count];
            d.* = .{ .active = true, .client = client_id, .port = port };
            const id_text: []const u8 = std.fmt.bufPrint(&d.id, "{d}:{d}", .{ client_id, port }) catch "";
            d.id_len = @intCast(id_text.len);
            d.name_len = writeDeviceName(&d.name, client_name, port_name);
            d.connected = snd_seq_connect_from(seq, S.port_id, client_id, port) >= 0;
            S.device_count += 1;
        }
    }
}

fn writeDeviceName(out: *[MAX_NAME]u8, client_name: []const u8, port_name: []const u8) u8 {
    const text = std.fmt.bufPrint(out, "{s} - {s}", .{ client_name, port_name }) catch |err| switch (err) {
        error.NoSpaceLeft => out[0..],
    };
    return @intCast(@min(text.len, MAX_NAME));
}

fn setDevice(ev: *MidiEvent, client: u8, port: u8) void {
    const text = std.fmt.bufPrint(&ev.device, "{d}:{d}", .{ client, port }) catch "";
    ev.device_len = @intCast(text.len);
}

fn writeJsonEscaped(writer: anytype, text: []const u8) !void {
    for (text) |ch| {
        switch (ch) {
            '\\' => try writer.writeAll("\\\\"),
            '"' => try writer.writeAll("\\\""),
            '\n' => try writer.writeAll("\\n"),
            '\r' => try writer.writeAll("\\r"),
            '\t' => try writer.writeAll("\\t"),
            else => try writer.writeByte(ch),
        }
    }
}
