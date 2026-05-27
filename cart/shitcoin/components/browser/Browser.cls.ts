// Browser skin sheet — Chrome/Brave/Firefox-style top chrome with
// tabs, URL bar, and a content viewport. The variant flips colors and
// tab radii; layout stays consistent.

import { classifier } from '../../../../runtime/classifier';

classifier({
  BrowserRoot: {
    type: 'Box',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      flexDirection: 'column',
      backgroundColor: 'theme:bg',
    },
  },

  BrowserTabStrip: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 2,
      paddingLeft: 6,
      paddingRight: 6,
      paddingTop: 6,
      backgroundColor: 'theme:bgAlt',
      borderBottomWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
  },

  BrowserTab: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 8,
      paddingTop: 6,
      paddingBottom: 6,
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      borderBottomWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 200,
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
    variants: {
      firefox: { style: { borderTopLeftRadius: 4, borderTopRightRadius: 4 } },
      brave:   { style: { borderTopLeftRadius: 12, borderTopRightRadius: 12 } },
    },
  },

  BrowserTabActive: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 8,
      paddingTop: 6,
      paddingBottom: 6,
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
      backgroundColor: 'theme:bg',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      borderBottomWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 200,
    },
  },

  BrowserTabTitle: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textSecondary', flexGrow: 1, flexBasis: 0 },
  },

  BrowserTabTitleActive: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:text', fontWeight: 'bold', flexGrow: 1, flexBasis: 0 },
  },

  BrowserTabClose: {
    type: 'Pressable',
    style: {
      width: 16,
      height: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
  },

  BrowserTabCloseText: {
    type: 'Text',
    style: { fontSize: 10, color: 'theme:textDim' },
  },

  BrowserNewTabBtn: {
    type: 'Pressable',
    style: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 4,
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
  },

  BrowserNewTabBtnText: {
    type: 'Text',
    style: { fontSize: 16, color: 'theme:textSecondary' },
  },

  BrowserToolbar: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 6,
      paddingBottom: 6,
      backgroundColor: 'theme:bg',
      borderBottomWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
  },

  BrowserNavBtn: {
    type: 'Pressable',
    style: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
  },

  BrowserNavBtnText: {
    type: 'Text',
    style: { fontSize: 14, color: 'theme:textSecondary' },
  },

  BrowserUrlBar: {
    type: 'TextInput',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      height: 30,
      paddingLeft: 12,
      paddingRight: 12,
      borderRadius: 15,
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      color: 'theme:text',
      fontSize: 'theme:fontSm',
    },
  },

  BrowserViewport: {
    type: 'ScrollView',
    style: { flexGrow: 1, flexBasis: 0, backgroundColor: 'theme:bg' },
  },

  BrowserViewportInner: {
    type: 'Box',
    style: { flexDirection: 'column', padding: 16, gap: 16 },
  },

  BrowserNotFound: {
    type: 'Box',
    style: { flexDirection: 'column', alignItems: 'center', gap: 8, padding: 40 },
  },

  BrowserNotFoundTitle: {
    type: 'Text',
    style: { fontSize: 24, color: 'theme:text', fontWeight: 'bold' },
  },

  BrowserNotFoundSub: {
    type: 'Text',
    style: { fontSize: 'theme:fontMd', color: 'theme:textDim' },
  },
});
