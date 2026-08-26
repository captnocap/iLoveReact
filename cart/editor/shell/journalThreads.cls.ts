// editor/shell/journalThreads.cls.ts — classifier styles for the interactive
// build-journal threads surface. Registered separately from workspace.cls.ts so
// the journal-thread UI owns its own controls without growing the shared sheet.
// Names are HW_J* to stay collision-free in the global classifier registry.
import { classifier } from '../../../runtime/classifier';
import { oneLine, oneLineColumn, wrapping } from '../panelText';

const MONO = 'monospace';

classifier({
  HW_JNoteCardOn: { type: 'Box', style: { minHeight: 92, gap: 6, padding: 9, borderRadius: 'theme:radiusLg', backgroundColor: 'theme:cardBg', borderWidth: 2, borderColor: 'theme:primary' } },
  HW_JFoot: { type: 'Box', style: { minHeight: 20, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingTop: 4, borderTopWidth: 'theme:borderThin', borderTopColor: 'theme:borderSoft' } },
  HW_JThreadChip: { type: 'Pressable', style: { height: 18, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 5, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:segActiveBg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_JMini: { type: 'Pressable', style: { height: 18, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 6, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:textDim' } },
  HW_JMiniOn: { type: 'Pressable', style: { height: 18, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 6, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:segActiveBg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_JMiniText: oneLine(8, 'theme:textDim', { fontFamily: MONO, fontWeight: 800, letterSpacing: 0.5 }),
  HW_JMiniTextOn: oneLine(8, 'theme:segActiveText', { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.5 }),
  HW_JAttachPanel: { type: 'Box', style: { flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 8, padding: 9, borderRadius: 'theme:radiusLg', backgroundColor: 'theme:bgElevated', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', overflow: 'scroll' } },
  HW_JCreateBtn: { type: 'Pressable', style: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 9, paddingRight: 9, borderRadius: 'theme:radiusLg', backgroundColor: 'theme:segActiveBg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_JResults: { type: 'Box', style: { flexDirection: 'column', gap: 6 } },
  HW_JRow: { type: 'Pressable', style: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 'theme:radiusLg', backgroundColor: 'theme:cardBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_JRowMain: { type: 'Box', style: { flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 2 } },
  HW_JNameInput: { type: 'TextInput', style: { flexGrow: 1, minWidth: 0, height: 22, paddingLeft: 8, paddingRight: 7, borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', backgroundColor: 'theme:controlBg', color: 'theme:text', fontSize: 11, fontWeight: 800 } },
  HW_JDescEdit: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 6 } },
  HW_JDescInput: { type: 'TextInput', style: { flexGrow: 1, minWidth: 0, height: 24, paddingLeft: 8, paddingRight: 7, borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', backgroundColor: 'theme:controlBg', color: 'theme:textSecondary', fontSize: 10, fontFamily: MONO } },
  HW_JDescRow: { type: 'Pressable', style: { minHeight: 22, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' }, hoverStyle: { borderColor: 'theme:textDim' } },
  HW_JDescText: wrapping(10, 'theme:textSecondary', { fontFamily: MONO, lineHeight: 15 }),
  HW_JDescEmpty: { type: 'Pressable', style: { minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 8, borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft', borderStyle: 'dashed', backgroundColor: 'theme:controlBg' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_JIdRow: { type: 'Box', style: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 } },
  HW_JAlias: { type: 'Box', style: { height: 16, justifyContent: 'center', paddingLeft: 6, paddingRight: 6, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' } },
  HW_JDelivery: { type: 'Box', style: { minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' } },
  HW_JDeliveryMain: { type: 'Box', style: { flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 1 } },
  HW_JCapture: { type: 'Box', style: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:bgElevated', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' } },
  HW_JCaptureMain: { type: 'Box', style: { flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 1 } },
  HW_JCaptureAttach: { type: 'Box', style: { flexDirection: 'column', gap: 5, padding: 6, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' } },
  HW_JCaptureBtn: { type: 'Pressable', style: { height: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:primary' } },

  // ── ranked attempts: the pile turned into a scored haystack ─────────────────
  // A thread header tally — the anti-bullshit meter (attempts · commits · gospel).
  HW_JTally: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 2, paddingBottom: 2 } },
  HW_JTallyText: oneLine(9, 'theme:textDim', { fontFamily: MONO, fontWeight: 700, letterSpacing: 0.4 }),
  // One attempt row. The gospel variant glows gold so the needle is unmissable.
  HW_JAttempt: { type: 'Box', style: { flexDirection: 'column', gap: 5, padding: 8, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' } },
  HW_JAttemptGospel: { type: 'Box', style: { flexDirection: 'column', gap: 5, padding: 8, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:segActiveBg', borderWidth: 2, borderColor: 'theme:warning' } },
  HW_JAttemptHead: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 7 } },
  HW_JAttemptMain: { type: 'Box', style: { flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 2 } },
  HW_JAskText: wrapping(10, 'theme:text', { fontFamily: MONO, fontWeight: 700, lineHeight: 14 }),
  HW_JClaimText: wrapping(9, 'theme:textDim', { fontFamily: MONO, lineHeight: 13 }),
  HW_JClaimLabel: oneLine(8, 'theme:textFaint', { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.6 }),
  HW_JAttemptMeta: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 } },
  HW_JMetaText: oneLine(8, 'theme:textFaint', { fontFamily: MONO, fontWeight: 700, letterSpacing: 0.3 }),
  // Crown toggle — press to anoint (or dethrone) the gospel.
  HW_JCrown: { type: 'Pressable', style: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusSm', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:warning' } },
  HW_JCrownOn: { type: 'Pressable', style: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 'theme:radiusSm', backgroundColor: 'theme:warning', borderWidth: 'theme:borderThin', borderColor: 'theme:warning' } },
  // Commit-evidence chip. The "none" variant calls out zero-commit hot air.
  HW_JCommitChip: { type: 'Box', style: { height: 16, flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 5, paddingRight: 6, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:success' } },
  HW_JCommitNone: { type: 'Box', style: { height: 16, flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 5, paddingRight: 6, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:error' } },
  HW_JCommitText: oneLine(8, 'theme:textSecondary', { fontFamily: MONO, fontWeight: 800 }),
  // Rating strip — ten pips, click to score 1..10. Filled pips carry the band color.
  HW_JRate: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 3 } },
  HW_JRateLabel: oneLine(8, 'theme:textFaint', { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.5 }),
  HW_JPip: { type: 'Pressable', style: { width: 12, height: 12, borderRadius: 3, backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_JScore: { type: 'Box', style: { minWidth: 30, height: 16, alignItems: 'center', justifyContent: 'center', paddingLeft: 5, paddingRight: 5, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:bgElevated' } },
  // The single call site always supplies the band colour; the base below is
  // never painted, it is what lets this class state its overflow policy.
  HW_JScoreText: oneLine(9, 'theme:text', { fontFamily: MONO, fontWeight: 900 }),
  HW_JStatusTag: { type: 'Box', style: { height: 15, justifyContent: 'center', paddingLeft: 5, paddingRight: 5, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:bgElevated', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' } },
  HW_JStatusText: oneLine(8, 'theme:textDim', { fontFamily: MONO, fontWeight: 800, letterSpacing: 0.4 }),
});
