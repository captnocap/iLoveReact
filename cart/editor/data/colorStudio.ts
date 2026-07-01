// editor/data/colorStudio.ts — shader-slot color studio data + color math.
//
// Cloned from the hmsc-workspace-mock god-file. Pure data + pure helpers.
import type { ColorStudioMaterialKey, EditorState, PaletteSet, Rgb, ShaderMaterial } from './types';

export const QUALITY_LABELS = ['PSX', 'PS2', 'Prev', 'Std', 'Max'];

export const SHADER_MATERIALS: Record<ColorStudioMaterialKey, ShaderMaterial> = {
  rot: {
    key: 'rot',
    name: 'Rot Siding',
    shaderFn: 'rot_siding',
    board: 'B / Condemned',
    materialId: 18,
    heroSlot: 2,
    slots: [
      { name: 'Wood low', role: 'grain shadow' },
      { name: 'Wood high', role: 'grain lift' },
      { name: 'Paint', role: 'variant color' },
      { name: 'Rot', role: 'damage mask' },
      { name: 'Seam', role: 'board cut' },
    ],
    variants: [
      [[0.28, 0.17, 0.09], [0.58, 0.39, 0.20], [0.58, 0.62, 0.54], [0.035, 0.04, 0.026], [0.018, 0.016, 0.014]],
      [[0.28, 0.17, 0.09], [0.58, 0.39, 0.20], [0.28, 0.47, 0.58], [0.035, 0.04, 0.026], [0.018, 0.016, 0.014]],
      [[0.28, 0.17, 0.09], [0.58, 0.39, 0.20], [0.70, 0.56, 0.35], [0.035, 0.04, 0.026], [0.018, 0.016, 0.014]],
    ],
  },
  stucco: {
    key: 'stucco',
    name: 'Neon Stucco',
    shaderFn: 'neon_stucco',
    board: 'D / NeonRot',
    materialId: 31,
    heroSlot: 1,
    slots: [
      { name: 'Base low', role: 'plaster shadow' },
      { name: 'Base high', role: 'plaster lift' },
      { name: 'Drip', role: 'leak accent' },
    ],
    variants: [
      [[0.50, 0.10, 0.24], [0.98, 0.45, 0.66], [0.98, 0.78, 0.18]],
      [[0.07, 0.37, 0.42], [0.36, 0.92, 0.88], [0.98, 0.78, 0.18]],
      [[0.26, 0.19, 0.46], [0.84, 0.68, 0.96], [0.98, 0.78, 0.18]],
    ],
  },
  pool: {
    key: 'pool',
    name: 'Pool Tile',
    shaderFn: 'pool_tile',
    board: 'D / NeonRot',
    materialId: 34,
    heroSlot: 1,
    slots: [
      { name: 'Tile A', role: 'checker low' },
      { name: 'Tile B', role: 'checker high' },
      { name: 'Caustic', role: 'light sweep' },
      { name: 'Mildew', role: 'grout dirt' },
    ],
    variants: [
      [[0.05, 0.50, 0.62], [0.48, 0.96, 0.92], [0.90, 1.00, 0.85], [0.015, 0.05, 0.035]],
      [[0.12, 0.10, 0.42], [0.96, 0.20, 0.56], [0.90, 1.00, 0.85], [0.015, 0.05, 0.035]],
      [[0.16, 0.44, 0.34], [0.86, 0.74, 0.34], [0.90, 1.00, 0.85], [0.015, 0.05, 0.035]],
    ],
  },
};

export const COLOR_LIBRARY_SETS: PaletteSet[] = [
  { name: 'Condemned Wood', tag: 'rot siding compatible', colors: [[0.28, 0.17, 0.09], [0.58, 0.39, 0.20], [0.28, 0.47, 0.58], [0.035, 0.04, 0.026]] },
  { name: 'Neon Motel', tag: 'stucco night read', colors: [[0.50, 0.10, 0.24], [0.98, 0.45, 0.66], [0.36, 0.92, 0.88], [0.98, 0.78, 0.18]] },
  { name: 'Pool Rot', tag: 'wet tile breakup', colors: [[0.05, 0.50, 0.62], [0.48, 0.96, 0.92], [0.90, 1.00, 0.85], [0.015, 0.05, 0.035]] },
  { name: 'Ashphalt Warm', tag: 'street grime', colors: [[0.13, 0.15, 0.16], [0.31, 0.32, 0.31], [0.62, 0.55, 0.40], [0.72, 0.36, 0.29]] },
];

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function rgbToCss(rgb: Rgb): string {
  return `rgb(${Math.round(clamp01(rgb[0]) * 255)}, ${Math.round(clamp01(rgb[1]) * 255)}, ${Math.round(clamp01(rgb[2]) * 255)})`;
}

