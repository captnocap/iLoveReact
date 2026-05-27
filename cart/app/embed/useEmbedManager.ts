// React adapter for cart/app/embed/manager.ts.
//
// Subscribes to the singleton, exposes the fleet-shape state plus
// action handles. Any component anywhere can `useEmbedManager()` —
// settings UI, sweatshop research node, the assistant chat tool — and
// the manager keeps running regardless of who's mounted.

import { useEffect, useState } from 'react';
import {
  deleteSource,
  getState,
  listSources,
  loadedModels,
  newSourceDraft,
  pauseSource,
  resetSource,
  runQuery,
  runSource,
  saveSource,
  subscribe,
  unloadAll,
  type EmbedSource,
  type ManagerState,
  type QueryOpts,
} from './manager';

export interface UseEmbedManager extends ManagerState {
  sources: EmbedSource[];
  loadedModels: ReturnType<typeof loadedModels>;
  saveSource: (s: EmbedSource) => Promise<void>;
  deleteSource: (id: string) => Promise<void>;
  newSourceDraft: typeof newSourceDraft;
  runSource: (id: string) => boolean;
  pauseSource: (id: string) => void;
  resetSource: (id: string) => Promise<void>;
  unloadAll: () => void;
  query: (text: string, opts?: Partial<QueryOpts>) => ReturnType<typeof runQuery>;
}

export function useEmbedManager(): UseEmbedManager {
  const [snap, setSnap] = useState<ManagerState>(getState);
  const [sources, setSources] = useState<EmbedSource[]>(() => listSources());
  useEffect(() => subscribe(() => {
    setSnap({ ...getState() });
    setSources(listSources());
  }), []);
  return {
    ...snap,
    sources,
    loadedModels: loadedModels(),
    saveSource,
    deleteSource,
    newSourceDraft,
    runSource,
    pauseSource,
    resetSource,
    unloadAll,
    query: runQuery,
  };
}
