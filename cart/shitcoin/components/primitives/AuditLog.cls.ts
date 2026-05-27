// AuditLog classifier — time-ordered list of fires with status pills.
// Used by every script app (sniper history, arb fires), achievement
// unlock history, trade history.

import { classifier } from '../../../../runtime/classifier';

classifier({
  AuditLogRoot: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 2 },
  },

  AuditLogRow: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 8, paddingRight: 8,
      paddingTop: 4, paddingBottom: 4,
      borderBottomWidth: 1,
      borderColor: 'rgba(255,255,255,0.04)',
    },
  },

  AuditLogTime: {
    type: 'Text',
    style: { fontSize: 10, color: 'theme:textDim', width: 56, fontFamily: 'monospace' },
  },

  AuditLogMessage: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:text', flexGrow: 1, flexBasis: 0 },
  },

  AuditLogPillOk: {
    type: 'Box',
    style: {
      paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'rgba(72,211,145,0.20)',
    },
  },

  AuditLogPillWarn: {
    type: 'Box',
    style: {
      paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'rgba(255,184,107,0.20)',
    },
  },

  AuditLogPillErr: {
    type: 'Box',
    style: {
      paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'rgba(255,107,122,0.22)',
    },
  },

  AuditLogPillText: {
    type: 'Text',
    style: { fontSize: 10, color: 'theme:text', fontWeight: 'bold' },
  },
});
