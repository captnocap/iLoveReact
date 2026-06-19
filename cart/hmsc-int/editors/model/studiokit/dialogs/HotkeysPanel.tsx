// editors/model/studiokit/dialogs/HotkeysPanel.tsx — the self-serve rebind
// panel (req_1433). "if i dont like the hotkey i dont have to go ask anyone" —
// every action in a scope lists its name + current chord, a Rebind capture
// ("press a key"), and Reset-to-default. It reads + writes the EDITOR CONTROL
// CONTRACT (editors/controls.ts) through editors/keybinds.ts, so a change here
// updates dispatch, the on-screen legend, and tooltips at once and persists
// across reloads.

import { useEffect, useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import { useRerender } from '@reactjit/hooks';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import { T } from '../config';
import { Z } from '../chrome/zlayers';
import { bindingsForScope, chordOf, isOverridden, prettyChord, setKeyCapture, type EditorScope } from '../../../controls';
import { rebind, resetBind } from '../../../keybinds';

export function HotkeysPanel(props: { scope: EditorScope; onClose: () => void }) {
  const rerender = useRerender();
  const [capturing, setCapturing] = useState<string | null>(null); // action id mid-capture
  const [conflict, setConflict] = useState<string | null>(null);
  const rows = bindingsForScope(props.scope);

  // While capturing, suppress ALL dispatch (so pressing Delete to bind it does
  // not also delete the selection) and grab the next chord off the key bus.
  // Escape cancels the capture (so Escape itself stays the universal cancel).
  useEffect(() => {
    if (!capturing) return;
    setKeyCapture(true);
    const off = busOn('__keydown', (e: any) => {
      const base = String(e?.key ?? '').toLowerCase();
      if (!base) return;
      if (base === 'escape') { setCapturing(null); return; }
      const r = rebind(props.scope, capturing, [chordOf(e)]);
      setConflict(r.ok ? null : r.conflict);
      setCapturing(null);
      rerender();
    });
    return () => { off(); setKeyCapture(false); };
  }, [capturing]);

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa', zIndex: Z.modal }}>
      <Col style={{ gap: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 14, paddingBottom: 14, borderRadius: 10, backgroundColor: '#0e1726f5', borderWidth: 1, borderColor: '#2c4a6a', minWidth: 380 }}>
        <Row style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
          <Text fontSize={13} color="#cfe2ff" style={{ fontWeight: '800' }}>Hotkeys</Text>
          <Pressable onPress={props.onClose} tooltip="Close" style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}>
            <Text fontSize={11} color={T.dim}>done</Text>
          </Pressable>
        </Row>
        {rows.map((b) => {
          const overridden = isOverridden(props.scope, b.action);
          const mid = capturing === b.action;
          return (
            <Row key={b.action} style={{ gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
              <Text fontSize={11} color={T.text} style={{ flexGrow: 1 }}>{b.label}</Text>
              <Box style={{ minWidth: 96, alignItems: 'flex-end' }}>
                <Text fontSize={11} color={mid ? '#e9c77f' : overridden ? '#7fd6a0' : T.dim} style={{ fontFamily: 'monospace' }}>
                  {mid ? 'press a key…' : b.keys.map(prettyChord).join(' / ')}
                </Text>
              </Box>
              <Pressable onPress={() => { setConflict(null); setCapturing(mid ? null : b.action); }} tooltip="Press a key to rebind this action" style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: mid ? '#3a2f5e' : '#13233aee', borderWidth: 1, borderColor: mid ? '#9b7fd6' : '#2c4a6a' }}>
                <Text fontSize={10} color={mid ? '#e0d4ff' : T.dim}>{mid ? 'cancel' : 'rebind'}</Text>
              </Pressable>
              <Pressable onPress={overridden ? () => { resetBind(props.scope, b.action); setConflict(null); rerender(); } : undefined} tooltip="Reset to the default key" style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 5, opacity: overridden ? 1 : 0.35, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}>
                <Text fontSize={10} color={T.dim}>reset</Text>
              </Pressable>
            </Row>
          );
        })}
        {conflict ? <Text fontSize={10} color="#f0a0a0" style={{ fontFamily: 'monospace' }}>{`⚠ ${conflict}`}</Text> : null}
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace', marginTop: 2 }}>Click rebind, then press the key. Esc cancels. Changes save automatically.</Text>
      </Col>
    </Box>
  );
}
