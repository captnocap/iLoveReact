// profile_variants — five compositions, one JSX tree.
//
// The card has exactly five children: avatar, name, title, bio, stats.
// Each classifier carries variant overrides that lift, hide, resize,
// or relocate the child — composition changes, the JSX does not.

import { classifier } from '../runtime/classifier';

classifier({
  PC_Card: {
    type: 'Box',
    style: {
      width: 360,
      height: 480,
      position: 'relative',
      padding: 24,
      gap: 10,
      flexDirection: 'column',
      alignItems: 'center',
      backgroundColor: 'theme:surface',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'theme:border',
      overflow: 'hidden',
    },
    variants: {
      idcard: {
        style: {
          width: 480,
          height: 132,
          padding: 0,
          borderRadius: 12,
        },
      },
      magazine: {
        style: { padding: 0 },
      },
      quote: {
        style: {
          width: 520,
          height: 320,
          padding: 40,
          paddingBottom: 110,
          alignItems: 'flex-start',
          justifyContent: 'center',
          backgroundColor: 'theme:bgAlt',
        },
      },
      trading: {
        style: {
          width: 320,
          height: 480,
          padding: 0,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: 'theme:accent',
        },
      },
    },
  },

  PC_Avatar: {
    type: 'Box',
    style: {
      width: 104,
      height: 104,
      borderRadius: 52,
      backgroundColor: '#8B5CF6',
      alignItems: 'center',
      justifyContent: 'center',
    },
    variants: {
      idcard: {
        style: {
          position: 'absolute',
          left: 16,
          top: 16,
          width: 100,
          height: 100,
          borderRadius: 12,
        },
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
        style: {
          position: 'absolute',
          right: 40,
          bottom: 42,
          width: 18,
          height: 18,
          borderRadius: 9,
          opacity: 0.85,
        },
      },
      trading: {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: 280,
          borderRadius: 0,
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
    },
  },

  PC_Initial: {
    type: 'Text',
    style: {
      fontSize: 44,
      color: '#ffffff',
      fontWeight: 'bold',
    },
    variants: {
      magazine: {
        style: { fontSize: 280, color: 'rgba(255,255,255,0.10)', fontWeight: 'bold' },
      },
      quote: {
        style: { fontSize: 11, color: '#ffffff' },
      },
      trading: {
        style: { fontSize: 140, color: 'rgba(255,255,255,0.85)' },
      },
    },
  },

  PC_Name: {
    type: 'Text',
    style: {
      fontSize: 22,
      color: 'theme:text',
      fontWeight: 'bold',
      marginTop: 8,
    },
    variants: {
      idcard: {
        style: {
          position: 'absolute',
          left: 132,
          top: 22,
          fontSize: 19,
          fontWeight: 'bold',
          marginTop: 0,
        },
      },
      magazine: {
        style: {
          position: 'absolute',
          left: 24,
          bottom: 28,
          right: 24,
          fontSize: 38,
          fontWeight: 'bold',
          color: '#ffffff',
          marginTop: 0,
        },
      },
      quote: {
        style: {
          position: 'absolute',
          right: 40,
          bottom: 44,
          paddingRight: 28,
          fontSize: 13,
          color: 'theme:textSecondary',
          fontWeight: 'bold',
          marginTop: 0,
        },
      },
      trading: {
        style: {
          position: 'absolute',
          top: 260,
          left: 0,
          right: 0,
          height: 44,
          backgroundColor: 'theme:accent',
          color: '#1a1410',
          fontSize: 20,
          fontWeight: 'bold',
          textAlign: 'center',
          paddingTop: 11,
          marginTop: 0,
        },
      },
    },
  },

  PC_Title: {
    type: 'Text',
    style: {
      fontSize: 13,
      color: 'theme:textDim',
      marginTop: -4,
    },
    variants: {
      idcard: {
        style: {
          position: 'absolute',
          left: 132,
          top: 48,
          fontSize: 12,
          marginTop: 0,
        },
      },
      magazine: {
        style: {
          position: 'absolute',
          left: 24,
          bottom: 74,
          fontSize: 11,
          letterSpacing: 2,
          color: 'theme:accent',
          marginTop: 0,
        },
      },
      quote: {
        style: {
          position: 'absolute',
          right: 40,
          bottom: 26,
          fontSize: 11,
          color: 'theme:textDim',
          marginTop: 0,
        },
      },
      trading: {
        style: {
          position: 'absolute',
          top: 312,
          left: 16,
          right: 16,
          fontSize: 10,
          color: 'theme:textDim',
          letterSpacing: 1,
          marginTop: 0,
        },
      },
    },
  },

  PC_Bio: {
    type: 'Text',
    style: {
      fontSize: 14,
      color: 'theme:textSecondary',
      lineHeight: 21,
      marginTop: 10,
      textAlign: 'center',
    },
    variants: {
      idcard: {
        style: {
          position: 'absolute',
          left: 132,
          top: 76,
          right: 180,
          fontSize: 11,
          color: 'theme:textDim',
          lineHeight: 15,
          marginTop: 0,
          textAlign: 'left',
        },
        numberOfLines: 2,
        noWrap: false,
      },
      magazine: {
        // The composition rejects body copy.
        style: { display: 'none' },
      },
      quote: {
        // Bio is the hero now.
        style: {
          fontSize: 24,
          lineHeight: 34,
          color: 'theme:text',
          marginTop: 0,
          textAlign: 'left',
        },
      },
      trading: {
        style: {
          position: 'absolute',
          top: 340,
          left: 18,
          right: 18,
          fontSize: 13,
          color: 'theme:textSecondary',
          lineHeight: 19,
          marginTop: 0,
          textAlign: 'left',
        },
      },
    },
  },

  PC_Stats: {
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
          position: 'absolute',
          right: 16,
          bottom: 14,
          flexDirection: 'row',
          gap: 10,
          marginTop: 0,
          paddingTop: 0,
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
      quote: {
        style: { display: 'none' },
      },
      trading: {
        style: {
          position: 'absolute',
          top: 16,
          right: 16,
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
          marginTop: 0,
          paddingTop: 0,
        },
      },
    },
  },

  PC_Stat: {
    type: 'Text',
    style: {
      fontSize: 12,
      color: 'theme:textDim',
    },
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

  // ── switcher chrome ─────────────────────────────────────
  PC_Stage: {
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
  PC_CardSlot: {
    type: 'Box',
    style: {
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
  PC_Switcher: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      gap: 8,
    },
  },
  PC_SwitchBtn: {
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
  PC_SwitchBtnActive: {
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
  PC_SwitchText: {
    type: 'Text',
    style: { fontSize: 12, color: 'theme:text' },
  },
  PC_SwitchTextActive: {
    type: 'Text',
    style: { fontSize: 12, color: '#1a1410', fontWeight: 'bold' },
  },
});
