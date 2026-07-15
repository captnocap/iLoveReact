// Color Studio's command-domain model. React, the eventbus, and UI callbacks
// sit outside this file: a command receives a complete semantic request and
// returns either one deterministic choice result or an exact reversible plan.
import type { OklchColor } from '../../../runtime/paint/colors';
import type { Rgb } from '../data/types';

export type ColorStudioView = 'materialPalette' | 'library';

export type ColorStudioSpec = {
  id: string;
  label: string;
  variants: readonly { label: string }[];
  slots: readonly { name: string; baked: Rgb }[];
};

export type ColorStudioPolicy = {
  spec(id: string): ColorStudioSpec | null;
  qualityCount: number;
  seedMax: number;
};

export type ColorStudioSnapshot = {
  materialId: string;
  variant: number;
  seed: number;
  quality: number;
  activeSlot: number;
  view: ColorStudioView;
  currentColor: OklchColor;
  scenePick: string | null;
  overrides: Readonly<Record<string, Rgb>>;
  palette: readonly OklchColor[];
};

export type ColorStudioChoicePatch = Partial<Pick<ColorStudioSnapshot,
  'materialId' | 'variant' | 'seed' | 'quality' | 'activeSlot' | 'view' | 'currentColor' | 'scenePick'>>;

export type ColorStudioChoiceResult = {
  kind: 'material' | 'variant' | 'seed' | 'quality' | 'slot' | 'view' | 'color';
  changed: boolean;
  label: string;
  targetId: string;
  patch: ColorStudioChoicePatch;
  source?: string;
};

export type ColorStudioAuthoredSnapshot = {
  overrides: Record<string, Rgb>;
  palette: OklchColor[];
  currentColor: OklchColor;
};

export type ColorStudioActionTransaction =
  | {
      action: 'slot.fill';
      specId: string;
      specLabel: string;
      variant: number;
      slot: number;
      slotName: string;
      key: string;
      source: string;
      before: Rgb | null;
      after: Rgb;
    }
  | {
      action: 'slots.reset';
      specId: string;
      specLabel: string;
      variant: number;
      changes: Array<{ key: string; slot: number; slotName: string; before: Rgb; after: null }>;
    }
  | {
      action: 'palette.add';
      source: string;
      index: number;
      color: OklchColor;
    }
  | {
      action: 'palette.load';
      setName: string;
      before: { palette: OklchColor[]; currentColor: OklchColor };
      after: { palette: OklchColor[]; currentColor: OklchColor };
    };

export type ColorStudioActionPlan = {
  label: string;
  transaction: ColorStudioActionTransaction;
  before: ColorStudioAuthoredSnapshot;
  after: ColorStudioAuthoredSnapshot;
};

export type ColorStudioHistoryEntry = {
  label: string;
  actionId: string;
  commandId: string;
  transaction: ColorStudioActionTransaction;
  before: ColorStudioAuthoredSnapshot;
  after: ColorStudioAuthoredSnapshot;
};

export class ColorStudioRejected extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ColorStudioRejected';
  }
}

// Deterministic step retained from the Studio's original seed control. Naming
// the coefficients keeps a remote/headless invocation on the same sequence.
const SEED_ROLL_MULTIPLIER = 37;
const SEED_ROLL_INCREMENT = 19;
const MAX_PALETTE_COLORS = 64;

function rgb(rgb: readonly number[]): Rgb {
  return [rgb[0]!, rgb[1]!, rgb[2]!];
}

function color(color: OklchColor): OklchColor {
  return { l: color.l, c: color.c, h: color.h };
}

function validRgb(value: unknown): value is Rgb {
  return Array.isArray(value) && value.length === 3 && value.every((n) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1);
}

function validColor(value: unknown): value is OklchColor {
  const c = value as Partial<OklchColor> | null;
  return !!c && Number.isFinite(c.l) && Number.isFinite(c.c) && Number.isFinite(c.h) &&
    c.l! >= 0 && c.l! <= 1 && c.c! >= 0;
}

function sameRgb(a: Rgb | null | undefined, b: Rgb): boolean {
  return !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function sameColor(a: OklchColor, b: OklchColor): boolean {
  return a.l === b.l && a.c === b.c && a.h === b.h;
}

function samePalette(a: readonly OklchColor[], b: readonly OklchColor[]): boolean {
  return a.length === b.length && a.every((entry, index) => sameColor(entry, b[index]!));
}

function authored(snapshot: ColorStudioSnapshot): ColorStudioAuthoredSnapshot {
  return {
    overrides: Object.fromEntries(Object.entries(snapshot.overrides).map(([key, value]) => [key, rgb(value)])),
    palette: snapshot.palette.map(color),
    currentColor: color(snapshot.currentColor),
  };
}

function requireSpec(policy: ColorStudioPolicy, id: string): ColorStudioSpec {
  const spec = policy.spec(id);
  if (!spec) throw new ColorStudioRejected('UNKNOWN_MATERIAL', `unknown Color Studio material '${id}'`);
  return spec;
}

function requireInteger(value: unknown, label: string, min: number, maxExclusive: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) >= maxExclusive) {
    throw new ColorStudioRejected('OUT_OF_RANGE', `${label} must be an integer in ${min}..${Math.max(min, maxExclusive - 1)}`);
  }
  return value as number;
}

