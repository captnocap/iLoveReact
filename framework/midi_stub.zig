//! framework/midi_stub.zig — empty implementation for carts that don't
//! enable -Dhas-midi. Selected by framework/midi.zig when
//! build_options.has_midi is false.
//!
//! When the stub is selected, midi_real.zig (which @externs ALSA's
//! snd_seq_* API) is never compiled, so libasound stays out of the
//! cart's link line and DT_NEEDED list. Linux carts that don't import
//! useMIDI stop carrying ALSA as a runtime dep (~600KB).
//!
//! MidiEvent's shape is a verbatim copy of midi_real.zig's — it's part
//! of the API contract regardless of mode. The MidiKind enum is
//! private to each file (used only via MidiEvent.kind), but kept the
//! same so the type round-trips identically.

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

pub fn start() bool {
    return false;
}

pub fn stop() void {}

pub fn isAvailable() bool {
    return false;
}

pub fn poll() usize {
    return 0;
}

pub fn nextEvent() ?MidiEvent {
    return null;
}

pub fn devicesJson(out: []u8) []const u8 {
    const empty = "[]";
    if (out.len < empty.len) return out[0..0];
    @memcpy(out[0..empty.len], empty);
    return out[0..empty.len];
}

pub fn eventJson(ev: MidiEvent, out: []u8) []const u8 {
    _ = ev;
    const empty = "{}";
    if (out.len < empty.len) return out[0..0];
    @memcpy(out[0..empty.len], empty);
    return out[0..empty.len];
}
