import * as React from 'react';
import { Col, Text } from '../../../runtime/primitives';
import { palette } from '../ui/palette';

export function HelpPage() {
  return (
    <Col style={{ flexGrow: 1, padding: 1, gap: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>help</Text>
      <Text style={{ color: palette.ink }}>click a tab or press 1–4 to switch</Text>
      <Text style={{ color: palette.ink }}>click into the terminal box to type into claude</Text>
      <Text style={{ color: palette.ink }}>Ctrl+] drops terminal focus back to the cart</Text>
      <Text style={{ color: palette.ink }}>Ctrl+, opens the settings window</Text>
      <Text style={{ color: palette.ink }}>ifttt: live claude-code lifecycle events from inside the VM</Text>
      <Text style={{ color: palette.ink }}>recipes: live useIFTTT bindings — edit trigger/action in real DSL</Text>
      <Text style={{ color: palette.ink }}>q quits (only when terminal isn't focused)</Text>
    </Col>
  );
}
