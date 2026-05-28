// cli/registry/resolve.ts - esbuild metafile to typed feature selection.

import { Metafile, shippedInputs } from '../cart/metafile.ts';
import { emptyGateFlags, FeatureSpec, GateFlags, Registry } from './schema.ts';

export interface FeatureSelection {
  features: string[];
  buildOptions: Set<string>;
  v8Bindings: Set<string>;
  nativeLibraries: Set<string>;
  tools: Set<string>;
  jsPackages: Set<string>;
  gateFlags: GateFlags;
}

export function resolveFeatures(registry: Registry, metafile: Metafile | null): FeatureSelection {
  const shipped = metafile ? shippedInputs(metafile) : new Set<string>();
  const selection: FeatureSelection = {
    features: [],
    buildOptions: new Set(),
    v8Bindings: new Set(),
    nativeLibraries: new Set(),
    tools: new Set(),
    jsPackages: new Set(),
    gateFlags: emptyGateFlags(),
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

function triggerMatched(trigger: NonNullable<FeatureSpec['triggers']>[number], shipped: Set<string>): boolean {
  if (!trigger.kind || !trigger.input) return false;
  if (trigger.kind === 'metafileInput' || trigger.kind === 'featureMarker') return shipped.has(trigger.input);
  if (trigger.kind === 'metafileInputPrefix') {
    for (const path of shipped) {
      if (path.startsWith(trigger.input)) return true;
    }
  }
  return false;
}

function addAll<T>(set: Set<T>, values: readonly T[] | undefined): void {
  for (const value of values ?? []) set.add(value);
}
