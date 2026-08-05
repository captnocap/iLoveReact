// editor/data/panelSystem.ts — the contextual side-panel contract (req_3266).
//
// The center document + active tool decide which panes exist. The left rail is
// the contextual INPUT dock: source libraries and a peer Paint workspace while
// painting. The right rail owns document/selection FOCUS. A rail
// never advertises a pane without a renderer. Pressing the selected rail button
// again collapses its adjacent panel; another button selects and opens it.
import type { ContentFolderId, WorkspaceDocumentKind } from './types';

export type LeftPanelId = 'assets' | 'build' | 'models' | 'materials' | 'characters' | 'missions' | 'paint' | 'world-bible';
export type RightPanelId = 'inspector' | 'paint' | 'rig';

export type PanelButton<Id extends string> = {
  id: Id;
  label: string;
  icon: string;
};

export type LeftPanelButton =
  | (PanelButton<LeftPanelId> & {
      renderer: 'library';
      /** Root selected when changing to this source library. */
      folder: ContentFolderId;
    })
  | (PanelButton<LeftPanelId> & { renderer: 'paint' | 'world-bible' });

export type RightPanelButton = PanelButton<RightPanelId>;

const ASSETS = { id: 'assets', label: 'All assets', icon: 'FolderTree', renderer: 'library', folder: 'game' } as const;
const BUILD = { id: 'build', label: 'Build assets', icon: 'Blocks', renderer: 'library', folder: 'architecture' } as const;
const MODELS = { id: 'models', label: 'Models', icon: 'Box', renderer: 'library', folder: 'models' } as const;
const MATERIALS = { id: 'materials', label: 'Materials', icon: 'Palette', renderer: 'library', folder: 'materials' } as const;
const CHARACTERS = { id: 'characters', label: 'Characters', icon: 'UserRound', renderer: 'library', folder: 'characters' } as const;
const MISSIONS = { id: 'missions', label: 'Mission assets', icon: 'Map', renderer: 'library', folder: 'missions' } as const;
const PAINT = { id: 'paint', label: 'Paint', icon: 'Paintbrush', renderer: 'paint' } as const;
const WORLD_BIBLE = { id: 'world-bible', label: 'World Bible index', icon: 'BookOpen', renderer: 'world-bible' } as const;

const WORLD_LEFT = [ASSETS, BUILD, MODELS, MATERIALS, CHARACTERS, MISSIONS] as const;
const MODEL_LEFT = [MODELS, MATERIALS] as const;
const MATERIAL_LEFT = [MATERIALS, MODELS] as const;
const ANIMATION_LEFT = [CHARACTERS, MODELS] as const;
const FACADE_LEFT = [MATERIALS, MODELS] as const;
const MODEL_PAINT_LEFT = [PAINT, MODELS, MATERIALS] as const;
const FACADE_PAINT_LEFT = [PAINT, MATERIALS, MODELS] as const;
const KNOWLEDGE_LEFT = [WORLD_BIBLE] as const;

const INSPECTOR = { id: 'inspector', label: 'Focus', icon: 'SlidersHorizontal' } as const;
const MODEL_RIGHT = [
  { id: 'inspector', label: 'Model', icon: 'SlidersHorizontal' },
  { id: 'paint', label: 'Atlas', icon: 'Image' },
  { id: 'rig', label: 'Rig', icon: 'Bone' },
] as const;
const FOCUS_RIGHT = [INSPECTOR] as const;

export function leftPanelsFor(kind: WorkspaceDocumentKind, paintActive = false): readonly LeftPanelButton[] {
  if (kind === 'knowledge') return KNOWLEDGE_LEFT;
  if (paintActive && kind === 'model') return MODEL_PAINT_LEFT;
  if (paintActive && kind === 'facade') return FACADE_PAINT_LEFT;
  if (kind === 'model') return MODEL_LEFT;
  if (kind === 'material') return MATERIAL_LEFT;
  if (kind === 'animation') return ANIMATION_LEFT;
  if (kind === 'facade') return FACADE_LEFT;
  return WORLD_LEFT;
}

export function rightPanelsFor(kind: WorkspaceDocumentKind): readonly RightPanelButton[] {
  if (kind === 'knowledge') return [];
  return kind === 'model' ? MODEL_RIGHT : FOCUS_RIGHT;
}

export function resolvedPanelId<Id extends string>(buttons: readonly PanelButton<Id>[], requested: string): Id {
  return buttons.find((button) => button.id === requested)?.id ?? buttons[0]!.id;
}

/** Empty panel families are intentional for documents without that rail. */
export function resolvedPanelIdOrNull<Id extends string>(buttons: readonly PanelButton<Id>[], requested: string): Id | null {
  return buttons.find((button) => button.id === requested)?.id ?? buttons[0]?.id ?? null;
}

export type PanelPressResult<Id extends string> = {
  active: Id;
  collapsed: boolean;
};

/** The one interaction law shared by both rails. */
export function pressPanelButton<Id extends string>(active: Id, pressed: Id, collapsed: boolean): PanelPressResult<Id> {
  if (active === pressed) return { active, collapsed: !collapsed };
  return { active: pressed, collapsed: false };
}

/** Keep the left-rail highlight in step when navigation happens inside the tree. */
export function leftPanelForFolder(
  kind: WorkspaceDocumentKind,
  folder: ContentFolderId,
  fallback: LeftPanelId,
): LeftPanelId {
  let candidate: LeftPanelId = 'assets';
  if (folder === 'architecture' || folder === 'build-pieces' || folder === 'prefabs') candidate = 'build';
  else if (folder === 'models' || folder.startsWith('models-') || folder.startsWith('model-')) candidate = 'models';
  else if (folder === 'materials' || folder.startsWith('materials-')) candidate = 'materials';
  else if (folder === 'characters') candidate = 'characters';
  else if (folder === 'missions' || folder === 'bankheist' || folder === 'mission-assets' || folder === 'scripts' || folder === 'ui') candidate = 'missions';

  const buttons = leftPanelsFor(kind);
  if (buttons.some((button) => button.id === candidate)) return candidate;
  if (buttons.some((button) => button.id === fallback)) return fallback;
  return buttons[0]!.id;
}

/** Retired model-package child rows used `model-…/<storage-dir>` ids. A hot
 * reload can still carry one; return it to the real model asset node. */
export function normalizeContentFolderId(folder: ContentFolderId): ContentFolderId {
  const value = String(folder);
  const slash = value.indexOf('/');
  return value.startsWith('model-') && slash > 0
    ? value.slice(0, slash) as ContentFolderId
    : folder;
}

/** Hot-state migrations from the inert mock-era rail vocabulary. */
export function normalizeLeftPanelId(value: string): LeftPanelId {
  if (value === 'grid') return 'materials';
  if (value === 'pieces') return 'build';
  if (value === 'actors') return 'characters';
  if (value === 'data') return 'missions';
  if (value === 'world' || value === 'pipeline') return 'assets';
  if (value === 'tool-options' || value === 'ink') return 'paint';
  return (['assets', 'build', 'models', 'materials', 'characters', 'missions', 'paint', 'world-bible'] as const).includes(value as LeftPanelId)
    ? value as LeftPanelId
    : 'assets';
}

export function normalizeRightPanelId(value: string): RightPanelId {
  return value === 'paint' || value === 'rig' ? value : 'inspector';
}
