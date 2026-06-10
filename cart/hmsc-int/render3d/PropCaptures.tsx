import { memo } from 'react';
import { StaticSurface } from '@reactjit/primitives';
import type { WorldProp } from '../design';
import {
  STREET_SIGN_TEXTURE_HEIGHT,
  STREET_SIGN_TEXTURE_KEY,
  STREET_SIGN_TEXTURE_WIDTH,
  StreetSignFace,
} from './props/signFace';

// Offscreen capture sources for the billboard props → the texture keys their
// panels sample. Mounted in the 2D tree as a sibling of <Scene3D>, parked
// off-screen, exactly like TileSurfaceCaptures/RoadSurfaceCaptures.
//
// Only the street sign needs a texture now (bushes became solid sphere mounds,
// no card/texture). All street signs share ONE plate, captured at most once and
// only when a street sign exists. The sculpted props (rock, hydrant, lights,
// bushes) are plain meshes with no capture.

const StreetSignCapture = memo(function StreetSignCapture() {
  return (
    <StaticSurface staticKey={STREET_SIGN_TEXTURE_KEY} style={{ position: 'absolute', left: -99999, top: 0, width: STREET_SIGN_TEXTURE_WIDTH, height: STREET_SIGN_TEXTURE_HEIGHT }}>
      <StreetSignFace />
    </StaticSurface>
  );
});

export const PropSurfaceCaptures = memo(function PropSurfaceCaptures(props: { props: WorldProp[] }) {
  const hasStreetSign = props.props.some((prop) => prop.kind === 'streetSign');
  return <>{hasStreetSign ? <StreetSignCapture /> : null}</>;
});
