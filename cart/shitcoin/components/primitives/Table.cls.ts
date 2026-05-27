// Table classifier — columnar data with headers. Order books,
// leaderboards, trade history, holdings tables.

import { classifier } from '../../../../runtime/classifier';

classifier({
  TableRoot: {
    type: 'Box',
    style: { flexDirection: 'column' },
  },

  TableHeaderRow: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      paddingTop: 6, paddingBottom: 6,
      paddingLeft: 8, paddingRight: 8,
      borderBottomWidth: 1,
      borderColor: 'theme:border',
    },
  },

  TableHeaderCell: {
    type: 'Text',
    style: { fontSize: 10, color: 'theme:textDim', fontWeight: 'bold', textTransform: 'uppercase' },
  },

  TableRow: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      paddingTop: 4, paddingBottom: 4,
      paddingLeft: 8, paddingRight: 8,
      borderBottomWidth: 1,
      borderColor: 'rgba(255,255,255,0.03)',
    },
    variants: {
      etherscan: { style: { borderColor: '#dee2e6' } },
      hot:       { style: { backgroundColor: 'rgba(255,210,74,0.06)' } },
    },
  },

  TableCell: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:text' },
  },

  TableCellDim: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:textDim' },
  },

  TableCellPos: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:success' },
  },

  TableCellNeg: {
    type: 'Text',
    style: { fontSize: 11, color: 'theme:error' },
  },
});
