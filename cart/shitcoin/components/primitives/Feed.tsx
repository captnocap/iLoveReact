// Feed — newest-first stream of typed entries. Render-prop pattern so the
// caller decides how each entry looks; the Feed only owns the layout +
// scroll + empty state. This keeps the primitive small while supporting
// every flavor (social posts, news, telegram messages, tape rows).

import { classifiers as C } from '../../../../runtime/classifier';
import './Feed.cls';

export interface FeedEntry {
  /** Stable key — use this as React key. */
  key: string | number;
}

export interface FeedProps<T extends FeedEntry> {
  entries: T[];
  /** Render-prop: caller turns each entry into the row element. Return
   *  either raw children to be wrapped in <FeedItem>, or call
   *  `Feed.Item` yourself for fine control. */
  renderEntry: (entry: T) => any;
  emptyMessage?: string;
}

export function Feed<T extends FeedEntry>({ entries, renderEntry, emptyMessage }: FeedProps<T>) {
  return (
    <C.FeedRoot>
      <C.FeedInner>
        {entries.length === 0
          ? <C.FeedEmpty>{emptyMessage ?? 'Nothing here yet.'}</C.FeedEmpty>
          : entries.map((e) => (
            <FeedItem key={e.key}>{renderEntry(e)}</FeedItem>
          ))
        }
      </C.FeedInner>
    </C.FeedRoot>
  );
}

export function FeedItem({ onPress, children }: { onPress?: () => void; children: any }) {
  return <C.FeedItem onPress={onPress}>{children}</C.FeedItem>;
}

// Re-export the slot classifiers so callers can compose canonical
// post-shaped rows without hand-styling.
export const FeedSlots = {
  Avatar: C.FeedItemAvatar,
  Main: C.FeedItemMain,
  Header: C.FeedItemHeader,
  Handle: C.FeedItemHandle,
  Meta: C.FeedItemMeta,
  Body: C.FeedItemBody,
  Stats: C.FeedItemStats,
  Stat: C.FeedItemStat,
};
