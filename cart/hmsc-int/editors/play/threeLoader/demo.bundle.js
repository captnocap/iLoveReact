// cart/hmsc-int/editors/play/threeLoader/demo.ts
import * as THREE from "three";

// runtime/workspace/lumps.ts
var LUMP_MAGIC = 1347242578;
var LUMP_FORMAT_VERSION = 0;
var LUMP_HEADER_BYTES = 16;
var LUMP_DIRECTORY_ENTRY_BYTES = 24;
var LUMP_ENCODING = {
  raw: 0,
  rle8: 1,
  rle16: 2,
  text: 3
};
var MAP_LUMP = {
  STRINGS: 1,
  TILES: 2,
  HEIGHTS: 3,
  ZONES: 4,
  PLACEMENTS: 5,
  ENTITIES: 6,
  // Packed 3D instance buffer (u32 count | f32[count*9], stride = pos3/scale3/
  // color3). The authored world's geometry lowered to data the no-V8 loader
  // renders as one instanced unit-cube batch. See compile/worldGeometry.ts.
  INSTANCES: 7,
  // Scene render environment (lighting / sky / camera framing) as data — the
  // loader reads it instead of hardcoding the look. See compile/sceneEnv.ts.
  ENVIRONMENT: 8,
  // Baked runtime player model: local-coordinate colored mesh groups generated
  // from the V2 figure kit. The loader instantiates these groups at the live
  // player transform; no JS figure evaluation runs in the shipped path.
  PLAYER_MODEL: 9,
  // Baked runtime animation clips for the player model. The payload is
  // content-addressed and contains declarative transform keyframes only; the
  // loader just interpolates them.
  PLAYER_ANIMATION: 10,
  // Baked regular-grid terrain heightfields. Each field is a cols×rows height
  // grid plus placement/material metadata; the loader hands it to the native
  // Scene3D heightfield primitive so gpu/3d.zig owns the triangulation.
  HEIGHTFIELDS: 11,
  // Material vocab: the looks that skin faces, shipped as RECIPES and run by
  // the host once at load — SHADERS as WGSL + data[] params, DECALS as their
  // packed DecalDoc (an optional 'DOCS' tail of this lump; the loader
  // rasterizes it — DECALRECIPE-0610). See compile/worldGeometry.ts
  // (encodeMaterials) + compile/decalPack.ts. GUIDING_LIGHT: store the
  // recipe, never the rendered product.
  MATERIALS: 12,
  // Per-instance-row material reference (u32 count | u32[count]); 1-based index
  // into MATERIALS, 0 = flat color. Parallel to INSTANCES rows — the loader
  // reads them in lockstep and renders material rows as textured faces.
  MATERIAL_REFS: 13,
  // Authored physics colliders — the SAME semantic solids the editor's play
  // view steps against (placedPieceColliders / placedPieceRamps), NOT a guess
  // re-derived from the render boxes. Carries the wall-join, door-opening,
  // half-height and ramp-trim meaning, so a "+" wall collides exactly where it
  // looks. Layout: u32 version | u32 rectCount | f32[rectCount*9] (host wire
  // order: minX,minZ,maxX,maxZ,top,solid,friction,restitution,floor) |
  // u32 orientedCount | f32[orientedCount*12] (the 9 + pivotX,pivotZ,yawRad) |
  // u32 rampCount | per ramp: f32 originX,originZ,cellSize | u32 cols,rows |
  // f32 baseY,walkCos,yawRad,pivotX,pivotZ | f32[cols*rows] heights.
  // Absent → loader falls back to deriving colliders from the instance buffer.
  COLLIDERS: 14,
  // Player physics tuning + locomotion speeds, baked so the shipped game feels
  // identical to the editor's play view instead of re-declaring constants in
  // world_loader.zig. Layout: u32 version | f32[13]: gravity, jumpSpeed,
  // playerRadius, playerHeight, stepHeight, wallRestitution, bodyRestitution,
  // walkableSidePushGrace, accelMultiplier, surfaceFriction, surfaceRestitution,
  // walkSpeed, runSpeed. Absent → loader keeps its built-in defaults.
  PHYSICS_CONFIG: 15,
  // The prop interaction layer (PROPUSE req_0624): seat/container ARCHETYPES
  // (one per prop kind — label, sit/lay pose + height, search seconds, access,
  // loot category) plus thin instance refs (archetype index + transform), so
  // the no-V8 loader carries /test's E-to-sit/search capability as data.
  // Layout: cart/hmsc-int/compile/worldInteractables.ts encodeInteractables.
  INTERACTABLES: 16,
  // Kickable dynamic props (KICKPROP req_0625): per prop a sphere-body recipe
  // (radius/restitution from the kind registry's dynamics) + its render parts
  // as LOCAL 13-float rows. The loader steps them through the host physics
  // entity section and renders them as live nodes — balls roll, cones shove.
  // Layout: cart/hmsc-int/compile/worldDynamicProps.ts encodeDynamicProps.
  DYNAMIC_PROPS: 17,
  // Elevator shafts (REQ-0652): per shaft the car footprint/thickness/speed,
  // the module footprint, and one stop level per stacked storey. The loader
  // appends a LIVE car rect per shaft to its physics buffer and rides it —
  // E to ride/call, exactly /test's elevator. Absent → no cars (the shaft
  // frames still render/collide through INSTANCES + COLLIDERS).
  // Layout: cart/hmsc-int/compile/worldElevators.ts encodeElevators.
  ELEVATORS: 18,
  // Door panels (DOORS-0611, req_0654): per interactable wall cutout
  // (door/garageDoor) the closed panel's box + reach + flags. The loader
  // appends one LIVE rect per door and renders one live panel node — E
  // toggles the two-state machine (closed blocks body+eye, open is clear),
  // /test's door. Absent → no leaves (the wall jambs still render/collide).
  // Layout: cart/hmsc-int/compile/worldDoors.ts encodeDoors.
  DOORS: 19,
  // Imported OBJ/GLB prop meshes: shared baked vertex payloads plus placed
  // transforms. Layout: cart/hmsc-int/compile/worldGeometry.ts encodeMeshProps.
  MESH_PROPS: 20,
  // Bodies of water (world/water): each a flat surface-level height grid the
  // loader renders as a translucent heightfield with a host-clock travelling
  // wave (animated ripples in the shipped game). Header carries the shared
  // look + wave; the per-body grid + skirt make a wadeable volume. Absent → no
  // water. Layout: cart/hmsc-int/compile/worldGeometry.ts encodeWaterBodies.
  WATER: 21,
  // Player-stats config (GAME_STATS): the flat, declarative tuning the stat
  // formulas read — vitals maxes/starts, energy drain/regen, the wanted decay +
  // 6 star thresholds, the carry-capacity FACTOR tables (pocket-by-pants,
  // pack-by-backpack), the xp curve, the per-skill effect coefficients and the
  // event→xp rates. Baked so the no-V8 loader seeds the SAME numbers as the
  // editor instead of re-declaring constants (GUIDING_LIGHT: store the config,
  // the engine stays dumb). Fixed layout: u32 version | f32[43]; field order in
  // cart/hmsc-int/compile/playerStats.ts encodeStatsConfig. Absent → loader
  // keeps its built-in stat defaults.
  STATS_CONFIG: 22,
  // LED ticker boards (req_0893 #3): per ticker — anchor + yaw + board dims +
  // lit color + scroll speed + the message's column bitmasks. world_loader.zig
  // scrolls + draws the lit LEDs per frame (the elevator-car pattern). Layout in
  // cart/hmsc-int/compile/worldTicker.ts encodeTickers. Absent → no tickers.
  TICKER: 23,
  // NPC population (req_0935): the figures that walk the compiled world, baked
  // as DATA the no-V8 loader renders with the player figure's own machinery.
  // NPC_MODELS = u32 version | u32 modelCount | per model: u32 groupCount |
  // groups[] (each group the SAME 68-byte header + verts(+texture) as
  // PLAYER_MODEL — see cart/hmsc-int/compile/npcModels.ts). NPCs reuse
  // PLAYER_ANIMATION unchanged (shared skeleton). Absent → no NPCs.
  NPC_MODELS: 24,
  // NPC_SPAWNS = u32 version | u32 count | per spawn: u32 modelIndex |
  // f32 x,z,yaw | u32 kind | u32 faction. The loader grounds each on the
  // terrain (no baked y) and animates it; kind/faction are reserved for the
  // Stage-2 Zig combat AI. Layout: cart/hmsc-int/compile/npcModels.ts.
  NPC_SPAWNS: 25,
  // Foliage RECIPE (FOLIAGEFORMULA, req_1588/1591): grass/bush cover is a pure
  // deterministic formula, so instead of baking ~1M expanded blade rows into
  // INSTANCES (56MB of a 70MB file — 99.4% of the instances) we ship only the
  // FACTORS — the painted foliage CELLS — and the loader expands blades at load
  // via framework/world/foliage.zig (the bit-exact twin of grassPopulation.ts).
  // Layout: u32 version | f32 cellSizeMeters | u32 cellCount | per cell:
  // u32 cellKey | f32 wx | f32 wz | f32 top | u16 specId(0=grass,1=bush) | u16
  // count(blades). Absent → no recipe foliage (legacy bakes still ship blades in
  // INSTANCES). See cart/hmsc-int/compile/worldGeometry.ts encodeFlora.
  FLORA: 26,
  // Per-instance-row WALL flag (u32 count | u8[count]); 1 = the row is a wall
  // piece (catalog kind 'wall'), 0 = anything else. Parallel to INSTANCES rows
  // (req_2053). Lets the editor's build pane hide walls so you can edit a
  // building's interior — world_loader.zig collapses the flagged rows live when
  // the editor toggles __compiled_world_set_hide_walls (no rebake). Absent → no
  // row is a wall (the toggle then hides nothing). See worldGeometry.ts
  // encodeWallFlags.
  WALL_FLAGS: 27,
  // Ambient road traffic (req_2056): per vehicle — a buildVehicle prototype
  // (instance rows in local space: pos3/rot3/scale3/color3/shape) + a looping
  // route polyline + cruise speed + phase. world_loader.zig samples each route
  // per frame (arc-length mod loop length) and rebuilds the vehicle's instance
  // rows at the pose — the LED-ticker mutable-instance pattern. Routes are baked
  // by flow-following the lane tiles (no host A*). Layout:
  // cart/hmsc-int/compile/worldTraffic.ts encodeTraffic. Absent → no traffic.
  TRAFFIC: 28
};
var ENCODING_BY_ID = {
  [LUMP_ENCODING.raw]: "raw",
  [LUMP_ENCODING.rle8]: "rle8",
  [LUMP_ENCODING.rle16]: "rle16",
  [LUMP_ENCODING.text]: "text"
};
function bytesText(bytes) {
  const decoder = globalThis.TextDecoder;
  if (typeof decoder === "function") return new decoder().decode(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return decodeURIComponent(escape(binary));
}
function encodingName(id) {
  const encoding = ENCODING_BY_ID[id];
  if (!encoding) throw new Error(`unknown lump encoding id ${id}`);
  return encoding;
}
function readLumpContainer(bytes, opts = {}) {
  if (bytes.byteLength < LUMP_HEADER_BYTES) throw new Error("mapfile too small");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== LUMP_MAGIC) throw new Error("bad mapfile magic");
  const version = view.getUint16(4, true);
  if (version !== LUMP_FORMAT_VERSION) throw new Error(`unsupported mapfile version ${version}`);
  const count = view.getUint32(8, true);
  const dirOffset = view.getUint32(12, true);
  const dirEnd = dirOffset + count * LUMP_DIRECTORY_ENTRY_BYTES;
  if (dirEnd > bytes.byteLength) throw new Error("lump directory extends past file");
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const at = dirOffset + i * LUMP_DIRECTORY_ENTRY_BYTES;
    const type = view.getUint32(at + 0, true);
    const encoding = encodingName(view.getUint16(at + 4, true));
    const offset = view.getUint32(at + 8, true);
    const length = view.getUint32(at + 12, true);
    const decodedLength = view.getUint32(at + 16, true);
    if (offset + length > bytes.byteLength) throw new Error(`lump ${type} extends past file`);
    if (opts.knownTypes && !opts.knownTypes.has(type)) continue;
    records.push({
      type,
      encoding,
      offset,
      length,
      decodedLength,
      data: bytes.slice(offset, offset + length)
    });
  }
  return records;
}
function findLump(records, type) {
  return records.find((record) => record.type === type) ?? null;
}

