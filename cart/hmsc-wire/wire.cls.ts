// wire.cls.ts — the classifier vocabulary for the hmsc-int wireframes (W-series).
//
// W1 CHROME: the captured shape of hmsc-int's ProjectBar — the one piece of
// chrome that never resets while you iterate — promoted from inline styles to
// classifier classes, and extended with the missing WINDOW CONTROLS (the host
// is borderless: this strip IS the titlebar).
//
// Captured slot order (left → right), straight off ProjectBar.tsx:
//
//   Brand · Rule · MapPill · NewPill · ‹drag space› · NavGroup ·
//   Rule · Undo/Redo · Rule · CompilePill · SavePill · ‹NEW› WinControls
//
// Same token discipline as hmsc-int/studio.cls.ts: every colour is a theme:
// token from hmsc-int/theme.ts — the wireframe IS the future skeleton, palette
// included, so when a class graduates it moves into studio.cls verbatim.

import { classifier, classifiers, setTokens, setStyleTokens, getColors } from '@reactjit/classifier';
import { STUDIO_COLORS, STUDIO_STYLES } from '../hmsc-int/theme';

// Seed the global theme store on import (idempotent; matches studio.cls.ts).
setTokens(STUDIO_COLORS);
setStyleTokens(STUDIO_STYLES);

/** Resolve a theme colour token to its raw value — for user props (Icon color
 *  etc.), which the classifier does not token-resolve. */
export function tone(token: string): string {
  return (getColors() as Record<string, string>)[token] ?? token;
}

export const CHROME_H = 38; // structural, not theme — PROJECT_BAR_H captured

