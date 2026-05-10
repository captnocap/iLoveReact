import { useState, useEffect, useRef } from 'react';
import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { useAnimationsDisabled } from '../../lib/useSpring';

const PALETTE = {
  bg:      'theme:paper',
  ink:     'theme:bg2',
  ink2:    'theme:inkGhost',
  rule:    'theme:inkDim',
  card:    'theme:paperAlt',
  accent:  'theme:accent',
  accent2: 'theme:blue',
  accent3: 'theme:ok',
  cellOff: 'theme:ink',
  inkDim1: 'theme:paperRule',
  inkDim2: 'theme:paperRule',
  inkDim3: 'theme:paperAlt',
  ruleSoft:'theme:inkDim',
};

const SIZE = 108;
const GAP = 4;
const CELL = Math.floor((SIZE - GAP * 2) / 3); // 33

const TIMING_MS = {
  tiny: 220,
  snake: 260,
  mines: 340,
  ttt: 380,
  tetris: 340,
  pulse: 1200,
  orbit: 450,
  binary: 140,
  life: 720,
  sort: 180,
  slide: 360,
  rotate: 250,
  shuffle: 360,
} as const;

type CellSpec = {
  active: boolean;
  accent: boolean;
  bg?: string;
  border?: string;
  label?: string;
  fg?: string;
  round?: boolean;
};

