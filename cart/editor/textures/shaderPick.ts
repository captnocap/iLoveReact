import type { Rgb } from '../data/types';
import { paramDefaults, withPalette, type ShaderSpec } from './shaders';

export type ShaderPaletteLookup = (specId: string, variant: number) => Rgb[] | null;

export function shaderVariantData(
  spec: ShaderSpec,
  variantIndex: number,
  paletteFor?: ShaderPaletteLookup,
): number[] {
  const idx = Math.max(0, Math.min(spec.variants.length - 1, variantIndex));
  const variant = spec.variants[idx] ?? spec.variants[0]!;
  return withPalette(
    spec.buildData(variant.value, paramDefaults(spec.base), paramDefaults(variant.params)),
    paletteFor?.(spec.id, idx) ?? null,
  );
}

export function shaderVariantIndex(spec: ShaderSpec, data?: number[]): number {
  if (!data || data.length === 0 || spec.variants.length <= 1) return 0;
  const rows = spec.variants.map((variant) =>
    spec.buildData(variant.value, paramDefaults(spec.base), paramDefaults(variant.params)),
  );
  const probe = Math.min(8, Math.max(...rows.map((row) => row.length), data.length));
  for (let i = 0; i < probe; i += 1) {
    const first = rows[0]?.[i];
    if (first === undefined) continue;
    const isSelector = rows.some((row) => Math.abs((row[i] ?? Number.NaN) - first) > 0.0001);
    if (!isSelector) continue;
    const at = rows.findIndex((row) => Math.abs((row[i] ?? Number.NaN) - data[i]) < 0.0001);
    if (at !== -1) return at;
  }
  return 0;
}
