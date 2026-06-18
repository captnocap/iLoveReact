// editors/model/TextureAtlas.tsx — the SCENE sprite-map atlas (USER req_1068). The
// whole scene's packed UV islands rendered into ONE offscreen StaticSurface that
// every part's mesh samples via `textureKey` — the Blockbench "Create Texture"
// output (a colored per-island template, image-4). It reads the parts' STORED UVs
// (the branch the textureize pack committed), so the render is the single source of
// truth with what the mesh samples: each face's `uv` IS its slot in the shared
// atlas. Painting the islands is the deferred next step; the per-island outline is
// the cookie cutter (req_1069) the piece-by-piece image-to-image flow will mask to.
//
// Pattern: the cutout painter's live preview — an offscreen <StaticSurface staticKey>
// the mesh's `textureKey` points at, re-baked only when `sig` changes (the inline-
// prop rebake hazard harnessed). See ../MESH_EDITOR_PLAYBOOK.md Part 5.6.

import { Fragment, memo } from 'react';
import { Box, Image, StaticSurface, Text } from '@reactjit/primitives';
import { islandColorFor, type TextureType } from './textureize';
import { storedUVLayout, type V2, type EditMesh } from './editMesh';
import { faceCellGrid, cellAtlasRect, PAINT_CELL_UNITS, type PaintCells } from './meshPaint';
import { slotById, slotColor, type Palette } from './modelStream';
import { MaterialFill } from './MaterialFill';
import { STUDIO } from './Studio';

/** The one live texture key every part's mesh samples (the cutout idiom). */
export const STUDIO_TEXTURE_KEY = 'studio.texture.live';

const CHECK_LIGHT = '#3a4658';
const CHECK_DARK = '#2b3545';

// one outline segment (px). The framework rotates a Box about its CENTER (no
// transformOrigin), so position the segment centered on its midpoint then spin it
// (the UVPanel idiom).
function Seg(props: { a: V2; b: V2; color: string; th?: number }) {
  const [ax, ay] = props.a, [bx, by] = props.b;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 0.001;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const th = props.th ?? 1.2;
  return <Box style={{ position: 'absolute', left: (ax + bx) / 2 - len / 2, top: (ay + by) / 2 - th / 2, width: len, height: th, backgroundColor: props.color, transform: { rotate: angle } }} />;
}

/** A part in the scene atlas, with its paint LAYER (surface-cell → slot id). */
export type ScenePart = { id: string; mesh: EditMesh; paint?: PaintCells };

/** The offscreen sprite-map capture for the WHOLE scene. `sig` (meshRev + atlas
 *  params + paint/palette) drives the re-bake: when it changes the memo re-renders,
 *  the capture subtree gets fresh identity, and the StaticSurface re-captures. */