// cart/hmsc-int/editors/play/tsLoader/decode.ts
var INSTANCE_STRIDE = 13;
var MATERIALS_DOC_TAIL_MAGIC = 1396920132;
var GAME_LUMP = {
  STREAM_LOGIC: 16,
  STREAM_MAP: 17,
  STREAM_SKINS: 18,
  ASSET_MANIFEST: 19,
  ASSET_BLOB: 20
};
function dvOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function decodeGameStream(bytes) {
  if (bytes.byteLength < 8) throw new Error("game stream too small");
  const view = dvOf(bytes);
  const refCount = view.getUint32(0, true);
  const refsEnd = 4 + refCount * 4;
  if (refsEnd + 4 > bytes.byteLength) throw new Error("game stream refs truncated");
  const refs = new Uint32Array(refCount);
  for (let i = 0; i < refCount; i += 1) refs[i] = view.getUint32(4 + i * 4, true);
  const dataLen = view.getUint32(refsEnd, true);
  const dataStart = refsEnd + 4;
  if (dataStart + dataLen > bytes.byteLength) throw new Error("game stream data truncated");
  return { refs, data: bytes.slice(dataStart, dataStart + dataLen) };
}
function loadGameFileStreams(bytes) {
  const records = readLumpContainer(bytes, { knownTypes: new Set(Object.values(GAME_LUMP)) });
  const lump = (type) => {
    const found = findLump(records, type);
    if (!found) throw new Error(`gamefile missing lump ${type}`);
    return found;
  };
  return {
    logic: decodeGameStream(lump(GAME_LUMP.STREAM_LOGIC).data),
    map: decodeGameStream(lump(GAME_LUMP.STREAM_MAP).data),
    skins: decodeGameStream(lump(GAME_LUMP.STREAM_SKINS).data)
  };
}
function decodeInstances(bytes) {
  if (bytes.byteLength < 12) return { instances: new Float32Array(0), count: 0, stride: INSTANCE_STRIDE, pieces: 0 };
  const view = dvOf(bytes);
  const count = view.getUint32(0, true);
  const stride = view.getUint32(4, true) || INSTANCE_STRIDE;
  const pieces = view.getUint32(8, true);
  const floats = count * stride;
  const instances = new Float32Array(floats);
  for (let i = 0; i < floats; i += 1) instances[i] = view.getFloat32(12 + i * 4, true);
  return { instances, count, stride, pieces };
}
function decodeMaterialRefs(bytes) {
  if (bytes.byteLength < 4) return new Uint32Array(0);
  const view = dvOf(bytes);
  const count = view.getUint32(0, true);
  const refs = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) refs[i] = view.getUint32(4 + i * 4, true);
  return refs;
}
function decodeMaterials(bytes) {
  if (bytes.byteLength < 4) return [];
  const view = dvOf(bytes);
  const count = view.getUint32(0, true);
  const materials = [];
  let at = 4;
  for (let i = 0; i < count; i += 1) {
    const wgslLen = view.getUint32(at, true);
    at += 4;
    const wgsl = wgslLen > 0 ? bytesText(bytes.subarray(at, at + wgslLen)) : "";
    at += wgslLen;
    const dataLen = view.getUint32(at, true);
    at += 4;
    const data = new Float32Array(dataLen);
    for (let k = 0; k < dataLen; k += 1) {
      data[k] = view.getFloat32(at, true);
      at += 4;
    }
    const opacity = view.getFloat32(at, true);
    at += 4;
    materials.push({ wgsl, data, opacity, doc: null });
  }
  if (at + 8 <= bytes.byteLength && view.getUint32(at, true) === MATERIALS_DOC_TAIL_MAGIC) {
    at += 4;
    const entryCount = view.getUint32(at, true);
    at += 4;
    for (let e = 0; e < entryCount; e += 1) {
      const materialIndex = view.getUint32(at, true);
      at += 4;
      const docLen = view.getUint32(at, true);
      at += 4;
      const doc = bytes.slice(at, at + docLen);
      at += docLen;
      const mat = materials[materialIndex];
      if (mat) mat.doc = doc;
    }
  }
  return materials;
}
var RECT_FLOATS = 9;
var ORIENTED_FLOATS = 12;
function decodeColliders(bytes) {
  const view = dvOf(bytes);
  let at = 0;
  at += 4;
  const rectCount = view.getUint32(at, true);
  at += 4;
  const rects = new Float32Array(rectCount * RECT_FLOATS);
  for (let i = 0; i < rects.length; i += 1) {
    rects[i] = view.getFloat32(at, true);
    at += 4;
  }
  const orientedCount = view.getUint32(at, true);
  at += 4;
  const oriented = new Float32Array(orientedCount * ORIENTED_FLOATS);
  for (let i = 0; i < oriented.length; i += 1) {
    oriented[i] = view.getFloat32(at, true);
    at += 4;
  }
  const rampCount = view.getUint32(at, true);
  at += 4;
  const ramps = [];
  for (let r = 0; r < rampCount; r += 1) {
    const originX = view.getFloat32(at, true);
    at += 4;
    const originZ = view.getFloat32(at, true);
    at += 4;
    const cellSizeMeters = view.getFloat32(at, true);
    at += 4;
    const cols = view.getUint32(at, true);
    at += 4;
    const rows = view.getUint32(at, true);
    at += 4;
    const baseY = view.getFloat32(at, true);
    at += 4;
    const walkableSlopeCos = view.getFloat32(at, true);
    at += 4;
    const yawRadians = view.getFloat32(at, true);
    at += 4;
    const pivotX = view.getFloat32(at, true);
    at += 4;
    const pivotZ = view.getFloat32(at, true);
    at += 4;
    const heights = new Float32Array(cols * rows);
    for (let i = 0; i < heights.length; i += 1) {
      heights[i] = view.getFloat32(at, true);
      at += 4;
    }
    ramps.push({ slot: r, originX, originZ, cellSizeMeters, cols, rows, baseY, walkableSlopeCos, heights, yawRadians, pivotX, pivotZ });
  }
  return { rects, oriented, ramps };
}
function decodePhysicsConfig(bytes) {
  if (bytes.byteLength < 4 + 13 * 4) return null;
  const view = dvOf(bytes);
  const f = (i) => view.getFloat32(4 + i * 4, true);
  return {
    gravity: f(0),
    jumpSpeed: f(1),
    playerRadius: f(2),
    playerHeight: f(3),
    stepHeight: f(4),
    wallRestitution: f(5),
    bodyRestitution: f(6),
    walkableSidePushGrace: f(7),
    accelerationMultiplier: f(8),
    surfaceFriction: f(9),
    surfaceRestitution: f(10),
    walkSpeed: f(11),
    runSpeed: f(12)
  };
}
var HEIGHTFIELD_RECORD_FLOATS = 10;
function decodeHeightfields(bytes) {
  if (bytes.byteLength < 12) return [];
  const view = dvOf(bytes);
  const fieldCount = view.getUint32(4, true);
  const formulaLen = view.getUint32(8, true);
  let at = 12 + formulaLen;
  const fields = [];
  const WALKABLE_SLOPE_COS = Math.cos(38 * Math.PI / 180);
  for (let fi = 0; fi < fieldCount; fi += 1) {
    const cols = view.getUint32(at, true);
    at += 4;
    const rows = view.getUint32(at, true);
    at += 4;
    const groundDataLen = view.getUint32(at, true);
    at += 4;
    at += 4;
    const rec = [];
    for (let i = 0; i < HEIGHTFIELD_RECORD_FLOATS; i += 1) {
      rec.push(view.getFloat32(at, true));
      at += 4;
    }
    const [centerX, centerZ, , width, depth, cell] = rec;
    const heights = new Float32Array(cols * rows);
    for (let i = 0; i < heights.length; i += 1) {
      heights[i] = view.getFloat32(at, true);
      at += 4;
    }
    at += groundDataLen * 4;
    fields.push({
      slot: fi,
      // The record stores the field CENTER + extents; collision/render want the
      // min corner as origin (the chunk's lower-left), matching ChunkFloor fields.
      originX: centerX - width / 2,
      originZ: centerZ - depth / 2,
      cellSizeMeters: cell,
      cols,
      rows,
      baseY: 0,
      walkableSlopeCos: WALKABLE_SLOPE_COS,
      heights,
      yawRadians: 0,
      pivotX: centerX - width / 2,
      pivotZ: centerZ - depth / 2
    });
  }
  return fields;
}
function decodeFlora(bytes) {
  if (bytes.byteLength < 12) return null;
  const view = dvOf(bytes);
  const cellSizeMeters = view.getFloat32(4, true);
  const cellCount = view.getUint32(8, true);
  const cells = [];
  let at = 12;
  for (let i = 0; i < cellCount; i += 1) {
    const cellKey = view.getUint32(at, true);
    at += 4;
    const wx = view.getFloat32(at, true);
    at += 4;
    const wz = view.getFloat32(at, true);
    at += 4;
    const top = view.getFloat32(at, true);
    at += 4;
    const specId = view.getUint16(at, true);
    at += 2;
    const count = view.getUint16(at, true);
    at += 2;
    cells.push({ cellKey, wx, wz, top, specId, count });
  }
  return { cellSizeMeters, cells };
}
var SCENE_ENV_VERSION = 1;
var SCENE_ENV_FLOATS = 35;
function decodeEnvironment(bytes) {
  if (bytes.byteLength < 4 + SCENE_ENV_FLOATS * 4) return null;
  const view = dvOf(bytes);
  if (view.getUint32(0, true) !== SCENE_ENV_VERSION) return null;
  const f = [];
  for (let i = 0; i < SCENE_ENV_FLOATS; i += 1) f.push(view.getFloat32(4 + i * 4, true));
  return {
    ambientColor: [f[0], f[1], f[2]],
    ambientIntensity: f[3],
    dir: [f[4], f[5], f[6]],
    dirColor: [f[7], f[8], f[9]],
    dirIntensity: f[10],
    skyZenith: [f[11], f[12], f[13]],
    skyHorizon: [f[14], f[15], f[16]],
    skyGround: [f[17], f[18], f[19]],
    skySunDir: [f[20], f[21], f[22]],
    skySunColor: [f[23], f[24], f[25]],
    skyHaze: f[26],
    skyCloud: f[27],
    skyNight: f[28],
    camFov: f[29],
    camHorizFactor: f[30],
    camHorizBase: f[31],
    camHeightFactor: f[32],
    camHeightBase: f[33],
    camFarFactor: f[34]
  };
}
function loadSceneFromMapContainer(bytes) {
  const records = readLumpContainer(bytes, { knownTypes: new Set(Object.values(MAP_LUMP)) });
  const lump = (type) => findLump(records, type);
  const inst = lump(MAP_LUMP.INSTANCES);
  const decodedInst = inst ? decodeInstances(inst.data) : { instances: new Float32Array(0), count: 0, stride: INSTANCE_STRIDE, pieces: 0 };
  const materialsLump = lump(MAP_LUMP.MATERIALS);
  const materialRefsLump = lump(MAP_LUMP.MATERIAL_REFS);
  const collidersLump = lump(MAP_LUMP.COLLIDERS);
  const physicsLump = lump(MAP_LUMP.PHYSICS_CONFIG);
  const heightfieldsLump = lump(MAP_LUMP.HEIGHTFIELDS);
  const floraLump = lump(MAP_LUMP.FLORA);
  const envLump = lump(MAP_LUMP.ENVIRONMENT);
  return {
    instances: decodedInst.instances,
    instanceCount: decodedInst.count,
    instanceStride: decodedInst.stride,
    pieceCount: decodedInst.pieces,
    materials: materialsLump ? decodeMaterials(materialsLump.data) : [],
    materialRefs: materialRefsLump ? decodeMaterialRefs(materialRefsLump.data) : new Uint32Array(0),
    heightfields: heightfieldsLump ? decodeHeightfields(heightfieldsLump.data) : [],
    colliders: collidersLump ? decodeColliders(collidersLump.data) : null,
    physicsConfig: physicsLump ? decodePhysicsConfig(physicsLump.data) : null,
    flora: floraLump ? decodeFlora(floraLump.data) : null,
    environment: envLump ? decodeEnvironment(envLump.data) : null
  };
}
function loadSceneFromGameFile(bytes) {
  return loadSceneFromMapContainer(loadGameFileStreams(bytes).map.data);
}

