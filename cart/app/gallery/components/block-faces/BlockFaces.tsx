// BlockFaces — pixel-grid worker portraits.
//
// Source of truth: cart/app/gallery/data/worker.ts
//
// Each face is a 16×16 grid of 1:1 cells. Specs are arrays of strings;
// one char = one palette key. Animation = swap between named frames
// (idle/blink/talk/etc), nothing tweens. Archetype + a per-seed
// generative pass (skin tone, hair color, eye color, accent, accessory)
// are derived from the worker's id/label so two workers never collide.
//
// Schedules are lifecycle-driven: streaming workers talk a lot,
// suspended workers freeze on a single frame, crashed workers cycle
// through a manic alert/blink loop.

import { useEffect, useMemo, useState } from 'react';
import { Box, Col, Row, Text } from '../../../../runtime/primitives';
import type { Worker, WorkerLifecycle } from '../../data/core/worker';
import { useAnimationsDisabled } from '../../lib/useSpring';

// ───────────────────────── PALETTE ─────────────────────────
// 1 char per key keeps the face specs readable. '.' / ' ' = transparent.
// Per-seed variation is layered on top via FaceGrid's `palette` override —
// see SKIN_TONES / HAIR_COLORS below.
const TRANSPARENT = 'theme:transparent';

const PAL: Record<string, string> = {
  '.': TRANSPARENT,
  ' ': TRANSPARENT,
  s: 'theme:inkDim',
  S: 'theme:paperInkDim',
  L: 'theme:inkDim',
  h: 'theme:rule',
  H: 'theme:inkGhost',
  w: 'theme:ink',
  i: 'theme:blue',
  I: 'theme:ok',
  p: 'theme:bg',
  m: 'theme:paperRuleBright',
  M: 'theme:accent',
  k: 'theme:rule',
  K: 'theme:bg2',
  g: 'theme:inkDimmer',
  G: 'theme:inkDim',
  W: 'theme:ink',
  r: 'theme:flag',
  o: 'theme:accent',
  y: 'theme:warn',
  c: 'theme:ok',
  b: 'theme:blue',
  l: 'theme:lilac',
  z: 'theme:paperInkDim',
  Z: 'theme:inkGhost',
  v: 'theme:inkDim',
  q: 'theme:flag',
  Q: 'theme:paperRuleBright',
  e: 'theme:inkDim',
  E: 'theme:inkDimmer',
  x: 'theme:bg',
  X: 'theme:rule',
  a: 'theme:paperInkDim',
  A: 'theme:inkDim',
  n: 'theme:inkGhost',
  N: 'theme:paperRule',
  d: 'theme:paperInkDim',
  D: 'theme:inkGhost',
  u: 'theme:inkDim',
  U: 'theme:paperInkDim',
  t: 'theme:paperInkDim',
  T: 'theme:inkGhost',
  f: 'theme:paperInkDim',
  F: 'theme:inkGhost',
  j: 'theme:warn',
  J: 'theme:paperRuleBright',
  P: 'theme:inkDim',
  V: 'theme:inkGhost',
  C: 'theme:paperInkDim',
  B: 'theme:paperInkDim',
  Y: 'theme:inkDim',
  R: 'theme:inkGhost',
};
PAL.O = PAL.W;

// Skin tones swap the s/S/L tuple per-face. Tuples kept warm so they
// stay coherent with the cockpit's paper-black palette.
const SKIN_TONES: Array<Record<string, string>> = [
  { L: 'theme:inkDim', s: 'theme:inkDim', S: 'theme:paperInkDim' }, // amber (default)
  { L: 'theme:paper', s: 'theme:inkDim', S: 'theme:inkDim' }, // light wheat
  { L: 'theme:inkDim', s: 'theme:paperInkDim', S: 'theme:paperInkDim' }, // honey
  { L: 'theme:paperInkDim', s: 'theme:paperInkDim', S: 'theme:inkGhost' }, // walnut
  { L: 'theme:paperRuleBright', s: 'theme:inkGhost', S: 'theme:paperRule' }, // espresso
];

const HAIR_COLORS: Array<Record<string, string>> = [
  { h: 'theme:rule', H: 'theme:inkGhost' }, // dark brown (default)
  { h: 'theme:bg2', H: 'theme:rule' }, // black
  { h: 'theme:paperRuleBright', H: 'theme:paperRuleBright' }, // chestnut
  { h: 'theme:accent', H: 'theme:warn' }, // blonde
  { h: 'theme:paperRuleBright', H: 'theme:flag' }, // auburn
  { h: 'theme:inkDimmer', H: 'theme:inkDim' }, // gray
];

// ───────────────────────── FRAMES ─────────────────────────
type Frame = string[];
type FrameMap = Record<string, Frame>;

const FACE_PAD = '................';
function fitFaceRow(s: string): string {
  return (s + FACE_PAD).slice(0, 16);
}

function withRows(base: Frame, rows: Record<number, string>): Frame {
  const next = base.slice();
  for (const k of Object.keys(rows)) {
    const yi = parseInt(k, 10);
    next[yi] = fitFaceRow(rows[yi]);
  }
  return next;
}

const HUMAN: FrameMap = {
  idle: [
    '................',
    '.....hhhhhh.....',
    '....hhhhhhhh....',
    '...hhsssssshh...',
    '..hhssssssssH...',
    '..hsssssssssH...',
    '..ss.ww.ww..S...',
    '..ssLwiwwiwSS...',
    '..sss.w..wssS...',
    '..ssssssssssS...',
    '...sssmmmmsS....',
    '...sssmmmmsS....',
    '....sssssssS....',
    '.....ssssss.....',
    '................',
    '................',
  ],
  blink: [
    '................',
    '.....hhhhhh.....',
    '....hhhhhhhh....',
    '...hhsssssshh...',
    '..hhssssssssH...',
    '..hsssssssssH...',
    '..ss........S...',
    '..ssLpppppsSS...',
    '..sss........S..',
    '..ssssssssssS...',
    '...sssmmmmsS....',
    '...sssmmmmsS....',
    '....sssssssS....',
    '.....ssssss.....',
    '................',
    '................',
  ],
  talk: [
    '................',
    '.....hhhhhh.....',
    '....hhhhhhhh....',
    '...hhsssssshh...',
    '..hhssssssssH...',
    '..hsssssssssH...',
    '..ss.ww.ww..S...',
    '..ssLwiwwiwSS...',
    '..sss.w..wssS...',
    '..ssssssssssS...',
    '...sssMMMMsS....',
    '...sspppppsS....',
    '...sssMMMMsS....',
    '....sssssssS....',
    '................',
    '................',
  ],
  smile: [
    '................',
    '.....hhhhhh.....',
    '....hhhhhhhh....',
    '...hhsssssshh...',
    '..hhssssssssH...',
    '..hsssssssssH...',
    '..ss.ww.ww..S...',
    '..ssLwiwwiwSS...',
    '..sss.w..wssS...',
    '..ssssssssssS...',
    '...sssWWWWsS....',
    '...sspmmmmpS....',
    '....smmmmmS.....',
    '.....ssssss.....',
    '................',
    '................',
  ],
};

const HUMAN_FEM: FrameMap = {
  idle: [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '..hhhsssssshhh..',
    '..hhssssssssHh..',
    '..hsssssssssHh..',
    '..hs.ww.ww..Sh..',
    '..hsLwiwwiwSSh..',
    '..hss.w..wssSh..',
    '..hsssssssssSh..',
    '...hssMMMMssSh..',
    '...hssMMMMssSh..',
    '....hsssssssh...',
    '.....hssssh.....',
    '................',
    '................',
  ],
  blink: [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '..hhhsssssshhh..',
    '..hhssssssssHh..',
    '..hsssssssssHh..',
    '..hs........Sh..',
    '..hsLpppppsSSh..',
    '..hss........Sh.',
    '..hsssssssssSh..',
    '...hssMMMMssSh..',
    '...hssMMMMssSh..',
    '....hsssssssh...',
    '.....hssssh.....',
    '................',
    '................',
  ],
  talk: [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '..hhhsssssshhh..',
    '..hhssssssssHh..',
    '..hsssssssssHh..',
    '..hs.ww.ww..Sh..',
    '..hsLwiwwiwSSh..',
    '..hss.w..wssSh..',
    '..hsssssssssSh..',
    '...hssMMMMssSh..',
    '...hsspppppSh...',
    '....hssMMMMSh...',
    '.....hssssh.....',
    '................',
    '................',
  ],
  smile: [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '..hhhsssssshhh..',
    '..hhssssssssHh..',
    '..hsssssssssHh..',
    '..hs.ww.ww..Sh..',
    '..hsLwiwwiwSSh..',
    '..hss.w..wssSh..',
    '..hsssssssssSh..',
    '...hssWWWWssSh..',
    '...hsMmmmmMSh...',
    '....hssMMMSh....',
    '.....hssssh.....',
    '................',
    '................',
  ],
};