function useTick(ms: number): number {
  const animationsDisabled = useAnimationsDisabled();
  const [t, setT] = useState(0);
  useEffect(() => {
    if (animationsDisabled) return;
    const id = setInterval(() => setT((x: number) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms, animationsDisabled]);
  return t;
}

// Small 3x3 flex grid with fixed total size. Returns rows of cells.
function Grid3(props: {
  size: number;
  gap: number;
  renderCell: (i: number) => any;
  bg?: string;
}) {
  const { size, gap } = props;
  const cell = Math.floor((size - gap * 2) / 3);
  const rows = [0, 1, 2];
  const cols = [0, 1, 2];
  return (
    <Col style={{ width: size, height: size, gap, backgroundColor: props.bg }}>
      {rows.map((r) => (
        <Row key={r} style={{ width: size, height: cell, gap }}>
          {cols.map((c) => (
            <Box key={c} style={{ width: cell, height: cell, position: 'relative' }}>
              {props.renderCell(r * 3 + c)}
            </Box>
          ))}
        </Row>
      ))}
    </Col>
  );
}

function TinyCell(props: { effect: number; active: boolean; accent: boolean; tick: number; host: number }) {
  const t = props.tick;
  let pattern = new Array(9).fill(0);
  const e = props.effect;
  if (e === 0) {
    const row = t % 3;
    for (let c = 0; c < 3; c++) pattern[row * 3 + c] = 1;
  } else if (e === 1) {
    const col = t % 3;
    for (let r = 0; r < 3; r++) pattern[r * 3 + col] = 1;
  } else if (e === 2) {
    const perim = [0, 1, 2, 5, 8, 7, 6, 3];
    pattern[perim[t % 8]] = 1;
    pattern[perim[(t + 4) % 8]] = 1;
  } else if (e === 3) {
    const layers = [[4], [1, 3, 5, 7], [0, 2, 6, 8]];
    layers[t % 3].forEach((i: number) => (pattern[i] = 1));
  } else if (e === 4) {
    const diags = [[0], [1, 3], [2, 4, 6], [5, 7], [8]];
    diags[t % 5].forEach((i: number) => (pattern[i] = 1));
  } else if (e === 5) {
    pattern = t % 2 === 0 ? [1, 0, 1, 0, 1, 0, 1, 0, 1] : [0, 1, 0, 1, 0, 1, 0, 1, 0];
  } else if (e === 6) {
    const path = [0, 1, 2, 5, 4, 3, 6, 7, 8];
    const head = t % path.length;
    for (let k = 0; k < 3; k++) pattern[path[(head - k + path.length) % path.length]] = 1;
  } else if (e === 7) {
    const n = t % 8;
    for (let b = 0; b < 3; b++) pattern[6 + b] = (n & (1 << (2 - b))) ? 1 : 0;
    pattern[4] = 1;
  } else if (e === 8) {
    const corners = [0, 2, 8, 6];
    pattern[corners[t % 4]] = 1;
    pattern[4] = t % 2 === 0 ? 1 : 0;
  }

  const onColor = props.accent ? PALETTE.accent : PALETTE.ink;
  const offColor = props.active ? PALETTE.inkDim2 : PALETTE.inkDim3;
  const activeOn = props.active ? onColor : PALETTE.inkDim1;

  const host = props.host;
  const gap = 1;
  const inner = Math.max(1, Math.floor((host - gap * 2 - 2) / 3));
  return (
    <Col style={{ width: host, height: host, gap, padding: 1 }}>
      {[0, 1, 2].map((r) => (
        <Row key={r} style={{ gap, height: inner }}>
          {[0, 1, 2].map((c) => {
            const v = pattern[r * 3 + c];
            return (
              <Box
                key={c}
                style={{
                  width: inner,
                  height: inner,
                  backgroundColor: v ? activeOn : offColor,
                }}
              />
            );
          })}
        </Row>
      ))}
    </Col>
  );
}

function CellBox(props: { cell: CellSpec; i: number; tick: number; size: number }) {
  const { cell, i, tick, size } = props;
  return (
    <Box
      style={{
        width: size,
        height: size,
        backgroundColor: cell.bg ?? PALETTE.cellOff,
        borderWidth: cell.border ? 1 : 0,
        borderColor: cell.border,
        borderStyle: 'solid',
        borderRadius: cell.round ? 999 : 1,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <TinyCell effect={i} active={cell.active} accent={cell.accent} tick={tick} host={size} />
      {cell.label ? (
        <Col style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: 600, color: cell.fg ?? PALETTE.ink, fontFamily: 'monospace' }}>{cell.label}</Text>
        </Col>
      ) : null}
    </Box>
  );
}

function MiniGrid(props: { cells: CellSpec[]; gap?: number; size?: number; tick: number }) {
  const size = props.size ?? SIZE;
  const gap = props.gap ?? GAP;
  const cell = Math.floor((size - gap * 2) / 3);
  return (
    <Col style={{ width: size, height: size, gap }}>
      {[0, 1, 2].map((r) => (
        <Row key={r} style={{ gap, height: cell }}>
          {[0, 1, 2].map((c) => {
            const i = r * 3 + c;
            return <CellBox key={c} cell={props.cells[i]} i={i} tick={props.tick} size={cell} />;
          })}
        </Row>
      ))}
    </Col>
  );
}

function emptyCells(): CellSpec[] {
  return Array.from({ length: 9 }, () => ({ active: false, accent: false }));
}

// 1. SNAKE
export function SnakeSpinner() {
  const t = useTick(TIMING_MS.snake);
  const tickTiny = useTick(TIMING_MS.tiny);
  const path = [0, 1, 2, 5, 4, 3, 6, 7, 8, 7, 6, 3, 4, 5, 2, 1];
  const len = 4;
  const head = t % path.length;
  const cells = emptyCells();
  for (let k = 0; k < len; k++) {
    const pos = path[(head - k + path.length) % path.length];
    cells[pos] = { active: true, accent: k === 0, bg: k === 0 ? PALETTE.accent : PALETTE.ink };
  }
  return <MiniGrid cells={cells} tick={tickTiny} />;
}

// 2. MINESWEEPER
function MinesSpinner() {
  const t = useTick(TIMING_MS.mines);
  const tickTiny = useTick(TIMING_MS.tiny);
  const cycle = 12;
  const frame = t % cycle;
  const mineIdx = 5;
  const order = [0, 1, 2, 3, 4, 6, 7, 8, 5];
  const neighbors = [0, 2, 1, 3, 0, 2, 1, 3, 0];
  const labels = ['', '1', '2', '1', '', '1', '2', '1', ''];
  const numColors = ['', 'theme:blue', 'theme:ok', PALETTE.accent];
  const cells = emptyCells();
  for (let i = 0; i < 9; i++) {
    cells[i] = { active: false, accent: false, bg: 'theme:transparent', border: 'theme:inkDim' };
  }
  if (frame < 9) {
    for (let i = 0; i <= frame; i++) {
      const idx = order[i];
      cells[idx] = {
        active: true,
        accent: false,
        bg: 'theme:transparent',
        border: 'theme:inkDim',
        label: labels[idx] || undefined,
        fg: numColors[neighbors[idx]] || PALETTE.ink,
      };
    }
  } else if (frame === 9) {
    for (let i = 0; i < 9; i++) {
      const idx = order[i];
      cells[idx] = {
        active: true,
        accent: false,
        bg: 'theme:transparent',
        border: 'theme:inkDim',
        label: labels[idx] || undefined,
        fg: numColors[neighbors[idx]] || PALETTE.ink,
      };
    }
    cells[mineIdx] = { active: true, accent: true, bg: PALETTE.accent, label: '✕', fg: PALETTE.bg };
  }
  return <MiniGrid cells={cells} gap={2} tick={tickTiny} />;
}

// 3. TIC TAC TOE
function TicTacToeSpinner() {
  const t = useTick(TIMING_MS.ttt);
  const tickTiny = useTick(TIMING_MS.tiny);
  const sequence = [
    { idx: 0, mark: 'x' },
    { idx: 4, mark: 'o' },
    { idx: 3, mark: 'x' },
    { idx: 2, mark: 'o' },
    { idx: 6, mark: 'x' },
  ];
  const cycle = sequence.length + 3;
  const frame = t % cycle;
  const steps = Math.min(frame, sequence.length);
  const winning = frame >= sequence.length;
  const cells = emptyCells();
  for (let i = 0; i < 9; i++) {
    cells[i] = { active: false, accent: false, bg: 'theme:transparent', border: PALETTE.rule };
  }
  for (let i = 0; i < steps; i++) {
    const m = sequence[i];
    cells[m.idx] = {
      active: true,
      accent: m.mark === 'o',
      bg: 'theme:transparent',
      border: PALETTE.rule,
      label: m.mark === 'x' ? '╳' : '◯',
      fg: m.mark === 'x' ? PALETTE.ink : PALETTE.accent,
    };
  }
  return (
    <Box style={{ position: 'relative', width: SIZE, height: SIZE }}>
      <MiniGrid cells={cells} gap={2} tick={tickTiny} />
      {winning ? (
        <Box style={{ position: 'absolute', left: SIZE / 2 - 1, top: SIZE * 0.14, width: 2, height: SIZE * 0.72, backgroundColor: PALETTE.accent, borderRadius: 2 }} />
      ) : null}
    </Box>
  );
}

// 4. TETRIS
function TetrisSpinner() {
  const t = useTick(TIMING_MS.tetris);
  const tickTiny = useTick(TIMING_MS.tiny);
  const pieces = [
    { shape: [[1, 1, 0], [0, 1, 0]], color: PALETTE.ink },
    { shape: [[1, 0, 0], [1, 1, 0]], color: PALETTE.accent },
    { shape: [[1, 1, 0], [1, 1, 0]], color: 'theme:inkDimmer' },
  ];
  const framesPerDrop = 4;
  const cycle = pieces.length * framesPerDrop + 2;
  const f = t % cycle;
  const cells = emptyCells();
  const dropIdx = Math.min(Math.floor(f / framesPerDrop), pieces.length - 1);
  const dropFrame = f % framesPerDrop;
  for (let d = 0; d < dropIdx; d++) {
    const row = 2 - d;
    for (let c = 0; c < 3; c++) cells[row * 3 + c] = { active: true, accent: false, bg: pieces[d].color };
  }
  if (f < pieces.length * framesPerDrop) {
    const piece = pieces[dropIdx];
    const topRow = Math.min(dropFrame, 3 - piece.shape.length - (2 - dropIdx));
    const clampedTop = Math.max(0, Math.min(topRow, (2 - dropIdx) - (piece.shape.length - 1)));
    for (let r = 0; r < piece.shape.length; r++) {
      for (let c = 0; c < 3; c++) {
        if (piece.shape[r][c]) {
          const gr = clampedTop + r;
          if (gr >= 0 && gr <= 2) cells[gr * 3 + c] = { active: true, accent: false, bg: piece.color };
        }
      }
    }
  } else {
    for (let i = 0; i < 9; i++) cells[i] = { active: true, accent: false, bg: PALETTE.ink };
  }
  return <MiniGrid cells={cells} gap={3} tick={tickTiny} />;
}

// 5. PULSE
function PulseSpinner() {
  const t = useTick(TIMING_MS.pulse);
  const tickTiny = useTick(TIMING_MS.tiny);
  const ring = t % 3;
  const layers = [[4], [1, 3, 5, 7], [0, 2, 6, 8]];
  const colors = [PALETTE.ink, 'theme:inkDimmer', PALETTE.accent];
  const cells = emptyCells();
  layers[ring].forEach((i) => {
    cells[i] = { active: true, accent: ring === 2, bg: colors[ring] };
  });
  return <MiniGrid cells={cells} gap={6} tick={tickTiny} />;
}

// 6. ORBIT
function OrbitSpinner() {
  const t = useTick(TIMING_MS.orbit);
  const tickTiny = useTick(TIMING_MS.tiny);
  const perim = [0, 1, 2, 5, 8, 7, 6, 3];
  const cells = emptyCells();
  const a = perim[t % 8];
  const b = perim[(t + 4) % 8];
  const trailA = perim[(t - 1 + 8) % 8];
  const trailB = perim[(t + 3) % 8];
  cells[trailA] = { active: true, accent: false, bg: 'theme:inkDim' };
  cells[trailB] = { active: true, accent: false, bg: 'theme:inkDim' };
  cells[a] = { active: true, accent: false, bg: PALETTE.ink };
  cells[b] = { active: true, accent: true, bg: PALETTE.accent };
  if (t % 2 === 0) cells[4] = { active: true, accent: false, bg: 'theme:inkDim' };
  return <MiniGrid cells={cells} gap={5} tick={tickTiny} />;
}

// 7. BINARY
function BinarySpinner() {
  const t = useTick(TIMING_MS.binary);
  const tickTiny = useTick(TIMING_MS.tiny);
  const n = (t * 17) % 512;
  const cells = emptyCells();
  for (let i = 0; i < 9; i++) {
    const on = !!(n & (1 << (8 - i)));
    cells[i] = { active: on, accent: false, bg: on ? PALETTE.ink : PALETTE.cellOff, round: true };
  }
  return <MiniGrid cells={cells} gap={5} tick={tickTiny} />;
}

// 8. LIFE
function LifeSpinner() {
  const t = useTick(TIMING_MS.life);
  const tickTiny = useTick(TIMING_MS.tiny);
  const patterns = [
    [0, 0, 0, 1, 1, 1, 0, 0, 0],
    [0, 1, 0, 0, 1, 0, 0, 1, 0],
    [1, 1, 0, 1, 1, 0, 0, 0, 0],
    [1, 0, 1, 0, 1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0, 1, 0, 1, 0],
  ];
  const prev = patterns[(t - 1 + patterns.length) % patterns.length];
  const curr = patterns[t % patterns.length];
  const cells: CellSpec[] = curr.map((v, i) => {
    if (!v) return { active: false, accent: false };
    const fresh = !prev[i];
    return { active: true, accent: fresh, bg: fresh ? PALETTE.accent : PALETTE.ink };
  });
  return <MiniGrid cells={cells} gap={5} tick={tickTiny} />;
}

// 9. SORT
function SortSpinner() {
  const animationsDisabled = useAnimationsDisabled();
  const [bars, setBars] = useState<number[]>(() => [3, 7, 1, 8, 4, 6, 2, 9, 5]);
  const [active, setActive] = useState<number>(-1);
  const iRef = useRef(0);
  const tickTiny = useTick(220);

  useEffect(() => {
    if (animationsDisabled) return;
    const id = setInterval(() => {
      setBars((prev: number[]) => {
        const next = [...prev];
        const sorted = next.every((v, k, a) => k === 0 || a[k - 1] <= v);
        if (sorted) {
          for (let k = next.length - 1; k > 0; k--) {
            const j = Math.floor(Math.random() * (k + 1));
            const tmp = next[k]; next[k] = next[j]; next[j] = tmp;
          }
          iRef.current = 0;
          setActive(-1);
          return next;
        }
        const idx = iRef.current % (next.length - 1);
        if (next[idx] > next[idx + 1]) {
          const tmp = next[idx]; next[idx] = next[idx + 1]; next[idx + 1] = tmp;
          setActive(idx);
        } else {
          setActive(-1);
        }
        iRef.current += 1;
        return next;
      });
    }, TIMING_MS.sort);
    return () => clearInterval(id);
  }, []);

  const max = 9;
  const barGap = 3;
  const totalGap = barGap * (bars.length - 1);
  const barW = Math.floor((SIZE - totalGap) / bars.length);
  return (
    <Row style={{ width: SIZE, height: SIZE, alignItems: 'flex-end', gap: barGap }}>
      {bars.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * SIZE));
        const isActive = i === active || i === active + 1;
        return (
          <Box key={i} style={{ width: barW, height: h, backgroundColor: isActive ? PALETTE.accent : PALETTE.ink, borderRadius: 1, overflow: 'hidden' }}>
            <TinyCell effect={i % 9} active={true} accent={isActive} tick={tickTiny} host={barW} />
          </Box>
        );
      })}
    </Row>
  );
}

