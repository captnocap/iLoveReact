// RuleEditor classifier — trigger-spec + action-spec form. Used by
// every script app (Sniper, Arb, DCA, StopLoss, etc.) so the editor
// shape itself is shared and only the template lists differ.

import { classifier } from '../../../../runtime/classifier';

classifier({
  RuleEditorRoot: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 10,
      padding: 14,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
  },

  RuleEditorLabel: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:textDim', fontWeight: 'bold', textTransform: 'uppercase' },
  },

  RuleEditorSpec: {
    type: 'Box',
    style: {
      flexDirection: 'column',
      gap: 4,
      padding: 8,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 1,
      borderColor: 'theme:border',
    },
  },

  RuleEditorSpecCode: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:text', fontFamily: 'monospace' },
  },

  RuleEditorRow: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  },

  RuleEditorToggle: {
    type: 'Pressable',
    style: {
      width: 36, height: 20, borderRadius: 10,
      backgroundColor: 'theme:bgAlt',
      borderWidth: 1, borderColor: 'theme:border',
      justifyContent: 'center',
    },
    hoverStyle: { borderColor: 'theme:borderFocus' },
  },

  RuleEditorToggleOn: {
    type: 'Pressable',
    style: {
      width: 36, height: 20, borderRadius: 10,
      backgroundColor: 'theme:success',
      borderWidth: 1, borderColor: 'theme:success',
      justifyContent: 'center',
    },
  },
});
