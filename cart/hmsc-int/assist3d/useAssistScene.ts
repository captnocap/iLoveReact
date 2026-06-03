// assist3d/useAssistScene — the shared read side of the assistant scene.
//
// Both the /assist3d route's hot surface AND the Objects explorer mount this
// hook. Each gets its own file watcher; the scene.json on disk is the rendezvous
// (disk = truth), so the explorer reflects whatever the route's assistant wrote
// without any cross-tree state plumbing.

import { useEffect, useMemo, useState } from 'react';
import { useFileWatch, fs } from '@reactjit/hooks';
import { EMPTY_SCENE, parseScene, sceneFilePath, type SceneSpec } from './scene';

export interface AssistSceneState {
  scene: SceneSpec;
  loadErr: string | null;
  reloads: number;
  scenePath: string;
  reload: () => void;
}

export function useAssistScene(): AssistSceneState {
  const scenePath = useMemo(() => sceneFilePath(), []);
  const [scene, setScene] = useState<SceneSpec>(EMPTY_SCENE);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const reload = () => {
    const text = fs.readFile(scenePath);
    if (text == null) { setLoadErr('scene.json not found'); return; }
    const parsed = parseScene(text);
    if (!parsed) { setLoadErr('scene.json failed to parse (mid-write?)'); return; }
    setLoadErr(null);
    setScene(parsed);
    setReloads((n) => n + 1);
  };

  useEffect(() => { reload(); /* eslint-disable-line */ }, [scenePath]);
  useFileWatch(scenePath, (e) => { if (e.type !== 'deleted') reload(); });

  return { scene, loadErr, reloads, scenePath, reload };
}
