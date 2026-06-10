// DecalPixelBaker.tsx — the editor-side decal pixel bake (DECALPIX-0610).
//
// WHY: a decal material is AUTHORED React content (Box/Text/Image) — unlike
// shader materials it has no WGSL recipe the compiled game can re-run, so the
// headless bake used to drop decal-skinned faces to flat color ("fat buds" /
// "NET CAFE" walls arriving as blank red boxes in `rjit game play`). V29's
// bake-by-execution answers it: the EDITOR is the one place that can render a
// DecalDoc, so the editor renders each saved decal ONCE into an offscreen
// StaticSurface, reads the pixels back (__surface_readback), and persists them
// on the material record (materials.ts `pixels`). From there the normal
// headless bake ships them in the MATERIALS lump and world_loader uploads
// them — decals arrive exactly like the other materials already do.
//
// Mounted once in the EditorShell root. Render-nothing-visible: it works
// through one offscreen capture at a time (left: -99999 — the TextureCapture
// idiom), advancing whenever the stored list changes. Staleness is the doc
// hash: saving a decal in /compose emits the store's CHANGED event, the hash
// no longer matches, and the affected record re-bakes within a second — no
// user action required, including for decals saved before this existed.

import { useEffect, useRef, useState } from 'react';
import { StaticSurface } from '@reactjit/primitives';
import { readSurfacePixels } from '@reactjit/capture';
import { saveDecalPixels, useCustomTextures, type CustomTexture } from './game/textures/materials';
import { decalDocHash, packDecalPixels } from './game/textures/decalPixels';
import { DecalSurface } from './game/textures/decalRender';

const BAKE_KEY_PREFIX = 'decal-pixbake:';
/** Longest captured side — bounds the stored payload (a 4096² doc would be
 *  64MB raw). 512 matches the wall-fit preset and reads crisp at game scale
 *  (shader materials materialize at 256). */
const MAX_CAPTURE_SIDE = 512;
/** Settle before the first readback try: lets the StaticSurface capture run
 *  and any Image nodes in the doc finish their async load. */
const SETTLE_MS = 600;
const POLL_MS = 300;
const MAX_POLLS = 20; // ~6.5s, then park the record (keyed by doc hash)

function isStale(t: CustomTexture): boolean {
  if (!t.decal) return false;
  return !t.pixels || t.pixels.docHash !== decalDocHash(t.decal);
}

function captureSize(w: number, h: number): { w: number; h: number } {
  const s = Math.min(1, MAX_CAPTURE_SIDE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

export function DecalPixelBaker() {
  const customs = useCustomTextures();
  // Records that refused to read back (no GPU, pool full, …) park under their
  // doc hash so the baker never spins on them; editing the doc retries.
  const parked = useRef<Set<string>>(new Set());
  const [, bump] = useState(0);

  const job = customs.find((t) => isStale(t) && !parked.current.has(`${t.id}:${decalDocHash(t.decal!)}`)) ?? null;
  const doc = job?.decal ?? null;

  useEffect(() => {
    if (!job || !doc) return;
    const id = job.id;
    const hash = decalDocHash(doc);
    const key = `${BAKE_KEY_PREFIX}${id}`;
    let polls = 0;
    let timer: any = null;
    const tryRead = () => {
      const pixels = readSurfacePixels(key);
      if (pixels) {
        const payload = packDecalPixels(doc, pixels.width, pixels.height, pixels.rgba);
        if (payload) {
          console.warn(`[decal-bake] ${id} baked ${pixels.width}x${pixels.height} (${payload.data.length}b stored)`);
          saveDecalPixels(id, payload); // CHANGED bus advances to the next stale record
          return;
        }
      }
      polls += 1;
      if (polls >= MAX_POLLS) {
        console.warn(`[decal-bake] ${id} did not read back after ${MAX_POLLS} tries — parked until the doc changes`);
        parked.current.add(`${id}:${hash}`);
        bump((n) => n + 1); // re-render so the find() skips the parked record
        return;
      }
      timer = setTimeout(tryRead, POLL_MS);
    };
    timer = setTimeout(tryRead, SETTLE_MS);
    return () => { if (timer) clearTimeout(timer); };
  }, [job?.id, doc]);

  if (!job || !doc) return null;
  const size = captureSize(doc.width, doc.height);
  return (
    <StaticSurface
      staticKey={`${BAKE_KEY_PREFIX}${job.id}`}
      style={{ position: 'absolute', left: -99999, top: 0, width: size.w, height: size.h }}
    >
      <DecalSurface doc={doc} width={size.w} height={size.h} />
    </StaticSurface>
  );
}