function PositionedTile(props: { tileId: number; pos: number; cell: number; gap: number; tick: number; accent?: boolean }) {
  const r = Math.floor(props.pos / 3);
  const c = props.pos % 3;
  // Use light background so the dark inner pattern has contrast — otherwise
  // the tile looks solid and motion is invisible.
  const tileBg = props.accent ? PALETTE.accent : PALETTE.cellOff;
  return (
    <Box
      style={{
        position: 'absolute',
        width: props.cell,
        height: props.cell,
        left: c * (props.cell + props.gap),
        top: r * (props.cell + props.gap),
        overflow: 'hidden',
        backgroundColor: tileBg,
        borderRadius: 2,
      }}
    >
      <TinyCell effect={props.tileId % 9} active={true} accent={!!props.accent} tick={props.tick} host={props.cell} />
    </Box>
  );
}

// 10. SLIDE
function SlideSpinner() {
  const animationsDisabled = useAnimationsDisabled();
  const [layout, setLayout] = useState<number[]>(() => [0, 1, 2, 3, 4, 5, 6, 7, -1]);
  const emptyRef = useRef(8);
  const lastMoveRef = useRef(-1);
  const tickTiny = useTick(TIMING_MS.tiny);

  useEffect(() => {
    if (animationsDisabled) return;
    const id = setInterval(() => {
      setLayout((prev: number[]) => {
        const safePrev = Array.isArray(prev) ? prev : [0, 1, 2, 3, 4, 5, 6, 7, -1];
        const empty = emptyRef.current;
        const r = Math.floor(empty / 3);
        const c = empty % 3;
        const neighbors: number[] = [];
        if (r > 0) neighbors.push(empty - 3);
        if (r < 2) neighbors.push(empty + 3);
        if (c > 0) neighbors.push(empty - 1);
        if (c < 2) neighbors.push(empty + 1);
        const choices = neighbors.filter((n) => n !== lastMoveRef.current);
        const pool = choices.length ? choices : neighbors;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        const next = [...safePrev];
        next[empty] = safePrev[pick];
        next[pick] = -1;
        lastMoveRef.current = empty;
        emptyRef.current = pick;
        return next;
      });
    }, TIMING_MS.slide);
    return () => clearInterval(id);
  }, []);

  const safeLayout = Array.isArray(layout) ? layout : [0, 1, 2, 3, 4, 5, 6, 7, -1];
  const posOf: Record<number, number> = {};
  safeLayout.forEach((tileId, pos) => { if (tileId >= 0) posOf[tileId] = pos; });

  return (
    <Box style={{ position: 'relative', width: SIZE, height: SIZE }}>
      {Array.from({ length: 8 }, (_, tileId) => (
        <PositionedTile key={tileId} tileId={tileId} pos={posOf[tileId]} cell={CELL} gap={GAP} tick={tickTiny} />
      ))}
    </Box>
  );
}

