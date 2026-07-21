(() => {
  // runtime/skeleton/rigs.ts
  function pair(name, parent) {
    return ["left", "right"].map((side) => ({ id: `${name}_${side}`, parent }));
  }
  function pairUnder(name, parentPair) {
    return ["left", "right"].map((side) => ({ id: `${name}_${side}`, parent: `${parentPair}_${side}` }));
  }
  function bodyRigBones() {
    return [
      { id: "body" },
      { id: "abdomen", parent: "body" },
      { id: "butt", parent: "abdomen" },
      { id: "crotch", parent: "abdomen" },
      { id: "chest", parent: "abdomen" },
      { id: "breast", parent: "chest" },
      { id: "back", parent: "chest" },
      { id: "head", parent: "chest" },
      { id: "mouth", parent: "head" },
      { id: "lips", parent: "mouth" },
      { id: "teeth", parent: "mouth" },
      { id: "hair", parent: "head" },
      { id: "nose", parent: "head" },
      ...pair("eye", "head"),
      ...pair("shoulder", "chest"),
      ...pairUnder("upper_arm", "shoulder"),
      ...pairUnder("elbow", "upper_arm"),
      ...pairUnder("lower_arm", "elbow"),
      ...pairUnder("wrist", "lower_arm"),
      ...pairUnder("hand", "wrist"),
      ...pairUnder("fingers", "hand"),
      ...pair("hip", "abdomen"),
      ...pairUnder("upper_leg", "hip"),
      ...pairUnder("knee", "upper_leg"),
      ...pairUnder("lower_leg", "knee"),
      ...pairUnder("foot", "lower_leg"),
      ...pairUnder("toes", "foot")
    ];
  }
  function carRigBones() {
    const hingeY = { kind: "hinge", axis: [0, 1, 0] };
    const spinX = { kind: "spin", axis: [1, 0, 0] };
    return [
      { id: "body" },
      { id: "bumper_front", parent: "body" },
      { id: "bumper_back", parent: "body" },
      { id: "hood", parent: "body", joint: hingeY },
      { id: "trunk", parent: "body", joint: hingeY },
      { id: "door_driver", parent: "body", joint: hingeY },
      { id: "door_passenger", parent: "body", joint: hingeY },
      { id: "gas", parent: "body", joint: hingeY },
      { id: "windshield", parent: "body" },
      { id: "window", parent: "body" },
      { id: "lights_front", parent: "body" },
      { id: "lights_back", parent: "body" },
      { id: "seat_driver", parent: "body" },
      { id: "seat_passenger", parent: "body" },
      { id: "wheel_front_left", parent: "body", joint: spinX },
      { id: "wheel_front_right", parent: "body", joint: spinX },
      { id: "wheel_back_left", parent: "body", joint: spinX },
      { id: "wheel_back_right", parent: "body", joint: spinX }
    ];
  }
  function normalizeBoneName(name) {
    let n = name.trim().toLowerCase().replace(/[\s\-.]+/g, "_");
    n = n.replace(/_l$/, "_left").replace(/_r$/, "_right");
    return n;
  }

  // cart/editor/data/roleNamer.ts
  function headRoles() {
    const bones = bodyRigBones();
    const parentOf = new Map(bones.map((bone) => [bone.id, bone.parent]));
    const underHead = (id) => {
      for (let at = id; at; at = parentOf.get(at)) {
        if (at === "head") return true;
      }
      return false;
    };
    return bones.map((bone) => bone.id).filter(underHead);
  }
  function roleContract(id) {
    if (id === "head") return { id, label: "head", roles: headRoles() };
    if (id === "body") return { id, label: "body", roles: bodyRigBones().map((bone) => bone.id) };
    return { id, label: "car", roles: carRigBones().map((bone) => bone.id) };
  }
  function roleNamerPlan(contractId, partNames) {
    const contract = roleContract(contractId);
    const roles = new Set(contract.roles);
    const claimed = /* @__PURE__ */ new Map();
    for (const name of partNames) {
      const bone = normalizeBoneName(name);
      if (roles.has(bone) && !claimed.has(bone)) claimed.set(bone, name);
    }
    return { contract, open: contract.roles.filter((role) => !claimed.has(role)), claimed };
  }

  // cart/editor/data/roleNamer.test.ts
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
  function expect(cond, msg) {
    if (!cond) throw new Error(msg);
  }
  test("head contract is the head subtree, not the whole body", () => {
    const roles = roleContract("head").roles;
    expect(roles.includes("head"), "head itself is in");
    expect(roles.includes("eye_left") && roles.includes("eye_right"), "eye pair is in");
    expect(roles.includes("lips") && roles.includes("teeth"), "mouth chain is in");
    expect(!roles.includes("toes_left") && !roles.includes("chest"), "body-only bones are out");
  });
  test("body and car contracts carry their full formations", () => {
    expect(roleContract("body").roles.includes("toes_left"), "body reaches the toes");
    expect(roleContract("car").roles.includes("door_driver"), "car has its panels");
  });
  test("plan marks claimed roles via bone-name normalization and asks only the rest", () => {
    const plan = roleNamerPlan("head", ["Eye.L", "nose", "Cube 1", "Cone 4"]);
    expect(plan.claimed.get("eye_left") === "Eye.L", "Eye.L normalizes to eye_left");
    expect(plan.claimed.get("nose") === "nose", "exact name claims");
    expect(!plan.open.includes("eye_left") && !plan.open.includes("nose"), "claimed roles are not asked");
    expect(plan.open.includes("eye_right") && plan.open.includes("mouth"), "missing roles are asked");
  });
  test("first claimant wins a role \u2014 a duplicate name never double-claims", () => {
    const plan = roleNamerPlan("head", ["head", "HEAD"]);
    expect(plan.claimed.get("head") === "head", "first row claims");
    expect(!plan.open.includes("head"), "role stays satisfied");
  });
  log(`${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
