// app_crt_tui — recursive rendering experiment.
//
//   <Filter shader="crt">      ← GPU post-process (curvature, scanlines, mask)
//     <Terminal shell=...>    ← real PTY, vterm-backed cell grid
//       (which exec's `scripts/tui tui/examples/gallery.tsx`)
//         tui host paints     ← React reconciler → character grid
//           <Effect shader>   ← our WGSL→JS sampler, ▀ half-block per cell
//
// Four rendering pipelines stacked. The half-block dithering on the inner
// effects gets visually amplified by the CRT scanlines + RGB phosphor mask,
// which is the whole point.

import * as React from 'react';
import { Box, Col, Row, Text, Filter, Terminal } from '@reactjit/runtime/primitives';
// Tickle the terminal trigger in sdk/dependency-registry.json — the walker
// keys on `runtime/hooks/useTerminal.ts` appearing in esbuild's metafile.
// A bare side-effect import gets tree-shaken; reference an actual export so
// the input survives into the metafile.
import { useTerminal } from '@reactjit/runtime/hooks/useTerminal';

// Resolve the launcher relative to the source location. The TUI cart looks
// up `scripts/tui` from the repo root, so the wrapper cd's there before
// exec'ing the gallery.
//
// `__dirname` isn't reliable in our bundle context; carry the absolute path
// here so the cart works no matter where the GPU host's cwd is set.
const LAUNCHER = '/home/siah/creative/reactjit/cart/app_crt_tui/run-tui.sh';

export default function AppCRT_TUI() {
  // Calling useTerminal here serves two purposes:
  //   1. esbuild can't tree-shake the import — it's an actual call site —
  //      so `runtime/hooks/useTerminal.ts` lands in the metafile and the
  //      sdk-dependency-resolver flips -Dhas-terminal=true and links libvterm.
  //   2. The hook itself is a no-op without options; we just need its
  //      presence in the bundle.
  useTerminal({});
  return (
    <Filter shader="crt" intensity={1} style={{ width: '100%', height: '100%' }}>
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#000000', flexDirection: 'column' }}>
        <Row style={{ paddingLeft: 1, paddingRight: 1, backgroundColor: '#0b1020', gap: 1 }}>
          <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>CRT • vterm • tui • &lt;Effect&gt;</Text>
          <Text style={{ color: '#94a3b8' }}>click the surface to focus · Ctrl+] to release · sidebar→FX, then ←/→</Text>
        </Row>
        <Box style={{ flexGrow: 1, padding: 4, backgroundColor: '#000000' }}>
          <Terminal shell={LAUNCHER} style={{ width: '100%', height: '100%' }} />
        </Box>
      </Box>
    </Filter>
  );
}
