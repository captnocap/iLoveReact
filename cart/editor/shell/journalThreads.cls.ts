// editor/shell/journalThreads.cls.ts — classifier styles for the interactive
// build-journal threads surface. Registered separately from workspace.cls.ts so
// the journal-thread UI owns its own controls without growing the shared sheet.
// Names are HW_J* to stay collision-free in the global classifier registry.
import { classifier } from '../../../runtime/classifier';

const MONO = 'monospace';

classifier({
  HW_JNoteCardOn: { type: 'Box', style: { minHeight: 92, gap: 6, padding: 9, borderRadius: 'theme:radiusLg', backgroundColor: 'theme:cardBg', borderWidth: 2, borderColor: 'theme:primary' } },
  HW_JFoot: { type: 'Box', style: { minHeight: 20, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingTop: 4, borderTopWidth: 'theme:borderThin', borderTopColor: 'theme:borderSoft' } },
  HW_JThreadChip: { type: 'Pressable', style: { height: 18, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 5, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:segActiveBg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_JMini: { type: 'Pressable', style: { height: 18, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 6, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:textDim' } },
  HW_JMiniOn: { type: 'Pressable', style: { height: 18, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 6, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:segActiveBg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_JMiniText: { type: 'Text', fontSize: 8, color: 'theme:textDim', style: { fontFamily: MONO, fontWeight: 800, letterSpacing: 0.5 } },
  HW_JMiniTextOn: { type: 'Text', fontSize: 8, color: 'theme:segActiveText', style: { fontFamily: MONO, fontWeight: 900, letterSpacing: 0.5 } },
  HW_JAttachPanel: { type: 'Box', style: { flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 8, padding: 9, borderRadius: 'theme:radiusLg', backgroundColor: 'theme:bgElevated', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', overflow: 'scroll' } },
  HW_JCreateBtn: { type: 'Pressable', style: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 9, paddingRight: 9, borderRadius: 'theme:radiusLg', backgroundColor: 'theme:segActiveBg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_JResults: { type: 'Box', style: { flexDirection: 'column', gap: 6 } },
  HW_JRow: { type: 'Pressable', style: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 'theme:radiusLg', backgroundColor: 'theme:cardBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:primary' } },
  HW_JRowMain: { type: 'Box', style: { flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 2 } },
  HW_JNameInput: { type: 'TextInput', style: { flexGrow: 1, minWidth: 0, height: 22, paddingLeft: 8, paddingRight: 7, borderRadius: 'theme:radiusMd', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', backgroundColor: 'theme:controlBg', color: 'theme:text', fontSize: 11, fontWeight: 800 } },
  HW_JIdRow: { type: 'Box', style: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 } },
  HW_JAlias: { type: 'Box', style: { height: 16, justifyContent: 'center', paddingLeft: 6, paddingRight: 6, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' } },
  HW_JDelivery: { type: 'Box', style: { minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' } },
  HW_JDeliveryMain: { type: 'Box', style: { flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 1 } },
  HW_JCapture: { type: 'Box', style: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:bgElevated', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' } },
  HW_JCaptureMain: { type: 'Box', style: { flexGrow: 1, minWidth: 0, flexDirection: 'column', gap: 1 } },
  HW_JCaptureAttach: { type: 'Box', style: { flexDirection: 'column', gap: 5, padding: 6, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:borderSoft' } },
  HW_JCaptureBtn: { type: 'Pressable', style: { height: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:controlBg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' }, hoverStyle: { borderColor: 'theme:primary' } },
});
