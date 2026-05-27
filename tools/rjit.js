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

  // cli/commands/cart-manifest-field.ts
  var cart_manifest_field_exports = {};
  __export(cart_manifest_field_exports, {
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
  async function run2(argv) {
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
    run: () => run3
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
      `--alias:@reactjit/core=${opts.rjitHome}/runtime/core_stub.ts`,
      `--alias:@reactjit/runtime=${opts.rjitHome}/runtime`,
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
  async function run3(argv) {
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
    run: () => run4
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
  function normalizePath(value) {
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
    return normalizePath(filtered.join("/"));
  }
  function basename2(pathValue) {
    const normalized = normalizePath(pathValue);
    if (!normalized || normalized === "/") return "";
    const segs = normalized.split("/");
    return segs[segs.length - 1];
  }
  function splitPath(pathValue) {
    const normalized = normalizePath(pathValue);
    if (normalized === "/" || normalized === ".") return { absolute: normalized === "/", parts: [] };
    const absolute = normalized.startsWith("/");
    const noRoot = absolute ? normalized.slice(1) : normalized;
    return { absolute, parts: noRoot ? noRoot.split("/") : [] };
  }
  function relative(from, to) {
    const fromParts = splitPath(from);
    const toParts = splitPath(to);
    if (fromParts.absolute !== toParts.absolute) return normalizePath(to);
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
  function loadTypeScript() {
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
  function injectFlexDirectionForTag(tagName, styleStatics) {
    if ((tagName === "Row" || tagName === "FlexRow") && !("flexDirection" in styleStatics)) {
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
      const tagName = getTagName(element, ts);
      const primitive = tagName ? TAG_TO_PRIMITIVE[tagName] : null;
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
        injectFlexDirectionForTag(tagName, styleStatics);
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
          const pos = ts.getLineAndCharacterOfPosition(sourceFile, element.getStart(sourceFile));
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
            line: pos.line + 1,
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
          const tagName = getTagName(element, ts);
          const primitive = tagName ? TAG_TO_PRIMITIVE[tagName] : null;
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
            injectFlexDirectionForTag(tagName, styleStatics);
            if (!hasSpread && dynamicKeys.length === 0) {
              const jsxProps = extractJsxProps(element, ts);
              const propCount = Object.keys(styleStatics).length + Object.keys(jsxProps).length;
              if (propCount > 0) {
                const pos = ts.getLineAndCharacterOfPosition(sf, element.getStart(sf));
                elements.push({
                  primitive,
                  styleStatics,
                  jsxProps,
                  file: filePath,
                  line: pos.line + 1
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
        const sub = findRenameTargets(full);
        results.cls.push(...sub.cls);
        results.tsx.push(...sub.tsx);
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
            const key = ep.name.text;
            if (key === "style" && ts.isObjectLiteralExpression(ep.initializer)) {
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
                  entry[key] = exportedConsts[objName][propName];
                }
              } else if (value !== null) {
                entry[key] = value;
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
        const tagName = getTagName(element, ts);
        const primitive = tagName ? TAG_TO_PRIMITIVE[tagName] : null;
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
          injectFlexDirectionForTag(tagName, styleStatics);
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
    let def;
    try {
      def = JSON.parse(defStr);
    } catch (e) {
      console.error(`  Invalid JSON definition: ${e.message}`);
      console.error(`  Got: ${defStr}`);
      process2.exit(1);
    }
    const primitive = def.type;
    if (!primitive || !CLASSIFIER_PRIMITIVES.has(primitive)) {
      console.error(`  Invalid type "${primitive}". Valid: ${[...CLASSIFIER_PRIMITIVES].join(", ")}`);
      process2.exit(1);
    }
    const styleStatics = { ...def.style || {} };
    const jsxProps = {};
    for (const [k, v] of Object.entries(def)) {
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
    const entryStyleStatics = { ...def.style || {} };
    const entryJsxProps = {};
    for (const [k, v] of Object.entries(def)) {
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
                const key = rest.slice(0, eq);
                const val = JSON.parse(rest.slice(eq + 1));
                if (isStyle) styleStatics[key] = val;
                else jsxProps[key] = val;
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
    const def = { type: primitive };
    if (primitive === "Text") {
      if (styleStatics.fontSize != null) def.size = styleStatics.fontSize;
      if (styleStatics.fontWeight === "bold") def.bold = true;
      if (styleStatics.color != null) def.color = styleStatics.color;
      const remaining = {};
      for (const [k, v] of Object.entries(styleStatics)) {
        if (k !== "fontSize" && k !== "fontWeight" && k !== "color") remaining[k] = v;
      }
      if (Object.keys(remaining).length > 0) def.style = remaining;
    } else {
      if (Object.keys(styleStatics).length > 0) def.style = styleStatics;
    }
    for (const [k, v] of Object.entries(jsxProps)) def[k] = v;
    return JSON.stringify(def);
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
            const key = typeof v === "string" ? v.toLowerCase() : v;
            if (!bucket.has(key)) bucket.set(key, { value: v, count: 0, props: /* @__PURE__ */ new Map(), files: /* @__PURE__ */ new Set() });
            const entry = bucket.get(key);
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
      ts = loadTypeScript();
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
  async function run4(argv) {
    try {
      await classifyCommand(argv);
      return 0;
    } catch (err2) {
      console.error(err2);
      return 1;
    }
  }

  // cli/commands/codegen-bindings.ts
  var codegen_bindings_exports = {};
  __export(codegen_bindings_exports, {
    run: () => run5
  });
  async function run5(argv) {
    const args = parseArgs(argv, { flags: { check: "bool", strict: "bool" } });
    const ingredients = loadIngredients();
    const zig = emitZig(ingredients);
    const dts = emitDts(ingredients);
    const json = emitJson(ingredients);
    const outputs = [
      { path: "framework/_generated_bindings.zig", content: zig },
      { path: "runtime/_generated_host_globals.d.ts", content: dts },
      { path: "sdk/bindings.generated.json", content: json }
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
    for (const output of outputs) fsWrite(output.path, output.content);
    out(`codegen-bindings: wrote ${outputs.map((x) => x.path).join(", ")}`);
    if (args.flags.strict) {
      out("codegen-bindings: strict lints are not active until hook declarations land");
    }
    return 0;
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
  function emitZig(ingredients) {
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
  function mustMatch(source, re, context) {
    const match = re.exec(source);
    if (!match) throw new Error(`cannot parse ingredient row: ${context}`);
    return match[1];
  }

  // cli/commands/dev.ts
  var dev_exports = {};
  __export(dev_exports, {
    run: () => run6
  });
  async function run6(argv) {
    const parsed = parseDevArgs(argv);
    if (typeof parsed === "number") return parsed;
    const cartRoot = __cwd();
    const rjitHome = __env("RJIT_HOME") || cartRoot;
    const cart = resolveCart2(cartRoot, parsed.name);
    if (!cart) return fail2(`[dev] not found: ${cartRoot}/cart/${parsed.name}/index.tsx or ${cartRoot}/cart/${parsed.name}.tsx`, 1);
    const substrate = resolveSubstrate(parsed.substrateFlag, cart.manifest);
    const bundleMode = substrate === "tui" ? "tui-host" : "gpu-host";
    const perCartBundle = `${cartRoot}/.cache/bundle-${parsed.name}.js`;
    const binName = substrate === "tui" ? "reactjit-dev-tui" : "reactjit-dev";
    const bin = `${rjitHome}/zig-out/bin/${binName}`;
    fsMkdir(`${cartRoot}/.cache`);
    runFixReactImports(rjitHome, cartRoot);
    reapOrphanWatchers();
    out(`[dev] bundling ${cart.entry} -> ${perCartBundle}`);
    const term = terminalSize();
    const bundle = bundleCart({
      rjitHome,
      cartEntry: cart.entry,
      outFile: perCartBundle,
      mode: bundleMode,
      termCols: term.cols,
      termRows: term.rows
    });
    writeSpawnOutput2(bundle);
    if (bundle.code !== 0) return bundle.code || 1;
    const needsBuild = devHostNeedsBuild(rjitHome, bin);
    const socket = "/tmp/reactjit.sock";
    const hostAlive = isHostAlive(socket);
    if (hostAlive) {
      if (needsBuild) {
        err("[dev] STALE DEV HOST - running binary predates current framework source.");
        err("[dev] refusing to push: bundle would talk to yesterday's native code.");
        err("[dev] kill the running dev host (ctrl-c its terminal) and rerun this command.");
        err(`[dev] inputs newer than ${bin}:`);
        for (const path of newerInputs(rjitHome, bin).slice(0, 10)) err(`[dev]   ${path}`);
        return 1;
      }
      out(`[dev] host detected - pushing '${parsed.name}'`);
      const push2 = spawnSync(`${rjitHome}/tools/rjit`, ["push-bundle", parsed.name, perCartBundle]);
      writeSpawnOutput2(push2);
      if (push2.code === 0) {
        out(`[dev] host switched to tab '${parsed.name}'`);
        return 0;
      }
      fsRemove(socket);
    }
    fsWrite(`${rjitHome}/bundle.js`, fsRead(perCartBundle));
    if (needsBuild && fsExists(bin)) out("[dev] dev host inputs newer than binary - rebuilding...");
    if (needsBuild) {
      const built = buildDevHost(rjitHome, cartRoot, binName, substrate, perCartBundle);
      if (built !== 0) return built;
    }
    ensurePgRunning(rjitHome);
    const child = spawn("env", [`RJIT_DEV_CART_DIR=${cart.dir}`, bin]);
    out(`[dev] host child=${child.id} - run 'rjit dev <other>' from another terminal to add tabs`);
    const watchArgs = ["watch-and-push", parsed.name, cart.entry, perCartBundle];
    if (substrate === "tui") watchArgs.push("--tui");
    const watcher = spawn(`${rjitHome}/tools/rjit`, watchArgs);
    drainUntilExit(child.id, watcher.id);
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
    if (fsExists(dirEntry)) return { entry: dirEntry, dir: dirname(dirEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
    const fileEntry = `${cartRoot}/cart/${name}.tsx`;
    if (fsExists(fileEntry)) return { entry: fileEntry, dir: dirname(fileEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
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
  function reapOrphanWatchers() {
    const pids = spawnSync("pgrep", ["-f", "scripts/watch-and-push.js|tools/rjit.js watch-and-push|tools/rjit watch-and-push"]);
    if (pids.code !== 0) return;
    for (const pid of pids.stdout.trim().split(/\s+/).filter(Boolean)) {
      const ppid = spawnSync("ps", ["-o", "ppid=", "-p", pid]).stdout.trim();
      if (ppid === "1") {
        spawnSync("pkill", ["-TERM", "-P", pid]);
        spawnSync("kill", ["-TERM", pid]);
        err(`[dev] reaped orphan watcher pid=${pid}`);
      }
    }
  }
  function devHostNeedsBuild(rjitHome, bin) {
    if (!fsExists(bin)) return true;
    return newerInputs(rjitHome, bin).length > 0;
  }
  function newerInputs(rjitHome, bin) {
    const candidates = [
      `${rjitHome}/framework`,
      `${rjitHome}/build.zig`,
      `${rjitHome}/v8_app.zig`,
      `${rjitHome}/sdk/dependency-registry.json`,
      `${rjitHome}/scripts/sdk-dependency-resolve.js`,
      `${rjitHome}/tools/zig/zig`
    ].filter((path) => fsExists(path));
    if (candidates.length === 0) return [];
    const args = [
      ...candidates,
      "-newer",
      bin
    ];
    const result = spawnSync("find", args);
    if (result.code !== 0) return [];
    return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  function isHostAlive(socket) {
    if (!fsExists(socket)) return false;
    const ss = spawnSync("ss", ["-lUp"]);
    if (ss.code === 0 && ss.stdout.includes(socket)) return true;
    fsRemove(socket);
    return false;
  }
  function buildDevHost(rjitHome, cartRoot, binName, substrate, bundlePath) {
    out(`[dev] compiling dev binary (${rjitHome}/zig-out/bin/${binName}, ${substrate}, ReleaseFast)...`);
    const flagsResult = spawnSync(`${rjitHome}/tools/rjit`, ["metafile-gate", "--format", "dev-zig-flags", "--build-zig", `${rjitHome}/build.zig`]);
    writeSpawnOutput2(flagsResult);
    if (flagsResult.code !== 0) return flagsResult.code || 1;
    const devFlags = flagsResult.stdout.trim().split(/\s+/).filter(Boolean);
    if (devFlags.length === 0) return fail2("[dev] FATAL: sdk-dependency-resolve produced no dev flags", 1);
    const zig = resolveZig(rjitHome);
    const args = [
      "build",
      "app",
      "-p",
      `${rjitHome}/zig-out`,
      `-Dapp-name=${binName}`,
      "-Dapp-source=v8_app.zig",
      `-Dbundle-path=${bundlePath}`,
      ...devFlags,
      "-Doptimize=ReleaseFast"
    ];
    if (substrate === "tui") args.push("-Dhas-gpu=false");
    const cmd = cartRoot === rjitHome ? zig : "env";
    const finalArgs = cartRoot === rjitHome ? args : [`ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...args];
    const build = spawnSync(cmd, finalArgs);
    writeSpawnOutput2(build);
    return build.code === 0 ? 0 : build.code || 1;
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
  function drainUntilExit(hostId, watcherId) {
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
  function writeSpawnOutput2(result) {
    if (result.stdout) __writeStdout(result.stdout);
    if (result.stderr) __writeStderr(result.stderr);
  }
  function dirname(path) {
    const idx = path.lastIndexOf("/");
    return idx <= 0 ? "/" : path.slice(0, idx);
  }
  function fail2(message, code) {
    err(message);
    return code;
  }

  // cli/commands/firecracker-build.ts
  var firecracker_build_exports = {};
  __export(firecracker_build_exports, {
    run: () => run7
  });
  async function run7(argv) {
    const root = __cwd();
    const parsed = parseArgs2(argv, root);
    if (typeof parsed === "number") return parsed;
    log(`bundling recipe: ${parsed}`);
    const bundled = spawnSync(`${root}/tools/esbuild`, [
      "--bundle",
      "--format=cjs",
      "--platform=neutral",
      "--target=es2022",
      "--log-level=warning",
      parsed
    ]);
    if (bundled.stderr) __writeStderr(bundled.stderr);
    if (bundled.code !== 0) return fail3(`esbuild failed: ${bundled.code}`, bundled.code || 1);
    const spec = evalRecipe(bundled.stdout);
    if (!spec) return fail3("recipe must default-export an object");
    const valid = validateSpec(spec);
    if (valid) return fail3(valid);
    log(`recipe: id=${spec.id} base=${spec.base} apt=${spec.apt.length} steps=${(spec.steps || []).length}`);
    const outPath = abs(root, spec.output.path);
    const outDir = dirname2(outPath);
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
    log(`mmdebstrap -> ${outPath}`);
    const t0 = __nowMs();
    const mmdb = runTee("/usr/bin/mmdebstrap", mmdbArgs);
    if (mmdb !== 0) return mmdb;
    log(`mmdebstrap done in ${((__nowMs() - t0) / 1e3).toFixed(1)}s`);
    if (spec.output.kind === "ext4" && spec.output.sizeMb) {
      const cur = fileSize(outPath);
      const targetBytes = spec.output.sizeMb * 1024 * 1024;
      if (targetBytes > cur) {
        log(`growing ext4: ${cur >> 20}MB -> ${spec.output.sizeMb}MB`);
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
    log(`manifest -> ${manifestPath}`);
    log(`done. output: ${outPath} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
    return 0;
  }
  function parseArgs2(argv, root) {
    let recipePath = "";
    for (const arg of argv) {
      if (arg.startsWith("--")) return fail3(`unknown flag: ${arg}`);
      if (!recipePath) recipePath = arg;
      else return fail3(`extra positional arg: ${arg}`);
    }
    if (!recipePath) return fail3("usage: firecracker-build.js <recipe.ts>");
    const resolved = abs(root, recipePath);
    if (!fsExists(resolved)) return fail3(`recipe not found: ${resolved}`);
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
        if (!fsExists(src)) return fail3(`copyFromHost src not found: ${src}`);
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
        return fail3(`unknown step shape: ${JSON.stringify(step)}`);
      }
    }
    return hooks;
  }
  function runTee(bin, args) {
    const result = spawnSync(bin, args);
    if (result.stdout) __writeStdout(result.stdout);
    if (result.stderr) __writeStderr(result.stderr);
    if (result.code !== 0) return fail3(`${bin} exited ${result.code}`, result.code || 1);
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
  function dirname2(path) {
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
  function log(message) {
    out(`[fc-build] ${message}`);
  }
  function fail3(message, code = 1) {
    err(`[fc-build] ${message}`);
    return code;
  }

  // cli/commands/help.ts
  var help_exports = {};
  __export(help_exports, {
    printTopLevel: () => printTopLevel,
    run: () => run8
  });
  var TEMPLATES = ["basic", "routes", "dashboard", "taskboard", "canvas", "stdlib"];
  var SUBCOMMANDS = ["init", "dev", "tui", "ship", "ship-tui", "autotest", "classify", "firecracker-build", "help"];
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
        "edits require a rebuild.",
        "",
        "--tui (alias --headless) runs the headless substrate; --gui is the",
        'default unless cart.json declares "surface": "tui".'
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
      summary: "compatibility alias for dev --tui",
      usage: ["rjit tui <cart-name>"],
      detail: [
        "Equivalent to:",
        "  rjit dev <cart-name> --tui",
        "",
        "Kept for muscle memory during the migration; the canonical command is",
        "rjit dev <cart-name> --tui."
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
  async function run8(argv) {
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
    for (const usage3 of doc.usage) lines.push(`  ${usage3}`);
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
    run: () => run9
  });
  var TEMPLATE_NAMES = ["basic", "routes", "dashboard", "taskboard", "canvas", "stdlib"];
  async function run9(argv) {
    const parsed = parseArgs3(argv);
    if (typeof parsed === "number") return parsed;
    const root = __cwd();
    const template = TEMPLATES2[parsed.template];
    const targetDir = resolveTarget(root, parsed.directory);
    if (fsExists(targetDir)) return fail4(`target already exists: ${displayPath(root, targetDir)}`, 1);
    const name = cartNameFor(targetDir);
    const title = titleForName(name);
    const inCart = dirname3(targetDir) === joinPath(root, "cart");
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
        const path = joinPath(targetDir, fileName);
        const parent = dirname3(path);
        if (!fsExists(parent)) fsMkdir(parent);
        fsWrite(path, content);
      }
    } catch (error) {
      return fail4(error.message, 1);
    }
    out(`[init] created ${displayPath(root, targetDir)}`);
    out(`[init] template ${parsed.template}`);
    if (inCart) out(`[init] run ./scripts/dev ${name}`);
    else out("[init] run ./scripts/dev <cart-name> after moving it under cart/");
    return 0;
  }
  function parseArgs3(argv) {
    if (argv.length === 0) {
      usage2();
      return 2;
    }
    for (const arg of argv) {
      if (arg.startsWith("-")) return fail4("flags are not supported by init", 2);
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
      return fail4(`unknown template: ${b}`, 2);
    }
    return fail4("too many positional arguments", 2);
  }
  function usage2() {
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
  function fail4(message, code) {
    err(`[init] ${message}`);
    return code || 1;
  }
  function normalizePath2(path) {
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
  function joinPath(a, b) {
    if (!a) return normalizePath2(b);
    if (!b) return normalizePath2(a);
    return normalizePath2(a.replace(/\/+$/, "") + "/" + b.replace(/^\/+/, ""));
  }
  function dirname3(path) {
    const normalized = normalizePath2(path);
    const index = normalized.lastIndexOf("/");
    if (index <= 0) return normalized.startsWith("/") ? "/" : ".";
    return normalized.slice(0, index);
  }
  function basename3(path) {
    const normalized = normalizePath2(path);
    const index = normalized.lastIndexOf("/");
    return index === -1 ? normalized : normalized.slice(index + 1);
  }
  function hasPathSeparator(value) {
    return value.includes("/") || value.includes("\\") || value === "." || value === "..";
  }
  function resolveTarget(root, input) {
    if (!input || input.startsWith("-")) throw new Error("directory must be a positional argument, not a flag");
    if (!hasPathSeparator(input) && !input.startsWith("/")) return normalizePath2(joinPath(root, `cart/${input}`));
    if (input.startsWith("/")) return normalizePath2(input);
    return normalizePath2(joinPath(root, input));
  }
  function relativeDir(fromDir, toDir) {
    const from = normalizePath2(fromDir).split("/").filter(Boolean);
    const to = normalizePath2(toDir).split("/").filter(Boolean);
    let index = 0;
    while (index < from.length && index < to.length && from[index] === to[index]) index++;
    const up = from.slice(index).map(() => "..");
    const rel3 = up.concat(to.slice(index)).join("/");
    return rel3 || ".";
  }
  function importPath(root, targetDir, runtimeModule) {
    return `${relativeDir(targetDir, joinPath(root, "runtime"))}/${runtimeModule}`;
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

  // cli/commands/metafile-gate.ts
  var metafile_gate_exports = {};
  __export(metafile_gate_exports, {
    run: () => run10
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
  function loadRegistry(path = "sdk/dependency-registry.json", tag = "registry") {
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
  async function run10(argv) {
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
    const registry = loadRegistry(registryPath, "metafile-gate");
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

  // cli/commands/push-bundle.ts
  var push_bundle_exports = {};
  __export(push_bundle_exports, {
    run: () => run11
  });

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

  // cli/commands/push-bundle.ts
  var SOCKET_PATH = "/tmp/reactjit.sock";
  var TIMEOUT_MS = 3e3;
  async function run11(argv) {
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
    const bundle = tryFsRead(bundlePath);
    if (bundle === null) {
      err(`[push-bundle] cannot read ${bundlePath}`);
      return 1;
    }
    if (!fsExists(SOCKET_PATH)) return 2;
    const fd = tryUnixConnect(SOCKET_PATH);
    if (fd === null) return 2;
    try {
      try {
        unixWrite(fd, `PUSH ${tabName} ${utf8ByteLength(bundle)}
`);
      } catch (error) {
        if (error instanceof SocketError) {
          err("[push-bundle] write header failed");
          return 1;
        }
        throw error;
      }
      try {
        unixWrite(fd, bundle);
      } catch (error) {
        if (error instanceof SocketError) {
          err("[push-bundle] write bundle failed");
          return 1;
        }
        throw error;
      }
      const line = unixReadLine(fd, __nowMs() + TIMEOUT_MS).trim();
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

  // cli/commands/ship.ts
  var ship_exports = {};
  __export(ship_exports, {
    run: () => run12
  });
  async function run12(argv) {
    const parsed = parseShipArgs(argv);
    if (typeof parsed === "number") return parsed;
    const root = __cwd();
    const rjitHome = __env("RJIT_HOME") || root;
    const cartRoot = root;
    const zig = resolveZig2(rjitHome);
    const cart = resolveCart3(cartRoot, parsed.name);
    if (!cart) return fail5(`not found: ${cartRoot}/cart/${parsed.name}/index.tsx or ${cartRoot}/cart/${parsed.name}.tsx`, 1);
    const substrate = resolveSubstrate2(parsed.substrateFlag, cart.manifest);
    const bundleOut = `${cartRoot}/bundle-${parsed.name}.js`;
    const embedBundle = cartRoot === rjitHome ? bundleOut : `${rjitHome}/bundles/bundle-${parsed.name}.js`;
    const icon = resolveIcon(cartRoot, cart, parsed.name);
    if (icon) out(`[ship] app icon: ${icon}`);
    out(`[ship] bundling ${cart.entry} -> ${bundleOut}...`);
    const bundle = bundleCart({
      rjitHome,
      cartEntry: cart.entry,
      outFile: bundleOut,
      mode: substrate === "tui" ? "tui-host" : "gpu-host"
    });
    writeSpawnOutput3(bundle);
    if (bundle.code !== 0) return bundle.code || 1;
    if (embedBundle !== bundleOut) {
      fsMkdir(dirname4(embedBundle));
      const copy = spawnSync("cp", ["-f", bundleOut, embedBundle]);
      writeSpawnOutput3(copy);
      if (copy.code !== 0) return copy.code || 1;
    }
    const customChromeFlag = customChromeFlagFor(cart.manifest, bundleOut);
    const zigFlags = resolveZigFlags(rjitHome, `${bundleOut}.metafile.json`);
    const substrateFlags = substrate === "tui" ? ["-Dhas-gpu=false"] : [];
    const flags = [
      "build",
      "app",
      "-p",
      `${cartRoot}/zig-out`,
      `-Dapp-name=${parsed.name}`,
      "-Dapp-source=v8_app.zig",
      `-Dbundle-path=${embedBundle}`,
      "-Duse-v8=true",
      ...customChromeFlag,
      ...substrateFlags,
      "-Doptimize=ReleaseFast",
      ...zigFlags.filter((flag) => flag !== "-Duse-v8=true")
    ];
    out("[ship] compiling native binary...");
    out(`[ship]   zig flags: ${flags.slice(2).join(" ")}`);
    const build = spawnSync(zig, flags);
    writeSpawnOutput3(build);
    if (build.code !== 0) return build.code || 1;
    const buildBin = `${cartRoot}/zig-out/bin/${parsed.name}`;
    if (!fsExists(buildBin)) return fail5(`build produced no binary: ${buildBin}`, 1);
    if (__env("SHIP_RUN_PACKAGE") === "0") {
      out(`[ship] done (packaging skipped) -> ${buildBin}`);
      return 0;
    }
    if ((__env("OS") || "") === "Darwin") {
      out(`[ship] packaging not implemented in rjit ship for Darwin yet - leaving build output at ${buildBin}`);
      return 0;
    }
    if (spawnSync("uname", ["-s"]).stdout.trim() !== "Linux") {
      out(`[ship] packaging not implemented for this OS - leaving build output at ${buildBin}`);
      return 0;
    }
    return packageLinux({ name: parsed.name, buildBin, rjitHome, cartRoot, fat: parsed.fat, bundleOut, icon });
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
  function resolveCart3(cartRoot, name) {
    const dirEntry = `${cartRoot}/cart/${name}/index.tsx`;
    if (fsExists(dirEntry)) return { entry: dirEntry, dir: dirname4(dirEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
    const fileEntry = `${cartRoot}/cart/${name}.tsx`;
    if (fsExists(fileEntry)) return { entry: fileEntry, dir: dirname4(fileEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
    return null;
  }
  function resolveZig2(rjitHome) {
    const bundled = __env("REACTJIT_ZIG") || `${rjitHome}/tools/zig/zig`;
    if (fsExists(bundled)) return bundled;
    return "zig";
  }
  function resolveSubstrate2(flag, manifestPath) {
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
    const bundle = tryFsRead(bundlePath) ?? "";
    if (bundle.includes("windowDrag")) {
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
    if (enabled.has("sqlite") && !flags.includes("-Dhas-telemetry=true")) flags.push("-Dhas-telemetry=true");
    if (enabled.has("embed") && !flags.includes("-Dhas-pg=true")) flags.push("-Dhas-pg=true");
    return flags;
  }
  function packageLinux(opts) {
    out("[ship] packaging self-extracting binary...");
    const tmpDir = `/tmp/reactjit-dist-${opts.name}`;
    const libDir = `${tmpDir}/lib`;
    const tarball = `/tmp/reactjit-${opts.name}-payload.tar.gz`;
    runOrThrow("rm", ["-rf", tmpDir, tarball]);
    fsMkdir(libDir);
    runOrThrow("cp", [opts.buildBin, `${tmpDir}/app.bin`]);
    const libCount = bundleLinkedLibs(opts.buildBin, libDir, opts.rjitHome, opts.fat);
    if (opts.icon) writeDesktopFiles(tmpDir, opts.name, opts.icon);
    writeLauncher(`${tmpDir}/run`);
    runOrThrow("tar", ["czf", tarball, "-C", tmpDir, "."]);
    writeSelfExtractor(opts.buildBin, tarball, opts.name, opts.icon ? `${opts.name}.${extension(opts.icon)}` : "");
    const size = spawnSync("du", ["-m", opts.buildBin]).stdout.trim().split(/\s+/)[0] || "?";
    out(`[ship] done (${size}MB self-extracting, ${libCount} libs bundled) -> ${opts.buildBin}`);
    runOrThrow("rm", ["-rf", tmpDir, tarball]);
    return 0;
  }
  function bundleLinkedLibs(buildBin, libDir, rjitHome, fat) {
    const prefixes = ["libSDL3", "libfreetype", "libsodium", "libsqlite3", "libwhisper", "libllama_ffi", "libmpv", "libbox2d", "libvterm", "libluajit", "libllama", "libggml"];
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
  function writeSelfExtractor(buildBin, tarball, name, iconFile) {
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
    writeSpawnOutput3(result);
    if (result.code !== 0) throw new Error(`${cmd} exited ${result.code}`);
  }
  function writeSpawnOutput3(result) {
    if (result.stderr) __writeStderr(result.stderr);
    if (result.stdout) __writeStdout(result.stdout);
  }
  function fail5(message, code) {
    err(`[ship] ${message}`);
    return code;
  }
  function dirname4(path) {
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
    run: () => run13
  });
  async function run13(argv) {
    return run12([...argv, "--tui"]);
  }

  // cli/commands/tui.ts
  var tui_exports = {};
  __export(tui_exports, {
    run: () => run14
  });
  async function run14(argv) {
    return run6([...argv, "--tui"]);
  }

  // cli/commands/watch-and-push.ts
  var watch_and_push_exports = {};
  __export(watch_and_push_exports, {
    run: () => run15
  });
  var POLL_MS = 200;
  async function run15(argv) {
    const cartName = argv[0];
    const cartFile = argv[1];
    const outPath = argv[2];
    const tui = argv.includes("--tui") || argv.includes("--headless");
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
        push(root, cartName, outAbs);
      }
    }
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
  function push(root, cartName, outAbs) {
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
    "cart-bundle": cart_bundle_exports,
    "cart-manifest-field": cart_manifest_field_exports,
    "classify": classify_exports,
    "codegen-bindings": codegen_bindings_exports,
    "dev": dev_exports,
    "firecracker-build": firecracker_build_exports,
    "help": help_exports,
    "init": init_exports,
    "metafile-gate": metafile_gate_exports,
    "push-bundle": push_bundle_exports,
    "ship": ship_exports,
    "ship-tui": ship_tui_exports,
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