classifier({
  // ── shell ────────────────────────────────────────────────────
  WireRoot: { type: 'Box', style: { width: '100%', height: '100%', flexDirection: 'column', backgroundColor: 'theme:bgAlt' } },

  // ── chrome strip (the titlebar) ──────────────────────────────
  // paddingRight deliberately 0 — the window controls sit flush to the edge.
  ChromeBar: {
    type: 'Box',
    style: {
      width: '100%', height: CHROME_H, flexDirection: 'row', alignItems: 'center',
      paddingLeft: 10, gap: 10,
      backgroundColor: 'theme:surface', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border',
    },
  },
  ChromeBrand: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 6 } },
  ChromeKicker: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textFaint', style: { fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 } },
  ChromeRule: { type: 'Box', style: { width: 1, height: 18, backgroundColor: 'theme:border' } },
  // The empty middle. Carries windowDrag at the use site — grab anywhere in the
  // dead space to move the window (cutout TopBar's proven pattern).
  ChromeDragSpace: { type: 'Box', style: { flexGrow: 1, height: '100%' } },
  ChromeGroup: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 4 } },

  // Icon button (28×26) + active sibling — the route-nav unit.
  ChromeBtn: {
    type: 'Pressable',
    style: { width: 28, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' },
    hoverStyle: { borderColor: 'theme:textDim' },
  },
  ChromeBtnOn: {
    type: 'Pressable',
    style: { width: 28, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:text', backgroundColor: 'theme:bgElevated' },
  },

  // Labeled pill (map switcher / new map / compile / save) + active sibling.
  ChromePill: {
    type: 'Pressable',
    style: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' },
    hoverStyle: { borderColor: 'theme:textDim' },
  },
  ChromePillOn: {
    type: 'Pressable',
    style: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:text', backgroundColor: 'theme:bgElevated' },
  },
  ChromePillText: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:textSecondary', style: { fontWeight: 600 } },
  ChromePillStrong: { type: 'Text', fontSize: 12, color: 'theme:text', style: { fontWeight: 700 } },
  ChromePillFaint: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textDim', style: { fontFamily: 'monospace' } },

  // ── window controls (NEW) ────────────────────────────────────
  // Flat OS-style: no border, no radius, full strip height, flush right.
  // Close gets the red hover; min/max get the neutral one.
  WinGroup: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', height: '100%' } },
  WinBtn: {
    type: 'Pressable',
    style: { width: 40, height: '100%', alignItems: 'center', justifyContent: 'center' },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
  },
  WinBtnClose: {
    type: 'Pressable',
    style: { width: 40, height: '100%', alignItems: 'center', justifyContent: 'center' },
    hoverStyle: { backgroundColor: 'theme:error' },
  },

  // ── W2: the unified asset editor ─────────────────────────────
  // character / item / vehicle / material folded into ONE interface:
  //
  //   |1|2 |3   |4         |
  //
  //   1 CatRail    — 1:1 category icons, full height
  //   2 ItemRail   — icon + name rows for the selected category
  //   3 PropsCol   — the full expanded properties panel for the selection
  //   4 PreviewCol — the big surface; 3D/2D preview default, painter toggle
  //
  // Group/Field class names deliberately mirror hmsc-int/studio.cls.ts so the
  // settled versions merge into that sheet without a rename.

  // 1 — category gutter
  CatRail: { type: 'Box', style: { width: 46, height: '100%', flexDirection: 'column', alignItems: 'center', paddingTop: 8, gap: 6, backgroundColor: 'theme:surface', borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:border' } },
  CatBtn: {
    type: 'Pressable',
    style: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' },
    hoverStyle: { borderColor: 'theme:textDim' },
  },
  CatBtnOn: {
    type: 'Pressable',
    style: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', backgroundColor: 'theme:bgElevated' },
  },

  // 2 — item gutter (icon + name per row)
  ItemRail: { type: 'Box', style: { width: 170, height: '100%', flexDirection: 'column', paddingTop: 8, gap: 2, backgroundColor: 'theme:bg', borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:border' } },
  RailKicker: { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:textFaint', style: { fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1, paddingLeft: 10, paddingBottom: 4 } },
  ItemRow: {
    type: 'Pressable',
    style: { flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 4, marginRight: 4, paddingLeft: 7, paddingRight: 7, paddingTop: 5, paddingBottom: 5, borderRadius: 'theme:radiusMd' },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
  },
  ItemRowOn: {
    type: 'Pressable',
    style: { flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 4, marginRight: 4, paddingLeft: 7, paddingRight: 7, paddingTop: 5, paddingBottom: 5, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:bgElevated' },
  },
  ItemRowText: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:textSecondary' },
  ItemRowTextOn: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:text', style: { fontWeight: 700 } },
  // fake filter box pinned above the roster scroll (full-surface dressing)
  RailSearch: { type: 'Box', style: { marginLeft: 8, marginRight: 8, marginBottom: 6, paddingLeft: 8, paddingTop: 4, paddingBottom: 4, borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg' } },
  RailSearchHint: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textFaint', style: { fontFamily: 'monospace' } },

  // 3 — properties column (names mirror studio.cls for graduation)
  PropsCol: { type: 'Box', style: { width: 290, height: '100%', flexDirection: 'column', backgroundColor: 'theme:bg', borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:border' } },
  HeroBar: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingMd', paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 'theme:spacingMd', paddingBottom: 'theme:spacingMd', backgroundColor: 'theme:surface', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border' } },
  HeroName: { type: 'Text', fontSize: 'theme:fontHero', color: 'theme:text', fontWeight: 'bold' },
  HeroSub: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textDim', style: { fontFamily: 'monospace' } },
  Group: { type: 'Box', style: { borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft', paddingBottom: 'theme:spacingSm' } },
  GroupHead: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingSm', paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 9, paddingBottom: 5 } },
  GroupAccentBar: { type: 'Box', style: { width: 3, height: 11, backgroundColor: 'theme:primary' } }, // override color per group
  GroupTitle: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:primary', style: { fontFamily: 'monospace', fontWeight: 800, letterSpacing: 1.2 } }, // override color per group
  GroupRule: { type: 'Box', style: { flexGrow: 1, height: 1, backgroundColor: 'theme:borderSoft' } },
  FieldStrip: { type: 'Box', style: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 3, paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd' } },
  Field: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 11, paddingRight: 11, paddingTop: 5, paddingBottom: 5, borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:track' } },
  FieldLabel: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textDim', style: { fontFamily: 'monospace', fontWeight: 700 } },
  FieldValue: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:valText', style: { fontFamily: 'monospace', fontWeight: 600 } },
  FieldValueNum: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:valNum', style: { fontFamily: 'monospace', fontWeight: 700 } },
  GroupCount: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textFaint', style: { fontFamily: 'monospace', fontWeight: 700 } },

  // typed controls in the strip — the density test. Per-instance state =
  // sibling state classes (…On / …Off), same idiom as studio.cls.
  // bool: track + knob; On aligns the knob right, Off left
  ToggleTrack: { type: 'Box', style: { width: 26, height: 14, borderRadius: 7, backgroundColor: 'theme:offTrack', justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 2, paddingRight: 2 } },
  ToggleTrackOn: { type: 'Box', style: { width: 26, height: 14, borderRadius: 7, backgroundColor: 'theme:onTrack', justifyContent: 'center', alignItems: 'flex-end', paddingLeft: 2, paddingRight: 2 } },
  ToggleKnob: { type: 'Box', style: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'theme:knob' } },
  ToggleKnobOff: { type: 'Box', style: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'theme:offKnob' } },
  // scalar: fixed mini track; fill width set per instance (percent of track)
  SliderTrack: { type: 'Box', style: { width: 54, height: 4, borderRadius: 2, backgroundColor: 'theme:track', flexDirection: 'row' } },
  SliderFill: { type: 'Box', style: { height: 4, borderRadius: 2, backgroundColor: 'theme:primary' } },
  // colour: swatch chip; bg per instance
  Swatch: { type: 'Box', style: { width: 12, height: 12, borderRadius: 'theme:radiusSm', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' } },
  // enum: mini segmented cells (smaller than the preview-bar ModeSeg)
  SegMiniWrap: { type: 'Box', style: { flexDirection: 'row', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', borderRadius: 'theme:radiusSm', backgroundColor: 'theme:controlBg' } },
  SegMiniCell: { type: 'Box', style: { paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2 } },
  SegMiniCellOn: { type: 'Box', style: { paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, backgroundColor: 'theme:segActiveBg' } },
  SegMiniText: { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:textFaint', style: { fontFamily: 'monospace' } },
  SegMiniTextOn: { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:segActiveText', style: { fontFamily: 'monospace', fontWeight: 700 } },

  // 4 — preview column (the big one)
  PreviewCol: { type: 'Box', style: { flexGrow: 1, minWidth: 0, height: '100%', flexDirection: 'column', backgroundColor: 'theme:bgAlt' } },
  PreviewBar: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingMd', paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 6, paddingBottom: 6, backgroundColor: 'theme:surface', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border' } },
  // mode toggle — segmented pair (3D/2D preview ⇄ painter)
  ModeSeg: { type: 'Box', style: { flexDirection: 'row', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg' } },
  SegCell: {
    type: 'Pressable',
    style: { paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4 },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
  },
  SegCellOn: { type: 'Pressable', style: { paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, backgroundColor: 'theme:segActiveBg' } },
  SegText: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textDim', style: { fontFamily: 'monospace', fontWeight: 700 } },
  SegTextOn: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:segActiveText', style: { fontFamily: 'monospace', fontWeight: 700 } },
  PreviewSurface: { type: 'Box', style: { flexGrow: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', gap: 'theme:spacingSm' } },
  // painter toggle-state internals (the cutout painter's shape, greyboxed)
  PaintWrap: { type: 'Box', style: { flexGrow: 1, minHeight: 0, flexDirection: 'row' } },
  ToolRail: { type: 'Box', style: { width: 40, height: '100%', flexDirection: 'column', alignItems: 'center', paddingTop: 8, gap: 5, backgroundColor: 'theme:surface', borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:border' } },
  ToolBtn: {
    type: 'Pressable',
    style: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' },
    hoverStyle: { borderColor: 'theme:textDim' },
  },
  ToolBtnOn: {
    type: 'Pressable',
    style: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', backgroundColor: 'theme:bgElevated' },
  },
  PaintStatus: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingMd', paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 4, paddingBottom: 4, backgroundColor: 'theme:surface', borderTopWidth: 'theme:borderThin', borderTopColor: 'theme:border' } },

  // ── W3: settings + logs folded into the SAME four gutters ────
  // 4 reinterpreted: not "3D preview" but "the demonstration surface for the
  // selection" — settings domains get a live rig (physics = jumping figure),
  // the logs domain's demonstration IS its stream.

  // demo rig stage (physics / day-cycle rigs render into this).
  // RULE: the stage DEMONSTRATES, it never edits — no controls in here. The
  // knobs live in gutter 3 (the one edit surface); the stage receives values.
  // The only widgets allowed in the preview bar are LENSES (3D/2D ⇄ PAINT,
  // ALL ⇄ channel), never subject properties.
  Stage: { type: 'Box', style: { flexGrow: 1, minHeight: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 0 } },
  StageFigure: { type: 'Box', style: { width: 18, height: 18, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:primary' } },
  StageFloor: { type: 'Box', style: { width: '46%', height: 2, backgroundColor: 'theme:border', marginTop: 8, marginBottom: 56 } },

  // live panel controls — gutter 3 fields that actually edit (the wireframe's
  // proof of the col-3-edits → col-4-reacts loop)
  StepBtn: {
    type: 'Pressable',
    style: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusSm', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' },
    hoverStyle: { borderColor: 'theme:textDim' },
  },
  SegMiniPress: {
    type: 'Pressable',
    style: { paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2 },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
  },
  SegMiniPressOn: { type: 'Pressable', style: { paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, backgroundColor: 'theme:segActiveBg' } },

  // the log stream (logs domain, column 4)
  LogPane: { type: 'Box', style: { flexGrow: 1, minHeight: 0, flexDirection: 'column' } },
  LogRow: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, paddingTop: 3, paddingBottom: 3, borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft' } },
  LogTime: { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:textFaint', style: { fontFamily: 'monospace' } },
  LogChip: { type: 'Box', style: { paddingLeft: 5, paddingRight: 5, paddingTop: 1, paddingBottom: 1, borderRadius: 'theme:radiusSm' } }, // bg per channel
  LogChipText: { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:bg', style: { fontFamily: 'monospace', fontWeight: 800 } },
  LogText: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textSecondary', style: { fontFamily: 'monospace' } },

  // ── greybox wireframe slots (the not-yet-real regions) ───────
  WireBody: { type: 'Box', style: { flexGrow: 1, minHeight: 0, padding: 'theme:spacingLg', gap: 'theme:spacingMd' } },
  WireSlot: { type: 'Box', style: { borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft', backgroundColor: 'theme:bg', alignItems: 'center', justifyContent: 'center', gap: 'theme:spacingSm' } },
  WireTag: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textFaint', style: { fontFamily: 'monospace', letterSpacing: 1 } },
  WireNote: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:textDim' },
});

export const C = classifiers;
