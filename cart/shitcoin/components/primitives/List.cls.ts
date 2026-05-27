// List classifier — rows with hover + optional selection.
// Used by channel list (TG), holdings, NPCs, staking pool browsers,
// active scripts roster.

import { classifier } from '../../../../runtime/classifier';

classifier({
  ListRoot: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 2 },
  },

  ListRow: {
    type: 'Pressable',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'transparent',
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover' },
    variants: {
      compact: { style: { paddingTop: 4, paddingBottom: 4 } },
      bordered: { style: { borderBottomWidth: 1, borderColor: 'theme:border', borderRadius: 0 } },
    },
  },

  ListRowActive: {
    type: 'Pressable',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgAlt',
      borderLeftWidth: 3,
      borderColor: 'theme:primary',
    },
  },

  ListLabel: {
    type: 'Text',
    style: { fontSize: 'theme:fontMd', color: 'theme:text', flexGrow: 1 },
  },

  ListSubLabel: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:textDim' },
  },

  ListTrailing: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textSecondary' },
  },
});
