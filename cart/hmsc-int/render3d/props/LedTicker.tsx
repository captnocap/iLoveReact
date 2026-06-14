// LedTicker — the editor (/test) renderer for the scrolling LED ticker prop
// (req_0893, ask #3). The dark HOUSING bakes/renders through the normal prop
// path (DataProp → ledTickerHousingParts); the lit LEDs are the ANIMATED layer
// drawn here as ONE Scene3D.Instances bucket whose data we rebuild each frame as
// the scroll offset advances. The compiled twin is world_loader.zig (the same
// recipe — ledTicker.tickerColumns / ledLitDots — reimplemented in Zig).
//
// No requestAnimationFrame in the cart host ([[reactjit_no_raf]]) — the scroll
// clock is a setTimeout loop; performance.now() drives the offset so the speed is
// wall-clock, not frame-rate, bound.

import { memo, useEffect, useRef, useState } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WorldProp } from '../../design';
import { hx } from '../../game/kinds/propModels';
import { DataProp } from './DataProp';
import { at } from './place';
import {
  tickerColumns,
  ledLitDots,
  LED_DOT_SIZE_METERS,
  LED_ON_COLOR,
  LED_SCROLL_COLS_PER_SEC,
} from '../../compile/propRecipes/ledTicker';

const UNIT_BOX_PARAMS = { width: 1, height: 1, depth: 1 };
const ON_RGB = hx(LED_ON_COLOR);

export const LedTicker = memo(function LedTicker(props: { prop: WorldProp }) {
  const { prop } = props;
  const columns = tickerColumns(prop.text);
  // Scroll offset in columns; advanced off a wall-clock loop so speed is steady.
  const [offset, setOffset] = useState(0);
  const startRef = useRef<number>(performance.now());
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const elapsed = (performance.now() - startRef.current) / 1000;
      setOffset(elapsed * LED_SCROLL_COLS_PER_SEC);
      setTimeout(tick, 16);
    };
    const id = setTimeout(tick, 16);
    return () => { alive = false; clearTimeout(id); };
  }, []);

  // Lit dots → one Scene3D.Instances bucket. Stride 12: pos(3) rotDeg(3) scale(3) rgb(3).
  const dots = ledLitDots(columns, offset);
  const data: number[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const d of dots) {
    const [wx, wy, wz] = at(prop, [d.localX, d.localY, d.localZ]);
    data.push(wx, wy, wz, 0, prop.yawDegrees, 0, LED_DOT_SIZE_METERS, LED_DOT_SIZE_METERS, LED_DOT_SIZE_METERS, ON_RGB[0], ON_RGB[1], ON_RGB[2]);
    if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
    if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
  }
  const cx = dots.length ? (minX + maxX) / 2 : prop.x;
  const cy = dots.length ? (minY + maxY) / 2 : prop.y;
  const cz = dots.length ? (minZ + maxZ) / 2 : prop.z;
  const radius = dots.length
    ? Math.sqrt((maxX - cx) ** 2 + (maxY - cy) ** 2 + (maxZ - cz) ** 2) + LED_DOT_SIZE_METERS
    : 1;

  return (
    <>
      <DataProp prop={prop} />
      {dots.length > 0 ? (
        <Scene3D.Instances
          geometry={Geometry.Box}
          params={UNIT_BOX_PARAMS}
          data={data}
          count={dots.length}
          stride={12}
          center={[cx, cy, cz]}
          boundsRadius={radius}
        />
      ) : null}
    </>
  );
});
