//! Behavior tests for framework/key_pack.zig (P4 — GAME_INPUT hazard close).
//! These assert BEHAVIOR of the one key-event packing on the __ifttt wire:
//! extended SDL3 keycodes (arrows, F-keys, nav, standalone modifiers) must
//! survive the round-trip DISTINGUISHABLE from printable chars. The old
//! (mod << 16) | (sym & 0xFFFF) packing truncated LEFT 0x40000050 into 'P'
//! (cart/hmsc-int/game/input.CAPTURE.md ambiguity 2 — closed by this fix).
//!
//! Run: zig build test-key-pack

const std = @import("std");
const testing = std.testing;
const key_pack = @import("key_pack");

// SDL3 keycodes — printable keys are their ASCII code; extended keys set
// bit 30 (0x40000000). These are the collision pairs from the hazard note.
const SDLK_LEFT: u32 = 0x40000050; // truncated to 0x50 'P' under the old packing
const SDLK_RIGHT: u32 = 0x4000004F; // 'O'
const SDLK_UP: u32 = 0x40000052; // 'R'
const SDLK_DOWN: u32 = 0x40000051; // 'Q'
const SDLK_F1: u32 = 0x4000003A; // ':'
const SDLK_LSHIFT: u32 = 0x400000E1; // sdl:225 under the old packing

test "arrows round-trip distinct from their old printable collisions" {
    const pairs = [_]struct { arrow: u32, printable: u32 }{
        .{ .arrow = SDLK_LEFT, .printable = 'p' },
        .{ .arrow = SDLK_RIGHT, .printable = 'o' },
        .{ .arrow = SDLK_UP, .printable = 'r' },
        .{ .arrow = SDLK_DOWN, .printable = 'q' },
        .{ .arrow = SDLK_F1, .printable = ':' },
    };
    for (pairs) |pair| {
        const packed_arrow = key_pack.pack(pair.arrow, 0);
        const packed_char = key_pack.pack(pair.printable, 0);
        // The wire must distinguish the keys at the packed level...
        try testing.expect(packed_arrow != packed_char);
        // ...and the decoder must recover the FULL sym, not a truncation.
        try testing.expectEqual(pair.arrow, key_pack.symOf(packed_arrow));
        try testing.expectEqual(pair.printable, key_pack.symOf(packed_char));
        // Uppercase collision too (LEFT used to arrive as 0x50 = 'P').
        try testing.expect(key_pack.symOf(packed_arrow) != (pair.arrow & 0xFFFF));
    }
}

test "all four arrows are mutually distinct on the wire" {
    const arrows = [_]u32{ SDLK_LEFT, SDLK_RIGHT, SDLK_UP, SDLK_DOWN };
    for (arrows, 0..) |a, i| {
        for (arrows[i + 1 ..]) |b| {
            try testing.expect(key_pack.pack(a, 0) != key_pack.pack(b, 0));
        }
    }
}

test "modifiers ride above the sym and round-trip exactly" {
    // SDL_Keymod is 16 bits; exercise the full mask alongside a full-width sym.
    const mods = [_]u16{ 0x0001, 0x0003, 0x00C0, 0x0300, 0x0C00, 0xFFFF };
    for (mods) |mod| {
        const pk = key_pack.pack(SDLK_LEFT, mod);
        try testing.expectEqual(SDLK_LEFT, key_pack.symOf(pk));
        try testing.expectEqual(mod, key_pack.modOf(pk));
        // Modifier bits must never leak into the sym (the old packing's bug
        // was sym bits leaking OUT; assert isolation both ways).
        try testing.expectEqual(@as(u16, 0), key_pack.modOf(key_pack.pack(SDLK_LEFT, 0)));
    }
}

test "packed value stays exact in an f64 (the V8 bridge crossing)" {
    // engine.zig hands the i64 to callGlobalInt, which @floatFromInt's it;
    // JS decodes with arithmetic div/mod. Worst case: max mod + max sym.
    const pk = key_pack.pack(0xFFFFFFFF, 0xFFFF);
    const as_f64: f64 = @floatFromInt(pk);
    const back: i64 = @trunc(as_f64);
    try testing.expectEqual(pk, back);
    // And the JS-side arithmetic decode recovers both fields from the f64.
    const js_sym: u32 = @trunc(@mod(as_f64, 4294967296.0));
    const js_mod: u16 = @floor(as_f64 / 4294967296.0);
    try testing.expectEqual(key_pack.symOf(pk), js_sym);
    try testing.expectEqual(key_pack.modOf(pk), js_mod);
}

test "printable keys keep working unchanged" {
    // WASD + space — the keys every current consumer already rides.
    const printables = [_]u32{ 'w', 'a', 's', 'd', ' ' };
    for (printables) |ch| {
        const pk = key_pack.pack(ch, 0);
        try testing.expectEqual(ch, key_pack.symOf(pk));
        try testing.expectEqual(@as(u16, 0), key_pack.modOf(pk));
        // Printables fit 16 bits, so their packed value is the sym itself —
        // identical to what the old packing produced for them (no behavior
        // shift for any printable-key consumer).
        try testing.expectEqual(@as(i64, ch), pk);
    }
}
