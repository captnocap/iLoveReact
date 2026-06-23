//! Fallback instance-derived collider policy for world_loader.zig.

/// Height-only wall/floor split used when an old or procedural map has no
/// authored COLLIDERS lump. Tall boxes block the player; thin boxes are
/// standable/walkable surfaces.
pub fn blocksPlayerByHeight(height_meters: f32, solid_threshold_meters: f32) bool {
    return @abs(height_meters) > solid_threshold_meters;
}

/// The bottom of an instance's real vertical collision band. Even walkable thin
/// slabs need this finite underside so a raised floor or roof can be walked under.
pub fn bandFloorY(center_y: f32, height_meters: f32) f32 {
    return center_y - @abs(height_meters) * 0.5;
}
