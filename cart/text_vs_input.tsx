// text_vs_input — Text and TextInput, side by side, made to behave the same.
//
// Two things this cart pins down:
//
//   1. FONT PARITY. A <Text> and a <TextInput> with identical fontSize /
//      family / weight must paint at the same size. (They didn't — an input
//      silently rendered at 16px regardless; fixed in inheritTypography.)
//
//   2. THE INPUT IS A FIXED VIEWPORT. A single-line input has a fixed box;
//      its typed text scrolls horizontally inside that box. A long string
//      must NOT grow the input, must NOT shove its siblings, and must NOT
//      bleed its glyphs outside the box. The caret trails the text as you
//      type past the right edge.
//
// Type in any input — every input shares one string, and the Text mirrors
// of it update too, so you can compare the same content in both.

import React, { useState } from 'react';
import { Box, Row, Col, Text, TextInput, Pressable } from '@reactjit/runtime/primitives';

const SIZES = [12, 16, 22, 32, 48];

const BG = '#0b0d12';
const PANEL = '#11141b';
const INK = '#e6e9ef';
const MUTE = '#7c869b';
const RULE = '#2a2f3a';
const ACCENT = '#22c55e';
const MARK = '#f59e0b';

const SHORT = 'The quick brown fox — Hjpgy 0123';
const LONG = 'The quick brown fox jumps over the lazy dog, then keeps on running far past the right edge 0123456789';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize={13} color={ACCENT} style={{ fontWeight: 'bold' as any, letterSpacing: 0.5 } as any}>
      {children}
    </Text>
  );
}

// ── Section 1: font parity across sizes ──────────────────────────────────
function ParityRow({ size, value, onChange }: { size: number; value: string; onChange: (v: string) => void }) {
  // Fixed box height = line-height-ish for this size, so the single line fits
  // without clipping and both columns are the same height.
  const boxH = Math.round(size * 1.5) + 10;
  const font = { fontSize: size, fontWeight: 400 as any, color: INK };

  return (
    <Col style={{ gap: 4 }}>
      <Text fontSize={10} color={MUTE}>{`fontSize ${size}`}</Text>
      <Row style={{ gap: 14, alignItems: 'flex-start' }}>
        <Box style={{ width: 520, height: boxH, backgroundColor: PANEL, borderWidth: 1, borderColor: RULE, borderRadius: 4, justifyContent: 'center', overflow: 'hidden' as any }}>
          <Text style={font as any} numberOfLines={1}>{value}</Text>
        </Box>
        <Box style={{ width: 520, height: boxH, backgroundColor: PANEL, borderWidth: 1, borderColor: RULE, borderRadius: 4, justifyContent: 'center' }}>
          <TextInput value={value} onChange={onChange} style={{ ...font, width: '100%' } as any} />
        </Box>
      </Row>
    </Col>
  );
}

export default function TextVsInput() {
  const [content, setContent] = useState(SHORT);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: BG, padding: 22, gap: 16, overflow: 'scroll' as any }}>
      <Col style={{ gap: 3 }}>
        <Text fontSize={19} color={INK} style={{ fontWeight: 'bold' as any }}>Text vs TextInput</Text>
        <Text fontSize={11} color={MUTE}>
          Left column is &lt;Text&gt;, right is &lt;TextInput&gt; — identical font. Type in any input; all share one string.
        </Text>
      </Col>

      <Row style={{ gap: 10, alignItems: 'center' }}>
        <Preset label="Short" onPress={() => setContent(SHORT)} />
        <Preset label="Long (overflows)" onPress={() => setContent(LONG)} />
        <Preset label="Clear" onPress={() => setContent('')} />
      </Row>

      <SectionTitle>1 · Same font size, side by side</SectionTitle>
      <Col style={{ gap: 12 }}>
        {SIZES.map((s) => (
          <ParityRow key={s} size={s} value={content} onChange={setContent} />
        ))}
      </Col>

      <SectionTitle>2 · A fixed input is a fixed viewport — siblings don't move, text doesn't bleed</SectionTitle>
      <Text fontSize={11} color={MUTE}>
        The input below is locked to 320×34. Load the long preset (or type past the edge): the amber marker stays
        put, the glyphs stay inside the box, and the caret trails the text.
      </Text>
      <Row style={{ gap: 12, alignItems: 'center' }}>
        <Box style={{ width: 320, height: 34, backgroundColor: PANEL, borderWidth: 1, borderColor: RULE, borderRadius: 6, paddingLeft: 10, paddingRight: 10, justifyContent: 'center' }}>
          <TextInput value={content} onChange={setContent} fontSize={15} style={{ color: INK } as any} placeholder="type a long line…" />
        </Box>
        <Box style={{ width: 150, height: 34, backgroundColor: MARK, borderRadius: 6, justifyContent: 'center', alignItems: 'center' }}>
          <Text fontSize={12} color="#0b0d12" style={{ fontWeight: 'bold' as any }}>← I stay put</Text>
        </Box>
        <Text fontSize={12} color={MUTE}>{`(${content.length} chars)`}</Text>
      </Row>
    </Box>
  );
}

function Preset({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{ backgroundColor: RULE, paddingTop: 6, paddingBottom: 6, paddingLeft: 12, paddingRight: 12, borderRadius: 5 }}>
        <Text fontSize={12} color={INK}>{label}</Text>
      </Box>
    </Pressable>
  );
}