// 11. ROTATE
function RotateSpinner() {
  const animationsDisabled = useAnimationsDisabled();
  const [positions, setPositions] = useState<number[]>(() => Array.from({ length: 9 }, (_, i) => i));
  const [corner, setCorner] = useState(0);
  const cornerRef = useRef(0);
  const stepRef = useRef(0);
  const tickTiny = useTick(TIMING_MS.tiny);
  const blocks = [[0, 1, 3, 4], [1, 2, 4, 5], [3, 4, 6, 7], [4, 5, 7, 8]];

  useEffect(() => {
    if (animationsDisabled) return;
    const id = setInterval(() => {
      setPositions((prev: number[]) => {
        const next = [...prev];
        const block = blocks[cornerRef.current];
        const a = block[0], b = block[1], c = block[2], d = block[3];
        const posToTile: Record<number, number> = {};
        next.forEach((pos, tileId) => { posToTile[pos] = tileId; });
        const ta = posToTile[a], tb = posToTile[b], tc = posToTile[c], td = posToTile[d];
        next[ta] = b; next[tb] = d; next[td] = c; next[tc] = a;
        stepRef.current += 1;
        if (stepRef.current % 4 === 0) {
          cornerRef.current = (cornerRef.current + 1) % 4;
          setCorner(cornerRef.current);
        }
        return next;
      });
    }, TIMING_MS.rotate);
    return () => clearInterval(id);
  }, []);

  const blockSet = new Set(blocks[corner]);
  return (
    <Box style={{ position: 'relative', width: SIZE, height: SIZE }}>
      {Array.from({ length: 9 }, (_, tileId) => (
        <PositionedTile
          key={tileId}
          tileId={tileId}
          pos={positions[tileId]}
          cell={CELL}
          gap={GAP}
          tick={tickTiny}
          accent={blockSet.has(positions[tileId])}
        />
      ))}
    </Box>
  );
}

