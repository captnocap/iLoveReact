// buildjournal/buildNumber.ts — the self-incrementing build-number stream.
//
// User direction (DESIGN_INTAKE → "Build number can be request-derived, e.g.
// 1.0.0.2108, where 2108 maps to the latest request/build note"). The request
// id IS the build counter; we just present it as a version. Pure + deterministic:
// same request id → same build number, forever, on every machine.

/** Fixed semantic-version base the request counter rides on. The 4th field is
 *  the request number, so the version self-increments as requests land. */
export const BUILD_BASE = '1.0.0';

/** Pull the request counter out of a request id or raw value.
 *  'req_2163' → 2163, 'req_0007' → 7, 2163 → 2163. The trailing digit run wins,
 *  so any prefix convention ('req_', 'request-', …) works. Returns NaN if there
 *  is no number to find — callers should treat that as "not a real request". */
export function requestNumber(requestId: string | number): number {
  if (typeof requestId === 'number') return Math.trunc(requestId);
  const m = String(requestId).match(/(\d+)\s*$/);
  return m ? parseInt(m[1]!, 10) : NaN;
}

/** Derive the `1.0.0.<n>` build-number stream value for a request id.
 *  Deterministic and pure — the journal's stable mapping from request → build. */
export function deriveBuildNumber(requestId: string | number): string {
  const n = requestNumber(requestId);
  if (Number.isNaN(n)) {
    throw new Error(`buildjournal: cannot derive a build number from '${requestId}' (no request counter)`);
  }
  return `${BUILD_BASE}.${n}`;
}

/** Invert a derived build number back to its request counter. '1.0.0.2163' → 2163.
 *  Returns NaN if the value is not on the BUILD_BASE stream. */
export function buildNumberToRequest(buildId: string): number {
  const prefix = BUILD_BASE + '.';
  if (!buildId.startsWith(prefix)) return NaN;
  const tail = buildId.slice(prefix.length);
  return /^\d+$/.test(tail) ? parseInt(tail, 10) : NaN;
}
