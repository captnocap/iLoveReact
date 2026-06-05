// editors/characters/ — the CHARACTERS editor route (V2/V17-TRIAGE).
//
// The head_lab authoring UI REMADE as a tool route inside the one app:
// authors what game/figure runs. cart/head_lab is the behavior reference
// only (read, never imported); the kit it edited is game/figure/, and this
// route is the ruled editors-may-reach-into-figure-internals exception.
//
// Deletion contract: editors/characters/CAPTURE.md — when every inventory
// capability is DONE there, the user deletes cart/head_lab.

import { Col, Text } from '@reactjit/runtime/primitives';
import { GAME_CHROME } from '../../game/chrome';

export function CharactersRoute(props: { onExit: () => void }) {
  const T = GAME_CHROME.tokens.color;
  // Route surfaces OVERLAY the shell body (the editor stays mounted
  // underneath): absolute full-area + opaque bg, exactly like LabsRoute —
  // a normal-flow root stacks BELOW the editor panes instead of covering them.
  return (
    <Col style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', backgroundColor: T.page, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Text fontSize={15} color={T.ink} style={{ fontWeight: 900 }}>CHARACTERS</Text>
      <Text fontSize={11} color={T.dim}>the character editor is being rebuilt here (head_lab → editors/characters)</Text>
      <GAME_CHROME.Chip label="back to editor" onPress={props.onExit} />
    </Col>
  );
}
