import { classifier, classifiers as C } from '../../runtime/classifier';

classifier({
  AppRoot: {
    type: 'Box',
    style: { width: '100%', height: '100%', backgroundColor: 'theme:bg' },
  },
  AppShell: {
    type: 'Box',
    style: {
      width: '100%',
      height: '100%',
      padding: 'theme:spacingLg',
      gap: 'theme:spacingMd',
      backgroundColor: 'theme:bg',
    },
  },
  AppHeader: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'theme:spacingMd',
    },
  },
  AppTitleBlock: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 3, flexGrow: 1, flexBasis: 0 },
  },
  AppKicker: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:accent' },
  AppTitle: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:text', fontWeight: 'bold' },
  AppSubtle: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textSecondary' },
  AppDim: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textDim' },
  AppNav: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingSm' },
  },
  AppNavItem: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 7,
      paddingBottom: 7,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover', borderColor: 'theme:borderFocus' },
  },
  AppNavText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:text' },
  AppBody: {
    type: 'Box',
    style: { flexGrow: 1, flexBasis: 0, gap: 'theme:spacingMd' },
  },
  AppRow: {
    type: 'Box',
    style: { flexDirection: 'row', gap: 'theme:spacingMd' },
  },
  AppPanel: {
    type: 'Box',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      padding: 'theme:spacingMd',
      gap: 'theme:spacingSm',
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    bp: {
      sm: { style: { flexBasis: 'auto' } },
    },
  },
  AppPanelTitle: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:text', fontWeight: 'bold' },
  AppMetric: { type: 'Text', fontSize: 28, color: 'theme:text', fontWeight: 'bold' },
  AppBadge: {
    type: 'Box',
    style: {
      alignSelf: 'flex-start',
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 4,
      paddingBottom: 4,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgElevated',
    },
  },
  AppBadgeText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:accent' },
  AppTextInput: {
    type: 'TextInput',
    style: {
      height: 36,
      paddingLeft: 10,
      paddingRight: 10,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      color: 'theme:text',
    },
  },
  AppCanvasFrame: {
    type: 'Box',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      overflow: 'hidden',
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
  },

  // ── Tape table — all stable identities ────────────────────────────────
  // The dense list is the hot path; every cell needs a stable class so
  // the React reconciler can skip UPDATE emits for repeating rows. The
  // only dynamic bits are the side variants (buy/sell color) and the
  // highlight on big-USD rows — those get their own variant entries.
  TapeRow: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 4,
      paddingBottom: 4,
      paddingLeft: 8,
      paddingRight: 8,
      borderBottomWidth: 1,
      borderColor: 'rgba(255,255,255,0.03)',
    },
  },
  TapeRowHot: {
    // Big-USD rows get a faint yellow tint.
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 4,
      paddingBottom: 4,
      paddingLeft: 8,
      paddingRight: 8,
      backgroundColor: 'rgba(255,210,74,0.06)',
      borderBottomWidth: 1,
      borderColor: 'rgba(255,255,255,0.03)',
    },
  },
  TapeHeaderRow: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      paddingTop: 6,
      paddingBottom: 6,
      paddingLeft: 8,
      paddingRight: 8,
      borderBottomWidth: 1,
      borderColor: 'rgba(255,255,255,0.10)',
    },
  },
  TapeHeaderCellSide:   { type: 'Text', style: { fontSize: 10, color: '#5a6275', width: 50, fontWeight: 'bold' } },
  TapeHeaderCellToken:  { type: 'Text', style: { fontSize: 10, color: '#5a6275', width: 70, fontWeight: 'bold' } },
  TapeHeaderCellFlex:   { type: 'Text', style: { fontSize: 10, color: '#5a6275', flexGrow: 1, textAlign: 'right', fontWeight: 'bold' } },
  TapeHeaderCellW70:    { type: 'Text', style: { fontSize: 10, color: '#5a6275', width: 70, textAlign: 'right', fontWeight: 'bold' } },
  TapeHeaderCellW60:    { type: 'Text', style: { fontSize: 10, color: '#5a6275', width: 60, textAlign: 'right', fontWeight: 'bold' } },
  TapeSideBuy:          { type: 'Text', style: { fontSize: 11, color: '#4ade80', width: 50, fontWeight: 'bold' } },
  TapeSideSell:         { type: 'Text', style: { fontSize: 11, color: '#f87171', width: 50, fontWeight: 'bold' } },
  TapeCellToken:        { type: 'Text', style: { fontSize: 11, color: '#d7dde8', width: 70 } },
  TapeCellFlex:         { type: 'Text', style: { fontSize: 11, color: '#d7dde8', flexGrow: 1, textAlign: 'right' } },
  TapeCellFlexDim:      { type: 'Text', style: { fontSize: 11, color: '#8a93a6', flexGrow: 1, textAlign: 'right' } },
  TapeCellW70Dim:       { type: 'Text', style: { fontSize: 11, color: '#8a93a6', width: 70, textAlign: 'right' } },
  TapeCellW60Dim:       { type: 'Text', style: { fontSize: 11, color: '#5a6275', width: 60, textAlign: 'right' } },
});

export { C };
