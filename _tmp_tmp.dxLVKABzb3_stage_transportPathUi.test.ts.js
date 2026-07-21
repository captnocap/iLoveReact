(() => {
  // cart/editor/stage/transportPathUi.ts
  var PATH_KIND_ORDER = ["road", "lightRail", "railway"];
  var PATH_KIND_META = {
    road: {
      label: "Road",
      icon: "Route",
      tooltip: "Road \u2014 lanes, median, sidewalks and junctions compile from the curve",
      defaultCurveRadiusM: 8
    },
    lightRail: {
      label: "Light Rail",
      icon: "TramFront",
      tooltip: "Light rail \u2014 embedded slab track for trams and street-running trains",
      defaultCurveRadiusM: 18
    },
    railway: {
      label: "Railway",
      icon: "TrainTrack",
      tooltip: "Railway \u2014 ballast, sleepers and steel rails with broader validated turns",
      defaultCurveRadiusM: 28
    }
  };
  var PATH_CURVE_TUNING = {
    minM: 0,
    maxM: 96,
    stepM: 1,
    railTracksMin: 1,
    railTracksMax: 2,
    levelMin: -32,
    levelMax: 128,
    metersPerLevel: 3,
    roadLaneWidthM: 3,
    roadMedianWidthM: 1
  };
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }
  function pathKindPatch(kind) {
    return { pathTool: "draw", pathKind: kind, pathCurveRadiusM: PATH_KIND_META[kind].defaultCurveRadiusM };
  }
  function pathLevelLabel(level) {
    const value = Math.round(level);
    if (value === 0) return "Ground";
    return value > 0 ? `Floor ${value}` : `Basement ${Math.abs(value)}`;
  }
  function pathProfileOf(state) {
    return {
      kind: PATH_KIND_ORDER.includes(state.pathKind) ? state.pathKind : "road",
      curveRadiusM: clamp(state.pathCurveRadiusM, PATH_CURVE_TUNING.minM, PATH_CURVE_TUNING.maxM),
      tracks: Math.round(clamp(state.railTracks, PATH_CURVE_TUNING.railTracksMin, PATH_CURVE_TUNING.railTracksMax)),
      lanesF: Math.round(clamp(state.roadLanesF, 0, 3)),
      lanesB: Math.round(clamp(state.roadLanesB, 0, 3)),
      sidewalks: !!state.roadSidewalks
    };
  }
  function roadCarriagewayWidthM(lanesF, lanesB) {
    let forward = Math.round(clamp(lanesF, 0, 3));
    const backward = Math.round(clamp(lanesB, 0, 3));
    if (forward === 0 && backward === 0) forward = 1;
    const median = forward > 0 && backward > 0 ? PATH_CURVE_TUNING.roadMedianWidthM : 0;
    return (forward + backward) * PATH_CURVE_TUNING.roadLaneWidthM + median;
  }
  function pathInvalidLabel(reason, minCurveM, maxGrade = 0) {
    if (reason === "tooFewPoints") return "place one more anchor";
    if (reason === "segmentTooShort") return "segment is shorter than 0.5 m";
    if (reason === "curveTooTight") {
      return minCurveM === null ? "curve is too tight for this rail type" : `curve reaches only ${minCurveM.toFixed(1)} m`;
    }
    if (reason === "gradeTooSteep") return `grade is ${(maxGrade * 100).toFixed(1)}% \u2014 lengthen the slope run`;
    return "";
  }

  // cart/editor/stage/transportPathUi.test.ts
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
  test("path kinds select useful distinct curve defaults", () => {
    assert(pathKindPatch("road").pathCurveRadiusM === 8, "road default drifted");
    assert(pathKindPatch("lightRail").pathCurveRadiusM === 18, "light-rail default drifted");
    assert(pathKindPatch("railway").pathCurveRadiusM === 28, "railway default drifted");
  });
  test("the chrome boundary clamps every value before crossing to Zig", () => {
    const profile = pathProfileOf({
      pathTool: "draw",
      pathLevel: 0,
      pathKind: "railway",
      pathCurveRadiusM: 999,
      railTracks: 7,
      roadLanesF: -4,
      roadLanesB: 9,
      roadSidewalks: true
    });
    assert(profile.curveRadiusM === PATH_CURVE_TUNING.maxM, "curve escaped the host range");
    assert(profile.tracks === 2, "track count escaped the authored vocabulary");
    assert(profile.lanesF === 0 && profile.lanesB === 3, "road fields were not normalized");
  });
  test("signed track levels use the building storey vocabulary", () => {
    assert(pathLevelLabel(0) === "Ground", "ground label drifted");
    assert(pathLevelLabel(2) === "Floor 2", "raised-storey label drifted");
    assert(pathLevelLabel(-3) === "Basement 3", "subway-storey label drifted");
  });
  test("road width exposes the ruled three-metre lanes and one-metre two-way divider", () => {
    assert(roadCarriagewayWidthM(1, 1) === 7, "one lane each way is not the minimum 7 m carriageway");
    assert(roadCarriagewayWidthM(2, 1) === 10, "multi-lane width lost its 3 m module");
    assert(roadCarriagewayWidthM(2, 0) === 6, "one-way width incorrectly gained a median");
  });
  test("rail validation errors are phrased as an actionable edit", () => {
    assert(pathInvalidLabel("curveTooTight", 4.25).includes("4.3 m"), "minimum curve was not surfaced");
    assert(pathInvalidLabel("tooFewPoints", null).includes("anchor"), "missing-point guidance disappeared");
    assert(pathInvalidLabel("gradeTooSteep", null, 0.117).includes("11.7%"), "grade guidance disappeared");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
