// Module-level state for the /plan route. A tiny pub/sub so the
// /plan slash command can hand the typed text from InputStrip to the
// route page without a query-string round-trip.

let pendingIntent: string | null = null;
const listeners = new Set<() => void>();

export function setPendingIntent(text: string): void {
  pendingIntent = text;
  for (const cb of listeners) cb();
}

export function consumePendingIntent(): string | null {
  const t = pendingIntent;
  pendingIntent = null;
  return t;
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
