// audio_input.zig — raw microphone capture for music sampling.
//
// Sibling to framework/voice/voice.zig — same SDL3 + tick pattern, but
// purpose-built for capturing musical samples instead of speech:
//
//   - 44.1kHz f32 mono (matches the audio framework playback rate, so
//     captured WAVs load directly into samplers without resampling)
//   - No VAD: every frame between start and stop is preserved
//   - One growing accumulator buffer; stop() writes a 16-bit PCM WAV
//     and clears
//   - Independent SDL3 stream from voice.zig — both can coexist; SDL3
//     arbitrates the underlying device
//
// Lifecycle:
//   init(allocator)              at boot, alongside voice.init
//   tick(host, _)                every frame, drains SDL3 stream into accumulator
//   startRecording()             opens SDL3 input device + begins streaming
//   stopRecording(io, out_path)  writes WAV at out_path, frees accumulator
//   deinit()                     closes device + frees accumulator
//
// The level meter fires via __rawCapture_onLevel(level_x100) once per
// tick while recording, on the same 0..10000 peak-dBFS scale voice uses.

const std = @import("std");
const c = @import("../c.zig").imports;
const HostContext = @import("../host_context.zig");
const v8_runtime = @import("../v8_runtime.zig");

// ── Tunables ──────────────────────────────────────────────────────────

/// 44.1kHz matches the audio playback framework's sample rate (see
/// framework/audio/types.zig:SAMPLE_RATE), so captured samples load
/// without resampling through audio.loadSound.
const SAMPLE_RATE: c_int = 44100;

/// Mono is the simpler default; the audio framework's WAV decoder
/// (framework/audio/api.zig:decodeWavToMonoF32) downmixes anyway, so
/// recording stereo would just be wasted on the playback side.
const CHANNELS: u8 = 1;

/// Hard cap: 10 minutes at 44.1kHz f32 mono = ~106 MB RAM. Past this we
/// force-stop and write what we have so a runaway recording can't OOM.
const MAX_FRAMES: usize = @as(usize, @intCast(SAMPLE_RATE)) * 600;

/// Drain stride — pull at most this many frames per tick so a frame
/// budget overrun doesn't escalate. Sized for 30ms of audio at 44.1kHz,
/// well above engine frame budget at 60Hz.
const DRAIN_CHUNK_FRAMES: usize = 1323;
const DRAIN_CHUNK_BYTES: usize = DRAIN_CHUNK_FRAMES * @sizeOf(f32);

// ── State ─────────────────────────────────────────────────────────────

const State = struct {
    initialized: bool = false,
    recording: bool = false,
    stream: ?*c.SDL_AudioStream = null,
    /// Accumulator buffer. Holds the entire recording in memory until
    /// stopRecording() flushes to disk.
    buffer: std.array_list.Managed(f32) = undefined,
    /// Scratch buffer reused each drain.
    drain_scratch: [DRAIN_CHUNK_FRAMES]f32 = undefined,
    /// Peak-dBFS level over the last drained chunk (0..10000, same scale
    /// as voice.zig so cart-side level meters share calibration).
    last_level_x100: i32 = 0,
    /// Set true when MAX_FRAMES is exceeded mid-recording. stopRecording
    /// still writes the buffer (truncated to cap), but flagged so the JS
    /// side can surface a warning.
    capped: bool = false,
    allocator: std.mem.Allocator = undefined,
};

var S: State = .{};

// ── Lifecycle ─────────────────────────────────────────────────────────

pub fn init(allocator: std.mem.Allocator) void {
    if (S.initialized) return;
    S.allocator = allocator;
    S.buffer = std.array_list.Managed(f32).init(allocator);
    S.initialized = true;
}

pub fn deinit() void {
    if (!S.initialized) return;
    stopAndDiscard();
    S.buffer.deinit();
    S.initialized = false;
}

// ── Recording control ─────────────────────────────────────────────────

/// Begin recording from `device_id`. Pass 0 for SDL3's default
/// recording device; otherwise pass an id from
/// `__audio_input_devices_json` (or `__voice_recording_devices_json`)
/// to target a specific source — handy for monitor/loopback devices
/// that capture system audio output rather than the physical mic.
pub fn startRecording(device_id: u32) bool {
    if (!S.initialized) return false;
    if (S.recording) return true;

    var spec: c.SDL_AudioSpec = .{
        .format = c.SDL_AUDIO_F32,
        .channels = CHANNELS,
        .freq = SAMPLE_RATE,
    };
    const target_device: c.SDL_AudioDeviceID = if (device_id == 0)
        c.SDL_AUDIO_DEVICE_DEFAULT_RECORDING
    else
        @intCast(device_id);
    const stream = c.SDL_OpenAudioDeviceStream(
        target_device,
        &spec,
        null,
        null,
    );
    if (stream == null) return false;
    if (!c.SDL_ResumeAudioStreamDevice(stream)) {
        c.SDL_DestroyAudioStream(stream);
        return false;
    }

    S.buffer.clearRetainingCapacity();
    S.last_level_x100 = 0;
    S.capped = false;
    S.stream = stream;
    S.recording = true;
    return true;
}

/// Stop recording and write the accumulator to a 16-bit PCM WAV at
/// out_path. Returns true on success. Buffer is cleared regardless of
/// success so a write failure doesn't pin the memory.
pub fn stopRecording(io: std.Io, out_path: []const u8) bool {
    if (!S.initialized) return false;
    if (!S.recording) return false;

    closeStream();
    S.recording = false;

    const ok = writeWav(io, out_path, S.buffer.items) catch false;
    S.buffer.clearRetainingCapacity();
    return ok;
}