const ROBOT: FrameMap = {
  idle: [
    '................',
    '......gggg......',
    '.....gKKKKg.....',
    '....gKKKKKKg....',
    '...kKKKKKKKKk...',
    '...kKWKKKKWKk...',
    '...kKbWKKWbKk...',
    '...kKKKKKKKKk...',
    '...kKKWWWWKKk...',
    '...kKKKKKKKKk...',
    '....kkkkkkkk....',
    '....g......g....',
    '....g.GGGG.g....',
    '....g......g....',
    '.....gggggg.....',
    '................',
  ],
  blink: [
    '................',
    '......gggg......',
    '.....gKKKKg.....',
    '....gKKKKKKg....',
    '...kKKKKKKKKk...',
    '...kKKKKKKKKk...',
    '...kKkKKKKkKk...',
    '...kKKKKKKKKk...',
    '...kKKWWWWKKk...',
    '...kKKKKKKKKk...',
    '....kkkkkkkk....',
    '....g......g....',
    '....g.GGGG.g....',
    '....g......g....',
    '.....gggggg.....',
    '................',
  ],
  talk: [
    '................',
    '......gggg......',
    '.....gKKKKg.....',
    '....gKKKKKKg....',
    '...kKKKKKKKKk...',
    '...kKWKKKKWKk...',
    '...kKbWKKWbKk...',
    '...kKKKKKKKKk...',
    '...kKKoooo.KKk..',
    '...kKKKKKKKKk...',
    '....kkkkkkkk....',
    '....g......g....',
    '....g.oooo.g....',
    '....g......g....',
    '.....gggggg.....',
    '................',
  ],
  alert: [
    '................',
    '......gggg......',
    '.....gKKKKg.....',
    '....gKKKKKKg....',
    '...kKKKKKKKKk...',
    '...kKrKKKKrKk...',
    '...kKrWKKWrKk...',
    '...kKKKKKKKKk...',
    '...kKKWWWWKKk...',
    '...kKKKKKKKKk...',
    '....kkkkkkkk....',
    '....g......g....',
    '....g.rrrr.g....',
    '....g......g....',
    '.....gggggg.....',
    '................',
  ],
};

const ZOMBIE: FrameMap = {
  idle: [
    '.....hHHh.......',
    '....hHqQqHh.....',
    '...hHqqQqqHh....',
    '..hHHzzqzzHHh...',
    '..hzzzzzzzzZH...',
    '..hzzzzzzzzZH...',
    '..zz.ww.....Z...',
    '..zzLwpw.cw.Z...',
    '..zzz........Z..',
    '..zzzzzzzzzzZ...',
    '...zzmmmZmmZZ...',
    '...zzZZmmZZzZ...',
    '....zzzzzzzZ....',
    '.....zzzzzz.....',
    '................',
    '................',
  ],
  blink: [
    '.....hHHh.......',
    '....hHqQqHh.....',
    '...hHqqQqqHh....',
    '..hHHzzqzzHHh...',
    '..hzzzzzzzzZH...',
    '..hzzzzzzzzZH...',
    '..zz........Z...',
    '..zzZZZZZZZ.Z...',
    '..zzz........Z..',
    '..zzzzzzzzzzZ...',
    '...zzmmmZmmZZ...',
    '...zzZZmmZZzZ...',
    '....zzzzzzzZ....',
    '.....zzzzzz.....',
    '................',
    '................',
  ],
  brain: [
    '.....hHHh.......',
    '....hHQqQHh.....',
    '...hHqQQQqHh....',
    '..hHHzzQzzHHh...',
    '..hzzzzzzzzZH...',
    '..hzzzzzzzzZH...',
    '..zz.ww.....Z...',
    '..zzLwpw.cw.Z...',
    '..zzz........Z..',
    '..zzzzzzzzzzZ...',
    '...zzmmmZmmZZ...',
    '...zzZZmmZZzZ...',
    '....zzzzzzzZ....',
    '.....zzzzzz.....',
    '................',
    '................',
  ],
};

const CYCLOPS: FrameMap = {
  idle: [
    '................',
    '......hhhh......',
    '.....hhhhhh.....',
    '....hhssssh.....',
    '...hhsssssH.....',
    '...hsssssssH....',
    '...sssssssssS...',
    '...sswwwwwwsS...',
    '...sswiiiiwsS...',
    '...sswipppwsS...',
    '...sswwwwwwsS...',
    '....sssssssS....',
    '....ssmmmmsS....',
    '.....sssssS.....',
    '......sssS......',
    '................',
  ],
  blink: [
    '................',
    '......hhhh......',
    '.....hhhhhh.....',
    '....hhssssh.....',
    '...hhsssssH.....',
    '...hsssssssH....',
    '...sssssssssS...',
    '...sssssssssS...',
    '...sshhhhhhsS...',
    '...sssssssssS...',
    '...sssssssssS...',
    '....sssssssS....',
    '....ssmmmmsS....',
    '.....sssssS.....',
    '......sssS......',
    '................',
  ],
  talk: [
    '................',
    '......hhhh......',
    '.....hhhhhh.....',
    '....hhssssh.....',
    '...hhsssssH.....',
    '...hsssssssH....',
    '...sssssssssS...',
    '...sswwwwwwsS...',
    '...sswiiiiwsS...',
    '...sswipppwsS...',
    '...sswwwwwwsS...',
    '....sssssssS....',
    '....ssMMMMsS....',
    '.....sspppS.....',
    '......sMMS......',
    '................',
  ],
};

const GHOST: FrameMap = {
  idle: [
    '................',
    '....EEEEEEE.....',
    '...EeeeeeeeE....',
    '..EeeeeeeeeeE...',
    '.EeeeeeeeeeeE...',
    '.Eeepeeepeeee...',
    '.Eeepeeepeeee...',
    '.Eeeeeeeeeeee...',
    '.Eeeemmmmeeee...',
    '.Eeeeeeeeeeee...',
    '.Eeeeeeeeeeee...',
    '.EeeeeeeeeeeE...',
    '.EeeeeeeeeeeE...',
    '.EeeEeEEeEeeE...',
    '..E.E.E.E.E.E...',
    '................',
  ],
  blink: [
    '................',
    '....EEEEEEE.....',
    '...EeeeeeeeE....',
    '..EeeeeeeeeeE...',
    '.EeeeeeeeeeeE...',
    '.Eeeeeeeeeeee...',
    '.EeeEEEEEEEee...',
    '.Eeeeeeeeeeee...',
    '.Eeeemmmmeeee...',
    '.Eeeeeeeeeeee...',
    '.Eeeeeeeeeeee...',
    '.EeeeeeeeeeeE...',
    '.EeeeeeeeeeeE...',
    '.EeeEeEEeEeeE...',
    '..E.E.E.E.E.E...',
    '................',
  ],
  wisp: [
    '................',
    '....EEEEEEE.....',
    '...EeeeeeeeE....',
    '..EeeeeeeeeeE...',
    '.EeeeeeeeeeeE...',
    '.Eeepeeepeeee...',
    '.Eeepeeepeeee...',
    '.Eeeeeeeeeeee...',
    '.EeeOMMMMOeee...',
    '.Eeeeeeeeeeee...',
    '.Eeeeeeeeeeee...',
    '.EeeeeeeeeeeE...',
    '..eeeeeeeeee....',
    '...EeEeEeEeE....',
    '...e.E.E.E.e....',
    '................',
  ],
};

const VISOR: FrameMap = {
  idle: [
    '................',
    '......hhhh......',
    '.....hhhhhh.....',
    '....hhssssH.....',
    '...hsssssssH....',
    '...kkkkkkkkk....',
    '...kbbbbbbbbk...',
    '...kbWbbbbWbk...',
    '...kkkkkkkkk....',
    '...sssssssssS...',
    '....ssssssssS...',
    '....sssmmsssS...',
    '....ssssssss....',
    '.....ssssss.....',
    '................',
    '................',
  ],
  blink: [
    '................',
    '......hhhh......',
    '.....hhhhhh.....',
    '....hhssssH.....',
    '...hsssssssH....',
    '...kkkkkkkkk....',
    '...kKKKKKKKKk...',
    '...kKKKKKKKKk...',
    '...kkkkkkkkk....',
    '...sssssssssS...',
    '....ssssssssS...',
    '....sssmmsssS...',
    '....ssssssss....',
    '.....ssssss.....',
    '................',
    '................',
  ],
  scan: [
    '................',
    '......hhhh......',
    '.....hhhhhh.....',
    '....hhssssH.....',
    '...hsssssssH....',
    '...kkkkkkkkk....',
    '...koooooooKk...',
    '...kKoooooo.k...',
    '...kkkkkkkkk....',
    '...sssssssssS...',
    '....ssssssssS...',
    '....sssmmsssS...',
    '....ssssssss....',
    '.....ssssss.....',
    '................',
    '................',
  ],
};

const SKULL: FrameMap = {
  idle: [
    '................',
    '....xxxxxxx.....',
    '...xWWWWWWWx....',
    '..xWWWWWWWWWx...',
    '..xWWWWWWWWWx...',
    '..xWxxWWxxWWx...',
    '..xWxpxWxpxWx...',
    '..xWxxWWxxWWx...',
    '..xWWWxWxWWWx...',
    '..xWWWxxxWWWx...',
    '...xWxWxWxWx....',
    '...xWxWxWxWx....',
    '....xxxxxxx.....',
    '................',
    '................',
    '................',
  ],
  blink: [
    '................',
    '....xxxxxxx.....',
    '...xWWWWWWWx....',
    '..xWWWWWWWWWx...',
    '..xWWWWWWWWWx...',
    '..xWWWWWWWWWx...',
    '..xWxxxWxxxWx...',
    '..xWWWWWWWWWx...',
    '..xWWWxWxWWWx...',
    '..xWWWxxxWWWx...',
    '...xWxWxWxWx....',
    '...xWxWxWxWx....',
    '....xxxxxxx.....',
    '................',
    '................',
    '................',
  ],
  fire: [
    '................',
    '....xxxxxxx.....',
    '...xWWWWWWWx....',
    '..xWWWWWWWWWx...',
    '..xWWWWWWWWWx...',
    '..xWxxWWxxWWx...',
    '..xWxoxWxoxWx...',
    '..xWxoxWxoxWx...',
    '..xWWWxWxWWWx...',
    '..xWWWxxxWWWx...',
    '...xWxWxWxWx....',
    '...xWxWxWxWx....',
    '....xxxxxxx.....',
    '................',
    '................',
    '................',
  ],
};

