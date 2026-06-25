// railThumbGrid — the shared picture-grid machinery the editor rail's PROP and
// BUILD browsers both ride (req_1898/1917/1918). One vocabulary so props and
// build pieces look + page identically, and "get away from this dogshit pilled
// approach" once, not twice.
//
// Two laws, learned the hard way and now enforced in ONE place:
//   • A page is sized to EXACTLY fill the measured grid — never a scroll
//     container (req_1917: "i dont want to have to scroll down just to see one
//     more row"). useFittedGrid measures the area and pages by whole cols × rows.
//   • A thumbnail is auto-FRAMED from the model's own bounds (req_1898: one fixed
//     camera framed a phone booth and a bus the same → everything was a speck).
//     solveThumbOrbit backs an orbit camera off by radius / tan(fov/2).

import { useMemo, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { GAME_CAMERA } from './game';

// Thumbnail framing — a snug 3/4 orbit at a narrow FOV reads a model like a
// product shot. Shared so a prop and a wall are lit + angled the same.
export const THUMB_FOV = 30;
const THUMB_YAW = 35;
const THUMB_PITCH = 24;
const THUMB_MARGIN = 1.18; // pull back ~18% past the exact fit so nothing crops.

/** Frame an orbit camera on a box centred at (cx,cy,cz) with extents (w,h,d).
 *  The whole reason tiles read: the camera fits the model, not the reverse. */
export function solveThumbOrbit(cx: number, cy: number, cz: number, w: number, h: number, d: number) {
  const ew = Math.max(0.3, w);
  const eh = Math.max(0.3, h);
  const ed = Math.max(0.3, d);
  const radius = 0.5 * Math.sqrt(ew * ew + eh * eh + ed * ed);
  const dist = (radius / Math.tan((THUMB_FOV / 2) * (Math.PI / 180))) * THUMB_MARGIN;
  return GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
    target: [cx, cy, cz], yaw: THUMB_YAW, pitch: THUMB_PITCH, dist, zoom: 1, fov: THUMB_FOV,
  });
}

export type GridBounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

/** solveThumbOrbit straight from an AABB. */
export function solveThumbOrbitForBounds(b: GridBounds) {
  return solveThumbOrbit(
    (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2,
    b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ,
  );
}

export type FittedGrid = {
  /** spread onto the grid container <Box> — measures it + clips the stray row. */
  containerStyle: { flexGrow: number; minHeight: number; overflow: 'hidden' };
  /** pass the raw onLayout rect ({x,y,width,height}); the hook reads width/height. */
  onLayout: (rect: any) => void;
  /** the grid row <Box>'s flex props (gap matches the cell math). */
  rowStyle: { flexDirection: 'row'; flexWrap: 'wrap'; gap: number; alignContent: 'flex-start' };
  page: number;
  setPage: (next: number | ((p: number) => number)) => void;
  pageCount: number;
  cur: number;
  /** [start, end) slice of the item list that fills the current page. */
  start: number;
  end: number;
};

/** Measure the grid and page by the whole columns × rows that FIT — so every
 *  page shows in full with no scrolling. `cellH` is the tile height + its label
 *  + gap; floor()'d rows never spill past the pager. */
export function useFittedGrid(opts: { total: number; tileW: number; cellH: number; gap?: number }): FittedGrid {
  const gap = opts.gap ?? 6;
  const [grid, setGrid] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(0);
  const cols = Math.max(1, Math.floor((grid.w + gap) / (opts.tileW + gap)));
  const rows = Math.max(1, Math.floor((grid.h + gap) / (opts.cellH + gap)));
  const perPage = Math.max(1, cols * rows);
  const pageCount = Math.max(1, Math.ceil(opts.total / perPage));
  const cur = Math.min(page, pageCount - 1);
  return {
    containerStyle: { flexGrow: 1, minHeight: 0, overflow: 'hidden' },
    // onLayout rects carry width/height (x/y too) — NOT w/h. Reading w/h gave
    // undefined → NaN perPage → an empty grid + a "NaN / NaN" pager.
    onLayout: (rect: any) => setGrid((g) => {
      const w = Number(rect?.width ?? 0);
      const h = Number(rect?.height ?? 0);
      return g.w === w && g.h === h ? g : { w, h };
    }),
    rowStyle: { flexDirection: 'row', flexWrap: 'wrap', gap, alignContent: 'flex-start' },
    page, setPage, pageCount, cur, start: cur * perPage, end: cur * perPage + perPage,
  };
}

function pagerChip() {
  return { paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4, backgroundColor: '#142031' };
}

/** prev / "n / m" / next — pinned below the grid. Renders nothing for one page. */
export function RailPager(props: { pageCount: number; cur: number; setPage: (n: number | ((p: number) => number)) => void }) {
  if (props.pageCount <= 1) return null;
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 }}>
      <Pressable onPress={() => props.setPage((p) => Math.max(0, p - 1))}>
        <Box style={pagerChip()}><Text fontSize={9} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>‹ prev</Text></Box>
      </Pressable>
      <Text fontSize={9} color="#8aa0b8" style={{ fontFamily: 'monospace' }}>{`${props.cur + 1} / ${props.pageCount}`}</Text>
      <Pressable onPress={() => props.setPage((p) => Math.min(props.pageCount - 1, p + 1))}>
        <Box style={pagerChip()}><Text fontSize={9} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>next ›</Text></Box>
      </Pressable>
    </Box>
  );
}

/** Shared tile chrome — the bordered, rounded thumbnail box + its label. The
 *  caller drops a <Scene3D> (or anything) inside. Keeps prop + piece tiles
 *  pixel-identical. */
export function ThumbTile(props: { label: string; active: boolean; tileW: number; tileH: number; onPick: () => void; children: any }) {
  return (
    <Pressable onPress={props.onPick} hoverable tooltip={props.label}>
      <Box style={{ width: props.tileW, gap: 2, alignItems: 'center' }}>
        <Box style={{ width: props.tileW, height: props.tileH, borderRadius: 5, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#7dd3fc' : '#3a4f6b', backgroundColor: '#0e1622', overflow: 'hidden' }}>
          {props.children}
        </Box>
        <Text fontSize={8} color={props.active ? '#7dd3fc' : '#a8b6c8'} numberOfLines={1} style={{ fontFamily: 'monospace', width: props.tileW, textAlign: 'center' }}>{props.label}</Text>
      </Box>
    </Pressable>
  );
}

/** Cell height for a tileH-tall thumbnail (tile + 2px gap + the ~12px label),
 *  the value useFittedGrid pages by. */
export function thumbCellH(tileH: number) { return tileH + 2 + 12; }
