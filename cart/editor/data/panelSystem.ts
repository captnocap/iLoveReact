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

export type LeftPanelId =
  | 'assets'
  | 'paint'
  | 'lab-stack'
  | 'animation-capture' // persisted pre-Foundry id; normalized, never advertised
  | 'animation-sources'
  | 'animation-queue'
  | 'world-bible';
export type RightPanelId =
  | 'inspector'
  | 'outliner'
  | 'paint'
  | 'rig'
  | 'names'
  | 'recovery'
  | 'lab'
  | 'animation-generate'
  | 'animation-scene-context'
  | 'animation-review';

export type PanelButton<Id extends string> = {
  id: Id;
  label: string;
  icon: string;
};

export type LeftPanelButton =
  | (PanelButton<LeftPanelId> & { renderer: 'library' })
  | (PanelButton<LeftPanelId> & {
      renderer:
        | 'paint'
        | 'lab-stack'
        | 'animation-sources'
        | 'animation-queue'
        | 'animation-queue-manager'
        | 'world-bible';
    });

export type RightPanelButton = PanelButton<RightPanelId> & {
  renderer:
    | 'inspector'
    | 'world-outliner'
    | 'paint'
    | 'rig'
    | 'names'
    | 'recovery'
    | 'lab'
    | 'animation-generate'
    | 'animation-scene-context'
    | 'animation-review';
};

const ASSETS = { id: 'assets', label: 'Assets', icon: 'FolderTree', renderer: 'library' } as const;
const PAINT = { id: 'paint', label: 'Paint', icon: 'Paintbrush', renderer: 'paint' } as const;
// The Material Lab's Layers panel is a left-rail peer exactly like Paint (req_4406):
// it joins while a Lab document (recipe-backed material) is focused.
const LAB_STACK = { id: 'lab-stack', label: 'Layers', icon: 'Layers', renderer: 'lab-stack' } as const;
const ANIMATION_SOURCES = { id: 'animation-sources', label: 'Sources', icon: 'ScanLine', renderer: 'animation-sources' } as const;
const GLOBAL_QUEUE = { id: 'animation-queue', label: 'Queue', icon: 'ListTodo', renderer: 'animation-queue' } as const;
const ANIMATION_QUEUE = { ...GLOBAL_QUEUE, renderer: 'animation-queue-manager' } as const;
const WORLD_BIBLE = { id: 'world-bible', label: 'World Bible index', icon: 'BookOpen', renderer: 'world-bible' } as const;

const ASSET_LEFT = [ASSETS, GLOBAL_QUEUE] as const;
const PAINT_LEFT = [PAINT, ASSETS, GLOBAL_QUEUE] as const;
const LAB_LEFT = [LAB_STACK, ASSETS, GLOBAL_QUEUE] as const;
const ANIMATION_LEFT = [ANIMATION_SOURCES, ANIMATION_QUEUE, ASSETS] as const;
const KNOWLEDGE_LEFT = [WORLD_BIBLE, GLOBAL_QUEUE] as const;

const INSPECTOR = { id: 'inspector', label: 'Focus', icon: 'SlidersHorizontal', renderer: 'inspector' } as const;
const MODEL_RIGHT = [
  { id: 'inspector', label: 'Model', icon: 'SlidersHorizontal', renderer: 'inspector' },
  { id: 'paint', label: 'Atlas', icon: 'Image', renderer: 'paint' },
  // The semantic region table earns its own pane beside the atlas (req_3884):
  // the whole list at once, each row selecting its faces on the model.
  { id: 'names', label: 'Names', icon: 'Tag', renderer: 'names' },
  { id: 'rig', label: 'Rig', icon: 'Bone', renderer: 'rig' },
  { id: 'recovery', label: 'Recovery', icon: 'DatabaseBackup', renderer: 'recovery' },
] as const;
const FOCUS_RIGHT = [INSPECTOR] as const;
// The world document's rail (req_4737): the piece-aware Focus panel plus the
// global outliner — everything placed on the map as one grouped tree.
const WORLD_RIGHT = [
  { id: 'inspector', label: 'Focus', icon: 'SlidersHorizontal', renderer: 'inspector' },
  { id: 'outliner', label: 'Outliner', icon: 'ListTree', renderer: 'world-outliner' },
] as const;
// The Lab document's right rail is the Lab inspector — the world-tile Focus
// panel is deliberately NOT in this set (req_4406): it returns with world focus.
const LAB_RIGHT = [
  { id: 'lab', label: 'Lab inspector', icon: 'FlaskConical', renderer: 'lab' },
] as const;
const ANIMATION_RIGHT = [
  { id: 'animation-generate', label: 'Generate', icon: 'Sparkles', renderer: 'animation-generate' },
  { id: 'animation-scene-context', label: 'Scene Context', icon: 'Armchair', renderer: 'animation-scene-context' },
  { id: 'animation-review', label: 'Review', icon: 'GalleryHorizontalEnd', renderer: 'animation-review' },
] as const;

export function leftPanelsFor(kind: WorkspaceDocumentKind, paintActive = false, labActive = false): readonly LeftPanelButton[] {
  // Home owns the whole stage: it IS the navigation, so it borrows no rails.
  if (kind === 'home') return [];
  if (kind === 'knowledge') return KNOWLEDGE_LEFT;
  if (paintActive && (kind === 'model' || kind === 'facade')) return PAINT_LEFT;
  if (labActive && kind === 'material') return LAB_LEFT;
  if (kind === 'animation') return ANIMATION_LEFT;
  return ASSET_LEFT;
}

export function rightPanelsFor(kind: WorkspaceDocumentKind, labActive = false): readonly RightPanelButton[] {
  if (kind === 'home' || kind === 'knowledge') return [];
  if (kind === 'model') return MODEL_RIGHT;
  if (labActive && kind === 'material') return LAB_RIGHT;
  if (kind === 'animation') return ANIMATION_RIGHT;
  if (kind === 'world') return WORLD_RIGHT;
  return FOCUS_RIGHT;
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
  if (value === 'animation-capture') return 'animation-sources';
  return (['assets', 'paint', 'lab-stack', 'animation-sources', 'animation-queue', 'world-bible'] as const).includes(value as LeftPanelId)
    ? value as LeftPanelId
    : 'assets';
}

export function normalizeRightPanelId(value: string): RightPanelId {
  return value === 'outliner' || value === 'paint' || value === 'rig' || value === 'names' || value === 'recovery' || value === 'lab'
    || value === 'animation-generate' || value === 'animation-scene-context' || value === 'animation-review'
    ? value
    : 'inspector';
}
