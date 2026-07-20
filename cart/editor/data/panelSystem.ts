// editor/data/panelSystem.ts — the contextual side-panel contract (req_3266).
//
// The center document decides which panes exist. The left rail owns SOURCE
// libraries (things brought into the stage); the right rail owns FOCUS tools
// (things done to the document/selection in the stage). A rail never advertises
// a pane without a renderer. Pressing the selected rail button again collapses
// its adjacent panel; pressing another button selects it and opens the panel.
import type { ContentFolderId, WorkspaceDocumentKind } from './types';

export type LeftPanelId = 'assets' | 'build' | 'models' | 'materials' | 'characters' | 'missions';
export type RightPanelId = 'inspector' | 'paint' | 'rig';

export type PanelButton<Id extends string> = {
  id: Id;
  label: string;
  icon: string;
};

export type LeftPanelButton = PanelButton<LeftPanelId> & {
  /** Root selected when changing to this source library. */
  folder: ContentFolderId;
};

export type RightPanelButton = PanelButton<RightPanelId>;

const ASSETS = { id: 'assets', label: 'All assets', icon: 'FolderTree', folder: 'game' } as const;
const BUILD = { id: 'build', label: 'Build assets', icon: 'Blocks', folder: 'architecture' } as const;
const MODELS = { id: 'models', label: 'Models', icon: 'Box', folder: 'models' } as const;
const MATERIALS = { id: 'materials', label: 'Materials', icon: 'Palette', folder: 'materials' } as const;
const CHARACTERS = { id: 'characters', label: 'Characters', icon: 'UserRound', folder: 'characters' } as const;
const MISSIONS = { id: 'missions', label: 'Mission assets', icon: 'Map', folder: 'missions' } as const;

const WORLD_LEFT = [ASSETS, BUILD, MODELS, MATERIALS, CHARACTERS, MISSIONS] as const;
const MODEL_LEFT = [MODELS, MATERIALS] as const;
const MATERIAL_LEFT = [MATERIALS, MODELS] as const;
const ANIMATION_LEFT = [CHARACTERS, MODELS] as const;
const FACADE_LEFT = [MATERIALS, MODELS] as const;

const INSPECTOR = { id: 'inspector', label: 'Focus', icon: 'SlidersHorizontal' } as const;
const MODEL_RIGHT = [
  { id: 'inspector', label: 'Model', icon: 'SlidersHorizontal' },
  { id: 'paint', label: 'Paint', icon: 'Layers' },
  { id: 'rig', label: 'Rig', icon: 'Bone' },
] as const;
const FOCUS_RIGHT = [INSPECTOR] as const;

export function leftPanelsFor(kind: WorkspaceDocumentKind): readonly LeftPanelButton[] {
  if (kind === 'model') return MODEL_LEFT;
  if (kind === 'material') return MATERIAL_LEFT;
  if (kind === 'animation') return ANIMATION_LEFT;
  if (kind === 'facade') return FACADE_LEFT;
  return WORLD_LEFT;
}

export function rightPanelsFor(kind: WorkspaceDocumentKind): readonly RightPanelButton[] {
  return kind === 'model' ? MODEL_RIGHT : FOCUS_RIGHT;
}

export function resolvedPanelId<Id extends string>(buttons: readonly PanelButton<Id>[], requested: string): Id {
  return buttons.find((button) => button.id === requested)?.id ?? buttons[0]!.id;
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

/** Hot-state migrations from the inert mock-era rail vocabulary. */
export function normalizeLeftPanelId(value: string): LeftPanelId {
  if (value === 'grid') return 'materials';
  if (value === 'pieces') return 'build';
  if (value === 'actors') return 'characters';
  if (value === 'data') return 'missions';
  if (value === 'world' || value === 'pipeline') return 'assets';
  return (['assets', 'build', 'models', 'materials', 'characters', 'missions'] as const).includes(value as LeftPanelId)
    ? value as LeftPanelId
    : 'assets';
}

export function normalizeRightPanelId(value: string): RightPanelId {
  return value === 'paint' || value === 'rig' ? value : 'inspector';
}
