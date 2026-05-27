// DexCard skin sheet — every visible element is a named classifier.
// Variants flip layout + accent colors per dapp. Theme tokens carry the
// palette swap from skins.ts; this sheet only tweaks the things that
// genuinely differ between e.g. Uniswap's tall rounded card and
// PancakeSwap's wider boxier one.

import { classifier } from '../../../../runtime/classifier';

classifier({
  DexCardRoot: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 12,
      padding: 20,
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      width: 380,
    },
    variants: {
      uniswap:  { style: { width: 410, padding: 22, gap: 8 } },
      pancake:  { style: { width: 380, padding: 18, gap: 14 } },
      sushi:    { style: { width: 380, padding: 18, gap: 12 } },
      dextools: { style: { width: 340, padding: 12, gap: 6 } },
    },
  },

  DexCardHeader: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  },

  DexCardTitle: {
    type: 'Text',
    style: { fontSize: 'theme:fontLg', fontWeight: 'bold', color: 'theme:text' },
    variants: {
      pancake: { style: { color: 'theme:primary' } },
      sushi:   { style: { color: 'theme:accent' } },
    },
  },

  DexCardSubtitle: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim' },
  },

  DexInputRow: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 4,
      padding: 12,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    variants: {
      uniswap:  { style: { borderWidth: 0, backgroundColor: 'theme:bgAlt' } },
      dextools: { style: { padding: 6, gap: 2 } },
    },
  },

  DexInputLabel: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim' },
  },

  DexInputBox: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  },

  DexInputField: {
    type: 'TextInput',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      height: 36,
      paddingLeft: 4,
      paddingRight: 4,
      color: 'theme:text',
      fontSize: 'theme:fontLg',
      backgroundColor: 'transparent',
      borderWidth: 0,
    },
  },

  DexTokenChip: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 6,
      paddingBottom: 6,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgElevated',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    variants: {
      uniswap: { style: { borderRadius: 999, paddingLeft: 12, paddingRight: 12 } },
    },
  },

  DexTokenChipText: {
    type: 'Text',
    style: { fontSize: 'theme:fontMd', fontWeight: 'bold', color: 'theme:text' },
  },

  DexOutputAmount: {
    type: 'Text',
    style: { flexGrow: 1, fontSize: 'theme:fontLg', color: 'theme:text' },
  },

  DexQuoteRow: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: 4,
      paddingRight: 4,
    },
  },

  DexQuoteLabel: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim' },
  },

  DexQuoteValue: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textSecondary' },
  },

  DexQuoteValueWarn: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:warning', fontWeight: 'bold' },
  },

  DexQuoteValueDanger: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:error', fontWeight: 'bold' },
  },

  DexSideToggle: {
    type: 'Box',
    style: { flexDirection: 'row', gap: 4 },
  },

  DexSideToggleButton: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 6,
      paddingBottom: 6,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    hoverStyle: { borderColor: 'theme:borderFocus' },
  },

  DexSideToggleButtonActive: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 6,
      paddingBottom: 6,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:primary',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:primary',
    },
  },

  DexSideToggleText: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:text' },
  },

  DexSideToggleTextActive: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: '#0b0d10', fontWeight: 'bold' },
  },

  DexSwapCta: {
    type: 'Pressable',
    style: {
      paddingTop: 14,
      paddingBottom: 14,
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:primary',
      alignItems: 'center',
      justifyContent: 'center',
    },
    hoverStyle: { backgroundColor: 'theme:primaryHover' },
    activeStyle: { backgroundColor: 'theme:primaryPressed' },
    variants: {
      uniswap:  { style: { borderRadius: 20, paddingTop: 18, paddingBottom: 18 } },
      pancake:  { style: { borderRadius: 16 } },
      dextools: { style: { paddingTop: 8, paddingBottom: 8, borderRadius: 4 } },
    },
  },

  DexSwapCtaText: {
    type: 'Text',
    style: { fontSize: 'theme:fontLg', fontWeight: 'bold', color: '#0b0d10' },
    variants: {
      uniswap: { style: { color: '#ffffff', fontSize: 18 } },
    },
  },

  DexSwapCtaTextDisabled: {
    type: 'Text',
    style: { fontSize: 'theme:fontLg', fontWeight: 'bold', color: 'theme:textDim' },
  },

  DexFooterHint: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim', textAlign: 'center' },
  },
});
