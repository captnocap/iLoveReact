// cli/cart/metafile.ts - typed view of esbuild metafile output.

import { fsReadJson } from '../host/fs.ts';

export interface Metafile {
  inputs: Record<string, { bytes: number; imports: unknown[] }>;
  outputs: Record<
    string,
    {
      bytes: number;
      inputs: Record<string, { bytesInOutput: number }>;
      entryPoint?: string;
      imports?: unknown[];
    }
  >;
}

export function loadMetafile(path: string): Metafile {
  return fsReadJson<Metafile>(path);
}

export function shippedInputs(meta: Metafile): Set<string> {
  const shipped = new Set<string>();
  for (const output of Object.values(meta.outputs ?? {})) {
    for (const [path, info] of Object.entries(output.inputs ?? {})) {
      if (info.bytesInOutput > 0) shipped.add(path);
    }
  }
  return shipped;
}