const BLOCK_BUILDER_IDLE: Frame = [
  '................',
  '....HHHHHHHH....',
  '...HHHHHHHHHH...',
  '..HHuuuuuuUUH...',
  '..HuuuuuuuuUH...',
  '..Huu.WW.WW.U...',
  '..HuuBppBppU...',
  '..Huu.WW.WW.U...',
  '..HuuuuuuuuU...',
  '..HuuDDDDuuU...',
  '..HuuDTTDuuU...',
  '...UuDDDDuU....',
  '....Uuuuuu.....',
  '.....CCCC......',
  '....CFFFFC.....',
  '................',
].map(fitFaceRow);

const BLOCK_BUILDER: FrameMap = {
  idle: BLOCK_BUILDER_IDLE,
  blink: withRows(BLOCK_BUILDER_IDLE, {
    5: '..Huu......U...',
    6: '..HuuKKKKKKU...',
    7: '..Huu......U...',
  }),
  talk: withRows(BLOCK_BUILDER_IDLE, {
    10: '..HuuDMMDDuU...',
    11: '...UuKMMKuU....',
  }),
};

const GREEN_HISSER_IDLE: Frame = [
  '................',
  '..NNNNNNNNNNNN..',
  '..NaaaaaaaaaaN..',
  '..NaAaAaAaAaN..',
  '..NaaaaaaaaaaN..',
  '..NaaKKaaKKaaN..',
  '..NaaKKaaKKaaN..',
  '..NaaaaaaaaaaN..',
  '..NaaaaKKaaaaN..',
  '..NaaaKKKKaaaN..',
  '..NaaKKKKKKaaN..',
  '..NaaKKaaKKaaN..',
  '..NaaaaaaaaaaN..',
  '..NNNNNNNNNNNN..',
  '................',
  '................',
].map(fitFaceRow);

const GREEN_HISSER: FrameMap = {
  idle: GREEN_HISSER_IDLE,
  blink: withRows(GREEN_HISSER_IDLE, {
    5: '..NaaNNaaNNaaN..',
    6: '..NaaNNaaNNaaN..',
  }),
  hiss: withRows(GREEN_HISSER_IDLE, {
    8: '..NaaaKKKaaaN...',
    9: '..NaaKKKKKaaN...',
    10: '..NaKKKKKKKaN...',
    11: '..NaKKa aKKaN...',
  }),
};

const VOID_WALKER_IDLE: Frame = [
  '................',
  '....KKKKKKKK....',
  '...KggggggggK...',
  '..KggggggggggK..',
  '..KgggEggEgggK..',
  '..KggCCggCCggK..',
  '..KgCWWggWWCgK..',
  '..KggCCggCCggK..',
  '..KggggggggggK..',
  '..KggggKKggggK..',
  '..KgggKggKgggK..',
  '..KggggggggggK..',
  '...KggggggggK...',
  '....KKKKKKKK....',
  '................',
  '................',
].map(fitFaceRow);

const VOID_WALKER: FrameMap = {
  idle: VOID_WALKER_IDLE,
  blink: withRows(VOID_WALKER_IDLE, {
    5: '..KggggggggggK..',
    6: '..KggCCggCCggK..',
    7: '..KggggggggggK..',
  }),
  stare: withRows(VOID_WALKER_IDLE, {
    5: '..KgCCCggCCCgK..',
    6: '..KgCWWggWWCgK..',
    7: '..KgCCCggCCCgK..',
  }),
};

const PANDA_IDLE: Frame = [
  '................',
  '...KKK....KKK...',
  '..KKKWWWWWWKKK..',
  '..KWWWWWWWWWWK..',
  '.KWWWWWWWWWWWWK.',
  '.KWWKKWWWWKKWWK.',
  '.KWWKpWWWWpKWWK.',
  '.KWWKKWWWWKKWWK.',
  '.KWWWWKKKKWWWWK.',
  '.KWWWWKPPKWWWWK.',
  '..KWWWKPPKWWWK..',
  '..KWWWWKKWWWWK..',
  '...KWWWWWWWWK...',
  '....KKWWWWKK....',
  '................',
  '................',
].map(fitFaceRow);

const PANDA: FrameMap = {
  idle: PANDA_IDLE,
  blink: withRows(PANDA_IDLE, {
    5: '.KWWKKWWWWKKWWK.',
    6: '.KWWKKKKKKKKWWK.',
    7: '.KWWKKWWWWKKWWK.',
  }),
  chew: withRows(PANDA_IDLE, {
    9: '.KWWWWKMMKWWWWK.',
    10: '..KWWWKMMKWWWK..',
  }),
};

const BEAR_IDLE: Frame = [
  '................',
  '...DD......DD...',
  '..DDddddddddDD..',
  '..DddddddddddD..',
  '.DddddddddddddD.',
  '.DddWWddddWWddD.',
  '.DddWpd ddpWddD.',
  '.DddWWddddWWddD.',
  '.DddddddddddddD.',
  '.DddddueeuddddD.',
  '.Dddddepp edddD.',
  '..DddddMMddddD..',
  '..DDddddddddDD..',
  '....DDddddDD....',
  '................',
  '................',
].map(fitFaceRow);

const BEAR: FrameMap = {
  idle: BEAR_IDLE,
  blink: withRows(BEAR_IDLE, {
    5: '.DddddddddddddD.',
    6: '.DddKKddddKKddD.',
    7: '.DddddddddddddD.',
  }),
  growl: withRows(BEAR_IDLE, {
    10: '.DddddKMMKddddD.',
    11: '..DdddKMMKdddD..',
  }),
};

const CAT_IDLE: Frame = [
  '................',
  '...J......J.....',
  '..JJJ....JJJ....',
  '..JJJJJJJJJJ....',
  '.JJJJJJJJJJJJ...',
  '.JJJWWJJWWJJJ...',
  '.JJJWppppWJJJ...',
  '.JJJWWJJWWJJJ...',
  '.JWWJJuuJJWWJ...',
  '.J..JJu uJJ..J..',
  '.JWWJJMMJJWWJ...',
  '..JJJJJJJJJJ....',
  '...JJJJJJJJ.....',
  '....JJ..JJ......',
  '................',
  '................',
].map(fitFaceRow);

const CAT: FrameMap = {
  idle: CAT_IDLE,
  blink: withRows(CAT_IDLE, {
    5: '.JJJJJJJJJJJJ...',
    6: '.JJJKKJJKKJJJ...',
    7: '.JJJJJJJJJJJJ...',
  }),
  meow: withRows(CAT_IDLE, {
    10: '.JWWJJMMJJWWJ...',
    11: '..JJJJMMMMJJ....',
  }),
};

const DOG_IDLE: Frame = [
  '................',
  '..DD........DD..',
  '..DDDddddddDDD..',
  '..DddddddddddD..',
  '.DddddddddddddD.',
  '.DddWWddddWWddD.',
  '.DddWpd ddpWddD.',
  '.DddWWddddWWddD.',
  '.DddduuuuuudddD.',
  '.DddduKKKuudddD.',
  '.DdddummmuddddD.',
  '..DdddMMMddddD..',
  '..DDddddddddDD..',
  '....DDddddDD....',
  '................',
  '................',
].map(fitFaceRow);

const DOG: FrameMap = {
  idle: DOG_IDLE,
  blink: withRows(DOG_IDLE, {
    5: '.DddddddddddddD.',
    6: '.DddKKddddKKddD.',
    7: '.DddddddddddddD.',
  }),
  bark: withRows(DOG_IDLE, {
    10: '.DddduKMMuudddD.',
    11: '..DdddKMMddddD..',
  }),
};

const PARROT_IDLE: Frame = [
  '................',
  '....RRRRRR......',
  '...RRRRRRRR.....',
  '..RRRRRRRRRR....',
  '..RRRYYYYRRR....',
  '..RRWWRRWWRR....',
  '..RRWppppWRR....',
  '..RRWWRRWWRR....',
  '..RRRRYYRRRR....',
  '..RRRYYYYRRR....',
  '..RRCCBBCCRR....',
  '...RCCBBCCR.....',
  '....CCBBCC......',
  '.....CBB C......',
  '................',
  '................',
].map(fitFaceRow);

const PARROT: FrameMap = {
  idle: PARROT_IDLE,
  blink: withRows(PARROT_IDLE, {
    5: '..RRRRRRRRRR....',
    6: '..RRRKKKKRRR....',
    7: '..RRRRRRRRRR....',
  }),
  squawk: withRows(PARROT_IDLE, {
    8: '..RRRRYMMYRR....',
    9: '..RRRYYMMYRR....',
  }),
};

