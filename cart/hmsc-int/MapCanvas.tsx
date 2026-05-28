import { Box, Canvas } from '@reactjit/runtime/primitives';

export function MapCanvas() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#080d16' }}>
      <Canvas style={{ flex: 1, backgroundColor: '#080d16' }} />
    </Box>
  );
}
