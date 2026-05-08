import { callHost } from '@reactjit/runtime/ffi';
import { Box, Row, TextInput } from '@reactjit/runtime/primitives';
import { COLORS } from '../constants';
import { BrowserTab } from '../types';
import BrowserIcon from './BrowserIcon';
import ShellButton from './ShellButton';

export default function Toolbar({
  activeTab,
  addressDraft,
  isBookmarked,
  canBookmark,
  settingsOpen,
  onAddressDraftChange,
  onAddressSubmit,
  onBack,
  onForward,
  onHome,
  onReload,
  onToggleBookmark,
  onToggleSettings,
  onAddressFocus,
  onAddressBlur,
  canGoBack,
  canGoForward,
}: {
  activeTab: BrowserTab | null;
  addressDraft: string;
  isBookmarked: boolean;
  canBookmark: boolean;
  settingsOpen: boolean;
  onAddressDraftChange: (value: string) => void;
  onAddressSubmit: () => void;
  onBack: () => void;
  onForward: () => void;
  onHome: () => void;
  onReload: () => void;
  onToggleBookmark: () => void;
  onToggleSettings: () => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}) {
  const hostIcon = activeTab?.kind === 'home'
    ? 'home'
    : activeTab?.kind === 'blank'
      ? 'blank'
      : 'page';
  const isMaximized = callHost<boolean>('__window_is_maximized', false);

  return (
    <Row
      windowDrag={true}
      style={{
        width: '100%',
        minWidth: 0,
        backgroundColor: COLORS.chrome,
        borderBottomWidth: 1,
        borderColor: COLORS.border,
        paddingLeft: 6,
        paddingRight: 4,
        paddingTop: 4,
        paddingBottom: 4,
        gap: 6,
        alignItems: 'center',
      }}
    >
      <Row style={{ gap: 4, alignItems: 'center', flexShrink: 0 }}>
        <ShellButton icon="chevron-left" onPress={onBack} disabled={!canGoBack} width={24} height={24} paddingX={0} />
        <ShellButton icon="chevron-right" onPress={onForward} disabled={!canGoForward} width={24} height={24} paddingX={0} />
        <ShellButton icon="refresh" onPress={onReload} width={24} height={24} iconSize={13} paddingX={0} />
        <ShellButton icon="home" onPress={onHome} tone="warm" width={24} height={24} iconSize={13} paddingX={0} />
      </Row>

      <Row
        style={{
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          height: 28,
          backgroundColor: COLORS.fieldBg,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: COLORS.fieldBorder,
          alignItems: 'center',
          paddingLeft: 7,
          paddingRight: 7,
          gap: 6,
        }}
      >
        <BrowserIcon
          name={hostIcon}
          size={11}
          strokeWidth={1.6}
          color={activeTab?.isLoading ? COLORS.accentWarm : COLORS.textFaint}
        />
        <Box style={{ width: 1, height: 10, backgroundColor: COLORS.border }} />
        <Box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
          <TextInput
            value={addressDraft}
            placeholder="Search or enter address"
            onChangeText={onAddressDraftChange}
            onSubmit={onAddressSubmit}
            onFocus={onAddressFocus}
            onBlur={onAddressBlur}
            color={COLORS.text}
            noWrap={true}
            numberOfLines={1}
            style={{
              height: 20,
              width: '100%',
              backgroundColor: 'transparent',
              borderWidth: 0,
              paddingLeft: 0,
              paddingRight: 0,
              paddingTop: 0,
              paddingBottom: 0,
              fontSize: 12,
              lineHeight: 16,
            }}
          />
        </Box>
      </Row>

      <Row style={{ gap: 2, alignItems: 'center', flexShrink: 0 }}>
        <ShellButton
          icon="bookmark"
          onPress={onToggleBookmark}
          disabled={!canBookmark}
          active={isBookmarked}
          width={22}
          height={20}
          iconSize={11}
          iconStrokeWidth={1.7}
          paddingX={0}
        />
        <ShellButton
          icon="go"
          onPress={onAddressSubmit}
          tone="accent"
          width={22}
          height={20}
          iconSize={11}
          iconStrokeWidth={1.8}
          paddingX={0}
        />
        <ShellButton
          icon="sliders"
          onPress={onToggleSettings}
          active={settingsOpen}
          width={22}
          height={20}
          iconSize={11}
          iconStrokeWidth={1.7}
          paddingX={0}
        />
      </Row>

      <Row style={{ gap: 2, alignItems: 'center', flexShrink: 0 }}>
        <ShellButton
          icon="minus"
          onPress={() => callHost<void>('__window_minimize', undefined as any)}
          width={20}
          height={20}
          iconSize={11}
          iconStrokeWidth={1.8}
          paddingX={0}
          tone="ghost"
        />
        <ShellButton
          icon="square"
          onPress={() => callHost<void>('__window_maximize', undefined as any)}
          width={20}
          height={20}
          iconSize={isMaximized ? 9 : 9}
          iconStrokeWidth={1.6}
          paddingX={0}
          tone="ghost"
        />
        <ShellButton
          icon="x"
          onPress={() => callHost<void>('__window_close', undefined as any)}
          width={20}
          height={20}
          iconSize={10}
          iconStrokeWidth={1.8}
          paddingX={0}
          tone="ghost"
        />
      </Row>
    </Row>
  );
}
