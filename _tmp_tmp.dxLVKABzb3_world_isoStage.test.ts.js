(() => {
  // runtime/cameras/solve.ts
  function solveCamera(rig, params = {}, modifiers = []) {
    let s = rig.solve({ ...rig.defaults, ...params });
    for (const m of modifiers) s = m(s);
    return s;
  }

  // runtime/cameras/unproject.ts
  function screenRay(sx, sy, rect, cam) {
    const { pos, target, fov } = cam;
    let fx = pos[0] - target[0];
    let fy = pos[1] - target[1];
    let fz = pos[2] - target[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    let sxv = fz;
    let syv = 0;
    let szv = -fx;
    const sl = Math.hypot(sxv, syv, szv) || 1;
    sxv /= sl;
    syv /= sl;
    szv /= sl;
    const ux = fy * szv - fz * syv;
    const uy = fz * sxv - fx * szv;
    const uz = fx * syv - fy * sxv;
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const aspect = w / h;
    const tanHalf = Math.tan(fov * Math.PI / 180 / 2);
    const ndcX = sx / w * 2 - 1;
    const ndcY = 1 - sy / h * 2;
    const vx = ndcX * tanHalf * aspect;
    const vy = ndcY * tanHalf;
    const vz = -1;
    let dx = vx * sxv + vy * ux + vz * fx;
    let dy = vx * syv + vy * uy + vz * fy;
    let dz = vx * szv + vy * uz + vz * fz;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
    return { origin: [pos[0], pos[1], pos[2]], dir: [dx, dy, dz] };
  }
  function worldToScreen(world, rect, cam) {
    const { pos, target, fov } = cam;
    let fx = pos[0] - target[0];
    let fy = pos[1] - target[1];
    let fz = pos[2] - target[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    let sxv = fz;
    let syv = 0;
    let szv = -fx;
    const sl = Math.hypot(sxv, syv, szv) || 1;
    sxv /= sl;
    syv /= sl;
    szv /= sl;
    const ux = fy * szv - fz * syv;
    const uy = fz * sxv - fx * szv;
    const uz = fx * syv - fy * sxv;
    const rx = world[0] - pos[0];
    const ry = world[1] - pos[1];
    const rz = world[2] - pos[2];
    const cx = rx * sxv + ry * syv + rz * szv;
    const cy = rx * ux + ry * uy + rz * uz;
    const depth = -(rx * fx + ry * fy + rz * fz);
    if (depth <= 1e-6) return null;
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const aspect = w / h;
    const tanHalf = Math.tan(fov * Math.PI / 180 / 2);
    const ndcX = cx / depth / (tanHalf * aspect);
    const ndcY = cy / depth / tanHalf;
    return { x: (ndcX + 1) / 2 * w, y: (1 - ndcY) / 2 * h, depth };
  }
  function unprojectGround(sx, sy, rect, cam, heightAt = () => 0) {
    const { origin, dir } = screenRay(sx, sy, rect, cam);
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = dir;
    const STEP = 0.2;
    const MAX_T = 400;
    let prevT = 0;
    for (let t = STEP; t < MAX_T; t += STEP) {
      const wx = ox + t * dx;
      const wz = oz + t * dz;
      const gap = oy + t * dy - heightAt(wx, wz);
      if (gap <= 0) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) / 2;
          const mx = ox + mid * dx;
          const mz = oz + mid * dz;
          if (oy + mid * dy - heightAt(mx, mz) <= 0) hi = mid;
          else lo = mid;
        }
        const ft = (lo + hi) / 2;
        return { x: ox + ft * dx, y: oz + ft * dz };
      }
      prevT = t;
    }
    return { x: cam.target[0], y: cam.target[2] };
  }

  // runtime/cameras/_util.ts
  var DEG = Math.PI / 180;
  function orbitalEye(target, yawDeg, pitchDeg, dist) {
    const yaw = yawDeg * DEG;
    const elev = pitchDeg * DEG;
    const horiz = dist * Math.cos(elev);
    const height = dist * Math.sin(elev);
    return [
      target[0] - Math.sin(yaw) * horiz,
      target[1] + height,
      target[2] - Math.cos(yaw) * horiz
    ];
  }

  // runtime/cameras/rigs/isometric.ts
  var ISO_PITCH = 35.264;
  var ISOMETRIC_DEFAULTS = {
    target: [0, 0, 0],
    yaw: 45,
    dist: 24,
    fov: 30
  };
  function solve(p) {
    return { pos: orbitalEye(p.target, p.yaw, p.pitch ?? ISO_PITCH, p.dist), target: p.target, fov: p.fov };
  }
  var Isometric = { id: "Isometric", solve, defaults: ISOMETRIC_DEFAULTS };

  // cart/editor/world/isoStage.ts
  var ISO_YAW_START = 45;
  var ISO_FOV = 22;
  var BASE_DIST = 90;
  var MIN_ZOOM = 0.12;
  var MAX_ZOOM = 10;
  var ISO_PITCH2 = 35.264;
  var MIN_PITCH = 12;
  var MAX_PITCH = 80;
  var METERS_PER_LEVEL = 3;
  var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  var IsoStage = class {
    pose;
    sampleHeight;
    focusTerrainY = 0;
    constructor(initial, heightAt = () => 0) {
      const migratedViewY = initial?.viewY ?? (initial?.level ?? 0) * METERS_PER_LEVEL;
      this.pose = { centerX: 0, centerZ: 0, yaw: ISO_YAW_START, pitch: ISO_PITCH2, zoom: 1, level: 0, ...initial, viewY: migratedViewY };
      this.sampleHeight = heightAt;
    }
    // Swap the terrain sampler when the painted world changes, without rebuilding the
    // stage (which would drop the pose).
    setHeightSampler(heightAt) {
      this.sampleHeight = heightAt;
    }
    // Sample exactly once at an interaction/update boundary. `solve()` is also
    // used by every projected overlay corner, so doing capability I/O inside it
    // would multiply host crossings by the number of visible guides.
    refreshTerrainElevation() {
      const sampled = this.sampleHeight(this.pose.centerX, this.pose.centerZ);
      const next = Number.isFinite(sampled) ? sampled : 0;
      if (next === this.focusTerrainY) return false;
      this.focusTerrainY = next;
      return true;
    }
    yawDegrees() {
      return this.pose.yaw;
    }
    levelElevation() {
      return this.pose.level * METERS_PER_LEVEL;
    }
    terrainElevation() {
      return this.focusTerrainY;
    }
    focusElevation() {
      return this.terrainElevation() + this.pose.viewY;
    }
    // Semantic solve for boot-frame parity and picking. The rendered author viewport
    // is native-driven (the pose is pushed through __compiled_world_set_camera), not
    // per-frame JS camera props.
    solve() {
      const dist = BASE_DIST / clamp(this.pose.zoom, MIN_ZOOM, MAX_ZOOM);
      const target = [this.pose.centerX, this.focusElevation(), this.pose.centerZ];
      return solveCamera(Isometric, {
        target,
        yaw: this.yawDegrees(),
        dist,
        fov: ISO_FOV,
        pitch: clamp(this.pose.pitch ?? ISO_PITCH2, MIN_PITCH, MAX_PITCH)
      });
    }
    // Rotate the whole view 90° (the ⟲⟳ buttons / Q·E). Snaps to the nearest iso detent
    // (45° + k·90° — the corner-on views) from wherever a free drag left the yaw, then
    // steps, so the buttons always land square on a clean quarter turn.
    rotate(dir) {
      const detent = Math.round((this.pose.yaw - ISO_YAW_START) / 90) * 90 + ISO_YAW_START;
      this.pose.yaw = detent + dir * 90;
    }
    // Continuous rotate from a mouse drag (degrees). Lets you spin the view to any angle,
    // not just the four detents.
    rotateBy(deltaDegrees) {
      this.pose.yaw += deltaDegrees;
    }
    // Tilt the view (req_2710): raise toward a plan view or lower toward the
    // horizon. Clamped so the camera never goes level or straight-down.
    pitchBy(deltaDegrees) {
      this.pose.pitch = clamp((this.pose.pitch ?? ISO_PITCH2) + deltaDegrees, MIN_PITCH, MAX_PITCH);
    }
    zoomBy(factor) {
      this.pose.zoom = clamp(this.pose.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    }
    // The cursor's world point on a local analytic plane through the terrain
    // beneath the camera focus + the active storey. Distance-independent on
    // purpose: the marching
    // unprojectGround caps its ray at MAX_T≈400m, but the iso eye sits BASE_DIST/zoom
    // (up to ~750m at MIN_ZOOM) from the target, so a zoomed-out cursor ray never
    // reaches the ground and the march bails to cam.target — which made zoom-to-cursor
    // jump the centre to the middle of nowhere. A plane solve has no range limit and
    // is exact for the "keep this point under the cursor" anchor (terrain height under
    // the pointer is irrelevant to a horizontal pan delta). Returns null only if the
    // ray is parallel to the plane or the plane sits behind the eye.
    pointOnPlane(sx, sy, rect, planeY) {
      const r = screenRay(sx, sy, rect, this.solve());
      const dy = r.dir[1];
      if (Math.abs(dy) < 1e-6) return null;
      const t = (planeY - r.origin[1]) / dy;
      if (t <= 0) return null;
      return { x: r.origin[0] + t * r.dir[0], z: r.origin[2] + t * r.dir[2] };
    }
    groundPoint(sx, sy, rect) {
      return this.pointOnPlane(sx, sy, rect, this.terrainElevation() + this.levelElevation());
    }
    navigationPoint(sx, sy, rect) {
      return this.pointOnPlane(sx, sy, rect, this.focusElevation());
    }
    // Zoom toward the cursor (map/Sims behaviour): keep the ground point under the
    // pointer fixed while the distance changes, instead of diving at the screen
    // centre. Solve the cursor's plane point before and after the zoom and shift centre
    // by the difference — so "point at a building and roll in" brings THAT building
    // closer. If either solve fails (degenerate ray), zoom in place rather than jump.
    zoomToCursor(sx, sy, factor, rect) {
      const before = this.navigationPoint(sx, sy, rect);
      this.zoomBy(factor);
      const after = this.navigationPoint(sx, sy, rect);
      if (!before || !after) return;
      this.pose.centerX += before.x - after.x;
      this.pose.centerZ += before.z - after.z;
    }
    // Metres the eye sits from the target at the current zoom — pan speed scales by
    // this so a gesture crosses the same fraction of the view whether you're
    // surveying a district or detailing a wall.
    distance() {
      return BASE_DIST / clamp(this.pose.zoom, MIN_ZOOM, MAX_ZOOM);
    }
    // Pan: slide the centre across the GROUND along the view's own forward and right
    // axes (derived from the solved eye→target), so "up" always means "deeper into
    // the screen" regardless of which 90° facing you've rotated to. Units: metres.
    nudge(forward, strafe) {
      const cam = this.solve();
      let fx = cam.target[0] - cam.pos[0];
      let fz = cam.target[2] - cam.pos[2];
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl;
      fz /= fl;
      const rx = -fz, rz = fx;
      this.pose.centerX += fx * forward + rx * strafe;
      this.pose.centerZ += fz * forward + rz * strafe;
    }
    // Active floor. setLevel clamps at the ground; raise/lower step one storey.
    setLevel(level) {
      this.pose.level = Math.max(0, Math.round(level));
    }
    raiseLevel() {
      this.setLevel(this.pose.level + 1);
    }
    lowerLevel() {
      this.setLevel(this.pose.level - 1);
    }
    // "Grab the map" pan: solve the cursor's previous and current plane points and shift
    // the centre so the grabbed world point stays under the cursor. Rig-agnostic and
    // trig-free — it rides the same analytic focus plane as zoomToCursor, so it stays
    // exact through every rotation and zoom (no per-facing sign juggling) and never
    // suffers the marched-ray range cap. No-op if either solve is degenerate.
    dragPan(prevX, prevY, curX, curY, rect) {
      const a = this.navigationPoint(prevX, prevY, rect);
      const b = this.navigationPoint(curX, curY, rect);
      if (!a || !b) return;
      this.pose.centerX += a.x - b.x;
      this.pose.centerZ += a.z - b.z;
    }
    // Screen pixel -> world cell on the active level. Level 0 follows painted terrain;
    // higher floors pick a flat slab at levelElevation() so upper-storey edits land on
    // a plane, not on whatever roof happens to be under the cursor.
    pickCell(sx, sy, rect) {
      const g = unprojectGround(sx, sy, rect, this.solve(), this.levelHeightSampler());
      return { tx: Math.floor(g.x), tz: Math.floor(g.y), wx: g.x, wz: g.y };
    }
    // The cursor's world ray, in the build-door shape raycastBuild consumes — so the
    // pane drives the SAME picking the host does, just from the pointer.
    worldRay(sx, sy, rect) {
      const r = screenRay(sx, sy, rect, this.solve());
      return {
        origin: { x: r.origin[0], y: r.origin[1], z: r.origin[2] },
        dir: { x: r.dir[0], y: r.dir[1], z: r.dir[2] }
      };
    }
    // World point -> pane-local screen pixel (the exact inverse of worldRay/groundPoint),
    // for the 2D projected overlay the pane draws its ghost with (no second React 3D
    // surface). Returns null when the point sits at/behind the eye plane. Pane-local
    // because worldToScreen reads only rect.width/height.
    project(wx, wy, wz, rect) {
      const s = worldToScreen([wx, wy, wz], rect, this.solve());
      return s ? { x: s.x, y: s.y } : null;
    }
    // Centre the view on a world tile (e.g. jump to a placement, or to the painted
    // centre on open) without disturbing facing/zoom/level.
    centerOn(tx, tz) {
      this.pose.centerX = tx;
      this.pose.centerZ = tz;
    }
    // The height field picks resolve against: terrain at level 0, else a flat slab.
    levelHeightSampler() {
      if (this.pose.level <= 0) return this.sampleHeight;
      const elev = this.levelElevation();
      return () => elev;
    }
  };

  // cart/editor/world/isoStage.test.ts
  var passed = 0;
  var failed = 0;
  var log = globalThis.print ?? ((s) => globalThis.__writeStdout?.(`${s}
`));
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      log(`FAIL  ${name}: ${error.message}`);
    }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  test("changing the active storey leaves the solved camera exactly fixed", () => {
    const stage = new IsoStage({ centerX: 8, centerZ: -3, yaw: 125, pitch: 42, zoom: 1.7 });
    const before = stage.solve();
    stage.setLevel(12);
    const after = stage.solve();
    assert(JSON.stringify(after) === JSON.stringify(before), "floor selection moved the solved camera");
    assert(stage.levelElevation() === 12 * METERS_PER_LEVEL, "floor selection did not move the editing plane");
  });
  test("legacy hot camera height migrates independently from later floor choices", () => {
    const stage = new IsoStage({ level: 4 });
    const before = stage.solve();
    stage.setLevel(9);
    const after = stage.solve();
    assert(before.target[1] === 4 * METERS_PER_LEVEL, "legacy view height was not preserved");
    assert(after.target[1] === before.target[1], "later floor selection changed the migrated camera height");
  });
  test("camera orbit follows terrain while preserving its authored clearance", () => {
    const stage = new IsoStage(
      { centerX: 8, centerZ: -3, viewY: 4, yaw: 125, pitch: 42, zoom: 1.7 },
      (x, z) => x * 2 - z
    );
    stage.refreshTerrainElevation();
    const low = stage.solve();
    assert(low.target[1] === 23, `terrain focus was ${low.target[1]}, expected 23`);
    const lowOffset = low.pos[1] - low.target[1];
    stage.centerOn(18, -3);
    stage.refreshTerrainElevation();
    const high = stage.solve();
    assert(high.target[1] === 43, `panned terrain focus was ${high.target[1]}, expected 43`);
    assert(Math.abs(high.pos[1] - high.target[1] - lowOffset) < 1e-9, "terrain rise changed the authored orbit clearance");
  });
  test("terrain-following camera remains independent of the active storey", () => {
    const stage = new IsoStage({ centerX: 12, centerZ: 5, viewY: 2 }, () => 70);
    stage.refreshTerrainElevation();
    const before = stage.solve();
    stage.setLevel(9);
    const after = stage.solve();
    assert(JSON.stringify(after) === JSON.stringify(before), "storey selection moved the terrain-following camera");
  });
  test("an invalid terrain sample degrades to flat ground", () => {
    const stage = new IsoStage({ viewY: 3 }, () => Number.NaN);
    stage.refreshTerrainElevation();
    assert(stage.solve().target[1] === 3, "invalid terrain escaped the stage boundary");
  });
  test("camera projections reuse one cached terrain sample", () => {
    let samples = 0;
    const stage = new IsoStage({ centerX: 2, centerZ: 4 }, () => {
      samples += 1;
      return 12;
    });
    stage.refreshTerrainElevation();
    stage.solve();
    stage.solve();
    stage.project(2, 12, 4, { x: 0, y: 0, width: 800, height: 600 });
    stage.worldRay(400, 300, { x: 0, y: 0, width: 800, height: 600 });
    assert(samples === 1, `pure solves crossed the terrain door ${samples} times`);
  });
  test("elevated terrain keeps zoom and drag navigation on the camera focus plane", () => {
    const rect = { x: 0, y: 0, width: 1e3, height: 800 };
    const elevated = new IsoStage({ centerX: 10, centerZ: -6, viewY: 3, level: 8, yaw: 45, pitch: 40, zoom: 1 }, () => 70);
    elevated.refreshTerrainElevation();
    elevated.zoomToCursor(500, 400, 1.5, rect);
    assert(Math.abs(elevated.pose.centerX - 10) < 1e-9 && Math.abs(elevated.pose.centerZ + 6) < 1e-9, "center-cursor zoom drifted off elevated focus");
    const flat = new IsoStage({ centerX: 10, centerZ: -6, viewY: 3, level: 8, yaw: 45, pitch: 40, zoom: 1.5 }, () => 0);
    flat.refreshTerrainElevation();
    elevated.dragPan(300, 350, 355, 390, rect);
    flat.dragPan(300, 350, 355, 390, rect);
    assert(Math.abs(elevated.pose.centerX - flat.pose.centerX) < 1e-9, "terrain altitude changed horizontal drag X");
    assert(Math.abs(elevated.pose.centerZ - flat.pose.centerZ) < 1e-9, "terrain altitude changed horizontal drag Z");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
