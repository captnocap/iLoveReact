// key_pack.zig — the ONE key-event packing for the __ifttt key wire.
//
// Producer: engine.zig (SDL_EVENT_KEY_DOWN / KEY_UP). Decoders:
// ifttt/ifttt.zig dispatchKey (Zig-side key-match registry) and
// runtime/hooks/useIFTTT.ts decodeKey (JS side — arithmetic div/mod,
// NOT 32-bit bitwise ops). All three must agree on this layout.
//
//   packed = (mod << 32) | sym
//     sym — SDL3 keycode (SDLK_*), FULL 32 bits. Extended keys (arrows,
//           F-keys, nav, standalone modifiers) set bit 30 (0x40000000).
//     mod — SDL_Keymod bitmask, 16 bits.
//
// Max value < 2^48, so the i64 stays EXACT in the f64 that crosses the
// V8 bridge (callGlobalInt / setRetF64 — both @floatFromInt an i64).
//
// History: the old packing was (mod << 16) | (sym & 0xFFFF), which
// truncated 0x4000xxxx codes into printable collisions — LEFT arrived
// as 'p', RIGHT 'o', UP 'r', DOWN 'q' (cart/hmsc-int/game/input.CAPTURE.md
// hazard, closed by this module).

pub fn pack(sym: u32, mod: u16) i64 {
    return (@as(i64, mod) << 32) | @as(i64, sym);
}

pub fn symOf(packed_key: i64) u32 {
    return @intCast(packed_key & 0xFFFFFFFF);
}

pub fn modOf(packed_key: i64) u16 {
    return @intCast((packed_key >> 32) & 0xFFFF);
}
