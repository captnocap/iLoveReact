// shell/EditorLayout.tsx — the reworked /editor composition (req_1882, from the
// user's sketch). Replaces the even 2×2 QuadSplit, which split space equally even
// though the iso-3D build pane is the ~90% surface.
//
// Shape:
//   ┌────────┬──────────────────────────────┐
//   │  RAIL  │        BIG  MAP  PANE         │   one map fills the stage;
//   │ (props │   (3D iso build ⟷ 2D tiles)   │   the OTHER sits in a corner
//   │  + obj │                      ┌─────┐  │   PiP. Click the PiP to swap
//   │  /skin)│                      │ PiP │  │   which is big ("switcharoo").
//   └────────┴──────────────────────┴─────┴──┘
//
// CRITICAL: both maps stay MOUNTED at stable tree positions — only their wrapper
// STYLE changes (fill vs PiP). Swapping must never remount, or the 3D loader
// reloads its gamefile AND its iso camera resets to the game camera (req_1879).
// So we render map3d and map2d as fixed siblings and toggle big/PiP via style.

import { Box, Pressable, Text } from '@reactjit/primitives';

const RAIL_W = 312;
const PIP_W = 256;
const PIP_H = 168;

const FILL = { position: 'absolute' as const, left: 0, top: 0, right: 0, bottom: 0 };
const PIP = {
  position: 'absolute' as const, right: 14, bottom: 14, width: PIP_W, height: PIP_H,
  borderRadius: 10, borderWidth: 1, borderColor: '#34d399', overflow: 'hidden' as const,
  zIndex: 30, backgroundColor: '#080d16',
};

export function EditorLayout(props: {
  /** which map fills the stage: '3d' = iso build (default 90% surface), '2d' = tiles. */
  focus: '3d' | '2d';
  onSwapFocus: () => void;
  /** the left rail: selected-piece inspector + the objects/paint rail. */
  rail: React.ReactNode;
  /** override the rail width (PANELWIN-0628: narrow it when the panel is
   *  popped out to its own window, giving the build map more room). */
  railWidth?: number;
  /** the iso-3D build pane (LoaderIsoView / IsoAuthor + its corner toggles). */
  map3d: React.ReactNode;
  /** the 2D tile-paint canvas. */
  map2d: React.ReactNode;
}) {
  const big3d = props.focus === '3d';
  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'row', backgroundColor: '#080d16' }}>
      <Box style={{ width: props.railWidth ?? RAIL_W, height: '100%', flexDirection: 'column', borderRightWidth: 1, borderRightColor: '#1c2940', minWidth: 0 }}>
        {props.rail}
      </Box>
      <Box style={{ flexGrow: 1, height: '100%', position: 'relative', minWidth: 0 }}>
        {/* Both maps mounted; the focused one fills, the other is the PiP. Stable
            tree positions → a swap re-styles, never remounts. */}
        <Box style={big3d ? FILL : PIP}>{props.map3d}</Box>
        <Box style={big3d ? PIP : FILL}>{props.map2d}</Box>
        {/* The switcharoo: a click target over the PiP corner (last sibling → wins
            hit-test there; the big pane stays fully interactive everywhere else). */}
        <Pressable onPress={props.onSwapFocus} style={{ position: 'absolute', right: 14, bottom: 14, width: PIP_W, height: PIP_H, borderRadius: 10, zIndex: 40 }}>
          <Box style={{ position: 'absolute', right: 6, top: 6, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#0b1220dd', borderWidth: 1, borderColor: '#34d399' }}>
            <Text fontSize={9} color="#6ee7b7" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
              {big3d ? '⇄ TILE MAP' : '⇄ 3D BUILD'}
            </Text>
          </Box>
        </Pressable>
      </Box>
    </Box>
  );
}