export function rgbToVec3(rgb: Rgb): string {
  return `vec3f(${rgb.map((value) => value.toFixed(3)).join(', ')})`;
}

export function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp01(amount);
  return [
    clamp01(a[0] + (b[0] - a[0]) * t),
    clamp01(a[1] + (b[1] - a[1]) * t),
    clamp01(a[2] + (b[2] - a[2]) * t),
  ];
}

export function complementRgb(rgb: Rgb): Rgb {
  return mixRgb([1 - rgb[0], 1 - rgb[1], 1 - rgb[2]], [0.14, 0.34, 0.48], 0.42);
}

export function colorStudioMaterial(state: EditorState): ShaderMaterial {
  return SHADER_MATERIALS[state.colorStudioMaterial] ?? SHADER_MATERIALS.rot;
}

export function colorStudioOverrideKey(material: ColorStudioMaterialKey, variant: number, slot: number): string {
  return `${material}:${variant}:${slot}`;
}

export function bakedSlotRgb(material: ShaderMaterial, variant: number, slot: number): Rgb {
  return material.variants[variant]?.[slot] ?? material.variants[0]?.[slot] ?? [0, 0, 0];
}

export function resolvedSlotColor(state: EditorState, material: ShaderMaterial, slot: number): string {
  const key = colorStudioOverrideKey(material.key, state.colorStudioVariant, slot);
  return state.colorStudioOverrides[key] ?? rgbToCss(bakedSlotRgb(material, state.colorStudioVariant, slot));
}

export function materialPreviewCells(material: ShaderMaterial, colors: string[], seed: number, quality: number): string[] {
  const cells = Array.from({ length: 72 }, (_, index) => index);
  return cells.map((index) => {
    const col = index % 9;
    const row = Math.floor(index / 9);
    const jitter = (index * 17 + seed * 11 + row * 5) % 29;
    if (material.key === 'rot') {
      if (col === 0 || col === 8 || (col + seed) % 7 === 0) return colors[4] ?? '#111';
      if (jitter === 0 || jitter === 1) return colors[3] ?? '#111';
      if (row < 3) return colors[2] ?? '#777';
      return jitter % 3 === 0 ? colors[0] ?? '#333' : colors[1] ?? '#666';
    }
    if (material.key === 'stucco') {
      if ((col + seed) % 11 === 0 && row > 1) return colors[2] ?? '#f4c542';
      if (jitter < 8 + quality) return colors[1] ?? '#ddd';
      return colors[0] ?? '#333';
    }
    if (col % 4 === 0 || row % 4 === 0) return jitter < 8 ? colors[3] ?? '#092014' : '#071014';
    if ((index + seed) % (13 - Math.min(quality, 4)) === 0) return colors[2] ?? '#fff';
    return (col + row + seed) % 2 === 0 ? colors[0] ?? '#088' : colors[1] ?? '#aff';
  });
}

export function slotAssistColors(material: ShaderMaterial, state: EditorState): Array<{ label: string; color: string }> {
  const base = bakedSlotRgb(material, state.colorStudioVariant, Math.min(material.heroSlot, material.slots.length - 1));
  const gray = ((base[0] + base[1] + base[2]) / 3) as number;
  const warm: Rgb = [clamp01(base[0] + 0.18), clamp01(base[1] + 0.07), clamp01(base[2] * 0.78)];
  const cool: Rgb = [clamp01(base[0] * 0.76), clamp01(base[1] + 0.08), clamp01(base[2] + 0.20)];
  return [
    { label: 'shade', color: rgbToCss(mixRgb(base, [0, 0, 0], 0.42)) },
    { label: 'tint', color: rgbToCss(mixRgb(base, [1, 1, 1], 0.40)) },
    { label: 'mute', color: rgbToCss(mixRgb(base, [gray, gray, gray], 0.58)) },
    { label: 'warm', color: rgbToCss(warm) },
    { label: 'cool', color: rgbToCss(cool) },
    { label: 'comp', color: rgbToCss(complementRgb(base)) },
  ];
}
