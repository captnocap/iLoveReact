// envelope.ts — workspace session file format.
//
// Every workspace-style cart persists its working state as a JSON file
// matching this envelope shape. The envelope provides identity, version,
// and a kind tag; the cart's domain-specific shape lives in `payload`.
//
//   {
//     "kind":    "<cart-name>-session",
//     "version": 1,
//     "savedAt": 1716000000000,
//     "stem":    "untitled",
//     "payload": { /* cart-specific */ }
//   }
//
// kind + version together identify both the cart and the schema
// revision. Bump `version` when the payload shape changes incompatibly;
// the cart can layer migration on top by re-trying parse with older
// versions when the current one returns null.

export interface SessionEnvelope<T> {
  /** '<cartName>-session' — used to reject foreign session files. */
  kind: string;
  /** Schema revision for the payload. parseEnvelope rejects mismatches. */
  version: number;
  /** Date.now() at save time. Informational; not used for ordering. */
  savedAt: number;
  /** Project identity (filename-safe). Doubles as the on-disk filename. */
  stem: string;
  /** Cart-specific working state. Shape opaque to the workspace layer. */
  payload: T;
}

export interface BuildEnvelopeArgs<T> {
  cartName: string;
  version: number;
  stem: string;
  payload: T;
}

export function buildEnvelope<T>(args: BuildEnvelopeArgs<T>): SessionEnvelope<T> {
  return {
    kind: `${args.cartName}-session`,
    version: args.version,
    savedAt: Date.now(),
    stem: args.stem,
    payload: args.payload,
  };
}

export function serializeEnvelope<T>(env: SessionEnvelope<T>): string {
  return JSON.stringify(env);
}

export interface ParseEnvelopeArgs {
  cartName: string;
  version: number;
}

/** Parse a session JSON. Returns null when the envelope is missing,
 *  malformed, the wrong kind, or a different version. Carts that need
 *  cross-version migration can retry parse with older `{ version: N-1 }`
 *  on null and upgrade the result before applying. */
export function parseEnvelope<T>(text: string, args: ParseEnvelopeArgs): SessionEnvelope<T> | null {
  let raw: any;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== `${args.cartName}-session`) return null;
  if (raw.version !== args.version) return null;
  if (typeof raw.stem !== 'string') return null;
  if (typeof raw.savedAt !== 'number') return null;
  if (!('payload' in raw)) return null;
  return raw as SessionEnvelope<T>;
}
