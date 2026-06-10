// A humanoid palette maps each material slot to a color. One skeleton recolors
// into any character by swapping the palette: the player wears the original
// magenta-shirt look; NPCs draw from a small set of varied palettes so a crowd
// is not all clones. Add a palette here, not a new figure.

import type { MaterialSlot } from './skeleton';

export type HumanoidPalette = Record<MaterialSlot, string>;

// The original PlayerFigure colors, unchanged — keeps the player silhouette
// identical after the extraction.
export const PLAYER_PALETTE: HumanoidPalette = {
  skin: '#caa07a',
  shirt: '#c23b8e',
  pants: '#272238',
  shoe: '#15121f',
  hat: '#e8c14a',
  eye: '#0a0a12',
  belt: '#2b2638',
  nose: '#b8906a',
  marker: '#18e0d8',
};

// NPC palettes. Each is a believable street civilian recolor. NpcFigure picks one
// deterministically from the NPC id so a given NPC always looks the same.
export const NPC_PALETTES: HumanoidPalette[] = [
  { skin: '#caa07a', shirt: '#3a6ea5', pants: '#23202b', shoe: '#15121f', hat: '#2b3a4a', eye: '#0a0a12', belt: '#1c1a22', nose: '#b8906a', marker: '#888888' },
  { skin: '#8d5a3c', shirt: '#4f7a3a', pants: '#2e2a22', shoe: '#1a1712', hat: '#6b5a2a', eye: '#0a0a12', belt: '#221f18', nose: '#7d4e34', marker: '#888888' },
  { skin: '#e0b48c', shirt: '#9a3b3b', pants: '#2a2530', shoe: '#15121f', hat: '#7a2e2e', eye: '#0a0a12', belt: '#211d24', nose: '#cf9f78', marker: '#888888' },
  { skin: '#a9785a', shirt: '#5a5560', pants: '#1f1d24', shoe: '#15121f', hat: '#3a3640', eye: '#0a0a12', belt: '#18161c', nose: '#946a4e', marker: '#888888' },
];

// Pick a stable palette index for an NPC by hashing its id. Exported so the
// face pool (face.tsx) keys off the SAME pick — a face's skin tone always
// matches the body it's drawn on.
export function npcPaletteIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % NPC_PALETTES.length;
}

// Pick a stable palette for an NPC by hashing its id. Same id -> same look.
export function npcPalette(id: string): HumanoidPalette {
  return NPC_PALETTES[npcPaletteIndex(id)];
}
