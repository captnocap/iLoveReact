// game/textures/builtinDecals.ts — BUILT-IN DecalDocs for the retiring React
// facades (FACADEDECAL-0610, USER ASK req_0589 "why doesnt this one show up
// in the compiled game").
//
// The hand-coded React facade catalog (hmsc/render3d/buildingSkins REACT_
// TEXTURES) is CODE, not data — it has no recipe the no-V8 loader can run, so
// faces skinned with it compile to flat color. The catalog is already doomed
// (the CAPTURE.md GAP: it retires WITH the hand-coded buildings; /compose
// decals replace it). This module is the bridge: facades the user's maps
// actively wear get a faithful DecalDoc transcription, shipped through the
// SAME recipe pipe as authored decals (worldGeometry resolveMaterialDoc →
// packDecalDoc → the MATERIALS lump DOCS tail → decal_raster at load).
//
// Each doc is hand-transcribed from its facade component at the storefront
// size the build walls wear (the React original adapts its grid to cols/
// floors; a doc is fixed — the standard wall reads identical, oversized
// faces stretch). Colors are EXACT (cellHash computed per cell). Editor
// rendering keeps the live React facade; this is its compiled lowering.
//
// Extending: transcribe the next facade into this table — nothing else to
// wire. Data only (the decal.ts law: no React imports).

import type { DecalDoc, DecalNode } from './decal';

// internetCafe (buildingSkins InternetCafeFacade, 2 rows × 3 cols — the
// standard wall): dark storefront, glowing monitor grid (cellHash colors:
// row0 teal/dark/purple, row1 dark/dark/pink), neon sign band, NET CAFE.
function internetCafe(): DecalDoc {
  const SCREENS = [
    ['#27e0d2', '#1b2738', '#7b6cff'],
    ['#1b2738', '#1b2738', '#ff5fa2'],
  ];
  const nodes: DecalNode[] = [];
  let id = 0;
  const cellW = 146;
  const cellH = 166;
  const colX = [20, 183, 346];
  const rowY = [20, 202];
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      nodes.push({ id: `m${id++}`, kind: 'rect', x: colX[col], y: rowY[row], w: cellW, h: cellH, bg: '#05070b' });
      nodes.push({ id: `s${id++}`, kind: 'rect', x: colX[col] + 6, y: rowY[row] + 6, w: cellW - 12, h: cellH - 12, bg: SCREENS[row][col], borderRadius: 2 });
    }
  }
  nodes.push({ id: 'band', kind: 'rect', x: 0, y: 389, w: 512, h: 123, bg: '#070a10', borderWidth: 4, borderColor: '#27e0d2' });
  nodes.push({ id: 'sign', kind: 'text', x: 0, y: 389, w: 512, h: 123, text: 'NET CAFE', color: '#5ff0e6', fontSize: 64, fontWeight: 700, align: 'center', letterSpacing: 4 });
  return { version: 1, width: 512, height: 512, bg: '#10141c', nodes };
}

/** Facade id → its compiled decal recipe. Keys are the texture-registry ids
 *  the face skins reference. */
export const BUILTIN_DECALS: Record<string, DecalDoc> = {
  internetCafe: internetCafe(),
};