// 12. SHUFFLE
function ShuffleSpinner() {
  const animationsDisabled = useAnimationsDisabled();
  const [positions, setPositions] = useState<number[]>(() => Array.from({ length: 9 }, (_, i) => i));
  const [activePair, setActivePair] = useState<[number, number]>([0, 1]);
  const swapsRef = useRef(0);
  const tickTiny = useTick(TIMING_MS.tiny);
  const pairs = [
    [0, 1], [3, 4], [6, 7],
    [1, 2], [4, 5], [7, 8],
    [0, 3], [1, 4], [2, 5],
    [3, 6], [4, 7], [5, 8],
  ];

  useEffect(() => {
    if (animationsDisabled) return;
    const id = setInterval(() => {
      setPositions((prev: number[]) => {
        const next = [...prev];
        const pair = pairs[swapsRef.current % pairs.length];
        const a = pair[0], b = pair[1];
        const posToTile: Record<number, number> = {};
        next.forEach((pos, tileId) => { posToTile[pos] = tileId; });
        const ta = posToTile[a], tb = posToTile[b];
        next[ta] = b; next[tb] = a;
        swapsRef.current += 1;
        setActivePair([a, b]);
        return next;
      });
    }, TIMING_MS.shuffle);
    return () => clearInterval(id);
  }, []);

  const pairSet = new Set(activePair);
  return (
    <Box style={{ position: 'relative', width: SIZE, height: SIZE }}>
      {Array.from({ length: 9 }, (_, tileId) => (
        <PositionedTile
          key={tileId}
          tileId={tileId}
          pos={positions[tileId]}
          cell={CELL}
          gap={GAP}
          tick={tickTiny}
          accent={pairSet.has(positions[tileId])}
        />
      ))}
    </Box>
  );
}