export const SceneTextureAtlas = memo(function SceneTextureAtlas(props: { parts: ScenePart[]; texels: number; type: TextureType; color: string; imageUrl?: string; sliceImages?: Record<string, string>; palette?: Palette; pseudo?: boolean; paintCell?: number; sig: string }) {
  const px = STUDIO.textureAtlasPx;
  const cells = Math.max(2, STUDIO.textureCheckerCells);
  const cell = px / cells;
  // PAINT (the corrected painter, req_1288): each painted cell is a uniform model-
  // surface cell (paintCell model-units) resolved through the model palette. Colour
  // slots fill a seamless atlas rect (shared-edge rounding → no pinstripes); material
  // slots bake through a world-scaled shader (MaterialFill). Drawn on top of the base
  // art so manual paint always wins.
  const paintCell = props.paintCell ?? PAINT_CELL_UNITS;

  // the checkerboard backdrop (the UV-test ground): light base + dark cells.
  const darkCells: { x: number; y: number }[] = [];
  for (let cy = 0; cy < cells; cy += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      if ((cx + cy) % 2 === 1) darkCells.push({ x: cx * cell, y: cy * cell });
    }
  }

  // gather every island across every part from the STORED UVs (uv in [0,1] → px).
  // colored by the SHARED islandColorFor (req_1072) — the same per-(part,face) pick
  // the UV panel + the PNG export use, so all three show EXACTLY the same colors.
  type Isl = { key: string; poly: V2[]; rect: { x: number; y: number; w: number; h: number }; color: string };
  const islands: Isl[] = [];
  for (const part of props.parts) {
    const layout = storedUVLayout(part.mesh, px); // uv * px
    for (const f of layout.faces) {
      islands.push({ key: `${part.id}:${f.faceIndex}`, poly: f.poly, rect: f.rect, color: islandColorFor(part.id, f.faceIndex) });
    }
  }

  const template = props.type === 'template';
  const blank = props.type === 'blank';
  // a RE-UPLOADED whole-sheet texture (req_1079) REPLACES the procedural template —
  // the model captures the user's edited / AI-generated map. Per-face slice uploads
  // composite over whatever base, clipped to their atlas slot (the cookie cutter).
  const whole = props.imageUrl;
  const sliceImages = props.sliceImages ?? {};
  const rectByKey = new Map(islands.map((i) => [i.key, i.rect] as const));

  return (
    <StaticSurface staticKey={STUDIO_TEXTURE_KEY} style={{ position: 'absolute', left: -99999, top: 0, width: px, height: px }}>
      <Box style={{ width: px, height: px, position: 'relative', overflow: 'hidden', backgroundColor: props.type === 'solid' && !whole ? props.color : CHECK_LIGHT }}>
        {whole ? (
          // the uploaded sheet IS the texture — the faces sample it through the UVs.
          <Image source={whole} style={{ position: 'absolute', left: 0, top: 0, width: px, height: px }} />
        ) : (
          <>
            {/* solid fill = one flat color; template/blank get the checker ground */}
            {props.type === 'solid'
              ? null
              : darkCells.map((c, i) => (
                  <Box key={`ck${i}`} style={{ position: 'absolute', left: c.x, top: c.y, width: cell, height: cell, backgroundColor: CHECK_DARK }} />
                ))}
            {/* the islands — Texture Template fills each a distinct pastel + outline;
                Blank shows only the outline (the cookie-cutter silhouettes) over the
                checker; Solid shows nothing (the flat color is the whole texture). */}
            {!blank && template
              ? islands.map((isl) => (
                  <Box key={isl.key} style={{ position: 'absolute', left: isl.rect.x, top: isl.rect.y, width: Math.max(1, isl.rect.w), height: Math.max(1, isl.rect.h), backgroundColor: `${isl.color}cc` }} />
                ))
              : null}
            {props.type !== 'solid'
              ? islands.map((isl) =>
                  isl.poly.map((p, i) => (
                    <Seg key={`${isl.key}-${i}`} a={p} b={isl.poly[(i + 1) % isl.poly.length]} color={template ? '#0c0f16cc' : `${isl.color}cc`} />
                  )),
                )
              : null}
          </>
        )}
        {/* per-face slice uploads — each clipped to its slot (cookie cutter). */}
        {Object.entries(sliceImages).map(([key, url]) => {
          const r = rectByKey.get(key);
          if (!r) return null;
          return (
            <Box key={`slice-${key}`} style={{ position: 'absolute', left: r.x, top: r.y, width: Math.max(1, r.w), height: Math.max(1, r.h), overflow: 'hidden' }}>
              <Image source={url} style={{ width: Math.max(1, r.w), height: Math.max(1, r.h) }} />
            </Box>
          );
        })}
        {/* PAINT (the corrected painter, req_1288): each part's paint layer, resolved
            through the model palette, on top of everything. Colour slots = seamless
            atlas rects; material slots = a world-scaled shader fill. */}
        <Box style={{ position: 'absolute', left: 0, top: 0, width: px, height: px }}>
          {props.parts.map((part) => {
            const paint = part.paint;
            if (!paint) return null;
            const colorNodes: any[] = [];
            // material cells grouped per (face, slot) → one MaterialFill each.
            const matGroups = new Map<string, { face: number; slot: number; cells: Array<[number, number]> }>();
            for (const key in paint) {
              const sep1 = key.indexOf(':'); const sep2 = key.indexOf(':', sep1 + 1);
              const fi = Number(key.slice(0, sep1)), cu = Number(key.slice(sep1 + 1, sep2)), cv = Number(key.slice(sep2 + 1));
              const slotId = paint[key];
              const sl = slotById(props.palette, slotId);
              if (!sl) continue;
              const grid = faceCellGrid(part.mesh, fi, paintCell);
              if (!grid) continue;
              // material slots bake through the world-scaled shader — UNLESS the pseudo
              // (colourless slot) view is on, where every slot shows its flat pseudo hue.
              if (sl.kind === 'material' && !props.pseudo) {
                const gk = `${fi}:${slotId}`;
                let g = matGroups.get(gk);
                if (!g) { g = { face: fi, slot: slotId, cells: [] }; matGroups.set(gk, g); }
                g.cells.push([cu, cv]);
                continue;
              }
              const color = props.pseudo ? sl.pseudo : slotColor(props.palette, slotId);
              if (!color) continue;
              const r = cellAtlasRect(grid, cu, cv, px);
              colorNodes.push(<Box key={`${part.id}:${key}`} style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, backgroundColor: color }} />);
            }
            const matNodes = [...matGroups.values()].map((g) => {
              const grid = faceCellGrid(part.mesh, g.face, paintCell);
              const sl = slotById(props.palette, g.slot);
              if (!grid || !sl) return null;
              return <MaterialFill key={`${part.id}:m${g.face}:${g.slot}`} slot={sl} grid={grid} cells={g.cells} cell={paintCell} texels={px} />;
            });
            return <Fragment key={`paint-${part.id}`}>{colorNodes}{matNodes}</Fragment>;
          })}
        </Box>
        {islands.length === 0 && !whole ? (
          <Text fontSize={11} color="#5b6b80" style={{ position: 'absolute', left: 8, top: 8, fontFamily: 'monospace' }}>no unwrapped faces</Text>
        ) : null}
      </Box>
    </StaticSurface>
  );
}, (a, b) => a.sig === b.sig);
