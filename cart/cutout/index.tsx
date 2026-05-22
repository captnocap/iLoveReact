// cutout — full-fidelity object cutout from any image. Photoshop-style
// layout: top file bar, left tool palette, center editor (Canvas with
// pan/zoom), right inspector panel, bottom status bar. Fixed viewport;
// nothing ever scrolls.
//
// All state + behavior lives in useCutoutState(); components are pure
// (props.s → JSX). Add a new panel = new file under components/, slot it
// into the layout below. Don't bloat any one file.

import { Box, Col, Row } from '@reactjit/runtime/primitives';
import { useState } from 'react';
import { useCutoutState } from './state';
import { COLORS } from './theme';
import { TopBar } from './components/TopBar';
import { Tools } from './components/Tools';
import { Editor } from './components/Editor';
import { EffectModal, Inspector, type EffectDraft } from './components/Inspector';
import { StatusBar } from './components/StatusBar';

export default function CutoutApp() {
  const s = useCutoutState();
  const [effectDraft, setEffectDraft] = useState<EffectDraft | null>(null);
  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: COLORS.bg, position: 'relative' }}>
      <TopBar s={s} />
      <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, padding: 10 }}>
        <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, gap: 10 }}>
          <Tools s={s} />
          <Editor s={s} />
          <Inspector s={s} onOpenEffectModal={setEffectDraft} />
        </Row>
      </Box>
      <StatusBar s={s} />
      {effectDraft ? (
        <EffectModal
          s={s}
          onClose={() => setEffectDraft(null)}
          onAdd={(label, shader) => {
            const id = s.addCustomSurface(label, shader);
            effectDraft.apply(id);
            setEffectDraft(null);
          }}
        />
      ) : null}
    </Col>
  );
}
