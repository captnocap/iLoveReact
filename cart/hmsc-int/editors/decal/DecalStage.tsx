// editors/decal/DecalStage.tsx — the shared flat DECAL editing canvas
// (req_1730/req_1831). A fit-scaled DecalSurface with per-node selection
// Pressables and eight resize handles over the selected node; pointer drags are
// reported back in DOC-PIXEL units via onMove / onResize. Lifted verbatim from
// the materials composer's ComposeStage so the studio painter authors a decal's
// nodes with the exact same drag/resize feel ([[feedback_rule_of_two_no_magic_values]]).

import { useEffect, useRef, useState } from 'react';
import { Box, Pressable } from '@reactjit/primitives';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { accentFor } from '../../studio.cls';
import { DecalSurface } from '../../game/textures/decalRender';
import type { DecalDoc } from '../../game/textures/decal';
import { DECAL_RESIZE_HANDLES, type DecalResizeHandle } from './decalEdit';

type Drag =
  | { kind: 'move'; id: string }
  | { kind: 'resize'; id: string; handle: DecalResizeHandle };

export type DecalStageProps = {
  doc: DecalDoc;
  selectedId: string | null;
  onSelect(id: string | null): void;
  /** dx/dy in DOC-PIXEL units (the stage converts from screen space by scale). */
  onMove(id: string, dx: number, dy: number): void;
  onResize(id: string, handle: DecalResizeHandle, dx: number, dy: number): void;
  /** max zoom of the doc canvas into the stage box (default 1.6). */
  maxScale?: number;
  /** inner padding of the stage box (default 28). */
  pad?: number;
};

export function DecalStage(props: DecalStageProps) {
  const { doc, selectedId } = props;
  const maxScale = props.maxScale ?? 1.6;
  const pad = props.pad ?? 28;
  const selectedNode = selectedId ? doc.nodes.find((n) => n.id === selectedId) ?? null : null;
  const dragRef = useRef<Drag | null>(null);
  const scaleRef = useRef(1);
  const [stageBox, setStageBox] = useState({ w: 1, h: 1 });

  const scale = Math.min(maxScale, (stageBox.w - pad * 2) / doc.width, (stageBox.h - pad * 2) / doc.height);
  scaleRef.current = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const stageW = doc.width * scaleRef.current;
  const stageH = doc.height * scaleRef.current;
  const endDrag = () => { dragRef.current = null; };

  useEffect(() => busOn('system:cursor:move', (e: any) => {
    const drag = dragRef.current;
    if (!drag) return;
    const scaleNow = scaleRef.current || 1;
    const dx = Number(e?.dx ?? 0) / scaleNow;
    const dy = Number(e?.dy ?? 0) / scaleNow;
    if (dx === 0 && dy === 0) return;
    if (drag.kind === 'move') props.onMove(drag.id, dx, dy);
    else props.onResize(drag.id, drag.handle, dx, dy);
  }), [props.onMove, props.onResize]);

  return (
    <Box
      onLayout={(lr: any) => {
        const w = Math.max(1, Number(lr?.width ?? 1));
        const h = Math.max(1, Number(lr?.height ?? 1));
        setStageBox((p) => (p.w === w && p.h === h ? p : { w, h }));
      }}
      onMouseUp={endDrag}
      style={{ flexGrow: 1, minWidth: 0, minHeight: 0, alignItems: 'center', justifyContent: 'center', position: 'relative' }}
    >
      <Pressable onPress={() => props.onSelect(null)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }} />
      <Box style={{ width: stageW, height: stageH, borderWidth: 1, borderColor: accentFor('border') }}>
        <DecalSurface doc={doc} width={stageW} height={stageH} />
        <Box style={{ position: 'absolute', left: 0, top: 0, width: stageW, height: stageH }}>
          {doc.nodes.map((n) => (
            <Pressable
              key={n.id}
              onMouseDown={() => { props.onSelect(n.id); dragRef.current = { kind: 'move', id: n.id }; }}
              onMouseUp={endDrag}
              style={{
                position: 'absolute',
                left: n.x * scaleRef.current,
                top: n.y * scaleRef.current,
                width: Math.max(6, n.w * scaleRef.current),
                height: Math.max(6, n.h * scaleRef.current),
                backgroundColor: '#00000001',
                borderWidth: selectedId === n.id ? 1 : 0,
                borderColor: accentFor('primary'),
              }}
            />
          ))}
          {selectedNode ? DECAL_RESIZE_HANDLES.map((h) => {
            const handleSize = 10;
            const left = (selectedNode.x + selectedNode.w * h.x) * scaleRef.current - handleSize / 2;
            const top = (selectedNode.y + selectedNode.h * h.y) * scaleRef.current - handleSize / 2;
            return (
              <Pressable
                key={`resize-${h.id}`}
                onMouseDown={() => { props.onSelect(selectedNode.id); dragRef.current = { kind: 'resize', id: selectedNode.id, handle: h.id }; }}
                onMouseUp={endDrag}
                style={{
                  position: 'absolute', left, top, width: handleSize, height: handleSize,
                  borderRadius: 2, borderWidth: 1, borderColor: '#f8fafc', backgroundColor: accentFor('primary'),
                }}
              />
            );
          }) : null}
        </Box>
      </Box>
    </Box>
  );
}
