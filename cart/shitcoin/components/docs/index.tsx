// docs primitives — lifted from DevPage so settings, about, in-game tutorial,
// and any future reference page can compose from the same vocabulary.
//
// These are theme-token aware (read `theme:textDim` etc.) so they re-skin
// per OS variant without per-page work. Nothing here owns state — every
// component is a pure structural shell.

import { Box, Text } from '@reactjit/runtime/primitives';

const ACCENT = 'theme:primary' as any;
const HEADER = 'theme:accent' as any;
const TEXT = 'theme:text' as any;
const DIM = 'theme:textDim' as any;
const MUTED = 'theme:textDim' as any;
const SUBTLE = 'theme:textSecondary' as any;
const RULE = 'theme:border' as any;
const CODE_BG = 'rgba(255,255,255,0.04)';
const SECTION_BG = 'rgba(255,255,255,0.02)';

export function H1({ children }: { children: any }) {
  return <Text style={{ fontSize: 26, color: HEADER, fontWeight: 'bold' }}>{children}</Text>;
}
export function H2({ children }: { children: any }) {
  return <Text style={{ fontSize: 16, color: ACCENT, fontWeight: 'bold', marginTop: 14 }}>{children}</Text>;
}
export function H3({ children }: { children: any }) {
  return <Text style={{ fontSize: 13, color: SUBTLE, fontWeight: 'bold', marginTop: 6 }}>{children}</Text>;
}
export function P({ children }: { children: any }) {
  return <Text style={{ fontSize: 12, color: TEXT, lineHeight: 17 }}>{children}</Text>;
}
export function Muted({ children }: { children: any }) {
  return <Text style={{ fontSize: 11, color: DIM }}>{children}</Text>;
}
export function Code({ children }: { children: any }) {
  return (
    <Box style={{ backgroundColor: CODE_BG, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 4, borderLeftWidth: 3, borderColor: ACCENT }}>
      <Text style={{ fontSize: 11, color: SUBTLE, fontFamily: 'monospace', lineHeight: 16 }}>{children}</Text>
    </Box>
  );
}
export function Bullet({ children }: { children: any }) {
  return (
    <Box style={{ flexDirection: 'row', gap: 6, paddingLeft: 4 }}>
      <Text style={{ fontSize: 12, color: MUTED }}>•</Text>
      <Text style={{ fontSize: 12, color: TEXT, flexGrow: 1, lineHeight: 16 }}>{children}</Text>
    </Box>
  );
}
export function Section({ title, children }: { title: string; children: any }) {
  return (
    <Box style={{ flexDirection: 'column', gap: 6, padding: 14, borderRadius: 8, backgroundColor: SECTION_BG, borderWidth: 1, borderColor: RULE }}>
      <H2>{title}</H2>
      {children}
    </Box>
  );
}
