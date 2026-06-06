// shell/WorkbenchRoute.tsx — the /workbench route surface (WORKBENCH.md §6
// step 3). The build-out room: the frame mounts here ALONGSIDE every existing
// route, sources land one at a time, and nothing pre-existing is touched
// until a source reaches parity and its old route flips off. Sources cross
// into shell as plain values (the LabsRoute rule — shell/ imports nothing
// game-specific; editors/workbench/ builds the list).

import { Box } from '@reactjit/primitives';
import { Workbench, type WorkbenchSource } from './Workbench';
import { accentFor } from './workbench.cls';

export function WorkbenchRoute(props: { sources: Array<WorkbenchSource<any>>; onExit: () => void }) {
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', flexDirection: 'column', backgroundColor: accentFor('bg') }}>
      <Workbench sources={props.sources} onExit={props.onExit} />
    </Box>
  );
}
