import { memo } from 'react';
import { Box, Image, Render, StaticSurface } from '@reactjit/primitives';
import { NPC_PALETTES, PLAYER_PALETTE, npcPaletteIndex } from './palette';

// Humanoid FACES. A face is a tiny 2D composition (eyes, brows, mouth) baked
// through the StaticSurface→textureKey pipeline — the same machinery building
// facades ride — and decal-projected onto the front of the head by the `Head`
// geometry (runtime/geometries/Head.ts). No unwrapping, no scanning: a flat face
// image stuck to the front of a ball (the Animal Crossing / Mii register).
//
// Authoring contract with the Head decal: features live inside the texture's
// inscribed circle; the BORDER pixels wrap the back of the head, so the
// background is plain skin and the top band is hair-shadow (back-of-head reads
// as skin with a darker crown). Skin tones come from the SAME palette pick as
// the body (palette.ts), so a face never mismatches its hands.
//
// Variety = palette pick × feature preset, both hashed off the NPC id. The full
// pool is small (palettes × presets, ~96px each), so HumanoidFaceCaptures mounts
// every combination statically — any NPC's key is always already baked.

export const FACE_PX = 96;

type BrowStyle = 'flat' | 'angledIn' | 'raised';
type MouthStyle = 'neutral' | 'smile' | 'frown';

export type FaceFeatures = {
  brow: BrowStyle;
  mouth: MouthStyle;
  /** iris color */
  eye: string;
  /** heavy upper lids — half-closed deadpan eyes */
  sleepy?: boolean;
  /** jaw stubble shading */
  stubble?: boolean;
};

// The curated NPC feature presets — believable street civilians, not clowns.
// Add a preset here, not a new face path.
export const FACE_FEATURES: FaceFeatures[] = [
  { brow: 'flat', mouth: 'neutral', eye: '#4a3220' }, // deadpan commuter
  { brow: 'raised', mouth: 'smile', eye: '#2f5d8a' }, // friendly
  { brow: 'angledIn', mouth: 'frown', eye: '#3a2a1a' }, // grumpy
  { brow: 'flat', mouth: 'neutral', eye: '#456b3a', stubble: true }, // five-o'clock shadow
  { brow: 'flat', mouth: 'neutral', eye: '#5a4632', sleepy: true }, // running on no sleep
  { brow: 'raised', mouth: 'smile', eye: '#6b4a2a', stubble: true }, // easygoing
];

export const PLAYER_FACE: FaceFeatures = { brow: 'flat', mouth: 'smile', eye: '#2a6b5a' };

export const PLAYER_FACE_KEY = 'hmsc.face.player';

function npcFaceFeatureIndex(id: string): number {
  // Decorrelate from the palette pick (which uses hash % palettes) by hashing
  // the id with a different seed walk — same string, different lane.
  let hash = 7;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 131 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % FACE_FEATURES.length;
}

// The stable texture key an NPC's head samples. Same id → same face, and the
// key always exists because HumanoidFaceCaptures bakes the whole pool.
export function npcFaceKey(id: string): string {
  return `hmsc.face.p${npcPaletteIndex(id)}.f${npcFaceFeatureIndex(id)}`;
}

// ── color helpers ───────────────────────────────────────────────────────────

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}
function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
/** Scale a #rrggbb toward black: darken('#ffffff', 0.5) = mid gray. */
function darken(hex: string, factor: number): string {
  return toHex(channel(hex, 0) * factor, channel(hex, 1) * factor, channel(hex, 2) * factor);
}

// ── the face composition ────────────────────────────────────────────────────

const abs = (left: number, top: number, width: number, height: number) =>
  ({ position: 'absolute' as const, left, top, width, height });

// One eye (white + iris + pupil + lid) centered at cx. The lid is a skin-shadow
// bar over the top of the white; sleepy drops it halfway down the eye.
function Eye(props: { cx: number; iris: string; shade: string; sleepy?: boolean }) {
  const { cx, iris, shade, sleepy } = props;
  return (
    <>
      <Box style={{ ...abs(cx - 7, 33, 14, 10), backgroundColor: '#f2ece2', borderRadius: 5 }} />
      <Box style={{ ...abs(cx - 4, 34, 8, 8), backgroundColor: iris, borderRadius: 4 }} />
      <Box style={{ ...abs(cx - 2, 36, 4, 4), backgroundColor: '#16120e', borderRadius: 2 }} />
      <Box style={{ ...abs(cx - 7, 32, 14, sleepy ? 6 : 3), backgroundColor: shade, borderRadius: 2 }} />
    </>
  );
}

// One brow over the eye at cx. Styles are built from straight bars (the 2D layer
// has no rotation): angledIn staggers the inner segment lower (scowl), raised
// floats the whole bar higher (open, friendly).
function Brow(props: { cx: number; style: BrowStyle; color: string; mirror: boolean }) {
  const { cx, style, color, mirror } = props;
  if (style === 'angledIn') {
    const innerLeft = mirror ? cx - 7 : cx;
    const outerLeft = mirror ? cx : cx - 8;
    return (
      <>
        <Box style={{ ...abs(outerLeft, 25, 8, 3), backgroundColor: color, borderRadius: 1 }} />
        <Box style={{ ...abs(innerLeft, 28, 7, 3), backgroundColor: color, borderRadius: 1 }} />
      </>
    );
  }
  const top = style === 'raised' ? 24 : 27;
  return <Box style={{ ...abs(cx - 7, top, 14, 3), backgroundColor: color, borderRadius: 1 }} />;
}