/// Stop recording without writing. Used by deinit() and as the cleanup
/// path when startRecording fails partway.
fn stopAndDiscard() void {
    closeStream();
    S.recording = false;
    S.buffer.clearRetainingCapacity();
}

fn closeStream() void {
    if (S.stream) |stream| {
        c.SDL_DestroyAudioStream(stream);
        S.stream = null;
    }
}

pub fn isRecording() bool {
    return S.recording;
}

pub fn getLevelX100() i32 {
    return S.last_level_x100;
}

pub fn wasCapped() bool {
    return S.capped;
}

// ── Tick — drain SDL stream into accumulator ──────────────────────────

pub fn tick(host: *HostContext, _: u32) void {
    if (!S.initialized or !S.recording) return;
    const stream = S.stream orelse return;

    var any_drained = false;
    while (true) {
        const avail = c.SDL_GetAudioStreamAvailable(stream);
        if (avail < @as(c_int, @intCast(@sizeOf(f32)))) break;

        // Cap check before reading so we don't blow past MAX_FRAMES by a
        // chunk. If we'd exceed the cap, drain just enough to fill, then
        // stop accumulating.
        const remaining_cap: usize = if (S.buffer.items.len >= MAX_FRAMES)
            0
        else
            MAX_FRAMES - S.buffer.items.len;
        if (remaining_cap == 0) {
            S.capped = true;
            // Drain SDL's buffer so it doesn't backlog; just discard.
            _ = c.SDL_ClearAudioStream(stream);
            break;
        }

        const want_frames = @min(DRAIN_CHUNK_FRAMES, remaining_cap);
        const want_bytes: c_int = @intCast(want_frames * @sizeOf(f32));
        const got = c.SDL_GetAudioStreamData(stream, &S.drain_scratch, want_bytes);
        if (got <= 0) break;
        const got_frames: usize = @intCast(@divFloor(got, @sizeOf(f32)));
        if (got_frames == 0) break;

        S.buffer.appendSlice(S.drain_scratch[0..got_frames]) catch {
            // OOM — best-effort: stop recording, return what we have.
            S.recording = false;
            closeStream();
            return;
        };

        // Track peak amplitude across the drained chunk for the level meter.
        var peak: f32 = 0;
        for (S.drain_scratch[0..got_frames]) |s| {
            const a = if (s < 0) -s else s;
            if (a > peak) peak = a;
        }
        S.last_level_x100 = peakToDbfsX100(peak);
        any_drained = true;

        // If we read less than asked, the stream is empty for this tick.
        if (got_frames < want_frames) break;
    }

    if (any_drained) {
        v8_runtime.callGlobalInt(host, "__rawCapture_onLevel", @intCast(S.last_level_x100));
    }
}

// ── WAV writer (16-bit PCM mono) ──────────────────────────────────────

fn writeWav(io: std.Io, out_path: []const u8, samples: []const f32) !bool {
    var file = std.Io.Dir.cwd().createFile(io, out_path, .{ .truncate = true }) catch return false;
    defer file.close(io);

    const channels: u16 = @intCast(CHANNELS);
    const bits_per_sample: u16 = 16;
    const sample_rate: u32 = @intCast(SAMPLE_RATE);
    const byte_rate: u32 = sample_rate * @as(u32, channels) * @as(u32, bits_per_sample) / 8;
    const block_align: u16 = channels * (bits_per_sample / 8);
    const data_size: u32 = @intCast(samples.len * @sizeOf(i16));
    const file_size: u32 = 36 + data_size;

    var header: [44]u8 = undefined;
    @memcpy(header[0..4], "RIFF");
    std.mem.writeInt(u32, header[4..8], file_size, .little);
    @memcpy(header[8..12], "WAVE");
    @memcpy(header[12..16], "fmt ");
    std.mem.writeInt(u32, header[16..20], 16, .little); // fmt chunk size
    std.mem.writeInt(u16, header[20..22], 1, .little); // PCM
    std.mem.writeInt(u16, header[22..24], channels, .little);
    std.mem.writeInt(u32, header[24..28], sample_rate, .little);
    std.mem.writeInt(u32, header[28..32], byte_rate, .little);
    std.mem.writeInt(u16, header[32..34], block_align, .little);
    std.mem.writeInt(u16, header[34..36], bits_per_sample, .little);
    @memcpy(header[36..40], "data");
    std.mem.writeInt(u32, header[40..44], data_size, .little);

    file.writeStreamingAll(io, &header) catch return false;

    // Convert f32 → i16 in small chunks so we don't allocate a parallel
    // buffer the size of the recording.
    var scratch: [4096]i16 = undefined;
    var i: usize = 0;
    while (i < samples.len) {
        const n = @min(scratch.len, samples.len - i);
        for (0..n) |k| {
            const v = samples[i + k];
            const clamped: f32 = @max(-1.0, @min(1.0, v));
            scratch[k] = @intFromFloat(clamped * 32767.0);
        }
        const bytes = std.mem.sliceAsBytes(scratch[0..n]);
        file.writeStreamingAll(io, bytes) catch return false;
        i += n;
    }

    return true;
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Convert a 0..1 linear peak into the same 0..10000 peak-dBFS scale
/// voice.zig uses, so cart-side level meters share calibration.
fn peakToDbfsX100(peak: f32) i32 {
    const FLOOR_DB: f64 = -60.0;
    if (peak <= 0) return 0;
    const p64: f64 = @floatCast(peak);
    const dbfs: f64 = 20.0 * std.math.log10(p64);
    if (dbfs <= FLOOR_DB) return 0;
    if (dbfs >= 0.0) return 10000;
    const scaled: f64 = ((dbfs - FLOOR_DB) / -FLOOR_DB) * 10000.0;
    return @intFromFloat(scaled);
}
