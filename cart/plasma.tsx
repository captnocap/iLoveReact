// Plasma — now just the registry effect. The four-wave sine shader lives once
// in @reactjit/effects (runtime/effects/Plasma.tsx), not copy-pasted per cart.

import { Box } from '@reactjit/runtime/primitives';
import { Plasma } from '@reactjit/effects';

export default function PlasmaDemo() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#000000' }}>
      <Plasma style={{ flexGrow: 1 }} />
    </Box>
  );
}
