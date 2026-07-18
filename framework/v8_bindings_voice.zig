//! V8 host bindings for the voice subsystem (framework/voice.zig).
//!
//! Exposes:
//!   __voice_start()                       → bool   open mic + begin VAD streaming
//!   __voice_stop()                        → void   close mic + finalise current utterance
//!   __voice_set_mode(int)                 → void   libfvad aggressiveness 0..3 (default 2)
//!   __voice_set_floor(int)                → void   amplitude floor 0..10000 (peak-dBFS ×100)
//!   __voice_set_preview_stride_ms(int)    → void   live-preview snapshot interval; 0 disables
//!   __voice_release_buffer(int)           → void   free a captured utterance buffer
//!
//! Events (fired from voice.tick on the engine thread, picked up by useVoiceInput):
//!   __voice_onLevel(rms_x100)      every tick while listening, 0..10000 (×100)
//!   __voice_onSpeechStart()        VAD edge: confirmed speech start
//!   __voice_onSpeechEnd(id, len)   VAD edge: confirmed silence end. id keys
//!                                  a buffer of `len` int16 samples.
//!   __voice_onPreviewReady(id, len) Periodic in-flight snapshot of the current
//!                                  utterance. Same buffer-store as SpeechEnd —
//!                                  JS calls __whisper_transcribe(id, model) on
//!                                  it for a live preview, then __voice_release_buffer(id).
//!   __voice_onTranscript(text)     fired by framework/whisper.zig when a
//!                                  transcription job completes. Carries the
//!                                  resolved text only; whisper.ts also fires
//!                                  __whisper_onResult with id+timing.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const voice = @import("voice/voice.zig");

fn argToI32(info: v8.FunctionCallbackInfo, idx: u32) ?i32 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return @as(i32, @intCast(info.getArg(idx).toI32(ctx) catch return null));
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.String.initUtf8(iso, text));
}

fn hostStart(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ok = voice.start();
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), ok));
}

fn hostStop(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    voice.stop(v8_runtime.hostContext(info.getIsolate()));
}

fn hostSetMode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const mode = argToI32(info, 0) orelse return;
    voice.setMode(@as(c_int, mode));
}

fn hostSetFloor(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const floor = argToI32(info, 0) orelse return;
    voice.setFloor(floor);
}

fn hostReleaseBuffer(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse return;
    if (id < 0) return;
    voice.releaseBuffer(@intCast(id));
}

fn hostSetPreviewStrideMs(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ms = argToI32(info, 0) orelse return;
    voice.setPreviewStrideMs(ms);
}

fn hostRecordingDevicesJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var buf: [4096]u8 = undefined;
    setReturnString(info, voice.recordingDevicesJson(&buf));
}

fn hostPlaybackDevicesJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var buf: [4096]u8 = undefined;
    setReturnString(info, voice.playbackDevicesJson(&buf));
}

pub fn registerVoice(_: anytype) void {
    v8_runtime.registerHostFn("__voice_start", hostStart);
    v8_runtime.registerHostFn("__voice_stop", hostStop);
    v8_runtime.registerHostFn("__voice_set_mode", hostSetMode);
    v8_runtime.registerHostFn("__voice_set_floor", hostSetFloor);
    v8_runtime.registerHostFn("__voice_set_preview_stride_ms", hostSetPreviewStrideMs);
    v8_runtime.registerHostFn("__voice_release_buffer", hostReleaseBuffer);
    v8_runtime.registerHostFn("__audio_input_devices_json", hostRecordingDevicesJson);
    v8_runtime.registerHostFn("__voice_recording_devices_json", hostRecordingDevicesJson);
    v8_runtime.registerHostFn("__audio_output_devices_json", hostPlaybackDevicesJson);
}

pub fn tickDrain() void {
    // Voice ticks itself in framework/voice.zig.tick (driven from engine.zig
    // alongside clipboard_watch). The Ingredient table calls tickDrain on
    // every binding each frame; for voice the actual draining happens inside
    // voice.tick, so this is a no-op kept only to satisfy the registry shape.
}
