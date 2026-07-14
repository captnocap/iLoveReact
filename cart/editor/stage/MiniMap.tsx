import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { assetById } from '../data/catalog';
import type { EditorState } from '../data/types';

export default function MiniMap({ state, onObject }: { state: EditorState; onObject: (id: string) => void }) {
  const grid = Array.from({ length: 12 }, (_, i) => i);
  return (
    <C.HW_FloatingCard style={{ right: 16, bottom: 18, width: 280, height: 190 }}>
      <C.HW_ContextHead>
        <Icon name="Map" size={12} color={accentFor('textDim')} />
        <C.HW_KeyText>2D MAP</C.HW_KeyText>
        <C.HW_PillOn style={{ height: 16, paddingLeft: 5, paddingRight: 5 }}>
          <C.HW_PillTextOn>linked</C.HW_PillTextOn>
        </C.HW_PillOn>
        <C.HW_Spacer />
        <Icon name="SlidersHorizontal" size={12} color={accentFor('textFaint')} />
      </C.HW_ContextHead>
      <C.HW_MiniMap>
        {grid.map((i) => <C.HW_MiniLine key={`v-${i}`} style={{ left: i * 24, top: 0, width: 1, height: 166 }} />)}
        {grid.slice(0, 8).map((i) => <C.HW_MiniLine key={`h-${i}`} style={{ left: 0, top: i * 22, width: 278, height: 1 }} />)}
        {state.objects.filter((object) => !object.hidden).map((object) => (
          <C.HW_MiniShape
            key={object.id}
            onPress={() => onObject(object.id)}
            style={{
              left: Math.max(8, Math.floor(object.left / 2.6) - 50),
              top: Math.max(10, Math.floor(object.top / 2.3) - 10),
              width: Math.max(18, Math.floor(object.width / 1.8)),
              height: Math.max(14, Math.floor(object.height / 2.3)),
              backgroundColor: assetById(object.assetId).color,
            }}
          />
        ))}
        <C.HW_SelectionBox style={{ left: 86, top: 78, width: 128, height: 54, borderColor: '#f1bd58', backgroundColor: 'transparent' }} />
        <C.HW_PointBadge style={{ left: 66, top: 56, width: 11, height: 11, borderRadius: 6 }} />
        <C.HW_PointBadge style={{ left: 166, top: 66, width: 11, height: 11, borderRadius: 6 }} />
      </C.HW_MiniMap>
    </C.HW_FloatingCard>
  );
}
