(() => {
  // cart/editor/data/scaleBy.ts
  var SCALE_BY_TUNING = {
    min: 0.02,
    max: 50,
    defaultFactor: 48,
    noOpEpsilon: 1e-5,
    presets: [2, 16, 48]
  };
  function parseScaleByFactor(text) {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "Enter a scale factor." };
    const factor = Number(trimmed);
    if (!Number.isFinite(factor)) return { ok: false, error: "Scale factor must be a finite number." };
    if (factor < SCALE_BY_TUNING.min || factor > SCALE_BY_TUNING.max) {
      return { ok: false, error: `Use a factor from ${SCALE_BY_TUNING.min} to ${SCALE_BY_TUNING.max}.` };
    }
    if (Math.abs(factor - 1) < SCALE_BY_TUNING.noOpEpsilon) {
      return { ok: false, error: "\xD71 leaves the selection unchanged." };
    }
    return { ok: true, factor };
  }

  // cart/editor/data/scaleBy.test.ts
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
  test("accepts the bridge authoring factor exactly", () => {
    const parsed = parseScaleByFactor("48");
    assert(parsed.ok && parsed.factor === 48, "\xD748 did not survive parsing exactly");
  });
  test("accepts fractional down-scaling inside the engine contract", () => {
    const parsed = parseScaleByFactor("0.5");
    assert(parsed.ok && parsed.factor === 0.5, "fractional scale was rejected");
  });
  test("rejects no-op, non-finite, and out-of-contract factors without clamping", () => {
    assert(!parseScaleByFactor("1").ok, "\xD71 became a phantom edit");
    assert(!parseScaleByFactor("Infinity").ok, "infinite scale escaped validation");
    assert(!parseScaleByFactor(String(SCALE_BY_TUNING.max + 1)).ok, "oversize input was silently clamped");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
