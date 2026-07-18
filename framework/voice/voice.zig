// voice.zig — microphone capture + WebRTC VAD (libfvad).
//
// Wire shape mirrors clipboard_watch.zig: init() at boot, tick(dt_ms) on every
// engine frame, fires JS callbacks via v8_runtime.callGlobal*.
//
// SDL3 records to a stream (16kHz, s16 mono); each tick drains whatever is
// available, feeds 30ms frames to libfvad, runs an utterance state machine,
// and emits __voice_on* events. Captured PCM is held in stable per-utterance
// buffers (id-keyed) so a JS-side hook can later hand them to whisper.cpp.
//
// JS-callable host functions are *not* registered here — the JS side calls
// rjit_voice_start / rjit_voice_stop via v8_bindings_voice.zig (added in a
// follow-up commit). For the first pass start/stop are driven from Zig: voice
// capture begins on first __voice_start() bus event from JS, which JS triggers
// when the cart asks via globalThis.__voice_start.

const std = @import("std");
const c = @import("../c.zig").imports;
const v8_runtime = @import("../v8_runtime.zig");
const HostContext = @import("../host_context.zig");

const fvad = @cImport({
    @cInclude("fvad.h");
});

// ── Tunables ──────────────────────────────────────────────────────────
//
// 16kHz / 30ms frame = 480 samples (libfvad accepts 10/20/30ms; longer is
// more accurate). 16-bit signed mono is the SDL3 spec the device opens at;
// libfvad consumes the same int16 interleaved buffer directly.
const SAMPLE_RATE: c_int = 16000;
const FRAME_MS: u32 = 30;
const FRAME_SAMPLES: usize = @as(usize, @intCast(SAMPLE_RATE)) * FRAME_MS / 1000; // 480
const FRAME_BYTES: usize = FRAME_SAMPLES * @sizeOf(i16);

// VAD aggressiveness 0..3. 2 = "aggressive" — best general default per the
// libfvad docs (3 over-rejects in real rooms; 0/1 trigger on fans).
const DEFAULT_MODE: c_int = 2;

// Edge debounce. We require N consecutive speech frames to declare start
// (rejects single-frame mouth clicks) and M consecutive silence frames to
// declare end (lets natural mid-sentence pauses through).
const SPEECH_START_FRAMES: u32 = 3; // ~90ms
const SILENCE_END_FRAMES: u32 = 25; // ~750ms — natural sentence-end pause

// Hard cap per utterance buffer (30 seconds). Past this we force-close the
// utterance and emit __voice_onSpeechEnd so whisper sees something.
const MAX_UTTERANCE_SAMPLES: usize = @as(usize, @intCast(SAMPLE_RATE)) * 30;

// Live-preview defaults. While the user is mid-utterance we periodically
// snapshot the in-flight PCM into a stable id-keyed buffer so JS can
// transcribe it for a live preview. Whisper's encoder runs a fixed 30s
// context regardless of input length, so previews don't gain much from
// sub-clipping — the stride is tuned to "don't queue faster than tiny can
// drain". 0 disables the feature.
const DEFAULT_PREVIEW_STRIDE_FRAMES: u32 = 1500 / FRAME_MS; // ~1500ms
const DEFAULT_PREVIEW_MIN_FRAMES: u32 = 1000 / FRAME_MS; // ~1s of speech

// ── State ─────────────────────────────────────────────────────────────

const Phase = enum(u8) { idle, candidate_speech, speaking, candidate_silence };