const BIRD_IDLE: Frame = [
  '................',
  '.....YYYYYY.....',
  '....YYYYYYYY....',
  '...YYYYYYYYYY...',
  '..YYYYYYYYYYYY..',
  '..YYWWYYYYWWYY..',
  '..YYWpYYYYpWYY..',
  '..YYWWYYYYWWYY..',
  '..YYYYJJYYYYYY..',
  '..YYYJJJJYYYYY..',
  '..YYYYJJYYYYYY..',
  '...YYYYYYYYYY...',
  '....YYYYYYYY....',
  '.....YYYYYY.....',
  '................',
  '................',
].map(fitFaceRow);

const BIRD: FrameMap = {
  idle: BIRD_IDLE,
  blink: withRows(BIRD_IDLE, {
    5: '..YYYYYYYYYYYY..',
    6: '..YYYKKYYKKYYY..',
    7: '..YYYYYYYYYYYY..',
  }),
  chirp: withRows(BIRD_IDLE, {
    8: '..YYYYJMMJYYYY..',
    9: '..YYYJJMMJJYYY..',
  }),
};

const SKELETON_IDLE: Frame = [
  '................',
  '...xxxxxxxxxx...',
  '..xWWWWWWWWWWx..',
  '..xWWWWWWWWWWx..',
  '..xWWWWWWWWWWx..',
  '..xWWKKWWKKWWx..',
  '..xWWKpWWpKWWx..',
  '..xWWKKWWKKWWx..',
  '..xWWWWxWWWWWx..',
  '..xWWWxxxWWWWx..',
  '..xWWxWxWxWWWx..',
  '..xWWxWxWxWWWx..',
  '...xxxxxxxxxx...',
  '....gWWWWg.....',
  '................',
  '................',
].map(fitFaceRow);

const SKELETON: FrameMap = {
  idle: SKELETON_IDLE,
  blink: withRows(SKELETON_IDLE, {
    5: '..xWWWWWWWWWWx..',
    6: '..xWWKKKKKKWWx..',
    7: '..xWWWWWWWWWWx..',
  }),
  rattle: withRows(SKELETON_IDLE, {
    10: '..xWWxMxMxWWWx..',
    11: '..xWWxMxMxWWWx..',
  }),
};

const WITCH_IDLE: Frame = [
  '......KK........',
  '.....KKKK.......',
  '....KKKKKK......',
  '...KKKKKKKKK....',
  '..KKKVVVVKKKK...',
  '...KnnnnnnK.....',
  '..KnnWWnnWWK....',
  '..KnnWppnpWK....',
  '..KnnWWnnWWK....',
  '..KnnnnNNnnK....',
  '..KnnnNNNNnK....',
  '..KnnnmmmmnK....',
  '...KnnnnnnK.....',
  '....KKnnKK......',
  '................',
  '................',
].map(fitFaceRow);

const WITCH: FrameMap = {
  idle: WITCH_IDLE,
  blink: withRows(WITCH_IDLE, {
    6: '..KnnKKnnKKK....',
    7: '..KnnKKnnKKK....',
    8: '..KnnnnnnnnK....',
  }),
  cackle: withRows(WITCH_IDLE, {
    11: '..KnnnMMMMnK....',
    12: '...KnnKMMK......',
  }),
};

const ITALIAN_MAN_IDLE: Frame = [
  '................',
  '....TTTTTTTT....',
  '...TttttttttT...',
  '..TTTTTTTTTTTT..',
  '..DuuuuuuuUD....',
  '..DuuWWuWWUD....',
  '..DuuBppBpUD....',
  '..DuuWWuWWUD....',
  '..DuuuUUuuUD....',
  '..DuuKKKKuUD....',
  '..DuuKMMKuUD....',
  '...DuuKKuUD.....',
  '....Uuuuuu......',
  '....BBttBB......',
  '...BBBttBBB.....',
  '................',
].map(fitFaceRow);

const ITALIAN_MAN: FrameMap = {
  idle: ITALIAN_MAN_IDLE,
  blink: withRows(ITALIAN_MAN_IDLE, {
    5: '..DuuuuuuuUD....',
    6: '..DuuKKKKuUD....',
    7: '..DuuuuuuuUD....',
  }),
  shout: withRows(ITALIAN_MAN_IDLE, {
    10: '..DuuKMMKuUD....',
    11: '...DuuKMMUD.....',
  }),
};

const WEB_HERO_IDLE: Frame = [
  '................',
  '....TTTTTTTT....',
  '...TtTtTtTtT....',
  '..TtttttttttT...',
  '..TtKttttKtT....',
  '..TtKWWWWKtT....',
  '..TtKWWWWKtT....',
  '..TttKKKKttT....',
  '..TtttKKtttT....',
  '..TtKttttKtT....',
  '..TttKKKKttT....',
  '...TttttttT.....',
  '....TTTTTT......',
  '................',
  '................',
  '................',
].map(fitFaceRow);

const WEB_HERO: FrameMap = {
  idle: WEB_HERO_IDLE,
  blink: withRows(WEB_HERO_IDLE, {
    5: '..TtKttttKtT....',
    6: '..TtKKKKKKtT....',
    7: '..TttKKKKttT....',
  }),
  web: withRows(WEB_HERO_IDLE, {
    8: '..TtKtKKtKtT....',
    9: '..TttKttKttT....',
  }),
};

const NIGHT_COWL_IDLE: Frame = [
  '...g........g...',
  '..ggg......ggg..',
  '..gggggggggggg..',
  '.gggGggggggGggg.',
  '.gggggggggggggg.',
  '.gggyyggggyyggg.',
  '.gggyKggggKyggg.',
  '.gggyyggggyyggg.',
  '.gggggggggggggg.',
  '.ggguuuuuuuuggg.',
  '.gguuuKMMKuuugg.',
  '..gguuuuuuuugg..',
  '...gggggggggg...',
  '....gggggggg....',
  '................',
  '................',
].map(fitFaceRow);

const NIGHT_COWL: FrameMap = {
  idle: NIGHT_COWL_IDLE,
  blink: withRows(NIGHT_COWL_IDLE, {
    5: '.gggggggggggggg.',
    6: '.gggyyyyyyyyggg.',
    7: '.gggggggggggggg.',
  }),
  scowl: withRows(NIGHT_COWL_IDLE, {
    9: '.ggguuGGGGuuggg.',
    10: '.gguuuKTTKuuugg.',
  }),
};

const METAL_BRO_IDLE: Frame = [
  '................',
  '....RRRRRRRR....',
  '...RRRRRRRRRR...',
  '..RRYRYYYYRYRR..',
  '..RYYYYYYYYYYR..',
  '..RYCCYYYYCCYR..',
  '..RYCWCYYCWCYR..',
  '..RYCCYYYYCCYR..',
  '..RYYYYYYYYYYR..',
  '..RYYYRRRRYYYR..',
  '..RYYRYYYYRYYR..',
  '...RYYYYYYYYR...',
  '....RRRRRRRR....',
  '.....RRRRRR.....',
  '................',
  '................',
].map(fitFaceRow);

const METAL_BRO: FrameMap = {
  idle: METAL_BRO_IDLE,
  blink: withRows(METAL_BRO_IDLE, {
    5: '..RYYYYYYYYYYR..',
    6: '..RYYCCCCCCYYR..',
    7: '..RYYYYYYYYYYR..',
  }),
  repulsor: withRows(METAL_BRO_IDLE, {
    5: '..RYWWYYYYWWYR..',
    6: '..RYWCWYYCWCYR..',
    7: '..RYWWYYYYWWYR..',
  }),
};

const GRINNING_MASK_IDLE: Frame = [
  '................',
  '....KKKKKKKK....',
  '...KWWWWWWWWK...',
  '..KWWWWWWWWWWK..',
  '..KWWWWWWWWWWK..',
  '..KWWWWWWWWWWK..',
  '..KWWKpWWpKWWK..',
  '..KWWWWWWWWWWK..',
  '..KWWPWWWWPWWK..',
  '..KWWWKWWKWWWK..',
  '..KWWKMMMMKWWK..',
  '..KWWWKMMKWWWK..',
  '...KWWKKKKWWK...',
  '....KKKKKKKK....',
  '................',
  '................',
].map(fitFaceRow);

const GRINNING_MASK: FrameMap = {
  idle: GRINNING_MASK_IDLE,
  blink: withRows(GRINNING_MASK_IDLE, {
    6: '..KWWKKWWKKWWK..',
  }),
  grin: withRows(GRINNING_MASK_IDLE, {
    10: '..KWWKWWWWKWWK..',
    11: '..KWWKKKKKKWWK..',
  }),
};

const GREEN_FROG_IDLE: Frame = [
  '................',
  '....nnnnnnnn....',
  '...nAAAAAAAA n..',
  '..nAAAAAAAAAAn..',
  '..nAAWWAAWWAAn..',
  '..nAWppAAppWAn..',
  '..nAAWWAAWWAAn..',
  '..nAAAAAAAAAAn..',
  '..nAAAANAAAAAn..',
  '..nAAANNNAAAAn..',
  '..nAAMMMMMMAAn..',
  '..nAAMmmmmMAAn..',
  '...nAAAAAAAA n..',
  '....nnnnnnnn....',
  '................',
  '................',
].map(fitFaceRow);

