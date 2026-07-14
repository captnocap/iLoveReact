//! Whole-map identity reconciliation for retained painted-terrain slots.
//!
//! Ordinary brush edits dirty individual chunk channels. Reset/load is a
//! different operation: the map engine replaces every chunk allocation, so a
//! loader cache keyed only by `(cx, cz)` must discard all of its slot claims
//! even when the incoming document happens to use the same coordinates.

/// Returns true exactly once per newly observed map revision and releases every
/// retained coordinate claim. The caller owns the heavier node/buffer cleanup.
pub fn reconcile(last_revision: *u64, current_revision: u64, used_slots: []bool) bool {
    if (last_revision.* == current_revision) return false;
    last_revision.* = current_revision;
    @memset(used_slots, false);
    return true;
}

/// Async projections carry the revision they snapshotted. A completed result
/// is publishable only while that whole-map identity is still current.
pub fn resultIsCurrent(result_revision: u64, current_revision: u64) bool {
    return result_revision == current_revision;
}
