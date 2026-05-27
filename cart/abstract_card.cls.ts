// abstract_card — a deliberately abstract three-block card to demo
// orthogonal dim composition. Two dims, two values each → four layouts.
//
//   anchor: left | right   → corner block flips edge (alignSelf)
//   lead:   thin | thick   → which bar floats above the other (order)
//
// JSX order is [Corner, Thin, Thick]. The dims rearrange the visual
// stack without touching the JSX.

import { classifier } from '../runtime/classifier';

classifier({
  AC_Stage: {
    type: 'Box',
    style: {
      width: '100%',
      height: '100%',
      backgroundColor: 'theme:bg',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 28,
    },
  },

  // ── the abstract card ────────────────────────────────
  AC_Card: {
    type: 'Box',
    style: {
      width: 340,
      height: 200,
      padding: 14,
      gap: 10,
      flexDirection: 'column',
      backgroundColor: 'theme:surface',
      borderRadius: 6,
      borderWidth: 3,
      borderColor: 'theme:border',
    },
  },

  AC_Corner: {
    type: 'Box',
    style: {
      width: 54,
      height: 54,
      backgroundColor: 'theme:bgElevated',
      borderRadius: 4,
      borderWidth: 2,
      borderColor: 'theme:accent',
      alignSelf: 'flex-start',
    },
    dims: {
      anchor: {
        left:  { style: { alignSelf: 'flex-start' } },
        right: { style: { alignSelf: 'flex-end' } },
      },
    },
  },

  AC_Thin: {
    type: 'Box',
    style: {
      width: '100%',
      height: 30,
      backgroundColor: 'theme:bgElevated',
      borderRadius: 4,
      borderWidth: 2,
      borderColor: 'theme:accent',
    },
    dims: {
      lead: {
        thin:  { style: { order: 0 } },
        thick: { style: { order: 1 } },
      },
    },
  },

  AC_Thick: {
    type: 'Box',
    style: {
      width: '100%',
      height: 56,
      backgroundColor: 'theme:bgAlt',
      borderRadius: 4,
      borderWidth: 3,
      borderColor: 'theme:primary',
    },
    dims: {
      lead: {
        thin:  { style: { order: 1 } },
        thick: { style: { order: 0 } },
      },
    },
  },

  // ── switcher chrome ──────────────────────────────────
  AC_SwitcherRow: {
    type: 'Box',
    style: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  },
  AC_SwitcherLabel: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:textDim', letterSpacing: 1, width: 60 },
  },
  AC_Switcher: {
    type: 'Box',
    style: { flexDirection: 'row', gap: 6 },
  },
  AC_SwitchBtn: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 6,
      paddingBottom: 6,
      borderRadius: 6,
      backgroundColor: 'theme:bgElevated',
      borderWidth: 1,
      borderColor: 'theme:border',
    },
    hoverStyle: { borderColor: 'theme:borderFocus' },
  },
  AC_SwitchBtnActive: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 6,
      paddingBottom: 6,
      borderRadius: 6,
      backgroundColor: 'theme:accent',
      borderWidth: 1,
      borderColor: 'theme:accent',
    },
  },
  AC_SwitchText: { type: 'Text', style: { fontSize: 11, color: 'theme:text' } },
  AC_SwitchTextActive: {
    type: 'Text',
    style: { fontSize: 11, color: '#1a1410', fontWeight: 'bold' },
  },
});
