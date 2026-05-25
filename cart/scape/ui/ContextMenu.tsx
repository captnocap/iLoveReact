import { Box, Pressable, Text } from '@reactjit/runtime/primitives';
import type { ActionOption } from '../design';
import { UI } from '../render/palette';

// The right-click action menu. Renders the contextual ActionOption list from
// systems/actions.ts at the click point, greys blocked rows (with their reason),
// and reports the picked interaction key back up. A full-viewport backdrop
// dismisses it on any outside click. High zIndex so it escapes the scene's
// overflow:hidden (see runtime/hooks/useContextMenu.tsx for the mechanics).

export interface ActionMenuState {
  x: number; // scene-relative coords (the menu is a sibling inside the scene)
  y: number;
  title: string;
  options: ActionOption[];
}

export function ActionMenu({
  menu,
  onPick,
  onClose,
}: {
  menu: ActionMenuState | null;
  onPick: (interactionKey: string) => void;
  onClose: () => void;
}) {
  if (!menu) return null;
  return (
    <>
      <Pressable
        key="amenu-backdrop"
        onPress={onClose}
        style={{ position: 'absolute', zIndex: 998, left: 0, top: 0, width: 100000, height: 100000 }}
      />
      <Box
        key="amenu"
        style={{
          position: 'absolute',
          zIndex: 999,
          left: menu.x,
          top: menu.y,
          minWidth: 150,
          backgroundColor: UI.panelBg,
          borderWidth: 1,
          borderColor: UI.border,
          paddingTop: 4,
          paddingBottom: 4,
        }}
      >
        <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 2, paddingBottom: 5 }}>
          <Text style={{ color: UI.border, fontSize: 11, fontWeight: '700' }}>{menu.title}</Text>
        </Box>
        {menu.options.map((o, i) =>
          o.blocked ? (
            <Box key={`o-${i}`} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4 }}>
              <Text style={{ color: UI.textFaint, fontSize: 12 }}>{o.label}</Text>
              {o.reason ? <Text style={{ color: UI.textFaint, fontSize: 9 }}>{o.reason}</Text> : null}
            </Box>
          ) : (
            <Pressable
              key={`o-${i}`}
              onPress={() => onPick(o.interactionKey)}
              style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5 }}
            >
              <Text style={{ color: UI.text, fontSize: 12 }}>{o.label}</Text>
            </Pressable>
          ),
        )}
      </Box>
    </>
  );
}