// cart/hmsc-int/editors/play/threeLoader/load.ts
var INSTANCE_FLOATS = 12;
var DEG_TO_RAD = Math.PI / 180;
var SHAPE = {
  BOX: 0,
  RAMP: 1,
  CYLINDER8: 2,
  CYLINDER16: 3,
  SPHERE: 4,
  GABLE: 5,
  GRASS: 6,
  BUSH: 7,
  FROND: 8,
  PALMTRUNK: 9,
  FLOWER: 10,
  SCENERY_BOX: 11,
  CORNER_MITER: 12,
  CORNER_MITER_MIRROR: 13,
  BOX_OPEN_RUN_MIN: 14,
  BOX_OPEN_RUN_MAX: 15,
  BOX_OPEN_RUN_BOTH: 16
};
var SHAPE_LABEL = {
  [SHAPE.BOX]: "box",
  [SHAPE.RAMP]: "ramp",
  [SHAPE.CYLINDER8]: "cylinder8",
  [SHAPE.CYLINDER16]: "cylinder16",
  [SHAPE.SPHERE]: "sphere",
  [SHAPE.GABLE]: "gable",
  [SHAPE.GRASS]: "grass",
  [SHAPE.BUSH]: "bush",
  [SHAPE.FROND]: "frond",
  [SHAPE.PALMTRUNK]: "palmtrunk",
  [SHAPE.FLOWER]: "flower",
  [SHAPE.SCENERY_BOX]: "scenery-box",
  [SHAPE.CORNER_MITER]: "corner-miter",
  [SHAPE.CORNER_MITER_MIRROR]: "corner-miter-mirror",
  [SHAPE.BOX_OPEN_RUN_MIN]: "open-run-min",
  [SHAPE.BOX_OPEN_RUN_MAX]: "open-run-max",
  [SHAPE.BOX_OPEN_RUN_BOTH]: "open-run-both"
};
function shapeLabel(shapeId) {
  return SHAPE_LABEL[shapeId] ?? `shape-${shapeId}`;
}
function attr(THREE2, values, itemSize) {
  const Ctor = THREE2.Float32BufferAttribute ?? THREE2.BufferAttribute;
  if (!Ctor) throw new Error("THREE.Float32BufferAttribute or THREE.BufferAttribute is required");
  return new Ctor(values, itemSize);
}
function setPositions(THREE2, geometry, values) {
  geometry.setAttribute?.("position", attr(THREE2, new Float32Array(values), 3));
}
function setIndices(geometry, values) {
  geometry.setIndex?.(values);
}
function computeNormals(geometry) {
  geometry.computeVertexNormals?.();
}
function boxGeometry(THREE2) {
  return THREE2.BoxGeometry ? new THREE2.BoxGeometry(1, 1, 1) : rampGeometry(THREE2);
}
function rampGeometry(THREE2) {
  const g = new THREE2.BufferGeometry();
  setPositions(THREE2, g, [
    -0.5,
    -0.5,
    -0.5,
    0.5,
    -0.5,
    -0.5,
    -0.5,
    -0.5,
    0.5,
    0.5,
    -0.5,
    0.5,
    -0.5,
    0.5,
    0.5,
    0.5,
    0.5,
    0.5
  ]);
  setIndices(g, [
    0,
    2,
    3,
    0,
    3,
    1,
    // bottom
    2,
    4,
    5,
    2,
    5,
    3,
    // tall end
    0,
    1,
    5,
    0,
    5,
    4,
    // slope
    0,
    4,
    2,
    // left side
    1,
    3,
    5
    // right side
  ]);
  computeNormals(g);
  return g;
}
function planeGeometry(THREE2) {
  if (THREE2.PlaneGeometry) return new THREE2.PlaneGeometry(1, 1);
  return boxGeometry(THREE2);
}
function geometryForShape(THREE2, shapeId) {
  switch (shapeId) {
    case SHAPE.BOX:
    case SHAPE.SCENERY_BOX:
      return { geometry: boxGeometry(THREE2), approximate: false };
    case SHAPE.RAMP:
      return { geometry: rampGeometry(THREE2), approximate: false };
    case SHAPE.CYLINDER8:
      return { geometry: THREE2.CylinderGeometry ? new THREE2.CylinderGeometry(0.5, 0.5, 1, 8) : boxGeometry(THREE2), approximate: !THREE2.CylinderGeometry };
    case SHAPE.CYLINDER16:
      return { geometry: THREE2.CylinderGeometry ? new THREE2.CylinderGeometry(0.5, 0.5, 1, 16) : boxGeometry(THREE2), approximate: !THREE2.CylinderGeometry };
    case SHAPE.SPHERE:
      return { geometry: THREE2.SphereGeometry ? new THREE2.SphereGeometry(0.5, 16, 12) : boxGeometry(THREE2), approximate: !THREE2.SphereGeometry };
    case SHAPE.GRASS:
    case SHAPE.FLOWER:
    case SHAPE.FROND:
      return { geometry: planeGeometry(THREE2), approximate: !THREE2.PlaneGeometry };
    case SHAPE.BUSH:
      return { geometry: THREE2.SphereGeometry ? new THREE2.SphereGeometry(0.5, 8, 6) : boxGeometry(THREE2), approximate: !THREE2.SphereGeometry };
    case SHAPE.PALMTRUNK:
      return { geometry: THREE2.CylinderGeometry ? new THREE2.CylinderGeometry(0.35, 0.5, 1, 9) : boxGeometry(THREE2), approximate: !THREE2.CylinderGeometry };
    case SHAPE.GABLE:
    case SHAPE.CORNER_MITER:
    case SHAPE.CORNER_MITER_MIRROR:
    case SHAPE.BOX_OPEN_RUN_MIN:
    case SHAPE.BOX_OPEN_RUN_MAX:
    case SHAPE.BOX_OPEN_RUN_BOTH:
      return { geometry: boxGeometry(THREE2), approximate: true };
    default:
      return null;
  }
}
function materialForBucket(THREE2, scene2, materialRef, side) {
  const recipe = materialRef > 0 ? scene2.materials[materialRef - 1] : null;
  const opacity = recipe ? Math.max(0, Math.min(1, recipe.opacity)) : 1;
  const params = {
    color: 16777215,
    vertexColors: true,
    transparent: opacity < 1,
    opacity,
    side
  };
  const Material = THREE2.MeshStandardMaterial ?? THREE2.MeshBasicMaterial;
  if (!Material) throw new Error("THREE.MeshStandardMaterial or THREE.MeshBasicMaterial is required");
  return new Material(params);
}
function setInstanceTransform(THREE2, mesh, slot, insts, base) {
  const position = new THREE2.Vector3(insts[base + 0] ?? 0, insts[base + 1] ?? 0, insts[base + 2] ?? 0);
  const euler = new THREE2.Euler(
    (insts[base + 3] ?? 0) * DEG_TO_RAD,
    (insts[base + 4] ?? 0) * DEG_TO_RAD,
    (insts[base + 5] ?? 0) * DEG_TO_RAD,
    "XYZ"
  );
  const quaternion = new THREE2.Quaternion();
  quaternion.setFromEuler?.(euler);
  const scale = new THREE2.Vector3(insts[base + 6] ?? 1, insts[base + 7] ?? 1, insts[base + 8] ?? 1);
  const matrix = new THREE2.Matrix4();
  matrix.compose?.(position, quaternion, scale);
  mesh.setMatrixAt?.(slot, matrix);
}
function setInstanceColor(THREE2, mesh, slot, insts, base) {
  if (typeof mesh.setColorAt !== "function") return;
  const color = new THREE2.Color();
  color.setRGB?.(
    Math.max(0, Math.min(1, insts[base + 9] ?? 1)),
    Math.max(0, Math.min(1, insts[base + 10] ?? 1)),
    Math.max(0, Math.min(1, insts[base + 11] ?? 1))
  );
  mesh.setColorAt(slot, color);
}
function bucketRows(scene2, limit) {
  const stride = scene2.instanceStride || INSTANCE_FLOATS;
  const count = Math.min(scene2.instanceCount, limit);
  const groups = /* @__PURE__ */ new Map();
  let skipped = Math.max(0, scene2.instanceCount - count);
  for (let index = 0; index < count; index += 1) {
    const base = index * stride;
    const shapeId = stride > INSTANCE_FLOATS ? (scene2.instances[base + 12] ?? 0) | 0 : SHAPE.BOX;
    const planRef = scene2.materialRefs[index] ?? 0;
    const key = `${shapeId}:${planRef}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { shapeId, materialRef: planRef, rows: [] };
      groups.set(key, bucket);
    }
    bucket.rows.push({ index, base, shapeId, materialRef: planRef });
  }
  return { buckets: [...groups.values()], skipped };
}
function heightfieldGeometry(THREE2, field) {
  const g = new THREE2.BufferGeometry();
  const positions = [];
  const indices = [];
  const yaw2 = field.yawRadians ?? 0;
  const c = Math.cos(yaw2);
  const s = Math.sin(yaw2);
  const pivotX = field.pivotX ?? field.originX;
  const pivotZ = field.pivotZ ?? field.originZ;
  for (let z = 0; z < field.rows; z += 1) {
    for (let x = 0; x < field.cols; x += 1) {
      const wx = field.originX + x * field.cellSizeMeters;
      const wz = field.originZ + z * field.cellSizeMeters;
      const dx = wx - pivotX;
      const dz = wz - pivotZ;
      const rx = pivotX + dx * c + dz * s;
      const rz = pivotZ - dx * s + dz * c;
      const h = field.heights[z * field.cols + x] ?? 0;
      positions.push(rx, field.baseY + h, rz);
    }
  }
  for (let z = 0; z < field.rows - 1; z += 1) {
    for (let x = 0; x < field.cols - 1; x += 1) {
      const a = z * field.cols + x;
      const b = a + 1;
      const c0 = a + field.cols;
      const d = c0 + 1;
      indices.push(a, c0, b, b, c0, d);
    }
  }
  setPositions(THREE2, g, positions);
  setIndices(g, indices);
  computeNormals(g);
  return g;
}
function buildHmscThreeScene(THREE2, scene2, opts = {}) {
  const group = new THREE2.Group();
  group.name = opts.name ?? "hmsc-compiled-world";
  const notes = [];
  const includeHeightfields = opts.includeHeightfields ?? true;
  const limit = opts.instanceLimit ?? scene2.instanceCount;
  const grouped = bucketRows(scene2, limit);
  const buckets = grouped.buckets;
  let skipped = grouped.skipped;
  let renderedInstances = 0;
  let instancedMeshes = 0;
  for (const bucket of buckets) {
    const plan = geometryForShape(THREE2, bucket.shapeId);
    if (!plan) {
      skipped += bucket.rows.length;
      notes.push(`${bucket.rows.length} ${shapeLabel(bucket.shapeId)} row(s) skipped: no Three geometry plan`);
      continue;
    }
    if (plan.approximate) {
      notes.push(`${bucket.rows.length} ${shapeLabel(bucket.shapeId)} row(s) drawn with an approximate Three primitive`);
    }
    const material = materialForBucket(THREE2, scene2, bucket.materialRef, THREE2.DoubleSide);
    const mesh = new THREE2.InstancedMesh(plan.geometry, material, bucket.rows.length);
    mesh.name = `hmsc:${shapeLabel(bucket.shapeId)}:${bucket.materialRef}`;
    mesh.userData = {
      ...mesh.userData ?? {},
      hmscShapeId: bucket.shapeId,
      hmscMaterialRef: bucket.materialRef,
      hmscRows: bucket.rows.map((row) => row.index)
    };
    for (let i = 0; i < bucket.rows.length; i += 1) {
      const row = bucket.rows[i];
      setInstanceTransform(THREE2, mesh, i, scene2.instances, row.base);
      setInstanceColor(THREE2, mesh, i, scene2.instances, row.base);
    }
    if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    renderedInstances += bucket.rows.length;
    instancedMeshes += 1;
  }
  let heightfieldCount = 0;
  if (includeHeightfields) {
    for (const field of scene2.heightfields) {
      const material = new (THREE2.MeshStandardMaterial ?? THREE2.MeshBasicMaterial)({
        color: opts.terrainColor ?? "#3a4a3e",
        side: THREE2.DoubleSide
      });
      const mesh = new THREE2.Mesh(heightfieldGeometry(THREE2, field), material);
      mesh.name = `hmsc:heightfield:${field.slot}`;
      mesh.userData = {
        ...mesh.userData ?? {},
        hmscHeightfieldSlot: field.slot,
        hmscCols: field.cols,
        hmscRows: field.rows
      };
      group.add(mesh);
      heightfieldCount += 1;
    }
  }
  const stats = {
    instances: scene2.instanceCount,
    renderedInstances,
    instancedMeshes,
    heightfields: heightfieldCount,
    skippedInstances: skipped
  };
  group.userData = {
    ...group.userData ?? {},
    hmscCompiledScene: {
      stats,
      notes,
      pieceCount: scene2.pieceCount,
      materialCount: scene2.materials.length,
      colliderRects: scene2.colliders ? scene2.colliders.rects.length / 9 : 0,
      colliderOriented: scene2.colliders ? scene2.colliders.oriented.length / 12 : 0,
      physicsConfig: scene2.physicsConfig,
      flora: scene2.flora,
      environment: scene2.environment
    }
  };
  return { group, scene: scene2, stats, notes };
}
function loadHmscThreeFromMapContainer(THREE2, bytes, opts = {}) {
  return buildHmscThreeScene(THREE2, loadSceneFromMapContainer(bytes), opts);
}
function loadHmscThreeFromGameFile(THREE2, bytes, opts = {}) {
  return buildHmscThreeScene(THREE2, loadSceneFromGameFile(bytes), opts);
}

// cart/hmsc-int/editors/play/threeLoader/demo.ts
var canvas = document.querySelector("#view");
var statusEl = document.querySelector("#status");
var notesEl = document.querySelector("#notes");
var pathInput = document.querySelector("#path");
var loadButton = document.querySelector("#load");
var fileInput = document.querySelector("#file");
var modeSelect = document.querySelector("#mode");
var statsEl = document.querySelector("#stats");
if (!canvas || !statusEl || !notesEl || !pathInput || !loadButton || !fileInput || !modeSelect || !statsEl) {
  throw new Error("threeLoader demo markup is incomplete");
}
var renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(593170, 1);
var scene = new THREE.Scene();
scene.fog = new THREE.Fog(593170, 300, 1800);
var camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6e3);
var ambient = new THREE.AmbientLight(16777215, 0.65);
var sun = new THREE.DirectionalLight(16777215, 1.35);
sun.position.set(120, 180, 80);
scene.add(ambient, sun);
var grid = new THREE.GridHelper(400, 40, 3756387, 1713456);
grid.position.y = -0.02;
scene.add(grid);
var loadedGroup = null;
var target = new THREE.Vector3(0, 0, 0);
var yaw = -0.75;
var pitch = -0.45;
var distance = 180;
var pointer = null;
function setStatus(text) {
  statusEl.textContent = text;
}
function setNotes(notes) {
  notesEl.textContent = notes.length ? notes.join("\n") : "";
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
function updateCamera() {
  const cp = Math.cos(pitch);
  camera.position.set(
    target.x + Math.sin(yaw) * cp * distance,
    target.y + Math.sin(-pitch) * distance + 24,
    target.z + Math.cos(yaw) * cp * distance
  );
  camera.lookAt(target);
}
function frameLoadedGroup(group) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) {
    target.set(0, 0, 0);
    distance = 160;
    return;
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(target);
  const maxAxis = Math.max(size.x, size.y, size.z, 20);
  distance = Math.max(80, Math.min(2400, maxAxis * 0.9));
}
function mount(group) {
  if (loadedGroup) scene.remove(loadedGroup);
  loadedGroup = group;
  scene.add(group);
  frameLoadedGroup(group);
  updateCamera();
}
function applyEnvironment(group) {
  const env = group.userData?.hmscCompiledScene?.environment;
  if (!env) return;
  ambient.color.setRGB(env.ambientColor[0], env.ambientColor[1], env.ambientColor[2]);
  ambient.intensity = env.ambientIntensity;
  sun.color.setRGB(env.dirColor[0], env.dirColor[1], env.dirColor[2]);
  sun.intensity = env.dirIntensity;
  sun.position.set(env.dir[0], env.dir[1], env.dir[2]).normalize().multiplyScalar(160);
  if (env.camFov > 10) {
    camera.fov = env.camFov;
    camera.updateProjectionMatrix();
  }
}
async function loadBytes(bytes, mode, label) {
  const t0 = performance.now();
  const result = mode === "map" ? loadHmscThreeFromMapContainer(THREE, bytes, { name: label }) : loadHmscThreeFromGameFile(THREE, bytes, { name: label });
  const elapsed = performance.now() - t0;
  mount(result.group);
  applyEnvironment(result.group);
  const s = result.stats;
  statsEl.textContent = [
    `${s.renderedInstances.toLocaleString()} / ${s.instances.toLocaleString()} instances`,
    `${s.instancedMeshes} Three instanced mesh batches`,
    `${s.heightfields} heightfields`,
    `${s.skippedInstances} skipped`,
    `${elapsed.toFixed(1)}ms load`
  ].join(" | ");
  setNotes(result.notes);
  setStatus(`loaded ${label}`);
}
async function loadPath() {
  const path = pathInput.value.trim();
  if (!path) return;
  setStatus(`loading ${path}`);
  setNotes([]);
  statsEl.textContent = "";
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await loadBytes(bytes, modeSelect.value, path);
}
loadButton.addEventListener("click", () => {
  loadPath().catch((error) => {
    setStatus(`load failed: ${error?.message ?? String(error)}`);
  });
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  setStatus(`loading ${file.name}`);
  file.arrayBuffer().then((buffer) => loadBytes(new Uint8Array(buffer), modeSelect.value, file.name)).catch((error) => setStatus(`load failed: ${error?.message ?? String(error)}`));
});
canvas.addEventListener("pointerdown", (event) => {
  pointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointer) return;
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  pointer = { x: event.clientX, y: event.clientY };
  yaw -= dx * 6e-3;
  pitch = Math.max(-1.25, Math.min(0.05, pitch - dy * 4e-3));
  updateCamera();
});
canvas.addEventListener("pointerup", () => {
  pointer = null;
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  distance = Math.max(20, Math.min(6e3, distance * (event.deltaY > 0 ? 1.12 : 0.88)));
  updateCamera();
}, { passive: false });
window.addEventListener("resize", () => {
  resize();
  updateCamera();
});
resize();
updateCamera();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
loadPath().catch((error) => {
  setStatus(`waiting for gamefile: ${error?.message ?? String(error)}`);
});
