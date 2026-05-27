// Table — header + rows with per-column width. Caller declares
// `columns: { key, label, width? | grow?, align?, render? }[]` and a
// row dataset. The primitive does the layout — header alignment +
// per-row mapping. Cell content can be plain values (rendered as text)
// or full custom render via the column's `render` fn.

import { classifiers as C } from '../../../../runtime/classifier';
import './Table.cls';

export interface TableColumn<T> {
  key: string;
  label: string;
  /** Either fixed width (px) or `grow: 1` for flex. */
  width?: number;
  grow?: number;
  align?: 'left' | 'right' | 'center';
  /** Optional cell renderer; otherwise we render `String(row[key])`. */
  render?: (row: T) => any;
  /** Render the cell as positive / negative tinted text. */
  tint?: (row: T) => 'pos' | 'neg' | 'dim' | null;
}

export interface TableProps<T extends { key: string | number }> {
  columns: TableColumn<T>[];
  rows: T[];
  /** Mark rows that should render with the 'hot' variant (e.g. big trades). */
  isHot?: (row: T) => boolean;
}

function cellStyle(col: TableColumn<any>) {
  const align = col.align ?? 'left';
  const base: any = { textAlign: align };
  if (col.width != null) base.width = col.width;
  if (col.grow != null) {
    base.flexGrow = col.grow;
    base.flexBasis = 0;
  }
  return base;
}

export function Table<T extends { key: string | number }>({ columns, rows, isHot }: TableProps<T>) {
  return (
    <C.TableRoot>
      <C.TableHeaderRow>
        {columns.map((c) => (
          <C.TableHeaderCell key={c.key} style={cellStyle(c) as any}>{c.label}</C.TableHeaderCell>
        ))}
      </C.TableHeaderRow>
      {rows.map((row) => {
        const hot = isHot ? isHot(row) : false;
        const Row = C.TableRow; // variant is applied via classifier active variant; hot is structural per-row, so pass style
        return (
          <Row key={row.key} style={hot ? { backgroundColor: 'rgba(255,210,74,0.06)' } : undefined}>
            {columns.map((c) => {
              const tint = c.tint ? c.tint(row) : null;
              const Cls = tint === 'pos' ? C.TableCellPos
                        : tint === 'neg' ? C.TableCellNeg
                        : tint === 'dim' ? C.TableCellDim
                        : C.TableCell;
              return (
                <Cls key={c.key} style={cellStyle(c) as any}>
                  {c.render ? c.render(row) : String((row as any)[c.key] ?? '')}
                </Cls>
              );
            })}
          </Row>
        );
      })}
    </C.TableRoot>
  );
}
