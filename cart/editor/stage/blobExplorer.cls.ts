// editor/stage/blobExplorer.cls.ts — classifier styles for MODEL · RECOVERY
// (req_4775).
//
// The recovery pane was the last surface in the focus panel still drawing
// itself: a private 13-entry `COLORS` map of raw hexes, a private `TinyButton`,
// a private `Fact` row, and ~120 inline style objects. It did not look like the
// panel it lives in because it did not USE the panel — it reimplemented it.
//
// Names are HW_B* to stay collision-free in the global classifier registry, and
// every colour is a theme token so the pane follows the editor's palette
// instead of a copy of it made once and frozen. Where the shared sheet already
// has the control (HW_Pill for a toggle chip, HW_LensTab for a segmented tab,
// FactRow for a label/value line) this sheet does NOT restate it — it only
// declares what is genuinely specific to recovery: the face table row, the
// query header, and the service banner.
import { classifier } from '../../../runtime/classifier';
import { oneLine, wrapping } from '../panelText';

const MONO = 'monospace';

classifier({
  // ── shell ────────────────────────────────────────────────────────────────
  // The surface FLEXES. It used to be a hardcoded 640px tall inside a container
  // of whatever height the window gave it, which is one bug that reads as two:
  // dead space below it on a tall window, and overflow on a short one.
  HW_BSurface: { type: 'Box', style: { width: '100%', flexGrow: 1, minHeight: 0, flexDirection: 'column', backgroundColor: 'theme:bgAlt' } },
  HW_BScroll: { type: 'ScrollView', style: { width: '100%', flexGrow: 1, minHeight: 0 } },

  // ── query header (the four wrapping chip rows, curated) ──────────────────
  HW_BQuery: { type: 'Box', style: { width: '100%', flexShrink: 0, flexDirection: 'column', gap: 5, paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft' } },
  HW_BQueryRow: { type: 'Box', style: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 5 } },
  HW_BChipWrap: { type: 'Box', style: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 4 } },
  HW_BDisclosure: { type: 'Pressable', style: { flexShrink: 0, height: 22, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 7, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_BDisclosureOn: { type: 'Pressable', style: { flexShrink: 0, height: 22, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 7, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:segActiveBg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' } },
  HW_BDisclosureText: oneLine(9, 'theme:textDim', { fontFamily: MONO, fontWeight: 800, letterSpacing: 0.6 }),
  HW_BDisclosureTextOn: oneLine(9, 'theme:segActiveText', { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.6 }),

  // ── face table row ───────────────────────────────────────────────────────
  HW_BRow: { type: 'Box', style: { width: '100%', flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft', backgroundColor: 'theme:cardBg' } },
  HW_BRowOn: { type: 'Box', style: { width: '100%', flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft', backgroundColor: 'theme:segActiveBg' } },
  HW_BRowBody: { type: 'Pressable', style: { flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 1, paddingLeft: 10, paddingRight: 8, paddingTop: 6, paddingBottom: 6 } },
  HW_BRowTitle: { type: 'Box', style: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 6 } },
  HW_BRowName: oneLine(11, 'theme:text', { flexGrow: 1, fontWeight: 800 }),
  HW_BRowAddress: oneLine(9, 'theme:textFaint', { fontFamily: MONO }),
  HW_BRowLine: oneLine(9, 'theme:textDim', { fontFamily: MONO }),
  HW_BRowLineWarn: oneLine(9, 'theme:warning', { fontFamily: MONO }),
  HW_BRowExpander: { type: 'Pressable', style: { width: 34, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 'theme:borderThin', borderLeftColor: 'theme:borderSoft' }, hoverStyle: { backgroundColor: 'theme:surfaceHover' } },
  HW_BRowExpanderText: oneLine(10, 'theme:primary', { fontFamily: MONO, fontWeight: 900 }),
  HW_BTriangles: wrapping(9, 'theme:primary', { fontFamily: MONO, paddingLeft: 10, paddingRight: 10, paddingBottom: 7, lineHeight: 12 }),

  // ── notices: an issue, an error, a degradation ───────────────────────────
  HW_BNotice: { type: 'Pressable', style: { width: '100%', flexDirection: 'column', gap: 2, paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7, backgroundColor: 'theme:cardBg', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft', borderLeftWidth: 2, borderLeftColor: 'theme:warning' } },
  HW_BNoticeError: { type: 'Box', style: { width: '100%', flexDirection: 'column', gap: 2, paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7, backgroundColor: 'theme:cardBg', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft', borderLeftWidth: 2, borderLeftColor: 'theme:error' } },
  HW_BNoticeTitle: oneLine(10, 'theme:warning', { fontFamily: MONO, fontWeight: 800, letterSpacing: 0.5 }),
  HW_BNoticeBody: wrapping(9, 'theme:textDim', { fontFamily: MONO, lineHeight: 12 }),

  // ── service banner + log blocks ──────────────────────────────────────────
  HW_BBanner: { type: 'Box', style: { width: '100%', flexDirection: 'column', gap: 3, paddingLeft: 10, paddingRight: 10, paddingTop: 9, paddingBottom: 9, backgroundColor: 'theme:cardBg', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border', borderLeftWidth: 3, borderLeftColor: 'theme:success' } },
  HW_BBannerTitle: oneLine(12, 'theme:success', { fontFamily: MONO, fontWeight: 900, letterSpacing: 1 }),
  HW_BBannerCopy: wrapping(9, 'theme:textDim', { fontFamily: MONO, lineHeight: 12 }),
  // A log line is SCANNED, not read: one line each, elided at the edge, with the
  // full text on the row's hover. Wrapping turned a service that logs its whole
  // config as one debug struct into a forty-line wall (req_4776).
  HW_BLogRow: { type: 'Box', hoverable: true, style: { width: '100%', flexDirection: 'row', minWidth: 0 } },
  HW_BLogLine: oneLine(9, 'theme:textFaint', { fontFamily: MONO }),
  HW_BCommandLine: oneLine(9, 'theme:primary', { fontFamily: MONO }),

  // ── inputs ───────────────────────────────────────────────────────────────
  HW_BInput: { type: 'TextInput', style: { width: '100%', height: 24, paddingLeft: 8, paddingRight: 7, borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg', color: 'theme:text', fontSize: 10, fontFamily: MONO } },
  HW_BInputBad: { type: 'TextInput', style: { width: '100%', height: 24, paddingLeft: 8, paddingRight: 7, borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:error', backgroundColor: 'theme:controlBg', color: 'theme:text', fontSize: 10, fontFamily: MONO } },
  HW_BGuardBox: { type: 'Box', style: { width: '100%', flexDirection: 'column', gap: 5, padding: 8, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:cardBg', borderWidth: 'theme:borderThin', borderColor: 'theme:warning' } },
  HW_BGuardWarn: wrapping(9, 'theme:warning', { fontFamily: MONO, fontWeight: 800, lineHeight: 12 }),
  HW_BGuardNote: wrapping(9, 'theme:textFaint', { fontFamily: MONO, lineHeight: 12 }),

  // ── the pager footer, pinned under the scroll ────────────────────────────
  HW_BPager: { type: 'Box', style: { width: '100%', flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderTopWidth: 'theme:borderThin', borderTopColor: 'theme:border' } },
  HW_BPagerText: oneLine(9, 'theme:textFaint', { flexGrow: 1, fontFamily: MONO }),
});
