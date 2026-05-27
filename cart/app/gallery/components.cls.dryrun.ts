/**
 * DRY RUN — proposed shape for components.cls.ts under the
 * compound + state-prop + builder model.
 *
 * Not wired in. Lives next to the real sheet for visual diffing.
 *
 * Three primitive shapes appear:
 *
 *   1. Single classifier with `.Suffix` appendages
 *        → `<S.Foo state="Tool">`            (no member access)
 *
 *   2. Compound classifier with member-access slots
 *        → `<S.AppChatStatus.Frame>` etc.   (each slot is its own def)
 *
 *   3. Generated family (numeric scale)
 *        → built from a `scaleClassifiers()` helper over [1..6]
 *
 * Conventions:
 *   • Slot names describe ROLE, not builder
 *       (Frame / Label / Dot / Toggle — not fixedPill / monoText)
 *   • State suffixes live on the SLOT that varies, not the parent
 *       (avoids forced parent cascade; each call site passes the same
 *        `state={s}` to every slot it cares about, coordinated at the
 *        caller)
 *   • Builders return the body, spread into the def so `.Suffix` keys
 *     sit as siblings of `type` / `style`
 *
 * Compression on the four clusters below:
 *                              old lines    new lines
 *   AppChatStatusPill*               16          6
 *   AppChatPanelHeader*              45         24
 *   SocialGalleryIcon*                5          5   ← variant fold only
 *   Stack*/Inline* rhythm (18)       18          6   ← scale generator
 *
 *   Total over this sample:          84         41   (~51% reduction)
 *
 * Reduction is much bigger on variant-heavy clusters; flat one-offs
 * still benefit from the builder one-liner but don't fold further.
 */

import { classifier } from '@reactjit/core';
import { monoText, fixedPill, statusDot } from './gallery-builders';
import type { SpaceToken } from './gallery-tokens';

// ── Scale-generator helper ─────────────────────────────────────
// Use ONLY for true numeric sweeps where the family IS a scale.
// Don't reach for this when names differ qualitatively.
function scaleClassifiers<N extends number>(
  steps: readonly N[],
  build: (n: N) => Record<string, any>,
): Record<string, any> {
  return Object.fromEntries(steps.flatMap(n => Object.entries(build(n))));
}

classifier({

  // ── 1. Pure variant cluster ─────────────────────────────────
  // Was: 5 separate SocialGalleryIcon{,Ink,Accent,Ok,Blue} entries.
  // Now: one classifier, variants live as `.Suffix`, picked via
  // `state` prop at the call site:
  //   <S.SocialGalleryIcon state="Accent" icon={...} />
  SocialGalleryIcon: { type: 'Icon', size: 15, color: 'theme:inkDim', strokeWidth: 2.1,
    '.Ink':    { color: 'theme:ink' },
    '.Accent': { color: 'theme:accentHot', strokeWidth: 2.2 },
    '.Ok':     { color: 'theme:ok',        strokeWidth: 2.2 },
    '.Blue':   { color: 'theme:blue',      strokeWidth: 2.2 },
  },

  // ── 2. Compound w/ coordinated state ────────────────────────
  // Was: AppChatStatusPill + AppChatStatusPillText, each with 4 variants
  // (8 classifiers total). Now: one compound with two slots; same
  // `state` flows through both at the caller.
  //
  //   <S.AppChatStatus.Frame state={s}>
  //     <S.AppChatStatus.Label state={s}>{s.toUpperCase()}</S.AppChatStatus.Label>
  //   </S.AppChatStatus.Frame>
  AppChatStatus: {
    Frame: { ...fixedPill({ height: 18, padX: 6, border: 'theme:ok' }),
      '.Tool':  { style: { borderColor: 'theme:accent' } },
      '.Stuck': { style: { borderColor: 'theme:warn'   } },
      '.Rat':   { style: { borderColor: 'theme:flag'   } },
    },
    Label: { ...monoText(9, 'theme:ok', { bold: true, letterSpacing: 2, lineHeight: 11 }),
      '.Tool':  { color: 'theme:accent' },
      '.Stuck': { color: 'theme:warn'   },
      '.Rat':   { color: 'theme:flag'   },
    },
  },

  // ── 3. Compound, many slots, no shared state ────────────────
  // Was: 8 AppChatPanelHeader* siblings sharing only a prefix.
  // Now: one compound — the slots ARE the panel-header's anatomy.
  // No `.Suffix` because nothing varies here; the compression
  // comes from builders + structural co-location.
  //
  //   <S.AppChatPanelHeader.Frame>
  //     <S.AppChatPanelHeader.Left>
  //       <S.AppChatPanelHeader.Dot />
  //       <S.AppChatPanelHeader.Title>chat</S.AppChatPanelHeader.Title>
  //     </S.AppChatPanelHeader.Left>
  //     <S.AppChatPanelHeader.State>
  //       <S.AppChatPanelHeader.StateText>IDLE</S.AppChatPanelHeader.StateText>
  //     </S.AppChatPanelHeader.State>
  //     <S.AppChatPanelHeader.Toggle>
  //       <S.AppChatPanelHeader.ToggleText>−</S.AppChatPanelHeader.ToggleText>
  //     </S.AppChatPanelHeader.Toggle>
  //   </S.AppChatPanelHeader.Frame>
  AppChatPanelHeader: {
    Frame: { type: 'Box', style: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      height: 36, paddingLeft: 12, paddingRight: 8, gap: 8,
      borderBottomWidth: 1, borderColor: 'theme:rule',
      backgroundColor: 'theme:bg1', flexShrink: 0,
    }},
    Left:       { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 10 } },
    Dot:        statusDot('theme:accent', 8),
    Title:      monoText(11, 'theme:ink',    { bold: true, letterSpacing: 3, lineHeight: 13 }),
    State:      fixedPill({ height: 18, padX: 6, border: 'theme:rule', bg: 'theme:bg2' }),
    StateText:  monoText(9,  'theme:inkDim', { bold: true, letterSpacing: 2, lineHeight: 11 }),
    Toggle: { type: 'Pressable', style: {
      width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: 'theme:rule', backgroundColor: 'theme:bg2',
    }},
    ToggleText: monoText(12, 'theme:ink',    { bold: true, lineHeight: 14, letterSpacing: 0 }),
  },

  // ── 4. Generated rhythm family ──────────────────────────────
  // 18 classifiers from one scalar sweep — Stack/StackCenter/Inline
  // for each space step X1..X6. Adding X7 = one number, not nine
  // copy-paste blocks.
  ...scaleClassifiers([1, 2, 3, 4, 5, 6] as const, n => ({
    [`StackX${n}`]:        { type: 'Box', style: { gap: `theme:spaceX${n}` as SpaceToken } },
    [`StackX${n}Center`]:  { type: 'Box', style: { alignItems: 'center', gap: `theme:spaceX${n}` as SpaceToken } },
    [`InlineX${n}`]:       { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: `theme:spaceX${n}` as SpaceToken } },
  })),

});
