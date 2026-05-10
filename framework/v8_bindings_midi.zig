//! V8 host bindings for framework/audio/midi.zig.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const midi = @import("audio/midi.zig");

fn infoCtx(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = infoCtx(info);
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = std.heap.c_allocator.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.String.initUtf8(iso, text));
}

fn setReturnNumber(info: v8.FunctionCallbackInfo, value: f64) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.Number.init(iso, value));
}

fn argToI32(info: v8.FunctionCallbackInfo, idx: u32) ?i32 {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toI32(infoCtx(info)) catch return null;
}

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toF64(infoCtx(info)) catch return null;
}

// ── MIDI host functions (framework/audio/midi.zig) ─────────

fn hostMidiStart(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (midi.start()) 1 else 0);
}

fn hostMidiStop(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    midi.stop();
}

fn hostMidiIsAvailable(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (midi.isAvailable()) 1 else 0);
}

fn hostMidiPoll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatFromInt(midi.poll()));
}

fn hostMidiDevicesJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var buf: [8192]u8 = undefined;
    setReturnString(info, midi.devicesJson(&buf));
}

fn hostMidiNextEventJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ev = midi.nextEvent() orelse {
        setReturnString(info, "");
        return;
    };
    var buf: [512]u8 = undefined;
    setReturnString(info, midi.eventJson(ev, &buf));
}

pub fn registerMidi(_: anytype) void {
    v8_runtime.registerHostFn("__midiStart", hostMidiStart);
    v8_runtime.registerHostFn("__midiStop", hostMidiStop);
    v8_runtime.registerHostFn("__midiIsAvailable", hostMidiIsAvailable);
    v8_runtime.registerHostFn("__midiPoll", hostMidiPoll);
    v8_runtime.registerHostFn("__midiDevicesJson", hostMidiDevicesJson);
    v8_runtime.registerHostFn("__midiNextEventJson", hostMidiNextEventJson);
    v8_runtime.registerHostFn("__midi_start", hostMidiStart);
    v8_runtime.registerHostFn("__midi_stop", hostMidiStop);
    v8_runtime.registerHostFn("__midi_is_available", hostMidiIsAvailable);
    v8_runtime.registerHostFn("__midi_poll", hostMidiPoll);
    v8_runtime.registerHostFn("__midi_devices_json", hostMidiDevicesJson);
    v8_runtime.registerHostFn("__midi_next_event_json", hostMidiNextEventJson);
}

pub fn tickDrain() void {}