const State = struct {
    initialized: bool = false,
    listening: bool = false,
    stream: ?*c.SDL_AudioStream = null,
    fvad_inst: ?*fvad.Fvad = null,

    phase: Phase = .idle,
    consec_speech: u32 = 0,
    consec_silence: u32 = 0,

    // 30ms scratch frame (drained from SDL stream).
    frame: [FRAME_SAMPLES]i16 = undefined,

    // Current utterance buffer. Grows while phase != .idle. Captured at
    // utterance-end into a stable slot keyed by next_buf_id.
    utterance: std.array_list.Managed(i16) = undefined,

    // Stable id → owned PCM. JS-side hook reads via rjit_voice_take_buffer.
    buffers: std.AutoArrayHashMapUnmanaged(u32, []i16) = .empty,
    next_buf_id: u32 = 1,

    // Running RMS over the last drained frame. Reported via __voice_onLevel
    // for cart-side level-meter visualisations.
    last_rms_x100: i32 = 0,

    // Most recent libfvad per-frame verdict (no debounce). 0 = silence,
    // 1 = speech. Useful for visualising the raw VAD vs the debounced
    // utterance edges; reported alongside level via __voice_onLevel.
    last_vad_verdict: i32 = 0,

    // Amplitude floor: any frame below this peak-dBFS-derived level is
    // forced to silent regardless of fvad's verdict. Stored on the same
    // 0..10000 scale as last_rms_x100. 0 = no gate. Defaults off so a
    // cart that doesn't care gets pure libfvad behaviour.
    floor_x100: i32 = 0,

    // Live-preview stride: emit a snapshot of the in-flight utterance
    // every N frames while in .speaking/.candidate_silence. 0 = disabled.
    // frames_in_speech tracks ms-since-speech-start (in frame units) so we
    // can suppress previews that fire on too-short audio.
    preview_stride_frames: u32 = DEFAULT_PREVIEW_STRIDE_FRAMES,
    preview_min_frames: u32 = DEFAULT_PREVIEW_MIN_FRAMES,
    frames_in_speech: u32 = 0,
    frames_since_preview: u32 = 0,

    allocator: std.mem.Allocator = undefined,
};

var S: State = .{};

// ── Lifecycle ─────────────────────────────────────────────────────────

pub fn init(allocator: std.mem.Allocator) void {
    if (S.initialized) return;
    S.allocator = allocator;
    S.utterance = std.array_list.Managed(i16).init(allocator);
    S.buffers = .empty;
    S.initialized = true;
    // Stream + fvad created lazily on first start().
}

pub fn deinit(host: *HostContext) void {
    if (!S.initialized) return;
    stop(host);
    if (S.fvad_inst) |inst| fvad.fvad_free(inst);
    S.fvad_inst = null;
    S.utterance.deinit();
    var it = S.buffers.iterator();
    while (it.next()) |entry| S.allocator.free(entry.value_ptr.*);
    S.buffers.deinit(S.allocator);
    S.initialized = false;
}

// ── Capture control (called from JS via v8_bindings_voice.zig) ────────

pub fn start() bool {
    if (!S.initialized) return false;
    if (S.listening) return true;

    // Lazy-init libfvad.
    if (S.fvad_inst == null) {
        const inst = fvad.fvad_new() orelse return false;
        _ = fvad.fvad_set_sample_rate(inst, SAMPLE_RATE);
        _ = fvad.fvad_set_mode(inst, DEFAULT_MODE);
        S.fvad_inst = inst;
    }

    // Open the default recording device at our target spec. SDL3 internally
    // resamples / converts; we always read frames at SAMPLE_RATE/s16/mono.
    var spec: c.SDL_AudioSpec = .{
        .format = c.SDL_AUDIO_S16LE,
        .channels = 1,
        .freq = SAMPLE_RATE,
    };
    const stream = c.SDL_OpenAudioDeviceStream(
        c.SDL_AUDIO_DEVICE_DEFAULT_RECORDING,
        &spec,
        null, // no callback — we poll on tick
        null,
    );
    if (stream == null) return false;
    if (!c.SDL_ResumeAudioStreamDevice(stream)) {
        c.SDL_DestroyAudioStream(stream);
        return false;
    }
    S.stream = stream;
    S.listening = true;
    resetPhase();
    return true;
}

