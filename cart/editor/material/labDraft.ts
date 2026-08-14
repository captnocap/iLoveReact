// editor/material/labDraft.ts — the Lab's transient slider-drag previews
// (req_4406). The DIALS moved into the right rail's Lab panel while the live
// preview stayed on the center stage, so the draft can no longer be one
// component's local state. This store is the seam: the panel writes on drag,
// the stage subscribes and re-renders LOCALLY — AppFrame never re-renders per
// mousemove, preserving the two-speed contract (drafts render through
// recipeData overrides; commit clears the draft and stores numbers in the
// recipe document).
import { useEffect, useState } from 'react';

let g_draft = new Map<string, number>();
const g_listeners = new Set<() => void>();

function ping(): void {
  for (const listener of g_listeners) listener();
}

export function labDraftParams(): Map<string, number> {
  return g_draft;
}

export function setLabDraftParam(key: string, value: number): void {
  const next = new Map(g_draft);
  next.set(key, value);
  g_draft = next;
  ping();
}

export function clearLabDraftParams(): void {
  if (g_draft.size === 0) return;
  g_draft = new Map();
  ping();
}

/** Subscribe a component to the draft — returns the live map, fresh on every drag tick. */
export function useLabDraftParams(): Map<string, number> {
  const [draft, setDraft] = useState(g_draft);
  useEffect(() => {
    const listener = () => setDraft(g_draft);
    g_listeners.add(listener);
    listener();
    return () => { g_listeners.delete(listener); };
  }, []);
  return draft;
}
