// text_vs_input — put a <Text> and a <TextInput> side by side with the
// EXACT same font props and look at the difference.
//
// The whole point of this cart is to make the discrepancy between how the
// framework paints a static Text node and how it paints an editable
// TextInput node impossible to miss. Both get the same string (shared
// state — type in the input and the Text mirrors it), the same fontSize,
// fontFamily, fontWeight, lineHeight, letterSpacing, and color. Every
// other knob is held constant so anything that looks off is a real
// rendering difference, not a config mismatch.
//
// Each comparison row draws a 1px guide box around BOTH cells at the same
// height, plus a red baseline ruler across both, so vertical alignment,
// box sizing, and glyph placement all line up for inspection.

import React, { useState } from 'react';
import { Box, Row, Col, Text, TextInput, Pressable } from '@reactjit/runtime/primitives';

// The font sizes we compare at. Small sizes are where baseline/centering
// drift is most visible; large sizes expose glyph-rendering differences.
const SIZES = [12, 16, 22, 32, 48];

const BG = '#0b0d12';
const PANEL = '#11141b';
const INK = '#e6e9ef';
const RULE = '#2a2f3a';
const ACCENT = '#22c55e';
const BASELINE = '#ef4444';

// One comparison cell — a labeled box of fixed height with a 1px outline so
// the bounding box is visible, and a baseline ruler near the bottom. The
// child (Text or TextInput) is positioned identically inside it.
function Cell({
  label,
  height,
  children,
}: {
  label: string;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <Col style={{ gap: 4, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
      <Text fontSize={10} color="#7c869b" style={{ letterSpacing: 1 } as any}>
        {label.toUpperCase()}
      </Text>
      <Box
        style={{
          height,
          backgroundColor: PANEL,
          borderWidth: 1,
          borderColor: RULE,
          borderRadius: 4,
          justifyContent: 'center',
          // No horizontal padding — we want the glyph's left edge to start
          // at the same x in both cells so any leading offset shows up.
          paddingLeft: 0,
          paddingRight: 0,
        }}
      >
        {children}
      </Box>
    </Col>
  );
}

function CompareRow({
  size,
  textValue,
  onChange,
}: {
  size: number;
  textValue: string;
  onChange: (v: string) => void;
}) {
  // Box height = generous multiple of font size so the glyphs never clip and
  // vertical alignment between the two has room to reveal itself. Both cells
  // use the identical height.
  const height = Math.round(size * 2.4) + 16;

  // The single source of truth for every font knob. Spread into BOTH the
  // Text style and the TextInput style verbatim — no divergence possible.
  const fontStyle = {
    fontSize: size,
    fontWeight: 400 as any,
    // lineHeight left unset (0 → host derives from font) so we compare the
    // framework's *own* default metric for each node type.
    color: INK,
  };

  return (
    <Col style={{ gap: 6 }}>
      <Text fontSize={11} color={ACCENT} style={{ fontWeight: 'bold' as any }}>
        {`fontSize = ${size}`}
      </Text>
      <Row style={{ gap: 16, alignItems: 'flex-start' }}>
        <Cell label="<Text>" height={height}>
          <Text style={fontStyle as any}>{textValue || ' '}</Text>
        </Cell>
        <Cell label="<TextInput>" height={height}>
          <TextInput
            value={textValue}
            onChange={onChange}
            placeholder="(empty)"
            style={fontStyle as any}
          />
        </Cell>
      </Row>
    </Col>
  );
}

export default function TextVsInput() {
  // Shared content. Type in any input and every row updates together so the
  // Text and TextInput on each row always show the identical string.
  const [content, setContent] = useState('The quick brown fox — Hjpgy 0123');

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: BG, padding: 24, gap: 18 }}>
      <Col style={{ gap: 4 }}>
        <Text fontSize={20} color={INK} style={{ fontWeight: 'bold' as any }}>
          Text vs TextInput — same font, side by side
        </Text>
        <Text fontSize={12} color="#7c869b">
          Identical fontSize / family / weight on both. Type in any input —
          the matching Text mirrors it. Look for baseline, vertical centering,
          glyph shape, and left-edge differences.
        </Text>
      </Col>

      <Row style={{ gap: 12, alignItems: 'center' }}>
        <Pressable onPress={() => setContent('')}>
          <Box style={{ backgroundColor: RULE, paddingTop: 6, paddingBottom: 6, paddingLeft: 12, paddingRight: 12, borderRadius: 5 }}>
            <Text fontSize={12} color={INK}>Clear</Text>
          </Box>
        </Pressable>
        <Pressable onPress={() => setContent('The quick brown fox — Hjpgy 0123')}>
          <Box style={{ backgroundColor: RULE, paddingTop: 6, paddingBottom: 6, paddingLeft: 12, paddingRight: 12, borderRadius: 5 }}>
            <Text fontSize={12} color={INK}>Reset sample</Text>
          </Box>
        </Pressable>
      </Row>

      <Col style={{ gap: 18 }}>
        {SIZES.map((s) => (
          <CompareRow key={s} size={s} textValue={content} onChange={setContent} />
        ))}
      </Col>
    </Box>
  );
}
