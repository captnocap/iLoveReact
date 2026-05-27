// Shared helpers for the @reactjit/effects registry. One copy, imported by
// every entry — never re-paste color parsing into an effect ([[no_duplication]]).

/** "#rgb" / "#rrggbb" / "rgb(…)" → [r, g, b] in 0..1. Unknown input → mid-grey. */
export function rgb(input: string | undefined, fallback: [number, number, number] = [0.5, 0.5, 0.5]): [number, number, number] {
  if (!input || typeof input !== 'string') return fallback;
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6) return fallback;
    const n = parseInt(hex, 16);
    if (Number.isNaN(n)) return fallback;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return [(p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255];
  }
  return fallback;
}
