//! The model-stage scale contract.
//!
//! This is deliberately a small, GPU-independent source of truth for the native
//! modeling overlay. The stage grid, its ruler, and its mannequin all consume these
//! values so a game-facing scale cue cannot quietly drift into a cosmetic one.

/// Scale constants ruled for game authoring. Keep collider and visual height
/// separate: one governs collision, the other is the stylized figure's head top.
pub const Tuning = struct {
    /// One stage tile is one authored world metre.
    pub const tile_meters: f32 = 1.0;
    /// Physical player capsule from the game scale contract.
    pub const player_collider_height_meters: f32 = 1.65;
    /// Stylized player head top; this is visual, not collision height.
    pub const player_visual_head_top_meters: f32 = 2.04;
    /// The stage's three-panel span doubles as the ruler's vertical range.
    pub const ruler_height_meters: f32 = 3.0;
    /// Quarter-metre ticks keep the ladder readable without replacing the 1/16 m grid.
    pub const ruler_minor_tick_meters: f32 = 0.25;
    /// Whole-metre ticks agree with the stage's coarse tile panels.
    pub const ruler_major_tick_meters: f32 = tile_meters;
};

pub const MarkTone = enum {
    meter,
    collider,
    visual_head,
};

/// Labels that make the physical and visual player references explicit in the stage.
pub const Mark = struct {
    meters: f32,
    label: []const u8,
    tone: MarkTone,
};

pub const reference_marks = [_]Mark{
    .{ .meters = Tuning.tile_meters, .label = "1m", .tone = .meter },
    .{ .meters = Tuning.player_collider_height_meters, .label = "COLLIDER 1.65m", .tone = .collider },
    .{ .meters = Tuning.player_visual_head_top_meters, .label = "VISUAL HEAD ~2.04m", .tone = .visual_head },
};

pub fn minorTickCount() u32 {
    return @intFromFloat(Tuning.ruler_height_meters / Tuning.ruler_minor_tick_meters);
}

pub fn tickMeters(index: u32) f32 {
    return @as(f32, @floatFromInt(index)) * Tuning.ruler_minor_tick_meters;
}

pub fn isMajorTick(index: u32) bool {
    const ticks_per_major: u32 = @intFromFloat(Tuning.ruler_major_tick_meters / Tuning.ruler_minor_tick_meters);
    return index % ticks_per_major == 0;
}

pub fn markFor(tone: MarkTone) ?Mark {
    for (reference_marks) |mark| {
        if (mark.tone == tone) return mark;
    }
    return null;
}
