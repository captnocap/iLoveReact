//! V8 host bindings for framework/api.zig.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const api = @import("audio/api.zig");
const engine = @import("audio/engine.zig");
const state = @import("audio/state.zig");
const types = @import("audio/types.zig");

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

// ── Audio host functions (framework/api.zig synth engine) ───
// Module IDs are caller-managed (cart-side counter / useId mapping).
fn hostAudioAddModule(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse return;
    const mod_type = argToI32(info, 1) orelse return;
    _ = state.pushCommand(.{
        .cmd_type = .add_module,
        .module_id = @intCast(@max(0, id)),
        .module_type = @enumFromInt(@as(u8, @intCast(@max(0, @min(mod_type, 11))))),
    });
}

fn hostAudioRemoveModule(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse return;
    _ = state.pushCommand(.{
        .cmd_type = .remove_module,
        .module_id = @intCast(@max(0, id)),
    });
}

fn hostAudioConnect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const from = argToI32(info, 0) orelse return;
    const from_port = argToI32(info, 1) orelse return;
    const to = argToI32(info, 2) orelse return;
    const to_port = argToI32(info, 3) orelse return;
    _ = state.pushCommand(.{
        .cmd_type = .connect,
        .module_id = @intCast(@max(0, from)),
        .port_a = @intCast(@max(0, from_port)),
        .target_module = @intCast(@max(0, to)),
        .port_b = @intCast(@max(0, to_port)),
    });
}

fn hostAudioDisconnect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const from = argToI32(info, 0) orelse return;
    const from_port = argToI32(info, 1) orelse return;
    const to = argToI32(info, 2) orelse return;
    const to_port = argToI32(info, 3) orelse return;
    _ = state.pushCommand(.{
        .cmd_type = .disconnect,
        .module_id = @intCast(@max(0, from)),
        .port_a = @intCast(@max(0, from_port)),
        .target_module = @intCast(@max(0, to)),
        .port_b = @intCast(@max(0, to_port)),
    });
}

fn hostAudioConnectModules(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const from = argToI32(info, 0) orelse return;
    const to = argToI32(info, 1) orelse return;
    const from_port = argToI32(info, 2) orelse 0;
    const to_port = argToI32(info, 3) orelse 0;
    _ = state.pushCommand(.{
        .cmd_type = .connect,
        .module_id = @intCast(@max(0, from)),
        .port_a = @intCast(@max(0, from_port)),
        .target_module = @intCast(@max(0, to)),
        .port_b = @intCast(@max(0, to_port)),
    });
}

fn hostAudioDisconnectModules(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const from = argToI32(info, 0) orelse return;
    const to = argToI32(info, 1) orelse return;
    const from_port = argToI32(info, 2) orelse 0;
    const to_port = argToI32(info, 3) orelse 0;
    _ = state.pushCommand(.{
        .cmd_type = .disconnect,
        .module_id = @intCast(@max(0, from)),
        .port_a = @intCast(@max(0, from_port)),
        .target_module = @intCast(@max(0, to)),
        .port_b = @intCast(@max(0, to_port)),
    });
}

fn hostAudioSetParam(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse return;
    const param_idx = argToI32(info, 1) orelse return;
    const value = argToF64(info, 2) orelse return;
    _ = state.pushCommand(.{
        .cmd_type = .set_param,
        .module_id = @intCast(@max(0, id)),
        .param_index = @intCast(@max(0, param_idx)),
        .value_f = value,
    });
}

fn hostAudioNoteOn(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse return;
    const midi_note = argToI32(info, 1) orelse return;
    const velocity = argToF64(info, 2) orelse 1.0;
    _ = state.pushCommand(.{
        .cmd_type = .note_on,
        .module_id = @intCast(@max(0, id)),
        .value_i = midi_note,
        .value_f = velocity,
    });
}

fn hostAudioNoteOff(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse return;
    const midi_note = argToI32(info, 1) orelse -1;
    _ = state.pushCommand(.{
        .cmd_type = .note_off,
        .module_id = @intCast(@max(0, id)),
        .value_i = midi_note,
    });
}

fn hostAudioMasterGain(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const gain = argToF64(info, 0) orelse return;
    _ = state.pushCommand(.{
        .cmd_type = .set_master_gain,
        .value_f = gain,
    });
}

