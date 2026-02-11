import React, { useState } from 'react';
import { Box, Text, Pressable } from '../ilovereact/shared/src';

// ── Layout rule reminder ─────────────────────────────────────
// Each rule below maps to a lint guard in `ilovereact lint`.
// The ✦ comments mark where rules are applied in the JSX.

function RuleCard({ title, body }: { title: string; body: string }) {
  return (
    <Box style={{
      backgroundColor: '#1e293b',
      borderRadius: 6,
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      gap: 2,
    }}>
      {/* ✦ Every Text needs fontSize (no-text-without-fontsize) */}
      <Text style={{ color: '#93c5fd', fontSize: 12, fontWeight: '700' }}>
        {title}
      </Text>
      <Text style={{ color: '#94a3b8', fontSize: 11 }}>
        {body}
      </Text>
    </Box>
  );
}

export function App() {
  const [count, setCount] = useState(0);

  return (
    // ✦ Root needs width + height, not flexGrow (no-flexgrow-root)
    <Box style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#0f172a',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
      padding: 32,
    }}>

      {/* ── Hero ────────────────────────────────── */}
      <Box style={{ alignItems: 'center', gap: 8 }}>
        <Text style={{ color: '#e2e8f0', fontSize: 28, fontWeight: '700' }}>
          iLoveReact
        </Text>
        <Text style={{ color: '#64748b', fontSize: 14 }}>
          Edit src/App.tsx and save to reload
        </Text>
      </Box>

      {/* ── Counter (proves HMR works) ──────────── */}
      <Pressable
        onPress={() => setCount(c => c + 1)}
        style={(state) => ({
          backgroundColor: state.pressed ? '#1d4ed8' : state.hovered ? '#3b82f6' : '#2563eb',
          paddingLeft: 24,
          paddingRight: 24,
          paddingTop: 10,
          paddingBottom: 10,
          borderRadius: 8,
        })}
      >
        {/* ✦ Template literal, not mixed children (no-mixed-text-children) */}
        <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>
          {`Clicks: ${count}`}
        </Text>
      </Pressable>

      {/* ── Layout Rules ────────────────────────── */}
      <Box style={{ gap: 6, width: '100%', maxWidth: 520, height: 280 }}>
        {/* ✦ Row + justifyContent needs explicit width (no-row-justify-without-width) */}
        <Box style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
        }}>
          <Text style={{ color: '#475569', fontSize: 11, fontWeight: '700' }}>
            LAYOUT RULES
          </Text>
          <Text style={{ color: '#334155', fontSize: 10 }}>
            enforced by ilovereact lint
          </Text>
        </Box>

        <RuleCard
          title="Root: width + height, not flexGrow"
          body="The root container has no parent to grow into. Use width: '100%', height: '100%'."
        />
        <RuleCard
          title="Every <Text> needs fontSize"
          body="Text without fontSize cannot be measured. The layout engine needs it to compute size."
        />
        <RuleCard
          title="Row + justifyContent needs width"
          body="Box has no intrinsic width. Without it, justifyContent has no space to distribute."
        />
        <RuleCard
          title={'Use template literals: {`text ${value}`}'}
          body="Mixed text + expressions create overlapping nodes. One template literal = one node."
        />
        <RuleCard
          title="No block char in <Text>"
          body="U+2588 renders as a font glyph, not a filled pixel. Use Box + backgroundColor instead."
        />
      </Box>

      {/* ── Footer ──────────────────────────────── */}
      <Text style={{ color: '#334155', fontSize: 12 }}>
        Happy hacking!
      </Text>
    </Box>
  );
}
