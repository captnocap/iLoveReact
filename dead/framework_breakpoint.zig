//! Breakpoint system — responsive layout tiers
//!
//! Tracks current breakpoint based on window width.
//! Default thresholds: sm=0, md=640, lg=1024, xl=1440.
//! Override with setThresholds() at app init.
//!
//! Usage:
//!   breakpoint.update(win_w);
//!   const bp = breakpoint.current(); // .sm, .md, .lg, .xl
//!   breakpoint.setThresholds(480, 800, 1200); // custom md/lg/xl thresholds

const std = @import("std");
const layout = @import("layout.zig");

pub const Breakpoint = enum(u8) {
    sm = 0, // below md threshold (mobile)
    md = 1, // md..lg threshold (tablet)
    lg = 2, // lg..xl threshold (desktop)
    xl = 3, // above xl threshold (widescreen)
};

// Configurable thresholds — defaults match the Love2D stack
var threshold_md: f32 = 640;
var threshold_lg: f32 = 1024;
var threshold_xl: f32 = 1440;

var current_bp: Breakpoint = .lg;
var current_width: f32 = 1280;
var dirty: bool = true; // start dirty so first frame applies bp styles

/// Set custom breakpoint thresholds. Call before first update().
/// Values are the minimum width for each tier (sm is always 0).
pub fn setThresholds(md: f32, lg: f32, xl: f32) void {
    threshold_md = md;
    threshold_lg = lg;
    threshold_xl = xl;
    dirty = true;
    layout.markLayoutDirty();
}

/// Update breakpoint from window width. Call on resize.
pub fn update(w: f32) void {
    current_width = w;
    const new_bp: Breakpoint = if (w >= threshold_xl) .xl else if (w >= threshold_lg) .lg else if (w >= threshold_md) .md else .sm;
    if (new_bp != current_bp) {
        dirty = true;
        layout.markLayoutDirty();
    }
    current_bp = new_bp;
}

/// Check if breakpoint changed since last clearDirty.
pub fn isDirty() bool {
    return dirty;
}

/// Clear dirty flag after applying bp styles.
pub fn clearDirty() void {
    dirty = false;
}

/// Get current breakpoint.
pub fn current() Breakpoint {
    return current_bp;
}

/// Get current width.
pub fn width() f32 {
    return current_width;
}

/// Check if current breakpoint is at least the given tier.
pub fn atLeast(bp: Breakpoint) bool {
    return @intFromEnum(current_bp) >= @intFromEnum(bp);
}

/// Get the breakpoint as a string (for debug display).
pub fn name() []const u8 {
    return switch (current_bp) {
        .sm => "sm",
        .md => "md",
        .lg => "lg",
        .xl => "xl",
    };
}
