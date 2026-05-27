// List — generic selectable rows. Headless render-prop API so callers
// shape each row themselves while the primitive owns layout + selection
// highlight + hover.

import { classifiers as C } from '../../../../runtime/classifier';
import './List.cls';

export interface ListItem {
  key: string | number;
}

export interface ListProps<T extends ListItem> {
  items: T[];
  selectedKey?: string | number;
  onSelect?: (item: T) => void;
  renderRow: (item: T) => any;
}

export function List<T extends ListItem>({ items, selectedKey, onSelect, renderRow }: ListProps<T>) {
  return (
    <C.ListRoot>
      {items.map((item) => {
        const active = item.key === selectedKey;
        const Row = active ? C.ListRowActive : C.ListRow;
        return (
          <Row key={item.key} onPress={() => onSelect && onSelect(item)}>
            {renderRow(item)}
          </Row>
        );
      })}
    </C.ListRoot>
  );
}

export const ListSlots = {
  Label: C.ListLabel,
  SubLabel: C.ListSubLabel,
  Trailing: C.ListTrailing,
};
