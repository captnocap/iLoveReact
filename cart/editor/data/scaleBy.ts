// Exact-value uniform scaling shared by the dialog and command boundary.

export const SCALE_BY_TUNING = {
  min: 0.02,
  max: 50,
  defaultFactor: 48,
  noOpEpsilon: 1e-5,
  presets: [2, 16, 48] as const,
} as const;

export type ScaleByParse =
  | { ok: true; factor: number }
  | { ok: false; error: string };

/** Parse without silently clamping: an exact-value operation must either apply
 * the value the user entered or explain why it cannot. */
export function parseScaleByFactor(text: string): ScaleByParse {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Enter a scale factor.' };
  const factor = Number(trimmed);
  if (!Number.isFinite(factor)) return { ok: false, error: 'Scale factor must be a finite number.' };
  if (factor < SCALE_BY_TUNING.min || factor > SCALE_BY_TUNING.max) {
    return { ok: false, error: `Use a factor from ${SCALE_BY_TUNING.min} to ${SCALE_BY_TUNING.max}.` };
  }
  if (Math.abs(factor - 1) < SCALE_BY_TUNING.noOpEpsilon) {
    return { ok: false, error: '×1 leaves the selection unchanged.' };
  }
  return { ok: true, factor };
}