pub fn stop(host: *HostContext) void {
    if (!S.listening) return;
    S.listening = false;
    if (S.stream) |stream| {
        c.SDL_DestroyAudioStream(stream);
        S.stream = null;
    }
    // If we were mid-utterance, finalise so whisper sees the last bit.
    if (S.phase == .speaking or S.phase == .candidate_silence) {
        finaliseUtterance(host);
    }
    resetPhase();
}

pub fn setMode(mode: c_int) void {
    if (S.fvad_inst) |inst| _ = fvad.fvad_set_mode(inst, mode);
}

/// Sets an amplitude floor on the same 0..10000 scale the level callback
/// fires on (peak-dBFS, -60..0 → 0..10000). Frames quieter than this are
/// counted as silence regardless of the libfvad verdict — useful for
/// rejecting mid-band ambient (HVAC, distant typing) that the GMM mistakes
/// for speech. Pass 0 to disable.
pub fn setFloor(floor_x100: i32) void {
    S.floor_x100 = if (floor_x100 < 0) 0 else floor_x100;
}

fn resetPhase() void {
    S.phase = .idle;
    S.consec_speech = 0;
    S.consec_silence = 0;
    S.utterance.clearRetainingCapacity();
    S.frames_in_speech = 0;
    S.frames_since_preview = 0;
}

/// Configure how often a live-preview snapshot fires while mid-utterance.
/// 0 disables. Floored to 90ms (3 frames) — anything shorter would queue
/// faster than even tiny.en can drain at typical CPU speeds.
pub fn setPreviewStrideMs(ms: i32) void {
    if (ms <= 0) {
        S.preview_stride_frames = 0;
        return;
    }
    const ms_u: u32 = @intCast(ms);
    var frames: u32 = ms_u / FRAME_MS;
    if (frames < 3) frames = 3;
    S.preview_stride_frames = frames;
}

pub fn recordingDevicesJson(out: []u8) []const u8 {
    var w = std.Io.Writer.fixed(out);
    var count: c_int = 0;
    const devices = c.SDL_GetAudioRecordingDevices(&count);
    w.writeAll("[") catch return w.buffered();
    if (devices) |ids| {
        defer c.SDL_free(ids);
        var i: c_int = 0;
        while (i < count) : (i += 1) {
            if (i > 0) w.writeAll(",") catch break;
            const id = ids[@intCast(i)];
            const name_ptr = c.SDL_GetAudioDeviceName(id);
            const name = if (name_ptr) |p| std.mem.span(p) else "";
            w.print("{{\"id\":{d},\"name\":\"", .{id}) catch break;
            writeJsonEscaped(&w, name) catch break;
            w.writeAll("\"}") catch break;
        }
    }
    w.writeAll("]") catch {};
    return w.buffered();
}

/// Playback (output) device enumeration. Sibling to recordingDevicesJson
/// — cart UIs use this to surface "capture from this output" affordances
/// by pairing each playback device with its matching loopback/monitor
/// source on the recording side. SDL3 just hands us the playback list;
/// the pairing happens in cart code.
pub fn playbackDevicesJson(out: []u8) []const u8 {
    var w = std.Io.Writer.fixed(out);
    var count: c_int = 0;
    const devices = c.SDL_GetAudioPlaybackDevices(&count);
    w.writeAll("[") catch return w.buffered();
    if (devices) |ids| {
        defer c.SDL_free(ids);
        var i: c_int = 0;
        while (i < count) : (i += 1) {
            if (i > 0) w.writeAll(",") catch break;
            const id = ids[@intCast(i)];
            const name_ptr = c.SDL_GetAudioDeviceName(id);
            const name = if (name_ptr) |p| std.mem.span(p) else "";
            w.print("{{\"id\":{d},\"name\":\"", .{id}) catch break;
            writeJsonEscaped(&w, name) catch break;
            w.writeAll("\"}") catch break;
        }
    }
    w.writeAll("]") catch {};
    return w.buffered();
}

// ── Tick — drain SDL stream, run VAD, fire events ─────────────────────