export function overrideKey(specId: string, variant: number, slot: number): string {
  return `${specId}:${variant}:${slot}`;
}

export function planMaterialChoice(
  snapshot: ColorStudioSnapshot,
  specId: string,
  policy: ColorStudioPolicy,
  variant = 0,
): ColorStudioChoiceResult {
  const spec = requireSpec(policy, specId);
  const nextVariant = requireInteger(variant, 'variant', 0, spec.variants.length);
  const changed = snapshot.materialId !== spec.id || snapshot.variant !== nextVariant || snapshot.activeSlot !== 0;
  return {
    kind: 'material', changed, label: `Color Studio material → ${spec.label}`, targetId: spec.id,
    patch: { materialId: spec.id, variant: nextVariant, activeSlot: 0 },
  };
}

export function planVariantChoice(
  snapshot: ColorStudioSnapshot,
  variant: number,
  policy: ColorStudioPolicy,
): ColorStudioChoiceResult {
  const spec = requireSpec(policy, snapshot.materialId);
  const next = requireInteger(variant, 'variant', 0, spec.variants.length);
  const activeSlot = Math.min(snapshot.activeSlot, Math.max(0, spec.slots.length - 1));
  return {
    kind: 'variant', changed: snapshot.variant !== next || snapshot.activeSlot !== activeSlot,
    label: `${spec.label} variant → ${spec.variants[next]!.label}`, targetId: `${spec.id}:${next}`,
    patch: { variant: next, activeSlot },
  };
}

export function planSeedRoll(snapshot: ColorStudioSnapshot, policy: ColorStudioPolicy): ColorStudioChoiceResult {
  if (!Number.isInteger(policy.seedMax) || policy.seedMax < 1) {
    throw new ColorStudioRejected('INVALID_POLICY', 'Color Studio seed range is invalid');
  }
  const seed = ((snapshot.seed * SEED_ROLL_MULTIPLIER + SEED_ROLL_INCREMENT) % policy.seedMax) + 1;
  return {
    kind: 'seed', changed: seed !== snapshot.seed, label: `Color Studio seed → ${seed}`,
    targetId: String(seed), patch: { seed },
  };
}

export function planQualityChoice(
  snapshot: ColorStudioSnapshot,
  quality: number,
  policy: ColorStudioPolicy,
): ColorStudioChoiceResult {
  const next = requireInteger(quality, 'quality', 0, policy.qualityCount);
  return {
    kind: 'quality', changed: next !== snapshot.quality, label: `Color Studio quality → ${next}`,
    targetId: String(next), patch: { quality: next },
  };
}

export function planSlotChoice(
  snapshot: ColorStudioSnapshot,
  slot: number,
  policy: ColorStudioPolicy,
): ColorStudioChoiceResult {
  const spec = requireSpec(policy, snapshot.materialId);
  const next = requireInteger(slot, 'slot', 0, spec.slots.length);
  return {
    kind: 'slot', changed: next !== snapshot.activeSlot,
    label: `active material slot → ${spec.slots[next]!.name}`, targetId: overrideKey(spec.id, snapshot.variant, next),
    patch: { activeSlot: next },
  };
}

export function planViewChoice(snapshot: ColorStudioSnapshot, view: unknown): ColorStudioChoiceResult {
  if (view !== 'materialPalette' && view !== 'library') {
    throw new ColorStudioRejected('UNKNOWN_VIEW', `unknown Color Studio view '${String(view)}'`);
  }
  return {
    kind: 'view', changed: view !== snapshot.view, label: `Color Studio view → ${view}`,
    targetId: view, patch: { view },
  };
}

export function planCurrentColorChoice(
  snapshot: ColorStudioSnapshot,
  nextColor: unknown,
  source: unknown,
  scenePick?: unknown,
): ColorStudioChoiceResult {
  if (!validColor(nextColor)) throw new ColorStudioRejected('INVALID_COLOR', 'current color is malformed');
  if (typeof source !== 'string' || !source.trim()) throw new ColorStudioRejected('INVALID_SOURCE', 'color source is required');
  if (scenePick !== undefined && scenePick !== null && typeof scenePick !== 'string') {
    throw new ColorStudioRejected('INVALID_SCENE_PICK', 'scene pick must be a color string or null');
  }
  const nextScenePick = scenePick === undefined ? snapshot.scenePick : scenePick as string | null;
  return {
    kind: 'color',
    changed: !sameColor(snapshot.currentColor, nextColor) || nextScenePick !== snapshot.scenePick,
    label: `current color → ${source.trim()}`,
    targetId: `${nextColor.l}:${nextColor.c}:${nextColor.h}`,
    source: source.trim(),
    patch: { currentColor: color(nextColor), scenePick: nextScenePick },
  };
}

