(() => {
  // cart/editor/data/globals.ts
  var DEFAULT_PHYSICS_GLOBALS = {
    gravity: 13.5,
    jumpSpeed: 5.65,
    playerRadius: 0.34,
    playerHeight: 1.65,
    stepHeight: 0.5,
    wallRestitution: 0.08,
    bodyRestitution: 0.72,
    sidePushGrace: 0.08,
    accelMult: 1,
    surfaceFriction: 0.55,
    surfaceRestitution: 0,
    walkSpeed: 2.4,
    runSpeed: 5.8
  };
  var PHYSICS_GLOBAL_SPECS = [
    { path: "walkSpeed", label: "walk speed m/s", ctl: "num", group: "MOVEMENT", base: DEFAULT_PHYSICS_GLOBALS.walkSpeed, min: 0, max: 15, step: 0.1 },
    { path: "runSpeed", label: "run speed m/s", ctl: "num", group: "MOVEMENT", base: DEFAULT_PHYSICS_GLOBALS.runSpeed, min: 0, max: 25, step: 0.1 },
    { path: "accelMult", label: "acceleration \xD7", ctl: "num", group: "MOVEMENT", base: DEFAULT_PHYSICS_GLOBALS.accelMult, min: 0.05, max: 4, step: 0.05 },
    { path: "surfaceFriction", label: "ground friction", ctl: "num", group: "MOVEMENT", base: DEFAULT_PHYSICS_GLOBALS.surfaceFriction, min: 0, max: 2, step: 0.05 },
    { path: "gravity", label: "gravity m/s\xB2", ctl: "num", group: "JUMP + GRAVITY", base: DEFAULT_PHYSICS_GLOBALS.gravity, min: 0, max: 60, step: 0.25 },
    { path: "jumpSpeed", label: "jump speed m/s", ctl: "num", group: "JUMP + GRAVITY", base: DEFAULT_PHYSICS_GLOBALS.jumpSpeed, min: 0, max: 30, step: 0.05 },
    { path: "playerRadius", label: "body radius m", ctl: "num", group: "PLAYER BODY", base: DEFAULT_PHYSICS_GLOBALS.playerRadius, min: 0.05, max: 1, step: 0.01 },
    { path: "playerHeight", label: "body height m", ctl: "num", group: "PLAYER BODY", base: DEFAULT_PHYSICS_GLOBALS.playerHeight, min: 0.2, max: 4, step: 0.05 },
    { path: "stepHeight", label: "step height m", ctl: "num", group: "PLAYER BODY", base: DEFAULT_PHYSICS_GLOBALS.stepHeight, min: 0, max: 2, step: 0.05 },
    { path: "wallRestitution", label: "wall bounce", ctl: "num", group: "COLLISION RESPONSE", base: DEFAULT_PHYSICS_GLOBALS.wallRestitution, min: 0, max: 1, step: 0.02 },
    { path: "bodyRestitution", label: "body bounce", ctl: "num", group: "COLLISION RESPONSE", base: DEFAULT_PHYSICS_GLOBALS.bodyRestitution, min: 0, max: 1, step: 0.02 },
    { path: "surfaceRestitution", label: "ground bounce", ctl: "num", group: "COLLISION RESPONSE", base: DEFAULT_PHYSICS_GLOBALS.surfaceRestitution, min: 0, max: 1, step: 0.02 },
    { path: "sidePushGrace", label: "ledge grace m", ctl: "num", group: "COLLISION RESPONSE", base: DEFAULT_PHYSICS_GLOBALS.sidePushGrace, min: 0, max: 0.5, step: 0.01 }
  ];
  function packPhysicsGlobals(p) {
    return new Float32Array([
      p.gravity,
      p.jumpSpeed,
      p.playerRadius,
      p.playerHeight,
      p.stepHeight,
      p.wallRestitution,
      p.bodyRestitution,
      p.sidePushGrace,
      p.accelMult,
      p.surfaceFriction,
      p.surfaceRestitution,
      p.walkSpeed,
      p.runSpeed
    ]);
  }
  function revivePhysicsGlobals(raw) {
    const out = { ...DEFAULT_PHYSICS_GLOBALS };
    if (!raw || typeof raw !== "object") return out;
    for (const key of Object.keys(out)) {
      const v = raw[key];
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
      else if (v !== void 0) console.error(`[globals] ${key} in the save is not a finite number (${String(v)}) \u2014 keeping the default ${out[key]}`);
    }
    return out;
  }

  // cart/editor/data/globals.test.ts
  var passed = 0;
  var failed = 0;
  var log = globalThis.print ?? ((s) => globalThis.__writeStdout?.(s + "\n"));
  function test(name, fn) {
    try {
      fn();
      passed++;
      log(`  ok  ${name}`);
    } catch (e) {
      failed++;
      log(`FAIL  ${name}: ${e.message}`);
    }
  }
  function assert(c, m) {
    if (!c) throw new Error(m);
  }
  test("packPhysicsGlobals emits the 13-float lump order the host reads", () => {
    const packed = packPhysicsGlobals({
      gravity: 1,
      jumpSpeed: 2,
      playerRadius: 3,
      playerHeight: 4,
      stepHeight: 5,
      wallRestitution: 6,
      bodyRestitution: 7,
      sidePushGrace: 8,
      accelMult: 9,
      surfaceFriction: 10,
      surfaceRestitution: 11,
      walkSpeed: 12,
      runSpeed: 13
    });
    assert(packed.length === 13, `13 floats, got ${packed.length}`);
    for (let i = 0; i < 13; i += 1) assert(packed[i] === i + 1, `slot ${i} carries field ${i + 1}, got ${packed[i]}`);
  });
  test("every spec row maps onto a real PhysicsGlobals field with its default as base", () => {
    for (const spec of PHYSICS_GLOBAL_SPECS) {
      const def = DEFAULT_PHYSICS_GLOBALS[spec.path];
      assert(def !== void 0, `spec '${spec.path}' names a PhysicsGlobals field`);
      assert(spec.base === def, `spec '${spec.path}' base ${spec.base} === default ${def}`);
      assert(spec.min <= def && def <= spec.max, `spec '${spec.path}' default ${def} inside [${spec.min}, ${spec.max}]`);
    }
  });
  test("revivePhysicsGlobals keeps saved numbers, drops junk, fills defaults", () => {
    const revived = revivePhysicsGlobals({ jumpSpeed: 9.5, gravity: "nope", extra: 1 });
    assert(revived.jumpSpeed === 9.5, `saved jumpSpeed kept, got ${revived.jumpSpeed}`);
    assert(revived.gravity === DEFAULT_PHYSICS_GLOBALS.gravity, `junk gravity fell back to default, got ${revived.gravity}`);
    assert(revived.walkSpeed === DEFAULT_PHYSICS_GLOBALS.walkSpeed, `missing walkSpeed filled from default, got ${revived.walkSpeed}`);
    assert(!("extra" in revived), "unknown keys dropped");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
