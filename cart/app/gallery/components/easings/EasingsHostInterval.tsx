// EasingsHostInterval — full host-driven version. Zero JS work per
// frame for any animated element.
//
// What's gone vs the Combined atom (StaticSurface + Latches):
//   - No useCycle. No RAF loop. No setState.
//   - No JS-side __latchSet calls per frame.
//
// What's added:
//   - useHostAnimation per tile per axis (dot.x, dot.y, bar.x).
//     Registers with framework/animations.zig at mount; the painter
//     loop walks the registry per frame, evaluates the easing curve
//     in compiled Zig (using framework/easing.zig), writes to the
//     latch buffer. v8_app.zig:syncLatchesToNodes propagates to
//     style.left / style.top.
//
// The difference vs Combined: Combined still runs a JS RAF loop that
// computes the easing values in JS and calls __latchSet ~57 times
// per frame. This atom does ZERO of that — JS is involved only at
// mount (3 __anim_register calls per tile) and unmount.
//
// Predicted result: ~235-280fps (vs 185 for Combined). The extra
// budget comes from killing the per-frame JS RAF wake + math + bridge
// crossings. Paint cost stays at ~4ms (StaticSurface is already
// caching the curves).
//
// Requires v8_app.zig:tickAll (added in framework/animations.zig)
// and __anim_register / __anim_unregister bindings. If you see dots
// stuck at the `from` position, the binary hasn't been rebuilt with
// the animation registry — run `scripts/ship app`.

import { Box, Col, Row, Graph, StaticSurface, Text } from '@reactjit/runtime/primitives';
import { EASINGS, EASING_NAMES, type EasingName } from '@reactjit/runtime/easing';
import { useHostAnimation, type CurveName } from '@reactjit/runtime/hooks/useHostAnimation';

const CYCLE_MS = 1800;
const TILE_W = 160;
const TILE_H = 140;
const PLOT = { x: 10, y: 10, w: TILE_W - 20, h: 70 };

function buildCurvePath(fn: (t: number) => number): string {
  const steps = 48;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = PLOT.x + u * PLOT.w;
    const y = PLOT.y + PLOT.h - fn(u) * PLOT.h;
    d += (i === 0 ? 'M ' : ' L ') + x.toFixed(2) + ' ' + y.toFixed(2);
  }
  return d;
}

function EasingTileHost(props: { name: EasingName }) {
  const fn = EASINGS[props.name];
  const curve = buildCurvePath(fn);
  const frameTL = `M ${PLOT.x} ${PLOT.y + PLOT.h} L ${PLOT.x} ${PLOT.y} L ${PLOT.x + PLOT.w} ${PLOT.y}`;
  const frameBR = `M ${PLOT.x} ${PLOT.y + PLOT.h} L ${PLOT.x + PLOT.w} ${PLOT.y + PLOT.h} L ${PLOT.x + PLOT.w} ${PLOT.y}`;

  // Three host-side animations per tile: dot x, dot y, bar ball x.
  // Cart code never touches per-frame state for these.
  //
  // dotX is linear in time (the X axis IS the time axis on the plot);
  // dotY and barLeft both use the tile's actual easing curve so each
  // tile shows its real shape. framework/easing.zig has all 31 named
  // easings (mirrors EASINGS in runtime/easing.ts), animations.zig
  // dispatches via CurveType.fromString.
  const tileCurve = props.name as CurveName;
  useHostAnimation({
    latch: `easing-host:${props.name}:dotX`,
    curve: 'linear',
    from: PLOT.x - 3,
    to: PLOT.x + PLOT.w - 3,
    durationMs: CYCLE_MS,
    loop: 'cycle',
  });
  useHostAnimation({
    latch: `easing-host:${props.name}:dotY`,
    curve: tileCurve,
    from: PLOT.y + PLOT.h - 3,
    to: PLOT.y - 3,
    durationMs: CYCLE_MS,
    loop: 'cycle',
  });
  useHostAnimation({
    latch: `easing-host:${props.name}:barLeft`,
    curve: tileCurve,
    from: -5,
    to: PLOT.w - 5,
    durationMs: CYCLE_MS,
    loop: 'cycle',
  });

  return (
    <Col
      style={{
        width: TILE_W,
        height: TILE_H,
        padding: 8,
        backgroundColor: 'theme:bg',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'theme:bg1',
        gap: 6,
      }}
    >
      <Box
        style={{
          position: 'relative',
          width: TILE_W - 16,
          height: PLOT.h + 20,
        }}
      >
        <StaticSurface staticKey={`easing-host:${props.name}`}>
          <Graph originTopLeft style={{ width: TILE_W - 16, height: PLOT.h + 20 }}>
            <Graph.Path d={frameBR} stroke="theme:bg2" strokeWidth={1} fill="none" />
            <Graph.Path d={frameTL} stroke="theme:bg1" strokeWidth={1} fill="none" />
            <Graph.Path d={curve} stroke="theme:atch" strokeWidth={1.75} fill="none" />
          </Graph>
        </StaticSurface>
        {/* Dot — left/top resolved from host latches. The latches
            are written by framework/animations.zig:tickAll in the
            painter loop. React mounts this Box once and never
            renders it again for the lifetime of the animation. */}
        <Box
          style={{
            position: 'absolute',
            left: `latch:easing-host:${props.name}:dotX`,
            top: `latch:easing-host:${props.name}:dotY`,
            width: 6,
            height: 6,
            backgroundColor: 'theme:ink',
            borderRadius: 3,
            borderWidth: 1,
            borderColor: 'theme:atch',
          }}
        />
      </Box>
      <Box
        style={{
          position: 'relative',
          width: PLOT.w,
          height: 6,
          backgroundColor: 'theme:bg1',
          borderRadius: 3,
        }}
      >
        <Box
          style={{
            position: 'absolute',
            left: `latch:easing-host:${props.name}:barLeft`,
            top: -2,
            width: 10,
            height: 10,
            backgroundColor: 'theme:atch',
            borderRadius: 5,
          }}
        />
      </Box>
      <Text style={{ fontSize: 11, color: 'theme:inkDim', fontFamily: 'monospace' }}>{props.name}</Text>
    </Col>
  );
}

export type EasingsHostIntervalProps = {};

export function EasingsHostInterval(_props: EasingsHostIntervalProps) {
  const names = EASING_NAMES;

  return (
    <Col style={{ gap: 16, padding: 16, alignItems: 'center' }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:ink' }}>Easings (Host-driven)</Text>
      <Text style={{ fontSize: 12, color: 'theme:inkDimmer' }}>
        Zero JS per frame. Animations registered once in framework/animations.zig and ticked from the painter loop in compiled Zig.
      </Text>
      <Row style={{ flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: TILE_W * 5 + 40 }}>
        {names.map((name) => (
          <EasingTileHost key={name} name={name} />
        ))}
      </Row>
    </Col>
  );
}