pub fn tick(host: *HostContext, _: u32) void {
    if (!S.initialized or !S.listening) return;
    const stream = S.stream orelse return;

    // Drain everything available, one VAD frame at a time. Avail is in bytes.
    while (true) {
        const avail = c.SDL_GetAudioStreamAvailable(stream);
        if (avail < @as(c_int, @intCast(FRAME_BYTES))) break;
        const got = c.SDL_GetAudioStreamData(stream, &S.frame, @intCast(FRAME_BYTES));
        if (got != @as(c_int, @intCast(FRAME_BYTES))) break;

        // Compute peak-dBFS first — we may use it to gate the verdict below.
        S.last_rms_x100 = computeRmsX100(&S.frame);

        const verdict = fvad.fvad_process(S.fvad_inst.?, &S.frame, FRAME_SAMPLES);
        // -1 == invalid frame (shouldn't happen — we always feed FRAME_SAMPLES).
        const fvad_says_speech = verdict == 1;
        // Amplitude floor: regardless of fvad's GMM verdict, a frame below
        // the configured peak-dBFS floor is silence. Off by default; cart
        // can flip it on via __voice_set_floor.
        const above_floor = S.floor_x100 == 0 or S.last_rms_x100 >= S.floor_x100;
        const is_speech = fvad_says_speech and above_floor;
        S.last_vad_verdict = if (is_speech) 1 else 0;

        // Capture PCM whenever we're not idle so the prefix that triggered
        // start (the 90ms candidate window) is preserved in the utterance.
        if (S.phase != .idle) {
            // Cap to prevent unbounded growth (e.g. open-mic scenario).
            if (S.utterance.items.len + FRAME_SAMPLES <= MAX_UTTERANCE_SAMPLES) {
                S.utterance.appendSlice(&S.frame) catch {};
            } else {
                // Force-close.
                finaliseUtterance(host);
                resetPhase();
                continue;
            }
        }

        switch (S.phase) {
            .idle => if (is_speech) {
                S.consec_speech = 1;
                S.phase = .candidate_speech;
                // Begin buffering this frame retroactively.
                S.utterance.appendSlice(&S.frame) catch {};
            },
            .candidate_speech => if (is_speech) {
                S.consec_speech += 1;
                if (S.consec_speech >= SPEECH_START_FRAMES) {
                    S.phase = .speaking;
                    v8_runtime.callGlobal(host, "__voice_onSpeechStart");
                }
            } else {
                resetPhase();
            },
            .speaking => if (!is_speech) {
                S.consec_silence = 1;
                S.phase = .candidate_silence;
            },
            .candidate_silence => if (is_speech) {
                S.consec_silence = 0;
                S.phase = .speaking;
            } else {
                S.consec_silence += 1;
                if (S.consec_silence >= SILENCE_END_FRAMES) {
                    finaliseUtterance(host);
                    resetPhase();
                }
            },
        }

        // Live-preview snapshot: while we're speaking (or in the brief
        // candidate-silence window before a possible end), every
        // preview_stride_frames we copy the in-flight utterance into a
        // stable id-keyed buffer and fire __voice_onPreviewReady so the
        // JS side can run a fast model on it. Skipped if the user has
        // dialled the stride to 0 (off) or we haven't accumulated enough
        // speech to be worth transcribing.
        if (S.phase == .speaking or S.phase == .candidate_silence) {
            S.frames_in_speech +%= 1;
            S.frames_since_preview +%= 1;
            if (S.preview_stride_frames > 0 and S.frames_in_speech >= S.preview_min_frames and S.frames_since_preview >= S.preview_stride_frames) {
                snapshotPreview(host);
                S.frames_since_preview = 0;
            }
        }
    }

    // Level callback fires once per tick regardless of phase, throttled to
    // whatever the engine's frame rate already is. Two args: peak-dBFS level
    // (0..10000, ×100) and the raw libfvad verdict for the most recent
    // frame (0/1, no debounce). The cart visualises both separately so the
    // user can tell amplitude transients (keyboard clicks) from speech-class
    // verdicts (the GMM saying "this looks like a vowel").
    v8_runtime.callGlobal2Int(
        host,
        "__voice_onLevel",
        @intCast(S.last_rms_x100),
        @intCast(S.last_vad_verdict),
    );
}

