import { useEffect, useState } from 'react';
import { worldBibleController, type WorldBibleSnapshot } from './controller';

export function useWorldBibleSnapshot(): WorldBibleSnapshot {
  const [snapshot, setSnapshot] = useState<WorldBibleSnapshot>(() => worldBibleController.snapshot());
  useEffect(() => {
    const update = () => setSnapshot(worldBibleController.snapshot());
    const unsubscribe = worldBibleController.subscribe(update);
    worldBibleController.ensureLoaded();
    update();
    return unsubscribe;
  }, []);
  return snapshot;
}
