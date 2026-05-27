// Card classifier — generic card shell used by DexCard, StakingPool,
// TokenSite hero, Upgrade item, Ad slot, AchievementBadge, etc.
//
// Visual difference between dapp skins lives in the classifier variants;
// structural difference between use-sites lives in CardProps flags.

import { classifier } from '../../../../runtime/classifier';

classifier({
  CardRoot: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 10,
      padding: 16,
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    variants: {
      uniswap:  { style: { borderRadius: 22, padding: 22 } },
      pancake:  { style: { borderRadius: 18 } },
      sushi:    { style: { borderRadius: 10 } },
      dextools: { style: { borderRadius: 4, padding: 10, gap: 4 } },
      etherscan:{ style: { borderRadius: 4, backgroundColor: '#ffffff', borderColor: '#dee2e6' } },
      compact:  { style: { padding: 10, gap: 6 } },
      widget:   { style: { padding: 8, gap: 4, borderRadius: 6 } },
      hero:     { style: { padding: 28, gap: 18, borderRadius: 'theme:radiusLg' } },
    },
  },

  CardHeader: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  },

  CardTitle: {
    type: 'Text',
    style: { fontSize: 'theme:fontLg', fontWeight: 'bold', color: 'theme:text' },
    variants: {
      hero: { style: { fontSize: 28 } },
      widget: { style: { fontSize: 'theme:fontMd' } },
    },
  },

  CardSubtitle: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim' },
  },

  CardBody: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 8 },
  },

  CardFooter: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  },

  CardCta: {
    type: 'Pressable',
    style: {
      paddingTop: 12,
      paddingBottom: 12,
      paddingLeft: 16,
      paddingRight: 16,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:primary',
      alignItems: 'center',
      justifyContent: 'center',
    },
    hoverStyle: { backgroundColor: 'theme:primaryHover' },
    activeStyle: { backgroundColor: 'theme:primaryPressed' },
    variants: {
      uniswap: { style: { borderRadius: 20, paddingTop: 16, paddingBottom: 16 } },
    },
  },

  CardCtaText: {
    type: 'Text',
    style: { fontSize: 'theme:fontMd', fontWeight: 'bold', color: '#0b0d10' },
    variants: { uniswap: { style: { color: '#ffffff' } } },
  },

  CardDivider: {
    type: 'Box',
    style: { height: 1, backgroundColor: 'theme:border', marginTop: 4, marginBottom: 4 },
  },

  CardBadge: {
    type: 'Box',
    style: {
      paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
  },

  CardBadgeText: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:primary' },
  },
});
