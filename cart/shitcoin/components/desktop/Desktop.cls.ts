// Desktop skin sheet. Variants approximate WinXP, Win7 Aero, macOS,
// and a Linux/GNOME look. The OS-fiction only changes colors, wallpaper
// tone, taskbar position, and minor radii.

import { classifier } from '../../../../runtime/classifier';

classifier({
  DesktopRoot: {
    type: 'Box',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      backgroundColor: 'theme:bg',
      position: 'relative',
      overflow: 'hidden',
    },
    variants: {
      xp:    { style: { backgroundColor: '#3b6ea5' } },
      win7:  { style: { backgroundColor: '#3a6c9e' } },
      macos: { style: { backgroundColor: '#1a1a1a' } },
      linux: { style: { backgroundColor: '#2c2828' } },
    },
  },

  DesktopIconGrid: {
    type: 'Box',
    style: {
      position: 'absolute',
      top: 16,
      left: 16,
      flexDirection: 'column',
      gap: 14,
    },
  },

  DesktopIcon: {
    type: 'Pressable',
    style: {
      width: 84,
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
      paddingTop: 6,
      paddingBottom: 6,
      paddingLeft: 4,
      paddingRight: 4,
      borderRadius: 4,
    },
    hoverStyle: { backgroundColor: 'rgba(255,255,255,0.10)' },
  },

  DesktopIconGlyph: {
    type: 'Box',
    style: {
      width: 48,
      height: 48,
      borderRadius: 8,
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      alignItems: 'center',
      justifyContent: 'center',
    },
  },

  DesktopIconGlyphText: {
    type: 'Text',
    style: { fontSize: 22 },
  },

  DesktopIconLabel: {
    type: 'Text',
    style: {
      fontSize: 11,
      color: '#ffffff',
      textAlign: 'center',
      textShadowColor: 'rgba(0,0,0,0.7)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    variants: {
      macos: { style: { color: '#f5f5f7' } },
    },
  },

  DesktopTaskbar: {
    type: 'Box',
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingLeft: 8,
      paddingRight: 8,
      backgroundColor: 'theme:surface',
      borderTopWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    variants: {
      xp: {
        style: {
          backgroundColor: '#245edc',
          borderTopWidth: 2,
          borderColor: '#0a3d99',
        },
      },
      macos: {
        style: {
          top: 0,
          bottom: undefined as any,
          height: 28,
          backgroundColor: 'rgba(20,20,20,0.9)',
        },
      },
    },
  },

  DesktopStartBtn: {
    type: 'Pressable',
    style: {
      paddingLeft: 14,
      paddingRight: 14,
      paddingTop: 6,
      paddingBottom: 6,
      borderRadius: 6,
      backgroundColor: 'theme:primary',
    },
    hoverStyle: { backgroundColor: 'theme:primaryHover' },
    variants: {
      xp: { style: { backgroundColor: '#3c873a', borderRadius: 12 } },
    },
  },

  DesktopStartBtnText: {
    type: 'Text',
    style: { fontSize: 12, color: '#ffffff', fontWeight: 'bold' },
  },

  DesktopTaskbarSlot: {
    type: 'Pressable',
    style: {
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 6,
      paddingBottom: 6,
      borderRadius: 4,
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    hoverStyle: { borderColor: 'theme:borderFocus' },
  },

  DesktopTaskbarSlotActive: {
    type: 'Pressable',
    style: {
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 6,
      paddingBottom: 6,
      borderRadius: 4,
      backgroundColor: 'theme:primary',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:primary',
    },
  },

  DesktopTaskbarSlotText: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:text' },
  },

  DesktopTaskbarSlotTextActive: {
    type: 'Text',
    style: { fontSize: 11, color: '#0b0d10', fontWeight: 'bold' },
  },

  DesktopClock: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:text', marginLeft: 'auto', paddingRight: 8 },
  },
});
