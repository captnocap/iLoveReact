// shell/workbench.cls.ts — the Workbench's classifier additions (WORKBENCH.md §2).
//
// ADDITIVE ONLY. This sheet registers the vocabulary the four-gutter frame
// needs that studio.cls doesn't already have. Everything shared — the typed
// controls (Toggle*/Slider*/Stepper*/Segment*/ColorSwatch), the panel kit
// (Group*/FieldStrip/Field*/Hero*), EmptyState — is reused from studio.cls,
// never redeclared (the classifier registry is global per cart; one name,
// one owner). Importing this module imports studio.cls first, so the theme
// is seeded and the shared classes exist.
//
// Graduated from cart/hmsc-wire/wire.cls.ts (W1–W3, user-approved). Renames
// on the way in:
//   wire SegCell/SegText (preview-bar mode toggle) → Lens* — the LAW name:
//     the preview bar holds lenses, never properties (WORKBENCH.md §1).
//   wire SegMini* / StepBtn / Toggle* / Slider* → dropped; studio.cls's
//     Segment/Stepper/Toggle/Slider kits are the one control vocabulary.
//   wire Wire* (greybox tags) → dropped; EmptyState/EmptyTitle/EmptyHint.

import { classifier } from '../../../runtime/classifier';
import { C, accentFor } from '../studio.cls';

export const CHROME_H = 38; // structural — PROJECT_BAR_H, captured

