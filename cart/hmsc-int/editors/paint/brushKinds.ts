export type PaintBrushKind =
  | 'round'
  | 'soft'
  | 'square'
  | 'flat'
  | 'angle'
  | 'filbert'
  | 'rake'
  | 'fan'
  | 'dry'
  | 'spray'
  | 'knife';

export type PaintBrushSettings = {
  kind: PaintBrushKind;
  angleDeg: number;
  aspect: number;
  hardness: number;
  flow: number;
  scatter: number;
};

export const PAINT_BRUSH_KIND_IDS: Record<PaintBrushKind, number> = {
  round: 0,
  soft: 1,
  square: 2,
  flat: 3,
  angle: 4,
  filbert: 5,
  rake: 6,
  fan: 7,
  dry: 8,
  spray: 9,
  knife: 10,
};

export const DEFAULT_PAINT_BRUSH_SETTINGS: PaintBrushSettings = {
  kind: 'round',
  angleDeg: 0,
  aspect: 1,
  hardness: 1,
  flow: 1,
  scatter: 0,
};

export const PAINT_BRUSH_PRESETS: Array<PaintBrushSettings & { label: string }> = [
  { label: 'round', kind: 'round', angleDeg: 0, aspect: 1, hardness: 1, flow: 1, scatter: 0 },
  { label: 'soft', kind: 'soft', angleDeg: 0, aspect: 1, hardness: 0.25, flow: 0.55, scatter: 0 },
  { label: 'square', kind: 'square', angleDeg: 0, aspect: 1, hardness: 0.95, flow: 1, scatter: 0 },
  { label: 'flat', kind: 'flat', angleDeg: 0, aspect: 2.8, hardness: 0.85, flow: 1, scatter: 0 },
  { label: 'angle', kind: 'angle', angleDeg: -35, aspect: 2.5, hardness: 0.9, flow: 1, scatter: 0 },
  { label: 'filbert', kind: 'filbert', angleDeg: 0, aspect: 1.85, hardness: 0.75, flow: 0.9, scatter: 0 },
  { label: 'rake', kind: 'rake', angleDeg: 0, aspect: 2.4, hardness: 0.9, flow: 0.95, scatter: 0 },
  { label: 'fan', kind: 'fan', angleDeg: 0, aspect: 2.8, hardness: 0.75, flow: 0.85, scatter: 0.15 },
  { label: 'dry', kind: 'dry', angleDeg: 10, aspect: 2.1, hardness: 0.8, flow: 0.75, scatter: 0.35 },
  { label: 'spray', kind: 'spray', angleDeg: 0, aspect: 1, hardness: 0.35, flow: 0.45, scatter: 1.25 },
  { label: 'knife', kind: 'knife', angleDeg: -12, aspect: 4.2, hardness: 1, flow: 1, scatter: 0 },
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

export function normalizePaintBrushSettings(raw: Partial<PaintBrushSettings> | null | undefined): PaintBrushSettings {
  const kind = raw?.kind && PAINT_BRUSH_KIND_IDS[raw.kind] !== undefined ? raw.kind : DEFAULT_PAINT_BRUSH_SETTINGS.kind;
  return {
    kind,
    angleDeg: clamp(Number(raw?.angleDeg ?? DEFAULT_PAINT_BRUSH_SETTINGS.angleDeg), -180, 180),
    aspect: clamp(Number(raw?.aspect ?? DEFAULT_PAINT_BRUSH_SETTINGS.aspect), 0.2, 8),
    hardness: clamp(Number(raw?.hardness ?? DEFAULT_PAINT_BRUSH_SETTINGS.hardness), 0, 1),
    flow: clamp(Number(raw?.flow ?? DEFAULT_PAINT_BRUSH_SETTINGS.flow), 0.02, 1),
    scatter: clamp(Number(raw?.scatter ?? DEFAULT_PAINT_BRUSH_SETTINGS.scatter), 0, 3),
  };
}
