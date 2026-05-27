// paths.ts — disk layout for workspace carts.
//
//   cart/<cartName>/sessions/_last.txt            — stem of the most recently
//                                                    opened session. Cart reads
//                                                    this first on mount.
//   cart/<cartName>/sessions/<stem>.session.json  — the SessionEnvelope JSON.
//
// Sidecar binaries (sample WAVs, captured images, large blobs) live
// outside this scope — put them under
// `cart/<cartName>/<assetkind>/<stem>/<id>.<ext>` and reference them by
// id from the payload. The session JSON should stay small and grep-able.

export function sessionsDirFor(cartName: string): string {
  return `cart/${cartName}/sessions`;
}

export function sessionPathFor(cartName: string, stem: string): string {
  return `${sessionsDirFor(cartName)}/${stem}.session.json`;
}

export function lastPointerPath(cartName: string): string {
  return `${sessionsDirFor(cartName)}/_last.txt`;
}
