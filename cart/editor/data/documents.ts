import type { Asset, ModelPackage, WorkspaceDocument } from './types';

export const WORLD_DOCUMENT_ID = 'world:main';

export const WORLD_DOCUMENT: WorkspaceDocument = {
  id: WORLD_DOCUMENT_ID,
  kind: 'world',
  title: 'World Editor',
  subtitle: 'main.gamefile',
};

export function modelDocument(model: ModelPackage): WorkspaceDocument {
  return {
    id: `model:${model.id}`,
    kind: 'model',
    title: model.name,
    subtitle: model.sourceKind === 'studio-model' ? 'Studio mesh' : model.semanticKind ?? model.kind,
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
