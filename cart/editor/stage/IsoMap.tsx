import { C } from '../workspace.cls';
import { assetById } from '../data/catalog';
import type { EditorState } from '../data/types';

export default function IsoMap({ state, onObject }: { state: EditorState; onObject: (id: string) => void }) {
  const tiles = Array.from({ length: 42 }, (_, i) => ({
    left: 130 + (i % 7) * 45,
    top: 78 + Math.floor(i / 7) * 28,
    tint: i % 9 === 0 ? '#253f21' : i % 7 === 0 ? '#222a31' : '#121b23',
  }));
  const visibleObjects = state.objects.filter((object) => !object.hidden);
  return (
    <C.HW_MapDeck>
      {tiles.map((tile, index) => <C.HW_Tile key={index} style={{ left: tile.left, top: tile.top, backgroundColor: tile.tint }} />)}
      {visibleObjects.map((object) => {
        const asset = assetById(object.assetId);
        return (
          <C.HW_Block key={object.id} style={{ left: object.left, top: object.top, width: object.width, height: object.height, backgroundColor: asset.color }} />
        );
      })}
      {visibleObjects.map((object) => (
        <C.HW_BlockHit
          key={`${object.id}-hit`}
          onPress={() => onObject(object.id)}
          style={{ left: object.left, top: object.top, width: object.width, height: object.height }}
        />
      ))}
      {visibleObjects.map((object) => object.id === state.selectedObjectId ? (
        <C.HW_SelectionBox key={`${object.id}-selection`} style={{ left: object.left - 4, top: object.top - 4, width: object.width + 8, height: object.height + 8 }} />
      ) : null)}
      {[1, 2, 3].map((n, i) => (
        <C.HW_PointBadge key={n} style={{ left: 278 + i * 50, top: 105 + i * 55 }}>
          <C.HW_PointText>{n}</C.HW_PointText>
        </C.HW_PointBadge>
      ))}
    </C.HW_MapDeck>
  );
}
