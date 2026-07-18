//! V8 host bindings for whisper.cpp speech-to-text (framework/whisper.zig).
//!
//! Exposes:
//!   __whisper_transcribe(buf_id, model_path) → bool
//!     Submit a transcribe job. buf_id comes from the voice subsystem
//!     (__voice_onSpeechEnd fires with one). Result fires async on the
//!     engine tick via __voice_onTranscript(text) AND
//!     __whisper_onResult(json) for benchmark-style consumption.
//!
//! Events fired:
//!   __voice_onTranscript(text)   plain text result; cart hook just
//!                                surfaces it via the `transcript` field.
//!   __whisper_onResult(json)     {"buf_id":N,"model":"...","text":"...",
//!                                "elapsed_ms":N,"success":bool} for
//!                                benchmark-style detail (timing, swap models).

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const whisper = @import("voice/whisper.zig");

const alloc = std.heap.c_allocator;

fn argToI32(info: v8.FunctionCallbackInfo, idx: u32) ?i32 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return @as(i32, @intCast(info.getArg(idx).toI32(ctx) catch return null));
}

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn hostTranscribe(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const buf_id = argToI32(info, 0) orelse return;
    if (buf_id < 0) return;
    const model_path = argToStringAlloc(info, 1) orelse return;
    defer alloc.free(model_path);
    const ok = whisper.enqueueTranscribe(v8_runtime.hostContext(info.getIsolate()).io, @intCast(buf_id), model_path);
    info.getReturnValue().set(v8.Boolean.init(info.getIsolate(), ok));
}

pub fn registerWhisper(_: anytype) void {
    v8_runtime.registerHostFn("__whisper_transcribe", hostTranscribe);
}

pub fn tickDrain() void {
    // whisper.tick is called from engine.zig directly (alongside voice.tick)
    // since we want timing fidelity. This stub keeps the Ingredient table
    // shape consistent.
}
