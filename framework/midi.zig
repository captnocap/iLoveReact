//! framework/midi.zig — feature-gated dispatcher for the MIDI subsystem.
//!
//! When -Dhas-midi=true (passed by scripts/ship for carts whose source
//! triggers the `midi` feature in sdk/dependency-registry.json — i.e.
//! imports runtime/hooks/useMIDI.ts), this re-exports
//! framework/midi_real.zig (the real ALSA snd_seq_* implementation).
//!
//! Otherwise it re-exports framework/midi_stub.zig. With the stub
//! selected, midi_real.zig's @extern fn snd_seq_* declarations are
//! never compiled, libasound isn't linked (build.zig gates the asound
//! link on has_midi), and the cart binary stops carrying ALSA in its
//! DT_NEEDED list.
//!
//! Mirrors framework/sqlite.zig + framework/vterm.zig + framework/audio.zig
//! dispatcher pattern. Public surface used by v8_bindings_core.zig:
//! start(), stop(), isAvailable(), poll(), nextEvent(), devicesJson(buf),
//! eventJson(ev, buf), MidiEvent.

const build_options = @import("build_options");

const HAS_MIDI = if (@hasDecl(build_options, "has_midi"))
    build_options.has_midi
else
    false;

const impl = if (HAS_MIDI)
    @import("midi_real.zig")
else
    @import("midi_stub.zig");

pub const MidiEvent = impl.MidiEvent;

pub const start = impl.start;
pub const stop = impl.stop;
pub const isAvailable = impl.isAvailable;
pub const poll = impl.poll;
pub const nextEvent = impl.nextEvent;
pub const devicesJson = impl.devicesJson;
pub const eventJson = impl.eventJson;
