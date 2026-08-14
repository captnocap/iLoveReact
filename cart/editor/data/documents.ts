import type { Asset, ModelPackage, WorkspaceDocument } from './types';

export const WORLD_DOCUMENT_ID = 'world:main';

/** The world tab. Its subtitle used to read 'main.gamefile' — a file that does
 *  not exist; the world lives in the ACTIVE MAP DOCUMENT's directory. The live
 *  map name is supplied by the shell instead (worldDocument), so a restored
 *  world carries its real name (req_4435). */
export const WORLD_DOCUMENT: WorkspaceDocument = {
  id: WORLD_DOCUMENT_ID,
  kind: 'world',
  title: 'World Editor',
};

/** The world tab named by the map actually open in it. */
export function worldDocument(mapName: string): WorkspaceDocument {
  return { ...WORLD_DOCUMENT, subtitle: mapName };
}

// HOME — the boot surface (req_4435). One document, opened by a cold start and
// re-openable from File; closeable like any other tab, and never recorded in
// the session (resuming from Home must not reopen Home).
export const HOME_DOCUMENT_ID = 'home:start';

export const HOME_DOCUMENT: WorkspaceDocument = {
  id: HOME_DOCUMENT_ID,
  kind: 'home',
  title: 'Home',
};

// One project-wide World Bible tab. Individual entities navigate inside this
// ordinary wiki document; they are not hundreds of workspace tabs.
export const WORLD_BIBLE_DOCUMENT_ID = 'knowledge:world-bible';

export const WORLD_BIBLE_DOCUMENT: WorkspaceDocument = {
  id: WORLD_BIBLE_DOCUMENT_ID,
  kind: 'knowledge',
  title: 'World Bible',
  subtitle: '',
};

// The playtest drop-in tab (GLOBALS req_2770): ONE document, upserted by the
// Globals menu — the same editor world with the embodied player, where global
// tunables are tested live. Closeable like any non-world tab.
export const PLAYTEST_DOCUMENT_ID = 'playtest:globals';

export const PLAYTEST_DOCUMENT: WorkspaceDocument = {
  id: PLAYTEST_DOCUMENT_ID,
  kind: 'playtest',
  title: 'Playtest',
  subtitle: 'physics globals',
};

// The animation capture tab (req_2786): webcam feed beside the exported
// player model with live pose sync — the workbench arc's CAPTURE surface.
// ONE document, upserted by Globals → Animation.
export const ANIMATION_DOCUMENT_ID = 'animation:capture';

export const ANIMATION_DOCUMENT: WorkspaceDocument = {
  id: ANIMATION_DOCUMENT_ID,
  kind: 'animation',
  title: 'Animation',
  subtitle: 'webcam capture',
};

export function modelDocument(model: ModelPackage): WorkspaceDocument {
  return {
    id: `model:${model.id}`,
    kind: 'model',
    title: model.name,
    // No seed-kind subtitle. A model is a container of parts (the Outliner) — a "cone"
    // subtitle goes stale the instant a second part joins. Studio meshes keep their
    // real provenance label; everything else rides on the title alone (req_2406).
    subtitle: model.sourceKind === 'studio-model' ? 'Studio mesh' : undefined,
    sourceId: model.id,
  };
}

export function materialDocument(asset: Asset): WorkspaceDocument {
  return {
    id: `material:${asset.id}`,
    kind: 'material',
    title: asset.name,
    subtitle: asset.sourceKind ?? 'material',
    sourceId: asset.id,
  };
}

export function upsertDocument(documents: WorkspaceDocument[], next: WorkspaceDocument): WorkspaceDocument[] {
  return documents.some((doc) => doc.id === next.id)
    ? documents.map((doc) => doc.id === next.id ? next : doc)
    : [...documents, next];
}
