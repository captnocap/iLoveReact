// Run — the sequencer surface.
//
// Per docs/03-sequencer-plan-trace.md: a 2D toggle grid where each cell is a
// behavior/rule/pose/loop armed for this run. Steps are not units of time —
// they are heterogeneous things the user wants armed. Pressing play sweeps
// the playhead left-to-right; each column serializes into the plan.
//
// **The sequencer is build-time. The plan is runtime. The prose is the seam.**
//
// This file is a placeholder. The real grid + sweep + plan emission lands
// here. For now: a static toggle grid mock + a Play affordance + an empty
// plan panel showing the read-twice-into-text shape.

import { useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { Play } from '@reactjit/runtime/icons/icons';
import { Icon } from '@reactjit/runtime/icons/Icon';

const ROWS = ['pin', 'plan', 'explore', 'write', 'review', 'commit'];
const COLS = 6;

type Grid = boolean[][];

function emptyGrid(): Grid {
  return ROWS.map(() => Array.from({ length: COLS }, () => false));
}

function Cell({ on, onPress }: { on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{
      width: 36,
      height: 36,
      borderRadius: 6,
      backgroundColor: on ? 'theme:accent' : 'theme:bg2',
      borderColor: on ? 'theme:accent' : 'theme:rule',
      borderWidth: 1,
    }} />
  );
}

function ToggleGrid({ grid, toggle }: { grid: Grid; toggle: (r: number, c: number) => void }) {
  return (
    <Col style={{ gap: 6 }}>
      {ROWS.map((label, r) => (
        <Row key={label} style={{ gap: 6, alignItems: 'center' }}>
          <Box style={{ width: 80 }}>
            <S.Caption>{label}</S.Caption>
          </Box>
          {grid[r].map((on, c) => (
            <Cell key={c} on={on} onPress={() => toggle(r, c)} />
          ))}
        </Row>
      ))}
      <Row style={{ gap: 6, marginTop: 4, paddingLeft: 80 }}>
        {Array.from({ length: COLS }, (_, c) => (
          <Box key={c} style={{ width: 36, alignItems: 'center' }}>
            <S.MicroDim>{`p${c + 1}`}</S.MicroDim>
          </Box>
        ))}
      </Row>
    </Col>
  );
}

function planFromGrid(grid: Grid): string {
  const passes: string[] = [];
  for (let c = 0; c < COLS; c++) {
    const armed: string[] = [];
    for (let r = 0; r < ROWS.length; r++) {
      if (grid[r][c]) armed.push(ROWS[r]);
    }
    if (armed.length) passes.push(`pass ${c + 1}: ${armed.join(' + ')}`);
  }
  return passes.length ? passes.join('\n') : '(empty plan — arm at least one cell)';
}

export default function RunPage() {
  const [grid, setGrid] = useState<Grid>(() => emptyGrid());
  const toggle = (r: number, c: number) => {
    setGrid((g) => g.map((row, ri) => row.map((on, ci) => (ri === r && ci === c ? !on : on))));
  };
  const plan = planFromGrid(grid);

  return (
    <S.Page style={{ flexDirection: 'row', padding: 24, gap: 24 }}>
      <Col style={{ flexGrow: 1, gap: 16 }}>
        <Row style={{ alignItems: 'baseline', gap: 12 }}>
          <S.Title>Sequencer</S.Title>
          <S.Caption>arm cells, sweep to commit</S.Caption>
        </Row>

        <S.Card>
          <ToggleGrid grid={grid} toggle={toggle} />
        </S.Card>

        <Row style={{ gap: 12, alignItems: 'center' }}>
          <S.Button onPress={() => {}} style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}>
            <Icon icon={Play} size={14} color="theme:paper" />
            <Text size={12} color="theme:paper" bold={true}>Sweep</Text>
          </S.Button>
          <S.Caption>animation is the commit ceremony</S.Caption>
        </Row>
      </Col>

      <Col style={{ width: 360, gap: 12 }}>
        <S.Heading>Plan (preview)</S.Heading>
        <S.Surface style={{ flexGrow: 1 }}>
          <S.Body>{plan}</S.Body>
        </S.Surface>
        <S.TinyDim>
          structured form is canonical; the prose is rendered from it.
        </S.TinyDim>
      </Col>
    </S.Page>
  );
}
