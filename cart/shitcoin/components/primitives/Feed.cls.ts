// Feed classifier — newest-first scrollable stream of typed entries.
// Used by social posts, telegram messages, news ring, tape feed,
// achievement unlock history.

import { classifier } from '../../../../runtime/classifier';

classifier({
  FeedRoot: {
    type: 'ScrollView',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      backgroundColor: 'theme:bg',
    },
  },

  FeedInner: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 6 },
  },

  FeedItem: {
    type: 'Pressable',
    style: {
      flexDirection: 'row',
      gap: 10,
      padding: 10,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    hoverStyle: { borderColor: 'theme:borderFocus' },
    variants: {
      compact:   { style: { padding: 6, gap: 6, borderWidth: 0, backgroundColor: 'transparent' } },
      bordered:  { style: { borderRadius: 0, borderLeftWidth: 0, borderRightWidth: 0, borderTopWidth: 0 } },
    },
  },

  FeedItemAvatar: {
    type: 'Box',
    style: {
      width: 32, height: 32,
      borderRadius: 16,
      backgroundColor: 'theme:bgAlt',
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
  },

  FeedItemMain: {
    type: 'Box',
    style: { flexDirection: 'column', flexGrow: 1, flexBasis: 0, gap: 2 },
  },

  FeedItemHeader: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  },

  FeedItemHandle: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', fontWeight: 'bold', color: 'theme:text' },
  },

  FeedItemMeta: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:textDim' },
  },

  FeedItemBody: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textSecondary', lineHeight: 17 },
  },

  FeedItemStats: {
    type: 'Box',
    style: { flexDirection: 'row', gap: 14, marginTop: 4 },
  },

  FeedItemStat: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:textDim' },
  },

  FeedEmpty: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textDim', textAlign: 'center', paddingTop: 40 },
  },
});
