import { Box } from '@reactjit/runtime/primitives';

const SHADOW = '#16241c88';

export function Player({ cx, cy, rel, bob }: { cx: number; cy: number; rel: number; bob: number }) {
  const u = 2.3;
  const l = cx - 10 * u;
  const t = cy - 24 * u + bob;
  const eyeX = Math.cos(rel) * 3.2 * u;
  const eyeY = Math.sin(rel) * 2.0 * u;
  return (
    <Box style={{ position: 'absolute', left: l, top: t, width: 20 * u, height: 28 * u }}>
      <Box style={{ position: 'absolute', left: 3 * u, top: 23 * u - bob, width: 14 * u, height: 4 * u, backgroundColor: SHADOW }} />
      <Box style={{ position: 'absolute', left: 6 * u, top: 4 * u, width: 9 * u, height: 8 * u, backgroundColor: '#d39b67' }} />
      <Box style={{ position: 'absolute', left: 5 * u + eyeX, top: 7 * u + eyeY, width: 3 * u, height: 2 * u, backgroundColor: '#1c2024' }} />
      <Box style={{ position: 'absolute', left: 4 * u, top: 12 * u, width: 12 * u, height: 11 * u, backgroundColor: '#2e6da4' }} />
      <Box style={{ position: 'absolute', left: 7 * u, top: 14 * u, width: 6 * u, height: 5 * u, backgroundColor: '#6fb3d2' }} />
      <Box style={{ position: 'absolute', left: 3 * u, top: 13 * u, width: 3 * u, height: 8 * u, backgroundColor: '#d39b67' }} />
      <Box style={{ position: 'absolute', left: 15 * u, top: 13 * u, width: 3 * u, height: 8 * u, backgroundColor: '#d39b67' }} />
    </Box>
  );
}
