// cli/commands/cart-manifest-field.ts - read a single cart.json field.

import { parseArgs } from '../host/argv.ts';
import { err, out } from '../host/log.ts';
import { loadManifest, manifestField } from '../cart/manifest.ts';

export async function run(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv.slice(0, 2), { positional: ['manifestPath', 'fieldName'] });
  } catch (error) {
    err(`[cart-manifest-field] ${(error as Error).message}`);
    return 1;
  }

  const manifestPath = parsed.positional.manifestPath;
  const fieldName = parsed.positional.fieldName;
  if (!manifestPath || !fieldName) {
    err('[cart-manifest-field] usage: cart-manifest-field <cart.json> <field>');
    return 1;
  }

  const manifest = loadManifest(manifestPath);
  const value = manifestField(manifest, fieldName);
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string') out(value);
  else if (typeof value === 'number' || typeof value === 'boolean') out(String(value));
  else out(JSON.stringify(value));
  return 0;
}