function Mouth(props: { style: MouthStyle; color: string }) {
  const { style, color } = props;
  if (style === 'neutral') {
    return <Box style={{ ...abs(41, 63, 14, 3), backgroundColor: color, borderRadius: 1 }} />;
  }
  // smile = corners raised above the center bar; frown = corners dropped below
  const capTop = style === 'smile' ? 61 : 65;
  return (
    <>
      <Box style={{ ...abs(40, 63, 16, 3), backgroundColor: color, borderRadius: 1 }} />
      <Box style={{ ...abs(37, capTop, 4, 3), backgroundColor: color, borderRadius: 1 }} />
      <Box style={{ ...abs(55, capTop, 4, 3), backgroundColor: color, borderRadius: 1 }} />
    </>
  );
}

// The full face, FACE_PX square. `skin` is the body palette's skin tone so the
// head matches the hands; everything else derives from it or the feature preset.
export function FaceTexture(props: { skin: string; features: FaceFeatures }) {
  const { skin, features } = props;
  const shade = darken(skin, 0.78); // lids, nose shadow, hairline band
  const brow = darken(skin, 0.32); // brow/hair tone
  const lips = darken(skin, 0.62);
  return (
    <Box style={{ width: FACE_PX, height: FACE_PX, backgroundColor: skin, position: 'relative' }}>
      {/* hairline band — also what the back-of-head crown samples via the decal border */}
      <Box style={{ ...abs(0, 0, FACE_PX, 13), backgroundColor: shade }} />
      <Brow cx={32} style={features.brow} color={brow} mirror={false} />
      <Brow cx={64} style={features.brow} color={brow} mirror={true} />
      <Eye cx={32} iris={features.eye} shade={shade} sleepy={features.sleepy} />
      <Eye cx={64} iris={features.eye} shade={shade} sleepy={features.sleepy} />
      {/* nose shadow under the 3D cone — grounds it against the decal */}
      <Box style={{ ...abs(44, 50, 8, 4), backgroundColor: shade, borderRadius: 2 }} />
      <Mouth style={features.mouth} color={lips} />
      {features.stubble ? (
        <Box style={{ ...abs(24, 68, 48, 22), backgroundColor: darken(skin, 0.88), borderRadius: 10 }} />
      ) : null}
    </Box>
  );
}

// ── baking ──────────────────────────────────────────────────────────────────

// Static identities — captures bake once and the cache holds (the StaticSurface
// inline-prop rebake trap; see textures.tsx).
const SURFACE_STYLE = { position: 'absolute' as const, left: -99999, top: 0, width: FACE_PX, height: FACE_PX };

const FaceCapture = memo(function FaceCapture(props: { staticKey: string; skin: string; features: FaceFeatures }) {
  return (
    <StaticSurface staticKey={props.staticKey} style={SURFACE_STYLE}>
      <FaceTexture skin={props.skin} features={props.features} />
    </StaticSurface>
  );
});

// ── photo / webcam faces ────────────────────────────────────────────────────
//
// The decal slot doesn't care how the face image was authored — Boxes, a photo
// off disk, or a live webcam feed all bake the same way. A photo should be
// cropped roughly square with the face centered (features inside the inscribed
// circle — the border pixels wrap the back of the head). The cam face is LIVE:
// the feed re-bakes continuously, so your actual face is on the figure's head.
export type FaceSource =
  | { kind: 'preset' }
  | { kind: 'image'; src: string }
  | { kind: 'cam'; device?: number };

// The one knob for what the player's head wears:
//   { kind: 'preset' }                      — the authored face below
//   { kind: 'image', src: '/path/face.png' } — a photo off disk
//   { kind: 'cam' }                          — live webcam (FFmpeg/v4l2 cam:0)
export const PLAYER_FACE_SOURCE: FaceSource = { kind: 'preset' };

const FACE_FILL_STYLE = { width: FACE_PX, height: FACE_PX };

function PlayerFaceCapture() {
  const source = PLAYER_FACE_SOURCE;
  if (source.kind === 'image') {
    return (
      <StaticSurface staticKey={PLAYER_FACE_KEY} style={SURFACE_STYLE}>
        <Image src={source.src} style={FACE_FILL_STYLE} />
      </StaticSurface>
    );
  }
  if (source.kind === 'cam') {
    return (
      <StaticSurface staticKey={PLAYER_FACE_KEY} style={SURFACE_STYLE}>
        <Render renderSrc={`cam:${source.device ?? 0}`} style={FACE_FILL_STYLE} />
      </StaticSurface>
    );
  }
  return <FaceCapture staticKey={PLAYER_FACE_KEY} skin={PLAYER_PALETTE.skin} features={PLAYER_FACE} />;
}

// Offscreen captures for the WHOLE face pool (player + every palette×preset
// combination). Mount once as a 2D sibling of <Scene3D>, alongside the other
// *SurfaceCaptures — any figure's faceKey then always resolves to a baked
// texture. The pool is static, so this renders once and never re-bakes.
export const HumanoidFaceCaptures = memo(function HumanoidFaceCaptures() {
  return (
    <>
      <PlayerFaceCapture />
      {NPC_PALETTES.map((palette, paletteIndex) =>
        FACE_FEATURES.map((features, featureIndex) => (
          <FaceCapture
            key={`p${paletteIndex}.f${featureIndex}`}
            staticKey={`hmsc.face.p${paletteIndex}.f${featureIndex}`}
            skin={palette.skin}
            features={features}
          />
        )),
      )}
    </>
  );
});