const GREEN_FROG: FrameMap = {
  idle: GREEN_FROG_IDLE,
  blink: withRows(GREEN_FROG_IDLE, {
    4: '..nAAAAAAAAAAn..',
    5: '..nAAKKAAKKAAn..',
    6: '..nAAAAAAAAAAn..',
  }),
  croak: withRows(GREEN_FROG_IDLE, {
    10: '..nAAMMMMMMAAn..',
    11: '..nAAMMMMMMAAn..',
  }),
};

const ROBED_TEACHER_IDLE: Frame = [
  '................',
  '...HHHHHHHHHH...',
  '..HHHHHHHHHHHH..',
  '..HHuuuuuuuuHH..',
  '.HHuuuuuuuuuuHH.',
  '.HHuuWWuuWWuuHH.',
  '.HHuuBppBpUuHH.',
  '.HHuuWWuuWWuuHH.',
  '.HHuuuuuuuuuuHH.',
  '.HHuuDDDDuuuuHH.',
  '.HHuDmmmmDuuuHH.',
  '..HHDDDDDDDDHH..',
  '..HHHDDDDDDHHH..',
  '...HHHDDDDHHH...',
  '....HHHDDHH....',
  '................',
].map(fitFaceRow);

const ROBED_TEACHER: FrameMap = {
  idle: ROBED_TEACHER_IDLE,
  blink: withRows(ROBED_TEACHER_IDLE, {
    5: '.HHuuuuuuuuuuHH.',
    6: '.HHuuKKKKKuuHH..',
    7: '.HHuuuuuuuuuuHH.',
  }),
  speak: withRows(ROBED_TEACHER_IDLE, {
    10: '.HHuDMMMMDuuuHH.',
    11: '..HHDDMMMMDDHH..',
  }),
};

// ───────────────────────── ARCHETYPES ─────────────────────────
export type ArchetypeKey =
  | 'human'
  | 'humanFem'
  | 'robot'
  | 'zombie'
  | 'cyclops'
  | 'ghost'
  | 'visor'
  | 'skull'
  | 'blockBuilder'
  | 'greenHisser'
  | 'voidWalker'
  | 'panda'
  | 'bear'
  | 'cat'
  | 'dog'
  | 'parrot'
  | 'bird'
  | 'skeleton'
  | 'witch'
  | 'italianMan'
  | 'webHero'
  | 'nightCowl'
  | 'metalBro'
  | 'grinningMask'
  | 'greenFrog'
  | 'robedTeacher';

type ArchetypeSpec = { frames: FrameMap; label: string; glow: string | null };

const ARCHETYPES: Record<ArchetypeKey, ArchetypeSpec> = {
  human:    { frames: HUMAN,    label: 'human',    glow: null },
  humanFem: { frames: HUMAN_FEM, label: 'humanFem', glow: null },
  robot:    { frames: ROBOT,    label: 'robot',    glow: 'theme:blue' },
  zombie:   { frames: ZOMBIE,   label: 'zombie',   glow: 'theme:paperInkDim' },
  cyclops:  { frames: CYCLOPS,  label: 'cyclops',  glow: null },
  ghost:    { frames: GHOST,    label: 'ghost',    glow: 'theme:inkDimmer' },
  visor:    { frames: VISOR,    label: 'visor',    glow: null },
  skull:    { frames: SKULL,    label: 'skull',    glow: 'theme:flag' },
  blockBuilder:     { frames: BLOCK_BUILDER,     label: 'blockBuilder',     glow: null },
  greenHisser:   { frames: GREEN_HISSER,   label: 'greenHisser',   glow: 'theme:pin' },
  voidWalker:  { frames: VOID_WALKER,  label: 'voidWalker',  glow: 'theme:lilac' },
  panda:     { frames: PANDA,     label: 'panda',     glow: null },
  bear:      { frames: BEAR,      label: 'bear',      glow: null },
  cat:       { frames: CAT,       label: 'cat',       glow: 'theme:accent' },
  dog:       { frames: DOG,       label: 'dog',       glow: null },
  parrot:    { frames: PARROT,    label: 'parrot',    glow: 'theme:flag' },
  bird:      { frames: BIRD,      label: 'bird',      glow: 'theme:warn' },
  skeleton:  { frames: SKELETON,  label: 'skeleton',  glow: null },
  witch:     { frames: WITCH,     label: 'witch',     glow: 'theme:inkGhost' },
  italianMan:     { frames: ITALIAN_MAN,     label: 'italianMan',     glow: 'theme:flag' },
  webHero: { frames: WEB_HERO, label: 'webHero', glow: 'theme:flag' },
  nightCowl:    { frames: NIGHT_COWL,    label: 'nightCowl',    glow: null },
  metalBro:   { frames: METAL_BRO,   label: 'metalBro',   glow: 'theme:ok' },
  grinningMask: { frames: GRINNING_MASK, label: 'grinningMask', glow: null },
  greenFrog:      { frames: GREEN_FROG,      label: 'greenFrog',      glow: 'theme:pin' },
  robedTeacher:     { frames: ROBED_TEACHER,     label: 'robedTeacher',     glow: null },
};

const ARCHETYPE_KEYS: ArchetypeKey[] = [
  'human', 'humanFem', 'robot', 'zombie', 'cyclops', 'ghost', 'visor', 'skull',
  'blockBuilder', 'greenHisser', 'voidWalker', 'panda', 'bear', 'cat', 'dog', 'parrot', 'bird',
  'skeleton', 'witch', 'italianMan', 'webHero', 'nightCowl', 'metalBro', 'grinningMask',
  'greenFrog', 'robedTeacher',
];

// Archetypes that have a recognizable face — get skin/hair/accessory mutations.
const HUMAN_FACED: ReadonlySet<ArchetypeKey> = new Set<ArchetypeKey>([
  'human', 'humanFem', 'cyclops', 'visor',
]);

// ───────────────────────── HAIR SHAPES ─────────────────────────
// Row-level deltas applied to the human/humanFem base before accessory
// patches. Only specifies rows that differ — unchanged rows fall through.
type HairShape = { id: string; rows: Record<number, string> };

const PAD = '................';
function row16(s: string): string {
  return (s + PAD).slice(0, 16);
}

// HUMAN (male/short-skull) hair pool — replaces rows 1-5.
const HAIR_POOL_HUMAN: HairShape[] = [
  { id: 'short', rows: {} }, // base
  {
    id: 'bald',
    rows: {
      1: '................',
      2: '................',
      3: '.....sssssss....',
    },
  },
  {
    id: 'mohawk',
    rows: {
      1: '......hhhh......',
      2: '......hhhh......',
      3: '....shhhhhhs....',
      4: '..hhshhhhhhsH...',
    },
  },
  {
    id: 'spikes',
    rows: {
      1: '..h.h.h.h.h.....',
      2: '..hhhhhhhhhh....',
    },
  },
  {
    id: 'afro',
    rows: {
      1: '....hhhhhhhh....',
      2: '...hhhhhhhhhh...',
      3: '..hhhsssssshhh..',
      4: '.hhhsssssssshhh.',
      5: '.hhsssssssssshh.',
    },
  },
  {
    id: 'flattop',
    rows: {
      1: '....hhhhhhhh....',
      2: '....hhhhhhhh....',
    },
  },
  {
    id: 'tophat',
    rows: {
      1: '...KKKKKKKKK....',
      2: '...KKKKKKKKK....',
      3: '..KKKKKKKKKKK...',
    },
  },
  {
    id: 'beanie',
    rows: {
      1: '....oooooooo....',
      2: '...oooooooooo...',
      3: '...oossssssoo...',
    },
  },
  {
    id: 'long',
    rows: {
      1: '...hhhhhhhhhh...',
      2: '..hhhhhhhhhhhh..',
      3: '..hhhsssssshhh..',
      4: '..hhssssssssHh..',
      5: '..hsssssssssHh..',
    },
  },
];

// HUMAN_FEM headwear pool — replaces top of head (rows 0-3) only,
// keeps the long flowing hair tails (rows 6-13) intact.
const HAIR_POOL_HUMAN_FEM: HairShape[] = [
  { id: 'long', rows: {} }, // base — long flowing hair as drawn in HUMAN_FEM
  {
    id: 'bandana',
    rows: {
      1: '..rrrrrrrrrrrr..',
      2: '..rsssssssssssr.',
    },
  },
  {
    id: 'witchhat',
    rows: {
      0: '......KKKK......',
      1: '.....KKKKKK.....',
      2: '....KKKKKKKK....',
      3: '..KKKKKKKKKKKK..',
    },
  },
  {
    id: 'flower',
    rows: {
      0: '...........MM...',
      1: '....hhhhhhMpM...',
    },
  },
  {
    id: 'beanie-fem',
    rows: {
      0: '....cccccccc....',
      1: '...cccccccccc...',
      2: '...cchhhhhhcc...',
    },
  },
  {
    id: 'bun',
    rows: {
      0: '......hhh.......',
      1: '....hhHHhhhh....',
      2: '...hhhhhhhhhh...',
      3: '..hhhsssssshhh..',
    },
  },
];

// ───────────────────────── ACCESSORIES ─────────────────────────
// Sparse cell patches applied to all frames after substitution.
type AccessoryCell = [x: number, y: number, ch: string];
type Accessory = {
  id: string;
  cells: AccessoryCell[];
  // Restricts which archetypes can roll this accessory. Beard/cigarette
  // need male-style face geometry; humanFem hair tails block the right
  // side (col 12+) so cig/right-side things skip her.
  archGate?: ArchetypeKey[];
};