export type SpinnerSpec = { id: string; name: string; caption: string; Comp: () => any };

export const SPINNERS: SpinnerSpec[] = [
  { id: 'slide',   name: 'Slide',       caption: '15-puzzle · tiles fill gap',   Comp: SlideSpinner },
  { id: 'rotate',  name: 'Rotate',      caption: '2×2 block · cycles corner',    Comp: RotateSpinner },
  { id: 'shuffle', name: 'Shuffle',     caption: 'adjacent pair swaps',          Comp: ShuffleSpinner },
  { id: 'snake',   name: 'Snake',       caption: 'Hamiltonian path · len 4',    Comp: SnakeSpinner },
  { id: 'mines',   name: 'Minesweep',   caption: 'reveal · neighbor counts',     Comp: MinesSpinner },
  { id: 'ttt',     name: 'Tic-Tac-Toe', caption: 'scripted game · left column',  Comp: TicTacToeSpinner },
  { id: 'tetris',  name: 'Stacker',     caption: '3 pieces · clear · repeat',    Comp: TetrisSpinner },
  { id: 'pulse',   name: 'Pulse',       caption: 'center → mids → corners',      Comp: PulseSpinner },
  { id: 'orbit',   name: 'Orbit',       caption: 'two bodies · opposite phase',  Comp: OrbitSpinner },
  { id: 'binary',  name: 'Counter',     caption: '9-bit binary · base 2',        Comp: BinarySpinner },
  { id: 'life',    name: 'Life',        caption: 'blinker · block · checker',    Comp: LifeSpinner },
  { id: 'sort',    name: 'Sort',        caption: 'bubble · nine values',         Comp: SortSpinner },
];

