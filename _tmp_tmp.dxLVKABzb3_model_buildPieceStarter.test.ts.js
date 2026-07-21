(() => {
  // runtime/host-globals.ts
  var G = globalThis;

  // runtime/ffi.ts
  var host = G;
  function hasHost(name) {
    return typeof host[name] === "function";
  }
  function callHost(name, fallback, ...args) {
    const fn = host[name];
    if (typeof fn !== "function") return fallback;
    try {
      return fn(...args);
    } catch {
      return fallback;
    }
  }
  function callHostJson(name, fallback, ...args) {
    const raw = callHost(name, null, ...args);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  var _listeners = /* @__PURE__ */ new Map();
  var _wildcardListeners = /* @__PURE__ */ new Set();
  function dispatchListeners(channel, payload) {
    const set = _listeners.get(channel);
    if (set && set.size > 0) {
      for (const fn of Array.from(set)) {
        try {
          fn(payload);
        } catch (e) {
          console.error(`[ffi] ${channel} listener error:`, e?.message || e);
        }
      }
    }
    if (_wildcardListeners.size > 0) {
      for (const fn of Array.from(_wildcardListeners)) {
        try {
          fn(channel, payload);
        } catch (e) {
          console.error(`[ffi] wildcard listener error on ${channel}:`, e?.message || e);
        }
      }
    }
  }
  G.__ffiEmit = (channel, payload) => {
    setTimeout(() => dispatchListeners(channel, payload), 0);
  };

  // cart/editor/world/buildCatalog.ts
  var EDIT_BY_ID = {
    "wall.concrete.doorway": "door",
    "wall.concrete.openDoorway": "arch",
    "wall.metal.garageDoor": "garageDoor",
    "wall.stucco.window": "window",
    "wall.stucco.doubleWindow": "doubleWindow",
    "wall.plywood.brokenWindow": "brokenWindow"
  };
  var MATERIAL_LOOK = {
    concrete: { hex: "#9aa3ad" },
    brick: { hex: "#8a4a3a" },
    stucco: { hex: "#d8cdb8" },
    wood: { hex: "#8a6a45" },
    metal: { hex: "#7d858d" },
    glass: { hex: "#cfe6f2", opacity: 0.3 },
    chainlink: { hex: "#b9c2c9", opacity: 0.45 }
  };
  function rgbOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  var W = [3, 3, 5e-3];
  var P = [3, 0.2, 3];
  var F = [3, 0.05, 3];
  var V = [3, 3, 3];
  var RAW = [
    ["wall.concrete.common", "Concrete Wall", "concrete", "common", ...W],
    ["wall.brick.downtown", "Brick Wall", "brick", "downtown", ...W],
    ["wall.stucco.suburb", "Stucco Wall", "stucco", "suburb", ...W],
    ["wall.stucco.motel", "Motel Wall", "stucco", "motel", ...W],
    ["wall.metal.industrial", "Sheet-Metal Wall", "metal", "industrial", ...W],
    ["wall.plywood.trap_lot", "Plywood Wall", "wood", "trap_lot", ...W],
    ["wall.storefront.downtown", "Storefront Glass", "glass", "downtown", ...W],
    ["wall.concrete.doorway", "Doorway Wall", "concrete", "common", ...W],
    ["wall.concrete.openDoorway", "Open Doorway Wall", "concrete", "common", ...W],
    ["wall.metal.garageDoor", "Garage Door Wall", "metal", "industrial", ...W],
    ["wall.stucco.window", "Window Wall", "stucco", "suburb", ...W],
    ["wall.stucco.doubleWindow", "Double Window Wall", "stucco", "suburb", ...W],
    ["wall.plywood.brokenWindow", "Broken Window Wall", "wood", "trap_lot", ...W],
    ["floor.concrete.common", "Concrete Floor", "concrete", "common", ...F],
    ["floor.wood.suburb", "Wood Floor", "wood", "suburb", ...F],
    ["roof.flat.common", "Flat Roof", "concrete", "common", ...P],
    ["roof.gable.suburb", "Gable Roof", "wood", "suburb", ...P],
    ["roof.gableSteep.suburb", "Gable Roof (Steep)", "wood", "suburb", ...P],
    ["roof.shed.common", "Shed Roof", "metal", "common", ...P],
    ["roof.shedSteep.common", "Shed Roof (Steep)", "metal", "common", ...P],
    ["roof.shingle.suburb", "Shingle Roof", "wood", "suburb", ...P],
    ["ramp.concrete.common", "Concrete Ramp", "concrete", "common", ...V],
    ["stairs.wood.common", "Wood Stairs", "wood", "common", ...V],
    ["stairs.concrete.common", "Concrete Stairs", "concrete", "common", ...V],
    ["stairs.metal.industrial", "Metal Utility Stairs", "metal", "industrial", ...V],
    ["stairs.wood.narrow", "Narrow Wood Stairs", "wood", "common", 1.2, 3, 3],
    ["elevator.metal.common", "Elevator", "metal", "common", ...V],
    ["pillar.concrete.common", "Concrete Pillar", "concrete", "common", 0.6, 3, 0.6],
    ["corner.concrete.common", "Concrete Corner", "concrete", "common", ...V],
    ["arch.concrete.downtown", "Concrete Arch", "concrete", "downtown", ...W],
    ["fence.chainlink.trap_lot", "Chainlink Fence", "chainlink", "trap_lot", 3, 2, 0.05],
    ["fence.wood.suburb", "Wood Fence", "wood", "suburb", 3, 1.8, 0.08],
    ["railing.metal.motel", "Walkway Railing", "metal", "motel", 3, 1, 0.08],
    ["trim.cornice.downtown", "Cornice Trim", "concrete", "downtown", 3, 0.3, 0.3],
    ["sign.shop.downtown", "Shop Sign", "metal", "downtown", 2.4, 0.8, 0.2],
    ["sign.pole.common", "Pole Sign", "metal", "common", 0.24, 3.3, 0.24]
  ];
  function rowFromRaw([id, label, material, theme, w, h, d]) {
    const look = MATERIAL_LOOK[material];
    return { id, label, kind: id.split(".")[0], material, theme, w, h, d, rgb: rgbOf(look.hex), opacity: look.opacity, edit: EDIT_BY_ID[id] };
  }
  var FALLBACK_CATALOG = RAW.map(rowFromRaw);
  var hostCache;
  function hostCatalogRows() {
    if (hostCache !== void 0) return hostCache;
    if (!hasHost("__game_build_catalog_rows")) {
      hostCache = null;
      return null;
    }
    const raw = callHostJson("__game_build_catalog_rows", []);
    hostCache = raw.length ? raw.map((r) => ({
      id: r.id,
      label: r.label,
      kind: r.kind,
      material: r.material,
      theme: r.theme,
      w: r.w,
      h: r.h,
      d: r.d,
      rgb: [r.r, r.g, r.b],
      opacity: r.opacity < 1 ? r.opacity : void 0,
      edit: r.edit || EDIT_BY_ID[r.id]
    })) : null;
    return hostCache;
  }
  var ROW_BY_ID = new Map(FALLBACK_CATALOG.map((r) => [r.id, r]));
  function catalogRowFor(pieceId) {
    const live = hostCatalogRows();
    if (live) {
      const hit = live.find((r) => r.id === pieceId);
      if (hit) return hit;
    }
    return ROW_BY_ID.get(pieceId) ?? null;
  }
  var KIND_ORDER = ["wall", "floor", "roof", "ramp", "stairs", "elevator", "pillar", "corner", "arch", "fence", "railing", "trim", "sign"];
  var KIND_LABEL = {
    wall: "Wall",
    floor: "Floor",
    roof: "Roof",
    ramp: "Ramp",
    stairs: "Stairs",
    elevator: "Elevator",
    pillar: "Pillar",
    corner: "Corner",
    arch: "Arch",
    fence: "Fence",
    railing: "Railing",
    trim: "Trim",
    sign: "Sign"
  };
  function rowHex(row) {
    const to = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0");
    return `#${to(row.rgb[0])}${to(row.rgb[1])}${to(row.rgb[2])}`;
  }

  // cart/editor/data/buildStarters.ts
  var STARTER_CATALOG_ROW = {
    wall: "wall.concrete.common",
    floor: "floor.concrete.common",
    roof: "roof.flat.common",
    ramp: "ramp.concrete.common",
    stairs: "stairs.concrete.common",
    elevator: "elevator.metal.common",
    pillar: "pillar.concrete.common",
    corner: "corner.concrete.common",
    arch: "arch.concrete.downtown",
    fence: "fence.wood.suburb",
    railing: "railing.metal.motel",
    trim: "trim.cornice.downtown",
    sign: "sign.shop.downtown"
  };
  var STARTER_ICON = {
    wall: "BrickWall",
    floor: "Layers",
    roof: "House",
    ramp: "MoveUpRight",
    stairs: "ChartNoAxesColumnIncreasing",
    elevator: "BetweenHorizontalStart",
    pillar: "Columns",
    corner: "PanelsTopLeft",
    arch: "DoorOpen",
    fence: "Fence",
    railing: "GalleryHorizontalEnd",
    trim: "RectangleHorizontal",
    sign: "Signpost"
  };
  var STARTER_NAME = {
    stairs: "Stair Piece"
  };
  var BASE_STARTERS = KIND_ORDER.map((kind) => ({
    id: kind,
    kind,
    name: STARTER_NAME[kind] ?? `${KIND_LABEL[kind]} Piece`,
    icon: STARTER_ICON[kind],
    catalogPieceId: STARTER_CATALOG_ROW[kind]
  }));
  var WALL_EDIT_STARTERS = [
    {
      id: "door-wall",
      kind: "wall",
      edit: "door",
      name: "Door Wall",
      icon: "DoorOpen",
      catalogPieceId: "wall.concrete.doorway"
    },
    {
      id: "garage-door-wall",
      kind: "wall",
      edit: "garageDoor",
      name: "Garage Door Wall",
      icon: "Warehouse",
      catalogPieceId: "wall.metal.garageDoor"
    }
  ];
  var BUILD_PIECE_STARTERS = BASE_STARTERS.flatMap((starter) => starter.kind === "wall" ? [starter, ...WALL_EDIT_STARTERS] : [starter]);
  var STARTER_BY_ID = new Map(BUILD_PIECE_STARTERS.map((starter) => [starter.id, starter]));
  function buildPieceStarter(id) {
    return STARTER_BY_ID.get(id) ?? null;
  }

  // cart/editor/world/pieceShapes.ts
  var DEG = Math.PI / 180;
  var UI = {
    faceSlabThicknessMeters: 0.02,
    faceSlabLiftMeters: 0.012,
    editCutoutWidthMeters: 1.2,
    doubleWindowCutoutWidthMeters: 2.2,
    editCutoutHeightMeters: 1.2,
    // Floor-standing doorway openings (door/garage/arch) — reach the floor, so
    // their rect starts at the wall base and has no sill, unlike the mid-wall
    // window band. Width/height differ; the cutout mechanism is identical.
    doorOpeningWidthMeters: 1,
    doorOpeningHeightMeters: 2.1,
    archOpeningWidthMeters: 1.4,
    garageOpeningWidthMeters: 2.6,
    garageOpeningHeightMeters: 2.4,
    windowPaneDepthMeters: 0.04,
    windowPaneColor: "#bcd3dd",
    windowPaneOpacity: 0.3,
    rampSlabThicknessMeters: 0.2,
    stairVisualSteps: 5,
    elevatorWallThicknessMeters: 0.12,
    elevatorPostSizeMeters: 0.24,
    elevatorHeaderHeightMeters: 0.4
  };
  var DOOR_PANEL_COLOR = "#0c1018";
  function localOffset(u, v, yawDegrees) {
    const cos = Math.cos(yawDegrees * DEG);
    const sin = Math.sin(yawDegrees * DEG);
    return { dx: u * cos + v * sin, dz: -u * sin + v * cos };
  }
  function quarterTurns(yawDegrees) {
    const yaw = (yawDegrees % 360 + 360) % 360;
    const quarter = Math.round(yaw / 90) % 4;
    return Math.abs(yaw - quarter * 90) < 1e-6 || Math.abs(yaw - 360) < 1e-6 ? quarter : null;
  }
  function openingFor(edit, baseY, wallH) {
    if (!edit) return null;
    switch (edit) {
      // Window family: a mid-wall band (sill below, header above). A glass pane
      // fills it; a broken window is the same cut with the glass gone.
      case "window":
      case "doubleWindow":
      case "brokenWindow": {
        const width = edit === "doubleWindow" ? UI.doubleWindowCutoutWidthMeters : UI.editCutoutWidthMeters;
        const h = UI.editCutoutHeightMeters;
        const bottom = baseY + wallH * 0.55 - h / 2;
        return { width, bottom, top: bottom + h, fill: edit === "brokenWindow" ? "none" : "pane" };
      }
      // Doorway family: a floor-standing opening (no sill). A door/garage fills it
      // with a leaf; an (open) arch is the same cut left open — the case the old
      // code missed, rendering it as a full wall.
      case "door":
      case "garageDoor":
      case "arch": {
        const width = edit === "garageDoor" ? UI.garageOpeningWidthMeters : edit === "arch" ? UI.archOpeningWidthMeters : UI.doorOpeningWidthMeters;
        const height = edit === "garageDoor" ? UI.garageOpeningHeightMeters : UI.doorOpeningHeightMeters;
        return { width, bottom: baseY, top: baseY + Math.min(height, wallH), fill: edit === "arch" ? "none" : "leaf" };
      }
    }
  }
  function roofProfile(pieceId) {
    const seg = pieceId.split(".")[1] ?? "flat";
    const steep = seg.includes("Steep");
    const pitch = steep ? 1 : 0.5;
    if (seg.startsWith("shed")) return { shape: "shed", rise: pitch * 3 };
    if (seg.startsWith("gable") || seg === "shingle") return { shape: "gable", rise: pitch * 1.5 };
    return { shape: "flat", rise: 0 };
  }
  function pieceVisualShapes(piece, color) {
    const def2 = catalogRowFor(piece.pieceId);
    if (!def2) return [];
    const yaw = piece.yawDegrees;
    const size = { w: def2.w, h: def2.h, d: def2.d };
    const depthSize = size.d;
    const depthCenter = 0;
    const faceColor = color;
    const box = (k, u, v, baseY, w, h, d, slot, col = faceColor, opacity) => {
      const { dx, dz } = localOffset(u, v, yaw);
      return { kind: "box", box: { key: `${piece.id}.${k}`, cx: piece.x + dx, cy: baseY + h / 2, cz: piece.z + dz, sx: w, sy: h, sz: d, yawDegrees: yaw, color: col, opacity, slot } };
    };
    if (def2.kind === "ramp") {
      return [{ kind: "ramp", ramp: { key: `${piece.id}.slope`, x: piece.x, y: piece.y, z: piece.z, width: size.w, height: size.h, depth: size.d, slabThickness: UI.rampSlabThicknessMeters, yawDegrees: yaw, color: faceColor, slot: "top" } }];
    }
    if (def2.kind === "stairs") {
      const boxes = [];
      const steps = UI.stairVisualSteps;
      for (let i = 0; i < steps; i += 1) {
        const v = -size.d / 2 + (i + 0.5) / steps * size.d;
        const h = (i + 1) / steps * size.h;
        boxes.push(box(`s${i}`, 0, v, piece.y, size.w, h, size.d / steps, "top"));
      }
      return boxes;
    }
    if (def2.kind === "elevator") {
      const halfW = size.w / 2;
      const halfD = size.d / 2;
      const wall = UI.elevatorWallThicknessMeters;
      const post = UI.elevatorPostSizeMeters;
      const h = size.h;
      const shapes = [
        box("left", -halfW + wall / 2, 0, piece.y, wall, h, size.d - post * 2, "sides"),
        box("right", halfW - wall / 2, 0, piece.y, wall, h, size.d - post * 2, "sides"),
        box("back", 0, halfD - wall / 2, piece.y, size.w - post * 2, h, wall, "back"),
        box("header", 0, -halfD + wall / 2, piece.y + h - UI.elevatorHeaderHeightMeters, size.w - post * 2, UI.elevatorHeaderHeightMeters, wall, "front")
      ];
      for (const [pu, pv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        shapes.push(box(`post${pu}${pv}`, pu * (halfW - post / 2), pv * (halfD - post / 2), piece.y, post, h, post, "front"));
      }
      return shapes;
    }
    if (def2.kind === "wall" || def2.kind === "arch" || def2.kind === "fence" || def2.kind === "railing") {
      const shapes = [];
      const slab = UI.faceSlabThicknessMeters;
      const lift = UI.faceSlabLiftMeters;
      const frontV = depthSize / 2 + lift;
      const backV = -depthSize / 2 - lift;
      const quarter = quarterTurns(yaw);
      const swap = quarter !== null && quarter % 2 === 1;
      const frontSlot = swap ? "back" : "front";
      const backSlot = swap ? "front" : "back";
      const opening = openingFor(def2.kind === "arch" ? "arch" : def2.edit, piece.y, size.h);
      const addWallRun = (label, u0, u1, baseY, h) => {
        const runW = u1 - u0;
        if (runW <= 1e-3 || h <= 1e-3) return;
        const uMid = (u0 + u1) / 2;
        if (depthSize <= slab * 3) {
          const half = depthSize / 2;
          shapes.push(box(`${label}.front`, uMid, depthCenter + half / 2, baseY, runW, h, half, frontSlot));
          shapes.push(box(`${label}.back`, uMid, depthCenter - half / 2, baseY, runW, h, half, backSlot));
        } else {
          shapes.push(box(`${label}.core`, uMid, depthCenter, baseY, runW, h, depthSize, "sides"));
          shapes.push(box(`${label}.front`, uMid, frontV, baseY, runW, h, slab, frontSlot));
          shapes.push(box(`${label}.back`, uMid, backV, baseY, runW, h, slab, backSlot));
        }
      };
      if (!opening) {
        addWallRun("band", -size.w / 2, size.w / 2, piece.y, size.h);
      } else {
        const holeU0 = -opening.width / 2;
        const holeU1 = opening.width / 2;
        addWallRun("leftJamb", -size.w / 2, holeU0, piece.y, size.h);
        addWallRun("rightJamb", holeU1, size.w / 2, piece.y, size.h);
        addWallRun("sill", holeU0, holeU1, piece.y, Math.max(0, opening.bottom - piece.y));
        addWallRun("header", holeU0, holeU1, opening.top, Math.max(0, piece.y + size.h - opening.top));
        const openingH = opening.top - opening.bottom;
        if (opening.fill === "pane") {
          shapes.push(box("glassPane", 0, depthCenter, opening.bottom, opening.width, openingH, UI.windowPaneDepthMeters, "front", UI.windowPaneColor, UI.windowPaneOpacity));
        } else if (opening.fill === "leaf") {
          const leaf = box("door", 0, depthCenter, opening.bottom, opening.width, openingH, depthSize + 0.06, "front", DOOR_PANEL_COLOR);
          if (leaf.kind === "box") leaf.box.door = true;
          shapes.push(leaf);
        }
      }
      return shapes;
    }
    const plate = (w, d, plateH) => {
      const slab = UI.faceSlabThicknessMeters;
      const lift = UI.faceSlabLiftMeters;
      const coreH = Math.max(0.01, plateH - lift);
      return [
        box("edges", 0, 0, piece.y, w, coreH, d, "sides"),
        box("top", 0, 0, piece.y + plateH - slab, w, slab, d, "top"),
        box("bottom", 0, 0, piece.y, w, slab, d, "back")
      ];
    };
    if (def2.kind === "roof") {
      const { shape, rise } = roofProfile(piece.pieceId);
      const W2 = size.w;
      const D = size.d;
      const thick = UI.rampSlabThicknessMeters;
      const rampAt = (k, u, v, w, dep, riseH, ramYaw) => {
        const { dx, dz } = localOffset(u, v, yaw);
        return { kind: "ramp", ramp: { key: `${piece.id}.${k}`, x: piece.x + dx, y: piece.y, z: piece.z + dz, width: w, height: riseH, depth: dep, slabThickness: thick, yawDegrees: ramYaw, color: faceColor, slot: "top" } };
      };
      if ((shape === "shed" || shape === "gable") && rise > 0.01) {
        if (shape === "shed") return [rampAt("slope", 0, 0, W2, D, rise, yaw)];
        const shapes = [
          rampAt("slopeA", 0, -D / 4, W2, D / 2, rise, yaw),
          rampAt("slopeB", 0, D / 4, W2, D / 2, rise, yaw + 180)
        ];
        const endThickness = thick;
        for (const eu of [-1, 1]) {
          shapes.push(box(`gableEnd${eu}`, eu * (W2 / 2 - endThickness / 2), 0, piece.y, endThickness, rise, D, "sides"));
        }
        return shapes;
      }
      return plate(W2, D, size.h);
    }
    if (def2.kind === "floor") {
      return plate(size.w, size.d, size.h);
    }
    return [box("body", 0, 0, piece.y, size.w, size.h, size.d, "front")];
  }

  // runtime/geometries/_util.ts
  function normalize(x, y, z) {
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len < 1e-6) return [0, 0, 0];
    return [x / len, y / len, z / len];
  }
  var Mesh = class {
    v = [];
    maxR2 = 0;
    /** Push one vertex (position, normal, uv). */
    vert(p, n, uv2) {
      this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], uv2[0], uv2[1]);
      const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
      if (r2 > this.maxR2) this.maxR2 = r2;
    }
    /** A triangle with per-corner normals + UVs (mirrors Zig addTri). */
    tri(a, na, ua, b, nb, ub, c, nc, uc) {
      this.vert(a, na, ua);
      this.vert(b, nb, ub);
      this.vert(c, nc, uc);
    }
    /** Flat-shaded triangle: one normal, default UVs (mirrors Zig addTriFlat). */
    triFlat(a, b, c, n) {
      this.tri(a, n, [0, 0], b, n, [1, 0], c, n, [1, 1]);
    }
    /**
     * A quad as two triangles with a single face normal. Mirrors Zig addFace
     * exactly: corners run world bottom→top (BL,BR,TR,TL), V is flipped so a
     * texture stays upright on the face, winding is [0,1,2, 0,2,3].
     *
     * `pinUv` collapses all four corner UVs to a single texel so the face samples
     * one flat color instead of stretching the whole texture across it — the
     * "this face isn't textured" path (e.g. the thin edge of a sign). Omit it for
     * the normal upright 0..1 mapping.
     */
    face(v1, v2, v3, v4, n, pinUv) {
      const corners = [v1, v2, v3, v4];
      const uvs = pinUv ? [pinUv, pinUv, pinUv, pinUv] : [[0, 1], [1, 1], [1, 0], [0, 0]];
      const order = [0, 1, 2, 0, 2, 3];
      for (const ti of order) this.vert(corners[ti], n, uvs[ti]);
    }
    build() {
      return {
        positions: new Float32Array(this.v),
        count: this.v.length / 8,
        bounds: { radius: Math.sqrt(this.maxR2) }
      };
    }
  };
  function mesh() {
    return new Mesh();
  }

  // runtime/geometries/Box.ts
  var BOX_DEFAULTS = { width: 1, height: 1, depth: 1 };
  var PIN = [0, 0];
  function generate(p) {
    const hx = p.width * 0.5;
    const hy = p.height * 0.5;
    const hz = p.depth * 0.5;
    const faces = p.texturedFaces;
    const pin = (face) => faces && !faces.includes(face) ? PIN : void 0;
    const g = mesh();
    g.face([-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1], pin("front"));
    g.face([hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [0, 0, -1], pin("back"));
    g.face([hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [1, 0, 0], pin("right"));
    g.face([-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-1, 0, 0], pin("left"));
    g.face([-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 1, 0], pin("top"));
    g.face([-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0], pin("bottom"));
    return g.build();
  }

  // runtime/geometries/Sphere.ts
  var SPHERE_DEFAULTS = { radius: 0.5, segments: 24, rings: 16 };
  var PI = Math.PI;
  function pos(r, theta, phi) {
    const st = Math.sin(theta);
    return [r * st * Math.cos(phi), r * Math.cos(theta), r * st * Math.sin(phi)];
  }
  function nrm(theta, phi) {
    const st = Math.sin(theta);
    return [st * Math.cos(phi), Math.cos(theta), st * Math.sin(phi)];
  }
  function uv(n) {
    return [(n[0] + 1) * 0.5, (1 - n[1]) * 0.5];
  }
  function generate2(p) {
    const g = mesh();
    const { radius: r, segments, rings } = p;
    for (let i = 0; i < rings; i++) {
      const t1 = PI * i / rings;
      const t2 = PI * (i + 1) / rings;
      for (let j = 0; j < segments; j++) {
        const p1 = 2 * PI * j / segments;
        const p2 = 2 * PI * (j + 1) / segments;
        const a = pos(r, t1, p1), b = pos(r, t1, p2), c = pos(r, t2, p2), d = pos(r, t2, p1);
        const na = nrm(t1, p1), nb = nrm(t1, p2), nc = nrm(t2, p2), nd = nrm(t2, p1);
        g.tri(a, na, uv(na), c, nc, uv(nc), d, nd, uv(nd));
        g.tri(a, na, uv(na), b, nb, uv(nb), c, nc, uv(nc));
      }
    }
    return g.build();
  }

  // runtime/geometries/Head.ts
  var HEAD_DEFAULTS = { radius: 0.5, segments: 24, rings: 16 };
  var PI2 = Math.PI;
  function pos2(r, theta, phi) {
    const st = Math.sin(theta);
    return [r * st * Math.cos(phi), r * Math.cos(theta), r * st * Math.sin(phi)];
  }
  function nrm2(theta, phi) {
    const st = Math.sin(theta);
    return [st * Math.cos(phi), Math.cos(theta), st * Math.sin(phi)];
  }
  function uvDecal(n) {
    let x = -n[0];
    let y = n[1];
    if (n[2] > 0) {
      const len = Math.hypot(x, y);
      if (len < 1e-6) {
        x = 0;
        y = 1;
      } else {
        x /= len;
        y /= len;
      }
    }
    return [(x + 1) * 0.5, (1 - y) * 0.5];
  }
  function generate3(p) {
    const g = mesh();
    const { radius: r, segments, rings } = p;
    for (let i = 0; i < rings; i++) {
      const t1 = PI2 * i / rings;
      const t2 = PI2 * (i + 1) / rings;
      for (let j = 0; j < segments; j++) {
        const p1 = 2 * PI2 * j / segments;
        const p2 = 2 * PI2 * (j + 1) / segments;
        const a = pos2(r, t1, p1), b = pos2(r, t1, p2), c = pos2(r, t2, p2), d = pos2(r, t2, p1);
        const na = nrm2(t1, p1), nb = nrm2(t1, p2), nc = nrm2(t2, p2), nd = nrm2(t2, p1);
        g.tri(a, na, uvDecal(na), c, nc, uvDecal(nc), d, nd, uvDecal(nd));
        g.tri(a, na, uvDecal(na), b, nb, uvDecal(nb), c, nc, uvDecal(nc));
      }
    }
    return g.build();
  }

  // runtime/geometries/Carve.ts
  var CARVE_DEFAULTS = {
    mask: [1],
    cols: 1,
    rows: 1,
    width: 1,
    height: 1,
    depth: 0.25,
    inflate: 0.6
  };
  function generate4(p) {
    const { cols, rows, width, height, depth, inflate } = p;
    const g = mesh();
    const cellW = width / cols;
    const cellH = height / rows;
    const INF = 1e9;
    const solid = (cx, cy) => cx >= 0 && cy >= 0 && cx < cols && cy < rows && p.mask[cy * cols + cx] > 0.5;
    const dist = new Float64Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) dist[i] = p.mask[i] > 0.5 ? INF : 0;
    const dAt = (cx, cy) => cx < 0 || cy < 0 || cx >= cols || cy >= rows ? 0 : dist[cy * cols + cx];
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        if (dist[i] === 0) continue;
        dist[i] = Math.min(dist[i], dAt(cx - 1, cy) + 1, dAt(cx, cy - 1) + 1, dAt(cx - 1, cy - 1) + 1.4, dAt(cx + 1, cy - 1) + 1.4);
      }
    }
    for (let cy = rows - 1; cy >= 0; cy--) {
      for (let cx = cols - 1; cx >= 0; cx--) {
        const i = cy * cols + cx;
        dist[i] = Math.min(dist[i], dAt(cx + 1, cy) + 1, dAt(cx, cy + 1) + 1, dAt(cx + 1, cy + 1) + 1.4, dAt(cx - 1, cy + 1) + 1.4);
      }
    }
    let dmax = 1;
    for (let i = 0; i < cols * rows; i++) {
      if (dist[i] < INF && dist[i] > dmax) dmax = dist[i];
    }
    const cw = cols + 1;
    const half = new Float64Array(cw * (rows + 1));
    for (let cy = 0; cy <= rows; cy++) {
      for (let cx = 0; cx <= cols; cx++) {
        const d = Math.min(dAt(cx - 1, cy - 1), dAt(cx, cy - 1), dAt(cx - 1, cy), dAt(cx, cy));
        const rounded = Math.sqrt(Math.min(d, dmax) / dmax);
        half[cy * cw + cx] = 0.5 * depth * (1 - inflate + inflate * rounded);
      }
    }
    const hAt = (cx, cy) => half[cy * cw + cx];
    const lateral = (cx, cy) => {
      const x0 = Math.max(0, cx - 1), x1 = Math.min(cols, cx + 1);
      const y0 = Math.max(0, cy - 1), y1 = Math.min(rows, cy + 1);
      const dhdx = (hAt(x1, cy) - hAt(x0, cy)) / ((x1 - x0) * cellW);
      const dhdy = (hAt(cx, y1) - hAt(cx, y0)) / ((y1 - y0) * -cellH);
      return [-dhdx, -dhdy];
    };
    const frontN = (cx, cy) => {
      const [lx, ly] = lateral(cx, cy);
      return normalize(lx, ly, -1);
    };
    const backN = (cx, cy) => {
      const [lx, ly] = lateral(cx, cy);
      return normalize(lx, ly, 1);
    };
    const X = (cx) => -width / 2 + cx * cellW;
    const Y = (cy) => height / 2 - cy * cellH;
    const U = (cx) => 1 - cx / cols;
    const V2 = (cy) => cy / rows;
    const uv2 = (cx, cy) => [U(cx), V2(cy)];
    const EPS = 1e-5;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (!solid(cx, cy)) continue;
        const x0 = X(cx), x1 = X(cx + 1);
        const yt = Y(cy), yb = Y(cy + 1);
        const h00 = hAt(cx, cy), h10 = hAt(cx + 1, cy);
        const h01 = hAt(cx, cy + 1), h11 = hAt(cx + 1, cy + 1);
        g.tri(
          [x1, yb, -h11],
          frontN(cx + 1, cy + 1),
          uv2(cx + 1, cy + 1),
          [x0, yb, -h01],
          frontN(cx, cy + 1),
          uv2(cx, cy + 1),
          [x0, yt, -h00],
          frontN(cx, cy),
          uv2(cx, cy)
        );
        g.tri(
          [x1, yb, -h11],
          frontN(cx + 1, cy + 1),
          uv2(cx + 1, cy + 1),
          [x0, yt, -h00],
          frontN(cx, cy),
          uv2(cx, cy),
          [x1, yt, -h10],
          frontN(cx + 1, cy),
          uv2(cx + 1, cy)
        );
        g.tri(
          [x0, yb, h01],
          backN(cx, cy + 1),
          uv2(cx, cy + 1),
          [x1, yb, h11],
          backN(cx + 1, cy + 1),
          uv2(cx + 1, cy + 1),
          [x1, yt, h10],
          backN(cx + 1, cy),
          uv2(cx + 1, cy)
        );
        g.tri(
          [x0, yb, h01],
          backN(cx, cy + 1),
          uv2(cx, cy + 1),
          [x1, yt, h10],
          backN(cx + 1, cy),
          uv2(cx + 1, cy),
          [x0, yt, h00],
          backN(cx, cy),
          uv2(cx, cy)
        );
        const pin = [1 - (cx + 0.5) / cols, (cy + 0.5) / rows];
        if (!solid(cx + 1, cy) && h10 + h11 > EPS) {
          g.face([x1, yb, h11], [x1, yb, -h11], [x1, yt, -h10], [x1, yt, h10], [1, 0, 0], pin);
        }
        if (!solid(cx - 1, cy) && h00 + h01 > EPS) {
          g.face([x0, yb, -h01], [x0, yb, h01], [x0, yt, h00], [x0, yt, -h00], [-1, 0, 0], pin);
        }
        if (!solid(cx, cy - 1) && h00 + h10 > EPS) {
          g.face([x0, yt, h00], [x1, yt, h10], [x1, yt, -h10], [x0, yt, -h00], [0, 1, 0], pin);
        }
        if (!solid(cx, cy + 1) && h01 + h11 > EPS) {
          g.face([x0, yb, -h01], [x1, yb, -h11], [x1, yb, h11], [x0, yb, h01], [0, -1, 0], pin);
        }
      }
    }
    return g.build();
  }

  // runtime/geometries/Globe.ts
  var GLOBE_DEFAULTS = { radius: 0.5, segments: 32, rings: 16, amount: 0, scaleY: 1 };
  var PI3 = Math.PI;
  function globeSurface(p) {
    const { radius } = p;
    const amount = p.amount ?? 0;
    const scaleY = p.scaleY ?? 1;
    const scaleX = p.scaleX ?? 1;
    const scaleZ = p.scaleZ ?? 1;
    const grid = p.displace;
    const dCols = p.dCols ?? 0;
    const dRows = p.dRows ?? 0;
    const hasGrid = !!grid && dCols > 1 && dRows > 1 && amount !== 0;
    const prof = p.profile && p.profile.length > 0 ? p.profile : null;
    const profileAt = (v) => {
      if (!prof) return 1;
      if (prof.length === 1) return prof[0];
      const t = Math.max(0, Math.min(1, v)) * (prof.length - 1);
      const i = Math.min(prof.length - 2, Math.floor(t));
      return prof[i] + (prof[i + 1] - prof[i]) * (t - i);
    };
    let topAvg = 0;
    let botAvg = 0;
    if (hasGrid) {
      for (let x = 0; x < dCols; x++) {
        topAvg += grid[x];
        botAvg += grid[(dRows - 1) * dCols + x];
      }
      topAvg /= dCols;
      botAvg /= dCols;
    }
    const sample = (u, v) => {
      if (!hasGrid) return 0;
      if (v <= 0) return topAvg;
      if (v >= 1) return botAvg;
      const fx = u * dCols - 0.5;
      const fy = v * dRows - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.max(0, Math.min(dRows - 1, Math.floor(fy)));
      const y1 = Math.max(0, Math.min(dRows - 1, y0 + 1));
      const tx = fx - x0;
      const ty = fy - y0;
      const xa = (x0 % dCols + dCols) % dCols;
      const xb = (xa + 1) % dCols;
      const d00 = grid[y0 * dCols + xa], d10 = grid[y0 * dCols + xb];
      const d01 = grid[y1 * dCols + xa], d11 = grid[y1 * dCols + xb];
      return (d00 * (1 - tx) + d10 * tx) * (1 - ty) + (d01 * (1 - tx) + d11 * tx) * ty;
    };
    const shz = p.shiftZ && p.shiftZ.length > 0 ? p.shiftZ : null;
    const shiftAt = (v) => {
      if (!shz) return 0;
      if (shz.length === 1) return shz[0];
      const t = Math.max(0, Math.min(1, v)) * (shz.length - 1);
      const i = Math.min(shz.length - 2, Math.floor(t));
      return shz[i] + (shz[i + 1] - shz[i]) * (t - i);
    };
    const floorCut = p.floorY != null && p.floorY < 1 ? -radius * scaleY * p.floorY : -Infinity;
    const base = (u, v) => {
      const theta = PI3 * v;
      const phi = PI3 / 2 - 2 * PI3 * u;
      const st = Math.sin(theta);
      const rxz = radius * profileAt(v);
      const y = Math.max(floorCut, Math.cos(theta) * radius * scaleY);
      return [
        st * Math.cos(phi) * rxz * scaleX,
        y,
        (st * Math.sin(phi) * rxz + radius * shiftAt(v)) * scaleZ
      ];
    };
    const NEPS = 1e-3;
    const baseNormal = (u, v) => {
      if (v <= NEPS) return [0, 1, 0];
      if (v >= 1 - NEPS) return [0, -1, 0];
      const pu0 = base(u - NEPS, v), pu1 = base(u + NEPS, v);
      const pv0 = base(u, v - NEPS), pv1 = base(u, v + NEPS);
      const tu = [pu1[0] - pu0[0], pu1[1] - pu0[1], pu1[2] - pu0[2]];
      const tv = [pv1[0] - pv0[0], pv1[1] - pv0[1], pv1[2] - pv0[2]];
      return normalize(
        tv[1] * tu[2] - tv[2] * tu[1],
        tv[2] * tu[0] - tv[0] * tu[2],
        tv[0] * tu[1] - tv[1] * tu[0]
      );
    };
    return (u, v, extraDisplace = 0) => {
      const b = base(u, v);
      const d = amount * (sample(u, v) + extraDisplace);
      if (d === 0) return b;
      const n = baseNormal(u, v);
      return [b[0] + n[0] * d, b[1] + n[1] * d, b[2] + n[2] * d];
    };
  }
  function generate5(p) {
    const { segments, rings } = p;
    const surf = globeSurface(p);
    const pos4 = (i, j) => surf(j / segments, i / rings);
    const nrm4 = (i, j) => {
      if (i <= 0) return [0, 1, 0];
      if (i >= rings) return [0, -1, 0];
      const pu0 = pos4(i, j - 1), pu1 = pos4(i, j + 1);
      const pv0 = pos4(i - 1, j), pv1 = pos4(i + 1, j);
      const tu = [pu1[0] - pu0[0], pu1[1] - pu0[1], pu1[2] - pu0[2]];
      const tv = [pv1[0] - pv0[0], pv1[1] - pv0[1], pv1[2] - pv0[2]];
      return normalize(
        tv[1] * tu[2] - tv[2] * tu[1],
        tv[2] * tu[0] - tv[0] * tu[2],
        tv[0] * tu[1] - tv[1] * tu[0]
      );
    };
    const g = mesh();
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segments; j++) {
        const a = pos4(i, j), na = nrm4(i, j);
        const b = pos4(i, j + 1), nb = nrm4(i, j + 1);
        const c = pos4(i + 1, j + 1), nc = nrm4(i + 1, j + 1);
        const d = pos4(i + 1, j), nd = nrm4(i + 1, j);
        const ua = [j / segments, i / rings];
        const ub = [(j + 1) / segments, i / rings];
        const uc = [(j + 1) / segments, (i + 1) / rings];
        const ud = [j / segments, (i + 1) / rings];
        g.tri(a, na, ua, d, nd, ud, c, nc, uc);
        g.tri(a, na, ua, c, nc, uc, b, nb, ub);
      }
    }
    return g.build();
  }

  // runtime/geometries/Plane.ts
  var PLANE_DEFAULTS = { width: 1, depth: 1 };
  function generate6(p) {
    const hx = p.width * 0.5;
    const hz = p.depth * 0.5;
    const g = mesh();
    g.face([-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz], [0, 1, 0]);
    return g.build();
  }

  // runtime/geometries/Cylinder.ts
  var CYLINDER_DEFAULTS = { radius: 0.5, height: 1, segments: 24 };
  var PI4 = Math.PI;
  function generate7(p) {
    const { radius: r, height, segments } = p;
    const hy = height * 0.5;
    const g = mesh();
    for (let j = 0; j < segments; j++) {
      const a1 = 2 * PI4 * j / segments;
      const a2 = 2 * PI4 * (j + 1) / segments;
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const c2 = Math.cos(a2), s2 = Math.sin(a2);
      const a = [r * c1, -hy, r * s1];
      const b = [r * c2, -hy, r * s2];
      const c = [r * c2, hy, r * s2];
      const d = [r * c1, hy, r * s1];
      const n1 = [c1, 0, s1];
      const n2 = [c2, 0, s2];
      g.tri(a, n1, [0, 0], d, n1, [0, 1], c, n2, [1, 1]);
      g.tri(a, n1, [0, 0], c, n2, [1, 1], b, n2, [1, 0]);
      g.triFlat([0, hy, 0], c, d, [0, 1, 0]);
      g.triFlat([0, -hy, 0], a, b, [0, -1, 0]);
    }
    return g.build();
  }

  // runtime/geometries/Cone.ts
  var CONE_DEFAULTS = { radius: 0.5, height: 1, segments: 24 };
  var PI5 = Math.PI;
  function generate8(p) {
    const { radius: r, height, segments } = p;
    const hy = height * 0.5;
    const slope = Math.abs(height) > 1e-3 ? r / height : 1;
    const apex = [0, hy, 0];
    const g = mesh();
    for (let j = 0; j < segments; j++) {
      const a1 = 2 * PI5 * j / segments;
      const a2 = 2 * PI5 * (j + 1) / segments;
      const mid = (a1 + a2) * 0.5;
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const c2 = Math.cos(a2), s2 = Math.sin(a2);
      const a = [r * c1, -hy, r * s1];
      const b = [r * c2, -hy, r * s2];
      const n1 = normalize(c1, slope, s1);
      const n2 = normalize(c2, slope, s2);
      const na = normalize(Math.cos(mid), slope, Math.sin(mid));
      g.tri(a, n1, [0, 0], apex, na, [0.5, 1], b, n2, [1, 0]);
      g.triFlat([0, -hy, 0], a, b, [0, -1, 0]);
    }
    return g.build();
  }

  // runtime/geometries/Torus.ts
  var TORUS_DEFAULTS = { radius: 0.5, tube: 0.25, segments: 24, sides: 16 };
  var PI6 = Math.PI;
  function pos3(r, tr, u, v) {
    const ring = r + tr * Math.cos(v);
    return [ring * Math.cos(u), tr * Math.sin(v), ring * Math.sin(u)];
  }
  function nrm3(u, v) {
    return [Math.cos(u) * Math.cos(v), Math.sin(v), Math.sin(u) * Math.cos(v)];
  }
  function generate9(p) {
    const { radius: r, tube: tr, segments, sides } = p;
    const g = mesh();
    for (let i = 0; i < segments; i++) {
      const u1 = 2 * PI6 * i / segments;
      const u2 = 2 * PI6 * (i + 1) / segments;
      for (let j = 0; j < sides; j++) {
        const v1 = 2 * PI6 * j / sides;
        const v2 = 2 * PI6 * (j + 1) / sides;
        const a = pos3(r, tr, u1, v1), b = pos3(r, tr, u2, v1), c = pos3(r, tr, u2, v2), d = pos3(r, tr, u1, v2);
        const na = nrm3(u1, v1), nb = nrm3(u2, v1), nc = nrm3(u2, v2), nd = nrm3(u1, v2);
        g.tri(a, na, [0, 0], d, nd, [0, 1], c, nc, [1, 1]);
        g.tri(a, na, [0, 0], c, nc, [1, 1], b, nb, [1, 0]);
      }
    }
    return g.build();
  }

  // runtime/geometries/Heightfield.ts
  var WAVE_NONE = { amplitude: 0, length: 0, speed: 0, dirX: 1, dirZ: 0, phase: 0 };
  var HEIGHTFIELD_DEFAULTS = {
    width: 1,
    depth: 1,
    base: 0,
    wave: WAVE_NONE,
    t: 0
  };
  var TAU = Math.PI * 2;
  function waveHeight(w, x, z, t) {
    if (Math.abs(w.amplitude) <= 1e-4 || w.length <= 1e-4) return 0;
    const dlen = Math.sqrt(w.dirX * w.dirX + w.dirZ * w.dirZ);
    const dx = dlen > 1e-4 ? w.dirX / dlen : 1;
    const dz = dlen > 1e-4 ? w.dirZ / dlen : 0;
    const cycles = (x * dx + z * dz) / w.length + w.phase + t * w.speed;
    return Math.sin(cycles * TAU) * w.amplitude;
  }
  function generate10(p) {
    const { cols, rows, width: w, depth: h, base, wave, t } = p;
    const hs = p.heights;
    const g = mesh();
    if (cols < 2 || rows < 2) return g.build();
    if (hs.length !== cols * rows) return g.build();
    const dx = w / (cols - 1);
    const dz = h / (rows - 1);
    const x0 = -w * 0.5;
    const z0 = -h * 0.5;
    const cf = cols - 1;
    const rf = rows - 1;
    const at = (i, j) => {
      const x = x0 + i * dx;
      const z = z0 + j * dz;
      return [x, hs[j * cols + i] + waveHeight(wave, x, z, t), z];
    };
    const drop = (pt) => [pt[0], base, pt[2]];
    const heightAt = (i, j) => {
      const ci = Math.min(Math.max(i, 0), cols - 1);
      const cj = Math.min(Math.max(j, 0), rows - 1);
      const x = x0 + ci * dx;
      const z = z0 + cj * dz;
      return hs[cj * cols + ci] + waveHeight(wave, x, z, t);
    };
    const normalAt = (i, j) => {
      const hl = heightAt(i - 1, j);
      const hr = heightAt(i + 1, j);
      const hu = heightAt(i, j - 1);
      const hd = heightAt(i, j + 1);
      return normalize(-(hr - hl) / (2 * dx), 1, -(hd - hu) / (2 * dz));
    };
    for (let j = 0; j + 1 < rows; j++) {
      for (let i = 0; i + 1 < cols; i++) {
        const pa = at(i, j), pb = at(i + 1, j), pc = at(i + 1, j + 1), pd = at(i, j + 1);
        const na = normalAt(i, j), nb = normalAt(i + 1, j), nc = normalAt(i + 1, j + 1), nd = normalAt(i, j + 1);
        const ua = [i / cf, j / rf];
        const ub = [(i + 1) / cf, j / rf];
        const uc = [(i + 1) / cf, (j + 1) / rf];
        const ud = [i / cf, (j + 1) / rf];
        g.vert(pa, na, ua);
        g.vert(pc, nc, uc);
        g.vert(pb, nb, ub);
        g.vert(pa, na, ua);
        g.vert(pd, nd, ud);
        g.vert(pc, nc, uc);
      }
    }
    const skirt = (a, b, c, d, n) => {
      const uv2 = [0, 0];
      g.vert(a, n, uv2);
      g.vert(b, n, uv2);
      g.vert(c, n, uv2);
      g.vert(a, n, uv2);
      g.vert(c, n, uv2);
      g.vert(d, n, uv2);
    };
    for (let i = 0; i + 1 < cols; i++) {
      const tn0 = at(i, 0), tn1 = at(i + 1, 0);
      if (tn0[1] > base || tn1[1] > base) skirt(drop(tn1), drop(tn0), tn0, tn1, [0, 0, -1]);
      const js = rows - 1;
      const ts0 = at(i, js), ts1 = at(i + 1, js);
      if (ts0[1] > base || ts1[1] > base) skirt(drop(ts0), drop(ts1), ts1, ts0, [0, 0, 1]);
    }
    for (let j = 0; j + 1 < rows; j++) {
      const tw0 = at(0, j), tw1 = at(0, j + 1);
      if (tw0[1] > base || tw1[1] > base) skirt(drop(tw0), drop(tw1), tw1, tw0, [-1, 0, 0]);
      const ie = cols - 1;
      const te0 = at(ie, j), te1 = at(ie, j + 1);
      if (te0[1] > base || te1[1] > base) skirt(drop(te1), drop(te0), te0, te1, [1, 0, 0]);
    }
    return g.build();
  }

  // runtime/geometries/Humanoid.ts
  var HUMANOID_DEFAULTS = {
    height: 2,
    shoulderWidth: 0.72,
    hipWidth: 0.46,
    headSize: 0.24,
    limbThickness: 1,
    sides: 8,
    smoothShading: true
  };
  function ringVerts(r, sides) {
    const out = [];
    const t = r.twist ?? 0;
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + t + i / sides * Math.PI * 2;
      const x = r.cx + Math.cos(a) * r.rx;
      const z = r.cz + Math.sin(a) * r.rz;
      out.push([x, r.y, z]);
    }
    return out;
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  function normalize3(v) {
    const L = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / L, v[1] / L, v[2] / L];
  }
  var HUMANOID_ATLAS = {
    head: { u0: 0, u1: 0.5, v0: 0.5, v1: 0 },
    // top-left, flipped (crown→image top)
    arms: { u0: 0.5, u1: 1, v0: 0, v1: 0.5 },
    // top-right (shoulder→top, tip→middle)
    torso: { u0: 0, u1: 0.5, v0: 1, v1: 0.5 },
    // bottom-left, flipped (hip→image bottom)
    legs: { u0: 0.5, u1: 1, v0: 0.5, v1: 1 }
    // bottom-right (hip→middle, toe→image bottom)
  };
  function emitSweep(g, rings, sides, smooth, rect) {
    const ringPts = rings.map((r) => ringVerts(r, sides));
    const numRings = ringPts.length;
    const descending = rings.length >= 2 && rings[1].y <= rings[0].y;
    const faceN = [];
    for (let i = 0; i < numRings - 1; i++) {
      const a = ringPts[i];
      const b = ringPts[i + 1];
      const row = [];
      for (let s = 0; s < sides; s++) {
        const s2 = (s + 1) % sides;
        const p0 = a[s];
        const p1 = a[s2];
        const p3 = b[s];
        const e1 = sub(p1, p0);
        const e2 = sub(p3, p0);
        const n = normalize3(descending ? cross(e1, e2) : cross(e2, e1));
        row.push(n);
      }
      faceN.push(row);
    }
    let vertN = null;
    if (smooth) {
      vertN = [];
      for (let i = 0; i < numRings; i++) {
        const row = [];
        for (let s = 0; s < sides; s++) {
          const sPrev = (s + sides - 1) % sides;
          let nx = 0, ny = 0, nz = 0;
          const acc = (qi, qs) => {
            if (qi < 0 || qi >= faceN.length) return;
            const n = faceN[qi][qs];
            nx += n[0];
            ny += n[1];
            nz += n[2];
          };
          acc(i - 1, sPrev);
          acc(i - 1, s);
          acc(i, sPrev);
          acc(i, s);
          const L = Math.hypot(nx, ny, nz);
          row.push(L > 1e-6 ? [nx / L, ny / L, nz / L] : [0, 1, 0]);
        }
        vertN.push(row);
      }
    }
    const uAt = (s) => rect.u0 + s / sides * (rect.u1 - rect.u0);
    const vAt = (i) => numRings > 1 ? rect.v0 + i / (numRings - 1) * (rect.v1 - rect.v0) : rect.v0;
    for (let i = 0; i < numRings - 1; i++) {
      const a = ringPts[i];
      const b = ringPts[i + 1];
      for (let s = 0; s < sides; s++) {
        const s2 = (s + 1) % sides;
        const p0 = a[s];
        const p1 = a[s2];
        const p2 = b[s2];
        const p3 = b[s];
        const fn = faceN[i][s];
        const n0 = vertN ? vertN[i][s] : fn;
        const n1 = vertN ? vertN[i][s2] : fn;
        const n2 = vertN ? vertN[i + 1][s2] : fn;
        const n3 = vertN ? vertN[i + 1][s] : fn;
        const uv0 = [uAt(s), vAt(i)];
        const uv1 = [uAt(s + 1), vAt(i)];
        const uv2 = [uAt(s + 1), vAt(i + 1)];
        const uv3 = [uAt(s), vAt(i + 1)];
        if (descending) {
          g.tri(p0, n0, uv0, p1, n1, uv1, p2, n2, uv2);
          g.tri(p0, n0, uv0, p2, n2, uv2, p3, n3, uv3);
        } else {
          g.tri(p0, n0, uv0, p3, n3, uv3, p2, n2, uv2);
          g.tri(p0, n0, uv0, p2, n2, uv2, p1, n1, uv1);
        }
      }
    }
  }
  function emitCap(g, ring, sides, up, rect, vEdge) {
    const pts = ringVerts(ring, sides);
    const center = [ring.cx, ring.y, ring.cz];
    const n = up ? [0, 1, 0] : [0, -1, 0];
    const perimeterV = vEdge === "v0" ? rect.v0 : rect.v1;
    const dv = (rect.v1 - rect.v0) * 0.08 * (vEdge === "v0" ? 1 : -1);
    const centerUV = [(rect.u0 + rect.u1) * 0.5, perimeterV + dv];
    const uAt = (s) => rect.u0 + s / sides * (rect.u1 - rect.u0);
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const uv_s = [uAt(s), perimeterV];
      const uv_s2 = [uAt(s + 1), perimeterV];
      if (up) {
        g.tri(center, n, centerUV, pts[s2], n, uv_s2, pts[s], n, uv_s);
      } else {
        g.tri(center, n, centerUV, pts[s], n, uv_s, pts[s2], n, uv_s2);
      }
    }
  }
  function generate11(p) {
    const g = mesh();
    const sides = Math.max(4, p.sides | 0);
    const t = p.limbThickness;
    const H = p.height;
    const hipY = H * 0.46;
    const waistY = H * 0.54;
    const chestY = H * 0.66;
    const shoulderY = H * 0.74;
    const neckY = H * 0.78;
    const chinY = H * 0.83;
    const faceY = H * 0.92;
    const crownY = H * 1;
    const shoulderHalf = p.shoulderWidth * 0.5;
    const hipHalf = p.hipWidth * 0.5;
    const neckRing = { y: neckY, cx: 0, cz: 0, rx: H * 0.07, rz: H * 0.06 };
    const bodyRings = [
      { y: hipY, cx: 0, cz: 0, rx: hipHalf * 1.08, rz: hipHalf * 0.85 },
      // hip
      { y: waistY, cx: 0, cz: 0, rx: hipHalf * 1.02, rz: hipHalf * 0.82 },
      // waist (no narrowing — straight column)
      { y: shoulderY, cx: 0, cz: 0, rx: shoulderHalf, rz: shoulderHalf * 0.62 },
      // shoulder
      neckRing
    ];
    const headRings = [
      neckRing,
      { y: chinY, cx: 0, cz: 0.01, rx: p.headSize * 0.72, rz: p.headSize * 0.78 },
      // jaw
      { y: faceY, cx: 0, cz: 0.01, rx: p.headSize * 1, rz: p.headSize * 1 },
      // face (widest)
      { y: H * 0.96, cx: 0, cz: 0, rx: p.headSize * 0.7, rz: p.headSize * 0.7 },
      // upper-skull dome
      { y: crownY, cx: 0, cz: 0, rx: p.headSize * 0.22, rz: p.headSize * 0.22 }
      // crown (near-point)
    ];
    emitSweep(g, bodyRings, sides, p.smoothShading, HUMANOID_ATLAS.torso);
    emitSweep(g, headRings, sides, p.smoothShading, HUMANOID_ATLAS.head);
    emitCap(g, headRings[headRings.length - 1], sides, true, HUMANOID_ATLAS.head, "v0");
    const legRings = (sx) => [
      { y: hipY + 0.04, cx: sx, cz: 0, rx: H * 0.085 * t, rz: H * 0.085 * t },
      // root inside trunk
      { y: hipY - H * 0.05, cx: sx, cz: 0, rx: H * 0.085 * t, rz: H * 0.085 * t },
      // upper thigh
      { y: hipY - H * 0.18, cx: sx, cz: 0, rx: H * 0.078 * t, rz: H * 0.078 * t },
      // knee
      { y: hipY - H * 0.34, cx: sx, cz: 0.01, rx: H * 0.07 * t, rz: H * 0.07 * t },
      // ankle
      { y: hipY - H * 0.39, cx: sx, cz: 0.06, rx: H * 0.07 * t, rz: H * 0.14 * t },
      // foot (forward-stretched, no X widen)
      { y: hipY - H * 0.4, cx: sx, cz: 0.1, rx: H * 0.05 * t, rz: H * 0.09 * t }
      // toe (taper forward + down)
    ];
    const legXOffset = hipHalf * 0.55;
    for (const sx of [-legXOffset, legXOffset]) {
      const rings = legRings(sx);
      emitSweep(g, rings, sides, p.smoothShading, HUMANOID_ATLAS.legs);
      emitCap(g, rings[rings.length - 1], sides, false, HUMANOID_ATLAS.legs, "v1");
    }
    const armRings = (sx) => [
      { y: shoulderY, cx: sx * 0.55, cz: 0, rx: H * 0.07 * t, rz: H * 0.07 * t },
      // root inside trunk
      { y: shoulderY - H * 0.04, cx: sx, cz: 0, rx: H * 0.07 * t, rz: H * 0.07 * t },
      // shoulder bulge
      { y: shoulderY - H * 0.16, cx: sx, cz: 0, rx: H * 0.062 * t, rz: H * 0.062 * t },
      // bicep
      { y: shoulderY - H * 0.3, cx: sx, cz: 0, rx: H * 0.055 * t, rz: H * 0.055 * t },
      // forearm
      { y: shoulderY - H * 0.4, cx: sx, cz: 0, rx: H * 0.045 * t, rz: H * 0.045 * t },
      // wrist
      { y: shoulderY - H * 0.43, cx: sx, cz: 0, rx: H * 0.02 * t, rz: H * 0.02 * t }
      // arm end (near-point)
    ];
    const armX = shoulderHalf * 1.02;
    for (const sx of [-armX, armX]) {
      const rings = armRings(sx);
      emitSweep(g, rings, sides, p.smoothShading, HUMANOID_ATLAS.arms);
      emitCap(g, rings[rings.length - 1], sides, false, HUMANOID_ATLAS.arms, "v1");
    }
    return g.build();
  }

  // runtime/geometries/VoxelMesh.ts
  var FACES = [
    { key: "xp", n: [1, 0, 0], axis: 0, sign: 1, uAxis: 2, vAxis: 1 },
    { key: "xn", n: [-1, 0, 0], axis: 0, sign: -1, uAxis: 2, vAxis: 1 },
    { key: "yp", n: [0, 1, 0], axis: 1, sign: 1, uAxis: 0, vAxis: 2 },
    { key: "yn", n: [0, -1, 0], axis: 1, sign: -1, uAxis: 0, vAxis: 2 },
    { key: "zp", n: [0, 0, 1], axis: 2, sign: 1, uAxis: 0, vAxis: 1 },
    { key: "zn", n: [0, 0, -1], axis: 2, sign: -1, uAxis: 0, vAxis: 1 }
  ];
  function key(x, y, z) {
    return `${x}:${y}:${z}`;
  }
  function blockCoord(block, axis) {
    return axis === 0 ? block.x : axis === 1 ? block.y : block.z;
  }
  function facePlane(block, face) {
    return blockCoord(block, face.axis) + (face.sign > 0 ? 1 : 0);
  }
  function faceCell(block, face) {
    return {
      block,
      face,
      plane: facePlane(block, face),
      u: blockCoord(block, face.uAxis),
      v: blockCoord(block, face.vAxis)
    };
  }
  function bounds(blocks, cell) {
    if (blocks.length === 0) {
      return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: [0, 0, 0] };
    }
    let minX = Infinity, minY2 = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const block of blocks) {
      minX = Math.min(minX, block.x - 0.5);
      minY2 = Math.min(minY2, block.y - 0.5);
      minZ = Math.min(minZ, block.z - 0.5);
      maxX = Math.max(maxX, block.x + 0.5);
      maxY = Math.max(maxY, block.y + 0.5);
      maxZ = Math.max(maxZ, block.z + 0.5);
    }
    const min = [minX * cell, minY2 * cell, minZ * cell];
    const max = [maxX * cell, maxY * cell, maxZ * cell];
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    return { min, max, center, size };
  }
  function sampleDisplace(params, pos4, b) {
    const grid = params.displace;
    const cols = Math.max(1, Math.round(params.dCols ?? 0));
    const rows = Math.max(1, Math.round(params.dRows ?? 0));
    if (!grid || grid.length < cols * rows || !(params.amount && params.amount !== 0)) return 0;
    const sx = b.size[0] > 1e-6 ? (pos4[0] - b.min[0]) / b.size[0] : 0.5;
    const sy = b.size[1] > 1e-6 ? 1 - (pos4[1] - b.min[1]) / b.size[1] : 0.5;
    const gx = Math.max(0, Math.min(cols - 1, Math.round(sx * (cols - 1))));
    const gy = Math.max(0, Math.min(rows - 1, Math.round(sy * (rows - 1))));
    return Math.max(-1, Math.min(1, Number(grid[gy * cols + gx] ?? 0))) * params.amount;
  }
  function point(raw, normal, params, b) {
    const c = [raw[0] - b.center[0], raw[1] - b.center[1], raw[2] - b.center[2]];
    const d = sampleDisplace(params, raw, b);
    return [c[0] + normal[0] * d, c[1] + normal[1] * d, c[2] + normal[2] * d];
  }
  function makeQuad(face, plane, u0, v0, u1, v1, cell, params, b) {
    const p = (u, v) => {
      const raw = [0, 0, 0];
      raw[face.axis] = (plane - 0.5) * cell;
      raw[face.uAxis] = (u - 0.5) * cell;
      raw[face.vAxis] = (v - 0.5) * cell;
      return point(raw, face.n, params, b);
    };
    const a = p(u0, v0);
    const b1 = p(u1, v0);
    const c = p(u1, v1);
    const d = p(u0, v1);
    return face.sign > 0 ? [a, b1, c, d] : [b1, a, d, c];
  }
  function greedyFaces(blocks) {
    const occupied = new Set(blocks.map((b) => key(b.x, b.y, b.z)));
    const buckets = /* @__PURE__ */ new Map();
    for (const block of blocks) {
      for (const face of FACES) {
        const nx = block.x + face.n[0];
        const ny = block.y + face.n[1];
        const nz = block.z + face.n[2];
        if (occupied.has(key(nx, ny, nz))) continue;
        const cell = faceCell(block, face);
        const bucketKey = `${face.key}:${block.kind ?? "voxel"}:${cell.plane}`;
        const arr = buckets.get(bucketKey) ?? [];
        arr.push(cell);
        buckets.set(bucketKey, arr);
      }
    }
    const out = [];
    for (const cells of buckets.values()) {
      const pending = new Set(cells.map((c) => `${c.u}:${c.v}`));
      const byKey = new Map(cells.map((c) => [`${c.u}:${c.v}`, c]));
      const sorted = cells.slice().sort((a, b) => a.v - b.v || a.u - b.u);
      for (const start of sorted) {
        const startKey = `${start.u}:${start.v}`;
        if (!pending.has(startKey)) continue;
        let width = 1;
        while (pending.has(`${start.u + width}:${start.v}`)) width++;
        let height = 1;
        outer: while (true) {
          for (let du = 0; du < width; du++) {
            if (!pending.has(`${start.u + du}:${start.v + height}`)) break outer;
          }
          height++;
        }
        for (let dv = 0; dv < height; dv++) {
          for (let du = 0; du < width; du++) pending.delete(`${start.u + du}:${start.v + dv}`);
        }
        const first = byKey.get(startKey);
        out.push({ face: first.face, plane: first.plane, u0: start.u, v0: start.v, u1: start.u + width, v1: start.v + height });
      }
    }
    return out;
  }
  var VOXEL_MESH_DEFAULTS = Object.freeze({
    blocks: [],
    cellSizeMeters: 1,
    amount: 0
  });
  function generate12(params) {
    const blocks = params.blocks ?? [];
    const cell = Math.max(1e-3, Number(params.cellSizeMeters ?? 1));
    const b = bounds(blocks, cell);
    const m = mesh();
    for (const q of greedyFaces(blocks)) {
      const [a, c, d, e] = makeQuad(q.face, q.plane, q.u0, q.v0, q.u1, q.v1, cell, params, b);
      m.face(a, c, d, e, q.face.n, [0.5, 0.5]);
    }
    return m.build();
  }

  // runtime/geometries/GrassBlade.ts
  var GRASS_BLADE_DEFAULTS = { blades: 3, width: 0.14, tipTaper: 0.25 };
  function generate13(p) {
    const g = mesh();
    const halfW = p.width * 0.5;
    const tipHalfW = halfW * p.tipTaper;
    const count = Math.max(1, Math.floor(p.blades));
    for (let b = 0; b < count; b += 1) {
      const theta = (b + 0.5) / count * Math.PI;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);
      const n = [dz, 0, -dx];
      const nBack = [-dz, 0, dx];
      const bl = [-dx * halfW, 0, -dz * halfW];
      const br = [dx * halfW, 0, dz * halfW];
      const tr = [dx * tipHalfW, 1, dz * tipHalfW];
      const tl = [-dx * tipHalfW, 1, -dz * tipHalfW];
      g.tri(bl, n, [0, 0], br, n, [1, 0], tr, n, [1, 1]);
      g.tri(bl, n, [0, 0], tr, n, [1, 1], tl, n, [0, 1]);
      g.tri(bl, nBack, [0, 0], tr, nBack, [1, 1], br, nBack, [1, 0]);
      g.tri(bl, nBack, [0, 0], tl, nBack, [0, 1], tr, nBack, [1, 1]);
    }
    return g.build();
  }

  // runtime/geometries/BushClump.ts
  var BUSH_CLUMP_DEFAULTS = { cards: 5, width: 0.5, tipTaper: 0.3, splay: 0.5 };
  function generate14(p) {
    const g = mesh();
    const halfW = p.width * 0.5;
    const tipHalfW = halfW * p.tipTaper;
    const count = Math.max(1, Math.floor(p.cards));
    for (let b = 0; b < count; b += 1) {
      const theta = (b + 0.5) / count * Math.PI * 2;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);
      const perpX = -dz;
      const perpZ = dx;
      const n = [dx, 0.6, dz];
      const nBack = [-dx, 0.6, -dz];
      const tipX = dx * p.splay;
      const tipZ = dz * p.splay;
      const bl = [-perpX * halfW, 0, -perpZ * halfW];
      const br = [perpX * halfW, 0, perpZ * halfW];
      const tr = [tipX + perpX * tipHalfW, 1, tipZ + perpZ * tipHalfW];
      const tl = [tipX - perpX * tipHalfW, 1, tipZ - perpZ * tipHalfW];
      g.tri(bl, n, [0, 0], br, n, [1, 0], tr, n, [1, 1]);
      g.tri(bl, n, [0, 0], tr, n, [1, 1], tl, n, [0, 1]);
      g.tri(bl, nBack, [0, 0], tr, nBack, [1, 1], br, nBack, [1, 0]);
      g.tri(bl, nBack, [0, 0], tl, nBack, [0, 1], tr, nBack, [1, 1]);
    }
    return g.build();
  }

  // runtime/geometries/FlowerHead.ts
  var FLOWER_HEAD_DEFAULTS = { cards: 3, radius: 1 };
  function generate15(p) {
    const g = mesh();
    const count = Math.max(1, Math.floor(p.cards));
    const r = Math.max(0.01, p.radius);
    const u0 = 10, u1 = 11, v0 = 10, v1 = 11;
    for (let b = 0; b < count; b += 1) {
      const theta = (b + 0.5) / count * Math.PI;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);
      const n = [dz, 0, -dx];
      const nb = [-dz, 0, dx];
      const bl = [-dx * r, -r, -dz * r];
      const br = [dx * r, -r, dz * r];
      const tr = [dx * r, r, dz * r];
      const tl = [-dx * r, r, -dz * r];
      g.tri(bl, n, [u0, v0], br, n, [u1, v0], tr, n, [u1, v1]);
      g.tri(bl, n, [u0, v0], tr, n, [u1, v1], tl, n, [u0, v1]);
      g.tri(bl, nb, [u0, v0], tr, nb, [u1, v1], br, nb, [u1, v0]);
      g.tri(bl, nb, [u0, v0], tl, nb, [u0, v1], tr, nb, [u1, v1]);
    }
    return g.build();
  }

  // runtime/geometries/Frond.ts
  var FROND_DEFAULTS = { style: "feathered", width: 0.5, tipTaper: 0.1, arc: 0.8, sag: 0.18, segments: 12 };
  var STYLE_OFFSET = { feathered: 0, broad: 10 };
  function generate16(p) {
    const g = mesh();
    const segs = Math.max(2, Math.floor(p.segments));
    const uOff = STYLE_OFFSET[p.style] ?? 0;
    const spine = (t) => ({
      y: t - p.sag * t * t,
      z: p.arc * t * t,
      halfW: p.width * 0.5 * (1 - (1 - p.tipTaper) * t)
    });
    for (let s = 0; s < segs; s += 1) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const a = spine(t0);
      const b = spine(t1);
      const slope = normalize(0, b.y - a.y, b.z - a.z);
      const nf = normalize(0, -slope[2], slope[1]);
      const nb = [-nf[0], -nf[1], -nf[2]];
      const bl = [-a.halfW, a.y, a.z];
      const br = [a.halfW, a.y, a.z];
      const tr = [b.halfW, b.y, b.z];
      const tl = [-b.halfW, b.y, b.z];
      const uL = uOff + 0;
      const uR = uOff + 1;
      g.tri(bl, nf, [uL, t0], br, nf, [uR, t0], tr, nf, [uR, t1]);
      g.tri(bl, nf, [uL, t0], tr, nf, [uR, t1], tl, nf, [uL, t1]);
      g.tri(bl, nb, [uL, t0], tr, nb, [uR, t1], br, nb, [uR, t0]);
      g.tri(bl, nb, [uL, t0], tl, nb, [uL, t1], tr, nb, [uR, t1]);
    }
    return g.build();
  }

  // runtime/geometries/PalmTrunk.ts
  var PALM_TRUNK_DEFAULTS = {
    baseRadius: 0.13,
    topRadius: 0.08,
    curve: 0.16,
    rings: 11,
    ringDepth: 0.12,
    sides: 10,
    segments: 28
  };
  var TAU2 = Math.PI * 2;
  function generate17(p) {
    const g = mesh();
    const segs = Math.max(2, Math.floor(p.segments));
    const sides = Math.max(3, Math.floor(p.sides));
    const at = (t) => {
      const taper = p.baseRadius + (p.topRadius - p.baseRadius) * t;
      const bulge = 1 + 0.18 * Math.exp(-((t - 0.12) * (t - 0.12)) / 0.01);
      const ring = 1 + p.ringDepth * Math.cos(t * p.rings * TAU2);
      const r = taper * bulge * ring;
      const cx = p.curve * (t * t * 0.7 + Math.sin(t * 2.8) * 0.05);
      return { r, cx };
    };
    const ringVerts2 = (t) => {
      const { r, cx } = at(t);
      const out = [];
      for (let s = 0; s <= sides; s += 1) {
        const a = s / sides * TAU2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        out.push({ pos: [cx + dx * r, t, dz * r], nrm: normalize(dx, 0.15, dz), u: s / sides });
      }
      return out;
    };
    let lower = ringVerts2(0);
    for (let i = 1; i <= segs; i += 1) {
      const t = i / segs;
      const upper = ringVerts2(t);
      const v0 = (i - 1) / segs;
      const v1 = t;
      for (let s = 0; s < sides; s += 1) {
        const bl = lower[s], br = lower[s + 1], tr = upper[s + 1], tl = upper[s];
        g.tri(bl.pos, bl.nrm, [bl.u, v0], tl.pos, tl.nrm, [tl.u, v1], tr.pos, tr.nrm, [tr.u, v1]);
        g.tri(bl.pos, bl.nrm, [bl.u, v0], tr.pos, tr.nrm, [tr.u, v1], br.pos, br.nrm, [br.u, v0]);
      }
      lower = upper;
    }
    return g.build();
  }

  // runtime/geometries/PathTube.ts
  var PATH_TUBE_DEFAULTS = {
    // a gently S-curved default trunk spine, base→tip
    spine: [0, 0, 0.02, 0.25, 0.08, 0.5, 0.06, 0.75, 0.12, 1],
    baseRadius: 0.12,
    tipRadius: 0.07,
    sides: 10
  };
  var TAU3 = Math.PI * 2;
  function generate18(p) {
    const g = mesh();
    const sp = p.spine;
    const n = Math.floor(sp.length / 2);
    if (n < 2) return g.build();
    const sides = Math.max(3, Math.floor(p.sides));
    const tangent = (i) => {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const tx = sp[b * 2] - sp[a * 2];
      const ty = sp[b * 2 + 1] - sp[a * 2 + 1];
      const L = Math.hypot(tx, ty) || 1;
      return [tx / L, ty / L];
    };
    const ring = (i) => {
      const cx = sp[i * 2];
      const cy = sp[i * 2 + 1];
      const t = i / (n - 1);
      const r = p.baseRadius + (p.tipRadius - p.baseRadius) * t;
      const [tx, ty] = tangent(i);
      const nx = -ty, ny = tx;
      const out = [];
      for (let s = 0; s <= sides; s += 1) {
        const ang = s / sides * TAU3;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        out.push({ pos: [cx + r * ca * nx, cy + r * ca * ny, r * sa], nrm: normalize(ca * nx, ca * ny, sa), u: s / sides });
      }
      return out;
    };
    let lower = ring(0);
    for (let i = 1; i < n; i += 1) {
      const upper = ring(i);
      const v0 = (i - 1) / (n - 1);
      const v1 = i / (n - 1);
      for (let s = 0; s < sides; s += 1) {
        const bl = lower[s], br = lower[s + 1], tr = upper[s + 1], tl = upper[s];
        g.tri(bl.pos, bl.nrm, [bl.u, v0], br.pos, br.nrm, [br.u, v0], tr.pos, tr.nrm, [tr.u, v1]);
        g.tri(bl.pos, bl.nrm, [bl.u, v0], tr.pos, tr.nrm, [tr.u, v1], tl.pos, tl.nrm, [tl.u, v1]);
      }
      lower = upper;
    }
    return g.build();
  }

  // runtime/geometries/index.ts
  function def(id, generate19, defaults) {
    return { id, generate: generate19, defaults };
  }
  var Box = def("Box", generate, BOX_DEFAULTS);
  var Sphere = def("Sphere", generate2, SPHERE_DEFAULTS);
  var Head = def("Head", generate3, HEAD_DEFAULTS);
  var Carve = def("Carve", generate4, CARVE_DEFAULTS);
  var Globe = def("Globe", generate5, GLOBE_DEFAULTS);
  var Plane = def("Plane", generate6, PLANE_DEFAULTS);
  var Cylinder = def("Cylinder", generate7, CYLINDER_DEFAULTS);
  var Cone = def("Cone", generate8, CONE_DEFAULTS);
  var Torus = def("Torus", generate9, TORUS_DEFAULTS);
  var Heightfield = { ...def("Heightfield", generate10, HEIGHTFIELD_DEFAULTS), hostKind: "heightfield" };
  var Humanoid = def("Humanoid", generate11, HUMANOID_DEFAULTS);
  var VoxelMesh = def("VoxelMesh", generate12, VOXEL_MESH_DEFAULTS);
  var GrassBlade = def("GrassBlade", generate13, GRASS_BLADE_DEFAULTS);
  var BushClump = def("BushClump", generate14, BUSH_CLUMP_DEFAULTS);
  var FlowerHead = def("FlowerHead", generate15, FLOWER_HEAD_DEFAULTS);
  var Frond = def("Frond", generate16, FROND_DEFAULTS);
  var PalmTrunk = def("PalmTrunk", generate17, PALM_TRUNK_DEFAULTS);
  var PathTube = def("PathTube", generate18, PATH_TUBE_DEFAULTS);

  // cart/editor/model/editMesh.ts
  function edgeKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }
  function sub2(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  function cross2(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function faceNormal(m, face) {
    let nx = 0, ny = 0, nz = 0;
    const loop = face.loop;
    for (let i = 0; i < loop.length; i += 1) {
      const cur = m.verts[loop[i]];
      const nxt = m.verts[loop[(i + 1) % loop.length]];
      nx += (cur[1] - nxt[1]) * (cur[2] + nxt[2]);
      ny += (cur[2] - nxt[2]) * (cur[0] + nxt[0]);
      nz += (cur[0] - nxt[0]) * (cur[1] + nxt[1]);
    }
    const len = Math.hypot(nx, ny, nz);
    return len < 1e-9 ? [0, 1, 0] : [nx / len, ny / len, nz / len];
  }
  var SMOOTH_CREASE_DEG = 40;
  function quadTriPositions(m, face) {
    const L = face.loop;
    if (face.diagonal) {
      const [a, b] = face.diagonal;
      const ai = L.indexOf(a), bi = L.indexOf(b);
      if (ai >= 0 && bi >= 0 && ((ai + 2) % 4 === bi || (bi + 2) % 4 === ai)) {
        const useAC2 = ai % 2 === 0;
        return useAC2 ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]];
      }
    }
    const v = (li) => m.verts[L[li]];
    const normal = faceNormal(m, face);
    const triOk = (i, j, k) => dot(cross2(sub2(v(j), v(i)), sub2(v(k), v(i))), normal) > 0;
    const acConvex = triOk(0, 1, 2) && triOk(0, 2, 3);
    const bdConvex = triOk(1, 2, 3) && triOk(1, 3, 0);
    let useAC;
    if (acConvex !== bdConvex) useAC = acConvex;
    else {
      const d2 = (i, j) => {
        const e = sub2(v(j), v(i));
        return dot(e, e);
      };
      useAC = d2(0, 2) <= d2(1, 3);
    }
    return useAC ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]];
  }
  function editMeshToGeometry(m, includeFace, faceGroupsOut) {
    const g = mesh();
    const flat = [0.5, 0.5];
    const faceN = m.faces.map((f) => f.loop.length >= 3 ? faceNormal(m, f) : [0, 1, 0]);
    const vertFaces = /* @__PURE__ */ new Map();
    m.faces.forEach((f, fi) => {
      if (f.loop.length < 3) return;
      for (const vi of f.loop) {
        let a = vertFaces.get(vi);
        if (!a) {
          a = [];
          vertFaces.set(vi, a);
        }
        a.push(fi);
      }
    });
    const cosCrease = Math.cos(SMOOTH_CREASE_DEG * Math.PI / 180);
    const normalAt = (vi, fi) => {
      const fn = faceN[fi];
      let nx = 0, ny = 0, nz = 0;
      for (const gf of vertFaces.get(vi) ?? [fi]) {
        const gn = faceN[gf];
        if (gn[0] * fn[0] + gn[1] * fn[1] + gn[2] * fn[2] >= cosCrease) {
          nx += gn[0];
          ny += gn[1];
          nz += gn[2];
        }
      }
      const L = Math.hypot(nx, ny, nz) || 1;
      return [nx / L, ny / L, nz / L];
    };
    for (let fi = 0; fi < m.faces.length; fi += 1) {
      const face = m.faces[fi];
      if (includeFace && !includeFace(face)) continue;
      if (face.loop.length < 3) continue;
      const uv2 = face.uv;
      const corner = (li) => {
        const vi = face.loop[li];
        return [m.verts[vi], normalAt(vi, fi), uv2?.[li] ?? flat];
      };
      const tris = face.loop.length === 4 ? quadTriPositions(m, face) : Array.from({ length: face.loop.length - 2 }, (_, i) => [0, i + 1, i + 2]);
      for (const [l0, l1, l2] of tris) {
        const [pa, na, ua] = corner(l0);
        const [pb, nb, ub] = corner(l1);
        const [pc, nc, uc] = corner(l2);
        g.tri(pa, na, ua, pb, nb, ub, pc, nc, uc);
        faceGroupsOut?.push(fi);
      }
    }
    return g.build();
  }
  function cuboid(width, height, depth) {
    const x = width / 2, y = height / 2, z = depth / 2;
    const verts = [
      [-x, -y, -z],
      [x, -y, -z],
      [x, -y, z],
      [-x, -y, z],
      // 0..3 bottom
      [-x, y, -z],
      [x, y, -z],
      [x, y, z],
      [-x, y, z]
      // 4..7 top
    ];
    const faces = [
      { loop: [4, 7, 6, 5] },
      // +Y top
      { loop: [0, 1, 2, 3] },
      // -Y bottom
      { loop: [0, 4, 5, 1] },
      // -Z front
      { loop: [3, 2, 6, 7] },
      // +Z back
      { loop: [0, 3, 7, 4] },
      // -X left
      { loop: [1, 5, 6, 2] }
      // +X right
    ];
    return fullFaceUV({ verts, faces });
  }
  function isFaceConcave(m, face) {
    const loop = face.loop;
    if (loop.length < 4) return false;
    const normal = faceNormal(m, face);
    let sign = 0;
    for (let i = 0; i < loop.length; i += 1) {
      const prev = m.verts[loop[(i + loop.length - 1) % loop.length]];
      const cur = m.verts[loop[i]];
      const next = m.verts[loop[(i + 1) % loop.length]];
      const turn = dot(cross2(sub2(cur, prev), sub2(next, cur)), normal);
      if (Math.abs(turn) < 1e-9) continue;
      const s = turn > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return true;
    }
    return false;
  }
  function findConcaveFaces(m) {
    const out = [];
    for (let i = 0; i < m.faces.length; i += 1) {
      if (isFaceConcave(m, m.faces[i])) out.push(i);
    }
    return out;
  }
  function projectVert(v, axis) {
    if (axis === "x") return [v[2], v[1]];
    if (axis === "y") return [v[0], v[2]];
    return [v[0], v[1]];
  }
  function faceSquareUV(verts, loop) {
    const n = faceNormal({ verts, faces: [] }, { loop });
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const axis = ax >= ay && ax >= az ? "x" : ay >= az ? "y" : "z";
    const pts = loop.map((i) => projectVert(verts[i], axis));
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const [u, v] of pts) {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const du = maxU - minU || 1, dv = maxV - minV || 1;
    return pts.map(([u, v]) => [(u - minU) / du, (v - minV) / dv]);
  }
  function fullFaceUV(m) {
    return {
      ...m,
      faces: m.faces.map((face) => face.loop.length < 3 ? face : { ...face, uv: faceSquareUV(m.verts, face.loop) })
    };
  }
  function asSet(indices) {
    return indices instanceof Set ? indices : new Set(indices);
  }
  function mergeMesh(a, b, delta) {
    const base = a.verts.length;
    const verts = [...a.verts.map((v) => [v[0], v[1], v[2]]), ...b.verts.map((v) => [v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]])];
    const faces = [...a.faces, ...b.faces.map((f) => ({ ...f, loop: f.loop.map((i) => i + base) }))];
    return { ...a, verts, faces };
  }
  function translateVerts(m, indices, delta) {
    const set = asSet(indices);
    const verts = m.verts.map((v, i) => set.has(i) ? [v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]] : v);
    return { ...m, verts };
  }
  function rotateVerts(m, indices, anchor, axis, angle) {
    const set = asSet(indices);
    const c = Math.cos(angle), s = Math.sin(angle);
    const verts = m.verts.map((v, i) => {
      if (!set.has(i)) return v;
      const dx = v[0] - anchor[0], dy = v[1] - anchor[1], dz = v[2] - anchor[2];
      if (axis === 0) return [v[0], anchor[1] + dy * c - dz * s, anchor[2] + dy * s + dz * c];
      if (axis === 1) return [anchor[0] + dx * c - dz * s, v[1], anchor[2] + dx * s + dz * c];
      return [anchor[0] + dx * c - dy * s, anchor[1] + dx * s + dy * c, v[2]];
    });
    return { ...m, verts };
  }
  function validateMesh(m, dp = 4) {
    const out = [];
    m.faces.forEach((f, fi) => {
      const distinct = new Set(f.loop);
      if (distinct.size < f.loop.length) {
        const dupes = f.loop.filter((v, i) => f.loop.indexOf(v) !== i);
        out.push({ kind: "repeated-corner", severity: "error", faces: [fi], verts: [...new Set(dupes)], detail: `face ${fi} names vertex ${[...new Set(dupes)].join(", ")} twice (zero-length edge)` });
      }
      if (distinct.size < 3) {
        out.push({ kind: "degenerate-face", severity: "error", faces: [fi], verts: [...distinct], detail: `face ${fi} has only ${distinct.size} distinct corners` });
        return;
      }
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < f.loop.length; i += 1) {
        const c = m.verts[f.loop[i]], n = m.verts[f.loop[(i + 1) % f.loop.length]];
        nx += (c[1] - n[1]) * (c[2] + n[2]);
        ny += (c[2] - n[2]) * (c[0] + n[0]);
        nz += (c[0] - n[0]) * (c[1] + n[1]);
      }
      if (Math.hypot(nx, ny, nz) < 1e-7) out.push({ kind: "degenerate-face", severity: "error", faces: [fi], verts: [...distinct], detail: `face ${fi} has ~zero area (collinear corners)` });
    });
    const edgeFaces = /* @__PURE__ */ new Map();
    m.faces.forEach((f, fi) => {
      const n = f.loop.length;
      for (let i = 0; i < n; i += 1) {
        const a = f.loop[i], b = f.loop[(i + 1) % n];
        if (a === b) continue;
        const k = edgeKey(a, b);
        (edgeFaces.get(k) ?? (edgeFaces.set(k, []), edgeFaces.get(k))).push(fi);
      }
    });
    for (const [k, fs] of edgeFaces) {
      const [a, b] = k.split(":").map(Number);
      if (fs.length > 2) out.push({ kind: "non-manifold-edge", severity: "error", faces: [...new Set(fs)], verts: [a, b], detail: `edge ${a}-${b} is shared by ${fs.length} faces` });
      else if (fs.length === 1) out.push({ kind: "open-edge", severity: "info", faces: fs, verts: [a, b], detail: `edge ${a}-${b} is a boundary (open) edge` });
    }
    const byPos = /* @__PURE__ */ new Map();
    m.verts.forEach((v, i) => {
      const key2 = `${v[0].toFixed(dp)},${v[1].toFixed(dp)},${v[2].toFixed(dp)}`;
      (byPos.get(key2) ?? (byPos.set(key2, []), byPos.get(key2))).push(i);
    });
    for (const ids of byPos.values()) if (ids.length > 1) out.push({ kind: "duplicate-vertex", severity: "warn", faces: [], verts: ids, detail: `${ids.length} verts share a position (${ids.join(", ")})` });
    const used = /* @__PURE__ */ new Set();
    for (const f of m.faces) for (const vi of f.loop) used.add(vi);
    const orphans = m.verts.map((_, i) => i).filter((i) => !used.has(i));
    if (orphans.length) out.push({ kind: "orphan-vertex", severity: "warn", faces: [], verts: orphans, detail: `${orphans.length} verts are used by no face` });
    const concave = findConcaveFaces(m);
    if (concave.length) out.push({ kind: "concave-face", severity: "warn", faces: concave, verts: [], detail: `${concave.length} face(s) are concave (reflex corner)` });
    return out;
  }
  function meshHealth(m) {
    const issues = validateMesh(m);
    const errors = issues.filter((i) => i.severity === "error").length;
    const warns = issues.filter((i) => i.severity === "warn").length;
    return { clean: errors === 0 && warns === 0, errors, warns, issues };
  }

  // cart/editor/model/buildPieceStarter.ts
  var DEG2 = Math.PI / 180;
  function allVerts(mesh2) {
    return mesh2.verts.map((_, index) => index);
  }
  function rampMesh(ramp) {
    const halfW = ramp.width / 2;
    const halfD = ramp.depth / 2;
    const height = Math.max(ramp.height, ramp.slabThickness);
    const verts = [
      [-halfW, 0, -halfD],
      [halfW, 0, -halfD],
      [halfW, 0, halfD],
      [-halfW, 0, halfD],
      [halfW, height, halfD],
      [-halfW, height, halfD]
    ];
    let mesh2 = fullFaceUV({
      verts,
      faces: [
        { loop: [0, 5, 4, 1] },
        // slope
        { loop: [2, 4, 5, 3] },
        // high wall
        { loop: [0, 1, 2, 3] },
        // bottom
        { loop: [1, 4, 2] },
        // right
        { loop: [0, 3, 5] }
        // left
      ]
    });
    if (ramp.yawDegrees !== 0) {
      mesh2 = rotateVerts(mesh2, allVerts(mesh2), [0, 0, 0], 1, ramp.yawDegrees * DEG2);
    }
    return translateVerts(mesh2, allVerts(mesh2), [ramp.x, ramp.y, ramp.z]);
  }
  function boxMesh(box) {
    let mesh2 = cuboid(box.sx, box.sy, box.sz);
    if (box.yawDegrees !== 0) {
      mesh2 = rotateVerts(mesh2, allVerts(mesh2), [0, 0, 0], 1, box.yawDegrees * DEG2);
    }
    return translateVerts(mesh2, allVerts(mesh2), [box.cx, box.cy, box.cz]);
  }
  function editableShape(shape) {
    const opacity = shape.kind === "box" ? shape.box.opacity : shape.ramp.opacity;
    const mesh2 = shape.kind === "box" ? boxMesh(shape.box) : rampMesh(shape.ramp);
    if (opacity === void 0 || opacity >= 1) return mesh2;
    return { ...mesh2, faces: mesh2.faces.map((face) => ({ ...face, glass: true })) };
  }
  function buildPieceStarterParts(starterId) {
    const starter = buildPieceStarter(starterId);
    if (!starter) return [];
    const row = catalogRowFor(starter.catalogPieceId);
    if (!row || row.kind !== starter.kind) return [];
    const shapes = pieceVisualShapes({
      id: `build-starter:${starterId}`,
      pieceId: row.id,
      x: 0,
      y: 0,
      z: 0,
      yawDegrees: 0
    }, rowHex(row));
    const mergeShapes = (source) => {
      let mesh3 = null;
      for (const shape of source) {
        const next = editableShape(shape);
        mesh3 = mesh3 ? mergeMesh(mesh3, next, [0, 0, 0]) : next;
      }
      return mesh3;
    };
    if (starter.edit === "door" || starter.edit === "garageDoor") {
      const leafShapes = shapes.filter((shape) => shape.kind === "box" && shape.box.door === true);
      const frameShapes = shapes.filter((shape) => !(shape.kind === "box" && shape.box.door === true));
      const frame = mergeShapes(frameShapes);
      const leaf = mergeShapes(leafShapes);
      if (!frame || !leaf) return [];
      return [
        {
          id: `part:build-starter:${starterId}:frame`,
          name: "Door Frame",
          mesh: frame,
          visible: true,
          color: rowHex(row)
        },
        {
          id: `part:build-starter:${starterId}:leaf`,
          name: "Door Leaf",
          mesh: leaf,
          visible: true,
          color: leafShapes[0]?.kind === "box" ? leafShapes[0].box.color : "#0c1018"
        }
      ];
    }
    const mesh2 = mergeShapes(shapes);
    if (!mesh2) return [];
    return [{
      id: `part:build-starter:${starterId}`,
      name: starter.name.replace(/ Piece$/, ""),
      mesh: mesh2,
      visible: true,
      color: rowHex(row)
    }];
  }

  // cart/editor/model/buildPieceStarter.test.ts
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
  function minY(mesh2) {
    return Math.min(...mesh2.verts.map((vert) => vert[1]));
  }
  test("starter registry covers the complete build-kind grammar in palette order", () => {
    const base = BUILD_PIECE_STARTERS.filter((starter) => starter.id === starter.kind);
    assert(base.map((starter) => starter.kind).join("|") === KIND_ORDER.join("|"), "base starter kind/order drift");
    for (const starter of BUILD_PIECE_STARTERS) {
      const row = catalogRowFor(starter.catalogPieceId);
      assert(row?.kind === starter.kind, `${starter.name} points at ${row?.kind ?? "missing"} catalog geometry`);
    }
  });
  test("door variants are wall edits with a named frame and movable leaf", () => {
    for (const id of ["door-wall", "garage-door-wall"]) {
      const starter = BUILD_PIECE_STARTERS.find((entry) => entry.id === id);
      assert(starter.kind === "wall", `${id} became a separate build kind`);
      assert(starter.edit === (id === "door-wall" ? "door" : "garageDoor"), `${id} lost its wall edit`);
      const parts = buildPieceStarterParts(id);
      assert(parts.length === 2, `${id} should seed frame + leaf, got ${parts.length}`);
      assert(parts[0]?.name === "Door Frame", `${id} frame is not meaningfully named`);
      assert(parts[1]?.name === "Door Leaf", `${id} leaf is not meaningfully named`);
      for (const part of parts) {
        assert(!!part.mesh && meshHealth(part.mesh).errors === 0, `${id}/${part.name} has invalid topology`);
        assert(editMeshToGeometry(part.mesh).positions.length > 0, `${id}/${part.name} emits no triangles`);
      }
    }
  });
  test("every build starter is grounded, editable, and emits triangles", () => {
    for (const kind of KIND_ORDER) {
      const parts = buildPieceStarterParts(kind);
      assert(parts.length === 1, `${kind} should open as one model part, got ${parts.length}`);
      const mesh2 = parts[0]?.mesh;
      assert(!!mesh2, `${kind} has no EditMesh`);
      assert(mesh2.verts.length > 0 && mesh2.faces.length > 0, `${kind} mesh is empty`);
      assert(Math.abs(minY(mesh2)) < 1e-6, `${kind} starts off the ground at y=${minY(mesh2)}`);
      assert(meshHealth(mesh2).errors === 0, `${kind} starter has invalid topology`);
      assert(editMeshToGeometry(mesh2).positions.length > 0, `${kind} emits no render triangles`);
    }
  });
  test("stairs and elevator retain their compound silhouettes", () => {
    const stairs = buildPieceStarterParts("stairs")[0].mesh;
    const elevator = buildPieceStarterParts("elevator")[0].mesh;
    assert(stairs.verts.length > buildPieceStarterParts("wall")[0].mesh.verts.length, "stairs collapsed to a box");
    assert(elevator.verts.length > buildPieceStarterParts("pillar")[0].mesh.verts.length, "elevator collapsed to a pillar");
  });
  test("the arch kind seeds a real open frame instead of a solid wall", () => {
    const starter = BUILD_PIECE_STARTERS.find((entry) => entry.kind === "arch");
    const shapes = pieceVisualShapes({ id: "arch-proof", pieceId: starter.catalogPieceId, x: 0, y: 0, z: 0, yawDegrees: 0 }, "#ffffff");
    const keys = shapes.map((shape) => shape.kind === "box" ? shape.box.key : shape.ramp.key);
    assert(keys.some((key2) => key2.includes("leftJamb")), `arch has no left jamb: ${keys.join(", ")}`);
    assert(keys.some((key2) => key2.includes("rightJamb")), `arch has no right jamb: ${keys.join(", ")}`);
    assert(keys.some((key2) => key2.includes("header")), `arch has no header: ${keys.join(", ")}`);
    assert(!keys.some((key2) => key2.includes(".band.")), "arch regressed to a solid band");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
