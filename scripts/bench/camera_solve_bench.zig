// camera_solve_bench.zig — the camera rig solve, in Zig, for a JS-vs-Zig compare.
//
// Run: tools/zig/zig run -O ReleaseFast scripts/bench/camera_solve_bench.zig
//
// Same arithmetic as scripts/bench/camera_solve_bench.js and runtime/cameras/rigs/*.
// f64 throughout to match V8's Number. Results accumulate into a checksum that is
// printed + fed to doNotOptimizeAway so ReleaseFast can't delete the loop. Note
// the structural difference this measures honestly: Zig returns the Solved struct
// by value on the stack (zero allocation), whereas the JS path allocates the
// pos/target arrays every solve — that allocation is a real cost of the JS path.

const std = @import("std");

const DEG: f64 = std.math.pi / 180.0;
const V3 = [3]f64;
const Solved = struct { pos: V3, target: V3, fov: f64 };

fn orbitalEye(t: V3, yaw_deg: f64, pitch_deg: f64, dist: f64) V3 {
    const yaw = yaw_deg * DEG;
    const elev = pitch_deg * DEG;
    const horiz = dist * @cos(elev);
    const height = dist * @sin(elev);
    return .{ t[0] - @sin(yaw) * horiz, t[1] + height, t[2] - @cos(yaw) * horiz };
}
fn lookForward(e: V3, yaw_deg: f64, pitch_deg: f64) V3 {
    const yaw = yaw_deg * DEG;
    const pit = pitch_deg * DEG;
    return .{ e[0] + @sin(yaw) * @cos(pit), e[1] + @sin(pit), e[2] + @cos(yaw) * @cos(pit) };
}

fn orbit(yaw: f64, pitch: f64, dist: f64, zoom: f64) Solved {
    const d = dist / @max(0.2, zoom);
    return .{ .pos = orbitalEye(.{ 0, 1, 0 }, yaw, pitch, d), .target = .{ 0, 1, 0 }, .fov = 55 };
}
fn follow(heading: f64, distance: f64, height: f64) Solved {
    const h = heading * DEG;
    const fx = @sin(h);
    const fz = @cos(h);
    return .{ .pos = .{ -fx * distance, height, -fz * distance }, .target = .{ 0, 1.1, 0 }, .fov = 55 };
}
fn topDown(height: f64, tilt: f64, heading: f64) Solved {
    const h = heading * DEG;
    const t = @max(1.5, tilt) * DEG;
    const horiz = height * @tan(t);
    return .{ .pos = .{ -@sin(h) * horiz, height, -@cos(h) * horiz }, .target = .{ 0, 0, 0 }, .fov = 50 };
}
fn isometric(yaw: f64, dist: f64) Solved {
    return .{ .pos = orbitalEye(.{ 0, 0, 0 }, yaw, 35.264, dist), .target = .{ 0, 0, 0 }, .fov = 30 };
}
fn firstPerson(facing: f64, pitch: f64) Solved {
    const eye = V3{ 0, 1.7, 5.5 };
    return .{ .pos = eye, .target = lookForward(eye, facing, pitch), .fov = 72 };
}
fn freeFly(px: f64, py: f64, pz: f64, yaw: f64, pitch: f64) Solved {
    const eye = V3{ px, py, pz };
    return .{ .pos = eye, .target = lookForward(eye, yaw, pitch), .fov = 62 };
}

