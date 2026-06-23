// game/textures/materials.test.ts -- stored material edge contracts.
//
// The live editor can materialize a painted building face and assign it in the
// same click dispatch. Some host localstore paths do not make the just-written
// blob visible to a same-stack read, so the material module keeps a process
// overlay for writes made by this runtime.

import { assert, assertEqual, finish, test } from '../_testkit';
import {
  __resetCustomTextureSessionCacheForTests,
  loadCustomTextures,
  paintUnderlayIdForTexture,
  removeCustomTexture,
  saveCustomTexture,
} from './materials';

declare const globalThis: any;

test('same-dispatch materialize reads the just-saved custom texture even if localstore is stale', () => {
  __resetCustomTextureSessionCacheForTests();
  const prevGet = globalThis.__localstoreGet;
  const prevSet = globalThis.__localstoreSet;
  let written: string | null = null;
  let visible: string | null = null;
  globalThis.__localstoreGet = (_ns: string, key: string) => (key === 'custom-textures' ? visible : null);
  globalThis.__localstoreSet = (_ns: string, key: string, value: string) => { if (key === 'custom-textures') written = value; };
  try {
    const saved = saveCustomTexture('override back material', 'cutout-stencil', [1, 1, 1], { underlayId: 'custom:shitbrick0' });
    assertEqual(saved.id, 'custom:override-back-material', 'the paint-target label mints the observed id');
    assertEqual(saved.underlayId, 'custom:shitbrick0', 'painted stencil records the material canvas it was authored over');
    assert(loadCustomTextures().some((t) => t.id === saved.id), 'the saved id is immediately registry-visible');
    visible = written;
    assert(loadCustomTextures().some((t) => t.id === saved.id && t.underlayId === 'custom:shitbrick0'), 'the persisted blob still reads once the host catches up');
    removeCustomTexture(saved.id);
    assert(!loadCustomTextures().some((t) => t.id === saved.id), 'a removal tombstone beats a stale host read');
  } finally {
    globalThis.__localstoreGet = prevGet;
    globalThis.__localstoreSet = prevSet;
    __resetCustomTextureSessionCacheForTests();
  }
});

test('paint underlay lookup peels nested cutout stencils back to the base material', () => {
  __resetCustomTextureSessionCacheForTests();
  const prevGet = globalThis.__localstoreGet;
  const prevSet = globalThis.__localstoreSet;
  let visible: string | null = null;
  globalThis.__localstoreGet = (_ns: string, key: string) => (key === 'custom-textures' ? visible : null);
  globalThis.__localstoreSet = (_ns: string, key: string, value: string) => { if (key === 'custom-textures') visible = value; };
  try {
    const oldPaint = saveCustomTexture('painted back', 'cutout-stencil', [1, 1, 1], { underlayId: 'brickRed' });
    const newPaint = saveCustomTexture('painted back', 'cutout-stencil', [2, 2, 1], { underlayId: oldPaint.id });
    assertEqual(paintUnderlayIdForTexture(newPaint.id), 'brickRed', 'repaint opens over the original wall material, not the old overlay');
    assertEqual(paintUnderlayIdForTexture('brickRed'), 'brickRed', 'a regular material resolves to itself');
  } finally {
    globalThis.__localstoreGet = prevGet;
    globalThis.__localstoreSet = prevSet;
    __resetCustomTextureSessionCacheForTests();
  }
});

finish('game/textures/materials');
