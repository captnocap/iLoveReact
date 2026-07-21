(() => {
  // cart/editor/material/colorStudioCommand.ts
  var ColorStudioRejected = class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
      this.name = "ColorStudioRejected";
    }
    code;
  };
  var MAX_PALETTE_COLORS = 64;
  function rgb(rgb2) {
    return [rgb2[0], rgb2[1], rgb2[2]];
  }
  function color(color2) {
    return { l: color2.l, c: color2.c, h: color2.h };
  }
  function validRgb(value) {
    return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1);
  }
  function validColor(value) {
    const c = value;
    return !!c && Number.isFinite(c.l) && Number.isFinite(c.c) && Number.isFinite(c.h) && c.l >= 0 && c.l <= 1 && c.c >= 0;
  }
  function sameRgb(a, b) {
    return !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }
  function sameColor(a, b) {
    return a.l === b.l && a.c === b.c && a.h === b.h;
  }
  function samePalette(a, b) {
    return a.length === b.length && a.every((entry, index) => sameColor(entry, b[index]));
  }
  function authored(snapshot2) {
    return {
      overrides: Object.fromEntries(Object.entries(snapshot2.overrides).map(([key, value]) => [key, rgb(value)])),
      palette: snapshot2.palette.map(color),
      currentColor: color(snapshot2.currentColor)
    };
  }
  function requireSpec(policy2, id) {
    const spec = policy2.spec(id);
    if (!spec) throw new ColorStudioRejected("UNKNOWN_MATERIAL", `unknown Color Studio material '${id}'`);
    return spec;
  }
  function requireInteger(value, label, min, maxExclusive) {
    if (!Number.isInteger(value) || value < min || value >= maxExclusive) {
      throw new ColorStudioRejected("OUT_OF_RANGE", `${label} must be an integer in ${min}..${Math.max(min, maxExclusive - 1)}`);
    }
    return value;
  }
  function overrideKey(specId, variant, slot) {
    return `${specId}:${variant}:${slot}`;
  }
  function planVariantChoice(snapshot2, variant, policy2) {
    const spec = requireSpec(policy2, snapshot2.materialId);
    const next = requireInteger(variant, "variant", 0, spec.variants.length);
    const activeSlot = Math.min(snapshot2.activeSlot, Math.max(0, spec.slots.length - 1));
    return {
      kind: "variant",
      changed: snapshot2.variant !== next || snapshot2.activeSlot !== activeSlot,
      label: `${spec.label} variant \u2192 ${spec.variants[next].label}`,
      targetId: `${spec.id}:${next}`,
      patch: { variant: next, activeSlot }
    };
  }
  function planCurrentColorChoice(snapshot2, nextColor, source, scenePick) {
    if (!validColor(nextColor)) throw new ColorStudioRejected("INVALID_COLOR", "current color is malformed");
    if (typeof source !== "string" || !source.trim()) throw new ColorStudioRejected("INVALID_SOURCE", "color source is required");
    if (scenePick !== void 0 && scenePick !== null && typeof scenePick !== "string") {
      throw new ColorStudioRejected("INVALID_SCENE_PICK", "scene pick must be a color string or null");
    }
    const nextScenePick = scenePick === void 0 ? snapshot2.scenePick : scenePick;
    return {
      kind: "color",
      changed: !sameColor(snapshot2.currentColor, nextColor) || nextScenePick !== snapshot2.scenePick,
      label: `current color \u2192 ${source.trim()}`,
      targetId: `${nextColor.l}:${nextColor.c}:${nextColor.h}`,
      source: source.trim(),
      patch: { currentColor: color(nextColor), scenePick: nextScenePick }
    };
  }
  function planSlotFill(snapshot2, args, policy2) {
    if (typeof args.specId !== "string") throw new ColorStudioRejected("INVALID_MATERIAL", "material id is required");
    const spec = requireSpec(policy2, args.specId);
    const variant = requireInteger(args.variant, "variant", 0, spec.variants.length);
    const slot = requireInteger(args.slot, "slot", 0, spec.slots.length);
    if (!validRgb(args.rgb)) throw new ColorStudioRejected("INVALID_RGB", "slot color must be three finite 0..1 channels");
    if (typeof args.source !== "string" || !args.source.trim()) throw new ColorStudioRejected("INVALID_SOURCE", "fill source is required");
    const key = overrideKey(spec.id, variant, slot);
    const previous = snapshot2.overrides[key] ?? null;
    if (sameRgb(previous, args.rgb)) throw new ColorStudioRejected("NO_CHANGE", `${spec.label} ${spec.slots[slot].name} already has that color`);
    const before = authored(snapshot2);
    const after = authored(snapshot2);
    after.overrides[key] = rgb(args.rgb);
    return {
      label: `fill ${spec.label} ${spec.slots[slot].name}`,
      transaction: {
        action: "slot.fill",
        specId: spec.id,
        specLabel: spec.label,
        variant,
        slot,
        slotName: spec.slots[slot].name,
        key,
        source: args.source.trim(),
        before: previous ? rgb(previous) : null,
        after: rgb(args.rgb)
      },
      before,
      after
    };
  }
  function planSlotsReset(snapshot2, args, policy2) {
    if (typeof args.specId !== "string") throw new ColorStudioRejected("INVALID_MATERIAL", "material id is required");
    const spec = requireSpec(policy2, args.specId);
    const variant = requireInteger(args.variant, "variant", 0, spec.variants.length);
    const changes = [];
    spec.slots.forEach((slot, index) => {
      const key = overrideKey(spec.id, variant, index);
      const previous = snapshot2.overrides[key];
      if (previous) changes.push({ key, slot: index, slotName: slot.name, before: rgb(previous), after: null });
    });
    if (!changes.length) throw new ColorStudioRejected("NO_CHANGE", `${spec.label} already uses baked defaults`);
    const before = authored(snapshot2);
    const after = authored(snapshot2);
    changes.forEach((change) => delete after.overrides[change.key]);
    return {
      label: `reset ${spec.label} variant ${variant}`,
      transaction: { action: "slots.reset", specId: spec.id, specLabel: spec.label, variant, changes },
      before,
      after
    };
  }
  function planPaletteAdd(snapshot2, args) {
    if (!validColor(args.color)) throw new ColorStudioRejected("INVALID_COLOR", "palette color is malformed");
    if (typeof args.source !== "string" || !args.source.trim()) throw new ColorStudioRejected("INVALID_SOURCE", "palette source is required");
    const before = authored(snapshot2);
    const after = authored(snapshot2);
    const index = after.palette.length;
    after.palette.push(color(args.color));
    return {
      label: `add color to tray`,
      transaction: { action: "palette.add", source: args.source.trim(), index, color: color(args.color) },
      before,
      after
    };
  }
  function planPaletteLoad(snapshot2, args) {
    if (!Array.isArray(args.colors) || args.colors.length < 1 || args.colors.length > MAX_PALETTE_COLORS || !args.colors.every(validColor)) {
      throw new ColorStudioRejected("INVALID_PALETTE", `palette must contain 1..${MAX_PALETTE_COLORS} valid colors`);
    }
    if (typeof args.setName !== "string" || !args.setName.trim()) throw new ColorStudioRejected("INVALID_SET", "palette set name is required");
    const colors = args.colors.map(color);
    if (samePalette(snapshot2.palette, colors) && sameColor(snapshot2.currentColor, colors[0])) {
      throw new ColorStudioRejected("NO_CHANGE", `${args.setName.trim()} is already loaded`);
    }
    const before = authored(snapshot2);
    const after = authored(snapshot2);
    after.palette = colors.map(color);
    after.currentColor = color(colors[0]);
    return {
      label: `load ${args.setName.trim()} palette`,
      transaction: {
        action: "palette.load",
        setName: args.setName.trim(),
        before: { palette: before.palette.map(color), currentColor: color(before.currentColor) },
        after: { palette: after.palette.map(color), currentColor: color(after.currentColor) }
      },
      before,
      after
    };
  }

  // cart/editor/material/colorStudioCommand.test.ts
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
  var policy = {
    qualityCount: 5,
    seedMax: 999,
    spec: (id) => id === "brick" ? {
      id: "brick",
      label: "Brick",
      variants: [{ label: "Clean" }, { label: "Dirty" }],
      slots: [
        { name: "Mortar", baked: [0.6, 0.6, 0.6] },
        { name: "Face", baked: [0.7, 0.1, 0.05] }
      ]
    } : null
  };
  function snapshot(overrides = {}) {
    return {
      materialId: "brick",
      variant: 1,
      seed: 4,
      quality: 3,
      activeSlot: 1,
      view: "materialPalette",
      currentColor: { l: 0.6, c: 0.1, h: 20 },
      scenePick: null,
      overrides,
      palette: [{ l: 0.5, c: 0.1, h: 10 }]
    };
  }
  test("slot fill carries an exact inverse and does not mutate its input snapshot", () => {
    const start = snapshot({ "brick:1:1": [0.2, 0.3, 0.4] });
    const plan = planSlotFill(start, {
      specId: "brick",
      variant: 1,
      slot: 1,
      rgb: [0.8, 0.7, 0.6],
      source: "hex #ccb399"
    }, policy);
    assert(plan.transaction.action === "slot.fill", "wrong transaction kind");
    assert(plan.transaction.action === "slot.fill" && plan.transaction.before?.[0] === 0.2, "previous override disappeared");
    assert(plan.after.overrides["brick:1:1"]?.[0] === 0.8, "forward color disappeared");
    assert(start.overrides["brick:1:1"]?.[0] === 0.2, "planner mutated source state");
  });
  test("reset removes only the active material variant and preserves every other override", () => {
    const plan = planSlotsReset(snapshot({
      "brick:1:0": [0.1, 0.2, 0.3],
      "brick:1:1": [0.4, 0.5, 0.6],
      "brick:0:1": [0.7, 0.8, 0.9]
    }), { specId: "brick", variant: 1 }, policy);
    assert(plan.transaction.action === "slots.reset" && plan.transaction.changes.length === 2, "reset inverse is incomplete");
    assert(plan.after.overrides["brick:1:0"] === void 0 && plan.after.overrides["brick:1:1"] === void 0, "active variant survived reset");
    assert(plan.after.overrides["brick:0:1"]?.[0] === 0.7, "another variant was erased");
    assert(plan.before.overrides["brick:1:0"]?.[0] === 0.1, "undo snapshot lost a slot");
  });
  test("tray add and library load are reversible workspace actions", () => {
    const added = planPaletteAdd(snapshot(), { color: { l: 0.8, c: 0.2, h: 90 }, source: "current color" });
    assert(added.transaction.action === "palette.add" && added.after.palette.length === 2, "tray add did not append once");
    assert(added.before.palette.length === 1, "tray inverse was not retained");
    const loaded = planPaletteLoad(snapshot(), {
      setName: "Dune Dusk",
      colors: [{ l: 0.2, c: 0.05, h: 30 }, { l: 0.9, c: 0.02, h: 80 }]
    });
    assert(loaded.transaction.action === "palette.load" && loaded.after.palette.length === 2, "library set did not replace the tray");
    assert(loaded.after.currentColor.l === 0.2 && loaded.before.currentColor.l === 0.6, "current-color inverse drifted");
  });
  test("report-only color selection is idempotent and never produces an action plan", () => {
    const same = planCurrentColorChoice(snapshot(), { l: 0.6, c: 0.1, h: 20 }, "color map");
    assert(!same.changed && same.kind === "color", "same settled color claimed a transition");
    const changed = planCurrentColorChoice(snapshot(), { l: 0.7, c: 0.1, h: 20 }, "color map");
    assert(changed.changed && changed.patch.currentColor?.l === 0.7, "settled color choice disappeared");
  });
  test("invalid, stale, and no-op requests reject before an action can commit", () => {
    const calls = [
      () => planSlotFill(snapshot(), { specId: "gone", variant: 0, slot: 0, rgb: [1, 0, 0], source: "test" }, policy),
      () => planSlotFill(snapshot({ "brick:1:1": [1, 0, 0] }), { specId: "brick", variant: 1, slot: 1, rgb: [1, 0, 0], source: "test" }, policy),
      () => planSlotsReset(snapshot(), { specId: "brick", variant: 1 }, policy),
      () => planVariantChoice(snapshot(), 99, policy)
    ];
    for (const call of calls) {
      let rejected = false;
      try {
        call();
      } catch (error) {
        rejected = error instanceof ColorStudioRejected;
      }
      assert(rejected, "invalid request did not reject");
    }
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
