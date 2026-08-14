//! Canonical scale authority for structural architecture and Studio authoring.
//!
//! Authored architecture stores whole `Unit` values. Studio mesh geometry may use
//! fractional scalar units, but every structural commit validates through this file.

const std = @import("std");

pub const Unit = i32;

/// The one game-wide architecture lattice: 16 u = 1 metre on X, Y, and Z.
pub const units_per_meter: Unit = 16;
pub const units_per_meter_f32: f32 = @floatFromInt(units_per_meter);
pub const units_per_meter_f64: f64 = @floatFromInt(units_per_meter);
pub const meters_per_unit_f32: f32 = 1.0 / units_per_meter_f32;

/// Limits retain exact integer-to-f32 conversion before division by the power-of-two
/// lattice scale. Output conversion therefore cannot round one structural unit onto
/// a neighboring unit.
pub const Limits = struct {
    pub const min_unit: Unit = -16_777_216;
    pub const max_unit: Unit = 16_777_216;
};

pub const ValidationError = error{
    unit_out_of_range,
    legacy_meter_not_finite,
    legacy_meter_off_lattice,
};

pub fn checkedUnit(value: i64) ValidationError!Unit {
    if (value < Limits.min_unit or value > Limits.max_unit) {
        return error.unit_out_of_range;
    }
    return @intCast(value);
}

/// Exact structural output conversion. The supported Unit range is exactly
/// representable by f32 and division by 16 is a binary power-of-two shift.
pub fn unitsToMeters(units: Unit) f32 {
    std.debug.assert(units >= Limits.min_unit and units <= Limits.max_unit);
    return @as(f32, @floatFromInt(units)) * meters_per_unit_f32;
}

/// Studio/art conversion intentionally permits fractional scalar units. It is not a
/// structural source validator; structural commits use `legacyMetersToUnits` or
/// accept an integer `Unit` directly.
pub fn metersToStudioUnits(meters: f32) f32 {
    return meters * units_per_meter_f32;
}

/// Validate an old meter coordinate without epsilon or silent rounding.
pub fn legacyMetersToUnits(meters: f64) ValidationError!Unit {
    if (!std.math.isFinite(meters)) return error.legacy_meter_not_finite;

    const scaled = meters * units_per_meter_f64;
    if (scaled < @as(f64, @floatFromInt(Limits.min_unit)) or
        scaled > @as(f64, @floatFromInt(Limits.max_unit)))
    {
        return error.unit_out_of_range;
    }
    if (@trunc(scaled) != scaled) return error.legacy_meter_off_lattice;

    const integral: i64 = @trunc(scaled);
    return checkedUnit(integral);
}

comptime {
    if (units_per_meter != 16) @compileError("architecture scale must remain 16 u = 1 m");
    if (unitsToMeters(units_per_meter) != 1.0) @compileError("architecture unit conversion drifted");
    if (metersToStudioUnits(1.0) != 16.0) @compileError("Studio and architecture scales diverged");
}

test "architecture scale is exact and rejects off-lattice legacy meters" {
    try std.testing.expectEqual(@as(f32, 1.0), unitsToMeters(16));
    try std.testing.expectEqual(@as(f32, -1.0), unitsToMeters(-16));
    try std.testing.expectEqual(@as(Unit, 24), try legacyMetersToUnits(1.5));
    try std.testing.expectError(error.legacy_meter_off_lattice, legacyMetersToUnits(0.1));
    try std.testing.expectError(error.legacy_meter_not_finite, legacyMetersToUnits(std.math.nan(f64)));
    try std.testing.expectError(error.unit_out_of_range, checkedUnit(@as(i64, Limits.max_unit) + 1));
}
