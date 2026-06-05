// labs/__LAB_NAME__.tsx — a lab: GAME_* imports + an exported scene. Nothing else.
//
// The ground floor arrives ready to use through '@game' (V17 — the only door;
// labs import game/ ONLY). Notes live in the paired __LAB_NAME__.notes.md —
// they are this lab's contract (P6: what it demonstrates, what broken looks
// like) and are surfaced wherever the lab is referenced. Experiments are
// production quality; disposability is in the IDEA, not the implementation.

import { GAME_CAMERA, GAME_LOOP } from '@game';
import { Box, Text } from '@reactjit/primitives';

export default function ScaffoldLab() {
  const camera = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [0, 0, 0] });
  return (
    <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0f1a' }}>
      <Text style={{ color: '#9fb4d8', fontSize: 14 }}>{`__LAB_NAME__ — scaffold scene (camera fov ${camera.fov}°, state tick ${GAME_LOOP.STATE_TICKS_PER_MINUTE}/min)`}</Text>
    </Box>
  );
}
