// cli/registry/load.ts - read and validate sdk/dependency-registry.json.

import { fsReadJson } from '../host/fs.ts';
import { die } from '../host/log.ts';
import { Registry, SHIP_GATE_FLAGS } from './schema.ts';

export function loadRegistry(path: string = 'sdk/dependency-registry.json', tag: string = 'registry'): Registry {
  const registry = fsReadJson<Registry>(path);
  validateRegistry(registry, path, tag);
  return registry;
}

function validateRegistry(registry: Registry, path: string, tag: string): void {
  if (registry.schemaVersion !== 1) die(tag, `${path}: unsupported schemaVersion ${registry.schemaVersion}`);
  if (!registry.shipGate || !Array.isArray(registry.shipGate.flagOrder) || registry.shipGate.flagOrder.length === 0) {
    die(tag, `${path}: registry has no shipGate.flagOrder`);
  }

  const knownFlags = new Set<string>(SHIP_GATE_FLAGS);
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
