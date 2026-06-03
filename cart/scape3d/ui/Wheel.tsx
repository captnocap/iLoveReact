import { Box, Pressable, Text } from '@reactjit/primitives';
import type { InventoryActions } from '../state/world';
import type { InventorySlot } from '../systems/inventory';
import { UI } from '../render/palette';

function SlotButton({ slot, active, onPress }: { slot: InventorySlot; active: boolean; onPress: () => void }) {
  const label = slot.module.inventory?.shortLabel ?? slot.module.type.label;
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 28,
        minWidth: 58,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? UI.border : UI.userBubble,
        borderWidth: 1,
        borderColor: active ? UI.borderCyan : UI.borderDim,
        paddingLeft: 8,
        paddingRight: 8,
      }}
    >
      <Text style={{ color: active ? '#ffffff' : UI.text, fontSize: 10, fontWeight: active ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Wheel({
  slots,
  inHand,
  actions,
}: {
  slots: InventorySlot[];
  inHand: InventorySlot | null;
  actions: InventoryActions;
}) {
  return (
    <Box style={{ position: 'absolute', left: 318, bottom: 18, width: 448, backgroundColor: UI.panelBg, borderWidth: 2, borderColor: UI.borderDim, padding: 8, gap: 6 }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: UI.border, fontSize: 11, fontWeight: '700' }}>POCKETS</Text>
        <Text style={{ color: UI.textDim, fontSize: 9 }}>{inHand ? `hand: ${inHand.module.type.label}` : 'hand: empty'}</Text>
      </Box>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {slots.length === 0 ? (
          <Text style={{ color: UI.textFaint, fontSize: 10 }}>click something on the ground to grab it</Text>
        ) : (
          slots.map((slot) => (
            <SlotButton
              key={slot.instance.id}
              slot={slot}
              active={inHand?.instance.id === slot.instance.id}
              onPress={() => actions.equip(slot.instance.id)}
            />
          ))
        )}
        <Pressable
          onPress={actions.dropInHand}
          style={{
            height: 28,
            minWidth: 52,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: inHand ? '#3a0a22' : UI.npcBubble,
            borderWidth: 1,
            borderColor: inHand ? UI.accent2 : UI.borderDim,
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          <Text style={{ color: inHand ? UI.accent2 : UI.textFaint, fontSize: 10, fontWeight: '700' }}>drop</Text>
        </Pressable>
      </Box>
    </Box>
  );
}
