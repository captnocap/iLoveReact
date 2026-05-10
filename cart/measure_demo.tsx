// measure_demo — exercise useMeasure across many boxes at once.
//
// Each tile picks a random size on every commit and renders its
// laid-out rect as text inside itself. The hook subscribes to the
// onLayout event the framework's layout pass fires.

import React, { useState, useCallback } from 'react';
import { Box, Row, Pressable, Text } from '@reactjit/runtime/primitives';
import { useMeasure } from '@reactjit/runtime/hooks';

const TILE_COUNT = 28;

const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
];

interface TileSpec {
  w: number;
  h: number;
  color: string;
}

function rollSpecs(seed: number): TileSpec[] {
  // Deterministic per-seed, just to keep it visually stable while debugging.
  let s = seed * 2654435761;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const out: TileSpec[] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    out.push({
      w: 70 + Math.floor(rand() * 130),  // 70..199
      h: 50 + Math.floor(rand() * 90),   // 50..139
      color: PALETTE[Math.floor(rand() * PALETTE.length)],
    });
  }
  return out;
}

function Tile({ spec, index }: { spec: TileSpec; index: number }) {
  const { rect, version, onLayout } = useMeasure();
  return (
    <Box
      onLayout={onLayout}
      style={{
        width: spec.w,
        height: spec.h,
        backgroundColor: spec.color,
        borderRadius: 6,
        padding: 6,
        justifyContent: 'space-between',
      }}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text fontSize={10} color="#0f172a" style={{ fontWeight: 'bold' as any }}>
          {`#${index}`}
        </Text>
        <Text fontSize={9} color="#0f172a">
          {`v${version}`}
        </Text>
      </Row>
      <Box>
        <Text fontSize={11} color="#0f172a" style={{ fontWeight: 'bold' as any }}>
          {rect ? `${rect.width}×${rect.height}` : '—'}
        </Text>
        <Text fontSize={9} color="#0f172a">
          {rect ? `@ ${rect.x.toFixed(0)},${rect.y.toFixed(0)}` : 'measuring…'}
        </Text>
      </Box>
    </Box>
  );
}

export default function MeasureDemo() {
  const [seed, setSeed] = useState(1);
  const specs = rollSpecs(seed);
  const container = useMeasure();

  const randomize = useCallback(() => {
    setSeed((s) => s + 1);
  }, []);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d12', padding: 18, gap: 14 }}>
      <Row style={{ alignItems: 'center', gap: 14 }}>
        <Pressable onPress={randomize}>
          <Box
            style={{
              backgroundColor: '#22c55e',
              paddingTop: 8,
              paddingBottom: 8,
              paddingLeft: 14,
              paddingRight: 14,
              borderRadius: 6,
            }}
          >
            <Text fontSize={13} color="#0b0d12" style={{ fontWeight: 'bold' as any }}>
              Randomize
            </Text>
          </Box>
        </Pressable>
        <Text fontSize={12} color="#94a3b8">
          {`seed=${seed}  ·  ${TILE_COUNT} boxes  ·  container v${container.version}${container.rect ? ` (${container.rect.width.toFixed(0)}×${container.rect.height.toFixed(0)})` : ''}`}
        </Text>
      </Row>

      <Box
        onLayout={container.onLayout}
        style={{ flexDirection: 'row', flexWrap: 'wrap' as any, gap: 10, alignItems: 'flex-start' }}
      >
        {specs.map((spec, i) => (
          <Tile key={i} spec={spec} index={i} />
        ))}
      </Box>
    </Box>
  );
}