fn hostAudioSetTempo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const start_tempo = argToF64(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const start_measure = argToF64(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const has_end_tempo = info.length() >= 3;
    const has_end_measure = info.length() >= 4;
    const end_tempo = if (has_end_tempo) (argToF64(info, 2) orelse start_tempo) else start_tempo;
    const end_measure = if (has_end_measure) (argToF64(info, 3) orelse start_measure) else start_measure;
    setReturnNumber(info, if (api.setTempo(start_tempo, start_measure, end_tempo, end_measure, has_end_tempo, has_end_measure)) 1 else 0);
}

fn hostAudioMakeBeat(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const sound_spec = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(sound_spec);

    const track = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const start_measure = argToF64(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const beat = argToStringAlloc(info, 3) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(beat);
    const steps_per_measure = argToF64(info, 4) orelse 16.0;
    setReturnNumber(info, if (api.makeBeat(sound_spec, track, start_measure, beat, steps_per_measure)) 1 else 0);
}

fn hostAudioMakeBeatSlice(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const sound_spec = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(sound_spec);

    const track = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const start_measure = argToF64(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const beat = argToStringAlloc(info, 3) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(beat);
    const slice_spec = argToStringAlloc(info, 4) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(slice_spec);
    const steps_per_measure = argToF64(info, 5) orelse 16.0;
    setReturnNumber(info, if (api.makeBeatSlice(sound_spec, track, start_measure, beat, slice_spec, steps_per_measure)) 1 else 0);
}

fn hostAudioInsertMedia(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const sound_spec = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(sound_spec);

    const track = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const start_measure = argToF64(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    setReturnNumber(info, if (api.insertMedia(sound_spec, track, start_measure)) 1 else 0);
}

fn hostAudioFitMedia(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const sound_spec = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(sound_spec);

    const track = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const start_measure = argToF64(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const end_measure = argToF64(info, 3) orelse {
        setReturnNumber(info, 0);
        return;
    };
    setReturnNumber(info, if (api.fitMedia(sound_spec, track, start_measure, end_measure)) 1 else 0);
}

fn hostAudioInsertMediaSection(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const sound_spec = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(sound_spec);

    const track = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const start_measure = argToF64(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const slice_start = argToF64(info, 3) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const slice_end = argToF64(info, 4) orelse {
        setReturnNumber(info, 0);
        return;
    };
    setReturnNumber(info, if (api.insertMediaSection(sound_spec, track, start_measure, slice_start, slice_end)) 1 else 0);
}

fn hostAudioClearTrack(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const track = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const has_range = info.length() >= 3;
    const start_measure = if (has_range) (argToF64(info, 1) orelse 1.0) else 1.0;
    const end_measure = if (has_range) (argToF64(info, 2) orelse start_measure) else start_measure;
    setReturnNumber(info, if (api.clearTrack(track, start_measure, end_measure, has_range)) 1 else 0);
}

fn hostAudioSetTrackVolume(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const track = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const volume = argToF64(info, 1) orelse 1.0;
    setReturnNumber(info, if (api.setTrackVolume(track, volume)) 1 else 0);
}

fn hostAudioSetTrackPan(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const track = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const pan = argToF64(info, 1) orelse 0;
    setReturnNumber(info, if (api.setTrackPan(track, pan)) 1 else 0);
}

fn hostAudioSetTrackMute(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const track = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const muted = (argToI32(info, 1) orelse 0) != 0;
    setReturnNumber(info, if (api.setTrackMute(track, muted)) 1 else 0);
}

fn hostAudioSetTrackSolo(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const track = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const soloed = (argToI32(info, 1) orelse 0) != 0;
    setReturnNumber(info, if (api.setTrackSolo(track, soloed)) 1 else 0);
}

fn hostAudioSetStepVelocity(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const track = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const step = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const velocity = argToF64(info, 2) orelse 1.0;
    setReturnNumber(info, if (api.setStepVelocity(track, step, velocity)) 1 else 0);
}

fn hostAudioSetStepProbability(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const track = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const step = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const probability = argToF64(info, 2) orelse 1.0;
    setReturnNumber(info, if (api.setStepProbability(track, step, probability)) 1 else 0);
}

fn hostAudioSetStepOffset(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const track = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const step = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const offset = argToF64(info, 2) orelse 0;
    setReturnNumber(info, if (api.setStepOffset(track, step, offset)) 1 else 0);
}

fn hostAudioSetStep(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const module_id = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const track = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const step = argToI32(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const active = (argToI32(info, 3) orelse 0) != 0;
    const note = argToI32(info, 4) orelse 36;
    const velocity = argToF64(info, 5) orelse 100.0;
    setReturnNumber(info, if (api.setStep(@intCast(@max(0, module_id)), track, step, active, note, velocity)) 1 else 0);
}

fn hostAudioSetTrackTarget(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const module_id = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const track = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const target = argToI32(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    setReturnNumber(info, if (api.setTrackTarget(@intCast(@max(0, module_id)), track, @intCast(@max(0, target)))) 1 else 0);
}

fn hostAudioClearPattern(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const module_id = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    setReturnNumber(info, if (api.clearPattern(@intCast(@max(0, module_id)))) 1 else 0);
}

fn hostAudioClockPulse(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const module_id = argToI32(info, 0) orelse 0;
    setReturnNumber(info, if (api.clockPulse(@intCast(@max(0, module_id)))) 1 else 0);
}

fn hostAudioClockStart(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const module_id = argToI32(info, 0) orelse 0;
    setReturnNumber(info, if (api.clockStart(@intCast(@max(0, module_id)))) 1 else 0);
}

fn hostAudioClockStop(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const module_id = argToI32(info, 0) orelse 0;
    setReturnNumber(info, if (api.clockStop(@intCast(@max(0, module_id)))) 1 else 0);
}

fn hostAudioDur(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const sound_spec = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(sound_spec);
    setReturnNumber(info, api.dur(sound_spec));
}

fn hostAudioCreateAudioStretch(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const sound_spec = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(sound_spec);
    const stretch_factor = argToF64(info, 1) orelse 1.0;
    setReturnNumber(info, api.createAudioStretch(sound_spec, stretch_factor));
}

fn hostAudioCreateAudioSlice(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const sound_spec = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(sound_spec);
    const slice_start = argToF64(info, 1) orelse 1.0;
    const slice_end = argToF64(info, 2) orelse slice_start;
    setReturnNumber(info, api.createAudioSlice(sound_spec, slice_start, slice_end));
}

fn hostAudioLoadSound(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const path = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(path);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    setReturnNumber(info, api.loadSound(io, path));
}

fn hostAudioLoadSample(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const slot = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const path = argToStringAlloc(info, 2) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(path);
    const mode = argToStringAlloc(info, 3) orelse std.heap.c_allocator.dupe(u8, "oneshot") catch {
        setReturnNumber(info, 0);
        return;
    };
    defer std.heap.c_allocator.free(mode);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    setReturnNumber(info, if (api.loadSample(io, @intCast(@max(0, id)), slot, path, mode)) 1 else 0);
}

fn hostAudioClearSample(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const slot = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    setReturnNumber(info, if (api.clearSample(@intCast(@max(0, id)), slot)) 1 else 0);
}

fn hostAudioPlay(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (api.play()) 1 else 0);
}

fn hostAudioTransportPause(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (api.pauseTransport()) 1 else 0);
}

fn hostAudioStop(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (api.stop()) 1 else 0);
}

fn hostAudioSetPlayhead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const measure = argToF64(info, 0) orelse 1.0;
    setReturnNumber(info, if (api.setPlayhead(measure)) 1 else 0);
}

fn hostAudioGetPlayhead(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, api.getPlayhead());
}

fn hostAudioIsPlaying(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (api.isPlaying()) 1 else 0);
}

fn hostAudioInit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (engine.init(v8_runtime.hostContext(info.getIsolate()).io)) 1 else 0);
}