const ACCESSORIES: Accessory[] = [
  { id: 'none',     cells: [] },
  { id: 'earring',  cells: [[12, 8, 'y']] },
  { id: 'scar',     cells: [[4, 6, 'r'], [4, 7, 'r']] },
  { id: 'mole',     cells: [[11, 9, 'H']] },
  { id: 'freckles', cells: [[4, 9, 'H'], [11, 9, 'H']] },
  { id: 'beauty',   cells: [[10, 11, 'p']] },
  // glasses — minimal frame outline so iris stays visible
  {
    id: 'glasses',
    cells: [
      [3, 7, 'K'], [4, 6, 'K'], [5, 6, 'K'],
      [7, 7, 'K'], [8, 6, 'K'], [9, 6, 'K'],
      [10, 7, 'K'], [11, 7, 'K'],
      [4, 8, 'K'], [5, 8, 'K'], [10, 8, 'K'], [11, 8, 'K'],
    ],
  },
  // sunglasses — opaque dark band over eyes
  {
    id: 'sunglasses',
    cells: [
      [3, 7, 'K'], [4, 7, 'K'], [5, 7, 'K'], [6, 7, 'K'],
      [7, 7, 'K'], [8, 7, 'K'], [9, 7, 'K'], [10, 7, 'K'], [11, 7, 'K'],
      [4, 6, 'K'], [5, 6, 'K'], [8, 6, 'K'], [9, 6, 'K'],
      [4, 8, 'K'], [5, 8, 'K'], [8, 8, 'K'], [9, 8, 'K'],
    ],
  },
  // eyepatch — covers left eye + diagonal strap up to top right
  {
    id: 'eyepatch',
    cells: [
      [4, 6, 'X'], [5, 6, 'X'], [6, 6, 'X'],
      [3, 7, 'X'], [4, 7, 'X'], [5, 7, 'X'], [6, 7, 'X'],
      [4, 8, 'X'], [5, 8, 'X'],
      [7, 5, 'X'], [8, 4, 'X'], [9, 3, 'X'],
    ],
  },
  // mustache — male-only horizontal strip under the nose
  {
    id: 'mustache',
    cells: [
      [5, 9, 'h'], [6, 9, 'h'], [7, 9, 'h'],
      [8, 9, 'h'], [9, 9, 'h'], [10, 9, 'h'],
    ],
    archGate: ['human'],
  },
  // beard — wraps around mouth from below
  {
    id: 'beard',
    cells: [
      [3, 11, 'h'], [4, 11, 'h'], [11, 11, 'h'], [12, 11, 'h'],
      [3, 12, 'h'], [4, 12, 'h'], [5, 12, 'h'], [10, 12, 'h'], [11, 12, 'h'], [12, 12, 'h'],
      [4, 13, 'h'], [5, 13, 'h'], [6, 13, 'h'], [9, 13, 'h'], [10, 13, 'h'], [11, 13, 'h'],
    ],
    archGate: ['human'],
  },
  // goatee — small chin patch
  {
    id: 'goatee',
    cells: [
      [7, 11, 'h'], [8, 11, 'h'],
      [7, 12, 'h'], [8, 12, 'h'],
      [7, 13, 'h'], [8, 13, 'h'],
    ],
    archGate: ['human'],
  },
  // cigarette — out the right side of the mouth + smoke wisps above
  {
    id: 'cigarette',
    cells: [
      [12, 11, 'W'], [13, 11, 'W'], [14, 11, 'r'],
      [13, 9, 'g'], [14, 8, 'g'], [13, 7, 'g'],
    ],
    archGate: ['human'],
  },
  // monocle — frame around right eye
  {
    id: 'monocle',
    cells: [
      [8, 6, 'K'], [9, 6, 'K'], [10, 6, 'K'],
      [7, 7, 'K'], [11, 7, 'K'],
      [8, 8, 'K'], [9, 8, 'K'], [10, 8, 'K'],
    ],
  },
];

// ───────────────────────── SCHEDULES ─────────────────────────
type Schedule = ReadonlyArray<{ name: string; ms: number }>;

// Default per-archetype schedules — used when a worker has no lifecycle
// signal. Lifecycle schedules below take precedence whenever a Worker
// row is in play.
function skinSchedule(special: string): Schedule {
  return [
    { name: 'idle', ms: 2100 },
    { name: 'blink', ms: 130 },
    { name: 'idle', ms: 1400 },
    { name: special, ms: 520 },
    { name: 'idle', ms: 600 },
    { name: special, ms: 260 },
  ];
}

const SCHEDULES: Record<ArchetypeKey, Schedule> = {
  human: [
    { name: 'idle', ms: 2400 },
    { name: 'blink', ms: 130 },
    { name: 'idle', ms: 1800 },
    { name: 'talk', ms: 220 },
    { name: 'idle', ms: 200 },
    { name: 'talk', ms: 200 },
    { name: 'blink', ms: 110 },
  ],
  humanFem: [
    { name: 'idle', ms: 2200 },
    { name: 'blink', ms: 140 },
    { name: 'idle', ms: 1600 },
    { name: 'talk', ms: 220 },
    { name: 'idle', ms: 200 },
    { name: 'smile', ms: 600 },
    { name: 'idle', ms: 200 },
    { name: 'blink', ms: 110 },
  ],
  robot: [
    { name: 'idle', ms: 1800 },
    { name: 'talk', ms: 240 },
    { name: 'idle', ms: 240 },
    { name: 'talk', ms: 240 },
    { name: 'blink', ms: 90 },
    { name: 'idle', ms: 1500 },
    { name: 'alert', ms: 320 },
  ],
  zombie: [
    { name: 'idle', ms: 2200 },
    { name: 'brain', ms: 360 },
    { name: 'idle', ms: 1400 },
    { name: 'blink', ms: 280 },
  ],
  cyclops: [
    { name: 'idle', ms: 2600 },
    { name: 'blink', ms: 160 },
    { name: 'idle', ms: 1600 },
    { name: 'talk', ms: 220 },
    { name: 'idle', ms: 200 },
    { name: 'talk', ms: 220 },
  ],
  ghost: [
    { name: 'idle', ms: 1900 },
    { name: 'wisp', ms: 700 },
    { name: 'idle', ms: 1500 },
    { name: 'blink', ms: 200 },
  ],
  visor: [
    { name: 'idle', ms: 2000 },
    { name: 'scan', ms: 700 },
    { name: 'idle', ms: 1800 },
    { name: 'blink', ms: 120 },
  ],
  skull: [
    { name: 'idle', ms: 2400 },
    { name: 'fire', ms: 600 },
    { name: 'idle', ms: 1700 },
    { name: 'blink', ms: 180 },
  ],
  blockBuilder: skinSchedule('talk'),
  greenHisser: skinSchedule('hiss'),
  voidWalker: skinSchedule('stare'),
  panda: skinSchedule('chew'),
  bear: skinSchedule('growl'),
  cat: skinSchedule('meow'),
  dog: skinSchedule('bark'),
  parrot: skinSchedule('squawk'),
  bird: skinSchedule('chirp'),
  skeleton: skinSchedule('rattle'),
  witch: skinSchedule('cackle'),
  italianMan: skinSchedule('shout'),
  webHero: skinSchedule('web'),
  nightCowl: skinSchedule('scowl'),
  metalBro: skinSchedule('repulsor'),
  grinningMask: skinSchedule('grin'),
  greenFrog: skinSchedule('croak'),
  robedTeacher: skinSchedule('speak'),
};

// Lifecycle moods. Each entry is a fallback list of frame names — the
// schedule resolver picks the first frame the archetype actually defines.
// That way the same lifecycle drives a coherent animation no matter which
// archetype is wearing it (skull's "fire" stands in where human has "talk").
type Mood = { pref: string[]; ms: number };

const NAMED_SKIN_ACTIONS = [
  'hiss', 'stare', 'chew', 'growl', 'meow', 'bark', 'squawk', 'chirp', 'rattle',
  'cackle', 'shout', 'web', 'scowl', 'repulsor', 'grin', 'croak', 'speak',
];
const ACTIVE_ACTIONS = ['talk', 'scan', 'wisp', 'smile', 'fire', 'alert', ...NAMED_SKIN_ACTIONS];
const STREAM_ACTIONS = ['talk', 'scan', 'wisp', 'fire', 'alert', 'brain', ...NAMED_SKIN_ACTIONS];
const STUCK_ACTIONS = ['talk', 'scan', 'brain', 'fire', 'alert', ...NAMED_SKIN_ACTIONS, 'idle'];
const CRASH_ACTIONS = ['alert', 'fire', 'brain', 'hiss', 'stare', 'rattle', 'blink'];
const CRASH_TALK_ACTIONS = ['alert', 'fire', 'brain', 'talk', 'hiss', 'stare', 'rattle', 'web', 'repulsor'];

