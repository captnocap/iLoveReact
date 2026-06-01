// boxxx_demo — <Boxxx> wrapping NORMAL flex JSX.
//
// The point: <Card/> below is written exactly as you'd write any React UI —
// flex Box/Row/Col, gaps, padding, %, flexGrow. No buffer, no shader, no
// special syntax. On the LEFT it's wrapped in <Boxxx>, so the whole subtree is
// laid out by flex as usual but PAINTED as one batched emit straight into the
// instanced-rect pipeline (host walks the computed boxes — see engine.paintRectBatch).
// On the RIGHT it's the same <Card/> painted the normal scatter way. They
// should be pixel-identical.
//
// LIMITATION (v1): Box children only. Text/Image inside <Boxxx> don't render
// yet — that's the next layer (glyph-atlas emit). So this card is box-only
// (placeholder bars stand in for text) to keep both sides comparable.

import { Box, Text, Boxxx } from '@reactjit/primitives';

const W = 280;
const H = 340;

// A perfectly ordinary flex card. Nothing here knows about batching.
function Card() {
  return (
    <Box style={{ width: W, height: H, backgroundColor: '#161922', borderRadius: 16, padding: 16, flexDirection: 'column', gap: 12 }}>
      {/* header row */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Box style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#5a8bd6' }} />
        <Box style={{ flexDirection: 'column', gap: 6, flexGrow: 1 }}>
          <Box style={{ width: '70%', height: 10, borderRadius: 5, backgroundColor: '#cdd5e6' }} />
          <Box style={{ width: '45%', height: 7, borderRadius: 4, backgroundColor: '#69718a' }} />
        </Box>
        <Box style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#6aa37f' }} />
      </Box>
      {/* bordered body */}
      <Box style={{ backgroundColor: '#1d2130', borderRadius: 12, borderWidth: 1, borderColor: '#333a4d', padding: 12, flexDirection: 'column', gap: 8, flexGrow: 1 }}>
        <Box style={{ width: '80%', height: 9, borderRadius: 4, backgroundColor: '#8c93a6' }} />
        <Box style={{ width: '92%', height: 9, borderRadius: 4, backgroundColor: '#5b6276' }} />
        <Box style={{ width: '60%', height: 9, borderRadius: 4, backgroundColor: '#5b6276' }} />
      </Box>
      {/* button */}
      <Box style={{ height: 40, borderRadius: 10, backgroundColor: '#d26a2a' }} />
    </Box>
  );
}

function Panel({ label, children }: { label: string; children: any }) {
  return (
    <Box style={{ flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <Text style={{ fontSize: 11, color: '#8a92a6', letterSpacing: '0.12em' }}>{label}</Text>
      <Box style={{ width: W, height: H }}>{children}</Box>
    </Box>
  );
}

export default function BoxxxDemo() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0d0f15', padding: 32, flexDirection: 'column', gap: 24 }}>
      <Box style={{ flexDirection: 'column', gap: 4 }}>
        <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#e7eaff' }}>{'<Boxxx> wrapping normal flex JSX'}</Text>
        <Text style={{ fontSize: 12, color: '#8a92a6' }}>
          Same {'<Card/>'} both sides. Left: wrapped in {'<Boxxx>'} → laid out by flex, painted as ONE batched emit. Right: normal scatter paint. Should be identical.
        </Text>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 48 }}>
        <Panel label="BOXXX (batched paint)">
          <Boxxx style={{ width: '100%', height: '100%' }}>
            <Card />
          </Boxxx>
        </Panel>
        <Panel label="NORMAL (scatter paint)">
          <Card />
        </Panel>
      </Box>
    </Box>
  );
}
