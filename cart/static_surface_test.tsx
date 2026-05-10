// static_surface_test — apples-to-apples comparison of 5000 leaf nodes
// rendered as a randomly-nested tree, with vs without a top-level
// <StaticSurface> wrap. Same tree shape in both modes so any delta in
// fps / paint µs / layout µs is attributable to the wrap.
//
// Toggle WRAP on/off and read the dev panel.

import { useMemo, useState } from 'react';
import { Box, Pressable, StaticSurface, Text } from '@reactjit/runtime/primitives';

const TOTAL_LEAVES = 5000;
const SEED = 12345;

// Deterministic PRNG so the tree shape is identical run-to-run, mode-to-mode.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type TreeNode = { id: string; children: TreeNode[] };

function buildTree(rng: () => number, leafCount: number, prefix = '0'): TreeNode {
  if (leafCount <= 1) return { id: prefix, children: [] };
  const fanout = Math.min(leafCount, 2 + Math.floor(rng() * 3)); // 2..4
  const sizes = new Array(fanout).fill(1);
  const remaining = leafCount - fanout;
  if (remaining > 0) {
    const weights: number[] = new Array(fanout);
    let total = 0;
    for (let i = 0; i < fanout; i++) {
      weights[i] = rng() + 0.1;
      total += weights[i];
    }
    let allocated = 0;
    for (let i = 0; i < fanout - 1; i++) {
      const share = Math.floor((weights[i] / total) * remaining);
      sizes[i] += share;
      allocated += share;
    }
    sizes[fanout - 1] += remaining - allocated;
  }
  return {
    id: prefix,
    children: sizes.map((c: number, i: number) => buildTree(rng, c, `${prefix}-${i}`)),
  };
}

function renderNode(node: TreeNode): any {
  if (node.children.length === 0) {
    return (
      <Box
        key={node.id}
        style={{
          width: 14,
          height: 14,
          backgroundColor: '#1a3a5a',
          borderWidth: 1,
          borderColor: '#3a78c8',
        }}
      />
    );
  }
  return (
    <Box
      key={node.id}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 2,
        padding: 2,
        borderWidth: 1,
        borderColor: '#1d2c45',
      }}
    >
      {node.children.map(renderNode)}
    </Box>
  );
}

function Toggle({ label, on, onPress, accent }: { label: string; on: boolean; onPress: () => void; accent: string }) {
  return (
    <Pressable onPress={onPress}>
      <Box
        style={{
          paddingLeft: 14,
          paddingRight: 14,
          paddingTop: 8,
          paddingBottom: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: on ? accent : '#2a2a2e',
          backgroundColor: on ? '#1a1a1d' : '#121215',
        }}
      >
        <Text style={{ fontSize: 12, color: on ? accent : '#bdbdc4' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

export default function StaticSurfaceTest() {
  const [wrapped, setWrapped] = useState(false);
  const tree = useMemo(() => buildTree(mulberry32(SEED), TOTAL_LEAVES), []);
  const content = renderNode(tree);

  return (
    <Box
      style={{
        flexGrow: 1,
        width: '100%',
        height: '100%',
        backgroundColor: '#050b16',
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 16,
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 16, color: '#e8eef8', fontWeight: 'bold' }}>
          StaticSurface · 5000 leaves, randomly nested
        </Text>
        <Box style={{ flexDirection: 'row', gap: 16 }}>
          <Text style={{ fontSize: 11, color: '#92a8c4' }}>{`mode ${wrapped ? 'WRAPPED' : 'plain'}`}</Text>
        </Box>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 8 }}>
        <Toggle label="PLAIN" on={!wrapped} onPress={() => setWrapped(false)} accent="#34d399" />
        <Toggle label="WRAPPED" on={wrapped} onPress={() => setWrapped(true)} accent="#facc15" />
      </Box>

      <Box
        style={{
          flexGrow: 1,
          backgroundColor: '#0a0a0d',
          borderWidth: 1,
          borderColor: '#1d2c45',
          borderRadius: 6,
          padding: 6,
          overflow: 'hidden',
        }}
      >
        {wrapped ? <StaticSurface>{content}</StaticSurface> : content}
      </Box>
    </Box>
  );
}