const LIFECYCLE_MOODS: Record<WorkerLifecycle, Mood[]> = {
  spawning: [
    { pref: ['idle'], ms: 600 },
    { pref: ['blink'], ms: 180 },
    { pref: ['idle'], ms: 400 },
    { pref: ['blink'], ms: 180 },
    { pref: ['idle'], ms: 350 },
    { pref: ['talk', 'scan', 'fire', 'alert', 'brain', 'wisp', 'smile', 'blink'], ms: 200 },
  ],
  active: [
    { pref: ['idle'], ms: 2400 },
    { pref: ['blink'], ms: 130 },
    { pref: ['idle'], ms: 1800 },
    { pref: ACTIVE_ACTIONS, ms: 240 },
    { pref: ['idle'], ms: 200 },
    { pref: ACTIVE_ACTIONS, ms: 220 },
    { pref: ['blink'], ms: 110 },
  ],
  idle: [
    { pref: ['idle'], ms: 5400 },
    { pref: ['blink'], ms: 250 },
    { pref: ['idle'], ms: 4000 },
    { pref: ['blink'], ms: 200 },
    { pref: ['idle'], ms: 6000 },
  ],
  streaming: [
    { pref: STREAM_ACTIONS, ms: 180 },
    { pref: ['idle'], ms: 70 },
    { pref: STREAM_ACTIONS, ms: 220 },
    { pref: ['idle'], ms: 60 },
    { pref: STREAM_ACTIONS, ms: 180 },
    { pref: ['blink'], ms: 90 },
    { pref: STREAM_ACTIONS, ms: 200 },
    { pref: ['idle'], ms: 90 },
  ],
  suspended: [
    // frozen on a "stuck open mouth" / scanning frame — barely animates.
    { pref: STUCK_ACTIONS, ms: 4500 },
    { pref: ['idle'], ms: 800 },
  ],
  terminating: [
    { pref: ['alert', 'fire', 'scan', 'brain', 'blink'], ms: 220 },
    { pref: ['idle'], ms: 180 },
    { pref: ['blink'], ms: 100 },
    { pref: ['alert', 'fire', 'scan', 'brain', 'talk'], ms: 220 },
  ],
  terminated: [
    // motionless. Single very long idle keeps the timer cheap.
    { pref: ['idle'], ms: 60_000 },
  ],
  crashed: [
    // manic — short cycle of alert/blink/fire.
    { pref: CRASH_ACTIONS, ms: 80 },
    { pref: ['idle'], ms: 60 },
    { pref: ['blink'], ms: 60 },
    { pref: CRASH_TALK_ACTIONS, ms: 80 },
    { pref: ['idle'], ms: 80 },
    { pref: ['blink'], ms: 100 },
  ],
};

export function scheduleForState(archetype: ArchetypeKey, lifecycle: WorkerLifecycle): Schedule {
  const frameNames = ARCHETYPES[archetype].frames;
  const moods = LIFECYCLE_MOODS[lifecycle] || LIFECYCLE_MOODS.active;
  return moods.map((m) => {
    const name = m.pref.find((n) => frameNames[n]) || 'idle';
    return { name, ms: m.ms };
  });
}

// ───────────────────────── DETERMINISM ─────────────────────────
function fnv1a(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: ReadonlyArray<T>): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function archetypeFromSeed(seed: string): ArchetypeKey {
  return ARCHETYPE_KEYS[fnv1a(seed) % ARCHETYPE_KEYS.length];
}

// ───────────────────────── VARIANT SPEC ─────────────────────────
export type VariantSpec = {
  frames: FrameMap;
  palette: Record<string, string>;
  archetype: ArchetypeKey;
  features: {
    skinIdx: number;
    hairIdx: number;
    eyeChar: string;
    accentChar: string;
    hairShape: string;
    accessoryId: string;
  };
};

const EYE_COLORS = ['i', 'I', 'c', 'b', 'l'];
const ACCENT_COLORS = ['o', 'y', 'c', 'b', 'l', 'r'];

function applyAccessory(frames: FrameMap, cells: AccessoryCell[]): FrameMap {
  if (cells.length === 0) return frames;
  const out: FrameMap = {};
  for (const [name, frame] of Object.entries(frames)) {
    const grid = frame.map((r) => r.split(''));
    for (const [x, y, ch] of cells) {
      if (grid[y] && grid[y][x] != null) grid[y][x] = ch;
    }
    out[name] = grid.map((r) => r.join(''));
  }
  return out;
}

function applyHairShape(frames: FrameMap, hair: HairShape): FrameMap {
  const keys = Object.keys(hair.rows);
  if (keys.length === 0) return frames;
  const out: FrameMap = {};
  for (const [name, frame] of Object.entries(frames)) {
    const next = frame.slice();
    for (const k of keys) {
      const yi = parseInt(k, 10);
      next[yi] = row16(hair.rows[yi]);
    }
    out[name] = next;
  }
  return out;
}

function hairPoolFor(archetype: ArchetypeKey): HairShape[] | null {
  if (archetype === 'human') return HAIR_POOL_HUMAN;
  if (archetype === 'humanFem') return HAIR_POOL_HUMAN_FEM;
  return null;
}

export function variantSpec(archetype: ArchetypeKey, seed: string | undefined): VariantSpec {
  const arch = ARCHETYPES[archetype];
  if (!seed) {
    return {
      frames: arch.frames,
      palette: {},
      archetype,
      features: { skinIdx: 0, hairIdx: 0, eyeChar: 'i', accentChar: 'o', hairShape: 'short', accessoryId: 'none' },
    };
  }
  const rng = mulberry32(fnv1a(`${archetype}:${seed}`));
  const skinIdx = Math.floor(rng() * SKIN_TONES.length);
  const hairIdx = Math.floor(rng() * HAIR_COLORS.length);
  const eyeChar = pick(rng, EYE_COLORS);
  const accentChar = pick(rng, ACCENT_COLORS);

  // Hair shape — only humans have a pool; everything else stays canonical.
  const hairPool = hairPoolFor(archetype);
  const hairShape: HairShape = hairPool ? pick(rng, hairPool) : { id: 'base', rows: {} };

  // Accessory: 30% none, otherwise pick from the archetype-eligible pool.
  const eligibleAccessories = ACCESSORIES.filter((a) => !a.archGate || a.archGate.includes(archetype));
  const noneRoll = rng();
  const accessoryIdx = Math.floor(rng() * Math.max(1, eligibleAccessories.length - 1));
  const accessory: Accessory = noneRoll < 0.3
    ? eligibleAccessories[0]
    : eligibleAccessories[1 + accessoryIdx] || eligibleAccessories[0];

  // Substitution: 'i' → eyeChar everywhere; on robot/visor, accent
  // characters ('b', 'o') swap to the chosen accent so paired chassis
  // workers get distinct light colors.
  const sub = (s: string): string => {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === 'i') out += eyeChar;
      else if ((archetype === 'robot' || archetype === 'visor') && ch === 'b') out += accentChar;
      else if (archetype === 'robot' && ch === 'o') out += accentChar;
      else out += ch;
    }
    return out;
  };

  const substituted: FrameMap = {};
  for (const k of Object.keys(arch.frames)) {
    substituted[k] = arch.frames[k].map(sub);
  }

  // Pipeline: hair shape (rows) → accessory (cells). Both gated by face-style.
  let finalFrames = substituted;
  if (HUMAN_FACED.has(archetype)) {
    finalFrames = applyHairShape(finalFrames, hairShape);
    finalFrames = applyAccessory(finalFrames, accessory.cells);
  }

  // Palette overrides (applied at FaceGrid render time).
  const palette: Record<string, string> = {};
  if (HUMAN_FACED.has(archetype)) {
    Object.assign(palette, SKIN_TONES[skinIdx]);
    Object.assign(palette, HAIR_COLORS[hairIdx]);
  }

  return {
    frames: finalFrames,
    palette,
    archetype,
    features: { skinIdx, hairIdx, eyeChar, accentChar, hairShape: hairShape.id, accessoryId: accessory.id },
  };
}

// ───────────────────────── WORKER → FACE ─────────────────────────
const SPECIAL_NAMES: Record<string, ArchetypeKey> = {
  frank: 'human',
  echo: 'robot',
  morag: 'humanFem',
  wren: 'cyclops',
  vesper: 'humanFem',
  orin: 'visor',
  ash: 'skull',
  lyra: 'humanFem',
  sable: 'humanFem',
  wisp: 'ghost',
  halo: 'humanFem',
  rune: 'humanFem',
  thorn: 'zombie',
  pike: 'visor',
  moth: 'humanFem',
  kai: 'human',
  blockBuilder: 'blockBuilder',
  blockbuilder: 'blockBuilder',
  greenHisser: 'greenHisser',
  greenhisser: 'greenHisser',
  voidWalker: 'voidWalker',
  voidwalker: 'voidWalker',
  panda: 'panda',
  bear: 'bear',
  cat: 'cat',
  dog: 'dog',
  parrot: 'parrot',
  bird: 'bird',
  skeleton: 'skeleton',
  witch: 'witch',
  italianMan: 'italianMan',
  italianman: 'italianMan',
  webHero: 'webHero',
  webhero: 'webHero',
  spider: 'webHero',
  nightCowl: 'nightCowl',
  nightcowl: 'nightCowl',
  metalBro: 'metalBro',
  metalbro: 'metalBro',
  iron: 'metalBro',
  guy: 'grinningMask',
  grinningMask: 'grinningMask',
  grinningmask: 'grinningMask',
  greenFrog: 'greenFrog',
  greenfrog: 'greenFrog',
  robedTeacher: 'robedTeacher',
  robedteacher: 'robedTeacher',
};