const SHOTS = [_][6]f64{
    .{ 9, 1.5, 5.5, 1.0, 42, 0 },    .{ 3.2, 0.6, 0.5, 1.7, 52, 0 },  .{ 1.7, 0.3, 1.72, 1.78, 32, 0 },
    .{ -2.2, 0.8, 1.85, 1.2, 58, 4 }, .{ 0.2, 5.0, 1.3, 1.1, 46, 0 }, .{ 4.0, -1.0, 6.5, 0.8, 44, 0 },
    .{ 2.6, 1.4, 0.7, 1.0, 50, 0 },  .{ 2.0, -0.4, 0.14, 1.5, 62, 0 },
};
fn pickIndex(n: i64, len: usize, seed: u64) usize {
    if (len <= 1) return 0;
    const hash = struct {
        fn h(m: i64, s: u64, l: usize) usize {
            const v: u64 = @bitCast(m *% 1103515245 +% 12345 +% @as(i64, @bitCast(s)));
            return @intCast(v % @as(u64, l));
        }
    }.h;
    var i = hash(n, seed, len);
    if (i == hash(n - 1, seed, len)) i = (i + 1) % len;
    return i;
}
fn cinematic(facing: f64, t: f64) Solved {
    const f = facing * DEG;
    const fwd = V3{ @sin(f), 0, @cos(f) };
    const right = V3{ @cos(f), 0, -@sin(f) };
    const dwell: f64 = 2.6;
    const n: i64 = @floor(t / dwell);
    const idx = pickIndex(n, SHOTS.len, 7);
    const s = SHOTS[idx];
    const a = s[0];
    const b = s[1];
    const c = s[2];
    const look_y = s[3];
    const fov = s[4];
    const lead = s[5];
    var pos = V3{ fwd[0] * a + right[0] * b, c, fwd[2] * a + right[2] * b };
    const target = V3{ fwd[0] * lead, look_y, fwd[2] * lead };
    const local = t / dwell - @as(f64, @floatFromInt(n));
    const frac = local * 0.05;
    pos[0] += (target[0] - pos[0]) * frac;
    pos[1] += (target[1] - pos[1]) * frac;
    pos[2] += (target[2] - pos[2]) * frac;
    return .{ .pos = pos, .target = target, .fov = fov * (1 - frac * 0.25) };
}

const N: u64 = 5_000_000;

fn report(name: []const u8, ns_per: f64, checksum: f64) void {
    std.debug.print("{s: <13} {d: >7.2} ns/solve  {d: >7.1} M/s   (checksum {d:.1})\n", .{
        name, ns_per, (1000.0 / ns_per), checksum,
    });
}

pub fn main() void {
    std.debug.print("camera rig solve — Zig (ReleaseFast, f64)\n", .{});
    std.debug.print("iterations: {d} per rig, input varied each iteration\n\n", .{N});

    inline for (.{
        "orbit", "follow", "topDown", "isometric", "firstPerson", "freeFly", "cinematic",
    }) |name| {
        var sum: f64 = 0;
        var timer = std.time.Timer.start() catch unreachable;
        var i: u64 = 0;
        while (i < N) : (i += 1) {
            const fi: f64 = @floatFromInt(i);
            const s: Solved = blk: {
                if (comptime std.mem.eql(u8, name, "orbit")) break :blk orbit(fi * 0.013, 35 + @as(f64, @floatFromInt(i % 80)), 7, 1);
                if (comptime std.mem.eql(u8, name, "follow")) break :blk follow(fi * 0.05, 6, 3);
                if (comptime std.mem.eql(u8, name, "topDown")) break :blk topDown(13, 12, fi * 0.05);
                if (comptime std.mem.eql(u8, name, "isometric")) break :blk isometric(fi * 0.013, 17);
                if (comptime std.mem.eql(u8, name, "firstPerson")) break :blk firstPerson(fi * 0.05, @as(f64, @floatFromInt(@as(i64, @intCast(i % 160)) - 80)));
                if (comptime std.mem.eql(u8, name, "freeFly")) break :blk freeFly(fi * 0.001, 5, 16, fi * 0.05, -10);
                break :blk cinematic(0, fi * 0.0005);
            };
            sum += s.pos[0] + s.pos[1] + s.pos[2] + s.target[0] + s.target[1] + s.target[2] + s.fov;
        }
        const elapsed_ns: f64 = @floatFromInt(timer.read());
        std.mem.doNotOptimizeAway(sum);
        report(name, elapsed_ns / @as(f64, @floatFromInt(N)), sum);
    }
    std.debug.print("\nNote: a real frame runs ONE solve. ns/solve / 16,666,000 ns (60fps budget) = share of frame.\n", .{});
}
