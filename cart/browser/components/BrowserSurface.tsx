import { BrowserTab, BookmarkEntry } from '../types';
import HomeScreen from './HomeScreen';
import PageSurface from './PageSurface';

export default function BrowserSurface({
  tab,
  bookmarks,
  recentTabs,
  onOpenAddress,
  onOpenSettings,
  onOpenNewTab,
}: {
  tab: BrowserTab | null;
  bookmarks: BookmarkEntry[];
  recentTabs: BrowserTab[];
  onOpenAddress: (address: string) => void;
  onOpenSettings: () => void;
  onOpenNewTab: () => void;
}) {
  if (!tab || tab.kind === 'home') {
    return (
      <HomeScreen
        bookmarks={bookmarks}
        recentTabs={recentTabs}
        onOpenAddress={onOpenAddress}
        onOpenSettings={onOpenSettings}
        onOpenNewTab={onOpenNewTab}
      />
    );
  }

  return (
    <PageSurface
      tab={tab}
      onOpenAddress={onOpenAddress}
    />
  );
}
