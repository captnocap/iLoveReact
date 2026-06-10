import { Box, Text } from '@reactjit/primitives';

// The 2D face of a street guide sign, captured to a texture and sampled by the
// StreetSign panel mesh (the billboard_demo "live Box+Text on a mesh" path). It
// is real UI — a green MUTCD-style plate with a white border and a route
// name — so the lettering stays crisp at any mesh size. All street signs share
// one capture; the panel just samples this key.

export const STREET_SIGN_TEXTURE_KEY = 'hmsc.prop.streetSign';
export const STREET_SIGN_TEXTURE_WIDTH = 512;
export const STREET_SIGN_TEXTURE_HEIGHT = 150;

const SIGN_GREEN = '#1f7a3d';
const SIGN_BORDER = '#f4f7f2';

export function StreetSignFace() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: SIGN_GREEN, padding: 10 }}>
      <Box
        style={{
          width: '100%',
          height: '100%',
          borderWidth: 4,
          borderColor: SIGN_BORDER,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 14,
        }}
      >
        <Text style={{ fontSize: 64, color: SIGN_BORDER, fontWeight: 'bold' }}>HMSC</Text>
        <Text style={{ fontSize: 64, color: SIGN_BORDER, fontWeight: 'bold' }}>AVE</Text>
      </Box>
    </Box>
  );
}
