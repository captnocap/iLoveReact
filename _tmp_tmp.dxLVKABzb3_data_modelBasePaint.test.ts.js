(() => {
  // cart/editor/data/modelPackageStore.ts
  function parseModelBasePaintText(text) {
    try {
      const value = JSON.parse(text);
      if (value.version !== 1 && value.version !== 2 && value.version !== 3) return null;
      if (typeof value.program !== "string" || value.version !== 3 && !value.program) return null;
      if (value.version === 3 && value.rasterBase !== true) return null;
      const layout = value.version === 2 || value.version === 3 ? Array.isArray(value.layout) && value.layout.length > 0 && value.layout.length % 4 === 0 && value.layout.every((entry, index) => Number.isInteger(entry) && entry >= 0 && (index % 4 < 2 || entry > 0)) ? value.layout.slice() : null : void 0;
      if ((value.version === 2 || value.version === 3) && !layout) return null;
      return {
        version: value.version,
        detail: typeof value.detail === "number" && Number.isFinite(value.detail) ? value.detail : 1,
        program: value.program,
        ...layout ? { layout } : {},
        ...value.version === 3 ? { rasterBase: true } : {}
      };
    } catch {
      return null;
    }
  }

  // cart/editor/data/modelBasePaint.test.ts
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
  test("base paint restores the durable stroke program and density", () => {
    const paint = parseModelBasePaintText(JSON.stringify({ version: 1, detail: 64, program: "c3Ryb2tlcw==" }));
    assert(paint?.detail === 64 && paint.program === "c3Ryb2tlcw==", "valid base paint was not restored");
  });
  test("base paint v2 restores an authored UV island layout", () => {
    const paint = parseModelBasePaintText(JSON.stringify({ version: 2, detail: 64, program: "c3Ryb2tlcw==", layout: [0, 0, 12, 9, 14, 0, 8, 9] }));
    assert(paint?.version === 2 && paint.layout?.join(",") === "0,0,12,9,14,0,8,9", "authored UV layout was not restored");
  });
  test("base paint v3 restores a raster baseline with an optional stroke recipe", () => {
    const paint = parseModelBasePaintText(JSON.stringify({ version: 3, detail: 64, program: "", rasterBase: true, layout: [0, 0, 12, 9] }));
    assert(paint?.version === 3 && paint.rasterBase === true && paint.program === "", "raster baseline record was not restored");
  });
  test("base paint refuses empty or unknown records", () => {
    assert(parseModelBasePaintText('{"version":4,"detail":64,"program":"x"}') === null, "unknown version was accepted");
    assert(parseModelBasePaintText('{"version":3,"detail":64,"program":"","layout":[0,0,1,1]}') === null, "v3 without raster marker was accepted");
    assert(parseModelBasePaintText('{"version":2,"detail":64,"program":"x","layout":[0,0,0,1]}') === null, "invalid UV layout was accepted");
    assert(parseModelBasePaintText('{"version":1,"detail":64,"program":""}') === null, "empty program was accepted");
    assert(parseModelBasePaintText("broken") === null, "malformed json was accepted");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed) throw new Error(`${failed} test(s) failed`);
})();