fn hostAudioDeinit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    engine.deinit();
}

fn hostAudioIsInitialized(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (engine.isInitialized()) 1 else 0);
}

fn hostAudioPause(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    engine.pauseDevice();
}

fn hostAudioResume(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = info_c;
    engine.resumeDevice();
}

fn hostAudioGetModuleCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, api.getModuleCount());
}

fn hostAudioGetConnectionCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, api.getConnectionCount());
}

fn hostAudioGetCallbackCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatFromInt(api.getCallbackCount()));
}

fn hostAudioGetCallbackUs(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatFromInt(api.getCallbackUs()));
}

fn hostAudioGetSampleRate(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, types.SAMPLE_RATE);
}

fn hostAudioGetBufferSize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, types.BUFFER_SIZE);
}

fn hostAudioGetPeakLevel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatCast(api.getPeakLevel()));
}

fn hostAudioGetParam(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const param_idx = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (id < 0 or param_idx < 0 or param_idx > 255) {
        setReturnNumber(info, 0);
        return;
    }
    setReturnNumber(info, api.getParam(@intCast(id), @intCast(param_idx)));
}

fn hostAudioGetParamCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (id < 0) {
        setReturnNumber(info, 0);
        return;
    }
    setReturnNumber(info, api.getParamCount(@intCast(id)));
}