export function planSlotFill(
  snapshot: ColorStudioSnapshot,
  args: { specId: unknown; variant: unknown; slot: unknown; rgb: unknown; source: unknown },
  policy: ColorStudioPolicy,
): ColorStudioActionPlan {
  if (typeof args.specId !== 'string') throw new ColorStudioRejected('INVALID_MATERIAL', 'material id is required');
  const spec = requireSpec(policy, args.specId);
  const variant = requireInteger(args.variant, 'variant', 0, spec.variants.length);
  const slot = requireInteger(args.slot, 'slot', 0, spec.slots.length);
  if (!validRgb(args.rgb)) throw new ColorStudioRejected('INVALID_RGB', 'slot color must be three finite 0..1 channels');
  if (typeof args.source !== 'string' || !args.source.trim()) throw new ColorStudioRejected('INVALID_SOURCE', 'fill source is required');
  const key = overrideKey(spec.id, variant, slot);
  const previous = snapshot.overrides[key] ?? null;
  if (sameRgb(previous, args.rgb)) throw new ColorStudioRejected('NO_CHANGE', `${spec.label} ${spec.slots[slot]!.name} already has that color`);
  const before = authored(snapshot);
  const after = authored(snapshot);
  after.overrides[key] = rgb(args.rgb);
  return {
    label: `fill ${spec.label} ${spec.slots[slot]!.name}`,
    transaction: {
      action: 'slot.fill', specId: spec.id, specLabel: spec.label, variant, slot,
      slotName: spec.slots[slot]!.name, key, source: args.source.trim(),
      before: previous ? rgb(previous) : null, after: rgb(args.rgb),
    },
    before,
    after,
  };
}

export function planSlotsReset(
  snapshot: ColorStudioSnapshot,
  args: { specId: unknown; variant: unknown },
  policy: ColorStudioPolicy,
): ColorStudioActionPlan {
  if (typeof args.specId !== 'string') throw new ColorStudioRejected('INVALID_MATERIAL', 'material id is required');
  const spec = requireSpec(policy, args.specId);
  const variant = requireInteger(args.variant, 'variant', 0, spec.variants.length);
  const changes: Extract<ColorStudioActionTransaction, { action: 'slots.reset' }>['changes'] = [];
  spec.slots.forEach((slot, index) => {
    const key = overrideKey(spec.id, variant, index);
    const previous = snapshot.overrides[key];
    if (previous) changes.push({ key, slot: index, slotName: slot.name, before: rgb(previous), after: null });
  });
  if (!changes.length) throw new ColorStudioRejected('NO_CHANGE', `${spec.label} already uses baked defaults`);
  const before = authored(snapshot);
  const after = authored(snapshot);
  changes.forEach((change) => delete after.overrides[change.key]);
  return {
    label: `reset ${spec.label} variant ${variant}`,
    transaction: { action: 'slots.reset', specId: spec.id, specLabel: spec.label, variant, changes },
    before,
    after,
  };
}

export function planPaletteAdd(
  snapshot: ColorStudioSnapshot,
  args: { color: unknown; source: unknown },
): ColorStudioActionPlan {
  if (!validColor(args.color)) throw new ColorStudioRejected('INVALID_COLOR', 'palette color is malformed');
  if (typeof args.source !== 'string' || !args.source.trim()) throw new ColorStudioRejected('INVALID_SOURCE', 'palette source is required');
  const before = authored(snapshot);
  const after = authored(snapshot);
  const index = after.palette.length;
  after.palette.push(color(args.color));
  return {
    label: `add color to tray`,
    transaction: { action: 'palette.add', source: args.source.trim(), index, color: color(args.color) },
    before,
    after,
  };
}

export function planPaletteLoad(
  snapshot: ColorStudioSnapshot,
  args: { colors: unknown; setName: unknown },
): ColorStudioActionPlan {
  if (!Array.isArray(args.colors) || args.colors.length < 1 || args.colors.length > MAX_PALETTE_COLORS || !args.colors.every(validColor)) {
    throw new ColorStudioRejected('INVALID_PALETTE', `palette must contain 1..${MAX_PALETTE_COLORS} valid colors`);
  }
  if (typeof args.setName !== 'string' || !args.setName.trim()) throw new ColorStudioRejected('INVALID_SET', 'palette set name is required');
  const colors = (args.colors as OklchColor[]).map(color);
  if (samePalette(snapshot.palette, colors) && sameColor(snapshot.currentColor, colors[0]!)) {
    throw new ColorStudioRejected('NO_CHANGE', `${args.setName.trim()} is already loaded`);
  }
  const before = authored(snapshot);
  const after = authored(snapshot);
  after.palette = colors.map(color);
  after.currentColor = color(colors[0]!);
  return {
    label: `load ${args.setName.trim()} palette`,
    transaction: {
      action: 'palette.load', setName: args.setName.trim(),
      before: { palette: before.palette.map(color), currentColor: color(before.currentColor) },
      after: { palette: after.palette.map(color), currentColor: color(after.currentColor) },
    },
    before,
    after,
  };
}
