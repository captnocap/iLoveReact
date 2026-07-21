(() => {
  // runtime/host-globals.ts
  var G = globalThis;

  // runtime/ffi.ts
  var host = G;
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

  // runtime/hooks/fs.ts
  function readFile(path) {
    return callHost("__fs_read", null, path);
  }
  function readFileBase64(path) {
    return callHost("__fs_read_base64", null, path);
  }
  function writeFileBytesAtomic(path, bytes) {
    return callHost("__fs_write_bytes_atomic", false, path, bytes);
  }
  function exists(path) {
    return callHost("__fs_exists", false, path);
  }
  function listDir(path) {
    return callHostJson("__fs_list_json", [], path);
  }
  function mkdir(path) {
    return callHost("__fs_mkdir", false, path);
  }
  function remove(path) {
    return callHost("__fs_remove", false, path);
  }
  function stat(path) {
    return callHostJson("__fs_stat_json", null, path);
  }

  // runtime/workspace/lumps.ts
  var LUMP_ENCODING = {
    raw: 0,
    rle8: 1,
    rle16: 2,
    text: 3
  };
  var ENCODING_BY_ID = {
    [LUMP_ENCODING.raw]: "raw",
    [LUMP_ENCODING.rle8]: "rle8",
    [LUMP_ENCODING.rle16]: "rle16",
    [LUMP_ENCODING.text]: "text"
  };
  function textBytes(text) {
    const encoder = globalThis.TextEncoder;
    if (typeof encoder === "function") return new encoder().encode(text);
    const binary = unescape(encodeURIComponent(text));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) & 255;
    return out;
  }
  function base64ToBytes(value) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = value.replace(/\s+/g, "");
    const out = [];
    for (let i = 0; i < clean.length; i += 4) {
      const c0 = chars.indexOf(clean[i] ?? "A");
      const c1 = chars.indexOf(clean[i + 1] ?? "A");
      const c2 = clean[i + 2] === "=" ? -1 : chars.indexOf(clean[i + 2] ?? "A");
      const c3 = clean[i + 3] === "=" ? -1 : chars.indexOf(clean[i + 3] ?? "A");
      if (c0 < 0 || c1 < 0 || c2 < 0 && clean[i + 2] !== "=" || c3 < 0 && clean[i + 3] !== "=") {
        throw new Error("invalid base64");
      }
      const n = c0 << 18 | c1 << 12 | (c2 < 0 ? 0 : c2) << 6 | (c3 < 0 ? 0 : c3);
      out.push(n >>> 16 & 255);
      if (c2 >= 0) out.push(n >>> 8 & 255);
      if (c3 >= 0) out.push(n & 255);
    }
    return new Uint8Array(out);
  }

  // cart/editor/data/meshDoc.ts
  var host2 = globalThis;
  var RJMD_MAGIC = 1145915986;
  var DOC_BLOB = "mesh/doc.blob";
  var LEGACY_BLOB = "mesh/base.blob";
  var PARTS_META = "mesh/parts.json";
  var docCache = /* @__PURE__ */ new Map();
  var metaCache = /* @__PURE__ */ new Map();
  function meshDocPartRangesComplete(partCount, hostRangeCount) {
    return partCount > 0 && hostRangeCount === partCount;
  }
  function meshDocPartMetadataCanShrink(storedRangeCount, savedPartCount, livePartCount, explicitlyAuthorized = false) {
    const durablePartCount = Math.max(storedRangeCount ?? 0, savedPartCount);
    return livePartCount >= durablePartCount || explicitlyAuthorized;
  }
  function meshDocPartRangesFromRows(rows) {
    const ranges = [];
    for (const row of rows) {
      if (!Number.isInteger(row.lo) || !Number.isInteger(row.hi) || row.lo < 0 || row.hi <= row.lo) return null;
      ranges.push({ lo: row.lo, hi: row.hi });
    }
    ranges.sort((a, b) => a.lo - b.lo);
    for (let i = 1; i < ranges.length; i += 1) {
      if (ranges[i].lo < ranges[i - 1].hi) return null;
    }
    return ranges;
  }
  function invalidateMeshDoc(dir) {
    docCache.delete(dir);
    metaCache.delete(dir);
  }
  function writeMeshDoc(dir, parts, recoveryRanges, options = {}) {
    if (parts.length === 0) {
      console.error(`[meshdoc] REFUSING SAVE for ${dir}: an editable mesh document needs at least one named part`);
      return false;
    }
    const priorDoc = readMeshDoc(dir);
    const priorPartCount = readMeshDocParts(dir)?.length ?? 0;
    if (!meshDocPartMetadataCanShrink(priorDoc?.storedRangeCount, priorPartCount, parts.length, options.allowPartShrink === true)) {
      console.error(`[meshdoc] REFUSING SAVE for ${dir}: durable document has ${Math.max(priorDoc?.storedRangeCount ?? 0, priorPartCount)} part(s), but the live outliner has ${parts.length} and no explicit Delete/Merge authorization`);
      return false;
    }
    {
      const hostPartRanges = () => {
        try {
          const o = JSON.parse(host2.__mesh_part_ranges?.() ?? "null");
          if (!o?.ok || !Array.isArray(o.ranges)) return [];
          const ranges = o.ranges.map((pair) => {
            if (!Array.isArray(pair) || pair.length !== 2) return null;
            const [lo, hi] = pair;
            return typeof lo === "number" && typeof hi === "number" && Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && hi > lo ? { lo, hi } : null;
          });
          if (ranges.some((range) => range === null)) return [];
          const valid = ranges;
          for (let index = 1; index < valid.length; index += 1) {
            if (valid[index].lo < valid[index - 1].hi) return [];
          }
          return valid;
        } catch {
          return [];
        }
      };
      let hostRanges = hostPartRanges();
      if (hostRanges.length !== parts.length && recoveryRanges?.length === parts.length) {
        const pairs = new Uint32Array(recoveryRanges.length * 2);
        recoveryRanges.forEach((range, index) => {
          pairs[index * 2] = range.lo;
          pairs[index * 2 + 1] = range.hi;
        });
        host2.__mesh_set_part_ranges?.(pairs);
        hostRanges = hostPartRanges();
      }
      if (hostRanges.length !== parts.length) {
        console.error(`[meshdoc] REFUSING SAVE for ${dir}: host has ${hostRanges.length} part range(s) while the outliner declares ${parts.length} (${parts.map((p) => p.name).join(", ")}) \u2014 preserving the previous document instead of persisting merged parts (req_3049/req_3226/req_3234)`);
        return false;
      }
      if (host2.__model_meshdoc_write?.(`${dir}/${DOC_BLOB}`, parts.length) !== 1) return false;
    }
    const metadata = textBytes(JSON.stringify({ version: 1, parts }, null, 2));
    const ok = writeFileBytesAtomic(`${dir}/${PARTS_META}`, metadata);
    invalidateMeshDoc(dir);
    return ok;
  }
  function readMeshDoc(dir) {
    if (docCache.has(dir)) return docCache.get(dir);
    const doc = parseDocBlob(dir) ?? parseLegacyBlob(dir);
    if (doc?.storedRangeCount === 0) {
      const partCount = readMeshDocParts(dir)?.length ?? 0;
      const recovered = inferMeshDocPartRanges(doc, partCount);
      if (recovered) {
        doc.ranges = recovered;
        doc.recoveredPartRanges = true;
        console.warn(`[meshdoc] recovered ${recovered.length} missing part ranges for ${dir} from exact contiguous connectivity runs; the next Save will persist them`);
      }
    }
    docCache.set(dir, doc);
    return doc;
  }
  function readMeshDocParts(dir) {
    if (metaCache.has(dir)) return metaCache.get(dir);
    let parts = null;
    const text = readFile(`${dir}/${PARTS_META}`);
    if (text) {
      try {
        const o = JSON.parse(text);
        if (o?.version === 1 && Array.isArray(o.parts)) {
          parts = o.parts.filter((p) => typeof p?.name === "string");
        }
      } catch {
      }
    }
    metaCache.set(dir, parts);
    return parts;
  }
  function parseDocBlob(dir) {
    const path = `${dir}/${DOC_BLOB}`;
    if (!exists(path)) return null;
    const b64 = readFileBase64(path);
    if (!b64) return null;
    let bytes;
    try {
      bytes = base64ToBytes(b64);
    } catch {
      return null;
    }
    return parseMeshDocBytes(bytes);
  }
  function parseMeshDocBytes(bytes) {
    if (bytes.length < 24) return null;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const head = new Uint32Array(buf, 0, 6);
    const [magic, version, vertCount, faceCount, hasGroups, rangeCount] = [head[0], head[1], head[2], head[3], head[4], head[5]];
    if (magic !== RJMD_MAGIC || version !== 1 && version !== 2 && version !== 3 || vertCount === 0) return null;
    const headerBytes = version >= 3 ? 32 : version >= 2 ? 28 : 24;
    if (bytes.length < headerBytes) return null;
    const glassFirstVertex = version >= 2 ? new Uint32Array(buf, 24, 1)[0] : null;
    const hasMaterials = version >= 3 ? new Uint32Array(buf, 28, 1)[0] : 0;
    if (hasMaterials !== 0 && hasMaterials !== 1) return null;
    if (glassFirstVertex !== null && (glassFirstVertex > vertCount || glassFirstVertex % 3 !== 0)) return null;
    const need = headerBytes + vertCount * 8 * 4 + (hasGroups ? faceCount * 4 : 0) + (hasMaterials ? faceCount * 4 : 0) + rangeCount * 8;
    if (bytes.length < need) return null;
    let at = headerBytes;
    const vertices = new Float32Array(buf, at, vertCount * 8);
    at += vertCount * 8 * 4;
    let faceGroups = null;
    if (hasGroups) {
      faceGroups = new Uint32Array(buf, at, faceCount);
      at += faceCount * 4;
    }
    let faceMaterials = null;
    if (hasMaterials) {
      faceMaterials = new Uint32Array(buf, at, faceCount);
      at += faceCount * 4;
    }
    const ranges = [];
    if (rangeCount > 0) {
      const pairs = new Uint32Array(buf, at, rangeCount * 2);
      for (let i = 0; i < rangeCount; i += 1) ranges.push({ lo: pairs[i * 2], hi: pairs[i * 2 + 1] });
    }
    if (ranges.length === 0) ranges.push({ lo: 0, hi: groupSpanEnd(faceGroups, faceCount) });
    return { vertices, faceGroups, faceMaterials, ranges, glassFirstVertex, storedRangeCount: rangeCount };
  }
  function parseLegacyBlob(dir) {
    const path = `${dir}/${LEGACY_BLOB}`;
    if (!exists(path)) return null;
    const b64 = readFileBase64(path);
    if (!b64) return null;
    let bytes;
    try {
      bytes = base64ToBytes(b64);
    } catch {
      return null;
    }
    const vertCount = Math.floor(bytes.length / 32);
    if (vertCount < 3) return null;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + vertCount * 32);
    const vertices = new Float32Array(buf, 0, vertCount * 8);
    const faceCount = Math.floor(vertCount / 3);
    const faceGroups = new Uint32Array(faceCount);
    for (let i = 0; i < faceCount; i += 1) faceGroups[i] = i;
    return { vertices, faceGroups, faceMaterials: null, ranges: [{ lo: 0, hi: faceCount }] };
  }
  function groupSpanEnd(groups, faceCount) {
    if (!groups || groups.length === 0) return faceCount;
    let max = 0;
    for (let i = 0; i < groups.length; i += 1) {
      if (groups[i] > max) max = groups[i];
    }
    return max + 1;
  }
  function inferMeshDocPartRanges(doc, partCount) {
    const groups = doc.faceGroups;
    const triangleCount = Math.floor(doc.vertices.length / 24);
    if (!groups || groups.length !== triangleCount || triangleCount === 0 || partCount < 2) return null;
    const parent = new Int32Array(triangleCount);
    for (let i = 0; i < triangleCount; i += 1) parent[i] = i;
    const root = (input) => {
      let current = input;
      while (parent[current] !== current) {
        parent[current] = parent[parent[current]];
        current = parent[current];
      }
      return current;
    };
    const union = (a, b) => {
      const ar = root(a), br = root(b);
      if (ar !== br) parent[br] = ar;
    };
    const vertexKey = (triangle, corner) => {
      const at = (triangle * 3 + corner) * 8;
      const x = doc.vertices[at] || 0, y = doc.vertices[at + 1] || 0, z = doc.vertices[at + 2] || 0;
      return `${x},${y},${z}`;
    };
    const groupFirst = /* @__PURE__ */ new Map();
    const edgeFirst = /* @__PURE__ */ new Map();
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const group = groups[triangle];
      const sameGroup = groupFirst.get(group);
      if (sameGroup == null) groupFirst.set(group, triangle);
      else union(triangle, sameGroup);
      const vertices = [vertexKey(triangle, 0), vertexKey(triangle, 1), vertexKey(triangle, 2)];
      for (let corner = 0; corner < 3; corner += 1) {
        const a = vertices[corner], b = vertices[(corner + 1) % 3];
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        const adjacent = edgeFirst.get(edge);
        if (adjacent == null) edgeFirst.set(edge, triangle);
        else union(triangle, adjacent);
      }
    }
    const usedGroups = [...groupFirst.keys()].sort((a, b) => a - b);
    if (usedGroups.length === 0) return null;
    const runs = [];
    let lo = usedGroups[0];
    let previous = lo;
    let previousRoot = root(groupFirst.get(lo));
    for (const group of usedGroups.slice(1)) {
      const currentRoot = root(groupFirst.get(group));
      if (group !== previous + 1 || currentRoot !== previousRoot) {
        runs.push({ lo, hi: previous + 1 });
        lo = group;
      }
      previous = group;
      previousRoot = currentRoot;
    }
    runs.push({ lo, hi: previous + 1 });
    return runs.length === partCount ? runs : null;
  }
  function partsMetaFromRows(rows) {
    return rows.slice().sort((a, b) => (a.lo ?? Number.MAX_SAFE_INTEGER) - (b.lo ?? Number.MAX_SAFE_INTEGER)).map((p, rangeRank) => ({
      name: p.name,
      color: p.color,
      visible: p.visible,
      kind: p.kind,
      groupId: p.groupId,
      groupName: p.groupName,
      groupPath: p.groupPath,
      outlinerOrder: p.outlinerOrder ?? rangeRank
    }));
  }
  function meshDocRangeGeometry(doc, rangeIndex) {
    const range = doc.ranges[rangeIndex];
    if (!range) return { vertices: new Float32Array(0), faceGroups: new Uint32Array(0) };
    const vertices = [];
    const faceGroups = [];
    const normalized = /* @__PURE__ */ new Map();
    const triCount = Math.floor(doc.vertices.length / 24);
    for (let tri = 0; tri < triCount; tri += 1) {
      const sourceGroup = doc.faceGroups?.[tri] ?? tri;
      if (sourceGroup < range.lo || sourceGroup >= range.hi) continue;
      let targetGroup = normalized.get(sourceGroup);
      if (targetGroup === void 0) {
        targetGroup = normalized.size;
        normalized.set(sourceGroup, targetGroup);
      }
      const start = tri * 24;
      for (let i = 0; i < 24; i += 1) vertices.push(doc.vertices[start + i]);
      faceGroups.push(targetGroup);
    }
    return { vertices: new Float32Array(vertices), faceGroups: new Uint32Array(faceGroups) };
  }

  // cart/editor/data/modelPackage.ts
  var MODELS_HOME = "cart/editor/data/models";
  function categoryDir(kind) {
    switch (kind) {
      case "build":
        return "build";
      case "character":
        return "characters";
      case "vehicle":
        return "vehicles";
      case "prop":
      default:
        return "props";
    }
  }
  function modelSlug(id) {
    return id.replace(/[^a-zA-Z0-9._-]/g, "_");
  }
  function packageDirForName(kind, name) {
    return `${MODELS_HOME}/${categoryDir(kind)}/${modelSlug(name)}`;
  }
  function packageDir(kind, id) {
    return `${MODELS_HOME}/${categoryDir(kind)}/${modelSlug(id)}`;
  }
  function parseManifest(text) {
    const raw = JSON.parse(text);
    if (!raw || typeof raw.id !== "string" || typeof raw.kind !== "string") {
      throw new Error("not a model manifest");
    }
    return raw;
  }

  // cart/editor/data/modelPackageStore.ts
  var host3 = globalThis;
  var dirById = /* @__PURE__ */ new Map();
  var dirIndexBuilt = false;
  var dirKey = (kind, id) => `${kind}:${id}`;
  function indexPackageDir(kind, id, dir) {
    dirById.set(dirKey(kind, id), dir);
  }
  function ensureDirIndex() {
    if (dirIndexBuilt) return;
    dirIndexBuilt = true;
    if (!exists(MODELS_HOME)) return;
    for (const category of listDir(MODELS_HOME)) {
      const categoryPath = `${MODELS_HOME}/${category}`;
      for (const leaf of listDir(categoryPath)) {
        const dir = `${categoryPath}/${leaf}`;
        const text = readFile(`${dir}/manifest.json`);
        if (!text) continue;
        try {
          const manifest = parseManifest(text);
          indexPackageDir(manifest.kind, manifest.id, dir);
        } catch {
        }
      }
    }
  }
  function legacyPackageDir(kind, id) {
    const dir = packageDir(kind, id);
    const text = readFile(`${dir}/manifest.json`);
    if (!text) return null;
    try {
      if (parseManifest(text).id === id) return dir;
    } catch {
    }
    return null;
  }
  function resolvePackageDir(kind, id) {
    const hit = dirById.get(dirKey(kind, id));
    if (hit && exists(`${hit}/manifest.json`)) return hit;
    const legacy = legacyPackageDir(kind, id);
    if (legacy) {
      indexPackageDir(kind, id, legacy);
      return legacy;
    }
    ensureDirIndex();
    return dirById.get(dirKey(kind, id)) ?? null;
  }
  function nameDirFor(kind, id, name) {
    const base = modelSlug(name) ? packageDirForName(kind, name) : packageDir(kind, id);
    let dir = base;
    for (let n = 2; exists(`${dir}/manifest.json`); n += 1) {
      try {
        if (parseManifest(readFile(`${dir}/manifest.json`) ?? "").id === id) return dir;
      } catch {
      }
      dir = `${base}_${n}`;
    }
    return dir;
  }
  function claimPackageDir(pkg) {
    const existing = resolvePackageDir(pkg.kind, pkg.id);
    if (existing) return existing;
    const dir = nameDirFor(pkg.kind, pkg.id, pkg.name);
    indexPackageDir(pkg.kind, pkg.id, dir);
    return dir;
  }
  var PAINT_LAYOUT_STALE_FILE = "atlases/layout.stale.json";
  var PAINT_RASTER_BASE_FILE = "atlases/raster-base.png";
  function writeModelArtifacts(pkg, parts, recoveryRanges, options = {}) {
    const dir = claimPackageDir(pkg);
    const meshDir = `${dir}/mesh`;
    const atlasDir = `${dir}/atlases`;
    mkdir(meshDir);
    mkdir(atlasDir);
    const docWritten = parts ? writeMeshDoc(dir, parts, recoveryRanges, options) : exists(`${meshDir}/doc.blob`);
    if (parts && docWritten) host3.__model_mesh_write?.(`${meshDir}/base.blob`);
    const stalePath = `${dir}/${PAINT_LAYOUT_STALE_FILE}`;
    const paintLayoutStale = host3.__model_paint_layout_stale?.() === 1;
    if (paintLayoutStale) {
      const doc = stat(`${meshDir}/doc.blob`);
      const markerWritten = !!doc && writeFileBytesAtomic(stalePath, textBytes(JSON.stringify({
        version: 1,
        docStamp: `${doc.size}:${doc.mtimeMs}`,
        reason: "topology-changed"
      })));
      const paintedMetaPath = `${meshDir}/painted.json`;
      if (exists(paintedMetaPath)) remove(paintedMetaPath);
      return docWritten && markerWritten;
    }
    if (exists(stalePath)) remove(stalePath);
    let paintProgramWritten = true;
    try {
      const atlas = JSON.parse(host3.__model_atlas_read?.() || "{}");
      if (atlas.data && atlas.w > 0 && atlas.h > 0) {
        host3.__image_write_png?.(`${atlasDir}/base.png`, atlas.data, atlas.w, atlas.h);
        const paintedWritten = host3.__model_painted_mesh_write?.(`${meshDir}/painted.blob`) === 1;
        const paintedMetaPath = `${meshDir}/painted.json`;
        if (paintedWritten) {
          const doc = stat(`${meshDir}/doc.blob`);
          if (doc) writeFileBytesAtomic(paintedMetaPath, textBytes(JSON.stringify({ version: 1, docStamp: `${doc.size}:${doc.mtimeMs}` })));
        } else if (exists(paintedMetaPath)) {
          remove(paintedMetaPath);
        }
      }
      const programValue = host3.__model_paint_program_read?.();
      const program = typeof programValue === "string" ? programValue : "";
      const baselineValue = host3.__model_paint_baseline_read?.();
      const baseline = typeof baselineValue === "string" ? baselineValue : "";
      const layout = Array.isArray(atlas.islands) && atlas.islands.length > 0 ? atlas.islands : null;
      const basePaintPath = `${atlasDir}/base.paint.json`;
      const rasterBasePath = `${dir}/${PAINT_RASTER_BASE_FILE}`;
      if (baseline && layout) {
        const rasterWritten = host3.__image_write_png?.(rasterBasePath, baseline, atlas.w, atlas.h) === 1;
        const basePaint = {
          version: 3,
          detail: typeof atlas.detail === "number" && Number.isFinite(atlas.detail) ? atlas.detail : 1,
          program,
          layout,
          rasterBase: true
        };
        paintProgramWritten = rasterWritten && writeFileBytesAtomic(basePaintPath, textBytes(JSON.stringify(basePaint)));
      } else if (program.length > 0) {
        if (exists(rasterBasePath)) remove(rasterBasePath);
        const basePaint = {
          version: layout ? 2 : 1,
          detail: typeof atlas.detail === "number" && Number.isFinite(atlas.detail) ? atlas.detail : 1,
          program,
          ...layout ? { layout } : {}
        };
        paintProgramWritten = writeFileBytesAtomic(basePaintPath, textBytes(JSON.stringify(basePaint)));
      } else {
        if (exists(rasterBasePath)) remove(rasterBasePath);
        if (exists(basePaintPath)) remove(basePaintPath);
      }
    } catch {
    }
    return docWritten && paintProgramWritten;
  }

  // cart/editor/data/meshDoc.test.ts
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
  function docBlob(version, glassFirstVertex = 3, material = 4294967295) {
    const headerBytes = version === 3 ? 32 : version === 2 ? 28 : 24;
    const bytes = new Uint8Array(headerBytes + 3 * 8 * 4 + 4 + (version === 3 ? 4 : 0) + 8);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0, 1145915986, true);
    dv.setUint32(4, version, true);
    dv.setUint32(8, 3, true);
    dv.setUint32(12, 1, true);
    dv.setUint32(16, 1, true);
    dv.setUint32(20, 1, true);
    if (version >= 2) dv.setUint32(24, glassFirstVertex, true);
    if (version === 3) dv.setUint32(28, 1, true);
    let at = headerBytes;
    for (let i = 0; i < 24; i += 1) {
      dv.setFloat32(at, i / 10, true);
      at += 4;
    }
    dv.setUint32(at, 7, true);
    at += 4;
    if (version === 3) {
      dv.setUint32(at, material, true);
      at += 4;
    }
    dv.setUint32(at, 7, true);
    dv.setUint32(at + 4, 8, true);
    return bytes;
  }
  test("RJMD v1 remains readable and carries no glass boundary", () => {
    const doc = parseMeshDocBytes(docBlob(1));
    assert(!!doc, "v1 document was rejected");
    assert(doc.glassFirstVertex === null, "v1 invented a glass boundary");
    assert(doc.faceGroups?.[0] === 7 && doc.ranges[0]?.lo === 7, "v1 groups/ranges shifted");
  });
  test("RJMD v2 preserves the trailing glass vertex boundary", () => {
    const doc = parseMeshDocBytes(docBlob(2, 0));
    assert(!!doc, "v2 document was rejected");
    assert(doc.glassFirstVertex === 0, `v2 glass boundary changed to ${doc.glassFirstVertex}`);
  });
  test("RJMD v2 rejects a non-triangle-aligned glass boundary", () => {
    assert(parseMeshDocBytes(docBlob(2, 2)) === null, "misaligned glass boundary passed");
  });
  test("RJMD v3 preserves stable per-face texture-role indices", () => {
    const doc = parseMeshDocBytes(docBlob(3, 3, 2));
    assert(!!doc, "v3 document was rejected");
    assert(doc.faceMaterials?.[0] === 2, "v3 texture-role row shifted");
    assert(doc.faceGroups?.[0] === 7 && doc.ranges[0]?.lo === 7, "v3 groups/ranges shifted around materials");
  });
  test("parts metadata preserves organizational groups while ranking by host range", () => {
    const rows = partsMetaFromRows([
      { name: "divider", color: "#bbb", visible: true, lo: 8, groupId: "rails", groupName: "Rails", groupPath: [{ id: "bridge", name: "Bridge" }, { id: "rails", name: "Rails" }], outlinerOrder: 0 },
      { name: "deck", color: "#aaa", visible: true, lo: 2, groupId: "bridge", groupName: "Bridge", groupPath: [{ id: "bridge", name: "Bridge" }], outlinerOrder: 1 }
    ]);
    assert(rows[0]?.name === "deck" && rows[1]?.name === "divider", "host-range ranking changed");
    assert(rows[1]?.groupPath?.map((group) => group.id).join("/") === "bridge/rails", "nested group metadata was stripped from parts.json rows");
    assert(rows[0]?.outlinerOrder === 1 && rows[1]?.outlinerOrder === 0, "display order was rewritten to host range rank");
  });
  test("a degraded host cannot overwrite a multi-part mesh document", () => {
    assert(!meshDocPartRangesComplete(15, 0), "zero ranges were accepted for a 15-part model");
    assert(!meshDocPartRangesComplete(15, 1), "one merged range was accepted for a 15-part model");
    assert(meshDocPartRangesComplete(15, 15), "a complete range table was rejected");
    assert(!meshDocPartRangesComplete(1, 0), "a single part without its one durable range was accepted");
    assert(meshDocPartRangesComplete(1, 1), "a complete single-part range table was rejected");
    assert(!meshDocPartMetadataCanShrink(0, 15, 1), "a collapsed fallback row could overwrite 15 saved names");
    assert(!meshDocPartMetadataCanShrink(15, 15, 1), "a healthy document shrank without a destructive-action capability");
    assert(meshDocPartMetadataCanShrink(15, 15, 1, true), "an explicitly authorized delete from a healthy document was blocked");
    assert(meshDocPartMetadataCanShrink(0, 15, 15), "an exact recovered outliner could not repair its zero-range document");
    assert(!meshDocPartMetadataCanShrink(15, 1, 1), "the durable range table did not outvote already-collapsed metadata");
  });
  test("save recovery accepts only complete non-overlapping live ranges", () => {
    const recovered = meshDocPartRangesFromRows([{ lo: 8, hi: 12 }, { lo: 0, hi: 8 }]);
    assert(JSON.stringify(recovered) === JSON.stringify([{ lo: 0, hi: 8 }, { lo: 8, hi: 12 }]), "valid ranges were not normalized by rank");
    assert(meshDocPartRangesFromRows([{ lo: 0, hi: 8 }, { lo: 7, hi: 12 }]) === null, "overlapping ranges were accepted");
    assert(meshDocPartRangesFromRows([{ lo: 0, hi: 8 }, { lo: void 0, hi: void 0 }]) === null, "missing ranges were guessed");
  });
  test("missing ranges recover only from an exact parts-to-connectivity-run match", () => {
    const vertices = new Float32Array(5 * 24);
    const triangles = [
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      // group 0, component A
      [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
      // group 1, component A
      [[4, 0, 0], [5, 0, 0], [4, 1, 0]],
      // group 2, component B
      [[0, 0, 0], [0, 1, 0], [-1, 0, 0]],
      // group 3, component A again
      [[10, 0, 0], [11, 0, 0], [10, 1, 0]]
      // group 10, gap forces a new run
    ];
    triangles.forEach((triangle, ti) => triangle.forEach((position, corner) => {
      const at = (ti * 3 + corner) * 8;
      vertices.set(position, at);
    }));
    const doc = { vertices, faceGroups: new Uint32Array([0, 1, 2, 3, 10]) };
    const recovered = inferMeshDocPartRanges(doc, 4);
    assert(JSON.stringify(recovered) === JSON.stringify([{ lo: 0, hi: 2 }, { lo: 2, hi: 3 }, { lo: 3, hi: 4 }, { lo: 10, hi: 11 }]), `exact runs were not recovered: ${JSON.stringify(recovered)}`);
    assert(inferMeshDocPartRanges(doc, 3) === null, "ambiguous run/metadata mismatch was guessed");
  });
  test("package part extraction keeps only its range and normalizes face groups", () => {
    const vertices = new Float32Array(4 * 24);
    for (let i = 0; i < vertices.length; i += 1) vertices[i] = i;
    const part = meshDocRangeGeometry({
      vertices,
      faceGroups: new Uint32Array([2, 7, 8, 12]),
      ranges: [{ lo: 2, hi: 3 }, { lo: 7, hi: 10 }, { lo: 12, hi: 13 }]
    }, 1);
    assert(part.vertices.length === 48, `expected two triangles, got ${part.vertices.length / 24}`);
    assert(part.vertices[0] === 24 && part.vertices[24] === 48, "wrong source triangles copied");
    assert(part.faceGroups[0] === 0 && part.faceGroups[1] === 1, "source group ids were not normalized");
  });
  test("paint-only artifact persistence cannot rewrite editable mesh files", () => {
    const host4 = globalThis;
    const names = [
      "__fs_exists",
      "__fs_read",
      "__fs_mkdir",
      "__model_meshdoc_write",
      "__model_mesh_write",
      "__model_atlas_read",
      "__model_paint_program_read"
    ];
    const prior = new Map(names.map((name) => [name, host4[name]]));
    let documentWrites = 0;
    let sourceMeshWrites = 0;
    try {
      host4.__fs_exists = (path) => path.endsWith("/mesh/doc.blob");
      host4.__fs_read = () => null;
      host4.__fs_mkdir = () => true;
      host4.__model_meshdoc_write = () => {
        documentWrites += 1;
        return 1;
      };
      host4.__model_mesh_write = () => {
        sourceMeshWrites += 1;
        return 1;
      };
      host4.__model_atlas_read = () => "{}";
      host4.__model_paint_program_read = () => "";
      const ok = writeModelArtifacts({ kind: "prop", id: "test:paint-only", name: "paint only" });
      assert(ok, "paint-only persistence did not recognize the existing document");
      assert(documentWrites === 0, "paint-only persistence rewrote doc.blob");
      assert(sourceMeshWrites === 0, "paint-only persistence rewrote base.blob");
    } finally {
      for (const name of names) {
        const value = prior.get(name);
        if (value === void 0) delete host4[name];
        else host4[name] = value;
      }
    }
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
