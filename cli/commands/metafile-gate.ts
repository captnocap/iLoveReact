// cli/commands/metafile-gate.ts - source-driven build dependency resolver.

import { loadMetafile } from '../cart/metafile.ts';
import { fsRead } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { loadRegistry } from '../registry/load.ts';
import { resolveFeatures } from '../registry/resolve.ts';
import { gateFlagsToPositional } from '../registry/schema.ts';

type Format = 'json' | 'ship-gate' | 'zig-flags' | 'dev-zig-flags';

export async function run(argv: string[]): Promise<number> {
  let registryPath = 'sdk/dependency-registry.json';
  let metafilePath = '';
  let format: Format = 'ship-gate';
  let buildZigPath = 'build.zig';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--registry') {
      registryPath = argv[++i] ?? '';
    } else if (arg === '--metafile') {
      metafilePath = argv[++i] ?? '';
    } else if (arg === '--format') {
      const value = argv[++i] ?? '';
      if (!isFormat(value)) {
        err(`[metafile-gate] unsupported format: ${value}`);
        return 1;
      }
      format = value;
    } else if (arg === '--build-zig') {
      buildZigPath = argv[++i] ?? '';
    } else if (!arg.startsWith('-') && !metafilePath) {
      metafilePath = arg;
    } else {
      err(`[metafile-gate] unknown argument: ${arg}`);
      return 1;
    }
  }

  if (!metafilePath && format !== 'dev-zig-flags') {
    err('[metafile-gate] usage: metafile-gate [--registry path] --metafile path [--format json|ship-gate|zig-flags|dev-zig-flags]');
    return 1;
  }

  const registry = loadRegistry(registryPath, 'metafile-gate');
  const metafile = metafilePath ? loadMetafile(metafilePath) : null;
  const selection = resolveFeatures(registry, metafile);

  if (format === 'ship-gate') {
    out(gateFlagsToPositional(selection.gateFlags, registry.shipGate.flagOrder));
  } else if (format === 'zig-flags') {
    out(Array.from(selection.buildOptions).map((name) => `-D${name}=true`).join(' '));
  } else if (format === 'dev-zig-flags') {
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
      shipGate: gatesObject(registry, selection.gateFlags),
    }, null, 2));
  }

  return 0;
}

function isFormat(value: string): value is Format {
  return value === 'json' || value === 'ship-gate' || value === 'zig-flags' || value === 'dev-zig-flags';
}

function devZigFlags(registry: ReturnType<typeof loadRegistry>, buildZigPath: string): string {
  const buildZig = fsRead(buildZigPath);
  const declared = new Set<string>();
  const re = /b\.option\s*\([\s\S]*?"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(buildZig)) !== null) declared.add(match[1]!);

  const allBuildOptions = new Set<string>(['use-v8', 'dev-mode']);
  for (const feature of Object.values(registry.features ?? {})) {
    for (const option of feature.buildOptions ?? []) allBuildOptions.add(option);
  }

  if (allBuildOptions.has('has-embed') && allBuildOptions.has('has-whisper')) {
    allBuildOptions.delete('has-whisper');
    err('[sdk-dependency-resolve] dev: dropping has-whisper (conflicts with has-embed; both bundle ggml)');
  }

  const flags: string[] = [];
  for (const name of allBuildOptions) {
    if (declared.has(name)) flags.push(`-D${name}=true`);
  }
  return flags.join(' ');
}

function gatesObject(registry: ReturnType<typeof loadRegistry>, gates: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const feature of Object.values(registry.features ?? {})) {
    if (feature.shipGate && gates[feature.shipGate]) out[feature.shipGate] = true;
  }
  return out;
}
