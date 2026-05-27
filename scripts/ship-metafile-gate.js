// scripts/ship-metafile-gate.js — gates which opt-in V8 bindings ship with a
// cart by inspecting the esbuild metafile. Without this file the gate
// silently produces no output and ALL opt-in V8 bindings get force-disabled
// (carts that need them then crash at runtime when callHost hits an
// unregistered name).
//
// Usage: tools/v8cli scripts/ship-metafile-gate.js <metafile.json>
//
// Output: one line, space-separated 0/1 flags in this exact order:
//
//   privacy useHost useConnection fs websocket telemetry zigcall
//
// scripts/ship reads them positionally — order MUST stay stable.
//
// Mechanism: walks the esbuild metafile's outputs[].inputs map (the bytes
// that actually shipped after tree-shaking) and asks `did this hook file
// land in the bundle?`. Pure Set membership check, no string searching of
// minified code.
//
// Hook → binding map lives in sdk/dependency-registry.json. This file only
// preserves the legacy positional output contract for scripts/ship.

const argv = process.argv.slice(1);
const metafilePath = argv[0];
if (!metafilePath) {
  __writeStderr('[ship-metafile-gate] usage: ship-metafile-gate.js <metafile>\n');
  __exit(1);
}

function readJson(path, label) {
  const raw = __fs_read(path);
  if (raw === null) {
    __writeStderr('[ship-metafile-gate] cannot read ' + label + ': ' + path + '\n');
    __exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    __writeStderr('[ship-metafile-gate] bad json in ' + path + ': ' + (e && e.message) + '\n');
    __exit(1);
  }
}

const registry = readJson('sdk/dependency-registry.json', 'registry');
const meta = readJson(metafilePath, 'metafile');

const order = ((registry.shipGate || {}).flagOrder) || [];
if (order.length === 0) {
  __writeStderr('[ship-metafile-gate] registry has no shipGate.flagOrder\n');
  __exit(1);
}

// Walk outputs[].inputs (bytes-actually-shipped), NOT the top-level inputs
// map (everything esbuild parsed). With sideEffects: false in
// runtime/package.json, esbuild tree-shakes unused hook files out of the
// bundle entirely — but it still keeps them in top-level inputs because
// they were considered. The real signal is bytesInOutput > 0.
const shipped = new Set();
const outputs = (meta && meta.outputs) || {};
for (const outName of Object.keys(outputs)) {
  const out = outputs[outName] || {};
  const inputs = out.inputs || {};
  for (const path of Object.keys(inputs)) {
    if ((inputs[path] && inputs[path].bytesInOutput) > 0) shipped.add(path);
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

const gates = {};
const features = registry.features || {};
for (const featureName of Object.keys(features)) {
  const feature = features[featureName] || {};
  if (!feature.shipGate) continue;
  const triggers = feature.triggers || [];
  if (triggers.some(triggerMatched)) gates[feature.shipGate] = true;
}

__writeStdout(order.map((name) => gates[name] ? '1' : '0').join(' ') + '\n');
