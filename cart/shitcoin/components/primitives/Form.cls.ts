// Form classifier — labelled inputs + validation row + submit. Used by
// rule editors, settings, upgrade buy confirmations.

import { classifier } from '../../../../runtime/classifier';

classifier({
  FormRoot: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 12, padding: 14 },
  },

  FormField: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 4 },
  },

  FormLabel: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:textSecondary', fontWeight: 'bold' },
  },

  FormHint: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:textDim' },
  },

  FormError: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:error' },
  },

  FormInput: {
    type: 'TextInput',
    style: {
      height: 34,
      paddingLeft: 10, paddingRight: 10,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      color: 'theme:text',
      fontSize: 'theme:fontSm',
    },
  },

  FormActions: {
    type: 'Box',
    style: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  },

  FormPrimaryBtn: {
    type: 'Pressable',
    style: {
      paddingLeft: 14, paddingRight: 14,
      paddingTop: 8, paddingBottom: 8,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:primary',
      alignItems: 'center',
    },
    hoverStyle: { backgroundColor: 'theme:primaryHover' },
  },

  FormSecondaryBtn: {
    type: 'Pressable',
    style: {
      paddingLeft: 14, paddingRight: 14,
      paddingTop: 8, paddingBottom: 8,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgElevated',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    hoverStyle: { borderColor: 'theme:borderFocus' },
  },

  FormBtnText: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: '#0b0d10', fontWeight: 'bold' },
  },

  FormBtnTextAlt: {
    type: 'Text',
    style: { fontSize: 'theme:fontSm', color: 'theme:text' },
  },
});
