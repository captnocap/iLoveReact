//! Session-wide policy for native mesh-editor pointer selection.
//!
//! The editor shell owns the toggle, while the engine owns pointer picking. Keeping
//! this tiny boundary outside Scene3D avoids teaching mesh topology or rendering about
//! an input preference.

var persistent_additive = false;

pub fn setPersistentAdditive(enabled: bool) void {
    persistent_additive = enabled;
}

pub fn persistentAdditive() bool {
    return persistent_additive;
}

/// Physical Shift always keeps its established additive behavior. The persistent
/// toggle supplies the same behavior without requiring the modifier to be held.
pub fn additiveForPointer(shift_held: bool) bool {
    return shift_held or persistent_additive;
}