const TILE_W = 260;
const TILE_H = 260;

function Tile(props: { spinner: SpinnerSpec; index: number }) {
  const Comp = props.spinner.Comp;
  return (
    <Col
      style={{
        width: TILE_W,
        height: TILE_H,
        backgroundColor: PALETTE.card,
        padding: 24,
        gap: 16,
        borderWidth: 1,
        borderColor: PALETTE.rule,
        borderStyle: 'solid',
      }}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ fontSize: 15, fontWeight: 500, color: PALETTE.ink }}>{props.spinner.name}</Text>
        <Text style={{ fontSize: 10, color: PALETTE.ink2, fontFamily: 'monospace' }}>
          {String(props.index + 1).padStart(2, '0')} / 12
        </Text>
      </Row>
      <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Comp />
      </Col>
      <Text style={{ fontSize: 10.5, color: PALETTE.ink2, fontFamily: 'monospace' }}>
        {props.spinner.caption}
      </Text>
    </Col>
  );
}

export type GridSpinnersProps = {};

export function GridSpinners(_props: GridSpinnersProps) {
  const rows = [0, 1, 2, 3];
  return (
    <Col style={{ backgroundColor: PALETTE.bg, padding: 24, alignItems: 'center', gap: 0 }}>
      {rows.map((r) => (
        <Row key={r} style={{ gap: 0 }}>
          {[0, 1, 2].map((c) => {
            const i = r * 3 + c;
            const s = SPINNERS[i];
            return <Tile key={s.id} spinner={s} index={i} />;
          })}
        </Row>
      ))}
    </Col>
  );
}
