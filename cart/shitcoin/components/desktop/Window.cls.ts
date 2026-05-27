// Window chrome skin sheet. Variants approximate the look of XP, Win7,
// macOS, and a generic Linux/GNOME shell. Layout (title bar position,
// button arrangement) is consistent across variants — only colors,
// radii, and a few borders change.

import { classifier } from '../../../../runtime/classifier';

classifier({
  WindowRoot: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      overflow: 'hidden',
    },
    variants: {
      xp:    { style: { borderRadius: 8, borderWidth: 2, borderColor: 'theme:primary' } },
      win7:  { style: { borderRadius: 8 } },
      macos: { style: { borderRadius: 10 } },
      linux: { style: { borderRadius: 4 } },
    },
  },

  WindowTitleBar: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 6,
      paddingBottom: 6,
      backgroundColor: 'theme:primary',
      borderBottomWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    variants: {
      macos: { style: { backgroundColor: 'theme:bgElevated', justifyContent: 'flex-start' } },
      xp:    { style: { backgroundColor: 'theme:primary' } },
    },
  },

  WindowTitleText: {
    type: 'Text',
    style: { flexGrow: 1, fontSize: 'theme:fontSm', color: '#ffffff', fontWeight: 'bold' },
    variants: {
      macos: { style: { color: 'theme:text', textAlign: 'center' } },
      etherscan: { style: { color: 'theme:text' } },
    },
  },

  WindowControls: {
    type: 'Box',
    style: { flexDirection: 'row', gap: 4 },
    variants: {
      macos: { style: { gap: 6 } },
    },
  },

  WindowControlBtn: {
    type: 'Pressable',
    style: {
      width: 18,
      height: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 4,
      backgroundColor: 'theme:bgAlt',
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
    variants: {
      macos: { style: { width: 12, height: 12, borderRadius: 6 } },
    },
  },

  WindowControlBtnText: {
    type: 'Text',
    style: { fontSize: 10, color: 'theme:text', fontWeight: 'bold' },
    variants: {
      macos: { style: { color: 'transparent' } },
    },
  },

  // macOS-style traffic lights — three round dots in red/yellow/green.
  WindowControlClose: {
    type: 'Pressable',
    style: { width: 18, height: 18, borderRadius: 4, backgroundColor: 'theme:error', alignItems: 'center', justifyContent: 'center' },
    variants: {
      macos: { style: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#ff5f57' } },
    },
  },

  WindowControlMin: {
    type: 'Pressable',
    style: { width: 18, height: 18, borderRadius: 4, backgroundColor: 'theme:bgElevated', alignItems: 'center', justifyContent: 'center' },
    variants: {
      macos: { style: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#febc2e' } },
    },
  },

  WindowControlMax: {
    type: 'Pressable',
    style: { width: 18, height: 18, borderRadius: 4, backgroundColor: 'theme:bgElevated', alignItems: 'center', justifyContent: 'center' },
    variants: {
      macos: { style: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#28c840' } },
    },
  },

  WindowBody: {
    type: 'Box',
    style: { flexGrow: 1, flexBasis: 0, backgroundColor: 'theme:surface' },
  },
});
