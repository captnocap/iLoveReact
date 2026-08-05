// editor/data/panelSystem.ts — the contextual side-panel contract (req_3266).
//
// The center document + active tool decide which panes exist. The left rail is
// the contextual INPUT dock: one Asset Explorer and a peer Paint workspace
// while painting. Folder/category navigation belongs inside that explorer;
// rail aliases that only changed its starting folder are not separate panes.
// The right rail owns document/selection FOCUS. A rail
// never advertises a pane without a renderer. Pressing the selected rail button
// again collapses its adjacent panel; another button selects and opens it.
import type { ContentFolderId, WorkspaceDocumentKind } from './types';

export type LeftPanelId = 'assets' | 'paint' | 'world-bible';
export type RightPanelId = 'inspector' | 'paint' | 'rig' | 'names';

export type PanelButton<Id extends string> = {
  id: Id;
  label: string;
  icon: string;
};

export type LeftPanelButton =
  | (PanelButton<LeftPanelId> & { renderer: 'library' })
  | (PanelButton<LeftPanelId> & { renderer: 'paint' | 'world-bible' });

export type RightPanelButton = PanelButton<RightPanelId>;

const ASSETS = { id: 'assets', label: 'All assets', icon: 'FolderTree', renderer: 'library' } as const;
const PAINT = { id: 'paint', label: 'Paint', icon: 'Paintbrush', renderer: 'paint' } as const;
const WORLD_BIBLE = { id: 'world-bible', label: 'World Bible index', icon: 'BookOpen', renderer: 'world-bible' } as const;

const ASSET_LEFT = [ASSETS] as const;
const PAINT_LEFT = [PAINT, ASSETS] as const;
const KNOWLEDGE_LEFT = [WORLD_BIBLE] as const;

const INSPECTOR = { id: 'inspector', label: 'Focus', icon: 'SlidersHorizontal' } as const;
const MODEL_RIGHT = [
  { id: 'inspector', label: 'Model', icon: 'SlidersHorizontal' },
  { id: 'paint', label: 'Atlas', icon: 'Image' },
  // The semantic region table earns its own pane beside the atlas (req_3884):
  // the whole list at once, each row selecting its faces on the model.
  { id: 'names', label: 'Names', icon: 'Tag' },
  { id: 'rig', label: 'Rig', icon: 'Bone' },
] as const;
const FOCUS_RIGHT = [INSPECTOR] as const;

export function leftPanelsFor(kind: WorkspaceDocumentKind, paintActive = false): readonly LeftPanelButton[] {
  if (kind === 'knowledge') return KNOWLEDGE_LEFT;
  if (paintActive && (kind === 'model' || kind === 'facade')) return PAINT_LEFT;
  return ASSET_LEFT;
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

/** Every library folder belongs to the one Asset Explorer rail destination. */
export function leftPanelForFolder(
  kind: WorkspaceDocumentKind,
  _folder: ContentFolderId,
  fallback: LeftPanelId,
): LeftPanelId {
  const buttons = leftPanelsFor(kind);
  if (buttons.some((button) => button.id === 'assets')) return 'assets';
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
  if (value === 'grid' || value === 'pieces' || value === 'actors' || value === 'data') return 'assets';
  if (value === 'world' || value === 'pipeline' || value === 'build' || value === 'models' || value === 'materials' || value === 'characters' || value === 'missions') return 'assets';
  if (value === 'tool-options' || value === 'ink') return 'paint';
  return (['assets', 'paint', 'world-bible'] as const).includes(value as LeftPanelId)
    ? value as LeftPanelId
    : 'assets';
}

export function normalizeRightPanelId(value: string): RightPanelId {
  return value === 'paint' || value === 'rig' || value === 'names' ? value : 'inspector';
}
