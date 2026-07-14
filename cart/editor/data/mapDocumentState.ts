// Pure state boundary for New/Open. Keeping this independent from filesystem
// and host doors makes the no-carry law directly testable: a transition returns
// every map-authored React slice as a replacement, never a merge.
import type { EditorState } from './types';
import type { WorldSave } from './worldStore';
import type { TileMaterialBinding } from '../render3d/groundFormula';

export type MapAuthoringSlices = Pick<EditorState,
  | 'activeMapStem'
  | 'activeMapName'
  | 'activeCommandId'
  | 'worldPieces'
  | 'worldFacades'
  | 'objects'
  | 'selectedObjectId'
  | 'selectedPieceId'
  | 'armedStamp'
  | 'worldUndo'
  | 'worldRedo'
  | 'floorIndex'
  | 'mapPaint'
  | 'mapDocumentOpen'
  | 'addChunkOpen'
  | 'contextOpen'
  | 'seq'
>;

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
    worldPieces: save.pieces.slice(),
    worldFacades: save.facades.slice(),
    objects: save.objects.slice(),
    selectedObjectId: save.objects.find((object) => !object.hidden)?.id ?? 'obj-tile',
    selectedPieceId: null,
    armedStamp: null,
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
