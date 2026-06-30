// diag/console/console.cls.ts — the raw console's OWN classifier sheet.
//
// Styling = classifier `.cls.ts` only, `theme:NAME` tokens, no inline styles
// (Editor Foundation governing rule). Every class is `DC_`-prefixed so it never
// collides with the workspace sheet (`HW_`). Colors/spacing/radii resolve
// against whatever theme the host app has loaded — the console borrows the
// editor's palette rather than hardcoding one.
//
// Severity gets explicit per-level Text + dot classes (DC_Sev*Text / DC_Dot*)
// because a classifier resolves `theme:` tokens only in its own definition, not
// in caller-passed props — so a dynamic per-row color has to be a class, not an
// inline prop.

import { classifier, classifiers as C } from '../../classifier';

// Re-export the registry so consumers import this sheet by NAME
// (`import { C } from './console.cls'`). A named import is what keeps the
// module — and thus the classifier() registration below — from being
// tree-shaken (runtime/package.json marks .cls.ts as having no side effects,
// the same reason workspace.cls.ts exports its `C`).
export { C };

const MONO = 'monospace';

classifier({
  // ── Overlay shell (z-indexed; the scrim blocks pointers behind it) ─────────
  DC_Scrim: { type: 'Box', blocksPointerEvents: true, style: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)' } },
  DC_Panel: { type: 'Box', style: { width: 960, height: 620, flexDirection: 'column', borderRadius: 'theme:radiusLg', backgroundColor: 'theme:bgAlt', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', overflow: 'hidden' } },

  // ── Header ─────────────────────────────────────────────────────────────────
  DC_Header: { type: 'Box', style: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 12, paddingRight: 10, backgroundColor: 'theme:surface', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border' } },
  DC_Kicker: { type: 'Text', fontSize: 9, color: 'theme:primary', style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 2 } },
  DC_Title: { type: 'Text', fontSize: 13, color: 'theme:text', style: { fontWeight: 800 } },
  DC_Sub: { type: 'Text', fontSize: 10, color: 'theme:textDim', style: { fontFamily: MONO } },
  DC_Spacer: { type: 'Box', style: { flexGrow: 1, minWidth: 0 } },

  // ── Buttons (shared control shape) ─────────────────────────────────────────
  DC_Btn: { type: 'Pressable', style: { height: 24, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 9, paddingRight: 9, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:primary' } },
  DC_BtnOn: { type: 'Pressable', style: { height: 24, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 9, paddingRight: 9, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:segActiveBg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' } },
  DC_BtnText: { type: 'Text', fontSize: 10, color: 'theme:textSecondary', style: { fontFamily: MONO, fontWeight: 700 } },
  DC_BtnTextOn: { type: 'Text', fontSize: 10, color: 'theme:segActiveText', style: { fontFamily: MONO, fontWeight: 800 } },

  // ── Toolbar (severity floor + channel + search) ────────────────────────────
  DC_Toolbar: { type: 'Box', style: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 12, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft' } },
  DC_SegTrack: { type: 'Box', style: { height: 26, flexDirection: 'row', gap: 3, padding: 3, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' } },
  DC_Seg: { type: 'Pressable', style: { minWidth: 38, alignItems: 'center', justifyContent: 'center', paddingLeft: 7, paddingRight: 7, borderRadius: 'theme:radiusSm', backgroundColor: 'transparent' }, hoverStyle: { backgroundColor: 'theme:surfaceHover' } },
  DC_SegOn: { type: 'Pressable', style: { minWidth: 38, alignItems: 'center', justifyContent: 'center', paddingLeft: 7, paddingRight: 7, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:segActiveBg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' } },
  DC_SegText: { type: 'Text', fontSize: 9, color: 'theme:textDim', style: { fontFamily: MONO, fontWeight: 800 } },
  DC_SegTextOn: { type: 'Text', fontSize: 9, color: 'theme:segActiveText', style: { fontFamily: MONO, fontWeight: 900 } },
  DC_Search: { type: 'TextInput', style: { flexGrow: 1, minWidth: 0, height: 26, paddingLeft: 9, paddingRight: 9, borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg', color: 'theme:text', fontSize: 11, fontFamily: MONO } },

  // ── Channel filter chips ───────────────────────────────────────────────────
  DC_ChannelBar: { type: 'Box', style: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft' } },
  DC_Chan: { type: 'Pressable', style: { height: 20, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 7, paddingRight: 7, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:textDim' } },
  DC_ChanOn: { type: 'Pressable', style: { height: 20, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 7, paddingRight: 7, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:segActiveBg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' } },
  DC_ChanText: { type: 'Text', fontSize: 9, color: 'theme:textDim', style: { fontFamily: MONO, fontWeight: 700 } },
  DC_ChanTextOn: { type: 'Text', fontSize: 9, color: 'theme:segActiveText', style: { fontFamily: MONO, fontWeight: 800 } },
  DC_ChanCount: { type: 'Text', fontSize: 8, color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 700 } },
  DC_Jump: { type: 'Pressable', style: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusSm' }, hoverStyle: { backgroundColor: 'theme:surfaceHover' } },
  DC_JumpText: { type: 'Text', fontSize: 9, color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 900 } },

  // ── Feed body + rows ───────────────────────────────────────────────────────
  DC_Body: { type: 'ScrollView', style: { flexGrow: 1, minHeight: 0, backgroundColor: 'theme:stageBg' } },
  DC_List: { type: 'Box', style: { flexDirection: 'column' } },
  DC_Row: { type: 'Pressable', style: { minHeight: 19, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 2, paddingBottom: 2, borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft' }, hoverStyle: { backgroundColor: 'theme:surfaceHover' } },
  DC_Time: { type: 'Text', fontSize: 9, color: 'theme:textFaint', style: { fontFamily: MONO, minWidth: 78 } },
  DC_ChCell: { type: 'Text', fontSize: 10, color: 'theme:textSecondary', style: { fontFamily: MONO, fontWeight: 700, minWidth: 120 } },
  DC_Msg: { type: 'Text', fontSize: 10, color: 'theme:text', style: { fontFamily: MONO, flexGrow: 1, minWidth: 0 } },
  DC_Fields: { type: 'Text', fontSize: 9, color: 'theme:textDim', style: { fontFamily: MONO } },
  DC_Dot: { type: 'Box', style: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'theme:textDim' } },

  // Per-severity dot + text (classes because token resolution is def-only).
  DC_DotTrace: { type: 'Box', style: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'theme:textFaint' } },
  DC_DotDebug: { type: 'Box', style: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'theme:textDim' } },
  DC_DotInfo: { type: 'Box', style: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'theme:info' } },
  DC_DotWarn: { type: 'Box', style: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'theme:warning' } },
  DC_DotError: { type: 'Box', style: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'theme:error' } },
  DC_SevTrace: { type: 'Text', fontSize: 9, color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 800, minWidth: 40 } },
  DC_SevDebug: { type: 'Text', fontSize: 9, color: 'theme:textDim', style: { fontFamily: MONO, fontWeight: 800, minWidth: 40 } },
  DC_SevInfo: { type: 'Text', fontSize: 9, color: 'theme:info', style: { fontFamily: MONO, fontWeight: 800, minWidth: 40 } },
  DC_SevWarn: { type: 'Text', fontSize: 9, color: 'theme:warning', style: { fontFamily: MONO, fontWeight: 800, minWidth: 40 } },
  DC_SevError: { type: 'Text', fontSize: 9, color: 'theme:error', style: { fontFamily: MONO, fontWeight: 900, minWidth: 40 } },

  DC_Empty: { type: 'Box', style: { padding: 24, alignItems: 'center', justifyContent: 'center' } },
  DC_EmptyText: { type: 'Text', fontSize: 11, color: 'theme:textDim', style: { fontFamily: MONO } },

  // ── Footer ─────────────────────────────────────────────────────────────────
  DC_Footer: { type: 'Box', style: { height: 30, flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 12, paddingRight: 12, backgroundColor: 'theme:surface', borderTopWidth: 'theme:borderThin', borderTopColor: 'theme:border' } },
  DC_FootText: { type: 'Text', fontSize: 9, color: 'theme:textDim', style: { fontFamily: MONO, fontWeight: 700 } },
  DC_Stepper: { type: 'Pressable', style: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusSm', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:primary' } },
  DC_StepperText: { type: 'Text', fontSize: 11, color: 'theme:textSecondary', style: { fontFamily: MONO, fontWeight: 900 } },

  // ── Named-capture dialog ───────────────────────────────────────────────────
  DC_CapScrim: { type: 'Box', blocksPointerEvents: true, style: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' } },
  DC_CapCard: { type: 'Box', style: { width: 460, flexDirection: 'column', gap: 9, padding: 14, borderRadius: 'theme:radiusLg', backgroundColor: 'theme:bgAlt', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' } },
  DC_CapTitle: { type: 'Text', fontSize: 12, color: 'theme:text', style: { fontWeight: 800 } },
  DC_CapLabel: { type: 'Text', fontSize: 9, color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 800, letterSpacing: 1 } },
  DC_CapInput: { type: 'TextInput', style: { height: 28, paddingLeft: 9, paddingRight: 9, borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg', color: 'theme:text', fontSize: 11, fontFamily: MONO } },
  DC_CapMeta: { type: 'Text', fontSize: 9, color: 'theme:textDim', style: { fontFamily: MONO } },
  DC_CapActions: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 } },
  DC_ThreadRow: { type: 'Pressable', style: { height: 26, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 8, paddingRight: 8, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:primary' } },
  DC_ThreadText: { type: 'Text', fontSize: 10, color: 'theme:textSecondary', style: { fontFamily: MONO, fontWeight: 700 } },
});
