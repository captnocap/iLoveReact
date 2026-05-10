// cart/install — the post-install reactjit binary.
//
// `npx reactjit` builds this cart and drops the resulting binary at
// ~/.reactjit/bin/reactjit. Running `reactjit` after install opens this
// window. Keep it simple — a welcome panel with the commands that
// matter, and a place to hang future dispatcher screens.

import * as React from 'react';
import { Box, Row, Col, Text, Pressable } from '../runtime/primitives';

const palette = {
  page:   '#0b1020',
  panel:  '#111827',
  border: '#334155',
  accent: '#fbbf24',
  ink:    '#e5e7eb',
  dim:    '#94a3b8',
  good:   '#34d399',
  brand:  '#60a5fa',
};

const COMMANDS: Array<{ cmd: string; blurb: string }> = [
  { cmd: 'reactjit init <name>', blurb: 'scaffold a new cart in ./<name>/' },
  { cmd: 'reactjit ship <cart>', blurb: 'bundle + build → zig-out/bin/<cart>' },
  { cmd: 'reactjit dev <cart>',  blurb: 'hot-reload dev host (TSX edits land in ~300ms)' },
  { cmd: 'reactjit --help',      blurb: 'full command reference' },
];

export default function Install() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: palette.page, padding: 24, flexDirection: 'column', gap: 16 }}>
      <Row style={{ gap: 16, alignItems: 'center' }}>
        <Box style={{ backgroundColor: '#1d4ed8', padding: 12, borderWidth: 2, borderColor: palette.brand }}>
          <Text style={{ color: '#ffffff', fontWeight: 'bold', fontSize: 22 }}>▲ reactjit</Text>
        </Box>
        <Col style={{ gap: 4 }}>
          <Text style={{ color: palette.good, fontWeight: 'bold' }}>installed.</Text>
          <Text style={{ color: palette.dim }}>React reconciler · Zig host · wgpu · V8</Text>
        </Col>
      </Row>

      <Col style={{ gap: 8, borderWidth: 1, borderColor: palette.border, padding: 16, flexGrow: 1 }}>
        <Text style={{ color: palette.accent, fontWeight: 'bold' }}>commands</Text>
        {COMMANDS.map(c => (
          <Row key={c.cmd} style={{ gap: 16, alignItems: 'center' }}>
            <Box style={{ backgroundColor: palette.panel, padding: 8, borderWidth: 1, borderColor: palette.border, width: 280 }}>
              <Text style={{ color: palette.ink, fontWeight: 'bold' }}>{c.cmd}</Text>
            </Box>
            <Text style={{ color: palette.dim }}>{c.blurb}</Text>
          </Row>
        ))}
      </Col>

      <Row style={{ gap: 16 }}>
        <Pressable onPress={() => process.exit(0)}>
          <Box style={{ backgroundColor: palette.panel, padding: 12, borderWidth: 1, borderColor: palette.border }}>
            <Text style={{ color: palette.accent }}>close</Text>
          </Box>
        </Pressable>
        <Text style={{ color: '#64748b' }}>~/.reactjit/src · ~/.reactjit/bin/reactjit · added to PATH</Text>
      </Row>
    </Box>
  );
}
