"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // cli/host/log.ts
  function out(...parts) {
    __writeStdout(parts.join("") + "\n");
  }
  function err(...parts) {
    __writeStderr(parts.join("") + "\n");
  }
  function die(tag, message, code = 1) {
    __writeStderr(`[${tag}] ${message}
`);
    __exit(code);
    throw new Error("unreachable");
  }

  // cli/commands/autotest.ts
  var autotest_exports = {};
  __export(autotest_exports, {
    run: () => run
  });

  // cli/host/fs.ts
  var FsError = class extends Error {
    constructor(op, path, message) {
      super(`fs ${op} failed: ${path}${message ? ": " + message : ""}`);
      this.op = op;
      this.path = path;
    }
    op;
    path;
  };
  function fsRead(path) {
    const result = __fs_read(path);
    if (result === null) throw new FsError("read", path);
    return result;
  }
  function tryFsRead(path) {
    return __fs_read(path);
  }
  function fsWrite(path, content) {
    if (!__fs_write(path, content)) throw new FsError("write", path);
  }
  function fsExists(path) {
    return __fs_exists(path);
  }
  function fsStat(path) {
    const result = __fs_stat_json(path);
    if (result === null) throw new FsError("stat", path);
    return JSON.parse(result);
  }
  function tryFsStat(path) {
    const result = __fs_stat_json(path);
    return result === null ? null : JSON.parse(result);
  }
  function fsList(path) {
    return JSON.parse(__fs_list_json(path));
  }
  function fsMkdir(path) {
    if (!__fs_mkdir(path)) throw new FsError("mkdir", path);
  }
  function fsRemove(path) {
    if (!__fs_remove(path)) throw new FsError("remove", path);
  }
  function fsReadJson(path) {
    const raw = fsRead(path);
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new FsError("parse-json", path, error.message);
    }
  }

  // cli/host/process.ts
  function spawnSync(cmd, args, stdin = "") {
    return JSON.parse(__spawnSync(cmd, JSON.stringify(args), stdin));
  }
  function spawn(cmd, args) {
    const id = __spawn(cmd, JSON.stringify(args));
    if (id < 0) throw new Error(`spawn failed: ${cmd}`);
    return { id };
  }

  // cli/commands/autotest.ts
  async function run(argv) {
    const name = argv[0];
    if (!name) {
      err("Usage: scripts/autotest <name>");
      err("  e.g.: scripts/autotest sweatshop");
      return 1;
    }
    if (argv.length > 1) {
      err(`[autotest] unexpected argument: ${argv[1]}`);
      return 1;
    }
    const root = __cwd();
    const testFile = `${root}/tests/${name}.autotest`;
    const cart = resolveCart(root, name);
    if (!fsExists(testFile)) return fail(`[autotest] ERROR: no test file at tests/${name}.autotest`);
    if (!cart) return fail(`[autotest] ERROR: no cart found for ${name} (expected cart/${name}/index.tsx or cart/${name}.tsx)`);
    const binary = `${root}/zig-out/bin/${name}`;
    if (binaryCurrent(binary, cart.entry)) {
      out(`[autotest] ${name} binary is current, skipping build`);
      out(`[autotest] regenerating tests/${name}.autotest from current binary...`);
      spawnSync("env", [
        "ZIGOS_HEADLESS=1",
        "ZIGOS_WITNESS=snapshot",
        `ZIGOS_WITNESS_FILE=${testFile}`,
        "timeout",
        "-s",
        "KILL",
        "300",
        binary
      ]);
      if (!fileNonEmpty(testFile)) return fail("[autotest] ERROR: snapshot regeneration produced no test file");
    } else {
      out(`[autotest] building ${name}...`);
      const build = spawnSync(`${root}/tools/rjit`, ["ship", name]);
      if (build.code !== 0) {
        out("[autotest] BUILD FAILED");
        return 1;
      }
    }
    if (!fsExists(binary)) return fail(`[autotest] ERROR: binary not found at zig-out/bin/${name}`);
    const timestamp = dateStamp();
    const flatDir = `${root}/tests/screenshots/${name}`;
    const outDir = `${flatDir}/${timestamp}`;
    fsMkdir(flatDir);
    cleanFlatDir(flatDir);
    out("[autotest] running...");
    runWitness(root, name, binary, testFile);
    if (!fsExists(`${flatDir}/manifest.txt`)) {
      out("[autotest] WARNING: no manifest - screenshots may not have been captured");
      return 1;
    }
    const grid = spawnSync("python3", [`${root}/scripts/autotest-grid`, name]);
    writeSpawnOutput(grid);
    const tag = (tryFsRead(`${flatDir}/verdict.txt`) ?? "FAIL").trim() || "FAIL";
    const exit = tag === "PASS" ? 0 : 1;
    const taggedDir = `${outDir}_${tag}`;
    fsMkdir(taggedDir);
    moveProofFiles(flatDir, taggedDir);
    spawnSync("ln", ["-sfn", basename(taggedDir), `${flatDir}/latest`]);
    if (tag === "PASS") {
      out(`[autotest] PASS - proof: ${rel(root, taggedDir)}/proof.png`);
    } else {
      out(`[autotest] FAIL - proof: ${rel(root, taggedDir)}/proof.png`);
    }
    return exit;
  }
  function resolveCart(root, name) {
    const dirEntry = `${root}/cart/${name}/index.tsx`;
    if (fsExists(dirEntry)) return { entry: dirEntry };
    const fileEntry = `${root}/cart/${name}.tsx`;
    if (fsExists(fileEntry)) return { entry: fileEntry };
    return null;
  }
  function binaryCurrent(binary, cartEntry) {
    if (!fsExists(binary)) return false;
    return fsStat(binary).mtimeMs > fsStat(cartEntry).mtimeMs;
  }
  function fileNonEmpty(path) {
    return fsExists(path) && fsStat(path).size > 0;
  }
  function dateStamp() {
    const result = spawnSync("date", ["+%Y%m%d_%H%M%S"]);
    return result.stdout.trim() || String(Math.floor(__nowMs()));
  }
  function cleanFlatDir(flatDir) {
    spawnSync("sh", ["-c", `rm -f "${flatDir}"/step_*.png "${flatDir}"/manifest.txt "${flatDir}"/proof.png "${flatDir}"/verdict.txt`]);
  }
  function runWitness(root, name, binary, testFile) {
    const sourceFiles = [];
    for (const candidate of [`${root}/cart/${name}/data.ts`, `${root}/cart/${name}/data.tsx`]) {
      if (fsExists(candidate)) sourceFiles.push(rel(root, candidate));
    }
    const env = [
      "ZIGOS_HEADLESS=1",
      "ZIGOS_WITNESS=autotest",
      `ZIGOS_WITNESS_FILE=${shellQuote(testFile)}`,
      `ZIGOS_SOURCE=${shellQuote(sourceFiles.join(":"))}`
    ].join(" ");
    const filter = 'grep --line-buffered -v "AUTOTEST RESULT" | grep --line-buffered -E "expect|click|reject|color|bg|border|styles|PASS|FAIL|OK|VERIFY|audit|MISSING|changed"';
    const cmd = `${env} stdbuf -oL timeout -s KILL 600 ${shellQuote(binary)} 2>&1 | ${filter}`;
    const result = spawnSync("sh", ["-c", `${cmd} || true`]);
    writeSpawnOutput(result);
  }
  function moveProofFiles(flatDir, taggedDir) {
    spawnSync("sh", ["-c", `mv "${flatDir}"/step_*.png "${flatDir}"/manifest.txt "${flatDir}"/proof.png "${flatDir}"/verdict.txt "${taggedDir}"/ 2>/dev/null || true`]);
  }
  function writeSpawnOutput(result) {
    if (result.stdout) __writeStdout(result.stdout);
    if (result.stderr) __writeStderr(result.stderr);
  }
  function shellQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
  function basename(path) {
    const idx = path.lastIndexOf("/");
    return idx < 0 ? path : path.slice(idx + 1);
  }
  function rel(root, path) {
    return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  }
  function fail(message) {
    err(message);
    return 1;
  }

  // cli/commands/bake-geometry.ts
  var bake_geometry_exports = {};
  __export(bake_geometry_exports, {
    run: () => run2
  });

  // cli/host/argv.ts
  function parseArgs(argv, spec) {
    const out2 = { positional: {}, flags: {}, rest: [] };
    const positionals = spec.positional ?? [];
    let posIdx = 0;
    let collecting = false;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (collecting) {
        out2.rest.push(arg);
        continue;
      }
      if (arg === spec.passthroughAfter) {
        collecting = true;
        continue;
      }
      if (arg.startsWith("--")) {
        const name = arg.slice(2);
        const kind = spec.flags?.[name];
        if (!kind) throw new Error(`unknown flag: ${arg}`);
        if (kind === "bool") {
          out2.flags[name] = true;
          continue;
        }
        const next = argv[i + 1];
        if (next === void 0) throw new Error(`flag ${arg} requires a value`);
        i++;
        out2.flags[name] = kind === "number" ? Number(next) : next;
        continue;
      }
      const posName = positionals[posIdx++];
      if (!posName) throw new Error(`unexpected positional: ${arg}`);
      out2.positional[posName] = arg;
    }
    return out2;
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
    const V = (cy) => cy / rows;
    const uv2 = (cx, cy) => [U(cx), V(cy)];
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
  var HUMANOID_ATLAS = {
    head: { u0: 0, u1: 0.5, v0: 0.5, v1: 0 },
    arms: { u0: 0.5, u1: 1, v0: 0, v1: 0.5 },
    torso: { u0: 0, u1: 0.5, v0: 1, v1: 0.5 },
    legs: { u0: 0.5, u1: 1, v0: 0.5, v1: 1 }
  };
  var clamp01 = (value) => Math.max(0, Math.min(1, value));
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }
  function normalize2(v) {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  }
  function ellipsoid(role, center, radii) {
    return {
      role,
      metric(point2) {
        const x = (point2[0] - center[0]) / radii[0];
        const y = (point2[1] - center[1]) / radii[1];
        const z = (point2[2] - center[2]) / radii[2];
        return Math.hypot(x, y, z);
      }
    };
  }
  function taperedCapsule(role, from, to, fromRadius, toRadius) {
    const axis = sub(to, from);
    const axisLengthSquared = Math.max(1e-12, dot(axis, axis));
    return {
      role,
      metric(point2) {
        const t = clamp01(dot(sub(point2, from), axis) / axisLengthSquared);
        const center = [
          from[0] + axis[0] * t,
          from[1] + axis[1] * t,
          from[2] + axis[2] * t
        ];
        const radius = fromRadius + (toRadius - fromRadius) * t;
        return Math.hypot(point2[0] - center[0], point2[1] - center[1], point2[2] - center[2]) / radius;
      }
    };
  }
  function authoredShapes(params) {
    const h = Math.max(0.4, params.height);
    const thickness = Math.max(0.45, params.limbThickness);
    const shoulderHalf = Math.max(h * 0.13, params.shoulderWidth * 0.5);
    const hipHalf = Math.max(h * 0.075, params.hipWidth * 0.5);
    const limb = h * 0.044 * thickness;
    const sideShapes = (sign) => {
      const side = sign < 0 ? "left" : "right";
      const shoulder = [sign * shoulderHalf * 0.92, h * 0.72, 0];
      const elbow = [sign * (shoulderHalf + h * 0.018), h * 0.555, 0];
      const wrist = [sign * (shoulderHalf + h * 0.035), h * 0.385, h * 6e-3];
      const palm = [sign * (shoulderHalf + h * 0.039), h * 0.335, h * 0.012];
      const fingerTip = [sign * (shoulderHalf + h * 0.043), h * 0.285, h * 0.018];
      const hip = [sign * hipHalf * 0.58, h * 0.43, 0];
      const knee = [sign * hipHalf * 0.64, h * 0.225, h * 4e-3];
      const ankle = [sign * hipHalf * 0.67, h * 0.07, h * 0.025];
      return [
        taperedCapsule({ role: "clavicle", side }, [sign * h * 0.035, h * 0.725, 0], shoulder, h * 0.043, h * 0.04),
        taperedCapsule({ role: "upper_arm", side }, shoulder, elbow, limb * 1.15, limb),
        taperedCapsule({ role: "lower_arm", side }, elbow, wrist, limb, limb * 0.75),
        taperedCapsule({ role: "hand", side }, wrist, palm, limb * 0.82, limb * 0.9),
        taperedCapsule({ role: "fingers", side }, palm, fingerTip, limb * 0.67, limb * 0.42),
        taperedCapsule({ role: "upper_leg", side }, hip, knee, limb * 1.45, limb * 1.17),
        taperedCapsule({ role: "lower_leg", side }, knee, ankle, limb * 1.14, limb * 0.84),
        ellipsoid({ role: "foot", side }, [ankle[0], h * 0.052, h * 0.075], [limb * 1.02, h * 0.047, h * 0.095]),
        ellipsoid({ role: "toes", side }, [ankle[0], h * 0.043, h * 0.145], [limb * 0.92, h * 0.035, h * 0.065])
      ];
    };
    return [
      ellipsoid({ role: "pelvis" }, [0, h * 0.44, 0], [hipHalf * 1.2, h * 0.09, hipHalf * 0.9]),
      ellipsoid({ role: "abdomen" }, [0, h * 0.545, 0], [hipHalf * 1.12, h * 0.125, hipHalf * 0.82]),
      ellipsoid({ role: "chest" }, [0, h * 0.655, 0], [shoulderHalf, h * 0.14, shoulderHalf * 0.62]),
      taperedCapsule({ role: "neck" }, [0, h * 0.735, 0], [0, h * 0.805, h * 4e-3], h * 0.055, h * 0.052),
      ellipsoid(
        { role: "head" },
        [0, h * 0.89, h * 8e-3],
        [Math.max(params.headSize, h * 0.1), h * 0.112, Math.max(params.headSize * 0.96, h * 0.095)]
      ),
      ...sideShapes(-1),
      ...sideShapes(1)
    ];
  }
  var cellKey = (x, y, z) => `${x}:${y}:${z}`;
  var vertexKey = cellKey;
  function atlasFor(role) {
    if (role.role === "head" || role.role === "neck") return HUMANOID_ATLAS.head;
    if (role.role === "clavicle" || role.role === "upper_arm" || role.role === "lower_arm" || role.role === "hand" || role.role === "fingers") return HUMANOID_ATLAS.arms;
    if (role.role === "upper_leg" || role.role === "lower_leg" || role.role === "foot" || role.role === "toes") return HUMANOID_ATLAS.legs;
    return HUMANOID_ATLAS.torso;
  }
  function uvFor(role, point2, height) {
    const rect = atlasFor(role);
    const around = (Math.atan2(point2[0], -point2[2]) / (Math.PI * 2) + 1) % 1;
    const down = clamp01(1 - point2[1] / height);
    return [
      rect.u0 + around * (rect.u1 - rect.u0),
      rect.v0 + down * (rect.v1 - rect.v0)
    ];
  }
  var FACE_DIRECTIONS = [
    { neighbor: [1, 0, 0], corners: (x, y, z) => [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]] },
    { neighbor: [-1, 0, 0], corners: (x, y, z) => [[x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z], [x, y, z]] },
    { neighbor: [0, 1, 0], corners: (x, y, z) => [[x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z], [x, y + 1, z]] },
    { neighbor: [0, -1, 0], corners: (x, y, z) => [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]] },
    { neighbor: [0, 0, 1], corners: (x, y, z) => [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]] },
    { neighbor: [0, 0, -1], corners: (x, y, z) => [[x + 1, y, z], [x, y, z], [x, y + 1, z], [x + 1, y + 1, z]] }
  ];
  function generateLogical(params) {
    const height = Math.max(0.4, params.height);
    const verticalCells = Math.max(28, Math.min(48, Math.round(Math.max(6, params.sides) * 4)));
    const cell = height / verticalCells;
    const shapes = authoredShapes(params);
    const maxX = Math.max(params.shoulderWidth * 0.72, params.hipWidth, height * 0.27);
    const minXCell = Math.floor(-maxX / cell) - 1;
    const maxXCell = Math.ceil(maxX / cell) + 1;
    const minZCell = Math.floor(-height * 0.16 / cell) - 1;
    const maxZCell = Math.ceil(height * 0.24 / cell) + 1;
    const occupied = /* @__PURE__ */ new Map();
    for (let y = 0; y < verticalCells + 1; y += 1) {
      for (let x = minXCell; x < maxXCell; x += 1) {
        for (let z = minZCell; z < maxZCell; z += 1) {
          const point2 = [(x + 0.5) * cell, (y + 0.5) * cell, (z + 0.5) * cell];
          let best = null;
          let bestMetric = Infinity;
          for (const shape of shapes) {
            const metric = shape.metric(point2);
            if (metric < bestMetric) {
              best = shape;
              bestMetric = metric;
            }
          }
          if (best && bestMetric <= 1) occupied.set(cellKey(x, y, z), { x, y, z, role: best.role });
        }
      }
    }
    const verts = [];
    const vertexIds = /* @__PURE__ */ new Map();
    const intern = (grid) => {
      const key2 = vertexKey(grid[0], grid[1], grid[2]);
      const prior = vertexIds.get(key2);
      if (prior !== void 0) return prior;
      const id = verts.length;
      verts.push([grid[0] * cell, grid[1] * cell, grid[2] * cell]);
      vertexIds.set(key2, id);
      return id;
    };
    const faces = [];
    for (const cellRow of occupied.values()) {
      for (const direction of FACE_DIRECTIONS) {
        const nx = cellRow.x + direction.neighbor[0];
        const ny = cellRow.y + direction.neighbor[1];
        const nz = cellRow.z + direction.neighbor[2];
        if (occupied.has(cellKey(nx, ny, nz))) continue;
        const grids = direction.corners(cellRow.x, cellRow.y, cellRow.z);
        const loop = grids.map(intern);
        const uv2 = loop.map((id) => uvFor(cellRow.role, verts[id], height));
        faces.push({ loop, uv: uv2, semanticRole: cellRow.role });
      }
    }
    return { verts, faces };
  }
  function generate11(params) {
    const logical = generateLogical(params);
    const faceNormals = logical.faces.map((face) => {
      const a = logical.verts[face.loop[0]];
      const b = logical.verts[face.loop[1]];
      const c = logical.verts[face.loop[2]];
      return normalize2(cross(sub(b, a), sub(c, a)));
    });
    const incident = /* @__PURE__ */ new Map();
    logical.faces.forEach((face, faceId) => {
      for (const vertexId of face.loop) {
        const rows = incident.get(vertexId) ?? [];
        rows.push(faceId);
        incident.set(vertexId, rows);
      }
    });
    const smoothNormal = (vertexId) => {
      let x = 0, y = 0, z = 0;
      for (const faceId of incident.get(vertexId) ?? []) {
        const normal = faceNormals[faceId];
        x += normal[0];
        y += normal[1];
        z += normal[2];
      }
      return normalize2([x, y, z]);
    };
    const render = [];
    const cornerLogicalIds = [];
    const triangleLogicalIndices = [];
    const triangleFaceIds = [];
    let maxRadiusSquared = 0;
    logical.faces.forEach((face, faceId) => {
      const triangles = [[0, 1, 2], [0, 2, 3]];
      for (const triangle of triangles) {
        for (const localCorner of triangle) {
          const logicalId = face.loop[localCorner];
          const position = logical.verts[logicalId];
          const normal = params.smoothShading ? smoothNormal(logicalId) : faceNormals[faceId];
          const uv2 = face.uv[localCorner];
          render.push(position[0], position[1], position[2], normal[0], normal[1], normal[2], uv2[0], uv2[1]);
          cornerLogicalIds.push(logicalId);
          triangleLogicalIndices.push(logicalId);
          maxRadiusSquared = Math.max(maxRadiusSquared, dot(position, position));
        }
        triangleFaceIds.push(faceId);
      }
    });
    return {
      positions: new Float32Array(render),
      count: render.length / 8,
      bounds: { radius: Math.sqrt(maxRadiusSquared) },
      logicalVertices: new Float32Array(logical.verts.flat()),
      logicalVertexCount: logical.verts.length,
      renderCornerLogicalIds: new Uint32Array(cornerLogicalIds),
      logicalTriangleIndices: new Uint32Array(triangleLogicalIndices),
      renderTriangleLogicalFaceIds: new Uint32Array(triangleFaceIds),
      logicalFaceRoles: logical.faces.map((face) => face.semanticRole)
    };
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
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const block of blocks) {
      minX = Math.min(minX, block.x - 0.5);
      minY = Math.min(minY, block.y - 0.5);
      minZ = Math.min(minZ, block.z - 0.5);
      maxX = Math.max(maxX, block.x + 0.5);
      maxY = Math.max(maxY, block.y + 0.5);
      maxZ = Math.max(maxZ, block.z + 0.5);
    }
    const min = [minX * cell, minY * cell, minZ * cell];
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
    const out2 = [];
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
        out2.push({ face: first.face, plane: first.plane, u0: start.u, v0: start.v, u1: start.u + width, v1: start.v + height });
      }
    }
    return out2;
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
    const ringVerts = (t) => {
      const { r, cx } = at(t);
      const out2 = [];
      for (let s = 0; s <= sides; s += 1) {
        const a = s / sides * TAU2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        out2.push({ pos: [cx + dx * r, t, dz * r], nrm: normalize(dx, 0.15, dz), u: s / sides });
      }
      return out2;
    };
    let lower = ringVerts(0);
    for (let i = 1; i <= segs; i += 1) {
      const t = i / segs;
      const upper = ringVerts(t);
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
      const out2 = [];
      for (let s = 0; s <= sides; s += 1) {
        const ang = s / sides * TAU3;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        out2.push({ pos: [cx + r * ca * nx, cy + r * ca * ny, r * sa], nrm: normalize(ca * nx, ca * ny, sa), u: s / sides });
      }
      return out2;
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
  var GEOMETRIES = {
    Box,
    Sphere,
    Head,
    Carve,
    Globe,
    Plane,
    Cylinder,
    Cone,
    Torus,
    Heightfield,
    Humanoid,
    VoxelMesh,
    GrassBlade,
    BushClump,
    FlowerHead
  };

  // runtime/geometries/_baked.generated.ts
  var BAKED = {};

  // runtime/geometries/intern.ts
  var cache = /* @__PURE__ */ new Map();
  for (const key2 of Object.keys(BAKED)) cache.set(key2, BAKED[key2]);
  function stable(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  }
  function internKey(def2, params) {
    const resolved = { ...def2.defaults ?? {}, ...params ?? {} };
    return def2.id + "|" + stable(resolved);
  }
  function bakeEntry(def2, params) {
    const key2 = internKey(def2, params);
    const data = def2.generate({ ...def2.defaults ?? {}, ...params ?? {} });
    return { key: key2, vertices: Array.from(data.positions), count: data.count, bounds: data.bounds.radius };
  }

  // cli/commands/bake-geometry.ts
  var SEED_PATH = "runtime/geometries/_baked.generated.ts";
  async function run2(argv) {
    const args = parseArgs(argv, { flags: { check: "bool", clear: "bool", manifest: "string", out: "string" } });
    const seedPath = args.flags.out ?? SEED_PATH;
    let entries = [];
    if (!args.flags.clear) {
      const manifestPath = args.flags.manifest;
      if (!manifestPath) {
        err("bake-geometry: --manifest <path> required (or --clear to empty the seed)");
        return 2;
      }
      if (!fsExists(manifestPath)) {
        err(`bake-geometry: manifest not found: ${manifestPath}`);
        return 2;
      }
      let items;
      try {
        items = JSON.parse(fsRead(manifestPath));
      } catch (e) {
        err(`bake-geometry: manifest is not valid JSON: ${e.message}`);
        return 2;
      }
      for (const item of items) {
        const def2 = GEOMETRIES[item.geometry];
        if (!def2) {
          err(`bake-geometry: unknown geometry "${item.geometry}" (known: ${Object.keys(GEOMETRIES).join(", ")})`);
          return 1;
        }
        entries.push(bakeEntry(def2, item.params ?? {}));
      }
    }
    const content = emitSeed(entries);
    if (args.flags.check) {
      const onDisk = fsExists(seedPath) ? fsRead(seedPath) : "";
      if (onDisk !== content) {
        err(`bake-geometry: ${seedPath} drift`);
        return 1;
      }
      out("bake-geometry: clean");
      return 0;
    }
    fsWrite(seedPath, content);
    out(`bake-geometry: wrote ${seedPath} (${entries.length} geometr${entries.length === 1 ? "y" : "ies"} baked)`);
    return 0;
  }
  function emitSeed(entries) {
    const lines = [
      "// runtime/geometries/_baked.generated.ts \u2014 DO NOT EDIT.",
      "// Regenerated by `rjit bake-geometry`. Committed EMPTY so the import in intern.ts",
      "// always resolves; a build with bakeable geometry overwrites it with the seed.",
      "//",
      "// Each entry is an InternedGeometry (key/vertices/count/bounds) computed at build",
      "// time. intern.ts pre-seeds its cache from this, so a baked mesh's internGeometry",
      "// is a transparent cache hit and generate() never runs in V8. Keys are produced",
      "// by internKey() so they match the runtime keys exactly.",
      "",
      "export type BakedEntry = { key: string; vertices: number[]; count: number; bounds: number };",
      ""
    ];
    if (entries.length === 0) {
      lines.push("export const BAKED: Record<string, BakedEntry> = {};");
      lines.push("");
      return lines.join("\n");
    }
    lines.push("export const BAKED: Record<string, BakedEntry> = {");
    for (const e of entries) {
      lines.push(`  ${JSON.stringify(e.key)}: { key: ${JSON.stringify(e.key)}, count: ${e.count}, bounds: ${e.bounds}, vertices: [${e.vertices.join(",")}] },`);
    }
    lines.push("};");
    lines.push("");
    return lines.join("\n");
  }

  // cli/commands/bake-geometry-auto.ts
  var bake_geometry_auto_exports = {};
  __export(bake_geometry_auto_exports, {
    run: () => run3
  });
  function loadTypeScript() {
    const root = __cwd();
    const candidates = [`${root}/vendor/typescript/typescript.js`, `${root}/deps/typescript/typescript.js`];
    const tsPath = candidates.find((c) => __fs_exists(c));
    if (!tsPath) throw new Error(`bake-geometry-auto: deps/typescript/typescript.js not found`);
    const code = __fs_read(tsPath);
    const moduleObj = { exports: {} };
    const exportsObj = moduleObj.exports;
    const localProcess = {
      nextTick: void 0,
      argv: [],
      env: {},
      cwd: () => root,
      pid: 1,
      platform: "linux",
      execArgv: [],
      platformVersion: "",
      version: "",
      memoryUsage: () => ({ heapUsed: 0 }),
      stdout: { write: (s) => __writeStdout(String(s)), columns: 80, isTTY: false },
      stderr: { write: (s) => __writeStderr(String(s)) },
      exit: (code2) => __exit(code2 | 0)
    };
    function noopRequire(name) {
      throw new Error(`require("${name}") is unavailable under v8cli`);
    }
    const minimalBuffer2 = { isBuffer: () => false, from: (x) => x };
    (function(module, exports, require2, process3, global, setTimeout, clearTimeout, setInterval, clearInterval, Buffer2, performance) {
      (0, eval)(code + "\n;");
    })(
      moduleObj,
      exportsObj,
      noopRequire,
      localProcess,
      globalThis,
      () => {
      },
      () => {
      },
      () => {
      },
      () => {
      },
      minimalBuffer2,
      void 0
    );
    const ts = globalThis.ts || moduleObj.exports || exportsObj;
    if (!ts || typeof ts.createSourceFile !== "function") {
      throw new Error("bake-geometry-auto: failed to load TypeScript API");
    }
    return ts;
  }
  function extractLiteral(node, ts) {
    if (!node) return { value: null, ok: false };
    if (ts.isNumericLiteral(node)) return { value: parseFloat(node.text), ok: true };
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return { value: node.text, ok: true };
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true, ok: true };
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false, ok: true };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { value: null, ok: true };
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      const inner = extractLiteral(node.operand, ts);
      if (inner.ok && typeof inner.value === "number") return { value: -inner.value, ok: true };
      return { value: null, ok: false };
    }
    if (ts.isParenthesizedExpression(node)) return extractLiteral(node.expression, ts);
    if (ts.isArrayLiteralExpression(node)) {
      const arr = [];
      for (const el of node.elements) {
        const v = extractLiteral(el, ts);
        if (!v.ok) return { value: null, ok: false };
        arr.push(v.value);
      }
      return { value: arr, ok: true };
    }
    if (ts.isObjectLiteralExpression(node)) {
      const obj = {};
      for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p)) return { value: null, ok: false };
        let name;
        if (ts.isIdentifier(p.name)) name = p.name.text;
        else if (ts.isStringLiteral(p.name)) name = p.name.text;
        else return { value: null, ok: false };
        const v = extractLiteral(p.initializer, ts);
        if (!v.ok) return { value: null, ok: false };
        obj[name] = v.value;
      }
      return { value: obj, ok: true };
    }
    return { value: null, ok: false };
  }
  function tagName(element, ts) {
    const tag = element.tagName;
    if (ts.isIdentifier(tag)) return tag.text;
    if (ts.isPropertyAccessExpression(tag)) {
      const lhs = ts.isIdentifier(tag.expression) ? tag.expression.text : null;
      return lhs ? `${lhs}.${tag.name.text}` : tag.name.text;
    }
    return null;
  }
  var KNOWN_GEOMETRY_IDS = new Set(Object.keys(GEOMETRIES));
  function geometryDefId(node, ts) {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) return node.name.text;
    return null;
  }
  function collectGeometryAliases(sf, ts) {
    const aliases = /* @__PURE__ */ new Map();
    for (const stmt of sf.statements ?? []) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList?.declarations ?? []) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
          const target = geometryDefId(decl.initializer, ts);
          if (target && target !== decl.name.text) aliases.set(decl.name.text, target);
        }
      } else if (ts.isImportDeclaration(stmt)) {
        const named = stmt.importClause?.namedBindings;
        if (named && ts.isNamedImports(named)) {
          for (const spec of named.elements) {
            const imported = spec.propertyName?.text;
            if (imported && imported !== spec.name.text) aliases.set(spec.name.text, imported);
          }
        }
      }
    }
    return aliases;
  }
  function resolveGeometryId(node, ts, aliases) {
    let id = geometryDefId(node, ts);
    let hops = 0;
    while (id && aliases.has(id) && hops < 16) {
      id = aliases.get(id);
      hops++;
    }
    return id && KNOWN_GEOMETRY_IDS.has(id) ? id : null;
  }
  function isRelativeSpecifier(specifier) {
    return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
  }
  function isAbsolutePath(path) {
    return path.startsWith("/");
  }
  function normalizePath(path) {
    const absolute = isAbsolutePath(path);
    const parts = path.split("/");
    const stack = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
        else if (!absolute) stack.push(part);
      } else {
        stack.push(part);
      }
    }
    return `${absolute ? "/" : ""}${stack.join("/")}` || (absolute ? "/" : ".");
  }
  function dirname(path) {
    const normalized = normalizePath(path);
    const index = normalized.lastIndexOf("/");
    if (index < 0) return ".";
    if (index === 0) return "/";
    return normalized.slice(0, index);
  }
  function joinPath(base, next) {
    return normalizePath(`${base}/${next}`);
  }
  function resolveImportPath(importer, specifier) {
    if (!isRelativeSpecifier(specifier)) return null;
    const base = joinPath(dirname(importer), specifier);
    const candidates = /\.(tsx?|jsx?)$/.test(base) ? [base] : [
      `${base}.tsx`,
      `${base}.ts`,
      `${base}.jsx`,
      `${base}.js`,
      `${base}/index.tsx`,
      `${base}/index.ts`,
      `${base}/index.jsx`,
      `${base}/index.js`
    ];
    return candidates.find((candidate) => !candidate.endsWith(".d.ts") && fsExists(candidate)) ?? null;
  }
  function importedSourcePaths(sf, filename, ts) {
    const paths = [];
    for (const statement of sf.statements ?? []) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const resolved = resolveImportPath(filename, specifier.text);
      if (resolved) paths.push(resolved);
    }
    return paths;
  }
  function scanFile(filename, ts, state) {
    const normalizedFilename = normalizePath(filename);
    if (state.seenFiles.has(normalizedFilename)) return;
    state.seenFiles.add(normalizedFilename);
    const source = fsRead(normalizedFilename);
    const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const aliases = collectGeometryAliases(sf, ts);
    function visit(node) {
      const opening = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxElement(node) ? node.openingElement : null;
      const tag = opening ? tagName(opening, ts) : null;
      if (opening && (tag === "Scene3D.Mesh" || tag === "Scene3D.Instances")) {
        state.meshTotal++;
        let geomNode = null;
        let paramsNode = null;
        for (const attr of opening.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !attr.name) continue;
          const init = attr.initializer;
          if (!init || !ts.isJsxExpression(init) || !init.expression) continue;
          if (attr.name.text === "geometry") geomNode = init.expression;
          else if (attr.name.text === "params") paramsNode = init.expression;
        }
        if (geomNode && paramsNode) {
          const defId = resolveGeometryId(geomNode, ts, aliases);
          const params = extractLiteral(paramsNode, ts);
          if (defId && params.ok && params.value !== null && typeof params.value === "object") {
            const key2 = defId + "|" + JSON.stringify(params.value, Object.keys(params.value).sort());
            if (!state.seenItems.has(key2)) {
              state.seenItems.add(key2);
              state.items.push({ geometry: defId, params: params.value });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    for (const importPath2 of importedSourcePaths(sf, normalizedFilename, ts)) {
      scanFile(importPath2, ts, state);
    }
  }
  function scan(entryPath, ts) {
    const state = {
      items: [],
      seenItems: /* @__PURE__ */ new Set(),
      seenFiles: /* @__PURE__ */ new Set(),
      meshTotal: 0
    };
    scanFile(entryPath, ts, state);
    return { items: state.items, meshTotal: state.meshTotal, fileTotal: state.seenFiles.size };
  }
  async function run3(argv) {
    const args = parseArgs(argv, { positional: ["cart"], flags: { out: "string" } });
    const cartArg = args.positional.cart;
    if (!cartArg) {
      err("bake-geometry-auto: usage: rjit bake-geometry-auto <cart-source.tsx> [--out <manifest.json>]");
      return 2;
    }
    if (!fsExists(cartArg)) {
      err(`bake-geometry-auto: source not found: ${cartArg}`);
      return 2;
    }
    let ts;
    try {
      ts = loadTypeScript();
    } catch (e) {
      err(`bake-geometry-auto: ${e.message}`);
      return 1;
    }
    const { items, meshTotal, fileTotal } = scan(cartArg, ts);
    const json = JSON.stringify(items, null, 2);
    const outPath = args.flags.out;
    if (outPath) {
      fsWrite(outPath, json + "\n");
      out(`bake-geometry-auto: ${cartArg} \u2192 ${items.length}/${meshTotal} Scene3D geometry elements bakeable across ${fileTotal} files \u2192 ${outPath}`);
      out(`  next: rjit bake-geometry --manifest ${outPath}`);
    } else {
      __writeStdout(json + "\n");
      err(`bake-geometry-auto: ${cartArg} \u2192 ${items.length}/${meshTotal} Scene3D geometry elements bakeable across ${fileTotal} files`);
    }
    return 0;
  }

  // cli/commands/bake-icons.ts
  var bake_icons_exports = {};
  __export(bake_icons_exports, {
    bakeIconAtlas: () => bakeIconAtlas,
    run: () => run4
  });
  var VIEWBOX = 24;
  var HIRES = 256;
  var TILE = 32;
  var STROKE_HIRES = 4;
  var SPREAD_HIRES = 18;
  var ATLAS_COLS = 16;
  var PADDING = 2;
  var HEX = "0123456789abcdef";
  async function run4(argv) {
    if (argv[0] === "--help" || argv[0] === "-h") {
      __writeStdout("Usage: rjit bake-icons [--if-needed] [--quiet]\n");
      return 0;
    }
    const opts = {};
    for (const arg of argv) {
      if (arg === "--if-needed") opts.ifNeeded = true;
      else if (arg === "--quiet") opts.quiet = true;
      else {
        err("[bake-icons] usage: rjit bake-icons [--if-needed] [--quiet]");
        return 1;
      }
    }
    return bakeIconAtlas(opts);
  }
  function bakeIconAtlas(opts = {}) {
    const root = opts.root || __env("RJIT_HOME") || __cwd();
    const iconsTs = `${root}/runtime/icons/icons.ts`;
    const outZig = `${root}/framework/gpu/icon_atlas.zig`;
    const outPgmHex = `${root}/framework/gpu/icon_atlas_debug.ppm.txt`;
    const outTs = `${root}/runtime/icons/baked-names.ts`;
    const srcRaw = fsRead(iconsTs);
    const iconNames = discoverIconNames(srcRaw);
    if (iconNames.length === 0) {
      return fail2("no icons discovered in runtime/icons/icons.ts");
    }
    const glyphs = loadPaintGlyphs(root);
    const glyphNames = glyphs.map((g) => g.name);
    const paintIconsTs = `${root}/runtime/paint/icons.ts`;
    const paintModelTs = `${root}/runtime/paint/model.ts`;
    const expectedNames = [...iconNames, ...glyphNames];
    if (opts.ifNeeded && atlasIsCurrent([iconsTs, paintIconsTs, paintModelTs], outZig, outPgmHex, outTs, expectedNames)) {
      log(`atlas current (${expectedNames.length} icons)`, opts);
      return 0;
    }
    const polylines = {};
    const missing = [];
    for (const name of iconNames) {
      const data = loadIcon(srcRaw, name);
      if (!data) {
        missing.push(name);
        continue;
      }
      polylines[name] = data;
    }
    if (missing.length) return fail2(`missing icons in icons.ts: ${missing.join(", ")}`);
    const items = [
      ...iconNames.map((name) => ({ name, raster: () => rasterizePolylines(polylines[name]) })),
      ...glyphs.map((g) => ({ name: g.name, raster: () => rasterizeGlyph(g) }))
    ];
    const cols = ATLAS_COLS;
    const rows = Math.ceil(items.length / cols);
    const cellPx = TILE + PADDING * 2;
    const atlasW = cols * cellPx;
    const atlasH = rows * cellPx;
    const atlas = new Uint8Array(atlasW * atlasH);
    const meta = [];
    log(`baking ${items.length} icons (${iconNames.length} lucide + ${glyphs.length} paint) into ${atlasW}x${atlasH} R8 atlas (tile ${TILE}, hires ${HIRES})`, opts);
    for (let i = 0; i < items.length; i++) {
      const { name, raster } = items[i];
      const t0 = Date.now();
      const mask = raster();
      const sdf = distanceTransform(mask);
      const hi = encodeSdf(sdf);
      const tile = downsample(hi);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const u = col * cellPx + PADDING;
      const v = row * cellPx + PADDING;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          atlas[(v + y) * atlasW + (u + x)] = tile[y * TILE + x];
        }
      }
      meta.push({ name, u, v, w: TILE, h: TILE });
      log(`  [${i + 1}/${items.length}] ${name} (${Date.now() - t0}ms)`, opts);
    }
    fsWrite(outZig, emitZig(atlas, meta, atlasW, atlasH));
    log(`wrote ${outZig} (${meta.length} icons + ${atlas.length}-byte atlas inlined)`, opts);
    fsWrite(outPgmHex, emitPgmHex(atlas, atlasW, atlasH));
    log(`wrote ${outPgmHex} - preview via:`, opts);
    log(`  xxd -r -p ${outPgmHex} > /tmp/icon_atlas.pgm && xdg-open /tmp/icon_atlas.pgm`, opts);
    fsWrite(outTs, emitNamesTs(meta));
    log(`wrote ${outTs}`, opts);
    log("done.", opts);
    return 0;
  }
  function discoverIconNames(src) {
    const names = [];
    const seen = /* @__PURE__ */ new Set();
    const re = /^export const ([A-Za-z0-9_]+): number\[\]\[] = /gm;
    let match;
    while ((match = re.exec(src)) !== null) {
      const name = match[1];
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  }
  function atlasIsCurrent(sources, outZig, outPgmHex, outTs, expectedNames) {
    const zig = tryFsStat(outZig);
    const pgm = tryFsStat(outPgmHex);
    const ts = tryFsStat(outTs);
    if (!zig || !pgm || !ts) return false;
    let newest = 0;
    for (const s of sources) {
      const st = tryFsStat(s);
      if (!st) return false;
      newest = Math.max(newest, st.mtimeMs);
    }
    if (zig.mtimeMs < newest || pgm.mtimeMs < newest || ts.mtimeMs < newest) return false;
    const baked = readBakedNames(outTs);
    if (baked.size !== expectedNames.length) return false;
    for (const name of expectedNames) {
      if (!baked.has(name)) return false;
    }
    return true;
  }
  function loadPaintGlyphs(root) {
    const entry = `${root}/scripts/paint-glyph-source.ts`;
    if (!tryFsStat(entry)) {
      err("[bake-icons] scripts/paint-glyph-source.ts missing \u2014 skipping paint glyphs");
      return [];
    }
    const bundled = spawnSync(`${root}/tools/esbuild`, [
      "--bundle",
      "--format=cjs",
      "--platform=neutral",
      "--target=es2022",
      "--log-level=warning",
      entry
    ]);
    if (bundled.stderr) __writeStderr(bundled.stderr);
    if (bundled.code !== 0) throw new Error(`[bake-icons] esbuild failed bundling paint glyphs: ${bundled.code}`);
    const moduleObj = { exports: {} };
    new Function("module", "exports", bundled.stdout)(moduleObj, moduleObj.exports);
    const glyphs = moduleObj.exports.default || moduleObj.exports;
    if (!Array.isArray(glyphs)) throw new Error("[bake-icons] paint-glyph-source did not default-export an array");
    return glyphs;
  }
  function fillPolygon(mask, flat, scale) {
    const n = flat.length / 2;
    if (n < 3) return;
    const xs = new Array(n), ys = new Array(n);
    let minY = HIRES, maxY = 0;
    for (let i = 0; i < n; i++) {
      xs[i] = flat[i * 2] * scale;
      ys[i] = flat[i * 2 + 1] * scale;
      minY = Math.min(minY, ys[i]);
      maxY = Math.max(maxY, ys[i]);
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(HIRES - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      const xings = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = ys[i], yj = ys[j];
        if (yi <= sy && yj > sy || yj <= sy && yi > sy) {
          xings.push(xs[i] + (sy - yi) / (yj - yi) * (xs[j] - xs[i]));
        }
      }
      xings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xings.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xings[k] - 0.5));
        const xb = Math.min(HIRES - 1, Math.floor(xings[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) mask[y * HIRES + x] = 1;
      }
    }
  }
  function rasterizeGlyph(glyph) {
    const mask = new Uint8Array(HIRES * HIRES);
    const scale = HIRES / VIEWBOX;
    const r = STROKE_HIRES * 0.5;
    for (const fill of glyph.fills) fillPolygon(mask, fill, scale);
    for (const stroke of glyph.strokes) {
      const n = stroke.length / 2;
      if (n < 1) continue;
      plotDisc(mask, HIRES, HIRES, stroke[0] * scale, stroke[1] * scale, r);
      for (let i = 1; i < n; i++) {
        plotSegment(
          mask,
          HIRES,
          HIRES,
          stroke[(i - 1) * 2] * scale,
          stroke[(i - 1) * 2 + 1] * scale,
          stroke[i * 2] * scale,
          stroke[i * 2 + 1] * scale,
          r
        );
      }
    }
    return mask;
  }
  function readBakedNames(outTs) {
    const raw = fsRead(outTs);
    const names = /* @__PURE__ */ new Set();
    const re = /^\s+"([^"]+)",\s*$/gm;
    let match;
    while ((match = re.exec(raw)) !== null) names.add(match[1]);
    return names;
  }
  function loadIcon(src, name) {
    const needle = `export const ${name}: number[][] = `;
    const start = src.indexOf(needle);
    if (start < 0) return null;
    let i = start + needle.length;
    let depth = 0;
    const begin = i;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          return JSON.parse(src.slice(begin, i + 1));
        }
      }
      i++;
    }
    return null;
  }
  function plotDisc(mask, w, h, cx, cy, r) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) mask[y * w + x] = 1;
      }
    }
  }
  function plotSegment(mask, w, h, x0, y0, x1, y1, r) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-3) {
      plotDisc(mask, w, h, x0, y0, r);
      return;
    }
    const steps = Math.max(1, Math.ceil(len * 1.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      plotDisc(mask, w, h, x0 + dx * t, y0 + dy * t, r);
    }
  }
  function rasterizePolylines(polylines) {
    const mask = new Uint8Array(HIRES * HIRES);
    const scale = HIRES / VIEWBOX;
    const r = STROKE_HIRES * 0.5;
    for (const poly of polylines) {
      if (poly.length < 2) continue;
      plotDisc(mask, HIRES, HIRES, poly[0] * scale, poly[1] * scale, r);
      for (let i = 2; i + 1 < poly.length; i += 2) {
        plotSegment(
          mask,
          HIRES,
          HIRES,
          poly[i - 2] * scale,
          poly[i - 1] * scale,
          poly[i] * scale,
          poly[i + 1] * scale,
          r
        );
      }
    }
    return mask;
  }
  function distanceTransform(mask) {
    const w = HIRES;
    const h = HIRES;
    const sdf = new Float32Array(w * h);
    const r = SPREAD_HIRES;
    const r2 = r * r;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (mask[idx]) {
          sdf[idx] = 0;
          continue;
        }
        let best = r2;
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(w - 1, x + r);
        const y0 = Math.max(0, y - r);
        const y1 = Math.min(h - 1, y + r);
        for (let yy = y0; yy <= y1; yy++) {
          const dy = yy - y;
          const dy2 = dy * dy;
          if (dy2 >= best) continue;
          const row = yy * w;
          for (let xx = x0; xx <= x1; xx++) {
            if (!mask[row + xx]) continue;
            const dx = xx - x;
            const d2 = dx * dx + dy2;
            if (d2 < best) best = d2;
          }
        }
        sdf[idx] = Math.sqrt(best);
      }
    }
    return sdf;
  }
  function encodeSdf(sdf) {
    const out2 = new Uint8Array(sdf.length);
    for (let i = 0; i < sdf.length; i++) {
      const v = 1 - sdf[i] / SPREAD_HIRES;
      out2[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    return out2;
  }
  function downsample(hi) {
    const factor = HIRES / TILE;
    if (Math.floor(factor) !== factor) throw new Error("HIRES must be integer multiple of TILE");
    const lo = new Uint8Array(TILE * TILE);
    const f2 = factor * factor;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        let sum = 0;
        const sy = y * factor;
        const sx = x * factor;
        for (let dy = 0; dy < factor; dy++) {
          const row = (sy + dy) * HIRES;
          for (let dx = 0; dx < factor; dx++) {
            sum += hi[row + sx + dx];
          }
        }
        lo[y * TILE + x] = Math.round(sum / f2);
      }
    }
    return lo;
  }
  function emitZig(atlas, meta, atlasW, atlasH) {
    let zig = "// Auto-generated by scripts/bake-icons.js \u2014 do not edit.\n";
    zig += "// Source: runtime/icons/icons.ts\n";
    zig += `// Atlas: ${atlasW}x${atlasH} R8, ${meta.length} icons, tile=${TILE}, hires=${HIRES}.
`;
    zig += `// SDF encoding: byte = clamp(255 * (1 - dist/${SPREAD_HIRES}_hires_px), 0, 255).
`;
    zig += `// Effective spread in tile space: ${SPREAD_HIRES * TILE / HIRES} px.
`;
    zig += `// Smoothstep edge sits at byte 128 (== distance ${SPREAD_HIRES / 2} hires px).

`;
    zig += `pub const ATLAS_W: u32 = ${atlasW};
`;
    zig += `pub const ATLAS_H: u32 = ${atlasH};
`;
    zig += `pub const TILE: u32 = ${TILE};
`;
    zig += `pub const SPREAD_TILE_PX: f32 = ${(SPREAD_HIRES * TILE / HIRES).toFixed(4)};

`;
    zig += "pub const IconUv = struct { name: []const u8, u: u32, v: u32, w: u32, h: u32 };\n\n";
    zig += "pub const ICONS = [_]IconUv{\n";
    for (const m of meta) {
      zig += `    .{ .name = "${m.name}", .u = ${m.u}, .v = ${m.v}, .w = ${m.w}, .h = ${m.h} },
`;
    }
    zig += "};\n\n";
    zig += "pub const ATLAS = [_]u8{\n";
    for (let i = 0; i < atlas.length; i += 16) {
      let row = "   ";
      for (let j = 0; j < 16 && i + j < atlas.length; j++) {
        row += ` ${atlas[i + j]},`;
      }
      zig += `${row}
`;
    }
    zig += "};\n";
    return zig;
  }
  function emitPgmHex(atlas, atlasW, atlasH) {
    const header = `P5
${atlasW} ${atlasH}
255
`;
    let hexDump = "";
    for (let i = 0; i < header.length; i++) hexDump += hexByte(header.charCodeAt(i));
    hexDump += bytesToHex(atlas);
    let wrapped = "";
    for (let i = 0; i < hexDump.length; i += 64) {
      wrapped += `${hexDump.slice(i, i + 64)}
`;
    }
    return wrapped;
  }
  function emitNamesTs(meta) {
    let ts = "// Auto-generated by scripts/bake-icons.js \u2014 do not edit.\n";
    ts += "// Names of icons present in the SDF atlas (framework/gpu/icon_atlas.zig).\n";
    ts += "// Icon.tsx checks membership before routing to the SDF primitive; misses\n";
    ts += "// fall through to the legacy <Graph.Path> renderer.\n\n";
    ts += "export const BAKED_ICON_NAMES: ReadonlySet<string> = new Set([\n";
    for (const m of meta) ts += `  "${m.name}",
`;
    ts += "]);\n";
    return ts;
  }
  function bytesToHex(bytes) {
    let out2 = "";
    for (let i = 0; i < bytes.length; i++) out2 += hexByte(bytes[i]);
    return out2;
  }
  function hexByte(value) {
    return HEX[value >> 4] + HEX[value & 15];
  }
  function log(message, opts = {}) {
    if (opts.quiet) return;
    __writeStderr(`[bake-icons] ${message}
`);
  }
  function fail2(message) {
    err(`[bake-icons] ${message}`);
    return 1;
  }

  // cli/commands/cart-manifest-field.ts
  var cart_manifest_field_exports = {};
  __export(cart_manifest_field_exports, {
    run: () => run5
  });

  // cli/cart/manifest.ts
  function loadManifest(path) {
    return fsReadJson(path);
  }
  function manifestField(manifest2, dotted) {
    let current = manifest2;
    for (const part of dotted.split(".")) {
      if (current === null || current === void 0 || typeof current !== "object") {
        return void 0;
      }
      current = current[part];
    }
    return current;
  }

  // cli/commands/cart-manifest-field.ts
  async function run5(argv) {
    let parsed;
    try {
      parsed = parseArgs(argv.slice(0, 2), { positional: ["manifestPath", "fieldName"] });
    } catch (error) {
      err(`[cart-manifest-field] ${error.message}`);
      return 1;
    }
    const manifestPath = parsed.positional.manifestPath;
    const fieldName = parsed.positional.fieldName;
    if (!manifestPath || !fieldName) {
      err("[cart-manifest-field] usage: cart-manifest-field <cart.json> <field>");
      return 1;
    }
    const manifest2 = loadManifest(manifestPath);
    const value = manifestField(manifest2, fieldName);
    if (value === void 0 || value === null) return 0;
    if (typeof value === "string") out(value);
    else if (typeof value === "number" || typeof value === "boolean") out(String(value));
    else out(JSON.stringify(value));
    return 0;
  }

  // cli/commands/cart-bundle.ts
  var cart_bundle_exports = {};
  __export(cart_bundle_exports, {
    run: () => run6
  });

  // cli/cart/bundle.ts
  function bundleFlags(opts) {
    const cartridge = opts.mode === "cartridge";
    const tui = opts.mode === "tui-host";
    const runtimeEntry = cartridge ? `${opts.rjitHome}/runtime/cartridge_entry.tsx` : tui ? `${opts.rjitHome}/tui/entry.tsx` : `${opts.rjitHome}/runtime/index.tsx`;
    const reactAlias = cartridge ? `${opts.rjitHome}/runtime/cart_externs/react.cjs` : `${opts.rjitHome}/deps/react`;
    const reconcilerAlias = cartridge ? `${opts.rjitHome}/runtime/cart_externs/react_reconciler.cjs` : `${opts.rjitHome}/deps/react-reconciler`;
    const schedulerAlias = cartridge ? `${opts.rjitHome}/runtime/cart_externs/scheduler.cjs` : `${opts.rjitHome}/deps/scheduler`;
    const flags = [
      runtimeEntry,
      "--bundle",
      `--outfile=${opts.outFile}`
    ];
    if (opts.metafile !== false) flags.push(`--metafile=${opts.outFile}.metafile.json`);
    if (tui) {
      flags.push(
        "--platform=neutral",
        "--main-fields=module,main",
        "--target=es2020",
        "--jsx=automatic",
        "--jsx-import-source=react",
        "--format=cjs",
        '--define:process.env.NODE_ENV="production"',
        `--define:__TUI_COLS__=${opts.termCols ?? 80}`,
        `--define:__TUI_ROWS__=${opts.termRows ?? 24}`,
        "--log-level=warning",
        "--resolve-extensions=.tsx,.ts,.jsx,.js",
        "--conditions=default"
      );
    } else {
      flags.push(
        "--format=iife",
        "--jsx-factory=__jsx",
        "--jsx-fragment=Fragment",
        `--inject:${opts.rjitHome}/runtime/jsx_shim.ts`,
        `--inject:${opts.rjitHome}/runtime/ambient.ts`,
        `--inject:${opts.rjitHome}/runtime/ambient_primitives.ts`
      );
    }
    flags.push(
      // The game ground floor (V17): labs/editors write `import { GAME_* } from
      // '@game'`. That import is ALSO the metafile-gate signal that opts a cart
      // into the game's host bindings (V18 — gated ingredient, 2D carts pay zero).
      `--alias:@game=${opts.rjitHome}/cart/hmsc-int/game`,
      `--alias:@reactjit/core=${opts.rjitHome}/runtime/core_stub.ts`,
      `--alias:@reactjit/runtime=${opts.rjitHome}/runtime`,
      `--alias:@reactjit/effects=${opts.rjitHome}/runtime/effects`,
      `--alias:@reactjit/geometries=${opts.rjitHome}/runtime/geometries`,
      `--alias:@reactjit/cameras=${opts.rjitHome}/runtime/cameras`,
      // Catch-all: every other @reactjit/* subpath resolves under runtime/ —
      // @reactjit/primitives, /hooks/*, /workspace, /router, /icons/*, etc. esbuild
      // matches the most-specific alias first, so the explicit entries above still
      // win (core -> core_stub.ts, runtime -> the index). Mirrors the proven
      // scripts/cart-bundle.js; without it nothing outside the five above resolves.
      `--alias:@reactjit=${opts.rjitHome}/runtime`,
      `--alias:@cart-entry=${opts.cartEntry}`,
      `--alias:react=${reactAlias}`,
      `--alias:react-reconciler=${reconcilerAlias}`,
      `--alias:scheduler=${schedulerAlias}`,
      `--alias:loose-envify=${opts.rjitHome}/deps/loose-envify`,
      `--alias:js-tokens=${opts.rjitHome}/deps/js-tokens`,
      "--external:path",
      "--external:typescript"
    );
    if (opts.watch) flags.push("--watch=forever", "--log-level=info");
    return flags;
  }
  function bundleCart(opts) {
    return spawnSync(`${opts.rjitHome}/tools/esbuild`, bundleFlags(opts));
  }

  // cli/commands/cart-bundle.ts
  async function run6(argv) {
    if (__env("BUNDLE_FROM_HARNESS") !== "1") {
      err("[cart-bundle] REFUSING to run - this is an internal script, not an entry point.");
      err("[cart-bundle]");
      err("[cart-bundle] Use one of the user-facing entry points instead:");
      err("[cart-bundle]   ./scripts/dev <cart-name>   # dev host + watcher");
      err("[cart-bundle]   ./scripts/ship <cart-name>  # production binary");
      return 1;
    }
    let entryArg = null;
    let outArg = null;
    let cartridgeMode = false;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--out" || arg === "-o") {
        outArg = argv[++i] ?? null;
        continue;
      }
      if (arg === "--cartridge") {
        cartridgeMode = true;
        continue;
      }
      if (arg.startsWith("-")) return die2(`unknown flag: ${arg}`, 2);
      if (entryArg === null) {
        entryArg = arg;
        continue;
      }
      return die2("too many positional args", 2);
    }
    if (!entryArg) return die2("missing cart entry path", 2);
    const root = __cwd();
    const entryAbs = ensureAbs(root, entryArg);
    const bundleAbs = outArg ? ensureAbs(root, outArg) : `${root}/bundle.js`;
    const cartRoot = __env("CART_ROOT") || root;
    const entryInsideHome = entryAbs.startsWith(`${root}/`);
    const entryInsideCart = cartRoot !== root && entryAbs.startsWith(`${cartRoot}/`);
    if (!entryInsideHome && !entryInsideCart) {
      return die2(`entry must stay inside ${root}${cartRoot !== root ? " or " + cartRoot : ""}`, 2);
    }
    if (!fsExists(entryAbs)) return die2(`missing entry: ${entryArg}`, 2);
    const result = bundleCart({
      rjitHome: root,
      cartEntry: entryAbs,
      outFile: bundleAbs,
      mode: cartridgeMode ? "cartridge" : "gpu-host"
    });
    if (result.stderr) __writeStderr(result.stderr);
    if (result.stdout) __writeStdout(result.stdout);
    if (result.code !== 0) {
      err(`[cart-bundle] esbuild exited with code ${result.code}`);
      return result.code || 1;
    }
    out(`[cart-bundle] app=${rel2(root, entryAbs)} bundle=${rel2(root, bundleAbs)}`);
    return 0;
  }
  function ensureAbs(root, path) {
    if (path.startsWith("/")) return path;
    const trimmed = path.startsWith("./") ? path.slice(2) : path;
    return `${root}/${trimmed}`;
  }
  function rel2(root, path) {
    return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  }
  function die2(message, code) {
    err(`[cart-bundle] ${message}`);
    return code || 1;
  }

  // cli/commands/classify.ts
  var classify_exports = {};
  __export(classify_exports, {
    run: () => run7
  });
  function normalizeArgv(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch {
      }
      if (raw.length === 0) return [];
      return [raw];
    }
    if (!raw) return [];
    return [String(raw)];
  }
  var __hostArgv = normalizeArgv(typeof __argv === "function" ? __argv() : __argv);
  var __hostProcess = typeof globalThis.process === "object" && globalThis.process !== null ? globalThis.process : null;
  var process2 = Object.assign({}, __hostProcess || {});
  process2.argv = __hostArgv;
  process2.cwd = typeof __cwd === "function" ? () => __cwd() : process2.cwd;
  process2.exit = typeof __exit === "function" ? (code) => __exit(code | 0) : process2.exit;
  process2.env = typeof __env === "function" ? __env() : process2.env || {};
  process2.platform = "linux";
  process2.nextTick = void 0;
  process2.argv0 = __hostArgv[0] || process2.argv0;
  if (!Array.isArray(process2.argv)) process2.argv = __hostArgv;
  function stringToUtf8Bytes(value) {
    const bytes = [];
    for (let i = 0; i < value.length; i++) {
      let c = value.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
        continue;
      }
      if (c < 2048) {
        bytes.push(c >> 6 | 192);
        bytes.push(c & 63 | 128);
        continue;
      }
      if (c >= 55296 && c <= 56319 && i + 1 < value.length) {
        const next = value.charCodeAt(i + 1);
        if (next >= 56320 && next <= 57343) {
          const cp = (c - 55296 << 10) + (next - 56320) + 65536;
          i++;
          bytes.push(cp >> 18 | 240);
          bytes.push(cp >> 12 & 63 | 128);
          bytes.push(cp >> 6 & 63 | 128);
          bytes.push(cp & 63 | 128);
          continue;
        }
      }
      bytes.push(c >> 12 | 224);
      bytes.push(c >> 6 & 63 | 128);
      bytes.push(c & 63 | 128);
    }
    return new Uint8Array(bytes);
  }
  function utf8BytesToString(bytes) {
    let out2 = "";
    for (let i = 0; i < bytes.length; i++) {
      const c1 = bytes[i];
      if (c1 < 128) {
        out2 += String.fromCharCode(c1);
      } else if ((c1 & 224) === 192 && i + 1 < bytes.length) {
        const c2 = bytes[++i];
        out2 += String.fromCharCode((c1 & 31) << 6 | c2 & 63);
      } else if ((c1 & 240) === 224 && i + 2 < bytes.length) {
        const c2 = bytes[++i];
        const c3 = bytes[++i];
        out2 += String.fromCharCode((c1 & 15) << 12 | (c2 & 63) << 6 | c3 & 63);
      } else if ((c1 & 248) === 240 && i + 3 < bytes.length) {
        const c2 = bytes[++i];
        const c3 = bytes[++i];
        const c4 = bytes[++i];
        const cp = ((c1 & 7) << 18 | (c2 & 63) << 12 | (c3 & 63) << 6 | c4 & 63) - 65536;
        out2 += String.fromCharCode(55296 + (cp >> 10), 56320 + (cp & 1023));
      } else {
        out2 += String.fromCharCode(c1);
      }
    }
    return out2;
  }
  var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function bytesToBase64(bytes) {
    let out2 = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const n = b0 << 16 | (b1 || 0) << 8 | (b2 || 0);
      out2 += base64Chars[n >>> 18 & 63];
      out2 += base64Chars[n >>> 12 & 63];
      out2 += i + 1 < bytes.length ? base64Chars[n >>> 6 & 63] : "=";
      out2 += i + 2 < bytes.length ? base64Chars[n & 63] : "=";
    }
    return out2;
  }
  function base64ToBytes(value) {
    let i = 0;
    const clean = String(value).replace(/[^A-Za-z0-9+/=]/g, "");
    const out2 = [];
    function idx(ch) {
      if (ch === "=") return 0;
      const c = base64Chars.indexOf(ch);
      return c < 0 ? 0 : c;
    }
    while (i < clean.length) {
      const e0 = idx(clean[i++]);
      const e1 = idx(clean[i++]);
      const e2 = idx(clean[i++]);
      const e3 = idx(clean[i++]);
      const n = e0 << 18 | e1 << 12 | e2 << 6 | e3;
      out2.push(n >> 16 & 255);
      if (clean[i - 2] !== "=") out2.push(n >> 8 & 255);
      if (clean[i - 1] !== "=") out2.push(n & 255);
    }
    return new Uint8Array(out2);
  }
  function makeBufferFrom(bytes) {
    return {
      _bytes: bytes,
      toString(encoding) {
        if (encoding === "base64") return bytesToBase64(this._bytes);
        if (encoding === "hex") return [...this._bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
        return utf8BytesToString(this._bytes);
      }
    };
  }
  var minimalBuffer = {
    from(value, encoding) {
      if (typeof encoding === "string") {
        const enc = encoding.toLowerCase();
        if (enc === "base64") {
          return makeBufferFrom(base64ToBytes(value));
        }
      }
      if (typeof value === "string") return makeBufferFrom(stringToUtf8Bytes(value));
      if (value instanceof Uint8Array) return makeBufferFrom(new Uint8Array(value));
      if (value instanceof ArrayBuffer) return makeBufferFrom(new Uint8Array(value));
      if (Array.isArray(value)) return makeBufferFrom(new Uint8Array(value));
      if (typeof value === "number") return makeBufferFrom(new Uint8Array(value));
      return makeBufferFrom(stringToUtf8Bytes(String(value)));
    }
  };
  var console = {
    log: (...args) => __writeStdout(args.map((x) => String(x)).join(" ") + "\n"),
    error: (...args) => __writeStderr(args.map((x) => String(x)).join(" ") + "\n")
  };
  function normalizePath2(value) {
    const raw = String(value || "");
    const absolute = raw.startsWith("/");
    const parts = [];
    for (const p of raw.split("/")) {
      if (!p || p === ".") continue;
      if (p === "..") {
        if (parts.length) parts.pop();
      } else {
        parts.push(p);
      }
    }
    if (absolute) return "/" + parts.join("/");
    return parts.join("/");
  }
  function join(...parts) {
    const filtered = [];
    for (const p of parts) {
      if (!p) continue;
      filtered.push(String(p));
    }
    return normalizePath2(filtered.join("/"));
  }
  function basename2(pathValue) {
    const normalized = normalizePath2(pathValue);
    if (!normalized || normalized === "/") return "";
    const segs = normalized.split("/");
    return segs[segs.length - 1];
  }
  function splitPath(pathValue) {
    const normalized = normalizePath2(pathValue);
    if (normalized === "/" || normalized === ".") return { absolute: normalized === "/", parts: [] };
    const absolute = normalized.startsWith("/");
    const noRoot = absolute ? normalized.slice(1) : normalized;
    return { absolute, parts: noRoot ? noRoot.split("/") : [] };
  }
  function relative(from, to) {
    const fromParts = splitPath(from);
    const toParts = splitPath(to);
    if (fromParts.absolute !== toParts.absolute) return normalizePath2(to);
    const a = fromParts.parts;
    const b = toParts.parts;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    const up = new Array(a.length - i).fill("..");
    const down = b.slice(i);
    const out2 = up.concat(down).join("/");
    return out2 || ".";
  }
  function toNumber(v) {
    return Number(v) || 0;
  }
  function toStatObject(value) {
    if (value === null || value === void 0) return null;
    if (typeof value === "object") {
      return value;
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === "object" && parsed !== null) return parsed;
      } catch {
      }
    }
    return null;
  }
  function normalizeStat(stat) {
    if (!stat) return null;
    const s = toStatObject(stat);
    if (!s) return null;
    const isDir = (() => {
      if (typeof s.isDir === "boolean") return s.isDir;
      if (typeof s.is_dir === "boolean") return s.is_dir;
      if (typeof s.isDirectory === "boolean") return s.isDirectory;
      if (typeof s.is_file === "boolean") return !s.is_file;
      if (typeof s.is_file === "function") {
        try {
          return !s.is_file();
        } catch {
        }
      }
      if (typeof s.isFile === "function") {
        try {
          return !s.isFile();
        } catch {
        }
      }
      return false;
    })();
    const isFile = (() => {
      if (typeof s.is_file === "boolean") return s.is_file;
      if (typeof s.isFile === "boolean") return s.isFile;
      if (typeof s.is_file === "function") {
        try {
          return !!s.is_file();
        } catch {
        }
      }
      if (typeof s.isFile === "function") {
        try {
          return !!s.isFile();
        } catch {
        }
      }
      return !isDir;
    })();
    return {
      is_file: !!isFile,
      size: toNumber(s.size ?? 0),
      mtime_ms: toNumber(s.mtime_ms ?? s.mtimeMs ?? 0),
      is_dir: !!isDir
    };
  }
  function statSync(pathValue) {
    return normalizeStat(__fs_stat_json(pathValue));
  }
  function existsSync(pathValue) {
    return !!__fs_exists(pathValue);
  }
  function readFileSync(pathValue) {
    const text = __fs_read(pathValue);
    if (text == null) {
      throw new Error(`ENOENT: no such file ${pathValue}`);
    }
    return text;
  }
  function writeFileSync(pathValue, data) {
    const ok = __fs_write(pathValue, String(data));
    if (!ok) throw new Error(`EIO: unable to write ${pathValue}`);
    return void 0;
  }
  function readdirSync(pathValue, options = {}) {
    const raw = __fs_list_json(pathValue);
    let names = null;
    if (Array.isArray(raw)) names = raw;
    else {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) names = parsed;
      } catch {
      }
    }
    if (!Array.isArray(names)) {
      throw new Error(`ENOENT: no such directory ${pathValue}`);
    }
    if (options.withFileTypes) {
      return names.map((name) => {
        const entryStat = statSync(join(pathValue, name)) || {};
        return {
          name,
          isDirectory() {
            return !!entryStat.is_dir;
          },
          isFile() {
            return !!entryStat.is_file;
          },
          isSymbolicLink() {
            return false;
          }
        };
      });
    }
    return [...names];
  }
  function loadTypeScript2() {
    const tsPath = [join(__cwd(), "vendor", "typescript", "typescript.js"), join(__cwd(), "deps", "typescript", "typescript.js")].find((candidate) => __fs_exists(candidate));
    const code = tsPath ? __fs_read(tsPath) : null;
    if (code === null) {
      throw new Error(`Missing deps/typescript/typescript.js at ${join(__cwd(), "deps", "typescript", "typescript.js")}`);
    }
    const module = { exports: {} };
    const exports = module.exports;
    const localProcess = {
      nextTick: void 0,
      argv: [],
      env: {},
      cwd: () => __cwd(),
      pid: 1,
      platform: "linux",
      execArgv: [],
      platformVersion: "",
      version: "",
      memoryUsage: () => ({ heapUsed: 0 }),
      stdout: { write: (s) => __writeStdout(String(s)), columns: 80, isTTY: false },
      stderr: { write: (s) => __writeStderr(String(s)) },
      exit: (code2) => __exit(code2 | 0)
    };
    function noopRequire(name) {
      throw new Error(`require("${name}") is unavailable under v8cli classification runtime`);
    }
    (function(module2, exports2, require2, process3, global, setTimeout, clearTimeout, setInterval, clearInterval, Buffer2, performance) {
      (0, eval)(code + "\n;");
    })(
      module,
      exports,
      noopRequire,
      localProcess,
      globalThis,
      () => {
      },
      () => {
      },
      () => {
      },
      () => {
      },
      minimalBuffer,
      void 0
    );
    const ts = globalThis.ts || module.exports || exports;
    if (!ts || typeof ts.createSourceFile !== "function") {
      throw new Error("Failed to load vendored TypeScript API");
    }
    return ts;
  }
  var CLASSIFIER_PRIMITIVES = /* @__PURE__ */ new Set([
    "Box",
    "Text",
    "Image",
    "Pressable",
    "ScrollView",
    "TextInput",
    "TextArea",
    "TextEditor",
    "Canvas",
    "Graph",
    "Native"
  ]);
  var TAG_TO_PRIMITIVE = {
    "Box": "Box",
    "View": "Box",
    "view": "Box",
    "div": "Box",
    "Row": "Box",
    "FlexRow": "Box",
    "Col": "Box",
    "FlexColumn": "Box",
    "Text": "Text",
    "text": "Text",
    "span": "Text",
    "p": "Text",
    "Image": "Image",
    "image": "Image",
    "img": "Image",
    "Pressable": "Pressable",
    "button": "Pressable",
    "ScrollView": "ScrollView",
    "TextInput": "TextInput",
    "Input": "TextInput",
    "input": "TextInput",
    "TextArea": "TextArea",
    "textarea": "TextArea",
    "TextEditor": "TextEditor",
    "Canvas": "Canvas",
    "Graph": "Graph",
    "Native": "Native"
  };
  function injectFlexDirectionForTag(tagName2, styleStatics) {
    if ((tagName2 === "Row" || tagName2 === "FlexRow") && !("flexDirection" in styleStatics)) {
      styleStatics.flexDirection = "row";
    }
  }
  var COCKPIT_TOKENS = {
    // surfaces
    bg: "#0e0b09",
    bg1: "#14100d",
    bg2: "#1a1511",
    // paper
    paper: "#e8dcc4",
    paperAlt: "#eadfca",
    paperInk: "#2a1f14",
    paperInkDim: "#7a6e5d",
    paperRule: "#3a2a1e",
    paperRuleBright: "#8a4a20",
    // ink
    ink: "#f2e8dc",
    inkDim: "#b8a890",
    inkDimmer: "#7a6e5d",
    inkGhost: "#4a4238",
    // rules
    rule: "#3a2a1e",
    ruleBright: "#8a4a20",
    // accent
    accent: "#d26a2a",
    accentHot: "#e8501c",
    // state
    ok: "#6aa390",
    warn: "#d6a54a",
    flag: "#e14a2a",
    // auxiliary
    lilac: "#8a7fd4",
    blue: "#5a8bd6",
    // categories (data channels)
    sys: "#5a8bd6",
    ctx: "#8a7fd4",
    usr: "#6aa390",
    ast: "#d26a2a",
    atch: "#d48aa7",
    tool: "#6ac3d6",
    wnd: "#e14a2a",
    pin: "#8aca6a",
    // decorative
    gridDot: "rgba(138, 74, 32, 0.08)",
    gridDotStrong: "rgba(138, 74, 32, 0.18)",
    // typography (strings)
    fontMono: "'JetBrains Mono', 'IBM Plex Mono', 'Menlo', monospace",
    fontSans: "'Inter Tight', 'Inter', system-ui, sans-serif",
    // type sizes (numbers)
    typeMicro: 7,
    typeTiny: 8,
    typeCaption: 9,
    typeBody: 10,
    typeBase: 11,
    typeMeta: 12,
    typeStrong: 14,
    typeHeading: 18,
    // radius
    radiusSm: 4,
    radiusMd: 6,
    radiusLg: 8,
    radiusXl: 10,
    radiusPill: 99,
    radiusRound: 999,
    // spacing rhythm
    spaceX0: 1,
    spaceX1: 2,
    spaceX2: 4,
    spaceX3: 6,
    spaceX4: 8,
    spaceX5: 10,
    spaceX6: 12,
    spaceX7: 16,
    spaceX8: 18,
    // chrome heights
    chromeTopbar: 28,
    chromeStatusbar: 22,
    chromeTileHead: 20,
    chromeStrip: 28,
    // letter spacing
    lsTight: "0.05em",
    lsNormal: "0.08em",
    lsWide: "0.1em",
    lsWider: "0.12em",
    lsWidest: "0.15em",
    lsUltra: "0.2em",
    lsBrand: "0.24em",
    // misc
    lineHeight: 1.35
  };
  function resolveThemeValue(v) {
    if (typeof v === "string" && v.startsWith("theme:")) {
      const name = v.slice("theme:".length);
      if (name in COCKPIT_TOKENS) return COCKPIT_TOKENS[name];
    }
    return v;
  }
  function resolveThemeStyleObj(obj) {
    if (!obj || typeof obj !== "object") return obj;
    const out2 = {};
    for (const [k, v] of Object.entries(obj)) {
      out2[k] = resolveThemeValue(v);
    }
    return out2;
  }
  var THEME_PROP_MAP = {
    "bg": "theme:bg",
    "bgAlt": "theme:bgAlt",
    "bgElevated": "theme:bgElevated",
    "text": "theme:text",
    "textSecondary": "theme:textSecondary",
    "textDim": "theme:textDim",
    "muted": "theme:textDim",
    // common alias
    "primary": "theme:primary",
    "primaryHover": "theme:primaryHover",
    "primaryPressed": "theme:primaryPressed",
    "surface": "theme:surface",
    "surfaceHover": "theme:surfaceHover",
    "border": "theme:border",
    "borderFocus": "theme:borderFocus",
    "accent": "theme:accent",
    "error": "theme:error",
    "warning": "theme:warning",
    "success": "theme:success",
    "info": "theme:info"
  };
  var THEME_VARS = /* @__PURE__ */ new Set(["c", "colors", "theme", "themeColors"]);
  function defaultScanDir(cwd) {
    const cart = join(cwd, "cart");
    if (existsSync(cart)) return cart;
    return join(cwd, "src");
  }
  function findTsxFiles(dir) {
    const results = [];
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        results.push(...findTsxFiles(full));
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".cls.ts")) {
        results.push(full);
      }
    }
    return results;
  }
  function getTagName(element, ts) {
    const tag = element.tagName;
    if (ts.isIdentifier(tag)) return tag.text;
    if (ts.isPropertyAccessExpression(tag)) return tag.name.text;
    return null;
  }
  function extractValue(node, ts) {
    if (!node) return { value: null, kind: "dynamic" };
    if (ts.isNumericLiteral(node)) {
      return { value: parseFloat(node.text), kind: "literal" };
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return { value: node.text, kind: "literal" };
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true, kind: "literal" };
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false, kind: "literal" };
    if (ts.isPropertyAccessExpression(node)) {
      const obj = node.expression;
      const prop = node.name.text;
      if (ts.isIdentifier(obj) && THEME_VARS.has(obj.text) && THEME_PROP_MAP[prop]) {
        return { value: THEME_PROP_MAP[prop], kind: "theme" };
      }
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
      return { value: -parseFloat(node.operand.text), kind: "literal" };
    }
    return { value: null, kind: "dynamic" };
  }
  function extractStyleProps(objLit, ts) {
    const statics = {};
    const dynamicKeys = [];
    let hasSpread = false;
    for (const prop of objLit.properties) {
      if (ts.isSpreadAssignment(prop) || ts.isSpreadElement?.(prop)) {
        hasSpread = true;
        continue;
      }
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
      if (!name) continue;
      const { value, kind } = extractValue(prop.initializer, ts);
      if (kind === "literal" || kind === "theme") {
        statics[name] = value;
      } else {
        dynamicKeys.push(name);
      }
    }
    return { statics, dynamicKeys, hasSpread };
  }
  function extractJsxProps(element, ts) {
    const attrs = element.attributes;
    if (!attrs) return {};
    const props = {};
    for (const attr of attrs.properties) {
      if (!ts.isJsxAttribute(attr)) continue;
      if (!attr.name) continue;
      const name = attr.name.text;
      if (name.startsWith("on") || name === "children" || name === "key" || name === "ref" || name === "testId" || name === "style") continue;
      if (!attr.initializer) {
        props[name] = true;
        continue;
      }
      if (ts.isStringLiteral(attr.initializer)) {
        props[name] = attr.initializer.text;
        continue;
      }
      if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
        const { value, kind } = extractValue(attr.initializer.expression, ts);
        if (kind === "literal" || kind === "theme") {
          props[name] = value;
        }
      }
    }
    return props;
  }
  function makeSignature(primitive, styleStatics, jsxProps) {
    const parts = [primitive];
    const styleKeys = Object.keys(styleStatics).sort();
    for (const k of styleKeys) {
      parts.push(`s:${k}=${JSON.stringify(styleStatics[k])}`);
    }
    const propKeys = Object.keys(jsxProps).sort();
    for (const k of propKeys) {
      parts.push(`p:${k}=${JSON.stringify(jsxProps[k])}`);
    }
    return parts.join("|");
  }
  function suggestName(primitive, styleStatics, jsxProps, prefix) {
    const s = styleStatics;
    const p = jsxProps;
    const pfx = prefix ? prefix : "";
    if (primitive === "Text") {
      const size = s.fontSize || p.size;
      const bold = s.fontWeight === "bold" || p.bold === true;
      const color = s.color || p.color || "";
      const hasLetterSpacing = "letterSpacing" in s;
      const styleKeyCount = Object.keys(s).length;
      let colorMod = "";
      if (typeof color === "string") {
        if (color.includes("textDim") || color.includes("muted")) colorMod = "Dim";
        else if (color.includes("error") || color.includes("#f38b") || color.includes("red")) colorMod = "Error";
        else if (color.includes("accent") || color.includes("#8b5c")) colorMod = "Accent";
        else if (color.includes("primary")) colorMod = "Primary";
        else if (color.includes("success") || color.includes("#a6e3") || color.includes("green")) colorMod = "Ok";
        else if (color.includes("warning") || color.includes("#f9e2") || color.includes("#fab3")) colorMod = "Warn";
        else if (color.includes("#89b4") || color.includes("blue") || color.includes("info")) colorMod = "Info";
        else if (color.includes("#94e2") || color.includes("teal")) colorMod = "Teal";
        else if (color.includes("#cba6") || color.includes("mauve")) colorMod = "Mauve";
        else if (color.includes("text")) colorMod = "";
      }
      const noColor = !color;
      let extraMod = "";
      if (s.width || s.flexShrink === 0) extraMod += "Fixed";
      if (s.textAlign === "center") extraMod += "Center";
      if (s.textAlign === "right") extraMod += "Right";
      let sizeName;
      if (hasLetterSpacing && bold) sizeName = "Label";
      else if (!size) sizeName = bold ? "BoldText" : "Text";
      else if (size >= 20) sizeName = bold ? "Title" : "DisplayText";
      else if (size >= 16) sizeName = bold ? "Heading" : "LargeText";
      else if (size >= 14) sizeName = bold ? "SectionHead" : "LargeBody";
      else if (size >= 12) sizeName = bold ? "Subtitle" : "MedText";
      else if (size >= 11) sizeName = bold ? "BoldBody" : "Body11";
      else if (size >= 10) sizeName = bold ? "BoldBody10" : "Body";
      else if (size >= 9) sizeName = bold ? "SmallBold" : "Caption";
      else if (size >= 8) sizeName = bold ? "TinyBold" : "Tiny";
      else if (size >= 6) sizeName = "Micro";
      else sizeName = "Nano";
      return `${pfx}${colorMod}${sizeName}${extraMod}`;
    }
    if (primitive === "Image") {
      const w = s.width || p.width;
      const h = s.height || p.height;
      if (w && h) return `${pfx}Icon${w}x${h}`;
      const size = w || h;
      if (size) return `${pfx}Icon${size}`;
      return `${pfx}Img`;
    }
    const isRow = primitive === "Row" || s.flexDirection === "row";
    const hasBgElevated = typeof s.backgroundColor === "string" && s.backgroundColor.includes("Elevated");
    const hasBgSurface = typeof s.backgroundColor === "string" && s.backgroundColor.includes("surface");
    const hasBg = typeof s.backgroundColor === "string" && s.backgroundColor.includes("theme:bg") && !hasBgElevated;
    const hasBorderBottom = s.borderBottomWidth > 0;
    const hasBorderTop = s.borderTopWidth > 0;
    const hasBorderLeft = s.borderLeftWidth > 0;
    const hasRadius = s.borderRadius > 0;
    const pad2 = s.padding || s.paddingLeft || s.paddingTop || 0;
    const hasPadding = pad2 > 0;
    const gap = s.gap || 0;
    const hasGap = gap > 0;
    const isFullSize = s.width === "100%" && s.height === "100%";
    const isDividerLike = (s.height === 1 || s.height === 0.5) && !hasPadding;
    const isDot = s.width && s.height && s.width === s.height && s.width <= 12 && s.borderRadius >= s.width / 2;
    const isFlexFill = s.flexGrow === 1;
    const isHalf = s.flexGrow === 1 && s.flexBasis === 0;
    const radius = s.borderRadius || 0;
    if (isFullSize && hasBg) return `${pfx}Root`;
    if (isDot) return `${pfx}Dot${s.width}`;
    if (isDividerLike) return `${pfx}Divider`;
    if (hasBgElevated && hasBorderBottom) return `${pfx}HeaderBar`;
    if (hasBgElevated && hasBorderTop) return `${pfx}FooterBar`;
    if (hasBgElevated && hasRadius) return `${pfx}Well${radius ? `R${radius}` : ""}`;
    if (hasBgElevated && hasPadding) return `${pfx}ElevatedPanel`;
    if (hasBgSurface && hasRadius) return `${pfx}InputWell${radius ? `R${radius}` : ""}`;
    if (hasBgSurface) return `${pfx}Surface`;
    if (hasBorderLeft && hasPadding) return `${pfx}Callout`;
    if (isHalf && hasGap) return `${pfx}HalfGap${gap}`;
    if (isHalf) return `${pfx}Half`;
    if (isFlexFill && !hasPadding && !hasRadius) return `${pfx}Spacer`;
    if (hasRadius && hasPadding && !hasGap) {
      if (pad2 <= 4) return `${pfx}Tag${radius ? `R${radius}` : ""}`;
      if (pad2 <= 8) return `${pfx}Chip${radius ? `R${radius}` : ""}`;
      if (pad2 <= 12) return `${pfx}Badge${radius ? `R${radius}` : ""}`;
      return `${pfx}CardR${radius}`;
    }
    if (hasRadius && hasPadding && hasGap) return `${pfx}Card${radius ? `R${radius}` : ""}`;
    if (isRow && hasGap && hasPadding) return `${pfx}Band${gap ? `G${gap}` : ""}`;
    if (isRow && hasGap) return `${pfx}InlineG${gap}`;
    if (isRow) return `${pfx}Inline`;
    if (hasPadding && hasGap) return `${pfx}Section${gap ? `G${gap}` : ""}`;
    if (hasGap) return `${pfx}Stack${gap}`;
    if (hasPadding) return `${pfx}Pad${pad2}`;
    if (hasRadius) return `${pfx}RoundR${radius}`;
    if (isFlexFill) return `${pfx}Fill`;
    const totalProps = Object.keys(s).length + Object.keys(p).length;
    if (totalProps <= 1) return `${pfx}Bare`;
    return `${pfx}Box${totalProps}p`;
  }
  function deduplicateNames(groups) {
    const byName = /* @__PURE__ */ new Map();
    for (const g of groups) {
      if (!byName.has(g.suggestedName)) byName.set(g.suggestedName, []);
      byName.get(g.suggestedName).push(g);
    }
    for (const [name, items] of byName) {
      if (items.length <= 1) continue;
      for (let i = 0; i < items.length; i++) {
        const g = items[i];
        const suffix = buildDistinctSuffix(g, items);
        g.suggestedName = i === 0 && !suffix ? name : `${name}${suffix || `V${i + 1}`}`;
      }
      const finalNames = /* @__PURE__ */ new Set();
      for (const g of items) {
        if (finalNames.has(g.suggestedName)) {
          let n = 2;
          while (finalNames.has(`${g.suggestedName}${n}`)) n++;
          g.suggestedName = `${g.suggestedName}${n}`;
        }
        finalNames.add(g.suggestedName);
      }
    }
  }
  function buildDistinctSuffix(group, siblings) {
    const s = group.styleStatics;
    const p = group.jsxProps;
    const parts = [];
    const traits = [
      { key: "color", get: (g) => g.styleStatics.color || g.jsxProps.color || "" },
      { key: "bold", get: (g) => g.styleStatics.fontWeight === "bold" || g.jsxProps.bold === true },
      { key: "padding", get: (g) => g.styleStatics.padding || g.styleStatics.paddingLeft || g.styleStatics.paddingTop || 0 },
      { key: "gap", get: (g) => g.styleStatics.gap || 0 },
      { key: "borderRadius", get: (g) => g.styleStatics.borderRadius || 0 },
      { key: "width", get: (g) => g.styleStatics.width || "" },
      { key: "height", get: (g) => g.styleStatics.height || "" },
      { key: "flexShrink", get: (g) => g.styleStatics.flexShrink },
      { key: "bg", get: (g) => g.styleStatics.backgroundColor || "" },
      { key: "border", get: (g) => (g.styleStatics.borderWidth || 0) + (g.styleStatics.borderBottomWidth || 0) + (g.styleStatics.borderTopWidth || 0) },
      { key: "propCount", get: (g) => Object.keys(g.styleStatics).length + Object.keys(g.jsxProps).length }
    ];
    const myValues = {};
    for (const t of traits) {
      myValues[t.key] = JSON.stringify(t.get(group));
    }
    for (const t of traits) {
      const myVal = t.get(group);
      const differs = siblings.some((g) => g !== group && JSON.stringify(t.get(g)) !== myValues[t.key]);
      if (!differs) continue;
      if (t.key === "color") {
        const c = String(myVal);
        if (!c) parts.push("Plain");
        else if (c.includes("textDim") || c.includes("muted")) {
        } else if (c.includes("text")) {
        } else if (c.includes("accent")) parts.push("Accent");
        else if (c.includes("error")) parts.push("Err");
        else if (c.includes("#")) parts.push(`C${c.slice(1, 4)}`);
        break;
      }
      if (t.key === "bold") {
        parts.push(myVal ? "Bold" : "Normal");
        break;
      }
      if (t.key === "padding") {
        if (myVal) parts.push(`P${myVal}`);
        break;
      }
      if (t.key === "gap") {
        if (myVal) parts.push(`G${myVal}`);
        break;
      }
      if (t.key === "width") {
        if (myVal) parts.push(`W${myVal}`);
        break;
      }
      if (t.key === "height") {
        if (myVal) parts.push(`H${myVal}`);
        break;
      }
      if (t.key === "propCount") {
        parts.push(`${myVal}s`);
        break;
      }
    }
    return parts.join("");
  }
  function scanPatterns(dir, ts, minOccurrences) {
    const files = findTsxFiles(dir);
    const groups = /* @__PURE__ */ new Map();
    for (const filePath of files) {
      const source = readFileSync(filePath, "utf-8");
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.ES2020,
        true,
        ts.ScriptKind.TSX
      );
      walkJsx(sourceFile, sourceFile, filePath, ts, groups);
    }
    const results = [];
    for (const [sig, group] of groups) {
      if (group.occurrences.length < minOccurrences) continue;
      const propCount = Object.keys(group.styleStatics).length + Object.keys(group.jsxProps).length;
      if (propCount === 0) continue;
      results.push(group);
    }
    results.sort((a, b) => b.occurrences.length - a.occurrences.length);
    return { groups: results, fileCount: files.length };
  }
  function walkJsx(node, sourceFile, filePath, ts, groups) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const element = ts.isJsxElement(node) ? node.openingElement : node;
      const tagName2 = getTagName(element, ts);
      const primitive = tagName2 ? TAG_TO_PRIMITIVE[tagName2] : null;
      if (primitive) {
        let styleStatics = {};
        let dynamicKeys = [];
        let hasSpread = false;
        const attrs = element.attributes;
        if (attrs) {
          for (const attr of attrs.properties) {
            if (!ts.isJsxAttribute(attr)) continue;
            if (!attr.name || attr.name.text !== "style") continue;
            const init = attr.initializer;
            if (init && ts.isJsxExpression(init) && init.expression && ts.isObjectLiteralExpression(init.expression)) {
              const extracted = extractStyleProps(init.expression, ts);
              styleStatics = extracted.statics;
              dynamicKeys = extracted.dynamicKeys;
              hasSpread = extracted.hasSpread;
            }
          }
        }
        injectFlexDirectionForTag(tagName2, styleStatics);
        if (!hasSpread) {
          const jsxProps = extractJsxProps(element, ts);
          const sig = makeSignature(primitive, styleStatics, jsxProps);
          let parentFn = "";
          let p = node.parent;
          while (p) {
            if (ts.isFunctionDeclaration(p) && p.name) {
              parentFn = p.name.text;
              break;
            }
            if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
              parentFn = p.name.text;
              break;
            }
            if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) {
              parentFn = p.name.text;
              break;
            }
            p = p.parent;
          }
          const pos4 = ts.getLineAndCharacterOfPosition(sourceFile, element.getStart(sourceFile));
          if (!groups.has(sig)) {
            groups.set(sig, {
              primitive,
              styleStatics,
              jsxProps,
              dynamicKeys,
              occurrences: [],
              suggestedName: ""
            });
          }
          groups.get(sig).occurrences.push({
            file: filePath,
            line: pos4.line + 1,
            parentFn
          });
        }
      }
    }
    ts.forEachChild(node, (child) => walkJsx(child, sourceFile, filePath, ts, groups));
  }
  function scanElements(dir, ts) {
    const files = findTsxFiles(dir);
    const elements = [];
    for (const filePath of files) {
      let visit2 = function(node) {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
          const element = ts.isJsxElement(node) ? node.openingElement : node;
          const tagName2 = getTagName(element, ts);
          const primitive = tagName2 ? TAG_TO_PRIMITIVE[tagName2] : null;
          if (primitive) {
            let styleStatics = {};
            let dynamicKeys = [];
            let hasSpread = false;
            const attrs = element.attributes;
            if (attrs) {
              for (const attr of attrs.properties) {
                if (!ts.isJsxAttribute(attr)) continue;
                if (!attr.name || attr.name.text !== "style") continue;
                const init = attr.initializer;
                if (init && ts.isJsxExpression(init) && init.expression && ts.isObjectLiteralExpression(init.expression)) {
                  const extracted = extractStyleProps(init.expression, ts);
                  styleStatics = extracted.statics;
                  dynamicKeys = extracted.dynamicKeys;
                  hasSpread = extracted.hasSpread;
                }
              }
            }
            injectFlexDirectionForTag(tagName2, styleStatics);
            if (!hasSpread && dynamicKeys.length === 0) {
              const jsxProps = extractJsxProps(element, ts);
              const propCount = Object.keys(styleStatics).length + Object.keys(jsxProps).length;
              if (propCount > 0) {
                const pos4 = ts.getLineAndCharacterOfPosition(sf, element.getStart(sf));
                elements.push({
                  primitive,
                  styleStatics,
                  jsxProps,
                  file: filePath,
                  line: pos4.line + 1
                });
              }
            }
          }
        }
        ts.forEachChild(node, visit2);
      };
      var visit = visit2;
      const source = readFileSync(filePath, "utf-8");
      const sf = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.ES2020,
        true,
        ts.ScriptKind.TSX
      );
      visit2(sf);
    }
    return { elements, fileCount: files.length };
  }
  function formatValue(v) {
    if (typeof v === "string") return `'${v}'`;
    if (typeof v === "boolean") return v.toString();
    if (typeof v === "number") return v.toString();
    return JSON.stringify(v);
  }
  function clusterAppendages(groups, maxDeltaFields = 2) {
    const byPrimitive = /* @__PURE__ */ new Map();
    for (const g of groups) {
      if (!byPrimitive.has(g.primitive)) byPrimitive.set(g.primitive, []);
      byPrimitive.get(g.primitive).push(g);
    }
    for (const [, bucket] of byPrimitive) {
      const sortedByLen = [...bucket].sort((a, b) => b.suggestedName.length - a.suggestedName.length);
      for (const child of sortedByLen) {
        if (child.isAppendage) continue;
        const candidates = bucket.filter(
          (p) => p !== child && !p.isAppendage && child.suggestedName.startsWith(p.suggestedName) && child.suggestedName.length > p.suggestedName.length
        );
        if (candidates.length === 0) continue;
        candidates.sort((a, b) => b.suggestedName.length - a.suggestedName.length);
        for (const parent of candidates) {
          const styleDelta = {};
          for (const k of Object.keys(child.styleStatics)) {
            if (JSON.stringify(child.styleStatics[k]) !== JSON.stringify(parent.styleStatics[k])) {
              styleDelta[k] = child.styleStatics[k];
            }
          }
          const propDelta = {};
          for (const k of Object.keys(child.jsxProps)) {
            if (JSON.stringify(child.jsxProps[k]) !== JSON.stringify(parent.jsxProps[k])) {
              propDelta[k] = child.jsxProps[k];
            }
          }
          const parentDropsStyle = Object.keys(parent.styleStatics).some((k) => !(k in child.styleStatics));
          const parentDropsProps = Object.keys(parent.jsxProps).some((k) => !(k in child.jsxProps));
          const totalDelta = Object.keys(styleDelta).length + Object.keys(propDelta).length;
          if (totalDelta === 0 || totalDelta > maxDeltaFields) continue;
          if (parentDropsStyle || parentDropsProps) continue;
          const suffix = child.suggestedName.slice(parent.suggestedName.length);
          if (!/^[A-Z][A-Za-z0-9]*$/.test(suffix)) continue;
          parent.appendages = parent.appendages || [];
          parent.appendages.push({ suffix, styleDelta, propDelta, occurrences: child.occurrences });
          child.isAppendage = true;
          child.appendageOf = parent.suggestedName;
          break;
        }
      }
    }
  }
  function formatAppendageBody(primitive, styleDelta, propDelta) {
    const parts = [];
    let remainingStyle = { ...styleDelta };
    if (primitive === "Text") {
      if ("color" in remainingStyle) {
        parts.push(`color: ${formatValue(remainingStyle.color)}`);
        delete remainingStyle.color;
      }
      if ("fontWeight" in remainingStyle) {
        if (remainingStyle.fontWeight === "bold") parts.push(`bold: true`);
        delete remainingStyle.fontWeight;
      }
      if ("fontSize" in remainingStyle) {
        parts.push(`size: ${remainingStyle.fontSize}`);
        delete remainingStyle.fontSize;
      }
    }
    for (const [k, v] of Object.entries(propDelta)) {
      parts.push(`${k}: ${formatValue(v)}`);
    }
    const styleKeys = Object.keys(remainingStyle);
    if (styleKeys.length > 0) {
      const styleParts = styleKeys.map((k) => `${k}: ${formatValue(remainingStyle[k])}`);
      parts.push(`style: { ${styleParts.join(", ")} }`);
    }
    return parts.join(", ");
  }
  function generateClsFile(groups, prefix) {
    const lines = [
      `/**`,
      ` * Auto-generated classifier sheet`,
      ` * Generated by: rjit classify`,
      ` * Patterns: ${groups.length}`,
      ` * Total occurrences: ${groups.reduce((s, g) => s + g.occurrences.length, 0)}`,
      ` *`,
      ` * Review names, adjust as needed, then import at app entry.`,
      ` */`,
      ``,
      `import { classifier } from '@reactjit/core';`,
      ``,
      `classifier({`
    ];
    for (const group of groups) {
      if (group.isAppendage) continue;
      const { primitive, styleStatics, jsxProps, suggestedName, occurrences } = group;
      const fileCount = new Set(occurrences.map((o) => o.file)).size;
      lines.push(`  // ${occurrences.length} occurrences across ${fileCount} files`);
      const entryParts = [`type: '${primitive}'`];
      for (const [k, v] of Object.entries(jsxProps)) {
        entryParts.push(`${k}: ${formatValue(v)}`);
      }
      const styleKeys = Object.keys(styleStatics);
      if (styleKeys.length > 0) {
        const styleParts = styleKeys.map((k) => `${k}: ${formatValue(styleStatics[k])}`);
        if (styleParts.length <= 3) {
          entryParts.push(`style: { ${styleParts.join(", ")} }`);
        } else {
          entryParts.push(`style: {
      ${styleParts.join(",\n      ")},
    }`);
        }
      }
      let entry;
      if (primitive === "Text" && styleStatics.fontSize) {
        const promoted = [];
        promoted.push(`type: 'Text'`);
        promoted.push(`size: ${styleStatics.fontSize}`);
        if (styleStatics.fontWeight === "bold") promoted.push(`bold: true`);
        if (styleStatics.color) promoted.push(`color: ${formatValue(styleStatics.color)}`);
        const remaining = {};
        for (const k of styleKeys) {
          if (k !== "fontSize" && k !== "fontWeight" && k !== "color") {
            remaining[k] = styleStatics[k];
          }
        }
        const remKeys = Object.keys(remaining);
        if (remKeys.length > 0) {
          const remParts = remKeys.map((k) => `${k}: ${formatValue(remaining[k])}`);
          promoted.push(`style: { ${remParts.join(", ")} }`);
        }
        for (const [k, v] of Object.entries(jsxProps)) {
          if (k !== "size" && k !== "bold" && k !== "color") {
            promoted.push(`${k}: ${formatValue(v)}`);
          }
        }
        entry = promoted.join(", ");
      } else {
        entry = entryParts.join(", ");
      }
      if (group.appendages && group.appendages.length > 0) {
        lines.push(`  ${suggestedName}: { ${entry},`);
        for (const ap of group.appendages) {
          const childBody = formatAppendageBody(primitive, ap.styleDelta, ap.propDelta);
          const apFiles = new Set(ap.occurrences.map((o) => o.file)).size;
          lines.push(`    // ${ap.occurrences.length} occurrences across ${apFiles} files`);
          lines.push(`    '.${ap.suffix}': { ${childBody} },`);
        }
        lines.push(`  },`);
      } else {
        lines.push(`  ${suggestedName}: { ${entry} },`);
      }
      lines.push(``);
    }
    lines.push(`});`);
    lines.push(``);
    return lines.join("\n");
  }
  function generateReport(groups, fileCount) {
    const lines = [];
    const emittedGroups = groups.filter((g) => !g.isAppendage);
    const appendageCount = groups.length - emittedGroups.length;
    const totalOccurrences = groups.reduce((s, g) => s + g.occurrences.length, 0);
    lines.push(`
  Classifier Pattern Analysis`);
    lines.push(`  ${"\u2500".repeat(50)}`);
    lines.push(`  Files scanned: ${fileCount}`);
    lines.push(`  Patterns found: ${emittedGroups.length} (+${appendageCount} folded as .Suffix)`);
    lines.push(`  Total inline styles replaced: ${totalOccurrences}`);
    lines.push(`  ${"\u2500".repeat(50)}
`);
    lines.push(`  ${"Name".padEnd(25)} ${"Type".padEnd(12)} ${"Hits".padStart(5)} ${"Files".padStart(6)}  Key traits`);
    lines.push(`  ${"\u2500".repeat(25)} ${"\u2500".repeat(12)} ${"\u2500".repeat(5)} ${"\u2500".repeat(6)}  ${"\u2500".repeat(30)}`);
    for (const group of groups) {
      if (group.isAppendage) continue;
      const { primitive, styleStatics, jsxProps, suggestedName, occurrences } = group;
      const fileCount2 = new Set(occurrences.map((o) => o.file)).size;
      const traits = [];
      if (styleStatics.fontSize) traits.push(`${styleStatics.fontSize}px`);
      if (styleStatics.fontWeight === "bold" || jsxProps.bold) traits.push("bold");
      if (styleStatics.backgroundColor) {
        const bg = styleStatics.backgroundColor;
        if (bg.includes("Elevated")) traits.push("bgElevated");
        else if (bg.includes("surface")) traits.push("surface");
        else if (bg.includes("bg")) traits.push("bg");
        else traits.push("bg:custom");
      }
      if (styleStatics.borderRadius) traits.push(`r${styleStatics.borderRadius}`);
      if (styleStatics.padding) traits.push(`p${styleStatics.padding}`);
      if (styleStatics.gap) traits.push(`gap${styleStatics.gap}`);
      if (styleStatics.borderBottomWidth) traits.push("borderBot");
      if (styleStatics.borderTopWidth) traits.push("borderTop");
      if (styleStatics.borderLeftWidth) traits.push("borderLeft");
      if (styleStatics.flexGrow) traits.push("grow");
      if (styleStatics.color) {
        const c = styleStatics.color;
        if (c.includes("textDim") || c.includes("muted")) traits.push("muted");
        else if (c.includes("text")) traits.push("text");
        else if (c.includes("accent")) traits.push("accent");
      }
      const traitStr = traits.join(", ");
      lines.push(`  ${suggestedName.padEnd(25)} ${primitive.padEnd(12)} ${String(occurrences.length).padStart(5)} ${String(fileCount2).padStart(6)}  ${traitStr}`);
    }
    lines.push("");
    return lines.join("\n");
  }
  function findRenameTargets(dir) {
    const results = { cls: [], tsx: [] };
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        const sub2 = findRenameTargets(full);
        results.cls.push(...sub2.cls);
        results.tsx.push(...sub2.tsx);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".cls.ts")) results.cls.push(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".cls.ts")) results.tsx.push(full);
      }
    }
    return results;
  }
  function findClassifierAliases(source) {
    const aliases = /* @__PURE__ */ new Set();
    const importRe = /classifiers\s+as\s+(\w+)/g;
    let m;
    while (m = importRe.exec(source)) aliases.add(m[1]);
    const constRe = /(?:const|let|var)\s+(\w+)\s*=\s*classifiers\b/g;
    while (m = constRe.exec(source)) aliases.add(m[1]);
    if (/\bclassifiers\s*\./.test(source)) aliases.add("classifiers");
    return aliases;
  }
  async function renameCommand(args) {
    if (args.length < 2) {
      console.error(`
  Usage: rjit classify rename <OldName> <NewName>`);
      console.error(`         rjit classify rename <OldName> <NewName> --dir ./stories
`);
      process2.exit(1);
    }
    const oldName = args[0];
    const newName = args[1];
    const cwd = process2.cwd();
    let scanDir = defaultScanDir(cwd);
    let dryRun = false;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--dir") {
        scanDir = join(cwd, args[++i]);
        continue;
      }
      if (args[i] === "--dry-run") {
        dryRun = true;
        continue;
      }
    }
    if (!existsSync(scanDir)) {
      console.error(`  Directory not found: ${scanDir}`);
      process2.exit(1);
    }
    if (oldName === newName) {
      console.log(`  Nothing to do \u2014 names are identical.`);
      return;
    }
    if (!/^[A-Z][A-Za-z0-9]*$/.test(newName)) {
      console.error(`  New name must be PascalCase (e.g., PageTitle, DimCaption). Got: ${newName}`);
      process2.exit(1);
    }
    console.log(`
  Renaming classifier: ${oldName} \u2192 ${newName}`);
    console.log(`  Scanning ${relative(cwd, scanDir) || "."}/ ...
`);
    const { cls, tsx } = findRenameTargets(scanDir);
    let totalReplacements = 0;
    const touchedFiles = [];
    for (const filePath of cls) {
      const source = readFileSync(filePath, "utf-8");
      const defRe = new RegExp(`(^|[\\s,{])${oldName}(\\s*:)`, "gm");
      if (!defRe.test(source)) continue;
      const updated = source.replace(defRe, `$1${newName}$2`);
      if (updated !== source) {
        if (!dryRun) writeFileSync(filePath, updated, "utf-8");
        const count = (source.match(defRe) || []).length;
        totalReplacements += count;
        touchedFiles.push({ file: relative(cwd, filePath), count, type: "def" });
      }
    }
    const allFiles = [...tsx, ...cls];
    for (const filePath of allFiles) {
      const source = readFileSync(filePath, "utf-8");
      const aliases = findClassifierAliases(source);
      if (aliases.size === 0) continue;
      let updated = source;
      let count = 0;
      for (const alias of aliases) {
        const usageRe = new RegExp(`(${alias}\\.)${oldName}\\b`, "g");
        const matches = updated.match(usageRe);
        if (matches) {
          count += matches.length;
          updated = updated.replace(usageRe, `$1${newName}`);
        }
      }
      if (updated !== source) {
        if (!dryRun) writeFileSync(filePath, updated, "utf-8");
        totalReplacements += count;
        touchedFiles.push({ file: relative(cwd, filePath), count, type: "usage" });
      }
    }
    if (touchedFiles.length === 0) {
      console.log(`  No occurrences of "${oldName}" found.
`);
      return;
    }
    console.log(`  ${"File".padEnd(50)} ${"Type".padEnd(6)} Hits`);
    console.log(`  ${"\u2500".repeat(50)} ${"\u2500".repeat(6)} ${"\u2500".repeat(4)}`);
    for (const { file, count, type } of touchedFiles) {
      console.log(`  ${file.padEnd(50)} ${type.padEnd(6)} ${count}`);
    }
    console.log(`
  Total: ${totalReplacements} replacements across ${touchedFiles.length} files.`);
    console.log(`  ${oldName} \u2192 ${newName}${dryRun ? "  (dry-run \u2014 no files written)" : ""}
`);
  }
  function parseClsFile(clsPath, ts) {
    const source = readFileSync(clsPath, "utf-8");
    const sf = ts.createSourceFile(clsPath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    const exportedConsts = {};
    sf.forEachChild((node) => {
      if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
            const obj = {};
            for (const prop of decl.initializer.properties) {
              if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                const { value } = extractValue(prop.initializer, ts);
                if (value !== null) obj[prop.name.text] = value;
              }
            }
            exportedConsts[decl.name.text] = obj;
          }
        }
      }
    });
    const classifiers = [];
    function walk(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "classifier" && node.arguments.length === 1 && ts.isObjectLiteralExpression(node.arguments[0])) {
        const obj = node.arguments[0];
        for (const prop of obj.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const name = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
          if (!name) continue;
          if (!ts.isObjectLiteralExpression(prop.initializer)) continue;
          const entry = {};
          for (const ep of prop.initializer.properties) {
            if (!ts.isPropertyAssignment(ep) || !ts.isIdentifier(ep.name)) continue;
            const key2 = ep.name.text;
            if (key2 === "style" && ts.isObjectLiteralExpression(ep.initializer)) {
              entry.style = {};
              for (const sp of ep.initializer.properties) {
                if (!ts.isPropertyAssignment(sp) || !ts.isIdentifier(sp.name)) continue;
                const { value } = extractValue(sp.initializer, ts);
                if (value === null && ts.isPropertyAccessExpression(sp.initializer)) {
                  const objName = ts.isIdentifier(sp.initializer.expression) ? sp.initializer.expression.text : null;
                  const propName = sp.initializer.name.text;
                  if (objName && exportedConsts[objName] && exportedConsts[objName][propName] !== void 0) {
                    entry.style[sp.name.text] = exportedConsts[objName][propName];
                  }
                } else if (value !== null) {
                  entry.style[sp.name.text] = value;
                }
              }
            } else {
              const { value } = extractValue(ep.initializer, ts);
              if (value === null && ts.isPropertyAccessExpression(ep.initializer)) {
                const objName = ts.isIdentifier(ep.initializer.expression) ? ep.initializer.expression.text : null;
                const propName = ep.initializer.name.text;
                if (objName && exportedConsts[objName] && exportedConsts[objName][propName] !== void 0) {
                  entry[key2] = exportedConsts[objName][propName];
                }
              } else if (value !== null) {
                entry[key2] = value;
              }
            }
          }
          const primitive = entry.type;
          if (!primitive) continue;
          delete entry.type;
          let styleStatics = { ...entry.style || {} };
          const jsxProps = {};
          for (const [k, v] of Object.entries(entry)) {
            if (k === "style") continue;
            if (k === "use") continue;
            if (primitive === "Text") {
              if (k === "size") {
                styleStatics.fontSize = v;
                continue;
              }
              if (k === "bold" && v === true) {
                styleStatics.fontWeight = "bold";
                continue;
              }
              if (k === "color") {
                styleStatics.color = v;
                continue;
              }
            }
            jsxProps[k] = v;
          }
          styleStatics = resolveThemeStyleObj(styleStatics);
          for (const k of Object.keys(jsxProps)) {
            jsxProps[k] = resolveThemeValue(jsxProps[k]);
          }
          const sig = makeSignature(primitive, styleStatics, jsxProps);
          classifiers.push({ name, primitive, sig, styleStatics, jsxProps, entry });
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(sf);
    const bySig = /* @__PURE__ */ new Map();
    for (const c of classifiers) {
      if (!bySig.has(c.sig)) bySig.set(c.sig, c);
    }
    return { classifiers, bySig, exportedConsts };
  }
  function migrateFile(filePath, bySig, clsAlias, ts, partial = false, dryRun = false) {
    const source = readFileSync(filePath, "utf-8");
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
    const replacements = [];
    function findPartialMatch(primitive, elStyle, elJsx) {
      let best = null;
      let bestScore = 0;
      for (const [, cls] of bySig) {
        if (cls.primitive !== primitive) continue;
        const clsStyle = cls.styleStatics;
        const clsJsx = cls.jsxProps;
        let allMatch = true;
        let score = 0;
        for (const [k, v] of Object.entries(clsStyle)) {
          if (elStyle[k] === void 0 || JSON.stringify(elStyle[k]) !== JSON.stringify(v)) {
            allMatch = false;
            break;
          }
          score++;
        }
        if (!allMatch) continue;
        for (const [k, v] of Object.entries(clsJsx)) {
          if (elJsx[k] === void 0 || JSON.stringify(elJsx[k]) !== JSON.stringify(v)) {
            allMatch = false;
            break;
          }
          score++;
        }
        if (!allMatch) continue;
        if (score < 2) continue;
        const totalEl = Object.keys(elStyle).length + Object.keys(elJsx).length;
        if (totalEl <= score) continue;
        if (score > bestScore) {
          bestScore = score;
          best = cls;
        }
      }
      return best;
    }
    function visitJsx(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const element = ts.isJsxElement(node) ? node.openingElement : node;
        const tagName2 = getTagName(element, ts);
        const primitive = tagName2 ? TAG_TO_PRIMITIVE[tagName2] : null;
        if (primitive) {
          let styleStatics = {};
          let dynamicKeys = [];
          let hasSpread = false;
          let styleObjNode = null;
          const attrs = element.attributes;
          if (attrs) {
            for (const attr of attrs.properties) {
              if (ts.isSpreadAssignment?.(attr) || ts.isJsxSpreadAttribute?.(attr)) {
                hasSpread = true;
                continue;
              }
              if (!ts.isJsxAttribute(attr)) continue;
              if (!attr.name || attr.name.text !== "style") continue;
              const init = attr.initializer;
              if (init && ts.isJsxExpression(init) && init.expression && ts.isObjectLiteralExpression(init.expression)) {
                const extracted = extractStyleProps(init.expression, ts);
                styleStatics = extracted.statics;
                dynamicKeys = extracted.dynamicKeys;
                hasSpread = extracted.hasSpread;
                styleObjNode = init.expression;
              }
            }
          }
          if (hasSpread || dynamicKeys.length > 0) {
            ts.forEachChild(node, visitJsx);
            return;
          }
          injectFlexDirectionForTag(tagName2, styleStatics);
          const jsxProps = extractJsxProps(element, ts);
          const sig = makeSignature(primitive, styleStatics, jsxProps);
          let match = bySig.get(sig);
          let isPartial = false;
          if (!match && partial) {
            match = findPartialMatch(primitive, styleStatics, jsxProps);
            if (match) isPartial = true;
          }
          if (match) {
            const cName = `${clsAlias}.${match.name}`;
            const removeProps = new Set(Object.keys(match.jsxProps));
            const keptAttrs = [];
            if (attrs) {
              for (const attr of attrs.properties) {
                if (ts.isJsxSpreadAttribute?.(attr)) {
                  keptAttrs.push(source.slice(attr.getStart(sf), attr.getEnd()));
                  continue;
                }
                if (!ts.isJsxAttribute(attr)) continue;
                if (!attr.name) continue;
                const aName = attr.name.text;
                if (aName === "style") {
                  if (isPartial && styleObjNode) {
                    const coveredKeys = new Set(Object.keys(match.styleStatics));
                    const keptProps = [];
                    for (const prop of styleObjNode.properties) {
                      if (!ts.isPropertyAssignment(prop)) continue;
                      const pName = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
                      if (!pName || coveredKeys.has(pName)) continue;
                      keptProps.push(source.slice(prop.getStart(sf), prop.getEnd()));
                    }
                    if (keptProps.length > 0) {
                      keptAttrs.push(`style={{ ${keptProps.join(", ")} }}`);
                    }
                  }
                  continue;
                }
                if (removeProps.has(aName)) continue;
                keptAttrs.push(source.slice(attr.getStart(sf), attr.getEnd()));
              }
            }
            const attrStr = keptAttrs.length > 0 ? " " + keptAttrs.join(" ") : "";
            if (ts.isJsxSelfClosingElement(node)) {
              replacements.push({
                start: node.getStart(sf),
                end: node.getEnd(),
                text: `<${cName}${attrStr} />`
              });
            } else {
              const opening = node.openingElement;
              const closing = node.closingElement;
              const childrenSrc = source.slice(opening.getEnd(), closing.getStart(sf));
              replacements.push({
                start: node.getStart(sf),
                end: node.getEnd(),
                text: `<${cName}${attrStr}>${childrenSrc}</${cName}>`
              });
            }
            return;
          }
        }
      }
      ts.forEachChild(node, visitJsx);
    }
    visitJsx(sf);
    if (replacements.length === 0) return { changed: false, count: 0 };
    replacements.sort((a, b) => b.start - a.start);
    let result = source;
    for (const r of replacements) {
      result = result.slice(0, r.start) + r.text + result.slice(r.end);
    }
    const alias = "S";
    if (clsAlias !== alias) {
      result = result.replace(new RegExp(`<${clsAlias}\\.`, "g"), `<${alias}.`).replace(new RegExp(`</${clsAlias}\\.`, "g"), `</${alias}.`);
    }
    result = result.replace(/<C\.(Story\w+)/g, `<${alias}.$1`).replace(/<\/C\.(Story\w+)/g, `</${alias}.$1`);
    if (!result.includes("classifiers")) {
      const coreImportRe = /import\s*\{([^}]+)\}\s*from\s*'[^']*core[^']*'/;
      const coreMatch = result.match(coreImportRe);
      if (coreMatch && !coreMatch[1].includes("classifiers")) {
        const newImports = coreMatch[1].trimEnd().replace(/,\s*$/, "") + `, classifiers as ${alias}`;
        result = result.replace(coreMatch[1], newImports);
      } else if (!coreMatch) {
        let lastImportEnd = 0;
        for (const stmt of sf.statements) {
          if (ts.isImportDeclaration(stmt)) {
            lastImportEnd = Math.max(lastImportEnd, stmt.getEnd());
          }
        }
        if (lastImportEnd > 0) {
          result = result.slice(0, lastImportEnd) + `
import { classifiers as ${alias} } from '@reactjit/core';` + result.slice(lastImportEnd);
        }
      }
    } else {
      result = result.replace(/classifiers as \w+/g, `classifiers as ${alias}`);
      result = result.replace(/const \w+ = classifiers\b/g, `const ${alias} = classifiers`);
    }
    if (!dryRun) writeFileSync(filePath, result, "utf-8");
    return { changed: true, count: replacements.length };
  }
  async function migrateCommand(args, ts) {
    const cwd = process2.cwd();
    let scanDir = defaultScanDir(cwd);
    let clsPath = null;
    let partial = false;
    let dryRun = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--dir") {
        scanDir = join(cwd, args[++i]);
        continue;
      }
      if (args[i] === "--cls") {
        clsPath = args[++i];
        continue;
      }
      if (args[i] === "--partial") {
        partial = true;
        continue;
      }
      if (args[i] === "--dry-run") {
        dryRun = true;
        continue;
      }
    }
    if (!existsSync(scanDir)) {
      console.error(`  Directory not found: ${scanDir}`);
      process2.exit(1);
    }
    if (!clsPath) {
      const { cls } = findRenameTargets(scanDir);
      if (cls.length === 0) {
        console.error(`  No .cls.ts file found in ${scanDir}. Run rjit classify first.`);
        process2.exit(1);
      }
      clsPath = cls[0];
      if (cls.length > 1) {
        console.log(`  Multiple .cls.ts files found, using: ${relative(cwd, clsPath)}`);
      }
    }
    console.log(`
  Migrating ${relative(cwd, scanDir) || "."}/ using ${relative(cwd, clsPath)}`);
    const { bySig } = parseClsFile(clsPath, ts);
    console.log(`  Loaded ${bySig.size} classifier signatures
`);
    const { tsx } = findRenameTargets(scanDir);
    let totalReplacements = 0;
    const touchedFiles = [];
    for (const filePath of tsx) {
      const source = readFileSync(filePath, "utf-8");
      const aliases = findClassifierAliases(source);
      const clsAlias = aliases.size > 0 ? [...aliases][0] : "C";
      const { changed, count } = migrateFile(filePath, bySig, clsAlias, ts, partial, dryRun);
      if (changed) {
        totalReplacements += count;
        touchedFiles.push({ file: relative(cwd, filePath), count });
      }
    }
    if (touchedFiles.length === 0) {
      console.log(`  No inline styles matched any classifier.${partial ? "" : " Try --partial for superset matching."}
`);
      return;
    }
    console.log(`  ${"File".padEnd(55)} Replacements`);
    console.log(`  ${"\u2500".repeat(55)} ${"\u2500".repeat(12)}`);
    for (const { file, count } of touchedFiles.sort((a, b) => b.count - a.count)) {
      console.log(`  ${file.padEnd(55)} ${count}`);
    }
    console.log(`
  Total: ${totalReplacements} inline styles \u2192 classifier references across ${touchedFiles.length} files.${dryRun ? "  (dry-run \u2014 no files written)" : ""}
`);
  }
  function formatTraits(styleStatics, jsxProps) {
    const parts = [];
    const s = styleStatics;
    if (s.backgroundColor) {
      const bg = String(s.backgroundColor);
      if (bg.includes("Elevated")) parts.push("bgElevated");
      else if (bg.includes("surface")) parts.push("surface");
      else if (bg.includes("bg")) parts.push("bg");
      else parts.push(`bg:${bg.slice(0, 15)}`);
    }
    if (s.borderRadius) parts.push(`r:${s.borderRadius}`);
    if (s.padding) parts.push(`p:${s.padding}`);
    else if (s.paddingLeft) parts.push(`pl:${s.paddingLeft}`);
    if (s.gap) parts.push(`gap:${s.gap}`);
    if (s.flexGrow) parts.push("grow");
    if (s.flexBasis === 0) parts.push("basis:0");
    if (s.flexShrink === 0) parts.push("shrink:0");
    if (s.width) parts.push(`w:${s.width}`);
    if (s.height != null) parts.push(`h:${s.height}`);
    if (s.borderBottomWidth) parts.push("borderBot");
    if (s.borderTopWidth) parts.push("borderTop");
    if (s.borderLeftWidth) parts.push("borderLeft");
    if (s.fontSize) parts.push(`${s.fontSize}px`);
    if (s.fontWeight === "bold" || jsxProps.bold) parts.push("bold");
    if (s.color) {
      const c = String(s.color);
      if (c.includes("textDim") || c.includes("muted")) parts.push("muted");
      else if (c.includes("text")) parts.push("text");
      else if (c.includes("accent")) parts.push("accent");
      else parts.push(`color:${c.slice(0, 12)}`);
    }
    if (s.alignItems) parts.push(`align:${s.alignItems}`);
    if (s.justifyContent) parts.push(`justify:${s.justifyContent}`);
    const covered = /* @__PURE__ */ new Set([
      "backgroundColor",
      "borderRadius",
      "padding",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
      "paddingBottom",
      "gap",
      "flexGrow",
      "flexBasis",
      "flexShrink",
      "width",
      "height",
      "borderBottomWidth",
      "borderTopWidth",
      "borderLeftWidth",
      "color",
      "fontSize",
      "fontWeight",
      "borderColor",
      "alignItems",
      "justifyContent"
    ]);
    for (const k of Object.keys(s)) {
      if (!covered.has(k)) parts.push(`${k}:${JSON.stringify(s[k]).slice(0, 10)}`);
    }
    for (const [k, v] of Object.entries(jsxProps)) {
      if (k !== "bold") parts.push(`${k}:${JSON.stringify(v).slice(0, 10)}`);
    }
    return parts.join(", ");
  }
  function generatePickEntry(p) {
    const { name, primitive, styleStatics, jsxProps, matches } = p;
    const parts = [`type: '${primitive}'`];
    if (primitive === "Text") {
      const remaining = { ...styleStatics };
      if (remaining.fontSize != null) {
        parts.push(`size: ${remaining.fontSize}`);
        delete remaining.fontSize;
      }
      if (remaining.fontWeight === "bold") {
        parts.push(`bold: true`);
        delete remaining.fontWeight;
      }
      if (remaining.color != null) {
        parts.push(`color: ${formatValue(remaining.color)}`);
        delete remaining.color;
      }
      for (const [k, v] of Object.entries(jsxProps)) {
        if (k !== "size" && k !== "bold" && k !== "color") parts.push(`${k}: ${formatValue(v)}`);
      }
      const remKeys = Object.keys(remaining);
      if (remKeys.length > 0) {
        const styleParts = remKeys.map((k) => `${k}: ${formatValue(remaining[k])}`);
        parts.push(`style: { ${styleParts.join(", ")} }`);
      }
    } else {
      for (const [k, v] of Object.entries(jsxProps)) {
        parts.push(`${k}: ${formatValue(v)}`);
      }
      const styleKeys = Object.keys(styleStatics);
      if (styleKeys.length > 0) {
        const styleParts = styleKeys.map((k) => `${k}: ${formatValue(styleStatics[k])}`);
        if (styleParts.length <= 3) {
          parts.push(`style: { ${styleParts.join(", ")} }`);
        } else {
          parts.push(`style: {
      ${styleParts.join(",\n      ")},
    }`);
        }
      }
    }
    return `  // ${matches.length} occurrences
  ${name}: { ${parts.join(", ")} },`;
  }
  function appendEntries(clsPath, entries) {
    const source = readFileSync(clsPath, "utf-8");
    const lastClose = source.lastIndexOf("});");
    if (lastClose === -1) {
      console.error("  Could not find closing }); in .cls.ts file.");
      process2.exit(1);
    }
    const before = source.slice(0, lastClose);
    const after = source.slice(lastClose);
    const insert = "\n" + entries.join("\n\n") + "\n";
    writeFileSync(clsPath, before + insert + after, "utf-8");
  }
  async function addCommand(args, ts) {
    const cwd = process2.cwd();
    let scanDir = defaultScanDir(cwd);
    let clsPath = null;
    let noMigrate = false;
    let dryRun = false;
    const positional = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--dir") {
        scanDir = join(cwd, args[++i]);
        continue;
      }
      if (args[i] === "--cls") {
        clsPath = args[++i];
        continue;
      }
      if (args[i] === "--no-migrate") {
        noMigrate = true;
        continue;
      }
      if (args[i] === "--dry-run") {
        dryRun = true;
        continue;
      }
      if (args[i] === "--help" || args[i] === "-h") {
        console.log(`
  rjit classify add \u2014 Add a single classifier and auto-migrate

  Usage:
    rjit classify add <Name> '<json_definition>'

  Examples:
    rjit classify add SurfaceCard '{"type":"Box","style":{"backgroundColor":"theme:surface","borderWidth":1,"borderColor":"theme:border"}}'
    rjit classify add MutedCaption '{"type":"Text","size":9,"color":"theme:textDim"}'
    rjit classify add InlineG4 '{"type":"Box","style":{"flexDirection":"row","gap":4,"alignItems":"center"}}'

  The JSON definition uses the same format as classifier() entries:
    - type: primitive name (Box, Text, Image, Pressable, ScrollView, Input, Video, Row, Col)
    - style: { ... } for CSS-like style properties
    - For Text: size, bold, color are top-level (not inside style)
    - Use 'theme:X' strings for theme tokens (theme:text, theme:textDim, theme:surface, etc.)

  Options:
    --dir <path>      Scan directory for migration (default: src/)
    --cls <path>      Target .cls.ts file (default: auto-detect or app.cls.ts)
    --no-migrate      Skip auto-migration after adding
    --dry-run         Show what would be added without writing
`);
        return;
      }
      positional.push(args[i]);
    }
    if (positional.length < 2) {
      console.error("  Usage: rjit classify add <Name> '<json_definition>'");
      process2.exit(1);
    }
    const name = positional[0];
    const defStr = positional.slice(1).join(" ");
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
      console.error(`  Name must be PascalCase (e.g., MyPanel): "${name}"`);
      process2.exit(1);
    }
    let def2;
    try {
      def2 = JSON.parse(defStr);
    } catch (e) {
      console.error(`  Invalid JSON definition: ${e.message}`);
      console.error(`  Got: ${defStr}`);
      process2.exit(1);
    }
    const primitive = def2.type;
    if (!primitive || !CLASSIFIER_PRIMITIVES.has(primitive)) {
      console.error(`  Invalid type "${primitive}". Valid: ${[...CLASSIFIER_PRIMITIVES].join(", ")}`);
      process2.exit(1);
    }
    const styleStatics = { ...def2.style || {} };
    const jsxProps = {};
    for (const [k, v] of Object.entries(def2)) {
      if (k === "type" || k === "style" || k === "use") continue;
      if (primitive === "Text") {
        if (k === "size") {
          styleStatics.fontSize = v;
          continue;
        }
        if (k === "bold" && v === true) {
          styleStatics.fontWeight = "bold";
          continue;
        }
        if (k === "color") {
          styleStatics.color = v;
          continue;
        }
      }
      jsxProps[k] = v;
    }
    let exactCount = 0;
    let partialCount = 0;
    let matchFileCount = 0;
    if (existsSync(scanDir)) {
      const sig = makeSignature(primitive, styleStatics, jsxProps);
      const { elements } = scanElements(scanDir, ts);
      const matchFiles = /* @__PURE__ */ new Set();
      for (const el of elements) {
        if (el.primitive !== primitive) continue;
        const elSig = makeSignature(el.primitive, el.styleStatics, el.jsxProps);
        if (elSig === sig) {
          exactCount++;
          matchFiles.add(el.file);
        } else {
          let isPartial = true;
          for (const [k, v] of Object.entries(styleStatics)) {
            if (el.styleStatics[k] === void 0 || JSON.stringify(el.styleStatics[k]) !== JSON.stringify(v)) {
              isPartial = false;
              break;
            }
          }
          if (isPartial) {
            for (const [k, v] of Object.entries(jsxProps)) {
              if (el.jsxProps[k] === void 0 || JSON.stringify(el.jsxProps[k]) !== JSON.stringify(v)) {
                isPartial = false;
                break;
              }
            }
          }
          if (isPartial) {
            partialCount++;
            matchFiles.add(el.file);
          }
        }
      }
      matchFileCount = matchFiles.size;
    }
    const matchCount = exactCount + partialCount;
    const entryStyleStatics = { ...def2.style || {} };
    const entryJsxProps = {};
    for (const [k, v] of Object.entries(def2)) {
      if (k === "type" || k === "style" || k === "use") continue;
      if (primitive === "Text") {
        if (k === "size") {
          entryStyleStatics.fontSize = v;
          continue;
        }
        if (k === "bold" && v === true) {
          entryStyleStatics.fontWeight = "bold";
          continue;
        }
        if (k === "color") {
          entryStyleStatics.color = v;
          continue;
        }
      }
      entryJsxProps[k] = v;
    }
    const entry = generatePickEntry({
      name,
      primitive,
      styleStatics: entryStyleStatics,
      jsxProps: entryJsxProps,
      matches: new Array(matchCount)
    });
    if (!clsPath) {
      if (existsSync(scanDir)) {
        const { cls } = findRenameTargets(scanDir);
        clsPath = cls.length > 0 ? cls[0] : null;
      }
      if (!clsPath) {
        try {
          const cwdEntries = readdirSync(cwd);
          const found = cwdEntries.find((e) => e.endsWith(".cls.ts"));
          if (found) clsPath = join(cwd, found);
        } catch {
        }
      }
      if (!clsPath) {
        clsPath = join(cwd, "app.cls.ts");
      }
    }
    if (existsSync(clsPath)) {
      const existing = readFileSync(clsPath, "utf-8");
      const nameRe = new RegExp(`^\\s*${name}\\s*:`, "m");
      if (nameRe.test(existing)) {
        console.error(`  Classifier "${name}" already exists in ${relative(cwd, clsPath)}`);
        process2.exit(1);
      }
    }
    console.log(`
  ${name}: ${primitive}`);
    const traits = formatTraits(styleStatics, jsxProps);
    if (traits) console.log(`    ${traits}`);
    console.log(`    ${exactCount} exact + ${partialCount} partial = ${matchCount} matches across ${matchFileCount} files`);
    if (dryRun) {
      console.log(`
  Entry that would be added:
${entry}
`);
      return;
    }
    if (existsSync(clsPath)) {
      appendEntries(clsPath, [entry]);
    } else {
      const content = [
        `import { classifier } from '@reactjit/core';`,
        ``,
        `classifier({`,
        entry,
        `});`,
        ``
      ].join("\n");
      writeFileSync(clsPath, content, "utf-8");
    }
    console.log(`  Written to ${relative(cwd, clsPath)}`);
    if (!noMigrate && existsSync(scanDir)) {
      console.log(`  Running migration (partial)...`);
      const { bySig } = parseClsFile(clsPath, ts);
      const { tsx } = findRenameTargets(scanDir);
      let totalReplacements = 0;
      const touchedFiles = [];
      for (const filePath of tsx) {
        const source = readFileSync(filePath, "utf-8");
        const aliases = findClassifierAliases(source);
        const clsAlias = aliases.size > 0 ? [...aliases][0] : "S";
        const { changed, count } = migrateFile(filePath, bySig, clsAlias, ts, true);
        if (changed) {
          totalReplacements += count;
          touchedFiles.push({ file: relative(cwd, filePath), count });
        }
      }
      if (touchedFiles.length > 0) {
        console.log(`  Migrated ${totalReplacements} inline styles across ${touchedFiles.length} files:`);
        for (const { file, count } of touchedFiles.sort((a, b) => b.count - a.count)) {
          console.log(`    ${file.padEnd(55)} ${count}`);
        }
      } else {
        console.log(`  No inline styles matched for migration.`);
      }
    }
    console.log("");
  }
  function binarySearchIdx(arr, val) {
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (arr[mid] === val) return true;
      if (arr[mid] < val) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  }
  function minePartialPatterns(elements, minOccurrences, maxSize) {
    const byPrim = {};
    for (const el of elements) {
      if (!byPrim[el.primitive]) byPrim[el.primitive] = [];
      byPrim[el.primitive].push(el);
    }
    const allResults = [];
    for (const [primitive, els] of Object.entries(byPrim)) {
      const transactions = els.map((el) => {
        const items = /* @__PURE__ */ new Set();
        for (const [k, v] of Object.entries(el.styleStatics)) {
          items.add(`s:${k}=${JSON.stringify(v)}`);
        }
        for (const [k, v] of Object.entries(el.jsxProps)) {
          items.add(`p:${k}=${JSON.stringify(v)}`);
        }
        return items;
      });
      const fullSigs = els.map(
        (el) => makeSignature(el.primitive, el.styleStatics, el.jsxProps)
      );
      const itemFreq = /* @__PURE__ */ new Map();
      for (const t of transactions) {
        for (const item of t) {
          itemFreq.set(item, (itemFreq.get(item) || 0) + 1);
        }
      }
      const freq1 = [...itemFreq.entries()].filter(([, c]) => c >= minOccurrences).sort(([a], [b]) => a < b ? -1 : 1).map(([item]) => item);
      if (freq1.length === 0) continue;
      const itemIdx = /* @__PURE__ */ new Map();
      freq1.forEach((item, i) => itemIdx.set(item, i));
      const txIdx = transactions.map((t) => {
        const arr = [];
        for (const item of t) {
          const idx = itemIdx.get(item);
          if (idx !== void 0) arr.push(idx);
        }
        return arr.sort((a, b) => a - b);
      });
      let prevLevel = freq1.map((_, i) => [i]);
      for (let k = 2; k <= maxSize && prevLevel.length > 0; k++) {
        const candidates = [];
        for (let i = 0; i < prevLevel.length; i++) {
          for (let j = i + 1; j < prevLevel.length; j++) {
            const a = prevLevel[i];
            const b = prevLevel[j];
            let ok = true;
            for (let x = 0; x < k - 2; x++) {
              if (a[x] !== b[x]) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            candidates.push([...a, b[k - 2]]);
          }
        }
        if (candidates.length > 5e4) break;
        const nextLevel = [];
        for (const cand of candidates) {
          let count = 0;
          const sigs = /* @__PURE__ */ new Set();
          const files = /* @__PURE__ */ new Set();
          for (let ti = 0; ti < txIdx.length; ti++) {
            const tx = txIdx[ti];
            let all = true;
            for (const idx of cand) {
              if (!binarySearchIdx(tx, idx)) {
                all = false;
                break;
              }
            }
            if (all) {
              count++;
              sigs.add(fullSigs[ti]);
              files.add(els[ti].file);
            }
          }
          if (count >= minOccurrences) {
            nextLevel.push(cand);
            if (sigs.size > 1) {
              const styleStatics = {};
              const jsxProps = {};
              for (const idx of cand) {
                const item = freq1[idx];
                const isStyle = item.startsWith("s:");
                const rest = item.slice(2);
                const eq = rest.indexOf("=");
                const key2 = rest.slice(0, eq);
                const val = JSON.parse(rest.slice(eq + 1));
                if (isStyle) styleStatics[key2] = val;
                else jsxProps[key2] = val;
              }
              allResults.push({
                primitive,
                styleStatics,
                jsxProps,
                count,
                spread: sigs.size,
                fileCount: files.size,
                size: k
              });
            }
          }
        }
        prevLevel = nextLevel;
      }
    }
    allResults.sort((a, b) => {
      const sa = a.count * Math.sqrt(a.size);
      const sb = b.count * Math.sqrt(b.size);
      return sb - sa;
    });
    return allResults;
  }
  function filterDominatedPatterns(patterns) {
    const itemSets = patterns.map((p) => /* @__PURE__ */ new Set([
      ...Object.entries(p.styleStatics).map(([k, v]) => `s:${k}=${JSON.stringify(v)}`),
      ...Object.entries(p.jsxProps).map(([k, v]) => `p:${k}=${JSON.stringify(v)}`)
    ]));
    const dominated = /* @__PURE__ */ new Set();
    for (let i = 0; i < patterns.length; i++) {
      if (dominated.has(i)) continue;
      const p = patterns[i];
      const pItems = itemSets[i];
      for (let j = 0; j < patterns.length; j++) {
        if (i === j || dominated.has(j)) continue;
        const q = patterns[j];
        if (q.primitive !== p.primitive) continue;
        if (q.size <= p.size) continue;
        if (q.count < p.count * 0.9) continue;
        const qItems = itemSets[j];
        let isSuperset = true;
        for (const k of pItems) {
          if (!qItems.has(k)) {
            isSuperset = false;
            break;
          }
        }
        if (isSuperset) {
          dominated.add(i);
          break;
        }
      }
    }
    return patterns.filter((_, i) => !dominated.has(i));
  }
  function buildAddCommand(primitive, styleStatics, jsxProps) {
    const def2 = { type: primitive };
    if (primitive === "Text") {
      if (styleStatics.fontSize != null) def2.size = styleStatics.fontSize;
      if (styleStatics.fontWeight === "bold") def2.bold = true;
      if (styleStatics.color != null) def2.color = styleStatics.color;
      const remaining = {};
      for (const [k, v] of Object.entries(styleStatics)) {
        if (k !== "fontSize" && k !== "fontWeight" && k !== "color") remaining[k] = v;
      }
      if (Object.keys(remaining).length > 0) def2.style = remaining;
    } else {
      if (Object.keys(styleStatics).length > 0) def2.style = styleStatics;
    }
    for (const [k, v] of Object.entries(jsxProps)) def2[k] = v;
    return JSON.stringify(def2);
  }
  async function partialCommand(args, ts) {
    const cwd = process2.cwd();
    let scanDir = defaultScanDir(cwd);
    let minOccurrences = 10;
    let maxSize = 12;
    let top = 40;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--dir") {
        scanDir = join(cwd, args[++i]);
        continue;
      }
      if (args[i] === "--min") {
        minOccurrences = parseInt(args[++i], 10);
        continue;
      }
      if (args[i] === "--max-size") {
        maxSize = parseInt(args[++i], 10);
        continue;
      }
      if (args[i] === "--top") {
        top = parseInt(args[++i], 10);
        continue;
      }
      if (args[i] === "--help" || args[i] === "-h") {
        console.log(`
  rjit classify partial \u2014 Find recurring partial style patterns

  Discovers style property subsets that recur across elements with different
  full styles. Unlike the default mode (which requires ALL properties to
  match), this finds partial overlaps \u2014 the building blocks that appear
  in many different contexts.

  Usage:
    rjit classify partial                   Analyze src/
    rjit classify partial --dir ./stories   Analyze a specific directory
    rjit classify partial --min 15          Minimum occurrences (default: 10)
    rjit classify partial --max-size 4      Max properties per pattern (default: 12)
    rjit classify partial --top 20          Show top N patterns (default: 40)

  Output columns:
    Props   \u2014 number of style properties in the pattern
    Hits    \u2014 total elements containing this property subset
    Spread  \u2014 how many distinct full patterns contain it
    Files   \u2014 how many source files

  To add a discovered pattern as a classifier:
    rjit classify add <Name> '<json_definition>'
`);
        return;
      }
    }
    if (!existsSync(scanDir)) {
      console.error(`  Directory not found: ${scanDir}`);
      process2.exit(1);
    }
    console.log(`
  Scanning ${relative(cwd, scanDir) || "."}/ for partial style patterns...`);
    const { elements, fileCount } = scanElements(scanDir, ts);
    console.log(`  Found ${elements.length} classifiable elements across ${fileCount} files.`);
    console.log(`  Mining frequent property subsets (min: ${minOccurrences})...`);
    if (elements.length === 0) {
      console.log("  Nothing to analyze.\n");
      return;
    }
    const raw = minePartialPatterns(elements, minOccurrences, maxSize);
    const patterns = filterDominatedPatterns(raw);
    if (patterns.length === 0) {
      console.log(`  No partial patterns found with ${minOccurrences}+ occurrences spanning multiple groups.`);
      console.log(`  Try lowering --min.
`);
      return;
    }
    const shown = patterns.slice(0, top);
    console.log(`
  \u2500\u2500 Partial Patterns (${patterns.length} found, showing top ${shown.length}) \u2500\u2500
`);
    console.log(`  ${"#".padStart(4)}  ${"Props".padStart(5)}  ${"Hits".padStart(5)}  ${"Spread".padStart(6)}  ${"Files".padStart(5)}  Pattern`);
    console.log(`  ${"\u2500".repeat(4)}  ${"\u2500".repeat(5)}  ${"\u2500".repeat(5)}  ${"\u2500".repeat(6)}  ${"\u2500".repeat(5)}  ${"\u2500".repeat(50)}`);
    for (let i = 0; i < shown.length; i++) {
      const p = shown[i];
      const allProps = [];
      for (const [k, v] of Object.entries(p.styleStatics)) {
        const vs = typeof v === "string" ? v.length > 20 ? `'${v.slice(0, 17)}\u2026'` : `'${v}'` : v;
        allProps.push(`${k}: ${vs}`);
      }
      for (const [k, v] of Object.entries(p.jsxProps)) {
        const vs = typeof v === "string" ? v.length > 20 ? `'${v.slice(0, 17)}\u2026'` : `'${v}'` : v;
        allProps.push(`${k}: ${vs}`);
      }
      console.log(
        `  ${String(i + 1).padStart(4)}  ${String(p.size).padStart(5)}  ${String(p.count).padStart(5)}  ${String(p.spread).padStart(6)}  ${String(p.fileCount).padStart(5)}  ${p.primitive}: ${allProps.join(", ")}`
      );
    }
    const exCount = Math.min(5, shown.length);
    console.log(`
  \u2500\u2500 Quick-add commands for top ${exCount} \u2500\u2500
`);
    for (let i = 0; i < exCount; i++) {
      const p = shown[i];
      const name = suggestName(p.primitive, p.styleStatics, p.jsxProps, "").replace(/%/g, "Pct").replace(/[^A-Za-z0-9]/g, "");
      const json = buildAddCommand(p.primitive, p.styleStatics, p.jsxProps);
      console.log(`  rjit classify add ${name} '${json}'`);
    }
    console.log("");
  }
  async function pickCommand(args, ts) {
    const cwd = process2.cwd();
    let scanDir = defaultScanDir(cwd);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--dir") {
        scanDir = join(cwd, args[++i]);
        continue;
      }
      if (args[i] === "--help" || args[i] === "-h") {
        console.log(`
  rjit classify pick \u2014 Interactive pattern picker

  Usage:
    rjit classify pick                    Scan src/ interactively
    rjit classify pick --dir ./stories    Scan a specific directory
    rjit classify pick --cls my.cls.ts    Append to a specific .cls.ts file

  Flow:
    1. Pick a primitive (Box, Text, Row, ...)
    2. Pick style properties to filter by
    3. Pick a value combination
    4. See exact patterns + file locations
    5. Name each pattern
    6. Writes to .cls.ts and auto-migrates inline styles

  Type 'q' at any prompt to quit early.
 `);
        return;
      }
    }
    const message = [
      "[classify] pick is currently unavailable under v8cli.",
      "This command requires an interactive stdin readline bridge that is not exposed yet.",
      "Use non-interactive commands (`theme`, `partial`, `add`, `migrate`, `rename`) or run the Bun/node script."
    ].join("\n");
    console.error(message);
    if (typeof __exit === "function") __exit(1);
    if (typeof process2.exit === "function") process2.exit(1);
    throw new Error(message);
  }
  var THEME_CATEGORIES = {
    color: (k) => /color$/i.test(k) || k === "backgroundColor" || k === "tintColor",
    radius: (k) => /Radius$/.test(k),
    spacing: (k) => /^(padding|margin|gap|rowGap|columnGap|top|left|right|bottom|width|height)(Top|Right|Bottom|Left|Horizontal|Vertical|Start|End)?$/.test(k),
    border: (k) => /^border(Top|Right|Bottom|Left)?Width$/.test(k),
    font: (k) => k === "fontSize" || k === "lineHeight"
  };
  function classifyKey(k) {
    for (const [cat, match] of Object.entries(THEME_CATEGORIES)) {
      if (match(k)) return cat;
    }
    return null;
  }
  function isColorLiteral(v) {
    if (typeof v !== "string") return false;
    return /^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgba?\(/i.test(v) || /^hsla?\(/i.test(v);
  }
  function isNumericLiteral(v) {
    return typeof v === "number" && Number.isFinite(v);
  }
  function suggestTokenName(category, value, usedNames) {
    const stems = { color: "color", radius: "radius", spacing: "space", border: "border", font: "font" };
    const stem = stems[category] || "token";
    let base;
    if (category === "radius" || category === "border") {
      base = value <= 2 ? `${stem}Sm` : value <= 8 ? `${stem}Md` : `${stem}Lg`;
    } else if (category === "spacing") {
      base = value <= 4 ? `${stem}Xs` : value <= 8 ? `${stem}Sm` : value <= 16 ? `${stem}Md` : value <= 24 ? `${stem}Lg` : `${stem}Xl`;
    } else if (category === "font") {
      base = value <= 12 ? `${stem}Sm` : value <= 16 ? `${stem}Md` : `${stem}Lg`;
    } else {
      const short = String(value).replace("#", "").replace(/[(),\s%]/g, "").toLowerCase();
      base = `${stem}${short.slice(0, 6)}`;
    }
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    let i = 2;
    while (usedNames.has(`${base}${i}`)) i++;
    const name = `${base}${i}`;
    usedNames.add(name);
    return name;
  }
  function scanThemeTokens(scanDir, ts) {
    const files = findTsxFiles(scanDir);
    const buckets = { color: /* @__PURE__ */ new Map(), radius: /* @__PURE__ */ new Map(), spacing: /* @__PURE__ */ new Map(), border: /* @__PURE__ */ new Map(), font: /* @__PURE__ */ new Map() };
    let styleObjCount = 0;
    for (const filePath of files) {
      let source;
      try {
        source = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node) => {
        if (ts.isJsxAttribute(node) && node.name && node.name.text === "style" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isObjectLiteralExpression(node.initializer.expression)) {
          styleObjCount++;
          const { statics } = extractStyleProps(node.initializer.expression, ts);
          for (const [k, v] of Object.entries(statics)) {
            const cat = classifyKey(k);
            if (!cat) continue;
            if (typeof v === "string" && v.startsWith("theme:")) continue;
            if (cat === "color" && !isColorLiteral(v)) continue;
            if (cat !== "color" && !isNumericLiteral(v)) continue;
            const bucket = buckets[cat];
            const key2 = typeof v === "string" ? v.toLowerCase() : v;
            if (!bucket.has(key2)) bucket.set(key2, { value: v, count: 0, props: /* @__PURE__ */ new Map(), files: /* @__PURE__ */ new Set() });
            const entry = bucket.get(key2);
            entry.count++;
            entry.props.set(k, (entry.props.get(k) || 0) + 1);
            entry.files.add(relative(process2.cwd(), filePath));
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
    return { buckets, files: files.length, styleObjCount };
  }
  function formatThemeReport(buckets, minOcc) {
    const lines = [];
    const categoryOrder = ["color", "radius", "spacing", "border", "font"];
    const used = /* @__PURE__ */ new Set();
    let total = 0;
    for (const cat of categoryOrder) {
      const bucket = buckets[cat];
      const rows = [...bucket.values()].filter((e) => e.count >= minOcc).sort((a, b) => b.count - a.count);
      if (rows.length === 0) continue;
      lines.push(`
  \u2500\u2500 ${cat.toUpperCase()} ${`(${rows.length} candidates)`.padStart(20 - cat.length)}`);
      lines.push(`  ${"suggested".padEnd(18)} ${"value".padEnd(14)} ${"hits".padStart(5)}  props (top)`);
      lines.push(`  ${"\u2500".repeat(18)} ${"\u2500".repeat(14)} ${"\u2500".repeat(5)}  ${"\u2500".repeat(40)}`);
      for (const row of rows) {
        total += row.count;
        const name = suggestTokenName(cat, row.value, used);
        const topProps = [...row.props.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}\xD7${n}`).join(", ");
        const valStr = String(row.value);
        lines.push(`  ${name.padEnd(18)} ${valStr.padEnd(14)} ${String(row.count).padStart(5)}  ${topProps}`);
      }
    }
    if (total === 0) return "\n  No recurring literal style values found above the threshold.\n";
    return lines.join("\n") + `

  ${total} literal uses could collapse into theme tokens.
`;
  }
  function generateThemePaletteSnippet(buckets, minOcc) {
    const used = /* @__PURE__ */ new Set();
    const colors = {};
    const styles = {};
    const categoryOrder = ["color", "radius", "spacing", "border", "font"];
    for (const cat of categoryOrder) {
      const bucket = buckets[cat];
      const rows = [...bucket.values()].filter((e) => e.count >= minOcc).sort((a, b) => b.count - a.count);
      for (const row of rows) {
        const name = suggestTokenName(cat, row.value, used);
        if (cat === "color") colors[name] = row.value;
        else styles[name] = row.value;
      }
    }
    const lines = [
      "// Suggested theme tokens \u2014 generated by `rjit classify theme`.",
      "// Merge into your ThemeProvider colors/styles or applyPreset().",
      "",
      "export const suggestedColors = " + JSON.stringify(colors, null, 2) + ";",
      "",
      "export const suggestedStyles = " + JSON.stringify(styles, null, 2) + ";",
      ""
    ];
    return lines.join("\n");
  }
  async function themeCommand(args, ts) {
    const cwd = process2.cwd();
    let scanDir = defaultScanDir(cwd);
    let minOccurrences = 3;
    let emitPath = null;
    let dryRun = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--dir") {
        scanDir = join(cwd, args[++i]);
        continue;
      }
      if (args[i] === "--min") {
        minOccurrences = parseInt(args[++i], 10);
        continue;
      }
      if (args[i] === "--emit") {
        emitPath = args[++i];
        continue;
      }
      if (args[i] === "--dry-run") {
        dryRun = true;
        continue;
      }
      if (args[i] === "--help" || args[i] === "-h") {
        console.log(`
  rjit classify theme \u2014 suggest theme tokens from recurring style literals
`);
        console.log(`    --dir <path>      Scan directory (default: cart/ or src/)`);
        console.log(`    --min <n>         Minimum occurrences to suggest (default: 3)`);
        console.log(`    --emit <file>     Also write a palette snippet to <file>`);
        console.log(`    --dry-run         With --emit, show what would be written
`);
        return;
      }
    }
    if (!existsSync(scanDir)) {
      console.error(`  Directory not found: ${scanDir}`);
      process2.exit(1);
    }
    console.log(`
  Scanning ${relative(cwd, scanDir) || "."}/ for repeated style literals (min ${minOccurrences})...`);
    const { buckets, files, styleObjCount } = scanThemeTokens(scanDir, ts);
    console.log(`  ${files} files \xB7 ${styleObjCount} style objects
`);
    console.log(formatThemeReport(buckets, minOccurrences));
    if (emitPath) {
      const snippet = generateThemePaletteSnippet(buckets, minOccurrences);
      if (dryRun) {
        console.log(`  (dry-run) Would write ${snippet.length} bytes to: ${emitPath}
`);
      } else {
        writeFileSync(emitPath, snippet, "utf-8");
        console.log(`  Snippet written to: ${emitPath}
`);
      }
    }
  }
  async function classifyCommand(args) {
    if (args[0] === "rename") {
      return renameCommand(args.slice(1));
    }
    const cwd = process2.cwd();
    let ts;
    try {
      ts = loadTypeScript2();
    } catch (err2) {
      console.error("  Failed to load vendored TypeScript:", err2?.stack || err2?.message || err2);
      process2.exit(1);
    }
    if (args[0] === "migrate") {
      return migrateCommand(args.slice(1), ts);
    }
    if (args[0] === "pick") {
      return pickCommand(args.slice(1), ts);
    }
    if (args[0] === "add") {
      return addCommand(args.slice(1), ts);
    }
    if (args[0] === "partial") {
      return partialCommand(args.slice(1), ts);
    }
    if (args[0] === "theme") {
      return themeCommand(args.slice(1), ts);
    }
    let outputPath = join(cwd, "app.cls.ts");
    let minOccurrences = 2;
    let prefix = "";
    let scanDir = defaultScanDir(cwd);
    let dryRun = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--output" || args[i] === "-o") {
        outputPath = args[++i];
        continue;
      }
      if (args[i] === "--min") {
        minOccurrences = parseInt(args[++i], 10);
        continue;
      }
      if (args[i] === "--prefix") {
        prefix = args[++i];
        continue;
      }
      if (args[i] === "--dir") {
        scanDir = join(cwd, args[++i]);
        continue;
      }
      if (args[i] === "--dry-run") {
        dryRun = true;
        continue;
      }
    }
    if (!existsSync(scanDir)) {
      console.error(`  Directory not found: ${scanDir}`);
      process2.exit(1);
    }
    console.log(`
  Scanning ${relative(cwd, scanDir) || "."}/ for classifier patterns...`);
    const { groups, fileCount } = scanPatterns(scanDir, ts, minOccurrences);
    if (groups.length === 0) {
      console.log(`  No repeated patterns found (min: ${minOccurrences} occurrences).`);
      return;
    }
    for (const group of groups) {
      group.suggestedName = suggestName(group.primitive, group.styleStatics, group.jsxProps, prefix);
    }
    deduplicateNames(groups);
    for (const group of groups) {
      group.suggestedName = group.suggestedName.replace(/%/g, "Pct").replace(/[^A-Za-z0-9]/g, "");
    }
    clusterAppendages(groups);
    const appendageCount = groups.filter((g) => g.isAppendage).length;
    if (appendageCount > 0) {
      console.log(`  Folded ${appendageCount} near-duplicate sibling(s) into parent classifiers as .Suffix appendages.`);
    }
    console.log(generateReport(groups, fileCount));
    const content = generateClsFile(groups, prefix);
    if (dryRun) {
      console.log(`  (dry-run) Would write ${content.length} bytes to: ${outputPath}`);
      console.log(`  (dry-run) Pass without --dry-run to write.`);
    } else {
      writeFileSync(outputPath, content, "utf-8");
      console.log(`  Written to: ${outputPath}`);
      console.log(`  Import it at your app entry: import './${basename2(outputPath).replace(".ts", "")}';`);
    }
    console.log("");
  }
  async function run7(argv) {
    try {
      await classifyCommand(argv);
      return 0;
    } catch (err2) {
      console.error(err2);
      return 1;
    }
  }

  // cli/commands/clean.ts
  var clean_exports = {};
  __export(clean_exports, {
    run: () => run8
  });

  // cli/host/zigcache.ts
  var DEFAULT_CACHE_MAX_GB = 100;
  function resolveCacheMaxGb() {
    const raw = __env("RJIT_CACHE_MAX_GB");
    if (!raw) return DEFAULT_CACHE_MAX_GB;
    const gb = Number(raw);
    return Number.isFinite(gb) ? gb : DEFAULT_CACHE_MAX_GB;
  }
  function zigCacheSizeGb(rjitHome) {
    const cache2 = `${rjitHome}/.zig-cache`;
    if (!fsExists(cache2)) return 0;
    const du = spawnSync("du", ["-sb", cache2]);
    const bytes = Number(du.stdout.trim().split("	")[0]);
    return Number.isFinite(bytes) ? bytes / 1e9 : 0;
  }
  function dropZigCache(rjitHome) {
    const cache2 = `${rjitHome}/.zig-cache`;
    if (!fsExists(cache2)) return 0;
    const lock = `${cache2}/.ship.lock`;
    const rm = spawnSync("flock", [
      lock,
      "sh",
      "-c",
      `find '${cache2}' -mindepth 1 -maxdepth 1 ! -name '.ship.lock' -exec rm -rf {} +`
    ]);
    return rm.code;
  }
  function trimZigCacheIfOversized(rjitHome) {
    const maxGb = resolveCacheMaxGb();
    if (maxGb <= 0) return;
    const sizeGb = zigCacheSizeGb(rjitHome);
    if (sizeGb <= maxGb) return;
    out(`[clean] zig cache is ${sizeGb.toFixed(0)}GB (budget ${maxGb}GB) - dropping it; the NEXT build runs fully cold`);
    const code = dropZigCache(rjitHome);
    if (code !== 0) out(`[clean] zig cache drop FAILED (exit ${code})`);
  }

  // cli/dev/deletable.ts
  var ZIG_OUT_CONTENTS = {
    bin: { kind: "regenerable", what: "compiled cart binaries \u2014 rebuilt by `rjit ship` / `rjit dev`" },
    "dev-modules": { kind: "regenerable", what: "hot-loadable dev host modules \u2014 rebuilt by `rjit dev`" },
    lib: { kind: "external", what: "symlinks into external runtimes (LM Studio llama.cpp); build.zig links libllama_ffi.so from here" },
    game: { kind: "authored", what: "BAKE OUTPUT + historically the authored editor maps \u2014 inspect before touching" },
    tools: { kind: "regenerable", what: "built helper tools" },
    tests: { kind: "regenerable", what: "built test binaries" },
    manifest: { kind: "regenerable", what: "build manifests" }
  };
  function classifyOutputChild(name) {
    return ZIG_OUT_CONTENTS[name] ?? { kind: "unknown", what: "not a declared build artifact \u2014 treated as authored work" };
  }
  function humanSize(path) {
    const du = spawnSync("du", ["-sh", path]);
    return du.code === 0 ? du.stdout.trim().split("	")[0] ?? "?" : "?";
  }
  function surveyOutputDir(rjitHome, rel3) {
    const root = `${rjitHome}/${rel3}`;
    if (!fsExists(root)) return [];
    return fsList(root).map((name) => {
      const { kind, what } = classifyOutputChild(name);
      return {
        path: `${rel3}/${name}`,
        kind,
        what,
        size: humanSize(`${root}/${name}`),
        safeToDelete: kind === "regenerable"
      };
    });
  }
  function announce(verdicts, emit) {
    if (verdicts.length === 0) {
      emit("[clean] nothing to survey");
      return;
    }
    const width = Math.max(...verdicts.map((row) => row.path.length));
    for (const row of verdicts) {
      const action = row.safeToDelete ? "DELETE" : "KEEP  ";
      emit(`[clean] ${action} ${row.path.padEnd(width)}  ${row.size.padStart(6)}  ${row.kind} \u2014 ${row.what}`);
    }
    const kept = verdicts.filter((row) => !row.safeToDelete);
    if (kept.length > 0) {
      emit(`[clean] ${kept.length} path(s) KEPT: only declared build artifacts are ever deleted. Remove anything else by hand, after looking inside it.`);
    }
  }

  // cli/dev/orphan-hosts.ts
  var DEV_HOST_BINARY = "zig-out/bin/reactjit-dev";
  function parseDevHostProcesses(psOutput, binaryPath) {
    const hosts = [];
    for (const line of psOutput.split("\n")) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 6) continue;
      if (fields[5] !== binaryPath) continue;
      const pid = Number(fields[0]);
      const ppid = Number(fields[1]);
      const rssKb = Number(fields[2]);
      if (!Number.isInteger(pid) || pid <= 1 || !Number.isInteger(ppid)) continue;
      hosts.push({ pid, ppid, rssKb: Number.isFinite(rssKb) ? rssKb : 0, state: fields[3] ?? "", elapsed: fields[4] ?? "", startedAt: "" });
    }
    return hosts;
  }
  function parseSocketOwner(ssOutput, socketPath) {
    for (const line of ssOutput.split("\n")) {
      if (!line.includes(socketPath)) continue;
      const match = /pid=(\d+)/.exec(line);
      if (match) return Number(match[1]);
    }
    return null;
  }
  function classifyDevHosts(hosts, socketOwner, displayFdCount) {
    const verdicts = hosts.map((host) => {
      const keptBecause = [];
      if (host.ppid !== 1) keptBecause.push(`its launcher is still alive (ppid ${host.ppid})`);
      if (socketOwner !== null && host.pid === socketOwner) keptBecause.push("it owns the dev socket");
      const fds = displayFdCount(host.pid);
      if (fds > 0) keptBecause.push(`it holds ${fds} display/GPU handle${fds === 1 ? "" : "s"}`);
      return { ...host, orphan: keptBecause.length === 0, keptBecause };
    });
    const orphans = verdicts.filter((row) => row.orphan);
    return {
      hosts: verdicts,
      orphans,
      live: verdicts.filter((row) => !row.orphan),
      socketOwner,
      reclaimableKb: orphans.reduce((sum, row) => sum + row.rssKb, 0)
    };
  }
  function displayHandleCount(pid) {
    const listed = spawnSync("ls", ["-l", `/proc/${pid}/fd`]);
    if (listed.code !== 0) return 0;
    let count = 0;
    for (const line of (listed.stdout ?? "").split("\n")) {
      if (/dmabuf|wayland|X11-unix/i.test(line)) count += 1;
    }
    return count;
  }
  function scanDevHosts2(rjitHome, socketPath) {
    const binary = `${rjitHome}/${DEV_HOST_BINARY}`;
    const listed = spawnSync("ps", ["-eo", "pid,ppid,rss,stat,etime,args", "--no-headers"]);
    const hosts = parseDevHostProcesses(listed.stdout ?? "", binary);
    const sockets = spawnSync("ss", ["-xlp"]);
    const owner = parseSocketOwner(sockets.stdout ?? "", socketPath);
    return classifyDevHosts(hosts, owner, displayHandleCount);
  }
  function isAlive(pid) {
    return spawnSync("kill", ["-0", String(pid)]).code === 0;
  }
  function waitForExit(pid, attempts) {
    for (let i = 0; i < attempts; i += 1) {
      if (!isAlive(pid)) return true;
      spawnSync("sleep", ["0.1"]);
    }
    return !isAlive(pid);
  }
  function killOrphanHosts2(rjitHome, socketPath, pids) {
    const scan2 = scanDevHosts2(rjitHome, socketPath);
    const stillOrphaned = new Set(scan2.orphans.map((row) => row.pid));
    const outcomes = [];
    for (const pid of pids) {
      if (!Number.isInteger(pid) || pid <= 1) {
        outcomes.push({ pid, ok: false, reason: "not a valid pid" });
        continue;
      }
      if (!stillOrphaned.has(pid)) {
        outcomes.push({ pid, ok: false, reason: "no longer classifies as an orphan \u2014 it was spared" });
        continue;
      }
      const termed = spawnSync("kill", [String(pid)]);
      if (termed.code !== 0) {
        outcomes.push({ pid, ok: false, reason: (termed.stderr ?? "").trim() || `kill exited ${termed.code}` });
        continue;
      }
      if (waitForExit(pid, 20)) {
        outcomes.push({ pid, ok: true, how: "exited on SIGTERM" });
        continue;
      }
      spawnSync("kill", ["-KILL", String(pid)]);
      if (waitForExit(pid, 10)) {
        outcomes.push({ pid, ok: true, how: "wedged \u2014 needed SIGKILL" });
        continue;
      }
      outcomes.push({ pid, ok: false, reason: "survived SIGTERM and SIGKILL \u2014 likely stuck in an uninterruptible syscall (state D)" });
    }
    return outcomes;
  }
  function formatGb(kb) {
    return `${(kb / 1048576).toFixed(1)} GB`;
  }

  // cli/host/net.ts
  var SocketError = class extends Error {
  };
  function tryUnixConnect(path) {
    const fd = __unixConnect(path);
    return fd < 0 ? null : fd;
  }
  function unixWrite(fd, data) {
    const written = __unixWrite(fd, data);
    if (written < 0) throw new SocketError(`write failed (fd=${fd})`);
  }
  function unixReadLine(fd, deadlineMs) {
    let reply = "";
    while (reply.indexOf("\n") === -1) {
      const remaining = deadlineMs - __nowMs();
      if (remaining <= 0) throw new SocketError("timeout");
      const chunk = __unixReadAll(fd, remaining, 4096);
      if (chunk === null) continue;
      if (chunk === "") throw new SocketError("EOF before newline");
      reply += chunk;
    }
    return reply.slice(0, reply.indexOf("\n"));
  }
  function unixClose(fd) {
    __unixClose(fd);
  }

  // cli/dev/native-approval.ts
  var NATIVE_APPROVAL_FILENAME = "dev-native-apply.json";
  function nativeApprovalPath(rjitHome) {
    return `${rjitHome}/.cache/${NATIVE_APPROVAL_FILENAME}`;
  }
  function changedNativeTiers(active, candidate) {
    const changed = [];
    if (active.core.hash !== candidate.core.hash) changed.push("core");
    if (active.scene3d.hash !== candidate.scene3d.hash) changed.push("scene3d");
    if (active.game.hash !== candidate.game.hash) changed.push("game");
    return changed;
  }
  function sameNativeFingerprints(left, right) {
    return left.core.hash === right.core.hash && left.scene3d.hash === right.scene3d.hash && left.game.hash === right.game.hash;
  }
  function nativeUpdateToken(fingerprints, scene3d, game, core = null) {
    return [
      "native-update-v1",
      fingerprints.core.hash,
      fingerprints.scene3d.hash,
      fingerprints.game.hash,
      scene3d.artifactHash,
      game.artifactHash,
      core?.artifactHash ?? "active-core"
    ].join(":");
  }
  function parseNativeUpdateApproval(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed.token === "string" && parsed.token.startsWith("native-update-v1:") ? { token: parsed.token } : null;
    } catch {
      return null;
    }
  }
  function nativeTierLabel(tier) {
    return tier === "scene3d" ? "3D engine" : tier === "game" ? "game engine" : "core";
  }

  // cli/dev/rebuild-signal.ts
  var DEV_SOCKET_PATH = __env("RJIT_DEV_SOCKET_PATH") || "/tmp/reactjit.sock";
  var TIMEOUT_MS = 3e3;
  var CHECKPOINT_TIMEOUT_MS = 5e3;
  var HOTSTATE_SAVE_TIMEOUT_MS = 3e4;
  function nativeBuildFingerprint(rjitHome) {
    const manifest2 = spawnSync("sh", ["-c", nativeInputManifestScript(), "native-input-manifest", rjitHome]);
    if (manifest2.code !== 0) {
      throw new Error(`native input manifest failed
${manifest2.stderr || manifest2.stdout}`);
    }
    const digest = spawnSync("sha256sum", [], manifest2.stdout);
    if (digest.code !== 0) {
      throw new Error(`native input digest failed
${digest.stderr || digest.stdout}`);
    }
    const hash = digest.stdout.trim().split(/\s+/)[0] || "";
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`native input digest malformed: ${digest.stdout.trim()}`);
    const inputCount = manifest2.stdout.split("\n").filter(Boolean).length;
    return { hash, inputCount };
  }
  function nativeInputManifestScript() {
    return `
set -eu
cd "$1"
{
  # framework/testing/** are zig 'test' modules pulled in ONLY by build.zig's
  # test-* steps (b.addTest) - never by the 'app' step that builds the dev
  # binary. Hashing them made any test-file touch (a test run, a git checkout,
  # another worker editing tests) force a needless full dev rebuild on every
  # start. Prune them: the fingerprint must reflect only the dev binary's inputs.
  find framework -type d -name testing -prune -o -type f -print 2>/dev/null || true
  printf '%s\\n' build.zig sdk/dependency-registry.json scripts/sdk-dependency-resolve.js tools/zig/zig
} | LC_ALL=C sort -u | while IFS= read -r f; do
  [ -f "$f" ] || continue
  sha256sum "$f"
done
`;
  }
  function devBuildInfoPath(bin) {
    return `${bin}.dev-build.json`;
  }
  function readDevBuildId(bin) {
    const raw = tryFsRead(devBuildInfoPath(bin));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed.build_id === "string" ? parsed.build_id : null;
    } catch {
      return null;
    }
  }
  function writeDevBuildInfo(bin, fingerprint) {
    fsWrite(devBuildInfoPath(bin), `${JSON.stringify({
      build_id: fingerprint.hash,
      input_count: fingerprint.inputCount,
      written_at: (/* @__PURE__ */ new Date()).toISOString()
    }, null, 2)}
`);
  }
  function readDevHostInfo(socket = DEV_SOCKET_PATH) {
    if (!fsExists(socket)) return null;
    const fd = tryUnixConnect(socket);
    if (fd === null) return null;
    try {
      unixWrite(fd, "INFO\n");
      const line = unixReadLine(fd, __nowMs() + TIMEOUT_MS).trim();
      const parsed = JSON.parse(line);
      return typeof parsed.build_id === "string" ? parsed : null;
    } catch {
      return null;
    } finally {
      unixClose(fd);
    }
  }
  function requestNativeReload(tier, hash, path, socket = DEV_SOCKET_PATH, timeoutMs = 1e4) {
    const fd = tryUnixConnect(socket);
    if (fd === null) return "unreachable";
    try {
      unixWrite(fd, `NATIVE_RELOAD ${tier} ${hash} ${utf8ByteLength(path)}
`);
      unixWrite(fd, path);
      const acknowledgement = unixReadLine(fd, __nowMs() + TIMEOUT_MS).trim();
      if (!acknowledgement.startsWith("OK")) return "rejected";
    } catch (error) {
      if (error instanceof SocketError) return "unreachable";
      throw error;
    } finally {
      unixClose(fd);
    }
    const deadline = __nowMs() + timeoutMs;
    while (__nowMs() < deadline) {
      const info = readDevHostInfo(socket);
      if (!info) return "unreachable";
      if (info.native_attempt_tier === tier && info.native_attempt_hash === hash) {
        if (info.native_reload === "committed" && (tier === "scene3d" ? info.scene3d_hash : info.game_hash) === hash) return "committed";
        if (info.native_reload === "restart_required") return "restart_required";
        if (info.native_reload === "rejected") return "rejected";
      }
      __sleepMs(20);
    }
    return "timeout";
  }
  function requestDevCheckpoint(requestId, socket = DEV_SOCKET_PATH, timeoutMs = CHECKPOINT_TIMEOUT_MS) {
    const fd = tryUnixConnect(socket);
    if (fd === null) return false;
    try {
      unixWrite(fd, `CHECKPOINT ${requestId}
`);
      const acknowledgement = unixReadLine(fd, __nowMs() + TIMEOUT_MS).trim();
      if (!acknowledgement.startsWith("OK")) return false;
    } catch (error) {
      if (error instanceof SocketError) return false;
      throw error;
    } finally {
      unixClose(fd);
    }
    const deadline = __nowMs() + timeoutMs;
    while (__nowMs() < deadline) {
      const info = readDevHostInfo(socket);
      if (!info) return false;
      if ((info.checkpoint_completed ?? 0) >= requestId) return true;
      __sleepMs(10);
    }
    return false;
  }
  function saveDevHotState(path, socket = DEV_SOCKET_PATH) {
    const fd = tryUnixConnect(socket);
    if (fd === null) return false;
    try {
      unixWrite(fd, `SAVE_HOTSTATE ${utf8ByteLength(path)}
`);
      unixWrite(fd, path);
      return unixReadLine(fd, __nowMs() + HOTSTATE_SAVE_TIMEOUT_MS).trim().startsWith("OK");
    } catch (error) {
      if (error instanceof SocketError) return false;
      throw error;
    } finally {
      unixClose(fd);
    }
  }
  function sendRebuildNotice(stale, socket = DEV_SOCKET_PATH) {
    const body = JSON.stringify({
      id: "dev-host-stale",
      type: "rebuild-required",
      kind: "native-build-id-mismatch",
      title: "Rebuild needed",
      message: "The running dev host was built from different native engine or wire-format sources. Restart rjit dev before hot reload can continue.",
      detail: `running ${shortHash(stale.host.build_id)} / disk ${shortHash(stale.current.hash)}`,
      persistent: true,
      runningBuildId: stale.host.build_id,
      currentBuildId: stale.current.hash,
      inputCount: stale.current.inputCount
    });
    return sendDevNotice(body, socket);
  }
  function sendOrphanHostsNotice(orphans, reclaimableKb, token, approvalPath, socket = DEV_SOCKET_PATH) {
    if (orphans.length === 0) return false;
    const gb = (reclaimableKb / 1048576).toFixed(1);
    const oldest = orphans.reduce((longest, row) => row.elapsed.length > longest.length ? row.elapsed : longest, "");
    return sendDevNotice(JSON.stringify({
      id: "dev-orphan-hosts",
      type: "orphan-hosts",
      kind: "orphan-hosts",
      title: "Orphaned dev hosts",
      message: `${orphans.length} dev host${orphans.length === 1 ? "" : "s"} kept running after their launcher exited. They hold no window and serve nothing.`,
      detail: `${gb} GB held \xB7 oldest ${oldest} \xB7 this app is not among them`,
      persistent: true,
      token,
      approvalPath,
      pids: orphans.map((row) => row.pid),
      reclaimableKb
    }), socket);
  }
  function sendOrphanCleanupResultNotice(retired, attempted, socket = DEV_SOCKET_PATH) {
    return sendDevNotice(JSON.stringify({
      id: "dev-orphan-hosts-result",
      type: "orphan-hosts-result",
      kind: "orphan-hosts-result",
      title: "Orphan cleanup finished",
      message: retired === attempted ? `Retired ${retired} orphaned dev host${retired === 1 ? "" : "s"}` : `Retired ${retired} of ${attempted}; the rest were spared because they no longer looked orphaned`,
      ok: retired > 0
    }), socket);
  }
  function sendNativeUpdateReadyNotice(pending, approvalPath, socket = DEV_SOCKET_PATH) {
    const labels = pending.changedTiers.map(nativeTierLabel);
    return sendDevNotice(JSON.stringify({
      id: "dev-native-update-ready",
      type: "native-update-ready",
      kind: "native-update-ready",
      title: "Native update ready",
      message: "Compilation finished. Keep working as long as you want; this update will not activate until you approve it.",
      detail: `${labels.join(" + ")}${pending.changedTiers.includes("core") ? " \xB7 restart required" : " \xB7 activation may restart the host"}`,
      persistent: true,
      token: pending.token,
      approvalPath,
      changedTiers: pending.changedTiers
    }), socket);
  }
  function sendNativeUpdateResultNotice(ok, message, socket = DEV_SOCKET_PATH) {
    return sendDevNotice(JSON.stringify({
      id: "dev-native-update-result",
      type: "native-update-result",
      kind: "native-update-result",
      title: ok ? "Native update applied" : "Native update not applied",
      message,
      ok,
      persistent: false
    }), socket);
  }
  function sendDevNotice(body, socket) {
    const fd = tryUnixConnect(socket);
    if (fd === null) return false;
    try {
      unixWrite(fd, `NOTICE ${utf8ByteLength(body)}
`);
      unixWrite(fd, body);
      const line = unixReadLine(fd, __nowMs() + TIMEOUT_MS).trim();
      return line.startsWith("OK");
    } catch (error) {
      if (error instanceof SocketError) return false;
      throw error;
    } finally {
      unixClose(fd);
    }
  }
  function shortHash(hash) {
    if (!hash) return "unknown";
    return hash === "unknown" ? hash : hash.slice(0, 12);
  }
  function utf8ByteLength(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 128) bytes += 1;
      else if (code < 2048) bytes += 2;
      else if (code >= 55296 && code <= 56319) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  // cli/commands/clean.ts
  async function run8(argv) {
    let drop = false;
    let bin = false;
    for (const arg of argv) {
      if (arg === "--drop" || arg === "--all") {
        drop = true;
      } else if (arg === "--bin") {
        bin = true;
      } else {
        err(`[clean] unknown arg: ${arg}`);
        err("Usage: rjit clean [--drop] [--bin]");
        return 1;
      }
    }
    const rjitHome = __env("RJIT_HOME") || __cwd();
    const devCacheDomains = [".cache/zig/dev-core", ".cache/zig/dev-scene3d", ".cache/zig/dev-game"];
    if (drop) {
      if (fsExists(`${rjitHome}/.zig-cache`)) {
        out("[clean] dropping the ENTIRE local zig cache (next build is fully cold)...");
        const code = dropZigCache(rjitHome);
        if (code !== 0) {
          err(`[clean] failed (exit ${code})`);
          return code || 1;
        }
      }
      for (const domain of devCacheDomains) {
        const path = `${rjitHome}/${domain}`;
        if (!fsExists(path)) continue;
        out(`[clean] dropping whole ${domain} domain...`);
        const removed = spawnSync("rm", ["-rf", "--", path]);
        if (removed.code !== 0) {
          err(`[clean] failed to drop ${domain} (exit ${removed.code})`);
          return removed.code || 1;
        }
      }
    } else {
      const maxGb = resolveCacheMaxGb();
      const budget = maxGb > 0 ? `${maxGb}GB` : "disabled";
      out(`[clean] auto-drop budget: ${budget} (default ${DEFAULT_CACHE_MAX_GB}GB, RJIT_CACHE_MAX_GB overrides)`);
      out("[clean] run `rjit clean --drop` to drop the cache now");
    }
    const verdicts = surveyOutputDir(rjitHome, "zig-out");
    announce(verdicts, out);
    if (bin) {
      const running = scanDevHosts2(rjitHome, DEV_SOCKET_PATH);
      const live = running.live.map((host) => host.pid);
      if (live.length > 0) {
        out(`[clean] ${live.length} dev host(s) still running (pid ${live.join(", ")}) \u2014 keeping zig-out/dev-modules and zig-out/bin/reactjit-dev`);
      }
      for (const row of verdicts) {
        if (!row.safeToDelete) continue;
        if (live.length > 0 && (row.path === "zig-out/dev-modules" || row.path === "zig-out/bin")) {
          const spared = dropBuiltBinaries(rjitHome, row.path, live.length > 0);
          out(`[clean] ${row.path}: removed ${spared.removed}, kept ${spared.kept} in use`);
          continue;
        }
        out(`[clean] removing ${row.path} (${row.size}, ${row.what})`);
        spawnSync("rm", ["-rf", "--", `${rjitHome}/${row.path}`]);
      }
    }
    reportSize(rjitHome, ".zig-cache");
    for (const domain of devCacheDomains) reportSize(rjitHome, domain);
    reportSize(rjitHome, "zig-out");
    return 0;
  }
  function dropBuiltBinaries(rjitHome, rel3, hostsRunning) {
    const root = `${rjitHome}/${rel3}`;
    if (!fsExists(root)) return { removed: 0, kept: 0 };
    let removed = 0;
    let kept = 0;
    for (const name of fsList(root)) {
      const isLiveHost = hostsRunning && (name === "reactjit-dev" || name === "reactjit-dev-tui" || rel3 === "zig-out/dev-modules" && (name === "scene3d" || name === "game" || name === "records"));
      if (isLiveHost) {
        kept += 1;
        continue;
      }
      spawnSync("rm", ["-rf", "--", `${root}/${name}`]);
      removed += 1;
    }
    return { removed, kept };
  }
  function reportSize(rjitHome, rel3) {
    const path = `${rjitHome}/${rel3}`;
    if (!fsExists(path)) return;
    const du = spawnSync("du", ["-sh", path]);
    const size = du.stdout.trim().split("	")[0] ?? "?";
    out(`[clean] ${rel3}: ${size}`);
  }

  // cli/commands/orphans.ts
  var orphans_exports = {};
  __export(orphans_exports, {
    run: () => run9
  });
  function report(scan2) {
    out(`[orphans] ${scan2.hosts.length} dev host${scan2.hosts.length === 1 ? "" : "s"} running \xB7 socket owner ${scan2.socketOwner ?? "none"}`);
    for (const host of scan2.live) {
      out(`[orphans]   KEEP pid ${host.pid} (${host.elapsed}, ${formatGb(host.rssKb)}) \u2014 ${host.keptBecause.join("; ")}`);
    }
    for (const host of scan2.orphans) {
      out(`[orphans]   ORPHAN pid ${host.pid} (${host.elapsed}, ${formatGb(host.rssKb)}) \u2014 reparented to init, no socket, no window`);
    }
    if (scan2.orphans.length === 0) {
      out("[orphans] nothing to retire");
      return;
    }
    out(`[orphans] ${scan2.orphans.length} orphan${scan2.orphans.length === 1 ? "" : "s"} holding ${formatGb(scan2.reclaimableKb)}`);
  }
  async function run9(argv) {
    let kill = false;
    let json = false;
    for (const arg of argv) {
      if (arg === "--kill") kill = true;
      else if (arg === "--json") json = true;
      else {
        err(`[orphans] unknown arg: ${arg}`);
        err("Usage: rjit orphans [--kill] [--json]");
        return 1;
      }
    }
    const rjitHome = __env("RJIT_HOME") || __cwd();
    const scan2 = scanDevHosts2(rjitHome, DEV_SOCKET_PATH);
    if (!kill) {
      if (json) out(JSON.stringify(scan2));
      else report(scan2);
      return 0;
    }
    if (scan2.orphans.length === 0) {
      if (json) out(JSON.stringify({ killed: [], scan: scan2 }));
      else out("[orphans] nothing to retire");
      return 0;
    }
    const outcomes = killOrphanHosts2(rjitHome, DEV_SOCKET_PATH, scan2.orphans.map((row) => row.pid));
    const retired = outcomes.filter((row) => row.ok);
    if (json) {
      out(JSON.stringify({ killed: outcomes, reclaimedKb: scan2.reclaimableKb }));
    } else {
      for (const outcome of outcomes) {
        if (outcome.ok) out(`[orphans] retired pid ${outcome.pid} \u2014 ${outcome.how}`);
        else err(`[orphans] NOT retired, pid ${outcome.pid}: ${outcome.reason}`);
      }
      const wedged = retired.filter((row) => row.how === "wedged \u2014 needed SIGKILL").length;
      out(`[orphans] retired ${retired.length}/${outcomes.length}${retired.length === outcomes.length ? "" : " \u2014 the rest are STILL RUNNING"}, reclaiming about ${formatGb(scan2.reclaimableKb)}`);
      if (wedged > 0) {
        out(`[orphans] ${wedged} ignored SIGTERM and needed SIGKILL \u2014 their main loop was already gone, so the quit flag had no reader`);
      }
    }
    return retired.length === outcomes.length ? 0 : 1;
  }

  // cli/commands/codegen-bindings.ts
  var codegen_bindings_exports = {};
  __export(codegen_bindings_exports, {
    run: () => run10
  });
  var HUMANOID_SOURCE_PATH = "runtime/skeleton/data/humanoid-v1.json";
  var HUMANOID_TS_PATH = "runtime/skeleton/generated/humanoid-v1.ts";
  var HUMANOID_ZIG_PATH = "framework/skeleton/generated/humanoid_v1.zig";
  async function run10(argv) {
    const args = parseArgs(argv, { flags: { check: "bool", strict: "bool" } });
    const ingredients = loadIngredients();
    const humanoid = loadHumanoidSource();
    const zig = emitZig2(ingredients);
    const dts = emitDts(ingredients);
    const json = emitJson(ingredients);
    const outputs = [
      { path: "framework/_generated_bindings.zig", content: zig },
      { path: "runtime/_generated_host_globals.d.ts", content: dts },
      { path: "sdk/bindings.generated.json", content: json },
      { path: HUMANOID_TS_PATH, content: emitHumanoidTs(humanoid) },
      { path: HUMANOID_ZIG_PATH, content: emitHumanoidZig(humanoid) }
    ];
    if (args.flags.check) {
      let clean = true;
      for (const output of outputs) {
        if (!fsExists(output.path) || fsRead(output.path) !== output.content) {
          err(`codegen-bindings: ${output.path} drift`);
          clean = false;
        }
      }
      if (!clean) return 1;
      out("codegen-bindings: clean");
      return 0;
    }
    ensureDirectory("runtime/skeleton/generated");
    ensureDirectory("framework/skeleton/generated");
    for (const output of outputs) fsWrite(output.path, output.content);
    out(`codegen-bindings: wrote ${outputs.map((x) => x.path).join(", ")}`);
    if (args.flags.strict) {
      out("codegen-bindings: strict lints are not active until hook declarations land");
    }
    return 0;
  }
  function ensureDirectory(path) {
    if (!fsExists(path)) fsMkdir(path);
  }
  function loadHumanoidSource() {
    let parsed;
    try {
      parsed = JSON.parse(fsRead(HUMANOID_SOURCE_PATH));
    } catch (error) {
      throw new Error(`${HUMANOID_SOURCE_PATH}: ${error.message}`);
    }
    return validateHumanoidSource(parsed);
  }
  function validateHumanoidSource(value) {
    const source = record(value, HUMANOID_SOURCE_PATH);
    if (source.version !== 1) fail3("version must be 1");
    if (source.id !== "humanoid-v1") fail3("id must be humanoid-v1");
    if (!Array.isArray(source.bones) || source.bones.length !== 24) {
      fail3("bones must contain exactly the canonical 24 entries");
    }
    const bones = source.bones.map((raw, index) => validateSourceBone(raw, index));
    if (bones.length > 255) fail3("bone count exceeds the GPU palette limit of 255");
    const byId = /* @__PURE__ */ new Map();
    for (const bone of bones) {
      if (!bone.id) fail3("bone ids must be non-empty");
      if (byId.has(bone.id)) fail3(`duplicate bone id ${bone.id}`);
      byId.set(bone.id, bone);
    }
    const roots = bones.filter((bone) => bone.parent == null);
    if (roots.length !== 1 || roots[0].id !== "root") fail3("the sole root must have id root");
    for (const bone of bones) {
      if (bone.parent != null && !byId.has(bone.parent)) {
        fail3(`unknown parent ${bone.parent} on ${bone.id}`);
      }
    }
    for (const bone of bones) {
      const seen = /* @__PURE__ */ new Set();
      let cursor = bone;
      while (cursor) {
        if (seen.has(cursor.id)) fail3(`cycle at bone ${bone.id}`);
        seen.add(cursor.id);
        cursor = cursor.parent == null ? void 0 : byId.get(cursor.parent);
      }
    }
    const childCounts = /* @__PURE__ */ new Map();
    for (const bone of bones) childCounts.set(bone.id, 0);
    for (const bone of bones) {
      if (bone.parent != null) {
        childCounts.set(bone.parent, childCounts.get(bone.parent) + 1);
        if (lengthSquared(bone.transform.pos) <= 1e-12) {
          fail3(`zero-length parent segment at ${bone.id}`);
        }
      }
      if (bone.tip && lengthSquared(bone.tip) <= 1e-12) fail3(`zero-length tip at ${bone.id}`);
    }
    for (const bone of bones) {
      if (childCounts.get(bone.id) === 0 && !bone.tip) {
        fail3(`terminal bone ${bone.id} needs a non-zero local tip`);
      }
    }
    if (!Array.isArray(source.semanticBindings)) fail3("semanticBindings must be an array");
    const semanticBindings = source.semanticBindings.map((raw, index) => validateSemanticBinding(raw, index, byId));
    validateSemanticCompleteness(semanticBindings);
    const tuning = validateTuning(source.tuning);
    return {
      version: 1,
      id: "humanoid-v1",
      bones,
      semanticBindings,
      tuning
    };
  }
  function validateSourceBone(value, index) {
    const bone = record(value, `bones[${index}]`);
    const id = stringValue(bone.id, `bones[${index}].id`);
    const displayName = stringValue(bone.displayName, `${id}.displayName`);
    const parent = bone.parent === null ? null : stringValue(bone.parent, `${id}.parent`);
    const transform = record(bone.transform, `${id}.transform`);
    const pos4 = vec3(transform.pos, `${id}.transform.pos`);
    const rot = quat(transform.rot, `${id}.transform.rot`);
    const scale = vec3(transform.scale, `${id}.transform.scale`);
    if (scale.some((component) => Math.abs(component) <= 1e-12)) fail3(`${id}.transform.scale contains zero`);
    const norm = Math.sqrt(rot.reduce((sum, component) => sum + component * component, 0));
    if (Math.abs(norm - 1) > 1e-5) fail3(`${id}.transform.rot is not normalized`);
    const tip = bone.tip === void 0 ? void 0 : vec3(bone.tip, `${id}.tip`);
    const joint = bone.joint === void 0 ? void 0 : validateSourceJoint(bone.joint, id);
    return { id, displayName, parent, transform: { pos: pos4, rot, scale }, tip, joint };
  }
  function validateSourceJoint(value, boneId) {
    const joint = record(value, `${boneId}.joint`);
    const kind = stringValue(joint.kind, `${boneId}.joint.kind`);
    if (kind === "ball") {
      return {
        kind,
        swingXDeg: range(joint.swingXDeg, `${boneId}.joint.swingXDeg`),
        swingZDeg: range(joint.swingZDeg, `${boneId}.joint.swingZDeg`),
        twistYDeg: range(joint.twistYDeg, `${boneId}.joint.twistYDeg`)
      };
    }
    if (kind !== "hinge" && kind !== "slide" && kind !== "pivot" && kind !== "spin") {
      fail3(`${boneId}.joint.kind is not supported`);
    }
    const axis = vec3(joint.axis, `${boneId}.joint.axis`);
    if (lengthSquared(axis) <= 1e-12) fail3(`${boneId}.joint.axis is zero`);
    return { kind, axis, limitsDeg: range(joint.limitsDeg, `${boneId}.joint.limitsDeg`) };
  }
  function validateSemanticBinding(value, index, bones) {
    const binding = record(value, `semanticBindings[${index}]`);
    const role = stringValue(binding.role, `semanticBindings[${index}].role`);
    const boneId = stringValue(binding.boneId, `semanticBindings[${index}].boneId`);
    if (!bones.has(boneId)) fail3(`semantic role ${role} references unknown bone ${boneId}`);
    const centered = CENTER_ROLES.has(role);
    const paired = PAIRED_ROLES.has(role);
    if (!centered && !paired) fail3(`unknown humanoid semantic role ${role}`);
    if (centered) {
      if (binding.side !== void 0) fail3(`center role ${role} cannot have a side`);
      return { role, boneId };
    }
    if (binding.side !== "left" && binding.side !== "right") fail3(`paired role ${role} needs left or right`);
    return { role, side: binding.side, boneId };
  }
  var CENTER_ROLES = /* @__PURE__ */ new Set(["pelvis", "abdomen", "chest", "head", "neck"]);
  var PAIRED_ROLES = /* @__PURE__ */ new Set([
    "upper_arm",
    "lower_arm",
    "hand",
    "upper_leg",
    "lower_leg",
    "foot",
    "clavicle",
    "fingers",
    "toes"
  ]);
  var REQUIRED_CENTER_ROLES = ["pelvis", "abdomen", "chest", "head"];
  var REQUIRED_PAIRED_ROLES = ["upper_arm", "lower_arm", "hand", "upper_leg", "lower_leg", "foot"];
  function validateSemanticCompleteness(bindings) {
    const keys = /* @__PURE__ */ new Set();
    for (const binding of bindings) {
      const key2 = `${binding.role}:${binding.side ?? "center"}`;
      if (keys.has(key2)) fail3(`duplicate semantic seed ${key2}`);
      keys.add(key2);
    }
    for (const role of REQUIRED_CENTER_ROLES) {
      if (!keys.has(`${role}:center`)) fail3(`missing required semantic role ${role}`);
    }
    for (const role of REQUIRED_PAIRED_ROLES) {
      for (const side of ["left", "right"]) {
        if (!keys.has(`${role}:${side}`)) fail3(`missing required semantic role ${role}:${side}`);
      }
    }
  }
  function validateTuning(value) {
    const tuning = record(value, "tuning");
    const presets = record(tuning.bendPresetsDeg, "tuning.bendPresetsDeg");
    const result = {
      specimenSeparationBoundsWidth: finiteNumber(
        tuning.specimenSeparationBoundsWidth,
        "tuning.specimenSeparationBoundsWidth"
      ),
      bendPresetsDeg: {
        shoulderAbduction: finiteNumber(presets.shoulderAbduction, "bendPresetsDeg.shoulderAbduction"),
        elbowFlex: finiteNumber(presets.elbowFlex, "bendPresetsDeg.elbowFlex"),
        wristFlex: finiteNumber(presets.wristFlex, "bendPresetsDeg.wristFlex"),
        hipFlex: finiteNumber(presets.hipFlex, "bendPresetsDeg.hipFlex"),
        kneeFlex: finiteNumber(presets.kneeFlex, "bendPresetsDeg.kneeFlex")
      }
    };
    if (result.specimenSeparationBoundsWidth <= 0) fail3("specimen separation must be positive");
    for (const [name, angle] of Object.entries(result.bendPresetsDeg)) {
      if (angle < 0 || angle > 180) fail3(`bend preset ${name} is outside 0..180 degrees`);
    }
    return result;
  }
  function record(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) fail3(`${label} must be an object`);
    return value;
  }
  function stringValue(value, label) {
    if (typeof value !== "string" || value.length === 0) fail3(`${label} must be a non-empty string`);
    return value;
  }
  function finiteNumber(value, label) {
    if (typeof value !== "number" || !Number.isFinite(value)) fail3(`${label} must be finite`);
    return value;
  }
  function vec3(value, label) {
    if (!Array.isArray(value) || value.length !== 3) fail3(`${label} must have 3 components`);
    return [
      finiteNumber(value[0], `${label}[0]`),
      finiteNumber(value[1], `${label}[1]`),
      finiteNumber(value[2], `${label}[2]`)
    ];
  }
  function quat(value, label) {
    if (!Array.isArray(value) || value.length !== 4) fail3(`${label} must have 4 components`);
    return [
      finiteNumber(value[0], `${label}[0]`),
      finiteNumber(value[1], `${label}[1]`),
      finiteNumber(value[2], `${label}[2]`),
      finiteNumber(value[3], `${label}[3]`)
    ];
  }
  function range(value, label) {
    const raw = record(value, label);
    const min = finiteNumber(raw.min, `${label}.min`);
    const max = finiteNumber(raw.max, `${label}.max`);
    if (min > max) fail3(`${label} is inverted`);
    return { min, max };
  }
  function lengthSquared(value) {
    return value[0] * value[0] + value[1] * value[1] + value[2] * value[2];
  }
  function fail3(message) {
    throw new Error(`${HUMANOID_SOURCE_PATH}: ${message}`);
  }
  function loadIngredients() {
    const source = fsRead("framework/v8_ingredients.zig");
    const rows = source.match(/\.{ \.name = ".*? },/g) ?? [];
    return rows.map((row) => {
      const name = mustMatch(row, /\.name = "([^"]+)"/, row);
      const required = mustMatch(row, /\.required = (true|false)/, row) === "true";
      const grepPrefix = mustMatch(row, /\.grep_prefix = "([^"]*)"/, row);
      const regFn = mustMatch(row, /\.reg_fn = "([^"]+)"/, row);
      const moduleName = mustMatch(row, /\.mod = (v8_bindings_[a-zA-Z0-9_]+)/, row);
      const modulePath = `framework/${moduleName}.zig`;
      const moduleSource = fsExists(modulePath) ? fsRead(modulePath) : "";
      return {
        name,
        required,
        grepPrefix,
        regFn,
        moduleName,
        modulePath,
        hostFns: moduleSource ? hostFnsForRegister(moduleSource, regFn) : [],
        hasTickDrain: /\bpub fn tickDrain\s*\(/.test(moduleSource)
      };
    });
  }
  function hostFnsForRegister(source, regFn) {
    const start = source.indexOf(`pub fn ${regFn}`);
    if (start < 0) return [];
    const bodyStart = source.indexOf("{", start);
    if (bodyStart < 0) return [];
    let depth = 0;
    let end = bodyStart;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
    const body = source.slice(bodyStart, end);
    const fns = [];
    const re = /registerHostFn\("([^"]+)",\s*([A-Za-z0-9_]+)\)/g;
    let match;
    while ((match = re.exec(body)) !== null) {
      fns.push({ js: match[1], zig: match[2] });
    }
    return fns;
  }
  function emitZig2(ingredients) {
    return [
      "// framework/_generated_bindings.zig - DO NOT EDIT.",
      "// Regenerated by `rjit codegen-bindings`.",
      "//",
      "// This independent slice intentionally re-exports the current hand-maintained",
      "// catalog. Runtime shells still import framework/v8_ingredients.zig directly",
      "// until the later integration slice replaces that wiring.",
      "",
      'pub const source = @import("v8_ingredients.zig");',
      "pub const Ingredient = source.Ingredient;",
      "pub const INGREDIENTS = source.INGREDIENTS;",
      "pub const enabledFor = source.enabledFor;",
      "pub const registerAll = source.registerAll;",
      "pub const tickDrain = source.tickDrain;",
      "",
      "pub const GENERATED_BINDING_COUNT = " + String(ingredients.length) + ";",
      ""
    ].join("\n");
  }
  function emitDts(ingredients) {
    const lines = [
      "// runtime/_generated_host_globals.d.ts - DO NOT EDIT.",
      "// Regenerated by `rjit codegen-bindings`.",
      "",
      "declare global {"
    ];
    for (const ingredient of ingredients) {
      lines.push(`  // ${ingredient.name} (${ingredient.modulePath})`);
      for (const fn of ingredient.hostFns) {
        lines.push(`  function ${fn.js}(...args: unknown[]): unknown;`);
      }
      lines.push("");
    }
    lines.push("}");
    lines.push("");
    lines.push("export {};");
    lines.push("");
    return lines.join("\n");
  }
  function emitJson(ingredients) {
    return JSON.stringify({
      generatedFrom: "framework/v8_ingredients.zig",
      bindings: Object.fromEntries(ingredients.map((ingredient) => [ingredient.name, {
        required: ingredient.required,
        module: ingredient.modulePath,
        registerFn: ingredient.regFn,
        grepPrefix: ingredient.grepPrefix,
        tickDrain: ingredient.hasTickDrain ? "real" : "noop",
        hostFns: ingredient.hostFns
      }]))
    }, null, 2) + "\n";
  }
  function emitHumanoidTs(source) {
    const bones = source.bones.map((bone) => ({
      id: bone.id,
      displayName: bone.displayName,
      parent: bone.parent,
      transform: bone.transform,
      ...bone.tip ? { tip: bone.tip } : {},
      ...bone.joint ? { joint: runtimeJoint(bone.joint) } : {}
    }));
    return [
      "// runtime/skeleton/generated/humanoid-v1.ts - DO NOT EDIT.",
      `// Generated from ${HUMANOID_SOURCE_PATH} by \`rjit codegen-bindings\`.`,
      "",
      "import type { Bone, HumanoidRigTuning, HumanoidSemanticBinding, HumanoidTemplate } from '../schema';",
      "",
      `export const HUMANOID_V1_BONE_IDS = ${JSON.stringify(source.bones.map((bone) => bone.id), null, 2)} as const;`,
      "export type HumanoidBoneId = typeof HUMANOID_V1_BONE_IDS[number];",
      "",
      `export const HUMANOID_V1_BONES: readonly Bone[] = ${JSON.stringify(bones, null, 2)};`,
      "",
      `export const HUMANOID_V1_SEMANTIC_BINDINGS: readonly HumanoidSemanticBinding[] = ${JSON.stringify(source.semanticBindings, null, 2)};`,
      "",
      `export const HUMANOID_RIG_TUNING: HumanoidRigTuning = Object.freeze(${JSON.stringify(source.tuning, null, 2)});`,
      "",
      "export const HUMANOID_V1: HumanoidTemplate = Object.freeze({",
      "  version: 1,",
      `  id: ${JSON.stringify(source.id)},`,
      "  bones: HUMANOID_V1_BONES,",
      "  semanticBindings: HUMANOID_V1_SEMANTIC_BINDINGS,",
      "  tuning: HUMANOID_RIG_TUNING,",
      "});",
      ""
    ].join("\n");
  }
  function runtimeJoint(joint) {
    if (joint.kind === "ball") {
      return {
        kind: "ball",
        swingX: radiansRange(joint.swingXDeg),
        swingZ: radiansRange(joint.swingZDeg),
        twistY: radiansRange(joint.twistYDeg)
      };
    }
    return {
      kind: joint.kind,
      axis: joint.axis,
      limits: radiansRange(joint.limitsDeg)
    };
  }
  function radiansRange(value) {
    return { min: generatedNumber(value.min * Math.PI / 180), max: generatedNumber(value.max * Math.PI / 180) };
  }
  function generatedNumber(value) {
    const rounded = Number(value.toFixed(9));
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  function emitHumanoidZig(source) {
    const lines = [
      "//! framework/skeleton/generated/humanoid_v1.zig - DO NOT EDIT.",
      `//! Generated from ${HUMANOID_SOURCE_PATH} by \`rjit codegen-bindings\`.`,
      "",
      'const sk = @import("../skeleton.zig");',
      "",
      "pub const HUMANOID_V1_BONE_IDS = [_][]const u8{",
      ...source.bones.map((bone) => `    ${zigString(bone.id)},`),
      "};",
      "",
      "pub const HUMANOID_V1_PARENT_IDS = [_]?[]const u8{",
      ...source.bones.map((bone) => `    ${bone.parent == null ? "null" : zigString(bone.parent)},`),
      "};",
      "",
      "pub const HUMANOID_V1_BONES = [_]sk.Bone{",
      ...source.bones.map(emitZigBone),
      "};",
      "",
      "pub const HUMANOID_V1_SEMANTIC_BINDINGS = [_]sk.HumanoidSemanticBinding{",
      ...source.semanticBindings.map((binding) => `    .{ .role = .${binding.role}, .side = ${binding.side ? `.${binding.side}` : "null"}, .bone_id = ${zigString(binding.boneId)} },`),
      "};",
      "",
      "pub const HUMANOID_RIG_TUNING = sk.HumanoidRigTuning{",
      `    .specimen_separation_bounds_width = ${zigFloat(source.tuning.specimenSeparationBoundsWidth)},`,
      "    .bend_presets_deg = .{",
      `        .shoulder_abduction = ${zigFloat(source.tuning.bendPresetsDeg.shoulderAbduction)},`,
      `        .elbow_flex = ${zigFloat(source.tuning.bendPresetsDeg.elbowFlex)},`,
      `        .wrist_flex = ${zigFloat(source.tuning.bendPresetsDeg.wristFlex)},`,
      `        .hip_flex = ${zigFloat(source.tuning.bendPresetsDeg.hipFlex)},`,
      `        .knee_flex = ${zigFloat(source.tuning.bendPresetsDeg.kneeFlex)},`,
      "    },",
      "};",
      "",
      "pub const HUMANOID_V1 = sk.HumanoidTemplate{",
      "    .version = 1,",
      `    .id = ${zigString(source.id)},`,
      "    .bones = &HUMANOID_V1_BONES,",
      "    .semantic_bindings = &HUMANOID_V1_SEMANTIC_BINDINGS,",
      "    .tuning = HUMANOID_RIG_TUNING,",
      "};",
      ""
    ];
    return lines.join("\n");
  }
  function emitZigBone(bone) {
    const fields = [
      `.id = ${zigString(bone.id)}`,
      `.display_name = ${zigString(bone.displayName)}`,
      `.parent = ${bone.parent == null ? "null" : zigString(bone.parent)}`,
      `.transform = .{ .pos = ${zigVec(bone.transform.pos)}, .rot = ${zigQuat(bone.transform.rot)}, .scale = ${zigVec(bone.transform.scale)} }`
    ];
    if (bone.tip) fields.push(`.tip = ${zigVec(bone.tip)}`);
    if (bone.joint) fields.push(`.joint = ${emitZigJoint(bone.joint)}`);
    return `    .{ ${fields.join(", ")} },`;
  }
  function emitZigJoint(joint) {
    if (joint.kind === "ball") {
      return `.{ .kind = .ball, .swing_x = ${zigRange(radiansRange(joint.swingXDeg))}, .swing_z = ${zigRange(radiansRange(joint.swingZDeg))}, .twist_y = ${zigRange(radiansRange(joint.twistYDeg))} }`;
    }
    const limits = radiansRange(joint.limitsDeg);
    return `.{ .kind = .${joint.kind}, .axis = ${zigVec(joint.axis)}, .limit_min = ${zigFloat(limits.min)}, .limit_max = ${zigFloat(limits.max)} }`;
  }
  function zigRange(value) {
    return `.{ .min = ${zigFloat(value.min)}, .max = ${zigFloat(value.max)} }`;
  }
  function zigVec(value) {
    return `.{ ${value.map(zigFloat).join(", ")} }`;
  }
  function zigQuat(value) {
    return `.{ ${value.map(zigFloat).join(", ")} }`;
  }
  function zigFloat(value) {
    const rounded = generatedNumber(value);
    return Number.isInteger(rounded) ? `${rounded}.0` : String(rounded);
  }
  function zigString(value) {
    return JSON.stringify(value);
  }
  function mustMatch(source, re, context) {
    const match = re.exec(source);
    if (!match) throw new Error(`cannot parse ingredient row: ${context}`);
    return match[1];
  }

  // cli/commands/dev.ts
  var dev_exports = {};
  __export(dev_exports, {
    run: () => run11
  });

  // cli/dev/native-modules.ts
  var REGISTRY_PATH = "sdk/dev-module-registry.json";
  function fingerprintNativeTiers(rjitHome, profileSalt) {
    const registry = loadRegistry(rjitHome);
    const inputs = hashInputs(rjitHome, registry);
    const sceneSet = new Set(registry.scene3dExclusive);
    const gameSet = new Set(registry.gameExclusive);
    const coreSet = new Set(registry.coreExclusive);
    const isGame = (path) => gameSet.has(path) || registry.gameExclusivePrefixes.some((prefix) => path.startsWith(prefix));
    const isScene = (path) => sceneSet.has(path);
    const isCoreOnly = (path) => coreSet.has(path) || registry.coreExclusivePrefixes.some((prefix) => path.startsWith(prefix));
    return {
      core: digestTier("core", inputs.filter((input) => !isScene(input.path) && !isGame(input.path)), registry.version, profileSalt.core),
      scene3d: digestTier("scene3d", inputs.filter((input) => !isGame(input.path) && !isCoreOnly(input.path)), registry.version, profileSalt.hot),
      game: digestTier("game", inputs.filter((input) => !isScene(input.path) && !isCoreOnly(input.path)), registry.version, profileSalt.hot)
    };
  }
  function readModuleRecord(rjitHome, tier) {
    const raw = tryFsRead(recordPath(rjitHome, tier));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.tier !== tier || typeof parsed.sourceHash !== "string" || typeof parsed.artifactHash !== "string" || typeof parsed.path !== "string") return null;
      if (!fsExists(parsed.path)) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  function moduleRecordIsCurrent(record2, fingerprint) {
    return record2 !== null && record2.sourceHash === fingerprint.hash && fsExists(record2.path);
  }
  function writeModuleRecord(rjitHome, record2) {
    writeRecord(rjitHome, record2.tier, record2);
  }
  function publishStagedModule(rjitHome, tier, sourceHash) {
    const stagingDir = `${rjitHome}/zig-out/dev-modules/${tier}/staging`;
    const filename = fsList(stagingDir).find((entry) => entry.endsWith(".so") || entry.endsWith(".dylib"));
    if (!filename) throw new Error(`[dev-native] ${tier} build produced no shared library in ${stagingDir}`);
    const stagingPath = `${stagingDir}/${filename}`;
    const artifactHash = sha256File(stagingPath);
    const artifactDir = `${rjitHome}/zig-out/dev-modules/${tier}/${artifactHash}`;
    const artifactPath = `${artifactDir}/${filename}`;
    fsMkdir(artifactDir);
    if (!fsExists(artifactPath)) {
      const temporaryPath = `${artifactPath}.publishing-${Math.floor(__nowMs())}`;
      const copied = spawnSync("cp", ["--", stagingPath, temporaryPath]);
      if (copied.code !== 0) throw new Error(`[dev-native] ${tier} publish copy failed
${copied.stderr || copied.stdout}`);
      const moved = spawnSync("mv", ["--", temporaryPath, artifactPath]);
      if (moved.code !== 0) throw new Error(`[dev-native] ${tier} publish rename failed
${moved.stderr || moved.stdout}`);
    }
    const record2 = {
      tier,
      sourceHash,
      artifactHash,
      path: artifactPath,
      builtAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    writeRecord(rjitHome, tier, record2);
    return record2;
  }
  function readCoreRecord(rjitHome) {
    const raw = tryFsRead(recordPath(rjitHome, "core"));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.tier !== "core" || typeof parsed.sourceHash !== "string" || typeof parsed.path !== "string") return null;
      if (!fsExists(parsed.path)) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  function writeCoreRecord(rjitHome, sourceHash, path) {
    const record2 = { tier: "core", sourceHash, path, builtAt: (/* @__PURE__ */ new Date()).toISOString() };
    writeRecord(rjitHome, "core", record2);
    return record2;
  }
  function tierCacheDir(rjitHome, tier) {
    return `${rjitHome}/.cache/zig/dev-${tier}`;
  }
  function useIncrementalCompilation() {
    return __env("RJIT_DEV_FORCE_INCREMENTAL") === "1" && __env("RJIT_DEV_DISABLE_INCREMENTAL") !== "1";
  }
  function sha256File(path) {
    const result = spawnSync("sha256sum", [path]);
    if (result.code !== 0) throw new Error(`sha256sum failed for ${path}
${result.stderr || result.stdout}`);
    const hash = result.stdout.trim().split(/\s+/)[0] || "";
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`malformed sha256 for ${path}`);
    return hash;
  }
  function readSessionManifest(rjitHome) {
    const raw = tryFsRead(sessionPath(rjitHome));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !Array.isArray(parsed.tabs) || typeof parsed.activeTab !== "string") return null;
      return parsed;
    } catch {
      return null;
    }
  }
  function writeSessionManifest(rjitHome, manifest2) {
    fsMkdir(`${rjitHome}/.cache`);
    fsWrite(sessionPath(rjitHome), `${JSON.stringify(manifest2, null, 2)}
`);
  }
  function rememberSessionTab(rjitHome, tab, scene3d, game) {
    const previous = readSessionManifest(rjitHome);
    const tabs = (previous?.tabs ?? []).filter((entry) => entry.name !== tab.name && fsExists(entry.bundlePath));
    tabs.push(tab);
    const manifest2 = { version: 1, activeTab: tab.name, tabs, scene3d, game };
    writeSessionManifest(rjitHome, manifest2);
    return manifest2;
  }
  function updateSessionModules(rjitHome, scene3d, game) {
    const previous = readSessionManifest(rjitHome);
    if (!previous) return null;
    const manifest2 = { ...previous, scene3d, game };
    writeSessionManifest(rjitHome, manifest2);
    return manifest2;
  }
  function loadRegistry(rjitHome) {
    const registry = fsReadJson(`${rjitHome}/${REGISTRY_PATH}`);
    if (registry.version !== 1 || !Array.isArray(registry.inputRoots) || !Array.isArray(registry.sharedFiles) || !Array.isArray(registry.scene3dExclusive) || !Array.isArray(registry.gameExclusivePrefixes) || !Array.isArray(registry.gameExclusive) || !Array.isArray(registry.coreExclusivePrefixes) || !Array.isArray(registry.coreExclusive) || !Array.isArray(registry.forbiddenCoreImports)) {
      throw new Error(`[dev-native] unsupported registry ${rjitHome}/${REGISTRY_PATH}`);
    }
    return registry;
  }
  function hashInputs(rjitHome, registry) {
    const relativePaths = /* @__PURE__ */ new Set();
    for (const root of registry.inputRoots) {
      const absoluteRoot = `${rjitHome}/${root}`;
      if (!fsExists(absoluteRoot)) continue;
      const found = spawnSync("find", [absoluteRoot, "-type", "f"]);
      if (found.code !== 0) throw new Error(`[dev-native] find failed for ${absoluteRoot}
${found.stderr || found.stdout}`);
      for (const absolutePath of found.stdout.split("\n").filter(Boolean)) {
        const relativePath = absolutePath.startsWith(`${rjitHome}/`) ? absolutePath.slice(rjitHome.length + 1) : absolutePath;
        if (relativePath.startsWith("framework/testing/")) continue;
        relativePaths.add(relativePath);
      }
    }
    for (const path of registry.sharedFiles) if (fsExists(`${rjitHome}/${path}`)) relativePaths.add(path);
    const sorted = Array.from(relativePaths).sort();
    const digest = spawnSync("sha256sum", sorted.map((path) => `${rjitHome}/${path}`));
    if (digest.code !== 0) throw new Error(`[dev-native] native input hashing failed
${digest.stderr || digest.stdout}`);
    const byAbsolutePath = /* @__PURE__ */ new Map();
    for (const line of digest.stdout.split("\n")) {
      const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line);
      if (match) byAbsolutePath.set(match[2], match[1]);
    }
    return sorted.map((path) => {
      const absolutePath = `${rjitHome}/${path}`;
      const fileDigest = byAbsolutePath.get(absolutePath);
      if (!fileDigest) throw new Error(`[dev-native] missing digest for ${path}`);
      return { path, digest: fileDigest };
    });
  }
  function digestTier(tier, inputs, registryVersion, profileSalt) {
    const manifest2 = [
      `registry=${registryVersion}`,
      `tier=${tier}`,
      `profile=${profileSalt}`,
      ...inputs.map((input) => `${input.digest}  ${input.path}`),
      ""
    ].join("\n");
    const digest = spawnSync("sha256sum", [], manifest2);
    if (digest.code !== 0) throw new Error(`[dev-native] ${tier} digest failed
${digest.stderr || digest.stdout}`);
    const hash = digest.stdout.trim().split(/\s+/)[0] || "";
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`[dev-native] malformed ${tier} digest`);
    return { hash, inputCount: inputs.length };
  }
  function writeRecord(rjitHome, tier, record2) {
    fsMkdir(`${rjitHome}/zig-out/dev-modules/records`);
    fsWrite(recordPath(rjitHome, tier), `${JSON.stringify(record2, null, 2)}
`);
  }
  function recordPath(rjitHome, tier) {
    return `${rjitHome}/zig-out/dev-modules/records/${tier}.json`;
  }
  function sessionPath(rjitHome) {
    return `${rjitHome}/.cache/dev-native-session.json`;
  }

  // cli/commands/dev.ts
  async function run11(argv) {
    const parsed = parseDevArgs(argv);
    if (typeof parsed === "number") return parsed;
    const cartRoot = __cwd();
    const rjitHome = __env("RJIT_HOME") || cartRoot;
    const cart = resolveCart2(cartRoot, parsed.name);
    if (!cart) return fail4(`[dev] not found: ${cartRoot}/cart/${parsed.name}/index.tsx or ${cartRoot}/cart/${parsed.name}.tsx`, 1);
    const substrate = resolveSubstrate(parsed.substrateFlag, cart.manifest);
    const bundleMode = substrate === "tui" ? "tui-host" : "gpu-host";
    const perCartBundle = `${cartRoot}/.cache/bundle-${parsed.name}.js`;
    const binName = substrate === "tui" ? "reactjit-dev-tui" : "reactjit-dev";
    const bin = `${rjitHome}/zig-out/bin/${binName}`;
    fsMkdir(`${cartRoot}/.cache`);
    runFixReactImports(rjitHome, cartRoot);
    const bakedIcons = bakeIconAtlas({ root: rjitHome, ifNeeded: true, quiet: true });
    if (bakedIcons !== 0) return bakedIcons;
    out(`[dev] bundling ${cart.entry} -> ${perCartBundle}`);
    const term = terminalSize();
    const bundle2 = bundleCart({
      rjitHome,
      cartEntry: cart.entry,
      outFile: perCartBundle,
      mode: bundleMode,
      termCols: term.cols,
      termRows: term.rows
    });
    writeSpawnOutput2(bundle2);
    if (bundle2.code !== 0) return bundle2.code || 1;
    const devFlags = resolveDevFlags(rjitHome);
    if (!devFlags) return 1;
    const profileSalt = nativeProfileSalt(substrate, devFlags);
    const fingerprints = fingerprintNativeTiers(rjitHome, profileSalt);
    const socket = DEV_SOCKET_PATH;
    const hostAlive = isHostAlive(socket);
    if (hostAlive) {
      const hostInfo = readDevHostInfo(socket);
      const activeCoreId = readCoreRecord(rjitHome)?.sourceHash ?? null;
      if (!hostInfo || hostInfo.build_id !== fingerprints.core.hash && hostInfo.build_id !== activeCoreId) {
        const stale = { current: fingerprints.core, host: hostInfo ?? { build_id: "unknown" } };
        sendRebuildNotice(stale, socket);
        err("[dev] cold core changed; its owning supervisor is rebuilding/restarting it.");
        err("[dev] refusing this push until the core build id catches up.");
        err(`[dev] running build id: ${shortHash(stale.host.build_id)}`);
        err(`[dev] disk core id:     ${shortHash(stale.current.hash)} (${stale.current.inputCount} native inputs)`);
        return 1;
      }
      if (hostInfo.build_id !== fingerprints.core.hash) {
        out("[dev-native] native sources have a compiled update pending; the running host remains authoritative until you approve it.");
      }
      out(`[dev] host detected - pushing '${parsed.name}'`);
      const push2 = spawnSync(`${rjitHome}/tools/rjit`, ["push-bundle", parsed.name, perCartBundle]);
      writeSpawnOutput2(push2);
      if (push2.code === 0) {
        const activeSession = readSessionManifest(rjitHome);
        const scene3d2 = activeSession?.scene3d ?? readModuleRecord(rjitHome, "scene3d");
        const game2 = activeSession?.game ?? readModuleRecord(rjitHome, "game");
        if (scene3d2 && game2) rememberSessionTab(rjitHome, sessionTab(parsed.name, perCartBundle), scene3d2, game2);
        out(`[dev] host switched to tab '${parsed.name}'`);
        return 0;
      }
      fsRemove(socket);
    }
    fsWrite(`${rjitHome}/bundle.js`, fsRead(perCartBundle));
    let scene3d = readModuleRecord(rjitHome, "scene3d");
    let game = readModuleRecord(rjitHome, "game");
    if (substrate === "gui") {
      scene3d = ensureModule(rjitHome, cartRoot, "scene3d", fingerprints.scene3d, devFlags, scene3d);
      if (!scene3d) return 1;
      game = ensureModule(rjitHome, cartRoot, "game", fingerprints.game, devFlags, game);
      if (!game) return 1;
    }
    const coreRecord = readCoreRecord(rjitHome);
    const coreStale = !coreRecord || coreRecord.sourceHash !== fingerprints.core.hash || coreRecord.path !== bin || !fsExists(bin);
    if (coreStale && fsExists(bin)) out("[dev-native] cold core inputs changed - rebuilding core once...");
    if (coreStale) {
      const built = buildDevHost(rjitHome, cartRoot, binName, substrate, fingerprints.core, devFlags);
      if (built !== 0) return built;
      writeDevBuildInfo(bin, fingerprints.core);
      writeCoreRecord(rjitHome, fingerprints.core.hash, bin);
    }
    if (substrate === "tui") {
      const child2 = spawn("env", [`RJIT_DEV_CART_DIR=${cart.dir}`, bin]);
      const watchArgs2 = ["watch-and-push", parsed.name, cart.entry, perCartBundle, "--rjit-home", rjitHome, "--tui"];
      const watcher2 = spawn(`${rjitHome}/tools/rjit`, watchArgs2);
      out(`[dev] TUI host child=${child2.id}`);
      drainUntilExit(child2.id, watcher2.id);
      return 0;
    }
    if (!scene3d || !game) return fail4("[dev-native] GUI module bootstrap did not produce both module artifacts", 1);
    rememberSessionTab(rjitHome, sessionTab(parsed.name, perCartBundle), scene3d, game);
    ensurePgRunning(rjitHome);
    const inheritedHandoff = __env("RJIT_DEV_HOTSTATE_HANDOFF") || null;
    const child = spawnDevHost(bin, cart.dir, scene3d, game, inheritedHandoff);
    out(`[dev] host child=${child.id} - run 'rjit dev <other>' from another terminal to add tabs`);
    const watchArgs = ["watch-and-push", parsed.name, cart.entry, perCartBundle, "--rjit-home", rjitHome];
    watchArgs.push("--core-build-id", fingerprints.core.hash);
    if (substrate === "tui") watchArgs.push("--tui");
    const watcher = spawn(`${rjitHome}/tools/rjit`, watchArgs);
    const approvalPath = nativeApprovalPath(rjitHome);
    if (fsExists(approvalPath)) fsRemove(approvalPath);
    const orphanApproval = orphanApprovalPath(rjitHome);
    if (fsExists(orphanApproval)) fsRemove(orphanApproval);
    superviseDevHost({
      rjitHome,
      cartRoot,
      cartDir: cart.dir,
      bin,
      binName,
      substrate,
      devFlags,
      profileSalt,
      hostId: child.id,
      watcherId: watcher.id,
      fingerprints,
      activeFingerprints: fingerprints,
      scene3d,
      game,
      pendingNative: null,
      approvalPath,
      orphanApprovalPath: orphanApproval,
      // Orphans accumulate over days, not seconds. The first scan waits a minute so a
      // host that is still coming up is never mistaken for one that was abandoned.
      nextOrphanScanMs: __nowMs() + ORPHAN_FIRST_SCAN_MS
    });
    return 0;
  }
  function parseDevArgs(argv) {
    let name = "";
    let substrateFlag = null;
    for (const arg of argv) {
      if (arg === "--tui" || arg === "--headless") {
        substrateFlag = "tui";
      } else if (arg === "--gui") {
        substrateFlag = "gui";
      } else if (arg.startsWith("--")) {
        err(`[dev] unknown flag: ${arg}`);
        return usage();
      } else if (name) {
        err(`[dev] unexpected positional arg: ${arg}`);
        return usage();
      } else {
        name = arg;
      }
    }
    if (!name) return usage();
    return { name, substrateFlag };
  }
  function usage() {
    err("Usage: scripts/dev <cart-name>");
    err(`  Cart expected at: ${__cwd()}/cart/<name>/index.tsx or ${__cwd()}/cart/<name>.tsx`);
    return 1;
  }
  function resolveCart2(cartRoot, name) {
    const dirEntry = `${cartRoot}/cart/${name}/index.tsx`;
    if (fsExists(dirEntry)) return { entry: dirEntry, dir: dirname2(dirEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
    const fileEntry = `${cartRoot}/cart/${name}.tsx`;
    if (fsExists(fileEntry)) return { entry: fileEntry, dir: dirname2(fileEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
    return null;
  }
  function resolveSubstrate(flag, manifestPath) {
    if (flag) return flag;
    if (fsExists(manifestPath)) {
      const surface = loadManifest(manifestPath).surface;
      if (surface === "tui" || surface === "gui") return surface;
    }
    return "gui";
  }
  function runFixReactImports(rjitHome, cartRoot) {
    const script = `${rjitHome}/scripts/fix-react-imports`;
    if (!fsExists(script)) return;
    const result = spawnSync("env", [`RJIT_HOME=${rjitHome}`, `CART_ROOT=${cartRoot}`, script]);
    writeSpawnOutput2(result);
  }
  function isHostAlive(socket) {
    if (!fsExists(socket)) return false;
    if (readDevHostInfo(socket)) return true;
    fsRemove(socket);
    return false;
  }
  function resolveDevFlags(rjitHome) {
    const flagsResult = spawnSync(`${rjitHome}/tools/rjit`, ["metafile-gate", "--format", "dev-zig-flags", "--build-zig", `${rjitHome}/build.zig`]);
    writeSpawnOutput2(flagsResult);
    if (flagsResult.code !== 0) return null;
    const devFlags = flagsResult.stdout.trim().split(/\s+/).filter(Boolean);
    if (devFlags.length === 0) {
      err("[dev] FATAL: sdk-dependency-resolve produced no dev flags");
      return null;
    }
    return devFlags;
  }
  function nativeProfileSalt(substrate, devFlags) {
    const base = ["modular-dev-v1", substrate, ...devFlags.slice().sort()].join("\n");
    return { core: `${base}
socket=${DEV_SOCKET_PATH}`, hot: base };
  }
  function buildDevHost(rjitHome, cartRoot, binName, substrate, fingerprint, devFlags, installPrefix = `${rjitHome}/zig-out`) {
    out(`[dev-native] compiling cold core (${installPrefix}/bin/${binName}, ${substrate}, ReleaseFast)...`);
    const zig = resolveZig(rjitHome);
    const cacheDir = tierCacheDir(rjitHome, "core");
    fsMkdir(cacheDir);
    const args = [
      "build",
      "app",
      "-p",
      installPrefix,
      `-Dapp-name=${binName}`,
      "-Dapp-source=framework/v8_app.zig",
      `-Dbundle-path=${rjitHome}/framework/dev_bundle_stub.js`,
      `-Ddev-bundle-path=${rjitHome}/bundle.js`,
      `-Ddev-socket-path=${DEV_SOCKET_PATH}`,
      `-Ddev-build-id=${fingerprint.hash}`,
      `-Ddev-native-modules=${substrate === "gui" ? "true" : "false"}`,
      ...devFlags,
      "-Doptimize=ReleaseFast",
      "--cache-dir",
      cacheDir,
      useIncrementalCompilation() ? "-fincremental" : "-fno-incremental"
    ];
    if (substrate === "tui") args.push("-Dhas-gpu=false");
    const cmd = cartRoot === rjitHome ? zig : "env";
    const finalArgs = cartRoot === rjitHome ? args : [`ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...args];
    const build = spawnSync(cmd, finalArgs);
    writeSpawnOutput2(build);
    if (build.code !== 0) return build.code || 1;
    trimZigCacheIfOversized(rjitHome);
    return 0;
  }
  function buildNativeModule(rjitHome, cartRoot, tier, fingerprint, devFlags) {
    const started = __nowMs();
    out(`[dev-native] ${tier} ${shortHash(fingerprint.hash)} compiling (ReleaseFast${useIncrementalCompilation() ? ", incremental" : ""})...`);
    const zig = resolveZig(rjitHome);
    const cacheDir = tierCacheDir(rjitHome, tier);
    fsMkdir(cacheDir);
    const args = [
      "build",
      tier === "scene3d" ? "dev-scene3d-module" : "dev-game-module",
      "-p",
      `${rjitHome}/zig-out`,
      "-Ddev-native-modules=true",
      tier === "scene3d" ? "-Ddev-scene3d-module=true" : "-Ddev-game-module=true",
      ...devFlags,
      "-Doptimize=ReleaseFast",
      "--cache-dir",
      cacheDir,
      useIncrementalCompilation() ? "-fincremental" : "-fno-incremental"
    ];
    const cmd = cartRoot === rjitHome ? zig : "env";
    const finalArgs = cartRoot === rjitHome ? args : [`ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...args];
    const built = spawnSync(cmd, finalArgs);
    writeSpawnOutput2(built);
    if (built.code !== 0) {
      err(`[dev-native] ${tier} compile failed; active module remains loaded`);
      return null;
    }
    const record2 = publishStagedModule(rjitHome, tier, fingerprint.hash);
    out(`[dev-native] ${tier} published ${shortHash(record2.artifactHash)} in ${(__nowMs() - started).toFixed(0)}ms`);
    return record2;
  }
  function ensureModule(rjitHome, cartRoot, tier, fingerprint, devFlags, record2) {
    if (moduleRecordIsCurrent(record2, fingerprint)) {
      out(`[dev-native] ${tier} ${shortHash(record2.artifactHash)} cached`);
      return record2;
    }
    return buildNativeModule(rjitHome, cartRoot, tier, fingerprint, devFlags);
  }
  function ensurePgRunning(rjitHome) {
    const pg = resolvePg(rjitHome);
    if (!pg) {
      err("[dev] postgres not found - install postgresql or run scripts/stage-pg-bundle");
      return;
    }
    const datadir = `${__env("HOME") || "/tmp"}/.cache/reactjit-embed/embed-pg`;
    const sockdir = `${__env("HOME") || "/tmp"}/.cache/reactjit-embed/embed-pg-sock`;
    const status = spawnSync(pg.pgCtl, ["-D", datadir, "-s", "status"]);
    if (status.code === 0) return;
    const pidfile = `${datadir}/postmaster.pid`;
    const stalePid = tryFsRead(pidfile)?.split("\n")[0]?.trim();
    if (stalePid && spawnSync("kill", ["-0", stalePid]).code !== 0) fsRemove(pidfile);
    fsMkdir(datadir);
    fsMkdir(sockdir);
    if (!fsExists(`${datadir}/PG_VERSION`)) {
      out("[dev] initializing embedded postgres cluster (first run)...");
      const init = spawnSync("env", [`PGSHAREDIR=${pg.shareDir}`, pg.initdb, "-D", datadir, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C", "--no-sync"]);
      writeSpawnOutput2(init);
      if (init.code !== 0) return;
    }
    out("[dev] starting embedded postgres...");
    const start = spawnSync("env", [
      `PGSHAREDIR=${pg.shareDir}`,
      pg.pgCtl,
      "-D",
      datadir,
      "-l",
      `${datadir}/pg.log`,
      "-o",
      `-k ${sockdir} -c listen_addresses= -c max_connections=300`,
      "-w",
      "start"
    ]);
    writeSpawnOutput2(start);
  }
  function resolvePg(rjitHome) {
    const bundled = `${rjitHome}/.pg-bundle/bin`;
    if (fsExists(`${bundled}/postgres`)) {
      return { pgCtl: `${bundled}/pg_ctl`, initdb: `${bundled}/initdb`, shareDir: `${rjitHome}/.pg-bundle/share/postgresql` };
    }
    for (const version of ["17", "16", "15", "14"]) {
      const base = `/usr/lib/postgresql/${version}/bin`;
      if (fsExists(`${base}/postgres`)) return { pgCtl: `${base}/pg_ctl`, initdb: `${base}/initdb`, shareDir: `/usr/share/postgresql/${version}` };
    }
    return null;
  }
  function terminalSize() {
    try {
      const parsed = JSON.parse(__termSize());
      return { cols: parsed[0] || 80, rows: parsed[1] || 24 };
    } catch {
      return { cols: 80, rows: 24 };
    }
  }
  function resolveZig(rjitHome) {
    const bundled = __env("REACTJIT_ZIG") || `${rjitHome}/tools/zig/zig`;
    if (fsExists(bundled)) return bundled;
    return "zig";
  }
  function spawnDevHost(bin, cartDir, scene3d, game, hotstateHandoff = null) {
    const env = [
      `RJIT_DEV_CART_DIR=${cartDir}`,
      `RJIT_DEV_SCENE3D_PATH=${scene3d.path}`,
      `RJIT_DEV_SCENE3D_HASH=${scene3d.artifactHash}`,
      `RJIT_DEV_GAME_PATH=${game.path}`,
      `RJIT_DEV_GAME_HASH=${game.artifactHash}`
    ];
    if (hotstateHandoff) env.push(`RJIT_DEV_HOTSTATE_HANDOFF=${hotstateHandoff}`);
    env.push(bin);
    return spawn("env", env);
  }
  function sessionTab(name, bundlePath) {
    return { name, bundlePath, bundleHash: sha256File(bundlePath) };
  }
  function superviseDevHost(state) {
    let nextNativeCheck = __nowMs() + 500;
    while (true) {
      const hostLine = __childReadLine(state.hostId, 40);
      if (hostLine === "") {
        __childKill(state.watcherId);
        return;
      }
      if (hostLine !== null) __writeStdout(`${hostLine}
`);
      const watcherLine = __childReadLine(state.watcherId, 20);
      if (watcherLine === "") {
        err("[dev] bundle watcher exited; stopping its exact host child");
        __childKill(state.hostId);
        return;
      }
      if (watcherLine !== null) __writeStdout(`${watcherLine}
`);
      if (__nowMs() >= nextNativeCheck) {
        nextNativeCheck = __nowMs() + 500;
        try {
          const next = fingerprintNativeTiers(state.rjitHome, state.profileSalt);
          applyNativeChanges(state, next);
        } catch (error) {
          err(`[dev-native] watcher scan failed: ${error.message}`);
        }
      }
      try {
        scanForOrphanHosts(state);
        applyApprovedOrphanCleanup(state);
      } catch (error) {
        err(`[dev-orphans] scan failed without touching any process: ${error.message}`);
      }
      try {
        applyApprovedNativeUpdate(state);
      } catch (error) {
        err(`[dev-native] approval handling failed without restarting the editor: ${error.message}`);
        if (state.pendingNative) sendNativeUpdateReadyNotice(state.pendingNative, state.approvalPath);
      }
      __sleepMs(20);
    }
  }
  function applyNativeChanges(state, next) {
    if (sameNativeFingerprints(next, state.fingerprints)) return;
    let nextScene = state.scene3d;
    if (next.scene3d.hash !== state.activeFingerprints.scene3d.hash) {
      const built = ensureModule(state.rjitHome, state.cartRoot, "scene3d", next.scene3d, state.devFlags, readModuleRecord(state.rjitHome, "scene3d"));
      if (!built) return abandonNativeCandidate(state, next, "3D engine compile failed; the running editor was not touched");
      nextScene = built;
    }
    let nextGame = state.game;
    if (next.game.hash !== state.activeFingerprints.game.hash) {
      const built = ensureModule(state.rjitHome, state.cartRoot, "game", next.game, state.devFlags, readModuleRecord(state.rjitHome, "game"));
      if (!built) return abandonNativeCandidate(state, next, "game engine compile failed; the running editor was not touched");
      nextGame = built;
    }
    let nextCore = null;
    if (next.core.hash !== state.activeFingerprints.core.hash) {
      const alreadyStaged = state.pendingNative?.fingerprints.core.hash === next.core.hash ? state.pendingNative.core : null;
      if (alreadyStaged && fsExists(alreadyStaged.path)) {
        nextCore = alreadyStaged;
      } else {
        const candidatePrefix = `${state.rjitHome}/.cache/dev-core-candidate`;
        const candidatePath = `${candidatePrefix}/bin/${state.binName}`;
        const built = buildDevHost(state.rjitHome, state.cartRoot, state.binName, state.substrate, next.core, state.devFlags, candidatePrefix);
        if (built !== 0 || !fsExists(candidatePath)) {
          return abandonNativeCandidate(state, next, "cold core compile failed; the running editor was not touched");
        }
        nextCore = { path: candidatePath, artifactHash: sha256File(candidatePath) };
      }
    } else if (next.core.hash !== state.fingerprints.core.hash) {
      const activeRecord = readCoreRecord(state.rjitHome);
      if (!activeRecord || activeRecord.sourceHash !== next.core.hash || !fsExists(state.bin)) {
        const rebuilt = buildDevHost(state.rjitHome, state.cartRoot, state.binName, state.substrate, next.core, state.devFlags);
        if (rebuilt !== 0) return abandonNativeCandidate(state, next, "active core restore failed; the running editor was not touched");
        writeDevBuildInfo(state.bin, next.core);
        writeCoreRecord(state.rjitHome, next.core.hash, state.bin);
      }
    }
    state.fingerprints = next;
    const changedTiers = changedNativeTiers(state.activeFingerprints, next);
    if (changedTiers.length === 0) {
      const hadPending = state.pendingNative !== null;
      state.pendingNative = null;
      writeModuleRecord(state.rjitHome, state.scene3d);
      writeModuleRecord(state.rjitHome, state.game);
      if (hadPending) sendNativeUpdateResultNotice(false, "The pending native update was canceled because the sources now match the running editor.");
      return;
    }
    const pending = {
      token: "",
      fingerprints: next,
      scene3d: nextScene,
      game: nextGame,
      core: nextCore,
      changedTiers
    };
    pending.token = nativeUpdateToken(next, nextScene, nextGame, nextCore);
    state.pendingNative = pending;
    out(`[dev-native] ${changedTiers.join(" + ")} compiled and waiting for editor approval; running host child=${state.hostId} was not touched`);
    if (!sendNativeUpdateReadyNotice(pending, state.approvalPath)) {
      err("[dev-native] update is pending, but the editor notification could not be delivered");
    }
  }
  function abandonNativeCandidate(state, observed, message) {
    state.fingerprints = observed;
    state.pendingNative = null;
    writeModuleRecord(state.rjitHome, state.scene3d);
    writeModuleRecord(state.rjitHome, state.game);
    err(`[dev-native] ${message}`);
    sendNativeUpdateResultNotice(false, message);
  }
  var ORPHAN_FIRST_SCAN_MS = 6e4;
  var ORPHAN_RESCAN_MS = 3e5;
  function scanForOrphanHosts(state) {
    if (__nowMs() < state.nextOrphanScanMs) return;
    state.nextOrphanScanMs = __nowMs() + ORPHAN_RESCAN_MS;
    const scan2 = scanDevHosts(state.rjitHome, DEV_SOCKET_PATH);
    if (scan2.orphans.length === 0) return;
    const pids = scan2.orphans.map((row) => row.pid);
    sendOrphanHostsNotice(scan2.orphans, scan2.reclaimableKb, orphanCleanupToken(pids), state.orphanApprovalPath);
  }
  function applyApprovedOrphanCleanup(state) {
    const approval = parseOrphanCleanupApproval(tryFsRead(state.orphanApprovalPath));
    if (!approval) return;
    fsRemove(state.orphanApprovalPath);
    if (approval.token !== orphanCleanupToken(approval.pids)) {
      err("[dev-orphans] ignored a cleanup approval whose token did not match its pids");
      return;
    }
    const outcomes = killOrphanHosts(state.rjitHome, DEV_SOCKET_PATH, approval.pids);
    const retired = outcomes.filter((row) => row.ok);
    for (const spared of outcomes.filter((row) => !row.ok)) {
      err(`[dev-orphans] spared pid ${spared.pid}: ${spared.reason}`);
    }
    err(`[dev-orphans] retired ${retired.length}/${outcomes.length} orphaned host(s)`);
    sendOrphanCleanupResultNotice(retired.length, outcomes.length);
    state.nextOrphanScanMs = __nowMs() + ORPHAN_RESCAN_MS;
  }
  function applyApprovedNativeUpdate(state) {
    const approval = parseNativeUpdateApproval(tryFsRead(state.approvalPath));
    if (!approval) return;
    fsRemove(state.approvalPath);
    const pending = state.pendingNative;
    if (!pending || approval.token !== pending.token) {
      err("[dev-native] ignored stale native update approval");
      if (pending) sendNativeUpdateReadyNotice(pending, state.approvalPath);
      return;
    }
    const current = fingerprintNativeTiers(state.rjitHome, state.profileSalt);
    if (!sameNativeFingerprints(current, pending.fingerprints)) {
      err("[dev-native] approval arrived after a newer native source edit; staging the newer candidate first");
      applyNativeChanges(state, current);
      return;
    }
    activateNativeCandidate(state, pending);
    state.pendingNative = null;
  }
  function activateNativeCandidate(state, pending) {
    if (pending.changedTiers.includes("core")) {
      if (!pending.core || !installPendingCore(pending.core.path, state.bin)) {
        const message = "compiled core could not be installed; the running editor was not touched";
        err(`[dev-native] ${message}`);
        sendNativeUpdateResultNotice(false, message);
        return;
      }
      state.scene3d = pending.scene3d;
      state.game = pending.game;
      state.activeFingerprints = pending.fingerprints;
      writeDevBuildInfo(state.bin, pending.fingerprints.core);
      writeCoreRecord(state.rjitHome, pending.fingerprints.core.hash, state.bin);
      writeModuleRecord(state.rjitHome, state.scene3d);
      writeModuleRecord(state.rjitHome, state.game);
      updateSessionModules(state.rjitHome, state.scene3d, state.game);
      restartExactHost(state, "user approved native core update");
      return;
    }
    let restartReason = null;
    const rejected = [];
    for (const tier of ["scene3d", "game"]) {
      if (!pending.changedTiers.includes(tier)) continue;
      const candidate = tier === "scene3d" ? pending.scene3d : pending.game;
      const active = tier === "scene3d" ? state.scene3d : state.game;
      if (candidate.artifactHash === active.artifactHash) {
        out(`[dev-native] ${tier} source changed but emitted identical library`);
        commitActiveModule(state, pending, tier, candidate);
        continue;
      }
      const outcome = requestNativeReload(tier, candidate.artifactHash, candidate.path);
      out(`[dev-native] ${tier} user-approved activation ${outcome}`);
      if (outcome === "committed") {
        commitActiveModule(state, pending, tier, candidate);
      } else if (outcome === "restart_required" || outcome === "timeout" || outcome === "unreachable") {
        commitActiveModule(state, pending, tier, candidate);
        restartReason = restartReason ?? `${tier} activation ${outcome}`;
      } else {
        rejected.push(tier);
        writeModuleRecord(state.rjitHome, active);
      }
    }
    updateSessionModules(state.rjitHome, state.scene3d, state.game);
    if (restartReason) {
      restartExactHost(state, `user approved ${restartReason}`);
      return;
    }
    if (rejected.length > 0) {
      sendNativeUpdateResultNotice(false, `${rejected.join(" + ")} rejected the compiled candidate; the previous native module remains active.`);
    } else {
      sendNativeUpdateResultNotice(true, "The approved native update is active.");
    }
  }
  function commitActiveModule(state, pending, tier, candidate) {
    if (tier === "scene3d") {
      state.scene3d = candidate;
      state.activeFingerprints.scene3d = pending.fingerprints.scene3d;
    } else {
      state.game = candidate;
      state.activeFingerprints.game = pending.fingerprints.game;
    }
    writeModuleRecord(state.rjitHome, candidate);
  }
  function installPendingCore(candidatePath, activePath) {
    const temporaryPath = `${activePath}.installing`;
    const copied = spawnSync("cp", ["--", candidatePath, temporaryPath]);
    if (copied.code !== 0) return false;
    const installed = spawnSync("mv", ["--", temporaryPath, activePath]);
    if (installed.code !== 0) {
      if (fsExists(temporaryPath)) fsRemove(temporaryPath);
      return false;
    }
    return true;
  }
  function restartExactHost(state, reason) {
    const runningInfo = readDevHostInfo(DEV_SOCKET_PATH);
    const manifest2 = readSessionManifest(state.rjitHome);
    if (manifest2 && runningInfo?.active_tab && runningInfo.active_tab !== "main" && manifest2.tabs.some((tab) => tab.name === runningInfo.active_tab)) {
      manifest2.activeTab = runningInfo.active_tab;
      manifest2.scene3d = state.scene3d;
      manifest2.game = state.game;
      writeSessionManifest(state.rjitHome, manifest2);
    }
    const currentSession = readSessionManifest(state.rjitHome);
    const active = currentSession?.tabs.find((tab) => tab.name === currentSession.activeTab);
    if (active && fsExists(active.bundlePath)) fsWrite(`${state.rjitHome}/bundle.js`, fsRead(active.bundlePath));
    const checkpointId = Math.max(1, Math.floor(__nowMs()));
    const handoffPath = `${state.rjitHome}/.cache/dev-hotstate-handoff-${checkpointId}.json`;
    const checkpointed = requestDevCheckpoint(checkpointId);
    const handoffReady = checkpointed && saveDevHotState(handoffPath);
    if (!handoffReady) {
      err(`[dev-native] WARNING: could not capture exact-child state handoff (${checkpointed ? "save failed" : "checkpoint failed"})`);
    }
    out(`[dev-native] restarting exact host child=${state.hostId}: ${reason}`);
    __childKill(state.hostId);
    state.hostId = spawnDevHost(state.bin, state.cartDir, state.scene3d, state.game, handoffReady ? handoffPath : null).id;
    if (!waitForHost(DEV_SOCKET_PATH, 15e3)) {
      err(`[dev-native] replacement host child=${state.hostId} did not open ${DEV_SOCKET_PATH}`);
      return;
    }
    replaySession(state.rjitHome, currentSession);
    out(`[dev-native] replacement host child=${state.hostId} ready`);
  }
  function waitForHost(socket, timeoutMs) {
    const deadline = __nowMs() + timeoutMs;
    while (__nowMs() < deadline) {
      if (readDevHostInfo(socket)) return true;
      __sleepMs(25);
    }
    return false;
  }
  function replaySession(rjitHome, manifest2) {
    if (!manifest2) return;
    const available = manifest2.tabs.filter((tab) => fsExists(tab.bundlePath));
    const ordered = [
      ...available.filter((tab) => tab.name !== manifest2.activeTab),
      ...available.filter((tab) => tab.name === manifest2.activeTab)
    ];
    for (const tab of ordered) {
      const pushed = spawnSync(`${rjitHome}/tools/rjit`, ["push-bundle", tab.name, tab.bundlePath]);
      if (pushed.code !== 0) err(`[dev-native] failed to replay tab '${tab.name}'`);
    }
  }
  function drainUntilExit(hostId, watcherId) {
    while (true) {
      const hostLine = __childReadLine(hostId, 50);
      if (hostLine === "") {
        __childKill(watcherId);
        return;
      }
      if (hostLine !== null) __writeStdout(`${hostLine}
`);
      const watcherLine = __childReadLine(watcherId, 50);
      if (watcherLine === "") {
        __childKill(hostId);
        return;
      }
      if (watcherLine !== null) __writeStdout(`${watcherLine}
`);
      __sleepMs(50);
    }
  }
  function writeSpawnOutput2(result) {
    if (result.stdout) __writeStdout(result.stdout);
    if (result.stderr) __writeStderr(result.stderr);
  }
  function dirname2(path) {
    const idx = path.lastIndexOf("/");
    return idx <= 0 ? "/" : path.slice(0, idx);
  }
  function fail4(message, code) {
    err(message);
    return code;
  }

  // cli/commands/firecracker-build.ts
  var firecracker_build_exports = {};
  __export(firecracker_build_exports, {
    run: () => run12
  });
  async function run12(argv) {
    const root = __cwd();
    const parsed = parseArgs2(argv, root);
    if (typeof parsed === "number") return parsed;
    log2(`bundling recipe: ${parsed}`);
    const bundled = spawnSync(`${root}/tools/esbuild`, [
      "--bundle",
      "--format=cjs",
      "--platform=neutral",
      "--target=es2022",
      "--log-level=warning",
      parsed
    ]);
    if (bundled.stderr) __writeStderr(bundled.stderr);
    if (bundled.code !== 0) return fail5(`esbuild failed: ${bundled.code}`, bundled.code || 1);
    const spec = evalRecipe(bundled.stdout);
    if (!spec) return fail5("recipe must default-export an object");
    const valid = validateSpec(spec);
    if (valid) return fail5(valid);
    log2(`recipe: id=${spec.id} base=${spec.base} apt=${spec.apt.length} steps=${(spec.steps || []).length}`);
    const outPath = abs(root, spec.output.path);
    const outDir = dirname3(outPath);
    fsMkdir(outDir);
    if (fsExists(outPath)) spawnSync("/bin/rm", ["-f", outPath]);
    const hooks = buildCustomizeHooks(root, spec);
    if (typeof hooks === "number") return hooks;
    const mmdbArgs = [
      "--variant=minbase",
      "--components=main,universe",
      `--include=${spec.apt.join(",")}`,
      ...hooks.map((hook) => `--customize-hook=${hook}`),
      spec.base,
      outPath
    ];
    log2(`mmdebstrap -> ${outPath}`);
    const t0 = __nowMs();
    const mmdb = runTee("/usr/bin/mmdebstrap", mmdbArgs);
    if (mmdb !== 0) return mmdb;
    log2(`mmdebstrap done in ${((__nowMs() - t0) / 1e3).toFixed(1)}s`);
    if (spec.output.kind === "ext4" && spec.output.sizeMb) {
      const cur = fileSize(outPath);
      const targetBytes = spec.output.sizeMb * 1024 * 1024;
      if (targetBytes > cur) {
        log2(`growing ext4: ${cur >> 20}MB -> ${spec.output.sizeMb}MB`);
        const trunc = runTee("/usr/bin/truncate", ["-s", `${spec.output.sizeMb}M`, outPath]);
        if (trunc !== 0) return trunc;
        const resize = runTee("/usr/sbin/resize2fs", [outPath]);
        if (resize !== 0) return resize;
      }
    }
    const sizeBytes = fileSize(outPath);
    const manifest2 = {
      id: spec.id,
      builtAt: (/* @__PURE__ */ new Date()).toISOString(),
      recipePath: parsed.startsWith(`${root}/`) ? parsed.slice(root.length + 1) : parsed,
      base: spec.base,
      arch: spec.arch,
      apt: spec.apt,
      npmGlobal: spec.npmGlobal || [],
      output: { kind: spec.output.kind, path: spec.output.path, sizeBytes },
      buildElapsedMs: __nowMs() - t0
    };
    const manifestPath = outPath.replace(/\.[^.]+$/, "") + ".manifest.json";
    fsWrite(manifestPath, JSON.stringify(manifest2, null, 2));
    log2(`manifest -> ${manifestPath}`);
    log2(`done. output: ${outPath} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
    return 0;
  }
  function parseArgs2(argv, root) {
    let recipePath = "";
    for (const arg of argv) {
      if (arg.startsWith("--")) return fail5(`unknown flag: ${arg}`);
      if (!recipePath) recipePath = arg;
      else return fail5(`extra positional arg: ${arg}`);
    }
    if (!recipePath) return fail5("usage: firecracker-build.js <recipe.ts>");
    const resolved = abs(root, recipePath);
    if (!fsExists(resolved)) return fail5(`recipe not found: ${resolved}`);
    return resolved;
  }
  function evalRecipe(code) {
    const moduleObj = { exports: {} };
    try {
      new Function("module", "exports", code)(moduleObj, moduleObj.exports);
    } catch (error) {
      throw new Error(`failed to eval recipe: ${error.message || String(error)}`);
    }
    const spec = moduleObj.exports.default || moduleObj.exports;
    return spec && typeof spec === "object" ? spec : null;
  }
  function validateSpec(spec) {
    for (const field of ["id", "base", "arch", "apt", "output"]) {
      if (!spec[field]) return `recipe missing required field: ${field}`;
    }
    if (!Array.isArray(spec.apt)) return "recipe.apt must be string[]";
    if (!spec.output.kind || !spec.output.path) return "recipe.output must have {kind, path}";
    if (spec.output.kind === "ext4" && !spec.output.sizeMb) return "ext4 output requires sizeMb";
    if (spec.arch !== "amd64") return `only amd64 is supported in v0 (got ${spec.arch})`;
    return "";
  }
  function buildCustomizeHooks(root, spec) {
    const hooks = [];
    for (const pkg of spec.npmGlobal || []) {
      hooks.push(`chroot "$1" /bin/sh -c ${shellEscape(`npm install -g ${pkg}`)}`);
    }
    for (const step of spec.steps || []) {
      if ("run" in step) {
        hooks.push(`chroot "$1" /bin/sh -c ${shellEscape(step.run)}`);
      } else if ("writeFile" in step) {
        const wf = step.writeFile;
        const cmd = `mkdir -p "$(dirname "$1${wf.path}")" && echo ${shellEscape(b64encode(wf.content))} | base64 -d > "$1${wf.path}"` + (wf.mode ? ` && chmod ${wf.mode.toString(8)} "$1${wf.path}"` : "");
        hooks.push(cmd);
      } else if ("copyFromHost" in step) {
        const cf = step.copyFromHost;
        const src = abs(root, cf.src);
        if (!fsExists(src)) return fail5(`copyFromHost src not found: ${src}`);
        const kind = spawnSync("/usr/bin/stat", ["-c", "%F", src]).stdout.trim();
        if (kind === "directory") {
          hooks.push(`chroot "$1" /bin/sh -c ${shellEscape(`mkdir -p ${cf.dest}`)}`);
          hooks.push(`sync-in ${src} ${cf.dest}`);
        } else {
          const parent = cf.dest.substring(0, cf.dest.lastIndexOf("/")) || "/";
          hooks.push(`chroot "$1" /bin/sh -c ${shellEscape(`mkdir -p ${parent}`)}`);
          hooks.push(`upload ${src} ${cf.dest}`);
        }
      } else {
        return fail5(`unknown step shape: ${JSON.stringify(step)}`);
      }
    }
    return hooks;
  }
  function runTee(bin, args) {
    const result = spawnSync(bin, args);
    if (result.stdout) __writeStdout(result.stdout);
    if (result.stderr) __writeStderr(result.stderr);
    if (result.code !== 0) return fail5(`${bin} exited ${result.code}`, result.code || 1);
    return 0;
  }
  function fileSize(path) {
    const result = spawnSync("/usr/bin/stat", ["-c", "%s", path]);
    return parseInt(result.stdout.trim(), 10) || 0;
  }
  function abs(root, path) {
    if (path.startsWith("/")) return path;
    const trimmed = path.startsWith("./") ? path.slice(2) : path;
    return `${root}/${trimmed}`;
  }
  function dirname3(path) {
    const idx = path.lastIndexOf("/");
    return idx <= 0 ? "/" : path.slice(0, idx);
  }
  function shellEscape(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  }
  function b64encode(value) {
    const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out2 = "";
    for (let i = 0; i < value.length; i += 3) {
      const b0 = value.charCodeAt(i) & 255;
      const b1 = i + 1 < value.length ? value.charCodeAt(i + 1) & 255 : 0;
      const b2 = i + 2 < value.length ? value.charCodeAt(i + 2) & 255 : 0;
      const n = b0 << 16 | b1 << 8 | b2;
      out2 += table[n >> 18 & 63];
      out2 += table[n >> 12 & 63];
      out2 += i + 1 < value.length ? table[n >> 6 & 63] : "=";
      out2 += i + 2 < value.length ? table[n & 63] : "=";
    }
    return out2;
  }
  function log2(message) {
    out(`[fc-build] ${message}`);
  }
  function fail5(message, code = 1) {
    err(`[fc-build] ${message}`);
    return code;
  }

  // cli/commands/game.ts
  var game_exports = {};
  __export(game_exports, {
    run: () => run13
  });
  var GAME_DIR = "cart/hmsc-int/game";
  var SUITE_ROOTS = [GAME_DIR, "cart/hmsc-int/data", "cart/hmsc-int/editors", "cart/hmsc-int/compile", "docs/game/_index"];
  var VERIFY_HARNESS_ENTRY = "cart/hmsc-int/compile/verifyHarness.ts";
  var VERIFY_DIR = "cart/hmsc-int/compile/verify";
  var OUT_DIR = "zig-out/game";
  var VERIFY_HARNESS_BUNDLE = `${OUT_DIR}/hmsc-verify-harness.js`;
  var TEST_OUT_DIR = `${OUT_DIR}/tests`;
  var ORACLE_INDEX_DIR = "docs/game/_index";
  var ORACLE_RECORDS_DIR = `${ORACLE_INDEX_DIR}/records`;
  var ORACLE_SELF_CHECK_ENTRY = `${OUT_DIR}/oracle-self-check.ts`;
  var ORACLE_SELF_CHECK_BUNDLE = `${OUT_DIR}/oracle-self-check.js`;
  function resolveZig2(root) {
    const bundled = __env("REACTJIT_ZIG") || `${root}/tools/zig/zig`;
    if (fsExists(bundled)) return bundled;
    return "zig";
  }
  var ROUND_TRIPS = [
    {
      label: "mapfile",
      genEntry: "framework/testing/fixtures/gen_roundtrip.ts",
      genBundle: `${OUT_DIR}/mapfile-roundtrip-gen.js`,
      fixture: "framework/testing/fixtures/mapfile_roundtrip.b64",
      zigStep: "test-world-mapfile"
    },
    {
      label: "game-file",
      genEntry: "framework/testing/fixtures/gen_gamefile.ts",
      genBundle: `${OUT_DIR}/mapfile-gamefile-gen.js`,
      fixture: "framework/testing/fixtures/gamefile_roundtrip.b64",
      zigStep: "test-world-gamefile"
    }
  ];
  var LOADER_NAME = "world_loader";
  var LOADER_SOURCE = "framework/world_loader.zig";
  var LOADER_BIN = `zig-out/bin/${LOADER_NAME}`;
  var LOADER_SHOT = `${OUT_DIR}/${LOADER_NAME}-verify.png`;
  var LOADER_BUILD_ARGS = [
    "build",
    "app",
    `-Dapp-name=${LOADER_NAME}`,
    `-Dapp-source=${LOADER_SOURCE}`,
    "-Duse-v8=false",
    "-Dhas-gpu=true",
    "-Doptimize=ReleaseFast"
  ];
  var BAKE_ENTRY = "cart/hmsc-int/compile/bakeGameFile.ts";
  var BAKE_BUNDLE = `${OUT_DIR}/hmsc-gamefile-bake.js`;
  var BAKED_GAMEFILE = `${OUT_DIR}/hmsc.gamefile`;
  var CONTENT_STORE_DIR = `${OUT_DIR}/contentstore`;
  var FIXTURE_GAMEFILE = "framework/testing/fixtures/gamefile_roundtrip.b64";
  var MASSIVE_BAKE_ENTRY = "cart/hmsc-int/compile/bakeMassiveGameFile.ts";
  var MASSIVE_BAKE_BUNDLE = `${OUT_DIR}/hmsc-massive-bake.js`;
  var MASSIVE_GAMEFILE = `${OUT_DIR}/hmsc-massive.gamefile`;
  var PARITY_ENTRY = "cart/hmsc-int/compile/parityGameFile.ts";
  var PARITY_TS_BUNDLE = `${OUT_DIR}/hmsc-parity-ts.js`;
  var PARITY_SOURCE = `${OUT_DIR}/hmsc-parity-source.txt`;
  var PARITY_TS_GAMEFILE = `${OUT_DIR}/hmsc-parity-ts.gamefile`;
  var PARITY_ZIG_GAMEFILE = `${OUT_DIR}/hmsc-parity-zig.gamefile`;
  var PARITY_ZIG_BIN = "zig-out/bin/hmsc_parity_compile";
  var ORACLE_SMOKE_QUERIES = [
    "physics",
    "kinds",
    "chance",
    "pathing",
    "commands",
    "perception",
    "figure",
    "items",
    "animation",
    "vehicle",
    "chrome",
    "camera",
    "cutscene",
    "telemetry"
  ];
  async function run13(argv) {
    const subcommand = argv[0];
    if (subcommand === "compile") return retiredCompileCommand();
    if (subcommand === "bake") return bake(__cwd(), argv.slice(1));
    if (subcommand === "verify") return verify(__cwd());
    if (subcommand === "parity") return parity(__cwd(), argv.slice(1));
    if (subcommand === "shot") return shot(__cwd(), argv.slice(1));
    if (subcommand === "play") return play(__cwd(), argv.slice(1));
    if (subcommand === "compact-store") return compactStore(__cwd());
    err("Usage: rjit game <bake|verify|parity|shot|play|compact-store>");
    err("  bake     write the authored world to zig-out/game/hmsc.gamefile + contentstore");
    err("  verify   bake, prove the no-V8 loader, run suites + verify scripts, exit with a verdict");
    err("  parity   compile one generated world with TS and Zig, byte-compare outputs, report timings");
    err("  shot     build the no-V8 loader, render the baked game-file, capture a PNG (--out path)");
    err("  play     build the no-V8 loader and open a live window (close it or press ESC to exit)");
    err("  compact-store  reclaim the model store: rebuild the snapshot + strip superseded stroke/mesh history (close the editor first)");
    err("  play/shot flags: --fixture (codec fixture) | --massive [--blocks N] (procedural scale lab)");
    return 2;
  }
  var MODEL_DOMAIN = "cart/hmsc-int/data/domains/model";
  function compactStore(root) {
    const db = `${root}/${MODEL_DOMAIN}/store.db`;
    const snap = `${root}/${MODEL_DOMAIN}/snapshots/model.snapshot.json`;
    if (!fsExists(db)) {
      err(`[compact] no model store at ${db}`);
      return 1;
    }
    const lsof = spawnSync("lsof", [db]);
    if ((lsof.stdout || "").includes("reactjit")) {
      err("[compact] the editor is running and holds the model store \u2014 close it first (VACUUM needs exclusive access)");
      return 1;
    }
    const bakDir = `${root}/${MODEL_DOMAIN}/_compact_backup`;
    fsMkdir(bakDir);
    spawnSync("cp", [db, `${bakDir}/store.db`]);
    if (fsExists(snap)) spawnSync("cp", [snap, `${bakDir}/model.snapshot.json`]);
    out("[compact] backed up store.db + snapshot");
    fsMkdir(`${root}/${OUT_DIR}`);
    const bundleOut = `${OUT_DIR}/compact-store.js`;
    if (!bundle(root, "cart/hmsc-int/editors/model/compactModelStore.run.ts", bundleOut)) {
      err("[compact] bundle failed");
      return 1;
    }
    const res = spawnSync(`${root}/tools/v8cli`, [`${root}/${bundleOut}`]);
    if (res.stdout.trim()) out(res.stdout.trim());
    if (res.stderr.trim()) err(res.stderr.trim());
    if (!(res.stdout || "").includes("COMPACT OK")) {
      err("[compact] FAILED \u2014 restoring store + snapshot from backup");
      spawnSync("cp", [`${bakDir}/store.db`, db]);
      if (fsExists(`${bakDir}/model.snapshot.json`)) spawnSync("cp", [`${bakDir}/model.snapshot.json`, snap]);
      return 1;
    }
    out(`[compact] done \u2014 model store reclaimed; backup kept at ${bakDir} (delete once you've reopened the editor and confirmed)`);
    return 0;
  }
  function bundle(root, entry, outFile) {
    const result = spawnSync(`${root}/tools/esbuild`, [
      `${root}/${entry}`,
      "--bundle",
      `--outfile=${root}/${outFile}`,
      "--format=iife",
      "--platform=neutral",
      "--target=es2022",
      `--alias:@reactjit=${root}/runtime`,
      `--alias:@game=${root}/${GAME_DIR}`,
      "--log-level=warning"
    ]);
    if (result.stderr.trim()) err(result.stderr.trim());
    return result.code === 0;
  }
  function retiredCompileCommand() {
    err("[game] `rjit game compile` is retired. The in-app Compile button maps to `rjit game bake`; use `rjit game verify` for the command-script harness.");
    return 2;
  }
  function bundleVerifyHarness(root) {
    fsMkdir(`${root}/${OUT_DIR}`);
    if (!bundle(root, VERIFY_HARNESS_ENTRY, VERIFY_HARNESS_BUNDLE)) {
      err(`[game] verify harness FAILED: ${VERIFY_HARNESS_ENTRY}`);
      return 1;
    }
    out(`[game] bundled verify harness ${VERIFY_HARNESS_ENTRY} -> ${VERIFY_HARNESS_BUNDLE}`);
    return 0;
  }
  function bake(root, args = []) {
    fsMkdir(`${root}/${OUT_DIR}`);
    const noPieces = args.includes("--no-pieces");
    const gfIdx = args.indexOf("--gamefile");
    const gamefile = gfIdx >= 0 && args[gfIdx + 1] ? args[gfIdx + 1] : BAKED_GAMEFILE;
    const esIdx = args.indexOf("--editor-stem");
    const editorStem = esIdx >= 0 && args[esIdx + 1] ? args[esIdx + 1] : void 0;
    const slash = gamefile.lastIndexOf("/");
    if (slash > 0) fsMkdir(`${root}/${gamefile.slice(0, slash)}`);
    if (!bakeRealGameFile(root, { noPieces, gamefile, editorStem })) return 1;
    out(`[game] bake PASS \u2014 ${gamefile}${noPieces ? " (piece-free)" : ""}${editorStem ? ` (editor map '${editorStem}')` : ""}`);
    return 0;
  }
  function posixJoin(...parts) {
    return parts.join("/").replace(/\/+/g, "/");
  }
  function jsString(value) {
    return JSON.stringify(value);
  }
  function oracleSelfCheckSource(root, recordFiles) {
    const recordImports = recordFiles.map((file, i) => {
      const abs2 = posixJoin(root, ORACLE_RECORDS_DIR, file);
      return `import * as record${i} from ${jsString(abs2)};`;
    }).join("\n");
    const recordSpecs = recordFiles.map((file, i) => `{ file: ${jsString(`${ORACLE_RECORDS_DIR}/${file}`)}, module: record${i} }`).join(",\n  ");
    return `// Generated by rjit game verify. Do not edit.
import { DECISIONS } from ${jsString(posixJoin(root, ORACLE_INDEX_DIR, "decisions.ts"))};
import { ALL_DOCS, ALL_INTERFACES, ALL_PATTERNS, ALL_HAZARDS } from ${jsString(posixJoin(root, ORACLE_INDEX_DIR, "index.ts"))};
${recordImports}

declare const globalThis: any;

const recordSpecs = [
  ${recordSpecs},
];
const decisionStatuses = new Set(['ruled', 'revised', 'open', 'show-me']);
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requireObject(value: unknown, path: string): Record<string, unknown> | null {
  if (!isObject(value)) {
    fail(\`\${path}: expected object\`);
    return null;
  }
  return value;
}
function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(\`\${path}: expected non-empty string\`);
  return typeof value === 'string' ? value : '';
}
function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(\`\${path}: expected string[]\`);
    return [];
  }
  return value as string[];
}
function requireNonEmptyStringArray(value: unknown, path: string): string[] {
  const items = requireStringArray(value, path);
  if (items.length === 0) fail(\`\${path}: expected non-empty string[]\`);
  return items;
}
function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(\`\${path}: expected array\`);
    return [];
  }
  return value;
}
function requireOneOf(value: unknown, allowed: Set<string>, path: string): string {
  const text = requireString(value, path);
  if (text && !allowed.has(text)) fail(\`\${path}: unexpected value \${JSON.stringify(text)}\`);
  return text;
}

function validateInterface(record: unknown, path: string): void {
  const r = requireObject(record, path);
  if (!r) return;
  requireString(r.name, \`\${path}.name\`);
  requireNonEmptyStringArray(r.purpose, \`\${path}.purpose\`); // oracle searchInterfaces calls purpose.join()
  requireString(r.kind, \`\${path}.kind\`);
  requireString(r.description, \`\${path}.description\`);
  requireString(r.status, \`\${path}.status\`); // oracle interfaceLine prints status
}

function validatePattern(record: unknown, path: string): void {
  const r = requireObject(record, path);
  if (!r) return;
  requireString(r.name, \`\${path}.name\`);
  requireNonEmptyStringArray(r.purpose, \`\${path}.purpose\`); // oracle searchPatterns calls purpose.join()
  requireString(r.description, \`\${path}.description\`);
  requireStringArray(r.examples, \`\${path}.examples\`); // oracle patternLine calls examples.slice().join()
  requireString(r.status, \`\${path}.status\`); // oracle patternLine prints status
}

function validateHazard(record: unknown, path: string): void {
  const r = requireObject(record, path);
  if (!r) return;
  requireString(r.name, \`\${path}.name\`);
  requireNonEmptyStringArray(r.purpose, \`\${path}.purpose\`); // oracle searchHazards calls purpose.join()
  requireString(r.description, \`\${path}.description\`);
  requireStringArray(r.evidence, \`\${path}.evidence\`); // oracle searchHazards calls evidence.join()
  requireString(r.severity, \`\${path}.severity\`); // oracle hazardLine calls severity.toUpperCase()
}

function validateDoc(doc: unknown, file: string): string {
  const d = requireObject(doc, file);
  if (!d) return '';
  const name = requireString(d.name, \`\${file}.name\`);
  requireString(d.file, \`\${file}.file\`);
  requireNonEmptyStringArray(d.purpose, \`\${file}.purpose\`);
  requireString(d.summary, \`\${file}.summary\`);
  requireArray(d.interfaces, \`\${file}.interfaces\`).forEach((item, i) => validateInterface(item, \`\${file}.interfaces[\${i}]\`));
  requireArray(d.patterns, \`\${file}.patterns\`).forEach((item, i) => validatePattern(item, \`\${file}.patterns[\${i}]\`));
  requireArray(d.hazards, \`\${file}.hazards\`).forEach((item, i) => validateHazard(item, \`\${file}.hazards[\${i}]\`));
  return name;
}

const recordNames = new Map<string, string>();
for (const spec of recordSpecs) {
  const docs = Object.entries(spec.module)
    .filter(([, value]) => isObject(value) && 'summary' in value && 'interfaces' in value)
    .map(([, value]) => value);
  if (docs.length !== 1) {
    fail(\`\${spec.file}: expected exactly one DocIndex export, found \${docs.length}\`);
    continue;
  }
  const name = validateDoc(docs[0], spec.file);
  if (name) recordNames.set(name, spec.file);
}

if (!Array.isArray(ALL_DOCS)) fail('docs/game/_index/index.ts: ALL_DOCS must be an array');
for (const doc of ALL_DOCS as unknown[]) {
  const d = doc as any;
  const name = typeof d?.name === 'string' ? d.name : '<unnamed>';
  if (!recordNames.has(name)) fail(\`docs/game/_index/index.ts: ALL_DOCS includes \${name}, but no matching record file was validated\`);
}
for (const [name, file] of recordNames) {
  if (!(ALL_DOCS as any[]).some((doc) => doc?.name === name)) fail(\`docs/game/_index/index.ts: missing \${name} from ALL_DOCS (record file: \${file})\`);
}
if (!Array.isArray(ALL_INTERFACES) || !Array.isArray(ALL_PATTERNS) || !Array.isArray(ALL_HAZARDS)) {
  fail('docs/game/_index/index.ts: flattened oracle views must be arrays');
}

const ids = new Set<string>();
for (let i = 0; i < DECISIONS.length; i += 1) {
  const path = \`docs/game/_index/decisions.ts.DECISIONS[\${i}]\`;
  const d = requireObject(DECISIONS[i], path);
  if (!d) continue;
  const id = requireString(d.id, \`\${path}.id\`);
  if (id && !/^[VPR][0-9]+$/.test(id)) fail(\`\${path}.id: expected V*/P*/R* id, got \${JSON.stringify(id)}\`);
  if (id && ids.has(id)) fail(\`\${path}.id: duplicate id \${id}\`);
  if (id) ids.add(id);
  requireString(d.name, \`\${path}.name\`);
  requireOneOf(d.status, decisionStatuses, \`\${path}.status\`);
  requireString(d.ruling, \`\${path}.ruling\`);
  requireNonEmptyStringArray(d.keywords, \`\${path}.keywords\`);
  if ('retires' in d && d.retires !== undefined) requireStringArray(d.retires, \`\${path}.retires\`);
  if ('cites' in d && d.cites !== undefined) requireStringArray(d.cites, \`\${path}.cites\`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(\`[oracle-self-check] \${failure}\`);
  console.error(\`ORACLE SELF-CHECK RED \u2014 \${failures.length} failure(s)\`);
  globalThis.__exit?.(1);
} else {
  console.log(\`ORACLE SELF-CHECK GREEN \u2014 \${recordSpecs.length} records, \${DECISIONS.length} decisions\`);
}
`;
  }
  function runOracleSelfCheck(root) {
    if (!fsExists(`${root}/${ORACLE_RECORDS_DIR}`)) {
      err(`[game] oracle self-check FAILED: missing ${ORACLE_RECORDS_DIR}`);
      return false;
    }
    fsMkdir(`${root}/${OUT_DIR}`);
    const recordFiles = fsList(`${root}/${ORACLE_RECORDS_DIR}`).filter((name) => name.endsWith(".ts")).sort();
    fsWrite(`${root}/${ORACLE_SELF_CHECK_ENTRY}`, oracleSelfCheckSource(root, recordFiles));
    if (!bundle(root, ORACLE_SELF_CHECK_ENTRY, ORACLE_SELF_CHECK_BUNDLE)) {
      err("[game] oracle self-check does not bundle");
      return false;
    }
    const result = spawnSync(`${root}/tools/v8cli`, [`${root}/${ORACLE_SELF_CHECK_BUNDLE}`]);
    if (result.stdout.trim()) out(result.stdout.trim());
    if (result.stderr.trim()) err(result.stderr.trim());
    if (result.code !== 0) {
      err("[game] oracle self-check FAILED: record/decision shape");
      return false;
    }
    for (const query of ORACLE_SMOKE_QUERIES) {
      const smoke = spawnSync(`${root}/tools/oracle`, [query]);
      if (smoke.stderr.trim()) err(smoke.stderr.trim());
      const stdout = smoke.stdout.trim();
      if (smoke.code !== 0) {
        err(`[game] oracle smoke FAILED: ${query} exited ${smoke.code}`);
        return false;
      }
      if (!stdout.includes("\u2550\u2550\u2550 RULINGS") || stdout.includes("(no ruling matches")) {
        err(`[game] oracle smoke FAILED: ${query} produced no matching RULINGS`);
        if (stdout) err(stdout.split("\n").slice(0, 8).join("\n"));
        return false;
      }
    }
    out(`[game] oracle smoke GREEN \u2014 ${ORACLE_SMOKE_QUERIES.length}/${ORACLE_SMOKE_QUERIES.length} queries`);
    return true;
  }
  function findTestSuites(root, dir) {
    if (!fsExists(`${root}/${dir}`)) return [];
    const suites = [];
    for (const name of fsList(`${root}/${dir}`)) {
      const path = `${dir}/${name}`;
      const stat = tryFsStat(`${root}/${path}`);
      if (stat?.isDir) suites.push(...findTestSuites(root, path));
      else if (name.endsWith(".test.ts")) suites.push(path);
    }
    return suites.sort();
  }
  function runRoundTrip(root, rt) {
    if (!bundle(root, rt.genEntry, rt.genBundle)) {
      err(`[game] ${rt.label} round-trip FAILED: fixture generator does not bundle`);
      return false;
    }
    const gen = spawnSync(`${root}/tools/v8cli`, [`${root}/${rt.genBundle}`]);
    if (gen.stderr.trim()) err(gen.stderr.trim());
    const tape = gen.stdout.trim();
    if (gen.code !== 0 || !tape) {
      err(`[game] ${rt.label} round-trip FAILED: TS writer produced no tape`);
      return false;
    }
    fsWrite(`${root}/${rt.fixture}`, tape);
    const zig = spawnSync(resolveZig2(root), ["build", rt.zigStep]);
    if (zig.stdout.trim()) out(zig.stdout.trim());
    if (zig.stderr.trim()) err(zig.stderr.trim());
    if (zig.code !== 0) {
      err(`[game] ${rt.label} round-trip FAILED: Zig reader disagrees with the TS tape`);
      return false;
    }
    out(`[game] ${rt.label} round-trip GREEN \u2014 TS tape <-> Zig reader byte/value identical`);
    return true;
  }
  function runRoundTrips(root) {
    let allGreen = true;
    for (const rt of ROUND_TRIPS) allGreen = runRoundTrip(root, rt) && allGreen;
    return allGreen;
  }
  function assertPng(root, path) {
    if (!fsExists(`${root}/${path}`)) {
      err(`[game] render proof FAILED: no PNG at ${path}`);
      return false;
    }
    const dump = spawnSync("sh", ["-c", `head -c 24 ${root}/${path} | od -An -v -tu1`]);
    const bytes = dump.stdout.trim().split(/\s+/).map((t) => Number(t));
    const magic = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 24 || magic.some((m, i) => bytes[i] !== m)) {
      err(`[game] render proof FAILED: ${path} is not a well-formed PNG`);
      return false;
    }
    const w = bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19];
    const h = bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23];
    out(`[game] render proof: PNG ${w}x${h} at ${path}`);
    return w > 0 && h > 0;
  }
  function assertNoV8(root) {
    const bin = `${root}/${LOADER_BIN}`;
    const v8 = spawnSync("sh", ["-c", `nm ${bin} 2>/dev/null | grep -ic 'v8::' || true`]);
    const js = spawnSync("sh", ["-c", `strings -n 8 ${bin} 2>/dev/null | grep -icE 'react-reconciler|bundle-${LOADER_NAME}|__reactjit' || true`]);
    const lib = spawnSync("sh", ["-c", `ldd ${bin} 2>/dev/null | grep -ic 'v8' || true`]);
    const v8n = Number(v8.stdout.trim()) || 0;
    const jsn = Number(js.stdout.trim()) || 0;
    const libn = Number(lib.stdout.trim()) || 0;
    if (v8n !== 0 || jsn !== 0 || libn !== 0) {
      err(`[game] no-JS proof FAILED: v8 syms=${v8n}, js markers=${jsn}, v8 libs=${libn}`);
      return false;
    }
    out("[game] no-JS proof: loader binary carries 0 V8 symbols, 0 bundle markers, 0 V8 libs");
    return true;
  }
  function installGameFileManifest(root, tapeTransport, gamefilePath) {
    let manifest2;
    try {
      manifest2 = JSON.parse(tapeTransport);
    } catch (error) {
      err(`[game] bake FAILED: malformed game-file manifest: ${String(error?.message ?? error)}`);
      return false;
    }
    const absGamefile = `${root}/${gamefilePath}`;
    const stat = tryFsStat(absGamefile);
    if (!stat || !stat.size) {
      err(`[game] bake FAILED: game-file not written to ${gamefilePath}`);
      return false;
    }
    const assets = Array.isArray(manifest2.assets) ? manifest2.assets : [];
    for (const asset of assets) {
      if (!/^[0-9a-f]{64}$/.test(asset.hash)) {
        err("[game] bake FAILED: manifest asset hash is not a sha256 hex");
        return false;
      }
      const assetStat = tryFsStat(`${root}/${CONTENT_STORE_DIR}/${asset.hash}`);
      if (!assetStat || !assetStat.size) {
        err(`[game] bake FAILED: content-addressed asset ${asset.hash} missing from the store`);
        return false;
      }
    }
    const assetBytes = assets.reduce((n, asset) => n + (asset.bytes ?? 0), 0);
    out(`[game] wrote raw game-file ${gamefilePath} (${stat.size} bytes, binary; installed ${assets.length} asset(s), ${assetBytes} bytes)`);
    return true;
  }
  function bakeRealGameFile(root, opts = {}) {
    if (!bundle(root, BAKE_ENTRY, BAKE_BUNDLE)) {
      err("[game] bake FAILED: bakeGameFile does not bundle");
      return false;
    }
    const gamefile = opts.gamefile ?? BAKED_GAMEFILE;
    const gen = spawnSync(`${root}/tools/v8cli`, [
      `${root}/${BAKE_BUNDLE}`,
      "--gamefile",
      `${root}/${gamefile}`,
      "--store",
      `${root}/${CONTENT_STORE_DIR}`,
      ...opts.noPieces ? ["--no-pieces"] : [],
      ...opts.editorStem ? ["--editor-stem", opts.editorStem] : []
    ]);
    if (gen.stderr.trim()) err(gen.stderr.trim());
    const tapeTransport = gen.stdout.trim();
    if (gen.code !== 0 || !tapeTransport) {
      err("[game] bake FAILED: no game-file produced from the authored world");
      return false;
    }
    return installGameFileManifest(root, tapeTransport, gamefile);
  }
  function bakeMassiveGameFile(root, blocks) {
    if (!bundle(root, MASSIVE_BAKE_ENTRY, MASSIVE_BAKE_BUNDLE)) {
      err("[game] massive bake FAILED: bakeMassiveGameFile does not bundle");
      return false;
    }
    const args = [
      `${root}/${MASSIVE_BAKE_BUNDLE}`,
      "--gamefile",
      `${root}/${MASSIVE_GAMEFILE}`,
      "--store",
      `${root}/${CONTENT_STORE_DIR}`
    ];
    if (blocks && Number.isFinite(blocks)) args.push("--blocks", String(blocks));
    const gen = spawnSync(`${root}/tools/v8cli`, args);
    if (gen.stderr.trim()) err(gen.stderr.trim());
    const tapeTransport = gen.stdout.trim();
    if (gen.code !== 0 || !tapeTransport) {
      err("[game] massive bake FAILED: no game-file produced from the procedural city");
      return false;
    }
    return installGameFileManifest(root, tapeTransport, MASSIVE_GAMEFILE);
  }
  function clampInt(v, lo, hi) {
    if (!Number.isFinite(v)) return lo;
    return Math.max(lo, Math.min(hi, Math.floor(v)));
  }
  function readNumberArg(argv, index, name) {
    const arg = argv[index] ?? "";
    if (arg === name && argv[index + 1]) return { value: Number(argv[index + 1]), next: index + 1 };
    const prefix = `${name}=`;
    if (arg.startsWith(prefix)) return { value: Number(arg.slice(prefix.length)), next: index };
    return { value: null, next: index };
  }
  function parseParityOptions(argv) {
    const opts = {
      width: 1536,
      height: 1536,
      seed: 1592594996,
      assetCount: 8,
      assetBytes: 4096
    };
    for (let i = 0; i < argv.length; i += 1) {
      let parsed = readNumberArg(argv, i, "--size");
      if (parsed.value !== null) {
        opts.width = opts.height = clampInt(parsed.value, 16, 8192);
        i = parsed.next;
        continue;
      }
      parsed = readNumberArg(argv, i, "--width");
      if (parsed.value !== null) {
        opts.width = clampInt(parsed.value, 16, 8192);
        i = parsed.next;
        continue;
      }
      parsed = readNumberArg(argv, i, "--height");
      if (parsed.value !== null) {
        opts.height = clampInt(parsed.value, 16, 8192);
        i = parsed.next;
        continue;
      }
      parsed = readNumberArg(argv, i, "--seed");
      if (parsed.value !== null) {
        opts.seed = clampInt(parsed.value, 0, 4294967295);
        i = parsed.next;
        continue;
      }
      parsed = readNumberArg(argv, i, "--assets");
      if (parsed.value !== null) {
        opts.assetCount = clampInt(parsed.value, 0, 4096);
        i = parsed.next;
        continue;
      }
      parsed = readNumberArg(argv, i, "--asset-bytes");
      if (parsed.value !== null) {
        opts.assetBytes = clampInt(parsed.value, 0, 16 * 1024 * 1024);
        i = parsed.next;
        continue;
      }
    }
    return opts;
  }
  function paritySourceText(opts) {
    return [
      "format=hmsc.parity.v0",
      `width=${opts.width}`,
      `height=${opts.height}`,
      `seed=${opts.seed >>> 0}`,
      `asset_count=${opts.assetCount}`,
      `asset_bytes=${opts.assetBytes}`,
      ""
    ].join("\n");
  }
  function parseCompilerReport(stdout, compiler) {
    const lines = stdout.trim().split("\n").map((line) => line.trim()).filter(Boolean);
    const last = lines[lines.length - 1];
    if (!last) return null;
    try {
      const report2 = JSON.parse(last);
      return report2.compiler === compiler ? report2 : null;
    } catch {
      return null;
    }
  }
  function sha256File2(path) {
    const result = spawnSync("sha256sum", [path]);
    if (result.code !== 0) return "<sha256sum failed>";
    return result.stdout.trim().split(/\s+/)[0] ?? "<sha256sum failed>";
  }
  function parity(root, argv) {
    const opts = parseParityOptions(argv);
    fsMkdir(`${root}/${OUT_DIR}`);
    fsWrite(`${root}/${PARITY_SOURCE}`, paritySourceText(opts));
    out(`[game] parity source ${PARITY_SOURCE}: ${opts.width}x${opts.height} (${opts.width * opts.height} cells), assets=${opts.assetCount}x${opts.assetBytes}B`);
    if (!bundle(root, PARITY_ENTRY, PARITY_TS_BUNDLE)) {
      err("[game] parity FAILED: TypeScript parity compiler does not bundle");
      return 1;
    }
    const zigBuild = spawnSync(resolveZig2(root), ["build", "hmsc-parity-compiler", "-Doptimize=ReleaseFast"]);
    if (zigBuild.stdout.trim()) out(zigBuild.stdout.trim());
    if (zigBuild.stderr.trim()) err(zigBuild.stderr.trim());
    if (zigBuild.code !== 0) {
      err("[game] parity FAILED: Zig parity compiler does not build");
      return 1;
    }
    const absSource = `${root}/${PARITY_SOURCE}`;
    const absTsOut = `${root}/${PARITY_TS_GAMEFILE}`;
    const absZigOut = `${root}/${PARITY_ZIG_GAMEFILE}`;
    const tsWall0 = __nowMs();
    const tsRun = spawnSync(`${root}/tools/v8cli`, [`${root}/${PARITY_TS_BUNDLE}`, "--source", absSource, "--out", absTsOut]);
    const tsWallMs = __nowMs() - tsWall0;
    if (tsRun.stderr.trim()) err(tsRun.stderr.trim());
    if (tsRun.code !== 0) {
      err("[game] parity FAILED: TypeScript compiler run failed");
      if (tsRun.stdout.trim()) out(tsRun.stdout.trim());
      return 1;
    }
    const tsReport = parseCompilerReport(tsRun.stdout, "typescript");
    if (!tsReport) {
      err("[game] parity FAILED: TypeScript compiler did not print a report");
      if (tsRun.stdout.trim()) out(tsRun.stdout.trim());
      return 1;
    }
    tsReport.wallMs = tsWallMs;
    const zigWall0 = __nowMs();
    const zigRun = spawnSync(`${root}/${PARITY_ZIG_BIN}`, ["--source", absSource, "--out", absZigOut]);
    const zigWallMs = __nowMs() - zigWall0;
    if (zigRun.stderr.trim()) err(zigRun.stderr.trim());
    if (zigRun.code !== 0) {
      err("[game] parity FAILED: Zig compiler run failed");
      if (zigRun.stdout.trim()) out(zigRun.stdout.trim());
      return 1;
    }
    const zigReport = parseCompilerReport(zigRun.stdout, "zig");
    if (!zigReport) {
      err("[game] parity FAILED: Zig compiler did not print a report");
      if (zigRun.stdout.trim()) out(zigRun.stdout.trim());
      return 1;
    }
    zigReport.wallMs = zigWallMs;
    const tsStat = tryFsStat(absTsOut);
    const zigStat = tryFsStat(absZigOut);
    if (!tsStat || !zigStat || tsStat.size !== zigStat.size) {
      err(`[game] parity FAILED: output sizes differ TS=${tsStat?.size ?? 0} Zig=${zigStat?.size ?? 0}`);
      return 1;
    }
    const cmp = spawnSync("cmp", ["-s", absTsOut, absZigOut]);
    if (cmp.code !== 0) {
      const detail = spawnSync("cmp", [absTsOut, absZigOut]);
      if (detail.stdout.trim()) err(detail.stdout.trim());
      if (detail.stderr.trim()) err(detail.stderr.trim());
      err("[game] parity FAILED: TS and Zig game-files differ");
      return 1;
    }
    const hash = sha256File2(absTsOut);
    const speedup = zigReport.compileMs > 0 ? tsReport.compileMs / zigReport.compileMs : Infinity;
    out(`[game] TypeScript parity compile: ${tsReport.compileMs.toFixed(1)}ms inside compiler (${tsReport.wallMs.toFixed(1)}ms wall), ${tsReport.bytes} bytes`);
    out(`[game] Zig parity compile:        ${zigReport.compileMs.toFixed(1)}ms inside compiler (${zigReport.wallMs.toFixed(1)}ms wall), ${zigReport.bytes} bytes`);
    out(`[game] parity PASS \u2014 byte-identical game-files (${tsStat.size} bytes, sha256 ${hash}); Zig is ${speedup.toFixed(2)}x by in-compiler time`);
    return 0;
  }
  function resolveGameFile(root, choice = {}) {
    if (choice.massive) {
      if (bakeMassiveGameFile(root, choice.blocks)) return MASSIVE_GAMEFILE;
      err("[game] massive bake FAILED");
      return null;
    }
    if (choice.fixture) return FIXTURE_GAMEFILE;
    if (bakeRealGameFile(root)) return BAKED_GAMEFILE;
    err("[game] bake FAILED \u2014 refusing to render the synthetic fixture in its place");
    return null;
  }
  function runLoaderRenderProof(root, outPath, gameFile) {
    const build = spawnSync(resolveZig2(root), LOADER_BUILD_ARGS);
    if (build.stderr.trim()) err(build.stderr.trim());
    if (build.code !== 0) {
      err("[game] render proof FAILED: no-V8 loader does not build");
      return false;
    }
    fsMkdir(dirOf(`${root}/${outPath}`));
    const env = [
      "ZIGOS_HEADLESS=1",
      "ZIGOS_SCREENSHOT=1",
      `ZIGOS_SCREENSHOT_OUTPUT='${root}/${outPath}'`,
      "ZIGOS_SCREENSHOT_FRAMES=8"
    ].join(" ");
    const run29 = spawnSync("sh", ["-c", `${env} timeout -s KILL 90 ${root}/${LOADER_BIN} '${root}/${gameFile}' 2>&1 | grep -E 'loader|SCREENSHOT|construct|FAIL' || true`]);
    const runOut = run29.stdout.trim();
    if (runOut) out(runOut);
    if (!assertPng(root, outPath)) return false;
    const match = runOut.match(/built (\d+) mesh instances/);
    const builtCount = match ? Number(match[1]) : 0;
    if (!assertNoV8(root)) return false;
    out(`[game] loader render proof GREEN \u2014 stateless loader rendered ${builtCount} world instances in 3D, no JS`);
    return true;
  }
  function dirOf(path) {
    const i = path.lastIndexOf("/");
    return i <= 0 ? "/" : path.slice(0, i);
  }
  function parseChoice(argv) {
    const choice = {};
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === "--fixture") {
        choice.fixture = true;
        continue;
      }
      if (argv[i] === "--massive") {
        choice.massive = true;
        continue;
      }
      if (argv[i] === "--blocks") {
        choice.blocks = Number(argv[++i]);
        continue;
      }
      const m = /^--blocks=(\d+)$/.exec(argv[i] ?? "");
      if (m) choice.blocks = Number(m[1]);
    }
    return choice;
  }
  function shot(root, argv) {
    let outPath = `shots/${LOADER_NAME}.png`;
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === "--out" || argv[i] === "-o") {
        outPath = argv[++i] ?? outPath;
        continue;
      }
    }
    const gameFile = resolveGameFile(root, parseChoice(argv));
    if (!gameFile) {
      err("[game] shot FAILED: no game-file (the bake failed)");
      return 1;
    }
    if (!runLoaderRenderProof(root, outPath, gameFile)) {
      err("[game] shot FAILED");
      return 1;
    }
    out(`[game] shot PASS \u2014 ${outPath}`);
    return 0;
  }
  function play(root, argv) {
    const gameFile = resolveGameFile(root, parseChoice(argv));
    if (!gameFile) {
      err("[game] play FAILED: no game-file (the bake failed)");
      return 1;
    }
    const build = spawnSync(resolveZig2(root), LOADER_BUILD_ARGS);
    if (build.stderr.trim()) err(build.stderr.trim());
    if (build.code !== 0) {
      err("[game] play FAILED: no-V8 loader does not build");
      return 1;
    }
    out("[game] launching live window \u2014 close it or press ESC to exit...");
    const run29 = spawnSync(`${root}/${LOADER_BIN}`, [`${root}/${gameFile}`]);
    if (run29.stdout.trim()) out(run29.stdout.trim());
    if (run29.stderr.trim()) err(run29.stderr.trim());
    return run29.code === 0 ? 0 : 1;
  }
  function verify(root) {
    if (bundleVerifyHarness(root) !== 0) {
      err("[game] VERDICT RED \u2014 the verify harness does not bundle");
      return 1;
    }
    const oracleOk = runOracleSelfCheck(root);
    const roundtripOk = runRoundTrips(root);
    const renderGameFile = resolveGameFile(root, {});
    if (!renderGameFile) err("[game] render proof FAILED: the authored bake produced no game-file");
    const renderOk = renderGameFile ? runLoaderRenderProof(root, LOADER_SHOT, renderGameFile) : false;
    fsMkdir(`${root}/${TEST_OUT_DIR}`);
    const suites = SUITE_ROOTS.flatMap((suiteRoot) => findTestSuites(root, suiteRoot));
    let suitesPassed = 0;
    for (const suite of suites) {
      const name = suite.replace(/^cart\/hmsc-int\//, "").replace(/\//g, "_").replace(/\.test\.ts$/, ".test.js");
      const compiled = `${TEST_OUT_DIR}/${name}`;
      if (!bundle(root, suite, compiled)) {
        err(`[game] suite does not bundle: ${suite}`);
        continue;
      }
      const result = spawnSync(`${root}/tools/v8cli`, [`${root}/${compiled}`]);
      if (result.stdout.trim()) out(result.stdout.trim());
      if (result.stderr.trim()) err(result.stderr.trim());
      if (result.code === 0) suitesPassed += 1;
      else err(`[game] suite FAILED: ${suite}`);
    }
    const scripts = fsExists(`${root}/${VERIFY_DIR}`) ? fsList(`${root}/${VERIFY_DIR}`).filter((name) => name.endsWith(".cmds")).sort() : [];
    let scriptsPassed = 0;
    for (const script of scripts) {
      const result = spawnSync(`${root}/tools/v8cli`, [`${root}/${VERIFY_HARNESS_BUNDLE}`, `${root}/${VERIFY_DIR}/${script}`]);
      if (result.stdout.trim()) out(result.stdout.trim());
      if (result.stderr.trim()) err(result.stderr.trim());
      if (result.code === 0) scriptsPassed += 1;
      else err(`[game] verify script FAILED: ${VERIFY_DIR}/${script}`);
    }
    const green = oracleOk && roundtripOk && renderOk && suitesPassed === suites.length && scriptsPassed === scripts.length && scripts.length > 0;
    const tally = `${oracleOk ? 1 : 0}/1 oracle, ${roundtripOk ? ROUND_TRIPS.length : 0}/${ROUND_TRIPS.length} round-trips, ${renderOk ? 1 : 0}/1 render, ${suitesPassed}/${suites.length} suites, ${scriptsPassed}/${scripts.length} scripts`;
    if (!green) {
      err(`[game] VERDICT RED \u2014 ${tally}`);
      return 1;
    }
    out(`[game] VERDICT GREEN \u2014 ${tally}`);
    return 0;
  }

  // cli/commands/gdev.ts
  var gdev_exports = {};
  __export(gdev_exports, {
    run: () => run14
  });
  var DEFAULT_GAME_CART = "hmsc-int";
  var PROFILE_VERSION = "gdev-v1";
  var GDEV_SOCKET_GUI = "/tmp/reactjit-gdev.sock";
  var GDEV_SOCKET_TUI = "/tmp/reactjit-gdev-tui.sock";
  async function run14(argv) {
    const parsed = parseGdevArgs(argv);
    if (typeof parsed === "number") return parsed;
    const cartRoot = __cwd();
    const rjitHome = __env("RJIT_HOME") || cartRoot;
    const cart = resolveCart3(cartRoot, parsed.name);
    if (!cart) return fail6(`[gdev] not found: ${cartRoot}/cart/${parsed.name}/index.tsx or ${cartRoot}/cart/${parsed.name}.tsx`, 1);
    const substrate = resolveSubstrate2(parsed.substrateFlag, cart.manifest);
    const socket = substrate === "tui" ? GDEV_SOCKET_TUI : GDEV_SOCKET_GUI;
    const bundleMode = substrate === "tui" ? "tui-host" : "gpu-host";
    const perCartBundle = `${cartRoot}/.cache/gdev-bundle-${parsed.name}.js`;
    const binName = substrate === "tui" ? "reactjit-gdev-tui" : "reactjit-gdev";
    const bin = `${rjitHome}/zig-out/bin/${binName}`;
    fsMkdir(`${cartRoot}/.cache`);
    runFixReactImports2(rjitHome, cartRoot);
    const bakedIcons = bakeIconAtlas({ root: rjitHome, ifNeeded: true, quiet: true });
    if (bakedIcons !== 0) return bakedIcons;
    out(`[gdev] bundling ${cart.entry} -> ${perCartBundle}`);
    const term = terminalSize2();
    const bundle2 = bundleCart({
      rjitHome,
      cartEntry: cart.entry,
      outFile: perCartBundle,
      mode: bundleMode,
      termCols: term.cols,
      termRows: term.rows
    });
    writeSpawnOutput3(bundle2);
    if (bundle2.code !== 0) return bundle2.code || 1;
    const zigFlags = resolveGameZigFlags(rjitHome, `${perCartBundle}.metafile.json`);
    const nativeFingerprint = gdevFingerprint(nativeBuildFingerprint(rjitHome), substrate, socket, zigFlags);
    const hostInfo = readDevHostInfo(socket);
    if (hostInfo) {
      if (hostInfo.build_id !== nativeFingerprint.hash) {
        const stale = { current: nativeFingerprint, host: hostInfo };
        sendRebuildNotice(stale, socket);
        err("[gdev] STALE GAME DEV HOST - running native build id differs from disk.");
        err("[gdev] refusing to push: bundle would talk to incompatible native code.");
        err(`[gdev] kill the running game dev host (ctrl-c its terminal) and rerun this command.`);
        err(`[gdev] running build id: ${shortHash(stale.host.build_id)}`);
        err(`[gdev] disk build id:    ${shortHash(stale.current.hash)} (${stale.current.inputCount} inputs + game profile)`);
        return 1;
      }
      out(`[gdev] host detected @ ${socket} - pushing '${parsed.name}'`);
      const push2 = pushBundle(socket, parsed.name, perCartBundle);
      if (push2 === 0) {
        out(`[gdev] host switched to tab '${parsed.name}'`);
        return 0;
      }
      if (fsExists(socket)) fsRemove(socket);
    } else if (fsExists(socket)) {
      fsRemove(socket);
    }
    if (devHostNeedsBuild(bin, nativeFingerprint)) {
      const built = buildGdevHost(rjitHome, cartRoot, binName, substrate, perCartBundle, socket, zigFlags, nativeFingerprint);
      if (built !== 0) return built;
      writeDevBuildInfo(bin, nativeFingerprint);
    }
    const child = spawn("env", [`RJIT_DEV_CART_DIR=${cart.dir}`, bin]);
    out(`[gdev] host child=${child.id} socket=${socket}`);
    const watcher = spawnBundleWatcher(rjitHome, cart.entry, perCartBundle, bundleMode, term);
    drainUntilExit2(child.id, watcher.id);
    return 0;
  }
  function parseGdevArgs(argv) {
    let name = "";
    let substrateFlag = null;
    for (const arg of argv) {
      if (arg === "--help" || arg === "-h") return usage2(0);
      if (arg === "--tui" || arg === "--headless") {
        substrateFlag = "tui";
      } else if (arg === "--gui") {
        substrateFlag = "gui";
      } else if (arg.startsWith("--")) {
        err(`[gdev] unknown flag: ${arg}`);
        return usage2(1);
      } else if (name) {
        err(`[gdev] unexpected positional arg: ${arg}`);
        return usage2(1);
      } else {
        name = arg;
      }
    }
    return { name: name || DEFAULT_GAME_CART, substrateFlag };
  }
  function usage2(code = 1) {
    err("Usage: rjit gdev [cart-name] [--gui|--tui]");
    err(`  Default cart: ${DEFAULT_GAME_CART}`);
    err("  Game dev host: source-driven native flags, separate gdev socket, no embedded Postgres bootstrap.");
    return code;
  }
  function resolveCart3(cartRoot, name) {
    const dirEntry = `${cartRoot}/cart/${name}/index.tsx`;
    if (fsExists(dirEntry)) return { entry: dirEntry, dir: dirname4(dirEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
    const fileEntry = `${cartRoot}/cart/${name}.tsx`;
    if (fsExists(fileEntry)) return { entry: fileEntry, dir: dirname4(fileEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
    return null;
  }
  function resolveSubstrate2(flag, manifestPath) {
    if (flag) return flag;
    if (fsExists(manifestPath)) {
      const surface = loadManifest(manifestPath).surface;
      if (surface === "tui" || surface === "gui") return surface;
    }
    return "gui";
  }
  function runFixReactImports2(rjitHome, cartRoot) {
    const script = `${rjitHome}/scripts/fix-react-imports`;
    if (!fsExists(script)) return;
    const result = spawnSync("env", [`RJIT_HOME=${rjitHome}`, `CART_ROOT=${cartRoot}`, script]);
    writeSpawnOutput3(result);
  }
  function resolveGameZigFlags(rjitHome, metafilePath) {
    if (!fsExists(metafilePath)) {
      err(`[gdev] WARNING: no metafile at ${metafilePath} - only base V8 dev flags enabled`);
      return ensureBaseFlags([]);
    }
    const result = spawnSync(`${rjitHome}/tools/rjit`, ["metafile-gate", "--metafile", metafilePath, "--format", "zig-flags"]);
    if (result.stderr) __writeStderr(result.stderr);
    if (result.code !== 0) throw new Error("metafile-gate failed");
    return ensureBaseFlags(result.stdout.trim() ? result.stdout.trim().split(/\s+/) : []);
  }
  function ensureBaseFlags(flags) {
    const out2 = new Set(flags.filter(Boolean));
    out2.add("-Duse-v8=true");
    out2.add("-Ddev-mode=true");
    if (out2.has("-Dhas-embed=true")) out2.add("-Dhas-pg=true");
    return Array.from(out2);
  }
  function gdevFingerprint(native, substrate, socket, zigFlags) {
    const body = [
      PROFILE_VERSION,
      native.hash,
      substrate,
      socket,
      ...zigFlags.slice().sort()
    ].join("\n") + "\n";
    const digest = spawnSync("sha256sum", [], body);
    if (digest.code !== 0) throw new Error(`gdev input digest failed
${digest.stderr || digest.stdout}`);
    const hash = digest.stdout.trim().split(/\s+/)[0] || "";
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`gdev input digest malformed: ${digest.stdout.trim()}`);
    return { hash, inputCount: native.inputCount + zigFlags.length + 3 };
  }
  function devHostNeedsBuild(bin, fingerprint) {
    if (!fsExists(bin)) return true;
    return readDevBuildId(bin) !== fingerprint.hash;
  }
  function buildGdevHost(rjitHome, cartRoot, binName, substrate, bundlePath, socket, zigFlags, fingerprint) {
    out(`[gdev] compiling game dev binary (${rjitHome}/zig-out/bin/${binName}, ${substrate}, ReleaseFast)...`);
    out(`[gdev] native flags: ${zigFlags.join(" ") || "(base only)"}`);
    const zig = resolveZig3(rjitHome);
    const args = [
      "build",
      "app",
      "-p",
      `${rjitHome}/zig-out`,
      `-Dapp-name=${binName}`,
      "-Dapp-source=framework/v8_app.zig",
      `-Dbundle-path=${bundlePath}`,
      `-Ddev-bundle-path=${bundlePath}`,
      `-Ddev-socket-path=${socket}`,
      `-Ddev-build-id=${fingerprint.hash}`,
      ...zigFlags,
      "-Doptimize=ReleaseFast"
    ];
    if (substrate === "tui") args.push("-Dhas-gpu=false");
    const cmd = cartRoot === rjitHome ? zig : "env";
    const finalArgs = cartRoot === rjitHome ? args : [`ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...args];
    const build = spawnSync(cmd, finalArgs);
    writeSpawnOutput3(build);
    return build.code === 0 ? 0 : build.code || 1;
  }
  function spawnBundleWatcher(rjitHome, cartEntry, outFile, mode, term) {
    const flags = bundleFlags({
      rjitHome,
      cartEntry,
      outFile,
      mode,
      watch: true,
      metafile: false,
      termCols: term.cols,
      termRows: term.rows
    });
    const watcher = spawn(`${rjitHome}/tools/esbuild`, flags);
    out(`[gdev] watching ${cartEntry} - edits rebuild ${outFile} (ctrl-c to stop)`);
    return watcher;
  }
  function pushBundle(socket, tabName, bundlePath) {
    const bundle2 = fsRead(bundlePath);
    if (!fsExists(socket)) return 2;
    const fd = tryUnixConnect(socket);
    if (fd === null) return 2;
    try {
      unixWrite(fd, `PUSH ${tabName} ${utf8ByteLength2(bundle2)}
`);
      unixWrite(fd, bundle2);
      const line = unixReadLine(fd, __nowMs() + 3e3).trim();
      if (line.startsWith("OK")) return 0;
      err(`[gdev] host error: ${line}`);
      return 1;
    } catch (error) {
      if (error instanceof SocketError) {
        err(`[gdev] push failed: ${error.message}`);
        return 2;
      }
      throw error;
    } finally {
      unixClose(fd);
    }
  }
  function terminalSize2() {
    try {
      const parsed = JSON.parse(__termSize());
      return { cols: parsed[0] || 80, rows: parsed[1] || 24 };
    } catch {
      return { cols: 80, rows: 24 };
    }
  }
  function resolveZig3(rjitHome) {
    const bundled = __env("REACTJIT_ZIG") || `${rjitHome}/tools/zig/zig`;
    if (fsExists(bundled)) return bundled;
    return "zig";
  }
  function drainUntilExit2(hostId, watcherId) {
    while (true) {
      const hostLine = __childReadLine(hostId, 50);
      if (hostLine !== null) __writeStdout(`${hostLine}
`);
      const watcherLine = __childReadLine(watcherId, 50);
      if (watcherLine !== null) __writeStdout(`${watcherLine}
`);
      __sleepMs(50);
    }
  }
  function writeSpawnOutput3(result) {
    if (result.stdout) __writeStdout(result.stdout);
    if (result.stderr) __writeStderr(result.stderr);
  }
  function dirname4(path) {
    const idx = path.lastIndexOf("/");
    return idx <= 0 ? "/" : path.slice(0, idx);
  }
  function fail6(message, code) {
    err(message);
    return code;
  }
  function utf8ByteLength2(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 128) bytes += 1;
      else if (code < 2048) bytes += 2;
      else if (code >= 55296 && code <= 56319) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  // cli/commands/help.ts
  var help_exports = {};
  __export(help_exports, {
    printTopLevel: () => printTopLevel,
    run: () => run15
  });
  var TEMPLATES = ["basic", "routes", "dashboard", "taskboard", "canvas", "stdlib"];
  var SUBCOMMANDS = ["init", "dev", "gdev", "tui", "ship", "ship-tui", "pack", "play", "shot", "autotest", "classify", "clean", "orphans", "bake-icons", "pack-sdk", "firecracker-build", "help"];
  var SUBCOMMAND_DOC = {
    init: {
      summary: "scaffold a new cart from a template",
      usage: ["rjit init <directory>", "rjit init <directory> <template>", "rjit init <template> <directory>"],
      detail: [
        "Templates:",
        `  ${TEMPLATES.join(", ")}`,
        "",
        "The one-argument form uses the basic template.",
        "The directory is created if it does not exist; existing files are",
        "never overwritten."
      ]
    },
    dev: {
      summary: "iterate on a cart with hot reload",
      usage: ["rjit dev <cart-name> [--gui|--tui]"],
      detail: [
        "Bundles cart/<name>.tsx -> .cache/bundle-<name>.js, then either:",
        "  1. pushes the bundle to a running dev host (one already on",
        "     /tmp/reactjit.sock), upserting its tab, or",
        "  2. spawns a fresh dev host and starts a watch loop that",
        "     re-pushes on every save.",
        "",
        "TSX / TS edits hot-reload in ~300ms. Zig / framework / build.zig",
        "edits compile in the background, then wait for explicit approval in",
        "the editor before any native module activation or host restart.",
        "",
        "--tui (alias --headless) runs the headless substrate; --gui is the",
        'default unless cart.json declares "surface": "tui".'
      ]
    },
    gdev: {
      summary: "iterate on game carts with a lean hot-reload host",
      usage: ["rjit gdev [cart-name] [--gui|--tui]"],
      detail: [
        "Game-focused sibling of rjit dev. Defaults to cart/hmsc-int, bundles",
        "to .cache/gdev-bundle-<name>.js, and starts a separate game dev host",
        "on /tmp/reactjit-gdev.sock.",
        "",
        "Unlike rjit dev, this builds native flags from the cart metafile",
        "instead of linking every dev feature, and it does not bootstrap",
        "embedded Postgres. Future game-only services should slot into this",
        "command instead of the general cart dev path."
      ]
    },
    ship: {
      summary: "build a cart into a single self-extracting binary",
      usage: ["rjit ship <cart-name> [--gui|--tui]          # release, self-extracting"],
      detail: [
        "Pipeline:",
        "  1. esbuild cart/<name>.tsx -> bundle-<name>.js",
        "  2. resolver inspects the bundle's metafile and selects the",
        "     -Dhas-* feature flags from sdk/dependency-registry.json",
        "  3. zig build app -> zig-out/bin/<name>",
        "  4. ldd-walk + tar + self-extracting shell header",
        "",
        "Result is one file you can move anywhere; on first run it",
        "extracts to ~/.cache/reactjit-<name>/<sig>/ and execs.",
        "",
        "--tui (alias --headless) builds the headless substrate; --gui is the",
        'default unless cart.json declares "surface": "tui".'
      ]
    },
    tui: {
      summary: "run a TUI cart in the foreground terminal",
      usage: ["rjit tui [cart-name|entry.tsx] [-- app-args...]"],
      detail: [
        "Bundles the cart through tui/entry.tsx, builds a headless native",
        "binary, then execs it with the current terminal attached. This is",
        "the interactive path: alt-screen painting, raw input, mouse reporting,",
        "and Ctrl-C all belong to the TUI app.",
        "",
        "Use `rjit dev <cart-name> --tui` only for the experimental persistent",
        "TUI dev host. That path is log/socket-oriented and is not the same as",
        "foreground terminal execution."
      ]
    },
    "ship-tui": {
      summary: "compatibility alias for ship --tui",
      usage: ["rjit ship-tui <cart-name> [--fat]"],
      detail: [
        "Equivalent to:",
        "  rjit ship <cart-name> --tui",
        "",
        "Kept for muscle memory during the migration; the canonical command is",
        "rjit ship <cart-name> --tui."
      ]
    },
    pack: {
      summary: "build a game package (.rjpkg)",
      usage: ["rjit pack hmsc [--out path/to/hmsc.rjpkg]"],
      detail: [
        "Builds the hmsc cartridge bundle and emits the package manifest plus",
        "the slice-1 binary mapfile under maps/city.map."
      ]
    },
    play: {
      summary: "run a game package with the package player",
      usage: ["rjit play path/to/game.rjpkg"],
      detail: [
        "Builds zig-out/bin/rjit-player when missing, then boots that player",
        "binary with the package path."
      ]
    },
    shot: {
      summary: "capture a cart's OWN rendered frame headless (never the desktop)",
      usage: ["rjit shot <cart> [--out path.png] [--route /r] [--frames N] [--timeout S] [-- app-args...]"],
      detail: [
        "SELFSHOT-0606: desktop/X11 capture of the user's system is BANNED.",
        "This boots the cart's shipped binary with a HIDDEN window",
        "(ZIGOS_HEADLESS=1 \u2014 never shown on any desktop), optionally navigates",
        "to --route (RJIT_BOOT_ROUTE), renders N frames (default 60), captures",
        "the app's own swapchain to a PNG, and exits. The PNG is then asserted",
        "(magic, IHDR dims, plausible size) \u2014 exit 0 = PASS, so this doubles as",
        "the capability's smoke test.",
        "",
        "Default output: shots/<cart>-<stamp>.png. Builds via ship when the",
        "binary is stale. The live-app sibling is the in-app console verb",
        "`shot [path]` (__capture_frame \u2014 same readback, no exit)."
      ]
    },
    autotest: {
      summary: "run a headless witness test and proof grid",
      usage: ["rjit autotest <name>"],
      detail: [
        "Looks for tests/<name>.autotest and cart/<name>/index.tsx or",
        "cart/<name>.tsx.",
        "",
        "Builds the cart when needed, runs the binary with ZIGOS_WITNESS=autotest,",
        "then calls scripts/autotest-grid to write tests/screenshots/<name>/proof.png",
        "and archive the run under a timestamped PASS/FAIL directory."
      ]
    },
    classify: {
      summary: "extract and migrate JSX classifier patterns",
      usage: [
        "rjit classify [--dir path] [--output file] [--min n] [--dry-run]",
        "rjit classify migrate|rename|add|partial|theme|pick ..."
      ],
      detail: [
        "Scans TSX files for repeated primitive style/prop patterns and writes",
        "a .cls.ts classifier sheet. Subcommands handle migration, renaming,",
        "manual classifier insertion, partial-pattern mining, and theme-token",
        "suggestions."
      ]
    },
    orphans: {
      summary: "find dev hosts nothing is attached to, and retire them by exact pid",
      usage: ["rjit orphans", "rjit orphans --kill", "rjit orphans --json"],
      detail: [
        "A `rjit dev` run that dies without taking its host down leaves the host",
        "running, reparented to init. It holds no window and serves no socket, so",
        "it is invisible \u2014 nine had accumulated over six days holding 4.7GB before",
        "anyone noticed (req_4074).",
        "",
        "A pid is only called an orphan when THREE facts agree: reparented to init,",
        "not the dev socket listener, and holding no dmabuf or display-server handle.",
        "Anything failing one of them is kept, and the report says what kept it.",
        "",
        "There is deliberately no pattern form. `pkill -f <repo path>` matches the",
        "polling shell that is running it and cascades \u2014 that is what logged the user",
        "out of their desktop and killed all 14 worker panes on 2026-04-22. This",
        "command emits exact numeric pids and signals them one at a time, re-checking",
        "each immediately before it does.",
        "",
        "The editor shows the same finding as a notice; approving it there writes a",
        "one-shot token the dev supervisor acts on, so the editor never signals",
        "anything itself."
      ]
    },
    clean: {
      summary: "report / drop the local zig cache (the per-build disk eater)",
      usage: ["rjit clean", "rjit clean --drop"],
      detail: [
        "Zig never evicts .zig-cache/o entries, and every build lands a fresh",
        "multi-hundred-MB one (it reached 756GB on 2026-07-03). Successful",
        "ship/dev builds auto-drop the whole cache once it outgrows the budget",
        "(RJIT_CACHE_MAX_GB, default 100GB; 0 disables).",
        "",
        "No partial prune exists ON PURPOSE: zig derives o/<hash> names by",
        "re-hashing manifest inputs, so deleting a subset of o/ poisons the",
        "surviving manifests and wedges every build. All or nothing.",
        "",
        "--drop   drop the whole cache now; the next build is fully cold"
      ]
    },
    "bake-icons": {
      summary: "bake runtime icon polylines into the GPU SDF atlas",
      usage: ["rjit bake-icons"],
      detail: [
        "Reads runtime/icons/icons.ts and writes:",
        "  framework/gpu/icon_atlas.zig",
        "  framework/gpu/icon_atlas_debug.ppm.txt",
        "  runtime/icons/baked-names.ts"
      ]
    },
    "pack-sdk": {
      summary: "build the self-extracting rjit SDK distributable",
      usage: ["rjit pack-sdk [--out path] [--keep-stage]"],
      detail: [
        "Stages the toolchain, runtime/framework sources, dependency registry,",
        "vendored packages, generated CLI bundle, and sysroot payload into a",
        "single shell self-extractor."
      ]
    },
    "firecracker-build": {
      summary: "build a Firecracker rootfs from a TS recipe",
      usage: ["rjit firecracker-build <recipe.ts>"],
      detail: [
        "Bundles the recipe with esbuild, evaluates its default export, then",
        "runs mmdebstrap to emit the requested ext4 or squashfs image and",
        "writes a manifest beside the image."
      ]
    },
    help: {
      summary: "print this help, or per-subcommand help",
      usage: ["rjit help", "rjit help <subcommand>"],
      detail: []
    }
  };
  async function run15(argv) {
    const target = argv[0];
    const registry = readRegistry();
    if (!target) {
      printTopLevel(registry);
      return 0;
    }
    return printSubcommand(target);
  }
  function printTopLevel(registry = readRegistry()) {
    const lines = [
      "rjit - ReactJIT cart toolchain",
      "",
      "Usage:",
      "  rjit <subcommand> [args]",
      "",
      "Subcommands:"
    ];
    for (const name of SUBCOMMANDS) {
      lines.push(`  ${pad(name, 8)}${SUBCOMMAND_DOC[name].summary}`);
    }
    lines.push("");
    lines.push("Run `rjit help <subcommand>` for details.");
    lines.push("");
    const features = listFeatures(registry);
    if (features.length) {
      lines.push("Source-driven build features (selected by the resolver from");
      lines.push("the cart's esbuild metafile; you don't pass these by hand):");
      lines.push(...features);
      lines.push("");
    }
    __writeStdout(lines.join("\n") + "\n");
  }
  function printSubcommand(name) {
    if (!isHelpCommand(name)) {
      err(`rjit help: unknown subcommand: ${name}`);
      err("try: rjit help");
      return 1;
    }
    const doc = SUBCOMMAND_DOC[name];
    const lines = [`rjit ${name} - ${doc.summary}`, "", "Usage:"];
    for (const usage8 of doc.usage) lines.push(`  ${usage8}`);
    if (doc.detail.length) {
      lines.push("");
      lines.push(...doc.detail);
    }
    out(lines.join("\n"));
    return 0;
  }
  function readRegistry() {
    const raw = tryFsRead(`${__cwd()}/sdk/dependency-registry.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function listFeatures(registry) {
    if (!registry?.features) return [];
    const lines = [];
    for (const name of Object.keys(registry.features).sort()) {
      const feature = registry.features[name];
      const flags = (feature.buildOptions ?? []).map((option) => `-D${option}=true`).join(" ");
      lines.push(`  ${pad(name, 16)}${flags || "(no build flag)"}`);
    }
    return lines;
  }
  function pad(value, length) {
    if (value.length >= length) return `${value}  `;
    return value + " ".repeat(length - value.length);
  }
  function isHelpCommand(value) {
    return SUBCOMMANDS.includes(value);
  }

  // cli/commands/init.ts
  var init_exports = {};
  __export(init_exports, {
    run: () => run16
  });
  var TEMPLATE_NAMES = ["basic", "routes", "dashboard", "taskboard", "canvas", "stdlib"];
  async function run16(argv) {
    const parsed = parseArgs3(argv);
    if (typeof parsed === "number") return parsed;
    const root = __cwd();
    const template = TEMPLATES2[parsed.template];
    const targetDir = resolveTarget(root, parsed.directory);
    if (fsExists(targetDir)) return fail7(`target already exists: ${displayPath(root, targetDir)}`, 1);
    const name = cartNameFor(targetDir);
    const title = titleForName(name);
    const inCart = dirname5(targetDir) === joinPath2(root, "cart");
    const ctx = {
      targetDir,
      name,
      title,
      inCart,
      themeImport: importPath(root, targetDir, "theme"),
      classifierImport: importPath(root, targetDir, "classifier"),
      primitivesImport: importPath(root, targetDir, "primitives"),
      routerImport: importPath(root, targetDir, "router"),
      iconImport: importPath(root, targetDir, "icons/Icon"),
      iconPackImport: importPath(root, targetDir, "icons/icons")
    };
    try {
      fsMkdir(targetDir);
      const files = template.files(ctx);
      files["cart.json"] = manifest(title, template.description, template.width, template.height);
      files["README.md"] = readme(root, ctx, parsed.template);
      for (const [fileName, content] of Object.entries(files)) {
        const path = joinPath2(targetDir, fileName);
        const parent = dirname5(path);
        if (!fsExists(parent)) fsMkdir(parent);
        fsWrite(path, content);
      }
    } catch (error) {
      return fail7(error.message, 1);
    }
    out(`[init] created ${displayPath(root, targetDir)}`);
    out(`[init] template ${parsed.template}`);
    if (inCart) out(`[init] run ./scripts/dev ${name}`);
    else out("[init] run ./scripts/dev <cart-name> after moving it under cart/");
    return 0;
  }
  function parseArgs3(argv) {
    if (argv.length === 0) {
      usage3();
      return 2;
    }
    for (const arg of argv) {
      if (arg.startsWith("-")) return fail7("flags are not supported by init", 2);
    }
    if (argv.length === 1) return { directory: argv[0], template: "basic" };
    if (argv.length === 2) {
      const a = argv[0];
      const b = argv[1];
      const aIsTemplate = isTemplate(a);
      const bIsTemplate = isTemplate(b);
      if (aIsTemplate && !bIsTemplate) return { directory: b, template: a };
      if (bIsTemplate && !aIsTemplate) return { directory: a, template: b };
      if (bIsTemplate) return { directory: a, template: b };
      return fail7(`unknown template: ${b}`, 2);
    }
    return fail7("too many positional arguments", 2);
  }
  function usage3() {
    out([
      "usage:",
      "  tools/v8cli scripts/init.js <directory>",
      "  tools/v8cli scripts/init.js <directory> <template>",
      "  tools/v8cli scripts/init.js <template> <directory>",
      "",
      "templates:",
      `  ${TEMPLATE_NAMES.join(", ")}`,
      "",
      "The one-argument form uses the basic template."
    ].join("\n"));
  }
  function fail7(message, code) {
    err(`[init] ${message}`);
    return code || 1;
  }
  function normalizePath3(path) {
    const absolute = path.startsWith("/");
    const parts = [];
    for (const part of path.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
        else if (!absolute) parts.push(part);
        continue;
      }
      parts.push(part);
    }
    return (absolute ? "/" : "") + parts.join("/");
  }
  function joinPath2(a, b) {
    if (!a) return normalizePath3(b);
    if (!b) return normalizePath3(a);
    return normalizePath3(a.replace(/\/+$/, "") + "/" + b.replace(/^\/+/, ""));
  }
  function dirname5(path) {
    const normalized = normalizePath3(path);
    const index = normalized.lastIndexOf("/");
    if (index <= 0) return normalized.startsWith("/") ? "/" : ".";
    return normalized.slice(0, index);
  }
  function basename3(path) {
    const normalized = normalizePath3(path);
    const index = normalized.lastIndexOf("/");
    return index === -1 ? normalized : normalized.slice(index + 1);
  }
  function hasPathSeparator(value) {
    return value.includes("/") || value.includes("\\") || value === "." || value === "..";
  }
  function resolveTarget(root, input) {
    if (!input || input.startsWith("-")) throw new Error("directory must be a positional argument, not a flag");
    if (!hasPathSeparator(input) && !input.startsWith("/")) return normalizePath3(joinPath2(root, `cart/${input}`));
    if (input.startsWith("/")) return normalizePath3(input);
    return normalizePath3(joinPath2(root, input));
  }
  function relativeDir(fromDir, toDir) {
    const from = normalizePath3(fromDir).split("/").filter(Boolean);
    const to = normalizePath3(toDir).split("/").filter(Boolean);
    let index = 0;
    while (index < from.length && index < to.length && from[index] === to[index]) index++;
    const up = from.slice(index).map(() => "..");
    const rel3 = up.concat(to.slice(index)).join("/");
    return rel3 || ".";
  }
  function importPath(root, targetDir, runtimeModule) {
    return `${relativeDir(targetDir, joinPath2(root, "runtime"))}/${runtimeModule}`;
  }
  function displayPath(root, path) {
    return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  }
  function cartNameFor(targetDir) {
    return basename3(targetDir).replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "app";
  }
  function titleForName(name) {
    return name.split(/[-_]+/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ") || name;
  }
  function isTemplate(value) {
    return TEMPLATE_NAMES.includes(value);
  }
  function manifest(name, description, width, height) {
    return JSON.stringify({ name, description, customChrome: true, width, height }, null, 2) + "\n";
  }
  function readme(root, ctx, templateName) {
    const editList = templateName === "basic" ? ["- `index.tsx` is the cart entry point.", "- `cart.json` controls the host window metadata."] : templateName === "stdlib" ? [
      "- `index.tsx` is the cart entry point and stdlib primitive example.",
      "- `style.cls.ts` registers classifier components with `theme:` tokens.",
      "- `theme.ts` defines the local color and style palette.",
      "- `media/sample.mp4` is the video path used by the generated `<video>` example.",
      "- `cart.json` controls the host window metadata."
    ] : [
      "- `index.tsx` is the cart entry point and app behavior.",
      "- `style.cls.ts` registers classifier components with `theme:` tokens.",
      "- `theme.ts` defines the local color and style palette.",
      "- `cart.json` controls the host window metadata."
    ];
    return [
      `# ${ctx.title}`,
      "",
      "This cart was generated by `rjit init`.",
      "",
      "ReactJIT stdlib imports live under `runtime/`. The basic template shows the lowercase JSX intrinsics; richer templates import from the stdlib modules directly and use the classifier/theme system.",
      "",
      "Edit files here:",
      editList.join("\n"),
      "",
      "Run it:",
      "```sh",
      ctx.inCart ? `./scripts/dev ${ctx.name}` : "./scripts/dev <cart-name>",
      "```",
      "",
      "Ship it:",
      "```sh",
      ctx.inCart ? `./scripts/ship ${ctx.name}` : "./scripts/ship <cart-name>",
      "```",
      ""
    ].join("\n");
  }
  function themeSource(themeImport) {
    return `import type { StylePalette, ThemeColors } from '${themeImport}';

export const APP_COLORS: Partial<ThemeColors> = {
  bg: '#0b1117',
  bgAlt: '#111a24',
  bgElevated: '#162231',
  surface: '#182432',
  surfaceHover: '#213247',
  border: '#2e4159',
  borderFocus: '#4ea1ff',
  text: '#eef5ff',
  textSecondary: '#b6c4d7',
  textDim: '#74849a',
  primary: '#4ea1ff',
  accent: '#ffd166',
  success: '#72d391',
  warning: '#ffb86b',
  error: '#ff6b7a',
  info: '#77d7ff',
};

export const APP_STYLES: Partial<StylePalette> = {
  radiusSm: 4,
  radiusMd: 8,
  radiusLg: 12,
  spacingSm: 8,
  spacingMd: 14,
  spacingLg: 22,
  borderThin: 1,
  borderMedium: 2,
  fontSm: 12,
  fontMd: 14,
  fontLg: 20,
};
`;
  }
  function styleClsSource(classifierImport) {
    return `import { classifier, classifiers as C } from '${classifierImport}';

classifier({
  AppRoot: { type: 'Box', style: { width: '100%', height: '100%', backgroundColor: 'theme:bg' } },
  AppShell: { type: 'Box', style: { width: '100%', height: '100%', padding: 'theme:spacingLg', gap: 'theme:spacingMd', backgroundColor: 'theme:bg' } },
  AppHeader: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 'theme:spacingMd' } },
  AppTitleBlock: { type: 'Box', style: { flexDirection: 'column', gap: 3, flexGrow: 1, flexBasis: 0 } },
  AppKicker: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:accent' },
  AppTitle: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:text', fontWeight: 'bold' },
  AppSubtle: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textSecondary' },
  AppDim: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textDim' },
  AppNav: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingSm' } },
  AppNavItem: { type: 'Pressable', style: { paddingLeft: 12, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:surface', borderWidth: 'theme:borderThin', borderColor: 'theme:border' }, hoverStyle: { backgroundColor: 'theme:surfaceHover', borderColor: 'theme:borderFocus' } },
  AppNavText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:text' },
  AppBody: { type: 'Box', style: { flexGrow: 1, flexBasis: 0, gap: 'theme:spacingMd' } },
  AppRow: { type: 'Box', style: { flexDirection: 'row', gap: 'theme:spacingMd' } },
  AppPanel: { type: 'Box', style: { flexGrow: 1, flexBasis: 0, padding: 'theme:spacingMd', gap: 'theme:spacingSm', borderRadius: 'theme:radiusLg', backgroundColor: 'theme:surface', borderWidth: 'theme:borderThin', borderColor: 'theme:border' } },
  AppPanelTitle: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:text', fontWeight: 'bold' },
  AppMetric: { type: 'Text', fontSize: 28, color: 'theme:text', fontWeight: 'bold' },
  AppBadge: { type: 'Box', style: { alignSelf: 'flex-start', paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:bgElevated' } },
  AppBadgeText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:accent' },
  AppTextInput: { type: 'TextInput', style: { height: 36, paddingLeft: 10, paddingRight: 10, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:bgAlt', borderWidth: 'theme:borderThin', borderColor: 'theme:border', color: 'theme:text' } },
  AppCanvasFrame: { type: 'Box', style: { flexGrow: 1, flexBasis: 0, overflow: 'hidden', borderRadius: 'theme:radiusLg', backgroundColor: 'theme:bgAlt', borderWidth: 'theme:borderThin', borderColor: 'theme:border' } },
});

export { C };
`;
  }
  function basicIndex(ctx) {
    return `export default function App() {
  return (
    <router initialPath="/">
      <box style={{ width: '100%', height: '100%', padding: 24, gap: 16, backgroundColor: '#101624' }}>
        <text style={{ fontSize: 24, fontWeight: 'bold', color: '#f8fafc' }}>${ctx.title}</text>
        <text style={{ fontSize: 13, color: '#a7b0c0' }}>Edit index.tsx to start building. The ReactJIT stdlib lives in runtime/.</text>
        <route path="/">
          <box style={{ padding: 16, gap: 8, borderRadius: 10, backgroundColor: '#182235', borderWidth: 1, borderColor: '#2d3a52' }}>
            <text style={{ fontSize: 16, fontWeight: 'bold', color: '#ffffff' }}>Home route</text>
            <text style={{ fontSize: 13, color: '#cbd5e1' }}>This starter intentionally uses lowercase router, route, box, and text intrinsics.</text>
          </box>
        </route>
        <route fallback><box style={{ padding: 16, borderRadius: 10, backgroundColor: '#1f2937' }}><text style={{ color: '#f8fafc' }}>Route not found.</text></box></route>
      </box>
    </router>
  );
}
`;
  }
  function routedIndex(ctx, kind) {
    return `import { Route, Router, useNavigate } from '${ctx.routerImport}';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

function Home() {
  return <C.AppPanel><C.AppPanelTitle>${kind}</C.AppPanelTitle><C.AppSubtle>Edit index.tsx, theme.ts, and style.cls.ts.</C.AppSubtle></C.AppPanel>;
}

function Shell() {
  const nav = useNavigate();
  return (
    <C.AppRoot><C.AppShell>
      <C.AppHeader>
        <C.AppTitleBlock><C.AppKicker>${kind.toUpperCase()}</C.AppKicker><C.AppTitle>${ctx.title}</C.AppTitle><C.AppSubtle>Generated ReactJIT ${kind} starter.</C.AppSubtle></C.AppTitleBlock>
        <C.AppNav><C.AppNavItem onPress={() => nav.push('/')}><C.AppNavText>Home</C.AppNavText></C.AppNavItem></C.AppNav>
      </C.AppHeader>
      <Route path="/"><Home /></Route>
      <Route fallback><C.AppPanel><C.AppPanelTitle>Not found</C.AppPanelTitle></C.AppPanel></Route>
    </C.AppShell></C.AppRoot>
  );
}

export default function App() {
  return <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}><Router initialPath="/"><Shell /></Router></ThemeProvider>;
}
`;
  }
  function taskboardIndex(ctx) {
    return `import React from 'react';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

export default function App() {
  const [tasks, setTasks] = React.useState(['Wire up host data', 'Tune classifier tokens', 'Ship the cart']);
  const [draft, setDraft] = React.useState('');
  const addTask = () => { const text = draft.trim(); if (!text) return; setTasks((items) => items.concat(text)); setDraft(''); };
  return <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}><C.AppRoot><C.AppShell><C.AppHeader><C.AppTitleBlock><C.AppKicker>TASKBOARD</C.AppKicker><C.AppTitle>${ctx.title}</C.AppTitle></C.AppTitleBlock></C.AppHeader><C.AppRow><C.AppPanel><C.AppPanelTitle>Add task</C.AppPanelTitle><C.AppTextInput value={draft} onChange={setDraft} placeholder="New task" /><C.AppNavItem onPress={addTask}><C.AppNavText>Add</C.AppNavText></C.AppNavItem></C.AppPanel><C.AppPanel>{tasks.map((task, index) => <C.AppBadge key={task + index}><C.AppBadgeText>{index + 1}. {task}</C.AppBadgeText></C.AppBadge>)}</C.AppPanel></C.AppRow></C.AppShell></C.AppRoot></ThemeProvider>;
}
`;
  }
  function canvasIndex(ctx) {
    return `import { Canvas } from '${ctx.primitivesImport}';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

export default function App() {
  return <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}><C.AppRoot><C.AppShell><C.AppHeader><C.AppTitleBlock><C.AppKicker>CANVAS</C.AppKicker><C.AppTitle>${ctx.title}</C.AppTitle></C.AppTitleBlock></C.AppHeader><C.AppCanvasFrame><Canvas style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1}><Canvas.Path d="M 40 120 C 140 20 260 220 360 70" stroke="#4ea1ff" strokeWidth={3} fill="none" /><Canvas.Node gx={52} gy={48} gw={120} gh={72}><C.AppBadge><C.AppBadgeText>Canvas.Node</C.AppBadgeText></C.AppBadge></Canvas.Node></Canvas></C.AppCanvasFrame></C.AppShell></C.AppRoot></ThemeProvider>;
}
`;
  }
  function stdlibIndex(ctx) {
    return `import { Canvas, Graph } from '${ctx.primitivesImport}';
import { Icon } from '${ctx.iconImport}';
import { Activity, Boxes, ChartLine, Film, Waypoints } from '${ctx.iconPackImport}';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

const icons = [Activity, Boxes, ChartLine, Film, Waypoints];

export default function App() {
  return <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}><C.AppRoot><C.AppShell><C.AppHeader><C.AppTitleBlock><C.AppKicker>REACTJIT STDLIB</C.AppKicker><C.AppTitle>${ctx.title}</C.AppTitle></C.AppTitleBlock></C.AppHeader><C.AppRow>{icons.map((icon, index) => <C.AppBadge key={index}><Icon icon={icon} size={18} color="#ffd166" /></C.AppBadge>)}</C.AppRow><C.AppRow style={{ flexGrow: 1, flexBasis: 0 }}><C.AppCanvasFrame><Canvas style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1}><Canvas.Path d="M 40 120 C 140 20 260 220 360 70" stroke="#4ea1ff" strokeWidth={3} fill="none" /></Canvas></C.AppCanvasFrame><C.AppCanvasFrame><Graph style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1}><Graph.Path d="M -150 60 L -90 -20 L -30 20 L 30 -80 L 90 -10 L 150 -50" stroke="#72d391" strokeWidth={3} fill="none" /></Graph></C.AppCanvasFrame></C.AppRow></C.AppShell></C.AppRoot></ThemeProvider>;
}
`;
  }
  function mediaReadme() {
    return "# Media\n\nPut a video file at `sample.mp4` or update the `<video src>` in `index.tsx`.\n";
  }
  var TEMPLATES2 = {
    basic: { description: "Basic ReactJIT starter", width: 900, height: 640, files: (ctx) => ({ "index.tsx": basicIndex(ctx) }) },
    routes: { description: "Routed ReactJIT starter with classifier theme styles", width: 980, height: 680, files: (ctx) => ({ "index.tsx": routedIndex(ctx, "routed cart"), "theme.ts": themeSource(ctx.themeImport), "style.cls.ts": styleClsSource(ctx.classifierImport) }) },
    dashboard: { description: "Dashboard ReactJIT starter with classifier theme styles", width: 1100, height: 760, files: (ctx) => ({ "index.tsx": routedIndex(ctx, "dashboard"), "theme.ts": themeSource(ctx.themeImport), "style.cls.ts": styleClsSource(ctx.classifierImport) }) },
    taskboard: { description: "Taskboard ReactJIT starter with classifier theme styles", width: 980, height: 700, files: (ctx) => ({ "index.tsx": taskboardIndex(ctx), "theme.ts": themeSource(ctx.themeImport), "style.cls.ts": styleClsSource(ctx.classifierImport) }) },
    canvas: { description: "Canvas ReactJIT starter with classifier theme styles", width: 1120, height: 760, files: (ctx) => ({ "index.tsx": canvasIndex(ctx), "theme.ts": themeSource(ctx.themeImport), "style.cls.ts": styleClsSource(ctx.classifierImport) }) },
    stdlib: { description: "ReactJIT stdlib starter with base icons and media primitives", width: 1180, height: 820, files: (ctx) => ({ "index.tsx": stdlibIndex(ctx), "theme.ts": themeSource(ctx.themeImport), "style.cls.ts": styleClsSource(ctx.classifierImport), "media/README.md": mediaReadme() }) }
  };

  // cli/commands/lab.ts
  var lab_exports = {};
  __export(lab_exports, {
    run: () => run17
  });
  var LABS_DIR = "cart/hmsc-int/labs";
  var SCAFFOLD_SCENE = `${LABS_DIR}/_scaffold.tsx`;
  var SCAFFOLD_NOTES = `${LABS_DIR}/_scaffold.notes.md`;
  var REGISTRY = `${LABS_DIR}/index.ts`;
  var IMPORTS_MARKER = "// rjit:lab-imports";
  var ENTRIES_MARKER = "// rjit:lab-entries";
  async function run17(argv) {
    if (argv[0] !== "new" && argv[0] !== "remove") {
      err("Usage: rjit lab new <name>");
      err("       rjit lab remove <name>");
      err("  scaffolds labs/<name>.tsx + labs/<name>.notes.md and registers the lab");
      err("  removes labs/<name>.tsx + labs/<name>.notes.md and unregisters the lab");
      return 2;
    }
    const name = argv[1];
    if (!name || !/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
      err(`[lab] name must be kebab-case (got ${JSON.stringify(name ?? "")}) \u2014 e.g. projectile-shapes`);
      return 2;
    }
    const root = __cwd();
    const scenePath = `${LABS_DIR}/${name}.tsx`;
    const notesPath = `${LABS_DIR}/${name}.notes.md`;
    if (argv[0] === "remove") {
      return removeLab(root, name, scenePath, notesPath);
    }
    if (fsExists(`${root}/${scenePath}`) || fsExists(`${root}/${notesPath}`)) {
      err(`[lab] ${name} already exists (${scenePath})`);
      return 1;
    }
    const componentName = pascalCase(name);
    const today = new Date(__nowMs()).toISOString().slice(0, 10);
    const scene = fsRead(`${root}/${SCAFFOLD_SCENE}`).replaceAll("__LAB_NAME__", name).replaceAll("ScaffoldLab", componentName);
    const notes = fsRead(`${root}/${SCAFFOLD_NOTES}`).replaceAll("__LAB_NAME__", name).replaceAll("__CREATED_DATE__", today);
    const registry = fsRead(`${root}/${REGISTRY}`);
    if (!registry.includes(IMPORTS_MARKER) || !registry.includes(ENTRIES_MARKER)) {
      err(`[lab] ${REGISTRY} is missing its rjit markers \u2014 restore them before scaffolding`);
      return 1;
    }
    const registered = registry.replace(IMPORTS_MARKER, `import ${componentName} from './${name}';
${IMPORTS_MARKER}`).replace(
      `  ${ENTRIES_MARKER}`,
      `  { name: '${name}', Component: ${componentName}, notesPath: '${notesPath}' },
  ${ENTRIES_MARKER}`
    );
    fsWrite(`${root}/${scenePath}`, scene);
    fsWrite(`${root}/${notesPath}`, notes);
    fsWrite(`${root}/${REGISTRY}`, registered);
    out(`[lab] scaffolded ${scenePath}`);
    out(`[lab] paired notes ${notesPath}`);
    out(`[lab] registered "${name}" in ${REGISTRY} \u2014 it lists on the labs route`);
    return 0;
  }
  function removeLab(root, name, scenePath, notesPath) {
    const componentName = pascalCase(name);
    const registry = fsRead(`${root}/${REGISTRY}`);
    if (!registry.includes(IMPORTS_MARKER) || !registry.includes(ENTRIES_MARKER)) {
      err(`[lab] ${REGISTRY} is missing its rjit markers \u2014 restore them before removing labs`);
      return 1;
    }
    const sceneExists = fsExists(`${root}/${scenePath}`);
    const notesExists = fsExists(`${root}/${notesPath}`);
    const importLine = `import ${componentName} from './${name}';
`;
    const entryLine = `  { name: '${name}', Component: ${componentName}, notesPath: '${notesPath}' },
`;
    const importRegistered = registry.includes(importLine);
    const entryRegistered = registry.includes(entryLine);
    if (!sceneExists && !notesExists && !importRegistered && !entryRegistered) {
      err(`[lab] ${name} does not exist`);
      return 1;
    }
    if (!sceneExists || !notesExists || !importRegistered || !entryRegistered) {
      err(`[lab] ${name} is not a clean lab scaffold \u2014 expected ${scenePath}, ${notesPath}, and registry rows`);
      return 1;
    }
    fsRemove(`${root}/${scenePath}`);
    fsRemove(`${root}/${notesPath}`);
    fsWrite(`${root}/${REGISTRY}`, registry.replace(importLine, "").replace(entryLine, ""));
    out(`[lab] removed ${scenePath}`);
    out(`[lab] removed paired notes ${notesPath}`);
    out(`[lab] unregistered "${name}" from ${REGISTRY}`);
    return 0;
  }
  function pascalCase(kebab) {
    return kebab.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  }

  // cli/commands/metafile-gate.ts
  var metafile_gate_exports = {};
  __export(metafile_gate_exports, {
    run: () => run18
  });

  // cli/cart/metafile.ts
  function loadMetafile(path) {
    return fsReadJson(path);
  }
  function shippedInputs(meta) {
    const shipped = /* @__PURE__ */ new Set();
    for (const output of Object.values(meta.outputs ?? {})) {
      for (const [path, info] of Object.entries(output.inputs ?? {})) {
        if (info.bytesInOutput > 0) shipped.add(path);
      }
    }
    return shipped;
  }

  // cli/registry/schema.ts
  var SHIP_GATE_FLAGS = [
    "privacy",
    "useHost",
    "useConnection",
    "fs",
    "websocket",
    "telemetry",
    "zigcall",
    "sdk",
    "voice",
    "audio_input",
    "whisper",
    "paintable",
    "onnx",
    "pg",
    "embed",
    "sqlite",
    "terminal",
    "process",
    "window",
    "doom"
  ];
  function emptyGateFlags() {
    const out2 = {};
    for (const flag of SHIP_GATE_FLAGS) out2[flag] = false;
    return out2;
  }
  function gateFlagsToPositional(gates, order) {
    return order.map((name) => gates[name] ? "1" : "0").join(" ");
  }

  // cli/registry/load.ts
  function loadRegistry2(path = "sdk/dependency-registry.json", tag = "registry") {
    const registry = fsReadJson(path);
    validateRegistry(registry, path, tag);
    return registry;
  }
  function validateRegistry(registry, path, tag) {
    if (registry.schemaVersion !== 1) die(tag, `${path}: unsupported schemaVersion ${registry.schemaVersion}`);
    if (!registry.shipGate || !Array.isArray(registry.shipGate.flagOrder) || registry.shipGate.flagOrder.length === 0) {
      die(tag, `${path}: registry has no shipGate.flagOrder`);
    }
    const knownFlags = new Set(SHIP_GATE_FLAGS);
    for (const flag of registry.shipGate.flagOrder) {
      if (!knownFlags.has(flag)) die(tag, `${path}: unknown gate flag ${flag}`);
    }
    if (registry.shipGate.flagOrder.length !== SHIP_GATE_FLAGS.length) {
      die(tag, `${path}: shipGate.flagOrder length drift: schema has ${SHIP_GATE_FLAGS.length}, JSON has ${registry.shipGate.flagOrder.length}`);
    }
    for (const [featureName, feature] of Object.entries(registry.features ?? {})) {
      for (const lib of feature.nativeLibraries ?? []) {
        if (!(lib in registry.nativeLibraries)) die(tag, `${path}: feature '${featureName}' references missing nativeLibrary '${lib}'`);
      }
      for (const tool of feature.tools ?? []) {
        if (!(tool in registry.cliPayload.tools)) die(tag, `${path}: feature '${featureName}' references missing tool '${tool}'`);
      }
      for (const pkg of feature.jsPackages ?? []) {
        if (!(pkg in registry.cliPayload.jsPackages)) die(tag, `${path}: feature '${featureName}' references missing jsPackage '${pkg}'`);
      }
      if (feature.shipGate && !knownFlags.has(feature.shipGate)) {
        die(tag, `${path}: feature '${featureName}' references unknown shipGate '${feature.shipGate}'`);
      }
    }
  }

  // cli/registry/resolve.ts
  function resolveFeatures(registry, metafile) {
    const shipped = metafile ? shippedInputs(metafile) : /* @__PURE__ */ new Set();
    const selection = {
      features: [],
      buildOptions: /* @__PURE__ */ new Set(),
      v8Bindings: /* @__PURE__ */ new Set(),
      nativeLibraries: /* @__PURE__ */ new Set(),
      tools: /* @__PURE__ */ new Set(),
      jsPackages: /* @__PURE__ */ new Set(),
      gateFlags: emptyGateFlags()
    };
    for (const [featureName, feature] of Object.entries(registry.features ?? {})) {
      const triggers = feature.triggers ?? [];
      const required = (feature.requiredFor ?? []).length > 0;
      const matched = required || triggers.some((trigger) => triggerMatched(trigger, shipped));
      if (!matched) continue;
      selection.features.push(featureName);
      addAll(selection.buildOptions, feature.buildOptions);
      addAll(selection.v8Bindings, feature.v8Bindings);
      addAll(selection.nativeLibraries, feature.nativeLibraries);
      addAll(selection.tools, feature.tools);
      addAll(selection.jsPackages, feature.jsPackages);
      if (feature.shipGate) selection.gateFlags[feature.shipGate] = true;
    }
    return selection;
  }
  function triggerMatched(trigger, shipped) {
    if (!trigger.kind || !trigger.input) return false;
    if (trigger.kind === "metafileInput" || trigger.kind === "featureMarker") return shipped.has(trigger.input);
    if (trigger.kind === "metafileInputPrefix") {
      for (const path of shipped) {
        if (path.startsWith(trigger.input)) return true;
      }
    }
    return false;
  }
  function addAll(set, values) {
    for (const value of values ?? []) set.add(value);
  }

  // cli/commands/metafile-gate.ts
  async function run18(argv) {
    let registryPath = "sdk/dependency-registry.json";
    let metafilePath = "";
    let format = "ship-gate";
    let buildZigPath = "build.zig";
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--registry") {
        registryPath = argv[++i] ?? "";
      } else if (arg === "--metafile") {
        metafilePath = argv[++i] ?? "";
      } else if (arg === "--format") {
        const value = argv[++i] ?? "";
        if (!isFormat(value)) {
          err(`[metafile-gate] unsupported format: ${value}`);
          return 1;
        }
        format = value;
      } else if (arg === "--build-zig") {
        buildZigPath = argv[++i] ?? "";
      } else if (!arg.startsWith("-") && !metafilePath) {
        metafilePath = arg;
      } else {
        err(`[metafile-gate] unknown argument: ${arg}`);
        return 1;
      }
    }
    if (!metafilePath && format !== "dev-zig-flags") {
      err("[metafile-gate] usage: metafile-gate [--registry path] --metafile path [--format json|ship-gate|zig-flags|dev-zig-flags]");
      return 1;
    }
    const registry = loadRegistry2(registryPath, "metafile-gate");
    const metafile = metafilePath ? loadMetafile(metafilePath) : null;
    const selection = resolveFeatures(registry, metafile);
    if (format === "ship-gate") {
      out(gateFlagsToPositional(selection.gateFlags, registry.shipGate.flagOrder));
    } else if (format === "zig-flags") {
      out(Array.from(selection.buildOptions).map((name) => `-D${name}=true`).join(" "));
    } else if (format === "dev-zig-flags") {
      out(devZigFlags(registry, buildZigPath));
    } else {
      out(JSON.stringify({
        metafile: metafilePath,
        features: selection.features,
        buildOptions: Array.from(selection.buildOptions),
        v8Bindings: Array.from(selection.v8Bindings),
        nativeLibraries: Array.from(selection.nativeLibraries),
        tools: Array.from(selection.tools),
        jsPackages: Array.from(selection.jsPackages),
        shipGate: gatesObject(registry, selection.gateFlags)
      }, null, 2));
    }
    return 0;
  }
  function isFormat(value) {
    return value === "json" || value === "ship-gate" || value === "zig-flags" || value === "dev-zig-flags";
  }
  function devZigFlags(registry, buildZigPath) {
    const buildZig = fsRead(buildZigPath);
    const declared = /* @__PURE__ */ new Set();
    const re = /b\.option\s*\([\s\S]*?"([^"]+)"/g;
    let match;
    while ((match = re.exec(buildZig)) !== null) declared.add(match[1]);
    const allBuildOptions = /* @__PURE__ */ new Set(["use-v8", "dev-mode"]);
    for (const feature of Object.values(registry.features ?? {})) {
      for (const option of feature.buildOptions ?? []) allBuildOptions.add(option);
    }
    if (allBuildOptions.has("has-embed") && allBuildOptions.has("has-whisper")) {
      allBuildOptions.delete("has-whisper");
      err("[sdk-dependency-resolve] dev: dropping has-whisper (conflicts with has-embed; both bundle ggml)");
    }
    const flags = [];
    for (const name of allBuildOptions) {
      if (declared.has(name)) flags.push(`-D${name}=true`);
    }
    return flags.join(" ");
  }
  function gatesObject(registry, gates) {
    const out2 = {};
    for (const feature of Object.values(registry.features ?? {})) {
      if (feature.shipGate && gates[feature.shipGate]) out2[feature.shipGate] = true;
    }
    return out2;
  }

  // cli/commands/pack.ts
  var pack_exports = {};
  __export(pack_exports, {
    run: () => run19
  });
  async function run19(argv) {
    const name = argv[0];
    let outDir = "";
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--out" || arg === "-o") {
        outDir = argv[++i] ?? "";
      } else {
        return usage4(`unknown argument: ${arg}`);
      }
    }
    if (!name) return usage4("missing package name");
    if (name !== "hmsc") return usage4(`unsupported package for slice 1: ${name}`);
    const root = __cwd();
    const rjitHome = __env("RJIT_HOME") || root;
    const packageDir = outDir || `${root}/cart/hmsc-int/exports/hmsc.rjpkg`;
    fsMkdir(packageDir);
    const helperOut = `${root}/zig-out/game/hmsc-pack-package.js`;
    fsMkdir(`${root}/zig-out/game`);
    const helper = spawnSync(`${root}/tools/esbuild`, [
      `${root}/cart/hmsc-int/compile/packPackage.ts`,
      "--bundle",
      `--outfile=${helperOut}`,
      "--format=iife",
      "--platform=neutral",
      "--target=es2022",
      `--alias:@reactjit=${root}/runtime`,
      "--log-level=warning"
    ]);
    writeSpawnOutput4(helper);
    if (helper.code !== 0) return helper.code || 1;
    const runHelper = spawnSync(`${root}/tools/v8cli`, [helperOut]);
    if (runHelper.stderr) __writeStderr(runHelper.stderr);
    if (runHelper.code !== 0) return runHelper.code || 1;
    const emitted = JSON.parse(runHelper.stdout);
    fsMkdir(`${packageDir}/maps`);
    fsMkdir(`${packageDir}/assets`);
    fsWrite(`${packageDir}/manifest.json`, `${JSON.stringify(emitted.manifest, null, 2)}
`);
    const mapPath = `${packageDir}/maps/city.map`;
    const mapWrite = spawnSync("sh", ["-c", `base64 -d > ${shellQuote2(mapPath)}`], emitted.mapBase64);
    writeSpawnOutput4(mapWrite);
    if (mapWrite.code !== 0) return mapWrite.code || 1;
    const bundleOut = `${packageDir}/bundle.js`;
    const bundle2 = bundleCart({
      rjitHome,
      cartEntry: `${root}/cart/hmsc-int/gameShell.tsx`,
      outFile: bundleOut,
      mode: "cartridge"
    });
    writeSpawnOutput4(bundle2);
    if (bundle2.code !== 0) return bundle2.code || 1;
    out(`[pack] done -> ${packageDir}`);
    return 0;
  }
  function usage4(message) {
    err(`[pack] ${message}`);
    err("Usage: rjit pack hmsc [--out path/to/hmsc.rjpkg]");
    return 2;
  }
  function writeSpawnOutput4(result) {
    if (result.stdout) __writeStdout(result.stdout);
    if (result.stderr) __writeStderr(result.stderr);
  }
  function shellQuote2(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  // cli/commands/pack-sdk.ts
  var pack_sdk_exports = {};
  __export(pack_sdk_exports, {
    run: () => run20
  });
  var ROOT = __cwd();
  var EXCLUDES = [
    ".zig-cache",
    "zig-cache",
    "zig-out",
    ".cache",
    "node_modules",
    "__pycache__",
    ".DS_Store"
  ];
  var SOURCE_TREES = [
    "framework",
    "runtime",
    "renderer",
    "cli",
    "scripts",
    "sdk",
    "vendor",
    "stb"
    // 'love2d/quickjs' was here for the QJS bridge. The directory does not exist in the
    // checkout (gitignored build output) so the fsExists guard always skipped it, and love2d
    // is now archive/love2d.zip. QJS is legacy maintenance-only; V8 is the default runtime.
  ];
  var ZIG_PATH_DEPS = [
    "deps/tls.zig",
    "deps/wgpu_native_zig",
    "deps/zig-v8",
    "deps/sysroot"
  ];
  var TOP_LEVEL_FILES = [
    "build.zig",
    "build.zig.zon"
  ];
  var SKIP_FAMILIES = [
    /^libc\.so\./,
    /^libm\.so\./,
    /^libpthread\.so\./,
    /^libdl\.so\./,
    /^libresolv\.so\./,
    /^ld-linux/,
    /^linux-vdso/,
    /^libX11\.so\./,
    /^libXext\.so\./,
    /^libXcursor\.so\./,
    /^libXi\.so\./,
    /^libXfixes\.so\./,
    /^libXrandr\.so\./,
    /^libXss\.so\./,
    /^libXrender\.so\./,
    /^libxcb\.so\./,
    /^libxcb-/
  ];
  var GLIBC_FAMILY = [
    "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2",
    "/lib/x86_64-linux-gnu/libc.so.6",
    "/lib/x86_64-linux-gnu/libm.so.6",
    "/lib/x86_64-linux-gnu/libpthread.so.0",
    "/lib/x86_64-linux-gnu/libdl.so.2",
    "/lib/x86_64-linux-gnu/libresolv.so.2",
    "/lib64/ld-linux-x86-64.so.2"
  ];
  async function run20(argv) {
    const parsed = parsePackArgs(argv);
    if (typeof parsed === "number") return parsed;
    const registryPath = `${ROOT}/sdk/dependency-registry.json`;
    if (!fsExists(registryPath)) return fail8(`registry missing: ${registryPath}`, 1);
    const registry = fsReadJson(registryPath);
    const stage = `/tmp/rjit-stage-${Date.now()}`;
    fsMkdir(stage);
    log3(`staging at ${stage}`);
    try {
      stageSourceTrees(stage);
      stageZigDeps(stage);
      stageTopLevelFiles(stage);
      stageToolchain(stage, registry);
      stageRjitTool(stage);
      stageSdlDeps(stage);
      stageGlibc(stage);
      stageZigPackageCache(stage);
      const missing = stageAlwaysNativeLibraries(stage, registry);
      if (missing.length) {
        for (const item of missing) err(`  - ${item}`);
        return fail8("cannot pack SDK with missing foundational libs", 3);
      }
      const tarball = `/tmp/rjit-payload-${Date.now()}.tar.gz`;
      log3(`compressing -> ${tarball}`);
      shOrDie("sh", ["-c", `cd '${stage}' && tar czf '${tarball}' .`], "tar");
      writeSelfExtractor(parsed.outPath, tarball);
      if (!parsed.keepStage) {
        fsRemove(stage);
        fsRemove(tarball);
      }
      const sizeOut = sh("du", ["-h", parsed.outPath]).stdout.trim().split(/\s+/)[0] ?? "?";
      log3(`done -> ${parsed.outPath} (${sizeOut})`);
      return 0;
    } catch (error) {
      if (!parsed.keepStage) fsRemove(stage);
      throw error;
    }
  }
  function parsePackArgs(argv) {
    let outPath = `${ROOT}/dist/rjit`;
    let keepStage = false;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--out" || arg === "-o") {
        const value = argv[++i];
        if (!value) return fail8("flag requires value: --out", 2);
        outPath = value;
      } else if (arg === "--keep-stage") {
        keepStage = true;
      } else if (arg === "--help" || arg === "-h") {
        out("Usage: rjit pack-sdk [--out path] [--keep-stage]");
        return 0;
      } else {
        return fail8(`unknown flag: ${arg}`, 2);
      }
    }
    if (!outPath.startsWith("/")) outPath = `${ROOT}/${outPath}`;
    return { outPath, keepStage };
  }
  function stageSourceTrees(stage) {
    for (const sub2 of SOURCE_TREES) {
      if (!fsExists(`${ROOT}/${sub2}`)) continue;
      log3(`copy ${sub2}/`);
      copyTree(`${ROOT}/${sub2}`, `${stage}/${sub2}`, sub2);
    }
  }
  function stageZigDeps(stage) {
    for (const sub2 of ZIG_PATH_DEPS) {
      if (!fsExists(`${ROOT}/${sub2}`)) continue;
      log3(`copy ${sub2}/`);
      copyTree(`${ROOT}/${sub2}`, `${stage}/${sub2}`, sub2);
    }
  }
  function stageTopLevelFiles(stage) {
    for (const file of TOP_LEVEL_FILES) {
      if (!fsExists(`${ROOT}/${file}`)) continue;
      log3(`copy ${file}`);
      copyFile(`${ROOT}/${file}`, `${stage}/${file}`);
    }
  }
  function stageToolchain(stage, registry) {
    const tools = registry.cliPayload?.tools ?? {};
    for (const [name, spec] of Object.entries(tools)) {
      if (spec.packPolicy === "optional") continue;
      if (spec.payloadPath) {
        log3(`tool ${name} <- ${spec.payloadPath}`);
        copyFile(`${ROOT}/${spec.payloadPath}`, `${stage}/${spec.payloadPath}`);
      }
      for (const supportPath of spec.supportPaths ?? []) {
        if (!fsExists(`${ROOT}/${supportPath}`)) continue;
        log3(`tool ${name} support <- ${supportPath}`);
        copyTree(`${ROOT}/${supportPath}`, `${stage}/${supportPath}`, supportPath);
      }
    }
  }
  function stageRjitTool(stage) {
    for (const file of ["tools/rjit", "tools/rjit.js"]) {
      if (!fsExists(`${ROOT}/${file}`)) throw new Error(`missing rjit tool payload: ${file}`);
      log3(`tool rjit <- ${file}`);
      copyFile(`${ROOT}/${file}`, `${stage}/${file}`);
    }
  }
  function stageSdlDeps(stage) {
    const sysrootLib = `${stage}/deps/sysroot/usr/lib`;
    fsMkdir(sysrootLib);
    const sdlHostPath = "/lib/x86_64-linux-gnu/libSDL3.so.0";
    if (!fsExists(sdlHostPath)) return;
    const lddOut = sh("ldd", [sdlHostPath]).stdout;
    for (const line of lddOut.split("\n")) {
      const match = /^\s*(\S+)\s*=>\s*(\S+)/.exec(line);
      if (!match) continue;
      const soname = match[1];
      const libPath = match[2];
      if (libPath === "not" || !fsExists(libPath)) continue;
      if (SKIP_FAMILIES.some((rx) => rx.test(soname))) continue;
      const realPath = sh("readlink", ["-f", libPath]).stdout.trim() || libPath;
      const dest = `${sysrootLib}/${soname}`;
      if (fsExists(dest)) continue;
      copyFile(realPath, dest);
      log3(`SDL3 dep ${soname} <- ${realPath}`);
    }
  }
  function stageGlibc(stage) {
    const sysrootLib = `${stage}/deps/sysroot/usr/lib`;
    fsMkdir(sysrootLib);
    for (const path of GLIBC_FAMILY) {
      if (!fsExists(path)) continue;
      const realPath = sh("readlink", ["-f", path]).stdout.trim() || path;
      const baseName = path.replace(/^.*\//, "");
      const dest = `${sysrootLib}/${baseName}`;
      if (fsExists(dest)) continue;
      log3(`glibc ${baseName} <- ${realPath}`);
      copyFile(realPath, dest);
    }
  }
  function stageZigPackageCache(stage) {
    const hostZigCache = `${__env("HOME") || "/root"}/.cache/zig/p`;
    if (!fsExists(hostZigCache)) {
      err(`[pack-sdk] WARN: ${hostZigCache} missing - packed SDK may fail to find zluajit/wgpu prebuilt archives offline.`);
      return;
    }
    log3(`zig pkg cache <- ${hostZigCache}`);
    fsMkdir(`${stage}/tools/zig/cache/p`);
    shOrDie("rsync", [
      "-a",
      "--exclude=.zig-cache",
      "--exclude=zig-out",
      `${hostZigCache}/`,
      `${stage}/tools/zig/cache/p/`
    ], "rsync zig pkg cache");
  }
  function stageAlwaysNativeLibraries(stage, registry) {
    const missing = [];
    const nativeLibs = registry.nativeLibraries ?? {};
    for (const [name, spec] of Object.entries(nativeLibs)) {
      if (spec.bundlePolicy !== "always") continue;
      if (spec.kind !== "static-library" && spec.kind !== "zig-package") continue;
      if (!spec.payloadPath) {
        missing.push(`${name} (kind=${spec.kind}, no payloadPath)`);
        continue;
      }
      const payloads = Array.isArray(spec.payloadPath) ? spec.payloadPath : [spec.payloadPath];
      for (const payloadPath of payloads) {
        const src = `${ROOT}/${payloadPath}`;
        if (!fsExists(src)) {
          missing.push(`${name} (${payloadPath} missing)`);
          continue;
        }
        log3(`native ${name} <- ${payloadPath}`);
        const stat = tryFsStat(src);
        if (stat?.isDir) copyTree(src, `${stage}/${payloadPath}`, name);
        else copyFile(src, `${stage}/${payloadPath}`);
      }
    }
    return missing;
  }
  function writeSelfExtractor(outPath, tarball) {
    const wrapper = [
      "#!/bin/sh",
      "set -e",
      'SELF="$0"',
      'CMD="${1:-help}"',
      '[ "$#" -gt 0 ] && shift',
      "CACHE_HOME=${XDG_CACHE_HOME:-$HOME/.cache}",
      "APP_DIR=$CACHE_HOME/rjit",
      'SIG=$(md5sum "$SELF" 2>/dev/null | cut -c1-8 || cksum "$SELF" | cut -d" " -f1)',
      "CACHE=$APP_DIR/$SIG",
      'if [ ! -f "$CACHE/.ready" ]; then',
      '  rm -rf "$APP_DIR"',
      '  mkdir -p "$CACHE"',
      `  SKIP=$(awk '/^__ARCHIVE__$/{print NR + 1; exit}' "$SELF")`,
      '  tail -n+"$SKIP" "$SELF" | tar xz -C "$CACHE"',
      '  touch "$CACHE/.ready"',
      "fi",
      'export RJIT_HOME="$CACHE"',
      "# Do not export LD_LIBRARY_PATH here. The sysroot libraries are for",
      "# shipped cart launchers, not for the rjit dispatcher process itself.",
      'case "$CMD" in',
      '  help|--help|-h) exec "$CACHE/tools/rjit" help "$@" ;;',
      '  *) exec "$CACHE/tools/rjit" "$CMD" "$@" ;;',
      "esac",
      "__ARCHIVE__",
      ""
    ].join("\n");
    fsMkdir(outPath.replace(/\/[^/]+$/, ""));
    const staged = `${outPath}.staged`;
    if (fsExists(staged)) fsRemove(staged);
    fsWrite(staged, wrapper);
    shOrDie("sh", ["-c", `cat '${tarball}' >> '${staged}'`], "concat");
    shOrDie("chmod", ["+x", staged], "chmod");
    shOrDie("mv", ["-f", staged, outPath], "mv");
  }
  function copyTree(srcAbs, destAbs, label) {
    if (!fsExists(srcAbs)) throw new Error(`missing payload: ${label || srcAbs}`);
    fsMkdir(destAbs.replace(/\/[^/]+$/, ""));
    const args = ["-a"];
    for (const exclude of EXCLUDES) args.push(`--exclude=${exclude}`);
    args.push(`${srcAbs}/`, `${destAbs}/`);
    fsMkdir(destAbs);
    shOrDie("rsync", args, `rsync ${label || srcAbs}`);
  }
  function copyFile(srcAbs, destAbs) {
    if (!fsExists(srcAbs)) throw new Error(`missing file: ${srcAbs}`);
    fsMkdir(destAbs.replace(/\/[^/]+$/, ""));
    shOrDie("cp", ["-a", srcAbs, destAbs], `cp ${srcAbs}`);
  }
  function sh(cmd, args, stdin = "") {
    return spawnSync(cmd, args, stdin);
  }
  function shOrDie(cmd, args, label) {
    const result = sh(cmd, args);
    if (result.code !== 0) {
      if (result.stderr) __writeStderr(result.stderr);
      throw new Error(`${label || cmd} failed (code ${result.code})`);
    }
    return result;
  }
  function log3(message) {
    out(`[pack-sdk] ${message}`);
  }
  function fail8(message, code) {
    err(`[pack-sdk] ${message}`);
    return code;
  }

  // cli/commands/play.ts
  var play_exports = {};
  __export(play_exports, {
    run: () => run21
  });
  async function run21(argv) {
    const pkg = argv[0];
    if (!pkg || argv.length > 1) return usage5(pkg ? "too many arguments" : "missing package path");
    const root = __cwd();
    const binary = `${root}/zig-out/bin/rjit-player`;
    if (!fsExists(binary)) {
      out("[play] rjit-player binary missing \u2014 building via rjit ship...");
      const build = spawnSync("env", ["SHIP_RUN_PACKAGE=0", `${root}/tools/rjit`, "ship", "rjit-player"]);
      writeSpawnOutput5(build);
      if (build.code !== 0) return build.code || 1;
    }
    const result = spawnSync(binary, [pkg]);
    writeSpawnOutput5(result);
    return result.code;
  }
  function usage5(message) {
    err(`[play] ${message}`);
    err("Usage: rjit play path/to/game.rjpkg");
    return 2;
  }
  function writeSpawnOutput5(result) {
    if (result.stdout) __writeStdout(result.stdout);
    if (result.stderr) __writeStderr(result.stderr);
  }

  // cli/commands/push-bundle.ts
  var push_bundle_exports = {};
  __export(push_bundle_exports, {
    run: () => run22
  });
  var SOCKET_PATH = __env("RJIT_DEV_SOCKET_PATH") || "/tmp/reactjit.sock";
  var TIMEOUT_MS2 = 3e3;
  async function run22(argv) {
    let parsed;
    try {
      parsed = parseArgs(argv.slice(0, 2), { positional: ["tabName", "bundlePath"] });
    } catch (error) {
      err(`[push-bundle] ${error.message}`);
      return 1;
    }
    const tabName = parsed.positional.tabName;
    const bundlePath = parsed.positional.bundlePath;
    if (!tabName || !bundlePath) {
      err("[push-bundle] usage: push-bundle.js <tab-name> <bundle-path>");
      return 1;
    }
    const bundle2 = tryFsRead(bundlePath);
    if (bundle2 === null) {
      err(`[push-bundle] cannot read ${bundlePath}`);
      return 1;
    }
    if (!fsExists(SOCKET_PATH)) return 2;
    const fd = tryUnixConnect(SOCKET_PATH);
    if (fd === null) return 2;
    try {
      try {
        unixWrite(fd, `PUSH ${tabName} ${utf8ByteLength3(bundle2)}
`);
      } catch (error) {
        if (error instanceof SocketError) {
          err("[push-bundle] write header failed");
          return 1;
        }
        throw error;
      }
      try {
        unixWrite(fd, bundle2);
      } catch (error) {
        if (error instanceof SocketError) {
          err("[push-bundle] write bundle failed");
          return 1;
        }
        throw error;
      }
      const line = unixReadLine(fd, __nowMs() + TIMEOUT_MS2).trim();
      if (line.startsWith("OK")) return 0;
      err(`[push-bundle] host error: ${line}`);
      return 1;
    } catch (error) {
      if (error instanceof SocketError && error.message === "timeout") {
        err(`[push-bundle] timeout waiting for host @ ${SOCKET_PATH}`);
        return 2;
      }
      if (error instanceof SocketError && error.message === "EOF before newline") {
        err("[push-bundle] host closed connection before ack");
        return 1;
      }
      throw error;
    } finally {
      unixClose(fd);
    }
  }
  function utf8ByteLength3(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 128) bytes += 1;
      else if (code < 2048) bytes += 2;
      else if (code >= 55296 && code <= 56319) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  // cli/commands/repo.ts
  var repo_exports = {};
  __export(repo_exports, {
    run: () => run23
  });

  // cli/dev/publishable.ts
  var PUBLISH_RULES = [
    // ── Published: what a fresh clone needs to build and understand this project ──────────
    {
      path: "framework",
      kind: "source",
      what: "Zig runtime \u2014 layout, engine, GPU, events, input, state, effects, text, windows"
    },
    { path: "runtime", kind: "source", what: "JS cart-facing layer \u2014 JSX shim, primitives, hooks, host globals" },
    { path: "renderer", kind: "source", what: "reconciler host config \u2014 emits the CREATE/APPEND/UPDATE stream" },
    // cart/ is deliberately NOT source as a whole. USER RULING (req_4096): "the only one
    // we're working on is editor/, so everything else can be archived." cart/editor is the
    // active surface (V32) and publishes; the other ~130 carts are previous eras. A NEW cart
    // therefore reports as frozen until someone declares it source — which is the allowlist
    // working as intended: it asks, rather than silently publishing whatever lands in cart/.
    { path: "cart/editor", kind: "source", what: "THE active surface (V32) \u2014 the editor cart and its /play route" },
    {
      path: "cart",
      kind: "frozen",
      what: "previous-era carts \u2014 labs, demos, probes, chat clients, hmsc-int. Only cart/editor is worked on",
      insteadOf: "archive/carts-legacy.zip (tracked source only \u2014 cart/hmsc-int alone is 7.4GB on disk against 9.9MB in git)"
    },
    { path: "docs", kind: "source", what: "the game knowledge layer \u2014 DECISIONS.md, per-cart audits, _index/, _requests/" },
    { path: "plan", kind: "source", what: "architectural execution and closure records needed to understand landed systems" },
    { path: "cli", kind: "source", what: "rjit CLI source \u2014 tools/rjit.js is BUILT from here, this is the truth" },
    { path: "scripts", kind: "source", what: "build pipeline + git hooks \u2014 cart-bundle.js, fetch-*, install-hooks" },
    { path: "tools", kind: "source", what: "agent entry points \u2014 rjit, seat, oracle, request, parity harnesses" },
    { path: "tui", kind: "source", what: "TUI stack" },
    { path: "sdk", kind: "source", what: "packaged SDK surface" },
    { path: "stb", kind: "source", what: "vendored single-header C libs \u2014 build.zig adds these include paths" },
    { path: "deps", kind: "source", what: "external deps the build links against (zig-v8, wgpu, whisper, onnxruntime, ...)" },
    { path: ".github", kind: "source", what: "CI + repo config" },
    { path: ".claude", kind: "source", what: "project skills, hooks, agent config" },
    { path: ".agents", kind: "source", what: "agent skill definitions (agent-seat, agent-skin)" },
    { path: ".codex", kind: "source", what: "codex CLI config for the delegation handoff" },
    { path: "build.zig", kind: "source", what: "the root build \u2014 every cart host, dev module and test root" },
    { path: "build.zig.zon", kind: "source", what: "dependency manifest" },
    { path: "README.md", kind: "source", what: "repo overview" },
    { path: "CLAUDE.md", kind: "source", what: "the rules \u2014 hard rules, ship path, where features live" },
    { path: "AGENTS.md", kind: "source", what: "agent entry contract" },
    { path: "GUIDING_LIGHT.md", kind: "source", what: "the architectural north star" },
    { path: "install.sh", kind: "source", what: "clone-side setup" },
    { path: ".gitignore", kind: "source", what: "ignore rules (the blocklist half \u2014 this module is the allowlist half)" },
    { path: ".gitattributes", kind: "source", what: "git attributes" },
    { path: ".hardened-paths", kind: "source", what: "paths guarded against sweeps" },
    { path: "vocabulary.yaml", kind: "source", what: "ContextForge vocabulary \u2014 what words mean in this project" },
    { path: "plan_store.yaml", kind: "source", what: "ContextForge plan store" },
    { path: "questions.yaml", kind: "source", what: "ContextForge Q&A store" },
    // ── Carved out of published trees. Longest-prefix wins, so these override the rules
    //    above for their exact subtree. Each names what regenerates it. ─────────────────────
    {
      path: "tools/v8cli",
      kind: "artifact",
      what: "prebuilt 55MB V8 script host binary",
      insteadOf: "a scripts/fetch-v8cli.sh alongside fetch-zig.sh / fetch-v8-prebuilt.sh",
      blockedBy: "nothing fetches or builds it \u2014 untracking it breaks `tools/rjit` on a fresh clone"
    },
    {
      path: "tools/esbuild",
      kind: "artifact",
      what: "prebuilt 11MB esbuild binary",
      insteadOf: "a fetch script pinning the esbuild version",
      blockedBy: "nothing fetches it \u2014 untracking it breaks cart bundling on a fresh clone"
    },
    {
      path: "tools/rjit.js",
      kind: "artifact",
      what: "430KB bundle of cli/ \u2014 generated, not authored",
      insteadOf: "tools/esbuild cli/main.ts --bundle --outfile=tools/rjit.js --format=iife --platform=neutral --target=es2022",
      blockedBy: "building it needs tools/esbuild, which is itself unfetched \u2014 unpublish these three together"
    },
    {
      path: "framework/gpu/icon_atlas.zig",
      kind: "artifact",
      what: "9.7MB of generated Zig \u2014 a baked SDF icon atlas, @import-ed by the GPU path",
      insteadOf: "rjit bake-icons",
      blockedBy: "the build @import-s it, so a clone cannot compile until bake-icons has run"
    },
    {
      path: "framework/gpu/icon_atlas_debug.ppm.txt",
      kind: "artifact",
      what: "5MB debug dump of the icon atlas \u2014 a visual aid, not an input",
      insteadOf: "rjit bake-icons"
    },
    {
      path: "deps/duckdb",
      kind: "artifact",
      what: "114MB prebuilt DuckDB (libduckdb_static.a + the linux-amd64 zip) with ZERO references in build.zig, framework/, cli/ or scripts/",
      insteadOf: "nothing \u2014 no code links it. Re-fetch from the DuckDB release page if it is ever wanted"
    },
    {
      path: "cart/hmsc-int/exports",
      kind: "asset",
      what: "baked .rjpkg export output including a 15MB city.map",
      insteadOf: "rjit game bake \u2014 and the previous-era surface is not the build site anyway"
    },
    {
      // Reinstated as source against the binary SHAPE rule below: these are vendored
      // cross-compilation inputs, not build output. Nothing in this repo can produce them.
      path: "deps/windows",
      kind: "source",
      vouched: true,
      what: "vendored Windows import libraries (SDL2, FreeType) \u2014 cross-compile inputs the build links"
    },
    {
      path: "cart/app-jsx-backup",
      kind: "oneoff",
      what: "a .jsx snapshot of cart/app taken during the TS migration \u2014 and cart/ is .tsx/.ts only",
      insteadOf: "git history, which already holds it"
    },
    {
      // Note the trailing space in the directory name — it is real, and git quotes the path
      // in `status` output because of it.
      path: "bunch of dogshit ",
      kind: "oneoff",
      what: "the user's own sweep of ~200 esbuild bundles and metafiles off the repo root (372 files, ~195MB)",
      insteadOf: "nothing \u2014 every one of them is rebuilt by `rjit ship` / `rjit dev`"
    },
    {
      path: "torso_quad.glb",
      kind: "asset",
      what: "a 3D model sitting at the repo root, untracked but UNIGNORED \u2014 one `git add -A` from publication",
      insteadOf: 'local disk. CLAUDE.md: "do not commit 3d models to github" (USER RULING req_3772)'
    },
    // ── Frozen eras. Read for reference, never built. The repo already zips these into
    //    archive/*.zip and gitignores the zip (editor/experiments/images/os did this) — that
    //    informal move is what `rjit repo archive` makes into a real, announcing verb. ──────
    {
      path: "tsz",
      kind: "frozen",
      what: "Smith era \u2014 .tsz compiler, d-suite conformance, cockpit carts. 4163 files, FROZEN by CLAUDE.md",
      insteadOf: "archive/tsz.zip (build.zig only references tsz/zig-out/lib, a gitignored build output \u2014 no tracked file here is load-bearing)"
    },
    {
      path: "love2d",
      kind: "frozen",
      what: "the Lua reference stack \u2014 the proven reconciler-on-Lua implementation. 1894 files, FROZEN by CLAUDE.md",
      insteadOf: "archive/love2d.zip"
    },
    {
      path: "archive",
      kind: "frozen",
      what: "old compiler iterations (v1 tsz, v2 tsz-gen) + the evicted QJS stack. Already the archive, but tracked",
      insteadOf: "archive/*.zip, which .gitignore already expects \u2014 build.zig mentions archive/qjs-stack only in comments"
    },
    // ── One-offs. Each served one session and then stopped being anybody's input. ──────────
    {
      path: "recovered-models",
      kind: "asset",
      what: "86MB of 3D mesh JSON from a recovery dump \u2014 32MB in a single file",
      insteadOf: 'local disk. CLAUDE.md: "do not commit 3d models to github"; USER RULING req_3772 says the same'
    },
    {
      path: "shots",
      kind: "asset",
      what: "16MB of PNG frame captures from self-shot verification runs",
      insteadOf: "local disk \u2014 `rjit shot` regenerates any of them on demand"
    },
    {
      path: "research_runs",
      kind: "oneoff",
      what: "output of one-off research sweeps",
      insteadOf: "local disk; conclusions belong in docs/ if they matter"
    },
    {
      path: "dead",
      kind: "oneoff",
      what: "a graveyard directory",
      insteadOf: "deletion \u2014 git history is the graveyard"
    },
    {
      path: "verify-zig016-bins.sh",
      kind: "oneoff",
      what: "one-off verification script from the 0.16 migration, left at repo root",
      insteadOf: "scripts/ if still useful, otherwise nothing"
    },
    {
      path: "verify-zig016-editor.sh",
      kind: "oneoff",
      what: "one-off verification script from the 0.16 migration, left at repo root",
      insteadOf: "scripts/ if still useful, otherwise nothing"
    },
    {
      path: "verify-zig016-lane0.sh",
      kind: "oneoff",
      what: "one-off verification script from the 0.16 migration, left at repo root",
      insteadOf: "scripts/ if still useful, otherwise nothing"
    },
    {
      path: "verify-zig016-tests.sh",
      kind: "oneoff",
      what: "one-off verification script from the 0.16 migration, left at repo root",
      insteadOf: "scripts/ if still useful, otherwise nothing"
    }
  ];
  var ARTIFACT_SHAPES = [
    // Any `<prefix>bundle-<cart>.js`, not just a bare `bundle-` start. The .gitignore rule was
    // written as `bundle-*.js` on the day someone got burned, so the later `gdev-bundle-*.js`
    // and `tui-bundle-*.js` outputs walked straight past it and sat unignored at the repo root.
    // `cart-bundle.js` and friends are safe: this needs a hyphen AFTER "bundle".
    { test: (p) => /(^|\/)(bundle(-[^/]*)?|[A-Za-z0-9_]+-bundle-[^/]*)\.js$/.test(p), what: "esbuild cart bundle \u2014 rebuilt by `rjit ship` / `rjit dev`" },
    { test: (p) => /\.metafile\.json$/.test(p), what: "esbuild metafile \u2014 rebuilt with the bundle" },
    { test: (p) => /\.(png|jpg|jpeg|ppm|gif|webp)$/i.test(p), what: "raster image \u2014 an asset or a capture, never source" },
    { test: (p) => /\.(glb|gltf|obj|fbx|blend)$/i.test(p), what: "3D model \u2014 CLAUDE.md forbids publishing these" },
    { test: (p) => /\.(a|so|dylib|dll|o|wasm)$/i.test(p), what: "compiled binary object" },
    { test: (p) => /\.(zip|tar|tar\.gz|tgz|iso)$/i.test(p), what: "archive blob" },
    { test: (p) => /\.(db|sqlite)(-wal|-shm)?$/i.test(p), what: "database file \u2014 runtime state" },
    { test: (p) => /(^|\/)_?tmp[^/]*\//.test(p), what: "temp directory" },
    { test: (p) => /\.(log|bak|orig|rej|swp)$/i.test(p), what: "editor or process leftover" },
    { test: (p) => /_old\.[a-z]+$/i.test(p), what: "a `_old` rewrite breadcrumb \u2014 meant to be diffed then dropped" }
  ];
  function classifyTracked(path) {
    let best = null;
    for (const rule of PUBLISH_RULES) {
      const isPrefix = path === rule.path || path.startsWith(`${rule.path}/`);
      if (!isPrefix) continue;
      if (!best || rule.path.length > best.path.length) best = rule;
    }
    if (best && best.kind !== "source") {
      return { path, kind: best.kind, what: best.what, insteadOf: best.insteadOf, blockedBy: best.blockedBy, ruledBy: best.path };
    }
    if (best?.vouched) return { path, kind: "source", what: best.what, ruledBy: best.path };
    for (const shape of ARTIFACT_SHAPES) {
      if (!shape.test(path)) continue;
      return { path, kind: "artifact", what: shape.what, insteadOf: "regenerate it; add an ignore rule", ruledBy: "artifact shape" };
    }
    if (best) return { path, kind: "source", what: best.what, ruledBy: best.path };
    return {
      path,
      kind: "unknown",
      what: "no rule in cli/dev/publishable.ts covers this path",
      insteadOf: "declare it in PUBLISH_RULES (source) or unpublish it \u2014 a decision, not a default",
      ruledBy: "(undeclared)"
    };
  }
  function trackedEntries() {
    const listed = spawnSync("git", ["ls-tree", "-r", "-l", "HEAD"]);
    if (listed.code !== 0) return [];
    const entries = [];
    for (const line of listed.stdout.split("\n")) {
      if (!line) continue;
      const [meta, path] = line.split("	");
      if (!meta || !path) continue;
      const fields = meta.split(/\s+/);
      const size = fields[3];
      if (size === void 0 || size === "-") continue;
      entries.push({ path, bytes: Number(size) });
    }
    return entries;
  }
  function unpublishedCandidates() {
    const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"]);
    if (status.code !== 0) return [];
    return status.stdout.split("\n").filter((line) => line.startsWith("?? ")).map((line) => line.slice(3).trim()).filter((path) => path.length > 0);
  }
  function surveyTracked(entries) {
    const grouped = /* @__PURE__ */ new Map();
    let sourceFiles = 0;
    let sourceBytes = 0;
    for (const entry of entries) {
      const verdict = classifyTracked(entry.path);
      if (verdict.kind === "source") {
        sourceFiles += 1;
        sourceBytes += entry.bytes;
        continue;
      }
      const key2 = verdict.kind === "unknown" || verdict.ruledBy === "artifact shape" ? topLevel(entry.path) : verdict.ruledBy;
      const existing = grouped.get(`${verdict.kind}:${key2}`);
      if (existing) {
        existing.files += 1;
        existing.bytes += entry.bytes;
        if (existing.examples.length < 3) existing.examples.push(entry.path);
        continue;
      }
      grouped.set(`${verdict.kind}:${key2}`, {
        tree: key2,
        kind: verdict.kind,
        what: verdict.what,
        insteadOf: verdict.insteadOf,
        blockedBy: verdict.blockedBy,
        files: 1,
        bytes: entry.bytes,
        examples: [entry.path]
      });
    }
    const findings = [...grouped.values()].sort((a, b) => b.bytes - a.bytes);
    return { findings, sourceFiles, sourceBytes };
  }
  function topLevel(path) {
    const cut = path.indexOf("/");
    return cut === -1 ? path : path.slice(0, cut);
  }
  function humanBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1073741824).toFixed(1)}GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1048576).toFixed(1)}MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${bytes}B`;
  }
  var CLASS_HEADER = {
    source: "PUBLISHED \u2014 declared source",
    artifact: "ARTIFACT \u2014 generated, reproducible by a named command",
    asset: "ASSET \u2014 models, textures, captures. USER RULING req_3772: never published",
    frozen: "FROZEN ERA \u2014 reference only. Belongs in a zip under archive/",
    oneoff: "ONE-OFF \u2014 served one session",
    unknown: "UNDECLARED \u2014 no rule covers this. Decide, do not default"
  };
  function announce2(findings, sourceFiles, sourceBytes, write) {
    write("");
    write(`[repo] published source: ${sourceFiles} files, ${humanBytes(sourceBytes)}`);
    if (findings.length === 0) {
      write("[repo] nothing tracked outside the declared publish manifest. Clean.");
      return;
    }
    const order = ["unknown", "asset", "artifact", "frozen", "oneoff"];
    for (const kind of order) {
      const group = findings.filter((finding) => finding.kind === kind);
      if (group.length === 0) continue;
      const files = group.reduce((sum, finding) => sum + finding.files, 0);
      const bytes = group.reduce((sum, finding) => sum + finding.bytes, 0);
      write("");
      write(`  ${CLASS_HEADER[kind]}  \u2014  ${files} files, ${humanBytes(bytes)}`);
      for (const finding of group) {
        write(`    ${finding.tree}  (${finding.files} files, ${humanBytes(finding.bytes)})`);
        write(`        is:      ${finding.what}`);
        if (finding.insteadOf) write(`        instead: ${finding.insteadOf}`);
        if (finding.blockedBy) write(`        BLOCKED: ${finding.blockedBy}`);
        if (finding.tree === topLevel(finding.examples[0] ?? "") && finding.examples.length > 0 && finding.kind === "unknown") {
          write(`        e.g.     ${finding.examples.join(", ")}`);
        }
      }
    }
    const totalFiles = findings.reduce((sum, finding) => sum + finding.files, 0);
    const totalBytes = findings.reduce((sum, finding) => sum + finding.bytes, 0);
    const blocked = findings.filter((finding) => finding.blockedBy);
    write("");
    write(`[repo] ${totalFiles} tracked files (${humanBytes(totalBytes)}) do not belong on GitHub`);
    if (blocked.length > 0) {
      write(`[repo] ${blocked.length} of those are BLOCKED \u2014 they stay published until the named capability exists`);
    }
  }

  // cli/commands/repo.ts
  async function run23(argv) {
    const verb = argv[0];
    if (verb === "archive" || verb === "unpublish") {
      const rest = argv.slice(1);
      const trees = [];
      const flags = [];
      let into = null;
      for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (arg === "--into") {
          into = rest[i + 1] ?? null;
          i += 1;
          if (!into) {
            err("[repo] --into needs a name, e.g. --into carts-legacy");
            return 1;
          }
          continue;
        }
        if (arg.startsWith("-")) flags.push(arg);
        else trees.push(arg);
      }
      const unknownFlag = flags.find((flag) => flag !== "--drop" && flag !== "--tracked-only");
      if (unknownFlag) {
        err(`[repo] ${verb}: unknown flag ${unknownFlag}`);
        return 1;
      }
      if (trees.length === 0) {
        err(`[repo] ${verb}: name at least one tree`);
        err(`Usage: rjit repo ${verb} <tree>... [--drop] [--tracked-only] [--into <name>]`);
        return 1;
      }
      const trackedOnly = flags.includes("--tracked-only");
      const drop = flags.includes("--drop");
      if (trackedOnly && drop) {
        err("[repo] --tracked-only and --drop are incompatible: the zip omits untracked files by design,");
        err("[repo]   so it cannot prove it covers the disk. Remove the tree yourself if that is what you want.");
        return 1;
      }
      return applyVerb(verb, trees, drop, trackedOnly, into);
    }
    if (verb !== void 0 && verb !== "--candidates") {
      err(`[repo] unknown verb: ${verb}`);
      err("Usage: rjit repo [--candidates] | rjit repo archive <tree>... [--drop] | rjit repo unpublish <tree>...");
      return 1;
    }
    const entries = trackedEntries();
    if (entries.length === 0) {
      err("[repo] git ls-tree returned nothing \u2014 not a git repo, or HEAD is unborn");
      return 1;
    }
    const { findings, sourceFiles, sourceBytes } = surveyTracked(entries);
    announce2(findings, sourceFiles, sourceBytes, out);
    if (argv.includes("--candidates")) reportCandidates();
    out("");
    out("[repo] this survey changed nothing. To act on a finding:");
    out("[repo]   rjit repo archive <tree>     zip to archive/, untrack, ignore, keep on disk");
    out("[repo]   rjit repo archive <tree> --drop   ...and remove the tree once the zip provably covers it");
    out("[repo]   rjit repo unpublish <tree>   untrack, ignore, keep on disk");
    out("[repo] to PUBLISH something reported undeclared, add it to cli/dev/publishable.ts");
    return 0;
  }
  function reportCandidates() {
    const candidates = unpublishedCandidates();
    out("");
    if (candidates.length === 0) {
      out("[repo] no untracked-and-unignored paths \u2014 nothing is one `git add -A` from publication");
      return;
    }
    out(`  ONE \`git add -A\` FROM PUBLICATION  \u2014  ${candidates.length} untracked, unignored paths`);
    for (const path of candidates) {
      const verdict = classifyTracked(path.replace(/\/$/, ""));
      out(`    ${path}  \u2192  would be ${verdict.kind}: ${verdict.what}`);
    }
  }
  function applyVerb(verb, trees, drop, trackedOnly = false, into = null) {
    const entries = trackedEntries();
    const { findings, sourceFiles, sourceBytes } = surveyTracked(entries);
    announce2(findings, sourceFiles, sourceBytes, out);
    out("");
    const rjitHome = __env("RJIT_HOME") || __cwd();
    if (into !== null) {
      if (verb !== "archive") {
        err("[repo] --into only applies to `archive`");
        return 1;
      }
      const combined = `archive/${into}.zip`;
      const packed = trackedOnly ? packTrackedInto(rjitHome, trees, combined) : (() => {
        err("[repo] --into currently requires --tracked-only");
        return 1;
      })();
      if (packed !== 0) return packed;
    }
    for (const raw of trees) {
      const tree = raw.replace(/\/+$/, "");
      const verdict = classifyTracked(tree);
      if (verdict.kind === "source") {
        err(`[repo] REFUSED ${tree}: declared source (${verdict.what})`);
        err("[repo]   it belongs in a clone. Remove its rule from PUBLISH_RULES first if that is wrong.");
        return 1;
      }
      if (verdict.kind === "unknown") {
        err(`[repo] REFUSED ${tree}: ${verdict.what}`);
        err("[repo]   declare it in cli/dev/publishable.ts first. An undeclared path never gets a default.");
        return 1;
      }
      if (verdict.blockedBy) {
        err(`[repo] REFUSED ${tree}: BLOCKED \u2014 ${verdict.blockedBy}`);
        err(`[repo]   provide first: ${verdict.insteadOf ?? "the missing capability"}`);
        return 1;
      }
      const tracked = entries.filter((entry) => entry.path === tree || entry.path.startsWith(`${tree}/`));
      const bytes = tracked.reduce((sum, entry) => sum + entry.bytes, 0);
      let zipRel = null;
      if (verb === "archive" && into === null) {
        zipRel = `archive/${zipName(tree)}.zip`;
        if (fsExists(`${rjitHome}/${zipRel}`)) {
          out(`[repo] ${tree}: ${zipRel} already exists \u2014 reusing it (coverage is re-checked below)`);
        } else {
          const packed = packTree(rjitHome, tree, zipRel);
          if (packed !== 0) return packed;
          out(`[repo] ${tree}: packed \u2192 ${zipRel} (verified)`);
        }
      }
      if (tracked.length === 0) {
        out(`[repo] ${tree}: already untracked`);
      } else {
        out(`[repo] ${tree}: untracking ${tracked.length} files (${humanBytes(bytes)}) \u2014 files stay on disk`);
        const removed = spawnSync("git", ["rm", "-r", "--cached", "--quiet", "--", tree]);
        if (removed.code !== 0) {
          err(`[repo] ${tree}: git rm --cached failed (exit ${removed.code})`);
          err(removed.stderr.trim());
          return removed.code || 1;
        }
      }
      out(`[repo] ${tree}: ${addIgnoreRule(rjitHome, tree, verdict.kind, verdict.what)}`);
      if (drop) {
        if (!zipRel) {
          err(`[repo] ${tree}: --drop only applies to \`archive\` \u2014 unpublish keeps the files by design`);
          return 1;
        }
        const dropped = dropArchivedTree(rjitHome, tree, zipRel);
        if (dropped !== 0) return dropped;
      }
    }
    out("");
    if (drop) {
      out("[repo] trees removed from disk only after their zip was proven to contain every file.");
    } else {
      out("[repo] staged. Nothing was deleted from disk; `git checkout -- <tree>` undoes any of it.");
    }
    out("[repo] review with `git status`, then commit .gitignore together with the removals.");
    return 0;
  }
  function dropArchivedTree(rjitHome, tree, zipRel) {
    const onDisk = listFilesAndLinks(rjitHome, tree);
    if (onDisk.length === 0) {
      out(`[repo] ${tree}: not on disk \u2014 nothing to remove`);
      return 0;
    }
    const inZip = new Set(listZipEntries(rjitHome, zipRel));
    if (inZip.size === 0) {
      err(`[repo] ${tree}: could not read ${zipRel} \u2014 refusing to remove anything`);
      return 1;
    }
    const missing = onDisk.filter((path) => !inZip.has(path));
    if (missing.length > 0) {
      err(`[repo] ${tree}: REFUSING to remove \u2014 ${missing.length} of ${onDisk.length} files on disk are NOT in ${zipRel}`);
      for (const path of missing.slice(0, 10)) err(`[repo]     missing: ${path}`);
      if (missing.length > 10) err(`[repo]     ... and ${missing.length - 10} more`);
      return 1;
    }
    const size = spawnSync("du", ["-sh", `${rjitHome}/${tree}`]).stdout.trim().split("	")[0] ?? "?";
    out(`[repo] ${tree}: all ${onDisk.length} files/symlinks on disk are present in ${zipRel}`);
    out(`[repo] ${tree}: removing the unzipped tree (${size}) \u2014 the zip is the copy that remains`);
    const removed = spawnSync("rm", ["-rf", "--", `${rjitHome}/${tree}`]);
    if (removed.code !== 0) {
      err(`[repo] ${tree}: rm failed (exit ${removed.code})`);
      return removed.code || 1;
    }
    return 0;
  }
  function listFilesAndLinks(rjitHome, tree) {
    const found = spawnSync("sh", [
      "-c",
      `cd ${shellQuote3(rjitHome)} && find ${shellQuote3(tree)} \\( -type f -o -type l \\) -print 2>/dev/null`
    ]);
    if (found.code !== 0) return [];
    return found.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  }
  function listZipEntries(rjitHome, zipRel) {
    const listed = spawnSync("unzip", ["-Z1", `${rjitHome}/${zipRel}`]);
    if (listed.code !== 0) return [];
    return listed.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.endsWith("/"));
  }
  function zipName(tree) {
    const withinArchive = tree.startsWith("archive/") ? tree.slice("archive/".length) : tree;
    return withinArchive.replace(/\//g, "-");
  }
  function packTrackedInto(rjitHome, trees, zipRel) {
    const zipAbs = `${rjitHome}/${zipRel}`;
    if (fsExists(zipAbs)) {
      err(`[repo] ${zipRel} already exists \u2014 refusing to overwrite an existing archive`);
      return 1;
    }
    spawnSync("mkdir", ["-p", "--", `${rjitHome}/archive`]);
    out(`[repo] packing tracked content of ${trees.length} trees \u2192 ${zipRel} ...`);
    const packed = spawnSync("git", ["archive", "--format=zip", "-o", zipAbs, "HEAD", "--", ...trees]);
    if (packed.code !== 0) {
      err(`[repo] git archive failed (exit ${packed.code})`);
      err(packed.stderr.trim());
      return packed.code || 1;
    }
    const tested = spawnSync("zip", ["-T", zipAbs]);
    if (tested.code !== 0) {
      err(`[repo] ${zipRel}: zip -T verification FAILED \u2014 leaving everything tracked`);
      return 1;
    }
    const count = listZipEntries(rjitHome, zipRel).length;
    const size = spawnSync("du", ["-sh", zipAbs]).stdout.trim().split("	")[0] ?? "?";
    out(`[repo] packed \u2192 ${zipRel} (${count} files, ${size}, verified)`);
    return 0;
  }
  function packTree(rjitHome, tree, zipRel) {
    const source = `${rjitHome}/${tree}`;
    if (!fsExists(source)) {
      err(`[repo] ${tree}: not on disk \u2014 refusing to archive a tree that is not there`);
      return 1;
    }
    const which = spawnSync("sh", ["-c", "command -v zip"]);
    if (which.code !== 0) {
      err("[repo] `zip` is not installed \u2014 cannot archive. Install zip, or use `unpublish` if the tree is already backed up.");
      return 1;
    }
    if (zipRel === tree || zipRel.startsWith(`${tree}/`)) {
      err(`[repo] ${tree}: the archive destination ${zipRel} is inside the tree being archived`);
      err(`[repo]   ${tree} is already an archive location \u2014 use \`rjit repo unpublish ${tree}\` instead.`);
      return 1;
    }
    const zipAbs = `${rjitHome}/${zipRel}`;
    if (fsExists(zipAbs)) {
      err(`[repo] ${zipRel} already exists \u2014 refusing to overwrite an existing archive`);
      return 1;
    }
    spawnSync("mkdir", ["-p", "--", `${rjitHome}/archive`]);
    out(`[repo] ${tree}: packing \u2192 ${zipRel} ...`);
    const packed = spawnSync("sh", ["-c", `cd ${shellQuote3(rjitHome)} && zip -q -r -y -X ${shellQuote3(zipRel)} ${shellQuote3(tree)}`]);
    if (packed.code !== 0) {
      err(`[repo] ${tree}: zip failed (exit ${packed.code})`);
      err(packed.stderr.trim());
      return packed.code || 1;
    }
    const tested = spawnSync("zip", ["-T", zipAbs]);
    if (tested.code !== 0) {
      err(`[repo] ${zipRel}: zip -T verification FAILED \u2014 leaving the tree tracked`);
      err(tested.stdout.trim() || tested.stderr.trim());
      return 1;
    }
    return 0;
  }
  function shellQuote3(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
  function addIgnoreRule(rjitHome, tree, kind, what) {
    const path = `${rjitHome}/.gitignore`;
    const heading = "# \u2500\u2500 Unpublished by `rjit repo` (see cli/dev/publishable.ts) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500";
    const isDir = tryFsStat(`${rjitHome}/${tree}`)?.isDir === true;
    const rule = isDir ? `/${tree}/` : `/${tree}`;
    const existing = fsExists(path) ? fsRead(path) : "";
    if (existing.split("\n").some((line) => line.trim() === rule || line.trim() === `/${tree}` || line.trim() === `/${tree}/`)) {
      return "ignore rule already present";
    }
    const block = existing.includes(heading) ? "" : `
${heading}
`;
    const body = `# ${kind}: ${what}
${rule}
`;
    fsWrite(path, `${existing.replace(/\n*$/, "\n")}${block}${body}`);
    return `ignore rule added (${rule})`;
  }

  // cli/commands/ship.ts
  var ship_exports = {};
  __export(ship_exports, {
    run: () => run24
  });
  async function run24(argv) {
    const parsed = parseShipArgs(argv);
    if (typeof parsed === "number") return parsed;
    const root = __cwd();
    const rjitHome = __env("RJIT_HOME") || root;
    const cartRoot = root;
    const zig = resolveZig4(rjitHome);
    const cart = resolveCart4(cartRoot, parsed.name);
    if (!cart) return fail9(`not found: ${cartRoot}/cart/${parsed.name}/index.tsx or ${cartRoot}/cart/${parsed.name}.tsx`, 1);
    const substrate = resolveSubstrate3(parsed.substrateFlag, cart.manifest);
    const bundleOut = `${cartRoot}/bundle-${parsed.name}.js`;
    const embedBundle = cartRoot === rjitHome ? bundleOut : `${rjitHome}/bundles/bundle-${parsed.name}.js`;
    const icon = resolveIcon(cartRoot, cart, parsed.name);
    if (icon) out(`[ship] app icon: ${icon}`);
    runFixReactImports3(rjitHome, cartRoot);
    const restoreGeometrySeed = bakeGeometryForCart(rjitHome, parsed.name, cart);
    if (!restoreGeometrySeed) return 1;
    out(`[ship] bundling ${cart.entry} -> ${bundleOut}...`);
    const bundle2 = bundleCart({
      rjitHome,
      cartEntry: cart.entry,
      outFile: bundleOut,
      mode: substrate === "tui" ? "tui-host" : "gpu-host"
    });
    writeSpawnOutput6(bundle2);
    restoreGeometrySeed();
    if (bundle2.code !== 0) return bundle2.code || 1;
    if (embedBundle !== bundleOut) {
      fsMkdir(dirname6(embedBundle));
      const copy = spawnSync("cp", ["-f", bundleOut, embedBundle]);
      writeSpawnOutput6(copy);
      if (copy.code !== 0) return copy.code || 1;
    }
    const customChromeFlag = customChromeFlagFor(cart.manifest, bundleOut);
    const zigFlags = resolveZigFlags(rjitHome, `${bundleOut}.metafile.json`);
    const sysrootFlags = resolveSysrootFlags(rjitHome);
    const substrateFlags = substrate === "tui" ? ["-Dhas-gpu=false"] : [];
    const flags = [
      "build",
      "app",
      "-p",
      `${cartRoot}/zig-out`,
      `-Dapp-name=${parsed.name}`,
      "-Dapp-source=framework/v8_app.zig",
      `-Dbundle-path=${embedBundle}`,
      "-Duse-v8=true",
      ...customChromeFlag,
      ...substrateFlags,
      "-Doptimize=ReleaseFast",
      ...sysrootFlags,
      ...zigFlags.filter((flag) => flag !== "-Duse-v8=true")
    ];
    out("[ship] compiling native binary...");
    out(`[ship]   zig flags: ${flags.slice(2).join(" ")}`);
    const build = runLockedBuild(rjitHome, buildCommand(rjitHome, cartRoot, zig, flags));
    writeSpawnOutput6(build);
    if (build.code !== 0) return build.code || 1;
    trimZigCacheIfOversized(rjitHome);
    const buildBin = `${cartRoot}/zig-out/bin/${parsed.name}`;
    if (!fsExists(buildBin)) return fail9(`build produced no binary: ${buildBin}`, 1);
    if (!verifyIngredientLabels(cartRoot, buildBin, flags)) return 1;
    if (__env("SHIP_RUN_PACKAGE") === "0") {
      out(`[ship] done (packaging skipped) -> ${buildBin}`);
      return 0;
    }
    const os = spawnSync("uname", ["-s"]).stdout.trim();
    if (os === "Darwin") {
      return packageMacos({ name: parsed.name, buildBin, cartRoot, icon });
    }
    if (os !== "Linux") {
      out(`[ship] packaging not implemented for this OS - leaving build output at ${buildBin}`);
      return 0;
    }
    return packageLinux({ name: parsed.name, buildBin, rjitHome, cartRoot, fat: parsed.fat, bundleOut, icon, buildFlags: flags });
  }
  function parseShipArgs(argv) {
    let name = "";
    let fat = false;
    let substrateFlag = null;
    for (const arg of argv) {
      if (arg === "--fat") {
        fat = true;
      } else if (arg === "--tui" || arg === "--headless") {
        substrateFlag = "tui";
      } else if (arg === "--gui") {
        substrateFlag = "gui";
      } else if (arg.startsWith("--")) {
        err(`[ship] unknown flag: ${arg}`);
        err("Usage: scripts/ship <cart-name> [--fat] [--gui|--tui]");
        return 1;
      } else if (name) {
        err(`[ship] unexpected positional arg: ${arg}`);
        err("Usage: scripts/ship <cart-name> [--fat] [--gui|--tui]");
        return 1;
      } else {
        name = arg;
      }
    }
    if (!name) {
      err("Usage: scripts/ship <cart-name> [--fat] [--gui|--tui]");
      err(`  Cart expected at: ${__cwd()}/cart/<cart-name>.tsx`);
      err("  --fat: bundle every .so in deps/sysroot/usr/lib/ (Whonix-class hosts");
      err("         with stripped-out runtime libs); default skips the catch-all.");
      return 1;
    }
    return { name, fat, substrateFlag };
  }
  function resolveCart4(cartRoot, name) {
    const dirEntry = `${cartRoot}/cart/${name}/index.tsx`;
    if (fsExists(dirEntry)) return { entry: dirEntry, dir: dirname6(dirEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
    const fileEntry = `${cartRoot}/cart/${name}.tsx`;
    if (fsExists(fileEntry)) return { entry: fileEntry, dir: dirname6(fileEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
    return null;
  }
  function resolveZig4(rjitHome) {
    const bundled = __env("REACTJIT_ZIG") || `${rjitHome}/tools/zig/zig`;
    if (fsExists(bundled)) return bundled;
    return "zig";
  }
  function runFixReactImports3(rjitHome, cartRoot) {
    const script = `${rjitHome}/scripts/fix-react-imports`;
    if (!fsExists(script)) return;
    const result = spawnSync("env", [`RJIT_HOME=${rjitHome}`, `CART_ROOT=${cartRoot}`, script]);
    writeSpawnOutput6(result);
    if (result.code !== 0) throw new Error(`fix-react-imports exited ${result.code}`);
  }
  function bakeGeometryForCart(rjitHome, name, cart) {
    const manifestPath = `/tmp/reactjit-${sanitizeName(name)}-geometry-bake.json`;
    const seedPath = `${rjitHome}/runtime/geometries/_baked.generated.ts`;
    const previousSeed = tryFsRead(seedPath);
    out("[ship] baking static Scene3D geometry...");
    const scan2 = spawnSync(`${rjitHome}/tools/rjit`, ["bake-geometry-auto", cart.entry, "--out", manifestPath]);
    writeSpawnOutput6(scan2);
    if (scan2.code !== 0) return null;
    const bake2 = spawnSync(`${rjitHome}/tools/rjit`, ["bake-geometry", "--manifest", manifestPath, "--out", seedPath]);
    writeSpawnOutput6(bake2);
    if (bake2.code !== 0) return null;
    return () => {
      if (previousSeed !== null) {
        fsWrite(seedPath, previousSeed);
      } else {
        spawnSync("rm", ["-f", seedPath]);
      }
    };
  }
  function sanitizeName(name) {
    return name.replace(/[^A-Za-z0-9_.-]/g, "_");
  }
  function resolveSubstrate3(flag, manifestPath) {
    if (flag) return flag;
    if (fsExists(manifestPath)) {
      const surface = loadManifest(manifestPath).surface;
      if (surface === "tui" || surface === "gui") return surface;
    }
    return "gui";
  }
  function resolveIcon(cartRoot, cart, name) {
    const declared = iconDeclared(cart.manifest);
    if (declared) {
      const resolved = resolveIconPath(cartRoot, cart.dir, declared);
      if (!resolved) throw new Error(`cart manifest icon not found: ${declared}`);
      return resolved;
    }
    for (const candidate of [
      `${cartRoot}/cart/${name}/icon.icns`,
      `${cartRoot}/cart/${name}/icon.png`,
      `${cartRoot}/cart/${name}/icon.svg`,
      `${cartRoot}/cart/${name}/icon.ico`,
      `${cartRoot}/cart/${name}.icns`,
      `${cartRoot}/cart/${name}.png`,
      `${cartRoot}/cart/${name}.svg`,
      `${cartRoot}/cart/${name}.ico`
    ]) {
      if (fsExists(candidate)) return candidate;
    }
    return null;
  }
  function iconDeclared(manifestPath) {
    if (!fsExists(manifestPath)) return "";
    const manifest2 = loadManifest(manifestPath);
    const os = spawnSync("uname", ["-s"]).stdout.trim();
    const preferred = os === "Darwin" ? manifestField(manifest2, "icons.macos") : os === "Linux" ? manifestField(manifest2, "icons.linux") : void 0;
    const fallback = preferred ?? manifestField(manifest2, "icons.default") ?? manifestField(manifest2, "icon");
    return typeof fallback === "string" ? fallback : "";
  }
  function resolveIconPath(cartRoot, cartDir, value) {
    const candidates = value.startsWith("/") ? [value] : [`${cartDir}/${value}`, `${cartRoot}/${value}`];
    for (const candidate of candidates) {
      if (fsExists(candidate)) return candidate;
    }
    return null;
  }
  function customChromeFlagFor(manifestPath, bundlePath) {
    const manifest2 = tryFsRead(manifestPath);
    if (!manifest2 || !/"customChrome"\s*:\s*true/.test(manifest2)) return [];
    const bundle2 = tryFsRead(bundlePath) ?? "";
    if (bundle2.includes("windowDrag")) {
      out("[ship] cart manifest: customChrome=true (windowDrag detected -> borderless)");
      return ["-Dcustom-chrome=true"];
    }
    out("[ship] cart manifest: customChrome=true ignored - no windowDrag in bundle");
    out("[ship]   (cart has no draggable chrome bar; falling back to OS chrome so user can move/close the window)");
    return [];
  }
  function resolveZigFlags(rjitHome, metafilePath) {
    if (!fsExists(metafilePath)) {
      err(`[ship] WARNING: no metafile at ${metafilePath} - all opt-in V8 bindings disabled`);
      return [];
    }
    const result = spawnSync(`${rjitHome}/tools/rjit`, ["metafile-gate", "--metafile", metafilePath, "--format", "zig-flags"]);
    if (result.stderr) __writeStderr(result.stderr);
    if (result.code !== 0) throw new Error("metafile-gate failed");
    const flags = result.stdout.trim() ? result.stdout.trim().split(/\s+/) : [];
    const gate = spawnSync(`${rjitHome}/tools/rjit`, ["metafile-gate", "--metafile", metafilePath, "--format", "ship-gate"]);
    const names = ["privacy", "useHost", "useConnection", "fs", "websocket", "telemetry", "zigcall", "sdk", "voice", "audio_input", "whisper", "paintable", "onnx", "pg", "embed", "sqlite", "terminal", "process", "window", "doom"];
    const values = gate.stdout.trim().split(/\s+/);
    const enabled = new Set(names.filter((_, i) => values[i] === "1"));
    if (enabled.has("embed") && !flags.includes("-Dhas-pg=true")) flags.push("-Dhas-pg=true");
    return flags;
  }
  function resolveSysrootFlags(rjitHome) {
    const sysroot = `${rjitHome}/deps/sysroot`;
    if (!fsExists(`${sysroot}/usr/include`)) return [];
    ensureSystemDevSymlink(rjitHome, "X11");
    return [`-Dsysroot=${sysroot}`];
  }
  function ensureSystemDevSymlink(rjitHome, name) {
    const sysrootLib = `${rjitHome}/deps/sysroot/usr/lib`;
    const link = `${sysrootLib}/lib${name}.so`;
    if (fsExists(link)) return;
    const ldconfig = spawnSync("sh", ["-c", `ldconfig -p 2>/dev/null | awk '$1 ~ /^lib${name}\\\\.so/ {print $NF; exit}'`]);
    const target = ldconfig.stdout.trim();
    if (!target || !fsExists(target)) return;
    const result = spawnSync("ln", ["-sfn", target, link]);
    writeSpawnOutput6(result);
    if (result.code === 0) out(`[ship] sysroot: linked lib${name}.so -> ${target}`);
  }
  function buildCommand(rjitHome, cartRoot, zig, flags) {
    if (cartRoot === rjitHome) return [zig, ...flags];
    return ["env", `ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...flags];
  }
  function runLockedBuild(rjitHome, command) {
    const lockFile = `${rjitHome}/.zig-cache/.ship.lock`;
    fsMkdir(dirname6(lockFile));
    const first = spawnSync("flock", ["-n", "-E", "75", lockFile, ...command]);
    if (first.code !== 75) return first;
    out("[ship] another build in progress - waiting for lock...");
    const second = spawnSync("flock", [lockFile, ...command]);
    if (second.code === 0) out("[ship] got lock, proceeding");
    return second;
  }
  function verifyIngredientLabels(cartRoot, buildBin, flags) {
    const labelDir = `${cartRoot}/zig-out/manifest/v8-ingredients`;
    const expected = {
      privacy: hasBuildFlag(flags, "has-privacy"),
      process: hasBuildFlag(flags, "has-process"),
      httpsrv: hasBuildFlag(flags, "has-httpsrv"),
      wssrv: hasBuildFlag(flags, "has-wssrv"),
      net: hasBuildFlag(flags, "has-net"),
      tor: hasBuildFlag(flags, "has-tor"),
      fs: hasBuildFlag(flags, "has-fs"),
      websocket: hasBuildFlag(flags, "has-websocket"),
      telemetry: hasBuildFlag(flags, "has-telemetry"),
      sqlite: hasBuildFlag(flags, "has-sqlite"),
      zigcall: hasBuildFlag(flags, "has-zigcall"),
      sdk: hasBuildFlag(flags, "has-sdk"),
      voice: hasBuildFlag(flags, "has-voice"),
      audio_input: hasBuildFlag(flags, "has-audio-input"),
      paintable: hasBuildFlag(flags, "has-paintable"),
      pg: hasBuildFlag(flags, "has-pg") || hasBuildFlag(flags, "has-embed"),
      embed: hasBuildFlag(flags, "has-embed"),
      whisper: hasBuildFlag(flags, "has-whisper"),
      onnx: hasBuildFlag(flags, "has-onnx"),
      lore: hasBuildFlag(flags, "has-lore"),
      audio: hasBuildFlag(flags, "has-audio"),
      midi: hasBuildFlag(flags, "has-midi"),
      deej: hasBuildFlag(flags, "has-deej"),
      vterm: hasBuildFlag(flags, "has-terminal"),
      doom: hasBuildFlag(flags, "has-doom"),
      pathing: hasBuildFlag(flags, "has-pathing"),
      compiled_world: hasBuildFlag(flags, "has-compiled-world"),
      imageops: hasBuildFlag(flags, "has-imageops")
    };
    let mismatch = false;
    for (const [name, want] of Object.entries(expected)) {
      const flagFile = `${labelDir}/${name}.flag`;
      if (!fsExists(flagFile)) {
        err(`[ship] LABEL MISSING: ${flagFile} (expected ${want ? "1" : "0"})`);
        mismatch = true;
        continue;
      }
      const actual = fsRead(flagFile).trim();
      const expectedText = want ? "1" : "0";
      if (actual !== expectedText) {
        err(`[ship] LABEL MISMATCH: ${name} - cart asked for '${expectedText}' but binary built '${actual}'`);
        mismatch = true;
      }
    }
    if (!mismatch) return true;
    err("[ship] DESTROYING binary - manifest disagrees with cart declaration");
    spawnSync("rm", ["-f", buildBin]);
    return false;
  }
  function hasBuildFlag(flags, name) {
    return flags.includes(`-D${name}=true`);
  }
  function packageLinux(opts) {
    out("[ship] packaging self-extracting binary...");
    const tmpDir = `/tmp/reactjit-dist-${opts.name}`;
    const libDir = `${tmpDir}/lib`;
    const tarball = `/tmp/reactjit-${opts.name}-payload.tar.gz`;
    runOrThrow("rm", ["-rf", tmpDir, tarball]);
    fsMkdir(libDir);
    runOrThrow("cp", [opts.buildBin, `${tmpDir}/app.bin`]);
    bundleLocalAiWorker(opts.rjitHome, tmpDir, libDir, opts.buildFlags);
    bundleLibMpv(opts.rjitHome, libDir, opts.bundleOut);
    const libCount = bundleLinkedLibs(opts.buildBin, libDir, opts.rjitHome, opts.fat);
    bundlePostgres(opts.rjitHome, tmpDir);
    if (opts.icon) writeDesktopFiles(tmpDir, opts.name, opts.icon);
    writeLauncher(`${tmpDir}/run`);
    runOrThrow("tar", ["czf", tarball, "-C", tmpDir, "."]);
    writeSelfExtractor2(opts.buildBin, tarball, opts.name, opts.icon ? `${opts.name}.${extension(opts.icon)}` : "");
    const size = spawnSync("du", ["-m", opts.buildBin]).stdout.trim().split(/\s+/)[0] || "?";
    out(`[ship] done (${size}MB self-extracting, ${libCount} libs bundled) -> ${opts.buildBin}`);
    runOrThrow("rm", ["-rf", tmpDir, tarball]);
    return 0;
  }
  function packageMacos(opts) {
    out("[ship] packaging macOS .app bundle...");
    const appBundle = `${opts.cartRoot}/zig-out/bin/${opts.name}.app`;
    const contents = `${appBundle}/Contents`;
    const macosDir = `${contents}/MacOS`;
    const fwDir = `${contents}/Frameworks`;
    const resDir = `${contents}/Resources`;
    runOrThrow("rm", ["-rf", appBundle]);
    fsMkdir(macosDir);
    fsMkdir(fwDir);
    fsMkdir(resDir);
    runOrThrow("cp", [opts.buildBin, `${macosDir}/${opts.name}`]);
    let iconPlist = "";
    if (opts.icon) {
      const iconFile = `${opts.name}.${extension(opts.icon)}`;
      runOrThrow("cp", [opts.icon, `${resDir}/${iconFile}`]);
      if (extension(opts.icon) === "icns") {
        iconPlist = `    <key>CFBundleIconFile</key>
    <string>${iconFile}</string>`;
      } else {
        err(`[ship] macOS icon copied to Resources/${iconFile}; Finder icon requires .icns`);
      }
    }
    fsWrite(`${contents}/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${opts.name}</string>
    <key>CFBundleIdentifier</key>
    <string>com.reactjit.${opts.name}</string>
    <key>CFBundleName</key>
    <string>${opts.name}</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
${iconPlist}
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
</dict>
</plist>
`);
    runOrThrow("sh", ["-c", `
set -e
collect_dylibs() {
  for bin in "$@"; do
    otool -L "$bin" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib_path; do
      case "$lib_path" in /usr/lib/*|/System/*|@rpath/*|@executable_path/*) continue ;; esac
      [ -f "$lib_path" ] || continue
      lib_name=$(basename "$lib_path")
      [ -f "${fwDir}/$lib_name" ] && continue
      cp "$lib_path" "${fwDir}/$lib_name"
    done
  done
}
rewrite_dylib_paths() {
  bin="$1"
  otool -L "$bin" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib_path; do
    case "$lib_path" in /usr/lib/*|/System/*|@rpath/*|@executable_path/*) continue ;; esac
    lib_name=$(basename "$lib_path")
    install_name_tool -change "$lib_path" "@executable_path/../Frameworks/$lib_name" "$bin" 2>/dev/null || true
  done
}
collect_dylibs "${macosDir}/${opts.name}"
collect_dylibs "${fwDir}"/*.dylib >/dev/null 2>/dev/null || true
rewrite_dylib_paths "${macosDir}/${opts.name}"
install_name_tool -add_rpath "@executable_path/../Frameworks" "${macosDir}/${opts.name}" 2>/dev/null || true
for dylib in "${fwDir}"/*.dylib; do
  [ -f "$dylib" ] || continue
  lib_name=$(basename "$dylib")
  install_name_tool -id "@executable_path/../Frameworks/$lib_name" "$dylib" 2>/dev/null || true
  rewrite_dylib_paths "$dylib"
done
codesign --force --sign - --deep "${appBundle}" 2>/dev/null || true
`]);
    const libCount = spawnSync("sh", ["-c", `find "${fwDir}" -name '*.dylib' 2>/dev/null | wc -l | tr -d ' '`]).stdout.trim() || "0";
    const size = spawnSync("du", ["-sm", appBundle]).stdout.trim().split(/\s+/)[0] || "?";
    out(`[ship] done (${size}MB .app bundle, ${libCount} dylibs) -> ${appBundle}`);
    return 0;
  }
  function bundleLocalAiWorker(rjitHome, tmpDir, libDir, buildFlags) {
    if (!hasBuildFlag(buildFlags, "has-embed")) return;
    const worker = `${rjitHome}/zig-out/bin/rjit-llm-worker`;
    const libSource = `${rjitHome}/deps/llama.cpp-fresh/build/bin`;
    if (!fsExists(worker) || !fsExists(libSource)) {
      err(`[ship]   WARNING: has-embed needs ${worker} + ${libSource} - skipping local-runtime bundle`);
      return;
    }
    runOrThrow("cp", [worker, `${tmpDir}/rjit-llm-worker`]);
    runOrThrow("chmod", ["+x", `${tmpDir}/rjit-llm-worker`]);
    runOrThrow("sh", ["-c", `
set -e
for so_pattern in libllama libggml libggml-base libggml-cpu libggml-vulkan; do
  for f in "${libSource}/$so_pattern.so"*; do
    [ -e "$f" ] || continue
    soname=$(basename "$f")
    real=$(readlink -f "$f")
    cp "$real" "${libDir}/$soname"
  done
done
`]);
    out("[ship]   bundled rjit-llm-worker + libllama.so + ggml-vulkan backend");
  }
  function bundleLibMpv(rjitHome, libDir, bundleOut) {
    const bundle2 = tryFsRead(bundleOut) ?? "";
    if (!/__jsxs?\(Video,/.test(bundle2)) return;
    const src = `${rjitHome}/deps/libmpv/libmpv.so.2`;
    if (fsExists(src)) {
      runOrThrow("cp", ["-L", src, `${libDir}/libmpv.so.2`]);
      out("[ship]   bundled libmpv.so.2 (video cart - Video primitive detected)");
      return;
    }
    err(`[ship]   NOTE: cart uses Video and no pinned libmpv.so.2 is present at ${src}`);
    err("[ship]         video playback loads the system libmpv at runtime; drop a .so there to pin one");
  }
  function bundlePostgres(rjitHome, tmpDir) {
    const pg = `${rjitHome}/.pg-bundle`;
    if (!fsExists(pg)) return;
    runOrThrow("cp", ["-RL", pg, `${tmpDir}/pg`]);
    const size = spawnSync("du", ["-sh", `${tmpDir}/pg`]).stdout.trim().split(/\s+/)[0] || "?";
    out(`[ship]   bundled postgres (${size}) - extract dir -> pg/bin/postgres`);
  }
  function bundleLinkedLibs(buildBin, libDir, rjitHome, fat) {
    const prefixes = ["libSDL3", "libfreetype", "libsodium", "libsqlite3", "libwhisper", "liblore", "libllama_ffi", "libmpv", "libbox2d", "libvterm", "libluajit", "libllama", "libggml"];
    const sysrootLib = `${rjitHome}/deps/sysroot/usr/lib`;
    const ldd = spawnSync("ldd", [buildBin]);
    let count = 0;
    for (const line of ldd.stdout.split("\n")) {
      if (!line.trim() || line.includes("linux-vdso")) continue;
      const soname = line.trim().replace(/\s*=>.*$/, "");
      if (!prefixes.some((prefix) => soname === `${prefix}.so` || soname.startsWith(`${prefix}.so.`))) continue;
      const sysroot = `${sysrootLib}/${soname}`;
      const path = fsExists(sysroot) ? sysroot : line.match(/=>\s+([^ ]+)/)?.[1] ?? "";
      if (!path || !fsExists(path) || fsExists(`${libDir}/${soname}`)) continue;
      runOrThrow("cp", ["-L", path, `${libDir}/${soname}`]);
      count++;
    }
    if (fat && fsExists(sysrootLib)) {
      runOrThrow("sh", ["-c", `cp -a "${sysrootLib}"/*.so* "${libDir}"/ 2>/dev/null || true`]);
    }
    out(`[ship]   bundled ${count} SDK-owned lib(s)`);
    return count;
  }
  function writeDesktopFiles(tmpDir, name, icon) {
    const iconFile = `${name}.${extension(icon)}`;
    fsMkdir(`${tmpDir}/share/icons`);
    fsMkdir(`${tmpDir}/share/applications`);
    runOrThrow("cp", [icon, `${tmpDir}/share/icons/${iconFile}`]);
    fsWrite(`${tmpDir}/share/applications/${name}.desktop.in`, `[Desktop Entry]
Type=Application
Name=${name}
Exec=@EXEC@
Icon=@ICON@
Terminal=false
Categories=Development;
`);
  }
  function writeLauncher(path) {
    fsWrite(path, `#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="$DIR/lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$DIR/app.bin" "$@"
`);
    runOrThrow("chmod", ["+x", path]);
  }
  function writeSelfExtractor2(buildBin, tarball, name, iconFile) {
    const staged = `${buildBin}.staged`;
    const header = `#!/bin/sh
set -e
APP_DIR=\${XDG_CACHE_HOME:-$HOME/.cache}/reactjit-${name}
SIG=$(md5sum "$0" 2>/dev/null | cut -c1-8 || cksum "$0" | cut -d" " -f1)
CACHE="$APP_DIR/$SIG"
ICON_FILE="${iconFile}"
if [ ! -f "$CACHE/.ready" ]; then
  rm -rf "$APP_DIR"
  mkdir -p "$CACHE"
  SKIP=$(awk '/^__ARCHIVE__$/{print NR + 1; exit}' "$0")
  tail -n+"$SKIP" "$0" | tar xz -C "$CACHE"
  if [ -n "$ICON_FILE" ] && [ -f "$CACHE/share/applications/${name}.desktop.in" ]; then
    sed "s|@EXEC@|$CACHE/run|g; s|@ICON@|$CACHE/share/icons/$ICON_FILE|g" "$CACHE/share/applications/${name}.desktop.in" > "$CACHE/share/applications/${name}.desktop"
  fi
  touch "$CACHE/.ready"
fi
exec "$CACHE/run" "$@"
__ARCHIVE__
`;
    fsWrite(staged, header);
    runOrThrow("sh", ["-c", `cat "${tarball}" >> "${staged}" && chmod +x "${staged}" && mv -f "${staged}" "${buildBin}"`]);
  }
  function runOrThrow(cmd, args) {
    const result = spawnSync(cmd, args);
    writeSpawnOutput6(result);
    if (result.code !== 0) throw new Error(`${cmd} exited ${result.code}`);
  }
  function writeSpawnOutput6(result) {
    if (result.stderr) __writeStderr(result.stderr);
    if (result.stdout) __writeStdout(result.stdout);
  }
  function fail9(message, code) {
    err(`[ship] ${message}`);
    return code;
  }
  function dirname6(path) {
    const index = path.lastIndexOf("/");
    return index <= 0 ? "/" : path.slice(0, index);
  }
  function extension(path) {
    const index = path.lastIndexOf(".");
    return index < 0 ? "" : path.slice(index + 1).toLowerCase();
  }

  // cli/commands/ship-tui.ts
  var ship_tui_exports = {};
  __export(ship_tui_exports, {
    run: () => run25
  });
  async function run25(argv) {
    return run24([...argv, "--tui"]);
  }

  // cli/commands/shot.ts
  var shot_exports = {};
  __export(shot_exports, {
    run: () => run26
  });
  async function run26(argv) {
    let name = null;
    let outPath = null;
    let route = null;
    let frames = 60;
    let timeoutS = 120;
    const binaryArgs = [];
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--") {
        binaryArgs.push(...argv.slice(i + 1));
        break;
      }
      if (arg === "--out" || arg === "-o") {
        outPath = argv[++i] ?? null;
        continue;
      }
      if (arg === "--route" || arg === "-r") {
        route = argv[++i] ?? null;
        continue;
      }
      if (arg === "--frames") {
        frames = Math.max(1, Number(argv[++i] ?? 60) || 60);
        continue;
      }
      if (arg === "--timeout") {
        timeoutS = Math.max(5, Number(argv[++i] ?? 120) || 120);
        continue;
      }
      if (arg.startsWith("-")) return usage6(`unknown flag: ${arg}`);
      if (name === null) {
        name = arg;
        continue;
      }
      return usage6("too many positional args");
    }
    if (!name) return usage6("missing cart name");
    const root = __cwd();
    const cartEntry = resolveCartEntry(root, name);
    if (!cartEntry) return fail10(`[shot] no cart found for ${name} (expected cart/${name}/index.tsx or cart/${name}.tsx)`);
    const binary = `${root}/zig-out/bin/${name}`;
    if (!binaryCurrent2(binary, cartEntry)) {
      out(`[shot] ${name} binary is stale/missing \u2014 building via ship...`);
      const build = spawnSync(`${root}/tools/rjit`, ["ship", name]);
      if (build.stderr) __writeStderr(build.stderr);
      if (build.code !== 0) return fail10("[shot] BUILD FAILED");
    }
    if (!fsExists(binary)) return fail10(`[shot] binary not found at zig-out/bin/${name}`);
    const png = outPath ?? `${root}/shots/${name}-${dateStamp2()}.png`;
    fsMkdir(dirname7(png));
    const env = [
      "ZIGOS_HEADLESS=1",
      "ZIGOS_SCREENSHOT=1",
      `ZIGOS_SCREENSHOT_OUTPUT=${shellQuote4(png)}`,
      `ZIGOS_SCREENSHOT_FRAMES=${frames}`,
      ...route ? [`RJIT_BOOT_ROUTE=${shellQuote4(route)}`] : []
    ].join(" ");
    out(`[shot] booting ${name} hidden${route ? ` at ${route}` : ""}, capturing after ${frames} frames...`);
    const argText = binaryArgs.map(shellQuote4).join(" ");
    const cmd = `${env} timeout -s KILL ${timeoutS} ${shellQuote4(binary)} ${argText}`;
    out(`[shot] command: ${cmd}`);
    const result = spawnSync("sh", ["-c", `${cmd} 2>&1 | grep -E "SCREENSHOT|capture|RJIT_PLAYER_ARGV" || true`]);
    if (result.stdout) __writeStdout(result.stdout);
    if (!fsExists(png)) return fail10(`[shot] FAIL \u2014 no PNG at ${png} (did the app crash before frame ${frames}?)`);
    const size = fsStat(png).size;
    if (size < 1024) return fail10(`[shot] FAIL \u2014 ${png} is ${size} bytes (implausibly small for a rendered frame)`);
    const dims = pngDims(png);
    if (!dims) return fail10(`[shot] FAIL \u2014 ${png} is not a well-formed PNG (bad magic/IHDR)`);
    out(`[shot] PASS \u2014 ${png} (${dims.w}x${dims.h}, ${size} bytes)`);
    return 0;
  }
  function resolveCartEntry(root, name) {
    const dirEntry = `${root}/cart/${name}/index.tsx`;
    if (fsExists(dirEntry)) return dirEntry;
    const fileEntry = `${root}/cart/${name}.tsx`;
    if (fsExists(fileEntry)) return fileEntry;
    return null;
  }
  function binaryCurrent2(binary, cartEntry) {
    if (!fsExists(binary)) return false;
    const dirCart = cartEntry.endsWith("/index.tsx");
    const sourceRoot = dirCart ? dirname7(cartEntry) : cartEntry;
    return fsStat(binary).mtimeMs >= newestMtime(sourceRoot);
  }
  function newestMtime(path) {
    const st = tryFsStat(path);
    if (!st) return 0;
    if (!st.isDir) return st.mtimeMs;
    let newest = st.mtimeMs;
    for (const entry of fsList(path)) {
      if (entry === "." || entry === "..") continue;
      const m = newestMtime(`${path}/${entry}`);
      if (m > newest) newest = m;
    }
    return newest;
  }
  function pngDims(path) {
    const dump = spawnSync("sh", ["-c", `head -c 24 ${shellQuote4(path)} | od -An -v -tu1`]);
    const bytes = dump.stdout.trim().split(/\s+/).map((token) => Number(token));
    if (bytes.length < 24 || bytes.some((value) => !Number.isFinite(value))) return null;
    const magic = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (bytes[i] !== magic[i]) return null;
    if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
    const w = bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19];
    const h = bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23];
    if (w <= 0 || h <= 0) return null;
    return { w, h };
  }
  function dateStamp2() {
    const result = spawnSync("date", ["+%Y%m%d_%H%M%S"]);
    return result.stdout.trim() || String(Math.floor(__nowMs()));
  }
  function dirname7(path) {
    const idx = path.lastIndexOf("/");
    return idx <= 0 ? "/" : path.slice(0, idx);
  }
  function shellQuote4(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
  function usage6(message) {
    err(`[shot] ${message}`);
    err("Usage: rjit shot <cart> [--out path.png] [--route /r] [--frames N] [--timeout S] [-- app-args...]");
    err("  Captures the cart's OWN rendered frame headless (hidden window \u2014 the");
    err("  user's desktop is never touched). Asserts a well-formed PNG; exit 0 = PASS.");
    return 2;
  }
  function fail10(message) {
    err(message);
    return 1;
  }

  // cli/commands/tui.ts
  var tui_exports = {};
  __export(tui_exports, {
    run: () => run27
  });
  async function run27(argv) {
    const parsed = parseTuiArgs(argv);
    if (typeof parsed === "number") return parsed;
    const cartRoot = __cwd();
    const rjitHome = __env("RJIT_HOME") || cartRoot;
    const cart = resolveTarget2(cartRoot, parsed.target);
    if (!cart) {
      return fail11(`[tui] not found: ${parsed.target} (expected cart/<name>/index.tsx, cart/<name>.tsx, or an entry path)`, 1);
    }
    runFixReactImports4(rjitHome, cartRoot);
    const bundleOut = `${cartRoot}/.cache/tui-bundle-${cart.name}.js`;
    fsMkdir(`${cartRoot}/.cache`);
    const term = terminalSize3();
    out(`[tui] bundling ${cart.entry} -> ${bundleOut}`);
    const bundle2 = bundleCart({
      rjitHome,
      cartEntry: cart.entry,
      outFile: bundleOut,
      mode: "tui-host",
      termCols: term.cols,
      termRows: term.rows
    });
    writeSpawnOutput7(bundle2);
    if (bundle2.code !== 0) return bundle2.code || 1;
    const bin = `${rjitHome}/zig-out/bin/${cart.name}`;
    const built = buildTuiBinary(rjitHome, cartRoot, cart.name, bundleOut, bin);
    if (built !== 0) return built;
    out(`[tui] running ${bin}`);
    return runForeground(cart, bin, parsed.appArgs);
  }
  function parseTuiArgs(argv) {
    let target = "";
    let appArgs = [];
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--help" || arg === "-h") return usage7(0);
      if (arg === "--") {
        appArgs = argv.slice(i + 1);
        break;
      }
      if (arg.startsWith("--")) {
        err(`[tui] unknown flag: ${arg}`);
        return usage7(1);
      }
      if (target) {
        err(`[tui] unexpected positional arg: ${arg}`);
        return usage7(1);
      }
      target = arg;
    }
    return { target: target || "tui/examples/counter.tsx", appArgs };
  }
  function usage7(code = 1) {
    err("Usage: rjit tui [cart-name|entry.tsx] [-- app-args...]");
    err("  Builds a TUI bundle and execs the headless app in the foreground terminal.");
    err("  Use `rjit dev <cart-name> --tui` for the experimental persistent TUI dev host.");
    return code;
  }
  function resolveTarget2(root, target) {
    const direct = ensureAbs2(root, target);
    if (fsExists(direct)) return cartFromEntry(direct);
    const dirEntry = `${root}/cart/${target}/index.tsx`;
    if (fsExists(dirEntry)) return { name: target, entry: dirEntry, dir: dirname8(dirEntry) };
    const fileEntry = `${root}/cart/${target}.tsx`;
    if (fsExists(fileEntry)) return { name: target, entry: fileEntry, dir: dirname8(fileEntry) };
    return null;
  }
  function cartFromEntry(entry) {
    let name = basenameNoExt(entry);
    const dir = dirname8(entry);
    if (name === "index") name = basename4(dir);
    return { name: sanitizeName2(name), entry, dir };
  }
  function buildTuiBinary(rjitHome, cartRoot, name, bundlePath, bin) {
    const zig = resolveZig5(rjitHome);
    const args = [
      "build",
      "app",
      "-p",
      `${rjitHome}/zig-out`,
      `-Dapp-name=${name}`,
      "-Dapp-source=framework/v8_app.zig",
      `-Dbundle-path=${bundlePath}`,
      ...legacyTuiFlags(),
      "-Dhas-gpu=false",
      "-Doptimize=ReleaseFast"
    ];
    out(`[tui] compiling native binary (${bin}, ReleaseFast)...`);
    const cmd = cartRoot === rjitHome ? zig : "env";
    const finalArgs = cartRoot === rjitHome ? args : [`ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...args];
    const build = spawnSync(cmd, finalArgs);
    writeSpawnOutput7(build);
    if (build.code !== 0) return build.code || 1;
    trimZigCacheIfOversized(rjitHome);
    if (!fsExists(bin)) return fail11(`[tui] build produced no binary: ${bin}`, 1);
    return 0;
  }
  function legacyTuiFlags() {
    return [
      "-Duse-v8=true",
      "-Dhas-terminal=true",
      "-Dhas-httpsrv=true",
      "-Dhas-wssrv=true",
      "-Dhas-process=true",
      "-Dhas-net=true",
      "-Dhas-sdk=true",
      "-Dhas-fs=true"
    ];
  }
  function runForeground(cart, bin, appArgs) {
    const shell = 'if [ -r /dev/tty ] && [ -w /dev/tty ]; then exec < /dev/tty > /dev/tty 2>&1; fi; exec "$@"';
    const result = spawnSync("sh", [
      "-c",
      shell,
      "rjit-tui",
      "env",
      `RJIT_DEV_CART_DIR=${cart.dir}`,
      bin,
      ...appArgs
    ]);
    writeSpawnOutput7(result);
    return result.code === 0 ? 0 : result.code || 1;
  }
  function runFixReactImports4(rjitHome, cartRoot) {
    const script = `${rjitHome}/scripts/fix-react-imports`;
    if (!fsExists(script)) return;
    const result = spawnSync("env", [`RJIT_HOME=${rjitHome}`, `CART_ROOT=${cartRoot}`, script]);
    writeSpawnOutput7(result);
    if (result.code !== 0) throw new Error(`fix-react-imports exited ${result.code}`);
  }
  function terminalSize3() {
    try {
      const parsed = JSON.parse(__termSize());
      return { cols: parsed[0] || 80, rows: parsed[1] || 24 };
    } catch {
      return { cols: 80, rows: 24 };
    }
  }
  function resolveZig5(rjitHome) {
    const bundled = __env("REACTJIT_ZIG") || `${rjitHome}/tools/zig/zig`;
    if (fsExists(bundled)) return bundled;
    return "zig";
  }
  function ensureAbs2(root, path) {
    if (path.startsWith("/")) return path;
    const trimmed = path.startsWith("./") ? path.slice(2) : path;
    return `${root}/${trimmed}`;
  }
  function dirname8(path) {
    const idx = path.lastIndexOf("/");
    return idx <= 0 ? "/" : path.slice(0, idx);
  }
  function basename4(path) {
    const idx = path.lastIndexOf("/");
    return idx < 0 ? path : path.slice(idx + 1);
  }
  function basenameNoExt(path) {
    const name = basename4(path);
    const idx = name.lastIndexOf(".");
    return idx < 0 ? name : name.slice(0, idx);
  }
  function sanitizeName2(name) {
    return name.replace(/[^A-Za-z0-9_.-]/g, "_");
  }
  function writeSpawnOutput7(result) {
    if (result.stdout) __writeStdout(result.stdout);
    if (result.stderr) __writeStderr(result.stderr);
  }
  function fail11(message, code) {
    err(message);
    return code;
  }

  // cli/commands/watch-and-push.ts
  var watch_and_push_exports = {};
  __export(watch_and_push_exports, {
    run: () => run28
  });
  var POLL_MS = 200;
  async function run28(argv) {
    const cartName = argv[0];
    const cartFile = argv[1];
    const outPath = argv[2];
    const tui = argv.includes("--tui") || argv.includes("--headless");
    const rjitHome = flagValue(argv, "--rjit-home") ?? __cwd();
    const expectedCoreBuildId = flagValue(argv, "--core-build-id");
    if (!cartName || !cartFile || !outPath) {
      err("[watch-and-push] usage: watch-and-push.js <cart-name> <cart-file> <out-path>");
      return 1;
    }
    const root = __cwd();
    const entryAbs = toAbs(root, cartFile);
    const outAbs = toAbs(root, outPath);
    const flags = bundleFlags({
      rjitHome: root,
      cartEntry: entryAbs,
      outFile: outAbs,
      mode: tui ? "tui-host" : "gpu-host",
      watch: true,
      metafile: false
    });
    try {
      spawn(`${root}/tools/esbuild`, flags);
    } catch {
      err("[watch-and-push] failed to spawn esbuild");
      return 1;
    }
    out(`[dev] watching ${cartFile} - edits rebuild + push automatically (ctrl-c to stop)`);
    let lastMtime = 0;
    while (true) {
      __sleepMs(POLL_MS);
      const mtime = statMtime(outAbs);
      if (mtime !== 0 && mtime !== lastMtime) {
        lastMtime = mtime;
        push(root, rjitHome, cartName, outAbs, expectedCoreBuildId);
      }
    }
  }
  function flagValue(argv, flag) {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] ?? null : null;
  }
  function toAbs(root, path) {
    if (path.startsWith("/")) return path;
    const trimmed = path.startsWith("./") ? path.slice(2) : path;
    return `${root}/${trimmed}`;
  }
  function statMtime(path) {
    const stat = tryFsStat(path);
    return stat ? Number(stat.mtimeMs) || 0 : 0;
  }
  function push(root, rjitHome, cartName, outAbs, expectedCoreBuildId) {
    const host = readDevHostInfo(DEV_SOCKET_PATH);
    const publishedCoreBuildId = readCoreRecord(rjitHome)?.sourceHash ?? expectedCoreBuildId;
    if (publishedCoreBuildId && host && host.build_id !== publishedCoreBuildId) {
      err(`[dev ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}] cold core restart in progress - running ${shortHash(host.build_id)} / expected ${shortHash(publishedCoreBuildId)}`);
      return;
    }
    const result = spawnSync(`${root}/tools/rjit`, ["push-bundle", cartName, outAbs]);
    const timestamp = (/* @__PURE__ */ new Date()).toLocaleTimeString();
    if (result.code === 0) {
      out(`[dev ${timestamp}] rebuilt - pushed '${cartName}'`);
    } else if (result.code === 2) {
    } else {
      if (result.stderr) __writeStderr(result.stderr);
      err(`[dev ${timestamp}] push exit ${result.code}`);
    }
  }

  // cli/main.ts
  var COMMANDS = {
    "autotest": autotest_exports,
    "bake-geometry": bake_geometry_exports,
    "bake-geometry-auto": bake_geometry_auto_exports,
    "bake-icons": bake_icons_exports,
    "cart-bundle": cart_bundle_exports,
    "cart-manifest-field": cart_manifest_field_exports,
    "classify": classify_exports,
    "clean": clean_exports,
    "orphans": orphans_exports,
    "codegen-bindings": codegen_bindings_exports,
    "dev": dev_exports,
    "firecracker-build": firecracker_build_exports,
    "game": game_exports,
    "gdev": gdev_exports,
    "help": help_exports,
    "init": init_exports,
    "lab": lab_exports,
    "metafile-gate": metafile_gate_exports,
    "pack": pack_exports,
    "pack-sdk": pack_sdk_exports,
    "play": play_exports,
    "push-bundle": push_bundle_exports,
    "repo": repo_exports,
    "ship": ship_exports,
    "ship-tui": ship_tui_exports,
    "shot": shot_exports,
    "tui": tui_exports,
    "watch-and-push": watch_and_push_exports
  };
  async function main() {
    const subcommand = process.argv[1];
    if (!subcommand) {
      printTopLevel();
      return 0;
    }
    const command = COMMANDS[subcommand];
    if (!command) {
      err(`rjit: unknown subcommand: ${subcommand}`);
      err("try: rjit help");
      return 1;
    }
    return command.run(process.argv.slice(2));
  }
  main().then(__exit, (error) => {
    err(`rjit: ${error.message}`);
    __exit(1);
  });
})();
