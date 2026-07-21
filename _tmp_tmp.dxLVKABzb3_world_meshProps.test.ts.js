(() => {
  // cart/editor/world/meshProps.ts
  function meshKeyHash(key) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i += 1) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function boundsOf(v) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i + 2 < v.length; i += 8) {
      const x = v[i], y = v[i + 1], z = v[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) return { radius: 1, w: 1, d: 1, h: 1 };
    const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
    return { radius: Math.max(w, h, d) * 0.5 || 1, w: w || 1, d: d || 1, h: h || 1 };
  }
  var MESH_PROPS_VERSION = 7;
  function encodeResidentMeshes(meshes) {
    let total = 12;
    for (const m of meshes) {
      const slots = m.slots ?? [];
      const boxes = m.collisionBoxes ?? [];
      const vertexCount = m.vertices.length / 8;
      if (!Number.isInteger(vertexCount)) throw new Error(`resident mesh '${m.key}' is not stride-8 geometry`);
      for (const slot of slots) {
        if (!Number.isInteger(slot.start) || !Number.isInteger(slot.count) || slot.start < 0 || slot.count < 0 || slot.start + slot.count > vertexCount) {
          throw new Error(`resident mesh '${m.key}' has a slot outside its ${vertexCount} vertices`);
        }
      }
      if (m.door && (m.door.leafSlot < 0 || m.door.leafSlot >= slots.length)) {
        throw new Error(`resident door '${m.key}' leaf slot ${m.door.leafSlot} is outside ${slots.length} slot(s)`);
      }
      for (const box of boxes) {
        const values = [box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ];
        if (!values.every(Number.isFinite) || box.maxX <= box.minX || box.maxY <= box.minY || box.maxZ <= box.minZ) {
          throw new Error(`resident mesh '${m.key}' has an invalid authored collision box`);
        }
      }
      const keyBytes = m.key.length;
      total += 4 + keyBytes;
      total += 36;
      total += m.vertices.length * 4;
      total += 4 + (m.png?.length ?? 0);
      total += 4 + slots.length * 8;
      total += 4 + (m.door ? 16 : 0);
      total += 4 + boxes.length * 24;
    }
    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);
    dv.setUint32(0, MESH_PROPS_VERSION, true);
    dv.setUint32(4, meshes.length, true);
    dv.setUint32(8, 0, true);
    let o = 12;
    for (const m of meshes) {
      dv.setUint32(o, m.key.length, true);
      o += 4;
      for (let i = 0; i < m.key.length; i += 1) bytes[o + i] = m.key.charCodeAt(i) & 255;
      o += m.key.length;
      const b = boundsOf(m.vertices);
      const col = m.color ?? [0.72, 0.74, 0.78];
      const vertexCount = Math.floor(m.vertices.length / 8);
      dv.setFloat32(o, col[0], true);
      dv.setFloat32(o + 4, col[1], true);
      dv.setFloat32(o + 8, col[2], true);
      dv.setFloat32(o + 12, b.radius, true);
      dv.setFloat32(o + 16, b.w, true);
      dv.setFloat32(o + 20, b.d, true);
      dv.setFloat32(o + 24, b.h, true);
      dv.setUint32(o + 28, 1, true);
      dv.setUint32(o + 32, vertexCount, true);
      o += 36;
      for (let i = 0; i < m.vertices.length; i += 1) {
        dv.setFloat32(o, m.vertices[i], true);
        o += 4;
      }
      dv.setUint32(o, m.png?.length ?? 0, true);
      o += 4;
      if (m.png && m.png.length > 0) {
        bytes.set(m.png, o);
        o += m.png.length;
      }
      const slots = m.slots ?? [];
      dv.setUint32(o, slots.length, true);
      o += 4;
      for (const slot of slots) {
        dv.setUint32(o, slot.start, true);
        dv.setUint32(o + 4, slot.count, true);
        o += 8;
      }
      dv.setUint32(o, m.door ? 1 : 0, true);
      o += 4;
      if (m.door) {
        dv.setUint32(o, m.door.leafSlot, true);
        dv.setFloat32(o + 4, m.door.reachMeters, true);
        dv.setUint32(o + 8, m.door.vehicle ? 1 : 0, true);
        dv.setUint32(o + 12, m.door.startOpen ? 1 : 0, true);
        o += 16;
      }
      const boxes = m.collisionBoxes ?? [];
      dv.setUint32(o, boxes.length, true);
      o += 4;
      for (const box of boxes) {
        dv.setFloat32(o, box.minX, true);
        dv.setFloat32(o + 4, box.minY, true);
        dv.setFloat32(o + 8, box.minZ, true);
        dv.setFloat32(o + 12, box.maxX, true);
        dv.setFloat32(o + 16, box.maxY, true);
        dv.setFloat32(o + 20, box.maxZ, true);
        o += 24;
      }
    }
    return bytes;
  }
  var MESH_REF_HEADER_BYTES = 24;
  var MESH_REF_HEADER_BYTES_V2 = 28;
  function encodeMeshRefs(refs) {
    const buf = new ArrayBuffer(refs.reduce((bytes, ref) => bytes + MESH_REF_HEADER_BYTES + (ref.materials?.length ?? 0) * 4, 0));
    const dv = new DataView(buf);
    let o = 0;
    for (const r of refs) {
      dv.setUint32(o, meshKeyHash(r.key), true);
      dv.setFloat32(o + 4, r.x, true);
      dv.setFloat32(o + 8, r.y, true);
      dv.setFloat32(o + 12, r.z, true);
      dv.setFloat32(o + 16, r.yaw, true);
      const materials = r.materials ?? [];
      dv.setUint32(o + 20, materials.length, true);
      o += MESH_REF_HEADER_BYTES;
      for (const material of materials) {
        dv.setUint32(o, material >>> 0, true);
        o += 4;
      }
    }
    return new Uint8Array(buf);
  }
  function encodeMeshRefsV2(refs) {
    const buf = new ArrayBuffer(refs.reduce((bytes, ref) => bytes + MESH_REF_HEADER_BYTES_V2 + (ref.materials?.length ?? 0) * 4, 0));
    const dv = new DataView(buf);
    let o = 0;
    for (const r of refs) {
      dv.setUint32(o, meshKeyHash(r.key), true);
      dv.setFloat32(o + 4, r.x, true);
      dv.setFloat32(o + 8, r.y, true);
      dv.setFloat32(o + 12, r.z, true);
      dv.setFloat32(o + 16, r.yaw, true);
      dv.setFloat32(o + 20, r.spin ?? 0, true);
      const materials = r.materials ?? [];
      dv.setUint32(o + 24, materials.length, true);
      o += MESH_REF_HEADER_BYTES_V2;
      for (const material of materials) {
        dv.setUint32(o, material >>> 0, true);
        o += 4;
      }
    }
    return new Uint8Array(buf);
  }

  // cart/editor/world/meshProps.test.ts
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
  var vertices = new Float32Array(9 * 8);
  test("door resident row carries opaque/glass leaf slots, interaction metadata, and open-frame boxes", () => {
    const bytes = encodeResidentMeshes([{
      key: "model:test-door",
      vertices,
      slots: [{ start: 3, count: 3 }, { start: 6, count: 3 }],
      door: { leafSlot: 0, reachMeters: 2.2, vehicle: false, startOpen: false },
      collisionBoxes: [
        { minX: -1.5, minY: 0, minZ: -0.15, maxX: -0.5, maxY: 2.2, maxZ: 0.15 },
        { minX: 0.5, minY: 0, minZ: -0.15, maxX: 1.5, maxY: 2.2, maxZ: 0.15 },
        { minX: -1.5, minY: 2.2, minZ: -0.15, maxX: 1.5, maxY: 3, maxZ: 0.15 }
      ]
    }]);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert(dv.getUint32(0, true) === 7, "not MESH_PROPS v7");
    assert(dv.getUint32(4, true) === 1 && dv.getUint32(8, true) === 0, "catalog header changed");
    const keyLength = dv.getUint32(12, true);
    let at = 16 + keyLength + 36 + vertices.length * 4;
    const pngLength = dv.getUint32(at, true);
    at += 4 + pngLength;
    assert(dv.getUint32(at, true) === 2, "opaque/glass leaf slots missing");
    at += 4;
    assert(dv.getUint32(at, true) === 3 && dv.getUint32(at + 4, true) === 3, "leaf slot range changed");
    at += 8;
    assert(dv.getUint32(at, true) === 6 && dv.getUint32(at + 4, true) === 3, "leaf glass slot range changed");
    at += 8;
    assert(dv.getUint32(at, true) === 1, "door flag missing");
    at += 4;
    assert(dv.getUint32(at, true) === 0, "leaf slot index changed");
    assert(Math.abs(dv.getFloat32(at + 4, true) - 2.2) < 1e-5, "interaction reach changed");
    assert(dv.getUint32(at + 8, true) === 0, "walk door became vehicle door");
    assert(dv.getUint32(at + 12, true) === 0, "door unexpectedly starts open");
    at += 16;
    assert(dv.getUint32(at, true) === 3, "portal-preserving frame boxes missing");
    at += 4;
    assert(Math.abs(dv.getFloat32(at, true) - -1.5) < 1e-5, "left jamb minX changed");
    assert(Math.abs(dv.getFloat32(at + 12, true) - -0.5) < 1e-5, "left jamb maxX changed");
    at += 3 * 24;
    assert(at === bytes.byteLength, `encoder size drift: parsed ${at}, wrote ${bytes.byteLength}`);
  });
  test("encoder rejects a door whose leaf slot does not exist", () => {
    let threw = false;
    try {
      encodeResidentMeshes([{
        key: "model:bad-door",
        vertices,
        door: { leafSlot: 0, reachMeters: 2.2, vehicle: false, startOpen: false }
      }]);
    } catch {
      threw = true;
    }
    assert(threw, "invalid door metadata reached the host decoder");
  });
  test("encoder rejects a degenerate authored collision box", () => {
    let threw = false;
    try {
      encodeResidentMeshes([{
        key: "model:bad-box",
        vertices,
        collisionBoxes: [{ minX: 1, minY: 0, minZ: 0, maxX: 1, maxY: 2, maxZ: 0.2 }]
      }]);
    } catch {
      threw = true;
    }
    assert(threw, "degenerate collider reached the host decoder");
  });
  test("v2 mesh refs carry spin between yaw and matCount; v1 stays 24-byte (req_3128)", () => {
    const ref = { key: "model:sign", x: 1, y: 2, z: 3, yaw: 90, spin: 45 };
    const v2 = encodeMeshRefsV2([ref, { ...ref, spin: void 0 }]);
    assert(v2.byteLength === 2 * 28, "v2 stride is not 28 bytes");
    const dv = new DataView(v2.buffer, v2.byteOffset, v2.byteLength);
    assert(dv.getUint32(0, true) === meshKeyHash("model:sign"), "v2 hash moved");
    assert(Math.abs(dv.getFloat32(16, true) - 90) < 1e-5, "v2 yaw moved");
    assert(Math.abs(dv.getFloat32(20, true) - 45) < 1e-5, "v2 spin not at offset 20");
    assert(dv.getUint32(24, true) === 0, "v2 matCount not at offset 24");
    assert(dv.getFloat32(28 + 20, true) === 0, "absent spin did not encode as 0");
    const v1 = encodeMeshRefs([ref]);
    assert(v1.byteLength === 24, "v1 stride drifted \u2014 an older host would misparse every push");
  });
  test("mesh refs carry one hash per authored face slot, including zero paint fallbacks", () => {
    const ref = { key: "prop:chair", x: 0, y: 0, z: 0, yaw: 0, materials: [287454020, 0, 2864434397] };
    const v2 = encodeMeshRefsV2([ref]);
    assert(v2.byteLength === 28 + 12, "v2 material payload size drifted");
    const v2dv = new DataView(v2.buffer, v2.byteOffset, v2.byteLength);
    assert(v2dv.getUint32(24, true) === 3, "v2 matCount missing");
    assert(v2dv.getUint32(28, true) === 287454020, "slot 0 hash moved");
    assert(v2dv.getUint32(32, true) === 0, "unassigned slot no longer preserves paint");
    assert(v2dv.getUint32(36, true) === 2864434397, "slot 2 hash moved");
    const v1 = encodeMeshRefs([ref]);
    assert(v1.byteLength === 24 + 12, "v1 material payload size drifted");
    const v1dv = new DataView(v1.buffer, v1.byteOffset, v1.byteLength);
    assert(v1dv.getUint32(20, true) === 3 && v1dv.getUint32(28, true) === 0, "v1 slot fallback changed");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
