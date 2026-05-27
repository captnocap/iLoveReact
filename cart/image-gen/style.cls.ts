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
  AppButton: {
    type: 'Pressable',
    style: {
      paddingLeft: 14,
      paddingRight: 14,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:primary',
    },
    hoverStyle: { backgroundColor: 'theme:primaryHover' },
  },
  AppButtonLabel: { type: 'Text', fontSize: 'theme:fontSm', color: '#ffffff', fontWeight: 'bold' },
  AppButtonOutline: {
    type: 'Pressable',
    style: {
      paddingLeft: 14,
      paddingRight: 14,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover', borderColor: 'theme:borderFocus' },
  },
  AppButtonOutlineLabel: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:text' },
  AppListItem: {
    type: 'Pressable',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 'theme:spacingSm',
      gap: 8,
      borderRadius: 'theme:radiusSm',
    },
    hoverStyle: { backgroundColor: 'theme:bgElevated' },
  },
  AppListItemText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:text' },
  AppListItemDim: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textDim' },
  AppDangerButton: {
    type: 'Pressable',
    style: {
      paddingLeft: 14,
      paddingRight: 14,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:error',
    },
    hoverStyle: { backgroundColor: '#ff6b7a' },
  },
  AppDangerButtonLabel: { type: 'Text', fontSize: 'theme:fontSm', color: '#ffffff', fontWeight: 'bold' },
});

export { C };