classifier({
  // ── chrome strip (the titlebar; rendered by shell/chrome.tsx since the
  //    WBCHROME-0606 swap replaced ProjectBar) ──
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
  // the dead middle — carries windowDrag at the use site (the titlebar grab)
  ChromeDragSpace: { type: 'Box', style: { flexGrow: 1, height: '100%' } },
  ChromeGroup: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 4 } },
  ChromeBtn: {
    type: 'Pressable',
    style: { width: 28, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' },
    hoverStyle: { borderColor: 'theme:textDim' },
  },
  ChromeBtnOn: {
    type: 'Pressable',
    style: { width: 28, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:text', backgroundColor: 'theme:bgElevated' },
  },
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

  // ── window controls — flat OS-style, flush right, full strip height ──
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

  // ── the four gutters  |1|2 |3   |4         | ──────────────────
  // 1 — category gutter (1:1 icons)
  CatRail: { type: 'Box', style: { width: 46, height: '100%', flexDirection: 'column', alignItems: 'center', paddingTop: 8, paddingBottom: 8, gap: 6, backgroundColor: 'theme:surface', borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:border' } },
  CatBtn: {
    type: 'Pressable',
    style: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' },
    hoverStyle: { borderColor: 'theme:textDim' },
  },
  CatBtnOn: {
    type: 'Pressable',
    style: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', backgroundColor: 'theme:bgElevated' },
  },

  // 2 — roster gutter (icon + name rows; filter pinned above the scroll)
  ItemRail: { type: 'Box', style: { width: 170, height: '100%', flexDirection: 'column', paddingTop: 8, gap: 2, backgroundColor: 'theme:bg', borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:border' } },
  RailKicker: { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:textFaint', style: { fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1, paddingLeft: 10, paddingBottom: 4 } },
  RailSearchInput: { type: 'TextInput', style: { marginLeft: 8, marginRight: 8, marginBottom: 6, paddingLeft: 8, paddingTop: 4, paddingBottom: 4, borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', color: 'theme:text', fontSize: 'theme:fontMd' } },
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

  // 3 — properties column (panel kit itself comes from studio.cls)
  PropsCol: { type: 'Box', style: { width: 360, height: '100%', flexDirection: 'column', backgroundColor: 'theme:bg', borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:border' } },

  // HEROBAR-0606 (USER: "this header is crowded, and there is a button in
  // that array u cant even see") — the hero is a STACK, never a crowded row:
  //   row 1: icon + name (full width, room to breathe)
  //   row 2: the metadata as COLUMNS (value over a tiny label)
  //   row 3: ALL the actions, full-width + wrapping — never clipped
  Hero: { type: 'Box', style: { flexDirection: 'column', gap: 6, paddingTop: 'theme:spacingMd', paddingBottom: 'theme:spacingMd', backgroundColor: 'theme:surface', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border' } },
  HeroTopRow: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingMd', paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd' } },
  HeroMetaRow: { type: 'Box', style: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd' } },
  HeroMetaCell: { type: 'Box', style: { flexDirection: 'column', gap: 1 } },
  HeroMetaValue: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:text', style: { fontFamily: 'monospace', fontWeight: 700 } },
  HeroMetaLabel: { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:textFaint', style: { fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 } },
  HeroActionsRow: { type: 'Box', style: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, rowGap: 6, paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 2 } },

  // ENUMWRAP-0606 (USER: "i cant even see the name of that last one or if
  // there are more") — enum options render as a WRAPPING chip grid, never a
  // clipping row. maxWidth keeps the grid inside the panel; every option
  // always visible.
  FieldEnumWrap: { type: 'Box', style: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 3, rowGap: 3, maxWidth: 200 } },
  EnumCell: {
    type: 'Pressable',
    style: { paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: 'theme:radiusSm', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' },
    hoverStyle: { borderColor: 'theme:textDim' },
  },
  EnumCellOn: {
    type: 'Pressable',
    style: { paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: 'theme:radiusSm', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', backgroundColor: 'theme:segActiveBg' },
  },
  EnumCellText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textDim', style: { fontFamily: 'monospace', fontWeight: 700 } },
  EnumCellTextOn: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:segActiveText', style: { fontFamily: 'monospace', fontWeight: 700 } },

  // 4 — the demonstration surface
  PreviewCol: { type: 'Box', style: { flexGrow: 1, minWidth: 0, height: '100%', flexDirection: 'column', backgroundColor: 'theme:bgAlt' } },
  PreviewBar: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingMd', paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 6, paddingBottom: 6, backgroundColor: 'theme:surface', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border' } },
  PreviewTag: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textFaint', style: { fontFamily: 'monospace', letterSpacing: 1 } },
  // LENSES — the only widgets the preview bar may hold (LAW 2)
  LensSeg: { type: 'Box', style: { flexDirection: 'row', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg' } },
  LensCell: {
    type: 'Pressable',
    style: { paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4 },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
  },
  LensCellOn: { type: 'Pressable', style: { paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, backgroundColor: 'theme:segActiveBg' } },
  LensText: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textDim', style: { fontFamily: 'monospace', fontWeight: 700 } },
  LensTextOn: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:segActiveText', style: { fontFamily: 'monospace', fontWeight: 700 } },

  // ── stage kit (rigs render into this; DEMONSTRATES, never edits) ──
  Stage: { type: 'Box', style: { flexGrow: 1, minHeight: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 0 } },
  StageFigure: { type: 'Box', style: { width: 18, height: 18, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:primary' } },
  StageFloor: { type: 'Box', style: { width: '46%', height: 2, backgroundColor: 'theme:border', marginTop: 8, marginBottom: 56 } },
  // in-stage tool rail (the PAINT lens's tool column — workspace, not properties)
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

  // ── log stream + dashboard kit (the logs domain's demonstration) ──
  LogPane: { type: 'Box', style: { flexGrow: 1, minHeight: 0, flexDirection: 'column' } },
  StatBand: { type: 'Box', style: { flexDirection: 'row', gap: 'theme:spacingMd', paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 'theme:spacingMd', paddingBottom: 'theme:spacingMd', backgroundColor: 'theme:surface', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border' } },
  StatCard: { type: 'Box', style: { flexGrow: 1, flexDirection: 'column', gap: 6, padding: 10, borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', borderRadius: 'theme:radiusMd', backgroundColor: 'theme:cardBg' } },
  StatCardOn: { type: 'Box', style: { flexGrow: 1, flexDirection: 'column', gap: 6, padding: 10, borderWidth: 'theme:borderThin', borderColor: 'theme:primary', borderRadius: 'theme:radiusMd', backgroundColor: 'theme:bgElevated' } },
  StatHead: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 6 } },
  StatBig: { type: 'Text', fontSize: 20, color: 'theme:text', style: { fontFamily: 'monospace', fontWeight: 800 } },
  StatSub: { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:textFaint', style: { fontFamily: 'monospace' } },
  Spark: { type: 'Box', style: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 24 } },
  SparkBar: { type: 'Box', style: { width: 5, borderRadius: 1, backgroundColor: 'theme:primary' } }, // height/color per instance
  LogRow: {
    type: 'Pressable',
    style: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft' },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
  },
  LogRowSel: {
    type: 'Pressable',
    style: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft', backgroundColor: 'theme:bgElevated' },
  },
  LogStripe: { type: 'Box', style: { width: 3, alignSelf: 'stretch' } }, // channel color per instance
  LogTime: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textDim', style: { fontFamily: 'monospace' } },
  LogChip: { type: 'Box', style: { paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 'theme:radiusSm' } }, // bg per channel
  LogChipText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:bg', style: { fontFamily: 'monospace', fontWeight: 800 } },
  LogText: { type: 'Text', fontSize: 'theme:fontXl', color: 'theme:textSecondary', style: { fontFamily: 'monospace' } },
  SelBar: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingMd', paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 5, paddingBottom: 5, backgroundColor: 'theme:bgElevated', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border' } },
});

export { C, accentFor };
