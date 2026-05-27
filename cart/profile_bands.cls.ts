// profile_bands — meta-shaped card vocabulary.
//
//   Card
//   ├─ Header (identity band)
//   │  ├─ Header.A → Avatar
//   │  ├─ Header.B → Name
//   │  └─ Header.C → Title
//   ├─ Body
//   │  └─ Body.A → Bio
//   └─ Footer
//      ├─ Footer.A → Stat 1
//      └─ Footer.B → Stat 2
//
// JSX commits to this skeleton. Variants reshape three levels:
//   1. Card-level direction / size
//   2. Each band's internal layout (row vs column, gap, alignment)
//   3. Each cell's appearance + occasionally display:none to null
//
// Where flow falls short (true overlay, corner badges), absolute is
// *scoped inside a band* rather than floated against the card root.

import { classifier } from '../runtime/classifier';

classifier({
  // ── Card ───────────────────────────────────────────────
  PB_Card: {
    type: 'Box',
    style: {
      width: 360,
      height: 480,
      padding: 24,
      flexDirection: 'column',
      alignItems: 'center',
      gap: 14,
      backgroundColor: 'theme:surface',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'theme:border',
      overflow: 'hidden',
    },
    variants: {
      idcard: {
        style: {
          width: 560,
          height: 160,
          padding: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 18,
        },
      },
      magazine: {
        style: { padding: 0, position: 'relative' },
      },
      quote: {
        style: {
          width: 560,
          height: 320,
          padding: 40,
          flexDirection: 'column-reverse',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          backgroundColor: 'theme:bgAlt',
        },
      },
      trading: {
        style: {
          width: 320,
          height: 480,
          padding: 0,
          alignItems: 'stretch',
          borderRadius: 14,
          borderWidth: 2,
          borderColor: 'theme:accent',
        },
      },
    },
    dims: {
      density: {
        dense: { style: { padding: 14, gap: 6 } },
        airy:  { style: { padding: 36, gap: 22 } },
      },
    },
  },

  // ── Header band ────────────────────────────────────────
  PB_Header: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
    },
    variants: {
      idcard: {
        style: {
          flexDirection: 'column',
          alignItems: 'flex-start',
          width: 150,
          gap: 4,
        },
      },
      magazine: {
        style: {
          position: 'relative',
          flexGrow: 1,
          width: '100%',
        },
      },
      quote: {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          alignSelf: 'flex-end',
        },
      },
      trading: {
        style: {
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 0,
        },
      },
    },
    dims: {
      anchor: {
        left:   { style: { alignItems: 'flex-start' } },
        center: { style: { alignItems: 'center' } },
        right:  { style: { alignItems: 'flex-end' } },
      },
    },
  },

  PB_HeaderA: {
    type: 'Box',
    style: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: '#8B5CF6',
      alignItems: 'center',
      justifyContent: 'center',
    },
    variants: {
      idcard: {
        style: { width: 56, height: 56, borderRadius: 10 },
      },
      magazine: {
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          borderRadius: 0,
        },
      },
      quote: {
        style: { width: 18, height: 18, borderRadius: 9 },
      },
      trading: {
        style: { width: '100%', height: 260, borderRadius: 0 },
      },
    },
  },

  PB_Initial: {
    type: 'Text',
    style: {
      fontSize: 44,
      color: '#ffffff',
      fontWeight: 'bold',
    },
    variants: {
      idcard: { style: { fontSize: 24 } },
      magazine: { style: { fontSize: 280, color: 'rgba(255,255,255,0.10)' } },
      quote: { style: { fontSize: 11 } },
      trading: { style: { fontSize: 140, color: 'rgba(255,255,255,0.85)' } },
    },
  },

  PB_HeaderB: {
    type: 'Text',
    style: {
      fontSize: 22,
      color: 'theme:text',
      fontWeight: 'bold',
    },
    variants: {
      idcard: { style: { fontSize: 16, marginTop: 6 } },
      magazine: {
        style: {
          position: 'absolute',
          left: 24,
          bottom: 28,
          right: 24,
          fontSize: 36,
          color: '#ffffff',
        },
      },
      quote: {
        style: { fontSize: 13, color: 'theme:textSecondary' },
      },
      trading: {
        style: {
          width: '100%',
          fontSize: 20,
          color: '#1a1410',
          backgroundColor: 'theme:accent',
          textAlign: 'center',
          paddingTop: 11,
          paddingBottom: 11,
          marginTop: -22,
        },
      },
    },
    dims: {
      anchor: {
        left:   { style: { textAlign: 'left', alignSelf: 'flex-start' } },
        center: { style: { textAlign: 'center', alignSelf: 'center' } },
        right:  { style: { textAlign: 'right', alignSelf: 'flex-end' } },
      },
    },
  },

  PB_HeaderC: {
    type: 'Text',
    style: {
      fontSize: 11,
      color: 'theme:textDim',
      letterSpacing: 1,
    },
    variants: {
      idcard: { style: { fontSize: 10 } },
      magazine: {
        style: {
          position: 'absolute',
          left: 24,
          bottom: 76,
          fontSize: 11,
          color: 'theme:accent',
          letterSpacing: 2,
        },
      },
      quote: {
        style: { fontSize: 11, color: 'theme:textDim' },
      },
      trading: {
        style: {
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 10,
          paddingBottom: 6,
          fontSize: 10,
        },
      },
    },
    dims: {
      anchor: {
        left:   { style: { textAlign: 'left', alignSelf: 'flex-start' } },
        center: { style: { textAlign: 'center', alignSelf: 'center' } },
        right:  { style: { textAlign: 'right', alignSelf: 'flex-end' } },
      },
    },
  },

  // ── Body band ──────────────────────────────────────────
  PB_Body: {
    type: 'Box',
    style: {
      width: '100%',
      marginTop: 6,
    },
    variants: {
      idcard: {
        style: {
          flexGrow: 1,
          marginTop: 0,
          paddingTop: 4,
          paddingBottom: 4,
        },
      },
      magazine: {
        style: { display: 'none' },
      },
      quote: {
        style: { width: '100%', marginTop: 0 },
      },
      trading: {
        style: {
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 8,
          marginTop: 0,
        },
      },
    },
  },

  PB_BodyA: {
    type: 'Text',
    style: {
      fontSize: 14,
      color: 'theme:textSecondary',
      lineHeight: 21,
      textAlign: 'center',
    },
    variants: {
      idcard: {
        style: {
          fontSize: 12,
          color: 'theme:textDim',
          lineHeight: 16,
          textAlign: 'left',
        },
        numberOfLines: 4,
      },
      quote: {
        style: {
          fontSize: 22,
          color: 'theme:text',
          lineHeight: 32,
          textAlign: 'left',
        },
      },
      trading: {
        style: {
          fontSize: 13,
          color: 'theme:textSecondary',
          lineHeight: 19,
          textAlign: 'left',
        },
      },
    },
    dims: {
      anchor: {
        left:   { style: { textAlign: 'left' } },
        center: { style: { textAlign: 'center' } },
        right:  { style: { textAlign: 'right' } },
      },
    },
  },

  // ── Footer band ────────────────────────────────────────
  PB_Footer: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      gap: 16,
      marginTop: 'auto',
      paddingTop: 12,
    },
    variants: {
      idcard: {
        style: {
          flexDirection: 'column',
          gap: 4,
          marginTop: 0,
          paddingTop: 0,
          alignItems: 'flex-end',
          width: 110,
        },
      },
      magazine: {
        style: {
          position: 'absolute',
          top: 18,
          right: 18,
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
          marginTop: 0,
          paddingTop: 0,
        },
      },
      quote: { style: { display: 'none' } },
      trading: {
        style: {
          flexDirection: 'row',
          gap: 8,
          marginTop: 'auto',
          paddingLeft: 16,
          paddingRight: 16,
          paddingBottom: 14,
          paddingTop: 12,
          alignSelf: 'stretch',
          justifyContent: 'flex-end',
        },
      },
    },
    dims: {
      anchor: {
        left:   { style: { justifyContent: 'flex-start' } },
        center: { style: { justifyContent: 'center' } },
        right:  { style: { justifyContent: 'flex-end' } },
      },
      density: {
        dense: { style: { gap: 4, paddingTop: 6 } },
        airy:  { style: { gap: 28, paddingTop: 20 } },
      },
    },
  },

  PB_FooterA: {
    type: 'Text',
    style: { fontSize: 12, color: 'theme:textDim' },
    variants: {
      idcard: {
        style: {
          fontSize: 11,
          color: 'theme:textDim',
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 3,
          paddingBottom: 3,
          backgroundColor: 'theme:bgElevated',
          borderRadius: 4,
        },
      },
      magazine: {
        style: {
          fontSize: 10,
          color: '#ffffff',
          backgroundColor: 'rgba(0,0,0,0.45)',
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 3,
          paddingBottom: 3,
          borderRadius: 999,
          letterSpacing: 1,
        },
      },
      trading: {
        style: {
          fontSize: 11,
          color: '#1a1410',
          backgroundColor: 'theme:accent',
          fontWeight: 'bold',
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 3,
          paddingBottom: 3,
          borderRadius: 4,
        },
      },
    },
  },

  // ── App shell vocabulary ──────────────────────────────
  //   App
  //   ├─ Shell        (persistent frame; transparent where page bleeds)
  //   │  ├─ Shell.Brand
  //   │  ├─ Shell.Nav  ─ Shell.NavItem (× N)
  //   │  └─ Shell.Status
  //   └─ Page          (per-route content; holds the card + switcher)
  //
  // Variants reshape *where the shell is* and *whether it pushes or
  // overlays the page*. The base composition has the shell across the
  // top pushing the page below. Variants migrate it to a rail, collapse
  // it to a peek, overlay it transparently, or float it as an island.

  PB_App: {
    type: 'Box',
    style: {
      width: '100%',
      height: '100%',
      backgroundColor: 'theme:bg',
      flexDirection: 'column',
      position: 'relative',
    },
    variants: {
      idcard: { style: { flexDirection: 'row' } },
      magazine: { style: { flexDirection: 'column' } },
      quote: { style: { flexDirection: 'column' } },
      trading: { style: { flexDirection: 'column' } },
    },
  },

  PB_Shell: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
      height: 56,
      paddingLeft: 18,
      paddingRight: 18,
      gap: 14,
      backgroundColor: 'theme:bgAlt',
      borderBottomWidth: 1,
      borderColor: 'theme:border',
    },
    variants: {
      idcard: {
        style: {
          flexDirection: 'column',
          alignItems: 'flex-start',
          width: 200,
          height: '100%',
          paddingTop: 22,
          paddingBottom: 22,
          paddingLeft: 16,
          paddingRight: 16,
          gap: 6,
          backgroundColor: 'theme:bgAlt',
          borderBottomWidth: 0,
          borderRightWidth: 1,
          borderColor: 'theme:border',
        },
      },
      magazine: {
        // Shell collapses to a peek — just the brand dot in the corner.
        style: {
          position: 'absolute',
          top: 18,
          left: 18,
          width: 36,
          height: 36,
          paddingLeft: 0,
          paddingRight: 0,
          gap: 0,
          backgroundColor: 'rgba(0,0,0,0.0)',
          borderBottomWidth: 0,
          zIndex: 10,
        },
      },
      quote: {
        // Transparent overlay strip — page bleeds underneath.
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          width: '100%',
          height: 56,
          backgroundColor: 'rgba(0,0,0,0.0)',
          borderBottomWidth: 0,
          zIndex: 10,
        },
      },
      trading: {
        // Compact floating island in the top-right.
        style: {
          position: 'absolute',
          top: 18,
          right: 18,
          width: 'auto' as any,
          height: 'auto' as any,
          paddingLeft: 14,
          paddingRight: 14,
          paddingTop: 10,
          paddingBottom: 10,
          gap: 10,
          borderRadius: 999,
          backgroundColor: 'theme:accent',
          borderBottomWidth: 0,
          zIndex: 10,
        },
      },
    },
  },

  PB_ShellBrand: {
    type: 'Box',
    style: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: '#8B5CF6',
      alignItems: 'center',
      justifyContent: 'center',
    },
    variants: {
      idcard: { style: { width: 36, height: 36, borderRadius: 10, marginBottom: 10 } },
      magazine: { style: { width: 36, height: 36, borderRadius: 18 } },
      trading: { style: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#1a1410' } },
    },
  },

  PB_ShellBrandText: {
    type: 'Text',
    style: { fontSize: 14, color: '#ffffff', fontWeight: 'bold' },
    variants: {
      trading: { style: { fontSize: 11, color: 'theme:accent', fontWeight: 'bold' } },
    },
  },

  PB_ShellNav: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      gap: 4,
      alignItems: 'center',
      flexGrow: 1,
    },
    variants: {
      idcard: {
        style: {
          flexDirection: 'column',
          gap: 2,
          alignSelf: 'stretch',
          alignItems: 'stretch',
          flexGrow: 0,
        },
      },
      magazine: { style: { display: 'none' } },
      quote: {
        style: {
          flexDirection: 'row',
          gap: 4,
          flexGrow: 1,
        },
      },
      trading: {
        style: {
          flexDirection: 'row',
          gap: 8,
          flexGrow: 0,
          alignItems: 'center',
        },
      },
    },
  },

  PB_ShellNavItem: {
    type: 'Pressable',
    style: {
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 6,
      paddingBottom: 6,
      borderRadius: 6,
    },
    hoverStyle: { backgroundColor: 'theme:bgElevated' },
    variants: {
      idcard: {
        style: {
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 7,
          paddingBottom: 7,
          alignSelf: 'stretch',
        },
      },
      trading: {
        style: {
          paddingLeft: 0,
          paddingRight: 0,
          paddingTop: 0,
          paddingBottom: 0,
          borderRadius: 0,
        },
        hoverStyle: { backgroundColor: 'rgba(0,0,0,0.0)' },
      },
    },
  },

  PB_ShellNavText: {
    type: 'Text',
    style: { fontSize: 12, color: 'theme:textSecondary' },
    variants: {
      idcard: { style: { fontSize: 12, color: 'theme:textSecondary' } },
      quote: { style: { fontSize: 12, color: 'theme:textSecondary' } },
      trading: {
        style: { fontSize: 11, color: '#1a1410', fontWeight: 'bold', letterSpacing: 1 },
      },
    },
  },

  PB_ShellStatus: {
    type: 'Text',
    style: {
      fontSize: 11,
      color: 'theme:textDim',
      letterSpacing: 1,
    },
    variants: {
      idcard: {
        style: {
          fontSize: 11,
          color: 'theme:textDim',
          marginTop: 'auto',
          letterSpacing: 1,
        },
      },
      magazine: { style: { display: 'none' } },
      quote: {
        style: { fontSize: 11, color: 'theme:textSecondary', letterSpacing: 1 },
      },
      trading: { style: { display: 'none' } },
    },
  },

  PB_Page: {
    type: 'Box',
    style: {
      flexGrow: 1,
      width: '100%',
      flexBasis: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 32,
      paddingTop: 32,
      paddingBottom: 32,
    },
    variants: {
      idcard: {
        style: {
          flexGrow: 1,
          flexBasis: 0,
          width: 'auto' as any,
        },
      },
      quote: {
        // Page bleeds full; shell overlays. Add top padding so the
        // overlay strip doesn't clip into the card area.
        style: { paddingTop: 72 },
      },
    },
  },

  PB_Stage: {
    // Retained as an alias of PB_App for compatibility with any caller
    // that still imports it. New code should use PB_App.
    type: 'Box',
    style: {
      width: '100%',
      height: '100%',
      backgroundColor: 'theme:bg',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 32,
    },
  },
  PB_Switcher: {
    type: 'Box',
    style: { flexDirection: 'row', gap: 8 },
  },
  PB_SwitchBtn: {
    type: 'Pressable',
    style: {
      paddingLeft: 14,
      paddingRight: 14,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 8,
      backgroundColor: 'theme:bgElevated',
      borderWidth: 1,
      borderColor: 'theme:border',
    },
    hoverStyle: { borderColor: 'theme:borderFocus' },
  },
  PB_SwitchBtnActive: {
    type: 'Pressable',
    style: {
      paddingLeft: 14,
      paddingRight: 14,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 8,
      backgroundColor: 'theme:accent',
      borderWidth: 1,
      borderColor: 'theme:accent',
    },
  },
  PB_SwitchText: { type: 'Text', style: { fontSize: 12, color: 'theme:text' } },
  PB_SwitchTextActive: {
    type: 'Text',
    style: { fontSize: 12, color: '#1a1410', fontWeight: 'bold' },
  },
});