fn finaliseUtterance(host: *HostContext) void {
    if (S.utterance.items.len == 0) return;
    const id = S.next_buf_id;
    S.next_buf_id +%= 1;
    const owned = S.allocator.alloc(i16, S.utterance.items.len) catch return;
    @memcpy(owned, S.utterance.items);
    S.buffers.put(S.allocator, id, owned) catch {
        S.allocator.free(owned);
        return;
    };
    v8_runtime.callGlobal2Int(
        host,
        "__voice_onSpeechEnd",
        @intCast(id),
        @intCast(owned.len),
    );
}

/// Snapshot the in-flight utterance into a stable id-keyed buffer and fire
/// __voice_onPreviewReady so the JS side can transcribe it with a small
/// model for a live-preview UX. The snapshot is a copy, so the main
/// engine thread can keep extending S.utterance while whisper's worker
/// reads the slice.
fn snapshotPreview(host: *HostContext) void {
    if (S.utterance.items.len == 0) return;
    const id = S.next_buf_id;
    S.next_buf_id +%= 1;
    const owned = S.allocator.alloc(i16, S.utterance.items.len) catch return;
    @memcpy(owned, S.utterance.items);
    S.buffers.put(S.allocator, id, owned) catch {
        S.allocator.free(owned);
        return;
    };
    v8_runtime.callGlobal2Int(
        host,
        "__voice_onPreviewReady",
        @intCast(id),
        @intCast(owned.len),
    );
}

// ── Buffer access (called from v8_bindings_voice.zig host fn) ─────────

/// Returns the PCM slice for a finalised utterance. Caller does NOT own it;
/// the slice stays valid until releaseBuffer is called.
pub fn getBuffer(id: u32) ?[]const i16 {
    return S.buffers.get(id);
}

pub fn releaseBuffer(id: u32) void {
    if (S.buffers.fetchSwapRemove(id)) |kv| {
        S.allocator.free(kv.value);
    }
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

// ── Helpers ───────────────────────────────────────────────────────────

fn computeRmsX100(frame: *const [FRAME_SAMPLES]i16) i32 {
    // dBFS-based level meter. Linear RMS-to-percent ran way too dim
    // (typical speech RMS ≈ 2000 against int16 max 32768 → 6%, so the
    // meter only cleared 50% under shouting). Real audio meters are
    // logarithmic — we scan for peak |sample| in the frame, convert to
    // dBFS = 20·log10(peak / 32768), and map -60..0 dBFS → 0..1.
    //
    // Calibration points at this scale:
    //   silence (peak ~50)        ≈ 0.07
    //   quiet speech (peak 3k)    ≈ 0.66
    //   normal speech (peak 8k)   ≈ 0.80
    //   loud speech (peak 16k)    ≈ 0.90
    //   clipping (peak 32k+)      = 1.00
    const FLOOR_DB: f64 = -60.0;
    var peak: u32 = 0;
    for (frame) |s| {
        const a: u32 = @intCast(@as(i32, @intCast(if (s == std.math.minInt(i16)) std.math.maxInt(i16) else @abs(s))));
        if (a > peak) peak = a;
    }
    if (peak == 0) return 0;
    const peak_norm = @as(f64, peak) / 32768.0;
    const dbfs: f64 = 20.0 * std.math.log10(peak_norm);
    if (dbfs <= FLOOR_DB) return 0;
    if (dbfs >= 0.0) return 10000;
    const scaled: f64 = ((dbfs - FLOOR_DB) / -FLOOR_DB) * 10000.0;
    return @trunc(scaled);
}
