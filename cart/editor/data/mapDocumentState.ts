// Pure state boundary for New/Open. Keeping this independent from filesystem
// and host doors makes the no-carry law directly testable: a transition returns
// every map-authored React slice as a replacement, never a merge.
import type { EditorState } from './types';
import type { WorldSave, WorldSnapshotInput } from './worldStore';
import type { TileMaterialBinding } from '../render3d/groundFormula';
import {
  cloneArchitectureSource,
  DEFAULT_ARCHITECTURE_TOOL,
  EMPTY_ARCHITECTURE_SELECTION,
} from '../world/architecture';

export type MapAuthoringSlices = Pick<EditorState,
  | 'activeMapStem'
  | 'activeMapName'
  | 'activeCommandId'
  | 'architecture'
  | 'architectureSelection'
  | 'architectureTool'
  | 'worldPieces'
  | 'worldFlora'
  | 'worldPrefabs'
  | 'worldFacades'
  | 'objects'
  | 'selectedObjectId'
  | 'selectedPieceId'
  | 'selectedPieceIds'
  | 'selectedFloraPatchId'
  | 'armedStamp'
  | 'armedPieceId'
  | 'armedYawDegrees'
  | 'worldUndo'
  | 'worldRedo'
  | 'floorIndex'
  | 'mapPaint'
  | 'mapDocumentOpen'
  | 'addChunkOpen'
  | 'contextOpen'
  | 'seq'
>;

type WorldSnapshotState = Pick<EditorState,
  | 'activeMapStem'
  | 'seq'
  | 'architecture'
  | 'worldPieces'
  | 'worldFlora'
  | 'worldPrefabs'
  | 'objects'
  | 'mapPaint'
  | 'worldFacades'
  | 'worldViews'
>;

/** The one React-state → world-save boundary. Keeping the complete named shape
 * here prevents a store signature change from turning AppFrame's arguments into
 * an untyped positional call at runtime (esbuild deliberately strips TS types). */
export function worldSnapshotInputFor(
  state: WorldSnapshotState,
  overrides: Partial<Pick<WorldSnapshotInput, 'document' | 'zones'>> = {},
): WorldSnapshotInput {
  return {
    document: overrides.document ?? state.activeMapStem,
    seq: state.seq,
    architecture: state.architecture,
    pieces: state.worldPieces,
    worldFlora: state.worldFlora,
    prefabs: state.worldPrefabs,
    objects: state.objects,
    zones: overrides.zones ?? state.mapPaint.zones,
    facades: state.worldFacades,
    views: state.worldViews,
  };
}

export function mapAuthoringSlicesFor(
  previous: Pick<EditorState, 'seq' | 'mapPaint'>,
  stem: string,
  save: WorldSave,
  bindings: readonly TileMaterialBinding[],
  name = stem,
): MapAuthoringSlices {
  const zones = save.zones.slice();
  const tileBindings = bindings.slice();
  return {
    activeMapStem: stem,
    activeMapName: name,
    activeCommandId: 'select-tool',
    architecture: cloneArchitectureSource(save.architecture),
    architectureSelection: EMPTY_ARCHITECTURE_SELECTION,
    architectureTool: DEFAULT_ARCHITECTURE_TOOL,
    worldPieces: save.pieces.slice(),
    worldFlora: save.worldFlora.slice(),
    worldPrefabs: save.prefabs.slice(),
    worldFacades: save.facades.slice(),
    objects: save.objects.slice(),
    selectedObjectId: save.objects.find((object) => !object.hidden)?.id ?? 'obj-tile',
    selectedPieceId: null,
    selectedPieceIds: [],
    selectedFloraPatchId: null,
    armedStamp: null,
    // Nothing is armed until the user arms something. Opening a map does not
    // decide what they are about to build (req_4435).
    armedPieceId: null,
    armedYawDegrees: 0,
    worldUndo: [],
    worldRedo: [],
    floorIndex: 0,
    mapPaint: {
      ...previous.mapPaint,
      active: false,
      texturePickerOpen: false,
      zones,
      zoneIdx: zones.length ? Math.min(previous.mapPaint.zoneIdx, zones.length - 1) : 0,
      tileBindings,
      tileBindIdx: -1,
    },
    mapDocumentOpen: false,
    addChunkOpen: false,
    contextOpen: false,
    // seq is shared by editor ids beyond maps, so it only grows. This is not
    // authored content and prevents both map-piece and model-document collisions.
    seq: Math.max(previous.seq, save.seq),
  };
}
