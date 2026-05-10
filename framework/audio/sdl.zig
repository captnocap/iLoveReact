//! Shared SDL3 C import for the audio subsystem.

pub const c = @cImport({
    @cInclude("SDL3/SDL.h");
});
