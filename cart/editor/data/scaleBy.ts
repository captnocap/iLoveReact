// Exact-value uniform scaling shared by the dialog and command boundary.

export const SCALE_BY_TUNING = {
  minMagnitude: 0.000001,
  maxMagnitude: 50,
  defaultFactor: 1.25,
  noOpEpsilon: 1e-5,
  presets: [0.5, 1.25, 2, -1] as const,
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
  const magnitude = Math.abs(factor);
  if (magnitude < SCALE_BY_TUNING.minMagnitude || magnitude > SCALE_BY_TUNING.maxMagnitude) {
    return { ok: false, error: `Use a magnitude from ${SCALE_BY_TUNING.minMagnitude} to ${SCALE_BY_TUNING.maxMagnitude}.` };
  }
  if (Math.abs(factor - 1) < SCALE_BY_TUNING.noOpEpsilon) {
    return { ok: false, error: '×1 leaves the selection unchanged.' };
  }
  return { ok: true, factor };
}
