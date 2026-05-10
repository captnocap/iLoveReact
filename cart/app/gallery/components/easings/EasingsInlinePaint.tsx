// EasingsInlinePaint — host-driven Easings matrix, baked into the
// painter the same way border_dash.zig is.
//
// Shape difference vs EasingsHostInterval:
//   HostInterval: useHostAnimation → animations.zig registry → latch
//                 → syncLatchesToNodes → style prop. Three layers.
//   InlinePaint:  Box gets style props directly (tweenTranslateX*,
//                 tweenTranslateY*). engine.zig evaluates them in the
//                 paint loop using SDL_GetTicks. Zero indirection.
//
// Every tile mounts ONCE. No useEffect, no useState, no RAF, no
// __anim_register, no latch sync. The only Zig-side work per frame is
// `eased = applyCurve(curve, mod(now, dur)/dur)` and adding the result
// to translate_x/y just before the existing transform compose. Same
// model `border_dash` uses — animation params live on the Box.

import { Box, Col, Row, Graph, StaticSurface, Text } from '@reactjit/runtime/primitives';
import { EASINGS, EASING_NAMES, type EasingName } from '@reactjit/runtime/easing';

const CYCLE_MS = 1800;
const TILE_W = 160;
const TILE_H = 140;
const PLOT = { x: 10, y: 10, w: TILE_W - 20, h: 70 };

// Mirror animations.CurveType byte ordering exactly. Index in this list
// IS the enum value the Zig painter reads. Keep in sync with
// framework/animations.zig CurveType.
const CURVE_BYTE: Record<EasingName, number> = (() => {
  const order: EasingName[] = [
    // 0..6 are the legacy 7. Easings names skip these (no "easeIn" alias),
    // but the matrix below maps the 30 named easings starting at byte 7.
    'easeInSine', 'easeOutSine', 'easeInOutSine',
    'easeInQuad', 'easeOutQuad', 'easeInOutQuad',
    'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
    'easeInQuart', 'easeOutQuart', 'easeInOutQuart',
    'easeInQuint', 'easeOutQuint', 'easeInOutQuint',
    'easeInExpo', 'easeOutExpo', 'easeInOutExpo',
    'easeInCirc', 'easeOutCirc', 'easeInOutCirc',
    'easeInBack', 'easeOutBack', 'easeInOutBack',
    'easeInElastic', 'easeOutElastic', 'easeInOutElastic',
    'easeInBounce', 'easeOutBounce', 'easeInOutBounce',
  ];
  const map: any = { linear: 0 };
  order.forEach((name, i) => { map[name] = 7 + i; });
  return map as Record<EasingName, number>;
})();

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

function EasingTileInline(props: { name: EasingName }) {
  const fn = EASINGS[props.name];
  const curveD = buildCurvePath(fn);
  const frameTL = `M ${PLOT.x} ${PLOT.y + PLOT.h} L ${PLOT.x} ${PLOT.y} L ${PLOT.x + PLOT.w} ${PLOT.y}`;
  const frameBR = `M ${PLOT.x} ${PLOT.y + PLOT.h} L ${PLOT.x + PLOT.w} ${PLOT.y + PLOT.h} L ${PLOT.x + PLOT.w} ${PLOT.y}`;
  const curveByte = CURVE_BYTE[props.name];
  // Baseline absolute position of the dot — when from=0,to=PLOT.w the
  // engine's tween adds the eased value to translate_x; same for Y but
  // negative since the curve maps 0→bottom and 1→top.

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
        <StaticSurface staticKey={`easing-inline:${props.name}`}>
          <Graph originTopLeft style={{ width: TILE_W - 16, height: PLOT.h + 20 }}>
            <Graph.Path d={frameBR} stroke="theme:bg2" strokeWidth={1} fill="none" />
            <Graph.Path d={frameTL} stroke="theme:bg1" strokeWidth={1} fill="none" />
            <Graph.Path d={curveD} stroke="theme:atch" strokeWidth={1.75} fill="none" />
          </Graph>
        </StaticSurface>
        {/* Dot: baseline at plot bottom-left, engine adds the eased
            X (linear) and Y (curve) to its translate. */}
        <Box
          style={{
            position: 'absolute',
            left: PLOT.x - 3,
            top: PLOT.y + PLOT.h - 3,
            width: 6,
            height: 6,
            backgroundColor: 'theme:ink',
            borderRadius: 3,
            borderWidth: 1,
            borderColor: 'theme:atch',
            // X: linear sweep across the plot width.
            tweenTranslateXFrom: 0,
            tweenTranslateXTo: PLOT.w,
            tweenTranslateXDurMs: CYCLE_MS,
            tweenTranslateXCurve: 0,
            // Y: tile's actual easing, going up (negative) as eased→1.
            tweenTranslateYFrom: 0,
            tweenTranslateYTo: -PLOT.h,
            tweenTranslateYDurMs: CYCLE_MS,
            tweenTranslateYCurve: curveByte,
          } as any}
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
            left: -5,
            top: -2,
            width: 10,
            height: 10,
            backgroundColor: 'theme:atch',
            borderRadius: 5,
            tweenTranslateXFrom: 0,
            tweenTranslateXTo: PLOT.w,
            tweenTranslateXDurMs: CYCLE_MS,
            tweenTranslateXCurve: curveByte,
          } as any}
        />
      </Box>
      <Text style={{ fontSize: 11, color: 'theme:inkDim', fontFamily: 'monospace' }}>{props.name}</Text>
    </Col>
  );
}

export type EasingsInlinePaintProps = {};

export function EasingsInlinePaint(_props: EasingsInlinePaintProps) {
  const names = EASING_NAMES;
  return (
    <Col style={{ gap: 16, padding: 16, alignItems: 'center' }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:ink' }}>Easings (Inline-paint)</Text>
      <Text style={{ fontSize: 12, color: 'theme:inkDimmer' }}>
        Animation params live on each Box's style. engine.zig evaluates them
        in the paint loop using SDL_GetTicks — same shape border_dash.zig
        uses. No registry, no latches, no useEffect. JS runs once at mount.
      </Text>
      <Row style={{ flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: TILE_W * 5 + 40 }}>
        {names.map((name) => (
          <EasingTileInline key={name} name={name} />
        ))}
      </Row>
    </Col>
  );
}
