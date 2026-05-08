import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { COLORS } from '../constants';
import { BrowserSettings } from '../types';
import ShellButton from './ShellButton';

function Section({
  title,
  children,
}: {
  title: string;
  children: any;
}) {
  return (
    <Box
      style={{
        backgroundColor: COLORS.chromeRaised,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
        gap: 10,
      }}
    >
      <Text style={{ color: COLORS.text, fontSize: 12, fontWeight: 'bold' }}>{title}</Text>
      {children}
    </Box>
  );
}

function SettingRow({
  label,
  detail,
  children,
}: {
  label: string;
  detail: string;
  children: any;
}) {
  return (
    <Col style={{ gap: 8 }}>
      <Box style={{ gap: 2 }}>
        <Text style={{ color: COLORS.text, fontSize: 11, fontWeight: 'bold' }}>{label}</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>{detail}</Text>
      </Box>
      {children}
    </Col>
  );
}

export default function SettingsPanel({
  settings,
  tabCount,
  bookmarkCount,
  onChange,
  onClose,
}: {
  settings: BrowserSettings;
  tabCount: number;
  bookmarkCount: number;
  onChange: (patch: Partial<BrowserSettings>) => void;
  onClose: () => void;
}) {
  return (
    <Box
      style={{
        width: 320,
        height: '100%',
        backgroundColor: COLORS.chrome,
        borderLeftWidth: 1,
        borderColor: COLORS.border,
        padding: 14,
      }}
    >
      <Col style={{ gap: 14 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Box style={{ gap: 2 }}>
            <Text style={{ color: COLORS.text, fontSize: 14, fontWeight: 'bold' }}>Browser Settings</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>
              Shell behavior, startup defaults, and chrome density.
            </Text>
          </Box>
          <ShellButton label="Done" onPress={onClose} />
        </Row>

        <Section title="Startup">
          <SettingRow
            label="Launch Behavior"
            detail="Choose what the first window does when the cart boots."
          >
            <Row style={{ gap: 8, flexWrap: 'wrap' }}>
              <ShellButton
                label="Home"
                onPress={() => onChange({ startupMode: 'home' })}
                active={settings.startupMode === 'home'}
              />
              <ShellButton
                label="Blank"
                onPress={() => onChange({ startupMode: 'blank' })}
                active={settings.startupMode === 'blank'}
              />
              <ShellButton
                label="Restore"
                onPress={() => onChange({ startupMode: 'restore' })}
                active={settings.startupMode === 'restore'}
              />
            </Row>
          </SettingRow>

          <SettingRow
            label="New Tabs"
            detail="Pick the default surface when a new tab opens."
          >
            <Row style={{ gap: 8 }}>
              <ShellButton
                label="Open Home"
                onPress={() => onChange({ newTabMode: 'home' })}
                active={settings.newTabMode === 'home'}
              />
              <ShellButton
                label="Open Blank"
                onPress={() => onChange({ newTabMode: 'blank' })}
                active={settings.newTabMode === 'blank'}
              />
            </Row>
          </SettingRow>
        </Section>

        <Section title="Chrome">
          <SettingRow
            label="Bookmarks Bar"
            detail="Keep saved sites visible below the toolbar."
          >
            <Row style={{ gap: 8 }}>
              <ShellButton
                label="Shown"
                onPress={() => onChange({ showBookmarksBar: true })}
                active={settings.showBookmarksBar}
              />
              <ShellButton
                label="Hidden"
                onPress={() => onChange({ showBookmarksBar: false })}
                active={!settings.showBookmarksBar}
              />
            </Row>
          </SettingRow>

          <SettingRow
            label="Tabs Density"
            detail="Compact mode narrows the side rail for denser sessions."
          >
            <Row style={{ gap: 8 }}>
              <ShellButton
                label="Comfortable"
                onPress={() => onChange({ compactTabs: false })}
                active={!settings.compactTabs}
              />
              <ShellButton
                label="Compact"
                onPress={() => onChange({ compactTabs: true })}
                active={settings.compactTabs}
              />
            </Row>
          </SettingRow>

          <SettingRow
            label="Status Bar"
            detail="Show load state and host label in the second chrome row."
          >
            <Row style={{ gap: 8 }}>
              <ShellButton
                label="Shown"
                onPress={() => onChange({ showStatusBar: true })}
                active={settings.showStatusBar}
              />
              <ShellButton
                label="Hidden"
                onPress={() => onChange({ showStatusBar: false })}
                active={!settings.showStatusBar}
              />
            </Row>
          </SettingRow>
        </Section>

        <Section title="Session Snapshot">
          <Col style={{ gap: 8 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>Open tabs</Text>
              <Text style={{ color: COLORS.text, fontSize: 10, fontWeight: 'bold' }}>{String(tabCount)}</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>Bookmarks</Text>
              <Text style={{ color: COLORS.text, fontSize: 10, fontWeight: 'bold' }}>{String(bookmarkCount)}</Text>
            </Row>
            <Text style={{ color: COLORS.textFaint, fontSize: 10 }}>
              The shell persists session state to local storage so the next rendering pass can focus on page content instead of chrome recovery.
            </Text>
          </Col>
        </Section>
      </Col>
    </Box>
  );
}
