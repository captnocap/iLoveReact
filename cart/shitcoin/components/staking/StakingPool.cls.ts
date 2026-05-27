// StakingPool skin sheet.

import { classifier } from '../../../../runtime/classifier';

classifier({
  StakingPoolRoot: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 10,
      padding: 16,
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      width: 320,
    },
    variants: {
      pancake: { style: { backgroundColor: 'theme:bgElevated', borderColor: 'theme:accent', borderWidth: 2 } },
      sushi:   { style: { backgroundColor: 'theme:bgElevated' } },
    },
  },

  StakingPoolHeader: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  },

  StakingPoolName: {
    type: 'Text',
    style: { fontSize: 'theme:fontLg', fontWeight: 'bold', color: 'theme:text' },
    variants: {
      pancake: { style: { color: 'theme:accent' } },
    },
  },

  StakingPoolBadge: {
    type: 'Box',
    style: {
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 3,
      paddingBottom: 3,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
  },

  StakingPoolBadgeText: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:primary' },
  },

  StakingPoolMetricsRow: {
    type: 'Box',
    style: { flexDirection: 'row', justifyContent: 'space-between' },
  },

  StakingPoolMetricLabel: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim' },
  },

  StakingPoolMetricValue: {
    type: 'Text',
    style: { fontSize: 'theme:fontMd', color: 'theme:text', fontWeight: 'bold' },
  },

  StakingPoolApr: {
    type: 'Text',
    style: { fontSize: 'theme:fontLg', color: 'theme:success', fontWeight: 'bold' },
    variants: {
      pancake: { style: { color: 'theme:accent' } },
    },
  },

  StakingPoolDivider: {
    type: 'Box',
    style: { height: 1, backgroundColor: 'theme:border', marginTop: 4, marginBottom: 4 },
  },

  StakingPoolEarnedBlock: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 4,
      padding: 10,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgAlt',
    },
  },

  StakingPoolEarnedAmount: {
    type: 'Text',
    style: { fontSize: 'theme:fontLg', color: 'theme:success', fontWeight: 'bold' },
  },

  StakingPoolInputRow: {
    type: 'Box',
    style: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  },

  StakingPoolInputField: {
    type: 'TextInput',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      height: 32,
      paddingLeft: 8,
      paddingRight: 8,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      color: 'theme:text',
      fontSize: 'theme:fontSm',
    },
  },

  StakingPoolActionBtn: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:primary',
      alignItems: 'center',
      justifyContent: 'center',
    },
    hoverStyle: { backgroundColor: 'theme:primaryHover' },
    activeStyle: { backgroundColor: 'theme:primaryPressed' },
  },

  StakingPoolActionBtnAlt: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgElevated',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      alignItems: 'center',
      justifyContent: 'center',
    },
    hoverStyle: { borderColor: 'theme:borderFocus' },
  },

  StakingPoolActionBtnDisabled: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: 0.5,
    },
  },

  StakingPoolActionText: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', fontWeight: 'bold', color: '#0b0d10' },
  },

  StakingPoolActionTextAlt: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', fontWeight: 'bold', color: 'theme:text' },
  },

  StakingPoolLockHint: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:warning' },
  },
});
