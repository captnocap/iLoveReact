// Resolve source-driven SDK/build dependencies from an esbuild metafile.
//
// This script is intentionally runnable through tools/v8cli so the build path
// does not need node or bun. It reads sdk/dependency-registry.json and returns
// the exact features whose trigger inputs survived tree-shaking.

const argv = process.argv.slice(1);

let registryPath = 'sdk/dependency-registry.json';
let metafilePath = '';
let format = 'json';
let buildZigPath = 'build.zig';

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--registry') {
    registryPath = argv[++i] || '';
  } else if (arg === '--metafile') {
    metafilePath = argv[++i] || '';
  } else if (arg === '--format') {
    format = argv[++i] || '';
  } else if (arg === '--build-zig') {
    buildZigPath = argv[++i] || '';
  } else if (!metafilePath) {
    metafilePath = arg;
  } else {
    __writeStderr('[sdk-dependency-resolve] unknown argument: ' + arg + '\n');
    __exit(1);
  }
}

function readJson(path, label) {
  const raw = __fs_read(path);
  if (raw === null) {
    __writeStderr('[sdk-dependency-resolve] cannot read ' + label + ': ' + path + '\n');
    __exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    __writeStderr('[sdk-dependency-resolve] bad json in ' + path + ': ' + (e && e.message) + '\n');
    __exit(1);
  }
}

function readText(path, label) {
  const raw = __fs_read(path);
  if (raw === null) {
    __writeStderr('[sdk-dependency-resolve] cannot read ' + label + ': ' + path + '\n');
    __exit(1);
  }
  return raw;
}

if (!metafilePath && format !== 'dev-zig-flags') {
  __writeStderr('[sdk-dependency-resolve] usage: sdk-dependency-resolve.js [--registry path] --metafile path [--format json|ship-gate|zig-flags|dev-zig-flags]\n');
  __exit(1);
}

const registry = readJson(registryPath, 'registry');
const shipped = new Set();

if (metafilePath) {
  const meta = readJson(metafilePath, 'metafile');
  const outputs = (meta && meta.outputs) || {};
  for (const outName of Object.keys(outputs)) {
    const out = outputs[outName] || {};
    const inputs = out.inputs || {};
    for (const path of Object.keys(inputs)) {
      if ((inputs[path] && inputs[path].bytesInOutput) > 0) shipped.add(path);
    }
  }
}

function triggerMatched(trigger) {
  if (!trigger || !trigger.kind || !trigger.input) return false;
  if (trigger.kind === 'metafileInput' || trigger.kind === 'featureMarker') {
    return shipped.has(trigger.input);
  }
  if (trigger.kind === 'metafileInputPrefix') {
    for (const path of shipped) {
      if (path.indexOf(trigger.input) === 0) return true;
    }
  }
  return false;
}

function addAll(set, values) {
  if (!values) return;
  for (const value of values) set.add(value);
}

const selectedFeatures = [];
const selectedBuildOptions = new Set();
const selectedBindings = new Set();
const selectedLibraries = new Set();
const selectedTools = new Set();
const selectedPackages = new Set();
const gates = {};

const features = registry.features || {};
for (const featureName of Object.keys(features)) {
  const feature = features[featureName] || {};
  const triggers = feature.triggers || [];
  const required = (feature.requiredFor || []).length > 0;
  const matched = required || triggers.some(triggerMatched);
  if (!matched) continue;

  selectedFeatures.push(featureName);
  addAll(selectedBuildOptions, feature.buildOptions);
  addAll(selectedBindings, feature.v8Bindings);
  addAll(selectedLibraries, feature.nativeLibraries);
  addAll(selectedTools, feature.tools);
  addAll(selectedPackages, feature.jsPackages);
  if (feature.shipGate) gates[feature.shipGate] = true;
}

if (format === 'ship-gate') {
  const order = ((registry.shipGate || {}).flagOrder) || [];
  __writeStdout(order.map((name) => gates[name] ? '1' : '0').join(' ') + '\n');
} else if (format === 'zig-flags') {
  __writeStdout(Array.from(selectedBuildOptions).map((name) => '-D' + name + '=true').join(' ') + '\n');
} else if (format === 'dev-zig-flags') {
  const buildZig = readText(buildZigPath, 'build.zig');
  const declared = new Set();
  const re = /b\.option\s*\([\s\S]*?"([^"]+)"/g;
  let match;
  while ((match = re.exec(buildZig)) !== null) declared.add(match[1]);

  const allBuildOptions = new Set(['use-v8', 'dev-mode']);
  for (const featureName of Object.keys(features)) {
    addAll(allBuildOptions, (features[featureName] || {}).buildOptions);
  }

  // ── Incompatibility: has-embed + has-whisper ────────────────────────
  // Both libraries bundle their own copy of ggml. Linking both into one
  // process puts two ggml symbol sets in the global namespace; the
  // dynamic linker resolves ggml_* calls to whichever loaded first,
  // causing heap corruption (e.g. tokenizer init double-free). The
  // proper fix is -fvisibility=hidden on libwhisper's sources so its
  // ggml stays internal — until that lands, the dev host can only
  // ship one of the two. Embed wins in the dev host; carts that need
  // whisper must use scripts/ship (which only enables what their bundle
  // actually triggers, so they never get both at once).
  if (allBuildOptions.has('has-embed') && allBuildOptions.has('has-whisper')) {
    allBuildOptions.delete('has-whisper');
    __writeStderr('[sdk-dependency-resolve] dev: dropping has-whisper (conflicts with has-embed; both bundle ggml)\n');
  }

  const flags = [];
  for (const name of allBuildOptions) {
    if (declared.has(name)) flags.push('-D' + name + '=true');
  }
  __writeStdout(flags.join(' ') + '\n');
} else if (format === 'json') {
  const result = {
    metafile: metafilePath,
    features: selectedFeatures,
    buildOptions: Array.from(selectedBuildOptions),
    v8Bindings: Array.from(selectedBindings),
    nativeLibraries: Array.from(selectedLibraries),
    tools: Array.from(selectedTools),
    jsPackages: Array.from(selectedPackages),
    shipGate: gates
  };
  __writeStdout(JSON.stringify(result, null, 2) + '\n');
} else {
  __writeStderr('[sdk-dependency-resolve] unsupported format: ' + format + '\n');
  __exit(1);
}
