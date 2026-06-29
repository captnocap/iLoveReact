import {
  lowerPropRecipe,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';
import { textLineParts, textLineWidth } from './blockText';

export const streetSignDef: PropKindDefinition = {
  kind: 'streetSign',
  label: 'Street Sign',
  solid: true,
  footprintRadiusMeters: 0.12,
  footprintDepthMeters: 0.24,
  // Tall enough that the panel clears head height (visual head-top ~2.04m,
  // stylized-tall — see the R4 scale contract).
  heightMeters: 3.3,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  base: [0.42, 0.45, 0.48],
  pole: [0.6, 0.63, 0.67],
  signFace: [0.08, 0.42, 0.26],
  text: [0.95, 0.97, 1],
} satisfies Record<string, Color>;

// The green panel geometry (kept in ONE place so the text lands on its face).
const PANEL_DROP = 0.32;   // panel centre below the pole top
const PANEL_Z = -0.04;     // panel centre z (faces −Z, yaw-0 convention)
const PANEL_DEPTH = 0.03;
const PANEL_W = 1.5;
const PANEL_H = 0.44;

export function streetSignRecipe(heightMeters: number): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'cylinder8',
      position: { x: 0, y: 0.06, z: 0 },
      radius: 0.14,
      height: 0.12,
      color: COLORS.base,
    },
    {
      id: 'pole',
      shape: 'cylinder8',
      position: { x: 0, y: heightMeters / 2, z: 0 },
      radius: 0.05,
      height: heightMeters,
      color: COLORS.pole,
    },
    {
      id: 'signFace',
      shape: 'box',
      position: { x: 0, y: heightMeters - PANEL_DROP, z: PANEL_Z },
      size: { width: PANEL_W, height: PANEL_H, depth: PANEL_DEPTH },
      color: COLORS.signFace,
    },
  ];
  return { id: 'streetSign', parts };
}

// The panel's front face z (faces −Z) — block letters sit just in front of it.
const PANEL_FRONT_Z = PANEL_Z - PANEL_DEPTH / 2;
const TEXT_DEPTH = 0.02;
const LINE_GAP = 0.05;

// Parametric street-name sign (INTERSECTIONS-0619, req_1480): the panel plus up
// to two lines of block letters printing the per-instance `text` (the crossing
// road names), each scaled to fit the panel width. No text → the bare panel (the
// footprint path), so a sign still measures a collision box.
export function streetSignParts(heightMeters: number, text?: string): PropPartSpec[] {
  const parts = lowerPropRecipe(streetSignRecipe(heightMeters));
  const lines = (text ?? '').split('\n').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 2);
  if (!lines.length) return parts;
  const panelY = heightMeters - PANEL_DROP;
  const cap0 = lines.length === 1 ? 0.24 : (PANEL_H - LINE_GAP) / 2 * 0.88;
  const maxW = PANEL_W * 0.92;
  for (let i = 0; i < lines.length; i++) {
    let cap = cap0;
    const w = textLineWidth(lines[i], cap);
    if (w > maxW) cap *= maxW / w; // shrink to fit the panel width
    const slotCenter = lines.length === 1
      ? panelY
      : panelY + (i === 0 ? (cap0 / 2 + LINE_GAP / 2) : -(cap0 / 2 + LINE_GAP / 2));
    // The compiled (no-V8) loader renders this panel's letters horizontally
    // mirrored on its facing side (req_2046/2059/2067). The letters are laid out
    // (and centred on x=0) by textLineParts; mirror their X so the baked sign
    // reads correctly in the compiled game. The editor renders street signs via a
    // separate texture-capture panel (render3d/props/StreetSign), so this only
    // touches the baked/compiled stencil — exactly where the bug lives.
    const lineParts = textLineParts(lines[i], {
      capHeightMeters: cap, color: COLORS.text, depthMeters: TEXT_DEPTH,
      baseY: slotCenter - cap / 2, frontZ: PANEL_FRONT_Z,
    });
    for (const p of lineParts) p.local = [-p.local[0], p.local[1], p.local[2]];
    parts.push(...lineParts);
  }
  return parts;
}