fn hostAudioGetPortCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (id < 0) {
        setReturnNumber(info, 0);
        return;
    }
    setReturnNumber(info, api.getPortCount(@intCast(id)));
}

fn hostAudioGetModuleType(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse {
        setReturnNumber(info, -1);
        return;
    };
    if (id < 0) {
        setReturnNumber(info, -1);
        return;
    }
    setReturnNumber(info, api.getModuleType(@intCast(id)));
}

fn hostAudioGetParamMin(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const param_idx = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (id < 0 or param_idx < 0 or param_idx > 255) {
        setReturnNumber(info, 0);
        return;
    }
    setReturnNumber(info, api.getParamMin(@intCast(id), @intCast(param_idx)));
}

fn hostAudioGetParamMax(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argToI32(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    const param_idx = argToI32(info, 1) orelse {
        setReturnNumber(info, 0);
        return;
    };
    if (id < 0 or param_idx < 0 or param_idx > 255) {
        setReturnNumber(info, 0);
        return;
    }
    setReturnNumber(info, api.getParamMax(@intCast(id), @intCast(param_idx)));
}

pub fn registerAudio(_: anytype) void {
    v8_runtime.registerHostFn("__audioAddModule", hostAudioAddModule);
    v8_runtime.registerHostFn("__audioRemoveModule", hostAudioRemoveModule);
    v8_runtime.registerHostFn("__audioConnect", hostAudioConnect);
    v8_runtime.registerHostFn("__audioDisconnect", hostAudioDisconnect);
    v8_runtime.registerHostFn("__audioConnectModules", hostAudioConnectModules);
    v8_runtime.registerHostFn("__audioDisconnectModules", hostAudioDisconnectModules);
    v8_runtime.registerHostFn("__audioSetParam", hostAudioSetParam);
    v8_runtime.registerHostFn("__audioNoteOn", hostAudioNoteOn);
    v8_runtime.registerHostFn("__audioNoteOff", hostAudioNoteOff);
    v8_runtime.registerHostFn("__audioMasterGain", hostAudioMasterGain);
    v8_runtime.registerHostFn("__audioSetMasterVolume", hostAudioMasterGain);
    v8_runtime.registerHostFn("__audioSetTempo", hostAudioSetTempo);
    v8_runtime.registerHostFn("__audioMakeBeat", hostAudioMakeBeat);
    v8_runtime.registerHostFn("__audioMakeBeatSlice", hostAudioMakeBeatSlice);
    v8_runtime.registerHostFn("__audioMakePattern", hostAudioMakeBeat);
    v8_runtime.registerHostFn("__audioMakeSlicePattern", hostAudioMakeBeatSlice);
    v8_runtime.registerHostFn("__audioInsertMedia", hostAudioInsertMedia);
    v8_runtime.registerHostFn("__audioFitMedia", hostAudioFitMedia);
    v8_runtime.registerHostFn("__audioInsertMediaSection", hostAudioInsertMediaSection);
    v8_runtime.registerHostFn("__audioClearTrack", hostAudioClearTrack);
    v8_runtime.registerHostFn("__audioSetTrackVolume", hostAudioSetTrackVolume);
    v8_runtime.registerHostFn("__audioSetTrackPan", hostAudioSetTrackPan);
    v8_runtime.registerHostFn("__audioSetTrackMute", hostAudioSetTrackMute);
    v8_runtime.registerHostFn("__audioSetTrackSolo", hostAudioSetTrackSolo);
    v8_runtime.registerHostFn("__audioSetStepVelocity", hostAudioSetStepVelocity);
    v8_runtime.registerHostFn("__audioSetStepProbability", hostAudioSetStepProbability);
    v8_runtime.registerHostFn("__audioSetStepOffset", hostAudioSetStepOffset);
    v8_runtime.registerHostFn("__audioSetStep", hostAudioSetStep);
    v8_runtime.registerHostFn("__audioSetTrackTarget", hostAudioSetTrackTarget);
    v8_runtime.registerHostFn("__audioClearPattern", hostAudioClearPattern);
    v8_runtime.registerHostFn("__audioClockPulse", hostAudioClockPulse);
    v8_runtime.registerHostFn("__audioClockStart", hostAudioClockStart);
    v8_runtime.registerHostFn("__audioClockStop", hostAudioClockStop);
    v8_runtime.registerHostFn("__audioDur", hostAudioDur);
    v8_runtime.registerHostFn("__audioCreateAudioStretch", hostAudioCreateAudioStretch);
    v8_runtime.registerHostFn("__audioCreateAudioSlice", hostAudioCreateAudioSlice);
    v8_runtime.registerHostFn("__audioStretchSound", hostAudioCreateAudioStretch);
    v8_runtime.registerHostFn("__audioSliceSound", hostAudioCreateAudioSlice);
    v8_runtime.registerHostFn("__audioLoadSound", hostAudioLoadSound);
    v8_runtime.registerHostFn("__audioLoadSample", hostAudioLoadSample);
    v8_runtime.registerHostFn("__audioClearSample", hostAudioClearSample);
    v8_runtime.registerHostFn("__audioPlay", hostAudioPlay);
    v8_runtime.registerHostFn("__audioPause", hostAudioTransportPause);
    v8_runtime.registerHostFn("__audioStop", hostAudioStop);
    v8_runtime.registerHostFn("__audioSetPlayhead", hostAudioSetPlayhead);
    v8_runtime.registerHostFn("__audioGetPlayhead", hostAudioGetPlayhead);
    v8_runtime.registerHostFn("__audioIsPlaying", hostAudioIsPlaying);
    v8_runtime.registerHostFn("__audioGetModuleCount", hostAudioGetModuleCount);
    v8_runtime.registerHostFn("__audioGetConnectionCount", hostAudioGetConnectionCount);
    v8_runtime.registerHostFn("__audioGetCallbackTime", hostAudioGetCallbackUs);
    v8_runtime.registerHostFn("__audioGetPeakLevel", hostAudioGetPeakLevel);
    v8_runtime.registerHostFn("__audio_init", hostAudioInit);
    v8_runtime.registerHostFn("__audio_deinit", hostAudioDeinit);
    v8_runtime.registerHostFn("__audio_is_initialized", hostAudioIsInitialized);
    v8_runtime.registerHostFn("__audio_pause", hostAudioPause);
    v8_runtime.registerHostFn("__audio_resume", hostAudioResume);
    v8_runtime.registerHostFn("__audio_add_module", hostAudioAddModule);
    v8_runtime.registerHostFn("__audio_remove_module", hostAudioRemoveModule);
    v8_runtime.registerHostFn("__audio_connect", hostAudioConnect);
    v8_runtime.registerHostFn("__audio_disconnect", hostAudioDisconnect);
    v8_runtime.registerHostFn("__audio_connect_modules", hostAudioConnectModules);
    v8_runtime.registerHostFn("__audio_disconnect_modules", hostAudioDisconnectModules);
    v8_runtime.registerHostFn("__audio_set_param", hostAudioSetParam);
    v8_runtime.registerHostFn("__audio_get_param", hostAudioGetParam);
    v8_runtime.registerHostFn("__audio_note_on", hostAudioNoteOn);
    v8_runtime.registerHostFn("__audio_note_off", hostAudioNoteOff);
    v8_runtime.registerHostFn("__audio_set_master_gain", hostAudioMasterGain);
    v8_runtime.registerHostFn("__audio_set_master_volume", hostAudioMasterGain);
    v8_runtime.registerHostFn("__audio_set_tempo", hostAudioSetTempo);
    v8_runtime.registerHostFn("__audio_make_beat", hostAudioMakeBeat);
    v8_runtime.registerHostFn("__audio_make_beat_slice", hostAudioMakeBeatSlice);
    v8_runtime.registerHostFn("__audio_make_pattern", hostAudioMakeBeat);
    v8_runtime.registerHostFn("__audio_make_slice_pattern", hostAudioMakeBeatSlice);
    v8_runtime.registerHostFn("__audio_insert_media", hostAudioInsertMedia);
    v8_runtime.registerHostFn("__audio_fit_media", hostAudioFitMedia);
    v8_runtime.registerHostFn("__audio_insert_media_section", hostAudioInsertMediaSection);
    v8_runtime.registerHostFn("__audio_clear_track", hostAudioClearTrack);
    v8_runtime.registerHostFn("__audio_set_track_volume", hostAudioSetTrackVolume);
    v8_runtime.registerHostFn("__audio_set_track_pan", hostAudioSetTrackPan);
    v8_runtime.registerHostFn("__audio_set_track_mute", hostAudioSetTrackMute);
    v8_runtime.registerHostFn("__audio_set_track_solo", hostAudioSetTrackSolo);
    v8_runtime.registerHostFn("__audio_set_step_velocity", hostAudioSetStepVelocity);
    v8_runtime.registerHostFn("__audio_set_step_probability", hostAudioSetStepProbability);
    v8_runtime.registerHostFn("__audio_set_step_offset", hostAudioSetStepOffset);
    v8_runtime.registerHostFn("__audio_set_step", hostAudioSetStep);
    v8_runtime.registerHostFn("__audio_set_track_target", hostAudioSetTrackTarget);
    v8_runtime.registerHostFn("__audio_clear_pattern", hostAudioClearPattern);
    v8_runtime.registerHostFn("__audio_clock_pulse", hostAudioClockPulse);
    v8_runtime.registerHostFn("__audio_clock_start", hostAudioClockStart);
    v8_runtime.registerHostFn("__audio_clock_stop", hostAudioClockStop);
    v8_runtime.registerHostFn("__audio_dur", hostAudioDur);
    v8_runtime.registerHostFn("__audio_create_audio_stretch", hostAudioCreateAudioStretch);
    v8_runtime.registerHostFn("__audio_create_audio_slice", hostAudioCreateAudioSlice);
    v8_runtime.registerHostFn("__audio_stretch_sound", hostAudioCreateAudioStretch);
    v8_runtime.registerHostFn("__audio_slice_sound", hostAudioCreateAudioSlice);
    v8_runtime.registerHostFn("__audio_load_sound", hostAudioLoadSound);
    v8_runtime.registerHostFn("__audio_load_sample", hostAudioLoadSample);
    v8_runtime.registerHostFn("__audio_clear_sample", hostAudioClearSample);
    v8_runtime.registerHostFn("__audio_play", hostAudioPlay);
    v8_runtime.registerHostFn("__audio_transport_pause", hostAudioTransportPause);
    v8_runtime.registerHostFn("__audio_stop", hostAudioStop);
    v8_runtime.registerHostFn("__audio_set_playhead", hostAudioSetPlayhead);
    v8_runtime.registerHostFn("__audio_get_playhead", hostAudioGetPlayhead);
    v8_runtime.registerHostFn("__audio_is_playing", hostAudioIsPlaying);
    v8_runtime.registerHostFn("__audio_get_module_count", hostAudioGetModuleCount);
    v8_runtime.registerHostFn("__audio_get_connection_count", hostAudioGetConnectionCount);
    v8_runtime.registerHostFn("__audio_get_callback_count", hostAudioGetCallbackCount);
    v8_runtime.registerHostFn("__audio_get_callback_us", hostAudioGetCallbackUs);
    v8_runtime.registerHostFn("__audio_get_sample_rate", hostAudioGetSampleRate);
    v8_runtime.registerHostFn("__audio_get_buffer_size", hostAudioGetBufferSize);
    v8_runtime.registerHostFn("__audio_get_peak_level", hostAudioGetPeakLevel);
    v8_runtime.registerHostFn("__audio_get_param_count", hostAudioGetParamCount);
    v8_runtime.registerHostFn("__audio_get_port_count", hostAudioGetPortCount);
    v8_runtime.registerHostFn("__audio_get_module_type", hostAudioGetModuleType);
    v8_runtime.registerHostFn("__audio_get_param_min", hostAudioGetParamMin);
    v8_runtime.registerHostFn("__audio_get_param_max", hostAudioGetParamMax);
}

pub fn tickDrain() void {}
