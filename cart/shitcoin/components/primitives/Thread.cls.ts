// Thread classifier — head post + flat or nested replies. Used by forum
// threads, telegram broadcast threads, twitter chains.

import { classifier } from '../../../../runtime/classifier';

classifier({
  ThreadRoot: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 8 },
  },

  ThreadHead: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 6,
      padding: 14,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
  },

  ThreadTitle: {
    type: 'Text',
    style: { fontSize: 'theme:fontLg', fontWeight: 'bold', color: 'theme:text' },
  },

  ThreadMeta: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:textDim' },
  },

  ThreadBody: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textSecondary', lineHeight: 17 },
  },

  ThreadReplies: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 4, paddingLeft: 12 },
  },

  ThreadReply: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 4,
      padding: 10,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgAlt',
      borderLeftWidth: 2,
      borderColor: 'theme:border',
    },
    variants: {
      // Replies that quote another post indent further.
      quote: { style: { marginLeft: 18, borderColor: 'theme:primary' } },
    },
  },

  ThreadReplyAuthor: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:textSecondary', fontWeight: 'bold' },
  },

  ThreadReplyBody: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:text', lineHeight: 15 },
  },
});
