// WalletPanel skin sheet. Variants resemble well-known wallets:
// metamask (orange/grey), phantom (purple), rabby (blue), etherscan
// (clean white explorer style).

import { classifier } from '../../../../runtime/classifier';

classifier({
  WalletPanelRoot: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 10,
      padding: 16,
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      width: 360,
    },
    variants: {
      etherscan: { style: { borderRadius: 4, width: 760 } },
      phantom:   { style: { backgroundColor: 'theme:bgElevated' } },
    },
  },

  WalletPanelHeader: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  },

  WalletPanelAccountLabel: {
    type: 'Text',
    style: { fontSize: 'theme:fontMd', fontWeight: 'bold', color: 'theme:text' },
    variants: {
      metamask: { style: { color: 'theme:accent' } },
    },
  },

  WalletPanelAddress: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim' },
  },

  WalletPanelBalanceBlock: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 4,
      padding: 12,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgAlt',
    },
  },

  WalletPanelBalanceBig: {
    type: 'Text',
    style: { fontSize: 28, fontWeight: 'bold', color: 'theme:text' },
  },

  WalletPanelBalanceSub: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim' },
  },

  WalletPanelPnlPos: {
    type: 'Text',
    style: { fontSize: 'theme:fontMd', fontWeight: 'bold', color: 'theme:success' },
  },

  WalletPanelPnlNeg: {
    type: 'Text',
    style: { fontSize: 'theme:fontMd', fontWeight: 'bold', color: 'theme:error' },
  },

  WalletPanelSectionLabel: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim', marginTop: 6 },
  },

  WalletPanelHoldingsList: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 4 },
  },

  WalletPanelHoldingRow: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 6,
      paddingBottom: 6,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgAlt',
    },
    variants: {
      etherscan: { style: { backgroundColor: 'transparent', borderBottomWidth: 1, borderColor: 'theme:border' } },
    },
  },

  WalletPanelHoldingSym: {
    type: 'Text',
    style: { fontSize: 'theme:fontMd', fontWeight: 'bold', color: 'theme:text', width: 80 },
  },

  WalletPanelHoldingAmt: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textSecondary', flexGrow: 1 },
  },

  WalletPanelHoldingPnl: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:text', width: 80, textAlign: 'right' },
  },

  WalletPanelHoldingPnlPos: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:success', width: 80, textAlign: 'right' },
  },

  WalletPanelHoldingPnlNeg: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:error', width: 80, textAlign: 'right' },
  },

  WalletPanelEmpty: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim', textAlign: 'center' },
  },
});
