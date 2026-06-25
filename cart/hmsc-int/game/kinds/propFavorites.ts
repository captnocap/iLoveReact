// propFavorites — durable starred props (req_1913). Favorites are the TOP ranking
// tier in the prop browser, so they must survive a restart (not a hot-only twig):
// persisted in the shared 'hmsc' localstore as a JSON id array. A tiny external
// store + hook so any tile can star/unstar and the browser re-ranks at once.

import { useEffect, useState } from 'react';
import { nsGet, nsSet } from '@reactjit/hooks/localstore';

const NS = 'hmsc';
const KEY = 'props.favorites';

let cache: Set<string> | null = null;
const listeners = new Set<() => void>();

function load(): Set<string> {
  if (cache) return cache;
  try {
    const raw = nsGet(NS, KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    cache = new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch { cache = new Set(); }
  return cache;
}

function persist(): void {
  try { nsSet(NS, KEY, JSON.stringify([...load()])); } catch { /* headless / no store */ }
}

export function isFavorite(id: string): boolean { return load().has(id); }

/** Live favorites set (same instance across calls — mutate via toggle, never here). */
export function favoriteIds(): Set<string> { return load(); }

export function toggleFavorite(id: string): void {
  const set = load();
  if (set.has(id)) set.delete(id); else set.add(id);
  persist();
  for (const l of listeners) l();
}

/** Subscribe a component to favorite changes; returns a SNAPSHOT whose identity
 *  changes on every toggle, so downstream useMemo (the search ranker) re-runs. */
export function useFavorites(): Set<string> {
  const [snap, setSnap] = useState<Set<string>>(() => new Set(load()));
  useEffect(() => {
    const l = () => setSnap(new Set(load()));
    listeners.add(l);
    setSnap(new Set(load())); // resync if it changed between render and effect
    return () => { listeners.delete(l); };
  }, []);
  return snap;
}
