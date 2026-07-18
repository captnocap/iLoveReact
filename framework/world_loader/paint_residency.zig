//! Deterministic nearest-first residency policy for live painted chunks.
//!
//! The map document may contain far more chunks than render/collider working
//! storage. Callers keep the nearest bounded set and recycle physical slots as
//! the author's attention moves; document iteration order never decides which
//! ground exists.

pub const Candidate = struct {
    coord: [2]i32,
    distance_sq: f32,
};

fn nearer(a: Candidate, b: Candidate) bool {
    if (a.distance_sq != b.distance_sq) return a.distance_sq < b.distance_sq;
    if (a.coord[1] != b.coord[1]) return a.coord[1] < b.coord[1];
    return a.coord[0] < b.coord[0];
}

pub fn candidate(cx: i32, cz: i32, center_x: f32, center_z: f32, anchor: [2]f32) Candidate {
    const dx = center_x - anchor[0];
    const dz = center_z - anchor[1];
    return .{ .coord = .{ cx, cz }, .distance_sq = dx * dx + dz * dz };
}

/// Offer one document chunk to a bounded nearest set. The returned index is
/// where the caller should store its parallel chunk pointer; null means the
/// candidate lies outside the current working set.
pub fn offer(slots: []Candidate, count: *usize, incoming: Candidate) ?usize {
    if (slots.len == 0) return null;
    if (count.* < slots.len) {
        const at = count.*;
        slots[at] = incoming;
        count.* += 1;
        return at;
    }

    var farthest: usize = 0;
    for (slots[1..], 1..) |entry, i| {
        if (nearer(slots[farthest], entry)) farthest = i;
    }
    if (!nearer(incoming, slots[farthest])) return null;
    slots[farthest] = incoming;
    return farthest;
}

pub fn contains(slots: []const Candidate, coord: [2]i32) bool {
    for (slots) |entry| {
        if (entry.coord[0] == coord[0] and entry.coord[1] == coord[1]) return true;
    }
    return false;
}
