// Page classifier — standard padded scroll viewport with optional hero.
// Used by every site rendered inside the Browser.

import { classifier } from '../../../../runtime/classifier';

classifier({
  PageRoot: {
    type: 'ScrollView',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      backgroundColor: 'theme:bg',
    },
  },

  PageInner: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 16,
      paddingLeft: 24,
      paddingRight: 24,
      paddingTop: 18,
      paddingBottom: 40,
      maxWidth: 1024,
    },
    variants: {
      etherscan: { style: { maxWidth: 1180, paddingLeft: 32, paddingRight: 32 } },
      dextools:  { style: { paddingLeft: 12, paddingRight: 12, gap: 8 } },
    },
  },

  PageHero: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 8,
      paddingTop: 24,
      paddingBottom: 18,
    },
  },

  PageHeroTitle: {
    type: 'Text',
    style: { fontSize: 30, fontWeight: 'bold', color: 'theme:text' },
    variants: {
      uniswap: { style: { fontSize: 36, color: 'theme:primary' } },
      pancake: { style: { color: 'theme:primary' } },
    },
  },

  PageHeroSubtitle: {
    type: 'Text',
    style: { fontSize: 'theme:fontMd', color: 'theme:textSecondary' },
  },
});
