//! V8 host bindings for the raw audio-input subsystem
//! (framework/audio_input/audio_input.zig).
//!
//! Sibling to v8_bindings_voice — same SDL3 input source, but routed
//! into a no-VAD accumulator for music-quality sample capture. Carts
//! reach this through runtime/hooks/useRawCapture.ts.
//!
//! Exposes:
//!   __rawCapture_start()                → bool
//!       Open the default recording device at 44.1kHz f32 mono and begin
//!       accumulating into an in-memory buffer.
//!
//!   __rawCapture_stop(out_path: string) → bool
//!       Close the device and write the accumulated buffer as a 16-bit
//!       PCM mono WAV at out_path. Buffer is cleared regardless of write
//!       success so a failure doesn't pin memory.
//!
//!   __rawCapture_isRecording()          → bool
//!   __rawCapture_level()                → int (0..10000, peak-dBFS×100)
//!   __rawCapture_wasCapped()            → bool
//!       True if the last recording hit MAX_FRAMES (10 minutes). The cart
//!       can surface a warning when this is set.
//!
//! Events (fired from audio_input.tick on the engine thread):
//!   __rawCapture_onLevel(level_x100)
//!       Once per tick while recording, on the same 0..10000 peak-dBFS
//!       scale voice uses, so cart-side level meters share calibration.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const audio_input = @import("audio_input/audio_input.zig");

fn argToString(info: v8.FunctionCallbackInfo, idx: u32, buf: []u8) ?[]const u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    if (@as(usize, @intCast(n)) > buf.len) return null;
    _ = s.writeUtf8(iso, buf);
    return buf[0..@intCast(n)];
}

fn hostStart(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    // Optional device id arg. 0 (or missing) = SDL3 default recording.
    // Non-zero = an id from __audio_input_devices_json, including
    // PipeWire / PulseAudio monitor sources (capture-from-source).
    var device_id: u32 = 0;
    if (info.length() > 0) {
        const ctx = info.getIsolate().getCurrentContext();
        const raw = info.getArg(0).toI32(ctx) catch 0;
        device_id = if (raw > 0) @intCast(raw) else 0;
    }
    const ok = audio_input.startRecording(device_id);
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), ok));
}

fn hostStop(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var path_buf: [4096]u8 = undefined;
    const path = argToString(info, 0, &path_buf) orelse {
        info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), false));
        return;
    };
    const ok = audio_input.stopRecording(v8_runtime.hostContext(info.getIsolate()).io, path);
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), ok));
}

fn hostIsRecording(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), audio_input.isRecording()));
}

fn hostLevel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    info.getReturnValue().set(v8.Integer.initI32(info.getIsolate(), audio_input.getLevelX100()));
}

fn hostWasCapped(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), audio_input.wasCapped()));
}

pub fn registerAudioInput(_: anytype) void {
    v8_runtime.registerHostFn("__rawCapture_start", hostStart);
    v8_runtime.registerHostFn("__rawCapture_stop", hostStop);
    v8_runtime.registerHostFn("__rawCapture_isRecording", hostIsRecording);
    v8_runtime.registerHostFn("__rawCapture_level", hostLevel);
    v8_runtime.registerHostFn("__rawCapture_wasCapped", hostWasCapped);
}

pub fn tickDrain() void {
    // audio_input ticks itself in framework/audio_input/audio_input.zig.tick
    // (driven from engine.zig alongside voice.tick). The Ingredient table
    // calls tickDrain on every binding each frame; for audio_input the
    // actual draining happens inside audio_input.tick, so this is a no-op
    // kept only to satisfy the registry shape.
}