export function archetypeForWorker(row: Worker): ArchetypeKey {
  const tag = (row.label || row.id || '').toLowerCase().split(/[\s—-]+/)[0];
  if (tag && SPECIAL_NAMES[tag]) return SPECIAL_NAMES[tag];
  if (row.lifecycle === 'terminated' || row.lifecycle === 'crashed') return 'skull';
  return archetypeFromSeed(row.id || row.label || 'unseeded');
}

const STATE_FROM_LIFECYCLE: Record<WorkerLifecycle, { lbl: string; color: string }> = {
  spawning:    { lbl: 'BOOT',  color: 'theme:blue' },
  active:      { lbl: 'OK',    color: 'theme:ok' },
  idle:        { lbl: 'IDLE',  color: 'theme:inkDimmer' },
  streaming:   { lbl: 'TALK',  color: 'theme:accent' },
  suspended:   { lbl: 'STUCK', color: 'theme:warn' },
  terminating: { lbl: 'EXIT',  color: 'theme:warn' },
  terminated:  { lbl: 'GONE',  color: 'theme:inkDimmer' },
  crashed:     { lbl: 'RAT',   color: 'theme:flag' },
};

// ───────────────────────── FACE GRID ─────────────────────────
const COLORS = {
  bg: 'theme:bg',
  bg1: 'theme:bg1',
  bg2: 'theme:bg2',
  rule: 'theme:rule',
  ruleBright: 'theme:inkGhost',
  ink: 'theme:ink',
  inkDim: 'theme:inkDim',
  inkDimmer: 'theme:inkDimmer',
  accent: 'theme:accent',
  ok: 'theme:ok',
  warn: 'theme:warn',
  flag: 'theme:flag',
  blue: 'theme:blue',
  lilac: 'theme:lilac',
};

const SIZE = 16;

type FaceGridProps = {
  frame: Frame;
  scale?: number;
  palette?: Record<string, string>;
};

function FaceGrid({ frame, scale = 6, palette }: FaceGridProps) {
  const cell = Math.max(1, Math.round(scale));
  const px = SIZE * cell;
  const cells: any[] = [];
  for (let y = 0; y < SIZE; y++) {
    const row = frame[y] || '';
    for (let x = 0; x < SIZE; x++) {
      const ch = row[x] || '.';
      const c = (palette && palette[ch]) || PAL[ch];
      if (!c || c === TRANSPARENT) continue;
      cells.push(
        <Box
          key={`${x}-${y}`}
          style={{
            position: 'absolute',
            left: x * cell,
            top: y * cell,
            width: cell,
            height: cell,
            backgroundColor: c,
          }}
        />
      );
    }
  }
  return (
    <Box style={{ position: 'relative', width: px, height: px }}>
      {cells}
    </Box>
  );
}

// ───────────────────────── ANIMATED FACE ─────────────────────────
type AnimFaceProps = {
  frames: FrameMap;
  schedule: Schedule;
  scale?: number;
  paused?: boolean;
  palette?: Record<string, string>;
};

function AnimFace({ frames, schedule, scale = 6, paused, palette }: AnimFaceProps) {
  const animationsDisabled = useAnimationsDisabled();
  const effectivePaused = paused || animationsDisabled;
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (effectivePaused) return;
    const cur = schedule[step % schedule.length];
    const t = setTimeout(() => setStep((s) => s + 1), cur.ms);
    return () => clearTimeout(t);
  }, [step, schedule, effectivePaused]);
  const cur = schedule[step % schedule.length];
  const frame = frames[cur.name] || frames.idle;
  return <FaceGrid frame={frame} scale={scale} palette={palette} />;
}

// ───────────────────────── PUBLIC FACE COMPONENTS ─────────────────────────
export type StaticFaceProps = {
  archetype?: ArchetypeKey;
  frame?: string;
  scale?: number;
  seed?: string;
};

export function StaticFace({ archetype = 'human', frame = 'idle', scale = 6, seed }: StaticFaceProps) {
  const spec = useMemo(() => variantSpec(archetype, seed), [archetype, seed]);
  return (
    <FaceGrid
      frame={spec.frames[frame] || spec.frames.idle}
      scale={scale}
      palette={spec.palette}
    />
  );
}

export type LiveFaceProps = {
  archetype?: ArchetypeKey;
  scale?: number;
  seed?: string;
  schedule?: Schedule;
  lifecycle?: WorkerLifecycle;
  paused?: boolean;
};

export function LiveFace({
  archetype = 'human',
  scale = 6,
  seed,
  schedule,
  lifecycle,
  paused,
}: LiveFaceProps) {
  const spec = useMemo(() => variantSpec(archetype, seed), [archetype, seed]);
  const sched = useMemo(
    () => schedule
      || (lifecycle ? scheduleForState(archetype, lifecycle) : SCHEDULES[archetype]),
    [schedule, lifecycle, archetype]
  );
  return <AnimFace frames={spec.frames} schedule={sched} scale={scale} paused={paused} palette={spec.palette} />;
}

// ───────────────────────── BLOCK FACES (worker tile) ─────────────────────────
export type BlockFacesProps = {
  row: Worker;
  scale?: number;
  layout?: 'tile' | 'badge' | 'portrait';
};

export function BlockFaces({ row, scale = 5, layout = 'tile' }: BlockFacesProps) {
  const archetype = useMemo(() => archetypeForWorker(row), [row.id, row.label, row.lifecycle]);
  const state = STATE_FROM_LIFECYCLE[row.lifecycle];

  if (layout === 'portrait') {
    return (
      <Col style={{ alignItems: 'center', gap: 6, padding: 10, backgroundColor: COLORS.bg1, borderWidth: 1, borderColor: COLORS.rule }}>
        <LiveFace archetype={archetype} scale={scale} seed={row.id} lifecycle={row.lifecycle} />
        <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDim, letterSpacing: 1 }}>
          {row.label.toLowerCase()}
        </Text>
        <Text style={{ fontFamily: 'monospace', fontSize: 8, color: state.color, letterSpacing: 1 }}>
          {state.lbl}
        </Text>
      </Col>
    );
  }

  if (layout === 'badge') {
    return (
      <Row
        style={{
          alignItems: 'center',
          gap: 6,
          paddingTop: 3,
          paddingBottom: 3,
          paddingLeft: 3,
          paddingRight: 6,
          borderWidth: 1,
          borderColor: COLORS.rule,
          backgroundColor: COLORS.bg,
        }}
      >
        <LiveFace archetype={archetype} scale={scale} seed={row.id} lifecycle={row.lifecycle} />
        <Col style={{ gap: 2 }}>
          <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.ink, fontWeight: 'bold' }}>
            {row.label}
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 8, color: state.color, letterSpacing: 1 }}>
            {state.lbl}
          </Text>
        </Col>
      </Row>
    );
  }

  // tile — fixed width so it doesn't sprawl past the gallery's PAGE_SURFACE.
  return (
    <Row
      style={{
        width: 520,
        maxWidth: '100%',
        borderWidth: 1,
        borderColor: COLORS.ruleBright,
        backgroundColor: COLORS.bg,
        alignItems: 'stretch',
      }}
    >
      <Col
        style={{
          backgroundColor: COLORS.bg2,
          borderRightWidth: 1,
          borderRightColor: COLORS.rule,
          paddingTop: 10,
          paddingBottom: 10,
          paddingLeft: 12,
          paddingRight: 12,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <LiveFace archetype={archetype} scale={scale} seed={row.id} lifecycle={row.lifecycle} />
        <Text style={{ fontFamily: 'monospace', fontSize: 8, color: COLORS.inkDimmer, letterSpacing: 2 }}>
          {archetype.toUpperCase()}
        </Text>
      </Col>
      <Col style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, padding: 10, gap: 6 }}>
        <Row style={{ alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: 'monospace', fontSize: 12, color: COLORS.ink, fontWeight: 'bold' }}>
            {row.label}
          </Text>
          <Box
            style={{
              borderWidth: 1,
              borderColor: state.color,
              paddingLeft: 4,
              paddingRight: 4,
              paddingTop: 1,
              paddingBottom: 1,
            }}
          >
            <Text style={{ fontFamily: 'monospace', fontSize: 8, color: state.color, letterSpacing: 1 }}>
              {state.lbl}
            </Text>
          </Box>
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDim }}>
            wearing
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.accent, fontWeight: 'bold' }}>
            {row.modelId}
          </Text>
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDimmer }}>
            kind
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.ink }}>
            {row.kind}
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDimmer }}>·</Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDimmer }}>
            conn
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.ink }}>
            {row.connectionId}
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDimmer }}>·</Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDimmer }}>
            max
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.ink }}>
            {row.maxConcurrentRequests}
          </Text>
        </Row>
        <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDim }}>
          spawned {row.spawnedAt.replace('T', ' ').replace('Z', '')}
        </Text>
      </Col>
    </Row>
  );
}


export const blockFacesArchetypes = ARCHETYPE_KEYS;
export const blockFacesAccessoryIds = ACCESSORIES.map((a) => a.id);
export const blockFacesSkinTones = SKIN_TONES.length;
export const blockFacesHairColors = HAIR_COLORS.length;
export const blockFacesHairShapesHuman = HAIR_POOL_HUMAN.map((h) => h.id);
export const blockFacesHairShapesHumanFem = HAIR_POOL_HUMAN_FEM.map((h) => h.id);
