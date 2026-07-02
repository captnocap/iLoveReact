// editor/data/colorStudio.ts — the Material Palette's pure data layer, driven
// by the REAL shader catalog (textures/shaders.ts specs + the generated
// registry's palette slots). Owns override storage/resolution and the OKLCH
// fit derivations for the active slot. The demo-era hand-copied materials
// (SHADER_MATERIALS) and the CSS-cell preview (materialPreviewCells) are gone:
// the preview is the actual WGSL rendered by <Effect>, and every fill-board
// material gets slots automatically from the generator.
import {
  oklchToRgb01,
  rgb01ToHex,
  rgb01ToOklch,
  rotateHue,
  type OklchColor,
} from '../../../runtime/paint/colors';
import {
  paramDefaults,
  shaderGroups,
  shaderSpec,
  withPalette,
  type ShaderSpec,
} from '../textures/shaders';
import type { EditorState, Rgb } from './types';

export const DEFAULT_STUDIO_SPEC_ID = 'b-rot-siding';

/** Specs the Material Palette can author: fill-board materials (they have
 *  slots). The road shader and other bespoke-layout specs stay paintable but
 *  are not slot-editable. */
export function studioSpecs(): ShaderSpec[] {
  return shaderGroups().flatMap((g) => g.specs.filter((s) => (s.slots?.length ?? 0) > 0));
}

export function colorStudioSpec(state: EditorState): ShaderSpec {
  return shaderSpec(state.colorStudioMaterial) ?? shaderSpec(DEFAULT_STUDIO_SPEC_ID) ?? studioSpecs()[0]!;
}

export function colorStudioOverrideKey(specId: string, variant: number, slot: number): string {
  return `${specId}:${variant}:${slot}`;
}

export function bakedSlotRgb(spec: ShaderSpec, slot: number): Rgb {
  const s = spec.slots?.[slot];
  return s ? [s.rgb[0], s.rgb[1], s.rgb[2]] : [0, 0, 0];
}

export function resolvedSlotRgb(state: EditorState, spec: ShaderSpec, slot: number): Rgb {
  const key = colorStudioOverrideKey(spec.id, state.colorStudioVariant, slot);
  return state.colorStudioOverrides[key] ?? bakedSlotRgb(spec, slot);
}

/** True if any slot of (spec, variant) is overridden. */
export function hasAnyOverride(state: EditorState, spec: ShaderSpec): boolean {
  return (spec.slots ?? []).some(
    (_, slot) => state.colorStudioOverrides[colorStudioOverrideKey(spec.id, state.colorStudioVariant, slot)] !== undefined,
  );
}

/** The palette to append to data[] for (spec, variant): full slot list with
 *  overrides applied, or null when nothing is overridden (keeps the 5-float
 *  baked form — mat_pal falls back, pixel-identical). Variant-parameterized so
 *  the PAINT path (shader ink) can ask for any take, not just the studio's. */
export function paletteForSpecVariant(overrides: Record<string, Rgb>, spec: ShaderSpec, variant: number): Rgb[] | null {
  const slots = spec.slots ?? [];
  const any = slots.some((_, slot) => overrides[colorStudioOverrideKey(spec.id, variant, slot)] !== undefined);
  if (!any) return null;
  return slots.map((_, slot) => overrides[colorStudioOverrideKey(spec.id, variant, slot)] ?? bakedSlotRgb(spec, slot));
}

export function paletteFor(state: EditorState, spec: ShaderSpec): Rgb[] | null {
  return paletteForSpecVariant(state.colorStudioOverrides, spec, state.colorStudioVariant);
}

/** The complete data[] for the studio's live preview: the spec's own
 *  buildData (variant/seed/grade) + the resolved palette. */
export function studioPreviewData(state: EditorState, spec: ShaderSpec): number[] {
  const base = { ...paramDefaults(spec.base), seed: state.colorStudioSeed, grade: state.colorStudioQuality };
  const variant = spec.variants[state.colorStudioVariant] ?? spec.variants[0]!;
  const data = spec.buildData(variant.value, base, paramDefaults(variant.params));
  return withPalette(data, paletteFor(state, spec));
}

export function rgbToCss(rgb: Rgb): string {
  return rgb01ToHex(rgb[0], rgb[1], rgb[2]);
}

export function rgbToVec3(rgb: Rgb): string {
  return `vec3f(${rgb.map((value) => value.toFixed(3)).join(', ')})`;
}

/** "Fits this slot" — OKLCH derivations from the ACTIVE slot's baked color, so
 *  the suggestions stay anchored to what the material author chose. Shares the
 *  spine's color math (one harmony implementation, not two). */
export function slotFitColors(baked: Rgb): Array<{ label: string; rgb: Rgb }> {
  const ok: OklchColor = rgb01ToOklch(baked[0], baked[1], baked[2]);
  const fits: Array<{ label: string; color: OklchColor }> = [
    { label: 'shade', color: { ...ok, l: Math.max(0.05, ok.l - 0.22) } },
    { label: 'tint', color: { ...ok, l: Math.min(0.97, ok.l + 0.22) } },
    { label: 'mute', color: { ...ok, c: ok.c * 0.35 } },
    { label: 'warm', color: rotateHue({ ...ok, c: Math.max(ok.c, 0.06) }, ok.h > 40 && ok.h < 220 ? -25 : 25) },
    { label: 'cool', color: rotateHue({ ...ok, c: Math.max(ok.c, 0.06) }, ok.h > 40 && ok.h < 220 ? 25 : -25) },
    { label: 'comp', color: rotateHue(ok, 180) },
  ];
  return fits.map((f) => ({ label: f.label, rgb: oklchToRgb01(f.color) as Rgb }));
}
