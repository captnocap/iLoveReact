// editor/editor.cls.ts — the editor shell's classifier sheet.
//
// The ONLY styling layer for this cart (no inline styles). Colors are 'theme:NAME'
// tokens owned by ./theme.ts. Same approach the workspace mock locked in.
import { classifier, classifiers as C, getColors, setStyleTokens, setTokens } from '../../runtime/classifier';
import { EDITOR_COLORS, EDITOR_STYLES } from './theme';

setTokens(EDITOR_COLORS);
setStyleTokens(EDITOR_STYLES);

export function accentFor(token: string): string {
  return (getColors() as Record<string, string>)[token] ?? token;
}

const MONO = 'monospace';

classifier({
  // Shell frame
  ED_App: { type: 'Box', style: { width: '100%', height: '100%', flexDirection: 'column', position: 'relative', backgroundColor: 'theme:bg', overflow: 'hidden' } },
  ED_Chrome: { type: 'Box', style: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, backgroundColor: 'theme:surface', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border' } },
  ED_Brand: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingRight: 12, borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:borderSoft' } },
  ED_BrandText: { type: 'Text', fontSize: 11, color: 'theme:text', style: { fontFamily: MONO, fontWeight: 800, letterSpacing: 2 } },
  ED_Spacer: { type: 'Box', style: { flexGrow: 1, minWidth: 0 } },

  // Route tabs (Editor / Play)
  ED_Tab: { type: 'Pressable', style: { height: 26, alignItems: 'center', justifyContent: 'center', paddingLeft: 12, paddingRight: 12, borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' }, hoverStyle: { borderColor: 'theme:textDim' } },
  ED_TabOn: { type: 'Pressable', style: { height: 26, alignItems: 'center', justifyContent: 'center', paddingLeft: 12, paddingRight: 12, borderRadius: 'theme:radiusLg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary', backgroundColor: 'theme:segActiveBg' } },
  ED_TabText: { type: 'Text', fontSize: 11, color: 'theme:textSecondary', style: { fontFamily: MONO, fontWeight: 700 } },
  ED_TabTextOn: { type: 'Text', fontSize: 11, color: 'theme:segActiveText', style: { fontFamily: MONO, fontWeight: 800 } },

  // Route toggle — floats top-right over the workspace; the platform-level
  // Editor/Play switch (distinct from the workspace's own chrome).
  ED_RouteToggle: { type: 'Box', style: { position: 'absolute', top: 6, right: 10, zIndex: 9000, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 3, borderRadius: 'theme:radiusLg', backgroundColor: 'theme:bgAlt', borderWidth: 'theme:borderThin', borderColor: 'theme:border' } },

  // Stage (route body)
  ED_Stage: { type: 'Box', style: { flexGrow: 1, minWidth: 0, position: 'relative', backgroundColor: 'theme:stageBg' } },

  // /editor scaffold (placeholder until the authoring shell mounts here)
  ED_Scaffold: { type: 'Box', style: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 } },
  ED_ScaffoldTitle: { type: 'Text', fontSize: 18, color: 'theme:textSecondary', style: { fontWeight: 700 } },
  ED_ScaffoldHint: { type: 'Text', fontSize: 12, color: 'theme:textFaint', style: { fontFamily: MONO } },
});

export { C };
